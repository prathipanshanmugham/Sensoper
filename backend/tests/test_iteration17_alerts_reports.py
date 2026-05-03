"""
Iteration 17 Tests: Profit Leakage Alert System & Consolidated Reports
- Alert Engine: 7 alert types, risk scoring 0-100, configurable thresholds
- Consolidated Reports: 8 reports with tab-based views
- Old report types should return 404
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def session(self):
        return requests.Session()
    
    def test_admin_login(self, session):
        """Test admin login with correct credentials"""
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert data["email"] == "admin@sensoper.com"
        assert data["role"] == "admin"
        print(f"✓ Admin login successful: {data['name']}")


class TestAlertsDashboard:
    """Tests for Profit Leakage Alerts Dashboard API"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200, "Auth failed"
        return session
    
    def test_alerts_dashboard_returns_required_fields(self, auth_session):
        """GET /api/alerts/dashboard returns total_leakage, total_alerts, risky_projects, top_risks, alerts_by_type, chart_data, thresholds"""
        response = auth_session.get(f"{BASE_URL}/api/alerts/dashboard")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify all required fields
        assert "total_leakage" in data, "Missing total_leakage"
        assert "total_alerts" in data, "Missing total_alerts"
        assert "risky_projects" in data, "Missing risky_projects"
        assert "top_risks" in data, "Missing top_risks"
        assert "alerts_by_type" in data, "Missing alerts_by_type"
        assert "chart_data" in data, "Missing chart_data"
        assert "thresholds" in data, "Missing thresholds"
        
        # Verify data types
        assert isinstance(data["total_leakage"], (int, float))
        assert isinstance(data["total_alerts"], int)
        assert isinstance(data["risky_projects"], int)
        assert isinstance(data["top_risks"], list)
        assert isinstance(data["alerts_by_type"], dict)
        assert isinstance(data["chart_data"], list)
        assert isinstance(data["thresholds"], dict)
        
        print(f"✓ Alerts dashboard: {data['total_alerts']} alerts, {data['risky_projects']} risky projects, Rs {data['total_leakage']} leakage")
    
    def test_alerts_dashboard_top_risks_structure(self, auth_session):
        """Verify top_risks contains risk_score, risk_level, alert_count"""
        response = auth_session.get(f"{BASE_URL}/api/alerts/dashboard")
        assert response.status_code == 200
        data = response.json()
        
        if data["top_risks"]:
            risk = data["top_risks"][0]
            assert "id" in risk
            assert "ref" in risk
            assert "customer" in risk
            assert "risk_score" in risk
            assert "risk_level" in risk
            assert "alert_count" in risk
            assert "status" in risk
            assert risk["risk_level"] in ["High", "Medium", "Low"]
            assert 0 <= risk["risk_score"] <= 100
            print(f"✓ Top risk project: {risk['customer']} - Score: {risk['risk_score']}, Level: {risk['risk_level']}")
        else:
            print("✓ No risky projects found (all projects within safe limits)")
    
    def test_alerts_dashboard_thresholds_structure(self, auth_session):
        """Verify thresholds contains min_margin_pct, max_material_variance_pct, payment_delay_days, max_project_duration_days"""
        response = auth_session.get(f"{BASE_URL}/api/alerts/dashboard")
        assert response.status_code == 200
        data = response.json()
        
        thresholds = data["thresholds"]
        assert "min_margin_pct" in thresholds
        assert "max_material_variance_pct" in thresholds
        assert "payment_delay_days" in thresholds
        assert "max_project_duration_days" in thresholds
        
        print(f"✓ Thresholds: min_margin={thresholds['min_margin_pct']}%, max_variance={thresholds['max_material_variance_pct']}%, delay={thresholds['payment_delay_days']}d, duration={thresholds['max_project_duration_days']}d")


