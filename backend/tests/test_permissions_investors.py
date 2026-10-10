"""Connected permissions, the per-person daily-report switch, and investor logins — in-process, no MongoDB server.
    pip install mongomock-motor pytest httpx
    cd backend && pytest tests/test_permissions_investors.py
"""
import asyncio
import inspect
import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "perm_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "Adm1n-pass-123")
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-perm-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}  # the in-process app seeds this admin

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
import access_policy as ap  # noqa: E402
import server  # noqa: E402

PW = "Passw0rd!x"


@pytest.fixture(scope="module")
def loop():
    lp = asyncio.new_event_loop()
    yield lp
    lp.close()


@pytest.fixture(scope="module")
def app(loop):
    loop.run_until_complete(server.app.router.startup())
    return server.app


def run(loop, coro):
    return loop.run_until_complete(coro)


def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def login(app, email, password):
    c = client(app)
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture(scope="module")
def world(app, loop):
    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        ids = {}
        for name, role, req in [("Mona Manager", "manager", None), ("Sam Staff", "staff", None), ("Nia NoReport", "staff", False)]:
            body = {"email": f"{name.split()[0].lower()}@example.com", "password": PW, "name": name, "role": role, "phone": "9876500001"}
            if req is not None:
                body["daily_report_required"] = req
            r = await a.post("/api/users", json=body)
            assert r.status_code == 200, r.text
            ids[role if role != "staff" or "Sam" in name else "noreport"] = r.json()["id"]
        r = await a.post("/api/projects", json={
            "customer": {"name": "Secret Customer Name", "phone": "9876543210", "address": "1 Main Rd"},
            "location": {"address": "1 Main Rd", "district": "Erode", "state": "Tamil Nadu"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 450, "eb_tariff": 6.5},
            "solar_system": {"system_type": "on-grid"}, "mounting": {"roof_type": "RCC", "tilt_angle": 10, "structure_type": "GI"},
            "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 5},
            "custom_fields": {"proposed_solution": {"system_type": "on-grid", "system_size_kw": 5, "total_cost": 250000}}})
        assert r.status_code == 200, r.text
        ids["project"] = r.json()["id"]
        await a.aclose()
        return ids
    return run(loop, go())


# ───────────────────────── policy table ─────────────────────────
def test_defaults_never_open_more_than_the_code_did(app):
    """With the recommended matrix, no route is opened to a role its own code didn't already allow."""
    escalations = []
    for r in app.routes:
        if not hasattr(r, "methods") or not r.path.startswith("/api"):
            continue
        try:
            src = inspect.getsource(r.endpoint)
        except (OSError, TypeError):
            continue
        m = re.search(r"require_role\(([^)]*)\)", src)
        if not m:
            continue
        roles = [x.strip().strip('"\'') for x in m.group(1).replace("*MANAGERS", '"admin","manager"').split(",")]
        for role in ("manager", "staff"):
            perms = ap.merge_with_defaults(role, None)
            for meth in r.methods - {"HEAD", "OPTIONS"}:
                ok, _, grant = ap.decide(perms, meth, r.path)
                if ok and grant and role not in roles:
                    escalations.append((role, meth, r.path))
    assert escalations == []


def test_locked_pages_cannot_be_given_away():
    clean = ap.sanitize("manager", {"module_users": {"view": True, "create": True}, "module_vault": {"view": True},
                                    "module_investors": {"view": True}}, ap.merge_with_defaults("manager", None))
    assert not any(clean[k]["view"] for k in ("module_users", "module_vault", "module_investors", "module_permissions"))
    assert clean["module_dashboard"]["view"] and clean["module_security"]["view"]


def test_migration_keeps_admins_no_and_never_widens():
    stored = {**ap.OLD_DEFAULTS["staff"]}
    stored["module_inventory"] = {"view": True, "create": False, "edit": False, "delete": False, "export": False}  # seeded, but staff never saw it
    mgr = {**ap.OLD_DEFAULTS["manager"], "module_returns": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
           "module_ecommerce": {"view": False, "create": False, "edit": False, "delete": False, "export": False}}
    s2 = ap.migrate_v2("staff", stored)
    m2 = ap.migrate_v2("manager", mgr)
    assert s2["module_inventory"]["view"] is False            # menu never showed it — still hidden
    assert s2["module_projects"]["create"] is True
    assert m2["module_returns"]["delete"] is False            # the admin's "no" is kept
    assert m2["module_ecommerce"]["view"] is False            # page switched off by the admin stays off
    assert m2["module_vendors"]["delete"] is True             # never shown before, so code behaviour wins


# ───────────────────────── live API ─────────────────────────
def test_staff_menu_and_blocked_pages(app, loop, world):
    async def go():
        s = await login(app, "sam@example.com", PW)
        me = (await s.get("/api/permissions/me")).json()["permissions"]
        assert me["module_projects"]["view"] and not me["module_inventory"]["view"] and not me["module_users"]["view"]
        r = await s.get("/api/purchase-orders")
        assert r.status_code == 403 and "Permissions" in r.json()["detail"]
        assert (await s.get("/api/inventory/items")).status_code == 200            # shared look-up still works for New project
        assert (await s.get("/api/permissions/manager")).status_code == 403
        await s.aclose()
    run(loop, go())


