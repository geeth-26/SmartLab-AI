"""Shared helpers for API blueprints."""
from __future__ import annotations

from typing import Any

from flask import current_app, request

from ..rag.engine import RAGEngine
from ..services.llm import ClaudeClient


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, **extra: Any):
        super().__init__(message)
        self.message = message
        self.status = status
        self.extra = extra


def json_body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if data is None:
        if request.content_length:
            raise ApiError("Request body must be valid JSON.", 400)
        return {}
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object.", 400)
    return data


def require(data: dict[str, Any], *keys: str) -> None:
    missing = [k for k in keys if data.get(k) in (None, "") or (isinstance(data.get(k), str) and not data[k].strip())]
    if missing:
        raise ApiError(f"Missing required field(s): {', '.join(missing)}.", 400)


def int_arg(name: str, default: int | None = None, minimum: int | None = None, maximum: int | None = None) -> int | None:
    raw = request.args.get(name)
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ApiError(f"Query parameter '{name}' must be an integer.") from exc
    if minimum is not None and value < minimum or maximum is not None and value > maximum:
        raise ApiError(f"Query parameter '{name}' is out of range.")
    return value


def rag() -> RAGEngine:
    return current_app.extensions["smartlab"]["rag"]


def llm() -> ClaudeClient:
    return current_app.extensions["smartlab"]["llm"]


def upload_limits() -> dict[str, int]:
    cfg = current_app.config
    return {"max_bytes": cfg["MAX_CONTENT_LENGTH"], "max_pdf_pages": cfg["MAX_PDF_PAGES"],
            "max_image_pixels": cfg["MAX_IMAGE_PIXELS"]}
