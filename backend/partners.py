"""Labour & Subcontractor / Internal Team management (Iteration 46 Change 1).

Every installation is subcontracted (or done by an internal crew modelled the
same way) — this module tracks who they are, their rate card, project
assignments priced off that rate card, retention held/released, and payments
against a running balance. Payments write into the SAME `account_entries`
ledger the Accounts module already uses for other payables (entry_type
`partner_payment`) rather than a parallel bookkeeping system.
"""
from __future__ import annotations
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from pydantic import BaseModel
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request


# ═══════════ Models ═══════════

class RateCardEntry(BaseModel):
    activity: str
    unit: str
    rate: float
    effective_from: str


class PartnerCreate(BaseModel):
    partner_type: str = "external_subcontractor"   # external_subcontractor | internal_team
    name: str
    company_name: Optional[str] = ""
    contact_person: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    gstin: Optional[str] = ""
    pan: Optional[str] = ""
    specialities: Optional[List[str]] = []          # on-grid|off-grid|hybrid|pump|electrical|civil
    service_districts: Optional[List[str]] = []
    team_size: Optional[int] = 0
    status: Optional[str] = "active"                # active|inactive|blacklisted
    onboarded_date: Optional[str] = None
    documents: Optional[List[Dict[str, Any]]] = []
    rate_card: Optional[List[RateCardEntry]] = []
    retention_pct: Optional[float] = 10
    non_solicit_acknowledged: Optional[bool] = False
    payment_terms: Optional[str] = ""


class PartnerUpdate(BaseModel):
    name: Optional[str] = None
    company_name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None
    specialities: Optional[List[str]] = None
    service_districts: Optional[List[str]] = None
    team_size: Optional[int] = None
    status: Optional[str] = None
    documents: Optional[List[Dict[str, Any]]] = None
    retention_pct: Optional[float] = None
    non_solicit_acknowledged: Optional[bool] = None
    payment_terms: Optional[str] = None


class AssignmentActivity(BaseModel):
    activity: str
    quantity: float


class AssignmentCreate(BaseModel):
    project_id: str
    activities: List[AssignmentActivity]
    assigned_date: Optional[str] = None
    expected_completion: Optional[str] = None


class AssignmentUpdate(BaseModel):
    status: Optional[str] = None                   # assigned|in_progress|completed|payment_pending|closed
    actual_completion: Optional[str] = None
    quality_rating: Optional[float] = None
    quality_notes: Optional[str] = None
    delay_reason: Optional[str] = None
    photos_before: Optional[List[str]] = None
    photos_after: Optional[List[str]] = None


class PaymentCreate(BaseModel):
    assignment_id: str
    amount: float
    mode: str = "bank_transfer"
    reference: Optional[str] = ""
    type: str = "advance"                           # advance|milestone|final  (retention_release uses its own endpoint)
    notes: Optional[str] = ""
    date: Optional[str] = None


# ═══════════ Helpers ═══════════

