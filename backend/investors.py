"""Investor logins and the business dashboard.

* Admins add investors, choose which parts of the dashboard each one sees, and record the money each one
  put in and was paid out (a simple ledger).
* Investors sign in on the normal sign-in page, but get their own session cookie that only works under
  /api/investor — they can never reach the staff API. They see totals only: no customer names or phones.
* Admins see the same charts for the whole business, plus an overview of every investor and a preview of
  exactly what each one sees.
"""
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import jwt
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

IST = timezone(timedelta(hours=5, minutes=30))
COOKIE = "sp_investor"
COOKIE_PATH = "/api/investor"
SESSION_HOURS = 12
MAX_TRIES, TRY_WINDOW_MIN = 6, 15
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

SECTIONS = [
    {"key": "kpis", "label": "Headline numbers", "what": "Revenue, gross margin, projects won and kW installed."},
    {"key": "growth", "label": "Monthly growth", "what": "Value of projects won and money collected, month by month."},
    {"key": "capacity", "label": "Capacity", "what": "kW installed over time, and the mix of system types."},
    {"key": "pipeline", "label": "Pipeline", "what": "How many projects are at each stage, with kW and value."},
    {"key": "branches", "label": "Branches", "what": "Value and kW won by each branch."},
    {"key": "cash", "label": "Cash", "what": "Money collected and still to collect on won projects."},
    {"key": "amc", "label": "Service income", "what": "Maintenance (AMC) contracts and yearly service income."},
    {"key": "investment", "label": "Their investment", "what": "What they put in, their share and the payouts made."},
]
SECTION_KEYS = [s["key"] for s in SECTIONS]
LEDGER_TYPES = {"investment": "Money in", "payout": "Payout", "capital_return": "Capital returned"}
STAGES = [("draft", "Leads"), ("submitted", "Quoted"), ("approved", "Won · installing"), ("completed", "Installed")]


def _now():
    return datetime.now(timezone.utc)


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _day(iso) -> Optional[str]:
    if not iso:
        return None
    s = str(iso)
    if len(s) == 10:
        return s
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(IST).date().isoformat()
    except ValueError:
        return s[:10]


def _kw(p) -> float:
    ps = ((p.get("custom_fields") or {}).get("proposed_solution") or {})
    return _f(ps.get("system_size_kw")) or _f((p.get("cost_estimation") or {}).get("total_capacity_kw")) or _f((p.get("solar_system") or {}).get("capacity_kw"))


def _system_type(p) -> str:
    ps = ((p.get("custom_fields") or {}).get("proposed_solution") or {})
    return (ps.get("system_type") or (p.get("solar_system") or {}).get("system_type") or "on-grid").lower()


def _won_day(p) -> Optional[str]:
    return _day(p.get("approved_at") or (p.get("completed_at") if p.get("status") == "completed" else None) or p.get("updated_at") or p.get("created_at"))


def _installed_day(p) -> Optional[str]:
    return _day(p.get("commissioning_date") or p.get("completed_at") or p.get("installation_date") or p.get("updated_at"))


def _months_back(n: int, today: date) -> List[str]:
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


