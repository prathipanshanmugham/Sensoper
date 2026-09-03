"""Ecommerce marketplace module — platforms, listings and orders (Iteration 46
Change 2). Listings link straight to `inventory_items` (no separate product
master). Orders decrement stock through the SAME `inventory_movements` trail
Direct Sales already uses, so stock, margin and revenue stay consistent
everywhere else in the system reads inventory from.

No live Amazon/Flipkart Seller API integration in this pass — platforms and
orders are managed manually or via CSV import (preview-before-commit, same
pattern as the inventory import fix).
"""
from __future__ import annotations
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from pydantic import BaseModel
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
import csv
import io


# ═══════════ Models ═══════════

class PlatformCreate(BaseModel):
    name: str
    platform_type: str = "marketplace"      # marketplace | custom_website | other
    seller_id: Optional[str] = ""
    store_url: Optional[str] = ""
    commission_pct: float = 0
    api_credentials_ref: Optional[str] = ""  # label only, never a raw secret
    onboarded_date: Optional[str] = None


class PlatformUpdate(BaseModel):
    name: Optional[str] = None
    platform_type: Optional[str] = None
    seller_id: Optional[str] = None
    store_url: Optional[str] = None
    commission_pct: Optional[float] = None
    api_credentials_ref: Optional[str] = None
    active: Optional[bool] = None


class ListingCreate(BaseModel):
    platform_id: str
    inventory_item_id: str
    platform_sku: str
    platform_listing_id: Optional[str] = ""
    listing_title: Optional[str] = ""
    listing_url: Optional[str] = ""
    listed_price: float
    platform_commission_pct: Optional[float] = None   # per-listing override of the platform default
    status: str = "draft"                              # draft|live|paused|delisted|out_of_stock
    category_on_platform: Optional[str] = ""
    images: Optional[List[str]] = []


class ListingUpdate(BaseModel):
    platform_sku: Optional[str] = None
    platform_listing_id: Optional[str] = None
    listing_title: Optional[str] = None
    listing_url: Optional[str] = None
    listed_price: Optional[float] = None
    platform_commission_pct: Optional[float] = None
    status: Optional[str] = None
    category_on_platform: Optional[str] = None
    images: Optional[List[str]] = None


class BulkStatusUpdate(BaseModel):
    listing_ids: List[str]
    status: str


class OrderLine(BaseModel):
    listing_id: Optional[str] = None
    inventory_item_id: str
    quantity: float
    sold_price: float


class OrderCreate(BaseModel):
    platform_id: str
    platform_order_id: str
    order_date: str
    customer_name_masked: Optional[str] = ""
    lines: List[OrderLine]
    shipping_cost: Optional[float] = 0
    payment_status: Optional[str] = "pending"
    order_status: Optional[str] = "placed"
    override_negative_stock: Optional[bool] = False


class OrderUpdate(BaseModel):
    payment_status: Optional[str] = None
    settlement_date: Optional[str] = None
    settlement_reference: Optional[str] = None
    net_payout: Optional[float] = None
    order_status: Optional[str] = None
    return_reason: Optional[str] = None


class ImportCommitRow(BaseModel):
    platform_order_id: str
    order_date: str
    customer_name_masked: Optional[str] = ""
    inventory_item_id: str
    quantity: float
    sold_price: float
    shipping_cost: Optional[float] = 0


class ImportCommitRequest(BaseModel):
    platform_id: str
    rows: List[ImportCommitRow]


# ═══════════ Helpers ═══════════

def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _price_line(line: Dict[str, Any], commission_pct: float) -> Dict[str, Any]:
    qty = float(line.get("quantity") or 0)
    price = float(line.get("sold_price") or 0)
    gross = qty * price
    commission = round(gross * commission_pct / 100, 2)
    line["commission_amount"] = commission
    line["net_amount"] = round(gross - commission, 2)
    return line


async def _decrement_stock(db, lines, order_id, override):
    movements = []
    now = _now()
    for line in lines:
        item_id = line.get("inventory_item_id")
        if not item_id:
            continue
        item = await db.inventory_items.find_one({"_id": ObjectId(item_id)})
        if not item:
            raise HTTPException(status_code=400, detail=f"Inventory item {item_id} not found")
        available = item.get("quantity", 0)
        needed = float(line.get("quantity") or 0)
        if available < needed and not override:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {item.get('name')}: available {available}, needed {needed}")
        await db.inventory_items.update_one({"_id": ObjectId(item_id)}, {"$inc": {"quantity": -needed}})
        movements.append({
            "inventory_item_id": item_id, "movement_type": "ecommerce_sale_out", "quantity": -needed,
            "reference_type": "ecommerce_order", "reference_id": order_id,
            "note": f"Ecommerce order line: {item.get('name')}", "created_at": now,
        })
    if movements:
        await db.inventory_movements.insert_many(movements)


