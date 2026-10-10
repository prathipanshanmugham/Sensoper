"""Customer dashboard (Oct 2026) — what a solar customer wants to see, behind a private link.

Staff create a private link per project (project page → Customer dashboard → Create link) and share it on
WhatsApp. The customer opens it and types their registered mobile number once; the browser then keeps a
30-day session cookie scoped to that link only. No passwords, no SMS cost.

What the customer sees: system & installation journey, breakeven (payback) with progress, savings so far,
units generated, CO₂ avoided and tree equivalent, payments and balance, AMC & next service visit, warranty,
offers (with "I'm interested"), their support tickets and a form to raise a new one, and how to reach us.

Storage
    customer_portal_links  {project_id, token_hash, token_enc, active, created_by…, last_opened_at, open_count}
    customer_offers        {title, description, badge, valid_till, cta_label, system_types[], active}
    offer_interests        {offer_id, project_id, customer_name, phone, created_at, handled}
    portal_attempts        {token_hash, at}   (rate limit for the mobile-number check)
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import jwt
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from support import open_ticket
from vault import decrypt_secret, encrypt_secret

IST = timezone(timedelta(hours=5, minutes=30))
GRID_EF_KG_PER_KWH = 0.82          # India grid CO₂ factor — same as the Solar sizing calculator
KG_CO2_PER_TREE_YEAR = 21.77       # one mature tree absorbs ~21.77 kg CO₂ a year
DEGRADATION = 0.007
LIFE_YEARS = 25
SESSION_DAYS = 30
MAX_ATTEMPTS, ATTEMPT_WINDOW_MIN = 8, 15
COOKIE = "sp_portal"
TICKET_CATEGORIES = {
    "generation_drop": "Less power than usual", "inverter_fault": "Inverter showing an error", "no_power": "No power from solar",
    "billing_query": "EB bill / payment question", "net_metering_issue": "Net meter", "physical_damage": "Damage to panels or wiring",
    "warranty_claim": "Warranty claim", "installation_query": "Question about my installation", "other": "Something else",
}
STAGES_DONE_INSTALL = "Handover done"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _digits(phone: Optional[str]) -> str:
    return re.sub(r"\D", "", phone or "")[-10:]


def _num(v, d=0.0) -> float:
    try:
        f = float(v)
        return f if f == f else d
    except (TypeError, ValueError):
        return d


def _day(value) -> Optional[date]:
    if not value:
        return None
    try:
        s = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(s).astimezone(IST).date() if "T" in s else date.fromisoformat(s[:10])
    except ValueError:
        return None


def _add_years(d: date, years: float) -> date:
    return d + timedelta(days=round(years * 365.25))


class Verify(BaseModel):
    phone: str


class TicketIn(BaseModel):
    category: str = "other"
    description: str
    contact_phone: Optional[str] = None


class OfferIn(BaseModel):
    title: str
    description: str = ""
    badge: Optional[str] = ""                # e.g. "10% off", "Free"
    valid_till: Optional[str] = None         # YYYY-MM-DD
    cta_label: Optional[str] = "I'm interested"
    system_types: List[str] = []             # empty = everyone
    active: bool = True


def build_dashboard_numbers(project: Dict[str, Any], payments: List[Dict[str, Any]], actual_units: Optional[float],
                            today: Optional[date] = None) -> Dict[str, Any]:
    """Savings, breakeven, energy and CO₂ for one project — pure, so it's easy to test."""
    today = today or _now().astimezone(IST).date()
    ps = (project.get("custom_fields") or {}).get("proposed_solution") or {}
    q, d = ps.get("_quick") or {}, ps.get("_derived") or {}
    kw = _num(ps.get("system_size_kw")) or _num((project.get("solar_system") or {}).get("system_size_kw"))
    annual_units = _num(q.get("annual_generation_units")) or _num(d.get("annual_generation_units")) or round(kw * 4.4 * 365)
    annual_saving = _num(q.get("annual_saving")) or _num(d.get("annual_savings"))
    monthly_saving = _num(q.get("monthly_saving")) or _num(d.get("monthly_savings")) or annual_saving / 12
    payback = _num(q.get("payback_years")) or _num(d.get("payback_years")) or None

    ce = project.get("cost_estimation") or {}
    price = _num(ce.get("total_cost")) or _num(ps.get("net_cost")) or _num(ps.get("total_cost"))
    subsidy = _num(ce.get("subsidy")) or _num(ps.get("subsidy"))
    paid = sum(_num(p.get("amount")) for p in payments)

    start = _day(project.get("commissioning_date")) or _day(project.get("installation_date"))
    running = bool(start and start <= today)
    years = max((today - start).days, 0) / 365.25 if running else 0.0
    est_units = annual_units * years
    units = actual_units if (actual_units and actual_units > 0) else est_units
    savings_so_far = annual_saving * years if running else 0
    lifetime_factor = sum((1 - DEGRADATION) ** i for i in range(LIFE_YEARS))
    co2_so_far = units * GRID_EF_KG_PER_KWH
    breakeven_date = _add_years(start, payback) if (start and payback) else None
    return {
        "system_size_kw": kw,
        "money": {"price": round(price), "subsidy": round(subsidy), "paid": round(paid), "balance": round(max(price - paid, 0)),
                  "paid_pct": round(min(paid / price * 100, 100)) if price > 0 else None,
                  "payments": [{"date": str(p.get("created_at") or "")[:10], "amount": round(_num(p.get("amount"))),
                                "method": p.get("payment_method", "")} for p in sorted(payments, key=lambda x: str(x.get("created_at") or ""), reverse=True)]},
        "savings": {
            "monthly": round(monthly_saving), "annual": round(annual_saving), "so_far": round(savings_so_far),
            "lifetime": round(annual_saving * lifetime_factor), "payback_years": round(payback, 1) if payback else None,
            "breakeven_date": breakeven_date.isoformat() if breakeven_date else None,
            "breakeven_pct": round(min(years / payback * 100, 100), 1) if (running and payback) else 0,
            "breakeven_reached": bool(breakeven_date and breakeven_date <= today),
            "running_since": start.isoformat() if start else None, "running": running,
        },
        "energy": {
            "annual_units": round(annual_units), "monthly_units": round(annual_units / 12),
            "units_so_far": round(units), "measured": bool(actual_units and actual_units > 0),
            "co2_kg_so_far": round(co2_so_far), "co2_kg_per_year": round(annual_units * GRID_EF_KG_PER_KWH),
            "co2_t_lifetime": round(annual_units * GRID_EF_KG_PER_KWH * lifetime_factor / 1000, 1),
            "trees_equivalent": round(co2_so_far / KG_CO2_PER_TREE_YEAR) if running else 0,
            "trees_per_year": round(annual_units * GRID_EF_KG_PER_KWH / KG_CO2_PER_TREE_YEAR),
        },
    }


