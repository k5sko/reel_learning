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
from . import boundaries, ingest, label, render, segment, sentences, transcribe

STAGES = ("ingest", "transcribe", "sentences", "segment", "boundaries", "render", "label")


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


async def run_pipeline(
    job_id: str,
    *,
    storage: Optional[Storage] = None,
    llm: Optional[LLMClient] = None,
    force: Optional[Set[str]] = None,
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

    try:
        await step(JobStatus.INGESTING,
                   lambda: ingest.run(job_id, source, source_ref, storage, force="ingest" in force))
        await step(JobStatus.TRANSCRIBING,
                   lambda: transcribe.run(job_id, storage, force="transcribe" in force))
        await step(JobStatus.SEGMENTING,
                   lambda: sentences.run(job_id, storage, force="sentences" in force))
        await step(JobStatus.SEGMENTING,
                   lambda: segment.run(job_id, storage, llm, force="segment" in force))
        await step(JobStatus.RENDERING,
                   lambda: boundaries.run(job_id, storage, force="boundaries" in force))
        await step(JobStatus.RENDERING,
                   lambda: render.run(job_id, storage, force="render" in force))
        records = await step(JobStatus.LABELING,
                             lambda: label.run(job_id, storage, llm, force="label" in force))
        _set_status(job_id, JobStatus.DONE)
        return records
    except Exception as e:  # mark the job failed, then re-raise for the caller
        _set_status(job_id, JobStatus.ERROR, error=repr(e))
        raise


def process(source_ref: str, **kwargs) -> str:
    """Convenience sync entrypoint: create a job and run it to completion."""
    job_id = create_job(source_ref)
    asyncio.run(run_pipeline(job_id, **kwargs))
    return job_id
