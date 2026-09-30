"""Iter 59 — pricing_slabs: pure slab picking, admin CRUD + validation, lookup, calculator slab mode, kit slab price."""
import os
import sys
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST59_{uuid.uuid4().hex[:5]}"
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "Admin@123")
sys.path.insert(0, "/app/backend")


def _db():
    import pymongo
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    return pymongo.MongoClient(env["MONGO_URL"])[env["DB_NAME"]]


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    assert s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": ADMIN_PW}, timeout=60).status_code == 200
    return s


@pytest.fixture(scope="module")
def category(admin):
    """A throwaway kit category so real on-grid slab data (if any) is never touched."""
    r = admin.post(f"{API}/kit-categories", json={"label": f"{TAG} Cat"}, timeout=60)
    assert r.status_code == 200, r.text
    yield r.json()
    db = _db()
    db.pricing_slabs.delete_many({"category": {"$regex": "^test59-"}})
    db.material_kits.delete_many({"name": {"$regex": f"^{TAG}"}})
    db.kit_categories.delete_many({"label": {"$regex": f"^{TAG}"}})
    db.pricing_slabs.delete_many({"category": "__test59_ongrid_tmp__"})


SLABS = [
    {"from_value": 1, "to_value": 3, "rate_per_unit": 60000, "effective_from": "2026-01-01"},
    {"from_value": 3, "to_value": 5, "rate_per_unit": 55000, "effective_from": "2026-01-01"},
    {"from_value": 5, "to_value": 10, "rate_per_unit": 50000, "effective_from": "2026-01-01"},
    {"from_value": 10, "to_value": None, "rate_per_unit": 45000, "effective_from": "2026-01-01"},
    {"from_value": 3, "to_value": 5, "rate_per_unit": 53000, "effective_from": "2026-09-01"},   # later version of 3–5
    {"from_value": 3, "to_value": 5, "rate_per_unit": 99000, "effective_from": "2099-01-01"},   # scheduled, not yet live
]


class TestPure:
    def test_boundary_goes_to_lower_slab_and_open_top(self):
        from pricing_slabs import pick_slab, price_for
        assert pick_slab(SLABS, 3, "2026-06-01")["rate_per_unit"] == 60000     # 3 → 1–3
        assert pick_slab(SLABS, 3.5, "2026-06-01")["rate_per_unit"] == 55000
        assert pick_slab(SLABS, 5, "2026-06-01")["rate_per_unit"] == 55000     # 5 → 3–5
        assert pick_slab(SLABS, 12, "2026-06-01")["rate_per_unit"] == 45000    # open-ended
        assert pick_slab(SLABS, 0.5, "2026-06-01") is None
        doc = {"category": "x", "unit": "kw", "gst_pct": 13.8, "slabs": SLABS, "active": True}
        p = price_for(doc, 5, "2026-06-01")
        assert p["total"] == 275000 and p["gst_amount"] == round(275000 * 0.138) and p["gst_missing"] is False
        assert price_for({**doc, "gst_pct": None}, 5, "2026-06-01")["gst_missing"] is True
        assert price_for({**doc, "active": False}, 5) is None and price_for(doc, 0) is None

    def test_effective_from_versioning(self):
        from pricing_slabs import pick_slab
        assert pick_slab(SLABS, 4, "2026-06-01")["rate_per_unit"] == 55000    # before Sept version
        assert pick_slab(SLABS, 4, "2026-09-15")["rate_per_unit"] == 53000    # Sept version live
        assert pick_slab(SLABS, 4, "2026-09-01")["rate_per_unit"] == 53000    # inclusive on the effective day
        assert pick_slab(SLABS, 4, "2098-12-31")["rate_per_unit"] == 53000    # 2099 version not yet
        assert pick_slab(SLABS, 4, "2099-01-01")["rate_per_unit"] == 99000

    def test_validation(self):
        from fastapi import HTTPException
        from pricing_slabs import validate_slabs
        validate_slabs(SLABS)
        for bad in ([{"from_value": 1, "to_value": 1, "rate_per_unit": 1, "effective_from": "2026-01-01"}],
                    [{"from_value": 1, "to_value": 4, "rate_per_unit": 1, "effective_from": "2026-01-01"}, {"from_value": 3, "to_value": 6, "rate_per_unit": 1, "effective_from": "2026-01-01"}],
                    [{"from_value": 1, "to_value": None, "rate_per_unit": 1, "effective_from": "2026-01-01"}, {"from_value": 5, "to_value": 8, "rate_per_unit": 1, "effective_from": "2026-01-01"}],
                    [{"from_value": 1, "to_value": 3, "rate_per_unit": 1, "effective_from": "bad"}],
                    [{"from_value": 1, "to_value": 3, "rate_per_unit": 1, "effective_from": "2026-01-01"}] * 2):
            with pytest.raises(HTTPException):
                validate_slabs(bad)


