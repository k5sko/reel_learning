"""The content encoder — lazy, thread-safe frozen sentence-transformer singleton.

Used to embed clip text (candidate corpus) and frontier-node concepts into one shared space for
cosine ANN. Loaded on first use so importing the pure-logic modules never pulls in torch.

Constructed under a lock: FastAPI runs sync endpoints in a threadpool, so several /api/recommend
calls can hit this at once — concurrent first-time construction races torch's meta-tensor init
("Cannot copy out of meta tensor"). The lock ensures exactly one thread builds it.
"""

from __future__ import annotations

import threading
from typing import Sequence

import numpy as np

from .config import get_settings

_encoder = None
_lock = threading.Lock()


def get_content_encoder():
    global _encoder
    if _encoder is None:
        with _lock:
            if _encoder is None:  # double-checked: only the first thread constructs
                from sentence_transformers import SentenceTransformer

                _encoder = SentenceTransformer(get_settings().content_encoder, device="cpu")
    return _encoder


def embed(texts: Sequence[str], normalize: bool = True) -> np.ndarray:
    """Encode texts → (N, dim) float32. Normalized by default so cosine = inner product."""
    enc = get_content_encoder()
    vecs = enc.encode(
        list(texts), convert_to_numpy=True, normalize_embeddings=normalize, show_progress_bar=False
    )
    return vecs.astype("float32")


def embed_one(text: str, normalize: bool = True) -> np.ndarray:
    return embed([text], normalize=normalize)[0]
