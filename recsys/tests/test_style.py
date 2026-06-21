import math

from recsys.config import get_settings
from recsys.style import (
    STYLE_AXES,
    default_axes,
    fuse_obs,
    log_p_fit,
    p_fit,
    update_user_axes,
)


def cfg():
    return get_settings()


def test_p_fit_perfect_match_is_one():
    a = {ax: 0.7 for ax in STYLE_AXES}
    assert abs(p_fit(a, dict(a)) - 1.0) < 1e-9


def test_p_fit_falls_with_distance():
    user = {ax: 0.0 for ax in STYLE_AXES}
    near = {ax: 0.1 for ax in STYLE_AXES}
    far = {ax: 0.9 for ax in STYLE_AXES}
    assert p_fit(near, user) > p_fit(far, user)


def test_p_fit_neutral_when_no_user_axes():
    assert p_fit({ax: 0.9 for ax in STYLE_AXES}, None) == cfg().fit_default
    assert p_fit(None, default_axes()) == cfg().fit_default


def test_log_p_fit_finite():
    far = {ax: 1.0 for ax in STYLE_AXES}
    near = {ax: 0.0 for ax in STYLE_AXES}
    assert math.isfinite(log_p_fit(far, near))   # p_fit ~0 -> clamped by prob_floor


def test_fuse_obs_priority():
    c = cfg()
    assert fuse_obs(c, saved=True) == c.save_obs
    assert fuse_obs(c, disliked=True, watch_ratio=1.0) == c.dislike_obs
    assert fuse_obs(c) is None
    assert fuse_obs(c, watch_ratio=c.watch_base) == 0.5


def test_update_pulls_toward_liked_pushes_from_disliked():
    user = {ax: 0.5 for ax in STYLE_AXES}
    clip = {ax: 1.0 for ax in STYLE_AXES}
    liked = update_user_axes(user, clip, obs=1.0)
    assert liked["humor"] > 0.5                  # moved toward the liked clip's high axes
    disliked = update_user_axes(user, clip, obs=0.0)
    assert disliked["humor"] < 0.5              # pushed away
    neutral = update_user_axes(user, clip, obs=0.5)
    assert abs(neutral["humor"] - 0.5) < 1e-9   # no-op at neutral obs
