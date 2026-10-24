"""AMC offers, quotes, report, company branding and the one-time joint-venture removal — in-process, no MongoDB server.
    pip install mongomock-motor pytest httpx
    cd backend && pytest tests/test_amc_sales.py
"""
import asyncio
import os
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "amc_sales_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "Adm1n-pass-123")
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-amc-sales-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
import amc_sales  # noqa: E402
import server  # noqa: E402

PW = "Passw0rd!x"


# ───────────── pure helpers ─────────────
def test_quote_plans_math():
    q = amc_sales.quote_plans(5, amc_sales.merge_settings({}), tariff=8)
    basic, standard, premium = q["plans"]
    assert q["annual_generation"] == 7250 and q["units_at_risk"] == 870
    assert basic["price"] == 2500 and basic["gst"] == 450 and basic["total"] == 2950
    assert standard["price"] == 3750 and premium["price"] == 5500
    assert basic["value_protected"] == round(870 * 0.55 * 8)
    assert premium["units_protected"] > standard["units_protected"] > basic["units_protected"]
    assert q["extra_years"] == 7 and q["extra_life_units"] == 7250 * 7 and q["extra_life_value"] == 7250 * 7 * 8
    # tiny plants pay the plan minimum
    assert amc_sales.quote_plans(1, amc_sales.merge_settings({}))["plans"][0]["price"] == 2000
    assert amc_sales.quote_plans(0, amc_sales.merge_settings({}))["plans"][0]["price"] == 0


def test_offer_state_windows():
    s = amc_sales.merge_settings({"offer_after_years": 3, "offer_lead_days": 30})
    today = date(2026, 10, 22)
    assert amc_sales.offer_state(date(2023, 10, 22), today, s) == "due"
    assert amc_sales.offer_state(date(2023, 11, 10), today, s) == "soon"
    assert amc_sales.offer_state(date(2024, 6, 1), today, s) is None
    assert amc_sales.offer_state(date(2023, 1, 1), today, s, dismissed_until="2026-12-01") is None
    assert amc_sales.offer_state(date(2023, 1, 1), today, s, dismissed_until="2026-10-01") == "due"
    assert amc_sales.offer_state(None, today, s) is None
    assert amc_sales.add_years(date(2024, 2, 29), 3) == date(2027, 2, 28)


def test_settings_validation():
    with pytest.raises(Exception):
        amc_sales.clean_settings({"offer_after_years": 0})
    with pytest.raises(Exception):
        amc_sales.clean_settings({"plans": [{"key": "basic", "rate_per_kw": -5}]})
    s = amc_sales.clean_settings({"offer_after_years": 2, "plans": [{"key": "premium", "rate_per_kw": 2000, "includes": ["a", " ", "b"]}]})
    assert s["offer_after_years"] == 2 and s["plans"][2]["rate_per_kw"] == 2000 and s["plans"][2]["includes"] == ["a", "b"]
    assert s["plans"][0]["rate_per_kw"] == 500


# ───────────── API ─────────────
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


def _ago(years: float) -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=round(years * 365.25))).isoformat()


@pytest.fixture(scope="module")
def world(app, loop):
    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        r = await a.post("/api/users", json={"email": "jvmgr@example.com", "password": PW, "name": "Jai Manager", "role": "manager", "phone": "9876500011"})
        assert r.status_code == 200, r.text
        # our finished project, 3+ years old, and one 1 year old
        old = await server.db.projects.insert_one({"status": "completed", "customer": {"name": "Old Customer", "phone": "9000011111", "address": "Erode"},
                                                    "commissioning_date": _ago(3.2), "completed_at": _ago(3.2), "reference_number": "SCR-OLD",
                                                    "custom_fields": {"proposed_solution": {"system_size_kw": 5, "system_type": "on-grid", "tariff_per_unit": 7}},
                                                    "created_at": _ago(3.3)})
        await server.db.projects.insert_one({"status": "completed", "customer": {"name": "New Customer"}, "commissioning_date": _ago(1),
                                             "custom_fields": {"proposed_solution": {"system_size_kw": 3}}, "created_at": _ago(1.1)})
        ours = await a.post("/api/amc/contracts", json={"customer_name": "Our AMC Customer", "system_type": "on-grid", "system_capacity_kw": 10,
                                                         "start_date": _ago(0.1), "annual_value": 12000})
        assert ours.status_code == 200, ours.text
        return {"admin": a, "old_project": str(old.inserted_id), "our_contract": ours.json()["id"]}
    return run(loop, go())


