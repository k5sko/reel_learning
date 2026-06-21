"""P(good) — term 1 of the ranker: P(a random viewer likes the clip | seen).

`likes/views` is already a probability (fraction of viewers who liked it), grounded in real
behavior and exposure-normalized. We just **Beta-Binomial smooth** it so thin-view clips shrink
toward the corpus prior instead of getting extreme scores:

    P(good) = (likes + α₀) / (views + α₀ + β₀)        # posterior mean

A clip with no stats (cold start) falls back to the prior mean α₀/(α₀+β₀); a trained
content→P(good) head can replace that fallback later (optional, not built).
"""

from __future__ import annotations

import math
from typing import Optional

from .config import Settings, get_settings


def p_good(
    likes: Optional[float],
    views: Optional[float],
    cfg: Optional[Settings] = None,
) -> float:
    """Beta-smoothed like:view in (0,1). Missing/zero stats → the prior mean."""
    cfg = cfg or get_settings()
    a0, b0 = cfg.good_alpha0, cfg.good_beta0
    lk = max(0.0, likes or 0.0)
    vw = max(0.0, views or 0.0)
    # likes can't exceed views; guard dirty data so the posterior stays in (0,1).
    lk = min(lk, vw) if vw > 0 else 0.0
    return (lk + a0) / (vw + a0 + b0)


def log_p_good(
    likes: Optional[float],
    views: Optional[float],
    cfg: Optional[Settings] = None,
) -> float:
    cfg = cfg or get_settings()
    return math.log(max(p_good(likes, views, cfg), cfg.prob_floor))


def prior_mean(cfg: Optional[Settings] = None) -> float:
    """The cold-start P(good) for a clip with no view/like data."""
    cfg = cfg or get_settings()
    return cfg.good_alpha0 / (cfg.good_alpha0 + cfg.good_beta0)
