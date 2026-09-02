"""
Iteration 44 Batch B — Pricelist page backend support tests.
Modules covered: backend/catalogue.py (product list + inline update of margin_pct /
selling_price / rate, pricing config gst_pct), company profile (PDF branding source).
No backend code changed in this batch — these validate the endpoints the new
frontend Pricelist page consumes.
"""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL is missing")
BASE_URL = base_url.rstrip("/")

CATEGORIES = ["panel", "inverter", "battery", "pump", "structure", "service"]


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@sensoper.com", "password": "Admin@123"})
    if r.status_code != 200:
        pytest.fail(f"Admin login failed {r.status_code}: {r.text[:300]}")
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    # else: auth is cookie-based, session cookie jar carries it
    me = s.get(f"{BASE_URL}/api/auth/me")
    if me.status_code != 200:
        pytest.fail(f"Session not authenticated after login: {me.status_code} {me.text[:200]}")
    return s


# --- Catalogue listing (used to build the flat pricelist table) ---
class TestCatalogueListing:
    @pytest.mark.parametrize("cat", CATEGORIES)
    def test_list_category(self, client, cat):
        r = client.get(f"{BASE_URL}/api/catalogue/products/{cat}", params={"active_only": "false"})
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert isinstance(data, list)
        for item in data:
            assert "id" in item and isinstance(item["id"], str)
            assert "_id" not in item

    def test_unknown_category_rejected(self, client):
        r = client.get(f"{BASE_URL}/api/catalogue/products/bogus")
        assert r.status_code == 400

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/catalogue/products/panel")
        assert r.status_code in (401, 403)

    def test_panels_and_inverters_exist_for_pickers(self, client):
        panels = client.get(f"{BASE_URL}/api/catalogue/products/panel").json()
        invs = client.get(f"{BASE_URL}/api/catalogue/products/inverter").json()
        assert len(panels) > 0, "No panels in catalogue — calculator panel picker would be empty"
        assert len(invs) > 0, "No inverters in catalogue — calculator inverter picker would be empty"
        # fields used by picker labels / cost formula
        assert any(p.get("wattage") for p in panels)
        assert any(iv.get("rated_kw") for iv in invs)


# --- Pricing config (gst_pct drives the CGST/SGST split in the PDF) ---
class TestPricingConfig:
    def test_get_config(self, client):
        r = client.get(f"{BASE_URL}/api/catalogue/config")
        assert r.status_code == 200
        cfg = r.json()
        assert "gst_pct" in cfg
        assert isinstance(cfg["gst_pct"], (int, float))
        assert cfg["gst_pct"] > 0


# --- Company profile (PDF header branding) ---
class TestCompanyProfile:
    def test_active_company(self, client):
        r = client.get(f"{BASE_URL}/api/company/active")
        assert r.status_code == 200, r.text[:300]
        c = r.json()
        assert c.get("company_name")


# --- Inline edit persistence for each editable category ---
class TestInlineEditPersistence:
    def _first(self, client, cat):
        items = client.get(f"{BASE_URL}/api/catalogue/products/{cat}").json()
        if not items:
            pytest.skip(f"No {cat} items to edit")
        return items[0]

    @pytest.mark.parametrize("cat", ["panel", "inverter", "battery", "pump", "structure"])
    def test_margin_and_selling_price_persist(self, client, cat):
        item = self._first(client, cat)
        pid = item["id"]
        orig_margin = item.get("margin_pct")
        orig_selling = item.get("selling_price")

        # update margin_pct
        r = client.put(f"{BASE_URL}/api/catalogue/products/{cat}/{pid}", json={"margin_pct": 22.5})
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("margin_pct") == 22.5
        got = client.get(f"{BASE_URL}/api/catalogue/products/{cat}").json()
        row = next(x for x in got if x["id"] == pid)
        assert row["margin_pct"] == 22.5, "margin_pct did not persist"

        # update selling_price
        r = client.put(f"{BASE_URL}/api/catalogue/products/{cat}/{pid}", json={"selling_price": 12345})
        assert r.status_code == 200, r.text[:300]
        assert float(r.json().get("selling_price")) == 12345
        got = client.get(f"{BASE_URL}/api/catalogue/products/{cat}").json()
        row = next(x for x in got if x["id"] == pid)
        assert float(row["selling_price"]) == 12345, "selling_price did not persist"

        # restore
        client.put(f"{BASE_URL}/api/catalogue/products/{cat}/{pid}",
                   json={"margin_pct": orig_margin, "selling_price": orig_selling})

    def test_service_rate_persists(self, client):
        item = self._first(client, "service")
        pid = item["id"]
        orig = item.get("rate")
        r = client.put(f"{BASE_URL}/api/catalogue/products/service/{pid}", json={"rate": 777})
        assert r.status_code == 200, r.text[:300]
        assert float(r.json().get("rate")) == 777
        got = client.get(f"{BASE_URL}/api/catalogue/products/service").json()
        row = next(x for x in got if x["id"] == pid)
        assert float(row["rate"]) == 777
        client.put(f"{BASE_URL}/api/catalogue/products/service/{pid}", json={"rate": orig})

    def test_update_bad_id_returns_404(self, client):
        r = client.put(f"{BASE_URL}/api/catalogue/products/panel/000000000000000000000000",
                       json={"margin_pct": 10})
        assert r.status_code in (404, 400), f"expected 404/400, got {r.status_code}"


# --- Non-admin RBAC on catalogue mutation (Pricelist is admin-only) ---
class TestRbac:
    def test_update_requires_admin(self, client):
        # create a throwaway employee and confirm PUT is blocked
        email = "TEST_pricelist_emp@example.com"
        reg = client.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Emp@12345", "name": "TEST Employee", "role": "employee"
        })
        if reg.status_code not in (200, 201, 400, 409):
            pytest.skip(f"register unavailable: {reg.status_code} {reg.text[:200]}")
        s = requests.Session()
        login = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "Emp@12345"})
        if login.status_code != 200:
            pytest.skip("employee login unavailable")
        tok = login.json().get("access_token") or login.json().get("token")
        if tok:
            s.headers.update({"Authorization": f"Bearer {tok}"})
        panels = client.get(f"{BASE_URL}/api/catalogue/products/panel").json()
        if not panels:
            pytest.skip("no panels")
        r = s.put(f"{BASE_URL}/api/catalogue/products/panel/{panels[0]['id']}", json={"margin_pct": 99})
        assert r.status_code == 403, f"non-admin was able to edit catalogue: {r.status_code}"
