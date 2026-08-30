"""Iteration 47 backend tests.

Covers:
- REGRESSION-FIX 1: company profile state + location_id persistence (POST/PUT/GET)
- REGRESSION-FIX 4: /api/sales/summary excludes 'returned' sales
- NEW FEATURE A: DELETE /api/purchase-orders/{id} pending-only guard
- NEW FEATURE B: inventory item location_id round-trip + non-admin location scoping
"""
import os
import uuid

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
MGR = {"email": "qa_mgr_iter46@sensoper.com", "password": "Manager@123"}
STAFF = {"email": "qa_staff_iter46@sensoper.com", "password": "Staff@123"}

TAG = uuid.uuid4().hex[:6]


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login failed for {creds['email']}: {r.status_code} {r.text[:300]}")
    return s


@pytest.fixture(scope="session")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def locations(admin):
    r = admin.get(f"{API}/locations", timeout=30)
    assert r.status_code == 200, r.text
    locs = r.json()
    if len(locs) < 2:
        # ensure at least two locations for scoping tests
        for i in range(2 - len(locs)):
            cr = admin.post(f"{API}/locations", json={
                "name": f"TEST_Loc_{TAG}_{i}", "code": f"T{TAG[:3].upper()}{i}", "type": "branch"
            }, timeout=30)
            assert cr.status_code == 200, cr.text
        locs = admin.get(f"{API}/locations", timeout=30).json()
    assert len(locs) >= 2, "need >=2 locations"
    return locs


