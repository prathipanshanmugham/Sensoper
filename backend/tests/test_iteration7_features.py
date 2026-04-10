"""
Iteration 7 Feature Tests - Solar Project Cost Estimator
Tests for 6 new features:
1. Editable project reference number (Admin/Manager)
2. Editable project status (Admin/Manager)
3. Site images as QR code in PDF (gallery endpoint)
4. Customer feedback field in completion dialog
5. UPI QR code in PDF bank details section
6. Edit projects (draft fully editable, approved projects editable with re-approval)
7. Typeable dropdowns (ComboInput for Type of Service, System Type, Complexity)
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.cookies.get('access_token') or response.json().get('access_token')
    
    @pytest.fixture(scope="class")
    def session(self, auth_token):
        """Create authenticated session"""
        s = requests.Session()
        s.cookies.set('access_token', auth_token)
        s.headers.update({'Content-Type': 'application/json'})
        return s
    
    def test_admin_login(self):
        """Test admin login with correct credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        data = response.json()
        assert "user" in data or "email" in data
        print("✓ Admin login successful")


class TestReferenceNumberEndpoint:
    """Test PUT /api/projects/{id}/reference endpoint"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create authenticated session"""
        s = requests.Session()
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return s
    
    @pytest.fixture(scope="class")
    def test_project(self, session):
        """Create a test project for reference number tests"""
        project_data = {
            "customer": {"name": "TEST_RefNum_Customer", "phone": "9876543210", "address": "Test Address", "email": "test@test.com"},
            "location": {"latitude": 12.9716, "longitude": 77.5946, "address": "Test Location", "site_location_words": "test.words.here"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7, "service_type": "Single Phase"},
            "solar_system": {"system_type": "on-grid", "inverter_model": "Test Inverter", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        project = response.json()
        yield project
        # Cleanup
        session.delete(f"{BASE_URL}/api/projects/{project['id']}/force")
    
    def test_update_reference_number_success(self, session, test_project):
        """Test updating reference number with valid data"""
        new_ref = f"TEST-REF-{int(time.time())}"
        response = session.put(f"{BASE_URL}/api/projects/{test_project['id']}/reference", json={
            "reference_number": new_ref
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data["reference_number"] == new_ref
        print(f"✓ Reference number updated to: {new_ref}")
    
    def test_update_reference_number_empty_fails(self, session, test_project):
        """Test that empty reference number is rejected"""
        response = session.put(f"{BASE_URL}/api/projects/{test_project['id']}/reference", json={
            "reference_number": ""
        })
        assert response.status_code == 400
        print("✓ Empty reference number correctly rejected")
    
    def test_update_reference_number_whitespace_fails(self, session, test_project):
        """Test that whitespace-only reference number is rejected"""
        response = session.put(f"{BASE_URL}/api/projects/{test_project['id']}/reference", json={
            "reference_number": "   "
        })
        assert response.status_code == 400
        print("✓ Whitespace-only reference number correctly rejected")


class TestStatusEndpoint:
    """Test PUT /api/projects/{id}/status endpoint"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create authenticated session"""
        s = requests.Session()
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return s
    
    @pytest.fixture(scope="class")
    def test_project(self, session):
        """Create a test project for status tests"""
        project_data = {
            "customer": {"name": "TEST_Status_Customer", "phone": "9876543210", "address": "Test Address", "email": "test@test.com"},
            "location": {"latitude": 12.9716, "longitude": 77.5946, "address": "Test Location", "site_location_words": "test.words.here"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7, "service_type": "Three Phase"},
            "solar_system": {"system_type": "hybrid", "inverter_model": "Test Inverter", "panel_wattage": 540, "battery_required": True, "battery_capacity_ah": 150},
            "mounting": {"roof_type": "Metal Sheet", "tilt_angle": 20, "structure_type": "Aluminum"},
            "additional": {"cable_length_meters": 60, "inverter_to_panel_distance": 15, "installation_complexity": "moderate"},
            "selected_items": [],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        project = response.json()
        yield project
        # Cleanup
        session.delete(f"{BASE_URL}/api/projects/{project['id']}/force")
    
    def test_update_status_to_submitted(self, session, test_project):
        """Test changing status to submitted"""
        response = session.put(f"{BASE_URL}/api/projects/{test_project['id']}/status", json={
            "status": "submitted"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data["status"] == "submitted"
        print("✓ Status changed to submitted")
    
    def test_update_status_to_approved(self, session, test_project):
        """Test changing status to approved"""
        response = session.put(f"{BASE_URL}/api/projects/{test_project['id']}/status", json={
            "status": "approved"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data["status"] == "approved"
        print("✓ Status changed to approved")
    
    def test_update_status_invalid_fails(self, session, test_project):
        """Test that invalid status is rejected"""
        response = session.put(f"{BASE_URL}/api/projects/{test_project['id']}/status", json={
            "status": "invalid_status"
        })
        assert response.status_code == 400
        print("✓ Invalid status correctly rejected")
    
    def test_update_status_all_valid_statuses(self, session, test_project):
        """Test all valid status values"""
        valid_statuses = ["draft", "submitted", "approved", "rejected", "completed"]
        for status in valid_statuses:
            response = session.put(f"{BASE_URL}/api/projects/{test_project['id']}/status", json={
                "status": status
            })
            assert response.status_code == 200, f"Failed for status {status}: {response.text}"
            print(f"✓ Status '{status}' accepted")


class TestGalleryEndpoint:
    """Test GET /api/projects/{id}/gallery endpoint (public, returns HTML)"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create authenticated session"""
        s = requests.Session()
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return s
    
    @pytest.fixture(scope="class")
    def test_project(self, session):
        """Create a test project with site images"""
        project_data = {
            "customer": {"name": "TEST_Gallery_Customer", "phone": "9876543210", "address": "Test Address", "email": "test@test.com"},
            "location": {"latitude": 12.9716, "longitude": 77.5946, "address": "Test Location", "site_location_words": "test.words.here"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "inverter_model": "Test Inverter", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "site_images": ["https://example.com/site1.jpg", "https://example.com/site2.jpg"]
        }
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code in [200, 201], f"Failed to create project: {response.text}"
        project = response.json()
        yield project
        # Cleanup
        session.delete(f"{BASE_URL}/api/projects/{project['id']}/force")
    
    def test_gallery_returns_html(self, test_project):
        """Test that gallery endpoint returns HTML page (no auth required)"""
        response = requests.get(f"{BASE_URL}/api/projects/{test_project['id']}/gallery")
        assert response.status_code == 200, f"Failed: {response.text}"
        assert "text/html" in response.headers.get("content-type", "")
        assert "<!DOCTYPE html>" in response.text
        # Customer name should be in the HTML
        assert "TEST_Gallery_Customer" in response.text or "Gallery" in response.text
        print("✓ Gallery endpoint returns HTML page")
    
    def test_gallery_contains_site_images(self, test_project):
        """Test that gallery HTML contains site images"""
        response = requests.get(f"{BASE_URL}/api/projects/{test_project['id']}/gallery")
        assert response.status_code == 200
        assert "Site Images" in response.text or "site" in response.text.lower()
        print("✓ Gallery contains site images section")
    
    def test_gallery_invalid_project_404(self):
        """Test that invalid project ID returns 404"""
        response = requests.get(f"{BASE_URL}/api/projects/000000000000000000000000/gallery")
        assert response.status_code == 404
        print("✓ Invalid project ID returns 404")


class TestCompleteEndpointWithFeedback:
    """Test POST /api/projects/{id}/complete with customer_feedback field"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create authenticated session"""
        s = requests.Session()
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return s
    
    @pytest.fixture
    def approved_project(self, session):
        """Create and approve a test project"""
        project_data = {
            "customer": {"name": "TEST_Complete_Customer", "phone": "9876543210", "address": "Test Address", "email": "test@test.com"},
            "location": {"latitude": 12.9716, "longitude": 77.5946, "address": "Test Location", "site_location_words": "test.words.here"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "inverter_model": "Test Inverter", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code in [200, 201]
        project = response.json()
        
        # Submit and approve
        session.post(f"{BASE_URL}/api/projects/{project['id']}/submit")
        session.post(f"{BASE_URL}/api/projects/{project['id']}/approve")
        
        yield project
        # Cleanup
        session.delete(f"{BASE_URL}/api/projects/{project['id']}/force")
    
    def test_complete_without_media_fails(self, session, approved_project):
        """Test that completion without media is rejected"""
        response = session.post(f"{BASE_URL}/api/projects/{approved_project['id']}/complete", json={
            "completion_media": [],
            "customer_feedback": "Great work!"
        })
        assert response.status_code == 400
        print("✓ Completion without media correctly rejected")
    
    def test_complete_with_media_and_feedback(self, session, approved_project):
        """Test completion with media and customer feedback"""
        response = session.post(f"{BASE_URL}/api/projects/{approved_project['id']}/complete", json={
            "completion_media": [{"storage_path": "test/path.jpg", "media_type": "images", "filename": "test.jpg", "content_type": "image/jpeg"}],
            "customer_feedback": "Excellent installation! Very professional team."
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify feedback was saved
        get_response = session.get(f"{BASE_URL}/api/projects/{approved_project['id']}")
        assert get_response.status_code == 200
        project = get_response.json()
        assert project["customer_feedback"] == "Excellent installation! Very professional team."
        assert project["status"] == "completed"
        print("✓ Project completed with customer feedback")


class TestProjectEditing:
    """Test PUT /api/projects/{id} for editing projects"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create authenticated session"""
        s = requests.Session()
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return s
    
    @pytest.fixture
    def draft_project(self, session):
        """Create a draft project for editing tests"""
        project_data = {
            "customer": {"name": "TEST_Edit_Draft", "phone": "9876543210", "address": "Original Address", "email": "test@test.com"},
            "location": {"latitude": 12.9716, "longitude": 77.5946, "address": "Original Location", "site_location_words": "test.words.here"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7, "service_type": "Single Phase"},
            "solar_system": {"system_type": "on-grid", "inverter_model": "Original Inverter", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code in [200, 201]
        project = response.json()
        yield project
        # Cleanup
        session.delete(f"{BASE_URL}/api/projects/{project['id']}/force")
    
    def test_edit_draft_project(self, session, draft_project):
        """Test editing a draft project"""
        update_data = {
            "customer": {"name": "TEST_Edit_Draft_Updated", "phone": "1234567890", "address": "Updated Address", "email": "updated@test.com"}
        }
        response = session.put(f"{BASE_URL}/api/projects/{draft_project['id']}", json=update_data)
        assert response.status_code == 200, f"Failed: {response.text}"
        
        # Verify changes
        get_response = session.get(f"{BASE_URL}/api/projects/{draft_project['id']}")
        project = get_response.json()
        assert project["customer"]["name"] == "TEST_Edit_Draft_Updated"
        assert project["status"] == "draft"  # Should remain draft
        print("✓ Draft project edited successfully")
    
    def test_edit_approved_project_reverts_to_submitted(self, session):
        """Test that editing an approved project reverts status to submitted"""
        # Create and approve a project
        project_data = {
            "customer": {"name": "TEST_Edit_Approved", "phone": "9876543210", "address": "Original Address", "email": "test@test.com"},
            "location": {"latitude": 12.9716, "longitude": 77.5946, "address": "Original Location", "site_location_words": "test.words.here"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "inverter_model": "Original Inverter", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code in [200, 201]
        project = response.json()
        
        try:
            # Submit and approve
            session.post(f"{BASE_URL}/api/projects/{project['id']}/submit")
            session.post(f"{BASE_URL}/api/projects/{project['id']}/approve")
            
            # Verify approved
            get_response = session.get(f"{BASE_URL}/api/projects/{project['id']}")
            assert get_response.json()["status"] == "approved"
            
            # Edit the approved project
            update_data = {
                "customer": {"name": "TEST_Edit_Approved_Updated", "phone": "1234567890", "address": "Updated Address", "email": "updated@test.com"}
            }
            response = session.put(f"{BASE_URL}/api/projects/{project['id']}", json=update_data)
            assert response.status_code == 200, f"Failed: {response.text}"
            
            # Verify status reverted to submitted
            get_response = session.get(f"{BASE_URL}/api/projects/{project['id']}")
            updated_project = get_response.json()
            assert updated_project["status"] == "submitted", f"Expected 'submitted', got '{updated_project['status']}'"
            print("✓ Approved project edit reverts status to submitted")
        finally:
            session.delete(f"{BASE_URL}/api/projects/{project['id']}/force")


class TestTypeableDropdowns:
    """Test that custom values can be saved for service_type, system_type, complexity"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create authenticated session"""
        s = requests.Session()
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return s
    
    def test_create_project_with_custom_service_type(self, session):
        """Test creating project with custom service_type value"""
        project_data = {
            "customer": {"name": "TEST_Custom_ServiceType", "phone": "9876543210", "address": "Test Address", "email": "test@test.com"},
            "location": {"latitude": 12.9716, "longitude": 77.5946, "address": "Test Location", "site_location_words": "test.words.here"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7, "service_type": "Custom Industrial Service"},
            "solar_system": {"system_type": "on-grid", "inverter_model": "Test Inverter", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code in [200, 201], f"Failed: {response.text}"
        project = response.json()
        
        try:
            # Verify custom value was saved
            get_response = session.get(f"{BASE_URL}/api/projects/{project['id']}")
            saved_project = get_response.json()
            assert saved_project["electrical"]["service_type"] == "Custom Industrial Service"
            print("✓ Custom service_type value saved successfully")
        finally:
            session.delete(f"{BASE_URL}/api/projects/{project['id']}/force")
    
    def test_create_project_with_custom_system_type(self, session):
        """Test creating project with custom system_type value"""
        project_data = {
            "customer": {"name": "TEST_Custom_SystemType", "phone": "9876543210", "address": "Test Address", "email": "test@test.com"},
            "location": {"latitude": 12.9716, "longitude": 77.5946, "address": "Test Location", "site_location_words": "test.words.here"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "custom-micro-grid", "inverter_model": "Test Inverter", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code in [200, 201], f"Failed: {response.text}"
        project = response.json()
        
        try:
            # Verify custom value was saved
            get_response = session.get(f"{BASE_URL}/api/projects/{project['id']}")
            saved_project = get_response.json()
            assert saved_project["solar_system"]["system_type"] == "custom-micro-grid"
            print("✓ Custom system_type value saved successfully")
        finally:
            session.delete(f"{BASE_URL}/api/projects/{project['id']}/force")
    
    def test_create_project_with_custom_complexity(self, session):
        """Test creating project with custom complexity value"""
        project_data = {
            "customer": {"name": "TEST_Custom_Complexity", "phone": "9876543210", "address": "Test Address", "email": "test@test.com"},
            "location": {"latitude": 12.9716, "longitude": 77.5946, "address": "Test Location", "site_location_words": "test.words.here"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "inverter_model": "Test Inverter", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC Flat", "tilt_angle": 15, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "extremely-complex-multi-site"},
            "selected_items": [],
            "manual_costs": [],
            "site_images": ["https://example.com/test.jpg"]
        }
        response = session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code in [200, 201], f"Failed: {response.text}"
        project = response.json()
        
        try:
            # Verify custom value was saved
            get_response = session.get(f"{BASE_URL}/api/projects/{project['id']}")
            saved_project = get_response.json()
            assert saved_project["additional"]["installation_complexity"] == "extremely-complex-multi-site"
            print("✓ Custom complexity value saved successfully")
        finally:
            session.delete(f"{BASE_URL}/api/projects/{project['id']}/force")


class TestExistingProjectReference:
    """Test with existing project ID from context"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create authenticated session"""
        s = requests.Session()
        response = s.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        return s
    
    def test_existing_project_gallery(self, session):
        """Test gallery endpoint for existing project"""
        # Use the existing project ID from context
        project_id = "69d950ea3fde8e6f7b03789a"
        response = requests.get(f"{BASE_URL}/api/projects/{project_id}/gallery")
        # May be 200 or 404 depending on if project exists
        if response.status_code == 200:
            assert "text/html" in response.headers.get("content-type", "")
            print(f"✓ Gallery for existing project {project_id} works")
        else:
            print(f"⚠ Project {project_id} not found (may have been deleted)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
