"""On-demand clip export — NOT part of the default pipeline.

Clips are virtual: a start/end window over the job's source video, played
directly in the client (no per-clip file, no eager re-encode). Use
``export_clip`` only when a standalone .mp4 is genuinely needed — e.g. a
"download / share this reel" action. Accurate cut + re-encode, no captions.
"""

from __future__ import annotations

import os
from typing import Optional

from .. import ffmpeg
from ..config import Settings, get_settings

_KEYFRAME_PRE = 2.0
_VERTICAL_FC = (
    "[0:v]split=2[bg][fg];"
    "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
    "crop=1080:1920,boxblur=20:2[bgb];"
    "[fg]scale=1080:1920:force_original_aspect_ratio=decrease[fgs];"
    "[bgb][fgs]overlay=(W-w)/2:(H-h)/2[ov]"
)


def export_clip(
    source_video: str,
    start: float,
    end: float,
    out_path: str,
    settings: Optional[Settings] = None,
) -> str:
    """Cut [start, end] from source_video into a standalone mp4 (mobile-ready)."""
    settings = settings or get_settings()
    dur = max(0.05, float(end) - float(start))
    kf = max(0.0, float(start) - _KEYFRAME_PRE)
    fine = float(start) - kf

    args = ["-ss", f"{kf:.3f}", "-i", source_video, "-ss", f"{fine:.3f}", "-t", f"{dur:.3f}"]
    if settings.vertical:
        args += ["-filter_complex", _VERTICAL_FC, "-map", "[ov]", "-map", "0:a?"]
    args += [
        "-c:v", "libx264", "-preset", settings.video_preset, "-crf", str(settings.video_crf),
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", out_path,
    ]
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    ffmpeg.run_ffmpeg(args)
    return out_path
