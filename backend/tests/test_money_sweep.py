"""Nov 2026 logic sweep: money, stock and branch rules found wrong while testing the backend end to end.
In-process, no MongoDB server:
    cd backend && pytest tests/test_money_sweep.py
"""
import asyncio
import os
import pathlib
import secrets
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "money_sweep_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "t-" + secrets.token_hex(12))   # random per run — the in-memory app seeds this admin
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-money-sweep-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
from bson import ObjectId  # noqa: E402
import server  # noqa: E402
import sales  # noqa: E402
import invoicing  # noqa: E402
import pricing_slabs  # noqa: E402

PW = "pw-" + secrets.token_hex(8)   # for the users this test creates (random per run)
TAG = "money-sweep-test"


# ───────────── pure rules ─────────────
def test_zero_gst_is_a_rate_not_missing():
    ln = sales._compute_line({"quantity": 2, "unit_price": 500, "gst_percentage": 0})
    assert ln["gst_amount"] == 0 and ln["line_total"] == 1000
    assert sales._compute_line({"quantity": 1, "unit_price": 100, "gst_percentage": None})["gst_amount"] == 18


def test_bill_discount_lowers_the_taxable_value_and_the_gst():
    lines = sales._price_lines([{"name": "Panel", "quantity": 1, "unit_price": 10000, "gst_percentage": 12},
                                {"name": "Cable", "quantity": 1, "unit_price": 5000, "gst_percentage": 18}], 1500)
    t = sales._sale_totals(lines, 0, "Tamil Nadu", "Tamil Nadu")
    assert t["taxable_value"] == 13500 and t["header_discount"] == 1500
    # 9000 @12% + 4500 @18% — not 10000 @12% + 5000 @18%
    assert t["gst_total"] == 1080 + 810
    assert t["grand_total"] == 13500 + 1890
    assert round(t["cgst"] + t["sgst"], 2) == t["gst_total"]
    with pytest.raises(Exception):
        sales._price_lines([{"name": "x", "quantity": 1, "unit_price": 100}], 200)   # discount above the bill


def test_cgst_plus_sgst_is_exactly_the_gst():
    cgst, sgst, igst = sales._split_gst([{"gst_amount": 90.63}, {"gst_amount": 90.62}], "Tamil Nadu", "tamil nadu")
    assert round(cgst + sgst, 2) == 181.25 and igst == 0
    assert round(round(181.25 / 2, 2) + invoicing._sgst_half(181.25), 2) == 181.25


def test_bad_sale_lines_are_refused():
    for bad in ({"quantity": -5, "unit_price": 100}, {"quantity": 0, "unit_price": 100}, {"quantity": 1, "unit_price": -1},
                {"quantity": 1, "unit_price": 100, "discount_pct": 120}, {"quantity": 1, "unit_price": 100, "gst_percentage": 150},
                {"quantity": 1e12, "unit_price": 100}, {"quantity": float("inf"), "unit_price": 1}):
        with pytest.raises(Exception):
            sales._check_lines([{"name": "Item", **bad}])
    sales._check_lines([{"name": "Item", "quantity": 1, "unit_price": 0, "gst_percentage": 0}])


def test_amount_in_words_edges():
    assert invoicing.amount_in_words(99.999) == "Rupees One Hundred Only"
    assert invoicing.amount_in_words(1234.5) == "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only"
    assert invoicing.amount_in_words(-10).startswith("Minus Rupees Ten")


def test_newer_rate_card_wins_between_ranges_that_start_together():
    slabs = [{"from_value": 1, "to_value": 3, "rate_per_unit": 50000, "effective_from": "2026-01-01"},
             {"from_value": 1, "to_value": 4, "rate_per_unit": 45000, "effective_from": "2026-10-01"}]
    assert pricing_slabs.pick_slab(slabs, 2, "2026-11-01")["rate_per_unit"] == 45000
    assert pricing_slabs.pick_slab(list(reversed(slabs)), 2, "2026-11-01")["rate_per_unit"] == 45000
    assert pricing_slabs.pick_slab(slabs, 2, "2026-06-01")["rate_per_unit"] == 50000


