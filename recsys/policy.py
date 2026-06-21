"""Stage 1 — topic/node selection via Sliding-Window UCB over the learnable frontier.

Arms = frontier nodes (not-yet-mastered, prereqs met). Reward (supplied by the caller) =
learning-need = ``1 − mastery[node]`` at the time of the pull. A **recent window** of plays gives
the forgetting needed for a non-stationary reward — mastery moves as the user learns, so stale
high-need observations must age out (Garivier & Moulines 2008, SW-UCB).

Pure: this module knows nothing about mastery or the DAG — it takes arms + rewards. The caller
computes the reward and passes the current frontier each ``select``.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Optional, Sequence

from .config import Settings, get_settings

_INF = float("inf")


class SlidingWindowUCB:
    """SW-UCB over a changing arm set. State = the recent (arm, reward) window + total pulls."""

    def __init__(
        self,
        cfg: Optional[Settings] = None,
        history: Optional[Sequence] = None,
        total: int = 0,
    ):
        self.cfg = cfg or get_settings()
        self.window: deque = deque(history or [], maxlen=self.cfg.ucb_window)
        self.total = total                          # lifetime pulls (may exceed window length)

    # ---- scores for the current frontier ----
    def scores(self, arms: Sequence[str]) -> dict[str, float]:
        """UCB index per arm. An arm absent from the window → +inf (must be explored)."""
        eff_t = max(1, min(self.total, self.cfg.ucb_window))   # ln guard; window-scaled horizon
        ln_t = math.log(eff_t)
        out: dict[str, float] = {}
        for a in arms:
            rewards = [r for (arm, r) in self.window if arm == a]
            n = len(rewards)
            if n == 0:
                out[a] = _INF                       # new / not-recently-seen → optimistic
            else:
                mean = sum(rewards) / n
                bonus = self.cfg.ucb_c * math.sqrt(ln_t / n)
                out[a] = mean + bonus
        return out

    # ---- pick the next node ----
    def select(self, arms: Sequence[str]) -> Optional[str]:
        """argmax UCB over the given frontier. Deterministic tie-break = first in ``arms``."""
        if not arms:
            return None
        s = self.scores(arms)
        best, best_score = None, -_INF
        for a in arms:                              # iterate arms (not dict) for stable tie-break
            if s[a] > best_score:
                best, best_score = a, s[a]
        return best

    # ---- record the realized reward of a pull ----
    def update(self, arm: str, reward: float) -> None:
        self.window.append((arm, float(reward)))    # deque(maxlen) drops the oldest automatically
        self.total += 1

    # ---- (de)serialize for Redis (rec:ucb) ----
    def to_state(self) -> dict:
        return {"window": [[a, r] for (a, r) in self.window], "total": self.total}

    @classmethod
    def from_state(cls, state: dict, cfg: Optional[Settings] = None) -> "SlidingWindowUCB":
        window = [tuple(x) for x in state.get("window", [])]
        return cls(cfg=cfg, history=window, total=int(state.get("total", 0)))
