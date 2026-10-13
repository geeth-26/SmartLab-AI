"""Exact page-level citations and grounding verification."""
import re

import pytest

from app.rag.engine import Evidence, renumber_citations, verify_citations
from app.services.llm import LLMUnavailable
from tests.conftest import FakeLLM

GROUNDED_QUESTIONS = [
    "What does error E-104 mean?",
    "How long do I incubate cells with trypsin-EDTA?",
    "How should reversed-phase columns be stored at the end of the day?",
    "What do I do if a tube breaks in the centrifuge?",
    "How long should I flush my eyes after an exposure?",
]


@pytest.mark.parametrize("question", GROUNDED_QUESTIONS)
def test_every_grounded_answer_has_valid_page_citations(rag, conn, question):
    result = rag.answer(conn, question)
    assert result["evidence_status"] in ("grounded", "partial")
    assert result["citations"], "a grounded answer must carry citations"
    assert verify_citations(result["answer"], result["citations"], conn) == []
    for c in result["citations"]:
        assert c["document_title"] and isinstance(c["page"], int) and c["page"] >= 1
        assert f"*{c['document_title']}*, p. {c['page']}" in result["answer"]


@pytest.mark.parametrize("question, title_prefix, page, fact", [
    ("What does error E-104 mean?", "SOP-HPLC-004", 3, "400 bar"),
    ("trypsin-EDTA incubation time at 37 C", "SOP-CC-011", 2, "3 to 5 minutes"),
    ("How long to flush eyes at the eyewash station?", "SOP-SAF-001", 2, "15"),
    ("What does the IMB-01 error mean?", "SOP-CEN-002", 1, "imbalance"),
])
def test_citation_points_to_the_exact_page_containing_the_fact(rag, conn, question, title_prefix, page, fact):
    result = rag.answer(conn, question)
    cited = [c for c in result["citations"] if c["document_title"].startswith(title_prefix)]
    assert any(c["page"] == page for c in cited), result["citations"]
    page_text = " ".join(r[0] for r in conn.execute(
        "SELECT c.text FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.title LIKE ? AND c.page = ?",
        (title_prefix + "%", page)))
    assert fact.lower() in page_text.lower()


def test_inline_markers_are_sequential(rag, conn):
    result = rag.answer(conn, "HPLC high pressure and column storage")
    body = result["answer"].split("\n---\n")[0]
    markers = sorted({int(m) for m in re.findall(r"\[(\d+)\]", body)})
    assert markers == list(range(1, len(result["citations"]) + 1))


def _ev(n):
    return [Evidence(i, 1, "Doc", i, f"text {i}", 0.5) for i in range(1, n + 1)]


def test_renumber_drops_hallucinated_source_ids():
    text, used = renumber_citations("Fact A [S2]. Fact B [S9]. Fact C [S1][S1].", _ev(2))
    assert text == "Fact A [1]. Fact B . Fact C [2]."
    assert [e.chunk_id for e in used] == [2, 1]


def test_renumber_without_valid_citations_raises():
    with pytest.raises(LLMUnavailable):
        renumber_citations("An answer with no sources at all.", _ev(3))
    with pytest.raises(LLMUnavailable):
        renumber_citations("Only fake ones [S7].", _ev(3))


def test_llm_answer_citations_are_mapped_to_pages(rag, conn, install_llm):
    llm = install_llm(FakeLLM("E-104 means the pressure exceeded 400 bar and the pump stopped [S1]."))
    result = rag.answer(conn, "What does error E-104 mean?")
    assert result["mode"] == "llm"
    assert result["citations"][0]["page"] == result["retrieved"][0]["page"]
    assert verify_citations(result["answer"], result["citations"], conn) == []
    # The prompt must carry title + page for each source and the citation rules.
    call = llm.calls[0]
    assert 'page="3"' in call["prompt"] and "[S1]" in call["system"]


def test_uncited_llm_answer_falls_back_to_extractive(rag, conn, install_llm):
    install_llm(FakeLLM("The pressure was too high. Replace the frit."))  # no citations
    result = rag.answer(conn, "What does error E-104 mean?")
    assert result["mode"] == "extractive"
    assert result["citations"]
    assert verify_citations(result["answer"], result["citations"], conn) == []


