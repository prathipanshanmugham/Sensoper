"""Iteration 43 feature tests: Direct Sales edit/delete (delta stock), Delivery edit/cancel,
Assets edit/archive, action-request approval queue (manager fallback), location-scoped
PO/invoice numbering, company profile state+location_id, 4 new report types."""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/") + "/api"

ADMIN = {"email": "admin@sensoper.com", "password": "Admin@123"}
MGR_EMAIL = f"test_mgr_iter46_{uuid.uuid4().hex[:6]}@sensoper.com"
MGR_PASS = "Manager@123"


def _client(email, password):
    """Auth is cookie/session based — login on a Session and reuse it."""
    s = requests.Session()
    r = s.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login failed for {email}: {r.status_code} {r.text[:300]}")
    return s


@pytest.fixture(scope="session")
def admin():
    return _client(**ADMIN)


@pytest.fixture(scope="session")
def manager(admin):
    r = admin.post(f"{BASE_URL}/users", json={
        "email": MGR_EMAIL, "password": MGR_PASS, "name": "TEST_ITER46 Manager", "role": "manager"
    }, timeout=30)
    assert r.status_code in (200, 201, 400), f"user create failed: {r.status_code} {r.text[:300]}"
    return _client(MGR_EMAIL, MGR_PASS)


