"""On-grid solar calculator."""
from __future__ import annotations
from typing import Dict, Any, Optional
from .base import num, apply_overrides
from .tariffs import pick_category, compute_bill_from_slabs, compute_bill_savings, back_solve_units
from .subsidy import pm_surya_ghar_subsidy


def compute(inputs: Dict[str, Any], overrides: Dict[str, Any], config: Dict[str, Any],
            discom: Optional[Dict[str, Any]] = None, pin: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Return { result, breakdown }.
    - result: canonical numeric outputs
    - breakdown: list of {step, expr, value} entries so the quote is auditable.
    """
    breakdown = []
    steps = breakdown.append

    # ── Resolve constants ─────────────────────────────────────────────
    cost_per_kwp_map = (config or {}).get("cost_per_kwp") or {"on-grid": 55000, "hybrid": 75000, "off-grid": 95000, "solar-pump": 65000}
    cost_per_kwp = num(cost_per_kwp_map.get("on-grid", 55000))
    panel_wattage = num(inputs.get("panel_wattage_w", 540), 540)
    tariff_category_name = inputs.get("tariff_category", "Domestic")
    category = pick_category(discom, tariff_category_name)

    # PSH / specific yield: prefer PIN, else DISCOM state, else config default
    sy = num((pin or {}).get("specific_yield_kwh_per_kwp_day"), 0)
    if sy <= 0:
        sy = num((config or {}).get("default_specific_yield", 4.4), 4.4)
    steps({"step": "specific_yield", "expr": f"kWh/kWp/day", "value": sy})

    # ── Inputs ─────────────────────────────────────────────────────────
    monthly_bill = num(inputs.get("monthly_eb_bill"))
    monthly_units = num(inputs.get("monthly_eb_units"))

    if monthly_units <= 0 and monthly_bill > 0:
        monthly_units = back_solve_units(monthly_bill, category)
        steps({"step": "units_back_solved", "expr": f"₹{monthly_bill} → slab-solve", "value": monthly_units})

    daily_units = monthly_units / 30 if monthly_units > 0 else 0
    steps({"step": "daily_units", "expr": f"{monthly_units} / 30", "value": round(daily_units, 2)})

    # ── System sizing ─────────────────────────────────────────────────
    if daily_units > 0 and sy > 0:
        recommended_kw = round(daily_units / sy, 2)
    else:
        recommended_kw = 0
    steps({"step": "system_size_kw", "expr": f"{round(daily_units, 2)} / {sy}", "value": recommended_kw})

    # Roof constraint
    roof_sqft = num(inputs.get("roof_area_sqft"))
    # Approx 100 sqft per kW
    max_by_roof = round(roof_sqft / 100, 2) if roof_sqft > 0 else 0
    if roof_sqft > 0 and max_by_roof > 0 and recommended_kw > max_by_roof:
        recommended_kw = max_by_roof
        steps({"step": "capped_by_roof", "expr": f"{roof_sqft} sqft / 100", "value": max_by_roof})

    # Panel count
    panel_count = 0
    if recommended_kw > 0 and panel_wattage > 0:
        panel_count = int(-(-recommended_kw * 1000 // panel_wattage))
    steps({"step": "panel_count", "expr": f"ceil({recommended_kw}·1000 / {panel_wattage})", "value": panel_count})

    # Inverter — 85% of DC (grid-tied slight over-panelling)
    inverter_kw = round(recommended_kw * 0.85, 2) if recommended_kw > 0 else 0
    steps({"step": "inverter_kw", "expr": f"{recommended_kw} × 0.85", "value": inverter_kw})

    # ── Cost ──────────────────────────────────────────────────────────
    region_factor = num((pin or {}).get("region_cost_factor", 1.0), 1.0)
    total_cost = round(recommended_kw * cost_per_kwp * region_factor) if recommended_kw > 0 else 0
    steps({"step": "total_cost", "expr": f"{recommended_kw} × ₹{cost_per_kwp} × {region_factor}", "value": total_cost})

    # ── Subsidy ───────────────────────────────────────────────────────
    subsidy_info = pm_surya_ghar_subsidy(recommended_kw, category=tariff_category_name,
                                         system_type="on-grid", config=config)
    subsidy = subsidy_info.get("amount", 0)
    steps({"step": "subsidy", "expr": f"PM Surya Ghar ({tariff_category_name})", "value": subsidy})

    net_cost = max(0, total_cost - subsidy)

    # ── Generation ────────────────────────────────────────────────────
    annual_gen = round(recommended_kw * sy * 365) if recommended_kw > 0 else 0
    monthly_gen = round(annual_gen / 12) if annual_gen else 0
    steps({"step": "annual_generation_units", "expr": f"{recommended_kw} × {sy} × 365", "value": annual_gen})

    # ── Slab-aware savings ────────────────────────────────────────────
    net_metering = inputs.get("net_metering", True)
    savings = compute_bill_savings(monthly_units, monthly_gen, category, net_metering=net_metering)
    steps({"step": "monthly_saving", "expr": "slab-aware pre-vs-post + export credit", "value": savings["monthly_saving"]})

    annual_saving = savings["annual_saving"]
    payback_years = round(net_cost / annual_saving, 2) if annual_saving > 0 else None

    # 25-year lifetime savings (0.7%/yr degradation)
    life_years = int(num((config or {}).get("system_life_years", 25), 25))
    deg = num((config or {}).get("panel_degradation_pct_per_year", 0.7), 0.7) / 100
    lifetime = 0
    monthly_rate = savings["monthly_saving"]
    for y in range(life_years):
        lifetime += monthly_rate * 12 * ((1 - deg) ** y)
    lifetime = round(lifetime)
    roi_pct = round(((lifetime - net_cost) / net_cost) * 100, 1) if net_cost > 0 else None

    result = {
        "system_size_kw": recommended_kw,
        "panel_count": panel_count,
        "panel_wattage_w": panel_wattage,
        "inverter_kw": inverter_kw,
        "battery_kwh": 0,
        "battery_count": 0,
        "annual_generation_units": annual_gen,
        "monthly_generation_units": monthly_gen,
        "monthly_units_pre": savings["monthly_units_pre"],
        "monthly_units_post": savings["monthly_units_post"],
        "pre_solar_bill": savings["pre_bill"]["total"],
        "post_solar_bill": savings["post_bill"]["total"],
        "monthly_saving": savings["monthly_saving"],
        "annual_saving": annual_saving,
        "total_cost": total_cost,
        "subsidy": subsidy,
        "net_cost": net_cost,
        "payback_years": payback_years,
        "lifetime_savings": lifetime,
        "roi_pct": roi_pct,
        "specific_yield_used": sy,
        "cost_per_kwp_used": cost_per_kwp,
        "tariff_category": tariff_category_name,
        "discom_id": (discom or {}).get("id") or (discom or {}).get("short_code"),
        "discom_name": (discom or {}).get("name"),
    }
    result = apply_overrides(result, overrides)
    return {"result": result, "breakdown": breakdown, "slab_breakdown": savings["pre_bill"]["slab_breakdown"]}
