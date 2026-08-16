"""DISCOM slab-aware tariff engine."""
from __future__ import annotations
from typing import Dict, List, Optional
from .base import num


def _pick_category(discom: Optional[Dict], category_name: Optional[str]) -> Optional[Dict]:
    if not discom or not discom.get("categories"):
        return None
    cats = discom["categories"]
    if category_name:
        for c in cats:
            if c.get("name", "").lower() == category_name.lower():
                return c
    # else return first
    return cats[0] if cats else None


def compute_bill_from_slabs(units: float, category: Optional[Dict]) -> Dict:
    """Given monthly units and category (with slabs), compute the bill.

    Handles telescopic slabs. Returns { units, total, fixed, energy, slab_breakdown }.
    """
    units = max(0, num(units))
    breakdown: List[Dict] = []
    if not category:
        # Flat fallback ₹6.5/unit
        energy = units * 6.5
        return {"units": units, "energy_charge": energy, "fixed_charge": 0, "total": energy,
                "slab_breakdown": [{"from": 0, "to": None, "rate": 6.5, "units": units, "amount": energy}]}

    slabs = category.get("slabs") or []
    fixed = num(category.get("fixed_charge", 0))
    telescopic = category.get("slab_structure", "telescopic") == "telescopic" or \
                 (category.get("slab_structure") is None)

    remaining = units
    energy = 0.0
    prev_to = 0

    for s in sorted(slabs, key=lambda x: num(x.get("from_units", 0))):
        s_from = num(s.get("from_units", prev_to))
        s_to = s.get("to_units")
        s_to_val = num(s_to) if s_to is not None else None
        rate = num(s.get("rate_per_unit", 0))
        width = None if s_to_val is None else max(0, s_to_val - s_from)

        # Non-telescopic ("bracket"): total units × rate of the slab that units land in
        if not telescopic:
            if (s_to_val is None) or (units <= s_to_val):
                if units > s_from:
                    energy = units * rate
                    breakdown.append({"from": s_from, "to": s_to_val, "rate": rate,
                                      "units": units, "amount": energy})
                    break
            prev_to = s_to_val if s_to_val is not None else s_from
            continue

        # Telescopic: consume slabs incrementally
        if remaining <= 0:
            break
        take = remaining if width is None else min(remaining, width)
        amt = take * rate
        energy += amt
        breakdown.append({"from": s_from, "to": s_to_val, "rate": rate,
                          "units": take, "amount": round(amt, 2)})
        remaining -= take
        prev_to = s_to_val if s_to_val is not None else s_from

    total = energy + fixed
    return {"units": units, "energy_charge": round(energy, 2), "fixed_charge": round(fixed, 2),
            "total": round(total, 2), "slab_breakdown": breakdown}


def back_solve_units(target_bill: float, category: Optional[Dict]) -> float:
    """Given a monthly bill (₹), find the units that produce that bill.

    Uses binary search on 0..3000 units (covers residential + small commercial).
    """
    target_bill = num(target_bill)
    if target_bill <= 0:
        return 0
    if not category:
        return round(target_bill / 6.5, 1)

    lo, hi = 0.0, 3000.0
    # Widen if needed
    while compute_bill_from_slabs(hi, category)["total"] < target_bill and hi < 100000:
        hi *= 2

    for _ in range(60):
        mid = (lo + hi) / 2
        b = compute_bill_from_slabs(mid, category)["total"]
        if abs(b - target_bill) < 0.5:
            return round(mid, 1)
        if b < target_bill:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2, 1)


def compute_bill_savings(monthly_units_pre: float, monthly_generation: float,
                        category: Optional[Dict], net_metering: bool = True,
                        export_rate: Optional[float] = None) -> Dict:
    """Slab-aware bill savings.

    - pre-solar bill = f(units_pre)
    - post-solar units = max(0, pre - generation)
    - post-solar bill = f(units_post)
    - if net_metering AND generation > pre-units: excess exports at export_rate (or lowest slab)
    - saving = pre - post + export_credit
    """
    units_pre = max(0, num(monthly_units_pre))
    gen = max(0, num(monthly_generation))
    pre = compute_bill_from_slabs(units_pre, category)

    units_post = max(0, units_pre - gen)
    excess = max(0, gen - units_pre)
    post = compute_bill_from_slabs(units_post, category)

    export_credit = 0.0
    if net_metering and excess > 0 and category:
        rate = num(export_rate) if export_rate else num(category.get("export_rate", 0))
        if rate <= 0 and category.get("slabs"):
            rate = num(category["slabs"][0].get("rate_per_unit", 0))
        export_credit = round(excess * rate, 2)

    saving = pre["total"] - post["total"] + export_credit
    return {
        "monthly_units_pre": units_pre,
        "monthly_units_post": round(units_post, 1),
        "monthly_generation": round(gen, 1),
        "excess_export_units": round(excess, 1),
        "pre_bill": pre,
        "post_bill": post,
        "export_credit": round(export_credit, 2),
        "monthly_saving": round(saving, 2),
        "annual_saving": round(saving * 12, 2),
    }


def pick_category(discom: Optional[Dict], category_name: Optional[str]) -> Optional[Dict]:
    return _pick_category(discom, category_name)
