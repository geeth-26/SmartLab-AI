"""Error-to-fix mapping and unified reagent + document search."""
import pytest

from app.services import troubleshooting as ts


@pytest.mark.parametrize("text, codes", [
    ("Display shows E-104 again", ["E-104"]),
    ("imb01 and lid 12", ["IMB-01", "LID-12"]),
    ("no codes here", []),
])
def test_error_code_extraction(text, codes):
    assert ts.extract_error_codes(text) == codes


def test_error_code_match_ranks_first(conn):
    matches = ts.match(conn, "the HPLC shows E104 and stopped")
    assert matches[0]["error_code"] == "E-104"
    assert "error code E-104" in matches[0]["match_reasons"]
    assert matches[0]["source_document"].startswith("SOP-HPLC-004") and matches[0]["source_page"] == 3


def test_symptom_keyword_match(conn):
    matches = ts.match(conn, "cell culture medium turned cloudy and yellow overnight")
    assert matches[0]["equipment"] == "Cell culture"
    assert "contamination" in matches[0]["keywords"]


def test_unrelated_query_returns_nothing(conn):
    assert ts.match(conn, "quarterly budget spreadsheet formatting") == []


def test_new_entries_are_unverified_until_reviewed(client):
    created = client.post("/api/troubleshooting", json={
        "equipment": "Plate reader", "symptom": "Wells read saturated", "keywords": "saturated, overflow",
        "probable_cause": "Gain too high", "fix": "Lower the gain"}).get_json()
    assert created["verified"] is False
    body = client.post("/api/troubleshooting/match", json={"query": "plate reader saturated wells"}).get_json()
    assert all(m["id"] != created["id"] for m in body["matches"])
    body = client.post("/api/troubleshooting/match",
                       json={"query": "plate reader saturated wells", "include_unverified": True}).get_json()
    assert body["matches"][0]["id"] == created["id"]
    assert client.post("/api/troubleshooting", json={"equipment": "x"}).status_code == 422


def test_unified_search_queries_documents_and_inventory_together(client):
    body = client.get("/api/search/unified?q=trypsin storage").get_json()
    assert body["documents"] and body["documents"][0]["document_title"].startswith("SOP-CC-011")
    assert "text" not in body["documents"][0] and body["documents"][0]["snippet"]
    assert any(r["name"].startswith("Trypsin") for r in body["reagents"])
    assert "-20 C" in body["inventory_answer"]


def test_unified_search_includes_troubleshooting(client):
    body = client.get("/api/search/unified?q=IMB-01 imbalance").get_json()
    assert body["troubleshooting"][0]["error_code"] == "IMB-01"
    assert body["documents"][0]["page"] == 1
    assert body["counts"]["troubleshooting"] >= 1


def test_unified_search_validation(client):
    assert client.get("/api/search/unified?q=a").status_code == 400
