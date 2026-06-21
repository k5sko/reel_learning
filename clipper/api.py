"""HTTP API bridging the clipper pipeline to the frontend.

Endpoints:
  GET  /api/clips                 -> ready clips (metadata) ranked by score
  GET  /api/clips/{id}/video      -> stream the rendered .mp4 (range-enabled)
  POST /api/jobs {url}            -> start a pipeline job for a YouTube URL / path
  GET  /api/jobs/{id}            -> job status (+ ready clip count)

Run:  .venv/bin/uvicorn clipper.api:app --port 8000   (from the project root)

This is the thin client-facing layer; the heavy work stays in the pipeline.
The frontend reads clip metadata from here and streams the clip files; it never
touches the source video.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import select

from .db import Clip, ClipStatus, Job, init_db, session_scope
from .pipeline import orchestrator
from .storage import get_storage, read_json


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Clipper API", lifespan=lifespan)

# Allow the Vite dev origin for direct calls; the dev proxy makes this moot but
# it keeps standalone use working.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _channel_for(job: Job, storage, cache: dict) -> str:
    if job.id in cache:
        return cache[job.id]
    label = "YouTube" if job.source == "youtube" else "Upload"
    try:
        art = read_json(storage, job.id, "ingest.json")
        if art.get("title"):
            label = art["title"]
    except Exception:
        pass
    cache[job.id] = label
    return label


def _shape(clip: Clip, channel: str) -> dict:
    tags = clip.tag_list()
    return {
        "id": clip.id,
        "title": clip.title,
        "hook": clip.hook,
        "summary": clip.summary,
        "tags": tags,
        "score": clip.score,
        "duration": clip.duration,
        "start": clip.start,
        "end": clip.end,
        "job_id": clip.job_id,
        "channel": channel,
        "subject": tags[0] if tags else "Clip",
        "video_url": f"/api/clips/{clip.id}/video",
        "status": clip.status,
    }


@app.get("/api/clips")
def list_clips():
    storage = get_storage()
    cache: dict = {}
    with session_scope() as s:
        clips = s.exec(select(Clip).where(Clip.status == ClipStatus.READY)).all()
        jobs = {j.id: j for j in s.exec(select(Job)).all()}
        clips = sorted(clips, key=lambda c: c.score, reverse=True)
        out = []
        for c in clips:
            job = jobs.get(c.job_id)
            channel = _channel_for(job, storage, cache) if job else "Clip"
            out.append(_shape(c, channel))
    return {"clips": out}


@app.get("/api/clips/{clip_id}/video")
def clip_video(clip_id: str):
    with session_scope() as s:
        clip = s.get(Clip, clip_id)
        if clip is None:
            raise HTTPException(404, "clip not found")
        path = clip.file_path
    if not path or not os.path.exists(path):
        raise HTTPException(404, "clip video file missing")
    return FileResponse(path, media_type="video/mp4", filename=f"{clip_id}.mp4")


class JobIn(BaseModel):
    url: str


async def _run_job(job_id: str) -> None:
    try:
        await orchestrator.run_pipeline(job_id)
    except Exception:
        # run_pipeline already recorded status=error + Job.error
        pass


@app.post("/api/jobs")
async def create_job(body: JobIn):
    url = (body.url or "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    job_id = orchestrator.create_job(url)
    asyncio.create_task(_run_job(job_id))
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    with session_scope() as s:
        job = s.get(Job, job_id)
        if job is None:
            raise HTTPException(404, "job not found")
        n_ready = len(
            s.exec(
                select(Clip).where(Clip.job_id == job_id, Clip.status == ClipStatus.READY)
            ).all()
        )
        return {
            "job_id": job.id,
            "status": job.status,
            "error": job.error,
            "source": job.source,
            "source_ref": job.source_ref,
            "clips": n_ready,
        }
