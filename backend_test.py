#!/usr/bin/env python3
"""
Backend API Testing for Solar Project Cost Estimator
Tests all API endpoints with proper authentication and data validation
"""

import requests
import sys
import json
from datetime import datetime

class SolarEstimatorAPITester:
    def __init__(self, base_url="https://solar-estimator-14.preview.emergentagent.com"):
        self.base_url = base_url
        self.session = requests.Session()
        self.admin_token = None
        self.test_user_id = None
        self.test_project_id = None
        self.tests_run = 0
        self.tests_passed = 0

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        return success

    def test_health_check(self):
        """Test basic API health"""
        try:
            response = self.session.get(f"{self.base_url}/api/health")
            return self.log_test("Health Check", response.status_code == 200, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Health Check", False, str(e))

    def test_admin_login(self):
        """Test admin login with correct credentials"""
        try:
            response = self.session.post(f"{self.base_url}/api/auth/login", json={
                "email": "admin@sensoper.com",
                "password": "Admin@123"
            })
            
            if response.status_code == 200:
                data = response.json()
                if data.get("role") == "admin":
                    return self.log_test("Admin Login", True)
                else:
                    return self.log_test("Admin Login", False, "Not admin role")
            else:
                return self.log_test("Admin Login", False, f"Status: {response.status_code}, Response: {response.text}")
        except Exception as e:
            return self.log_test("Admin Login", False, str(e))

    def test_invalid_login(self):
        """Test login with invalid credentials"""
        try:
            response = self.session.post(f"{self.base_url}/api/auth/login", json={
                "email": "invalid@test.com",
                "password": "wrongpassword"
            })
            return self.log_test("Invalid Login Rejection", response.status_code == 401)
        except Exception as e:
            return self.log_test("Invalid Login Rejection", False, str(e))

    def test_get_current_user(self):
        """Test getting current user info"""
        try:
            response = self.session.get(f"{self.base_url}/api/auth/me")
            if response.status_code == 200:
                data = response.json()
                return self.log_test("Get Current User", data.get("email") == "admin@sensoper.com")
            else:
                return self.log_test("Get Current User", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Get Current User", False, str(e))

    def test_dashboard_stats(self):
        """Test dashboard statistics endpoint"""
        try:
            response = self.session.get(f"{self.base_url}/api/dashboard/stats")
            if response.status_code == 200:
                data = response.json()
                required_fields = ["total", "draft", "submitted", "approved", "rejected", "completed"]
                has_all_fields = all(field in data for field in required_fields)
                return self.log_test("Dashboard Stats", has_all_fields, f"Missing fields: {[f for f in required_fields if f not in data]}")
            else:
                return self.log_test("Dashboard Stats", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Dashboard Stats", False, str(e))

    def test_create_project(self):
        """Test creating a new project"""
        try:
            project_data = {
                "customer": {
                    "name": "Test Customer",
                    "phone": "9876543210",
                    "address": "123 Test Street, Test City",
                    "email": "test@customer.com"
                },
                "location": {
                    "latitude": 12.9716,
                    "longitude": 77.5946,
                    "address": "Bangalore, Karnataka"
                },
                "electrical": {
                    "sanction_load_kw": 5.0,
                    "connected_load_kw": 4.0,
                    "monthly_consumption_units": 500.0,
                    "eb_tariff": 7.0
                },
                "solar_system": {
                    "system_type": "on-grid",
                    "inverter_model": "Growatt 5kW",
                    "panel_wattage": 540,
                    "battery_required": False
                },
                "mounting": {
                    "roof_type": "rcc",
                    "tilt_angle": 15,
                    "structure_type": "Standard"
                },
                "additional": {
                    "cable_length_meters": 50.0,
                    "inverter_to_panel_distance": 10.0,
                    "installation_complexity": "simple",
                    "shadow_analysis_notes": "No major shadows observed"
                },
                "site_images": []
            }
            
            response = self.session.post(f"{self.base_url}/api/projects", json=project_data)
            if response.status_code == 200:
                data = response.json()
                self.test_project_id = data.get("id")
                return self.log_test("Create Project", bool(self.test_project_id))
            else:
                return self.log_test("Create Project", False, f"Status: {response.status_code}, Response: {response.text}")
        except Exception as e:
            return self.log_test("Create Project", False, str(e))

    def test_get_projects(self):
        """Test getting projects list"""
        try:
            response = self.session.get(f"{self.base_url}/api/projects")
            if response.status_code == 200:
                data = response.json()
                return self.log_test("Get Projects", isinstance(data, list))
            else:
                return self.log_test("Get Projects", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Get Projects", False, str(e))

    def test_get_project_details(self):
        """Test getting specific project details"""
        if not self.test_project_id:
            return self.log_test("Get Project Details", False, "No test project ID available")
        
        try:
            response = self.session.get(f"{self.base_url}/api/projects/{self.test_project_id}")
            if response.status_code == 200:
                data = response.json()
                has_cost_estimation = "cost_estimation" in data
                return self.log_test("Get Project Details", has_cost_estimation)
            else:
                return self.log_test("Get Project Details", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Get Project Details", False, str(e))

    def test_submit_project(self):
        """Test submitting project for review"""
        if not self.test_project_id:
            return self.log_test("Submit Project", False, "No test project ID available")
        
        try:
            response = self.session.post(f"{self.base_url}/api/projects/{self.test_project_id}/submit")
            return self.log_test("Submit Project", response.status_code == 200)
        except Exception as e:
            return self.log_test("Submit Project", False, str(e))

    def test_approve_project(self):
        """Test approving a submitted project"""
        if not self.test_project_id:
            return self.log_test("Approve Project", False, "No test project ID available")
        
        try:
            response = self.session.post(f"{self.base_url}/api/projects/{self.test_project_id}/approve")
            return self.log_test("Approve Project", response.status_code == 200)
        except Exception as e:
            return self.log_test("Approve Project", False, str(e))

    def test_get_pricing_config(self):
        """Test getting pricing configuration"""
        try:
            response = self.session.get(f"{self.base_url}/api/pricing")
            if response.status_code == 200:
                data = response.json()
                required_fields = ["panel_price_per_watt", "inverter_price_per_kw", "margin_percentage"]
                has_required = all(field in data for field in required_fields)
                return self.log_test("Get Pricing Config", has_required)
            else:
                return self.log_test("Get Pricing Config", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Get Pricing Config", False, str(e))

    def test_update_pricing_config(self):
        """Test updating pricing configuration (admin only)"""
        try:
            pricing_data = {
                "panel_price_per_watt": 26.0,
                "inverter_price_per_kw": 8500.0,
                "structure_price_per_kw": 5200.0,
                "wiring_price_per_meter": 55.0,
                "labor_price_per_kw": 3200.0,
                "transportation_base": 5500.0,
                "margin_percentage": 16.0,
                "gst_percentage": 13.8,
                "battery_price_per_ah": 160.0
            }
            
            response = self.session.put(f"{self.base_url}/api/pricing", json=pricing_data)
            return self.log_test("Update Pricing Config", response.status_code == 200)
        except Exception as e:
            return self.log_test("Update Pricing Config", False, str(e))

    def test_get_users(self):
        """Test getting users list (admin only)"""
        try:
            response = self.session.get(f"{self.base_url}/api/users")
            if response.status_code == 200:
                data = response.json()
                return self.log_test("Get Users", isinstance(data, list) and len(data) > 0)
            else:
                return self.log_test("Get Users", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Get Users", False, str(e))

    def test_create_user(self):
        """Test creating a new user (admin only)"""
        try:
            timestamp = datetime.now().strftime("%H%M%S")
            user_data = {
                "email": f"testuser{timestamp}@sensoper.com",
                "password": "TestPass123!",
                "name": f"Test User {timestamp}",
                "role": "staff",
                "phone": "9876543210"
            }
            
            response = self.session.post(f"{self.base_url}/api/users", json=user_data)
            if response.status_code == 200:
                data = response.json()
                self.test_user_id = data.get("id")
                return self.log_test("Create User", bool(self.test_user_id))
            else:
                return self.log_test("Create User", False, f"Status: {response.status_code}, Response: {response.text}")
        except Exception as e:
            return self.log_test("Create User", False, str(e))

    def test_ai_recommendations(self):
        """Test AI recommendations endpoint"""
        try:
            ai_data = {
                "monthly_consumption_units": 500.0,
                "sanction_load_kw": 5.0,
                "roof_type": "rcc",
                "budget_range": "3-5 lakhs"
            }
            
            response = self.session.post(f"{self.base_url}/api/ai/recommendations", json=ai_data)
            if response.status_code == 200:
                data = response.json()
                return self.log_test("AI Recommendations", "recommendation" in data)
            else:
                return self.log_test("AI Recommendations", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("AI Recommendations", False, str(e))

    # ================== ENTERPRISE FEATURES TESTS ==================

    def test_terms_conditions_crud(self):
        """Test Terms & Conditions CRUD operations"""
        try:
            # Create new terms
            terms_data = {
                "title": "Test Terms v1",
                "content": "<ol><li>Test term 1</li><li>Test term 2</li></ol>",
                "language": "en"
            }
            
            response = self.session.post(f"{self.base_url}/api/terms", json=terms_data)
            if response.status_code != 200:
                return self.log_test("Terms & Conditions CRUD", False, f"Create failed: {response.status_code}")
            
            terms_id = response.json().get("id")
            
            # Get all terms
            response = self.session.get(f"{self.base_url}/api/terms")
            if response.status_code != 200:
                return self.log_test("Terms & Conditions CRUD", False, f"Get all failed: {response.status_code}")
            
            # Get active terms
            response = self.session.get(f"{self.base_url}/api/terms/active")
            if response.status_code != 200:
                return self.log_test("Terms & Conditions CRUD", False, f"Get active failed: {response.status_code}")
            
            # Update terms (activate)
            response = self.session.put(f"{self.base_url}/api/terms/{terms_id}", json={"is_active": True})
            if response.status_code != 200:
                return self.log_test("Terms & Conditions CRUD", False, f"Update failed: {response.status_code}")
            
            return self.log_test("Terms & Conditions CRUD", True)
        except Exception as e:
            return self.log_test("Terms & Conditions CRUD", False, str(e))

    def test_inventory_locations(self):
        """Test Inventory Locations management"""
        try:
            # Create location with unique code
            timestamp = datetime.now().strftime("%H%M%S")
            location_data = {
                "code": f"WH-TEST-{timestamp}",
                "name": f"Test Warehouse {timestamp}",
                "address": "Test Address"
            }
            
            response = self.session.post(f"{self.base_url}/api/inventory/locations", json=location_data)
            if response.status_code != 200:
                return self.log_test("Inventory Locations", False, f"Create failed: {response.status_code} - {response.text}")
            
            location_id = response.json().get("id")
            
            # Get all locations
            response = self.session.get(f"{self.base_url}/api/inventory/locations")
            if response.status_code != 200:
                return self.log_test("Inventory Locations", False, f"Get all failed: {response.status_code}")
            
            locations = response.json()
            test_location_found = any(loc.get("code") == f"WH-TEST-{timestamp}" for loc in locations)
            
            return self.log_test("Inventory Locations", test_location_found)
        except Exception as e:
            return self.log_test("Inventory Locations", False, str(e))

    def test_inventory_items(self):
        """Test Inventory Items management"""
        try:
            # Create item with unique SKU
            timestamp = datetime.now().strftime("%H%M%S")
            item_data = {
                "name": f"Test Solar Panel {timestamp}",
                "sku_code": f"TST-{timestamp}-MONO",
                "category": "solar_panels",
                "location_code": "WH-MAIN-01",  # Using default location
                "quantity": 100,
                "unit_price": 15000.0,
                "supplier": "Test Supplier",
                "gst_percentage": 18.0,
                "reorder_level": 10
            }
            
            response = self.session.post(f"{self.base_url}/api/inventory/items", json=item_data)
            if response.status_code != 200:
                return self.log_test("Inventory Items", False, f"Create failed: {response.status_code} - {response.text}")
            
            item_id = response.json().get("id")
            
            # Get all items
            response = self.session.get(f"{self.base_url}/api/inventory/items")
            if response.status_code != 200:
                return self.log_test("Inventory Items", False, f"Get all failed: {response.status_code}")
            
            # Get item details
            response = self.session.get(f"{self.base_url}/api/inventory/items/{item_id}")
            if response.status_code != 200:
                return self.log_test("Inventory Items", False, f"Get details failed: {response.status_code}")
            
            # Update item
            response = self.session.put(f"{self.base_url}/api/inventory/items/{item_id}", json={"quantity": 95})
            if response.status_code != 200:
                return self.log_test("Inventory Items", False, f"Update failed: {response.status_code}")
            
            return self.log_test("Inventory Items", True)
        except Exception as e:
            return self.log_test("Inventory Items", False, str(e))

    def test_inventory_alerts(self):
        """Test Inventory Low Stock Alerts"""
        try:
            response = self.session.get(f"{self.base_url}/api/inventory/alerts")
            if response.status_code == 200:
                data = response.json()
                return self.log_test("Inventory Alerts", isinstance(data, list))
            else:
                return self.log_test("Inventory Alerts", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Inventory Alerts", False, str(e))

    def test_deletion_workflow(self):
        """Test Project Deletion Approval Workflow"""
        if not self.test_project_id:
            return self.log_test("Deletion Workflow", False, "No test project ID available")
        
        try:
            # First, reset project to draft status for deletion request
            response = self.session.put(f"{self.base_url}/api/projects/{self.test_project_id}", json={"status": "draft"})
            
            # Request deletion
            deletion_data = {"reason": "Test deletion request"}
            response = self.session.post(f"{self.base_url}/api/projects/{self.test_project_id}/request-deletion", json=deletion_data)
            if response.status_code != 200:
                return self.log_test("Deletion Workflow", False, f"Request deletion failed: {response.status_code}")
            
            request_id = response.json().get("id")
            
            # Get deletion requests
            response = self.session.get(f"{self.base_url}/api/deletion-requests")
            if response.status_code != 200:
                return self.log_test("Deletion Workflow", False, f"Get requests failed: {response.status_code}")
            
            # Approve deletion
            response = self.session.post(f"{self.base_url}/api/deletion-requests/{request_id}/approve")
            if response.status_code != 200:
                return self.log_test("Deletion Workflow", False, f"Approve deletion failed: {response.status_code}")
            
            return self.log_test("Deletion Workflow", True)
        except Exception as e:
            return self.log_test("Deletion Workflow", False, str(e))

    def test_audit_logs(self):
        """Test Audit Logs system"""
        try:
            response = self.session.get(f"{self.base_url}/api/audit-logs")
            if response.status_code == 200:
                data = response.json()
                # Check if logs contain required fields
                if data and len(data) > 0:
                    log = data[0]
                    required_fields = ["user_name", "action_type", "entity_type", "timestamp"]
                    has_required = all(field in log for field in required_fields)
                    return self.log_test("Audit Logs", has_required)
                else:
                    return self.log_test("Audit Logs", True, "No logs yet (expected for new system)")
            else:
                return self.log_test("Audit Logs", False, f"Status: {response.status_code}")
        except Exception as e:
            return self.log_test("Audit Logs", False, str(e))

    def test_logout(self):
        """Test logout functionality"""
        try:
            response = self.session.post(f"{self.base_url}/api/auth/logout")
            return self.log_test("Logout", response.status_code == 200)
        except Exception as e:
            return self.log_test("Logout", False, str(e))

    def run_all_tests(self):
        """Run all backend tests"""
        print("🚀 Starting Solar Estimator Backend API Tests (Enterprise Features)")
        print("=" * 60)
        
        # Basic connectivity
        self.test_health_check()
        
        # Authentication tests
        self.test_invalid_login()
        self.test_admin_login()
        self.test_get_current_user()
        
        # Dashboard and stats
        self.test_dashboard_stats()
        
        # Project management
        self.test_create_project()
        self.test_get_projects()
        self.test_get_project_details()
        self.test_submit_project()
        self.test_approve_project()
        
        # Admin features
        self.test_get_pricing_config()
        self.test_update_pricing_config()
        self.test_get_users()
        self.test_create_user()
        
        # AI features
        self.test_ai_recommendations()
        
        # ================== ENTERPRISE FEATURES ==================
        print("\n🏢 Testing Enterprise Features:")
        print("-" * 40)
        
        # Terms & Conditions
        self.test_terms_conditions_crud()
        
        # Inventory Management
        self.test_inventory_locations()
        self.test_inventory_items()
        self.test_inventory_alerts()
        
        # Project Deletion Workflow
        self.test_deletion_workflow()
        
        # Audit Logs
        self.test_audit_logs()
        
        # Cleanup
        self.test_logout()
        
        print("=" * 60)
        print(f"📊 Tests completed: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return 0
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed")
            return 1

def main():
    tester = SolarEstimatorAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())