async def business_snapshot(db, months: int = 12, today: Optional[date] = None) -> Dict[str, Any]:
    """Totals-only picture of the business. months = 0 means all time. No customer names anywhere."""
    today = today or _now().astimezone(IST).date()
    projects = await db.projects.find({"deleted_at": {"$exists": False}}, {
        "status": 1, "created_at": 1, "project_date": 1, "approved_at": 1, "completed_at": 1, "updated_at": 1, "commissioning_date": 1,
        "installation_date": 1, "cost_estimation.total_cost": 1, "cost_estimation.margin_total": 1, "cost_estimation.total_capacity_kw": 1,
        "custom_fields.proposed_solution.system_size_kw": 1, "custom_fields.proposed_solution.system_type": 1, "solar_system": 1,
        "location_id": 1}).to_list(50000)
    first = min((d for d in (_day(p.get("created_at")) for p in projects) if d), default=today.isoformat())
    if months and months > 0:
        month_keys = _months_back(months, today)
    else:
        fy, fm = int(first[:4]), int(first[5:7])
        span = (today.year - fy) * 12 + (today.month - fm) + 1
        month_keys = _months_back(max(1, min(span, 120)), today)
    start = month_keys[0] + "-01"
    in_period = lambda d: bool(d) and d >= start  # noqa: E731

    won = [p for p in projects if p.get("status") in ("approved", "completed")]
    value = lambda p: _f((p.get("cost_estimation") or {}).get("total_cost"))  # noqa: E731
    margin = lambda p: _f((p.get("cost_estimation") or {}).get("margin_total"))  # noqa: E731
    won_period = [p for p in won if in_period(_won_day(p))]
    installed = [p for p in projects if p.get("status") == "completed"]
    installed_period = [p for p in installed if in_period(_installed_day(p))]
    created_period = [p for p in projects if in_period(_day(p.get("created_at")))]
    quoted_period = [p for p in created_period if p.get("status") != "draft"]

    sales = await db.sales.find({"status": {"$ne": "cancelled"}}, {"grand_total": 1, "amount_paid": 1, "created_at": 1, "lines.margin_amount": 1}).to_list(50000)
    sales_period = [s for s in sales if in_period(_day(s.get("created_at")))]
    sales_rev = sum(_f(s.get("grand_total")) for s in sales_period)
    sales_margin = sum(sum(_f(l.get("margin_amount")) for l in (s.get("lines") or [])) for s in sales_period)

    live_ids = {str(p["_id"]) for p in projects}
    payments = await db.payments.find({}, {"project_id": 1, "amount": 1, "created_at": 1}).to_list(100000)
    payments = [x for x in payments if x.get("project_id") in live_ids]

    # ── headline numbers (for the chosen period) ──
    revenue = sum(value(p) for p in won_period) + sales_rev
    gross = sum(margin(p) for p in won_period) + sales_margin
    collected_period = sum(_f(x.get("amount")) for x in payments if in_period(_day(x.get("created_at")))) + \
        sum(_f(s.get("amount_paid")) for s in sales_period)
    kpis = {
        "revenue": round(revenue), "project_revenue": round(sum(value(p) for p in won_period)), "direct_sales_revenue": round(sales_rev),
        "gross_margin": round(gross), "margin_pct": round(gross / revenue * 100, 1) if revenue else 0.0,
        "projects_won": len(won_period), "kw_won": round(sum(_kw(p) for p in won_period), 1),
        "kw_installed": round(sum(_kw(p) for p in installed_period), 1), "plants_installed": len(installed_period),
        "avg_project_value": round(sum(value(p) for p in won_period) / len(won_period)) if won_period else 0,
        "collected": round(collected_period),
        "win_rate_pct": round(len([p for p in quoted_period if p.get("status") in ("approved", "completed")]) / len(quoted_period) * 100, 1) if quoted_period else 0.0,
        "all_time": {"plants_installed": len(installed), "kw_installed": round(sum(_kw(p) for p in installed), 1),
                     "projects_won": len(won), "value_won": round(sum(value(p) for p in won))},
    }

    # ── month by month ──
    mrow = {k: {"month": k, "won_value": 0.0, "collected": 0.0, "kw_installed": 0.0, "projects_won": 0, "direct_sales": 0.0} for k in month_keys}
    for p in won:
        d = _won_day(p)
        if d and d[:7] in mrow:
            mrow[d[:7]]["won_value"] += value(p)
            mrow[d[:7]]["projects_won"] += 1
    for p in installed:
        d = _installed_day(p)
        if d and d[:7] in mrow:
            mrow[d[:7]]["kw_installed"] += _kw(p)
    for x in payments:
        d = _day(x.get("created_at"))
        if d and d[:7] in mrow:
            mrow[d[:7]]["collected"] += _f(x.get("amount"))
    for s in sales:
        d = _day(s.get("created_at"))
        if d and d[:7] in mrow:
            mrow[d[:7]]["direct_sales"] += _f(s.get("grand_total"))
            mrow[d[:7]]["collected"] += _f(s.get("amount_paid"))
    cum_base = sum(_kw(p) for p in installed if (_installed_day(p) or "9999") < start)
    monthly, cum = [], cum_base
    for k in month_keys:
        r = mrow[k]
        cum += r["kw_installed"]
        monthly.append({"month": k, "won_value": round(r["won_value"]), "collected": round(r["collected"]), "direct_sales": round(r["direct_sales"]),
                        "kw_installed": round(r["kw_installed"], 1), "kw_cumulative": round(cum, 1), "projects_won": r["projects_won"]})

    # ── pipeline (right now) ──
    pipeline = []
    for st, label in STAGES:
        ps = [p for p in projects if (p.get("status") or "draft") == st]
        pipeline.append({"stage": st, "label": label, "count": len(ps), "kw": round(sum(_kw(p) for p in ps), 1), "value": round(sum(value(p) for p in ps))})

    # ── system types (won + installed) ──
    mix = defaultdict(lambda: {"kw": 0.0, "count": 0})
    for p in won:
        t = _system_type(p)
        mix[t]["kw"] += _kw(p)
        mix[t]["count"] += 1
    nice = {"on-grid": "On-grid", "off-grid": "Off-grid", "hybrid": "Hybrid", "solar-pump": "Solar pump"}
    system_mix = sorted([{"type": nice.get(t, t.title()), "kw": round(v["kw"], 1), "count": v["count"]} for t, v in mix.items()], key=lambda x: -x["kw"])

    # ── branches (period) ──
    locs = {str(l["_id"]): l.get("name") for l in await db.locations.find({}, {"name": 1}).to_list(500)}
    br = defaultdict(lambda: {"value": 0.0, "kw": 0.0, "projects": 0})
    for p in won_period:
        name = locs.get(str(p.get("location_id") or ""), "Not set")
        br[name]["value"] += value(p)
        br[name]["kw"] += _kw(p)
        br[name]["projects"] += 1
    branches = sorted([{"branch": k, "value": round(v["value"]), "kw": round(v["kw"], 1), "projects": v["projects"]} for k, v in br.items()], key=lambda x: -x["value"])

    # ── cash (all won projects, all time) ──
    billed = sum(value(p) for p in won)
    paid_by_project = defaultdict(float)
    for x in payments:
        paid_by_project[x.get("project_id")] += _f(x.get("amount"))
    collected_won = sum(min(paid_by_project.get(str(p["_id"]), 0.0), value(p) or paid_by_project.get(str(p["_id"]), 0.0)) for p in won)
    credits = await db.customer_credits.find({"status": {"$ne": "closed"}}, {"balance": 1}).to_list(10000)
    cash = {"billed": round(billed), "collected": round(collected_won), "to_collect": round(max(0.0, billed - collected_won)),
            "collected_pct": round(collected_won / billed * 100, 1) if billed else 0.0,
            "credit_outstanding": round(sum(_f(c.get("balance")) for c in credits))}

    # ── service income ──
    contracts = await db.amc_contracts.find({}, {"status": 1, "annual_value": 1, "end_date": 1}).to_list(20000)
    active = [c for c in contracts if c.get("status") == "active"]
    soon = (today + timedelta(days=60)).isoformat()
    amc = {"active_contracts": len(active), "yearly_income": round(sum(_f(c.get("annual_value")) for c in active)),
           "renewals_due_60d": sum(1 for c in active if (c.get("end_date") or "9999") <= soon)}

    return {"generated_at": _now().isoformat(), "period": {"months": months, "from": start, "to": today.isoformat(), "month_keys": month_keys},
            "kpis": kpis, "growth": monthly, "capacity": {"monthly": monthly, "system_mix": system_mix}, "pipeline": pipeline,
            "branches": branches, "cash": cash, "amc": amc}


