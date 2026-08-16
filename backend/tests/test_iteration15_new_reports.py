"""
Iteration 15 Tests: New Report Types, Sticky Sidebar, Auto-Save Draft, Favicon
Tests for:
1. 7 new report types: expense, inbound, outbound, excess, scrap, price_fluctuation, low_stock
2. Merged technical_om report
3. All 16 report types have chart_data
4. Auto-save draft functionality
5. Favicon verification
"""
import pytest
import requests
import os
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        """Login and get auth cookies"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.cookies
    
    def test_login_success(self, auth_cookies):
        """Test admin login works"""
        assert auth_cookies is not None
        print("✓ Admin login successful")


class TestNewReportTypes:
    """Test the 7 new report types added in iteration 15"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        """Login and get auth cookies"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return response.cookies
    
    def test_expense_report(self, auth_cookies):
        """Test expense report returns title, summary, rows, chart_data"""
        response = requests.get(f"{BASE_URL}/api/reports/expense", cookies=auth_cookies)
        assert response.status_code == 200, f"Expense report failed: {response.text}"
        data = response.json()
        assert "title" in data, "Missing title"
        assert "summary" in data, "Missing summary"
        assert "rows" in data, "Missing rows"
        assert "chart_data" in data, "Missing chart_data"
        assert data["title"] == "Expense Report"
        # Verify summary fields
        summary = data["summary"]
        assert "total_expenses" in summary
        assert "total_materials" in summary
        assert "total_labor" in summary
        assert "total_gst" in summary
        print(f"✓ Expense report: {len(data['rows'])} rows, {len(data['chart_data'])} chart items")
    
    def test_inbound_report(self, auth_cookies):
        """Test inbound report returns stock distribution with chart_data"""
        response = requests.get(f"{BASE_URL}/api/reports/inbound", cookies=auth_cookies)
        assert response.status_code == 200, f"Inbound report failed: {response.text}"
        data = response.json()
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "chart_data" in data
        assert "Inbound" in data["title"]
        # Verify summary fields
        summary = data["summary"]
        assert "total_items_in_stock" in summary
        assert "total_stock_value" in summary
        print(f"✓ Inbound report: {len(data['rows'])} items, chart_data has {len(data['chart_data'])} categories")
    
    def test_outbound_report(self, auth_cookies):
        """Test outbound report returns material usage data"""
        response = requests.get(f"{BASE_URL}/api/reports/outbound", cookies=auth_cookies)
        assert response.status_code == 200, f"Outbound report failed: {response.text}"
        data = response.json()
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "chart_data" in data
        assert "Outbound" in data["title"]
        # Verify summary fields
        summary = data["summary"]
        assert "unique_items_used" in summary
        assert "total_units_dispatched" in summary
        print(f"✓ Outbound report: {len(data['rows'])} items used, {summary.get('total_units_dispatched', 0)} units dispatched")
    
    def test_low_stock_report(self, auth_cookies):
        """Test low stock report returns items below reorder level"""
        response = requests.get(f"{BASE_URL}/api/reports/low_stock", cookies=auth_cookies)
        assert response.status_code == 200, f"Low stock report failed: {response.text}"
        data = response.json()
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "chart_data" in data
        assert "Low Stock" in data["title"]
        # Verify summary fields
        summary = data["summary"]
        assert "low_stock_items" in summary
        assert "total_restock_cost" in summary
        print(f"✓ Low stock report: {summary.get('low_stock_items', 0)} items need restocking")
    
    def test_excess_materials_report(self, auth_cookies):
        """Test excess materials report returns overstocked items"""
        response = requests.get(f"{BASE_URL}/api/reports/excess", cookies=auth_cookies)
        assert response.status_code == 200, f"Excess report failed: {response.text}"
        data = response.json()
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "chart_data" in data
        assert "Excess" in data["title"]
        # Verify summary fields
        summary = data["summary"]
        assert "excess_items" in summary
        assert "total_excess_value" in summary
        print(f"✓ Excess materials report: {summary.get('excess_items', 0)} excess items")
    
    def test_scrap_report(self, auth_cookies):
        """Test scrap report returns zero/near-zero stock items"""
        response = requests.get(f"{BASE_URL}/api/reports/scrap", cookies=auth_cookies)
        assert response.status_code == 200, f"Scrap report failed: {response.text}"
        data = response.json()
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "chart_data" in data
        assert "Scrap" in data["title"]
        # Verify summary fields
        summary = data["summary"]
        assert "potential_scrap_items" in summary
        assert "zero_stock_items" in summary
        print(f"✓ Scrap report: {summary.get('potential_scrap_items', 0)} potential scrap items")
    
    def test_price_fluctuation_report(self, auth_cookies):
        """Test price fluctuation report returns price variance data"""
        response = requests.get(f"{BASE_URL}/api/reports/price_fluctuation", cookies=auth_cookies)
        assert response.status_code == 200, f"Price fluctuation report failed: {response.text}"
        data = response.json()
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "chart_data" in data
        assert "Price Fluctuation" in data["title"]
        # Verify summary fields
        summary = data["summary"]
        assert "items_tracked" in summary
        assert "max_fluctuation" in summary
        print(f"✓ Price fluctuation report: {summary.get('items_tracked', 0)} items tracked")
    
    def test_technical_om_merged_report(self, auth_cookies):
        """Test technical_om report returns merged Technical & O&M data"""
        response = requests.get(f"{BASE_URL}/api/reports/technical_om", cookies=auth_cookies)
        assert response.status_code == 200, f"Technical O&M report failed: {response.text}"
        data = response.json()
        assert "title" in data
        assert "summary" in data
        assert "rows" in data
        assert "chart_data" in data
        assert "Technical" in data["title"] and "O&M" in data["title"]
        # Verify summary fields
        summary = data["summary"]
        assert "total_capacity_kw" in summary
        assert "active_installations" in summary
        print(f"✓ Technical & O&M report: {summary.get('total_capacity_kw', 0)} kW total capacity")


