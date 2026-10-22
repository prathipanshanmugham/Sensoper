"""Panel and inverter are optional on a quote (typed in, or not part of this job) — mirrors solarCalc.spec.js."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quick_calc import compute_quick, custom_item  # noqa: E402

CONFIG = {"default_specific_yield": 4.6, "cost_per_kwp": {"on-grid": 55000}, "system_life_years": 25, "panel_degradation_pct_per_year": 0.7,
          "default_tariff_per_unit": 8}
SVC = {f"{k}_{f}": v for k in ("structure", "cabling", "installation") for f, v in (("gst_pct", 18), ("margin_pct", 0))}
PANEL = {"name": "P540", "unit_price": 13500, "margin_pct": 15, "gst_percentage": 12, "specs": {"wattage": 540}}
INV = {"name": "I3", "unit_price": 30000, "margin_pct": 10, "gst_percentage": 12, "specs": {"rated_kw": 3}}
BASE = {"system_type": "on-grid", "monthly_eb_units": 300, "tariff_per_unit": 8, "overrides": {"system_size_kw": 3, **SVC}}


def test_no_inverter_is_zero_not_benchmark():
    r = compute_quick({**BASE, "inverter_mode": "none"}, CONFIG, PANEL, INV, None, None)
    assert r["lines"]["inverter"]["amount"] == 0 and r["lines"]["inverter"]["excluded"] and not r["lines"]["inverter"]["benchmark"]
    assert not any(m.startswith("Inverter") for m in r["pricing_issues"])


def test_neither_panel_nor_inverter_prices_only_services():
    r = compute_quick({**BASE, "panel_mode": "none", "inverter_mode": "none"}, CONFIG, PANEL, INV, None, None)
    assert r["panel_count"] == 0 and r["lines"]["panels"]["amount"] == 0 and r["total_cost"] == r["lines"]["bos"]["amount"]


def test_typed_in_inverter_priced_as_entered():
    inv = custom_item({"name": "Growatt 3kW", "rated_kw": 3, "unit_price": 42000, "gst_percentage": 12}, "inverter")
    r = compute_quick({**BASE, "inverter_mode": "custom"}, CONFIG, PANEL, inv, None, None)
    line = r["lines"]["inverter"]
    assert (line["amount"], line["custom"], line["benchmark"], line["gst_amount"]) == (42000, True, False, 5040)
    assert not [m for m in r["pricing_issues"] if "Growatt" in m]
    r2 = compute_quick({**BASE, "inverter_mode": "custom"}, CONFIG, PANEL, custom_item({"name": "X", "unit_price": 1000}, "inverter"), None, None)
    assert any("enter it above" in m for m in r2["pricing_issues"])
    assert custom_item({"name": "X"}, "panel") is None


def test_addon_gst_is_on_selling_price_and_totals_add_up():
    import pytest
    mm = pytest.importorskip("mongomock_motor")
    for k, v in {"MONGO_URL": "mongodb://localhost:27017", "DB_NAME": "calc_test", "JWT_SECRET": "t" * 48, "ADMIN_EMAIL": "boss@example.com",
                 "ADMIN_PASSWORD": "Adm1n-pass-123", "STORAGE_ROOT": "/tmp/sensoper-calc-test"}.items():
        os.environ.setdefault(k, v)
    import motor.motor_asyncio as _m
    _m.AsyncIOMotorClient = mm.AsyncMongoMockClient
    import server
    ce = server.calculate_cost_estimation(
        [{"name": "SPD", "category": "bos", "unit_price": 4000, "quantity": 2, "gst_percentage": 18, "margin_percentage": 10}],
        [{"description": "Crane", "amount": 2500, "gst_pct": 18, "margin_pct": 0}],
        {"proposed_solution": {"total_cost": 180000, "subsidy": 78000, "system_size_kw": 3,
                               "_quick": {"total_gst": 24840, "lines": {"panels": {"amount": 100000, "margin_pct": 25, "gst_pct": 12, "gst_amount": 12000},
                                                                        "structure": {"amount": 40000, "cost": 32000, "gst_pct": 18, "gst_amount": 7200}}}}})
    it = ce["items_breakdown"][0]
    assert (it["sell_unit_price"], it["sell_amount"], it["gst_amount"]) == (4400, 8800, 1584)
    assert ce["taxable_total"] == 180000 + 8800 + 2500
    assert round(ce["taxable_total"] + ce["total_gst"], 2) == ce["gross_total"]
    assert ce["system_margin"] == 20000 + 8000 and ce["margin_total"] == 800 + 28000


def test_old_estimates_get_the_same_numbers():
    from project_numbers import fill_missing, project_margin
    old = {"total_margin": 800, "gross_total": 215000, "total_gst": 27000, "system_cost": 180000,
           "system_lines": {"inverter": {"amount": 33000, "margin_pct": 10}, "panels": {"amount": 90000, "benchmark": True, "margin_pct": None}}}
    f = fill_missing(old)
    assert f["taxable_total"] == 188000 and f["system_margin"] == 3000 and f["margin_total"] == 3800
    assert project_margin({"cost_estimation": old}) == 3800
    assert project_margin({"cost_estimation": {"margin_total": 12}}) == 12
