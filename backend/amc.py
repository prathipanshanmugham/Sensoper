"""AMC (Annual Maintenance Contracts) module — recurring-revenue contracts,
service visit scheduling and the Recurring Revenue Report (Iter 42 Change 5)."""
from __future__ import annotations
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from bson import ObjectId
from pymongo import ReturnDocument
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from locations import location_scope_filter
from amc_jv import is_partner, mask_for_partner, scope_for, org_query, merge_settings, quote_plans, OURS, ALL

BILLING_MONTHS = {"monthly": 1, "quarterly": 3, "half-yearly": 6, "annual": 12}


async def _next_sequence(db, key: str) -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return doc["seq"]


class AMCContractCreate(BaseModel):
    project_id: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: str
    contact: Optional[str] = None
    site_address: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    location_id: Optional[str] = None
    org_id: Optional[str] = None      # joint-venture partner company (None = Sensoper)
    jv_project_id: Optional[str] = None
    system_type: str  # on-grid | off-grid | hybrid | solar-pump | others
    system_type_other: Optional[str] = None   # what it is when the type is "others"
    system_capacity_kw: float = 0
    pump_hp: Optional[float] = None
    commissioning_date: Optional[str] = None
    contract_type: str = "comprehensive"  # comprehensive | non-comprehensive | labour-only
    start_date: str
    duration_months: int = 12
    annual_value: float = 0
    billing_frequency: str = "annual"  # monthly | quarterly | half-yearly | annual
    auto_renew: bool = False
    renewal_notice_days: int = 30
    visits_per_year: int = 2
    inclusions: List[str] = []
    exclusions: List[str] = []
    response_time_hours: Optional[float] = None
    uptime_guarantee_pct: Optional[float] = None
    notes: Optional[str] = None


SYSTEM_TYPES = {"on-grid", "off-grid", "hybrid", "solar-pump", "others"}


def _end_date(start_date: str, duration_months: int) -> str:
    d = datetime.fromisoformat(start_date)
    month = d.month - 1 + duration_months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, 28)
    return d.replace(year=year, month=month, day=day).date().isoformat()


def _next_billing(start_date: str, billing_frequency: str) -> str:
    months = BILLING_MONTHS.get(billing_frequency, 12)
    return _end_date(start_date, months)


def _serialize(c: Dict[str, Any]) -> Dict[str, Any]:
    c = dict(c)
    c["id"] = str(c.pop("_id"))
    return c


