"""Pipeline orchestration.

Plain async functions for now, structured so each stage can become a Celery task
later without rewrites: every stage is independently callable, reads cached
upstream artifacts, and is side-effect-scoped to the job dir + DB. Stages run in
a worker thread so the event loop isn't blocked by ffmpeg / model work.

Resumability is automatic (each stage skips when its artifact exists); pass
``force={"segment", "boundaries"}`` to recompute specific stages while reusing
the expensive upstream ones (e.g. transcript).
"""

from __future__ import annotations

import asyncio
import uuid
from typing import List, Optional, Set

from ..db import Job, JobStatus, init_db, session_scope, utcnow
from ..llm import LLMClient
from ..storage import Storage, get_storage
from . import boundaries, ingest, label, segment, sentences, transcribe

# Clips are virtual (start/end over the source video) and played in the client,
# so there is no eager render stage — rendering a standalone file is on-demand
# only (see render.export_clip).
STAGES = ("ingest", "transcribe", "sentences", "segment", "boundaries", "label")


def _is_url(ref: str) -> bool:
    return ref.startswith("http://") or ref.startswith("https://")


def create_job(source_ref: str, source: Optional[str] = None) -> str:
    init_db()
    job_id = "job_" + uuid.uuid4().hex[:12]
    src = source or ("youtube" if _is_url(source_ref) else "upload")
    with session_scope() as s:
        s.add(Job(id=job_id, source=src, source_ref=source_ref, status=JobStatus.QUEUED))
        s.commit()
    return job_id


def _set_status(job_id: str, status: str, error: Optional[str] = None) -> None:
    with session_scope() as s:
        job = s.get(Job, job_id)
        if job:
            job.status = status
            job.error = error
            job.updated_at = utcnow()
            s.add(job)
            s.commit()


# Failures that retrying can't fix — don't waste attempts on them.
_PERMANENT_HINTS = (
    "unavailable", "private video", "members-only", "age-restricted",
    "sign in to confirm", "removed", "413", "too large",
    "request entity too large", "no such file", "is not a valid",
)


def _retryable(err: Exception) -> bool:
    """Transient failures (network/connection/rate/Groq hiccups) are worth a
    retry; clearly-permanent ones (video unavailable, file too large) are not."""
    msg = repr(err).lower()
    return not any(h in msg for h in _PERMANENT_HINTS)


async def run_pipeline(
    job_id: str,
    *,
    storage: Optional[Storage] = None,
    llm: Optional[LLMClient] = None,
    force: Optional[Set[str]] = None,
    max_attempts: int = 3,
) -> List[dict]:
    storage = storage or get_storage()
    llm = llm or LLMClient()
    force = force or set()

    with session_scope() as s:
        job = s.get(Job, job_id)
        if job is None:
            raise ValueError(f"Unknown job: {job_id!r}")
        source, source_ref = job.source, job.source_ref

    async def step(status: str, fn):
        _set_status(job_id, status)
        return await asyncio.to_thread(fn)

    # Retry transient failures (network/Groq/Anthropic hiccups). Completed stages
    # are cached and skipped, and label uses upsert-by-id, so a retry safely
    # resumes from the failed stage. Status only becomes ERROR after the final
    # attempt, so the job never flashes "failed" mid-retry.
    for attempt in range(1, max_attempts + 1):
        try:
            await step(JobStatus.INGESTING,
                       lambda: ingest.run(job_id, source, source_ref, storage, force="ingest" in force))
            await step(JobStatus.TRANSCRIBING,
                       lambda: transcribe.run(job_id, storage, force="transcribe" in force))
            await step(JobStatus.SEGMENTING,
                       lambda: sentences.run(job_id, storage, force="sentences" in force))
            await step(JobStatus.SEGMENTING,
                       lambda: segment.run(job_id, storage, llm, force="segment" in force))
            await step(JobStatus.SEGMENTING,
                       lambda: boundaries.run(job_id, storage, force="boundaries" in force))
            records = await step(JobStatus.LABELING,
                                 lambda: label.run(job_id, storage, llm, force="label" in force))
            _set_status(job_id, JobStatus.DONE)
            return records
        except Exception as e:
            if attempt < max_attempts and _retryable(e):
                await asyncio.sleep(min(2 ** attempt, 8))  # brief backoff, then resume
                continue
            _set_status(job_id, JobStatus.ERROR, error=repr(e))
            raise


def process(source_ref: str, **kwargs) -> str:
    """Convenience sync entrypoint: create a job and run it to completion."""
    job_id = create_job(source_ref)
    asyncio.run(run_pipeline(job_id, **kwargs))
    return job_id
