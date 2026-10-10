"""Daily reporting — two complementary records.

1. Daily report (one per person per day): what I did today — site work by project, leads,
   payments collected, service visits, problems, tomorrow's plan. Staff fill their own;
   admins/managers see the team's status for any date and can mark reports as reviewed.

2. Site diary (one per project per day): the site's own log — crew on site, stages done,
   progress %, materials used, safety, photos, next steps.

Both feed the existing reports: on save they write mirrored `daily_updates` entries
(leads / payment / progress / om) tagged with `source`, so the Marketing report, project
timeline, Company Health Score and Employee Performance keep working unchanged.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone, date as date_cls, timedelta
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

MANAGERS = ("admin", "manager")

SITE_STAGES = [
    "Site survey", "Material delivered", "Structure erected", "Panels mounted", "DC wiring done",
    "Inverter installed", "AC wiring & earthing", "Testing & commissioning", "Net-meter applied", "Handover done",
]
LEAD_KEYS = ["total_leads", "qualified_leads", "site_visits", "quotes_sent", "followups", "conversions"]
PAY_METHODS = ["upi", "cash", "bank_transfer", "cheque", "emi"]


# ───────────────────────────── models ─────────────────────────────
class SiteWorkLine(BaseModel):
    project_id: str
    work_done: str = ""
    progress_pct: Optional[float] = None
    crew_count: Optional[int] = None
    issues: str = ""


class PaymentLine(BaseModel):
    project_id: Optional[str] = None
    customer: str = ""
    amount: float = 0
    method: str = "upi"
    reference: str = ""


class ServiceLine(BaseModel):
    project_id: Optional[str] = None
    customer: str = ""
    issue: str = ""
    action: str = ""
    resolved: bool = False


class LeadCounts(BaseModel):
    total_leads: int = 0
    qualified_leads: int = 0
    site_visits: int = 0
    quotes_sent: int = 0
    followups: int = 0
    conversions: int = 0


class DailyReportIn(BaseModel):
    site_work: List[SiteWorkLine] = []
    leads: LeadCounts = LeadCounts()
    payments: List[PaymentLine] = []
    service: List[ServiceLine] = []
    highlights: str = ""
    issues: str = ""
    tomorrow_plan: str = ""
    hours_worked: Optional[float] = None
    km_travelled: Optional[float] = None
    submit: bool = False


class ReviewIn(BaseModel):
    comment: str = ""


class CrewLine(BaseModel):
    name: str = ""
    role: str = ""
    count: int = 1
    partner_id: Optional[str] = None


class MaterialLine(BaseModel):
    item: str
    qty: float = 0
    unit: str = "nos"
    inventory_item_id: Optional[str] = None


class SiteDiaryIn(BaseModel):
    weather: str = ""
    start_time: str = ""
    end_time: str = ""
    crew: List[CrewLine] = []
    stages_done: List[str] = []
    work_done: str = ""
    progress_pct: Optional[float] = None
    materials_used: List[MaterialLine] = []
    issues: str = ""
    safety_ok: Optional[bool] = None
    safety_notes: str = ""
    customer_feedback: str = ""
    next_steps: str = ""
    photos: List[str] = []


# ───────────────────────────── helpers ─────────────────────────────
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_date(d: str) -> str:
    if not d or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        raise HTTPException(status_code=400, detail="Date must look like 2026-10-09")
    try:
        parsed = date_cls.fromisoformat(d)
    except ValueError:
        raise HTTPException(status_code=400, detail="That date doesn't exist")
    # allow 'today' in any Indian/UTC offset: up to one day ahead of UTC
    if parsed > (datetime.now(timezone.utc).date() + timedelta(days=1)):
        raise HTTPException(status_code=400, detail="You can't report on a future date")
    return d


def _oid(v: str, what: str = "record") -> ObjectId:
    try:
        return ObjectId(v)
    except Exception:
        raise HTTPException(status_code=404, detail=f"{what.capitalize()} not found")


def _out(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return doc
    d = dict(doc)
    d["id"] = str(d.pop("_id"))
    return d


def _clip(v: Optional[float], lo: float, hi: float) -> Optional[float]:
    if v is None:
        return None
    return max(lo, min(hi, float(v)))


def _report_totals(doc: Dict[str, Any]) -> Dict[str, Any]:
    leads = doc.get("leads") or {}
    return {
        "projects": len(doc.get("site_work") or []),
        "leads": int(leads.get("total_leads") or 0),
        "won": int(leads.get("conversions") or 0),
        "payments": round(sum(float(p.get("amount") or 0) for p in (doc.get("payments") or [])), 2),
        "service_visits": len(doc.get("service") or []),
    }


def create_router(db, get_current_user, require_role, create_audit_log, has_option=None, report_required=None):
    """has_option(user, key) reads the Permissions page; report_required(user_doc) says who must send a report."""
    router = APIRouter()

    async def _project_names(ids: List[str]) -> Dict[str, Dict[str, Any]]:
        oids = [ObjectId(i) for i in {i for i in ids if i and ObjectId.is_valid(i)}]
        if not oids:
            return {}
        out = {}
        async for p in db.projects.find({"_id": {"$in": oids}}, {"customer": 1, "reference_number": 1, "location": 1, "status": 1}):
            out[str(p["_id"])] = {
                "customer": (p.get("customer") or {}).get("name") or "Unnamed",
                "reference_number": p.get("reference_number") or "",
                "district": (p.get("location") or {}).get("district") or "",
                "status": p.get("status"),
            }
        return out

    async def _mirror(source: str, source_id: str, user: Dict[str, Any], day: str, entries: List[Dict[str, Any]]):
        """Replace the legacy daily_updates rows written from one report/diary."""
        await db.daily_updates.delete_many({"source": source, "source_id": source_id})
        if not entries:
            return
        created_at = f"{day}T12:00:00+00:00"
        docs = [{**e, "source": source, "source_id": source_id, "date": day, "created_by": user["id"],
                 "created_by_name": user["name"], "created_at": created_at} for e in entries]
        await db.daily_updates.insert_many(docs)

    async def _sees_team(user) -> bool:
        if user["role"] == "admin":
            return True
        if has_option is not None:
            return await has_option(user, "can_review_daily_reports")
        return user["role"] in MANAGERS

    def _required(u) -> bool:
        if report_required is not None:
            return report_required(u)
        return u.get("role") != "admin"

    async def _can_see_report(user, doc):
        return doc.get("user_id") == user["id"] or await _sees_team(user)

    # ═════════════ project list for the pickers ═════════════
    @router.get("/daily-reports/projects")
    async def reportable_projects(request: Request):
        """Projects anyone can report on: every live (submitted / approved / completed) project in the user's
        locations, plus their own drafts. Staff otherwise only see projects they created, which left installers
        unable to pick the site they actually worked on."""
        user = await get_current_user(request)
        q: Dict[str, Any] = {"deleted_at": {"$exists": False},
                             "$or": [{"status": {"$in": ["submitted", "approved", "completed"]}}, {"created_by": user["id"]}]}
        scope = user.get("location_ids") or []
        if user["role"] != "admin" and scope:
            q = {"$and": [q, {"$or": [{"location_id": {"$in": scope}}, {"location_id": None}, {"location_id": {"$exists": False}}]}]}
        docs = await db.projects.find(q, {"customer": 1, "reference_number": 1, "location": 1, "status": 1, "custom_fields.proposed_solution.system_size_kw": 1,
                                          "created_by": 1, "created_at": 1}).sort("created_at", -1).to_list(2000)
        return [{"id": str(p["_id"]), "customer": {"name": (p.get("customer") or {}).get("name"), "phone": (p.get("customer") or {}).get("phone")},
                 "reference_number": p.get("reference_number") or f"SCR-{str(p['_id'])[-6:].upper()}",
                 "location": {"district": (p.get("location") or {}).get("district")}, "status": p.get("status"),
                 "system_size_kw": (((p.get("custom_fields") or {}).get("proposed_solution") or {}).get("system_size_kw")),
                 "created_by": p.get("created_by")} for p in docs]

    # ═════════════ daily reports ═════════════
    @router.get("/daily-reports/options")
    async def report_options(request: Request):
        await get_current_user(request)
        return {"site_stages": SITE_STAGES, "payment_methods": PAY_METHODS, "lead_keys": LEAD_KEYS}

    @router.get("/daily-reports/me")
    async def my_report(request: Request, date: str):
        user = await get_current_user(request)
        day = _check_date(date)
        doc = await db.daily_reports.find_one({"user_id": user["id"], "date": day})
        if not doc:
            return {"exists": False, "date": day, "status": "not_started", "user_id": user["id"], "user_name": user["name"]}
        out = _out(doc)
        out["exists"] = True
        out["project_info"] = await _project_names([w.get("project_id") for w in out.get("site_work", [])] +
                                                   [p.get("project_id") for p in out.get("payments", [])] +
                                                   [s.get("project_id") for s in out.get("service", [])])
        return out

    @router.put("/daily-reports/me")
    async def save_my_report(payload: DailyReportIn, request: Request, date: str):
        user = await get_current_user(request)
        day = _check_date(date)
        body = payload.dict()
        submit = body.pop("submit", False)
        for w in body["site_work"]:
            w["progress_pct"] = _clip(w.get("progress_pct"), 0, 100)
        for p in body["payments"]:
            if p["amount"] < 0:
                raise HTTPException(status_code=400, detail="Payment amounts can't be negative")
            if p["method"] not in PAY_METHODS:
                p["method"] = "upi"
        if any(v < 0 for v in body["leads"].values()):
            raise HTTPException(status_code=400, detail="Lead counts can't be negative")
        existing = await db.daily_reports.find_one({"user_id": user["id"], "date": day})
        now = _now()
        status = "submitted" if submit or (existing and existing.get("status") == "submitted") else "draft"
        doc = {**body, "user_id": user["id"], "user_name": user["name"], "role": user["role"], "date": day,
               "location_ids": user.get("location_ids") or [], "status": status, "updated_at": now}
        if submit and not (existing and existing.get("submitted_at")):
            doc["submitted_at"] = now
        if existing:
            await db.daily_reports.update_one({"_id": existing["_id"]}, {"$set": doc})
            rid = existing["_id"]
        else:
            doc["created_at"] = now
            rid = (await db.daily_reports.insert_one(doc)).inserted_id
        if status == "submitted":
            entries: List[Dict[str, Any]] = []
            if any(body["leads"].values()):
                entries.append({"project_id": "general", "update_type": "leads", "data": dict(body["leads"])})
            for w in body["site_work"]:
                if w.get("work_done") or w.get("progress_pct") is not None:
                    entries.append({"project_id": w["project_id"], "update_type": "progress",
                                    "data": {"work_done": w.get("work_done", ""), "completion_pct": w.get("progress_pct") if w.get("progress_pct") is not None else "",
                                             "issues": w.get("issues", ""), "crew_count": w.get("crew_count")}})
            for p in body["payments"]:
                if p["amount"] > 0:
                    entries.append({"project_id": p.get("project_id") or "general", "update_type": "payment",
                                    "data": {"amount": p["amount"], "payment_method": p["method"], "notes": p.get("reference", ""), "customer": p.get("customer", "")}})
            for s in body["service"]:
                if s.get("issue") or s.get("action"):
                    entries.append({"project_id": s.get("project_id") or "general", "update_type": "om",
                                    "data": {"service": s.get("issue", ""), "notes": s.get("action", ""), "resolved": s.get("resolved", False), "customer": s.get("customer", "")}})
            await _mirror("daily_report", str(rid), user, day, entries)
        saved = await db.daily_reports.find_one({"_id": rid})
        return {**_out(saved), "exists": True}

    @router.get("/daily-reports")
    async def list_reports(request: Request, date_from: Optional[str] = None, date_to: Optional[str] = None,
                           user_id: Optional[str] = None, status: Optional[str] = None, limit: int = 200):
        user = await get_current_user(request)
        q: Dict[str, Any] = {}
        if not await _sees_team(user):
            q["user_id"] = user["id"]
        elif user_id:
            q["user_id"] = user_id
        if date_from or date_to:
            q["date"] = {}
            if date_from:
                q["date"]["$gte"] = _check_date(date_from)
            if date_to:
                q["date"]["$lte"] = date_to
        if status:
            q["status"] = status
        docs = await db.daily_reports.find(q).sort([("date", -1), ("user_name", 1)]).to_list(max(1, min(limit, 1000)))
        out = []
        for d in docs:
            o = _out(d)
            o["totals"] = _report_totals(o)
            out.append(o)
        info = await _project_names([w.get("project_id") for o in out for w in o.get("site_work", [])] +
                                    [p.get("project_id") for o in out for p in o.get("payments", [])] +
                                    [s.get("project_id") for o in out for s in o.get("service", [])])
        return {"reports": out, "project_info": info}

    @router.get("/daily-reports/team")
    async def team_status(request: Request, date: str):
        user = await require_role(*MANAGERS)(request)
        day = _check_date(date)
        uq: Dict[str, Any] = {"active": {"$ne": False}}
        scope = user.get("location_ids") or []
        users = await db.users.find(uq, {"name": 1, "role": 1, "email": 1, "location_ids": 1, "daily_report_required": 1}).to_list(1000)
        if user["role"] != "admin" and scope:
            users = [u for u in users if not u.get("location_ids") or set(u.get("location_ids")) & set(scope)]
        reports = {r["user_id"]: r for r in await db.daily_reports.find({"date": day}).to_list(1000)}
        rows = []
        for u in sorted(users, key=lambda x: (x.get("name") or "").lower()):
            uid = str(u["_id"])
            r = reports.get(uid)
            rows.append({"user_id": uid, "name": u.get("name"), "role": u.get("role"), "email": u.get("email"), "required": _required(u),
                         "status": r.get("status") if r else "missing", "report_id": str(r["_id"]) if r else None,
                         "submitted_at": r.get("submitted_at") if r else None, "reviewed": bool(r and r.get("reviewed_at")),
                         "totals": _report_totals(r) if r else None})
        # people who don't have to report only count once they have sent one
        expected = [x for x in rows if x["required"] or x["status"] != "missing"]
        counts = {k: sum(1 for x in expected if x["status"] == k) for k in ("submitted", "draft", "missing")}
        counts["expected"] = len(expected)
        counts["not_required"] = sum(1 for x in rows if not x["required"])
        return {"date": day, "rows": rows, "counts": counts}

    @router.get("/daily-reports/{report_id}")
    async def get_report(report_id: str, request: Request):
        user = await get_current_user(request)
        doc = await db.daily_reports.find_one({"_id": _oid(report_id, "report")})
        if not doc or not await _can_see_report(user, doc):
            raise HTTPException(status_code=404, detail="Report not found")
        out = _out(doc)
        out["totals"] = _report_totals(out)
        out["project_info"] = await _project_names([w.get("project_id") for w in out.get("site_work", [])] +
                                                   [p.get("project_id") for p in out.get("payments", [])] +
                                                   [s.get("project_id") for s in out.get("service", [])])
        return out

    @router.put("/daily-reports/{report_id}/review")
    async def review_report(report_id: str, payload: ReviewIn, request: Request):
        user = await require_role(*MANAGERS)(request)
        doc = await db.daily_reports.find_one({"_id": _oid(report_id, "report")})
        if not doc:
            raise HTTPException(status_code=404, detail="Report not found")
        await db.daily_reports.update_one({"_id": doc["_id"]}, {"$set": {
            "reviewed_by": user["name"], "reviewed_by_id": user["id"], "reviewed_at": _now(), "review_comment": payload.comment.strip()}})
        return {"message": "Marked as reviewed"}

    @router.delete("/daily-reports/{report_id}")
    async def delete_report(report_id: str, request: Request):
        user = await get_current_user(request)
        doc = await db.daily_reports.find_one({"_id": _oid(report_id, "report")})
        if not doc:
            raise HTTPException(status_code=404, detail="Report not found")
        own_draft = doc.get("user_id") == user["id"] and doc.get("status") == "draft"
        if user["role"] != "admin" and not own_draft:
            raise HTTPException(status_code=403, detail="Only an admin can delete a submitted report")
        await db.daily_updates.delete_many({"source": "daily_report", "source_id": str(doc["_id"])})
        await db.daily_reports.delete_one({"_id": doc["_id"]})
        await create_audit_log(user["id"], user["name"], "delete", "daily_report", str(doc["_id"]), {"date": doc.get("date"), "user": doc.get("user_name")}, None)
        return {"message": "Report deleted"}

    # ═════════════ site diaries ═════════════
    async def _project_or_404(project_id: str) -> Dict[str, Any]:
        p = await db.projects.find_one({"_id": _oid(project_id, "project")}, {"customer": 1, "reference_number": 1, "location": 1, "status": 1,
                                                                            "custom_fields": 1, "solar_system": 1, "created_by": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        return p

    def _project_brief(p: Dict[str, Any]) -> Dict[str, Any]:
        ps = ((p.get("custom_fields") or {}).get("proposed_solution") or {})
        return {"id": str(p["_id"]), "customer": (p.get("customer") or {}).get("name") or "Unnamed",
                "phone": (p.get("customer") or {}).get("phone") or "", "address": (p.get("customer") or {}).get("address") or "",
                "reference_number": p.get("reference_number") or "", "district": (p.get("location") or {}).get("district") or "",
                "status": p.get("status"), "system_size_kw": ps.get("system_size_kw"),
                "system_type": ps.get("system_type") or (p.get("solar_system") or {}).get("system_type")}

    @router.get("/site-diaries")
    async def list_diaries(request: Request, project_id: Optional[str] = None, date_from: Optional[str] = None,
                           date_to: Optional[str] = None, mine: bool = False, limit: int = 100):
        user = await get_current_user(request)
        q: Dict[str, Any] = {}
        if project_id:
            q["project_id"] = project_id
        if mine:
            q["author_ids"] = user["id"]
        if date_from or date_to:
            q["date"] = {}
            if date_from:
                q["date"]["$gte"] = date_from
            if date_to:
                q["date"]["$lte"] = date_to
        docs = await db.site_diaries.find(q).sort([("date", -1), ("updated_at", -1)]).to_list(max(1, min(limit, 1000)))
        info = await _project_names([d.get("project_id") for d in docs])
        return {"diaries": [_out(d) for d in docs], "project_info": info}

    @router.get("/site-diaries/project/{project_id}")
    async def project_diary_book(project_id: str, request: Request, date_from: Optional[str] = None, date_to: Optional[str] = None):
        """Everything needed for the site-diary PDF of one project."""
        await get_current_user(request)
        p = await _project_or_404(project_id)
        q: Dict[str, Any] = {"project_id": project_id}
        if date_from or date_to:
            q["date"] = {}
            if date_from:
                q["date"]["$gte"] = date_from
            if date_to:
                q["date"]["$lte"] = date_to
        docs = await db.site_diaries.find(q).sort("date", 1).to_list(1000)
        return {"project": _project_brief(p), "diaries": [_out(d) for d in docs]}

    @router.get("/site-diaries/{project_id}/{day}")
    async def get_diary(project_id: str, day: str, request: Request):
        await get_current_user(request)
        p = await _project_or_404(project_id)
        _check_date(day)
        d = await db.site_diaries.find_one({"project_id": project_id, "date": day})
        prev = await db.site_diaries.find({"project_id": project_id, "date": {"$lt": day}}).sort("date", -1).to_list(1)
        base = {"project": _project_brief(p),
                "previous": {"date": prev[0]["date"], "progress_pct": prev[0].get("progress_pct"), "stages_done": prev[0].get("stages_done", []),
                             "next_steps": prev[0].get("next_steps", "")} if prev else None}
        if not d:
            return {**base, "exists": False, "project_id": project_id, "date": day}
        return {**base, **_out(d), "exists": True}

    @router.put("/site-diaries/{project_id}/{day}")
    async def save_diary(project_id: str, day: str, payload: SiteDiaryIn, request: Request):
        user = await get_current_user(request)
        p = await _project_or_404(project_id)
        _check_date(day)
        body = payload.dict()
        body["progress_pct"] = _clip(body.get("progress_pct"), 0, 100)
        body["stages_done"] = [s for s in body["stages_done"] if isinstance(s, str) and s.strip()][:30]
        body["photos"] = [ph for ph in body["photos"] if isinstance(ph, str) and ph.strip()][:20]
        for c in body["crew"]:
            c["count"] = max(0, int(c.get("count") or 0))
        now = _now()
        existing = await db.site_diaries.find_one({"project_id": project_id, "date": day})
        brief = _project_brief(p)
        doc = {**body, "project_id": project_id, "date": day, "customer": brief["customer"],
               "reference_number": brief["reference_number"], "updated_at": now,
               "updated_by": user["name"], "updated_by_id": user["id"],
               "crew_total": sum(c["count"] for c in body["crew"])}
        if existing:
            authors = existing.get("authors") or []
            author_ids = existing.get("author_ids") or []
            if user["id"] not in author_ids:
                authors.append(user["name"]); author_ids.append(user["id"])
            doc.update(authors=authors, author_ids=author_ids)
            await db.site_diaries.update_one({"_id": existing["_id"]}, {"$set": doc})
            did = existing["_id"]
        else:
            doc.update(authors=[user["name"]], author_ids=[user["id"]], created_at=now, created_by=user["name"])
            did = (await db.site_diaries.insert_one(doc)).inserted_id
        summary = body["work_done"] or ", ".join(body["stages_done"])
        entries = [{"project_id": project_id, "update_type": "progress",
                    "data": {"work_done": summary, "completion_pct": body["progress_pct"] if body["progress_pct"] is not None else "",
                             "issues": body["issues"], "crew_count": doc["crew_total"]}}] if (summary or body["progress_pct"] is not None) else []
        await _mirror("site_diary", str(did), user, day, entries)
        saved = await db.site_diaries.find_one({"_id": did})
        return {**_out(saved), "exists": True, "project": brief}

    @router.delete("/site-diaries/{diary_id}")
    async def delete_diary(diary_id: str, request: Request):
        user = await get_current_user(request)
        d = await db.site_diaries.find_one({"_id": _oid(diary_id, "diary")})
        if not d:
            raise HTTPException(status_code=404, detail="Diary not found")
        if user["role"] not in MANAGERS and user["id"] not in (d.get("author_ids") or []):
            raise HTTPException(status_code=403, detail="Only the people who wrote this diary or a manager can delete it")
        await db.daily_updates.delete_many({"source": "site_diary", "source_id": str(d["_id"])})
        await db.site_diaries.delete_one({"_id": d["_id"]})
        await create_audit_log(user["id"], user["name"], "delete", "site_diary", str(d["_id"]), {"date": d.get("date"), "project": d.get("customer")}, None)
        return {"message": "Diary deleted"}

    return router
