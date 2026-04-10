"""
Test Suite for Iteration 6 Features:
1. Per-product margin (each item has its own margin %, visible only to Admin/Manager)
2. Mandatory completion photos/videos when marking project as 'Completed'
3. PDF should include the uploaded Sensoper logo
4. 'Type of Service' field added to Electrical step (Single Phase, Three Phase, HT Service)
5. Add Category button in Materials step to create new inventory categories on-the-fly
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
        """Get authenticated admin session"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        return session
    
    def test_admin_login(self, admin_session):
        """Test admin login with correct credentials"""
        response = admin_session.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "admin@sensoper.com"
        assert data["role"] == "admin"
        print(f"✓ Admin login successful: {data['name']}")


class TestServiceType:
    """Test Type of Service field in Electrical details"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_create_project_with_service_type_single_phase(self, admin_session):
        """Test creating project with Single Phase service type"""
        payload = {
            "customer": {"name": "TEST_ServiceType_Single", "phone": "9876543210", "address": "Test Address"},
            "location": {"site_location_words": "test.single.phase"},
            "electrical": {
                "sanction_load_kw": 5.0,
                "connected_load_kw": 4.0,
                "monthly_consumption_units": 500,
                "eb_tariff": 7.0,
                "service_type": "single_phase"
            },
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat Roof", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [{"name": "Test Panel", "category": "solar_panels", "unit_price": 25000, "gst_percentage": 18, "quantity": 4, "margin_percentage": 0}],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = admin_session.post(f"{BASE_URL}/api/projects", json=payload)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        data = response.json()
        project_id = data.get("id")
        assert project_id, "No project ID returned"
        
        # Fetch the project to verify service_type
        get_response = admin_session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200
        project = get_response.json()
        assert project["electrical"]["service_type"] == "single_phase"
        print(f"✓ Project created with Single Phase service type, ID: {project_id}")
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{project_id}/force")
    
    def test_create_project_with_service_type_three_phase(self, admin_session):
        """Test creating project with Three Phase service type"""
        payload = {
            "customer": {"name": "TEST_ServiceType_Three", "phone": "9876543211", "address": "Test Address"},
            "location": {"site_location_words": "test.three.phase"},
            "electrical": {
                "sanction_load_kw": 10.0,
                "connected_load_kw": 8.0,
                "monthly_consumption_units": 1000,
                "eb_tariff": 7.0,
                "service_type": "three_phase"
            },
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "Metal Sheet", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "moderate"},
            "selected_items": [{"name": "Test Panel", "category": "solar_panels", "unit_price": 25000, "gst_percentage": 18, "quantity": 8, "margin_percentage": 0}],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = admin_session.post(f"{BASE_URL}/api/projects", json=payload)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        data = response.json()
        project_id = data.get("id")
        
        # Fetch the project to verify service_type
        get_response = admin_session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200
        project = get_response.json()
        assert project["electrical"]["service_type"] == "three_phase"
        print(f"✓ Project created with Three Phase service type, ID: {project_id}")
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{project_id}/force")
    
    def test_create_project_with_service_type_ht(self, admin_session):
        """Test creating project with HT Service type"""
        payload = {
            "customer": {"name": "TEST_ServiceType_HT", "phone": "9876543212", "address": "Test Address"},
            "location": {"site_location_words": "test.ht.service"},
            "electrical": {
                "sanction_load_kw": 100.0,
                "connected_load_kw": 80.0,
                "monthly_consumption_units": 10000,
                "eb_tariff": 6.0,
                "service_type": "ht_service"
            },
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "Ground Mount", "tilt_angle": 20, "structure_type": "GI"},
            "additional": {"cable_length_meters": 100, "inverter_to_panel_distance": 20, "installation_complexity": "complex"},
            "selected_items": [{"name": "Test Panel", "category": "solar_panels", "unit_price": 25000, "gst_percentage": 18, "quantity": 100, "margin_percentage": 0}],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = admin_session.post(f"{BASE_URL}/api/projects", json=payload)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        data = response.json()
        project_id = data.get("id")
        
        # Fetch the project to verify service_type
        get_response = admin_session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200
        project = get_response.json()
        assert project["electrical"]["service_type"] == "ht_service"
        print(f"✓ Project created with HT Service type, ID: {project_id}")
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{project_id}/force")


class TestPerItemMargin:
    """Test per-item margin functionality"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    @pytest.fixture(scope="class")
    def test_project(self, admin_session):
        """Create a test project for margin testing"""
        payload = {
            "customer": {"name": "TEST_Margin_Project", "phone": "9876543213", "address": "Test Address"},
            "location": {"site_location_words": "test.margin.project"},
            "electrical": {
                "sanction_load_kw": 5.0,
                "connected_load_kw": 4.0,
                "monthly_consumption_units": 500,
                "eb_tariff": 7.0,
                "service_type": "single_phase"
            },
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat Roof", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [
                {"name": "Solar Panel 540W", "category": "solar_panels", "unit_price": 25000, "gst_percentage": 18, "quantity": 4, "margin_percentage": 0},
                {"name": "Inverter 5kW", "category": "inverters", "unit_price": 50000, "gst_percentage": 18, "quantity": 1, "margin_percentage": 0}
            ],
            "manual_costs": [{"description": "Labor", "amount": 10000}],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = admin_session.post(f"{BASE_URL}/api/projects", json=payload)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        data = response.json()
        project_id = data.get("id")
        
        # Fetch full project data
        get_response = admin_session.get(f"{BASE_URL}/api/projects/{project_id}")
        project = get_response.json()
        
        yield project
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{project_id}/force")
    
    def test_create_project_with_per_item_margin(self, admin_session, test_project):
        """Test that project is created with per-item margin fields"""
        # Check selected_items have margin_percentage field
        assert "selected_items" in test_project
        assert len(test_project["selected_items"]) == 2
        for item in test_project["selected_items"]:
            assert "margin_percentage" in item
        print(f"✓ Project has per-item margin fields")
    
    def test_update_per_item_margins(self, admin_session, test_project):
        """Test updating per-item margins via PUT /api/projects/{id}/margin"""
        # Update margins: 15% for first item, 10% for second item
        margin_updates = [
            {"index": 0, "margin_percentage": 15},
            {"index": 1, "margin_percentage": 10}
        ]
        response = admin_session.put(
            f"{BASE_URL}/api/projects/{test_project['id']}/margin",
            json={"item_margins": margin_updates}
        )
        assert response.status_code == 200, f"Failed to update margins: {response.text}"
        data = response.json()
        
        # Verify margins were updated
        assert "selected_items" in data
        assert data["selected_items"][0]["margin_percentage"] == 15
        assert data["selected_items"][1]["margin_percentage"] == 10
        print(f"✓ Per-item margins updated successfully")
        
        # Verify cost recalculation
        assert "cost_estimation" in data
        assert data["cost_estimation"]["total_margin"] > 0
        print(f"✓ Cost estimation recalculated with margins: total_margin = {data['cost_estimation']['total_margin']}")
    
    def test_margin_calculation_accuracy(self, admin_session, test_project):
        """Test that margin calculation is accurate"""
        response = admin_session.get(f"{BASE_URL}/api/projects/{test_project['id']}")
        assert response.status_code == 200
        data = response.json()
        
        # Calculate expected margin based on updated values (15% and 10%)
        # Item 1: 25000 * 4 * 0.15 = 15000
        # Item 2: 50000 * 1 * 0.10 = 5000
        # Total margin = 20000
        expected_margin = (25000 * 4 * 0.15) + (50000 * 1 * 0.10)
        actual_margin = data["cost_estimation"]["total_margin"]
        
        assert abs(actual_margin - expected_margin) < 1, f"Margin mismatch: expected {expected_margin}, got {actual_margin}"
        print(f"✓ Margin calculation accurate: {actual_margin}")


