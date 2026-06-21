"""Phase 0 scaffold checks: imports resolve, DB tables create, storage works."""

from __future__ import annotations

import importlib


def test_all_modules_import():
    for mod in [
        "clipper.config",
        "clipper.db",
        "clipper.storage",
        "clipper.llm",
        "clipper.asr",
        "clipper.pipeline.ingest",
        "clipper.pipeline.transcribe",
        "clipper.pipeline.sentences",
        "clipper.pipeline.segment",
        "clipper.pipeline.boundaries",
        "clipper.pipeline.render",
        "clipper.pipeline.label",
    ]:
        importlib.import_module(mod)


def test_db_tables_create(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_DATABASE_URL", f"sqlite:///{tmp_path/'t.db'}")
    import clipper.config as config
    import clipper.db as db

    config.get_settings.cache_clear()
    db._engine = None  # reset cached engine for the temp DB

    db.init_db()
    from sqlalchemy import inspect

    tables = set(inspect(db.get_engine()).get_table_names())
    assert {"job", "clip"} <= tables

    with db.session_scope() as s:
        job = db.Job(id="j1", source="upload", source_ref="x.mp4")
        s.add(job)
        s.commit()
        clip = db.Clip(id="c1", job_id="j1", start=1.0, end=5.0, duration=4.0)
        clip.set_tags(["a", "b"])
        s.add(clip)
        s.commit()

    with db.session_scope() as s:
        got = s.get(db.Clip, "c1")
        assert got is not None and got.tag_list() == ["a", "b"]


def test_storage_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("CLIPPER_STORAGE_ROOT", str(tmp_path / "store"))
    import clipper.config as config

    config.get_settings.cache_clear()
    from clipper.storage import LocalStorage

    st = LocalStorage()
    st.write_bytes(b"hello", "job1", "clips", "c1.txt")
    assert st.exists("job1", "clips", "c1.txt")
    assert st.read_bytes("job1", "clips", "c1.txt") == b"hello"
