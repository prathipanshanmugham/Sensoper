"""Iteration 44 Batch C+D — vendors, readings generation, audit owner,
employee scores, new reports (operational_expense, reading_analysis,
employee_performance), plus customer_credit + assets regression."""
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
STAFF = {"email": "qa_staff_iter46@sensoper.com", "password": "Staff@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"Login failed for {creds['email']}: {r.status_code} {r.text[:300]}")
    return s


@pytest.fixture(scope="session")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def staff(admin):
    """Authenticated staff session (created if the shared QA staff user is absent)."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=STAFF, timeout=60)
    if r.status_code != 200:
        cr = admin.post(f"{API}/auth/register", json={
            "email": STAFF["email"], "password": STAFF["password"],
            "name": "QA Staff Iter46", "role": "staff"}, timeout=60)
        if cr.status_code not in (200, 201):
            pytest.fail(f"cannot create staff user: {cr.status_code} {cr.text[:200]}")
        r = s.post(f"{API}/auth/login", json=STAFF, timeout=60)
        assert r.status_code == 200, r.text[:200]
    return s


# ---------------- Vendors CRUD ----------------
class TestVendors:
    vendor_id = None

    def test_create_vendor(self, admin):
        payload = {"name": f"TEST_Vendor_{uuid.uuid4().hex[:6]}", "category": "panels",
                   "phone": "9876543210", "email": "v@test.com", "gstin": "33ABCDE1234F1Z5",
                   "address": "Coimbatore", "notes": "qa vendor"}
        r = admin.post(f"{API}/vendors", json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text[:300]
        d = r.json()
        assert "_id" not in d and isinstance(d["id"], str)
        assert d["name"] == payload["name"] and d["gstin"] == payload["gstin"]
        assert d["active"] is True
        TestVendors.vendor_id = d["id"]
        TestVendors.vendor_name = payload["name"]

        lst = admin.get(f"{API}/vendors", timeout=60).json()
        assert any(v["id"] == d["id"] for v in lst)

    def test_search_filter(self, admin):
        assert TestVendors.vendor_id
        r = admin.get(f"{API}/vendors", params={"search": TestVendors.vendor_name[:10]}, timeout=60)
        assert r.status_code == 200
        rows = r.json()
        assert any(v["id"] == TestVendors.vendor_id for v in rows)
        r2 = admin.get(f"{API}/vendors", params={"search": "ZZZ_no_such_vendor"}, timeout=60)
        assert r2.status_code == 200 and r2.json() == []

    def test_update_vendor_persists(self, admin):
        r = admin.put(f"{API}/vendors/{TestVendors.vendor_id}",
                      json={"phone": "9000000001", "notes": "updated"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["phone"] == "9000000001"
        lst = admin.get(f"{API}/vendors", timeout=60).json()
        row = next(v for v in lst if v["id"] == TestVendors.vendor_id)
        assert row["phone"] == "9000000001" and row["notes"] == "updated"

    def test_po_history(self, admin):
        r = admin.get(f"{API}/vendors/{TestVendors.vendor_id}/purchase-orders", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["vendor"]["id"] == TestVendors.vendor_id
        assert isinstance(d["purchase_orders"], list)
        assert d["total_value"] == 0

    def test_invalid_ids(self, admin):
        assert admin.get(f"{API}/vendors/notanid/purchase-orders", timeout=60).status_code == 400
        assert admin.put(f"{API}/vendors/notanid", json={"phone": "1"}, timeout=60).status_code == 400
        assert admin.get(f"{API}/vendors/{'a'*24}/purchase-orders", timeout=60).status_code == 404

    def test_rbac_staff_cannot_write(self, staff):
        assert staff.get(f"{API}/vendors", timeout=60).status_code == 200
        r = staff.post(f"{API}/vendors", json={"name": "TEST_staff_vendor"}, timeout=60)
        assert r.status_code == 403, f"staff create should be 403, got {r.status_code}"
        assert staff.put(f"{API}/vendors/{TestVendors.vendor_id}", json={"phone": "1"}, timeout=60).status_code == 403
        assert staff.delete(f"{API}/vendors/{TestVendors.vendor_id}", timeout=60).status_code == 403

    def test_zz_archive_vendor(self, admin):
        r = admin.delete(f"{API}/vendors/{TestVendors.vendor_id}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        lst = admin.get(f"{API}/vendors", timeout=60).json()
        assert not any(v["id"] == TestVendors.vendor_id for v in lst)


# ---------------- Readings: estimate + generation logs ----------------
class TestReadingGeneration:
    reading_id = None

    def test_create_reading_with_estimate(self, admin):
        payload = {"site_name": "TEST_Site_Gen", "customer_name": "TEST Customer",
                   "device_id": f"TESTDEV{uuid.uuid4().hex[:4]}", "start_date": "2026-04-01",
                   "days": 30, "estimated_monthly_kwh": 400}
        r = admin.post(f"{API}/readings", json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        assert d["estimated_monthly_kwh"] == 400
        assert d["generation_logs"] == [] and d["total_actual_kwh"] == 0
        TestReadingGeneration.reading_id = d["id"]

    def test_log_generation_entries(self, admin):
        rid = TestReadingGeneration.reading_id
        entries = [("2026-04", 380), ("2026-05", 420), ("2026-06", 500)]
        for m, k in entries:
            r = admin.post(f"{API}/readings/{rid}/generation", json={"date": m, "kwh": k}, timeout=60)
            assert r.status_code in (200, 201), r.text[:300]
        d = r.json()
        assert len(d["generation_logs"]) == 3
        assert d["total_actual_kwh"] == 1300
        # persistence via GET list
        lst = admin.get(f"{API}/readings", timeout=60).json()
        rows = lst["readings"] if isinstance(lst, dict) else lst
        row = next(x for x in rows if x["id"] == rid)
        assert row["total_actual_kwh"] == 1300 and len(row["generation_logs"]) == 3

    def test_update_estimate_persists(self, admin):
        rid = TestReadingGeneration.reading_id
        r = admin.put(f"{API}/readings/{rid}", json={"estimated_monthly_kwh": 450}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["estimated_monthly_kwh"] == 450

    def test_generation_invalid_reading(self, admin):
        r = admin.post(f"{API}/readings/{'a'*24}/generation", json={"date": "2026-01", "kwh": 10}, timeout=60)
        assert r.status_code == 404

    def test_reading_analysis_report(self, admin):
        r = admin.get(f"{API}/reports/reading_analysis", timeout=90)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["title"] == "Reading Analysis Report"
        row = next((x for x in d["rows"] if x["site_name"] == "TEST_Site_Gen"), None)
        assert row, f"TEST_Site_Gen missing in rows: {d['rows']}"
        assert row["actual_total_kwh"] == 1300
        assert row["logs_count"] == 3
        assert row["estimated_monthly_kwh"] == 450
        assert row["estimated_total_kwh"] == 1350
        assert row["variance_pct"] == pytest.approx(-3.7, abs=0.2)
        assert row["status"] == "Below Estimate"
        names = [c["name"] for c in d["chart_data"]]
        assert "2026-05" in names
        assert d["summary"]["total_actual_kwh"] >= 1300

    def test_zz_cleanup_reading(self, admin):
        r = admin.delete(f"{API}/readings/{TestReadingGeneration.reading_id}", timeout=60)
        assert r.status_code == 200


# ---------------- Audit issue owner ----------------
class TestAuditOwner:
    def test_issue_with_owner(self, admin):
        audits = admin.get(f"{API}/audits", timeout=60).json()
        rows = audits["audits"] if isinstance(audits, dict) else audits
        if not rows:
            r = admin.post(f"{API}/audits", json={"week_start": "2026-07-06", "notes": "TEST audit"}, timeout=60)
            assert r.status_code in (200, 201), r.text[:300]
            audits = admin.get(f"{API}/audits", timeout=60).json()
            rows = audits["audits"] if isinstance(audits, dict) else audits
        aid = rows[0]["id"]
        payload = {"description": "TEST issue with owner", "severity": "high",
                   "owner_name": "QA Owner", "fix_deadline": "2026-07-31"}
        r = admin.put(f"{API}/audits/{aid}/issue", json=payload, timeout=60)
        assert r.status_code == 200, r.text[:300]
        audits = admin.get(f"{API}/audits", timeout=60).json()
        rows = audits["audits"] if isinstance(audits, dict) else audits
        audit = next(a for a in rows if a["id"] == aid)
        issue = next((i for i in audit.get("issues", []) if i.get("description") == "TEST issue with owner"), None)
        assert issue, "issue not persisted"
        assert issue["owner_name"] == "QA Owner"
        assert issue["fix_deadline"] == "2026-07-31"
        assert issue["severity"] == "high"


# ---------------- Employee scores + performance report ----------------
class TestEmployeeScores:
    def test_create_score_and_report(self, admin, staff):
        me = staff.get(f"{API}/auth/me", timeout=60)
        assert me.status_code == 200, me.text[:200]
        uid = me.json()["id"]
        r = admin.post(f"{API}/employee-scores", json={
            "user_id": uid, "period": "2026-07", "score": 4, "notes": "TEST good work"}, timeout=60)
        assert r.status_code in (200, 201), r.text[:300]
        d = r.json()
        assert d["score"] == 4 and d["period"] == "2026-07" and d["user_name"] == me.json()["name"]
        assert "_id" not in d

        lst = admin.get(f"{API}/employee-scores", params={"user_id": uid}, timeout=60)
        assert lst.status_code == 200
        assert any(s["score"] == 4 and s["period"] == "2026-07" for s in lst.json())

        rep = admin.get(f"{API}/reports/employee_performance", timeout=90)
        assert rep.status_code == 200, rep.text[:300]
        rd = rep.json()
        row = next((x for x in rd["rows"] if x["staff"] == me.json()["name"]), None)
        assert row, "staff row missing in employee_performance report"
        assert row["manual_score"] == 4
        assert row["score_period"] == "2026-07"
        assert row["manual_notes"] == "TEST good work"
        for k in ("projects_handled", "projects_completed", "revenue", "daily_updates_logged"):
            assert k in row
        assert rd["summary"]["scored_staff"] >= 1

    def test_score_validation(self, admin, staff):
        uid = staff.get(f"{API}/auth/me", timeout=60).json()["id"]
        r = admin.post(f"{API}/employee-scores", json={"user_id": uid, "period": "2026-07", "score": 9}, timeout=60)
        assert r.status_code in (400, 422), f"expected validation error, got {r.status_code}"
        r2 = admin.post(f"{API}/employee-scores", json={"user_id": "a" * 24, "period": "2026-07", "score": 3}, timeout=60)
        assert r2.status_code == 404, f"expected 404 for bad user, got {r2.status_code}"

    def test_rbac_staff_forbidden(self, staff):
        uid = staff.get(f"{API}/auth/me", timeout=60).json()["id"]
        assert staff.post(f"{API}/employee-scores", json={"user_id": uid, "period": "2026-07", "score": 3}, timeout=60).status_code == 403
        assert staff.get(f"{API}/employee-scores", timeout=60).status_code == 403
        r = staff.get(f"{API}/reports/employee_performance", timeout=90)
        assert r.status_code == 403, f"staff should not view employee_performance report, got {r.status_code}"


# ---------------- Operational expense report ----------------
class TestOperationalExpenseReport:
    def test_report_only_operational(self, admin):
        # seed one operational expense + one marketing expense
        for et, amt, desc in (("operational_expense", 1500, "TEST_op_exp"), ("marketing_expense", 999, "TEST_mkt_exp")):
            r = admin.post(f"{API}/accounts", json={
                "entry_type": et, "amount": amt, "entry_date": "2026-07-05", "description": desc}, timeout=60)
            assert r.status_code in (200, 201), f"{et}: {r.status_code} {r.text[:200]}"
        rep = admin.get(f"{API}/reports/operational_expense", timeout=90)
        assert rep.status_code == 200, rep.text[:300]
        d = rep.json()
        assert d["title"] == "Operational Expense Report"
        descs = [r_["description"] for r_ in d["rows"]]
        assert "TEST_op_exp" in descs
        assert "TEST_mkt_exp" not in descs, "marketing expense leaked into operational report"
        s = d["summary"]
        assert s["entries"] == len([r_ for r_ in d["rows"]])
        assert s["total_expense"] >= 1500
        assert s["avg_per_entry"] == pytest.approx(round(s["total_expense"] / s["entries"], 2), abs=0.05)
        assert any(c["name"] == "2026-07" for c in d["chart_data"])

    def test_date_filter(self, admin):
        r = admin.get(f"{API}/reports/operational_expense",
                      params={"date_from": "2026-07-01", "date_to": "2026-07-31"}, timeout=90)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            if row["date"] != "-":
                assert row["date"][:7] == "2026-07", row


# ---------------- Regression: customer credit + assets ----------------
class TestRegression:
    FIN_ONLY = {"customer_name", "customer", "reference", "ref", "invoice", "invoice_number",
                "total_value", "paid", "amount_paid", "balance", "status", "due_date", "date"}
    LEAK = {"cost", "total_cost", "margin", "margin_pct", "profit", "material_cost", "labour_cost"}

    def test_customer_credit_report_no_cost_leak(self, admin):
        r = admin.get(f"{API}/reports/customer_credit", timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for row in d["rows"]:
            leaked = self.LEAK & set(row.keys())
            assert not leaked, f"cost/margin fields leaked: {leaked}"
        assert not (self.LEAK & set(d.get("summary", {}).keys())), d.get("summary")

    def test_assets_list_and_filter(self, admin):
        r = admin.get(f"{API}/assets", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        rows = d["assets"] if isinstance(d, dict) else d
        assert isinstance(rows, list)
        assert len(rows) >= 1, "assets list is empty (expected at least 1 seeded asset)"
        for a in rows:
            assert "_id" not in a and "id" in a
        cat = rows[0].get("category")
        if cat:
            r2 = admin.get(f"{API}/assets", params={"category": cat}, timeout=60)
            assert r2.status_code == 200
            d2 = r2.json()
            rows2 = d2["assets"] if isinstance(d2, dict) else d2
            assert all(a.get("category") == cat for a in rows2), rows2
