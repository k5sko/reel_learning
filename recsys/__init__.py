"""recsys — the learning-feed recommender.

A single-user, mostly-untrained stack mounted onto the existing ``clipper`` app:
a prerequisite-DAG learning loop (what to teach) + a probabilistic clip ranker
``score = log P(good) + κ·log P(fit)`` (which clip). See
``docs/superpowers/specs/2026-06-20-learning-feed-recommender-design.md``.
"""
