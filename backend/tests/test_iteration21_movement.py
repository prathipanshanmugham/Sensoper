"""Iteration 21 — Inventory refinement: image_url, procurement_date, movement report tab.

Tests:
1. Auth works
2. POST/PUT/GET inventory items include procurement_date and image_url round-trip
3. /api/reports/inventory_material returns 'movement' tab with expected row shape
4. Seeds 5 material_usage_logs (last 30 days) for a single item and confirms it classifies as 'Fast'
5. movement_type query filter (fast/slow/all)
6. Regression: stock_levels, material_usage, alerts tabs still return
"""
import os
import pytest
import requests
from datetime import datetime, timezone
import os
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    s.headers.update({"Content-Type": "application/json"})
    return s


# Backward-compat alias used in existing tests
@pytest.fixture(scope="module")
def headers(session):
    return session


@pytest.fixture(scope="module")
def token(session):
    # sentinel: any non-empty cookie means logged in
    cookies = session.cookies.get_dict()
    return "cookie:" + ",".join(cookies.keys()) if cookies else "session"


@pytest.fixture(scope="module")
def any_project_id(session):
    r = session.get(f"{BASE_URL}/api/projects", timeout=30)
    assert r.status_code == 200
    projects = r.json()
    assert len(projects) > 0, "No projects exist to attach material_usage_log"
    return projects[0].get("id") or projects[0].get("_id")


# --- 1. Auth ---
def test_login_ok(token):
    assert isinstance(token, str) and len(token) > 10


# --- 2. Inventory model supports procurement_date + image_url ---
def test_create_update_get_inventory_procurement(headers):
    payload = {
        "name": "TEST_MOVE_ITEM_A",
        "sku_code": "TEST-MOV-A",
        "category": "Panels",
        "quantity": 10,
        "unit_price": 100.0,
        "image_url": "https://example.com/panel.jpg",
        "procurement_date": "2025-12-01",
        "active": True,
    }
    r = headers.post(f"{BASE_URL}/api/inventory/items", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    created = r.json()
    item_id = created.get("id") or created.get("_id")
    assert item_id

    # GET list and confirm procurement_date + image_url present
    r = headers.get(f"{BASE_URL}/api/inventory/items", timeout=30)
    assert r.status_code == 200
    items = r.json()
    ours = [i for i in items if (i.get("id") or i.get("_id")) == item_id]
    assert ours, "Newly created item not found in list"
    it = ours[0]
    assert it.get("procurement_date") == "2025-12-01"
    assert it.get("image_url") == "https://example.com/panel.jpg"

    # PUT to update procurement_date
    upd = {"procurement_date": "2026-01-15"}
    r = headers.put(f"{BASE_URL}/api/inventory/items/{item_id}", json=upd, timeout=30)
    assert r.status_code == 200, r.text

    r = headers.get(f"{BASE_URL}/api/inventory/items", timeout=30)
    ours = [i for i in r.json() if (i.get("id") or i.get("_id")) == item_id]
    assert ours[0].get("procurement_date") == "2026-01-15"

    # cleanup
    headers.delete(f"{BASE_URL}/api/inventory/items/{item_id}", timeout=30)


# --- 3. Movement tab baseline shape ---
def test_movement_tab_structure(headers):
    r = headers.get(
        f"{BASE_URL}/api/reports/inventory_material",
        params={"tab": "movement"}, timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "tabs" in data and "movement" in data["tabs"]
    assert {"total_items", "fast_moving", "slow_moving", "window_days"} <= set(data["summary"].keys())
    assert isinstance(data["rows"], list)
    if data["rows"] and data["rows"][0].get("product") != "No items":
        keys = set(data["rows"][0].keys())
        assert {"product", "sku", "status", "procurement_date",
                "last_used_date", "usage_count", "qty_used", "movement_type"} <= keys


# --- 4. Seed 5 usage logs + verify FAST ---
def test_fast_classification_after_seeding(headers, any_project_id):
    # Create dedicated inventory item
    item_payload = {
        "name": "TEST_MOVE_FAST_ITEM",
        "sku_code": "TEST-FAST-1",
        "category": "Panels",
        "quantity": 50,
        "unit_price": 200.0,
        "procurement_date": "2025-12-10",
        "active": True,
    }
    r = headers.post(f"{BASE_URL}/api/inventory/items", json=item_payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    item_id = r.json().get("id") or r.json().get("_id")

    # Seed 5 material usage logs with matching item_name
    for i in range(5):
        payload = {
            "project_id": any_project_id,
            "item_name": "TEST_MOVE_FAST_ITEM",
            "estimated_qty": 2.0,
            "actual_qty": 2.0,
            "wastage": 0.0,
            "notes": f"TEST_SEED log #{i+1}",
        }
        r = headers.post(f"{BASE_URL}/api/material-usage", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text

    # Re-fetch movement report — TEST_MOVE_FAST_ITEM must be Fast with usage_count=5
    r = headers.get(
        f"{BASE_URL}/api/reports/inventory_material",
        params={"tab": "movement"}, timeout=30,
    )
    assert r.status_code == 200
    data = r.json()
    rows = data["rows"]
    ours = [x for x in rows if x.get("product") == "TEST_MOVE_FAST_ITEM"]
    assert ours, f"Seeded item missing from movement rows. Got: {[r.get('product') for r in rows]}"
    row = ours[0]
    assert row["movement_type"] == "Fast", f"Expected Fast, got {row}"
    assert row["usage_count"] == 5, f"Expected 5 usages, got {row['usage_count']}"
    assert row["qty_used"] == 10.0
    assert data["summary"]["fast_moving"] >= 1

    # movement_type=fast filter
    r = headers.get(
        f"{BASE_URL}/api/reports/inventory_material",
        params={"tab": "movement", "movement_type": "fast"}, timeout=30,
    )
    assert r.status_code == 200
    fast_rows = r.json()["rows"]
    assert all(x["movement_type"] == "Fast" for x in fast_rows if x.get("product") != "No items"), fast_rows

    # movement_type=slow filter
    r = headers.get(
        f"{BASE_URL}/api/reports/inventory_material",
        params={"tab": "movement", "movement_type": "slow"}, timeout=30,
    )
    assert r.status_code == 200
    slow_rows = r.json()["rows"]
    assert all(x["movement_type"] == "Slow" for x in slow_rows if x.get("product") != "No items"), slow_rows

    # cleanup the inventory item (logs will stay - that's fine for regression)
    headers.delete(f"{BASE_URL}/api/inventory/items/{item_id}", timeout=30)


# --- 5. Regression: other 3 tabs still work ---
@pytest.mark.parametrize("tab", ["stock_levels", "material_usage", "alerts"])
def test_other_inventory_tabs(headers, tab):
    r = headers.get(
        f"{BASE_URL}/api/reports/inventory_material",
        params={"tab": tab}, timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "rows" in data
    assert "tabs" in data and tab in data["tabs"]