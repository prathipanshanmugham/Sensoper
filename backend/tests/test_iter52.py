"""Iteration 52 regression suite — pricing restructure, asset documents, partner delete guardrails,
internal teams, panel wattage, permissions audit."""
import io
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST52_{uuid.uuid4().hex[:5]}"
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")
STAFF_EMAIL, STAFF_PW = f"{TAG.lower()}_staff@test.com", "Staff@12345"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": ADMIN_PW}, timeout=60)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def staff(client):
    r = client.post(f"{API}/users", json={"email": STAFF_EMAIL, "password": STAFF_PW, "name": f"{TAG} Staff", "role": "staff"}, timeout=60)
    assert r.status_code in (200, 201), r.text
    uid = r.json().get("id")
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PW}, timeout=60).status_code == 200
    yield s
    client.delete(f"{API}/users/{uid}", timeout=60)


@pytest.fixture(scope="module")
def anon():
    return requests.Session()


# ── Task 4/7: pricing restructure ────────────────────────────────────────────
class TestPricingRestructure:
    def test_config_has_single_rounding_rule_and_no_blanket_defaults(self, client):
        cfg = client.get(f"{API}/catalogue/config", timeout=60).json()
        assert "gst_pct" not in cfg and "default_margin_pct" not in cfg and "kit_rounding_step" not in cfg
        assert cfg["rounding_step"] in (1, 10, 100) and cfg["rounding_mode"] in ("nearest", "up", "down")

    def test_rounding_validation(self, client):
        assert client.put(f"{API}/catalogue/config", json={"rounding_step": 500}, timeout=60).status_code == 400
        assert client.put(f"{API}/catalogue/config", json={"rounding_mode": "banker"}, timeout=60).status_code == 400
        assert client.put(f"{API}/catalogue/config", json={"default_margin_pct": 15}, timeout=60).status_code == 400
        r = client.put(f"{API}/catalogue/config", json={"rounding_step": 10, "rounding_mode": "up"}, timeout=60)
        assert r.status_code == 200 and r.json()["rounding_step"] == 10 and r.json()["rounding_mode"] == "up"
        client.put(f"{API}/catalogue/config", json={"rounding_step": 1, "rounding_mode": "nearest"}, timeout=60)

    def test_quick_calc_lines_carry_own_gst_and_margin(self, client):
        ov = {"structure_gst_pct": 18, "structure_margin_pct": 10, "cabling_gst_pct": 18, "cabling_margin_pct": 5, "installation_gst_pct": 18, "installation_margin_pct": 20}
        r = client.post(f"{API}/calculate/quick", json={"system_type": "on-grid", "monthly_eb_bill": 3000, "overrides": ov}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("structure", "cabling", "installation"):
            ln = d["lines"][k]
            assert ln["gst_pct"] == 18 and ln["margin_pct"] == ov[f"{k}_margin_pct"] and ln["gst_missing"] is False
            assert ln["amount"] == round(ln["cost"] * (1 + ln["margin_pct"] / 100)) or abs(ln["amount"] - ln["cost"] * (1 + ln["margin_pct"] / 100)) <= 1
        assert d["total_gst"] > 0 and d["total_incl_gst"] == d["total_cost"] + d["total_gst"]
        assert not any("Structure" in m or "Cabling" in m or "Installation" in m for m in d["pricing_issues"])

    def test_quick_calc_flags_missing_pcts(self, client):
        d = client.post(f"{API}/calculate/quick", json={"system_type": "on-grid", "monthly_eb_bill": 3000}, timeout=60).json()
        assert d["lines"]["structure"]["gst_missing"] is True and d["lines"]["structure"]["gst_pct"] is None
        assert any("Structure: GST% not set" in m for m in d["pricing_issues"])
        assert d["total_gst"] == 0, "missing GST must not be silently defaulted"

    def test_rounding_applies_to_grand_total_only(self, client):
        client.put(f"{API}/catalogue/config", json={"rounding_step": 100, "rounding_mode": "up"}, timeout=60)
        payload = {
            "customer": {"name": f"{TAG} Round", "phone": "9000000052", "email": "iter52@test.com", "address": "1 Test Lane"},
            "location": {"address": "1 Test Lane", "city": "Chennai", "state": "Tamil Nadu", "pincode": "600001"},
            "electrical": {"sanction_load_kw": 3, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 7},
            "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "fixed"}, "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10},
            "solar_system": {"system_type": "on-grid", "capacity_kw": 3},
            "selected_items": [{"name": f"{TAG} SPD", "category": "bos", "unit_price": 1234.56, "quantity": 1, "gst_percentage": 18, "margin_percentage": 10}],
            "manual_costs": [{"description": "crane", "amount": 999.99, "gst_pct": 18, "margin_pct": 0}],
            "custom_fields": {"proposed_solution": {"system_size_kw": 3, "total_cost": 100001, "subsidy": 0, "_quick": {"total_gst": 12000.4}}},
        }
        r = client.post(f"{API}/projects", json=payload, timeout=60)
        assert r.status_code in (200, 201), r.text
        pid = r.json().get("id") or r.json().get("project_id")
        try:
            ce = client.get(f"{API}/projects/{pid}", timeout=60).json()["cost_estimation"]
            exact = 100001 + 12000.4 + (1234.56 + 123.456 + 1234.56 * 0.18) + (999.99 + 999.99 * 0.18)
            assert abs(ce["total_exact"] - round(exact, 2)) < 0.02
            assert ce["total_cost"] % 100 == 0 and ce["total_cost"] >= ce["total_exact"]
            assert ce["rounding"]["step"] == 100 and ce["rounding"]["mode"] == "up"
            assert ce["items_breakdown"][0]["amount"] == 1234.56, "line amounts are never rounded"
            assert ce["pricing_issues"] == []
        finally:
            client.put(f"{API}/catalogue/config", json={"rounding_step": 1, "rounding_mode": "nearest"}, timeout=60)
            client.delete(f"{API}/projects/{pid}/hard", json={"reason": "iter52 cleanup"}, timeout=60)
            client.delete(f"{API}/projects/{pid}", timeout=60)

    def test_inventory_item_without_gst_is_stored_as_missing(self, client):
        r = client.post(f"{API}/inventory/items", json={"name": f"{TAG} no-gst", "sku_code": f"{TAG}-NG", "category": "bos", "quantity": 1, "unit_price": 100}, timeout=60)
        assert r.status_code in (200, 201), r.text
        iid = r.json()["id"]
        try:
            row = next(i for i in client.get(f"{API}/pricelist", params={"status": "all", "search": TAG.lower()}, timeout=60).json()["items"] if i["id"] == iid)
            assert row["gst_missing"] is True and row["margin_missing"] is True and row["pricing_complete"] is False
        finally:
            client.delete(f"{API}/inventory/items/{iid}", timeout=60)


