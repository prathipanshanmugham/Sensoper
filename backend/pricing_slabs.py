"""Iter 59 — slab-based package rates per kit category.

`pricing_slabs` = one document per category:
  {category (kit_categories slug), unit: kw|hp|unit, gst_pct, active,
   slabs: [{from_value, to_value|null, rate_per_unit, effective_from}]}
Rate for a size = flat rate_per_unit × size for the whole system (not progressive). Boundary values belong to the
LOWER slab (1–3 and 3–5 → 3 kW prices in 1–3). Several versions of the same range may coexist with different
`effective_from`; the latest one on/before the quote date wins, so old quotes stay reproducible.
"""
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

UNITS = ("kw", "hp", "unit")
DEFAULT_UNIT = {"on-grid": "kw", "off-grid": "kw", "hybrid": "kw", "solar-pump": "hp"}


def _today() -> str:
    return date.today().isoformat()


def pick_slab(slabs: List[Dict[str, Any]], value: float, on_date: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Pure: pick the effective slab for `value` on `on_date` (ISO date). None if no slab covers it."""
    on_date = (on_date or _today())[:10]
    latest: Dict[tuple, Dict[str, Any]] = {}
    for s in slabs or []:
        eff = str(s.get("effective_from") or "0000-01-01")[:10]
        if eff > on_date:
            continue
        key = (float(s.get("from_value") or 0), None if s.get("to_value") in (None, "") else float(s["to_value"]))
        if key not in latest or eff > str(latest[key].get("effective_from") or "")[:10]:
            latest[key] = s
    matches = [s for (lo, hi), s in latest.items() if value >= lo and (hi is None or value <= hi)]
    if not matches:
        return None
    return min(matches, key=lambda s: float(s.get("from_value") or 0))


def price_for(doc: Optional[Dict[str, Any]], value: float, on_date: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Pure: {rate_per_unit, total, unit, gst_pct, gst_amount, from_value, to_value, effective_from} or None."""
    if not doc or not doc.get("active", True) or value is None or value <= 0:
        return None
    s = pick_slab(doc.get("slabs") or [], float(value), on_date)
    if not s:
        return None
    rate = float(s.get("rate_per_unit") or 0)
    total = round(rate * float(value))
    gst = doc.get("gst_pct")
    return {"category": doc.get("category"), "unit": doc.get("unit"), "rate_per_unit": rate, "value": float(value), "total": total,
            "from_value": s.get("from_value"), "to_value": s.get("to_value"), "effective_from": s.get("effective_from"),
            "gst_pct": gst, "gst_amount": round(total * float(gst) / 100) if gst is not None else None, "gst_missing": gst is None}


def validate_slabs(slabs: List[Dict[str, Any]]):
    seen = set()
    for s in slabs:
        lo = s.get("from_value"); hi = s.get("to_value")
        if lo is None or float(lo) < 0:
            raise HTTPException(status_code=400, detail="Each slab needs a from_value ≥ 0")
        if hi not in (None, "") and float(hi) <= float(lo):
            raise HTTPException(status_code=400, detail=f"Slab {lo}–{hi}: to_value must be greater than from_value")
        if s.get("rate_per_unit") is None or float(s["rate_per_unit"]) < 0:
            raise HTTPException(status_code=400, detail=f"Slab {lo}–{hi or '∞'}: rate_per_unit is required")
        eff = str(s.get("effective_from") or "")[:10]
        try:
            datetime.strptime(eff, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Slab {lo}–{hi or '∞'}: effective_from must be YYYY-MM-DD")
        key = (float(lo), None if hi in (None, "") else float(hi), eff)
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate slab {lo}–{hi or '∞'} effective {eff}")
        seen.add(key)
    # overlapping ranges within the same effective date (boundaries may touch)
    by_eff: Dict[str, List] = {}
    for s in slabs:
        by_eff.setdefault(str(s.get("effective_from"))[:10], []).append(s)
    for eff, group in by_eff.items():
        rng = sorted(group, key=lambda s: float(s["from_value"]))
        for a, b in zip(rng, rng[1:]):
            if a.get("to_value") in (None, "") or float(a["to_value"]) > float(b["from_value"]):
                raise HTTPException(status_code=400, detail=f"Slabs {a['from_value']}–{a.get('to_value') or '∞'} and {b['from_value']}–{b.get('to_value') or '∞'} (effective {eff}) overlap")


def serialize(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": str(doc["_id"]), "category": doc["category"], "unit": doc.get("unit") or "unit", "gst_pct": doc.get("gst_pct"),
            "active": doc.get("active", True), "slabs": sorted(doc.get("slabs") or [], key=lambda s: (str(s.get("effective_from")), float(s.get("from_value") or 0))),
            "created_at": doc.get("created_at"), "updated_at": doc.get("updated_at")}


class SlabRow(BaseModel):
    from_value: float
    to_value: Optional[float] = None
    rate_per_unit: float
    effective_from: str


class SlabDocCreate(BaseModel):
    category: str
    unit: Optional[str] = None
    gst_pct: Optional[float] = None
    slabs: List[SlabRow] = []
    active: bool = True


class SlabDocUpdate(BaseModel):
    unit: Optional[str] = None
    gst_pct: Optional[float] = None
    slabs: Optional[List[SlabRow]] = None
    active: Optional[bool] = None


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    async def _get_doc(category: str):
        return await db.pricing_slabs.find_one({"category": category})

    @router.get("/pricing-slabs")
    async def list_slabs(request: Request, include_inactive: bool = False):
        await get_current_user(request)
        q = {} if include_inactive else {"active": {"$ne": False}}
        docs = await db.pricing_slabs.find(q).sort("category", 1).to_list(200)
        cats = {c["slug"]: c for c in await db.kit_categories.find({}).to_list(200)}
        return [{**serialize(d), "category_label": (cats.get(d["category"]) or {}).get("label") or d["category"]} for d in docs]

    @router.get("/pricing-slabs/lookup")
    async def lookup(request: Request, category: str, value: float, on_date: Optional[str] = None):
        """Rate for a size: flat rate × value. 404 when no slab covers the value."""
        await get_current_user(request)
        doc = await _get_doc(category)
        res = price_for(doc, value, on_date)
        if not res:
            raise HTTPException(status_code=404, detail=f"No active slab rate for {category} at {value:g} {(doc or {}).get('unit') or ''}".strip())
        return res

    @router.post("/pricing-slabs")
    async def create_slabs(body: SlabDocCreate, request: Request):
        user = await require_role("admin")(request)
        cat = await db.kit_categories.find_one({"slug": body.category})
        if not cat:
            raise HTTPException(status_code=400, detail=f"Unknown category '{body.category}' — create it under Solution Kits → Categories first")
        if await _get_doc(body.category):
            raise HTTPException(status_code=409, detail=f"Slab rates for '{cat.get('label')}' already exist — edit them instead")
        unit = body.unit or DEFAULT_UNIT.get(body.category, "unit")
        if unit not in UNITS:
            raise HTTPException(status_code=400, detail=f"unit must be one of {list(UNITS)}")
        slabs = [s.model_dump() for s in body.slabs]
        validate_slabs(slabs)
        now = datetime.now(timezone.utc).isoformat()
        doc = {"category": body.category, "unit": unit, "gst_pct": body.gst_pct, "slabs": slabs, "active": body.active,
               "created_at": now, "updated_at": now, "created_by": user["id"]}
        res = await db.pricing_slabs.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "pricing_slabs_created", "pricing_slabs", str(res.inserted_id), None, {"category": body.category, "slabs": slabs})
        return serialize({**doc, "_id": res.inserted_id})

    @router.put("/pricing-slabs/{doc_id}")
    async def update_slabs(doc_id: str, body: SlabDocUpdate, request: Request):
        user = await require_role("admin")(request)
        if not ObjectId.is_valid(doc_id):
            raise HTTPException(status_code=400, detail="Invalid id")
        doc = await db.pricing_slabs.find_one({"_id": ObjectId(doc_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Slab rates not found")
        upd: Dict[str, Any] = {}
        data = body.model_dump(exclude_unset=True)
        if "unit" in data and data["unit"] is not None:
            if data["unit"] not in UNITS:
                raise HTTPException(status_code=400, detail=f"unit must be one of {list(UNITS)}")
            upd["unit"] = data["unit"]
        if "gst_pct" in data:
            upd["gst_pct"] = data["gst_pct"]
        if data.get("slabs") is not None:
            validate_slabs(data["slabs"])
            upd["slabs"] = data["slabs"]
        if data.get("active") is not None:
            upd["active"] = data["active"]
        upd["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.pricing_slabs.update_one({"_id": doc["_id"]}, {"$set": upd})
        await create_audit_log(user["id"], user["name"], "pricing_slabs_updated", "pricing_slabs", doc_id,
                               {k: doc.get(k) for k in upd if k != "updated_at"}, {k: v for k, v in upd.items() if k != "updated_at"})
        return serialize({**doc, **upd})

    @router.delete("/pricing-slabs/{doc_id}")
    async def delete_slabs(doc_id: str, request: Request):
        user = await require_role("admin")(request)
        if not ObjectId.is_valid(doc_id):
            raise HTTPException(status_code=400, detail="Invalid id")
        doc = await db.pricing_slabs.find_one({"_id": ObjectId(doc_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Slab rates not found")
        await db.pricing_slabs.delete_one({"_id": doc["_id"]})
        await create_audit_log(user["id"], user["name"], "pricing_slabs_deleted", "pricing_slabs", doc_id, {k: v for k, v in doc.items() if k != "_id"}, None)
        return {"message": "Slab rates removed"}

    return router
