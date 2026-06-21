"""The recommender API — a router mounted into clipper's FastAPI app (`app.include_router`).

One uvicorn, one `/api` namespace. Corpus = clipper's READY clips. Single-user profile in Redis.
Per request: load profile → DAG/UCB pick a frontier node → ANN candidates (filtered on-topic) →
rate their style on named axes → rank by `log P(good) + κ·log P(fit)` → serve → feedback updates
mastery (DAG) and the user's style vector (EMA).
"""

from __future__ import annotations

import math
import threading
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from . import llm as recsys_llm
from . import ranking, retrieval
from . import style as recsys_style
from .config import get_settings
from .state import Profile, ProfileStore

router = APIRouter()


def _store() -> ProfileStore:
    return ProfileStore(get_settings())


def _mastered_set(prof: Profile) -> set:
    return {nid for nid in prof.dag.nodes if prof.mastery.is_mastered(nid)}


def _frontier(prof: Profile) -> list:
    return prof.dag.frontier(_mastered_set(prof))


def _clean_axes(axes: dict) -> dict:
    return {a: min(1.0, max(0.0, float(axes.get(a, 0.5)))) for a in recsys_style.STYLE_AXES}


# --- onboarding: capture the learner's style up front -----------------------


class OnboardIn(BaseModel):
    axes: dict                                       # {axis: 0..1} on STYLE_AXES


@router.post("/api/onboard")
def onboard(body: OnboardIn):
    cfg = get_settings()
    store = _store()
    prof = Profile.load(store, cfg)
    prof.meta["user_style"] = _clean_axes(body.axes)
    prof.save(store)
    return {"ok": True, "user_style": prof.meta["user_style"], "axes": recsys_style.STYLE_AXES}


@router.get("/api/style-axes")
def style_axes():
    """The axis list + human-readable poles — drives the onboarding sliders."""
    return {"axes": recsys_style.STYLE_AXES, "poles": recsys_style.AXIS_POLES}


# --- session: state goals, build DAG roots ---------------------------------


class SessionIn(BaseModel):
    goals: list[str]
    kappa: Optional[float] = None
    user_style: Optional[dict] = None                # carry onboarding through if set here


@router.post("/api/session")
def session(body: SessionIn):
    cfg = get_settings()
    store = _store()
    prof = Profile.load(store, cfg)                  # ACCUMULATE — the graph of all queries grows
    goals = [g.strip() for g in body.goals if g.strip()]
    new_goal_ids = []
    if goals:
        from .encoders import embed

        for g, v in zip(goals, embed(goals)):
            nid = prof.dag.add_node(g, depth=0, emb=v.tolist())
            new_goal_ids.append(nid)
    # cumulative goal list + which DAG nodes are goals (roots)
    allgoals = list(prof.meta.get("goals") or [])
    for g in goals:
        if g not in allgoals:
            allgoals.append(g)
    prof.meta["goals"] = allgoals
    goal_nodes = set(prof.meta.get("goal_nodes") or [])
    goal_nodes.update(new_goal_ids)
    prof.meta["goal_nodes"] = sorted(goal_nodes)
    if body.kappa is not None:
        prof.meta["kappa"] = body.kappa
    if body.user_style is not None:
        prof.meta["user_style"] = _clean_axes(body.user_style)
    # Expand each NEW goal one level so its prerequisites EXIST before we ever serve the goal's
    # material — the frontier then starts at the prereqs and the goal stays gated until they're met.
    for nid in new_goal_ids:
        _expand(prof, nid)
    prof.save(store)
    return {
        "ok": True,
        "goals": allgoals,
        "frontier": _frontier(prof),
        "backend": store.backend,
        "onboarded": prof.meta.get("user_style") is not None,
    }


# --- recommend: UCB node -> candidates -> style-rate -> rank ----------------


class RecommendIn(BaseModel):
    n: int = 1
    refresh_corpus: bool = False
    exclude: list[str] = []                           # clip ids already shown -> don't re-serve


def _run_pipeline_bg(job_id: str, concept: str) -> None:
    import asyncio

    from clipper.pipeline import orchestrator

    def _run():
        try:
            asyncio.run(orchestrator.run_pipeline(job_id))
        except Exception:  # noqa: BLE001 — pipeline records its own error on the Job row
            pass
        finally:
            with _inflight_lock:
                _inflight_fetch.discard(concept)

    threading.Thread(target=_run, daemon=True).start()


