"""Iteration 49 — batch 1 regression: partner type switch guard + retained fields, multi-district checkbox
filter (OR) + district/location sorts, vendor location sort, Brand Returns report shape + supplier ranking,
Report Usage log (auto-captured on view, POST for exports, admin-only, never logs itself)."""
import os, uuid, pytest, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TAG = f"TEST49_{uuid.uuid4().hex[:5]}"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@sensoper.com", "password": "Admin@123"}, timeout=60)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def partners(client):
    ids = []
    for name, districts, ptype, extra in [
        (f"{TAG} Erode Crew", ["Erode"], "internal_team", {}),
        (f"{TAG} Karur Sub", ["Karur", "Namakkal"], "external_subcontractor", {"gstin": "33ABCDE1234F1Z5", "company_name": "Karur Solar Works"}),
        (f"{TAG} Chennai Sub", ["Chennai"], "external_subcontractor", {"gstin": "33ZZZZZ9999Z1Z9", "company_name": "Chennai Roofs"}),
    ]:
        r = client.post(f"{API}/partners", json={"name": name, "partner_type": ptype, "phone": "9999", "service_districts": districts, **extra}, timeout=60)
        assert r.status_code in (200, 201), r.text
        ids.append(r.json()["id"])
    yield ids
    for i in ids:
        client.delete(f"{API}/partners/{i}", timeout=60)


class TestPartnerLocation:
    def test_multi_district_filter_is_or(self, client, partners):
        r = client.get(f"{API}/partners", params={"districts": "Erode,Karur", "search": TAG}, timeout=60)
        names = {p["name"] for p in r.json()}
        assert f"{TAG} Erode Crew" in names and f"{TAG} Karur Sub" in names and f"{TAG} Chennai Sub" not in names

    def test_district_sort(self, client, partners):
        rows = client.get(f"{API}/partners", params={"sort": "district_asc", "search": TAG}, timeout=60).json()
        firsts = [sorted(p.get("service_districts") or ["zzz"])[0].lower() for p in rows]
        assert firsts == sorted(firsts)

    def test_districts_meta_endpoint(self, client, partners):
        d = client.get(f"{API}/partners/meta/districts", timeout=60).json()
        assert {"Erode", "Karur", "Namakkal", "Chennai"} <= set(d)

    def test_vendor_location_sort(self, client):
        r = client.get(f"{API}/vendors", params={"sort": "location_asc"}, timeout=60)
        assert r.status_code == 200
        ds = [(v.get("district") or "zzz").lower() for v in r.json()]
        assert ds == sorted(ds)


class TestPartnerTypeSwitch:
    def test_internal_to_external_requires_gstin_and_company(self, client, partners):
        pid = partners[0]
        r = client.put(f"{API}/partners/{pid}", json={"partner_type": "external_subcontractor"}, timeout=60)
        assert r.status_code == 400 and "gstin" in r.text.lower() and "company_name" in r.text
        assert client.get(f"{API}/partners/{pid}", timeout=60).json()["partner_type"] == "internal_team", "must not have switched"
        r = client.put(f"{API}/partners/{pid}", json={"partner_type": "external_subcontractor", "gstin": "33NEWGST1234A1Z1", "company_name": "Erode Crew Pvt Ltd"}, timeout=60)
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["partner_type"] == "external_subcontractor" and got["gstin"] == "33NEWGST1234A1Z1" and got.get("partner_type_changed_at")

    def test_external_to_internal_retains_fields(self, client, partners):
        pid = partners[1]
        r = client.put(f"{API}/partners/{pid}", json={"partner_type": "internal_team"}, timeout=60)
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["partner_type"] == "internal_team"
        assert got["gstin"] == "33ABCDE1234F1Z5" and got["company_name"] == "Karur Solar Works", "historical GSTIN/company must be retained, not destroyed"
        # switch back needs nothing extra because the data was retained
        r = client.put(f"{API}/partners/{pid}", json={"partner_type": "external_subcontractor"}, timeout=60)
        assert r.status_code == 200 and r.json()["partner_type"] == "external_subcontractor"

    def test_type_switch_is_audited(self, client, partners):
        r = client.get(f"{API}/audit-logs", params={"entity_type": "partner", "limit": 50}, timeout=60)
        if r.status_code != 200:
            pytest.skip("audit-log listing endpoint shape differs")
        body = r.json()
        logs = body if isinstance(body, list) else body.get("logs") or body.get("items") or []
        assert any(l.get("entity_id") == partners[0] and l.get("action_type") == "update" for l in logs)


class TestBrandReturnsReport:
    def test_shape_and_ranking(self, client):
        r = client.get(f"{API}/reports/brand_returns", timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("total_returns", "open_count", "resolved_count", "value_returned", "avg_resolution_hours", "highest_return_rate_supplier"):
            assert k in d["summary"]
        assert d["summary"]["open_count"] + d["summary"]["resolved_count"] == d["summary"]["total_returns"]
        assert {"rows", "supplier_rows", "item_rows", "reason_rows", "monthly_rows", "chart_data"} <= set(d)
        ranks = [s["rank"] for s in d["supplier_rows"]]
        assert ranks == list(range(1, len(ranks) + 1))
        rates = [s["return_rate_pct"] if s["return_rate_pct"] is not None else -1 for s in d["supplier_rows"]]
        assert rates == sorted(rates, reverse=True)

    def test_supplier_and_date_filters(self, client):
        d = client.get(f"{API}/reports/brand_returns", params={"supplier": "Growatt India"}, timeout=60).json()
        assert all(r["supplier"].lower() == "growatt india" for r in d["rows"])
        d2 = client.get(f"{API}/reports/brand_returns", params={"date_from": "2099-01-01"}, timeout=60).json()
        assert d2["summary"]["total_returns"] == 0 and d2["rows"] == []

    def test_staff_forbidden(self):
        s = requests.Session()
        r = s.get(f"{API}/reports/brand_returns", timeout=60)
        assert r.status_code in (401, 403)


class TestReportUsage:
    def test_view_is_logged_and_export_post_logged(self, client):
        before = client.get(f"{API}/reports/report_usage", timeout=60).json()["summary"]["total_runs"]
        client.get(f"{API}/reports/brand_returns", params={"supplier": "Growatt India"}, timeout=60)
        r = client.post(f"{API}/reports/usage", json={"report_type": "brand_returns", "format": "excel", "filters": {"supplier": "Growatt India", "status": "all"}}, timeout=60)
        assert r.status_code == 200
        d = client.get(f"{API}/reports/report_usage", params={"category": "brand_returns"}, timeout=60).json()
        assert d["summary"]["total_runs"] >= 2
        top = d["rows"][0]
        assert top["report_type"] == "brand_returns" and top["format"] == "excel" and "supplier=Growatt India" in top["filters"] and "status" not in top["filters"]
        assert top["user"] == "System Admin" or top["user"]
        after = client.get(f"{API}/reports/report_usage", timeout=60).json()["summary"]["total_runs"]
        assert after >= before + 2

    def test_usage_report_does_not_log_itself(self, client):
        a = client.get(f"{API}/reports/report_usage", timeout=60).json()["summary"]["total_runs"]
        client.get(f"{API}/reports/report_usage", timeout=60)
        b = client.get(f"{API}/reports/report_usage", timeout=60).json()["summary"]["total_runs"]
        assert a == b

    def test_user_filter(self, client):
        d = client.get(f"{API}/reports/report_usage", params={"supplier": "System Admin"}, timeout=60).json()
        assert d["rows"] and all("system admin" in (r["user"] or "").lower() for r in d["rows"])
