"""Iteration 23 — Accounts, Readings, CEO Dashboard expansion, Permissions matrix, PWA endpoints.
Tests align with the review_request contract.
"""
import os
import pytest
import requests
from datetime import datetime, timedelta
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://solar-ops-management.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD


# ---------------- Fixtures ----------------
def _login_session(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    # Cookies auto-handled by session
    return s


@pytest.fixture(scope="session")
def admin_client():
    return _login_session(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def staff_client(admin_client):
    """Create a staff user if not existing and return an authenticated session."""
    email = "TEST_staff_it23@example.com"
    password = "StaffPass@123"
    # Try register (idempotent)
    requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": password, "name": "Test Staff 23", "role": "staff"
    }, timeout=30)
    # Login as staff
    try:
        s = _login_session(email, password)
    except AssertionError as e:
        pytest.skip(f"Staff login failed: {e}")
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=30)
    if me.status_code == 200 and me.json().get("role") != "staff":
        uid = me.json().get("id")
        users_r = admin_client.get(f"{BASE_URL}/api/users")
        if users_r.status_code == 200:
            for u in users_r.json():
                if u.get("email") == email:
                    uid = u.get("id")
                    break
        admin_client.put(f"{BASE_URL}/api/users/{uid}", json={"role": "staff"})
        # re-login to get fresh cookie with staff claims
        s = _login_session(email, password)
    return s


