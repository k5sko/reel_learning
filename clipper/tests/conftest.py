"""Test config: don't hard-fail import when binaries are absent, but make the
bundled ffmpeg/ffprobe + venv console scripts discoverable so the
media-dependent tests can run (they skip themselves if a binary is still
missing). Must run before clipper.config does its import-time check."""

import os

os.environ.setdefault("CLIPPER_SKIP_BINARY_CHECK", "1")

try:
    import clipper.config as _config

    _config._bootstrap_binaries()
except Exception:
    pass
