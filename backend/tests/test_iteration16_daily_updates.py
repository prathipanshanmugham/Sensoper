"""
Iteration 16 Backend Tests - Daily Updates, Payments, Material Usage, Completeness, Project Report, and New Report Types

Tests:
- Daily Updates CRUD (POST/GET/PUT/DELETE /api/daily-updates)
- Payments (POST/GET /api/payments)
- Material Usage (POST/GET /api/material-usage)
- Data Completeness (/api/projects/{id}/completeness)
- Project Report (/api/projects/{id}/report)
- 4 New Report Types (customer_credit, referral, team_load, excess_utilisation)
"""

import pytest
import requests
import os
from datetime import datetime
from http_env import require_server, throwaway_password, TEST_ADMIN_EMAIL, TEST_MANAGER_EMAIL, TEST_MANAGER_PASSWORD, TEST_STAFF_EMAIL, TEST_STAFF_PASSWORD  # noqa: E402,F401
_SERVER_URL, TEST_ADMIN_PASSWORD = require_server(manager=False, staff=False)
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        """Login and get auth cookies"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.cookies
    
    def test_login_success(self, auth_cookies):
        """Test admin login works"""
        assert auth_cookies is not None
        print("✓ Admin login successful")


class TestDailyUpdates:
    """Daily Updates CRUD tests"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        """Login and get auth cookies"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}
        )
        assert response.status_code == 200
        return response.cookies
    
    @pytest.fixture(scope="class")
    def test_project_id(self, auth_cookies):
        """Get or create a test project"""
        # First try to get existing non-draft projects
        response = requests.get(f"{BASE_URL}/api/projects", cookies=auth_cookies)
        assert response.status_code == 200
        projects = response.json()
        non_draft = [p for p in projects if p.get("status") != "draft"]
        if non_draft:
            return non_draft[0]["id"]
        
        # If no non-draft projects, create one
        project_data = {
            "customer": {"name": "TEST_DailyUpdate_Customer", "phone": "9876543210", "address": "Test Address"},
            "location": {"address": "Test Location", "site_location_words": "Test Site"},
            "electrical": {"sanction_load_kw": 5.0, "connected_load_kw": 4.0, "monthly_consumption_units": 500, "eb_tariff": 7.5},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "Elevated"},
            "additional": {"cable_length_meters": 20, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": []
        }
        response = requests.post(f"{BASE_URL}/api/projects", json=project_data, cookies=auth_cookies)
        assert response.status_code == 200
        project_id = response.json()["id"]
        
        # Submit the project to make it non-draft
        requests.post(f"{BASE_URL}/api/projects/{project_id}/submit", cookies=auth_cookies)
        return project_id
    
    def test_create_progress_update(self, auth_cookies, test_project_id):
        """Test creating a progress update"""
        update_data = {
            "project_id": test_project_id,
            "update_type": "progress",
            "data": {
                "work_done": "TEST_Completed panel installation",
                "completion_pct": "45",
                "issues": "Minor weather delay"
            }
        }
        response = requests.post(f"{BASE_URL}/api/daily-updates", json=update_data, cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["message"] == "Update created"
        print(f"✓ Progress update created: {data['id']}")
        return data["id"]
    
    def test_create_payment_update(self, auth_cookies, test_project_id):
        """Test creating a payment update"""
        update_data = {
            "project_id": test_project_id,
            "update_type": "payment",
            "data": {
                "amount": "50000",
                "payment_method": "upi",
                "notes": "TEST_Advance payment"
            }
        }
        response = requests.post(f"{BASE_URL}/api/daily-updates", json=update_data, cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        print(f"✓ Payment update created: {data['id']}")
    
    def test_create_material_update(self, auth_cookies, test_project_id):
        """Test creating a material update"""
        update_data = {
            "project_id": test_project_id,
            "update_type": "material",
            "data": {
                "item_name": "TEST_Solar Panel 540W",
                "estimated_qty": "10",
                "actual_qty": "11",
                "wastage": "0",
                "notes": "Extra panel used"
            }
        }
        response = requests.post(f"{BASE_URL}/api/daily-updates", json=update_data, cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        print(f"✓ Material update created: {data['id']}")
    
    def test_create_installation_update(self, auth_cookies, test_project_id):
        """Test creating an installation update"""
        update_data = {
            "project_id": test_project_id,
            "update_type": "installation",
            "data": {
                "team": "TEST_Team Alpha",
                "work_status": "in_progress",
                "completion_date": "2026-02-15",
                "notes": "On schedule"
            }
        }
        response = requests.post(f"{BASE_URL}/api/daily-updates", json=update_data, cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        print(f"✓ Installation update created: {data['id']}")
    
    def test_create_om_update(self, auth_cookies, test_project_id):
        """Test creating an O&M update"""
        update_data = {
            "project_id": test_project_id,
            "update_type": "om",
            "data": {
                "service": "TEST_Panel cleaning and inspection",
                "issues_resolved": "Dust accumulation cleared",
                "notes": "Quarterly maintenance"
            }
        }
        response = requests.post(f"{BASE_URL}/api/daily-updates", json=update_data, cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        print(f"✓ O&M update created: {data['id']}")
    
    def test_get_project_updates(self, auth_cookies, test_project_id):
        """Test getting updates for a project"""
        response = requests.get(f"{BASE_URL}/api/daily-updates/project/{test_project_id}", cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        updates = response.json()
        assert isinstance(updates, list)
        assert len(updates) >= 1, "Should have at least one update"
        # Verify update structure
        for u in updates:
            assert "id" in u
            assert "update_type" in u
            assert "data" in u
            assert "created_at" in u
        print(f"✓ Retrieved {len(updates)} updates for project")
    
    def test_list_all_updates(self, auth_cookies):
        """Test listing all daily updates"""
        response = requests.get(f"{BASE_URL}/api/daily-updates", cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        updates = response.json()
        assert isinstance(updates, list)
        print(f"✓ Listed {len(updates)} total updates")
    
    def test_delete_update(self, auth_cookies, test_project_id):
        """Test deleting an update"""
        # First create an update to delete
        update_data = {
            "project_id": test_project_id,
            "update_type": "progress",
            "data": {"work_done": "TEST_To be deleted", "completion_pct": "10"}
        }
        create_resp = requests.post(f"{BASE_URL}/api/daily-updates", json=update_data, cookies=auth_cookies)
        assert create_resp.status_code == 200
        update_id = create_resp.json()["id"]
        
        # Delete it
        delete_resp = requests.delete(f"{BASE_URL}/api/daily-updates/{update_id}", cookies=auth_cookies)
        assert delete_resp.status_code == 200, f"Failed: {delete_resp.text}"
        assert delete_resp.json()["message"] == "Update deleted"
        print(f"✓ Update deleted successfully")


class TestPayments:
    """Payments API tests"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}
        )
        return response.cookies
    
    @pytest.fixture(scope="class")
    def test_project_id(self, auth_cookies):
        response = requests.get(f"{BASE_URL}/api/projects", cookies=auth_cookies)
        projects = response.json()
        non_draft = [p for p in projects if p.get("status") != "draft"]
        if non_draft:
            return non_draft[0]["id"]
        return None
    
    def test_create_payment(self, auth_cookies, test_project_id):
        """Test creating a payment record"""
        if not test_project_id:
            pytest.skip("No non-draft project available")
        
        payment_data = {
            "project_id": test_project_id,
            "amount": 25000.0,
            "payment_method": "bank_transfer",
            "notes": "TEST_Payment via NEFT"
        }
        response = requests.post(f"{BASE_URL}/api/payments", json=payment_data, cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["message"] == "Payment recorded"
        print(f"✓ Payment created: {data['id']}")
    
    def test_get_project_payments(self, auth_cookies, test_project_id):
        """Test getting payments for a project"""
        if not test_project_id:
            pytest.skip("No non-draft project available")
        
        response = requests.get(f"{BASE_URL}/api/payments/project/{test_project_id}", cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        payments = response.json()
        assert isinstance(payments, list)
        for p in payments:
            assert "id" in p
            assert "amount" in p
            assert "payment_method" in p
        print(f"✓ Retrieved {len(payments)} payments for project")


class TestMaterialUsage:
    """Material Usage API tests"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}
        )
        return response.cookies
    
    @pytest.fixture(scope="class")
    def test_project_id(self, auth_cookies):
        response = requests.get(f"{BASE_URL}/api/projects", cookies=auth_cookies)
        projects = response.json()
        non_draft = [p for p in projects if p.get("status") != "draft"]
        if non_draft:
            return non_draft[0]["id"]
        return None
    
    def test_create_material_usage(self, auth_cookies, test_project_id):
        """Test creating a material usage log"""
        if not test_project_id:
            pytest.skip("No non-draft project available")
        
        usage_data = {
            "project_id": test_project_id,
            "item_name": "TEST_Inverter 5kW",
            "estimated_qty": 1.0,
            "actual_qty": 1.0,
            "wastage": 0.0,
            "notes": "Installed as planned"
        }
        response = requests.post(f"{BASE_URL}/api/material-usage", json=usage_data, cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["message"] == "Usage logged"
        print(f"✓ Material usage logged: {data['id']}")
    
    def test_get_project_material_usage(self, auth_cookies, test_project_id):
        """Test getting material usage for a project"""
        if not test_project_id:
            pytest.skip("No non-draft project available")
        
        response = requests.get(f"{BASE_URL}/api/material-usage/project/{test_project_id}", cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        logs = response.json()
        assert isinstance(logs, list)
        for log in logs:
            assert "id" in log
            assert "item_name" in log
            assert "estimated_qty" in log
            assert "actual_qty" in log
        print(f"✓ Retrieved {len(logs)} material usage logs")


class TestDataCompleteness:
    """Data Completeness API tests"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}
        )
        return response.cookies
    
    @pytest.fixture(scope="class")
    def test_project_id(self, auth_cookies):
        response = requests.get(f"{BASE_URL}/api/projects", cookies=auth_cookies)
        projects = response.json()
        if projects:
            return projects[0]["id"]
        return None
    
    def test_get_completeness_score(self, auth_cookies, test_project_id):
        """Test getting completeness score for a project"""
        if not test_project_id:
            pytest.skip("No project available")
        
        response = requests.get(f"{BASE_URL}/api/projects/{test_project_id}/completeness", cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "score" in data
        assert "checks" in data
        assert isinstance(data["score"], (int, float))
        assert 0 <= data["score"] <= 100
        
        # Verify checks structure
        checks = data["checks"]
        expected_checks = ["customer_details", "site_data", "electrical_data", "costing", "site_docs", "daily_updates"]
        for check in expected_checks:
            assert check in checks, f"Missing check: {check}"
            assert isinstance(checks[check], bool)
        
        print(f"✓ Completeness score: {data['score']}%")
        print(f"  Checks: {checks}")


class TestProjectReport:
    """Project Report API tests"""
    
    @pytest.fixture(scope="class")
    def auth_cookies(self):
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}
        )
        return response.cookies
    
    @pytest.fixture(scope="class")
    def test_project_id(self, auth_cookies):
        response = requests.get(f"{BASE_URL}/api/projects", cookies=auth_cookies)
        projects = response.json()
        if projects:
            return projects[0]["id"]
        return None
    
    def test_get_project_report(self, auth_cookies, test_project_id):
        """Test getting full project report"""
        if not test_project_id:
            pytest.skip("No project available")
        
        response = requests.get(f"{BASE_URL}/api/projects/{test_project_id}/report", cookies=auth_cookies)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify structure
        assert "project" in data
        assert "payments" in data
        assert "total_paid" in data
        assert "balance" in data
        assert "payment_status" in data
        assert "material_usage" in data
        assert "daily_updates" in data
        
        # Verify project details
        project = data["project"]
        assert "id" in project
        assert "customer" in project
        assert "status" in project
        
        # Verify payment status is valid
        assert data["payment_status"] in ["Paid", "Partial", "Pending"]
        
        print(f"✓ Project report retrieved")
        print(f"  Total paid: Rs {data['total_paid']}")
        print(f"  Balance: Rs {data['balance']}")
        print(f"  Status: {data['payment_status']}")
        print(f"  Updates: {len(data['daily_updates'])}")
        print(f"  Material logs: {len(data['material_usage'])}")



