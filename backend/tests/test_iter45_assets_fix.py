"""Iteration 45 — Assets register bug fix regression test.

Root cause found: the AssetsPage category filter dropdown was populated from a
hardcoded frontend list, independent of what categories actually existed on
stored asset documents. An asset saved with a category outside that hardcoded
list would show correctly in the unfiltered list but could never be found via
the category filter (no matching dropdown option existed) — matching the
reported symptom pattern. Fix: GET /assets/categories now returns the
canonical list merged with any distinct category value actually stored on an
active asset, and the frontend sources both the create-form and filter
dropdowns from this single endpoint.
"""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://solar-ops-management.preview.emergentagent.com")
ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = "Admin@123"


def _admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


class TestAssetsRegisterFix:
    def test_01_create_asset_with_novel_category(self):
        s = _admin_session()
        novel_category = "drone_iter45"
        r = s.post(f"{BASE_URL}/api/assets", json={
            "name": "TEST_ITER45 Survey Drone", "category": novel_category, "purchase_cost": 55000,
        })
        assert r.status_code == 200, r.text
        asset = r.json()
        assert asset["category"] == novel_category
        TestAssetsRegisterFix.asset_id = asset["id"]
        TestAssetsRegisterFix.novel_category = novel_category

    def test_02_asset_appears_in_unfiltered_list(self):
        s = _admin_session()
        r = s.get(f"{BASE_URL}/api/assets")
        assert r.status_code == 200
        ids = [a["id"] for a in r.json()]
        assert TestAssetsRegisterFix.asset_id in ids

    def test_03_novel_category_appears_as_filter_option(self):
        s = _admin_session()
        r = s.get(f"{BASE_URL}/api/assets/categories")
        assert r.status_code == 200, r.text
        categories = r.json()["categories"]
        assert TestAssetsRegisterFix.novel_category in categories
        # canonical categories must still be present (union, not replacement)
        assert "power_tool" in categories

    def test_04_filtering_by_novel_category_returns_the_asset(self):
        s = _admin_session()
        r = s.get(f"{BASE_URL}/api/assets", params={"category": TestAssetsRegisterFix.novel_category})
        assert r.status_code == 200
        ids = [a["id"] for a in r.json()]
        assert TestAssetsRegisterFix.asset_id in ids
        assert len(r.json()) == 1  # only this asset carries this category

    def test_05_cleanup_archive_test_asset(self):
        s = _admin_session()
        r = s.delete(f"{BASE_URL}/api/assets/{TestAssetsRegisterFix.asset_id}")
        assert r.status_code == 200
