"""Phase 6 — Render E2E using a synthetic clip + fake transcript. Verifies the
cut duration, mobile pixel format, 9:16 reformat, and render caching."""

from __future__ import annotations

import shutil

import pytest

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe not available",
)


def _setup_job(tmp_path, monkeypatch, vertical=False):
    monkeypatch.setenv("CLIPPER_STORAGE_ROOT", str(tmp_path / "store"))
    monkeypatch.setenv("CLIPPER_VERTICAL", "true" if vertical else "false")
    import clipper.config as config

    config.get_settings.cache_clear()
    from clipper import ffmpeg
    from clipper.storage import LocalStorage, write_json

    st = LocalStorage()
    st.job_dir("j")
    ffmpeg.run_ffmpeg([
        "-f", "lavfi", "-i", "testsrc=duration=4:size=640x360:rate=15",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
        "-c:v", "libx264", "-c:a", "aac", "-shortest", st.path("j", "video.mp4"),
    ])
    transcript = {
        "language": "en", "duration": 4.0,
        "segments": [{"id": 0, "start": 0.0, "end": 4.0, "text": "one two three four", "words": [
            {"word": "one", "start": 0.6, "end": 0.9},
            {"word": " two", "start": 1.0, "end": 1.3},
            {"word": " three", "start": 1.4, "end": 1.8},
            {"word": " four", "start": 1.9, "end": 2.3},
        ]}],
    }
    write_json(st, transcript, "j", "transcript.json")
    clips = [{"id": "c_01", "start": 0.5, "end": 2.5, "duration": 2.0,
              "start_sentence": 0, "end_sentence": 0, "reason": "r", "text": "one two three four"}]
    write_json(st, clips, "j", "boundaries.json")
    return st, ffmpeg


def test_render_horizontal_and_cache(tmp_path, monkeypatch):
    st, ffmpeg = _setup_job(tmp_path, monkeypatch, vertical=False)
    from clipper.pipeline import render

    out = render.run("j", st)
    assert len(out) == 1
    assert st.exists("j", "clips", "c_01.mp4")

    info = ffmpeg.ffprobe_json(st.path("j", "clips", "c_01.mp4"))
    vstream = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert vstream["pix_fmt"] == "yuv420p"
    assert 1.7 < float(info["format"]["duration"]) < 2.3   # cut ~2.0s
    assert any(s["codec_type"] == "audio" for s in info["streams"])

    # resumable: second run keeps the existing file (no re-encode)
    mtime = (tmp_path / "store" / "j" / "clips" / "c_01.mp4").stat().st_mtime
    render.run("j", st)
    assert (tmp_path / "store" / "j" / "clips" / "c_01.mp4").stat().st_mtime == mtime


def test_render_vertical_is_1080x1920(tmp_path, monkeypatch):
    st, ffmpeg = _setup_job(tmp_path, monkeypatch, vertical=True)
    from clipper.pipeline import render

    render.run("j", st)
    info = ffmpeg.ffprobe_json(st.path("j", "clips", "c_01.mp4"))
    vstream = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (vstream["width"], vstream["height"]) == (1080, 1920)
    assert vstream["pix_fmt"] == "yuv420p"
