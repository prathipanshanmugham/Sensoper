"""Leads (CRM) — one inbox for every enquiry, whoever took it and wherever it came from.

Phone calls, walk-ins, WhatsApp, referrals, IndiaMART / JustDial, ads and the website all land in the same
`website_leads` collection (the name is historical: the website was the first source). The website keeps writing
there exactly as before; this module adds what a sales team needs on top:

  * a next follow-up (date, optional time and what to do) that reminds the owner in the bell at that time;
  * a 2-second "log a call" with the outcome, which also moves a New lead to Called;
  * owner, value, size (kW), hot / warm / cold, and where it came from;
  * counts for the strip at the top of the page (due today, overdue, new) and the menu badge;
  * one search over leads, quotations, projects and stock for Ctrl+K.

Who sees what: admins, and roles with "See everyone's leads" (managers by default), see every lead in their
branches. Everyone else sees the leads given to them, the ones they added, and the ones nobody has taken yet.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

import notify
from locations import location_allowed, location_scope_filter
from website import KINDS, OPEN_STATUSES, SOURCES as WEB_SOURCES, STATUSES, lead_summary, mobile

IST = timezone(timedelta(hours=5, minutes=30))

CHANNELS = {
    "phone": "Phone call", "walk_in": "Walk-in", "whatsapp": "WhatsApp", "referral": "Referral",
    "existing": "Existing customer", "partner": "Dealer / partner", "indiamart": "IndiaMART", "justdial": "JustDial",
    "google_ads": "Google ads", "meta_ads": "Facebook / Instagram ads", "exhibition": "Exhibition / event",
    "field": "Field visit", "website": "Website", "other": "Other",
}
HEAT = {"hot": "Hot", "warm": "Warm", "cold": "Cold"}
ACTIVITY_TYPES = {"call": "Call", "whatsapp": "WhatsApp", "visit": "Visit", "meeting": "Meeting", "email": "Email", "note": "Note"}
OUTCOMES = {
    "answered": "Talked", "no_answer": "No answer", "busy": "Busy / switched off", "call_back": "Asked to call back later",
    "interested": "Interested", "not_interested": "Not interested",
}
LOST_REASONS = ["Price too high", "Went with another company", "Not ready yet", "Not possible at the site",
                "Couldn't reach them", "Only asking prices", "Other"]
CLOSED = ("won", "lost")
QUOTE_LABELS = {"draft": "Draft", "sent": "Sent", "accepted": "Accepted", "rejected": "Not accepted", "converted": "Sold"}
MAX_VALUE = 1_000_000_000      # ₹100 crore — more is a typing slip


# ───────────────────────── small helpers ─────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


def today_ist() -> str:
    return _now().astimezone(IST).date().isoformat()


def _clean(text: Any, limit: int) -> str:
    s = re.sub(r"<[^<>]*>", " ", str(text or "")[: max(limit, 1) * 4])
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", s)
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s[:limit]


def _oid(v: Any, what: str = "lead") -> ObjectId:
    if not ObjectId.is_valid(str(v or "")):
        raise HTTPException(status_code=404, detail=f"That {what} doesn't exist")
    return ObjectId(str(v))


def _date(v: Any, label: str = "date") -> Optional[str]:
    d = str(v or "").strip()[:10]
    if not d:
        return None
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
        raise HTTPException(status_code=400, detail=f"The {label} should look like 2026-11-30")
    try:
        datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{d} isn't a real date")
    return d


def _time(v: Any) -> Optional[str]:
    t = str(v or "").strip()[:5]
    if not t:
        return None
    if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", t):
        raise HTTPException(status_code=400, detail="The time should look like 10:30 (24-hour)")
    return t


def _money(v: Any, label: str) -> Optional[float]:
    if v in (None, ""):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"The {label} should be a number")
    if not math.isfinite(f) or f < 0 or f > MAX_VALUE:
        raise HTTPException(status_code=400, detail=f"The {label} should be between 0 and ₹100 crore")
    return round(f, 2)


def _kw(v: Any) -> Optional[float]:
    if v in (None, ""):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="The size should be a number of kW, like 5")
    if not math.isfinite(f) or f < 0 or f > 100000:
        raise HTTPException(status_code=400, detail="The size should be between 0 and 100,000 kW")
    return round(f, 2)


def channel_of(lead: Dict[str, Any]) -> str:
    ch = lead.get("channel")
    if ch in CHANNELS:
        return ch
    # leads saved by the website before channels existed
    return "website" if (lead.get("source") in WEB_SOURCES or not lead.get("source")) else "other"


def follow_up_state(lead: Dict[str, Any], today: Optional[str] = None) -> Optional[str]:
    """overdue / today / upcoming — only for open leads with a date."""
    d = lead.get("follow_up_on")
    if not d or lead.get("status") in CLOSED:
        return None
    today = today or today_ist()
    return "overdue" if d < today else "today" if d == today else "upcoming"


def follow_up_utc(day: str, at: Optional[str]) -> str:
    """When the reminder should ring: the time given, or 09:30 IST on that day."""
    hh, mm = (at or "09:30").split(":")
    local = datetime.strptime(day, "%Y-%m-%d").replace(hour=int(hh), minute=int(mm), tzinfo=IST)
    return local.astimezone(timezone.utc).isoformat()


def nice_day(d: Optional[str]) -> str:
    """'Wed 26 Nov' for a YYYY-MM-DD date (history lines read better than an ISO date)."""
    try:
        return datetime.strptime(str(d)[:10], "%Y-%m-%d").strftime("%a %d %b").replace(" 0", " ")
    except (TypeError, ValueError):
        return str(d or "")


def inr(v: Any, paise: bool = False) -> str:
    """₹ with Indian digit grouping: ₹11,31,277 (or ₹17,644.11 with paise=True)."""
    f = float(v or 0)
    if paise:
        whole = int(abs(round(f, 2)))
        p = int(round((abs(round(f, 2)) - whole) * 100))
        return f"{'-' if f < 0 else ''}{inr(whole)}.{p:02d}"
    n = int(round(f))
    neg, s = n < 0, str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = ",".join([head[max(i - 2, 0):i] for i in range(len(head), 0, -2)][::-1])
        s = f"{head},{tail}"
    return f"{'-' if neg else ''}₹{s}"


def month_start_utc() -> str:
    t = _now().astimezone(IST)
    return t.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()


async def plan_follow_up(db, lead: Dict[str, Any]) -> None:
    """Plan the owner's bell note for the next follow-up (or clear it when there is none / the lead is closed).
    Also used by the Odoo sync for leads it brings in."""
    lid = str(lead["_id"])
    await notify.clear(db, "lead_follow_up", "lead", lid)
    day = lead.get("follow_up_on")
    owner = lead.get("assigned_to") or lead.get("created_by")
    if not day or not owner or lead.get("status") in CLOSED:
        return
    who = lead.get("name") or f"+91 {lead.get('phone')}"
    await notify.plan(db, kind="lead_follow_up", source_type="lead", source_id=lid, user_ids=[owner],
                      title=f"Follow up: {who}", message=lead.get("follow_up_note") or lead_summary(lead),
                      link=f"/dashboard/leads?lead={lid}", notify_at=follow_up_utc(day, lead.get("follow_up_at")),
                      tag=f"{day} {lead.get('follow_up_at') or ''}".strip())


# ───────────────────────── request bodies ─────────────────────────
class LeadCreate(BaseModel):
    name: str = Field("", max_length=200)
    phone: str = Field("", max_length=40)
    email: Optional[str] = Field("", max_length=200)
    company: Optional[str] = Field("", max_length=200)
    area: Optional[str] = Field("", max_length=200)
    city: Optional[str] = Field("", max_length=120)
    pincode: Optional[str] = Field("", max_length=20)
    kind: Optional[str] = "other"
    channel: Optional[str] = "phone"
    referred_by: Optional[str] = Field("", max_length=120)
    heat: Optional[str] = "warm"
    value: Optional[Any] = None
    kw: Optional[Any] = None
    message: Optional[str] = Field("", max_length=4000)
    assigned_to: Optional[str] = None          # None → the person adding it
    follow_up_on: Optional[str] = None
    follow_up_at: Optional[str] = None
    follow_up_note: Optional[str] = Field("", max_length=300)
    location_id: Optional[str] = None
    allow_duplicate: bool = False


class LeadPatch(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=40)
    email: Optional[str] = Field(None, max_length=200)
    company: Optional[str] = Field(None, max_length=200)
    area: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, max_length=120)
    pincode: Optional[str] = Field(None, max_length=20)
    kind: Optional[str] = None
    channel: Optional[str] = None
    referred_by: Optional[str] = Field(None, max_length=120)
    heat: Optional[str] = None
    value: Optional[Any] = None
    kw: Optional[Any] = None
    message: Optional[str] = Field(None, max_length=4000)
    status: Optional[str] = None
    lost_reason: Optional[str] = Field(None, max_length=200)
    assigned_to: Optional[str] = None          # "" = nobody
    follow_up_on: Optional[str] = None         # "" = clear
    follow_up_at: Optional[str] = None
    follow_up_note: Optional[str] = Field(None, max_length=300)
    project_id: Optional[str] = None           # "" = unlink
    location_id: Optional[str] = None


class ActivityIn(BaseModel):
    type: str = "call"
    outcome: Optional[str] = None
    text: Optional[str] = Field("", max_length=2000)
    follow_up_on: Optional[str] = None         # set the next follow-up in the same step
    follow_up_at: Optional[str] = None
    follow_up_note: Optional[str] = Field("", max_length=300)
    done: bool = True                          # this was the follow-up that was due → clear it unless a new one is given


# ───────────────────────── router ─────────────────────────
def create_router(db, get_current_user, get_permissions, check_module_permission, create_audit_log):
    router = APIRouter()

    async def _perms(user: Dict[str, Any]) -> Dict[str, Any]:
        return await get_permissions(user.get("role", "staff"))

    async def _sees_all(user: Dict[str, Any]) -> bool:
        return user.get("role") == "admin" or bool((await _perms(user)).get("can_see_all_leads"))

    async def _can(user: Dict[str, Any], module: str, action: str = "view") -> bool:
        return user.get("role") == "admin" or await check_module_permission(user, module, action)

    async def _scope(user: Dict[str, Any]) -> Dict[str, Any]:
        """The leads this person may see, as a query."""
        parts: List[Dict[str, Any]] = []
        loc = location_scope_filter(user)
        if loc:
            parts.append(loc)
        if not await _sees_all(user):
            uid = user["id"]
            parts.append({"$or": [{"assigned_to": uid}, {"created_by": uid}, {"assigned_to": {"$in": [None, ""]}},
                                  {"assigned_to": {"$exists": False}}]})
        if not parts:
            return {}
        return parts[0] if len(parts) == 1 else {"$and": parts}

    async def _visible(user: Dict[str, Any], lead: Dict[str, Any]) -> bool:
        if not location_allowed(user, lead.get("location_id")):
            return False
        if await _sees_all(user):
            return True
        uid = user["id"]
        return lead.get("assigned_to") in (uid, None, "") or lead.get("created_by") == uid

    async def _lead_for(user: Dict[str, Any], lead_id: str) -> Dict[str, Any]:
        lead = await db.website_leads.find_one({"_id": _oid(lead_id)})
        if not lead or not await _visible(user, lead):
            raise HTTPException(status_code=404, detail="That lead doesn't exist")
        return lead

    async def _person(user_id: str) -> Dict[str, Any]:
        u = await db.users.find_one({"_id": _oid(user_id, "person"), "active": {"$ne": False}}, {"name": 1, "email": 1})
        if not u:
            raise HTTPException(status_code=400, detail="That person isn't on the team")
        return {"id": str(u["_id"]), "name": u.get("name") or u.get("email") or "Someone"}

    async def _quotes_of(lead_id: str) -> List[Dict[str, Any]]:
        rows = await db.material_quotes.find({"lead_id": lead_id}, {"number": 1, "revision": 1, "status": 1, "grand_total": 1,
                                                                    "created_at": 1, "valid_until": 1}).sort("created_at", -1).to_list(50)
        return [{"id": str(q["_id"]), "number": q.get("number"), "revision": q.get("revision", 0), "status": q.get("status"),
                 "grand_total": q.get("grand_total", 0), "created_at": q.get("created_at"), "valid_until": q.get("valid_until")} for q in rows]

    def _out(l: Dict[str, Any], today: Optional[str] = None) -> Dict[str, Any]:
        acts = l.get("activity") or []
        last = acts[-1] if acts else None
        ch = channel_of(l)
        source_label = (WEB_SOURCES.get(l.get("source")) or "Website") if ch == "website" else CHANNELS.get(ch, "Other")
        return {
            "id": str(l["_id"]), "number": l.get("number"), "name": l.get("name") or "", "phone": l.get("phone") or "",
            "email": l.get("email") or "", "company": l.get("company") or "", "area": l.get("area") or "", "city": l.get("city") or "",
            "pincode": l.get("pincode") or "", "kind": l.get("kind") or "other", "kind_label": KINDS.get(l.get("kind"), "Enquiry"),
            "channel": ch, "channel_label": CHANNELS.get(ch, "Other"), "source_label": source_label, "referred_by": l.get("referred_by") or "",
            "status": l.get("status") or "new", "status_label": STATUSES.get(l.get("status"), l.get("status")),
            "heat": l.get("heat") if l.get("heat") in HEAT else None, "value": l.get("value"), "kw": l.get("kw"),
            "assigned_to": l.get("assigned_to") or None, "assigned_to_name": l.get("assigned_to_name") if l.get("assigned_to") else None,
            "follow_up_on": l.get("follow_up_on") or None, "follow_up_at": l.get("follow_up_at") or None,
            "follow_up_note": l.get("follow_up_note") or "", "follow_up_state": follow_up_state(l, today),
            "last_contacted_at": l.get("last_contacted_at"), "contact_count": int(l.get("contact_count") or 0),
            "last_activity": {"text": last.get("text"), "at": last.get("at"), "by": last.get("by"), "type": last.get("type")} if last else None,
            "message": l.get("message") or "", "summary": lead_summary(l), "needs_attention": bool(l.get("needs_attention")),
            "submissions": int(l.get("submissions") or 1), "lost_reason": l.get("lost_reason") or "",
            "project_id": l.get("project_id") or None, "project_reference": l.get("project_reference") or None,
            "quote_count": int(l.get("quote_count") or 0), "location_id": l.get("location_id"),
            "created_at": l.get("created_at"), "updated_at": l.get("updated_at"), "closed_at": l.get("closed_at"),
            "created_by": l.get("created_by"), "created_by_name": l.get("created_by_name") or ("Website" if ch == "website" else None),
        }

    def _detail(l: Dict[str, Any]) -> Dict[str, Any]:
        out = _out(l)
        out.update({"activity": list(reversed(l.get("activity") or []))[:200], "calc": l.get("calc") or {}, "utm": l.get("utm") or {},
                    "items": l.get("items") or [], "order_total": l.get("order_total"), "delivery": l.get("delivery"),
                    "address": l.get("address") or "", "pickup_store": l.get("pickup_store"), "best_time": l.get("best_time") or "",
                    "page": l.get("page") or ""})
        o = l.get("odoo") or {}
        if o.get("id"):   # brought in from Odoo: what Odoo says, for the "From Odoo" box (not the copy-tracking values)
            out["odoo"] = {"model": o.get("model"), "id": o.get("id"), "stage": o.get("stage"), "salesperson": o.get("salesperson"),
                           "extra": o.get("extra") or {}, "extra_labels": {}, "synced_at": o.get("synced_at")}
        return out

    async def _remind(lead: Dict[str, Any]) -> None:
        await plan_follow_up(db, lead)

    async def _tell_new_owner(lead: Dict[str, Any], by: Dict[str, Any]) -> None:
        owner = lead.get("assigned_to")
        if not owner or owner == by.get("id"):
            return
        who = lead.get("name") or f"+91 {lead.get('phone')}"
        await notify.plan(db, kind="lead_assigned", source_type="lead", source_id=str(lead["_id"]), user_ids=[owner],
                          title=f"New lead for you: {who}", message=f"From {by.get('name') or 'a colleague'} — {lead_summary(lead)}",
                          link=f"/dashboard/leads?lead={lead['_id']}", tag=f"assigned-{_iso()[:16]}")

    async def _next_number() -> str:
        doc = await db.counters.find_one_and_update({"_id": "crm_lead"}, {"$inc": {"seq": 1}}, upsert=True,
                                                    return_document=ReturnDocument.AFTER)
        return f"L-{int(doc['seq']):04d}"

    def _choice(v: Optional[str], allowed: Dict[str, str], label: str, default: Optional[str] = None) -> Optional[str]:
        if v in (None, ""):
            return default
        if v not in allowed:
            raise HTTPException(status_code=400, detail=f"Pick one of the listed {label}")
        return v

    # ───────────── list, counts, people ─────────────
    @router.get("/crm/meta")
    async def meta(request: Request):
        user = await get_current_user(request)
        q: Dict[str, Any] = {"active": {"$ne": False}}
        people = []
        role_sees: Dict[str, bool] = {}
        async for u in db.users.find(q, {"name": 1, "email": 1, "role": 1}).sort("name", 1):
            role = u.get("role", "staff")
            if role not in role_sees:
                role_sees[role] = role == "admin" or bool(((await get_permissions(role)).get("module_leads") or {}).get("view"))
            if role_sees[role]:
                people.append({"id": str(u["_id"]), "name": u.get("name") or u.get("email")})
        return {
            "stages": [{"key": k, "label": v, "open": k in OPEN_STATUSES} for k, v in STATUSES.items()],
            "kinds": [{"key": k, "label": v} for k, v in KINDS.items() if k != "shop_order"],
            "channels": [{"key": k, "label": v} for k, v in CHANNELS.items()],
            "heat": [{"key": k, "label": v} for k, v in HEAT.items()],
            "activity_types": [{"key": k, "label": v} for k, v in ACTIVITY_TYPES.items()],
            "outcomes": [{"key": k, "label": v} for k, v in OUTCOMES.items()],
            "lost_reasons": LOST_REASONS, "people": people, "me": user["id"], "sees_all": await _sees_all(user),
            "today": today_ist(), "odoo": await _odoo_meta(),
        }

    async def _odoo_meta() -> Optional[Dict[str, Any]]:
        """Odoo's address and the labels of extra Odoo fields on leads (for the "From Odoo" box) — never the key."""
        s = await db.odoo_settings.find_one({"_id": "main"}, {"url": 1, "syncs.leads.extra_labels": 1})
        if not s or not s.get("url"):
            return None
        return {"url": s["url"], "lead_fields": ((s.get("syncs") or {}).get("leads") or {}).get("extra_labels") or {}}

    async def _counts(user: Dict[str, Any], base: Dict[str, Any]) -> Dict[str, Any]:
        today = today_ist()
        open_q = {**base, "status": {"$in": list(OPEN_STATUSES)}} if base else {"status": {"$in": list(OPEN_STATUSES)}}

        def q(extra: Dict[str, Any]) -> Dict[str, Any]:
            return {"$and": [open_q, extra]}
        won_q = {"$and": [base or {}, {"status": "won", "closed_at": {"$gte": month_start_utc()}}]}
        won = await db.website_leads.find(won_q, {"value": 1}).to_list(5000)
        mine = {"$or": [{"assigned_to": user["id"]}, {"$and": [{"assigned_to": {"$in": [None, ""]}}, {"created_by": user["id"]}]}]}
        return {
            "open": await db.website_leads.count_documents(open_q),
            "new": await db.website_leads.count_documents({"$and": [base or {}, {"status": "new"}]}),
            "due_today": await db.website_leads.count_documents(q({"follow_up_on": today})),
            "overdue": await db.website_leads.count_documents(q({"follow_up_on": {"$lt": today, "$nin": [None, ""]}})),
            "no_follow_up": await db.website_leads.count_documents(q({"$or": [{"follow_up_on": {"$in": [None, ""]}}, {"follow_up_on": {"$exists": False}}]})),
            "mine_due": await db.website_leads.count_documents(q({"$and": [mine, {"follow_up_on": {"$lte": today, "$nin": [None, ""]}}]})),
            "won_month": len(won), "won_month_value": round(sum(float(w.get("value") or 0) for w in won), 2),
            "by_stage": {k: await db.website_leads.count_documents({"$and": [base or {}, {"status": k}]}) for k in STATUSES},
        }

    @router.get("/crm/summary")
    async def summary(request: Request):
        user = await get_current_user(request)
        return await _counts(user, await _scope(user))

    @router.get("/crm/leads")
    async def list_leads(request: Request, view: str = "open", stage: Optional[str] = None, owner: Optional[str] = None,
                         channel: Optional[str] = None, kind: Optional[str] = None, heat: Optional[str] = None,
                         q: Optional[str] = None, limit: int = 300):
        user = await get_current_user(request)
        base = await _scope(user)
        today = today_ist()
        parts: List[Dict[str, Any]] = [base] if base else []
        if view == "today":
            parts.append({"status": {"$in": list(OPEN_STATUSES)}, "follow_up_on": {"$lte": today, "$nin": [None, ""]}})
        elif view == "overdue":
            parts.append({"status": {"$in": list(OPEN_STATUSES)}, "follow_up_on": {"$lt": today, "$nin": [None, ""]}})
        elif view == "new":
            parts.append({"status": "new"})
        elif view == "no_follow_up":
            parts.append({"status": {"$in": list(OPEN_STATUSES)}})
            parts.append({"$or": [{"follow_up_on": {"$in": [None, ""]}}, {"follow_up_on": {"$exists": False}}]})
        elif view in ("won", "lost"):
            parts.append({"status": view})
        elif view == "open":
            parts.append({"status": {"$in": list(OPEN_STATUSES)}})
        elif view != "all":
            raise HTTPException(status_code=400, detail="Unknown view")
        if stage:
            if stage not in STATUSES:
                raise HTTPException(status_code=400, detail="Pick one of the listed stages")
            parts.append({"status": stage})
        if owner == "me":
            parts.append({"assigned_to": user["id"]})
        elif owner == "none":
            parts.append({"$or": [{"assigned_to": {"$in": [None, ""]}}, {"assigned_to": {"$exists": False}}]})
        elif owner:
            parts.append({"assigned_to": owner})
        if channel:
            if channel not in CHANNELS:
                raise HTTPException(status_code=400, detail="Pick one of the listed sources")
            parts.append({"channel": channel} if channel != "website" else
                         {"$or": [{"channel": "website"}, {"channel": {"$exists": False}}, {"channel": None}]})
        if kind:
            parts.append({"kind": kind})
        if heat:
            parts.append({"heat": heat})
        if q and q.strip():
            rx = re.escape(q.strip()[:60])
            digits = re.sub(r"\D", "", q)
            ors: List[Dict[str, Any]] = [{"name": {"$regex": rx, "$options": "i"}}, {"number": {"$regex": rx, "$options": "i"}},
                                         {"area": {"$regex": rx, "$options": "i"}}, {"city": {"$regex": rx, "$options": "i"}},
                                         {"company": {"$regex": rx, "$options": "i"}}, {"email": {"$regex": rx, "$options": "i"}}]
            if len(digits) >= 3:
                ors.append({"phone": {"$regex": re.escape(digits[-10:])}})
                ors.append({"pincode": {"$regex": re.escape(digits[:6])}})
            parts.append({"$or": ors})
        query = {} if not parts else parts[0] if len(parts) == 1 else {"$and": parts}
        rows = await db.website_leads.find(query, {"ip": 0}).sort("updated_at", -1).limit(max(1, min(limit, 1000))).to_list(1000)
        items = [_out(r, today) for r in rows]

        rank = {"overdue": 0, "today": 1}

        def key(x: Dict[str, Any]):
            st = x["follow_up_state"]
            # what to do first: overdue, then today (by time), then fresh website enquiries, then the rest by next date / recency
            return (rank.get(st, 2), 0 if x["needs_attention"] else 1, x["follow_up_on"] or "9999", x["follow_up_at"] or "99:99",
                    -(datetime.fromisoformat(x["updated_at"]).timestamp() if x.get("updated_at") else 0))
        if view not in ("won", "lost", "all"):
            items.sort(key=key)
        return {"items": items, "counts": await _counts(user, base), "today": today}

    @router.get("/crm/leads/{lead_id}")
    async def get_lead(lead_id: str, request: Request):
        user = await get_current_user(request)
        lead = await _lead_for(user, lead_id)
        out = _detail(lead)
        out["quotes"] = await _quotes_of(lead_id) if await _can(user, "module_material_quotes") else []
        return out

    # ───────────── create ─────────────
    @router.post("/crm/leads")
    async def create_lead(body: LeadCreate, request: Request):
        user = await get_current_user(request)
        phone = mobile(body.phone)
        if not phone:
            raise HTTPException(status_code=400, detail="Enter a 10-digit mobile number")
        name = _clean(body.name, 80)
        location_id = body.location_id or user.get("default_location_id")
        if location_id and not location_allowed(user, location_id):
            raise HTTPException(status_code=403, detail="You can only add leads for your own branch")
        if not body.allow_duplicate:
            dup = await db.website_leads.find_one({"phone": phone, "status": {"$in": list(OPEN_STATUSES)}}, sort=[("created_at", -1)])
            if dup:
                can_open = await _visible(user, dup)
                return {"created": False, "existing": {
                    "id": str(dup["_id"]) if can_open else None, "number": dup.get("number"), "name": dup.get("name") or "",
                    "status_label": STATUSES.get(dup.get("status"), dup.get("status")),
                    "assigned_to_name": dup.get("assigned_to_name") if dup.get("assigned_to") else None, "can_open": can_open}}
        owner = await _person(body.assigned_to) if body.assigned_to else {"id": user["id"], "name": user.get("name") or user.get("email")}
        fu_on = _date(body.follow_up_on, "follow-up date")
        fu_at = _time(body.follow_up_at) if fu_on else None
        now = _iso()
        by = user.get("name") or user.get("email") or "Someone"
        channel = _choice(body.channel, CHANNELS, "sources", "phone")
        kind = _choice(body.kind if body.kind != "shop_order" else "other", KINDS, "enquiry types", "other")
        email = _clean(body.email, 120)
        pin = re.sub(r"\D", "", body.pincode or "")[:6]
        doc = {
            "number": await _next_number(), "name": name, "phone": phone,
            "email": email if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email or "") else "",
            "company": _clean(body.company, 120), "area": _clean(body.area, 80), "city": _clean(body.city, 60),
            "pincode": pin if len(pin) == 6 else "", "kind": kind, "channel": channel, "source": "crm",
            "referred_by": _clean(body.referred_by, 80), "heat": _choice(body.heat, HEAT, "temperatures", "warm"),
            "value": _money(body.value, "value"), "kw": _kw(body.kw), "message": _clean(body.message, 2000),
            "status": "new", "needs_attention": False, "submissions": 1,
            "assigned_to": owner["id"], "assigned_to_name": owner["name"],
            "follow_up_on": fu_on, "follow_up_at": fu_at, "follow_up_note": _clean(body.follow_up_note, 200) if fu_on else "",
            "location_id": location_id or None, "created_by": user["id"], "created_by_name": by,
            "created_at": now, "updated_at": now, "last_submitted_at": now, "contact_count": 0, "quote_count": 0,
            "activity": [{"at": now, "by": by, "by_id": user["id"], "type": "created",
                          "text": f"Added — {CHANNELS[channel]}" + (f", referred by {_clean(body.referred_by, 80)}" if body.referred_by else "")}],
        }
        if owner["id"] != user["id"]:
            doc["activity"].append({"at": now, "by": by, "by_id": user["id"], "type": "assigned", "text": f"Given to {owner['name']}"})
        if fu_on:
            doc["activity"].append({"at": now, "by": by, "by_id": user["id"], "type": "follow_up",
                                    "text": f"Follow up on {nice_day(fu_on)}{' at ' + fu_at if fu_at else ''}" + (f": {doc['follow_up_note']}" if doc["follow_up_note"] else "")})
        res = await db.website_leads.insert_one(doc)
        doc["_id"] = res.inserted_id
        await _remind(doc)
        await _tell_new_owner(doc, user)
        return {"created": True, "lead": _detail(doc)}

    # ───────────── update ─────────────
    @router.put("/crm/leads/{lead_id}")
    async def update_lead(lead_id: str, body: LeadPatch, request: Request):
        user = await get_current_user(request)
        lead = await _lead_for(user, lead_id)
        now = _iso()
        by = user.get("name") or user.get("email") or "Someone"
        upd: Dict[str, Any] = {"updated_at": now, "needs_attention": False}
        log: List[Dict[str, Any]] = []

        def note(t: str, kind: str = "edit"):
            log.append({"at": now, "by": by, "by_id": user["id"], "type": kind, "text": t})

        if body.phone is not None:
            p = mobile(body.phone)
            if not p:
                raise HTTPException(status_code=400, detail="Enter a 10-digit mobile number")
            if p != lead.get("phone"):
                upd["phone"] = p
                note(f"Phone changed from {lead.get('phone')} to {p}")
        if body.name is not None:
            n = _clean(body.name, 80)
            if n != (lead.get("name") or ""):
                upd["name"] = n
        if body.email is not None:
            e = _clean(body.email, 120)
            if e and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", e):
                raise HTTPException(status_code=400, detail="That email doesn't look right")
            upd["email"] = e
        for k, lim in (("company", 120), ("area", 80), ("city", 60), ("referred_by", 80)):
            v = getattr(body, k)
            if v is not None:
                upd[k] = _clean(v, lim)
        if body.message is not None:
            upd["message"] = _clean(body.message, 2000)
        if body.pincode is not None:
            pin = re.sub(r"\D", "", body.pincode)[:6]
            if pin and len(pin) != 6:
                raise HTTPException(status_code=400, detail="The PIN code should have 6 digits")
            upd["pincode"] = pin
        if body.kind is not None:
            upd["kind"] = _choice(body.kind, KINDS, "enquiry types", "other")
        if body.channel is not None:
            upd["channel"] = _choice(body.channel, CHANNELS, "sources", channel_of(lead))
        if body.heat is not None:
            h = _choice(body.heat, HEAT, "temperatures", None)
            if h != lead.get("heat"):
                upd["heat"] = h
                if h:
                    note(f"Marked {HEAT[h].lower()}")
        if body.value is not None:
            upd["value"] = _money(body.value, "value")
        if body.kw is not None:
            upd["kw"] = _kw(body.kw)
        if body.location_id is not None:
            if body.location_id and not location_allowed(user, body.location_id):
                raise HTTPException(status_code=403, detail="You can only move leads to your own branch")
            upd["location_id"] = body.location_id or None

        status = lead.get("status") or "new"
        if body.status is not None and body.status != status:
            if body.status not in STATUSES:
                raise HTTPException(status_code=400, detail="Pick one of the listed stages")
            if body.status == "lost" and not (body.lost_reason or lead.get("lost_reason")):
                raise HTTPException(status_code=400, detail="Say why it's not going ahead — it helps the team learn")
            upd["status"] = body.status
            status = body.status
            note(f"Moved to {STATUSES[body.status]}" + (f" — {_clean(body.lost_reason, 200)}" if body.status == "lost" and body.lost_reason else ""), "status")
            if body.status in CLOSED:
                upd["closed_at"] = now
                upd["follow_up_on"] = None
                upd["follow_up_at"] = None
            else:
                upd["closed_at"] = None
        if body.lost_reason is not None:
            upd["lost_reason"] = _clean(body.lost_reason, 200)

        if body.assigned_to is not None:
            if body.assigned_to:
                owner = await _person(body.assigned_to)
                if owner["id"] != lead.get("assigned_to"):
                    upd.update({"assigned_to": owner["id"], "assigned_to_name": owner["name"]})
                    note(f"Given to {owner['name']}" if owner["id"] != user["id"] else f"{by} took it", "assigned")
            elif lead.get("assigned_to"):
                upd.update({"assigned_to": None, "assigned_to_name": None})
                note("Nobody is handling it now", "assigned")

        if body.follow_up_on is not None and status not in CLOSED:
            # a date is always sent with its time (none = morning); the note stays unless a new one is sent
            d = _date(body.follow_up_on, "follow-up date")
            t = _time(body.follow_up_at) if d else None
            n = (_clean(body.follow_up_note, 200) if body.follow_up_note is not None else (lead.get("follow_up_note") or "")) if d else ""
            if (d, t, n) != (lead.get("follow_up_on") or None, lead.get("follow_up_at") or None, lead.get("follow_up_note") or ""):
                upd.update({"follow_up_on": d, "follow_up_at": t, "follow_up_note": n})
                note((f"Follow up on {nice_day(d)}{' at ' + t if t else ''}" + (f": {n}" if n else "")) if d else "Follow-up cleared", "follow_up")
        elif body.follow_up_note is not None and lead.get("follow_up_on") and status not in CLOSED:
            upd["follow_up_note"] = _clean(body.follow_up_note, 200)

        if body.project_id is not None:
            if body.project_id:
                p = await db.projects.find_one({"_id": _oid(body.project_id, "project"), "deleted_at": {"$exists": False}}, {"reference_number": 1})
                if not p:
                    raise HTTPException(status_code=400, detail="That project doesn't exist")
                upd.update({"project_id": body.project_id, "project_reference": p.get("reference_number")})
                if status in ("new", "contacted"):
                    upd["status"] = "site_visit"
                note(f"Project {p.get('reference_number') or ''} made from this lead".strip(), "project")
            else:
                upd.update({"project_id": None, "project_reference": None})

        changed = {k: v for k, v in upd.items() if k not in ("updated_at", "needs_attention")}
        update: Dict[str, Any] = {"$set": upd}
        if log:
            update["$push"] = {"activity": {"$each": log}}
        await db.website_leads.update_one({"_id": lead["_id"]}, update)
        fresh = await db.website_leads.find_one({"_id": lead["_id"]})
        if {"follow_up_on", "follow_up_at", "follow_up_note", "status", "assigned_to"} & set(changed):
            await _remind(fresh)
        if "assigned_to" in changed:
            await _tell_new_owner(fresh, user)
            await db.material_quotes.update_many({"lead_id": lead_id}, {"$set": {"lead_owner": fresh.get("assigned_to") or None}})
        out = _detail(fresh)
        out["quotes"] = await _quotes_of(lead_id) if await _can(user, "module_material_quotes") else []
        return out

    # ───────────── log a call / visit / note ─────────────
    @router.post("/crm/leads/{lead_id}/activity")
    async def log_activity(lead_id: str, body: ActivityIn, request: Request):
        user = await get_current_user(request)
        lead = await _lead_for(user, lead_id)
        if body.type not in ACTIVITY_TYPES:
            raise HTTPException(status_code=400, detail="Pick call, WhatsApp, visit, meeting, email or note")
        if body.outcome and body.outcome not in OUTCOMES:
            raise HTTPException(status_code=400, detail="Pick one of the listed outcomes")
        text = _clean(body.text, 1500)
        if body.type == "note" and not text:
            raise HTTPException(status_code=400, detail="Write the note first")
        now = _iso()
        by = user.get("name") or user.get("email") or "Someone"
        label = ACTIVITY_TYPES[body.type]
        line = label if not body.outcome else f"{label} — {OUTCOMES[body.outcome].lower()}"
        if body.type == "note":
            line = text
        elif text:
            line += f": {text}"
        entry = {"at": now, "by": by, "by_id": user["id"], "type": body.type, "outcome": body.outcome, "text": line}
        upd: Dict[str, Any] = {"updated_at": now, "needs_attention": False}
        inc: Dict[str, int] = {}
        if body.type != "note":
            upd["last_contacted_at"] = now
            inc["contact_count"] = 1
        if lead.get("status") == "new" and body.type != "note":
            upd["status"] = "contacted"
        if body.type == "visit" and lead.get("status") in ("new", "contacted"):
            upd["status"] = "site_visit"
        log = [entry]
        if lead.get("status") not in CLOSED:
            d = _date(body.follow_up_on, "follow-up date")
            if d:
                t = _time(body.follow_up_at)
                n = _clean(body.follow_up_note, 200)
                upd.update({"follow_up_on": d, "follow_up_at": t, "follow_up_note": n})
                log.append({"at": now, "by": by, "by_id": user["id"], "type": "follow_up",
                            "text": f"Next follow-up {nice_day(d)}{' at ' + t if t else ''}" + (f" — {n}" if n else "")})
            elif body.done and body.type != "note" and lead.get("follow_up_on") and lead["follow_up_on"] <= today_ist():
                upd.update({"follow_up_on": None, "follow_up_at": None, "follow_up_note": ""})
        if "status" in upd:
            log.append({"at": now, "by": by, "by_id": user["id"], "type": "status", "text": f"Moved to {STATUSES[upd['status']]}"})
        took = not lead.get("assigned_to")
        if took:   # whoever calls an unowned lead takes it
            upd.update({"assigned_to": user["id"], "assigned_to_name": by})
        update: Dict[str, Any] = {"$set": upd, "$push": {"activity": {"$each": log}}}
        if inc:
            update["$inc"] = inc
        await db.website_leads.update_one({"_id": lead["_id"]}, update)
        fresh = await db.website_leads.find_one({"_id": lead["_id"]})
        await _remind(fresh)
        if took:
            await db.material_quotes.update_many({"lead_id": lead_id}, {"$set": {"lead_owner": user["id"]}})
        out = _detail(fresh)
        out["quotes"] = await _quotes_of(lead_id) if await _can(user, "module_material_quotes") else []
        return out

    @router.delete("/crm/leads/{lead_id}")
    async def delete_lead(lead_id: str, request: Request):
        user = await get_current_user(request)
        lead = await _lead_for(user, lead_id)
        if lead.get("quote_count") or await db.material_quotes.count_documents({"lead_id": lead_id}):
            raise HTTPException(status_code=400, detail="This lead has quotations — mark it Lost instead, so they stay linked")
        await db.website_leads.delete_one({"_id": lead["_id"]})
        await notify.clear(db, "lead_follow_up", "lead", lead_id)
        await create_audit_log(user["id"], user.get("name", ""), "delete", "lead", lead_id, {"name": lead.get("name"), "phone": lead.get("phone"),
                                                                                         "number": lead.get("number")})
        return {"deleted": True}

    # ───────────── one search for Ctrl+K ─────────────
    @router.get("/search")
    async def search(request: Request, q: str = "", limit: int = 6):
        user = await get_current_user(request)
        text = (q or "").strip()[:60]
        if len(text) < 2:
            return {"q": text, "groups": []}
        n = max(1, min(limit, 10))
        rx = {"$regex": re.escape(text), "$options": "i"}
        digits = re.sub(r"\D", "", text)
        groups: List[Dict[str, Any]] = []

        if await _can(user, "module_leads"):
            ors: List[Dict[str, Any]] = [{"name": rx}, {"number": rx}, {"company": rx}, {"area": rx}]
            if len(digits) >= 4:
                ors.append({"phone": {"$regex": re.escape(digits[-10:])}})
            base = await _scope(user)
            query = {"$and": [base, {"$or": ors}]} if base else {"$or": ors}
            rows = await db.website_leads.find(query, {"name": 1, "phone": 1, "number": 1, "status": 1, "kind": 1, "area": 1}).sort("updated_at", -1).limit(n).to_list(n)
            if rows:
                groups.append({"key": "leads", "label": "Leads", "items": [{
                    "id": str(r["_id"]), "title": r.get("name") or f"+91 {r.get('phone')}",
                    "sub": " · ".join(filter(None, [r.get("number"), STATUSES.get(r.get("status"), ""), KINDS.get(r.get("kind"), ""), r.get("area")])),
                    "href": f"/dashboard/leads?lead={r['_id']}"} for r in rows]})

        if await _can(user, "module_material_quotes"):
            ors = [{"number": rx}, {"customer.name": rx}, {"customer.company": rx}]
            if len(digits) >= 4:
                ors.append({"customer.phone": {"$regex": re.escape(digits[-10:])}})
            parts: List[Dict[str, Any]] = [{"$or": ors}]
            loc = location_scope_filter(user)
            if loc:
                parts.append(loc)
            if user.get("role") != "admin" and not (await _perms(user)).get("can_see_all_quotes"):
                parts.append({"created_by": user["id"]})
            rows = await db.material_quotes.find({"$and": parts}, {"number": 1, "revision": 1, "customer": 1, "status": 1, "grand_total": 1}).sort("updated_at", -1).limit(n).to_list(n)
            if rows:
                groups.append({"key": "quotes", "label": "Material quotations", "items": [{
                    "id": str(r["_id"]), "title": f"{r.get('number')}{'-R' + str(r['revision']) if r.get('revision') else ''} · {(r.get('customer') or {}).get('name') or ''}",
                    "sub": f"{inr(r.get('grand_total'))} · {QUOTE_LABELS.get(r.get('status'), r.get('status'))}", "href": f"/dashboard/quotations/{r['_id']}"} for r in rows]})

        if await _can(user, "module_projects"):
            ors = [{"reference_number": rx}, {"customer.name": rx}]
            if len(digits) >= 4:
                ors.append({"customer.phone": {"$regex": re.escape(digits[-10:])}})
            parts = [{"deleted_at": {"$exists": False}}, {"$or": ors}]
            if user.get("role") == "staff":
                parts.append({"created_by": user["id"]})
            loc = location_scope_filter(user)
            if loc:
                parts.append(loc)
            rows = await db.projects.find({"$and": parts}, {"reference_number": 1, "customer": 1, "status": 1}).sort("updated_at", -1).limit(n).to_list(n)
            if rows:
                groups.append({"key": "projects", "label": "Projects", "items": [{
                    "id": str(r["_id"]), "title": (r.get("customer") or {}).get("name") or r.get("reference_number") or "Project",
                    "sub": " · ".join(filter(None, [r.get("reference_number"), str(r.get("status") or "").replace("_", " ")])),
                    "href": f"/dashboard/projects/{r['_id']}"} for r in rows]})

        if await _can(user, "module_material_quotes") or await _can(user, "module_inventory"):
            rows = await db.inventory_items.find({"active": {"$ne": False}, "$or": [{"name": rx}, {"sku_code": rx}]},
                                                 {"name": 1, "sku_code": 1, "quantity": 1, "unit_price": 1, "margin_pct": 1, "gst_percentage": 1, "unit": 1}
                                                 ).sort("name", 1).limit(n).to_list(n)
            if rows:
                items = []
                for r in rows:
                    sell = None if r.get("margin_pct") is None else round(float(r.get("unit_price") or 0) * (1 + float(r["margin_pct"]) / 100), 2)
                    bits = [r.get("sku_code"), f"{r.get('quantity', 0):g} in stock"]
                    if sell is not None:
                        bits.append(f"{inr(sell, paise=True)} + {float(r.get('gst_percentage') or 0):g}% GST")
                    items.append({"id": str(r["_id"]), "title": r.get("name"), "sub": " · ".join(filter(None, bits)),
                                  "href": f"/dashboard/inventory?q={r.get('sku_code') or r.get('name')}"})
                groups.append({"key": "items", "label": "Stock & prices", "items": items})
        return {"q": text, "groups": groups}

    return router


async def ensure_indexes(db) -> None:
    for keys in ([("assigned_to", 1), ("status", 1), ("follow_up_on", 1)], [("status", 1), ("follow_up_on", 1)],
                 [("updated_at", -1)], [("created_by", 1)]):
        try:
            await db.website_leads.create_index(keys)
        except Exception:
            pass
