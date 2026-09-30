"""Iter 60 — projects whose district could not be resolved: worklist, second-pass auto-resolution, 5-second inline fix.

A project is "unresolved" when location.district is missing / blank / "Unknown". Expansion buckets these as
"Unknown", which hides them from every district-level insight — so they must sit in a visible queue instead.
"""
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

PIN_RE = re.compile(r"\b[1-9]\d{5}\b")
# common town / old-name → district aliases the fixed district list doesn't contain
TOWN_ALIASES = {"bangalore": ("Bengaluru Urban", "Karnataka"), "bengaluru": ("Bengaluru Urban", "Karnataka"), "perundurai": ("Erode", "Tamil Nadu"),
                "kaanjikovil": ("Erode", "Tamil Nadu"), "kanjikovil": ("Erode", "Tamil Nadu"), "madras": ("Chennai", "Tamil Nadu"), "trichy": ("Tiruchirappalli", "Tamil Nadu"),
                "tuticorin": ("Thoothukudi", "Tamil Nadu"), "ooty": ("Nilgiris", "Tamil Nadu"), "hosur": ("Krishnagiri", "Tamil Nadu"), "pollachi": ("Coimbatore", "Tamil Nadu"),
                "tirupur": ("Tiruppur", "Tamil Nadu"), "cochin": ("Ernakulam", "Kerala"), "kochi": ("Ernakulam", "Kerala"), "trivandrum": ("Thiruvananthapuram", "Kerala"),
                "calicut": ("Kozhikode", "Kerala"), "mysore": ("Mysuru", "Karnataka"), "pondicherry": ("Puducherry", "Puducherry"), "vizag": ("Visakhapatnam", "Andhra Pradesh")}
UNRESOLVED_Q = {"deleted_at": {"$exists": False},
                "$or": [{"location.district": {"$exists": False}}, {"location.district": None}, {"location.district": ""},
                        {"location.district": {"$regex": "^unknown$", "$options": "i"}}]}


def _text(p: Dict[str, Any]) -> str:
    loc = p.get("location") or {}
    return " ".join(str(x) for x in [(p.get("customer") or {}).get("address"), loc.get("address"), loc.get("site_location_words"),
                                      loc.get("city"), loc.get("state"), loc.get("pincode")] if x)


def resolve_from_reference(p: Dict[str, Any], pincodes: Dict[str, Dict], districts: List[Dict]) -> Dict[str, Any]:
    """Pure second pass: PIN (stored or found in address text) → pincodes table; else district-name keyword in text."""
    loc = p.get("location") or {}
    text = _text(p)
    upd: Dict[str, Any] = {}
    pin = str(loc.get("pincode") or "").strip()
    if not PIN_RE.fullmatch(pin):
        m = PIN_RE.search(text)
        pin = m.group(0) if m else ""
    if pin:
        upd["location.pincode"] = pin
        rec = pincodes.get(pin)
        if rec and rec.get("district"):
            upd["location.district"] = rec["district"]
            if rec.get("state"):
                upd["location.state"] = rec["state"]
            upd["location.resolution_source"] = "pincode"
            return upd
    low = text.lower()
    for d in sorted(districts, key=lambda d: -len(d.get("name") or "")):
        name = (d.get("name") or "").lower()
        if name and re.search(rf"\b{re.escape(name)}\b", low):
            upd["location.district"] = d["name"]
            if d.get("state"):
                upd["location.state"] = d["state"]
            upd["location.resolution_source"] = "address_keyword"
            return upd
    for alias, (dname, st) in TOWN_ALIASES.items():
        if re.search(rf"\b{alias}\w*", low):
            upd.update({"location.district": dname, "location.state": st, "location.resolution_source": "town_alias"})
            return upd
    return upd


def worklist_row(p: Dict[str, Any]) -> Dict[str, Any]:
    loc = p.get("location") or {}
    return {"id": str(p["_id"]), "reference_number": p.get("reference_number"), "customer_name": (p.get("customer") or {}).get("name"),
            "status": p.get("status"), "created_at": p.get("created_at"), "location_text": _text(p)[:200],
            "pincode": loc.get("pincode") or "", "state": loc.get("state") or "", "district": loc.get("district") or "",
            "capacity_kw": ((p.get("custom_fields") or {}).get("proposed_solution") or {}).get("system_size_kw") or (p.get("solar_system") or {}).get("capacity_kw")}


