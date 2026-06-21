"""Thin Anthropic wrapper — the single chokepoint for all LLM calls.

Model id, effort, and output handling live here so the segmentation and
labeling stages stay focused on prompts. JSON responses use the Messages API
structured-output format (``output_config.format``) so the model returns valid
JSON without code fences; ``_strip_fences`` remains as a defensive fallback.
"""

from __future__ import annotations

import json
import threading
from typing import Any, Optional

from .config import get_settings


class LLMError(RuntimeError):
    pass


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"):
            t = t[: -3]
        # drop a leading language tag line like ``json``
        if t.lstrip().startswith("json"):
            t = t.lstrip()[4:]
    return t.strip()


def _text_from(msg) -> str:
    parts = []
    for block in getattr(msg, "content", None) or []:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "".join(parts).strip()


class LLMClient:
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        s = get_settings()
        self._model = model or s.llm_model
        self._max_tokens = s.llm_max_tokens
        self._effort = s.llm_effort
        self._api_key = api_key or s.anthropic_api_key
        self._client = None  # lazy: don't construct the SDK until first call
        self._lock = threading.Lock()

    def _ensure_client(self):
        # Double-checked locking so concurrent label/segment threads share one
        # client (the Anthropic SDK is safe to reuse across threads).
        if self._client is None:
            with self._lock:
                if self._client is None:
                    try:
                        import anthropic
                    except ImportError as e:  # pragma: no cover
                        raise LLMError("anthropic SDK not installed; `pip install anthropic`") from e
                    self._client = (
                        anthropic.Anthropic(api_key=self._api_key)
                        if self._api_key
                        else anthropic.Anthropic()
                    )
        return self._client

    def complete(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        client = self._ensure_client()
        kwargs: dict = dict(
            model=self._model,
            max_tokens=max_tokens or self._max_tokens,
            output_config={"effort": self._effort},
            messages=[{"role": "user", "content": prompt}],
        )
        if system:
            kwargs["system"] = system
        return _text_from(client.messages.create(**kwargs))

    def complete_json(
        self,
        prompt: str,
        schema: dict,
        *,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
    ) -> Any:
        client = self._ensure_client()
        kwargs: dict = dict(
            model=self._model,
            max_tokens=max_tokens or self._max_tokens,
            output_config={
                "effort": self._effort,
                "format": {"type": "json_schema", "schema": schema},
            },
            messages=[{"role": "user", "content": prompt}],
        )
        if system:
            kwargs["system"] = system
        text = _text_from(client.messages.create(**kwargs))
        try:
            return json.loads(_strip_fences(text))
        except ValueError as e:
            raise LLMError("LLM did not return valid JSON: " + text[:500]) from e