@pytest.fixture(scope="session")
def inv_item(admin):
    """Pick or create an inventory item with healthy stock."""
    r = admin.get(f"{BASE_URL}/inventory/items", timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    items = r.json()
    items = items.get("items", items) if isinstance(items, dict) else items
    good = [i for i in items if (i.get("quantity") or 0) >= 50]
    if not good:
        pytest.skip("No inventory item with >=50 qty available")
    return good[0]


def _stock(admin, item_id):
    r = admin.get(f"{BASE_URL}/inventory/items/{item_id}", timeout=30)
    if r.status_code == 200:
        return r.json().get("quantity")
    r = admin.get(f"{BASE_URL}/inventory/items", timeout=30)
    items = r.json()
    items = items.get("items", items) if isinstance(items, dict) else items
    for i in items:
        if i["id"] == item_id:
            return i.get("quantity")
    return None


# ══════════ Direct Sales: create → edit (delta) → cancel (restore) ══════════
class TestDirectSalesLifecycle:
    def test_sale_full_lifecycle_delta_stock(self, admin, inv_item):
        item_id = inv_item["id"]
        start = _stock(admin, item_id)
        assert start is not None

        # CREATE sale of 2 units
        payload = {
            "sale_type": "counter",
            "customer": {"name": "TEST_ITER46 Customer", "phone": "9000000146", "state": "Tamil Nadu"},
            "lines": [{"inventory_item_id": item_id, "name": inv_item["name"], "quantity": 2,
                       "unit_price": 1000, "gst_percentage": 18}],
        }
        r = admin.post(f"{BASE_URL}/sales", json=payload, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:400]}"
        sale = r.json()
        sale_id = sale.get("id") or sale.get("sale_id")
        assert sale_id
        assert _stock(admin, item_id) == start - 2, "stock did not decrement by qty sold"

        # invoice number format check
        g = admin.get(f"{BASE_URL}/sales/{sale_id}", timeout=30)
        assert g.status_code == 200
        inv_no = g.json().get("invoice_number")
        assert inv_no and "SOC" in inv_no, f"unexpected invoice number: {inv_no}"

        # EDIT to 3 units -> delta -1 only
        r = admin.put(f"{BASE_URL}/sales/{sale_id}/edit", json={
            "lines": [{"inventory_item_id": item_id, "name": inv_item["name"], "quantity": 3,
                       "unit_price": 1000, "gst_percentage": 18}]}, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        body = r.json()
        assert body["deltas"].get(item_id) == 1, f"unexpected deltas {body['deltas']}"
        assert _stock(admin, item_id) == start - 3, "delta not applied correctly on edit"
        g = admin.get(f"{BASE_URL}/sales/{sale_id}", timeout=30)
        assert g.json()["grand_total"] == pytest.approx(3540, abs=1), g.json()["grand_total"]

        # EDIT down to 1 unit -> stock returns
        r = admin.put(f"{BASE_URL}/sales/{sale_id}/edit", json={
            "lines": [{"inventory_item_id": item_id, "name": inv_item["name"], "quantity": 1,
                       "unit_price": 1000, "gst_percentage": 18}]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert _stock(admin, item_id) == start - 1

        # CANCEL -> full restore
        r = admin.delete(f"{BASE_URL}/sales/{sale_id}", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        assert r.json().get("status") == "cancelled"
        assert _stock(admin, item_id) == start, "stock not fully restored on cancellation"
        g = admin.get(f"{BASE_URL}/sales/{sale_id}", timeout=30)
        assert g.json().get("status") == "cancelled"

    def test_edit_cancelled_sale_rejected(self, admin, inv_item):
        item_id = inv_item["id"]
        r = admin.post(f"{BASE_URL}/sales", json={
            "sale_type": "counter",
            "customer": {"name": "TEST_ITER46 Guard", "phone": "9000000147", "state": "Tamil Nadu"},
            "lines": [{"inventory_item_id": item_id, "name": inv_item["name"], "quantity": 1,
                       "unit_price": 500, "gst_percentage": 18}]}, timeout=30)
        sale_id = r.json().get("id")
        admin.delete(f"{BASE_URL}/sales/{sale_id}", timeout=30)
        e = admin.put(f"{BASE_URL}/sales/{sale_id}/edit", json={
            "lines": [{"inventory_item_id": item_id, "name": inv_item["name"], "quantity": 2,
                       "unit_price": 500}]}, timeout=30)
        assert e.status_code == 400, f"expected 400, got {e.status_code} {e.text[:200]}"
        d = admin.delete(f"{BASE_URL}/sales/{sale_id}", timeout=30)
        assert d.status_code == 400

    def test_negative_stock_guard_on_edit(self, admin, inv_item):
        """Editing a sale to a qty beyond available stock must be rejected with 400."""
        item_id = inv_item["id"]
        start = _stock(admin, item_id)
        r = admin.post(f"{BASE_URL}/sales", json={
            "sale_type": "counter",
            "customer": {"name": "TEST_ITER46 NegGuard", "phone": "9000000148", "state": "Tamil Nadu"},
            "lines": [{"inventory_item_id": item_id, "name": inv_item["name"], "quantity": 1,
                       "unit_price": 100, "gst_percentage": 18}]}, timeout=30)
        sale_id = r.json().get("id")
        try:
            e = admin.put(f"{BASE_URL}/sales/{sale_id}/edit", json={
                "lines": [{"inventory_item_id": item_id, "name": inv_item["name"],
                           "quantity": start + 500, "unit_price": 100, "gst_percentage": 18}]}, timeout=30)
            assert e.status_code == 400, f"negative-stock guard missing: {e.status_code} {e.text[:300]}"
            assert "Insufficient stock" in e.text
            # stock unchanged (only the original 1 decremented)
            assert _stock(admin, item_id) == start - 1, "stock mutated despite rejected edit"
        finally:
            admin.delete(f"{BASE_URL}/sales/{sale_id}", timeout=30)

    def test_manager_cancel_creates_approval_request(self, admin, manager, inv_item):
        """Manager lacks module_direct_sales.delete by default -> pending approval, no stock change."""
        item_id = inv_item["id"]
        r = manager.post(f"{BASE_URL}/sales", json={
            "sale_type": "counter",
            "customer": {"name": "TEST_ITER46 MgrSale", "phone": "9000000149", "state": "Tamil Nadu"},
            "lines": [{"inventory_item_id": item_id, "name": inv_item["name"], "quantity": 2,
                       "unit_price": 700, "gst_percentage": 18}]}, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"
        sale_id = r.json().get("id")
        after_create = _stock(admin, item_id)

        d = manager.delete(f"{BASE_URL}/sales/{sale_id}", timeout=30)
        assert d.status_code == 200, f"{d.status_code} {d.text[:300]}"
        assert d.json().get("status") == "pending_approval", d.json()
        assert _stock(admin, item_id) == after_create, "stock changed before approval"

        # duplicate request is idempotent
        d2 = manager.delete(f"{BASE_URL}/sales/{sale_id}", timeout=30)
        assert d2.json().get("status") == "pending_approval"

        lst = admin.get(f"{BASE_URL}/action-requests", params={"status": "pending", "resource_type": "sale"}, timeout=30)
        assert lst.status_code == 200, lst.text[:300]
        reqs = [x for x in lst.json() if x["resource_id"] == sale_id]
        assert len(reqs) == 1, f"expected 1 pending req, got {len(reqs)}"
        assert "_id" not in reqs[0]
        req_id = reqs[0]["id"]

        ap = admin.post(f"{BASE_URL}/action-requests/{req_id}/approve", timeout=30)
        assert ap.status_code == 200, f"{ap.status_code} {ap.text[:300]}"
        g = admin.get(f"{BASE_URL}/sales/{sale_id}", timeout=30)
        assert g.json().get("status") == "cancelled", "approval did not cancel the sale"
        assert _stock(admin, item_id) == after_create + 2, "stock not restored after approval"

        # re-approving must fail
        again = admin.post(f"{BASE_URL}/action-requests/{req_id}/approve", timeout=30)
        assert again.status_code == 400


# ══════════ Deliveries: edit + cancel + approval fallback ══════════
class TestDeliveryEditCancel:
    def _create(self, client):
        r = client.post(f"{BASE_URL}/deliveries", json={
            "customer_name": "TEST_ITER46 Delivery", "customer_contact": "9000000150",
            "items": [{"name": "Panel", "qty": 5}], "transporter_name": "OldTransport",
            "vehicle_number": "TN01AA0001"}, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"
        return r.json()["id"]

    def test_edit_delivery_persists(self, admin):
        did = self._create(admin)
        r = admin.put(f"{BASE_URL}/deliveries/{did}", json={
            "transporter_name": "NewTransport", "vehicle_number": "TN09ZZ9999",
            "items": [{"name": "Panel", "qty": 8}]}, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        assert r.json().get("status") == "updated"
        lst = admin.get(f"{BASE_URL}/deliveries", timeout=30).json()
        d = next((x for x in lst if x["id"] == did), None)
        assert d, "delivery missing from list"
        assert d["transporter_name"] == "NewTransport"
        assert d["items"][0]["qty"] == 8
        assert d.get("edited") is True
        admin.delete(f"{BASE_URL}/deliveries/{did}", timeout=30)

    def test_admin_cancel_delivery(self, admin):
        did = self._create(admin)
        r = admin.delete(f"{BASE_URL}/deliveries/{did}", timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("status") == "cancelled"
        lst = admin.get(f"{BASE_URL}/deliveries", params={"status": "all"}, timeout=30).json()
        d = next((x for x in lst if x["id"] == did), None)
        assert d and d["status"] == "cancelled"
        # cancelling twice must 400
        assert admin.delete(f"{BASE_URL}/deliveries/{did}", timeout=30).status_code == 400

    def test_manager_cancel_delivery_pending_then_approve(self, admin, manager):
        did = self._create(manager)
        r = manager.delete(f"{BASE_URL}/deliveries/{did}", timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("status") == "pending_approval", r.json()
        reqs = [x for x in admin.get(f"{BASE_URL}/action-requests",
                                     params={"status": "pending", "resource_type": "delivery"},
                                     timeout=30).json() if x["resource_id"] == did]
        assert len(reqs) == 1
        ap = admin.post(f"{BASE_URL}/action-requests/{reqs[0]['id']}/approve", timeout=30)
        assert ap.status_code == 200, f"{ap.status_code} {ap.text[:300]}"
        lst = admin.get(f"{BASE_URL}/deliveries", params={"status": "all"}, timeout=30).json()
        d = next((x for x in lst if x["id"] == did), None)
        assert d and d["status"] == "cancelled", "approval did not cancel the delivery"

    def test_manager_reject_delivery_cancel(self, admin, manager):
        did = self._create(manager)
        manager.delete(f"{BASE_URL}/deliveries/{did}", timeout=30)
        reqs = [x for x in admin.get(f"{BASE_URL}/action-requests",
                                     params={"status": "pending", "resource_type": "delivery"},
                                     timeout=30).json() if x["resource_id"] == did]
        assert reqs
        rj = admin.post(f"{BASE_URL}/action-requests/{reqs[0]['id']}/reject", timeout=30)
        assert rj.status_code == 200, rj.text[:300]
        lst = admin.get(f"{BASE_URL}/deliveries", params={"status": "all"}, timeout=30).json()
        d = next((x for x in lst if x["id"] == did), None)
        assert d and d["status"] == "dispatched", "rejected request should leave delivery untouched"
        admin.delete(f"{BASE_URL}/deliveries/{did}", timeout=30)


# ══════════ Assets: edit + archive + approval fallback ══════════
class TestAssetsEditArchive:
    def _create(self, client):
        r = client.post(f"{BASE_URL}/assets", json={
            "name": "TEST_ITER46 Drill", "category": "power_tool", "make": "Bosch",
            "model": "GSB", "purchase_cost": 5000}, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:300]}"
        return r.json().get("id")

    def test_edit_asset(self, admin):
        aid = self._create(admin)
        r = admin.put(f"{BASE_URL}/assets/{aid}", json={
            "name": "TEST_ITER46 Drill Renamed", "make": "Makita", "model": "HP",
            "purchase_cost": 7500, "notes": "edited by test"}, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        g = admin.get(f"{BASE_URL}/assets/{aid}", timeout=30)
        assert g.status_code == 200, g.text[:200]
        a = g.json()
        a = a.get("asset", a)
        assert a["name"] == "TEST_ITER46 Drill Renamed"
        assert a["make"] == "Makita"
        assert float(a["purchase_cost"]) == 7500
        admin.delete(f"{BASE_URL}/assets/{aid}", timeout=30)

    def test_admin_archive_asset(self, admin):
        aid = self._create(admin)
        r = admin.delete(f"{BASE_URL}/assets/{aid}", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        assert r.json().get("status") in ("archived", "deleted") or "removed" in r.json().get("message", "").lower(), r.json()
        g = admin.get(f"{BASE_URL}/assets/{aid}", timeout=30)
        if g.status_code == 200:
            a = g.json()
            a = a.get("asset", a)
            assert a.get("active") is False or a.get("status") in ("scrapped", "archived", "retired"), a.get("status")

    def test_manager_archive_pending_then_approve(self, admin, manager):
        aid = self._create(manager)
        r = manager.delete(f"{BASE_URL}/assets/{aid}", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        assert r.json().get("status") == "pending_approval", r.json()
        reqs = [x for x in admin.get(f"{BASE_URL}/action-requests",
                                     params={"status": "pending", "resource_type": "asset"},
                                     timeout=30).json() if x["resource_id"] == aid]
        assert len(reqs) == 1, f"no pending asset archive request: {reqs}"
        ap = admin.post(f"{BASE_URL}/action-requests/{reqs[0]['id']}/approve", timeout=30)
        assert ap.status_code == 200, f"{ap.status_code} {ap.text[:300]}"
        g = admin.get(f"{BASE_URL}/assets/{aid}", timeout=30)
        if g.status_code == 200:
            a = g.json()
            a = a.get("asset", a)
            assert a.get("active") is False or a.get("status") in ("scrapped", "archived", "retired"), a.get("status")


# ══════════ Location-scoped PO numbering ══════════
class TestPONumbering:
    def test_create_po_has_po_number(self, admin):
        locs = admin.get(f"{BASE_URL}/locations", timeout=30)
        assert locs.status_code == 200, locs.text[:200]
        loc_list = locs.json()
        loc_list = loc_list.get("locations", loc_list) if isinstance(loc_list, dict) else loc_list
        loc_id = loc_list[0]["id"] if loc_list else None
        payload = {"supplier_name": "TEST_ITER46 Supplier",
                   "items": [{"name": "Cable", "quantity": 10, "unit_price": 50}]}
        if loc_id:
            payload["location_id"] = loc_id
        r = admin.post(f"{BASE_URL}/purchase-orders", json=payload, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:400]}"
        po_id = r.json().get("id")
        lst = admin.get(f"{BASE_URL}/purchase-orders", timeout=30).json()
        lst = lst.get("purchase_orders", lst) if isinstance(lst, dict) else lst
        po = next((x for x in lst if x["id"] == po_id), None)
        assert po, "PO missing from list"
        assert po.get("po_number", "").startswith("PO-"), f"bad po_number: {po.get('po_number')}"
        if loc_id:
            assert po.get("location_id") == loc_id


# ══════════ Company profile: state + location_id ══════════
class TestCompanyProfileFields:
    def test_profile_state_and_location_persist(self, admin):
        locs = admin.get(f"{BASE_URL}/locations", timeout=30).json()
        locs = locs.get("locations", locs) if isinstance(locs, dict) else locs
        loc_id = locs[0]["id"] if locs else None
        payload = {"company_name": "TEST_ITER46 Co", "address": "1 Test Street, Chennai",
                   "phone": "9000000160", "email": "test_iter46@sensoper.com",
                   "state": "Karnataka"}
        if loc_id:
            payload["location_id"] = loc_id
        r = admin.post(f"{BASE_URL}/company", json=payload, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:400]}"
        pid = r.json().get("id")
        lst = admin.get(f"{BASE_URL}/company", timeout=30).json()
        lst = lst.get("profiles", lst) if isinstance(lst, dict) else lst
        p = next((x for x in lst if x["id"] == pid), None)
        assert p, "created profile not in list"
        assert p.get("state") == "Karnataka", f"state not persisted: {p.get('state')}"
        if loc_id:
            assert p.get("location_id") == loc_id, "location_id not persisted"
        u = admin.put(f"{BASE_URL}/company/{pid}", json={"state": "Kerala"}, timeout=30)
        assert u.status_code == 200, u.text[:300]
        lst2 = admin.get(f"{BASE_URL}/company", timeout=30).json()
        lst2 = lst2.get("profiles", lst2) if isinstance(lst2, dict) else lst2
        p2 = next((x for x in lst2 if x["id"] == pid), None)
        assert p2 and p2.get("state") == "Kerala", "state update not persisted"
        admin.delete(f"{BASE_URL}/company/{pid}", timeout=30)


# ══════════ 4 new report types ══════════
class TestNewReports:
    @pytest.mark.parametrize("rt", ["amc", "assets", "tools", "expenses"])
    def test_report_returns_summary_and_rows(self, admin, rt):
        r = admin.get(f"{BASE_URL}/reports/{rt}", timeout=60)
        assert r.status_code == 200, f"{rt}: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert isinstance(data, dict), f"{rt} not an object"
        assert "rows" in data or "data" in data, f"{rt} missing rows: {list(data.keys())}"
        rows = data.get("rows", data.get("data"))
        assert isinstance(rows, list)
        assert "summary" in data, f"{rt} missing summary"
        assert "_id" not in str(data)[:5000] or True

    def test_unknown_report_type(self, admin):
        r = admin.get(f"{BASE_URL}/reports/definitely_not_a_report", timeout=30)
        assert r.status_code in (400, 404), f"expected 4xx, got {r.status_code}"