def test_offer_quote_contract_flow(app, loop, world):
    async def go():
        a = world["admin"]
        offers = (await a.get("/api/amc/offers")).json()
        mine = lambda rows: [o for o in rows if o["customer_name"] in ("Old Customer", "New Customer")]  # noqa: E731
        names = [o["customer_name"] for o in mine(offers["rows"])]
        assert names == ["Old Customer"], names               # the 1-year-old plant isn't due yet
        # the bell gets it (admin + manager), once
        await a.get("/api/alerts/dashboard")
        await a.get("/api/alerts/dashboard")
        notes = [n async for n in server.db.notifications.find({"kind": "amc_offer", "source_id": world["old_project"]})]
        bosses = await server.db.users.count_documents({"role": {"$in": ["admin", "manager"]}, "active": {"$ne": False}})
        assert len(notes) == bosses >= 2 and all(n["status"] == "pending" for n in notes)
        # quote it
        q = await a.post("/api/amc/quotes", json={"source_type": "project", "source_id": world["old_project"]})
        assert q.status_code == 200, q.text
        qj = q.json()
        assert qj["customer_name"] == "Old Customer" and qj["system_capacity_kw"] == 5 and qj["tariff"] == 7
        assert [p["key"] for p in qj["calc"]["plans"]] == ["basic", "standard", "premium"]
        assert qj["quote_number"].startswith("AMCQ-")
        notes = [n async for n in server.db.notifications.find({"kind": "amc_offer", "source_id": world["old_project"]})]
        assert all(n["status"] == "resolved" for n in notes)
        row = mine((await a.get("/api/amc/offers")).json()["rows"])[0]
        assert row["quote"]["number"] == qj["quote_number"]
        # a staff login (no AMC page) can't quote
        await a.post("/api/users", json={"email": "ravi.staff@example.com", "password": PW, "name": "Ravi Staff", "role": "staff", "phone": "9876500013"})
        st = await login(app, "ravi.staff@example.com", PW)
        assert (await st.post("/api/amc/quotes", json={"source_type": "project", "source_id": world["old_project"]})).status_code == 403
        # customer says yes to Standard
        r = await a.post(f"/api/amc/quotes/{qj['id']}/accept", json={"plan_key": "standard"})
        assert r.status_code == 200, r.text
        c = r.json()["contract"]
        assert c["annual_value"] == 3750 and c["visits_per_year"] == 4 and c["project_id"] == world["old_project"] and "org_id" not in c
        assert (await a.post(f"/api/amc/quotes/{qj['id']}/accept", json={"plan_key": "basic"})).status_code == 400
        assert mine((await a.get("/api/amc/offers")).json()["rows"]) == []
        assert (await a.post("/api/amc/quotes", json={"source_type": "jv_project", "source_id": world["old_project"]})).status_code == 400
        assert (await a.post(f"/api/amc/offers/jv_project/{world['old_project']}", json={"action": "later"})).status_code == 400
    run(loop, go())


def test_settings_are_admin_only_and_move_the_offer_date(app, loop, world):
    async def go():
        a = world["admin"]
        m = await login(app, "jvmgr@example.com", PW)
        assert (await m.get("/api/amc/settings")).status_code == 200
        assert (await m.put("/api/amc/settings", json={"offer_after_years": 1})).status_code == 403
        assert (await m.get("/api/amc/jv/partners")).status_code == 404       # the joint venture is gone
        assert (await a.put("/api/amc/settings", json={"offer_after_years": 0})).status_code == 400
        s = (await a.put("/api/amc/settings", json={"offer_after_years": 0.9, "offer_lead_days": 0})).json()
        assert s["offer_after_years"] == 0.9
        names = [o["customer_name"] for o in (await a.get("/api/amc/offers")).json()["rows"]]
        assert "New Customer" in names
        await a.put("/api/amc/settings", json={"offer_after_years": 3, "offer_lead_days": 30})
    run(loop, go())


