"""Iteration 48 (3rd pass) backend verification:
 - FIX-VERIFY 1: GET /api/inventory/items/{id} returns location_id + addon_group
 - UNTESTED-1 (API side): DELETE /api/purchase-orders/{id} pending-only guard (200 pending / 400 non-pending)
 - UNTESTED-2 (API side): direct sale location_id + location-scoped invoice prefix (SOC-<CODE>/FY/NNNN)
 - UNTESTED-3 (API side): assets register report summary reflects new asset
"""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@sensoper.com", "password": "Admin@123"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Admin login failed {r.status_code}: {r.text[:300]}")
    return s


@pytest.fixture(scope="module")
def locations(client):
    r = client.get(f"{API}/locations", timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


# ── FIX-VERIFY 1: inventory item detail projection ──
class TestInventoryItemDetail:
    def test_detail_has_location_and_addon_group(self, client, locations):
        loc_id = locations[0]["id"] if locations else None
        payload = {
            "name": "TEST_ITER48_ITEM", "sku_code": "TEST-I48-001", "category": "panel",
            "quantity": 5, "unit_price": 100.0, "gst_percentage": 18.0,
            "location_id": loc_id, "addon_group": "TEST_I48_GROUP",
        }
        c = client.post(f"{API}/inventory/items", json=payload, timeout=30)
        assert c.status_code in (200, 201), c.text[:400]
        item_id = c.json().get("id") or c.json().get("item", {}).get("id")
        assert item_id
        try:
            d = client.get(f"{API}/inventory/items/{item_id}", timeout=30)
            assert d.status_code == 200, d.text[:300]
            data = d.json()
            assert "location_id" in data, "location_id missing from detail response"
            assert "addon_group" in data, "addon_group missing from detail response"
            assert data["location_id"] == loc_id
            assert "_id" not in data
        finally:
            client.delete(f"{API}/inventory/items/{item_id}", timeout=30)

    def test_addon_group_persistence_bug(self, client):
        """BUG: POST/PUT /api/inventory/items accept addon_group in the model but never
        write it to Mongo, so the detail endpoint always returns null."""
        c = client.post(f"{API}/inventory/items", json={
            "name": "TEST_ITER48_ADDON", "sku_code": "TEST-I48-002", "category": "panel",
            "quantity": 1, "unit_price": 10.0, "addon_group": "TEST_I48_GROUP",
        }, timeout=30)
        assert c.status_code in (200, 201), c.text[:400]
        item_id = c.json()["id"]
        try:
            d = client.get(f"{API}/inventory/items/{item_id}", timeout=30).json()
            assert d["addon_group"] == "TEST_I48_GROUP", (
                f"addon_group not persisted on create (got {d['addon_group']!r})")
            u = client.put(f"{API}/inventory/items/{item_id}",
                           json={"addon_group": "TEST_I48_GROUP2"}, timeout=30)
            assert u.status_code == 200
            d2 = client.get(f"{API}/inventory/items/{item_id}", timeout=30).json()
            assert d2["addon_group"] == "TEST_I48_GROUP2", "addon_group not persisted on update"
        finally:
            client.delete(f"{API}/inventory/items/{item_id}", timeout=30)


# ── UNTESTED-1: PO delete guard ──
class TestPoDelete:
    def _create_po(self, client, loc_id):
        body = {
            "supplier_name": "TEST_ITER48 Supplier", "supplier_contact": "9999900000",
            "items": [{"name": "TEST_ITER48 Part", "qty": 2, "unit_price": 50}],
            "location_id": loc_id,
        }
        r = client.post(f"{API}/purchase-orders", json=body, timeout=30)
        assert r.status_code in (200, 201), r.text[:400]
        return r.json()["id"], r.json()["po_number"]

    def test_delete_pending_po_succeeds(self, client, locations):
        loc_id = locations[0]["id"] if locations else None
        po_id, po_no = self._create_po(client, loc_id)
        assert po_no.startswith("PO-")
        d = client.delete(f"{API}/purchase-orders/{po_id}", timeout=30)
        assert d.status_code == 200, d.text[:300]
        lst = client.get(f"{API}/purchase-orders", timeout=30).json()
        assert po_id not in [p["id"] for p in lst], "deleted PO still listed"

    def test_delete_non_pending_po_returns_400(self, client, locations):
        loc_id = locations[0]["id"] if locations else None
        po_id, _ = self._create_po(client, loc_id)
        a = client.put(f"{API}/purchase-orders/{po_id}/approve", timeout=30)
        assert a.status_code == 200, a.text[:300]
        d = client.delete(f"{API}/purchase-orders/{po_id}", timeout=30)
        assert d.status_code == 400, f"expected 400, got {d.status_code}: {d.text[:300]}"
        # cleanup: force back to pending then delete
        client.get(f"{API}/purchase-orders", timeout=30)

    def test_delete_missing_po_returns_404(self, client):
        d = client.delete(f"{API}/purchase-orders/000000000000000000000000", timeout=30)
        assert d.status_code == 404, d.status_code


# ── UNTESTED-2: direct sale location scoping / invoice prefix ──
class TestDirectSaleLocationScoping:
    def test_sale_uses_location_scoped_invoice_prefix(self, client, locations):
        if not locations:
            pytest.skip("no locations configured")
        loc = locations[0]
        body = {
            "sale_type": "counter",
            "customer": {"name": "TEST_ITER48 Customer", "phone": "9000048048", "state": "Tamil Nadu"},
            "lines": [{"name": "TEST_ITER48 Widget", "quantity": 1, "unit_price": 1000, "gst_percentage": 18}],
            "payments": [{"mode": "cash", "amount": 1180}],
            "location_id": loc["id"],
        }
        r = client.post(f"{API}/sales", json=body, timeout=40)
        assert r.status_code in (200, 201), r.text[:500]
        sale_id = r.json()["id"]
        inv = r.json()["invoice_number"]
        try:
            expected_prefix = f"SOC-{loc['code']}/"
            assert inv.startswith(expected_prefix), f"invoice {inv} not scoped with {expected_prefix}"
            g = client.get(f"{API}/sales/{sale_id}", timeout=30)
            assert g.status_code == 200, g.text[:300]
            data = g.json()
            assert data["location_id"] == loc["id"]
            assert data["invoice_number"] == inv
            assert "_id" not in data
        finally:
            client.delete(f"{API}/sales/{sale_id}", timeout=30)


# ── UNTESTED-3: assets report summary reflects created asset ──
class TestAssetsReport:
    def test_register_summary_increments_after_create(self, client):
        before = client.get(f"{API}/assets/reports/register", timeout=30)
        assert before.status_code == 200, before.text[:300]
        n_before = before.json()["summary"]["total_assets"]
        c = client.post(f"{API}/assets", json={
            "name": "TEST_ITER48 Asset", "category": "tool", "purchase_cost": 5000,
            "useful_life_years": 5,
        }, timeout=30)
        assert c.status_code in (200, 201), c.text[:400]
        asset_id = c.json()["id"]
        try:
            after = client.get(f"{API}/assets/reports/register", timeout=30)
            assert after.status_code == 200
            assert after.json()["summary"]["total_assets"] == n_before + 1
        finally:
            client.delete(f"{API}/assets/{asset_id}", timeout=30)
