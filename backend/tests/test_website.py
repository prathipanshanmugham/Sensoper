"""Public website (sensoper.in / shop.sensoper.in): leads, shop, pop-ups and customer logins.
In-process, no MongoDB server:
    cd backend && pytest tests/test_website.py
"""
import asyncio
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "website_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "Adm1n-pass-123")
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-website-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
from bson import ObjectId  # noqa: E402
import server  # noqa: E402
import website  # noqa: E402

PW = "Passw0rd!x"
EMAILS = ["web.staff@example.com", "web.mgr@example.com"]
TAG = "website-test"


# ───────────── pure rules ─────────────
def test_mobile_numbers_and_calculator_figures_are_cleaned():
    assert website.mobile("+91 98765 43210") == "9876543210"
    assert website.mobile("09876543210") == "9876543210"
    assert website.mobile("98765-43210") == "9876543210"
    assert website.mobile("12345") is None and website.mobile("1234567890") is None   # landline-looking / too short
    c = website.clean_calc({"mode": "home", "bill": "4500", "kw": 3.04, "evil": "<script>", "payback_years": 1e9, "subsidy": "nan"})
    assert c == {"mode": "home", "bill": 4500.0, "kw": 3.04, "payback_years": 100}
    assert website.clean_calc("not a dict") == {}
    s = website.lead_summary({"kind": "home", "calc": {"bill": 4500, "kw": 3}, "area": "Perundurai"})
    assert s == "Home rooftop — ₹4,500 bill, about 3 kW · Perundurai"
    assert website.inr(214760) == "₹2,14,760" and website.inr(4500) == "₹4,500" and website.inr(12345678) == "₹1,23,45,678" and website.inr(999) == "₹999"
    pw = website.temp_password()
    assert re.match(r"^[a-z]{4}[2-9]{4}$", pw) and not set(pw) & set("01ilo")
    assert website._clean("<b>Hi</b>\x07  there", 50) == "Hi there"


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


def client(app, ip="10.0.0.1"):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://sensoper.example.in",
                             headers={"x-forwarded-proto": "https", "x-forwarded-for": ip})


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
        for email, name, role in zip(EMAILS, ("Kavin Field", "Divya Lead"), ("staff", "manager")):
            r = await a.post("/api/users", json={"email": email, "password": PW, "name": name, "role": role, "phone": "9876500" + str(len(name)) + "11"})
            assert r.status_code == 200, r.text
            ids[role] = r.json().get("id") or str((await server.db.users.find_one({"email": email}))["_id"])
        return {"admin": a, "staff": await login(app, EMAILS[0], PW), "mgr": await login(app, EMAILS[1], PW), "ids": ids}

    async def tidy():
        db = server.db
        await db.users.delete_many({"email": {"$in": EMAILS}})
        for coll in ("website_leads", "website_popups", "website_settings", "client_accounts", "client_login_attempts", "website_lead_hits",
                     "website_testimonials"):
            await db[coll].delete_many({})
        await db.projects.delete_many({"reference_number": {"$regex": "^WEB-"}})
        await db.inventory_items.delete_many({"notes": TAG})
        await db.brands.delete_many({"name": {"$regex": "^WT "}})
        await db.locations.delete_many({"tag": TAG})

    yield run(loop, go())
    run(loop, tidy())


def test_a_lead_from_the_website_reaches_staff(app, loop, world):
    async def go():
        pub = client(app, "10.1.1.1")
        r = await pub.post("/api/public/leads", json={"name": "Meena", "phone": "12345", "kind": "home"})
        assert r.status_code == 400 and "10-digit" in r.json()["detail"]
        r = await pub.post("/api/public/leads", json={"name": "M", "phone": "9876543210"})
        assert r.status_code == 400
        r = await pub.post("/api/public/leads", json={"name": "Bot", "phone": "9876543210", "website": "http://spam"})
        assert r.status_code == 200 and r.json()["number"] is None
        assert await server.db.website_leads.count_documents({}) == 0          # the honeypot keeps bots out

        r = await pub.post("/api/public/leads", json={
            "name": "Meena <b>R</b>", "phone": "+91 98765 43210", "pincode": "638052", "area": "Perundurai", "kind": "home",
            "source": "calculator", "calc": {"mode": "home", "bill": 4500, "kw": 3, "subsidy": 78000},
            "utm": {"utm_source": "google", "secret": "drop me"}, "page": "/"})
        assert r.status_code == 200, r.text
        first = r.json()["number"]
        assert re.match(r"^WL-\d{4}$", first)
        lead = await server.db.website_leads.find_one({"number": first})
        assert lead["name"] == "Meena R" and lead["phone"] == "9876543210" and lead["utm"] == {"utm_source": "google"}
        assert lead["calc"]["kw"] == 3 and lead["status"] == "new"
        # the admin's bell has it
        note = await server.db.notifications.find_one({"kind": "website_lead", "source_id": str(lead["_id"])})
        assert note and "Meena R" in note["title"] and "₹4,500 bill" in note["message"] and note["link"].endswith(str(lead["_id"]))

        # the same person asks again → the same lead, flagged again (not a duplicate row)
        r = await pub.post("/api/public/leads", json={"name": "Meena R", "phone": "9876543210", "kind": "battery", "message": "Also battery?"})
        assert r.json()["number"] == first
        lead = await server.db.website_leads.find_one({"number": first})
        assert lead["submissions"] == 2 and lead["kind"] == "battery" and len(lead["activity"]) == 2 and "Also battery?" in lead["activity"][-1]["text"]

        # one address can't flood the inbox
        spam = client(app, "10.9.9.9")
        codes = [(await spam.post("/api/public/leads", json={"name": f"Spam {i}", "phone": f"98{i:08d}"})).status_code for i in range(website.LEAD_HITS + 2)]
        assert codes.count(200) == website.LEAD_HITS and codes[-1] == 429

        # staff work the lead
        st, mgr = world["staff"], world["mgr"]
        r = await st.get("/api/website/leads", params={"status": "open"})
        assert r.status_code == 200 and any(l["number"] == first for l in r.json()["items"])
        assert r.json()["counts"]["new"] >= 1
        lid = str(lead["_id"])
        r = await st.put(f"/api/website/leads/{lid}", json={"note": "Called, wants visit Saturday", "follow_up_on": "2026-11-22"})
        assert r.status_code == 200 and r.json()["status"] == "contacted" and r.json()["follow_up_on"] == "2026-11-22"
        r = await st.put(f"/api/website/leads/{lid}", json={"status": "flying"})
        assert r.status_code == 400
        r = await st.put(f"/api/website/leads/{lid}", json={"assigned_to": world["ids"]["staff"]})
        assert r.json()["assigned_to_name"] == "Kavin Field"
        proj = await server.db.projects.insert_one({"reference_number": "WEB-LEAD-1", "status": "draft", "created_by": world["ids"]["staff"],
                                                    "customer": {"name": "Meena R", "phone": "9876543210"}})
        r = await st.put(f"/api/website/leads/{lid}", json={"project_id": str(proj.inserted_id)})
        assert r.json()["status"] == "site_visit" and r.json()["project_reference"] == "WEB-LEAD-1"
        assert (await st.delete(f"/api/website/leads/{lid}")).status_code == 403       # staff can't delete leads
        r = await st.get("/api/website/summary")
        assert r.status_code == 200 and r.json()["open_leads"] >= 1
    run(loop, go())


