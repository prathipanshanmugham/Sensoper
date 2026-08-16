"""Iteration 43 API tests: Marketing Expense accounts, Subsidy tracking upsert merge, CAC report."""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0]).rstrip("/")
ADMIN = {"email": "admin@sensoper.com", "password": "Admin@123"}


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return s


# ---------------- Marketing Expense entries ----------------
def test_create_marketing_expense_persists_attribution(admin_client):
    tag = f"TEST_Camp_{uuid.uuid4().hex[:8]}"
    payload = {
        "entry_type": "marketing_expense",
        "amount": 15000,
        "entry_date": "2026-01-15",
        "description": "FB carousel ads (iter43 test)",
        "marketing_channel": "meta",
        "campaign_name": tag,
        "target_district": "Coimbatore",
    }
    r = admin_client.post(f"{BASE_URL}/api/accounts", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    created = r.json()
    # POST may return only {id, message}. Verify via GET below.
    assert created.get("id") or created.get("_id"), created

    # GET filtered
    r2 = admin_client.get(f"{BASE_URL}/api/accounts", params={"entry_type": "marketing_expense"}, timeout=15)
    assert r2.status_code == 200
    items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
    match = [x for x in items if x.get("campaign_name") == tag]
    assert match, f"created marketing entry not found via GET; got {len(items)} entries"
    m = match[0]
    assert m.get("marketing_channel") == "meta"
    assert m.get("target_district") == "Coimbatore"


def test_marketing_summary_endpoint(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/accounts/marketing-summary", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # response is dict with totals; ensure it's not error and has a numeric feel
    assert isinstance(data, dict)


# ---------------- Subsidy tracking incremental merge ----------------
def test_subsidy_upsert_merge_preserves_dates_and_computes_days(admin_client):
    project_id = f"TEST_PROJ_{uuid.uuid4().hex[:10]}"
    # 1st POST: set application_date only
    r1 = admin_client.post(f"{BASE_URL}/api/subsidy/tracking", json={
        "project_id": project_id,
        "scheme": "pm_surya_ghar",
        "status": "applied",
        "application_date": "2026-01-01",
        "claimed_amount": 78000,
    }, timeout=15)
    assert r1.status_code == 200, r1.text

    # 2nd POST: only status update + disbursement_date (application_date must be preserved and days computed)
    r2 = admin_client.post(f"{BASE_URL}/api/subsidy/tracking", json={
        "project_id": project_id,
        "status": "disbursed",
        "disbursement_date": "2026-01-31",
        "disbursed_amount": 78000,
    }, timeout=15)
    assert r2.status_code == 200, r2.text

    # GET
    r3 = admin_client.get(f"{BASE_URL}/api/subsidy/tracking/{project_id}", timeout=15)
    assert r3.status_code == 200
    doc = r3.json()
    assert doc.get("application_date", "").startswith("2026-01-01"), f"application_date not preserved: {doc.get('application_date')}"
    assert doc.get("disbursement_date", "").startswith("2026-01-31")
    assert doc.get("status") == "disbursed"
    assert doc.get("days_to_disburse") == 30, f"days_to_disburse expected 30, got {doc.get('days_to_disburse')}"
    assert doc.get("claimed_amount") == 78000, "claimed_amount should be preserved from first upsert"


def test_subsidy_status_only_update_preserves_amounts(admin_client):
    project_id = f"TEST_PROJ_{uuid.uuid4().hex[:10]}"
    admin_client.post(f"{BASE_URL}/api/subsidy/tracking", json={
        "project_id": project_id, "eligible_amount": 60000, "claimed_amount": 60000,
        "status": "eligible", "scheme": "pm_surya_ghar"
    }, timeout=15)
    r = admin_client.post(f"{BASE_URL}/api/subsidy/tracking", json={
        "project_id": project_id, "status": "under_review"
    }, timeout=15)
    assert r.status_code == 200
    got = admin_client.get(f"{BASE_URL}/api/subsidy/tracking/{project_id}", timeout=15).json()
    assert got.get("status") == "under_review"
    assert got.get("eligible_amount") == 60000
    assert got.get("claimed_amount") == 60000


# ---------------- CAC report ----------------
def test_cac_report_wide_window(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/reports/cac",
                         params={"start": "2025-01-01", "end": "2026-12-31"}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ["period_start", "period_end", "total_spend", "total_customers",
              "blended_cac", "paid_cac", "ltv", "ltv_cac_ratio", "channels",
              "spend_by_channel", "unattributed_pct", "marketing_pct_of_revenue"]:
        assert k in data, f"missing key: {k}"
    # types
    assert isinstance(data["channels"], list)
    assert isinstance(data["spend_by_channel"], dict)
    # blended_cac and paid_cac can be None (safe divide) — that's acceptable
    if data["blended_cac"] is not None:
        assert isinstance(data["blended_cac"], (int, float))
    if data["paid_cac"] is not None:
        assert isinstance(data["paid_cac"], (int, float))
    if data["ltv_cac_ratio"] is not None:
        assert isinstance(data["ltv_cac_ratio"], (int, float))


def test_subsidy_analytics_ok(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/subsidy/analytics", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ["total_eligible", "total_claimed", "total_approved", "total_disbursed",
              "by_scheme", "by_status", "stuck_applications", "count"]:
        assert k in d