def test_india_dates(monkeypatch):
    # 31 Mar 2027 19:00 UTC is 1 Apr 2027 00:30 in India — a new financial year and a new day
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2027, 3, 31, 19, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(sales, "datetime", Clock)
    monkeypatch.setattr(pricing_slabs, "datetime", Clock)
    assert sales._ist_now().date().isoformat() == "2027-04-01"
    assert pricing_slabs._today() == "2027-04-01"


def test_storage_never_serves_keys_or_archives():
    ok = server._publicly_servable
    assert ok("sensoper-solar/site-photos/abc.jpg")
    for bad in (".keys/vault_master.key", "a/.keys/x", "sensoper-solar/x.jpg.meta", "sensoper-solar/log-archives/2026-Q3/a.xlsx", ""):
        assert not ok(bad), bad


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


async def item(name, qty, price=1000.0, gst=18):
    db = server.db
    r = await db.inventory_items.insert_one({"name": f"{name} {TAG}", "sku_code": f"MS-{secrets.token_hex(4)}", "category": "accessories",
                                             "quantity": qty, "unit_price": price, "gst_percentage": gst, "notes": TAG})
    return str(r.inserted_id)


async def stock(item_id):
    return (await server.db.inventory_items.find_one({"_id": ObjectId(item_id)}))["quantity"]


def sale_body(lines, **extra):
    return {"sale_type": "counter", "customer": {"name": f"Cust {TAG}", "phone": "9" + secrets.token_hex(5)[:9].translate(str.maketrans("abcdef", "123456")), "state": "Tamil Nadu"},
            "lines": lines, **extra}


def line(item_id, qty, price=1500.0, **extra):
    return {"inventory_item_id": item_id, "name": f"Item {TAG}", "quantity": qty, "unit_price": price, "gst_percentage": 18, **extra}


@pytest.fixture(scope="module")
def world(app, loop):
    async def go():
        db = server.db
        a = await login(app, ADMIN["email"], ADMIN["password"])
        north = str((await db.locations.insert_one({"name": f"North {TAG}", "code": "NOR", "active": True})).inserted_id)
        south = str((await db.locations.insert_one({"name": f"South {TAG}", "code": "SOU", "active": True})).inserted_id)
        users = {}
        for key, role, loc in (("staff_n", "staff", north), ("mgr_n", "manager", north)):
            email = f"{key}.{TAG}@example.com"
            r = await a.post("/api/users", json={"email": email, "password": PW, "name": key, "role": role})
            assert r.status_code == 200, r.text
            await db.users.update_one({"email": email}, {"$set": {"location_ids": [loc], "default_location_id": loc}})
            users[key] = await login(app, email, PW)
        vendor = await db.vendors.insert_one({"name": f"Vendor {TAG}", "active": True, "notes": TAG})
        return {"admin": a, "north": north, "south": south, "vendor_id": str(vendor.inserted_id), **users}

    async def tidy():
        db = server.db
        await db.users.delete_many({"email": {"$regex": TAG}})
        await db.locations.delete_many({"name": {"$regex": TAG}})
        await db.inventory_items.delete_many({"notes": TAG})
        await db.vendors.delete_many({"notes": TAG})
        await db.sales.delete_many({"customer.name": f"Cust {TAG}"})
        await db.customer_credits.delete_many({"customer_name": f"Cust {TAG}"})

    w = run(loop, go())
    yield w
    run(loop, tidy())


def test_unauthenticated_file_route_hides_the_vault_key(app, loop, world):
    root = pathlib.Path(os.environ["STORAGE_ROOT"])
    (root / ".keys").mkdir(parents=True, exist_ok=True)
    (root / ".keys" / "vault_master.key").write_text("not-for-anyone")
    server.put_object("sensoper-solar/site-images/ok.jpg", b"img", "image/jpeg")

    async def go():
        anon = client(app)
        assert (await anon.get("/api/files/.keys/vault_master.key")).status_code == 404
        assert (await anon.get("/api/files/sensoper-solar/site-images/ok.jpg.meta")).status_code == 404
        r = await anon.get("/api/files/sensoper-solar/site-images/ok.jpg")
        assert r.status_code == 200 and r.content == b"img"
    run(loop, go())


