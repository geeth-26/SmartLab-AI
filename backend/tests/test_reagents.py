"""Reagent inventory queries: stock, expiry, storage, NL lookup and API validation."""
from datetime import date, timedelta

import pytest

from app.services import inventory
from app.services.inventory import InventoryError, annotate


def _reagent(**kw):
    base = {"quantity": 10, "reorder_threshold": 2, "expiry_date": None}
    return annotate({**base, **kw}, today=date(2026, 1, 1))


@pytest.mark.parametrize("kw, status", [
    ({}, "ok"),
    ({"expiry_date": "2025-12-31"}, "expired"),
    ({"expiry_date": "2026-01-20"}, "expiring_soon"),
    ({"quantity": 2}, "low_stock"),
    ({"quantity": 0}, "out_of_stock"),
    ({"quantity": 0, "expiry_date": "2025-06-01"}, "expired"),
])
def test_status_annotation(kw, status):
    assert _reagent(**kw)["status"] == status


def test_days_to_expiry_computed():
    assert _reagent(expiry_date="2026-01-11")["days_to_expiry"] == 10
    assert _reagent()["days_to_expiry"] is None


def test_seeded_inventory_summary(conn):
    s = inventory.summary(conn)
    assert s["total"] == 12
    assert {r["name"] for r in s["expired"]} == {"Fetal Bovine Serum", "DMSO, cell culture grade"}
    assert any(r["name"].startswith("Acetonitrile") for r in s["low_stock"])
    assert any(r["name"].startswith("Trypsin") for r in s["expiring_soon"])


def test_list_filters_and_sorting(conn):
    assert [r["name"] for r in inventory.list_reagents(conn, search="64-17-5")] == ["Ethanol, absolute (200 proof)"]
    freezer = inventory.list_reagents(conn, location="-20")
    assert freezer and all("-20" in r["location"] for r in freezer)
    expiring = inventory.list_reagents(conn, expiring_within=30)
    assert all(r["days_to_expiry"] <= 30 for r in expiring)
    qty = [r["quantity"] for r in inventory.list_reagents(conn, sort="quantity", order="desc")]
    assert qty == sorted(qty, reverse=True)
    assert all(r["status"] == "expired" for r in inventory.list_reagents(conn, status="expired"))


def test_sort_column_is_allow_listed(conn):
    # An injection attempt in the sort parameter silently falls back to name ordering.
    names = [r["name"] for r in inventory.list_reagents(conn, sort="name; DROP TABLE reagents")]
    assert names == sorted(names)
    assert conn.execute("SELECT COUNT(*) FROM reagents").fetchone()[0] == 12


@pytest.mark.parametrize("question, intent, expected", [
    ("How much ethanol do we have left?", "stock", "Ethanol"),
    ("Where is the trypsin stored?", "storage", "-20 C"),
    ("Where can I find the acetonitrile?", "location", "Flammables cabinet F1"),
    ("When does the SYBR master mix expire?", "expiring", "SYBR"),
])
def test_natural_language_named_queries(conn, question, intent, expected):
    r = inventory.natural_language_query(conn, question)
    assert r["intent"] == intent
    assert r["results"]
    assert expected in r["answer"]


def test_natural_language_aggregate_queries(conn):
    expired = inventory.natural_language_query(conn, "Which reagents have expired?")
    assert expired["intent"] == "expired" and len(expired["results"]) == 2
    low = inventory.natural_language_query(conn, "What is running low and needs reorder?")
    assert low["intent"] == "low_stock" and all(r["low_stock"] for r in low["results"])
    soon = inventory.natural_language_query(conn, "What expires in the next 3 weeks?")
    assert all(0 <= r["days_to_expiry"] <= 21 for r in soon["results"])


def test_unknown_reagent_reports_not_found(conn):
    r = inventory.natural_language_query(conn, "How much unobtainium do we have?")
    assert r["results"] == [] and "No matching reagent" in r["answer"]


def test_adjust_stock_never_goes_negative(conn):
    rid = conn.execute("SELECT id FROM reagents WHERE name LIKE 'Ethanol%'").fetchone()[0]
    assert inventory.adjust_stock(conn, rid, -1.5)["quantity"] == pytest.approx(2.0)
    with pytest.raises(InventoryError, match="only 2"):
        inventory.adjust_stock(conn, rid, -5)
    assert inventory.adjust_stock(conn, rid, 4)["quantity"] == pytest.approx(6.0)


@pytest.mark.parametrize("payload, message", [
    ({}, "name is required"),
    ({"name": "X", "quantity": -1}, "cannot be negative"),
    ({"name": "X", "quantity": "lots"}, "must be a number"),
    ({"name": "X", "expiry_date": "31/12/2026"}, "YYYY-MM-DD"),
    ({"name": "X", "cas_number": "not-a-cas"}, "cas_number"),
])
def test_payload_validation(payload, message):
    with pytest.raises(InventoryError, match=message):
        inventory.validate_payload(payload)


def test_reagent_api_crud(client):
    expiry = (date.today() + timedelta(days=5)).isoformat()
    created = client.post("/api/reagents", json={"name": "Tris base", "cas_number": "77-86-1", "quantity": 500,
                                                 "unit": "g", "reorder_threshold": 100, "expiry_date": expiry})
    assert created.status_code == 201
    r = created.get_json()
    assert r["status"] == "expiring_soon"
    rid = r["id"]
    assert client.get(f"/api/reagents/{rid}").get_json()["name"] == "Tris base"
    assert client.patch(f"/api/reagents/{rid}", json={"location": "Shelf 9"}).get_json()["location"] == "Shelf 9"
    assert client.post(f"/api/reagents/{rid}/adjust", json={"delta": -450}).get_json()["status"] == "low_stock"
    assert client.post(f"/api/reagents/{rid}/adjust", json={"delta": -1000}).status_code == 422
    assert client.post(f"/api/reagents/{rid}/adjust", json={"delta": "abc"}).status_code == 400
    assert client.delete(f"/api/reagents/{rid}").status_code == 204
    assert client.get(f"/api/reagents/{rid}").status_code == 404


def test_reagent_api_queries(client):
    assert len(client.get("/api/reagents?status=expired").get_json()) == 2
    assert client.get("/api/reagents?expiring_within=abc").status_code == 400
    body = client.post("/api/reagents/query", json={"question": "where is the DMSO kept?"}).get_json()
    assert body["intent"] == "storage" and "DMSO" in body["answer"]
    assert client.get("/api/reagents/summary").get_json()["total"] == 12
