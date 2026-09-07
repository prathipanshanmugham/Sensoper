"""Iter 51 — Pricelist restructure (backed by inventory_items). Replaces the stale
test_iter44_batch_b_pricelist.py which targeted the removed catalogue product collections."""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST51_{uuid.uuid4().hex[:5]}"


def _env(key):
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get(key)


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": "Admin@123"}, timeout=60)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def items(client):
    """Two items: one in a standard category, one with a stray legacy category name."""
    created = []
    for cat, sku in (("inverters", "INV"), ("Panels", "PNL")):
        r = client.post(f"{API}/inventory/items", json={"name": f"{TAG} {cat} item", "sku_code": f"{TAG}-{sku}", "category": cat,
                                                        "quantity": 5, "unit_price": 10000, "gst_percentage": 12, "reorder_level": 1}, timeout=60)
        assert r.status_code in (200, 201), r.text
        created.append(r.json()["id"] if "id" in r.json() else r.json().get("item", {}).get("id"))
    yield created
    db = MongoClient(_env("MONGO_URL"))[_env("DB_NAME")]
    from bson import ObjectId
    db.inventory_items.delete_many({"_id": {"$in": [ObjectId(i) for i in created if i]}})
    db.price_history.delete_many({"product_id": {"$in": created}})


def _row(client, item_id, **params):
    d = client.get(f"{API}/pricelist", params={"status": "all", **params}, timeout=60).json()
    return next((r for r in d["items"] if r["id"] == item_id), None), d


class TestPricelistView:
    def test_shape_and_every_item_visible(self, client, items):
        d = client.get(f"{API}/pricelist", params={"status": "all"}, timeout=60).json()
        assert {"categories", "items", "default_margin_pct", "gst_pct", "total"} <= set(d)
        ids = {r["id"] for r in d["items"]}
        assert set(items) <= ids, "every inventory item must appear in the pricelist"
        assert d["total"] == len(d["items"])

    def test_stray_category_surfaces_as_uncategorised(self, client, items):
        row, d = _row(client, items[1])
        assert row["category"] == "uncategorised" and row["raw_category"] == "Panels"
        assert any(c["slug"] == "uncategorised" and c["count"] >= 1 for c in d["categories"])
        row0, _ = _row(client, items[0])
        assert row0["category"] == "inverters" and row0["category_label"] == "Inverters"

    def test_default_margin_and_math(self, client, items):
        row, d = _row(client, items[0])
        assert row["margin_is_default"] is True and row["margin_pct"] == d["default_margin_pct"]
        assert row["selling_price"] == round(10000 * (1 + d["default_margin_pct"] / 100), 2)
        assert row["gst_pct"] == 12
        assert row["price_incl_gst"] == round(row["selling_price"] * 1.12, 2)

    def test_filters(self, client, items):
        d = client.get(f"{API}/pricelist", params={"status": "all", "category": "inverters"}, timeout=60).json()
        assert all(r["category"] == "inverters" for r in d["items"]) and items[0] in {r["id"] for r in d["items"]}
        d = client.get(f"{API}/pricelist", params={"status": "all", "search": TAG.lower()}, timeout=60).json()
        assert {r["id"] for r in d["items"]} == set(items)


