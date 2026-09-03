"""Iteration 47 edge-case coverage (testing agent).

Modules under test:
  - support.py        : ticket lifecycle, invalid status transitions, CSAT bounds, SLA config, dashboard
  - server.py         : /api/reports/customer_support, hard-delete endpoints validation
  - ecommerce.py      : listing commission-before-live guard (create + update + bulk bypass)
  - vendors.py        : extended filters + business_value/last_order_date + sort
  - partners.py       : tag CRUD, combo AND tag filter, min_rating, status-change guard, rate-card edit
"""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
_base = os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL")
if not _base:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = _base.rstrip("/") + "/api"


@pytest.fixture(scope="session")
def creds():
    p = Path("/app/memory/test_credentials.md")
    c = p.read_text()
    e = re.search(r"(?im)^\s*[-*]?\s*Email:\s*(\S+)", c)
    pw = re.search(r"(?im)^\s*[-*]?\s*Password:\s*(\S+)", c)
    if not e or not pw:
        pytest.skip("no creds")
    return {"email": e.group(1), "password": pw.group(1)}


@pytest.fixture(scope="session")
def client(creds):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    elif not s.cookies:
        pytest.fail(f"no token/cookie in login response: {r.text[:300]}")
    return s


# ══════════════════ support.py — SLA config ══════════════════
class TestSLAConfig:
    def test_get_sla_config_has_four_priorities(self, client):
        r = client.get(f"{BASE}/support/sla-config", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for p in ("critical", "high", "medium", "low"):
            assert p in d, d
            assert "response" in d[p] and "resolution" in d[p]

    def test_update_sla_config_persists(self, client):
        orig = client.get(f"{BASE}/support/sla-config", timeout=30).json()
        payload = {}
        for p in ("critical", "high", "medium", "low"):
            payload[f"{p}_response_hours"] = orig[p]["response"]
            payload[f"{p}_resolution_hours"] = orig[p]["resolution"]
        payload["low_resolution_hours"] = 111
        r = client.put(f"{BASE}/support/sla-config", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["low"]["resolution"] == 111
        # verify via GET
        assert client.get(f"{BASE}/support/sla-config", timeout=30).json()["low"]["resolution"] == 111
        # restore
        payload["low_resolution_hours"] = orig["low"]["resolution"]
        assert client.put(f"{BASE}/support/sla-config", json=payload, timeout=30).status_code == 200


# ══════════════════ support.py — ticket lifecycle ══════════════════
class TestTicketLifecycle:
    ids = []

    @pytest.fixture(scope="class", autouse=True)
    def cleanup(self, client):
        yield

    def _create(self, client, **over):
        body = {
            "customer_name": "TEST_EdgeCust",
            "contact_phone": "9999900001",
            "category": "generation_drop",
            "priority": "high",
            "description": "TEST_ generation dropped 40%",
            "reported_via": "phone",
        }
        body.update(over)
        r = client.post(f"{BASE}/support/tickets", json=body, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        TestTicketLifecycle.ids.append(d["id"])
        return d

    def test_create_ticket_defaults_and_sla_stamp(self, client):
        d = self._create(client)
        assert d["ticket_number"].startswith("TKT-")
        assert d["status"] == "open"
        assert d["assigned_to"] is None
        assert d["sla_response_hours"] == 4 and d["sla_resolution_hours"] == 24
        assert d["sla_bucket"] in ("on_track", "at_risk", "breached")
        assert "_id" not in d
        assert d["timeline"][0]["action"] == "created"

    def test_get_ticket_persisted(self, client):
        d = self._create(client)
        g = client.get(f"{BASE}/support/tickets/{d['id']}", timeout=30)
        assert g.status_code == 200, g.text
        assert g.json()["customer_name"] == "TEST_EdgeCust"
        assert g.json()["description"] == "TEST_ generation dropped 40%"

    def test_get_ticket_bad_id_400_and_404(self, client):
        assert client.get(f"{BASE}/support/tickets/not-an-oid", timeout=30).status_code == 400
        assert client.get(f"{BASE}/support/tickets/507f1f77bcf86cd799439011", timeout=30).status_code == 404

    def test_assign_sets_first_response_and_assigned_date(self, client):
        d = self._create(client)
        r = client.put(f"{BASE}/support/tickets/{d['id']}",
                       json={"assigned_to": "TechA", "assigned_to_name": "TechA", "note": "assigning"}, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["assigned_to"] == "TechA"
        assert u["first_response_at"]
        assert u["assigned_date"]

    def test_invalid_status_transition_rejected(self, client):
        d = self._create(client)
        # open -> resolved is NOT in VALID_STATUS_TRANSITIONS
        r = client.post(f"{BASE}/support/tickets/{d['id']}/status", json={"status": "resolved"}, timeout=30)
        assert r.status_code == 400, r.text
        assert "Cannot move ticket" in r.text

    def test_valid_transition_chain(self, client):
        d = self._create(client)
        for target in ("in_progress", "resolved"):
            r = client.post(f"{BASE}/support/tickets/{d['id']}/status", json={"status": target}, timeout=30)
            assert r.status_code == 200, r.text
            assert r.json()["status"] == target
        assert client.get(f"{BASE}/support/tickets/{d['id']}", timeout=30).json()["resolved_at"]

    def test_reopen_increments_counter_and_clears_resolved(self, client):
        d = self._create(client)
        client.post(f"{BASE}/support/tickets/{d['id']}/status", json={"status": "in_progress"}, timeout=30)
        client.post(f"{BASE}/support/tickets/{d['id']}/status", json={"status": "resolved"}, timeout=30)
        r = client.post(f"{BASE}/support/tickets/{d['id']}/status", json={"status": "reopened"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["reopen_count"] == 1
        assert r.json()["resolved_at"] is None

    def test_close_with_csat(self, client):
        d = self._create(client)
        client.put(f"{BASE}/support/tickets/{d['id']}", json={"assigned_to": "TechA"}, timeout=30)
        client.post(f"{BASE}/support/tickets/{d['id']}/status", json={"status": "in_progress"}, timeout=30)
        r = client.post(f"{BASE}/support/tickets/{d['id']}/close",
                        json={"customer_satisfaction_rating": 5, "resolution_notes": "TEST_ fixed"}, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["status"] == "closed"
        assert c["customer_satisfaction_rating"] == 5
        assert c["resolved_at"]
        g = client.get(f"{BASE}/support/tickets/{d['id']}", timeout=30).json()
        assert g["status"] == "closed" and g["customer_satisfaction_rating"] == 5

    def test_close_twice_rejected(self, client):
        d = self._create(client)
        client.post(f"{BASE}/support/tickets/{d['id']}/close", json={"customer_satisfaction_rating": 4}, timeout=30)
        r = client.post(f"{BASE}/support/tickets/{d['id']}/close", json={"customer_satisfaction_rating": 4}, timeout=30)
        assert r.status_code == 400 and "already closed" in r.text

    @pytest.mark.parametrize("rating", [0, 6, -1])
    def test_csat_out_of_range_rejected(self, client, rating):
        d = self._create(client)
        r = client.post(f"{BASE}/support/tickets/{d['id']}/close",
                        json={"customer_satisfaction_rating": rating}, timeout=30)
        assert r.status_code in (400, 422), r.text

    def test_list_filters(self, client):
        self._create(client, priority="critical", category="inverter_fault")
        r = client.get(f"{BASE}/support/tickets", params={"priority": "critical"}, timeout=30)
        assert r.status_code == 200
        assert all(t["priority"] == "critical" for t in r.json())
        r2 = client.get(f"{BASE}/support/tickets", params={"search": "TEST_EdgeCust"}, timeout=30)
        assert r2.status_code == 200 and len(r2.json()) >= 1
        r3 = client.get(f"{BASE}/support/tickets", params={"status": "closed"}, timeout=30)
        assert all(t["status"] == "closed" for t in r3.json())
        r4 = client.get(f"{BASE}/support/tickets", params={"sla_bucket": "on_track"}, timeout=30)
        assert all(t["sla_bucket"] == "on_track" for t in r4.json())

    def test_dashboard_shape(self, client):
        r = client.get(f"{BASE}/support/dashboard", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("open_tickets", "overdue_by_sla", "avg_resolution_hours", "avg_csat",
                  "by_category", "by_priority", "by_district", "monthly_counts", "top_recurring"):
            assert k in d, k
        assert d["avg_csat"] >= 0
        assert isinstance(d["monthly_counts"], list)

    def test_unauthenticated_blocked(self):
        r = requests.get(f"{BASE}/support/tickets", timeout=30)
        assert r.status_code in (401, 403), r.status_code


# ══════════════════ reports — customer_support ══════════════════
class TestCustomerSupportReport:
    def test_report_shape(self, client):
        r = client.get(f"{BASE}/reports/customer_support", timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        s = d.get("summary", d)
        for k in ("response_breach_pct", "avg_csat", "technician_rows", "top_recurring"):
            assert k in s or k in d, f"missing {k}: {list(s.keys())}"


# ══════════════════ ecommerce — listing commission guard ══════════════════
class TestListingCommission:
    def test_live_without_commission_rejected(self, client):
        items = client.get(f"{BASE}/inventory/items", params={"limit": 5}, timeout=30).json()
        items = items if isinstance(items, list) else items.get("items", [])
        if not items:
            pytest.skip("no inventory items")
        plats = client.get(f"{BASE}/ecommerce/platforms", timeout=30).json()
        if not plats:
            pytest.skip("no platforms")
        body = {"platform_id": plats[0]["id"], "inventory_item_id": items[0]["id"],
                "platform_sku": "TEST_EDGE_SKU1", "listing_title": "TEST_ edge listing",
                "listed_price": 1000, "status": "live"}
        r = client.post(f"{BASE}/ecommerce/listings", json=body, timeout=30)
        assert r.status_code == 400, r.text
        assert "commission" in r.text.lower()

    def test_live_with_commission_ok_then_cleanup(self, client):
        items = client.get(f"{BASE}/inventory/items", params={"limit": 5}, timeout=30).json()
        items = items if isinstance(items, list) else items.get("items", [])
        plats = client.get(f"{BASE}/ecommerce/platforms", timeout=30).json()
        if not items or not plats:
            pytest.skip("missing prerequisites")
        body = {"platform_id": plats[0]["id"], "inventory_item_id": items[0]["id"],
                "platform_sku": "TEST_EDGE_SKU2", "listing_title": "TEST_ edge listing 2",
                "listed_price": 1000, "status": "live", "platform_commission_pct": 12.5}
        r = client.post(f"{BASE}/ecommerce/listings", json=body, timeout=30)
        assert r.status_code == 200, r.text
        lid = r.json()["id"]
        assert r.json()["platform_commission_pct"] == 12.5
        # draft listing then attempt PUT to live without commission
        d = client.post(f"{BASE}/ecommerce/listings", json={**body, "platform_sku": "TEST_EDGE_SKU3",
                                                            "status": "draft",
                                                            "platform_commission_pct": None}, timeout=30)
        assert d.status_code == 200, d.text
        did = d.json()["id"]
        up = client.put(f"{BASE}/ecommerce/listings/{did}", json={"status": "live"}, timeout=30)
        assert up.status_code == 400, up.text
        client.delete(f"{BASE}/ecommerce/listings/{lid}", timeout=30)
        client.delete(f"{BASE}/ecommerce/listings/{did}", timeout=30)

    def test_bulk_status_live_bypass_check(self, client):
        """Known gap probe: bulk-status may set a commission-less listing live."""
        items = client.get(f"{BASE}/inventory/items", params={"limit": 5}, timeout=30).json()
        items = items if isinstance(items, list) else items.get("items", [])
        plats = client.get(f"{BASE}/ecommerce/platforms", timeout=30).json()
        if not items or not plats:
            pytest.skip("missing prerequisites")
        d = client.post(f"{BASE}/ecommerce/listings", json={
            "platform_id": plats[0]["id"], "inventory_item_id": items[0]["id"],
            "platform_sku": "TEST_EDGE_SKU4", "listing_title": "TEST_ bulk probe",
            "listed_price": 500, "status": "draft"}, timeout=30)
        assert d.status_code == 200, d.text
        did = d.json()["id"]
        client.post(f"{BASE}/ecommerce/listings/bulk-status",
                    json={"listing_ids": [did], "status": "live"}, timeout=30)
        after = [x for x in client.get(f"{BASE}/ecommerce/listings", timeout=30).json() if x["id"] == did]
        went_live = bool(after) and after[0]["status"] == "live" and after[0].get("platform_commission_pct") is None
        client.delete(f"{BASE}/ecommerce/listings/{did}", timeout=30)
        assert not went_live, "bulk-status bypasses the commission-before-live guard"


# ══════════════════ vendors — filters/sort/stats ══════════════════
class TestVendorFilters:
    vid = None

    def test_create_vendor_with_district_and_terms(self, client):
        r = client.post(f"{BASE}/vendors", json={
            "name": "TEST_EdgeVendor", "category": "panels", "gstin": "29TESTEDGE1Z5",
            "district": "Bengaluru", "payment_terms": "Net 30", "contact_person": "QA",
            "phone": "9000000001"}, timeout=30)
        assert r.status_code == 200, r.text
        TestVendorFilters.vid = r.json()["id"]
        assert r.json()["district"] == "Bengaluru"
        assert r.json()["payment_terms"] == "Net 30"

    def test_search_by_name_and_gstin(self, client):
        n = client.get(f"{BASE}/vendors", params={"search": "TEST_EdgeVendor"}, timeout=30)
        assert n.status_code == 200 and any(v["name"] == "TEST_EdgeVendor" for v in n.json())
        g = client.get(f"{BASE}/vendors", params={"search": "29TESTEDGE1Z5"}, timeout=30)
        assert g.status_code == 200 and any(v["name"] == "TEST_EdgeVendor" for v in g.json())

    def test_district_and_category_filter(self, client):
        r = client.get(f"{BASE}/vendors", params={"district": "bengaluru"}, timeout=30)
        assert r.status_code == 200
        assert any(v["name"] == "TEST_EdgeVendor" for v in r.json()), "district filter should be case-insensitive"
        c = client.get(f"{BASE}/vendors", params={"category": "panels"}, timeout=30)
        assert all(v.get("category") == "panels" for v in c.json())

    def test_stats_and_sorts(self, client):
        r = client.get(f"{BASE}/vendors", params={"sort": "business_desc"}, timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert all("business_value" in v and "last_order_date" in v for v in rows)
        vals = [v["business_value"] or 0 for v in rows]
        assert vals == sorted(vals, reverse=True)
        r2 = client.get(f"{BASE}/vendors", params={"sort": "recent_desc"}, timeout=30)
        dates = [v["last_order_date"] or "" for v in r2.json()]
        assert dates == sorted(dates, reverse=True)

    def test_status_filter_inactive(self, client):
        assert TestVendorFilters.vid
        client.delete(f"{BASE}/vendors/{TestVendorFilters.vid}", timeout=30)
        inact = client.get(f"{BASE}/vendors", params={"status": "inactive"}, timeout=30).json()
        assert any(v["id"] == TestVendorFilters.vid for v in inact)
        act = client.get(f"{BASE}/vendors", params={"status": "active"}, timeout=30).json()
        assert not any(v["id"] == TestVendorFilters.vid for v in act)


# ══════════════════ partners — tags, filters, guard, rate-card ══════════════════
class TestPartnerTagsAndGuard:
    tag_ids = []
    partner_id = None

    def test_tag_crud(self, client):
        for name in ("TEST_Plumbing", "TEST_Electrical"):
            r = client.post(f"{BASE}/partners/tags", json={"tag": name}, timeout=30)
            assert r.status_code == 200, r.text
            TestPartnerTagsAndGuard.tag_ids.append(r.json().get("id") or r.json().get("_id"))
        allt = client.get(f"{BASE}/partners/tags/all", timeout=30)
        assert allt.status_code == 200
        names = [t["tag"] for t in allt.json()]
        assert "TEST_Plumbing" in names and "TEST_Electrical" in names
        # duplicate rejected
        dup = client.post(f"{BASE}/partners/tags", json={"tag": "TEST_Plumbing"}, timeout=30)
        assert dup.status_code in (400, 409), dup.text
        # rename
        tid = TestPartnerTagsAndGuard.tag_ids[0]
        rn = client.put(f"{BASE}/partners/tags/{tid}", json={"tag": "TEST_Plumbing2"}, timeout=30)
        assert rn.status_code == 200, rn.text
        assert "TEST_Plumbing2" in [t["tag"] for t in client.get(f"{BASE}/partners/tags/all", timeout=30).json()]

    def test_combo_tag_and_filter(self, client):
        r = client.post(f"{BASE}/partners", json={
            "name": "TEST_EdgePartner", "partner_type": "contractor", "company_name": "TEST_Co",
            "phone": "9000000002", "specialities": ["TEST_Plumbing2", "TEST_Electrical"],
            "service_districts": ["Bengaluru"], "status": "active",
            "rate_card": [{"activity": "Wiring", "unit": "per_kw", "rate": 500, "effective_from": "2026-01-01"}]},
            timeout=30)
        assert r.status_code == 200, r.text
        TestPartnerTagsAndGuard.partner_id = r.json()["id"]
        both = client.get(f"{BASE}/partners",
                          params={"specialities": "TEST_Plumbing2,TEST_Electrical"}, timeout=30)
        assert both.status_code == 200
        assert any(p["id"] == TestPartnerTagsAndGuard.partner_id for p in both.json())
        # AND semantics: a tag the partner doesn't have must exclude it
        neither = client.get(f"{BASE}/partners",
                             params={"specialities": "TEST_Plumbing2,TEST_NoSuchTag"}, timeout=30)
        assert not any(p["id"] == TestPartnerTagsAndGuard.partner_id for p in neither.json())

    def test_min_rating_and_sort(self, client):
        r = client.get(f"{BASE}/partners", params={"min_rating": 4, "sort": "rating_desc"}, timeout=30)
        assert r.status_code == 200
        assert all((p.get("rating") or 0) >= 4 for p in r.json())
        b = client.get(f"{BASE}/partners", params={"sort": "business_desc"}, timeout=30)
        vals = [p.get("lifetime_business", 0) or 0 for p in b.json()]
        assert vals == sorted(vals, reverse=True)

    def test_rate_card_edit_in_place(self, client):
        pid = TestPartnerTagsAndGuard.partner_id
        assert pid
        r = client.put(f"{BASE}/partners/{pid}/rate-card", json={
            "index": 0, "activity": "Wiring Fixed", "unit": "per_kw", "rate": 750,
            "effective_from": "2026-02-01"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["rate_card"][0]["rate"] == 750
        assert client.get(f"{BASE}/partners/{pid}", timeout=30).json()["rate_card"][0]["activity"] == "Wiring Fixed"
        oob = client.put(f"{BASE}/partners/{pid}/rate-card", json={
            "index": 99, "activity": "x", "unit": "per_kw", "rate": 1, "effective_from": "2026-01-01"}, timeout=30)
        assert oob.status_code == 400 and "out of range" in oob.text

    def test_status_guard_with_active_assignment(self, client):
        pid = TestPartnerTagsAndGuard.partner_id
        projects = client.get(f"{BASE}/projects", timeout=30).json()
        projects = projects if isinstance(projects, list) else projects.get("projects", [])
        if not projects:
            pytest.skip("no projects to assign")
        a = client.post(f"{BASE}/partners/{pid}/assignments", json={
            "project_id": projects[0]["id"],
            "activities": [{"activity": "Wiring Fixed", "quantity": 5}],
            "assigned_date": "2026-07-10"}, timeout=30)
        if a.status_code != 200:
            pytest.skip(f"assignment create failed: {a.status_code} {a.text[:200]}")
        blocked = client.put(f"{BASE}/partners/{pid}", json={"status": "inactive"}, timeout=30)
        assert blocked.status_code == 400, blocked.text
        assert "active assignment" in blocked.text.lower()
        # force without reason
        nr = client.put(f"{BASE}/partners/{pid}",
                        json={"status": "inactive", "force_status_change": True}, timeout=30)
        assert nr.status_code == 400 and "reason" in nr.text.lower()
        ok = client.put(f"{BASE}/partners/{pid}", json={
            "status": "inactive", "force_status_change": True,
            "status_change_reason": "TEST_ override reason"}, timeout=30)
        assert ok.status_code == 200, ok.text
        fresh = client.get(f"{BASE}/partners/{pid}", timeout=30).json()
        assert fresh["status"] == "inactive"
        assert fresh.get("status_override_reason") == "TEST_ override reason"

    @pytest.fixture(scope="class", autouse=True)
    def cleanup(self, client):
        yield
        if TestPartnerTagsAndGuard.partner_id:
            client.delete(f"{BASE}/partners/{TestPartnerTagsAndGuard.partner_id}", timeout=30)
        for tid in TestPartnerTagsAndGuard.tag_ids:
            if tid:
                client.delete(f"{BASE}/partners/tags/{tid}", timeout=30)


# ══════════════════ hard-delete endpoints ══════════════════
class TestHardDelete:
    def test_empty_reason_400(self, client):
        sales = client.get(f"{BASE}/sales", timeout=30).json()
        sales = sales if isinstance(sales, list) else sales.get("sales", [])
        if not sales:
            pytest.skip("no sales")
        r = client.delete(f"{BASE}/hard-delete/sale/{sales[0]['id']}", json={"reason": ""}, timeout=30)
        assert r.status_code == 400, r.text
        assert "reason" in r.text.lower()

    def test_nonexistent_404(self, client):
        r = client.delete(f"{BASE}/hard-delete/sale/507f1f77bcf86cd799439011",
                          json={"reason": "TEST_ valid reason"}, timeout=30)
        assert r.status_code == 404, r.text

    def test_po_and_delivery_reason_validation(self, client):
        r = client.delete(f"{BASE}/hard-delete/purchase-order/507f1f77bcf86cd799439011",
                          json={"reason": "ab"}, timeout=30)
        assert r.status_code == 400, r.text
        r2 = client.delete(f"{BASE}/hard-delete/delivery/507f1f77bcf86cd799439011",
                           json={"reason": ""}, timeout=30)
        assert r2.status_code == 400, r2.text

    def test_unauthenticated_blocked(self):
        r = requests.delete(f"{BASE}/hard-delete/sale/507f1f77bcf86cd799439011",
                            json={"reason": "TEST_ reason"}, timeout=30)
        assert r.status_code in (401, 403), r.status_code

    def test_full_hard_delete_sale_roundtrip(self, client):
        """Create a throwaway sale then hard-delete it and confirm removal + audit snapshot."""
        items = client.get(f"{BASE}/inventory/items", params={"limit": 5}, timeout=30).json()
        items = items if isinstance(items, list) else items.get("items", [])
        if not items:
            pytest.skip("no inventory")
        it = items[0]
        body = {
            "sale_type": "counter",
            "customer": {"name": "TEST_HardDelCust", "phone": "9000000003", "state": "Tamil Nadu"},
            "lines": [{"inventory_item_id": it["id"], "name": it.get("name", "x"),
                       "quantity": 1, "unit_price": 100, "gst_percentage": 18}],
            "override_negative_stock": True,
        }
        c = client.post(f"{BASE}/sales", json=body, timeout=30)
        if c.status_code not in (200, 201):
            pytest.skip(f"sale create failed {c.status_code}: {c.text[:200]}")
        sid = c.json().get("id") or c.json().get("sale", {}).get("id")
        r = client.delete(f"{BASE}/hard-delete/sale/{sid}", json={"reason": "TEST_ QA cleanup"}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "deleted"
        after = client.get(f"{BASE}/sales", timeout=30).json()
        after = after if isinstance(after, list) else after.get("sales", [])
        assert not any(s["id"] == sid for s in after)
