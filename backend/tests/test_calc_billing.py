"""Bi-monthly bills, feed-in (export) rate and network charge in the Step-4 calculator.

Checks the Python engine (backend/quick_calc.py) by hand-worked numbers, and that the browser engine
(frontend/src/utils/solarCalc.js) gives the same answers (runs it with node; skipped if node is missing).

    cd backend && pytest tests/test_calc_billing.py
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from quick_calc import compute_quick  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JS_ENGINE = os.path.join(ROOT, "frontend", "src", "utils", "solarCalc.js")

CONFIG = {"default_specific_yield": 4.6, "cost_per_kwp": {"on-grid": 55000, "hybrid": 75000, "off-grid": 95000},
          "system_life_years": 25, "panel_degradation_pct_per_year": 0.7, "battery_unit_kwh": 5, "default_tariff_per_unit": 8,
          "pm_surya_ghar": {"cap": 78000, "slabs": [{"upto_kw": 1, "amount": 30000}, {"upto_kw": 2, "amount": 60000}, {"upto_kw": 3, "amount": 78000}]}}
PANEL = {"name": "P540", "unit_price": 13500, "margin_pct": 15, "gst_percentage": 12, "specs": {"wattage": 540}}
INV = {"name": "I5", "unit_price": 45000, "margin_pct": 10, "gst_percentage": 12, "specs": {"rated_kw": 5}}
GEN_5KW = 5 * 4.6 * 365 / 12   # 699.58 units / month

CASES = {
    "monthly_plain": {"system_type": "on-grid", "monthly_eb_bill": 3000, "tariff_per_unit": 8},
    "bimonthly_bill": {"system_type": "on-grid", "monthly_eb_bill": 6000, "tariff_per_unit": 8, "billing_cycle": "bimonthly"},
    "bimonthly_units": {"system_type": "on-grid", "monthly_eb_units": 900, "tariff_per_unit": 6.5, "billing_cycle": "bimonthly"},
    "export_network_unit": {"system_type": "on-grid", "monthly_eb_units": 300, "tariff_per_unit": 8, "export_rate": 3, "network_charge": 0.5, "overrides": {"system_size_kw": 5}},
    "network_per_kw": {"system_type": "hybrid", "monthly_eb_units": 500, "tariff_per_unit": 7, "network_charge": 100, "network_charge_basis": "per_kw_month", "backup_hours": 4, "overrides": {"system_size_kw": 4}},
    "offgrid_ignores": {"system_type": "off-grid", "monthly_eb_units": 300, "tariff_per_unit": 8, "export_rate": 3, "network_charge": 1, "overrides": {"system_size_kw": 5}},
    "network_wipes_out": {"system_type": "on-grid", "monthly_eb_units": 300, "tariff_per_unit": 2, "network_charge": 5, "overrides": {"system_size_kw": 3}},
}
FIELDS = ["monthly_eb_units", "system_size_kw", "bill_units", "period_months", "monthly_bill_now", "bill_now_per_period",
          "energy_saving_monthly", "export_units_monthly", "export_income_monthly", "network_charge_monthly",
          "monthly_saving", "saving_per_period", "annual_saving", "payback_years", "lifetime_savings"]


def py(case):
    return compute_quick(dict(CASES[case]), CONFIG, PANEL, INV)


def test_monthly_unchanged_by_default():
    r = py("monthly_plain")
    assert r["billing_cycle"] == "monthly" and r["period_months"] == 1
    assert r["monthly_eb_units"] == 375 and r["export_income_monthly"] == 0 and r["network_charge_monthly"] == 0
    assert r["monthly_saving"] == round(min(3 * 4.6 * 365 / 12, 375) * 8)


def test_bimonthly_bill_is_halved_per_month():
    m, b = py("monthly_plain"), py("bimonthly_bill")
    for k in ("monthly_eb_units", "system_size_kw", "monthly_saving", "monthly_bill_now"):
        assert m[k] == b[k], k
    assert b["bill_units"] == 750 and b["bill_now_per_period"] == 6000 and b["saving_per_period"] == m["monthly_saving"] * 2
    u = py("bimonthly_units")
    assert u["monthly_eb_units"] == 450 and u["bill_units"] == 900


def test_export_income_and_network_charge_per_unit():
    r = py("export_network_unit")
    assert r["export_units_monthly"] == round(GEN_5KW - 300)
    assert r["energy_saving_monthly"] == 2400
    assert r["export_income_monthly"] == round((GEN_5KW - 300) * 3)
    assert r["network_charge_monthly"] == round(GEN_5KW * 0.5)
    assert r["monthly_saving"] == round(2400 + (GEN_5KW - 300) * 3 - GEN_5KW * 0.5)
    assert any("sold to the grid at ₹3/unit" in w["message"] for w in r["warnings"])


def test_network_charge_per_kw_month_and_offgrid():
    assert py("network_per_kw")["network_charge_monthly"] == 400
    g = py("offgrid_ignores")
    assert g["export_income_monthly"] == 0 and g["network_charge_monthly"] == 0 and g["export_rate"] == 0


def test_network_charge_wiping_out_saving_is_flagged():
    r = py("network_wipes_out")
    assert r["monthly_saving"] < 0 and r["payback_years"] is None
    assert any(w["field"] == "network_charge" for w in r["warnings"])


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_browser_engine_matches_python(tmp_path):
    runner = tmp_path / "run.mjs"
    runner.write_text(
        f"import {{ computeQuick }} from {json.dumps('file://' + JS_ENGINE)};\n"
        f"const cases = {json.dumps(CASES)}; const cfg = {json.dumps(CONFIG)};\n"
        f"const panel = {json.dumps(PANEL)}, inv = {json.dumps(INV)};\n"
        "const out = {}; for (const [k, c] of Object.entries(cases)) out[k] = computeQuick(c, cfg, panel, inv);\n"
        "console.log(JSON.stringify(out));\n")
    res = subprocess.run(["node", str(runner)], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    js = json.loads(res.stdout)
    for case in CASES:
        p = py(case)
        for f in FIELDS:
            # Python rounds halves to even, JS rounds them up — allow 1 rupee/unit of difference
            pv, jv = p[f], js[case][f]
            if isinstance(pv, (int, float)) and isinstance(jv, (int, float)):
                assert abs(pv - jv) <= 1, (case, f, pv, jv)
            else:
                assert pv == jv, (case, f, pv, jv)
        assert [w["field"] for w in p["warnings"]] == [w["field"] for w in js[case]["warnings"]], case
