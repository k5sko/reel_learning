"""Phase 7 — Label: metadata records + DB rows via an injected fake LLM."""

from __future__ import annotations


class FakeLLM:
    def __init__(self, payload):
        self.payload = payload
        self.calls = 0

    def complete_json(self, prompt, schema, *, system=None, max_tokens=None):
        self.calls += 1
        return dict(self.payload)


def test_label_writes_records_and_db(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_STORAGE_ROOT", str(tmp_path / "store"))
    monkeypatch.setenv("CLIPPER_DATABASE_URL", f"sqlite:///{tmp_path / 'c.db'}")
    import clipper.config as config
    import clipper.db as db

    config.get_settings.cache_clear()
    db._engine = None  # rebind to the temp DB

    from clipper.pipeline import label
    from clipper.storage import LocalStorage, write_json

    st = LocalStorage()
    st.job_dir("j")
    render = [
        {"id": "c_01", "start": 1.0, "end": 20.0, "duration": 19.0,
         "file_path": "store/j/clips/c_01.mp4", "text": "a focus clip", "reason": "r"},
        {"id": "c_02", "start": 25.0, "end": 50.0, "duration": 25.0,
         "file_path": "store/j/clips/c_02.mp4", "text": "another clip", "reason": "r"},
    ]
    write_json(st, render, "j", "render.json")

    fake = FakeLLM({
        "title": "Train Your Focus",
        "hook": "Most people train the wrong thing.",
        "summary": "Focus is a trainable skill.",
        "tags": ["focus", "habits"],
        "score": 1.4,   # out of range → clamped to 1.0
    })
    records = label.run("j", st, llm=fake)

    assert fake.calls == 2
    assert st.exists("j", "clips.json")
    assert records[0]["title"] == "Train Your Focus"
    assert records[0]["tags"] == ["focus", "habits"]   # list in the JSON artifact
    assert records[0]["score"] == 1.0                  # clamped
    assert records[0]["status"] == "ready"

    # DB rows present, tags decoded, status ready
    with db.session_scope() as s:
        c1 = s.get(db.Clip, "c_01")
        assert c1 is not None
        assert c1.job_id == "j"
        assert c1.status == "ready"
        assert c1.tag_list() == ["focus", "habits"]
        assert c1.score == 1.0
        assert s.get(db.Clip, "c_02") is not None

    # resumable: cached artifact, no further LLM calls
    label.run("j", st, llm=fake)
    assert fake.calls == 2