def test_popups_settings_and_prices_for_the_site(app, loop, world):
    async def go():
        a, st, mgr = world["admin"], world["staff"], world["mgr"]
        r = await st.post("/api/website/popups", json={"title": "Diwali offer", "message": "Free cleaning kit"})
        assert r.status_code == 403                                  # pop-ups are an option staff don't have by default
        r = await mgr.post("/api/website/popups", json={"title": "Diwali offer", "message": "Free cleaning kit with every 3 kW", "cta_action": "quote",
                                                         "where": "site", "delay_seconds": 400})
        assert r.status_code == 200 and r.json()["delay_seconds"] == 120
        await mgr.post("/api/website/popups", json={"title": "Old news", "message": "x", "valid_till": "2020-01-01"})
        await mgr.post("/api/website/popups", json={"title": "Shop only", "message": "Cables in stock", "where": "shop"})
        r = await mgr.post("/api/website/popups", json={"title": "Bad link", "cta_action": "link", "cta_url": "javascript:alert(1)"})
        assert r.status_code == 400
        r = await mgr.put("/api/website/settings", json={"whatsapp_number": "123"})
        assert r.status_code == 400
        r = await mgr.put("/api/website/settings", json={"whatsapp_number": "+91 90435 47047", "show_price_estimate": True})
        assert r.status_code == 200 and r.json()["whatsapp_number"] == "9043547047"
        await server.db.pricing_slabs.insert_one({"category": "on-grid", "unit": "kw", "active": True, "slabs": [{"from_value": 1, "to_value": 3, "rate_per_unit": 70000}], "tag": TAG})

        pub = client(app, "10.2.2.2")
        r = await pub.get("/api/public/site")
        assert r.status_code == 200 and "max-age" in r.headers.get("cache-control", "")
        site = r.json()
        titles = [p["title"] for p in site["popups"]]
        assert "Diwali offer" in titles and "Old news" not in titles and "Shop only" not in titles
        assert "Shop only" in [p["title"] for p in (await pub.get("/api/public/site", params={"where": "shop"})).json()["popups"]]
        assert site["company"]["whatsapp"] == "9043547047"
        assert site["prices"]["slabs"]["on-grid"][0]["rate"] == 70000
        assert "password" not in r.text and "gst_number" not in r.text
        await mgr.put("/api/website/settings", json={"show_price_estimate": False})
        assert (await pub.get("/api/public/site")).json()["prices"] is None
        await server.db.pricing_slabs.delete_many({"tag": TAG})
    run(loop, go())


def test_shop_products_and_order_requests(app, loop, world):
    async def go():
        a, st, mgr = world["admin"], world["staff"], world["mgr"]
        db = server.db
        panel = await db.inventory_items.insert_one({"name": "Waaree 585W Topcon DCR Panel", "sku_code": "WEB-W585", "category": "solar_panels",
                                                     "unit_price": 15356.25, "margin_pct": 10, "gst_percentage": 5, "quantity": 40, "reorder_level": 5,
                                                     "wattage_w": 585, "notes": TAG})
        cable = await db.inventory_items.insert_one({"name": "Polycab 4 Sq.mm DC Cable Red", "sku_code": "WEB-CBL", "category": "cables_accessories",
                                                     "unit_price": 54.2, "quantity": 0, "notes": TAG})
        pid, cid = str(panel.inserted_id), str(cable.inserted_id)
        r = await st.post("/api/website/shop/products", json={"inventory_item_id": pid, "price": 17000})
        assert r.status_code == 403
        r = await mgr.post("/api/website/shop/products", json={"inventory_item_id": pid, "status": "live"})
        assert r.status_code == 400 and "price" in r.json()["detail"]
        r = await mgr.post("/api/website/shop/products", json={"inventory_item_id": pid, "price": 17736, "description": "Made in India, DCR — "
                                                                "eligible for PM Surya Ghar", "featured": True, "images": ["javascript:x", "https://cdn.example.in/w585.webp"]})
        assert r.status_code == 200, r.text
        row = r.json()
        assert row["status"] == "live" and row["images"] == ["https://cdn.example.in/w585.webp"]
        assert row["reference_price"] == round(15356.25 * 1.10 * 1.05, 2)
        r = await mgr.post("/api/website/shop/products", json={"inventory_item_id": cid, "price": 64, "status": "draft"})
        cable_listing = r.json()["id"]
        platform = await db.ecommerce_platforms.find_one({"platform_type": "custom_website"})
        assert platform and platform["commission_pct"] == 0

        pub = client(app, "10.3.3.3")
        r = await pub.get("/api/public/shop/products")
        prods = r.json()["products"]
        assert [p["title"] for p in prods] == ["Waaree 585W Topcon DCR Panel"]            # the draft cable is hidden
        p = prods[0]
        assert p["price"] == 17736 and p["stock"] == "in_stock" and p["featured"] and p["watt"] == 585
        assert "unit_price" not in r.text and "15356" not in r.text                      # cost never leaves the ERP
        assert p["images"] == ["https://cdn.example.in/w585.webp"]                     # outside pictures are linked directly
        assert (await pub.get(f"/api/public/shop/image/{cable_listing}/0")).status_code == 404   # draft listing → no picture

        # a stored file outside the images folder is never served
        await db.ecommerce_listings.update_one({"_id": ObjectId(p["id"])}, {"$push": {"images": "sensoper/secret/payslip.pdf"}})
        assert (await pub.get(f"/api/public/shop/image/{p['id']}/1")).status_code == 404

        # the order uses the shop's price, not what the browser says
        r = await pub.post("/api/public/shop/order", json={"name": "Arun", "phone": "9443322110", "items": [{"id": p["id"], "qty": 3, "price": 1}],
                                                          "delivery": "delivery", "address": ""})
        assert r.status_code == 400 and "address" in r.json()["detail"]
        r = await pub.post("/api/public/shop/order", json={"name": "Arun", "phone": "9443322110", "delivery": "pickup",
                                                          "items": [{"id": p["id"], "qty": 3}, {"id": cable_listing, "qty": 10}]})
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["total"] == 17736 * 3 and o["unavailable"] == [cable_listing] and o["lines"][0]["qty"] == 3
        lead = await db.website_leads.find_one({"number": o["number"]})
        assert lead["kind"] == "shop_order" and lead["order_total"] == 53208 and lead["delivery"] == "pickup"
        r = await pub.post("/api/public/shop/order", json={"name": "Arun", "phone": "9443322110", "delivery": "pickup", "items": [{"id": cable_listing, "qty": 1}]})
        assert r.status_code == 409

        # take it out of the shop
        assert (await mgr.delete(f"/api/website/shop/products/{p['id']}")).status_code == 200
        assert (await pub.get("/api/public/shop/products")).json()["products"] == []
        r = await mgr.get("/api/website/shop/products")
        assert r.status_code == 200 and all(i["id"] != p["id"] for i in r.json()["items"])
    run(loop, go())


