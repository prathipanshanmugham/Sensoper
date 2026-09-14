"""Iter 53 — terms→documents linkage, 2FA + credentials management, AMC scheduling/notifications/batching, structured inbound location."""
import os
import uuid

import pyotp
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST53B_{uuid.uuid4().hex[:5]}"
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=60)
    assert r.status_code == 200, r.text
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    return _login("admin@sensoper.com", ADMIN_PW)[0]


def _project(sess, name):
    return sess.post(f"{API}/projects", json={"customer": {"name": name, "phone": "9000000053", "email": "i53@test.com", "address": "1 Test Lane"},
        "location": {"address": "1 Test Lane", "city": "Chennai", "state": "Tamil Nadu", "pincode": "600001"},
        "electrical": {"sanction_load_kw": 3, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 7},
        "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "fixed"}, "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10},
        "solar_system": {"system_type": "on-grid", "capacity_kw": 3}, "selected_items": [], "manual_costs": []}, timeout=60).json()["id"]


class TestTermsLinkage:
    def test_quote_and_invoice_templates_saved_in_any_status(self, admin):
        q = admin.post(f"{API}/terms", json={"title": f"{TAG} Quote terms", "content": f"<ol><li>{TAG} QUOTE CLAUSE</li></ol>", "language": "en", "category": "quotation"}, timeout=60)
        i = admin.post(f"{API}/terms", json={"title": f"{TAG} Invoice terms", "content": f"<ol><li>{TAG} INVOICE CLAUSE</li></ol>", "language": "en", "category": "invoice"}, timeout=60)
        assert q.status_code in (200, 201) and i.status_code in (200, 201), (q.text, i.text)
        qid, iid = q.json()["id"], i.json()["id"]
        pid = _project(admin, f"{TAG} Terms")
        # move the project out of 'draft' — the old rule blocked terms edits here (root cause of the report)
        assert admin.post(f"{API}/projects/{pid}/submit", timeout=60).status_code == 200
        r = admin.put(f"{API}/projects/{pid}", json={"terms_id": qid}, timeout=60)
        assert r.status_code == 200, r.text
        r = admin.put(f"{API}/projects/{pid}", json={"invoice_terms_id": iid}, timeout=60)
        assert r.status_code == 200, r.text
        p = admin.get(f"{API}/projects/{pid}", timeout=60).json()
        assert p["terms_id"] == qid and p["invoice_terms_id"] == iid
        # the PDF builders fetch these by id — the content that must appear in Quote / Detailed PDF / Invoice
        assert f"{TAG} QUOTE CLAUSE" in admin.get(f"{API}/terms/{qid}", timeout=60).json()["content"]
        assert f"{TAG} INVOICE CLAUSE" in admin.get(f"{API}/terms/{iid}", timeout=60).json()["content"]
        admin.post(f"{API}/projects/{pid}/reject", json={"reason": "cleanup"}, timeout=60)
        admin.delete(f"{API}/projects/{pid}", timeout=60)