def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rate_for_activity(partner: Dict[str, Any], activity: str, at_date: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Most recent rate-card entry for `activity` with effective_from <= at_date (versioned rates —
    a past assignment keeps the rate that was in effect when it was priced)."""
    at_date = at_date or _now()[:10]
    candidates = [r for r in (partner.get("rate_card") or []) if r.get("activity") == activity and (r.get("effective_from") or "") <= at_date]
    if not candidates:
        return None
    return max(candidates, key=lambda r: r.get("effective_from") or "")


async def _partner_stats(db, partner_id: str) -> Dict[str, Any]:
    assignments = await db.partner_assignments.find({"partner_id": partner_id}).to_list(2000)
    payments = await db.partner_payments.find({"partner_id": partner_id}).to_list(2000)
    active_statuses = {"assigned", "in_progress", "payment_pending"}
    gross_earned = sum(a.get("gross_amount", 0) or 0 for a in assignments)
    retention_held_open = sum((a.get("retention_held", 0) or 0) for a in assignments if not a.get("retention_released"))
    total_paid = sum(p.get("amount", 0) or 0 for p in payments)
    return {
        "active_job_count": sum(1 for a in assignments if a.get("status") in active_statuses),
        "total_assignments": len(assignments),
        "lifetime_business": round(gross_earned, 2),
        "total_paid": round(total_paid, 2),
        "retention_held_open": round(retention_held_open, 2),
        "running_balance": round(gross_earned - total_paid - retention_held_open, 2),
    }


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    # ── Partner directory ──
    @router.get("/partners")
    async def list_partners(request: Request, partner_type: Optional[str] = None, speciality: Optional[str] = None,
                             district: Optional[str] = None, status: Optional[str] = None, search: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {"active": {"$ne": False}}
        if partner_type: q["partner_type"] = partner_type
        if speciality: q["specialities"] = speciality
        if district: q["service_districts"] = district
        if status: q["status"] = status
        if search: q["name"] = {"$regex": search, "$options": "i"}
        docs = await db.partners.find(q).sort("name", 1).to_list(2000)
        out = []
        for d in docs:
            stats = await _partner_stats(db, str(d["_id"]))
            row = _clean(d)
            row.update(stats)
            out.append(row)
        return out

    @router.post("/partners")
    async def create_partner(payload: PartnerCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        doc = payload.dict()
        if doc["partner_type"] == "internal_team":
            doc["company_name"] = ""; doc["gstin"] = ""; doc["pan"] = ""
        doc["rate_card"] = [r if isinstance(r, dict) else r.dict() for r in (doc.get("rate_card") or [])]
        doc["rating"] = 0
        doc["active"] = True
        doc["onboarded_date"] = doc.get("onboarded_date") or _now()[:10]
        doc["created_at"] = _now()
        result = await db.partners.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "create", "partner", str(result.inserted_id), None, {"name": doc["name"]})
        return _clean({**doc, "_id": result.inserted_id})

    @router.get("/partners/project-scope/{project_id}")
    async def project_scope_hint(project_id: str, request: Request):
        """Read-only helper — pulls quantities from the SAME project data the
        material kit/BOM already use, so assignment quantities aren't re-entered."""
        await get_current_user(request)
        try:
            project = await db.projects.find_one({"_id": ObjectId(project_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid project id")
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        ss = project.get("solar_system") or {}
        cf = project.get("custom_fields") or {}
        kw = ss.get("system_size_kw") or cf.get("proposed_solution", {}).get("system_size_kw") or 0
        pump = cf.get("pump_sizing") or {}
        return {
            "system_type": ss.get("system_type") or cf.get("proposed_solution", {}).get("system_type"),
            "system_size_kw": kw,
            "structure_sqft": cf.get("site_measurements", {}).get("roof_area_sqft"),
            "cable_length_m": cf.get("site_measurements", {}).get("cable_run_m"),
            "pump_hp": pump.get("pump_hp"),
        }

    @router.get("/partners/{partner_id}")
    async def get_partner(partner_id: str, request: Request):
        await get_current_user(request)
        try:
            doc = await db.partners.find_one({"_id": ObjectId(partner_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid partner id")
        if not doc:
            raise HTTPException(status_code=404, detail="Partner not found")
        assignments = await db.partner_assignments.find({"partner_id": partner_id}).sort("assigned_date", -1).to_list(2000)
        payments = await db.partner_payments.find({"partner_id": partner_id}).sort("date", -1).to_list(2000)
        project_ids = [a["project_id"] for a in assignments if a.get("project_id")]
        projects = {}
        if project_ids:
            oids = [ObjectId(p) for p in project_ids if ObjectId.is_valid(p)]
            async for p in db.projects.find({"_id": {"$in": oids}}):
                projects[str(p["_id"])] = p.get("customer", {}).get("name") or p.get("reference_number") or str(p["_id"])[-6:]
        assignment_rows = []
        for a in assignments:
            row = _clean(a)
            row["project_name"] = projects.get(a.get("project_id"), a.get("project_id"))
            assignment_rows.append(row)
        completed_with_dates = [a for a in assignments if a.get("actual_completion") and a.get("expected_completion")]
        on_time = [a for a in completed_with_dates if a["actual_completion"] <= a["expected_completion"]]
        rated = [a.get("quality_rating") for a in assignments if a.get("quality_rating")]
        scorecard = {
            "on_time_rate": round(len(on_time) / len(completed_with_dates) * 100, 1) if completed_with_dates else None,
            "avg_quality_rating": round(sum(rated) / len(rated), 2) if rated else None,
            "active_jobs": sum(1 for a in assignments if a.get("status") in ("assigned", "in_progress", "payment_pending")),
            "total_value_handled": round(sum(a.get("gross_amount", 0) or 0 for a in assignments), 2),
        }
        stats = await _partner_stats(db, partner_id)
        out = _clean(doc)
        out.update(stats)
        out["scorecard"] = scorecard
        out["assignments"] = assignment_rows
        out["payments"] = [_clean(p) for p in payments]
        out["rating_trend"] = [{"assignment_id": str(a["_id"]) if "_id" in a else a.get("id"), "date": a.get("actual_completion") or a.get("assigned_date"), "rating": a.get("quality_rating")} for a in assignments if a.get("quality_rating")]
        return out

    @router.put("/partners/{partner_id}")
    async def update_partner(partner_id: str, payload: PartnerUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            oid = ObjectId(partner_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid partner id")
        existing = await db.partners.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Partner not found")
        update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
        update["updated_at"] = _now()
        await db.partners.update_one({"_id": oid}, {"$set": update})
        await create_audit_log(user["id"], user["name"], "update", "partner", partner_id, _clean(existing), update)
        return _clean(await db.partners.find_one({"_id": oid}))

    @router.post("/partners/{partner_id}/rate-card")
    async def add_rate_card_entry(partner_id: str, entry: RateCardEntry, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            oid = ObjectId(partner_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid partner id")
        existing = await db.partners.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Partner not found")
        # Versioned — append, never overwrite, so past assignments keep their original rate
        await db.partners.update_one({"_id": oid}, {"$push": {"rate_card": entry.dict()}, "$set": {"updated_at": _now()}})
        await create_audit_log(user["id"], user["name"], "update", "partner_rate_card", partner_id, None, entry.dict())
        return _clean(await db.partners.find_one({"_id": oid}))

    @router.delete("/partners/{partner_id}")
    async def delist_partner(partner_id: str, request: Request):
        user = await require_role("admin")(request)
        try:
            oid = ObjectId(partner_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid partner id")
        existing = await db.partners.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Partner not found")
        await db.partners.update_one({"_id": oid}, {"$set": {"active": False, "status": "inactive"}})
        await create_audit_log(user["id"], user["name"], "delete", "partner", partner_id)
        return {"message": "Partner archived"}

    # ── Assignments ──
    @router.post("/partners/{partner_id}/assignments")
    async def create_assignment(partner_id: str, payload: AssignmentCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            partner = await db.partners.find_one({"_id": ObjectId(partner_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid partner id")
        if not partner:
            raise HTTPException(status_code=404, detail="Partner not found")
        try:
            project = await db.projects.find_one({"_id": ObjectId(payload.project_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid project id")
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        assigned_date = payload.assigned_date or _now()[:10]
        priced_activities = []
        for act in payload.activities:
            rc = _rate_for_activity(partner, act.activity, assigned_date)
            if not rc:
                raise HTTPException(status_code=400, detail=f"No rate-card entry found for activity '{act.activity}' effective on {assigned_date}")
            amount = round(act.quantity * rc["rate"], 2)
            priced_activities.append({"activity": act.activity, "quantity": act.quantity, "rate": rc["rate"], "unit": rc.get("unit"), "amount": amount})

        gross_amount = round(sum(a["amount"] for a in priced_activities), 2)
        retention_pct = partner.get("retention_pct", 10) or 0
        retention_held = round(gross_amount * retention_pct / 100, 2)

        doc = {
            "partner_id": partner_id, "project_id": payload.project_id,
            "assigned_date": assigned_date, "expected_completion": payload.expected_completion,
            "actual_completion": None,
            "activities": priced_activities, "gross_amount": gross_amount,
            "retention_held": retention_held, "retention_released": False, "retention_release_date": None,
            "advance_paid": 0, "balance_due": gross_amount,
            "status": "assigned", "quality_rating": None, "quality_notes": "",
            "delay_days": None, "delay_reason": "",
            "photos_before": [], "photos_after": [],
            "created_at": _now(),
        }
        result = await db.partner_assignments.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "create", "partner_assignment", str(result.inserted_id), None,
                                {"partner_id": partner_id, "project_id": payload.project_id, "gross_amount": gross_amount})
        return _clean({**doc, "_id": result.inserted_id})

    @router.get("/partners/assignments/by-project/{project_id}")
    async def list_assignments_for_project(project_id: str, request: Request):
        """Assignments for a single project, for the inline "Assign Partner" card on Project Details."""
        await get_current_user(request)
        assignments = await db.partner_assignments.find({"project_id": project_id}).sort("assigned_date", -1).to_list(500)
        partner_ids = list({a["partner_id"] for a in assignments if a.get("partner_id")})
        oids = [ObjectId(p) for p in partner_ids if ObjectId.is_valid(p)]
        partners = {str(p["_id"]): p["name"] for p in await db.partners.find({"_id": {"$in": oids}}).to_list(500)} if oids else {}
        out = []
        for a in assignments:
            row = _clean(a)
            row["partner_name"] = partners.get(a.get("partner_id"), a.get("partner_id"))
            out.append(row)
        return out

    @router.get("/partners/assignments/{assignment_id}")
    async def get_assignment(assignment_id: str, request: Request):
        await get_current_user(request)
        try:
            doc = await db.partner_assignments.find_one({"_id": ObjectId(assignment_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid assignment id")
        if not doc:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return _clean(doc)

    @router.put("/partners/assignments/{assignment_id}")
    async def update_assignment(assignment_id: str, payload: AssignmentUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            oid = ObjectId(assignment_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid assignment id")
        existing = await db.partner_assignments.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Assignment not found")
        update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
        if "actual_completion" in update and existing.get("expected_completion"):
            try:
                from datetime import date as _d
                exp = _d.fromisoformat(existing["expected_completion"][:10])
                act = _d.fromisoformat(update["actual_completion"][:10])
                update["delay_days"] = max((act - exp).days, 0)
            except Exception:
                pass
        update["updated_at"] = _now()
        await db.partner_assignments.update_one({"_id": oid}, {"$set": update})
        await create_audit_log(user["id"], user["name"], "update", "partner_assignment", assignment_id, _clean(existing), update)
        fresh = await db.partner_assignments.find_one({"_id": oid})
        # Rolling rating average on the partner record whenever a rating is (re)recorded
        if update.get("quality_rating") is not None:
            all_rated = await db.partner_assignments.find({"partner_id": existing["partner_id"], "quality_rating": {"$ne": None}}).to_list(2000)
            avg = round(sum(a["quality_rating"] for a in all_rated) / len(all_rated), 2) if all_rated else 0
            await db.partners.update_one({"_id": ObjectId(existing["partner_id"])}, {"$set": {"rating": avg}})
        return _clean(fresh)

    @router.post("/partners/assignments/{assignment_id}/release-retention")
    async def release_retention(assignment_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            oid = ObjectId(assignment_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid assignment id")
        assignment = await db.partner_assignments.find_one({"_id": oid})
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")
        if assignment.get("retention_released"):
            raise HTTPException(status_code=400, detail="Retention already released for this assignment")
        if not assignment.get("retention_held"):
            raise HTTPException(status_code=400, detail="No retention held on this assignment")
        sub = await db.subsidy_tracking.find_one({"project_id": assignment["project_id"]})
        if not sub or not sub.get("net_meter_installation_date"):
            raise HTTPException(
                status_code=400,
                detail="Retention can only be released after DISCOM commissioning (net meter installation date) is recorded for this project."
            )
        amount = assignment["retention_held"]
        now = _now()
        payment_doc = {
            "partner_id": assignment["partner_id"], "assignment_id": assignment_id,
            "date": now[:10], "amount": amount, "mode": "bank_transfer", "reference": "",
            "type": "retention_release", "notes": "Retention released post-DISCOM commissioning",
            "recorded_by": user["name"], "created_at": now,
        }
        await db.partner_payments.insert_one(payment_doc)
        await db.partner_assignments.update_one({"_id": oid}, {"$set": {
            "retention_released": True, "retention_release_date": now[:10],
            "balance_due": max(assignment.get("balance_due", 0) - amount, 0),
        }})
        await db.account_entries.insert_one({
            "entry_type": "partner_payment", "entry_date": now[:10], "amount": amount,
            "description": f"Retention release — partner assignment {assignment_id}",
            "entered_by_id": user["id"], "entered_by": user.get("name", ""), "created_at": now,
        })
        await create_audit_log(user["id"], user["name"], "update", "partner_retention_release", assignment_id, None, {"amount": amount})
        return _clean(await db.partner_assignments.find_one({"_id": oid}))

    # ── Payments ──
    @router.post("/partners/{partner_id}/payments")
    async def record_payment(partner_id: str, payload: PaymentCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        if payload.type == "retention_release":
            raise HTTPException(status_code=400, detail="Use POST /partners/assignments/{id}/release-retention for retention payments")
        try:
            assignment = await db.partner_assignments.find_one({"_id": ObjectId(payload.assignment_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid assignment id")
        if not assignment or assignment.get("partner_id") != partner_id:
            raise HTTPException(status_code=404, detail="Assignment not found for this partner")
        now = _now()
        doc = {
            "partner_id": partner_id, "assignment_id": payload.assignment_id,
            "date": payload.date or now[:10], "amount": payload.amount, "mode": payload.mode,
            "reference": payload.reference or "", "type": payload.type, "notes": payload.notes or "",
            "recorded_by": user["name"], "created_at": now,
        }
        result = await db.partner_payments.insert_one(doc)
        update: Dict[str, Any] = {"balance_due": max(assignment.get("balance_due", 0) - payload.amount, 0)}
        if payload.type == "advance":
            update["advance_paid"] = (assignment.get("advance_paid", 0) or 0) + payload.amount
        if update["balance_due"] <= 0 and assignment.get("status") not in ("closed",):
            update["status"] = "closed" if assignment.get("retention_released") or not assignment.get("retention_held") else "payment_pending"
        await db.partner_assignments.update_one({"_id": ObjectId(payload.assignment_id)}, {"$set": update})
        # Same ledger the Accounts module uses for other payables — not a parallel system.
        await db.account_entries.insert_one({
            "entry_type": "partner_payment", "entry_date": doc["date"], "amount": payload.amount,
            "description": f"{payload.type.title()} payment — partner assignment {payload.assignment_id}",
            "entered_by_id": user["id"], "entered_by": user.get("name", ""), "created_at": now,
        })
        await create_audit_log(user["id"], user["name"], "create", "partner_payment", str(result.inserted_id), None, doc)
        return _clean({**doc, "_id": result.inserted_id})

    @router.get("/partners/{partner_id}/payments")
    async def list_payments(partner_id: str, request: Request, assignment_id: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {"partner_id": partner_id}
        if assignment_id: q["assignment_id"] = assignment_id
        docs = await db.partner_payments.find(q).sort("date", -1).to_list(2000)
        return [_clean(d) for d in docs]

    @router.get("/partners/{partner_id}/scorecard")
    async def get_scorecard(partner_id: str, request: Request):
        await get_current_user(request)
        assignments = await db.partner_assignments.find({"partner_id": partner_id}).to_list(2000)
        completed_with_dates = [a for a in assignments if a.get("actual_completion") and a.get("expected_completion")]
        on_time = [a for a in completed_with_dates if a["actual_completion"] <= a["expected_completion"]]
        rated = [a.get("quality_rating") for a in assignments if a.get("quality_rating")]
        return {
            "on_time_rate": round(len(on_time) / len(completed_with_dates) * 100, 1) if completed_with_dates else None,
            "avg_quality_rating": round(sum(rated) / len(rated), 2) if rated else None,
            "active_jobs": sum(1 for a in assignments if a.get("status") in ("assigned", "in_progress", "payment_pending")),
            "total_value_handled": round(sum(a.get("gross_amount", 0) or 0 for a in assignments), 2),
        }

    return router
