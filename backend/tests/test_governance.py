"""Document metadata & approval, audit trail, conversation history, answer feedback,
safety resources, settings, literature filters and schema migration."""
import io
import sqlite3

import pytest

from app.db import init_schema
from app.services import literature


def _doc(client, code, version):
    return next(d for d in client.get("/api/documents").get_json() if d["doc_code"] == code and d["version"] == version)


# ------------------------------------------------------------------ documents
def test_document_list_filters_and_sorting(client):
    approved = client.get("/api/documents?status=approved").get_json()
    assert approved and all(d["approval_status"] == "approved" for d in approved)
    safety = client.get("/api/documents?category=Safety").get_json()
    assert [d["doc_code"] for d in safety] == ["SOP-SAF-001"]
    found = client.get("/api/documents?q=HPLC").get_json()
    assert [d["doc_code"] for d in found] == ["SOP-HPLC-004"]
    titles = [d["title"] for d in client.get("/api/documents?sort=title&order=asc").get_json()]
    assert titles == sorted(titles, key=str.lower)
    # Unknown sort columns fall back safely instead of reaching SQL.
    assert client.get("/api/documents?sort=title;DROP TABLE documents").status_code == 200
    facets = client.get("/api/documents/facets").get_json()
    assert "Safety" in facets["categories"] and facets["approval_statuses"][0] == "approved"


def test_upload_defaults_to_unreviewed_and_accepts_metadata(client, pdf_factory):
    pdf = pdf_factory(["Glovebox oxygen sensor calibration. Purge with argon for 30 minutes."])
    resp = client.post("/api/documents", content_type="multipart/form-data", data={
        "file": (io.BytesIO(pdf), "glovebox.pdf"), "category": "Instrument", "version": "1.2", "owner": "Jordan Lee"})
    doc = resp.get_json()
    assert resp.status_code == 201
    assert doc["approval_status"] == "unreviewed" and doc["version"] == "1.2" and doc["category"] == "Instrument"
    bad = client.post("/api/documents", content_type="multipart/form-data", data={
        "file": (io.BytesIO(pdf_factory(["other"])), "x.pdf"), "approval_status": "super-approved"})
    assert bad.status_code == 422


def test_approval_change_is_audited_and_affects_answers(client):
    cen = _doc(client, "SOP-CEN-002", "2.0-draft")
    before = client.post("/api/chat", json={"question": "What does the IMB-01 error mean?"}).get_json()
    assert any(i["type"] == "pending_source" for i in before["source_issues"])

    updated = client.patch(f"/api/documents/{cen['id']}", json={"approval_status": "approved", "version": "2.0",
                                                                 "actor": "Sam Novak"}).get_json()
    assert updated["approval_status"] == "approved" and updated["reviewed_at"]
    detail = client.get(f"/api/documents/{cen['id']}").get_json()
    assert detail["history"][0]["action"] == "status_change" and "pending -> approved" in detail["history"][0]["summary"]

    after = client.post("/api/chat", json={"question": "What does the IMB-01 error mean?"}).get_json()
    assert after["source_issues"] == [] and after["citations"][0]["version"] == "2.0"
    assert client.patch(f"/api/documents/{cen['id']}", json={"approval_status": "maybe"}).status_code == 422
    assert client.patch(f"/api/documents/{cen['id']}", json={"title": "  "}).status_code == 422


def test_document_detail_lists_other_versions(client):
    current = _doc(client, "SOP-CC-011", "2.0")
    detail = client.get(f"/api/documents/{current['id']}").get_json()
    assert [(v["version"], v["approval_status"]) for v in detail["other_versions"]] == [("1.0", "outdated")]


def test_reindex_rebuilds_chunks(client, conn):
    doc = _doc(client, "SOP-HPLC-004", "3.1")
    old = {r[0] for r in conn.execute("SELECT id FROM chunks WHERE document_id = ?", (doc["id"],))}
    resp = client.post(f"/api/documents/{doc['id']}/reindex")
    assert resp.status_code == 200 and resp.get_json()["chunk_count"] == doc["chunk_count"]
    new = {r[0] for r in conn.execute("SELECT id FROM chunks WHERE document_id = ?", (doc["id"],))}
    assert new and not (old & new)
    answer = client.post("/api/chat", json={"question": "What does error E-104 mean?"}).get_json()
    assert answer["citations"][0]["chunk_id"] in new
    assert client.post("/api/documents/9999/reindex").status_code == 404