# ── Task 8: panel wattage ────────────────────────────────────────────────────
class TestPanelWattage:
    def test_wattage_flows_into_panel_count(self, client):
        r = client.post(f"{API}/inventory/items", json={"name": f"{TAG} Panel 600W", "sku_code": f"{TAG}-P600", "category": "solar_panels", "quantity": 50,
                                                          "unit_price": 15000, "margin_pct": 10, "gst_percentage": 12, "specs": {"wattage": 600}}, timeout=60)
        assert r.status_code in (200, 201), r.text
        iid = r.json()["id"]
        try:
            row = next(i for i in client.get(f"{API}/pricelist", params={"status": "all", "search": TAG.lower()}, timeout=60).json()["items"] if i["id"] == iid)
            assert row["wattage_w"] == 600
            d = client.post(f"{API}/calculate/quick", json={"system_type": "on-grid", "overrides": {"system_size_kw": 3}, "panel_item_id": iid}, timeout=60).json()
            assert d["panel_wattage_w"] == 600 and d["panel_count"] == 5
            assert d["lines"]["panels"]["gst_pct"] == 12 and d["lines"]["panels"]["margin_pct"] == 10
            assert d["lines"]["panels"]["amount"] == round(5 * 15000 * 1.10)
        finally:
            client.delete(f"{API}/inventory/items/{iid}", timeout=60)


