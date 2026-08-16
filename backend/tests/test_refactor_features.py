"""
Test suite for Solar Project Cost Estimator Refactor
Tests:
1. Inventory items with warehouse fields (zone, aisle, shelf, rack, bin)
2. Project creation with selected_items and manual_costs
3. Project retrieval with cost_estimation breakdown
4. What3Words location field
5. Pricing Config removal verification
"""

import pytest
import requests
import os
import os
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Login and get auth cookies"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return session
    
    def test_admin_login(self, auth_token):
        """Test admin login works"""
        response = auth_token.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "admin@sensoper.com"
        assert data["role"] == "admin"
        print("✓ Admin login successful")


class TestInventoryWarehouseFields:
    """Test inventory items with warehouse location fields"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Authenticated session"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_get_inventory_items_has_warehouse_fields(self, session):
        """GET /api/inventory/items returns items with zone/aisle/shelf/rack/bin_location"""
        response = session.get(f"{BASE_URL}/api/inventory/items")
        assert response.status_code == 200
        items = response.json()
        assert len(items) > 0, "No inventory items found"
        
        # Check first item has warehouse fields
        item = items[0]
        assert "zone" in item, "Missing 'zone' field"
        assert "aisle" in item, "Missing 'aisle' field"
        assert "shelf" in item, "Missing 'shelf' field"
        assert "rack" in item, "Missing 'rack' field"
        assert "bin_location" in item, "Missing 'bin_location' field"
        
        # Verify no location_code field (old field removed)
        assert "location_code" not in item, "Old 'location_code' field should be removed"
        
        print(f"✓ Inventory items have warehouse fields: zone={item.get('zone')}, aisle={item.get('aisle')}, shelf={item.get('shelf')}, rack={item.get('rack')}, bin={item.get('bin_location')}")
    
    def test_create_inventory_item_with_warehouse_fields(self, session):
        """POST /api/inventory/items accepts warehouse location fields"""
        test_item = {
            "name": "TEST_Warehouse_Panel",
            "sku_code": "TEST-WH-001",
            "category": "solar_panels",
            "zone": "A",
            "aisle": "A1",
            "shelf": "S2",
            "rack": "R3",
            "bin_location": "B5",
            "quantity": 10,
            "unit_price": 15000,
            "gst_percentage": 18,
            "reorder_level": 5
        }
        
        response = session.post(f"{BASE_URL}/api/inventory/items", json=test_item)
        assert response.status_code == 200, f"Failed to create item: {response.text}"
        data = response.json()
        item_id = data.get("id")
        assert item_id, "No item ID returned"
        
        # Verify item was created with warehouse fields
        get_response = session.get(f"{BASE_URL}/api/inventory/items/{item_id}")
        assert get_response.status_code == 200
        created_item = get_response.json()
        
        assert created_item["zone"] == "A"
        assert created_item["aisle"] == "A1"
        assert created_item["shelf"] == "S2"
        assert created_item["rack"] == "R3"
        assert created_item["bin_location"] == "B5"
        
        print(f"✓ Created inventory item with warehouse location: {created_item['zone']} > {created_item['aisle']} > {created_item['shelf']} > {created_item['rack']} > {created_item['bin_location']}")
        
        # Cleanup
        session.delete(f"{BASE_URL}/api/inventory/items/{item_id}")


class TestProjectWithSelectedItems:
    """Test project creation with selected_items and manual_costs"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Authenticated session"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    @pytest.fixture(scope="class")
    def inventory_items(self, session):
        """Get existing inventory items for testing"""
        response = session.get(f"{BASE_URL}/api/inventory/items")
        assert response.status_code == 200
        items = response.json()
        assert len(items) > 0, "No inventory items available for testing"
        return items
    
    def test_create_project_with_selected_items_and_manual_costs(self, session, inventory_items):
        """POST /api/projects accepts selected_items array and manual_costs array"""
        # Use first inventory item
        inv_item = inventory_items[0]
        
        project_data = {
            "customer": {
                "name": "TEST_Project_Customer",
                "phone": "9876543210",
                "address": "Test Address, Chennai",
                "email": "test@example.com"
            },
            "location": {
                "latitude": None,
                "longitude": None,
                "address": "Test Site Address",
                "site_location_words": "filled.count.soap"
            },
            "electrical": {
                "sanction_load_kw": 5.0,
                "connected_load_kw": 4.0,
                "monthly_consumption_units": 500,
                "eb_tariff": 7.0
            },
            "solar_system": {
                "system_type": "on-grid",
                "inverter_model": "Growatt 5kW",
                "panel_wattage": 540,
                "battery_required": False,
                "battery_capacity_ah": None
            },
            "mounting": {
                "roof_type": "rcc",
                "tilt_angle": 15,
                "structure_type": "GI Standard"
            },
            "additional": {
                "cable_length_meters": 50,
                "inverter_to_panel_distance": 10,
                "installation_complexity": "simple",
                "shadow_analysis_notes": "No shadows"
            },
            "selected_items": [
                {
                    "inventory_item_id": inv_item["id"],
                    "name": inv_item["name"],
                    "category": inv_item["category"],
                    "unit_price": inv_item["unit_price"],
                    "gst_percentage": inv_item.get("gst_percentage", 18),
                    "quantity": 2
                }
            ],
            "manual_costs": [
                {"description": "Installation Labor", "amount": 15000},
                {"description": "Transport", "amount": 5000}
            ],
            "site_images": []
        }
        
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code == 200, f"Failed to create project: {response.text}"
        data = response.json()
        project_id = data.get("id")
        assert project_id, "No project ID returned"
        
        print(f"✓ Created project with selected_items and manual_costs, ID: {project_id}")
        
        # Verify project data
        get_response = session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200
        project = get_response.json()
        
        # Check selected_items
        assert "selected_items" in project, "Missing selected_items in project"
        assert len(project["selected_items"]) == 1, "Expected 1 selected item"
        assert project["selected_items"][0]["name"] == inv_item["name"]
        assert project["selected_items"][0]["quantity"] == 2
        
        # Check manual_costs
        assert "manual_costs" in project, "Missing manual_costs in project"
        assert len(project["manual_costs"]) == 2, "Expected 2 manual costs"
        
        # Check cost_estimation with items_breakdown
        assert "cost_estimation" in project, "Missing cost_estimation in project"
        ce = project["cost_estimation"]
        assert "items_breakdown" in ce, "Missing items_breakdown in cost_estimation"
        assert "manual_costs" in ce, "Missing manual_costs in cost_estimation"
        assert "subtotal" in ce, "Missing subtotal"
        assert "total_gst" in ce, "Missing total_gst"
        assert "total_cost" in ce, "Missing total_cost"
        
        # Verify cost calculation
        expected_items_subtotal = inv_item["unit_price"] * 2
        expected_manual_total = 15000 + 5000
        assert ce["items_subtotal"] == expected_items_subtotal, f"Items subtotal mismatch: {ce['items_subtotal']} != {expected_items_subtotal}"
        assert ce["manual_subtotal"] == expected_manual_total, f"Manual subtotal mismatch: {ce['manual_subtotal']} != {expected_manual_total}"
        
        print(f"✓ Project has correct cost_estimation: items_subtotal={ce['items_subtotal']}, manual_subtotal={ce['manual_subtotal']}, total={ce['total_cost']}")
        
        # Cleanup - force delete
        session.delete(f"{BASE_URL}/api/projects/{project_id}/force")
        return project_id
    
    def test_project_has_what3words_field(self, session, inventory_items):
        """GET /api/projects/{id} returns What3Words address"""
        inv_item = inventory_items[0]
        
        project_data = {
            "customer": {"name": "TEST_W3W_Customer", "phone": "9876543210", "address": "Test Address"},
            "location": {
                "latitude": None,
                "longitude": None,
                "address": "Site Address",
                "site_location_words": "apple.orange.table"
            },
            "electrical": {"sanction_load_kw": 5.0, "connected_load_kw": 4.0, "monthly_consumption_units": 500, "eb_tariff": 7.0},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "rcc", "tilt_angle": 15, "structure_type": "Standard"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [{"inventory_item_id": inv_item["id"], "name": inv_item["name"], "category": inv_item["category"], "unit_price": inv_item["unit_price"], "gst_percentage": 18, "quantity": 1}],
            "manual_costs": [],
            "site_images": []
        }
        
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code == 200
        project_id = response.json()["id"]
        
        # Verify What3Words field
        get_response = session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200
        project = get_response.json()
        
        assert project["location"]["site_location_words"] == "apple.orange.table"
        print(f"✓ Project has What3Words address: {project['location']['site_location_words']}")
        
        # Cleanup
        session.delete(f"{BASE_URL}/api/projects/{project_id}/force")


