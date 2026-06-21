"""Recently-watched clips -> a tiny comprehension quiz (LLM).

The feed pops a 1-2 question multiple-choice check every few reels. Questions
test the key idea of the clips the learner just watched (weighted to the most
recent). We never fabricate a quiz: if the model returns nothing usable we
return [] and the feed just skips the check.
"""

from __future__ import annotations

from typing import List, Optional

from .llm import LLMClient

_QUIZ_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "question": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "answer_index": {"type": "integer"},
                    "explanation": {"type": "string"},
                    "clip_index": {"type": "integer"},
                },
                "required": ["question", "options", "answer_index", "explanation", "clip_index"],
            },
        }
    },
    "required": ["questions"],
}

_SYSTEM = (
    "You write quick comprehension checks for short educational video clips a "
    "learner just watched. Each question is clear, answerable from the clip's "
    "idea alone, has exactly one correct option and plausible (not trick) "
    "distractors, and stays concrete."
)


def _context(clips: List[dict]) -> str:
    lines = []
    for i, c in enumerate(clips):
        title = str(c.get("title") or "").strip()
        summary = str(c.get("summary") or "").strip()
        if not (title or summary):
            continue
        lines.append(f"{i + 1}. {title}" + (f" — {summary}" if summary else ""))
    return "\n".join(lines)


def generate_quiz(clips: List[dict], llm: Optional[LLMClient] = None, n_questions: int = 2) -> List[dict]:
    """Return up to `n_questions` validated MCQs, or [] if nothing usable."""
    ctx = _context(clips or [])
    if not ctx:
        return []
    llm = llm or LLMClient()
    n = max(1, min(int(n_questions or 2), 8))
    prompt = (
        f"A learner just watched these short clips (most recent first):\n{ctx}\n\n"
        f"Write EXACTLY {n} multiple-choice questions checking they understood the "
        "key ideas, weighted toward the MOST RECENT clip. Write more than one "
        f"question per clip if needed to reach {n}. Each question: a concise "
        "prompt, exactly 3 or 4 options, one correct answer (give its 0-based "
        "index in answer_index), a one-sentence explanation of why it's right, "
        "and clip_index = the 0-based position of the clip it tests (the first "
        "clip in the list above is 0, the second is 1, ...)."
    )
    out = llm.complete_json(prompt, _QUIZ_SCHEMA, system=_SYSTEM) or {}

    cleaned: List[dict] = []
    for q in out.get("questions") or []:
        question = str(q.get("question") or "").strip()
        options = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()][:4]
        if not question or len(options) < 2:
            continue
        try:
            answer_index = int(q.get("answer_index"))
        except (TypeError, ValueError):
            answer_index = 0
        answer_index = max(0, min(answer_index, len(options) - 1))
        try:
            clip_index = int(q.get("clip_index"))
        except (TypeError, ValueError):
            clip_index = 0
        clip_index = max(0, min(clip_index, max(0, len(clips) - 1)))  # which clip/concept it tests
        cleaned.append(
            {
                "question": question,
                "options": options,
                "answer_index": answer_index,
                "explanation": str(q.get("explanation") or "").strip(),
                "clip_index": clip_index,
            }
        )
        if len(cleaned) >= n:
            break
    return cleaned


_CONCEPT_QUIZ_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "question": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "answer_index": {"type": "integer"},
                    "explanation": {"type": "string"},
                    "concept_index": {"type": "integer"},
                },
                "required": ["question", "options", "answer_index", "explanation", "concept_index"],
            },
        }
    },
    "required": ["questions"],
}


def generate_concept_quiz(concepts: List[str], llm: Optional[LLMClient] = None) -> List[dict]:
    """One MCQ per PREREQUISITE concept (diagnostic). Each question carries ``concept_index`` so the
    caller can map it back to a prerequisite node. [] if nothing usable."""
    concepts = [str(c).strip() for c in (concepts or []) if str(c).strip()]
    if not concepts:
        return []
    llm = llm or LLMClient()
    listing = "\n".join(f"{i}. {c}" for i, c in enumerate(concepts))
    prompt = (
        "These are PREREQUISITE concepts a learner should already know. Write ONE multiple-choice "
        "question testing each, to check whether they actually have it:\n"
        f"{listing}\n\n"
        "Each question: concise prompt, exactly 3 or 4 options, one correct answer (0-based "
        "answer_index), a one-sentence explanation, and concept_index = the 0-based position of the "
        "concept it tests (from the list above)."
    )
    out = llm.complete_json(prompt, _CONCEPT_QUIZ_SCHEMA, system=_SYSTEM) or {}
    cleaned: List[dict] = []
    for q in out.get("questions") or []:
        question = str(q.get("question") or "").strip()
        options = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()][:4]
        if not question or len(options) < 2:
            continue
        try:
            ai = int(q.get("answer_index"))
        except (TypeError, ValueError):
            ai = 0
        try:
            ci = int(q.get("concept_index"))
        except (TypeError, ValueError):
            ci = 0
        cleaned.append(
            {
                "question": question,
                "options": options,
                "answer_index": max(0, min(ai, len(options) - 1)),
                "explanation": str(q.get("explanation") or "").strip(),
                "concept_index": max(0, min(ci, len(concepts) - 1)),
            }
        )
    return cleaned
