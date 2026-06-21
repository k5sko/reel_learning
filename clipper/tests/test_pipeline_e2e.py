"""Capstone E2E: the real pipeline (ingest → transcribe → sentences → segment →
boundaries → render → label) on `say`-synthesized speech, with only the LLM
faked (no API key in CI). Proves an uploaded file becomes real clip .mp4 files
with DB records — done-criterion #2, minus the live LLM."""

from __future__ import annotations

import asyncio
import importlib.util
import shutil
import subprocess

import pytest

_HAVE_FW = importlib.util.find_spec("faster_whisper") is not None
_HAVE_SAY = shutil.which("say") is not None and shutil.which("ffmpeg") is not None

pytestmark = pytest.mark.skipif(
    not (_HAVE_FW and _HAVE_SAY), reason="faster-whisper or `say` unavailable"
)


class FakeLLM:
    """One moment spanning everything, then canned label metadata — selected by
    which schema the stage passes in."""

    def complete_json(self, prompt, schema, *, system=None, max_tokens=None):
        if "moments" in schema.get("properties", {}):
            return {"moments": [
                {"start_sentence": 0, "end_sentence": 999, "reason": "one complete idea"}
            ]}
        return {
            "title": "The Quick Brown Fox",
            "hook": "A sentence that uses every letter.",
            "summary": "A demo clip of synthesized speech.",
            "tags": ["demo", "test"],
            "score": 0.7,
        }


def test_full_pipeline_upload(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_STORAGE_ROOT", str(tmp_path / "store"))
    monkeypatch.setenv("CLIPPER_DATABASE_URL", f"sqlite:///{tmp_path / 'p.db'}")
    monkeypatch.setenv("CLIPPER_ASR_MODEL", "tiny")
    monkeypatch.setenv("CLIPPER_ASR_LANGUAGE", "en")
    # short synthetic clip → relax duration gates so it isn't dropped
    monkeypatch.setenv("CLIPPER_DROP_BELOW_SEC", "0.5")
    monkeypatch.setenv("CLIPPER_TARGET_MIN_SEC", "0.5")
    monkeypatch.setenv("CLIPPER_TARGET_MAX_SEC", "600")

    import clipper.config as config
    import clipper.db as db

    config.get_settings.cache_clear()
    db._engine = None

    from clipper import ffmpeg
    from clipper.pipeline import orchestrator

    # Build a real talking video: speech audio (say) + a color background.
    aiff = tmp_path / "speech.aiff"
    subprocess.run(
        ["say", "-o", str(aiff),
         "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs."],
        check=True,
    )
    wav = tmp_path / "speech.wav"
    ffmpeg.run_ffmpeg(["-i", str(aiff), "-ac", "1", "-ar", "16000", str(wav)])
    src = tmp_path / "input.mp4"
    ffmpeg.run_ffmpeg([
        "-f", "lavfi", "-i", "color=c=navy:s=640x360:r=15",
        "-i", str(wav), "-c:v", "libx264", "-c:a", "aac", "-shortest", str(src),
    ])

    job_id = orchestrator.create_job(str(src))
    assert job_id.startswith("job_")

    try:
        records = asyncio.run(orchestrator.run_pipeline(job_id, llm=FakeLLM()))
    except Exception as e:
        if "faster_whisper" in repr(e).lower() or "ctranslate2" in repr(e).lower():
            pytest.skip(f"whisper unavailable at runtime: {e}")
        raise

    # at least one real clip file produced, with a matching DB record
    assert len(records) >= 1
    from clipper.storage import LocalStorage

    st = LocalStorage()
    assert st.exists(job_id, "clips.json")
    for r in records:
        assert st.exists(job_id, "clips", f"{r['id']}.mp4")
        assert r["title"] == "The Quick Brown Fox"
        assert r["status"] == "ready"

    with db.session_scope() as s:
        job = s.get(db.Job, job_id)
        assert job.status == "done"
        clip = s.get(db.Clip, records[0]["id"])
        assert clip is not None and clip.tag_list() == ["demo", "test"]

    # full resumability: a second run recomputes nothing and returns same clips
    records2 = asyncio.run(orchestrator.run_pipeline(job_id, llm=FakeLLM()))
    assert [r["id"] for r in records2] == [r["id"] for r in records]
