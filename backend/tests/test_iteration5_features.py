"""
Test Suite for Iteration 5 Features:
- Inventory categories CRUD
- Image upload to object storage
- Margin update endpoint (admin/manager only)
- Verify no pricing config endpoint
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        """Login as admin and return session with cookies"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert data["role"] == "admin"
        return session
    
    def test_admin_login(self, admin_session):
        """Test admin login works"""
        response = admin_session.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "admin@sensoper.com"
        assert data["role"] == "admin"
        print("✓ Admin login successful")


class TestInventoryCategories:
    """Test inventory categories CRUD"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_get_categories_returns_seeded(self, admin_session):
        """GET /api/inventory/categories should return seeded categories"""
        response = admin_session.get(f"{BASE_URL}/api/inventory/categories")
        assert response.status_code == 200
        categories = response.json()
        assert isinstance(categories, list)
        # Should have at least 5 seeded categories
        assert len(categories) >= 5, f"Expected at least 5 categories, got {len(categories)}"
        
        # Check expected category slugs
        slugs = [c["slug"] for c in categories]
        expected_slugs = ["solar_panels", "inverters", "mounting_structures", "cables_accessories"]
        for slug in expected_slugs:
            assert slug in slugs, f"Missing expected category: {slug}"
        
        print(f"✓ GET /api/inventory/categories returns {len(categories)} categories")
    
    def test_create_custom_category(self, admin_session):
        """POST /api/inventory/categories creates custom category"""
        unique_slug = f"test_cat_{int(time.time())}"
        response = admin_session.post(f"{BASE_URL}/api/inventory/categories", json={
            "name": "Test Category",
            "slug": unique_slug,
            "description": "Test description"
        })
        assert response.status_code == 200, f"Create category failed: {response.text}"
        data = response.json()
        assert "id" in data
        
        # Verify it exists
        get_response = admin_session.get(f"{BASE_URL}/api/inventory/categories")
        categories = get_response.json()
        slugs = [c["slug"] for c in categories]
        assert unique_slug in slugs
        
        # Cleanup - delete the test category
        cat_id = data["id"]
        del_response = admin_session.delete(f"{BASE_URL}/api/inventory/categories/{cat_id}")
        assert del_response.status_code == 200
        
        print("✓ POST /api/inventory/categories creates and deletes custom category")


class TestInventoryItems:
    """Test inventory items with image_url field"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_create_item_with_image_url(self, admin_session):
        """POST /api/inventory/items accepts image_url field"""
        unique_sku = f"TEST-IMG-{int(time.time())}"
        response = admin_session.post(f"{BASE_URL}/api/inventory/items", json={
            "name": "Test Item with Image",
            "sku_code": unique_sku,
            "category": "solar_panels",
            "quantity": 10,
            "unit_price": 15000,
            "gst_percentage": 18,
            "reorder_level": 5,
            "image_url": "https://example.com/test-image.jpg"
        })
        assert response.status_code == 200, f"Create item failed: {response.text}"
        data = response.json()
        item_id = data["id"]
        
        # Verify item has image_url
        get_response = admin_session.get(f"{BASE_URL}/api/inventory/items/{item_id}")
        assert get_response.status_code == 200
        item = get_response.json()
        assert item["image_url"] == "https://example.com/test-image.jpg"
        
        # Cleanup
        del_response = admin_session.delete(f"{BASE_URL}/api/inventory/items/{item_id}")
        assert del_response.status_code == 200
        
        print("✓ POST /api/inventory/items accepts image_url field")


