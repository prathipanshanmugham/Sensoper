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
import os
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


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


class TestReportsEngine:
    """Reports Engine endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get session for authenticated requests"""
        self.session = requests.Session()
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
    
    # Sales Report
    def test_sales_report(self):
        """Test sales report returns correct structure"""
        response = self.session.get(f"{BASE_URL}/api/reports/sales")
        assert response.status_code == 200, f"Sales report failed: {response.text}"
        data = response.json()
        
        assert "title" in data, "Missing 'title'"
        assert "summary" in data, "Missing 'summary'"
        assert "rows" in data, "Missing 'rows'"
        assert data["title"] == "Sales Report"
        
        # Check summary fields
        summary = data["summary"]
        assert "total_quotes" in summary
        assert "approved_projects" in summary
        assert "conversion_rate" in summary
        assert "revenue" in summary
    
    # Profit Report
    def test_profit_report(self):
        """Test profit report returns margin data"""
        response = self.session.get(f"{BASE_URL}/api/reports/profit")
        assert response.status_code == 200, f"Profit report failed: {response.text}"
        data = response.json()
        
        assert data["title"] == "Profit Report"
        summary = data["summary"]
        assert "total_base_cost" in summary
        assert "total_selling" in summary
        assert "total_margin" in summary
        assert "avg_margin_pct" in summary
    
    # Execution Report
    def test_execution_report(self):
        """Test project execution report"""
        response = self.session.get(f"{BASE_URL}/api/reports/execution")
        assert response.status_code == 200, f"Execution report failed: {response.text}"
        data = response.json()
        
        assert data["title"] == "Project Execution Report"
        summary = data["summary"]
        assert "total" in summary
        assert "completed" in summary
        assert "in_progress" in summary
    
    # Inventory Report
    def test_inventory_report(self):
        """Test inventory report with low stock indicators"""
        response = self.session.get(f"{BASE_URL}/api/reports/inventory")
        assert response.status_code == 200, f"Inventory report failed: {response.text}"
        data = response.json()
        
        assert data["title"] == "Procurement & Inventory Report"
        summary = data["summary"]
        assert "total_items" in summary
        assert "total_value" in summary
        assert "low_stock_count" in summary
        
        # Check rows have low_stock field
        if data["rows"]:
            assert "low_stock" in data["rows"][0]
    
    # Technical Report
    def test_technical_report(self):
        """Test technical report with system specifications"""
        response = self.session.get(f"{BASE_URL}/api/reports/technical")
        assert response.status_code == 200, f"Technical report failed: {response.text}"
        data = response.json()
        
        assert data["title"] == "Technical & Performance Report"
        summary = data["summary"]
        assert "total_capacity_kw" in summary
        assert "avg_monthly_consumption" in summary
    
    # Compliance Report
    def test_compliance_report(self):
        """Test compliance report with GST breakdown"""
        response = self.session.get(f"{BASE_URL}/api/reports/compliance")
        assert response.status_code == 200, f"Compliance report failed: {response.text}"
        data = response.json()
        
        assert data["title"] == "Compliance & Tax Report"
        summary = data["summary"]
        assert "total_gst_collected" in summary
        assert "total_invoices" in summary
    
    # HR Report
    def test_hr_report(self):
        """Test HR report with staff productivity"""
        response = self.session.get(f"{BASE_URL}/api/reports/hr")
        assert response.status_code == 200, f"HR report failed: {response.text}"
        data = response.json()
        
        assert data["title"] == "HR & Productivity Report"
        summary = data["summary"]
        assert "total_staff" in summary
        assert "avg_projects_per_staff" in summary
    
    # Customer Report
    def test_customer_report(self):
        """Test customer satisfaction report"""
        response = self.session.get(f"{BASE_URL}/api/reports/customer")
        assert response.status_code == 200, f"Customer report failed: {response.text}"
        data = response.json()
        
        assert data["title"] == "Customer Satisfaction Report"
        summary = data["summary"]
        assert "total_customers" in summary
        assert "feedback_received" in summary
        assert "feedback_rate" in summary
    
    # Marketing Report
    def test_marketing_report(self):
        """Test marketing report"""
        response = self.session.get(f"{BASE_URL}/api/reports/marketing")
        assert response.status_code == 200, f"Marketing report failed: {response.text}"
        data = response.json()
        
        assert data["title"] == "Marketing Report"
        summary = data["summary"]
        assert "total_sources" in summary
        assert "total_leads" in summary
    
    # O&M Report
    def test_om_report(self):
        """Test O&M report"""
        response = self.session.get(f"{BASE_URL}/api/reports/om")
        assert response.status_code == 200, f"O&M report failed: {response.text}"
        data = response.json()
        
        assert data["title"] == "Operations & Maintenance Report"
        summary = data["summary"]
        assert "total_installations" in summary
        assert "active_sites" in summary


class TestReportsFilters:
    """Test global filters for reports"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get session for authenticated requests"""
        self.session = requests.Session()
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert login_response.status_code == 200
    
    def test_date_from_filter(self):
        """Test date_from filter works"""
        response = self.session.get(f"{BASE_URL}/api/reports/sales", params={"date_from": "2025-01-01"})
        assert response.status_code == 200, f"Filter failed: {response.text}"
    
    def test_date_to_filter(self):
        """Test date_to filter works"""
        response = self.session.get(f"{BASE_URL}/api/reports/sales", params={"date_to": "2026-12-31"})
        assert response.status_code == 200, f"Filter failed: {response.text}"
    
    def test_system_type_filter(self):
        """Test system_type filter works"""
        response = self.session.get(f"{BASE_URL}/api/reports/sales", params={"system_type": "on-grid"})
        assert response.status_code == 200, f"Filter failed: {response.text}"
    
    def test_status_filter(self):
        """Test status filter works"""
        response = self.session.get(f"{BASE_URL}/api/reports/sales", params={"status": "approved"})
        assert response.status_code == 200, f"Filter failed: {response.text}"
    
    def test_combined_filters(self):
        """Test multiple filters combined"""
        response = self.session.get(f"{BASE_URL}/api/reports/sales", params={
            "date_from": "2025-01-01",
            "date_to": "2026-12-31",
            "system_type": "on-grid",
            "status": "approved"
        })
        assert response.status_code == 200, f"Combined filters failed: {response.text}"
    
    def test_unknown_report_type_returns_404(self):
        """Test unknown report type returns 404"""
        response = self.session.get(f"{BASE_URL}/api/reports/unknown_type")
        assert response.status_code == 404


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
        response = session.get(f"{BASE_URL}/api/reports/sales")
        assert response.status_code == 401


if __name__ == "__main__":
    pytest.main([__file__, "-v"])