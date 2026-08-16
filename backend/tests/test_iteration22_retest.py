"""Iteration 22 — Retest of 2 action items from iteration_21:
1. Frontend stale-closure is tested via Playwright (separate).
2. Backend: GET /api/reports/inventory_material?tab=movement&movement_type=slow
   must keep summary.fast_moving reflecting UNFILTERED totals and
   rows must only contain Slow items.
"""
import os
import pytest
import requests
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def any_project_id(session):
    r = session.get(f"{BASE_URL}/api/projects", timeout=30)
    assert r.status_code == 200
    projects = r.json()
    assert len(projects) > 0, "No projects exist"
    return projects[0].get("id") or projects[0].get("_id")


@pytest.fixture(scope="module")
def seeded_fast_item(session, any_project_id):
    """Ensure at least one Fast-moving item exists (>=5 usage logs in last 30 days)."""
    item_payload = {
        "name": "TEST_RETEST_FAST_ITEM",
        "sku_code": "TEST-RETEST-F1",
        "category": "Panels",
        "quantity": 50,
        "unit_price": 200.0,
        "procurement_date": "2025-12-10",
        "active": True,
    }
    r = session.post(f"{BASE_URL}/api/inventory/items", json=item_payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    item_id = r.json().get("id") or r.json().get("_id")
    for i in range(5):
        payload = {
            "project_id": any_project_id,
            "item_name": "TEST_RETEST_FAST_ITEM",
            "estimated_qty": 2.0,
            "actual_qty": 2.0,
            "wastage": 0.0,
            "notes": f"TEST_RETEST log #{i+1}",
        }
        r = session.post(f"{BASE_URL}/api/material-usage", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
    yield item_id
    # Cleanup inventory item only (logs persisted intentionally)
    session.delete(f"{BASE_URL}/api/inventory/items/{item_id}", timeout=30)


# --- Action Item #2: Summary counters must reflect UNFILTERED totals ---
def test_summary_unfiltered_when_filter_slow(session, seeded_fast_item):
    r = session.get(
        f"{BASE_URL}/api/reports/inventory_material",
        params={"tab": "movement", "movement_type": "slow"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    summary = data["summary"]
    rows = data["rows"]

    # UNFILTERED summary: fast_moving must still include our seeded Fast item
    assert summary["fast_moving"] >= 1, (
        f"Expected summary.fast_moving >= 1 while filter=slow, got {summary}"
    )
    assert summary["slow_moving"] >= 0
    assert "window_days" in summary and summary["window_days"] >= 1
    assert "total_items" in summary

    # Displayed rows must contain ONLY Slow items
    for row in rows:
        if row.get("product") == "No items":
            continue
        assert row["movement_type"] == "Slow", f"Non-slow row leaked when filter=slow: {row}"

    # Seeded Fast item should NOT appear in filtered rows
    product_names = [r.get("product") for r in rows]
    assert "TEST_RETEST_FAST_ITEM" not in product_names, (
        f"Fast item leaked into filter=slow rows: {product_names}"
    )


def test_summary_unfiltered_when_filter_fast(session, seeded_fast_item):
    r = session.get(
        f"{BASE_URL}/api/reports/inventory_material",
        params={"tab": "movement", "movement_type": "fast"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    summary = data["summary"]
    rows = data["rows"]

    # UNFILTERED summary — slow_moving must still be >= 1 (there are slow items)
    assert summary["slow_moving"] >= 1, (
        f"Expected summary.slow_moving >= 1 while filter=fast, got {summary}"
    )
    assert summary["fast_moving"] >= 1

    for row in rows:
        if row.get("product") == "No items":
            continue
        assert row["movement_type"] == "Fast", f"Non-fast row leaked when filter=fast: {row}"


def test_summary_no_filter_all(session, seeded_fast_item):
    """Baseline: no movement_type filter → same summary numbers."""
    r = session.get(
        f"{BASE_URL}/api/reports/inventory_material",
        params={"tab": "movement"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    summary = r.json()["summary"]
    assert summary["fast_moving"] >= 1
    assert summary["slow_moving"] >= 1


def test_summary_consistent_across_filters(session, seeded_fast_item):
    """fast_moving/slow_moving totals in summary must be IDENTICAL regardless of filter."""
    results = {}
    for mt in (None, "all", "fast", "slow"):
        params = {"tab": "movement"}
        if mt:
            params["movement_type"] = mt
        r = session.get(
            f"{BASE_URL}/api/reports/inventory_material",
            params=params,
            timeout=30,
        )
        assert r.status_code == 200
        s = r.json()["summary"]
        results[mt or "none"] = (s["fast_moving"], s["slow_moving"], s["total_items"])

    # All 4 should be equal
    distinct = set(results.values())
    assert len(distinct) == 1, f"Summary varies across filters: {results}"