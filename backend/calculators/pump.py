"""Solar pump calculator — AC (VFD-driven induction) + DC (MPPT-controlled BLDC).

Sizing method (Hazen–Williams flavour):
    hydraulic_kW = (Q_m3s * H_m * 1000 * 9.81) / 1000
    shaft_kW     = hydraulic / pump_efficiency
    input_kW     = shaft / motor_efficiency  ( × VFD efficiency for AC )
    array_kWp    = input × oversizing / (derating × PSH_availability)
"""
from __future__ import annotations
import math
from typing import Dict, Any, Optional, List
from .base import num, apply_overrides
from .subsidy import pm_kusum_subsidy


# Hazen–Williams C for pipe friction (roughness), higher = smoother
PIPE_C = {"GI": 100, "HDPE": 140, "PVC": 130, "Column pipe": 120}

# Standard pump ratings (HP) — arranged so we can pick "next size up"
STANDARD_HP = [0.5, 1, 2, 3, 5, 7.5, 10, 12.5, 15, 20, 25]

# Pump body diameters (mm) by HP → typical minimum bore casing required (mm inner)
BORE_MIN_MM = {0.5: 90, 1: 100, 2: 100, 3: 100, 5: 100, 7.5: 125, 10: 150, 12.5: 150, 15: 150, 20: 200, 25: 200}


def _friction_loss_m(flow_m3s: float, length_m: float, dia_mm: float, material: str = "HDPE") -> float:
    """Hazen–Williams head-loss (m) — safe against zeros."""
    if flow_m3s <= 0 or dia_mm <= 0 or length_m <= 0:
        return 0
    C = PIPE_C.get(material, 130)
    d_m = dia_mm / 1000
    Q = flow_m3s  # m³/s
    # h_f = 10.67 · L · Q^1.852 / (C^1.852 · D^4.87)  (SI)
    try:
        return round(10.67 * length_m * (Q ** 1.852) / ((C ** 1.852) * (d_m ** 4.87)), 2)
    except Exception:
        return 0


def _next_standard_hp(target_hp: float) -> float:
    for s in STANDARD_HP:
        if s >= target_hp:
            return s
    return STANDARD_HP[-1]


