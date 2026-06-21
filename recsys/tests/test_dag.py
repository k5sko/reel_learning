from recsys.config import Settings
from recsys.dag import DAG


def test_add_dedups_exact_text():
    d = DAG()
    a = d.add_node("Eigenvectors")
    b = d.add_node("  eigenvectors ")          # canonical match -> same node
    assert a == b
    assert len(d.nodes) == 1


def test_embedding_dedup_merges_near_duplicates():
    cfg = Settings()
    object.__setattr__(cfg, "dedup_cos", 0.9)
    d = DAG(cfg=cfg)
    d.add_node("matrix diagonalization", emb=[1.0, 0.0])
    merged = d.add_node("diagonalizing a matrix", emb=[0.99, 0.01])   # cos ~1 -> merge
    assert merged == "matrix diagonalization"
    assert len(d.nodes) == 1


def test_frontier_gated_by_prereqs():
    d = DAG()
    goal = d.add_node("eigenvectors")
    pre = d.add_node("vectors")
    d.add_edge(pre, goal)                       # vectors before eigenvectors
    # nothing mastered -> only the prereq-free node is ready
    assert d.frontier(mastered=set()) == ["vectors"]
    # master the prereq -> the goal unlocks
    assert set(d.frontier(mastered={"vectors"})) == {"eigenvectors"}
    # master both -> frontier empty
    assert d.frontier(mastered={"vectors", "eigenvectors"}) == []


def test_expand_attaches_prereqs_and_respects_floor():
    cfg = Settings()
    object.__setattr__(cfg, "dag_max_depth", 1)
    d = DAG(cfg=cfg)
    goal = d.add_node("eigenvectors", depth=0)
    kids = d.expand(goal, ["vectors", "linear maps"])
    assert set(kids) == {"vectors", "linear maps"}
    assert d.prereqs(goal) == {"vectors", "linear maps"}
    # vectors is at depth 1 == max_depth -> further expansion is a no-op (knowledge floor)
    assert d.expand("vectors", ["arithmetic"]) == []


def test_state_roundtrip():
    d = DAG()
    g = d.add_node("eigenvectors")
    p = d.add_node("vectors")
    d.add_edge(p, g)
    back = DAG(state=d.to_state())
    assert back.nodes.keys() == d.nodes.keys()
    assert back.prereqs(g) == {p}
    assert back.frontier(mastered={"vectors"}) == ["eigenvectors"]
