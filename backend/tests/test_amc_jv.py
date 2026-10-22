"""AMC joint venture, offers, quotes and report — in-process, no MongoDB server.
    pip install mongomock-motor pytest httpx
    cd backend && pytest tests/test_amc_jv.py
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
os.environ.setdefault("DB_NAME", "amc_jv_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "Adm1n-pass-123")
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-amc-jv-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
import amc_jv  # noqa: E402
import server  # noqa: E402

PW = "Passw0rd!x"


# ───────────── pure helpers ─────────────
def test_quote_plans_math():
    q = amc_jv.quote_plans(5, amc_jv.merge_settings({}), tariff=8)
    basic, standard, premium = q["plans"]
    assert q["annual_generation"] == 7250 and q["units_at_risk"] == 870
    assert basic["price"] == 2500 and basic["gst"] == 450 and basic["total"] == 2950
    assert standard["price"] == 3750 and premium["price"] == 5500
    assert basic["value_protected"] == round(870 * 0.55 * 8)
    assert premium["units_protected"] > standard["units_protected"] > basic["units_protected"]
    assert q["extra_years"] == 7 and q["extra_life_units"] == 7250 * 7 and q["extra_life_value"] == 7250 * 7 * 8
    # tiny plants pay the plan minimum
    assert amc_jv.quote_plans(1, amc_jv.merge_settings({}))["plans"][0]["price"] == 2000
    assert amc_jv.quote_plans(0, amc_jv.merge_settings({}))["plans"][0]["price"] == 0


def test_offer_state_windows():
    s = amc_jv.merge_settings({"offer_after_years": 3, "offer_lead_days": 30})
    today = date(2026, 10, 22)
    assert amc_jv.offer_state(date(2023, 10, 22), today, s) == "due"
    assert amc_jv.offer_state(date(2023, 11, 10), today, s) == "soon"
    assert amc_jv.offer_state(date(2024, 6, 1), today, s) is None
    assert amc_jv.offer_state(date(2023, 1, 1), today, s, dismissed_until="2026-12-01") is None
    assert amc_jv.offer_state(date(2023, 1, 1), today, s, dismissed_until="2026-10-01") == "due"
    assert amc_jv.offer_state(None, today, s) is None
    assert amc_jv.add_years(date(2024, 2, 29), 3) == date(2027, 2, 28)


def test_mask_and_settings_validation():
    ours = {"contract_number": "AMC-1", "annual_value": 9000, "outstanding": 100, "org_id": None, "project_id": "p1"}
    partner = {"role": "partner", "partner_id": "x1"}
    m = amc_jv.mask_for_partner(ours, partner)
    assert "annual_value" not in m and "outstanding" not in m and "project_id" not in m and m["money_hidden"]
    theirs = {**ours, "org_id": "x1"}
    assert amc_jv.mask_for_partner(theirs, partner)["annual_value"] == 9000
    assert amc_jv.mask_for_partner(ours, {"role": "manager"})["annual_value"] == 9000
    with pytest.raises(Exception):
        amc_jv.clean_settings({"offer_after_years": 0})
    with pytest.raises(Exception):
        amc_jv.clean_settings({"plans": [{"key": "basic", "rate_per_kw": -5}]})
    s = amc_jv.clean_settings({"offer_after_years": 2, "plans": [{"key": "premium", "rate_per_kw": 2000, "includes": ["a", " ", "b"]}]})
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
        p = await a.post("/api/amc/jv/partners", json={"name": "Sun Care Services", "contact_name": "Ravi", "phone": "9000000001"})
        assert p.status_code == 200, p.text
        pid = p.json()["id"]
        u = await a.post(f"/api/amc/jv/partners/{pid}/users", json={"name": "Pat Partner", "email": "pat@suncare.example", "password": PW})
        assert u.status_code == 200, u.text
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
        return {"admin": a, "partner_id": pid, "old_project": str(old.inserted_id), "our_contract": ours.json()["id"]}
    return run(loop, go())


def test_partner_is_kept_to_the_amc_page(app, loop, world):
    async def go():
        pt = await login(app, "pat@suncare.example", PW)
        me = (await pt.get("/api/auth/me")).json()
        assert me["role"] == "partner" and me["partner_id"] == world["partner_id"] and me["daily_report_required"] is False
        for path in ("/api/projects", "/api/dashboard/stats", "/api/inventory/items", "/api/users", "/api/accounts/summary",
                     "/api/investors", "/api/amc/follow-ups", "/api/amc/outbox", "/api/amc/recurring-revenue-report", "/api/support/tickets"):
            r = await pt.get(path)
            assert r.status_code == 403, (path, r.status_code)
        r = await pt.post(f"/api/amc/contracts/from-project/{world['old_project']}")
        assert r.status_code == 403
        perms = (await pt.get("/api/permissions/me")).json()["permissions"]
        assert perms["module_amc"]["view"] and not perms["module_projects"]["view"] and not perms["module_inventory"]["view"]

        # sees our contract, without money
        rows = (await pt.get("/api/amc/contracts")).json()
        ours = next(c for c in rows if c["id"] == world["our_contract"])
        assert "annual_value" not in ours and ours["money_hidden"]
        one = (await pt.get(f"/api/amc/contracts/{world['our_contract']}")).json()
        assert "annual_value" not in one and "outstanding" not in one
        # can't change or cancel ours
        assert (await pt.put(f"/api/amc/contracts/{world['our_contract']}", json={"annual_value": 1})).status_code == 403
        assert (await pt.post(f"/api/amc/contracts/{world['our_contract']}/cancel", json={})).status_code == 403

        # its own work: project + contract, always its own company
        jp = await pt.post("/api/amc/jv/projects", json={"customer_name": "Partner Plant", "system_capacity_kw": 8, "system_type": "on-grid",
                                                         "commissioning_date": _ago(3.5), "org_id": None})
        assert jp.status_code == 200, jp.text
        assert jp.json()["org_id"] == world["partner_id"]
        c = await pt.post("/api/amc/contracts", json={"customer_name": "Partner AMC", "system_type": "on-grid", "system_capacity_kw": 6,
                                                      "start_date": _ago(0.05), "annual_value": 7000, "org_id": None, "project_id": world["old_project"]})
        assert c.status_code == 200, c.text
        cj = c.json()
        assert cj["org_id"] == world["partner_id"] and cj["project_id"] is None and cj["annual_value"] == 7000
        # can't move it into our books
        r = await pt.put(f"/api/amc/contracts/{cj['id']}", json={"org_id": None, "annual_value": 7500})
        assert r.status_code == 200
        doc = await server.db.amc_contracts.find_one({"contract_number": cj["contract_number"]})
        assert doc["org_id"] == world["partner_id"] and doc["annual_value"] == 7500

        # its numbers are its own
        d = (await pt.get("/api/amc/dashboard?org=ours")).json()
        assert d["active_contracts"] == 1 and d["arr"] == 7500
        # offers: only its own plant
        offers = (await pt.get("/api/amc/offers")).json()["rows"]
        assert [o["customer_name"] for o in offers] == ["Partner Plant"]
        # logo: own company yes, nothing else
        assert (await pt.put(f"/api/amc/jv/partners/{world['partner_id']}/logo", json={"logo_path": "sensoper-solar/images/abc-123.png"})).status_code == 200
        assert (await pt.put(f"/api/amc/jv/partners/{world['partner_id']}/logo", json={"logo_path": "../../etc/passwd"})).status_code == 400
        assert (await pt.put(f"/api/amc/jv/partners/{world['partner_id']}", json={"name": "Hijack"})).status_code == 403
        assert (await pt.put("/api/amc/settings", json={})).status_code == 403
        world["partner_contract"] = cj["id"]
        world["jv_project"] = jp.json()["id"]
    run(loop, go())


def test_partner_work_never_counts_as_ours(app, loop, world):
    async def go():
        a = world["admin"]
        ours = (await a.get("/api/amc/dashboard")).json()
        assert ours["active_contracts"] == 1 and ours["arr"] == 12000
        both = (await a.get("/api/amc/dashboard?org=all")).json()
        assert both["active_contracts"] == 2 and both["arr"] == 19500
        theirs = (await a.get(f"/api/amc/dashboard?org={world['partner_id']}")).json()
        assert theirs["active_contracts"] == 1 and theirs["arr"] == 7500
        rep = (await a.get("/api/reports/amc")).json()
        assert rep["summary"]["active_contracts"] == 1 and rep["summary"]["arr"] == 12000
        biz = (await a.get("/api/investors/business?months=12")).json()
        assert biz["amc"]["active_contracts"] == 1 and biz["amc"]["yearly_income"] == 12000
        # partner people are not our staff
        team = (await a.get(f"/api/daily-reports/team?date={datetime.now(timezone.utc).date().isoformat()}")).json()
        assert all(r.get("name") != "Pat Partner" for r in team.get("rows", []))
        # the shared list shows every company, clearly marked
        rows = (await a.get("/api/amc/contracts")).json()
        assert {r.get("org_name") for r in rows} == {None, "Sun Care Services"}
        rep = (await a.get("/api/amc/report?org=all")).json()
        assert {r["org_name"] for r in rep["by_org"]} == {"Sensoper", "Sun Care Services"}
        assert rep["summary"]["active_contracts"] == 2
    run(loop, go())


def test_offer_quote_contract_flow(app, loop, world):
    async def go():
        a = world["admin"]
        offers = (await a.get("/api/amc/offers")).json()
        mine = lambda rows: [o for o in rows if o["customer_name"] in ("Old Customer", "New Customer", "Partner Plant")]  # noqa: E731
        names = [o["customer_name"] for o in mine(offers["rows"])]
        assert names == ["Old Customer"], names               # ours only by default; the 1-year-old plant isn't due
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
        # partner can't see or accept our quote
        pt = await login(app, "pat@suncare.example", PW)
        assert (await pt.get(f"/api/amc/quotes/{qj['id']}")).status_code == 404
        assert (await pt.post("/api/amc/quotes", json={"source_type": "project", "source_id": world["old_project"]})).status_code == 403
        # customer says yes to Standard
        r = await a.post(f"/api/amc/quotes/{qj['id']}/accept", json={"plan_key": "standard"})
        assert r.status_code == 200, r.text
        c = r.json()["contract"]
        assert c["annual_value"] == 3750 and c["visits_per_year"] == 4 and c["project_id"] == world["old_project"] and c["org_id"] is None
        assert (await a.post(f"/api/amc/quotes/{qj['id']}/accept", json={"plan_key": "basic"})).status_code == 400
        assert mine((await a.get("/api/amc/offers")).json()["rows"]) == []
        # partner quotes its own plant → co-branded quote belongs to the partner
        pq = await pt.post("/api/amc/quotes", json={"source_type": "jv_project", "source_id": world["jv_project"]})
        assert pq.status_code == 200 and pq.json()["org_id"] == world["partner_id"] and pq.json()["org_name"] == "Sun Care Services"
        assert [x["id"] for x in (await pt.get("/api/amc/quotes")).json()] == [pq.json()["id"]]
        # "ask later" hides an offer
        assert (await pt.post(f"/api/amc/offers/jv_project/{world['jv_project']}", json={"action": "later"})).status_code == 200
        assert (await pt.get("/api/amc/offers")).json()["rows"] == []
        assert (await pt.post(f"/api/amc/offers/project/{world['old_project']}", json={"action": "later"})).status_code == 403
    run(loop, go())


def test_settings_are_admin_only_and_move_the_offer_date(app, loop, world):
    async def go():
        a = world["admin"]
        m = await login(app, "jvmgr@example.com", PW)
        assert (await m.get("/api/amc/settings")).status_code == 200
        assert (await m.put("/api/amc/settings", json={"offer_after_years": 1})).status_code == 403
        assert (await m.post("/api/amc/jv/partners", json={"name": "Another Co"})).status_code == 403
        assert (await a.put("/api/amc/settings", json={"offer_after_years": 0})).status_code == 400
        s = (await a.put("/api/amc/settings", json={"offer_after_years": 0.9, "offer_lead_days": 0})).json()
        assert s["offer_after_years"] == 0.9
        names = [o["customer_name"] for o in (await a.get("/api/amc/offers")).json()["rows"]]
        assert "New Customer" in names
        await a.put("/api/amc/settings", json={"offer_after_years": 3, "offer_lead_days": 30})
        # switching a partner off stops its logins
        await a.put(f"/api/amc/jv/partners/{world['partner_id']}", json={"name": "Sun Care Services", "active": False})
        r = await client(app).post("/api/auth/login", json={"email": "pat@suncare.example", "password": PW})
        assert r.status_code == 401
        await a.put(f"/api/amc/jv/partners/{world['partner_id']}", json={"name": "Sun Care Services", "active": True})
        users = (await a.get(f"/api/amc/jv/partners/{world['partner_id']}/users")).json()
        await a.put(f"/api/amc/jv/partners/{world['partner_id']}/users/{users[0]['id']}", json={"active": True})
        assert (await client(app).post("/api/auth/login", json={"email": "pat@suncare.example", "password": PW})).status_code == 200
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
        # partners only learn about the AMC area
        pt = await login(app, "pat@suncare.example", PW)
        assert set((await pt.get("/api/sync/version")).json()["topics"]) <= {"amc"}
    run(loop, go())
