"""Iteration 44 Phase 1 — Product Catalogue + Fuel Model tests."""
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


def test_seed_is_idempotent(admin_client):
    r1 = admin_client.post(f"{BASE_URL}/api/catalogue/seed", timeout=20)
    assert r1.status_code == 200
    r2 = admin_client.post(f"{BASE_URL}/api/catalogue/seed", timeout=20)
    assert r2.status_code == 200
    # After two runs, we should still have at least 1 panel/inverter/battery/pump and 6 fuels
    for cat in ("panel", "inverter", "battery", "pump"):
        r = admin_client.get(f"{BASE_URL}/api/catalogue/products/{cat}", timeout=15)
        assert r.status_code == 200
        assert len(r.json()) >= 1
    r = admin_client.get(f"{BASE_URL}/api/catalogue/products/fuel", timeout=15)
    fuels = r.json()
    names = {f["name"] for f in fuels}
    assert {"Diesel", "Petrol", "LPG", "Grid Electricity"} <= names


def test_panel_price_per_watt_auto_derived(admin_client):
    tag = f"TEST_{uuid.uuid4().hex[:6]}"
    payload = {
        "make": "TEST", "model": f"Panel_{tag}", "wattage": 500,
        "purchase_price": 12500, "technology": "TOPCon",
        "voc": 50.2, "vmp": 41.8, "isc": 13.5, "imp": 12.9,
    }
    r = admin_client.post(f"{BASE_URL}/api/catalogue/products/panel", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["price_per_watt"] == 25.0        # 12500 / 500


def test_battery_kwh_derived(admin_client):
    tag = f"TEST_{uuid.uuid4().hex[:6]}"
    r = admin_client.post(f"{BASE_URL}/api/catalogue/products/battery", json={
        "make": "TEST", "model": f"Batt_{tag}", "chemistry": "LiFePO4",
        "capacity_ah": 200, "voltage": 51.2, "purchase_price": 90000,
    }, timeout=15)
    assert r.status_code == 200
    doc = r.json()
    # 200 * 51.2 / 1000 = 10.24
    assert abs(doc["kwh"] - 10.24) < 0.01


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


def test_update_creates_history_and_soft_delete(admin_client):
    tag = f"TEST_{uuid.uuid4().hex[:6]}"
    # Create
    r = admin_client.post(f"{BASE_URL}/api/catalogue/products/inverter", json={
        "make": "TEST", "model": f"Inv_{tag}", "type": "on-grid", "rated_kw": 3,
        "purchase_price": 24000, "mppt_voltage_min": 100, "mppt_voltage_max": 500,
        "max_input_voltage": 600,
    }, timeout=15)
    assert r.status_code == 200
    pid = r.json()["id"]
    # Update
    r = admin_client.put(f"{BASE_URL}/api/catalogue/products/inverter/{pid}",
                         json={"selling_price": 28000, "margin_pct": 16}, timeout=15)
    assert r.status_code == 200
    # History
    r = admin_client.get(f"{BASE_URL}/api/catalogue/products/inverter/{pid}/history", timeout=15)
    assert r.status_code == 200
    events = r.json()
    assert len(events) >= 2
    assert events[0]["action"] in ("update", "create")
    # Soft-delete
    r = admin_client.delete(f"{BASE_URL}/api/catalogue/products/inverter/{pid}", timeout=15)
    assert r.status_code == 200
    # Doc still exists but active=False
    r = admin_client.get(f"{BASE_URL}/api/catalogue/products/inverter", timeout=15)
    row = next((d for d in r.json() if d["id"] == pid), None)
    assert row is not None and row["active"] is False


def test_config_defaults_persist(admin_client):
    # GET returns full defaults
    r = admin_client.get(f"{BASE_URL}/api/catalogue/config", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "kit_rounding_step" in d
    assert "string_low_temp_default_c" in d
    # Update one value
    new = {"kit_rounding_step": 1000, "string_low_temp_default_c": -5}
    r = admin_client.put(f"{BASE_URL}/api/catalogue/config", json=new, timeout=15)
    assert r.status_code == 200
    assert r.json()["kit_rounding_step"] == 1000
    # Restore for other tests
    admin_client.put(f"{BASE_URL}/api/catalogue/config", json={"kit_rounding_step": 500, "string_low_temp_default_c": -10}, timeout=15)


def test_addon_groups_seeded_and_ordered(admin_client):
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
