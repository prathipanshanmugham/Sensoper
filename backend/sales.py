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
import math
import re
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from locations import location_scope_filter, location_allowed

MAX_QTY = 1_000_000          # per line — more than this is a typing slip, not a sale
MAX_PRICE = 1_000_000_000    # ₹100 crore a unit


def _ist_now() -> datetime:
    """India time (sale dates, invoice financial year): a sale at 00:30 IST belongs to that day, not the UTC day before."""
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


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


async def _with_costs(db, lines: List[dict]) -> List[dict]:
    """Copy the stock item's cost onto lines that don't carry one, before margins are worked out
    (otherwise a missing cost reads as a 100% margin)."""
    for ln in lines:
        if not float(ln.get("cost_price") or 0) and ln.get("inventory_item_id") and ObjectId.is_valid(str(ln.get("inventory_item_id"))):
            it = await db.inventory_items.find_one({"_id": ObjectId(str(ln["inventory_item_id"]))}, {"unit_price": 1})
            if it and float(it.get("unit_price") or 0) > 0:
                ln["cost_price"] = float(it["unit_price"])
    return lines


async def backfill_missing_costs(db) -> int:
    """One-time repair: sales saved before costs were copied in show a 100% margin. Fill the cost from the
    linked stock item (its current cost) and work the margin out again. Only lines with no cost are touched."""
    fixed = 0
    async for sale in db.sales.find({"lines": {"$elemMatch": {"inventory_item_id": {"$nin": [None, ""]}, "$or": [{"cost_price": 0}, {"cost_price": None}, {"cost_price": {"$exists": False}}]}}}):
        lines = [dict(l) for l in sale.get("lines") or []]
        before = [float(l.get("cost_price") or 0) for l in lines]
        await _with_costs(db, lines)
        if [float(l.get("cost_price") or 0) for l in lines] == before:
            continue
        lines = [_compute_line({**l, "cost_filled_later": True} if float(l.get("cost_price") or 0) != b else l) for l, b in zip(lines, before)]
        await db.sales.update_one({"_id": sale["_id"]}, {"$set": {"lines": lines}})
        fixed += 1
    return fixed


def _gst_pct(line: dict) -> float:
    """The line's GST %. 0 is a real rate (exempt / nil-rated goods) — only a missing rate means the usual 18%."""
    v = line.get("gst_percentage")
    return 18.0 if v in (None, "") else float(v)


def _compute_line(line: dict) -> dict:
    qty = float(line.get("quantity") or 0)
    price = float(line.get("unit_price") or 0)
    disc_pct = float(line.get("discount_pct") or 0)
    disc_amt = float(line.get("discount_amount") or 0)
    bill_disc = float(line.get("bill_discount") or 0)   # this line's share of a discount on the whole bill
    gross = qty * price
    disc = disc_amt if disc_amt > 0 else gross * disc_pct / 100
    taxable = gross - disc - bill_disc
    gst_pct = _gst_pct(line)
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
    if bill_disc or "bill_discount" in line:
        line["bill_discount"] = _round(bill_disc)
    return line


def _finite(v) -> bool:
    try:
        return math.isfinite(float(v or 0))
    except (TypeError, ValueError):
        return False


def _check_lines(lines: List[dict]) -> None:
    """Refuse lines that would put stock or the bill wrong: no items, zero/negative quantities, negative prices,
    discounts beyond the line's value, GST outside 0–100 %, or numbers too large to be real."""
    if not lines:
        raise HTTPException(400, "Add at least one item to the sale")
    for ln in lines:
        name = ln.get("name") or "an item"
        if not all(_finite(ln.get(k)) for k in ("quantity", "unit_price", "discount_pct", "discount_amount", "gst_percentage", "cost_price")):
            raise HTTPException(400, f"{name}: enter the quantity, price, discount and GST as plain numbers")
        qty, price = float(ln.get("quantity") or 0), float(ln.get("unit_price") or 0)
        if qty <= 0:
            raise HTTPException(400, f"{name}: the quantity must be more than 0")
        if qty > MAX_QTY or price > MAX_PRICE:
            raise HTTPException(400, f"{name}: that quantity or price is too large — check for a typing slip")
        if price < 0 or float(ln.get("cost_price") or 0) < 0:
            raise HTTPException(400, f"{name}: the price can't be negative")
        pct = float(ln.get("discount_pct") or 0)
        if not 0 <= pct <= 100:
            raise HTTPException(400, f"{name}: the discount must be between 0 and 100%")
        d_amt = float(ln.get("discount_amount") or 0)
        if d_amt < 0 or d_amt > qty * price + 0.005:
            raise HTTPException(400, f"{name}: the discount can't be more than the line's value")
        if not 0 <= _gst_pct(ln) <= 100:
            raise HTTPException(400, f"{name}: GST must be between 0 and 100%")


