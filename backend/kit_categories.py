"""Iter 58 — admin-manageable Solution Kit categories.

Kits used to be tied to the fixed system-type enum (on-grid / off-grid / hybrid / solar-pump). Categories are now
rows in `kit_categories`; the four legacy ones carry `system_type` so the Proposed-Solution auto-match keeps working,
while new product lines (e.g. Solar Camera) have no system_type and are quoted as standalone bundles.
"""
import re
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

SEED = [
    {"slug": "on-grid", "label": "On-Grid", "system_type": "on-grid", "color": "blue", "sort_order": 1},
    {"slug": "off-grid", "label": "Off-Grid", "system_type": "off-grid", "color": "orange", "sort_order": 2},
    {"slug": "hybrid", "label": "Hybrid", "system_type": "hybrid", "color": "violet", "sort_order": 3},
    {"slug": "solar-pump", "label": "Solar Pump", "system_type": "solar-pump", "color": "cyan", "sort_order": 4},
    {"slug": "solar-camera", "label": "Solar Camera", "system_type": None, "color": "rose", "sort_order": 5,
     "description": "Solar-powered CCTV / security camera bundles — cameras, NVR/DVR, cabling, mounting, panel + battery supply."},
]


def slugify(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (label or "").strip().lower()).strip("-")
    if not s:
        raise HTTPException(status_code=400, detail="Category name must contain letters or numbers")
    return s


def serialize(doc) -> dict:
    return {
        "id": str(doc["_id"]), "slug": doc["slug"], "label": doc.get("label") or doc["slug"],
        "system_type": doc.get("system_type"), "color": doc.get("color") or "slate",
        "description": doc.get("description") or "", "active": doc.get("active", True),
        "sort_order": doc.get("sort_order", 99), "builtin": bool(doc.get("builtin")),
    }


class CategoryCreate(BaseModel):
    label: str
    description: Optional[str] = None
    color: Optional[str] = None


class CategoryUpdate(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    active: Optional[bool] = None


async def ensure_seed(db):
    for i, s in enumerate(SEED):
        await db.kit_categories.update_one(
            {"slug": s["slug"]},
            {"$setOnInsert": {**s, "active": True, "builtin": s["system_type"] is not None, "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True)
    # legacy kits: category defaults to the system_type slug
    await db.material_kits.update_many({"category": {"$exists": False}, "system_type": {"$ne": None}}, [{"$set": {"category": "$system_type"}}])


async def resolve_category(db, slug: Optional[str], system_type: Optional[str]):
    """Return (category_slug, system_type) for a kit payload; validates the slug exists and is active."""
    slug = slug or system_type
    if not slug:
        raise HTTPException(status_code=400, detail="Kit category is required")
    cat = await db.kit_categories.find_one({"slug": slug})
    if not cat:
        raise HTTPException(status_code=400, detail=f"Unknown kit category '{slug}' — add it under Solution Kits → Manage categories first")
    if not cat.get("active", True):
        raise HTTPException(status_code=400, detail=f"Kit category '{cat.get('label') or slug}' is retired — reactivate it or pick another category")
    return slug, cat.get("system_type")


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    @router.get("/kit-categories")
    async def list_categories(request: Request, include_retired: bool = False):
        await get_current_user(request)
        q = {} if include_retired else {"active": {"$ne": False}}
        docs = await db.kit_categories.find(q).sort([("sort_order", 1), ("label", 1)]).to_list(200)
        counts = {}
        async for row in db.material_kits.aggregate([{"$match": {"active": True}}, {"$group": {"_id": "$category", "n": {"$sum": 1}}}]):
            counts[row["_id"]] = row["n"]
        return [{**serialize(d), "kit_count": counts.get(d["slug"], 0)} for d in docs]

    @router.post("/kit-categories")
    async def create_category(body: CategoryCreate, request: Request):
        user = await require_role("admin")(request)
        slug = slugify(body.label)
        if await db.kit_categories.find_one({"slug": slug}):
            raise HTTPException(status_code=409, detail=f"A category '{body.label.strip()}' already exists (slug {slug})")
        last = await db.kit_categories.find_one(sort=[("sort_order", -1)])
        doc = {"slug": slug, "label": body.label.strip(), "description": (body.description or "").strip(), "color": body.color or "slate",
               "system_type": None, "active": True, "builtin": False, "sort_order": (last or {}).get("sort_order", 0) + 1,
               "created_at": datetime.now(timezone.utc).isoformat(), "created_by": user["id"]}
        res = await db.kit_categories.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "kit_category_created", "kit_category", str(res.inserted_id), None, {"slug": slug, "label": doc["label"]})
        return serialize({**doc, "_id": res.inserted_id})

    @router.put("/kit-categories/{cat_id}")
    async def update_category(cat_id: str, body: CategoryUpdate, request: Request):
        user = await require_role("admin")(request)
        if not ObjectId.is_valid(cat_id):
            raise HTTPException(status_code=400, detail="Invalid id")
        doc = await db.kit_categories.find_one({"_id": ObjectId(cat_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Category not found")
        upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        if "label" in upd:
            upd["label"] = upd["label"].strip()
            if not upd["label"]:
                raise HTTPException(status_code=400, detail="Label cannot be empty")
        if upd.get("active") is False and doc.get("builtin"):
            raise HTTPException(status_code=400, detail="Built-in system-type categories (used by the calculator) cannot be retired")
        if upd.get("active") is False:
            n = await db.material_kits.count_documents({"category": doc["slug"], "active": True})
            if n:
                raise HTTPException(status_code=409, detail=f"Cannot retire '{doc.get('label')}': {n} active kit(s) still use it — move or deactivate them first")
        upd["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.kit_categories.update_one({"_id": doc["_id"]}, {"$set": upd})
        await create_audit_log(user["id"], user["name"], "kit_category_updated", "kit_category", cat_id, {k: doc.get(k) for k in upd}, upd)
        return serialize({**doc, **upd})

    return router
