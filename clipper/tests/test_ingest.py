"""Phase 1 — Ingest E2E (upload path) using a synthetic clip from ffmpeg.

The YouTube path needs network and is exercised by a live test guarded behind
CLIPPER_LIVE_YT_TEST; this covers the deterministic upload + audio-extraction
+ resumability behavior.
"""

from __future__ import annotations

import os
import shutil

import pytest

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe not available",
)


def _make_clip(path, seconds=2):
    from clipper import ffmpeg

    ffmpeg.run_ffmpeg([
        "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=320x240:rate=15",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
        "-c:v", "libx264", "-c:a", "aac", "-shortest", str(path),
    ])


def test_ingest_upload(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_STORAGE_ROOT", str(tmp_path / "store"))
    import clipper.config as config

    config.get_settings.cache_clear()
    from clipper import ffmpeg
    from clipper.pipeline import ingest
    from clipper.storage import LocalStorage

    src = tmp_path / "input.mp4"
    _make_clip(src)

    st = LocalStorage()
    art = ingest.run("job1", "upload", str(src), st)

    assert st.exists("job1", "video.mp4")
    assert st.exists("job1", "audio.wav")
    assert st.exists("job1", "ingest.json")
    assert 1.5 < art["duration"] < 2.6

    info = ffmpeg.ffprobe_json(st.path("job1", "audio.wav"))
    astream = next(s for s in info["streams"] if s["codec_type"] == "audio")
    assert astream["sample_rate"] == "16000"
    assert astream["channels"] == 1

    # original upload is preserved; output is a real, faststart mp4
    assert src.exists()

    # resumable: a second run returns the cached artifact unchanged
    art2 = ingest.run("job1", "upload", str(src), st)
    assert art2 == art


@pytest.mark.skipif(
    not os.environ.get("CLIPPER_LIVE_YT_TEST"),
    reason="set CLIPPER_LIVE_YT_TEST=1 (and optionally CLIPPER_LIVE_YT_URL) to run the live YouTube path",
)
def test_ingest_youtube_live(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_STORAGE_ROOT", str(tmp_path / "store"))
    import clipper.config as config

    config.get_settings.cache_clear()
    from clipper import ffmpeg
    from clipper.pipeline import ingest
    from clipper.storage import LocalStorage

    url = os.environ.get("CLIPPER_LIVE_YT_URL", "https://www.youtube.com/watch?v=aqz-KE-bpKQ")
    st = LocalStorage()
    art = ingest.run("ytjob", "youtube", url, st)
    assert st.exists("ytjob", "video.mp4")
    assert st.exists("ytjob", "audio.wav")
    assert art["duration"] > 1.0
    info = ffmpeg.ffprobe_json(st.path("ytjob", "audio.wav"))
    astream = next(s for s in info["streams"] if s["codec_type"] == "audio")
    assert astream["sample_rate"] == "16000" and astream["channels"] == 1
