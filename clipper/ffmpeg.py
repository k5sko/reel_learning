"""Thin wrappers around the ffmpeg / ffprobe binaries.

Centralized so ingest and render don't each hand-roll subprocess calls. All
invocations raise ``FFmpegError`` with the tail of stderr on failure.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from typing import List, Optional


class FFmpegError(RuntimeError):
    pass


def _bin(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise FFmpegError(f"{name} not found on PATH")
    return path


def run_ffmpeg(args: List[str], cwd: Optional[str] = None) -> None:
    cmd = [_bin("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", *args]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if proc.returncode != 0:
        raise FFmpegError(
            "ffmpeg failed (" + " ".join(args[:6]) + " ...):\n" + proc.stderr[-2000:]
        )


def has_filter(name: str) -> bool:
    try:
        out = subprocess.run(
            [_bin("ffmpeg"), "-hide_banner", "-filters"],
            capture_output=True, text=True,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return False
    return any(line.split()[1:2] == [name] for line in out.splitlines() if line.strip())


def ffprobe_json(path: str) -> dict:
    cmd = [
        _bin("ffprobe"), "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise FFmpegError("ffprobe failed: " + proc.stderr[-2000:])
    return json.loads(proc.stdout or "{}")


def probe_duration(path: str) -> float:
    data = ffprobe_json(path)
    dur = data.get("format", {}).get("duration")
    if dur is None:
        for s in data.get("streams", []):
            if s.get("duration"):
                dur = s["duration"]
                break
    return float(dur) if dur is not None else 0.0


def extract_audio(video_path: str, audio_path: str, sample_rate: int = 16000) -> None:
    """Extract mono PCM WAV at ``sample_rate`` (16kHz for ASR)."""
    run_ffmpeg([
        "-i", video_path, "-vn", "-ac", "1", "-ar", str(sample_rate),
        "-c:a", "pcm_s16le", audio_path,
    ])
