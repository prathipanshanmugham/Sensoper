"""Iter 57 — usability restructure: retired orphan config keys, fast weekly-audit flow (week audit, point status, templates)."""
import os
import uuid

import pytest
import requests

API = f"{os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')}/api"
TAG = f"TEST57_{uuid.uuid4().hex[:5]}"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")}, timeout=60).status_code == 200
    return s


def test_pricing_config_only_exposes_live_keys(admin):
    cfg = admin.get(f"{API}/catalogue/config", timeout=60).json()
    for k in ("rounding_step", "rounding_mode", "credit_interest_monthly_pct", "string_low_temp_default_c"):
        assert k in cfg
    for k in ("peak_sun_hours_availability", "pump_oversizing_factor", "pump_derating_factor", "diesel_price_per_litre", "discount_rate_pct",
              "panel_area_sqft_per_kwp", "co2_kg_per_kwh_grid", "specific_yield_kwh_per_kwp_day", "history", "active", "gst_pct"):
        assert k not in cfg, f"retired key {k} still exposed"
    # saving still works and calculators/report still read what they need
    r = admin.put(f"{API}/catalogue/config", json={"rounding_step": cfg["rounding_step"], "rounding_mode": cfg["rounding_mode"], "credit_interest_monthly_pct": cfg["credit_interest_monthly_pct"], "string_low_temp_default_c": cfg["string_low_temp_default_c"]}, timeout=60)
    assert r.status_code == 200 and "discount_rate_pct" not in r.json()
    assert admin.post(f"{API}/calculate/quick", json={"system_type": "on-grid", "customer_type": "residential", "monthly_eb_bill": 3000}, timeout=60).status_code == 200


def test_week_audit_points_board_and_templates(admin):
    w = admin.post(f"{API}/audits/this-week", timeout=60).json()
    assert w["title"].startswith("Weekly Audit") and w["status"] == "open"
    assert admin.post(f"{API}/audits/this-week", timeout=60).json()["id"] == w["id"], "must reuse this week's audit"
    before = len(w["issues"])
    r = admin.put(f"{API}/audits/{w['id']}/issue", json={"description": f"{TAG} PPE missing", "severity": "high", "owner_name": "Ravi", "fix_deadline": "2020-01-01"}, timeout=60)
    assert r.status_code == 200
    a = next(x for x in admin.get(f"{API}/audits", timeout=60).json() if x["id"] == w["id"])
    pt = a["issues"][before]
    assert pt["status"] == "open" and pt["created_at"] and pt["severity"] == "high"
    r = admin.put(f"{API}/audits/{w['id']}/issue/{before}/status", json={"status": "resolved"}, timeout=60)
    assert r.status_code == 200
    a = next(x for x in admin.get(f"{API}/audits", timeout=60).json() if x["id"] == w["id"])
    assert a["issues"][before]["status"] == "resolved" and a["issues"][before]["resolved_by"]
    assert admin.put(f"{API}/audits/{w['id']}/issue/{before}/status", json={"status": "bogus"}, timeout=60).status_code == 400
    assert admin.put(f"{API}/audits/{w['id']}/issue/999/status", json={"status": "open"}, timeout=60).status_code == 404
    # templates: defaults, then editable
    t = admin.get(f"{API}/audit-templates", timeout=60).json()["templates"]
    assert any(x.startswith("Safety") for x in t)
    saved = admin.put(f"{API}/audit-templates", json={"templates": t + [f"{TAG} Vehicle check"]}, timeout=60).json()["templates"]
    assert f"{TAG} Vehicle check" in saved
    admin.put(f"{API}/audit-templates", json={"templates": t}, timeout=60)
    # audit report still counts issues
    rep = admin.get(f"{API}/reports/audit", timeout=60)
    assert rep.status_code == 200 and rep.json()["summary"]["total_issues"] >= 1


def test_daily_update_lead_counters_still_feed_marketing_report(admin):
    r = admin.post(f"{API}/daily-updates", json={"project_id": "general", "update_type": "leads", "data": {"total_leads": 3, "qualified_leads": 2, "site_visits": 1, "quotes_sent": 1, "followups": 0, "conversions": 1}}, timeout=60)
    assert r.status_code == 200
    rep = admin.get(f"{API}/reports/marketing", timeout=60).json()
    assert rep["summary"]["total_leads"] >= 3
    admin.delete(f"{API}/daily-updates/{r.json()['id']}", timeout=60)
