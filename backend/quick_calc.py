"""
Quick Solar Calculator (Iteration 48) — the engine behind Step 4 of the site-visit form.

Pure function `compute_quick()` + `POST /api/calculate/quick` + `GET /api/company/sales-stats`.
The frontend mirrors these exact formulas in `frontend/src/utils/solarCalc.js` for instant
feedback; `backend/tests/test_iter48_calculator.py` pins three worked examples so the numbers
cannot silently drift.

Formulas (all shares are of the admin `cost_per_kwp` config):
  units      = monthly_eb_units  or  round(monthly_eb_bill / tariff)
  kW (auto)  = ceil((units/30 / specific_yield) * 2) / 2      # up to nearest 0.5 kW, roof-capped at 100 sqft/kW
  panels     = ceil(kW*1000 / panel_wattage)
  sell price = unit_price * (1 + margin_pct/100)               # margin defaults to 15 like the Pricelist
  panel cost = panels * panel_sell            (benchmark 45% * cost_per_kwp[on-grid] * kW if no panel picked)
  inverter   = inverter_sell                  (benchmark 15% * cost_per_kwp[type] * kW if none)
  battery    = batteries * battery_sell       (hybrid/off-grid; benchmark kWh * battery_benchmark_per_kwh)
  BOS+install= 40% * cost_per_kwp[on-grid] * kW
  gen/yr     = kW * specific_yield * 365
  saving/mo  = min(gen/12, units) * tariff    (gen/12 * tariff when units unknown)
  payback    = net_cost / annual_saving
"""
from __future__ import annotations
import math
from typing import Any, Dict, Optional, List
from fastapi import APIRouter, Request
from pydantic import BaseModel
from bson import ObjectId

DEFAULT_MARGIN_PCT = 15.0
BOS_SHARE = 0.40
PANEL_BENCH_SHARE = 0.45
INVERTER_BENCH_SHARE = 0.15
ROOF_SQFT_PER_KW = 100
BATTERY_HEADROOM = 1.2
GRID_TYPES = ("on-grid", "off-grid", "hybrid")


def _num(v, default=0.0) -> float:
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def sell_price(item: Optional[Dict[str, Any]]) -> float:
    if not item:
        return 0.0
    margin = item.get("margin_pct")
    margin = DEFAULT_MARGIN_PCT if margin is None else _num(margin, DEFAULT_MARGIN_PCT)
    return _num(item.get("unit_price")) * (1 + margin / 100)


def pm_surya_ghar_reference(kw: float, config: Dict[str, Any]) -> int:
    """Reference-only figure shown as a hint next to the manual subsidy field."""
    cfg = (config or {}).get("pm_surya_ghar") or {}
    slabs = sorted(cfg.get("slabs") or [], key=lambda s: _num(s.get("upto_kw")))
    amount = 0
    for s in slabs:
        if kw >= _num(s.get("upto_kw")):
            amount = _num(s.get("amount"))
    return int(min(amount, _num(cfg.get("cap"), 78000)))


