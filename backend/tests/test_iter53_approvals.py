"""Iter 53 — Approvals: every entry point, full approve AND reject cycle through the unified inbox.

Entry points (source key → underlying flow):
  approval            generic engine (/approvals) — manager-requested hard deletes of sale / PO / delivery, inventory deletion…
  project_submission  project submit → approve / reject
  deletion_request    project deletion request → approve (soft delete) / reject (status restored)
  inbound_action      manager reverses a completed inbound → admin approve (stock pulled back) / reject (stock untouched)
  purchase_order      pending PO → approve / reject
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST53A_{uuid.uuid4().hex[:5]}"
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")
MGR_EMAIL, MGR_PW = f"{TAG.lower()}_mgr@test.com", "Manager@12345"


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=60)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@sensoper.com", ADMIN_PW)


@pytest.fixture(scope="module")
def manager(admin):
    r = admin.post(f"{API}/users", json={"email": MGR_EMAIL, "password": MGR_PW, "name": f"{TAG} Manager", "role": "manager"}, timeout=60)
    assert r.status_code in (200, 201), r.text
    uid = r.json()["id"]
    yield _login(MGR_EMAIL, MGR_PW)
    admin.delete(f"{API}/users/{uid}", timeout=60)


def _project_payload(name):
    return {"customer": {"name": name, "phone": "9000000053", "email": "i53@test.com", "address": "1 Test Lane"},
            "location": {"address": "1 Test Lane", "city": "Chennai", "state": "Tamil Nadu", "pincode": "600001"},
            "electrical": {"sanction_load_kw": 3, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 7},
            "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "fixed"}, "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10},
            "solar_system": {"system_type": "on-grid", "capacity_kw": 3}, "selected_items": [], "manual_costs": []}


def _inbox(sess, source=None):
    r = sess.get(f"{API}/approvals/inbox", params={"source": source} if source else {}, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


def _find(items, source, item_id):
    return next((i for i in items if i["source"] == source and i["id"] == item_id), None)


@pytest.fixture(scope="module")
def inv_item(admin):
    r = admin.post(f"{API}/inventory/items", json={"name": f"{TAG} MC4 pair", "sku_code": f"{TAG}-MC4", "category": "bos", "quantity": 10, "unit_price": 100, "gst_percentage": 18, "margin_pct": 10}, timeout=60)
    assert r.status_code in (200, 201), r.text
    yield r.json()["id"]
    admin.delete(f"{API}/inventory/items/{r.json()['id']}", timeout=60)


class TestInboxShape:
    def test_staff_and_anon_blocked(self, admin):
        assert requests.get(f"{API}/approvals/inbox", timeout=60).status_code in (401, 403)
        d = _inbox(admin)
        assert {"items", "counts", "total"} <= set(d) and d["total"] == len(d["items"])
        for i in d["items"]:
            assert i["source"] in ("approval", "project_submission", "deletion_request", "inbound_action", "purchase_order")

    def test_badge_count_matches_inbox(self, admin):
        d = _inbox(admin)
        c = admin.get(f"{API}/approvals/inbox/count", timeout=60).json()["count"]
        assert c == d["total"]
        stats = admin.get(f"{API}/dashboard/stats", timeout=60).json()
        assert stats["pending_approvals"] >= d["total"] - 0  # admin sees everything; stats uses the same unified count


class TestProjectSubmission:
    def _make(self, manager, admin):
        pid = manager.post(f"{API}/projects", json=_project_payload(f"{TAG} Submit"), timeout=60).json()["id"]
        assert manager.post(f"{API}/projects/{pid}/submit", timeout=60).status_code == 200
        item = _find(_inbox(admin)["items"], "project_submission", pid)
        assert item and item["kind"] == "project_review", "submitted project must appear in the approver inbox"
        return pid

    def test_approve(self, manager, admin):
        pid = self._make(manager, admin)
        r = admin.post(f"{API}/approvals/inbox/project_submission/{pid}/approve", json={}, timeout=60)
        assert r.status_code == 200, r.text
        assert admin.get(f"{API}/projects/{pid}", timeout=60).json()["status"] == "approved"
        assert _find(_inbox(admin)["items"], "project_submission", pid) is None
        admin.delete(f"{API}/projects/{pid}", timeout=60)

    def test_reject(self, manager, admin):
        pid = self._make(manager, admin)
        r = admin.post(f"{API}/approvals/inbox/project_submission/{pid}/reject", json={"reason": "Pricing incomplete"}, timeout=60)
        assert r.status_code == 200, r.text
        p = admin.get(f"{API}/projects/{pid}", timeout=60).json()
        assert p["status"] == "rejected" and p.get("rejection_reason") == "Pricing incomplete"
        assert _find(_inbox(admin)["items"], "project_submission", pid) is None
        admin.delete(f"{API}/projects/{pid}", timeout=60)


class TestProjectDeletionRequest:
    def _make(self, manager, admin):
        pid = manager.post(f"{API}/projects", json=_project_payload(f"{TAG} Del"), timeout=60).json()["id"]
        r = manager.post(f"{API}/projects/{pid}/request-deletion", json={"reason": "duplicate"}, timeout=60)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        assert _find(_inbox(admin)["items"], "deletion_request", rid), "deletion request must appear in the inbox"
        return pid, rid

    def test_approve_soft_deletes(self, manager, admin):
        pid, rid = self._make(manager, admin)
        assert admin.post(f"{API}/approvals/inbox/deletion_request/{rid}/approve", json={}, timeout=60).status_code == 200
        assert admin.get(f"{API}/projects/{pid}", timeout=60).status_code == 404
        assert _find(_inbox(admin)["items"], "deletion_request", rid) is None

    def test_reject_restores(self, manager, admin):
        pid, rid = self._make(manager, admin)
        assert admin.post(f"{API}/approvals/inbox/deletion_request/{rid}/reject", json={"reason": "keep it"}, timeout=60).status_code == 200
        p = admin.get(f"{API}/projects/{pid}", timeout=60)
        assert p.status_code == 200 and p.json()["status"] != "deletion_requested"
        admin.delete(f"{API}/projects/{pid}", timeout=60)


class TestPurchaseOrder:
    def _make(self, admin, inv_item):
        r = admin.post(f"{API}/purchase-orders", json={"supplier_name": f"{TAG} Supplier", "items": [{"name": f"{TAG} MC4 pair", "qty": 5, "unit_price": 100, "inventory_item_id": inv_item}]}, timeout=60)
        assert r.status_code in (200, 201), r.text
        po_id = r.json().get("id") or r.json().get("po_id")
        assert _find(_inbox(admin)["items"], "purchase_order", po_id), "pending PO must appear in the inbox"
        return po_id

    def test_approve(self, admin, inv_item):
        po = self._make(admin, inv_item)
        assert admin.post(f"{API}/approvals/inbox/purchase_order/{po}/approve", json={}, timeout=60).status_code == 200
        assert next(p for p in admin.get(f"{API}/purchase-orders", params={"status": "all"}, timeout=60).json() if p["id"] == po)["status"] == "approved"
        assert admin.post(f"{API}/approvals/inbox/purchase_order/{po}/approve", json={}, timeout=60).status_code == 400, "double approve refused"
        admin.delete(f"{API}/hard-delete/purchase-order/{po}", json={"reason": "cleanup"}, timeout=60)

    def test_reject(self, admin, inv_item):
        po = self._make(admin, inv_item)
        assert admin.post(f"{API}/approvals/inbox/purchase_order/{po}/reject", json={"reason": "too expensive"}, timeout=60).status_code == 200
        row = next(p for p in admin.get(f"{API}/purchase-orders", params={"status": "all"}, timeout=60).json() if p["id"] == po)
        assert row["status"] == "rejected"
        assert _find(_inbox(admin)["items"], "purchase_order", po) is None


class TestInboundReversal:
    def _completed_po(self, admin, inv_item):
        po = admin.post(f"{API}/purchase-orders", json={"supplier_name": f"{TAG} Rev", "items": [{"name": "x", "qty": 3, "unit_price": 50, "inventory_item_id": inv_item}]}, timeout=60).json()
        po_id = po.get("id") or po.get("po_id")
        assert admin.put(f"{API}/purchase-orders/{po_id}/approve", timeout=60).status_code == 200
        admin.put(f"{API}/purchase-orders/{po_id}/arrival", json={}, timeout=60)
        admin.put(f"{API}/purchase-orders/{po_id}/qc", json={}, timeout=60)
        r = admin.put(f"{API}/purchase-orders/{po_id}/inbound", json={"storage_location": {"zone": "A", "bin": "B1"}}, timeout=60)
        assert r.status_code == 200, r.text
        return po_id

    def _qty(self, admin, inv_item):
        return admin.get(f"{API}/inventory/items/{inv_item}", timeout=60).json()["quantity"]

    def test_manager_reversal_needs_admin_approval_then_executes(self, admin, manager, inv_item):
        po = self._completed_po(admin, inv_item)
        before = self._qty(admin, inv_item)
        r = manager.delete(f"{API}/purchase-orders/{po}/inbound", timeout=60)
        assert r.status_code == 200 and r.json()["status"] == "pending_approval", r.text
        assert self._qty(admin, inv_item) == before, "stock untouched while pending"
        item = next(i for i in _inbox(admin)["items"] if i["source"] == "inbound_action" and i["entity_id"] == po)
        assert admin.post(f"{API}/approvals/inbox/inbound_action/{item['id']}/approve", json={}, timeout=60).status_code == 200
        assert self._qty(admin, inv_item) == before - 3, "approved reversal pulls the received qty back"

    def test_manager_reversal_rejected_leaves_stock(self, admin, manager, inv_item):
        po = self._completed_po(admin, inv_item)
        before = self._qty(admin, inv_item)
        manager.delete(f"{API}/purchase-orders/{po}/inbound", timeout=60)
        item = next(i for i in _inbox(admin)["items"] if i["source"] == "inbound_action" and i["entity_id"] == po)
        assert admin.post(f"{API}/approvals/inbox/inbound_action/{item['id']}/reject", json={"reason": "no"}, timeout=60).status_code == 200
        assert self._qty(admin, inv_item) == before
        assert next(p for p in admin.get(f"{API}/purchase-orders", params={"status": "all"}, timeout=60).json() if p["id"] == po)["status"] == "completed"


class TestGenericEngineDeletions:
    """Manager requests a hard delete of a sale / PO via /approvals; admin approves → the real hard-delete runs."""

    def _po(self, admin, inv_item):
        po = admin.post(f"{API}/purchase-orders", json={"supplier_name": f"{TAG} GenDel", "items": [{"name": "x", "qty": 1, "unit_price": 10, "inventory_item_id": inv_item}]}, timeout=60).json()
        return po.get("id") or po.get("po_id")

    def test_po_delete_request_approve_executes(self, admin, manager, inv_item):
        po = self._po(admin, inv_item)
        r = manager.post(f"{API}/approvals", json={"type": "deletion", "entity_type": "purchase_order", "entity_id": po, "description": "Raised twice by mistake"}, timeout=60)
        assert r.status_code == 200, r.text
        aid = r.json()["id"]
        assert manager.post(f"{API}/approvals/inbox/approval/{aid}/approve", json={}, timeout=60).status_code == 403, "deletion approvals are admin-only"
        r = admin.post(f"{API}/approvals/inbox/approval/{aid}/approve", json={}, timeout=60)
        assert r.status_code == 200, r.text
        assert all(p["id"] != po for p in admin.get(f"{API}/purchase-orders", params={"status": "all"}, timeout=60).json()), "PO hard-deleted on approval"
        a = next(x for x in admin.get(f"{API}/approvals", params={"status": "approved"}, timeout=60).json() if x["id"] == aid)
        assert not str(a.get("execution_result", "")).startswith("Error")

    def test_po_delete_request_reject_keeps_it(self, admin, manager, inv_item):
        po = self._po(admin, inv_item)
        aid = manager.post(f"{API}/approvals", json={"type": "deletion", "entity_type": "purchase_order", "entity_id": po, "description": "oops"}, timeout=60).json()["id"]
        assert admin.post(f"{API}/approvals/inbox/approval/{aid}/reject", json={"reason": "valid PO"}, timeout=60).status_code == 200
        assert any(p["id"] == po for p in admin.get(f"{API}/purchase-orders", params={"status": "all"}, timeout=60).json())
        admin.delete(f"{API}/hard-delete/purchase-order/{po}", json={"reason": "cleanup"}, timeout=60)

    def test_failed_execution_does_not_mark_approved(self, admin, manager):
        aid = manager.post(f"{API}/approvals", json={"type": "deletion", "entity_type": "purchase_order", "entity_id": "000000000000000000000000", "description": "ghost"}, timeout=60).json()["id"]
        r = admin.post(f"{API}/approvals/inbox/approval/{aid}/approve", json={}, timeout=60)
        assert r.status_code == 409, r.text
        a = next(x for x in admin.get(f"{API}/approvals", params={"status": "pending"}, timeout=60).json() if x["id"] == aid)
        assert a["status"] == "pending", "a failed action must leave the approval pending, not silently 'approved'"
        admin.post(f"{API}/approvals/inbox/approval/{aid}/reject", json={"reason": "cleanup"}, timeout=60)
