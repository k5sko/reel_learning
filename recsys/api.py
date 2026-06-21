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
    """Thin-coverage live fetch — FULLY background (find_video does yt-dlp+LLM, ~seconds), so the
    recommend response never blocks on it. Deduped per concept + capped."""
    with _inflight_lock:
        if concept in _inflight_fetch:
            return {"status": "in_progress", "concept": concept}
        if len(_inflight_fetch) >= _MAX_INFLIGHT:
            return {"status": "busy"}
        _inflight_fetch.add(concept)

    def _run():
        try:
            import asyncio

            from clipper.finder import find_video
            from clipper.llm import LLMClient
            from clipper.pipeline import orchestrator

            res = find_video(concept, LLMClient(), assume_specific=True)
            if res.get("status") == "found":
                job_id = orchestrator.create_job(res["video"]["url"])
                asyncio.run(orchestrator.run_pipeline(job_id))
        except Exception:  # noqa: BLE001 — best-effort
            pass
        finally:
            with _inflight_lock:
                _inflight_fetch.discard(concept)

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "fetching", "concept": concept}


def _rate_styles_bg(to_rate: dict) -> None:
    """Rate uncached clip styles in a daemon thread + merge into the Redis cache — keeps the LLM
    call OFF the recommend hot path. Until ready, clips rank with neutral P(fit); warms next call."""
    items = [{"id": i, "text": t} for i, t in list(to_rate.items())[:40]]

    def _run():
        try:
            rated = recsys_llm.rate_clip_styles(items)
            if rated:
                st = _store()
                cur = st.get("clipstyle") or {}
                cur.update(rated)
                st.set("clipstyle", cur)
        except Exception:  # noqa: BLE001 — best-effort; neutral fit if it fails
            pass

    threading.Thread(target=_run, daemon=True).start()


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

    # exclude = this feed's shown list PLUS everything ever watched (persisted) -> never replay a clip
    excluded = set(body.exclude) | set(prof.meta.get("seen") or [])
    seen_jobs = {cid.rsplit("_c_", 1)[0] for cid in excluded}
    style_cache = store.get("clipstyle") or {}
    to_rate: dict = {}                                # uncached clips -> rated in the BACKGROUND
    items: list = []
    auto = None
    first_node = None
    recent = list(prof.meta.get("recent_nodes") or [])   # topic sliding window (persists across calls)
    # video cooldown: don't re-show a source video until ~1/3 of the other videos have appeared
    total_videos = len({r.job_id for r in corpus.records}) or 1
    cooldown = max(1, total_videos // 3)
    recent_videos = list(prof.meta.get("recent_videos") or [])

    for _ in range(max(1, body.n)):
        frontier = _frontier(prof)
        if not frontier:
            break
        # topic sliding window: skip nodes served in the last `topic_window` items if alternatives exist
        fresh = [x for x in frontier if x not in recent]
        node = prof.ucb.select(fresh if fresh else frontier)
        first_node = first_node or node
        concept = prof.dag.nodes[node]["text"]
        node_emb = prof.dag.nodes[node].get("emb")    # reuse stored embedding -> no encoder call
        blocked_videos = set(recent_videos[:cooldown])   # videos still on cooldown
        cands, coverage_ok, hits = retrieval.candidates_for(
            corpus, concept, cfg, exclude=excluded, query_vec=node_emb, exclude_jobs=blocked_videos
        )

        if user_axes:                               # queue uncached clips for BACKGROUND rating
            for r, _ in hits:
                if r.id not in style_cache and r.id not in to_rate:
                    to_rate[r.id] = r.text
        for c in cands:                             # neutral fit for not-yet-rated clips (warms in bg)
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
        jid = c.id.rsplit("_c_", 1)[0]
        seen_jobs.add(jid)
        recent_videos = [jid] + [v for v in recent_videos if v != jid]   # this video -> cooldown front
        recent.append(node)
        recent = recent[-cfg.topic_window:]

    prof.meta["recent_nodes"] = recent
    prof.meta["recent_videos"] = recent_videos[:total_videos]   # cap to corpus size
    # recommend only mutates UCB + meta -> write just those (skip serializing the big DAG every call)
    store.set("ucb", prof.ucb.to_state())
    store.set("profile", prof.meta)
    if to_rate:
        _rate_styles_bg(to_rate)                      # off the hot path -> warms P(fit) for next call

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
    diagnostic: bool = False  # prereq diagnostic result -> record mastery but DON'T expand deeper


@router.post("/api/feedback")
def feedback(body: FeedbackIn):
    cfg = get_settings()
    store = _store()
    prof = Profile.load(store, cfg)

    # mark the clip permanently seen once the user has scrolled past it (watch reported)
    if body.clip_id and body.watch_ratio is not None:
        seen = set(prof.meta.get("seen") or [])
        seen.add(body.clip_id)
        prof.meta["seen"] = sorted(seen)

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
        # fail -> discover prereqs (one level). diagnostic results never expand -> we stop digging
        # into prereqs-of-prereqs (a weak prereq just gets re-taught, not re-diagnosed).
        if not body.problem_passed and not body.diagnostic:
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


# --- prerequisite diagnostic: a failed node -> quiz ITS prereqs to find the weak one(s) ----------


class PrereqQuizIn(BaseModel):
    node: str


@router.post("/api/prereq-quiz")
def prereq_quiz(body: PrereqQuizIn):
    """One MCQ per prerequisite of `node` (discovering them first if needed). Each question is tagged
    with its prereq node id, so answering it diagnoses that specific prereq. ONE level only."""
    cfg = get_settings()
    store = _store()
    prof = Profile.load(store, cfg)
    if body.node not in prof.dag.nodes:
        return {"questions": []}
    prereqs = sorted(prof.dag.prereqs(body.node))
    if not prereqs:                                   # not expanded yet -> discover, persist
        _expand(prof, body.node)
        prof.save(store)
        prereqs = sorted(prof.dag.prereqs(body.node))
    if not prereqs:
        return {"questions": []}

    from clipper.quiz import generate_concept_quiz

    prereqs = prereqs[:6]                              # cap the diagnostic length
    concepts = [prof.dag.nodes[p]["text"] for p in prereqs if p in prof.dag.nodes]
    qs = generate_concept_quiz(concepts)
    out = []
    for q in qs:
        ci = q.get("concept_index", 0)
        if 0 <= ci < len(prereqs):
            out.append({**q, "node": prereqs[ci]})   # tag: answering -> diagnoses this prereq
    return {"questions": out}


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


def _cos(a, b) -> float:
    import math

    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


@router.get("/api/graph")
def graph():
    """Knowledge graph for the Obsidian-style map:
    - `goals` + `relations`: the topics the user queried, linked by conceptual similarity (overview).
    - `nodes` + `edges`: the full prerequisite DAG (drill-in skill tree per goal).
    """
    cfg = get_settings()
    store = _store()
    prof = Profile.load(store, cfg)
    goal_ids = [g for g in (prof.meta.get("goal_nodes") or []) if g in prof.dag.nodes]

    def node_obj(nid):
        nd = prof.dag.nodes[nid]
        return {
            "id": nid,
            "label": nd.get("text", nid),
            "depth": nd.get("depth", 0),
            "is_goal": nid in set(goal_ids),
            "mastery": round(prof.mastery.get(nid), 3),
            "mastered": prof.mastery.is_mastered(nid),
            "ready": nid in set(_frontier(prof)),
        }

    nodes = [node_obj(nid) for nid in prof.dag.nodes]
    edges = [{"from": p, "to": nid} for nid in prof.dag.nodes for p in prof.dag.prereqs(nid)]

    # conceptual relations between the user's TOPICS (goal-goal embedding similarity) — overview edges
    relations = []
    embs = {g: prof.dag.nodes[g].get("emb") for g in goal_ids}
    for i in range(len(goal_ids)):
        for j in range(i + 1, len(goal_ids)):
            w = _cos(embs[goal_ids[i]], embs[goal_ids[j]])
            if w >= 0.30:
                relations.append({"from": goal_ids[i], "to": goal_ids[j], "weight": round(w, 3)})

    return {
        "goals": [node_obj(g) for g in goal_ids],
        "relations": relations,
        "nodes": nodes,
        "edges": edges,
        "frontier": _frontier(prof),
    }


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
