"""Iteration 44 Batch A — API re-verification supporting UI testing.
Covers: invoice-settings role gating (GET manager ok / PUT manager 403),
invoice generation idempotency, intra-state CGST+SGST, profit endpoint 403 for
manager & staff and 200 for admin.
"""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "admin": ("admin@sensoper.com", "Admin@123"),
    "manager": ("qa_mgr_iter46@sensoper.com", "Manager@123"),
    "staff": ("qa_staff_iter46@sensoper.com", "Staff@123"),
}


def _client(role):
    s = requests.Session()
    email, password = CREDS[role]
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login failed for {role}: {r.status_code} {r.text[:300]}")
    return s


@pytest.fixture(scope="module")
def admin():
    return _client("admin")


@pytest.fixture(scope="module")
def manager():
    return _client("manager")


@pytest.fixture(scope="module")
def staff():
    return _client("staff")


@pytest.fixture(scope="module")
def invoiceable_project(admin):
    r = admin.get(f"{API}/projects", timeout=60)
    assert r.status_code == 200, r.text[:300]
    projects = r.json()
    if isinstance(projects, dict):
        projects = projects.get("projects", [])
    for p in projects:
        ce = p.get("cost_estimation") or {}
        if ce.get("items_breakdown"):
            return p
    pytest.skip("No project with cost_estimation.items_breakdown found")


# ── Invoice settings ────────────────────────────────────────────────
class TestInvoiceSettings:
    def test_admin_get(self, admin):
        r = admin.get(f"{API}/invoice-settings", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert isinstance(d["prefix"], str) and isinstance(d["next_number"], int)

    def test_manager_can_view(self, manager):
        r = manager.get(f"{API}/invoice-settings", timeout=30)
        assert r.status_code == 200, r.text[:300]

    def test_manager_cannot_update(self, manager):
        r = manager.put(f"{API}/invoice-settings", json={"prefix": "HACK"}, timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text[:200]}"

    def test_staff_cannot_view(self, staff):
        r = staff.get(f"{API}/invoice-settings", timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"

    def test_admin_update_persists(self, admin):
        before = admin.get(f"{API}/invoice-settings", timeout=30).json()
        r = admin.put(f"{API}/invoice-settings", json={"prefix": "INV", "next_number": before["next_number"]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        after = admin.get(f"{API}/invoice-settings", timeout=30).json()
        assert after["prefix"] == "INV"
        assert after["next_number"] == before["next_number"]


# ── Invoice generation ──────────────────────────────────────────────
class TestInvoiceGeneration:
    def test_generate_and_idempotency_and_gst_split(self, admin, invoiceable_project):
        pid = invoiceable_project.get("id") or invoiceable_project.get("_id")
        r1 = admin.post(f"{API}/projects/{pid}/invoice", json={}, timeout=60)
        assert r1.status_code == 200, r1.text[:400]
        inv1 = r1.json()
        assert inv1["invoice_number"].split("-")[-1].isdigit()
        assert len(inv1["invoice_number"].split("-")[-1]) == 4
        assert inv1["line_items"], "no line items"
        assert inv1["grand_total"] > 0
        assert inv1["amount_in_words"].startswith("Rupees")
        assert inv1["declaration"]
        assert "_id" not in inv1

        # idempotency
        r2 = admin.post(f"{API}/projects/{pid}/invoice", json={}, timeout=60)
        assert r2.status_code == 200
        inv2 = r2.json()
        assert inv2["invoice_number"] == inv1["invoice_number"]
        assert inv2.get("already_existed") is True

        # GET
        r3 = admin.get(f"{API}/projects/{pid}/invoice", timeout=30)
        assert r3.status_code == 200
        assert r3.json()["invoice_number"] == inv1["invoice_number"]

        # intra-state split expected for Tamil Nadu projects
        if inv1["place_of_supply"].strip().lower() == inv1["company"]["state"].strip().lower():
            assert inv1["total_igst"] == 0
            assert abs(inv1["total_cgst"] - inv1["total_sgst"]) < 1
        # grand total consistency
        expected = round(inv1["total_taxable_value"] + inv1["total_cgst"] + inv1["total_sgst"] + inv1["total_igst"], 2)
        assert abs(expected - inv1["grand_total"]) < 0.05

    def test_staff_cannot_generate(self, staff, invoiceable_project):
        pid = invoiceable_project.get("id") or invoiceable_project.get("_id")
        r = staff.post(f"{API}/projects/{pid}/invoice", json={}, timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"

    def test_manager_can_read_invoice(self, manager, invoiceable_project):
        pid = invoiceable_project.get("id") or invoiceable_project.get("_id")
        r = manager.get(f"{API}/projects/{pid}/invoice", timeout=30)
        assert r.status_code == 200, r.text[:300]


# ── Profit calculator ───────────────────────────────────────────────
class TestProfit:
    def test_admin_ok(self, admin, invoiceable_project):
        pid = invoiceable_project.get("id") or invoiceable_project.get("_id")
        r = admin.get(f"{API}/projects/{pid}/profit", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ("revenue", "material_cost", "labour_subcontractor_cost", "other_direct_costs",
                  "gross_profit", "gross_margin_pct", "breakdown_by_category"):
            assert k in d, f"missing {k}"
        assert abs(d["gross_profit"] - (d["revenue"] - d["total_direct_cost"])) < 0.05

    def test_manager_forbidden(self, manager, invoiceable_project):
        pid = invoiceable_project.get("id") or invoiceable_project.get("_id")
        r = manager.get(f"{API}/projects/{pid}/profit", timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text[:200]}"

    def test_staff_forbidden(self, staff, invoiceable_project):
        pid = invoiceable_project.get("id") or invoiceable_project.get("_id")
        r = staff.get(f"{API}/projects/{pid}/profit", timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text[:200]}"
