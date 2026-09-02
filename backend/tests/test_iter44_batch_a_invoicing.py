"""Iteration 44 Batch A — GST Tax Invoice + Profit Calculator tests."""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0]).rstrip("/")
ADMIN = {"email": "admin@sensoper.com", "password": "Admin@123"}
MANAGER = {"email": "qa_mgr_iter46@sensoper.com", "password": "Manager@123"}
STAFF = {"email": "qa_staff_iter46@sensoper.com", "password": "Staff@123"}


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def manager_client():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=MANAGER, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def staff_client():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=STAFF, timeout=15)
    assert r.status_code == 200, r.text
    return s


def _create_test_project(admin_client, tag):
    """A minimal project with confirmed cost_estimation to invoice/profit against."""
    payload = {
        "customer": {"name": f"Invoice Test {tag}", "phone": "9000000099", "email": "t@t.com", "address": "1 Test St"},
        "location": {"latitude": 13.08, "longitude": 80.27, "state": "Tamil Nadu", "district": "Chennai", "address": "Site addr"},
        "electrical": {"sanction_load_kw": 5, "connected_load_kw": 5, "monthly_consumption_units": 400, "eb_tariff": 8},
        "solar_system": {"system_type": "on-grid", "panel_wattage": 540},
        "mounting": {"roof_type": "RCC Flat Roof", "tilt_angle": 15, "structure_type": "Standard"},
        "additional": {"cable_length_meters": 10, "inverter_to_panel_distance": 5},
        "selected_items": [{"name": "TestPanel", "category": "panel", "unit_price": 10000, "quantity": 5,
                             "gst_percentage": 18, "margin_percentage": 10}],
        "manual_costs": [{"description": "Installation labour", "amount": 2000}],
    }
    r = admin_client.post(f"{BASE_URL}/api/projects", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def project_id(admin_client):
    return _create_test_project(admin_client, uuid.uuid4().hex[:6])


class TestInvoiceNumberSequence:
    def test_generate_returns_sequential_numbers(self, admin_client):
        p1 = _create_test_project(admin_client, uuid.uuid4().hex[:6])
        p2 = _create_test_project(admin_client, uuid.uuid4().hex[:6])
        r1 = admin_client.post(f"{BASE_URL}/api/projects/{p1}/invoice", json={}, timeout=15)
        r2 = admin_client.post(f"{BASE_URL}/api/projects/{p2}/invoice", json={}, timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        n1 = int(r1.json()["invoice_number"].split("-")[-1])
        n2 = int(r2.json()["invoice_number"].split("-")[-1])
        assert n2 == n1 + 1

    def test_regenerate_is_idempotent(self, admin_client, project_id):
        r1 = admin_client.post(f"{BASE_URL}/api/projects/{project_id}/invoice", json={}, timeout=15)
        assert r1.status_code == 200
        num1 = r1.json()["invoice_number"]
        r2 = admin_client.post(f"{BASE_URL}/api/projects/{project_id}/invoice", json={}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["invoice_number"] == num1
        assert r2.json()["already_existed"] is True

    def test_settings_are_admin_configurable(self, admin_client):
        r = admin_client.put(f"{BASE_URL}/api/invoice-settings", json={"prefix": "TESTSEQ", "next_number": 500}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"prefix": "TESTSEQ", "next_number": 500}
        p = _create_test_project(admin_client, uuid.uuid4().hex[:6])
        r2 = admin_client.post(f"{BASE_URL}/api/projects/{p}/invoice", json={}, timeout=15)
        assert r2.json()["invoice_number"] == "TESTSEQ-0500"
        # restore a sane default so other tests/humans aren't confused
        admin_client.put(f"{BASE_URL}/api/invoice-settings", json={"prefix": "INV", "next_number": 1000}, timeout=15)

    def test_settings_put_is_admin_only(self, manager_client):
        r = manager_client.put(f"{BASE_URL}/api/invoice-settings", json={"prefix": "X"}, timeout=15)
        assert r.status_code == 403


class TestGstSplitLogic:
    def test_intra_state_uses_cgst_sgst(self, admin_client, project_id):
        r = admin_client.get(f"{BASE_URL}/api/projects/{project_id}/invoice", timeout=15)
        inv = r.json()
        assert inv["place_of_supply"] == "Tamil Nadu"
        assert inv["total_igst"] == 0
        assert inv["total_cgst"] > 0 and inv["total_sgst"] > 0
        assert abs(inv["total_cgst"] - inv["total_sgst"]) < 0.01

    def test_inter_state_uses_igst(self, admin_client):
        p = _create_test_project(admin_client, uuid.uuid4().hex[:6])
        r = admin_client.post(f"{BASE_URL}/api/projects/{p}/invoice",
                               json={"place_of_supply_override": "Karnataka"}, timeout=15)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["place_of_supply"] == "Karnataka"
        assert inv["total_cgst"] == 0 and inv["total_sgst"] == 0
        assert inv["total_igst"] > 0

    def test_grand_total_matches_taxable_plus_gst(self, admin_client, project_id):
        inv = admin_client.get(f"{BASE_URL}/api/projects/{project_id}/invoice", timeout=15).json()
        expected = round(inv["total_taxable_value"] + inv["total_cgst"] + inv["total_sgst"] + inv["total_igst"], 2)
        assert abs(inv["grand_total"] - expected) < 0.02

    def test_amount_in_words_present(self, admin_client, project_id):
        inv = admin_client.get(f"{BASE_URL}/api/projects/{project_id}/invoice", timeout=15).json()
        assert "Rupees" in inv["amount_in_words"] and "Only" in inv["amount_in_words"]


class TestBillingAccessRestriction:
    def test_staff_cannot_view_invoice(self, staff_client, project_id):
        r = staff_client.get(f"{BASE_URL}/api/projects/{project_id}/invoice", timeout=15)
        assert r.status_code == 403

    def test_manager_can_view_invoice(self, manager_client, project_id):
        r = manager_client.get(f"{BASE_URL}/api/projects/{project_id}/invoice", timeout=15)
        assert r.status_code == 200


class TestProfitCalculatorRoleRestriction:
    def test_admin_can_view_profit(self, admin_client, project_id):
        r = admin_client.get(f"{BASE_URL}/api/projects/{project_id}/profit", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "gross_profit" in body and "gross_margin_pct" in body and "material_cost" in body

    def test_manager_cannot_view_profit(self, manager_client, project_id):
        r = manager_client.get(f"{BASE_URL}/api/projects/{project_id}/profit", timeout=15)
        assert r.status_code == 403

    def test_staff_cannot_view_profit(self, staff_client, project_id):
        r = staff_client.get(f"{BASE_URL}/api/projects/{project_id}/profit", timeout=15)
        assert r.status_code == 403

    def test_profit_reads_same_cost_data_as_estimation(self, admin_client, project_id):
        proj = admin_client.get(f"{BASE_URL}/api/projects/{project_id}", timeout=15).json()
        profit = admin_client.get(f"{BASE_URL}/api/projects/{project_id}/profit", timeout=15).json()
        ce = proj["cost_estimation"]
        expected_revenue = round(ce["total_cost"] - ce["total_gst"], 2)
        assert abs(profit["revenue"] - expected_revenue) < 0.02
