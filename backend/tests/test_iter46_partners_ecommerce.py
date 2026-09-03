"""Iteration 46 e2e: Partners (labour/subcontractor), Ecommerce, reports, CEO dashboard, T&C categories."""
import os
import re
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def creds():
    p = Path("/app/memory/test_credentials.md")
    c = p.read_text(encoding="utf-8")
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
    # Backend issues an httpOnly session cookie; requests.Session keeps it.
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    else:
        assert s.cookies, "no token and no session cookie returned by /auth/login"
    return s


@pytest.fixture(scope="session")
def state():
    return {}


# ═══════════ Partners module ═══════════
class TestPartners:
    def test_list_partners(self, client):
        r = client.get(f"{API}/partners", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), list)

    def test_create_partner_with_rate_card(self, client, state):
        payload = {
            "partner_type": "external_subcontractor",
            "name": f"TEST_Partner_{uuid.uuid4().hex[:6]}",
            "company_name": "TEST Installs Pvt Ltd",
            "phone": "9990001111",
            "specialities": ["on-grid", "electrical"],
            "retention_pct": 10,
            "rate_card": [
                {"activity": "Structure Fabrication per kW", "unit": "kW", "rate": 2000, "effective_from": "2024-01-01"},
                {"activity": "Cable Laying", "unit": "meter", "rate": 50, "effective_from": "2024-01-01"},
            ],
        }
        r = client.post(f"{API}/partners", json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        assert "id" in d and "_id" not in d
        assert d["name"] == payload["name"]
        assert len(d["rate_card"]) == 2
        assert d["retention_pct"] == 10
        state["partner_id"] = d["id"]
        state["partner_name"] = d["name"]

        # GET back
        g = client.get(f"{API}/partners/{d['id']}", timeout=60)
        assert g.status_code == 200, g.text[:300]
        gd = g.json()
        assert gd["name"] == payload["name"]
        assert gd["lifetime_business"] == 0
        assert gd["active_job_count"] == 0
        assert "scorecard" in gd and "assignments" in gd and "payments" in gd

    def test_partner_appears_in_list(self, client, state):
        r = client.get(f"{API}/partners", timeout=60)
        assert r.status_code == 200
        assert any(p["id"] == state["partner_id"] for p in r.json())

    def test_invalid_partner_id_400(self, client):
        r = client.get(f"{API}/partners/not-an-oid", timeout=60)
        assert r.status_code == 400, r.status_code


class TestAssignments:
    def test_pick_project(self, client, state):
        r = client.get(f"{API}/projects", timeout=90)
        assert r.status_code == 200, r.text[:300]
        projects = r.json()
        if isinstance(projects, dict):
            projects = projects.get("projects") or projects.get("items") or []
        assert projects, "no projects available to assign"
        approved = [p for p in projects if p.get("status") in ("approved", "completed")] or projects
        state["project_id"] = approved[0].get("id") or approved[0].get("_id")
        assert state["project_id"]

    def test_project_scope_hint(self, client, state):
        r = client.get(f"{API}/partners/project-scope/{state['project_id']}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert "system_size_kw" in r.json()

    def test_create_assignment_pricing(self, client, state):
        payload = {
            "project_id": state["project_id"],
            "expected_completion": "2026-08-01",
            "activities": [{"activity": "Structure Fabrication per kW", "quantity": 5}],
        }
        r = client.post(f"{API}/partners/{state['partner_id']}/assignments", json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        assert d["gross_amount"] == 10000, d
        assert d["retention_held"] == 1000, d
        assert d["balance_due"] == 10000
        assert d["status"] == "assigned"
        state["assignment_id"] = d["id"]

    def test_assignment_bad_activity_400(self, client, state):
        r = client.post(f"{API}/partners/{state['partner_id']}/assignments", json={
            "project_id": state["project_id"],
            "activities": [{"activity": "Nonexistent Activity", "quantity": 1}],
        }, timeout=60)
        assert r.status_code == 400, r.status_code
        assert "rate-card" in r.json().get("detail", "").lower()

    def test_by_project_endpoint(self, client, state):
        """NEW endpoint powering the inline ProjectPartnerCard."""
        r = client.get(f"{API}/partners/assignments/by-project/{state['project_id']}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        mine = [a for a in rows if a["id"] == state["assignment_id"]]
        assert mine, "created assignment missing from by-project listing"
        a = mine[0]
        assert a["partner_name"] == state["partner_name"]
        assert a["gross_amount"] == 10000
        assert a["balance_due"] == 10000
        assert "_id" not in a

    def test_by_project_unknown_project_returns_empty(self, client):
        r = client.get(f"{API}/partners/assignments/by-project/{uuid.uuid4().hex[:24]}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert r.json() == []

    def test_assignment_shows_on_partner_detail(self, client, state):
        r = client.get(f"{API}/partners/{state['partner_id']}", timeout=60)
        assert r.status_code == 200
        d = r.json()
        ids = [a["id"] for a in d["assignments"]]
        assert state["assignment_id"] in ids
        assert d["lifetime_business"] == 10000
        assert d["active_job_count"] == 1
        # running balance = gross - paid - retention held open
        assert d["running_balance"] == 9000, d["running_balance"]


class TestPayments:
    def test_record_advance_payment(self, client, state):
        r = client.post(f"{API}/partners/{state['partner_id']}/payments", json={
            "assignment_id": state["assignment_id"], "amount": 3000, "type": "advance",
            "mode": "bank_transfer", "reference": "TEST-ADV-1",
        }, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        assert r.json()["amount"] == 3000

        a = client.get(f"{API}/partners/assignments/{state['assignment_id']}", timeout=60)
        assert a.status_code == 200
        ad = a.json()
        assert ad["balance_due"] == 7000, ad["balance_due"]
        assert ad["advance_paid"] == 3000

    def test_payment_listed(self, client, state):
        r = client.get(f"{API}/partners/{state['partner_id']}/payments", timeout=60)
        assert r.status_code == 200
        pays = r.json()
        assert any(p["reference"] == "TEST-ADV-1" and p["amount"] == 3000 for p in pays)

    def test_payment_posts_into_account_entries(self, client, state):
        r = client.get(f"{API}/accounts", params={"entry_type": "partner_payment"}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        rows = data if isinstance(data, list) else (data.get("entries") or data.get("items") or [])
        assert any(state["assignment_id"] in (e.get("description") or "") for e in rows), \
            "partner_payment ledger entry not found in account_entries"

    def test_retention_release_blocked_without_commissioning(self, client, state):
        r = client.post(f"{API}/partners/assignments/{state['assignment_id']}/release-retention", timeout=60)
        assert r.status_code == 400, f"expected 400 business-rule block, got {r.status_code}: {r.text[:300]}"
        assert "DISCOM" in r.json().get("detail", ""), r.json()

    def test_retention_payment_type_rejected_on_payments_endpoint(self, client, state):
        r = client.post(f"{API}/partners/{state['partner_id']}/payments", json={
            "assignment_id": state["assignment_id"], "amount": 100, "type": "retention_release",
        }, timeout=60)
        assert r.status_code == 400


# ═══════════ Ecommerce module ═══════════
class TestEcommerce:
    def test_platforms_list(self, client):
        r = client.get(f"{API}/ecommerce/platforms", timeout=60)
        assert r.status_code == 200, r.text[:300]

    def test_create_platform(self, client, state):
        name = f"TEST_Amazon_{uuid.uuid4().hex[:5]}"
        r = client.post(f"{API}/ecommerce/platforms", json={
            "name": name, "platform_type": "marketplace", "commission_pct": 10, "seller_id": "TESTSELLER",
        }, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        assert d["name"] == name and d["commission_pct"] == 10
        state["platform_id"] = d["id"]

    def test_pick_inventory_item(self, client, state):
        r = client.get(f"{API}/inventory/items", timeout=90)
        assert r.status_code == 200, r.text[:300]
        items = r.json()
        items = items if isinstance(items, list) else items.get("items", [])
        cand = [i for i in items if (i.get("quantity") or 0) >= 5]
        assert cand, "no inventory item with stock >= 5"
        state["item_id"] = cand[0]["id"]
        state["item_qty_before"] = cand[0]["quantity"]

    def test_create_listing(self, client, state):
        r = client.post(f"{API}/ecommerce/listings", json={
            "platform_id": state["platform_id"], "inventory_item_id": state["item_id"],
            "platform_sku": f"TEST-SKU-{uuid.uuid4().hex[:5]}", "listed_price": 1000, "status": "live",
        }, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        assert d["listed_price"] == 1000
        state["listing_id"] = d["id"]

        g = client.get(f"{API}/ecommerce/listings", timeout=60)
        assert g.status_code == 200
        assert any(x["id"] == state["listing_id"] for x in g.json())

    def test_create_order_computes_and_decrements_stock(self, client, state):
        qty = 2
        r = client.post(f"{API}/ecommerce/orders", json={
            "platform_id": state["platform_id"],
            "platform_order_id": f"TEST-ORD-{uuid.uuid4().hex[:6]}",
            "order_date": "2026-07-01",
            "shipping_cost": 50,
            "lines": [{"listing_id": state["listing_id"], "inventory_item_id": state["item_id"],
                       "quantity": qty, "sold_price": 1000}],
        }, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        assert d["order_total"] == 2000, d
        assert d["commission_total"] == 200, d
        assert d["net_payout"] == 1750, d
        assert d["order_status"] == "placed"
        state["order_id"] = d["id"]

        it = client.get(f"{API}/inventory/items/{state['item_id']}", timeout=60)
        assert it.status_code == 200, it.text[:300]
        assert it.json()["quantity"] == state["item_qty_before"] - qty, \
            f"stock not decremented: {it.json()['quantity']} vs {state['item_qty_before']}"

    def test_order_listed(self, client, state):
        r = client.get(f"{API}/ecommerce/orders", timeout=60)
        assert r.status_code == 200
        mine = [o for o in r.json() if o["id"] == state["order_id"]]
        assert mine
        assert mine[0]["platform_name"].startswith("TEST_Amazon")

    def test_duplicate_platform_order_id_rejected(self, client, state):
        o = client.get(f"{API}/ecommerce/orders", timeout=60).json()
        mine = [x for x in o if x["id"] == state["order_id"]][0]
        r = client.post(f"{API}/ecommerce/orders", json={
            "platform_id": state["platform_id"], "platform_order_id": mine["platform_order_id"],
            "order_date": "2026-07-02",
            "lines": [{"inventory_item_id": state["item_id"], "quantity": 1, "sold_price": 1000}],
        }, timeout=60)
        assert r.status_code == 400, r.status_code

    def test_insufficient_stock_rejected(self, client, state):
        r = client.post(f"{API}/ecommerce/orders", json={
            "platform_id": state["platform_id"], "platform_order_id": f"TEST-ORD-{uuid.uuid4().hex[:6]}",
            "order_date": "2026-07-02",
            "lines": [{"inventory_item_id": state["item_id"], "quantity": 999999, "sold_price": 1000}],
        }, timeout=60)
        assert r.status_code == 400, r.status_code
        assert "stock" in r.json().get("detail", "").lower()

    def test_return_restores_stock(self, client, state):
        r = client.put(f"{API}/ecommerce/orders/{state['order_id']}", json={
            "order_status": "returned", "return_reason": "TEST return"}, timeout=60)
        assert r.status_code == 200, r.text[:400]
        assert r.json()["order_status"] == "returned"
        it = client.get(f"{API}/inventory/items/{state['item_id']}", timeout=60)
        assert it.status_code == 200
        assert it.json()["quantity"] == state["item_qty_before"], \
            f"stock not restored: {it.json()['quantity']} vs {state['item_qty_before']}"

    def test_double_return_does_not_double_restore(self, client, state):
        r = client.put(f"{API}/ecommerce/orders/{state['order_id']}", json={"order_status": "returned"}, timeout=60)
        assert r.status_code == 200
        it = client.get(f"{API}/inventory/items/{state['item_id']}", timeout=60)
        assert it.json()["quantity"] == state["item_qty_before"], "stock double-restored on repeat return"

    def test_reconciliation(self, client, state):
        r = client.get(f"{API}/ecommerce/reconciliation", timeout=60)
        assert r.status_code == 200, r.text[:300]


# ═══════════ Reports + CEO dashboard ═══════════
class TestReportsAndCeo:
    def test_partner_performance_report(self, client, state):
        r = client.get(f"{API}/reports/partner_performance", timeout=90)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert isinstance(d, dict) and d, "empty partner_performance report"
        blob = str(d)
        assert state["partner_name"] in blob, "created partner missing from partner_performance report"

    def test_ecommerce_report(self, client):
        r = client.get(f"{API}/reports/ecommerce", timeout=90)
        assert r.status_code == 200, r.text[:400]
        assert isinstance(r.json(), dict) and r.json()

    def test_ceo_dashboard_ecommerce_section(self, client):
        r = client.get(f"{API}/dashboard/ceo", timeout=120)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        ec = d.get("ecommerce")
        assert ec is not None, f"CEO dashboard has no separate 'ecommerce' section. keys={list(d.keys())}"
        for k in ("revenue", "commission", "net_revenue"):
            assert k in ec, f"missing {k} in ceo.ecommerce: {ec}"


# ═══════════ Terms & Conditions categories ═══════════
class TestTerms:
    @pytest.mark.parametrize("category", ["quotation", "invoice", "amc"])
    def test_active_terms_per_category(self, client, category):
        r = client.get(f"{API}/terms/active", params={"language": "en", "category": category}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("category") == category, d
        assert d.get("content")

    def test_terms_list_has_category(self, client):
        r = client.get(f"{API}/terms", timeout=60)
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        rows = rows if isinstance(rows, list) else rows.get("terms", [])
        if rows:
            assert all("category" in t for t in rows), "terms rows missing category field"

    def test_create_activate_invoice_template_changes_active(self, client, state):
        prev = client.get(f"{API}/terms/active", params={"language": "en", "category": "invoice"}, timeout=60).json()
        state["prev_invoice_terms_id"] = prev.get("id")
        title = f"TEST_Invoice_Terms_{uuid.uuid4().hex[:5]}"
        r = client.post(f"{API}/terms", json={
            "title": title, "content": "<ol><li>TEST invoice clause marker</li></ol>",
            "category": "invoice", "language": "en", "is_active": True,
        }, timeout=60)
        assert r.status_code in (200, 201), r.text[:400]
        state["terms_id"] = r.json().get("id")
        # New templates are created inactive by design; activation is an explicit PUT.
        up = client.put(f"{API}/terms/{state['terms_id']}", json={"is_active": True}, timeout=60)
        assert up.status_code == 200, up.text[:300]
        a = client.get(f"{API}/terms/active", params={"language": "en", "category": "invoice"}, timeout=60)
        assert a.status_code == 200
        assert a.json()["title"] == title, f"active invoice terms did not switch: {a.json()['title']}"
        assert "TEST invoice clause marker" in a.json()["content"]
        # quotation category must be unaffected
        q = client.get(f"{API}/terms/active", params={"language": "en", "category": "quotation"}, timeout=60)
        assert q.json()["title"] != title, "activating invoice terms leaked into quotation category"


# ═══════════ RBAC ═══════════
class TestRbac:
    def test_unauthenticated_blocked(self, state):
        s = requests.Session()
        for url in [f"{API}/partners", f"{API}/ecommerce/platforms", f"{API}/ecommerce/orders"]:
            r = s.get(url, timeout=60)
            assert r.status_code in (401, 403), f"{url} -> {r.status_code}"

    def test_staff_cannot_create_partner(self, client, state):
        """Create a staff user then verify 403 on partner/platform writes."""
        email = f"TEST_staff_{uuid.uuid4().hex[:6]}@example.com"
        # NOTE: use a throwaway session — /auth/register sets auth cookies for the NEW
        # user, which would otherwise downgrade the admin session in-place.
        reg_sess = requests.Session()
        reg_sess.headers.update({"Content-Type": "application/json"})
        reg = reg_sess.post(f"{API}/auth/register", json={
            "email": email, "password": "Staff@1234", "name": "TEST Staff", "role": "staff",
        }, timeout=60)
        if reg.status_code not in (200, 201):
            pytest.skip(f"could not create staff user: {reg.status_code} {reg.text[:200]}")
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        lr = s.post(f"{API}/auth/login", json={"email": email, "password": "Staff@1234"}, timeout=60)
        assert lr.status_code == 200, lr.text[:300]
        tok = lr.json().get("access_token") or lr.json().get("token")
        if tok:
            s.headers.update({"Authorization": f"Bearer {tok}"})
        r1 = s.post(f"{API}/partners", json={"name": "TEST_staff_partner"}, timeout=60)
        assert r1.status_code == 403, f"staff created partner! {r1.status_code}"
        r2 = s.post(f"{API}/ecommerce/platforms", json={"name": "TEST_staff_platform"}, timeout=60)
        assert r2.status_code == 403, f"staff created platform! {r2.status_code}"
        r3 = s.post(f"{API}/ecommerce/listings", json={
            "platform_id": state.get("platform_id", "x"), "inventory_item_id": state.get("item_id", "x"),
            "platform_sku": "X", "listed_price": 1}, timeout=60)
        assert r3.status_code == 403, f"staff created listing! {r3.status_code}"
        r4 = s.get(f"{API}/reports/partner_performance", timeout=60)
        assert r4.status_code == 403


# ═══════════ Cleanup ═══════════
def test_zz_cleanup(client, state):
    print("CLEANUP state keys:", sorted(state.keys()))
    if state.get("terms_id"):
        client.delete(f"{API}/terms/{state['terms_id']}", timeout=60)
    if state.get("prev_invoice_terms_id"):
        client.put(f"{API}/terms/{state['prev_invoice_terms_id']}", json={"is_active": True}, timeout=60)
    if state.get("listing_id"):
        client.delete(f"{API}/ecommerce/listings/{state['listing_id']}", timeout=60)
    if state.get("platform_id"):
        r = client.delete(f"{API}/ecommerce/platforms/{state['platform_id']}", timeout=60)
        print("cleanup platform:", r.status_code, r.text[:120])
    if state.get("partner_id"):
        r = client.delete(f"{API}/partners/{state['partner_id']}", timeout=60)
        print("cleanup partner:", r.status_code, r.text[:120])
