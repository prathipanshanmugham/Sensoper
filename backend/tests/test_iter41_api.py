"""Iteration 41 API tests: calculate endpoints + project persistence."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://solar-ops-management.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{BASE}/api/auth/login", json={"email": "admin@sensoper.com", "password": "Admin@123"})
    assert r.status_code == 200, r.text
    return sess


def test_seed_defaults_idempotent(s):
    r1 = s.post(f"{BASE}/api/calculate/seed-defaults")
    assert r1.status_code == 200, r1.text
    r2 = s.post(f"{BASE}/api/calculate/seed-defaults")
    assert r2.status_code == 200
    d = r2.json()
    # keys observed: discoms_created, pincodes_created
    dc = d.get("discoms_created", 0)
    pc = d.get("pincodes_created", 0)
    assert dc == 0 and pc == 0, f"2nd seed run created new items: {d}"


def test_lookup_641001_tangedco(s):
    r = s.get(f"{BASE}/api/calculate/lookup/641001")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("resolved") is True
    assert d.get("district") == "Coimbatore"
    assert d.get("state") == "Tamil Nadu"
    assert d.get("discom_id") == "TANGEDCO"
    y = d.get("yield_kwh_per_kwp_day") or d.get("specific_yield_kwh_per_kwp_day") or d.get("specific_yield")
    assert y is not None and abs(float(y) - 4.65) < 0.02, f"yield={y}"
    # slab categories anywhere
    cats = d.get("categories") or (d.get("discom") or {}).get("categories") or (d.get("discom") or {}).get("slabs")
    if isinstance(cats, list):
        assert len(cats) >= 5, f"expected >=5 categories, got {len(cats)}"
    elif isinstance(cats, dict):
        assert len(cats) >= 5


def test_lookup_682001_kseb(s):
    r = s.get(f"{BASE}/api/calculate/lookup/682001")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("resolved") is True
    assert d.get("state") == "Kerala"
    assert d.get("discom_id") == "KSEB"


def test_lookup_999999_fallback(s):
    r = s.get(f"{BASE}/api/calculate/lookup/999999")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("resolved") is False
    did = d.get("discom_id") or (d.get("discom") or {}).get("id") or (d.get("discom") or {}).get("discom_id")
    assert did == "FALLBACK", f"expected FALLBACK, got {did}"


def _payload(discom_id, category="Domestic", bill=3500, state="Tamil Nadu", pincode="641001"):
    return {
        "system_type": "on-grid",
        "discom_id": discom_id,
        "pincode": pincode,
        "inputs": {
            "monthly_eb_bill": bill,
            "tariff_category": category,
        },
    }


def test_solution_tn_vs_kl_payback_differs(s):
    tn = s.post(f"{BASE}/api/calculate/solution", json=_payload("TANGEDCO", state="Tamil Nadu", pincode="641001"))
    kl = s.post(f"{BASE}/api/calculate/solution", json=_payload("KSEB", state="Kerala", pincode="682001"))
    assert tn.status_code == 200, tn.text
    assert kl.status_code == 200, kl.text
    tnj, klj = tn.json(), kl.json()
    tn_res = tnj.get("result", tnj)
    kl_res = klj.get("result", klj)
    tn_pb = tn_res.get("payback_years") or tn_res.get("payback")
    kl_pb = kl_res.get("payback_years") or kl_res.get("payback")
    assert tn_pb is not None and kl_pb is not None, f"tn={tn_res}, kl={kl_res}"
    assert abs(float(tn_pb) - float(kl_pb)) > 0.05, f"paybacks too similar TN={tn_pb} KL={kl_pb}"


def test_solution_agricultural_no_divzero(s):
    r = s.post(f"{BASE}/api/calculate/solution", json=_payload("TANGEDCO", category="Agricultural"))
    assert r.status_code == 200, r.text
    d = r.json()
    res = d.get("result", d)
    pb = res.get("payback_years", res.get("payback"))
    assert pb is None, f"expected None payback for agri (0 tariff), got {pb}"


def test_solution_pump_dc(s):
    payload = {
        "system_type": "solar-pump",
        "discom_id": "TANGEDCO",
        "pincode": "641001",
        "inputs": {
            "pump_path": "DC",
            "path": "DC",
            "tdh_m": 40,
            "static_head_m": 20,
            "dynamic_head_m": 15,
            "friction_loss_m": 5,
            "flow_lpm": 30,
            "flow_lpd": 20000,
            "bore_diameter_mm": 150,
            "casing_id_mm": 100,
            "category_name": "Agricultural",
            "tariff_category": "Agricultural",
        },
    }
    r = s.post(f"{BASE}/api/calculate/solution", json=payload)
    assert r.status_code == 200, r.text
    d = r.json()
    flat = str(d).lower()
    assert "tdh" in flat, f"tdh missing in {d}"
    assert "pump_hp" in flat or "pump" in flat
    assert "warnings" in flat


def test_bill_savings_endpoint(s):
    # per BillSavingsRequest: monthly_units_pre, monthly_generation, discom_id, category_name
    payload = {
        "monthly_units_pre": 500,
        "monthly_generation": 300,
        "discom_id": "TANGEDCO",
        "category_name": "Domestic",
        "net_metering": True,
    }
    r = s.post(f"{BASE}/api/calculate/bill-savings", json=payload)
    assert r.status_code == 200, r.text
    d = r.json()
    pre_d = d.get("pre_bill") or {}
    post_d = d.get("post_bill") or {}
    pre = pre_d.get("total") if isinstance(pre_d, dict) else pre_d
    post = post_d.get("total") if isinstance(post_d, dict) else post_d
    sav = d.get("monthly_saving") or d.get("monthly_saving_inr")
    assert pre is not None and post is not None and sav is not None, d
    # TN Domestic 500u pre → ~1830 (per problem statement), 200u post → ~260, saving ~1570
    assert abs(pre - 1830) < 50, f"pre={pre}, resp={d}"
    assert abs(post - 260) < 30, f"post={post}, resp={d}"
    assert abs(sav - 1570) < 60, f"sav={sav}, resp={d}"


def test_config_get_and_put(s):
    r = s.get(f"{BASE}/api/calculate/config")
    assert r.status_code == 200, r.text
    cfg = r.json()
    r2 = s.put(f"{BASE}/api/calculate/config", json=cfg)
    assert r2.status_code == 200, r2.text


def test_discoms_crud(s):
    r = s.get(f"{BASE}/api/calculate/discoms")
    assert r.status_code == 200
    lst = r.json()
    assert isinstance(lst, list)
    ids = [d.get("id") or d.get("discom_id") for d in lst]
    assert "FALLBACK" in ids

    new = {"id": "TEST_DISCOM_41", "discom_id": "TEST_DISCOM_41", "name": "Test Discom", "state": "TestState",
           "categories": [{"name": "Domestic", "slabs": [{"upto_units": 100, "rate": 5.0}], "fixed_charge_inr": 0}]}
    rc = s.post(f"{BASE}/api/calculate/discoms", json=new)
    assert rc.status_code in (200, 201), rc.text
    upd = {**new, "name": "Test Discom Updated"}
    ru = s.put(f"{BASE}/api/calculate/discoms/TEST_DISCOM_41", json=upd)
    assert ru.status_code == 200, ru.text
    rd = s.delete(f"{BASE}/api/calculate/discoms/TEST_DISCOM_41")
    assert rd.status_code in (200, 204), rd.text
    rf = s.delete(f"{BASE}/api/calculate/discoms/FALLBACK")
    assert rf.status_code >= 400, f"FALLBACK delete should fail, got {rf.status_code}"


def test_pincodes_add(s):
    r = s.get(f"{BASE}/api/calculate/pincodes")
    assert r.status_code == 200
    new_pin = {
        "pincode": "999001",
        "district": "TestDistrict",
        "state": "TestState",
        "discom_id": "FALLBACK",
        "yield_kwh_per_kwp_day": 4.5,
    }
    rc = s.post(f"{BASE}/api/calculate/pincodes", json=new_pin)
    assert rc.status_code in (200, 201, 400, 409), rc.text  # 400/409 if already exists


def test_project_persists_location_and_snapshot(s):
    proj = {
        "customer": {"name": "TEST_iter41", "phone": "9999900041", "address": "TEST addr", "email": "iter41@test.com"},
        "location": {
            "address": "Test Addr",
            "pincode": "641001",
            "district": "Coimbatore",
            "state": "Tamil Nadu",
            "discom_id": "TANGEDCO",
        },
        "electrical": {"sanction_load_kw": 5, "connected_load_kw": 5, "monthly_consumption_units": 500, "eb_tariff": 6.5},
        "solar_system": {"system_type": "on-grid"},
        "mounting": {"roof_type": "RCC", "tilt_angle": 10, "structure_type": "MMS"},
        "additional": {"cable_length_meters": 30, "inverter_to_panel_distance": 15, "installation_complexity": "simple"},
        "calculation_snapshot": {
            "system_type": "on-grid",
            "monthly_bill_inr": 3500,
            "payback_years": 5.2,
            "kwp": 3.5,
        },
    }
    rp = s.post(f"{BASE}/api/projects", json=proj)
    assert rp.status_code in (200, 201), rp.text
    pid = rp.json().get("id")
    assert pid

    rg = s.get(f"{BASE}/api/projects/{pid}")
    assert rg.status_code == 200, rg.text
    d = rg.json()
    loc = d.get("location") or {}
    assert loc.get("pincode") == "641001", f"pincode not persisted: {loc}"
    assert loc.get("district") == "Coimbatore", f"district: {loc}"
    assert loc.get("discom_id") == "TANGEDCO"
    snap = d.get("calculation_snapshot") or {}
    assert snap.get("payback_years") == 5.2, f"snapshot not persisted: {snap}"

    # Cleanup
    s.delete(f"{BASE}/api/projects/{pid}")
