"""Direct Sales module — counter/B2B/online sales of individual inventory items.

Ships with:
  - Sale + line-item Pydantic models
  - Atomic stock decrement using `$inc` (rejects negative stock unless override)
  - Inventory movement writer (`inventory_movements` collection, shared with
    PurchaseInbound / DeliveryOutbound)
  - Cost-snapshot per line so historical margin never shifts
  - Sales-return that restores stock and reverses movements
  - Payment recording (multi-installment)
  - Slab-aware GST split (CGST/SGST vs IGST) based on customer_state vs company_state
"""
from __future__ import annotations
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from locations import location_scope_filter


# ═══════════ Models ═══════════

class SaleLine(BaseModel):
    inventory_item_id: Optional[str] = None
    name: str
    sku_code: Optional[str] = None
    category: Optional[str] = None
    hsn_code: Optional[str] = None
    quantity: float
    unit: Optional[str] = "no"
    unit_price: float
    cost_price: Optional[float] = 0     # snapshot at sale time
    discount_pct: Optional[float] = 0
    discount_amount: Optional[float] = 0
    gst_percentage: Optional[float] = 18
    gst_amount: Optional[float] = 0
    line_total: Optional[float] = 0
    margin_amount: Optional[float] = 0
    margin_pct: Optional[float] = 0
    serial_numbers: Optional[List[str]] = []


