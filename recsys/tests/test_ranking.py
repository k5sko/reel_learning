import math

from recsys.ranking import Candidate, rank, score_candidates

LO = math.log(0.05)
HI = math.log(0.95)


def test_kappa_zero_is_pure_popularity():
    # kappa=0 -> fit ignored -> higher like:view wins regardless of style fit
    good = Candidate("good", likes=9000, views=10000, log_fit=LO)
    weak = Candidate("weak", likes=10, views=10000, log_fit=HI)
    assert rank([good, weak], kappa=0.0).id == "good"


def test_high_kappa_lets_fit_win():
    # crank kappa -> per-clip style fit dominates
    good = Candidate("good", likes=9000, views=10000, log_fit=LO)
    fit = Candidate("fit", likes=10, views=10000, log_fit=HI)
    assert rank([good, fit], kappa=8.0).id == "fit"


def test_scores_sorted_desc():
    cands = [
        Candidate("a", likes=100, views=1000),
        Candidate("b", likes=900, views=1000),
    ]
    scored = score_candidates(cands)
    assert [s.candidate.id for s in scored] == ["b", "a"]
    assert scored[0].score >= scored[1].score


def test_repeat_video_penalty_diversifies():
    a = Candidate("j1_c_01", likes=900, views=1000, job_id="j1")
    b = Candidate("j2_c_01", likes=900, views=1000, job_id="j2")
    # j1 already shown -> penalized -> the other video's clip wins
    assert rank([a, b], seen_jobs={"j1"}).id == "j2_c_01"


def test_relevance_breaks_ties():
    # identical score -> higher relevance wins
    a = Candidate("a", likes=500, views=1000, relevance=0.4)
    b = Candidate("b", likes=500, views=1000, relevance=0.7)
    assert rank([a, b]).id == "b"


def test_empty_returns_none():
    assert rank([]) is None
