"""
Iteration 11: Form Tab Builder (Dynamic Form Engine) Tests
Tests for:
- GET /api/form-tabs - List all form tabs
- POST /api/form-tabs - Create new tab
- PUT /api/form-tabs/{id} - Update tab
- DELETE /api/form-tabs/{id} - Delete tab
- PUT /api/form-tabs/reorder - Reorder tabs
- Dynamic tabs in SiteVisitForm
"""

import pytest
import requests
import os
import time
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestFormTabsAPI:
    """Form Tabs CRUD API Tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get session cookies"""
        self.session = requests.Session()
        login_response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}
        )
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.user = login_response.json()
        yield
        # Cleanup: Delete test tabs created during tests
        tabs_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        if tabs_response.status_code == 200:
            for tab in tabs_response.json():
                if tab.get("name", "").startswith("TEST_"):
                    self.session.delete(f"{BASE_URL}/api/form-tabs/{tab['id']}")
    
    def test_01_get_form_tabs_returns_list(self):
        """GET /api/form-tabs returns list of tabs"""
        response = self.session.get(f"{BASE_URL}/api/form-tabs")
        assert response.status_code == 200, f"Failed: {response.text}"
        tabs = response.json()
        assert isinstance(tabs, list), "Response should be a list"
        print(f"Found {len(tabs)} existing tabs")
        
        # Verify existing tabs structure
        if len(tabs) > 0:
            tab = tabs[0]
            assert "id" in tab, "Tab should have id"
            assert "name" in tab, "Tab should have name"
            assert "slug" in tab, "Tab should have slug"
            assert "fields" in tab, "Tab should have fields"
            assert "roles_visible" in tab, "Tab should have roles_visible"
            assert "active" in tab, "Tab should have active status"
            print(f"Tab structure verified: {tab['name']}")
    
    def test_02_existing_tabs_have_correct_structure(self):
        """Verify existing Subsidy Details and Finance Details tabs"""
        response = self.session.get(f"{BASE_URL}/api/form-tabs")
        assert response.status_code == 200
        tabs = response.json()
        
        # Find Subsidy Details tab
        subsidy_tab = next((t for t in tabs if t["slug"] == "subsidy_details"), None)
        assert subsidy_tab is not None, "Subsidy Details tab should exist"
        assert subsidy_tab["active"] == True, "Subsidy Details should be active"
        assert len(subsidy_tab["fields"]) >= 1, "Subsidy Details should have fields"
        
        # Verify subsidy_type field is required
        subsidy_type_field = next((f for f in subsidy_tab["fields"] if f["name"] == "subsidy_type"), None)
        assert subsidy_type_field is not None, "subsidy_type field should exist"
        assert subsidy_type_field["required"] == True, "subsidy_type should be required"
        assert subsidy_type_field["type"] == "select", "subsidy_type should be select type"
        print(f"Subsidy Details tab verified with {len(subsidy_tab['fields'])} fields")
        
        # Find Finance Details tab
        finance_tab = next((t for t in tabs if t["slug"] == "finance_details"), None)
        assert finance_tab is not None, "Finance Details tab should exist"
        print(f"Finance Details tab verified with {len(finance_tab['fields'])} fields")
    
    def test_03_create_new_tab(self):
        """POST /api/form-tabs creates a new tab"""
        new_tab = {
            "name": "TEST_Customer Preferences",
            "fields": [
                {
                    "name": "preferred_brand",
                    "label": "Preferred Brand",
                    "type": "text",
                    "required": False,
                    "placeholder": "e.g., Tata, Adani",
                    "options": []
                },
                {
                    "name": "roof_preference",
                    "label": "Roof Preference",
                    "type": "select",
                    "required": False,
                    "placeholder": "Select preference",
                    "options": ["Flat", "Tilted", "Both"]
                },
                {
                    "name": "wants_monitoring",
                    "label": "Wants Monitoring",
                    "type": "checkbox",
                    "required": False,
                    "placeholder": "",
                    "options": []
                }
            ],
            "roles_visible": ["admin", "staff"]
        }
        
        response = self.session.post(f"{BASE_URL}/api/form-tabs", json=new_tab)
        assert response.status_code == 200, f"Create failed: {response.text}"
        result = response.json()
        assert "id" in result, "Response should contain id"
        assert result.get("message") == "Form tab created", "Should return success message"
        print(f"Created tab with id: {result['id']}")
        
        # Verify tab was created
        tabs_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = tabs_response.json()
        created_tab = next((t for t in tabs if t["name"] == "TEST_Customer Preferences"), None)
        assert created_tab is not None, "Created tab should appear in list"
        assert created_tab["slug"] == "test_customer_preferences", "Slug should be auto-generated"
        assert len(created_tab["fields"]) == 3, "Tab should have 3 fields"
        assert created_tab["active"] == True, "New tab should be active by default"
        print(f"Verified created tab: {created_tab['name']}")
    
    def test_04_update_tab_name_and_fields(self):
        """PUT /api/form-tabs/{id} updates tab"""
        # First create a tab to update
        create_response = self.session.post(f"{BASE_URL}/api/form-tabs", json={
            "name": "TEST_Update Tab",
            "fields": [{"name": "field1", "label": "Field 1", "type": "text", "required": False, "placeholder": "", "options": []}],
            "roles_visible": ["admin"]
        })
        assert create_response.status_code == 200
        tab_id = create_response.json()["id"]
        
        # Update the tab
        update_data = {
            "name": "TEST_Updated Tab Name",
            "fields": [
                {"name": "field1", "label": "Updated Field Label", "type": "text", "required": True, "placeholder": "Updated", "options": []},
                {"name": "field2", "label": "New Field", "type": "number", "required": False, "placeholder": "", "options": []}
            ]
        }
        
        update_response = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json=update_data)
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        
        # Verify update
        tabs_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = tabs_response.json()
        updated_tab = next((t for t in tabs if t["id"] == tab_id), None)
        assert updated_tab is not None, "Updated tab should exist"
        assert updated_tab["name"] == "TEST_Updated Tab Name", "Name should be updated"
        assert len(updated_tab["fields"]) == 2, "Should have 2 fields now"
        assert updated_tab["fields"][0]["label"] == "Updated Field Label", "Field label should be updated"
        print(f"Tab updated successfully: {updated_tab['name']}")
    
    def test_05_toggle_tab_active_status(self):
        """PUT /api/form-tabs/{id} can toggle active status"""
        # Create a tab
        create_response = self.session.post(f"{BASE_URL}/api/form-tabs", json={
            "name": "TEST_Toggle Tab",
            "fields": [{"name": "f1", "label": "F1", "type": "text", "required": False, "placeholder": "", "options": []}],
            "roles_visible": ["admin"]
        })
        assert create_response.status_code == 200
        tab_id = create_response.json()["id"]
        
        # Deactivate the tab
        deactivate_response = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={"active": False})
        assert deactivate_response.status_code == 200, f"Deactivate failed: {deactivate_response.text}"
        
        # Verify deactivation
        tabs_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = tabs_response.json()
        deactivated_tab = next((t for t in tabs if t["id"] == tab_id), None)
        assert deactivated_tab is not None, "Tab should still exist"
        assert deactivated_tab["active"] == False, "Tab should be inactive"
        print(f"Tab deactivated: {deactivated_tab['name']}")
        
        # Reactivate the tab
        reactivate_response = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={"active": True})
        assert reactivate_response.status_code == 200
        
        tabs_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = tabs_response.json()
        reactivated_tab = next((t for t in tabs if t["id"] == tab_id), None)
        assert reactivated_tab["active"] == True, "Tab should be active again"
        print(f"Tab reactivated: {reactivated_tab['name']}")
    
    def test_06_reorder_tabs(self):
        """PUT /api/form-tabs/reorder reorders tabs"""
        # Get current tabs
        tabs_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = tabs_response.json()
        
        if len(tabs) < 2:
            pytest.skip("Need at least 2 tabs to test reorder")
        
        # Get tab IDs in reverse order
        tab_ids = [t["id"] for t in tabs]
        reversed_ids = list(reversed(tab_ids))
        
        # Reorder
        reorder_response = self.session.put(f"{BASE_URL}/api/form-tabs/reorder", json={"order": reversed_ids})
        assert reorder_response.status_code == 200, f"Reorder failed: {reorder_response.text}"
        
        # Verify new order
        new_tabs_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        new_tabs = new_tabs_response.json()
        new_tab_ids = [t["id"] for t in new_tabs]
        
        # The first tab should now be what was last
        assert new_tab_ids[0] == reversed_ids[0], "First tab should be reordered"
        print(f"Tabs reordered successfully")
        
        # Restore original order
        self.session.put(f"{BASE_URL}/api/form-tabs/reorder", json={"order": tab_ids})
    
    def test_07_delete_tab(self):
        """DELETE /api/form-tabs/{id} deletes a tab"""
        # Create a tab to delete
        create_response = self.session.post(f"{BASE_URL}/api/form-tabs", json={
            "name": "TEST_Delete Tab",
            "fields": [{"name": "f1", "label": "F1", "type": "text", "required": False, "placeholder": "", "options": []}],
            "roles_visible": ["admin"]
        })
        assert create_response.status_code == 200
        tab_id = create_response.json()["id"]
        
        # Delete the tab
        delete_response = self.session.delete(f"{BASE_URL}/api/form-tabs/{tab_id}")
        assert delete_response.status_code == 200, f"Delete failed: {delete_response.text}"
        
        # Verify deletion
        tabs_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = tabs_response.json()
        deleted_tab = next((t for t in tabs if t["id"] == tab_id), None)
        assert deleted_tab is None, "Deleted tab should not appear in list"
        print(f"Tab deleted successfully")
    
    def test_08_duplicate_tab_name_rejected(self):
        """POST /api/form-tabs rejects duplicate names"""
        # Create first tab
        create_response = self.session.post(f"{BASE_URL}/api/form-tabs", json={
            "name": "TEST_Duplicate Name",
            "fields": [{"name": "f1", "label": "F1", "type": "text", "required": False, "placeholder": "", "options": []}],
            "roles_visible": ["admin"]
        })
        assert create_response.status_code == 200
        
        # Try to create another with same name
        duplicate_response = self.session.post(f"{BASE_URL}/api/form-tabs", json={
            "name": "TEST_Duplicate Name",
            "fields": [{"name": "f2", "label": "F2", "type": "text", "required": False, "placeholder": "", "options": []}],
            "roles_visible": ["admin"]
        })
        assert duplicate_response.status_code == 400, "Should reject duplicate name"
        assert "already exists" in duplicate_response.json().get("detail", "").lower()
        print("Duplicate name correctly rejected")
    
    def test_09_update_nonexistent_tab_returns_404(self):
        """PUT /api/form-tabs/{id} returns 404 for nonexistent tab"""
        fake_id = "000000000000000000000000"
        response = self.session.put(f"{BASE_URL}/api/form-tabs/{fake_id}", json={"name": "Test"})
        assert response.status_code == 404, f"Should return 404, got {response.status_code}"
        print("Nonexistent tab update correctly returns 404")
    
    def test_10_delete_nonexistent_tab_returns_404(self):
        """DELETE /api/form-tabs/{id} returns 404 for nonexistent tab"""
        fake_id = "000000000000000000000000"
        response = self.session.delete(f"{BASE_URL}/api/form-tabs/{fake_id}")
        assert response.status_code == 404, f"Should return 404, got {response.status_code}"
        print("Nonexistent tab delete correctly returns 404")


