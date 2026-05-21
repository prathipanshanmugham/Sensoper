"""Iteration 32 backend tests:
- Dashboard conversion-rate math (drafts excluded)
- /api/terms/{id} GET (new endpoint)
- terms_id persistence on projects (POST, GET, PUT)
- /api/terms/{id} DELETE no longer blocks active terms
- Regression: site_electrical validation no longer requires sanction_load_kw / monthly_consumption_units
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": "Admin@123"})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


# --- Dashboard conversion math ---
class TestDashboardConversion:
    def test_stats_excludes_drafts(self, session):
        r = session.get(f"{API}/dashboard/stats")
        assert r.status_code == 200, r.text
        d = r.json()
        # response keys are total, draft, completed, conversion_rate
        for k in ("total", "draft", "completed", "conversion_rate"):
            assert k in d, f"missing {k} in {d.keys()}"
        leads = d["total"] - d["draft"]
        expected = round((d["completed"] / leads) * 100, 1) if leads > 0 else 0
        assert d["conversion_rate"] == expected, (
            f"conversion_rate={d['conversion_rate']} expected={expected} "
            f"(total={d['total']} draft={d['draft']} completed={d['completed']})"
        )
        print(f"stats: total={d['total']} draft={d['draft']} completed={d['completed']} cr={d['conversion_rate']}")

    def test_ceo_excludes_drafts(self, session):
        r = session.get(f"{API}/dashboard/ceo")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "kpis" in d and "sales_funnel" in d
        stats = session.get(f"{API}/dashboard/stats").json()
        expected_leads = stats["total"] - stats["draft"]
        assert d["sales_funnel"]["total_leads"] == expected_leads, (
            f"funnel.total_leads={d['sales_funnel']['total_leads']} expected={expected_leads}"
        )
        cr = d["kpis"]["conversion_rate"]
        assert 0 <= cr <= 100
        print(f"ceo: leads={d['sales_funnel']['total_leads']} kpi.cr={cr}")


# --- Terms endpoints ---
class TestTerms:
    def test_terms_list(self, session):
        r = session.get(f"{API}/terms")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_terms_by_id(self, session):
        all_terms = session.get(f"{API}/terms").json()
        if not all_terms:
            pytest.skip("no terms in DB")
        tid = all_terms[0]["id"]
        r = session.get(f"{API}/terms/{tid}")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("id", "title", "content", "version", "language"):
            assert k in d, f"missing {k}"
        assert d["id"] == tid

    def test_get_terms_invalid_id(self, session):
        r = session.get(f"{API}/terms/not-an-objectid")
        assert r.status_code in (400, 404)

    def test_delete_active_terms_allowed(self, session):
        # create a fresh terms doc, mark active (or default), delete it
        payload = {
            "title": "TEST_ITER32_DEL",
            "content": "delete me",
            "version": "v-test-del",
            "language": "en",
            "is_active": True,
        }
        r = session.post(f"{API}/terms", json=payload)
        assert r.status_code in (200, 201), r.text
        tid = r.json()["id"]
        r2 = session.delete(f"{API}/terms/{tid}")
        assert r2.status_code in (200, 204), f"delete failed: {r2.status_code} {r2.text}"
        # verify gone
        assert session.get(f"{API}/terms/{tid}").status_code == 404


# --- Project terms_id persistence ---
class TestProjectTermsId:
    def _proj_payload(self, terms_id=None):
        p = {
            "customer": {"name": "TEST_ITER32", "phone": "9999999999", "address": "addr"},
            "location": {"address": "addr"},
            "electrical": {
                "sanction_load_kw": 5,
                "connected_load_kw": 5,
                "monthly_consumption_units": 500,
                "eb_tariff": 7,
            },
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540},
            "mounting": {"roof_type": "RCC", "tilt_angle": 10, "structure_type": "fixed"},
            "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
        }
        if terms_id is not None:
            p["terms_id"] = terms_id
        return p

    def test_create_project_with_terms_id(self, session):
        terms = session.get(f"{API}/terms").json()
        if not terms:
            pytest.skip("no terms")
        tid = terms[0]["id"]
        r = session.post(f"{API}/projects", json=self._proj_payload(terms_id=tid))
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        g = session.get(f"{API}/projects/{pid}").json()
        assert g.get("terms_id") == tid, f"persisted terms_id={g.get('terms_id')} expected={tid}"

        if len(terms) > 1:
            tid2 = terms[1]["id"]
            u = session.put(f"{API}/projects/{pid}", json={"terms_id": tid2})
            assert u.status_code == 200, u.text
            assert session.get(f"{API}/projects/{pid}").json().get("terms_id") == tid2

        c = session.put(f"{API}/projects/{pid}", json={"terms_id": ""})
        assert c.status_code == 200, c.text
        cleared = session.get(f"{API}/projects/{pid}").json().get("terms_id")
        assert cleared in (None, ""), f"expected null, got {cleared!r}"

        session.delete(f"{API}/projects/{pid}")


# --- Regression: backend project create still accepts the standard schema ---
class TestSiteElectricalRegression:
    def test_create_and_update_project_without_load_kwargs(self, session):
        """site_electrical frontend step no longer enforces sanction_load_kw/monthly_consumption_units
        but the backend Pydantic ElectricalDetails still requires these fields. This test verifies
        that submitting with default zeros (as the frontend wizard would do) is accepted."""
        payload = {
            "customer": {"name": "TEST_ITER32_SE", "phone": "9999999999", "address": "addr"},
            "location": {"address": "addr"},
            "electrical": {
                "sanction_load_kw": 0,
                "connected_load_kw": 0,
                "monthly_consumption_units": 0,
                "eb_tariff": 0,
            },
            "solar_system": {"system_type": "on-grid"},
            "mounting": {"roof_type": "RCC", "tilt_angle": 0, "structure_type": "fixed"},
            "additional": {"cable_length_meters": 0, "inverter_to_panel_distance": 0, "installation_complexity": "simple"},
        }
        r = session.post(f"{API}/projects", json=payload)
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        session.delete(f"{API}/projects/{pid}")
