"""Off-grid solar calculator — daily consumption × autonomy × DoD driven."""
from __future__ import annotations
from typing import Dict, Any, Optional
from .base import num, apply_overrides
from .tariffs import pick_category, compute_bill_savings, back_solve_units


def compute(inputs: Dict[str, Any], overrides: Dict[str, Any], config: Dict[str, Any],
            discom: Optional[Dict[str, Any]] = None, pin: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    breakdown = []
    steps = breakdown.append

    cost_per_kwp_map = (config or {}).get("cost_per_kwp") or {"off-grid": 95000}
    cost_per_kwp = num(cost_per_kwp_map.get("off-grid", 95000))
    panel_wattage = num(inputs.get("panel_wattage_w", 540), 540)

    sy = num((pin or {}).get("specific_yield_kwh_per_kwp_day"), 0)
    if sy <= 0:
        sy = num((config or {}).get("default_specific_yield", 4.4), 4.4)
    steps({"step": "specific_yield", "expr": "kWh/kWp/day", "value": sy})

    category = pick_category(discom, inputs.get("tariff_category", "Domestic"))
    monthly_bill = num(inputs.get("monthly_eb_bill"))
    monthly_units = num(inputs.get("monthly_eb_units"))
    if monthly_units <= 0 and monthly_bill > 0:
        monthly_units = back_solve_units(monthly_bill, category)

    daily_units = monthly_units / 30 if monthly_units > 0 else 0

    # Off-grid: usually design to backup a fraction of daily load × autonomy days
    autonomy_days = num(inputs.get("autonomy_days", 1), 1)
    dod = num(inputs.get("battery_dod_pct", 80), 80) / 100
    backup_hrs = num(inputs.get("power_backup_hours", 0))

    # System size: 30% oversize for battery charging losses
    if daily_units > 0 and sy > 0:
        sys_kw = round((daily_units / sy) * 1.3, 2)
    else:
        sys_kw = 0
    steps({"step": "system_size_kw", "expr": f"({round(daily_units,2)}/{sy}) × 1.3 oversize", "value": sys_kw})

    # Battery sizing: daily units × autonomy / DoD  (round to nearest common bank size)
    battery_kwh_total = 0
    if daily_units > 0:
        battery_kwh_total = round((daily_units * autonomy_days) / max(dod, 0.1), 2)
    steps({"step": "battery_bank_kwh", "expr": f"{round(daily_units,2)} × {autonomy_days} / {dod}", "value": battery_kwh_total})

    # Split into 5-kWh units (LiFePO4 typical)
    unit_kwh = num((config or {}).get("battery_unit_kwh", 5), 5)
    battery_count = int(-(-battery_kwh_total // unit_kwh)) if battery_kwh_total > 0 else 0

    panel_count = int(-(-sys_kw * 1000 // panel_wattage)) if sys_kw > 0 and panel_wattage > 0 else 0
    steps({"step": "panel_count", "expr": f"ceil({sys_kw}·1000/{panel_wattage})", "value": panel_count})

    inverter_kw = round(sys_kw * 1.0, 2)
    region_factor = num((pin or {}).get("region_cost_factor", 1.0), 1.0)
    total_cost = round(sys_kw * cost_per_kwp * region_factor) if sys_kw > 0 else 0
    steps({"step": "total_cost", "expr": f"{sys_kw} × ₹{cost_per_kwp} × {region_factor}", "value": total_cost})

    # No PM Surya Ghar for off-grid — user pays full
    subsidy = 0
    net_cost = total_cost

    annual_gen = round(sys_kw * sy * 365) if sys_kw > 0 else 0
    monthly_gen = round(annual_gen / 12) if annual_gen else 0

    # Off-grid saving vs full grid bill (they replace 100% of daily consumption when battery is full)
    savings = compute_bill_savings(monthly_units, monthly_gen, category, net_metering=False)
    annual_saving = savings["annual_saving"]
    payback_years = round(net_cost / annual_saving, 2) if annual_saving > 0 else None

    life_years = int(num((config or {}).get("system_life_years", 25), 25))
    deg = num((config or {}).get("panel_degradation_pct_per_year", 0.7), 0.7) / 100
    lifetime = sum(savings["monthly_saving"] * 12 * ((1 - deg) ** y) for y in range(life_years))
    lifetime = round(lifetime)
    roi_pct = round(((lifetime - net_cost) / net_cost) * 100, 1) if net_cost > 0 else None

    result = {
        "system_size_kw": sys_kw,
        "panel_count": panel_count,
        "panel_wattage_w": panel_wattage,
        "inverter_kw": inverter_kw,
        "battery_kwh": unit_kwh,
        "battery_count": battery_count,
        "battery_total_kwh": battery_kwh_total,
        "battery_dod_pct": dod * 100,
        "autonomy_days": autonomy_days,
        "power_backup_hours": backup_hrs,
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
        "tariff_category": inputs.get("tariff_category", "Domestic"),
        "discom_id": (discom or {}).get("id") or (discom or {}).get("short_code"),
        "discom_name": (discom or {}).get("name"),
    }
    result = apply_overrides(result, overrides)
    return {"result": result, "breakdown": breakdown, "slab_breakdown": savings["pre_bill"]["slab_breakdown"]}
