"""Env-driven settings for the recommender. All tunables live here.

Plain-dataclass + ``os.environ`` (no pydantic) so the pure-logic core (policy, style, mastery,
quality, ranking, dag) imports with **stdlib only** and stays trivially testable. Overrides come
from ``RECSYS_<FIELD>`` env vars; ``REDIS_URL`` is read bare so the Python store and the Node
store (``server/store.js``) agree on one variable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, fields
from functools import lru_cache
from typing import Optional


@dataclass
class Settings:
    # --- profile store -----------------------------------------------------
    redis_url: Optional[str] = None          # set -> Redis; unset -> in-memory dict
    redis_prefix: str = "rec:"

    # --- content encoder (candidate ANN) -----------------------------------
    content_encoder: str = "sentence-transformers/all-MiniLM-L6-v2"
    content_dim: int = 384
    ann_top_k: int = 150                     # candidates per frontier node
    retrieval_min_sim: float = 0.25          # top-hit cosine below this -> thin coverage -> auto-query

    # --- ranking: score = log P(good|c) + kappa*log P(fit|c) - repeat penalty -------------------
    # (relevance is a candidate FILTER in retrieval, not a score term; it only breaks score ties.)
    kappa: float = 1.0                       # user slider "Popular <-> For You" (0 = pure P(good))
    repeat_video_penalty: float = 8.0        # strong: avoid same-video clips back-to-back (only if no other video available)
    topic_window: int = 3                     # don't re-serve a topic/node within this many items (if alternatives exist)
    prob_floor: float = 1e-4                 # clamp probs before log() so neither term explodes

    # --- P(good): Beta-smoothed like:view ----------------------------------
    # posterior mean = (likes + good_alpha0) / (views + good_alpha0 + good_beta0)
    good_alpha0: float = 5.0                 # prior pseudo-likes
    good_beta0: float = 95.0                 # prior pseudo-(non-likes) -> prior mean 0.05

    # --- P(fit): per-channel style fit (LLM prior + EMA) -------------------
    fit_alpha: float = 0.15                  # EMA step toward observed obs
    fit_default: float = 0.5                 # fallback fit before any LLM prior / data
    # fused obs in [0,1] from one interaction. Explicit signals dominate the implicit watch
    # signal (more faithful to "did they like it"); watch is the weak fallback.
    save_obs: float = 1.0
    like_obs: float = 0.9
    dislike_obs: float = 0.0
    watch_slope: float = 0.3                 # obs = 0.5 + slope*(watch_ratio - watch_base)
    watch_base: float = 0.35

    # --- mastery / DAG -----------------------------------------------------
    mastery_threshold: float = 0.7           # node "mastered" at/above this
    mastery_alpha: float = 0.4               # running-rate EMA on pass/fail
    watch_credit: float = 0.18               # mastery bump per fully-watched clip (advances the DAG)
    dag_max_depth: int = 6                   # knowledge floor (~high school) guard
    dedup_cos: float = 0.88                  # merge DAG nodes whose concept embeddings exceed this

    # --- spaced repetition (review scheduling, units = items served) -------
    review_ease: float = 2.0                 # pass -> interval *= ease
    review_min_interval: int = 1             # fail -> resurface in this many items
    review_max_interval: int = 64            # cap so reviews don't drift infinitely out

    # --- Sliding-Window UCB (topic/node selection) -------------------------
    ucb_window: int = 50                     # W: recent plays kept (non-stationary forgetting)
    ucb_c: float = 1.0                       # exploration strength

    # --- pacing ------------------------------------------------------------
    clips_before_problem: int = 4            # inject a problem after N clips on a node
    max_problem_fraction: float = 0.4        # cap problems so they don't dominate


def _coerce(raw: str, default):
    if isinstance(default, bool):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(default, int):
        return int(raw)
    if isinstance(default, float):
        return float(raw)
    return raw


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    s = Settings()
    for f in fields(s):
        env = "REDIS_URL" if f.name == "redis_url" else f"RECSYS_{f.name.upper()}"
        if env in os.environ and os.environ[env] != "":
            setattr(s, f.name, _coerce(os.environ[env], f.default))
    return s