def create_router(db, get_current_user, require_role, create_audit_log, jwt_secret: str):
    router = APIRouter()

    # ───────────────────────── staff side ─────────────────────────
    async def _project_for_staff(project_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
        try:
            p = await db.projects.find_one({"_id": ObjectId(project_id), "deleted_at": {"$exists": False}})
        except Exception:
            p = None
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        if user["role"] == "staff" and p.get("created_by") != user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
        return p

    def _link_out(link: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not link or not link.get("active"):
            return {"active": False}
        try:
            token = decrypt_secret(link["token_enc"])
        except HTTPException:
            token = None
        return {"active": True, "token": token, "path": f"/my/{token}" if token else None,
                "created_at": link.get("created_at"), "created_by_name": link.get("created_by_name"),
                "last_opened_at": link.get("last_opened_at"), "open_count": link.get("open_count", 0)}

    @router.get("/projects/{project_id}/portal-link")
    async def get_link(project_id: str, request: Request):
        user = await get_current_user(request)
        await _project_for_staff(project_id, user)
        return _link_out(await db.customer_portal_links.find_one({"project_id": project_id, "active": True}))

    @router.post("/projects/{project_id}/portal-link")
    async def create_link(project_id: str, request: Request):
        """Creates the link, or replaces it (the old link stops working)."""
        user = await get_current_user(request)
        p = await _project_for_staff(project_id, user)
        if len(_digits((p.get("customer") or {}).get("phone"))) < 10:
            raise HTTPException(status_code=400, detail="Add the customer's 10-digit mobile number to the project first — they use it to open the dashboard.")
        token = secrets.token_urlsafe(18)
        now = _now().isoformat()
        await db.customer_portal_links.update_many({"project_id": project_id, "active": True}, {"$set": {"active": False, "revoked_at": now}})
        doc = {"project_id": project_id, "token_hash": _hash(token), "token_enc": encrypt_secret(token), "active": True,
               "created_by": user["id"], "created_by_name": user.get("name", ""), "created_at": now, "last_opened_at": None, "open_count": 0}
        await db.customer_portal_links.insert_one(doc)
        await create_audit_log(user["id"], user.get("name", ""), "create", "customer_portal_link", project_id)
        return _link_out(doc)

    @router.delete("/projects/{project_id}/portal-link")
    async def revoke_link(project_id: str, request: Request):
        user = await get_current_user(request)
        await _project_for_staff(project_id, user)
        await db.customer_portal_links.update_many({"project_id": project_id, "active": True}, {"$set": {"active": False, "revoked_at": _now().isoformat()}})
        await create_audit_log(user["id"], user.get("name", ""), "delete", "customer_portal_link", project_id)
        return {"active": False}

    # Offers (admin / manager)
    def _offer_out(o: Dict[str, Any], interests: int = 0) -> Dict[str, Any]:
        return {**{k: v for k, v in o.items() if k != "_id"}, "id": str(o["_id"]), "interest_count": interests}

    @router.get("/customer-offers")
    async def list_offers(request: Request):
        await require_role("admin", "manager")(request)
        counts: Dict[str, int] = {}
        async for i in db.offer_interests.find({}, {"offer_id": 1}):
            counts[i["offer_id"]] = counts.get(i["offer_id"], 0) + 1
        return [_offer_out(o, counts.get(str(o["_id"]), 0)) async for o in db.customer_offers.find({}).sort("created_at", -1)]

    @router.post("/customer-offers")
    async def create_offer(body: OfferIn, request: Request):
        user = await require_role("admin", "manager")(request)
        if not body.title.strip():
            raise HTTPException(status_code=400, detail="Give the offer a title")
        doc = {**body.model_dump(), "title": body.title.strip(), "created_by_name": user.get("name", ""),
               "created_at": _now().isoformat(), "updated_at": _now().isoformat()}
        res = await db.customer_offers.insert_one(doc)
        doc["_id"] = res.inserted_id
        return _offer_out(doc)

    @router.put("/customer-offers/{offer_id}")
    async def update_offer(offer_id: str, body: OfferIn, request: Request):
        await require_role("admin", "manager")(request)
        res = await db.customer_offers.update_one({"_id": ObjectId(offer_id)}, {"$set": {**body.model_dump(), "updated_at": _now().isoformat()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Offer not found")
        return _offer_out(await db.customer_offers.find_one({"_id": ObjectId(offer_id)}))

    @router.delete("/customer-offers/{offer_id}")
    async def delete_offer(offer_id: str, request: Request):
        await require_role("admin", "manager")(request)
        await db.customer_offers.delete_one({"_id": ObjectId(offer_id)})
        return {"deleted": True}

    @router.get("/customer-offers/interests")
    async def list_interests(request: Request):
        await require_role("admin", "manager")(request)
        return [{**{k: v for k, v in i.items() if k != "_id"}, "id": str(i["_id"])}
                async for i in db.offer_interests.find({}).sort("created_at", -1).limit(500)]

    @router.put("/customer-offers/interests/{interest_id}")
    async def mark_interest(interest_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        await db.offer_interests.update_one({"_id": ObjectId(interest_id)}, {"$set": {"handled": True, "handled_by": user.get("name", ""), "handled_at": _now().isoformat()}})
        return {"handled": True}

    # ───────────────────────── customer side (public) ─────────────────────────
    async def _link(token: str) -> Dict[str, Any]:
        if not token or len(token) > 64:
            raise HTTPException(status_code=404, detail="This link isn't valid. Ask Sensoper for a new one.")
        link = await db.customer_portal_links.find_one({"token_hash": _hash(token), "active": True})
        if not link:
            raise HTTPException(status_code=404, detail="This link isn't valid any more. Ask Sensoper for a new one.")
        return link

    async def _project(link: Dict[str, Any]) -> Dict[str, Any]:
        p = await db.projects.find_one({"_id": ObjectId(link["project_id"]), "deleted_at": {"$exists": False}})
        if not p:
            raise HTTPException(status_code=404, detail="This link isn't valid any more. Ask Sensoper for a new one.")
        return p

    async def _session(token: str, request: Request) -> tuple:
        link = await _link(token)
        raw = request.cookies.get(COOKIE)
        try:
            claims = jwt.decode(raw or "", jwt_secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Confirm your mobile number to continue.")
        if claims.get("typ") != "portal" or claims.get("th") != link["token_hash"][:24]:
            raise HTTPException(status_code=401, detail="Confirm your mobile number to continue.")
        return link, await _project(link)

    async def _company() -> Dict[str, Any]:
        cp = await db.company_profiles.find_one({"is_active": True}) or {}
        return {"name": cp.get("company_name") or "Sensoper Controls & Renewables", "tagline": cp.get("tagline"),
                "logo_url": cp.get("logo_url"), "phone": cp.get("sales_contact_phone") or cp.get("phone"),
                "email": cp.get("email"), "website": cp.get("website"), "address": cp.get("address"),
                "warranty_headline": cp.get("warranty_headline")}

    @router.get("/portal/{token}/hello")
    async def hello(token: str):
        link = await _link(token)
        p = await _project(link)
        phone = _digits((p.get("customer") or {}).get("phone"))
        return {"company": await _company(), "phone_hint": f"••••••{phone[-2:]}" if phone else ""}

    @router.post("/portal/{token}/verify")
    async def verify(token: str, body: Verify, response: Response):
        link = await _link(token)
        since = _now() - timedelta(minutes=ATTEMPT_WINDOW_MIN)      # datetimes, so the TTL index can expire them
        tries = await db.portal_attempts.count_documents({"token_hash": link["token_hash"], "at": {"$gte": since}})
        if tries >= MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail=f"Too many tries. Wait {ATTEMPT_WINDOW_MIN} minutes and try again.")
        p = await _project(link)
        expected = _digits((p.get("customer") or {}).get("phone"))
        if not expected or _digits(body.phone) != expected:
            await db.portal_attempts.insert_one({"token_hash": link["token_hash"], "at": _now()})
            raise HTTPException(status_code=400, detail="That number doesn't match the one we have for this project.")
        exp = _now() + timedelta(days=SESSION_DAYS)
        session = jwt.encode({"typ": "portal", "th": link["token_hash"][:24], "pid": link["project_id"], "exp": exp}, jwt_secret, algorithm="HS256")
        response.set_cookie(COOKIE, session, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", path=f"/api/portal/{token}")
        await db.customer_portal_links.update_one({"_id": link["_id"]}, {"$set": {"last_opened_at": _now().isoformat()}, "$inc": {"open_count": 1}})
        return {"ok": True}

    @router.post("/portal/{token}/logout")
    async def logout(token: str, response: Response):
        response.delete_cookie(COOKIE, path=f"/api/portal/{token}")
        return {"ok": True}

    @router.get("/portal/{token}/dashboard")
    async def dashboard(token: str, request: Request):
        link, p = await _session(token, request)
        pid = link["project_id"]
        today = _now().astimezone(IST).date()
        cust = p.get("customer") or {}
        phone = _digits(cust.get("phone"))
        payments = await db.payments.find({"project_id": pid}).to_list(200)

        # Measured generation from Readings (matched by project ref or the customer's phone)
        actual, last_reading = 0.0, None
        async for r in db.readings.find({"$or": [{"site_ref": p.get("reference_number") or "__none__"},
                                                  {"customer_phone": {"$regex": f"{phone}$"}} if phone else {"_id": None}]}):
            for g in r.get("generation_logs") or []:
                actual += _num(g.get("kwh"))
                last_reading = max(last_reading or "", str(g.get("date") or ""))
        nums = build_dashboard_numbers(p, payments, actual or None, today)
        nums["energy"]["last_reading"] = last_reading or None

        ps = (p.get("custom_fields") or {}).get("proposed_solution") or {}
        q = ps.get("_quick") or {}
        names = {}
        for key in ("panel_item_id", "inverter_item_id", "battery_item_id"):
            if ps.get(key) and ObjectId.is_valid(ps[key]):
                it = await db.inventory_items.find_one({"_id": ObjectId(ps[key])}, {"name": 1})
                names[key] = (it or {}).get("name")

        diaries = await db.site_diaries.find({"project_id": pid}).sort("date", 1).to_list(500)
        stages_done = {s for dd in diaries for s in (dd.get("stages_done") or [])}
        progress = max([_num(dd.get("progress_pct")) for dd in diaries if dd.get("progress_pct") is not None] or [0])
        commissioned = _day(p.get("commissioning_date"))
        completed = p.get("status") == "completed" or STAGES_DONE_INSTALL in stages_done
        journey = [
            {"key": "visit", "label": "Site visit & design", "done": True, "date": p.get("project_date") or str(p.get("created_at") or "")[:10]},
            {"key": "approved", "label": "Quotation approved", "done": p.get("status") in ("approved", "completed") or bool(p.get("approved_at")),
             "date": str(p.get("approved_at") or "")[:10] or None},
            {"key": "install", "label": "Installation", "done": completed or bool(commissioned and commissioned <= today) or progress >= 100,
             "active": bool(diaries) and not completed, "date": diaries[0]["date"] if diaries else (p.get("installation_date") or None),
             "detail": (f"{round(progress)}% done" + (f" · {diaries[-1]['stages_done'][-1]}" if diaries and diaries[-1].get("stages_done") else "")) if diaries else None},
            {"key": "commissioned", "label": "Switched on", "done": bool(commissioned and commissioned <= today), "date": p.get("commissioning_date")},
            {"key": "netmeter", "label": "Net meter", "done": "Net-meter applied" in stages_done, "date": None},
            {"key": "handover", "label": "Handed over", "done": completed, "date": None},
        ]
        # A later step being done means the earlier ones are too (net meter runs on its own DISCOM timeline)
        seen_done = False
        for j in reversed(journey):
            if j["key"] == "netmeter":
                continue
            if j["done"]:
                seen_done = True
            elif seen_done:
                j["done"], j["active"] = True, False

        amc = None
        c = await db.amc_contracts.find_one({"project_id": pid, "status": {"$in": ["active", "renewed"]}}, sort=[("start_date", -1)])
        if c:
            visits = await db.amc_service_visits.find({"contract_id": str(c["_id"])}).to_list(100)
            upcoming = sorted([v for v in visits if v.get("status") == "scheduled" and (v.get("scheduled_date") or "") >= today.isoformat()], key=lambda v: v.get("scheduled_date") or "")
            done = sorted([v for v in visits if v.get("status") == "completed"], key=lambda v: v.get("actual_date") or v.get("scheduled_date") or "")
            amc = {"contract_type": c.get("contract_type"), "start_date": c.get("start_date"), "end_date": c.get("end_date"),
                   "visits_per_year": c.get("visits_per_year"), "next_visit": (upcoming[0].get("scheduled_date") if upcoming else None),
                   "last_visit": ((done[-1].get("actual_date") or done[-1].get("scheduled_date")) if done else None)}

        stype = ps.get("system_type") or (p.get("solar_system") or {}).get("system_type") or "on-grid"
        interested = {i["offer_id"] async for i in db.offer_interests.find({"project_id": pid}, {"offer_id": 1})}
        offers = []
        async for o in db.customer_offers.find({"active": True}).sort("created_at", -1):
            if o.get("valid_till") and o["valid_till"] < today.isoformat():
                continue
            if o.get("system_types") and stype not in o["system_types"]:
                continue
            offers.append({"id": str(o["_id"]), "title": o.get("title"), "description": o.get("description", ""), "badge": o.get("badge") or "",
                           "valid_till": o.get("valid_till"), "cta_label": o.get("cta_label") or "I'm interested", "interested": str(o["_id"]) in interested})

        tickets = []
        async for t in db.support_tickets.find({"project_id": pid}).sort("created_at", -1).limit(30):
            last = (t.get("timeline") or [{}])[-1]
            tickets.append({"id": str(t["_id"]), "number": t.get("ticket_number"), "category": TICKET_CATEGORIES.get(t.get("category"), "Request"),
                            "status": t.get("status"), "created_at": t.get("created_at"), "description": (t.get("description") or "")[:200],
                            "last_update": last.get("note") if last.get("action") != "created" else None, "updated_at": t.get("updated_at")})

        return {
            "company": await _company(),
            "customer": {"name": cust.get("name", ""), "address": (p.get("location") or {}).get("address") or cust.get("address", ""),
                         "phone_masked": f"••••••{phone[-4:]}" if phone else ""},
            "project": {"reference": p.get("reference_number"), "system_type": stype, "size_kw": nums["system_size_kw"],
                        "panels": {"count": ps.get("panel_count") or q.get("panel_count"), "watt": q.get("panel_wattage_w"), "name": names.get("panel_item_id")},
                        "inverter": names.get("inverter_item_id") or (f"{q.get('inverter_rated_kw')} kW" if q.get("inverter_rated_kw") else None),
                        "battery": ({"count": ps.get("battery_count"), "name": names.get("battery_item_id")} if ps.get("battery_count") else None),
                        "project_date": p.get("project_date"), "installation_date": p.get("installation_date"),
                        "commissioning_date": p.get("commissioning_date"), "status": p.get("status")},
            "journey": journey, "progress_pct": round(progress),
            **{k: nums[k] for k in ("money", "savings", "energy")},
            "amc": amc, "offers": offers, "tickets": tickets,
            "ticket_categories": [{"value": k, "label": v} for k, v in TICKET_CATEGORIES.items()],
            "factors": {"grid_kg_co2_per_kwh": GRID_EF_KG_PER_KWH, "kg_co2_per_tree_year": KG_CO2_PER_TREE_YEAR},
        }

    @router.post("/portal/{token}/tickets")
    async def raise_ticket(token: str, body: TicketIn, request: Request):
        link, p = await _session(token, request)
        text = (body.description or "").strip()
        if len(text) < 5:
            raise HTTPException(status_code=400, detail="Tell us a little more about the problem.")
        cat = body.category if body.category in TICKET_CATEGORIES else "other"
        recent = await db.support_tickets.count_documents({"project_id": link["project_id"], "reported_via": "customer_dashboard",
                                                           "created_at": {"$gte": (_now() - timedelta(hours=1)).isoformat()}})
        if recent >= 5:
            raise HTTPException(status_code=429, detail="You've raised several requests in the last hour — we're on it. Please call us if it's urgent.")
        cust = p.get("customer") or {}
        row = await open_ticket(db, {
            "customer_name": cust.get("name") or "Customer", "contact_phone": body.contact_phone or cust.get("phone") or "",
            "contact_email": cust.get("email") or "", "project_id": link["project_id"], "category": cat,
            "priority": "high" if cat in ("no_power", "inverter_fault", "physical_damage") else "medium",
            "description": text[:2000], "reported_via": "customer_dashboard",
        }, actor_name=cust.get("name") or "Customer", note="Raised by the customer from their dashboard")
        return {"id": row["id"], "number": row.get("ticket_number"), "status": row.get("status")}

    @router.post("/portal/{token}/offers/{offer_id}/interest")
    async def offer_interest(token: str, offer_id: str, request: Request):
        link, p = await _session(token, request)
        try:
            o = await db.customer_offers.find_one({"_id": ObjectId(offer_id), "active": True})
        except Exception:
            o = None
        if not o:
            raise HTTPException(status_code=404, detail="This offer has ended.")
        cust = p.get("customer") or {}
        await db.offer_interests.update_one({"offer_id": offer_id, "project_id": link["project_id"]}, {"$setOnInsert": {
            "offer_id": offer_id, "offer_title": o.get("title"), "project_id": link["project_id"], "reference_number": p.get("reference_number"),
            "customer_name": cust.get("name"), "phone": cust.get("phone"), "created_at": _now().isoformat(), "handled": False}}, upsert=True)
        return {"interested": True}

    return router
