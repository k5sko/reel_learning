"""LLM-generated practice questions for a subject the learner has been studying.

Standalone (clipper's LLMClient) so it works without the recsys recommender —
given a subject, and optionally a few titles/summaries of clips the learner
watched (for grounding), produce multiple-choice questions with answers +
explanations. (When recsys is mounted later, a node's concept can be passed as
the subject and the result reported to /api/feedback to advance mastery.)
"""

from __future__ import annotations

from typing import List, Optional

_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "prompt": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "answer_index": {"type": "integer"},
                    "explanation": {"type": "string"},
                    "difficulty": {"type": "string"},
                },
                "required": ["prompt", "options", "answer_index", "explanation", "difficulty"],
            },
        }
    },
    "required": ["questions"],
}

_SYSTEM = (
    "You are an expert tutor writing short practice quizzes. Each question tests real "
    "understanding (not trivia or definitions-recall), has exactly 4 options with one "
    "clearly-correct answer and plausible distractors, and a one-sentence explanation "
    "that says WHY the answer is right."
)


def generate_questions(
    subject: str,
    context: Optional[List[str]] = None,
    n: int = 5,
    llm=None,
) -> List[dict]:
    """Return up to `n` validated MCQ dicts for `subject`. [] on any LLM failure."""
    from clipper.llm import LLMClient

    client = llm or LLMClient()
    ctx = ""
    if context:
        joined = "; ".join(str(c).strip() for c in context if str(c).strip())[:1200]
        if joined:
            ctx = f"\nThe learner has been watching clips on: {joined}\nLean toward these angles where natural.\n"

    prompt = (
        f"Write {n} multiple-choice practice questions that test understanding of: {subject!r}.{ctx}\n"
        "Each: a clear prompt, exactly 4 options, the 0-based index of the correct option, a "
        "one-sentence explanation, and a difficulty (easy | medium | hard). Mix difficulties, "
        "cover the key ideas, and never repeat a question."
    )
    try:
        out = client.complete_json(prompt, _SCHEMA, system=_SYSTEM) or {}
    except Exception:  # noqa: BLE001 — LLM optional; caller handles empty
        return []

    questions: List[dict] = []
    for q in out.get("questions") or []:
        opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
        try:
            ai = int(q.get("answer_index", 0))
        except (TypeError, ValueError):
            ai = 0
        if not q.get("prompt") or len(opts) < 2 or not (0 <= ai < len(opts)):
            continue
        questions.append(
            {
                "prompt": str(q["prompt"]).strip(),
                "options": opts,
                "answer_index": ai,
                "explanation": str(q.get("explanation") or "").strip(),
                "difficulty": str(q.get("difficulty") or "medium").strip().lower(),
            }
        )
    return questions[:n]
