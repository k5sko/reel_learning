"""Mastery + spaced repetition — the learning side of the loop.

- :class:`Mastery` — per-node knowledge estimate, EMA on problem pass/fail (knowledge-tracing-lite).
  Drives the UCB reward (``learning_need = 1 − mastery``) and the DAG frontier (a node is "mastered"
  at/above ``mastery_threshold``).
- :class:`SpacedRep` — per-node review schedule in units of *items served*. Pass pushes the next
  review out (interval ×= ease); fail resurfaces it soon (interval → min).

Pure state-tracking — no model, no training. Both serialize straight to Redis.
"""

from __future__ import annotations

from typing import Iterable, Optional

from .config import Settings, get_settings


class Mastery:
    def __init__(self, cfg: Optional[Settings] = None, scores: Optional[dict] = None):
        self.cfg = cfg or get_settings()
        self.scores: dict[str, float] = dict(scores or {})

    def get(self, node: str) -> float:
        return self.scores.get(node, 0.0)            # unseen concept assumed unknown

    def record(self, node: str, passed: bool) -> float:
        """EMA the node's mastery toward 1.0 (pass) or 0.0 (fail). Returns the new value."""
        a = self.cfg.mastery_alpha
        cur = self.scores.get(node, 0.0)
        self.scores[node] = (1 - a) * cur + a * (1.0 if passed else 0.0)
        return self.scores[node]

    def credit(self, node: str, amount: float) -> float:
        """Small additive mastery gain from watching a clip (vs the EMA from problem pass/fail).
        Lets a clip-only feed advance through the DAG instead of stalling on gated prereqs."""
        self.scores[node] = min(1.0, self.get(node) + amount)
        return self.scores[node]

    def is_mastered(self, node: str) -> bool:
        return self.get(node) >= self.cfg.mastery_threshold

    def learning_need(self, node: str) -> float:
        """UCB reward: high when the node is still unlearned, → 0 as it's mastered."""
        return 1.0 - self.get(node)

    def to_state(self) -> dict:
        return dict(self.scores)

    @classmethod
    def from_state(cls, state: dict, cfg: Optional[Settings] = None) -> "Mastery":
        return cls(cfg=cfg, scores=state)


class SpacedRep:
    """Per-node review schedule. Time is an integer item-counter the caller advances."""

    def __init__(self, cfg: Optional[Settings] = None, sched: Optional[dict] = None):
        self.cfg = cfg or get_settings()
        # node -> {"interval": int, "due_at": int}
        self.sched: dict[str, dict] = {k: dict(v) for k, v in (sched or {}).items()}

    def record(self, node: str, passed: bool, now: int) -> dict:
        """Pass → interval ×= ease (push review out); fail → interval = min (resurface soon)."""
        cur = self.sched.get(node, {"interval": self.cfg.review_min_interval, "due_at": now})
        if passed:
            interval = min(
                int(round(cur["interval"] * self.cfg.review_ease)), self.cfg.review_max_interval
            )
        else:
            interval = self.cfg.review_min_interval
        entry = {"interval": interval, "due_at": now + interval}
        self.sched[node] = entry
        return entry

    def is_due(self, node: str, now: int) -> bool:
        e = self.sched.get(node)
        return e is not None and e["due_at"] <= now

    def due_nodes(self, candidates: Iterable[str], now: int) -> list[str]:
        return [n for n in candidates if self.is_due(n, now)]

    def to_state(self) -> dict:
        return {k: dict(v) for k, v in self.sched.items()}

    @classmethod
    def from_state(cls, state: dict, cfg: Optional[Settings] = None) -> "SpacedRep":
        return cls(cfg=cfg, sched=state)