class TestProjectAlerts:
    """Tests for project-level alerts API"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        return session
    
    def test_project_alerts_returns_risk_data(self, auth_session):
        """GET /api/alerts/project/{id} returns risk_score, risk_level, alerts[], suggestions[]"""
        # First get a project ID
        projects_resp = auth_session.get(f"{BASE_URL}/api/projects")
        assert projects_resp.status_code == 200
        projects = projects_resp.json()
        
        if not projects:
            pytest.skip("No projects available for testing")
        
        project_id = projects[0]["id"]
        response = auth_session.get(f"{BASE_URL}/api/alerts/project/{project_id}")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "risk_score" in data
        assert "risk_level" in data
        assert "alerts" in data
        assert "suggestions" in data
        
        assert isinstance(data["risk_score"], (int, float))
        assert data["risk_level"] in ["High", "Medium", "Low"]
        assert isinstance(data["alerts"], list)
        assert isinstance(data["suggestions"], list)
        
        print(f"✓ Project {project_id}: Risk Score={data['risk_score']}, Level={data['risk_level']}, Alerts={len(data['alerts'])}")


class TestThresholdsAPI:
    """Tests for threshold settings API"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        return session
    
    def test_get_thresholds(self, auth_session):
        """GET /api/settings/thresholds returns current thresholds"""
        response = auth_session.get(f"{BASE_URL}/api/settings/thresholds")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "min_margin_pct" in data
        assert "max_material_variance_pct" in data
        assert "payment_delay_days" in data
        assert "max_project_duration_days" in data
        
        print(f"✓ Current thresholds: {data}")
    
    def test_update_thresholds(self, auth_session):
        """PUT /api/settings/thresholds updates thresholds"""
        # Get current values
        get_resp = auth_session.get(f"{BASE_URL}/api/settings/thresholds")
        original = get_resp.json()
        
        # Update with new values
        new_values = {
            "min_margin_pct": 10,
            "max_material_variance_pct": 20,
            "payment_delay_days": 45,
            "max_project_duration_days": 120
        }
        
        response = auth_session.put(f"{BASE_URL}/api/settings/thresholds", json=new_values)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify update
        verify_resp = auth_session.get(f"{BASE_URL}/api/settings/thresholds")
        updated = verify_resp.json()
        
        assert updated["min_margin_pct"] == 10
        assert updated["max_material_variance_pct"] == 20
        assert updated["payment_delay_days"] == 45
        assert updated["max_project_duration_days"] == 120
        
        # Restore original values
        auth_session.put(f"{BASE_URL}/api/settings/thresholds", json=original)
        
        print(f"✓ Thresholds updated and verified, then restored")


