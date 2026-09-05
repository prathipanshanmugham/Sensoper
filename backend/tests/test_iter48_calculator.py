"""Iteration 48 — Step-4 Quick Solar Calculator regression suite.

Three worked examples computed INDEPENDENTLY here (plain arithmetic, no import of the engine)
and asserted against POST /api/calculate/quick. Also covers: roof cap, inline warnings
(no silent zeros), manual overrides, company sales-stats + new profile fields.

Worked numbers assume the shipped defaults (specific yield 4.6, on-grid ₹55,000/kWp). The
expected values are derived from the live config so a deliberate admin change to those
constants does not break the suite, but the formulas themselves are pinned.
"""
import math, os, uuid, pytest, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST48_{uuid.uuid4().hex[:5]}"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": "Admin@123"}, timeout=60)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def cfg(client):
    r = client.get(f"{API}/calculate/config", timeout=60)
    assert r.status_code == 200
    return r.json()


def _mk(client, name, category, unit_price, margin_pct, specs):
    r = client.post(f"{API}/inventory/items", json={
        "name": f"{TAG} {name}", "sku_code": f"{TAG}-{uuid.uuid4().hex[:6]}", "category": category,
        "quantity": 100, "unit_price": unit_price, "margin_pct": margin_pct, "specs": specs,
    }, timeout=60)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def items(client):
    ids = {
        "panel540": _mk(client, "Panel 540W", "solar_panels", 13500, 15, {"wattage": 540}),
        "panel550": _mk(client, "Panel 550W", "solar_panels", 15125, 30, {"wattage": 550}),
        "inv3": _mk(client, "Inverter 3kW", "inverters", 30000, 10, {"rated_kw": 3}),
        "inv10": _mk(client, "Inverter 10kW", "inverters", 80000, 15, {"rated_kw": 10}),
        "inv5h": _mk(client, "Hybrid Inverter 5kW", "inverters", 60000, 15, {"rated_kw": 5}),
        "bat5": _mk(client, "LiFePO4 5.12kWh", "batteries", 120000, 10, {"kwh": 5.12, "dod_pct": 80}),
    }
    yield ids
    for i in ids.values():
        client.delete(f"{API}/inventory/items/{i}", timeout=60)


