"""Expansion Module — Where should we open the next branch?

Reads project + credit + inventory + return data, aggregates per district,
scores each district on 8 admin-weightable sub-components, and returns a
0-100 composite plus a break-even simulator.

Score >= min-samples-threshold or is greyed out. This is deliberate — a
district with 3 projects should never look like an opportunity.
"""
from __future__ import annotations
import math
from collections import defaultdict
from datetime import datetime, timezone, timedelta


DEFAULT_EXPANSION_CONFIG = {
    "_id": "singleton",
    "weights": {
        "demand_density": 20,
        "revenue_contribution": 15,
        "growth_momentum": 15,
        "margin_quality": 15,
        "service_burden": 10,
        "travel_cost_drag": 10,
        "payment_health": 10,
        "market_headroom": 5,
    },
    "thresholds": {
        "minimum_projects_for_score": 10,
        "default_branch_monthly_cost": 250000,
        "default_setup_capex": 1500000,
        "target_margin_pct": 20,
        "distance_per_km_cost": 50,
    },
    "bands": {"strong": 80, "watch": 60, "serve": 40},
}


def _clip(x, lo=0, hi=100):
    try: return max(lo, min(hi, float(x)))
    except Exception: return lo


def _pct(a, b):
    if not b: return 0
    return (a / b) * 100


