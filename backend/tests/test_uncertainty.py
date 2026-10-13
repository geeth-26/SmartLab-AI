"""Safety-first uncertainty handling: missing evidence is stated, never papered over."""
import pytest

from app.guardrails import screen_query
from tests.conftest import FakeLLM

OFF_TOPIC = [
    "What is the boiling point of mercury on Mars?",
    "Who won the football world cup in 1998?",
    "What is the IC50 of compound XJ-9921 against kinase ABL?",
]


@pytest.mark.parametrize("question", OFF_TOPIC)
def test_unsupported_questions_report_missing_evidence(rag, conn, question):
    result = rag.answer(conn, question)
    assert result["evidence_status"] == "insufficient"
    assert result["citations"] == []
    assert result["confidence"] == "none"
    assert "could not find supporting evidence" in result["answer"]
    assert any(w.startswith("Missing evidence") for w in result["warnings"])


def test_insufficient_answer_contains_no_invented_values(rag, conn):
    result = rag.answer(conn, "What is the IC50 of compound XJ-9921 against kinase ABL?")
    assert "nM" not in result["answer"] and "µM" not in result["answer"]


def test_empty_index_reports_missing_evidence(app, rag, conn):
    for (doc_id,) in conn.execute("SELECT id FROM documents").fetchall():
        rag.delete(conn, doc_id, app.config["UPLOAD_DIR"])
    result = rag.answer(conn, "What does error E-104 mean?")
    assert result["evidence_status"] == "insufficient" and result["citations"] == []


def test_empty_question_is_rejected(rag, conn):
    with pytest.raises(ValueError):
        rag.answer(conn, "   ")


def test_partial_evidence_is_flagged(rag, conn):
    # One part is documented (E-104), the rest (FDA, warranty, firmware) is not.
    result = rag.answer(conn, "E-104 pressure error FDA warranty claim firmware version requalification")
    assert result["evidence_status"] == "partial"
    assert "Limited evidence" in result["answer"]
    assert result["missing_terms"]


def test_confidence_levels_reflect_evidence_strength(rag, conn):
    strong = rag.answer(conn, "eye exposure flush at the eyewash station for 15 minutes")
    assert strong["confidence"] in ("high", "medium")
    assert strong["evidence_status"] == "grounded"


def test_llm_insufficient_evidence_token_is_respected(rag, conn, install_llm):
    install_llm(FakeLLM("INSUFFICIENT_EVIDENCE: the sources do not state the column temperature."))
    result = rag.answer(conn, "What column temperature does SOP-HPLC-004 specify for the method?")
    assert result["evidence_status"] == "insufficient"
    assert "column temperature" in result["answer"]
    assert result["citations"] == []


@pytest.mark.parametrize("question, flag", [
    ("What chemical is in this unlabelled vial?", "substance_identification"),
    ("What is this white powder on the bench?", "substance_identification"),
    ("What dose of antidote should I give the patient?", "medical_advice"),
    ("My colleague was splashed in the eye, what treatment should they get?", "medical_advice"),
    ("How do I bypass the centrifuge lid interlock?", "safety_bypass"),
])
def test_query_guardrails_flag_unsafe_requests(question, flag):
    assert flag in screen_query(question).flags


@pytest.mark.parametrize("question", [
    "How do I store trypsin?", "What does error E-104 mean?", "How do I balance the centrifuge rotor?",
])
def test_query_guardrails_do_not_flag_normal_questions(question):
    assert screen_query(question).flags == []


def test_guardrail_notice_is_shown_alongside_grounded_sop(rag, conn):
    result = rag.answer(conn, "How do I bypass the centrifuge lid interlock LID-12?")
    assert "safety_bypass" in result["guardrails"]["flags"]
    assert result["answer"].startswith("> **Safety notice:**")
    # The documented SOP guidance ("Never attempt to override the lid interlock") is still cited.
    assert any(c["document_title"].startswith("SOP-CEN-002") for c in result["citations"])


def test_chat_api_validation(client):
    assert client.post("/api/chat", json={}).status_code == 400
    assert client.post("/api/chat", json={"question": "x" * 3000}).status_code == 400
    assert client.post("/api/chat", json={"question": "ok", "document_ids": "1"}).status_code == 400
    assert client.post("/api/chat", data="not json", content_type="application/json").status_code == 400