class TestCredentialsAnd2FA:
    EMAIL, PW = f"{TAG.lower()}_2fa@test.com", "Totp@12345"

    @pytest.fixture(scope="class")
    def user(self, admin):
        r = admin.post(f"{API}/users", json={"email": self.EMAIL, "password": self.PW, "name": f"{TAG} 2FA", "role": "staff"}, timeout=60)
        assert r.status_code in (200, 201), r.text
        yield r.json()["id"]
        admin.delete(f"{API}/users/{r.json()['id']}", timeout=60)

    def test_credentials_page_admin_only(self, admin, user):
        s, _ = _login(self.EMAIL, self.PW)
        assert s.get(f"{API}/security/credentials", timeout=60).status_code == 403
        d = admin.get(f"{API}/security/credentials", timeout=60).json()
        row = next(r for r in d["rows"] if r["id"] == user)
        assert row["totp_enabled"] is False and row["password_age_days"] == 0 and row["password_stale"] is False
        assert d["config"]["password_rotation_days"] == 90

    def test_full_totp_cycle(self, admin, user):
        s, _ = _login(self.EMAIL, self.PW)
        setup = s.post(f"{API}/auth/2fa/setup", timeout=60).json()
        assert setup["qr_code"].startswith("data:image/png;base64,") and len(setup["backup_codes"]) == 8
        secret = setup["manual_key"]
        assert s.post(f"{API}/auth/2fa/enable", json={"code": "000000"}, timeout=60).status_code == 400
        assert s.post(f"{API}/auth/2fa/enable", json={"code": pyotp.TOTP(secret).now()}, timeout=60).status_code == 200
        # login now needs the second step
        s2 = requests.Session()
        r = s2.post(f"{API}/auth/login", json={"email": self.EMAIL, "password": self.PW}, timeout=60)
        assert r.status_code == 200 and r.json().get("requires_2fa") is True and "access_token" not in s2.cookies
        assert s2.get(f"{API}/auth/me", timeout=60).status_code == 401
        assert s2.post(f"{API}/auth/login/2fa", json={"code": "123456"}, timeout=60).status_code == 401
        r = s2.post(f"{API}/auth/login/2fa", json={"code": pyotp.TOTP(secret).now()}, timeout=60)
        assert r.status_code == 200 and r.json()["totp_enabled"] is True, r.text
        assert s2.get(f"{API}/auth/me", timeout=60).status_code == 200
        # backup code is single-use
        s3 = requests.Session(); s3.post(f"{API}/auth/login", json={"email": self.EMAIL, "password": self.PW}, timeout=60)
        assert s3.post(f"{API}/auth/login/2fa", json={"code": setup["backup_codes"][0]}, timeout=60).status_code == 200
        s4 = requests.Session(); s4.post(f"{API}/auth/login", json={"email": self.EMAIL, "password": self.PW}, timeout=60)
        assert s4.post(f"{API}/auth/login/2fa", json={"code": setup["backup_codes"][0]}, timeout=60).status_code == 401
        row = next(r for r in admin.get(f"{API}/security/credentials", timeout=60).json()["rows"] if r["id"] == user)
        assert row["totp_enabled"] is True and row["backup_codes_left"] == 7
        logs = admin.get(f"{API}/audit-logs", params={"entity_type": "user"}, timeout=60).json()
        assert any(l["action_type"] == "2fa_enabled" and l["entity_id"] == user for l in logs)
        # admin forces reset + disables 2FA (recovery)
        assert admin.post(f"{API}/security/credentials/{user}/require-reset", timeout=60).json()["must_reset_password"] is True
        assert admin.post(f"{API}/security/credentials/{user}/disable-2fa", timeout=60).json()["enabled"] is False
        s5, payload = _login(self.EMAIL, self.PW)
        assert payload.get("must_reset_password") is True and payload.get("requires_2fa") is None
        assert s5.post(f"{API}/auth/change-password", json={"current_password": self.PW, "new_password": "Totp@123456"}, timeout=60).status_code == 200
        row = next(r for r in admin.get(f"{API}/security/credentials", timeout=60).json()["rows"] if r["id"] == user)
        assert row["must_reset_password"] is False and row["password_changed_at"]
        assert any(l["action_type"] == "password_changed" for l in admin.get(f"{API}/audit-logs", params={"entity_type": "user"}, timeout=60).json())

    def test_rotation_threshold_config(self, admin):
        assert admin.put(f"{API}/security/config", json={"password_rotation_days": 3}, timeout=60).status_code == 400
        assert admin.put(f"{API}/security/config", json={"password_rotation_days": 60}, timeout=60).json()["password_rotation_days"] == 60
        admin.put(f"{API}/security/config", json={"password_rotation_days": 90}, timeout=60)


