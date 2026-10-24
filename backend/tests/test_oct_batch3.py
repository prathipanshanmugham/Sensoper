"""Oct 2026 batch 3: brands & trademarks, vendor ratings / tags / scorecard, purchase requests with 3 quotes,
HR (people, hiring, cover, exits, shifts), loans, event calendar and the org chart — in-process, no MongoDB server.
    cd backend && pytest tests/test_oct_batch3.py
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
os.environ.setdefault("DB_NAME", "oct_batch3_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "Adm1n-pass-123")
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-oct-batch3-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
import brands  # noqa: E402
import calendar_events  # noqa: E402
import hr  # noqa: E402
import loans  # noqa: E402
import org_structure  # noqa: E402
import procurement  # noqa: E402
import server  # noqa: E402
import vendors  # noqa: E402

PW = "Passw0rd!x"
TODAY = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()
D = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731


# ───────────── pure helpers ─────────────
def test_pure_helpers():
    assert hr.last_working_day(date(2026, 10, 1), 30) == date(2026, 10, 30)
    assert hr.last_working_day(date(2026, 10, 1), 30, waived_days=10) == date(2026, 10, 20)
    assert hr.last_working_day(date(2026, 10, 1), 0) == date(2026, 10, 1)
    assert hr.would_loop({"b": "a", "a": None}, "a", "b") is True
    assert hr.would_loop({"b": "c", "c": None}, "a", "b") is False
    assert hr.minutes_late("2026-10-24T04:00:00+00:00", "09:00", 10) == 20      # 09:30 IST vs 09:10
    assert hr.minutes_late("2026-10-24T03:30:00+00:00", "09:00", 10) == 0
    assert hr.week_days(date(2026, 10, 24))[0] == "2026-10-19"                     # Monday
    assert brands.renewal_date({"status": "registered", "filing_date": "2020-02-29"}) == date(2030, 2, 28)
    assert brands.renewal_date({"status": "filed", "filing_date": "2020-01-01"}) is None
    assert vendors.clean_tags([" Tier 1", "tier 1", "", "Local  supplier"]) == ["Tier 1", "Local supplier"]
    assert vendors.rating_average([{"quality": 5, "delivery": 3, "price": 4, "service": 4}])["overall"] == 4.0
    assert loans.emi_amount(1000000, 10, 60) == 21247.04
    assert loans.emi_amount(120000, 0, 12) == 10000
    sch = loans.schedule(100000, 12, 10000, date(2026, 1, 5))
    assert sch[0]["interest"] == 1000 and sch[-1]["balance"] == 0 and len(sch) == 11
    lines = [{"name": "Panel", "qty": 10}, {"name": "Cable", "qty": 100}]
    qa = {"id": "a", "vendor_id": "v1", "lines": [{"unit_price": 10000, "gst_pct": 12}, {"unit_price": 50, "gst_pct": 18}], "freight": 500}
    qb = {"id": "b", "vendor_id": "v2", "lines": [{"unit_price": 9800, "gst_pct": 12}, {"unit_price": 55, "gst_pct": 18}], "freight": 0}
    qc = {"id": "c", "vendor_id": "v3", "lines": [{"unit_price": 9000, "gst_pct": 12}, {"unit_price": None}], "freight": 0}
    assert procurement.quote_totals(lines, qa)["landed_total"] == round(100000 * 1.12 + 5000 * 1.18 + 500, 2)
    assert procurement.quote_totals(lines, qc)["complete"] is False
    cmp_ = procurement.compare(lines, [qa, qb, qc], {"v2": {"rating": 2.0}}, low_rating=3)
    assert cmp_["cheapest_id"] == "b" and cmp_["recommended_id"] == "a"         # b is cheapest but its vendor is rated 2/5
    assert cmp_["line_best"][0]["best_quote_id"] == "c"
    ev = {"date": "2024-01-26", "repeat": "yearly"}
    assert calendar_events.occurrences(ev, date(2026, 1, 1), date(2026, 12, 31)) == [date(2026, 1, 26)]
    assert calendar_events.occurrences({"date": "2026-10-20", "end_date": "2026-10-22"}, date(2026, 10, 21), date(2026, 10, 30)) == [date(2026, 10, 20)]
    people = [{"id": "a", "role": "admin"}, {"id": "m", "role": "manager", "location_ids": ["L1"]}, {"id": "s", "role": "staff", "location_ids": ["L1"]},
              {"id": "x", "role": "staff", "reports_to": "a"}]
    links = {r["id"]: r for r in org_structure.chart_links(people)}
    assert links["s"]["reports_to"] == "m" and links["s"]["guessed"] and links["m"]["reports_to"] == "a"
    assert links["x"]["reports_to"] == "a" and not links["x"]["guessed"] and links["a"]["reports_to"] is None


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


@pytest.fixture(scope="module")
def world(app, loop):
    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        ids = {}
        for email, name, role in (("mgr3@example.com", "Meena Manager", "manager"), ("staff3@example.com", "Siva Staff", "staff"),
                                  ("staff4@example.com", "Ravi Staff", "staff")):
            r = await a.post("/api/users", json={"email": email, "password": PW, "name": name, "role": role, "phone": "9876543" + str(len(ids)).zfill(3)})
            assert r.status_code == 200, r.text
            ids[email] = str((await server.db.users.find_one({"email": email}))["_id"])
        cat = (await a.get("/api/inventory/categories")).json()
        slug = cat[0]["slug"] if cat else "solar_panels"
        items = {}
        for sku, name, price in (("WR-540", "Waaree 540W Bifacial Panel", 11000), ("NASOL-1L", "NASOL Panel Coating 1L", 900), ("CBL-4", "4 sq mm DC cable", 60)):
            r = await a.post("/api/inventory/items", json={"name": name, "sku_code": sku, "category": slug, "quantity": 20, "unit_price": price,
                                                          "gst_percentage": 12, "margin_pct": 10})
            assert r.status_code == 200, r.text
            items[sku] = r.json().get("id") or str((await server.db.inventory_items.find_one({"sku_code": sku}))["_id"])
        return {"admin": a, "ids": ids, "items": items}
    return run(loop, go())


def test_brands_trademarks_and_report(app, loop, world):
    async def go():
        a = world["admin"]
        own = await a.post("/api/brands", json={"name": "NASOL", "kind": "own", "tagline": "Panel coating"})
        assert own.status_code == 200, own.text
        bid = own.json()["id"]
        assert (await a.post("/api/brands", json={"name": "nasol", "kind": "own"})).status_code == 400
        dealer = (await a.post("/api/brands", json={"name": "Waaree", "kind": "dealership",
                                                    "agreement": {"start_date": D(-300), "end_date": D(40), "territory": "Erode, Salem", "margin_pct": 8, "target_amount": 500000}})).json()
        # trademarks: filed needs an application number; classes 1–45; registered gets a 10-year renewal date
        assert (await a.post(f"/api/brands/{bid}/trademarks", json={"mark": "NASOL", "status": "filed", "classes": [2]})).status_code == 400
        assert (await a.post(f"/api/brands/{bid}/trademarks", json={"mark": "NASOL", "status": "planned", "classes": [46]})).status_code == 400
        tm = await a.post(f"/api/brands/{bid}/trademarks", json={"mark": "NASOL", "status": "registered", "classes": [2, 1], "application_number": "5123456",
                                                                 "filing_date": (TODAY - timedelta(days=3650 - 100)).isoformat(), "next_action": "File TM-R", "next_action_date": D(30)})
        assert tm.status_code == 200, tm.text
        filed = TODAY - timedelta(days=3650 - 100)
        assert tm.json()["classes"] == [1, 2] and tm.json()["days_to_renewal"] == (brands.add_years(filed, 10) - TODAY).days
        notes = await server.db.notifications.count_documents({"kind": "trademark", "source_id": tm.json()["id"]})
        assert notes >= 3                          # renewals at 180/60/15 days + next action, per person who can see Brands
        # link stock: suggest by name, then link
        sug = (await a.get(f"/api/brands/{bid}/suggest-items")).json()
        assert [s["name"] for s in sug] == ["NASOL Panel Coating 1L"]
        assert (await a.post(f"/api/brands/{bid}/items", json={"item_ids": [s["id"] for s in sug]})).json()["linked"] == 1
        assert (await a.put(f"/api/inventory/items/{world['items']['WR-540']}", json={"brand_id": dealer["id"]})).status_code == 200
        assert (await a.put(f"/api/inventory/items/{world['items']['CBL-4']}", json={"brand_id": "6ad9" + "0" * 20})).status_code == 400
        # a counter sale and a PO for the dealer brand show up in the report
        await server.db.sales.insert_one({"sale_date": D(-2), "status": "paid", "lines": [{"inventory_item_id": world["items"]["WR-540"], "quantity": 4,
                                                                                            "unit_price": 12100, "line_total": 54208, "margin_amount": 4400}]})
        await server.db.purchase_orders.insert_one({"status": "completed", "created_at": D(-5) + "T10:00:00+00:00", "supplier_name": "Waaree Dist",
                                                    "items": [{"inventory_item_id": world["items"]["WR-540"], "qty": 10, "unit_price": 10800}], "total_amount": 108000})
        await server.db.sales.insert_one({"sale_date": D(-1), "status": "paid", "lines": [{"inventory_item_id": world["items"]["CBL-4"], "quantity": 10,
                                                                                            "unit_price": 70, "line_total": 826}]})
        rep = (await a.get("/api/brands/report")).json()
        w = next(r for r in rep["rows"] if r["name"] == "Waaree")
        assert w["counter_sales"] == 54208 and w["purchased_qty"] == 10 and w["purchased_value"] == 108000 and w["margin"] == 4400
        assert w["target_pct"] == round(54208 / 500000 * 100, 1) and w["stock_value"] == 20 * 11000
        assert rep["totals"]["unbranded_sales"] == 826 and any(r["brand_id"] is None for r in rep["rows"])
        assert sum(m["sales"] for m in w["monthly"]) == 54208
        # deleting: a brand with trademarks can't go; managers can't delete at all
        m = await login(app, "mgr3@example.com", PW)
        assert (await m.delete(f"/api/brands/{dealer['id']}")).status_code == 403
        assert (await a.delete(f"/api/brands/{bid}")).status_code == 400
        assert (await a.delete(f"/api/brands/{dealer['id']}")).json()["items_unlinked"] == 1
        # staff can't open brands (but the brand list for dropdowns is shared)
        s = await login(app, "staff3@example.com", PW)
        assert (await s.get("/api/brands/report")).status_code == 403
        assert (await s.get("/api/brands")).status_code == 200
        world["brand_id"] = bid
    run(loop, go())


def test_vendors_ratings_tags_and_scorecard(app, loop, world):
    async def go():
        a = world["admin"]
        mk = lambda name, **kw: a.post("/api/vendors", json={"name": name, "category": "panels", **kw})  # noqa: E731
        v1 = (await mk("Sun Traders", tags=["Tier 1", "tier 1", "Credit 30"], preferred=True, credit_days=30)).json()
        v2 = (await mk("Volt Supplies", tags=["Local"])).json()
        v3 = (await mk("Ray Distributors", tags=["Tier 1"])).json()
        assert v1["tags"] == ["Tier 1", "Credit 30"]
        assert (await mk("Sun traders")).status_code == 400
        assert (await mk("Bad Co", blocked=True)).status_code == 400            # a reason is needed to block
        bad = (await mk("Bad Co", blocked=True, blocked_reason="Fake GST bills")).json()
        assert bad["blocked"] and not bad["preferred"]
        tags = (await a.get("/api/vendors/tags")).json()
        assert tags[0] == {"tag": "Tier 1", "count": 2}
        # a late PO and an on-time PO for Sun Traders
        await server.db.purchase_orders.insert_many([
            {"vendor_id": v1["id"], "supplier_name": "Sun Traders", "status": "completed", "total_amount": 50000, "created_at": D(-40),
             "expected_delivery": D(-30), "arrived_at": D(-27) + "T10:00:00", "qc": {"overall": "pass"}, "items": [{"inventory_item_id": world["items"]["CBL-4"], "qty": 100, "unit_price": 58}]},
            {"supplier_name": "sun traders", "status": "completed", "total_amount": 20000, "created_at": D(-10),
             "expected_delivery": D(-5), "arrived_at": D(-6) + "T10:00:00", "qc": {"overall": "fail"}, "items": [{"inventory_item_id": world["items"]["CBL-4"], "qty": 100, "unit_price": 61}]},
            {"supplier_name": "Volt Supplies", "status": "completed", "total_amount": 5500, "created_at": D(-8), "items": [{"inventory_item_id": world["items"]["CBL-4"], "qty": 100, "unit_price": 55}]},
        ])
        r = await a.post(f"/api/vendors/{v1['id']}/ratings", json={"quality": 5, "delivery": 3, "price": 4, "service": 4, "comment": "Good panels"})
        assert r.status_code == 200, r.text
        assert (await a.post(f"/api/vendors/{v1['id']}/ratings", json={"quality": 6, "delivery": 3, "price": 4, "service": 4})).status_code == 422
        sc = (await a.get(f"/api/vendors/{v1['id']}/scorecard")).json()
        assert sc["orders"] == 2 and sc["spend"] == 70000 and sc["on_time_pct"] == 50.0 and sc["avg_delay_days"] == 1.5 and sc["qc_pass_pct"] == 50.0
        assert sc["rating"]["overall"] == 4.0
        cable = next(p for p in sc["prices"] if p["item"] is None or p["last_price"] == 61)
        assert cable["best_price"] == 55 and cable["above_best_pct"] == round((61 - 55) / 55 * 100, 1)
        ph = (await a.get(f"/api/vendors/price-history?item_id={world['items']['CBL-4']}")).json()
        assert [(p["vendor"], p["last_price"], p["times"]) for p in ph] == [("Volt Supplies", 55, 1), ("Sun Traders", 61, 2)]
        rows = (await a.get("/api/vendors?tag=tier%201")).json()
        assert {r["name"] for r in rows} == {"Sun Traders", "Ray Distributors"} and rows[0]["name"] == "Sun Traders"   # preferred first
        assert rows[0]["rating"] == 4.0 and rows[0]["orders"] == 2
        assert [r["name"] for r in (await a.get("/api/vendors?flag=blocked")).json()] == ["Bad Co"]
        assert [r["name"] for r in (await a.get("/api/vendors?min_rating=4")).json()] == ["Sun Traders"]
        world["vendors"] = {"sun": v1["id"], "volt": v2["id"], "ray": v3["id"], "bad": bad["id"]}
    run(loop, go())


def test_purchase_request_needs_three_quotes(app, loop, world):
    async def go():
        a, v = world["admin"], world["vendors"]
        m = await login(app, "mgr3@example.com", PW)
        # a manager can't raise a PO without quotes any more; an admin can, and it is marked direct
        po = {"supplier_name": "Sun Traders", "items": [{"name": "Cable", "qty": 10, "unit_price": 60}]}
        r = await m.post("/api/purchase-orders", json=po)
        assert r.status_code == 400 and "quotes" in r.json()["detail"]
        r = await a.post("/api/purchase-orders", json={**po, "skip_reason": "Emergency site repair"})
        assert r.status_code == 200
        assert (await server.db.purchase_orders.find_one({"po_number": r.json()["po_number"]}))["direct_reason"] == "Emergency site repair"
        # request
        pr = await m.post("/api/purchase-requests", json={"lines": [{"inventory_item_id": world["items"]["WR-540"], "name": "Waaree 540W panel", "qty": 20},
                                                                    {"name": "MC4 connectors", "qty": 40}], "needed_by": D(10)})
        assert pr.status_code == 200, pr.text
        p = pr.json()
        assert p["number"].startswith("PR-") and p["quotes_short"] == 3 and p["last_paid"][0]["price"] == 10800 and p["last_paid"][1] is None
        q = lambda vid, prices, **kw: m.post(f"/api/purchase-requests/{p['id']}/quotes", json={"vendor_id": vid, "lines": [{"unit_price": x, "gst_pct": 12} for x in prices], **kw})  # noqa: E731
        assert (await q(v["bad"], [10000, 50])).status_code == 400                # blocked vendor
        assert (await q(v["sun"], [None, None])).status_code == 400               # nothing priced
        r1 = await q(v["sun"], [10500, 45], delivery_days=3)
        assert r1.status_code == 200, r1.text
        assert (await q(v["sun"], [10400, 45])).status_code == 400                # one quote per vendor
        # with two quotes a manager can't choose yet
        r2 = (await q(v["volt"], [10200, 40], delivery_days=7, freight=1500)).json()
        cheapest = r2["comparison"]["cheapest_id"]
        assert (await m.post(f"/api/purchase-requests/{p['id']}/select", json={"quote_id": cheapest})).status_code == 400
        r3 = (await q(v["ray"], [10900, 48], delivery_days=2)).json()
        cmp_ = r3["comparison"]
        assert len(cmp_["rows"]) == 3 and r3["quotes_short"] == 0
        volt = next(x for x in cmp_["rows"] if x["vendor_id"] == v["volt"])
        assert cmp_["cheapest_id"] == volt["id"] and volt["landed_total"] == round((20 * 10200 + 40 * 40) * 1.12 + 1500, 2)
        assert r3["vendor_info"][v["sun"]]["rating"] == 4.0
        # choosing a dearer quote needs a reason
        sun = next(x for x in cmp_["rows"] if x["vendor_id"] == v["sun"])
        assert (await m.post(f"/api/purchase-requests/{p['id']}/select", json={"quote_id": sun["id"]})).status_code == 400
        s = await login(app, "staff3@example.com", PW)
        assert (await s.post(f"/api/purchase-requests/{p['id']}/select", json={"quote_id": sun["id"], "reason": "faster"})).status_code == 403
        r = await m.post(f"/api/purchase-requests/{p['id']}/select", json={"quote_id": sun["id"], "reason": "3-day delivery for the Erode site"})
        assert r.status_code == 200, r.text
        out = r.json()
        po_doc = await server.db.purchase_orders.find_one({"po_number": out["po_number"]})
        assert po_doc["status"] == "pending" and po_doc["vendor_id"] == v["sun"] and po_doc["rfq_number"] == p["number"]
        assert po_doc["items"][0]["inventory_item_id"] == world["items"]["WR-540"] and po_doc["items"][0]["unit_price"] == 10500
        assert out["savings"]["was_cheapest"] is False and out["savings"]["vs_highest"] > 0
        done = (await m.get(f"/api/purchase-requests/{p['id']}")).json()
        assert done["status"] == "ordered" and done["selection_reason"].startswith("3-day")
        assert (await m.post(f"/api/purchase-requests/{p['id']}/quotes", json={"vendor_id": v["ray"], "lines": [{"unit_price": 1}, {"unit_price": 1}]})).status_code == 400
        sv = (await m.get("/api/purchase-requests/savings")).json()
        assert sv["orders"] == 1 and sv["cheapest_pct"] == 0.0 and sv["avg_quotes"] == 3
        # fewer than 3 quotes: admin only, with a reason
        p2 = (await a.post("/api/purchase-requests", json={"lines": [{"name": "Earthing kit", "qty": 2}]})).json()
        one = (await a.post(f"/api/purchase-requests/{p2['id']}/quotes", json={"vendor_id": v["volt"], "lines": [{"unit_price": 2500}]})).json()
        qid = one["comparison"]["rows"][0]["id"]
        assert (await a.post(f"/api/purchase-requests/{p2['id']}/select", json={"quote_id": qid})).status_code == 400
        assert (await a.post(f"/api/purchase-requests/{p2['id']}/select", json={"quote_id": qid, "reason": "Only local supplier"})).status_code == 200
        # the next request remembers what we paid
        p3 = (await m.post("/api/purchase-requests", json={"lines": [{"inventory_item_id": world["items"]["WR-540"], "name": "Waaree 540W panel", "qty": 5}]})).json()
        assert p3["last_paid"][0]["price"] == 10500
        assert (await m.post(f"/api/purchase-requests/{p3['id']}/cancel", json={"reason": "Project on hold"})).status_code == 200
        # admin rules
        assert (await m.put("/api/procurement/settings", json={"min_quotes": 2})).status_code == 403
        assert (await a.put("/api/procurement/settings", json={"min_quotes": 3, "skip_below_amount": 5000})).json()["skip_below_amount"] == 5000
        assert (await m.post("/api/purchase-orders", json={"supplier_name": "Volt Supplies", "items": [{"name": "Cable ties", "qty": 10, "unit_price": 20}]})).status_code == 200
        await a.put("/api/procurement/settings", json={"min_quotes": 3, "skip_below_amount": 0})
    run(loop, go())


def test_hr_people_hiring_cover_exits_and_shifts(app, loop, world):
    async def go():
        a, ids = world["admin"], world["ids"]
        m = await login(app, "mgr3@example.com", PW)
        s = await login(app, "staff3@example.com", PW)
        assert (await s.get("/api/hr/overview")).status_code == 403
        assert (await m.get("/api/hr/overview")).status_code == 200
        people = (await m.get("/api/hr/people")).json()
        staff = next(p for p in people if p["email"] == "staff3@example.com")
        staff2 = next(p for p in people if p["email"] == "staff4@example.com")
        mgr = next(p for p in people if p["email"] == "mgr3@example.com")
        boss = next(p for p in people if p["role"] == "admin")
        # reporting lines (no circles)
        assert (await m.put(f"/api/hr/people/{mgr['id']}", json={"designation": "Operations manager", "department": "Projects & installation", "reports_to": boss["id"]})).status_code == 200
        assert (await m.put(f"/api/hr/people/{staff['id']}", json={"designation": "Technician", "department": "Projects & installation", "reports_to": mgr["id"],
                                                                   "employee_code": "SCR-014", "joining_date": "2024-06-01"})).status_code == 200
        assert (await m.put(f"/api/hr/people/{mgr['id']}", json={"reports_to": staff["id"]})).status_code == 400
        assert (await m.put(f"/api/hr/people/{staff2['id']}", json={"employee_code": "SCR-014"})).status_code == 400
        org = (await a.get("/api/org-structure")).json()
        link = {r["id"]: r for r in org["chart"]}
        assert link[staff["id"]]["reports_to"] == mgr["id"] and not link[staff["id"]]["guessed"]
        # hiring
        op = (await m.post("/api/hr/openings", json={"title": "Solar technician", "department": "Projects & installation", "positions": 1})).json()
        c = (await m.post("/api/hr/candidates", json={"opening_id": op["id"], "name": "Karthik R", "phone": "9443300001", "email": "karthik@example.com", "source": "referral"})).json()
        assert (await m.post("/api/hr/candidates", json={"opening_id": op["id"], "name": "Karthik R", "phone": "9443300001"})).status_code == 400
        iv = await m.post(f"/api/hr/candidates/{c['id']}/interviews", json={"at": f"{D(2)}T11:00", "mode": "in_person", "interviewer_id": mgr["id"]})
        assert iv.status_code == 200, iv.text
        assert (await server.db.hr_candidates.find_one({"name": "Karthik R"}))["stage"] == "interview"
        assert await server.db.notifications.find_one({"kind": "hr_interview", "user_id": mgr["id"]})
        assert (await m.post(f"/api/hr/candidates/{c['id']}/hire", json={"joining_date": D(15), "create_login": True, "email": "karthik@example.com",
                                                                           "temp_password": "Welcome@123"})).status_code == 403
        h = await a.post(f"/api/hr/candidates/{c['id']}/hire", json={"joining_date": D(15), "designation": "Technician", "department": "Projects & installation",
                                                                      "reports_to": mgr["id"], "create_login": True, "email": "karthik@example.com", "temp_password": "Welcome@123"})
        assert h.status_code == 200, h.text
        new_user = await server.db.users.find_one({"email": "karthik@example.com"})
        assert new_user["role"] == "staff" and new_user["must_reset_password"] and new_user["reports_to"] == mgr["id"]
        assert (await server.db.hr_openings.find_one({"title": "Solar technician"}))["status"] == "filled"
        # cover for absent staff
        cv = await m.post("/api/hr/covers", json={"absent_user_id": staff["id"], "cover_user_id": staff2["id"], "start_date": D(1), "end_date": D(3),
                                                  "reason": "leave", "handover_notes": "Site visit at Perundurai on day 2"})
        assert cv.status_code == 200, cv.text
        assert await server.db.notifications.find_one({"kind": "hr_cover", "user_id": staff2["id"], "tag": "set"})
        assert (await m.post("/api/hr/covers", json={"absent_user_id": staff["id"], "cover_user_id": mgr["id"], "start_date": D(2), "end_date": D(2)})).status_code == 400
        assert (await m.post("/api/hr/covers", json={"absent_user_id": mgr["id"], "cover_user_id": staff["id"], "start_date": D(2), "end_date": D(2)})).status_code == 400
        assert (await m.post("/api/hr/covers", json={"absent_user_id": staff2["id"], "cover_user_id": staff2["id"], "start_date": D(9), "end_date": D(9)})).status_code == 400
        sug = (await m.get(f"/api/hr/covers/suggest?user_id={staff['id']}&start={D(1)}&end={D(3)}")).json()
        assert sug and all(r["id"] != staff["id"] for r in sug)
        mine = (await (await login(app, "staff4@example.com", PW)).get("/api/hr/covers")).json()
        assert len(mine) == 1 and mine[0]["cover_name"] == "Ravi Staff"
        # shifts and roster
        sh = (await m.post("/api/hr/shifts", json={"name": "General", "start": "09:00", "end": "18:00"})).json()
        assert (await m.post("/api/hr/shifts", json={"name": "Bad", "start": "9am", "end": "18:00"})).status_code == 400
        await m.put(f"/api/hr/people/{staff['id']}", json={"designation": "Technician", "department": "Projects & installation", "reports_to": mgr["id"],
                                                            "employee_code": "SCR-014", "default_shift_id": sh["id"]})
        wk = hr.week_days(TODAY)
        assert (await m.put("/api/hr/roster", json={"entries": [{"user_id": staff2["id"], "date": wk[0], "shift_id": sh["id"]}, {"user_id": staff2["id"], "date": wk[6], "shift_id": "off"}]})).json()["saved"] == 2
        ros = (await m.get(f"/api/hr/roster?week={TODAY.isoformat()}")).json()
        row2 = next(r for r in ros["people"] if r["id"] == staff2["id"])
        assert row2["cells"][0]["shift_name"] == "General" and row2["cells"][6]["off"]
        row1 = next(r for r in ros["people"] if r["id"] == staff["id"])
        assert all(c["shift_id"] == sh["id"] for c in row1["cells"])        # default shift fills the week
        nxt = (TODAY + timedelta(days=7)).isoformat()
        assert (await m.post("/api/hr/roster/copy", json={"from_week": TODAY.isoformat(), "to_week": nxt})).json()["copied"] == 2
        # exits: managers don't get them by default
        assert (await m.get("/api/hr/exits")).status_code == 403
        assert (await a.post("/api/hr/exits", json={"user_id": staff2["id"], "type": "termination", "notice_start": D(0)})).status_code == 400   # reason needed
        ex = await a.post("/api/hr/exits", json={"user_id": staff2["id"], "type": "resignation", "notice_start": D(-29), "reason": "Moving to Chennai"})
        assert ex.status_code == 200, ex.text
        assert ex.json()["last_working_day"] == D(0) and ex.json()["checklist_total"] == 6
        assert (await a.post("/api/hr/exits", json={"user_id": staff2["id"], "type": "resignation", "notice_start": D(0)})).status_code == 400
        ravi = await login(app, "staff4@example.com", PW)              # still works on the last day
        assert (await ravi.get("/api/auth/me")).status_code == 200
        await server.db.users.update_one({"email": "staff4@example.com"}, {"$set": {"access_until": D(-1)}})
        assert (await ravi.get("/api/auth/me")).status_code == 401
        assert (await client(app).post("/api/auth/login", json={"email": "staff4@example.com", "password": PW})).status_code == 401
        await server.db.hr_exits.update_one({"user_id": staff2["id"]}, {"$set": {"last_working_day": D(-1)}})
        exits = (await a.get("/api/hr/exits")).json()
        assert exits[0]["status"] == "completed"
        assert (await server.db.users.find_one({"email": "staff4@example.com"}))["active"] is False
        ov = (await a.get("/api/hr/overview")).json()
        assert ov["left_12m"] >= 1 and ov["openings"] == 0
        world["staff"], world["mgr"], world["cover_start"] = staff, mgr, D(1)
    run(loop, go())


def test_loans(app, loop, world):
    async def go():
        a = world["admin"]
        m = await login(app, "mgr3@example.com", PW)
        assert (await m.get("/api/loans")).status_code == 403           # admins only unless given
        body = {"lender": "State Bank of India", "loan_type": "term_loan", "principal": 1000000, "disbursal_date": D(-95), "interest_rate": 10,
                "tenure_months": 60, "emi_day": 5, "reference": "TL-77812"}
        r = await a.post("/api/loans", json=body)
        assert r.status_code == 200, r.text
        l = r.json()
        assert l["emi_amount"] == 21247.04 and l["outstanding"] == 1000000 and l["next_due"]
        assert (await a.post("/api/loans", json={**body, "tenure_months": None})).status_code == 400
        assert (await a.post("/api/loans", json={**body, "emi_amount": 5000})).status_code == 400     # doesn't cover interest
        assert await server.db.notifications.count_documents({"kind": "loan_emi", "source_id": l["id"]}) >= 3
        pay = await a.post(f"/api/loans/{l['id']}/payments", json={"date": l["first_emi_date"], "amount": 21247.04, "kind": "emi"})
        assert pay.status_code == 200, pay.text
        d = pay.json()
        p0 = d["payments"][0]
        assert p0["interest_part"] == round(1000000 * 10 / 1200, 2) and d["outstanding"] == round(1000000 - (21247.04 - p0["interest_part"]), 2)
        assert d["schedule"] and d["schedule"][-1]["balance"] == 0
        assert (await a.post(f"/api/loans/{l['id']}/payments", json={"date": D(5), "amount": 10, "kind": "emi"})).status_code == 400   # future
        assert (await a.post(f"/api/loans/{l['id']}/payments", json={"date": D(-1), "amount": 99000000, "kind": "prepayment"})).status_code == 400
        od = (await a.post("/api/loans", json={"lender": "Canara Bank", "loan_type": "od_cc", "principal": 500000, "disbursed_amount": 200000,
                                                "disbursal_date": D(-30), "interest_rate": 11})).json()
        assert (await a.post(f"/api/loans/{od['id']}/payments", json={"date": D(-2), "amount": 400000, "kind": "drawdown"})).status_code == 400   # over the limit
        assert (await a.post(f"/api/loans/{od['id']}/payments", json={"date": D(-2), "amount": 100000, "kind": "drawdown"})).status_code == 200
        lst = (await a.get("/api/loans")).json()
        t = lst["totals"]
        assert t["active"] == 2 and t["monthly_emi"] == 21247.04 and t["outstanding"] == round(d["outstanding"] + 300000, 2)
        assert len(lst["next_12_months"]) == 12 and lst["by_lender"][0]["lender"] == "State Bank of India"
        odrow = next(x for x in lst["rows"] if x["id"] == od["id"])
        assert odrow["utilisation_pct"] == 60.0
        assert (await a.post(f"/api/loans/{od['id']}/close", json={"closed_on": D(0)})).status_code == 400
        assert (await a.post(f"/api/loans/{od['id']}/close", json={"closed_on": D(0), "how": "foreclosed"})).status_code == 200
        world["loan"] = l
    run(loop, go())


def test_calendar(app, loop, world):
    async def go():
        a = world["admin"]
        s = await login(app, "staff3@example.com", PW)
        r = await s.post("/api/calendar/events", json={"title": "Safety training", "type": "training", "date": D(4), "all_day": False, "start_time": "10:00", "end_time": "12:00"})
        assert r.status_code == 200, r.text
        ev = r.json()
        assert (await s.post("/api/calendar/events", json={"title": "Bad", "date": D(4), "all_day": False, "start_time": "10:00", "end_time": "09:00"})).status_code == 400
        priv = (await a.post("/api/calendar/events", json={"title": "Board meeting", "date": D(5), "audience": "people", "attendee_ids": [world["mgr"]["id"]]})).json()
        assert await server.db.notifications.find_one({"kind": "calendar", "source_id": priv["event_id"], "user_id": world["mgr"]["id"], "tag": "added"})
        await a.post("/api/calendar/events", json={"title": "Pongal", "type": "holiday", "date": "2025-01-14", "repeat": "yearly"})
        start, end = TODAY.replace(day=1), TODAY.replace(day=1) + timedelta(days=95)
        cal_s = (await s.get(f"/api/calendar?start={start}&end={end}")).json()["items"]
        titles = {i["title"] for i in cal_s}
        assert "Safety training" in titles and "Board meeting" not in titles
        assert not any(i["source"] == "loans" for i in cal_s)                  # staff can't see loans
        assert any(i["source"] == "hr" and "covers" in i["title"] for i in cal_s)   # their own cover
        cal_a = (await a.get(f"/api/calendar?start={start}&end={end}")).json()["items"]
        assert any(i["source"] == "loans" and i["title"].startswith("EMI") for i in cal_a)
        assert any(i["source"] == "brands" for i in cal_a) and any(i["source"] == "purchases" for i in cal_a)
        assert any(i["title"] == "Board meeting" for i in cal_a)
        jan = (await a.get("/api/calendar?start=2027-01-01&end=2027-01-31&sources=event")).json()["items"]
        assert [i["title"] for i in jan] == ["Pongal"]
        # people change their own events; others need the edit switch
        m = await login(app, "mgr3@example.com", PW)
        assert (await s.put(f"/api/calendar/events/{ev['event_id']}", json={"title": "Safety training (PPE)", "type": "training", "date": D(4)})).status_code == 200
        s2 = await login(app, "karthik@example.com", "Welcome@123")
        assert (await s2.delete(f"/api/calendar/events/{ev['event_id']}")).status_code == 403
        assert (await m.delete(f"/api/calendar/events/{ev['event_id']}")).status_code == 200
        assert (await a.get(f"/api/calendar?start={start}&end={start + timedelta(days=200)}")).status_code == 400
    run(loop, go())


def test_new_pages_in_permissions(app, loop, world):
    async def go():
        a = world["admin"]
        cat = (await a.get("/api/permissions/catalog")).json()
        keys = {p["key"]: p for s in cat["sections"] for p in s["pages"]}
        for k in ("module_brands", "module_hr", "module_loans", "module_calendar"):
            assert k in keys
        assert "can_manage_exits" in {o["key"] for o in keys["module_hr"]["options"]}
        assert "can_select_quote" in {o["key"] for o in keys["module_purchase_inbound"]["options"]}
        rec = cat["recommended"]
        assert rec["staff"]["module_calendar"]["view"] and not rec["staff"]["module_hr"]["view"] and not rec["manager"]["module_loans"]["view"]
        assert any(s["label"] == "Finance & insights" for s in cat["sections"])
        # the doc upload takes PDFs only (and pictures / Word)
        c = world["admin"]
        r = await c.post("/api/upload/document", files={"file": ("quote.pdf", b"%PDF-1.4 test", "application/pdf")})
        assert r.status_code == 200 and r.json()["storage_path"].endswith(".pdf")
        assert (await c.post("/api/upload/document", files={"file": ("x.exe", b"MZ", "application/x-msdownload")})).status_code == 400
    run(loop, go())