def test_a_refused_sale_leaves_stock_untouched(app, loop, world):
    async def go():
        a = world["admin"]
        i1, i2 = await item("Panel", 10), await item("Inverter", 1)
        # the second line is short: nothing may be taken from the first item either
        r = await a.post("/api/sales", json=sale_body([line(i1, 4), line(i2, 3)]))
        assert r.status_code == 400 and "Insufficient stock" in r.text
        assert await stock(i1) == 10 and await stock(i2) == 1
        # one item on two lines counts once, in total
        r = await a.post("/api/sales", json=sale_body([line(i1, 6), line(i1, 6)]))
        assert r.status_code == 400 and await stock(i1) == 10
        # a negative quantity would add stock
        r = await a.post("/api/sales", json=sale_body([line(i1, -5)]))
        assert r.status_code == 400 and await stock(i1) == 10
        r = await a.post("/api/sales", json=sale_body([line(i1, 3)]))
        assert r.status_code == 200, r.text
        assert await stock(i1) == 7
    run(loop, go())


def test_part_paid_sale_closes_from_the_credits_page(app, loop, world):
    async def go():
        a = world["admin"]
        i1 = await item("Battery", 5)
        r = await a.post("/api/sales", json=sale_body([line(i1, 1, 10000)], payments=[{"mode": "cash", "amount": 4000}]))
        assert r.status_code == 200, r.text
        sale_id, total = r.json()["id"], r.json()["grand_total"]
        assert total == 11800
        credit = await server.db.customer_credits.find_one({"reference_id": sale_id})
        assert credit["balance"] == 7800
        cid = str(credit["_id"])
        assert (await a.post(f"/api/credits/{cid}/pay", json={"credit_id": cid, "amount": -50})).status_code == 400
        assert (await a.post(f"/api/credits/{cid}/pay", json={"credit_id": cid, "amount": 9000})).status_code == 400   # more than due
        r = await a.post(f"/api/credits/{cid}/pay", json={"credit_id": cid, "amount": 7800, "payment_method": "upi"})
        assert r.status_code == 200 and r.json()["new_balance"] == 0, r.text
        credit = await server.db.customer_credits.find_one({"_id": credit["_id"]})
        sale = await server.db.sales.find_one({"_id": ObjectId(sale_id)})
        assert credit["status"] == "closed" and sale["payment_status"] == "paid" and sale["balance_due"] == 0
        assert (await a.post(f"/api/sales/{sale_id}/payment", json={"mode": "cash", "amount": 100})).status_code == 400   # nothing due
        # a credit that belongs to a sale isn't deleted on its own while open
        r2 = await a.post("/api/sales", json=sale_body([line(i1, 1, 1000)]))
        c2 = await server.db.customer_credits.find_one({"reference_id": r2.json()["id"]})
        assert (await a.delete(f"/api/credits/{c2['_id']}")).status_code == 400
    run(loop, go())


def test_a_cancelled_sale_cant_be_returned_again(app, loop, world):
    async def go():
        a = world["admin"]
        i1 = await item("Meter", 5)
        sid = (await a.post("/api/sales", json=sale_body([line(i1, 2)]))).json()["id"]
        assert await stock(i1) == 3
        assert (await a.delete(f"/api/sales/{sid}")).json()["status"] == "cancelled"
        assert await stock(i1) == 5
        assert (await a.post(f"/api/sales/{sid}/return", json={"reason": "again"})).status_code == 400
        assert (await a.put(f"/api/sales/{sid}", json={"status": "confirmed"})).status_code == 400
        assert await stock(i1) == 5
    run(loop, go())


def test_invoice_numbers_stay_unique_after_a_hard_delete(app, loop, world):
    async def go():
        a = world["admin"]
        i1 = await item("Clamp", 50)
        ids = [(await a.post("/api/sales", json=sale_body([line(i1, 1)]))).json() for _ in range(3)]
        r = await a.request("DELETE", f"/api/hard-delete/sale/{ids[1]['id']}", json={"reason": "entered twice"})
        assert r.status_code == 200, r.text
        new = (await a.post("/api/sales", json=sale_body([line(i1, 1)]))).json()
        assert new["invoice_number"] not in {x["invoice_number"] for x in ids}
    run(loop, go())