# Guard auto-query so repeated thin-coverage recommends don't pile up duplicate downloads.
_inflight_fetch: set = set()
_inflight_lock = threading.Lock()
_MAX_INFLIGHT = 2


def _auto_query(concept: str) -> dict:
    """Best-effort live fetch when a node has thin clip coverage. Deduped per concept + capped."""
    with _inflight_lock:
        if concept in _inflight_fetch:
            return {"status": "in_progress", "concept": concept}
        if len(_inflight_fetch) >= _MAX_INFLIGHT:
            return {"status": "busy"}
        _inflight_fetch.add(concept)
    try:
        from clipper.finder import find_video
        from clipper.llm import LLMClient
        from clipper.pipeline import orchestrator

        res = find_video(concept, LLMClient(), assume_specific=True)
        if res.get("status") != "found":
            with _inflight_lock:
                _inflight_fetch.discard(concept)
            return {"status": res.get("status", "not_found")}
        job_id = orchestrator.create_job(res["video"]["url"])
        _run_pipeline_bg(job_id, concept)
        return {"status": "started", "job_id": job_id, "video": res["video"]}
    except Exception as e:  # noqa: BLE001
        with _inflight_lock:
            _inflight_fetch.discard(concept)
        return {"status": "error", "detail": str(e)}


def _clip_styles(hits, store, user_axes) -> dict:
    """{clip_id: axes} for the candidates. LLM-rate uncached ones (only when the user is onboarded —
    no preference means no point spending the call). Cached in Redis `rec:clipstyle`."""
    if not user_axes:
        return {}
    cache = store.get("clipstyle") or {}
    missing = [{"id": r.id, "text": r.text} for r, _ in hits if r.id not in cache]
    if missing:
        rated = recsys_llm.rate_clip_styles(missing[:30])
        if rated:
            cache.update(rated)
            store.set("clipstyle", cache)
    return cache


@router.post("/api/recommend")
def recommend(body: RecommendIn):
    """Return up to n items, each from a DIFFERENT UCB-rotated frontier node, so the feed
    interleaves topics instead of dumping one node's clips in a row. Per node: best on-topic clip
    by `log P(good) + κ·log P(fit)` (style-rated on axes)."""
    cfg = get_settings()
    store = _store()
    prof = Profile.load(store, cfg)
    corpus = retrieval.get_corpus(refresh=body.refresh_corpus, cfg=cfg)
    user_axes = prof.meta.get("user_style")
    kappa = prof.meta.get("kappa")

    excluded = set(body.exclude)
    seen_jobs = {cid.rsplit("_c_", 1)[0] for cid in body.exclude}
    style_cache = store.get("clipstyle") or {}
    cache_dirty = False
    items: list = []
    auto = None
    first_node = None

    for _ in range(max(1, body.n)):
        frontier = _frontier(prof)
        if not frontier:
            break
        node = prof.ucb.select(frontier)            # UCB rotates the node each iteration
        first_node = first_node or node
        concept = prof.dag.nodes[node]["text"]
        cands, coverage_ok, hits = retrieval.candidates_for(corpus, concept, cfg, exclude=excluded)

        if user_axes:                               # rate uncached candidate styles (cached in Redis)
            missing = [{"id": r.id, "text": r.text} for r, _ in hits if r.id not in style_cache]
            if missing:
                rated = recsys_llm.rate_clip_styles(missing[:30])
                if rated:
                    style_cache.update(rated)
                    cache_dirty = True
        for c in cands:
            c.log_fit = recsys_style.log_p_fit(style_cache.get(c.id), user_axes, cfg)

        scored = ranking.score_candidates(cands, cfg, kappa=kappa, seen_jobs=seen_jobs)
        prof.ucb.update(node, prof.mastery.learning_need(node))   # count the visit -> rotation
        prof.meta["t"] = int(prof.meta.get("t", 0)) + 1
        if not scored:
            if not coverage_ok and auto is None:
                auto = _auto_query(concept)         # thin node -> fetch (once per call)
            continue
        s = scored[0]
        c = s.candidate
        items.append({
            "clip_id": c.id,
            "node": node,
            "concept": concept,
            "channel": c.channel,
            "score": s.score,
            "p_good": math.exp(s.log_good),
            "p_fit": math.exp(s.log_fit),
            "relevance": s.relevance,
        })
        excluded.add(c.id)
        seen_jobs.add(c.id.rsplit("_c_", 1)[0])

    if cache_dirty:
        store.set("clipstyle", style_cache)
    prof.save(store)

    status = "ok" if items else ("empty" if not _frontier(prof) else "thin")
    return {
        "status": status,
        "node": first_node,
        "onboarded": user_axes is not None,
        "auto_query": auto,
        "items": items,
    }


