"""Nov 2026 QA sweep: fixes for errors found by clicking through every page and reading the live data.
In-process, no MongoDB server:
    cd backend && pytest tests/test_qa_nov.py
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "qa_nov_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "Adm1n-pass-123")
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-qa-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
from bson import ObjectId  # noqa: E402
import server  # noqa: E402
import quick_calc  # noqa: E402
import expansion  # noqa: E402
import sales  # noqa: E402
import notify  # noqa: E402

PW = "Passw0rd!x"
EMAILS = ["qa.staff@example.com", "qa.mgr@example.com"]
TAG = "qa-nov-test"


# ───────────── pure rules ─────────────
def test_margin_and_gst_guards_in_the_calculator():
    def calc(margin):
        inputs = {"system_type": "on-grid", "system_size_kw": 3, "kw": 3, "monthly_eb_units": 400, "tariff_per_unit": 7,
                  "overrides": {"structure_margin_pct": margin, "structure_gst_pct": 18, "structure_cost": 10000}}
        return quick_calc.compute_quick(inputs, {})
    ok, bad = calc(15), calc(24900)
    assert any("24900% isn't a sensible percentage" in i for i in bad["pricing_issues"]), bad["pricing_issues"]
    assert bad["lines"]["structure"]["margin_pct"] is None
    assert bad["lines"]["structure"]["amount"] <= ok["lines"]["structure"]["amount"]


def test_saved_quote_with_an_impossible_margin_is_flagged():
    cf = {"proposed_solution": {"total_cost": 210000, "system_size_kw": 3,
                                "_quick": {"lines": {"structure": {"margin_pct": 24900}, "cabling": {"margin_pct": 12}}}}}
    sysd = server._system_from_custom_fields(cf)
    assert any(i.startswith("Structure: margin 24900%") for i in sysd["pricing_issues"])
    ce = server.calculate_cost_estimation([{"name": "Earthing kit", "category": "cables_accessories", "unit_price": 1000, "quantity": 1,
                                            "gst_percentage": 18, "margin_percentage": 5000}], [], cf)
    assert any("Earthing kit" in i and "5000%" in i for i in ce["pricing_issues"])
    assert not any("Earthing kit" in i and "margin% missing" in i for i in ce["pricing_issues"])   # one message, not two
    assert ce["items_breakdown"][0]["margin_amount"] == 0


def test_reference_figures_hide_impossible_savings_and_round():
    bad = server._reference_metrics({"roi_pct": 2913.7, "payback_years": 0.82, "monthly_savings": 25532.4, "annual_generation_units": 7534.284598}, "5")
    assert bad["roi_pct"] is None and bad["payback_years"] is None and bad["figures_need_refresh"]
    assert bad["annual_generation_units"] == 7534
    good = server._reference_metrics({"roi_pct": 21.456, "payback_years": 4.66, "monthly_savings": 4200.0}, 5)
    assert good["roi_pct"] == 21.46 and good["payback_years"] == 4.66 and "figures_need_refresh" not in good
    pump = server._reference_metrics({"roi_pct": 180.0, "payback_years": 0.55, "monthly_savings": 19000.0}, 3.7, "solar-pump")
    assert pump["payback_years"] == 0.55 and pump["monthly_savings"] == 19000 and "figures_need_refresh" not in pump   # diesel pumps can
    assert server._completed_on({"status": "approved", "updated_at": "2026-10-01"}) is None
    assert server._completed_on({"status": "completed", "completed_at": "2026-09-02", "updated_at": "2026-10-01"}) == "2026-09-02"


def test_state_spellings_are_one_row():
    assert {expansion._state(v) for v in ("TN", "Tamilnadu", "Tamil Nadu", "T.N.")} == {"Tamil Nadu"}
    assert expansion._place("ERODE") == expansion._place("erode") == "Erode"


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


def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://quote.example.in", headers={"x-forwarded-proto": "https"})


async def login(app, email, password):
    c = client(app)
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture(scope="module")
def world(app, loop):
    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        for email, name, role in zip(EMAILS, ("Ravi Field", "Priya Lead"), ("staff", "manager")):
            r = await a.post("/api/users", json={"email": email, "password": PW, "name": name, "role": role, "phone": "98765111" + str(len(name) % 10) + "0"})
            assert r.status_code == 200, r.text
        return {"admin": a, "staff": await login(app, EMAILS[0], PW), "mgr": await login(app, EMAILS[1], PW)}

    async def tidy():
        db = server.db
        await db.users.delete_many({"email": {"$in": EMAILS}})
        await db.inventory_items.delete_many({"notes": TAG})
        await db.inventory_transactions.delete_many({"notes": TAG})
        await db.projects.delete_many({"reference_number": {"$regex": "^QA-"}})
        await db.sales.delete_many({"notes": TAG})
        await db.amc_contracts.delete_many({"notes": TAG})
        await db.amc_service_visits.delete_many({"notes": TAG})

    yield run(loop, go())
    run(loop, tidy())


def test_bad_links_and_legacy_stock_history(app, loop, world):
    async def go():
        a = world["admin"]
        # a cut-off or mistyped id is "not found", not a server error
        for path in ("/api/projects/not-an-id", "/api/inventory/items/123", "/api/purchase-orders/None"):
            r = await a.get(path)
            assert r.status_code in (404, 405), (path, r.status_code)
        r = await a.put("/api/purchase-orders/None/approve")
        assert r.status_code in (403, 404, 405), r.status_code
        # an item whose history was written by the old bulk import (transaction_type / performed_by_name)
        res = await server.db.inventory_items.insert_one({"name": "QA panel", "category": "solar_panels", "quantity": 5, "unit_price": 100.0,
                                                          "sku_code": "QA-SKU-1", "created_at": "2026-01-01T00:00:00+00:00", "notes": TAG})
        iid = str(res.inserted_id)
        await server.db.inventory_transactions.insert_one({"item_id": iid, "transaction_type": "purchase", "quantity": 5, "performed_by_name": "Import",
                                                           "created_at": "2026-01-01T00:00:00+00:00", "notes": TAG})
        r = await a.get(f"/api/inventory/items/{iid}")
        assert r.status_code == 200, r.text
        tx = r.json()["transactions"][0]
        assert tx["type"] == "purchase" and tx["user_name"] == "Import" and tx["timestamp"].startswith("2026-01-01")
    run(loop, go())


def test_staff_directory_and_approval_counts(app, loop, world):
    async def go():
        a, st, mgr = world["admin"], world["staff"], world["mgr"]
        assert (await mgr.get("/api/users")).status_code == 403            # the full list (emails, phones) stays admin-only
        d = await mgr.get("/api/users/directory")
        assert d.status_code == 200 and any(u["name"] == "Ravi Field" for u in d.json())
        assert all(set(u) <= {"id", "name", "role", "department", "designation", "active"} for u in d.json())
        assert (await st.get("/api/users/directory")).status_code == 200
        c1 = (await a.get("/api/approvals/pending-count")).json()["count"]
        c2 = (await a.get("/api/approvals/inbox/count")).json()["count"]
        assert c1 == c2
    run(loop, go())


def test_inverter_password_is_sent_only_on_request(app, loop, world):
    async def go():
        a, st = world["admin"], world["staff"]
        res = await server.db.projects.insert_one({"reference_number": "QA-INV-1", "status": "completed", "created_by": "someone-else",
                                                   "customer": {"name": "QA Customer", "phone": "9000000000", "address": "Erode"},
                                                   "inverter_login": {"url": "https://inv.example", "username": "cust", "password": "s3cret!"},
                                                   "created_at": "2026-05-01T00:00:00+00:00", "updated_at": "2026-05-01T00:00:00+00:00"})
        pid = str(res.inserted_id)
        r = await a.get(f"/api/projects/{pid}")
        assert r.status_code == 200, r.text
        il = r.json()["inverter_login"]
        assert "s3cret!" not in r.text and il["has_password"] and il["username"] == "cust"
        r = await a.get(f"/api/projects/{pid}/inverter-password")
        assert r.status_code == 200 and r.json()["password"] == "s3cret!"
        assert await server.db.audit_logs.find_one({"action_type": "inverter_password_viewed", "entity_id": pid})
        assert (await st.get(f"/api/projects/{pid}/inverter-password")).status_code == 403
    run(loop, go())


def test_direct_sale_margin_uses_stock_cost(app, loop, world):
    async def go():
        item = await server.db.inventory_items.insert_one({"name": "QA cable", "category": "cables_accessories", "quantity": 50, "unit_price": 60.0, "sku_code": "QA-SKU-2",
                                                           "created_at": "2026-01-01T00:00:00+00:00", "notes": TAG})
        line = {"inventory_item_id": str(item.inserted_id), "name": "QA cable", "quantity": 10, "unit_price": 100.0, "gst_percentage": 18}
        filled = await sales._with_costs(server.db, [dict(line)])
        out = sales._compute_line(filled[0])
        assert out["cost_price"] == 60.0 and out["margin_pct"] == 40.0
        # a sale saved before costs were copied in gets its cost filled once
        res = await server.db.sales.insert_one({"notes": TAG, "status": "completed", "lines": [sales._compute_line(dict(line, cost_price=0))]})
        assert (await server.db.sales.find_one({"_id": res.inserted_id}))["lines"][0]["margin_pct"] == 100.0
        assert await sales.backfill_missing_costs(server.db) >= 1
        ln = (await server.db.sales.find_one({"_id": res.inserted_id}))["lines"][0]
        assert ln["cost_price"] == 60.0 and ln["margin_pct"] == 40.0 and ln["cost_filled_later"]
        assert await sales.backfill_missing_costs(server.db) == 0           # idempotent
    run(loop, go())


def test_amc_report_lists_a_late_visit_once(app, loop, world):
    async def go():
        a = world["admin"]
        c = await server.db.amc_contracts.insert_one({"contract_number": "AMC-QA1", "customer_name": "QA AMC", "status": "active", "start_date": "2026-01-01",
                                                      "end_date": "2026-12-31", "annual_value": 6000, "system_capacity_kw": 5, "notes": TAG})
        late = (notify.today_ist().replace(day=1)).isoformat()
        await server.db.amc_service_visits.insert_one({"contract_id": str(c.inserted_id), "status": "scheduled", "scheduled_date": late,
                                                       "visit_type": "preventive", "notes": TAG})
        rep = (await a.get("/api/amc/report")).json()
        mine = [v for v in rep["visits"] if v["contract_number"] == "AMC-QA1"]
        if late < notify.today_ist().isoformat():
            assert len(mine) == 1 and mine[0]["status"] == "overdue"
        else:
            assert len(mine) == 1
    run(loop, go())


def test_brand_report_counts_unbranded_stock(app, loop, world):
    async def go():
        a = world["admin"]
        await server.db.inventory_items.insert_one({"name": "QA unbranded", "category": "other", "quantity": 4, "unit_price": 250.0, "sku_code": "QA-SKU-3",
                                                    "created_at": "2026-01-01T00:00:00+00:00", "notes": TAG})
        rep = (await a.get("/api/brands/report")).json()
        rows = rep.get("rows") or rep.get("brands") or []
        nob = next(r for r in rows if r["brand_id"] is None)
        assert nob["items"] >= 1 and nob["stock_value"] >= 1000
    run(loop, go())


def test_alert_margin_matches_profit_card(app, loop, world):
    async def go():
        ce = {"system_cost": 200000, "system_margin_pct": 15, "system_gst": 10000, "total_cost": 210000, "gross_total": 210000, "total_gst": 10000,
              "total_margin": 0, "margin_total": 0, "items_breakdown": [], "manual_costs": []}
        p = {"_id": ObjectId(), "status": "approved", "cost_estimation": ce, "created_at": "2026-11-01T00:00:00+00:00"}
        alerts = await server._generate_project_alerts(p, await server._get_thresholds())
        from invoicing import _cost_breakdown
        pct = _cost_breakdown(ce)["gross_margin_pct"]
        assert pct > 10
        low = [x for x in alerts if x["type"] == "low_margin"]
        assert not low or f"{round(pct, 1)}%" in low[0]["message"]
        assert not any("Margin 0.0%" in x["message"] for x in alerts)
    run(loop, go())
