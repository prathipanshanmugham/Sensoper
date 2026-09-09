"""Iter 51 §1 — PERMANENT regression: the grand total must include the base system cost.

Hand calculation for the fixture below (GST config = pricing_config.gst_pct, read at test time):
  base system   : 3 kW calculator result total_cost = 1,80,000  (ex-GST)  → GST @ g%  → system_total
  add-ons       : 2 × 4,000 @ 18% GST, 10% margin   → 8,000 + 800 margin + 1,440 GST = 10,240
                  1 × 6,000 @ 12% GST,  0% margin   → 6,000 + 720 GST               =  6,720
  manual        : 2,500 (no GST)
  subsidy       : 78,000
  grand total   = system_total + 10,240 + 6,720 + 2,500 − 78,000
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST51C_{uuid.uuid4().hex[:5]}"

SYSTEM_COST, SUBSIDY = 180000.0, 78000.0
ADDONS = [
    {"name": f"{TAG} SPD kit", "category": "bos", "unit_price": 4000, "quantity": 2, "gst_percentage": 18, "margin_percentage": 10},
    {"name": f"{TAG} Wi-Fi logger", "category": "cables_accessories", "unit_price": 6000, "quantity": 1, "gst_percentage": 12, "margin_percentage": 0},
]
MANUAL = [{"description": f"{TAG} crane hire", "amount": 2500}]
ADDONS_TOTAL = (8000 + 800 + 1440) + (6000 + 720) + 2500   # 19,460


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")}, timeout=60)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def gst_pct(client):
    return float(client.get(f"{API}/catalogue/config", timeout=60).json()["gst_pct"])


@pytest.fixture(scope="module")
def expected(gst_pct):
    system_gst = SYSTEM_COST * gst_pct / 100
    return {"system_gst": round(system_gst, 2), "gross": round(SYSTEM_COST + system_gst + ADDONS_TOTAL, 2),
            "grand": round(SYSTEM_COST + system_gst + ADDONS_TOTAL - SUBSIDY, 2)}


@pytest.fixture(scope="module")
def project(client):
    payload = {
        "customer": {"name": f"{TAG} Customer", "phone": "9000000051", "email": "iter51@test.com", "address": "1 Test Lane"},
        "location": {"address": "1 Test Lane", "city": "Chennai", "state": "Tamil Nadu", "pincode": "600001"},
        "electrical": {"sanction_load_kw": 3, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 7}, "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "fixed"}, "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10}, "solar_system": {"system_type": "on-grid", "capacity_kw": 3},
        "selected_items": ADDONS, "manual_costs": MANUAL,
        "custom_fields": {"proposed_solution": {"system_size_kw": 3, "total_cost": SYSTEM_COST, "subsidy": SUBSIDY, "net_cost": SYSTEM_COST - SUBSIDY}},
    }
    r = client.post(f"{API}/projects", json=payload, timeout=60)
    assert r.status_code in (200, 201), r.text
    pid = r.json().get("id") or r.json().get("project_id")
    yield client.get(f"{API}/projects/{pid}", timeout=60).json()
    client.delete(f"{API}/projects/{pid}/hard", json={"reason": "iter51 regression cleanup"}, timeout=60)
    client.delete(f"{API}/projects/{pid}", timeout=60)


class TestGrandTotalIncludesBaseSystem:
    def test_stored_cost_estimation(self, project, expected):
        ce = project["cost_estimation"]
        assert ce["system_cost"] == SYSTEM_COST, "base system cost missing from cost_estimation"
        assert ce["system_gst"] == expected["system_gst"]
        assert ce["addons_total"] == ADDONS_TOTAL
        assert ce["subsidy"] == SUBSIDY
        assert ce["gross_total"] == expected["gross"]
        assert ce["total_cost"] == expected["grand"], f"grand total {ce['total_cost']} ≠ hand-calculated {expected['grand']}"
        assert ce["total_cost"] > ADDONS_TOTAL, "total must not be the add-ons-only figure"

    def test_ceo_revenue_and_project_list_see_the_same_number(self, client, project, expected):
        rows = client.get(f"{API}/projects", timeout=60).json()
        row = next(r for r in rows if r["id"] == project["id"])
        assert row["cost_estimation"]["total_cost"] == expected["grand"]

    def test_invoice_totals_match(self, client, project, expected, gst_pct):
        r = client.post(f"{API}/projects/{project['id']}/invoice", json={"reverse_charge": False}, timeout=60)
        assert r.status_code == 200, r.text
        inv = r.json()
        sys_line = inv["line_items"][0]
        assert sys_line["taxable_value"] == SYSTEM_COST and sys_line["gst_pct"] == gst_pct
        # intra-state: CGST + SGST split of the system GST, never IGST
        assert round(sys_line["cgst"] + sys_line["sgst"], 2) == expected["system_gst"] and sys_line["igst"] == 0
        assert inv["total_taxable_value"] == round(SYSTEM_COST + 8800 + 6000 + 2500, 2)
        assert round(inv["total_cgst"] + inv["total_sgst"], 2) == round(expected["system_gst"] + 1440 + 720, 2)
        assert inv["grand_total"] == expected["grand"], "invoice grand total must equal the corrected project total"

    def test_profit_calculator_uses_corrected_total(self, client, project, expected):
        r = client.get(f"{API}/projects/{project['id']}/profit", timeout=60)
        if r.status_code != 200:
            pytest.skip("profit endpoint not available for this project state")
        d = r.json()
        # revenue = gross (before subsidy) minus GST pass-through → must include the base system
        assert abs(d["revenue"] - (expected["gross"] - (expected["system_gst"] + 1440 + 720))) < 1, d
        assert d["revenue"] > SYSTEM_COST

    def test_updating_calculator_result_recomputes_total(self, client, project, gst_pct):
        new_ps = {"proposed_solution": {"system_size_kw": 5, "total_cost": 300000, "subsidy": SUBSIDY}}
        r = client.put(f"{API}/projects/{project['id']}", json={"custom_fields": new_ps}, timeout=60)
        assert r.status_code == 200, r.text
        ce = client.get(f"{API}/projects/{project['id']}", timeout=60).json()["cost_estimation"]
        assert ce["system_cost"] == 300000
        assert ce["total_cost"] == round(300000 * (1 + gst_pct / 100) + ADDONS_TOTAL - SUBSIDY, 2)

    def test_project_without_calculator_result_still_sums_addons(self, client):
        payload = {"customer": {"name": f"{TAG} NoSys", "phone": "9000000052", "address": "x"}, "location": {"address": "x"}, "electrical": {"sanction_load_kw": 3, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 7}, "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "fixed"}, "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10},
                   "solar_system": {"system_type": "on-grid", "capacity_kw": 1}, "selected_items": ADDONS[:1], "manual_costs": []}
        r = client.post(f"{API}/projects", json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text
        pid = r.json().get("id")
        ce = client.get(f"{API}/projects/{pid}", timeout=60).json()["cost_estimation"]
        assert ce["system_cost"] == 0 and ce["subsidy"] == 0 and ce["total_cost"] == 10240
        client.delete(f"{API}/projects/{pid}/hard", json={"reason": "cleanup"}, timeout=60)
        client.delete(f"{API}/projects/{pid}", timeout=60)


class TestHistoricalAudit:
    def test_audit_endpoint_reports_counts(self, client):
        d = client.get(f"{API}/projects-cost-audit", timeout=60).json()
        for k in ("total_projects", "with_base_system", "already_correct", "affected", "no_calculator_result", "understated_by_total", "affected_projects"):
            assert k in d
        assert d["with_base_system"] == d["already_correct"] + d["affected"]
