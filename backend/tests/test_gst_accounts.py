"""Backend tests for GST accounts support (iteration 25).

Validates:
- POST /api/accounts with entry_type='gst_paid' accepted (no 422)
- GET /api/accounts/summary returns gst_paid_mtd, gst_input_mtd, gst_net_mtd, operational_expense_mtd
"""
import os
import uuid
from datetime import date

import pytest
import requests
import os
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


def _load_backend_url():
    env_url = os.environ.get("REACT_APP_BACKEND_URL")
    if env_url:
        return env_url.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return ""

BASE_URL = _load_backend_url()
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASS = TEST_ADMIN_PASSWORD


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    s.headers.update({"Content-Type": "application/json"})
    # verify auth works
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=30)
    assert me.status_code == 200, f"auth/me failed: {me.status_code} {me.text}"
    return s


@pytest.fixture(scope="module")
def headers(session):
    # returned as session for convenience; tests will use session directly via 'headers' fixture
    return session


class TestAccountsSummary:
    def test_summary_contains_gst_keys(self, headers):
        r = headers.get(f"{BASE_URL}/api/accounts/summary", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("gst_paid_mtd", "gst_input_mtd", "gst_net_mtd", "operational_expense_mtd"):
            assert k in data, f"missing key {k} in summary: {list(data.keys())}"
        # net = paid - input
        assert round(data["gst_net_mtd"], 2) == round(data["gst_paid_mtd"] - data["gst_input_mtd"], 2)


class TestGstPaidEntry:
    created_id = None

    def test_create_gst_paid_entry(self, headers):
        payload = {
            "entry_type": "gst_paid",
            "entry_date": date.today().isoformat(),
            "amount": 1234.56,
            "description": f"TEST_gst_paid_{uuid.uuid4().hex[:6]}",
        }
        r = headers.post(f"{BASE_URL}/api/accounts", json=payload, timeout=30)
        assert r.status_code in (200, 201), f"expected 200/201, got {r.status_code}: {r.text}"
        data = r.json()
        # Backend returns {id, message}. Validate id present and no 422 means gst_paid is accepted.
        assert "id" in data, f"no id in response: {data}"
        TestGstPaidEntry.created_id = data["id"]

    def test_summary_reflects_gst_paid(self, headers):
        # Verify gst_paid_mtd incremented (non-zero at least)
        r = headers.get(f"{BASE_URL}/api/accounts/summary", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["gst_paid_mtd"] >= 1234.56, (
            f"gst_paid_mtd should include newly created entry >=1234.56, got {data['gst_paid_mtd']}")

    def test_cleanup_gst_entry(self, headers):
        cid = TestGstPaidEntry.created_id
        if not cid:
            pytest.skip("no entry to delete")
        r = headers.delete(f"{BASE_URL}/api/accounts/{cid}", timeout=30)
        assert r.status_code in (200, 204), r.text


class TestGstInputEntry:
    def test_create_and_delete_gst_input(self, headers):
        payload = {
            "entry_type": "gst_input",
            "entry_date": date.today().isoformat(),
            "amount": 100.0,
            "description": "TEST_gst_input",
        }
        r = headers.post(f"{BASE_URL}/api/accounts", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        cid = r.json()["id"]
        d = headers.delete(f"{BASE_URL}/api/accounts/{cid}", timeout=30)
        assert d.status_code in (200, 204)