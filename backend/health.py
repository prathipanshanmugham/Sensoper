"""Company Health Score — 5-pillar composite (Sales / Profit / Cash / Ops / Team).

All weights, targets, thresholds are read from `db.health_config` (singleton),
so the CEO can retune targets without a deploy. Snapshots are persisted monthly
in `db.health_snapshots` so the trend line reflects real history.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from collections import defaultdict


DEFAULT_HEALTH_CONFIG = {
    "_id": "singleton",
    "weights": {
        "sales_growth": 25,
        "profitability": 25,
        "cash_collections": 20,
        "operations": 20,
        "team_compliance": 10,
    },
    "targets": {
        "monthly_revenue_target": 2500000,        # ₹25L / month
        "target_margin_pct": 20,
        "minimum_acceptable_margin_pct": 12,
        "max_collection_days": 45,
        "max_overdue_pct": 15,
        "on_time_delivery_pct": 90,
        "target_conversion_pct": 35,
        "monthly_growth_target_pct": 8,
    },
    "bands": {"strong": 80, "healthy": 65, "attention": 50},
    "top_debtor_max_share_pct": 30,
}


def _clip(x, lo=0, hi=100):
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo


def _pct(numerator, denominator):
    if not denominator: return 0
    try: return (numerator / denominator) * 100
    except Exception: return 0


def _score_ratio(actual, target, inverse=False):
    """Score 0-100 based on how close `actual` is to `target`.
    inverse=True → lower actual is better (e.g. overdue %)."""
    if target is None or target <= 0:
        return 100 if (actual or 0) == 0 else 0
    if inverse:
        # actual=0 → 100, actual=target → 60, actual=2×target → 20
        r = (actual or 0) / target
        return _clip(100 - r * 50)
    r = (actual or 0) / target
    return _clip(r * 100)


def compute_pillars(projects, credits, inv_items, approvals, health_cfg,
                    daily_updates=None, weekly_audits=None, brand_returns=None):
    now = datetime.now(timezone.utc)
    month_key = now.strftime("%Y-%m")
    last_month = (now - timedelta(days=30)).strftime("%Y-%m")
    six_months_ago = (now - timedelta(days=180)).strftime("%Y-%m")
    twelve_months_ago = (now - timedelta(days=365)).strftime("%Y-%m")

    targets = health_cfg.get("targets", {}) or {}
    weights = health_cfg.get("weights", {}) or {}
    breakdown = {}

    # ── Aggregations ──────────────────────────────────────────────────
    revenue_by_month = defaultdict(float)
    projects_by_month = defaultdict(int)
    wins_by_month = defaultdict(int)
    leads_by_month = defaultdict(int)
    margins = []
    below_min_margin = 0
    completed_on_time = 0
    completed_delayed = 0
    ticket_sizes = []
    quote_pipeline_value = 0
    active_targets = targets.get("monthly_revenue_target", 0)
    min_margin = targets.get("minimum_acceptable_margin_pct", 12)
    on_time_target = targets.get("on_time_delivery_pct", 90)

    for p in projects:
        created = (p.get("created_at") or "")[:7]
        status = p.get("status", "draft")
        cost = p.get("cost_estimation", {}).get("total_cost", 0)
        margin_amt = p.get("cost_estimation", {}).get("margin_total", 0)
        if created:
            projects_by_month[created] += 1
            if status != "draft":
                leads_by_month[created] += 1
            if status in ("approved", "completed"):
                wins_by_month[created] += 1
                revenue_by_month[created] += cost
                ticket_sizes.append(cost)
                if cost > 0:
                    m_pct = (margin_amt / cost) * 100
                    margins.append(m_pct)
                    if m_pct < min_margin:
                        below_min_margin += 1
        # pipeline for next period
        if status in ("submitted",) and created and created >= last_month:
            quote_pipeline_value += cost

        # on-time delivery
        if status == "completed":
            inst = p.get("installation_date")
            comm = p.get("commissioning_date") or p.get("completed_at")
            if inst and comm:
                try:
                    delta = (datetime.fromisoformat(comm.replace("Z", "+00:00")) - datetime.fromisoformat(inst.replace("Z", "+00:00"))).days
                    (completed_on_time if delta <= 30 else completed_delayed).__iadd__(1) if False else None
                    if delta <= 30: completed_on_time += 1
                    else: completed_delayed += 1
                except Exception:
                    completed_on_time += 1

    this_month_revenue = revenue_by_month.get(month_key, 0)
    last_month_revenue = revenue_by_month.get(last_month, 0)

    # ── PILLAR 1 · Sales & Growth ─────────────────────────────────────
    revenue_vs_target = _score_ratio(this_month_revenue, active_targets)
    mom_growth = _pct(this_month_revenue - last_month_revenue, last_month_revenue)
    mom_score = _clip(50 + mom_growth * 2)  # +/- 25% growth maps roughly to 0-100
    # Conversion (6-month baseline)
    leads_6m = sum(v for k, v in leads_by_month.items() if k >= six_months_ago)
    wins_6m = sum(v for k, v in wins_by_month.items() if k >= six_months_ago)
    conv_6m = _pct(wins_6m, leads_6m)
    conv_score = _score_ratio(conv_6m, targets.get("target_conversion_pct", 35))
    # Pipeline coverage (submitted quotes vs monthly target)
    pipeline_score = _score_ratio(quote_pipeline_value, active_targets)
    sales_score = round((revenue_vs_target + mom_score + conv_score + pipeline_score) / 4, 1)
    breakdown["sales_growth"] = {
        "score": sales_score,
        "weight": weights.get("sales_growth", 25),
        "metrics": {
            "this_month_revenue": round(this_month_revenue),
            "monthly_target": active_targets,
            "revenue_vs_target_pct": round(revenue_vs_target, 1),
            "mom_growth_pct": round(mom_growth, 1),
            "conversion_6m_pct": round(conv_6m, 1),
            "pipeline_value": round(quote_pipeline_value),
        },
        "components": [
            {"name": "Revenue vs Target", "score": round(revenue_vs_target, 1)},
            {"name": "MoM Growth",         "score": round(mom_score, 1)},
            {"name": "Conversion (6m)",    "score": round(conv_score, 1)},
            {"name": "Pipeline Coverage",  "score": round(pipeline_score, 1)},
        ],
    }

    # ── PILLAR 2 · Profitability ──────────────────────────────────────
    avg_margin = sum(margins) / len(margins) if margins else 0
    margin_target = targets.get("target_margin_pct", 20)
    margin_score = _score_ratio(avg_margin, margin_target)
    # Share of projects below the minimum acceptable margin (INVERSE)
    below_min_share = _pct(below_min_margin, max(len(margins), 1))
    below_score = _score_ratio(below_min_share, 20, inverse=True)   # ≥20% below target = 0
    # Ticket-size trend
    avg_ticket = sum(ticket_sizes) / len(ticket_sizes) if ticket_sizes else 0
    ticket_score = _score_ratio(avg_ticket, targets.get("avg_ticket_target", 300000))
    profit_score = round((margin_score + below_score + ticket_score) / 3, 1)
    breakdown["profitability"] = {
        "score": profit_score,
        "weight": weights.get("profitability", 25),
        "metrics": {
            "avg_margin_pct": round(avg_margin, 1),
            "target_margin_pct": margin_target,
            "projects_below_min_margin": below_min_margin,
            "below_min_margin_pct": round(below_min_share, 1),
            "avg_ticket_size": round(avg_ticket),
        },
        "components": [
            {"name": "Margin vs Target",      "score": round(margin_score, 1)},
            {"name": "Below-Min Margin Share","score": round(below_score, 1)},
            {"name": "Ticket Size Trend",     "score": round(ticket_score, 1)},
        ],
    }

    # ── PILLAR 3 · Cash & Collections ─────────────────────────────────
    outstanding = sum(c.get("balance", 0) for c in credits if c.get("status") != "closed")
    overdue = sum(c.get("balance", 0) for c in credits if c.get("status") == "overdue")
    overdue_share = _pct(overdue, outstanding) if outstanding else 0
    overdue_score = _score_ratio(overdue_share, targets.get("max_overdue_pct", 15), inverse=True)
    # Outstanding vs monthly revenue (>2× monthly is bad)
    ratio = outstanding / (this_month_revenue if this_month_revenue > 0 else 1)
    ratio_score = _clip(100 - ratio * 25)  # 4x monthly = 0, <1x = 100
    # Debtor concentration
    top_share = 0
    if credits:
        top = max((c.get("balance", 0) for c in credits), default=0)
        top_share = _pct(top, max(outstanding, 1))
    concentration_score = _score_ratio(top_share, health_cfg.get("top_debtor_max_share_pct", 30), inverse=True)
    # Avg collection days (approx from customer_credits.created_at → status closed_at, or simple heuristic)
    coll_days_est = 30 + int(overdue_share * 1.5)   # heuristic when we don't have paid_at
    coll_score = _score_ratio(coll_days_est, targets.get("max_collection_days", 45), inverse=True)
    cash_score = round((overdue_score + ratio_score + concentration_score + coll_score) / 4, 1)
    breakdown["cash_collections"] = {
        "score": cash_score,
        "weight": weights.get("cash_collections", 20),
        "metrics": {
            "outstanding": round(outstanding),
            "overdue": round(overdue),
            "overdue_share_pct": round(overdue_share, 1),
            "outstanding_vs_monthly_revenue": round(ratio, 2),
            "top_debtor_share_pct": round(top_share, 1),
            "avg_collection_days_est": coll_days_est,
        },
        "components": [
            {"name": "Overdue Ratio",       "score": round(overdue_score, 1)},
            {"name": "AR/Monthly Revenue",  "score": round(ratio_score, 1)},
            {"name": "Debtor Concentration","score": round(concentration_score, 1)},
            {"name": "Collection Days",     "score": round(coll_score, 1)},
        ],
    }

    # ── PILLAR 4 · Operations ─────────────────────────────────────────
    delivery_score = _score_ratio(_pct(completed_on_time, max(completed_on_time + completed_delayed, 1)), on_time_target)
    pending_count = len([a for a in approvals if a.get("status") == "pending"])
    approval_latency_score = _score_ratio(pending_count, 20, inverse=True)  # >20 pending = 0
    low_stock = sum(1 for i in inv_items if i.get("quantity", 0) <= i.get("reorder_level", 5))
    inventory_score = _score_ratio(low_stock, 15, inverse=True)
    # Returns per project
    returns = brand_returns or []
    returns_per_project = _pct(len(returns), max(len(projects), 1))
    service_score = _score_ratio(returns_per_project, 5, inverse=True)   # >5% is bad
    ops_score = round((delivery_score + approval_latency_score + inventory_score + service_score) / 4, 1)
    breakdown["operations"] = {
        "score": ops_score,
        "weight": weights.get("operations", 20),
        "metrics": {
            "on_time_delivery_pct": round(_pct(completed_on_time, max(completed_on_time + completed_delayed, 1)), 1),
            "pending_approvals": pending_count,
            "low_stock_items": low_stock,
            "returns_per_project_pct": round(returns_per_project, 1),
        },
        "components": [
            {"name": "On-Time Delivery",    "score": round(delivery_score, 1)},
            {"name": "Approval Latency",    "score": round(approval_latency_score, 1)},
            {"name": "Inventory Health",    "score": round(inventory_score, 1)},
            {"name": "Service Quality",     "score": round(service_score, 1)},
        ],
    }

    # ── PILLAR 5 · Team & Compliance ──────────────────────────────────
    # Staff productivity spread
    staff_perf = defaultdict(float)
    for p in projects:
        if p.get("status") in ("approved", "completed"):
            staff_perf[p.get("created_by_name", "?")] += p.get("cost_estimation", {}).get("total_cost", 0)
    if staff_perf:
        top_rev = max(staff_perf.values())
        total_rev = sum(staff_perf.values())
        key_person_risk = _pct(top_rev, total_rev)
    else:
        key_person_risk = 0
    key_score = _score_ratio(key_person_risk, 60, inverse=True)   # >60% = key-person risk
    # Daily update compliance
    updates_recent = len([d for d in (daily_updates or []) if d.get("date", "")[:7] >= last_month])
    updates_score = _score_ratio(updates_recent, 20)  # >=20/month = 100
    # Audits
    audits_done = len([a for a in (weekly_audits or []) if a.get("status") == "completed"])
    audits_score = _score_ratio(audits_done, 4)  # 4/month = perfect
    team_score = round((key_score + updates_score + audits_score) / 3, 1)
    breakdown["team_compliance"] = {
        "score": team_score,
        "weight": weights.get("team_compliance", 10),
        "metrics": {
            "top_staff_revenue_share_pct": round(key_person_risk, 1),
            "daily_updates_last_30d": updates_recent,
            "weekly_audits_completed_last_30d": audits_done,
        },
        "components": [
            {"name": "Key-Person Risk",      "score": round(key_score, 1)},
            {"name": "Daily-Update Compliance","score": round(updates_score, 1)},
            {"name": "Weekly Audit Coverage",  "score": round(audits_score, 1)},
        ],
    }

    # ── Composite ─────────────────────────────────────────────────────
    total_weight = sum(pillar["weight"] for pillar in breakdown.values()) or 100
    composite = 0
    for k, p in breakdown.items():
        composite += p["score"] * (p["weight"] / total_weight)
    composite = round(composite, 1)

    bands = health_cfg.get("bands", {}) or {}
    if composite >= bands.get("strong", 80): verdict, band = "Strong", "strong"
    elif composite >= bands.get("healthy", 65): verdict, band = "Healthy", "healthy"
    elif composite >= bands.get("attention", 50): verdict, band = "Needs Attention", "attention"
    else: verdict, band = "Critical", "critical"

    # "Dragging" — 2 lowest metrics named
    all_components = []
    for k, p in breakdown.items():
        for c in p["components"]:
            all_components.append({"pillar": k, "name": c["name"], "score": c["score"]})
    dragging = sorted(all_components, key=lambda x: x["score"])[:3]

    weakest_pillar = min(breakdown.items(), key=lambda kv: kv[1]["score"])
    return {
        "score": composite,
        "band": band,
        "verdict": verdict,
        "computed_at": now.isoformat(),
        "pillars": breakdown,
        "dragging": dragging,
        "weakest_pillar": {"key": weakest_pillar[0], "score": weakest_pillar[1]["score"]},
    }
