"""Attendance, location-wise org structure and the customer dashboard (Oct 2026).

Run against a live server:  REACT_APP_BACKEND_URL=http://localhost:8001 pytest tests/test_attendance_org_portal.py
"""
import os
import sys
import uuid
from datetime import date

import pytest
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
ADMIN = {"email": os.environ.get("ADMIN_EMAIL", "admin@sensoper.com"), "password": os.environ.get("ADMIN_PASSWORD", "Admin@123")}
TAG = uuid.uuid4().hex[:6]
PIN = {"lat": 11.341036, "lng": 77.717163, "accuracy": 8}


def _session(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin():
    return _session(ADMIN)


def _user(admin, role, n=1):
    email = f"aop_{role}{n}_{TAG}@example.com"
    r = admin.post(f"{API}/users", json={"email": email, "password": "Passw0rd!x", "name": f"AOP {role.title()} {n} {TAG}", "role": role}, timeout=30)
    assert r.status_code in (200, 201), r.text
    return _session({"email": email, "password": "Passw0rd!x"}), r.json()["id"]


@pytest.fixture(scope="module")
def staff(admin):
    return _user(admin, "staff")


@pytest.fixture(scope="module")
def manager(admin):
    return _user(admin, "manager")


def _project(sess, phone="+91 98765 43210"):
    payload = {
        "customer": {"name": f"Portal Customer {TAG}", "phone": phone, "address": "Erode"},
        "location": {"district": "Erode", "state": "Tamil Nadu", "address": "12 Perundurai Rd"},
        "electrical": {"sanction_load_kw": 4, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 6.5},
        "solar_system": {"system_type": "on-grid"},
        "mounting": {"roof_type": "RCC", "tilt_angle": 10, "structure_type": "GI"},
        "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 5},
        "custom_fields": {"proposed_solution": {"system_type": "on-grid", "system_size_kw": 3,
                                                "_quick": {"annual_generation_units": 4818, "annual_saving": 38544, "monthly_saving": 3212, "payback_years": 4.1}}},
        "commissioning_date": "2025-01-10",
    }
    r = sess.post(f"{API}/projects", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ───────────────────────── attendance ─────────────────────────

def test_attendance_flow(admin, staff, manager):
    s, sid = staff
    assert s.post(f"{API}/attendance/check-out", json=PIN).status_code == 400            # not checked in yet
    assert s.post(f"{API}/attendance/check-in", json={"lat": 0, "lng": 0}).status_code == 400
    r = s.post(f"{API}/attendance/check-in", json={**PIN, "note": "Site: Erode"})
    assert r.status_code == 200 and r.json()["state"] == "checked_in" and r.json()["check_in"]["lat"] == 11.341036
    assert s.post(f"{API}/attendance/check-in", json=PIN).status_code == 400              # once a day
    today = s.get(f"{API}/attendance/me/today").json()
    assert today["record"]["state"] == "checked_in"
    r = s.post(f"{API}/attendance/check-out", json=PIN)
    assert r.status_code == 200 and r.json()["state"] == "checked_out" and r.json()["worked_minutes"] == 0
    assert s.post(f"{API}/attendance/check-out", json=PIN).status_code == 400
    mine = s.get(f"{API}/attendance/me").json()
    assert mine["days_present"] >= 1

    assert s.get(f"{API}/attendance/team").status_code == 403                               # staff can't see the team
    team = admin.get(f"{API}/attendance/team").json()
    row = next(x for x in team["rows"] if x["id"] == sid)
    assert row["status"] == "checked_out" and team["summary"]["present"] >= 1
    assert manager[0].get(f"{API}/attendance/team").status_code == 200

    reg = admin.get(f"{API}/attendance/register").json()
    srow = next(x for x in reg["rows"] if x["id"] == sid)
    idx = reg["days"].index(today["date"])
    assert srow["cells"][idx] == "H"                                                          # 0 minutes → half day
    assert all(c == "" for c in srow["cells"][:idx])                                          # joined today: earlier days blank, not absent

    rec_id = row["record"]["id"]
    assert admin.put(f"{API}/attendance/{rec_id}", json={"check_in_at": "18:00", "check_out_at": "09:00"}).status_code == 400
    r = admin.put(f"{API}/attendance/{rec_id}", json={"check_in_at": "09:00", "check_out_at": "18:00", "note": "Forgot to check out"})
    assert r.status_code == 200 and r.json()["worked_minutes"] == 540 and len(r.json()["corrections"]) == 1
    assert s.put(f"{API}/attendance/{rec_id}", json={"check_out_at": "20:00"}).status_code == 403
    reg = admin.get(f"{API}/attendance/register").json()
    assert next(x for x in reg["rows"] if x["id"] == sid)["cells"][idx] == "P"


# ───────────────────────── org structure ─────────────────────────

def test_org_structure_is_admin_only(admin, staff, manager):
    s, sid = staff
    m, mid = manager
    assert s.get(f"{API}/org-structure").status_code == 403
    assert m.get(f"{API}/org-structure").status_code == 403
    r = admin.post(f"{API}/locations", json={"name": f"Erode Branch {TAG}", "type": "branch", "district": "Erode"})
    assert r.status_code in (200, 201), r.text
    loc = r.json()["id"]
    for uid in (sid, mid):
        assert admin.put(f"{API}/users/{uid}/locations", json={"location_ids": [loc], "default_location_id": loc}).status_code == 200
    org = admin.get(f"{API}/org-structure").json()
    block = next(b for b in org["locations"] if b["location"]["id"] == loc)
    assert [p["id"] for p in block["managers"]] == [mid] and [p["id"] for p in block["staff"]] == [sid]
    assert next(p for p in block["staff"] if p["id"] == sid)["today"] in ("checked_in", "checked_out")
    assert any(p["role"] == "admin" for p in org["leadership"])
    assert org["totals"]["locations"] >= 1


# ───────────────────────── customer dashboard ─────────────────────────

def test_customer_dashboard_end_to_end(admin, staff):
    s, _ = staff
    pid = _project(s)
    assert s.get(f"{API}/projects/{pid}/portal-link").json() == {"active": False}
    link = s.post(f"{API}/projects/{pid}/portal-link").json()
    assert link["active"] and link["token"] and link["path"] == f"/my/{link['token']}"
    tok = link["token"]

    cust = requests.Session()
    hello = cust.get(f"{API}/portal/{tok}/hello").json()
    assert hello["phone_hint"].endswith("10") and hello["company"]["name"]
    assert cust.get(f"{API}/portal/{tok}/dashboard").status_code == 401
    assert cust.post(f"{API}/portal/{tok}/verify", json={"phone": "9000000000"}).status_code == 400
    assert cust.post(f"{API}/portal/{tok}/verify", json={"phone": "098765-43210"}).status_code == 200
    d = cust.get(f"{API}/portal/{tok}/dashboard")
    assert d.status_code == 200, d.text
    d = d.json()
    assert d["project"]["size_kw"] == 3 and d["savings"]["payback_years"] == 4.1 and d["savings"]["running"]
    assert d["savings"]["breakeven_date"] == "2029-02-16" and 0 < d["savings"]["breakeven_pct"] < 100
    assert d["energy"]["co2_kg_per_year"] == round(4818 * 0.82) and d["energy"]["units_so_far"] > 0 and d["energy"]["trees_equivalent"] > 0
    assert d["journey"][0]["done"] and d["journey"][3]["key"] == "commissioned" and d["journey"][3]["done"]
    assert "margin" not in str(d).lower()                                   # no internal pricing leaks

    # Offers
    o = admin.post(f"{API}/customer-offers", json={"title": f"Battery add-on {TAG}", "badge": "10% off", "description": "Keep lights on in power cuts"}).json()
    hidden = admin.post(f"{API}/customer-offers", json={"title": f"Pump only {TAG}", "system_types": ["solar-pump"]}).json()
    offers = cust.get(f"{API}/portal/{tok}/dashboard").json()["offers"]
    assert any(x["id"] == o["id"] for x in offers) and not any(x["id"] == hidden["id"] for x in offers)
    assert cust.post(f"{API}/portal/{tok}/offers/{o['id']}/interest").json() == {"interested": True}
    assert cust.post(f"{API}/portal/{tok}/offers/{o['id']}/interest").status_code == 200          # idempotent
    ints = [i for i in admin.get(f"{API}/customer-offers/interests").json() if i["project_id"] == pid]
    assert len(ints) == 1 and ints[0]["offer_title"].startswith("Battery add-on")
    assert next(x for x in admin.get(f"{API}/customer-offers").json() if x["id"] == o["id"])["interest_count"] == 1
    assert s.get(f"{API}/customer-offers").status_code == 403

    # Tickets
    assert cust.post(f"{API}/portal/{tok}/tickets", json={"category": "no_power", "description": "hi"}).status_code == 400
    t = cust.post(f"{API}/portal/{tok}/tickets", json={"category": "no_power", "description": "Inverter screen is blank since morning"})
    assert t.status_code == 200 and t.json()["number"]
    mine = cust.get(f"{API}/portal/{tok}/dashboard").json()["tickets"]
    assert mine[0]["number"] == t.json()["number"] and mine[0]["status"] == "open"
    staff_view = admin.get(f"{API}/support/tickets", params={"limit": 200}).json()
    rows = staff_view.get("tickets", staff_view) if isinstance(staff_view, dict) else staff_view
    tk = next(x for x in rows if x.get("ticket_number") == t.json()["number"])
    assert tk["reported_via"] == "customer_dashboard" and tk["priority"] == "high" and tk["project_id"] == pid

    # Replacing the link kills the old one; the session cookie is tied to the old link
    new = s.post(f"{API}/projects/{pid}/portal-link").json()["token"]
    assert cust.get(f"{API}/portal/{tok}/dashboard").status_code == 404
    assert cust.get(f"{API}/portal/{new}/dashboard").status_code == 401
    assert s.delete(f"{API}/projects/{pid}/portal-link").json() == {"active": False}
    assert cust.get(f"{API}/portal/{new}/hello").status_code == 404


def test_portal_link_needs_phone_and_rate_limits(admin, staff):
    s, _ = staff
    pid = _project(s, phone="12345")
    assert s.post(f"{API}/projects/{pid}/portal-link").status_code == 400
    pid2 = _project(s, phone="9811122233")
    tok = s.post(f"{API}/projects/{pid2}/portal-link").json()["token"]
    c = requests.Session()
    codes = [c.post(f"{API}/portal/{tok}/verify", json={"phone": f"90000000{i:02d}"}).status_code for i in range(9)]
    assert codes[:8] == [400] * 8 and codes[8] == 429
    assert c.post(f"{API}/portal/{tok}/verify", json={"phone": "9811122233"}).status_code == 429      # locked for a while


def test_breakeven_maths_without_commissioning():
    from customer_portal import build_dashboard_numbers
    p = {"custom_fields": {"proposed_solution": {"system_size_kw": 5, "_quick": {"annual_generation_units": 8030, "annual_saving": 60000, "payback_years": 4.5}}},
         "cost_estimation": {"total_cost": 270000, "subsidy": 78000}}
    n = build_dashboard_numbers(p, [{"amount": 100000, "created_at": "2026-09-01"}], None, date(2026, 10, 10))
    assert n["money"] == {"price": 270000, "subsidy": 78000, "paid": 100000, "balance": 170000, "paid_pct": 37,
                          "payments": [{"date": "2026-09-01", "amount": 100000, "method": ""}]}
    assert n["savings"]["running"] is False and n["savings"]["so_far"] == 0 and n["savings"]["breakeven_date"] is None
    assert n["energy"]["co2_kg_per_year"] == round(8030 * 0.82) and n["energy"]["trees_per_year"] == round(8030 * 0.82 / 21.77)
    p["commissioning_date"] = "2024-04-10"
    n = build_dashboard_numbers(p, [], 9500, date(2026, 10, 10))
    assert n["energy"]["measured"] and n["energy"]["units_so_far"] == 9500 and n["savings"]["breakeven_date"] == "2028-10-10"
    assert n["savings"]["breakeven_pct"] == round((date(2026, 10, 10) - date(2024, 4, 10)).days / 365.25 / 4.5 * 100, 1)
