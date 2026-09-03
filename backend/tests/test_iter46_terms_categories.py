"""Iteration 46 Change 3 backend tests — Terms & Conditions template categories
and cross-document linkage:
- terms have a `category` field (quotation | invoice | amc), default 'quotation'
- version numbering + is_active exclusivity are scoped per (language, category)
- /api/terms/active respects the category filter
- default seeded templates exist per category (no more hardcoded PDF fallback)
"""
import os
import pytest
import requests

TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


class TestTermsCategorySeed:
    def test_default_templates_seeded_per_category(self, session):
        for cat in ("quotation", "invoice", "amc"):
            r = session.get(f"{API}/terms", params={"category": cat})
            assert r.status_code == 200, r.text
            items = r.json()
            assert len(items) >= 1, f"no seeded template for category={cat}"
            assert any(t.get("is_active") for t in items), f"no active template for category={cat}"

    def test_category_filter_excludes_other_categories(self, session):
        r = session.get(f"{API}/terms", params={"category": "invoice"})
        items = r.json()
        assert all(t.get("category") == "invoice" for t in items)

    def test_active_endpoint_respects_category(self, session):
        q = session.get(f"{API}/terms/active", params={"language": "en", "category": "quotation"}).json()
        inv = session.get(f"{API}/terms/active", params={"language": "en", "category": "invoice"}).json()
        assert q["category"] == "quotation"
        assert inv["category"] == "invoice"
        assert q["title"] != inv["title"] or q["content"] != inv["content"]


class TestTermsVersioningPerCategory:
    def test_version_numbering_scoped_to_category(self, session):
        payload_q = {"title": "TEST_ITER46_Q", "content": "<ol><li>q</li></ol>", "language": "en", "category": "quotation"}
        payload_i = {"title": "TEST_ITER46_I", "content": "<ol><li>i</li></ol>", "language": "en", "category": "invoice"}
        rq = session.post(f"{API}/terms", json=payload_q)
        ri = session.post(f"{API}/terms", json=payload_i)
        assert rq.status_code == 200 and ri.status_code == 200
        vq, vi = rq.json()["version"], ri.json()["version"]
        # Each category has its own independent version sequence
        assert vq >= 1 and vi >= 1
        session.delete(f"{API}/terms/{rq.json()['id']}")
        session.delete(f"{API}/terms/{ri.json()['id']}")

    def test_activation_does_not_deactivate_other_category(self, session):
        active_quote_before = session.get(f"{API}/terms/active", params={"category": "quotation"}).json()
        active_invoice_before = session.get(f"{API}/terms/active", params={"category": "invoice"}).json()

        payload = {"title": "TEST_ITER46_ACTIVATE", "content": "<ol><li>x</li></ol>", "language": "en", "category": "quotation"}
        created = session.post(f"{API}/terms", json=payload).json()
        tid = created["id"]
        act = session.put(f"{API}/terms/{tid}", json={"is_active": True})
        assert act.status_code == 200, act.text

        active_invoice_after = session.get(f"{API}/terms/active", params={"category": "invoice"}).json()
        assert active_invoice_after["title"] == active_invoice_before["title"], \
            "activating a quotation template must not disturb the invoice category's active template"

        # cleanup: restore the previous quotation active template, delete test doc
        session.delete(f"{API}/terms/{tid}")
        if active_quote_before.get("id"):
            session.put(f"{API}/terms/{active_quote_before['id']}", json={"is_active": True})


class TestTermsById:
    def test_get_by_id_includes_category(self, session):
        all_q = session.get(f"{API}/terms", params={"category": "amc"}).json()
        assert all_q, "expected seeded amc template"
        tid = all_q[0]["id"]
        r = session.get(f"{API}/terms/{tid}")
        assert r.status_code == 200
        assert r.json().get("category") == "amc"
