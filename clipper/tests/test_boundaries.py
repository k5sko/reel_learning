"""Phase 5 — Boundaries (the crux).

The headline test (done-criterion #4): no clip boundary falls inside a word's
[start, end] span, on the shared fixture transcript. Plus snapping/clamping,
sub-splitting, drop, and de-dup behavior.
"""

from __future__ import annotations

import json
from pathlib import Path

from clipper.config import Settings
from clipper.pipeline import boundaries as B
from clipper.pipeline.sentences import words_to_sentences

FIXTURE = Path(__file__).parent / "fixtures" / "transcript_small.json"


def _ctx():
    transcript = json.loads(FIXTURE.read_text())
    sentences = words_to_sentences(transcript, sentence_gap=0.6)
    words = B.word_list(transcript)
    duration = transcript["duration"]
    return transcript, sentences, words, duration


def _settings(**over):
    base = dict(
        skip_binary_check=True,
        pad_lead_in=0.25,
        pad_tail=0.35,
        target_min_sec=1.0,
        target_max_sec=100.0,
        drop_below_sec=0.5,
        dedup_overlap=0.5,
    )
    base.update(over)
    return Settings(**base)


def _no_boundary_inside_word(clips, words):
    for c in clips:
        assert not B.boundary_inside_word(c["start"], words), c
        assert not B.boundary_inside_word(c["end"], words), c


def test_no_boundary_inside_word_on_fixture():
    _, sentences, words, duration = _ctx()
    # one moment covering sentences 1..3 ("Today..." through "...daily.")
    moments = [{"start_sentence": 1, "end_sentence": 3, "reason": "a complete idea about focus"}]
    clips = B.build_clips(moments, sentences, words, duration, _settings())
    assert len(clips) == 1
    _no_boundary_inside_word(clips, words)

    c = clips[0]
    # snapped into the surrounding silence, not crossing into neighbor sentences
    assert c["start"] >= 1.4   # after "show." (prev sentence last word end)
    assert c["end"] <= 9.2     # before "Thanks" (next sentence first word start)
    assert c["start"] <= 2.0 and c["end"] >= 8.3   # includes its own words
    assert c["id"] == "c_01"


def test_padding_clamps_to_word_edge_in_tiny_gap():
    # Two sentences separated by only 0.1s; padding (0.25/0.35) would cross into
    # the neighbor words if not clamped.
    transcript = {
        "language": "en",
        "duration": 4.0,
        "segments": [
            {"id": 0, "words": [
                {"word": "Alpha", "start": 0.0, "end": 0.4},
                {"word": " beta.", "start": 0.45, "end": 0.9},
                {"word": " Gamma", "start": 1.0, "end": 1.4},     # only 0.1s gap
                {"word": " delta.", "start": 1.45, "end": 1.9},
                {"word": " Epsilon", "start": 3.0, "end": 3.5},   # big gap after
                {"word": " zeta.", "start": 3.55, "end": 4.0},
            ]},
        ],
    }
    sentences = words_to_sentences(transcript, sentence_gap=0.6)
    words = B.word_list(transcript)
    # moment = the middle sentence "Gamma delta."
    moments = [{"start_sentence": 1, "end_sentence": 1, "reason": "x"}]
    clips = B.build_clips(moments, sentences, words, 4.0, _settings(drop_below_sec=0.1))
    assert len(clips) == 1
    c = clips[0]
    _no_boundary_inside_word([c], words)
    # start clamped to the previous word end (0.9), not 1.0 - 0.25 = 0.75 (inside "beta.")
    assert abs(c["start"] - 0.9) < 1e-6
    # end padded into the big trailing silence (1.9 + 0.35 = 2.25 <= next start 3.0)
    assert abs(c["end"] - 2.25) < 1e-6


def test_long_moment_subsplits_at_sentence_boundaries():
    _, sentences, words, duration = _ctx()
    moments = [{"start_sentence": 0, "end_sentence": 4, "reason": "whole talk"}]
    # max 4s forces splitting the ~10s span into multiple sentence-aligned clips
    clips = B.build_clips(moments, sentences, words, duration, _settings(target_max_sec=4.0))
    assert len(clips) >= 2
    _no_boundary_inside_word(clips, words)
    # each sub-clip aligns to whole sentences and stays within bounds
    for c in clips:
        assert c["start_sentence"] <= c["end_sentence"]
        assert c["start"] >= 0.0 and c["end"] <= duration
    # sub-clips are ordered and non-overlapping
    for a, b in zip(clips, clips[1:]):
        assert a["end"] <= b["start"] + 1e-9


def test_drop_when_too_short():
    _, sentences, words, duration = _ctx()
    moments = [{"start_sentence": 2, "end_sentence": 2, "reason": "short"}]  # "Focus is a skill." ~1.3s
    clips = B.build_clips(moments, sentences, words, duration, _settings(drop_below_sec=5.0))
    assert clips == []


def test_dedup_keeps_stronger_reason():
    _, sentences, words, duration = _ctx()
    moments = [
        {"start_sentence": 1, "end_sentence": 3, "reason": "x"},                       # weak
        {"start_sentence": 1, "end_sentence": 3, "reason": "a much stronger, longer reason signal"},
    ]
    clips = B.build_clips(moments, sentences, words, duration, _settings())
    assert len(clips) == 1
    assert clips[0]["reason"].startswith("a much stronger")