def test_a_branch_only_sees_and_sells_for_its_own_branch(app, loop, world):
    async def go():
        a, staff = world["admin"], world["staff_n"]
        i1 = await item("Wire", 20)
        south_sale = (await a.post("/api/sales", json=sale_body([line(i1, 1)], location_id=world["south"]))).json()["id"]
        assert (await staff.get(f"/api/sales/{south_sale}")).status_code == 404
        assert (await world["mgr_n"].post(f"/api/sales/{south_sale}/return", json={"reason": "x"})).status_code == 404
        r = await staff.post("/api/sales", json=sale_body([line(i1, 1)], location_id=world["south"]))
        assert r.status_code == 403
        own = await staff.post("/api/sales", json=sale_body([line(i1, 1)]))
        assert own.status_code == 200, own.text
        assert (await staff.get(f"/api/sales/{own.json()['id']}")).status_code == 200
    run(loop, go())


def _po(world, item_ids, qty=5):
    return {"vendor_id": world["vendor_id"], "items": [{"name": f"Line {i}", "qty": qty, "unit_price": 100, "inventory_item_id": iid} for i, iid in enumerate(item_ids)],
            "skip_reason": "test"}


def test_purchase_orders_are_received_once_and_only_after_approval(app, loop, world):
    async def go():
        a = world["admin"]
        i1 = await item("Rail", 0)
        po = (await a.post("/api/purchase-orders", json=_po(world, [i1]))).json()["id"]
        where = {"storage_location": {"zone": "A", "bin": "1"}}
        assert (await a.put(f"/api/purchase-orders/{po}/inbound", json=where)).status_code == 400   # not approved
        assert (await a.put(f"/api/purchase-orders/{po}/arrival", json={})).status_code == 400
        assert (await a.put(f"/api/purchase-orders/{po}/approve")).status_code == 200
        assert (await a.put(f"/api/purchase-orders/{po}/arrival", json={})).status_code == 200
        assert (await a.put(f"/api/purchase-orders/{po}/qc", json={})).status_code == 200
        assert (await a.put(f"/api/purchase-orders/{po}/inbound", json=where)).status_code == 200
        assert await stock(i1) == 5
        # a received PO can't be put back to "arrived" and received a second time
        assert (await a.put(f"/api/purchase-orders/{po}/arrival", json={})).status_code == 400
        assert (await a.put(f"/api/purchase-orders/{po}/inbound", json=where)).status_code == 400
        assert await stock(i1) == 5
        # an edit that leaves a line out keeps that line as received
        i2 = await item("Bolt", 0)
        po2 = (await a.post("/api/purchase-orders", json=_po(world, [i1, i2], qty=2))).json()["id"]
        for step in ("approve", "arrival", "qc"):
            await a.put(f"/api/purchase-orders/{po2}/{step}", json={})
        assert (await a.put(f"/api/purchase-orders/{po2}/inbound", json=where)).status_code == 200
        r = await a.put(f"/api/purchase-orders/{po2}/inbound/edit", json={"lines": [{"inventory_item_id": i1, "qty_received": 1}]})
        assert r.status_code == 200, r.text
        doc = await server.db.purchase_orders.find_one({"_id": ObjectId(po2)})
        assert {x["inventory_item_id"]: x["qty_received"] for x in doc["received_items"]} == {i1: 1, i2: 2}
        assert (await a.put(f"/api/purchase-orders/{po2}/inbound/edit", json={"lines": [{"inventory_item_id": i1, "qty_received": -3}]})).status_code == 400
        # negative / empty PO lines are refused
        bad = _po(world, [i1]); bad["items"][0]["qty"] = -4
        assert (await a.post("/api/purchase-orders", json=bad)).status_code == 400
        assert (await a.post("/api/purchase-orders", json={**_po(world, [i1]), "items": []})).status_code == 400
    run(loop, go())