def _ledger_summary(inv: Dict[str, Any], entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    put_in = sum(_f(e.get("amount")) for e in entries if e.get("type") == "investment")
    payouts = sum(_f(e.get("amount")) for e in entries if e.get("type") == "payout")
    returned = sum(_f(e.get("amount")) for e in entries if e.get("type") == "capital_return")
    return {"invested": round(put_in, 2), "payouts": round(payouts, 2), "capital_returned": round(returned, 2),
            "capital_in_business": round(put_in - returned, 2), "committed": round(_f(inv.get("committed_amount")), 2),
            "share_pct": _f(inv.get("share_pct")), "return_pct": round(payouts / put_in * 100, 1) if put_in else 0.0,
            "since": min((e.get("date") for e in entries if e.get("type") == "investment" and e.get("date")), default=None)}


def _entry_out(e) -> Dict[str, Any]:
    return {"id": str(e["_id"]), "type": e.get("type"), "type_label": LEDGER_TYPES.get(e.get("type"), e.get("type")), "amount": e.get("amount"),
            "date": e.get("date"), "mode": e.get("mode"), "reference": e.get("reference"), "note": e.get("note"), "created_at": e.get("created_at")}


def _sections(inv) -> Dict[str, bool]:
    s = inv.get("sections") or {}
    return {k: bool(s.get(k, True)) for k in SECTION_KEYS}


class InvestorIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=20)
    organisation: Optional[str] = Field(default=None, max_length=160)
    share_pct: Optional[float] = Field(default=None, ge=0, le=100)
    committed_amount: Optional[float] = Field(default=None, ge=0)
    sections: Optional[Dict[str, bool]] = None
    notes: Optional[str] = Field(default=None, max_length=1000)
    active: bool = True
    password: Optional[str] = Field(default=None, max_length=200)


