"""Iteration 28: Full solar_report (with 25 yearly_breakdown entries) round-trip
through MongoDB on /api/projects, and monotonic cumulative check on /api/solar/sizing."""
import os
import pytest
import requests
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://solar-ops-management.preview.emergentagent.com').rstrip('/')
ADMIN_EMAIL = 'admin@sensoper.com'
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD


@pytest.fixture(scope='module')
def auth_session():
    s = requests.Session()
    r = s.post(f'{BASE_URL}/api/auth/login',
               json={'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD})
    assert r.status_code == 200, f'Login failed: {r.status_code} {r.text}'
    return s


def _minimal_project_payload(extra=None):
    payload = {
        "customer": {"name": "TEST_SolarIter28", "phone": "9999988888",
                     "email": "test_iter28@example.com", "address": "1, Test Street, Chennai"},
        "location": {"site_address": "1, Test Street, Chennai", "latitude": 13.08,
                     "longitude": 80.27, "state": "Tamil Nadu", "district": "Chennai"},
        "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4,
                       "monthly_consumption_units": 500, "tariff_category": "Domestic",
                       "connection_type": "Single Phase", "phase": "single",
                       "voltage": 230, "eb_tariff": 6.5},
        "solar_system": {"system_type": "on-grid", "panel_wattage_w": 540,
                         "panel_count": 8, "inverter_capacity_kw": 4},
        "mounting": {"structure_type": "RCC", "roof_type": "rcc", "tilt_angle": 15},
        "additional": {"cable_length_meters": 30, "inverter_to_panel_distance": 5},
        "selected_items": [], "manual_costs": [], "site_images": []
    }
    if extra:
        payload.update(extra)
    return payload


# ============== /api/solar/sizing returns 25-entry yearly_breakdown with monotonic cumulative ==============
class TestSolarSizingYearlyBreakdown:
    SIZING_PAYLOAD = {
        'monthly_consumption_units': 500,
        'sanctioned_load_kw': 5,
        'tariff_category': 'Domestic',
        'connection_type': 'Single Phase',
        'avg_monthly_bill': 3500,
        'irradiation_kwh_m2_day': 5.0,
        'system_type': 'on-grid',
        'panel_wattage_w': 540,
        'cost_per_kwp': 55000,
    }

    def test_sizing_returns_25_yearly_entries(self, auth_session):
        r = auth_session.post(f'{BASE_URL}/api/solar/sizing', json=self.SIZING_PAYLOAD)
        assert r.status_code == 200, r.text
        data = r.json()
        yb = data['financials']['yearly_breakdown']
        assert isinstance(yb, list)
        assert len(yb) == 25, f'expected 25 entries, got {len(yb)}'
        # Each entry has year, generation_units, tariff, savings, cumulative
        for entry in yb:
            assert 'year' in entry and 'cumulative' in entry and 'savings' in entry

    def test_sizing_cumulative_monotonically_increasing(self, auth_session):
        r = auth_session.post(f'{BASE_URL}/api/solar/sizing', json=self.SIZING_PAYLOAD)
        assert r.status_code == 200
        yb = r.json()['financials']['yearly_breakdown']
        prev = -1
        for i, entry in enumerate(yb):
            cur = entry['cumulative']
            assert cur >= prev, f'Cumulative not monotonic at year {i+1}: {cur} < prev {prev}'
            prev = cur
        # Last entry cumulative should equal total_25yr_savings approximately
        last_cum = yb[-1]['cumulative']
        total_25 = r.json()['financials']['total_25yr_savings']
        assert abs(last_cum - total_25) < 2, f'last cum {last_cum} vs total_25 {total_25}'

    def test_sizing_year1_year25_positive_savings(self, auth_session):
        r = auth_session.post(f'{BASE_URL}/api/solar/sizing', json=self.SIZING_PAYLOAD)
        yb = r.json()['financials']['yearly_breakdown']
        assert yb[0]['savings'] > 0
        assert yb[-1]['savings'] > 0
        # Year-25 savings should be > year-1 because tariff escalation outweighs degradation
        assert yb[-1]['savings'] > yb[0]['savings']
        # year sequence 1..25
        assert yb[0]['year'] == 1
        assert yb[-1]['year'] == 25


# ============== Full solar_report dict round-trip ==============
class TestSolarReportRoundtrip:
    project_id = None

    def _build_full_solar_report(self):
        yearly = []
        cum = 0
        for i in range(25):
            saving = 40000 * (1.025 ** i) * ((1 - 0.007) ** i)
            cum += saving
            yearly.append({
                'year': i + 1,
                'generation_units': 6000 * ((1 - 0.007) ** i),
                'tariff': 7.0 * (1.025 ** i),
                'savings': saving,
                'cumulative': cum,
            })
        return {
            'consumer': {
                'service_number': '012345678901', 'phone': '9876543210',
                'consumer_name': 'TEST_FullRoundtrip', 'address': 'TEST address',
                'tariff_category': 'Domestic', 'connection_type': 'Single Phase',
                'sanctioned_load_kw': 5.0, 'avg_monthly_consumption': 500,
                'avg_monthly_bill': 3500,
            },
            'site': {'lat': 13.08, 'lng': 80.27, 'irradiation_kwh_m2_day': 5.0},
            'sizing': {
                'kwp_recommended': 4.0, 'num_panels': 8, 'panel_wattage_w': 540,
                'inverter_capacity_kw': 4.0, 'system_type': 'on-grid',
            },
            'financials': {
                'total_cost': 220000, 'subsidy': 78000, 'net_cost': 142000,
                'annual_savings': 42000, 'monthly_savings': 3500,
                'payback_years': 3.4, 'total_25yr_savings': 1200000,
                'roi_pct': 745.0, 'yearly_breakdown': yearly,
            },
            'technical': {
                'performance_ratio': 0.78, 'cuf_pct': 17.1,
                'annual_generation_units': 6000, 'co2_offset_kg_per_year': 4800,
            },
        }

    def test_create_project_with_full_solar_report(self, auth_session):
        payload = _minimal_project_payload({'solar_report': self._build_full_solar_report()})
        r = auth_session.post(f'{BASE_URL}/api/projects', json=payload)
        assert r.status_code in (200, 201), f'{r.status_code} {r.text[:500]}'
        data = r.json()
        assert 'id' in data
        TestSolarReportRoundtrip.project_id = data['id']
        # POST may or may not echo solar_report (depends on response model); we verify persistence via GET in next test
        sr = data.get('solar_report')
        if sr is not None:
            assert sr['sizing']['kwp_recommended'] == 4.0
            assert len(sr['financials']['yearly_breakdown']) == 25
        # Mongo _id must NOT leak
        assert '_id' not in data, '_id leaked into project response'

    def test_get_project_returns_intact_solar_report(self, auth_session):
        assert TestSolarReportRoundtrip.project_id, 'create must run first'
        r = auth_session.get(f'{BASE_URL}/api/projects/{TestSolarReportRoundtrip.project_id}')
        assert r.status_code == 200, r.text
        data = r.json()
        sr = data.get('solar_report')
        assert sr is not None, 'solar_report not persisted'
        assert sr['consumer']['consumer_name'] == 'TEST_FullRoundtrip'
        assert sr['sizing']['kwp_recommended'] == 4.0
        assert sr['financials']['total_cost'] == 220000
        assert sr['financials']['subsidy'] == 78000
        assert sr['financials']['net_cost'] == 142000
        yb = sr['financials']['yearly_breakdown']
        assert len(yb) == 25, f'yearly_breakdown lost entries: {len(yb)}'
        assert yb[0]['year'] == 1
        assert yb[24]['year'] == 25
        assert '_id' not in data
        assert '_id' not in sr

    @classmethod
    def teardown_class(cls):
        if cls.project_id:
            s = requests.Session()
            s.post(f'{BASE_URL}/api/auth/login',
                   json={'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD})
            try:
                s.delete(f'{BASE_URL}/api/projects/{cls.project_id}')
            except Exception:
                pass


# ============== Regression ==============
class TestRegression:
    def test_auth_me(self, auth_session):
        assert auth_session.get(f'{BASE_URL}/api/auth/me').status_code == 200

    def test_accounts_list(self, auth_session):
        assert auth_session.get(f'{BASE_URL}/api/accounts').status_code == 200