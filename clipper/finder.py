"""Topic → video finder.

Given a learning query, decide whether it's specific enough to find one focused
video; if so, search the pre-vetted channels (via yt-dlp, no API key) and let
the LLM pick the best match. Returns a status dict the API turns into either a
clarification prompt or a pipeline job.

Vague queries ("teach me math") return ``needs_clarification`` with suggestions.
Specific queries ("the chain rule") return ``found`` with a video, or
``not_found`` if nothing on the vetted channels matches.
"""

from __future__ import annotations

from typing import Callable, List, Optional
from urllib.parse import quote

from .channels import VETTED_CHANNELS
from .llm import LLMClient

_SPECIFICITY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "specific": {"type": "boolean"},
        "search_query": {"type": "string"},
        "message": {"type": "string"},
        "suggestions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["specific", "search_query", "message", "suggestions"],
}

_PICK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "best_index": {"type": "integer"},
        "reason": {"type": "string"},
    },
    "required": ["best_index", "reason"],
}


def assess_specificity(query: str, llm: LLMClient) -> dict:
    prompt = (
        "A user wants to learn something and we'll find ONE focused tutorial "
        "video for it. Decide if the request is specific enough to map to a "
        "single video, or too broad.\n"
        "- Too broad (e.g. 'teach me math', 'help with chemistry'): set "
        "specific=false, write one short sentence asking them to narrow it, and "
        "give 3-5 concrete subtopic suggestions.\n"
        "- Specific (e.g. 'the chain rule', 'balancing redox reactions'): set "
        "specific=true and put a concise YouTube search query in search_query.\n\n"
        f"Request: {query!r}"
    )
    out = llm.complete_json(prompt, _SPECIFICITY_SCHEMA) or {}
    return {
        "specific": bool(out.get("specific")),
        "search_query": (out.get("search_query") or query).strip(),
        "message": (out.get("message") or "").strip(),
        "suggestions": [str(s) for s in (out.get("suggestions") or [])],
    }


def search_channel_videos(query: str, channel: dict, limit: int = 6) -> List[dict]:
    import yt_dlp

    url = f"{channel['url']}/search?query={quote(query)}"
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "playlistend": limit * 2,
        "extractor_args": {"youtube": {"player_client": ["android", "ios", "web"]}},
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    out: List[dict] = []
    for e in info.get("entries") or []:
        vid = e.get("id", "")
        dur = e.get("duration")
        if not dur or len(vid) != 11:  # skip playlists / channels in results
            continue
        out.append(
            {
                "id": vid,
                "title": e.get("title", ""),
                "url": f"https://www.youtube.com/watch?v={vid}",
                "duration": dur,
                "channel": e.get("channel") or channel["name"],
            }
        )
        if len(out) >= limit:
            break
    return out


def pick_best(query: str, candidates: List[dict], llm: LLMClient) -> dict:
    lines = []
    for i, c in enumerate(candidates):
        mins = round((c.get("duration") or 0) / 60, 1)
        lines.append(f"[{i}] {c['title']}  ({mins} min)  — {c['channel']}")
    prompt = (
        f"The user wants a tutorial video about: {query!r}\n\n"
        "Pick the single best-matching video from the candidates below for that "
        "exact topic. Prefer a focused explanation over a long review/compilation. "
        "If none is a good match, return best_index = -1.\n\n"
        + "\n".join(lines)
    )
    out = llm.complete_json(prompt, _PICK_SCHEMA) or {}
    try:
        idx = int(out.get("best_index", -1))
    except (TypeError, ValueError):
        idx = -1
    return {"best_index": idx, "reason": str(out.get("reason", "")).strip()}


def find_video(
    query: str,
    llm: LLMClient,
    channels: Optional[List[dict]] = None,
    search_fn: Callable[[str, dict, int], List[dict]] = search_channel_videos,
    assume_specific: bool = False,
) -> dict:
    channels = channels if channels is not None else VETTED_CHANNELS

    # The planner already emits specific queries, so skip the broad/narrow check.
    if assume_specific:
        search_query = query
    else:
        spec = assess_specificity(query, llm)
        if not spec["specific"]:
            return {
                "status": "needs_clarification",
                "message": spec["message"] or "That's a bit broad — can you be more specific?",
                "suggestions": spec["suggestions"],
            }
        search_query = spec["search_query"]

    candidates: List[dict] = []
    for ch in channels:
        try:
            candidates.extend(search_fn(search_query, ch, 6))
        except Exception:
            continue
    if not candidates:
        return {
            "status": "not_found",
            "message": f"No videos found for {query!r} on the available channels.",
        }

    pick = pick_best(query, candidates, llm)
    idx = pick["best_index"]
    if idx is None or idx < 0 or idx >= len(candidates):
        return {
            "status": "not_found",
            "message": f"Couldn't find a closely matching video for {query!r}.",
        }
    return {"status": "found", "video": candidates[idx], "reason": pick["reason"]}