def test_customer_logins_made_by_staff(app, loop, world):
    async def go():
        a, st, mgr, ids = world["admin"], world["staff"], world["mgr"], world["ids"]
        db = server.db
        mine = await db.projects.insert_one({"reference_number": "WEB-CL-1", "status": "approved", "created_by": ids["staff"],
                                            "customer": {"name": "Selvi K", "phone": "+91 99887 76655"},
                                            "custom_fields": {"proposed_solution": {"system_size_kw": 3, "system_type": "on-grid"}},
                                            "created_at": "2026-10-01T00:00:00+00:00"})
        theirs = await db.projects.insert_one({"reference_number": "WEB-CL-2", "status": "draft", "created_by": "someone-else",
                                              "customer": {"name": "Selvi K", "phone": "9988776655"}})
        nophone = await db.projects.insert_one({"reference_number": "WEB-CL-3", "status": "draft", "created_by": ids["staff"], "customer": {"name": "X"}})
        p1, p2 = str(mine.inserted_id), str(theirs.inserted_id)

        assert (await st.post(f"/api/projects/{str(nophone.inserted_id)}/client-login")).status_code == 400
        assert (await st.post(f"/api/projects/{p2}/client-login")).status_code == 403          # not their project
        r = await st.post(f"/api/projects/{p1}/client-login")
        assert r.status_code == 200, r.text
        pw = r.json()["password"]
        acc = r.json()["account"]
        assert acc["phone"] == "9988776655" and acc["must_change_password"] and acc["project_ids"] == [p1]
        assert "password_hash" not in r.text
        r = await st.get(f"/api/projects/{p1}/client-login")
        assert r.json()["linked"] and r.json()["account"]["id"] == acc["id"]
        # the manager adds the other project to the same login — no new password
        r = await mgr.post(f"/api/projects/{p2}/client-login")
        assert r.json()["password"] is None and r.json()["added"] and r.json()["account"]["project_ids"] == [p1, p2]
        r = await mgr.post("/api/client-accounts", json={"name": "Dup", "phone": "9988776655", "project_ids": [p1]})
        assert r.status_code == 409

        cust = client(app, "10.4.4.4")
        r = await cust.post("/api/client/auth/login", json={"phone": "9988776655", "password": "wrong-one"})
        assert r.status_code == 401
        r = await cust.post("/api/client/auth/login", json={"phone": "+91 99887-76655", "password": pw})
        assert r.status_code == 200 and r.json()["must_change_password"]
        me = (await cust.get("/api/client/me")).json()
        assert [p["reference"] for p in me["projects"]] == ["WEB-CL-1", "WEB-CL-2"] and me["projects"][0]["size_kw"] == 3
        assert (await cust.get(f"/api/client/projects/{p1}/dashboard")).status_code == 403     # set a password first
        r = await cust.post("/api/client/auth/change-password", json={"current_password": pw, "new_password": "short"})
        assert r.status_code == 422
        r = await cust.post("/api/client/auth/change-password", json={"current_password": pw, "new_password": "Selvi-sun-2026"})
        assert r.status_code == 200
        r = await cust.get(f"/api/client/projects/{p1}/dashboard")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["project"]["reference"] == "WEB-CL-1" and d["customer"]["name"] == "Selvi K" and d["journey"]
        other = await db.projects.insert_one({"reference_number": "WEB-CL-9", "customer": {"name": "Someone", "phone": "9000011111"}})
        assert (await cust.get(f"/api/client/projects/{str(other.inserted_id)}/dashboard")).status_code == 404
        assert (await cust.get("/api/client/projects/not-an-id/dashboard")).status_code == 404
        r = await cust.post(f"/api/client/projects/{p1}/tickets", json={"category": "no_power", "description": "Inverter shows error E05 since morning"})
        assert r.status_code == 200 and r.json()["number"]
        t = await db.support_tickets.find_one({"_id": ObjectId(r.json()["id"])})
        assert t["reported_via"] == "customer_login" and t["priority"] == "high"
        # the staff login cookie is not a customer login, and the customer cookie can't open the ERP
        assert (await st.get("/api/client/me")).status_code == 401
        assert (await cust.get("/api/projects")).status_code == 401

        # the login now shows another salesperson's project too, so staff can't reset or change it — that would let them sign
        # in as the customer and see a project the ERP hides from them
        assert (await st.post(f"/api/client-accounts/{acc['id']}/reset-password")).status_code == 403
        assert (await st.put(f"/api/client-accounts/{acc['id']}", json={"project_ids": [p1]})).status_code == 403
        rows = (await st.get("/api/client-accounts", params={"q": "Selvi"})).json()
        assert rows and [p["reference"] for p in rows[0]["projects"]] == ["WEB-CL-1"] and rows[0]["project_ids"] == [p1] and rows[0]["other_projects"] == 1
        assert (await st.get(f"/api/projects/{p1}/client-login")).json()["can_change"] is False
        # a manager's reset signs the customer out and makes them choose a password again
        r = await mgr.post(f"/api/client-accounts/{acc['id']}/reset-password")
        assert r.status_code == 200 and r.json()["password"] and r.json()["password"] != pw
        assert (await cust.get("/api/client/me")).status_code == 401
        # turning it off blocks sign-in, and a reset doesn't switch it back on
        assert (await mgr.put(f"/api/client-accounts/{acc['id']}", json={"active": False})).status_code == 200
        r2 = await mgr.post(f"/api/client-accounts/{acc['id']}/reset-password")
        assert (await server.db.client_accounts.find_one({"_id": ObjectId(acc["id"])}))["active"] is False
        r = await cust.post("/api/client/auth/login", json={"phone": "9988776655", "password": r2.json()["password"]})
        assert r.status_code == 401
        await mgr.put(f"/api/client-accounts/{acc['id']}", json={"active": True})
        assert (await st.delete(f"/api/client-accounts/{acc['id']}")).status_code == 403
        assert (await mgr.delete(f"/api/client-accounts/{acc['id']}")).status_code == 200

        # brute force on one number is stopped — but a stranger guessing elsewhere doesn't lock the real customer out
        bf = client(app, "10.5.5.5")
        codes = [(await bf.post("/api/client/auth/login", json={"phone": "9123456780", "password": f"x{i}"})).status_code for i in range(8)]
        assert codes[:website.LOGIN_TRIES] == [401] * website.LOGIN_TRIES and codes[-1] == 429
        other = client(app, "10.6.6.6")
        assert (await other.post("/api/client/auth/login", json={"phone": "9123456780", "password": "y"})).status_code == 401
    run(loop, go())


