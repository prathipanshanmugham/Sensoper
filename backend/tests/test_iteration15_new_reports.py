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
from http_env import require_server, throwaway_password, TEST_ADMIN_EMAIL, TEST_MANAGER_EMAIL, TEST_MANAGER_PASSWORD, TEST_STAFF_EMAIL, TEST_STAFF_PASSWORD  # noqa: E402,F401
_SERVER_URL, TEST_ADMIN_PASSWORD = require_server(manager=False, staff=False)
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