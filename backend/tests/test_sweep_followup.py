"""Nov 2026 sweep, follow-up: branch scoping by id, subsidy permissions, one invoice per project, GST state codes,
overnight shifts, interest-only loan payments, no built-in admin password, CORS.
In-process, no MongoDB server:
    cd backend && pytest tests/test_sweep_followup.py
"""
import asyncio
import os
import re
import secrets
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "sweep_followup_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "t-" + secrets.token_hex(12))   # random per run — the in-memory app seeds this admin
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-sweep-followup-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
from bson import ObjectId  # noqa: E402
import server  # noqa: E402
import sales  # noqa: E402
import loans  # noqa: E402
import gst_state  # noqa: E402
import attendance  # noqa: E402

PW = "pw-" + secrets.token_hex(8)   # for the users this test creates (random per run)
TAG = "sweep-followup-test"


# ───────────── pure rules ─────────────
def test_gst_state_codes():
    for v in ("TN", "Tamilnadu", " tamil  nadu ", "Tamil Nadu", "33", 33, "33AABCS1234F1Z5", "t.n."):
        assert gst_state.state_code(v) == "33", v
    assert gst_state.state_code("Karnataka") == "29" and gst_state.state_code("28") == "37" and gst_state.state_code("Orissa") == "21"
    assert gst_state.state_code("Andaman and Nicobar Islands") == "35" and gst_state.state_code("Atlantis") is None
    assert gst_state.is_inter_state("Tamil Nadu", None, "TN", None) is False
    assert gst_state.is_inter_state("Tamil Nadu", "33AABCS1234F1Z5", "Tamil Nadu", "29AABCX1234F1Z5") is True   # the GSTIN wins
    assert gst_state.is_inter_state("tamil nadu", None, "Kerala", None) is True
    cgst, sgst, igst = sales._split_gst([{"gst_amount": 180}], "Tamilnadu", "Tamil Nadu")
    assert (cgst, sgst, igst) == (90, 90, 0)


def test_interest_only_payment_settles_interest_to_its_date():
    loan = {"disbursed_amount": 100000, "interest_rate": 12, "disbursal_date": "2026-01-01"}
    pays = [{"date": "2026-02-01", "kind": "interest", "amount": 1000}, {"date": "2026-02-15", "kind": "emi", "amount": 5000}]
    emi = loans.apply_payments(loan, pays)["payments"][1]
    assert emi["interest_part"] == 0 and emi["principal_part"] == 5000   # Feb's interest was already paid on 1 Feb
    pays = [{"date": "2026-02-01", "kind": "interest", "amount": 1000}, {"date": "2026-03-01", "kind": "emi", "amount": 5000}]
    emi = loans.apply_payments(loan, pays)["payments"][1]
    assert emi["interest_part"] == 1000 and emi["principal_part"] == 4000   # one month since the interest payment
    plain = loans.apply_payments(loan, [{"date": "2026-02-01", "kind": "emi", "amount": 5000}])["payments"][0]
    assert plain["interest_part"] == 1000   # an EMI after an EMI still carries at least a month


def test_cors_never_echoes_any_origin():
    assert server.cors_origins(None) == [] and server.cors_origins("*") == [] and server.cors_origins(" , ") == []
    assert server.cors_origins("https://a.example.in, https://b.example.in/,*") == ["https://a.example.in", "https://b.example.in"]


def test_no_built_in_admin_password_in_the_code():
    src = open(os.path.join(os.path.dirname(server.__file__), "server.py")).read()
    # no "ADMIN_PASSWORD or <a literal>" fallback anywhere: the admin password only ever comes from the environment
    assert not re.search(r"""(ADMIN_PASSWORD|admin_password)[^\n]*\bor\s*(["'])[^"'\n]+\2""", src)


# ───────────── the API ─────────────
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


def client(app, origin=None):
    h = {"x-forwarded-proto": "https"}
    if origin:
        h["origin"] = origin
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://quote.example.in", headers=h)


async def login(app, email, password):
    c = client(app)
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


PROJECT = {"electrical": {"sanction_load_kw": 3, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 7},
           "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "fixed"},
           "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10}, "solar_system": {"system_type": "on-grid", "capacity_kw": 3},
           "selected_items": [{"name": "SPD kit", "category": "bos", "unit_price": 4000, "quantity": 1, "gst_percentage": 18, "margin_percentage": 10}],
           "manual_costs": []}


