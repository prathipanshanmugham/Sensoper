"""HR (Oct 2026): people details, hiring, cover for absent staff, exits with notice period, and shifts.

* People — designation, department, reports-to (drives the org chart), joining date, employee code, default shift.
* Hiring — openings and candidates moving applied → screening → interview → offer → hired / rejected; interviews
  plan a bell note for the interviewer; hiring can create the login (admins).
* Cover — when someone is on leave or away, who covers their work and shift, with handover notes. The cover person
  gets a bell note; the calendar shows it.
* Exits — resignation, termination, end of contract or retirement with a notice period. The last working day is
  worked out from the notice days; the login stops working after that day (`users.access_until`) and is switched
  off when the exit is completed. A checklist keeps the handover honest.
* Shifts — shift timings and a weekly roster (person × day → shift or off), with check-in times against the shift.
"""
from __future__ import annotations

import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import notify

STAGES = ("applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn")
OPEN_STAGES = ("applied", "screening", "interview", "offer")
EXIT_TYPES = ("resignation", "termination", "end_of_contract", "retirement")
EXIT_LABEL = {"resignation": "Resignation", "termination": "Termination", "end_of_contract": "End of contract", "retirement": "Retirement"}
COVER_REASONS = ("leave", "sick", "training", "field_work", "other")
DEFAULT_SETTINGS = {
    "notice_days": {"resignation": 30, "termination": 30, "end_of_contract": 0, "retirement": 30},
    "departments": ["Management", "Sales", "Projects & installation", "Service & AMC", "Stores & purchase", "Accounts", "Admin & HR"],
    "grace_minutes": 10,
}
EXIT_CHECKLIST = ["Hand over open work and customers", "Return company assets (tools, vehicle, phone, ID card)",
                  "Hand over company logins and files", "Final settlement", "Exit interview", "Relieving / experience letter"]
TIME_RX = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _oid(v: str) -> ObjectId:
    if not v or not ObjectId.is_valid(str(v)):
        raise HTTPException(status_code=404, detail="Not found")
    return ObjectId(str(v))