class LocationFix(BaseModel):
    district: str
    state: Optional[str] = None
    pincode: Optional[str] = None


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    async def _reference():
        pins = {d["pincode"]: d for d in await db.pincodes.find({}, {"pincode": 1, "district": 1, "state": 1}).to_list(20000)}
        from geo_reference import DISTRICTS_BY_STATE
        extras = ((await db.geo_config.find_one({"key": "extra_districts"})) or {}).get("districts", {})
        districts, seen = [], set()
        for src in (DISTRICTS_BY_STATE, extras):
            for st, names in src.items():
                for n in names:
                    if n not in seen:
                        districts.append({"name": n, "state": st}); seen.add(n)
        for d in pins.values():
            if d.get("district") and d["district"] not in seen:
                districts.append({"name": d["district"], "state": d.get("state")}); seen.add(d["district"])
        return pins, districts

    async def try_autoresolve(project_id) -> bool:
        """Used right after project creation: resolve or leave it on the review list."""
        p = await db.projects.find_one({"_id": ObjectId(project_id)})
        if not p:
            return False
        if (p.get("location") or {}).get("district") and str(p["location"]["district"]).lower() != "unknown":
            return True
        pins, districts = await _reference()
        upd = resolve_from_reference(p, pins, districts)
        if upd.get("location.district"):
            await db.projects.update_one({"_id": p["_id"]}, {"$set": {**upd, "location.needs_review": False}})
            return True
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {**upd, "location.needs_review": True, "location.flagged_at": datetime.now(timezone.utc).isoformat()}})
        return False

    router.try_autoresolve = try_autoresolve

    @router.get("/projects/location-review/count")
    async def review_count(request: Request):
        await get_current_user(request)
        return {"count": await db.projects.count_documents(UNRESOLVED_Q)}

    @router.get("/projects/location-review")
    async def review_list(request: Request):
        await require_role("admin", "manager")(request)
        rows = [worklist_row(p) async for p in db.projects.find(UNRESOLVED_Q).sort("created_at", -1)]
        return {"count": len(rows), "items": rows}

    @router.post("/projects/location-review/auto-resolve")
    async def auto_resolve(request: Request):
        """Second pass over every unresolved project. Returns what got fixed and the remaining worklist."""
        user = await require_role("admin", "manager")(request)
        pins, districts = await _reference()
        resolved, remaining = [], []
        async for p in db.projects.find(UNRESOLVED_Q):
            upd = resolve_from_reference(p, pins, districts)
            if upd.get("location.district"):
                await db.projects.update_one({"_id": p["_id"]}, {"$set": {**upd, "location.needs_review": False, "location.resolved_at": datetime.now(timezone.utc).isoformat()}})
                resolved.append({**worklist_row(p), "district": upd["location.district"], "state": upd.get("location.state") or "", "source": upd["location.resolution_source"]})
            else:
                if upd:
                    await db.projects.update_one({"_id": p["_id"]}, {"$set": upd})
                remaining.append(worklist_row(p))
        await create_audit_log(user["id"], user["name"], "location_auto_resolve", "project", "bulk", None,
                               {"resolved": len(resolved), "remaining": len(remaining)})
        return {"resolved_count": len(resolved), "resolved": resolved, "remaining_count": len(remaining), "remaining": remaining}

    @router.put("/projects/{project_id}/location-fix")
    async def fix_location(project_id: str, body: LocationFix, request: Request):
        user = await require_role("admin", "manager")(request)
        if not ObjectId.is_valid(project_id):
            raise HTTPException(status_code=400, detail="Invalid id")
        p = await db.projects.find_one({"_id": ObjectId(project_id)})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        district = body.district.strip()
        if not district or district.lower() == "unknown":
            raise HTTPException(status_code=400, detail="Pick a real district")
        upd = {"location.district": district, "location.needs_review": False, "location.resolution_source": "manual",
               "location.resolved_at": datetime.now(timezone.utc).isoformat(), "location.resolved_by": user["name"]}
        if body.state and body.state.strip():
            upd["location.state"] = body.state.strip()
        if body.pincode is not None:
            pin = body.pincode.strip()
            if pin and not PIN_RE.fullmatch(pin):
                raise HTTPException(status_code=400, detail="PIN code must be 6 digits")
            if pin:
                upd["location.pincode"] = pin
        await db.projects.update_one({"_id": p["_id"]}, {"$set": upd})
        await create_audit_log(user["id"], user["name"], "location_fixed", "project", project_id, {"district": (p.get("location") or {}).get("district")}, {"district": district, "state": upd.get("location.state"), "pincode": upd.get("location.pincode")})
        return {"message": "Location updated", "district": district}

    return router
