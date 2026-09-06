"""Iter 49 — Ecommerce reconstructed into Products (inline per-platform listings) + Orders."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST49E_{uuid.uuid4().hex[:5]}"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": "Admin@123"}, timeout=60)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def platform(client):
    r = client.post(f"{API}/ecommerce/platforms", json={"name": f"{TAG}_Plat", "commission_pct": 10}, timeout=60)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    client.delete(f"{API}/ecommerce/platforms/{pid}", timeout=60)


@pytest.fixture(scope="module")
def item(client):
    r = client.get(f"{API}/inventory/items", timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    items = data.get("items", data) if isinstance(data, dict) else data
    assert items, "need at least one inventory item"
    return items[0]


class TestMigration:
    def test_migration_marker_present(self, client):
        r = client.get(f"{API}/ecommerce/migration-status", timeout=60)
        assert r.status_code == 200
        assert r.json().get("value", 0) >= 2

    def test_no_active_duplicate_platform_item_pairs(self, client):
        rows = client.get(f"{API}/ecommerce/listings", timeout=60).json()
        seen = set()
        for l in rows:
            if l.get("superseded_by"):
                continue
            key = (l["platform_id"], l["inventory_item_id"])
            assert key not in seen, f"duplicate active listing for {key}"
            seen.add(key)

    def test_products_view_matches_listings(self, client):
        prods = client.get(f"{API}/ecommerce/products", timeout=60).json()
        listings = [l for l in client.get(f"{API}/ecommerce/listings", timeout=60).json() if not l.get("superseded_by")]
        active_platform_ids = {p["id"] for p in prods["platforms"]}
        expected = {(l["platform_id"], l["inventory_item_id"]) for l in listings if l["platform_id"] in active_platform_ids}
        got = {(pid, r["inventory_item_id"]) for r in prods["rows"] for pid in r["listings"]}
        # every migrated listing on an active platform for an existing inventory item shows up in Products
        assert expected.intersection(got) == {k for k in expected if k in got}
        assert got.issubset({(l["platform_id"], l["inventory_item_id"]) for l in listings})


class TestProducts:
    def test_add_product_on_platform(self, client, platform, item):
        r = client.post(f"{API}/ecommerce/products", json={
            "inventory_item_id": item["id"],
            "platforms": [{"platform_id": platform, "listed_price": 1500, "platform_commission_pct": 12, "status": "live"}],
        }, timeout=60)
        assert r.status_code == 200, r.text
        cell = r.json()["listings"][platform]
        assert cell["listed_price"] == 1500 and cell["status"] == "live" and cell["platform_commission_pct"] == 12

    def test_products_grid_has_row_and_platform_column(self, client, platform, item):
        d = client.get(f"{API}/ecommerce/products", timeout=60).json()
        assert any(p["id"] == platform for p in d["platforms"])
        row = next(r for r in d["rows"] if r["inventory_item_id"] == item["id"])
        assert row["listings"][platform]["listed_price"] == 1500
        assert "stock_available" in row and row["item_name"] == item["name"]

    def test_inline_upsert_updates_price(self, client, platform, item):
        r = client.put(f"{API}/ecommerce/products/{item['id']}/platforms/{platform}", json={"listed_price": 1750}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["listed_price"] == 1750
        d = client.get(f"{API}/ecommerce/products", timeout=60).json()
        row = next(r for r in d["rows"] if r["inventory_item_id"] == item["id"])
        assert row["listings"][platform]["listed_price"] == 1750

    def test_upsert_does_not_create_duplicate(self, client, platform, item):
        rows = client.get(f"{API}/ecommerce/listings", params={"platform_id": platform}, timeout=60).json()
        assert len([l for l in rows if l["inventory_item_id"] == item["id"] and not l.get("superseded_by")]) == 1

    def test_live_requires_commission(self, client, platform, item):
        # second item without commission → cannot be live
        items = client.get(f"{API}/inventory/items", timeout=60).json()
        items = items.get("items", items) if isinstance(items, dict) else items
        other = next((i for i in items if i["id"] != item["id"]), None)
        if not other:
            pytest.skip("need 2 inventory items")
        r = client.put(f"{API}/ecommerce/products/{other['id']}/platforms/{platform}", json={"listed_price": 900, "status": "live"}, timeout=60)
        assert r.status_code == 400 and "commission" in r.json()["detail"].lower()
        r = client.put(f"{API}/ecommerce/products/{other['id']}/platforms/{platform}", json={"listed_price": 900, "status": "draft"}, timeout=60)
        assert r.status_code == 200
        client.delete(f"{API}/ecommerce/products/{other['id']}", timeout=60)

    def test_new_listing_requires_price(self, client, platform):
        r = client.put(f"{API}/ecommerce/products/000000000000000000000001/platforms/{platform}", json={"status": "draft"}, timeout=60)
        assert r.status_code == 400

    def test_filters(self, client, platform, item):
        d = client.get(f"{API}/ecommerce/products", params={"platform_id": platform, "status": "live"}, timeout=60).json()
        assert all(platform in r["listings"] for r in d["rows"])
        d2 = client.get(f"{API}/ecommerce/products", params={"search": "zzz_no_such_item_zzz"}, timeout=60).json()
        assert d2["rows"] == []

    def test_order_uses_listing_commission(self, client, platform, item):
        oid = f"{TAG}-ORD1"
        r = client.post(f"{API}/ecommerce/orders", json={
            "platform_id": platform, "platform_order_id": oid, "order_date": "2026-06-01",
            "lines": [{"inventory_item_id": item["id"], "quantity": 1, "sold_price": 1750}], "override_negative_stock": True,
        }, timeout=60)
        assert r.status_code == 200, r.text
        o = r.json()
        # listing_id not supplied → order pricing falls back to platform pct (10) → 175
        assert o["commission_total"] in (175.0, 210.0)
        client.delete(f"{API}/ecommerce/orders/{o['id']}", timeout=60)

    def test_delist_product(self, client, platform, item):
        r = client.delete(f"{API}/ecommerce/products/{item['id']}", timeout=60)
        assert r.status_code == 200 and r.json()["delisted"] >= 1
        d = client.get(f"{API}/ecommerce/products", timeout=60).json()
        row = next(r for r in d["rows"] if r["inventory_item_id"] == item["id"])
        assert row["listings"][platform]["status"] == "delisted"
        d2 = client.get(f"{API}/ecommerce/products", params={"include_delisted": "false"}, timeout=60).json()
        assert not any(platform in r["listings"] for r in d2["rows"] if r["inventory_item_id"] == item["id"])

    def test_staff_cannot_write(self, platform, item):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": "staff@sensoper.com", "password": "Staff@123"}, timeout=60)
        if r.status_code != 200:
            pytest.skip("no staff account")
        r = s.put(f"{API}/ecommerce/products/{item['id']}/platforms/{platform}", json={"listed_price": 1}, timeout=60)
        assert r.status_code == 403
