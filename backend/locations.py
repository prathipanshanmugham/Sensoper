"""Multi-location access control (Iter 42 Change 8). Scoped deliberately: a
`locations` registry, a location assignment on users, and read-side
filtering on the highest-traffic collections (projects, inventory, purchase
orders — assets & AMC already carry location_id from Change 5/6). Admins
always see everything and can filter by location; everyone else is scoped
to their assigned location(s). Legacy documents without a location_id stay
visible to everyone so existing data is never orphaned by turning this on.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

LOCATION_TYPES = ["branch", "warehouse", "business_unit", "head_office"]


class OrgLocationCreate(BaseModel):
    name: str
    code: Optional[str] = None
    type: str = "branch"
    address: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None


def location_scope_filter(user: Dict[str, Any], location_id_param: Optional[str] = None) -> Dict[str, Any]:
    if user.get("role") == "admin":
        return {"location_id": location_id_param} if location_id_param else {}
    scope = user.get("location_ids") or []
    if location_id_param and (not scope or location_id_param in scope):
        return {"location_id": location_id_param}
    if not scope:
        return {}
    return {"$or": [{"location_id": {"$in": scope}}, {"location_id": None}, {"location_id": {"$exists": False}}]}


def _strip_id(d: Dict[str, Any]) -> Dict[str, Any]:
    oid = d.pop("_id")
    return {**d, "id": str(oid)}


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    @router.get("/locations")
    async def list_locations(request: Request):
        user = await get_current_user(request)
        docs = await db.locations.find({"active": {"$ne": False}}).sort("name", 1).to_list(500)
        result = [_strip_id(d) for d in docs]
        if user.get("role") != "admin" and user.get("location_ids"):
            result = [l for l in result if l["id"] in user["location_ids"]]
        return result

    @router.post("/locations")
    async def create_location(payload: OrgLocationCreate, request: Request):
        user = await require_role("admin")(request)
        now_iso = datetime.now(timezone.utc).isoformat()
        doc = payload.dict()
        doc.update({"active": True, "created_at": now_iso, "updated_at": now_iso})
        res = await db.locations.insert_one(doc)
        doc.pop("_id", None)
        await create_audit_log(user["id"], user["name"], "location_created", "location", str(res.inserted_id), None, {"name": doc["name"]})
        return {**doc, "id": str(res.inserted_id)}

    @router.put("/locations/{location_id}")
    async def update_location(location_id: str, payload: Dict[str, Any], request: Request):
        user = await require_role("admin")(request)
        payload.pop("_id", None); payload.pop("id", None)
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        r = await db.locations.update_one({"_id": ObjectId(location_id)}, {"$set": payload})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Location not found")
        await create_audit_log(user["id"], user["name"], "location_updated", "location", location_id)
        return {"message": "Location updated"}

    @router.delete("/locations/{location_id}")
    async def delete_location(location_id: str, request: Request):
        user = await require_role("admin")(request)
        in_use = await db.users.count_documents({"location_ids": location_id})
        if in_use:
            raise HTTPException(status_code=400, detail=f"{in_use} user(s) are assigned to this location — reassign them first")
        await db.locations.update_one({"_id": ObjectId(location_id)}, {"$set": {"active": False}})
        return {"message": "Location removed"}

    @router.put("/users/{user_id}/locations")
    async def assign_user_locations(user_id: str, payload: Dict[str, Any], request: Request):
        admin_user = await require_role("admin")(request)
        location_ids = payload.get("location_ids", [])
        default_location_id = payload.get("default_location_id")
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {
            "location_ids": location_ids, "default_location_id": default_location_id,
        }})
        await create_audit_log(admin_user["id"], admin_user["name"], "user_locations_assigned", "user", user_id, None, {"location_ids": location_ids})
        return {"message": "User locations updated"}

    return router
