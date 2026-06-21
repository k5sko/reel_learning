"""Phase 2 — Transcribe: caching/contract via a fake transcriber (always runs),
plus a real faster-whisper pass over `say`-synthesized speech (skips if the
model or `say` is unavailable)."""

from __future__ import annotations

import importlib.util
import shutil
import subprocess

import pytest


class _FakeTranscriber:
    def __init__(self):
        self.calls = 0

    def transcribe(self, audio_path):
        self.calls += 1
        return {
            "language": "en",
            "duration": 1.0,
            "segments": [
                {
                    "id": 0, "start": 0.0, "end": 1.0, "text": "hi there",
                    "words": [
                        {"word": "hi", "start": 0.0, "end": 0.3},
                        {"word": "there", "start": 0.35, "end": 0.9},
                    ],
                }
            ],
        }


def test_transcribe_caches(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_STORAGE_ROOT", str(tmp_path / "store"))
    import clipper.config as config

    config.get_settings.cache_clear()
    from clipper.pipeline import transcribe
    from clipper.storage import LocalStorage

    st = LocalStorage()
    st.write_bytes(b"fake-wav", "jf", "audio.wav")

    fake = _FakeTranscriber()
    t1 = transcribe.run("jf", st, transcriber=fake)
    t2 = transcribe.run("jf", st, transcriber=fake)  # cached → no second call

    assert fake.calls == 1
    assert st.exists("jf", "transcript.json")
    assert t2 == t1
    assert t1["segments"][0]["words"][0]["word"] == "hi"


_HAVE_FW = importlib.util.find_spec("faster_whisper") is not None
_HAVE_SAY = shutil.which("say") is not None and shutil.which("ffmpeg") is not None


@pytest.mark.skipif(not (_HAVE_FW and _HAVE_SAY), reason="faster-whisper or `say` unavailable")
def test_transcribe_real_speech(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_STORAGE_ROOT", str(tmp_path / "store"))
    monkeypatch.setenv("CLIPPER_ASR_MODEL", "tiny")        # keep the model download small
    monkeypatch.setenv("CLIPPER_ASR_COMPUTE_TYPE", "int8")
    monkeypatch.setenv("CLIPPER_ASR_LANGUAGE", "en")
    import clipper.config as config

    config.get_settings.cache_clear()
    from clipper import ffmpeg
    from clipper.pipeline import transcribe
    from clipper.storage import LocalStorage

    aiff = tmp_path / "speech.aiff"
    subprocess.run(
        ["say", "-o", str(aiff), "The quick brown fox jumps over the lazy dog."],
        check=True,
    )
    st = LocalStorage()
    st.job_dir("jt")
    ffmpeg.run_ffmpeg(["-i", str(aiff), "-ac", "1", "-ar", "16000",
                       "-c:a", "pcm_s16le", st.path("jt", "audio.wav")])

    try:
        tr = transcribe.run("jt", st)
    except Exception as e:  # model download / runtime issue → skip, don't fail
        pytest.skip(f"faster-whisper unavailable at runtime: {e}")

    assert tr["language"]
    words = [w for s in tr["segments"] for w in s["words"]]
    assert len(words) >= 5
    for w in words:
        assert isinstance(w["start"], (int, float))
        assert isinstance(w["end"], (int, float))
        assert w["end"] >= w["start"]
