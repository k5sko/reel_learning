from recsys.state import Profile, ProfileStore


def test_store_memory_roundtrip():
    s = ProfileStore()                      # no REDIS_URL -> memory backend
    assert s.backend == "memory"
    assert s.get("missing") is None
    s.set("profile", {"kappa": 2.0})
    assert s.get("profile") == {"kappa": 2.0}


def test_profile_save_load_reconstructs_state():
    store = ProfileStore()
    p = Profile()
    p.mastery.record("vectors", True)
    g = p.dag.add_node("eigenvectors"); pre = p.dag.add_node("vectors")
    p.dag.add_edge(pre, g)
    p.ucb.update("vectors", 0.9)
    p.spaced.record("vectors", True, now=0)
    p.meta["goals"] = ["eigenvectors"]
    p.meta["user_style"] = {"humor": 0.8, "depth": 0.9}
    p.save(store)

    back = Profile.load(store)
    assert back.mastery.get("vectors") == p.mastery.get("vectors")
    assert back.dag.prereqs(g) == {pre}
    assert back.ucb.total == 1
    assert "vectors" in back.spaced.sched
    assert back.meta["goals"] == ["eigenvectors"]
    assert back.meta["user_style"]["humor"] == 0.8


def test_load_empty_store_gives_fresh_profile():
    back = Profile.load(ProfileStore())
    assert back.dag.nodes == {}
    assert back.mastery.scores == {}
    assert back.meta["t"] == 0
    assert back.meta["user_style"] is None
