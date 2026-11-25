"""Odoo → Sensoper sync against a fake Odoo (JSON-2 and JSON-RPC), in-process, no MongoDB server:
    cd backend && pytest tests/test_odoo_sync.py
"""
import asyncio
import json
import os
import secrets
import sys
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "odoo_sync_test")
os.environ.setdefault("JWT_SECRET", "o" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "t-" + secrets.token_hex(12))
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-odoo-sync-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
import server  # noqa: E402
import odoo_sync  # noqa: E402
from tests.fake_odoo import FakeOdoo, KEY, DB, LOGIN  # noqa: E402

PW = "pw-" + secrets.token_hex(8)
TAG = "odoo-sync-test"
URL = "https://odoo.example.com"


# ───────────── pure rules ─────────────
def test_address_rules():
    assert odoo_sync.clean_url("sensoper.odoo.com/odoo/action-1") == "https://sensoper.odoo.com"
    assert odoo_sync.clean_url("https://erp.sensoper.in:8443/web") == "https://erp.sensoper.in:8443"
    for bad in ("ftp://x.com", "https://user:pw@x.com", "", "https://-..x"):
        with pytest.raises(Exception):
            odoo_sync.clean_url(bad)
    assert odoo_sync.guess_database("https://sensoper.odoo.com") == "sensoper"
    assert odoo_sync.guess_database("https://erp.sensoper.in") == ""


def test_internal_addresses_are_refused():
    old = os.environ.pop("ODOO_ALLOW_PRIVATE", None)
    try:
        loop = asyncio.new_event_loop()
        for host in ("https://127.0.0.1", "https://10.0.0.5", "https://localhost"):
            with pytest.raises(odoo_sync.OdooError):
                loop.run_until_complete(odoo_sync._check_public(host))
        loop.close()
    finally:
        if old is not None:
            os.environ["ODOO_ALLOW_PRIVATE"] = old


def test_guesses_and_merge():
    assert odoo_sync.stage_guess("Proposition") == "quoted" and odoo_sync.stage_guess("Qualified") == "contacted"
    assert odoo_sync.stage_guess("Site survey") == "site_visit" and odoo_sync.stage_guess("Anything", True) == "won"
    assert odoo_sync.channel_guess("IndiaMART") == "indiamart" and odoo_sync.channel_guess(None, "Facebook") == "meta_ads"
    assert odoo_sync.kind_guess("5 HP pump for the farm") == "farm" and odoo_sync.kind_guess("30 kW factory") == "business"
    assert odoo_sync._text("<p>3-phase, <b>&#8377;40k</b> bill</p>") == "3-phase, ₹40k bill"
    assert odoo_sync._state_name([598, "Tamil Nadu (IN)"]) == "Tamil Nadu"


# ───────────── the API ─────────────
@pytest.fixture(scope="module")
def loop():
    lp = asyncio.new_event_loop()
    yield lp
    lp.close()


@pytest.fixture(scope="module")
def app(loop):
    from cryptography.fernet import Fernet
    saved = {k: os.environ.get(k) for k in ("ODOO_ALLOW_PRIVATE", "VAULT_MASTER_KEY")}
    os.environ["ODOO_ALLOW_PRIVATE"] = "1"   # the fake answers for odoo.example.com through the test transport
    os.environ["VAULT_MASTER_KEY"] = Fernet.generate_key().decode()   # this module's own key, whatever other tests did
    loop.run_until_complete(server.app.router.startup())
    yield server.app
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def run(loop, coro):
    return loop.run_until_complete(coro)


def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://quote.example.in", headers={"x-forwarded-proto": "https"})


async def login(app, email, password):
    c = client(app)
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


async def wait_run(c, run_id, tries=200):
    for _ in range(tries):
        r = (await c.get(f"/api/odoo/runs/{run_id}")).json()
        if r["status"] != "running":
            return r
        await asyncio.sleep(0.02)
    raise AssertionError("run didn't finish")


