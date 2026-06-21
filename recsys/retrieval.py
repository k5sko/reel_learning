"""Stage 2 — candidate generation. The corpus is clipper's READY clips: embed each clip's text
(``content_vec``), cosine-ANN the frontier node's concept against it. Per-video metadata
(channel, like:view) is read from each job's ``ingest.json`` (where clipper now records it) so the
ranker's ``P(fit)``/``P(good)`` have real data.

Brute-force cosine over normalized vectors — the single-user / vetted-channel corpus is small
(hundreds–thousands of clips), so a numpy matmul is microseconds and avoids a FAISS dependency.
Swap in FAISS here later if the corpus ever grows.

When the top hit's similarity is below ``retrieval_min_sim`` the node has thin coverage → the API
layer triggers a live clipper fetch (auto-query) for that concept.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

import numpy as np

from .config import Settings, get_settings
from .encoders import embed, embed_one
from .ranking import Candidate


@dataclass
class ClipRecord:
    id: str
    text: str
    duration: float
    job_id: str
    channel: Optional[str] = None
    views: Optional[int] = None
    likes: Optional[int] = None
    start: float = 0.0                         # offset in the source video -> intra-video ordering


def serialize_clip(clip) -> str:
    """clipper Clip → concept text to embed (no raw transcript in the DB; title/summary/hook/tags)."""
    parts = [clip.title or "", clip.summary or "", clip.hook or ""]
    tags = clip.tag_list()
    if tags:
        parts.append(" ".join(tags))
    return ". ".join(p.strip() for p in parts if p and p.strip())


def to_candidate(r: ClipRecord, relevance: float = 0.0) -> Candidate:
    return Candidate(
        id=r.id,
        channel=r.channel,
        likes=r.likes,
        views=r.views,
        relevance=relevance,
        job_id=r.job_id,
    )


class Corpus:
    def __init__(self, records: list[ClipRecord], embs: np.ndarray):
        self.records = records
        self.embs = embs                              # (N, D), L2-normalized
        self._by_id = {r.id: r for r in records}
        # per-video clip ids in start-time order -> enforce intra-video play order
        order: dict[str, list] = {}
        for r in records:
            order.setdefault(r.job_id, []).append(r)
        self.job_order = {
            jid: [r.id for r in sorted(rs, key=lambda r: r.start)] for jid, rs in order.items()
        }

    def earliest_unshown_ok(self, r: ClipRecord, shown: set) -> bool:
        """True iff every clip of r's video that starts before r has already been shown — i.e. r is
        the earliest not-yet-seen clip of its source video."""
        for cid in self.job_order.get(r.job_id, []):
            if cid == r.id:
                return True
            if cid not in shown:
                return False
        return True

    def __len__(self) -> int:
        return len(self.records)

    def record(self, clip_id: str) -> Optional[ClipRecord]:
        return self._by_id.get(clip_id)

    def search(
        self,
        concept_text: str,
        top_k: int,
        exclude: Iterable[str] = (),
        query_vec=None,
    ) -> list[tuple[ClipRecord, float]]:
        if not self.records:
            return []
        # use the precomputed node embedding when available (no encoder call in the hot path)
        q = np.asarray(query_vec, dtype="float32") if query_vec is not None else embed_one(concept_text)
        sims = self.embs @ q                          # cosine (vectors normalized)
        skip = set(exclude)
        out = []
        for i in np.argsort(-sims):
            r = self.records[i]
            if r.id in skip:
                continue
            out.append((r, float(sims[i])))
            if len(out) >= top_k:
                break
        return out


def load_corpus(cfg: Optional[Settings] = None) -> Corpus:
    """Build the corpus from clipper's READY clips + their job metadata. Imported lazily so the
    pure-logic modules don't depend on clipper / its DB."""
    cfg = cfg or get_settings()
    from sqlmodel import select

    from clipper.db import Clip, ClipStatus, init_db, session_scope
    from clipper.storage import get_storage, read_json

    init_db()
    storage = get_storage()
    meta_cache: dict = {}
    records: list[ClipRecord] = []
    with session_scope() as s:
        clips = list(s.exec(select(Clip).where(Clip.status == ClipStatus.READY)).all())
        for c in clips:
            meta = meta_cache.get(c.job_id)
            if meta is None:
                try:
                    meta = read_json(storage, c.job_id, "ingest.json") or {}
                except Exception:  # noqa: BLE001 — missing artifact -> no metadata, not fatal
                    meta = {}
                meta_cache[c.job_id] = meta
            records.append(
                ClipRecord(
                    id=c.id,
                    text=serialize_clip(c),
                    duration=c.duration,
                    job_id=c.job_id,
                    channel=meta.get("channel"),
                    views=meta.get("views"),
                    likes=meta.get("likes"),
                    start=getattr(c, "start", 0.0) or 0.0,
                )
            )
    embs = (
        embed([r.text for r in records])
        if records
        else np.zeros((0, cfg.content_dim), dtype="float32")
    )
    return Corpus(records, embs)


def candidates_for(
    corpus: Corpus,
    concept_text: str,
    cfg: Optional[Settings] = None,
    exclude: Iterable[str] = (),
    query_vec=None,
    exclude_jobs: Iterable[str] = (),
) -> tuple[list[Candidate], bool, list[tuple[ClipRecord, float]]]:
    """Return (candidates, coverage_ok, hits). ``coverage_ok`` is False when the top hit is below
    ``retrieval_min_sim`` → the caller should auto-query clipper to fetch clips for this concept.
    Pass ``query_vec`` (the node's stored embedding) to skip re-encoding the concept.
    ``exclude_jobs`` = videos on cooldown (recently shown) → none of their clips are eligible."""
    cfg = cfg or get_settings()
    shown = set(exclude)
    blocked_jobs = set(exclude_jobs)
    hits = corpus.search(concept_text, top_k=cfg.ann_top_k, exclude=exclude, query_vec=query_vec)
    # Relevance FILTER (node membership): keep only clips genuinely about this concept. Below the
    # floor isn't a weak candidate — it's a different topic, so drop it entirely.
    # Intra-video ORDER gate: only the earliest unshown clip of each source video is eligible.
    # Video COOLDOWN: drop clips whose source video was shown recently (exclude_jobs).
    hits = [
        (r, s)
        for r, s in hits
        if s >= cfg.retrieval_min_sim
        and r.job_id not in blocked_jobs
        and corpus.earliest_unshown_ok(r, shown)
    ]
    coverage_ok = bool(hits)                       # any on-topic clip at all? else -> auto-query
    return [to_candidate(r, sim) for r, sim in hits], coverage_ok, hits


# --- cached corpus singleton (rebuild on demand as clips are ingested) -------
import threading as _threading

_CORPUS: Optional[Corpus] = None
_CORPUS_LOCK = _threading.Lock()


def get_corpus(refresh: bool = False, cfg: Optional[Settings] = None) -> Corpus:
    """Thread-safe: concurrent /api/recommend calls share one build instead of racing."""
    global _CORPUS
    if _CORPUS is not None and not refresh:
        return _CORPUS
    with _CORPUS_LOCK:
        if _CORPUS is None or refresh:
            _CORPUS = load_corpus(cfg)
    return _CORPUS
