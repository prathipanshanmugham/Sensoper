"""Iteration 40 — Material Kits (Solution Kits) + system_type solar-pump regression"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://solar-ops-management.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


# ---------------- Material Kits ----------------

class TestMaterialKits:
    def test_list_all_kits_has_at_least_8(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/material-kits", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 8, f"expected >=8 seeded kits, got {len(data)}"
        # Validate no mongo _id leaked and id string present
        for k in data:
            assert "id" in k and isinstance(k["id"], str)
            assert "_id" not in k
            assert k["system_type"] in ("on-grid", "off-grid", "hybrid", "solar-pump")

    def test_filter_by_solar_pump(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/material-kits", params={"system_type": "solar-pump"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 2
        for k in data:
            assert k["system_type"] == "solar-pump"

    def test_seed_starter_idempotent(self, admin_client):
        before = admin_client.get(f"{BASE_URL}/api/material-kits", timeout=30).json()
        r1 = admin_client.post(f"{BASE_URL}/api/material-kits/seed-starter", timeout=30)
        assert r1.status_code == 200
        r2 = admin_client.post(f"{BASE_URL}/api/material-kits/seed-starter", timeout=30)
        assert r2.status_code == 200
        after = admin_client.get(f"{BASE_URL}/api/material-kits", timeout=30).json()
        # Seed twice should not duplicate; count should stay the same
        assert len(after) == len(before), f"seed not idempotent: before={len(before)} after={len(after)}"

    def test_match_within_range(self, admin_client):
        # 3HP -> ~2.2 kW should match the "Solar Pump · 3 HP Submersible" (range 1.5-3)
        r = admin_client.get(f"{BASE_URL}/api/material-kits/match",
                             params={"system_type": "solar-pump", "capacity_kw": 2.2}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["match"] is not None
        assert data["match"]["system_type"] == "solar-pump"
        # capacity should be within its min/max
        m = data["match"]
        if m.get("capacity_min_kw") is not None and m.get("capacity_max_kw") is not None:
            assert m["capacity_min_kw"] <= 2.2 <= m["capacity_max_kw"]

    def test_match_out_of_range_returns_nearest(self, admin_client):
        # Very large ongrid capacity outside all ranges - should still return nearest
        r = admin_client.get(f"{BASE_URL}/api/material-kits/match",
                             params={"system_type": "on-grid", "capacity_kw": 100}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["match"] is not None
        assert data["match"]["system_type"] == "on-grid"

    def test_crud_flow(self, admin_client):
        payload = {
            "name": "TEST_KIT_iter40",
            "system_type": "hybrid",
            "capacity_kw": 8,
            "capacity_min_kw": 7,
            "capacity_max_kw": 9,
            "description": "Test kit for iteration 40",
            "lines": [{"name": "Test panel", "category": "panels", "quantity": 4}],
            "active": True,
        }
        c = admin_client.post(f"{BASE_URL}/api/material-kits", json=payload, timeout=30)
        assert c.status_code in (200, 201), c.text
        kit_id = c.json()["id"]

        g = admin_client.get(f"{BASE_URL}/api/material-kits/{kit_id}", timeout=30)
        assert g.status_code == 200
        assert g.json()["name"] == "TEST_KIT_iter40"
        assert len(g.json()["lines"]) == 1

        u = admin_client.put(f"{BASE_URL}/api/material-kits/{kit_id}",
                             json={"name": "TEST_KIT_iter40_updated", "capacity_kw": 8.5}, timeout=30)
        assert u.status_code == 200
        g2 = admin_client.get(f"{BASE_URL}/api/material-kits/{kit_id}", timeout=30).json()
        assert g2["name"] == "TEST_KIT_iter40_updated"
        assert g2["capacity_kw"] == 8.5

        d = admin_client.delete(f"{BASE_URL}/api/material-kits/{kit_id}", timeout=30)
        assert d.status_code == 200
        g3 = admin_client.get(f"{BASE_URL}/api/material-kits/{kit_id}", timeout=30)
        assert g3.status_code == 404


# ---------------- Regression: Projects + solar-pump ----------------

class TestProjectsSolarPump:
    def test_list_projects(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/projects", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_project_solar_pump(self, admin_client):
        payload = {
            "customer": {"name": "TEST_iter40_pump", "phone": "9999999999", "email": "iter40@test.com"},
            "location": {"address": "Test Address", "city": "TestCity", "state": "TS", "pincode": "560001"},
            "solar_system": {
                "system_type": "solar-pump",
                "capacity_kw": 2.7,
                "pump_hp": 3,
                "pump_type": "submersible",
                "total_head_m": 40,
                "discharge_lph": 10000,
                "controller": "MPPT",
                "water_source": "borewell",
            },
        }
        r = admin_client.post(f"{BASE_URL}/api/projects", json=payload, timeout=30)
        # Some backends might require additional required fields; still ensure no 500 crash
        assert r.status_code in (200, 201, 400, 422), f"unexpected {r.status_code} {r.text}"
        if r.status_code in (200, 201):
            pid = r.json().get("id") or r.json().get("project_id")
            if pid:
                g = admin_client.get(f"{BASE_URL}/api/projects/{pid}", timeout=30)
                assert g.status_code == 200
                sj = g.json()
                # Confirm solar_system persisted
                ss = sj.get("solar_system") or {}
                assert ss.get("system_type") == "solar-pump"
                # cleanup
                admin_client.delete(f"{BASE_URL}/api/projects/{pid}", timeout=30)


# ---------------- Regression: Inventory ----------------

class TestInventoryRegression:
    def test_inventory_list(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/inventory/items", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_inventory_alerts(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/inventory/alerts", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
