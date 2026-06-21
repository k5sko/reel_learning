"""Topic -> short flashcard intake -> a tailored multi-video learning plan.

After the user enters a topic we ask 3-4 quick multiple-choice questions about
their level, goal, and which facet of the topic they care about. The questions
are LLM-generated so they fit the specific topic (a "chain rule" learner gets
different cards than a "French Revolution" learner). Their answers feed a
reasoning step that produces several targeted YouTube search queries — so we
fetch multiple well-aimed videos instead of one generic match.
"""

from __future__ import annotations

from typing import Optional

from .finder import assess_specificity
from .llm import LLMClient

# ---------------------------------------------------------------------------
# 1. Generate the flashcard questions (tailored to the topic)
# ---------------------------------------------------------------------------

_QUESTIONS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "prompt": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["id", "prompt", "options"],
            },
        }
    },
    "required": ["questions"],
}


def generate_questions(topic: str, llm: LLMClient) -> dict:
    """Return either a clarification prompt (topic too broad) or 3-4 tailored
    multiple-choice questions."""
    spec = assess_specificity(topic, llm)
    if not spec["specific"]:
        return {
            "status": "needs_clarification",
            "message": spec["message"] or "That's a bit broad — can you be more specific?",
            "suggestions": spec["suggestions"],
        }

    prompt = (
        f"A learner wants to learn about: {topic!r}.\n\n"
        "Write a SHORT intake quiz — exactly 3 or 4 multiple-choice questions — so we "
        "can pick the right videos for them. Make the questions and options specific "
        "to THIS topic, not generic. Cover:\n"
        "1. their current level with this topic\n"
        "2. their goal (e.g. build intuition, exam/interview prep, apply it, quick refresher)\n"
        "3. (one or two) which sub-aspect of the topic they care most about — use real "
        "sub-topics of the subject as the options\n\n"
        "Each question: a short prompt (<=10 words) and 3-4 concise options (<=6 words "
        "each). Give each question a short snake_case id (e.g. level, goal, focus)."
    )
    out = llm.complete_json(prompt, _QUESTIONS_SCHEMA) or {}
    questions = []
    for i, q in enumerate(out.get("questions") or []):
        opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()][:4]
        prompt_text = str(q.get("prompt") or "").strip()
        if prompt_text and len(opts) >= 2:
            questions.append({"id": q.get("id") or f"q{i + 1}", "prompt": prompt_text, "options": opts})

    if not questions:
        questions = _fallback_questions(topic)
    return {"status": "questions", "topic": topic, "questions": questions[:4]}


def _fallback_questions(topic: str) -> list:
    """Deterministic questions if the LLM is unavailable / returns nothing."""
    return [
        {
            "id": "level",
            "prompt": f"How familiar are you with {topic}?",
            "options": ["New to it", "Some exposure", "Comfortable — want depth"],
        },
        {
            "id": "goal",
            "prompt": "What's your goal?",
            "options": ["Build intuition", "Exam / interview prep", "Apply it", "Quick refresher"],
        },
        {
            "id": "depth",
            "prompt": "How deep do you want to go?",
            "options": ["Quick overview", "Working understanding", "Deep dive"],
        },
    ]


# ---------------------------------------------------------------------------
# 2. Turn answers into a multi-video plan (reasoning step)
# ---------------------------------------------------------------------------

_PLAN_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "profile": {"type": "string"},
        "queries": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "query": {"type": "string"},
                    "why": {"type": "string"},
                },
                "required": ["query", "why"],
            },
        },
    },
    "required": ["profile", "queries"],
}


def plan_videos(topic: str, answers: Optional[dict], llm: LLMClient, max_videos: int = 3) -> dict:
    """Reason over the learner's answers and produce `max_videos` distinct,
    targeted YouTube search queries (foundational -> advanced) plus a one-line
    learner profile."""
    answers = answers or {}
    ans_lines = "\n".join(f"- {k}: {v}" for k, v in answers.items()) or "(no answers)"
    prompt = (
        f"A learner wants to learn about: {topic!r}.\n"
        f"Their intake answers:\n{ans_lines}\n\n"
        f"Produce exactly {max_videos} focused YouTube SEARCH QUERIES that together form "
        "the right learning path for THIS topic at THEIR level and goal. Each query must "
        "target a DISTINCT concrete sub-topic or angle (e.g. core intuition, a worked "
        "example, a common pitfall) — never the same idea reworded. Order them from "
        "foundational to advanced. Keep each query short and search-friendly. Also write "
        "a one-line 'profile' summarizing who this learner is and what they want."
    )
    out = llm.complete_json(prompt, _PLAN_SCHEMA) or {}
    queries = []
    seen = set()
    for q in out.get("queries") or []:
        text = str(q.get("query") or "").strip()
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            queries.append({"query": text, "why": str(q.get("why") or "").strip()})
    if not queries:
        queries = [{"query": topic, "why": "the topic itself"}]
    return {"profile": str(out.get("profile") or "").strip(), "queries": queries[:max_videos]}