class TestCompletionMedia:
    """Test mandatory completion photos/videos"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    @pytest.fixture(scope="class")
    def approved_project(self, admin_session):
        """Create and approve a test project"""
        payload = {
            "customer": {"name": "TEST_Completion_Project", "phone": "9876543214", "address": "Test Address"},
            "location": {"site_location_words": "test.completion.project"},
            "electrical": {
                "sanction_load_kw": 5.0,
                "connected_load_kw": 4.0,
                "monthly_consumption_units": 500,
                "eb_tariff": 7.0,
                "service_type": "single_phase"
            },
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat Roof", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [{"name": "Test Panel", "category": "solar_panels", "unit_price": 25000, "gst_percentage": 18, "quantity": 4, "margin_percentage": 0}],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = admin_session.post(f"{BASE_URL}/api/projects", json=payload)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        data = response.json()
        project_id = data.get("id")
        
        # Submit the project
        admin_session.post(f"{BASE_URL}/api/projects/{project_id}/submit")
        
        # Approve the project
        admin_session.post(f"{BASE_URL}/api/projects/{project_id}/approve")
        
        # Fetch full project
        get_response = admin_session.get(f"{BASE_URL}/api/projects/{project_id}")
        project = get_response.json()
        
        yield project
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{project_id}/force")
    
    def test_complete_without_media_fails(self, admin_session, approved_project):
        """Test that completing project without media fails"""
        response = admin_session.post(
            f"{BASE_URL}/api/projects/{approved_project['id']}/complete",
            json={"completion_media": []}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        assert "photo or video is required" in response.json()["detail"].lower()
        print(f"✓ Complete without media correctly rejected")
    
    def test_complete_with_empty_body_fails(self, admin_session, approved_project):
        """Test that completing project with empty body fails"""
        response = admin_session.post(
            f"{BASE_URL}/api/projects/{approved_project['id']}/complete",
            json={}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print(f"✓ Complete with empty body correctly rejected")
    
    def test_complete_with_media_succeeds(self, admin_session, approved_project):
        """Test that completing project with media succeeds"""
        completion_media = [
            {
                "storage_path": "test/completion/images/test.jpg",
                "media_type": "images",
                "filename": "completion_photo.jpg",
                "content_type": "image/jpeg"
            }
        ]
        response = admin_session.post(
            f"{BASE_URL}/api/projects/{approved_project['id']}/complete",
            json={"completion_media": completion_media}
        )
        assert response.status_code == 200, f"Failed to complete project: {response.text}"
        
        # Verify project status changed to completed
        get_response = admin_session.get(f"{BASE_URL}/api/projects/{approved_project['id']}")
        assert get_response.status_code == 200
        data = get_response.json()
        assert data["status"] == "completed"
        assert "completion_media" in data
        assert len(data["completion_media"]) == 1
        print(f"✓ Project completed with media successfully")


class TestAddCategory:
    """Test Add Category functionality"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_get_existing_categories(self, admin_session):
        """Test getting existing inventory categories"""
        response = admin_session.get(f"{BASE_URL}/api/inventory/categories")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Found {len(data)} existing categories")
    
    def test_create_new_category(self, admin_session):
        """Test creating a new inventory category"""
        unique_name = f"TEST_Category_{int(time.time())}"
        unique_slug = unique_name.lower().replace(" ", "_")
        
        payload = {
            "name": unique_name,
            "slug": unique_slug,
            "description": "Test category created by automated tests"
        }
        response = admin_session.post(f"{BASE_URL}/api/inventory/categories", json=payload)
        assert response.status_code in [200, 201], f"Failed to create category: {response.text}"
        data = response.json()
        category_id = data.get("id")
        assert category_id, "No category ID returned"
        print(f"✓ Category created: {unique_name}")
        
        # Verify category appears in list
        list_response = admin_session.get(f"{BASE_URL}/api/inventory/categories")
        categories = list_response.json()
        category_names = [c["name"] for c in categories]
        assert unique_name in category_names
        print(f"✓ Category appears in list")
        
        # Cleanup - delete the test category
        admin_session.delete(f"{BASE_URL}/api/inventory/categories/{category_id}")
    
    def test_create_duplicate_category_fails(self, admin_session):
        """Test that creating duplicate category fails"""
        # First, get existing categories
        response = admin_session.get(f"{BASE_URL}/api/inventory/categories")
        categories = response.json()
        if len(categories) > 0:
            existing_slug = categories[0]["slug"]
            payload = {
                "name": "Duplicate Test",
                "slug": existing_slug,
                "description": "Should fail"
            }
            response = admin_session.post(f"{BASE_URL}/api/inventory/categories", json=payload)
            assert response.status_code in [400, 409], f"Expected 400/409, got {response.status_code}"
            print(f"✓ Duplicate category correctly rejected")


