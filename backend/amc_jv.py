"""AMC joint venture, AMC offers, AMC quotes and the AMC report.

* Joint venture — a partner company shares only the AMC page. Its people sign in with the "partner" role
  (everything else in the app is closed to them, see access_policy.partner_allows). They see every AMC
  contract (ours without prices or money) and add the projects they built themselves. Partner work lives
  in its own collection (`jv_projects`) and AMC contracts carry `org_id`, so none of it reaches our
  projects, targets or metrics (dashboards, investor snapshot, reports read `ours_query()`).
* Offers — once a customer's plant is N years old (Settings, default 3) and it has no active AMC, it shows
  up as "time to offer AMC" on the AMC page, on Home and in the bell.
* Quotes — Basic / Standard / Premium priced per kW per year (Settings); each quote shows how the plan
  protects generation and life, and can be turned into a contract once the customer says yes.
* Report — contracts, visits, renewals, offers and quotes for a period and a company.
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

PARTNER_ROLE = "partner"
OURS = "ours"
ALL = "all"

# Fields of OUR contracts a partner never sees (prices, billing and money).
MONEY_FIELDS = ("annual_value", "total_billed", "total_collected", "outstanding", "next_billing_date", "billing_frequency",
                "auto_renew", "renewal_notice_days", "churn_reason")

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
    "plans": DEFAULT_PLANS,
}


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


def is_partner(user: Dict[str, Any]) -> bool:
    return (user or {}).get("role") == PARTNER_ROLE


def ours_query() -> Dict[str, Any]:
    """Mongo filter for our own AMC records (no partner org)."""
    return {"org_id": {"$in": [None, ""]}}


def org_query(org: Optional[str]) -> Dict[str, Any]:
    """'ours' (default) → our records, 'all' → everyone, anything else → that partner org id."""
    if not org or org == OURS:
        return ours_query()
    if org == ALL:
        return {}
    return {"org_id": org}


def scope_for(user: Dict[str, Any], org: Optional[str]) -> Dict[str, Any]:
    """A partner is always kept to its own org for numbers; our people choose."""
    if is_partner(user):
        return {"org_id": user.get("partner_id") or "__none__"}
    return org_query(org)


def is_ours(doc: Dict[str, Any]) -> bool:
    return not doc.get("org_id")


def mask_for_partner(doc: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
    """A partner sees our contracts without any price or money; its own contracts in full."""
    if not is_partner(user) or doc.get("org_id") == user.get("partner_id"):
        return doc
    out = {k: v for k, v in doc.items() if k not in MONEY_FIELDS}
    out["money_hidden"] = True
    out.pop("project_id", None)
    return out


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
class PartnerIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    active: bool = True


class LogoIn(BaseModel):
    logo_path: Optional[str] = None


class PartnerUserIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str
    phone: Optional[str] = None
    password: str = Field(min_length=8, max_length=128)


class JvProjectIn(BaseModel):
    org_id: Optional[str] = None
    customer_name: str = Field(min_length=2, max_length=120)
    phone: Optional[str] = None
    site_address: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    system_type: str = "on-grid"
    system_capacity_kw: float = Field(ge=0, le=100000)
    pump_hp: Optional[float] = None
    commissioning_date: Optional[str] = None
    tariff: Optional[float] = None
    notes: Optional[str] = None
    photos: List[str] = []


class QuoteIn(BaseModel):
    source_type: str = "manual"          # project | jv_project | manual
    source_id: Optional[str] = None
    customer_name: Optional[str] = None
    phone: Optional[str] = None
    site_address: Optional[str] = None
    district: Optional[str] = None
    system_type: Optional[str] = None
    system_capacity_kw: Optional[float] = None
    commissioning_date: Optional[str] = None
    tariff: Optional[float] = None
    recommended_plan: Optional[str] = "standard"
    notes: Optional[str] = None
    org_id: Optional[str] = None


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


SYSTEM_TYPES = {"on-grid", "off-grid", "hybrid", "solar-pump"}
EMAIL_RX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def create_router(db, get_current_user, require_role, create_audit_log, hash_password, role_ok, next_sequence=None):
    router = APIRouter()

    async def _seq(key: str) -> int:
        doc = await db.counters.find_one_and_update({"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
        return doc["seq"]

    async def settings() -> Dict[str, Any]:
        doc = await db.amc_settings.find_one({"key": "defaults"}) or {}
        return merge_settings(doc)

    async def partners_map() -> Dict[str, Dict[str, Any]]:
        return {str(p["_id"]): p async for p in db.jv_partners.find({})}

    async def _manager(request: Request) -> Dict[str, Any]:
        """Admin / manager (or anyone the Permissions page opened AMC editing to), never a partner."""
        user = await get_current_user(request)
        if is_partner(user) or not role_ok(request, user, "admin", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    async def _admin(request: Request) -> Dict[str, Any]:
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can change this")
        return user

    async def _editor(request: Request) -> Dict[str, Any]:
        """Admin / manager, or a partner (whose writes are then kept to its own org)."""
        user = await get_current_user(request)
        if is_partner(user):
            if not user.get("partner_id"):
                raise HTTPException(status_code=403, detail="This login isn't linked to a partner company")
            return user
        if not role_ok(request, user, "admin", "manager"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    async def _partner_org(org_id: Optional[str]) -> Dict[str, Any]:
        if not org_id or not ObjectId.is_valid(org_id):
            raise HTTPException(status_code=400, detail="Choose the partner company")
        p = await db.jv_partners.find_one({"_id": ObjectId(org_id)})
        if not p:
            raise HTTPException(status_code=400, detail="Partner company not found")
        return p

    def _own(user: Dict[str, Any], doc: Dict[str, Any]) -> None:
        """A partner may only change its own org's records; our people may change anything."""
        if is_partner(user) and doc.get("org_id") != user.get("partner_id"):
            raise HTTPException(status_code=403, detail="This belongs to Sensoper — you can view it but not change it")

    def _partner_out(p: Dict[str, Any], logins: int = 0) -> Dict[str, Any]:
        return {"id": str(p["_id"]), "name": p.get("name"), "contact_name": p.get("contact_name"), "phone": p.get("phone"),
                "email": p.get("email"), "city": p.get("city"), "logo_path": p.get("logo_path"), "active": p.get("active", True),
                "created_at": p.get("created_at"), "logins": logins}

    # ═══════════════ joint-venture partners ═══════════════
    @router.get("/amc/jv/partners")
    async def list_partners(request: Request):
        user = await get_current_user(request)
        q: Dict[str, Any] = {}
        if is_partner(user):
            q = {"_id": _oid(user.get("partner_id"))}
        rows = []
        async for p in db.jv_partners.find(q).sort("created_at", 1):
            n = await db.users.count_documents({"role": PARTNER_ROLE, "partner_id": str(p["_id"])}) if not is_partner(user) else 0
            rows.append(_partner_out(p, n))
        return rows

    @router.get("/amc/jv/me")
    async def jv_me(request: Request):
        """What the AMC page needs to draw itself: who is looking, the partner companies and the co-brand."""
        user = await get_current_user(request)
        cp = await db.company_profiles.find_one({"is_active": True}) or await db.company_profiles.find_one({}) or {}
        ours = {"name": cp.get("company_name") or cp.get("name") or "Sensoper Controls & Renewables", "logo_url": cp.get("logo_url")}
        pq = {"_id": _oid(user.get("partner_id"))} if is_partner(user) else {"active": {"$ne": False}}
        partners = [_partner_out(p) async for p in db.jv_partners.find(pq).sort("created_at", 1)]
        return {"is_partner": is_partner(user), "partner_id": user.get("partner_id"), "ours": ours, "partners": partners}

    @router.post("/amc/jv/partners")
    async def create_partner(body: PartnerIn, request: Request):
        user = await _admin(request)
        if await db.jv_partners.find_one({"name": {"$regex": f"^{re.escape(body.name.strip())}$", "$options": "i"}}):
            raise HTTPException(status_code=400, detail="A partner with this name already exists")
        doc = {**body.model_dump(), "name": body.name.strip(), "logo_path": None, "created_at": _now().isoformat(), "created_by": user["name"]}
        res = await db.jv_partners.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "jv_partner_created", "jv_partner", str(res.inserted_id), None, {"name": doc["name"]})
        return _partner_out({**doc, "_id": res.inserted_id})

    @router.put("/amc/jv/partners/{partner_id}")
    async def update_partner(partner_id: str, body: PartnerIn, request: Request):
        user = await _admin(request)
        r = await db.jv_partners.update_one({"_id": _oid(partner_id)}, {"$set": {**body.model_dump(), "name": body.name.strip(), "updated_at": _now().isoformat()}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Partner not found")
        if not body.active:  # switching a partner off also stops its logins
            await db.users.update_many({"role": PARTNER_ROLE, "partner_id": partner_id}, {"$set": {"active": False}})
        await create_audit_log(user["id"], user["name"], "jv_partner_updated", "jv_partner", partner_id, None, {"active": body.active})
        return _partner_out(await db.jv_partners.find_one({"_id": ObjectId(partner_id)}))

    @router.put("/amc/jv/partners/{partner_id}/logo")
    async def set_logo(partner_id: str, body: LogoIn, request: Request):
        """An admin, or the partner's own people, can change the partner's logo."""
        user = await get_current_user(request)
        if not (user.get("role") == "admin" or (is_partner(user) and user.get("partner_id") == partner_id)):
            raise HTTPException(status_code=403, detail="You can only change your own company's logo")
        path = (body.logo_path or "").strip() or None
        if path and not re.fullmatch(r"[\w\-]+/images/[\w\-]+\.(png|jpe?g|webp|gif)", path, flags=re.I):
            raise HTTPException(status_code=400, detail="Upload the logo as an image first")
        r = await db.jv_partners.update_one({"_id": _oid(partner_id)}, {"$set": {"logo_path": path, "updated_at": _now().isoformat()}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Partner not found")
        await create_audit_log(user["id"], user["name"], "jv_partner_logo", "jv_partner", partner_id, None, {"logo_path": path})
        return {"logo_path": path}

    @router.get("/amc/jv/partners/{partner_id}/users")
    async def partner_users(partner_id: str, request: Request):
        await _admin(request)
        return [{"id": str(u["_id"]), "name": u.get("name"), "email": u.get("email"), "phone": u.get("phone"), "active": u.get("active", True),
                 "must_reset_password": bool(u.get("must_reset_password")), "last_login": u.get("last_login"), "created_at": u.get("created_at")}
                async for u in db.users.find({"role": PARTNER_ROLE, "partner_id": partner_id}, {"password_hash": 0}).sort("created_at", 1)]

    @router.post("/amc/jv/partners/{partner_id}/users")
    async def add_partner_user(partner_id: str, body: PartnerUserIn, request: Request):
        user = await _admin(request)
        p = await _partner_org(partner_id)
        email = body.email.strip().lower()
        if not EMAIL_RX.match(email):
            raise HTTPException(status_code=400, detail="Enter a valid email address")
        if await db.users.find_one({"email": email}) or await db.investors.find_one({"email": email}):
            raise HTTPException(status_code=400, detail="Email already registered")
        doc = {"email": email, "password_hash": hash_password(body.password), "name": body.name.strip(), "role": PARTNER_ROLE,
               "partner_id": partner_id, "phone": body.phone, "must_reset_password": True, "daily_report_required": False,
               "created_at": _now().isoformat()}
        res = await db.users.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "jv_partner_login_created", "user", str(res.inserted_id), None, {"email": email, "partner": p.get("name")})
        return {"id": str(res.inserted_id), "name": doc["name"], "email": email, "active": True, "must_reset_password": True}

    @router.put("/amc/jv/partners/{partner_id}/users/{user_id}")
    async def update_partner_user(partner_id: str, user_id: str, request: Request):
        """Switch a partner login on/off, or give it a new temporary password."""
        user = await _admin(request)
        body = await request.json()
        u = await db.users.find_one({"_id": _oid(user_id), "role": PARTNER_ROLE, "partner_id": partner_id})
        if not u:
            raise HTTPException(status_code=404, detail="Login not found")
        upd: Dict[str, Any] = {}
        if "active" in body:
            upd["active"] = bool(body["active"])
        if body.get("password"):
            if len(str(body["password"])) < 8:
                raise HTTPException(status_code=400, detail="Use at least 8 characters")
            upd.update({"password_hash": hash_password(str(body["password"])), "must_reset_password": True, "password_changed_at": _now().isoformat()})
        if not upd:
            raise HTTPException(status_code=400, detail="Nothing to change")
        await db.users.update_one({"_id": u["_id"]}, {"$set": upd})
        await create_audit_log(user["id"], user["name"], "jv_partner_login_updated", "user", user_id, None,
                               {k: v for k, v in upd.items() if k != "password_hash"} | ({"password": "reset"} if "password_hash" in upd else {}))
        return {"ok": True}

    @router.delete("/amc/jv/partners/{partner_id}/users/{user_id}")
    async def remove_partner_user(partner_id: str, user_id: str, request: Request):
        user = await _admin(request)
        r = await db.users.delete_one({"_id": _oid(user_id), "role": PARTNER_ROLE, "partner_id": partner_id})
        if not r.deleted_count:
            raise HTTPException(status_code=404, detail="Login not found")
        await create_audit_log(user["id"], user["name"], "jv_partner_login_removed", "user", user_id)
        return {"ok": True}

    # ═══════════════ partner projects (kept apart from ours) ═══════════════
    def _jv_out(d: Dict[str, Any], pmap: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        out = _ser(d)
        out["org_name"] = (pmap.get(d.get("org_id")) or {}).get("name")
        return out

    @router.get("/amc/jv/projects")
    async def list_jv_projects(request: Request, org: Optional[str] = None, search: Optional[str] = None):
        user = await get_current_user(request)
        q: Dict[str, Any] = {"deleted_at": {"$exists": False}}
        if is_partner(user):
            q["org_id"] = user.get("partner_id")
        elif org and org not in (ALL, OURS):
            q["org_id"] = org
        if search:
            q["customer_name"] = {"$regex": re.escape(search), "$options": "i"}
        pmap = await partners_map()
        covered = {c.get("jv_project_id") async for c in db.amc_contracts.find({"status": "active", "jv_project_id": {"$ne": None}}, {"jv_project_id": 1})}
        rows = []
        async for d in db.jv_projects.find(q).sort("commissioning_date", -1):
            r = _jv_out(d, pmap)
            r["has_active_amc"] = r["id"] in covered
            rows.append(r)
        return rows

    async def _jv_doc(body: JvProjectIn, user: Dict[str, Any]) -> Dict[str, Any]:
        if body.system_type not in SYSTEM_TYPES:
            raise HTTPException(status_code=400, detail="Unknown system type")
        if body.commissioning_date and not _to_date(body.commissioning_date):
            raise HTTPException(status_code=400, detail="Commissioning date must be YYYY-MM-DD")
        if body.commissioning_date and _to_date(body.commissioning_date) > _now().date():
            raise HTTPException(status_code=400, detail="Commissioning date can't be in the future")
        org_id = user.get("partner_id") if is_partner(user) else body.org_id
        await _partner_org(org_id)
        photos = [p for p in body.photos if isinstance(p, str) and re.fullmatch(r"[\w\-]+/images/[\w\-]+\.(png|jpe?g|webp|gif|heic|heif)", p, flags=re.I)][:12]
        return {**body.model_dump(), "org_id": org_id, "photos": photos, "customer_name": body.customer_name.strip()}

    @router.post("/amc/jv/projects")
    async def create_jv_project(body: JvProjectIn, request: Request):
        user = await _editor(request)
        doc = await _jv_doc(body, user)
        doc.update({"created_by": user["id"], "created_by_name": user["name"], "created_at": _now().isoformat()})
        res = await db.jv_projects.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "jv_project_created", "jv_project", str(res.inserted_id), None, {"customer": doc["customer_name"], "org_id": doc["org_id"]})
        return _jv_out({**doc, "_id": res.inserted_id}, await partners_map())

    @router.put("/amc/jv/projects/{project_id}")
    async def update_jv_project(project_id: str, body: JvProjectIn, request: Request):
        user = await _editor(request)
        cur = await db.jv_projects.find_one({"_id": _oid(project_id), "deleted_at": {"$exists": False}})
        if not cur:
            raise HTTPException(status_code=404, detail="Project not found")
        _own(user, cur)
        doc = await _jv_doc(body, user)
        if is_partner(user):
            doc["org_id"] = cur["org_id"]
        doc["updated_at"] = _now().isoformat()
        await db.jv_projects.update_one({"_id": cur["_id"]}, {"$set": doc})
        await create_audit_log(user["id"], user["name"], "jv_project_updated", "jv_project", project_id)
        return _jv_out({**cur, **doc}, await partners_map())

    @router.delete("/amc/jv/projects/{project_id}")
    async def delete_jv_project(project_id: str, request: Request):
        user = await _editor(request)
        cur = await db.jv_projects.find_one({"_id": _oid(project_id), "deleted_at": {"$exists": False}})
        if not cur:
            raise HTTPException(status_code=404, detail="Project not found")
        _own(user, cur)
        if await db.amc_contracts.find_one({"jv_project_id": project_id, "status": "active"}):
            raise HTTPException(status_code=400, detail="This project has an active AMC contract — cancel it first")
        await db.jv_projects.update_one({"_id": cur["_id"]}, {"$set": {"deleted_at": _now().isoformat(), "deleted_by": user["name"]}})
        await create_audit_log(user["id"], user["name"], "jv_project_deleted", "jv_project", project_id)
        return {"ok": True}

    async def _contract_from_source(src: Dict[str, Any], org_id: Optional[str], plan: Optional[Dict[str, Any]], start_date: str,
                                    duration_months: int, user: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
        from amc import _end_date, _next_billing
        now_iso = _now().isoformat()
        seq = await _seq("amc_contract_number")
        visits = int((plan or {}).get("visits_per_year") or 2)
        doc = {
            "project_id": src.get("project_id"), "jv_project_id": src.get("jv_project_id"), "org_id": org_id,
            "customer_id": None, "customer_name": src.get("customer_name") or "Customer", "contact": src.get("phone"),
            "site_address": src.get("site_address"), "district": src.get("district"), "state": src.get("state"), "location_id": src.get("location_id"),
            "system_type": src.get("system_type") or "on-grid", "system_capacity_kw": _f(src.get("system_capacity_kw")), "pump_hp": src.get("pump_hp"),
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

    @router.post("/amc/jv/projects/{project_id}/contract")
    async def jv_contract(project_id: str, request: Request):
        user = await _editor(request)
        cur = await db.jv_projects.find_one({"_id": _oid(project_id), "deleted_at": {"$exists": False}})
        if not cur:
            raise HTTPException(status_code=404, detail="Project not found")
        _own(user, cur)
        if await db.amc_contracts.find_one({"jv_project_id": project_id, "status": "active"}):
            raise HTTPException(status_code=400, detail="This project already has an active AMC contract")
        s = await settings()
        q = quote_plans(_f(cur.get("system_capacity_kw")), s, cur.get("tariff"))
        plan = next((p for p in q["plans"] if p["key"] == "standard"), q["plans"][0])
        src = {**cur, "jv_project_id": project_id}
        doc = await _contract_from_source(src, cur["org_id"], plan, _now().date().isoformat(), 12, user, {})
        await create_audit_log(user["id"], user["name"], "amc_contract_created_from_jv_project", "amc_contract", str(doc["_id"]), None, {"jv_project_id": project_id})
        await _resolve_offer_notes("jv_project", project_id)
        return _ser(doc)

    # ═══════════════ settings ═══════════════
    @router.get("/amc/settings")
    async def get_settings(request: Request):
        await get_current_user(request)
        return await settings()

    @router.put("/amc/settings")
    async def put_settings(request: Request):
        user = await _admin(request)
        s = clean_settings(await request.json())
        await db.amc_settings.update_one({"key": "defaults"}, {"$set": {**s, "key": "defaults", "updated_at": _now().isoformat(), "updated_by": user["name"]}}, upsert=True)
        await create_audit_log(user["id"], user["name"], "amc_settings_updated", "amc_settings", "defaults", None,
                               {"offer_after_years": s["offer_after_years"], "rates": {p["key"]: p["rate_per_kw"] for p in s["plans"]}})
        return s

    # ═══════════════ offers: plants old enough for an AMC ═══════════════
    async def offer_rows(user: Dict[str, Any], org: Optional[str], include_upcoming: bool = True) -> List[Dict[str, Any]]:
        s = await settings()
        today = _now().date()
        active = [c async for c in db.amc_contracts.find({"status": "active"}, {"project_id": 1, "jv_project_id": 1})]
        covered_p = {c.get("project_id") for c in active if c.get("project_id")}
        covered_j = {c.get("jv_project_id") for c in active if c.get("jv_project_id")}
        dismiss = {(d["source_type"], d["source_id"]): d async for d in db.amc_offer_flags.find({})}
        quotes: Dict[Tuple[str, str], Dict[str, Any]] = {}
        async for qd in db.amc_quotes.find({"source_id": {"$ne": None}}).sort("created_at", 1):
            quotes[(qd.get("source_type"), qd.get("source_id"))] = qd
        pmap = await partners_map()
        rows: List[Dict[str, Any]] = []
        want_ours = not is_partner(user) and (not org or org in (OURS, ALL))
        want_jv = is_partner(user) or (org and org != OURS)

        def push(kind, sid, org_id, name, phone, kw, stype, commissioned, district, extra):
            flag = dismiss.get((kind, sid)) or {}
            if flag.get("action") == "not_interested":
                return
            state = offer_state(commissioned, today, s, flag.get("until"))
            if not state or (state == "soon" and not include_upcoming):
                return
            due = offer_due_date(commissioned, s)
            q = quotes.get((kind, sid))
            rows.append({"source_type": kind, "source_id": sid, "org_id": org_id, "org_name": (pmap.get(org_id) or {}).get("name") if org_id else None,
                         "customer_name": name, "phone": phone, "system_capacity_kw": round(_f(kw), 2), "system_type": stype, "district": district,
                         "commissioned_on": commissioned.isoformat(), "due_on": due.isoformat(), "state": state,
                         "years": round((today - commissioned).days / 365.25, 1), "days_overdue": max((today - due).days, 0),
                         "quote": {"id": str(q["_id"]), "number": q.get("quote_number"), "status": q.get("status")} if q else None, **extra})

        if want_ours:
            async for p in db.projects.find({"status": "completed", "deleted_at": {"$exists": False}},
                                            {"customer": 1, "commissioning_date": 1, "completed_at": 1, "installation_date": 1, "location": 1,
                                             "custom_fields.proposed_solution.system_size_kw": 1, "custom_fields.proposed_solution.system_type": 1,
                                             "reference_number": 1, "electrical.eb_tariff": 1}):
                pid = str(p["_id"])
                if pid in covered_p:
                    continue
                ps = ((p.get("custom_fields") or {}).get("proposed_solution") or {})
                commissioned = _to_date(p.get("commissioning_date")) or _to_date(p.get("completed_at")) or _to_date(p.get("installation_date"))
                cust = p.get("customer") or {}
                push("project", pid, None, cust.get("name"), cust.get("phone"), ps.get("system_size_kw"), ps.get("system_type") or "on-grid",
                     commissioned, (p.get("location") or {}).get("district"), {"reference_number": p.get("reference_number")})
        if want_jv:
            q: Dict[str, Any] = {"deleted_at": {"$exists": False}}
            if is_partner(user):
                q["org_id"] = user.get("partner_id")
            elif org and org not in (OURS, ALL):
                q["org_id"] = org
            async for j in db.jv_projects.find(q):
                jid = str(j["_id"])
                if jid in covered_j:
                    continue
                push("jv_project", jid, j.get("org_id"), j.get("customer_name"), j.get("phone"), j.get("system_capacity_kw"), j.get("system_type"),
                     _to_date(j.get("commissioning_date")), j.get("district"), {})
        rows.sort(key=lambda r: (r["state"] != "due", r["due_on"]))
        return rows

    @router.get("/amc/offers")
    async def offers(request: Request, org: Optional[str] = None, include_upcoming: bool = True):
        user = await get_current_user(request)
        rows = await offer_rows(user, org, include_upcoming)
        s = await settings()
        return {"rows": rows, "due": sum(1 for r in rows if r["state"] == "due"), "soon": sum(1 for r in rows if r["state"] == "soon"),
                "offer_after_years": s["offer_after_years"], "offer_lead_days": s["offer_lead_days"]}

    @router.post("/amc/offers/{source_type}/{source_id}")
    async def flag_offer(source_type: str, source_id: str, body: DismissIn, request: Request):
        """'Ask later' (snooze), 'Not interested' (stop), or 'reopen'."""
        user = await _editor(request)
        if source_type not in ("project", "jv_project"):
            raise HTTPException(status_code=400, detail="Unknown source")
        if source_type == "project":
            if is_partner(user):
                raise HTTPException(status_code=403, detail="This belongs to Sensoper")
            if not await db.projects.find_one({"_id": _oid(source_id)}, {"_id": 1}):
                raise HTTPException(status_code=404, detail="Project not found")
        else:
            j = await db.jv_projects.find_one({"_id": _oid(source_id)}, {"org_id": 1})
            if not j:
                raise HTTPException(status_code=404, detail="Project not found")
            _own(user, j)
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
        """Bell: one in-app note per admin / manager when a customer's plant reaches the AMC offer date (ours only)."""
        rows = [r for r in await offer_rows({"role": "admin"}, OURS, include_upcoming=False) if not r.get("quote")]
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
        user = await get_current_user(request)
        rows = await offer_rows(user, None if not is_partner(user) else ALL, include_upcoming=False)
        return {"due": len(rows), "without_quote": sum(1 for r in rows if not r.get("quote"))}

    # ═══════════════ quotes ═══════════════
    @router.post("/amc/quotes/preview")
    async def preview(body: PreviewIn, request: Request):
        await get_current_user(request)
        return quote_plans(body.system_capacity_kw, await settings(), body.tariff)

    async def _source(body: QuoteIn, user: Dict[str, Any]) -> Dict[str, Any]:
        """Fill customer / plant details from the project the quote is for."""
        if body.source_type == "project":
            if is_partner(user):
                raise HTTPException(status_code=403, detail="Partners quote their own projects only")
            p = await db.projects.find_one({"_id": _oid(body.source_id), "deleted_at": {"$exists": False}})
            if not p:
                raise HTTPException(status_code=404, detail="Project not found")
            ps = ((p.get("custom_fields") or {}).get("proposed_solution") or {})
            cust, loc = p.get("customer") or {}, p.get("location") or {}
            commissioned = _to_date(p.get("commissioning_date")) or _to_date(p.get("completed_at"))
            return {"org_id": None, "customer_name": cust.get("name"), "phone": cust.get("phone"), "site_address": cust.get("address") or loc.get("address"),
                    "district": loc.get("district"), "state": loc.get("state"), "system_type": ps.get("system_type") or "on-grid",
                    "system_capacity_kw": _f(ps.get("system_size_kw")), "commissioning_date": commissioned.isoformat() if commissioned else None,
                    "tariff": _f(ps.get("tariff_per_unit")) or _f((p.get("electrical") or {}).get("eb_tariff")) or None,
                    "project_id": str(p["_id"]), "reference_number": p.get("reference_number"), "location_id": p.get("location_id")}
        if body.source_type == "jv_project":
            j = await db.jv_projects.find_one({"_id": _oid(body.source_id), "deleted_at": {"$exists": False}})
            if not j:
                raise HTTPException(status_code=404, detail="Project not found")
            _own(user, j)
            return {"org_id": j.get("org_id"), "customer_name": j.get("customer_name"), "phone": j.get("phone"), "site_address": j.get("site_address"),
                    "district": j.get("district"), "state": j.get("state"), "system_type": j.get("system_type"), "system_capacity_kw": _f(j.get("system_capacity_kw")),
                    "commissioning_date": j.get("commissioning_date"), "tariff": j.get("tariff"), "jv_project_id": str(j["_id"])}
        if body.source_type != "manual":
            raise HTTPException(status_code=400, detail="Unknown source")
        org_id = user.get("partner_id") if is_partner(user) else (body.org_id or None)
        if org_id:
            await _partner_org(org_id)
        return {"org_id": org_id}

    def _quote_out(q: Dict[str, Any], pmap: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        out = _ser(q)
        out["org_name"] = (pmap.get(q.get("org_id")) or {}).get("name") if q.get("org_id") else None
        out["org_logo_path"] = (pmap.get(q.get("org_id")) or {}).get("logo_path") if q.get("org_id") else None
        return out

    @router.post("/amc/quotes")
    async def create_quote(body: QuoteIn, request: Request):
        user = await _editor(request)
        src = await _source(body, user)
        typed = {k: v for k, v in body.model_dump().items() if v not in (None, "") and k in
                 ("customer_name", "phone", "site_address", "district", "system_type", "system_capacity_kw", "commissioning_date", "tariff")}
        info = {**src, **typed}
        if not (info.get("customer_name") or "").strip():
            raise HTTPException(status_code=400, detail="Enter the customer's name")
        kw = _f(info.get("system_capacity_kw"))
        if kw <= 0:
            raise HTTPException(status_code=400, detail="Enter the plant size in kW")
        s = await settings()
        calc = quote_plans(kw, s, info.get("tariff"))
        seq = await _seq("amc_quote_number")
        today = _now().date()
        doc = {"quote_number": f"AMCQ-{seq:04d}", "source_type": body.source_type, "source_id": body.source_id if body.source_type != "manual" else None,
               "org_id": info.get("org_id"), "customer_name": info["customer_name"].strip(), "phone": info.get("phone"), "site_address": info.get("site_address"),
               "district": info.get("district"), "state": info.get("state"), "system_type": info.get("system_type") or "on-grid", "system_capacity_kw": kw,
               "commissioning_date": info.get("commissioning_date"), "tariff": calc["tariff"], "reference_number": info.get("reference_number"),
               "project_id": info.get("project_id"), "jv_project_id": info.get("jv_project_id"), "location_id": info.get("location_id"),
               "calc": calc, "recommended_plan": body.recommended_plan if body.recommended_plan in {p["key"] for p in calc["plans"]} else "standard",
               "notes": body.notes, "status": "draft", "valid_until": (today + timedelta(days=int(s["quote_valid_days"]))).isoformat(),
               "created_by": user["id"], "created_by_name": user["name"], "created_at": _now().isoformat(), "history": [{"status": "draft", "at": _now().isoformat(), "by": user["name"]}]}
        res = await db.amc_quotes.insert_one(doc)
        if doc["source_id"]:
            await _resolve_offer_notes(doc["source_type"], doc["source_id"])
        await create_audit_log(user["id"], user["name"], "amc_quote_created", "amc_quote", str(res.inserted_id), None, {"number": doc["quote_number"], "kw": kw})
        return _quote_out({**doc, "_id": res.inserted_id}, await partners_map())

    @router.get("/amc/quotes")
    async def list_quotes(request: Request, org: Optional[str] = None, status: Optional[str] = None):
        user = await get_current_user(request)
        q: Dict[str, Any] = dict(scope_for(user, org or ALL))
        if status:
            q["status"] = status
        pmap = await partners_map()
        return [_quote_out(d, pmap) async for d in db.amc_quotes.find(q).sort("created_at", -1).limit(500)]

    async def _quote(quote_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
        d = await db.amc_quotes.find_one({"_id": _oid(quote_id)})
        if not d:
            raise HTTPException(status_code=404, detail="Quote not found")
        if is_partner(user) and d.get("org_id") != user.get("partner_id"):
            raise HTTPException(status_code=404, detail="Quote not found")
        return d

    @router.get("/amc/quotes/{quote_id}")
    async def get_quote(quote_id: str, request: Request):
        user = await get_current_user(request)
        return _quote_out(await _quote(quote_id, user), await partners_map())

    @router.put("/amc/quotes/{quote_id}/status")
    async def quote_status(quote_id: str, body: QuoteStatusIn, request: Request):
        user = await _editor(request)
        d = await _quote(quote_id, user)
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
        d = await _quote(quote_id, user)
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
        if d.get("jv_project_id") and await db.amc_contracts.find_one({"jv_project_id": d["jv_project_id"], "status": "active"}):
            raise HTTPException(status_code=400, detail="This customer already has an active AMC contract")
        src = {k: d.get(k) for k in ("project_id", "jv_project_id", "customer_name", "phone", "site_address", "district", "state", "system_type",
                                      "system_capacity_kw", "commissioning_date", "location_id")}
        contract = await _contract_from_source(src, d.get("org_id"), plan, start[:10], body.duration_months, user, {"quote_id": quote_id})
        await db.amc_quotes.update_one({"_id": d["_id"]}, {"$set": {"status": "accepted", "accepted_plan": plan["key"], "contract_id": str(contract["_id"]),
                                                                    "contract_number": contract["contract_number"], "updated_at": _now().isoformat()},
                                                          "$push": {"history": {"status": "accepted", "at": _now().isoformat(), "by": user["name"], "plan": plan["key"]}}})
        if d.get("source_id"):
            await _resolve_offer_notes(d["source_type"], d["source_id"])
        await create_audit_log(user["id"], user["name"], "amc_quote_accepted", "amc_quote", quote_id, None, {"plan": plan["key"], "contract": contract["contract_number"]})
        return {"ok": True, "contract": _ser(contract)}

    # ═══════════════ report ═══════════════
    @router.get("/amc/report")
    async def report(request: Request, org: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None):
        user = await get_current_user(request)
        today = _now().date()
        d_end = _to_date(end) or today
        d_start = _to_date(start) or (d_end.replace(day=1) - timedelta(days=330)).replace(day=1)
        if d_start > d_end:
            raise HTTPException(status_code=400, detail="Start must be before end")
        s0, s1 = d_start.isoformat(), d_end.isoformat()
        scope = scope_for(user, org)
        pmap = await partners_map()
        contracts = [c async for c in db.amc_contracts.find(scope)]
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
        quotes = [q async for q in db.amc_quotes.find(scope) if in_period(q.get("created_at"))]
        offers_due = await offer_rows(user, org if not is_partner(user) else ALL, include_upcoming=False)
        if not is_partner(user) and org not in (ALL,) and org and org != OURS:
            offers_due = [o for o in offers_due if o.get("org_id") == org]
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
        org_name = lambda oid: (pmap.get(oid) or {}).get("name") if oid else "Sensoper"  # noqa: E731
        by_org: Dict[str, Dict[str, Any]] = {}
        for c in active:
            k = c.get("org_id") or OURS
            row = by_org.setdefault(k, {"org_id": k, "org_name": org_name(c.get("org_id")), "active": 0, "kw": 0.0, "yearly_value": 0.0})
            row["active"] += 1
            row["kw"] += _f(c.get("system_capacity_kw"))
            row["yearly_value"] += _f(c.get("annual_value"))
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
            r = {"contract_number": c.get("contract_number"), "company": org_name(c.get("org_id")), "customer": c.get("customer_name"),
                 "district": c.get("district"), "kw": _f(c.get("system_capacity_kw")), "plan": c.get("plan_name") or c.get("contract_type"),
                 "start_date": c.get("start_date"), "end_date": c.get("end_date"), "status": c.get("status"), "visits_done": c.get("visits_completed", 0),
                 "yearly_value": _f(c.get("annual_value")), "outstanding": _f(c.get("outstanding"))}
            return r

        return {
            "title": "AMC report", "generated_at": _now().isoformat(), "period": {"start": s0, "end": s1}, "months": months,
            "org": org or OURS, "org_label": ("All companies" if org == ALL else org_name(None) if (not org or org == OURS) else org_name(org)) if not is_partner(user) else org_name(user.get("partner_id")),
            "summary": summary, "by_org": sorted(by_org.values(), key=lambda r: r["org_id"] != OURS), "monthly": list(monthly.values()),
            "contracts": [crow(c) for c in sorted(contracts, key=lambda c: c.get("start_date") or "", reverse=True)],
            "visits": [{"date": v.get("actual_date") or v.get("scheduled_date"), "contract_number": (by_id.get(v.get("contract_id")) or {}).get("contract_number"),
                        "customer": (by_id.get(v.get("contract_id")) or {}).get("customer_name"), "type": v.get("visit_type"), "technician": v.get("technician_name"),
                        "status": v.get("status")} for v in sorted(v_done + v_sched + v_overdue, key=lambda v: v.get("actual_date") or v.get("scheduled_date") or "", reverse=True)],
            "renewals_due": [{"contract_number": c.get("contract_number"), "customer": c.get("customer_name"), "company": org_name(c.get("org_id")),
                              "end_date": c.get("end_date"), "yearly_value": _f(c.get("annual_value"))} for c in renewals_due],
            "offers_due": [{"customer": o["customer_name"], "company": o.get("org_name") or "Sensoper", "kw": o["system_capacity_kw"], "commissioned_on": o["commissioned_on"],
                            "due_on": o["due_on"], "quote": (o.get("quote") or {}).get("number")} for o in offers_due],
            "quotes": [{"number": q.get("quote_number"), "customer": q.get("customer_name"), "company": org_name(q.get("org_id")), "kw": q.get("system_capacity_kw"),
                        "status": q.get("status"), "plan": q.get("accepted_plan"), "date": str(q.get("created_at"))[:10]} for q in quotes],
        }

    return router
