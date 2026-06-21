"""Phase 4 — Segment: chunking with overlap, index validation, cross-seam
exact de-dup, ordering. Uses an injected fake LLM (no network)."""

from __future__ import annotations

from clipper.pipeline.segment import _chunk_indices, segment_sentences


class FakeLLM:
    """Returns a scripted {'moments': [...]} per chunk, in call order."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.prompts = []

    def complete_json(self, prompt, schema, *, system=None, max_tokens=None):
        self.prompts.append(prompt)
        return self.responses.pop(0) if self.responses else {"moments": []}


def _sentences(n):
    return [{"idx": i, "text": f"s{i}", "start": float(i), "end": i + 0.5} for i in range(n)]


def test_chunk_indices_overlap():
    assert _chunk_indices(5, 3, 1) == [(0, 2), (2, 4)]
    assert _chunk_indices(3, 10, 2) == [(0, 2)]
    assert _chunk_indices(0, 3, 1) == []


def test_overlap_dedup_and_order():
    sents = _sentences(5)
    # chunk (0,2) and chunk (2,4); sentence 2 appears in both.
    responses = [
        {"moments": [
            {"start_sentence": 0, "end_sentence": 1, "reason": "a"},
            {"start_sentence": 2, "end_sentence": 2, "reason": "x"},
        ]},
        {"moments": [
            {"start_sentence": 2, "end_sentence": 2, "reason": "x"},   # exact dup across seam
            {"start_sentence": 3, "end_sentence": 4, "reason": "b"},
        ]},
    ]
    llm = FakeLLM(responses)
    moments = segment_sentences(sents, llm, chunk_size=3, overlap=1)
    assert len(llm.prompts) == 2
    assert [(m["start_sentence"], m["end_sentence"]) for m in moments] == [
        (0, 1), (2, 2), (3, 4)
    ]


def test_validation_clamps_and_drops():
    sents = _sentences(4)
    responses = [
        {"moments": [
            {"start_sentence": 0, "end_sentence": 99, "reason": "clamp end to 3"},
            {"start_sentence": 3, "end_sentence": 1, "reason": "start>end -> dropped"},
            {"start_sentence": -5, "end_sentence": 0, "reason": "clamp start to 0"},
        ]},
    ]
    llm = FakeLLM(responses)
    moments = segment_sentences(sents, llm, chunk_size=100, overlap=10)
    spans = sorted((m["start_sentence"], m["end_sentence"]) for m in moments)
    assert (0, 3) in spans          # clamped end
    assert (0, 0) in spans          # clamped start
    assert all(s <= e for s, e in spans)   # no inverted spans survived
