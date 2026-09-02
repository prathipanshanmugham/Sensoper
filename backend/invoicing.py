"""
Project GST Tax Invoice + Profit Calculator (Iteration 44 — Batch A)
=====================================================================
Two project-detail financial features that both read from the project's
existing `cost_estimation` (never recompute their own numbers):

1. GST Tax Invoice — a proper Indian tax invoice, distinct from the sales
   quotation PDF. Numbered from an admin-configurable sequence, stored once
   per project so the sequence never regenerates/skips. CGST+SGST vs IGST is
   derived automatically from the site's state (place of supply) vs the
   company's registered state — never manually chosen.
2. Profit Calculator — admin-only revenue/cost/margin breakdown for a single
   project, enforced server-side (not just hidden in the UI).
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
import re
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from bson import ObjectId
from pymongo import ReturnDocument

LABOUR_CATEGORIES = {"service", "labor", "labour", "installation", "commissioning", "subcontractor"}

ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
        "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two_digit_words(n: int) -> str:
    if n < 20:
        return ONES[n]
    return (TENS[n // 10] + (f" {ONES[n % 10]}" if n % 10 else "")).strip()


def _three_digit_words(n: int) -> str:
    if n >= 100:
        rest = n % 100
        return f"{ONES[n // 100]} Hundred" + (f" {_two_digit_words(rest)}" if rest else "")
    return _two_digit_words(n)


def amount_in_words(amount: float) -> str:
    """Indian numbering (crore/lakh/thousand) — 'Rupees X Lakh Y Thousand ... and Z Paise Only'."""
    rupees = int(amount)
    paise = round((amount - rupees) * 100)
    if rupees == 0 and paise == 0:
        return "Rupees Zero Only"
    parts = []
    crore, rupees = divmod(rupees, 10000000)
    lakh, rupees = divmod(rupees, 100000)
    thousand, rupees = divmod(rupees, 1000)
    hundred = rupees
    if crore: parts.append(f"{_three_digit_words(crore)} Crore")
    if lakh: parts.append(f"{_three_digit_words(lakh)} Lakh")
    if thousand: parts.append(f"{_three_digit_words(thousand)} Thousand")
    if hundred: parts.append(_three_digit_words(hundred))
    words = "Rupees " + " ".join(parts) if parts else "Rupees Zero"
    if paise:
        words += f" and {_two_digit_words(paise)} Paise"
    return words + " Only"


class InvoiceSettingsUpdate(BaseModel):
    prefix: Optional[str] = None
    next_number: Optional[int] = None


class InvoiceGenerate(BaseModel):
    reverse_charge: bool = False
    place_of_supply_override: Optional[str] = None


def _cost_breakdown(cost_estimation: Dict[str, Any]) -> Dict[str, Any]:
    """Single source of truth for material vs labour/subcontractor vs other-direct-cost
    buckets — used by both the Profit Calculator and the Invoice line items."""
    items = cost_estimation.get("items_breakdown", []) or []
    manual = cost_estimation.get("manual_costs", []) or []
    material_cost = 0.0
    labour_cost = 0.0
    by_category: Dict[str, Dict[str, float]] = {}
    for it in items:
        cat = (it.get("category") or "other").lower()
        bucket = "labour_subcontractor" if cat in LABOUR_CATEGORIES else "material"
        base = float(it.get("amount", 0) or 0)
        if bucket == "material":
            material_cost += base
        else:
            labour_cost += base
        agg = by_category.setdefault(cat, {"base_cost": 0.0, "margin_amount": 0.0, "gst_amount": 0.0, "count": 0})
        agg["base_cost"] += base
        agg["margin_amount"] += float(it.get("margin_amount", 0) or 0)
        agg["gst_amount"] += float(it.get("gst_amount", 0) or 0)
        agg["count"] += 1
    other_direct_costs = sum(float(c.get("amount", 0) or 0) for c in manual)
    total_margin = float(cost_estimation.get("total_margin", 0) or 0)
    total_gst = float(cost_estimation.get("total_gst", 0) or 0)
    total_cost_incl_gst = float(cost_estimation.get("total_cost", 0) or 0)
    revenue = total_cost_incl_gst - total_gst   # taxable value + margin, excl. GST pass-through
    total_base_cost = material_cost + labour_cost + other_direct_costs
    gross_profit = revenue - total_base_cost
    gross_margin_pct = round((gross_profit / revenue) * 100, 2) if revenue else 0
    return {
        "revenue": round(revenue, 2),
        "material_cost": round(material_cost, 2),
        "labour_subcontractor_cost": round(labour_cost, 2),
        "other_direct_costs": round(other_direct_costs, 2),
        "total_direct_cost": round(total_base_cost, 2),
        "total_margin_booked": round(total_margin, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_margin_pct": gross_margin_pct,
        "breakdown_by_category": [
            {"category": cat, **{k: round(v, 2) if k != "count" else v for k, v in agg.items()}}
            for cat, agg in sorted(by_category.items())
        ],
        "other_direct_cost_lines": [{"description": c.get("description", ""), "amount": round(c.get("amount", 0) or 0, 2)} for c in manual],
    }


def create_router(db, get_current_user, create_audit_log):
    router = APIRouter(tags=["invoicing"])

    async def _require_billing_access(request: Request) -> Dict[str, Any]:
        user = await get_current_user(request)
        if user.get("role") not in ("admin", "manager"):
            raise HTTPException(status_code=403, detail="Only admin/manager can access billing documents")
        return user

    # ─────────────────────────── Invoice settings (admin-configurable series) ───────────────────────────
    @router.get("/invoice-settings")
    async def get_invoice_settings(request: Request):
        await _require_billing_access(request)
        doc = await db.invoice_settings.find_one({"key": "defaults"}) or {}
        return {"prefix": doc.get("prefix", "INV"), "next_number": doc.get("last_used_number", 0) + 1}

    @router.put("/invoice-settings")
    async def update_invoice_settings(payload: InvoiceSettingsUpdate, request: Request):
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        update: Dict[str, Any] = {}
        if payload.prefix is not None:
            update["prefix"] = payload.prefix
        if payload.next_number is not None:
            update["last_used_number"] = payload.next_number - 1
        if not update:
            raise HTTPException(status_code=400, detail="Nothing to update")
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.invoice_settings.update_one({"key": "defaults"}, {"$set": update}, upsert=True)
        doc = await db.invoice_settings.find_one({"key": "defaults"}) or {}
        return {"prefix": doc.get("prefix", "INV"), "next_number": doc.get("last_used_number", 0) + 1}

    async def _next_invoice_number() -> str:
        settings = await db.invoice_settings.find_one_and_update(
            {"key": "defaults"},
            {"$inc": {"last_used_number": 1}, "$setOnInsert": {"prefix": "INV"}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        prefix = settings.get("prefix", "INV")
        n = settings.get("last_used_number", 1)
        return f"{prefix}-{n:04d}"

    # ─────────────────────────── GST Tax Invoice ───────────────────────────
    @router.get("/projects/{project_id}/invoice")
    async def get_project_invoice(project_id: str, request: Request):
        await _require_billing_access(request)
        inv = await db.project_invoices.find_one({"project_id": project_id})
        if not inv:
            raise HTTPException(status_code=404, detail="No invoice generated for this project yet")
        inv["id"] = str(inv.pop("_id"))
        return inv

    @router.post("/projects/{project_id}/invoice")
    async def generate_project_invoice(project_id: str, payload: InvoiceGenerate, request: Request):
        user = await _require_billing_access(request)
        existing = await db.project_invoices.find_one({"project_id": project_id})
        if existing:
            existing["id"] = str(existing.pop("_id"))
            existing["already_existed"] = True
            return existing

        project = await db.projects.find_one({"_id": ObjectId(project_id)})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        ce = project.get("cost_estimation") or {}
        if not ce.get("items_breakdown") and not ce.get("manual_costs"):
            raise HTTPException(status_code=400, detail="This project has no confirmed cost data to invoice")

        profile = await db.company_profiles.find_one({"is_active": True})
        if not profile:
            profile = await db.company_profiles.find_one(sort=[("created_at", 1)]) or {}
        company_state = profile.get("state") or "Tamil Nadu"
        place_of_supply = payload.place_of_supply_override or (project.get("location") or {}).get("state") or company_state
        inter_state = place_of_supply.strip().lower() != company_state.strip().lower()

        # Line items — HSN/SAC looked up from the linked inventory item where available,
        # falling back to a case-insensitive name match for older projects/estimates.
        line_items: List[Dict[str, Any]] = []
        item_ids = [it["inventory_item_id"] for it in ce.get("items_breakdown", []) if it.get("inventory_item_id")]
        hsn_by_id: Dict[str, str] = {}
        if item_ids:
            inv_docs = await db.inventory_items.find({"_id": {"$in": [ObjectId(i) for i in set(item_ids)]}}).to_list(500)
            hsn_by_id = {str(d["_id"]): d.get("hsn_code", "") for d in inv_docs}
        names_needing_lookup = [it["name"] for it in ce.get("items_breakdown", [])
                                 if not it.get("inventory_item_id") and it.get("name")]
        hsn_by_name: Dict[str, str] = {}
        if names_needing_lookup:
            name_docs = await db.inventory_items.find(
                {"name": {"$in": [re.compile(f"^{re.escape(n)}$", re.IGNORECASE) for n in set(names_needing_lookup)]}}
            ).to_list(500)
            hsn_by_name = {d["name"].lower(): d.get("hsn_code", "") for d in name_docs}
        for it in ce.get("items_breakdown", []):
            gst_amt = float(it.get("gst_amount", 0) or 0)
            hsn = hsn_by_id.get(it.get("inventory_item_id")) or hsn_by_name.get((it.get("name") or "").lower(), "")
            line_items.append({
                "description": it.get("name", ""),
                "hsn_sac": hsn or "",
                "quantity": it.get("quantity", 1),
                "unit_price": it.get("unit_price", 0),
                "taxable_value": round(float(it.get("amount", 0) or 0) + float(it.get("margin_amount", 0) or 0), 2),
                "gst_pct": it.get("gst_percentage", 0),
                "gst_amount": round(gst_amt, 2),
                "cgst": round(gst_amt / 2, 2) if not inter_state else 0,
                "sgst": round(gst_amt / 2, 2) if not inter_state else 0,
                "igst": round(gst_amt, 2) if inter_state else 0,
            })
        for mc in ce.get("manual_costs", []) or []:
            line_items.append({
                "description": mc.get("description", ""), "hsn_sac": "", "quantity": 1,
                "unit_price": mc.get("amount", 0), "taxable_value": round(float(mc.get("amount", 0) or 0), 2),
                "gst_pct": 0, "gst_amount": 0, "cgst": 0, "sgst": 0, "igst": 0,
            })

        total_taxable = round(sum(li["taxable_value"] for li in line_items), 2)
        total_cgst = round(sum(li["cgst"] for li in line_items), 2)
        total_sgst = round(sum(li["sgst"] for li in line_items), 2)
        total_igst = round(sum(li["igst"] for li in line_items), 2)
        grand_total = round(total_taxable + total_cgst + total_sgst + total_igst, 2)

        invoice_number = await _next_invoice_number()
        now = datetime.now(timezone.utc)
        customer = project.get("customer") or {}
        doc = {
            "project_id": project_id,
            "invoice_number": invoice_number,
            "invoice_date": now.date().isoformat(),
            "reverse_charge": payload.reverse_charge,
            "place_of_supply": place_of_supply,
            "company": {
                "name": profile.get("company_name", "Sensoper Controls & Renewables"),
                "address": profile.get("address", ""),
                "gstin": profile.get("gst_number", ""),
                "state": company_state,
                "authorized_signatory": profile.get("authorized_signatory", ""),
                "designation": profile.get("designation", ""),
            },
            "customer": {
                "name": customer.get("name", ""),
                "billing_address": customer.get("address", ""),
                "shipping_address": (project.get("location") or {}).get("address") or customer.get("address", ""),
                "gstin": customer.get("gstin", ""),
                "phone": customer.get("phone", ""),
            },
            "line_items": line_items,
            "total_taxable_value": total_taxable,
            "total_cgst": total_cgst,
            "total_sgst": total_sgst,
            "total_igst": total_igst,
            "grand_total": grand_total,
            "amount_in_words": amount_in_words(grand_total),
            "declaration": "We declare that this invoice shows the actual price of the goods/services described "
                            "and that all particulars are true and correct.",
            "created_by": user.get("id"),
            "created_by_name": user.get("name"),
            "created_at": now.isoformat(),
        }
        result = await db.project_invoices.insert_one(doc)
        doc.pop("_id", None)
        doc["id"] = str(result.inserted_id)
        await db.projects.update_one({"_id": ObjectId(project_id)}, {"$set": {
            "invoice_number": invoice_number, "invoice_date": doc["invoice_date"],
        }})
        await create_audit_log(user["id"], user["name"], "generate_invoice", "project", project_id, None, {"invoice_number": invoice_number})
        return doc

    # ─────────────────────────── Profit Calculator (admin only, server-enforced) ───────────────────────────
    @router.get("/projects/{project_id}/profit")
    async def get_project_profit(project_id: str, request: Request):
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Profit data is restricted to admin accounts")
        project = await db.projects.find_one({"_id": ObjectId(project_id)})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        ce = project.get("cost_estimation") or {}
        return _cost_breakdown(ce)

    return router
