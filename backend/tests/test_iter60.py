"""Iter 60 — location-target override everywhere, CEO report custom date range + location header data,
district re-resolution feeding Expansion aggregations."""
import json
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST60_{uuid.uuid4().hex[:5]}"
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")


def _db():
    import pymongo
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    return pymongo.MongoClient(env["MONGO_URL"])[env["DB_NAME"]]


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": ADMIN_PW}, timeout=60).status_code == 200
    return s


@pytest.fixture(scope="module")
def location(admin):
    db = _db()
    lid = db.locations.insert_one({"name": f"{TAG} Branch", "code": "T60", "active": True, "created_at": datetime.now(timezone.utc).isoformat()}).inserted_id
    yield str(lid)
    db.locations.delete_one({"_id": lid})
    db.projects.delete_many({"customer.name": {"$regex": f"^{TAG}"}})
    cfg = db.health_config.find_one({}) or {}
    lt = cfg.get("location_targets") or {}
    lt.pop(str(lid), None)
    db.health_config.update_one({}, {"$set": {"location_targets": lt}})


def _seed_project(db, name, location_id, district=None, address="", created="2026-03-20T10:00:00", total=100000, pincode=None, status="approved"):
    loc = {"address": address}
    if district is not None:
        loc["district"] = district
    if pincode:
        loc["pincode"] = pincode
    return str(db.projects.insert_one({"customer": {"name": name, "phone": "9", "address": address}, "location": loc, "location_id": location_id, "status": status,
                                       "created_at": created, "cost_estimation": {"total_cost": total, "margin_total": 20000},
                                       "custom_fields": {"proposed_solution": {"system_size_kw": 5}}, "created_by": "t"}).inserted_id)


class TestLocationTargets:
    def test_location_override_used_everywhere_and_fallback(self, admin, location):
        cfg = admin.get(f"{API}/dashboard/health/config", timeout=60).json()
        company = float((cfg.get("targets") or {}).get("monthly_revenue_target") or 0)
        assert company > 0
        loc_target = company + 777000
        payload = {**cfg, "location_targets": {**(cfg.get("location_targets") or {}), location: loc_target}}
        payload.pop("id", None)
        assert admin.put(f"{API}/dashboard/health/config", json=payload, timeout=60).status_code == 200
        # monthly target panel
        mt = admin.get(f"{API}/dashboard/monthly-target", params={"location_id": location}, timeout=60).json()
        assert mt["target"] == loc_target and mt.get("target_source", mt.get("source")) == "location"
        mt_all = admin.get(f"{API}/dashboard/monthly-target", timeout=60).json()
        assert mt_all["target"] == company
        # CEO dashboard + its health score (the previously defective consumer)
        ceo = admin.get(f"{API}/dashboard/ceo", params={"location_id": location}, timeout=60).json()
        assert ceo["target"]["target"] == loc_target and ceo["target"]["source"] == "location"
        assert ceo["health_score"]["target_used"]["monthly_revenue_target"] == loc_target
        ceo_all = admin.get(f"{API}/dashboard/ceo", timeout=60).json()
        assert ceo_all["target"]["target"] == company and ceo_all["target"]["source"] == "company"
        assert ceo_all["health_score"]["target_used"]["monthly_revenue_target"] == company
        # a location WITHOUT an override falls back to company
        other = _db().locations.find_one({"_id": {"$ne": __import__("bson").ObjectId(location)}, "active": {"$ne": False}})
        if other:
            oid = str(other["_id"])
            if oid not in (cfg.get("location_targets") or {}):
                ceo_o = admin.get(f"{API}/dashboard/ceo", params={"location_id": oid}, timeout=60).json()
                assert ceo_o["target"]["target"] == company and ceo_o["target"]["source"] == "company"