@pytest.fixture(scope="module")
def world(app, loop):
    fake = FakeOdoo("json2")
    odoo_sync.TRANSPORT = httpx.ASGITransport(app=fake.app)

    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        users = {}
        for key, name, role in (("ravi", "Ravi Kumar", "staff"), ("mgr", f"Manager {TAG}", "manager")):
            email = f"{key}.{TAG}@example.com"
            r = await a.post("/api/users", json={"email": email, "password": PW, "name": name, "role": role})
            assert r.status_code == 200, r.text
            users[key] = await login(app, email, PW)
            users[f"{key}_id"] = str((await server.db.users.find_one({"email": email}))["_id"])
        return {"admin": a, "fake": fake, **users}
    async def tidy():   # leave the shared test database as we found it
        db = server.db
        lead_ids = [str(l["_id"]) async for l in db.website_leads.find({"odoo": {"$exists": True}}, {"_id": 1})]
        await db.notifications.delete_many({"source_id": {"$in": lead_ids}})
        for coll in (db.customers, db.vendors, db.inventory_items, db.website_leads):
            await coll.delete_many({"odoo": {"$exists": True}})
        await db.material_quotes.delete_many({"$or": [{"odoo": {"$exists": True}}, {"copied_from_odoo": {"$exists": True}}]})
        await db.inventory_categories.delete_many({"source": "odoo"})
        await db.inventory_transactions.delete_many({"user_name": "Odoo sync"})
        for coll in (db.odoo_settings, db.odoo_runs, db.odoo_records, db.odoo_lock):
            await coll.delete_many({})
        await db.users.delete_many({"email": {"$regex": TAG}})

    w = run(loop, go())
    yield w
    for t in list(server._odoo_router.running):
        run(loop, t)
    run(loop, tidy())
    odoo_sync.TRANSPORT = None


def test_connection_is_checked_and_the_key_never_comes_back(app, loop, world):
    async def go():
        a = world["admin"]
        # staff can't even look; a manager can look but not change it
        assert (await world["ravi"].get("/api/odoo/settings")).status_code == 403
        assert (await world["mgr"].get("/api/odoo/settings")).status_code == 200
        assert (await world["mgr"].put("/api/odoo/connection", json={"url": URL, "api_key": KEY})).status_code == 403
        # a wrong key is refused and nothing is saved
        r = await a.put("/api/odoo/connection", json={"url": URL, "api_key": "b2" * 20})
        assert r.status_code == 400 and "API key" in r.json()["detail"]
        assert not (await server.db.odoo_settings.find_one({"_id": "main"}) or {}).get("key_enc")
        r = await a.put("/api/odoo/connection", json={"url": f"{URL}/odoo/crm", "api_key": KEY})
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["has_key"] and s["api"] == "json2" and s["url"] == URL and s["odoo_user"] == "Prathipan" and s["key_last4"] == KEY[-4:]
        text = (await a.get("/api/odoo/settings")).text
        assert KEY not in text and "key_enc" not in text
        stored = await server.db.odoo_settings.find_one({"_id": "main"})
        assert stored["key_enc"] and KEY not in stored["key_enc"]
        t = (await a.post("/api/odoo/test")).json()
        assert t["counts"] == {"contacts": 3, "products": 3, "leads": 4, "orders": 2}
    run(loop, go())


