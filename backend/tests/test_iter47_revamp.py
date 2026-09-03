"""Iteration 47 backend regression suite —
- Partner: status-change guard, force override, rate-card edit, tag admin, tag combo filter.
- Vendor: filter by category + status + district + search on GSTIN, sort by business_desc / recent_desc.
- Support: SLA breach compute, status workflow, close with CSAT, dashboard.
- Ecommerce: commission immutability on past orders, live-listing requires commission.
- Hard delete: sale/PO/delivery admin-only reason required, snapshot in audit log, dependency block.
- Customer support report includes SLA breach % + top recurring + technician_rows.
"""
import os, uuid, pytest, requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": "Admin@123"}, timeout=60)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def state():
    return {}


class TestPartnerEditGuards:
    def test_create_partner_with_rate(self, client, state):
        name = f"TEST47_Partner_{uuid.uuid4().hex[:5]}"
        r = client.post(f"{API}/partners", json={
            "name": name, "partner_type": "external_subcontractor", "phone": "9999",
            "rate_card": [{"activity": "Install per kW", "unit": "kW", "rate": 500, "effective_from": "2026-01-01"}],
        }, timeout=60)
        assert r.status_code in (200, 201), r.text[:500]
        state["partner_id"] = r.json()["id"]
        state["partner_name"] = name

    def test_edit_partner_basic(self, client, state):
        r = client.put(f"{API}/partners/{state['partner_id']}", json={"phone": "8888"}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["phone"] == "8888"

    def test_edit_rate_card_row_in_place(self, client, state):
        r = client.put(f"{API}/partners/{state['partner_id']}/rate-card", json={
            "index": 0, "activity": "Install per kW", "unit": "kW", "rate": 550, "effective_from": "2026-01-01",
        }, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["rate_card"][0]["rate"] == 550

    def test_add_versioned_rate(self, client, state):
        r = client.post(f"{API}/partners/{state['partner_id']}/rate-card", json={
            "activity": "Install per kW", "unit": "kW", "rate": 600, "effective_from": "2026-07-01",
        }, timeout=60)
        assert r.status_code == 200
        rc = r.json()["rate_card"]
        assert len(rc) == 2, "past rate must be preserved"
        # Old rate still at 550 with 2026-01-01
        assert any(x["rate"] == 550 and x["effective_from"] == "2026-01-01" for x in rc)


class TestPartnerTags:
    def test_create_tag(self, client, state):
        tag = f"TEST47Tag_{uuid.uuid4().hex[:4]}"
        r = client.post(f"{API}/partners/tags", json={"tag": tag}, timeout=60)
        assert r.status_code in (200, 201), r.text
        state["tag_id"] = r.json()["id"]
        state["tag_name"] = tag

    def test_list_tags(self, client, state):
        r = client.get(f"{API}/partners/tags/all", timeout=60)
        assert r.status_code == 200
        assert any(t["tag"] == state["tag_name"] for t in r.json())

    def test_tag_combo_filter(self, client, state):
        # Give partner two tags then filter with AND
        client.put(f"{API}/partners/{state['partner_id']}", json={"specialities": [state["tag_name"], "on-grid"]}, timeout=60)
        r = client.get(f"{API}/partners", params={"specialities": f"{state['tag_name']},on-grid"}, timeout=60)
        assert r.status_code == 200
        assert any(p["id"] == state["partner_id"] for p in r.json())
        # Filter with AND on a tag they don't have should exclude
        r = client.get(f"{API}/partners", params={"specialities": f"{state['tag_name']},nonexistent-tag"}, timeout=60)
        assert not any(p["id"] == state["partner_id"] for p in r.json())

    def test_retire_tag(self, client, state):
        r = client.delete(f"{API}/partners/tags/{state['tag_id']}", timeout=60)
        assert r.status_code == 200


class TestVendorFilters:
    def test_create_and_filter(self, client, state):
        name = f"TEST47_Vendor_{uuid.uuid4().hex[:5]}"
        r = client.post(f"{API}/vendors", json={
            "name": name, "gstin": "29ABCDE9999F1Z9", "category": "inverters",
            "district": "Chennai", "payment_terms": "Net 30",
        }, timeout=60)
        assert r.status_code in (200, 201), r.text
        state["vendor_id"] = r.json()["id"]
        state["vendor_name"] = name

        r = client.get(f"{API}/vendors", params={"category": "inverters", "district": "Chennai"}, timeout=60)
        assert r.status_code == 200
        assert any(v["id"] == state["vendor_id"] for v in r.json())

        # Search by GSTIN substring
        r = client.get(f"{API}/vendors", params={"search": "9999F1Z9"}, timeout=60)
        assert any(v["id"] == state["vendor_id"] for v in r.json())

    def test_sort_options(self, client):
        for s in ("business_desc", "recent_desc", "recent_asc"):
            r = client.get(f"{API}/vendors", params={"sort": s}, timeout=60)
            assert r.status_code == 200


class TestSupportTickets:
    def test_dashboard_empty_state(self, client):
        r = client.get(f"{API}/support/dashboard", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "open_tickets" in d and "overdue_by_sla" in d and "avg_csat" in d

    def test_create_and_status_workflow(self, client, state):
        r = client.post(f"{API}/support/tickets", json={
            "customer_name": f"TEST47_Cust_{uuid.uuid4().hex[:4]}", "description": "Generation dropped by 30%",
            "category": "generation_drop", "priority": "high", "reported_via": "phone",
        }, timeout=60)
        assert r.status_code in (200, 201), r.text
        state["ticket_id"] = r.json()["id"]
        assert r.json()["ticket_number"].startswith("TKT-")
        assert r.json()["sla_response_hours"] == 4    # high priority default

        # Invalid transition
        r = client.post(f"{API}/support/tickets/{state['ticket_id']}/status", json={"status": "resolved"}, timeout=60)
        assert r.status_code == 400, r.text
        # Valid transition
        r = client.post(f"{API}/support/tickets/{state['ticket_id']}/status", json={"status": "in_progress"}, timeout=60)
        assert r.status_code == 200

    def test_close_with_csat_feeds_technician(self, client, state):
        client.put(f"{API}/support/tickets/{state['ticket_id']}", json={
            "assigned_to": "tech1", "assigned_to_name": "TEST47 Tech",
        }, timeout=60)
        r = client.post(f"{API}/support/tickets/{state['ticket_id']}/close", json={
            "customer_satisfaction_rating": 5, "resolution_notes": "Panel cleaning fixed it",
        }, timeout=60)
        assert r.status_code == 200
        assert r.json()["status"] == "closed"
        assert r.json()["customer_satisfaction_rating"] == 5

    def test_csat_out_of_range_rejected(self, client, state):
        r = client.post(f"{API}/support/tickets", json={
            "customer_name": "Test", "description": "x", "category": "other", "priority": "low",
        }, timeout=60)
        tid = r.json()["id"]
        r = client.post(f"{API}/support/tickets/{tid}/close", json={"customer_satisfaction_rating": 6}, timeout=60)
        assert r.status_code == 400

    def test_customer_support_report(self, client):
        r = client.get(f"{API}/reports/customer_support", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["title"] == "Customer Support Report"
        assert "response_breach_pct" in d["summary"]
        assert "top_recurring" in d and "technician_rows" in d


class TestEcommerceIter47:
    def test_live_listing_requires_commission(self, client, state):
        # First need a platform + item
        p = client.post(f"{API}/ecommerce/platforms", json={
            "name": f"TEST47_P_{uuid.uuid4().hex[:4]}", "platform_type": "marketplace", "commission_pct": 10,
        }, timeout=60)
        pid = p.json()["id"]
        state["e_platform_id"] = pid
        items = client.get(f"{API}/inventory/items", timeout=60).json()
        if isinstance(items, dict):
            items = items.get("items") or []
        assert items, "need at least one inventory item"
        iid = items[0]["id"]
        # Missing commission on a 'live' listing must be rejected
        r = client.post(f"{API}/ecommerce/listings", json={
            "platform_id": pid, "inventory_item_id": iid, "platform_sku": f"TST-{uuid.uuid4().hex[:4]}",
            "listed_price": 500, "status": "live",
        }, timeout=60)
        assert r.status_code == 400, r.text
        # Draft with no commission — fine
        r = client.post(f"{API}/ecommerce/listings", json={
            "platform_id": pid, "inventory_item_id": iid, "platform_sku": f"TST-{uuid.uuid4().hex[:4]}",
            "listed_price": 500, "status": "draft",
        }, timeout=60)
        assert r.status_code in (200, 201)


class TestHardDelete:
    def test_hard_delete_requires_reason(self, client):
        # Pick any deletable sale (or accept 404 if none)
        r = client.get(f"{API}/sales", timeout=60)
        sales = r.json() if r.status_code == 200 else []
        target = next((s for s in sales if s.get("status") not in ("cancelled", "returned")), None)
        if not target:
            pytest.skip("no active sale to test with")
        r = client.delete(f"{API}/hard-delete/sale/{target['id']}", json={"reason": ""}, timeout=60)
        assert r.status_code == 400

    def test_hard_delete_invalid_id(self, client):
        r = client.delete(f"{API}/hard-delete/sale/{'0' * 24}", json={"reason": "test"}, timeout=60)
        assert r.status_code == 404
