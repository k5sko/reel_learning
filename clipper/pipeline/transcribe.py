"""Phase 2 — Transcribe: audio.wav -> transcript.json (word-level timestamps).

Caches transcript.json and never re-transcribes if it already exists (unless
``force=True``). Word-level timestamps are the source of truth for every
downstream cut decision.
"""

from __future__ import annotations

from typing import Optional

from ..asr import Transcriber, get_transcriber
from ..storage import Storage, read_json, write_json

AUDIO_NAME = "audio.wav"
ARTIFACT = "transcript.json"


def run(
    job_id: str,
    storage: Storage,
    transcriber: Optional[Transcriber] = None,
    *,
    force: bool = False,
) -> dict:
    if storage.exists(job_id, ARTIFACT) and not force:
        return read_json(storage, job_id, ARTIFACT)

    if not storage.exists(job_id, AUDIO_NAME):
        raise FileNotFoundError(
            f"{AUDIO_NAME} missing for job {job_id!r}; run ingest first"
        )

    transcriber = transcriber or get_transcriber()
    transcript = transcriber.transcribe(storage.path(job_id, AUDIO_NAME))
    write_json(storage, transcript, job_id, ARTIFACT)
    return transcript
