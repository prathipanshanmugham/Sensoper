"""Customer Support (Iteration 47) — reactive support tickets that live inside the AMC module.

Distinct from proactive service visits: a ticket is opened when a customer reports a problem,
tracks SLA (response + resolution), enforces a status workflow, can link back to an
`amc_service_visits` record when a visit resolves it, captures CSAT on close, and feeds the
Employee Performance report through the assigned technician's satisfaction average.
"""
from __future__ import annotations
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from bson import ObjectId
from pydantic import BaseModel
from pymongo import ReturnDocument
from fastapi import APIRouter, HTTPException, Request


# ═══════════ Models ═══════════

DEFAULT_SLA_HOURS = {
    "critical": {"response": 2, "resolution": 12},
    "high": {"response": 4, "resolution": 24},
    "medium": {"response": 8, "resolution": 48},
    "low": {"response": 24, "resolution": 96},
}
VALID_STATUS_TRANSITIONS = {
    "open": {"assigned", "in_progress", "closed"},
    "assigned": {"in_progress", "pending_customer", "resolved", "closed"},
    "in_progress": {"pending_customer", "resolved", "closed"},
    "pending_customer": {"in_progress", "resolved", "closed"},
    "resolved": {"closed", "reopened"},
    "closed": {"reopened"},
    "reopened": {"assigned", "in_progress", "resolved", "closed"},
}


class TicketCreate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: str
    contact_phone: Optional[str] = ""
    contact_email: Optional[str] = ""
    project_id: Optional[str] = None
    amc_contract_id: Optional[str] = None
    system_type: Optional[str] = None
    system_capacity_kw: Optional[float] = 0
    district: Optional[str] = None
    location_id: Optional[str] = None
    category: str = "other"
    priority: str = "medium"
    description: str
    reported_via: str = "phone"


class TicketUpdate(BaseModel):
    priority: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    assigned_to_name: Optional[str] = None
    root_cause: Optional[str] = None
    resolution_notes: Optional[str] = None
    parts_used: Optional[List[Dict[str, Any]]] = None
    linked_service_visit_id: Optional[str] = None
    note: Optional[str] = None                # freeform timeline entry


class StatusTransition(BaseModel):
    status: str
    note: Optional[str] = ""


class CloseTicket(BaseModel):
    customer_satisfaction_rating: int
    resolution_notes: Optional[str] = ""


class SLAConfig(BaseModel):
    critical_response_hours: float
    critical_resolution_hours: float
    high_response_hours: float
    high_resolution_hours: float
    medium_response_hours: float
    medium_resolution_hours: float
    low_response_hours: float
    low_resolution_hours: float


# ═══════════ Helpers ═══════════

def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hours_between(iso_a: str, iso_b: str) -> float:
    try:
        a = datetime.fromisoformat(iso_a.replace("Z", "+00:00"))
        b = datetime.fromisoformat(iso_b.replace("Z", "+00:00"))
        return abs((b - a).total_seconds()) / 3600.0
    except Exception:
        return 0.0