class TestImageUpload:
    """Test image upload to object storage"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_upload_image_endpoint_exists(self, admin_session):
        """POST /api/upload/image endpoint exists and validates file type"""
        # Test with invalid file type (text)
        files = {'file': ('test.txt', b'test content', 'text/plain')}
        response = admin_session.post(f"{BASE_URL}/api/upload/image", files=files)
        # Should reject non-image files
        assert response.status_code == 400
        assert "image" in response.json().get("detail", "").lower()
        print("✓ POST /api/upload/image validates file type")
    
    def test_upload_image_with_valid_image(self, admin_session):
        """POST /api/upload/image uploads valid image"""
        # Create a minimal valid PNG (1x1 pixel)
        png_data = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1 dimensions
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,  # IDAT chunk
            0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
            0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
            0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,  # IEND chunk
            0x44, 0xAE, 0x42, 0x60, 0x82
        ])
        
        files = {'file': ('test.png', png_data, 'image/png')}
        response = admin_session.post(f"{BASE_URL}/api/upload/image", files=files)
        assert response.status_code == 200, f"Upload failed: {response.text}"
        data = response.json()
        assert "storage_path" in data
        assert "size" in data
        print(f"✓ POST /api/upload/image uploads image, path: {data['storage_path']}")


class TestMarginEndpoint:
    """Test margin update endpoint (admin/manager only)"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    @pytest.fixture(scope="class")
    def test_project_id(self, admin_session):
        """Create a test project and return its ID"""
        response = admin_session.post(f"{BASE_URL}/api/projects", json={
            "customer": {"name": "TEST Margin Customer", "phone": "9876543210", "address": "Test Address"},
            "location": {"site_location_words": "test.margin.words", "address": "Test Location"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid"},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [
                {"name": "Test Panel", "category": "solar_panels", "unit_price": 20000, "gst_percentage": 18, "quantity": 10}
            ],
            "manual_costs": []
        })
        assert response.status_code == 200, f"Create project failed: {response.text}"
        project_id = response.json()["id"]
        yield project_id
        
        # Cleanup - force delete
        admin_session.delete(f"{BASE_URL}/api/projects/{project_id}/force")
    
    def test_margin_update_as_admin(self, admin_session, test_project_id):
        """PUT /api/projects/{id}/margin updates margin (admin)"""
        response = admin_session.put(
            f"{BASE_URL}/api/projects/{test_project_id}/margin",
            json={"margin_percentage": 20}
        )
        assert response.status_code == 200, f"Margin update failed: {response.text}"
        data = response.json()
        assert "cost_estimation" in data
        assert data["cost_estimation"]["margin_percentage"] == 20
        print(f"✓ PUT /api/projects/{test_project_id}/margin updates margin to 20%")
    
    def test_margin_update_recalculates_total(self, admin_session, test_project_id):
        """Margin update recalculates total cost"""
        # Set margin to 25%
        response = admin_session.put(
            f"{BASE_URL}/api/projects/{test_project_id}/margin",
            json={"margin_percentage": 25}
        )
        assert response.status_code == 200
        data = response.json()
        ce = data["cost_estimation"]
        
        # Verify calculation: subtotal * 0.25 = margin
        expected_margin = ce["subtotal"] * 0.25
        assert abs(ce["margin"] - expected_margin) < 1, f"Margin calculation incorrect"
        print("✓ Margin update recalculates total correctly")


class TestStaffCannotUpdateMargin:
    """Test that staff cannot update margin"""
    
    def test_staff_cannot_update_margin(self):
        """Staff role should get 403 when updating margin"""
        # First create a staff user
        admin_session = requests.Session()
        admin_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        
        # Create a test project
        proj_response = admin_session.post(f"{BASE_URL}/api/projects", json={
            "customer": {"name": "TEST Staff Margin", "phone": "9876543210", "address": "Test"},
            "location": {"site_location_words": "staff.test.words"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid"},
            "mounting": {"roof_type": "RCC", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [{"name": "Panel", "category": "solar_panels", "unit_price": 10000, "gst_percentage": 18, "quantity": 1}],
            "manual_costs": []
        })
        project_id = proj_response.json()["id"]
        
        # Register a staff user
        staff_email = f"teststaff_{int(time.time())}@test.com"
        staff_session = requests.Session()
        reg_response = staff_session.post(f"{BASE_URL}/api/auth/register", json={
            "email": staff_email,
            "password": "TestPass123",
            "name": "Test Staff",
            "role": "staff"
        })
        
        if reg_response.status_code == 200:
            # Try to update margin as staff
            margin_response = staff_session.put(
                f"{BASE_URL}/api/projects/{project_id}/margin",
                json={"margin_percentage": 30}
            )
            assert margin_response.status_code == 403, f"Staff should not be able to update margin, got {margin_response.status_code}"
            print("✓ Staff cannot update margin (403 Forbidden)")
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{project_id}/force")


class TestPricingConfigRemoved:
    """Verify pricing config endpoint is removed"""
    
    def test_pricing_endpoint_not_found(self):
        """GET /api/pricing should return 404"""
        session = requests.Session()
        session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        
        response = session.get(f"{BASE_URL}/api/pricing")
        assert response.status_code == 404, f"Pricing endpoint should be removed, got {response.status_code}"
        print("✓ GET /api/pricing returns 404 (removed)")


class TestRoofTypeTextField:
    """Test that roof type is stored as free text"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_roof_type_accepts_free_text(self, admin_session):
        """Project creation accepts free text roof type"""
        custom_roof = "Custom Metal Sheet with Slope 15 degrees"
        response = admin_session.post(f"{BASE_URL}/api/projects", json={
            "customer": {"name": "TEST Roof Type", "phone": "9876543210", "address": "Test"},
            "location": {"site_location_words": "roof.type.test"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid"},
            "mounting": {"roof_type": custom_roof, "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [{"name": "Panel", "category": "solar_panels", "unit_price": 10000, "gst_percentage": 18, "quantity": 1}],
            "manual_costs": []
        })
        assert response.status_code == 200, f"Create project failed: {response.text}"
        project_id = response.json()["id"]
        
        # Verify roof type is stored
        get_response = admin_session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200
        project = get_response.json()
        assert project["mounting"]["roof_type"] == custom_roof
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{project_id}/force")
        print(f"✓ Roof type accepts free text: '{custom_roof}'")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
