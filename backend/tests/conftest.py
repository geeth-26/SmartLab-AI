"""Shared pytest fixtures.

Every test gets a fresh, isolated application (temporary SQLite DB, upload and
index directories) seeded with the demo SOPs and records. The LLM and external
literature API are disabled by ``TestConfig``; tests that exercise the LLM path
install :class:`FakeLLM` instead, so the suite is offline and deterministic.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path
from typing import Any, Callable

import pymupdf
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402
from app.config import TestConfig  # noqa: E402
from app.db import connect  # noqa: E402
from app.services.llm import LLMUnavailable  # noqa: E402


@pytest.fixture()
def app(tmp_path):
    application = create_app(
        TestConfig,
        DATA_DIR=tmp_path,
        DATABASE_PATH=tmp_path / "test.db",
        UPLOAD_DIR=tmp_path / "uploads",
        INDEX_DIR=tmp_path / "index",
    )
    yield application


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def conn(app):
    c = connect(app.config["DATABASE_PATH"])
    yield c
    c.close()


@pytest.fixture()
def rag(app):
    return app.extensions["smartlab"]["rag"]


class FakeLLM:
    """Stand-in for :class:`ClaudeClient` that returns scripted responses."""

    def __init__(self, text: str | Callable[[str, str], str] | None = None, json_result: dict | None = None,
                 fail: bool = False):
        self.available = True
        self.model = "fake-model"
        self._text = text
        self._json = json_result
        self._fail = fail
        self.calls: list[dict[str, Any]] = []

    def complete(self, system: str, prompt: str, max_tokens: int = 16000) -> str:
        self.calls.append({"system": system, "prompt": prompt})
        if self._fail:
            raise LLMUnavailable("scripted failure")
        return self._text(system, prompt) if callable(self._text) else (self._text or "")

    def complete_json(self, system: str, content: list, schema: dict, max_tokens: int = 16000) -> dict:
        self.calls.append({"system": system, "content": content, "schema": schema})
        if self._fail:
            raise LLMUnavailable("scripted failure")
        return dict(self._json or {})

    @staticmethod
    def image_block(data: bytes, media_type: str) -> dict:
        return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": "..."}}


@pytest.fixture()
def install_llm(app):
    """Install a FakeLLM into the app (RAG engine + vision/literature callers)."""
    def _install(llm: FakeLLM) -> FakeLLM:
        app.extensions["smartlab"]["llm"] = llm
        app.extensions["smartlab"]["rag"].llm = llm
        return llm
    return _install


def make_pdf(pages: list[str], title: str = "Test Document") -> bytes:
    doc = pymupdf.open()
    doc.set_metadata({"title": title})
    for text in pages:
        page = doc.new_page()
        page.insert_textbox(pymupdf.Rect(50, 50, 550, 800), text, fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


def make_image(fmt: str = "PNG", size=(320, 240), color=(20, 20, 30), draw_red: bool = False) -> bytes:
    img = Image.new("RGB", size, color)
    if draw_red:
        for x in range(40, 120):
            for y in range(40, 100):
                img.putpixel((x, y), (230, 20, 20))
        for x in range(150, 300):
            for y in range(150, 170):
                img.putpixel((x, y), (250, 250, 250))
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


@pytest.fixture()
def pdf_factory():
    return make_pdf


@pytest.fixture()
def image_factory():
    return make_image
