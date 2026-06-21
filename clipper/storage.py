"""Storage interface (local disk now, S3-swappable later).

Stages address files by ``(job_id, *parts)`` rather than raw paths so the
backend can change without touching pipeline code. Layout::

    <root>/<job_id>/video.mp4
    <root>/<job_id>/audio.wav
    <root>/<job_id>/transcript.json
    <root>/<job_id>/clips/<clip_id>.mp4
"""

from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Optional, Union

from .config import get_settings


class Storage(ABC):
    @abstractmethod
    def job_dir(self, job_id: str) -> str: ...

    @abstractmethod
    def path(self, job_id: str, *parts: str) -> str: ...

    @abstractmethod
    def exists(self, job_id: str, *parts: str) -> bool: ...

    @abstractmethod
    def write_bytes(self, data: bytes, job_id: str, *parts: str) -> str: ...

    @abstractmethod
    def read_bytes(self, job_id: str, *parts: str) -> bytes: ...

    @abstractmethod
    def url_for(self, job_id: str, *parts: str) -> str: ...


class LocalStorage(Storage):
    def __init__(self, root: Optional[Union[str, os.PathLike]] = None):
        self.root = Path(root or get_settings().storage_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def job_dir(self, job_id: str) -> str:
        d = self.root / job_id
        d.mkdir(parents=True, exist_ok=True)
        return str(d)

    def path(self, job_id: str, *parts: str) -> str:
        p = self.root / job_id
        if parts:
            p = p.joinpath(*parts)
        return str(p)

    def exists(self, job_id: str, *parts: str) -> bool:
        return Path(self.path(job_id, *parts)).exists()

    def write_bytes(self, data: bytes, job_id: str, *parts: str) -> str:
        target = Path(self.path(job_id, *parts))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return str(target)

    def read_bytes(self, job_id: str, *parts: str) -> bytes:
        return Path(self.path(job_id, *parts)).read_bytes()

    def url_for(self, job_id: str, *parts: str) -> str:
        return Path(self.path(job_id, *parts)).resolve().as_uri()


def get_storage() -> Storage:
    backend = get_settings().storage_backend
    if backend == "local":
        return LocalStorage()
    raise ValueError(f"Unknown storage backend: {backend!r}")


# --- JSON artifact helpers (every stage caches a JSON artifact) ------------

def write_json(storage: Storage, obj: Any, job_id: str, *parts: str) -> str:
    data = json.dumps(obj, indent=2, ensure_ascii=False).encode("utf-8")
    return storage.write_bytes(data, job_id, *parts)


def read_json(storage: Storage, job_id: str, *parts: str) -> Any:
    return json.loads(storage.read_bytes(job_id, *parts).decode("utf-8"))
