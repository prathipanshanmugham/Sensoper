"""Iteration 24 — Accounts refactor (meter_reading dropped, operational_expense + gst_input added),
summary *_mtd keys, CEO dashboard expanded accounts_summary (op_exp_mtd, gst_input_mtd,
net_cash_flow_mtd, cash_history)."""
import os
from datetime import datetime
import pytest
import requests
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD


def _login_session(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def admin_client():
    return _login_session(ADMIN_EMAIL, ADMIN_PASSWORD)


# ---------------- ACCOUNTS: new types + rejection ----------------
class TestAccountTypes:
    created_ids = []

    def test_post_operational_expense(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "operational_expense",
            "entry_date": "2026-05-03",
            "amount": 35000,
            "description": "TEST_IT24 op_exp",
        })
        assert r.status_code in (200, 201), r.text
        j = r.json()
        assert "id" in j
        TestAccountTypes.created_ids.append(j["id"])
        # verify persistence via GET list
        lst = admin_client.get(f"{BASE_URL}/api/accounts?entry_type=operational_expense").json()
        match = [x for x in lst if x.get("id") == j["id"]]
        assert match and float(match[0]["amount"]) == 35000

    def test_post_gst_input(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "gst_input",
            "entry_date": "2026-05-03",
            "amount": 18000,
            "description": "TEST_IT24 gst",
        })
        assert r.status_code in (200, 201), r.text
        j = r.json()
        assert "id" in j
        TestAccountTypes.created_ids.append(j["id"])
        lst = admin_client.get(f"{BASE_URL}/api/accounts?entry_type=gst_input").json()
        match = [x for x in lst if x.get("id") == j["id"]]
        assert match and float(match[0]["amount"]) == 18000

    def test_post_meter_reading_rejected(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "meter_reading",
            "entry_date": "2026-05-03",
            "amount": 12345,
        })
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        detail = (r.json().get("detail") or "").lower()
        # detail must mention the four allowed types
        for t in ["account_balance", "cash_on_hand", "gst_input", "operational_expense"]:
            assert t in detail, f"detail missing '{t}': {detail}"

    def test_post_unknown_type_rejected(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/accounts", json={
            "entry_type": "foo", "entry_date": "2026-05-03", "amount": 100
        })
        assert r.status_code == 400

    def test_cleanup(self, admin_client):
        for eid in TestAccountTypes.created_ids:
            admin_client.delete(f"{BASE_URL}/api/accounts/{eid}")


# ---------------- ACCOUNTS SUMMARY: *_mtd keys ----------------
class TestAccountsSummary:
    seed_ids = []

    @classmethod
    def setup_class(cls):
        cls.admin = _login_session(ADMIN_EMAIL, ADMIN_PASSWORD)
        today = datetime.utcnow().date().isoformat()  # current month, guaranteed MTD
        for payload in [
            {"entry_type": "operational_expense", "entry_date": today, "amount": 12000, "description": "TEST_IT24 op_mtd"},
            {"entry_type": "gst_input", "entry_date": today, "amount": 5000, "description": "TEST_IT24 gst_mtd"},
            {"entry_type": "cash_on_hand", "entry_date": today, "amount": 99000, "description": "TEST_IT24 cash_mtd"},
            {"entry_type": "account_balance", "entry_date": today, "amount": 150000, "description": "TEST_IT24 bal_mtd"},
        ]:
            r = cls.admin.post(f"{BASE_URL}/api/accounts", json=payload)
            if r.status_code in (200, 201):
                cls.seed_ids.append(r.json()["id"])

    @classmethod
    def teardown_class(cls):
        for eid in cls.seed_ids:
            cls.admin.delete(f"{BASE_URL}/api/accounts/{eid}")

    def test_summary_has_four_types(self):
        r = self.admin.get(f"{BASE_URL}/api/accounts/summary")
        assert r.status_code == 200, r.text
        j = r.json()
        for t in ["cash_on_hand", "account_balance", "operational_expense", "gst_input"]:
            assert t in j, f"Missing '{t}' in summary: {list(j.keys())}"

    def test_summary_no_meter_reading(self):
        r = self.admin.get(f"{BASE_URL}/api/accounts/summary")
        j = r.json()
        assert "meter_reading" not in j, f"meter_reading should be removed; got keys: {list(j.keys())}"

    def test_summary_has_mtd_keys(self):
        r = self.admin.get(f"{BASE_URL}/api/accounts/summary")
        j = r.json()
        assert "operational_expense_mtd" in j, f"Missing operational_expense_mtd: {list(j.keys())}"
        assert "gst_input_mtd" in j, f"Missing gst_input_mtd: {list(j.keys())}"
        # values should be numeric and >= seeded MTD values
        assert float(j["operational_expense_mtd"]) >= 12000
        assert float(j["gst_input_mtd"]) >= 5000


# ---------------- CEO DASHBOARD: new accounts_summary keys ----------------
class TestCeoDashboardAccounts:
    def test_ceo_has_mtd_and_netflow(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/dashboard/ceo")
        assert r.status_code == 200, r.text
        j = r.json()
        acc = j.get("accounts_summary")
        assert isinstance(acc, dict), f"accounts_summary missing/not dict: {type(acc)}"
        for k in ["operational_expense_mtd", "gst_input_mtd", "net_cash_flow_mtd", "cash_history"]:
            assert k in acc, f"accounts_summary missing '{k}': {list(acc.keys())}"
        assert "meter_reading" not in acc, f"meter_reading should not be in accounts_summary: {list(acc.keys())}"
        assert isinstance(acc["cash_history"], list)
        # numeric sanity
        for k in ["operational_expense_mtd", "gst_input_mtd", "net_cash_flow_mtd"]:
            float(acc[k])  # must parse