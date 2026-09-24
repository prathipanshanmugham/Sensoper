"""Iter 56 — Account Security (vault) rotation reminders: per-service interval, overdue flagging, bell notifications."""
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST56_{uuid.uuid4().hex[:5]}"
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": ADMIN_PW}, timeout=60).status_code == 200
    return s


def _db():
    import pymongo
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    return pymongo.MongoClient(env["MONGO_URL"])[env["DB_NAME"]]


def test_rotation_state_pure():
    sys.path.insert(0, "/app/backend")
    from vault import rotation_state
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    fresh = {"last_rotated": (now - timedelta(days=10)).isoformat()}
    assert rotation_state(fresh, 90, now)["rotation_stale"] is False
    assert rotation_state(fresh, 90, now)["days_overdue"] == 0
    old = {"last_rotated": (now - timedelta(days=120)).isoformat()}
    st = rotation_state(old, 90, now)
    assert st["rotation_stale"] is True and st["days_overdue"] == 30 and st["rotation_source"] == "default"
    # per-service interval overrides the default
    st = rotation_state({**old, "rotation_days": 180}, 90, now)
    assert st["rotation_stale"] is False and st["rotation_source"] == "service" and st["rotation_days"] == 180
    st = rotation_state({**fresh, "rotation_days": 7}, 90, now)
    assert st["rotation_stale"] is True and st["days_overdue"] == 3
    assert rotation_state({}, 90, now)["rotation_stale"] is True  # never rotated


def test_service_flagged_once_interval_elapses_and_surfaces_in_bell(admin):
    r = admin.post(f"{API}/vault", json={"service_name": f"{TAG} GoDaddy", "account_identifier": "domains@sensoper.com", "password": "Old#Pass1",
                                          "category": "domain", "two_fa_enabled": True, "two_fa_method": "sms", "rotation_days": 30}, timeout=60)
    assert r.status_code == 200, r.text
    item = r.json(); vid = item["id"]
    assert item["rotation_days"] == 30 and item["rotation_source"] == "service" and item["rotation_stale"] is False
    dash = admin.get(f"{API}/vault/dashboard", timeout=60).json()
    assert vid not in [i["id"] for i in dash["rotation_overdue"]]
    # time passes: 45 days since last rotation, interval 30 → overdue by 15
    from bson import ObjectId
    db = _db()
    db.credential_vault.update_one({"_id": ObjectId(vid)}, {"$set": {"last_rotated": (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()}})
    dash = admin.get(f"{API}/vault/dashboard", timeout=60).json()
    due = next(i for i in dash["rotation_overdue"] if i["id"] == vid)
    assert due["rotation_stale"] is True and due["days_overdue"] == 15
    # → existing alerts mechanism: in-app notification for the admin, counted in the header bell
    alerts = admin.get(f"{API}/alerts/dashboard", timeout=60).json()
    mine = [n for n in alerts["notifications"] if n["kind"] == "vault_rotation" and f"{TAG} GoDaddy" in n["title"]]
    assert mine, alerts["notifications"]
    assert alerts["notifications_due"] >= 1 and mine[0]["link"] == "/dashboard/vault"
    notes = admin.get(f"{API}/notifications", timeout=60).json()["rows"]
    assert any(n.get("vault_id") == vid and n["status"] == "pending" for n in notes)
    # one notification per admin per week — a second sync must not duplicate
    admin.get(f"{API}/vault/dashboard", timeout=60)
    assert sum(1 for n in admin.get(f"{API}/notifications", timeout=60).json()["rows"] if n.get("vault_id") == vid) == 1
    # rotating the password resolves the reminder and clears the flag
    upd = admin.put(f"{API}/vault/{vid}", json={"password": "New#Pass2"}, timeout=60).json()
    assert upd["rotation_stale"] is False and upd["days_overdue"] == 0
    assert not any(n.get("vault_id") == vid for n in admin.get(f"{API}/notifications", timeout=60).json()["rows"])
    assert vid not in [i["id"] for i in admin.get(f"{API}/vault/dashboard", timeout=60).json()["rotation_overdue"]]
    log = admin.get(f"{API}/vault/{vid}/access-log", timeout=60).json()
    assert log[0]["action"] == "rotate"
    # switching back to the company default via 0
    upd = admin.put(f"{API}/vault/{vid}", json={"rotation_days": 0}, timeout=60).json()
    assert upd["rotation_source"] == "default"
    assert admin.put(f"{API}/vault/{vid}", json={"rotation_days": -3}, timeout=60).status_code == 400
    admin.delete(f"{API}/vault/{vid}", timeout=60)


def test_two_fa_off_risk_list_and_reveal_logged(admin):
    r = admin.post(f"{API}/vault", json={"service_name": f"{TAG} Hostinger", "account_identifier": "ops@sensoper.com", "password": "x", "category": "hosting", "two_fa_enabled": False}, timeout=60).json()
    dash = admin.get(f"{API}/vault/dashboard", timeout=60).json()
    assert r["id"] in [i["id"] for i in dash["two_fa_disabled"]]
    admin.post(f"{API}/vault/{r['id']}/reveal", timeout=60)
    log = admin.get(f"{API}/vault/{r['id']}/access-log", timeout=60).json()
    assert log[0]["action"] == "reveal" and log[0]["user_name"] and log[0]["timestamp"]
    admin.delete(f"{API}/vault/{r['id']}", timeout=60)


def test_staff_never_reaches_vault_or_its_alerts(admin):
    email = f"{TAG.lower()}@sensoper.com"
    u = admin.post(f"{API}/users", json={"email": email, "password": "Staff@12345", "name": f"{TAG} Staff", "role": "staff"}, timeout=60).json()
    s = requests.Session(); s.post(f"{API}/auth/login", json={"email": email, "password": "Staff@12345"}, timeout=60)
    assert s.get(f"{API}/vault/dashboard", timeout=60).status_code == 403
    assert not any(n.get("kind") == "vault_rotation" for n in s.get(f"{API}/notifications", timeout=60).json()["rows"])
    admin.delete(f"{API}/users/{u['id']}", timeout=60)