# ------------------------------------------------------- conversations/feedback
def test_conversation_history_and_sessions(client):
    first = client.post("/api/chat", json={"question": "What does error E-104 mean?"}).get_json()
    client.post("/api/chat", json={"question": "And how do I store the column?", "session_id": first["session_id"]})
    client.post("/api/chat", json={"question": "Where is the eyewash?"})
    sessions = client.get("/api/chat/sessions").get_json()
    assert len(sessions) == 2
    mine = next(s for s in sessions if s["session_id"] == first["session_id"])
    assert mine["title"] == "What does error E-104 mean?" and mine["message_count"] == 4
    history = client.get(f"/api/chat/{first['session_id']}").get_json()
    assert history[1]["meta"]["evidence_status"] in ("grounded", "partial")
    assert client.delete(f"/api/chat/{first['session_id']}").status_code == 204
    assert client.delete(f"/api/chat/{first['session_id']}").status_code == 404


def test_flagging_an_answer_enters_the_review_queue(client):
    ans = client.post("/api/chat", json={"question": "What does error E-104 mean?"}).get_json()
    url = f"/api/messages/{ans['message_id']}/feedback"
    assert client.post(url, json={"rating": "incorrect"}).status_code == 422  # explanation required
    assert client.post(url, json={"rating": "great"}).status_code == 422
    assert client.post(url, json={"rating": "unsafe", "comment": "Pressure limit is 600 bar on our system"}).status_code == 201

    queue = client.get("/api/feedback").get_json()
    assert len(queue) == 1 and queue[0]["question"] == "What does error E-104 mean?"
    assert queue[0]["citations"][0]["page"] == 3
    fid = queue[0]["id"]
    assert client.post(f"/api/feedback/{fid}/resolve", json={}).status_code == 422
    done = client.post(f"/api/feedback/{fid}/resolve", json={"resolution": "SOP updated to v3.2"}).get_json()
    assert done["status"] == "resolved"
    assert client.post(f"/api/feedback/{fid}/resolve", json={"resolution": "again"}).status_code == 409
    assert client.get("/api/feedback").get_json() == []
    kinds = {i["kind"] for i in client.get("/api/activity").get_json()}
    assert "audit" in kinds


def test_helpful_feedback_does_not_enter_queue(client):
    ans = client.post("/api/chat", json={"question": "What does error E-104 mean?"}).get_json()
    assert client.post(f"/api/messages/{ans['message_id']}/feedback", json={"rating": "helpful"}).status_code == 201
    assert client.get("/api/feedback").get_json() == []
    assert client.post("/api/messages/999999/feedback", json={"rating": "helpful"}).status_code == 404


def test_image_exchange_can_be_recorded(client):
    resp = client.post("/api/chat/abc123/messages", json={"question": "What is this error?", "answer": "Observed E-104",
                                                          "attachment": {"name": "screen.png", "type": "image"}})
    assert resp.status_code == 201
    history = client.get("/api/chat/abc123").get_json()
    assert history[0]["meta"]["attachment"]["name"] == "screen.png"


# -------------------------------------------------------------- safety/settings
def test_safety_overview_uses_recorded_data_only(client):
    body = client.get("/api/safety").get_json()
    assert [d["doc_code"] for d in body["documents"]] == ["SOP-SAF-001"]
    assert all(r["hazard_class"] for r in body["hazardous_reagents"])
    assert body["emergency_contacts"] == ""  # never invented
    assert "does not replace" in body["disclaimer"]


def test_safety_search_is_restricted_to_safety_documents(client):
    body = client.get("/api/safety/search?q=eye exposure eyewash").get_json()
    assert body["results"] and all(r["document_title"].startswith("SOP-SAF-001") for r in body["results"])
    assert "text" not in body["results"][0]
    assert client.get("/api/safety/search?q=x").status_code == 400


