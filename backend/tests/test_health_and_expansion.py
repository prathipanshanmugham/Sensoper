"""Unit tests for the Company Health Score and Expansion module aggregators."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from health import compute_pillars, DEFAULT_HEALTH_CONFIG
from expansion import compute_district_scores, simulate_breakeven, DEFAULT_EXPANSION_CONFIG


def _mk_project(district="Coimbatore", state="Tamil Nadu", status="completed",
                cost=300000, margin=60000, created="2026-01-15T00:00:00", created_by_name="Ravi"):
    return {
        "location": {"district": district, "state": state},
        "status": status,
        "cost_estimation": {"total_cost": cost, "margin_total": margin},
        "created_at": created, "created_by_name": created_by_name,
        "customer": {"name": f"Cust {district}"}, "id": f"p-{district}-{created[:10]}",
    }


# ═══════════ HEALTH ═══════════

def test_health_returns_5_pillars():
    projects = [_mk_project() for _ in range(5)]
    result = compute_pillars(projects, credits=[], inv_items=[], approvals=[], health_cfg=DEFAULT_HEALTH_CONFIG)
    assert set(result["pillars"].keys()) == {"sales_growth", "profitability", "cash_collections", "operations", "team_compliance"}
    assert 0 <= result["score"] <= 100
    assert result["band"] in ("strong", "healthy", "attention", "critical")


def test_health_composite_matches_weighted_sum():
    projects = [_mk_project()]
    r = compute_pillars(projects, credits=[], inv_items=[], approvals=[], health_cfg=DEFAULT_HEALTH_CONFIG)
    weighted = sum(p["score"] * p["weight"] for p in r["pillars"].values())
    total_w = sum(p["weight"] for p in r["pillars"].values())
    expected = round(weighted / total_w, 1)
    assert abs(r["score"] - expected) < 0.5


def test_health_dragging_lists_lowest_metrics():
    projects = []  # No projects → most scores 0
    r = compute_pillars(projects, credits=[], inv_items=[], approvals=[], health_cfg=DEFAULT_HEALTH_CONFIG)
    assert len(r["dragging"]) == 3
    # All dragging should be very low
    assert all(d["score"] <= 20 for d in r["dragging"])


def test_health_high_overdue_lowers_cash_score():
    projects = [_mk_project(cost=1000000, margin=200000, status="completed")]
    heavy_overdue = [{"balance": 800000, "status": "overdue", "created_at": "2025-11-01T00:00:00"}]
    r_ok = compute_pillars(projects, credits=[], inv_items=[], approvals=[], health_cfg=DEFAULT_HEALTH_CONFIG)
    r_bad = compute_pillars(projects, credits=heavy_overdue, inv_items=[], approvals=[], health_cfg=DEFAULT_HEALTH_CONFIG)
    assert r_bad["pillars"]["cash_collections"]["score"] < r_ok["pillars"]["cash_collections"]["score"]


# ═══════════ EXPANSION ═══════════

def test_expansion_returns_district_scores():
    projects = [_mk_project() for _ in range(12)] + [_mk_project(district="Chennai") for _ in range(5)]
    r = compute_district_scores(projects, credits=[], brand_returns=[], branches=[], config=DEFAULT_EXPANSION_CONFIG)
    districts = {d["district"]: d for d in r["districts"]}
    assert "Coimbatore" in districts and "Chennai" in districts
    assert districts["Coimbatore"]["confidence_low"] is False   # 12 >= 10
    assert districts["Chennai"]["confidence_low"] is True       # 5 < 10


def test_expansion_score_within_0_to_100():
    projects = [_mk_project() for _ in range(15)]
    r = compute_district_scores(projects, credits=[], brand_returns=[], branches=[], config=DEFAULT_EXPANSION_CONFIG)
    for d in r["districts"]:
        assert 0 <= d["score"] <= 100


def test_expansion_travel_score_when_branch_nearby():
    projects = [_mk_project() for _ in range(12)]
    # Ensure at least one project has lat/lon so travel-cost can compute
    projects[0]["location"] = {"district": "Coimbatore", "state": "Tamil Nadu", "latitude": 11.017, "longitude": 76.958}
    r_no_branch = compute_district_scores(projects, credits=[], brand_returns=[], branches=[], config=DEFAULT_EXPANSION_CONFIG)
    branches = [{"name": "CBE Branch", "latitude": 11.017, "longitude": 76.958}]
    r_with = compute_district_scores(projects, credits=[], brand_returns=[], branches=branches, config=DEFAULT_EXPANSION_CONFIG)
    # Same district should score at least as high for travel with a nearby branch (0 km)
    d0 = next(d for d in r_no_branch["districts"] if d["district"] == "Coimbatore")
    d1 = next(d for d in r_with["districts"] if d["district"] == "Coimbatore")
    travel0 = next(c["score"] for c in d0["components"] if c["name"] == "Travel Cost Drag")
    travel1 = next(c["score"] for c in d1["components"] if c["name"] == "Travel Cost Drag")
    assert travel1 >= travel0


def test_breakeven_gap_is_negative_when_run_rate_high():
    """If current run-rate covers branch cost, gap must be ≤ 0."""
    r = simulate_breakeven(
        monthly_run_rate=2000000, target_margin_pct=20,
        monthly_branch_cost=250000, setup_capex=1500000,
        current_monthly_projects=8, current_avg_ticket=300000,
    )
    assert r["gap_projects_per_month"] <= 0
    assert r["months_to_breakeven"] is not None
    assert r["months_to_breakeven"] > 0


def test_breakeven_no_viability_when_run_rate_low():
    r = simulate_breakeven(
        monthly_run_rate=200000, target_margin_pct=20,
        monthly_branch_cost=250000, setup_capex=1500000,
        current_monthly_projects=1, current_avg_ticket=300000,
    )
    # Margin is 40k but branch costs 250k → surplus negative → no month
    assert r["months_to_breakeven"] is None
    assert r["gap_projects_per_month"] > 0
