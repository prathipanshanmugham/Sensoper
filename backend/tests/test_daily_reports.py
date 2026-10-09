"""Daily reports (one per person per day) + site diary (one per project per day).

Run against a live server:  REACT_APP_BACKEND_URL=http://localhost:8001 pytest tests/test_daily_reports.py
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
ADMIN = {"email": os.environ.get("ADMIN_EMAIL", "admin@sensoper.com"), "password": os.environ.get("ADMIN_PASSWORD", "Admin@123")}
TAG = uuid.uuid4().hex[:6]
TODAY = date.today().isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()


def _session(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin():
    return _session(ADMIN)


def _make_user(admin, role, n=1):
    email = f"dr_{role}{n}_{TAG}@example.com"
    r = admin.post(f"{API}/users", json={"email": email, "password": "Passw0rd!x", "name": f"DR {role.title()} {n} {TAG}", "role": role}, timeout=30)
    assert r.status_code in (200, 201), r.text
    return _session({"email": email, "password": "Passw0rd!x"}), r.json().get("id")


@pytest.fixture(scope="module")
def staff(admin):
    return _make_user(admin, "staff")


@pytest.fixture(scope="module")
def staff2(admin):
    return _make_user(admin, "staff", 2)


@pytest.fixture(scope="module")
def project_id(admin):
    payload = {
        "customer": {"name": f"DR Customer {TAG}", "phone": "9000000000", "address": "Erode"},
        "location": {"district": "Erode", "state": "Tamil Nadu"},
        "electrical": {"sanction_load_kw": 4, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 6.5},
        "solar_system": {"system_type": "on-grid"},
        "mounting": {"roof_type": "RCC", "tilt_angle": 10, "structure_type": "GI"},
        "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 5},
    }
    r = admin.post(f"{API}/projects", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


REPORT = {
    "leads": {"total_leads": 4, "qualified_leads": 2, "site_visits": 1, "quotes_sent": 1, "followups": 3, "conversions": 1},
    "highlights": "Closed one rooftop deal", "issues": "Waiting for net meter", "tomorrow_plan": "Visit Perundurai site",
}


class TestDailyReport:
    def test_blank_report_before_saving(self, staff):
        s, _ = staff
        r = s.get(f"{API}/daily-reports/me", params={"date": TODAY}, timeout=30).json()
        assert r["exists"] is False and r["status"] == "not_started"

    def test_future_date_rejected(self, staff):
        s, _ = staff
        future = (date.today() + timedelta(days=5)).isoformat()
        assert s.put(f"{API}/daily-reports/me", params={"date": future}, json=REPORT, timeout=30).status_code == 400

    def test_draft_then_submit_mirrors_legacy_entries_once(self, staff, project_id, admin):
        s, uid = staff
        body = {**REPORT, "site_work": [{"project_id": project_id, "work_done": "Structure erected", "progress_pct": 40, "crew_count": 3}],
                "payments": [{"project_id": project_id, "amount": 25000, "method": "upi", "reference": "UTR123"}]}
        d = s.put(f"{API}/daily-reports/me", params={"date": TODAY}, json=body, timeout=30).json()
        assert d["status"] == "draft"
        legacy = admin.get(f"{API}/daily-updates", params={"date_from": TODAY}, timeout=30).json()
        assert not [u for u in legacy if u.get("source_id") == d["id"]], "drafts must not feed reports"
        d = s.put(f"{API}/daily-reports/me", params={"date": TODAY}, json={**body, "submit": True}, timeout=30).json()
        assert d["status"] == "submitted" and d["submitted_at"]
        # re-save after submit stays submitted and does not duplicate mirrored rows
        s.put(f"{API}/daily-reports/me", params={"date": TODAY}, json=body, timeout=30)
        legacy = [u for u in admin.get(f"{API}/daily-updates", timeout=30).json() if u.get("source_id") == d["id"]]
        kinds = sorted(u["update_type"] for u in legacy)
        assert kinds == ["leads", "payment", "progress"], kinds
        leads = next(u for u in legacy if u["update_type"] == "leads")
        assert leads["data"]["total_leads"] == 4 and leads["data"]["conversions"] == 1 and leads["date"] == TODAY

    def test_staff_cannot_see_others(self, staff, staff2):
        s1, _ = staff
        s2, _ = staff2
        mine = s1.get(f"{API}/daily-reports/me", params={"date": TODAY}, timeout=30).json()
        assert s2.get(f"{API}/daily-reports/{mine['id']}", timeout=30).status_code == 404
        assert all(r["user_id"] != mine["user_id"] for r in s2.get(f"{API}/daily-reports", timeout=30).json()["reports"])
        assert s2.get(f"{API}/daily-reports/team", params={"date": TODAY}, timeout=30).status_code == 403

    def test_team_status_and_review(self, admin, staff, staff2):
        _, uid1 = staff
        _, uid2 = staff2
        t = admin.get(f"{API}/daily-reports/team", params={"date": TODAY}, timeout=30).json()
        by = {r["user_id"]: r for r in t["rows"]}
        assert by[uid1]["status"] == "submitted" and by[uid1]["totals"]["payments"] == 25000
        assert by[uid2]["status"] == "missing"
        rid = by[uid1]["report_id"]
        assert admin.put(f"{API}/daily-reports/{rid}/review", json={"comment": "Good work"}, timeout=30).status_code == 200
        full = admin.get(f"{API}/daily-reports/{rid}", timeout=30).json()
        assert full["reviewed_by"] and full["review_comment"] == "Good work"
        assert full["project_info"]

    def test_only_admin_deletes_submitted(self, staff, admin):
        s, _ = staff
        mine = s.get(f"{API}/daily-reports/me", params={"date": TODAY}, timeout=30).json()
        assert s.delete(f"{API}/daily-reports/{mine['id']}", timeout=30).status_code == 403
        # own draft on another day can be deleted by its author
        d = s.put(f"{API}/daily-reports/me", params={"date": YESTERDAY}, json=REPORT, timeout=30).json()
        assert s.delete(f"{API}/daily-reports/{d['id']}", timeout=30).status_code == 200


class TestSiteDiary:
    def test_save_get_and_previous(self, staff, project_id, admin):
        s, _ = staff
        y = {"crew": [{"name": "Kumar crew", "role": "Installer", "count": 4}], "stages_done": ["Structure erected"],
             "progress_pct": 40, "work_done": "Structure up on east roof", "next_steps": "Mount panels", "weather": "Sunny"}
        r = s.put(f"{API}/site-diaries/{project_id}/{YESTERDAY}", json=y, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["crew_total"] == 4
        today = s.get(f"{API}/site-diaries/{project_id}/{TODAY}", timeout=30).json()
        assert today["exists"] is False and today["previous"]["next_steps"] == "Mount panels"
        t = {**y, "stages_done": ["Panels mounted"], "progress_pct": 140, "materials_used": [{"item": "540W panel", "qty": 6, "unit": "nos"}]}
        saved = admin.put(f"{API}/site-diaries/{project_id}/{TODAY}", json=t, timeout=30).json()
        assert saved["progress_pct"] == 100, "progress is clamped to 0-100"
        again = admin.put(f"{API}/site-diaries/{project_id}/{TODAY}", json={**t, "progress_pct": 60}, timeout=30).json()
        assert again["id"] == saved["id"] and again["progress_pct"] == 60

    def test_book_and_list_and_mirror(self, admin, project_id):
        book = admin.get(f"{API}/site-diaries/project/{project_id}", timeout=30).json()
        assert [d["date"] for d in book["diaries"]] == [YESTERDAY, TODAY]
        assert book["project"]["customer"].startswith("DR Customer")
        lst = admin.get(f"{API}/site-diaries", params={"project_id": project_id}, timeout=30).json()
        assert len(lst["diaries"]) == 2 and project_id in lst["project_info"]
        timeline = admin.get(f"{API}/daily-updates/project/{project_id}", timeout=30).json()
        assert len([u for u in timeline if u.get("source") == "site_diary"]) == 2

    def test_delete_rules(self, staff2, admin, project_id):
        s2, _ = staff2
        did = admin.get(f"{API}/site-diaries/{project_id}/{TODAY}", timeout=30).json()["id"]
        assert s2.delete(f"{API}/site-diaries/{did}", timeout=30).status_code == 403
        assert admin.delete(f"{API}/site-diaries/{did}", timeout=30).status_code == 200


class TestLegacyDailyUpdatesOwnership:
    def test_staff_cannot_delete_someone_elses_entry(self, staff, staff2, project_id):
        s1, _ = staff
        s2, _ = staff2
        r = s1.post(f"{API}/daily-updates", json={"project_id": project_id, "update_type": "progress", "data": {"work_done": "x"}}, timeout=30).json()
        assert s2.delete(f"{API}/daily-updates/{r['id']}", timeout=30).status_code == 403
        assert s2.put(f"{API}/daily-updates/{r['id']}", json={"data": {"work_done": "y"}}, timeout=30).status_code == 403
        assert s1.delete(f"{API}/daily-updates/{r['id']}", timeout=30).status_code == 200