class TestFormTabsInProject:
    """Test dynamic tabs integration with project creation"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get session cookies"""
        self.session = requests.Session()
        login_response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}
        )
        assert login_response.status_code == 200
        yield
    
    def test_11_project_with_custom_fields(self):
        """POST /api/projects accepts custom_fields for dynamic tabs"""
        project_data = {
            "customer": {"name": "TEST_DynamicTabs Customer", "phone": "9876543210", "address": "123 Test Street"},
            "location": {"site_location_words": "test.dynamic.tabs"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_link": "https://drive.google.com/drive/folders/test123",
            "custom_fields": {
                "subsidy_details": {
                    "subsidy_type": "Central",
                    "subsidy_amount": 78000,
                    "subsidy_notes": "PM Surya Ghar scheme"
                },
                "finance_details": {
                    "loan_required": True,
                    "bank_name": "SBI",
                    "loan_amount": 200000,
                    "payment_mode": "EMI"
                }
            }
        }
        
        response = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code == 200, f"Create project failed: {response.text}"
        project_id = response.json()["id"]
        print(f"Created project with custom_fields: {project_id}")
        
        # Verify custom_fields are stored
        get_response = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200
        project = get_response.json()
        
        assert "custom_fields" in project, "Project should have custom_fields"
        assert "subsidy_details" in project["custom_fields"], "Should have subsidy_details"
        assert project["custom_fields"]["subsidy_details"]["subsidy_type"] == "Central"
        assert project["custom_fields"]["subsidy_details"]["subsidy_amount"] == 78000
        assert "finance_details" in project["custom_fields"], "Should have finance_details"
        assert project["custom_fields"]["finance_details"]["loan_required"] == True
        print(f"Custom fields verified in project")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/projects/{project_id}/force")
    
    def test_12_project_update_custom_fields(self):
        """PUT /api/projects/{id} can update custom_fields"""
        # Create project
        project_data = {
            "customer": {"name": "TEST_UpdateCustom Customer", "phone": "9876543211", "address": "456 Test Ave"},
            "location": {"site_location_words": "update.custom.test"},
            "electrical": {"sanction_load_kw": 3, "connected_load_kw": 2, "monthly_consumption_units": 300, "eb_tariff": 6},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "Sheet", "tilt_angle": 10, "structure_type": "Aluminum"},
            "additional": {"cable_length_meters": 30, "inverter_to_panel_distance": 8, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_link": "https://drive.google.com/drive/folders/update123",
            "custom_fields": {"subsidy_details": {"subsidy_type": "State"}}
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert create_response.status_code == 200
        project_id = create_response.json()["id"]
        
        # Update custom_fields
        update_response = self.session.put(f"{BASE_URL}/api/projects/{project_id}", json={
            "custom_fields": {
                "subsidy_details": {"subsidy_type": "Both", "subsidy_amount": 100000}
            }
        })
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        
        # Verify update
        get_response = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        project = get_response.json()
        assert project["custom_fields"]["subsidy_details"]["subsidy_type"] == "Both"
        assert project["custom_fields"]["subsidy_details"]["subsidy_amount"] == 100000
        print(f"Custom fields updated successfully")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/projects/{project_id}/force")


class TestSiteMeasurementsAndSmartSuggestions:
    """Test site measurements and smart suggestions calculations"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get session cookies"""
        self.session = requests.Session()
        login_response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@sensoper.com", "password": TEST_ADMIN_PASSWORD}
        )
        assert login_response.status_code == 200
        yield
    
    def test_13_project_with_site_measurements(self):
        """POST /api/projects accepts site_measurements"""
        project_data = {
            "customer": {"name": "TEST_Measurements Customer", "phone": "9876543212", "address": "789 Measure St"},
            "location": {"site_location_words": "measure.test.site"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_link": "https://drive.google.com/drive/folders/measure123",
            "site_measurements": {
                "roof": {"length": 30, "width": 20, "area": 600, "type": "RCC", "height": 12},
                "orientation": {"direction": "South", "tilt_angle": 12},
                "shadow": {"present": True, "sources": ["Trees", "Buildings"], "obstruction_height": 15, "distance": 20},
                "obstructions": [{"name": "Water Tank", "notes": "North corner"}],
                "electrical": {"meter_location": "Ground floor", "db_distance": 25, "cable_length": 50},
                "load": {"monthly_units": 500, "connected_load": 5, "connection_type": "Residential"},
                "inverter": {"location": "Near DB", "wall_space": "Yes", "earthing_available": "Yes", "earthing_distance": 10},
                "access": {"type": "Stairs", "working_space": "Yes", "notes": "Easy access"}
            }
        }
        
        response = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code == 200, f"Create failed: {response.text}"
        project_id = response.json()["id"]
        
        # Verify site_measurements are stored
        get_response = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        project = get_response.json()
        
        assert "site_measurements" in project, "Project should have site_measurements"
        assert project["site_measurements"]["roof"]["length"] == 30
        assert project["site_measurements"]["roof"]["width"] == 20
        assert project["site_measurements"]["roof"]["area"] == 600
        assert project["site_measurements"]["shadow"]["present"] == True
        assert "Trees" in project["site_measurements"]["shadow"]["sources"]
        print(f"Site measurements verified in project")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/projects/{project_id}/force")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])