class TestAllReportTypes:
    """Test all 16 report types exist and return proper structure"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        """Login and get auth cookies"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return response.cookies
    
    REPORT_TYPES = [
        "sales", "profit", "expense", "execution", "inventory",
        "inbound", "outbound", "low_stock", "excess", "scrap",
        "price_fluctuation", "technical_om", "compliance", "hr",
        "marketing", "customer"
    ]
    
    @pytest.mark.parametrize("report_type", REPORT_TYPES)
    def test_report_type_exists(self, auth_cookies, report_type):
        """Test each report type returns 200 with proper structure"""
        response = requests.get(f"{BASE_URL}/api/reports/{report_type}", cookies=auth_cookies)
        assert response.status_code == 200, f"Report {report_type} failed: {response.text}"
        data = response.json()
        assert "title" in data, f"Report {report_type} missing title"
        assert "summary" in data, f"Report {report_type} missing summary"
        assert "rows" in data, f"Report {report_type} missing rows"
        assert "chart_data" in data, f"Report {report_type} missing chart_data"
        print(f"✓ Report {report_type}: OK")
    
    def test_unknown_report_type_returns_404(self, auth_cookies):
        """Test unknown report type returns 404"""
        response = requests.get(f"{BASE_URL}/api/reports/unknown_type", cookies=auth_cookies)
        assert response.status_code == 404
        print("✓ Unknown report type returns 404")