def compute(inputs: Dict[str, Any], overrides: Dict[str, Any], config: Dict[str, Any],
            discom: Optional[Dict[str, Any]] = None, pin: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    breakdown: List[Dict] = []
    steps = breakdown.append
    warnings: List[str] = []

    pump_path = (inputs.get("pump_path") or "DC").upper()  # "DC" or "AC"

    # ── PSH availability ────────────────────────────────────────────────
    psh = num((pin or {}).get("peak_sun_hours"), 0)
    if psh <= 0:
        sy = num((pin or {}).get("specific_yield_kwh_per_kwp_day"), 4.5)
        psh = sy / 0.75  # heuristic
    steps({"step": "psh", "expr": "peak sun hours", "value": round(psh, 2)})

    # ── Water requirement / flow ────────────────────────────────────────
    litres_per_day = num(inputs.get("water_requirement_lpd", 0))
    flow_lpm = num(inputs.get("required_flow_lpm", 0))
    operating_hours = num(inputs.get("daily_operating_hours", psh), psh)

    if flow_lpm <= 0 and litres_per_day > 0 and operating_hours > 0:
        flow_lpm = litres_per_day / (operating_hours * 60)
        steps({"step": "flow_lpm_derived", "expr": f"{litres_per_day} L/day / ({operating_hours}h × 60)", "value": round(flow_lpm, 2)})

    flow_m3s = flow_lpm / 60000 if flow_lpm > 0 else 0

    # ── TDH assembly ────────────────────────────────────────────────────
    static_water_level = num(inputs.get("static_water_level_m", 0))
    dynamic_water_level = num(inputs.get("dynamic_water_level_m", static_water_level))
    delivery_head = num(inputs.get("delivery_head_m", 0))
    tank_height = num(inputs.get("tank_height_m", 0))
    horiz_run = num(inputs.get("horizontal_pipe_run_m", 0))
    pipe_dia_mm = num(inputs.get("pipe_internal_diameter_mm", 50), 50)
    pipe_material = inputs.get("pipe_material", "HDPE")

    friction = _friction_loss_m(flow_m3s, horiz_run, pipe_dia_mm, pipe_material)
    tdh = round(max(dynamic_water_level, static_water_level) + max(delivery_head, tank_height) + friction, 2)
    steps({"step": "friction_loss_m", "expr": f"HW L={horiz_run}m d={pipe_dia_mm}mm {pipe_material}", "value": friction})
    steps({"step": "tdh_m", "expr": f"{max(dynamic_water_level, static_water_level)} + {max(delivery_head, tank_height)} + {friction}", "value": tdh})

    # ── Hydraulic + shaft power ─────────────────────────────────────────
    hydraulic_kw = (flow_m3s * tdh * 1000 * 9.81) / 1000 if (flow_m3s > 0 and tdh > 0) else 0
    steps({"step": "hydraulic_kw", "expr": f"({round(flow_m3s,5)} m³/s × {tdh}m × ρ × g)/1000", "value": round(hydraulic_kw, 3)})

    pump_efficiency = num(inputs.get("pump_efficiency", 0.55), 0.55)
    if pump_path == "DC":
        motor_efficiency = num(inputs.get("motor_efficiency", 0.85), 0.85)   # BLDC direct
        vfd_efficiency = 1.0
    else:
        motor_efficiency = num(inputs.get("motor_efficiency", 0.75), 0.75)   # induction
        vfd_efficiency = num(inputs.get("vfd_efficiency", 0.95), 0.95)

    if pump_efficiency <= 0: pump_efficiency = 0.55
    if motor_efficiency <= 0: motor_efficiency = 0.75

    shaft_kw = hydraulic_kw / pump_efficiency if hydraulic_kw > 0 else 0
    input_kw = (shaft_kw / motor_efficiency) / vfd_efficiency if shaft_kw > 0 else 0
    steps({"step": "input_kw", "expr": f"{round(shaft_kw,3)}/{motor_efficiency}{'' if pump_path=='DC' else f' /{vfd_efficiency}'}", "value": round(input_kw, 3)})

    # ── Array kWp ───────────────────────────────────────────────────────
    oversizing = num(inputs.get("array_oversizing", 1.3), 1.3)  # 20-30% oversize typical
    derating = num(inputs.get("derating_factor", 0.80), 0.80)   # dust/temp
    psh_avail = num(inputs.get("psh_available", psh), psh) or psh or 5.0

    array_kwp = 0
    if input_kw > 0:
        # kWp = input_kW × operating_hours × oversizing / (derating × PSH)
        array_kwp = round(input_kw * max(operating_hours, 1) * oversizing / (derating * psh_avail), 2)
    steps({"step": "array_kwp", "expr": f"{round(input_kw,3)} × {operating_hours}h × {oversizing} / ({derating} × {psh_avail}h)", "value": array_kwp})

    # ── Standard pump HP rounding ───────────────────────────────────────
    target_hp = round(input_kw / 0.746, 2) if input_kw > 0 else 0
    chosen_hp = _next_standard_hp(target_hp) if target_hp > 0 else 0
    if 0 < target_hp < STANDARD_HP[-1] and (chosen_hp - target_hp) > 0.6:
        warnings.append(f"Required duty is {target_hp:.2f} HP but next standard is {chosen_hp} HP — verify with sales.")
    steps({"step": "pump_hp_selected", "expr": f"target {target_hp} HP → next standard", "value": chosen_hp})

    # ── Bore-casing fit check ───────────────────────────────────────────
    casing_mm = num(inputs.get("bore_casing_diameter_mm", 0))
    min_casing = BORE_MIN_MM.get(chosen_hp, 100)
    if casing_mm > 0 and chosen_hp > 0 and casing_mm < min_casing:
        warnings.append(f"Bore casing {casing_mm:g} mm too narrow for {chosen_hp} HP submersible (needs ≥ {min_casing} mm).")

    # ── Yield vs demand check ───────────────────────────────────────────
    bore_yield_lph = num(inputs.get("bore_yield_lph", 0))
    if bore_yield_lph > 0 and flow_lpm > 0 and bore_yield_lph < (flow_lpm * 60):
        warnings.append(f"Bore yield {bore_yield_lph} LPH < required {round(flow_lpm*60)} LPH — pump will draw dry.")

    # ── DC-specific controller checks ───────────────────────────────────
    if pump_path == "DC":
        controller_vmax = num(inputs.get("controller_max_voltage", 0))
        string_v = num(inputs.get("string_voltage_v", 0))
        if controller_vmax > 0 and string_v > 0 and (string_v > controller_vmax or string_v < controller_vmax * 0.6):
            warnings.append(f"String voltage {string_v}V outside controller MPPT window (60-100% of {controller_vmax}V).")

    # ── Cost ────────────────────────────────────────────────────────────
    cost_per_kwp_map = (config or {}).get("cost_per_kwp") or {"solar-pump": 65000}
    cost_per_kwp = num(cost_per_kwp_map.get("solar-pump", 65000))
    region_factor = num((pin or {}).get("region_cost_factor", 1.0), 1.0)
    total_cost = round(array_kwp * cost_per_kwp * region_factor) if array_kwp > 0 else 0
    steps({"step": "total_cost", "expr": f"{array_kwp} × ₹{cost_per_kwp} × {region_factor}", "value": total_cost})

    # ── PM-KUSUM subsidy ────────────────────────────────────────────────
    central_pct = num(inputs.get("pm_kusum_central_pct", 30), 30)
    state_pct = num(inputs.get("pm_kusum_state_pct", 30), 30)
    farmer_pct = num(inputs.get("pm_kusum_farmer_pct", 40), 40)
    component = inputs.get("pm_kusum_component", "B")
    subsidy_info = pm_kusum_subsidy(pump_kw=input_kw or (chosen_hp * 0.746),
                                    component=component,
                                    central_share_pct=central_pct,
                                    state_share_pct=state_pct,
                                    farmer_share_pct=farmer_pct,
                                    config=config)
    subsidy = subsidy_info.get("amount", 0)
    net_cost = max(0, total_cost - subsidy)

    # ── Value delivered (saving) ────────────────────────────────────────
    # AC grid-hybrid path with mains-backup uses ag tariff; DC standalone has no bill
    ag_tariff = num(inputs.get("existing_ag_tariff", 0), 0)   # ₹/unit; TN farmers often ₹0
    hours_per_day = operating_hours
    daily_units = input_kw * hours_per_day if input_kw > 0 else 0
    monthly_units = daily_units * 30
    if ag_tariff > 0:
        annual_saving = round(monthly_units * 12 * ag_tariff)
    else:
        # Diesel-pump equivalent: assume 3 L/kWh of diesel, price ₹95/L
        diesel_price = num((config or {}).get("diesel_price_per_liter", 95), 95)
        diesel_lph = num((config or {}).get("diesel_lph_per_kw", 0.3), 0.3)
        annual_saving = round(daily_units * 365 * diesel_lph * diesel_price)

    payback_years = round(net_cost / annual_saving, 2) if annual_saving > 0 else None

    result = {
        "system_size_kw": array_kwp,
        "pump_path": pump_path,
        "pump_hp_selected": chosen_hp,
        "target_hp": target_hp,
        "input_power_kw": round(input_kw, 3),
        "shaft_power_kw": round(shaft_kw, 3),
        "hydraulic_kw": round(hydraulic_kw, 3),
        "tdh_m": tdh,
        "friction_loss_m": friction,
        "flow_lpm": round(flow_lpm, 2),
        "flow_m3_per_hr": round(flow_lpm * 60 / 1000, 2),
        "daily_output_liters": round(flow_lpm * operating_hours * 60),
        "total_cost": total_cost,
        "subsidy": subsidy,
        "subsidy_details": subsidy_info,
        "net_cost": net_cost,
        "annual_saving": annual_saving,
        "payback_years": payback_years,
        "cost_per_kwp_used": cost_per_kwp,
        "pump_efficiency": pump_efficiency,
        "motor_efficiency": motor_efficiency,
        "vfd_efficiency": vfd_efficiency if pump_path == "AC" else None,
        "warnings": warnings,
        "discom_id": (discom or {}).get("id"),
        "discom_name": (discom or {}).get("name"),
    }
    result = apply_overrides(result, overrides)
    return {"result": result, "breakdown": breakdown, "warnings": warnings}