class TestPricingConfigRemoved:
    """Verify Pricing Config endpoints are removed"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Authenticated session"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_pricing_config_endpoint_not_found(self, session):
        """GET /api/pricing should return 404 (removed)"""
        response = session.get(f"{BASE_URL}/api/pricing")
        # Should be 404 or 405 (not found or method not allowed)
        assert response.status_code in [404, 405, 422], f"Pricing endpoint should be removed, got {response.status_code}"
        print("✓ Pricing Config endpoint removed (404/405)")


class TestExistingInventoryItems:
    """Verify seeded inventory items exist"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Authenticated session"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_seeded_inventory_items_exist(self, session):
        """Verify 4 seeded inventory items exist"""
        response = session.get(f"{BASE_URL}/api/inventory/items")
        assert response.status_code == 200
        items = response.json()
        
        # Check for expected seeded items
        expected_skus = ["TRN-540-MONO", "GRW-5KW-INV", "GI-MTG-KIT", "DC-CBL-50M"]
        found_skus = [item["sku_code"] for item in items]
        
        for sku in expected_skus:
            assert sku in found_skus, f"Missing seeded item with SKU: {sku}"
        
        print(f"✓ All 4 seeded inventory items found: {expected_skus}")


class TestDashboardNavigation:
    """Test dashboard navigation items"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Authenticated session"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_dashboard_stats_endpoint(self, session):
        """GET /api/dashboard/stats works"""
        response = session.get(f"{BASE_URL}/api/dashboard/stats")
        assert response.status_code == 200
        stats = response.json()
        assert "total" in stats
        assert "submitted" in stats
        assert "approved" in stats
        print(f"✓ Dashboard stats: total={stats['total']}, submitted={stats['submitted']}, approved={stats['approved']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])