def compute_quick(inputs: Dict[str, Any], config: Dict[str, Any],
                  panel: Optional[Dict] = None, inverter: Optional[Dict] = None,
                  battery: Optional[Dict] = None) -> Dict[str, Any]:
    system_type = inputs.get("system_type") or "on-grid"
    overrides = inputs.get("overrides") or {}
    customer_type = inputs.get("customer_type") or "residential"
    warnings: List[Dict[str, str]] = []
    warn = lambda field, msg: warnings.append({"field": field, "message": msg})  # noqa: E731

    cost_map = (config or {}).get("cost_per_kwp") or {}
    base_kwp = _num(cost_map.get("on-grid"), 55000)
    type_kwp = _num(cost_map.get(system_type), base_kwp)
    sy = _num(config.get("default_specific_yield"), 4.4) or 4.4
    tariff = _num(inputs.get("tariff_per_unit")) or _num(config.get("default_tariff_per_unit"), 8) or 8

    # ── Consumption ──────────────────────────────────────────────────
    units = _num(inputs.get("monthly_eb_units"))
    bill = _num(inputs.get("monthly_eb_bill"))
    units_source = "entered"
    if units <= 0 and bill > 0:
        units = round(bill / tariff)
        units_source = "from_bill"
    if units <= 0:
        units_source = "none"
    daily_units = units / 30 if units > 0 else 0

    # ── Sizing ───────────────────────────────────────────────────────
    kw_auto = math.ceil((daily_units / sy) * 2) / 2 if daily_units > 0 else 0
    roof_sqft = _num(inputs.get("roof_area_sqft"))
    roof_cap_kw = math.floor((roof_sqft / ROOF_SQFT_PER_KW) * 2) / 2 if roof_sqft > 0 else None
    roof_limited = False
    if roof_cap_kw is not None and kw_auto > roof_cap_kw:
        kw_auto = roof_cap_kw
        roof_limited = True
    kw_manual = overrides.get("system_size_kw")
    kw = _num(kw_manual) if kw_manual not in (None, "") else kw_auto
    if roof_cap_kw is not None and kw > roof_cap_kw:
        warn("system_size_kw", f"Roof of {roof_sqft:g} sq ft fits about {roof_cap_kw:g} kW ({ROOF_SQFT_PER_KW} sq ft per kW). {kw:g} kW may not fit.")
    elif roof_limited:
        warn("system_size_kw", f"Size limited by roof: {roof_sqft:g} sq ft fits about {roof_cap_kw:g} kW.")

    panel_w = _num((panel or {}).get("specs", {}).get("wattage")) if panel else 0
    if panel and panel_w <= 0:
        warn("panel_item_id", f"'{panel.get('name')}' has no wattage in Inventory — set the panel count manually or add specs.wattage.")
    panel_count_auto = math.ceil(kw * 1000 / panel_w) if (kw > 0 and panel_w > 0) else None
    pc_manual = overrides.get("panel_count")
    panel_count = int(_num(pc_manual)) if pc_manual not in (None, "") else (panel_count_auto or 0)

    inverter_kw = _num((inverter or {}).get("specs", {}).get("rated_kw")) if inverter else 0
    if inverter and inverter_kw > 0 and kw > 0:
        if inverter_kw < kw * 0.8:
            warn("inverter_item_id", f"Inverter is {inverter_kw:g} kW for a {kw:g} kW array — undersized (below 80%). Pick a larger inverter.")
        elif inverter_kw > kw * 1.5:
            warn("inverter_item_id", f"Inverter is {inverter_kw:g} kW for a {kw:g} kW array — oversized (over 150%). A smaller unit would cost less.")

    # ── Battery (hybrid / off-grid) ──────────────────────────────────
    needs_battery = system_type in ("hybrid", "off-grid")
    backup_hours = _num(inputs.get("backup_hours")) or (8 if system_type == "off-grid" else 4)
    battery_kwh_needed = 0.0
    battery_unit_kwh = 0.0
    battery_count_auto = None
    battery_count = 0
    if needs_battery and daily_units > 0:
        dod = _num((battery or {}).get("specs", {}).get("dod_pct")) if battery else 0
        dod = (dod / 100) if dod > 0 else 0.8
        battery_kwh_needed = round(daily_units * backup_hours / 24 * BATTERY_HEADROOM / dod, 2)
        battery_unit_kwh = _num((battery or {}).get("specs", {}).get("kwh")) if battery else 0
        if battery and battery_unit_kwh <= 0:
            warn("battery_item_id", f"'{battery.get('name')}' has no kWh in Inventory — set the battery count manually or add specs.kwh.")
        if battery_unit_kwh <= 0:
            battery_unit_kwh = _num(config.get("battery_unit_kwh"), 5) or 5
        battery_count_auto = math.ceil(battery_kwh_needed / battery_unit_kwh) if battery_kwh_needed > 0 else 0
    bc_manual = overrides.get("battery_count")
    if needs_battery:
        battery_count = int(_num(bc_manual)) if bc_manual not in (None, "") else (battery_count_auto or 0)

    # ── Cost lines ───────────────────────────────────────────────────
    panel_sell = sell_price(panel)
    panel_cost = panel_sell * panel_count if (panel and panel_sell > 0 and panel_count > 0) else PANEL_BENCH_SHARE * base_kwp * kw
    panel_benchmark = not (panel and panel_sell > 0 and panel_count > 0)
    inverter_sell = sell_price(inverter)
    inverter_cost = inverter_sell if (inverter and inverter_sell > 0) else INVERTER_BENCH_SHARE * type_kwp * kw
    inverter_benchmark = not (inverter and inverter_sell > 0)
    battery_sell = sell_price(battery)
    battery_cost = 0.0
    battery_benchmark = False
    if needs_battery and battery_count > 0:
        if battery and battery_sell > 0:
            battery_cost = battery_sell * battery_count
        else:
            battery_cost = battery_count * battery_unit_kwh * _num(config.get("battery_benchmark_per_kwh"), 20000)
            battery_benchmark = True
    bos_auto = BOS_SHARE * base_kwp * kw
    bos_manual = overrides.get("bos_cost")
    bos_cost = _num(bos_manual) if bos_manual not in (None, "") else bos_auto

    total_cost = round(panel_cost + inverter_cost + battery_cost + bos_cost) if kw > 0 else 0
    subsidy = max(_num(inputs.get("subsidy")), 0)
    if subsidy > total_cost > 0:
        warn("subsidy", f"Subsidy ₹{subsidy:,.0f} is more than the system cost ₹{total_cost:,.0f} — check the amount.")
    net_cost = max(total_cost - subsidy, 0)

    # ── Generation & savings ─────────────────────────────────────────
    annual_gen = kw * sy * 365
    monthly_gen = annual_gen / 12
    offset_units = min(monthly_gen, units) if units > 0 else monthly_gen
    monthly_saving = offset_units * tariff
    annual_saving = monthly_saving * 12
    payback_years = round(net_cost / annual_saving, 1) if (annual_saving > 0 and net_cost > 0) else (0 if net_cost == 0 and annual_saving > 0 else None)
    if units > 0 and monthly_gen > units * 1.25:
        warn("system_size_kw", f"System makes ~{monthly_gen:,.0f} units/month but the customer uses {units:,.0f} — savings are capped at what they use.")

    life = int(_num(config.get("system_life_years"), 25)) or 25
    deg = _num(config.get("panel_degradation_pct_per_year"), 0.7) / 100
    monthly_bill_now = units * tariff if units > 0 else bill
    yearly = []
    cum_without = 0.0
    cum_with = float(net_cost)
    lifetime_savings = 0.0
    for y in range(1, life + 1):
        factor = (1 - deg) ** (y - 1)
        saving_y = annual_saving * factor
        lifetime_savings += saving_y
        cum_without += monthly_bill_now * 12
        cum_with += max(monthly_bill_now * 12 - saving_y, 0)
        yearly.append({"year": y, "without_solar": round(cum_without), "with_solar": round(cum_with)})

    subsidy_ref = pm_surya_ghar_reference(kw, config) if (customer_type == "residential" and system_type in ("on-grid", "hybrid") and kw > 0) else 0

    return {
        "system_type": system_type,
        "customer_type": customer_type,
        "tariff_per_unit": tariff,
        "specific_yield": sy,
        "monthly_eb_units": round(units),
        "units_source": units_source,
        "daily_units": round(daily_units, 2),
        "system_size_kw_auto": kw_auto,
        "system_size_kw": kw,
        "roof_cap_kw": roof_cap_kw,
        "panel_wattage_w": panel_w or None,
        "panel_count_auto": panel_count_auto,
        "panel_count": panel_count,
        "inverter_rated_kw": inverter_kw or None,
        "backup_hours": backup_hours if needs_battery else None,
        "battery_kwh_needed": battery_kwh_needed if needs_battery else None,
        "battery_unit_kwh": battery_unit_kwh if needs_battery else None,
        "battery_count_auto": battery_count_auto,
        "battery_count": battery_count,
        "lines": {
            "panels": {"amount": round(panel_cost), "benchmark": panel_benchmark, "unit_price": round(panel_sell, 2) if panel else None},
            "inverter": {"amount": round(inverter_cost), "benchmark": inverter_benchmark, "unit_price": round(inverter_sell, 2) if inverter else None},
            "battery": {"amount": round(battery_cost), "benchmark": battery_benchmark, "unit_price": round(battery_sell, 2) if battery else None} if needs_battery else None,
            "bos": {"amount": round(bos_cost), "auto": round(bos_auto)},
        },
        "total_cost": total_cost,
        "subsidy": round(subsidy),
        "subsidy_reference": subsidy_ref,
        "net_cost": round(net_cost),
        "annual_generation_units": round(annual_gen),
        "monthly_generation_units": round(monthly_gen),
        "monthly_bill_now": round(monthly_bill_now),
        "monthly_saving": round(monthly_saving),
        "annual_saving": round(annual_saving),
        "payback_years": payback_years,
        "lifetime_savings": round(lifetime_savings),
        "roi_pct": round(annual_saving / net_cost * 100, 1) if net_cost > 0 else None,
        "yearly": yearly,
        "warnings": warnings,
    }


