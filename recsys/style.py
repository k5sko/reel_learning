"""P(fit) — per-clip style match on named axes.

Style is a small **named vector** (formality, humor, pace, …), 0–1 each. The user states theirs once
at onboarding (sliders); every clip is LLM-rated on the same axes at recommend time (cached). Fit =
how close the clip's axes are to the user's:

    P(fit | clip) = 1 − mean|clip_axes − user_axes|        ∈ (0,1)

Per-clip (not per-channel), interpretable, and **seeded by onboarding** so it's meaningful from
clip 1 — no cold-start 0.5-for-everything. Refined online by EMA toward the styles the user engages.
If the user hasn't onboarded (no `user_axes`), fit is neutral (`fit_default`) → ranking falls back
to P(good).
"""

from __future__ import annotations

import math
from typing import Optional

from .config import Settings, get_settings

STYLE_AXES = ["formality", "humor", "pace", "depth", "visual_style", "conciseness"]

# Human-readable poles — used in the LLM rating prompt and the onboarding UI.
AXIS_POLES = {
    "formality": ("casual", "formal"),
    "humor": ("serious", "funny"),
    "pace": ("slow & thorough", "fast & punchy"),
    "depth": ("intuitive overview", "rigorous depth"),
    "visual_style": ("talking head", "animated/visual"),
    "conciseness": ("leisurely", "concise"),
}


def default_axes() -> dict:
    return {a: 0.5 for a in STYLE_AXES}


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def p_fit(
    clip_axes: Optional[dict], user_axes: Optional[dict], cfg: Optional[Settings] = None
) -> float:
    """1 − mean axis distance, in (0,1). Neutral (`fit_default`) if either side is unset."""
    cfg = cfg or get_settings()
    if not user_axes or not clip_axes:
        return cfg.fit_default
    diffs = [abs(float(clip_axes.get(a, 0.5)) - float(user_axes.get(a, 0.5))) for a in STYLE_AXES]
    return _clamp01(1.0 - sum(diffs) / len(STYLE_AXES))


def log_p_fit(
    clip_axes: Optional[dict], user_axes: Optional[dict], cfg: Optional[Settings] = None
) -> float:
    cfg = cfg or get_settings()
    return math.log(max(p_fit(clip_axes, user_axes, cfg), cfg.prob_floor))


def fuse_obs(
    cfg: Settings,
    *,
    saved: bool = False,
    liked: bool = False,
    disliked: bool = False,
    watch_ratio: Optional[float] = None,
) -> Optional[float]:
    """One interaction → obs in [0,1] (explicit signals dominate watch). None if no signal."""
    if disliked:
        return cfg.dislike_obs
    if saved:
        return cfg.save_obs
    if liked:
        return cfg.like_obs
    if watch_ratio is not None:
        return _clamp01(0.5 + cfg.watch_slope * (watch_ratio - cfg.watch_base))
    return None


def update_user_axes(
    user_axes: Optional[dict], clip_axes: dict, obs: float, cfg: Optional[Settings] = None
) -> dict:
    """EMA the user's style toward (liked) / away from (disliked) a clip's axes.

    Signed by the obs: obs→1 pulls toward the clip's style, obs→0 pushes away, 0.5 is a no-op.
    """
    cfg = cfg or get_settings()
    a = cfg.fit_alpha
    s = 2.0 * obs - 1.0
    out = dict(user_axes or default_axes())
    for ax in STYLE_AXES:
        u = float(out.get(ax, 0.5))
        c = float(clip_axes.get(ax, 0.5))
        out[ax] = _clamp01(u + a * s * (c - u))
    return out