# --- feedback: engagement -> style EMA ; problem -> mastery / spaced-rep / expand ---


class FeedbackIn(BaseModel):
    clip_id: Optional[str] = None
    saved: bool = False
    liked: bool = False
    disliked: bool = False
    watch_ratio: Optional[float] = None
    node: Optional[str] = None
    problem_passed: Optional[bool] = None


@router.post("/api/feedback")
def feedback(body: FeedbackIn):
    cfg = get_settings()
    store = _store()
    prof = Profile.load(store, cfg)

    # clip engagement -> move the user's style vector toward/away from the clip's axes
    if body.clip_id:
        obs = recsys_style.fuse_obs(
            cfg,
            saved=body.saved,
            liked=body.liked,
            disliked=body.disliked,
            watch_ratio=body.watch_ratio,
        )
        if obs is not None:
            clip_axes = (store.get("clipstyle") or {}).get(body.clip_id)
            if clip_axes:
                prof.meta["user_style"] = recsys_style.update_user_axes(
                    prof.meta.get("user_style"), clip_axes, obs, cfg
                )

    if body.node and body.problem_passed is not None:
        prof.mastery.record(body.node, body.problem_passed)
        prof.spaced.record(body.node, body.problem_passed, now=int(prof.meta.get("t", 0)))
        if not body.problem_passed:
            _expand(prof, body.node)
    elif body.node and body.watch_ratio is not None:
        # clip watched (no problem): small mastery credit so the node eventually unlocks dependents
        prof.mastery.credit(body.node, cfg.watch_credit * body.watch_ratio)

    prof.save(store)
    return {
        "ok": True,
        "mastery": prof.mastery.to_state(),
        "frontier": _frontier(prof),
        "user_style": prof.meta.get("user_style"),
    }


def _expand(prof: Profile, node: str) -> None:
    concept = prof.dag.nodes.get(node, {}).get("text")
    if not concept:
        return
    prereqs = recsys_llm.decompose_prereqs(concept)
    if not prereqs:
        return
    from .encoders import embed

    embs = [v.tolist() for v in embed(prereqs)]
    prof.dag.expand(node, prereqs, embs=embs)


# --- debug view ------------------------------------------------------------


@router.get("/api/graph")
def graph():
    """The knowledge graph: every queried goal + its prerequisite DAG, with mastery per node.
    Powers the Obsidian-style map (goals as roots; click a goal -> its prereq subtree)."""
    cfg = get_settings()
    store = _store()
    prof = Profile.load(store, cfg)
    goal_nodes = set(prof.meta.get("goal_nodes") or [])
    nodes = [
        {
            "id": nid,
            "label": nd.get("text", nid),
            "depth": nd.get("depth", 0),
            "is_goal": nid in goal_nodes,
            "mastery": round(prof.mastery.get(nid), 3),
            "mastered": prof.mastery.is_mastered(nid),
        }
        for nid, nd in prof.dag.nodes.items()
    ]
    edges = [
        {"from": p, "to": nid}                       # prereq -> node it unlocks
        for nid in prof.dag.nodes
        for p in prof.dag.prereqs(nid)
    ]
    return {"nodes": nodes, "edges": edges, "goals": sorted(goal_nodes), "frontier": _frontier(prof)}


@router.get("/api/profile")
def profile():
    cfg = get_settings()
    store = _store()
    prof = Profile.load(store, cfg)
    return {
        "backend": store.backend,
        "meta": prof.meta,
        "user_style": prof.meta.get("user_style"),
        "mastery": prof.mastery.to_state(),
        "frontier": _frontier(prof),
        "nodes": {k: v["text"] for k, v in prof.dag.nodes.items()},
    }
