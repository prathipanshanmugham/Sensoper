"""
Iteration 26 — TNEB Auto-Fetch + Solar Report + PDF Merge tests
Endpoints under test:
- POST /api/tneb/fetch
- GET  /api/solar/irradiation
- POST /api/solar/sizing
- POST /api/solar/merge-pdf
"""
import io
import math
import os
import pytest
import requests
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://solar-ops-management.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@sensoper.com"
ADMIN_PASSWORD = TEST_ADMIN_PASSWORD


# ----------- fixtures -----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text[:200]}")
    return s


def _minimal_pdf_bytes(text="Test PDF"):
    """Generate a tiny valid 1-page PDF using pypdf."""
    from pypdf import PdfWriter
    from pypdf.generic import RectangleObject
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    buf.seek(0)
    return buf.read()


def _multi_page_pdf(n=2):
    from pypdf import PdfWriter
    writer = PdfWriter()
    for _ in range(n):
        writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    buf.seek(0)
    return buf.read()


# ----------- TNEB /api/tneb/fetch -----------
class TestTnebFetch:
    def test_fetch_no_provider_configured_returns_manual_fallback(self, session):
        r = session.post(f"{BASE_URL}/api/tneb/fetch",
                         json={"service_number": "123456789", "phone": "9876543210"},
                         timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("success") is False
        assert d.get("fallback") == "manual"
        assert "not configured" in (d.get("message") or "").lower()
        assert d.get("data") is None

    def test_fetch_short_service_number_returns_400(self, session):
        r = session.post(f"{BASE_URL}/api/tneb/fetch",
                         json={"service_number": "123", "phone": "9876543210"},
                         timeout=20)
        assert r.status_code == 400
        assert "service number" in r.json()["detail"].lower()

    def test_fetch_invalid_phone_returns_400(self, session):
        r = session.post(f"{BASE_URL}/api/tneb/fetch",
                         json={"service_number": "123456", "phone": "12345"},
                         timeout=20)
        assert r.status_code == 400
        assert "10-digit" in r.json()["detail"] or "phone" in r.json()["detail"].lower()

    def test_fetch_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/tneb/fetch",
                          json={"service_number": "123456", "phone": "9876543210"},
                          timeout=20)
        assert r.status_code in (401, 403)


# ----------- NASA POWER /api/solar/irradiation -----------
class TestSolarIrradiation:
    def test_irradiation_chennai(self, session):
        r = session.get(f"{BASE_URL}/api/solar/irradiation",
                        params={"lat": 13.08, "lng": 80.27}, timeout=40)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "annual_avg_kwh_m2_day" in d
        val = d["annual_avg_kwh_m2_day"]
        assert isinstance(val, (int, float))
        assert 2 < val < 8, f"Unrealistic irradiation: {val}"
        assert d.get("source") in ("NASA POWER", "fallback (India avg)")
        assert d.get("lat") == 13.08
        assert d.get("lng") == 80.27

    def test_irradiation_invalid_lat(self, session):
        r = session.get(f"{BASE_URL}/api/solar/irradiation",
                        params={"lat": 100, "lng": 80}, timeout=20)
        assert r.status_code == 400

    def test_irradiation_invalid_lng(self, session):
        r = session.get(f"{BASE_URL}/api/solar/irradiation",
                        params={"lat": 13, "lng": 999}, timeout=20)
        assert r.status_code == 400