class TestCompanyLogo:
    """Test company logo for PDF"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_get_active_company_profile(self, admin_session):
        """Test getting active company profile with logo"""
        response = admin_session.get(f"{BASE_URL}/api/company/active")
        assert response.status_code == 200, f"Failed to get company profile: {response.text}"
        data = response.json()
        
        # Check if logo_url exists
        if "logo_url" in data and data["logo_url"]:
            print(f"✓ Company profile has logo_url: {data['logo_url']}")
            # Check if logo URL contains expected pattern
            if "job_8c20414a" in data["logo_url"]:
                print(f"✓ Logo URL contains expected job ID pattern")
            else:
                print(f"⚠ Logo URL does not contain 'job_8c20414a': {data['logo_url']}")
        else:
            print(f"⚠ Company profile does not have logo_url set")
        
        # Verify other company profile fields
        assert "company_name" in data
        print(f"✓ Company name: {data.get('company_name', 'N/A')}")


class TestUploadMedia:
    """Test media upload endpoint"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_upload_media_rejects_invalid_type(self, admin_session):
        """Test that upload/media rejects non-image/video files"""
        # Create a fake text file
        files = {'file': ('test.txt', b'This is a test file', 'text/plain')}
        response = admin_session.post(f"{BASE_URL}/api/upload/media", files=files)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        assert "image and video" in response.json()["detail"].lower()
        print(f"✓ Invalid file type correctly rejected")


