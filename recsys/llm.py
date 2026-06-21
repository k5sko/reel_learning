"""LLM helpers for the recommender — DAG prerequisite expansion and the channel-fit cold-start
prior. Thin wrappers over clipper's ``LLMClient``; every call degrades gracefully (no key / API
error → a safe fallback) so the deterministic core keeps working without the LLM.
"""

from __future__ import annotations

from typing import List, Optional

_PREREQ_SCHEMA = {
    "type": "object",
    "properties": {"prerequisites": {"type": "array", "items": {"type": "string"}}},
    "required": ["prerequisites"],
    "additionalProperties": False,  # Anthropic structured output requires this on objects
}



def _client(llm=None):
    if llm is not None:
        return llm
    from clipper.llm import LLMClient

    return LLMClient()


def _fast_client(llm=None):
    """Haiku for the cheap, high-volume style-rating call — much faster than the default model."""
    if llm is not None:
        return llm
    from clipper.llm import LLMClient

    return LLMClient(model="claude-haiku-4-5-20251001")


def decompose_prereqs(concept: str, llm=None, max_items: int = 5) -> List[str]:
    """Immediate prerequisites of a concept (clip-sized, ≥ high-school). [] on any failure."""
    prompt = (
        f"List up to {max_items} IMMEDIATE prerequisite concepts a learner must understand "
        f"BEFORE learning '{concept}'. Each must be a single concept teachable in a 1-3 minute "
        f"clip. Do not go below high-school level. Return concepts only (no explanations)."
    )
    try:
        out = _client(llm).complete_json(prompt, _PREREQ_SCHEMA) or {}
        return [str(x).strip() for x in (out.get("prerequisites") or []) if str(x).strip()][:max_items]
    except Exception:  # noqa: BLE001 — LLM optional; fall back to no expansion
        return []


def rate_clip_styles(items: list, llm=None) -> dict:
    """Rate clips on the named style axes (0..1 each). `items` = [{"id","text"}]. Returns
    {id: {axis: value}}. Batched into one LLM call; {} on failure (caller falls back to neutral)."""
    from .style import AXIS_POLES, STYLE_AXES

    if not items:
        return {}
    axis_props = {a: {"type": "number"} for a in STYLE_AXES}
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "ratings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"id": {"type": "string"}, **axis_props},
                    "required": ["id", *STYLE_AXES],
                },
            }
        },
        "required": ["ratings"],
    }
    axes_desc = "\n".join(f"- {a}: 0={lo}, 1={hi}" for a, (lo, hi) in AXIS_POLES.items())
    listing = "\n".join(f"[{it['id']}] {str(it.get('text',''))[:300]}" for it in items)
    prompt = (
        "Rate each clip's DELIVERY STYLE on these axes, 0..1 (judge style/tone from the text, not "
        f"the subject):\n{axes_desc}\n\nClips:\n{listing}"
    )
    try:
        out = _fast_client(llm).complete_json(prompt, schema) or {}
        res = {}
        for r in out.get("ratings", []):
            cid = r.get("id")
            if cid:
                res[cid] = {a: min(1.0, max(0.0, float(r.get(a, 0.5)))) for a in STYLE_AXES}
        return res
    except Exception:  # noqa: BLE001 — optional; caller uses neutral fit on failure
        return {}
