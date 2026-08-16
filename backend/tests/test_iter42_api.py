"""Iteration 42 API tests: Health Score + Expansion module."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://solar-ops-management.preview.emergentagent.com").rstrip("/")
ADMIN = {"email": "admin@sensoper.com", "password": "Admin@123"}


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return s


# --- Phase B: Health Score ---
def test_ceo_dashboard_has_health_score(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/dashboard/ceo", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "health_score" in data, f"missing health_score. keys={list(data.keys())}"
    hs = data["health_score"]
    for k in ["pillars", "score", "band", "verdict", "dragging", "weakest_pillar", "computed_at"]:
        assert k in hs, f"missing key: {k}"
    assert len(hs["pillars"]) == 5
    assert 0 <= hs["score"] <= 100
    assert len(hs["dragging"]) <= 3


def test_health_config_get_and_put(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/dashboard/health/config", timeout=15)
    assert r.status_code == 200
    cfg = r.json()
    assert "weights" in cfg
    assert "targets" in cfg
    assert "bands" in cfg
    # PUT unchanged
    r2 = admin_client.put(f"{BASE_URL}/api/dashboard/health/config", json=cfg, timeout=15)
    assert r2.status_code == 200, r2.text


def test_health_snapshot_idempotent(admin_client):
    r1 = admin_client.post(f"{BASE_URL}/api/dashboard/health/snapshot", json={}, timeout=30)
    assert r1.status_code in (200, 201), r1.text
    m1 = r1.json().get("month") or r1.json().get("month_key")
    r2 = admin_client.post(f"{BASE_URL}/api/dashboard/health/snapshot", json={}, timeout=30)
    assert r2.status_code in (200, 201)
    m2 = r2.json().get("month") or r2.json().get("month_key")
    assert m1 == m2


def test_health_history(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/dashboard/health/history?months=6", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # accept list or {items:[]}
    items = data if isinstance(data, list) else data.get("items", data.get("snapshots", []))
    assert isinstance(items, list)


# --- Phase C: Expansion ---
def test_expansion_overview(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/expansion/overview", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ["districts", "totals", "company_avg_margin_pct", "generated_at", "min_projects_for_score"]:
        assert k in data, f"missing {k}"
    ds = data["districts"]
    assert isinstance(ds, list)
    if ds:
        # sorted desc
        scores = [d["score"] for d in ds]
        assert scores == sorted(scores, reverse=True)
        d0 = ds[0]
        for k in ["score", "band", "verdict", "confidence_low", "sample_size", "metrics", "components"]:
            assert k in d0, f"district missing {k}"
        assert len(d0["components"]) == 8


def test_expansion_overview_state_filter(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/expansion/overview?state=Tamil%20Nadu", timeout=30)
    assert r.status_code == 200


def test_expansion_simulate(admin_client):
    payload = {"district": "Coimbatore", "target_revenue": 5000000, "months": 12}
    r = admin_client.post(f"{BASE_URL}/api/expansion/simulate", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # accept any of these keys
    keys = set(data.keys())
    assert keys & {"projects_per_month_needed", "revenue_per_month_needed", "gap", "months_to_breakeven"}, f"keys={keys}"


def test_expansion_config_get_put(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/expansion/config", timeout=15)
    assert r.status_code == 200
    cfg = r.json()
    assert "weights" in cfg
    r2 = admin_client.put(f"{BASE_URL}/api/expansion/config", json=cfg, timeout=15)
    assert r2.status_code == 200


def test_expansion_branches_crud(admin_client):
    payload = {"name": "TEST_Branch_iter42", "district": "Coimbatore", "state": "Tamil Nadu",
               "latitude": 11.0, "longitude": 77.0}
    r = admin_client.post(f"{BASE_URL}/api/expansion/branches", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    b = r.json()
    bid = b.get("id") or b.get("_id")
    assert bid
    # GET
    r2 = admin_client.get(f"{BASE_URL}/api/expansion/branches", timeout=15)
    assert r2.status_code == 200
    items = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
    assert any((x.get("id") or x.get("_id")) == bid for x in items)
    # PUT
    r3 = admin_client.put(f"{BASE_URL}/api/expansion/branches/{bid}", json={"name": "TEST_Branch_iter42_upd"}, timeout=15)
    assert r3.status_code == 200, r3.text
    # DELETE
    r4 = admin_client.delete(f"{BASE_URL}/api/expansion/branches/{bid}", timeout=15)
    assert r4.status_code in (200, 204), r4.text


def test_staff_forbidden_on_expansion():
    # try login as staff if we can — otherwise skip
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "staff@sensoper.com", "password": "Staff@123"}, timeout=15)
    if r.status_code != 200:
        pytest.skip("no staff account available")
    s = requests.Session()
    s.post(f"{BASE_URL}/api/auth/login", json={"email": "staff@sensoper.com", "password": "Staff@123"}, timeout=15)
    r2 = s.get(f"{BASE_URL}/api/expansion/overview", timeout=15)
    assert r2.status_code == 403
