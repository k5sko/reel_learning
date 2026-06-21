"""Phase 7 — Label: per-clip {title, hook, summary, tags[], score} via Claude.

Writes each clip to the DB with status="ready" and writes clips.json as the
stage's final artifact. `score` (0–1) reflects standalone clarity + hook
strength; downstream stages (compression/filter, recommendation, RAG) read
these records straight from the DB.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

from ..config import get_settings
from ..db import Clip, ClipStatus, init_db, session_scope
from ..llm import LLMClient
from ..storage import Storage, read_json, write_json

BOUNDARIES = "boundaries.json"
VIDEO = "video.mp4"
ARTIFACT = "clips.json"

LABEL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "hook": {"type": "string"},
        "summary": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "score": {"type": "number"},
    },
    "required": ["title", "hook", "summary", "tags", "score"],
}

_SYSTEM = (
    "You write metadata for short, self-contained video clips. Titles are concise "
    "and specific (no clickbait), hooks are a single scroll-stopping line, "
    "summaries are one or two sentences. The score (0–1) rates how well the clip "
    "stands alone and how strong its hook is."
)


def _prompt(text: str) -> str:
    return (
        "Here is the transcript of one clip. Produce its metadata.\n\n"
        "- title: a specific, concise title\n"
        "- hook: one line that makes someone stop scrolling\n"
        "- summary: 1–2 sentences on what the clip covers\n"
        "- tags: 3–6 lowercase topical tags\n"
        "- score: 0–1, standalone clarity + hook strength\n\n"
        f"Transcript:\n{text}"
    )


def label_clip(text: str, llm: LLMClient) -> dict:
    out = llm.complete_json(_prompt(text), LABEL_SCHEMA, system=_SYSTEM) or {}
    score = out.get("score", 0.0)
    try:
        score = max(0.0, min(1.0, float(score)))
    except (TypeError, ValueError):
        score = 0.0
    tags = [str(t) for t in (out.get("tags") or [])]
    return {
        "title": str(out.get("title", "")).strip(),
        "hook": str(out.get("hook", "")).strip(),
        "summary": str(out.get("summary", "")).strip(),
        "tags": tags,
        "score": round(score, 3),
    }


def run(
    job_id: str,
    storage: Storage,
    llm: Optional[LLMClient] = None,
    *,
    force: bool = False,
) -> List[dict]:
    if storage.exists(job_id, ARTIFACT) and not force:
        return read_json(storage, job_id, ARTIFACT)
    if not storage.exists(job_id, BOUNDARIES):
        raise FileNotFoundError(
            f"{BOUNDARIES} missing for job {job_id!r}; run boundaries first"
        )

    clips = read_json(storage, job_id, BOUNDARIES)
    llm = llm or LLMClient()
    # Virtual clips: every clip references the one source video + start/end.
    source_video = storage.path(job_id, VIDEO)

    # Label clips concurrently — this is the slowest LLM stage (one call/clip).
    metas: List[Optional[dict]] = [None] * len(clips)
    if clips:
        workers = min(max(1, get_settings().llm_concurrency), len(clips))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            for i, meta in ex.map(
                lambda p: (p[0], label_clip(p[1].get("text", ""), llm)),
                list(enumerate(clips)),
            ):
                metas[i] = meta

    records: List[dict] = []
    for c, meta in zip(clips, metas):
        records.append(
            {
                # globally-unique id (the on-disk filename stays the per-job
                # short id; clips are served by file_path, not id)
                "id": f"{job_id}_{c['id']}",
                "job_id": job_id,
                "start": c["start"],
                "end": c["end"],
                "duration": c["duration"],
                "title": meta["title"],
                "hook": meta["hook"],
                "summary": meta["summary"],
                "tags": meta["tags"],
                "score": meta["score"],
                "file_path": source_video,  # source video; clip is start→end of it
                "status": ClipStatus.READY,
            }
        )

    init_db()
    with session_scope() as s:
        for r in records:
            s.merge(
                Clip(
                    id=r["id"],
                    job_id=job_id,
                    start=r["start"],
                    end=r["end"],
                    duration=r["duration"],
                    title=r["title"],
                    hook=r["hook"],
                    summary=r["summary"],
                    tags=json.dumps(r["tags"]),
                    score=r["score"],
                    file_path=r["file_path"],
                    status=ClipStatus.READY,
                )
            )
        s.commit()

    write_json(storage, records, job_id, ARTIFACT)
    return records
