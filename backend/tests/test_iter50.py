"""Iter 50 — (§2) Assets filter regression, (§1) Monthly Target, (§3) Top Locations, (§4) Report Usage removed."""
import os
import uuid
from datetime import datetime, timezone
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST50_{uuid.uuid4().hex[:5]}"


def _env(key):
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get(key)


def dbc():
    return MongoClient(_env("MONGO_URL"))[_env("DB_NAME")]


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": "Admin@123"}, timeout=60)
    assert r.status_code == 200, r.text
    return s


# ─────────────────────────── §2 Assets & Tools filters ───────────────────────────
SEED = [  # (category, status) — 3 distinct categories × 3 distinct statuses, incl. a non-canonical category
    (f"{TAG}_drone_kit", "available"),
    ("vehicle", "issued"),
    ("test_equipment", "under_repair"),
]


@pytest.fixture(scope="module")
def seeded_assets(client):
    db = dbc()
    ids = []
    for cat, status in SEED:
        r = client.post(f"{API}/assets", json={"name": f"{TAG} {cat} {status}", "category": cat, "purchase_cost": 1000}, timeout=60)
        assert r.status_code == 200, r.text
        aid = r.json()["id"]
        ids.append(aid)
        if status != "available":
            from bson import ObjectId
            db.assets.update_one({"_id": ObjectId(aid)}, {"$set": {"status": status}})
    yield ids
    from bson import ObjectId
    db.assets.delete_many({"_id": {"$in": [ObjectId(i) for i in ids]}})


class TestAssetFilters:
    def test_filter_options_include_every_seeded_category_and_status(self, client, seeded_assets):
        f = client.get(f"{API}/assets/filters", timeout=60).json()
        for cat, status in SEED:
            assert cat in f["categories"], f"category {cat} missing from filter options"
            assert status in f["statuses"], f"status {status} missing from filter options"
        # canonical values always present even if no asset uses them yet
        assert {"available", "issued", "lost", "scrapped"} <= set(f["statuses"])
        assert {"vehicle", "power_tool", "other"} <= set(f["categories"])

    def test_all_categories_returns_complete_set(self, client, seeded_assets):
        everything = {a["id"] for a in client.get(f"{API}/assets", timeout=60).json()}
        via_all = {a["id"] for a in client.get(f"{API}/assets", params={"category": "all"}, timeout=60).json()}
        assert set(seeded_assets) <= everything
        assert via_all == everything

    def test_all_status_returns_complete_set(self, client, seeded_assets):
        everything = {a["id"] for a in client.get(f"{API}/assets", timeout=60).json()}
        via_all = {a["id"] for a in client.get(f"{API}/assets", params={"status": "all", "category": "all"}, timeout=60).json()}
        assert via_all == everything
        assert set(seeded_assets) <= via_all

    def test_specific_category_narrows(self, client, seeded_assets):
        cat = SEED[0][0]
        rows = client.get(f"{API}/assets", params={"category": cat}, timeout=60).json()
        assert rows and all(a["category"] == cat for a in rows)
        assert seeded_assets[0] in {a["id"] for a in rows}
        assert seeded_assets[1] not in {a["id"] for a in rows}

    def test_specific_status_narrows(self, client, seeded_assets):
        rows = client.get(f"{API}/assets", params={"status": "under_repair"}, timeout=60).json()
        assert rows and all(a["status"] == "under_repair" for a in rows)
        assert seeded_assets[2] in {a["id"] for a in rows}
        assert seeded_assets[0] not in {a["id"] for a in rows}

    def test_category_and_status_combined(self, client, seeded_assets):
        rows = client.get(f"{API}/assets", params={"category": "vehicle", "status": "issued"}, timeout=60).json()
        assert seeded_assets[1] in {a["id"] for a in rows}
        assert all(a["category"] == "vehicle" and a["status"] == "issued" for a in rows)

    def test_filter_values_match_list_values_exactly(self, client, seeded_assets):
        """Every category/status shown in the list must be selectable in the dropdown, same casing."""
        f = client.get(f"{API}/assets/filters", timeout=60).json()
        for a in client.get(f"{API}/assets", timeout=60).json():
            if a.get("category"):
                assert a["category"] in f["categories"], a["category"]
            if a.get("status"):
                assert a["status"] in f["statuses"], a["status"]


