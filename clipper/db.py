"""SQLite persistence via SQLModel — ``Job`` and ``Clip`` tables.

Downstream stages (compression/filter, recommendation, RAG) read the ``clips``
table; they never touch the video files. ``tags`` is stored as a JSON-encoded
string for portability across those consumers.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, List, Optional

from sqlmodel import Field, Session, SQLModel, create_engine

from .config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class JobStatus:
    QUEUED = "queued"
    INGESTING = "ingesting"
    TRANSCRIBING = "transcribing"
    SEGMENTING = "segmenting"
    RENDERING = "rendering"
    LABELING = "labeling"
    DONE = "done"
    ERROR = "error"


class ClipStatus:
    READY = "ready"
    DROPPED = "dropped"


class Job(SQLModel, table=True):
    id: str = Field(primary_key=True)
    source: str                                  # "youtube" | "upload"
    source_ref: str                              # URL or original filename
    status: str = Field(default=JobStatus.QUEUED, index=True)
    error: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Clip(SQLModel, table=True):
    id: str = Field(primary_key=True)
    job_id: str = Field(index=True)
    start: float
    end: float
    duration: float
    title: str = ""
    hook: str = ""
    summary: str = ""
    tags: str = "[]"                             # JSON-encoded list[str]
    score: float = 0.0
    file_path: str = ""
    status: str = Field(default=ClipStatus.READY)
    created_at: datetime = Field(default_factory=utcnow)

    def tag_list(self) -> List[str]:
        try:
            return list(json.loads(self.tags or "[]"))
        except (ValueError, TypeError):
            return []

    def set_tags(self, tags) -> None:
        self.tags = json.dumps(list(tags or []))


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        url = get_settings().database_url
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, connect_args=connect_args)
    return _engine


def init_db() -> None:
    """Create tables if they don't exist."""
    SQLModel.metadata.create_all(get_engine())


@contextmanager
def session_scope() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