def _ser(d: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d


def last_working_day(notice_start: date, notice_days: int, waived_days: int = 0) -> date:
    """Notice starts on the day it is given and runs `notice_days` calendar days; waived days come off the end. Pure."""
    days = max(int(notice_days) - max(int(waived_days or 0), 0), 0)
    return notice_start + timedelta(days=max(days - 1, 0))


def overlaps(a0: date, a1: date, b0: date, b1: date) -> bool:
    return a0 <= b1 and b0 <= a1


def would_loop(reports: Dict[str, Optional[str]], person: str, boss: Optional[str]) -> bool:
    """True if making `boss` the manager of `person` creates a circle (A → B → … → A). Pure."""
    seen = set()
    while boss:
        if boss == person:
            return True
        if boss in seen:
            return True
        seen.add(boss)
        boss = reports.get(boss)
    return False


def week_days(start: date) -> List[str]:
    monday = start - timedelta(days=start.weekday())
    return [(monday + timedelta(days=i)).isoformat() for i in range(7)]


def minutes_late(check_in_iso: Optional[str], shift_start: Optional[str], grace: int) -> Optional[int]:
    """Minutes after (shift start + grace) that someone checked in, IST; 0 if on time; None if not comparable. Pure."""
    if not check_in_iso or not shift_start or not TIME_RX.match(shift_start):
        return None
    try:
        t = datetime.fromisoformat(str(check_in_iso).replace("Z", "+00:00")).astimezone(notify.IST)
    except ValueError:
        return None
    h, m = map(int, shift_start.split(":"))
    late = (t.hour * 60 + t.minute) - (h * 60 + m) - int(grace or 0)
    return max(late, 0)


# ───────────────────────── request bodies ─────────────────────────
class PersonIn(BaseModel):
    designation: Optional[str] = None
    department: Optional[str] = None
    reports_to: Optional[str] = None
    joining_date: Optional[str] = None
    employee_code: Optional[str] = None
    default_shift_id: Optional[str] = None


class OpeningIn(BaseModel):
    title: str = Field(min_length=2, max_length=100)
    department: Optional[str] = None
    location_id: Optional[str] = None
    positions: int = Field(default=1, ge=1, le=100)
    employment_type: str = "full_time"          # full_time | part_time | contract | intern
    pay_range: Optional[str] = None
    description: Optional[str] = None
    status: str = "open"                         # open | on_hold | closed | filled


class CandidateIn(BaseModel):
    opening_id: Optional[str] = None
    name: str = Field(min_length=2, max_length=100)
    phone: Optional[str] = None
    email: Optional[str] = None
    source: Optional[str] = None                 # referral | walk_in | job_portal | social | agency | other
    experience_years: Optional[float] = None
    current_location: Optional[str] = None
    expected_pay: Optional[str] = None
    resume_path: Optional[str] = None
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = None


class StageIn(BaseModel):
    stage: str
    note: Optional[str] = None


class InterviewIn(BaseModel):
    at: str                                      # ISO date-time (local) e.g. 2026-10-30T11:00
    mode: str = "in_person"                     # in_person | phone | video
    interviewer_id: Optional[str] = None
    notes: Optional[str] = None


class InterviewResultIn(BaseModel):
    result: str                                  # passed | failed | no_show | rescheduled
    notes: Optional[str] = None


class HireIn(BaseModel):
    joining_date: str
    designation: Optional[str] = None
    department: Optional[str] = None
    reports_to: Optional[str] = None
    create_login: bool = False
    email: Optional[str] = None
    role: str = "staff"
    temp_password: Optional[str] = None


class CoverIn(BaseModel):
    absent_user_id: str
    cover_user_id: str
    start_date: str
    end_date: str
    reason: str = "leave"
    shift_id: Optional[str] = None
    handover_notes: Optional[str] = None


class ExitIn(BaseModel):
    user_id: str
    type: str = "resignation"
    reason: Optional[str] = None
    notice_start: str
    notice_days: Optional[int] = None
    waived_days: int = 0
    last_working_day: Optional[str] = None       # set by hand to override the worked-out date
    notes: Optional[str] = None


class ExitUpdateIn(BaseModel):
    reason: Optional[str] = None
    notice_days: Optional[int] = None
    waived_days: Optional[int] = None
    last_working_day: Optional[str] = None
    checklist: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None
    exit_interview: Optional[str] = None


class ShiftIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    start: str
    end: str
    break_minutes: int = Field(default=60, ge=0, le=240)
    color: Optional[str] = None
    active: bool = True


class RosterEntry(BaseModel):
    user_id: str
    date: str
    shift_id: Optional[str] = None               # None = use the person's default; "off" = day off


class RosterIn(BaseModel):
    entries: List[RosterEntry] = Field(max_length=2000)


class CopyWeekIn(BaseModel):
    from_week: str
    to_week: str


def create_router(db, get_current_user, require_role, create_audit_log, hash_password, get_permissions,
                  check_module_permission: Callable[[Dict[str, Any], str, str], Awaitable[bool]]):
    router = APIRouter()

    async def settings() -> Dict[str, Any]:
        s = await db.hr_settings.find_one({"key": "defaults"}) or {}
        out = {**DEFAULT_SETTINGS, **{k: v for k, v in s.items() if k in DEFAULT_SETTINGS and v is not None}}
        out["notice_days"] = {**DEFAULT_SETTINGS["notice_days"], **(out.get("notice_days") or {})}
        return out

    async def _hr(request: Request, action: str = "view") -> Dict[str, Any]:
        """The HR page (Permissions decide; admins always)."""
        user = await get_current_user(request)
        if user["role"] != "admin" and not await check_module_permission(user, "module_hr", action):
            raise HTTPException(status_code=403, detail="Your role can't use HR. An admin can change this in Settings → Permissions.")
        return user

    async def _exits_ok(request: Request) -> Dict[str, Any]:
        user = await _hr(request)
        if user["role"] != "admin" and not (await get_permissions(user["role"])).get("can_manage_exits"):
            raise HTTPException(status_code=403, detail="Exits are for admins (or roles given “Handle resignations and terminations”)")
        return user

    async def _people_map(active_only: bool = False) -> Dict[str, Dict[str, Any]]:
        q = {"active": {"$ne": False}} if active_only else {}
        return {str(u["_id"]): u async for u in db.users.find(q, {"password_hash": 0, "totp_secret": 0, "totp_secret_enc": 0})}

    def _date(v: Optional[str], label: str, required: bool = False) -> Optional[date]:
        d = notify.to_date(v)
        if v and not d:
            raise HTTPException(status_code=400, detail=f"{label} must be a date (YYYY-MM-DD)")
        if required and not d:
            raise HTTPException(status_code=400, detail=f"Enter the {label.lower()}")
        return d

    async def _user(uid: str, label: str = "Person") -> Dict[str, Any]:
        u = await db.users.find_one({"_id": ObjectId(uid)}) if uid and ObjectId.is_valid(uid) else None
        if not u:
            raise HTTPException(status_code=400, detail=f"{label} not found")
        return u

    # ═══════════════ settings ═══════════════
    @router.get("/hr/settings")
    async def get_settings(request: Request):
        await get_current_user(request)
        return await settings()

    @router.put("/hr/settings")
    async def put_settings(request: Request):
        user = await get_current_user(request)
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can change HR settings")
        body = await request.json()
        nd = {k: max(0, min(int(v), 180)) for k, v in (body.get("notice_days") or {}).items() if k in EXIT_TYPES}
        depts = [str(x).strip()[:40] for x in (body.get("departments") or []) if str(x).strip()][:30]
        s = {"notice_days": {**DEFAULT_SETTINGS["notice_days"], **nd}, "departments": depts or DEFAULT_SETTINGS["departments"],
             "grace_minutes": max(0, min(int(body.get("grace_minutes", 10)), 120))}
        await db.hr_settings.update_one({"key": "defaults"}, {"$set": {**s, "key": "defaults"}}, upsert=True)
        await create_audit_log(user["id"], user["name"], "hr_settings_updated", "hr_settings", "defaults", None, s)
        return s

    # ═══════════════ exits: close the ones whose last day has passed ═══════════════
    async def close_due_exits() -> int:
        today = notify.today_ist().isoformat()
        n = 0
        async for e in db.hr_exits.find({"status": "serving_notice", "last_working_day": {"$lt": today}}):
            await _complete_exit(e, {"id": "system", "name": "System"})
            n += 1
        return n

    router.close_due_exits = close_due_exits

    async def _complete_exit(e: Dict[str, Any], by: Dict[str, Any]) -> None:
        now = notify.now_utc().isoformat()
        await db.hr_exits.update_one({"_id": e["_id"]}, {"$set": {"status": "completed", "completed_at": now, "completed_by": by["name"]}})
        if ObjectId.is_valid(e.get("user_id") or ""):
            await db.users.update_one({"_id": ObjectId(e["user_id"])}, {"$set": {"active": False, "left_on": e.get("last_working_day"), "disabled_at": now,
                                                                                "employment_status": "left"}})
        await notify.clear(db, "hr_exit", "hr_exit", str(e["_id"]))
        await create_audit_log(by["id"], by["name"], "hr_exit_completed", "user", e.get("user_id"), None,
                               {"type": e.get("type"), "last_working_day": e.get("last_working_day")})

    # ═══════════════ overview ═══════════════
    @router.get("/hr/overview")
    async def overview(request: Request):
        await _hr(request)
        await close_due_exits()
        today = notify.today_ist()
        people = await _people_map()
        active = [u for u in people.values() if u.get("active") is not False]
        by_dept: Dict[str, int] = defaultdict(int)
        for u in active:
            by_dept[u.get("department") or "Not set"] += 1
        year_ago = (today - timedelta(days=365)).isoformat()
        left_12m = sum(1 for u in people.values() if u.get("active") is False and str(u.get("left_on") or "") >= year_ago)
        exits = [e async for e in db.hr_exits.find({"status": "serving_notice"}).sort("last_working_day", 1)]
        openings = [o async for o in db.hr_openings.find({"status": "open"})]
        cands = [c async for c in db.hr_candidates.find({"stage": {"$in": list(OPEN_STAGES)}})]
        by_stage = {s: sum(1 for c in cands if c.get("stage") == s) for s in OPEN_STAGES}
        week = (today + timedelta(days=7)).isoformat()
        interviews = sorted([{"candidate": c.get("name"), "at": i.get("at"), "mode": i.get("mode"), "interviewer": i.get("interviewer_name"), "candidate_id": str(c["_id"])}
                             for c in cands for i in (c.get("interviews") or []) if not i.get("result") and today.isoformat() <= str(i.get("at"))[:10] <= week],
                            key=lambda r: r["at"])
        t = today.isoformat()
        covers = [c async for c in db.hr_covers.find({"status": {"$ne": "cancelled"}, "start_date": {"$lte": t}, "end_date": {"$gte": t}})]
        joined_month = sum(1 for u in active if str(u.get("joining_date") or "")[:7] == t[:7])
        return {
            "headcount": len(active), "by_department": dict(sorted(by_dept.items(), key=lambda kv: -kv[1])), "joined_this_month": joined_month,
            "on_notice": [{"id": str(e["_id"]), "name": (people.get(e.get("user_id")) or {}).get("name"), "type": e.get("type"),
                           "last_working_day": e.get("last_working_day"), "days_left": (notify.to_date(e.get("last_working_day")) - today).days} for e in exits],
            "left_12m": left_12m, "attrition_pct": round(left_12m / max(len(active) + left_12m, 1) * 100, 1),
            "open_positions": sum(int(o.get("positions") or 1) - int(o.get("filled") or 0) for o in openings), "openings": len(openings),
            "pipeline": by_stage, "interviews_week": interviews[:10],
            "covers_today": [{"absent": (people.get(c["absent_user_id"]) or {}).get("name"), "cover": (people.get(c["cover_user_id"]) or {}).get("name"),
                              "reason": c.get("reason"), "until": c.get("end_date")} for c in covers],
        }

    # ═══════════════ people ═══════════════
    @router.get("/hr/people")
    async def people(request: Request, include_left: bool = False):
        await _hr(request)
        await close_due_exits()
        pm = await _people_map()
        exits = {e["user_id"]: e async for e in db.hr_exits.find({"status": "serving_notice"})}
        shifts = {str(s["_id"]): s.get("name") async for s in db.hr_shifts.find({})}
        rows = []
        for uid, u in pm.items():
            if u.get("active") is False and not include_left:
                continue
            e = exits.get(uid)
            rows.append({"id": uid, "name": u.get("name"), "email": u.get("email"), "phone": u.get("phone"), "role": u.get("role"),
                         "designation": u.get("designation"), "department": u.get("department"), "reports_to": u.get("reports_to"),
                         "reports_to_name": (pm.get(u.get("reports_to")) or {}).get("name"), "joining_date": u.get("joining_date"),
                         "employee_code": u.get("employee_code"), "default_shift_id": u.get("default_shift_id"),
                         "default_shift": shifts.get(u.get("default_shift_id")), "active": u.get("active") is not False,
                         "status": "left" if u.get("active") is False else ("on_notice" if e else "active"),
                         "last_working_day": (e or {}).get("last_working_day") or u.get("left_on"),
                         "location_ids": u.get("location_ids") or [], "default_location_id": u.get("default_location_id")})
        rows.sort(key=lambda r: ({"admin": 0, "manager": 1}.get(r["role"], 2), (r["name"] or "").lower()))
        return rows

    @router.put("/hr/people/{user_id}")
    async def update_person(user_id: str, body: PersonIn, request: Request):
        user = await _hr(request, "edit")
        target = await _user(user_id)
        upd: Dict[str, Any] = {}
        for k in ("designation", "department", "employee_code"):
            v = getattr(body, k)
            upd[k] = (v or "").strip()[:60] or None
        if body.joining_date is not None:
            upd["joining_date"] = _date(body.joining_date, "Joining date").isoformat() if body.joining_date else None
        if body.reports_to:
            await _user(body.reports_to, "Manager")
            if body.reports_to == user_id:
                raise HTTPException(status_code=400, detail="Someone can't report to themselves")
            reports = {str(u["_id"]): u.get("reports_to") async for u in db.users.find({}, {"reports_to": 1})}
            if would_loop(reports, user_id, body.reports_to):
                raise HTTPException(status_code=400, detail="That would make a circle in the org chart")
        upd["reports_to"] = body.reports_to or None
        if body.default_shift_id:
            if not await db.hr_shifts.find_one({"_id": _oid(body.default_shift_id)}, {"_id": 1}):
                raise HTTPException(status_code=400, detail="Shift not found")
        upd["default_shift_id"] = body.default_shift_id or None
        if upd.get("employee_code") and await db.users.find_one({"employee_code": upd["employee_code"], "_id": {"$ne": target["_id"]}}, {"_id": 1}):
            raise HTTPException(status_code=400, detail="Another person already has this employee code")
        await db.users.update_one({"_id": target["_id"]}, {"$set": upd})
        await create_audit_log(user["id"], user["name"], "hr_person_updated", "user", user_id, {k: target.get(k) for k in upd}, upd)
        return {"ok": True, **upd}

    # ═══════════════ hiring ═══════════════
    @router.get("/hr/openings")
    async def openings(request: Request):
        await _hr(request)
        counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        async for c in db.hr_candidates.find({}, {"opening_id": 1, "stage": 1}):
            counts[c.get("opening_id")][c.get("stage")] += 1
        rows = []
        async for o in db.hr_openings.find({}).sort("created_at", -1):
            r = _ser(o)
            st = counts.get(r["id"], {})
            r["candidates"] = sum(st.values())
            r["in_process"] = sum(v for k, v in st.items() if k in OPEN_STAGES)
            r["hired"] = st.get("hired", 0)
            rows.append(r)
        return rows

    def _clean_opening(body: OpeningIn) -> Dict[str, Any]:
        if body.employment_type not in ("full_time", "part_time", "contract", "intern"):
            raise HTTPException(status_code=400, detail="Unknown employment type")
        if body.status not in ("open", "on_hold", "closed", "filled"):
            raise HTTPException(status_code=400, detail="Unknown status")
        return {**body.model_dump(), "title": body.title.strip()}

    @router.post("/hr/openings")
    async def add_opening(body: OpeningIn, request: Request):
        user = await _hr(request, "create")
        doc = {**_clean_opening(body), "filled": 0, "created_at": notify.now_utc().isoformat(), "created_by": user["name"]}
        res = await db.hr_openings.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "hr_opening_created", "hr_opening", str(res.inserted_id), None, {"title": doc["title"]})
        return _ser({**doc, "_id": res.inserted_id})

    @router.put("/hr/openings/{opening_id}")
    async def edit_opening(opening_id: str, body: OpeningIn, request: Request):
        user = await _hr(request, "edit")
        r = await db.hr_openings.update_one({"_id": _oid(opening_id)}, {"$set": {**_clean_opening(body), "updated_at": notify.now_utc().isoformat()}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Opening not found")
        await create_audit_log(user["id"], user["name"], "hr_opening_updated", "hr_opening", opening_id)
        return _ser(await db.hr_openings.find_one({"_id": ObjectId(opening_id)}))

    @router.get("/hr/candidates")
    async def candidates(request: Request, opening_id: Optional[str] = None, stage: Optional[str] = None):
        await _hr(request)
        q: Dict[str, Any] = {}
        if opening_id:
            q["opening_id"] = opening_id
        if stage == "open":
            q["stage"] = {"$in": list(OPEN_STAGES)}
        elif stage:
            q["stage"] = stage
        titles = {str(o["_id"]): o.get("title") async for o in db.hr_openings.find({}, {"title": 1})}
        return [{**_ser(c), "opening_title": titles.get(c.get("opening_id"))} async for c in db.hr_candidates.find(q).sort("updated_at", -1).limit(500)]

    def _clean_candidate(body: CandidateIn) -> Dict[str, Any]:
        rp = (body.resume_path or "").strip() or None
        if rp and not re.fullmatch(r"[\w\-]+/(images|documents)/[\w\-]+\.(png|jpe?g|webp|pdf|docx?)", rp, flags=re.I):
            raise HTTPException(status_code=400, detail="Attach the resume as a PDF, Word file or picture")
        return {**body.model_dump(), "name": body.name.strip(), "resume_path": rp, "email": (body.email or "").strip().lower() or None}

    @router.post("/hr/candidates")
    async def add_candidate(body: CandidateIn, request: Request):
        user = await _hr(request, "create")
        if body.opening_id and not await db.hr_openings.find_one({"_id": _oid(body.opening_id)}, {"_id": 1}):
            raise HTTPException(status_code=400, detail="Opening not found")
        now = notify.now_utc().isoformat()
        doc = {**_clean_candidate(body), "stage": "applied", "interviews": [], "stage_history": [{"stage": "applied", "at": now, "by": user["name"]}],
               "created_at": now, "updated_at": now, "created_by": user["name"]}
        if doc.get("phone") and await db.hr_candidates.find_one({"phone": doc["phone"], "opening_id": doc.get("opening_id")}, {"_id": 1}):
            raise HTTPException(status_code=400, detail="This person has already applied for this opening")
        res = await db.hr_candidates.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "hr_candidate_added", "hr_candidate", str(res.inserted_id), None, {"name": doc["name"]})
        return _ser({**doc, "_id": res.inserted_id})

    @router.put("/hr/candidates/{cand_id}")
    async def edit_candidate(cand_id: str, body: CandidateIn, request: Request):
        user = await _hr(request, "edit")
        r = await db.hr_candidates.update_one({"_id": _oid(cand_id)}, {"$set": {**_clean_candidate(body), "updated_at": notify.now_utc().isoformat()}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Candidate not found")
        await create_audit_log(user["id"], user["name"], "hr_candidate_updated", "hr_candidate", cand_id)
        return _ser(await db.hr_candidates.find_one({"_id": ObjectId(cand_id)}))

    @router.post("/hr/candidates/{cand_id}/stage")
    async def move_stage(cand_id: str, body: StageIn, request: Request):
        user = await _hr(request, "edit")
        if body.stage not in STAGES or body.stage == "hired":
            raise HTTPException(status_code=400, detail="Unknown stage" if body.stage not in STAGES else "Use Hire to hire someone")
        c = await db.hr_candidates.find_one({"_id": _oid(cand_id)})
        if not c:
            raise HTTPException(status_code=404, detail="Candidate not found")
        if c.get("stage") == "hired":
            raise HTTPException(status_code=400, detail="This person is already hired")
        now = notify.now_utc().isoformat()
        await db.hr_candidates.update_one({"_id": c["_id"]}, {"$set": {"stage": body.stage, "updated_at": now},
                                                             "$push": {"stage_history": {"stage": body.stage, "at": now, "by": user["name"], "note": body.note}}})
        await create_audit_log(user["id"], user["name"], f"hr_candidate_{body.stage}", "hr_candidate", cand_id, None, {"note": body.note})
        return {"ok": True, "stage": body.stage}

    @router.post("/hr/candidates/{cand_id}/interviews")
    async def add_interview(cand_id: str, body: InterviewIn, request: Request):
        user = await _hr(request, "edit")
        c = await db.hr_candidates.find_one({"_id": _oid(cand_id)})
        if not c:
            raise HTTPException(status_code=404, detail="Candidate not found")
        try:
            at = datetime.fromisoformat(body.at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Interview time must be a date and time")
        if body.mode not in ("in_person", "phone", "video"):
            raise HTTPException(status_code=400, detail="Mode must be in person, phone or video")
        who = await _user(body.interviewer_id, "Interviewer") if body.interviewer_id else None
        iv = {"id": uuid.uuid4().hex[:10], "at": at.strftime("%Y-%m-%dT%H:%M"), "mode": body.mode, "interviewer_id": body.interviewer_id,
              "interviewer_name": (who or {}).get("name"), "notes": body.notes, "result": None, "by": user["name"]}
        now = notify.now_utc().isoformat()
        upd: Dict[str, Any] = {"$push": {"interviews": iv}, "$set": {"updated_at": now}}
        if c.get("stage") in ("applied", "screening"):
            upd["$set"]["stage"] = "interview"
            upd["$push"]["stage_history"] = {"stage": "interview", "at": now, "by": user["name"]}
        await db.hr_candidates.update_one({"_id": c["_id"]}, upd)
        if who:
            when = datetime.combine(at.date(), at.time(), tzinfo=notify.IST) - timedelta(hours=2)
            await notify.plan(db, kind="hr_interview", source_type="hr_candidate", source_id=cand_id, user_ids=[str(who["_id"])], tag=iv["id"],
                              title=f"Interview: {c['name']} at {at.strftime('%d %b, %I:%M %p')}", message=f"{body.mode.replace('_', ' ')} · {c.get('phone') or ''}",
                              link="/dashboard/hr?tab=hiring", notify_at=max(when, notify.now_utc()).astimezone(notify.now_utc().tzinfo).isoformat())
        await create_audit_log(user["id"], user["name"], "hr_interview_planned", "hr_candidate", cand_id, None, {"at": iv["at"]})
        return iv

    @router.put("/hr/candidates/{cand_id}/interviews/{iv_id}")
    async def interview_result(cand_id: str, iv_id: str, body: InterviewResultIn, request: Request):
        user = await _hr(request, "edit")
        if body.result not in ("passed", "failed", "no_show", "rescheduled"):
            raise HTTPException(status_code=400, detail="Unknown result")
        r = await db.hr_candidates.update_one({"_id": _oid(cand_id), "interviews.id": iv_id},
                                              {"$set": {"interviews.$.result": body.result, "interviews.$.result_notes": body.notes,
                                                        "interviews.$.result_by": user["name"], "updated_at": notify.now_utc().isoformat()}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Interview not found")
        return {"ok": True}

    @router.post("/hr/candidates/{cand_id}/hire")
    async def hire(cand_id: str, body: HireIn, request: Request):
        user = await _hr(request, "edit")
        c = await db.hr_candidates.find_one({"_id": _oid(cand_id)})
        if not c:
            raise HTTPException(status_code=404, detail="Candidate not found")
        if c.get("stage") == "hired":
            raise HTTPException(status_code=400, detail="Already hired")
        joining = _date(body.joining_date, "Joining date", required=True)
        login_id = None
        if body.create_login:
            if user["role"] != "admin":
                raise HTTPException(status_code=403, detail="Only an admin can create the login — mark hired now and ask an admin")
            email = (body.email or c.get("email") or "").strip().lower()
            if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
                raise HTTPException(status_code=400, detail="Enter a valid email for the login")
            if body.role not in ("staff", "manager"):
                raise HTTPException(status_code=400, detail="Role must be staff or manager")
            if len(body.temp_password or "") < 8:
                raise HTTPException(status_code=400, detail="Give a temporary password of 8+ characters")
            if await db.users.find_one({"email": email}, {"_id": 1}):
                raise HTTPException(status_code=400, detail="Email already registered")
            if body.reports_to:
                await _user(body.reports_to, "Manager")
            doc = {"email": email, "password_hash": hash_password(body.temp_password), "name": c["name"], "role": body.role, "phone": c.get("phone"),
                   "must_reset_password": True, "designation": (body.designation or "").strip() or None, "department": body.department,
                   "reports_to": body.reports_to or None, "joining_date": joining.isoformat(), "candidate_id": cand_id,
                   "created_at": notify.now_utc().isoformat()}
            login_id = str((await db.users.insert_one(doc)).inserted_id)
        now = notify.now_utc().isoformat()
        await db.hr_candidates.update_one({"_id": c["_id"]}, {"$set": {"stage": "hired", "joining_date": joining.isoformat(), "user_id": login_id,
                                                                      "hired_designation": body.designation, "hired_department": body.department,
                                                                      "updated_at": now},
                                                             "$push": {"stage_history": {"stage": "hired", "at": now, "by": user["name"]}}})
        if c.get("opening_id") and ObjectId.is_valid(c["opening_id"]):
            o = await db.hr_openings.find_one_and_update({"_id": ObjectId(c["opening_id"])}, {"$inc": {"filled": 1}}, return_document=True)
            if o and int(o.get("filled") or 0) >= int(o.get("positions") or 1):
                await db.hr_openings.update_one({"_id": o["_id"]}, {"$set": {"status": "filled"}})
        await create_audit_log(user["id"], user["name"], "hr_candidate_hired", "hr_candidate", cand_id, None,
                               {"joining_date": joining.isoformat(), "login_created": bool(login_id)})
        return {"ok": True, "user_id": login_id, "joining_date": joining.isoformat()}

    # ═══════════════ cover for absent staff ═══════════════
    async def _cover_doc(body: CoverIn, ignore_id: Optional[ObjectId] = None) -> Dict[str, Any]:
        if body.reason not in COVER_REASONS:
            raise HTTPException(status_code=400, detail="Unknown reason")
        s, e = _date(body.start_date, "Start date", True), _date(body.end_date, "End date", True)
        if e < s:
            raise HTTPException(status_code=400, detail="End date is before the start date")
        if (e - s).days > 90:
            raise HTTPException(status_code=400, detail="A cover can run for at most 90 days — add another for longer")
        if body.absent_user_id == body.cover_user_id:
            raise HTTPException(status_code=400, detail="Choose someone else to cover")
        absent, cover = await _user(body.absent_user_id, "Person away"), await _user(body.cover_user_id, "Cover person")
        if cover.get("active") is False:
            raise HTTPException(status_code=400, detail=f"{cover.get('name')}'s login is switched off")
        base = {"status": {"$ne": "cancelled"}, "start_date": {"$lte": e.isoformat()}, "end_date": {"$gte": s.isoformat()}}
        if ignore_id:
            base["_id"] = {"$ne": ignore_id}
        if await db.hr_covers.find_one({**base, "absent_user_id": body.absent_user_id}, {"_id": 1}):
            raise HTTPException(status_code=400, detail=f"{absent.get('name')} already has a cover on some of these days")
        clash = await db.hr_covers.find_one({**base, "absent_user_id": body.cover_user_id})
        if clash:
            raise HTTPException(status_code=400, detail=f"{cover.get('name')} is away {clash['start_date']} – {clash['end_date']} and can't cover")
        if body.shift_id and not await db.hr_shifts.find_one({"_id": _oid(body.shift_id)}, {"_id": 1}):
            raise HTTPException(status_code=400, detail="Shift not found")
        return {"absent_user_id": body.absent_user_id, "absent_name": absent.get("name"), "cover_user_id": body.cover_user_id, "cover_name": cover.get("name"),
                "start_date": s.isoformat(), "end_date": e.isoformat(), "reason": body.reason, "shift_id": body.shift_id or None,
                "handover_notes": (body.handover_notes or "").strip()[:1000] or None}

    async def _plan_cover_notes(c: Dict[str, Any]) -> None:
        cid = str(c["_id"])
        await notify.clear(db, "hr_cover", "hr_cover", cid)
        if c.get("status") == "cancelled":
            return
        s = notify.to_date(c["start_date"])
        span = f"{s.strftime('%d %b')}" + ("" if c["start_date"] == c["end_date"] else f" – {notify.to_date(c['end_date']).strftime('%d %b')}")
        await notify.plan(db, kind="hr_cover", source_type="hr_cover", source_id=cid, user_ids=[c["cover_user_id"]], tag="set",
                          title=f"You are covering for {c['absent_name']} · {span}", message=(c.get("handover_notes") or "See the handover notes in HR")[:200],
                          link="/dashboard/hr?tab=cover")
        if s > notify.today_ist():
            await notify.plan(db, kind="hr_cover", source_type="hr_cover", source_id=cid, user_ids=[c["cover_user_id"]], tag="start",
                              title=f"Today you cover for {c['absent_name']}", message=(c.get("handover_notes") or "")[:200] or "Check the handover notes",
                              link="/dashboard/hr?tab=cover", notify_at=notify.morning_of(s, 8))

    @router.get("/hr/covers")
    async def covers(request: Request, start: Optional[str] = None, end: Optional[str] = None, include_cancelled: bool = False):
        user = await get_current_user(request)
        sees_all = user["role"] == "admin" or await check_module_permission(user, "module_hr", "view")
        today = notify.today_ist()
        s0 = (start or (today - timedelta(days=30)).isoformat())[:10]
        s1 = (end or (today + timedelta(days=90)).isoformat())[:10]
        q: Dict[str, Any] = {"start_date": {"$lte": s1}, "end_date": {"$gte": s0}}
        if not include_cancelled:
            q["status"] = {"$ne": "cancelled"}
        if not sees_all:   # everyone sees the covers they are part of
            q["$or"] = [{"absent_user_id": user["id"]}, {"cover_user_id": user["id"]}]
        shifts = {str(s["_id"]): s.get("name") async for s in db.hr_shifts.find({})}
        rows = []
        async for c in db.hr_covers.find(q).sort("start_date", 1):
            r = _ser(c)
            r["shift_name"] = shifts.get(c.get("shift_id"))
            r["today"] = c["start_date"] <= today.isoformat() <= c["end_date"]
            rows.append(r)
        return rows

    @router.get("/hr/covers/suggest")
    async def suggest_cover(request: Request, user_id: str, start: str, end: str):
        """Who could cover: active people not away then — same department first, then same branch, fewest covers lately."""
        await _hr(request)
        s, e = _date(start, "Start date", True), _date(end, "End date", True)
        absent = await _user(user_id)
        away = {c["absent_user_id"] async for c in db.hr_covers.find({"status": {"$ne": "cancelled"}, "start_date": {"$lte": e.isoformat()}, "end_date": {"$gte": s.isoformat()}})}
        load: Dict[str, int] = defaultdict(int)
        async for c in db.hr_covers.find({"status": {"$ne": "cancelled"}, "start_date": {"$gte": (notify.today_ist() - timedelta(days=60)).isoformat()}}):
            load[c["cover_user_id"]] += 1
        locs = set(absent.get("location_ids") or []) | ({absent.get("default_location_id")} if absent.get("default_location_id") else set())
        rows = []
        async for u in db.users.find({"active": {"$ne": False}}, {"name": 1, "department": 1, "designation": 1, "location_ids": 1, "default_location_id": 1, "role": 1}):
            uid = str(u["_id"])
            if uid == user_id or uid in away:
                continue
            same_dept = bool(absent.get("department")) and u.get("department") == absent.get("department")
            ulocs = set(u.get("location_ids") or []) | ({u.get("default_location_id")} if u.get("default_location_id") else set())
            same_loc = bool(locs & ulocs)
            rows.append({"id": uid, "name": u.get("name"), "department": u.get("department"), "designation": u.get("designation"),
                         "same_department": same_dept, "same_branch": same_loc, "recent_covers": load.get(uid, 0)})
        rows.sort(key=lambda r: (not r["same_department"], not r["same_branch"], r["recent_covers"], (r["name"] or "").lower()))
        return rows[:12]

    @router.post("/hr/covers")
    async def add_cover(body: CoverIn, request: Request):
        user = await _hr(request, "create")
        doc = await _cover_doc(body)
        doc.update({"status": "planned", "created_by": user["name"], "created_by_id": user["id"], "created_at": notify.now_utc().isoformat()})
        res = await db.hr_covers.insert_one(doc)
        doc["_id"] = res.inserted_id
        await _plan_cover_notes(doc)
        await create_audit_log(user["id"], user["name"], "hr_cover_created", "hr_cover", str(res.inserted_id), None,
                               {"absent": doc["absent_name"], "cover": doc["cover_name"], "from": doc["start_date"], "to": doc["end_date"]})
        return _ser(doc)

    @router.put("/hr/covers/{cover_id}")
    async def edit_cover(cover_id: str, body: CoverIn, request: Request):
        user = await _hr(request, "edit")
        cur = await db.hr_covers.find_one({"_id": _oid(cover_id)})
        if not cur or cur.get("status") == "cancelled":
            raise HTTPException(status_code=404, detail="Cover not found")
        doc = await _cover_doc(body, ignore_id=cur["_id"])
        await db.hr_covers.update_one({"_id": cur["_id"]}, {"$set": {**doc, "updated_at": notify.now_utc().isoformat()}})
        fresh = await db.hr_covers.find_one({"_id": cur["_id"]})
        await _plan_cover_notes(fresh)
        await create_audit_log(user["id"], user["name"], "hr_cover_updated", "hr_cover", cover_id)
        return _ser(fresh)

    @router.post("/hr/covers/{cover_id}/cancel")
    async def cancel_cover(cover_id: str, request: Request):
        user = await _hr(request, "edit")
        r = await db.hr_covers.update_one({"_id": _oid(cover_id)}, {"$set": {"status": "cancelled", "cancelled_by": user["name"], "cancelled_at": notify.now_utc().isoformat()}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Cover not found")
        await notify.clear(db, "hr_cover", "hr_cover", cover_id)
        await create_audit_log(user["id"], user["name"], "hr_cover_cancelled", "hr_cover", cover_id)
        return {"ok": True}

    # ═══════════════ exits & notice period ═══════════════
    async def _plan_exit_notes(e: Dict[str, Any], name: str) -> None:
        eid = str(e["_id"])
        await notify.clear(db, "hr_exit", "hr_exit", eid)
        if e.get("status") != "serving_notice":
            return
        lwd = notify.to_date(e["last_working_day"])
        people = set(await notify.users_who_can(db, get_permissions, "module_hr", "edit"))
        u = await db.users.find_one({"_id": ObjectId(e["user_id"])}, {"reports_to": 1}) if ObjectId.is_valid(e["user_id"]) else None
        if (u or {}).get("reports_to"):
            people.add(u["reports_to"])
        people.discard(e["user_id"])
        when = lwd - timedelta(days=7)
        await notify.plan(db, kind="hr_exit", source_type="hr_exit", source_id=eid, user_ids=people, tag="week",
                          title=f"{name}'s last working day is {lwd.strftime('%d %b')}", message="Finish the handover checklist and the final settlement",
                          link="/dashboard/hr?tab=exits", notify_at=notify.morning_of(max(when, notify.today_ist())))

    def _exit_out(e: Dict[str, Any], pm: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        r = _ser(e)
        u = pm.get(e.get("user_id")) or {}
        lwd = notify.to_date(e.get("last_working_day"))
        r.update({"name": u.get("name"), "designation": u.get("designation"), "department": u.get("department"),
                  "days_left": (lwd - notify.today_ist()).days if lwd else None,
                  "checklist_done": sum(1 for c in e.get("checklist") or [] if c.get("done")), "checklist_total": len(e.get("checklist") or [])})
        return r

    @router.get("/hr/exits")
    async def exits(request: Request, status: Optional[str] = None):
        await _exits_ok(request)
        await close_due_exits()
        q = {"status": status} if status else {}
        pm = await _people_map()
        assets: Dict[str, int] = defaultdict(int)
        async for a in db.assets.find({"assigned_to": {"$nin": [None, ""]}, "status": "issued"}, {"assigned_to": 1}):
            assets[a["assigned_to"]] += 1
        rows = []
        async for e in db.hr_exits.find(q).sort("last_working_day", -1):
            r = _exit_out(e, pm)
            r["assets_with_person"] = assets.get(e.get("user_id"), 0)
            rows.append(r)
        rows.sort(key=lambda r: (r["status"] != "serving_notice", r.get("last_working_day") or ""))
        return rows

    @router.post("/hr/exits")
    async def add_exit(body: ExitIn, request: Request):
        user = await _exits_ok(request)
        if body.type not in EXIT_TYPES:
            raise HTTPException(status_code=400, detail="Unknown exit type")
        target = await _user(body.user_id)
        if body.user_id == user["id"]:
            raise HTTPException(status_code=400, detail="You can't record your own exit — ask another admin")
        if target.get("role") == "admin" and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can record an admin's exit")
        if target.get("active") is False:
            raise HTTPException(status_code=400, detail=f"{target.get('name')} has already left")
        if await db.hr_exits.find_one({"user_id": body.user_id, "status": "serving_notice"}, {"_id": 1}):
            raise HTTPException(status_code=400, detail=f"{target.get('name')} is already serving notice")
        if body.type == "termination" and len((body.reason or "").strip()) < 5:
            raise HTTPException(status_code=400, detail="Write the reason for the termination")
        s = await settings()
        start = _date(body.notice_start, "Notice start", True)
        days = body.notice_days if body.notice_days is not None else int(s["notice_days"].get(body.type, 30))
        if not (0 <= days <= 180) or not (0 <= body.waived_days <= days):
            raise HTTPException(status_code=400, detail="Notice days must be 0–180 and waived days can't be more than the notice")
        lwd = _date(body.last_working_day, "Last working day") or last_working_day(start, days, body.waived_days)
        if lwd < start:
            raise HTTPException(status_code=400, detail="The last working day can't be before the notice starts")
        now = notify.now_utc().isoformat()
        doc = {"user_id": body.user_id, "type": body.type, "reason": (body.reason or "").strip() or None, "notice_start": start.isoformat(),
               "notice_days": days, "waived_days": body.waived_days, "last_working_day": lwd.isoformat(), "status": "serving_notice",
               "checklist": [{"item": t, "done": False} for t in EXIT_CHECKLIST], "notes": body.notes, "created_by": user["name"], "created_at": now}
        res = await db.hr_exits.insert_one(doc)
        doc["_id"] = res.inserted_id
        await db.users.update_one({"_id": target["_id"]}, {"$set": {"access_until": lwd.isoformat(), "employment_status": "on_notice"}})
        await _plan_exit_notes(doc, target.get("name"))
        await create_audit_log(user["id"], user["name"], f"hr_exit_{body.type}", "user", body.user_id, None,
                               {"notice_days": days, "last_working_day": lwd.isoformat(), "reason": doc["reason"]})
        return _exit_out(doc, {body.user_id: target})

    @router.put("/hr/exits/{exit_id}")
    async def edit_exit(exit_id: str, body: ExitUpdateIn, request: Request):
        user = await _exits_ok(request)
        e = await db.hr_exits.find_one({"_id": _oid(exit_id)})
        if not e:
            raise HTTPException(status_code=404, detail="Exit not found")
        upd: Dict[str, Any] = {"updated_at": notify.now_utc().isoformat()}
        for k in ("reason", "notes", "exit_interview"):
            if getattr(body, k) is not None:
                upd[k] = (getattr(body, k) or "").strip() or None
        if body.checklist is not None:
            known = {c["item"]: c for c in e.get("checklist") or []}
            upd["checklist"] = [{"item": str(c.get("item") or "")[:120], "done": bool(c.get("done")),
                                 "done_by": (user["name"] if c.get("done") and not (known.get(c.get("item")) or {}).get("done") else (known.get(c.get("item")) or {}).get("done_by"))}
                                for c in body.checklist if str(c.get("item") or "").strip()][:20]
        if e.get("status") == "serving_notice" and (body.notice_days is not None or body.waived_days is not None or body.last_working_day):
            days = body.notice_days if body.notice_days is not None else int(e.get("notice_days") or 0)
            waived = body.waived_days if body.waived_days is not None else int(e.get("waived_days") or 0)
            if not (0 <= days <= 180) or not (0 <= waived <= days):
                raise HTTPException(status_code=400, detail="Notice days must be 0–180 and waived days can't be more than the notice")
            start = notify.to_date(e["notice_start"])
            lwd = _date(body.last_working_day, "Last working day") or last_working_day(start, days, waived)
            if lwd < start:
                raise HTTPException(status_code=400, detail="The last working day can't be before the notice starts")
            upd.update({"notice_days": days, "waived_days": waived, "last_working_day": lwd.isoformat()})
            await db.users.update_one({"_id": ObjectId(e["user_id"])}, {"$set": {"access_until": lwd.isoformat()}})
        await db.hr_exits.update_one({"_id": e["_id"]}, {"$set": upd})
        fresh = await db.hr_exits.find_one({"_id": e["_id"]})
        target = await db.users.find_one({"_id": ObjectId(e["user_id"])}) or {}
        await _plan_exit_notes(fresh, target.get("name", ""))
        await create_audit_log(user["id"], user["name"], "hr_exit_updated", "user", e["user_id"], None, {k: v for k, v in upd.items() if k != "checklist"})
        return _exit_out(fresh, {e["user_id"]: target})

    @router.post("/hr/exits/{exit_id}/withdraw")
    async def withdraw_exit(exit_id: str, request: Request):
        user = await _exits_ok(request)
        e = await db.hr_exits.find_one({"_id": _oid(exit_id)})
        if not e or e.get("status") != "serving_notice":
            raise HTTPException(status_code=400, detail="Only an exit that is still in its notice period can be withdrawn")
        await db.hr_exits.update_one({"_id": e["_id"]}, {"$set": {"status": "withdrawn", "withdrawn_by": user["name"], "withdrawn_at": notify.now_utc().isoformat()}})
        await db.users.update_one({"_id": ObjectId(e["user_id"])}, {"$unset": {"access_until": ""}, "$set": {"employment_status": "active"}})
        await notify.clear(db, "hr_exit", "hr_exit", exit_id)
        await create_audit_log(user["id"], user["name"], "hr_exit_withdrawn", "user", e["user_id"])
        return {"ok": True}

    @router.post("/hr/exits/{exit_id}/complete")
    async def complete_exit(exit_id: str, request: Request):
        """Close the exit now (relieved early or last day reached): the login is switched off."""
        user = await _exits_ok(request)
        e = await db.hr_exits.find_one({"_id": _oid(exit_id)})
        if not e or e.get("status") != "serving_notice":
            raise HTTPException(status_code=400, detail="This exit is already closed")
        await _complete_exit(e, user)
        return {"ok": True}

    # ═══════════════ shifts & roster ═══════════════
    def _clean_shift(body: ShiftIn) -> Dict[str, Any]:
        if not TIME_RX.match(body.start) or not TIME_RX.match(body.end):
            raise HTTPException(status_code=400, detail="Times must be HH:MM (24-hour)")
        if body.start == body.end:
            raise HTTPException(status_code=400, detail="Start and end can't be the same")
        color = (body.color or "").strip() or None
        if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise HTTPException(status_code=400, detail="Colour must look like #2a78d6")
        return {**body.model_dump(), "name": body.name.strip(), "color": color, "overnight": body.end < body.start}

    @router.get("/hr/shifts")
    async def shifts(request: Request):
        await get_current_user(request)
        return [_ser(s) async for s in db.hr_shifts.find({}).sort("start", 1)]

    @router.post("/hr/shifts")
    async def add_shift(body: ShiftIn, request: Request):
        user = await _hr(request, "create")
        doc = {**_clean_shift(body), "created_at": notify.now_utc().isoformat()}
        if await db.hr_shifts.find_one({"name": {"$regex": f"^{re.escape(doc['name'])}$", "$options": "i"}}, {"_id": 1}):
            raise HTTPException(status_code=400, detail="A shift with this name already exists")
        res = await db.hr_shifts.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "hr_shift_created", "hr_shift", str(res.inserted_id), None, {"name": doc["name"]})
        return _ser({**doc, "_id": res.inserted_id})

    @router.put("/hr/shifts/{shift_id}")
    async def edit_shift(shift_id: str, body: ShiftIn, request: Request):
        user = await _hr(request, "edit")
        r = await db.hr_shifts.update_one({"_id": _oid(shift_id)}, {"$set": {**_clean_shift(body), "updated_at": notify.now_utc().isoformat()}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Shift not found")
        await create_audit_log(user["id"], user["name"], "hr_shift_updated", "hr_shift", shift_id)
        return _ser(await db.hr_shifts.find_one({"_id": ObjectId(shift_id)}))

    def _shift_for(entries: Dict[Tuple[str, str], Optional[str]], u: Dict[str, Any], day: str) -> Optional[str]:
        v = entries.get((str(u["_id"]), day))
        return v if v is not None else u.get("default_shift_id")

    @router.get("/hr/roster")
    async def roster(request: Request, week: Optional[str] = None):
        user = await get_current_user(request)
        sees_all = user["role"] == "admin" or await check_module_permission(user, "module_hr", "view")
        days = week_days(notify.to_date(week) or notify.today_ist())
        s = await settings()
        shift_rows = {str(x["_id"]): x async for x in db.hr_shifts.find({})}
        uq: Dict[str, Any] = {"active": {"$ne": False}}
        if not sees_all:
            uq["_id"] = ObjectId(user["id"])
        people = [u async for u in db.users.find(uq, {"name": 1, "department": 1, "designation": 1, "default_shift_id": 1, "role": 1})]
        people.sort(key=lambda u: ((u.get("department") or "zzz").lower(), (u.get("name") or "").lower()))
        ids = [str(u["_id"]) for u in people]
        entries = {(r["user_id"], r["date"]): r.get("shift_id") async for r in db.hr_roster.find({"date": {"$in": days}, "user_id": {"$in": ids}})}
        att = {(r["user_id"], r["date"]): r async for r in db.attendance.find({"date": {"$in": days}, "user_id": {"$in": ids}})}
        covers = [c async for c in db.hr_covers.find({"status": {"$ne": "cancelled"}, "start_date": {"$lte": days[-1]}, "end_date": {"$gte": days[0]}})]
        today = notify.today_ist().isoformat()
        rows = []
        for u in people:
            uid = str(u["_id"])
            cells = []
            for d in days:
                sid = _shift_for(entries, u, d)
                sh = shift_rows.get(sid) if sid and sid != "off" else None
                a = att.get((uid, d))
                ci = ((a or {}).get("check_in") or {}).get("at")
                away = next((c for c in covers if c["absent_user_id"] == uid and c["start_date"] <= d <= c["end_date"]), None)
                covering = next((c for c in covers if c["cover_user_id"] == uid and c["start_date"] <= d <= c["end_date"]), None)
                cells.append({"date": d, "shift_id": sid, "set": (uid, d) in entries, "off": sid == "off", "shift_name": (sh or {}).get("name"),
                              "check_in": ci, "late_minutes": minutes_late(ci, (sh or {}).get("start"), s["grace_minutes"]) if sh and ci else None,
                              "missing": bool(sh) and not ci and d < today and not away,
                              "away": {"reason": away.get("reason"), "cover": away.get("cover_name")} if away else None,
                              "covering_for": covering.get("absent_name") if covering else None})
            rows.append({"id": uid, "name": u.get("name"), "department": u.get("department"), "designation": u.get("designation"),
                         "default_shift_id": u.get("default_shift_id"), "cells": cells})
        per_day = []
        for i, d in enumerate(days):
            counts: Dict[str, int] = defaultdict(int)
            for r in rows:
                c = r["cells"][i]
                if c["away"]:
                    counts["away"] += 1
                elif c["off"]:
                    counts["off"] += 1
                elif c["shift_name"]:
                    counts[c["shift_name"]] += 1
                else:
                    counts["no shift"] += 1
            per_day.append({"date": d, "counts": dict(counts)})
        return {"days": days, "shifts": [_ser(x) for x in shift_rows.values()], "people": rows, "per_day": per_day, "grace_minutes": s["grace_minutes"]}

    @router.put("/hr/roster")
    async def set_roster(body: RosterIn, request: Request):
        user = await _hr(request, "edit")
        valid = {str(x["_id"]) async for x in db.hr_shifts.find({}, {"_id": 1})}
        n = 0
        for e in body.entries:
            d = _date(e.date, "Date", True).isoformat()
            if not ObjectId.is_valid(e.user_id):
                raise HTTPException(status_code=400, detail="Person not found")
            if e.shift_id is None:
                await db.hr_roster.delete_one({"user_id": e.user_id, "date": d})
            else:
                if e.shift_id != "off" and e.shift_id not in valid:
                    raise HTTPException(status_code=400, detail="Shift not found")
                await db.hr_roster.update_one({"user_id": e.user_id, "date": d}, {"$set": {"shift_id": e.shift_id, "by": user["name"],
                                                                                          "at": notify.now_utc().isoformat()}}, upsert=True)
            n += 1
        await create_audit_log(user["id"], user["name"], "hr_roster_saved", "hr_roster", "week", None, {"entries": n})
        return {"saved": n}

    @router.post("/hr/roster/copy")
    async def copy_week(body: CopyWeekIn, request: Request):
        user = await _hr(request, "edit")
        src, dst = week_days(_date(body.from_week, "From week", True)), week_days(_date(body.to_week, "To week", True))
        if src == dst:
            raise HTTPException(status_code=400, detail="Choose a different week")
        n = 0
        async for r in db.hr_roster.find({"date": {"$in": src}}):
            d = dst[src.index(r["date"])]
            await db.hr_roster.update_one({"user_id": r["user_id"], "date": d}, {"$set": {"shift_id": r.get("shift_id"), "by": user["name"], "at": notify.now_utc().isoformat()}}, upsert=True)
            n += 1
        await create_audit_log(user["id"], user["name"], "hr_roster_copied", "hr_roster", dst[0], None, {"from": src[0], "entries": n})
        return {"copied": n}

    # ═══════════════ calendar ═══════════════
    async def calendar_items(start: date, end: date, user: Dict[str, Any], sees_hr: bool, sees_exits: bool) -> List[Dict[str, Any]]:
        s0, s1 = start.isoformat(), end.isoformat()
        out: List[Dict[str, Any]] = []
        cq: Dict[str, Any] = {"status": {"$ne": "cancelled"}, "start_date": {"$lte": s1}, "end_date": {"$gte": s0}}
        if not sees_hr:
            cq["$or"] = [{"absent_user_id": user["id"]}, {"cover_user_id": user["id"]}]
        async for c in db.hr_covers.find(cq):
            out.append({"date": max(c["start_date"], s0), "end": c["end_date"], "title": f"{c['absent_name']} away · {c['cover_name']} covers",
                        "detail": c.get("reason"), "source": "hr", "link": "/dashboard/hr?tab=cover", "id": f"cv-{c['_id']}"})
        if sees_hr:
            async for c in db.hr_candidates.find({"interviews.at": {"$gte": s0, "$lte": s1 + "T23:59"}}):
                for i in c.get("interviews") or []:
                    if s0 <= str(i.get("at"))[:10] <= s1:
                        out.append({"date": str(i["at"])[:10], "time": str(i["at"])[11:16], "title": f"Interview: {c['name']}",
                                    "detail": f"{(i.get('mode') or '').replace('_', ' ')} · {i.get('interviewer_name') or ''}", "source": "hr",
                                    "link": "/dashboard/hr?tab=hiring", "id": f"iv-{i['id']}"})
            async for c in db.hr_candidates.find({"stage": "hired", "joining_date": {"$gte": s0, "$lte": s1}}):
                out.append({"date": c["joining_date"], "title": f"Joining: {c['name']}", "detail": c.get("hired_designation"), "source": "hr",
                            "link": "/dashboard/hr?tab=hiring", "id": f"jn-{c['_id']}"})
        if sees_exits:
            pm = await _people_map()
            async for e in db.hr_exits.find({"status": "serving_notice", "last_working_day": {"$gte": s0, "$lte": s1}}):
                out.append({"date": e["last_working_day"], "title": f"Last working day: {(pm.get(e['user_id']) or {}).get('name')}",
                            "detail": EXIT_LABEL.get(e.get("type")), "source": "hr", "link": "/dashboard/hr?tab=exits", "id": f"ex-{e['_id']}"})
        return out

    router.calendar_items = calendar_items
    return router