def test_an_unmatched_po_line_adds_no_stock(app, loop, world):
    async def go():
        a = world["admin"]
        i1 = await item("Lug", 0)
        body = _po(world, [i1])
        body["items"].append({"name": "Not in stock list", "qty": 3, "unit_price": 10})
        po = (await a.post("/api/purchase-orders", json=body)).json()["id"]
        for step in ("approve", "arrival", "qc"):
            await a.put(f"/api/purchase-orders/{po}/{step}", json={})
        r = await a.put(f"/api/purchase-orders/{po}/inbound", json={"storage_location": {"zone": "B"}})
        assert r.status_code == 400 and "Could not match" in r.text
        assert await stock(i1) == 0
    run(loop, go())


def test_saving_a_reconciliation_twice_returns_stock_once(app, loop, world):
    async def go():
        a, staff = world["admin"], world["staff_n"]
        i1 = await item("Spare panel", 10)
        pid = str((await server.db.projects.insert_one({"customer": {"name": f"Cust {TAG}"}, "status": "completed", "created_by": "x"})).inserted_id)
        body = {"lines": [{"inventory_item_id": i1, "name": "Spare panel", "qty_issued": 10, "qty_consumed": 6, "qty_returned": 3, "qty_damaged": 1}]}
        assert (await a.put(f"/api/material-reconciliation/{pid}", json=body)).status_code == 200
        assert (await a.put(f"/api/material-reconciliation/{pid}", json=body)).status_code == 200
        assert await stock(i1) == 13
        body["lines"][0]["qty_returned"] = 2
        assert (await a.put(f"/api/material-reconciliation/{pid}", json=body)).status_code == 200
        assert await stock(i1) == 12
        assert await server.db.brand_returns.count_documents({"project_id": pid}) == 1   # the Returns page lists these
        assert (await staff.put(f"/api/material-reconciliation/{pid}", json={**body, "status": "verified"})).status_code == 403
        bad = {"lines": [{**body["lines"][0], "qty_returned": -5}]}
        assert (await a.put(f"/api/material-reconciliation/{pid}", json=bad)).status_code == 400
        await server.db.projects.delete_one({"_id": ObjectId(pid)})
    run(loop, go())


def test_ecommerce_orders_keep_stock_right(app, loop, world):
    async def go():
        a = world["admin"]
        i1, i2 = await item("Controller", 5), await item("Fuse", 1)
        plat = str((await server.db.ecommerce_platforms.insert_one({"name": f"Shop {TAG}", "commission_pct": 10})).inserted_id)
        order = {"platform_id": plat, "platform_order_id": "A-" + secrets.token_hex(3), "order_date": "2026-11-15",
                 "lines": [{"inventory_item_id": i1, "quantity": 2, "sold_price": 900}, {"inventory_item_id": i2, "quantity": 4, "sold_price": 50}]}
        assert (await a.post("/api/ecommerce/orders", json=order)).status_code == 400
        assert await stock(i1) == 5 and await stock(i2) == 1
        order["lines"] = order["lines"][:1]
        oid = (await a.post("/api/ecommerce/orders", json=order)).json()["id"]
        assert await stock(i1) == 3
        assert (await a.put(f"/api/ecommerce/orders/{oid}", json={"order_status": "cancelled"})).status_code == 200
        assert await stock(i1) == 5
        assert (await a.put(f"/api/ecommerce/orders/{oid}", json={"order_status": "placed"})).status_code == 400
        assert await stock(i1) == 5
        neg = {**order, "platform_order_id": "B-1", "lines": [{"inventory_item_id": i1, "quantity": -3, "sold_price": 1}]}
        assert (await a.post("/api/ecommerce/orders", json=neg)).status_code == 400
        await server.db.ecommerce_orders.delete_many({"platform_id": plat})
        await server.db.ecommerce_platforms.delete_one({"_id": ObjectId(plat)})
    run(loop, go())


def test_emi_preview_refuses_impossible_numbers(app, loop, world):
    async def go():
        a = world["admin"]
        r = await a.post("/api/loans/emi-preview", json={"amount": 500000, "interest_rate": 10, "tenure_months": 1e20})
        assert r.status_code == 400
        assert (await a.post("/api/loans/emi-preview", content=b"[]", headers={"content-type": "application/json"})).status_code == 400
        ok = await a.post("/api/loans/emi-preview", json={"amount": 100000, "interest_rate": 12, "tenure_months": 12})
        assert ok.status_code == 200 and ok.json()["emi"] == 8884.88
    run(loop, go())