async def _restore_stock(db, lines, order_id):
    movements = []
    now = _now()
    for line in lines:
        item_id = line.get("inventory_item_id")
        if not item_id:
            continue
        qty = float(line.get("quantity") or 0)
        await db.inventory_items.update_one({"_id": ObjectId(item_id)}, {"$inc": {"quantity": qty}})
        movements.append({
            "inventory_item_id": item_id, "movement_type": "ecommerce_return_in", "quantity": qty,
            "reference_type": "ecommerce_order_return", "reference_id": order_id,
            "note": "Ecommerce order returned/cancelled", "created_at": now,
        })
    if movements:
        await db.inventory_movements.insert_many(movements)


# Common Amazon / Flipkart order-report column name variants we try to map.
COLUMN_ALIASES = {
    "platform_order_id": ["order id", "order-id", "amazon-order-id", "order_id", "orderid"],
    "order_date": ["order date", "purchase-date", "order_date", "date"],
    "sku": ["sku", "seller-sku", "sku code"],
    "quantity": ["quantity", "qty", "quantity-purchased", "units"],
    "sold_price": ["item price", "unit price", "item-price", "selling price", "price"],
    "shipping_cost": ["shipping price", "shipping-price", "shipping cost"],
    "customer": ["buyer name", "customer name", "ship-to-name"],
}


