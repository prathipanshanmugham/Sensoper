"""Leads (CRM), material quotations and the Ctrl+K search — in-process, no MongoDB server:
    cd backend && pytest tests/test_crm_quotes.py
"""
import asyncio
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "crm_quotes_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "t-" + secrets.token_hex(12))
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-crm-quotes-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
from bson import ObjectId  # noqa: E402
import server  # noqa: E402
import crm  # noqa: E402
import material_quotes  # noqa: E402

PW = "pw-" + secrets.token_hex(8)
TAG = "crm-quotes-test"
IST = timezone(timedelta(hours=5, minutes=30))


def phone():
    return "9" + "".join(secrets.choice("0123456789") for _ in range(9))


# ───────────── pure rules ─────────────
def test_follow_up_state_and_reminder_time():
    today = crm.today_ist()
    assert crm.follow_up_state({"status": "new", "follow_up_on": "2000-01-01"}, today) == "overdue"
    assert crm.follow_up_state({"status": "contacted", "follow_up_on": today}, today) == "today"
    assert crm.follow_up_state({"status": "won", "follow_up_on": "2000-01-01"}, today) is None
    assert crm.follow_up_state({"status": "new"}, today) is None
    # 10:30 IST = 05:00 UTC; no time = 09:30 IST
    assert crm.follow_up_utc("2026-12-01", "10:30").startswith("2026-12-01T05:00:00")
    assert crm.follow_up_utc("2026-12-01", None).startswith("2026-12-01T04:00:00")


def test_terms_from_a_template():
    assert material_quotes.terms_from_html("<ol><li>One &amp; two</li><li> </li><li>Three</li></ol>") == ["One & two", "Three"]
    assert material_quotes.terms_from_html("First<br>Second") == ["First", "Second"]
    assert material_quotes.selling_price({"unit_price": 100, "margin_pct": 10}) == 110
    assert material_quotes.selling_price({"unit_price": 100}) is None


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
        db = server.db
        a = await login(app, ADMIN["email"], ADMIN["password"])
        users, ids = {}, {}
        for key, role in (("ravi", "staff"), ("anu", "staff"), ("mgr", "manager")):
            email = f"{key}.{TAG}@example.com"
            r = await a.post("/api/users", json={"email": email, "password": PW, "name": f"{key.title()} {TAG}", "role": role})
            assert r.status_code == 200, r.text
            ids[key] = str((await db.users.find_one({"email": email}))["_id"])
            users[key] = await login(app, email, PW)
        items = {}
        for key, cost, margin, gst, qty in (("panel", 10000, 10, 5, 50), ("cable", 100, 20, 18, 500), ("nomargin", 500, None, 18, 5)):
            doc = {"name": f"{key.title()} {TAG}", "sku_code": f"CQ-{key}-{secrets.token_hex(3)}", "category": "accessories", "quantity": qty,
                   "unit_price": cost, "gst_percentage": gst, "hsn_code": "85414300" if key == "panel" else "8544", "notes": TAG}
            if margin is not None:
                doc["margin_pct"] = margin
            items[key] = str((await db.inventory_items.insert_one(doc)).inserted_id)
        return {"admin": a, "ids": ids, "items": items, **users}

    async def tidy():
        db = server.db
        await db.users.delete_many({"email": {"$regex": TAG}})
        await db.inventory_items.delete_many({"notes": TAG})
        await db.website_leads.delete_many({"$or": [{"name": {"$regex": TAG}}, {"message": TAG}]})
        await db.material_quotes.delete_many({"customer.name": {"$regex": TAG}})
        await db.sales.delete_many({"customer.name": {"$regex": TAG}})
        await db.customer_credits.delete_many({"customer_name": {"$regex": TAG}})

    w = run(loop, go())
    yield w
    run(loop, tidy())