class TestFullProjectWorkflow:
    """Test complete project workflow with all new features"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_full_workflow(self, admin_session):
        """Test complete workflow: create -> set margins -> submit -> approve -> complete"""
        # 1. Create project with service_type and per-item margins
        payload = {
            "customer": {"name": "TEST_Full_Workflow", "phone": "9876543215", "address": "123 Test Street"},
            "location": {"site_location_words": "test.full.workflow", "address": "Test Location"},
            "electrical": {
                "sanction_load_kw": 10.0,
                "connected_load_kw": 8.0,
                "monthly_consumption_units": 800,
                "eb_tariff": 7.5,
                "service_type": "three_phase"
            },
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat Roof with Parapet", "tilt_angle": 15, "structure_type": "Galvanized Iron"},
            "additional": {"cable_length_meters": 60, "inverter_to_panel_distance": 15, "installation_complexity": "moderate"},
            "selected_items": [
                {"name": "Trina 540W Panel", "category": "solar_panels", "unit_price": 28000, "gst_percentage": 18, "quantity": 8, "margin_percentage": 12},
                {"name": "Growatt 10kW Inverter", "category": "inverters", "unit_price": 85000, "gst_percentage": 18, "quantity": 1, "margin_percentage": 10},
                {"name": "GI Mounting Kit", "category": "mounting_structures", "unit_price": 15000, "gst_percentage": 18, "quantity": 1, "margin_percentage": 15}
            ],
            "manual_costs": [
                {"description": "Installation Labor", "amount": 25000},
                {"description": "Transportation", "amount": 5000}
            ],
            "site_images": ["https://example.com/site1.jpg", "https://example.com/site2.jpg"]
        }
        
        response = admin_session.post(f"{BASE_URL}/api/projects", json=payload)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        data = response.json()
        project_id = data.get("id")
        assert project_id, "No project ID returned"
        print(f"✓ Step 1: Project created with ID: {project_id}")
        
        # Fetch full project to verify
        get_response = admin_session.get(f"{BASE_URL}/api/projects/{project_id}")
        project = get_response.json()
        
        # Verify service_type
        assert project["electrical"]["service_type"] == "three_phase"
        print(f"✓ Service type verified: three_phase")
        
        # Verify per-item margins
        assert len(project["selected_items"]) == 3
        assert project["selected_items"][0]["margin_percentage"] == 12
        assert project["selected_items"][1]["margin_percentage"] == 10
        assert project["selected_items"][2]["margin_percentage"] == 15
        print(f"✓ Per-item margins verified")
        
        # 2. Update margins
        margin_updates = [
            {"index": 0, "margin_percentage": 15},
            {"index": 1, "margin_percentage": 12},
            {"index": 2, "margin_percentage": 18}
        ]
        margin_response = admin_session.put(
            f"{BASE_URL}/api/projects/{project_id}/margin",
            json={"item_margins": margin_updates}
        )
        assert margin_response.status_code == 200
        print(f"✓ Step 2: Margins updated")
        
        # 3. Submit project
        submit_response = admin_session.post(f"{BASE_URL}/api/projects/{project_id}/submit")
        assert submit_response.status_code == 200
        print(f"✓ Step 3: Project submitted")
        
        # 4. Approve project
        approve_response = admin_session.post(f"{BASE_URL}/api/projects/{project_id}/approve")
        assert approve_response.status_code == 200
        print(f"✓ Step 4: Project approved")
        
        # 5. Complete project with media
        completion_media = [
            {
                "storage_path": "test/completion/images/final1.jpg",
                "media_type": "images",
                "filename": "installation_complete.jpg",
                "content_type": "image/jpeg"
            },
            {
                "storage_path": "test/completion/videos/walkthrough.mp4",
                "media_type": "videos",
                "filename": "site_walkthrough.mp4",
                "content_type": "video/mp4"
            }
        ]
        complete_response = admin_session.post(
            f"{BASE_URL}/api/projects/{project_id}/complete",
            json={"completion_media": completion_media}
        )
        assert complete_response.status_code == 200
        print(f"✓ Step 5: Project completed with media")
        
        # 6. Verify final state
        final_response = admin_session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert final_response.status_code == 200
        final_project = final_response.json()
        
        assert final_project["status"] == "completed"
        assert len(final_project["completion_media"]) == 2
        assert final_project["cost_estimation"]["total_margin"] > 0
        print(f"✓ Step 6: Final state verified - Status: completed, Media count: 2")
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{project_id}/force")
        print(f"✓ Cleanup: Test project deleted")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
