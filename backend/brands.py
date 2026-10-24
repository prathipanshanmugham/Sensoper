"""Brands (Oct 2026): our own brands (with trademarks and logos) and the brands we hold a dealership or distribution for.

* A brand has a logo, a kind (own / dealership / distribution), contacts and — for dealer brands — the agreement
  (territory, dates, margin, yearly target).
* Trademarks belong to a brand: classes, application and registration numbers, status, renewal date. Renewals and
  "next action" dates plan bell notes and show on the event calendar.
* Stock items carry `brand_id`; the brand report adds up stock, purchases, sales (counter, online, projects) and
  returns per brand for a period.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import notify

KINDS = ("own", "dealership", "distribution")
KIND_LABEL = {"own": "Our brand", "dealership": "Dealership", "distribution": "Distribution"}
TM_STATUSES = ("planned", "filed", "formalities_check", "examined", "objected", "accepted", "advertised", "opposed",
               "registered", "refused", "abandoned", "withdrawn")
TM_LIVE = {"filed", "formalities_check", "examined", "objected", "accepted", "advertised", "opposed", "registered"}
WON = ("approved", "completed")
PHOTO_RX = re.compile(r"[\w\-]+/(images|documents)/[\w\-]+\.(png|jpe?g|webp|gif|pdf)", re.I)


def _f(v, d: float = 0.0) -> float:
    try:
        x = float(v)
        return x if math.isfinite(x) else d
    except (TypeError, ValueError):
        return d


def _oid(v: str) -> ObjectId:
    if not v or not ObjectId.is_valid(str(v)):
        raise HTTPException(status_code=404, detail="Not found")
    return ObjectId(str(v))


def _ser(d: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d


def add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year + years, day=28)


def renewal_date(tm: Dict[str, Any]) -> Optional[date]:
    """When the mark must be renewed: the date saved, else 10 years from filing once it is registered (India). Pure."""
    v = notify.to_date(tm.get("valid_until"))
    if v:
        return v
    filed = notify.to_date(tm.get("filing_date"))
    if filed and tm.get("status") == "registered":
        return add_years(filed, 10)
    return None


def month_keys(start: date, end: date) -> List[str]:
    keys, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        keys.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return keys


class Contact(BaseModel):
    company: Optional[str] = None
    person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class Agreement(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    territory: Optional[str] = None
    margin_pct: Optional[float] = None
    target_amount: Optional[float] = None
    credit_days: Optional[int] = None
    notes: Optional[str] = None


class BrandIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: str = "own"
    logo_path: Optional[str] = None
    tagline: Optional[str] = None
    website: Optional[str] = None
    categories: List[str] = []
    contact: Contact = Contact()
    agreement: Agreement = Agreement()
    notes: Optional[str] = None
    active: bool = True


class TrademarkIn(BaseModel):
    mark: str = Field(min_length=1, max_length=120)           # the word or the logo description
    mark_type: str = "word"                                    # word | logo | word_and_logo
    classes: List[int] = []
    application_number: Optional[str] = None
    filing_date: Optional[str] = None
    status: str = "planned"
    registration_number: Optional[str] = None
    registration_date: Optional[str] = None
    valid_until: Optional[str] = None
    agent: Optional[str] = None
    office: Optional[str] = None
    next_action: Optional[str] = None
    next_action_date: Optional[str] = None
    documents: List[str] = []
    notes: Optional[str] = None


class LinkIn(BaseModel):
    item_ids: List[str]


def create_router(db, get_current_user, require_role, create_audit_log, get_permissions):
    router = APIRouter()

    async def _editor(request: Request) -> Dict[str, Any]:
        return await require_role("admin", "manager")(request)

    def _check_dates(**dates: Optional[str]) -> None:
        for label, v in dates.items():
            if v and not notify.to_date(v):
                raise HTTPException(status_code=400, detail=f"{label.replace('_', ' ').capitalize()} must be a date (YYYY-MM-DD)")

    def _clean_brand(body: BrandIn) -> Dict[str, Any]:
        if body.kind not in KINDS:
            raise HTTPException(status_code=400, detail="Kind must be own, dealership or distribution")
        logo = (body.logo_path or "").strip() or None
        if logo and not PHOTO_RX.fullmatch(logo):
            raise HTTPException(status_code=400, detail="Upload the logo as a picture first")
        _check_dates(agreement_start=body.agreement.start_date, agreement_end=body.agreement.end_date)
        a = body.agreement.model_dump()
        if a.get("margin_pct") is not None and not (0 <= a["margin_pct"] <= 100):
            raise HTTPException(status_code=400, detail="Margin must be between 0 and 100%")
        return {**body.model_dump(), "name": body.name.strip(), "logo_path": logo, "agreement": a,
                "categories": [str(c).strip()[:40] for c in body.categories if str(c).strip()][:12]}

    async def _plan_brand_notes(b: Dict[str, Any]) -> None:
        bid = str(b["_id"])
        await notify.clear(db, "brand_agreement", "brand", bid)
        end = notify.to_date((b.get("agreement") or {}).get("end_date"))
        if b.get("kind") != "own" and end and b.get("active", True):
            people = await notify.users_who_can(db, get_permissions, "module_brands")
            for days in (60, 15):
                when = end - timedelta(days=days)
                await notify.plan(db, kind="brand_agreement", source_type="brand", source_id=bid, user_ids=people, tag=f"d{days}",
                                  title=f"{b['name']} {KIND_LABEL[b['kind']].lower()} ends {end.strftime('%d %b %Y')}",
                                  message="Renew the agreement or plan the stock.", link=f"/dashboard/brands?brand={bid}",
                                  notify_at=notify.morning_of(max(when, notify.today_ist())))

    async def _plan_tm_notes(tm: Dict[str, Any], brand_name: str) -> None:
        tid = str(tm["_id"])
        await notify.clear(db, "trademark", "trademark", tid)
        people = await notify.users_who_can(db, get_permissions, "module_brands")
        due = renewal_date(tm)
        if due and tm.get("status") in TM_LIVE:
            for days in (180, 60, 15):
                when = due - timedelta(days=days)
                if when < notify.today_ist() - timedelta(days=days):
                    continue
                await notify.plan(db, kind="trademark", source_type="trademark", source_id=tid, user_ids=people, tag=f"renew{days}",
                                  title=f"Renew trademark {tm['mark']} ({brand_name})", message=f"Valid until {due.strftime('%d %b %Y')}",
                                  link=f"/dashboard/brands?brand={tm['brand_id']}", notify_at=notify.morning_of(max(when, notify.today_ist())))
        nxt = notify.to_date(tm.get("next_action_date"))
        if nxt and tm.get("next_action"):
            when = nxt - timedelta(days=7)
            await notify.plan(db, kind="trademark", source_type="trademark", source_id=tid, user_ids=people, tag="next",
                              title=f"Trademark {tm['mark']}: {tm['next_action']}", message=f"Due {nxt.strftime('%d %b %Y')} · {brand_name}",
                              link=f"/dashboard/brands?brand={tm['brand_id']}", notify_at=notify.morning_of(max(when, notify.today_ist())))

    def _tm_out(t: Dict[str, Any]) -> Dict[str, Any]:
        out = _ser(t)
        due = renewal_date(t)
        out["renewal_due"] = due.isoformat() if due else None
        out["days_to_renewal"] = (due - notify.today_ist()).days if due else None
        return out

    # ═══════════════ brands ═══════════════
    @router.get("/brands")
    async def list_brands(request: Request, kind: Optional[str] = None, include_inactive: bool = False):
        await get_current_user(request)
        q: Dict[str, Any] = {} if include_inactive else {"active": {"$ne": False}}
        if kind:
            q["kind"] = kind
        items: Dict[str, Dict[str, float]] = defaultdict(lambda: {"items": 0, "stock_qty": 0.0, "stock_value": 0.0})
        async for it in db.inventory_items.find({"brand_id": {"$nin": [None, ""]}}, {"brand_id": 1, "quantity": 1, "unit_price": 1}):
            r = items[it["brand_id"]]
            r["items"] += 1
            r["stock_qty"] += _f(it.get("quantity"))
            r["stock_value"] += _f(it.get("quantity")) * _f(it.get("unit_price"))
        tms: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        async for t in db.trademarks.find({}):
            tms[t.get("brand_id")].append(t)
        rows = []
        async for b in db.brands.find(q).sort("name", 1):
            bid = str(b["_id"])
            marks = tms.get(bid, [])
            dues = sorted(d for d in (renewal_date(t) for t in marks if t.get("status") in TM_LIVE) if d)
            rows.append({**_ser(b), **{k: round(v, 2) for k, v in items[bid].items()}, "trademarks": len(marks),
                         "registered": sum(1 for t in marks if t.get("status") == "registered"),
                         "next_renewal": dues[0].isoformat() if dues else None})
        return rows

    @router.post("/brands")
    async def create_brand(body: BrandIn, request: Request):
        user = await _editor(request)
        doc = _clean_brand(body)
        if await db.brands.find_one({"name": {"$regex": f"^{re.escape(doc['name'])}$", "$options": "i"}}):
            raise HTTPException(status_code=400, detail="A brand with this name already exists")
        doc.update({"created_at": notify.now_utc().isoformat(), "created_by": user["name"]})
        res = await db.brands.insert_one(doc)
        doc["_id"] = res.inserted_id
        await _plan_brand_notes(doc)
        await create_audit_log(user["id"], user["name"], "brand_created", "brand", str(res.inserted_id), None, {"name": doc["name"], "kind": doc["kind"]})
        return _ser(doc)

    @router.get("/brands/report")
    async def brand_report(request: Request, start: Optional[str] = None, end: Optional[str] = None):
        await get_current_user(request)
        today = notify.today_ist()
        d_end = notify.to_date(end) or today
        d_start = notify.to_date(start) or (d_end.replace(day=1) - timedelta(days=330)).replace(day=1)
        if d_start > d_end:
            raise HTTPException(status_code=400, detail="Start must be before end")
        s0, s1 = d_start.isoformat(), d_end.isoformat()
        in_period = lambda v: bool(v) and s0 <= str(v)[:10] <= s1  # noqa: E731
        months = month_keys(d_start, d_end)
        brands = {str(b["_id"]): b async for b in db.brands.find({})}
        item_brand: Dict[str, str] = {}
        names_by_brand: Dict[str, set] = defaultdict(set)
        rows: Dict[str, Dict[str, Any]] = {}

        def row(bid: str) -> Dict[str, Any]:
            if bid not in rows:
                b = brands.get(bid) or {}
                rows[bid] = {"brand_id": bid if b else None, "name": b.get("name") or "No brand set", "kind": b.get("kind"), "logo_path": b.get("logo_path"),
                             "items": 0, "stock_qty": 0.0, "stock_value": 0.0, "purchased_qty": 0.0, "purchased_value": 0.0,
                             "sold_qty": 0.0, "counter_sales": 0.0, "online_sales": 0.0, "project_sales": 0.0, "projects": 0, "project_kw": 0.0,
                             "margin": 0.0, "returns": 0, "returned_qty": 0.0, "target_amount": _f(((b.get("agreement") or {}).get("target_amount"))),
                             "monthly": {m: {"counter": 0.0, "online": 0.0, "projects": 0.0} for m in months}}
            return rows[bid]

        for bid in brands:
            row(bid)
        async for it in db.inventory_items.find({}, {"brand_id": 1, "quantity": 1, "unit_price": 1, "name": 1}):
            bid = it.get("brand_id") or ""
            item_brand[str(it["_id"])] = bid
            if bid:
                r = row(bid)
                r["items"] += 1
                r["stock_qty"] += _f(it.get("quantity"))
                r["stock_value"] += _f(it.get("quantity")) * _f(it.get("unit_price"))
                names_by_brand[bid].add(str(it.get("name") or "").strip().lower())

        def add_sale(item_id: Optional[str], qty: float, value: float, when: str, channel: str, margin: float = 0.0) -> None:
            bid = item_brand.get(str(item_id or ""), "")
            r = row(bid)
            r["sold_qty"] += qty
            r[channel] += value
            r["margin"] += margin
            m = str(when)[:7]
            if m in r["monthly"]:
                r["monthly"][m][{"counter_sales": "counter", "online_sales": "online", "project_sales": "projects"}[channel]] += value

        async for po in db.purchase_orders.find({"status": {"$ne": "rejected"}}, {"items": 1, "created_at": 1}):
            if not in_period(po.get("created_at")):
                continue
            for ln in po.get("items") or []:
                bid = item_brand.get(str(ln.get("inventory_item_id") or ""), "")
                if bid:
                    r = row(bid)
                    r["purchased_qty"] += _f(ln.get("qty"))
                    r["purchased_value"] += _f(ln.get("qty")) * _f(ln.get("unit_price"))
        async for s in db.sales.find({"status": {"$nin": ["cancelled", "returned"]}}, {"lines": 1, "sale_date": 1, "created_at": 1}):
            when = s.get("sale_date") or s.get("created_at")
            if not in_period(when):
                continue
            for ln in s.get("lines") or []:
                qty = _f(ln.get("quantity"))
                value = _f(ln.get("line_total")) or qty * _f(ln.get("unit_price"))
                add_sale(ln.get("inventory_item_id"), qty, value, when, "counter_sales", _f(ln.get("margin_amount")))
        async for o in db.ecommerce_orders.find({"order_status": {"$nin": ["cancelled", "returned"]}}, {"lines": 1, "order_date": 1}):
            if not in_period(o.get("order_date")):
                continue
            for ln in o.get("lines") or []:
                qty = _f(ln.get("quantity"))
                add_sale(ln.get("inventory_item_id"), qty, qty * _f(ln.get("sold_price")), o.get("order_date"), "online_sales")
        async for p in db.projects.find({"status": {"$in": list(WON)}, "deleted_at": {"$exists": False}},
                                        {"custom_fields.proposed_solution": 1, "cost_estimation.items_breakdown": 1, "cost_estimation.system_lines": 1,
                                         "approved_at": 1, "completed_at": 1, "created_at": 1}):
            when = p.get("approved_at") or p.get("completed_at") or p.get("created_at")
            if not in_period(when):
                continue
            ps = ((p.get("custom_fields") or {}).get("proposed_solution") or {})
            lines = ((p.get("cost_estimation") or {}).get("system_lines") or (ps.get("_quick") or {}).get("lines") or {})
            seen = set()
            for key, line_key, qty in (("panel_item_id", "panels", _f(ps.get("panel_count") or (ps.get("_quick") or {}).get("panel_count"))),
                                       ("inverter_item_id", "inverter", 1.0), ("battery_item_id", "battery", _f((ps.get("_quick") or {}).get("battery_count")) or 1.0)):
                iid = ps.get(key)
                if not iid or not item_brand.get(str(iid)):
                    continue
                value = _f(((lines or {}).get(line_key) or {}).get("amount"))
                add_sale(iid, qty, value, when, "project_sales")
                bid = item_brand[str(iid)]
                if key == "panel_item_id":
                    row(bid)["project_kw"] += _f(ps.get("system_size_kw"))
                seen.add(bid)
            for ln in ((p.get("cost_estimation") or {}).get("items_breakdown") or []):
                iid = ln.get("inventory_item_id")
                if iid and item_brand.get(str(iid)):
                    add_sale(iid, _f(ln.get("quantity")), _f(ln.get("quantity")) * _f(ln.get("unit_price")), when, "project_sales")
                    seen.add(item_brand[str(iid)])
            for bid in seen:
                row(bid)["projects"] += 1
        async for rt in db.brand_returns.find({}, {"item_name": 1, "quantity": 1, "created_at": 1}):
            if not in_period(rt.get("created_at")):
                continue
            nm = str(rt.get("item_name") or "").strip().lower()
            for bid, b in brands.items():
                if nm and (nm in names_by_brand.get(bid, set()) or str(b.get("name") or "").lower() in nm):
                    r = row(bid)
                    r["returns"] += 1
                    r["returned_qty"] += _f(rt.get("quantity"))
                    break

        out = []
        for r in rows.values():
            sales = r["counter_sales"] + r["online_sales"] + r["project_sales"]
            if r["brand_id"] is None and not sales:
                continue
            r = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()}
            r["sales"] = round(sales, 2)
            r["monthly"] = [{"month": m, **{k: round(x, 2) for k, x in v.items()}, "sales": round(sum(v.values()), 2)} for m, v in r["monthly"].items()]
            r["target_pct"] = round(sales / r["target_amount"] * 100, 1) if r["target_amount"] else None
            out.append(r)
        out.sort(key=lambda r: (r["brand_id"] is None, -r["sales"], r["name"].lower()))
        total_sales = sum(r["sales"] for r in out)
        for r in out:
            r["share_pct"] = round(r["sales"] / total_sales * 100, 1) if total_sales else 0.0
        by_kind = defaultdict(float)
        for r in out:
            by_kind[r.get("kind") or "none"] += r["sales"]
        return {"period": {"start": s0, "end": s1}, "months": months, "rows": out,
                "totals": {"sales": round(total_sales, 2), "stock_value": round(sum(r["stock_value"] for r in out), 2),
                           "purchased_value": round(sum(r["purchased_value"] for r in out), 2), "margin": round(sum(r["margin"] for r in out), 2),
                           "unbranded_sales": round(sum(r["sales"] for r in out if r["brand_id"] is None), 2),
                           "brands": len(brands), "own": sum(1 for b in brands.values() if b.get("kind") == "own")},
                "by_kind": {k: round(v, 2) for k, v in by_kind.items()}}

    @router.get("/brands/trademarks")
    async def all_trademarks(request: Request):
        await get_current_user(request)
        names = {str(b["_id"]): b.get("name") async for b in db.brands.find({}, {"name": 1})}
        rows = [{**_tm_out(t), "brand_name": names.get(t.get("brand_id"))} async for t in db.trademarks.find({})]
        rows.sort(key=lambda r: (r["renewal_due"] or "9999", r["mark"].lower()))
        return rows

    @router.get("/brands/{brand_id}")
    async def get_brand(brand_id: str, request: Request):
        await get_current_user(request)
        b = await db.brands.find_one({"_id": _oid(brand_id)})
        if not b:
            raise HTTPException(status_code=404, detail="Brand not found")
        items = [{"id": str(i["_id"]), "name": i.get("name"), "sku_code": i.get("sku_code"), "category": i.get("category"),
                  "quantity": i.get("quantity"), "unit_price": i.get("unit_price")}
                 async for i in db.inventory_items.find({"brand_id": brand_id}).sort("name", 1)]
        marks = [_tm_out(t) async for t in db.trademarks.find({"brand_id": brand_id}).sort("created_at", 1)]
        return {**_ser(b), "items": items, "trademarks": marks}

    @router.put("/brands/{brand_id}")
    async def update_brand(brand_id: str, body: BrandIn, request: Request):
        user = await _editor(request)
        cur = await db.brands.find_one({"_id": _oid(brand_id)})
        if not cur:
            raise HTTPException(status_code=404, detail="Brand not found")
        doc = _clean_brand(body)
        clash = await db.brands.find_one({"name": {"$regex": f"^{re.escape(doc['name'])}$", "$options": "i"}, "_id": {"$ne": cur["_id"]}})
        if clash:
            raise HTTPException(status_code=400, detail="Another brand already has this name")
        doc["updated_at"] = notify.now_utc().isoformat()
        await db.brands.update_one({"_id": cur["_id"]}, {"$set": doc})
        fresh = await db.brands.find_one({"_id": cur["_id"]})
        await _plan_brand_notes(fresh)
        await create_audit_log(user["id"], user["name"], "brand_updated", "brand", brand_id, {"name": cur.get("name")}, {"name": doc["name"]})
        return _ser(fresh)

    @router.delete("/brands/{brand_id}")
    async def delete_brand(brand_id: str, request: Request):
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can delete a brand")
        b = await db.brands.find_one({"_id": _oid(brand_id)})
        if not b:
            raise HTTPException(status_code=404, detail="Brand not found")
        if await db.trademarks.count_documents({"brand_id": brand_id}):
            raise HTTPException(status_code=400, detail="This brand has trademarks — delete them first, or switch the brand off instead")
        unlinked = (await db.inventory_items.update_many({"brand_id": brand_id}, {"$unset": {"brand_id": ""}})).modified_count
        await db.brands.delete_one({"_id": b["_id"]})
        await notify.clear(db, "brand_agreement", "brand", brand_id)
        await create_audit_log(user["id"], user["name"], "brand_deleted", "brand", brand_id, _ser(b), None, f"{unlinked} items unlinked")
        return {"ok": True, "items_unlinked": unlinked}

    # ── stock items of a brand ──
    @router.get("/brands/{brand_id}/suggest-items")
    async def suggest_items(brand_id: str, request: Request):
        """Stock items with no brand whose name mentions this brand — one tap links them."""
        await get_current_user(request)
        b = await db.brands.find_one({"_id": _oid(brand_id)}, {"name": 1})
        if not b:
            raise HTTPException(status_code=404, detail="Brand not found")
        word = re.escape(b["name"].strip())
        q = {"name": {"$regex": rf"(^|\W){word}(\W|$)", "$options": "i"}, "$or": [{"brand_id": {"$exists": False}}, {"brand_id": None}, {"brand_id": ""}]}
        return [{"id": str(i["_id"]), "name": i.get("name"), "sku_code": i.get("sku_code"), "category": i.get("category")}
                async for i in db.inventory_items.find(q).sort("name", 1).limit(200)]

    @router.post("/brands/{brand_id}/items")
    async def link_items(brand_id: str, body: LinkIn, request: Request):
        user = await _editor(request)
        if not await db.brands.find_one({"_id": _oid(brand_id)}, {"_id": 1}):
            raise HTTPException(status_code=404, detail="Brand not found")
        ids = [ObjectId(i) for i in body.item_ids if ObjectId.is_valid(i)][:500]
        n = (await db.inventory_items.update_many({"_id": {"$in": ids}}, {"$set": {"brand_id": brand_id}})).modified_count
        await create_audit_log(user["id"], user["name"], "brand_items_linked", "brand", brand_id, None, {"items": n})
        return {"linked": n}

    @router.delete("/brands/{brand_id}/items/{item_id}")
    async def unlink_item(brand_id: str, item_id: str, request: Request):
        user = await _editor(request)
        r = await db.inventory_items.update_one({"_id": _oid(item_id), "brand_id": brand_id}, {"$unset": {"brand_id": ""}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="That item isn't linked to this brand")
        await create_audit_log(user["id"], user["name"], "brand_item_unlinked", "brand", brand_id, None, {"item_id": item_id})
        return {"ok": True}

    # ── trademarks ──
    def _clean_tm(body: TrademarkIn) -> Dict[str, Any]:
        if body.status not in TM_STATUSES:
            raise HTTPException(status_code=400, detail="Unknown trademark status")
        if body.mark_type not in ("word", "logo", "word_and_logo"):
            raise HTTPException(status_code=400, detail="Mark type must be word, logo or word_and_logo")
        classes = sorted({int(c) for c in body.classes})
        if any(c < 1 or c > 45 for c in classes):
            raise HTTPException(status_code=400, detail="Trademark classes run from 1 to 45")
        _check_dates(filing_date=body.filing_date, registration_date=body.registration_date, valid_until=body.valid_until,
                     next_action_date=body.next_action_date)
        if body.status != "planned" and not (body.application_number or "").strip():
            raise HTTPException(status_code=400, detail="Enter the application number once the mark is filed")
        if body.status == "registered" and not (body.filing_date or body.valid_until):
            raise HTTPException(status_code=400, detail="Enter the filing date (or the valid-until date) for a registered mark")
        docs = [p for p in body.documents if isinstance(p, str) and PHOTO_RX.fullmatch(p)][:12]
        return {**body.model_dump(), "mark": body.mark.strip(), "classes": classes, "documents": docs}

    @router.post("/brands/{brand_id}/trademarks")
    async def add_trademark(brand_id: str, body: TrademarkIn, request: Request):
        user = await _editor(request)
        b = await db.brands.find_one({"_id": _oid(brand_id)}, {"name": 1})
        if not b:
            raise HTTPException(status_code=404, detail="Brand not found")
        doc = {**_clean_tm(body), "brand_id": brand_id, "created_at": notify.now_utc().isoformat(), "created_by": user["name"],
               "history": [{"status": body.status, "at": notify.now_utc().isoformat(), "by": user["name"]}]}
        res = await db.trademarks.insert_one(doc)
        doc["_id"] = res.inserted_id
        await _plan_tm_notes(doc, b["name"])
        await create_audit_log(user["id"], user["name"], "trademark_added", "trademark", str(res.inserted_id), None, {"mark": doc["mark"], "brand": b["name"]})
        return _tm_out(doc)

    @router.put("/brands/trademarks/{tm_id}")
    async def update_trademark(tm_id: str, body: TrademarkIn, request: Request):
        user = await _editor(request)
        cur = await db.trademarks.find_one({"_id": _oid(tm_id)})
        if not cur:
            raise HTTPException(status_code=404, detail="Trademark not found")
        doc = _clean_tm(body)
        upd: Dict[str, Any] = {"$set": {**doc, "updated_at": notify.now_utc().isoformat()}}
        if doc["status"] != cur.get("status"):
            upd["$push"] = {"history": {"status": doc["status"], "at": notify.now_utc().isoformat(), "by": user["name"]}}
        await db.trademarks.update_one({"_id": cur["_id"]}, upd)
        fresh = await db.trademarks.find_one({"_id": cur["_id"]})
        b = await db.brands.find_one({"_id": ObjectId(cur["brand_id"])}, {"name": 1}) if ObjectId.is_valid(cur.get("brand_id") or "") else None
        await _plan_tm_notes(fresh, (b or {}).get("name", ""))
        await create_audit_log(user["id"], user["name"], "trademark_updated", "trademark", tm_id, {"status": cur.get("status")}, {"status": doc["status"]})
        return _tm_out(fresh)

    @router.delete("/brands/trademarks/{tm_id}")
    async def delete_trademark(tm_id: str, request: Request):
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can delete a trademark record")
        cur = await db.trademarks.find_one({"_id": _oid(tm_id)})
        if not cur:
            raise HTTPException(status_code=404, detail="Trademark not found")
        await db.trademarks.delete_one({"_id": cur["_id"]})
        await notify.clear(db, "trademark", "trademark", tm_id)
        await create_audit_log(user["id"], user["name"], "trademark_deleted", "trademark", tm_id, _ser(cur), None)
        return {"ok": True}

    async def calendar_items(start: date, end: date) -> List[Dict[str, Any]]:
        """Trademark renewals / next actions and dealer agreements ending, for the event calendar."""
        out: List[Dict[str, Any]] = []
        names = {str(b["_id"]): b async for b in db.brands.find({})}
        async for t in db.trademarks.find({}):
            b = names.get(t.get("brand_id")) or {}
            due = renewal_date(t)
            if due and start <= due <= end and t.get("status") in TM_LIVE:
                out.append({"date": due.isoformat(), "title": f"Trademark renewal: {t['mark']}", "detail": b.get("name"), "source": "brands",
                            "link": f"/dashboard/brands?brand={t.get('brand_id')}", "id": f"tm-{t['_id']}"})
            nxt = notify.to_date(t.get("next_action_date"))
            if nxt and start <= nxt <= end and t.get("next_action"):
                out.append({"date": nxt.isoformat(), "title": f"Trademark: {t['next_action']}", "detail": f"{t['mark']} · {b.get('name', '')}", "source": "brands",
                            "link": f"/dashboard/brands?brand={t.get('brand_id')}", "id": f"tmn-{t['_id']}"})
        for bid, b in names.items():
            e = notify.to_date((b.get("agreement") or {}).get("end_date"))
            if b.get("kind") != "own" and e and start <= e <= end:
                out.append({"date": e.isoformat(), "title": f"{b['name']} {KIND_LABEL.get(b.get('kind'), '').lower()} ends", "detail": (b.get("agreement") or {}).get("territory"),
                            "source": "brands", "link": f"/dashboard/brands?brand={bid}", "id": f"ba-{bid}"})
        return out

    router.calendar_items = calendar_items
    return router