@pytest.fixture(scope="module")
def world(app, loop):
    async def go():
        db = server.db
        a = await login(app, ADMIN["email"], ADMIN["password"])
        north = str((await db.locations.insert_one({"name": f"North {TAG}", "code": "NTH", "active": True})).inserted_id)
        south = str((await db.locations.insert_one({"name": f"South {TAG}", "code": "STH", "active": True})).inserted_id)
        users = {}
        for key, role, locs in (("staff_n", "staff", [north]), ("mgr_n", "manager", [north]), ("staff_all", "staff", [])):
            email = f"{key}.{TAG}@example.com"
            r = await a.post("/api/users", json={"email": email, "password": PW, "name": key, "role": role})
            assert r.status_code == 200, r.text
            await db.users.update_one({"email": email}, {"$set": {"location_ids": locs, "default_location_id": (locs or [None])[0]}})
            users[key] = await login(app, email, PW)
        ids = {}
        for name, loc in (("north", north), ("south", south)):
            r = await a.post("/api/projects", json={**PROJECT, "customer": {"name": f"{TAG} {name}", "phone": "9000000071", "address": "x"},
                                                    "location": {"address": "x", "state": "TN"}})
            assert r.status_code == 200, r.text
            pid = r.json()["id"]
            await db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"location_id": loc}})
            ids[f"project_{name}"] = pid
            ids[f"item_{name}"] = str((await db.inventory_items.insert_one({"name": f"{TAG} {name} item", "sku_code": f"SF-{secrets.token_hex(3)}",
                                                                              "category": "bos", "quantity": 5, "unit_price": 100, "location_id": loc})).inserted_id)
            ids[f"delivery_{name}"] = str((await db.deliveries.insert_one({"project_id": pid, "items": [], "status": "dispatched", "location_id": loc})).inserted_id)
            ids[f"asset_{name}"] = str((await db.assets.insert_one({"name": f"{TAG} {name} drill", "category": "tools", "status": "available", "location_id": loc})).inserted_id)
            await db.support_tickets.insert_one({"ticket_number": f"T-{name}", "customer_name": f"{TAG} {name}", "status": "open", "priority": "medium",
                                                "created_at": datetime.now(timezone.utc).isoformat(), "location_id": loc})
        own = await users["staff_n"].post("/api/projects", json={**PROJECT, "customer": {"name": f"{TAG} own", "phone": "9000000072", "address": "x"},
                                                                  "location": {"address": "x", "state": "Tamil Nadu"}})
        assert own.status_code == 200, own.text
        ids["project_own"] = own.json()["id"]
        await db.projects.update_one({"_id": ObjectId(ids["project_own"])}, {"$set": {"location_id": north}})
        return {"admin": a, "north": north, "south": south, **users, **ids}

    async def tidy():
        db = server.db
        await db.users.delete_many({"email": {"$regex": TAG}})
        await db.locations.delete_many({"name": {"$regex": TAG}})
        await db.projects.delete_many({"customer.name": {"$regex": TAG}})
        await db.inventory_items.delete_many({"name": {"$regex": TAG}})
        await db.assets.delete_many({"name": {"$regex": TAG}})
        await db.support_tickets.delete_many({"customer_name": {"$regex": TAG}})

    w = run(loop, go())
    yield w
    run(loop, tidy())


def test_another_branchs_records_read_as_not_found(app, loop, world):
    async def go():
        mgr, staff_all, a = world["mgr_n"], world["staff_all"], world["admin"]
        south_urls = [("GET", f"/api/projects/{world['project_south']}"), ("PUT", f"/api/projects/{world['project_south']}"),
                      ("GET", f"/api/inventory/items/{world['item_south']}"), ("PUT", f"/api/inventory/items/{world['item_south']}"),
                      ("PUT", f"/api/deliveries/{world['delivery_south']}"), ("DELETE", f"/api/deliveries/{world['delivery_south']}"),
                      ("GET", f"/api/assets/{world['asset_south']}"), ("GET", f"/api/projects/{world['project_south']}/invoice"),
                      ("POST", f"/api/projects/{world['project_south']}/invoice")]
        for method, url in south_urls:
            r = await mgr.request(method, url, json={})
            assert r.status_code == 404, (method, url, r.status_code, r.text[:200])
        assert (await mgr.get(f"/api/projects/{world['project_north']}")).status_code == 200
        assert (await mgr.get(f"/api/inventory/items/{world['item_north']}")).status_code == 200
        assert (await a.get(f"/api/projects/{world['project_south']}")).status_code == 200          # admins: every branch
        assert (await staff_all.get(f"/api/inventory/items/{world['item_south']}")).status_code == 200   # no branch = all
        # body ids too: a payment or a delivery against another branch's project
        r = await mgr.post("/api/payments", json={"project_id": world["project_south"], "amount": 1000, "payment_method": "cash"})
        assert r.status_code == 404, r.text
        r = await mgr.post("/api/deliveries", json={"project_id": world["project_south"], "customer_name": "x", "items": []})
        assert r.status_code == 404, r.text
        # lists that weren't filtered by branch
        names = [t["customer_name"] for t in (await mgr.get("/api/support/tickets")).json() if TAG in t.get("customer_name", "")] \
            if isinstance((await mgr.get("/api/support/tickets")).json(), list) else \
            [t["customer_name"] for t in (await mgr.get("/api/support/tickets")).json().get("tickets", []) if TAG in t.get("customer_name", "")]
        assert f"{TAG} north" in names and f"{TAG} south" not in names, names
        assets = [x["name"] for x in (await mgr.get("/api/assets")).json() if TAG in x["name"]]
        assert f"{TAG} north drill" in assets and f"{TAG} south drill" not in assets
    run(loop, go())