def test_llm_failure_falls_back_to_extractive(rag, conn, install_llm):
    install_llm(FakeLLM(fail=True))
    result = rag.answer(conn, "How do I balance the centrifuge rotor?")
    assert result["mode"] == "extractive" and result["citations"]


def test_verify_citations_detects_tampering(rag, conn):
    result = rag.answer(conn, "What does error E-104 mean?")
    tampered = [dict(c) for c in result["citations"]]
    tampered[0]["page"] = 99
    tampered[0]["snippet"] = "Invented sentence that is nowhere in the document."
    problems = verify_citations(result["answer"], tampered, conn)
    assert any("page/document" in p for p in problems)
    assert any("snippet" in p for p in problems)
    with_unknown_marker = result["answer"].replace("\n---\n", " Extra claim [42].\n---\n", 1)
    assert any("[42]" in p for p in verify_citations(with_unknown_marker, result["citations"], conn))


def test_chat_endpoint_persists_citations(client):
    resp = client.post("/api/chat", json={"question": "What does LID-12 mean on the centrifuge?"})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["citations"] and body["citations"][0]["page"] == 2
    history = client.get(f"/api/chat/{body['session_id']}").get_json()
    assert [m["role"] for m in history] == ["user", "assistant"]
    assert history[1]["citations"][0]["page"] == 2


def test_page_preview_renders_png_with_highlight(client, conn):
    doc_id = conn.execute("SELECT id FROM documents WHERE title LIKE 'SOP-HPLC%'").fetchone()[0]
    resp = client.get(f"/api/documents/{doc_id}/pages/3/preview?highlight=pressure exceeded the upper pressure limit")
    assert resp.status_code == 200 and resp.mimetype == "image/png"
    assert resp.data[:8] == b"\x89PNG\r\n\x1a\n"
    assert client.get(f"/api/documents/{doc_id}/pages/99/preview").status_code == 404


# ------------------------------------------------------------ versions & approval
def test_approved_version_preferred_over_outdated(rag, conn):
    result = rag.answer(conn, "trypsin-EDTA incubation time when passaging HEK293")
    cited = {(c["doc_code"], c["version"]) for c in result["citations"]}
    assert ("SOP-CC-011", "2.0") in cited
    assert ("SOP-CC-011", "1.0") not in cited
    assert "8 to 10 minutes" not in result["answer"]
    excluded = [i for i in result["source_issues"] if i["type"] == "superseded_version_excluded"]
    assert excluded and "1.0" in excluded[0]["message"] and "2.0" in excluded[0]["message"]
    assert result["evidence_status"] == "grounded"  # resolved in favour of the approved copy


def test_outdated_version_alone_is_flagged(app, rag, conn):
    current = conn.execute("SELECT id FROM documents WHERE doc_code = 'SOP-CC-011' AND version = '2.0'").fetchone()[0]
    rag.delete(conn, current, app.config["UPLOAD_DIR"])
    result = rag.answer(conn, "trypsin-EDTA incubation time when passaging HEK293")
    assert result["citations"][0]["approval_status"] == "outdated"
    assert result["evidence_status"] == "partial" and result["requires_verification"] is True
    assert any(i["type"] == "outdated_source" for i in result["source_issues"])


def test_pending_document_requires_verification(rag, conn):
    result = rag.answer(conn, "What does the IMB-01 error mean?")
    assert any(i["type"] == "pending_source" for i in result["source_issues"])
    assert result["requires_verification"] is True


def test_citations_carry_document_metadata(rag, conn):
    c = rag.answer(conn, "What does error E-104 mean?")["citations"][0]
    assert c["version"] == "3.1" and c["approval_status"] == "approved" and c["category"] == "Instrument"


def test_safety_answers_require_human_verification(rag, conn):
    result = rag.answer(conn, "How long should I flush my eyes after an exposure?")
    assert result["citations"][0]["category"] == "Safety"
    assert result["requires_verification"] is True


def test_llm_outage_is_reported(rag, conn, install_llm):
    install_llm(FakeLLM(fail=True))
    result = rag.answer(conn, "What does error E-104 mean?")
    assert result["service_notice"] and result["service_notice"] in result["warnings"]