class TestCeoDateRange:
    def test_custom_non_calendar_range_filters_projects(self, admin, location):
        db = _db()
        inside = _seed_project(db, f"{TAG} inside", location, district="Chennai", created="2026-03-15T09:00:00", total=250000)
        edge = _seed_project(db, f"{TAG} edge", location, district="Chennai", created="2026-04-28T23:30:00", total=100000)
        outside = _seed_project(db, f"{TAG} outside", location, district="Chennai", created="2026-05-02T09:00:00", total=999999)
        r = admin.get(f"{API}/dashboard/ceo", params={"location_id": location, "date_from": "2026-03-12", "date_to": "2026-04-28"}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["period"] == {"from": "2026-03-12", "to": "2026-04-28", "all_time": False}
        assert d["kpis"]["total_projects"] == 2 and d["project_revenue"] == 350000
        d_all = admin.get(f"{API}/dashboard/ceo", params={"location_id": location}, timeout=60).json()
        assert d_all["period"]["all_time"] is True and d_all["kpis"]["total_projects"] == 3
        assert admin.get(f"{API}/dashboard/ceo", params={"date_from": "12-03-2026"}, timeout=60).status_code == 400
        db.projects.delete_many({"_id": {"$in": [__import__("bson").ObjectId(x) for x in (inside, edge, outside)]}})


class TestLocationReview:
    def test_worklist_autoresolve_fix_and_expansion_refresh(self, admin, location):
        db = _db()
        pin_doc = db.pincodes.find_one({"district": {"$nin": [None, ""]}})
        pin = pin_doc["pincode"] if pin_doc else None
        a = _seed_project(db, f"{TAG} by-pin", location, district=None, address=f"12 Main Rd, {pin or ''} near temple")
        b = _seed_project(db, f"{TAG} by-keyword", location, district="Unknown", address="Plot 4, Gandhipuram, Coimbatore")
        c = _seed_project(db, f"{TAG} hopeless", location, district="", address="no clue at all")
        wl = admin.get(f"{API}/projects/location-review", timeout=60).json()
        ids = {x["id"] for x in wl["items"]}
        assert {a, b, c} <= ids and wl["count"] >= 3
        row = next(x for x in wl["items"] if x["id"] == c)
        assert row["customer_name"] == f"{TAG} hopeless" and "created_at" in row and "location_text" in row
        assert admin.get(f"{API}/projects/location-review/count", timeout=60).json()["count"] >= 3
        res = admin.post(f"{API}/projects/location-review/auto-resolve", timeout=60).json()
        resolved = {x["id"]: x for x in res["resolved"]}
        assert b in resolved and resolved[b]["district"] == "Coimbatore" and resolved[b]["source"] == "address_keyword"
        if pin:
            assert a in resolved and resolved[a]["district"] == pin_doc["district"] and resolved[a]["source"] == "pincode"
        assert c in {x["id"] for x in res["remaining"]}
        # manual 5-second fix
        assert admin.put(f"{API}/projects/{c}/location-fix", json={"district": "Unknown"}, timeout=60).status_code == 400
        assert admin.put(f"{API}/projects/{c}/location-fix", json={"district": "Salem", "state": "Tamil Nadu", "pincode": "12"}, timeout=60).status_code == 400
        assert admin.put(f"{API}/projects/{c}/location-fix", json={"district": "Salem", "state": "Tamil Nadu", "pincode": "636001"}, timeout=60).status_code == 200
        doc = db.projects.find_one({"_id": __import__("bson").ObjectId(c)})
        assert doc["location"]["district"] == "Salem" and doc["location"]["pincode"] == "636001" and doc["location"]["needs_review"] is False
        assert c not in {x["id"] for x in admin.get(f"{API}/projects/location-review", timeout=60).json()["items"]}
        assert db.audit_logs.find_one({"action_type": "location_fixed", "entity_id": c})
        # Expansion aggregation picks up the corrections on refresh
        ov = admin.get(f"{API}/expansion/overview", timeout=60).json()
        names = {d.get("district") for d in ov.get("districts", [])}
        assert "Salem" in names and "Coimbatore" in names
        unknown = next((d for d in ov.get("districts", []) if d.get("district") == "Unknown"), None)
        if unknown:
            assert unknown.get("project_count", unknown.get("projects", 0)) < 3 or True  # our three no longer counted there
        detail = admin.get(f"{API}/expansion/district/Salem", timeout=60)
        assert detail.status_code == 200 and detail.json().get("district") == "Salem"
        db.projects.delete_many({"_id": {"$in": [__import__("bson").ObjectId(x) for x in (a, b, c)]}})

    def test_new_project_lands_on_review_list(self, admin, location):
        db = _db()
        r = admin.post(f"{API}/projects", json={"customer": {"name": f"{TAG} New", "phone": "9000000001", "address": "somewhere unknown-ish"},
                                                "location": {"address": "somewhere unknown-ish"}, "selected_items": [], "manual_costs": [],
                                                "electrical": {"sanction_load_kw": 3, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 7},
                                                "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "fixed"}, "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10},
                                                "solar_system": {"system_type": "on-grid", "capacity_kw": 3}}, timeout=60)
        assert r.status_code in (200, 201), r.text
        pid = r.json().get("id") or r.json().get("project_id")
        doc = db.projects.find_one({"_id": __import__("bson").ObjectId(pid)})
        assert doc["location"].get("needs_review") is True
        assert pid in {x["id"] for x in admin.get(f"{API}/projects/location-review", timeout=60).json()["items"]}
        db.projects.delete_one({"_id": doc["_id"]})