def test_website_page_is_on_the_permissions_page(app, loop, world):
    async def go():
        r = await world["admin"].get("/api/permissions/catalog")
        if r.status_code == 404:
            r = await world["admin"].get("/api/permissions/policy")
        keys = [p["key"] for s in r.json()["sections"] for p in s["pages"]] if r.status_code == 200 else []
        assert "module_website" in keys
        perms = await server.get_permissions("staff")
        assert perms["module_website"]["view"] and perms["module_website"]["create"] and not perms["module_website"]["delete"]
        assert perms.get("can_manage_website") is False
        assert (await server.get_permissions("manager")).get("can_manage_website") is True
    run(loop, go())


def test_review_fixes_for_public_inputs(app, loop, world):
    """Findings from the security review: slow-regex input, lead take-over by phone number, pictures, pop-up links."""
    import time
    async def go():
        db = server.db
        # a long run of '<' is cleaned in linear time, before anything else happens
        t0 = time.perf_counter()
        out = website._clean("<" * 200000 + "<b>hi</b>", 1000)
        assert time.perf_counter() - t0 < 0.5 and len(out) <= 1000
        pub = client(app, "10.7.7.7")
        r = await pub.post("/api/public/leads", json={"name": "A" * 5000, "phone": "9876500001"})
        assert r.status_code == 422                                     # oversized fields are refused outright

        # someone else typing a customer's number can't change who the lead is
        r = await pub.post("/api/public/leads", json={"name": "Meena Real", "phone": "9876500002", "email": "meena@example.in", "area": "Perundurai"})
        num = r.json()["number"]
        evil = client(app, "10.8.8.8")
        await evil.post("/api/public/leads", json={"name": "Fake Name", "phone": "9876500002", "email": "x@evil.in", "area": "Elsewhere", "message": "send the quote here"})
        lead = await db.website_leads.find_one({"number": num})
        assert lead["name"] == "Meena Real" and lead["email"] == "meena@example.in" and lead["area"] == "Perundurai"
        assert "Fake Name" in lead["activity"][-1]["text"] and "x@evil.in" in lead["activity"][-1]["text"]

        # pictures: only the shop's own live listings, only raster images, safe headers
        shop = await db.ecommerce_platforms.find_one({"platform_type": "custom_website"})
        amazon = await db.ecommerce_platforms.insert_one({"name": "Amazon", "platform_type": "marketplace", "active": True})
        server.put_object(f"{server.APP_NAME}/images/w.png", b"\x89PNG fake", "image/png")
        server.put_object(f"{server.APP_NAME}/images/x.svg", b"<svg onload=alert(1)>", "image/svg+xml")
        a = await db.ecommerce_listings.insert_one({"platform_id": str(amazon.inserted_id), "status": "live", "images": [f"{server.APP_NAME}/images/w.png"], "inventory_item_id": "x"})
        b = await db.ecommerce_listings.insert_one({"platform_id": str(shop["_id"]) if shop else "none", "status": "live",
                                                   "images": [f"{server.APP_NAME}/images/w.png", f"{server.APP_NAME}/images/x.svg", "https://cdn.example.in/p.webp"], "inventory_item_id": "x"})
        assert (await pub.get(f"/api/public/shop/image/{a.inserted_id}/0")).status_code == 404
        if shop:
            ok = await pub.get(f"/api/public/shop/image/{b.inserted_id}/0")
            assert ok.status_code == 200 and ok.headers["x-content-type-options"] == "nosniff" and "sandbox" in ok.headers["content-security-policy"]
            assert (await pub.get(f"/api/public/shop/image/{b.inserted_id}/1")).status_code == 404     # SVG never served
            assert (await pub.get(f"/api/public/shop/image/{b.inserted_id}/2", follow_redirects=False)).status_code == 404   # no redirects
        await db.ecommerce_listings.delete_many({"_id": {"$in": [a.inserted_id, b.inserted_id]}})

        # pop-up links can't leave for another site
        mgr = world["mgr"]
        for bad in ("//evil.example", "/\\evil.example", "javascript:alert(1)", "https:///x"):
            r = await mgr.post("/api/website/popups", json={"title": "Link test", "cta_action": "link", "cta_url": bad})
            assert r.status_code == 400, bad
        for good in ("/#subsidy", "https://sensoper.in/#calculator"):
            r = await mgr.post("/api/website/popups", json={"title": "Link test", "cta_action": "link", "cta_url": good})
            assert r.status_code == 200, good

        # the public price table carries only the package slabs, never the calculator's internal per-kW figure
        await db.calc_config.update_one({"_id": "singleton"}, {"$set": {"cost_per_kwp": {"on-grid": 41000}}}, upsert=True)
        await mgr.put("/api/website/settings", json={"show_price_estimate": True})
        site = (await pub.get("/api/public/site")).json()
        assert site["prices"]["per_kw"] == {} and "41000" not in str(site)
    run(loop, go())


def test_number_first_lead_is_filled_in_by_the_quiz(app, loop, world):
    """The hero box saves just the number; the quiz that follows adds the name to the same lead."""
    async def go():
        db = server.db
        pub = client(app, "10.9.1.1")
        r = await pub.post("/api/public/leads", json={"name": "", "phone": "9566012345"})
        assert r.status_code == 400                                                  # other forms still need a name
        r = await pub.post("/api/public/leads", json={"phone": "9566012345", "source": "quick", "page": "/"})
        assert r.status_code == 200
        num = r.json()["number"]
        lead = await db.website_leads.find_one({"number": num})
        assert lead["name"] == "" and lead["source"] == "quick"
        note = await db.notifications.find_one({"source_id": str(lead["_id"])})
        assert note and "left their number" in note["title"]
        r = await pub.post("/api/public/leads", json={"name": "Lakshmi", "phone": "9566012345", "source": "quiz", "kind": "home", "area": "Bhavani",
                                                     "calc": {"mode": "home", "bill": 4500}})
        assert r.json()["number"] == num
        lead = await db.website_leads.find_one({"number": num})
        assert lead["name"] == "Lakshmi" and lead["area"] == "Bhavani" and lead["source"] == "quiz" and lead["submissions"] == 2
        notes = [n["title"] async for n in db.notifications.find({"source_id": str(lead["_id"])})]
        assert any("New website lead: Lakshmi" in t for t in notes)
    run(loop, go())