class TestApi:
    def test_crud_lookup_rbac(self, admin, category):
        slug = category["slug"]
        assert admin.get(f"{API}/pricing-slabs/lookup", params={"category": slug, "value": 3}, timeout=60).status_code == 404
        assert admin.post(f"{API}/pricing-slabs", json={"category": "nope-cat", "slabs": SLABS}, timeout=60).status_code == 400
        assert admin.post(f"{API}/pricing-slabs", json={"category": slug, "unit": "tonne", "slabs": SLABS}, timeout=60).status_code == 400
        r = admin.post(f"{API}/pricing-slabs", json={"category": slug, "unit": "kw", "gst_pct": 13.8, "slabs": SLABS}, timeout=60)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["unit"] == "kw" and len(doc["slabs"]) == 6
        assert admin.post(f"{API}/pricing-slabs", json={"category": slug, "slabs": SLABS}, timeout=60).status_code == 409
        lk = admin.get(f"{API}/pricing-slabs/lookup", params={"category": slug, "value": 5}, timeout=60).json()
        assert lk["rate_per_unit"] in (55000, 53000) and lk["total"] == lk["rate_per_unit"] * 5 and lk["gst_pct"] == 13.8
        lk_old = admin.get(f"{API}/pricing-slabs/lookup", params={"category": slug, "value": 4, "on_date": "2026-03-01"}, timeout=60).json()
        assert lk_old["rate_per_unit"] == 55000
        assert admin.get(f"{API}/pricing-slabs/lookup", params={"category": slug, "value": 0.2}, timeout=60).status_code == 404
        # overlap rejected on update
        bad = admin.put(f"{API}/pricing-slabs/{doc['id']}", json={"slabs": [{"from_value": 1, "to_value": 4, "rate_per_unit": 1, "effective_from": "2026-01-01"}, {"from_value": 3, "to_value": 6, "rate_per_unit": 1, "effective_from": "2026-01-01"}]}, timeout=60)
        assert bad.status_code == 400 and "overlap" in bad.json()["detail"]
        # inactive → hidden from list + lookup 404
        assert admin.put(f"{API}/pricing-slabs/{doc['id']}", json={"active": False}, timeout=60).status_code == 200
        assert slug not in {d["category"] for d in admin.get(f"{API}/pricing-slabs", timeout=60).json()}
        assert slug in {d["category"] for d in admin.get(f"{API}/pricing-slabs", params={"include_inactive": "true"}, timeout=60).json()}
        assert admin.get(f"{API}/pricing-slabs/lookup", params={"category": slug, "value": 5}, timeout=60).status_code == 404
        admin.put(f"{API}/pricing-slabs/{doc['id']}", json={"active": True}, timeout=60)
        listed = next(d for d in admin.get(f"{API}/pricing-slabs", timeout=60).json() if d["category"] == slug)
        assert listed["category_label"] == f"{TAG} Cat"
        # RBAC: anonymous blocked
        assert requests.post(f"{API}/pricing-slabs", json={"category": slug, "slabs": []}, timeout=60).status_code in (401, 403)
        assert _db().audit_logs.find_one({"action_type": "pricing_slabs_created", "entity_id": doc["id"]})

    def test_kit_slab_price_by_size(self, admin, category):
        slug = category["slug"]
        k = admin.post(f"{API}/material-kits", json={"name": f"{TAG} kit", "category": slug, "size_value": 4, "lines": [{"name": "Cam", "quantity": 4}]}, timeout=60)
        assert k.status_code == 200, k.text
        kit = admin.get(f"{API}/material-kits/{k.json()['id']}", timeout=60).json()
        assert kit["size_value"] == 4 and kit["slab_price"]["total"] == kit["slab_price"]["rate_per_unit"] * 4
        assert kit["slab_price"]["rate_per_unit"] in (55000, 53000)
        listed = next(x for x in admin.get(f"{API}/material-kits", params={"category": slug}, timeout=60).json() if x["id"] == kit["id"])
        assert listed["slab_price"]["total"] == kit["slab_price"]["total"]
        # a kit whose size has no band → slab_price None
        k2 = admin.post(f"{API}/material-kits", json={"name": f"{TAG} kit tiny", "category": slug, "size_value": 0.5, "lines": []}, timeout=60)
        assert admin.get(f"{API}/material-kits/{k2.json()['id']}", timeout=60).json()["slab_price"] is None