def test_first_sync_brings_everything_in(app, loop, world):
    async def go():
        a = world["admin"]
        for name, extra in (("contacts", ["x_studio_customer_code"]), ("products", ["x_warranty_years"]), ("leads", ["x_studio_roof_type"]), ("orders", [])):
            r = await a.put(f"/api/odoo/syncs/{name}", json={"enabled": True, "extra_fields": extra})
            assert r.status_code == 200, r.text
        # a preview writes nothing
        p = (await a.post("/api/odoo/syncs/leads/preview")).json()
        assert p["results"]["leads"]["created"] == 4 and await server.db.website_leads.count_documents({"odoo.model": "crm.lead"}) == 0
        r = await a.post("/api/odoo/syncs/all/run")
        assert r.status_code == 200, r.text
        done = await wait_run(a, r.json()["run_id"])
        assert done["status"] == "done", done
        db = server.db
        # contacts: two customers, one vendor, the plain visitor left out
        cust = {c["name"]: c async for c in db.customers.find({"odoo.model": "res.partner"})}
        assert set(cust) == {"Murugan Textiles", "Kala Devi"}
        m = cust["Murugan Textiles"]
        assert m["phone"] == "9876543210" and m["gstin"] == "33AAACM1234A1Z5" and m["state"] == "Tamil Nadu" and m["odoo"]["extra"]["x_studio_customer_code"] == "C-101"
        v = await db.vendors.find_one({"odoo.model": "res.partner", "odoo.id": 11})
        assert v and v["name"] == "Sky Power" and v["phone"] == "9443322110" and v["active"] is True
        # products: SKU, cost, margin, GST from the tax group, HSN, stock and the category
        panel = await db.inventory_items.find_one({"sku_code": "WAR-605"})
        assert panel["unit_price"] == 16040.1 and panel["gst_percentage"] == 5 and panel["hsn_code"] == "85414300" and panel["quantity"] == 19
        assert abs(panel["unit_price"] * (1 + panel["margin_pct"] / 100) - 17644.11) < 0.02 and panel["category"] == "solar_panels"
        assert await db.inventory_categories.find_one({"slug": "solar_panels"})
        labour = await db.inventory_items.find_one({"odoo.id": 102, "odoo.model": "product.product"})
        assert labour["sku_code"] == "ODOO-102" and labour["gst_percentage"] == 18
        # leads: stage, owner by name, follow-up, lost reason, won
        leads = {l["odoo"]["id"]: l async for l in db.website_leads.find({"odoo.model": "crm.lead"})}
        big = leads[200]
        assert big["status"] == "quoted" and big["assigned_to"] == world["ravi_id"] and big["channel"] == "indiamart" and big["kind"] == "business"
        assert big["phone"] == "9443011111" and big["value"] == 1500000 and big["heat"] == "hot" and big["number"].startswith("L-")
        assert big["follow_up_on"] == (date.today() + timedelta(days=1)).isoformat() and big["follow_up_note"] == "Send the revised quote"
        assert "₹40k bill" in big["message"] and big["odoo"]["extra"]["x_studio_roof_type"] == "Metal sheet"
        assert await db.notifications.count_documents({"kind": "lead_follow_up", "source_id": str(big["_id"])}) == 1
        assert leads[201]["status"] == "new" and leads[201]["assigned_to"] is None
        assert leads[202]["status"] == "lost" and leads[202]["lost_reason"] == "Too expensive"
        assert leads[203]["status"] == "won"
        # orders: Odoo's totals exactly, read-only, linked to the lead
        q = await db.material_quotes.find_one({"odoo.model": "sale.order", "odoo.id": 300})
        assert q["number"] == "S00042" and q["status"] == "sent" and q["read_only"] and q["grand_total"] == 279084.80
        assert q["taxable_value"] == 254979.05 and round(q["cgst"] + q["sgst"], 2) == 24105.75 and q["igst"] == 0
        assert [l["name"] for l in q["lines"]] == ["[WAR-605] Waaree 605 W Panel", "[DEYE-5H] Deye 5 kW Hybrid Inverter"]
        assert q["lines"][0]["inventory_item_id"] == str(panel["_id"]) and q["lines"][0]["discount_pct"] == 5 and q["lines"][0]["line_total"] == 176000.0
        assert q["lead_id"] == str(big["_id"]) and "Panels" in q["notes"] and "Delivery in 7 days" in q["notes"]
        assert (await db.material_quotes.find_one({"odoo.id": 301, "odoo.model": "sale.order"}))["status"] == "rejected"
        # the run is in the history
        hist = (await a.get("/api/odoo/runs")).json()["items"]
        assert hist[0]["results"]["contacts"]["created"] >= 2 and hist[0]["trigger"] == "button"
        # the settings page still loads after a run (last run with a plain id), with counts per card
        st = await a.get("/api/odoo/settings")
        assert st.status_code == 200, st.text
        st = st.json()
        assert st["last_run"]["id"] == hist[0]["id"] and "_id" not in st["last_run"] and st["counts"]["leads"] == 4
        assert st["syncs"]["leads"]["last_run"]["created"] == 4
        # the lead and the quotation show what Odoo says, never the copy-tracking snapshot
        lead = (await a.get(f"/api/crm/leads/{big['_id']}")).json()
        assert lead["odoo"]["stage"] and lead["odoo"]["extra"]["x_studio_roof_type"] == "Metal sheet" and "values" not in lead["odoo"]
        meta = (await a.get("/api/crm/meta")).json()
        assert meta["odoo"]["url"].startswith("http") and meta["odoo"]["lead_fields"]["x_studio_roof_type"] == "Roof type"
        assert "key" not in json.dumps(meta["odoo"]).lower()
        qo = (await a.get(f"/api/material-quotes/{q['_id']}")).json()
        assert qo["read_only"] and qo["odoo"]["id"] == 300 and "values" not in qo["odoo"]
        d = (await a.get("/api/material-quotes/defaults")).json()
        assert d["odoo"]["url"] == meta["odoo"]["url"]
    run(loop, go())


