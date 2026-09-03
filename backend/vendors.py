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
    district: Optional[str] = ""
    payment_terms: Optional[str] = ""
    category: Optional[str] = ""  # panels | inverters | structure | transport | services | other
    notes: Optional[str] = ""


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    payment_terms: Optional[str] = None
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
    async def list_vendors(request: Request, search: Optional[str] = None,
                            category: Optional[str] = None, status: Optional[str] = None,
                            district: Optional[str] = None, sort: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {}
        if status == "inactive":
            q["active"] = False
        elif status == "active" or not status:
            q["active"] = {"$ne": False}
        if category:
            q["category"] = category
        if district:
            q["district"] = {"$regex": f"^{district}$", "$options": "i"}
        if search:
            q["$or"] = [
                {"name": {"$regex": search, "$options": "i"}},
                {"gstin": {"$regex": search, "$options": "i"}},
            ]
        docs = await db.vendors.find(q).sort("name", 1).to_list(2000)
        # Attach business_value + last_order_date from purchase_orders (matched by supplier_name)
        vendor_names = [d["name"] for d in docs]
        po_stats: Dict[str, Dict[str, Any]] = {n: {"value": 0.0, "last": ""} for n in vendor_names}
        if vendor_names:
            async for po in db.purchase_orders.find({"supplier_name": {"$in": vendor_names}}):
                key = po.get("supplier_name")
                if key not in po_stats:
                    po_stats[key] = {"value": 0.0, "last": ""}
                po_stats[key]["value"] += po.get("total_amount", 0) or 0
                d = (po.get("created_at") or "")[:10]
                if d and d > po_stats[key]["last"]:
                    po_stats[key]["last"] = d
        out = []
        for d in docs:
            row = _clean(d)
            stat = po_stats.get(row["name"], {"value": 0.0, "last": ""})
            row["business_value"] = round(stat["value"], 2)
            row["last_order_date"] = stat["last"] or None
            out.append(row)
        if sort == "business_desc":
            out.sort(key=lambda r: r.get("business_value", 0) or 0, reverse=True)
        elif sort == "recent_desc":
            out.sort(key=lambda r: r.get("last_order_date") or "", reverse=True)
        elif sort == "recent_asc":
            out.sort(key=lambda r: r.get("last_order_date") or "9999-99-99")
        return out

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
