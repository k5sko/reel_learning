"""Phase 6 — Render: ffmpeg cut + optional 9:16 reformat + burned captions.

- Accurate cut: a fast input seek to a keyframe ~2s before the start, then a
  frame-accurate output seek for the remainder, re-encoded (libx264 + aac).
- Mobile-ready: yuv420p pixel format + faststart moov atom.
- Optional 9:16: scale + center-crop the foreground over a blurred fill so wide
  shots aren't pillarboxed with black bars.
- Captions: an SRT built from the clip's words re-based to t=0, burned with the
  subtitles filter. If the ffmpeg build can't burn subtitles, the clip is still
  produced without captions (logged), never failed.

Output: storage/<job_id>/clips/<id>.mp4
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional

from .. import ffmpeg
from ..config import Settings, get_settings
from ..storage import Storage, read_json, write_json

BOUNDARIES = "boundaries.json"
TRANSCRIPT = "transcript.json"
VIDEO = "video.mp4"
ARTIFACT = "render.json"

_KEYFRAME_PRE = 2.0
_STYLE = "Fontsize=18,Outline=1,Shadow=0,MarginV=40"
_VERTICAL_FC = (
    "[0:v]split=2[bg][fg];"
    "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
    "crop=1080:1920,boxblur=20:2[bgb];"
    "[fg]scale=1080:1920:force_original_aspect_ratio=decrease[fgs];"
    "[bgb][fgs]overlay=(W-w)/2:(H-h)/2[ov]"
)


def _words_with_text(transcript: dict) -> List[dict]:
    out = []
    for seg in transcript.get("segments", []):
        for w in seg.get("words", []):
            if w.get("start") is None or w.get("end") is None:
                continue
            out.append({"start": float(w["start"]), "end": float(w["end"]), "word": w["word"]})
    out.sort(key=lambda w: w["start"])
    return out


def _ts(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _build_srt(clip_words: List[dict], clip_start: float, max_words: int = 7, max_gap: float = 0.8) -> str:
    groups: List[List[dict]] = []
    cur: List[dict] = []
    for w in clip_words:
        if cur and (len(cur) >= max_words or (w["start"] - cur[-1]["end"]) > max_gap):
            groups.append(cur)
            cur = []
        cur.append(w)
    if cur:
        groups.append(cur)

    blocks = []
    for i, g in enumerate(groups, 1):
        s = max(0.0, g[0]["start"] - clip_start)
        e = max(s + 0.1, g[-1]["end"] - clip_start)
        text = " ".join(w["word"].strip() for w in g).strip()
        blocks.append(f"{i}\n{_ts(s)} --> {_ts(e)}\n{text}\n")
    return "\n".join(blocks)


def _clip_words(words: List[dict], start: float, end: float) -> List[dict]:
    return [w for w in words if w["start"] >= start - 1e-3 and w["end"] <= end + 1e-3]


def _render_one(
    video_path: str,
    clips_dir: str,
    spec: dict,
    words: List[dict],
    settings: Settings,
    with_captions: bool,
) -> bool:
    cid = spec["id"]
    out_name = f"{cid}.mp4"
    srt_name = f"{cid}.srt"
    start = float(spec["start"])
    end = float(spec["end"])
    dur = max(0.05, end - start)

    cw = _clip_words(words, start, end)
    captions = with_captions and bool(cw)
    if captions:
        Path(clips_dir, srt_name).write_text(_build_srt(cw, start), encoding="utf-8")

    kf = max(0.0, start - _KEYFRAME_PRE)
    fine = start - kf
    args = ["-ss", f"{kf:.3f}", "-i", video_path, "-ss", f"{fine:.3f}", "-t", f"{dur:.3f}"]

    if settings.vertical:
        fc = _VERTICAL_FC
        if captions:
            fc += f";[ov]subtitles={srt_name}:force_style='{_STYLE}'[v]"
            vlabel = "[v]"
        else:
            vlabel = "[ov]"
        args += ["-filter_complex", fc, "-map", vlabel, "-map", "0:a?"]
    elif captions:
        args += ["-vf", f"subtitles={srt_name}:force_style='{_STYLE}'"]

    args += [
        "-c:v", "libx264", "-preset", settings.video_preset, "-crf", str(settings.video_crf),
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", out_name,
    ]
    ffmpeg.run_ffmpeg(args, cwd=clips_dir)
    return captions


def run(job_id: str, storage: Storage, *, force: bool = False) -> List[dict]:
    for required in (BOUNDARIES, TRANSCRIPT, VIDEO):
        if not storage.exists(job_id, required):
            raise FileNotFoundError(
                f"{required} missing for job {job_id!r}; run the prior stages first"
            )
    specs = read_json(storage, job_id, BOUNDARIES)
    transcript = read_json(storage, job_id, TRANSCRIPT)
    words = _words_with_text(transcript)
    video_path = storage.path(job_id, VIDEO)
    clips_dir = storage.path(job_id, "clips")
    os.makedirs(clips_dir, exist_ok=True)
    settings = get_settings()

    rendered: List[dict] = []
    for spec in specs:
        cid = spec["id"]
        file_path = storage.path(job_id, "clips", f"{cid}.mp4")
        out = dict(spec)
        out["file_path"] = file_path

        if storage.exists(job_id, "clips", f"{cid}.mp4") and not force:
            out["captions"] = None  # unknown (cached)
            rendered.append(out)
            continue

        try:
            captions = _render_one(video_path, clips_dir, spec, words, settings, settings.burn_captions)
        except ffmpeg.FFmpegError:
            if not settings.burn_captions:
                raise
            # caption burn failed (e.g. no libass) — produce the clip without captions
            captions = _render_one(video_path, clips_dir, spec, words, settings, with_captions=False)
        out["captions"] = captions
        rendered.append(out)

    write_json(storage, rendered, job_id, ARTIFACT)
    return rendered