def _price_lines(lines: List[dict], header_discount: float = 0.0) -> List[dict]:
    """Work every line out, spreading a discount on the whole bill over the lines by value, so GST is charged on
    the discounted price (a bill discount lowers the taxable value — GST on the undiscounted price over-charges)."""
    hd = float(header_discount or 0)
    if not _finite(hd) or hd < 0:
        raise HTTPException(400, "The bill discount can't be negative")
    base = []
    for ln in lines:
        ln.pop("bill_discount", None)
        _compute_line(ln)
        base.append(max(float(ln["quantity"]) * float(ln["unit_price"]) - float(ln.get("discount_amount") or 0), 0.0))
    total = sum(base)
    if hd > total + 0.005:
        raise HTTPException(400, f"The bill discount (₹{hd:,.2f}) is more than the items' value (₹{total:,.2f})")
    if hd > 0 and total > 0:
        shares = [round(hd * b / total, 2) for b in base]
        big = max(range(len(base)), key=lambda i: base[i])
        shares[big] = round(shares[big] + round(hd - sum(shares), 2), 2)   # paise left over go on the biggest line
        for ln, s in zip(lines, shares):
            ln["bill_discount"] = s
            _compute_line(ln)
    return lines


def _sale_totals(lines: List[dict], round_off: float, customer_state: Optional[str], company_state: Optional[str]) -> Dict[str, float]:
    if not _finite(round_off):
        raise HTTPException(400, "The round-off must be a plain number")
    subtotal = sum(float(l["quantity"]) * float(l["unit_price"]) for l in lines)
    line_disc = sum(float(l.get("discount_amount") or 0) for l in lines)
    bill_disc = sum(float(l.get("bill_discount") or 0) for l in lines)
    taxable = subtotal - line_disc - bill_disc
    cgst, sgst, igst = _split_gst(lines, customer_state, company_state)
    gst_total = _round(cgst + sgst + igst)
    grand = _round(_round(taxable) + gst_total + float(round_off or 0))
    if grand < 0:
        raise HTTPException(400, "The bill total can't be below zero — check the discount and round-off")
    return {"subtotal": _round(subtotal), "line_discount": _round(line_disc), "header_discount": _round(bill_disc),
            "total_discount": _round(line_disc + bill_disc), "taxable_value": _round(taxable),
            "cgst": cgst, "sgst": sgst, "igst": igst, "gst_total": gst_total, "grand_total": grand}


async def _generate_invoice_number(db, location_id: Optional[str] = None) -> str:
    """Location-scoped invoice numbering (Iter 43 Change 3a) — SOC-{branchCode}/FY/NNNN when the
    sale is tied to a location with a code, else the original global SOC/FY/NNNN series."""
    now = _ist_now()   # the financial year turns at midnight IST on 1 April
    start = now.year if now.month >= 4 else now.year - 1
    fy = f"{start % 100:02d}-{(start + 1) % 100:02d}"
    prefix = "SOC"   # Sensoper Ops Counter
    if location_id and ObjectId.is_valid(str(location_id)):
        loc = await db.locations.find_one({"_id": ObjectId(location_id)})
        if loc and loc.get("code"):
            prefix = f"SOC-{loc['code']}"
    # A counter, not "how many sales exist + 1": after a sale is hard-deleted the count drops and the next sale
    # would reuse the newest invoice number. The counter starts from the existing count the first time.
    key = f"sale_invoice:{prefix}/{fy}"
    if not await db.counters.find_one({"_id": key}):
        n = await db.sales.count_documents({"invoice_number": {"$regex": f"^{re.escape(prefix)}/{re.escape(fy)}/"}})
        try:
            await db.counters.insert_one({"_id": key, "seq": n})
        except DuplicateKeyError:
            pass
    doc = await db.counters.find_one_and_update({"_id": key}, {"$inc": {"seq": 1}}, return_document=ReturnDocument.AFTER)
    return f"{prefix}/{fy}/{int(doc['seq']):04d}"


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