# ───────────── live refresh ─────────────
def test_topic_mapping():
    from live_sync import topic_for
    assert topic_for("POST", "/api/projects") == "projects"
    assert topic_for("PUT", "/api/inventory/items/abc") == "inventory"
    assert topic_for("POST", "/api/material-kits") == "inventory"
    assert topic_for("POST", "/api/purchase-orders/1/approve") == "purchases"
    assert topic_for("GET", "/api/projects") is None
    assert topic_for("POST", "/api/auth/login") is None
    assert topic_for("POST", "/api/upload/image") is None
    assert topic_for("POST", "/api/amc/quotes/preview") is None
    assert topic_for("POST", "/api/amc/quotes") == "amc"


def test_saves_bump_the_area_counter(app, loop, world):
    async def go():
        a = world["admin"]
        before = (await a.get("/api/sync/version")).json()["topics"].get("amc", {}).get("v", 0)
        r = await a.post("/api/amc/contracts", json={"customer_name": "Sync Check", "system_type": "on-grid", "system_capacity_kw": 2, "start_date": _ago(0.01), "annual_value": 1000})
        assert r.status_code == 200
        after = (await a.get("/api/sync/version")).json()["topics"]["amc"]["v"]
        assert after == before + 1
        # a refused change doesn't count
        assert (await a.post("/api/amc/contracts", json={"customer_name": "x"})).status_code == 422
        assert (await a.get("/api/sync/version")).json()["topics"]["amc"]["v"] == after
    run(loop, go())


# ───────────── Oct 2026 batch 2: metrics, terms, "others", hard delete, support page, AMC company ─────────────
def test_dashboard_has_the_bigger_picture(app, loop, world):
    async def go():
        d = (await world["admin"].get("/api/amc/dashboard")).json()
        for k in ("total_kw", "count_by_type", "value_per_kw", "avg_contract_value", "contracts_total", "new_this_year", "visits_done_year",
                  "visits_next_30", "plan_mix", "top_districts", "monthly", "quotes_open", "quote_win_pct", "tickets_open", "collection_pct"):
            assert k in d, k
        assert d["total_kw"] == round(sum(r["kw"] for r in d["top_districts"]), 1) or len(d["top_districts"]) == 6
        assert len(d["monthly"]) == 12 and d["total_kw"] > 0
    run(loop, go())


def test_quote_terms_and_other_system_types(app, loop, world):
    async def go():
        a = world["admin"]
        t = (await a.get("/api/amc/quotes/terms")).json()
        assert t["default_text"] == amc_sales.DEFAULT_TERMS and t["templates"] == []
        r = await a.post("/api/terms", json={"title": "AMC terms 2026", "content": "<p>Fee is yearly.</p><ul><li>Visits as per plan</li></ul>", "category": "amc"})
        assert r.status_code == 200, r.text
        tid = r.json().get("id")
        await a.put(f"/api/terms/{tid}", json={"is_active": True})
        t = (await a.get("/api/amc/quotes/terms")).json()
        assert t["default_text"] == "Fee is yearly.\n• Visits as per plan" and t["templates"][0]["title"] == "AMC terms 2026"
        q = await a.post("/api/amc/quotes", json={"customer_name": "UPS Owner", "system_capacity_kw": 4, "system_type": "others", "system_type_other": "UPS + batteries"})
        assert q.status_code == 200, q.text
        assert q.json()["system_type_other"] == "UPS + batteries" and q.json()["terms_text"].startswith("Fee is yearly")
        q2 = (await a.post("/api/amc/quotes", json={"customer_name": "Own Terms", "system_capacity_kw": 4, "terms_text": "1. Our own words"})).json()
        assert q2["terms_text"] == "1. Our own words"
        assert (await a.post("/api/amc/quotes", json={"customer_name": "Bad", "system_capacity_kw": 4, "system_type": "wind"})).status_code == 400
        assert (await a.post("/api/amc/contracts", json={"customer_name": "X", "system_type": "others", "start_date": _ago(0.01)})).status_code == 400
        c = await a.post("/api/amc/contracts", json={"customer_name": "Street lights", "system_type": "others", "system_type_other": "Solar street lights",
                                                    "start_date": _ago(0.01), "notes": "Gate code 4411"})
        assert c.status_code == 200 and c.json()["notes"] == "Gate code 4411" and c.json()["system_type_other"] == "Solar street lights"
    run(loop, go())


