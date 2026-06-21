"""On-demand export (render.export_clip) — cuts a window from a source video into
a standalone mobile-ready mp4 (no captions). Not part of the pipeline."""

from __future__ import annotations

import shutil

import pytest

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe not available",
)


def _make_clip(path, seconds=4):
    from clipper import ffmpeg

    ffmpeg.run_ffmpeg([
        "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=640x360:rate=15",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
        "-c:v", "libx264", "-c:a", "aac", "-shortest", str(path),
    ])


def test_export_clip_horizontal(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_VERTICAL", "false")
    import clipper.config as config

    config.get_settings.cache_clear()
    from clipper import ffmpeg
    from clipper.pipeline.render import export_clip

    src = tmp_path / "src.mp4"
    _make_clip(src)
    out = tmp_path / "clip.mp4"
    export_clip(str(src), 0.5, 2.5, str(out))

    info = ffmpeg.ffprobe_json(str(out))
    vstream = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert vstream["pix_fmt"] == "yuv420p"
    assert 1.7 < float(info["format"]["duration"]) < 2.3   # ~2.0s window


def test_export_clip_vertical_is_1080x1920(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_VERTICAL", "true")
    import clipper.config as config

    config.get_settings.cache_clear()
    from clipper import ffmpeg
    from clipper.pipeline.render import export_clip

    src = tmp_path / "src.mp4"
    _make_clip(src)
    out = tmp_path / "clip_v.mp4"
    export_clip(str(src), 0.5, 2.5, str(out))

    info = ffmpeg.ffprobe_json(str(out))
    vstream = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (vstream["width"], vstream["height"]) == (1080, 1920)
