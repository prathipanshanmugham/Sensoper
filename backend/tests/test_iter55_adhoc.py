"""Iter 55 — ad-hoc quotation lines: calculation parity, promotion to inventory, near-duplicate linking, price lock, kit feed."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST55_{uuid.uuid4().hex[:5]}"
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": ADMIN_PW}, timeout=60).status_code == 200
    return s


def _project_payload(items):
    return {"customer": {"name": f"{TAG} Customer", "phone": "9000000055", "email": "i55@test.com", "address": "1 Lane"},
            "location": {"address": "1 Lane", "city": "Erode", "state": "Tamil Nadu", "pincode": "638001"},
            "electrical": {"sanction_load_kw": 3, "connected_load_kw": 3, "monthly_consumption_units": 300, "eb_tariff": 7},
            "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "fixed"}, "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10},
            "solar_system": {"system_type": "on-grid", "capacity_kw": 3}, "selected_items": items, "manual_costs": []}


ADHOC = {"inventory_item_id": None, "is_adhoc": True, "name": f"{TAG} Waaree 585W TOPCon Panel", "category": "panels", "specification": "585W bifacial",
         "unit_price": 12500, "gst_percentage": 12, "hsn_code": "8541", "quantity": 4, "margin_percentage": 10, "supplier_hint": "Waaree Coimbatore"}


@pytest.fixture(scope="module")
def project(admin):
    r = admin.post(f"{API}/projects", json=_project_payload([ADHOC]), timeout=60)
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    yield pid
    admin.delete(f"{API}/projects/{pid}/force", timeout=60)


class TestAdhocParity:
    def test_adhoc_line_calculates_like_a_normal_line(self, admin, project):
        p = admin.get(f"{API}/projects/{project}", timeout=60).json()
        line = next(si for si in p["selected_items"] if si.get("is_adhoc"))
        assert line["line_id"] and line["inventory_item_id"] is None and line["promoted"] is False
        bd = next(b for b in p["cost_estimation"]["items_breakdown"] if b.get("is_adhoc"))
        assert bd["amount"] == 12500 * 4
        assert bd["gst_amount"] == round(12500 * 4 * 0.12, 2)
        assert bd["margin_amount"] == round(12500 * 4 * 0.10, 2)
        assert bd["hsn_code"] == "8541" and bd["line_id"] == line["line_id"]
        # identical numbers to a normal (inventory-linked) line with same price/qty/gst/margin
        inv = admin.get(f"{API}/inventory/items", timeout=60).json()
        real = next((i for i in inv if i.get("gst_percentage") is not None), None)
        if real:
            normal = {"inventory_item_id": real["id"], "name": real["name"], "category": real["category"], "unit_price": 12500, "gst_percentage": 12, "quantity": 4, "margin_percentage": 10}
            r = admin.post(f"{API}/projects", json=_project_payload([normal]), timeout=60).json()
            nb = admin.get(f"{API}/projects/{r['id']}", timeout=60).json()["cost_estimation"]["items_breakdown"][0]
            assert (nb["amount"], nb["gst_amount"], nb["margin_amount"]) == (bd["amount"], bd["gst_amount"], bd["margin_amount"])
            admin.delete(f"{API}/projects/{r['id']}/force", timeout=60)

    def test_draft_project_cannot_promote(self, admin, project):
        info = admin.get(f"{API}/projects/{project}/adhoc-lines", timeout=60).json()
        assert info["can_promote"] is False and len(info["lines"]) == 1
        r = admin.post(f"{API}/projects/{project}/adhoc-lines/promote", json={}, timeout=60)
        assert r.status_code == 400 and "confirmed" in r.json()["detail"].lower()


class TestPromotion:
    def test_promote_creates_zero_stock_item_and_locks_price(self, admin, project):
        assert admin.put(f"{API}/projects/{project}", json={"status": "approved"}, timeout=60).status_code == 200
        info = admin.get(f"{API}/projects/{project}/adhoc-lines", timeout=60).json()
        assert info["can_promote"] is True
        line_id = info["lines"][0]["line_id"]
        r = admin.post(f"{API}/projects/{project}/adhoc-lines/promote", json={"line_ids": [line_id]}, timeout=60)
        assert r.status_code == 200, r.text
        res = r.json()["promoted"][0]
        assert res["action"] == "created" and res["sku_code"] and res["hsn_code"] == "8541"
        inv_id = res["inventory_item_id"]
        item = admin.get(f"{API}/inventory/items/{inv_id}", timeout=60).json()
        assert item["quantity"] == 0 and item["unit_price"] == 12500 and item["gst_percentage"] == 12 and item["hsn_code"] == "8541"
        assert item["specs"].get("wattage_w") == 585.0
        p = admin.get(f"{API}/projects/{project}", timeout=60).json()
        line = next(si for si in p["selected_items"] if si.get("line_id") == line_id)
        assert line["promoted"] is True and line["promoted_inventory_item_id"] == inv_id and line["inventory_item_id"] == inv_id and line["is_adhoc"] is True
        assert line["unit_price"] == 12500
        # invoice references the new SKU/HSN
        inv = admin.post(f"{API}/projects/{project}/invoice", json={}, timeout=60)
        assert inv.status_code == 200, inv.text
        li = next(l for l in inv.json()["line_items"] if l["description"] == ADHOC["name"])
        assert li["sku_code"] == res["sku_code"] and li["hsn_sac"] == "8541" and li["inventory_item_id"] == inv_id and li["unit_price"] == 12500
        # price lock: editing the new item's price must not change the project or the invoice
        assert admin.put(f"{API}/inventory/items/{inv_id}", json={"unit_price": 99999}, timeout=60).status_code == 200
        p2 = admin.get(f"{API}/projects/{project}", timeout=60).json()
        assert next(si for si in p2["selected_items"] if si["line_id"] == line_id)["unit_price"] == 12500
        assert next(b for b in p2["cost_estimation"]["items_breakdown"] if b["line_id"] == line_id)["unit_price"] == 12500
        inv2 = admin.get(f"{API}/projects/{project}/invoice", timeout=60).json()
        assert next(l for l in inv2["line_items"] if l["description"] == ADHOC["name"])["unit_price"] == 12500
        # audit trail
        logs = admin.get(f"{API}/audit-logs", params={"action_type": "promote_adhoc_line"}, timeout=60).json()
        assert any(l.get("entity_id") == project and res["sku_code"] in (l.get("details") or "") for l in logs)
        # second promotion → nothing left
        assert admin.post(f"{API}/projects/{project}/adhoc-lines/promote", json={}, timeout=60).status_code == 400
        admin.delete(f"{API}/inventory/items/{inv_id}", timeout=60)

    def test_near_duplicate_warns_and_links_instead(self, admin):
        base = admin.post(f"{API}/inventory/items", json={"name": f"{TAG} Havells 6 sqmm DC Cable", "sku_code": f"{TAG}-CAB", "category": "cables", "quantity": 50, "unit_price": 90, "gst_percentage": 18, "hsn_code": "8544"}, timeout=60).json()
        base_id = base["id"]
        adhoc = {**ADHOC, "name": f"{TAG} Havells 6sqmm DC cable", "category": "cables", "unit_price": 95, "gst_percentage": 18, "hsn_code": "8544", "quantity": 100, "specification": None}
        pid = admin.post(f"{API}/projects", json=_project_payload([adhoc]), timeout=60).json()["id"]
        admin.put(f"{API}/projects/{pid}", json={"status": "completed"}, timeout=60)
        info = admin.get(f"{API}/projects/{pid}/adhoc-lines", timeout=60).json()
        line = info["lines"][0]
        assert any(s["id"] == base_id for s in line["similar"]), line["similar"]
        r = admin.post(f"{API}/projects/{pid}/adhoc-lines/promote", json={"line_ids": [line["line_id"]], "link_existing": {line["line_id"]: base_id}}, timeout=60)
        assert r.status_code == 200 and r.json()["promoted"][0]["action"] == "linked_existing" and r.json()["promoted"][0]["inventory_item_id"] == base_id
        # no duplicate created, base stock unchanged, quoted price kept (95, not 90)
        items = admin.get(f"{API}/inventory/items", timeout=60).json()
        assert sum(1 for i in items if "6" in i["name"] and TAG in i["name"]) == 1
        assert admin.get(f"{API}/inventory/items/{base_id}", timeout=60).json()["quantity"] == 50
        p = admin.get(f"{API}/projects/{pid}", timeout=60).json()
        assert p["selected_items"][0]["unit_price"] == 95 and p["selected_items"][0]["inventory_item_id"] == base_id
        admin.delete(f"{API}/projects/{pid}/force", timeout=60)
        admin.delete(f"{API}/inventory/items/{base_id}", timeout=60)

    def test_promote_all_and_add_to_kit_optional(self, admin):
        lines = [{**ADHOC, "name": f"{TAG} Item A {uuid.uuid4().hex[:4]}"}, {**ADHOC, "name": f"{TAG} Item B {uuid.uuid4().hex[:4]}", "category": "inverter", "specification": "5 kW hybrid"}]
        pid = admin.post(f"{API}/projects", json=_project_payload(lines), timeout=60).json()["id"]
        admin.put(f"{API}/projects/{pid}", json={"status": "approved"}, timeout=60)
        r = admin.post(f"{API}/projects/{pid}/adhoc-lines/promote", json={}, timeout=60)
        assert r.status_code == 200 and len(r.json()["promoted"]) == 2 and r.json()["remaining_adhoc"] == 0
        promoted = r.json()["promoted"]
        kit = admin.post(f"{API}/material-kits", json={"name": f"{TAG} Kit", "system_type": "on-grid", "capacity_kw": 5, "lines": []}, timeout=60).json()
        kr = admin.post(f"{API}/projects/{pid}/adhoc-lines/{promoted[0]['line_id']}/add-to-kit", json={"kit_id": kit["id"], "quantity": 2, "qty_formula": "1 per kW"}, timeout=60)
        assert kr.status_code == 200, kr.text
        k = admin.get(f"{API}/material-kits/{kit['id']}", timeout=60).json()
        assert len(k["lines"]) == 1 and k["lines"][0]["inventory_item_id"] == promoted[0]["inventory_item_id"] and k["lines"][0]["qty_formula"] == "1 per kW"
        # adding the same item twice is refused; second line simply never added (skip is the default)
        assert admin.post(f"{API}/projects/{pid}/adhoc-lines/{promoted[0]['line_id']}/add-to-kit", json={"kit_id": kit["id"]}, timeout=60).status_code == 400
        admin.delete(f"{API}/material-kits/{kit['id']}", timeout=60)
        admin.delete(f"{API}/projects/{pid}/force", timeout=60)
        for pr in promoted:
            admin.delete(f"{API}/inventory/items/{pr['inventory_item_id']}", timeout=60)

    def test_staff_cannot_promote(self, admin):
        email = f"{TAG.lower()}_staff@sensoper.com"
        u = admin.post(f"{API}/users", json={"email": email, "password": "Staff@12345", "name": f"{TAG} Staff", "role": "staff"}, timeout=60).json()
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": email, "password": "Staff@12345"}, timeout=60)
        assert s.post(f"{API}/projects/000000000000000000000000/adhoc-lines/promote", json={}, timeout=60).status_code == 403
        admin.delete(f"{API}/users/{u['id']}", timeout=60)
