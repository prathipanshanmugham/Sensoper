"""Iter 55 — ad-hoc quotation lines: promote to inventory once the project is confirmed, optionally feed a Solution Kit.

* Only confirmed/won projects (status approved|completed) may promote.
* Promotion creates a real inventory item with quantity 0 (catalogue registration, not fabricated stock), or links an
  existing near-duplicate the user chose instead. The quotation line keeps its quoted unit_price — later Pricelist
  edits never touch this project's cost_estimation or its invoice (price lock).
* Every promotion is audit-logged (who, from which project/line, resulting inventory item).
"""
from __future__ import annotations
import difflib
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

CONFIRMED_STATUSES = {"approved", "completed"}
SIMILARITY_THRESHOLD = 0.82


class PromoteIn(BaseModel):
    line_ids: Optional[List[str]] = None            # None / [] → all ad-hoc lines
    link_existing: Dict[str, str] = {}              # line_id → existing inventory_item_id (instead of creating)


class AddToKitIn(BaseModel):
    kit_id: str
    quantity: float = 1
    qty_formula: Optional[str] = None


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def similar_items(name: str, inventory: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Simple name/SKU similarity — enough to catch near-duplicates, deliberately not a dedup engine."""
    n = _norm(name)
    out = []
    for it in inventory:
        cand = _norm(it.get("name", ""))
        ratio = difflib.SequenceMatcher(None, n, cand).ratio() if n and cand else 0
        if ratio >= SIMILARITY_THRESHOLD or (n and (n in cand or cand in n) and min(len(n), len(cand)) >= 6) or _norm(it.get("sku_code", "")) == n:
            out.append({"id": str(it["_id"]), "name": it.get("name"), "sku_code": it.get("sku_code"), "category": it.get("category"),
                        "unit_price": it.get("unit_price"), "hsn_code": it.get("hsn_code"), "similarity": round(ratio, 2)})
    return sorted(out, key=lambda x: -x["similarity"])[:5]


def _sku_from(name: str, category: str) -> str:
    base = re.sub(r"[^A-Z0-9]+", "-", (name or "ITEM").upper()).strip("-")[:18]
    return f"{(category or 'GEN')[:3].upper()}-{base}-{uuid.uuid4().hex[:4].upper()}"


def _spec_dict(spec: Optional[str], category: str) -> Dict[str, Any]:
    if not spec:
        return {}
    m = re.search(r"(\d+(?:\.\d+)?)\s*w(?:att)?s?\b", spec, re.IGNORECASE)
    specs: Dict[str, Any] = {"text": spec}
    if m and category in ("panels", "panel", "solar_panel"):
        specs["wattage_w"] = float(m.group(1))
    m = re.search(r"(\d+(?:\.\d+)?)\s*kw\b", spec, re.IGNORECASE)
    if m and category in ("inverter", "inverters"):
        specs["rated_kw"] = float(m.group(1))
    return specs


def create_router(db, get_current_user, require_role, create_audit_log, build_cost_estimation):
    router = APIRouter()

    async def _project(project_id: str) -> Dict[str, Any]:
        if not ObjectId.is_valid(project_id):
            raise HTTPException(status_code=400, detail="Invalid project id")
        p = await db.projects.find_one({"_id": ObjectId(project_id)})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        return p

    def _adhoc_lines(p: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [si for si in p.get("selected_items", []) if si.get("is_adhoc")]

    @router.get("/projects/{project_id}/adhoc-lines")
    async def list_adhoc(project_id: str, request: Request):
        await get_current_user(request)
        p = await _project(project_id)
        inventory = await db.inventory_items.find({"active": {"$ne": False}}, {"name": 1, "sku_code": 1, "category": 1, "unit_price": 1, "hsn_code": 1}).to_list(5000)
        lines = []
        for si in _adhoc_lines(p):
            lines.append({**{k: si.get(k) for k in ("line_id", "name", "description", "category", "specification", "unit_price", "gst_percentage", "hsn_code", "quantity", "supplier_hint", "promoted", "promoted_inventory_item_id", "sku_code")},
                          "similar": [] if si.get("promoted") else similar_items(si.get("name", ""), inventory)})
        invoice = await db.project_invoices.find_one({"project_id": project_id}, {"invoice_number": 1})
        return {"project_status": p.get("status"), "can_promote": p.get("status") in CONFIRMED_STATUSES,
                "invoice_number": invoice.get("invoice_number") if invoice else None, "lines": lines}

    @router.post("/projects/{project_id}/adhoc-lines/promote")
    async def promote(project_id: str, payload: PromoteIn, request: Request):
        user = await require_role("admin", "manager")(request)
        p = await _project(project_id)
        if p.get("status") not in CONFIRMED_STATUSES:
            raise HTTPException(status_code=400, detail=f"Only a confirmed/won project can promote ad-hoc lines (status is '{p.get('status')}')")
        targets = [si for si in _adhoc_lines(p) if not si.get("promoted") and (not payload.line_ids or si.get("line_id") in payload.line_ids)]
        if not targets:
            raise HTTPException(status_code=400, detail="No un-promoted ad-hoc lines match")
        now = datetime.now(timezone.utc).isoformat()
        results = []
        selected_items = p.get("selected_items", [])
        for si in targets:
            link_id = payload.link_existing.get(si["line_id"])
            if link_id:
                if not ObjectId.is_valid(link_id):
                    raise HTTPException(status_code=400, detail=f"Invalid inventory item id for line {si['name']}")
                inv = await db.inventory_items.find_one({"_id": ObjectId(link_id)})
                if not inv:
                    raise HTTPException(status_code=404, detail=f"Inventory item to link not found for line {si['name']}")
                inv_id, action = str(inv["_id"]), "linked_existing"
            else:
                sku = _sku_from(si.get("name", ""), si.get("category", ""))
                while await db.inventory_items.find_one({"sku_code": sku}):
                    sku = _sku_from(si.get("name", ""), si.get("category", ""))
                inv = {"name": si["name"], "sku_code": sku, "category": si.get("category") or "other", "zone": "", "aisle": "", "shelf": "", "rack": "", "bin_location": "",
                       "quantity": 0, "unit_price": si["unit_price"], "supplier": si.get("supplier_hint") or None, "gst_percentage": si.get("gst_percentage"),
                       "hsn_code": si.get("hsn_code") or None, "reorder_level": 0, "image_url": None, "margin_pct": si.get("margin_percentage"), "active": True,
                       "qc_checklist": [], "procurement_date": None, "location_id": None, "addon_group": None, "specs": _spec_dict(si.get("specification"), si.get("category") or ""),
                       "description": si.get("description") or "", "created_from_adhoc": {"project_id": project_id, "line_id": si["line_id"]},
                       "created_at": now, "updated_at": now}
                res = await db.inventory_items.insert_one(inv)
                inv["_id"] = res.inserted_id
                inv_id, action = str(res.inserted_id), "created"
            for item in selected_items:
                if item.get("line_id") == si["line_id"]:
                    item.update({"inventory_item_id": inv_id, "promoted": True, "promoted_inventory_item_id": inv_id, "promoted_at": now,
                                 "sku_code": inv.get("sku_code"), "hsn_code": item.get("hsn_code") or inv.get("hsn_code")})
            await create_audit_log(user["id"], user["name"], "promote_adhoc_line", "project", project_id, None,
                                   {"line_id": si["line_id"], "line_name": si["name"], "inventory_item_id": inv_id, "action": action, "sku_code": inv.get("sku_code"), "quoted_unit_price": si["unit_price"]},
                                   f"Ad-hoc line '{si['name']}' {action} → inventory {inv.get('sku_code')} (qty 0)")
            results.append({"line_id": si["line_id"], "name": si["name"], "inventory_item_id": inv_id, "sku_code": inv.get("sku_code"), "hsn_code": inv.get("hsn_code"), "action": action})
        # recompute breakdown so provenance flags flow through; quoted prices are unchanged by construction
        ce = await build_cost_estimation(selected_items, p.get("manual_costs", []), p.get("custom_fields"))
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {"selected_items": selected_items, "cost_estimation": ce, "updated_at": now}})
        return {"promoted": results, "remaining_adhoc": sum(1 for si in selected_items if si.get("is_adhoc") and not si.get("promoted"))}

    @router.post("/projects/{project_id}/adhoc-lines/{line_id}/add-to-kit")
    async def add_to_kit(project_id: str, line_id: str, payload: AddToKitIn, request: Request):
        user = await require_role("admin", "manager")(request)
        p = await _project(project_id)
        si = next((x for x in p.get("selected_items", []) if x.get("line_id") == line_id), None)
        if not si or not si.get("promoted") or not si.get("promoted_inventory_item_id"):
            raise HTTPException(status_code=400, detail="Line must be promoted to inventory before it can join a kit")
        if not ObjectId.is_valid(payload.kit_id):
            raise HTTPException(status_code=400, detail="Invalid kit id")
        kit = await db.material_kits.find_one({"_id": ObjectId(payload.kit_id)})
        if not kit:
            raise HTTPException(status_code=404, detail="Solution kit not found")
        if any(l.get("inventory_item_id") == si["promoted_inventory_item_id"] for l in kit.get("lines", [])):
            raise HTTPException(status_code=400, detail="This item is already a line in that kit")
        line = {"inventory_item_id": si["promoted_inventory_item_id"], "name": si["name"], "category": si.get("category"),
                "quantity": float(payload.quantity or 1), "qty_formula": payload.qty_formula or None, "notes": f"Added from project {p.get('reference_number') or project_id}"}
        await db.material_kits.update_one({"_id": kit["_id"]}, {"$push": {"lines": line}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}})
        await create_audit_log(user["id"], user["name"], "adhoc_line_added_to_kit", "material_kit", str(kit["_id"]), None,
                               {"project_id": project_id, "line_id": line_id, "inventory_item_id": si["promoted_inventory_item_id"], "quantity": line["quantity"], "qty_formula": line["qty_formula"]},
                               f"'{si['name']}' added to kit '{kit.get('name')}'")
        return {"message": f"Added to kit '{kit.get('name')}'", "kit_id": str(kit["_id"]), "line": line}

    return router
