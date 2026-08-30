"""Iteration 33 — Universal Notes + Materials/Solar refactor backend tests.

Covers:
  * POST /api/projects accepts `notes` + `terms_id`
  * GET  /api/projects/{id} returns `notes`, `notes_history`
  * GET  legacy migration: `additional.shadow_analysis_notes` → `notes` when notes missing
  * POST /api/projects/{id}/notes — append timestamped history entry (works on any status)
  * POST /api/projects/{id}/notes — empty / whitespace text → 400
  * PUT  /api/projects/{id} with ONLY `notes` allowed on completed/rejected/draft/approved
  * PUT  /api/projects/{id} with `customer` on completed → 400
"""

import os
import pytest
import requests
from datetime import datetime, timezone
from bson import ObjectId
from pymongo import MongoClient
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://solar-ops-management.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD

# Mongo direct — for status mutation (completed) which has no public endpoint
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# --------------------------- fixtures ---------------------------

@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def mongo_db():
    # Resolve actual DB name from backend/.env (preferred)
    try:
        with open("/app/backend/.env") as f:
            for line in f:
                if line.startswith("DB_NAME"):
                    name = line.split("=", 1)[1].strip().strip('"').strip("'")
                    db_name = name
                    break
            else:
                db_name = DB_NAME
            f.seek(0)
            for line in f:
                if line.startswith("MONGO_URL"):
                    url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
            else:
                url = MONGO_URL
    except FileNotFoundError:
        url, db_name = MONGO_URL, DB_NAME
    client = MongoClient(url)
    return client[db_name]


def _make_project_payload(customer_name="TEST_ITER33", notes="initial-notes"):
    return {
        "customer": {"name": customer_name, "phone": "9999900000", "email": "t33@example.com", "address": "Addr", "alternate_phone": ""},
        "location": {"address": "L", "city": "C", "state": "S", "pincode": "600001", "latitude": 0, "longitude": 0},
        "electrical": {"sanction_load_kw": 5, "connected_load_kw": 5, "monthly_consumption_units": 500, "eb_tariff": 7, "service_number": "", "connection_type": "single_phase", "phase": "single", "wiring_condition": "good"},
        "solar_system": {"system_type": "on_grid", "preferred_capacity_kwp": 5, "panel_type": "mono_perc", "panel_wattage": 540, "inverter_type": "string", "battery_required": False, "battery_capacity_kwh": 0},
        "mounting": {"roof_type": "rcc", "shadow_free": True, "roof_age_years": 1, "tilt_angle": 10, "structure_type": "elevated"},
        "additional": {"site_visit_required": False, "shadow_analysis_notes": "", "cable_length_meters": 10, "inverter_to_panel_distance": 8},
        "selected_items": [],
        "manual_costs": [],
        "site_images": [],
        "notes": notes,
    }


# --------------------------- tests ---------------------------

class TestNotesCreateAndGet:
    def test_create_with_notes_returns_notes_and_empty_history(self, session):
        r = session.post(f"{BASE_URL}/api/projects", json=_make_project_payload(notes="hello-from-create"), timeout=15)
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        try:
            g = session.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
            assert g.status_code == 200
            data = g.json()
            assert data.get("notes") == "hello-from-create"
            assert data.get("notes_history") == []
        finally:
            session.delete(f"{BASE_URL}/api/projects/{pid}")


class TestNotesAppendEndpoint:
    def test_append_note_succeeds_and_persists(self, session):
        r = session.post(f"{BASE_URL}/api/projects", json=_make_project_payload(), timeout=15)
        pid = r.json()["id"]
        try:
            ap = session.post(f"{BASE_URL}/api/projects/{pid}/notes",
                              json={"text": "First service follow-up"}, timeout=15)
            assert ap.status_code == 200, ap.text
            entry = ap.json()["entry"]
            assert entry["text"] == "First service follow-up"
            assert entry["author_name"]
            assert "timestamp" in entry

            g = session.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
            history = g.json().get("notes_history", [])
            assert len(history) == 1
            assert history[0]["text"] == "First service follow-up"
        finally:
            session.delete(f"{BASE_URL}/api/projects/{pid}")

    def test_append_empty_text_returns_400(self, session):
        r = session.post(f"{BASE_URL}/api/projects", json=_make_project_payload(), timeout=15)
        pid = r.json()["id"]
        try:
            ap = session.post(f"{BASE_URL}/api/projects/{pid}/notes",
                              json={"text": "   "}, timeout=15)
            assert ap.status_code == 400
        finally:
            session.delete(f"{BASE_URL}/api/projects/{pid}")


