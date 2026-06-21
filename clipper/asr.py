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


def get_transcriber() -> Transcriber:
    from .config import get_settings

    backend = get_settings().asr_backend
    if backend == "faster_whisper":
        return FasterWhisperTranscriber()
    if backend == "openai":
        return OpenAIWhisperTranscriber()
    raise ValueError(f"Unknown ASR backend: {backend!r}")
