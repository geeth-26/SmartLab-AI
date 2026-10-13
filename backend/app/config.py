"""Application configuration.

All settings can be overridden with environment variables so the same code runs
in development, CI (pytest) and production without edits.
"""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file() -> None:
    for candidate in [BASE_DIR / ".env", BASE_DIR.parent / ".env"]:
        if candidate.is_file():
            try:
                for line in candidate.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
            except Exception:
                pass
            break


_load_env_file()


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    """Default (development) configuration."""

    SECRET_KEY = os.getenv("SMARTLAB_SECRET_KEY", "dev-only-change-me")
    DATA_DIR = Path(os.getenv("SMARTLAB_DATA_DIR", BASE_DIR / "instance"))
    DATABASE_PATH = Path(os.getenv("SMARTLAB_DATABASE", DATA_DIR / "smartlab.db"))
    UPLOAD_DIR = Path(os.getenv("SMARTLAB_UPLOAD_DIR", DATA_DIR / "uploads"))
    INDEX_DIR = Path(os.getenv("SMARTLAB_INDEX_DIR", DATA_DIR / "index"))

    # Upload limits (bytes). Flask rejects bodies larger than MAX_CONTENT_LENGTH with 413.
    MAX_CONTENT_LENGTH = int(os.getenv("SMARTLAB_MAX_UPLOAD_MB", "25")) * 1024 * 1024
    MAX_PDF_PAGES = int(os.getenv("SMARTLAB_MAX_PDF_PAGES", "600"))
    MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard

    # RAG settings
    EMBEDDING_BACKEND = os.getenv("SMARTLAB_EMBEDDINGS", "auto")  # auto | sentence-transformers | hashing
    EMBEDDING_MODEL = os.getenv("SMARTLAB_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    VECTOR_BACKEND = os.getenv("SMARTLAB_VECTOR_STORE", "auto")  # auto | faiss | numpy
    CHUNK_SIZE = int(os.getenv("SMARTLAB_CHUNK_SIZE", "700"))  # characters
    CHUNK_OVERLAP = int(os.getenv("SMARTLAB_CHUNK_OVERLAP", "120"))
    TOP_K = int(os.getenv("SMARTLAB_TOP_K", "5"))
    # Minimum cosine similarity for a chunk to count as evidence. Below this the
    # assistant reports missing evidence instead of answering. When unset, each
    # embedder's calibrated default is used (lexical and dense scores differ).
    MIN_EVIDENCE_SCORE = float(os.environ["SMARTLAB_MIN_EVIDENCE_SCORE"]) if os.getenv("SMARTLAB_MIN_EVIDENCE_SCORE") else None

    # LLM settings (Claude). If no credentials are available the app falls back to
    # deterministic extractive answers and local image heuristics.
    LLM_ENABLED = _env_bool("SMARTLAB_LLM_ENABLED", True)
    LLM_MODEL = os.getenv("SMARTLAB_LLM_MODEL", "claude-opus-5-5")
    LLM_EFFORT = os.getenv("SMARTLAB_LLM_EFFORT", "medium")

    # Literature search (Europe PMC public REST API, no key needed)
    LITERATURE_ONLINE = _env_bool("SMARTLAB_LITERATURE_ONLINE", True)
    LITERATURE_TIMEOUT = float(os.getenv("SMARTLAB_LITERATURE_TIMEOUT", "8"))

    CORS_ORIGINS = os.getenv("SMARTLAB_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    SEED_DEMO_DATA = _env_bool("SMARTLAB_SEED_DEMO", True)
    TESTING = False


class TestConfig(Config):
    """Configuration used by the pytest suite: offline, deterministic, isolated."""

    TESTING = True
    LLM_ENABLED = False
    LITERATURE_ONLINE = False
    EMBEDDING_BACKEND = "hashing"
    VECTOR_BACKEND = "numpy"
    SEED_DEMO_DATA = True
