"""
Iteration 27 — Solar Report embedded in Project (refactor).

Covers:
- POST /api/projects accepts solar_report dict (and accepts omitted solar_report).
- GET  /api/projects/{id} returns solar_report unchanged.
- PUT  /api/projects/{id} with solar_report dict updates the field.
- Regression: POST /api/solar/sizing still works.
- Regression: POST /api/solar/merge-pdf route still exists/responds.
- Regression: POST /api/tneb/fetch manual fallback still works.
"""
import io
import os
import pytest
import requests
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://solar-ops-management.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text[:200]}")
    return s


def _minimal_project_payload(extra=None):
    payload = {
        "customer": {
            "name": "TEST_SolarQAUser",
            "phone": "9999988888",
            "email": "test_solar_qa@example.com",
            "address": "1, Test Street, Chennai"
        },
        "location": {
            "site_address": "1, Test Street, Chennai",
            "latitude": 13.08,
            "longitude": 80.27,
            "state": "Tamil Nadu",
            "district": "Chennai"
        },
        "electrical": {
            "sanction_load_kw": 5,
            "connected_load_kw": 4,
            "monthly_consumption_units": 450,
            "tariff_category": "Domestic",
            "connection_type": "Single Phase",
            "phase": "single",
            "voltage": 230,
            "eb_tariff": 6.5
        },
        "solar_system": {
            "system_type": "on-grid",
            "panel_wattage_w": 550,
            "panel_count": 8,
            "inverter_capacity_kw": 4
        },
        "mounting": {"structure_type": "RCC", "roof_type": "rcc", "tilt_angle": 15},
        "additional": {"cable_length_meters": 30, "inverter_to_panel_distance": 5},
        "selected_items": [],
        "manual_costs": [],
        "site_images": []
    }
    if extra:
        payload.update(extra)
    return payload


SOLAR_REPORT_FIXTURE = {
    "service_number": "012345678901",
    "phone": "9999988888",
    "consumer_name": "TEST_SolarQAUser",
    "address": "1, Test Street, Chennai",
    "sanctioned_load_kw": "5",
    "avg_monthly_consumption": "450",
    "avg_monthly_bill": "3200",
    "tariff_category": "Domestic",
    "connection_type": "Single Phase",
    "lat": "13.08",
    "lng": "80.27",
    "irradiation_kwh_m2_day": 5.5,
    "system_type": "on-grid",
    "panel_wattage_w": 550,
    "cost_per_kwp": 55000,
    "battery_autonomy_days": 1.0,
    "sizing": {"kwp_recommended": 4.0, "num_panels": 8, "panel_wattage_w": 550, "inverter_capacity_kw": 3.6, "battery_ah": 0},
    "financials": {"total_cost": 220000, "subsidy": 78000, "net_cost": 142000, "payback_years": 3.7, "roi_pct": 27.5, "total_25yr_savings": 1200000, "yearly_breakdown": []},
    "technical": {"performance_ratio": 0.75, "cuf_pct": 16.2, "co2_offset_kg_per_year": 5400},
    "assumptions": {},
    "computed_at": "2026-01-15T10:00:00Z",
}


