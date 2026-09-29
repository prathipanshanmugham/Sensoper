"""Iter 58 — vault reveal bookkeeping, kit categories (Solar Camera), brand-return delete (admin direct / staff approval),
manual PO number unique per vendor."""
import json
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST58_{uuid.uuid4().hex[:5]}"
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")
STAFF_EMAIL = f"{TAG.lower()}_staff@sensoper.com"
STAFF_PW = "Staff@12345"


def _db():
    import pymongo
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    return pymongo.MongoClient(env["MONGO_URL"])[env["DB_NAME"]]


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": ADMIN_PW}, timeout=60).status_code == 200
    return s


@pytest.fixture(scope="module")
def staff(admin):
    r = admin.post(f"{API}/auth/register", json={"email": STAFF_EMAIL, "password": STAFF_PW, "name": f"{TAG} Staff", "role": "staff"}, timeout=60)
    assert r.status_code in (200, 201), r.text
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PW}, timeout=60).status_code == 200
    yield s
    db = _db()
    db.users.delete_many({"email": STAFF_EMAIL})


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    db = _db()
    db.credential_vault.delete_many({"service_name": {"$regex": f"^{TAG}"}})
    db.material_kits.delete_many({"name": {"$regex": f"^{TAG}"}})
    db.kit_categories.delete_many({"label": {"$regex": f"^{TAG}"}})
    db.brand_returns.delete_many({"item_name": {"$regex": f"^{TAG}"}})
    db.action_requests.delete_many({"requested_by_name": {"$regex": f"^{TAG}"}})
    db.account_entries.delete_many({"description": {"$regex": f"^{TAG}"}})
    db.purchase_orders.delete_many({"supplier_name": {"$regex": f"^{TAG}"}})


# ───────────────────────── 1. Vault reveal ─────────────────────────
class TestVaultReveal:
    def test_reveal_returns_password_and_updates_view_stats(self, admin):
        r = admin.post(f"{API}/vault", json={"service_name": f"{TAG} Portal", "account_identifier": "ops@x", "password": "S3cret!x", "category": "other"}, timeout=60)
        assert r.status_code in (200, 201), r.text
        vid = r.json()["id"]
        row = next(x for x in admin.get(f"{API}/vault", timeout=60).json() if x["id"] == vid)
        assert row["view_count"] == 0 and row["last_viewed"] is None and "password" not in row
        for _ in range(2):
            rv = admin.post(f"{API}/vault/{vid}/reveal", timeout=60)
            assert rv.status_code == 200 and rv.json()["password"] == "S3cret!x" and rv.json()["revealed_at"]
        # bookkeeping the dashboard-only refresh relies on
        row = next(x for x in admin.get(f"{API}/vault", timeout=60).json() if x["id"] == vid)
        assert row["view_count"] == 2 and row["last_viewed"]
        assert admin.get(f"{API}/vault/dashboard", timeout=60).status_code == 200
        log = admin.get(f"{API}/vault/{vid}/access-log", timeout=60).json()
        assert sum(1 for e in log if e["action"] == "reveal") == 2
        # Frontend contract: RevealCell keeps its own `plain` state; parent only patches view_count/last_viewed in place
        # and refreshes the dashboard. Verified in the browser (Playwright) that the plaintext stays visible after the refresh.


