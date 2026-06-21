"""ASR interface + faster-whisper implementation.

Wrapped behind ``Transcriber`` so the backend can swap to the OpenAI Whisper
API via ``CLIPPER_ASR_BACKEND=openai`` later. Output is the Transcript JSON
contract: ``{language, duration, segments[{id,start,end,text,words[]}]}``.
faster-whisper processes audio in internal windows and yields segments lazily,
so memory stays bounded on long videos.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


def _r(x: Optional[float]) -> Optional[float]:
    return round(float(x), 3) if x is not None else None


class Transcriber(ABC):
    @abstractmethod
    def transcribe(self, audio_path: str) -> dict:
        """Return Transcript JSON: {language, duration, segments[{...words[]}]}."""
        ...


class FasterWhisperTranscriber(Transcriber):
    def __init__(self) -> None:
        from .config import get_settings

        s = get_settings()
        self.model_name = s.asr_model
        self.device = s.asr_device
        self.compute_type = s.asr_compute_type
        self.language = s.asr_language
        self.beam_size = s.asr_beam_size
        self._model = None  # lazy — the model is heavy to load

    def _get_model(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_name, device=self.device, compute_type=self.compute_type
            )
        return self._model

    def transcribe(self, audio_path: str) -> dict:
        model = self._get_model()
        segments, info = model.transcribe(
            audio_path,
            word_timestamps=True,
            beam_size=self.beam_size,
            language=self.language,
            vad_filter=True,
        )

        out_segments = []
        for seg in segments:  # lazy generator — bounded memory
            words = []
            for w in seg.words or []:
                start = _r(w.start) if w.start is not None else _r(seg.start)
                end = _r(w.end) if w.end is not None else _r(seg.end)
                words.append({"word": w.word, "start": start, "end": end})
            out_segments.append(
                {
                    "id": seg.id,
                    "start": _r(seg.start),
                    "end": _r(seg.end),
                    "text": seg.text,
                    "words": words,
                }
            )

        return {
            "language": info.language,
            "duration": _r(info.duration),
            "segments": out_segments,
        }


class OpenAIWhisperTranscriber(Transcriber):
    def transcribe(self, audio_path: str) -> dict:
        raise NotImplementedError("Stretch: OpenAI Whisper API backend")


def _attr(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _groq_to_transcript(resp) -> dict:
    """Map a Groq verbose_json transcription into our Transcript contract.

    Groq returns a flat top-level ``words`` list (no leading spaces) plus
    ``segments``. We re-nest words under their segment by time and restore the
    leading-space convention so sentence joining/spacing matches faster-whisper.
    """
    raw_words = _attr(resp, "words", None) or []
    words = []
    for w in raw_words:
        start, end = _attr(w, "start"), _attr(w, "end")
        if start is None or end is None:
            continue
        token = str(_attr(w, "word", ""))
        words.append({"word": " " + token.lstrip(), "start": _r(start), "end": _r(end)})

    segments = []
    for s in _attr(resp, "segments", None) or []:
        s_start, s_end = _attr(s, "start", 0.0), _attr(s, "end", 0.0)
        seg_words = [w for w in words if s_start - 1e-6 <= w["start"] < s_end + 1e-6]
        segments.append(
            {
                "id": _attr(s, "id", len(segments)),
                "start": _r(s_start),
                "end": _r(s_end),
                "text": _attr(s, "text", ""),
                "words": seg_words,
            }
        )
    if not segments:  # no segment granularity — one segment holding all words
        segments = [
            {
                "id": 0,
                "start": words[0]["start"] if words else 0.0,
                "end": words[-1]["end"] if words else 0.0,
                "text": _attr(resp, "text", ""),
                "words": words,
            }
        ]

    duration = _attr(resp, "duration") or (words[-1]["end"] if words else 0.0)
    return {
        "language": _attr(resp, "language") or "en",
        "duration": _r(duration),
        "segments": segments,
    }


class GroqTranscriber(Transcriber):
    def __init__(self) -> None:
        from .config import get_settings

        s = get_settings()
        self.api_key = s.groq_api_key
        self.model = s.groq_model
        self.language = s.asr_language

    def transcribe(self, audio_path: str) -> dict:
        import os

        try:
            from groq import Groq
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("groq SDK not installed; `pip install groq`") from e

        client = Groq(api_key=self.api_key) if self.api_key else Groq()
        with open(audio_path, "rb") as fh:
            resp = client.audio.transcriptions.create(
                file=(os.path.basename(audio_path), fh.read()),
                model=self.model,
                response_format="verbose_json",
                timestamp_granularities=["word", "segment"],
                language=self.language or None,
            )
        return _groq_to_transcript(resp)


def get_transcriber() -> Transcriber:
    from .config import get_settings

    backend = get_settings().asr_backend
    if backend == "faster_whisper":
        return FasterWhisperTranscriber()
    if backend == "groq":
        return GroqTranscriber()
    if backend == "openai":
        return OpenAIWhisperTranscriber()
    raise ValueError(f"Unknown ASR backend: {backend!r}")
