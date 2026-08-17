"""
Working-trace helper — turns a breakdown into structured 4-stage output
for the guided calculator UI (Consumption → Sizing → Cost → Savings).

Each stage is a list of `WorkingLine` dicts:
    { label, inputs, operation, constant?, result, unit?, why?, source? }
The UI shows each line collapsed by default and expands on "Show Working".
"""
from __future__ import annotations
from typing import List, Dict, Any


def line(label: str, inputs, operation: str, result, unit: str = "",
         constant: Any = None, why: str = "", source: str = "") -> Dict[str, Any]:
    return {
        "label": label,
        "inputs": inputs,
        "operation": operation,
        "constant": constant,
        "result": result,
        "unit": unit,
        "why": why,
        "source": source,
    }


def compile_stages_ongrid(result: Dict[str, Any], breakdown: List[Dict[str, Any]],
                          inputs: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, List]:
    """Compile the on-grid breakdown into 4 guided stages."""
    stages = {"consumption": [], "sizing": [], "cost": [], "savings": []}

    monthly_units = result.get("monthly_units_pre") or 0
    monthly_bill = inputs.get("monthly_eb_bill") or 0
    sy = result.get("specific_yield_used", 4.4)
    kwp = result.get("system_size_kw", 0)
    panel_w = result.get("panel_wattage_w", 540)
    panels = result.get("panel_count", 0)
    tariff_cat = result.get("tariff_category", "Domestic")
    discom = result.get("discom_name", "—")

    # Stage 1 — What does the customer need?
    if monthly_bill and not inputs.get("monthly_eb_units"):
        stages["consumption"].append(line(
            "Monthly consumption (back-solved from bill)",
            {"bill": f"₹{monthly_bill}"},
            "Slab-solve on this DISCOM's telescopic tariff — starts from top slab, subtracts down until the bill matches",
            monthly_units, "units/month",
            constant=f"{discom} · {tariff_cat}",
            why="Telescopic tariff means each unit costs different amount depending on total consumption. Solving backwards from the bill is more accurate than dividing by an average rate.",
            source=f"DISCOM: {discom}",
        ))
    else:
        stages["consumption"].append(line(
            "Monthly consumption", {"units_entered": monthly_units},
            "As entered by customer", monthly_units, "units/month",
        ))
    stages["consumption"].append(line(
        "Daily consumption",
        {"monthly_units": monthly_units}, f"{monthly_units} ÷ 30",
        round(monthly_units / 30, 2) if monthly_units else 0, "units/day",
        why="Sizing is done on daily basis to match solar generation cycle",
    ))

    # Stage 2 — What size system?
    daily = round(monthly_units / 30, 2) if monthly_units else 0
    stages["sizing"].append(line(
        "Sunshine at this location", {}, "Peak-sun-hour equivalent per day",
        sy, "kWh per kWp per day", constant=sy,
        why="How many hours of full-strength sun this location gets. Coimbatore ≈ 4.4, Bengaluru ≈ 4.6, Kerala coastal ≈ 4.2. From PIN-code district data.",
        source="pincodes collection",
    ))
    raw_kw = round(daily / sy, 2) if sy > 0 else 0
    stages["sizing"].append(line(
        "System size needed",
        {"daily_units": daily, "specific_yield": sy},
        f"{daily} ÷ {sy}", raw_kw, "kWp",
        why="To generate this many units per day using this much sunshine",
    ))
    if kwp != raw_kw and kwp > 0:
        stages["sizing"].append(line(
            "Rounded to standard size",
            {"raw": raw_kw}, "Round to nearest 0.5 kWp",
            kwp, "kWp",
            why="Real panels come in 540/545/550 W — you can only build in whole-panel increments",
        ))
    if panels:
        stages["sizing"].append(line(
            "Panels needed",
            {"system_kw": kwp, "panel_w": panel_w},
            f"ceil({kwp} × 1000 ÷ {panel_w})", panels, "panels",
            constant=f"{panel_w} W panels",
        ))
        area_per_panel = round(1000 / panel_w * 20, 1)  # ~20 sqft per kW → panel-level
        area = round(panels * area_per_panel / 6.5, 1)  # rough sqft per panel
        stages["sizing"].append(line(
            "Roof area required",
            {"panels": panels}, f"{panels} × ~24 sq ft/panel",
            round(panels * 24), "sq ft",
            why="Standard 540-550W panel is ≈24 sq ft including inter-panel gaps",
        ))
    inv_kw = result.get("inverter_kw", 0)
    if inv_kw:
        stages["sizing"].append(line(
            "Inverter size",
            {"system_kw": kwp}, f"{kwp} × 0.85",
            inv_kw, "kW", constant="0.85 (grid-tie over-panelling)",
            why="On-grid inverters can be slightly under-sized vs panels — panels rarely hit full rated power, and over-panelling improves morning/evening yield",
        ))

    # Stage 3 — Cost
    cost_per_kwp = result.get("cost_per_kwp_used", 55000)
    total_cost = result.get("total_cost", 0)
    subsidy = result.get("subsidy", 0)
    net_cost = result.get("net_cost", 0)
    stages["cost"].append(line(
        "System total (rate-based)",
        {"system_kw": kwp, "rate": cost_per_kwp},
        f"{kwp} × ₹{cost_per_kwp:,}", total_cost, "₹",
        why="Includes panels, inverter, structure, cables, DCDB/ACDB, earthing, installation, commissioning. In Phase 1 this is a per-kWp average — Phase 2 breaks it down per real product.",
        source="calc_config.cost_per_kwp",
    ))
    if subsidy:
        stages["cost"].append(line(
            "Less PM Surya Ghar subsidy",
            {"eligible_kw": kwp}, "Slab-based (30k / 60k / 78k)",
            -subsidy, "₹", constant="MNRE 2024 slabs",
            why="Only residential on-grid rooftop under 10 kW is eligible. Amount fixed by slab, not %.",
            source="pm_surya_ghar",
        ))
    stages["cost"].append(line(
        "Customer pays",
        {"total": total_cost, "subsidy": subsidy},
        f"₹{total_cost:,} − ₹{subsidy:,}", net_cost, "₹",
        why="Net cash outflow to the customer after subsidy is credited",
    ))

    # Stage 4 — Savings
    pre_bill = result.get("pre_solar_bill", 0)
    post_bill = result.get("post_solar_bill", 0)
    monthly_saving = result.get("monthly_saving", 0)
    annual_saving = result.get("annual_saving", 0)
    payback = result.get("payback_years")
    lifetime = result.get("lifetime_savings", 0)
    stages["savings"].append(line(
        "Bill before solar",
        {"units": monthly_units}, "Slab-priced on current tariff",
        pre_bill, "₹/month", constant=tariff_cat,
    ))
    stages["savings"].append(line(
        "Bill after solar",
        {"units_from_grid": result.get("monthly_units_post", 0)},
        "Top slab units removed first — you save the most-expensive units, not the average",
        post_bill, "₹/month",
        why="If you use 500 units and generate 300, the 300 removed are the TOP slab units (the expensive ones), not the bottom 300. This is why solar savings are always bigger than a flat rate would suggest.",
    ))
    stages["savings"].append(line(
        "Monthly saving",
        {"pre": pre_bill, "post": post_bill},
        f"₹{pre_bill:,} − ₹{post_bill:,}", monthly_saving, "₹/month",
    ))
    stages["savings"].append(line(
        "Payback period",
        {"net_cost": net_cost, "annual_saving": annual_saving},
        f"₹{net_cost:,} ÷ ₹{annual_saving:,}" if annual_saving else "N/A",
        payback if payback is not None else "—", "years",
        why="How long before the electricity savings cover the up-front cost. Typical on-grid rooftop: 4-6 years.",
    ))
    if lifetime:
        stages["savings"].append(line(
            "25-year savings",
            {"monthly_saving": monthly_saving},
            f"25 × 12 × ₹{monthly_saving:,} with 0.7%/yr panel degradation",
            lifetime, "₹",
            constant="25-year system life, 0.7%/yr degradation",
        ))

    return stages


