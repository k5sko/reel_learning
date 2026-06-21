# Learning Feed Recommender — Design

**Created:** 2026-06-20  ·  **Last updated:** 2026-06-21
**Status:** Design (converged). Live stack needs **no trained model**. D2Q removed entirely (notebook deleted).
**Context:** Hackathon. Single-user learning feed.

---

## 1. Product

A TikTok/Reels-style vertical feed for **learning**. The user states one or more things they
want to learn (e.g. *eigenvectors*, *how pendulums work*). We serve one blended, continuous stream
of short items covering all goals — no thumbnails, no clicking, just scroll.

Two item types:
- **Clips** — short segments cut from YouTube, with transcripts (produced by the `clipper` pipeline).
- **Problems** — LLM-generated practice problems. Success = proxy for learning.

**Scale: single user per session, small (not social media).** Defining constraint — no user
population, so nothing is learned across users. The live system leans on **frozen encoders +
LLM-at-runtime + real metadata + online state + direct user controls**, not on a trained ranker.

---

## 2. Goals & Non-Goals

**Goals**
- Multi-goal blended feed (clips + problems), one item at a time.
- A **prerequisite knowledge DAG** per goal, grown lazily, that paces the learner from what they
  know up to what they want — mastery-gated.
- A probabilistic clip ranker: `argmax P(good) · P(style fits)^κ`, both grounded/online, **untrained**.
- A learning loop: problem success → mastery → paces topics + advances the DAG frontier.
- Inference API mounted into the existing `clipper` app; one-user profile persisted in Redis.

**Non-Goals**
- Video/audio multimodal (frames, audio). Transcript + problem **text** only.
- Cross-user / population learning (single-user — no population exists).
- Online *training* of any model (won't converge on one user's sparse data). Online **state
  tracking** (mastery, style target) is deterministic, not model training.
- A trained live ranker. Live ranking is a probabilistic objective over **measured** quantities
  (like:view) + **online** state (style target). No watch-time model is served.
- Replicating "the YouTube algorithm" — its watch-time logs are proprietary; public substitutes
  (KuaiRec/MIND/MicroLens) are borrowed-domain priors no better than our own clips' real metadata.

---

## 3. Architecture — DAG-gated funnel, served one item at a time

```
USER states N goals
        │  per goal: LLM-decompose into a prerequisite DAG (lazy); short adaptive PLACEMENT quiz
        ▼  STAGE 1  TOPIC/NODE SELECTION              — Sliding-Window UCB over the learnable FRONTIER
  frontier = nodes not-yet-mastered whose prereqs ARE mastered
  arm = frontier node; reward = learning-need (1 − mastery); pick node*
        │
        ▼  STAGE 2  CANDIDATE GENERATION              — content ANN for node*  (auto-fetch if none)
  embed(node* concept) → FAISS over clip content_vecs → on-topic candidates
  if coverage thin → live clipper fetch+clip for node*
        │  ~tens–hundreds of on-node candidates
        ▼  STAGE 3  RANKING                           — probabilistic, untrained
  score(c) = z(log P(good|c)) + κ · cos(style_vec_c, s_goal)
  next = argmax_c score(c)
        │
        ▼  serve 1 item → observe → update mastery / style / frontier → loop
  (clip vs problem: pacing rule; problem pass/fail → mastery → spaced-rep + frontier advance)
```

