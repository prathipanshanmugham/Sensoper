"""Iteration 30 backend regression tests:
 - /api/projects with solar_report round-trips (financials.yearly_breakdown = 25 entries)
 - /api/solar/sizing with irradiation_kwh_m2_day still works
 - /api/projects/{id}/complete still validates drive_link + accepts inverter_login
"""
import os
import pytest
import requests
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://solar-ops-management.preview.emergentagent.com').rstrip('/')
ADMIN_EMAIL = 'admin@sensoper.com'
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD


@pytest.fixture(scope='module')
def session():
    s = requests.Session()
    r = s.post(f'{BASE_URL}/api/auth/login', json={'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD})
    assert r.status_code == 200, f'login failed: {r.status_code} {r.text}'
    return s


@pytest.fixture
def project_payload():
    return {
        "customer": {"name": "TEST_Iter30_SR", "phone": "9876543210", "email": "iter30@x.com", "address": "1 Test St"},
        "location": {"site_address": "1 Test St", "latitude": 13.0, "longitude": 80.2, "state": "TN", "district": "Chennai"},
        "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500,
                       "tariff_category": "Domestic", "connection_type": "Single Phase", "phase": "single",
                       "voltage": 230, "eb_tariff": 6.5},
        "solar_system": {"system_type": "on-grid", "panel_wattage_w": 540, "panel_count": 8, "inverter_capacity_kw": 4},
        "mounting": {"structure_type": "RCC", "roof_type": "rcc", "tilt_angle": 15},
        "additional": {"cable_length_meters": 30, "inverter_to_panel_distance": 5},
        "selected_items": [], "manual_costs": [], "site_images": [],
        "solar_report": {
            "system_overview": {"system_size_kw": 5.0, "panel_count": 9, "inverter_capacity_kw": 5,
                                "total_investment": 350000, "expected_generation_kwh_year": 7300, "co2_offset_tons_year": 5},
            "cost_breakdown": [{"name": "Panels", "value": 200000}, {"name": "Inverter", "value": 80000}],
            "energy_source_mix": [{"name": "Solar", "value": 70}, {"name": "Grid", "value": 30}],
            "monthly_economics": [{"month": "Jan", "generation": 600, "savings": 4000}],
            "savings_projection": [{"year": i, "cumulative_savings": i * 50000} for i in range(1, 26)],
            "financials": {
                "yearly_breakdown": [{"year": i, "savings": 50000 * i, "tariff": 6.5 * (1.025 ** (i - 1))} for i in range(1, 26)]
            },
            "payback_years": 5.2, "roi_percent": 18, "total_savings_25y": 1250000, "monthly_savings_year1": 4500,
        },
    }


class TestSolarReportRoundtrip:
    """POST/GET/PUT a project carrying full solar_report; verify nested data persists."""

    def test_create_get_put_solar_report(self, session, project_payload):
        # CREATE
        r = session.post(f'{BASE_URL}/api/projects', json=project_payload)
        assert r.status_code in (200, 201), r.text
        pid = r.json()['id']
        try:
            # GET
            g = session.get(f'{BASE_URL}/api/projects/{pid}')
            assert g.status_code == 200
            sr = g.json().get('solar_report') or {}
            yb = (sr.get('financials') or {}).get('yearly_breakdown') or []
            assert len(yb) == 25, f'expected 25 yearly_breakdown entries, got {len(yb)}'
            assert sr.get('payback_years') == 5.2
            assert sr.get('total_savings_25y') == 1250000

            # PUT (update)
            updated = project_payload.copy()
            updated['solar_report']['payback_years'] = 6.0
            p = session.put(f'{BASE_URL}/api/projects/{pid}', json=updated)
            assert p.status_code == 200, p.text
            g2 = session.get(f'{BASE_URL}/api/projects/{pid}')
            sr2 = g2.json().get('solar_report') or {}
            assert sr2.get('payback_years') == 6.0
            yb2 = (sr2.get('financials') or {}).get('yearly_breakdown') or []
            assert len(yb2) == 25
        finally:
            session.delete(f'{BASE_URL}/api/projects/{pid}/force')


class TestSolarSizing:
    """/api/solar/sizing still accepts legacy irradiation_kwh_m2_day."""

    def test_sizing_with_irradiation(self, session):
        payload = {
            "monthly_consumption_units": 500,
            "avg_monthly_bill": 3500,
            "tariff_per_unit": 6.5,
            "system_type": "on-grid",
            "irradiation_kwh_m2_day": 5.33,
            "cost_per_kwp": 65000,
            "performance_ratio": 0.75,
            "panel_wattage_w": 540,
        }
        r = session.post(f'{BASE_URL}/api/solar/sizing', json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        # Expect a sensible kwp recommendation for 500 units/month
        sizing = data.get('sizing') or {}
        kwp = sizing.get('kwp_recommended') or data.get('kwp_recommended') or 0
        assert kwp >= 3, f'expected kwp >= 3, got {kwp} ; full={data}'
        # Yearly breakdown should have 25 entries
        yb = (data.get('financials') or {}).get('yearly_breakdown') or []
        assert len(yb) == 25


class TestCompleteProjectRegression:
    """/api/projects/{id}/complete still validates completion_drive_link + accepts inverter_login."""

    def _make_approved(self, session, project_payload):
        r = session.post(f'{BASE_URL}/api/projects', json=project_payload)
        assert r.status_code in (200, 201), r.text
        pid = r.json()['id']
        assert session.put(f'{BASE_URL}/api/projects/{pid}/status', json={'status': 'submitted'}).status_code == 200
        assert session.put(f'{BASE_URL}/api/projects/{pid}/status', json={'status': 'approved'}).status_code == 200
        return pid

    def test_complete_missing_drive_link_400(self, session, project_payload):
        pid = self._make_approved(session, project_payload)
        try:
            r = session.post(f'{BASE_URL}/api/projects/{pid}/complete', json={})
            assert r.status_code == 400, r.text
            assert 'drive' in (r.json().get('detail', '') or '').lower()
        finally:
            session.delete(f'{BASE_URL}/api/projects/{pid}/force')

    def test_complete_valid_with_inverter_login(self, session, project_payload):
        pid = self._make_approved(session, project_payload)
        try:
            body = {
                'completion_drive_link': 'https://drive.google.com/folder/ITER30',
                'inverter_login': {'url': 'https://inv.example.com', 'username': 'admin', 'password': 'p@ss', 'notes': 'WiFi: SolarNet'},
                'customer_feedback': 'Great install',
            }
            r = session.post(f'{BASE_URL}/api/projects/{pid}/complete', json=body)
            assert r.status_code == 200, r.text
            g = session.get(f'{BASE_URL}/api/projects/{pid}')
            data = g.json()
            assert data.get('status') == 'completed'
            assert data.get('completion_drive_link') == body['completion_drive_link']
            il = data.get('inverter_login') or {}
            assert il.get('url') == 'https://inv.example.com'
            assert il.get('username') == 'admin'
            assert il.get('password') == 'p@ss'
            assert il.get('notes') == 'WiFi: SolarNet'
        finally:
            session.delete(f'{BASE_URL}/api/projects/{pid}/force')