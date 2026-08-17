"""Iteration 44 Phase 2 — guided-flow stages, string-voltage validation, pump ROI-by-replacement."""
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
    # Ensure catalogue is seeded
    s.post(f"{BASE_URL}/api/catalogue/seed", timeout=20)
    return s


def test_ongrid_solution_returns_4_stages(admin_client):
    r = admin_client.post(f"{BASE_URL}/api/calculate/solution", json={
        "system_type": "on-grid", "pincode": "641001",
        "inputs": {"monthly_eb_bill": 3500, "tariff_category": "Domestic", "panel_wattage_w": 540},
    }, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "stages" in data and data["stages"] is not None
    for stage in ("consumption", "sizing", "cost", "savings"):
        assert stage in data["stages"]
        assert len(data["stages"][stage]) >= 1
    # Each line should have the required shape
    line = data["stages"]["sizing"][0]
    assert "label" in line and "operation" in line and "result" in line


def test_pump_solution_returns_stages_and_roi(admin_client):
    r = admin_client.post(f"{BASE_URL}/api/calculate/solution", json={
        "system_type": "solar-pump", "pincode": "641001",
        "inputs": {
            "pump_path": "DC", "water_requirement_lpd": 40000,
            "daily_operating_hours": 6, "static_water_level_m": 30,
            "delivery_head_m": 10, "horizontal_pipe_run_m": 50,
            "pipe_internal_diameter_mm": 63, "bore_casing_diameter_mm": 150,
            "roi_mode": "diesel",
        },
    }, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("stages")
    assert "roi_details" in data
    roi = data["roi_details"]
    assert roi["mode"] == "diesel"
    assert roi["annual_saving"] > 0
    assert roi["fuel"]["name"] == "Diesel"
    # units_per_kwh should be about 0.31 (from fuel_types), NOT the old hardcoded 0.28
    assert 0.25 < roi["fuel"]["units_per_kwh"] < 0.40


def test_pump_zero_tariff_returns_reliability_mode(admin_client):
    """Grid mode with zero tariff should flip to zero_tariff (reliability) without dividing by zero."""
    r = admin_client.post(f"{BASE_URL}/api/calculate/solution", json={
        "system_type": "solar-pump", "pincode": "641001",
        "inputs": {
            "pump_path": "AC", "water_requirement_lpd": 30000,
            "daily_operating_hours": 5, "static_water_level_m": 20,
            "roi_mode": "grid", "existing_ag_tariff": 0,
            "crop_value_per_year": 45000,
        },
    }, timeout=15)
    assert r.status_code == 200
    data = r.json()
    roi = data["roi_details"]
    assert roi["mode"] == "zero_tariff"
    assert roi["annual_saving"] == 45000
    # payback should be finite (not infinity) because annual_saving > 0
    assert data["result"].get("payback_years") is None or data["result"]["payback_years"] > 0


def test_string_voltage_validation_ok_case(admin_client):
    # Get panel and pump ids from seeded catalogue
    panels = admin_client.get(f"{BASE_URL}/api/catalogue/products/panel").json()
    pumps = admin_client.get(f"{BASE_URL}/api/catalogue/products/pump").json()
    panel = next(p for p in panels if p["make"] == "Generic")
    pump = next(p for p in pumps if p["make"] == "Generic")

    r = admin_client.post(f"{BASE_URL}/api/calculate/pump/string-voltage", json={
        "panel_product_id": panel["id"], "pump_product_id": pump["id"],
        "modules_in_series": 6, "strings_in_parallel": 1, "pincode": "641001",
    }, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["errors"] == []
    # Should compute Voc at Tmin correctly
    assert data["site_min_temp_c"] == -10.0
    assert data["string_voc_tmin"] > 6 * data["voc_per_module_at_tmin"] * 0.999


def test_string_voltage_validation_overvolt_blocked(admin_client):
    """12 modules in series should exceed the seeded Generic controller's 450V absolute max."""
    panels = admin_client.get(f"{BASE_URL}/api/catalogue/products/panel").json()
    pumps = admin_client.get(f"{BASE_URL}/api/catalogue/products/pump").json()
    panel = next(p for p in panels if p["make"] == "Generic")
    pump = next(p for p in pumps if p["make"] == "Generic")

    r = admin_client.post(f"{BASE_URL}/api/calculate/pump/string-voltage", json={
        "panel_product_id": panel["id"], "pump_product_id": pump["id"],
        "modules_in_series": 12, "strings_in_parallel": 1, "pincode": "641001",
    }, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is False
    assert any("exceeds controller absolute max" in e for e in data["errors"])
    assert "Reduce modules-in-series to at most" in data["errors"][0]


def test_string_voltage_uses_configurable_tmin(admin_client):
    """Changing the global string_low_temp_default_c should change the validation result."""
    # Set global Tmin to +5°C (warm-climate)
    admin_client.put(f"{BASE_URL}/api/catalogue/config", json={"string_low_temp_default_c": 5}, timeout=15)
    try:
        panels = admin_client.get(f"{BASE_URL}/api/catalogue/products/panel").json()
        pumps = admin_client.get(f"{BASE_URL}/api/catalogue/products/pump").json()
        panel = next(p for p in panels if p["make"] == "Generic")
        pump = next(p for p in pumps if p["make"] == "Generic")

        r = admin_client.post(f"{BASE_URL}/api/calculate/pump/string-voltage", json={
            "panel_product_id": panel["id"], "pump_product_id": pump["id"],
            "modules_in_series": 6, "strings_in_parallel": 1, "pincode": "999999",  # no override
        }, timeout=15)
        data = r.json()
        assert data["site_min_temp_c"] == 5.0
        assert data["delta_t"] == -20.0
    finally:
        admin_client.put(f"{BASE_URL}/api/catalogue/config", json={"string_low_temp_default_c": -10}, timeout=15)


def test_calculate_solution_snapshot_still_intact(admin_client):
    """Verify Iter 38 snapshot behaviour did not break (regression check)."""
    r = admin_client.post(f"{BASE_URL}/api/calculate/solution", json={
        "system_type": "on-grid", "pincode": "641001",
        "inputs": {"monthly_eb_bill": 3500, "tariff_category": "Domestic"},
    }, timeout=15)
    data = r.json()
    assert "snapshot" in data
    assert data["snapshot"]["pincode"] == "641001"
    assert data["snapshot"]["specific_yield_used"] is not None