def test_sensoper_changes_win_and_odoo_changes_flow_in(app, loop, world):
    async def go():
        a, fake, db = world["admin"], world["fake"], server.db
        big = await db.website_leads.find_one({"odoo.model": "crm.lead", "odoo.id": 200})
        small = await db.website_leads.find_one({"odoo.model": "crm.lead", "odoo.id": 201})
        # someone works the lead in Sensoper: a new value
        r = await a.put(f"/api/crm/leads/{big['_id']}", json={"value": 1800000})
        assert r.status_code == 200
        # meanwhile in Odoo: the value changes on 200, lead 201 moves to Qualified, the panel's cost goes up
        fake.touch("crm.lead", 200, expected_revenue=1600000, phone="+91 94430 22222")
        fake.touch("crm.lead", 201, stage_id=[2, "Qualified"])
        fake.touch("product.product", 100, standard_price=16500.0, qty_available=3)
        done = await wait_run(a, (await a.post("/api/odoo/syncs/all/run")).json()["run_id"])
        assert done["status"] == "done", done
        big = await db.website_leads.find_one({"_id": big["_id"]})
        assert big["value"] == 1800000 and big["phone"] == "9443022222"      # their value stays; the untouched phone follows Odoo
        assert done["results"]["leads"]["kept_local"] >= 1
        small = await db.website_leads.find_one({"_id": small["_id"]})
        assert small["status"] == "contacted" and any("Odoo: moved to" in x["text"] for x in small["activity"])
        panel = await db.inventory_items.find_one({"sku_code": "WAR-605"})
        assert panel["unit_price"] == 16500.0 and panel["quantity"] == 19     # stock isn't Odoo's to change by default
        # incremental: only what changed comes back
        assert done["results"]["contacts"]["total"] <= 1 and done["results"]["leads"]["total"] <= 3
        # with "keep stock in step with Odoo" the on-hand quantity follows
        await a.put("/api/odoo/syncs/products", json={"options": {"update_stock": True}})
        done = await wait_run(a, (await a.post("/api/odoo/syncs/products/run")).json()["run_id"])
        assert (await db.inventory_items.find_one({"sku_code": "WAR-605"}))["quantity"] == 3
        assert await db.inventory_transactions.find_one({"notes": "Stock set to Odoo's on-hand quantity"})
    run(loop, go())


def test_odoo_quotations_are_read_only_but_can_be_copied(app, loop, world):
    async def go():
        a, db = world["admin"], server.db
        q = await db.material_quotes.find_one({"odoo.model": "sale.order", "odoo.id": 300})
        qid = str(q["_id"])
        got = (await a.get(f"/api/material-quotes/{qid}")).json()
        assert got["read_only"] and got["display_number"] == "S00042"
        assert (await a.put(f"/api/material-quotes/{qid}", json={"customer": {"name": "x y"}, "lines": [{"name": "a", "quantity": 1, "unit_price": 1}]})).status_code == 400
        assert (await a.post(f"/api/material-quotes/{qid}/status", json={"status": "accepted"})).status_code == 400
        assert (await a.delete(f"/api/material-quotes/{qid}")).status_code == 400
        sale = {"sale_type": "b2b", "customer": {"name": "Murugan Textiles", "phone": "9876543210", "state": "Tamil Nadu"},
                "lines": [{"name": "x", "quantity": 1, "unit_price": 1}], "material_quote_id": qid}
        assert (await a.post("/api/sales", json=sale)).status_code == 400
        cp = (await a.post(f"/api/material-quotes/{qid}/duplicate")).json()
        assert cp["number"].startswith("MQ") and not cp.get("read_only") and cp["copied_from_odoo"] == "S00042" and cp["terms"]
        assert (await a.put(f"/api/material-quotes/{cp['id']}", json={"customer": cp["customer"], "lines": cp["lines"]})).status_code == 200
        # the quotation form finds Odoo customers
        found = (await a.get("/api/material-quotes/customers", params={"q": "murugan"})).json()["items"]
        assert found and found[0]["gstin"] == "33AAACM1234A1Z5" and found[0]["from_odoo"]
    run(loop, go())


