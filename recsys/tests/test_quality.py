import math

from recsys.quality import log_p_good, p_good, prior_mean


def test_no_stats_is_prior_mean():
    assert p_good(None, None) == prior_mean()
    assert p_good(0, 0) == prior_mean()


def test_high_views_approach_like_rate():
    # lots of data -> smoothing washes out, P(good) ~ likes/views
    assert abs(p_good(9000, 10000) - 0.9) < 0.02


def test_smoothing_pulls_thin_data_toward_prior():
    # 1 like / 1 view is NOT 1.0 — shrinks toward the low prior
    assert p_good(1, 1) < 0.5
    # and a thin sample sits between the raw rate and the prior
    pm = prior_mean()
    assert pm < p_good(1, 2) < 0.5


def test_likes_cannot_exceed_views():
    # dirty data (likes > views) clamped -> stays a valid probability
    val = p_good(50, 10)
    assert 0.0 < val < 1.0


def test_log_finite():
    assert math.isfinite(log_p_good(0, 0))
    assert math.isfinite(log_p_good(None, None))
