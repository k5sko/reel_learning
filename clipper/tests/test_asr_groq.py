"""Phase 2 (Groq backend) — verify the verbose_json → Transcript mapping:
flat words get re-nested under segments by time, leading spaces restored, and
the contract shape matches what sentences.py expects."""

from __future__ import annotations

from clipper.asr import _groq_to_transcript
from clipper.pipeline.sentences import words_to_sentences


def test_groq_mapping_renests_words_and_spaces():
    # Groq-style response (object-free; dicts are accepted via _attr)
    resp = {
        "language": "en",
        "duration": 3.0,
        "text": "Hello world. Bye now.",
        "words": [
            {"word": "Hello", "start": 0.0, "end": 0.4},
            {"word": "world.", "start": 0.45, "end": 0.9},
            {"word": "Bye", "start": 2.0, "end": 2.3},
            {"word": "now.", "start": 2.35, "end": 2.8},
        ],
        "segments": [
            {"id": 0, "start": 0.0, "end": 1.0, "text": "Hello world."},
            {"id": 1, "start": 2.0, "end": 3.0, "text": "Bye now."},
        ],
    }
    tr = _groq_to_transcript(resp)

    assert tr["language"] == "en"
    assert tr["duration"] == 3.0
    assert [s["id"] for s in tr["segments"]] == [0, 1]
    # words re-nested under their segment by time
    assert len(tr["segments"][0]["words"]) == 2
    assert len(tr["segments"][1]["words"]) == 2
    # leading-space convention restored (so sentence text spaces correctly)
    assert tr["segments"][0]["words"][0]["word"] == " Hello"

    # downstream sentence builder produces correctly-spaced sentences
    sents = words_to_sentences(tr, sentence_gap=0.6)
    assert [s["text"] for s in sents] == ["Hello world.", "Bye now."]


def test_groq_mapping_no_segments_falls_back_to_one():
    resp = {
        "language": "en",
        "duration": 1.0,
        "text": "Just words",
        "words": [
            {"word": "Just", "start": 0.0, "end": 0.3},
            {"word": "words", "start": 0.35, "end": 0.8},
        ],
        "segments": [],
    }
    tr = _groq_to_transcript(resp)
    assert len(tr["segments"]) == 1
    assert len(tr["segments"][0]["words"]) == 2
