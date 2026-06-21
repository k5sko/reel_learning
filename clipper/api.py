"""HTTP API bridging the clipper pipeline to the frontend.

Endpoints:
  GET  /api/clips                 -> ready clips (metadata, incl. start/end) ranked by score
  GET  /api/jobs/{id}/video       -> stream a job's source video (range-enabled)
  POST /api/jobs {url}            -> start a pipeline job for a YouTube URL / path
  POST /api/search {query}        -> topic → vetted-channel video → job
  POST /api/upload (file)         -> upload an MP4 → job
  GET  /api/jobs/{id}             -> job status (+ ready clip count)

Run:  .venv/bin/uvicorn clipper.api:app --port 8000   (from the project root)

Clips are virtual: each is a start/end window over its job's source video. The
client streams the source (range requests) and plays the window — no per-clip
file is rendered.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import select

from .config import get_settings
from .db import Clip, ClipStatus, Job, init_db, session_scope
from .finder import assess_specificity, find_video
from .llm import LLMClient
from .pipeline import orchestrator
from .questionnaire import generate_questions, plan_videos
from .storage import get_storage, read_json

# Cap how many videos clip concurrently. Virtual clips removed the ffmpeg render
# bottleneck, so the real limit is LLM API rate (each job's segment pass makes a
# handful of chunk calls that now also emit labels). 3 keeps peak Anthropic
# concurrency reasonable.
MAX_CONCURRENT_JOBS = 3
_job_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Clipper API", lifespan=lifespan)

# Allow any origin: the frontend now calls the clipper directly at <host>:8000,
# including from other devices on the LAN. Fine for local/hackathon use.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the recommender (recsys) router into this app — one uvicorn, one /api namespace.
# Optional: if recsys deps are missing the clipper API still serves.
try:
    from recsys.api import router as recsys_router

    app.include_router(recsys_router)
except Exception as _e:  # noqa: BLE001
    import logging

    logging.getLogger(__name__).warning("recsys router not mounted: %s", _e)


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
        # Virtual clip: play start→end of the source video (shared across the
        # job's clips, so the browser caches it). No per-clip file.
        "video_url": f"/api/jobs/{clip.job_id}/video",
        "status": clip.status,
    }


_INPUT_PRICE_PER_M = 3.0  # USD per 1M input tokens (Claude Sonnet 4.x)


@app.get("/api/stats")
def stats():
    """Comprehensive transcript-compression stats across all processed videos —
    powers the in-app badge and the judge-facing /stats view. Reads each job's
    compression.json record (real Claude token counts) + DB clip counts."""
    storage = get_storage()
    with session_scope() as s:
        jobs = list(s.exec(select(Job).order_by(Job.created_at.desc())).all())
        clip_counts: dict = {}
        for c in s.exec(select(Clip).where(Clip.status == ClipStatus.READY)).all():
            clip_counts[c.job_id] = clip_counts.get(c.job_id, 0) + 1

    orig = sent = saved = lines_b = lines_a = clips = 0
    reductions: list = []
    recent: list = []
    model = None
    for j in jobs:
        try:
            c = read_json(storage, j.id, "compression.json")
        except Exception:
            continue
        if not c:
            continue
        o = int(c.get("original_tokens", 0))
        st = int(c.get("sent_tokens", 0))
        if o <= 0:
            continue
        sv = int(c.get("saved_tokens", max(0, o - st)))
        orig += o
        sent += st
        saved += sv
        lines_b += int(c.get("lines_before", 0))
        lines_a += int(c.get("lines_after", 0))
        red = float(c.get("reduction", 0.0))
        reductions.append(red)
        model = model or c.get("model")
        nc = clip_counts.get(j.id, 0)
        clips += nc
        if len(recent) < 12:
            recent.append({
                "job_id": j.id,
                "source": (j.source_ref or "")[:64],
                "original_tokens": o,
                "sent_tokens": st,
                "saved_tokens": sv,
                "reduction_pct": round(red * 100, 1),
                "clips": nc,
            })

    nv = len(reductions)
    pct = lambda x: round(x * 100, 1)  # noqa: E731
    overall = (1 - sent / orig) if orig else 0.0
    avg_saved = (saved / nv) if nv else 0

    return {
        # --- flat keys (the in-app badge reads these) ---
        "jobs": nv,
        "saved_tokens": saved,
        "reduction": round(overall, 3),
        # --- rich detail (the /stats view) ---
        "enabled": get_settings().compress_segment,
        "technique": "extractive sentence pruning + compact metadata format (index-preserving)",
        "model": model or get_settings().llm_model,
        "videos_processed": nv,
        "clips_generated": clips,
        "tokens": {
            "original": orig,
            "sent": sent,
            "saved": saved,
            "reduction_pct": pct(overall),
        },
        "per_video": {
            "avg_saved_tokens": round(avg_saved),
            "avg_reduction_pct": round(sum(reductions) / nv * 100, 1) if nv else 0,
            "best_reduction_pct": pct(max(reductions)) if reductions else 0,
            "worst_reduction_pct": pct(min(reductions)) if reductions else 0,
        },
        "sentences": {
            "lines_before": lines_b,
            "lines_after": lines_a,
            "dropped_pct": round((1 - lines_a / lines_b) * 100, 1) if lines_b else 0,
        },
        "cost": {
            "input_price_per_1m_usd": _INPUT_PRICE_PER_M,
            "saved_usd": round(saved / 1e6 * _INPUT_PRICE_PER_M, 5),
            "saved_usd_per_1k_videos": round(avg_saved / 1e6 * _INPUT_PRICE_PER_M * 1_000, 3),
            "saved_usd_per_100k_videos": round(avg_saved / 1e6 * _INPUT_PRICE_PER_M * 100_000, 1),
        },
        "equivalents": {
            "words_saved": round(saved * 0.75),  # ~0.75 words/token
            "pages_saved": round(saved * 0.75 / 500, 1),  # ~500 words/page
        },
        "recent": recent,
    }


@app.get("/api/clips")
def list_clips(job_id: Optional[str] = None):
    """Ready clips ranked by score. Pass job_id to scope to one video's clips,
    or a comma-separated list of job ids to scope to a multi-video learning
    session (so a topic search shows only those videos, hiding the rest)."""
    storage = get_storage()
    cache: dict = {}
    with session_scope() as s:
        stmt = select(Clip).where(Clip.status == ClipStatus.READY)
        if job_id:
            ids = [x for x in job_id.split(",") if x]
            stmt = stmt.where(Clip.job_id.in_(ids)) if len(ids) > 1 else stmt.where(Clip.job_id == ids[0])
        clips = s.exec(stmt).all()
        jobs = {j.id: j for j in s.exec(select(Job)).all()}
        clips = sorted(clips, key=lambda c: c.score, reverse=True)
        out = []
        for c in clips:
            job = jobs.get(c.job_id)
            channel = _channel_for(job, storage, cache) if job else "Clip"
            out.append(_shape(c, channel))
    return {"clips": out}


@app.get("/api/jobs/{job_id}/video")
def job_video(job_id: str):
    """Stream a job's source video (range-enabled). All of that job's virtual
    clips play windows of this one file."""
    path = get_storage().path(job_id, "video.mp4")
    if not os.path.exists(path):
        raise HTTPException(404, "source video not found")
    return FileResponse(path, media_type="video/mp4", filename=f"{job_id}.mp4")


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


class SearchIn(BaseModel):
    query: str


@app.post("/api/search")
async def search_topic(body: SearchIn):
    """Topic → find a video on a vetted channel → start a clipping job.

    Returns needs_clarification (vague query) / not_found, or found + job_id.
    """
    q = (body.query or "").strip()
    if not q:
        raise HTTPException(400, "query is required")
    result = await asyncio.to_thread(find_video, q, LLMClient())
    if result.get("status") != "found":
        return result
    video = result["video"]
    job_id = orchestrator.create_job(video["url"])
    asyncio.create_task(_run_job(job_id))
    return {"status": "found", "job_id": job_id, "video": video, "reason": result.get("reason", "")}


# --- topic intake questionnaire -> multi-video learning plan ----------------


async def _run_job_capped(job_id: str) -> None:
    """Run a pipeline job behind the global concurrency cap."""
    async with _job_semaphore:
        await _run_job(job_id)


class QuestionnaireIn(BaseModel):
    topic: str


@app.post("/api/questionnaire")
async def questionnaire(body: QuestionnaireIn):
    """Topic -> a short flashcard quiz (LLM-generated, topic-specific), or a
    clarification prompt if the topic is too broad."""
    topic = (body.topic or "").strip()
    if not topic:
        raise HTTPException(400, "topic is required")
    return await asyncio.to_thread(generate_questions, topic, LLMClient())


@app.post("/api/check-topic")
async def check_topic(body: QuestionnaireIn):
    """Lightweight vagueness gate for one class box: is this topic specific
    enough to aim a search at? (specificity only — no quiz is generated). The
    multi-class landing page calls this per box and, when specific=false, shows
    the suggestions inline so the learner can sharpen it."""
    topic = (body.topic or "").strip()
    if not topic:
        raise HTTPException(400, "topic is required")
    spec = await asyncio.to_thread(assess_specificity, topic, LLMClient())
    return {
        "specific": bool(spec.get("specific")),
        "message": spec.get("message") or "",
        "suggestions": spec.get("suggestions") or [],
    }


class LearnIn(BaseModel):
    topic: str
    answers: dict = {}
    max_videos: int = 3


@app.post("/api/learn")
async def learn(body: LearnIn):
    """Questionnaire answers -> reason into several targeted search queries ->
    find a video for each (concurrently) -> kick off clipping jobs concurrently.
    Returns the started jobs so the client can poll them all."""
    topic = (body.topic or "").strip()
    if not topic:
        raise HTTPException(400, "topic is required")
    llm = LLMClient()

    # Per-class video budget: the multi-class flow asks for fewer videos each so
    # the total across classes stays sane behind the job-concurrency cap.
    max_videos = max(1, min(int(body.max_videos or 3), 5))
    plan = await asyncio.to_thread(plan_videos, topic, body.answers, llm, max_videos)
    queries = plan["queries"]

    # Find a video per query, concurrently.
    finds = await asyncio.gather(*[asyncio.to_thread(_find, q["query"], llm) for q in queries])

    jobs = []
    seen = set()
    for q, r in zip(queries, finds):
        if not r or r.get("status") != "found":
            continue
        video = r["video"]
        if video["id"] in seen:
            continue
        seen.add(video["id"])
        job_id = orchestrator.create_job(video["url"])
        asyncio.create_task(_run_job_capped(job_id))
        jobs.append({"job_id": job_id, "video": video, "query": q["query"], "why": q.get("why", "")})

    if not jobs:
        return {"status": "not_found", "message": f"Couldn't find videos for {topic!r} on the available channels."}
    return {"status": "started", "profile": plan["profile"], "jobs": jobs}


def _find(query: str, llm: LLMClient) -> dict:
    """find_video with the planner's already-specific queries (skip broad check)."""
    return find_video(query, llm, assume_specific=True)


@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """Accept an uploaded MP4 and start a clipping job for it."""
    uploads = os.path.join(get_settings().storage_root, "_uploads")
    os.makedirs(uploads, exist_ok=True)
    safe = os.path.basename(file.filename or "upload.mp4")
    dest = os.path.join(uploads, f"{uuid.uuid4().hex[:8]}_{safe}")
    with open(dest, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    job_id = orchestrator.create_job(dest, source="upload")
    asyncio.create_task(_run_job(job_id))
    return {"job_id": job_id, "status": "queued", "filename": safe}


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
