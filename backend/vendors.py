"""Vendor / supplier directory (Iteration 44, upgraded Oct 2026).

* Directory: contact, GSTIN, location, payment terms, credit days, lead time, minimum order, tags, preferred / blocked.
* Ratings: quality, delivery, price and service (1–5) after an order, with a comment; the card shows the average.
* Scorecard: spend, orders, on-time delivery, average delay, QC pass rate and quotes won — from purchase orders and
  purchase requests (matched by vendor id, or by the supplier name on older POs).
* Price history: what each vendor charged for an item, so the cheapest source is one look away.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

RATING_KEYS = ("quality", "delivery", "price", "service")


class VendorCreate(BaseModel):
    name: str
    contact_person: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    gstin: Optional[str] = ""
    address: Optional[str] = ""
    district: Optional[str] = ""
    state: Optional[str] = ""
    payment_terms: Optional[str] = ""
    category: Optional[str] = ""  # panels | inverters | batteries | structure | transport | services | other
    notes: Optional[str] = ""
    tags: List[str] = []
    preferred: bool = False
    blocked: bool = False
    blocked_reason: Optional[str] = ""
    credit_days: Optional[int] = None
    lead_time_days: Optional[int] = None
    min_order_value: Optional[float] = None


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    address: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    payment_terms: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None
    tags: Optional[List[str]] = None
    preferred: Optional[bool] = None
    blocked: Optional[bool] = None
    blocked_reason: Optional[str] = None
    credit_days: Optional[int] = None
    lead_time_days: Optional[int] = None
    min_order_value: Optional[float] = None


class RatingIn(BaseModel):
    quality: int = Field(ge=1, le=5)
    delivery: int = Field(ge=1, le=5)
    price: int = Field(ge=1, le=5)
    service: int = Field(ge=1, le=5)
    comment: Optional[str] = None
    po_id: Optional[str] = None


def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d


def clean_tags(tags: Optional[List[str]]) -> List[str]:
    """Trim, drop blanks and case-insensitive repeats, keep at most 12. Pure."""
    out: List[str] = []
    for t in tags or []:
        t = re.sub(r"\s+", " ", str(t)).strip()[:30]
        if t and t.lower() not in {x.lower() for x in out}:
            out.append(t)
    return out[:12]


def rating_average(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Average of each part and the overall score (mean of the four parts). Pure."""
    if not rows:
        return {"overall": None, "count": 0, **{k: None for k in RATING_KEYS}}
    parts = {k: round(sum(float(r.get(k) or 0) for r in rows) / len(rows), 1) for k in RATING_KEYS}
    return {"overall": round(sum(parts.values()) / len(RATING_KEYS), 1), "count": len(rows), **parts}


def po_delivery(po: Dict[str, Any]) -> Optional[int]:
    """Days late (negative = early) for an arrived PO with an expected date, else None. Pure."""
    exp, arr = str(po.get("expected_delivery") or "")[:10], str(po.get("arrived_at") or "")[:10]
    if not exp or not arr:
        return None
    try:
        return (datetime.fromisoformat(arr).date() - datetime.fromisoformat(exp).date()).days
    except ValueError:
        return None