def test_custom_table_with_filter(app, loop, world):
    async def go():
        a, db = world["admin"], server.db
        models = (await a.get("/api/odoo/models", params={"q": "survey"})).json()["models"]
        assert models[0]["model"] == "x_site_survey" and models[0]["custom"]
        f = (await a.get("/api/odoo/fields", params={"model": "x_site_survey"})).json()["fields"]
        names = [x["name"] for x in f]
        assert "x_photo" not in names and names[0].startswith("x_")
        bad = await a.post("/api/odoo/tables", json={"label": "Surveys", "model": "x_site_survey", "fields": ["x_name"], "filters": [{"field": "nope", "op": "=", "value": 1}]})
        assert bad.status_code == 400
        r = await a.post("/api/odoo/tables", json={"label": "Site surveys", "model": "x_site_survey", "fields": ["x_name", "x_roof_type", "x_area_sqft", "x_tag_ids", "x_photo"],
                                                   "filters": [{"field": "x_area_sqft", "op": ">", "value": "500"}]})
        assert r.status_code == 200, r.text
        t = r.json()["tables"][0]
        assert t["key"] == "site_surveys" and "x_photo" not in t["fields"]
        done = await wait_run(a, (await a.post("/api/odoo/syncs/table:site_surveys/run")).json()["run_id"])
        assert done["status"] == "done", done
        data = (await a.get("/api/odoo/data/site_surveys")).json()
        assert data["total"] == 1 and data["rows"][0]["x_roof_type"] == "Metal sheet" and data["rows"][0]["x_tag_ids"] == "Priority, Shade"
        assert [c["label"] for c in data["columns"]] == ["Site", "Roof", "Area (sq ft)", "Tags"]
        cust = (await a.get("/api/odoo/data/customers", params={"q": "kala"})).json()
        assert cust["total"] == 1 and cust["rows"][0]["extra.x_studio_customer_code"] == "C-102"
        assert (await a.delete("/api/odoo/tables/site_surveys")).json()["records"] == 1
        assert await db.odoo_records.count_documents({"table": "site_surveys"}) == 0
    run(loop, go())


def test_hourly_runs_only_when_due_and_one_at_a_time(app, loop, world):
    async def go():
        a, db = world["admin"], server.db
        router = server._odoo_router
        await db.odoo_settings.update_one({"_id": "main"}, {"$set": {"auto_hourly": True, "last_auto_at": None}})
        rid = await router.hourly_once()
        assert rid
        await wait_run(a, rid)
        assert await router.hourly_once() is None          # ran just now
        # a run already going → a second one is refused
        await db.odoo_lock.update_one({"_id": "lock"}, {"$set": {"until": "2999-01-01T00:00:00+00:00", "run_id": "x"}})
        assert (await a.post("/api/odoo/syncs/all/run")).status_code == 409
        await db.odoo_lock.update_one({"_id": "lock"}, {"$set": {"until": None}})
        # staff can't run it; a manager can look but not run
        assert (await world["ravi"].post("/api/odoo/syncs/all/run")).status_code == 403
        assert (await world["mgr"].post("/api/odoo/syncs/all/run")).status_code == 403
    run(loop, go())


def test_older_odoo_over_json_rpc(app, loop, world):
    async def go():
        a = world["admin"]
        fake = FakeOdoo("jsonrpc")
        odoo_sync.TRANSPORT = httpx.ASGITransport(app=fake.app)
        try:
            r = await a.put("/api/odoo/connection", json={"url": URL, "api_key": KEY, "login": LOGIN, "database": "wrong-db"})
            assert r.status_code == 400 and "wrong-db" in r.json()["detail"]
            r = await a.put("/api/odoo/connection", json={"url": URL, "api_key": KEY, "login": "someone@else.in", "database": DB})
            assert r.status_code == 400 and "login" in r.json()["detail"]
            r = await a.put("/api/odoo/connection", json={"url": URL, "api_key": KEY, "login": LOGIN, "database": DB})
            assert r.status_code == 200 and r.json()["api"] == "jsonrpc" and r.json()["odoo_version"] == "18.0"
            fake.touch("res.partner", 12, city="Bhavani")
            done = await wait_run(a, (await a.post("/api/odoo/syncs/contacts/run", params={"full": "true"})).json()["run_id"])
            assert done["status"] == "done", done
            assert (await server.db.customers.find_one({"odoo.id": 12, "odoo.model": "res.partner"}))["city"] == "Bhavani"
        finally:
            odoo_sync.TRANSPORT = httpx.ASGITransport(app=world["fake"].app)
    run(loop, go())


def test_ai_agents_need_a_person_to_approve_connection_and_runs():
    import agent_rules
    assert "Odoo connection" in (agent_rules.confirm_reason("/api/odoo/connection", "PUT", {"url": "x"}) or "")
    assert "Odoo" in (agent_rules.confirm_reason("/api/odoo/syncs/all/run", "POST") or "")
    assert agent_rules.confirm_reason("/api/odoo/settings", "GET") is None
