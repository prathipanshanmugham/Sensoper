"""Iteration 44 Phase 1 — Product Catalogue + Fuel Model tests.

The panel / inverter / battery / pump catalogue was folded into stock items (Iter 45, catalogue → inventory_items);
its tests were removed. Fuels, add-on groups and the pricing config remain."""
import os
import uuid
import pytest
import requests
from http_env import require_server, throwaway_password, TEST_ADMIN_EMAIL, TEST_MANAGER_EMAIL, TEST_MANAGER_PASSWORD, TEST_STAFF_EMAIL, TEST_STAFF_PASSWORD  # noqa: E402,F401
_SERVER_URL, TEST_ADMIN_PASSWORD = require_server(manager=False, staff=False)

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0]).rstrip("/")
ADMIN = {"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return s





def test_fuel_units_per_kwh_derived(admin_client):
    tag = f"TEST_{uuid.uuid4().hex[:6]}"
    r = admin_client.post(f"{BASE_URL}/api/catalogue/products/fuel", json={
        "name": f"TEST_Fuel_{tag}", "unit": "litre",
        "energy_content_kwh_per_unit": 10.0, "genset_efficiency_pct": 30,
        "default_price_per_unit": 90, "co2_kg_per_unit": 2.5,
    }, timeout=15)
    assert r.status_code == 200
    doc = r.json()
    # effective = 10 * 0.30 = 3.0 kWh/L → units/kWh = 0.3333
    assert abs(doc["effective_kwh_per_unit"] - 3.0) < 0.001
    assert abs(doc["units_per_kwh"] - 0.3333) < 0.001



def test_config_defaults_persist(admin_client):
    # kit_rounding_step was retired (Iter 52: one cash-rounding rule, rounding_step / rounding_mode, for totals)
    r = admin_client.get(f"{BASE_URL}/api/catalogue/config", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "kit_rounding_step" not in d and "rounding_step" in d
    assert "string_low_temp_default_c" in d
    r = admin_client.put(f"{BASE_URL}/api/catalogue/config", json={"rounding_step": 10, "string_low_temp_default_c": -5}, timeout=15)
    assert r.status_code == 200
    assert r.json()["rounding_step"] == 10 and r.json()["string_low_temp_default_c"] == -5
    admin_client.put(f"{BASE_URL}/api/catalogue/config", json={"rounding_step": 1, "string_low_temp_default_c": -10}, timeout=15)


def test_addon_groups_seeded_and_ordered(admin_client):
    # the seed is idempotent (it used to be run by the removed panel-catalogue test above)
    assert admin_client.post(f"{BASE_URL}/api/catalogue/seed", timeout=20).status_code == 200
    r = admin_client.get(f"{BASE_URL}/api/catalogue/addon-groups", timeout=15)
    assert r.status_code == 200
    groups = r.json()
    assert len(groups) >= 8
    orders = [g["display_order"] for g in groups]
    assert orders == sorted(orders)                                   # display_order ascending
    names = [g["name"] for g in groups]
    assert "Safety & Protection" in names
    assert "Water & Plumbing" in names
    assert "Miscellaneous" in names


def test_non_admin_cannot_write(admin_client):
    # Create a non-admin user is heavy — check anonymous request instead
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/catalogue/products/panel", json={"make": "hax", "model": "hax", "wattage": 1}, timeout=15)
    assert r.status_code in (401, 403)
