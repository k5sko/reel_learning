"""Phase 1 — Ingest: URL or MP4 -> normalized video.mp4 + 16kHz mono audio.wav.

- YouTube: yt-dlp downloads a progressive MP4 (capped at CLIPPER_YT_MAX_HEIGHT),
  and best-effort fetches auto-subs alongside (signal only, not used for cut timing).
- Upload: an existing MP4 path is copied/normalized into the job dir.
- Always extracts a 16kHz mono WAV for the ASR stage.

Resumable: if ingest.json + video.mp4 + audio.wav already exist, returns the
cached artifact unless ``force=True``.
"""

from __future__ import annotations

import glob
import os
from typing import Optional

from .. import ffmpeg
from ..config import get_settings
from ..storage import Storage, read_json, write_json

VIDEO_NAME = "video.mp4"
AUDIO_NAME = "audio.wav"
ARTIFACT = "ingest.json"


def run(
    job_id: str,
    source: str,
    source_ref: str,
    storage: Storage,
    *,
    force: bool = False,
) -> dict:
    have_all = (
        storage.exists(job_id, ARTIFACT)
        and storage.exists(job_id, VIDEO_NAME)
        and storage.exists(job_id, AUDIO_NAME)
    )
    if have_all and not force:
        return read_json(storage, job_id, ARTIFACT)

    storage.job_dir(job_id)
    video_path = storage.path(job_id, VIDEO_NAME)
    audio_path = storage.path(job_id, AUDIO_NAME)

    title: Optional[str] = None
    auto_subs: Optional[str] = None
    # video-level metadata for the recommender: channel -> P(fit), like:view -> P(good).
    channel: Optional[str] = None
    views: Optional[int] = None
    likes: Optional[int] = None
    webpage_url: Optional[str] = None

    if source == "youtube":
        info = _download_youtube(source_ref, video_path, storage, job_id)
        title = info.get("title")
        auto_subs = info.get("auto_subs")
        channel = info.get("channel")
        views = info.get("views")
        likes = info.get("likes")
        webpage_url = info.get("webpage_url")
    elif source == "upload":
        _place_as_mp4(source_ref, video_path, keep_source=True)
        title = os.path.basename(source_ref)
    else:
        raise ValueError(f"Unknown source: {source!r} (expected 'youtube' or 'upload')")

    ffmpeg.extract_audio(video_path, audio_path)
    duration = ffmpeg.probe_duration(video_path)

    artifact = {
        "job_id": job_id,
        "source": source,
        "source_ref": source_ref,
        "title": title,
        "video": VIDEO_NAME,
        "audio": AUDIO_NAME,
        "duration": duration,
        "auto_subs": auto_subs,
        # recommender signals (None for uploads / when YouTube omits them)
        "channel": channel,
        "views": views,
        "likes": likes,
        "webpage_url": webpage_url,
    }
    write_json(storage, artifact, job_id, ARTIFACT)
    return artifact


def _download_youtube(url: str, video_path: str, storage: Storage, job_id: str) -> dict:
    import yt_dlp

    settings = get_settings()
    max_h = settings.yt_max_height
    out_tmpl = storage.path(job_id, "_src.%(ext)s")
    opts = {
        "format": (
            f"best[ext=mp4][height<={max_h}]"
            f"/bestvideo[height<={max_h}]+bestaudio"
            f"/best[height<={max_h}]/best"
        ),
        "merge_output_format": "mp4",
        # The default 'web' client increasingly serves DASH streams that 403 on
        # media download without a PO token; android/ios expose directly
        # downloadable formats. Fall back to web last.
        "extractor_args": {"youtube": {"player_client": ["android", "ios", "web"]}},
        "outtmpl": {"default": out_tmpl},
        "writeautomaticsub": True,
        "writesubtitles": False,
        "subtitleslangs": ["en", "en-US", "en-orig"],
        "subtitlesformat": "vtt",
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "retries": 3,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)

    downloaded = None
    for rd in info.get("requested_downloads") or []:
        if rd.get("filepath"):
            downloaded = rd["filepath"]
            break
    if not downloaded:
        cands = [
            p for p in glob.glob(storage.path(job_id, "_src.*"))
            if not p.endswith((".vtt", ".srt", ".json"))
        ]
        downloaded = cands[0] if cands else None
    if not downloaded or not os.path.exists(downloaded):
        raise RuntimeError("yt-dlp did not produce a media file")

    _place_as_mp4(downloaded, video_path, keep_source=False)

    auto_subs = None
    subs = sorted(glob.glob(storage.path(job_id, "_src*.vtt")))
    if subs:
        dest = storage.path(job_id, "autosub.en.vtt")
        os.replace(subs[0], dest)
        auto_subs = "autosub.en.vtt"
        for extra in subs[1:]:
            try:
                os.remove(extra)
            except OSError:
                pass

    return {
        "title": info.get("title"),
        "auto_subs": auto_subs,
        # yt-dlp exposes these on the info dict; clipper previously discarded them.
        "channel": info.get("channel") or info.get("uploader"),
        "views": info.get("view_count"),
        "likes": info.get("like_count"),
        "webpage_url": info.get("webpage_url"),
    }


def _place_as_mp4(src: str, dest: str, *, keep_source: bool) -> None:
    """Normalize ``src`` into an mp4 at ``dest`` with a streamable moov atom.

    Tries a stream copy first (fast, just re-containers); falls back to a
    re-encode for inputs whose codecs aren't mp4-compatible.
    """
    if not os.path.exists(src):
        raise FileNotFoundError(f"Input not found: {src}")
    settings = get_settings()
    try:
        ffmpeg.run_ffmpeg(["-i", src, "-c", "copy", "-movflags", "+faststart", dest])
    except ffmpeg.FFmpegError:
        ffmpeg.run_ffmpeg([
            "-i", src,
            "-c:v", "libx264", "-preset", settings.video_preset,
            "-crf", str(settings.video_crf), "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-movflags", "+faststart", dest,
        ])
    if not keep_source and os.path.abspath(src) != os.path.abspath(dest):
        try:
            os.remove(src)
        except OSError:
            pass