# ----------- Sizing calc /api/solar/sizing -----------
class TestSolarSizing:
    def test_typical_residential(self, session):
        r = session.post(f"{BASE_URL}/api/solar/sizing", json={
            "monthly_consumption_units": 450,
            "tariff_category": "Domestic",
            "avg_monthly_bill": 3200,
            "irradiation_kwh_m2_day": 5.5,
        }, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert {"sizing", "financials", "technical", "assumptions"} <= set(d.keys())

        s = d["sizing"]
        assert 3.5 <= s["kwp_recommended"] <= 4.5, f"kwp={s['kwp_recommended']}"
        expected_panels = math.ceil(s["kwp_recommended"] * 1000 / 550)
        assert s["num_panels"] == expected_panels
        assert s["panel_wattage_w"] == 550
        assert s["inverter_capacity_kw"] > 0
        assert s["battery_ah"] == 0  # on-grid default

        f = d["financials"]
        assert f["subsidy"] == 78000  # domestic on-grid, ≥3 kW
        assert f["total_cost"] > 0
        assert f["net_cost"] == max(f["total_cost"] - 78000, 0)
        assert len(f["yearly_breakdown"]) == 25
        for row in f["yearly_breakdown"]:
            assert {"year", "generation_units", "tariff", "savings", "cumulative"} <= set(row.keys())
        # cumulative monotonic
        cums = [row["cumulative"] for row in f["yearly_breakdown"]]
        assert cums == sorted(cums)

        t = d["technical"]
        assert t["performance_ratio"] == 0.75
        assert 10 <= t["cuf_pct"] <= 25
        assert t["co2_offset_kg_per_year"] > 0

    def test_commercial_no_subsidy(self, session):
        r = session.post(f"{BASE_URL}/api/solar/sizing", json={
            "monthly_consumption_units": 1500,
            "tariff_category": "Commercial",
            "irradiation_kwh_m2_day": 5.5,
        }, timeout=20)
        assert r.status_code == 200
        assert r.json()["financials"]["subsidy"] == 0

    def test_offgrid_has_battery(self, session):
        r = session.post(f"{BASE_URL}/api/solar/sizing", json={
            "monthly_consumption_units": 450,
            "tariff_category": "Domestic",
            "irradiation_kwh_m2_day": 5.5,
            "system_type": "off-grid",
        }, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["sizing"]["battery_ah"] > 0
        assert d["sizing"]["battery_voltage"] == 48
        assert d["financials"]["subsidy"] == 0  # off-grid no subsidy

    def test_tiny_consumption_min_kwp(self, session):
        r = session.post(f"{BASE_URL}/api/solar/sizing", json={
            "monthly_consumption_units": 10,
            "tariff_category": "Domestic",
            "irradiation_kwh_m2_day": 5.5,
        }, timeout=20)
        assert r.status_code == 200
        assert r.json()["sizing"]["kwp_recommended"] >= 0.5

    def test_sizing_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/solar/sizing",
                          json={"monthly_consumption_units": 450}, timeout=20)
        assert r.status_code in (401, 403)


# ----------- PDF Merge /api/solar/merge-pdf -----------
class TestPdfMerge:
    def test_merge_prepend(self, session):
        gen = _minimal_pdf_bytes()         # 1 page
        upl = _multi_page_pdf(2)           # 2 pages
        files = {
            "generated_pdf": ("gen.pdf", gen, "application/pdf"),
            "uploaded_pdf": ("upl.pdf", upl, "application/pdf"),
        }
        data = {"position": "prepend"}
        r = session.post(f"{BASE_URL}/api/solar/merge-pdf",
                         files=files, data=data, timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert "attachment" in r.headers.get("content-disposition", "")

        from pypdf import PdfReader
        merged = PdfReader(io.BytesIO(r.content))
        assert len(merged.pages) == 3  # 1 gen + 2 upl

    def test_merge_append(self, session):
        gen = _minimal_pdf_bytes()
        upl = _multi_page_pdf(2)
        files = {
            "generated_pdf": ("gen.pdf", gen, "application/pdf"),
            "uploaded_pdf": ("upl.pdf", upl, "application/pdf"),
        }
        r = session.post(f"{BASE_URL}/api/solar/merge-pdf",
                         files=files, data={"position": "append"}, timeout=30)
        assert r.status_code == 200
        from pypdf import PdfReader
        merged = PdfReader(io.BytesIO(r.content))
        assert len(merged.pages) == 3

    def test_merge_missing_files(self, session):
        r = session.post(f"{BASE_URL}/api/solar/merge-pdf",
                         data={"position": "prepend"}, timeout=20)
        # FastAPI returns 422 for missing required form fields
        assert r.status_code in (400, 422)

    def test_merge_empty_pdf(self, session):
        files = {
            "generated_pdf": ("gen.pdf", b"", "application/pdf"),
            "uploaded_pdf": ("upl.pdf", _minimal_pdf_bytes(), "application/pdf"),
        }
        r = session.post(f"{BASE_URL}/api/solar/merge-pdf",
                         files=files, data={"position": "prepend"}, timeout=30)
        assert r.status_code == 400

    def test_merge_requires_auth(self):
        gen = _minimal_pdf_bytes()
        upl = _minimal_pdf_bytes()
        files = {
            "generated_pdf": ("gen.pdf", gen, "application/pdf"),
            "uploaded_pdf": ("upl.pdf", upl, "application/pdf"),
        }
        r = requests.post(f"{BASE_URL}/api/solar/merge-pdf",
                          files=files, data={"position": "prepend"}, timeout=20)
        assert r.status_code in (401, 403)


# ----------- Regression: iteration_25 critical endpoints -----------
class TestRegressionIter25:
    def test_auth_me_works(self, session):
        r = session.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json().get("email") == ADMIN_EMAIL

    def test_accounts_list(self, session):
        r = session.get(f"{BASE_URL}/api/accounts", timeout=15)
        assert r.status_code == 200, r.text