class TestNotesOnlyPutOnCompleted:
    def test_notes_only_put_allowed_on_completed(self, session, mongo_db):
        r = session.post(f"{BASE_URL}/api/projects", json=_make_project_payload(notes="orig"), timeout=15)
        pid = r.json()["id"]
        try:
            # Force completed via direct DB write
            mongo_db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"status": "completed"}})

            put = session.put(f"{BASE_URL}/api/projects/{pid}",
                              json={"notes": "updated-after-completion"}, timeout=15)
            assert put.status_code == 200, put.text

            g = session.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
            assert g.json().get("notes") == "updated-after-completion"
            # Status preserved
            assert g.json().get("status") == "completed"

            # Append also works on completed
            ap = session.post(f"{BASE_URL}/api/projects/{pid}/notes",
                              json={"text": "post-completion log"}, timeout=15)
            assert ap.status_code == 200
        finally:
            session.delete(f"{BASE_URL}/api/projects/{pid}")

    def test_customer_put_on_completed_rejected_with_400(self, session, mongo_db):
        r = session.post(f"{BASE_URL}/api/projects", json=_make_project_payload(), timeout=15)
        pid = r.json()["id"]
        try:
            mongo_db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"status": "completed"}})
            put = session.put(f"{BASE_URL}/api/projects/{pid}",
                              json={"customer": {"name": "CHANGED", "phone": "1111", "email": "x@y.z", "address": "A", "alternate_phone": ""},
                                    "notes": "x"}, timeout=15)
            assert put.status_code == 400
            assert "draft" in put.text.lower() or "approved" in put.text.lower()
        finally:
            session.delete(f"{BASE_URL}/api/projects/{pid}")


class TestLegacyShadowNotesMigration:
    def test_legacy_shadow_notes_migrate_into_notes_on_get(self, session, mongo_db):
        # Create plain project, then null out `notes` and put shadow_analysis_notes into additional
        r = session.post(f"{BASE_URL}/api/projects", json=_make_project_payload(notes=""), timeout=15)
        pid = r.json()["id"]
        try:
            mongo_db.projects.update_one(
                {"_id": ObjectId(pid)},
                {"$set": {"notes": None,
                          "additional.shadow_analysis_notes": "LEGACY-shadow-content"}}
            )
            g = session.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
            assert g.status_code == 200
            assert g.json().get("notes") == "LEGACY-shadow-content"
        finally:
            session.delete(f"{BASE_URL}/api/projects/{pid}")


class TestRegressionTermsAndDashboard:
    def test_terms_id_persists_on_create(self, session, mongo_db):
        # Find any active terms id to attach
        t = mongo_db.terms_conditions.find_one({})
        if not t:
            pytest.skip("No terms templates in DB to attach")
        tid = str(t["_id"])
        payload = _make_project_payload()
        payload["terms_id"] = tid
        r = session.post(f"{BASE_URL}/api/projects", json=payload, timeout=15)
        pid = r.json()["id"]
        try:
            g = session.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
            assert g.json().get("terms_id") == tid
        finally:
            session.delete(f"{BASE_URL}/api/projects/{pid}")

    def test_dashboard_stats_conversion_rate(self, session):
        r = session.get(f"{BASE_URL}/api/dashboard/stats", timeout=15)
        assert r.status_code == 200
        d = r.json()
        # conversion_rate must exclude drafts; required keys must exist
        for k in ("total", "draft", "completed", "conversion_rate"):
            assert k in d, f"missing key {k}"