def compile_stages_pump(result: Dict[str, Any], breakdown: List[Dict[str, Any]],
                        inputs: Dict[str, Any], config: Dict[str, Any],
                        roi_details: Dict[str, Any]) -> Dict[str, List]:
    """Compile a pump breakdown into 4 stages."""
    stages = {"consumption": [], "sizing": [], "cost": [], "savings": []}
    tdh = result.get("tdh_m", 0)
    flow_lpm = result.get("flow_lpm", 0)
    hyd = result.get("hydraulic_kw", 0)
    shaft = result.get("shaft_power_kw", 0)
    inp = result.get("input_power_kw", 0)
    kwp = result.get("system_size_kw", 0)
    hp = result.get("pump_hp_selected", 0)
    total_cost = result.get("total_cost", 0)
    subsidy = result.get("subsidy", 0)
    net_cost = result.get("net_cost", 0)
    pump_path = result.get("pump_path", "DC")

    # Stage 1 — Water need
    stages["consumption"].append(line(
        "Daily water requirement",
        {"lpd": inputs.get("water_requirement_lpd", 0)},
        "As stated by customer / cropping plan",
        inputs.get("water_requirement_lpd", 0), "L/day",
    ))
    stages["consumption"].append(line(
        "Required flow rate",
        {"lpd": inputs.get("water_requirement_lpd", 0), "hours": inputs.get("daily_operating_hours", 0)},
        f"{inputs.get('water_requirement_lpd', 0)} ÷ ({inputs.get('daily_operating_hours', 0)} × 60)",
        flow_lpm, "LPM",
        why="Litres/minute is what the pump curve is rated in",
    ))

    # Stage 2 — Size the pump
    stages["sizing"].append(line(
        "Total Dynamic Head (TDH)",
        {"dynamic_wl": inputs.get("dynamic_water_level_m", 0), "delivery": inputs.get("delivery_head_m", 0), "friction": result.get("friction_loss_m", 0)},
        "Water level + delivery head + friction loss",
        tdh, "m",
        constant="Hazen-Williams friction",
        why="How high (in metres) the pump has to lift water. Friction in the pipe is a hidden extra head-loss.",
    ))
    stages["sizing"].append(line(
        "Hydraulic power required",
        {"flow_m3s": round(flow_lpm / 60000, 5), "tdh": tdh},
        "(Q × H × 1000 × 9.81) / 1000",
        hyd, "kW",
        why="Pure physics: energy needed to lift this water this high",
    ))
    stages["sizing"].append(line(
        "Shaft power",
        {"hydraulic": hyd, "pump_eff": result.get("pump_efficiency", 0.55)},
        f"{hyd} ÷ {result.get('pump_efficiency', 0.55)}",
        shaft, "kW",
        why="Real pumps are 50-70% efficient — the rest is heat and turbulence",
    ))
    stages["sizing"].append(line(
        f"Motor input power ({pump_path})",
        {"shaft": shaft, "motor_eff": result.get("motor_efficiency", 0.85)},
        f"{shaft} ÷ {result.get('motor_efficiency', 0.85)}" + ("" if pump_path == "DC" else f" ÷ {result.get('vfd_efficiency', 0.95)}"),
        inp, "kW",
        why="DC BLDC motors are ~85% efficient (no VFD). AC induction motors on a VFD lose ~25% (75% × 95%).",
    ))
    stages["sizing"].append(line(
        "Solar array size",
        {"input_kw": inp, "oversizing": inputs.get("array_oversizing", 1.3), "derating": inputs.get("derating_factor", 0.8)},
        f"{inp} × oversizing / (derating × PSH)",
        kwp, "kWp",
        constant="30% oversizing, 80% derating",
        why="Panels lose 20% to heat/dust and morning/evening; oversizing keeps the pump running longer",
    ))
    stages["sizing"].append(line(
        "Pump HP (standard rating)",
        {"target_hp": result.get("target_hp", 0)},
        "Round UP to next standard rating (0.5/1/2/3/5/7.5/10 HP)",
        hp, "HP",
    ))

    # Stage 3 — Cost
    stages["cost"].append(line(
        "System total",
        {"kwp": kwp, "rate": result.get("cost_per_kwp_used", 65000)},
        f"{kwp} × ₹{result.get('cost_per_kwp_used', 65000):,}",
        total_cost, "₹",
    ))
    if subsidy:
        stages["cost"].append(line(
            "PM-KUSUM subsidy",
            {"component": inputs.get("pm_kusum_component", "B")},
            "Central + State share",
            -subsidy, "₹", constant="PM-KUSUM",
        ))
    stages["cost"].append(line(
        "Farmer pays",
        {"total": total_cost, "subsidy": subsidy},
        f"₹{total_cost:,} − ₹{subsidy:,}", net_cost, "₹",
    ))

    # Stage 4 — Savings (ROI by replacement — computed by pump ROI helper)
    replacement = roi_details.get("mode", "diesel")
    annual = roi_details.get("annual_saving", 0)
    payback = result.get("payback_years")
    if replacement == "zero_tariff":
        stages["savings"].append(line(
            "Bill savings",
            {}, "Agricultural tariff is ₹0 — no bill to save",
            0, "₹/year",
            why="Tamil Nadu (and many other) states supply agricultural power free of charge. The value case for this pump is NOT bill savings — it's irrigation reliability, hours of run-time gained, and reduced crop loss from missed grid supply.",
        ))
        stages["savings"].append(line(
            "Value delivered",
            {"crop_value_per_year": roi_details.get("crop_value_per_year", "—")},
            "Reliability + yield uplift",
            roi_details.get("value_delivered", 0), "₹/year",
            why="How much value the farmer gets from not depending on grid supply. Not a bill saving — treat as revenue protection.",
        ))
    elif replacement == "diesel":
        fuel = roi_details.get("fuel", {})
        stages["savings"].append(line(
            f"{fuel.get('name', 'Diesel')} pump replacement",
            {"units_per_kwh": fuel.get("units_per_kwh", 0.31), "price_per_unit": fuel.get("price_per_unit", 92)},
            f"kWh/year × {fuel.get('units_per_kwh', 0.31)} {fuel.get('unit', 'litre')}/kWh × ₹{fuel.get('price_per_unit', 92)}",
            annual, "₹/year",
            constant=f"{fuel.get('name', 'Diesel')} @ ₹{fuel.get('price_per_unit', 92)}/{fuel.get('unit', 'L')}",
            source="fuel_types collection",
            why="Solar pump replaces this many litres of diesel per year (or units of your chosen fuel)",
        ))
    elif replacement == "grid":
        stages["savings"].append(line(
            "Grid electricity replacement",
            {"kwh_per_year": roi_details.get("annual_kwh", 0), "tariff": roi_details.get("tariff", 0)},
            f"{roi_details.get('annual_kwh', 0)} kWh × ₹{roi_details.get('tariff', 0)}",
            annual, "₹/year",
        ))
    elif replacement == "manual":
        stages["savings"].append(line(
            "Hired-pump / rental savings",
            {"hours_per_year": roi_details.get("hours_per_year", 0), "rate": roi_details.get("hire_rate", 0)},
            f"{roi_details.get('hours_per_year', 0)} × ₹{roi_details.get('hire_rate', 0)}",
            annual, "₹/year",
        ))
    if payback is not None:
        stages["savings"].append(line(
            "Payback period",
            {"net_cost": net_cost, "annual": annual},
            f"₹{net_cost:,} ÷ ₹{annual:,}" if annual else "N/A",
            payback, "years",
        ))
    return stages


