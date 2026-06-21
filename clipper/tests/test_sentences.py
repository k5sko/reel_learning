"""Phase 3 — Sentences: break triggers (punctuation / gap / segment boundary),
exact start/end times, and integration over the shared fixture transcript."""

from __future__ import annotations

import json
from pathlib import Path

from clipper.pipeline.sentences import words_to_sentences

FIXTURE = Path(__file__).parent / "fixtures" / "transcript_small.json"


def _w(word, start, end):
    return {"word": word, "start": start, "end": end}


def test_break_on_punctuation_gap_and_segment():
    transcript = {
        "segments": [
            {
                "id": 0,
                "words": [
                    _w("So", 0.0, 0.2), _w(" this", 0.25, 0.4), _w(" works.", 0.45, 0.8),
                    _w(" Then", 0.9, 1.1), _w(" we", 1.15, 1.3), _w(" pause", 1.35, 1.6),
                ],
            },
            {
                "id": 1,
                "words": [_w(" New", 2.5, 2.7), _w(" topic", 2.75, 3.0)],
            },
        ]
    }
    sents = words_to_sentences(transcript, sentence_gap=0.6)
    texts = [s["text"] for s in sents]
    assert texts == ["So this works.", "Then we pause", "New topic"]
    # idx contiguous from 0
    assert [s["idx"] for s in sents] == [0, 1, 2]
    # exact times: first word start, last word end
    assert sents[0]["start"] == 0.0 and sents[0]["end"] == 0.8
    assert sents[1]["start"] == 0.9 and sents[1]["end"] == 1.6   # gap break (1.6 -> 2.5)
    assert sents[2]["start"] == 2.5 and sents[2]["end"] == 3.0   # segment-boundary break


def test_abbreviation_does_not_break_without_pause():
    transcript = {
        "segments": [
            {
                "id": 0,
                "words": [
                    _w("Dr.", 0.0, 0.3), _w(" Smith", 0.35, 0.7),
                    _w(" spoke.", 0.75, 1.1),
                ],
            }
        ]
    }
    sents = words_to_sentences(transcript, sentence_gap=0.6)
    assert [s["text"] for s in sents] == ["Dr. Smith spoke."]


def test_fixture_integration():
    transcript = json.loads(FIXTURE.read_text())
    sents = words_to_sentences(transcript, sentence_gap=0.6)
    assert [s["text"] for s in sents] == [
        "Welcome to the show.",
        "Today we talk about focus.",
        "Focus is a skill.",
        "You can train it daily.",
        "Thanks for watching.",
    ]
    assert sents[0]["start"] == 0.0
    assert sents[-1]["end"] == 10.4
    # sentences are ordered and non-overlapping
    for a, b in zip(sents, sents[1:]):
        assert a["end"] <= b["start"]
