"""Hybrid solar calculator — on-grid sizing + a battery buffer for backup hrs."""
from __future__ import annotations
from typing import Dict, Any, Optional
from .base import num, apply_overrides
from .tariffs import pick_category, compute_bill_savings, back_solve_units
from .subsidy import pm_surya_ghar_subsidy


def compute(inputs: Dict[str, Any], overrides: Dict[str, Any], config: Dict[str, Any],
            discom: Optional[Dict[str, Any]] = None, pin: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    breakdown = []
    steps = breakdown.append

    cost_per_kwp_map = (config or {}).get("cost_per_kwp") or {"hybrid": 75000}
    cost_per_kwp = num(cost_per_kwp_map.get("hybrid", 75000))
    panel_wattage = num(inputs.get("panel_wattage_w", 540), 540)

    sy = num((pin or {}).get("specific_yield_kwh_per_kwp_day"), 0)
    if sy <= 0:
        sy = num((config or {}).get("default_specific_yield", 4.4), 4.4)

    category = pick_category(discom, inputs.get("tariff_category", "Domestic"))
    monthly_bill = num(inputs.get("monthly_eb_bill"))
    monthly_units = num(inputs.get("monthly_eb_units"))
    if monthly_units <= 0 and monthly_bill > 0:
        monthly_units = back_solve_units(monthly_bill, category)

    daily_units = monthly_units / 30 if monthly_units > 0 else 0

    # Hybrid: cover 100% daily load like on-grid, plus battery buffer
    if daily_units > 0 and sy > 0:
        sys_kw = round(daily_units / sy, 2)
    else:
        sys_kw = 0
    steps({"step": "system_size_kw", "expr": f"{round(daily_units,2)}/{sy}", "value": sys_kw})

    # Battery: enough for backup hours × average hourly usage
    backup_hrs = num(inputs.get("power_backup_hours", 4), 4)
    avg_hourly = daily_units / 24 if daily_units > 0 else 0
    battery_kwh_needed = round(backup_hrs * avg_hourly * 1.2, 2)   # 20% headroom
    dod = num(inputs.get("battery_dod_pct", 80), 80) / 100
    if dod > 0:
        battery_kwh_needed = round(battery_kwh_needed / dod, 2)
    unit_kwh = num((config or {}).get("battery_unit_kwh", 5), 5)
    battery_count = int(-(-battery_kwh_needed // unit_kwh)) if battery_kwh_needed > 0 else 0
    steps({"step": "battery_bank_kwh", "expr": f"{backup_hrs}h × {round(avg_hourly,2)} × 1.2 / {dod}", "value": battery_kwh_needed})

    panel_count = int(-(-sys_kw * 1000 // panel_wattage)) if sys_kw > 0 else 0
    inverter_kw = round(sys_kw * 1.0, 2)
    region_factor = num((pin or {}).get("region_cost_factor", 1.0), 1.0)
    total_cost = round(sys_kw * cost_per_kwp * region_factor) if sys_kw > 0 else 0

    # PM Surya Ghar applies to hybrid too, treated as on-grid domestic
    subsidy_info = pm_surya_ghar_subsidy(sys_kw, category=inputs.get("tariff_category", "Domestic"),
                                          system_type="on-grid", config=config)
    subsidy = subsidy_info.get("amount", 0)
    net_cost = max(0, total_cost - subsidy)

    annual_gen = round(sys_kw * sy * 365) if sys_kw > 0 else 0
    monthly_gen = round(annual_gen / 12) if annual_gen else 0

    savings = compute_bill_savings(monthly_units, monthly_gen, category,
                                   net_metering=inputs.get("net_metering", True))
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
        "battery_total_kwh": battery_kwh_needed,
        "battery_dod_pct": dod * 100,
        "battery_chemistry": inputs.get("battery_chemistry", "LiFePO4"),
        "grid_charge_enabled": inputs.get("grid_charge_enabled", True),
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
