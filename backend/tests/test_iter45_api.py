"""Iter 42 revision (8 changes) API tests — inventory import preview/dry-run,
purchase inbound edit/reverse, material reconciliation, assets, AMC, locations."""
import io
import os
import re
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"
TAG = uuid.uuid4().hex[:6].upper()


# ── fixtures ──
@pytest.fixture(scope="session")
def creds():
    content = Path("/app/memory/test_credentials.md").read_text()
    email = re.search(r'(?im)^\s*[-*]?\s*(?:\*\*)?email(?:\*\*)?\s*:\s*`?([^`\s]+)', content)
    pwd = re.search(r'(?im)^\s*[-*]?\s*(?:\*\*)?password(?:\*\*)?\s*:\s*`?([^`\s]+)', content)
    if not email or not pwd:
        pytest.skip("credentials missing")
    return {"email": email.group(1), "password": pwd.group(1)}


@pytest.fixture(scope="session")
def client(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    # cookie-based session auth: verify the session actually works
    me = s.get(f"{API}/auth/me", timeout=60)
    if me.status_code != 200:
        pytest.fail(f"session not authenticated after login: {me.status_code} {me.text[:200]}")
    return s


def _xlsx(rows, headers):
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return buf.getvalue()


# ── CHANGE 1: inventory import ──
class TestInventoryImport:
    def test_preview_with_aliased_headers(self, client):
        sku = f"TEST_SKU_{TAG}_1"
        data = _xlsx([[f"TEST_Panel_{TAG}", sku, "panel", "12", "\u20b91,250.00"]],
                     ["Item Name", "SKU Code", "Category", "Qty", "Rate"])
        r = client.post(f"{API}/inventory/import/preview",
                        files={"file": ("aliased.xlsx", data,
                               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert j["status"] == "ready", j
        assert j["column_mapping"]["name"] == "Item Name"
        assert j["column_mapping"]["unit_price"] == "Rate"
        assert j["summary"]["will_create"] + j["summary"]["will_update"] == 1
        assert j["preview_rows"][0]["unit_price"] == 1250.0
        assert j["preview_rows"][0]["quantity"] == 12

    def test_preview_missing_required_returns_needs_mapping(self, client):
        data = _xlsx([[f"TEST_X_{TAG}", "5", "10"]], ["Widget Label", "Count", "Amount"])
        r = client.post(f"{API}/inventory/import/preview",
                        files={"file": ("nomap.xlsx", data, "application/octet-stream")}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert j["status"] == "needs_mapping", j
        assert "detected_columns" in j and j["unmapped_required"]

    def test_preview_duplicate_sku_flagged(self, client):
        sku = f"TEST_DUP_{TAG}"
        data = _xlsx([[f"TEST_A_{TAG}", sku, "panel", 1, 100], [f"TEST_B_{TAG}", sku, "panel", 2, 200]],
                     ["name", "sku_code", "category", "quantity", "unit_price"])
        r = client.post(f"{API}/inventory/import/preview",
                        files={"file": ("dup.xlsx", data, "application/octet-stream")}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert j["summary"]["will_skip"] == 1
        assert "Duplicate SKU" in j["errors"][0]["error"]

    def test_dry_run_does_not_write(self, client):
        sku = f"TEST_DRY_{TAG}"
        data = _xlsx([[f"TEST_Dry_{TAG}", sku, "panel", 7, 500]],
                     ["name", "sku_code", "category", "quantity", "unit_price"])
        r = client.post(f"{API}/inventory/import",
                        files={"file": ("dry.xlsx", data, "application/octet-stream")},
                        data={"dry_run": "true"}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert j["dry_run"] is True
        assert j["created"] == 1
        # verify nothing persisted
        items = client.get(f"{API}/inventory/items", timeout=120).json()
        rows = items if isinstance(items, list) else items.get("items", [])
        assert not any(i.get("sku_code") == sku for i in rows), "dry run wrote to DB"

    def test_real_import_then_update_quantity(self, client):
        sku = f"TEST_IMP_{TAG}"
        data = _xlsx([[f"TEST_Imported_{TAG}", sku, "panel", 5, 999]],
                     ["name", "sku_code", "category", "quantity", "unit_price"])
        r = client.post(f"{API}/inventory/import",
                        files={"file": ("imp.xlsx", data, "application/octet-stream")}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        assert r.json()["created"] == 1
        items = client.get(f"{API}/inventory/items", timeout=120).json()
        rows = items if isinstance(items, list) else items.get("items", [])
        found = [i for i in rows if i.get("sku_code") == sku]
        assert found, "imported item not returned by GET /inventory"
        assert found[0]["quantity"] == 5
        # re-import with different qty -> update path
        data2 = _xlsx([[f"TEST_Imported_{TAG}", sku, "panel", 9, 999]],
                      ["name", "sku_code", "category", "quantity", "unit_price"])
        r2 = client.post(f"{API}/inventory/import",
                         files={"file": ("imp2.xlsx", data2, "application/octet-stream")}, timeout=120)
        assert r2.status_code == 200 and r2.json()["updated"] == 1, r2.text[:300]
        rows = client.get(f"{API}/inventory/items", timeout=120).json()
        rows = rows if isinstance(rows, list) else rows.get("items", [])
        assert [i for i in rows if i.get("sku_code") == sku][0]["quantity"] == 9


# ── CHANGE 2: purchase inbound ──
class TestPurchaseInbound:
    @pytest.fixture(scope="class")
    def inv_item(self, client):
        payload = {"name": f"TEST_INB_ITEM_{TAG}", "sku_code": f"TEST_INBSKU_{TAG}", "category": "panel",
                   "quantity": 0, "unit_price": 100, "reorder_level": 5, "supplier": "TEST"}
        r = client.post(f"{API}/inventory/items", json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text[:300]
        item_id = r.json().get("id") or r.json().get("item", {}).get("id")
        assert item_id
        return item_id

    def _qty(self, client, item_id):
        r = client.get(f"{API}/inventory/items/{item_id}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        return r.json()["quantity"]

    def test_full_inbound_flow_and_idempotency_and_edit_and_reverse(self, client, inv_item):
        start = self._qty(client, inv_item)
        po = client.post(f"{API}/purchase-orders", json={
            "supplier_name": f"TEST_Supplier_{TAG}", "supplier_contact": "9999999999",
            "items": [{"name": f"TEST_INB_ITEM_{TAG}", "qty": 10, "unit_price": 100,
                       "inventory_item_id": inv_item, "sku_code": f"TEST_INBSKU_{TAG}"}],
            "expected_delivery": "2026-08-01", "notes": "TEST"}, timeout=60)
        assert po.status_code in (200, 201), po.text[:300]
        po_id = po.json()["id"]

        assert client.put(f"{API}/purchase-orders/{po_id}/approve", timeout=60).status_code == 200
        assert client.put(f"{API}/purchase-orders/{po_id}/arrival",
                          json={"transporter": "TEST", "vehicle": "TN01"}, timeout=60).status_code == 200
        assert client.put(f"{API}/purchase-orders/{po_id}/qc",
                          json={"overall": "pass"}, timeout=60).status_code == 200

        r = client.put(f"{API}/purchase-orders/{po_id}/inbound", json={"storage_location": "A1"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert self._qty(client, inv_item) == start + 10

        # idempotency: second complete must be blocked, stock unchanged
        r2 = client.put(f"{API}/purchase-orders/{po_id}/inbound", json={"storage_location": "A1"}, timeout=60)
        assert r2.status_code == 400, f"expected block, got {r2.status_code}"
        assert "already been received" in r2.text
        assert self._qty(client, inv_item) == start + 10

        # edit: 10 -> 14, only delta +4 applied
        e = client.put(f"{API}/purchase-orders/{po_id}/inbound/edit", json={
            "lines": [{"inventory_item_id": inv_item, "qty_received": 14}]
        }, timeout=60)
        assert e.status_code == 200, e.text[:400]
        assert self._qty(client, inv_item) == start + 14

        # reverse as admin: stock back to start, PO reopens for QC
        rev = client.delete(f"{API}/purchase-orders/{po_id}/inbound", timeout=60)
        assert rev.status_code == 200, rev.text[:400]
        assert rev.json().get("status") != "pending_approval"
        assert self._qty(client, inv_item) == start
        pos = client.get(f"{API}/purchase-orders", timeout=60).json()
        this_po = [p for p in pos if p["id"] == po_id][0]
        assert this_po["status"] == "qc_done", this_po["status"]

    def test_inbound_approval_queue_empty_for_admin(self, client):
        r = client.get(f"{API}/purchase-orders/inbound-approvals", timeout=60)
        assert r.status_code in (200, 404), r.text[:300]
        if r.status_code == 200:
            body = r.json()
            items = body if isinstance(body, list) else body.get("requests", body.get("items", []))
            assert isinstance(items, list)


# ── CHANGE 4: material reconciliation ──
class TestReconciliation:
    @pytest.fixture(scope="class")
    def completed_project(self, client):
        r = client.get(f"{API}/projects", params={"status": "completed"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        projects = r.json()
        projects = projects if isinstance(projects, list) else projects.get("projects", [])
        if not projects:
            pytest.skip("no completed project available")
        return projects[0]["id"]

    def test_get_draft(self, client, completed_project):
        r = client.get(f"{API}/material-reconciliation/{completed_project}", timeout=60)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert "lines" in j and "status" in j

    def test_submit_and_verify_and_report(self, client, completed_project):
        draft = client.get(f"{API}/material-reconciliation/{completed_project}", timeout=60).json()
        lines = draft.get("lines") or []
        if not lines:
            lines = [{"name": f"TEST_Mat_{TAG}", "qty_quoted": 10, "qty_issued": 10, "unit_cost": 100}]
        line = {**lines[0]}
        line.pop("variance", None); line.pop("variance_value", None)
        line["qty_issued"] = 10
        line["qty_consumed"] = 6
        line["qty_returned"] = 0
        line["qty_damaged"] = 1
        line["qty_at_site"] = 3
        line["unit_cost"] = line.get("unit_cost") or 100
        r = client.put(f"{API}/material-reconciliation/{completed_project}",
                       json={"lines": [line], "status": "submitted"}, timeout=60)
        assert r.status_code == 200, r.text[:400]
        got = client.get(f"{API}/material-reconciliation/{completed_project}", timeout=60).json()
        assert got["status"] == "submitted"
        assert got["lines"][0]["variance"] == 3, got["lines"][0]

        rv = client.put(f"{API}/material-reconciliation/{completed_project}",
                        json={"lines": [line], "status": "verified"}, timeout=60)
        assert rv.status_code == 200, rv.text[:300]
        got2 = client.get(f"{API}/material-reconciliation/{completed_project}", timeout=60).json()
        assert got2["status"] == "verified"

        rep = client.get(f"{API}/material-reconciliation-report", timeout=60)
        assert rep.status_code == 200, rep.text[:400]
        j = rep.json()
        assert j["total_reconciliations"] >= 1
        assert isinstance(j["by_item"], list) and j["by_item"]
        assert j["recoverable_value"] > 0

    def test_alerts(self, client):
        r = client.get(f"{API}/material-reconciliation-alerts", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert "count" in r.json()

    def test_excess_material_report_tile_endpoint(self, client):
        r = client.get(f"{API}/reports/excess_material", timeout=90)
        assert r.status_code in (200, 404), r.text[:300]
        if r.status_code == 404:
            pytest.fail("reports/excess_material endpoint missing (frontend tile expects it)")


# ── CHANGE 6: assets ──
class TestAssets:
    created = []

    @pytest.fixture(scope="class")
    def asset_id(self, client):
        payload = {"name": f"TEST_Meter_{TAG}", "category": "test_equipment", "make": "Fluke",
                   "model": "T5", "serial_number": f"SN{TAG}", "purchase_date": "2024-01-15",
                   "purchase_cost": 50000, "useful_life_years": 5, "requires_calibration": True,
                   "calibration_interval_days": 365, "last_calibration_date": "2025-09-01"}
        r = client.post(f"{API}/assets", json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        j = r.json()
        assert j["asset_code"].startswith("AST-"), j
        assert j["status"] == "available"
        assert j["next_calibration_date"] == "2026-09-01", j.get("next_calibration_date")
        assert j["current_book_value"] < 50000
        assert "_id" not in j
        TestAssets.created.append(j["id"])
        return j["id"]

    def test_list_and_detail(self, client, asset_id):
        r = client.get(f"{API}/assets", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert any(a["id"] == asset_id for a in r.json())
        d = client.get(f"{API}/assets/{asset_id}", timeout=60)
        assert d.status_code == 200, d.text[:300]
        j = d.json()
        assert "movements" in j and "maintenance" in j and "_id" not in j

    def test_issue_double_issue_and_return(self, client, asset_id):
        r = client.post(f"{API}/assets/{asset_id}/issue",
                        json={"assigned_to": "u1", "assigned_to_name": "TEST_Tech", "condition_out": "good"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert client.get(f"{API}/assets/{asset_id}", timeout=60).json()["status"] == "issued"
        r2 = client.post(f"{API}/assets/{asset_id}/issue",
                         json={"assigned_to": "u2", "assigned_to_name": "TEST_Tech2"}, timeout=60)
        assert r2.status_code == 400, f"double issue should be blocked, got {r2.status_code}"
        rr = client.post(f"{API}/assets/{asset_id}/return", json={"condition_in": "good"}, timeout=60)
        assert rr.status_code == 200, rr.text[:300]
        det = client.get(f"{API}/assets/{asset_id}", timeout=60).json()
        assert det["status"] == "available" and det["assigned_to_name"] is None
        assert len(det["movements"]) >= 2

    def test_maintenance_log(self, client, asset_id):
        r = client.post(f"{API}/assets/{asset_id}/maintenance", json={
            "type": "calibration", "date": "2026-07-01", "vendor": "TEST_Cal", "cost": 1500,
            "downtime_days": 1, "is_calibration": True}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        det = client.get(f"{API}/assets/{asset_id}", timeout=60).json()
        assert det["last_calibration_date"] == "2026-07-01"
        assert det["next_calibration_date"] == "2027-07-01", det.get("next_calibration_date")
        assert any(m["cost"] == 1500 for m in det["maintenance"])

    def test_compliance(self, client, asset_id):
        r = client.get(f"{API}/assets/compliance", params={"days": 3650}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["count"] >= 1 and isinstance(j["items"], list)

    @pytest.mark.parametrize("rtype", ["register", "issue_log", "maintenance", "compliance",
                                        "utilisation", "depreciation", "writeoff"])
    def test_seven_reports(self, client, asset_id, rtype):
        r = client.get(f"{API}/assets/reports/{rtype}", timeout=120)
        assert r.status_code == 200, f"{rtype}: {r.status_code} {r.text[:300]}"
        j = r.json()
        assert "title" in j and "summary" in j and isinstance(j["rows"], list)

    def test_update_and_delete(self, client, asset_id):
        u = client.put(f"{API}/assets/{asset_id}", json={"storage_location": "Rack 3"}, timeout=60)
        assert u.status_code == 200, u.text[:300]
        assert client.get(f"{API}/assets/{asset_id}", timeout=60).json()["storage_location"] == "Rack 3"
        d = client.delete(f"{API}/assets/{asset_id}", timeout=60)
        assert d.status_code == 200, d.text[:300]
        assert not any(a["id"] == asset_id for a in client.get(f"{API}/assets", timeout=60).json())


# ── CHANGE 5: AMC ──
class TestAMC:
    @pytest.fixture(scope="class")
    def contract(self, client):
        payload = {"customer_name": f"TEST_AMC_Cust_{TAG}", "system_type": "on-grid",
                   "system_capacity_kw": 10, "start_date": "2026-07-01", "duration_months": 12,
                   "annual_value": 24000, "billing_frequency": "quarterly", "visits_per_year": 4,
                   "district": "Coimbatore", "contract_type": "comprehensive"}
        r = client.post(f"{API}/amc/contracts", json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        j = r.json()
        assert j["contract_number"].startswith("AMC-")
        assert j["end_date"] == "2027-07-01", j["end_date"]
        assert j["next_billing_date"] == "2026-10-01", j["next_billing_date"]
        assert j["status"] == "active" and j["visits_remaining"] == 4
        assert "_id" not in j
        return j

    def test_list_and_detail(self, client, contract):
        r = client.get(f"{API}/amc/contracts", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert any(c["id"] == contract["id"] for c in r.json())
        d = client.get(f"{API}/amc/contracts/{contract['id']}", timeout=60)
        assert d.status_code == 200, d.text[:300]
        assert d.json()["annual_value"] == 24000
        assert "visit_history" in d.json()

    def test_dashboard_real_numbers(self, client, contract):
        r = client.get(f"{API}/amc/dashboard", timeout=60)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        for k in ["arr", "mrr", "active_contracts", "renewal_rate_pct", "expiring_30",
                  "expiring_60", "expiring_90", "pump_hp_total", "penetration_pct", "outstanding"]:
            assert k in j, f"missing {k}"
        assert j["active_contracts"] >= 1
        assert j["arr"] >= 24000
        assert round(j["mrr"] * 12, 0) == round(j["arr"], 0)

    def test_visit_schedule_and_complete(self, client, contract):
        v = client.post(f"{API}/amc/contracts/{contract['id']}/visits",
                        json={"scheduled_date": "2026-08-15", "visit_type": "preventive",
                              "technician_name": "TEST_Tech"}, timeout=60)
        assert v.status_code in (200, 201), v.text[:300]
        vid = v.json()["id"]
        assert "_id" not in v.json()
        c = client.put(f"{API}/amc/visits/{vid}/complete", json={"generation_reading": 1200}, timeout=60)
        assert c.status_code == 200, c.text[:300]
        det = client.get(f"{API}/amc/contracts/{contract['id']}", timeout=60).json()
        assert det["visits_completed"] == 1 and det["visits_remaining"] == 3

    def test_from_completed_project(self, client):
        pr = client.get(f"{API}/projects", params={"status": "completed"}, timeout=60).json()
        pr = pr if isinstance(pr, list) else pr.get("projects", [])
        if not pr:
            pytest.skip("no completed project")
        r = client.post(f"{API}/amc/contracts/from-project/{pr[0]['id']}", timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        j = r.json()
        assert j["project_id"] == pr[0]["id"]
        assert j["contract_number"].startswith("AMC-")
        assert j["status"] == "active" and "_id" not in j
        client.post(f"{API}/amc/contracts/{j['id']}/cancel", json={"reason": "TEST cleanup"}, timeout=60)

    def test_renew_and_cancel(self, client):
        r = client.post(f"{API}/amc/contracts", json={
            "customer_name": f"TEST_AMC_Renew_{TAG}", "system_type": "solar-pump", "pump_hp": 5,
            "start_date": "2025-07-01", "duration_months": 12, "annual_value": 12000}, timeout=60).json()
        rn = client.post(f"{API}/amc/contracts/{r['id']}/renew", timeout=60)
        assert rn.status_code in (200, 201), rn.text[:400]
        new = rn.json()
        assert new["previous_contract_id"] == r["id"]
        assert new["start_date"] == "2026-07-01" and new["end_date"] == "2027-07-01"
        old = client.get(f"{API}/amc/contracts/{r['id']}", timeout=60).json()
        assert old["status"] == "renewed"
        cn = client.post(f"{API}/amc/contracts/{new['id']}/cancel", json={"reason": "TEST"}, timeout=60)
        assert cn.status_code == 200, cn.text[:300]
        assert client.get(f"{API}/amc/contracts/{new['id']}", timeout=60).json()["status"] == "cancelled"

    def test_recurring_revenue_report(self, client, contract):
        r = client.get(f"{API}/amc/recurring-revenue-report", timeout=60)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        assert j["summary"]["arr"] >= 24000
        assert j["summary"]["active_contracts"] >= 1
        assert isinstance(j["rows"], list) and j["rows"]
        assert isinstance(j["by_contract_type"], dict)


# ── CHANGE 8: locations ──
class TestLocations:
    @pytest.fixture(scope="class")
    def loc(self, client):
        r = client.post(f"{API}/locations", json={"name": f"TEST_Loc_{TAG}", "code": f"L{TAG}",
                                                  "type": "head_office", "district": "Chennai",
                                                  "state": "Tamil Nadu"}, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        j = r.json()
        assert "id" in j and "_id" not in j
        return j

    def test_list_contains(self, client, loc):
        r = client.get(f"{API}/locations", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert any(l["id"] == loc["id"] for l in r.json())

    def test_update(self, client, loc):
        u = client.put(f"{API}/locations/{loc['id']}", json={"name": f"TEST_Loc_{TAG}_R", "district": "Salem"}, timeout=60)
        assert u.status_code == 200, u.text[:300]
        got = [l for l in client.get(f"{API}/locations", timeout=60).json() if l["id"] == loc["id"]][0]
        assert got["name"] == f"TEST_Loc_{TAG}_R" and got["district"] == "Salem"

    def test_update_missing_404(self, client):
        r = client.put(f"{API}/locations/507f1f77bcf86cd799439011", json={"name": "x"}, timeout=60)
        assert r.status_code == 404, r.status_code

    def test_user_location_assignment_persists(self, client, loc):
        users = client.get(f"{API}/users", timeout=60).json()
        users = users if isinstance(users, list) else users.get("users", [])
        assert users, "no users returned"
        uid = users[0]["id"]
        r = client.put(f"{API}/users/{uid}/locations",
                       json={"location_ids": [loc["id"]], "default_location_id": loc["id"]}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        again = client.get(f"{API}/users", timeout=60).json()
        again = again if isinstance(again, list) else again.get("users", [])
        target = [u for u in again if u["id"] == uid][0]
        assert target.get("location_ids") == [loc["id"]], f"assignment not persisted/exposed: {target.get('location_ids')}"
        assert target.get("default_location_id") == loc["id"]
        # cleanup assignment so delete works
        client.put(f"{API}/users/{uid}/locations", json={"location_ids": [], "default_location_id": None}, timeout=60)

    def test_delete_blocked_when_in_use_then_delete(self, client, loc):
        users = client.get(f"{API}/users", timeout=60).json()
        users = users if isinstance(users, list) else users.get("users", [])
        uid = users[0]["id"]
        client.put(f"{API}/users/{uid}/locations", json={"location_ids": [loc["id"]]}, timeout=60)
        blocked = client.delete(f"{API}/locations/{loc['id']}", timeout=60)
        assert blocked.status_code == 400, f"expected 400 in-use guard, got {blocked.status_code}"
        client.put(f"{API}/users/{uid}/locations", json={"location_ids": [], "default_location_id": None}, timeout=60)
        d = client.delete(f"{API}/locations/{loc['id']}", timeout=60)
        assert d.status_code == 200, d.text[:300]
        assert not any(l["id"] == loc["id"] for l in client.get(f"{API}/locations", timeout=60).json())


# ── CHANGE 7: branch update ──
class TestBranchEdit:
    def test_create_update_delete_branch(self, client):
        r = client.post(f"{API}/expansion/branches", json={
            "name": f"TEST_Branch_{TAG}", "address": "1 Main St", "district": "Erode",
            "state": "Tamil Nadu", "opened_date": "2026-01-01", "monthly_cost": 50000,
            "staff_count": 4, "districts_served": ["Erode"]}, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        bid = r.json().get("id")
        assert bid, r.text[:300]
        u = client.put(f"{API}/expansion/branches/{bid}", json={
            "name": f"TEST_Branch_{TAG}_RENAMED", "district": "Tiruppur", "monthly_cost": 65000,
            "staff_count": 6, "districts_served": ["Tiruppur", "Erode"]}, timeout=60)
        assert u.status_code == 200, u.text[:400]
        lst = client.get(f"{API}/expansion/branches", timeout=60).json()
        lst = lst if isinstance(lst, list) else lst.get("branches", [])
        got = [b for b in lst if b["id"] == bid]
        assert got, "branch missing after update"
        assert got[0]["name"] == f"TEST_Branch_{TAG}_RENAMED"
        assert got[0]["monthly_cost"] == 65000 and got[0]["staff_count"] == 6
        # dashboard still loads after rename
        dash = client.get(f"{API}/expansion/overview", timeout=120)
        assert dash.status_code == 200, dash.text[:300]
        client.delete(f"{API}/expansion/branches/{bid}", timeout=60)
