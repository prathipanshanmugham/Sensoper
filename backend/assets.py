"""Assets & Tools management — company-owned equipment register, issue/return,
maintenance, and compliance tracking (Iter 42 Change 6)."""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from bson import ObjectId
from pymongo import ReturnDocument
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from locations import location_scope_filter

ASSET_CATEGORIES = ["vehicle", "power_tool", "hand_tool", "test_equipment", "safety", "it", "furniture", "other"]
ASSET_STATUSES = ["available", "issued", "in_maintenance", "under_repair", "lost", "scrapped", "sold"]


class AssetCreate(BaseModel):
    name: str
    category: str
    make: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    purchase_date: Optional[str] = None
    purchase_cost: float = 0
    supplier: Optional[str] = None
    invoice_reference: Optional[str] = None
    warranty_expiry: Optional[str] = None
    depreciation_method: str = "straight_line"
    useful_life_years: float = 5
    condition: str = "new"
    location_id: Optional[str] = None
    storage_location: Optional[str] = None
    requires_calibration: bool = False
    calibration_interval_days: Optional[int] = None
    last_calibration_date: Optional[str] = None
    insurance_policy_number: Optional[str] = None
    insurance_expiry: Optional[str] = None
    registration_number: Optional[str] = None
    registration_expiry: Optional[str] = None
    fitness_certificate_expiry: Optional[str] = None
    pollution_certificate_expiry: Optional[str] = None
    maintenance_interval_days: Optional[int] = None
    notes: Optional[str] = None


class AssetIssue(BaseModel):
    assigned_to: str
    assigned_to_name: str
    assigned_project_id: Optional[str] = None
    expected_return_date: Optional[str] = None
    condition_out: str = "good"
    notes: Optional[str] = None


class AssetReturn(BaseModel):
    condition_in: str = "good"
    notes: Optional[str] = None


class MaintenanceLog(BaseModel):
    type: str  # scheduled | breakdown | calibration
    date: str
    performed_by: Optional[str] = None
    vendor: Optional[str] = None
    description: Optional[str] = None
    cost: float = 0
    downtime_days: float = 0
    next_due: Optional[str] = None
    is_calibration: bool = False


def _book_value(asset: Dict[str, Any]) -> float:
    cost = asset.get("purchase_cost", 0) or 0
    life = asset.get("useful_life_years", 5) or 5
    try:
        purchased = datetime.fromisoformat(asset["purchase_date"]) if asset.get("purchase_date") else None
    except Exception:
        purchased = None
    if not purchased or life <= 0:
        return round(cost, 2)
    if purchased.tzinfo is None:
        purchased = purchased.replace(tzinfo=timezone.utc)
    years_elapsed = (datetime.now(timezone.utc) - purchased).days / 365.25
    remaining_fraction = max(0.0, 1 - (years_elapsed / life))
    return round(cost * remaining_fraction, 2)


def _serialize(a: Dict[str, Any]) -> Dict[str, Any]:
    a = dict(a)
    a["id"] = str(a.pop("_id"))
    a["current_book_value"] = _book_value(a)
    return a


def _next_date(last: Optional[str], interval_days: Optional[int]) -> Optional[str]:
    if not last or not interval_days:
        return None
    try:
        return (datetime.fromisoformat(last) + timedelta(days=int(interval_days))).date().isoformat()
    except Exception:
        return None


async def _next_sequence(db, key: str) -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return doc["seq"]


