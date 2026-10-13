"""Lab Experiment Simulation models and the literature search pipeline."""
import pytest
import requests

from app.services import literature, simulation
from tests.conftest import FakeLLM


# ----------------------------------------------------------------- simulation
def test_catalog_lists_all_models(client):
    ids = {m["id"] for m in client.get("/api/simulations").get_json()}
    assert ids == {"enzyme_kinetics", "pcr_amplification", "bacterial_growth", "dose_response"}


def test_michaelis_menten_half_vmax_at_km():
    r = simulation.run("enzyme_kinetics", {"vmax": 100, "km": 50, "inhibitor": 0, "substrate_max": 50})
    assert r["series"][0]["points"][-1]["y"] == pytest.approx(50, rel=1e-3)
    assert r["metrics"]["apparent_km"] == 50


def test_competitive_inhibitor_raises_apparent_km():
    r = simulation.run("enzyme_kinetics", {"km": 50, "inhibitor": 20, "ki": 20})
    assert r["metrics"]["apparent_km"] == pytest.approx(100)
    assert r["metrics"]["inhibition_at_km_percent"] > 0


def test_more_template_gives_earlier_ct():
    low = simulation.run("pcr_amplification", {"initial_copies": 100})["metrics"]["ct"]
    high = simulation.run("pcr_amplification", {"initial_copies": 100000})["metrics"]["ct"]
    assert high < low
    assert low - high == pytest.approx(3 * 3.4, abs=1.5)  # ~3.3 cycles per 10-fold at ~100% efficiency


def test_pcr_no_ct_warning():
    r = simulation.run("pcr_amplification", {"initial_copies": 1, "cycles": 10})
    assert r["metrics"]["ct"] is None and r["warnings"]


def test_growth_temperature_dependence():
    opt = simulation.run("bacterial_growth", {"temperature": 37})["metrics"]
    cold = simulation.run("bacterial_growth", {"temperature": 20})["metrics"]
    dead = simulation.run("bacterial_growth", {"temperature": 2})
    assert opt["effective_mu_max"] == pytest.approx(1.2, rel=1e-3)
    assert cold["effective_mu_max"] < opt["effective_mu_max"]
    assert dead["metrics"]["effective_mu_max"] == 0 and dead["warnings"]


def test_dose_response_midpoint():
    r = simulation.run("dose_response", {"ec50": 10, "hill": 1, "bottom": 0, "top": 100})
    pts = r["series"][0]["points"]
    mid = min(pts, key=lambda p: abs(p["x"] - 10))
    assert mid["y"] == pytest.approx(50, abs=6)
    assert r["metrics"]["ec90_ec10_ratio"] == pytest.approx(81, rel=1e-3)


def test_simulation_disclaimer_and_assumptions():
    r = simulation.run("dose_response")
    assert "not experimental data" in r["disclaimer"] and r["assumptions"]


@pytest.mark.parametrize("model, params, status", [
    ("nope", {}, 404),
    ("enzyme_kinetics", {"km": -5}, 422),
    ("enzyme_kinetics", {"km": "abc"}, 422),
    ("enzyme_kinetics", {"temperature": 3}, 422),
])
def test_simulation_api_validation(client, model, params, status):
    assert client.post(f"/api/simulations/{model}", json={"params": params}).status_code == status


# ----------------------------------------------------------------- literature
def test_offline_literature_search_cross_references_sops(client):
    body = client.get("/api/literature/search?q=HPLC back-pressure buffer precipitation").get_json()
    assert body["source"] == "offline-sample"
    paper = body["papers"][0]
    assert "back-pressure" in paper["title"].lower()
    assert paper["summary"] and paper["summary_mode"] == "extractive"
    assert any(d["document_title"].startswith("SOP-HPLC-004") for d in paper["related_documents"])


def test_extractive_summary_uses_abstract_sentences():
    abstract = "First sentence about cells. Second sentence about trypsin storage at -20 C. Third about nothing."
    summary = literature.extractive_summary(abstract, "trypsin storage")
    assert "trypsin storage" in summary and all(s in abstract for s in summary.split(". ") if s)


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_online_search_parses_europe_pmc(app, conn, monkeypatch):
    payload = {"resultList": {"result": [{
        "id": "123", "source": "MED", "title": "Trypsin <i>stability</i>", "authorString": "Doe J",
        "pubYear": "2024", "doi": "10.1/abc", "journalInfo": {"journal": {"title": "J Cell Methods"}},
        "abstractText": "Trypsin-EDTA aliquots stored at -20 C kept activity. Freeze-thaw reduced activity."}]}}
    monkeypatch.setattr(literature.requests, "get", lambda *a, **k: _Resp(payload))
    llm = FakeLLM("Aliquoted trypsin kept activity at -20 C.")
    result = literature.search(conn, app.extensions["smartlab"]["rag"], llm, "trypsin stability", online=True)
    paper = result["papers"][0]
    assert result["source"] == "europe-pmc"
    assert paper["title"] == "Trypsin stability" and paper["url"] == "https://doi.org/10.1/abc"
    assert paper["summary_mode"] == "llm" and paper["year"] == 2024
    assert "Use only facts stated in the abstract" in llm.calls[0]["system"]


def test_online_failure_falls_back_to_offline(app, conn, monkeypatch):
    def boom(*a, **k):
        raise requests.ConnectionError("offline")
    monkeypatch.setattr(literature.requests, "get", boom)
    result = literature.search(conn, app.extensions["smartlab"]["rag"], FakeLLM(fail=True), "mycoplasma PCR", online=True)
    assert result["source"] == "offline-sample" and result["warnings"]
    assert result["papers"][0]["summary_mode"] == "extractive"


def test_literature_query_validation(client):
    assert client.get("/api/literature/search?q=a").status_code == 400
