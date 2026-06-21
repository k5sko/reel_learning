"""The single-user profile store — Redis when ``REDIS_URL`` is set, in-memory dict otherwise
(mirrors ``server/store.js``: same env var, graceful fallback, JSON values).

`ProfileStore` is the raw key→JSON layer (keys namespaced ``rec:*``). `Profile` bundles the domain
objects (channel-fit, mastery, spaced-rep, DAG, UCB, meta) and load/saves them as one unit — this is
what ``api.py`` reads at the start of a request and writes at the end.
"""

from __future__ import annotations

import json
from typing import Optional

from .config import Settings, get_settings
from .dag import DAG
from .mastery import Mastery, SpacedRep
from .policy import SlidingWindowUCB


class ProfileStore:
    """key → JSON dict, in Redis or an in-memory dict. One user, so plain string keys (no hashes)."""

    def __init__(self, cfg: Optional[Settings] = None):
        self.cfg = cfg or get_settings()
        self.prefix = self.cfg.redis_prefix
        self._mem: dict[str, dict] = {}
        self.redis = None
        if self.cfg.redis_url:
            try:
                import redis  # optional dep; only needed when REDIS_URL is set

                self.redis = redis.Redis.from_url(self.cfg.redis_url, decode_responses=True)
                self.redis.ping()
            except Exception as e:  # noqa: BLE001 — fall back to memory, never hard-fail
                print(f"[recsys.state] redis unavailable ({e}); using in-memory store")
                self.redis = None

    def _k(self, name: str) -> str:
        return f"{self.prefix}{name}"

    def get(self, name: str) -> Optional[dict]:
        if self.redis is not None:
            raw = self.redis.get(self._k(name))
            return json.loads(raw) if raw else None
        return self._mem.get(name)

    def set(self, name: str, value: dict) -> None:
        if self.redis is not None:
            self.redis.set(self._k(name), json.dumps(value))
        else:
            self._mem[name] = value

    @property
    def backend(self) -> str:
        return "redis" if self.redis is not None else "memory"


class Profile:
    """The whole single-user state, reconstituted from / flushed to a ProfileStore."""

    def __init__(
        self,
        cfg: Optional[Settings] = None,
        *,
        mastery: Optional[Mastery] = None,
        spaced: Optional[SpacedRep] = None,
        dag: Optional[DAG] = None,
        ucb: Optional[SlidingWindowUCB] = None,
        meta: Optional[dict] = None,
    ):
        self.cfg = cfg or get_settings()
        self.mastery = mastery or Mastery(self.cfg)
        self.spaced = spaced or SpacedRep(self.cfg)
        self.dag = dag or DAG(self.cfg)
        self.ucb = ucb or SlidingWindowUCB(self.cfg)
        # meta: goals, kappa slider, item-counter t, user_style (axes dict | None until onboarded)
        self.meta = meta or {"goals": [], "kappa": self.cfg.kappa, "t": 0, "user_style": None}

    @classmethod
    def load(cls, store: ProfileStore, cfg: Optional[Settings] = None) -> "Profile":
        cfg = cfg or store.cfg
        ucb = store.get("ucb") or {}
        return cls(
            cfg=cfg,
            mastery=Mastery.from_state(store.get("mastery") or {}, cfg),
            spaced=SpacedRep.from_state(store.get("review") or {}, cfg),
            dag=DAG(cfg, state=store.get("dag") or None),
            ucb=SlidingWindowUCB.from_state(ucb, cfg) if ucb else SlidingWindowUCB(cfg),
            meta=store.get("profile") or None,
        )

    def save(self, store: ProfileStore) -> None:
        store.set("mastery", self.mastery.to_state())
        store.set("review", self.spaced.to_state())
        store.set("dag", self.dag.to_state())
        store.set("ucb", self.ucb.to_state())
        store.set("profile", self.meta)
