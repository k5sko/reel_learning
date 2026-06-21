"""Phase 5 — Boundaries (the crux): snap/pad/validate moment boundaries.

This is the single source of truth for clip timing. The LLM only proposed
sentence-index ranges; here we turn them into times that provably never cut
mid-word or mid-sentence:

1. Map: start = sentences[start_sentence].start, end = sentences[end_sentence].end
   (both are word boundaries by construction).
2. Snap: the natural pause at each edge is the silence between the moment's
   edge word and its neighbor word. We bound the cut to that silence, so it can
   never cross into an adjacent sentence.
3. Pad: +lead_in / +tail, clamped into the available silence (and video bounds).
4. Duration: drop clips < drop_below; sub-split clips whose raw span exceeds
   target_max at sentence boundaries.
5. De-dup: drop a clip overlapping a stronger one (by reason signal) > 50%.
6. Validate: assert no boundary falls strictly inside any word span; a clip that
   can't satisfy this is dropped, never silently emitted.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

from ..config import Settings, get_settings
from ..storage import Storage, read_json, write_json

SENTENCES = "sentences.json"
TRANSCRIPT = "transcript.json"
MOMENTS = "moments.json"
ARTIFACT = "boundaries.json"

_EPS = 1e-6


def word_list(transcript: dict) -> List[dict]:
    words = []
    for seg in transcript.get("segments", []):
        for w in seg.get("words", []):
            if w.get("start") is None or w.get("end") is None:
                continue
            words.append({"start": float(w["start"]), "end": float(w["end"])})
    words.sort(key=lambda w: w["start"])
    return words


def boundary_inside_word(t: float, words: List[dict]) -> bool:
    """True if t falls strictly inside any word's (start, end) span."""
    for w in words:
        if w["start"] + _EPS < t < w["end"] - _EPS:
            return True
    return False


def _prev_word_end(start_t: float, words: List[dict]) -> float:
    prev = 0.0
    for w in words:
        if w["end"] <= start_t + _EPS:
            prev = max(prev, w["end"])
        else:
            break
    return prev


def _next_word_start(end_t: float, words: List[dict], duration: float) -> float:
    for w in words:
        if w["start"] >= end_t - _EPS:
            return w["start"]
    return duration


def snap_and_pad(
    start_t: float,
    end_t: float,
    words: List[dict],
    duration: float,
    settings: Settings,
) -> Tuple[float, float]:
    lower = _prev_word_end(start_t, words)          # neighbor word boundary (silence floor)
    upper = _next_word_start(end_t, words, duration)  # neighbor word boundary (silence ceiling)
    start = max(lower, start_t - settings.pad_lead_in, 0.0)
    end = min(upper, end_t + settings.pad_tail, duration)
    return start, end


def _split_long(
    start_sentence: int,
    end_sentence: int,
    sentences: List[dict],
    max_sec: float,
) -> List[Tuple[int, int]]:
    """Pack sentences greedily into sub-ranges whose raw span stays <= max_sec."""
    subs: List[Tuple[int, int]] = []
    i = start_sentence
    while i <= end_sentence:
        j = i
        while j < end_sentence:
            span = sentences[j + 1]["end"] - sentences[i]["start"]
            if span > max_sec:
                break
            j += 1
        subs.append((i, j))
        i = j + 1
    return subs


def _text(sentences: List[dict], a: int, b: int) -> str:
    return " ".join(sentences[k]["text"] for k in range(a, b + 1)).strip()


def _overlap_frac(a: dict, b: dict) -> float:
    inter = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    if inter <= 0:
        return 0.0
    return inter / min(a["duration"], b["duration"])


def _dedup(clips: List[dict], threshold: float) -> List[dict]:
    # Stronger reason signal wins; reason length is the proxy for signal strength.
    order = sorted(clips, key=lambda c: (-len(c["reason"]), c["start"]))
    kept: List[dict] = []
    for c in order:
        if any(_overlap_frac(c, k) > threshold for k in kept):
            continue
        kept.append(c)
    return kept


def build_clips(
    moments: List[dict],
    sentences: List[dict],
    words: List[dict],
    duration: float,
    settings: Settings,
) -> List[dict]:
    n = len(sentences)
    raw: List[dict] = []
    for m in moments:
        ss = m.get("start_sentence")
        es = m.get("end_sentence")
        if ss is None or es is None or not (0 <= ss <= es < n):
            continue
        reason = str(m.get("reason", ""))

        raw_span = sentences[es]["end"] - sentences[ss]["start"]
        ranges = (
            _split_long(ss, es, sentences, settings.target_max_sec)
            if raw_span > settings.target_max_sec
            else [(ss, es)]
        )

        for a, b in ranges:
            start, end = snap_and_pad(
                sentences[a]["start"], sentences[b]["end"], words, duration, settings
            )
            dur = end - start
            if dur < settings.drop_below_sec:
                continue  # too short after padding — drop
            # Validate the non-negotiable; drop (never silently emit) on failure.
            if boundary_inside_word(start, words) or boundary_inside_word(end, words):
                continue
            raw.append(
                {
                    "start": round(start, 3),
                    "end": round(end, 3),
                    "duration": round(dur, 3),
                    "start_sentence": a,
                    "end_sentence": b,
                    "reason": reason,
                    "text": _text(sentences, a, b),
                }
            )

    kept = _dedup(raw, settings.dedup_overlap)
    kept.sort(key=lambda c: c["start"])
    for i, c in enumerate(kept, 1):
        c["id"] = f"c_{i:02d}"
    return kept


def run(job_id: str, storage: Storage, *, force: bool = False) -> List[dict]:
    if storage.exists(job_id, ARTIFACT) and not force:
        return read_json(storage, job_id, ARTIFACT)
    for required in (SENTENCES, TRANSCRIPT, MOMENTS):
        if not storage.exists(job_id, required):
            raise FileNotFoundError(
                f"{required} missing for job {job_id!r}; run the prior stages first"
            )
    sentences = read_json(storage, job_id, SENTENCES)
    transcript = read_json(storage, job_id, TRANSCRIPT)
    moments = read_json(storage, job_id, MOMENTS)

    words = word_list(transcript)
    duration = transcript.get("duration") or (words[-1]["end"] if words else 0.0)

    clips = build_clips(moments, sentences, words, duration, get_settings())
    write_json(storage, clips, job_id, ARTIFACT)
    return clips
