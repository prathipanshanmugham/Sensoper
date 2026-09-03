"""Iteration 51: NEW gap items — report filters (district/speciality/platform/category),
ecommerce monthly+platform breakdown, order status/payment updates, inventory_movements
reference_id linkage, and invoice T&C active-template cleanup."""
import os
import re
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")


@pytest.fixture(scope="session")
def creds():
    c = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    e = re.search(r"(?im)^\s*[-*]?\s*(?:\*\*)?Email(?:\*\*)?\s*:\s*`?([^`\s]+)", c)
    pw = re.search(r"(?im)^\s*[-*]?\s*(?:\*\*)?Password(?:\*\*)?\s*:\s*`?([^`\s]+)", c)
    assert e and pw, "credentials not parseable"
    return {"email": e.group(1), "password": pw.group(1)}


@pytest.fixture(scope="session")
def client(creds):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json=creds, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="session")
def mongo():
    if not MONGO_URL or not DB_NAME:
        pytest.skip("MONGO_URL/DB_NAME not available")
    cl = MongoClient(MONGO_URL)
    yield cl[DB_NAME]
    cl.close()


@pytest.fixture(scope="session")
def state():
    return {}


# ═══════════ Partner Performance report — new district/speciality filters ═══════════
class TestPartnerPerformanceFilters:
    def test_seed_partner(self, client, state):
        name = f"TEST_Iter51_Partner_{uuid.uuid4().hex[:6]}"
        r = client.post(f"{API}/partners", json={
            "partner_type": "external_subcontractor", "name": name, "phone": "9998887777",
            "specialities": ["pump", "civil"], "service_districts": ["TEST_District_51"],
            "retention_pct": 5,
            "rate_card": [{"activity": "Pump install", "unit": "nos", "rate": 500, "effective_from": "2024-01-01"}],
        }, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        state["partner_id"] = r.json()["id"]
        state["partner_name"] = name

        # partner_performance only lists partners WITH assignments -> create one
        pr = client.get(f"{API}/projects", timeout=90)
        assert pr.status_code == 200, pr.text[:300]
        projects = pr.json() if isinstance(pr.json(), list) else pr.json().get("projects", [])
        assert projects, "no projects available to assign partner"
        state["project_id"] = projects[0]["id"]
        a = client.post(f"{API}/partners/{state['partner_id']}/assignments", json={
            "project_id": state["project_id"],
            "activities": [{"activity": "Pump install", "unit": "nos", "quantity": 2, "rate": 500}],
            "assigned_date": "2026-07-01", "expected_completion": "2026-07-10",
        }, timeout=60)
        assert a.status_code in (200, 201), a.text[:400]
        state["assignment_id"] = a.json()["id"]

    def test_report_unfiltered_contains_partner(self, client, state):
        r = client.get(f"{API}/reports/partner_performance", timeout=90)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["title"] == "Partner Performance Report"
        assert any(row["partner"] == state["partner_name"] for row in d["rows"]), "seeded partner missing"

    def test_speciality_filter_keeps_matching_partner(self, client, state):
        r = client.get(f"{API}/reports/partner_performance", params={"speciality": "pump"}, timeout=90)
        assert r.status_code == 200, r.text[:400]
        rows = r.json()["rows"]
        assert any(row["partner"] == state["partner_name"] for row in rows)
        for row in rows:
            assert "pump" in row["specialities"], f"non-pump partner leaked: {row['specialities']}"

    def test_speciality_filter_excludes_non_matching(self, client, state):
        r = client.get(f"{API}/reports/partner_performance", params={"speciality": "hybrid"}, timeout=90)
        assert r.status_code == 200, r.text[:400]
        assert all(row["partner"] != state["partner_name"] for row in r.json()["rows"])

    def test_district_filter_matches(self, client, state):
        r = client.get(f"{API}/reports/partner_performance", params={"district": "TEST_District_51"}, timeout=90)
        assert r.status_code == 200, r.text[:400]
        rows = r.json()["rows"]
        assert [row["partner"] for row in rows] == [state["partner_name"]], rows

    def test_unknown_district_returns_zero_rows_not_error(self, client):
        r = client.get(f"{API}/reports/partner_performance",
                       params={"district": f"NoSuchDistrict_{uuid.uuid4().hex[:6]}"}, timeout=90)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["rows"] == []
        assert d["summary"]["total_partners"] == 0
        assert d["summary"]["avg_on_time_rate"] == 0
        assert d["chart_data"] == []

    def test_combined_district_and_speciality(self, client, state):
        r = client.get(f"{API}/reports/partner_performance",
                       params={"district": "TEST_District_51", "speciality": "civil"}, timeout=90)
        assert r.status_code == 200
        assert any(row["partner"] == state["partner_name"] for row in r.json()["rows"])
        r2 = client.get(f"{API}/reports/partner_performance",
                        params={"district": "TEST_District_51", "speciality": "on-grid"}, timeout=90)
        assert r2.status_code == 200
        assert r2.json()["rows"] == []


# ═══════════ Ecommerce order lifecycle + movement reference_id ═══════════
class TestEcommerceOrderLifecycle:
    def test_setup_platform_listing(self, client, state):
        p = client.post(f"{API}/ecommerce/platforms", json={
            "name": f"TEST_Iter51_Plat_{uuid.uuid4().hex[:5]}", "platform_type": "marketplace",
            "commission_pct": 10, "seller_id": "TEST51",
        }, timeout=60)
        assert p.status_code in (200, 201), p.text[:400]
        state["platform_id"] = p.json()["id"]

        items = client.get(f"{API}/inventory/items", timeout=90).json()
        items = items if isinstance(items, list) else items.get("items", [])
        cand = [i for i in items if (i.get("quantity") or 0) >= 5]
        assert cand, "no inventory item with stock >= 5"
        state["item_id"] = cand[0]["id"]
        state["item_category"] = cand[0].get("category")
        state["qty_before"] = cand[0]["quantity"]

        l = client.post(f"{API}/ecommerce/listings", json={
            "platform_id": state["platform_id"], "inventory_item_id": state["item_id"],
            "platform_sku": f"TEST51-{uuid.uuid4().hex[:5]}", "listed_price": 1000, "status": "live",
        }, timeout=60)
        assert l.status_code in (200, 201), l.text[:400]
        state["listing_id"] = l.json()["id"]

    def test_create_order_sets_movement_reference_id(self, client, state, mongo):
        r = client.post(f"{API}/ecommerce/orders", json={
            "platform_id": state["platform_id"],
            "platform_order_id": f"TEST51-ORD-{uuid.uuid4().hex[:6]}",
            "order_date": "2026-06-15", "shipping_cost": 50,
            "lines": [{"listing_id": state["listing_id"], "inventory_item_id": state["item_id"],
                       "quantity": 2, "sold_price": 1000}],
        }, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        state["order_id"] = d["id"]
        assert d["order_total"] == 2000 and d["commission_total"] == 200 and d["net_payout"] == 1750

        # stock decremented
        it = client.get(f"{API}/inventory/items/{state['item_id']}", timeout=60).json()
        assert it["quantity"] == state["qty_before"] - 2

        # REGRESSION: movement must be traceable back to the order
        mv = list(mongo.inventory_movements.find({"reference_type": "ecommerce_order",
                                                  "reference_id": state["order_id"]}))
        assert mv, "no inventory_movements row with reference_id == order id (orphaned movement bug)"
        assert all(m.get("reference_id") == state["order_id"] for m in mv)

    def test_payment_status_settled_sets_settlement_date(self, client, state):
        r = client.put(f"{API}/ecommerce/orders/{state['order_id']}",
                       json={"payment_status": "settled", "settlement_date": "2026-06-20",
                             "net_payout": 1750}, timeout=60)
        assert r.status_code == 200, r.text[:400]
        assert r.json()["payment_status"] == "settled"
        # persisted?
        orders = client.get(f"{API}/ecommerce/orders", timeout=60).json()
        mine = [o for o in orders if o["id"] == state["order_id"]][0]
        assert mine["payment_status"] == "settled"
        assert mine.get("settlement_date") == "2026-06-20", f"settlement_date not persisted: {mine}"

    def test_cancelled_restores_stock_and_movement_ref(self, client, state, mongo):
        r = client.put(f"{API}/ecommerce/orders/{state['order_id']}",
                       json={"order_status": "cancelled"}, timeout=60)
        assert r.status_code == 200, r.text[:400]
        assert r.json()["order_status"] == "cancelled"
        it = client.get(f"{API}/inventory/items/{state['item_id']}", timeout=60).json()
        assert it["quantity"] == state["qty_before"], f"stock not restored on cancel: {it['quantity']}"
        mv = list(mongo.inventory_movements.find({"reference_type": "ecommerce_order_return",
                                                  "reference_id": state["order_id"]}))
        assert mv, "return movement missing reference_id"

    def test_cancel_then_second_cancel_no_double_restore(self, client, state):
        r = client.put(f"{API}/ecommerce/orders/{state['order_id']}",
                       json={"order_status": "cancelled"}, timeout=60)
        assert r.status_code == 200
        it = client.get(f"{API}/inventory/items/{state['item_id']}", timeout=60).json()
        assert it["quantity"] == state["qty_before"], "double restore on repeat cancel"


# ═══════════ Ecommerce report — filters + breakdown tables ═══════════
class TestEcommerceReport:
    def test_summary_all_scalar(self, client):
        r = client.get(f"{API}/reports/ecommerce", timeout=90)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        expected = ["total_revenue", "total_commission", "net_margin", "total_orders",
                    "return_rate_pct", "listings_live", "listings_draft", "listings_paused",
                    "listings_delisted"]
        for k in expected:
            assert k in d["summary"], f"missing summary key {k}"
        for k, v in d["summary"].items():
            assert not isinstance(v, (dict, list)), f"summary.{k} is not scalar: {v}"

    def test_breakdown_tables_present(self, client):
        d = client.get(f"{API}/reports/ecommerce", timeout=90).json()
        assert isinstance(d.get("platform_rows"), list) and d["platform_rows"], "empty platform_rows"
        assert isinstance(d.get("monthly_rows"), list) and d["monthly_rows"], "empty monthly_rows"
        for row in d["platform_rows"]:
            for k in ("platform", "revenue", "units", "commission", "orders"):
                assert k in row, f"platform row missing {k}: {row}"
            assert isinstance(row["revenue"], (int, float))
        for row in d["monthly_rows"]:
            for k in ("month", "revenue", "units", "orders"):
                assert k in row, f"monthly row missing {k}: {row}"
            assert re.match(r"^\d{4}-\d{2}$|^unknown$", row["month"]), row["month"]
        # months sorted ascending
        months = [r["month"] for r in d["monthly_rows"]]
        assert months == sorted(months)

    def test_platform_filter_narrows_breakdowns(self, client, state):
        d = client.get(f"{API}/reports/ecommerce", params={"platform_id": state["platform_id"]},
                       timeout=90).json()
        assert len(d["platform_rows"]) == 1, d["platform_rows"]
        assert d["platform_rows"][0]["orders"] == 1
        assert d["platform_rows"][0]["revenue"] == 2000
        assert d["summary"]["total_orders"] == 1
        assert d["summary"]["total_revenue"] == 2000
        # the order was cancelled -> counted as a return? cancelled is not returned/refunded
        assert d["monthly_rows"] == [{"month": "2026-06", "revenue": 2000.0, "units": 2.0, "orders": 1}], d["monthly_rows"]

    def test_category_filter(self, client, state):
        cat = state.get("item_category")
        if not cat:
            pytest.skip("test item has no category")
        d = client.get(f"{API}/reports/ecommerce",
                       params={"platform_id": state["platform_id"], "category": cat}, timeout=90).json()
        assert d["summary"]["total_orders"] == 1, d["summary"]
        d2 = client.get(f"{API}/reports/ecommerce",
                        params={"platform_id": state["platform_id"], "category": "NoSuchCategory51"},
                        timeout=90).json()
        assert d2["rows"] == [] and d2["platform_rows"] == []
        assert d2["summary"]["total_revenue"] == 0


# ═══════════ Terms & Conditions — active invoice template cleanup ═══════════
class TestTermsTemplates:
    def test_active_invoice_template_is_standard_not_test(self, client):
        r = client.get(f"{API}/terms", timeout=60)
        assert r.status_code == 200, r.text[:300]
        tpls = r.json()
        active = [t for t in tpls if t.get("is_active") and t.get("category") == "invoice"]
        assert len(active) == 1, f"expected exactly 1 active invoice template, got {[t['title'] for t in active]}"
        assert not active[0]["title"].startswith("TEST_"), f"stale TEST template still active: {active[0]['title']}"
        assert active[0]["title"] == "Standard Invoice Terms", active[0]["title"]

    def test_no_test_templates_remain(self, client):
        tpls = client.get(f"{API}/terms", timeout=60).json()
        leftovers = [t["title"] for t in tpls if t["title"].startswith("TEST_")]
        assert not leftovers, f"stale TEST_ templates still present: {leftovers}"

    def test_active_quotation_template_exists(self, client):
        tpls = client.get(f"{API}/terms", timeout=60).json()
        active = [t for t in tpls if t.get("is_active") and t.get("category") == "quotation"]
        assert len(active) == 1, f"expected 1 active quotation template, got {[t['title'] for t in active]}"
        assert "version" in active[0]

    def test_active_endpoint_matches_per_category(self, client):
        inv = client.get(f"{API}/terms/active", params={"category": "invoice"}, timeout=60)
        quo = client.get(f"{API}/terms/active", params={"category": "quotation"}, timeout=60)
        assert inv.status_code == 200 and quo.status_code == 200
        assert "TEST_" not in inv.json().get("title", "")
        assert inv.json().get("title") == "Standard Invoice Terms"
        assert quo.json().get("title") and quo.json().get("version")


# ═══════════ Cleanup ═══════════
class TestCleanup:
    def test_cleanup(self, client, state):
        if state.get("assignment_id"):
            client.delete(f"{API}/partners/assignments/{state['assignment_id']}", timeout=60)
        if state.get("partner_id"):
            client.delete(f"{API}/partners/{state['partner_id']}", timeout=60)
        if state.get("order_id"):
            client.delete(f"{API}/ecommerce/orders/{state['order_id']}", timeout=60)
        if state.get("listing_id"):
            client.delete(f"{API}/ecommerce/listings/{state['listing_id']}", timeout=60)
        if state.get("platform_id"):
            client.delete(f"{API}/ecommerce/platforms/{state['platform_id']}", timeout=60)
