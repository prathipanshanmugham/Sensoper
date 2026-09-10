"""Pricelist (Iter 51 restructure) — a pricing view over `inventory_items` (still the one source of
truth for cost/margin/GST). Adds: category-aware grouped list driven by `inventory_categories`
(nothing hidden — stray/legacy categories surface as "uncategorised"), inline + bulk price updates
with an audit trail in `price_history`, per-item history, and a one-shot category normaliser."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

UNCATEGORISED = "uncategorised"
PRICE_FIELDS = ("unit_price", "margin_pct", "gst_percentage", "hsn_code", "active")


class PriceUpdate(BaseModel):
    unit_price: float | None = None
    margin_pct: float | None = None
    gst_percentage: float | None = None
    hsn_code: str | None = None
    active: bool | None = None


class BulkAdjust(BaseModel):
    item_ids: list[str]
    action: str  # set_margin | adjust_margin_pts | adjust_price_pct | set_gst
    value: float


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(v: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (v or "").strip().lower()).strip("_")


def _norm_key(v: str) -> str:
    """Loose key for matching stray categories: lowercase, no separators, singularised."""
    k = re.sub(r"[^a-z0-9]", "", (v or "").lower())
    for suffix in ("ies", "es", "s"):
        if k.endswith(suffix) and len(k) > len(suffix) + 2:
            k = k[: -len(suffix)] + ("y" if suffix == "ies" else "")
            break
    return k


ALIASES = {  # hand-picked synonyms → canonical slug (keys are _norm_key'd)
    "panel": "solar_panels", "solarpanel": "solar_panels", "module": "solar_panels", "pvmodule": "solar_panels",
    "inverter": "inverters", "microinverter": "inverters",
    "battery": "batteries", "storage": "batteries",
    "structure": "mounting_structures", "mounting": "mounting_structures", "mountingstructure": "mounting_structures", "racking": "mounting_structures",
    "cable": "cables_accessories", "wire": "cables_accessories", "accessory": "cables_accessories", "cableaccessory": "cables_accessories", "consumable": "cables_accessories",
    "pump": "pumps", "solarpump": "pumps",
    "bo": "bos", "balanceofsystem": "bos",
}


def compute_row(item: dict[str, Any], cat_labels: dict[str, str]) -> dict[str, Any]:
    """Iter 52: no blanket defaults — a missing margin/GST is reported as missing, never silently filled."""
    raw_margin = item.get("margin_pct")
    raw_gst = item.get("gst_percentage")
    margin_missing = raw_margin is None
    gst_missing = raw_gst is None
    margin = 0.0 if margin_missing else float(raw_margin)
    cost = float(item.get("unit_price") or 0)
    gst = 0.0 if gst_missing else float(raw_gst)
    selling = round(cost * (1 + margin / 100), 2)
    wattage = ((item.get("specs") or {}).get("wattage")) if isinstance(item.get("specs"), dict) else None
    cat = item.get("category") or ""
    known = cat in cat_labels
    return {
        "id": str(item["_id"]), "name": item.get("name"), "sku_code": item.get("sku_code"), "hsn_code": item.get("hsn_code"),
        "category": cat if known else UNCATEGORISED, "raw_category": cat, "category_label": cat_labels.get(cat, cat or "Uncategorised"),
        "supplier": item.get("supplier"), "quantity": item.get("quantity", 0), "active": item.get("active", True) is not False,
        "unit_price": cost, "margin_pct": None if margin_missing else margin, "margin_missing": margin_missing,
        "selling_price": None if margin_missing else selling, "wattage_w": wattage,
        "gst_pct": None if gst_missing else gst, "gst_missing": gst_missing,
        "gst_amount": None if (gst_missing or margin_missing) else round(selling * gst / 100, 2),
        "price_incl_gst": None if (gst_missing or margin_missing) else round(selling * (1 + gst / 100), 2),
        "pricing_complete": not (margin_missing or gst_missing),
        "updated_at": item.get("updated_at"),
    }


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    async def _cat_labels() -> dict[str, str]:
        cats = await db.inventory_categories.find({}).to_list(200)
        return {c["slug"]: c["name"] for c in cats}

    @router.get("/pricelist")
    async def list_pricelist(request: Request, search: str | None = None, category: str | None = None, status: str = "active"):
        await get_current_user(request)
        labels = await _cat_labels()
        q: dict[str, Any] = {}
        if status == "active":
            q["active"] = {"$ne": False}
        elif status == "archived":
            q["active"] = False
        items = await db.inventory_items.find(q).sort("name", 1).to_list(20000)
        rows = [compute_row(i, labels) for i in items]
        counts: dict[str, int] = {}
        missing_count = 0
        for r in rows:
            counts[r["category"]] = counts.get(r["category"], 0) + 1
            missing_count += 0 if r["pricing_complete"] else 1
        if category and category != "all":
            rows = [r for r in rows if r["category"] == category]
        if search:
            s = search.lower()
            rows = [r for r in rows if s in f"{r['name']} {r['sku_code'] or ''} {r['supplier'] or ''} {r['hsn_code'] or ''}".lower()]
        cats_sorted = sorted(await db.inventory_categories.find({}).to_list(200), key=lambda c: c["name"])
        categories = [{"slug": c["slug"], "name": c["name"], "count": counts.get(c["slug"], 0)} for c in cats_sorted]
        if counts.get(UNCATEGORISED):
            categories.append({"slug": UNCATEGORISED, "name": "Uncategorised", "count": counts[UNCATEGORISED]})
        return {"categories": categories, "missing_pricing_count": missing_count,
                "total": sum(counts.values()), "items": rows}

    async def _apply(user, item: dict[str, Any], changes: dict[str, Any], source: str) -> dict[str, Any]:
        changes = {k: v for k, v in changes.items() if k in PRICE_FIELDS and v is not None}
        if "unit_price" in changes and changes["unit_price"] < 0:
            raise HTTPException(status_code=400, detail="Cost price cannot be negative")
        if "margin_pct" in changes and changes["margin_pct"] < -100:
            raise HTTPException(status_code=400, detail="Margin cannot be below -100%")
        if "gst_percentage" in changes and not 0 <= changes["gst_percentage"] <= 100:
            raise HTTPException(status_code=400, detail="GST % must be between 0 and 100")
        if "hsn_code" in changes:
            changes["hsn_code"] = changes["hsn_code"].strip() or None
        if not changes:
            return item
        before = {k: item.get(k) for k in changes}
        changes["updated_at"] = _now()
        await db.inventory_items.update_one({"_id": item["_id"]}, {"$set": changes})
        await db.price_history.insert_one({
            "cat": "pricelist", "product_id": str(item["_id"]), "item_name": item.get("name"), "action": source,
            "before": before, "after": {k: changes[k] for k in before}, "user_id": user["id"], "user_name": user["name"], "at": changes["updated_at"],
        })
        await create_audit_log(user["id"], user["name"], "price_update", "inventory_item", str(item["_id"]), before, {k: changes[k] for k in before})
        return {**item, **changes}

    @router.put("/pricelist/items/{item_id}")
    async def update_price(item_id: str, payload: PriceUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        if not ObjectId.is_valid(item_id):
            raise HTTPException(status_code=400, detail="Invalid item id")
        item = await db.inventory_items.find_one({"_id": ObjectId(item_id)})
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")
        updated = await _apply(user, item, payload.dict(exclude_unset=True), "inline_edit")
        return compute_row(updated, await _cat_labels())

    @router.post("/pricelist/bulk")
    async def bulk_adjust(payload: BulkAdjust, request: Request):
        user = await require_role("admin", "manager")(request)
        if payload.action not in ("set_margin", "adjust_margin_pts", "adjust_price_pct", "set_gst"):
            raise HTTPException(status_code=400, detail="Unknown bulk action")
        oids = [ObjectId(i) for i in payload.item_ids if ObjectId.is_valid(i)]
        if not oids:
            raise HTTPException(status_code=400, detail="Select at least one item")
        labels = await _cat_labels()
        rows = []
        for item in await db.inventory_items.find({"_id": {"$in": oids}}).to_list(5000):
            if payload.action == "set_margin":
                changes = {"margin_pct": round(payload.value, 2)}
            elif payload.action == "adjust_margin_pts":
                cur = item.get("margin_pct")
                if cur is None:
                    continue  # no blanket default to adjust from — set an explicit margin first
                changes = {"margin_pct": round(float(cur) + payload.value, 2)}
            elif payload.action == "set_gst":
                changes = {"gst_percentage": payload.value}
            else:
                changes = {"unit_price": round(float(item.get("unit_price") or 0) * (1 + payload.value / 100), 2)}
            rows.append(compute_row(await _apply(user, item, changes, f"bulk_{payload.action}"), labels))
        return {"updated": len(rows), "items": rows}

    @router.get("/pricelist/items/{item_id}/history")
    async def price_item_history(item_id: str, request: Request):
        await get_current_user(request)
        docs = await db.price_history.find({"product_id": item_id}).sort("at", -1).to_list(200)
        return [{**{k: v for k, v in d.items() if k != "_id"}, "id": str(d["_id"])} for d in docs]

    @router.get("/pricelist/history")
    async def price_history_recent(request: Request, limit: int = 50):
        await get_current_user(request)
        docs = await db.price_history.find({"cat": "pricelist"}).sort("at", -1).to_list(max(1, min(limit, 500)))
        return [{**{k: v for k, v in d.items() if k != "_id"}, "id": str(d["_id"])} for d in docs]

    async def _normalise_plan() -> list[dict[str, Any]]:
        cats = await db.inventory_categories.find({}).to_list(200)
        slugs = {c["slug"] for c in cats}
        by_key = {_norm_key(c["slug"]): c["slug"] for c in cats}
        by_key.update({_norm_key(c["name"]): c["slug"] for c in cats})
        plan = []
        for raw in await db.inventory_items.distinct("category"):
            if not raw or raw in slugs:
                continue
            key = _norm_key(raw)
            target = by_key.get(key) or ALIASES.get(key)
            if target and target in slugs:
                plan.append({"from": raw, "to": target, "count": await db.inventory_items.count_documents({"category": raw})})
            else:
                plan.append({"from": raw, "to": None, "count": await db.inventory_items.count_documents({"category": raw})})
        return plan

    @router.get("/pricelist/normalise-categories")
    async def normalise_preview(request: Request):
        await require_role("admin")(request)
        return {"plan": await _normalise_plan()}

    @router.post("/pricelist/normalise-categories")
    async def normalise_apply(request: Request):
        user = await require_role("admin")(request)
        plan = await _normalise_plan()
        moved = 0
        for step in plan:
            if not step["to"]:
                continue
            res = await db.inventory_items.update_many({"category": step["from"]}, {"$set": {"category": step["to"], "updated_at": _now()}})
            moved += res.modified_count
        await create_audit_log(user["id"], user["name"], "categories_normalised", "inventory_item", "bulk", None, {"moved": moved, "plan": plan})
        return {"moved": moved, "plan": plan}

    @router.post("/pricelist/items/{item_id}/category")
    async def set_item_category(item_id: str, payload: dict[str, Any], request: Request):
        user = await require_role("admin", "manager")(request)
        slug = payload.get("category")
        if not await db.inventory_categories.find_one({"slug": slug}):
            raise HTTPException(status_code=400, detail="Unknown category")
        r = await db.inventory_items.update_one({"_id": ObjectId(item_id)}, {"$set": {"category": slug, "updated_at": _now()}})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Item not found")
        await create_audit_log(user["id"], user["name"], "update", "inventory_item", item_id, None, {"category": slug})
        return {"message": "Category updated"}

    return router