# ───────────── Nov 2026: brands, testimonials, pick-up stores, site addresses ─────────────
def test_youtube_links_addresses_phones_coordinates_and_ranges():
    vid = "dQw4w9WgXcQ"
    for url in (f"https://www.youtube.com/watch?v={vid}", f"https://m.youtube.com/watch?feature=share&v={vid}&t=42",
                f"https://youtu.be/{vid}?si=abc", f"youtu.be/{vid}", f"https://youtube.com/shorts/{vid}?feature=share",
                f"https://www.youtube.com/embed/{vid}", f"https://www.youtube.com/live/{vid}", f"https://www.youtube-nocookie.com/embed/{vid}"):
        assert website.youtube_id(url) == vid, url
    for bad in (f"https://vimeo.com/{vid}", f"https://evil.example/watch?v={vid}", f"https://youtube.com.evil.example/watch?v={vid}",
                f"https://user@youtube.com/watch?v={vid}", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/@sensoper",
                f"javascript:alert('{vid}')", f"https://www.youtube.com/embed/{vid}/../x", "", None, vid):
        assert website.youtube_id(bad) is None, bad
    assert website.site_address("https://Shop.Sensoper.in/") == "https://shop.sensoper.in"
    assert website.site_address("https://quote.sensoper.in/shop/") == "https://quote.sensoper.in/shop"
    assert website.site_address("") == "" and website.site_address("   ") == ""
    for bad in ("http://shop.sensoper.in", "shop.sensoper.in", "https://localhost", "javascript:alert(1)", "https://x.in/a b", "https://x.in/?q=1"):
        assert website.site_address(bad) is None, bad
    assert website.store_phone("+91 90435 47047") == "9043547047" and website.store_phone("0424 2233445") == "04242233445"
    assert website.store_phone("") == "" and website.store_phone("12345") is None and website.store_phone("0000000000") is None
    assert website.coordinates("11.2712, 77.5845") == (11.2712, 77.5845) and website.coordinates("") is None
    assert website.coordinates("https://www.google.com/maps/place/Sensoper/@11.27121,77.58452,17z") == (11.27121, 77.58452)
    for bad in ("77.5845, 11.2712", "40.71, -74.00", "near the bus stand"):
        with pytest.raises(ValueError):
            website.coordinates(bad)
    assert website.byte_range("bytes=0-1", 10) == (0, 1) and website.byte_range("bytes=4-", 10) == (4, 9)
    assert website.byte_range("bytes=-3", 10) == (7, 9) and website.byte_range("bytes=2-999", 10) == (2, 9)
    assert website.byte_range(None, 10) is None and website.byte_range("items=0-1", 10) is None and website.byte_range("bytes=0-1,4-5", 10) is None
    for bad in ("bytes=10-", "bytes=5-2", "bytes=abc", "bytes=-0", "bytes=-"):
        with pytest.raises(LookupError):
            website.byte_range(bad, 10)


def test_site_and_shop_addresses_in_settings(app, loop, world):
    async def go():
        mgr, st = world["mgr"], world["staff"]
        pub = client(app, "10.11.1.1")
        assert (await pub.get("/api/public/site")).json()["urls"] == {"site": "https://quote.sensoper.in", "shop": ""}
        assert (await st.put("/api/website/settings", json={"shop_url": "https://shop.sensoper.in"})).status_code == 403
        r = await mgr.put("/api/website/settings", json={"shop_url": "http://shop.sensoper.in"})
        assert r.status_code == 400 and "https://" in r.json()["detail"]
        r = await mgr.put("/api/website/settings", json={"site_url": "quote.sensoper.in"})
        assert r.status_code == 400 and "main website address" in r.json()["detail"]
        r = await mgr.put("/api/website/settings", json={"site_url": "https://Sensoper.in/", "shop_url": "https://shop.sensoper.in/"})
        assert r.status_code == 200 and r.json()["site_url"] == "https://sensoper.in" and r.json()["shop_url"] == "https://shop.sensoper.in"
        assert r.json()["default_site_url"] == "https://quote.sensoper.in"
        assert (await pub.get("/api/public/site")).json()["urls"] == {"site": "https://sensoper.in", "shop": "https://shop.sensoper.in"}
        r = await mgr.put("/api/website/settings", json={"site_url": "", "shop_url": ""})
        assert r.json()["site_url"] == "" and r.json()["urls"]["site"] == "https://quote.sensoper.in"
        assert (await pub.get("/api/public/site")).json()["urls"] == {"site": "https://quote.sensoper.in", "shop": ""}
        r = await mgr.put("/api/website/settings", json={"whatsapp_number": "9043547047"})   # the other settings leave the addresses alone
        assert r.status_code == 200 and r.json()["site_url"] == ""
    run(loop, go())


def test_brands_on_the_website(app, loop, world):
    async def go():
        a, mgr = world["admin"], world["mgr"]
        server.put_object(f"{server.APP_NAME}/images/wt-logo.png", b"\x89PNG fake logo", "image/png")
        server.put_object(f"{server.APP_NAME}/images/wt-evil.png", b"<svg onload=alert(1)>", "image/svg+xml")
        made = {}
        for name, kind, extra in (("WT Own Coat", "own", {}), ("WT Aasha Power", "dealership", {"logo_path": f"{server.APP_NAME}/images/wt-logo.png",
                                                                                               "categories": ["Inverters"], "website": "www.ashapower.in"}),
                                  ("WT Hidden Dist", "distribution", {"on_website": False, "logo_path": f"{server.APP_NAME}/images/wt-logo.png"}),
                                  ("WT Own Shown", "own", {"on_website": True, "logo_path": f"{server.APP_NAME}/images/wt-evil.png"}),
                                  ("WT Gone Dealer", "dealership", {"active": False}), ("WT bharat Cables", "distribution", {"website": "javascript:alert(1)"})):
            r = await a.post("/api/brands", json={"name": name, "kind": kind, **extra})
            assert r.status_code == 200, r.text
            made[name] = r.json()
        assert made["WT Own Coat"]["on_website"] is None and made["WT Own Coat"]["shown_on_website"] is False
        assert made["WT Aasha Power"]["shown_on_website"] is True and made["WT Hidden Dist"]["on_website"] is False
        rows = {b["name"]: b for b in (await a.get("/api/brands", params={"include_inactive": True})).json()}
        assert rows["WT Own Shown"]["on_website"] is True and rows["WT Gone Dealer"]["shown_on_website"] is False

        pub = client(app, "10.11.2.2")
        brands = [b for b in (await pub.get("/api/public/site")).json()["brands"] if b["name"].startswith("WT ")]
        assert [b["name"] for b in brands] == ["WT Aasha Power", "WT bharat Cables", "WT Own Shown"]       # by name, case ignored
        aasha = brands[0]
        assert aasha == {"id": made["WT Aasha Power"]["id"], "name": "WT Aasha Power", "kind": "dealership", "categories": ["Inverters"],
                         "logo": f"/api/public/brands/{made['WT Aasha Power']['id']}/logo", "website": "https://www.ashapower.in"}
        assert brands[1]["logo"] is None and brands[1]["website"] == ""
        r = await pub.get(aasha["logo"])
        assert r.status_code == 200 and r.content == b"\x89PNG fake logo" and r.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in r.headers["content-security-policy"] and "604800" in r.headers["cache-control"]
        assert (await pub.get(f"/api/public/brands/{made['WT Hidden Dist']['id']}/logo")).status_code == 404     # not shown → no logo
        assert (await pub.get(f"/api/public/brands/{made['WT Own Shown']['id']}/logo")).status_code == 404       # SVG never served
        assert (await pub.get(f"/api/public/brands/{made['WT bharat Cables']['id']}/logo")).status_code == 404   # no logo
        assert (await pub.get("/api/public/brands/not-an-id/logo")).status_code == 404

        # editing a brand from a screen that doesn't send the switch keeps it; sending null goes back to "follow the kind"
        hid = made["WT Hidden Dist"]["id"]
        r = await mgr.put(f"/api/brands/{hid}", json={"name": "WT Hidden Dist", "kind": "distribution", "tagline": "Cables"})
        assert r.status_code == 200 and r.json()["on_website"] is False and r.json()["shown_on_website"] is False
        r = await mgr.put(f"/api/brands/{hid}", json={"name": "WT Hidden Dist", "kind": "distribution", "on_website": None})
        assert r.json()["on_website"] is None and r.json()["shown_on_website"] is True
        assert "WT Hidden Dist" in [b["name"] for b in (await pub.get("/api/public/site")).json()["brands"]]
    run(loop, go())


