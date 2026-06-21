"""The prerequisite knowledge DAG — the spine of the learning loop.

Nodes = concepts (≈ one clip's worth); edges = "A is a prerequisite of B". The DAG grows **lazily**:
when the learner fails a node, the caller asks an LLM for that node's prerequisites and feeds the
texts to :meth:`DAG.expand` (this module never calls the LLM — kept pure + testable). A **depth cap**
(``dag_max_depth``) is the high-school knowledge floor; **dedup** merges near-duplicate concepts so
shared prerequisites don't fork the graph.

The **frontier** = nodes not-yet-mastered whose prerequisites are all mastered = "ready to learn now"
— that's what UCB (``policy.py``) selects over.
"""

from __future__ import annotations

import math
from typing import Iterable, Optional, Sequence

from .config import Settings, get_settings


def _canon(text: str) -> str:
    return " ".join(text.lower().split())


def _cos(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class DAG:
    def __init__(self, cfg: Optional[Settings] = None, state: Optional[dict] = None):
        self.cfg = cfg or get_settings()
        # id (canonical concept text) -> {"text", "depth", "emb"}
        self.nodes: dict[str, dict] = {}
        # node id -> set of prerequisite ids
        self._prereqs: dict[str, set] = {}
        if state:
            self._load(state)

    # ---- build ----
    def add_node(
        self, text: str, depth: int = 0, emb: Optional[Sequence[float]] = None
    ) -> str:
        """Add a concept, returning its id. Dedups: exact canonical match, or embedding
        cosine ≥ ``dedup_cos`` against an existing node → returns that existing id (merge)."""
        key = _canon(text)
        if key in self.nodes:
            return key
        if emb is not None:
            for nid, nd in self.nodes.items():
                if nd["emb"] is not None and _cos(emb, nd["emb"]) >= self.cfg.dedup_cos:
                    return nid
        self.nodes[key] = {"text": text, "depth": depth, "emb": list(emb) if emb else None}
        self._prereqs.setdefault(key, set())
        return key

    def add_edge(self, prereq_id: str, node_id: str) -> None:
        """Record that ``prereq_id`` must be mastered before ``node_id``."""
        self._prereqs.setdefault(node_id, set()).add(prereq_id)

    def expand(
        self,
        node_id: str,
        prereq_texts: Sequence[str],
        embs: Optional[Sequence[Sequence[float]]] = None,
    ) -> list[str]:
        """Lazy growth: attach LLM-suggested prerequisites below ``node_id``. No-op past the
        depth cap (the high-school floor). Returns the prerequisite node ids (new or merged)."""
        depth = self.nodes[node_id]["depth"]
        if depth >= self.cfg.dag_max_depth:
            return []
        ids = []
        for i, t in enumerate(prereq_texts):
            e = embs[i] if embs is not None else None
            pid = self.add_node(t, depth=depth + 1, emb=e)
            self.add_edge(pid, node_id)
            ids.append(pid)
        return ids

    # ---- query ----
    def prereqs(self, node_id: str) -> set:
        return set(self._prereqs.get(node_id, set()))

    def frontier(self, mastered: Iterable[str]) -> list[str]:
        """Nodes not yet mastered whose prerequisites are all mastered = ready to learn."""
        done = set(mastered)
        return [
            nid
            for nid in self.nodes
            if nid not in done and self._prereqs.get(nid, set()).issubset(done)
        ]

    # ---- (de)serialize for Redis (rec:dag) ----
    def to_state(self) -> dict:
        return {
            "nodes": self.nodes,
            "prereqs": {k: sorted(v) for k, v in self._prereqs.items()},
        }

    def _load(self, state: dict) -> None:
        self.nodes = dict(state.get("nodes", {}))
        self._prereqs = {k: set(v) for k, v in state.get("prereqs", {}).items()}
        for nid in self.nodes:
            self._prereqs.setdefault(nid, set())
