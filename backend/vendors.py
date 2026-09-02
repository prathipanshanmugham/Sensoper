"""Vendor / Supplier directory — CRUD + PO history linkage by supplier name match
(Iteration 44 Batch C)."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from bson import ObjectId


class VendorCreate(BaseModel):
    name: str
    contact_person: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    gstin: Optional[str] = ""
    address: Optional[str] = ""
    category: Optional[str] = ""  # panels | inverters | structure | transport | services | other
    notes: Optional[str] = ""


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    address: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    @router.get("/vendors")
    async def list_vendors(request: Request, search: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {"active": {"$ne": False}}
        if search:
            q["name"] = {"$regex": search, "$options": "i"}
        docs = await db.vendors.find(q).sort("name", 1).to_list(2000)
        return [_clean(d) for d in docs]

    @router.post("/vendors")
    async def create_vendor(payload: VendorCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        doc = payload.dict()
        doc["active"] = True
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        result = await db.vendors.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "create", "vendor", str(result.inserted_id), None, {"name": doc["name"]})
        return _clean({**doc, "_id": result.inserted_id})

    @router.put("/vendors/{vendor_id}")
    async def update_vendor(vendor_id: str, payload: VendorUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            oid = ObjectId(vendor_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid vendor id")
        existing = await db.vendors.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Vendor not found")
        update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.vendors.update_one({"_id": oid}, {"$set": update})
        await create_audit_log(user["id"], user["name"], "update", "vendor", vendor_id, _clean(existing), update)
        fresh = await db.vendors.find_one({"_id": oid})
        return _clean(fresh)

    @router.delete("/vendors/{vendor_id}")
    async def delete_vendor(vendor_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            oid = ObjectId(vendor_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid vendor id")
        existing = await db.vendors.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Vendor not found")
        await db.vendors.update_one({"_id": oid}, {"$set": {"active": False}})
        await create_audit_log(user["id"], user["name"], "delete", "vendor", vendor_id)
        return {"message": "Vendor archived"}

    @router.get("/vendors/{vendor_id}/purchase-orders")
    async def vendor_purchase_orders(vendor_id: str, request: Request):
        await get_current_user(request)
        try:
            oid = ObjectId(vendor_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid vendor id")
        vendor = await db.vendors.find_one({"_id": oid})
        if not vendor:
            raise HTTPException(status_code=404, detail="Vendor not found")
        name = vendor.get("name", "")
        pos = await db.purchase_orders.find(
            {"supplier_name": {"$regex": f"^{name}$", "$options": "i"}}
        ).sort("created_at", -1).to_list(500)
        rows = [{
            "id": str(po["_id"]), "items_count": len(po.get("items", [])),
            "total": round(po.get("total_amount", 0) or 0, 2), "status": po.get("status", ""),
            "date": (po.get("created_at") or "")[:10],
        } for po in pos]
        return {"vendor": _clean(vendor), "purchase_orders": rows, "total_value": round(sum(r["total"] for r in rows), 2)}

    return router