class QuickCalcRequest(BaseModel):
    system_type: str = "on-grid"
    customer_type: Optional[str] = "residential"
    monthly_eb_bill: Optional[float] = None
    monthly_eb_units: Optional[float] = None
    tariff_per_unit: Optional[float] = None
    roof_area_sqft: Optional[float] = None
    backup_hours: Optional[float] = None
    subsidy: Optional[float] = 0
    panel_item_id: Optional[str] = None
    inverter_item_id: Optional[str] = None
    battery_item_id: Optional[str] = None
    overrides: Dict[str, Any] = {}


def create_router(db, get_current_user, get_calc_config):
    router = APIRouter()

    async def _item(item_id: Optional[str]):
        if not item_id or not ObjectId.is_valid(item_id):
            return None
        doc = await db.inventory_items.find_one({"_id": ObjectId(item_id)})
        return doc

    @router.post("/calculate/quick")
    async def quick_calc(payload: QuickCalcRequest, request: Request):
        await get_current_user(request)
        if payload.system_type not in GRID_TYPES:
            return {"error": f"system_type must be one of {list(GRID_TYPES)} — solar pumps use /calculate/solution"}
        config = await get_calc_config()
        panel, inverter, battery = await _item(payload.panel_item_id), await _item(payload.inverter_item_id), await _item(payload.battery_item_id)
        return compute_quick(payload.model_dump(), config, panel, inverter, battery)

    @router.get("/company/sales-stats")
    async def sales_stats(request: Request):
        """Real cumulative figures for the 'Why us' block on quotations — never placeholders."""
        await get_current_user(request)
        cursor = db.projects.find({"status": "completed", "deleted_at": {"$exists": False}},
                                  {"custom_fields.proposed_solution.system_size_kw": 1, "solar_system.system_size_kw": 1})
        count, kwp = 0, 0.0
        async for p in cursor:
            count += 1
            ps = (p.get("custom_fields") or {}).get("proposed_solution") or {}
            kwp += _num(ps.get("system_size_kw")) or _num((p.get("solar_system") or {}).get("system_size_kw"))
        cp = await db.company_profiles.find_one({"is_active": True}) or {}
        founded = cp.get("founded_year")
        from datetime import datetime, timezone
        years = (datetime.now(timezone.utc).year - int(founded)) if founded else None
        return {"installations_completed": count, "kwp_installed": round(kwp, 1), "years_in_business": years}

    return router
