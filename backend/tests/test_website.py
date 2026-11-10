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

