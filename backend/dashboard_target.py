"""Iter 50 — Monthly Target panel (main dashboard) + Top Performing Locations (consolidated CEO report).

Both reuse the CEO Dashboard / Health Score definitions so every screen agrees:
  * target   = health_config.targets.monthly_revenue_target, overridable per location via
               health_config.location_targets[location_id]
  * achieved = project revenue for approved/completed projects created this month
               (identical to `monthly_revenue[month_key]` in /dashboard/ceo and health.py)
"""
from __future__ import annotations
import calendar
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

WON = ("approved", "completed")


def _project_revenue(p: Dict[str, Any]) -> float:
    return p.get("cost_estimation", {}).get("total_cost", 0) or 0


def _project_margin(p: Dict[str, Any]) -> float:
    return p.get("cost_estimation", {}).get("margin_total", 0) or 0


def resolve_target(health_cfg: Dict[str, Any], location_id: Optional[str]) -> Dict[str, Any]:
    company = float((health_cfg.get("targets") or {}).get("monthly_revenue_target") or 0)
    loc_targets = health_cfg.get("location_targets") or {}
    if location_id and loc_targets.get(location_id) not in (None, "", 0):
        return {"target": float(loc_targets[location_id]), "source": "location"}
    return {"target": company, "source": "company"}


def compute_monthly_target(projects: List[Dict[str, Any]], health_cfg: Dict[str, Any], location_id: Optional[str],
                           now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    month_key = now.strftime("%Y-%m")
    prev_key = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    day = now.day
    days_remaining = days_in_month - day

    achieved = won_count = 0.0
    prev_achieved = 0.0
    for p in projects:
        if p.get("status") not in WON:
            continue
        created = (p.get("created_at") or "")[:7]
        if created == month_key:
            achieved += _project_revenue(p)
            won_count += 1
        elif created == prev_key:
            prev_achieved += _project_revenue(p)

    t = resolve_target(health_cfg, location_id)
    target = t["target"]
    remaining = max(target - achieved, 0.0)
    daily_rate = achieved / day if day else 0.0
    projected = daily_rate * days_in_month
    required_daily = (remaining / days_remaining) if days_remaining > 0 else remaining
    pct = round((achieved / target) * 100, 1) if target > 0 else None
    if target <= 0:
        pace = "no_target"
    elif achieved >= target:
        pace = "achieved"
    elif projected >= target:
        pace = "on_track"
    elif projected >= target * 0.85:
        pace = "at_risk"
    else:
        pace = "behind"
    return {
        "month": month_key, "day": day, "days_in_month": days_in_month, "days_remaining": days_remaining,
        "target": round(target), "target_source": t["source"], "location_id": location_id,
        "achieved": round(achieved), "won_count": int(won_count), "remaining": round(remaining), "pct": pct,
        "daily_rate": round(daily_rate), "projected": round(projected), "required_daily": round(required_daily),
        "pace": pace, "previous_month_achieved": round(prev_achieved),
    }


def compute_top_locations(projects: List[Dict[str, Any]], locations: List[Dict[str, Any]],
                          now: Optional[datetime] = None, limit: int = 5) -> List[Dict[str, Any]]:
    """Ranked by all-time won revenue (same basis as the headline Total Revenue KPI) with
    month-over-month movement on current-month won revenue. Legacy projects without a
    location_id are excluded — they cannot be attributed to a branch."""
    now = now or datetime.now(timezone.utc)
    month_key = now.strftime("%Y-%m")
    prev_key = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    names = {str(l["_id"]): l.get("name") for l in locations}
    agg: Dict[str, Dict[str, float]] = defaultdict(lambda: {"revenue": 0.0, "margin": 0.0, "projects": 0, "wins": 0, "this_month": 0.0, "last_month": 0.0})
    for p in projects:
        lid = p.get("location_id")
        if not lid or lid not in names:
            continue
        a = agg[lid]
        a["projects"] += 1
        if p.get("status") in WON:
            a["wins"] += 1
            rev = _project_revenue(p)
            a["revenue"] += rev
            a["margin"] += _project_margin(p)
            created = (p.get("created_at") or "")[:7]
            if created == month_key:
                a["this_month"] += rev
            elif created == prev_key:
                a["last_month"] += rev
    rows = []
    for lid, a in agg.items():
        mom = None
        if a["last_month"] > 0:
            mom = round(((a["this_month"] - a["last_month"]) / a["last_month"]) * 100, 1)
        elif a["this_month"] > 0:
            mom = 100.0
        rows.append({
            "location_id": lid, "name": names[lid], "revenue": round(a["revenue"]), "margin": round(a["margin"]),
            "margin_pct": round((a["margin"] / a["revenue"]) * 100, 1) if a["revenue"] else 0.0,
            "projects": int(a["projects"]), "wins": int(a["wins"]),
            "this_month": round(a["this_month"]), "last_month": round(a["last_month"]), "mom_pct": mom,
        })
    rows.sort(key=lambda r: (r["revenue"], r["this_month"]), reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows[:limit]
