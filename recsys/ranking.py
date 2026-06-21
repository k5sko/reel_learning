"""Stage 3 — the ranker. Of a frontier node's candidates, pick the clip most likely
**good** (term 1) and most on-**fit** (term 2):

    score(c) = log P(good|c) + κ · log P(fit|c)         # = P(good)·P(fit)^κ
    next     = argmax_c score(c)

Both terms are genuine probabilities in (0,1), so no standardization is needed. κ is the single
"Popular ↔ For You" slider (0 → pure P(good); ↑ → tilt toward per-channel fit). Topic is already
fixed by the DAG upstream, so this only chooses good + on-vibe clips within what the user needs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

from .config import Settings, get_settings
from .quality import log_p_good

_LOG_HALF = math.log(0.5)


@dataclass
class Candidate:
    id: str
    channel: Optional[str] = None
    likes: Optional[float] = None
    views: Optional[float] = None
    relevance: float = 0.0                  # retrieval cosine to the node concept (topical match)
    job_id: Optional[str] = None            # source video — for diversity penalty
    log_fit: float = _LOG_HALF             # log P(fit): set by caller from per-clip style match


@dataclass
class Scored:
    candidate: Candidate
    score: float
    log_good: float
    log_fit: float
    relevance: float = 0.0


def score_candidates(
    candidates: Sequence[Candidate],
    cfg: Optional[Settings] = None,
    kappa: Optional[float] = None,
    seen_jobs: Optional[set] = None,
) -> list[Scored]:
    """Score each candidate; returns Scored sorted best→worst.

    `score = log P(good) + κ·log P(fit) − repeat_penalty`, where `P(fit)` is the candidate's
    precomputed per-clip style match (`log_fit`). `kappa` overrides cfg (the slider); `seen_jobs`
    = videos already shown → penalized for diversity. Relevance only breaks score ties.
    """
    cfg = cfg or get_settings()
    k = cfg.kappa if kappa is None else kappa
    seen = seen_jobs or set()
    out = []
    for c in candidates:
        lg = log_p_good(c.likes, c.views, cfg)
        penalty = cfg.repeat_video_penalty if (c.job_id and c.job_id in seen) else 0.0
        score = lg + k * c.log_fit - penalty   # quality x style (candidates are already on-topic)
        out.append(Scored(candidate=c, score=score, log_good=lg, log_fit=c.log_fit, relevance=c.relevance))
    out.sort(key=lambda s: (s.score, s.relevance), reverse=True)
    return out


def rank(
    candidates: Sequence[Candidate],
    cfg: Optional[Settings] = None,
    kappa: Optional[float] = None,
    seen_jobs: Optional[set] = None,
) -> Optional[Candidate]:
    """argmax — the next clip to serve, or None if there are no candidates."""
    scored = score_candidates(candidates, cfg, kappa, seen_jobs)
    return scored[0].candidate if scored else None