class LedgerIn(BaseModel):
    type: str
    amount: float = Field(gt=0)
    date: str
    mode: Optional[str] = Field(default=None, max_length=40)
    reference: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=300)


class InvestorLogin(BaseModel):
    email: str
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


def create_router(db, get_current_user, require_role, create_audit_log, jwt_secret: str, hash_password, verify_password):
    router = APIRouter(tags=["investors"])

    def _oid(v, what="investor"):
        try:
            return ObjectId(v)
        except Exception:
            raise HTTPException(status_code=404, detail=f"{what.capitalize()} not found")

    async def _company() -> Dict[str, Any]:
        c = await db.company_profiles.find_one({"is_active": True}) or await db.company_profiles.find_one({}) or {}
        return {"name": c.get("company_name") or "Sensoper", "logo_url": c.get("logo_url"), "tagline": c.get("tagline")}

    async def _entries(inv_id: str) -> List[Dict[str, Any]]:
        return await db.investor_ledger.find({"investor_id": inv_id}).sort([("date", -1), ("created_at", -1)]).to_list(5000)

    async def _view_for(inv: Dict[str, Any], months: int) -> Dict[str, Any]:
        """Exactly what one investor is shown."""
        sec = _sections(inv)
        snap = await business_snapshot(db, months)
        out = {"company": await _company(), "investor": {"name": inv.get("name"), "organisation": inv.get("organisation")},
               "sections": sec, "period": snap["period"], "generated_at": snap["generated_at"]}
        for k in ("kpis", "growth", "capacity", "pipeline", "branches", "cash", "amc"):
            if sec.get(k):
                out[k] = snap[k]
        if sec.get("investment"):
            entries = await _entries(str(inv["_id"]))
            out["investment"] = {**_ledger_summary(inv, entries), "entries": [_entry_out(e) for e in entries]}
        return out

    def _public(inv, entries=None) -> Dict[str, Any]:
        out = {"id": str(inv["_id"]), "name": inv.get("name"), "email": inv.get("email"), "phone": inv.get("phone"),
               "organisation": inv.get("organisation"), "share_pct": inv.get("share_pct"), "committed_amount": inv.get("committed_amount"),
               "sections": _sections(inv), "notes": inv.get("notes"), "active": inv.get("active", True), "created_at": inv.get("created_at"),
               "last_login_at": inv.get("last_login_at"), "login_count": inv.get("login_count", 0), "must_reset_password": bool(inv.get("must_reset_password"))}
        if entries is not None:
            out["money"] = _ledger_summary(inv, entries)
        return out

    def _clean_sections(s: Optional[Dict[str, bool]], base: Optional[Dict[str, bool]] = None) -> Dict[str, bool]:
        base = dict(base or {k: True for k in SECTION_KEYS})
        for k, v in (s or {}).items():
            if k in SECTION_KEYS:
                base[k] = bool(v)
        return base

    # ═════════════ admin: investors ═════════════
    @router.get("/investors/meta")
    async def meta(request: Request):
        await require_role("admin")(request)
        return {"sections": SECTIONS, "ledger_types": [{"key": k, "label": v} for k, v in LEDGER_TYPES.items()]}

    @router.get("/investors")
    async def list_investors(request: Request):
        await require_role("admin")(request)
        invs = await db.investors.find({}).sort("name", 1).to_list(1000)
        out = []
        for inv in invs:
            out.append(_public(inv, await _entries(str(inv["_id"]))))
        return out

    @router.get("/investors/overview")
    async def overview(request: Request):
        await require_role("admin")(request)
        invs = await db.investors.find({}).to_list(1000)
        rows, tot = [], defaultdict(float)
        for inv in invs:
            entries = await _entries(str(inv["_id"]))
            m = _ledger_summary(inv, entries)
            for k in ("invested", "payouts", "capital_returned", "capital_in_business", "committed"):
                tot[k] += m[k]
            rows.append({**_public(inv), "money": m})
        recent = await db.investor_logins.find({}).sort("at", -1).to_list(15)
        names = {str(i["_id"]): i.get("name") for i in invs}
        by_month = defaultdict(lambda: {"invested": 0.0, "payouts": 0.0})
        for e in await db.investor_ledger.find({}).to_list(20000):
            k = (e.get("date") or "")[:7]
            if e.get("type") == "investment":
                by_month[k]["invested"] += _f(e.get("amount"))
            elif e.get("type") == "payout":
                by_month[k]["payouts"] += _f(e.get("amount"))
        flows = [{"month": k, "invested": round(v["invested"]), "payouts": round(v["payouts"])} for k, v in sorted(by_month.items()) if k]
        return {"totals": {**{k: round(v, 2) for k, v in tot.items()}, "investors": len(invs), "active": sum(1 for i in invs if i.get("active", True))},
                "rows": sorted(rows, key=lambda r: -r["money"]["invested"]), "flows": flows,
                "recent_logins": [{"investor_id": r.get("investor_id"), "name": names.get(r.get("investor_id"), "—"), "at": r.get("at")} for r in recent]}

    @router.get("/investors/business")
    async def business(request: Request, months: int = 12):
        await require_role("admin")(request)
        snap = await business_snapshot(db, max(0, min(months, 120)))
        return {**snap, "company": await _company(), "sections": {k: True for k in SECTION_KEYS if k != "investment"}}

    @router.post("/investors")
    async def create_investor(body: InvestorIn, request: Request):
        admin = await require_role("admin")(request)
        email = body.email.strip().lower()
        if not EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Enter a valid email address")
        if await db.investors.find_one({"email": email}) or await db.users.find_one({"email": email}):
            raise HTTPException(status_code=400, detail="That email already has a login. Use a different email for the investor.")
        if not body.password or len(body.password) < 8:
            raise HTTPException(status_code=400, detail="Give the investor a temporary password of at least 8 characters")
        now = _now().isoformat()
        doc = {"name": body.name.strip(), "email": email, "phone": (body.phone or "").strip() or None, "organisation": (body.organisation or "").strip() or None,
               "share_pct": body.share_pct, "committed_amount": body.committed_amount, "sections": _clean_sections(body.sections),
               "notes": body.notes, "active": body.active, "password_hash": hash_password(body.password), "password_version": 1,
               "must_reset_password": True, "created_at": now, "created_by": admin["id"], "login_count": 0}
        res = await db.investors.insert_one(doc)
        await create_audit_log(admin["id"], admin["name"], "create", "investor", str(res.inserted_id), details=f"Investor login for {doc['name']}")
        doc["_id"] = res.inserted_id
        return _public(doc, [])

    @router.put("/investors/{investor_id}")
    async def update_investor(investor_id: str, body: InvestorIn, request: Request):
        admin = await require_role("admin")(request)
        inv = await db.investors.find_one({"_id": _oid(investor_id)})
        if not inv:
            raise HTTPException(status_code=404, detail="Investor not found")
        email = body.email.strip().lower()
        if not EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Enter a valid email address")
        if email != inv.get("email") and (await db.investors.find_one({"email": email}) or await db.users.find_one({"email": email})):
            raise HTTPException(status_code=400, detail="That email already has a login")
        upd = {"name": body.name.strip(), "email": email, "phone": (body.phone or "").strip() or None, "organisation": (body.organisation or "").strip() or None,
               "share_pct": body.share_pct, "committed_amount": body.committed_amount, "sections": _clean_sections(body.sections, _sections(inv)),
               "notes": body.notes, "active": body.active, "updated_at": _now().isoformat()}
        changes = "details"
        if body.password:
            if len(body.password) < 8:
                raise HTTPException(status_code=400, detail="The new password needs at least 8 characters")
            upd.update({"password_hash": hash_password(body.password), "must_reset_password": True,
                        "password_version": int(inv.get("password_version") or 1) + 1})
            changes = "details and password"
        if not body.active and inv.get("active", True):
            upd["password_version"] = int(upd.get("password_version") or inv.get("password_version") or 1) + 1  # signs them out
        await db.investors.update_one({"_id": inv["_id"]}, {"$set": upd})
        await create_audit_log(admin["id"], admin["name"], "update", "investor", investor_id, details=f"Updated {changes} for {upd['name']}")
        inv = await db.investors.find_one({"_id": inv["_id"]})
        return _public(inv, await _entries(investor_id))

    @router.delete("/investors/{investor_id}")
    async def delete_investor(investor_id: str, request: Request):
        admin = await require_role("admin")(request)
        inv = await db.investors.find_one({"_id": _oid(investor_id)})
        if not inv:
            raise HTTPException(status_code=404, detail="Investor not found")
        n = await db.investor_ledger.count_documents({"investor_id": investor_id})
        await db.investors.delete_one({"_id": inv["_id"]})
        await db.investor_ledger.delete_many({"investor_id": investor_id})
        await create_audit_log(admin["id"], admin["name"], "delete", "investor", investor_id, details=f"Removed investor {inv.get('name')} and {n} money entries")
        return {"message": "Investor removed"}

    @router.get("/investors/{investor_id}/ledger")
    async def ledger(investor_id: str, request: Request):
        await require_role("admin")(request)
        inv = await db.investors.find_one({"_id": _oid(investor_id)})
        if not inv:
            raise HTTPException(status_code=404, detail="Investor not found")
        entries = await _entries(investor_id)
        return {"summary": _ledger_summary(inv, entries), "entries": [_entry_out(e) for e in entries]}

    @router.post("/investors/{investor_id}/ledger")
    async def add_entry(investor_id: str, body: LedgerIn, request: Request):
        admin = await require_role("admin")(request)
        inv = await db.investors.find_one({"_id": _oid(investor_id)})
        if not inv:
            raise HTTPException(status_code=404, detail="Investor not found")
        if body.type not in LEDGER_TYPES:
            raise HTTPException(status_code=400, detail="Type must be money in, payout or capital returned")
        try:
            d = date.fromisoformat(body.date[:10])
        except ValueError:
            raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD")
        doc = {"investor_id": investor_id, "type": body.type, "amount": round(body.amount, 2), "date": d.isoformat(), "mode": body.mode,
               "reference": body.reference, "note": body.note, "created_at": _now().isoformat(), "created_by": admin["id"], "created_by_name": admin["name"]}
        res = await db.investor_ledger.insert_one(doc)
        await create_audit_log(admin["id"], admin["name"], "create", "investor_ledger", str(res.inserted_id),
                               details=f"{LEDGER_TYPES[body.type]} ₹{body.amount:,.0f} for {inv.get('name')} on {d.isoformat()}")
        doc["_id"] = res.inserted_id
        return _entry_out(doc)

    @router.delete("/investors/{investor_id}/ledger/{entry_id}")
    async def delete_entry(investor_id: str, entry_id: str, request: Request):
        admin = await require_role("admin")(request)
        e = await db.investor_ledger.find_one({"_id": _oid(entry_id, "entry"), "investor_id": investor_id})
        if not e:
            raise HTTPException(status_code=404, detail="Entry not found")
        await db.investor_ledger.delete_one({"_id": e["_id"]})
        await create_audit_log(admin["id"], admin["name"], "delete", "investor_ledger", entry_id,
                               details=f"Removed {LEDGER_TYPES.get(e.get('type'), e.get('type'))} ₹{_f(e.get('amount')):,.0f} dated {e.get('date')}")
        return {"message": "Entry removed"}

    @router.get("/investors/{investor_id}/preview")
    async def preview(investor_id: str, request: Request, months: int = 12):
        await require_role("admin")(request)
        inv = await db.investors.find_one({"_id": _oid(investor_id)})
        if not inv:
            raise HTTPException(status_code=404, detail="Investor not found")
        return await _view_for(inv, max(0, min(months, 120)))

    @router.get("/investors/{investor_id}/activity")
    async def activity(investor_id: str, request: Request):
        await require_role("admin")(request)
        rows = await db.investor_logins.find({"investor_id": investor_id}).sort("at", -1).to_list(50)
        return [{"at": r.get("at"), "ip": r.get("ip")} for r in rows]

    # ═════════════ investor's own session ═════════════
    def _token(inv) -> str:
        exp = _now() + timedelta(hours=SESSION_HOURS)
        return jwt.encode({"sub": str(inv["_id"]), "type": "investor", "pv": int(inv.get("password_version") or 1), "exp": exp}, jwt_secret, algorithm="HS256")

    async def _me(request: Request) -> Dict[str, Any]:
        raw = request.cookies.get(COOKIE)
        if not raw:
            raise HTTPException(status_code=401, detail="Please sign in")
        try:
            data = jwt.decode(raw, jwt_secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Please sign in again")
        if data.get("type") != "investor":
            raise HTTPException(status_code=401, detail="Please sign in")
        inv = await db.investors.find_one({"_id": _oid(data.get("sub"))})
        if not inv or not inv.get("active", True) or int(inv.get("password_version") or 1) != int(data.get("pv") or 0):
            raise HTTPException(status_code=401, detail="Please sign in again")
        return inv

    def _client_ip(request: Request) -> str:
        fwd = request.headers.get("x-forwarded-for", "")
        return (fwd.split(",")[0].strip() if fwd else "") or (request.client.host if request.client else "")

    @router.post("/investor/auth/login")
    async def investor_login(body: InvestorLogin, request: Request, response: Response):
        email = (body.email or "").strip().lower()
        ip = _client_ip(request)
        since = _now() - timedelta(minutes=TRY_WINDOW_MIN)
        tries = await db.investor_login_attempts.count_documents({"email": email, "at": {"$gte": since}})
        if tries >= MAX_TRIES:
            raise HTTPException(status_code=429, detail="Too many tries. Please wait 15 minutes and try again.")
        inv = await db.investors.find_one({"email": email})
        if not inv or not inv.get("active", True) or not verify_password(body.password or "", inv.get("password_hash") or ""):
            await db.investor_login_attempts.insert_one({"email": email, "ip": ip, "at": _now()})
            raise HTTPException(status_code=401, detail="Invalid email or password")
        await db.investor_login_attempts.delete_many({"email": email})
        now = _now().isoformat()
        await db.investors.update_one({"_id": inv["_id"]}, {"$set": {"last_login_at": now}, "$inc": {"login_count": 1}})
        await db.investor_logins.insert_one({"investor_id": str(inv["_id"]), "at": now, "ip": ip})
        response.set_cookie(COOKIE, _token(inv), max_age=SESSION_HOURS * 3600, httponly=True, samesite="lax", path=COOKIE_PATH)
        return {"name": inv.get("name"), "must_reset_password": bool(inv.get("must_reset_password"))}

    @router.post("/investor/auth/logout")
    async def investor_logout(response: Response):
        response.delete_cookie(COOKIE, path=COOKIE_PATH)
        return {"message": "Signed out"}

    @router.get("/investor/me")
    async def investor_me(request: Request):
        inv = await _me(request)
        return {"name": inv.get("name"), "email": inv.get("email"), "organisation": inv.get("organisation"),
                "must_reset_password": bool(inv.get("must_reset_password")), "sections": _sections(inv), "company": await _company()}

    @router.post("/investor/auth/change-password")
    async def investor_change_password(body: PasswordChange, request: Request, response: Response):
        inv = await _me(request)
        if not verify_password(body.current_password, inv.get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="Your current password is not right")
        if body.current_password == body.new_password:
            raise HTTPException(status_code=400, detail="Choose a new password that is different from the old one")
        pv = int(inv.get("password_version") or 1) + 1
        await db.investors.update_one({"_id": inv["_id"]}, {"$set": {"password_hash": hash_password(body.new_password), "must_reset_password": False,
                                                                    "password_version": pv, "password_changed_at": _now().isoformat()}})
        inv["password_version"] = pv
        response.set_cookie(COOKIE, _token(inv), max_age=SESSION_HOURS * 3600, httponly=True, samesite="lax", path=COOKIE_PATH)
        return {"message": "Password changed"}

    @router.get("/investor/dashboard")
    async def investor_dashboard(request: Request, months: int = 12):
        inv = await _me(request)
        return await _view_for(inv, max(0, min(months, 120)))

    return router
