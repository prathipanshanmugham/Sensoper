"""
Iteration 12: System Tabs in Form Tab Builder
Tests for system tabs (Customer, Location, Site & Electrical, Materials, Site Docs)
- System tabs appear in Form Tab Builder with 'System' badge
- System tabs are non-editable and non-deletable (403 error)
- System tabs are fully reorderable alongside custom tabs
- GET /api/form-tabs returns all tabs with 'system' flag
"""

import pytest
import requests
import os
import os
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# System tab slugs
SYSTEM_SLUGS = ['customer', 'location', 'site_electrical', 'materials', 'site_docs']

class TestSystemTabs:
    """Test system tabs functionality in Form Tab Builder"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get session cookies"""
        self.session = requests.Session()
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.user = login_response.json()
        yield
        # Cleanup - restore original tab order if needed
        
    def test_01_get_form_tabs_returns_all_tabs_with_system_flag(self):
        """GET /api/form-tabs returns all tabs with 'system' flag"""
        response = self.session.get(f"{BASE_URL}/api/form-tabs")
        assert response.status_code == 200, f"Failed to get form tabs: {response.text}"
        
        tabs = response.json()
        assert len(tabs) >= 8, f"Expected at least 8 tabs, got {len(tabs)}"
        
        # Verify all tabs have 'system' field
        for tab in tabs:
            assert 'system' in tab, f"Tab {tab['name']} missing 'system' field"
            assert 'id' in tab, f"Tab {tab['name']} missing 'id' field"
            assert 'order' in tab, f"Tab {tab['name']} missing 'order' field"
            assert 'active' in tab, f"Tab {tab['name']} missing 'active' field"
        
        # Verify system tabs are present
        system_tabs = [t for t in tabs if t.get('system') == True]
        assert len(system_tabs) == 5, f"Expected 5 system tabs, got {len(system_tabs)}"
        
        system_slugs_found = [t['slug'] for t in system_tabs]
        for slug in SYSTEM_SLUGS:
            assert slug in system_slugs_found, f"System tab '{slug}' not found"
        
        print(f"✓ All {len(tabs)} tabs returned with system flag")
        print(f"✓ System tabs: {[t['name'] for t in system_tabs]}")
        
    def test_02_tabs_ordered_correctly(self):
        """Verify tabs are returned in correct order"""
        response = self.session.get(f"{BASE_URL}/api/form-tabs")
        assert response.status_code == 200
        
        tabs = response.json()
        expected_order = ['Customer', 'Location', 'Site & Electrical', 'Materials', 
                         'Subsidy Details', 'Customer Preferences', 'Finance Details', 'Site Docs']
        
        actual_order = [t['name'] for t in tabs]
        assert actual_order == expected_order, f"Tab order mismatch. Expected: {expected_order}, Got: {actual_order}"
        
        print(f"✓ Tabs in correct order: {actual_order}")
        
    def test_03_system_tab_update_returns_403(self):
        """PUT /api/form-tabs/{system_tab_id} returns 403"""
        # Get system tab ID
        response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = response.json()
        customer_tab = next((t for t in tabs if t['slug'] == 'customer'), None)
        assert customer_tab, "Customer tab not found"
        
        # Try to update system tab
        update_response = self.session.put(
            f"{BASE_URL}/api/form-tabs/{customer_tab['id']}",
            json={"name": "Modified Customer"}
        )
        assert update_response.status_code == 403, f"Expected 403, got {update_response.status_code}"
        assert "System tabs cannot be edited" in update_response.json().get('detail', '')
        
        print(f"✓ PUT on system tab returns 403: {update_response.json()}")
        
    def test_04_system_tab_delete_returns_403(self):
        """DELETE /api/form-tabs/{system_tab_id} returns 403"""
        # Get system tab ID
        response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = response.json()
        location_tab = next((t for t in tabs if t['slug'] == 'location'), None)
        assert location_tab, "Location tab not found"
        
        # Try to delete system tab
        delete_response = self.session.delete(f"{BASE_URL}/api/form-tabs/{location_tab['id']}")
        assert delete_response.status_code == 403, f"Expected 403, got {delete_response.status_code}"
        assert "System tabs cannot be deleted" in delete_response.json().get('detail', '')
        
        print(f"✓ DELETE on system tab returns 403: {delete_response.json()}")
        
    def test_05_reorder_tabs_with_system_and_custom(self):
        """PUT /api/form-tabs/reorder works with mix of system + custom tab IDs"""
        # Get all tabs
        response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = response.json()
        
        # Get tab IDs in current order
        original_order = [t['id'] for t in tabs]
        
        # Create new order: move Subsidy Details above Materials
        # Original: Customer, Location, Site & Electrical, Materials, Subsidy Details, ...
        # New: Customer, Location, Site & Electrical, Subsidy Details, Materials, ...
        customer_id = next(t['id'] for t in tabs if t['slug'] == 'customer')
        location_id = next(t['id'] for t in tabs if t['slug'] == 'location')
        site_electrical_id = next(t['id'] for t in tabs if t['slug'] == 'site_electrical')
        materials_id = next(t['id'] for t in tabs if t['slug'] == 'materials')
        subsidy_id = next(t['id'] for t in tabs if t['slug'] == 'subsidy_details')
        customer_prefs_id = next(t['id'] for t in tabs if t['slug'] == 'customer_preferences')
        finance_id = next(t['id'] for t in tabs if t['slug'] == 'finance_details')
        site_docs_id = next(t['id'] for t in tabs if t['slug'] == 'site_docs')
        
        new_order = [customer_id, location_id, site_electrical_id, subsidy_id, materials_id, 
                     customer_prefs_id, finance_id, site_docs_id]
        
        # Reorder
        reorder_response = self.session.put(
            f"{BASE_URL}/api/form-tabs/reorder",
            json={"order": new_order}
        )
        assert reorder_response.status_code == 200, f"Reorder failed: {reorder_response.text}"
        
        # Verify new order
        verify_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        reordered_tabs = verify_response.json()
        
        assert reordered_tabs[3]['slug'] == 'subsidy_details', "Subsidy Details should be at position 4"
        assert reordered_tabs[4]['slug'] == 'materials', "Materials should be at position 5"
        
        print(f"✓ Reorder successful: {[t['name'] for t in reordered_tabs]}")
        
        # Restore original order
        restore_response = self.session.put(
            f"{BASE_URL}/api/form-tabs/reorder",
            json={"order": original_order}
        )
        assert restore_response.status_code == 200, "Failed to restore original order"
        print("✓ Original order restored")
        
    def test_06_create_new_tab_inserts_before_site_docs(self):
        """POST /api/form-tabs creates new tab - verify it inserts before site_docs"""
        # Create a test tab
        test_tab = {
            "name": "TEST_Iteration12_Tab",
            "fields": [
                {"name": "test_field", "label": "Test Field", "type": "text", "required": False, "placeholder": "", "options": []}
            ],
            "roles_visible": ["admin", "manager", "staff"]
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/form-tabs", json=test_tab)
        assert create_response.status_code == 200, f"Failed to create tab: {create_response.text}"
        
        created_tab_id = create_response.json().get('id')
        
        # Verify tab is before site_docs
        tabs_response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = tabs_response.json()
        
        test_tab_order = next((t['order'] for t in tabs if t['id'] == created_tab_id), None)
        site_docs_order = next((t['order'] for t in tabs if t['slug'] == 'site_docs'), None)
        
        assert test_tab_order is not None, "Test tab not found"
        assert site_docs_order is not None, "Site Docs tab not found"
        assert test_tab_order < site_docs_order, f"Test tab (order {test_tab_order}) should be before Site Docs (order {site_docs_order})"
        
        print(f"✓ New tab created at order {test_tab_order}, Site Docs at order {site_docs_order}")
        
        # Cleanup - delete test tab
        delete_response = self.session.delete(f"{BASE_URL}/api/form-tabs/{created_tab_id}")
        assert delete_response.status_code == 200, f"Failed to delete test tab: {delete_response.text}"
        print("✓ Test tab cleaned up")
        
    def test_07_custom_tab_can_be_edited(self):
        """Verify custom tabs can still be edited (not system protected)"""
        # Get custom tab
        response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = response.json()
        subsidy_tab = next((t for t in tabs if t['slug'] == 'subsidy_details'), None)
        assert subsidy_tab, "Subsidy Details tab not found"
        assert subsidy_tab.get('system') == False, "Subsidy Details should not be a system tab"
        
        # Update custom tab (toggle active)
        original_active = subsidy_tab.get('active', True)
        update_response = self.session.put(
            f"{BASE_URL}/api/form-tabs/{subsidy_tab['id']}",
            json={"active": not original_active}
        )
        assert update_response.status_code == 200, f"Failed to update custom tab: {update_response.text}"
        
        # Restore original state
        restore_response = self.session.put(
            f"{BASE_URL}/api/form-tabs/{subsidy_tab['id']}",
            json={"active": original_active}
        )
        assert restore_response.status_code == 200
        
        print(f"✓ Custom tab '{subsidy_tab['name']}' can be edited")
        
    def test_08_all_system_tabs_have_correct_properties(self):
        """Verify all system tabs have correct properties"""
        response = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = response.json()
        
        expected_system_tabs = {
            'customer': {'name': 'Customer', 'icon': 'User'},
            'location': {'name': 'Location', 'icon': 'MapPin'},
            'site_electrical': {'name': 'Site & Electrical', 'icon': 'Zap'},
            'materials': {'name': 'Materials', 'icon': 'Package'},
            'site_docs': {'name': 'Site Docs', 'icon': 'FolderOpen'}
        }
        
        for slug, expected in expected_system_tabs.items():
            tab = next((t for t in tabs if t['slug'] == slug), None)
            assert tab, f"System tab '{slug}' not found"
            assert tab.get('system') == True, f"Tab '{slug}' should have system=True"
            assert tab.get('active') == True, f"System tab '{slug}' should be active"
            assert tab.get('name') == expected['name'], f"Tab '{slug}' name mismatch"
            assert tab.get('icon') == expected['icon'], f"Tab '{slug}' icon mismatch"
            assert 'admin' in tab.get('roles_visible', []), f"Tab '{slug}' should be visible to admin"
            
        print("✓ All system tabs have correct properties")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])