async def record_sale_payment(db, sale: dict, payment: dict) -> dict:
    """One payment against a direct sale. The sale and its credit record move together — the Sales page and the
    Credits page both take payments, and each must see the other's. Refuses a payment on a cancelled or returned
    sale and more than is still due."""
    if sale.get("status") in ("returned", "cancelled"):
        raise HTTPException(400, f"This sale is {sale['status']} — no payment is due on it")
    amount = float(payment["amount"])
    paid_before = float(sale.get("amount_paid") or 0)
    grand = float(sale.get("grand_total") or 0)
    due = _round(grand - paid_before)
    if amount > due + 1:
        raise HTTPException(400, f"₹{amount:,.2f} is more than the ₹{max(due, 0):,.2f} still due on this sale")
    sid = str(sale["_id"])
    now = datetime.now(timezone.utc).isoformat()
    new_p = {"mode": payment.get("mode") or "cash", "amount": _round(amount), "reference": payment.get("reference"),
             "date": now, "received_by": payment.get("received_by")}
    new_paid = _round(paid_before + amount)
    new_balance = _round(grand - new_paid)
    new_status = "paid" if new_paid >= grand - 1 else "partial"
    r = await db.sales.update_one({"_id": sale["_id"], "amount_paid": sale.get("amount_paid")}, {
        "$push": {"payments": new_p},
        "$set": {"amount_paid": new_paid, "balance_due": new_balance, "payment_status": new_status, "updated_at": now}})
    if r.matched_count == 0:   # another payment landed at the same moment — don't overwrite it
        raise HTTPException(409, "This sale was just updated by someone else — reload it and record the payment again")
    await db.customer_credits.update_one(
        {"reference_type": "sale", "reference_id": sid},
        {"$set": {"paid_amount": new_paid, "amount_paid": new_paid, "balance": max(new_balance, 0),
                  "status": "closed" if new_balance <= 0 else "outstanding"}})
    return {"balance_due": new_balance, "payment_status": new_status, "amount_paid": new_paid}


async def _check_stock(db, sale_lines, override):
    """Every stock item the lines use, with the total needed per item (two lines of one item count together).
    Raises before anything is changed if an item is missing or short."""
    need: Dict[str, float] = {}
    for line in sale_lines:
        item_id = line.get("inventory_item_id")
        if item_id:
            need[str(item_id)] = need.get(str(item_id), 0.0) + float(line.get("quantity") or 0)
    items: Dict[str, dict] = {}
    for item_id, needed in need.items():
        item = await db.inventory_items.find_one({"_id": ObjectId(item_id)}) if ObjectId.is_valid(item_id) else None
        if not item:
            name = next((l.get("name") for l in sale_lines if str(l.get("inventory_item_id")) == item_id), item_id)
            raise HTTPException(400, f"Inventory item {name} not found")
        available = item.get("quantity", 0) or 0
        if available < needed and not override:
            raise HTTPException(400, f"Insufficient stock for {item.get('name')}: available {available}, needed {needed:g}")
        items[item_id] = item
    return need, items


async def _take_stock(db, need: Dict[str, float], override: bool, items: Dict[str, dict]) -> None:
    """Take the quantities off in one go per item; if another sale took the stock meanwhile, put back what was
    taken and refuse (so a refused sale never leaves stock reduced)."""
    done = []
    for item_id, qty in need.items():
        filt: Dict[str, Any] = {"_id": ObjectId(item_id)}
        if not override:
            filt["quantity"] = {"$gte": qty}
        r = await db.inventory_items.update_one(filt, {"$inc": {"quantity": -qty}})
        if r.matched_count == 0:
            for did, dq in done:
                await db.inventory_items.update_one({"_id": ObjectId(did)}, {"$inc": {"quantity": dq}})
            raise HTTPException(400, f"Insufficient stock for {(items.get(item_id) or {}).get('name', item_id)} — it was just used by another sale. Check the stock and try again.")
        done.append((item_id, qty))