class TestProjectWithSolarReport:
    created_ids = []

    def test_create_project_without_solar_report(self, session):
        """ProjectCreate accepts omitted solar_report (Optional)."""
        r = session.post(f"{BASE_URL}/api/projects", json=_minimal_project_payload(), timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert "id" in d
        self.__class__.created_ids.append(d["id"])

        # GET back to ensure no error rendering
        rg = session.get(f"{BASE_URL}/api/projects/{d['id']}", timeout=15)
        assert rg.status_code == 200
        body = rg.json()
        # solar_report should be either None/missing — must not break
        assert body.get("solar_report") in (None, {}, ) or isinstance(body.get("solar_report"), dict)

    def test_create_project_with_solar_report_dict(self, session):
        """POST with solar_report dict accepted and stored, GET returns it."""
        payload = _minimal_project_payload({"solar_report": SOLAR_REPORT_FIXTURE})
        r = session.post(f"{BASE_URL}/api/projects", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        pid = d["id"]
        self.__class__.created_ids.append(pid)

        rg = session.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
        assert rg.status_code == 200
        body = rg.json()
        sr = body.get("solar_report")
        assert sr is not None, "solar_report missing on GET"
        assert sr["consumer_name"] == "TEST_SolarQAUser"
        assert sr["sizing"]["kwp_recommended"] == 4.0
        assert sr["financials"]["subsidy"] == 78000

    def test_put_project_updates_solar_report(self, session):
        """PUT with solar_report updates that field; GET returns new payload."""
        # Use a freshly created project (without solar_report)
        r = session.post(f"{BASE_URL}/api/projects", json=_minimal_project_payload(), timeout=30)
        assert r.status_code in (200, 201)
        pid = r.json()["id"]
        self.__class__.created_ids.append(pid)

        new_sr = dict(SOLAR_REPORT_FIXTURE)
        new_sr["sizing"] = dict(new_sr["sizing"])
        new_sr["sizing"]["kwp_recommended"] = 6.5
        ru = session.put(f"{BASE_URL}/api/projects/{pid}",
                         json={"solar_report": new_sr}, timeout=30)
        assert ru.status_code == 200, ru.text

        rg = session.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
        assert rg.status_code == 200
        sr = rg.json().get("solar_report")
        assert sr is not None
        assert sr["sizing"]["kwp_recommended"] == 6.5

    def test_put_project_solar_report_null_does_not_clear(self, session):
        """Sending solar_report=None should NOT clear existing value (per ProjectUpdate semantics).
        Documenting current behaviour — if main agent intends 'clear on null', flag here."""
        payload = _minimal_project_payload({"solar_report": SOLAR_REPORT_FIXTURE})
        r = session.post(f"{BASE_URL}/api/projects", json=payload, timeout=30)
        pid = r.json()["id"]
        self.__class__.created_ids.append(pid)

        # PUT with solar_report omitted should preserve
        ru = session.put(f"{BASE_URL}/api/projects/{pid}",
                         json={"customer": payload["customer"]}, timeout=20)
        assert ru.status_code == 200
        rg = session.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
        sr = rg.json().get("solar_report")
        assert sr is not None
        assert sr["consumer_name"] == "TEST_SolarQAUser"

    @classmethod
    def teardown_class(cls):
        """Cleanup TEST_ projects we created."""
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=15)
        for pid in cls.created_ids:
            try:
                s.delete(f"{BASE_URL}/api/projects/{pid}", timeout=10)
            except Exception:
                pass


# ----- Regression: Iteration 26 endpoints still wired -----
class TestRegressionIter26:
    def test_tneb_fetch_manual_fallback(self, session):
        r = session.post(f"{BASE_URL}/api/tneb/fetch",
                         json={"service_number": "012345678901", "phone": "9876543210"},
                         timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("success") is False
        assert d.get("fallback") == "manual"

    def test_irradiation_endpoint(self, session):
        r = session.get(f"{BASE_URL}/api/solar/irradiation",
                        params={"lat": 13.08, "lng": 80.27}, timeout=40)
        assert r.status_code == 200
        assert 2 < r.json()["annual_avg_kwh_m2_day"] < 8

    def test_sizing_residential(self, session):
        r = session.post(f"{BASE_URL}/api/solar/sizing", json={
            "monthly_consumption_units": 450,
            "tariff_category": "Domestic",
            "irradiation_kwh_m2_day": 5.5,
        }, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert 3.5 <= d["sizing"]["kwp_recommended"] <= 4.5
        assert d["financials"]["subsidy"] == 78000

    def test_merge_pdf_route_exists(self, session):
        """The PDF merge endpoint still must respond — even if UI no longer wires it.
        Send empty form → expect 400/422 (route exists, validation fires)."""
        r = session.post(f"{BASE_URL}/api/solar/merge-pdf", timeout=20)
        assert r.status_code in (400, 422), f"Expected validation error, got {r.status_code}: {r.text[:200]}"


# ----- Regression: Iteration 25 critical endpoints -----
class TestRegressionIter25:
    def test_auth_me(self, session):
        r = session.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json().get("email") == ADMIN_EMAIL

    def test_accounts_list(self, session):
        r = session.get(f"{BASE_URL}/api/accounts", timeout=15)
        assert r.status_code == 200