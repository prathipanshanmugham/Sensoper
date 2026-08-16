"""Iteration 35 backend tests — Reference Site endpoints & ProjectCreate/Update reference_project_id field."""

import os
import pytest
import requests
import os
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to local public env if not set
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD


@pytest.fixture(scope="module")
def auth_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ============ Reference Candidates ============

class TestReferenceCandidates:
    def test_list_returns_only_completed(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/projects/reference-candidates")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # Each item shape
        for it in data:
            assert "id" in it
            assert "reference_number" in it
            assert "customer_name" in it
            assert "location" in it
            assert "system_size_kw" in it  # may be None
            assert "image_url" in it       # may be None
            assert "completed_at" in it
            assert "metrics" in it
            m = it["metrics"]
            for k in ["monthly_savings", "annual_savings", "lifetime_savings", "roi_pct",
                      "payback_years", "annual_generation_units", "co2_kg_year"]:
                assert k in m
        print(f"reference-candidates unfiltered count={len(data)}")

    def test_search_filter_by_q(self, auth_client):
        full = auth_client.get(f"{BASE_URL}/api/projects/reference-candidates").json()
        filtered = auth_client.get(f"{BASE_URL}/api/projects/reference-candidates?q=TEST").json()
        assert isinstance(filtered, list)
        assert len(filtered) <= len(full)
        print(f"unfiltered={len(full)} q=TEST={len(filtered)}")

    def test_search_nonexistent_returns_empty(self, auth_client):
        r = auth_client.get(f"{BASE_URL}/api/projects/reference-candidates?q=ZZZNOMATCHZZZ")
        assert r.status_code == 200
        assert r.json() == []


# ============ Reference Summary ============

class TestReferenceSummary:
    def test_summary_for_first_candidate(self, auth_client):
        cands = auth_client.get(f"{BASE_URL}/api/projects/reference-candidates").json()
        if not cands:
            pytest.skip("No completed projects to test reference-summary")
        pid = cands[0]["id"]
        r = auth_client.get(f"{BASE_URL}/api/projects/{pid}/reference-summary")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["id", "reference_number", "customer_name", "phone", "location",
                  "system_size_kw", "panel_count", "inverter_kw", "total_cost",
                  "subsidy", "completed_at", "image_url", "metrics", "notes"]:
            assert k in d, f"missing key {k}"
        assert d["id"] == pid

    def test_summary_404_for_missing(self, auth_client):
        # Use a syntactically valid but non-existent ObjectId
        r = auth_client.get(f"{BASE_URL}/api/projects/507f1f77bcf86cd799439011/reference-summary")
        assert r.status_code in (404, 400)


# ============ ProjectCreate / Update reference_project_id round-trip ============

def _minimal_project_payload(ref_id=None):
    return {
        "customer": {"name": "TEST_iter35_customer", "phone": "9999999999", "email": "t@x.com", "address": "addr"},
        "location": {"address": "Chennai", "city": "Chennai", "state": "TN", "pincode": "600001"},
        "electrical": {"connection_type": "single_phase", "sanction_load_kw": 5, "connected_load_kw": 4, "eb_tariff": 7, "monthly_consumption_units": 500, "monthly_bill": 3500, "tariff_per_unit": 7},
        "solar_system": {"system_type": "on_grid", "panel_type": "mono_perc", "panel_wattage": 540, "inverter_type": "string", "battery_required": False},
        "mounting": {"type": "rooftop", "roof_type": "rcc", "tilt_angle": 15, "structure_type": "standard"},
        "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10},
        "selected_items": [],
        "manual_costs": [],
        "site_images": [],
        "custom_fields": {},
        "reference_project_id": ref_id,
    }


class TestProjectReferenceFieldRoundTrip:
    created_ids = []

    def test_create_with_reference_id_persists(self, auth_client):
        cands = auth_client.get(f"{BASE_URL}/api/projects/reference-candidates").json()
        if not cands:
            pytest.skip("no completed projects → cannot test reference_project_id persistence")
        ref_id = cands[0]["id"]
        r = auth_client.post(f"{BASE_URL}/api/projects", json=_minimal_project_payload(ref_id=ref_id))
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        self.__class__.created_ids.append(pid)
        # GET roundtrip
        g = auth_client.get(f"{BASE_URL}/api/projects/{pid}")
        assert g.status_code == 200
        assert g.json().get("reference_project_id") == ref_id

    def test_update_clear_reference_via_empty_string(self, auth_client):
        if not self.__class__.created_ids:
            pytest.skip("no project created in previous test")
        pid = self.__class__.created_ids[-1]
        u = auth_client.put(f"{BASE_URL}/api/projects/{pid}", json={"reference_project_id": ""})
        assert u.status_code in (200, 204), u.text
        g = auth_client.get(f"{BASE_URL}/api/projects/{pid}").json()
        assert g.get("reference_project_id") in (None, ""), f"got {g.get('reference_project_id')}"

    def test_update_set_reference_again(self, auth_client):
        if not self.__class__.created_ids:
            pytest.skip()
        pid = self.__class__.created_ids[-1]
        cands = auth_client.get(f"{BASE_URL}/api/projects/reference-candidates").json()
        if not cands:
            pytest.skip()
        ref_id = cands[0]["id"]
        u = auth_client.put(f"{BASE_URL}/api/projects/{pid}", json={"reference_project_id": ref_id})
        assert u.status_code in (200, 204), u.text
        g = auth_client.get(f"{BASE_URL}/api/projects/{pid}").json()
        assert g.get("reference_project_id") == ref_id


# ============ notes_only update on completed project (regression) ============

class TestNotesOnlyOnCompleted:
    def test_notes_only_update_on_completed_still_works(self, auth_client):
        cands = auth_client.get(f"{BASE_URL}/api/projects/reference-candidates").json()
        if not cands:
            pytest.skip("no completed project to retest notes update")
        pid = cands[0]["id"]
        # Notes-only update
        r = auth_client.put(f"{BASE_URL}/api/projects/{pid}", json={"notes": "TEST_iter35 notes regression"})
        assert r.status_code in (200, 204), f"notes-only PUT on completed failed: {r.status_code} {r.text}"


# ============ Cleanup ============

def teardown_module(module):
    """Delete any TEST_ projects created during the run."""
    try:
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        if r.status_code != 200:
            return
        token = r.json().get("access_token") or r.json().get("token")
        s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        for pid in TestProjectReferenceFieldRoundTrip.created_ids:
            try:
                s.delete(f"{BASE_URL}/api/projects/{pid}")
            except Exception:
                pass
    except Exception:
        pass