class TestAmcOps:
    @pytest.fixture(scope="class")
    def contract(self, admin):
        pid = _project(admin, f"{TAG} AMC")
        r = admin.post(f"{API}/amc/contracts", json={"project_id": pid, "customer_name": f"{TAG} AMC", "contact": "9876543210", "district": "Namakkal", "pincode": "637001",
                                                       "system_type": "on-grid", "system_capacity_kw": 3, "annual_value": 6000, "visits_per_year": 2, "start_date": "2026-09-01", "duration_months": 12}, timeout=60)
        assert r.status_code in (200, 201), r.text
        yield r.json().get("id") or r.json().get("contract_id"), pid
        admin.delete(f"{API}/projects/{pid}", timeout=60)

    def test_interest_flag_feeds_followups(self, admin):
        pid = _project(admin, f"{TAG} Interest")
        r = admin.put(f"{API}/amc/interest/{pid}", json={"interested": True, "notes": "asked at handover"}, timeout=60)
        assert r.status_code == 200 and r.json()["interested"] is True
        assert admin.get(f"{API}/projects/{pid}", timeout=60).json()["amc_interest"]["notes"] == "asked at handover"
        # only COMPLETED projects show up in the follow-up list
        assert all(f["project_id"] != pid for f in admin.get(f"{API}/amc/follow-ups", timeout=60).json()["rows"])
        admin.delete(f"{API}/projects/{pid}", timeout=60)

    def test_schedule_creates_lead_time_notifications(self, admin, contract):
        cid, _ = contract
        me = admin.get(f"{API}/auth/me", timeout=60).json()
        r = admin.post(f"{API}/amc/contracts/{cid}/schedule", json={"scheduled_date": "2026-09-20", "technician_id": me["id"], "technician_name": me["name"], "lead_days": [3, 1]}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["notifications_created"] == 4  # (tech + customer) × (3d, 1d)
        by = {(n["audience"], n["lead_days"]): n for n in d["notifications"]}
        assert by[("technician", 3)]["notify_at"].startswith("2026-09-17") and by[("customer", 1)]["notify_at"].startswith("2026-09-19")
        assert by[("customer", 3)]["whatsapp_url"].startswith("https://wa.me/919876543210?text=")
        assert "20 Sep 2026" in by[("customer", 1)]["message"]
        # technician sees it in-app (it is already due — dates are in the past relative to now)
        mine = admin.get(f"{API}/notifications", params={"include_upcoming": True}, timeout=60).json()["rows"]
        assert any(n["visit_id"] == d["visit"]["id"] for n in mine)
        # customer reminder sits in the outbox until staff mark it sent
        ob = admin.get(f"{API}/amc/outbox", params={"all_pending": True}, timeout=60).json()["rows"]
        item = next(n for n in ob if n["visit_id"] == d["visit"]["id"])
        assert admin.post(f"{API}/amc/outbox/{item['id']}/sent", timeout=60).status_code == 200
        assert all(n["id"] != item["id"] for n in admin.get(f"{API}/amc/outbox", params={"all_pending": True}, timeout=60).json()["rows"])
        cal = admin.get(f"{API}/amc/schedule", params={"start": "2026-09-01", "end": "2026-09-30"}, timeout=60).json()
        assert any(v["contract_id"] == cid and v["scheduled_date"] == "2026-09-20" for v in cal)

    def test_batching_groups_by_district_with_cost_comparison(self, admin, contract):
        cid, _ = contract
        d = admin.get(f"{API}/amc/batching", params={"days": 60}, timeout=60).json()
        assert d["km_cost"] > 0 and isinstance(d["clusters"], list)
        cl = next(g for g in d["clusters"] if any(c["contract_id"] == cid for c in g["contracts"]))
        assert cl["cluster"] == "Namakkal" and "suggestion" in cl and cl["visit_revenue"] >= 3000
        c = next(c for c in cl["contracts"] if c["contract_id"] == cid)
        assert c["already_scheduled"] is True and c["due_date"] == "2026-09-20"
        if d["hq_geocoded"] and c["distance_km"] is not None:
            assert cl["batched_trip_cost"] <= cl["separate_trip_cost"]


class TestStructuredInboundLocation:
    def test_free_text_rejected_and_struct_written_to_item(self, admin):
        inv = admin.post(f"{API}/inventory/items", json={"name": f"{TAG} Fuse", "sku_code": f"{TAG}-F", "category": "bos", "quantity": 0, "unit_price": 10, "gst_percentage": 18, "margin_pct": 5}, timeout=60).json()["id"]
        po = admin.post(f"{API}/purchase-orders", json={"supplier_name": f"{TAG} S", "items": [{"name": "f", "qty": 2, "unit_price": 10, "inventory_item_id": inv}]}, timeout=60).json()
        po_id = po.get("id") or po.get("po_id")
        admin.put(f"{API}/purchase-orders/{po_id}/approve", timeout=60); admin.put(f"{API}/purchase-orders/{po_id}/arrival", json={}, timeout=60); admin.put(f"{API}/purchase-orders/{po_id}/qc", json={}, timeout=60)
        assert admin.put(f"{API}/purchase-orders/{po_id}/inbound", json={"storage_location": "Zone A shelf 3"}, timeout=60).status_code == 400
        assert admin.put(f"{API}/purchase-orders/{po_id}/inbound", json={"storage_location": {}}, timeout=60).status_code == 400
        r = admin.put(f"{API}/purchase-orders/{po_id}/inbound", json={"storage_location": {"zone": "A", "aisle": "2", "bin": "B7"}}, timeout=60)
        assert r.status_code == 200, r.text
        item = admin.get(f"{API}/inventory/items/{inv}", timeout=60).json()
        assert item["zone"] == "A" and item["aisle"] == "2" and item["bin_location"] == "B7" and item["quantity"] == 2
        opts = admin.get(f"{API}/inventory/storage-locations", timeout=60).json()
        assert "A" in opts["zones"] and "B7" in opts["bins"]
        row = next(p for p in admin.get(f"{API}/purchase-orders", params={"status": "all"}, timeout=60).json() if p["id"] == po_id)
        assert row["storage_location"] == "Zone A / Aisle 2 / Bin B7"
        admin.delete(f"{API}/hard-delete/purchase-order/{po_id}", json={"reason": "cleanup"}, timeout=60)
        admin.delete(f"{API}/inventory/items/{inv}", timeout=60)
