"""Attendance — check in / check out with time + GPS (Oct 2026).

One record per person per day (India time). Everyone can check themselves in and out; admins and
managers see the team for a day and the monthly register, and can correct a record (e.g. a missed
check-out). Managers with assigned locations only see people who share one of their locations.

    GET  /api/attendance/me/today
    POST /api/attendance/check-in   {lat, lng, accuracy, note}
    POST /api/attendance/check-out  {lat, lng, accuracy, note}
    GET  /api/attendance/me?month=YYYY-MM
    GET  /api/attendance/team?date=YYYY-MM-DD            (admin, manager)
    GET  /api/attendance/register?month=YYYY-MM          (admin, manager)
    PUT  /api/attendance/{id}  {check_in_at, check_out_at, note}   (admin, manager — corrections)
"""
from __future__ import annotations

import calendar
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

IST = timezone(timedelta(hours=5, minutes=30))
HALF_DAY_MINUTES = 4 * 60        # under this → half day in the register


class Punch(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None
    note: Optional[str] = ""


class Correction(BaseModel):
    check_in_at: Optional[str] = None     # ISO or "HH:MM" (on the record's own date, IST)
    check_out_at: Optional[str] = None
    note: Optional[str] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def today_ist(now: Optional[datetime] = None) -> str:
    return (now or _now()).astimezone(IST).date().isoformat()


def _month_ok(m: Optional[str]) -> str:
    m = m or _now().astimezone(IST).strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-\d{2}", m):
        raise HTTPException(status_code=400, detail="Month must look like 2026-10")
    return m


def _date_ok(d: Optional[str]) -> str:
    d = d or today_ist()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        raise HTTPException(status_code=400, detail="Date must look like 2026-10-10")
    return d


def _check_coords(p: Punch):
    if not (-90 <= p.lat <= 90 and -180 <= p.lng <= 180) or (p.lat == 0 and p.lng == 0):
        raise HTTPException(status_code=400, detail="Location is needed to check in or out — allow location and try again.")


def _minutes(rec: Dict[str, Any]) -> Optional[int]:
    ci, co = (rec.get("check_in") or {}).get("at"), (rec.get("check_out") or {}).get("at")
    if not ci or not co:
        return None
    try:
        return max(0, int((datetime.fromisoformat(co) - datetime.fromisoformat(ci)).total_seconds() // 60))
    except ValueError:
        return None


def _public(rec: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not rec:
        return None
    out = {k: v for k, v in rec.items() if k != "_id"}
    out["id"] = str(rec["_id"])
    out["worked_minutes"] = _minutes(rec)
    out["state"] = "checked_out" if rec.get("check_out") else "checked_in"
    return out


def _ist_day(iso: Optional[str]) -> str:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(IST).date().isoformat()
    except (TypeError, ValueError):
        return ""


def _parse_time(value: str, day: str) -> str:
    """'09:30' (IST, on `day`) or a full ISO timestamp → ISO UTC."""
    v = (value or "").strip()
    if re.fullmatch(r"\d{1,2}:\d{2}", v):
        h, m = map(int, v.split(":"))
        if not (0 <= h < 24 and 0 <= m < 60):
            raise HTTPException(status_code=400, detail="Time must look like 09:30")
        y, mo, d = map(int, day.split("-"))
        return datetime(y, mo, d, h, m, tzinfo=IST).astimezone(timezone.utc).isoformat()
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Time must look like 09:30")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    return dt.astimezone(timezone.utc).isoformat()


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    async def _people_for(viewer: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Users the viewer may see: everyone for admins; for managers with locations, people sharing one."""
        users = [u async for u in db.users.find({}, {"password_hash": 0})]
        scope = set(viewer.get("location_ids") or []) if viewer.get("role") != "admin" else set()
        out = []
        for u in users:
            if u.get("disabled") or u.get("is_active") is False:
                continue
            locs = set(u.get("location_ids") or [])
            if scope and locs and not (scope & locs) and str(u["_id"]) != viewer["id"]:
                continue
            out.append({"id": str(u["_id"]), "name": u.get("name", ""), "role": u.get("role", ""), "phone": u.get("phone"),
                        "location_ids": u.get("location_ids") or [], "joined": _ist_day(u.get("created_at"))})
        return sorted(out, key=lambda x: ({"admin": 0, "manager": 1}.get(x["role"], 2), x["name"].lower()))

    @router.get("/attendance/me/today")
    async def my_today(request: Request):
        user = await get_current_user(request)
        rec = await db.attendance.find_one({"user_id": user["id"], "date": today_ist()})
        return {"date": today_ist(), "server_time": _now().isoformat(), "record": _public(rec)}

    @router.post("/attendance/check-in")
    async def check_in(body: Punch, request: Request):
        user = await get_current_user(request)
        _check_coords(body)
        day = today_ist()
        existing = await db.attendance.find_one({"user_id": user["id"], "date": day})
        if existing:
            raise HTTPException(status_code=400, detail="You've already checked in today" + (" and out." if existing.get("check_out") else "."))
        now = _now().isoformat()
        doc = {
            "user_id": user["id"], "user_name": user.get("name", ""), "role": user.get("role", ""),
            "location_ids": user.get("location_ids") or [], "date": day,
            "check_in": {"at": now, "lat": round(body.lat, 6), "lng": round(body.lng, 6), "accuracy": body.accuracy, "note": (body.note or "")[:300]},
            "check_out": None, "corrections": [], "created_at": now, "updated_at": now,
        }
        try:
            res = await db.attendance.insert_one(doc)
        except Exception:   # unique (user_id, date) — a double tap on two devices
            raise HTTPException(status_code=400, detail="You've already checked in today.")
        doc["_id"] = res.inserted_id
        return _public(doc)

    @router.post("/attendance/check-out")
    async def check_out(body: Punch, request: Request):
        user = await get_current_user(request)
        _check_coords(body)
        rec = await db.attendance.find_one({"user_id": user["id"], "date": today_ist()})
        if not rec:
            raise HTTPException(status_code=400, detail="Check in first.")
        if rec.get("check_out"):
            raise HTTPException(status_code=400, detail="You've already checked out today.")
        now = _now().isoformat()
        co = {"at": now, "lat": round(body.lat, 6), "lng": round(body.lng, 6), "accuracy": body.accuracy, "note": (body.note or "")[:300]}
        await db.attendance.update_one({"_id": rec["_id"]}, {"$set": {"check_out": co, "updated_at": now}})
        rec["check_out"] = co
        return _public(rec)

    @router.get("/attendance/me")
    async def my_month(request: Request, month: Optional[str] = None):
        user = await get_current_user(request)
        m = _month_ok(month)
        recs = [_public(r) async for r in db.attendance.find({"user_id": user["id"], "date": {"$regex": f"^{m}-"}}).sort("date", -1)]
        mins = sum(r["worked_minutes"] or 0 for r in recs)
        return {"month": m, "records": recs, "days_present": len(recs), "worked_minutes": mins}

    @router.get("/attendance/team")
    async def team_day(request: Request, date: Optional[str] = None):
        viewer = await require_role("admin", "manager")(request)
        day = _date_ok(date)
        people = await _people_for(viewer)
        recs = {r["user_id"]: r async for r in db.attendance.find({"date": day})}
        rows = []
        for p in people:
            r = _public(recs.get(p["id"]))
            rows.append({**p, "record": r, "status": "absent" if not r else r["state"]})
        return {"date": day, "rows": rows,
                "summary": {"people": len(rows), "present": sum(1 for x in rows if x["record"]),
                            "checked_out": sum(1 for x in rows if x["status"] == "checked_out"),
                            "still_in": sum(1 for x in rows if x["status"] == "checked_in"),
                            "absent": sum(1 for x in rows if not x["record"])}}

    @router.get("/attendance/register")
    async def register(request: Request, month: Optional[str] = None):
        viewer = await require_role("admin", "manager")(request)
        m = _month_ok(month)
        y, mo = map(int, m.split("-"))
        ndays = calendar.monthrange(y, mo)[1]
        today = today_ist()
        days = [f"{m}-{d:02d}" for d in range(1, ndays + 1)]
        people = await _people_for(viewer)
        by = {}
        async for r in db.attendance.find({"date": {"$regex": f"^{m}-"}}):
            by[(r["user_id"], r["date"])] = r
        # Days before attendance was first used, or before someone joined, are left blank — not "absent"
        first = await db.attendance.find_one({}, sort=[("date", 1)])
        started = first["date"] if first else "9999-12-31"
        rows = []
        for p in people:
            cells, present, half, minutes = [], 0, 0, 0
            begin = max(started, p.get("joined") or "")
            for d in days:
                r = by.get((p["id"], d))
                if not r:
                    if d > today or d < begin:
                        cells.append("")
                    else:
                        cells.append("S" if datetime.strptime(d, "%Y-%m-%d").weekday() == 6 else "A")
                    continue
                mins = _minutes(r)
                minutes += mins or 0
                if mins is None:
                    cells.append("P*")          # checked in, no check-out
                    present += 1
                elif mins < HALF_DAY_MINUTES:
                    cells.append("H")
                    half += 1
                else:
                    cells.append("P")
                    present += 1
            rows.append({**p, "cells": cells, "present": present, "half_days": half, "worked_minutes": minutes})
        return {"month": m, "days": days, "rows": rows,
                "legend": {"P": "Present", "P*": "Present, no check-out", "H": "Half day (under 4 h)", "A": "Absent", "S": "Sunday"}}

    @router.put("/attendance/{record_id}")
    async def correct(record_id: str, body: Correction, request: Request):
        viewer = await require_role("admin", "manager")(request)
        try:
            rec = await db.attendance.find_one({"_id": ObjectId(record_id)})
        except Exception:
            rec = None
        if not rec:
            raise HTTPException(status_code=404, detail="Record not found")
        upd: Dict[str, Any] = {"updated_at": _now().isoformat()}
        if body.check_in_at:
            upd["check_in"] = {**(rec.get("check_in") or {}), "at": _parse_time(body.check_in_at, rec["date"]), "corrected": True}
        if body.check_out_at:
            upd["check_out"] = {**(rec.get("check_out") or {}), "at": _parse_time(body.check_out_at, rec["date"]), "corrected": True}
        ci = (upd.get("check_in") or rec.get("check_in") or {}).get("at")
        co = (upd.get("check_out") or rec.get("check_out") or {}).get("at")
        if ci and co and datetime.fromisoformat(co) < datetime.fromisoformat(ci):
            raise HTTPException(status_code=400, detail="Check-out can't be before check-in.")
        note = {"by": viewer.get("name", ""), "at": _now().isoformat(), "note": (body.note or "")[:300],
                "check_in_at": body.check_in_at, "check_out_at": body.check_out_at}
        await db.attendance.update_one({"_id": rec["_id"]}, {"$set": upd, "$push": {"corrections": note}})
        await create_audit_log(viewer["id"], viewer.get("name", ""), "update", "attendance", record_id,
                               details=f"{rec.get('user_name')} {rec['date']}: in {body.check_in_at or '-'} out {body.check_out_at or '-'}")
        return _public(await db.attendance.find_one({"_id": rec["_id"]}))

    return router
