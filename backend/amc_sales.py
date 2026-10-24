"""AMC offers, AMC quotes, the AMC company (letterhead) and the AMC report — Sensoper only.

* Offers — once a customer's plant is N years old (Settings, default 3) and it has no active AMC, it shows
  up as "time to offer AMC" on the AMC page, on Home and in the bell.
* Quotes — Basic / Standard / Premium priced per kW per year (Settings); each quote shows how the plan
  protects generation and life, and can be turned into a contract once the customer says yes.
* Report — contracts, visits, renewals, offers and quotes for a period.

The joint-venture partner idea (Oct 2026) was removed: `remove_joint_venture()` erases its data once.
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from pymongo import ReturnDocument

DEFAULT_PLANS = [
    {"key": "basic", "name": "Basic", "rate_per_kw": 500, "min_per_year": 2000, "visits_per_year": 2, "response_hours": 72,
     "recovers_pct": 55, "includes": ["2 panel cleanings a year", "Inverter and wiring health check", "Earthing test", "Generation check against expected"]},
    {"key": "standard", "name": "Standard", "rate_per_kw": 750, "min_per_year": 3000, "visits_per_year": 4, "response_hours": 48,
     "recovers_pct": 75, "includes": ["4 panel cleanings a year", "Everything in Basic", "Torque check of structure and clamps",
                                      "Thermal scan for hot spots", "Warranty claims handled for you"]},
    {"key": "premium", "name": "Premium", "rate_per_kw": 1100, "min_per_year": 4500, "visits_per_year": 6, "response_hours": 24,
     "recovers_pct": 90, "includes": ["6 panel cleanings a year", "Everything in Standard", "Remote monitoring with monthly report",
                                      "Priority 24-hour breakdown visit", "Free labour on repairs and part swaps"]},
]

DEFAULT_SETTINGS: Dict[str, Any] = {
    "offer_after_years": 3,          # offer AMC this long after commissioning (free service usually ends here)
    "offer_lead_days": 30,           # start showing the offer this many days before that date
    "snooze_days": 90,               # "Ask later" hides an offer for this long
    "gst_pct": 18,
    "quote_valid_days": 30,
    "units_per_kw_year": 1450,       # kWh a kW of panels makes in a year
    "default_tariff": 8,             # ₹ per unit when the project has none
    "loss_without_amc_pct": 12,      # dust, loose joints, undetected faults on an unmaintained plant
    "life_without_amc_years": 18,
    "life_with_amc_years": 25,
    "brand_company_id": None,        # company profile whose name, logo and details go on every AMC quote and report
    "plans": DEFAULT_PLANS,
}

# Used on a quote when there is no active AMC template in Terms & conditions.
DEFAULT_TERMS = """1. The plan runs for 12 months from the start date and can be renewed at the then current rate.
2. The yearly fee is payable in advance. GST is extra as shown on the quote.
3. Visits are planned with the customer; a missed visit because the site was closed counts as done.
4. Spare parts, panels, inverters and batteries are not included unless the plan says so; warranty claims are handled with the maker.
5. Damage from storms, lightning, floods, fire, theft, rodents or changes by others is not covered.
6. Breakdown response times are counted on working days from the time the customer reports the problem.
7. The generation figures are estimates; real generation depends on weather, shade and use.
8. Either side may end the plan with 30 days' written notice; fees for completed visits are not refunded."""