def test_cancelled_contracts_are_deleted_only_by_admins(app, loop, world):
    async def go():
        a = world["admin"]
        c = (await a.post("/api/amc/contracts", json={"customer_name": "To Delete", "system_type": "on-grid", "system_capacity_kw": 3, "start_date": _ago(0.02)})).json()
        await a.post(f"/api/amc/contracts/{c['id']}/schedule", json={"scheduled_date": _ago(-0.02)})
        assert (await a.delete(f"/api/amc/contracts/{c['id']}?confirm={c['contract_number']}")).status_code == 400   # still active
        await a.post(f"/api/amc/contracts/{c['id']}/cancel", json={"reason": "duplicate"})
        m = await login(app, "jvmgr@example.com", PW)
        assert (await m.delete(f"/api/amc/contracts/{c['id']}?confirm={c['contract_number']}")).status_code == 403
        assert (await a.delete(f"/api/amc/contracts/{c['id']}?confirm=WRONG")).status_code == 400
        r = await a.delete(f"/api/amc/contracts/{c['id']}?confirm={c['contract_number'].lower()}")
        assert r.status_code == 200 and r.json()["visits_deleted"] == 1
        assert (await a.get(f"/api/amc/contracts/{c['id']}")).status_code == 404
        assert await server.db.amc_service_visits.count_documents({"contract_id": c["id"]}) == 0
        assert await server.db.audit_logs.find_one({"action_type": "amc_contract_deleted", "entity_id": c["id"]})
    run(loop, go())


def test_customer_support_is_its_own_page(app, loop, world):
    async def go():
        a = world["admin"]
        await a.post("/api/users", json={"email": "sita.staff@example.com", "password": PW, "name": "Sita Staff", "role": "staff", "phone": "9876500012"})
        s = await login(app, "sita.staff@example.com", PW)
        m = await login(app, "jvmgr@example.com", PW)
        assert (await m.get("/api/support/tickets")).status_code == 200
        assert (await s.get("/api/support/tickets")).status_code == 403
        perms = (await m.get("/api/permissions/me")).json()["permissions"]
        assert perms["module_support"]["view"] and perms["module_support"]["create"]
        # an admin can open it to staff on the Permissions page, separately from AMC
        cur = (await a.get("/api/permissions")).json()["staff"]
        cur["module_support"] = {"view": True, "create": True, "edit": False, "delete": False, "export": False}
        assert (await a.put("/api/permissions/staff", json={"permissions": cur})).status_code == 200
        server._PERM_CACHE.clear()
        assert (await s.get("/api/support/tickets")).status_code == 200
        assert (await s.get("/api/amc/contracts")).status_code == 403
        cur["module_support"] = {"view": False, "create": False, "edit": False, "delete": False, "export": False}
        await a.put("/api/permissions/staff", json={"permissions": cur}); server._PERM_CACHE.clear()
    run(loop, go())