# ---------------------------------------------------------------------------
# String voltage validation (Change 5)
# ---------------------------------------------------------------------------
def validate_string_voltage(pump_product: Dict[str, Any], panel_product: Dict[str, Any],
                            modules_in_series: int, strings_in_parallel: int,
                            site_min_temp_c: float = -10.0) -> Dict[str, Any]:
    """Compute Voc_at_Tmin and validate against controller absolute-max limit.

    This is the single most common cause of a solar pump that never runs —
    silicon panels output HIGHER voltage on cold clear mornings than their
    nameplate rating.
    """
    if not (pump_product and panel_product and modules_in_series > 0):
        return {"ok": True, "note": "insufficient data"}

    voc_stc = float(panel_product.get("voc") or 0)             # V per module @ 25°C
    vmp_stc = float(panel_product.get("vmp") or 0)
    imp_stc = float(panel_product.get("imp") or 0)
    temp_coef = float(panel_product.get("temp_coefficient_voc") or -0.29)  # %/°C

    # Voc at Tmin (silicon rises ~0.3-0.4% per °C below 25°C)
    delta_t = site_min_temp_c - 25
    voc_tmin_per_module = voc_stc * (1 + (temp_coef / 100) * delta_t)
    string_voc_tmin = round(voc_tmin_per_module * modules_in_series, 1)
    string_vmp = round(vmp_stc * modules_in_series, 1)
    array_imp = round(imp_stc * strings_in_parallel, 2)

    v_min = float(pump_product.get("controller_input_v_min") or 0)
    v_max = float(pump_product.get("controller_input_v_max") or 0)
    v_absmax = float(pump_product.get("controller_input_v_absolute_max") or 0)
    i_max = float(pump_product.get("controller_input_current_max") or 0)

    errors, warnings = [], []
    # Absolute max at Tmin — this is what destroys controllers in the field
    if v_absmax > 0 and string_voc_tmin > v_absmax:
        errors.append(
            f"String Voc at {site_min_temp_c}°C is {string_voc_tmin}V — exceeds controller absolute max {v_absmax}V. "
            f"Reduce modules-in-series to at most {int(v_absmax / voc_tmin_per_module)}."
        )
    # MPPT window at STC (approximation for warm operation)
    if v_min > 0 and string_vmp < v_min:
        errors.append(f"String Vmp {string_vmp}V is below controller MPPT-min {v_min}V — pump will not start on cloudy days.")
    if v_max > 0 and string_vmp > v_max:
        warnings.append(f"String Vmp {string_vmp}V is above controller MPPT-max {v_max}V — controller will curtail power.")
    # Current
    if i_max > 0 and array_imp > i_max:
        errors.append(f"Array Imp {array_imp}A exceeds controller input current max {i_max}A. Reduce strings-in-parallel.")

    return {
        "ok": len(errors) == 0,
        "string_voc_tmin": string_voc_tmin,
        "string_vmp_stc": string_vmp,
        "array_imp": array_imp,
        "voc_per_module_at_tmin": round(voc_tmin_per_module, 2),
        "site_min_temp_c": site_min_temp_c,
        "delta_t": delta_t,
        "temp_coef_used": temp_coef,
        "controller_absolute_max": v_absmax,
        "controller_mppt_min": v_min,
        "controller_mppt_max": v_max,
        "controller_current_max": i_max,
        "errors": errors,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Pump ROI by replacement mode (Change 5)
# ---------------------------------------------------------------------------
def pump_roi(input_kw: float, operating_hours: float, mode: str, mode_params: Dict[str, Any],
             fuel: Dict[str, Any] = None) -> Dict[str, Any]:
    """Compute pump ROI by replacement mode.

    Modes:
      - "diesel"       replaces a diesel/petrol genset pump. mode_params: {fuel_id, fuel_price?}
      - "grid"         replaces a grid-powered pump. mode_params: {tariff_per_unit}
      - "manual"       replaces hired/rental pumping. mode_params: {hours_per_year, hire_rate}
      - "zero_tariff"  agricultural free power — value is reliability. mode_params: {crop_value_per_year, hours_gained_per_year, hourly_value}
    """
    annual_kwh = input_kw * operating_hours * 365 if input_kw and operating_hours else 0
    result = {"mode": mode, "annual_kwh": round(annual_kwh)}

    if mode == "diesel":
        # Uses the fuel dict (from fuel_types collection) — replaces the hardcoded 0.28
        f = fuel or {"name": "Diesel", "unit": "litre", "units_per_kwh": 0.31, "default_price_per_unit": 92}
        units_per_kwh = float(f.get("units_per_kwh") or 0.31)
        price = float(mode_params.get("fuel_price") or f.get("default_price_per_unit") or 92)
        annual_units = annual_kwh * units_per_kwh
        annual_saving = round(annual_units * price)
        co2 = round(annual_units * float(f.get("co2_kg_per_unit") or 0), 1)
        result.update({
            "fuel": {"name": f.get("name"), "unit": f.get("unit"), "units_per_kwh": units_per_kwh,
                     "price_per_unit": price, "co2_kg_per_unit": f.get("co2_kg_per_unit")},
            "annual_fuel_units": round(annual_units, 1),
            "annual_saving": annual_saving,
            "annual_co2_offset_kg": co2,
        })
        return result

    if mode == "grid":
        tariff = float(mode_params.get("tariff_per_unit") or 0)
        if tariff <= 0:
            # zero-tariff safe handling — divert to reliability mode with a note
            result["mode"] = "zero_tariff"
            result["note"] = "Grid tariff is ₹0 (agricultural subsidised) — payback flipped to reliability basis"
            return {**result, **{
                "annual_saving": float(mode_params.get("crop_value_per_year") or 0),
                "value_delivered": float(mode_params.get("crop_value_per_year") or 0),
                "crop_value_per_year": mode_params.get("crop_value_per_year"),
            }}
        result.update({"tariff": tariff, "annual_saving": round(annual_kwh * tariff)})
        return result

    if mode == "manual":
        hours = float(mode_params.get("hours_per_year") or 0)
        rate = float(mode_params.get("hire_rate") or 0)
        result.update({"hours_per_year": hours, "hire_rate": rate,
                       "annual_saving": round(hours * rate)})
        return result

    if mode == "zero_tariff":
        # value case: crop reliability + yield uplift
        cv = float(mode_params.get("crop_value_per_year") or 0)
        result.update({
            "crop_value_per_year": cv,
            "hours_gained_per_year": mode_params.get("hours_gained_per_year"),
            "annual_saving": cv,           # for payback math
            "value_delivered": cv,
        })
        return result

    # Fallback — treat as diesel
    return pump_roi(input_kw, operating_hours, "diesel", mode_params, fuel)
