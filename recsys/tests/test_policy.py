import math

from recsys.config import Settings
from recsys.policy import SlidingWindowUCB


def small_cfg(window=4, c=1.0):
    # construct Settings then override the two UCB knobs for deterministic tests
    s = Settings()
    object.__setattr__(s, "ucb_window", window)
    object.__setattr__(s, "ucb_c", c)
    return s


def test_unseen_arm_is_explored_first():
    ucb = SlidingWindowUCB(cfg=small_cfg())
    ucb.update("a", 0.9)                       # a has data, b/c do not
    # an unseen arm (inf index) beats a well-rewarded seen one
    assert ucb.select(["a", "b", "c"]) == "b"  # first unseen wins the tie


def test_prefers_higher_mean_once_all_seen():
    ucb = SlidingWindowUCB(cfg=small_cfg(window=10))
    for _ in range(3):
        ucb.update("hi", 1.0)
        ucb.update("lo", 0.0)
    assert ucb.select(["hi", "lo"]) == "hi"


def test_window_forgets_old_rewards():
    ucb = SlidingWindowUCB(cfg=small_cfg(window=3))
    ucb.update("x", 1.0)                       # this oldest entry will fall out
    for _ in range(3):
        ucb.update("filler", 0.0)             # 3 newer plays push window past x
    # x no longer in the 3-entry window -> treated as unseen -> inf
    assert math.isinf(ucb.scores(["x"])["x"])


def test_empty_frontier_returns_none():
    ucb = SlidingWindowUCB(cfg=small_cfg())
    assert ucb.select([]) is None


def test_state_roundtrip():
    ucb = SlidingWindowUCB(cfg=small_cfg(window=5))
    ucb.update("a", 0.5)
    ucb.update("b", 0.7)
    st = ucb.to_state()
    back = SlidingWindowUCB.from_state(st, cfg=small_cfg(window=5))
    assert back.total == ucb.total
    assert back.scores(["a", "b"]) == ucb.scores(["a", "b"])


def test_bonus_shrinks_with_n_at_fixed_horizon():
    # Same window/horizon + same mean, but arm 'a' pulled more often -> smaller confidence bonus.
    # (Can't compare across t: at t=1 the bonus is sqrt(ln1/n)=0, so the horizon must be held fixed.)
    c = small_cfg(window=20)
    few = SlidingWindowUCB(cfg=c, history=[("a", 0.5)] + [("b", 0.5)] * 19, total=20)
    many = SlidingWindowUCB(cfg=c, history=[("a", 0.5)] * 10 + [("b", 0.5)] * 10, total=20)
    assert few.scores(["a"])["a"] > many.scores(["a"])["a"]