def compute_district_scores(projects, credits, brand_returns, branches, config,
                            period_start=None, period_end=None):
    now = datetime.now(timezone.utc)
    period_start = period_start or (now - timedelta(days=365)).isoformat()
    period_end = period_end or now.isoformat()

    weights = config.get("weights", {}) or {}
    thresholds = config.get("thresholds", {}) or {}
    min_projects = thresholds.get("minimum_projects_for_score", 10)
    target_margin = thresholds.get("target_margin_pct", 20)
    default_km_cost = thresholds.get("distance_per_km_cost", 50)

    # ── Bucket projects by district ────────────────────────────────────
    by_district = defaultdict(lambda: {
        "projects": [], "enquiries": 0, "quotes": 0, "wins": 0, "completed": 0,
        "revenue": 0, "margin_total": 0, "ticket_sizes": [], "months_active": set(),
    })

    for p in projects:
        loc = p.get("location", {}) or {}
        d = loc.get("district") or "Unknown"
        st = loc.get("state") or ""
        entry = by_district[(d, st)]
        entry["projects"].append(p)
        status = p.get("status", "draft")
        entry["enquiries"] += 1
        if status != "draft": entry["quotes"] += 1
        if status in ("approved", "completed"): entry["wins"] += 1
        if status == "completed": entry["completed"] += 1
        if status in ("approved", "completed"):
            cost = p.get("cost_estimation", {}).get("total_cost", 0)
            marg = p.get("cost_estimation", {}).get("margin_total", 0)
            entry["revenue"] += cost
            entry["margin_total"] += marg
            entry["ticket_sizes"].append(cost)
        created = (p.get("created_at") or "")[:7]
        if created: entry["months_active"].add(created)

    # Global aggregates for normalisation
    global_revenue = sum(bucket["revenue"] for bucket in by_district.values()) or 1
    global_projects = sum(len(bucket["projects"]) for bucket in by_district.values()) or 1
    margins_all = [ (b["margin_total"] / b["revenue"]) * 100 for b in by_district.values() if b["revenue"] > 0 ]
    company_margin = sum(margins_all) / len(margins_all) if margins_all else target_margin

    # Credits → payment health by district (via project id / customer_name — heuristic mapping)
    credits_by_customer = defaultdict(list)
    for c in credits:
        credits_by_customer[c.get("customer_name", "")].append(c)

    # Returns per project (map by project's district if possible)
    returns_by_district = defaultdict(int)
    for r in brand_returns:
        pid = r.get("project_id")
        if not pid: continue
        # scan projects list for match — small ops so OK for now
        for p in projects:
            if str(p.get("_id", "")) == str(pid) or p.get("id") == str(pid):
                d = (p.get("location", {}) or {}).get("district") or "Unknown"
                returns_by_district[d] += 1
                break

    # Branches → distance model
    def _dist_km(a_lat, a_lon, b_lat, b_lon):
        if None in (a_lat, a_lon, b_lat, b_lon): return None
        R = 6371
        lat1, lat2 = math.radians(a_lat), math.radians(b_lat)
        dlat = lat2 - lat1
        dlon = math.radians(b_lon - a_lon)
        aa = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
        return R * 2 * math.asin(math.sqrt(aa))

    # ── Build district scorecards ─────────────────────────────────────
    results = []
    six_month_key = (now - timedelta(days=180)).strftime("%Y-%m")
    twelve_month_key = (now - timedelta(days=365)).strftime("%Y-%m")

    for (district, state), b in by_district.items():
        n = len(b["projects"])
        conf_low = n < min_projects
        revenue = b["revenue"]
        margin_pct = (b["margin_total"] / revenue * 100) if revenue else 0
        avg_ticket = (sum(b["ticket_sizes"]) / len(b["ticket_sizes"])) if b["ticket_sizes"] else 0
        conv_rate = _pct(b["wins"], b["quotes"]) if b["quotes"] else 0

        # 6m vs 12m growth
        rev_6m = 0; proj_6m = 0
        rev_12m = 0; proj_12m = 0
        for p in b["projects"]:
            created = (p.get("created_at") or "")[:7]
            if not created: continue
            cost = p.get("cost_estimation", {}).get("total_cost", 0) if p.get("status") in ("approved", "completed") else 0
            if created >= six_month_key: rev_6m += cost; proj_6m += 1
            if created >= twelve_month_key: rev_12m += cost; proj_12m += 1
        # Previous 6m = 12m minus 6m
        rev_prev = max(rev_12m - rev_6m, 0)
        growth_pct = _pct(rev_6m - rev_prev, rev_prev) if rev_prev else 0

        # ── Sub-scores ────────────────────────────────────────────────
        demand_score = _clip(_pct(n, global_projects) * 5)   # 20% share = 100
        revenue_share_score = _clip(_pct(revenue, global_revenue) * 5)
        growth_score = _clip(50 + growth_pct * 2)
        margin_score = _clip((margin_pct / max(company_margin, 1)) * 100 * 0.9)  # slight discount
        # Service burden (inverse)
        rets = returns_by_district.get(district, 0)
        service_burden = _pct(rets, max(n, 1))
        service_score = _clip(100 - service_burden * 10)

        # Travel-cost drag (inverse)
        nearest_km = None
        # pick a project's lat/lon as district anchor
        anchor = next((p.get("location", {}) for p in b["projects"] if p.get("location", {}).get("latitude")), None)
        if anchor and branches:
            distances = []
            for br in branches:
                dkm = _dist_km(anchor.get("latitude"), anchor.get("longitude"),
                                br.get("latitude"), br.get("longitude"))
                if dkm is not None: distances.append(dkm)
            if distances: nearest_km = min(distances)
        # 300km+ from nearest = 0
        travel_score = _clip(100 - (nearest_km or 0) / 3) if nearest_km is not None else 60

        # Payment health (inverse of overdue share)
        cust_credits = []
        for p in b["projects"]:
            cust_credits += credits_by_customer.get(p.get("customer", {}).get("name", ""), [])
        cust_out = sum(c.get("balance", 0) for c in cust_credits if c.get("status") != "closed")
        cust_overdue = sum(c.get("balance", 0) for c in cust_credits if c.get("status") == "overdue")
        overdue_pct = _pct(cust_overdue, cust_out) if cust_out else 0
        payment_score = _clip(100 - overdue_pct * 3)

        # Market headroom (5%) — placeholder: static 60 unless config supplies pop-normalised data
        headroom_score = 60

        w = weights
        composite = round(
            demand_score       * (w.get("demand_density", 20)       / 100) +
            revenue_share_score* (w.get("revenue_contribution", 15) / 100) +
            growth_score       * (w.get("growth_momentum", 15)      / 100) +
            margin_score       * (w.get("margin_quality", 15)       / 100) +
            service_score      * (w.get("service_burden", 10)       / 100) +
            travel_score       * (w.get("travel_cost_drag", 10)     / 100) +
            payment_score      * (w.get("payment_health", 10)       / 100) +
            headroom_score     * (w.get("market_headroom", 5)       / 100), 1
        )

        # Band
        bands = config.get("bands", {}) or {}
        if composite >= bands.get("strong", 80): band, verdict = "strong", "Strong case — volume, margin & trend support a branch."
        elif composite >= bands.get("watch", 60): band, verdict = "watch", "Watch — promising but one factor is weak."
        elif composite >= bands.get("serve", 40): band, verdict = "serve", "Serve from existing branch — not yet."
        else: band, verdict = "no_case", "No case, or insufficient data."

        results.append({
            "district": district,
            "state": state,
            "score": composite,
            "band": band,
            "verdict": verdict,
            "confidence_low": conf_low,
            "sample_size": n,
            "metrics": {
                "projects": n,
                "enquiries": b["enquiries"], "quotes": b["quotes"], "wins": b["wins"],
                "completed": b["completed"],
                "revenue": round(revenue), "margin_pct": round(margin_pct, 1),
                "avg_ticket": round(avg_ticket),
                "conversion_rate_pct": round(conv_rate, 1),
                "growth_6m_pct": round(growth_pct, 1),
                "nearest_branch_km": round(nearest_km, 1) if nearest_km is not None else None,
                "overdue_pct": round(overdue_pct, 1),
                "returns": rets,
            },
            "components": [
                {"name": "Demand Density",     "score": round(demand_score, 1),      "weight": w.get("demand_density", 20)},
                {"name": "Revenue Share",       "score": round(revenue_share_score, 1),"weight": w.get("revenue_contribution", 15)},
                {"name": "Growth Momentum",     "score": round(growth_score, 1),     "weight": w.get("growth_momentum", 15)},
                {"name": "Margin Quality",      "score": round(margin_score, 1),      "weight": w.get("margin_quality", 15)},
                {"name": "Service Burden",      "score": round(service_score, 1),     "weight": w.get("service_burden", 10)},
                {"name": "Travel Cost Drag",    "score": round(travel_score, 1),      "weight": w.get("travel_cost_drag", 10)},
                {"name": "Payment Health",      "score": round(payment_score, 1),     "weight": w.get("payment_health", 10)},
                {"name": "Market Headroom",     "score": round(headroom_score, 1),    "weight": w.get("market_headroom", 5)},
            ],
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return {
        "generated_at": now.isoformat(),
        "period_start": period_start,
        "period_end": period_end,
        "min_projects_for_score": min_projects,
        "company_avg_margin_pct": round(company_margin, 1),
        "districts": results,
        "totals": {
            "revenue_all_districts": round(global_revenue),
            "projects_all_districts": global_projects,
        },
    }


def simulate_breakeven(monthly_run_rate, target_margin_pct, monthly_branch_cost,
                       setup_capex, current_monthly_projects, current_avg_ticket):
    """Given branch economics + current district run-rate, compute how long to break even.

    All args are numbers. Returns { projects_per_month_needed, revenue_per_month_needed,
    months_to_breakeven, gap_projects_per_month }.
    """
    target_margin_pct = target_margin_pct or 20
    monthly_margin_needed = monthly_branch_cost or 0
    revenue_needed = monthly_margin_needed / (target_margin_pct / 100) if target_margin_pct > 0 else 0
    avg_ticket = current_avg_ticket or 300000
    projects_needed = revenue_needed / avg_ticket if avg_ticket > 0 else 0
    monthly_margin_now = (monthly_run_rate or 0) * (target_margin_pct / 100)
    surplus = monthly_margin_now - monthly_margin_needed
    months_to_be = (setup_capex or 0) / surplus if surplus > 0 else None
    return {
        "revenue_per_month_needed": round(revenue_needed),
        "projects_per_month_needed": round(projects_needed, 1),
        "current_monthly_projects": round(current_monthly_projects or 0, 1),
        "gap_projects_per_month": round(projects_needed - (current_monthly_projects or 0), 1),
        "months_to_breakeven": round(months_to_be, 1) if months_to_be else None,
        "monthly_margin_now": round(monthly_margin_now),
        "monthly_margin_needed": round(monthly_margin_needed),
        "assumption_target_margin_pct": target_margin_pct,
        "assumption_avg_ticket": avg_ticket,
    }