def test_admin_can_open_and_close_things(app, loop, world):
    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        staff = (await a.get("/api/permissions/staff")).json()["permissions"]
        staff["module_inventory"] = {"view": True, "create": True, "edit": False, "delete": False, "export": False}
        r = await a.put("/api/permissions/staff", json={"permissions": staff})
        assert r.status_code == 200, r.text
        s = await login(app, "sam@example.com", PW)
        r = await s.post("/api/inventory/items", json={"name": "Test panel", "sku_code": "T-1", "category": "solar_panels", "quantity": 3,
                                                        "unit_price": 100, "gst_percentage": 12, "margin_pct": 10})
        assert r.status_code == 200, r.text                                    # code said admin/manager — the switch opened it
        r = await s.get("/api/inventory/export")
        assert r.status_code == 403                                             # export still off
        mgr = (await a.get("/api/permissions/manager")).json()["permissions"]
        mgr["can_approve_quotation"] = False
        assert (await a.put("/api/permissions/manager", json={"permissions": mgr})).status_code == 200
        m = await login(app, "mona@example.com", PW)
        r = await m.post(f"/api/projects/{world['project']}/approve")
        assert r.status_code == 403 and "approve" in r.json()["detail"].lower()
        mgr["can_approve_quotation"] = True
        await a.put("/api/permissions/manager", json={"permissions": mgr})
        assert (await a.put("/api/permissions/admin", json={"permissions": {}})).status_code == 400
        for c in (a, s, m):
            await c.aclose()
    run(loop, go())


def test_daily_report_switch(app, loop, world):
    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        team = (await a.get("/api/daily-reports/team", params={"date": "2026-10-10"})).json()
        rows = {r["name"]: r for r in team["rows"]}
        assert rows["Nia NoReport"]["required"] is False and rows["Sam Staff"]["required"] is True
        assert rows[next(n for n in rows if rows[n]["role"] == "admin")]["required"] is False
        assert team["counts"]["not_required"] >= 2 and team["counts"]["expected"] == team["counts"]["missing"] + team["counts"]["draft"] + team["counts"]["submitted"]
        assert "Nia NoReport" not in [r["name"] for r in team["rows"] if r["required"]]
        r = await a.put(f"/api/users/{world['noreport']}", json={"daily_report_required": True})
        assert r.status_code == 200
        users = {u["name"]: u for u in (await a.get("/api/users")).json()}
        assert users["Nia NoReport"]["daily_report_required"] is True
        n = await login(app, "nia@example.com", PW)
        assert (await n.get("/api/auth/me")).json()["daily_report_required"] is True
        for c in (a, n):
            await c.aclose()
    run(loop, go())


def test_investor_login_dashboard_and_isolation(app, loop, world):
    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        assert (await a.post("/api/investors", json={"name": "X", "email": "sam@example.com", "password": "Temp-pass-1"})).status_code == 400
        r = await a.post("/api/investors", json={"name": "Ira Investor", "email": "ira@example.com", "password": "Temp-pass-1", "share_pct": 12.5,
                                                 "committed_amount": 1000000, "sections": {"branches": False}})
        assert r.status_code == 200, r.text
        iid = r.json()["id"]
        for t, amt, d in [("investment", 600000, "2026-04-01"), ("investment", 400000, "2026-06-01"), ("payout", 50000, "2026-09-30")]:
            assert (await a.post(f"/api/investors/{iid}/ledger", json={"type": t, "amount": amt, "date": d})).status_code == 200
        ov = (await a.get("/api/investors/overview")).json()
        assert ov["totals"]["invested"] == 1000000 and ov["totals"]["payouts"] == 50000 and ov["rows"][0]["money"]["return_pct"] == 5.0

        inv = client(app)
        assert (await inv.post("/api/investor/auth/login", json={"email": "ira@example.com", "password": "nope"})).status_code == 401
        r = await inv.post("/api/investor/auth/login", json={"email": "IRA@example.com", "password": "Temp-pass-1"})
        assert r.status_code == 200 and r.json()["must_reset_password"] is True
        d = (await inv.get("/api/investor/dashboard")).json()
        assert "branches" not in d and d["investment"]["invested"] == 1000000 and d["investment"]["share_pct"] == 12.5
        assert d["kpis"]["all_time"]["projects_won"] >= 0 and d["pipeline"]
        assert "Secret Customer Name" not in json.dumps(d) and "9876543210" not in json.dumps(d)
        assert (await inv.get("/api/projects")).status_code == 401                   # investor session can't touch the staff API
        assert (await a.get("/api/investor/dashboard")).status_code == 401           # staff session isn't an investor session
        prev = (await a.get(f"/api/investors/{iid}/preview")).json()
        assert set(prev["sections"]) == set(d["sections"]) and "branches" not in prev
        r = await inv.post("/api/investor/auth/change-password", json={"current_password": "Temp-pass-1", "new_password": "Brand-new-pass-2"})
        assert r.status_code == 200
        assert (await inv.get("/api/investor/me")).json()["must_reset_password"] is False
        # switching the investor off signs them out
        body = {"name": "Ira Investor", "email": "ira@example.com", "active": False, "sections": d["sections"]}
        assert (await a.put(f"/api/investors/{iid}", json=body)).status_code == 200
        assert (await inv.get("/api/investor/dashboard")).status_code == 401
        m = await login(app, "mona@example.com", PW)
        assert (await m.get("/api/investors/overview")).status_code == 403
        for c in (a, inv, m):
            await c.aclose()
    run(loop, go())


def test_investor_login_is_rate_limited(app, loop, world):
    async def go():
        c = client(app)
        codes = [(await c.post("/api/investor/auth/login", json={"email": "nobody@example.com", "password": "x"})).status_code for _ in range(8)]
        assert codes[:6] == [401] * 6 and codes[-1] == 429
        await c.aclose()
    run(loop, go())
