"""Nov 2026: payroll & benefits (PF / ESI / PT / TDS, insurance, incentives, commission, advances, the monthly run,
payslips, bank / EPFO / ESIC files, My pay) and the staff help desk. In-process, no MongoDB server:
    cd backend && pytest tests/test_payroll_helpdesk.py
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "payroll_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "Adm1n-pass-123")
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-payroll-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
import payroll as pr  # noqa: E402
import helpdesk as hd  # noqa: E402
import server  # noqa: E402

PW = "Passw0rd!x"
MONTH = "2026-11"
S = pr.DEFAULT_SETTINGS


# ───────────── the arithmetic ─────────────
def test_rounding_tax_and_statutory_rules():
    assert pr.r0(2.5) == 3 and pr.r0(1249.5) == 1250 and pr.up(135.01) == 136 and pr.up(135.0) == 135
    t = S["tds"]
    assert pr.annual_tax(1_275_000, t) == 0                                   # ₹12 lakh taxable: rebate takes it all
    assert pr.annual_tax(1_300_000, t) == 26_000                              # marginal relief: ₹25,000 + 4% cess
    assert pr.annual_tax(2_000_000, t) == 192_400                             # 20k + 40k + 60k + 65k = 1,85,000 + cess
    assert pr.pf_wages(10_000, 30_000, True) == 15_000 and pr.pf_wages(10_000, 30_000, False) == 10_000
    a = pr.pf_split(15_000, S["pf"], {})
    assert (a["ee"], a["eps"], a["er_epf"]) == (1800, 1250, 550)
    b = pr.pf_split(30_000, S["pf"], {})                                       # ₹25,000 ceiling from 17 Sep 2026
    assert (b["ee"], b["eps"], b["er_epf"], b["epf_wage"], b["edli"]) == (3000, 2083, 917, 25000, 125)
    c = pr.pf_split(30_000, S["pf"], {"pf_full_wages": True})                  # employee chose PF on full wages
    assert (c["ee"], c["eps"], c["er_epf"]) == (3600, 2083, 917)
    assert pr.esi_covered({}, 20_000, 24_000, S["esi"]) and not pr.esi_covered({}, None, 24_000, S["esi"])   # stays covered to period end
    assert pr.slab_amount(6 * 18_000, S["pt"]["slabs"]) == 1250 and pr.slab_amount(20_000, S["pt"]["slabs"]) == 0
    assert pr.fy_months_left("2026-04") == 12 and pr.fy_months_left("2026-11") == 5 and pr.fy_months_left("2027-03") == 1
    assert pr.half_start("2026-11") == "2026-10" and pr.half_start("2027-02") == "2026-10" and pr.half_start("2026-05") == "2026-04"
    assert pr.amount_words(123456) == "One Lakh Twenty Three Thousand Four Hundred Fifty Six"
    assert pr.amount_words(10_000_000) == "One Crore"
    g = pr.gratuity_estimate(pr.notify.to_date("2020-01-01"), pr.notify.to_date("2026-11-05"), 15_000)
    assert g["eligible"] and g["years"] == 7 and g["amount"] == 60577
    assert not pr.gratuity_estimate(pr.notify.to_date("2023-01-01"), pr.notify.to_date("2026-11-05"), 15_000)["eligible"]


def test_one_line_of_pay():
    st = {"basic": 12_000, "hra": 4_800, "special": 3_200}
    days = {"basis": 30, "fy_months_left": 5}
    full = pr.compute_line(month=MONTH, profile={"uan": "100200300400", "esi_number": "3100123456"}, structure=st, s=S, days=days, extras=[], advances=[], insurance=[], prior={}, edits={})
    assert (full["gross"], full["pf_ee"], full["eps"], full["pf_er_epf"], full["esi_ee"], full["esi_er"], full["pt"], full["tds"]) == (20000, 1440, 1000, 440, 150, 650, 0, 0)
    assert full["net"] == 18410 and not full["warnings"]
    cut = pr.compute_line(month=MONTH, profile={}, structure=st, s=S, days=days, extras=[], advances=[], insurance=[], prior={}, edits={"lop_days": 3})
    assert cut["paid_days"] == 27 and cut["gross"] == 18000 and cut["pf_ee"] == 1296 and cut["esi_ee"] == 135 and cut["net"] == 16569
    assert any("UAN" in w for w in cut["warnings"])
    sep = pr.compute_line(month="2026-09", profile={}, structure=st, s=S, days=days, extras=[], advances=[], insurance=[],
                          prior={"half_gross": 100_000, "half_pt": 0}, edits={})
    assert sep["pt"] == 1250                                                   # half-yearly PT in September
    big = pr.compute_line(month=MONTH, profile={}, structure={"basic": 100_000, "hra": 40_000, "special": 60_000}, s=S, days=days, extras=[], advances=[],
                          insurance=[], prior={"fy_taxable": 1_400_000, "fy_tds": 150_000}, edits={})
    # 14L so far + 2L now + 2L × 4 = 24L; tax on 23.25L = 2,81,250 × 1.04 = 2,92,500; less 1,50,000 taken, over 5 months
    assert big["tds"] == 28_500 and not big["esi_covered"] and big["pf_ee"] == 3000
    poor = pr.compute_line(month=MONTH, profile={}, structure={"basic": 5_000}, s=S, days=days, extras=[], insurance=[], prior={}, edits={},
                           advances=[{"id": "a1", "monthly": 9_000, "balance": 9_000}])
    assert poor["net"] == 0 and poor["advance_recoveries"][0]["amount"] == 5000 - 600 - 38      # never below zero


def test_commission_rules():
    pct = {"mode": "percent", "percent": 2, "base": "before_gst"}
    line = pr.commission_line(pct, 100_000, 118_000, 100_000, 5)
    assert round(line["base"], 2) == 84745.76 and pr.r0(pr.commission_total(pct, [line])[0]) == 1695
    slab = {"mode": "slab", "slabs": [{"from": 0, "percent": 1}, {"from": 500_000, "percent": 1.5}], "base": "with_gst"}
    assert pr.commission_total(slab, [{"base": 600_000, "kw": 0}]) == (9000.0, 1.5)
    kw = {"mode": "per_kw", "per_kw": 1000}
    l2 = pr.commission_line(kw, 59_000, 118_000, 100_000, 5)
    assert l2["kw"] == 2.5 and pr.commission_total(kw, [l2])[0] == 2500


def test_help_desk_moves():
    assert hd.move_ok("open", "in_progress", True, False) and not hd.move_ok("open", "in_progress", False, True)
    assert hd.move_ok("resolved", "open", False, True) and hd.move_ok("waiting", "closed", False, True)
    assert hd.is_overdue({"status": "open", "due_at": "2026-01-01T00:00:00+00:00"}, "2026-02-01") and not hd.is_overdue({"status": "waiting", "due_at": "2026-01-01"}, "2026-02-01")


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


EMAILS = ["pay.staff@example.com", "pay.staff2@example.com", "pay.mgr@example.com"]


@pytest.fixture(scope="module")
def world(app, loop):
    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        ids = {}
        for email, name, role in zip(EMAILS, ("Kavin Sales", "Divya IT", "Mani Manager"), ("staff", "staff", "manager")):
            r = await a.post("/api/users", json={"email": email, "password": PW, "name": name, "role": role, "phone": "9876500" + str(len(ids)).zfill(3)})
            assert r.status_code == 200, r.text
            ids[name.split()[0].lower()] = str((await server.db.users.find_one({"email": email}))["_id"])
        await server.db.users.update_one({"email": EMAILS[0]}, {"$set": {"joining_date": "2026-01-10", "department": "Sales", "designation": "Sales executive"}})
        return {"admin": a, "ids": ids, "staff": await login(app, EMAILS[0], PW), "it": await login(app, EMAILS[1], PW), "mgr": await login(app, EMAILS[2], PW)}

    async def tidy():   # other test files share this in-memory database
        db = server.db
        uids = [str(u["_id"]) async for u in db.users.find({"email": {"$in": EMAILS}})]
        await db.users.delete_many({"email": {"$in": EMAILS}})
        for col in ("payroll_profiles", "payroll_runs", "pay_extras", "pay_advances", "commission_rules", "commission_links", "insurance_policies",
                    "payroll_settings", "helpdesk_tickets", "helpdesk_settings"):
            await db[col].delete_many({})
        await db.projects.delete_many({"reference_number": "SNP-PAY-1"})
        await db.payments.delete_many({"notes": "payroll-test"})
        await db.counters.delete_many({"_id": "helpdesk"})
        await db.notifications.delete_many({"user_id": {"$in": uids}})

    yield run(loop, go())
    run(loop, tidy())


def test_payroll_month_end_to_end(app, loop, world):
    async def go():
        a, st, ids = world["admin"], world["staff"], world["ids"]
        kid = ids["kavin"]
        assert (await st.get("/api/payroll/people")).status_code == 403                        # salaries are private
        assert (await world["mgr"].get("/api/payroll/people")).status_code == 403
        bad = await a.put(f"/api/payroll/people/{kid}", json={"uan": "12345"})
        assert bad.status_code == 400 and "12 digits" in bad.json()["detail"]
        assert (await a.put(f"/api/payroll/people/{kid}", json={"ifsc": "SBIN123"})).status_code == 400
        ok = await a.put(f"/api/payroll/people/{kid}", json={"uan": "100200300400", "esi_number": "3100123456", "pan": "abcde1234f", "bank_name": "SBI Erode",
                                                             "account_number": "33445566778", "ifsc": "sbin0001234", "pay_mode": "bank"})
        assert ok.status_code == 200, ok.text
        log = await server.db.audit_logs.find_one({"action": "payroll_profile_updated", "entity_id": kid})
        assert "33445566778" not in str(log)                                                    # bank numbers stay out of the activity log
        prev = (await a.post("/api/payroll/preview", json={"structure": {"effective_from": "2026-01", "basic": 12000, "hra": 4800, "special": 3200}})).json()
        assert prev["gross"] == 20000 and prev["annual_ctc"] > 240000
        r = await a.post(f"/api/payroll/people/{kid}/salary", json={"effective_from": "2026-01", "basic": 12000, "hra": 4800, "special": 3200})
        assert r.status_code == 200, r.text
        row = next(p for p in (await a.get("/api/payroll/people")).json() if p["id"] == kid)
        assert row["gross"] == 20000 and row["missing"] == [] and row["esi"] and row["pf"] and row["account_masked"].endswith("6778")
        # incentive (needs approval), commission from a customer payment, an advance, insurance
        x = (await a.post("/api/payroll/extras", json={"user_id": kid, "month": MONTH, "kind": "incentive", "amount": 2000, "reason": "Target hit"})).json()
        assert x["status"] == "pending"
        assert (await st.post(f"/api/payroll/extras/{x['id']}/approve")).status_code == 403
        assert (await a.post(f"/api/payroll/extras/{x['id']}/approve")).status_code == 200
        pid = str((await server.db.projects.insert_one({"customer": {"name": "Ravi Kumar"}, "reference_number": "SNP-PAY-1", "created_by": kid, "status": "approved",
                                                         "cost_estimation": {"total_cost": 118000, "taxable_total": 100000, "system_size_kw": 3}})).inserted_id)
        await server.db.payments.insert_one({"project_id": pid, "amount": 59000, "payment_method": "upi", "notes": "payroll-test", "created_at": "2026-11-10T06:00:00+00:00"})
        assert (await a.post("/api/payroll/commission/rules", json={"name": "Sales 2%", "mode": "percent", "percent": 2})).status_code == 200
        com = (await a.get(f"/api/payroll/commission?month={MONTH}")).json()
        me = next(p for p in com["people"] if p["user_id"] == kid)
        assert me["collected"] == 59000 and me["base"] == 50000 and me["amount"] == 1000
        ap = (await a.post("/api/payroll/commission/approve", json={"month": MONTH})).json()
        assert ap["approved"] >= 1
        again = (await a.get(f"/api/payroll/commission?month={MONTH}")).json()
        assert not any(p["user_id"] == kid for p in again["people"]) and len(again["counted"]) == 1   # each payment counts once
        adv = await a.post("/api/payroll/advances", json={"user_id": kid, "amount": 5000, "given_on": "2026-11-02", "monthly": 2000, "start_month": MONTH, "reason": "Bike repair"})
        assert adv.status_code == 200
        pol = (await a.post("/api/payroll/insurance", json={"name": "Group health 2026-27", "insurer": "Star Health", "start_date": "2026-04-01", "end_date": "2027-03-31",
                                                          "sum_insured": 300000, "premium": 90000, "employee_share_monthly": 300, "helpline": "1800 425 2255"})).json()
        mem = await a.post(f"/api/payroll/insurance/{pol['id']}/members", json={"user_id": kid, "cover": "self_spouse", "member_number": "SH-77",
                                                                              "dependants": [{"name": "Priya", "relation": "Spouse"}]})
        assert mem.status_code == 200
        # the run
        run_ = await a.post("/api/payroll/runs", json={"month": MONTH})
        assert run_.status_code == 200, run_.text
        line = next(l for l in run_.json()["lines"] if l["user_id"] == kid)
        assert line["gross"] == 23000 and line["pf_ee"] == 1440 and line["esi_ee"] == 173 and line["esi_er"] == 748 and line["pt"] == 0 and line["tds"] == 0
        assert {d["code"] for d in line["deductions"]} == {"pf", "esi", "insurance", "advance"} and line["net"] == 23000 - 1440 - 173 - 300 - 2000
        assert line["tds_estimated_months"] == 7                         # Apr–Oct weren't paid here: their salary counts toward the year's tax
        assert (await a.put(f"/api/payroll/people/{kid}", json={"fy_opening_income": 140000, "fy_opening_tds": 0})).status_code == 200
        prof = (await a.get(f"/api/payroll/people/{kid}")).json()["profile"]
        assert prof["fy_opening_income"] == 140000
        rc = next(l for l in (await a.post(f"/api/payroll/runs/{MONTH}/recalculate")).json()["lines"] if l["user_id"] == kid)
        assert rc["tds_estimated_months"] == 0 and rc["net"] == line["net"]
        assert (await a.get("/api/payroll/runs/2026-10?optional=true")).json() is None
        edited = (await a.put(f"/api/payroll/runs/{MONTH}/lines/{kid}", json={"lop_days": 3, "adjustments": [{"label": "Mobile bill", "amount": 400}]})).json()
        line = next(l for l in edited["lines"] if l["user_id"] == kid)
        assert line["paid_days"] == 27 and line["gross"] == 18000 + 2000 + 1000 + 400 and line["pf_ee"] == 1296
        assert (await st.post(f"/api/payroll/runs/{MONTH}/approve")).status_code == 403
        appr = await a.post(f"/api/payroll/runs/{MONTH}/approve")
        assert appr.status_code == 200 and appr.json()["status"] == "approved"
        assert (await server.db.pay_extras.find_one({"_id": server.ObjectId(x["id"])}))["status"] == "in_payroll"
        assert (await a.put(f"/api/payroll/runs/{MONTH}/lines/{kid}", json={"lop_days": 0})).status_code == 400      # frozen
        bank = await a.get(f"/api/payroll/runs/{MONTH}/export/bank")
        assert bank.status_code == 200 and "33445566778" in bank.text and "SBIN0001234" in bank.text and str(line["net"]) in bank.text
        ecr = (await a.get(f"/api/payroll/runs/{MONTH}/export/pf_ecr")).text
        assert ecr.startswith("100200300400#~#KAVIN SALES#~#21400#~#10800#~#10800#~#10800#~#1296#~#900#~#396#~#3#~#0")
        assert "3100123456" in (await a.get(f"/api/payroll/runs/{MONTH}/export/esi")).text
        reg = (await a.get(f"/api/payroll/runs/{MONTH}/export/register")).text
        assert "Kavin Sales" in reg and "Sales commission" in reg
        slip = await a.get(f"/api/payroll/runs/{MONTH}/payslip/{kid}")
        assert slip.status_code == 200 and slip.content[:4] == b"%PDF"
        paid = await a.post(f"/api/payroll/runs/{MONTH}/paid", json={"paid_on": "2026-11-30", "mode": "bank", "reference": "NEFT batch 12"})
        assert paid.status_code == 200 and paid.json()["status"] == "paid"
        av = await server.db.pay_advances.find_one({"user_id": kid})
        assert av["recovered"] == 2000 and av["status"] == "active"
        assert (await a.post(f"/api/payroll/people/{kid}/salary", json={"effective_from": MONTH, "basic": 15000})).status_code == 400   # can't rewrite a paid month
        # My pay: their own payslip and cover, nothing about anyone else
        mine = (await st.get("/api/payroll/me")).json()
        assert mine["payslips"][0]["month"] == MONTH and mine["payslips"][0]["net"] == line["net"] and mine["ids"]["account_masked"].endswith("6778")
        assert mine["insurance"][0]["member_number"] == "SH-77" and mine["insurance"][0]["helpline"] == "1800 425 2255"
        assert "account_number" not in mine["ids"]
        my_slip = await st.get(f"/api/payroll/me/payslip/{MONTH}")
        assert my_slip.status_code == 200 and my_slip.content[:4] == b"%PDF"
        assert (await world["it"].get(f"/api/payroll/me/payslip/{MONTH}")).status_code == 404
        assert await server.db.notifications.find_one({"user_id": kid, "kind": "payslip"})
        ov = (await a.get("/api/payroll/overview")).json()
        assert ov["advances"]["balance"] == 3000 and any(t["month"] == MONTH for t in ov["trend"])
        # Payroll settings can narrow access to named people even when a role has the page
        mgr = (await a.get("/api/permissions/manager")).json()["permissions"]
        before = dict(mgr["module_payroll"])
        mgr["module_payroll"] = {"view": True, "create": True, "edit": True, "delete": False, "export": True}
        assert (await a.put("/api/permissions/manager", json={"permissions": mgr})).status_code == 200
        assert (await world["mgr"].get("/api/payroll/people")).status_code == 200
        assert (await world["mgr"].post(f"/api/payroll/runs/{MONTH}/reopen")).status_code == 403          # approving is its own switch
        await a.put("/api/payroll/settings", json={"people_allowed": [world["ids"]["kavin"]]})
        assert (await world["mgr"].get("/api/payroll/people")).status_code == 403
        await a.put("/api/payroll/settings", json={"people_allowed": []})
        mgr["module_payroll"] = before
        await a.put("/api/permissions/manager", json={"permissions": mgr})
    run(loop, go())


def test_help_desk(app, loop, world):
    async def go():
        a, st, it, mgr, ids = world["admin"], world["staff"], world["it"], world["mgr"], world["ids"]
        cats = (await st.get("/api/helpdesk/settings")).json()
        assert {c["key"] for c in cats["categories"]} >= {"it", "hr", "app"} and not cats["is_handler"]
        assert (await st.put("/api/helpdesk/settings", json={"categories": []})).status_code == 403
        s = (await a.put("/api/helpdesk/settings", json={"categories": [{**c, "handler_ids": [ids["divya"]] if c["key"] == "it" else c["handler_ids"]} for c in cats["categories"]],
                                                           "due_hours": {"urgent": 2}})).json()
        assert next(c for c in s["categories"] if c["key"] == "it")["handlers"] == ["Divya IT"] and s["due_hours"]["urgent"] == 2
        # an HR question: admins handle it (nobody named for HR)
        t = (await st.post("/api/helpdesk/tickets", json={"category": "hr", "title": "PF number missing on payslip", "details": "My UAN isn't shown", "priority": "normal"})).json()
        assert t["number"].startswith("HD-") and t["status"] == "open" and t["mine"] and not t["can_handle"]
        assert (await st.post(f"/api/helpdesk/tickets/{t['id']}/reply", json={"text": "psst", "internal": True})).status_code == 403
        assert (await it.get(f"/api/helpdesk/tickets/{t['id']}")).status_code == 404               # not theirs, not their category
        assert (await mgr.get(f"/api/helpdesk/tickets/{t['id']}")).status_code == 404
        q = (await a.get("/api/helpdesk/tickets?scope=queue&status=open")).json()
        assert any(x["id"] == t["id"] for x in q)
        await a.post(f"/api/helpdesk/tickets/{t['id']}/reply", json={"text": "Checking with accounts", "internal": True})
        r = (await a.post(f"/api/helpdesk/tickets/{t['id']}/reply", json={"text": "Can you send your UAN card?"})).json()
        assert r["status"] == "in_progress" and r["assignee_name"] and r["first_response_at"]
        seen = (await st.get(f"/api/helpdesk/tickets/{t['id']}")).json()
        assert [x["text"] for x in seen["replies"]] == ["Can you send your UAN card?"]                 # internal note hidden
        assert (await a.post(f"/api/helpdesk/tickets/{t['id']}/status", json={"status": "waiting"})).json()["status"] == "waiting"
        back = (await st.post(f"/api/helpdesk/tickets/{t['id']}/reply", json={"text": "Sent on WhatsApp"})).json()
        assert back["status"] == "in_progress"
        assert (await st.post(f"/api/helpdesk/tickets/{t['id']}/status", json={"status": "resolved"})).status_code == 400   # only handlers solve
        assert (await a.post(f"/api/helpdesk/tickets/{t['id']}/status", json={"status": "resolved", "note": "Added your UAN"})).json()["status"] == "resolved"
        rated = (await st.post(f"/api/helpdesk/tickets/{t['id']}/rate", json={"rating": 5, "note": "Quick"})).json()
        assert rated["status"] == "closed" and rated["rating"] == 5
        # an IT problem goes straight to the one IT handler
        t2 = (await st.post("/api/helpdesk/tickets", json={"category": "it", "title": "Laptop won't charge", "priority": "urgent"})).json()
        assert t2["assignee_name"] == "Divya IT"
        assert await server.db.notifications.find_one({"user_id": ids["divya"], "kind": "helpdesk"})
        mine = (await it.get("/api/helpdesk/tickets?scope=queue")).json()
        assert [x["id"] for x in mine] == [t2["id"]] and mine[0]["can_handle"]
        assert (await it.post(f"/api/helpdesk/tickets/{t2['id']}/status", json={"status": "in_progress"})).status_code == 200
        summ = (await it.get("/api/helpdesk/summary")).json()
        assert summ["queue"] == 1 and summ["is_handler"]
        assert (await st.get("/api/helpdesk/tickets?scope=all")).status_code == 403
        rep = (await a.get("/api/helpdesk/report")).json()
        assert rep["total"] == 2 and any(r_["rating"] == 5 for r_ in rep["rows"])
    run(loop, go())