def create_router(db, get_current_user, require_role, create_audit_log, check_module_permission):
    router = APIRouter()

    @router.get("/assets")
    async def list_assets(request: Request, category: Optional[str] = None, status: Optional[str] = None,
                           location_id: Optional[str] = None, search: Optional[str] = None):
        await get_current_user(request)
        query: Dict[str, Any] = {"active": {"$ne": False}}
        if category: query["category"] = category
        if status: query["status"] = status
        if location_id: query["location_id"] = location_id
        if search: query["name"] = {"$regex": search, "$options": "i"}
        docs = await db.assets.find(query).sort("created_at", -1).to_list(2000)
        return [_serialize(d) for d in docs]

    @router.get("/assets/categories")
    async def list_asset_categories(request: Request):
        """Single source of truth for the category filter/create dropdowns — the canonical
        list merged with any distinct category value actually stored on an active asset, so
        the dropdown can never diverge from what the list/filter query can actually match
        (Iter 45 fix: previously the frontend used its own hardcoded list, which silently
        excluded any asset saved with a category outside that list)."""
        await get_current_user(request)
        stored = await db.assets.distinct("category", {"active": {"$ne": False}})
        merged = sorted(set(ASSET_CATEGORIES) | {c for c in stored if c})
        return {"categories": merged}

    @router.post("/assets")
    async def create_asset(payload: AssetCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        now_iso = datetime.now(timezone.utc).isoformat()
        doc = payload.dict()
        seq = await _next_sequence(db, "asset_code")
        doc.update({
            "asset_code": f"AST-{seq:04d}", "status": "available", "active": True,
            "assigned_to": None, "assigned_to_name": None, "assigned_date": None,
            "next_calibration_date": _next_date(doc.get("last_calibration_date"), doc.get("calibration_interval_days")),
            "next_maintenance_date": None, "last_maintenance_date": None,
            "photos": [], "documents": [], "created_at": now_iso, "updated_at": now_iso,
        })
        res = await db.assets.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "asset_created", "asset", str(res.inserted_id), None, {"name": doc["name"]})
        return _serialize({**doc, "_id": res.inserted_id})

    @router.get("/assets/compliance")
    async def compliance_dashboard(request: Request, days: int = 90):
        await get_current_user(request)
        cutoff = (datetime.now(timezone.utc) + timedelta(days=days)).date().isoformat()
        docs = await db.assets.find({"active": {"$ne": False}}).to_list(2000)
        flags = ["insurance_expiry", "registration_expiry", "fitness_certificate_expiry",
                 "pollution_certificate_expiry", "next_calibration_date"]
        expiring = []
        for a in docs:
            for f in flags:
                val = a.get(f)
                if val and val <= cutoff:
                    try:
                        days_left = (datetime.fromisoformat(val).date() - datetime.now(timezone.utc).date()).days
                    except Exception:
                        days_left = None
                    expiring.append({
                        "asset_id": str(a["_id"]), "asset_code": a.get("asset_code"), "name": a.get("name"),
                        "field": f, "expiry_date": val, "days_left": days_left,
                    })
        expiring.sort(key=lambda x: x["expiry_date"])
        return {"count": len(expiring), "items": expiring}

    @router.get("/assets/{asset_id}")
    async def get_asset(asset_id: str, request: Request):
        await get_current_user(request)
        a = await db.assets.find_one({"_id": ObjectId(asset_id)})
        if not a:
            raise HTTPException(status_code=404, detail="Asset not found")
        movements = await db.asset_movements.find({"asset_id": asset_id}).sort("date", -1).to_list(200)
        maintenance = await db.asset_maintenance.find({"asset_id": asset_id}).sort("date", -1).to_list(200)
        result = _serialize(a)
        result["movements"] = [{**{k: v for k, v in m.items() if k != "_id"}, "id": str(m["_id"])} for m in movements]
        result["maintenance"] = [{**{k: v for k, v in m.items() if k != "_id"}, "id": str(m["_id"])} for m in maintenance]
        return result

    @router.put("/assets/{asset_id}")
    async def update_asset(asset_id: str, payload: Dict[str, Any], request: Request):
        user = await require_role("admin", "manager")(request)
        payload.pop("_id", None); payload.pop("id", None)
        blocked_fields = [f for f in ("status", "assigned_to", "assigned_to_name", "assigned_project_id") if f in payload]
        if blocked_fields:
            raise HTTPException(status_code=400, detail=f"{', '.join(blocked_fields)} can only change via Issue / Return, so the movement log stays the source of truth")
        existing = await db.assets.find_one({"_id": ObjectId(asset_id)})
        if not existing:
            raise HTTPException(status_code=404, detail="Asset not found")
        before = {k: existing.get(k) for k in payload}
        now_iso = datetime.now(timezone.utc).isoformat()
        payload["updated_at"] = now_iso
        await db.assets.update_one({"_id": ObjectId(asset_id)}, {
            "$set": payload,
            "$push": {"edit_history": {"edited_by": user["name"], "edited_at": now_iso, "before": before, "after": {k: payload.get(k) for k in before}}},
        })
        await create_audit_log(user["id"], user["name"], "asset_updated", "asset", asset_id, before, payload)
        return {"message": "Asset updated"}

    @router.delete("/assets/{asset_id}")
    async def delete_asset(asset_id: str, request: Request):
        user = await get_current_user(request)
        a = await db.assets.find_one({"_id": ObjectId(asset_id)})
        if not a:
            raise HTTPException(status_code=404, detail="Asset not found")
        if a.get("status") != "available":
            raise HTTPException(status_code=400, detail=f"Asset must be available (not '{a.get('status')}') before it can be archived — return it first")

        now_iso = datetime.now(timezone.utc).isoformat()
        can_delete = True if user.get("role") == "admin" else await check_module_permission(user, "module_assets", "delete")
        if not can_delete:
            existing = await db.action_requests.find_one({"resource_type": "asset", "resource_id": asset_id, "status": "pending"})
            if existing:
                return {"status": "pending_approval", "message": "An archive request for this asset is already awaiting admin approval"}
            await db.action_requests.insert_one({
                "resource_type": "asset", "resource_id": asset_id, "action": "archive",
                "requested_by": user["id"], "requested_by_name": user["name"],
                "status": "pending", "requested_at": now_iso, "location_id": a.get("location_id"),
                "snapshot": {"name": a.get("name"), "asset_code": a.get("asset_code")},
            })
            await create_audit_log(user["id"], user["name"], "asset_archive_requested", "asset", asset_id)
            return {"status": "pending_approval", "message": "You don't have permission to archive this asset — request sent to an admin for approval"}

        await db.assets.update_one({"_id": ObjectId(asset_id)}, {"$set": {"active": False, "status": "scrapped"}})
        await create_audit_log(user["id"], user["name"], "asset_deleted", "asset", asset_id)
        return {"message": "Asset removed"}

    @router.post("/assets/{asset_id}/issue")
    async def issue_asset(asset_id: str, payload: AssetIssue, request: Request):
        user = await get_current_user(request)
        a = await db.assets.find_one({"_id": ObjectId(asset_id)})
        if not a:
            raise HTTPException(status_code=404, detail="Asset not found")
        if a.get("status") not in ("available",):
            raise HTTPException(status_code=400, detail=f"Asset is currently '{a.get('status')}' — it must be available to issue")
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.assets.update_one({"_id": ObjectId(asset_id)}, {"$set": {
            "status": "issued", "assigned_to": payload.assigned_to, "assigned_to_name": payload.assigned_to_name,
            "assigned_project_id": payload.assigned_project_id, "assigned_date": now_iso,
            "expected_return_date": payload.expected_return_date, "condition": payload.condition_out,
        }})
        await db.asset_movements.insert_one({
            "asset_id": asset_id, "action": "issue", "from_user": None, "to_user": payload.assigned_to_name,
            "project_id": payload.assigned_project_id, "date": now_iso, "condition_out": payload.condition_out,
            "condition_in": None, "notes": payload.notes, "recorded_by": user["name"],
        })
        return {"message": "Asset issued"}

    @router.post("/assets/{asset_id}/return")
    async def return_asset(asset_id: str, payload: AssetReturn, request: Request):
        user = await get_current_user(request)
        a = await db.assets.find_one({"_id": ObjectId(asset_id)})
        if not a:
            raise HTTPException(status_code=404, detail="Asset not found")
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.assets.update_one({"_id": ObjectId(asset_id)}, {"$set": {
            "status": "available", "assigned_to": None, "assigned_to_name": None,
            "assigned_project_id": None, "assigned_date": None, "expected_return_date": None,
            "condition": payload.condition_in,
        }})
        await db.asset_movements.insert_one({
            "asset_id": asset_id, "action": "return", "from_user": a.get("assigned_to_name"), "to_user": None,
            "project_id": a.get("assigned_project_id"), "date": now_iso, "condition_out": None,
            "condition_in": payload.condition_in, "notes": payload.notes, "recorded_by": user["name"],
        })
        return {"message": "Asset returned"}

    @router.post("/assets/{asset_id}/maintenance")
    async def log_maintenance(asset_id: str, payload: MaintenanceLog, request: Request):
        user = await get_current_user(request)
        a = await db.assets.find_one({"_id": ObjectId(asset_id)})
        if not a:
            raise HTTPException(status_code=404, detail="Asset not found")
        doc = payload.dict()
        doc.update({"asset_id": asset_id, "recorded_by": user["name"], "created_at": datetime.now(timezone.utc).isoformat()})
        await db.asset_maintenance.insert_one(doc)
        update: Dict[str, Any] = {"last_maintenance_date": payload.date, "next_maintenance_date": payload.next_due}
        if payload.is_calibration:
            update["last_calibration_date"] = payload.date
            update["next_calibration_date"] = _next_date(payload.date, a.get("calibration_interval_days"))
        await db.assets.update_one({"_id": ObjectId(asset_id)}, {"$set": update})
        return {"message": "Maintenance logged"}

    @router.get("/assets/reports/{report_type}")
    async def asset_report(report_type: str, request: Request, location_id: Optional[str] = None):
        user = await require_role("admin", "manager")(request)
        loc_filter = location_scope_filter(user, location_id)
        all_docs = await db.assets.find(loc_filter).to_list(5000)
        active_docs = [d for d in all_docs if d.get("active", True) is not False]
        assets = [_serialize(d) for d in active_docs]
        all_assets = [_serialize(d) for d in all_docs]

        if report_type == "register":
            rows = [{"asset_code": a["asset_code"], "name": a["name"], "category": a["category"], "status": a["status"],
                      "book_value": a["current_book_value"], "purchase_cost": a.get("purchase_cost", 0)} for a in assets]
            return {"title": "Asset Register", "summary": {"total_assets": len(assets), "total_book_value": round(sum(a["current_book_value"] for a in assets), 2)}, "rows": rows}

        if report_type == "issue_log":
            movs = await db.asset_movements.find({}).sort("date", -1).to_list(5000)
            rows = [{"date": m["date"][:10], "asset_id": m["asset_id"], "action": m["action"], "to_user": m.get("to_user"), "from_user": m.get("from_user"), "project_id": m.get("project_id")} for m in movs]
            return {"title": "Issue / Return Log", "summary": {"total_movements": len(rows)}, "rows": rows}

        if report_type == "maintenance":
            maint = await db.asset_maintenance.find({}).sort("date", -1).to_list(5000)
            rows = [{"date": m["date"][:10], "asset_id": m["asset_id"], "type": m["type"], "cost": m.get("cost", 0), "downtime_days": m.get("downtime_days", 0), "vendor": m.get("vendor")} for m in maint]
            return {"title": "Maintenance History", "summary": {"total_records": len(rows), "total_cost": round(sum(r["cost"] for r in rows), 2)}, "rows": rows}

        if report_type == "compliance":
            cutoff = (datetime.now(timezone.utc) + timedelta(days=90)).date().isoformat()
            flags = ["insurance_expiry", "registration_expiry", "fitness_certificate_expiry", "pollution_certificate_expiry", "next_calibration_date"]
            rows = []
            for a in assets:
                for f in flags:
                    v = a.get(f)
                    if v and v <= cutoff:
                        rows.append({"asset_code": a["asset_code"], "name": a["name"], "field": f, "expiry_date": v})
            return {"title": "Compliance Status (next 90 days)", "summary": {"expiring_items": len(rows)}, "rows": rows}

        if report_type == "utilisation":
            rows = []
            for a in assets:
                movs = await db.asset_movements.find({"asset_id": a["id"]}).to_list(500)
                issued_days = 0
                last_issue = None
                for m in sorted(movs, key=lambda x: x["date"]):
                    if m["action"] == "issue":
                        last_issue = m["date"]
                    elif m["action"] == "return" and last_issue:
                        try:
                            d1, d2 = datetime.fromisoformat(last_issue), datetime.fromisoformat(m["date"])
                            issued_days += (d2 - d1).days
                        except Exception:
                            pass
                        last_issue = None
                rows.append({"asset_code": a["asset_code"], "name": a["name"], "days_issued": issued_days, "status": a["status"]})
            return {"title": "Utilisation Report", "summary": {"total_assets": len(rows)}, "rows": rows}

        if report_type == "depreciation":
            rows = [{"asset_code": a["asset_code"], "name": a["name"], "purchase_cost": a.get("purchase_cost", 0),
                      "useful_life_years": a.get("useful_life_years", 5), "current_book_value": a["current_book_value"]} for a in assets]
            return {"title": "Depreciation Schedule", "summary": {"total_purchase_cost": round(sum(r["purchase_cost"] for r in rows), 2), "total_book_value": round(sum(r["current_book_value"] for r in rows), 2)}, "rows": rows}

        if report_type == "writeoff":
            rows = [{"asset_code": a["asset_code"], "name": a["name"], "status": a["status"], "value_written_off": a.get("purchase_cost", 0)} for a in all_assets if a["status"] in ("lost", "scrapped")]
            return {"title": "Lost / Damaged / Scrapped Assets", "summary": {"count": len(rows), "total_value_written_off": round(sum(r["value_written_off"] for r in rows), 2)}, "rows": rows}

        raise HTTPException(status_code=404, detail=f"Unknown asset report type: {report_type}")

    return router