def create_router(db, get_current_user, require_role, create_audit_log, check_module_permission=None):
    router = APIRouter()

    async def _partner_names() -> Dict[str, str]:
        return {str(p["_id"]): p.get("name") async for p in db.jv_partners.find({}, {"name": 1})}

    def _out(c: Dict[str, Any], user: Dict[str, Any], names: Dict[str, str]) -> Dict[str, Any]:
        r = mask_for_partner(_serialize(c), user)
        r["org_name"] = names.get(c.get("org_id")) if c.get("org_id") else None
        return r

    async def _editable(contract_id: str, user: Dict[str, Any], request: Request) -> Dict[str, Any]:
        """Load a contract someone wants to change: partners only their own company's, our people (admin/manager) any."""
        c = await db.amc_contracts.find_one({"_id": ObjectId(contract_id)}) if ObjectId.is_valid(contract_id) else None
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        if is_partner(user):
            if c.get("org_id") != user.get("partner_id"):
                raise HTTPException(status_code=403, detail="This contract belongs to Sensoper — you can view it but not change it")
        else:
            await require_role("admin", "manager")(request)
        return c

    @router.get("/amc/contracts")
    async def list_contracts(request: Request, status: Optional[str] = None, system_type: Optional[str] = None,
                              district: Optional[str] = None, search: Optional[str] = None, location_id: Optional[str] = None,
                              org: Optional[str] = None):
        """Every company's contracts by default (the JV shares AMC); `org` narrows to ours / one partner.
        Partners see our contracts without prices or money."""
        user = await get_current_user(request)
        loc_filter = location_scope_filter(user, location_id) if not is_partner(user) else {}
        query: Dict[str, Any] = dict(loc_filter)
        if org and org != ALL:
            query.update(org_query(org))
        if status: query["status"] = status
        if system_type: query["system_type"] = system_type
        if district: query["district"] = district
        if search: query["customer_name"] = {"$regex": re.escape(search), "$options": "i"}
        docs = await db.amc_contracts.find(query).sort("created_at", -1).to_list(2000)
        names = await _partner_names()
        return [_out(d, user, names) for d in docs]

    @router.post("/amc/contracts")
    async def create_contract(payload: AMCContractCreate, request: Request):
        user = await get_current_user(request)
        if is_partner(user):
            payload.org_id = user.get("partner_id")       # a partner's contracts are always its own
            payload.location_id = None
            if not payload.org_id:
                raise HTTPException(status_code=403, detail="This login isn't linked to a partner company")
        else:
            user = await require_role("admin", "manager")(request)
        if payload.org_id and not (ObjectId.is_valid(payload.org_id) and await db.jv_partners.find_one({"_id": ObjectId(payload.org_id)}, {"_id": 1})):
            raise HTTPException(status_code=400, detail="Partner company not found")
        if payload.jv_project_id:
            j = await db.jv_projects.find_one({"_id": ObjectId(payload.jv_project_id)}) if ObjectId.is_valid(payload.jv_project_id) else None
            if not j or j.get("org_id") != payload.org_id:
                raise HTTPException(status_code=400, detail="That project belongs to another company")
        if is_partner(user):
            payload.project_id = None                     # partners can't attach contracts to our projects
        if payload.system_type not in SYSTEM_TYPES:
            raise HTTPException(status_code=400, detail="Unknown system type")
        if payload.system_type == "others" and not (payload.system_type_other or "").strip():
            raise HTTPException(status_code=400, detail="Say what the system is (for example UPS or street lights)")
        now_iso = datetime.now(timezone.utc).isoformat()
        doc = payload.dict()
        seq = await _next_sequence(db, "amc_contract_number")
        end_date = _end_date(doc["start_date"], doc["duration_months"])
        doc.update({
            "contract_number": f"AMC-{seq:04d}", "end_date": end_date,
            "next_billing_date": _next_billing(doc["start_date"], doc["billing_frequency"]),
            "visits_completed": 0, "visits_remaining": doc["visits_per_year"],
            "service_schedule": [], "status": "active",
            "total_billed": 0, "total_collected": 0, "outstanding": 0,
            "renewal_status": None, "previous_contract_id": None,
            "created_at": now_iso, "updated_at": now_iso,
        })
        res = await db.amc_contracts.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "amc_contract_created", "amc_contract", str(res.inserted_id), None, {"customer": doc["customer_name"], "org_id": doc.get("org_id")})
        return _out({**doc, "_id": res.inserted_id}, user, await _partner_names())

    @router.post("/amc/contracts/from-project/{project_id}")
    async def create_from_project(project_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        project = await db.projects.find_one({"_id": ObjectId(project_id)})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        customer = project.get("customer", {}) or {}
        ps = (project.get("custom_fields", {}) or {}).get("proposed_solution", {}) or {}
        now_iso = datetime.now(timezone.utc).isoformat()
        start_date = now_iso[:10]
        duration_months = 12
        seq = await _next_sequence(db, "amc_contract_number")
        # priced like the Standard plan in AMC settings, so a quick contract and a quote agree
        kw = float(ps.get("system_size_kw") or 0)
        plan = next(p for p in quote_plans(kw, merge_settings(await db.amc_settings.find_one({"key": "defaults"})), ps.get("tariff_per_unit"))["plans"] if p["key"] == "standard")
        doc = {
            "project_id": project_id, "customer_id": customer.get("id"), "customer_name": customer.get("name", "Customer"),
            "contact": customer.get("phone"), "site_address": customer.get("address"),
            "district": project.get("location", {}).get("district") if isinstance(project.get("location"), dict) else project.get("district"),
            "state": project.get("location", {}).get("state") if isinstance(project.get("location"), dict) else project.get("state"),
            "location_id": project.get("location_id"), "org_id": None, "system_type": ps.get("system_type", "on-grid"),
            "system_capacity_kw": float(ps.get("system_size_kw") or 0), "pump_hp": ps.get("pump_hp"),
            "commissioning_date": project.get("completed_at", now_iso)[:10],
            "contract_type": "comprehensive", "start_date": start_date, "end_date": _end_date(start_date, duration_months),
            "duration_months": duration_months, "annual_value": plan["price"], "plan_key": plan["key"], "plan_name": plan["name"],
            "billing_frequency": "annual", "next_billing_date": _next_billing(start_date, "annual"),
            "auto_renew": False, "renewal_notice_days": 30, "visits_per_year": plan["visits_per_year"], "visits_completed": 0, "visits_remaining": plan["visits_per_year"],
            "service_schedule": [], "inclusions": plan["includes"], "exclusions": [],
            "response_time_hours": plan["response_hours"], "uptime_guarantee_pct": 95, "contract_number": f"AMC-{seq:04d}",
            "status": "active", "total_billed": 0, "total_collected": 0, "outstanding": 0,
            "renewal_status": None, "previous_contract_id": None, "created_at": now_iso, "updated_at": now_iso,
        }
        if await db.amc_contracts.find_one({"project_id": project_id, "status": "active"}):
            raise HTTPException(status_code=400, detail="This project already has an active AMC contract")
        res = await db.amc_contracts.insert_one(doc)
        await db.notifications.update_many({"kind": "amc_offer", "source_type": "project", "source_id": project_id, "status": "pending"},
                                           {"$set": {"status": "resolved", "resolved_at": now_iso}})
        await create_audit_log(user["id"], user["name"], "amc_contract_created_from_project", "amc_contract", str(res.inserted_id), None, {"project_id": project_id})
        return _serialize({**doc, "_id": res.inserted_id})

    @router.get("/amc/contracts/{contract_id}")
    async def get_contract(contract_id: str, request: Request):
        user = await get_current_user(request)
        c = await db.amc_contracts.find_one({"_id": ObjectId(contract_id)}) if ObjectId.is_valid(contract_id) else None
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        visits = await db.amc_service_visits.find({"contract_id": contract_id}).sort("scheduled_date", -1).to_list(200)
        result = _out(c, user, await _partner_names())
        hide = is_partner(user) and c.get("org_id") != user.get("partner_id")
        result["visit_history"] = [{**{k: v for k, v in vi.items() if k != "_id" and not (hide and k == "cost_incurred")}, "id": str(vi["_id"])} for vi in visits]
        return result

    @router.put("/amc/contracts/{contract_id}")
    async def update_contract(contract_id: str, payload: Dict[str, Any], request: Request):
        user = await get_current_user(request)
        await _editable(contract_id, user, request)
        payload.pop("_id", None); payload.pop("id", None)
        for k in ("contract_number", "created_at", "previous_contract_id", "quote_id"):
            payload.pop(k, None)
        if is_partner(user) or user.get("role") != "admin":
            payload.pop("org_id", None)                   # only an admin moves a contract between companies
        if is_partner(user):
            payload.pop("project_id", None); payload.pop("location_id", None)
        if "system_type" in payload and payload["system_type"] not in SYSTEM_TYPES:
            raise HTTPException(status_code=400, detail="Unknown system type")
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        r = await db.amc_contracts.update_one({"_id": ObjectId(contract_id)}, {"$set": payload})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Contract not found")
        await create_audit_log(user["id"], user["name"], "amc_contract_updated", "amc_contract", contract_id)
        return {"message": "Contract updated"}

    @router.post("/amc/contracts/{contract_id}/renew")
    async def renew_contract(contract_id: str, request: Request):
        user = await get_current_user(request)
        c = await _editable(contract_id, user, request)
        now_iso = datetime.now(timezone.utc).isoformat()
        start_date = c.get("end_date") or now_iso[:10]
        duration = c.get("duration_months", 12)
        seq = await _next_sequence(db, "amc_contract_number")
        new_doc = {**c}
        new_doc.pop("_id", None)
        new_doc.update({
            "contract_number": f"AMC-{seq:04d}", "start_date": start_date, "end_date": _end_date(start_date, duration),
            "next_billing_date": _next_billing(start_date, c.get("billing_frequency", "annual")),
            "visits_completed": 0, "visits_remaining": c.get("visits_per_year", 2), "service_schedule": [],
            "status": "active", "total_billed": 0, "total_collected": 0, "outstanding": 0,
            "renewal_status": None, "previous_contract_id": contract_id,
            "created_at": now_iso, "updated_at": now_iso,
        })
        res = await db.amc_contracts.insert_one(new_doc)
        await db.amc_contracts.update_one({"_id": ObjectId(contract_id)}, {"$set": {"status": "renewed", "renewal_status": "renewed"}})
        await create_audit_log(user["id"], user["name"], "amc_contract_renewed", "amc_contract", contract_id, None, {"new_contract_id": str(res.inserted_id)})
        return _out({**new_doc, "_id": res.inserted_id}, user, await _partner_names())

    @router.post("/amc/contracts/bulk-renew")
    async def bulk_renew(payload: Dict[str, Any], request: Request):
        user = await require_role("admin", "manager")(request)
        ids = payload.get("contract_ids", [])
        renewed = []
        for cid in ids:
            try:
                res = await renew_contract(cid, request)
                renewed.append(res["id"])
            except Exception:
                continue
        return {"renewed": renewed, "count": len(renewed)}

    @router.post("/amc/contracts/{contract_id}/cancel")
    async def cancel_contract(contract_id: str, payload: Dict[str, Any], request: Request):
        user = await get_current_user(request)
        await _editable(contract_id, user, request)
        await db.amc_contracts.update_one({"_id": ObjectId(contract_id)}, {"$set": {
            "status": "cancelled", "renewal_status": "churned", "churn_reason": payload.get("reason", ""),
            "cancelled_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
        }})
        await create_audit_log(user["id"], user["name"], "amc_contract_cancelled", "amc_contract", contract_id)
        return {"message": "Contract cancelled"}

    @router.delete("/amc/contracts/{contract_id}")
    async def delete_contract(contract_id: str, request: Request, confirm: Optional[str] = None):
        """Remove a CANCELLED contract for good — Sensoper admins only (never managers or partner logins).
        `confirm` must be the contract number. Its visits and reminders go too; the audit log keeps a copy."""
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only a Sensoper admin can delete a contract for good")
        c = await db.amc_contracts.find_one({"_id": ObjectId(contract_id)}) if ObjectId.is_valid(contract_id) else None
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        if c.get("status") != "cancelled":
            raise HTTPException(status_code=400, detail="Only cancelled contracts can be deleted — cancel it first")
        if (confirm or "").strip().upper() != str(c.get("contract_number") or "").upper():
            raise HTTPException(status_code=400, detail=f"Type the contract number ({c.get('contract_number')}) to confirm")
        visits = await db.amc_service_visits.delete_many({"contract_id": contract_id})
        await db.notifications.delete_many({"contract_id": contract_id})
        await db.amc_contracts.update_many({"previous_contract_id": contract_id}, {"$set": {"previous_contract_id": None}})
        await db.amc_quotes.update_many({"contract_id": contract_id}, {"$set": {"contract_deleted": True}})
        await db.amc_contracts.delete_one({"_id": c["_id"]})
        await create_audit_log(user["id"], user["name"], "amc_contract_deleted", "amc_contract", contract_id, _serialize(c), None,
                               f"Hard-deleted cancelled contract {c.get('contract_number')} ({visits.deleted_count} visits)")
        return {"ok": True, "deleted": c.get("contract_number"), "visits_deleted": visits.deleted_count}

    # ── Service visits ──
    @router.post("/amc/contracts/{contract_id}/visits")
    async def schedule_visit(contract_id: str, payload: Dict[str, Any], request: Request):
        user = await get_current_user(request)
        if user["role"] != "admin" and check_module_permission and not await check_module_permission(user, "module_amc", "create"):
            raise HTTPException(status_code=403, detail="Permission denied: module_amc.create")
        c = await db.amc_contracts.find_one({"_id": ObjectId(contract_id)}) if ObjectId.is_valid(contract_id) else None
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        now_iso = datetime.now(timezone.utc).isoformat()
        visit_no = await db.amc_service_visits.count_documents({"contract_id": contract_id}) + 1
        doc = {
            "contract_id": contract_id, "visit_number": visit_no,
            "scheduled_date": payload.get("scheduled_date"), "actual_date": None,
            "visit_type": payload.get("visit_type", "preventive"), "technician_id": payload.get("technician_id"),
            "technician_name": payload.get("technician_name"), "checklist": payload.get("checklist", []),
            "generation_reading": None, "issues_found": None, "parts_replaced": [],
            "customer_signature": None, "photos": [], "report_pdf_url": None,
            "duration_hours": None, "travel_km": None, "cost_incurred": 0,
            "customer_rating": None, "status": "scheduled", "created_at": now_iso,
        }
        res = await db.amc_service_visits.insert_one(doc)
        doc.pop("_id", None)
        return {**doc, "id": str(res.inserted_id)}

    @router.put("/amc/visits/{visit_id}/complete")
    async def complete_visit(visit_id: str, payload: Dict[str, Any], request: Request):
        user = await get_current_user(request)
        v = await db.amc_service_visits.find_one({"_id": ObjectId(visit_id)}) if ObjectId.is_valid(visit_id) else None
        if not v:
            raise HTTPException(status_code=404, detail="Visit not found")
        if v.get("status") == "completed":
            raise HTTPException(status_code=400, detail="This visit is already marked done")
        now_iso = datetime.now(timezone.utc).isoformat()
        allowed = {"actual_date", "generation_reading", "issues_found", "parts_replaced", "customer_signature", "photos", "duration_hours",
                   "travel_km", "cost_incurred", "customer_rating", "checklist", "notes", "technician_name"}
        payload = {k: val for k, val in payload.items() if k in allowed}
        payload["completed_by"] = user["name"]
        payload["status"] = "completed"
        payload["actual_date"] = payload.get("actual_date", now_iso[:10])
        await db.amc_service_visits.update_one({"_id": ObjectId(visit_id)}, {"$set": payload})
        c = await db.amc_contracts.find_one({"_id": ObjectId(v["contract_id"])})
        if c:
            completed = c.get("visits_completed", 0) + 1
            await db.amc_contracts.update_one({"_id": c["_id"]}, {"$set": {
                "visits_completed": completed, "visits_remaining": max(0, c.get("visits_per_year", 2) - completed),
            }})
        return {"message": "Visit marked complete"}

    @router.get("/amc/visits")
    async def list_visits(request: Request, status: Optional[str] = None, contract_id: Optional[str] = None):
        user = await get_current_user(request)
        query: Dict[str, Any] = {}
        if status: query["status"] = status
        if contract_id: query["contract_id"] = contract_id
        docs = await db.amc_service_visits.find(query).sort("scheduled_date", 1).to_list(2000)
        own: set = set()
        if is_partner(user):
            own = {str(c["_id"]) async for c in db.amc_contracts.find({"org_id": user.get("partner_id")}, {"_id": 1})}
        return [{**{k: v for k, v in d.items() if k != "_id" and not (is_partner(user) and k == "cost_incurred" and d.get("contract_id") not in own)},
                 "id": str(d["_id"])} for d in docs]

    # ── Dashboard ──
    @router.get("/amc/dashboard")
    async def amc_dashboard(request: Request, location_id: Optional[str] = None, org: Optional[str] = None):
        """Numbers for one company: ours by default (partner work never counts towards ours), a partner, or all."""
        user = await get_current_user(request)
        loc_filter = location_scope_filter(user, location_id) if not is_partner(user) else {}
        scope = scope_for(user, org)
        contracts = await db.amc_contracts.find({**loc_filter, **scope}).to_list(5000)
        active = [c for c in contracts if c.get("status") == "active"]
        capacity_by_type: Dict[str, float] = {}
        count_by_type: Dict[str, int] = {}
        pump_hp_total = 0.0
        for c in active:
            st = c.get("system_type") or "others"
            count_by_type[st] = count_by_type.get(st, 0) + 1
            capacity_by_type[st] = capacity_by_type.get(st, 0) + (c.get("system_capacity_kw", 0) or 0)
            if st == "solar-pump":
                pump_hp_total += c.get("pump_hp", 0) or 0

        def _monthly_value(c):
            return (c.get("annual_value", 0) or 0) / 12

        mrr = sum(_monthly_value(c) for c in active)
        arr = mrr * 12
        today = datetime.now(timezone.utc).date()

        def _days_to_expiry(c):
            try:
                return (datetime.fromisoformat(c["end_date"]).date() - today).days
            except Exception:
                return 9999

        expiring_30 = sum(1 for c in active if 0 <= _days_to_expiry(c) <= 30)
        expiring_60 = sum(1 for c in active if 0 <= _days_to_expiry(c) <= 60)
        expiring_90 = sum(1 for c in active if 0 <= _days_to_expiry(c) <= 90)
        renewed = sum(1 for c in contracts if c.get("status") == "renewed")
        expired_or_renewed = sum(1 for c in contracts if c.get("status") in ("renewed", "expired", "cancelled"))
        renewal_rate = round((renewed / expired_or_renewed) * 100, 1) if expired_or_renewed else 0
        total_billed = sum(c.get("total_billed", 0) or 0 for c in contracts)
        total_collected = sum(c.get("total_collected", 0) or 0 for c in contracts)
        outstanding = sum(c.get("outstanding", 0) or 0 for c in contracts)
        visits_due = sum(c.get("visits_remaining", 0) or 0 for c in active)
        overdue_visits = await db.amc_service_visits.count_documents({
            "status": "scheduled", "scheduled_date": {"$lt": today.isoformat()}, "contract_id": {"$in": [str(c["_id"]) for c in contracts]},
        })

        # penetration = share of finished plants (ours: completed projects; a partner: its own projects) under an active AMC
        if is_partner(user) or (org and org not in (OURS, ALL)):
            commissioned_projects = await db.jv_projects.count_documents({"deleted_at": {"$exists": False}, **scope})
            covered = sum(1 for c in active if c.get("jv_project_id"))
        elif org == ALL:
            commissioned_projects = await db.projects.count_documents({"status": "completed", "deleted_at": {"$exists": False}, **loc_filter}) + \
                await db.jv_projects.count_documents({"deleted_at": {"$exists": False}})
            covered = sum(1 for c in active if c.get("project_id") or c.get("jv_project_id"))
        else:
            commissioned_projects = await db.projects.count_documents({"status": "completed", "deleted_at": {"$exists": False}, **loc_filter})
            covered = sum(1 for c in active if c.get("project_id"))
        penetration_pct = round((covered / commissioned_projects) * 100, 1) if commissioned_projects else 0

        # ── more numbers: size, growth, service, sales ──
        ids = [str(c["_id"]) for c in contracts]
        total_kw = sum(c.get("system_capacity_kw", 0) or 0 for c in active)
        month0, year0 = today.replace(day=1).isoformat(), today.replace(month=1, day=1).isoformat()
        firsts = [c for c in contracts if not c.get("previous_contract_id")]
        visits = await db.amc_service_visits.find({"contract_id": {"$in": ids}}, {"status": 1, "actual_date": 1, "scheduled_date": 1}).to_list(20000)
        done = [v for v in visits if v.get("status") == "completed"]
        soon30 = (today + timedelta(days=30)).isoformat()
        plan_mix: Dict[str, int] = {}
        for c in active:
            k = c.get("plan_name") or (c.get("contract_type") or "other").replace("-", " ").capitalize()
            plan_mix[k] = plan_mix.get(k, 0) + 1
        by_district: Dict[str, Dict[str, float]] = {}
        for c in active:
            d = c.get("district") or "Not set"
            row = by_district.setdefault(d, {"district": d, "contracts": 0, "kw": 0.0})
            row["contracts"] += 1
            row["kw"] += c.get("system_capacity_kw", 0) or 0
        months = []
        y, m = today.year, today.month
        for _ in range(12):
            months.append(f"{y:04d}-{m:02d}")
            y, m = (y - 1, 12) if m == 1 else (y, m - 1)
        months.reverse()
        monthly = {k: {"month": k, "new": 0, "renewals": 0, "value": 0.0, "visits": 0} for k in months}
        for c in contracts:
            k = str(c.get("start_date") or "")[:7]
            if k in monthly:
                monthly[k]["renewals" if c.get("previous_contract_id") else "new"] += 1
                monthly[k]["value"] += c.get("annual_value", 0) or 0
        for v in done:
            k = str(v.get("actual_date") or "")[:7]
            if k in monthly:
                monthly[k]["visits"] += 1
        year_ago = (today - timedelta(days=365)).isoformat()
        quotes = await db.amc_quotes.find(scope, {"status": 1, "calc": 1, "recommended_plan": 1, "created_at": 1}).to_list(5000)
        open_q = [q for q in quotes if q.get("status") in ("draft", "sent")]
        rec_total = lambda q: next((p.get("total", 0) for p in (q.get("calc") or {}).get("plans", []) if p.get("key") == q.get("recommended_plan")), 0)  # noqa: E731
        q12 = [q for q in quotes if str(q.get("created_at") or "") >= year_ago]
        won12 = sum(1 for q in q12 if q.get("status") == "accepted")
        tickets_open = 0 if is_partner(user) else await db.support_tickets.count_documents({
            "amc_contract_id": {"$in": ids}, "status": {"$in": ["open", "assigned", "in_progress", "pending_customer", "reopened"]}})

        return {
            "capacity_by_type": capacity_by_type, "pump_hp_total": round(pump_hp_total, 1),
            "active_contracts": len(active), "arr": round(arr, 2), "mrr": round(mrr, 2),
            "expiring_30": expiring_30, "expiring_60": expiring_60, "expiring_90": expiring_90,
            "renewal_rate_pct": renewal_rate, "total_billed": round(total_billed, 2),
            "total_collected": round(total_collected, 2), "outstanding": round(outstanding, 2),
            "visits_due": visits_due, "overdue_visits": overdue_visits,
            "penetration_pct": penetration_pct, "commissioned_projects": commissioned_projects,
            "capacity_kw": round(total_kw, 1), "org": org or OURS,
            "total_kw": round(total_kw, 1), "count_by_type": count_by_type,
            "avg_kw_per_contract": round(total_kw / len(active), 1) if active else 0,
            "value_per_kw": round(arr / total_kw) if total_kw else 0,
            "avg_contract_value": round(arr / len(active)) if active else 0,
            "contracts_total": len(contracts), "renewed": renewed,
            "cancelled": sum(1 for c in contracts if c.get("status") == "cancelled"),
            "new_this_month": sum(1 for c in firsts if str(c.get("start_date") or "") >= month0),
            "new_this_year": sum(1 for c in firsts if str(c.get("start_date") or "") >= year0),
            "visits_done_month": sum(1 for v in done if str(v.get("actual_date") or "") >= month0),
            "visits_done_year": sum(1 for v in done if str(v.get("actual_date") or "") >= year0),
            "visits_next_30": sum(1 for v in visits if v.get("status") == "scheduled" and today.isoformat() <= str(v.get("scheduled_date") or "") <= soon30),
            "collection_pct": round(total_collected / total_billed * 100, 1) if total_billed else 0,
            "plan_mix": plan_mix,
            "top_districts": sorted(({**r, "kw": round(r["kw"], 1)} for r in by_district.values()), key=lambda r: (-r["kw"], -r["contracts"]))[:6],
            "monthly": [{**r, "value": round(r["value"])} for r in monthly.values()],
            "quotes_open": len(open_q), "quotes_open_value": round(sum(rec_total(q) for q in open_q)),
            "quotes_12m": len(q12), "quotes_won_12m": won12, "quote_win_pct": round(won12 / len(q12) * 100, 1) if q12 else 0,
            "tickets_open": tickets_open,
        }

    @router.get("/amc/recurring-revenue-report")
    async def recurring_revenue_report(request: Request, location_id: Optional[str] = None, org: Optional[str] = None):
        user = await require_role("admin", "manager")(request)
        loc_filter = location_scope_filter(user, location_id)
        contracts = await db.amc_contracts.find({**loc_filter, **org_query(org)}).to_list(5000)
        active = [c for c in contracts if c.get("status") == "active"]
        arr = sum((c.get("annual_value", 0) or 0) for c in active)
        mrr = arr / 12
        by_type: Dict[str, float] = {}
        by_district: Dict[str, float] = {}
        for c in active:
            by_type[c.get("contract_type", "other")] = by_type.get(c.get("contract_type", "other"), 0) + (c.get("annual_value", 0) or 0)
            by_district[c.get("district") or "Unknown"] = by_district.get(c.get("district") or "Unknown", 0) + (c.get("annual_value", 0) or 0)
        renewed = sum(1 for c in contracts if c.get("status") == "renewed")
        churned = sum(1 for c in contracts if c.get("status") == "cancelled")
        new_this_period = sum(1 for c in contracts if c.get("status") == "active")
        avg_value = round(arr / len(active), 2) if active else 0
        rows = [{"contract_number": c["contract_number"], "customer": c["customer_name"], "annual_value": c.get("annual_value", 0),
                  "status": c["status"], "end_date": c.get("end_date"), "outstanding": c.get("outstanding", 0)} for c in contracts]
        return {
            "title": "Recurring Revenue Report",
            "summary": {"arr": round(arr, 2), "mrr": round(mrr, 2), "renewed": renewed, "churned": churned,
                        "avg_contract_value": avg_value, "active_contracts": len(active)},
            "by_contract_type": by_type, "by_district": by_district, "rows": rows,
        }

    return router
