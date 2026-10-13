"""Embeddings, vector stores, PDF extraction/chunking and retrieval quality."""
import numpy as np
import pytest

from app.rag.embeddings import HashingEmbedder, tokenize
from app.rag.pdf_extractor import chunk_pages, extract_pages, split_sentences, PageText
from app.rag.vector_store import NumpyVectorStore

STORES = [NumpyVectorStore]
try:
    from app.rag.vector_store import FaissVectorStore
    import faiss  # noqa: F401
    STORES.append(FaissVectorStore)
except ImportError:  # faiss-cpu is optional
    pass


# ----------------------------------------------------------------- embeddings
def test_hashing_embedder_is_deterministic_and_normalised():
    e = HashingEmbedder()
    a = e.embed(["Centrifuge imbalance error", "Centrifuge imbalance error"])
    assert a.dtype == np.float32 and a.shape == (2, e.dim)
    assert np.allclose(a[0], a[1])
    assert np.isclose(np.linalg.norm(a[0]), 1.0)


def test_hashing_embedder_semantic_ordering():
    e = HashingEmbedder()
    q, rel, unrel = e.embed(["HPLC high back pressure", "High back-pressure in the HPLC pump", "Thawing frozen cells"])
    assert float(q @ rel) > float(q @ unrel) + 0.2


def test_empty_text_embeds_to_zero_vector():
    assert not HashingEmbedder().embed([""]).any()


def test_tokenizer_handles_hyphenated_terms_and_stems():
    toks = tokenize("Trypsin-EDTA balancing balanced balance E-104")
    assert "trypsin" in toks and "edta" in toks and "trypsin-edta" in toks
    assert toks.count("balanc") == 3
    assert "e-104" in toks


# --------------------------------------------------------------- vector stores
@pytest.mark.parametrize("store_cls", STORES)
def test_store_add_search_remove_roundtrip(store_cls, tmp_path):
    store = store_cls(4, tmp_path)
    vecs = np.eye(4, dtype=np.float32)
    store.add([10, 11, 12, 13], vecs)
    assert len(store) == 4
    hits = store.search(np.array([0, 1, 0, 0], dtype=np.float32), k=2)
    assert hits[0][0] == 11 and hits[0][1] == pytest.approx(1.0)
    store.remove([11])
    assert 11 not in [i for i, _ in store.search(np.array([0, 1, 0, 0], dtype=np.float32), k=4)]


@pytest.mark.parametrize("store_cls", STORES)
def test_store_filter_by_allowed_ids(store_cls):
    store = store_cls(3)
    store.add([1, 2, 3], np.eye(3, dtype=np.float32))
    hits = store.search(np.array([1, 0, 0], dtype=np.float32), k=3, allowed_ids={2, 3})
    assert {i for i, _ in hits} <= {2, 3}
    assert store.search(np.array([1, 0, 0], dtype=np.float32), k=3, allowed_ids=set()) == []


@pytest.mark.parametrize("store_cls", STORES)
def test_store_persistence(store_cls, tmp_path):
    store = store_cls(3, tmp_path)
    store.add([7, 8], np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float32))
    store.save()
    reloaded = store_cls(3, tmp_path)
    assert reloaded.load() and len(reloaded) == 2
    assert reloaded.search(np.array([0, 1, 0], dtype=np.float32), 1)[0][0] == 8


@pytest.mark.parametrize("store_cls", STORES)
def test_store_rejects_dimension_mismatch(store_cls):
    store = store_cls(3)
    with pytest.raises(ValueError):
        store.add([1], np.ones((1, 4), dtype=np.float32))


@pytest.mark.parametrize("store_cls", STORES)
def test_re_adding_an_id_replaces_it(store_cls):
    store = store_cls(2)
    store.add([1], np.array([[1, 0]], dtype=np.float32))
    store.add([1], np.array([[0, 1]], dtype=np.float32))
    assert len(store) == 1
    assert store.search(np.array([0, 1], dtype=np.float32), 1)[0][1] == pytest.approx(1.0)


def test_empty_store_returns_nothing():
    assert NumpyVectorStore(3).search(np.ones(3, dtype=np.float32), 5) == []


# ------------------------------------------------------------ PDF extraction
def test_extract_pages_preserves_page_numbers(pdf_factory):
    pages = extract_pages(pdf_factory(["Alpha page text.", "Beta page text.", "Gamma page text."]))
    assert [p.page for p in pages] == [1, 2, 3]
    assert "Beta" in pages[1].text