# ---------------- REGRESSION-FIX 1: Company profile state + location ----------------
class TestCompanyProfileStateLocation:
    def test_create_with_state_and_location_persists(self, admin, locations):
        loc_id = locations[0]["id"]
        payload = {
            "company_name": f"TEST_Co_{TAG}",
            "address": "1 Test Rd", "phone": "+91 9000000000",
            "email": f"test_{TAG}@example.com",
            "state": "Karnataka", "location_id": loc_id,
        }
        r = admin.post(f"{API}/company", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        try:
            lst = admin.get(f"{API}/company", timeout=30)
            assert lst.status_code == 200
            prof = next((p for p in lst.json() if p["id"] == pid), None)
            assert prof is not None, "created profile missing from list"
            assert prof["state"] == "Karnataka"
            assert prof["location_id"] == loc_id

            # PUT update state + location
            new_loc = locations[1]["id"]
            up = admin.put(f"{API}/company/{pid}", json={"state": "Tamil Nadu", "location_id": new_loc}, timeout=30)
            assert up.status_code == 200, up.text
            prof2 = next(p for p in admin.get(f"{API}/company", timeout=30).json() if p["id"] == pid)
            assert prof2["state"] == "Tamil Nadu"
            assert prof2["location_id"] == new_loc
        finally:
            admin.delete(f"{API}/company/{pid}", timeout=30)


# ---------------- NEW FEATURE A: PO delete pending only ----------------
class TestPurchaseOrderDelete:
    def _create_po(self, admin, location_id=None):
        payload = {
            "supplier_name": f"TEST_Supplier_{TAG}",
            "supplier_contact": "9000000000",
            "items": [{"name": "TEST_Panel", "qty": 2, "unit_price": 100}],
        }
        if location_id:
            payload["location_id"] = location_id
        r = admin.post(f"{API}/purchase-orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_po_number_generated_with_location(self, admin, locations):
        data = self._create_po(admin, locations[0]["id"])
        assert data.get("po_number", "").startswith("PO-")
        admin.delete(f"{API}/purchase-orders/{data['id']}", timeout=30)

    def test_delete_pending_po_succeeds_and_removed(self, admin):
        data = self._create_po(admin)
        pid = data["id"]
        d = admin.delete(f"{API}/purchase-orders/{pid}", timeout=30)
        assert d.status_code == 200, d.text
        pos = admin.get(f"{API}/purchase-orders", timeout=30).json()
        assert all(p["id"] != pid for p in pos), "deleted PO still listed"

    def test_delete_non_pending_po_returns_400(self, admin):
        data = self._create_po(admin)
        pid = data["id"]
        ap = admin.put(f"{API}/purchase-orders/{pid}/approve", timeout=30)
        assert ap.status_code == 200, ap.text
        d = admin.delete(f"{API}/purchase-orders/{pid}", timeout=30)
        assert d.status_code == 400, f"expected 400, got {d.status_code} {d.text[:200]}"
        assert "pending" in d.text.lower()

    def test_delete_nonexistent_po_returns_404(self, admin):
        d = admin.delete(f"{API}/purchase-orders/507f1f77bcf86cd799439011", timeout=30)
        assert d.status_code == 404, f"got {d.status_code}: {d.text[:200]}"


# ---------------- NEW FEATURE B: Inventory location scoping ----------------
class TestInventoryLocationScoping:
    def test_item_location_roundtrip_and_filter(self, admin, locations):
        loc_a, loc_b = locations[0]["id"], locations[1]["id"]
        payload = {
            "name": f"TEST_Item_{TAG}", "sku_code": f"TEST-SKU-{TAG}",
            "category": "panels", "quantity": 5, "unit_price": 50.0,
            "location_id": loc_a,
        }
        r = admin.post(f"{API}/inventory/items", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        item_id = r.json().get("id")
        try:
            lst = admin.get(f"{API}/inventory/items", timeout=30).json()
            found = next((i for i in lst if i["id"] == item_id), None)
            assert found is not None
            assert found["location_id"] == loc_a

            # filter by location_id query param
            filt = admin.get(f"{API}/inventory/items", params={"location_id": loc_a}, timeout=30).json()
            assert any(i["id"] == item_id for i in filt)
            assert all(i.get("location_id") == loc_a for i in filt), "location filter leaked other branches"

            filt_b = admin.get(f"{API}/inventory/items", params={"location_id": loc_b}, timeout=30).json()
            assert all(i["id"] != item_id for i in filt_b)

            # update: clear location -> becomes global (None)
            up = admin.put(f"{API}/inventory/items/{item_id}", json={"location_id": ""}, timeout=30)
            assert up.status_code == 200, up.text
            lst2 = admin.get(f"{API}/inventory/items", timeout=30).json()
            assert next(i for i in lst2 if i["id"] == item_id)["location_id"] is None

            # reassign to loc_b
            up2 = admin.put(f"{API}/inventory/items/{item_id}", json={"location_id": loc_b}, timeout=30)
            assert up2.status_code == 200
            lst3 = admin.get(f"{API}/inventory/items", timeout=30).json()
            assert next(i for i in lst3 if i["id"] == item_id)["location_id"] == loc_b
        finally:
            admin.delete(f"{API}/inventory/items/{item_id}", timeout=30)

    def test_item_detail_endpoint_returns_location_id(self, admin, locations):
        """BUG: GET /api/inventory/items/{id} omits location_id from its projection."""
        loc_a = locations[0]["id"]
        r = admin.post(f"{API}/inventory/items", json={
            "name": f"TEST_Detail_{TAG}", "sku_code": f"TEST-DT-{TAG}",
            "category": "panels", "quantity": 1, "unit_price": 1.0, "location_id": loc_a,
        }, timeout=30)
        assert r.status_code == 200, r.text
        item_id = r.json()["id"]
        try:
            single = admin.get(f"{API}/inventory/items/{item_id}", timeout=30)
            assert single.status_code == 200
            assert single.json().get("location_id") == loc_a, (
                "single-item GET does not return location_id")
        finally:
            admin.delete(f"{API}/inventory/items/{item_id}", timeout=30)

    def test_non_admin_scoped_visibility(self, admin, locations):
        """Manager assigned to loc_a should see loc_a + global items but NOT loc_b items."""
        loc_a, loc_b = locations[0]["id"], locations[1]["id"]
        users = admin.get(f"{API}/users", timeout=30)
        assert users.status_code == 200, users.text
        mgr = next((u for u in users.json() if u["email"] == MGR["email"]), None)
        if not mgr:
            pytest.skip("qa_mgr_iter46 user not present")
        assign = admin.put(f"{API}/users/{mgr['id']}/locations",
                           json={"location_ids": [loc_a], "default_location_id": loc_a}, timeout=30)
        assert assign.status_code == 200, assign.text

        ids = {}
        for tag, loc in (("a", loc_a), ("b", loc_b), ("global", None)):
            p = {"name": f"TEST_Scope_{TAG}_{tag}", "sku_code": f"TEST-SC-{TAG}-{tag}",
                 "category": "panels", "quantity": 3, "unit_price": 10.0}
            if loc:
                p["location_id"] = loc
            rr = admin.post(f"{API}/inventory/items", json=p, timeout=30)
            assert rr.status_code == 200, rr.text
            ids[tag] = rr.json()["id"]
        try:
            mgr_s = _login(MGR)
            seen = mgr_s.get(f"{API}/inventory/items", timeout=30)
            assert seen.status_code == 200, seen.text
            seen_ids = {i["id"] for i in seen.json()}
            assert ids["a"] in seen_ids, "manager cannot see item from its own branch"
            assert ids["global"] in seen_ids, "manager cannot see legacy/global item"
            assert ids["b"] not in seen_ids, "manager sees item from a branch it is NOT assigned to (scoping leak)"

            # admin sees all
            admin_ids = {i["id"] for i in admin.get(f"{API}/inventory/items", timeout=30).json()}
            assert all(ids[k] in admin_ids for k in ids), "admin should see all items"
        finally:
            for i in ids.values():
                admin.delete(f"{API}/inventory/items/{i}", timeout=30)

    def test_alerts_include_location_id(self, admin):
        r = admin.get(f"{API}/inventory/alerts", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", data.get("alerts", []))
        if items:
            assert "location_id" in items[0], f"alerts item missing location_id: {list(items[0].keys())}"


# ---------------- REGRESSION-FIX 4: sales summary excludes returned ----------------
class TestSalesSummaryExcludesReturned:
    def test_returned_sale_not_counted(self, admin):
        base = admin.get(f"{API}/sales/summary", timeout=30)
        assert base.status_code == 200, base.text
        b = base.json()
        base_rev = b.get("total_revenue", b.get("revenue", 0))

        payload = {
            "sale_type": "counter",
            "customer": {"name": f"TEST_Cust_{TAG}", "phone": "9000000001"},
            "lines": [{"name": "TEST_Widget", "quantity": 1, "unit_price": 1000, "gst_percentage": 0}],
            "payments": [{"mode": "cash", "amount": 1000}],
            "override_negative_stock": True,
        }
        r = admin.post(f"{API}/sales", json=payload, timeout=30)
        assert r.status_code == 200, f"sale create failed: {r.status_code} {r.text[:300]}"
        sale_id = r.json()["id"]
        try:
            after = admin.get(f"{API}/sales/summary", timeout=30).json()
            after_rev = after.get("total_revenue", after.get("revenue", 0))
            assert after_rev > base_rev, "active sale not counted in summary revenue"

            ret = admin.put(f"{API}/sales/{sale_id}", json={"status": "returned"}, timeout=30)
            assert ret.status_code == 200, f"status update failed: {ret.status_code} {ret.text[:300]}"
            final = admin.get(f"{API}/sales/summary", timeout=30).json()
            final_rev = final.get("total_revenue", final.get("revenue", 0))
            assert abs(final_rev - base_rev) < 0.01, (
                f"returned sale still counted: base={base_rev} after_return={final_rev}")
        finally:
            admin.delete(f"{API}/sales/{sale_id}", timeout=30)


# ---------------- Sanity regression on previously passing endpoints ----------------
class TestSanityRegression:
    @pytest.mark.parametrize("path", [
        "/sales", "/sales/summary", "/deliveries", "/assets", "/amc/contracts",
        "/purchase-orders", "/inventory/items", "/locations", "/company",
        "/reports/amc", "/reports/assets", "/reports/tools", "/reports/expenses",
    ])
    def test_endpoint_ok(self, admin, path):
        r = admin.get(f"{API}{path}", timeout=60)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