**Who picks what:** UCB picks the **frontier node** (which gap to teach next); ranking picks the
**clip** within that node. The DAG enforces prerequisites (don't teach Y before its prereqs).

**Compute funnel:** candidate ANN is cheap; ranking runs only on the on-node candidates. Encoders
run **offline at ingest** (per-clip `content_vec`, `style_vec`) — never at rank time.

---

## 4. The unifying idea: everything is text

Every feature — clip, problem, DAG node/concept, stated goal — is serialized to a short string and
embedded. One vector space; new clips/concepts embed fine (cold-start solved); no ID embeddings.
Lineage: UniSRec / Recformer / P5.

```
clip     → "short video. caption: how eigenvectors work. category: Math > Linear Algebra."
concept  → "diagonalization of a matrix"            (a DAG node)
goal     → "learn eigenvectors"
```

---

## 5. Encoders + style representation

- **Content encoder** — `all-MiniLM-L6-v2` (384-d). Topic. Used for candidate ANN (and the optional
  cold-start `P(good)` head). Live corpus is English → English MiniLM suffices. Precomputed at ingest.
- **No style encoder.** Style is handled by a **per-channel fit scalar** (§9b), not an embedding —
  in educational YouTube, style is overwhelmingly channel-determined, and clipper draws from a small
  **vetted channel set**, so a per-channel preference is the faithful, cheap, data-efficient signal.
  An LLM provides the cold-start fit value; user interactions refine it. (Wegmann/style-embedding/
  vMF/cosine all dropped — see §20.)

---

## 6. The prerequisite DAG + mastery (the spine of the learning loop)

For each goal, build a **prerequisite DAG**: nodes = concepts (≈ one clip's worth), edges =
prerequisite relations. Mastery lives on nodes.

- **Node** — a concept teachable in a 1–3 min clip. `content_vec(concept)` is its embedding.
- **Edge** — "must know A before B." It's a **DAG** (concepts share prereqs) — dedup nodes on insert
  by canonical name / `content_vec` cosine > τ, so subgraphs don't duplicate.
- **Frontier** — nodes not-yet-mastered whose prereqs are all mastered = "ready to learn now."
- **Mastery[node] ∈ [0,1]** — from the placement quiz + problem pass/fail. Node "mastered" ≥ θ.
- **Gating** — a node can't be served until its prereqs are green. (Soft gate: advisory, since
  LLM-built edges are noisy — allow fallback if a node's clips aren't landing.)

**Lazy "go-as-you-need" expansion:**
```
start at the goal node → probe →
  PASS → mastered (move toward goal)
  FAIL → LLM-expand: prerequisites of THIS node → add nodes → probe those
         recurse DOWN until reaching nodes already known   ← natural stop
then teach UPWARD from the known frontier toward the goal.
```
Failure drives downward growth; mastery drives upward progress. Only the slice from "what they
know" to "what they want" is ever built.

**Bounds (so it doesn't explode):**
- **Knowledge floor = high school.** Don't decompose below it. Plus a **depth cap**.
- **Granularity** — LLM prompted to emit clip-sized concepts.
- **Probe economy** (see §10) — knowing an advanced node implies knowing its ancestors → mark them
  known *without testing*. One probe prunes a subtree.

> The flat `gap_vec` from earlier drafts is **subsumed** by the DAG: the "gap" is now the frontier
> node, and the gap query is just `content_vec(node*)` — sharper than a pooled average. No `γ·gap`
> ranking term (all candidates are already node*'s clips → it would cancel under argmax).

---

## 7. Stage 1 — Topic/node selection (Sliding-Window UCB over the frontier)

- **Arms** = frontier nodes (across all goals). **Reward** = learning-need = `1 − mastery[node]`.
- `UCB_n = r̄_n^(W) + c·sqrt( ln(min(T,W)) / n_n^(W) )` over a recent **window** W (non-stationary:
  mastery moves as they learn; Garivier & Moulines 2008). New node → infinite bonus → sampled first.
- Low-mastery ready nodes get more slots; mastered nodes drop off the frontier; a slipping node
  (failed review) re-enters with high reward. Mastery stays explicit in the policy, never melted
  into a taste vector.

UCB selects *which node* gets the slot; Stages 2–3 select the *item* within it.

---

## 8. Stage 2 — Candidate generation (per frontier node)

- **Offline:** every clip transcript → `content_vec` → FAISS. `style_vec` too. Updated as clips arrive.
- **Online:** `embed(node* concept)` → FAISS top-K → on-node candidates. Cosine via normalized inner
  product. Filter already-watched.
- **Auto-query (live candidate generation).** If a frontier node has thin/no clip coverage, trigger
  a live fetch: `clipper`'s `/api/search` / `/api/learn` finds a vetted-channel video for that
  concept and clips it on demand. So the DAG growing a new node *pulls in* its clips.
- **Problems:** LLM-generated for node*, entered tagged by node; Stage-3 paces injection.

---

## 9. Stage 3 — Ranking (probabilistic, untrained)

Of the on-node candidates, pick the clip most likely **good** and most on-**vibe**. Product of
experts in log space:

```
score(c) = log P(good|c)  +  κ · log P(fit|c)              # = P(good)·P(fit)^κ
next     = argmax_c score(c)
```
- Both terms are genuine probabilities in (0,1) → comparable scale, no standardization needed.
- **`κ` = the one user slider: "Popular ↔ For You."** κ→0 ranks by pure `P(good)` (generally-liked
  = popularity/quality); κ↑ tilts toward per-channel fit (tailored). One free knob.
- Topic is already correct (DAG/UCB upstream), and learning is ensured by mastery — so this objective
  only chooses *good + on-vibe* clips *within what the learner needs*.

### 9a. P(good | c) — measured quality, like:view as a probability
`likes/views = P(a viewer likes it | watched)` — already a probability, grounded in real behavior,
exposure-normalized (a ratio, not raw views). Smoothed so low-view clips don't get extreme scores:

```
P(good | c) = (likes_c + α₀) / (views_c + α₀ + β₀)      # Beta-Binomial posterior mean ∈ (0,1)
```
- `α₀, β₀` from the corpus-wide like-rate prior → thin-data clips shrink toward the mean.
- **Observed** for clips from real YouTube videos (grabbed at ingest — in-domain, free, no training).
- **Cold-start** (no/thin stats): a small **content→P(good)** head, `sigmoid(head(content_vec))`,
  trained self-supervised on our *own* ingested clips' like:view. This is the only model worth
  training, and it is **optional** — a demo on real YouTube clips reads `P(good)` directly.
- Caveats: like = satisfaction, not learning → kept separate from mastery (§6/§11). Topic confound in
  like-rate **cancels** because we rank *within a node* (same concept).

### 9b. P(fit | c) — per-channel style fit, a direct scalar
Derived from the user's own decomposition: `P(user likes | seen) = P(random likes | seen) ·
P(user is a liker-type | seen)`. Term 1 = `P(good)`. Term 2 = `P(fit)` = **P(this user likes a clip
from this channel)** — a scalar in (0,1), kept **per channel** (style ≈ constant within a creator;
vetted channel set is small → cheap + cacheable).

```
channel_fit[ch] ∈ (0,1) = P(user likes | clip from channel ch)

cold start (new channel):  LLM judges fit vs the user's style_profile → e.g. 0.8 good / 0.2 bad
per interaction:           obs = 1.0 if saved/liked ; 0.0 if disliked ; else watch_ratio
                           channel_fit[ch] ← (1−α)·channel_fit[ch] + α·obs        # α=0.15
P(fit | c) = channel_fit[c.channel]
```
An online estimate of the user's per-channel like-probability, **seeded by an LLM prior** instead of
a blind 0.5, then grounded by real behavior. The fused reward weights explicit signals
(save/like/dislike) over implicit watch-time (more faithful to "did they like it").

**`style_profile`** (short text) is what the LLM judges new channels against — seeded by a stated
vibe (or neutral), occasionally LLM-refreshed from which channels earned high/low `obs`. This is how
fit **generalizes to unseen channels**. Rank-time cost = a dict lookup; no LLM in the hot path.

No embedding, no cosine, no vMF: `score = log P(good) + κ·log P(fit)` is exactly `P(good)·P(fit)^κ`.

---

## 10. Placement quiz + probe economy

The quiz-overload risk (a weak learner failing down the chain, quiz per node) is handled by:
- **One short adaptive placement quiz per goal** (~5–8 items, easy→hard) — binary-searches the DAG
  depth, localizing the entry frontier in `log(depth)` questions, not linear. `clipper`'s
  `/api/questionnaire` already generates topic quizzes.
- **Teach-default.** After placement, *stop quizzing*. Infer mastery mostly from watch signal +
  occasional problems (only when a comprehension check is genuinely due). Steady state = watch +
  sometimes a problem, never a quiz avalanche.
- **Imply downward.** Pass an advanced node → mark all ancestors mastered without testing. One probe
  prunes a subtree.

---

## 11. Signals & state (the learning loop)

```
clip watched/liked/saved/disliked → obs → channel_fit[ch] EMA (per-channel style fit)
problem done   → pass/fail → mastery[node]  (running rate / Elo, knowledge-tracing-lite)
mastery        → UCB reward (learning-need) + frontier advance/expand + spaced-rep schedule
like:view      → P(good) (measured at ingest; smoothed)
```
Clean split: **QUALITY+STYLE pick the CLIP** (Stage 3); **LEARNING (problem success → mastery)
paces the DAG/topic** (Stages 1/6). Satisfaction (like:view) never substitutes for learning.

---

## 12. Single-user affordances

- **Direct controls** replace fragile inference: `κ` slider ("Popular ↔ For You"); optionally
  difficulty / pace / breadth-vs-depth.
- **LLM at runtime** (low QPS): DAG decomposition, problem generation, placement quizzes.
- **Persist the one profile in Redis** (mastery, DAG, `s_goal` per goal, UCB window, spaced-rep,
  κ) across sessions → no cold-start after session 1.
- **Live candidate generation** — fetch + clip fresh content per frontier node on demand.

---

## 13. What's trained vs not

- **Trained (live): nothing required.** The whole live stack = frozen encoders + measured like:view
  + LLM + online deterministic state.
- **Optional trained artifact:** `content→P(good)` head (cold-start), self-supervised on our own
  ingested clips' like:view. In-domain, English, no watch-time/debias.
- **Pretrained, frozen:** content encoder, style encoder.
- **Heuristic / online with priors:** DAG + mastery, UCB, `P(good)` smoothing, `s_goal`, spaced-rep,
  κ slider.

---

## 14. Data

- **Live quality:** each clip's **YouTube like:view** (grabbed at ingest) → `P(good)`. In-domain,
  English, free, grounded. Optionally accumulate `(content → like:view)` to train the cold-start head.
- **Passed-over (all rejected):** KuaiRec (watch-time + captions, but Chinese entertainment — was the
  D2Q source, now removed: no English fine-tune data, weak transfer); MIND (English clicks, no
  watch-time, news); MicroLens (implicit sequential + video-level likes/views, borrowed short-video
  domain); MovieLens (ratings). All borrowed-domain priors weaker than our own clips' real metadata.

---

## 15. Evaluation

- **Live:** A/B the `κ` slider qualitatively; sanity-check that low-view clips are smoothed and that
  the frontier advances as problems are passed.

---

## 16. Inference API + serving

- **Mounted into the existing `clipper` FastAPI app** (`app.include_router(recsys.api.router)`) —
  one uvicorn, one `/api` namespace. Reuses `clipper.db` READY clips as the corpus.
- `POST /api/recommend` — goals + state → next item (Stage 1→2→3).
- `POST /api/feedback` — watch_ratio / problem result → update mastery, frontier, UCB window,
  spaced-rep, `s_goal`.
- `POST /api/session` — init/reset goals, κ.
- **Profile store: Redis** (mirrors `server/store.js` conventions — `REDIS_URL`, in-memory fallback,
  `rec:*` keys, JSON values): `rec:profile`, `rec:mastery`, `rec:dag`, `rec:style`, `rec:ucb`.

---

## 17. Repo layout

```
recsys/
  config.py        get_settings()
  encoders.py      frozen content + style singletons
  dag.py           prerequisite DAG: build/expand (LLM), frontier, dedup, gating
  mastery.py       problem pass/fail → mastery; placement quiz grading; spaced-rep
  policy.py        Sliding-Window UCB over the frontier; clip/problem pacing
  quality.py       P(good): Beta-smoothed like:view (+ optional cold-start head)
  style_expert.py  channel_fit: LLM-prior + EMA on fused obs; P(fit) lookup; style_profile refresh
  ranking.py       score = log P(good) + κ·log P(fit); argmax
  retrieval.py     content ANN over clipper clips; auto-query (live fetch)
  state.py         Redis profile store (rec:*)
  api.py           router → mounted into clipper/api.py
  tests/
```
Stack: FAISS + FastAPI (via clipper) + sentence-transformers + Redis. (PyTorch only if the optional
cold-start `P(good)` head is built.)

---

## 18. Build status

- **Built + verified end-to-end in Docker** (`recsys/`, 40 unit tests + live API):
  config, `style_expert` (channel-fit), `policy` (SW-UCB), `mastery` (+ spaced-rep), `quality`
  (P(good)), `dag` (prereq DAG + lazy expand), `ranking` (`log P(good)+κ·log P(fit)`), `state`
  (Redis profile), `encoders` + `retrieval` (ANN over clipper clips), `api` (session/recommend/
  feedback, mounted into clipper). clipper `ingest.py` now captures channel/views/likes. Docker:
  uv-based image + compose (api + redis). Live run confirmed: session→DAG→Redis, recommend→UCB→
  auto-query (found a real 3b1b video + queued a job), feedback-fail→mastery→DAG expanded into 5 prereqs.
- **Not built yet:** auto-query queues a job but doesn't *run* the clip pipeline (so the corpus
  stays empty until clipper processes it); placement quiz + probe-economy; the optional
  content→P(good) cold-start head; frontend wiring; serving real clip payloads (start/end/url).

---

## 19. Open questions

- Mastery model (running rate vs Elo vs IRT-lite) — start simplest.
- UCB window `W`, exploration `c` — tune by eye.
- DAG: edge-noise tolerance; dedup threshold τ; depth cap; floor enforcement.
- `P(good)` prior `α₀,β₀`; whether to train the cold-start head for the demo or read like:view only.
- `α` (channel_fit EMA), fused-obs weights (save/like/dislike/watch), default `κ` — tune by eye.
- `style_profile` refresh cadence; LLM cold-start fit prompt + calibration.

---

## 20. Changelog

**2026-06-21 (this session)**
- **Style is now a per-channel fit scalar `P(fit)`**, not an embedding. LLM gives the cold-start fit
  value (judged vs a text `style_profile`); interactions EMA it toward a fused obs (save/like/dislike
  >> watch). Dropped Wegmann/style-encoder/`style_vec`/cosine/vMF/`s_goal`/centroid-init entirely.
  Reason: in educational YouTube style ≈ channel, the vetted channel set is small, and a per-channel
  like-probability is the faithful + cheap + data-efficient estimator of the user's "liker-type" term.
- Ranker is now `score = log P(good) + κ·log P(fit)` — both genuine probabilities, no standardization.
- **D2Q removed entirely** (notebook deleted). Earlier this session it had been: Chinese
  entertainment domain + no English fine-tune data → weak zero-shot transfer; and its live role
  (clip quality) is better served by measured like:view.
- **Live ranker is now untrained & probabilistic:** `argmax z(log P(good)) + κ·cos(style, s_goal)`.
- **`P(good)` = Beta-smoothed like:view** (a real probability, grounded, in-domain, free), with an
  optional self-supervised cold-start head.
- **`κ` is the single slider** ("Popular ↔ For You") — β and vMF concentration collapse into it.
- **Prerequisite DAG + frontier** replaces flat subtopics; UCB arms are frontier nodes; the flat
  `gap_vec`/`γ·gap` term is subsumed (gap = `content_vec(node*)`).
- **Lazy go-as-you-need expansion** (fail → expand prereqs), HS floor + depth cap, clip-sized nodes,
  DAG dedup, soft gating.
- **Placement quiz + teach-default + imply-downward** to avoid quiz overload.
- **Auto-query** per frontier node (live clipper fetch+clip).
- **Profile in Redis**, **API mounted into clipper**, corpus = clipper READY clips.

**2026-06-20 → 2026-06-21 (earlier)**
- MicroLens → KuaiRec (watch-time + captions + unbiased eval) for the (then-live) D2Q.
- Text-serialization over categorical embeddings; reframed to single-user (controls + runtime LLM).
- Added the style axis (style encoder + vMF target, online EMA).
