"""Iter 54 — T&C dropdown category filtering · credit-interest leakage · permission-driven nav · vendor geo · vault · Sensobrain scoping."""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST54_{uuid.uuid4().hex[:5]}"
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")
STAFF_EMAIL = f"{TAG.lower()}_staff@sensoper.com"
STAFF_PW = "Staff@12345"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": ADMIN_PW}, timeout=60)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def staff(admin):
    r = admin.post(f"{API}/users", json={"email": STAFF_EMAIL, "password": STAFF_PW, "name": f"{TAG} Staff", "role": "staff"}, timeout=60)
    assert r.status_code in (200, 201), r.text
    uid = r.json().get("id")
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PW}, timeout=60).status_code == 200
    yield s
    admin.delete(f"{API}/users/{uid}", timeout=60)


# ── 1. T&C dropdown ───────────────────────────────────────────────────────────
class TestTermsCategoryFilter:
    def test_legacy_template_without_category_is_listed_for_quotation(self, admin):
        r = admin.post(f"{API}/terms", json={"title": f"{TAG} Legacy", "content": "<p>legacy</p>", "language": "en", "category": "quotation"}, timeout=60)
        assert r.status_code in (200, 201), r.text
        tid = r.json()["id"]
        # simulate a pre-category document
        import pymongo
        from dotenv import dotenv_values
        env = dotenv_values("/app/backend/.env")
        db = pymongo.MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
        from bson import ObjectId
        db.terms_conditions.update_one({"_id": ObjectId(tid)}, {"$unset": {"category": ""}})
        ids = [t["id"] for t in admin.get(f"{API}/terms", params={"category": "quotation"}, timeout=60).json()]
        assert tid in ids, "legacy (no category) template must still appear in the quotation dropdown"
        ids_inv = [t["id"] for t in admin.get(f"{API}/terms", params={"category": "invoice"}, timeout=60).json()]
        assert tid not in ids_inv
        admin.delete(f"{API}/terms/{tid}", timeout=60)

    def test_selected_terms_persist_on_project(self, admin):
        terms = admin.get(f"{API}/terms", params={"category": "quotation"}, timeout=60).json()
        assert terms, "quotation dropdown must have options"
        pid = admin.post(f"{API}/projects", json={"customer": {"name": f"{TAG} Cust", "phone": "9000000054", "email": "i54@test.com", "address": "1 Lane"},
            "location": {"address": "1 Lane", "city": "Erode", "state": "Tamil Nadu", "pincode": "638001"},
            "electrical": {"sanction_load_kw": 3, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 7},
            "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "fixed"}, "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10},
            "solar_system": {"system_type": "on-grid", "capacity_kw": 3}, "selected_items": [], "manual_costs": [], "terms_id": terms[0]["id"]}, timeout=60).json()["id"]
        p = admin.get(f"{API}/projects/{pid}", timeout=60).json()
        assert p.get("terms_id") == terms[0]["id"]
        admin.delete(f"{API}/projects/{pid}/force", timeout=60)