# ───────────────────────── 2. Kit categories ─────────────────────────
class TestKitCategories:
    def test_seeded_categories_include_solar_camera(self, admin):
        cats = admin.get(f"{API}/kit-categories", timeout=60).json()
        slugs = {c["slug"]: c for c in cats}
        for s in ("on-grid", "off-grid", "hybrid", "solar-pump", "solar-camera"):
            assert s in slugs
        assert slugs["solar-camera"]["system_type"] is None and slugs["on-grid"]["system_type"] == "on-grid"
        assert slugs["on-grid"]["builtin"] is True and slugs["solar-camera"]["builtin"] is False

    def test_admin_add_rename_retire_category(self, admin, staff):
        assert staff.post(f"{API}/kit-categories", json={"label": f"{TAG} Nope"}, timeout=60).status_code == 403
        r = admin.post(f"{API}/kit-categories", json={"label": f"{TAG} Street Light", "color": "amber"}, timeout=60)
        assert r.status_code == 200, r.text
        cat = r.json()
        assert cat["slug"].startswith("test58-") and cat["system_type"] is None
        assert admin.post(f"{API}/kit-categories", json={"label": f"{TAG} Street Light"}, timeout=60).status_code == 409
        r = admin.put(f"{API}/kit-categories/{cat['id']}", json={"label": f"{TAG} Street Lights"}, timeout=60)
        assert r.status_code == 200 and r.json()["label"] == f"{TAG} Street Lights"
        # kit under it → retire blocked → deactivate kit → retire ok → create under retired blocked
        k = admin.post(f"{API}/material-kits", json={"name": f"{TAG} SL kit", "category": cat["slug"], "lines": [{"name": "Pole", "quantity": 1}]}, timeout=60)
        assert k.status_code == 200, k.text
        assert admin.put(f"{API}/kit-categories/{cat['id']}", json={"active": False}, timeout=60).status_code == 409
        admin.put(f"{API}/material-kits/{k.json()['id']}", json={"active": False}, timeout=60)
        assert admin.put(f"{API}/kit-categories/{cat['id']}", json={"active": False}, timeout=60).status_code == 200
        assert admin.post(f"{API}/material-kits", json={"name": f"{TAG} SL kit 2", "category": cat["slug"], "lines": []}, timeout=60).status_code == 400
        assert cat["slug"] not in {c["slug"] for c in admin.get(f"{API}/kit-categories", timeout=60).json()}
        assert cat["slug"] in {c["slug"] for c in admin.get(f"{API}/kit-categories", params={"include_retired": "true"}, timeout=60).json()}

    def test_builtin_cannot_be_retired(self, admin):
        on = next(c for c in admin.get(f"{API}/kit-categories", timeout=60).json() if c["slug"] == "on-grid")
        assert admin.put(f"{API}/kit-categories/{on['id']}", json={"active": False}, timeout=60).status_code == 400

    def test_solar_camera_kit_is_standalone(self, admin):
        r = admin.post(f"{API}/material-kits", json={
            "name": f"{TAG} Solar Camera · 4 cam", "category": "solar-camera",
            "lines": [{"name": "4MP bullet camera", "category": "camera", "quantity": 4}, {"name": "8ch NVR", "quantity": 1},
                      {"name": "100W panel", "category": "panels", "quantity": 1}, {"name": "12V 100Ah battery", "category": "battery", "quantity": 1}]}, timeout=60)
        assert r.status_code == 200, r.text
        kit = admin.get(f"{API}/material-kits/{r.json()['id']}", timeout=60).json()
        assert kit["category"] == "solar-camera" and kit["system_type"] is None and len(kit["lines"]) == 4
        # listed under its category, absent from every system-type match
        assert kit["id"] in {k["id"] for k in admin.get(f"{API}/material-kits", params={"category": "solar-camera"}, timeout=60).json()}
        for st in ("on-grid", "off-grid", "hybrid", "solar-pump"):
            assert kit["id"] not in {k["id"] for k in admin.get(f"{API}/material-kits", params={"system_type": st}, timeout=60).json()}
            m = admin.get(f"{API}/material-kits/match", params={"system_type": st, "capacity_kw": 3}, timeout=60).json()
            assert kit["id"] not in {c["id"] for c in m["candidates"]}
        assert admin.post(f"{API}/material-kits", json={"name": f"{TAG} bad", "category": "does-not-exist"}, timeout=60).status_code == 400

    def test_legacy_kit_payload_still_works(self, admin):
        r = admin.post(f"{API}/material-kits", json={"name": f"{TAG} legacy", "system_type": "hybrid", "capacity_kw": 5, "lines": []}, timeout=60)
        assert r.status_code == 200, r.text
        kit = admin.get(f"{API}/material-kits/{r.json()['id']}", timeout=60).json()
        assert kit["category"] == "hybrid" and kit["system_type"] == "hybrid"
        # all pre-existing kits carry a category
        assert all(k.get("category") for k in admin.get(f"{API}/material-kits", timeout=60).json())


