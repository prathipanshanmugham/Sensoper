"""Brand Returns report (Iteration 49 §1) — returns to suppliers: by supplier / item / reason / month,
value of goods returned, resolution time, open vs resolved, and a supplier ranking by return rate
(returned qty ÷ qty purchased from that supplier). Plugged into GET /api/reports/brand_returns."""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, Optional


def _parse(ts: Optional[str]):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


async def brand_returns_report(db, date_from: Optional[str], date_to: Optional[str], supplier: Optional[str],
                               category: Optional[str], loc_filter: Dict[str, Any]) -> Dict[str, Any]:
    q: Dict[str, Any] = {}
    if date_from or date_to:
        q["created_at"] = {}
        if date_from: q["created_at"]["$gte"] = date_from
        if date_to: q["created_at"]["$lte"] = date_to + "T23:59:59"
    if supplier:
        q["supplier_name"] = {"$regex": f"^{supplier}$", "$options": "i"}
    if loc_filter.get("location_id"):
        q["location_id"] = loc_filter["location_id"]
    returns = await db.brand_returns.find(q).to_list(20000)

    inv = await db.inventory_items.find({}, {"name": 1, "unit_price": 1, "category": 1}).to_list(5000)
    by_name = {(i.get("name") or "").strip().lower(): i for i in inv}
    if category:
        returns = [r for r in returns if (by_name.get((r.get("item_name") or "").strip().lower(), {}).get("category") or "").lower() == category.lower()]

    pos = await db.purchase_orders.find({}, {"supplier_name": 1, "items": 1, "total_amount": 1}).to_list(20000)
    po_qty: Dict[str, float] = defaultdict(float)
    po_count: Dict[str, int] = defaultdict(int)
    for po in pos:
        key = (po.get("supplier_name") or "").strip().lower()
        po_count[key] += 1
        po_qty[key] += sum(float(it.get("quantity") or it.get("qty") or 0) for it in (po.get("items") or []))

    rows, sup, items, reasons, monthly = [], defaultdict(lambda: {"count": 0, "qty": 0.0, "value": 0.0, "open": 0, "resolved": 0, "res_hours": []}), \
        defaultdict(lambda: {"count": 0, "qty": 0.0, "value": 0.0}), defaultdict(lambda: {"count": 0, "qty": 0.0, "value": 0.0}), \
        defaultdict(lambda: {"count": 0, "qty": 0.0, "value": 0.0})
    total_value, open_n, resolved_n, res_hours = 0.0, 0, 0, []
    for r in returns:
        item = by_name.get((r.get("item_name") or "").strip().lower(), {})
        qty = float(r.get("quantity") or 0)
        value = qty * float(item.get("unit_price") or 0)
        resolved = r.get("status") == "completed"
        hrs = None
        if resolved:
            a, b = _parse(r.get("created_at")), _parse(r.get("completed_at"))
            if a and b: hrs = round((b - a).total_seconds() / 3600, 1)
        s_key = r.get("supplier_name") or r.get("brand") or r.get("supplier") or "Unknown"
        rows.append({"id": str(r["_id"]), "date": (r.get("created_at") or "")[:10], "supplier": s_key, "item": r.get("item_name"),
                     "category": item.get("category") or "—", "quantity": qty, "value": round(value), "reason": r.get("reason") or "—",
                     "status": "resolved" if resolved else "open", "resolution_hours": hrs, "raised_by": r.get("created_by_name")})
        total_value += value
        if resolved: resolved_n += 1
        else: open_n += 1
        if hrs is not None: res_hours.append(hrs)
        s = sup[s_key]; s["count"] += 1; s["qty"] += qty; s["value"] += value; s["resolved" if resolved else "open"] += 1
        if hrs is not None: s["res_hours"].append(hrs)
        for bucket, key in ((items, r.get("item_name") or "—"), (reasons, r.get("reason") or "—"), (monthly, (r.get("created_at") or "")[:7] or "—")):
            b = bucket[key]; b["count"] += 1; b["qty"] += qty; b["value"] += value

    supplier_rows = []
    for name, s in sup.items():
        purchased = po_qty.get(name.strip().lower(), 0.0)
        supplier_rows.append({"supplier": name, "returns": s["count"], "qty_returned": s["qty"], "qty_purchased": purchased,
                              "purchase_orders": po_count.get(name.strip().lower(), 0),
                              "return_rate_pct": round(s["qty"] / purchased * 100, 1) if purchased > 0 else None,
                              "value": round(s["value"]), "open": s["open"], "resolved": s["resolved"],
                              "avg_resolution_hours": round(sum(s["res_hours"]) / len(s["res_hours"]), 1) if s["res_hours"] else None})
    supplier_rows.sort(key=lambda r: (r["return_rate_pct"] if r["return_rate_pct"] is not None else -1, r["returns"]), reverse=True)
    for i, r in enumerate(supplier_rows, 1): r["rank"] = i
    fmt = lambda d: [{"name": k, **{kk: (round(vv) if kk == "value" else vv) for kk, vv in v.items()}} for k, v in sorted(d.items(), key=lambda kv: kv[1]["count"], reverse=True)]  # noqa: E731
    avg_res = round(sum(res_hours) / len(res_hours), 1) if res_hours else None
    worst = supplier_rows[0]["supplier"] if supplier_rows and supplier_rows[0]["return_rate_pct"] is not None else None
    return {
        "summary": {"total_returns": len(returns), "open_count": open_n, "resolved_count": resolved_n,
                    "value_returned": round(total_value), "avg_resolution_hours": avg_res,
                    "avg_resolution_days": round(avg_res / 24, 1) if avg_res is not None else None,
                    "suppliers_count": len(supplier_rows), "highest_return_rate_supplier": worst or "n/a"},
        "rows": sorted(rows, key=lambda r: r["date"], reverse=True),
        "supplier_rows": supplier_rows, "item_rows": fmt(items), "reason_rows": fmt(reasons),
        "monthly_rows": sorted(fmt(monthly), key=lambda r: r["name"]),
        "chart_data": [{"name": r["supplier"][:15], "value": r["returns"]} for r in supplier_rows[:8]],
    }
