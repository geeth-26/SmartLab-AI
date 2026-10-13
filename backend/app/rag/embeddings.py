"""Text embedding backends.

* :class:`SentenceTransformerEmbedder` - dense semantic embeddings
  (``all-MiniLM-L6-v2`` by default). Requires ``sentence-transformers``.
* :class:`HashingEmbedder` - dependency-free lexical embeddings (signed feature
  hashing of stemmed unigrams + bigrams with sublinear TF). Deterministic, fast,
  and used automatically when sentence-transformers is not installed, and by the
  test suite.

All embedders return L2-normalised ``float32`` matrices so inner product equals
cosine similarity. Each declares ``default_min_score`` - the similarity below
which a chunk is not treated as evidence - because score scales differ between
lexical and dense models.
"""
from __future__ import annotations

import hashlib
import logging
import re
from functools import lru_cache
from typing import Protocol

import numpy as np

logger = logging.getLogger(__name__)

_TOKEN = re.compile(r"[a-z0-9][a-z0-9\-]*[a-z0-9]|[a-z0-9]")
STOPWORDS = frozenset(
    """a an and are as at be been but by can could did do does for from had has have how i if in into is it its
    may might must of on or our should so than that the their them then there these they this to was we were what
    when where which while who why will with would you your about after all also any before between both each
    more most other over such through under up very not no nor only own same too just should've
    mean means meaning tell explain describe please need know long much many get got use used using give""".split()
)
_SUFFIXES = ("ization", "ations", "ation", "ments", "ment", "ings", "ing", "edly", "ies", "ied", "es", "ed", "ly", "s")


@lru_cache(maxsize=50_000)
def stem(token: str) -> str:
    if token.isdigit() or len(token) <= 4:
        return token
    for suffix in _SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            token = token[: -len(suffix)]
            if suffix in ("ies", "ied"):
                token += "y"
            break
    # Drop a trailing silent "e" so balance/balanced/balancing share one stem.
    if len(token) > 4 and token.endswith("e") and not token.endswith("ee"):
        token = token[:-1]
    return token


def tokenize(text: str) -> list[str]:
    """Lower-case, drop stopwords, stem. Hyphenated terms ("trypsin-edta", "e-104")
    are kept whole *and* split into their parts so either form matches."""
    out: list[str] = []
    for tok in _TOKEN.findall(text.lower()):
        if tok in STOPWORDS:
            continue
        out.append(stem(tok))
        if "-" in tok:
            out += [stem(part) for part in tok.split("-") if len(part) > 1 and part not in STOPWORDS]
    return out


class Embedder(Protocol):
    name: str
    dim: int
    default_min_score: float

    def embed(self, texts: list[str]) -> np.ndarray: ...


def _normalise(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (matrix / norms).astype(np.float32)


@lru_cache(maxsize=200_000)
def _bucket(feature: str, dim: int) -> tuple[int, float]:
    digest = hashlib.blake2b(feature.encode(), digest_size=8).digest()
    value = int.from_bytes(digest, "little")
    return value % dim, (1.0 if (value >> 63) & 1 else -1.0)


class HashingEmbedder:
    name = "hashing"
    default_min_score = 0.12

    def __init__(self, dim: int = 2048):
        self.dim = dim

    def _features(self, text: str) -> dict[str, float]:
        tokens = tokenize(text)
        counts: dict[str, float] = {}
        for tok in tokens:
            counts[tok] = counts.get(tok, 0.0) + 1.0
        for a, b in zip(tokens, tokens[1:]):
            key = f"{a}_{b}"
            counts[key] = counts.get(key, 0.0) + 0.5
        return counts

    def embed(self, texts: list[str]) -> np.ndarray:
        matrix = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            for feature, count in self._features(text).items():
                idx, sign = _bucket(feature, self.dim)
                matrix[row, idx] += sign * (1.0 + np.log(count))
        return _normalise(matrix)


class SentenceTransformerEmbedder:
    name = "sentence-transformers"
    default_min_score = 0.30

    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer  # heavy import, deferred

        self.model_name = model_name
        self._model = SentenceTransformer(model_name)
        self.dim = int(self._model.get_sentence_embedding_dimension())

    def embed(self, texts: list[str]) -> np.ndarray:
        vectors = self._model.encode(texts, batch_size=32, show_progress_bar=False, normalize_embeddings=True)
        return np.asarray(vectors, dtype=np.float32)


def get_embedder(backend: str = "auto", model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> Embedder:
    if backend in ("auto", "sentence-transformers"):
        try:
            return SentenceTransformerEmbedder(model_name)
        except Exception as exc:  # ImportError, model download failure, ...
            if backend == "sentence-transformers":
                raise
            logger.info("sentence-transformers unavailable (%s); using hashing embedder.", exc)
    return HashingEmbedder()