# ───────────────────────── 3. Brand return delete ─────────────────────────
class TestBrandReturnDelete:
    def _mk(self, s, name):
        r = s.post(f"{API}/returns", json={"project_id": "", "supplier_name": f"{TAG} Supplier", "item_name": name, "quantity": 2, "reason": "damage", "notes": ""}, timeout=60)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_admin_direct_delete_keeps_snapshot(self, admin):
        rid = self._mk(admin, f"{TAG} admin-del")
        assert admin.delete(f"{API}/returns/{rid}", json={"reason": "x"}, timeout=60).status_code == 422  # reason too short
        r = admin.delete(f"{API}/returns/{rid}", json={"reason": "entered twice by mistake"}, timeout=60)
        assert r.status_code == 200 and r.json()["status"] == "deleted"
        assert rid not in {x["id"] for x in admin.get(f"{API}/returns", timeout=60).json()}
        log = _db().audit_logs.find_one({"action_type": "brand_return_deleted", "entity_id": rid})
        snap = json.loads(log["old_data"])
        assert snap["item_name"] == f"{TAG} admin-del" and snap["quantity"] == 2 and snap["supplier_name"] == f"{TAG} Supplier"
        assert "entered twice" in (log.get("details") or "")

    def test_staff_delete_requires_approval_then_deletes(self, admin, staff):
        rid = self._mk(admin, f"{TAG} staff-del")
        r = staff.delete(f"{API}/returns/{rid}", json={"reason": "wrong item logged"}, timeout=60)
        assert r.status_code == 200 and r.json()["status"] == "pending_approval"
        # still present, flagged
        row = next(x for x in admin.get(f"{API}/returns", timeout=60).json() if x["id"] == rid)
        assert row["delete_pending"] is True
        # duplicate request is idempotent
        assert staff.delete(f"{API}/returns/{rid}", json={"reason": "again"}, timeout=60).json()["status"] == "pending_approval"
        # shows in unified inbox
        inbox = admin.get(f"{API}/approvals/inbox", params={"source": "action_request"}, timeout=60).json()
        item = next(i for i in inbox["items"] if i["entity_id"] == rid)
        assert item["kind"] == "brand_return_delete" and item["requested_by_name"].startswith(TAG)
        assert staff.post(f"{API}/approvals/inbox/action_request/{item['id']}/approve", timeout=60).status_code == 403
        assert admin.post(f"{API}/approvals/inbox/action_request/{item['id']}/approve", timeout=60).status_code == 200
        assert rid not in {x["id"] for x in admin.get(f"{API}/returns", timeout=60).json()}
        log = _db().audit_logs.find_one({"action_type": "brand_return_deleted", "entity_id": rid})
        assert json.loads(log["old_data"])["item_name"] == f"{TAG} staff-del" and "Approved deletion" in log["details"]
        hist = admin.get(f"{API}/approvals/inbox/history", timeout=60).json()
        assert any(h["source"] == "action_request" and h["id"] == item["id"] and h["status"] == "approved" for h in hist)

    def test_staff_request_rejected_keeps_record(self, admin, staff):
        rid = self._mk(admin, f"{TAG} staff-rej")
        staff.delete(f"{API}/returns/{rid}", json={"reason": "please remove"}, timeout=60)
        inbox = admin.get(f"{API}/approvals/inbox", params={"source": "action_request"}, timeout=60).json()
        item = next(i for i in inbox["items"] if i["entity_id"] == rid)
        r = admin.post(f"{API}/approvals/inbox/action_request/{item['id']}/reject", json={"reason": "return is valid"}, timeout=60)
        assert r.status_code == 200
        row = next(x for x in admin.get(f"{API}/returns", timeout=60).json() if x["id"] == rid)
        assert row["delete_pending"] is False
        assert _db().action_requests.find_one({"_id": __import__("bson").ObjectId(item["id"])})["rejection_reason"] == "return is valid"

    def test_blocked_when_downstream_entry_exists(self, admin):
        rid = self._mk(admin, f"{TAG} blocked")
        _db().account_entries.insert_one({"entry_type": "supplier_credit_note", "reference_id": rid, "amount": 1500, "description": f"{TAG} credit note CN-9"})
        r = admin.delete(f"{API}/returns/{rid}", json={"reason": "cleanup"}, timeout=60)
        assert r.status_code == 409 and "credit note CN-9" in r.json()["detail"]
        assert rid in {x["id"] for x in admin.get(f"{API}/returns", timeout=60).json()}


# ───────────────────────── 4. Manual PO number ─────────────────────────
class TestManualPoNumber:
    def _po(self, s, supplier, number=None):
        body = {"supplier_name": supplier, "items": [{"name": "Cable", "qty": 1, "unit_price": 100}]}
        if number is not None:
            body["po_number"] = number
        return s.post(f"{API}/purchase-orders", json=body, timeout=60)

    def test_auto_default_and_preview(self, admin):
        nxt = admin.get(f"{API}/purchase-orders/next-number", timeout=60).json()["po_number"]
        assert nxt.startswith("PO-")
        r = self._po(admin, f"{TAG} AutoVendor")
        assert r.status_code == 200 and r.json()["po_number"] == nxt
        r2 = self._po(admin, f"{TAG} AutoVendor", "   ")
        assert r2.status_code == 200 and r2.json()["po_number"].startswith("PO-") and r2.json()["po_number"] != nxt

    def test_manual_unique_per_vendor(self, admin):
        r = self._po(admin, f"{TAG} VendorA", f"{TAG}-VA-001")
        assert r.status_code == 200 and r.json()["po_number"] == f"{TAG}-VA-001"
        dup = self._po(admin, f"{TAG} VendorA", f"{TAG}-va-001")   # case-insensitive clash
        assert dup.status_code == 409 and "already exists" in dup.json()["detail"] and f"{TAG} VendorA" in dup.json()["detail"]
        dup2 = self._po(admin, f"{TAG} vendora", f"{TAG}-VA-001")  # same vendor, different case
        assert dup2.status_code == 409
        other = self._po(admin, f"{TAG} VendorB", f"{TAG}-VA-001")  # different vendor may reuse the number
        assert other.status_code == 200
        assert _db().purchase_orders.count_documents({"po_number": f"{TAG}-VA-001"}) == 2
        assert self._po(admin, f"{TAG} VendorA", "X" * 41).status_code == 400
        doc = _db().purchase_orders.find_one({"supplier_name": f"{TAG} VendorA"})
        assert doc["po_number_manual"] is True