def _mp4(n: int) -> bytes:
    return b"\x00\x00\x00\x18ftypmp42" + bytes((i * 7) % 251 for i in range(n - 12))


def test_testimonials_youtube_and_uploaded_video(app, loop, world, monkeypatch):
    async def go():
        st, mgr = world["staff"], world["mgr"]
        db = server.db
        url = "/api/website/testimonials/video"
        # who may upload, and what
        assert (await st.post(url, files={"file": ("clip.mp4", _mp4(2000), "video/mp4")})).status_code == 403
        for fname, ctype, data in (("notes.txt", "text/plain", b"hello"), ("clip.mp4", "application/octet-stream", _mp4(2000)),
                                   ("clip.avi", "video/mp4", _mp4(2000)), ("clip.mp4", "video/x-msvideo", _mp4(2000))):
            r = await mgr.post(url, files={"file": (fname, data, ctype)})
            assert r.status_code == 400 and "MP4, WebM or MOV" in r.json()["detail"], (fname, ctype)
        r = await mgr.post(url, files={"file": ("clip.mp4", b"<html><script>alert(1)</script></html>" * 10, "video/mp4")})
        assert r.status_code == 400 and "doesn't play as a video" in r.json()["detail"]
        assert (await mgr.post(url, files={"other": ("clip.mp4", _mp4(2000), "video/mp4")})).status_code == 400
        assert (await mgr.post(url, json={"file": "x"})).status_code == 400

        # the size limit is counted as the bytes arrive — even with no Content-Length at all
        monkeypatch.setattr(website, "VIDEO_MAX_BYTES", 50_000)
        boundary = "wt-boundary-123"
        head = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.mp4"\r\n'
                f"Content-Type: video/mp4\r\n\r\n").encode()

        async def body():
            yield head
            yield _mp4(16_000)
            for _ in range(10):
                yield b"\x01" * 16_000
            yield f"\r\n--{boundary}--\r\n".encode()
        r = await mgr.post(url, content=body(), headers={"content-type": f"multipart/form-data; boundary={boundary}"})
        assert r.status_code == 413 and "100 MB" in r.json()["detail"]
        r = await mgr.post(url, files={"file": ("clip.mp4", _mp4(60_000), "video/mp4")})
        assert r.status_code == 413

        async def cut_short():                                                       # the closing line never arrives
            yield head
            yield _mp4(5_000)
        r = await mgr.post(url, content=cut_short(), headers={"content-type": f"multipart/form-data; boundary={boundary}"})
        assert r.status_code == 400 and "didn't come through" in r.json()["detail"]
        monkeypatch.setattr(website, "VIDEO_MAX_BYTES", 100 * 1024 * 1024)
        folder = server.STORAGE_ROOT / server.APP_NAME / "videos"
        assert not list(folder.glob("*.part"))                                        # nothing half-written is left behind

        clip = _mp4(300_000)
        r = await mgr.post(url, files={"file": ("Ravi testimonial.MP4", clip, "video/mp4")})
        assert r.status_code == 200, r.text
        up = r.json()
        assert re.fullmatch(rf"{server.APP_NAME}/videos/[0-9a-f]{{32}}\.mp4", up["video_path"]) and up["size"] == len(clip)
        assert up["content_type"] == "video/mp4" and (server.STORAGE_ROOT / up["video_path"]).read_bytes() == clip
        r = await mgr.post(url, files={"file": ("x.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 500, "video/webm")})
        assert r.status_code == 200 and r.json()["video_path"].endswith(".webm") and r.json()["content_type"] == "video/webm"
        webm = r.json()["video_path"]

        # saving: one video each, a real YouTube link, a short quote
        t = "/api/website/testimonials"
        assert (await st.post(t, json={"name": "Ravi Kumar", "youtube_url": "https://youtu.be/dQw4w9WgXcQ"})).status_code == 403
        bad = [({"name": "R", "youtube_url": "https://youtu.be/dQw4w9WgXcQ"}, "name"),
               ({"name": "Ravi Kumar"}, "YouTube link or upload"),
               ({"name": "Ravi Kumar", "youtube_url": "https://youtu.be/dQw4w9WgXcQ", "video_path": up["video_path"]}, "not both"),
               ({"name": "Ravi Kumar", "youtube_url": "https://vimeo.com/123456"}, "YouTube"),
               ({"name": "Ravi Kumar", "video_path": "../../etc/passwd"}, "Upload it again"),
               ({"name": "Ravi Kumar", "video_path": f"{server.APP_NAME}/videos/{'0' * 32}.mp4"}, "Upload it again"),
               ({"name": "Ravi Kumar", "youtube_url": "https://youtu.be/dQw4w9WgXcQ", "quote": "x" * 401}, "400 characters"),
               ({"name": "Ravi Kumar", "youtube_url": "https://youtu.be/dQw4w9WgXcQ", "poster_path": "sensoper-solar/documents/a.pdf"}, "picture"),
               ({"name": "Ravi Kumar", "youtube_url": "https://youtu.be/dQw4w9WgXcQ", "status": "public"}, "draft"),
               ({"name": "Ravi Kumar", "youtube_url": "https://youtu.be/dQw4w9WgXcQ", "order": "inf"}, "whole number")]
        for body_, word in bad:
            r = await mgr.post(t, json=body_)
            assert r.status_code == 400 and word in r.json()["detail"], (body_, r.text)

        server.put_object(f"{server.APP_NAME}/images/wt-poster.jpg", b"\xff\xd8\xff fake jpeg", "image/jpeg")
        r = await mgr.post(t, json={"name": "Ravi Kumar", "place": "Perundurai", "system": "5 kW on-grid", "quote": "Bill went from ₹4,200 to ₹300.",
                                    "youtube_url": "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share", "order": 2})
        assert r.status_code == 200, r.text
        yt = r.json()
        assert yt["youtube_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ" and yt["status"] == "live" and yt["video_path"] == ""
        r = await mgr.post(t, json={"name": "Selvi K", "video_path": up["video_path"], "poster_path": f"{server.APP_NAME}/images/wt-poster.jpg", "order": 1})
        assert r.status_code == 200 and r.json()["video_size"] == len(clip)
        filed = r.json()
        r = await mgr.post(t, json={"name": "Draft Person", "youtube_url": "https://youtu.be/dQw4w9WgXcQ", "status": "draft", "order": 0})
        draft = r.json()
        await db.website_testimonials.update_one({"_id": ObjectId(draft["id"])}, {"$set": {"created_at": "2026-01-01T00:00:00+00:00"}})
        r = await mgr.post(t, json={"name": "Newer Same Order", "youtube_url": "youtu.be/dQw4w9WgXcQ", "order": 2})
        newer = r.json()
        await db.website_testimonials.update_one({"_id": ObjectId(yt["id"])}, {"$set": {"created_at": "2026-01-01T00:00:00+00:00"}})
        staff_rows = (await st.get(t)).json()["items"]                      # staff can see the list, drafts included
        assert {x["name"] for x in staff_rows} >= {"Ravi Kumar", "Selvi K", "Draft Person"}
        assert {"id", "name", "place", "system", "quote", "youtube_url", "video_path", "video_size", "poster_path", "status", "order", "created_at"} <= set(staff_rows[0])

        pub = client(app, "10.11.3.3")
        site = (await pub.get("/api/public/site")).json()
        shown = site["testimonials"]
        assert [x["name"] for x in shown] == ["Selvi K", "Newer Same Order", "Ravi Kumar"]   # order, then newest first; no drafts
        assert shown[2] == {"id": yt["id"], "name": "Ravi Kumar", "place": "Perundurai", "system": "5 kW on-grid",
                            "quote": "Bill went from ₹4,200 to ₹300.", "video": {"type": "youtube", "id": "dQw4w9WgXcQ"}, "poster": None}
        vurl = f"/api/public/testimonials/{filed['id']}/video"
        assert shown[0]["video"] == {"type": "file", "url": vurl, "mime": "video/mp4"}
        assert shown[0]["poster"] == f"/api/public/testimonials/{filed['id']}/poster"
        assert "video_path" not in str(site) and "videos/" not in str(site)

        # the poster and the video, as a phone's player asks for them
        r = await pub.get(shown[0]["poster"])
        assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.headers["x-content-type-options"] == "nosniff"
        assert (await pub.get(f"/api/public/testimonials/{yt['id']}/poster")).status_code == 404
        r = await pub.get(vurl)
        assert r.status_code == 200 and r.content == clip and r.headers["accept-ranges"] == "bytes"
        assert r.headers["content-length"] == str(len(clip)) and r.headers["content-type"] == "video/mp4" and "86400" in r.headers["cache-control"]
        r = await pub.get(vurl, headers={"range": "bytes=0-1"})
        assert r.status_code == 206 and r.content == clip[:2] and r.headers["content-range"] == f"bytes 0-1/{len(clip)}" and r.headers["content-length"] == "2"
        r = await pub.get(vurl, headers={"range": "bytes=299990-"})
        assert r.status_code == 206 and r.content == clip[299990:] and r.headers["content-range"] == f"bytes 299990-{len(clip) - 1}/{len(clip)}"
        r = await pub.get(vurl, headers={"range": "bytes=-100"})
        assert r.status_code == 206 and r.content == clip[-100:]
        r = await pub.get(vurl, headers={"range": "bytes=1000-262143"})
        assert r.status_code == 206 and r.content == clip[1000:262144]                 # spans more than one read
        for rng in (f"bytes={len(clip)}-", "bytes=9-3", "bytes=x-y"):
            r = await pub.get(vurl, headers={"range": rng})
            assert r.status_code == 416 and r.headers["content-range"] == f"bytes */{len(clip)}", rng
        r = await pub.get(vurl, headers={"range": "bytes=0-1", "if-range": '"stale"'})
        assert r.status_code == 200 and len(r.content) == len(clip)
        r = await pub.head(vurl)
        assert r.status_code == 200 and r.headers["content-length"] == str(len(clip)) and r.content == b""
        assert (await pub.get(f"/api/public/testimonials/{draft['id']}/video")).status_code == 404       # drafts aren't public
        assert (await pub.get(f"/api/public/testimonials/{yt['id']}/video")).status_code == 404          # YouTube ones have no file
        assert (await pub.get("/api/public/testimonials/not-an-id/video")).status_code == 404

        # a video stored outside the videos folder is never served, even if the record is changed behind our back
        await db.website_testimonials.update_one({"_id": ObjectId(filed["id"])}, {"$set": {"video_path": f"{server.APP_NAME}/images/wt-poster.jpg"}})
        assert (await pub.get(vurl)).status_code == 404
        await db.website_testimonials.update_one({"_id": ObjectId(filed["id"])}, {"$set": {"video_path": up["video_path"]}})

        # swapping the video removes the old file; deleting the testimonial removes its file
        old = server.STORAGE_ROOT / up["video_path"]
        r = await mgr.put(f"{t}/{filed['id']}", json={"name": "Selvi K", "video_path": webm, "order": 1})
        assert r.status_code == 200 and r.json()["video_type"] == "video/webm" and r.json()["poster_path"] == ""
        assert not old.exists()
        assert (await pub.get(vurl)).headers["content-type"] == "video/webm"
        r = await mgr.put(f"{t}/{draft['id']}", json={"name": "Draft Person", "youtube_url": "https://youtu.be/dQw4w9WgXcQ", "status": "live"})
        assert r.status_code == 200 and r.json()["status"] == "live"
        assert (await st.delete(f"{t}/{filed['id']}")).status_code == 403
        assert (await mgr.delete(f"{t}/{filed['id']}")).status_code == 200
        assert not (server.STORAGE_ROOT / webm).exists()
        assert (await pub.get(vurl)).status_code == 404
        assert (await mgr.put(f"{t}/{filed['id']}", json={"name": "Selvi K", "youtube_url": "https://youtu.be/dQw4w9WgXcQ"})).status_code == 404
        for x in (yt, draft, newer):
            await mgr.delete(f"{t}/{x['id']}")
        assert (await pub.get("/api/public/site")).json()["testimonials"] == []
    run(loop, go())


async def _store(db, name, **extra):
    res = await db.locations.insert_one({"name": name, "type": "branch", "address": "Main road", "district": "Erode", "state": "Tamil Nadu",
                                         "active": True, "tag": TAG, **extra})
    return str(res.inserted_id)


def test_pickup_stores_are_set_up_from_locations(app, loop, world):
    async def go():
        st, mgr = world["staff"], world["mgr"]
        db = server.db
        erode = await _store(db, "WT_Erode_Branch")
        gobi = await _store(db, "WT Gobi")
        closed = await _store(db, "WT Closed", active=False, pickup={"enabled": True, "address": "Old shop street"})
        rows = {x["location_id"]: x for x in (await st.get("/api/website/stores")).json()["items"]}
        assert erode in rows and gobi in rows and closed not in rows
        assert rows[erode]["pickup"] == {"enabled": False, "public_name": "", "address": "", "phone": "", "hours": "", "lat": None, "lng": None}
        assert rows[erode]["name"] == "WT_Erode_Branch" and rows[erode]["type"] == "branch" and rows[erode]["district"] == "Erode"

        u = f"/api/website/stores/{erode}"
        good = {"enabled": True, "address": "518/3, Kunnathur – Perundurai Rd, Perundurai 638052", "phone": "+91 90435 47047",
                "hours": "Mon–Sat, 9:30 am – 6:30 pm", "coordinates": "11.2712, 77.5845"}
        assert (await st.put(u, json=good)).status_code == 403
        assert (await mgr.put(f"/api/website/stores/{closed}", json=good)).status_code == 404
        assert (await mgr.put("/api/website/stores/not-an-id", json=good)).status_code == 404
        for patch, word in (({"address": ""}, "address"), ({"phone": "12345"}, "STD code"), ({"coordinates": "near the temple"}, "two numbers"),
                            ({"coordinates": "77.5845, 11.2712"}, "swapped"), ({"coordinates": "51.5, -0.12"}, "India")):
            r = await mgr.put(u, json={**good, **patch})
            assert r.status_code == 400 and word in r.json()["detail"], (patch, r.text)
        assert (await mgr.put(u, json={"enabled": False})).status_code == 200            # switched off, nothing else is needed
        r = await mgr.put(u, json=good)
        assert r.status_code == 200, r.text
        assert r.json()["pickup"] == {"enabled": True, "public_name": "", "address": good["address"], "phone": "9043547047",
                                      "hours": "Mon–Sat, 9:30 am – 6:30 pm", "lat": 11.2712, "lng": 77.5845}
        r = await mgr.put(f"/api/website/stores/{gobi}", json={"enabled": True, "public_name": "Sensoper Gobi", "address": "Gobi main road, 638452",
                                                              "phone": "0424 2233445", "coordinates": ""})
        assert r.status_code == 200 and r.json()["pickup"]["phone"] == "04242233445" and r.json()["pickup"]["lat"] is None
        loc = await db.locations.find_one({"_id": ObjectId(erode)})
        assert loc["name"] == "WT_Erode_Branch" and loc["address"] == "Main road"       # the location itself isn't changed

        pub = client(app, "10.11.4.4")
        stores = [x for x in (await pub.get("/api/public/site")).json()["stores"] if x["id"] in (erode, gobi, closed)]
        assert [x["name"] for x in stores] == ["Sensoper Gobi", "WT Erode Branch"]      # by name; closed locations never show
        assert stores[1] == {"id": erode, "name": "WT Erode Branch", "address": good["address"], "district": "Erode", "phone": "9043547047",
                             "hours": "Mon–Sat, 9:30 am – 6:30 pm", "lat": 11.2712, "lng": 77.5845,
                             "directions": "https://www.google.com/maps/dir/?api=1&destination=11.2712,77.5845"}
        assert stores[0]["lat"] is None and stores[0]["directions"] == ""
        # clearing the coordinates, then switching the store off
        r = await mgr.put(u, json={**good, "coordinates": ""})
        assert r.json()["pickup"]["lat"] is None and r.json()["pickup"]["lng"] is None
        for sid in (erode, gobi):
            await mgr.put(f"/api/website/stores/{sid}", json={"enabled": False})
        assert [x for x in (await pub.get("/api/public/site")).json()["stores"] if x["id"] in (erode, gobi)] == []
    run(loop, go())


def test_shop_order_pickup_store(app, loop, world):
    async def go():
        mgr = world["mgr"]
        db = server.db
        item = await db.inventory_items.insert_one({"name": "WT Luminous 1100VA Inverter", "sku_code": "WEB-INV", "category": "inverters",
                                                    "unit_price": 5000, "quantity": 5, "notes": TAG})
        r = await mgr.post("/api/website/shop/products", json={"inventory_item_id": str(item.inserted_id), "price": 6500})
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        order = {"name": "Kumar", "phone": "9443300011", "delivery": "pickup", "items": [{"id": pid, "qty": 1}]}

        # no pick-up store set up: pick-up from the office, as before (a stray store_id is ignored)
        pub = client(app, "10.11.5.5")
        r = await pub.post("/api/public/shop/order", json={**order, "store_id": "6a90aaaaaaaaaaaaaaaaaaaa"})
        assert r.status_code == 200, r.text
        lead = await db.website_leads.find_one({"number": r.json()["number"]})
        assert lead["delivery"] == "pickup" and "pickup_store" not in lead

        erode = await _store(db, "WT_Erode_Shop")
        await mgr.put(f"/api/website/stores/{erode}", json={"enabled": True, "public_name": "Sensoper Erode", "address": "Perundurai Rd, 638052",
                                                           "phone": "9043547047", "hours": "9:30 am – 6:30 pm"})
        off = await _store(db, "WT_Off_Shop")
        pub = client(app, "10.11.6.6")
        r = await pub.post("/api/public/shop/order", json=order)
        assert r.status_code == 400 and r.json()["detail"] == "Choose the store you'll pick it up from."
        for sid in ("6a90aaaaaaaaaaaaaaaaaaaa", off, "../x", ""):
            r = await pub.post("/api/public/shop/order", json={**order, "store_id": sid})
            assert r.status_code == 400 and r.json()["detail"] == "Choose the store you'll pick it up from.", sid
        r = await pub.post("/api/public/shop/order", json={**order, "store_id": erode})
        assert r.status_code == 200, r.text
        lead = await db.website_leads.find_one({"number": r.json()["number"]})
        assert lead["pickup_store"] == {"id": erode, "name": "Sensoper Erode", "address": "Perundurai Rd, 638052", "phone": "9043547047"}
        assert "Sensoper Erode" in lead["activity"][0]["text"]
        got = (await mgr.get(f"/api/website/leads/{lead['_id']}")).json()
        assert got["pickup_store"]["name"] == "Sensoper Erode"
        # delivery needs no store, and a store sent with a delivery isn't saved
        r = await pub.post("/api/public/shop/order", json={**order, "delivery": "delivery", "address": "12, Gandhi St, Bhavani", "store_id": erode})
        assert r.status_code == 200
        lead = await db.website_leads.find_one({"number": r.json()["number"]})
        assert lead["delivery"] == "delivery" and "pickup_store" not in lead

        await mgr.put(f"/api/website/stores/{erode}", json={"enabled": False})
        r = await client(app, "10.11.7.7").post("/api/public/shop/order", json=order)
        assert r.status_code == 200                                                    # no store left → from the office again
        await mgr.delete(f"/api/website/shop/products/{pid}")
    run(loop, go())