SYSTEM_TYPES = {"on-grid", "off-grid", "hybrid", "solar-pump", "others"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _f(v, d: float = 0.0) -> float:
    try:
        x = float(v)
        return x if math.isfinite(x) else d
    except (TypeError, ValueError):
        return d


def _oid(v: str) -> ObjectId:
    if not v or not ObjectId.is_valid(str(v)):
        raise HTTPException(status_code=404, detail="Not found")
    return ObjectId(str(v))


def _ser(d: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d


def html_to_text(html: Optional[str]) -> str:
    """Terms templates are stored as HTML; the AMC quote prints plain lines. Pure."""
    import html as _html
    t = str(html or "")
    t = re.sub(r"(?i)<\s*br\s*/?>", "\n", t)
    t = re.sub(r"(?i)<\s*li[^>]*>", "\n• ", t)
    t = re.sub(r"(?i)</\s*(p|div|li|h[1-6]|tr|ul|ol)\s*>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = _html.unescape(t).replace("\r", "")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in t.split("\n")]
    out, blank = [], False
    for ln in lines:
        if not ln:
            blank = bool(out)
            continue
        if blank and not ln.startswith("•"):
            out.append("")
        out.append(ln)
        blank = False
    return "\n".join(out).strip()


def merge_settings(stored: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = {**DEFAULT_SETTINGS, **{k: v for k, v in (stored or {}).items() if k in DEFAULT_SETTINGS and v is not None}}
    plans = []
    by_key = {p["key"]: p for p in (stored or {}).get("plans") or [] if isinstance(p, dict)}
    for base in DEFAULT_PLANS:
        p = {**base, **{k: v for k, v in by_key.get(base["key"], {}).items() if k in base and v is not None}}
        plans.append(p)
    out["plans"] = plans
    return out


def clean_settings(body: Dict[str, Any]) -> Dict[str, Any]:
    """Validate what an admin typed in AMC settings."""
    s = merge_settings(body)
    def rng(key, lo, hi, cast=float):
        v = cast(_f(s[key], DEFAULT_SETTINGS[key]))
        if not (lo <= v <= hi):
            raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ').capitalize()} must be between {lo} and {hi}")
        s[key] = v
    rng("offer_after_years", 0.5, 25)
    rng("offer_lead_days", 0, 365, int)
    rng("snooze_days", 1, 730, int)
    rng("gst_pct", 0, 28)
    rng("quote_valid_days", 1, 365, int)
    rng("units_per_kw_year", 500, 2500)
    rng("default_tariff", 1, 50)
    rng("loss_without_amc_pct", 0, 50)
    rng("life_without_amc_years", 5, 40)
    rng("life_with_amc_years", 5, 40)
    bid = s.get("brand_company_id")
    s["brand_company_id"] = str(bid) if bid and ObjectId.is_valid(str(bid)) else None
    for p in s["plans"]:
        p["name"] = (str(p.get("name") or "").strip() or p["key"].capitalize())[:40]
        for key, lo, hi in (("rate_per_kw", 0, 100000), ("min_per_year", 0, 10000000), ("recovers_pct", 0, 100)):
            v = _f(p.get(key), -1)
            if not (lo <= v <= hi):
                raise HTTPException(status_code=400, detail=f"{p['name']}: {key.replace('_', ' ')} must be between {lo} and {hi}")
            p[key] = v
        for key, lo, hi in (("visits_per_year", 1, 52), ("response_hours", 1, 720)):
            v = int(_f(p.get(key), -1))
            if not (lo <= v <= hi):
                raise HTTPException(status_code=400, detail=f"{p['name']}: {key.replace('_', ' ')} must be between {lo} and {hi}")
            p[key] = v
        p["includes"] = [str(x).strip()[:120] for x in (p.get("includes") or []) if str(x).strip()][:12]
    return s


def quote_plans(kw: float, settings: Dict[str, Any], tariff: Optional[float] = None) -> Dict[str, Any]:
    """Price the three plans for a plant of `kw` and show what each one protects. Pure.

    generation        = kW × units per kW per year
    at risk           = generation × loss without AMC %          (dust, loose joints, faults found late)
    plan protects     = at risk × plan's recovers %              → ₹ at the customer's tariff
    plan price / year = max(kW × rate per kW, plan minimum); GST on top
    extra life        = (life with care − life without) years of generation at today's tariff
    """
    kw = max(_f(kw), 0.0)
    tariff = _f(tariff) or _f(settings.get("default_tariff"), 8) or 8
    gst = _f(settings.get("gst_pct"), 18)
    gen = kw * _f(settings.get("units_per_kw_year"), 1450)
    at_risk = gen * _f(settings.get("loss_without_amc_pct"), 12) / 100
    life_wo, life_w = _f(settings.get("life_without_amc_years"), 18), _f(settings.get("life_with_amc_years"), 25)
    plans = []
    for p in settings.get("plans") or DEFAULT_PLANS:
        price = round(max(kw * _f(p.get("rate_per_kw")), _f(p.get("min_per_year")))) if kw > 0 else 0
        saved_units = at_risk * _f(p.get("recovers_pct")) / 100
        saved_value = round(saved_units * tariff)
        plans.append({
            "key": p["key"], "name": p["name"], "rate_per_kw": _f(p.get("rate_per_kw")), "visits_per_year": int(_f(p.get("visits_per_year"), 2)),
            "response_hours": int(_f(p.get("response_hours"), 48)), "includes": list(p.get("includes") or []),
            "price": price, "gst_pct": gst, "gst": round(price * gst / 100), "total": round(price * (1 + gst / 100)),
            "per_month": round(price * (1 + gst / 100) / 12),
            "units_protected": round(saved_units), "value_protected": saved_value,
            "return_per_rupee": round(saved_value / price, 2) if price else None,
            "recovers_pct": _f(p.get("recovers_pct")),
        })
    extra = max(round(life_w - life_wo, 1), 0)
    return {"kw": kw, "tariff": tariff, "annual_generation": round(gen), "units_at_risk": round(at_risk),
            "value_at_risk": round(at_risk * tariff), "life_without_years": life_wo, "life_with_years": life_w,
            "extra_years": extra, "extra_life_units": round(gen * extra), "extra_life_value": round(gen * extra * tariff), "plans": plans}


def _to_date(v) -> Optional[date]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except ValueError:
        return None


def add_years(d: date, years: float) -> date:
    whole = int(years)
    try:
        out = d.replace(year=d.year + whole)
    except ValueError:  # 29 Feb
        out = d.replace(year=d.year + whole, day=28)
    return out + timedelta(days=round((years - whole) * 365))


def offer_due_date(commissioned: Optional[date], settings: Dict[str, Any]) -> Optional[date]:
    return add_years(commissioned, _f(settings.get("offer_after_years"), 3)) if commissioned else None


def offer_state(commissioned: Optional[date], today: date, settings: Dict[str, Any], dismissed_until: Optional[str] = None) -> Optional[str]:
    """'due' (on or after the date), 'soon' (within the lead window), or None (not yet / snoozed). Pure."""
    due = offer_due_date(commissioned, settings)
    if not due:
        return None
    if dismissed_until and str(dismissed_until)[:10] > today.isoformat():
        return None
    if today >= due:
        return "due"
    if (due - today).days <= int(_f(settings.get("offer_lead_days"), 30)):
        return "soon"
    return None


def month_keys(start: date, end: date) -> List[str]:
    keys, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        keys.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return keys


# ───────────────────────── request bodies ─────────────────────────
class QuoteIn(BaseModel):
    source_type: str = "manual"          # project | manual
    source_id: Optional[str] = None
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    site_address: Optional[str] = None
    district: Optional[str] = None
    system_type: Optional[str] = None
    system_type_other: Optional[str] = None
    system_capacity_kw: Optional[float] = None
    commissioning_date: Optional[str] = None
    tariff: Optional[float] = None
    recommended_plan: Optional[str] = "standard"
    notes: Optional[str] = None
    terms_text: Optional[str] = None                 # printed on the quote; empty → the active AMC terms template


class PreviewIn(BaseModel):
    system_capacity_kw: float = 0
    tariff: Optional[float] = None


class QuoteStatusIn(BaseModel):
    status: str                          # sent | declined | draft
    reason: Optional[str] = None


class AcceptIn(BaseModel):
    plan_key: str
    start_date: Optional[str] = None
    duration_months: int = 12


class DismissIn(BaseModel):
    action: str = "later"                # later | not_interested | reopen
    reason: Optional[str] = None



# ───────────────────────── one-time removal of the joint venture ─────────────────────────
JV_REMOVED = "jv_removed_v1"


async def remove_joint_venture(db, delete_file: Optional[Callable[[str], None]] = None) -> Optional[Dict[str, int]]:
    """Erase everything the joint-venture partner feature saved: partner companies, their logins, partner projects,
    partner AMC contracts with their visits and reminders, partner quotes and offer flags. Runs once (flag in
    `migrations`); returns the counts, or None when it already ran. Sensoper's own AMC records are untouched."""
    if await db.migrations.find_one({"_id": JV_REMOVED}):
        return None
    theirs = {"org_id": {"$exists": True, "$nin": [None, ""]}}          # a partner company's record (ours never carry one)
    contract_ids = [str(c["_id"]) async for c in db.amc_contracts.find(theirs, {"_id": 1})]
    files: List[str] = []
    async for p in db.jv_partners.find({}, {"logo_path": 1}):
        if p.get("logo_path"):
            files.append(p["logo_path"])
    async for j in db.jv_projects.find({}, {"photos": 1}):
        files.extend([x for x in (j.get("photos") or []) if isinstance(x, str)])
    counts = {
        "visits": (await db.amc_service_visits.delete_many({"contract_id": {"$in": contract_ids}})).deleted_count,
        "reminders": (await db.notifications.delete_many({"$or": [{"contract_id": {"$in": contract_ids}},
                                                                  {"source_type": "jv_project"}]})).deleted_count,
        "contracts": (await db.amc_contracts.delete_many({"_id": {"$in": [ObjectId(i) for i in contract_ids]}})).deleted_count,
        "quotes": (await db.amc_quotes.delete_many({"$or": [theirs, {"source_type": "jv_project"}]})).deleted_count,
        "offer_flags": (await db.amc_offer_flags.delete_many({"source_type": "jv_project"})).deleted_count,
        "projects": (await db.jv_projects.delete_many({})).deleted_count,
        "partners": (await db.jv_partners.delete_many({})).deleted_count,
        "logins": (await db.users.delete_many({"role": "partner"})).deleted_count,
    }
    for coll in (db.amc_contracts, db.amc_quotes):   # what's left is ours: drop the company markers
        await coll.update_many({"$or": [{"org_id": {"$exists": True}}, {"jv_project_id": {"$exists": True}}]}, {"$unset": {"org_id": "", "jv_project_id": ""}})
    # links that pointed at a removed contract
    await db.amc_contracts.update_many({"previous_contract_id": {"$in": contract_ids}}, {"$set": {"previous_contract_id": None}})
    await db.support_tickets.update_many({"amc_contract_id": {"$in": contract_ids}}, {"$set": {"amc_contract_id": None}})
    await db.users.update_many({"partner_id": {"$exists": True}}, {"$unset": {"partner_id": ""}})
    await db.role_permissions.delete_many({"role_name": "partner"})
    await db.sync_state.delete_many({"_id": {"$in": ["jv", "jv_projects"]}})
    for coll in ("jv_partners", "jv_projects"):
        try:
            await db.drop_collection(coll)
        except Exception:
            pass
    removed_files = 0
    if delete_file:
        for path in files:
            try:
                delete_file(path)
                removed_files += 1
            except Exception:
                pass
    counts["files"] = removed_files
    now = _now().isoformat()
    await db.migrations.update_one({"_id": JV_REMOVED}, {"$set": {"at": now, **counts}}, upsert=True)
    await db.audit_logs.insert_one({"user_id": "system", "user_name": "System", "action_type": "joint_venture_removed", "entity_type": "amc",
                                    "entity_id": "joint_venture", "old_value": None, "new_value": counts, "timestamp": now,
                                    "details": "Joint venture removed — partner companies, logins, projects, contracts and quotes erased"})
    return counts


def create_router(db, get_current_user, require_role, create_audit_log, role_ok):
    router = APIRouter()

    async def _seq(key: str) -> int:
        doc = await db.counters.find_one_and_update({"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
        return doc["seq"]

    async def settings() -> Dict[str, Any]:
        doc = await db.amc_settings.find_one({"key": "defaults"}) or {}
        return merge_settings(doc)

    async def _editor(request: Request) -> Dict[str, Any]:
        """Admin / manager (or anyone the Permissions page opened AMC editing to)."""
        user = await get_current_user(request)
        if not role_ok(request, user, "admin", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    async def _admin(request: Request) -> Dict[str, Any]:
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can change this")
        return user

    async def _contract_from_source(src: Dict[str, Any], plan: Optional[Dict[str, Any]], start_date: str,
                                    duration_months: int, user: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
        from amc import _end_date, _next_billing
        now_iso = _now().isoformat()
        seq = await _seq("amc_contract_number")
        visits = int((plan or {}).get("visits_per_year") or 2)
        doc = {
            "project_id": src.get("project_id"), "customer_id": None, "customer_name": src.get("customer_name") or "Customer", "contact": src.get("phone"),
            "site_address": src.get("site_address"), "district": src.get("district"), "state": src.get("state"), "location_id": src.get("location_id"),
            "system_type": src.get("system_type") or "on-grid", "system_type_other": src.get("system_type_other"),
            "system_capacity_kw": _f(src.get("system_capacity_kw")), "pump_hp": src.get("pump_hp"), "notes": src.get("notes"),
            "commissioning_date": src.get("commissioning_date"), "contract_type": "comprehensive", "plan_key": (plan or {}).get("key"),
            "plan_name": (plan or {}).get("name"), "start_date": start_date, "end_date": _end_date(start_date, duration_months),
            "duration_months": duration_months, "annual_value": _f((plan or {}).get("price")), "billing_frequency": "annual",
            "next_billing_date": _next_billing(start_date, "annual"), "auto_renew": False, "renewal_notice_days": 30,
            "visits_per_year": visits, "visits_completed": 0, "visits_remaining": visits, "service_schedule": [],
            "inclusions": list((plan or {}).get("includes") or ["Panel cleaning", "Inverter health check", "Earthing test"]), "exclusions": [],
            "response_time_hours": (plan or {}).get("response_hours") or 48, "uptime_guarantee_pct": 95,
            "contract_number": f"AMC-{seq:04d}", "status": "active", "total_billed": 0, "total_collected": 0, "outstanding": 0,
            "renewal_status": None, "previous_contract_id": None, "created_at": now_iso, "updated_at": now_iso, "created_by": user["name"], **extra,
        }
        res = await db.amc_contracts.insert_one(doc)
        return {**doc, "_id": res.inserted_id}

    # ═══════════════ the company on AMC documents ═══════════════
    async def brand_profile() -> Dict[str, Any]:
        """The company profile chosen in AMC settings (else the active one) — letterhead for every AMC quote and report."""
        s = await settings()
        cp = None
        if s.get("brand_company_id"):
            cp = await db.company_profiles.find_one({"_id": ObjectId(s["brand_company_id"])})
        cp = cp or await db.company_profiles.find_one({"is_active": True}) or await db.company_profiles.find_one({}, sort=[("created_at", 1)]) or {}
        keys = ("company_name", "tagline", "logo_url", "address", "phone", "email", "website", "gst_number", "state",
                "primary_color", "secondary_color", "authorized_signatory", "designation", "sales_contact_phone")
        out = {k: cp.get(k) for k in keys}
        out["id"] = str(cp["_id"]) if cp.get("_id") else None
        out["company_name"] = out.get("company_name") or "Sensoper Controls & Renewables"
        out["chosen"] = bool(s.get("brand_company_id")) and out["id"] == s.get("brand_company_id")
        return out

    router.brand_profile = brand_profile

    @router.get("/amc/brand")
    async def brand(request: Request):
        await get_current_user(request)
        b = await brand_profile()
        logo = b.get("logo_url") or ""
        b["logo_base64"] = logo if logo.startswith("data:") else None
        if logo and not b["logo_base64"] and logo.startswith("https://"):
            try:
                import base64
                import httpx
                async with httpx.AsyncClient(timeout=6) as c:
                    r = await c.get(logo)
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/") and len(r.content) < 3 * 1024 * 1024:
                    b["logo_base64"] = f"data:{r.headers['content-type'].split(';')[0]};base64,{base64.b64encode(r.content).decode()}"
            except Exception:
                pass
        return b

    # ═══════════════ settings ═══════════════
    @router.get("/amc/settings")
    async def get_settings(request: Request):
        await get_current_user(request)
        return await settings()

    @router.put("/amc/settings")
    async def put_settings(request: Request):
        user = await _admin(request)
        s = clean_settings(await request.json())
        if s.get("brand_company_id") and not await db.company_profiles.find_one({"_id": ObjectId(s["brand_company_id"])}, {"_id": 1}):
            raise HTTPException(status_code=400, detail="That company profile no longer exists")
        await db.amc_settings.update_one({"key": "defaults"}, {"$set": {**s, "key": "defaults", "updated_at": _now().isoformat(), "updated_by": user["name"]}}, upsert=True)
        await create_audit_log(user["id"], user["name"], "amc_settings_updated", "amc_settings", "defaults", None,
                               {"offer_after_years": s["offer_after_years"], "rates": {p["key"]: p["rate_per_kw"] for p in s["plans"]}})
        return s

    # ═══════════════ offers: plants old enough for an AMC ═══════════════
    async def offer_rows(include_upcoming: bool = True) -> List[Dict[str, Any]]:
        s = await settings()
        today = _now().date()
        covered = {c.get("project_id") async for c in db.amc_contracts.find({"status": "active", "project_id": {"$ne": None}}, {"project_id": 1})}
        dismiss = {(d["source_type"], d["source_id"]): d async for d in db.amc_offer_flags.find({})}
        quotes: Dict[Tuple[str, str], Dict[str, Any]] = {}
        async for qd in db.amc_quotes.find({"source_id": {"$ne": None}}).sort("created_at", 1):
            quotes[(qd.get("source_type"), qd.get("source_id"))] = qd
        rows: List[Dict[str, Any]] = []
        async for p in db.projects.find({"status": "completed", "deleted_at": {"$exists": False}},
                                        {"customer": 1, "commissioning_date": 1, "completed_at": 1, "installation_date": 1, "location": 1,
                                         "custom_fields.proposed_solution.system_size_kw": 1, "custom_fields.proposed_solution.system_type": 1,
                                         "reference_number": 1, "electrical.eb_tariff": 1}):
            pid = str(p["_id"])
            if pid in covered:
                continue
            flag = dismiss.get(("project", pid)) or {}
            if flag.get("action") == "not_interested":
                continue
            commissioned = _to_date(p.get("commissioning_date")) or _to_date(p.get("completed_at")) or _to_date(p.get("installation_date"))
            state = offer_state(commissioned, today, s, flag.get("until"))
            if not state or (state == "soon" and not include_upcoming):
                continue
            due = offer_due_date(commissioned, s)
            ps = ((p.get("custom_fields") or {}).get("proposed_solution") or {})
            cust = p.get("customer") or {}
            q = quotes.get(("project", pid))
            rows.append({"source_type": "project", "source_id": pid, "customer_name": cust.get("name"), "phone": cust.get("phone"),
                         "system_capacity_kw": round(_f(ps.get("system_size_kw")), 2), "system_type": ps.get("system_type") or "on-grid",
                         "district": (p.get("location") or {}).get("district"), "commissioned_on": commissioned.isoformat(), "due_on": due.isoformat(),
                         "state": state, "years": round((today - commissioned).days / 365.25, 1), "days_overdue": max((today - due).days, 0),
                         "quote": {"id": str(q["_id"]), "number": q.get("quote_number"), "status": q.get("status")} if q else None,
                         "reference_number": p.get("reference_number")})
        rows.sort(key=lambda r: (r["state"] != "due", r["due_on"]))
        return rows

    @router.get("/amc/offers")
    async def offers(request: Request, include_upcoming: bool = True):
        await get_current_user(request)
        rows = await offer_rows(include_upcoming)
        s = await settings()
        return {"rows": rows, "due": sum(1 for r in rows if r["state"] == "due"), "soon": sum(1 for r in rows if r["state"] == "soon"),
                "offer_after_years": s["offer_after_years"], "offer_lead_days": s["offer_lead_days"]}

    @router.post("/amc/offers/{source_type}/{source_id}")
    async def flag_offer(source_type: str, source_id: str, body: DismissIn, request: Request):
        """'Ask later' (snooze), 'Not interested' (stop), or 'reopen'."""
        user = await _editor(request)
        if source_type != "project":
            raise HTTPException(status_code=400, detail="Unknown source")
        if not await db.projects.find_one({"_id": _oid(source_id)}, {"_id": 1}):
            raise HTTPException(status_code=404, detail="Project not found")
        if body.action == "reopen":
            await db.amc_offer_flags.delete_one({"source_type": source_type, "source_id": source_id})
        elif body.action in ("later", "not_interested"):
            s = await settings()
            until = (_now().date() + timedelta(days=int(s["snooze_days"]))).isoformat() if body.action == "later" else None
            await db.amc_offer_flags.update_one({"source_type": source_type, "source_id": source_id},
                                                {"$set": {"action": body.action, "until": until, "reason": body.reason, "by": user["name"], "at": _now().isoformat()}}, upsert=True)
            await _resolve_offer_notes(source_type, source_id)
        else:
            raise HTTPException(status_code=400, detail="Unknown action")
        await create_audit_log(user["id"], user["name"], f"amc_offer_{body.action}", source_type, source_id, None, {"reason": body.reason})
        return {"ok": True}

    async def _resolve_offer_notes(source_type: str, source_id: str) -> None:
        await db.notifications.update_many({"kind": "amc_offer", "source_type": source_type, "source_id": source_id, "status": "pending"},
                                           {"$set": {"status": "resolved", "resolved_at": _now().isoformat()}})

    async def sync_offer_notifications() -> int:
        """Bell: one in-app note per admin / manager when a customer's plant reaches the AMC offer date."""
        rows = [r for r in await offer_rows(include_upcoming=False) if not r.get("quote")]
        people = [str(u["_id"]) async for u in db.users.find({"role": {"$in": ["admin", "manager"]}, "active": {"$ne": False}}, {"_id": 1})]
        now = _now().isoformat()
        made = 0
        for r in rows:
            for uid in people:
                key = {"kind": "amc_offer", "source_type": r["source_type"], "source_id": r["source_id"], "user_id": uid}
                if await db.notifications.find_one(key, {"_id": 1}):
                    continue
                await db.notifications.insert_one({**key, "channel": "in_app", "audience": "staff", "status": "pending", "notify_at": now, "created_at": now,
                                                   "created_by": "system", "link": "/dashboard/amc?tab=offers",
                                                   "title": f"Time to offer AMC: {r['customer_name']}",
                                                   "message": f"{r['system_capacity_kw']} kW · commissioned {r['commissioned_on']} ({r['years']} years ago)"})
                made += 1
        return made

    router.sync_offer_notifications = sync_offer_notifications
    router.offer_rows = offer_rows

    @router.get("/amc/offers/count")
    async def offers_count(request: Request):
        await get_current_user(request)
        rows = await offer_rows(include_upcoming=False)
        return {"due": len(rows), "without_quote": sum(1 for r in rows if not r.get("quote"))}

    # ═══════════════ quotes ═══════════════
    @router.post("/amc/quotes/preview")
    async def preview(body: PreviewIn, request: Request):
        await get_current_user(request)
        return quote_plans(body.system_capacity_kw, await settings(), body.tariff)

    async def default_terms() -> str:
        t = await db.terms_conditions.find_one({"category": "amc", "is_active": True}, sort=[("version", -1)])
        return html_to_text(t.get("content")) if t else DEFAULT_TERMS

    @router.get("/amc/quotes/terms")
    async def quote_terms(request: Request):
        """Terms for the quote builder: the AMC templates from Terms & conditions and the default text."""
        await get_current_user(request)
        templates = [{"id": str(t["_id"]), "title": t.get("title"), "is_active": t.get("is_active", False), "text": html_to_text(t.get("content"))}
                     async for t in db.terms_conditions.find({"category": "amc"}).sort("version", -1).limit(20)]
        return {"default_text": await default_terms(), "templates": templates}

    async def _source(body: QuoteIn) -> Dict[str, Any]:
        """Fill customer / plant details from the project the quote is for."""
        if body.source_type == "project":
            p = await db.projects.find_one({"_id": _oid(body.source_id), "deleted_at": {"$exists": False}})
            if not p:
                raise HTTPException(status_code=404, detail="Project not found")
            ps = ((p.get("custom_fields") or {}).get("proposed_solution") or {})
            cust, loc = p.get("customer") or {}, p.get("location") or {}
            commissioned = _to_date(p.get("commissioning_date")) or _to_date(p.get("completed_at"))
            return {"customer_name": cust.get("name"), "phone": cust.get("phone"), "site_address": cust.get("address") or loc.get("address"),
                    "district": loc.get("district"), "state": loc.get("state"), "system_type": ps.get("system_type") or "on-grid",
                    "system_capacity_kw": _f(ps.get("system_size_kw")), "commissioning_date": commissioned.isoformat() if commissioned else None,
                    "tariff": _f(ps.get("tariff_per_unit")) or _f((p.get("electrical") or {}).get("eb_tariff")) or None,
                    "project_id": str(p["_id"]), "reference_number": p.get("reference_number"), "location_id": p.get("location_id")}
        if body.source_type != "manual":
            raise HTTPException(status_code=400, detail="Unknown source")
        return {}

    @router.post("/amc/quotes")
    async def create_quote(body: QuoteIn, request: Request):
        user = await _editor(request)
        src = await _source(body)
        typed = {k: v for k, v in body.model_dump().items() if v not in (None, "") and k in
                 ("customer_name", "phone", "site_address", "district", "system_type", "system_capacity_kw", "commissioning_date", "tariff")}
        info = {**src, **typed}
        if not (info.get("customer_name") or "").strip():
            raise HTTPException(status_code=400, detail="Enter the customer's name")
        kw = _f(info.get("system_capacity_kw"))
        if kw <= 0:
            raise HTTPException(status_code=400, detail="Enter the plant size in kW")
        if (info.get("system_type") or "on-grid") not in SYSTEM_TYPES:
            raise HTTPException(status_code=400, detail="Unknown system type")
        terms = (body.terms_text or "").strip()[:6000] or await default_terms()
        s = await settings()
        calc = quote_plans(kw, s, info.get("tariff"))
        seq = await _seq("amc_quote_number")
        today = _now().date()
        doc = {"quote_number": f"AMCQ-{seq:04d}", "source_type": body.source_type, "source_id": body.source_id if body.source_type != "manual" else None,
               "customer_name": info["customer_name"].strip(), "phone": info.get("phone"), "site_address": info.get("site_address"),
               "district": info.get("district"), "state": info.get("state"), "system_type": info.get("system_type") or "on-grid", "system_capacity_kw": kw,
               "system_type_other": (body.system_type_other or "").strip()[:80] or None, "terms_text": terms,
               "commissioning_date": info.get("commissioning_date"), "tariff": calc["tariff"], "reference_number": info.get("reference_number"),
               "project_id": info.get("project_id"), "location_id": info.get("location_id"),
               "calc": calc, "recommended_plan": body.recommended_plan if body.recommended_plan in {p["key"] for p in calc["plans"]} else "standard",
               "notes": body.notes, "status": "draft", "valid_until": (today + timedelta(days=int(s["quote_valid_days"]))).isoformat(),
               "created_by": user["id"], "created_by_name": user["name"], "created_at": _now().isoformat(), "history": [{"status": "draft", "at": _now().isoformat(), "by": user["name"]}]}
        res = await db.amc_quotes.insert_one(doc)
        if doc["source_id"]:
            await _resolve_offer_notes(doc["source_type"], doc["source_id"])
        await create_audit_log(user["id"], user["name"], "amc_quote_created", "amc_quote", str(res.inserted_id), None, {"number": doc["quote_number"], "kw": kw})
        return _ser({**doc, "_id": res.inserted_id})

    @router.get("/amc/quotes")
    async def list_quotes(request: Request, status: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {"status": status} if status else {}
        return [_ser(d) async for d in db.amc_quotes.find(q).sort("created_at", -1).limit(500)]

    async def _quote(quote_id: str) -> Dict[str, Any]:
        d = await db.amc_quotes.find_one({"_id": _oid(quote_id)})
        if not d:
            raise HTTPException(status_code=404, detail="Quote not found")
        return d

    @router.get("/amc/quotes/{quote_id}")
    async def get_quote(quote_id: str, request: Request):
        await get_current_user(request)
        return _ser(await _quote(quote_id))

    @router.put("/amc/quotes/{quote_id}/status")
    async def quote_status(quote_id: str, body: QuoteStatusIn, request: Request):
        user = await _editor(request)
        d = await _quote(quote_id)
        if body.status not in ("draft", "sent", "declined"):
            raise HTTPException(status_code=400, detail="Status must be draft, sent or declined")
        if d.get("status") == "accepted":
            raise HTTPException(status_code=400, detail="This quote is already accepted")
        await db.amc_quotes.update_one({"_id": d["_id"]}, {"$set": {"status": body.status, "status_reason": body.reason, "updated_at": _now().isoformat()},
                                                          "$push": {"history": {"status": body.status, "at": _now().isoformat(), "by": user["name"], "reason": body.reason}}})
        await create_audit_log(user["id"], user["name"], f"amc_quote_{body.status}", "amc_quote", quote_id)
        return {"ok": True, "status": body.status}

    @router.post("/amc/quotes/{quote_id}/accept")
    async def accept_quote(quote_id: str, body: AcceptIn, request: Request):
        """The customer said yes: make the AMC contract for the chosen plan."""
        user = await _editor(request)
        d = await _quote(quote_id)
        if d.get("status") == "accepted":
            raise HTTPException(status_code=400, detail="This quote is already accepted")
        plan = next((p for p in (d.get("calc") or {}).get("plans") or [] if p["key"] == body.plan_key), None)
        if not plan:
            raise HTTPException(status_code=400, detail="Choose one of the plans on the quote")
        start = body.start_date or _now().date().isoformat()
        if not _to_date(start):
            raise HTTPException(status_code=400, detail="Start date must be YYYY-MM-DD")
        if not (1 <= body.duration_months <= 120):
            raise HTTPException(status_code=400, detail="Duration must be 1–120 months")
        if d.get("project_id") and await db.amc_contracts.find_one({"project_id": d["project_id"], "status": "active"}):
            raise HTTPException(status_code=400, detail="This customer already has an active AMC contract")
        src = {k: d.get(k) for k in ("project_id", "customer_name", "phone", "site_address", "district", "state", "system_type",
                                      "system_type_other", "system_capacity_kw", "commissioning_date", "location_id", "notes")}
        contract = await _contract_from_source(src, plan, start[:10], body.duration_months, user, {"quote_id": quote_id})
        await db.amc_quotes.update_one({"_id": d["_id"]}, {"$set": {"status": "accepted", "accepted_plan": plan["key"], "contract_id": str(contract["_id"]),
                                                                    "contract_number": contract["contract_number"], "updated_at": _now().isoformat()},
                                                          "$push": {"history": {"status": "accepted", "at": _now().isoformat(), "by": user["name"], "plan": plan["key"]}}})
        if d.get("source_id"):
            await _resolve_offer_notes(d["source_type"], d["source_id"])
        await create_audit_log(user["id"], user["name"], "amc_quote_accepted", "amc_quote", quote_id, None, {"plan": plan["key"], "contract": contract["contract_number"]})
        return {"ok": True, "contract": _ser(contract)}

    # ═══════════════ report ═══════════════
    @router.get("/amc/report")
    async def report(request: Request, start: Optional[str] = None, end: Optional[str] = None):
        await get_current_user(request)
        today = _now().date()
        d_end = _to_date(end) or today
        d_start = _to_date(start) or (d_end.replace(day=1) - timedelta(days=330)).replace(day=1)
        if d_start > d_end:
            raise HTTPException(status_code=400, detail="Start must be before end")
        s0, s1 = d_start.isoformat(), d_end.isoformat()
        contracts = [c async for c in db.amc_contracts.find({})]
        active = [c for c in contracts if c.get("status") == "active"]
        in_period = lambda v: v and s0 <= str(v)[:10] <= s1  # noqa: E731
        new = [c for c in contracts if in_period(c.get("start_date")) and not c.get("previous_contract_id")]
        renewed = [c for c in contracts if in_period(c.get("start_date")) and c.get("previous_contract_id")]
        cancelled = [c for c in contracts if c.get("status") == "cancelled" and in_period(c.get("updated_at") or c.get("end_date"))]
        ids = [str(c["_id"]) for c in contracts]
        visits = [v async for v in db.amc_service_visits.find({"contract_id": {"$in": ids}})]
        v_done = [v for v in visits if v.get("status") == "completed" and in_period(v.get("actual_date"))]
        v_sched = [v for v in visits if v.get("status") == "scheduled" and in_period(v.get("scheduled_date"))]
        v_overdue = [v for v in visits if v.get("status") == "scheduled" and (v.get("scheduled_date") or "9999") < today.isoformat()]
        soon = (today + timedelta(days=60)).isoformat()
        renewals_due = sorted([c for c in active if today.isoformat() <= (c.get("end_date") or "0000") <= soon], key=lambda c: c.get("end_date"))
        quotes = [q async for q in db.amc_quotes.find({}) if in_period(q.get("created_at"))]
        offers_due = await offer_rows(include_upcoming=False)
        by_id = {str(c["_id"]): c for c in contracts}
        months = month_keys(d_start, d_end)
        monthly = {m: {"month": m, "new_contracts": 0, "renewals": 0, "new_value": 0.0, "visits_done": 0, "quotes": 0} for m in months}
        for c in new + renewed:
            m = str(c.get("start_date"))[:7]
            if m in monthly:
                monthly[m]["new_contracts" if c in new else "renewals"] += 1
                monthly[m]["new_value"] += _f(c.get("annual_value"))
        for v in v_done:
            m = str(v.get("actual_date"))[:7]
            if m in monthly:
                monthly[m]["visits_done"] += 1
        for q in quotes:
            m = str(q.get("created_at"))[:7]
            if m in monthly:
                monthly[m]["quotes"] += 1
        accepted = sum(1 for q in quotes if q.get("status") == "accepted")
        summary = {
            "active_contracts": len(active), "capacity_kw": round(sum(_f(c.get("system_capacity_kw")) for c in active), 1),
            "yearly_value": round(sum(_f(c.get("annual_value")) for c in active)), "new_contracts": len(new), "renewals": len(renewed),
            "cancelled": len(cancelled), "visits_done": len(v_done), "visits_scheduled": len(v_sched), "visits_overdue": len(v_overdue),
            "renewals_due_60d": len(renewals_due), "offers_due": len(offers_due), "quotes_made": len(quotes), "quotes_accepted": accepted,
            "quote_win_pct": round(accepted / len(quotes) * 100, 1) if quotes else 0.0,
            "outstanding": round(sum(_f(c.get("outstanding")) for c in contracts)),
        }

        def crow(c):
            return {"contract_number": c.get("contract_number"), "customer": c.get("customer_name"), "district": c.get("district"),
                    "kw": _f(c.get("system_capacity_kw")), "plan": c.get("plan_name") or c.get("contract_type"), "start_date": c.get("start_date"),
                    "end_date": c.get("end_date"), "status": c.get("status"), "visits_done": c.get("visits_completed", 0),
                    "yearly_value": _f(c.get("annual_value")), "outstanding": _f(c.get("outstanding"))}

        return {
            "title": "AMC report", "generated_at": _now().isoformat(), "period": {"start": s0, "end": s1}, "months": months,
            "summary": summary, "monthly": list(monthly.values()),
            "contracts": [crow(c) for c in sorted(contracts, key=lambda c: c.get("start_date") or "", reverse=True)],
            "visits": [{"date": v.get("actual_date") or v.get("scheduled_date"), "contract_number": (by_id.get(v.get("contract_id")) or {}).get("contract_number"),
                        "customer": (by_id.get(v.get("contract_id")) or {}).get("customer_name"), "type": v.get("visit_type"), "technician": v.get("technician_name"),
                        "status": v.get("status")} for v in sorted(v_done + v_sched + v_overdue, key=lambda v: v.get("actual_date") or v.get("scheduled_date") or "", reverse=True)],
            "renewals_due": [{"contract_number": c.get("contract_number"), "customer": c.get("customer_name"),
                              "end_date": c.get("end_date"), "yearly_value": _f(c.get("annual_value"))} for c in renewals_due],
            "offers_due": [{"customer": o["customer_name"], "kw": o["system_capacity_kw"], "commissioned_on": o["commissioned_on"],
                            "due_on": o["due_on"], "quote": (o.get("quote") or {}).get("number")} for o in offers_due],
            "quotes": [{"number": q.get("quote_number"), "customer": q.get("customer_name"), "kw": q.get("system_capacity_kw"),
                        "status": q.get("status"), "plan": q.get("accepted_plan"), "date": str(q.get("created_at"))[:10]} for q in quotes],
        }

    return router