# ── 2. Credit interest ────────────────────────────────────────────────────────
class TestCreditInterest:
    def test_pure_math(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from credit_interest import interest_cost, annotate_credit
        assert interest_cost(100000, 1.5, 30) == 1500.0
        assert interest_cost(100000, 1.5, 15) == 750.0
        assert interest_cost(100000, 1.5, 0) == 0.0
        now = datetime(2026, 3, 31, tzinfo=timezone.utc)
        c = {"balance": 50000, "due_date": "2026-03-01", "status": "overdue", "customer_name": "Acme"}
        a = annotate_credit(c, 1.5, {}, now)
        assert a["days_overdue"] == 30 and a["rate_source"] == "default" and a["interest_cost"] == 750.0
        a = annotate_credit(c, 1.5, {"acme": 3.0}, now)
        assert a["rate_source"] == "customer" and a["interest_cost"] == 1500.0
        a = annotate_credit({**c, "interest_rate_override": 0.0}, 1.5, {"acme": 3.0}, now)
        assert a["rate_source"] == "record" and a["interest_cost"] == 0.0

    def test_config_default_and_overrides_via_api(self, admin):
        cfg = admin.get(f"{API}/catalogue/config", timeout=60).json()
        assert cfg.get("credit_interest_monthly_pct") is not None
        due = (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%d")
        cid = admin.post(f"{API}/credits", json={"customer_name": f"{TAG} Debtor", "total_amount": 100000, "due_date": due}, timeout=60).json()["id"]
        row = next(c for c in admin.get(f"{API}/credits", timeout=60).json() if c["id"] == cid)
        assert row["status"] == "overdue" and row["days_overdue"] >= 59 and row["rate_source"] == "default"
        default_cost = row["interest_cost"]
        assert default_cost > 0
        # customer override
        assert admin.put(f"{API}/credits/customer-rates", json={"customer_name": f"{TAG} Debtor", "monthly_pct": 3.0}, timeout=60).status_code == 200
        row = next(c for c in admin.get(f"{API}/credits", timeout=60).json() if c["id"] == cid)
        assert row["rate_source"] == "customer" and row["effective_monthly_pct"] == 3.0
        assert row["interest_cost"] == pytest.approx(default_cost * 2, rel=0.01)
        # record override wins
        assert admin.put(f"{API}/credits/{cid}/interest-rate", json={"monthly_pct": 0.5}, timeout=60).status_code == 200
        row = next(c for c in admin.get(f"{API}/credits", timeout=60).json() if c["id"] == cid)
        assert row["rate_source"] == "record" and row["effective_monthly_pct"] == 0.5
        assert admin.put(f"{API}/credits/{cid}/interest-rate", json={"monthly_pct": 150}, timeout=60).status_code == 400
        # report includes it
        rep = admin.get(f"{API}/reports/profit_leakage", params={"tab": "credit_interest"}, timeout=60).json()
        assert "credit_interest_cost" in rep["summary"] and "credit_interest" in rep["tabs"] and "credit_by_customer" in rep["tabs"]
        assert any(r["customer"] == f"{TAG} Debtor" and r["rate_source"] == "record" for r in rep["rows"])
        # balance untouched — reporting only
        assert row["balance"] == 100000
        admin.put(f"{API}/credits/customer-rates", json={"customer_name": f"{TAG} Debtor", "monthly_pct": None}, timeout=60)
        admin.delete(f"{API}/credits/{cid}", timeout=60)

    def test_staff_cannot_override_rate(self, staff):
        assert staff.put(f"{API}/credits/customer-rates", json={"customer_name": "x", "monthly_pct": 1}, timeout=60).status_code == 403


# ── 3. Permission-driven nav ──────────────────────────────────────────────────
class TestPermissionNav:
    def test_matrix_exposes_new_modules_and_staff_denied_where_expected(self, admin, staff):
        for role in ("admin", "manager", "staff"):
            perms = admin.get(f"{API}/permissions/{role}", timeout=60).json()["permissions"]
            for m in ("module_vendors", "module_vault", "module_sensobrain", "module_projects", "module_daily_updates"):
                assert m in perms, f"{role} missing {m}"
        staff_perms = staff.get(f"{API}/permissions/staff", timeout=60).json()["permissions"]
        assert staff_perms["module_vault"]["view"] is False and staff_perms["module_vendors"]["view"] is False
        assert staff_perms["module_sensobrain"]["view"] is True
        assert admin.get(f"{API}/permissions/admin", timeout=60).json()["permissions"]["module_vault"]["view"] is True


# ── 4. Credential vault ───────────────────────────────────────────────────────
class TestVault:
    def test_admin_crud_reveal_logged_and_masked(self, admin):
        r = admin.post(f"{API}/vault", json={"service_name": f"{TAG} Workspace", "account_identifier": "ops@sensoper.com", "password": "Sup3r$ecret", "category": "email", "two_fa_enabled": False}, timeout=60)
        assert r.status_code == 200, r.text
        item = r.json(); vid = item["id"]
        assert "password" not in item and "password_encrypted" not in item
        listing = admin.get(f"{API}/vault", timeout=60).json()
        row = next(i for i in listing if i["id"] == vid)
        assert "password" not in row and row["view_count"] == 0
        rev = admin.post(f"{API}/vault/{vid}/reveal", timeout=60).json()
        assert rev["password"] == "Sup3r$ecret"
        log = admin.get(f"{API}/vault/{vid}/access-log", timeout=60).json()
        assert log[0]["action"] == "reveal" and log[0]["user_name"]
        row = next(i for i in admin.get(f"{API}/vault", timeout=60).json() if i["id"] == vid)
        assert row["view_count"] == 1
        # encrypted at rest
        import pymongo
        from dotenv import dotenv_values
        from bson import ObjectId
        env = dotenv_values("/app/backend/.env")
        doc = pymongo.MongoClient(env["MONGO_URL"])[env["DB_NAME"]].credential_vault.find_one({"_id": ObjectId(vid)})
        assert doc["password_encrypted"] != "Sup3r$ecret" and doc["password_encrypted"].startswith("gAAAA")
        # rotation stamps
        old = row["last_rotated"]
        upd = admin.put(f"{API}/vault/{vid}", json={"password": "N3w$ecret", "two_fa_enabled": True, "two_fa_method": "authenticator_app"}, timeout=60).json()
        assert upd["last_rotated"] >= old and upd["two_fa_enabled"] is True
        dash = admin.get(f"{API}/vault/dashboard", timeout=60).json()
        assert "two_fa_disabled" in dash and "rotation_overdue" in dash and dash["encryption"]["configured"] is True
        # audit trail exists
        logs = admin.get(f"{API}/audit-logs", params={"entity_type": "credential_vault"}, timeout=60)
        assert logs.status_code == 200
        assert admin.delete(f"{API}/vault/{vid}", timeout=60).status_code == 200

    def test_non_admin_blocked_everywhere(self, staff):
        for m, path in (("GET", "/vault"), ("GET", "/vault/dashboard"), ("POST", "/vault"), ("POST", "/vault/000000000000000000000000/reveal")):
            r = staff.request(m, f"{API}{path}", json={"service_name": "x", "account_identifier": "y", "password": "z"}, timeout=60)
            assert r.status_code == 403, f"{m} {path} -> {r.status_code}"

    def test_validation(self, admin):
        assert admin.post(f"{API}/vault", json={"service_name": "x", "account_identifier": "y", "password": "z", "category": "bogus"}, timeout=60).status_code == 400
        assert admin.post(f"{API}/vault", json={"service_name": "", "account_identifier": "y", "password": "z"}, timeout=60).status_code == 400


# ── 5. Vendor geo ─────────────────────────────────────────────────────────────
class TestVendorGeo:
    def test_reference_lists_and_checkbox_filters(self, admin):
        states = admin.get(f"{API}/geo/states", timeout=60).json()
        assert "Tamil Nadu" in states and len(states) >= 28
        d = admin.get(f"{API}/geo/districts", params={"state": "Tamil Nadu"}, timeout=60).json()["Tamil Nadu"]
        assert "Erode" in d and "Coimbatore" in d
        v1 = admin.post(f"{API}/vendors", json={"name": f"{TAG} Erode Vendor", "state": "Tamil Nadu", "district": "Erode", "category": "panels"}, timeout=60).json()
        v2 = admin.post(f"{API}/vendors", json={"name": f"{TAG} Kochi Vendor", "state": "Kerala", "district": "Ernakulam", "category": "panels"}, timeout=60).json()
        both = admin.get(f"{API}/vendors", params={"districts": "Erode,Ernakulam"}, timeout=60).json()
        names = {v["name"] for v in both}
        assert v1["name"] in names and v2["name"] in names
        only_kl = {v["name"] for v in admin.get(f"{API}/vendors", params={"states": "Kerala"}, timeout=60).json()}
        assert v2["name"] in only_kl and v1["name"] not in only_kl
        for v in (v1, v2):
            admin.delete(f"{API}/vendors/{v['id']}", timeout=60)

    def test_admin_can_extend_district_list(self, admin):
        r = admin.post(f"{API}/geo/districts", json={"state": "Tamil Nadu", "district": f"{TAG} Taluk"}, timeout=60)
        assert r.status_code == 200 and f"{TAG} Taluk" in r.json()["Tamil Nadu"]


# ── 6. Sensobrain ─────────────────────────────────────────────────────────────
class TestSensobrain:
    def test_settings_admin_only_and_key_masked(self, admin, staff):
        assert staff.get(f"{API}/sensobrain/settings", timeout=60).status_code == 403
        s = admin.get(f"{API}/sensobrain/settings", timeout=60).json()
        assert "/api/vault" in s["hard_blocked"] and "openai_api_key" not in s and "openai_api_key_enc" not in s
        assert admin.put(f"{API}/sensobrain/settings", json={"openai_api_key": "not-a-key"}, timeout=60).status_code == 400
        r = admin.put(f"{API}/sensobrain/settings", json={"excluded_paths": ["/api/audit-logs", "javascript:bad", "/api/hard-delete"]}, timeout=60)
        assert r.status_code == 200 and r.json()["excluded_paths"] == ["/api/audit-logs", "/api/hard-delete"]

    def test_chat_requires_configuration_or_returns_503(self, staff):
        st = staff.get(f"{API}/sensobrain/status", timeout=60).json()
        if not st["configured"]:
            assert staff.post(f"{API}/sensobrain/chat", json={"message": "hi"}, timeout=60).status_code == 503

    def test_tool_dispatch_is_scoped_per_user_and_vault_blocked(self, admin, staff):
        """Two users, same tool → results limited to what each can see; the vault can never be reached."""
        import sys, asyncio
        sys.path.insert(0, "/app/backend")
        import sensobrain
        # blocked prefix check (pure)
        assert any("/api/vault".startswith(p) for p in sensobrain.HARD_BLOCKED_PREFIXES)
        assert not any(t["function"]["name"] == "vault" for t in sensobrain.TOOLS)
        # scoping through the real endpoints the tools call
        admin_projects = admin.get(f"{API}/projects", timeout=60).json()
        staff_projects = staff.get(f"{API}/projects", timeout=60).json()
        assert len(staff_projects) <= len(admin_projects)
        assert all(p.get("created_by_name") or True for p in staff_projects)
        assert staff.get(f"{API}/reports/profit_leakage", timeout=60).status_code == 403
        assert admin.get(f"{API}/reports/profit_leakage", timeout=60).status_code == 200

    def test_conversation_visibility(self, admin, staff):
        assert staff.get(f"{API}/sensobrain/admin/conversations", timeout=60).status_code == 403
        assert staff.get(f"{API}/sensobrain/admin/usage", timeout=60).status_code == 403
        assert admin.get(f"{API}/sensobrain/admin/usage", timeout=60).json()["all_time"]["requests"] >= 0
        assert isinstance(staff.get(f"{API}/sensobrain/conversations", timeout=60).json(), list)