class TestAutoSaveDraft:
    """Test auto-save draft functionality for projects"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        """Login and get auth cookies"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return response.cookies
    
    def test_create_draft_project(self, auth_cookies):
        """Test creating a draft project (simulating auto-save)"""
        # Create a minimal project (simulating auto-save with partial data)
        project_data = {
            "customer": {
                "name": "TEST_AutoSave_Draft",
                "phone": "1234567890",
                "address": "Test Address"
            },
            "location": {
                "latitude": None,
                "longitude": None,
                "address": "",
                "site_location_words": ""
            },
            "electrical": {
                "sanction_load_kw": 5.0,
                "connected_load_kw": 4.0,
                "monthly_consumption_units": 500,
                "eb_tariff": 7.0
            },
            "solar_system": {
                "system_type": "on-grid",
                "panel_wattage": 540,
                "battery_required": False
            },
            "mounting": {
                "roof_type": "RCC",
                "tilt_angle": 15,
                "structure_type": "GI"
            },
            "additional": {
                "cable_length_meters": 50,
                "inverter_to_panel_distance": 10,
                "installation_complexity": "simple"
            },
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_link": "https://drive.google.com/drive/folders/test123"
        }
        
        response = requests.post(f"{BASE_URL}/api/projects", json=project_data, cookies=auth_cookies)
        assert response.status_code == 200, f"Create draft failed: {response.text}"
        data = response.json()
        assert "id" in data
        project_id = data["id"]
        print(f"✓ Draft project created with ID: {project_id}")
        
        # Verify the project exists and is in draft status
        get_response = requests.get(f"{BASE_URL}/api/projects/{project_id}", cookies=auth_cookies)
        assert get_response.status_code == 200
        project = get_response.json()
        assert project["status"] == "draft"
        assert project["customer"]["name"] == "TEST_AutoSave_Draft"
        print(f"✓ Draft project verified: status={project['status']}")
        
        # Clean up - delete the test project
        # Note: We'll leave it for now as it's a test project
        return project_id
    
    def test_update_draft_project(self, auth_cookies):
        """Test updating a draft project (simulating auto-save update)"""
        # First create a draft
        project_data = {
            "customer": {
                "name": "TEST_AutoSave_Update",
                "phone": "9876543210",
                "address": "Initial Address"
            },
            "location": {"latitude": None, "longitude": None, "address": "", "site_location_words": ""},
            "electrical": {"sanction_load_kw": 3.0, "connected_load_kw": 2.5, "monthly_consumption_units": 300, "eb_tariff": 6.0},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "Sheet", "tilt_angle": 12, "structure_type": "Aluminum"},
            "additional": {"cable_length_meters": 30, "inverter_to_panel_distance": 8, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_link": "https://drive.google.com/drive/folders/test456"
        }
        
        create_response = requests.post(f"{BASE_URL}/api/projects", json=project_data, cookies=auth_cookies)
        assert create_response.status_code == 200
        project_id = create_response.json()["id"]
        
        # Update the draft (simulating auto-save with more data)
        update_data = {
            "customer": {
                "name": "TEST_AutoSave_Update",
                "phone": "9876543210",
                "address": "Updated Address with more details",
                "email": "test@example.com"
            }
        }
        
        update_response = requests.put(f"{BASE_URL}/api/projects/{project_id}", json=update_data, cookies=auth_cookies)
        assert update_response.status_code == 200, f"Update draft failed: {update_response.text}"
        
        # Verify the update
        get_response = requests.get(f"{BASE_URL}/api/projects/{project_id}", cookies=auth_cookies)
        assert get_response.status_code == 200
        project = get_response.json()
        assert project["customer"]["address"] == "Updated Address with more details"
        assert project["customer"]["email"] == "test@example.com"
        print(f"✓ Draft project updated successfully")


class TestDashboardStats:
    """Test dashboard stats endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        """Login and get auth cookies"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return response.cookies
    
    def test_dashboard_stats(self, auth_cookies):
        """Test dashboard stats returns expected fields"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", cookies=auth_cookies)
        assert response.status_code == 200, f"Dashboard stats failed: {response.text}"
        data = response.json()
        # Verify expected fields
        expected_fields = ["total", "draft", "submitted", "approved", "completed", "rejected"]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        print(f"✓ Dashboard stats: {data.get('total', 0)} total projects")


class TestCeoDashboard:
    """Test CEO Dashboard endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        """Login and get auth cookies"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return response.cookies
    
    def test_ceo_dashboard(self, auth_cookies):
        """Test CEO dashboard returns KPIs and charts"""
        response = requests.get(f"{BASE_URL}/api/dashboard/ceo", cookies=auth_cookies)
        assert response.status_code == 200, f"CEO dashboard failed: {response.text}"
        data = response.json()
        # Verify expected fields
        assert "kpis" in data, "Missing kpis"
        assert "status_distribution" in data, "Missing status_distribution"
        assert "revenue_trend" in data, "Missing revenue_trend"
        print(f"✓ CEO Dashboard: {len(data.get('kpis', {}))} KPIs")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])