# ─────────────────────────── §1 Monthly Target ───────────────────────────
class TestMonthlyTarget:
    def test_shape_and_math(self, client):
        d = client.get(f"{API}/dashboard/monthly-target", timeout=60).json()
        for k in ("target", "achieved", "remaining", "pct", "pace", "projected", "daily_rate", "days_remaining", "days_in_month", "day", "target_source"):
            assert k in d, k
        assert d["remaining"] == max(d["target"] - d["achieved"], 0)
        assert d["month"] == datetime.now(timezone.utc).strftime("%Y-%m")
        assert d["pace"] in ("achieved", "on_track", "at_risk", "behind", "no_target")
        if d["target"] > 0:
            assert d["pct"] == round(d["achieved"] / d["target"] * 100, 1)

    def test_target_is_the_health_score_target(self, client):
        cfg = client.get(f"{API}/dashboard/health/config", timeout=60).json()
        d = client.get(f"{API}/dashboard/monthly-target", timeout=60).json()
        assert d["target"] == round(cfg["targets"]["monthly_revenue_target"])
        assert d["target_source"] == "company"

    def test_achieved_matches_ceo_current_month_revenue(self, client):
        ceo = client.get(f"{API}/dashboard/ceo", timeout=60).json()
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        ceo_month = next((r["revenue"] for r in ceo["revenue_trend"] if r["month"] == month), 0)
        d = client.get(f"{API}/dashboard/monthly-target", timeout=60).json()
        assert d["achieved"] == ceo_month

    def test_location_target_override_and_fallback(self, client):
        loc = client.post(f"{API}/locations", json={"name": f"{TAG}_Loc", "type": "branch"}, timeout=60).json()
        cfg = client.get(f"{API}/dashboard/health/config", timeout=60).json()
        try:
            # no override → falls back to company target
            d = client.get(f"{API}/dashboard/monthly-target", params={"location_id": loc["id"]}, timeout=60).json()
            assert d["target_source"] == "company" and d["location_name"] == f"{TAG}_Loc"
            # set override
            lt = dict(cfg.get("location_targets") or {}); lt[loc["id"]] = 777000
            client.put(f"{API}/dashboard/health/config", json={**cfg, "location_targets": lt}, timeout=60)
            d = client.get(f"{API}/dashboard/monthly-target", params={"location_id": loc["id"]}, timeout=60).json()
            assert d["target"] == 777000 and d["target_source"] == "location"
            # company-wide still uses the company number
            d2 = client.get(f"{API}/dashboard/monthly-target", timeout=60).json()
            assert d2["target"] == round(cfg["targets"]["monthly_revenue_target"])
        finally:
            client.put(f"{API}/dashboard/health/config", json=cfg, timeout=60)
            client.delete(f"{API}/locations/{loc['id']}", timeout=60)

    def test_staff_can_read(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": "staff@sensoper.com", "password": "Staff@123"}, timeout=60)
        if r.status_code != 200:
            pytest.skip("no staff account")
        assert s.get(f"{API}/dashboard/monthly-target", timeout=60).status_code == 200


# ─────────────────────────── §3 Top Performing Locations ───────────────────────────
class TestTopLocations:
    def test_consolidated_has_ranking_single_location_does_not(self, client):
        cons = client.get(f"{API}/dashboard/ceo", timeout=60).json()
        assert cons["consolidated"] is True and isinstance(cons["top_locations"], list)
        locs = client.get(f"{API}/locations", timeout=60).json()
        if not locs:
            pytest.skip("no locations")
        single = client.get(f"{API}/dashboard/ceo", params={"location_id": locs[0]["id"]}, timeout=60).json()
        assert single["consolidated"] is False and single["top_locations"] is None

    def test_ranking_math(self, client):
        from bson import ObjectId
        db = dbc()
        loc = client.post(f"{API}/locations", json={"name": f"{TAG}_Rank", "type": "branch"}, timeout=60).json()
        now = datetime.now(timezone.utc).isoformat()
        docs = [
            {"status": "completed", "location_id": loc["id"], "created_at": now, "cost_estimation": {"total_cost": 500000, "margin_total": 100000}, "customer": {"name": TAG}, "created_by": "t"},
            {"status": "approved", "location_id": loc["id"], "created_at": now, "cost_estimation": {"total_cost": 300000, "margin_total": 30000}, "customer": {"name": TAG}, "created_by": "t"},
            {"status": "draft", "location_id": loc["id"], "created_at": now, "cost_estimation": {"total_cost": 999999, "margin_total": 1}, "customer": {"name": TAG}, "created_by": "t"},
        ]
        ins = db.projects.insert_many(docs).inserted_ids
        try:
            cons = client.get(f"{API}/dashboard/ceo", timeout=60).json()
            row = next(r for r in cons["top_locations"] if r["location_id"] == loc["id"])
            assert row["revenue"] == 800000 and row["margin"] == 130000 and row["wins"] == 2 and row["projects"] == 3
            assert row["margin_pct"] == round(130000 / 800000 * 100, 1)
            assert row["this_month"] == 800000 and row["mom_pct"] == 100.0
            assert row["rank"] == 1  # ₹8L beats every other test location
            ranks = [r["rank"] for r in cons["top_locations"]]
            assert ranks == sorted(ranks) and len(ranks) <= 5
        finally:
            db.projects.delete_many({"_id": {"$in": ins}})
            client.delete(f"{API}/locations/{loc['id']}", timeout=60)


# ─────────────────────────── §4 Report Usage removed ───────────────────────────
class TestReportUsageRemoved:
    def test_routes_gone(self, client):
        assert client.get(f"{API}/reports/report_usage", timeout=60).status_code in (400, 404)
        assert client.post(f"{API}/reports/usage", json={"report_type": "x", "format": "pdf"}, timeout=60).status_code in (404, 405)

    def test_no_logging_on_report_view(self, client):
        db = dbc()
        client.get(f"{API}/reports/brand_returns", timeout=60)
        assert "report_usage" not in db.list_collection_names()