class TestCalculator:
    def test_compute_quick_slab_mode(self):
        from quick_calc import compute_quick
        cfg = {"cost_per_kwp": {"on-grid": 55000}, "default_specific_yield": 4.4, "default_tariff_per_unit": 8}
        doc = {"category": "on-grid", "unit": "kw", "gst_pct": 13.8, "slabs": SLABS, "active": True}
        base = {"system_type": "on-grid", "monthly_eb_bill": 3000, "overrides": {"system_size_kw": 3, "structure_gst_pct": 18, "structure_margin_pct": 10, "cabling_gst_pct": 18, "cabling_margin_pct": 10, "installation_gst_pct": 18, "installation_margin_pct": 10}}
        item = compute_quick(base, cfg, slab_doc=doc)
        assert item["pricing_source"] == "itemised" and item["slab"]["rate_per_unit"] == 60000 and item["total_cost"] == item["itemised_total"]
        slab = compute_quick({**base, "pricing_mode": "slab"}, cfg, slab_doc=doc)
        assert slab["pricing_source"] == "slab" and slab["total_cost"] == 180000 and slab["total_gst"] == round(180000 * 0.138)
        assert slab["itemised_total"] == item["total_cost"] and slab["pricing_issues"] == []
        assert slab["net_cost"] == 180000 and slab["payback_years"] != item["payback_years"]
        # no slab doc → mode ignored, itemised
        none = compute_quick({**base, "pricing_mode": "slab"}, cfg)
        assert none["pricing_source"] == "itemised" and none["slab"] is None
        # slab without GST flags it
        nog = compute_quick({**base, "pricing_mode": "slab"}, cfg, slab_doc={**doc, "gst_pct": None})
        assert nog["total_gst"] == 0 and any("GST%" in m for m in nog["pricing_issues"])

    def test_quick_endpoint_uses_category_doc(self, admin):
        db = _db()
        # temporarily give on-grid a slab doc only if none exists (never overwrite real data)
        existing = db.pricing_slabs.find_one({"category": "on-grid"})
        inserted = None
        if not existing:
            inserted = db.pricing_slabs.insert_one({"category": "on-grid", "unit": "kw", "gst_pct": 13.8, "slabs": SLABS, "active": True}).inserted_id
        try:
            r = admin.post(f"{API}/calculate/quick", json={"system_type": "on-grid", "monthly_eb_bill": 3000, "pricing_mode": "slab", "overrides": {"system_size_kw": 3}}, timeout=60)
            assert r.status_code == 200, r.text
            res = r.json()
            assert res["slab"] is not None and res["pricing_source"] == "slab" and res["total_cost"] == res["slab"]["total"]
            r2 = admin.post(f"{API}/calculate/quick", json={"system_type": "on-grid", "monthly_eb_bill": 3000, "overrides": {"system_size_kw": 3}}, timeout=60).json()
            assert r2["pricing_source"] == "itemised" and r2["slab"]["total"] == res["total_cost"]
        finally:
            if inserted:
                db.pricing_slabs.delete_one({"_id": inserted})
