"""Env-driven settings + system-binary verification.

All tunables live here so the pipeline stages stay free of magic numbers.
Settings are read from the environment (prefix ``CLIPPER_``) and an optional
``.env`` file. ``ANTHROPIC_API_KEY`` is read without the prefix so the Anthropic
SDK and this config agree on one variable.
"""

from __future__ import annotations

import shutil
import subprocess
from functools import lru_cache
from typing import Optional, Sequence

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CLIPPER_", env_file=(".env", "clipper/.env"), extra="ignore"
    )

    # --- storage -----------------------------------------------------------
    storage_backend: str = "local"          # local | s3 (s3 = future)
    storage_root: str = "storage"

    # --- database ----------------------------------------------------------
    database_url: str = "sqlite:///clipper.db"

    # --- ASR (transcription) ----------------------------------------------
    asr_backend: str = "faster_whisper"     # faster_whisper | openai
    asr_model: str = "small"                # cpu-friendly default; large-v3 for prod
    asr_device: str = "cpu"
    asr_compute_type: str = "int8"          # int8 keeps CPU memory/time bounded
    asr_language: Optional[str] = None      # None = autodetect
    asr_beam_size: int = 5

    # --- LLM (Anthropic) ---------------------------------------------------
    # Read ANTHROPIC_API_KEY (SDK convention) or CLIPPER_ANTHROPIC_API_KEY.
    anthropic_api_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("ANTHROPIC_API_KEY", "CLIPPER_ANTHROPIC_API_KEY"),
    )
    llm_model: str = "claude-opus-4-8"
    llm_max_tokens: int = 8000
    llm_effort: str = "high"                # low | medium | high | xhigh | max

    # --- segmentation (LLM moment-finding) --------------------------------
    segment_chunk_size: int = 120           # sentences per LLM chunk
    segment_chunk_overlap: int = 15         # overlap so cross-edge moments survive

    # --- boundaries (the crux) --------------------------------------------
    pad_lead_in: float = 0.25               # seconds added before a clip
    pad_tail: float = 0.35                  # seconds added after a clip
    target_min_sec: float = 15.0
    target_max_sec: float = 90.0
    drop_below_sec: float = 8.0             # drop clips shorter than this after padding
    sentence_gap_sec: float = 0.6           # word gap implying a sentence break
    snap_window_sec: float = 0.8            # search window for a pause near an edge
    dedup_overlap: float = 0.5              # >this fractional overlap => de-dup

    # --- render ------------------------------------------------------------
    vertical: bool = False                  # 9:16 reformat
    burn_captions: bool = True
    video_crf: int = 20
    video_preset: str = "veryfast"
    yt_max_height: int = 1080

    # --- ops ---------------------------------------------------------------
    skip_binary_check: bool = False         # CLIPPER_SKIP_BINARY_CHECK=1 for tests


# Binaries the pipeline shells out to, with the flag that prints their version.
_BINARY_VERSION_FLAG = {
    "ffmpeg": "-version",
    "ffprobe": "-version",
    "yt-dlp": "--version",
}


def assert_binaries(required: Sequence[str] = ("ffmpeg", "ffprobe", "yt-dlp")) -> None:
    """Raise loudly if any required system binary is missing or not runnable."""
    missing = []
    for name in required:
        path = shutil.which(name)
        if path is None:
            missing.append(name)
            continue
        try:
            subprocess.run(
                [path, _BINARY_VERSION_FLAG[name]],
                capture_output=True,
                check=True,
            )
        except (subprocess.SubprocessError, OSError):
            missing.append(name)
    if missing:
        raise RuntimeError(
            "Required binaries missing or not runnable: "
            + ", ".join(missing)
            + ". Install them and ensure they are on PATH "
            "(macOS: `brew install ffmpeg yt-dlp`). "
            "Set CLIPPER_SKIP_BINARY_CHECK=1 to bypass (e.g. for unit tests)."
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def _bootstrap_binaries() -> None:
    """Make venv-local tools discoverable before the check runs.

    Adds the venv's bin dir to PATH (so a pip-installed ``yt-dlp`` console
    script is found) and, if ``static-ffmpeg`` is installed, registers its
    bundled ffmpeg/ffprobe. ``weak=True`` defers to a real ffmpeg already on
    PATH, so this is a no-op on machines with a system install.
    """
    import os
    import sys

    venv_bin = os.path.dirname(sys.executable)
    if venv_bin not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = venv_bin + os.pathsep + os.environ.get("PATH", "")
    try:
        import static_ffmpeg

        static_ffmpeg.add_paths(weak=True)
    except Exception:
        pass


# Per the stage spec: verify binaries at import time and raise loud if missing,
# unless explicitly skipped (tests / DB-only work don't need ffmpeg).
if not get_settings().skip_binary_check:
    _bootstrap_binaries()
    assert_binaries()