async def _decrement_stock(db, sale_lines, sale_id, override, user):
    """Decrement stock for the sale, refusing negative unless override. All-or-nothing: nothing is taken unless
    every line can be."""
    movements = []
    now = datetime.now(timezone.utc).isoformat()
    need, items = await _check_stock(db, sale_lines, override)
    await _take_stock(db, need, override, items)
    for line in sale_lines:
        item_id = line.get("inventory_item_id")
        if not item_id: continue
        item = items[str(item_id)]
        needed = float(line.get("quantity") or 0)
        # Snapshot cost_price if not provided
        if not line.get("cost_price"):
            line["cost_price"] = item.get("unit_price", 0)
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
    total = _round(sum(float(l.get("gst_amount") or 0) for l in taxable_lines))
    if inter_state:
        return 0, 0, total
    cgst = _round(total / 2)
    return cgst, _round(total - cgst), 0   # SGST takes the odd paisa, so CGST + SGST is exactly the GST charged


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

    async def _sale_for(user, sale_id: str) -> dict:
        """The sale, if this user's branch may see it (another branch's sale reads as not found)."""
        sale = await db.sales.find_one({"_id": ObjectId(sale_id)})
        if not sale or not location_allowed(user, sale.get("location_id")):
            raise HTTPException(404, "Sale not found")
        return sale

    def _check_payment(amount: float) -> float:
        if not _finite(amount) or float(amount) <= 0:
            raise HTTPException(400, "The payment amount must be more than ₹0")
        if float(amount) > MAX_PRICE:
            raise HTTPException(400, "That payment amount is too large — check for a typing slip")
        return float(amount)

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
        if item: query["lines.name"] = {"$regex": re.escape(item), "$options": "i"}
        docs = await db.sales.find(query).sort("created_at", -1).limit(limit).to_list(limit)
        return [await _sale_out(d) for d in docs]

    @router.get("/summary")
    async def sales_summary(request: Request, start: Optional[str] = None, end: Optional[str] = None, location_id: Optional[str] = None):
        user = await get_current_user(request)
        # Compute default: last 30 days (India dates, like sale_date)
        now = _ist_now()
        if not start: start = (now - timedelta(days=30)).date().isoformat()
        if not end: end = now.date().isoformat()
        q: Dict[str, Any] = {"sale_date": {"$gte": start, "$lte": end}, "status": {"$nin": ["cancelled", "returned"]}}
        q.update(location_scope_filter(user, location_id))   # a branch sees its own takings, like the sales list
        docs = await db.sales.find(q).to_list(5000)
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
        user = await get_current_user(request)
        d = await _sale_for(user, sale_id)
        return await _sale_out(d)

    @router.post("")
    async def create_sale(payload: SaleCreate, request: Request):
        user = await get_current_user(request)
        raw_lines = [l.model_dump() for l in payload.lines]
        _check_lines(raw_lines)
        # Compute lines (stock cost first, so the margin is real)
        lines = _price_lines(await _with_costs(db, raw_lines), payload.discount_amount or 0)

        location_id = payload.location_id or user.get("default_location_id")
        if not location_allowed(user, location_id):
            raise HTTPException(403, "You can only record sales for your own branch")

        # Company state from profile → GST split (location-specific profile wins if one exists)
        profile = await company_profile_fn(location_id) if company_profile_fn else {}
        company_state = (profile or {}).get("state", "Tamil Nadu")

        t = _sale_totals(lines, payload.round_off or 0, payload.customer.state, company_state)
        grand_total = t["grand_total"]

        amount_paid = sum(_check_payment(p.amount) for p in (payload.payments or []))
        if amount_paid > grand_total + 1:
            raise HTTPException(400, f"The payments (₹{amount_paid:,.2f}) are more than the bill (₹{grand_total:,.2f})")
        payment_status = "paid" if amount_paid >= grand_total - 1 else "partial" if amount_paid > 0 else "credit"

        # Check stock before the invoice number is taken, so a refused sale doesn't leave a gap in the series
        await _check_stock(db, lines, payload.override_negative_stock)
        invoice_no = await _generate_invoice_number(db, location_id)
        now = datetime.now(timezone.utc).isoformat()
        sale_date = _ist_now().date().isoformat()

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
            "subtotal": t["subtotal"],
            "total_discount": t["total_discount"],
            "header_discount": t["header_discount"],
            "taxable_value": t["taxable_value"],
            "cgst": t["cgst"], "sgst": t["sgst"], "igst": t["igst"],
            "gst_total": t["gst_total"],
            "round_off": _round(payload.round_off or 0),
            "grand_total": grand_total,
            "amount_paid": _round(amount_paid),
            "balance_due": _round(grand_total - amount_paid),
            "payment_status": payment_status,
            "payments": [p.model_dump() for p in (payload.payments or [])],
            "delivery_mode": payload.delivery_mode,
            "warranty_months": payload.warranty_months,
            "warranty_expiry": (_ist_now() + timedelta(days=30 * (payload.warranty_months or 0))).date().isoformat() if payload.warranty_months else None,
            "sold_by": user.get("id"), "sold_by_name": user.get("name") or user.get("email"),
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
                "amount_paid": doc["amount_paid"],   # the Credits page reads amount_paid
                "balance": doc["balance_due"],
                "status": "outstanding",
                "location_id": location_id,
                "created_at": now,
            })

        return {"id": sale_id, "invoice_number": invoice_no, "grand_total": doc["grand_total"]}

    @router.post("/{sale_id}/payment")
    async def add_payment(sale_id: str, payload: SalePaymentAdd, request: Request):
        user = await get_current_user(request)
        if user["role"] != "admin" and check_module_permission and not await check_module_permission(user, "module_direct_sales", "edit"):
            raise HTTPException(status_code=403, detail="Permission denied: module_direct_sales.edit")
        sale = await _sale_for(user, sale_id)
        amount = _check_payment(payload.amount)
        out = await record_sale_payment(db, sale, {**payload.model_dump(), "amount": amount, "received_by": user.get("id")})
        return out

    @router.post("/{sale_id}/return")
    async def return_sale(sale_id: str, payload: SaleReturn, request: Request):
        user = await require_role("admin", "manager")(request)
        sale = await _sale_for(user, sale_id)
        if sale.get("status") in ("returned", "cancelled"):
            # a cancelled sale's stock is already back — returning it too would add the stock a second time
            raise HTTPException(400, "Sale already returned" if sale.get("status") == "returned" else "This sale was cancelled — its stock is already back")
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
        user = await require_role("admin", "manager")(request)
        sale = await _sale_for(user, sale_id)
        upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        if "status" in upd:
            # cancelling / returning puts stock back — only the Cancel and Return actions do that
            if upd["status"] in ("cancelled", "returned"):
                raise HTTPException(400, "Use Cancel or Return on the sale so its stock comes back")
            if sale.get("status") in ("cancelled", "returned"):
                raise HTTPException(400, f"This sale is {sale['status']} — record a new sale instead of reopening it")
        upd["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.sales.update_one({"_id": sale["_id"]}, {"$set": upd})
        return {"message": "updated"}

    @router.put("/{sale_id}/edit")
    async def edit_sale(sale_id: str, payload: SaleFullEdit, request: Request):
        """Full line-item edit (Iter 43 Change 2c) — recomputes GST/totals and applies only the
        quantity DELTA per inventory item to stock, mirroring Inbound/Outbound/Assets edit logic."""
        user = await get_current_user(request)
        if check_module_permission and not await check_module_permission(user, "module_direct_sales", "edit"):
            raise HTTPException(403, "You don't have permission to edit sales")
        sale = await _sale_for(user, sale_id)
        if sale.get("status") in ("returned", "cancelled"):
            raise HTTPException(400, f"Cannot edit a sale that is '{sale.get('status')}'")

        now = datetime.now(timezone.utc).isoformat()
        old_lines = sale.get("lines", [])
        new_lines_in = payload.lines if payload.lines is not None else old_lines
        raw_lines = [dict(l) if isinstance(l, dict) else l.model_dump() for l in new_lines_in]
        _check_lines(raw_lines)
        # The bill discount stays as it was unless a new one is given (older sales kept it only inside total_discount;
        # it used to be worked out from the NEW lines' discounts, so changing a line discount moved the bill discount)
        if payload.discount_amount is not None:
            header_discount = payload.discount_amount
        elif sale.get("header_discount") is not None:
            header_discount = sale["header_discount"]
        else:
            header_discount = max(float(sale.get("total_discount") or 0) - sum(float(l.get("discount_amount") or 0) for l in old_lines), 0.0)
        new_lines = _price_lines(await _with_costs(db, raw_lines), header_discount)

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
        items: Dict[str, dict] = {}
        for iid, d in deltas.items():
            item = await db.inventory_items.find_one({"_id": ObjectId(iid)}) if ObjectId.is_valid(str(iid)) else None
            if not item:
                raise HTTPException(400, f"Inventory item {iid} not found")
            items[iid] = item
            if d > 0 and not payload.override_negative_stock and (item.get("quantity", 0) or 0) < d:
                raise HTTPException(400, f"Insufficient stock for {item.get('name', iid)}: available {item.get('quantity', 0)}, need {d:g} more")

        # Recompute totals before touching stock, so a refused edit changes nothing
        customer = payload.customer.model_dump() if payload.customer else sale.get("customer", {})
        profile = await company_profile_fn(sale.get("location_id")) if company_profile_fn else {}
        company_state = (profile or {}).get("state", "Tamil Nadu")
        round_off = payload.round_off if payload.round_off is not None else sale.get("round_off", 0)
        t = _sale_totals(new_lines, round_off, customer.get("state"), company_state)
        grand_total = t["grand_total"]
        amount_paid = sale.get("amount_paid", 0)
        if amount_paid > grand_total + 1:
            raise HTTPException(400, f"₹{amount_paid:,.2f} has already been paid — the edited bill (₹{grand_total:,.2f}) can't be less than that")
        balance_due = grand_total - amount_paid
        payment_status = "paid" if amount_paid >= grand_total - 1 else "partial" if amount_paid > 0 else "credit"

        await _take_stock(db, {iid: d for iid, d in deltas.items() if d > 0}, payload.override_negative_stock, items)
        movements = []
        for iid, d in deltas.items():
            if d < 0:
                await db.inventory_items.update_one({"_id": ObjectId(iid)}, {"$inc": {"quantity": -d}})
            movements.append({
                "inventory_item_id": iid, "movement_type": "sale_edit_adjustment",
                "quantity": -d, "reference_type": "sale", "reference_id": sale_id,
                "note": f"Sale edited: quantity adjusted by {d}", "created_by": user.get("id"), "created_at": now,
            })
        if movements:
            await db.inventory_movements.insert_many(movements)

        before = {"lines": old_lines, "grand_total": sale.get("grand_total")}
        update_fields = {
            "lines": new_lines, "customer": customer,
            "subtotal": t["subtotal"], "total_discount": t["total_discount"], "header_discount": t["header_discount"],
            "taxable_value": t["taxable_value"], "cgst": t["cgst"], "sgst": t["sgst"], "igst": t["igst"],
            "gst_total": t["gst_total"], "round_off": _round(round_off), "grand_total": grand_total,
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
        sale = await _sale_for(user, sale_id)
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
        user = await get_current_user(request)
        sale = await _sale_for(user, sale_id)
        profile = await company_profile_fn(sale.get("location_id")) if company_profile_fn else {}
        # the profile is a raw Mongo document: its ObjectId made every invoice request a server error
        profile = {**{k: v for k, v in (profile or {}).items() if k != "_id"}, **({"id": str(profile["_id"])} if (profile or {}).get("_id") else {})}
        return {"sale": await _sale_out(sale), "company_profile": profile}

    return router