def scorecard(pos: List[Dict[str, Any]], since_iso: str) -> Dict[str, Any]:
    """Spend, orders, on-time %, average delay and QC pass % from a vendor's POs. Pure."""
    live = [p for p in pos if p.get("status") != "rejected"]
    recent = [p for p in live if str(p.get("created_at") or "") >= since_iso]
    delays = [d for d in (po_delivery(p) for p in live) if d is not None]
    qcs = [p for p in live if isinstance(p.get("qc"), dict)]
    return {
        "orders": len(live), "orders_12m": len(recent),
        "spend": round(sum(float(p.get("total_amount") or 0) for p in live), 2),
        "spend_12m": round(sum(float(p.get("total_amount") or 0) for p in recent), 2),
        "on_time_pct": round(sum(1 for d in delays if d <= 0) / len(delays) * 100, 1) if delays else None,
        "avg_delay_days": round(sum(max(d, 0) for d in delays) / len(delays), 1) if delays else None,
        "qc_pass_pct": round(sum(1 for p in qcs if (p["qc"].get("overall") or "pass") == "pass") / len(qcs) * 100, 1) if qcs else None,
        "last_order_date": max((str(p.get("created_at") or "")[:10] for p in live), default="") or None,
    }


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    async def _vendor(vendor_id: str) -> Dict[str, Any]:
        if not ObjectId.is_valid(vendor_id):
            raise HTTPException(status_code=400, detail="Invalid vendor id")
        v = await db.vendors.find_one({"_id": ObjectId(vendor_id)})
        if not v:
            raise HTTPException(status_code=404, detail="Vendor not found")
        return v

    def _po_query(v: Dict[str, Any]) -> Dict[str, Any]:
        return {"$or": [{"vendor_id": str(v["_id"])}, {"supplier_name": {"$regex": f"^{re.escape(v.get('name', ''))}$", "$options": "i"}}]}

    async def _all_ratings() -> Dict[str, List[Dict[str, Any]]]:
        out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        async for r in db.vendor_ratings.find({}):
            out[r.get("vendor_id")].append(r)
        return out

    def _check(payload: Dict[str, Any]) -> Dict[str, Any]:
        if "tags" in payload:
            payload["tags"] = clean_tags(payload.get("tags"))
        for k, lo, hi in (("credit_days", 0, 365), ("lead_time_days", 0, 365)):
            if payload.get(k) is not None and not (lo <= int(payload[k]) <= hi):
                raise HTTPException(status_code=400, detail=f"{k.replace('_', ' ').capitalize()} must be between {lo} and {hi}")
        if payload.get("min_order_value") is not None and float(payload["min_order_value"]) < 0:
            raise HTTPException(status_code=400, detail="Minimum order can't be negative")
        if payload.get("blocked") and not (payload.get("blocked_reason") or "").strip():
            raise HTTPException(status_code=400, detail="Say why this vendor is blocked")
        if payload.get("blocked"):
            payload["preferred"] = False
        return payload

    @router.get("/vendors")
    async def list_vendors(request: Request, search: Optional[str] = None,
                           category: Optional[str] = None, status: Optional[str] = None,
                           district: Optional[str] = None, sort: Optional[str] = None,
                           districts: Optional[str] = None, states: Optional[str] = None,
                           state: Optional[str] = None, tag: Optional[str] = None,
                           min_rating: Optional[float] = None, flag: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {}
        if status == "inactive":
            q["active"] = False
        elif status == "active" or not status:
            q["active"] = {"$ne": False}
        if category:
            q["category"] = category
        if district:
            q["district"] = {"$regex": f"^{re.escape(district)}$", "$options": "i"}
        if districts:  # older multi-select (comma separated)
            q["district"] = {"$in": [d.strip() for d in districts.split(",") if d.strip()]}
        if state:
            q["state"] = {"$regex": f"^{re.escape(state)}$", "$options": "i"}
        if states:
            q["state"] = {"$in": [s.strip() for s in states.split(",") if s.strip()]}
        if tag:
            q["tags"] = {"$regex": f"^{re.escape(tag)}$", "$options": "i"}
        if flag == "preferred":
            q["preferred"] = True
        elif flag == "blocked":
            q["blocked"] = True
        elif flag == "not_blocked":
            q["blocked"] = {"$ne": True}
        if search:
            s = re.escape(search)
            q["$or"] = [{"name": {"$regex": s, "$options": "i"}}, {"gstin": {"$regex": s, "$options": "i"}},
                        {"contact_person": {"$regex": s, "$options": "i"}}, {"tags": {"$regex": s, "$options": "i"}}]
        docs = await db.vendors.find(q).sort("name", 1).to_list(2000)
        ids = {str(d["_id"]): d for d in docs}
        by_name = {d.get("name", "").strip().lower(): str(d["_id"]) for d in docs}
        pos: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        if docs:
            async for po in db.purchase_orders.find({}, {"vendor_id": 1, "supplier_name": 1, "total_amount": 1, "created_at": 1, "status": 1,
                                                         "expected_delivery": 1, "arrived_at": 1, "qc": 1}):
                vid = po.get("vendor_id") if po.get("vendor_id") in ids else by_name.get(str(po.get("supplier_name") or "").strip().lower())
                if vid:
                    pos[vid].append(po)
        ratings = await _all_ratings()
        since = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        out = []
        for vid, d in ids.items():
            row = _clean(d)
            sc = scorecard(pos.get(vid, []), since)
            rt = rating_average(ratings.get(vid, []))
            row.update({"business_value": sc["spend"], "last_order_date": sc["last_order_date"], "orders": sc["orders"],
                        "on_time_pct": sc["on_time_pct"], "rating": rt["overall"], "ratings_count": rt["count"], "tags": row.get("tags") or []})
            if min_rating and (rt["overall"] or 0) < min_rating:
                continue
            out.append(row)
        key = {"business_desc": (lambda r: -(r.get("business_value") or 0)),
               "recent_asc": (lambda r: r.get("last_order_date") or "9999-99-99"), "rating_desc": (lambda r: -(r.get("rating") or 0)),
               "location_asc": (lambda r: ((r.get("state") or "zzz").lower(), (r.get("district") or "zzz").lower(), (r.get("name") or "").lower()))}.get(sort)
        if sort == "recent_desc":
            out.sort(key=lambda r: r.get("last_order_date") or "", reverse=True)
        elif key:
            out.sort(key=key)
        out.sort(key=lambda r: (bool(r.get("blocked")), not r.get("preferred")))  # preferred first, blocked last (stable)
        return out

    @router.get("/vendors/tags")
    async def vendor_tags(request: Request):
        await get_current_user(request)
        counts: Dict[str, int] = defaultdict(int)
        names: Dict[str, str] = {}
        async for v in db.vendors.find({"active": {"$ne": False}}, {"tags": 1}):
            for t in v.get("tags") or []:
                counts[t.lower()] += 1
                names.setdefault(t.lower(), t)
        return [{"tag": names[k], "count": n} for k, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]

    @router.get("/vendors/price-history")
    async def price_history(request: Request, item_id: Optional[str] = None, name: Optional[str] = None):
        """What each vendor charged for an item on past POs (by stock item, or by line name), cheapest first."""
        await get_current_user(request)
        if not item_id and not name:
            raise HTTPException(status_code=400, detail="Give an item")
        rows: Dict[str, Dict[str, Any]] = {}
        by_name = {str(v.get("name") or "").strip().lower(): (str(v["_id"]), v.get("name")) async for v in db.vendors.find({}, {"name": 1})}
        async for po in db.purchase_orders.find({"status": {"$ne": "rejected"}}, {"items": 1, "supplier_name": 1, "vendor_id": 1, "created_at": 1}):
            for ln in po.get("items") or []:
                hit = (item_id and str(ln.get("inventory_item_id") or "") == item_id) or (not item_id and name and str(ln.get("name") or "").strip().lower() == name.strip().lower())
                if not hit or not float(ln.get("unit_price") or 0):
                    continue
                nm = str(po.get("supplier_name") or "").strip().lower()
                vid, vname = (po.get("vendor_id"), po.get("supplier_name")) if po.get("vendor_id") else by_name.get(nm, (None, po.get("supplier_name")))
                k = vid or nm
                r = rows.setdefault(k, {"vendor_id": vid, "vendor": vname, "prices": [], "last_date": ""})
                r["prices"].append((str(po.get("created_at") or "")[:10], float(ln["unit_price"])))
        out = []
        for r in rows.values():
            r["prices"].sort()
            ps = [p for _, p in r["prices"]]
            out.append({"vendor_id": r["vendor_id"], "vendor": r["vendor"], "last_price": ps[-1], "last_date": r["prices"][-1][0],
                        "min_price": min(ps), "avg_price": round(sum(ps) / len(ps), 2), "times": len(ps)})
        out.sort(key=lambda r: r["last_price"])
        return out

    @router.post("/vendors")
    async def create_vendor(payload: VendorCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        doc = _check(payload.model_dump())
        doc["name"] = doc["name"].strip()
        if not doc["name"]:
            raise HTTPException(status_code=400, detail="Enter the vendor's name")
        if await db.vendors.find_one({"name": {"$regex": f"^{re.escape(doc['name'])}$", "$options": "i"}, "active": {"$ne": False}}):
            raise HTTPException(status_code=400, detail="A vendor with this name already exists")
        doc["active"] = True
        doc["created_at"] = datetime.now(timezone.utc).isoformat()
        result = await db.vendors.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "create", "vendor", str(result.inserted_id), None, {"name": doc["name"]})
        return _clean({**doc, "_id": result.inserted_id})

    @router.put("/vendors/{vendor_id}")
    async def update_vendor(vendor_id: str, payload: VendorUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        existing = await _vendor(vendor_id)
        update = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None or k in ("credit_days", "lead_time_days", "min_order_value")}
        merged = {**existing, **update}
        _check({**update, "blocked": merged.get("blocked"), "blocked_reason": merged.get("blocked_reason")})
        if "tags" in update:
            update["tags"] = clean_tags(update["tags"])
        if merged.get("blocked"):
            update["preferred"] = False
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.vendors.update_one({"_id": existing["_id"]}, {"$set": update})
        await create_audit_log(user["id"], user["name"], "update", "vendor", vendor_id, _clean(existing), update)
        return _clean(await db.vendors.find_one({"_id": existing["_id"]}))

    @router.delete("/vendors/{vendor_id}")
    async def delete_vendor(vendor_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        existing = await _vendor(vendor_id)
        await db.vendors.update_one({"_id": existing["_id"]}, {"$set": {"active": False}})
        await create_audit_log(user["id"], user["name"], "delete", "vendor", vendor_id)
        return {"message": "Vendor archived"}

    @router.get("/vendors/{vendor_id}/purchase-orders")
    async def vendor_purchase_orders(vendor_id: str, request: Request):
        await get_current_user(request)
        vendor = await _vendor(vendor_id)
        pos = await db.purchase_orders.find(_po_query(vendor)).sort("created_at", -1).to_list(500)
        rows = [{
            "id": str(po["_id"]), "po_number": po.get("po_number"), "items_count": len(po.get("items", [])),
            "total": round(po.get("total_amount", 0) or 0, 2), "status": po.get("status", ""),
            "date": (po.get("created_at") or "")[:10], "late_days": po_delivery(po), "qc": (po.get("qc") or {}).get("overall"),
            "rated": bool(await db.vendor_ratings.find_one({"vendor_id": vendor_id, "po_id": str(po["_id"])}, {"_id": 1})),
        } for po in pos]
        return {"vendor": _clean(vendor), "purchase_orders": rows, "total_value": round(sum(r["total"] for r in rows), 2)}

    @router.get("/vendors/{vendor_id}/scorecard")
    async def vendor_scorecard(vendor_id: str, request: Request):
        await get_current_user(request)
        vendor = await _vendor(vendor_id)
        pos = await db.purchase_orders.find(_po_query(vendor)).to_list(2000)
        since = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        sc = scorecard(pos, since)
        ratings = [r async for r in db.vendor_ratings.find({"vendor_id": vendor_id}).sort("at", -1)]
        asked = won = 0
        async for pr in db.purchase_requests.find({"quotes.vendor_id": vendor_id}, {"quotes": 1, "selected_quote_id": 1}):
            asked += 1
            if any(q.get("id") == pr.get("selected_quote_id") and q.get("vendor_id") == vendor_id for q in pr.get("quotes") or []):
                won += 1
        # what they charge, item by item, against the cheapest anyone charged
        mine: Dict[str, Dict[str, Any]] = {}
        best: Dict[str, float] = {}
        async for po in db.purchase_orders.find({"status": {"$ne": "rejected"}}, {"items": 1, "vendor_id": 1, "supplier_name": 1, "created_at": 1}):
            is_mine = po.get("vendor_id") == vendor_id or str(po.get("supplier_name") or "").strip().lower() == vendor.get("name", "").strip().lower()
            for ln in po.get("items") or []:
                k = str(ln.get("inventory_item_id") or "") or str(ln.get("name") or "").strip().lower()
                p = float(ln.get("unit_price") or 0)
                if not k or not p:
                    continue
                best[k] = min(best.get(k, p), p)
                if is_mine:
                    d = str(po.get("created_at") or "")[:10]
                    if k not in mine or d >= mine[k]["date"]:
                        mine[k] = {"item": ln.get("name"), "last_price": p, "date": d}
        prices = [{**v, "best_price": best.get(k), "above_best_pct": round((v["last_price"] - best[k]) / best[k] * 100, 1) if best.get(k) else None}
                  for k, v in mine.items()]
        prices.sort(key=lambda r: -(r["above_best_pct"] or 0))
        return {"vendor": _clean(vendor), **sc, "rating": rating_average(ratings), "quotes_asked": asked, "quotes_won": won,
                "quote_win_pct": round(won / asked * 100, 1) if asked else None, "prices": prices[:50],
                "ratings": [{**{k: v for k, v in r.items() if k != "_id"}, "id": str(r["_id"])} for r in ratings[:30]]}

    @router.post("/vendors/{vendor_id}/ratings")
    async def rate_vendor(vendor_id: str, body: RatingIn, request: Request):
        user = await require_role("admin", "manager")(request)
        vendor = await _vendor(vendor_id)
        if body.po_id and await db.vendor_ratings.find_one({"vendor_id": vendor_id, "po_id": body.po_id}):
            raise HTTPException(status_code=400, detail="This order is already rated")
        doc = {**body.model_dump(), "vendor_id": vendor_id, "comment": (body.comment or "").strip()[:500] or None,
               "by": user["name"], "by_id": user["id"], "at": datetime.now(timezone.utc).isoformat()}
        res = await db.vendor_ratings.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "vendor_rated", "vendor", vendor_id, None,
                               {k: doc[k] for k in RATING_KEYS} | {"vendor": vendor.get("name")})
        return {**{k: v for k, v in doc.items() if k != "_id"}, "id": str(res.inserted_id)}

    @router.delete("/vendors/{vendor_id}/ratings/{rating_id}")
    async def delete_rating(vendor_id: str, rating_id: str, request: Request):
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can remove a rating")
        r = await db.vendor_ratings.delete_one({"_id": ObjectId(rating_id) if ObjectId.is_valid(rating_id) else None, "vendor_id": vendor_id})
        if not r.deleted_count:
            raise HTTPException(status_code=404, detail="Rating not found")
        await create_audit_log(user["id"], user["name"], "vendor_rating_removed", "vendor", vendor_id)
        return {"ok": True}

    return router
