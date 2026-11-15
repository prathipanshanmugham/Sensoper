"""Excess Material Report — reconciles quoted vs issued vs consumed vs returned
per project (Iter 42 Change 4). Returned quantities flow back into inventory
through the same movement trail used by Purchase Inbound / Direct Sales.
"""
from __future__ import annotations
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel


class ReconciliationLine(BaseModel):
    inventory_item_id: Optional[str] = None
    name: str
    sku_code: Optional[str] = None
    category: Optional[str] = None
    qty_quoted: float = 0
    qty_issued: float = 0
    qty_consumed: float = 0
    qty_returned: float = 0
    qty_damaged: float = 0
    qty_at_site: float = 0
    unit_cost: float = 0
    reason: Optional[str] = None
    notes: Optional[str] = None


class ReconciliationSubmit(BaseModel):
    lines: List[ReconciliationLine]
    status: str = "submitted"  # submitted | verified


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    async def _build_draft(project_id: str) -> List[Dict[str, Any]]:
        project = await db.projects.find_one({"_id": ObjectId(project_id)})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        bom = project.get("selected_items", []) or []
        deliveries = await db.deliveries.find({"project_id": project_id}).to_list(200)
        issued_by_name: Dict[str, float] = {}
        for d in deliveries:
            for it in d.get("items", []):
                issued_by_name[it.get("name")] = issued_by_name.get(it.get("name"), 0) + float(it.get("qty", 0) or 0)
        lines = []
        for item in bom:
            name = item.get("name")
            lines.append({
                "inventory_item_id": item.get("item_id") or item.get("inventory_item_id"),
                "name": name, "sku_code": item.get("sku_code"), "category": item.get("category"),
                "qty_quoted": float(item.get("quantity", 0) or 0),
                "qty_issued": issued_by_name.get(name, float(item.get("quantity", 0) or 0)),
                "qty_consumed": 0, "qty_returned": 0, "qty_damaged": 0, "qty_at_site": 0,
                "unit_cost": float(item.get("unit_price", 0) or 0),
                "reason": None, "notes": None,
            })
        return lines

    @router.get("/material-reconciliation/{project_id}")
    async def get_reconciliation(project_id: str, request: Request):
        await get_current_user(request)
        doc = await db.material_reconciliation.find_one({"project_id": project_id})
        if doc:
            doc["id"] = str(doc.pop("_id"))
            return doc
        lines = await _build_draft(project_id)
        return {"project_id": project_id, "lines": lines, "status": "pending"}

    @router.put("/material-reconciliation/{project_id}")
    async def submit_reconciliation(project_id: str, payload: ReconciliationSubmit, request: Request):
        user = await get_current_user(request)
        project = await db.projects.find_one({"_id": ObjectId(project_id)})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if payload.status not in ("submitted", "verified"):
            raise HTTPException(status_code=400, detail="Status must be submitted or verified")
        if payload.status == "verified" and user.get("role") not in ("admin", "manager"):
            raise HTTPException(status_code=403, detail="Only a manager or admin can verify a material reconciliation")
        for l in payload.lines:
            nums = (l.qty_quoted, l.qty_issued, l.qty_consumed, l.qty_returned, l.qty_damaged, l.qty_at_site, l.unit_cost)
            if any(not math.isfinite(v) or v < 0 for v in nums):
                raise HTTPException(status_code=400, detail=f"{l.name}: quantities and cost can't be negative")
        prev = await db.material_reconciliation.find_one({"project_id": project_id}) or {}
        if prev.get("status") == "verified" and user.get("role") not in ("admin", "manager"):
            raise HTTPException(status_code=403, detail="This reconciliation has been verified — ask a manager to change it")

        # Saving again must not add the same returned stock twice: only the change since the last save moves stock,
        # and only newly damaged pieces become brand returns
        def _key(x: Dict[str, Any]) -> str:
            return str(x.get("inventory_item_id") or "") + "|" + str(x.get("name") or "")
        prev_ret: Dict[str, float] = {}
        prev_dmg: Dict[str, float] = {}
        for pl in prev.get("lines") or []:
            prev_ret[_key(pl)] = prev_ret.get(_key(pl), 0.0) + float(pl.get("qty_returned") or 0)
            prev_dmg[_key(pl)] = prev_dmg.get(_key(pl), 0.0) + float(pl.get("qty_damaged") or 0)

        now_iso = datetime.now(timezone.utc).isoformat()
        lines, movements = [], []
        for l in payload.lines:
            variance = l.qty_issued - (l.qty_consumed + l.qty_returned + l.qty_damaged)
            variance_value = round(variance * l.unit_cost, 2)
            lines.append({**l.dict(), "variance": variance, "variance_value": variance_value})
            k = _key(l.dict())
            ret_delta = l.qty_returned - prev_ret.pop(k, 0.0)
            dmg_delta = l.qty_damaged - prev_dmg.pop(k, 0.0)
            if ret_delta and l.inventory_item_id and ObjectId.is_valid(l.inventory_item_id):
                await db.inventory_items.update_one({"_id": ObjectId(l.inventory_item_id)}, {"$inc": {"quantity": ret_delta}})
                movements.append({
                    "inventory_item_id": l.inventory_item_id, "movement_type": "reconciliation_return",
                    "quantity": ret_delta, "reference_type": "project", "reference_id": project_id,
                    "note": f"Returned to stores from site: {l.name}" if ret_delta > 0 else f"Reconciliation corrected: {l.name}",
                    "created_by": user["id"], "created_at": now_iso,
                })
            if dmg_delta > 0:
                # brand_returns is the collection the Returns page lists (this used to go to an unread "returns")
                await db.brand_returns.insert_one({
                    "project_id": project_id, "supplier_name": "", "item_name": l.name,
                    "quantity": dmg_delta, "reason": "damage", "source": "material_reconciliation",
                    "notes": f"Flagged during material reconciliation. {l.notes or ''}".strip(),
                    "status": "pending", "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso,
                })
        if movements:
            await db.inventory_movements.insert_many(movements)

        doc = {
            "project_id": project_id, "lines": lines, "status": payload.status,
            "reconciled_by": user["id"], "reconciled_by_name": user["name"], "reconciled_at": now_iso,
        }
        if payload.status == "verified":
            doc["verified_by"] = user["id"]; doc["verified_by_name"] = user["name"]; doc["verified_at"] = now_iso
        await db.material_reconciliation.update_one({"project_id": project_id}, {"$set": doc}, upsert=True)
        await create_audit_log(user["id"], user["name"], "material_reconciliation", "project", project_id, None, {"status": payload.status})
        return {"message": "Reconciliation saved", "status": payload.status}

    @router.get("/material-reconciliation-report")
    async def reconciliation_report(request: Request, category: Optional[str] = None, threshold: float = 0):
        await require_role("admin", "manager")(request)
        docs = await db.material_reconciliation.find({}).to_list(2000)
        item_agg: Dict[str, Dict[str, Any]] = {}
        unreturned_by_project, flagged_projects = [], []
        damaged_total, recoverable_value = 0.0, 0.0

        for d in docs:
            proj = await db.projects.find_one({"_id": ObjectId(d["project_id"])}) if d.get("project_id") else None
            pname = (proj.get("customer", {}) or {}).get("name") if proj else d.get("project_id")
            variance_value_total, at_site_value = 0.0, 0.0
            for l in d.get("lines", []):
                if category and l.get("category") != category:
                    continue
                variance_value_total += l.get("variance_value", 0) or 0
                at_site_value += (l.get("qty_at_site", 0) or 0) * (l.get("unit_cost", 0) or 0)
                damaged_total += l.get("qty_damaged", 0) or 0
                key = l.get("name") or "Unknown"
                agg = item_agg.setdefault(key, {"name": key, "category": l.get("category"), "qty_issued": 0.0, "qty_consumed": 0.0, "variance": 0.0, "projects": 0})
                agg["qty_issued"] += l.get("qty_issued", 0) or 0
                agg["qty_consumed"] += l.get("qty_consumed", 0) or 0
                agg["variance"] += l.get("variance", 0) or 0
                agg["projects"] += 1
            recoverable_value += at_site_value
            if at_site_value > 0:
                unreturned_by_project.append({"project_id": d["project_id"], "project_name": pname, "value_at_site": round(at_site_value, 2)})
            if threshold and abs(variance_value_total) > threshold:
                flagged_projects.append({"project_id": d["project_id"], "project_name": pname, "variance_value": round(variance_value_total, 2)})

        by_item = sorted(item_agg.values(), key=lambda x: abs(x["variance"]), reverse=True)
        for it in by_item:
            it["over_issue_pct"] = round((it["variance"] / it["qty_issued"] * 100), 1) if it["qty_issued"] else 0

        return {
            "total_reconciliations": len(docs),
            "recoverable_value": round(recoverable_value, 2),
            "damaged_total_qty": round(damaged_total, 2),
            "unreturned_by_project": sorted(unreturned_by_project, key=lambda x: x["value_at_site"], reverse=True),
            "by_item": by_item,
            "flagged_projects": flagged_projects,
        }

    @router.get("/material-reconciliation-alerts")
    async def reconciliation_alerts(request: Request, days: int = 7):
        await require_role("admin", "manager")(request)
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        completed = await db.projects.find({"status": "completed", "completed_at": {"$lte": cutoff}}).to_list(2000)
        alerts = []
        for p in completed:
            existing = await db.material_reconciliation.find_one({"project_id": str(p["_id"])})
            if not existing or existing.get("status") == "pending":
                alerts.append({
                    "project_id": str(p["_id"]),
                    "project_name": (p.get("customer", {}) or {}).get("name"),
                    "completed_at": p.get("completed_at"),
                })
        return {"count": len(alerts), "projects": alerts}

    return router