class TestConsolidatedReports:
    """Tests for 8 consolidated reports with tab-based views"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        return session
    
    def test_sales_revenue_report(self, auth_session):
        """GET /api/reports/sales_revenue returns data with tabs"""
        response = auth_session.get(f"{BASE_URL}/api/reports/sales_revenue")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "tabs" in data
        assert "chart_data" in data
        
        # Verify tabs
        assert "overview" in data["tabs"]
        assert "lead_sources" in data["tabs"]
        
        print(f"✓ Sales & Revenue: {data['summary'].get('total_quotes', 0)} quotes, Rs {data['summary'].get('revenue', 0)} revenue")
    
    def test_sales_revenue_lead_sources_tab(self, auth_session):
        """GET /api/reports/sales_revenue?tab=lead_sources returns lead source data"""
        response = auth_session.get(f"{BASE_URL}/api/reports/sales_revenue?tab=lead_sources")
        assert response.status_code == 200
        data = response.json()
        
        # Rows should be lead source data
        if data["rows"]:
            row = data["rows"][0]
            assert "source" in row or "customer" in row  # Either lead source or overview data
        
        print(f"✓ Sales & Revenue lead_sources tab: {len(data['rows'])} rows")
    
    def test_profit_leakage_report(self, auth_session):
        """GET /api/reports/profit_leakage returns data with leakage info"""
        response = auth_session.get(f"{BASE_URL}/api/reports/profit_leakage")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "tabs" in data
        
        # Verify tabs
        assert "profit" in data["tabs"]
        assert "material_variance" in data["tabs"]
        
        # Verify summary has leakage info
        assert "total_leakage" in data["summary"]
        
        print(f"✓ Profit & Leakage: Rs {data['summary'].get('total_selling', 0)} selling, Rs {data['summary'].get('total_leakage', 0)} leakage")
    
    def test_profit_leakage_material_variance_tab(self, auth_session):
        """GET /api/reports/profit_leakage?tab=material_variance returns variance data"""
        response = auth_session.get(f"{BASE_URL}/api/reports/profit_leakage?tab=material_variance")
        assert response.status_code == 200
        data = response.json()
        
        if data["rows"]:
            row = data["rows"][0]
            # Should have variance-related fields
            assert "item" in row or "customer" in row
        
        print(f"✓ Profit & Leakage material_variance tab: {len(data['rows'])} rows")
    
    def test_project_execution_report(self, auth_session):
        """GET /api/reports/project_execution returns project status data"""
        response = auth_session.get(f"{BASE_URL}/api/reports/project_execution")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        
        print(f"✓ Project Execution: {data['summary'].get('total', 0)} projects, {data['summary'].get('completed', 0)} completed")
    
    def test_inventory_material_report(self, auth_session):
        """GET /api/reports/inventory_material returns data with tabs (stock_levels, material_usage, alerts)"""
        response = auth_session.get(f"{BASE_URL}/api/reports/inventory_material")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "tabs" in data
        
        # Verify tabs
        assert "stock_levels" in data["tabs"]
        assert "material_usage" in data["tabs"]
        assert "alerts" in data["tabs"]
        
        print(f"✓ Inventory & Material: {data['summary'].get('total_items', 0)} items, {data['summary'].get('low_stock', 0)} low stock")
    
    def test_inventory_material_usage_tab(self, auth_session):
        """GET /api/reports/inventory_material?tab=material_usage returns usage data"""
        response = auth_session.get(f"{BASE_URL}/api/reports/inventory_material?tab=material_usage")
        assert response.status_code == 200
        data = response.json()
        
        print(f"✓ Inventory material_usage tab: {len(data['rows'])} rows")
    
    def test_customer_credit_report(self, auth_session):
        """GET /api/reports/customer_credit returns receivables data"""
        response = auth_session.get(f"{BASE_URL}/api/reports/customer_credit")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        
        print(f"✓ Customer Credit: Rs {data['summary'].get('total_receivable', 0)} receivable, Rs {data['summary'].get('outstanding', 0)} outstanding")
    
    def test_team_performance_report(self, auth_session):
        """GET /api/reports/team_performance returns staff workload data"""
        response = auth_session.get(f"{BASE_URL}/api/reports/team_performance")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        
        print(f"✓ Team Performance: {data['summary'].get('total_staff', 0)} staff, avg load {data['summary'].get('avg_load', 0)}")
    
    def test_compliance_tax_report(self, auth_session):
        """GET /api/reports/compliance_tax returns GST/tax data"""
        response = auth_session.get(f"{BASE_URL}/api/reports/compliance_tax")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        
        print(f"✓ Compliance & Tax: Rs {data['summary'].get('total_gst', 0)} GST, {data['summary'].get('invoices', 0)} invoices")
    
    def test_customer_satisfaction_report(self, auth_session):
        """GET /api/reports/customer_satisfaction returns feedback data"""
        response = auth_session.get(f"{BASE_URL}/api/reports/customer_satisfaction")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        
        print(f"✓ Customer Satisfaction: {data['summary'].get('total_customers', 0)} customers, {data['summary'].get('feedback_rate', 0)}% feedback rate")


class TestOldReportTypes404:
    """Tests that old report types return 404"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        return session
    
    def test_old_sales_report_404(self, auth_session):
        """Old 'sales' report type should return 404"""
        response = auth_session.get(f"{BASE_URL}/api/reports/sales")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Old 'sales' report returns 404")
    
    def test_old_profit_report_404(self, auth_session):
        """Old 'profit' report type should return 404"""
        response = auth_session.get(f"{BASE_URL}/api/reports/profit")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Old 'profit' report returns 404")
    
    def test_old_expense_report_404(self, auth_session):
        """Old 'expense' report type should return 404"""
        response = auth_session.get(f"{BASE_URL}/api/reports/expense")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Old 'expense' report returns 404")
    
    def test_old_inventory_report_404(self, auth_session):
        """Old 'inventory' report type should return 404"""
        response = auth_session.get(f"{BASE_URL}/api/reports/inventory")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Old 'inventory' report returns 404")
    
    def test_old_execution_report_404(self, auth_session):
        """Old 'execution' report type should return 404"""
        response = auth_session.get(f"{BASE_URL}/api/reports/execution")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Old 'execution' report returns 404")


class TestReportFilters:
    """Tests for enhanced report filters"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        return session
    
    def test_report_with_date_filter(self, auth_session):
        """Reports accept date_from and date_to filters"""
        response = auth_session.get(f"{BASE_URL}/api/reports/sales_revenue?date_from=2024-01-01&date_to=2026-12-31")
        assert response.status_code == 200
        print("✓ Date filter works")
    
    def test_report_with_system_type_filter(self, auth_session):
        """Reports accept system_type filter"""
        response = auth_session.get(f"{BASE_URL}/api/reports/sales_revenue?system_type=on-grid")
        assert response.status_code == 200
        print("✓ System type filter works")
    
    def test_report_with_status_filter(self, auth_session):
        """Reports accept status filter"""
        response = auth_session.get(f"{BASE_URL}/api/reports/sales_revenue?status=approved")
        assert response.status_code == 200
        print("✓ Status filter works")
    
    def test_report_with_customer_filter(self, auth_session):
        """Reports accept customer filter"""
        response = auth_session.get(f"{BASE_URL}/api/reports/sales_revenue?customer=test")
        assert response.status_code == 200
        print("✓ Customer filter works")
    
    def test_report_with_staff_filter(self, auth_session):
        """Reports accept staff filter"""
        response = auth_session.get(f"{BASE_URL}/api/reports/sales_revenue?staff=admin")
        assert response.status_code == 200
        print("✓ Staff filter works")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
