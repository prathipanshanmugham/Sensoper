"""Material quotations — an itemised price quote for panels, inverters, cables, structures and other material.

Each line shows its own rate, HSN, discount and GST, worked out with exactly the same rules as Direct sales
(GST on the discounted value, CGST + SGST or IGST by state, a bill discount spread over the lines), so the
sale made from an accepted quotation comes to the same total. The rate starts at the Price list's selling price;
the cost and margin are only ever shown to people who may see the Price list, and never go on the PDF.

Flow: draft → sent → accepted / rejected → converted (a Direct sale is made from it: the sale form opens with the
quotation's customer and lines, and saving the sale marks the quotation converted and the lead won).
Editing a quotation that was already sent makes the next revision (R1, R2…) and puts it back to draft.
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

import notify
from locations import location_allowed, location_scope_filter
from sales import _check_lines, _price_lines, _round, _sale_totals
from website import OPEN_STATUSES, STATUSES, mobile

IST = timezone(timedelta(hours=5, minutes=30))
QUOTE_STATUSES = {"draft": "Draft", "sent": "Sent", "accepted": "Accepted", "rejected": "Not accepted", "converted": "Sold"}
DEFAULT_VALID_DAYS = 15
DEFAULT_TERMS = [
    "Rates are in Indian rupees; GST is charged as shown against each item.",
    "Payment: 100% with the order, unless agreed otherwise in writing.",
    "Delivery within 3–7 working days of payment, subject to stock at the time of order.",
    "Transport, loading and unloading are extra unless they are listed above.",
    "Warranty as per each manufacturer's terms; we help you with every claim.",
    "Rates may change if the order is placed after this quotation's validity date.",
]
UNITS = ("Nos", "Set", "Pair", "m", "Roll", "Box", "kg", "Lot", "Kit", "kW", "Job")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


def today_ist() -> str:
    return _now().astimezone(IST).date().isoformat()


def _fy() -> str:
    t = _now().astimezone(IST)
    start = t.year if t.month >= 4 else t.year - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"


def _clean(text: Any, limit: int) -> str:
    s = re.sub(r"<[^<>]*>", " ", str(text or "")[: max(limit, 1) * 4])
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", s)
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s[:limit]


def _oid(v: Any, what: str = "quotation") -> ObjectId:
    if not ObjectId.is_valid(str(v or "")):
        raise HTTPException(status_code=404, detail=f"That {what} doesn't exist")
    return ObjectId(str(v))


def terms_from_html(content: str) -> List[str]:
    """The lines of a Terms & Conditions template (an HTML list or plain lines)."""
    items = re.findall(r"<li[^>]*>(.*?)</li>", content or "", flags=re.S | re.I)
    if not items:
        items = re.split(r"<br\s*/?>|</p>|\n", content or "", flags=re.I)
    out = [html.unescape(_clean(i, 400)) for i in items]
    return [t for t in out if t][:30]


def selling_price(item: Dict[str, Any]) -> Optional[float]:
    """The Price list's selling price (cost + margin) — None when the margin hasn't been set."""
    if item.get("margin_pct") is None:
        return None
    return round(float(item.get("unit_price") or 0) * (1 + float(item["margin_pct"]) / 100), 2)


# ───────────────────────── request bodies ─────────────────────────
class QuoteCustomer(BaseModel):
    name: str = Field("", max_length=200)
    phone: Optional[str] = Field("", max_length=40)
    email: Optional[str] = Field("", max_length=200)
    company: Optional[str] = Field("", max_length=200)
    address: Optional[str] = Field("", max_length=600)
    state: Optional[str] = Field("Tamil Nadu", max_length=60)
    gstin: Optional[str] = Field("", max_length=20)


class QuoteLine(BaseModel):
    inventory_item_id: Optional[str] = None
    name: str = Field(..., max_length=300)
    description: Optional[str] = Field("", max_length=600)
    sku_code: Optional[str] = Field("", max_length=80)
    hsn_code: Optional[str] = Field("", max_length=20)
    quantity: float
    unit: Optional[str] = Field("Nos", max_length=12)
    unit_price: float
    discount_pct: Optional[float] = 0
    gst_percentage: Optional[float] = 18


class QuoteIn(BaseModel):
    customer: QuoteCustomer
    lead_id: Optional[str] = None
    lines: List[QuoteLine]
    discount_amount: Optional[float] = 0
    round_off: Optional[float] = None      # None = round the total to the nearest rupee
    valid_until: Optional[str] = None
    subject: Optional[str] = Field("", max_length=200)
    terms: Optional[List[str]] = None
    notes: Optional[str] = Field("", max_length=2000)            # printed on the quotation
    internal_note: Optional[str] = Field("", max_length=2000)    # only staff see it
    location_id: Optional[str] = None


class StatusIn(BaseModel):
    status: str
    reason: Optional[str] = Field("", max_length=300)


# ───────────────────────── router ─────────────────────────
def create_router(db, get_current_user, get_permissions, check_module_permission, create_audit_log, company_profile_fn):
    router = APIRouter()

    async def _perms(user) -> Dict[str, Any]:
        return await get_permissions(user.get("role", "staff"))

    async def _sees_cost(user) -> bool:
        return user.get("role") == "admin" or bool(((await _perms(user)).get("module_pricelist") or {}).get("view"))

    async def _sees_all(user) -> bool:
        return user.get("role") == "admin" or bool((await _perms(user)).get("can_see_all_quotes"))

    async def _scope(user) -> Dict[str, Any]:
        parts: List[Dict[str, Any]] = []
        loc = location_scope_filter(user)
        if loc:
            parts.append(loc)
        if not await _sees_all(user):
            parts.append({"$or": [{"created_by": user["id"]}, {"lead_owner": user["id"]}]})
        return {} if not parts else parts[0] if len(parts) == 1 else {"$and": parts}

    async def _visible(user, q: Dict[str, Any]) -> bool:
        if not location_allowed(user, q.get("location_id")):
            return False
        return await _sees_all(user) or user["id"] in (q.get("created_by"), q.get("lead_owner"))

    async def _quote_for(user, quote_id: str) -> Dict[str, Any]:
        q = await db.material_quotes.find_one({"_id": _oid(quote_id)})
        if not q or not await _visible(user, q):
            raise HTTPException(status_code=404, detail="That quotation doesn't exist")
        return q

    async def _lead_for(user, lead_id: str) -> Dict[str, Any]:
        """The lead a quotation is for — the same rule as the Leads page: yours, unowned, or everyone's if you may see all."""
        lead = await db.website_leads.find_one({"_id": _oid(lead_id, "lead")})
        if not lead or not location_allowed(user, lead.get("location_id")):
            raise HTTPException(status_code=400, detail="That lead doesn't exist")
        sees_all = user.get("role") == "admin" or bool((await _perms(user)).get("can_see_all_leads"))
        if not sees_all and lead.get("assigned_to") not in (user["id"], None, "") and lead.get("created_by") != user["id"]:
            raise HTTPException(status_code=400, detail="That lead doesn't exist")
        return lead

    async def _lead_log(lead_id: Optional[str], text: str, user, extra: Optional[Dict[str, Any]] = None, kind: str = "quote") -> None:
        if not lead_id or not ObjectId.is_valid(lead_id):
            return
        now = _iso()
        upd: Dict[str, Any] = {"updated_at": now, **(extra or {})}
        await db.website_leads.update_one({"_id": ObjectId(lead_id)}, {"$set": upd, "$push": {"activity": {
            "at": now, "by": user.get("name") or user.get("email") or "Someone", "by_id": user.get("id"), "type": kind, "text": text}}})

    async def _number(location_id: Optional[str]) -> str:
        prefix = "MQ"
        if location_id and ObjectId.is_valid(str(location_id)):
            loc = await db.locations.find_one({"_id": ObjectId(location_id)}, {"code": 1})
            if loc and loc.get("code"):
                prefix = f"MQ-{loc['code']}"
        key = f"material_quote:{prefix}/{_fy()}"
        try:
            await db.counters.insert_one({"_id": key, "seq": 0})
        except DuplicateKeyError:
            pass
        doc = await db.counters.find_one_and_update({"_id": key}, {"$inc": {"seq": 1}}, return_document=ReturnDocument.AFTER)
        return f"{prefix}/{_fy()}/{int(doc['seq']):04d}"

    async def _default_terms() -> List[str]:
        t = await db.terms_conditions.find_one({"is_active": True, "category": "material", "language": "en"})
        lines = terms_from_html(t.get("content", "")) if t else []
        return lines or list(DEFAULT_TERMS)

    async def _price(body: QuoteIn, user) -> Dict[str, Any]:
        """Lines and totals, worked out on the server with the Direct sales rules."""
        if not body.lines:
            raise HTTPException(status_code=400, detail="Add at least one item")
        if len(body.lines) > 200:
            raise HTTPException(status_code=400, detail="A quotation can have up to 200 lines")
        raw: List[Dict[str, Any]] = []
        ids = [ObjectId(l.inventory_item_id) for l in body.lines if l.inventory_item_id and ObjectId.is_valid(l.inventory_item_id)]
        stock = {str(i["_id"]): i for i in await db.inventory_items.find({"_id": {"$in": ids}}).to_list(500)} if ids else {}
        for l in body.lines:
            d = l.model_dump()
            d["name"] = _clean(d["name"], 200)
            if not d["name"]:
                raise HTTPException(status_code=400, detail="Every line needs an item name")
            d["description"] = _clean(d.get("description"), 300)
            d["sku_code"] = _clean(d.get("sku_code"), 60)
            d["hsn_code"] = re.sub(r"[^0-9A-Za-z]", "", d.get("hsn_code") or "")[:10]
            d["unit"] = _clean(d.get("unit") or "Nos", 12) or "Nos"
            item = stock.get(str(d.get("inventory_item_id") or ""))
            if d.get("inventory_item_id") and not item:
                d["inventory_item_id"] = None          # the stock item was removed — keep the line as typed
            d["cost_price"] = float(item.get("unit_price") or 0) if item else 0.0
            raw.append(d)
        _check_lines(raw)
        lines = _price_lines(raw, body.discount_amount or 0)
        profile = await company_profile_fn(body.location_id) if company_profile_fn else {}
        company_state = (profile or {}).get("state", "Tamil Nadu")
        c = body.customer
        t = _sale_totals(lines, 0, c.state, company_state, c.gstin, (profile or {}).get("gst_number"))
        auto = body.round_off is None
        round_off = round(round(t["grand_total"]) - t["grand_total"], 2) if auto else float(body.round_off)
        if not auto and abs(round_off) > 100:
            raise HTTPException(status_code=400, detail="The round-off can be at most ₹100 either way")
        t = _sale_totals(lines, round_off, c.state, company_state, c.gstin, (profile or {}).get("gst_number"))
        return {"lines": lines, "totals": t, "round_off": _round(round_off), "auto_round": auto}

    def _customer(body: QuoteIn) -> Dict[str, Any]:
        c = body.customer
        name = _clean(c.name, 120)
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Enter the customer's name")
        phone = (c.phone or "").strip()
        if phone:
            phone = mobile(phone) or ""
            if not phone:
                raise HTTPException(status_code=400, detail="Enter a 10-digit mobile number, or leave the phone empty")
        gstin = re.sub(r"\s", "", (c.gstin or "")).upper()
        if gstin and not re.match(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$", gstin):
            raise HTTPException(status_code=400, detail="That GSTIN doesn't look right — it has 15 characters, like 33ABCDE1234F1Z5")
        email = _clean(c.email, 120)
        if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(status_code=400, detail="That email doesn't look right")
        return {"name": name, "phone": phone, "email": email, "company": _clean(c.company, 120),
                "address": _clean(c.address, 400), "state": _clean(c.state, 40) or "Tamil Nadu", "gstin": gstin}

    def _valid_until(v: Optional[str]) -> str:
        d = str(v or "").strip()[:10]
        if not d:
            return (_now().astimezone(IST).date() + timedelta(days=DEFAULT_VALID_DAYS)).isoformat()
        try:
            datetime.strptime(d, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="'Valid till' should look like 2026-12-15")
        return d

    def _out(q: Dict[str, Any], sees_cost: bool, today: Optional[str] = None) -> Dict[str, Any]:
        today = today or today_ist()
        hidden = () if sees_cost else ("cost_price", "margin_amount", "margin_pct")
        lines = [{k: v for k, v in l.items() if k not in hidden} for l in q.get("lines") or []]
        st = q.get("status") or "draft"
        out = {k: v for k, v in q.items() if k not in ("_id", "lines", "internal_cost")}
        out.update({
            "id": str(q["_id"]), "lines": lines, "status": st, "status_label": QUOTE_STATUSES.get(st, st),
            "expired": st in ("draft", "sent") and bool(q.get("valid_until")) and q["valid_until"] < today,
            "display_number": f"{q.get('number')}{'-R' + str(q['revision']) if q.get('revision') else ''}",
            "item_count": len(lines),
        })
        if sees_cost:
            cost = sum(float(l.get("cost_price") or 0) * float(l.get("quantity") or 0) for l in q.get("lines") or [])
            taxable = float(q.get("taxable_value") or 0)
            out["margin_amount"] = _round(taxable - cost)
            out["margin_pct"] = _round((taxable - cost) / taxable * 100) if taxable > 0 else 0
            out["below_cost_lines"] = [l.get("name") for l in q.get("lines") or []
                                       if float(l.get("cost_price") or 0) > 0 and float(l.get("margin_amount") or 0) < 0]
        return out

    def _doc_from(priced: Dict[str, Any], customer: Dict[str, Any], body: QuoteIn) -> Dict[str, Any]:
        t = priced["totals"]
        return {
            "customer": customer, "lines": priced["lines"],
            "subtotal": t["subtotal"], "line_discount": t["line_discount"], "header_discount": t["header_discount"],
            "total_discount": t["total_discount"], "taxable_value": t["taxable_value"], "cgst": t["cgst"], "sgst": t["sgst"],
            "igst": t["igst"], "gst_total": t["gst_total"], "round_off": priced["round_off"], "auto_round": priced["auto_round"],
            "grand_total": t["grand_total"], "discount_amount": _round(body.discount_amount or 0),
            "valid_until": _valid_until(body.valid_until), "subject": _clean(body.subject, 160),
            "notes": _clean(body.notes, 1500), "internal_note": _clean(body.internal_note, 1500),
        }

    # ───────────── list & look-ups ─────────────
    @router.get("/material-quotes")
    async def list_quotes(request: Request, status: Optional[str] = None, q: Optional[str] = None, lead_id: Optional[str] = None,
                          mine: bool = False, limit: int = 200):
        user = await get_current_user(request)
        base = await _scope(user)
        parts: List[Dict[str, Any]] = [base] if base else []
        today = today_ist()
        if status == "open":
            parts.append({"status": {"$in": ["draft", "sent"]}})
        elif status == "expired":
            parts.append({"status": {"$in": ["draft", "sent"]}, "valid_until": {"$lt": today}})
        elif status:
            if status not in QUOTE_STATUSES:
                raise HTTPException(status_code=400, detail="Unknown status")
            parts.append({"status": status})
        if lead_id:
            parts.append({"lead_id": lead_id})
        if mine:
            parts.append({"created_by": user["id"]})
        if q and q.strip():
            rx = {"$regex": re.escape(q.strip()[:60]), "$options": "i"}
            digits = re.sub(r"\D", "", q)
            ors: List[Dict[str, Any]] = [{"number": rx}, {"customer.name": rx}, {"customer.company": rx}, {"lines.name": rx}]
            if len(digits) >= 4:
                ors.append({"customer.phone": {"$regex": re.escape(digits[-10:])}})
            parts.append({"$or": ors})
        query = {} if not parts else parts[0] if len(parts) == 1 else {"$and": parts}
        rows = await db.material_quotes.find(query).sort("updated_at", -1).limit(max(1, min(limit, 500))).to_list(500)
        sees_cost = await _sees_cost(user)
        items = []
        for r in rows:
            o = _out(r, sees_cost, today)
            o.pop("lines", None)
            o.pop("terms", None)
            items.append(o)

        async def n(extra):
            return await db.material_quotes.count_documents({"$and": [base or {}, extra]})
        month = _now().astimezone(IST).replace(day=1).date().isoformat()
        sold = await db.material_quotes.find({"$and": [base or {}, {"status": "converted", "converted_on": {"$gte": month}}]}, {"grand_total": 1}).to_list(5000)
        counts = {"draft": await n({"status": "draft"}), "sent": await n({"status": "sent"}), "accepted": await n({"status": "accepted"}),
                  "expired": await n({"status": {"$in": ["draft", "sent"]}, "valid_until": {"$lt": today}}),
                  "converted_month": len(sold), "converted_month_value": _round(sum(float(s.get("grand_total") or 0) for s in sold)),
                  "open_value": _round(sum(float(x.get("grand_total") or 0) for x in await db.material_quotes.find(
                      {"$and": [base or {}, {"status": {"$in": ["sent", "accepted"]}}]}, {"grand_total": 1}).to_list(5000)))}
        return {"items": items, "counts": counts, "statuses": [{"key": k, "label": v} for k, v in QUOTE_STATUSES.items()]}

    @router.get("/material-quotes/items")
    async def pick_items(request: Request, q: str = "", category: Optional[str] = None, limit: int = 25):
        """The item picker: name / SKU / HSN search over active stock, with the selling price and what's in stock."""
        user = await get_current_user(request)
        sees_cost = await _sees_cost(user)
        query: Dict[str, Any] = {"active": {"$ne": False}}
        text = (q or "").strip()[:60]
        if text:
            words = [re.escape(w) for w in text.split() if w][:5]
            query["$and"] = [{"$or": [{"name": {"$regex": w, "$options": "i"}}, {"sku_code": {"$regex": w, "$options": "i"}},
                                      {"hsn_code": {"$regex": w, "$options": "i"}}, {"category": {"$regex": w, "$options": "i"}}]} for w in words]
        if category:
            query["category"] = category
        rows = await db.inventory_items.find(query).sort("name", 1).limit(max(1, min(limit, 100))).to_list(100)
        brand_ids = [ObjectId(r["brand_id"]) for r in rows if r.get("brand_id") and ObjectId.is_valid(str(r["brand_id"]))]
        brands = {str(b["_id"]): b.get("name") for b in await db.brands.find({"_id": {"$in": brand_ids}}, {"name": 1}).to_list(200)} if brand_ids else {}
        out = []
        for r in rows:
            sell = selling_price(r)
            o = {"id": str(r["_id"]), "name": r.get("name"), "sku_code": r.get("sku_code") or "", "hsn_code": r.get("hsn_code") or "",
                 "category": r.get("category") or "", "brand": brands.get(str(r.get("brand_id") or "")) or "",
                 "stock": r.get("quantity", 0), "gst_percentage": r.get("gst_percentage"), "selling_price": sell,
                 "price_missing": sell is None, "unit": "Nos"}
            if sees_cost:
                o.update({"cost_price": float(r.get("unit_price") or 0), "margin_pct": r.get("margin_pct")})
            out.append(o)
        return {"items": out, "sees_cost": sees_cost}

    @router.get("/material-quotes/defaults")
    async def defaults(request: Request):
        user = await get_current_user(request)
        profile = await company_profile_fn(user.get("default_location_id")) if company_profile_fn else {}
        return {"terms": await _default_terms(), "valid_days": DEFAULT_VALID_DAYS, "units": list(UNITS),
                "valid_until": _valid_until(None), "company_state": (profile or {}).get("state", "Tamil Nadu"),
                "sees_cost": await _sees_cost(user), "statuses": [{"key": k, "label": v} for k, v in QUOTE_STATUSES.items()]}

    @router.get("/material-quotes/{quote_id}")
    async def get_quote(quote_id: str, request: Request):
        user = await get_current_user(request)
        q = await _quote_for(user, quote_id)
        out = _out(q, await _sees_cost(user))
        ids = [ObjectId(l["inventory_item_id"]) for l in q.get("lines") or [] if l.get("inventory_item_id") and ObjectId.is_valid(str(l["inventory_item_id"]))]
        stock = {str(i["_id"]): i.get("quantity", 0) for i in await db.inventory_items.find({"_id": {"$in": ids}}, {"quantity": 1}).to_list(500)} if ids else {}
        for l in out["lines"]:
            if l.get("inventory_item_id"):
                l["stock"] = stock.get(str(l["inventory_item_id"]))
        return out

    # ───────────── create / edit ─────────────
    @router.post("/material-quotes")
    async def create_quote(body: QuoteIn, request: Request):
        user = await get_current_user(request)
        location_id = body.location_id or user.get("default_location_id")
        if location_id and not location_allowed(user, location_id):
            raise HTTPException(status_code=403, detail="You can only make quotations for your own branch")
        body.location_id = location_id
        lead = await _lead_for(user, body.lead_id) if body.lead_id else None
        customer = _customer(body)
        priced = await _price(body, user)
        now = _iso()
        by = user.get("name") or user.get("email") or "Someone"
        terms = [_clean(t, 400) for t in (body.terms if body.terms is not None else await _default_terms()) if _clean(t, 400)][:30]
        doc = {**_doc_from(priced, customer, body), "number": await _number(location_id), "revision": 0, "status": "draft",
               "terms": terms, "lead_id": str(lead["_id"]) if lead else None, "lead_number": lead.get("number") if lead else None,
               "lead_owner": (lead.get("assigned_to") or None) if lead else None, "location_id": location_id or None,
               "created_by": user["id"], "created_by_name": by, "created_at": now, "updated_at": now, "quote_date": today_ist(),
               "history": [{"at": now, "by": by, "text": "Made"}]}
        res = await db.material_quotes.insert_one(doc)
        doc["_id"] = res.inserted_id
        if lead:
            await db.website_leads.update_one({"_id": lead["_id"]}, {"$inc": {"quote_count": 1}})
            await _lead_log(str(lead["_id"]), f"Quotation {doc['number']} made — ₹{doc['grand_total']:,.0f}", user)
        return _out(doc, await _sees_cost(user))

    @router.put("/material-quotes/{quote_id}")
    async def update_quote(quote_id: str, body: QuoteIn, request: Request):
        user = await get_current_user(request)
        q = await _quote_for(user, quote_id)
        if q.get("status") == "converted":
            raise HTTPException(status_code=400, detail="This quotation is already a sale — make a copy to quote again")
        body.location_id = q.get("location_id")
        if body.lead_id and body.lead_id != q.get("lead_id"):
            raise HTTPException(status_code=400, detail="A quotation stays with the lead it was made for — make a copy for another lead")
        body.lead_id = q.get("lead_id")
        customer = _customer(body)
        priced = await _price(body, user)
        now = _iso()
        by = user.get("name") or user.get("email") or "Someone"
        upd = {**_doc_from(priced, customer, body), "updated_at": now}
        if body.terms is not None:
            upd["terms"] = [_clean(t, 400) for t in body.terms if _clean(t, 400)][:30]
        push = {"at": now, "by": by, "text": "Edited"}
        if q.get("status") in ("sent", "accepted", "rejected"):
            upd.update({"revision": int(q.get("revision") or 0) + 1, "status": "draft", "quote_date": today_ist()})
            push["text"] = f"Revised to R{upd['revision']} (was {QUOTE_STATUSES.get(q.get('status'))})"
        await db.material_quotes.update_one({"_id": q["_id"]}, {"$set": upd, "$push": {"history": push}})
        if "revision" in upd:
            await _lead_log(q.get("lead_id"), f"Quotation {q.get('number')} revised to R{upd['revision']} — ₹{upd['grand_total']:,.0f}", user)
        return _out(await db.material_quotes.find_one({"_id": q["_id"]}), await _sees_cost(user))

    @router.post("/material-quotes/{quote_id}/status")
    async def set_status(quote_id: str, body: StatusIn, request: Request):
        user = await get_current_user(request)
        q = await _quote_for(user, quote_id)
        st = body.status
        if st not in ("draft", "sent", "accepted", "rejected"):
            raise HTTPException(status_code=400, detail="A quotation becomes Sold only by making the sale from it")
        if q.get("status") == "converted":
            raise HTTPException(status_code=400, detail="This quotation is already a sale")
        if st == q.get("status"):
            return _out(q, await _sees_cost(user))
        now = _iso()
        by = user.get("name") or user.get("email") or "Someone"
        reason = _clean(body.reason, 200)
        upd: Dict[str, Any] = {"status": st, "updated_at": now, f"{st}_at": now}
        if st == "rejected":
            upd["reject_reason"] = reason
        await db.material_quotes.update_one({"_id": q["_id"]}, {"$set": upd, "$push": {"history": {
            "at": now, "by": by, "text": f"Marked {QUOTE_STATUSES[st].lower()}" + (f" — {reason}" if reason else "")}}})
        label = f"{q.get('number')}{'-R' + str(q['revision']) if q.get('revision') else ''}"
        lead_id = q.get("lead_id")
        if lead_id and ObjectId.is_valid(lead_id):
            lead = await db.website_leads.find_one({"_id": ObjectId(lead_id)}, {"status": 1})
            extra: Dict[str, Any] = {}
            if st == "sent" and lead and lead.get("status") in ("new", "contacted", "site_visit"):
                extra["status"] = "quoted"
            text = {"sent": f"Quotation {label} sent — ₹{q.get('grand_total', 0):,.0f}", "accepted": f"Quotation {label} accepted",
                    "rejected": f"Quotation {label} not accepted" + (f" — {reason}" if reason else ""),
                    "draft": f"Quotation {label} back to draft"}[st]
            await _lead_log(lead_id, text, user, extra)
            if extra.get("status"):
                await _lead_log(lead_id, f"Moved to {STATUSES['quoted']}", user, kind="status")
        return _out(await db.material_quotes.find_one({"_id": q["_id"]}), await _sees_cost(user))

    @router.post("/material-quotes/{quote_id}/duplicate")
    async def duplicate(quote_id: str, request: Request):
        user = await get_current_user(request)
        q = await _quote_for(user, quote_id)
        now = _iso()
        by = user.get("name") or user.get("email") or "Someone"
        keep = ("customer", "lines", "subtotal", "line_discount", "header_discount", "total_discount", "taxable_value", "cgst", "sgst",
                "igst", "gst_total", "round_off", "auto_round", "grand_total", "discount_amount", "subject", "notes", "internal_note",
                "terms", "lead_id", "lead_number", "lead_owner", "location_id")
        doc = {k: q.get(k) for k in keep}
        doc.update({"number": await _number(q.get("location_id")), "revision": 0, "status": "draft", "created_by": user["id"],
                    "created_by_name": by, "created_at": now, "updated_at": now, "quote_date": today_ist(),
                    "valid_until": _valid_until(None), "copied_from": q.get("number"),
                    "history": [{"at": now, "by": by, "text": f"Copied from {q.get('number')}"}]})
        res = await db.material_quotes.insert_one(doc)
        doc["_id"] = res.inserted_id
        if doc.get("lead_id") and ObjectId.is_valid(doc["lead_id"]):
            await db.website_leads.update_one({"_id": ObjectId(doc["lead_id"])}, {"$inc": {"quote_count": 1}})
            await _lead_log(doc["lead_id"], f"Quotation {doc['number']} made (copy of {q.get('number')})", user)
        return _out(doc, await _sees_cost(user))

    @router.delete("/material-quotes/{quote_id}")
    async def delete_quote(quote_id: str, request: Request):
        user = await get_current_user(request)
        q = await _quote_for(user, quote_id)
        if q.get("status") == "converted":
            raise HTTPException(status_code=400, detail="This quotation is already a sale and stays on record")
        await db.material_quotes.delete_one({"_id": q["_id"]})
        if q.get("lead_id") and ObjectId.is_valid(q["lead_id"]):
            await db.website_leads.update_one({"_id": ObjectId(q["lead_id"]), "quote_count": {"$gt": 0}}, {"$inc": {"quote_count": -1}})
            await _lead_log(q["lead_id"], f"Quotation {q.get('number')} deleted", user)
        await create_audit_log(user["id"], user.get("name", ""), "delete", "material_quote", quote_id,
                               {"number": q.get("number"), "customer": (q.get("customer") or {}).get("name"), "grand_total": q.get("grand_total")})
        return {"deleted": True}

    return router


async def mark_converted(db, quote_id: Optional[str], sale_id: str, invoice_number: str, grand_total: float, user: Dict[str, Any]) -> None:
    """Called by Direct sales after a sale made from a quotation is saved: the quotation is Sold, its lead Won."""
    if not quote_id or not ObjectId.is_valid(str(quote_id)):
        return
    now = _iso()
    by = user.get("name") or user.get("email") or "Someone"
    q = await db.material_quotes.find_one_and_update(
        {"_id": ObjectId(str(quote_id)), "status": {"$ne": "converted"}},
        {"$set": {"status": "converted", "converted_at": now, "converted_on": today_ist(), "sale_id": sale_id,
                  "invoice_number": invoice_number, "sale_total": grand_total, "updated_at": now},
         "$push": {"history": {"at": now, "by": by, "text": f"Sold — invoice {invoice_number}"}}})
    if not q or not q.get("lead_id") or not ObjectId.is_valid(q["lead_id"]):
        return
    lead = await db.website_leads.find_one({"_id": ObjectId(q["lead_id"])}, {"status": 1, "value": 1})
    if not lead:
        return
    upd: Dict[str, Any] = {"updated_at": now}
    log = [{"at": now, "by": by, "by_id": user.get("id"), "type": "sale", "text": f"Sale {invoice_number} made from quotation {q.get('number')} — ₹{grand_total:,.0f}"}]
    if lead.get("status") in OPEN_STATUSES:
        upd.update({"status": "won", "closed_at": now, "follow_up_on": None, "follow_up_at": None, "follow_up_note": ""})
        if not lead.get("value"):
            upd["value"] = round(float(grand_total or 0), 2)
        log.append({"at": now, "by": by, "by_id": user.get("id"), "type": "status", "text": f"Moved to {STATUSES['won']}"})
        await notify.clear(db, "lead_follow_up", "lead", q["lead_id"])
    await db.website_leads.update_one({"_id": lead["_id"]}, {"$set": upd, "$push": {"activity": {"$each": log}}})


async def ensure_indexes(db) -> None:
    for keys in ([("updated_at", -1)], [("lead_id", 1)], [("status", 1), ("valid_until", 1)], [("created_by", 1)]):
        try:
            await db.material_quotes.create_index(keys)
        except Exception:
            pass