class SaleCustomer(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    state: Optional[str] = None
    gstin: Optional[str] = None
    is_registered: Optional[bool] = False
    existing_customer_id: Optional[str] = None


class SalePayment(BaseModel):
    date: Optional[str] = None
    mode: str  # cash|upi|card|bank|cheque
    amount: float
    reference: Optional[str] = None


class SaleCreate(BaseModel):
    sale_type: str = "counter"   # counter|b2b|online|service|amc
    customer: SaleCustomer
    linked_project_id: Optional[str] = None
    lead_source: Optional[str] = None   # matches marketing channel enum for CAC
    lines: List[SaleLine]
    discount_amount: Optional[float] = 0
    round_off: Optional[float] = 0
    payments: Optional[List[SalePayment]] = []
    delivery_mode: Optional[str] = "carried"   # carried|delivered
    warranty_months: Optional[int] = 0
    notes: Optional[str] = None
    override_negative_stock: Optional[bool] = False
    lead_source_campaign: Optional[str] = None
    location_id: Optional[str] = None


class SaleUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    delivery_mode: Optional[str] = None
    warranty_months: Optional[int] = None


class SaleFullEdit(BaseModel):
    """Full line-item edit — only the quantity/price DELTA vs the stored lines is applied to stock."""
    lines: List[SaleLine] = None
    customer: Optional[SaleCustomer] = None
    discount_amount: Optional[float] = None
    round_off: Optional[float] = None
    override_negative_stock: Optional[bool] = False
    admin_reason: Optional[str] = None


class SalePaymentAdd(BaseModel):
    mode: str
    amount: float
    reference: Optional[str] = None


class SaleReturn(BaseModel):
    reason: str
    lines: Optional[List[Dict[str, Any]]] = None  # partial return: [{line_index, quantity}]
    refund_amount: Optional[float] = 0
    refund_mode: Optional[str] = "cash"


# ═══════════ Utilities ═══════════

def _round(v):
    try: return round(float(v or 0), 2)
    except Exception: return 0


def _compute_line(line: dict) -> dict:
    qty = float(line.get("quantity") or 0)
    price = float(line.get("unit_price") or 0)
    disc_pct = float(line.get("discount_pct") or 0)
    disc_amt = float(line.get("discount_amount") or 0)
    gross = qty * price
    disc = disc_amt if disc_amt > 0 else gross * disc_pct / 100
    taxable = gross - disc
    gst_pct = float(line.get("gst_percentage") or 18)
    gst_amt = taxable * gst_pct / 100
    line_total = taxable + gst_amt
    cost = float(line.get("cost_price") or 0) * qty
    margin_amt = taxable - cost
    margin_pct = (margin_amt / taxable * 100) if taxable > 0 else 0
    line.update({
        "discount_amount": _round(disc),
        "gst_amount": _round(gst_amt),
        "line_total": _round(line_total),
        "margin_amount": _round(margin_amt),
        "margin_pct": _round(margin_pct),
    })
    return line


async def _generate_invoice_number(db, location_id: Optional[str] = None) -> str:
    """Location-scoped invoice numbering (Iter 43 Change 3a) — SOC-{branchCode}/FY/NNNN when the
    sale is tied to a location with a code, else the original global SOC/FY/NNNN series."""
    now = datetime.now(timezone.utc)
    yr = now.year % 100
    yr2 = (now.year + 1) % 100 if now.month >= 4 else yr
    yr_prev = yr - 1 if now.month < 4 else yr
    fy = f"{yr_prev:02d}-{yr2:02d}"
    prefix = "SOC"   # Sensoper Ops Counter
    if location_id:
        loc = await db.locations.find_one({"_id": ObjectId(location_id)})
        if loc and loc.get("code"):
            prefix = f"SOC-{loc['code']}"
    n = await db.sales.count_documents({"invoice_number": {"$regex": f"^{prefix}/{fy}/"}})
    return f"{prefix}/{fy}/{n+1:04d}"


async def apply_sale_cancellation(db, sale_id: str, actor_name: str = "admin"):
    """Restores stock + closes credit for a sale — used both by the direct DELETE (permitted users)
    and by the generic action-request approval flow (server.py's `_apply_action_request`)."""
    sale = await db.sales.find_one({"_id": ObjectId(sale_id)})
    if not sale or sale.get("status") in ("returned", "cancelled"):
        return
    now = datetime.now(timezone.utc).isoformat()
    await _restore_stock(db, sale.get("lines", []), sale_id, {"id": None, "name": actor_name})
    await db.sales.update_one({"_id": ObjectId(sale_id)}, {"$set": {
        "status": "cancelled", "cancelled_at": now, "cancelled_by": actor_name,
    }})
    await db.customer_credits.update_one(
        {"reference_type": "sale", "reference_id": sale_id},
        {"$set": {"balance": 0, "status": "cancelled"}}
    )


async def _decrement_stock(db, sale_lines, sale_id, override, user):
    """Atomically decrement stock for each line, refusing negative unless override."""
    movements = []
    now = datetime.now(timezone.utc).isoformat()
    for line in sale_lines:
        item_id = line.get("inventory_item_id")
        if not item_id: continue
        item = await db.inventory_items.find_one({"_id": ObjectId(item_id)})
        if not item:
            raise HTTPException(400, f"Inventory item {line.get('name')} not found")
        available = item.get("quantity", 0)
        needed = float(line.get("quantity") or 0)
        if available < needed and not override:
            raise HTTPException(400, f"Insufficient stock for {item.get('name')}: available {available}, needed {needed}")
        # Snapshot cost_price if not provided
        if not line.get("cost_price"):
            line["cost_price"] = item.get("unit_price", 0)
        # decrement
        await db.inventory_items.update_one({"_id": ObjectId(item_id)}, {"$inc": {"quantity": -needed}})
        movements.append({
            "inventory_item_id": item_id,
            "movement_type": "sale_out",
            "quantity": -needed,
            "reference_type": "sale",
            "reference_id": sale_id,
            "note": f"Sale line: {line.get('name')}",
            "created_by": user.get("id"),
            "created_at": now,
        })
    if movements:
        await db.inventory_movements.insert_many(movements)


async def _restore_stock(db, sale_lines, sale_id, user):
    now = datetime.now(timezone.utc).isoformat()
    movements = []
    for line in sale_lines:
        item_id = line.get("inventory_item_id")
        if not item_id: continue
        qty = float(line.get("quantity") or 0)
        await db.inventory_items.update_one({"_id": ObjectId(item_id)}, {"$inc": {"quantity": qty}})
        movements.append({
            "inventory_item_id": item_id,
            "movement_type": "sale_return",
            "quantity": qty,
            "reference_type": "sale_return",
            "reference_id": sale_id,
            "note": f"Return line: {line.get('name')}",
            "created_by": user.get("id"),
            "created_at": now,
        })
    if movements:
        await db.inventory_movements.insert_many(movements)


def _split_gst(taxable_lines, customer_state, company_state):
    """Compute CGST/SGST or IGST based on inter-state vs intra-state supply."""
    inter_state = (customer_state or "").strip().lower() != (company_state or "").strip().lower()
    cgst = sgst = igst = 0
    for l in taxable_lines:
        gst = float(l.get("gst_amount") or 0)
        if inter_state:
            igst += gst
        else:
            cgst += gst / 2
            sgst += gst / 2
    return _round(cgst), _round(sgst), _round(igst)


def _unify_customer_by_phone(db, customer, existing_customer_id):
    """Find or create a unified customer record keyed on phone."""
    # This is a co-routine helper caller-side; caller awaits.
    pass


# ═══════════ Router ═══════════

def create_router(db, get_current_user, require_role, generate_pdf=None, company_profile_fn=None, check_module_permission=None):
    """Factory returning an APIRouter mounted at /sales.
    `db`, `get_current_user`, `require_role` are injected from server.py so
    we don't pull them into a circular import.
    """
    router = APIRouter(prefix="/sales", tags=["sales"])

    async def _sale_out(doc):
        return {**{k: v for k, v in doc.items() if k != "_id"}, "id": str(doc["_id"])}

    @router.get("")
    async def list_sales(request: Request,
                         start: Optional[str] = None, end: Optional[str] = None,
                         sale_type: Optional[str] = None, payment_status: Optional[str] = None,
                         staff: Optional[str] = None, item: Optional[str] = None,
                         status: Optional[str] = None, limit: int = 200, location_id: Optional[str] = None):
        user = await get_current_user(request)
        query = {}
        loc_filter = location_scope_filter(user, location_id)
        if loc_filter: query.update(loc_filter)
        if start or end:
            query["sale_date"] = {}
            if start: query["sale_date"]["$gte"] = start
            if end: query["sale_date"]["$lte"] = end
        if sale_type: query["sale_type"] = sale_type
        if payment_status: query["payment_status"] = payment_status
        if staff: query["sold_by"] = staff
        if status: query["status"] = status
        if item: query["lines.name"] = {"$regex": item, "$options": "i"}
        docs = await db.sales.find(query).sort("created_at", -1).limit(limit).to_list(limit)
        return [await _sale_out(d) for d in docs]

    @router.get("/summary")
    async def sales_summary(request: Request, start: Optional[str] = None, end: Optional[str] = None):
        await get_current_user(request)
        # Compute default: last 30 days
        now = datetime.now(timezone.utc)
        if not start: start = (now - timedelta(days=30)).date().isoformat()
        if not end: end = now.date().isoformat()
        docs = await db.sales.find({
            "sale_date": {"$gte": start, "$lte": end},
            "status": {"$nin": ["cancelled", "returned"]}
        }).to_list(5000)
        total_revenue = sum(d.get("grand_total", 0) for d in docs)
        total_margin = sum(sum(l.get("margin_amount", 0) for l in (d.get("lines") or [])) for d in docs)
        total_units = sum(sum(l.get("quantity", 0) for l in (d.get("lines") or [])) for d in docs)
        by_type = {}
        by_channel = {}   # payment channel
        by_item = {}
        by_staff = {}
        for d in docs:
            st = d.get("sale_type", "counter")
            by_type[st] = by_type.get(st, 0) + d.get("grand_total", 0)
            for p in (d.get("payments") or []):
                by_channel[p.get("mode", "cash")] = by_channel.get(p.get("mode", "cash"), 0) + p.get("amount", 0)
            for l in (d.get("lines") or []):
                name = l.get("name", "?")
                if name not in by_item:
                    by_item[name] = {"units": 0, "revenue": 0, "margin": 0}
                by_item[name]["units"] += l.get("quantity", 0)
                by_item[name]["revenue"] += l.get("line_total", 0)
                by_item[name]["margin"] += l.get("margin_amount", 0)
            sb = d.get("sold_by_name", "?")
            by_staff[sb] = by_staff.get(sb, 0) + d.get("grand_total", 0)
        top_items = sorted(by_item.items(), key=lambda x: -x[1]["revenue"])[:15]
        return {
            "period_start": start, "period_end": end,
            "total_revenue": _round(total_revenue),
            "total_margin": _round(total_margin),
            "total_units": total_units,
            "sale_count": len(docs),
            "avg_ticket": _round(total_revenue / len(docs)) if docs else 0,
            "by_sale_type": by_type,
            "by_payment_mode": by_channel,
            "top_items": [{"name": k, **v} for k, v in top_items],
            "by_staff": by_staff,
        }

    @router.get("/{sale_id}")
    async def get_sale(sale_id: str, request: Request):
        await get_current_user(request)
        d = await db.sales.find_one({"_id": ObjectId(sale_id)})
        if not d: raise HTTPException(404, "Sale not found")
        return await _sale_out(d)

    @router.post("")
    async def create_sale(payload: SaleCreate, request: Request):
        user = await get_current_user(request)
        # Compute lines
        lines = [_compute_line(l.model_dump()) for l in payload.lines]

        location_id = payload.location_id or user.get("default_location_id")

        # Company state from profile → GST split (location-specific profile wins if one exists)
        profile = await company_profile_fn(location_id) if company_profile_fn else {}
        company_state = (profile or {}).get("state", "Tamil Nadu")

        subtotal = sum(float(l["quantity"]) * float(l["unit_price"]) for l in lines)
        total_line_discount = sum(l.get("discount_amount", 0) for l in lines)
        header_discount = payload.discount_amount or 0
        total_discount = total_line_discount + header_discount
        taxable_value = sum(float(l["quantity"]) * float(l["unit_price"]) - l.get("discount_amount", 0) for l in lines) - header_discount
        cgst, sgst, igst = _split_gst(lines, payload.customer.state, company_state)
        gst_total = sum(l.get("gst_amount", 0) for l in lines)
        grand_total = taxable_value + gst_total + (payload.round_off or 0)

        amount_paid = sum(p.amount for p in (payload.payments or []))
        payment_status = "paid" if amount_paid >= grand_total - 1 else "partial" if amount_paid > 0 else "credit"

        invoice_no = await _generate_invoice_number(db, location_id)
        now = datetime.now(timezone.utc).isoformat()
        sale_date = datetime.now(timezone.utc).date().isoformat()

        # Unified customer by phone
        unified_customer_id = payload.customer.existing_customer_id
        if not unified_customer_id and payload.customer.phone:
            existing = await db.customers.find_one({"phone": payload.customer.phone})
            if existing:
                unified_customer_id = str(existing["_id"])
            else:
                r = await db.customers.insert_one({
                    "name": payload.customer.name, "phone": payload.customer.phone,
                    "email": payload.customer.email, "gstin": payload.customer.gstin,
                    "first_touch_channel": payload.lead_source,
                    "first_touch_campaign": payload.lead_source_campaign,
                    "created_at": now, "source": "direct_sale"
                })
                unified_customer_id = str(r.inserted_id)

        doc = {
            "invoice_number": invoice_no,
            "sale_date": sale_date,
            "sale_type": payload.sale_type,
            "customer": {**payload.customer.model_dump(), "unified_customer_id": unified_customer_id},
            "linked_project_id": payload.linked_project_id,
            "location_id": location_id,
            "lead_source": payload.lead_source,
            "lead_source_campaign": payload.lead_source_campaign,
            "lines": lines,
            "subtotal": _round(subtotal),
            "total_discount": _round(total_discount),
            "taxable_value": _round(taxable_value),
            "cgst": cgst, "sgst": sgst, "igst": igst,
            "gst_total": _round(gst_total),
            "round_off": _round(payload.round_off or 0),
            "grand_total": _round(grand_total),
            "amount_paid": _round(amount_paid),
            "balance_due": _round(grand_total - amount_paid),
            "payment_status": payment_status,
            "payments": [p.model_dump() for p in (payload.payments or [])],
            "delivery_mode": payload.delivery_mode,
            "warranty_months": payload.warranty_months,
            "warranty_expiry": (datetime.now(timezone.utc) + timedelta(days=30 * (payload.warranty_months or 0))).date().isoformat() if payload.warranty_months else None,
            "sold_by": user.get("id"), "sold_by_name": user.get("full_name") or user.get("email"),
            "notes": payload.notes, "status": "confirmed",
            "created_at": now, "updated_at": now,
        }

        r = await db.sales.insert_one(doc)
        sale_id = str(r.inserted_id)

        # Stock decrement + movement trail (may raise → sale is deleted to keep DB consistent)
        try:
            await _decrement_stock(db, doc["lines"], sale_id, payload.override_negative_stock, user)
        except HTTPException:
            await db.sales.delete_one({"_id": r.inserted_id})
            raise

        # If credit, create customer_credit
        if payment_status in ("credit", "partial"):
            await db.customer_credits.insert_one({
                "customer_name": payload.customer.name,
                "customer_phone": payload.customer.phone,
                "unified_customer_id": unified_customer_id,
                "reference_type": "sale", "reference_id": sale_id,
                "invoice_number": invoice_no,
                "total_amount": doc["grand_total"],
                "paid_amount": doc["amount_paid"],
                "balance": doc["balance_due"],
                "status": "outstanding",
                "created_at": now,
            })

        return {"id": sale_id, "invoice_number": invoice_no, "grand_total": doc["grand_total"]}

    @router.post("/{sale_id}/payment")
    async def add_payment(sale_id: str, payload: SalePaymentAdd, request: Request):
        user = await get_current_user(request)
        sale = await db.sales.find_one({"_id": ObjectId(sale_id)})
        if not sale: raise HTTPException(404, "Sale not found")
        new_p = payload.model_dump()
        new_p["date"] = datetime.now(timezone.utc).isoformat()
        new_p["received_by"] = user.get("id")
        new_paid = sale.get("amount_paid", 0) + payload.amount
        new_balance = sale["grand_total"] - new_paid
        new_status = "paid" if new_paid >= sale["grand_total"] - 1 else "partial"
        await db.sales.update_one({"_id": ObjectId(sale_id)}, {
            "$push": {"payments": new_p},
            "$set": {"amount_paid": _round(new_paid), "balance_due": _round(new_balance),
                     "payment_status": new_status, "updated_at": new_p["date"]}
        })
        await db.customer_credits.update_one(
            {"reference_type": "sale", "reference_id": sale_id},
            {"$set": {"paid_amount": _round(new_paid), "balance": _round(new_balance),
                      "status": "closed" if new_balance <= 0 else "outstanding"}}
        )
        return {"balance_due": _round(new_balance), "payment_status": new_status}

    @router.post("/{sale_id}/return")
    async def return_sale(sale_id: str, payload: SaleReturn, request: Request):
        user = await require_role("admin", "manager")(request)
        sale = await db.sales.find_one({"_id": ObjectId(sale_id)})
        if not sale: raise HTTPException(404, "Sale not found")
        if sale.get("status") == "returned":
            raise HTTPException(400, "Sale already returned")
        # Full return for MVP
        lines_to_restore = sale["lines"]
        await _restore_stock(db, lines_to_restore, sale_id, user)
        await db.sales.update_one({"_id": ObjectId(sale_id)}, {"$set": {
            "status": "returned",
            "return_reason": payload.reason,
            "return_refund_amount": _round(payload.refund_amount or sale["grand_total"]),
            "return_refund_mode": payload.refund_mode,
            "returned_by": user.get("id"),
            "returned_at": datetime.now(timezone.utc).isoformat(),
        }})
        # Close any credit
        await db.customer_credits.update_one(
            {"reference_type": "sale", "reference_id": sale_id},
            {"$set": {"balance": 0, "status": "cancelled"}}
        )
        return {"message": "Sale returned; stock restored"}

    @router.put("/{sale_id}")
    async def update_sale(sale_id: str, payload: SaleUpdate, request: Request):
        await require_role("admin", "manager")(request)
        upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        upd["updated_at"] = datetime.now(timezone.utc).isoformat()
        r = await db.sales.update_one({"_id": ObjectId(sale_id)}, {"$set": upd})
        if r.matched_count == 0: raise HTTPException(404, "Sale not found")
        return {"message": "updated"}

    @router.put("/{sale_id}/edit")
    async def edit_sale(sale_id: str, payload: SaleFullEdit, request: Request):
        """Full line-item edit (Iter 43 Change 2c) — recomputes GST/totals and applies only the
        quantity DELTA per inventory item to stock, mirroring Inbound/Outbound/Assets edit logic."""
        user = await get_current_user(request)
        if check_module_permission and not await check_module_permission(user, "module_direct_sales", "edit"):
            raise HTTPException(403, "You don't have permission to edit sales")
        sale = await db.sales.find_one({"_id": ObjectId(sale_id)})
        if not sale: raise HTTPException(404, "Sale not found")
        if sale.get("status") in ("returned", "cancelled"):
            raise HTTPException(400, f"Cannot edit a sale that is '{sale.get('status')}'")

        now = datetime.now(timezone.utc).isoformat()
        old_lines = sale.get("lines", [])
        new_lines_in = payload.lines if payload.lines is not None else old_lines
        new_lines = [_compute_line(dict(l) if isinstance(l, dict) else l.model_dump()) for l in new_lines_in]

        # Delta per inventory_item_id: positive delta = more sold now = further stock decrement
        old_by_item: Dict[str, float] = {}
        for l in old_lines:
            iid = l.get("inventory_item_id")
            if iid: old_by_item[iid] = old_by_item.get(iid, 0) + float(l.get("quantity") or 0)
        new_by_item: Dict[str, float] = {}
        for l in new_lines:
            iid = l.get("inventory_item_id")
            if iid: new_by_item[iid] = new_by_item.get(iid, 0) + float(l.get("quantity") or 0)

        deltas = {}
        for iid in set(old_by_item) | set(new_by_item):
            d = new_by_item.get(iid, 0) - old_by_item.get(iid, 0)
            if d: deltas[iid] = d

        # Guard against negative stock before applying anything
        if not payload.override_negative_stock:
            for iid, d in deltas.items():
                if d > 0:
                    item = await db.inventory_items.find_one({"_id": ObjectId(iid)})
                    available = (item or {}).get("quantity", 0)
                    if available < d:
                        raise HTTPException(400, f"Insufficient stock for {(item or {}).get('name', iid)}: available {available}, need {d} more")

        movements = []
        for iid, d in deltas.items():
            await db.inventory_items.update_one({"_id": ObjectId(iid)}, {"$inc": {"quantity": -d}})
            movements.append({
                "inventory_item_id": iid, "movement_type": "sale_edit_adjustment",
                "quantity": -d, "reference_type": "sale", "reference_id": sale_id,
                "note": f"Sale edited: quantity adjusted by {d}", "created_by": user.get("id"), "created_at": now,
            })
        if movements:
            await db.inventory_movements.insert_many(movements)

        # Recompute totals
        customer = payload.customer.model_dump() if payload.customer else sale.get("customer", {})
        profile = await company_profile_fn(sale.get("location_id")) if company_profile_fn else {}
        company_state = (profile or {}).get("state", "Tamil Nadu")
        subtotal = sum(float(l["quantity"]) * float(l["unit_price"]) for l in new_lines)
        header_discount = payload.discount_amount if payload.discount_amount is not None else sale.get("total_discount", 0) - sum(l.get("discount_amount", 0) for l in new_lines)
        total_line_discount = sum(l.get("discount_amount", 0) for l in new_lines)
        taxable_value = sum(float(l["quantity"]) * float(l["unit_price"]) - l.get("discount_amount", 0) for l in new_lines) - header_discount
        cgst, sgst, igst = _split_gst(new_lines, customer.get("state"), company_state)
        gst_total = sum(l.get("gst_amount", 0) for l in new_lines)
        round_off = payload.round_off if payload.round_off is not None else sale.get("round_off", 0)
        grand_total = taxable_value + gst_total + round_off
        amount_paid = sale.get("amount_paid", 0)
        balance_due = grand_total - amount_paid
        payment_status = "paid" if amount_paid >= grand_total - 1 else "partial" if amount_paid > 0 else "credit"

        before = {"lines": old_lines, "grand_total": sale.get("grand_total")}
        update_fields = {
            "lines": new_lines, "customer": customer,
            "subtotal": _round(subtotal), "total_discount": _round(total_line_discount + header_discount),
            "taxable_value": _round(taxable_value), "cgst": cgst, "sgst": sgst, "igst": igst,
            "gst_total": _round(gst_total), "round_off": _round(round_off), "grand_total": _round(grand_total),
            "balance_due": _round(balance_due), "payment_status": payment_status,
            "edited": True, "edited_at": now, "edited_by": user.get("name"), "updated_at": now,
        }
        edit_entry = {"edited_by": user.get("name"), "edited_at": now, "before": before,
                      "after": {"lines": new_lines, "grand_total": update_fields["grand_total"]}, "deltas": deltas,
                      "reason": payload.admin_reason}
        await db.sales.update_one({"_id": ObjectId(sale_id)}, {"$set": update_fields, "$push": {"edit_history": edit_entry}})
        await db.customer_credits.update_one(
            {"reference_type": "sale", "reference_id": sale_id},
            {"$set": {"total_amount": update_fields["grand_total"], "balance": _round(balance_due),
                      "status": "closed" if balance_due <= 0 else "outstanding"}}
        )
        return {"message": "Sale updated", "deltas": deltas, "grand_total": update_fields["grand_total"]}

    @router.delete("/{sale_id}")
    async def delete_sale(sale_id: str, request: Request):
        """Cancel a wrongly-entered sale (distinct from a customer /return): restores full stock.
        Permission-gated, with an admin-approval queue fallback (Iter 43 Change 2)."""
        user = await get_current_user(request)
        sale = await db.sales.find_one({"_id": ObjectId(sale_id)})
        if not sale: raise HTTPException(404, "Sale not found")
        if sale.get("status") in ("returned", "cancelled"):
            raise HTTPException(400, f"Sale is already '{sale.get('status')}'")

        can_delete = True if user.get("role") == "admin" else (await check_module_permission(user, "module_direct_sales", "delete") if check_module_permission else False)
        now = datetime.now(timezone.utc).isoformat()
        if not can_delete:
            existing = await db.action_requests.find_one({"resource_type": "sale", "resource_id": sale_id, "status": "pending"})
            if existing:
                return {"status": "pending_approval", "message": "A cancellation request for this sale is already awaiting admin approval"}
            await db.action_requests.insert_one({
                "resource_type": "sale", "resource_id": sale_id, "action": "cancel",
                "requested_by": user["id"], "requested_by_name": user["name"],
                "status": "pending", "requested_at": now, "location_id": sale.get("location_id"),
                "snapshot": {"invoice_number": sale.get("invoice_number"), "grand_total": sale.get("grand_total")},
            })
            return {"status": "pending_approval", "message": "You don't have permission to cancel this sale — request sent to an admin for approval"}

        await apply_sale_cancellation(db, sale_id, user.get("name", "admin"))
        return {"status": "cancelled", "message": "Sale cancelled; stock restored"}

    @router.get("/{sale_id}/invoice")
    async def get_invoice_pdf(sale_id: str, request: Request):
        """GST invoice PDF — reuses the existing PDF helper if available.
        For MVP returns invoice HTML preview payload; frontend jsPDF prints."""
        await get_current_user(request)
        sale = await db.sales.find_one({"_id": ObjectId(sale_id)})
        if not sale: raise HTTPException(404, "Sale not found")
        profile = await company_profile_fn() if company_profile_fn else {}
        return {"sale": await _sale_out(sale), "company_profile": profile}

    return router
