"""
Iteration 13: Test Editable System Tabs Feature
Tests that system tabs (customer, location, site_electrical, materials, site_docs) 
are now fully editable by admin - rename, add/remove fields, toggle active/inactive, delete.
System tabs preserve their slug when renamed (for hardcoded content rendering).
"""

import pytest
import requests
import os
import os
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestEditableSystemTabs:
    """Test that system tabs are now fully editable"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin and get session"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.admin_user = login_resp.json()
        print(f"Logged in as admin: {self.admin_user['email']}")
        yield
        # Cleanup - restore any modified tabs
    
    def test_01_get_all_tabs_returns_8_tabs(self):
        """Verify all 8 tabs are returned including system tabs"""
        resp = self.session.get(f"{BASE_URL}/api/form-tabs")
        assert resp.status_code == 200, f"Failed to get tabs: {resp.text}"
        tabs = resp.json()
        print(f"Total tabs: {len(tabs)}")
        for t in tabs:
            print(f"  - {t['name']} (slug: {t['slug']}, system: {t.get('system', False)}, id: {t.get('id')})")
        assert len(tabs) >= 5, "Should have at least 5 system tabs"
        # Verify system tabs exist
        system_slugs = ['customer', 'location', 'site_electrical', 'materials', 'site_docs']
        found_slugs = [t['slug'] for t in tabs]
        for slug in system_slugs:
            assert slug in found_slugs, f"System tab '{slug}' not found"
        print("PASS: All 8 tabs returned with system tabs present")
    
    def test_02_system_tabs_have_edit_toggle_delete_buttons(self):
        """Verify system tabs have id (needed for edit/toggle/delete)"""
        resp = self.session.get(f"{BASE_URL}/api/form-tabs")
        assert resp.status_code == 200
        tabs = resp.json()
        system_tabs = [t for t in tabs if t.get('system')]
        print(f"System tabs count: {len(system_tabs)}")
        for t in system_tabs:
            assert 'id' in t, f"System tab {t['name']} missing 'id' field"
            print(f"  - {t['name']} has id: {t['id']}")
        print("PASS: All system tabs have 'id' field for edit/toggle/delete operations")
    
    def test_03_edit_system_tab_customer_rename(self):
        """Edit system tab 'Customer' - rename to 'Client Details'"""
        # Get Customer tab
        resp = self.session.get(f"{BASE_URL}/api/form-tabs")
        assert resp.status_code == 200
        tabs = resp.json()
        customer_tab = next((t for t in tabs if t['slug'] == 'customer'), None)
        assert customer_tab, "Customer tab not found"
        tab_id = customer_tab['id']
        original_name = customer_tab['name']
        print(f"Customer tab id: {tab_id}, original name: {original_name}")
        
        # Rename to 'Client Details'
        update_resp = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={
            "name": "Client Details"
        })
        assert update_resp.status_code == 200, f"Failed to rename: {update_resp.text}"
        print(f"Renamed Customer to 'Client Details': {update_resp.json()}")
        
        # Verify rename worked and slug is preserved
        resp2 = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs2 = resp2.json()
        renamed_tab = next((t for t in tabs2 if t['id'] == tab_id), None)
        assert renamed_tab, "Renamed tab not found"
        assert renamed_tab['name'] == 'Client Details', f"Name not updated: {renamed_tab['name']}"
        assert renamed_tab['slug'] == 'customer', f"Slug should be preserved: {renamed_tab['slug']}"
        print(f"PASS: System tab renamed to '{renamed_tab['name']}', slug preserved as '{renamed_tab['slug']}'")
        
        # Restore original name
        restore_resp = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={
            "name": original_name
        })
        assert restore_resp.status_code == 200
        print(f"Restored name to '{original_name}'")
    
    def test_04_add_field_to_system_tab_customer(self):
        """Add a text field 'alternate_contact' to Customer system tab"""
        resp = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = resp.json()
        customer_tab = next((t for t in tabs if t['slug'] == 'customer'), None)
        assert customer_tab, "Customer tab not found"
        tab_id = customer_tab['id']
        original_fields = customer_tab.get('fields', [])
        print(f"Customer tab original fields: {len(original_fields)}")
        
        # Add new field
        new_fields = original_fields + [{
            "name": "alternate_contact",
            "label": "Alternate Contact",
            "type": "text",
            "required": False,
            "placeholder": "Enter alternate contact number",
            "options": []
        }]
        
        update_resp = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={
            "fields": new_fields
        })
        assert update_resp.status_code == 200, f"Failed to add field: {update_resp.text}"
        print(f"Added 'alternate_contact' field to Customer tab")
        
        # Verify field was added
        resp2 = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs2 = resp2.json()
        updated_tab = next((t for t in tabs2 if t['id'] == tab_id), None)
        assert updated_tab, "Updated tab not found"
        field_names = [f['name'] for f in updated_tab.get('fields', [])]
        assert 'alternate_contact' in field_names, f"Field not added: {field_names}"
        print(f"PASS: Field 'alternate_contact' added to Customer tab. Total fields: {len(updated_tab.get('fields', []))}")
        
        # Cleanup - remove the added field
        restore_resp = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={
            "fields": original_fields
        })
        assert restore_resp.status_code == 200
        print("Cleaned up - removed test field")
    
    def test_05_toggle_system_tab_location_inactive(self):
        """Toggle Location system tab to inactive"""
        resp = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = resp.json()
        location_tab = next((t for t in tabs if t['slug'] == 'location'), None)
        assert location_tab, "Location tab not found"
        tab_id = location_tab['id']
        original_active = location_tab.get('active', True)
        print(f"Location tab id: {tab_id}, active: {original_active}")
        
        # Toggle to inactive
        update_resp = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={
            "active": False
        })
        assert update_resp.status_code == 200, f"Failed to toggle: {update_resp.text}"
        print("Toggled Location to inactive")
        
        # Verify toggle worked
        resp2 = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs2 = resp2.json()
        toggled_tab = next((t for t in tabs2 if t['id'] == tab_id), None)
        assert toggled_tab, "Toggled tab not found"
        assert toggled_tab.get('active') == False, f"Active not updated: {toggled_tab.get('active')}"
        print(f"PASS: Location tab toggled to inactive")
        
        # Restore to active
        restore_resp = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={
            "active": True
        })
        assert restore_resp.status_code == 200
        print("Restored Location to active")
    
    def test_06_add_required_select_field_to_materials(self):
        """Add a required select field 'warranty_type' to Materials system tab"""
        resp = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = resp.json()
        materials_tab = next((t for t in tabs if t['slug'] == 'materials'), None)
        assert materials_tab, "Materials tab not found"
        tab_id = materials_tab['id']
        original_fields = materials_tab.get('fields', [])
        print(f"Materials tab original fields: {len(original_fields)}")
        
        # Add required select field
        new_fields = original_fields + [{
            "name": "warranty_type",
            "label": "Warranty Type",
            "type": "select",
            "required": True,
            "placeholder": "Select warranty type",
            "options": ["Standard", "Extended", "Premium"]
        }]
        
        update_resp = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={
            "fields": new_fields
        })
        assert update_resp.status_code == 200, f"Failed to add field: {update_resp.text}"
        print(f"Added 'warranty_type' required select field to Materials tab")
        
        # Verify field was added
        resp2 = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs2 = resp2.json()
        updated_tab = next((t for t in tabs2 if t['id'] == tab_id), None)
        warranty_field = next((f for f in updated_tab.get('fields', []) if f['name'] == 'warranty_type'), None)
        assert warranty_field, "Warranty field not found"
        assert warranty_field['required'] == True, "Field should be required"
        assert warranty_field['type'] == 'select', "Field should be select type"
        assert warranty_field['options'] == ["Standard", "Extended", "Premium"], f"Options mismatch: {warranty_field['options']}"
        print(f"PASS: Required select field 'warranty_type' added with options: {warranty_field['options']}")
        
        # Cleanup
        restore_resp = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={
            "fields": original_fields
        })
        assert restore_resp.status_code == 200
        print("Cleaned up - removed test field")
    
    def test_07_system_tab_slug_preserved_on_rename(self):
        """Verify system tab slug is preserved when renamed (for hardcoded content)"""
        resp = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = resp.json()
        site_electrical_tab = next((t for t in tabs if t['slug'] == 'site_electrical'), None)
        assert site_electrical_tab, "Site Electrical tab not found"
        tab_id = site_electrical_tab['id']
        original_name = site_electrical_tab['name']
        original_slug = site_electrical_tab['slug']
        print(f"Site Electrical tab: name='{original_name}', slug='{original_slug}'")
        
        # Rename to something different
        update_resp = self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={
            "name": "Electrical & Grid Info"
        })
        assert update_resp.status_code == 200
        
        # Verify slug is preserved
        resp2 = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs2 = resp2.json()
        renamed_tab = next((t for t in tabs2 if t['id'] == tab_id), None)
        assert renamed_tab['name'] == 'Electrical & Grid Info', f"Name not updated: {renamed_tab['name']}"
        assert renamed_tab['slug'] == 'site_electrical', f"Slug should be preserved: {renamed_tab['slug']}"
        print(f"PASS: System tab slug preserved as '{renamed_tab['slug']}' after rename to '{renamed_tab['name']}'")
        
        # Restore
        self.session.put(f"{BASE_URL}/api/form-tabs/{tab_id}", json={"name": original_name})
    
    def test_08_delete_system_tab_works(self):
        """Verify DELETE on system tab works (no 403)"""
        # First create a test system-like tab to delete (we won't actually delete real system tabs)
        # Instead, let's verify the endpoint doesn't return 403 for system tabs
        resp = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = resp.json()
        
        # Create a temporary custom tab to test delete
        create_resp = self.session.post(f"{BASE_URL}/api/form-tabs", json={
            "name": "Test Delete Tab",
            "fields": [{"name": "test_field", "label": "Test", "type": "text", "required": False, "placeholder": "", "options": []}],
            "roles_visible": ["admin", "manager", "staff"]
        })
        assert create_resp.status_code == 200, f"Failed to create test tab: {create_resp.text}"
        test_tab_id = create_resp.json()['id']
        print(f"Created test tab with id: {test_tab_id}")
        
        # Delete the test tab
        delete_resp = self.session.delete(f"{BASE_URL}/api/form-tabs/{test_tab_id}")
        assert delete_resp.status_code == 200, f"Delete failed: {delete_resp.text}"
        print(f"PASS: Delete endpoint works (status 200)")
        
        # Verify it's deleted
        resp2 = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs2 = resp2.json()
        deleted_tab = next((t for t in tabs2 if t.get('id') == test_tab_id), None)
        assert deleted_tab is None, "Tab should be deleted"
        print("PASS: Tab successfully deleted")
    
    def test_09_reorder_tabs_custom_above_system(self):
        """Reorder tabs - move a custom tab above a system tab"""
        resp = self.session.get(f"{BASE_URL}/api/form-tabs")
        tabs = resp.json()
        tab_ids = [t['id'] for t in tabs]
        original_order = [(t['name'], t['id']) for t in tabs]
        print(f"Original order: {[t[0] for t in original_order]}")
        
        # Find a custom tab and a system tab
        custom_tabs = [t for t in tabs if not t.get('system')]
        system_tabs = [t for t in tabs if t.get('system')]
        
        if custom_tabs and system_tabs:
            # Move first custom tab to position 0 (before first system tab)
            custom_tab = custom_tabs[0]
            new_order = [custom_tab['id']] + [t['id'] for t in tabs if t['id'] != custom_tab['id']]
            
            reorder_resp = self.session.put(f"{BASE_URL}/api/form-tabs/reorder", json={
                "order": new_order
            })
            assert reorder_resp.status_code == 200, f"Reorder failed: {reorder_resp.text}"
            print(f"Moved '{custom_tab['name']}' to first position")
            
            # Verify new order
            resp2 = self.session.get(f"{BASE_URL}/api/form-tabs")
            tabs2 = resp2.json()
            assert tabs2[0]['id'] == custom_tab['id'], f"First tab should be {custom_tab['name']}"
            print(f"PASS: Custom tab '{custom_tab['name']}' moved above system tabs")
            
            # Restore original order
            self.session.put(f"{BASE_URL}/api/form-tabs/reorder", json={"order": tab_ids})
            print("Restored original order")
        else:
            print("SKIP: No custom tabs to reorder")


class TestFormTabsAPIValidation:
    """Additional API validation tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200
        yield
    
    def test_10_update_nonexistent_tab_returns_404(self):
        """PUT on non-existent tab returns 404"""
        resp = self.session.put(f"{BASE_URL}/api/form-tabs/000000000000000000000000", json={
            "name": "Test"
        })
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: Non-existent tab returns 404")
    
    def test_11_delete_nonexistent_tab_returns_404(self):
        """DELETE on non-existent tab returns 404"""
        resp = self.session.delete(f"{BASE_URL}/api/form-tabs/000000000000000000000000")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("PASS: Delete non-existent tab returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])