def _map_csv_row(row: Dict[str, str]) -> Dict[str, Any]:
    lower = {k.strip().lower(): v for k, v in row.items()}
    out = {}
    for field, aliases in COLUMN_ALIASES.items():
        for a in aliases:
            if a in lower:
                out[field] = lower[a]
                break
    return out


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    # ── Platforms ──
    @router.get("/ecommerce/platforms")
    async def list_platforms(request: Request):
        await get_current_user(request)
        docs = await db.ecommerce_platforms.find({"active": {"$ne": False}}).sort("name", 1).to_list(200)
        return [_clean(d) for d in docs]

    @router.post("/ecommerce/platforms")
    async def create_platform(payload: PlatformCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        doc = payload.dict()
        doc["active"] = True
        doc["onboarded_date"] = doc.get("onboarded_date") or _now()[:10]
        doc["created_at"] = _now()
        result = await db.ecommerce_platforms.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "create", "ecommerce_platform", str(result.inserted_id), None, {"name": doc["name"]})
        return _clean({**doc, "_id": result.inserted_id})

    @router.put("/ecommerce/platforms/{platform_id}")
    async def update_platform(platform_id: str, payload: PlatformUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            oid = ObjectId(platform_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid platform id")
        existing = await db.ecommerce_platforms.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Platform not found")
        update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
        update["updated_at"] = _now()
        await db.ecommerce_platforms.update_one({"_id": oid}, {"$set": update})
        await create_audit_log(user["id"], user["name"], "update", "ecommerce_platform", platform_id, _clean(existing), update)
        return _clean(await db.ecommerce_platforms.find_one({"_id": oid}))

    @router.delete("/ecommerce/platforms/{platform_id}")
    async def delete_platform(platform_id: str, request: Request):
        user = await require_role("admin")(request)
        try:
            oid = ObjectId(platform_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid platform id")
        await db.ecommerce_platforms.update_one({"_id": oid}, {"$set": {"active": False}})
        await create_audit_log(user["id"], user["name"], "delete", "ecommerce_platform", platform_id)
        return {"message": "Platform archived"}

    # ── Listings ──
    @router.get("/ecommerce/listings")
    async def list_listings(request: Request, platform_id: Optional[str] = None, status: Optional[str] = None, search: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {}
        if platform_id: q["platform_id"] = platform_id
        if status: q["status"] = status
        if search:
            q["$or"] = [{"listing_title": {"$regex": search, "$options": "i"}}, {"platform_sku": {"$regex": search, "$options": "i"}}]
        docs = await db.ecommerce_listings.find(q).sort("updated_at", -1).to_list(5000)
        platforms = {str(p["_id"]): p["name"] for p in await db.ecommerce_platforms.find({}).to_list(200)}
        items = {str(i["_id"]): i for i in await db.inventory_items.find({}).to_list(5000)}
        out = []
        for d in docs:
            row = _clean(d)
            row["platform_name"] = platforms.get(d.get("platform_id"), "—")
            item = items.get(d.get("inventory_item_id"), {})
            row["item_name"] = item.get("name", "—")
            row["stock_available"] = item.get("quantity", 0)
            out.append(row)
        return out

    @router.post("/ecommerce/listings")
    async def create_listing(payload: ListingCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        item = await db.inventory_items.find_one({"_id": ObjectId(payload.inventory_item_id)})
        if not item:
            raise HTTPException(status_code=400, detail="Inventory item not found")
        # Iter 47 — every listing must carry its OWN commission rate before it can go live.
        # Platform's rate is reference-only, never auto-copied.
        if payload.status == "live" and payload.platform_commission_pct is None:
            raise HTTPException(
                status_code=400,
                detail="A commission % must be set on this listing before it can go live — platform's rate is a reference only.",
            )
        doc = payload.dict()
        now = _now()
        doc["created_at"] = now; doc["updated_at"] = now; doc["last_synced_at"] = None
        result = await db.ecommerce_listings.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "create", "ecommerce_listing", str(result.inserted_id), None, {"sku": doc["platform_sku"]})
        return _clean({**doc, "_id": result.inserted_id})

    @router.put("/ecommerce/listings/{listing_id}")
    async def update_listing(listing_id: str, payload: ListingUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            oid = ObjectId(listing_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid listing id")
        existing = await db.ecommerce_listings.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Listing not found")
        update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
        # Guard: moving a listing to 'live' requires its own commission
        target_status = update.get("status", existing.get("status"))
        effective_commission = update.get("platform_commission_pct", existing.get("platform_commission_pct"))
        if target_status == "live" and effective_commission is None:
            raise HTTPException(
                status_code=400,
                detail="A commission % must be set on this listing before it can go live — platform's rate is a reference only.",
            )
        update["updated_at"] = _now()
        await db.ecommerce_listings.update_one({"_id": oid}, {"$set": update})
        await create_audit_log(user["id"], user["name"], "update", "ecommerce_listing", listing_id, _clean(existing), update)
        return _clean(await db.ecommerce_listings.find_one({"_id": oid}))

    @router.post("/ecommerce/listings/bulk-status")
    async def bulk_update_status(payload: BulkStatusUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        oids = [ObjectId(i) for i in payload.listing_ids if ObjectId.is_valid(i)]
        # Iter 47: same rule as single-listing update — a listing must carry its own commission
        # before going live. Bulk moves that would flip a null-commission listing to 'live' are rejected.
        if payload.status == "live":
            offenders = await db.ecommerce_listings.find(
                {"_id": {"$in": oids}, "platform_commission_pct": None}
            ).to_list(500)
            if offenders:
                skus = [o.get("platform_sku") or str(o["_id"]) for o in offenders]
                raise HTTPException(
                    status_code=400,
                    detail=f"These listings have no commission % set and cannot go live: {', '.join(skus)}. Set each listing's commission first.",
                )
        res = await db.ecommerce_listings.update_many({"_id": {"$in": oids}}, {"$set": {"status": payload.status, "updated_at": _now()}})
        await create_audit_log(user["id"], user["name"], "update", "ecommerce_listing_bulk", ",".join(payload.listing_ids), None, {"status": payload.status})
        return {"updated": res.modified_count}

    @router.delete("/ecommerce/listings/{listing_id}")
    async def delete_listing(listing_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        await db.ecommerce_listings.update_one({"_id": ObjectId(listing_id)}, {"$set": {"status": "delisted", "updated_at": _now()}})
        await create_audit_log(user["id"], user["name"], "delete", "ecommerce_listing", listing_id)
        return {"message": "Listing delisted"}

    # ── Orders ──
    async def _effective_commission_pct(platform: Dict[str, Any], listing: Optional[Dict[str, Any]]) -> float:
        if listing and listing.get("platform_commission_pct") is not None:
            return listing["platform_commission_pct"]
        return platform.get("commission_pct", 0) or 0

    @router.get("/ecommerce/orders")
    async def list_orders(request: Request, platform_id: Optional[str] = None, order_status: Optional[str] = None,
                           date_from: Optional[str] = None, date_to: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {}
        if platform_id: q["platform_id"] = platform_id
        if order_status: q["order_status"] = order_status
        if date_from or date_to:
            q["order_date"] = {}
            if date_from: q["order_date"]["$gte"] = date_from
            if date_to: q["order_date"]["$lte"] = date_to
        docs = await db.ecommerce_orders.find(q).sort("order_date", -1).to_list(5000)
        platforms = {str(p["_id"]): p["name"] for p in await db.ecommerce_platforms.find({}).to_list(200)}
        out = []
        for d in docs:
            row = _clean(d)
            row["platform_name"] = platforms.get(d.get("platform_id"), "—")
            out.append(row)
        return out

    @router.post("/ecommerce/orders")
    async def create_order(payload: OrderCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        platform = await db.ecommerce_platforms.find_one({"_id": ObjectId(payload.platform_id)})
        if not platform:
            raise HTTPException(status_code=400, detail="Platform not found")
        existing = await db.ecommerce_orders.find_one({"platform_id": payload.platform_id, "platform_order_id": payload.platform_order_id})
        if existing:
            raise HTTPException(status_code=400, detail="This platform order id has already been recorded")

        lines = []
        for l in payload.lines:
            listing = await db.ecommerce_listings.find_one({"_id": ObjectId(l.listing_id)}) if l.listing_id and ObjectId.is_valid(l.listing_id) else None
            pct = await _effective_commission_pct(platform, listing)
            line = _price_line(l.dict(), pct)
            lines.append(line)

        order_id = ObjectId()
        await _decrement_stock(db, lines, str(order_id), payload.override_negative_stock)

        order_total = round(sum(l["quantity"] * l["sold_price"] for l in lines), 2)
        commission_total = round(sum(l["commission_amount"] for l in lines), 2)
        net_payout = round(order_total - commission_total - (payload.shipping_cost or 0), 2)

        doc = {
            "_id": order_id,
            "platform_id": payload.platform_id, "platform_order_id": payload.platform_order_id,
            "order_date": payload.order_date, "customer_name_masked": payload.customer_name_masked or "",
            "lines": lines, "order_total": order_total, "commission_total": commission_total,
            "shipping_cost": payload.shipping_cost or 0, "net_payout": net_payout,
            "payment_status": payload.payment_status or "pending", "settlement_date": None, "settlement_reference": None,
            "order_status": payload.order_status or "placed", "return_reason": None,
            "created_at": _now(),
        }
        await db.ecommerce_orders.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "create", "ecommerce_order", str(order_id), None,
                                {"platform_order_id": doc["platform_order_id"], "order_total": order_total})
        return _clean(doc)

    @router.put("/ecommerce/orders/{order_id}")
    async def update_order(order_id: str, payload: OrderUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        try:
            oid = ObjectId(order_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid order id")
        existing = await db.ecommerce_orders.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Order not found")
        update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
        was_active = existing.get("order_status") not in ("returned", "cancelled", "refunded")
        now_inactive = update.get("order_status") in ("returned", "cancelled", "refunded")
        if was_active and now_inactive:
            await _restore_stock(db, existing.get("lines", []), order_id)
        if update.get("payment_status") == "settled" and not update.get("settlement_date"):
            update["settlement_date"] = _now()[:10]
        update["updated_at"] = _now()
        await db.ecommerce_orders.update_one({"_id": oid}, {"$set": update})
        await create_audit_log(user["id"], user["name"], "update", "ecommerce_order", order_id, _clean(existing), update)
        return _clean(await db.ecommerce_orders.find_one({"_id": oid}))

    @router.delete("/ecommerce/orders/{order_id}")
    async def delete_order(order_id: str, request: Request):
        user = await require_role("admin")(request)
        try:
            oid = ObjectId(order_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid order id")
        existing = await db.ecommerce_orders.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Order not found")
        if existing.get("order_status") not in ("returned", "cancelled", "refunded"):
            await _restore_stock(db, existing.get("lines", []), order_id)
        await db.ecommerce_orders.delete_one({"_id": oid})
        await create_audit_log(user["id"], user["name"], "delete", "ecommerce_order", order_id, _clean(existing), None)
        return {"message": "Order deleted and stock restored if it was still active"}

    # ── Reconciliation ──
    @router.get("/ecommerce/reconciliation")
    async def reconciliation(request: Request, platform_id: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {}
        if platform_id: q["platform_id"] = platform_id
        docs = await db.ecommerce_orders.find(q).sort("order_date", -1).to_list(5000)
        platforms = {str(p["_id"]): p["name"] for p in await db.ecommerce_platforms.find({}).to_list(200)}
        rows = []
        for d in docs:
            expected = round((d.get("order_total", 0) or 0) - (d.get("commission_total", 0) or 0) - (d.get("shipping_cost", 0) or 0), 2)
            actual = d.get("net_payout")
            mismatch = d.get("payment_status") == "settled" and actual is not None and abs(actual - expected) > 1
            rows.append({
                "id": str(d["_id"]), "platform_name": platforms.get(d.get("platform_id"), "—"),
                "platform_order_id": d.get("platform_order_id"), "order_date": d.get("order_date"),
                "expected_payout": expected, "actual_payout": actual, "payment_status": d.get("payment_status"),
                "mismatch": mismatch, "difference": round((actual or 0) - expected, 2) if actual is not None else None,
            })
        return {"rows": rows, "mismatch_count": sum(1 for r in rows if r["mismatch"])}

    # ── CSV import (preview-before-commit, matches the inventory import pattern) ──
    @router.post("/ecommerce/orders/import-preview")
    async def import_preview(request: Request, platform_id: str, file: UploadFile = File(...)):
        await require_role("admin", "manager")(request)
        content = (await file.read()).decode("utf-8-sig", errors="ignore")
        reader = csv.DictReader(io.StringIO(content))
        items = await db.inventory_items.find({}).to_list(5000)
        sku_map = {i.get("sku_code", "").upper(): i for i in items if i.get("sku_code")}
        listings = await db.ecommerce_listings.find({"platform_id": platform_id}).to_list(5000)
        listing_sku_map = {l.get("platform_sku", "").upper(): l for l in listings if l.get("platform_sku")}
        preview = []
        for raw in reader:
            mapped = _map_csv_row(raw)
            sku = (mapped.get("sku") or "").upper()
            listing = listing_sku_map.get(sku)
            inv_item = sku_map.get(sku) or (next((i for i in items if str(i["_id"]) == listing.get("inventory_item_id")), None) if listing else None)
            row = {
                "platform_order_id": mapped.get("platform_order_id", ""),
                "order_date": mapped.get("order_date", "")[:10] if mapped.get("order_date") else "",
                "customer_name_masked": mapped.get("customer", ""),
                "sku": sku,
                "inventory_item_id": str(inv_item["_id"]) if inv_item else None,
                "item_name": inv_item.get("name") if inv_item else None,
                "quantity": float(mapped.get("quantity") or 1),
                "sold_price": float(str(mapped.get("sold_price") or 0).replace(",", "")),
                "shipping_cost": float(str(mapped.get("shipping_cost") or 0).replace(",", "")),
                "matched": bool(inv_item),
                "raw": raw,
            }
            preview.append(row)
        return {"platform_id": platform_id, "rows": preview, "matched_count": sum(1 for r in preview if r["matched"]), "total_count": len(preview)}

    @router.post("/ecommerce/orders/import-commit")
    async def import_commit(payload: ImportCommitRequest, request: Request):
        user = await require_role("admin", "manager")(request)
        platform = await db.ecommerce_platforms.find_one({"_id": ObjectId(payload.platform_id)})
        if not platform:
            raise HTTPException(status_code=400, detail="Platform not found")
        created, skipped = [], []
        for row in payload.rows:
            existing = await db.ecommerce_orders.find_one({"platform_id": payload.platform_id, "platform_order_id": row.platform_order_id})
            if existing:
                skipped.append(row.platform_order_id)
                continue
            listing = await db.ecommerce_listings.find_one({"platform_id": payload.platform_id, "inventory_item_id": row.inventory_item_id})
            pct = await _effective_commission_pct(platform, listing)
            line = _price_line({"listing_id": str(listing["_id"]) if listing else None, "inventory_item_id": row.inventory_item_id,
                                 "quantity": row.quantity, "sold_price": row.sold_price}, pct)
            order_id = ObjectId()
            await _decrement_stock(db, [line], str(order_id), False)
            order_total = round(line["quantity"] * line["sold_price"], 2)
            doc = {
                "_id": order_id,
                "platform_id": payload.platform_id, "platform_order_id": row.platform_order_id,
                "order_date": row.order_date, "customer_name_masked": row.customer_name_masked or "",
                "lines": [line], "order_total": order_total, "commission_total": line["commission_amount"],
                "shipping_cost": row.shipping_cost or 0,
                "net_payout": round(order_total - line["commission_amount"] - (row.shipping_cost or 0), 2),
                "payment_status": "pending", "settlement_date": None, "settlement_reference": None,
                "order_status": "placed", "return_reason": None, "created_at": _now(),
            }
            await db.ecommerce_orders.insert_one(doc)
            created.append(str(order_id))
        await create_audit_log(user["id"], user["name"], "create", "ecommerce_order_import", payload.platform_id, None,
                                {"created": len(created), "skipped": len(skipped)})
        return {"created": len(created), "skipped_duplicates": skipped}

    return router