def test_running_footers_are_removed(pdf_factory):
    bodies = ["Alpha content here.", "Beta content here.", "Gamma content here."]
    pages = extract_pages(pdf_factory([f"{b}\n\nACME SOP rev 3 - Page {i} of 3" for i, b in enumerate(bodies, 1)]))
    assert all("Page" not in p.text for p in pages)
    assert "Beta content here." in pages[1].text


def test_chunks_never_cross_pages():
    pages = [PageText(1, "First page sentence one. " * 40), PageText(2, "Second page sentence. " * 40)]
    chunks = chunk_pages(pages, size=300, overlap=50)
    assert {c.page for c in chunks} == {1, 2}
    for c in chunks:
        assert ("First" in c.text) != ("Second" in c.text)
        assert len(c.text) <= 300 + 60


def test_chunk_size_validation():
    with pytest.raises(ValueError):
        chunk_pages([PageText(1, "x")], size=0)


def test_headings_are_separate_segments():
    segs = split_sentences("3. Passaging Procedure\nPassage cells at 80% confluence. Aspirate the medium.")
    assert segs[0] == "3. Passaging Procedure"
    assert segs[1].startswith("Passage cells")


# ------------------------------------------------------------------ retrieval
@pytest.mark.parametrize("query, expected_title, expected_page", [
    ("HPLC pump stopped with high pressure error E-104", "SOP-HPLC-004", 3),
    ("trypsin incubation time when passaging HEK293", "SOP-CC-011", 2),
    ("centrifuge lid not latched LID-12", "SOP-CEN-002", 2),
    ("eyewash flush eye exposure", "SOP-SAF-001", 2),
])
def test_retrieval_finds_the_right_page(rag, conn, query, expected_title, expected_page):
    # Superseded versions may also match; the answer layer resolves those (see test_citations).
    hits = [h for h in rag.retrieve(conn, query, k=3) if h.approval_status != "outdated"]
    assert hits, "expected at least one hit"
    assert hits[0].document_title.startswith(expected_title)
    assert hits[0].page == expected_page
    assert hits[0].score >= rag.min_score


def test_retrieval_scores_are_sorted_and_bounded(rag, conn):
    hits = rag.retrieve(conn, "column storage acetonitrile", k=5)
    assert all(-1.0 <= h.score <= 1.0001 for h in hits)
    assert hits[0].document_title.startswith("SOP-HPLC-004")


def test_retrieval_can_be_restricted_to_documents(rag, conn):
    doc_id = conn.execute("SELECT id FROM documents WHERE title LIKE 'SOP-CEN%'").fetchone()[0]
    hits = rag.retrieve(conn, "high pressure error", k=5, document_ids=[doc_id])
    assert hits and all(h.document_id == doc_id for h in hits)


def test_index_rebuilds_after_restart(app, rag, conn):
    before = [h.chunk_id for h in rag.retrieve(conn, "imbalance error", k=3)]
    (app.config["INDEX_DIR"] / "vectors.npz").unlink()
    rag.store.remove([r[0] for r in conn.execute("SELECT id FROM chunks")])
    rag.ensure_index(conn)
    assert [h.chunk_id for h in rag.retrieve(conn, "imbalance error", k=3)] == before


def test_vector_search_endpoint(client):
    resp = client.post("/api/search/vector", json={"query": "IMB-01 imbalance", "k": 3})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["results"][0]["is_evidence"] is True
    assert client.post("/api/search/vector", json={"query": "x", "k": 500}).status_code == 400


@pytest.mark.skipif(len(STORES) < 2, reason="faiss-cpu not installed")
def test_full_pipeline_on_faiss_backend(tmp_path):
    from app import create_app
    from app.config import TestConfig
    from app.db import connect

    app = create_app(TestConfig, VECTOR_BACKEND="faiss", DATA_DIR=tmp_path, DATABASE_PATH=tmp_path / "f.db",
                     UPLOAD_DIR=tmp_path / "up", INDEX_DIR=tmp_path / "idx")
    engine = app.extensions["smartlab"]["rag"]
    assert engine.store.backend == "faiss"
    conn = connect(app.config["DATABASE_PATH"])
    try:
        doc_id = conn.execute("SELECT id FROM documents WHERE title LIKE 'SOP-CEN%'").fetchone()[0]
        hits = engine.retrieve(conn, "imbalance error IMB-01", k=3, document_ids=[doc_id])
        assert hits and all(h.document_id == doc_id for h in hits) and hits[0].page == 1
        assert (tmp_path / "idx" / "index.faiss").exists()
    finally:
        conn.close()