async def _next_ticket_number(db) -> str:
    doc = await db.counters.find_one_and_update(
        {"_id": "support_ticket_number"}, {"$inc": {"seq": 1}}, upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"TKT-{doc['seq']:05d}"


async def _get_sla_config(db) -> Dict[str, Dict[str, float]]:
    cfg = await db.support_settings.find_one({"_id": "sla_config"})
    if not cfg:
        return DEFAULT_SLA_HOURS
    out = {}
    for p in ("critical", "high", "medium", "low"):
        out[p] = {
            "response": float(cfg.get(f"{p}_response_hours", DEFAULT_SLA_HOURS[p]["response"])),
            "resolution": float(cfg.get(f"{p}_resolution_hours", DEFAULT_SLA_HOURS[p]["resolution"])),
        }
    return out


def _breach_flags(ticket: Dict[str, Any], sla: Dict[str, Dict[str, float]]) -> Dict[str, Any]:
    """Compute the response/resolution breach + a bucket for triage colour-coding."""
    priority = ticket.get("priority", "medium")
    limits = sla.get(priority, DEFAULT_SLA_HOURS["medium"])
    now = _now()
    breached_response = False
    breached_resolution = False
    response_hours_left = None
    resolution_hours_left = None
    if ticket.get("first_response_at"):
        elapsed = _hours_between(ticket["created_at"], ticket["first_response_at"])
        breached_response = elapsed > limits["response"]
    else:
        elapsed = _hours_between(ticket["created_at"], now)
        breached_response = elapsed > limits["response"]
        response_hours_left = round(limits["response"] - elapsed, 1)
    if ticket.get("resolved_at"):
        elapsed = _hours_between(ticket["created_at"], ticket["resolved_at"])
        breached_resolution = elapsed > limits["resolution"]
    else:
        elapsed = _hours_between(ticket["created_at"], now)
        breached_resolution = elapsed > limits["resolution"]
        resolution_hours_left = round(limits["resolution"] - elapsed, 1)
    # Bucket: on-track / at-risk (<25% of budget left) / breached
    if breached_response or breached_resolution:
        bucket = "breached"
    elif resolution_hours_left is not None and resolution_hours_left < limits["resolution"] * 0.25:
        bucket = "at_risk"
    else:
        bucket = "on_track"
    return {
        "breached_response_sla": breached_response,
        "breached_resolution_sla": breached_resolution,
        "response_hours_left": response_hours_left,
        "resolution_hours_left": resolution_hours_left,
        "sla_response_hours": limits["response"],
        "sla_resolution_hours": limits["resolution"],
        "sla_bucket": bucket,
    }


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    # ── SLA config ──
    @router.get("/support/sla-config")
    async def get_sla_config(request: Request):
        await get_current_user(request)
        return await _get_sla_config(db)

    @router.put("/support/sla-config")
    async def update_sla_config(payload: SLAConfig, request: Request):
        user = await require_role("admin")(request)
        doc = payload.dict()
        doc["_id"] = "sla_config"
        doc["updated_at"] = _now()
        await db.support_settings.replace_one({"_id": "sla_config"}, doc, upsert=True)
        await create_audit_log(user["id"], user["name"], "update", "support_sla_config", "sla_config", None, doc)
        return await _get_sla_config(db)

    # ── Ticket list + dashboard ──
    @router.get("/support/tickets")
    async def list_tickets(request: Request, status: Optional[str] = None, priority: Optional[str] = None,
                            category: Optional[str] = None, district: Optional[str] = None,
                            assigned_to: Optional[str] = None, sla_bucket: Optional[str] = None,
                            date_from: Optional[str] = None, date_to: Optional[str] = None,
                            search: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {}
        if status: q["status"] = status
        if priority: q["priority"] = priority
        if category: q["category"] = category
        if district: q["district"] = district
        if assigned_to: q["assigned_to"] = assigned_to
        if date_from or date_to:
            q["created_at"] = {}
            if date_from: q["created_at"]["$gte"] = date_from
            if date_to: q["created_at"]["$lte"] = date_to + "T23:59:59"
        if search:
            q["$or"] = [
                {"ticket_number": {"$regex": search, "$options": "i"}},
                {"customer_name": {"$regex": search, "$options": "i"}},
                {"description": {"$regex": search, "$options": "i"}},
            ]
        docs = await db.support_tickets.find(q).sort("created_at", -1).to_list(5000)
        sla = await _get_sla_config(db)
        out = []
        for d in docs:
            row = _clean(d)
            row.update(_breach_flags(row, sla))
            if sla_bucket and row["sla_bucket"] != sla_bucket:
                continue
            out.append(row)
        return out

    @router.get("/support/dashboard")
    async def dashboard(request: Request):
        await get_current_user(request)
        docs = await db.support_tickets.find({}).to_list(10000)
        sla = await _get_sla_config(db)
        open_states = {"open", "assigned", "in_progress", "pending_customer", "reopened"}
        open_tickets = 0
        overdue = 0
        by_category: Dict[str, int] = {}
        by_priority: Dict[str, int] = {}
        by_district: Dict[str, int] = {}
        resolution_hours: List[float] = []
        csat_values: List[int] = []
        monthly_counts: Dict[str, int] = {}
        for d in docs:
            row = _clean(d)
            flags = _breach_flags(row, sla)
            row.update(flags)
            by_category[row.get("category", "other")] = by_category.get(row.get("category", "other"), 0) + 1
            by_priority[row.get("priority", "medium")] = by_priority.get(row.get("priority", "medium"), 0) + 1
            by_district[row.get("district") or "Unknown"] = by_district.get(row.get("district") or "Unknown", 0) + 1
            if row.get("status") in open_states:
                open_tickets += 1
                if flags["sla_bucket"] == "breached":
                    overdue += 1
            if row.get("resolved_at") and row.get("created_at"):
                resolution_hours.append(_hours_between(row["created_at"], row["resolved_at"]))
            if row.get("customer_satisfaction_rating"):
                csat_values.append(int(row["customer_satisfaction_rating"]))
            month = (row.get("created_at") or "")[:7]
            if month:
                monthly_counts[month] = monthly_counts.get(month, 0) + 1
        return {
            "open_tickets": open_tickets, "overdue_by_sla": overdue,
            "avg_resolution_hours": round(sum(resolution_hours) / len(resolution_hours), 1) if resolution_hours else 0,
            "avg_csat": round(sum(csat_values) / len(csat_values), 2) if csat_values else 0,
            "csat_count": len(csat_values),
            "by_category": by_category, "by_priority": by_priority, "by_district": by_district,
            "monthly_counts": [{"month": m, "count": monthly_counts[m]} for m in sorted(monthly_counts.keys())],
            "top_recurring": sorted(by_category.items(), key=lambda kv: kv[1], reverse=True)[:5],
        }

    # ── Ticket CRUD ──
    @router.post("/support/tickets")
    async def create_ticket(payload: TicketCreate, request: Request):
        user = await require_role("admin", "manager", "staff")(request)
        # Pre-fill from project or AMC contract if provided
        pre: Dict[str, Any] = {}
        if payload.project_id:
            try:
                p = await db.projects.find_one({"_id": ObjectId(payload.project_id)})
                if p:
                    ss = (p.get("custom_fields") or {}).get("proposed_solution") or p.get("solar_system") or {}
                    pre["system_type"] = pre.get("system_type") or ss.get("system_type")
                    pre["system_capacity_kw"] = pre.get("system_capacity_kw") or ss.get("system_size_kw") or 0
                    if isinstance(p.get("location"), dict):
                        pre["district"] = pre.get("district") or p["location"].get("district")
            except Exception:
                pass
        if payload.amc_contract_id:
            try:
                c = await db.amc_contracts.find_one({"_id": ObjectId(payload.amc_contract_id)})
                if c:
                    pre["system_type"] = pre.get("system_type") or c.get("system_type")
                    pre["system_capacity_kw"] = pre.get("system_capacity_kw") or c.get("system_capacity_kw", 0)
                    pre["district"] = pre.get("district") or c.get("district")
            except Exception:
                pass
        sla = await _get_sla_config(db)
        limits = sla.get(payload.priority, DEFAULT_SLA_HOURS["medium"])
        now = _now()
        doc = payload.dict()
        for k, v in pre.items():
            if not doc.get(k):
                doc[k] = v
        doc["ticket_number"] = await _next_ticket_number(db)
        doc["status"] = "open"
        doc["assigned_to"] = None
        doc["assigned_to_name"] = None
        doc["assigned_date"] = None
        doc["sla_response_hours"] = limits["response"]
        doc["sla_resolution_hours"] = limits["resolution"]
        doc["first_response_at"] = None
        doc["resolved_at"] = None
        doc["breached_response_sla"] = False
        doc["breached_resolution_sla"] = False
        doc["resolution_notes"] = ""
        doc["root_cause"] = None
        doc["parts_used"] = []
        doc["linked_service_visit_id"] = None
        doc["customer_satisfaction_rating"] = None
        doc["reopen_count"] = 0
        doc["timeline"] = [{"timestamp": now, "actor": user.get("name"), "action": "created",
                             "note": "Ticket opened"}]
        doc["attachments"] = []
        doc["created_at"] = now
        doc["updated_at"] = now
        res = await db.support_tickets.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "create", "support_ticket", str(res.inserted_id), None,
                                {"customer": doc["customer_name"], "category": doc["category"]})
        row = _clean({**doc, "_id": res.inserted_id})
        row.update(_breach_flags(row, sla))
        return row

    @router.get("/support/tickets/{ticket_id}")
    async def get_ticket(ticket_id: str, request: Request):
        await get_current_user(request)
        try:
            oid = ObjectId(ticket_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid ticket id")
        doc = await db.support_tickets.find_one({"_id": oid})
        if not doc:
            raise HTTPException(status_code=404, detail="Ticket not found")
        sla = await _get_sla_config(db)
        row = _clean(doc)
        row.update(_breach_flags(row, sla))
        return row

    @router.put("/support/tickets/{ticket_id}")
    async def update_ticket(ticket_id: str, payload: TicketUpdate, request: Request):
        user = await require_role("admin", "manager", "staff")(request)
        try:
            oid = ObjectId(ticket_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid ticket id")
        existing = await db.support_tickets.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Ticket not found")
        update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
        note = update.pop("note", None)
        now = _now()
        # first_response_at auto-stamps only when the ticket first gets an assignment — plain
        # metadata edits (description, category) don't count as a real first response.
        if not existing.get("first_response_at") and update.get("assigned_to") and not existing.get("assigned_to"):
            update["first_response_at"] = now
        if "assigned_to" in update and update["assigned_to"] and not existing.get("assigned_date"):
            update["assigned_date"] = now
        if update.get("priority") and update["priority"] != existing.get("priority"):
            sla = await _get_sla_config(db)
            limits = sla.get(update["priority"], DEFAULT_SLA_HOURS["medium"])
            update["sla_response_hours"] = limits["response"]
            update["sla_resolution_hours"] = limits["resolution"]
        update["updated_at"] = now
        timeline_entry = {"timestamp": now, "actor": user.get("name"), "action": "updated",
                           "note": note or "Ticket updated"}
        await db.support_tickets.update_one({"_id": oid}, {"$set": update, "$push": {"timeline": timeline_entry}})
        await create_audit_log(user["id"], user["name"], "update", "support_ticket", ticket_id, _clean(existing), update)
        fresh = await db.support_tickets.find_one({"_id": oid})
        sla = await _get_sla_config(db)
        row = _clean(fresh)
        row.update(_breach_flags(row, sla))
        return row

    @router.post("/support/tickets/{ticket_id}/status")
    async def transition_status(ticket_id: str, payload: StatusTransition, request: Request):
        user = await require_role("admin", "manager", "staff")(request)
        try:
            oid = ObjectId(ticket_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid ticket id")
        existing = await db.support_tickets.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Ticket not found")
        cur = existing.get("status", "open")
        target = payload.status
        allowed = VALID_STATUS_TRANSITIONS.get(cur, set())
        if target not in allowed:
            raise HTTPException(status_code=400, detail=f"Cannot move ticket from '{cur}' to '{target}'. Allowed: {sorted(allowed)}")
        now = _now()
        upd: Dict[str, Any] = {"status": target, "updated_at": now}
        if target == "resolved":
            upd["resolved_at"] = now
        if target == "reopened":
            upd["resolved_at"] = None
            upd["reopen_count"] = (existing.get("reopen_count", 0) or 0) + 1
        if not existing.get("first_response_at") and target != "closed":
            upd["first_response_at"] = now
        entry = {"timestamp": now, "actor": user.get("name"), "action": f"status:{target}",
                  "note": payload.note or ""}
        await db.support_tickets.update_one({"_id": oid}, {"$set": upd, "$push": {"timeline": entry}})
        await create_audit_log(user["id"], user["name"], "update", "support_ticket_status", ticket_id,
                                {"status": cur}, {"status": target})
        fresh = await db.support_tickets.find_one({"_id": oid})
        sla = await _get_sla_config(db)
        row = _clean(fresh)
        row.update(_breach_flags(row, sla))
        return row

    @router.post("/support/tickets/{ticket_id}/close")
    async def close_ticket(ticket_id: str, payload: CloseTicket, request: Request):
        """Close a ticket + capture CSAT. This is what feeds the technician's satisfaction average
        on the Employee Performance report."""
        user = await require_role("admin", "manager", "staff")(request)
        if payload.customer_satisfaction_rating < 1 or payload.customer_satisfaction_rating > 5:
            raise HTTPException(status_code=400, detail="CSAT rating must be between 1 and 5")
        try:
            oid = ObjectId(ticket_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid ticket id")
        existing = await db.support_tickets.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Ticket not found")
        if existing.get("status") == "closed":
            raise HTTPException(status_code=400, detail="Ticket is already closed")
        now = _now()
        upd = {
            "status": "closed", "customer_satisfaction_rating": payload.customer_satisfaction_rating,
            "resolution_notes": payload.resolution_notes or existing.get("resolution_notes", ""),
            "resolved_at": existing.get("resolved_at") or now,
            "closed_at": now, "updated_at": now,
        }
        entry = {"timestamp": now, "actor": user.get("name"), "action": "closed",
                  "note": f"CSAT: {payload.customer_satisfaction_rating}/5"}
        await db.support_tickets.update_one({"_id": oid}, {"$set": upd, "$push": {"timeline": entry}})
        await create_audit_log(user["id"], user["name"], "update", "support_ticket_close", ticket_id, None,
                                {"csat": payload.customer_satisfaction_rating})
        fresh = await db.support_tickets.find_one({"_id": oid})
        sla = await _get_sla_config(db)
        row = _clean(fresh)
        row.update(_breach_flags(row, sla))
        return row

    return router
