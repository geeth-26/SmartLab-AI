"""Document library API, health check, equipment tour and LLM client fallbacks."""
import io

from app.services.llm import ClaudeClient


def _upload(client, data, name="new_sop.pdf", **form):
    return client.post("/api/documents", data={"file": (io.BytesIO(data), name), **form},
                       content_type="multipart/form-data")


def test_health_reports_pipeline(client):
    body = client.get("/api/health").get_json()
    assert body["status"] == "ok" and body["embeddings"] == "hashing"
    assert body["indexed_chunks"] > 0 and body["llm"]["enabled"] is False


def test_upload_index_query_delete_cycle(client, pdf_factory):
    pdf = pdf_factory(["Autoclave Operation.\n\nLoad the autoclave and run cycle A at 121 C for 20 minutes.",
                       "Error AC-77 means the door seal failed. Replace the gasket."], title="SOP-AUTO-009 Autoclave")
    resp = _upload(client, pdf, title="SOP-AUTO-009 Autoclave")
    assert resp.status_code == 201
    doc = resp.get_json()
    assert doc["page_count"] == 2 and doc["chunk_count"] >= 2

    answer = client.post("/api/chat", json={"question": "What does autoclave error AC-77 mean?"}).get_json()
    assert answer["citations"][0]["document_title"] == "SOP-AUTO-009 Autoclave"
    assert answer["citations"][0]["page"] == 2

    detail = client.get(f"/api/documents/{doc['id']}").get_json()
    assert [p["page"] for p in detail["pages"]] == [1, 2]
    page = client.get(f"/api/documents/{doc['id']}/pages/2").get_json()
    assert "AC-77" in page["chunks"][0]["text"]
    assert client.get(f"/api/documents/{doc['id']}/file").data[:5] == b"%PDF-"

    assert client.delete(f"/api/documents/{doc['id']}").status_code == 204
    after = client.post("/api/chat", json={"question": "What does autoclave error AC-77 mean?"}).get_json()
    assert all(c["document_title"] != "SOP-AUTO-009 Autoclave" for c in after["citations"])
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 404


def test_duplicate_upload_rejected(client, pdf_factory):
    pdf = pdf_factory(["Unique content for duplicate detection."])
    assert _upload(client, pdf).status_code == 201
    dup = _upload(client, pdf, name="copy.pdf")
    assert dup.status_code == 409 and dup.get_json()["document"]["original_name"] == "new_sop.pdf"


def test_pdf_without_text_rejected(client):
    import pymupdf
    doc = pymupdf.open()
    doc.new_page()
    resp = _upload(client, doc.tobytes(), name="scanned.pdf")
    assert resp.status_code == 422 and "OCR" in resp.get_json()["error"]


def test_document_list_and_404s(client):
    docs = client.get("/api/documents").get_json()
    assert len(docs) == 5
    assert client.get("/api/documents/999").status_code == 404
    assert client.get(f"/api/documents/{docs[0]['id']}/pages/0").status_code == 404


def test_equipment_tour_links_sops(client):
    items = client.get("/api/equipment").get_json()
    assert len(items) == 5 and items[0]["training_steps"]
    hplc = client.get(f"/api/equipment/{items[0]['id']}").get_json()
    assert hplc["sop_documents"][0]["title"].startswith("SOP-HPLC-004")


def test_unknown_route_returns_json_404(client):
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404 and "error" in resp.get_json()


def test_claude_client_disabled_without_credentials(monkeypatch):
    for var in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"):
        monkeypatch.delenv(var, raising=False)
    assert ClaudeClient("claude-opus-5-5").available is False
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert ClaudeClient("claude-opus-5-5").available is True
    assert ClaudeClient("claude-opus-5-5", enabled=False).available is False


class _Block:
    def __init__(self, type_, text=""):
        self.type, self.text = type_, text


class _Response:
    def __init__(self, blocks, stop_reason="end_turn"):
        self.content, self.stop_reason, self.stop_details = blocks, stop_reason, None


class _FakeSDK:
    def __init__(self, response):
        self.calls = []
        outer = self

        class _Messages:
            def create(self, **kwargs):
                outer.calls.append(kwargs)
                return response

        self.beta = type("Beta", (), {"messages": _Messages()})()


def _client_with(monkeypatch, response):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    client = ClaudeClient("claude-opus-5-5", effort="medium")
    sdk = _FakeSDK(response)
    client._client = sdk
    return client, sdk


def test_claude_client_request_shape_and_text_extraction(monkeypatch):
    client, sdk = _client_with(monkeypatch, _Response([_Block("thinking"), _Block("text", "Answer [S1].")]))
    assert client.complete("system prompt", "question") == "Answer [S1]."
    call = sdk.calls[0]
    assert call["model"] == "claude-opus-5-5" and call["thinking"] == {"type": "adaptive"}
    assert call["output_config"] == {"effort": "medium"} and call["fallbacks"] == "default"
    assert call["messages"][0]["content"][0] == {"type": "text", "text": "question"}


def test_claude_client_refusal_and_json(monkeypatch):
    import pytest
    from app.services.llm import LLMUnavailable

    client, _ = _client_with(monkeypatch, _Response([], stop_reason="refusal"))
    with pytest.raises(LLMUnavailable, match="declined"):
        client.complete("s", "p")
    client, sdk = _client_with(monkeypatch, _Response([_Block("text", '{"a": 1}')]))
    assert client.complete_json("s", [{"type": "text", "text": "p"}], {"type": "object"}) == {"a": 1}
    assert sdk.calls[0]["output_config"]["format"]["type"] == "json_schema"
    client, _ = _client_with(monkeypatch, _Response([_Block("text", "not json")]))
    with pytest.raises(LLMUnavailable, match="malformed"):
        client.complete_json("s", [], {"type": "object"})
