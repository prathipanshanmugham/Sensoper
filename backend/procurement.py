"""Purchase requests with vendor quotes (Oct 2026): ask at least 3 vendors, compare, choose one, and the purchase
order is made from the chosen quote.

    request (what, how many, by when) → quotes from vendors (price per line, GST, freight, delivery days, terms)
    → compare (landed cost, cheapest per line, last price paid, vendor rating and on-time record)
    → choose (a reason is needed when it isn't the cheapest; fewer quotes than the minimum needs an admin and a reason)
    → PO (pending approval, like any PO) → normal inbound.

Settings (admin): minimum quotes (default 3), whether direct POs need quotes, and an amount below which a direct PO
is fine.
"""
from __future__ import annotations

import math
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from vendors import rating_average, scorecard

DEFAULT_SETTINGS = {"min_quotes": 3, "require_quotes": True, "skip_below_amount": 0, "low_rating": 3.0}
OPEN_STATUSES = ("open", "quoting")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _f(v, d: float = 0.0) -> float:
    try:
        x = float(v)
        return x if math.isfinite(x) else d
    except (TypeError, ValueError):
        return d


def merge_settings(stored: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(DEFAULT_SETTINGS)
    for k in DEFAULT_SETTINGS:
        if stored and stored.get(k) is not None:
            out[k] = stored[k]
    out["min_quotes"] = max(1, min(int(_f(out["min_quotes"], 3)), 10))
    out["require_quotes"] = bool(out["require_quotes"])
    out["skip_below_amount"] = max(0.0, _f(out["skip_below_amount"]))
    out["low_rating"] = max(0.0, min(_f(out["low_rating"], 3), 5))
    return out


def quote_totals(lines: List[Dict[str, Any]], quote: Dict[str, Any]) -> Dict[str, Any]:
    """Landed cost of one quote against the request's lines. Pure.

    line value = qty × unit price; GST on each line; freight added once; a line the vendor can't supply (price 0 / blank)
    makes the quote incomplete."""
    prices = quote.get("lines") or []
    sub = gst = 0.0
    missing = 0
    for i, ln in enumerate(lines):
        q = prices[i] if i < len(prices) else {}
        p = _f(q.get("unit_price"))
        if p <= 0:
            missing += 1
            continue
        v = _f(ln.get("qty")) * p
        sub += v
        gst += v * _f(q.get("gst_pct"), 18) / 100
    freight = max(_f(quote.get("freight")), 0)
    return {"subtotal": round(sub, 2), "gst": round(gst, 2), "freight": round(freight, 2), "landed_total": round(sub + gst + freight, 2),
            "complete": missing == 0, "missing_lines": missing}


def compare(lines: List[Dict[str, Any]], quotes: List[Dict[str, Any]], vendor_info: Dict[str, Dict[str, Any]], low_rating: float = 3.0) -> Dict[str, Any]:
    """Rank the quotes: cheapest complete landed total; the recommendation skips vendors rated below `low_rating`.
    Also the cheapest price on each line and the savings against the average and the highest quote. Pure."""
    rows = []
    for q in quotes:
        t = quote_totals(lines, q)
        info = vendor_info.get(q.get("vendor_id")) or {}
        rows.append({"id": q["id"], "vendor_id": q.get("vendor_id"), "vendor_name": q.get("vendor_name"), **t,
                     "delivery_days": q.get("delivery_days"), "rating": info.get("rating"), "on_time_pct": info.get("on_time_pct"),
                     "preferred": bool(info.get("preferred")), "low_rating": info.get("rating") is not None and info["rating"] < low_rating})
    complete = sorted([r for r in rows if r["complete"]], key=lambda r: (r["landed_total"], r["delivery_days"] if r["delivery_days"] is not None else 999))
    cheapest = complete[0]["id"] if complete else None
    good = [r for r in complete if not r["low_rating"]]
    recommended = (good or complete or [None])[0]
    totals = [r["landed_total"] for r in complete]
    line_best = []
    for i, _ in enumerate(lines):
        ps = [(_f(((q.get("lines") or [])[i] if i < len(q.get("lines") or []) else {}).get("unit_price")), q["id"]) for q in quotes]
        ps = [p for p in ps if p[0] > 0]
        line_best.append({"index": i, "best_price": min(ps)[0] if ps else None, "best_quote_id": min(ps)[1] if ps else None})
    return {"rows": rows, "cheapest_id": cheapest, "recommended_id": recommended["id"] if recommended else None,
            "average_total": round(sum(totals) / len(totals), 2) if totals else None, "highest_total": max(totals) if totals else None,
            "lowest_total": min(totals) if totals else None, "line_best": line_best}


class LineIn(BaseModel):
    inventory_item_id: Optional[str] = None
    name: str = Field(min_length=1, max_length=160)
    qty: float = Field(gt=0)
    unit: Optional[str] = "no"
    specs: Optional[str] = None


class RequestIn(BaseModel):
    title: Optional[str] = None
    lines: List[LineIn] = Field(min_length=1, max_length=60)
    needed_by: Optional[str] = None
    project_id: Optional[str] = None
    location_id: Optional[str] = None
    notes: Optional[str] = None


class QuoteLineIn(BaseModel):
    unit_price: Optional[float] = None
    gst_pct: Optional[float] = 18


class QuoteIn(BaseModel):
    vendor_id: str
    lines: List[QuoteLineIn]
    freight: Optional[float] = 0
    delivery_days: Optional[int] = None
    payment_terms: Optional[str] = None
    valid_until: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None
    attachment: Optional[str] = None


class SelectIn(BaseModel):
    quote_id: str
    reason: Optional[str] = None
    expected_delivery: Optional[str] = None


class CancelIn(BaseModel):
    reason: Optional[str] = None


def create_router(db, get_current_user, require_role, create_audit_log, require_module, check_module_permission,
                  insert_purchase_order: Callable[..., Awaitable[Dict[str, Any]]]):
    router = APIRouter()

    async def settings() -> Dict[str, Any]:
        return merge_settings(await db.procurement_settings.find_one({"key": "defaults"}))

    async def _seq() -> int:
        doc = await db.counters.find_one_and_update({"_id": "purchase_request_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
        return doc["seq"]

    async def _get(pr_id: str) -> Dict[str, Any]:
        d = await db.purchase_requests.find_one({"_id": ObjectId(pr_id)}) if ObjectId.is_valid(pr_id) else None
        if not d:
            raise HTTPException(status_code=404, detail="Purchase request not found")
        return d

    async def _vendor_info(vendor_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        since = (_now() - timedelta(days=365)).isoformat()
        for vid in {v for v in vendor_ids if v and ObjectId.is_valid(v)}:
            v = await db.vendors.find_one({"_id": ObjectId(vid)})
            if not v:
                continue
            pos = await db.purchase_orders.find({"$or": [{"vendor_id": vid}, {"supplier_name": {"$regex": f"^{re.escape(v.get('name', ''))}$", "$options": "i"}}]}).to_list(1000)
            rt = rating_average([r async for r in db.vendor_ratings.find({"vendor_id": vid})])
            sc = scorecard(pos, since)
            out[vid] = {"name": v.get("name"), "rating": rt["overall"], "ratings_count": rt["count"], "on_time_pct": sc["on_time_pct"],
                        "orders": sc["orders"], "preferred": bool(v.get("preferred")), "blocked": bool(v.get("blocked")),
                        "payment_terms": v.get("payment_terms"), "credit_days": v.get("credit_days"), "phone": v.get("phone")}
        return out

    async def _last_paid(lines: List[Dict[str, Any]]) -> List[Optional[Dict[str, Any]]]:
        """The last price we paid for each line (by stock item, else by name) on an earlier PO."""
        out: List[Optional[Dict[str, Any]]] = [None] * len(lines)
        keys = [(str(ln.get("inventory_item_id") or ""), str(ln.get("name") or "").strip().lower()) for ln in lines]
        async for po in db.purchase_orders.find({"status": {"$ne": "rejected"}}, {"items": 1, "supplier_name": 1, "created_at": 1}).sort("created_at", 1):
            for it in po.get("items") or []:
                iid, nm = str(it.get("inventory_item_id") or ""), str(it.get("name") or "").strip().lower()
                for i, (kid, knm) in enumerate(keys):
                    if (kid and kid == iid) or (not kid and knm and knm == nm):
                        if _f(it.get("unit_price")) > 0:
                            out[i] = {"price": _f(it.get("unit_price")), "vendor": po.get("supplier_name"), "date": str(po.get("created_at") or "")[:10]}
        return out

    async def _out(d: Dict[str, Any], detail: bool = False) -> Dict[str, Any]:
        s = await settings()
        out = {k: v for k, v in d.items() if k != "_id"}
        out["id"] = str(d["_id"])
        quotes = d.get("quotes") or []
        out["quote_count"] = len(quotes)
        out["min_quotes"] = s["min_quotes"]
        out["quotes_short"] = max(s["min_quotes"] - len(quotes), 0)
        if detail:
            info = await _vendor_info([q.get("vendor_id") for q in quotes])
            out["comparison"] = compare(d.get("lines") or [], quotes, info, s["low_rating"])
            out["vendor_info"] = info
            out["last_paid"] = await _last_paid(d.get("lines") or [])
        else:
            totals = [quote_totals(d.get("lines") or [], q) for q in quotes]
            done = [t["landed_total"] for t in totals if t["complete"]]
            out["lowest_total"] = min(done) if done else None
        return out

    def _check_date(v: Optional[str], label: str) -> None:
        if v:
            try:
                date.fromisoformat(str(v)[:10])
            except ValueError:
                raise HTTPException(status_code=400, detail=f"{label} must be a date (YYYY-MM-DD)")

    # ═══════════════ settings ═══════════════
    @router.get("/procurement/settings")
    async def get_settings(request: Request):
        await get_current_user(request)
        return await settings()

    @router.put("/procurement/settings")
    async def put_settings(request: Request):
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can change purchase rules")
        body = await request.json()
        s = merge_settings(body)
        await db.procurement_settings.update_one({"key": "defaults"}, {"$set": {**s, "key": "defaults", "updated_at": _now().isoformat(), "updated_by": user["name"]}}, upsert=True)
        await create_audit_log(user["id"], user["name"], "procurement_settings_updated", "procurement_settings", "defaults", None, s)
        return s

    # ═══════════════ purchase requests ═══════════════
    @router.get("/purchase-requests")
    async def list_requests(request: Request, status: Optional[str] = None):
        await require_module(request, "module_purchase_inbound", "view")
        q: Dict[str, Any] = {}
        if status == "open":
            q["status"] = {"$in": list(OPEN_STATUSES)}
        elif status and status != "all":
            q["status"] = status
        return [await _out(d) async for d in db.purchase_requests.find(q).sort("created_at", -1).limit(300)]

    @router.post("/purchase-requests")
    async def create_request(body: RequestIn, request: Request):
        user = await require_module(request, "module_purchase_inbound", "create")
        _check_date(body.needed_by, "Needed by")
        lines = []
        for ln in body.lines:
            row = ln.model_dump()
            row["name"] = row["name"].strip()
            if row.get("inventory_item_id"):
                it = await db.inventory_items.find_one({"_id": ObjectId(row["inventory_item_id"])}, {"name": 1, "sku_code": 1}) if ObjectId.is_valid(row["inventory_item_id"]) else None
                if not it:
                    raise HTTPException(status_code=400, detail=f"Stock item for '{row['name']}' not found")
                row["sku_code"] = it.get("sku_code")
            lines.append(row)
        seq = await _seq()
        title = (body.title or "").strip() or (lines[0]["name"] + (f" + {len(lines) - 1} more" if len(lines) > 1 else ""))
        doc = {"number": f"PR-{seq:04d}", "title": title[:120], "lines": lines, "needed_by": body.needed_by, "project_id": body.project_id,
               "location_id": body.location_id or user.get("default_location_id"), "notes": (body.notes or "").strip() or None, "status": "open", "quotes": [],
               "created_by": user["id"], "created_by_name": user["name"], "created_at": _now().isoformat(),
               "history": [{"status": "open", "at": _now().isoformat(), "by": user["name"]}]}
        res = await db.purchase_requests.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "purchase_request_created", "purchase_request", str(res.inserted_id), None, {"number": doc["number"], "lines": len(lines)})
        return await _out({**doc, "_id": res.inserted_id}, detail=True)

    @router.get("/purchase-requests/savings")
    async def savings(request: Request, start: Optional[str] = None, end: Optional[str] = None):
        """What comparing quotes saved: chosen quote vs the average and the highest quote, over a period."""
        await require_module(request, "module_purchase_inbound", "view")
        s0 = (start or (_now().date() - timedelta(days=365)).isoformat())[:10]
        s1 = (end or _now().date().isoformat())[:10]
        rows = []
        async for d in db.purchase_requests.find({"status": "ordered"}):
            at = str(d.get("selected_at") or "")[:10]
            if not (s0 <= at <= s1):
                continue
            rows.append(d.get("savings") or {})
        n = len(rows)
        return {"period": {"start": s0, "end": s1}, "orders": n,
                "saved_vs_average": round(sum(_f(r.get("vs_average")) for r in rows), 2),
                "saved_vs_highest": round(sum(_f(r.get("vs_highest")) for r in rows), 2),
                "spend": round(sum(_f(r.get("chosen_total")) for r in rows), 2),
                "cheapest_pct": round(sum(1 for r in rows if r.get("was_cheapest")) / n * 100, 1) if n else None,
                "avg_quotes": round(sum(_f(r.get("quotes")) for r in rows) / n, 1) if n else None}

    @router.get("/purchase-requests/{pr_id}")
    async def get_request(pr_id: str, request: Request):
        await require_module(request, "module_purchase_inbound", "view")
        return await _out(await _get(pr_id), detail=True)

    @router.put("/purchase-requests/{pr_id}")
    async def update_request(pr_id: str, body: RequestIn, request: Request):
        user = await require_module(request, "module_purchase_inbound", "edit")
        d = await _get(pr_id)
        if d.get("status") not in OPEN_STATUSES:
            raise HTTPException(status_code=400, detail="This request is closed")
        if d.get("quotes") and len(body.lines) != len(d.get("lines") or []):
            raise HTTPException(status_code=400, detail="Quotes are already in — remove them before adding or removing lines")
        _check_date(body.needed_by, "Needed by")
        lines = [{**ln.model_dump(), "name": ln.name.strip()} for ln in body.lines]
        await db.purchase_requests.update_one({"_id": d["_id"]}, {"$set": {"lines": lines, "title": (body.title or d.get("title") or "")[:120],
                                                                          "needed_by": body.needed_by, "notes": body.notes, "updated_at": _now().isoformat()}})
        await create_audit_log(user["id"], user["name"], "purchase_request_updated", "purchase_request", pr_id)
        return await _out(await _get(pr_id), detail=True)

    async def _clean_quote(d: Dict[str, Any], body: QuoteIn, other_quotes: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not ObjectId.is_valid(body.vendor_id):
            raise HTTPException(status_code=400, detail="Choose the vendor")
        v = await db.vendors.find_one({"_id": ObjectId(body.vendor_id)})
        if not v or v.get("active") is False:
            raise HTTPException(status_code=400, detail="Vendor not found")
        if v.get("blocked"):
            raise HTTPException(status_code=400, detail=f"{v.get('name')} is blocked: {v.get('blocked_reason') or 'see Vendors'}")
        if any(q.get("vendor_id") == body.vendor_id for q in other_quotes):
            raise HTTPException(status_code=400, detail=f"There is already a quote from {v.get('name')} — edit that one")
        if len(body.lines) != len(d.get("lines") or []):
            raise HTTPException(status_code=400, detail="Give a price for each line (leave it blank if they can't supply it)")
        for ql in body.lines:
            if ql.unit_price is not None and ql.unit_price < 0:
                raise HTTPException(status_code=400, detail="Prices can't be negative")
            if ql.gst_pct is not None and not (0 <= ql.gst_pct <= 28):
                raise HTTPException(status_code=400, detail="GST must be between 0 and 28%")
        if not any(_f(ql.unit_price) > 0 for ql in body.lines):
            raise HTTPException(status_code=400, detail="Enter at least one price")
        if body.delivery_days is not None and not (0 <= body.delivery_days <= 365):
            raise HTTPException(status_code=400, detail="Delivery days must be between 0 and 365")
        _check_date(body.valid_until, "Valid until")
        att = (body.attachment or "").strip() or None
        if att and not re.fullmatch(r"[\w\-]+/(images|documents)/[\w\-]+\.(png|jpe?g|webp|pdf)", att, flags=re.I):
            raise HTTPException(status_code=400, detail="Attach the quote as a picture or PDF")
        return {"vendor_id": body.vendor_id, "vendor_name": v.get("name"), "lines": [{"unit_price": _f(ql.unit_price) or None, "gst_pct": _f(ql.gst_pct, 18)} for ql in body.lines],
                "freight": max(_f(body.freight), 0), "delivery_days": body.delivery_days, "payment_terms": (body.payment_terms or v.get("payment_terms") or "").strip() or None,
                "valid_until": body.valid_until, "reference": (body.reference or "").strip() or None, "notes": (body.notes or "").strip() or None, "attachment": att}

    @router.post("/purchase-requests/{pr_id}/quotes")
    async def add_quote(pr_id: str, body: QuoteIn, request: Request):
        user = await require_module(request, "module_purchase_inbound", "edit")
        d = await _get(pr_id)
        if d.get("status") not in OPEN_STATUSES:
            raise HTTPException(status_code=400, detail="This request is closed")
        q = await _clean_quote(d, body, d.get("quotes") or [])
        q.update({"id": uuid.uuid4().hex[:12], "received_at": _now().isoformat(), "by": user["name"]})
        await db.purchase_requests.update_one({"_id": d["_id"]}, {"$push": {"quotes": q}, "$set": {"status": "quoting", "updated_at": _now().isoformat()}})
        await create_audit_log(user["id"], user["name"], "vendor_quote_added", "purchase_request", pr_id, None, {"vendor": q["vendor_name"]})
        return await _out(await _get(pr_id), detail=True)

    @router.put("/purchase-requests/{pr_id}/quotes/{quote_id}")
    async def edit_quote(pr_id: str, quote_id: str, body: QuoteIn, request: Request):
        user = await require_module(request, "module_purchase_inbound", "edit")
        d = await _get(pr_id)
        if d.get("status") not in OPEN_STATUSES:
            raise HTTPException(status_code=400, detail="This request is closed")
        quotes = d.get("quotes") or []
        cur = next((q for q in quotes if q.get("id") == quote_id), None)
        if not cur:
            raise HTTPException(status_code=404, detail="Quote not found")
        q = await _clean_quote(d, body, [x for x in quotes if x.get("id") != quote_id])
        new = [{**cur, **q, "updated_at": _now().isoformat()} if x.get("id") == quote_id else x for x in quotes]
        await db.purchase_requests.update_one({"_id": d["_id"]}, {"$set": {"quotes": new, "updated_at": _now().isoformat()}})
        await create_audit_log(user["id"], user["name"], "vendor_quote_updated", "purchase_request", pr_id, None, {"vendor": q["vendor_name"]})
        return await _out(await _get(pr_id), detail=True)

    @router.delete("/purchase-requests/{pr_id}/quotes/{quote_id}")
    async def remove_quote(pr_id: str, quote_id: str, request: Request):
        user = await require_module(request, "module_purchase_inbound", "edit")
        d = await _get(pr_id)
        if d.get("status") not in OPEN_STATUSES:
            raise HTTPException(status_code=400, detail="This request is closed")
        quotes = [q for q in d.get("quotes") or [] if q.get("id") != quote_id]
        if len(quotes) == len(d.get("quotes") or []):
            raise HTTPException(status_code=404, detail="Quote not found")
        await db.purchase_requests.update_one({"_id": d["_id"]}, {"$set": {"quotes": quotes, "status": "quoting" if quotes else "open"}})
        await create_audit_log(user["id"], user["name"], "vendor_quote_removed", "purchase_request", pr_id)
        return await _out(await _get(pr_id), detail=True)

    @router.post("/purchase-requests/{pr_id}/select")
    async def select_quote(pr_id: str, body: SelectIn, request: Request):
        """Choose the vendor: makes the purchase order from that quote (pending approval)."""
        user = await get_current_user(request)          # Permissions → Purchases → "Choose the vendor quote" decides who may
        d = await _get(pr_id)
        if d.get("status") not in OPEN_STATUSES:
            raise HTTPException(status_code=400, detail="This request is already closed")
        s = await settings()
        quotes = d.get("quotes") or []
        chosen = next((q for q in quotes if q.get("id") == body.quote_id), None)
        if not chosen:
            raise HTTPException(status_code=404, detail="Quote not found")
        reason = (body.reason or "").strip()
        if len(quotes) < s["min_quotes"]:
            if user["role"] != "admin":
                raise HTTPException(status_code=400, detail=f"Get at least {s['min_quotes']} quotes before choosing ({len(quotes)} so far). An admin can go ahead with fewer, with a reason.")
            if len(reason) < 5:
                raise HTTPException(status_code=400, detail=f"Only {len(quotes)} quote{'s' if len(quotes) != 1 else ''} — say why you are going ahead without {s['min_quotes']}")
        lines = d.get("lines") or []
        totals = quote_totals(lines, chosen)
        if not totals["complete"]:
            raise HTTPException(status_code=400, detail=f"{chosen['vendor_name']} didn't price every line — choose a complete quote, or edit this one")
        info = await _vendor_info([q.get("vendor_id") for q in quotes])
        cmp_ = compare(lines, quotes, info, s["low_rating"])
        was_cheapest = cmp_["cheapest_id"] == chosen["id"]
        if not was_cheapest and len(reason) < 5:
            raise HTTPException(status_code=400, detail="This isn't the cheapest quote — say why you chose it (better delivery, quality, credit…)")
        v = await db.vendors.find_one({"_id": ObjectId(chosen["vendor_id"])}) if ObjectId.is_valid(chosen.get("vendor_id") or "") else None
        if v and v.get("blocked"):
            raise HTTPException(status_code=400, detail=f"{v.get('name')} is blocked")
        exp = body.expected_delivery or ((_now().date() + timedelta(days=int(chosen["delivery_days"]))).isoformat() if chosen.get("delivery_days") is not None else "")
        items = []
        for ln, ql in zip(lines, chosen.get("lines") or []):
            items.append({"name": ln["name"], "qty": _f(ln["qty"]), "unit_price": _f(ql.get("unit_price")), "gst_pct": _f(ql.get("gst_pct"), 18),
                          "inventory_item_id": ln.get("inventory_item_id") or None, "sku_code": ln.get("sku_code") or None, "unit": ln.get("unit")})
        if chosen.get("freight"):
            items.append({"name": "Freight", "qty": 1, "unit_price": _f(chosen["freight"]), "gst_pct": 0, "inventory_item_id": None, "sku_code": None, "service": True})
        sv = {"quotes": len(quotes), "chosen_total": totals["landed_total"], "average_total": cmp_["average_total"], "highest_total": cmp_["highest_total"],
              "vs_average": round((cmp_["average_total"] or 0) - totals["landed_total"], 2), "vs_highest": round((cmp_["highest_total"] or 0) - totals["landed_total"], 2),
              "was_cheapest": was_cheapest}
        note = f"From {d['number']}: {len(quotes)} quote{'s' if len(quotes) != 1 else ''} compared"
        if sv["vs_average"] > 0:
            note += f", ₹{sv['vs_average']:,.0f} below the average quote"
        if not was_cheapest:
            note += f". Not the cheapest — {reason}"
        po = await insert_purchase_order(user, supplier_name=chosen["vendor_name"], supplier_contact=(v or {}).get("phone") or "", items=items,
                                         expected_delivery=exp, notes=note + (f". {d['notes']}" if d.get("notes") else ""), location_id=d.get("location_id"),
                                         extra={"vendor_id": chosen["vendor_id"], "rfq_id": pr_id, "rfq_number": d["number"], "payment_terms": chosen.get("payment_terms")})
        now = _now().isoformat()
        await db.purchase_requests.update_one({"_id": d["_id"]}, {"$set": {
            "status": "ordered", "selected_quote_id": chosen["id"], "selected_vendor": chosen["vendor_name"], "selection_reason": reason or None,
            "fewer_quotes_reason": reason if len(quotes) < s["min_quotes"] else None, "selected_by": user["name"], "selected_at": now,
            "po_id": po["id"], "po_number": po["po_number"], "savings": sv},
            "$push": {"history": {"status": "ordered", "at": now, "by": user["name"], "vendor": chosen["vendor_name"]}}})
        await create_audit_log(user["id"], user["name"], "vendor_quote_selected", "purchase_request", pr_id, None,
                               {"vendor": chosen["vendor_name"], "po": po["po_number"], "total": totals["landed_total"], "cheapest": was_cheapest, "reason": reason or None})
        return {"ok": True, "po_id": po["id"], "po_number": po["po_number"], "savings": sv}

    @router.post("/purchase-requests/{pr_id}/cancel")
    async def cancel_request(pr_id: str, body: CancelIn, request: Request):
        user = await require_module(request, "module_purchase_inbound", "edit")
        d = await _get(pr_id)
        if d.get("status") not in OPEN_STATUSES:
            raise HTTPException(status_code=400, detail="This request is already closed")
        now = _now().isoformat()
        await db.purchase_requests.update_one({"_id": d["_id"]}, {"$set": {"status": "cancelled", "cancel_reason": (body.reason or "").strip() or None, "cancelled_at": now},
                                                                  "$push": {"history": {"status": "cancelled", "at": now, "by": user["name"]}}})
        await create_audit_log(user["id"], user["name"], "purchase_request_cancelled", "purchase_request", pr_id, None, {"reason": body.reason})
        return {"ok": True}

    async def calendar_items(start: date, end: date) -> List[Dict[str, Any]]:
        out = []
        async for d in db.purchase_requests.find({"status": {"$in": list(OPEN_STATUSES)}, "needed_by": {"$nin": [None, ""]}}):
            nb = str(d.get("needed_by"))[:10]
            if start.isoformat() <= nb <= end.isoformat():
                out.append({"date": nb, "title": f"Material needed: {d.get('title')}", "detail": f"{d['number']} · {len(d.get('quotes') or [])} quotes",
                            "source": "purchases", "link": f"/dashboard/purchase-inbound?tab=requests&pr={d['_id']}", "id": f"pr-{d['_id']}"})
        async for po in db.purchase_orders.find({"status": {"$in": ["pending", "approved"]}, "expected_delivery": {"$nin": [None, ""]}},
                                                {"expected_delivery": 1, "supplier_name": 1, "po_number": 1}):
            ed = str(po.get("expected_delivery"))[:10]
            if start.isoformat() <= ed <= end.isoformat():
                out.append({"date": ed, "title": f"Delivery due: {po.get('supplier_name')}", "detail": po.get("po_number"), "source": "purchases",
                            "link": "/dashboard/purchase-inbound", "id": f"po-{po['_id']}"})
        return out

    router.calendar_items = calendar_items
    return router
