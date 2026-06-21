"""Phase 3 — Sentences: word stream -> sentences with exact start/end times.

Sentences are the only granularity downstream stages cut on. A sentence break
is placed after a word when it ends with terminal punctuation, when the gap to
the next word exceeds the configured threshold, or at a Whisper segment
boundary. Each sentence's start is its first word's start and its end is its
last word's end. Caches sentences.json.

Contract: [{"idx": 0, "text": "...", "start": 0.0, "end": 6.3}]
"""

from __future__ import annotations

from typing import List, Optional

from ..config import get_settings
from ..storage import Storage, read_json, write_json

TRANSCRIPT = "transcript.json"
ARTIFACT = "sentences.json"

_TERMINAL = {".", "!", "?", "…"}
_TRAILING = "\"')]}»”’"
# Common abbreviations whose trailing period should not end a sentence when no
# real pause follows.
_ABBREV = {
    "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "vs.", "etc.",
    "e.g.", "i.e.", "a.m.", "p.m.", "u.s.", "u.k.", "fig.", "no.", "vol.",
}


def _ends_sentence(word_text: str) -> bool:
    t = word_text.strip().rstrip(_TRAILING)
    return bool(t) and t[-1] in _TERMINAL


def _is_abbrev(word_text: str) -> bool:
    t = word_text.strip().lower()
    if t in _ABBREV:
        return True
    # single capital initial like "A." or "J."
    core = t.rstrip(_TRAILING)
    return len(core) == 2 and core[0].isalpha() and core[1] == "."


def _make_sentence(idx: int, words: List[dict]) -> Optional[dict]:
    text = "".join(w["word"] for w in words).strip()
    if not text:
        return None
    return {"idx": idx, "text": text, "start": words[0]["start"], "end": words[-1]["end"]}


def words_to_sentences(transcript: dict, sentence_gap: float) -> List[dict]:
    flat = []  # (word, segment_id)
    for seg in transcript.get("segments", []):
        sid = seg.get("id")
        for w in seg.get("words", []):
            if w.get("start") is None or w.get("end") is None:
                continue
            flat.append((w, sid))

    sentences: List[dict] = []
    buf: List[dict] = []
    for i, (w, sid) in enumerate(flat):
        buf.append(w)
        nxt = flat[i + 1] if i + 1 < len(flat) else None
        is_last = nxt is None
        gap = (nxt[0]["start"] - w["end"]) if nxt else 0.0
        seg_change = nxt is not None and nxt[1] != sid

        punct = _ends_sentence(w["word"])
        if punct and _is_abbrev(w["word"]) and gap < sentence_gap and not seg_change:
            punct = False

        if is_last or punct or gap > sentence_gap or seg_change:
            sentence = _make_sentence(len(sentences), buf)
            if sentence is not None:
                sentences.append(sentence)
            buf = []

    if buf:  # trailing words without a break (shouldn't happen — is_last covers it)
        sentence = _make_sentence(len(sentences), buf)
        if sentence is not None:
            sentences.append(sentence)
    return sentences


def run(job_id: str, storage: Storage, *, force: bool = False) -> List[dict]:
    if storage.exists(job_id, ARTIFACT) and not force:
        return read_json(storage, job_id, ARTIFACT)
    if not storage.exists(job_id, TRANSCRIPT):
        raise FileNotFoundError(
            f"{TRANSCRIPT} missing for job {job_id!r}; run transcribe first"
        )
    transcript = read_json(storage, job_id, TRANSCRIPT)
    sentences = words_to_sentences(transcript, get_settings().sentence_gap_sec)
    write_json(storage, sentences, job_id, ARTIFACT)
    return sentences
