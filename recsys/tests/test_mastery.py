from recsys.mastery import Mastery, SpacedRep


# ---- Mastery ----

def test_unseen_node_unknown():
    m = Mastery()
    assert m.get("x") == 0.0
    assert not m.is_mastered("x")
    assert m.learning_need("x") == 1.0


def test_pass_raises_fail_lowers():
    m = Mastery()
    m.record("x", True)
    after_pass = m.get("x")
    assert after_pass > 0.0
    m.record("x", False)
    assert m.get("x") < after_pass


def test_repeated_pass_reaches_mastered():
    m = Mastery()
    for _ in range(10):
        m.record("x", True)
    assert m.is_mastered("x")
    assert m.learning_need("x") < 1 - m.cfg.mastery_threshold + 1e-6


def test_mastery_state_roundtrip():
    m = Mastery()
    m.record("a", True); m.record("b", False)
    back = Mastery.from_state(m.to_state())
    assert back.get("a") == m.get("a")


# ---- SpacedRep ----

def test_pass_pushes_review_out():
    sr = SpacedRep()
    e1 = sr.record("x", True, now=0)
    e2 = sr.record("x", True, now=e1["due_at"])
    assert e2["interval"] > e1["interval"]          # interval grows by ease
    assert e2["due_at"] > e1["due_at"]


def test_fail_resurfaces_soon():
    sr = SpacedRep()
    sr.record("x", True, now=0)
    sr.record("x", True, now=10)                    # interval grown
    e = sr.record("x", False, now=20)
    assert e["interval"] == sr.cfg.review_min_interval


def test_interval_capped():
    sr = SpacedRep()
    now = 0
    for _ in range(20):                             # many passes -> would blow up without cap
        e = sr.record("x", True, now=now)
        now = e["due_at"]
    assert e["interval"] <= sr.cfg.review_max_interval


def test_is_due_and_due_nodes():
    sr = SpacedRep()
    sr.record("x", False, now=0)                    # due at 0 + min_interval
    due_time = sr.sched["x"]["due_at"]
    assert not sr.is_due("x", due_time - 1)
    assert sr.is_due("x", due_time)
    assert sr.due_nodes(["x", "y"], due_time) == ["x"]