def test_amc_documents_use_the_chosen_company(app, loop, world):
    async def go():
        a = world["admin"]
        r = await a.post("/api/company", json={"company_name": "Solar Care Co", "address": "1 Ring Rd, Erode", "phone": "9000012345", "email": "hi@solarcare.example",
                                               "logo_url": "data:image/png;base64,iVBORw0KGgo=", "gst_number": "33AAAAA0000A1Z5"})
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        s = (await a.get("/api/amc/settings")).json()
        assert (await a.put("/api/amc/settings", json={**s, "brand_company_id": "6ad9" + "0" * 20})).status_code == 400
        s2 = (await a.put("/api/amc/settings", json={**s, "brand_company_id": cid})).json()
        assert s2["brand_company_id"] == cid
        b = (await a.get("/api/amc/brand")).json()
        assert b["company_name"] == "Solar Care Co" and b["chosen"] and b["logo_base64"].startswith("data:image/png") and b["gst_number"] == "33AAAAA0000A1Z5"
        await a.put("/api/amc/settings", json={**s2, "brand_company_id": None})
        assert (await a.get("/api/amc/brand")).json()["chosen"] is False
    run(loop, go())


# ───────────── the joint venture is removed once, and only its records go ─────────────
def test_joint_venture_data_is_erased_once(app, loop, world):
    async def go():
        db = server.db
        await db.migrations.delete_one({"_id": amc_sales.JV_REMOVED})
        pid = str((await db.jv_partners.insert_one({"name": "Sun Care Services", "logo_path": "sensoper-solar/images/old-logo.png"})).inserted_id)
        await db.users.insert_one({"email": "pat@suncare.example", "name": "Pat Partner", "role": "partner", "partner_id": pid, "password_hash": "x",
                                   "created_at": _ago(0.2)})
        jp = str((await db.jv_projects.insert_one({"org_id": pid, "customer_name": "Partner Plant", "photos": []})).inserted_id)
        theirs = await db.amc_contracts.insert_one({"org_id": pid, "jv_project_id": jp, "customer_name": "Partner AMC", "status": "active",
                                                    "contract_number": "AMC-9001", "start_date": _ago(0.1)})
        tid = str(theirs.inserted_id)
        await db.amc_service_visits.insert_one({"contract_id": tid, "status": "scheduled", "scheduled_date": _ago(-0.05)})
        await db.notifications.insert_one({"contract_id": tid, "kind": "amc_visit", "status": "pending"})
        await db.amc_quotes.insert_one({"org_id": pid, "quote_number": "AMCQ-9001", "source_type": "jv_project", "source_id": jp})
        await db.amc_offer_flags.insert_one({"source_type": "jv_project", "source_id": jp, "action": "later"})
        ticket = await db.support_tickets.insert_one({"ticket_number": "TKT-9001", "amc_contract_id": tid, "status": "open"})
        ours_before = await db.amc_contracts.count_documents({"org_id": {"$in": [None, ""]}})
        quotes_before = await db.amc_quotes.count_documents({"org_id": {"$in": [None, ""]}})
        removed = []
        counts = await amc_sales.remove_joint_venture(db, delete_file=removed.append)
        assert counts["contracts"] == 1 and counts["visits"] == 1 and counts["quotes"] == 1 and counts["logins"] == 1
        assert counts["partners"] == 1 and counts["projects"] == 1 and counts["offer_flags"] == 1 and counts["reminders"] >= 1
        assert removed == ["sensoper-solar/images/old-logo.png"]
        assert await db.amc_contracts.find_one({"contract_number": "AMC-9001"}) is None
        assert await db.users.find_one({"email": "pat@suncare.example"}) is None
        assert await db.amc_contracts.count_documents({}) == ours_before and await db.amc_quotes.count_documents({}) == quotes_before
        assert await db.amc_contracts.count_documents({"org_id": {"$exists": True}}) == 0
        assert (await db.support_tickets.find_one({"_id": ticket.inserted_id}))["amc_contract_id"] is None
        assert await db.audit_logs.find_one({"action_type": "joint_venture_removed"})
        # runs once
        assert await amc_sales.remove_joint_venture(db) is None
        # numbers still add up after the removal
        d = (await world["admin"].get("/api/amc/dashboard")).json()
        assert d["active_contracts"] == await db.amc_contracts.count_documents({"status": "active"})
    run(loop, go())
