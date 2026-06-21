"""The content encoder — lazy frozen sentence-transformer singleton.

Used to embed clip text (candidate corpus) and frontier-node concepts into one shared space for
cosine ANN. Loaded on first use so importing the pure-logic modules never pulls in torch.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Sequence

import numpy as np

from .config import get_settings


@lru_cache(maxsize=1)
def get_content_encoder():
    from sentence_transformers import SentenceTransformer  # heavy; import on first use only

    return SentenceTransformer(get_settings().content_encoder)


def embed(texts: Sequence[str], normalize: bool = True) -> np.ndarray:
    """Encode texts → (N, dim) float32. Normalized by default so cosine = inner product."""
    enc = get_content_encoder()
    vecs = enc.encode(
        list(texts), convert_to_numpy=True, normalize_embeddings=normalize, show_progress_bar=False
    )
    return vecs.astype("float32")


def embed_one(text: str, normalize: bool = True) -> np.ndarray:
    return embed([text], normalize=normalize)[0]
