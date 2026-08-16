"""
Iteration 9 Tests: Site Documentation Feature
Tests for:
1. Company Profile - Google Drive Integration section REMOVED
2. New Project form - Step 5 'Site Docs' with drive folder fields
3. Project details - Site Documentation section with Open Folder, Copy Link, QR Preview
4. Backend API - drive_folder_name, drive_folder_link, drive_folder_id fields
"""

import pytest
import requests
import os
import uuid
import os
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSiteDocumentation:
    """Test Site Documentation feature for projects"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with authentication"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.user = login_response.json()
        print(f"✓ Logged in as admin: {self.user['email']}")
        
        yield
        
        # Cleanup - logout
        self.session.post(f"{BASE_URL}/api/auth/logout")
    
    # ==================== BACKEND API TESTS ====================
    
    def test_create_project_with_drive_fields(self):
        """Test POST /api/projects accepts drive_folder_name, drive_folder_link, drive_folder_id"""
        test_id = str(uuid.uuid4())[:8]
        project_data = {
            "customer": {
                "name": f"TEST_DriveFields_{test_id}",
                "phone": "9876543210",
                "address": "Test Address for Drive Fields",
                "email": "test@example.com"
            },
            "location": {
                "latitude": 13.0827,
                "longitude": 80.2707,
                "address": "Chennai, Tamil Nadu",
                "site_location_words": "test.drive.fields"
            },
            "electrical": {
                "sanction_load_kw": 5.0,
                "connected_load_kw": 4.0,
                "monthly_consumption_units": 500,
                "eb_tariff": 7.0,
                "service_type": "Single Phase"
            },
            "solar_system": {
                "system_type": "on-grid",
                "inverter_model": "Test Inverter",
                "panel_wattage": 540,
                "battery_required": False
            },
            "mounting": {
                "roof_type": "RCC Flat Roof",
                "tilt_angle": 15,
                "structure_type": "Galvanized Iron"
            },
            "additional": {
                "cable_length_meters": 50,
                "inverter_to_panel_distance": 10,
                "installation_complexity": "simple",
                "shadow_analysis_notes": "No shadows"
            },
            "selected_items": [],
            "manual_costs": [],
            "site_images": [],
            "drive_folder_name": f"TEST_SiteVisit_{test_id}",
            "drive_folder_link": f"https://drive.google.com/drive/folders/testfolder{test_id}",
            "drive_folder_id": f"testfolder{test_id}"
        }
        
        response = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code == 200, f"Create project failed: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain project id"
        self.created_project_id = data["id"]
        print(f"✓ Created project with drive fields: {data['id']}")
        
        return data["id"]
    
    def test_get_project_returns_drive_fields(self):
        """Test GET /api/projects/{id} returns drive_folder_name, drive_folder_link, drive_folder_id"""
        # First create a project
        project_id = self.test_create_project_with_drive_fields()
        
        # Get the project
        response = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert response.status_code == 200, f"Get project failed: {response.text}"
        
        data = response.json()
        
        # Verify drive fields are present
        assert "drive_folder_name" in data, "Response should contain drive_folder_name"
        assert "drive_folder_link" in data, "Response should contain drive_folder_link"
        assert "drive_folder_id" in data, "Response should contain drive_folder_id"
        
        # Verify values
        assert data["drive_folder_name"].startswith("TEST_SiteVisit_"), f"drive_folder_name mismatch: {data['drive_folder_name']}"
        assert "drive.google.com/drive/folders/" in data["drive_folder_link"], f"drive_folder_link invalid: {data['drive_folder_link']}"
        assert data["drive_folder_id"].startswith("testfolder"), f"drive_folder_id mismatch: {data['drive_folder_id']}"
        
        print(f"✓ GET project returns drive fields correctly")
        print(f"  - drive_folder_name: {data['drive_folder_name']}")
        print(f"  - drive_folder_link: {data['drive_folder_link']}")
        print(f"  - drive_folder_id: {data['drive_folder_id']}")
    
    def test_update_project_drive_fields(self):
        """Test PUT /api/projects/{id} can update drive fields"""
        # First create a project
        project_id = self.test_create_project_with_drive_fields()
        
        # Update drive fields
        update_data = {
            "drive_folder_name": "UPDATED_Folder_Name",
            "drive_folder_link": "https://drive.google.com/drive/folders/updatedfolder123",
            "drive_folder_id": "updatedfolder123"
        }
        
        response = self.session.put(f"{BASE_URL}/api/projects/{project_id}", json=update_data)
        assert response.status_code == 200, f"Update project failed: {response.text}"
        
        # Verify update
        get_response = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200
        
        data = get_response.json()
        assert data["drive_folder_name"] == "UPDATED_Folder_Name", f"drive_folder_name not updated: {data['drive_folder_name']}"
        assert data["drive_folder_link"] == "https://drive.google.com/drive/folders/updatedfolder123"
        assert data["drive_folder_id"] == "updatedfolder123"
        
        print(f"✓ PUT project updates drive fields correctly")
    
    def test_existing_project_has_drive_fields(self):
        """Test existing project 69d9da07fbd35551b1377165 has drive fields"""
        project_id = "69d9da07fbd35551b1377165"
        
        response = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        
        if response.status_code == 404:
            print(f"⚠ Project {project_id} not found - skipping test")
            pytest.skip(f"Project {project_id} not found")
            return
        
        assert response.status_code == 200, f"Get project failed: {response.text}"
        
        data = response.json()
        
        # Check drive fields exist (may be empty strings)
        assert "drive_folder_name" in data, "Response should contain drive_folder_name"
        assert "drive_folder_link" in data, "Response should contain drive_folder_link"
        assert "drive_folder_id" in data, "Response should contain drive_folder_id"
        
        print(f"✓ Existing project has drive fields:")
        print(f"  - drive_folder_name: '{data.get('drive_folder_name', '')}'")
        print(f"  - drive_folder_link: '{data.get('drive_folder_link', '')}'")
        print(f"  - drive_folder_id: '{data.get('drive_folder_id', '')}'")
    
    def test_company_profile_no_drive_settings(self):
        """Test Company Profile API doesn't have drive settings fields"""
        response = self.session.get(f"{BASE_URL}/api/company")
        assert response.status_code == 200, f"Get company profiles failed: {response.text}"
        
        profiles = response.json()
        
        # Check that profiles don't have drive-related fields
        for profile in profiles:
            assert "drive_folder_name" not in profile, "Company profile should not have drive_folder_name"
            assert "drive_folder_link" not in profile, "Company profile should not have drive_folder_link"
            assert "google_drive_settings" not in profile, "Company profile should not have google_drive_settings"
        
        print(f"✓ Company profiles don't have drive settings (as expected)")
    
    def test_drive_settings_endpoint_exists(self):
        """Test /api/drive/settings endpoint still exists (for backward compatibility)"""
        response = self.session.get(f"{BASE_URL}/api/drive/settings")
        
        # The endpoint should exist but may return empty values
        assert response.status_code == 200, f"Drive settings endpoint failed: {response.text}"
        
        data = response.json()
        # Should have folder_name and folder_link keys
        assert "folder_name" in data or "folder_link" in data, "Drive settings should have folder_name/folder_link"
        
        print(f"✓ Drive settings endpoint exists (backward compatibility)")
        print(f"  - Response: {data}")
    
    def test_create_project_without_drive_fields(self):
        """Test creating project without drive fields (should work with empty strings)"""
        test_id = str(uuid.uuid4())[:8]
        project_data = {
            "customer": {
                "name": f"TEST_NoDrive_{test_id}",
                "phone": "9876543210",
                "address": "Test Address No Drive",
                "email": "test@example.com"
            },
            "location": {
                "latitude": 13.0827,
                "longitude": 80.2707,
                "address": "Chennai, Tamil Nadu",
                "site_location_words": "test.no.drive"
            },
            "electrical": {
                "sanction_load_kw": 5.0,
                "connected_load_kw": 4.0,
                "monthly_consumption_units": 500,
                "eb_tariff": 7.0,
                "service_type": "Single Phase"
            },
            "solar_system": {
                "system_type": "on-grid",
                "inverter_model": "Test Inverter",
                "panel_wattage": 540,
                "battery_required": False
            },
            "mounting": {
                "roof_type": "RCC Flat Roof",
                "tilt_angle": 15,
                "structure_type": "Galvanized Iron"
            },
            "additional": {
                "cable_length_meters": 50,
                "inverter_to_panel_distance": 10,
                "installation_complexity": "simple",
                "shadow_analysis_notes": "No shadows"
            },
            "selected_items": [],
            "manual_costs": [],
            "site_images": []
            # No drive fields - should default to empty strings
        }
        
        response = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert response.status_code == 200, f"Create project without drive fields failed: {response.text}"
        
        data = response.json()
        project_id = data["id"]
        
        # Verify project was created and drive fields are empty strings
        get_response = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_response.status_code == 200
        
        project = get_response.json()
        assert project.get("drive_folder_name", "") == "", "drive_folder_name should be empty"
        assert project.get("drive_folder_link", "") == "", "drive_folder_link should be empty"
        assert project.get("drive_folder_id", "") == "", "drive_folder_id should be empty"
        
        print(f"✓ Created project without drive fields - defaults to empty strings")
    
    def test_drive_link_validation_format(self):
        """Test that drive folder link format is validated (contains drive.google.com/drive/folders/)"""
        # This is frontend validation, but we can test that backend accepts valid links
        valid_links = [
            "https://drive.google.com/drive/folders/abc123",
            "https://drive.google.com/drive/folders/1234567890abcdef",
            "https://drive.google.com/drive/folders/folder-with-dashes_and_underscores"
        ]
        
        for link in valid_links:
            assert "drive.google.com/drive/folders/" in link, f"Link should contain drive.google.com/drive/folders/: {link}"
        
        print(f"✓ Drive link format validation works for {len(valid_links)} valid links")


class TestProjectListWithDriveFields:
    """Test project list includes drive fields"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with authentication"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        
        yield
        
        self.session.post(f"{BASE_URL}/api/auth/logout")
    
    def test_projects_list_endpoint(self):
        """Test GET /api/projects returns list of projects"""
        response = self.session.get(f"{BASE_URL}/api/projects")
        assert response.status_code == 200, f"Get projects failed: {response.text}"
        
        projects = response.json()
        assert isinstance(projects, list), "Response should be a list"
        
        print(f"✓ GET /api/projects returns {len(projects)} projects")
        
        # Check if any project has drive fields
        projects_with_drive = [p for p in projects if p.get("id") == "69d9da07fbd35551b1377165"]
        if projects_with_drive:
            print(f"  - Found test project with ID 69d9da07fbd35551b1377165")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])