class TestPricelistEdits:
    def test_margin_saves_and_returns_computed_row(self, client, items):
        r = client.put(f"{API}/pricelist/items/{items[0]}", json={"margin_pct": 22.5}, timeout=60)
        assert r.status_code == 200, r.text
        row = r.json()
        assert row["margin_pct"] == 22.5 and row["margin_is_default"] is False and row["selling_price"] == 12250.0
        again, _ = _row(client, items[0])
        assert again["margin_pct"] == 22.5, "margin did not persist"
        inv = client.get(f"{API}/inventory/items", timeout=60).json()
        inv = inv.get("items", inv) if isinstance(inv, dict) else inv
        assert next(i for i in inv if i["id"] == items[0])["margin_pct"] == 22.5, "inventory is the single source of truth"

    def test_legacy_inventory_put_returns_item(self, client, items):
        r = client.put(f"{API}/inventory/items/{items[0]}", json={"margin_pct": 30}, timeout=60)
        assert r.status_code == 200 and r.json()["margin_pct"] == 30 and r.json()["id"] == items[0]

    def test_cost_gst_hsn_edits(self, client, items):
        r = client.put(f"{API}/pricelist/items/{items[0]}", json={"unit_price": 20000, "gst_percentage": 18, "hsn_code": " 8504 "}, timeout=60)
        assert r.status_code == 200, r.text
        row = r.json()
        assert row["unit_price"] == 20000 and row["gst_pct"] == 18 and row["hsn_code"] == "8504"
        assert row["selling_price"] == 26000.0 and row["price_incl_gst"] == 30680.0

    def test_validation(self, client, items):
        assert client.put(f"{API}/pricelist/items/{items[0]}", json={"unit_price": -1}, timeout=60).status_code == 400
        assert client.put(f"{API}/pricelist/items/{items[0]}", json={"gst_percentage": 150}, timeout=60).status_code == 400
        assert client.put(f"{API}/pricelist/items/000000000000000000000001", json={"margin_pct": 1}, timeout=60).status_code == 404

    def test_history_recorded(self, client, items):
        h = client.get(f"{API}/pricelist/items/{items[0]}/history", timeout=60).json()
        assert h and h[0]["user_name"] and "after" in h[0]
        assert any(e["after"].get("margin_pct") == 22.5 for e in h)
        recent = client.get(f"{API}/pricelist/history", timeout=60).json()
        assert any(e["product_id"] == items[0] for e in recent)

    def test_archive_and_restore(self, client, items):
        r = client.put(f"{API}/pricelist/items/{items[0]}", json={"active": False}, timeout=60)
        assert r.status_code == 200 and r.json()["active"] is False
        d = client.get(f"{API}/pricelist", params={"status": "active"}, timeout=60).json()
        assert items[0] not in {x["id"] for x in d["items"]}
        d = client.get(f"{API}/pricelist", params={"status": "archived"}, timeout=60).json()
        assert items[0] in {x["id"] for x in d["items"]}
        client.put(f"{API}/pricelist/items/{items[0]}", json={"active": True}, timeout=60)

    def test_bulk_actions(self, client, items):
        r = client.post(f"{API}/pricelist/bulk", json={"item_ids": items, "action": "set_margin", "value": 10}, timeout=60)
        assert r.status_code == 200 and r.json()["updated"] == 2 and all(x["margin_pct"] == 10 for x in r.json()["items"])
        r = client.post(f"{API}/pricelist/bulk", json={"item_ids": items, "action": "adjust_margin_pts", "value": 5}, timeout=60)
        assert all(x["margin_pct"] == 15 for x in r.json()["items"])
        before = {x["id"]: x["unit_price"] for x in r.json()["items"]}
        r = client.post(f"{API}/pricelist/bulk", json={"item_ids": items, "action": "adjust_price_pct", "value": 10}, timeout=60)
        for x in r.json()["items"]:
            assert x["unit_price"] == round(before[x["id"]] * 1.1, 2)
        assert client.post(f"{API}/pricelist/bulk", json={"item_ids": items, "action": "nope", "value": 1}, timeout=60).status_code == 400
        assert client.post(f"{API}/pricelist/bulk", json={"item_ids": [], "action": "set_margin", "value": 1}, timeout=60).status_code == 400

    def test_staff_cannot_write(self, items):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": "staff@sensoper.com", "password": "Staff@123"}, timeout=60)
        if r.status_code != 200:
            pytest.skip("no staff account")
        assert s.put(f"{API}/pricelist/items/{items[0]}", json={"margin_pct": 1}, timeout=60).status_code == 403


class TestCategoryNormalise:
    def test_preview_maps_stray_names(self, client, items):
        plan = client.get(f"{API}/pricelist/normalise-categories", timeout=60).json()["plan"]
        step = next(p for p in plan if p["from"] == "Panels")
        assert step["to"] == "solar_panels" and step["count"] >= 1

    def test_manual_move(self, client, items):
        r = client.post(f"{API}/pricelist/items/{items[1]}/category", json={"category": "solar_panels"}, timeout=60)
        assert r.status_code == 200
        row, _ = _row(client, items[1])
        assert row["category"] == "solar_panels"
        assert client.post(f"{API}/pricelist/items/{items[1]}/category", json={"category": "nope"}, timeout=60).status_code == 400


class TestCalculatorConsistency:
    def test_quick_calc_uses_pricelist_default_margin(self, client):
        cfg = client.get(f"{API}/catalogue/config", timeout=60).json()
        d = client.get(f"{API}/pricelist", timeout=60).json()
        assert d["default_margin_pct"] == cfg["default_margin_pct"]