def test_subsidy_tracking_needs_project_edit_and_the_projects_branch(app, loop, world):
    async def go():
        staff = world["staff_n"]
        body = {"status": "applied", "application_date": "2026-10-01"}
        assert (await staff.post("/api/subsidy/tracking", json={**body, "project_id": world["project_south"]})).status_code == 404
        assert (await staff.post("/api/subsidy/tracking", json={**body, "project_id": world["project_north"]})).status_code == 403   # not theirs
        assert (await staff.post("/api/subsidy/tracking", json={**body, "project_id": world["project_own"]})).status_code == 200
        db = server.db
        perms = await server.get_permissions("staff")
        await db.role_permissions.update_one({"role_name": "staff"}, {"$set": {"role_name": "staff", "permissions": {**perms, "module_projects": {**perms["module_projects"], "edit": False}}}}, upsert=True)
        server._PERM_CACHE.clear()
        try:
            r = await staff.post("/api/subsidy/tracking", json={**body, "project_id": world["project_own"]})
            assert r.status_code == 403, r.text
        finally:
            await db.role_permissions.update_one({"role_name": "staff"}, {"$set": {"permissions": perms}})
            server._PERM_CACHE.clear()
    run(loop, go())


def test_a_double_click_makes_one_project_invoice(app, loop, world):
    async def go():
        a, db = world["admin"], server.db
        pid = world["project_north"]
        before = (await db.invoice_settings.find_one({"key": "defaults"}) or {}).get("last_used_number", 0)
        r1, r2 = await asyncio.gather(a.post(f"/api/projects/{pid}/invoice", json={}), a.post(f"/api/projects/{pid}/invoice", json={}))
        good = [r for r in (r1, r2) if r.status_code == 200]
        assert good and all(r.status_code in (200, 409) for r in (r1, r2)), (r1.text, r2.text)
        assert await db.project_invoices.count_documents({"project_id": pid}) == 1
        after = (await db.invoice_settings.find_one({"key": "defaults"}) or {}).get("last_used_number", 0)
        assert after == before + 1, "only one invoice number is used"
        again = await a.post(f"/api/projects/{pid}/invoice", json={})
        assert again.json()["already_existed"] is True and again.json()["invoice_number"] == good[0].json()["invoice_number"]
        inv = good[0].json()
        # site state "TN", company Tamil Nadu: intra-state
        assert inv["total_igst"] == 0 and inv["total_cgst"] > 0
    run(loop, go())


def test_a_shift_past_midnight_checks_out_on_its_check_in(app, loop, world):
    async def go():
        db, staff = server.db, world["staff_n"]
        me = (await staff.get("/api/auth/me")).json()["id"]
        yesterday = (datetime.now(timezone.utc).astimezone(attendance.IST).date() - timedelta(days=1)).isoformat()
        started = (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat()
        rec = await db.attendance.insert_one({"user_id": me, "date": yesterday, "check_in": {"at": started}, "check_out": None, "corrections": []})
        try:
            today = (await staff.get("/api/attendance/me/today")).json()
            assert today["record"] and today["record"]["state"] == "checked_in"
            assert (await staff.post("/api/attendance/check-in", json={"lat": 11.3, "lng": 77.7})).status_code == 400
            r = await staff.post("/api/attendance/check-out", json={"lat": 11.3, "lng": 77.7})
            assert r.status_code == 200, r.text
            assert r.json()["date"] == yesterday and r.json()["worked_minutes"] >= 7 * 60 - 1
            # an open check-in older than the longest shift isn't picked up
            await db.attendance.update_one({"_id": rec.inserted_id}, {"$set": {"check_out": None, "check_in": {"at": (datetime.now(timezone.utc) - timedelta(hours=20)).isoformat()}}})
            assert (await staff.post("/api/attendance/check-out", json={"lat": 11.3, "lng": 77.7})).json()["detail"] == "Check in first."
        finally:
            await db.attendance.delete_many({"user_id": me})
    run(loop, go())


def test_no_admin_is_created_without_admin_password(app, loop, world, monkeypatch):
    async def go():
        db = server.db
        email = f"fresh-admin.{TAG}@example.com"
        monkeypatch.setenv("ADMIN_EMAIL", email)
        monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
        assert await server.seed_admin_user() == "skipped"
        assert await db.users.find_one({"email": email}) is None
        monkeypatch.setenv("ADMIN_PASSWORD", "x-" + secrets.token_hex(8))
        assert await server.seed_admin_user() == "created"
        assert await server.seed_admin_user() == "exists"
        await db.users.delete_one({"email": email})
    run(loop, go())


def test_other_sites_get_no_cors_access(app, loop, world):
    async def go():
        evil = client(app, origin="https://evil.example.com")
        pre = await evil.options("/api/auth/me", headers={"access-control-request-method": "GET"})
        assert "access-control-allow-origin" not in {k.lower() for k in pre.headers}
        r = await evil.get("/api/health")
        assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
    run(loop, go())
