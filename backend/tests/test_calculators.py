"""Unit tests for the calculators package — slabs, subsidy, ongrid & pump."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from calculators.tariffs import compute_bill_from_slabs, back_solve_units, compute_bill_savings, pick_category
from calculators.subsidy import pm_surya_ghar_subsidy, pm_kusum_subsidy
from calculators.ongrid import compute as ongrid_compute
from calculators.pump import compute as pump_compute


TN_DOMESTIC = {
    "name": "Domestic",
    "fixed_charge": 25,
    "export_rate": 3.0,
    "slab_structure": "telescopic",
    "slabs": [
        {"from_units": 0,    "to_units": 100,  "rate_per_unit": 0},
        {"from_units": 100,  "to_units": 200,  "rate_per_unit": 2.35},
        {"from_units": 200,  "to_units": 400,  "rate_per_unit": 4.7},
        {"from_units": 400,  "to_units": 500,  "rate_per_unit": 6.3},
        {"from_units": 500,  "to_units": 600,  "rate_per_unit": 8.4},
        {"from_units": 600,  "to_units": 800,  "rate_per_unit": 9.45},
        {"from_units": 800,  "to_units": 1000, "rate_per_unit": 10.5},
        {"from_units": 1000, "to_units": None, "rate_per_unit": 11.55},
    ],
}

TANGEDCO = {"id": "TANGEDCO", "name": "TANGEDCO", "categories": [TN_DOMESTIC]}


def test_slab_bill_telescopic_500_units():
    r = compute_bill_from_slabs(500, TN_DOMESTIC)
    # 100 free + 100·2.35 + 200·4.7 + 100·6.3 = 0 + 235 + 940 + 630 = 1805 + 25 fixed
    assert r["total"] == 1830
    assert len(r["slab_breakdown"]) == 4


def test_slab_zero_units():
    r = compute_bill_from_slabs(0, TN_DOMESTIC)
    assert r["total"] == 25  # only fixed


def test_back_solve_units_round_trip():
    # Bill of ₹1830 → should back-solve to ~500 units
    u = back_solve_units(1830, TN_DOMESTIC)
    assert 495 <= u <= 505


def test_savings_top_slab_first():
    # 500 units pre, 300 gen → post 200 units.
    # pre = 1830, post = 100·0 + 100·2.35 = 235 + 25 = 260. save = 1570
    s = compute_bill_savings(500, 300, TN_DOMESTIC, net_metering=True)
    assert s["monthly_saving"] == 1570.0
    assert s["pre_bill"]["total"] == 1830
    assert s["post_bill"]["total"] == 260


def test_savings_export_credit_when_gen_exceeds_use():
    # 300 units pre, 500 gen → 200 excess exported at ₹3
    s = compute_bill_savings(300, 500, TN_DOMESTIC, net_metering=True)
    assert s["excess_export_units"] == 200
    assert s["export_credit"] == 600


def test_pm_surya_ghar_slabs():
    assert pm_surya_ghar_subsidy(0.5, "Domestic", "on-grid")["amount"] == 0
    assert pm_surya_ghar_subsidy(1,   "Domestic", "on-grid")["amount"] == 30000
    assert pm_surya_ghar_subsidy(2,   "Domestic", "on-grid")["amount"] == 48000
    assert pm_surya_ghar_subsidy(3,   "Domestic", "on-grid")["amount"] == 78000
    assert pm_surya_ghar_subsidy(10,  "Domestic", "on-grid")["amount"] == 78000  # capped
    # Off-grid not eligible
    assert pm_surya_ghar_subsidy(5, "Domestic", "off-grid")["amount"] == 0
    # Commercial not eligible
    assert pm_surya_ghar_subsidy(5, "Commercial", "on-grid")["amount"] == 0


def test_pm_kusum_split_shares():
    r = pm_kusum_subsidy(pump_kw=3, central_share_pct=30, state_share_pct=30, farmer_share_pct=40)
    assert r["eligible"]
    assert r["benchmark_cost"] == 120000
    # central 30 + state 30 = 60% of 120k = 72000
    assert r["amount"] == 72000


def test_ongrid_zero_tariff_no_crash():
    """Agricultural ₹0 tariff must produce payback=None (not divide by zero)."""
    zero_cat = {"name": "Agricultural", "fixed_charge": 0,
                "slabs": [{"from_units": 0, "to_units": None, "rate_per_unit": 0}]}
    zero_discom = {"id": "TEST", "categories": [zero_cat]}
    pin = {"specific_yield_kwh_per_kwp_day": 4.5, "peak_sun_hours": 6.0, "region_cost_factor": 1.0}
    r = ongrid_compute(
        inputs={"monthly_eb_units": 500, "tariff_category": "Agricultural", "net_metering": False},
        overrides={}, config={}, discom=zero_discom, pin=pin
    )
    # Payback must not be inf/NaN — None is the correct null-signal
    assert r["result"]["payback_years"] is None
    assert r["result"]["monthly_saving"] == 0.0


def test_ongrid_tn_vs_kl_produces_different_paybacks():
    """Same ₹3500 bill in TN vs a stiffer telescopic gives different sizings."""
    KL_DOMESTIC = {"name": "Domestic", "fixed_charge": 40, "export_rate": 2.85, "slab_structure": "telescopic",
                   "slabs": [
                       {"from_units": 0,   "to_units": 50,  "rate_per_unit": 3.25},
                       {"from_units": 50,  "to_units": 100, "rate_per_unit": 4.05},
                       {"from_units": 100, "to_units": 150, "rate_per_unit": 5.10},
                       {"from_units": 150, "to_units": 200, "rate_per_unit": 6.95},
                       {"from_units": 200, "to_units": 250, "rate_per_unit": 8.20},
                       {"from_units": 250, "to_units": 300, "rate_per_unit": 6.40},
                       {"from_units": 300, "to_units": 350, "rate_per_unit": 7.25},
                       {"from_units": 350, "to_units": 400, "rate_per_unit": 7.60},
                       {"from_units": 400, "to_units": 500, "rate_per_unit": 8.20},
                       {"from_units": 500, "to_units": None,"rate_per_unit": 9.65}]}
    KSEB = {"id": "KSEB", "categories": [KL_DOMESTIC]}
    pin_tn = {"specific_yield_kwh_per_kwp_day": 4.65, "region_cost_factor": 1.0}
    pin_kl = {"specific_yield_kwh_per_kwp_day": 4.1,  "region_cost_factor": 1.05}
    body = {"monthly_eb_bill": 3500, "tariff_category": "Domestic", "net_metering": True}
    tn = ongrid_compute(inputs=body, overrides={}, config={}, discom=TANGEDCO, pin=pin_tn)
    kl = ongrid_compute(inputs=body, overrides={}, config={}, discom=KSEB, pin=pin_kl)
    # TN reverse-solves to more units for the same ₹3500 (cheaper slabs), sizing differs
    assert tn["result"]["monthly_units_pre"] > kl["result"]["monthly_units_pre"]
    assert tn["result"]["system_size_kw"] != kl["result"]["system_size_kw"]


def test_pump_dc_sizing_reasonable():
    pin = {"specific_yield_kwh_per_kwp_day": 4.75, "peak_sun_hours": 5.95, "region_cost_factor": 1.0}
    r = pump_compute(
        inputs={
            "pump_path": "DC",
            "water_requirement_lpd": 30000, "daily_operating_hours": 6,
            "static_water_level_m": 30, "dynamic_water_level_m": 50,
            "delivery_head_m": 10, "horizontal_pipe_run_m": 40,
            "pipe_internal_diameter_mm": 40, "pipe_material": "HDPE",
            "bore_casing_diameter_mm": 150, "bore_yield_lph": 6000,
            "controller_max_voltage": 100, "string_voltage_v": 80,
        }, overrides={}, config={}, pin=pin
    )
    res = r["result"]
    assert res["pump_path"] == "DC"
    assert res["pump_hp_selected"] in (2, 3)
    assert res["tdh_m"] > 55  # ~60m
    assert 2 < res["system_size_kw"] < 5


def test_pump_bore_casing_warning():
    """3 HP submersible needs ≥100mm casing — a 90mm bore must warn."""
    pin = {"specific_yield_kwh_per_kwp_day": 4.75, "peak_sun_hours": 5.95, "region_cost_factor": 1.0}
    r = pump_compute(
        inputs={"pump_path": "DC", "water_requirement_lpd": 30000, "daily_operating_hours": 6,
                "static_water_level_m": 30, "dynamic_water_level_m": 50, "delivery_head_m": 10,
                "horizontal_pipe_run_m": 40, "pipe_internal_diameter_mm": 40, "pipe_material": "HDPE",
                "bore_casing_diameter_mm": 90},
        overrides={}, config={}, pin=pin
    )
    warnings = " ".join(r["result"]["warnings"])
    assert "casing" in warnings.lower()


def test_pump_ac_uses_vfd_efficiency():
    """Same duty AC path should require more array kWp than DC."""
    pin = {"specific_yield_kwh_per_kwp_day": 4.75, "peak_sun_hours": 5.95, "region_cost_factor": 1.0}
    common = {"water_requirement_lpd": 30000, "daily_operating_hours": 6,
              "static_water_level_m": 30, "dynamic_water_level_m": 50, "delivery_head_m": 10,
              "horizontal_pipe_run_m": 40, "pipe_internal_diameter_mm": 40, "pipe_material": "HDPE"}
    dc = pump_compute(inputs={**common, "pump_path": "DC"}, overrides={}, config={}, pin=pin)
    ac = pump_compute(inputs={**common, "pump_path": "AC"}, overrides={}, config={}, pin=pin)
    assert ac["result"]["system_size_kw"] > dc["result"]["system_size_kw"]


def test_override_wins():
    """User override of system_size_kw must not be recomputed away."""
    pin = {"specific_yield_kwh_per_kwp_day": 4.5, "region_cost_factor": 1.0}
    r = ongrid_compute(
        inputs={"monthly_eb_bill": 3500, "tariff_category": "Domestic"},
        overrides={"system_size_kw": 6.9}, config={}, discom=TANGEDCO, pin=pin
    )
    assert r["result"]["system_size_kw"] == 6.9