# ---------------- ACCOUNTS ----------------
class TestAccounts:
    created_ids = []

    def test_create_cash_on_hand(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "cash_on_hand", "entry_date": "2026-02-15", "amount": 200000, "description": "TEST_IT23 cash"
        })
        assert r.status_code in (200, 201), r.text
        j = r.json()
        assert "id" in j
        TestAccounts.created_ids.append(j["id"])

    def test_create_account_balance(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "account_balance", "entry_date": "2026-02-16", "amount": 500000, "description": "TEST_IT23 balance"
        })
        assert r.status_code in (200, 201), r.text
        TestAccounts.created_ids.append(r.json()["id"])

    def test_create_meter_reading(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "meter_reading", "entry_date": "2026-02-17", "amount": 12345, "description": "TEST_IT23 meter"
        })
        assert r.status_code in (200, 201), r.text
        TestAccounts.created_ids.append(r.json()["id"])

    def test_invalid_entry_type_returns_400(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "foo", "entry_date": "2026-02-15", "amount": 1, "description": "bad"
        })
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

    def test_list_accounts_sorted_desc(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/accounts")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 3
        # sorted desc by entry_date
        dates = [row.get("entry_date") for row in rows if row.get("entry_date")]
        assert dates == sorted(dates, reverse=True)

    def test_accounts_summary(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/accounts/summary")
        assert r.status_code == 200, r.text
        j = r.json()
        for t in ("cash_on_hand", "account_balance", "meter_reading"):
            assert t in j
            assert "amount" in j[t]
        # Latest cash_on_hand amount should be 200000 (from our insert — unless a newer one exists)
        assert j["cash_on_hand"]["amount"] >= 200000 or j["cash_on_hand"]["entry_date"] >= "2026-02-15"

    def test_date_filters(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/accounts", params={"date_from": "2026-02-15", "date_to": "2026-02-17"})
        assert r.status_code == 200
        for row in r.json():
            assert "2026-02-15" <= row["entry_date"] <= "2026-02-17"

    def test_update_account(self, admin_client):
        assert TestAccounts.created_ids, "need prior creation"
        eid = TestAccounts.created_ids[0]
        r = admin_client.put(f"{BASE_URL}/api/accounts/{eid}", json={"amount": 250000, "description": "TEST_IT23 updated"})
        assert r.status_code == 200, r.text
        # verify via list
        rows = admin_client.get(f"{BASE_URL}/api/accounts").json()
        updated = [x for x in rows if x["id"] == eid]
        assert updated and updated[0]["amount"] == 250000

    def test_staff_cannot_update_others_entry(self, admin_client, staff_client):
        assert TestAccounts.created_ids
        eid = TestAccounts.created_ids[0]  # created by admin
        r = staff_client.put(f"{BASE_URL}/api/accounts/{eid}", json={"amount": 1})
        assert r.status_code == 403, f"staff should be forbidden, got {r.status_code}"

    def test_staff_cannot_delete(self, admin_client, staff_client):
        assert TestAccounts.created_ids
        eid = TestAccounts.created_ids[-1]
        r = staff_client.delete(f"{BASE_URL}/api/accounts/{eid}")
        assert r.status_code == 403

    def test_staff_can_update_own(self, staff_client):
        # staff creates own entry
        r = staff_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "cash_on_hand", "entry_date": "2026-02-10", "amount": 5000, "description": "TEST_IT23 staff own"
        })
        assert r.status_code in (200, 201), r.text
        eid = r.json()["id"]
        r2 = staff_client.put(f"{BASE_URL}/api/accounts/{eid}", json={"amount": 5500})
        assert r2.status_code == 200, r2.text

    def test_admin_delete_success(self, admin_client):
        # delete all our TEST_IT23 entries
        for eid in TestAccounts.created_ids:
            r = admin_client.delete(f"{BASE_URL}/api/accounts/{eid}")
            assert r.status_code in (200, 204)


# ---------------- READINGS ----------------
class TestReadings:
    created_ids = []

    def test_create_reading_auto_overdue(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/readings", json={
            "site_name": "TEST_IT23 Site A",
            "start_date": "2026-01-01",
            "days": 30,
            "status": "active"
        })
        assert r.status_code in (200, 201), r.text
        j = r.json()
        assert j["end_date"] == "2026-01-31", f"expected end_date=2026-01-31, got {j.get('end_date')}"
        # today is 2026-01-xx... check derivation: if today > 2026-01-31, should be overdue
        today = datetime.utcnow().strftime("%Y-%m-%d")
        if today > "2026-01-31":
            assert j["status"] == "overdue", f"expected overdue (today={today}), got {j['status']}"
        else:
            assert j["status"] == "active"
        TestReadings.created_ids.append(j["id"])

    def test_create_reading_future_remains_active(self, admin_client):
        future_start = (datetime.utcnow() + timedelta(days=60)).strftime("%Y-%m-%d")
        r = admin_client.post(f"{BASE_URL}/api/readings", json={
            "site_name": "TEST_IT23 Site Future",
            "start_date": future_start,
            "days": 30,
            "status": "active"
        })
        assert r.status_code in (200, 201)
        j = r.json()
        assert j["status"] == "active", f"expected active for future start, got {j['status']}"
        TestReadings.created_ids.append(j["id"])

    def test_list_readings(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/readings")
        assert r.status_code == 200
        assert isinstance(r.json(), list) and len(r.json()) >= 2

    def test_list_readings_status_overdue_filter(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/readings", params={"status": "overdue"})
        assert r.status_code == 200
        for row in r.json():
            assert row["status"] == "overdue"

    def test_readings_summary(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/readings/summary")
        assert r.status_code == 200
        j = r.json()
        for k in ("total", "active", "completed", "overdue"):
            assert k in j, f"missing key {k}"
            assert isinstance(j[k], int)
        assert j["total"] == j["active"] + j["completed"] + j["overdue"]

    def test_update_reading_status(self, admin_client):
        assert TestReadings.created_ids
        rid = TestReadings.created_ids[0]
        r = admin_client.put(f"{BASE_URL}/api/readings/{rid}", json={"status": "completed"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "completed"

    def test_staff_cannot_delete_reading(self, admin_client, staff_client):
        assert TestReadings.created_ids
        rid = TestReadings.created_ids[-1]
        r = staff_client.delete(f"{BASE_URL}/api/readings/{rid}")
        assert r.status_code == 403

    def test_admin_delete_reading(self, admin_client):
        for rid in TestReadings.created_ids:
            r = admin_client.delete(f"{BASE_URL}/api/readings/{rid}")
            assert r.status_code in (200, 204)


# ---------------- CEO DASHBOARD ----------------
class TestCeoDashboard:
    def test_ceo_dashboard_has_accounts_and_readings(self, admin_client):
        # Seed a cash entry to ensure summary has data
        admin_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "cash_on_hand", "entry_date": "2026-02-20", "amount": 777000, "description": "TEST_IT23 ceo seed"
        })
        r = admin_client.get(f"{BASE_URL}/api/dashboard/ceo")
        assert r.status_code == 200, r.text
        j = r.json()
        assert "accounts_summary" in j, f"missing accounts_summary, keys={list(j.keys())}"
        assert "readings_summary" in j
        acc = j["accounts_summary"]
        for k in ("cash_on_hand", "meter_reading", "account_balance", "cash_history"):
            assert k in acc, f"accounts_summary missing {k}"
        assert isinstance(acc["cash_history"], list)
        rd = j["readings_summary"]
        for k in ("total", "active", "completed", "overdue"):
            assert k in rd


# ---------------- PERMISSIONS ----------------
EXPECTED_MODULES = [
    "module_dashboard", "module_accounts", "module_readings", "module_inventory",
    "module_purchase_inbound", "module_delivery_outbound", "module_credits",
    "module_returns", "module_audits", "module_reports", "module_alerts",
    "module_approvals", "module_users", "module_permissions", "module_settings",
    "module_ceo_dashboard"
]
ACTIONS = ("view", "create", "edit", "delete", "export")


class TestPermissions:
    def test_get_permissions_has_module_keys(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/permissions")
        assert r.status_code == 200, r.text
        data = r.json()
        # Accept either list of role objects or dict by role
        roles = {}
        if isinstance(data, list):
            for item in data:
                role = item.get("role") or item.get("role_name") or item.get("name")
                perms = item.get("permissions", item)
                roles[role] = perms
        elif isinstance(data, dict):
            roles = data
        for role in ("admin", "manager", "staff"):
            assert role in roles, f"missing role {role} in permissions response"
            perms = roles[role]
            if "permissions" in perms and isinstance(perms["permissions"], dict):
                perms = perms["permissions"]
            for mod in EXPECTED_MODULES:
                assert mod in perms, f"{role} missing module key {mod}"
                mv = perms[mod]
                assert isinstance(mv, dict), f"{role}.{mod} expected dict, got {type(mv)}"
                for act in ACTIONS:
                    assert act in mv, f"{role}.{mod} missing action {act}"

    def test_put_manager_permissions_persists(self, admin_client):
        # get current
        r = admin_client.get(f"{BASE_URL}/api/permissions/manager")
        assert r.status_code == 200, r.text
        current = r.json()
        perms = current.get("permissions", current)
        # Toggle module_readings.export
        original = perms.get("module_readings", {}).get("export", True)
        new_val = not original
        updated_perms = dict(perms)
        updated_perms["module_readings"] = dict(updated_perms.get("module_readings", {}))
        updated_perms["module_readings"]["export"] = new_val

        # Try both payload shapes
        put_body = {"permissions": updated_perms}
        r2 = admin_client.put(f"{BASE_URL}/api/permissions/manager", json=put_body)
        if r2.status_code >= 400:
            # try direct dict
            r2 = admin_client.put(f"{BASE_URL}/api/permissions/manager", json=updated_perms)
        assert r2.status_code == 200, f"PUT failed: {r2.status_code} {r2.text}"

        # verify
        r3 = admin_client.get(f"{BASE_URL}/api/permissions/manager")
        assert r3.status_code == 200
        fresh = r3.json().get("permissions", r3.json())
        assert fresh.get("module_readings", {}).get("export") == new_val, f"expected {new_val}, got {fresh.get('module_readings', {}).get('export')}"

        # restore
        updated_perms["module_readings"]["export"] = original
        admin_client.put(f"{BASE_URL}/api/permissions/manager", json={"permissions": updated_perms})


# ---------------- PWA static assets ----------------
class TestPwaAssets:
    def test_manifest_json(self):
        r = requests.get(f"{BASE_URL}/manifest.json", timeout=30)
        assert r.status_code == 200, f"manifest.json status {r.status_code}"
        j = r.json()
        assert j.get("name") == "Sensoper Controls & Renewables", f"name={j.get('name')}"
        assert j.get("display") == "standalone"
        assert j.get("theme_color") == "#10b981"

    def test_service_worker_js(self):
        r = requests.get(f"{BASE_URL}/service-worker.js", timeout=30)
        assert r.status_code == 200
        # should be JS content (not HTML 404 page)
        assert "self" in r.text or "addEventListener" in r.text or "caches" in r.text.lower()

    def test_offline_html(self):
        r = requests.get(f"{BASE_URL}/offline.html", timeout=30)
        assert r.status_code == 200
        assert "<html" in r.text.lower() or "<!doctype" in r.text.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])