def _quick(client, **payload):
    r = client.post(f"{API}/calculate/quick", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


# ─────────────────────────────────────────────────────────────────────────────
class TestWorkedExamples:
    def test_case_a_3kw_residential_ongrid(self, client, cfg, items):
        """Bill ₹3,000 @ ₹8/unit → 375 units → 12.5/day → 12.5/4.6 = 2.72 → 3.0 kW.
        6 × 540 W panels @ 13,500×1.15 = 93,150; inverter 30,000×1.10 = 33,000;
        BOS 0.40×55,000×3 = 66,000 → total 1,92,150; subsidy 78,000 → net 1,14,150.
        Gen 3×4.6×365 = 5,037/yr → 419.75/mo, capped at 375 used → ₹3,000/mo = ₹36,000/yr.
        Payback 1,14,150 / 36,000 = 3.17 → 3.2 yrs."""
        sy = cfg["default_specific_yield"]; kwp = cfg["cost_per_kwp"]["on-grid"]
        res = _quick(client, system_type="on-grid", customer_type="residential", monthly_eb_bill=3000,
                     tariff_per_unit=8, subsidy=78000, panel_item_id=items["panel540"], inverter_item_id=items["inv3"])
        units = round(3000 / 8)
        kw = math.ceil(units / 30 / sy * 2) / 2
        panels = math.ceil(kw * 1000 / 540)
        total = round(panels * 13500 * 1.15 + 30000 * 1.10 + 0.40 * kwp * kw)
        net = total - 78000
        monthly_gen = kw * sy * 365 / 12
        annual_saving = round(min(monthly_gen, units) * 8 * 12)
        assert res["monthly_eb_units"] == units == 375
        assert res["system_size_kw"] == kw
        assert res["panel_count"] == panels
        assert res["total_cost"] == total
        assert res["net_cost"] == net
        assert res["annual_saving"] == annual_saving
        assert res["payback_years"] == round(net / annual_saving, 1)
        if sy == 4.6 and kwp == 55000:   # literal worked numbers
            assert (kw, panels, total, net, annual_saving, res["payback_years"]) == (3.0, 6, 192150, 114150, 36000, 3.2)
        assert res["warnings"] == []
        assert res["lines"]["panels"]["benchmark"] is False and res["lines"]["inverter"]["benchmark"] is False

    def test_case_b_10kw_commercial_ongrid_manual_size(self, client, cfg, items):
        """1,500 units @ ₹9 → 50/day → 10.87 → auto 11.0 kW; salesperson overrides to 10 kW.
        19 × 550 W @ 15,125×1.30 = 3,73,587.5; inverter 80,000×1.15 = 92,000; BOS 2,20,000
        → total 6,85,588 (rounded). No subsidy (commercial). Gen 16,790/yr → 1,399.17/mo < 1,500
        → ₹12,592.5/mo → ₹1,51,110/yr. Payback 6,85,588/1,51,110 = 4.54 → 4.5 yrs."""
        sy = cfg["default_specific_yield"]; kwp = cfg["cost_per_kwp"]["on-grid"]
        res = _quick(client, system_type="on-grid", customer_type="commercial", monthly_eb_units=1500,
                     tariff_per_unit=9, subsidy=0, panel_item_id=items["panel550"], inverter_item_id=items["inv10"],
                     overrides={"system_size_kw": 10})
        assert res["system_size_kw_auto"] == math.ceil(1500 / 30 / sy * 2) / 2
        assert res["system_size_kw"] == 10
        panels = math.ceil(10000 / 550)
        total = round(panels * 15125 * 1.30 + 80000 * 1.15 + 0.40 * kwp * 10)
        annual_saving = round(min(10 * sy * 365 / 12, 1500) * 9 * 12)
        assert res["panel_count"] == panels == 19
        assert res["total_cost"] == total
        assert res["subsidy"] == 0 and res["net_cost"] == total
        assert res["subsidy_reference"] == 0, "commercial must never get a PM Surya Ghar hint"
        assert res["annual_saving"] == annual_saving
        assert res["payback_years"] == round(total / annual_saving, 1)
        if sy == 4.6 and kwp == 55000:
            assert (res["system_size_kw_auto"], total, annual_saving, res["payback_years"]) == (11.0, 685588, 151110, 4.5)

    def test_case_c_hybrid_with_battery(self, client, cfg, items):
        """600 units @ ₹8 → 20/day → 4.35 → auto 4.5 kW; override to 5 kW, 4 h backup.
        Battery need = 20 × 4/24 × 1.2 / 0.80 = 5.0 kWh → 1 × 5.12 kWh @ 1,32,000.
        10 × 540 W = 1,55,250; hybrid inverter 69,000; BOS 1,10,000 → total 4,66,250;
        subsidy 78,000 → net 3,88,250. Gen 8,395/yr → 699.6/mo > 600 → ₹4,800/mo = ₹57,600/yr.
        Payback 3,88,250/57,600 = 6.74 → 6.7 yrs."""
        sy = cfg["default_specific_yield"]; kwp = cfg["cost_per_kwp"]["on-grid"]
        res = _quick(client, system_type="hybrid", customer_type="residential", monthly_eb_units=600,
                     tariff_per_unit=8, backup_hours=4, subsidy=78000, panel_item_id=items["panel540"],
                     inverter_item_id=items["inv5h"], battery_item_id=items["bat5"], overrides={"system_size_kw": 5})
        need = round(20 * 4 / 24 * 1.2 / 0.8, 2)
        assert res["battery_kwh_needed"] == need == 5.0
        assert res["battery_count"] == math.ceil(need / 5.12) == 1
        total = round(10 * 13500 * 1.15 + 60000 * 1.15 + 1 * 120000 * 1.10 + 0.40 * kwp * 5)
        annual_saving = round(min(5 * sy * 365 / 12, 600) * 8 * 12)
        assert res["panel_count"] == 10
        assert res["total_cost"] == total
        assert res["net_cost"] == total - 78000
        assert res["annual_saving"] == annual_saving
        assert res["payback_years"] == round((total - 78000) / annual_saving, 1)
        if sy == 4.6 and kwp == 55000:
            assert (total, res["net_cost"], annual_saving, res["payback_years"]) == (466250, 388250, 57600, 6.7)
        assert len(res["yearly"]) == cfg.get("system_life_years", 25)
        assert res["yearly"][-1]["without_solar"] > res["yearly"][-1]["with_solar"]


class TestGuardrails:
    def test_no_inputs_gives_zero_not_crash(self, client):
        res = _quick(client, system_type="on-grid")
        assert res["system_size_kw"] == 0 and res["total_cost"] == 0 and res["payback_years"] is None
        assert res["units_source"] == "none"

    def test_roof_cap_limits_size_with_warning(self, client, cfg):
        res = _quick(client, system_type="on-grid", monthly_eb_units=1500, tariff_per_unit=8, roof_area_sqft=500)
        assert res["roof_cap_kw"] == 5.0
        assert res["system_size_kw"] == 5.0
        assert any(w["field"] == "system_size_kw" and "roof" in w["message"].lower() for w in res["warnings"])

    def test_benchmark_used_when_no_products_and_flagged(self, client, cfg):
        kwp = cfg["cost_per_kwp"]["on-grid"]
        res = _quick(client, system_type="on-grid", monthly_eb_units=300, tariff_per_unit=8, overrides={"system_size_kw": 2})
        assert res["lines"]["panels"]["benchmark"] is True and res["lines"]["inverter"]["benchmark"] is True
        assert res["total_cost"] == round((0.45 + 0.15 + 0.40) * kwp * 2)
        assert res["panel_count_auto"] is None

    def test_panel_without_wattage_warns_instead_of_silent_zero(self, client):
        pid = _mk(client, "No-Watt Panel", "solar_panels", 10000, 0, {})
        try:
            res = _quick(client, system_type="on-grid", monthly_eb_units=300, tariff_per_unit=8, panel_item_id=pid)
            assert any(w["field"] == "panel_item_id" for w in res["warnings"])
            assert res["panel_count_auto"] is None
            # manual override still works
            res2 = _quick(client, system_type="on-grid", monthly_eb_units=300, tariff_per_unit=8, panel_item_id=pid, overrides={"panel_count": 6})
            assert res2["panel_count"] == 6 and res2["lines"]["panels"]["amount"] == 60000
        finally:
            client.delete(f"{API}/inventory/items/{pid}", timeout=60)

    def test_inverter_mismatch_warning(self, client, items):
        res = _quick(client, system_type="on-grid", monthly_eb_units=1500, tariff_per_unit=8, inverter_item_id=items["inv3"])
        assert any(w["field"] == "inverter_item_id" and "undersized" in w["message"] for w in res["warnings"])

    def test_subsidy_reference_residential_only(self, client, cfg):
        res = _quick(client, system_type="on-grid", customer_type="residential", monthly_eb_units=300, tariff_per_unit=8, overrides={"system_size_kw": 3})
        assert res["subsidy_reference"] == min(cfg["pm_surya_ghar"]["cap"], 78000)
        assert res["subsidy"] == 0, "subsidy stays manual — reference is a hint only"
        res2 = _quick(client, system_type="off-grid", customer_type="residential", monthly_eb_units=300, tariff_per_unit=8, overrides={"system_size_kw": 3})
        assert res2["subsidy_reference"] == 0

    def test_pump_rejected_here(self, client):
        res = _quick(client, system_type="solar-pump")
        assert "error" in res


class TestSalesStatsAndProfile:
    def test_sales_stats_shape(self, client):
        r = client.get(f"{API}/company/sales-stats", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert set(d) == {"installations_completed", "kwp_installed", "years_in_business"}
        assert d["installations_completed"] >= 0 and d["kwp_installed"] >= 0

    def test_profile_new_fields_roundtrip(self, client):
        r = client.get(f"{API}/company/active", timeout=60)
        pid = r.json().get("id")
        if not pid:
            pytest.skip("no active company profile")
        orig = r.json()
        payload = {"founded_year": 2015, "certifications": ["MNRE Empanelled", "TEDA Registered"],
                   "warranty_headline": "25-year performance warranty on panels",
                   "financing_options": [{"title": "EMI", "description": "12-60 month tie-ups"}],
                   "sales_contact_phone": "+91 90000 00000"}
        r = client.put(f"{API}/company/{pid}", json=payload, timeout=60)
        assert r.status_code == 200, r.text
        got = client.get(f"{API}/company/active", timeout=60).json()
        for k, v in payload.items():
            assert got[k] == v, k
        stats = client.get(f"{API}/company/sales-stats", timeout=60).json()
        assert stats["years_in_business"] >= 2026 - 2015
        # restore
        client.put(f"{API}/company/{pid}", json={k: orig.get(k) if orig.get(k) is not None else ([] if isinstance(v, list) else ("" if isinstance(v, str) else 0))
                                                for k, v in payload.items()}, timeout=60)