def test_settings_roundtrip_and_validation(client):
    s = client.get("/api/settings").get_json()
    assert s["ai"]["enabled"] is False and "No external AI service" in s["ai"]["disclosure"]
    assert s["demo_data"] == {"documents": True, "records": True}
    updated = client.put("/api/settings", json={"emergency_contacts": "Campus security: ext. 2222"}).get_json()
    assert updated["editable"]["emergency_contacts"] == "Campus security: ext. 2222"
    assert client.get("/api/safety").get_json()["emergency_contacts"] == "Campus security: ext. 2222"
    assert client.put("/api/settings", json={"llm_model": "x"}).status_code == 422
    assert client.put("/api/settings", json={"institution_name": "x" * 500}).status_code == 422


def test_reagent_changes_are_audited(client, conn):
    rid = conn.execute("SELECT id FROM reagents WHERE name LIKE 'Ethanol%'").fetchone()[0]
    client.post(f"/api/reagents/{rid}/adjust", json={"delta": -0.5})
    row = conn.execute("SELECT action, summary FROM audit_log WHERE entity_type = 'reagent' ORDER BY id DESC").fetchone()
    assert row[0] == "stock" and "-0.5 L" in row[1]
    assert "Solvent" in client.get("/api/reagents/categories").get_json()
    assert all(r["category"] == "Solvent" for r in client.get("/api/reagents?category=Solvent").get_json())


# ------------------------------------------------------------------ literature
def test_literature_offline_results_are_labelled_as_samples(client):
    body = client.get("/api/literature/search?q=HPLC back-pressure").get_json()
    assert body["retrieved_at"] and all(p["is_sample"] for p in body["papers"])
    assert any("not real publications" in w for w in body["warnings"])


def test_literature_year_filter_and_sort(client):
    body = client.get("/api/literature/search?q=cells trypsin qPCR HPLC mycoplasma&from_year=2023&sort=date").get_json()
    years = [p["year"] for p in body["papers"]]
    assert years and all(y >= 2023 for y in years) and years == sorted(years, reverse=True)
    assert client.get("/api/literature/search?q=cells&from_year=2024&to_year=2020").status_code == 400
    assert client.get("/api/literature/search?q=cells&sort=popular").status_code == 400


def test_europe_pmc_query_includes_year_range(monkeypatch):
    captured = {}

    class R:
        def raise_for_status(self):
            pass

        def json(self):
            return {"resultList": {"result": []}}

    def fake_get(url, params, timeout):
        captured.update(params)
        return R()

    monkeypatch.setattr(literature.requests, "get", fake_get)
    literature._search_europe_pmc("trypsin", 5, 5, 2020, 2024, "date")
    assert captured["query"] == "(trypsin) AND PUB_YEAR:[2020 TO 2024]" and captured["sort"] == "P_PDATE_D desc"


# ------------------------------------------------------------------ migration
def test_migration_adds_columns_to_old_database(tmp_path):
    conn = sqlite3.connect(tmp_path / "old.db")
    conn.executescript("""
        CREATE TABLE documents (id INTEGER PRIMARY KEY, stored_name TEXT, original_name TEXT, title TEXT,
            doc_type TEXT, page_count INTEGER, chunk_count INTEGER, size_bytes INTEGER, sha256 TEXT UNIQUE,
            status TEXT, uploaded_at TEXT);
        CREATE TABLE reagents (id INTEGER PRIMARY KEY, name TEXT, quantity REAL, unit TEXT, reorder_threshold REAL);
        INSERT INTO documents (title, sha256) VALUES ('Legacy SOP', 'abc');
    """)
    init_schema(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(documents)")}
    assert {"approval_status", "version", "doc_code", "category", "owner"} <= cols
    assert conn.execute("SELECT approval_status, category FROM documents").fetchone() == ("unreviewed", "General")
    assert "category" in {r[1] for r in conn.execute("PRAGMA table_info(reagents)")}
    conn.close()
