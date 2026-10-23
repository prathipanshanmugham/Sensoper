"""Event calendar (Oct 2026): company events people add (meetings, holidays, training, deadlines…) plus the dated
work from the rest of the app — AMC visits, installations, purchase deliveries, interviews, covers, last working
days, EMIs, trademark renewals. Each person only sees the dated work of the pages they can open.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import notify

TYPES = ("meeting", "holiday", "training", "deadline", "celebration", "site", "other")
REPEATS = ("none", "weekly", "monthly", "yearly")
TIME_RX = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MAX_DAYS = 120


def occurrences(ev: Dict[str, Any], start: date, end: date) -> List[date]:
    """Start dates of an event (with its repeat) that touch [start, end]. Pure."""
    first = notify.to_date(ev.get("date"))
    if not first:
        return []
    last = notify.to_date(ev.get("end_date")) or first
    span = (last - first).days
    rep = ev.get("repeat") or "none"
    until = notify.to_date(ev.get("repeat_until")) or end
    out: List[date] = []
    d, i = first, 0
    while d <= min(end, until) and i < 800:
        if d + timedelta(days=span) >= start:
            out.append(d)
        i += 1
        if rep == "none":
            break
        if rep == "weekly":
            d = first + timedelta(weeks=i)
        elif rep == "monthly":
            m = first.month - 1 + i
            y, m = first.year + m // 12, m % 12 + 1
            try:
                d = first.replace(year=y, month=m)
            except ValueError:
                d = date(y, m, 28)
        else:
            try:
                d = first.replace(year=first.year + i)
            except ValueError:
                d = date(first.year + i, 2, 28)
    return out


class EventIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    type: str = "meeting"
    date: str
    end_date: Optional[str] = None
    all_day: bool = True
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    audience: str = "everyone"                      # everyone | people
    attendee_ids: List[str] = []
    repeat: str = "none"
    repeat_until: Optional[str] = None
    remind: bool = True


Provider = Tuple[str, Callable[[date, date, Dict[str, Any]], Awaitable[List[Dict[str, Any]]]]]


def create_router(db, get_current_user, create_audit_log, get_permissions, check_module_permission, providers: List[Provider]):
    """providers: (page key or "" for everyone, async fn(start, end, user) → items)."""
    router = APIRouter()

    async def _can(user: Dict[str, Any], module: str, action: str = "view") -> bool:
        return user["role"] == "admin" or await check_module_permission(user, module, action)

    async def _gate(request: Request, action: str = "view") -> Dict[str, Any]:
        user = await get_current_user(request)
        if not await _can(user, "module_calendar", action):
            raise HTTPException(status_code=403, detail="Your role can't use the calendar. An admin can change this in Settings → Permissions.")
        return user

    def _visible(ev: Dict[str, Any], user: Dict[str, Any]) -> bool:
        return (ev.get("audience") != "people" or user["role"] == "admin" or ev.get("created_by_id") == user["id"]
                or user["id"] in (ev.get("attendee_ids") or []))

    def _out(ev: Dict[str, Any], d: date, user: Dict[str, Any], can_edit_all: bool) -> Dict[str, Any]:
        first = notify.to_date(ev["date"])
        span = ((notify.to_date(ev.get("end_date")) or first) - first).days
        return {"id": f"ev-{ev['_id']}-{d.isoformat()}", "event_id": str(ev["_id"]), "date": d.isoformat(),
                "end": (d + timedelta(days=span)).isoformat() if span else None, "time": None if ev.get("all_day", True) else ev.get("start_time"),
                "end_time": None if ev.get("all_day", True) else ev.get("end_time"), "title": ev["title"], "detail": ev.get("location"),
                "description": ev.get("description"), "type": ev.get("type"), "source": "event", "repeat": ev.get("repeat", "none"),
                "audience": ev.get("audience"), "attendee_ids": ev.get("attendee_ids") or [], "created_by": ev.get("created_by"),
                "series_date": ev["date"], "series_end": ev.get("end_date"), "repeat_until": ev.get("repeat_until"), "remind": ev.get("remind", True),
                "location": ev.get("location"),
                "editable": can_edit_all or ev.get("created_by_id") == user["id"]}

    def _clean(body: EventIn) -> Dict[str, Any]:
        if body.type not in TYPES:
            raise HTTPException(status_code=400, detail="Unknown event type")
        if body.repeat not in REPEATS:
            raise HTTPException(status_code=400, detail="Repeat must be none, weekly, monthly or yearly")
        d0 = notify.to_date(body.date)
        if not d0:
            raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD")
        d1 = notify.to_date(body.end_date) if body.end_date else None
        if body.end_date and not d1:
            raise HTTPException(status_code=400, detail="End date must be YYYY-MM-DD")
        if d1 and d1 < d0:
            raise HTTPException(status_code=400, detail="The event ends before it starts")
        if d1 and (d1 - d0).days > 60:
            raise HTTPException(status_code=400, detail="An event can run for at most 60 days")
        if not body.all_day:
            if not body.start_time or not TIME_RX.match(body.start_time):
                raise HTTPException(status_code=400, detail="Start time must be HH:MM")
            if body.end_time and not TIME_RX.match(body.end_time):
                raise HTTPException(status_code=400, detail="End time must be HH:MM")
            if body.end_time and not d1 and body.end_time <= body.start_time:
                raise HTTPException(status_code=400, detail="The event ends before it starts")
        if body.audience not in ("everyone", "people"):
            raise HTTPException(status_code=400, detail="Audience must be everyone or chosen people")
        ids = [i for i in dict.fromkeys(body.attendee_ids) if ObjectId.is_valid(i)][:200]
        if body.audience == "people" and not ids:
            raise HTTPException(status_code=400, detail="Choose who the event is for")
        until = notify.to_date(body.repeat_until) if body.repeat_until else None
        if body.repeat_until and not until:
            raise HTTPException(status_code=400, detail="Repeat-until must be YYYY-MM-DD")
        return {**body.model_dump(), "title": body.title.strip(), "date": d0.isoformat(), "end_date": d1.isoformat() if d1 and d1 != d0 else None,
                "start_time": None if body.all_day else body.start_time, "end_time": None if body.all_day else body.end_time,
                "attendee_ids": ids if body.audience == "people" else [], "repeat_until": until.isoformat() if until else None,
                "location": (body.location or "").strip() or None, "description": (body.description or "").strip()[:2000] or None}

    async def _audience(ev: Dict[str, Any]) -> List[str]:
        if ev.get("audience") == "people":
            return list(ev.get("attendee_ids") or [])
        return [str(u["_id"]) async for u in db.users.find({"active": {"$ne": False}}, {"_id": 1})]

    async def _plan(ev: Dict[str, Any], creator_id: str, newly_added: List[str]) -> None:
        eid = str(ev["_id"])
        await notify.clear(db, "calendar", "event", eid)
        today = notify.today_ist()
        if newly_added:
            await notify.plan(db, kind="calendar", source_type="event", source_id=eid, user_ids=[u for u in newly_added if u != creator_id], tag="added",
                              title=f"{ev.get('created_by')} added you to: {ev['title']}", message=f"{notify.to_date(ev['date']).strftime('%a %d %b')}"
                              + (f", {ev['start_time']}" if ev.get("start_time") else "") + (f" · {ev['location']}" if ev.get("location") else ""),
                              link=f"/dashboard/calendar?date={ev['date']}")
        if not ev.get("remind", True):
            return
        people = await _audience(ev)
        for d in occurrences(ev, today, today + timedelta(days=400))[:3]:
            if ev.get("start_time"):
                h, m = map(int, ev["start_time"].split(":"))
                when = datetime(d.year, d.month, d.day, h, m, tzinfo=notify.IST) - timedelta(hours=1)
                at = max(when, notify.now_utc()).astimezone(timezone.utc).isoformat()
            else:
                at = notify.morning_of(d, 8)
            await notify.plan(db, kind="calendar", source_type="event", source_id=eid, user_ids=people, tag=d.isoformat(),
                              title=f"{'Holiday' if ev.get('type') == 'holiday' else 'Today'}: {ev['title']}" + (f" at {ev['start_time']}" if ev.get("start_time") else ""),
                              message=ev.get("location") or (ev.get("description") or "")[:120] or ev.get("type", ""), link=f"/dashboard/calendar?date={d.isoformat()}",
                              notify_at=at)

    @router.get("/calendar")
    async def calendar(request: Request, start: str, end: str, sources: Optional[str] = None):
        user = await _gate(request)
        d0, d1 = notify.to_date(start), notify.to_date(end)
        if not d0 or not d1 or d1 < d0:
            raise HTTPException(status_code=400, detail="Give start and end dates")
        if (d1 - d0).days > MAX_DAYS:
            raise HTTPException(status_code=400, detail=f"Ask for at most {MAX_DAYS} days at a time")
        want = set((sources or "").split(",")) - {""}
        can_edit_all = await _can(user, "module_calendar", "edit")
        out: List[Dict[str, Any]] = []
        if not want or "event" in want:
            async for ev in db.calendar_events.find({"date": {"$lte": d1.isoformat()}}):
                if not _visible(ev, user):
                    continue
                for d in occurrences(ev, d0, d1):
                    out.append(_out(ev, d, user, can_edit_all))
        for module, fn in providers:
            if module and not await _can(user, module):
                continue
            try:
                items = await fn(d0, d1, user)
            except Exception:       # one area failing never blanks the whole calendar
                continue
            for it in items:
                if want and it.get("source") not in want:
                    continue
                out.append({"type": it.get("source"), "editable": False, **it})
        out.sort(key=lambda r: (r["date"], r.get("time") or "", r["title"]))
        return {"start": d0.isoformat(), "end": d1.isoformat(), "items": out}

    @router.get("/calendar/people")
    async def people(request: Request):
        """Names to invite to an event (active people only)."""
        await _gate(request)
        return [{"id": str(u["_id"]), "name": u.get("name"), "department": u.get("department")}
                async for u in db.users.find({"active": {"$ne": False}}, {"name": 1, "department": 1}).sort("name", 1)]

    @router.post("/calendar/events")
    async def add_event(body: EventIn, request: Request):
        user = await _gate(request, "create")
        doc = _clean(body)
        doc.update({"created_by": user["name"], "created_by_id": user["id"], "created_at": notify.now_utc().isoformat()})
        res = await db.calendar_events.insert_one(doc)
        doc["_id"] = res.inserted_id
        await _plan(doc, user["id"], doc["attendee_ids"])
        await create_audit_log(user["id"], user["name"], "calendar_event_added", "calendar_event", str(res.inserted_id), None, {"title": doc["title"], "date": doc["date"]})
        return _out(doc, notify.to_date(doc["date"]), user, True)

    async def _mine(event_id: str, user: Dict[str, Any], action: str) -> Dict[str, Any]:
        ev = await db.calendar_events.find_one({"_id": ObjectId(event_id)}) if ObjectId.is_valid(event_id) else None
        if not ev or not _visible(ev, user):
            raise HTTPException(status_code=404, detail="Event not found")
        if ev.get("created_by_id") != user["id"] and not await _can(user, "module_calendar", action):
            raise HTTPException(status_code=403, detail="Only the person who added it (or someone allowed to change others' events) can change this")
        return ev

    @router.put("/calendar/events/{event_id}")
    async def edit_event(event_id: str, body: EventIn, request: Request):
        user = await _gate(request)
        ev = await _mine(event_id, user, "edit")
        doc = _clean(body)
        doc["updated_at"] = notify.now_utc().isoformat()
        await db.calendar_events.update_one({"_id": ev["_id"]}, {"$set": doc})
        fresh = await db.calendar_events.find_one({"_id": ev["_id"]})
        added = [i for i in fresh.get("attendee_ids") or [] if i not in (ev.get("attendee_ids") or [])]
        await _plan(fresh, user["id"], added)
        await create_audit_log(user["id"], user["name"], "calendar_event_updated", "calendar_event", event_id, {"date": ev.get("date")}, {"date": doc["date"]})
        return _out(fresh, notify.to_date(fresh["date"]), user, True)

    @router.delete("/calendar/events/{event_id}")
    async def delete_event(event_id: str, request: Request):
        user = await _gate(request)
        ev = await _mine(event_id, user, "delete")
        await db.calendar_events.delete_one({"_id": ev["_id"]})
        await notify.clear(db, "calendar", "event", event_id)
        await create_audit_log(user["id"], user["name"], "calendar_event_deleted", "calendar_event", event_id, {"title": ev.get("title"), "date": ev.get("date")}, None)
        return {"ok": True}

    return router
