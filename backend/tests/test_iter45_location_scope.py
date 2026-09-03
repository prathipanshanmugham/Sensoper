"""Iteration 45 — location-scoped reports/exports + simplified calculator backend support."""
import os
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


@pytest.fixture(scope="session")
def admin_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"Admin login failed {r.status_code}: {r.text[:300]}")
    # cookie-based auth (httponly access_token cookie set by backend)
    assert s.cookies.get("access_token"), f"no access_token cookie; body={r.text[:300]}"
    return s


@pytest.fixture(scope="session")
def staff_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=STAFF, timeout=60)
    if r.status_code != 200:
        pytest.skip(f"Staff login unavailable ({r.status_code}): {r.text[:200]}")
    if not s.cookies.get("access_token"):
        pytest.skip("staff login did not return session cookie")
    return s


@pytest.fixture(scope="session")
def locations(admin_client):
    r = admin_client.get(f"{API}/locations", timeout=60)
    assert r.status_code == 200, r.text[:300]
    return r.json()


# ── Locations registry ────────────────────────────────────────────────
class TestLocations:
    def test_list_locations(self, locations):
        assert isinstance(locations, list)
        for loc in locations:
            assert "id" in loc and "name" in loc
            assert "_id" not in loc


# ── Generic reports engine with location_id ───────────────────────────
REPORT_TYPES = ["assets", "projects", "inventory", "financial", "amc"]


class TestReportsLocationScope:
    @pytest.mark.parametrize("rtype", REPORT_TYPES)
    def test_report_consolidated(self, admin_client, rtype):
        r = admin_client.get(f"{API}/reports/{rtype}", timeout=90)
        assert r.status_code in (200, 404), f"{rtype}: {r.status_code} {r.text[:300]}"
        if r.status_code == 200:
            assert isinstance(r.json(), (dict, list))

    @pytest.mark.parametrize("rtype", REPORT_TYPES)
    def test_report_with_location_id(self, admin_client, locations, rtype):
        if not locations:
            pytest.skip("no locations seeded")
        loc = locations[0]["id"]
        r = admin_client.get(f"{API}/reports/{rtype}", params={"location_id": loc}, timeout=90)
        assert r.status_code in (200, 404), f"{rtype}: {r.status_code} {r.text[:300]}"

    def test_report_bogus_location_id(self, admin_client):
        r = admin_client.get(f"{API}/reports/assets", params={"location_id": "nonexistent-loc"}, timeout=90)
        assert r.status_code == 200, r.text[:300]

    def test_reports_forbidden_for_staff(self, staff_client):
        r = staff_client.get(f"{API}/reports/assets", timeout=60)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"


# ── CEO dashboard ─────────────────────────────────────────────────────
class TestCeoDashboard:
    def test_ceo_dashboard(self, admin_client):
        r = admin_client.get(f"{API}/dashboard/ceo", timeout=90)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), dict)

    def test_ceo_dashboard_with_location(self, admin_client, locations):
        if not locations:
            pytest.skip("no locations seeded")
        r = admin_client.get(f"{API}/dashboard/ceo", params={"location_id": locations[0]["id"]}, timeout=90)
        assert r.status_code == 200, r.text[:300]


# ── Assets reports ────────────────────────────────────────────────────
ASSET_REPORT_TYPES = ["register", "utilization", "maintenance", "depreciation"]


class TestAssetReports:
    @pytest.mark.parametrize("rtype", ASSET_REPORT_TYPES)
    def test_asset_report(self, admin_client, rtype):
        r = admin_client.get(f"{API}/assets/reports/{rtype}", timeout=90)
        assert r.status_code in (200, 404), f"{rtype}: {r.status_code} {r.text[:300]}"

    @pytest.mark.parametrize("rtype", ASSET_REPORT_TYPES)
    def test_asset_report_with_location(self, admin_client, locations, rtype):
        if not locations:
            pytest.skip("no locations seeded")
        r = admin_client.get(f"{API}/assets/reports/{rtype}", params={"location_id": locations[0]["id"]}, timeout=90)
        assert r.status_code in (200, 404), f"{rtype}: {r.status_code} {r.text[:300]}"

    def test_assets_list_and_categories(self, admin_client):
        r = admin_client.get(f"{API}/assets", timeout=60)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert isinstance(data, (list, dict))


# ── AMC ───────────────────────────────────────────────────────────────
class TestAMC:
    def test_amc_dashboard(self, admin_client):
        r = admin_client.get(f"{API}/amc/dashboard", timeout=90)
        assert r.status_code == 200, r.text[:300]

    def test_amc_dashboard_with_location(self, admin_client, locations):
        if not locations:
            pytest.skip("no locations seeded")
        r = admin_client.get(f"{API}/amc/dashboard", params={"location_id": locations[0]["id"]}, timeout=90)
        assert r.status_code == 200, r.text[:300]

    def test_recurring_revenue_report(self, admin_client):
        r = admin_client.get(f"{API}/amc/recurring-revenue-report", timeout=90)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), dict)

    def test_recurring_revenue_report_with_location(self, admin_client, locations):
        if not locations:
            pytest.skip("no locations seeded")
        r = admin_client.get(f"{API}/amc/recurring-revenue-report",
                             params={"location_id": locations[0]["id"]}, timeout=90)
        assert r.status_code == 200, r.text[:300]

    def test_amc_contracts_with_location(self, admin_client, locations):
        params = {"location_id": locations[0]["id"]} if locations else {}
        r = admin_client.get(f"{API}/amc/contracts", params=params, timeout=90)
        assert r.status_code == 200, r.text[:300]


# ── Expansion ─────────────────────────────────────────────────────────
class TestExpansion:
    def test_expansion_overview(self, admin_client):
        r = admin_client.get(f"{API}/expansion/overview", timeout=90)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert isinstance(data, dict)


# ── Calculator (Step 4) ───────────────────────────────────────────────
class TestCalculator:
    def test_calc_config(self, admin_client):
        r = admin_client.get(f"{API}/calculate/config", timeout=60)
        assert r.status_code == 200, r.text[:300]
        cfg = r.json()
        assert "cost_per_kwp" in cfg

    def test_inventory_panels(self, admin_client):
        r = admin_client.get(f"{API}/inventory/items", params={"category": "solar_panels"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        items = r.json()
        assert isinstance(items, list)
        assert len(items) > 0, "no solar_panels in inventory_items — panel picker will be empty"
        for it in items[:5]:
            assert "_id" not in it
            assert "id" in it and "name" in it

    def test_inventory_inverters(self, admin_client):
        r = admin_client.get(f"{API}/inventory/items", params={"category": "inverters"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        items = r.json()
        assert len(items) > 0, "no inverters in inventory_items — inverter picker will be empty"

    def test_pump_solution_calc(self, admin_client):
        payload = {
            "system_type": "solar-pump",
            "inputs": {
                "pump_path": "DC",
                "required_flow_lpm": 300,
                "static_water_level_m": 60,
                "bore_casing_diameter_mm": 150,
                "controller_max_voltage": 850,
                "string_voltage_v": 600,
            },
            "overrides": {},
        }
        r = admin_client.post(f"{API}/calculate/solution", json=payload, timeout=90)
        assert r.status_code == 200, r.text[:500]
        body = r.json()
        assert "result" in body
        res = body["result"]
        for key in ("system_size_kw", "pump_hp_selected", "total_cost", "net_cost"):
            assert key in res, f"missing {key} in pump result"
        assert res["system_size_kw"] > 0
        assert res["total_cost"] > 0