def test_lead_life_cycle_follow_ups_and_reminders(app, loop, world):
    async def go():
        ravi, anu, mgr = world["ravi"], world["anu"], world["mgr"]
        bad = await ravi.post("/api/crm/leads", json={"name": "No phone", "phone": "12345"})
        assert bad.status_code == 400
        p = phone()
        tomorrow = (datetime.now(IST).date() + timedelta(days=1)).isoformat()
        r = await ravi.post("/api/crm/leads", json={"name": f"Kumar {TAG}", "phone": f"+91 {p}", "channel": "walk_in", "kind": "home", "kw": 5,
                                                     "value": 300000, "heat": "hot", "follow_up_on": tomorrow, "follow_up_at": "11:00",
                                                     "follow_up_note": "Send panel options"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["created"] is True
        lead = body["lead"]
        lid = lead["id"]
        assert lead["number"].startswith("L-") and lead["phone"] == p and lead["assigned_to"] == world["ids"]["ravi"]
        assert lead["channel_label"] == "Walk-in" and lead["follow_up_state"] == "upcoming" and lead["status"] == "new"
        note = await server.db.notifications.find_one({"kind": "lead_follow_up", "source_id": lid})
        assert note and note["user_id"] == world["ids"]["ravi"] and note["notify_at"].startswith(f"{tomorrow}T05:30:00")

        # the same number again → offered the existing lead, not a second one
        dup = (await anu.post("/api/crm/leads", json={"name": "Again", "phone": p})).json()
        assert dup["created"] is False and dup["existing"]["number"] == lead["number"] and dup["existing"]["can_open"] is False

        # Anu (staff) can't see Ravi's lead; the manager can
        assert (await anu.get(f"/api/crm/leads/{lid}")).status_code == 404
        assert lid not in [x["id"] for x in (await anu.get("/api/crm/leads")).json()["items"]]
        assert lid in [x["id"] for x in (await mgr.get("/api/crm/leads")).json()["items"]]

        # a call: New → Called, the follow-up moves, the reminder is planned again
        r = await ravi.post(f"/api/crm/leads/{lid}/activity", json={"type": "call", "outcome": "interested", "text": "Wants 5 kW",
                                                                   "follow_up_on": crm.today_ist(), "follow_up_at": "18:00"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "contacted" and d["contact_count"] == 1 and d["follow_up_state"] == "today"
        assert d["activity"][0]["type"] in ("status", "follow_up") and any("Wants 5 kW" in a["text"] for a in d["activity"])
        assert await server.db.notifications.count_documents({"kind": "lead_follow_up", "source_id": lid, "status": "pending"}) == 1
        s = (await ravi.get("/api/crm/summary")).json()
        assert s["due_today"] >= 1 and s["mine_due"] >= 1
        today_ids = [x["id"] for x in (await ravi.get("/api/crm/leads", params={"view": "today"})).json()["items"]]
        assert lid in today_ids

        # Lost needs a reason; closing clears the follow-up and the reminder
        assert (await ravi.put(f"/api/crm/leads/{lid}", json={"status": "lost"})).status_code == 400
        r = await ravi.put(f"/api/crm/leads/{lid}", json={"status": "lost", "lost_reason": "Price too high"})
        assert r.status_code == 200 and r.json()["follow_up_on"] is None and r.json()["follow_up_state"] is None
        assert await server.db.notifications.count_documents({"kind": "lead_follow_up", "source_id": lid, "status": "pending"}) == 0

        # staff can't delete; a manager can
        assert (await ravi.delete(f"/api/crm/leads/{lid}")).status_code == 403
        assert (await mgr.delete(f"/api/crm/leads/{lid}")).status_code == 200
    run(loop, go())


def test_unowned_website_lead_is_visible_and_taken_by_whoever_calls(app, loop, world):
    async def go():
        anon = client(app)
        p = phone()
        r = await anon.post("/api/public/leads", json={"name": f"Web {TAG}", "phone": p, "kind": "home", "source": "quote", "message": TAG})
        assert r.status_code == 200, r.text
        lead = await server.db.website_leads.find_one({"phone": p})
        lid = str(lead["_id"])
        assert lead["channel"] == "website"
        note = await server.db.notifications.find_one({"kind": "website_lead", "source_id": lid})
        assert note and note["link"] == f"/dashboard/leads?lead={lid}"
        for who in ("ravi", "anu"):
            assert lid in [x["id"] for x in (await world[who].get("/api/crm/leads", params={"view": "new"})).json()["items"]]
        r = await world["anu"].post(f"/api/crm/leads/{lid}/activity", json={"type": "call", "outcome": "no_answer"})
        assert r.status_code == 200 and r.json()["assigned_to"] == world["ids"]["anu"] and r.json()["status"] == "contacted"
        # now it's Anu's: Ravi no longer sees it
        assert (await world["ravi"].get(f"/api/crm/leads/{lid}")).status_code == 404
        # a note needs text; unknown outcomes are refused
        assert (await world["anu"].post(f"/api/crm/leads/{lid}/activity", json={"type": "note"})).status_code == 400
        assert (await world["anu"].post(f"/api/crm/leads/{lid}/activity", json={"type": "call", "outcome": "maybe"})).status_code == 400
        # the menu badge counts new, unowned leads and my due follow-ups
        stats = (await world["ravi"].get("/api/dashboard/stats")).json()
        assert "leads_due" in stats
    run(loop, go())


def test_material_quotation_totals_lead_link_revision_and_sale(app, loop, world):
    async def go():
        ravi, anu, mgr, admin = world["ravi"], world["anu"], world["mgr"], world["admin"]
        it = world["items"]
        # the item picker: selling price for everyone, cost only for people who may see the Price list
        pick = (await ravi.get("/api/material-quotes/items", params={"q": f"panel {TAG}"})).json()
        row = next(x for x in pick["items"] if x["id"] == it["panel"])
        assert row["selling_price"] == 11000 and "cost_price" not in row and pick["sees_cost"] is False
        assert (await admin.get("/api/material-quotes/items", params={"q": TAG})).json()["items"][0].get("cost_price") is not None
        nm = next(x for x in (await ravi.get("/api/material-quotes/items", params={"q": f"nomargin {TAG}"})).json()["items"])
        assert nm["price_missing"] is True

        lead = (await ravi.post("/api/crm/leads", json={"name": f"Quote cust {TAG}", "phone": phone(), "kind": "business"})).json()["lead"]
        body = {"customer": {"name": f"Quote cust {TAG}", "phone": lead["phone"], "state": "Tamil Nadu"}, "lead_id": lead["id"],
                "lines": [{"inventory_item_id": it["panel"], "name": "Panel", "quantity": 10, "unit_price": 11000, "gst_percentage": 5, "hsn_code": "85414300"},
                          {"inventory_item_id": it["cable"], "name": "Cable", "quantity": 100, "unit_price": 120, "gst_percentage": 18, "discount_pct": 10},
                          {"name": "Transport", "quantity": 1, "unit_price": 1500, "gst_percentage": 18, "unit": "Job"}],
                "discount_amount": 1000}
        r = await ravi.post("/api/material-quotes", json=body)
        assert r.status_code == 200, r.text
        q = r.json()
        qid = q["id"]
        assert q["number"].startswith("MQ/") and q["status"] == "draft" and q["terms"]
        # 110000 + 10800 + 1500 = 122300 taxable before the ₹1,000 bill discount → 121300; GST on the discounted values
        assert q["taxable_value"] == 121300
        assert round(q["cgst"] + q["sgst"], 2) == q["gst_total"] and q["igst"] == 0
        assert q["grand_total"] == round(q["grand_total"]) and abs(q["round_off"]) < 1
        assert "margin_amount" not in q and all("cost_price" not in l for l in q["lines"])
        full = (await admin.get(f"/api/material-quotes/{qid}")).json()
        assert full["margin_amount"] > 0 and full["lines"][0]["stock"] == 50

        # other state → IGST
        r = await ravi.post("/api/material-quotes", json={**body, "lead_id": None, "customer": {**body["customer"], "state": "Kerala"}})
        igst_q = r.json()
        assert igst_q["igst"] == igst_q["gst_total"] and igst_q["cgst"] == 0

        # bad input
        for bad in ({**body, "lines": []}, {**body, "customer": {"name": "x"}},
                    {**body, "customer": {**body["customer"], "gstin": "123"}},
                    {**body, "lines": [{"name": "Panel", "quantity": -1, "unit_price": 100}]}):
            assert (await ravi.post("/api/material-quotes", json=bad)).status_code == 400

        # the lead knows about it
        l = (await ravi.get(f"/api/crm/leads/{lead['id']}")).json()
        assert l["quote_count"] == 1 and l["quotes"][0]["id"] == qid

        # Anu can't see Ravi's quotation; the manager can
        assert (await anu.get(f"/api/material-quotes/{qid}")).status_code == 404
        assert (await mgr.get(f"/api/material-quotes/{qid}")).status_code == 200

        # sent → the lead moves to Quote sent
        r = await ravi.post(f"/api/material-quotes/{qid}/status", json={"status": "sent"})
        assert r.status_code == 200 and r.json()["status"] == "sent"
        assert (await ravi.get(f"/api/crm/leads/{lead['id']}")).json()["status"] == "quoted"
        # editing a sent quotation makes R1, back to draft
        r = await ravi.put(f"/api/material-quotes/{qid}", json={**body, "discount_amount": 2000})
        assert r.status_code == 200 and r.json()["revision"] == 1 and r.json()["status"] == "draft" and r.json()["display_number"].endswith("-R1")
        assert (await ravi.post(f"/api/material-quotes/{qid}/status", json={"status": "converted"})).status_code == 400

        # the sale made from it: same total, quotation Sold, lead Won with the value
        qd = (await ravi.get(f"/api/material-quotes/{qid}")).json()
        sale = {"sale_type": "b2b", "customer": {"name": qd["customer"]["name"], "phone": qd["customer"]["phone"], "state": "Tamil Nadu"},
                "lines": [{k: l.get(k) for k in ("inventory_item_id", "name", "quantity", "unit_price", "discount_pct", "gst_percentage", "hsn_code")} for l in qd["lines"]],
                "discount_amount": qd["discount_amount"], "round_off": qd["round_off"], "material_quote_id": qid}
        r = await mgr.post("/api/sales", json=sale)
        assert r.status_code == 200, r.text
        assert r.json()["grand_total"] == qd["grand_total"]
        done = (await ravi.get(f"/api/material-quotes/{qid}")).json()
        assert done["status"] == "converted" and done["invoice_number"] == r.json()["invoice_number"]
        l = (await ravi.get(f"/api/crm/leads/{lead['id']}")).json()
        assert l["status"] == "won" and l["value"] == qd["grand_total"]
        # not twice
        assert (await mgr.post("/api/sales", json=sale)).status_code == 400
        assert (await ravi.put(f"/api/material-quotes/{qid}", json=body)).status_code == 400
        assert (await mgr.delete(f"/api/material-quotes/{qid}")).status_code == 400
        # a lead with quotations isn't deleted (mark it lost instead)
        assert (await mgr.delete(f"/api/crm/leads/{lead['id']}")).status_code == 400

        # copy → a fresh draft with a new number
        cp = (await ravi.post(f"/api/material-quotes/{qid}/duplicate")).json()
        assert cp["status"] == "draft" and cp["number"] != done["number"] and cp["copied_from"] == done["number"]
        # staff can't delete quotations by default; a manager can delete a draft
        assert (await ravi.delete(f"/api/material-quotes/{cp['id']}")).status_code == 403
        assert (await mgr.delete(f"/api/material-quotes/{cp['id']}")).status_code == 200

        lst = (await ravi.get("/api/material-quotes", params={"q": TAG})).json()
        assert qid in [x["id"] for x in lst["items"]] and "lines" not in lst["items"][0]
    run(loop, go())


def test_search_respects_who_sees_what(app, loop, world):
    async def go():
        ravi, anu = world["ravi"], world["anu"]
        name = f"Searchable {TAG} {secrets.token_hex(2)}"
        await ravi.post("/api/crm/leads", json={"name": name, "phone": phone()})
        r = (await ravi.get("/api/search", params={"q": name})).json()
        leads = next(g for g in r["groups"] if g["key"] == "leads")
        assert leads["items"][0]["title"] == name and leads["items"][0]["href"].startswith("/dashboard/leads?lead=")
        r = (await anu.get("/api/search", params={"q": name})).json()
        assert not any(g["key"] == "leads" for g in r["groups"])
        items = (await ravi.get("/api/search", params={"q": f"panel {TAG}"})).json()
        stock = next(g for g in items["groups"] if g["key"] == "items")   # stock and selling price, for people who may quote
        assert "₹11,000.00 + 5% GST" in stock["items"][0]["sub"] and "10000" not in stock["items"][0]["sub"]
        assert (await ravi.get("/api/search", params={"q": "a"})).json()["groups"] == []
    run(loop, go())


def test_permissions_page_lists_the_new_pages():
    import access_policy
    assert "module_leads" in access_policy.PAGES and "module_material_quotes" in access_policy.PAGES
    staff = access_policy.default_permissions("staff")
    assert staff["module_leads"]["view"] and staff["module_leads"]["edit"] and not staff["module_leads"]["delete"]
    assert staff["can_see_all_leads"] is False and access_policy.default_permissions("manager")["can_see_all_leads"] is True
    assert access_policy.match("POST", "/api/material-quotes/{quote_id}/status") == ("page", "module_material_quotes", "edit", True)
