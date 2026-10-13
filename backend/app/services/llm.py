"""Optional Claude integration.

The platform works fully offline (extractive RAG answers, heuristic image
analysis). When Anthropic credentials are present, this client upgrades answer
synthesis and image description to Claude. Every caller must handle
:class:`LLMUnavailable` by falling back to its deterministic path.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_CREDENTIAL_ENV_VARS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE")
# Server-side refusal fallback: on a policy decline the API re-runs the request
# on a fallback model chosen by refusal category, inside the same call.
_FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMUnavailable(RuntimeError):
    """The LLM is disabled, not configured, refused, or the call failed."""


class ClaudeClient:
    def __init__(self, model: str, effort: str = "medium", enabled: bool = True):
        self.model = model
        self.effort = effort
        self._enabled = enabled and any(os.getenv(v) for v in _CREDENTIAL_ENV_VARS)
        self._client = None

    @property
    def available(self) -> bool:
        return self._enabled

    def _get_client(self):
        if not self._enabled:
            raise LLMUnavailable("Claude is not configured (set ANTHROPIC_API_KEY to enable).")
        if self._client is None:
            try:
                import anthropic
            except ImportError as exc:  # pragma: no cover - dependency is in requirements.txt
                raise LLMUnavailable("The 'anthropic' package is not installed.") from exc
            self._client = anthropic.Anthropic(timeout=120.0, max_retries=2)
        return self._client

    def _create(self, *, system: str, content: list[dict[str, Any]], max_tokens: int,
                output_format: dict[str, Any] | None = None) -> str:
        import anthropic

        client = self._get_client()
        output_config: dict[str, Any] = {"effort": self.effort}
        if output_format is not None:
            output_config["format"] = output_format
        try:
            response = client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                thinking={"type": "adaptive"},
                output_config=output_config,
                betas=[_FALLBACK_BETA],
                fallbacks="default",
                messages=[{"role": "user", "content": content}],
            )
        except anthropic.AuthenticationError as exc:
            logger.error("Claude authentication failed; disabling LLM features: %s", exc)
            self._enabled = False
            raise LLMUnavailable("Claude authentication failed.") from exc
        except anthropic.RateLimitError as exc:
            raise LLMUnavailable("Claude rate limit reached; using offline fallback.") from exc
        except anthropic.APIStatusError as exc:
            logger.warning("Claude API error %s: %s", exc.status_code, exc.message)
            raise LLMUnavailable(f"Claude API error ({exc.status_code}).") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMUnavailable("Could not reach the Claude API.") from exc

        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            category = getattr(details, "category", None)
            raise LLMUnavailable(f"Claude declined the request (category: {category}).")
        text = "".join(block.text for block in response.content if block.type == "text").strip()
        if not text:
            raise LLMUnavailable("Claude returned an empty response.")
        return text

    def complete(self, system: str, prompt: str, max_tokens: int = 16000) -> str:
        return self._create(system=system, content=[{"type": "text", "text": prompt}], max_tokens=max_tokens)

    def complete_json(self, system: str, content: list[dict[str, Any]], schema: dict[str, Any],
                      max_tokens: int = 16000) -> dict[str, Any]:
        text = self._create(
            system=system,
            content=content,
            max_tokens=max_tokens,
            output_format={"type": "json_schema", "schema": schema},
        )
        try:
            return json.loads(text)
        except ValueError as exc:
            raise LLMUnavailable("Claude returned malformed JSON.") from exc

    @staticmethod
    def image_block(data: bytes, media_type: str) -> dict[str, Any]:
        return {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(data).decode()},
        }
