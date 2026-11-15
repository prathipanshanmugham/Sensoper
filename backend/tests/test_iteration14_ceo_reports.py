"""
Iteration 14: CEO Dashboard and Reports Engine Tests
Tests for:
- CEO Dashboard API (/api/dashboard/ceo)
- Reports Engine API (/api/reports/{report_type})
- Global filters support (date_from, date_to, system_type, status)
"""

import pytest
import requests
import os
from http_env import require_server, throwaway_password, TEST_ADMIN_EMAIL, TEST_MANAGER_EMAIL, TEST_MANAGER_PASSWORD, TEST_STAFF_EMAIL, TEST_STAFF_PASSWORD  # noqa: E402,F401
_SERVER_URL, TEST_ADMIN_PASSWORD = require_server(manager=False, staff=False)
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCeoDashboard:
    """CEO Dashboard endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get session for authenticated requests"""
        self.session = requests.Session()
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.user = login_response.json()
    
    def test_ceo_dashboard_returns_200(self):
        """Test CEO dashboard endpoint returns 200 for admin"""
        response = self.session.get(f"{BASE_URL}/api/dashboard/ceo")
        assert response.status_code == 200, f"CEO dashboard failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "kpis" in data, "Missing 'kpis' in response"
        assert "status_distribution" in data, "Missing 'status_distribution' in response"
        assert "revenue_trend" in data, "Missing 'revenue_trend' in response"
        assert "sales_funnel" in data, "Missing 'sales_funnel' in response"
        assert "top_staff" in data, "Missing 'top_staff' in response"
    
    def test_ceo_dashboard_kpis_structure(self):
        """Test CEO dashboard KPIs have all required fields"""
        response = self.session.get(f"{BASE_URL}/api/dashboard/ceo")
        assert response.status_code == 200
        kpis = response.json()["kpis"]
        
        required_kpis = [
            "total_revenue", "total_profit", "conversion_rate", "active_projects",
            "completed_projects", "pending_approvals", "inventory_value", "low_stock_alerts"
        ]
        for kpi in required_kpis:
            assert kpi in kpis, f"Missing KPI: {kpi}"
    
    def test_ceo_dashboard_status_distribution(self):
        """Test status distribution is a list with name/value pairs"""
        response = self.session.get(f"{BASE_URL}/api/dashboard/ceo")
        assert response.status_code == 200
        status_dist = response.json()["status_distribution"]
        
        assert isinstance(status_dist, list), "status_distribution should be a list"
        for item in status_dist:
            assert "name" in item, "Each status item should have 'name'"
            assert "value" in item, "Each status item should have 'value'"
    
    def test_ceo_dashboard_revenue_trend(self):
        """Test revenue trend is a list with month/revenue data"""
        response = self.session.get(f"{BASE_URL}/api/dashboard/ceo")
        assert response.status_code == 200
        trend = response.json()["revenue_trend"]
        
        assert isinstance(trend, list), "revenue_trend should be a list"
        for item in trend:
            assert "month" in item, "Each trend item should have 'month'"
            assert "revenue" in item, "Each trend item should have 'revenue'"
    
    def test_ceo_dashboard_sales_funnel(self):
        """Test sales funnel has required fields"""
        response = self.session.get(f"{BASE_URL}/api/dashboard/ceo")
        assert response.status_code == 200
        funnel = response.json()["sales_funnel"]
        
        required_fields = ["total_leads", "quotes_generated", "approved", "completed"]
        for field in required_fields:
            assert field in funnel, f"Missing funnel field: {field}"
    
    def test_ceo_dashboard_top_staff(self):
        """Test top staff is a list with name/count/revenue"""
        response = self.session.get(f"{BASE_URL}/api/dashboard/ceo")
        assert response.status_code == 200
        staff = response.json()["top_staff"]
        
        assert isinstance(staff, list), "top_staff should be a list"
        for item in staff:
            assert "name" in item, "Each staff item should have 'name'"
            assert "count" in item, "Each staff item should have 'count'"
            assert "revenue" in item, "Each staff item should have 'revenue'"




class TestAccessControl:
    """Test access control for CEO dashboard and reports"""
    
    def test_ceo_dashboard_requires_auth(self):
        """Test CEO dashboard requires authentication"""
        session = requests.Session()
        response = session.get(f"{BASE_URL}/api/dashboard/ceo")
        assert response.status_code == 401
    
    def test_reports_require_auth(self):
        """Test reports require authentication"""
        session = requests.Session()
        response = session.get(f"{BASE_URL}/api/reports/sales_revenue")
        assert response.status_code == 401


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

# The report engine's current types (the old sales/profit/execution/... names were renamed — see memory/PRD.md)
CURRENT_REPORTS = ["brand_returns", "sales_revenue", "profit_leakage", "project_execution", "inventory_material", "customer_credit",
                   "team_performance", "compliance_tax", "customer_satisfaction", "inbound", "outbound", "audit", "marketing",
                   "excess_material", "amc", "assets", "tools", "expenses", "operational_expense", "reading_analysis",
                   "employee_performance", "partner_performance", "ecommerce", "customer_support"]


@pytest.fixture(scope="module")
def report_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return s


@pytest.mark.parametrize("report_type", CURRENT_REPORTS)
def test_current_report_types_answer(report_session, report_type):
    r = report_session.get(f"{BASE_URL}/api/reports/{report_type}")
    assert r.status_code == 200, f"{report_type}: {r.status_code} {r.text[:200]}"
    assert isinstance(r.json(), dict) and r.json(), report_type


@pytest.mark.parametrize("params", [{"date_from": "2025-01-01"}, {"date_to": "2026-12-31"}, {"system_type": "on-grid"},
                                    {"status": "approved"}, {"date_from": "2025-01-01", "date_to": "2026-12-31", "status": "approved"}])
def test_sales_report_filters(report_session, params):
    r = report_session.get(f"{BASE_URL}/api/reports/sales_revenue", params=params)
    assert r.status_code == 200, r.text[:200]


def test_unknown_report_type_returns_404(report_session):
    assert report_session.get(f"{BASE_URL}/api/reports/unknown_type").status_code == 404