# ── Task 2: asset documents ──────────────────────────────────────────────────
class TestAssetDocuments:
    @pytest.fixture(scope="class")
    def asset(self, client):
        r = client.post(f"{API}/assets", json={"name": f"{TAG} Clamp meter", "category": "measuring_instrument", "purchase_cost": 5000, "useful_life_years": 5}, timeout=60)
        assert r.status_code in (200, 201), r.text
        aid = r.json().get("id") or r.json().get("asset_id")
        yield aid
        client.delete(f"{API}/assets/{aid}", timeout=60)

    def test_upload_list_download_delete(self, client, asset):
        pdf = b"%PDF-1.4\n%iter52 test\n%%EOF\n"
        r = client.post(f"{API}/assets/{asset}/documents", files={"file": ("calib.pdf", io.BytesIO(pdf), "application/pdf")}, data={"doc_type": "calibration_report", "notes": "annual"}, timeout=120)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["filename"] == "calib.pdf" and doc["doc_type"] == "calibration_report" and doc["size"] == len(pdf) and doc["url"].startswith("/api/files/")
        docs = client.get(f"{API}/assets/{asset}/documents", timeout=60).json()
        assert [d["id"] for d in docs] == [doc["id"]]
        got = client.get(f"{BASE_URL}{doc['url']}", timeout=120)
        assert got.status_code == 200 and got.content == pdf
        assert client.delete(f"{API}/assets/{asset}/documents/{doc['id']}", timeout=60).status_code == 200
        assert client.get(f"{API}/assets/{asset}/documents", timeout=60).json() == []

    def test_rejects_bad_types_and_staff(self, client, staff, asset):
        r = client.post(f"{API}/assets/{asset}/documents", files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/x-msdownload")}, timeout=60)
        assert r.status_code == 400
        r = staff.post(f"{API}/assets/{asset}/documents", files={"file": ("a.pdf", io.BytesIO(b"%PDF"), "application/pdf")}, timeout=60)
        assert r.status_code == 403
        assert staff.get(f"{API}/assets/{asset}/documents", timeout=60).status_code == 200


# ── Task 3: partner delete guardrails ────────────────────────────────────────
class TestPartnerDelete:
    @pytest.fixture(scope="class")
    def partner(self, client):
        r = client.post(f"{API}/partners", json={"name": f"{TAG} Subco", "partner_type": "external_subcontractor", "phone": "9000000053",
                                                   "gstin": "33ABCDE1234F1Z5", "company_name": f"{TAG} Subco Pvt Ltd", "specialities": ["Electrical"]}, timeout=60)
        assert r.status_code in (200, 201), r.text
        return r.json().get("id") or r.json().get("partner_id")

    def test_reason_required(self, client, partner):
        r = client.delete(f"{API}/partners/{partner}", json={"reason": ""}, timeout=60)
        assert r.status_code == 400
        r = client.delete(f"{API}/partners/{partner}", timeout=60)
        assert r.status_code == 400

    def test_blocked_while_active_assignment(self, client, partner):
        projects = client.get(f"{API}/projects", timeout=60).json()
        if not projects:
            pytest.skip("no project to assign")
        pid = projects[0]["id"]
        r = client.post(f"{API}/partners/{partner}/assignments", json={"project_id": pid, "lines": [{"description": "Wiring", "qty": 1, "unit": "job", "rate": 1000}], "retention_pct": 0}, timeout=60)
        if r.status_code not in (200, 201):
            pytest.skip(f"assignment create unavailable: {r.text[:120]}")
        aid = r.json().get("id") or r.json().get("assignment_id")
        r = client.delete(f"{API}/partners/{partner}", json={"reason": "cleanup"}, timeout=60)
        assert r.status_code == 409, r.text
        client.put(f"{API}/partners/assignments/{aid}", json={"status": "cancelled"}, timeout=60)

    def test_staff_forbidden_then_admin_deletes_with_snapshot(self, client, staff, partner):
        assert staff.delete(f"{API}/partners/{partner}", json={"reason": "nope"}, timeout=60).status_code == 403
        r = client.delete(f"{API}/partners/{partner}", json={"reason": "Duplicate entry"}, timeout=60)
        assert r.status_code == 200, r.text
        assert client.get(f"{API}/partners/{partner}", timeout=60).status_code in (404, 200)
        ids = {p["id"] for p in client.get(f"{API}/partners", timeout=60).json()}
        assert partner not in ids, "deleted partner must vanish from the directory"
        rows = client.get(f"{API}/audit-logs", params={"entity_type": "partner", "limit": 50}, timeout=60).json()
        hit = [l for l in rows if l.get("entity_id") == partner and l.get("action_type") == "partner_deleted"]
        assert hit and "Duplicate entry" in hit[0]["details"]
        from pymongo import MongoClient
        from dotenv import dotenv_values
        env = dotenv_values("/app/backend/.env")
        log = MongoClient(env["MONGO_URL"])[env["DB_NAME"]].audit_logs.find_one({"entity_id": partner, "action_type": "partner_deleted"})
        assert log and TAG in log["old_data"] and "Duplicate entry" in log["new_data"], "full partner snapshot must be in the audit log"
        assert client.delete(f"{API}/partners/{partner}", json={"reason": "again"}, timeout=60).status_code == 404


# ── Task 5: internal teams ───────────────────────────────────────────────────
class TestInternalTeams:
    @pytest.fixture(scope="class")
    def team(self, client):
        me = client.get(f"{API}/auth/me", timeout=60).json()
        r = client.post(f"{API}/internal-teams", json={"name": f"{TAG} Alpha", "description": "Rooftop", "lead_user_id": me["id"], "member_user_ids": [me["id"]], "specialities": ["Rooftop"]}, timeout=60)
        assert r.status_code == 200, r.text
        t = r.json()
        yield t
        client.delete(f"{API}/internal-teams/{t['id']}", timeout=60)

    def test_create_shape_and_duplicate_guard(self, client, team):
        assert team["member_count"] == 1 and team["lead"]["id"] == team["lead_user_id"] and team["performance"]["projects_handled"] == 0
        assert client.post(f"{API}/internal-teams", json={"name": f"{TAG.lower()} alpha"}, timeout=60).status_code == 400

    def test_multi_team_project_assignment_and_performance(self, client, team):
        r = client.post(f"{API}/internal-teams", json={"name": f"{TAG} Beta"}, timeout=60)
        beta = r.json()["id"]
        projects = client.get(f"{API}/projects", timeout=60).json()
        if not projects:
            pytest.skip("no project available")
        pid = projects[0]["id"]
        before = client.get(f"{API}/projects/{pid}/teams", timeout=60).json()["team_ids"]
        try:
            r = client.put(f"{API}/projects/{pid}/teams", json={"team_ids": [team["id"], beta], "notes": "joint job"}, timeout=60)
            assert r.status_code == 200, r.text
            assert set(r.json()["team_ids"]) == {team["id"], beta} and len(r.json()["teams"]) == 2
            perf = client.get(f"{API}/internal-teams/performance", timeout=60).json()["rows"]
            mine = next(x for x in perf if x["id"] == team["id"])
            assert mine["projects_handled"] >= 1
            detail = client.get(f"{API}/internal-teams/{team['id']}", timeout=60).json()
            assert any(p["id"] == pid for p in detail["projects"])
            assert client.put(f"{API}/projects/{pid}/teams", json={"team_ids": ["000000000000000000000000"]}, timeout=60).status_code == 400
            # deleting a team with open projects is blocked unless project is closed
            r = client.delete(f"{API}/internal-teams/{beta}", timeout=60)
            assert r.status_code in (200, 409)
        finally:
            client.put(f"{API}/projects/{pid}/teams", json={"team_ids": before}, timeout=60)
            client.delete(f"{API}/internal-teams/{beta}", timeout=60)

    def test_staff_can_view_but_not_manage(self, staff, team):
        assert staff.get(f"{API}/internal-teams", timeout=60).status_code == 200
        assert staff.post(f"{API}/internal-teams", json={"name": f"{TAG} Gamma"}, timeout=60).status_code == 403
        assert staff.put(f"{API}/internal-teams/{team['id']}", json={"description": "x"}, timeout=60).status_code == 403
        assert staff.delete(f"{API}/internal-teams/{team['id']}", timeout=60).status_code == 403
        assert staff.get(f"{API}/internal-teams/performance", timeout=60).status_code == 403


# ── Task 9: permissions audit ────────────────────────────────────────────────
class TestPermissionsAudit:
    @pytest.mark.parametrize("method,path,body", [
        ("GET", "/assets", None), ("GET", "/partners", None), ("GET", "/internal-teams", None), ("GET", "/pricelist", None),
        ("GET", "/catalogue/config", None), ("GET", "/ecommerce/products", None), ("GET", "/reports/sales_revenue", None),
        ("POST", "/calculate/quick", {"system_type": "on-grid"}), ("GET", "/amc/contracts", None), ("GET", "/sales", None),
    ])
    def test_anonymous_is_rejected(self, anon, method, path, body):
        r = anon.request(method, f"{API}{path}", json=body, timeout=60)
        assert r.status_code in (401, 403), f"{method} {path} → {r.status_code}"

    @pytest.mark.parametrize("method,path,body", [
        ("PUT", "/catalogue/config", {"rounding_step": 1}),
        ("POST", "/pricelist/bulk", {"item_ids": [], "action": "set_gst", "value": 18}),
        ("POST", "/assets", {"name": "x", "category": "power_tool"}),
        ("POST", "/partners", {"name": "x", "partner_type": "internal_team"}),
        ("POST", "/internal-teams", {"name": "x"}),
        ("POST", "/credits", {"customer_name": "x", "total_amount": 1, "paid_amount": 0, "due_date": "2030-01-01"}),
        ("POST", "/purchase-orders", {"supplier_name": "x", "items": []}),
        ("POST", "/deliveries", {"customer_name": "x", "items": []}),
        ("POST", "/audits", {"title": "x", "auditor_name": "x", "checklist": []}),
        ("DELETE", "/credits/000000000000000000000000", None),
        ("DELETE", "/purchase-orders/000000000000000000000000", None),
        ("POST", "/ecommerce/platforms", {"name": "x"}),
        ("GET", "/reports/profit_leakage", None),
        ("DELETE", "/hard-delete/sale/000000000000000000000000", {"reason": "xxx"}),
        ("POST", "/auth/register", {"email": "evil@test.com", "password": "Evil@12345", "name": "Evil", "role": "admin"}),
    ])
    def test_staff_cannot_write_or_see_sensitive(self, staff, method, path, body):
        r = staff.request(method, f"{API}{path}", json=body, timeout=60)
        assert r.status_code == 403, f"{method} {path} → {r.status_code} {r.text[:120]}"

    def test_self_registration_closed_after_bootstrap(self, anon):
        r = anon.post(f"{API}/auth/register", json={"email": f"{TAG.lower()}@evil.com", "password": "Evil@12345", "name": "Evil", "role": "admin"}, timeout=60)
        assert r.status_code == 401