def test_a_manager_without_delete_rights_can_ask_an_admin(app, loop, world):
    async def go():
        a, mgr = world["admin"], world["mgr_n"]
        i1 = await item("Isolator", 5)
        sid = (await a.post("/api/sales", json=sale_body([line(i1, 1)], location_id=world["north"]))).json()["id"]
        r = await mgr.delete(f"/api/sales/{sid}")
        assert r.status_code == 200 and r.json()["status"] == "pending_approval", r.text
        assert (await server.db.sales.find_one({"_id": ObjectId(sid)}))["status"] == "confirmed"   # not cancelled by the request
        assert await stock(i1) == 4
        await server.db.action_requests.delete_many({"resource_id": sid})
    run(loop, go())


def test_a_freight_line_doesnt_block_the_inbound(app, loop, world):
    async def go():
        a = world["admin"]
        i1 = await item("Combiner box", 0)
        body = _po(world, [i1])
        body["items"].append({"name": "Freight", "qty": 1, "unit_price": 800, "service": True})
        po = (await a.post("/api/purchase-orders", json=body)).json()["id"]
        for step in ("approve", "arrival", "qc"):
            await a.put(f"/api/purchase-orders/{po}/{step}", json={})
        r = await a.put(f"/api/purchase-orders/{po}/inbound", json={"storage_location": {"zone": "C"}})
        assert r.status_code == 200, r.text
        assert await stock(i1) == 5
    run(loop, go())


def test_broken_bodies_and_months_are_400_not_500(app, loop, world):
    async def go():
        a = world["admin"]
        assert (await a.put("/api/hr/settings", content=b"", headers={"content-type": "application/json"})).status_code == 400
        assert (await a.post("/api/approvals", json=[1, 2])).status_code == 400
        assert (await a.get("/api/attendance/register", params={"month": "2026-13"})).status_code == 400
        # NaN / Infinity / 1e400 aren't JSON numbers, but Python reads them as nan / inf (500s and nan in money fields)
        h = {"content-type": "application/json"}
        for body in (b'{"user_id": "x", "month": "2026-11", "kind": "bonus", "amount": NaN}',
                     b'{"customer_name": "A", "total_amount": Infinity}', b'{"customer_name": "A", "total_amount": 1e400}'):
            r = await a.post("/api/payroll/extras" if b"kind" in body else "/api/credits", content=body, headers=h)
            assert r.status_code == 400, (body, r.status_code, r.text[:200])
        ok = await a.post("/api/loans/emi-preview", content=b'{"amount": 1.5e5, "interest_rate": 9.5, "tenure_months": 60, "note": "NaN in text is fine"}', headers=h)
        assert ok.status_code == 200, ok.text
    run(loop, go())


def test_search_boxes_take_any_text(app, loop, world):
    async def go():
        a = world["admin"]
        for path, params in (("/api/sales", {"item": "Sun (P) Ltd"}), ("/api/calculate/pincodes", {"q": "638("}),
                             ("/api/support/tickets", {"search": "C++"}), ("/api/vault", {"search": "*"}), ("/api/partners", {"search": "[x"})):
            r = await a.get(path, params=params)
            assert r.status_code < 500, (path, r.status_code, r.text[:200])
    run(loop, go())


def test_a_manager_corrects_only_their_own_branch_attendance(app, loop, world):
    async def go():
        db = server.db
        other = await db.users.insert_one({"email": f"south.{TAG}@example.com", "name": "South Staff", "role": "staff", "password_hash": "x",
                                           "location_ids": [world["south"]], "created_at": "2026-01-01T00:00:00+00:00"})
        rec = await db.attendance.insert_one({"user_id": str(other.inserted_id), "date": "2026-11-02", "check_in": {"at": "2026-11-02T03:30:00+00:00"},
                                              "check_out": None, "corrections": []})
        r = await world["mgr_n"].put(f"/api/attendance/{rec.inserted_id}", json={"check_out_at": "18:00"})
        assert r.status_code == 404
        assert (await world["admin"].put(f"/api/attendance/{rec.inserted_id}", json={"check_out_at": "18:00"})).status_code == 200
        await db.attendance.delete_one({"_id": rec.inserted_id})
    run(loop, go())
