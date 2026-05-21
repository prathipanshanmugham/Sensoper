"""Iteration 29: Project completion new schema — drive link + inverter login,
backward-compat with legacy completion_media, custom_fields.proposed_solution
persistence, and ProjectResponse echoing new fields.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
ADMIN_EMAIL = 'admin@sensoper.com'
ADMIN_PASSWORD = 'Admin@123'


@pytest.fixture(scope='module')
def auth_session():
    s = requests.Session()
    r = s.post(f'{BASE_URL}/api/auth/login',
               json={'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD})
    assert r.status_code == 200, f'Login failed: {r.status_code} {r.text}'
    return s


def _minimal_project_payload(name_suffix=''):
    return {
        "customer": {"name": f"TEST_Iter29{name_suffix}", "phone": "9999988888",
                     "email": "test_iter29@example.com",
                     "address": "1, Test Street, Chennai"},
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


def _create_and_approve(session, suffix=''):
    """Create a project as admin, transition draft -> submitted -> approved.
    Returns the project_id of an approved project."""
    payload = _minimal_project_payload(suffix)
    r = session.post(f'{BASE_URL}/api/projects', json=payload)
    assert r.status_code in (200, 201), f'Create failed: {r.status_code} {r.text}'
    pid = r.json()['id']
    # submit
    r = session.put(f'{BASE_URL}/api/projects/{pid}/status',
                    json={'status': 'submitted'})
    assert r.status_code == 200, f'Submit failed: {r.status_code} {r.text}'
    # approve
    r = session.put(f'{BASE_URL}/api/projects/{pid}/status',
                    json={'status': 'approved'})
    assert r.status_code == 200, f'Approve failed: {r.status_code} {r.text}'
    return pid


# ============== POST /api/projects/{id}/complete — new schema validation ==============
class TestCompleteValidation:
    def test_missing_drive_link_returns_400(self, auth_session):
        pid = _create_and_approve(auth_session, '_missing')
        try:
            r = auth_session.post(f'{BASE_URL}/api/projects/{pid}/complete', json={})
            assert r.status_code == 400, f'Expected 400 got {r.status_code} {r.text}'
            detail = r.json().get('detail', '')
            assert 'Drive link' in detail, f'Unexpected error: {detail}'
        finally:
            auth_session.delete(f'{BASE_URL}/api/projects/{pid}')

    def test_invalid_url_returns_400(self, auth_session):
        pid = _create_and_approve(auth_session, '_badurl')
        try:
            r = auth_session.post(
                f'{BASE_URL}/api/projects/{pid}/complete',
                json={'completion_drive_link': 'not-a-url'})
            assert r.status_code == 400, f'Expected 400 got {r.status_code} {r.text}'
            detail = r.json().get('detail', '')
            assert 'valid URL' in detail, f'Unexpected error: {detail}'
        finally:
            auth_session.delete(f'{BASE_URL}/api/projects/{pid}')

    def test_valid_drive_link_and_inverter_login_completes(self, auth_session):
        pid = _create_and_approve(auth_session, '_valid')
        try:
            inv = {'url': 'https://app.inverter.com', 'username': 'admin@test.com',
                   'password': 'S3cret!', 'notes': 'Wifi: TestNet'}
            r = auth_session.post(
                f'{BASE_URL}/api/projects/{pid}/complete',
                json={'completion_drive_link': 'https://drive.google.com/drive/folders/abc123',
                      'inverter_login': inv,
                      'customer_feedback': 'Very satisfied'})
            assert r.status_code == 200, f'Complete failed: {r.status_code} {r.text}'

            # GET project — verify persistence
            g = auth_session.get(f'{BASE_URL}/api/projects/{pid}')
            assert g.status_code == 200
            data = g.json()
            assert data['status'] == 'completed'
            assert data['completion_drive_link'] == \
                'https://drive.google.com/drive/folders/abc123'
            il = data.get('inverter_login') or {}
            assert il.get('url') == inv['url']
            assert il.get('username') == inv['username']
            assert il.get('password') == inv['password']
            assert il.get('notes') == inv['notes']
            assert data.get('customer_feedback') == 'Very satisfied'
        finally:
            auth_session.delete(f'{BASE_URL}/api/projects/{pid}')


# ============== Backward compat — legacy completion_media still works ==============
class TestCompleteBackwardCompat:
    def test_legacy_completion_media_only(self, auth_session):
        pid = _create_and_approve(auth_session, '_legacy')
        try:
            media = [{'url': 'https://example.com/photo1.jpg', 'type': 'image'}]
            r = auth_session.post(
                f'{BASE_URL}/api/projects/{pid}/complete',
                json={'completion_media': media,
                      'customer_feedback': 'Looks good'})
            assert r.status_code == 200, f'Legacy complete failed: {r.status_code} {r.text}'

            g = auth_session.get(f'{BASE_URL}/api/projects/{pid}')
            assert g.status_code == 200
            data = g.json()
            assert data['status'] == 'completed'
            assert data.get('completion_media') == media
            # drive link should be empty default
            assert data.get('completion_drive_link', '') == ''
        finally:
            auth_session.delete(f'{BASE_URL}/api/projects/{pid}')


# ============== GET /api/projects — new fields present with defaults ==============
class TestProjectListResponseFields:
    def test_get_project_has_completion_fields_with_defaults(self, auth_session):
        payload = _minimal_project_payload('_listdefaults')
        r = auth_session.post(f'{BASE_URL}/api/projects', json=payload)
        assert r.status_code in (200, 201)
        pid = r.json()['id']
        try:
            g = auth_session.get(f'{BASE_URL}/api/projects/{pid}')
            assert g.status_code == 200
            data = g.json()
            assert 'completion_drive_link' in data, 'completion_drive_link missing'
            assert 'inverter_login' in data, 'inverter_login missing'
            assert data['completion_drive_link'] == ''
            assert data['inverter_login'] == {}
        finally:
            auth_session.delete(f'{BASE_URL}/api/projects/{pid}')


# ============== custom_fields.proposed_solution persistence ==============
class TestProposedSolutionPersistence:
    def test_proposed_solution_round_trip(self, auth_session):
        payload = _minimal_project_payload('_proposed')
        payload['custom_fields'] = {
            'proposed_solution': {
                'system_kw': '5',
                'panel_count': '10',
                'inverter_kw': '5',
                'panel_area': '215',
                'notes': 'Optimum tilt 15deg'
            }
        }
        r = auth_session.post(f'{BASE_URL}/api/projects', json=payload)
        assert r.status_code in (200, 201), r.text
        pid = r.json()['id']
        try:
            g = auth_session.get(f'{BASE_URL}/api/projects/{pid}')
            assert g.status_code == 200
            data = g.json()
            ps = (data.get('custom_fields') or {}).get('proposed_solution') or {}
            assert ps.get('system_kw') == '5'
            assert ps.get('panel_count') == '10'
            assert ps.get('inverter_kw') == '5'
            assert ps.get('panel_area') == '215'
            assert ps.get('notes') == 'Optimum tilt 15deg'
        finally:
            auth_session.delete(f'{BASE_URL}/api/projects/{pid}')
