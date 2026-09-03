"""AMC (Annual Maintenance Contracts) module — recurring-revenue contracts,
service visit scheduling and the Recurring Revenue Report (Iter 42 Change 5)."""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from bson import ObjectId
from pymongo import ReturnDocument
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from locations import location_scope_filter

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
    system_type: str  # on-grid | off-grid | hybrid | solar-pump
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


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    @router.get("/amc/contracts")
    async def list_contracts(request: Request, status: Optional[str] = None, system_type: Optional[str] = None,
                              district: Optional[str] = None, search: Optional[str] = None, location_id: Optional[str] = None):
        user = await get_current_user(request)
        loc_filter = location_scope_filter(user, location_id)
        query: Dict[str, Any] = dict(loc_filter)
        if status: query["status"] = status
        if system_type: query["system_type"] = system_type
        if district: query["district"] = district
        if search: query["customer_name"] = {"$regex": search, "$options": "i"}
        docs = await db.amc_contracts.find(query).sort("created_at", -1).to_list(2000)
        return [_serialize(d) for d in docs]

    @router.post("/amc/contracts")
    async def create_contract(payload: AMCContractCreate, request: Request):
        user = await require_role("admin", "manager")(request)
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
        await create_audit_log(user["id"], user["name"], "amc_contract_created", "amc_contract", str(res.inserted_id), None, {"customer": doc["customer_name"]})
        return _serialize({**doc, "_id": res.inserted_id})

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
        doc = {
            "project_id": project_id, "customer_id": customer.get("id"), "customer_name": customer.get("name", "Customer"),
            "contact": customer.get("phone"), "site_address": customer.get("address"),
            "district": project.get("location", {}).get("district") if isinstance(project.get("location"), dict) else project.get("district"),
            "state": project.get("location", {}).get("state") if isinstance(project.get("location"), dict) else project.get("state"),
            "location_id": None, "system_type": ps.get("system_type", "on-grid"),
            "system_capacity_kw": float(ps.get("system_size_kw") or 0), "pump_hp": ps.get("pump_hp"),
            "commissioning_date": project.get("completed_at", now_iso)[:10],
            "contract_type": "comprehensive", "start_date": start_date, "end_date": _end_date(start_date, duration_months),
            "duration_months": duration_months, "annual_value": round(float(ps.get("system_size_kw") or 0) * 1500, 2),
            "billing_frequency": "annual", "next_billing_date": _next_billing(start_date, "annual"),
            "auto_renew": False, "renewal_notice_days": 30, "visits_per_year": 2, "visits_completed": 0, "visits_remaining": 2,
            "service_schedule": [], "inclusions": ["Panel cleaning", "Inverter health check", "Earthing test"], "exclusions": [],
            "response_time_hours": 48, "uptime_guarantee_pct": 95, "contract_number": f"AMC-{seq:04d}",
            "status": "active", "total_billed": 0, "total_collected": 0, "outstanding": 0,
            "renewal_status": None, "previous_contract_id": None, "created_at": now_iso, "updated_at": now_iso,
        }
        res = await db.amc_contracts.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "amc_contract_created_from_project", "amc_contract", str(res.inserted_id), None, {"project_id": project_id})
        return _serialize({**doc, "_id": res.inserted_id})

    @router.get("/amc/contracts/{contract_id}")
    async def get_contract(contract_id: str, request: Request):
        await get_current_user(request)
        c = await db.amc_contracts.find_one({"_id": ObjectId(contract_id)})
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        visits = await db.amc_service_visits.find({"contract_id": contract_id}).sort("scheduled_date", -1).to_list(200)
        result = _serialize(c)
        result["visit_history"] = [{**{k: v for k, v in vi.items() if k != "_id"}, "id": str(vi["_id"])} for vi in visits]
        return result

    @router.put("/amc/contracts/{contract_id}")
    async def update_contract(contract_id: str, payload: Dict[str, Any], request: Request):
        user = await require_role("admin", "manager")(request)
        payload.pop("_id", None); payload.pop("id", None)
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        r = await db.amc_contracts.update_one({"_id": ObjectId(contract_id)}, {"$set": payload})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Contract not found")
        await create_audit_log(user["id"], user["name"], "amc_contract_updated", "amc_contract", contract_id)
        return {"message": "Contract updated"}

    @router.post("/amc/contracts/{contract_id}/renew")
    async def renew_contract(contract_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        c = await db.amc_contracts.find_one({"_id": ObjectId(contract_id)})
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
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
        return _serialize({**new_doc, "_id": res.inserted_id})

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
        user = await require_role("admin", "manager")(request)
        await db.amc_contracts.update_one({"_id": ObjectId(contract_id)}, {"$set": {
            "status": "cancelled", "renewal_status": "churned", "churn_reason": payload.get("reason", ""),
        }})
        await create_audit_log(user["id"], user["name"], "amc_contract_cancelled", "amc_contract", contract_id)
        return {"message": "Contract cancelled"}

    # ── Service visits ──
    @router.post("/amc/contracts/{contract_id}/visits")
    async def schedule_visit(contract_id: str, payload: Dict[str, Any], request: Request):
        user = await get_current_user(request)
        c = await db.amc_contracts.find_one({"_id": ObjectId(contract_id)})
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
        v = await db.amc_service_visits.find_one({"_id": ObjectId(visit_id)})
        if not v:
            raise HTTPException(status_code=404, detail="Visit not found")
        now_iso = datetime.now(timezone.utc).isoformat()
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
        await get_current_user(request)
        query: Dict[str, Any] = {}
        if status: query["status"] = status
        if contract_id: query["contract_id"] = contract_id
        docs = await db.amc_service_visits.find(query).sort("scheduled_date", 1).to_list(2000)
        return [{**{k: v for k, v in d.items() if k != "_id"}, "id": str(d["_id"])} for d in docs]

    # ── Dashboard ──
    @router.get("/amc/dashboard")
    async def amc_dashboard(request: Request, location_id: Optional[str] = None):
        user = await get_current_user(request)
        loc_filter = location_scope_filter(user, location_id)
        contracts = await db.amc_contracts.find(loc_filter).to_list(5000)
        active = [c for c in contracts if c.get("status") == "active"]
        capacity_by_type: Dict[str, float] = {}
        pump_hp_total = 0.0
        for c in active:
            st = c.get("system_type", "other")
            if st == "solar-pump":
                pump_hp_total += c.get("pump_hp", 0) or 0
            else:
                capacity_by_type[st] = capacity_by_type.get(st, 0) + (c.get("system_capacity_kw", 0) or 0)

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
            "status": "scheduled", "scheduled_date": {"$lt": today.isoformat()},
        })

        commissioned_projects = await db.projects.count_documents({"status": "completed", **loc_filter})
        penetration_pct = round((len(active) / commissioned_projects) * 100, 1) if commissioned_projects else 0

        return {
            "capacity_by_type": capacity_by_type, "pump_hp_total": round(pump_hp_total, 1),
            "active_contracts": len(active), "arr": round(arr, 2), "mrr": round(mrr, 2),
            "expiring_30": expiring_30, "expiring_60": expiring_60, "expiring_90": expiring_90,
            "renewal_rate_pct": renewal_rate, "total_billed": round(total_billed, 2),
            "total_collected": round(total_collected, 2), "outstanding": round(outstanding, 2),
            "visits_due": visits_due, "overdue_visits": overdue_visits,
            "penetration_pct": penetration_pct, "commissioned_projects": commissioned_projects,
        }

    @router.get("/amc/recurring-revenue-report")
    async def recurring_revenue_report(request: Request, location_id: Optional[str] = None):
        user = await require_role("admin", "manager")(request)
        loc_filter = location_scope_filter(user, location_id)
        contracts = await db.amc_contracts.find(loc_filter).to_list(5000)
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
