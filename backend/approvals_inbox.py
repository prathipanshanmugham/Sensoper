"""Iter 53 — Unified approvals inbox.

Root cause of "approvals not working": the app grew FIVE independent approval flows (generic engine,
project submit→approve, project deletion requests, inbound reversal requests, PO approval) but the
Approvals page only read the generic engine — and nothing in the UI ever wrote to it. Requests
therefore vanished from the approver's view. This module lists every pending item from every source
in one inbox and dispatches approve/reject to the *existing* handler for that source, so each flow
keeps its own business rules while approvers see one queue."""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

SOURCES = ("approval", "project_submission", "deletion_request", "inbound_action", "purchase_order")


def _sid(doc: Dict[str, Any]) -> str:
    return str(doc["_id"])


def create_router(db, get_current_user, require_role, handlers: Dict[str, Callable]):
    """handlers: approve_<source> / reject_<source> coroutines taking (entity_id, request)."""
    router = APIRouter()

    async def _scope_ok(user: Dict[str, Any], location_id: Optional[str]) -> bool:
        if user["role"] == "admin" or not location_id:
            return True
        assigned = user.get("assigned_location_ids") or ([user["default_location_id"]] if user.get("default_location_id") else [])
        return not assigned or location_id in assigned

    async def _pending_items(user: Dict[str, Any]) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for a in db.approvals.find({"status": "pending"}).sort("timestamp", -1):
            items.append({"source": "approval", "id": _sid(a), "kind": a.get("type"), "title": f"{(a.get('type') or '').replace('_', ' ').title()} — {a.get('entity_type', '')}",
                          "description": a.get("description", ""), "entity_type": a.get("entity_type"), "entity_id": a.get("entity_id"),
                          "requested_by_name": a.get("requested_by_name"), "requested_at": a.get("timestamp"), "data": a.get("data_payload") or {},
                          "approver_roles": ["admin"] if a.get("type") == "deletion" else ["admin", "manager"]})
        async for p in db.projects.find({"status": "submitted", "deleted_at": {"$exists": False}}).sort("submitted_at", -1):
            total = ((p.get("cost_estimation") or {}).get("total_cost")) or 0
            items.append({"source": "project_submission", "id": _sid(p), "kind": "project_review", "title": f"Project review — {(p.get('customer') or {}).get('name', '')}",
                          "description": f"{p.get('reference_number') or ''} · {(p.get('solar_system') or {}).get('capacity_kw') or ''} kW · ₹{round(float(total)):,}",
                          "entity_type": "project", "entity_id": _sid(p), "requested_by_name": p.get("created_by_name"), "requested_at": p.get("submitted_at"),
                          "data": {"total_cost": total, "pricing_issues": (p.get("cost_estimation") or {}).get("pricing_issues") or []}, "approver_roles": ["admin", "manager"]})
        async for d in db.deletion_requests.find({"status": "pending"}).sort("requested_at", -1):
            items.append({"source": "deletion_request", "id": _sid(d), "kind": "project_deletion", "title": f"Delete project — {d.get('project_name', '')}",
                          "description": d.get("reason", ""), "entity_type": "project", "entity_id": d.get("project_id"),
                          "requested_by_name": d.get("requested_by_name"), "requested_at": d.get("requested_at"), "data": {}, "approver_roles": ["admin", "manager"]})
        async for r in db.inbound_action_requests.find({"status": "pending"}).sort("requested_at", -1):
            if not await _scope_ok(user, r.get("location_id")):
                continue
            items.append({"source": "inbound_action", "id": _sid(r), "kind": "inbound_reversal", "title": f"Reverse inbound — {r.get('supplier_name', '')}",
                          "description": f"{len(r.get('received_items_snapshot') or [])} received line(s) would be pulled back from stock",
                          "entity_type": "purchase_order", "entity_id": r.get("po_id"), "requested_by_name": r.get("requested_by_name"),
                          "requested_at": r.get("requested_at"), "data": {}, "approver_roles": ["admin", "manager"]})
        async for po in db.purchase_orders.find({"status": "pending"}).sort("created_at", -1):
            if not await _scope_ok(user, po.get("location_id")):
                continue
            total = sum(float(i.get("qty") or i.get("quantity") or 0) * float(i.get("unit_price") or 0) for i in (po.get("items") or []))
            items.append({"source": "purchase_order", "id": _sid(po), "kind": "po_approval", "title": f"Purchase order — {po.get('supplier_name', '')}",
                          "description": f"{len(po.get('items') or [])} line(s) · ₹{round(total):,}", "entity_type": "purchase_order", "entity_id": _sid(po),
                          "requested_by_name": po.get("created_by_name"), "requested_at": po.get("created_at"), "data": {"total": total}, "approver_roles": ["admin", "manager"]})
        return items

    @router.get("/approvals/inbox")
    async def inbox(request: Request, source: Optional[str] = None):
        user = await require_role("admin", "manager")(request)
        items = await _pending_items(user)
        if source and source != "all":
            items = [i for i in items if i["source"] == source]
        counts: Dict[str, int] = {}
        for i in items:
            counts[i["source"]] = counts.get(i["source"], 0) + 1
        return {"items": items, "counts": counts, "total": len(items)}

    @router.get("/approvals/inbox/count")
    async def inbox_count(request: Request):
        user = await get_current_user(request)
        if user["role"] == "staff":
            return {"count": 0}
        return {"count": len(await _pending_items(user))}

    @router.get("/approvals/inbox/history")
    async def history(request: Request, limit: int = 100):
        await require_role("admin", "manager")(request)
        rows: List[Dict[str, Any]] = []
        async for a in db.approvals.find({"status": {"$ne": "pending"}}).sort("resolved_at", -1).limit(limit):
            rows.append({"source": "approval", "id": _sid(a), "title": f"{(a.get('type') or '').replace('_', ' ').title()} — {a.get('entity_type', '')}", "status": a.get("status"),
                         "resolved_by_name": a.get("approved_by_name"), "resolved_at": a.get("resolved_at"), "reason": a.get("rejection_reason"), "requested_by_name": a.get("requested_by_name")})
        async for d in db.deletion_requests.find({"status": {"$ne": "pending"}}).sort("resolved_at", -1).limit(limit):
            rows.append({"source": "deletion_request", "id": _sid(d), "title": f"Delete project — {d.get('project_name', '')}", "status": d.get("status"),
                         "resolved_by_name": d.get("resolved_by_name"), "resolved_at": d.get("resolved_at"), "reason": d.get("rejection_reason") or d.get("reason"), "requested_by_name": d.get("requested_by_name")})
        async for r in db.inbound_action_requests.find({"status": {"$ne": "pending"}}).sort("resolved_at", -1).limit(limit):
            rows.append({"source": "inbound_action", "id": _sid(r), "title": f"Reverse inbound — {r.get('supplier_name', '')}", "status": r.get("status"),
                         "resolved_by_name": r.get("resolved_by_name"), "resolved_at": r.get("resolved_at"), "reason": r.get("rejection_reason"), "requested_by_name": r.get("requested_by_name")})
        async for p in db.projects.find({"status": {"$in": ["approved", "rejected"]}, "deleted_at": {"$exists": False}}).sort("updated_at", -1).limit(limit):
            rows.append({"source": "project_submission", "id": _sid(p), "title": f"Project review — {(p.get('customer') or {}).get('name', '')}", "status": p.get("status"),
                         "resolved_by_name": p.get("approved_by_name"), "resolved_at": p.get("approved_at") or p.get("updated_at"), "reason": p.get("rejection_reason"), "requested_by_name": p.get("created_by_name")})
        async for po in db.purchase_orders.find({"status": {"$in": ["approved", "rejected"]}}).sort("approved_at", -1).limit(limit):
            rows.append({"source": "purchase_order", "id": _sid(po), "title": f"Purchase order — {po.get('supplier_name', '')}", "status": po.get("status"),
                         "resolved_by_name": po.get("approved_by") or po.get("rejected_by_name"), "resolved_at": po.get("approved_at") or po.get("rejected_at"), "reason": po.get("rejection_reason"), "requested_by_name": po.get("created_by_name")})
        rows.sort(key=lambda r: r.get("resolved_at") or "", reverse=True)
        return rows[:limit]

    @router.post("/approvals/inbox/{source}/{item_id}/approve")
    async def approve_item(source: str, item_id: str, request: Request):
        if source not in SOURCES:
            raise HTTPException(status_code=400, detail=f"Unknown approval source '{source}'")
        await require_role("admin", "manager")(request)
        if not ObjectId.is_valid(item_id):
            raise HTTPException(status_code=400, detail="Invalid id")
        result = await handlers[f"approve_{source}"](item_id, request)
        return {"source": source, "id": item_id, "status": "approved", "result": result}

    @router.post("/approvals/inbox/{source}/{item_id}/reject")
    async def reject_item(source: str, item_id: str, request: Request):
        if source not in SOURCES:
            raise HTTPException(status_code=400, detail=f"Unknown approval source '{source}'")
        await require_role("admin", "manager")(request)
        if not ObjectId.is_valid(item_id):
            raise HTTPException(status_code=400, detail="Invalid id")
        result = await handlers[f"reject_{source}"](item_id, request)
        return {"source": source, "id": item_id, "status": "rejected", "result": result}

    return router
