#!/usr/bin/env python3
"""
Backend API Tests for Company Profile Feature
Tests Company Profile CRUD, Logo Upload, and Active Profile endpoints
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://project-solar.preview.emergentagent.com')

class TestCompanyProfileAPI:
    """Company Profile API endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with admin authentication"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        self.admin_user = response.json()
        self.test_profile_id = None
        yield
        
        # Cleanup: Delete test profile if created
        if self.test_profile_id:
            try:
                self.session.delete(f"{BASE_URL}/api/company/{self.test_profile_id}")
            except:
                pass
    
    def test_get_all_company_profiles(self):
        """Test GET /api/company - returns list of all profiles"""
        response = self.session.get(f"{BASE_URL}/api/company")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        # Verify profile structure if profiles exist
        if len(data) > 0:
            profile = data[0]
            assert "id" in profile
            assert "company_name" in profile
            assert "address" in profile
            assert "phone" in profile
            assert "email" in profile
            assert "is_active" in profile
            print(f"✅ Found {len(data)} company profile(s)")
    
    def test_get_active_company_profile(self):
        """Test GET /api/company/active - returns active profile for PDF generation"""
        response = self.session.get(f"{BASE_URL}/api/company/active")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify required fields for PDF generation
        assert "company_name" in data
        assert "address" in data
        assert "phone" in data
        assert "email" in data
        assert "primary_color" in data
        assert "secondary_color" in data
        
        # Verify optional fields exist
        assert "bank_details" in data
        assert "authorized_signatory" in data
        assert "designation" in data
        
        print(f"✅ Active profile: {data['company_name']}")
    
    def test_create_company_profile(self):
        """Test POST /api/company - create new profile"""
        profile_data = {
            "company_name": "TEST_Company Profile",
            "tagline": "Test Tagline",
            "address": "123 Test Street, Test City",
            "phone": "+91 12345 67890",
            "email": "test@testcompany.com",
            "website": "www.testcompany.com",
            "gst_number": "33TEST1234X1ZX",
            "pan_number": "TEST1234X",
            "primary_color": "#FF5733",
            "secondary_color": "#33FF57",
            "bank_details": {
                "account_name": "Test Company",
                "account_number": "9876543210",
                "ifsc_code": "TEST0001234",
                "bank_name": "Test Bank",
                "branch": "Test Branch"
            },
            "authorized_signatory": "Test Signatory",
            "designation": "Test Director"
        }
        
        response = self.session.post(f"{BASE_URL}/api/company", json=profile_data)
        
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "message" in data
        
        self.test_profile_id = data["id"]
        print(f"✅ Created test profile with ID: {self.test_profile_id}")
        
        # Verify profile was created by fetching it
        get_response = self.session.get(f"{BASE_URL}/api/company")
        profiles = get_response.json()
        created_profile = next((p for p in profiles if p["id"] == self.test_profile_id), None)
        
        assert created_profile is not None
        assert created_profile["company_name"] == profile_data["company_name"]
        assert created_profile["email"] == profile_data["email"]
        assert created_profile["is_active"] == False  # New profiles are inactive by default
    
    def test_update_company_profile(self):
        """Test PUT /api/company/{id} - update profile"""
        # First create a profile to update
        create_response = self.session.post(f"{BASE_URL}/api/company", json={
            "company_name": "TEST_Update Profile",
            "address": "Original Address",
            "phone": "+91 11111 11111",
            "email": "update@test.com"
        })
        assert create_response.status_code == 200
        profile_id = create_response.json()["id"]
        self.test_profile_id = profile_id
        
        # Update the profile
        update_data = {
            "company_name": "TEST_Updated Company Name",
            "tagline": "Updated Tagline",
            "address": "Updated Address"
        }
        
        update_response = self.session.put(f"{BASE_URL}/api/company/{profile_id}", json=update_data)
        
        assert update_response.status_code == 200
        assert "message" in update_response.json()
        
        # Verify update by fetching
        get_response = self.session.get(f"{BASE_URL}/api/company")
        profiles = get_response.json()
        updated_profile = next((p for p in profiles if p["id"] == profile_id), None)
        
        assert updated_profile is not None
        assert updated_profile["company_name"] == update_data["company_name"]
        assert updated_profile["tagline"] == update_data["tagline"]
        print(f"✅ Profile updated successfully")
    
    def test_toggle_active_profile(self):
        """Test PUT /api/company/{id} with is_active - toggle active status"""
        # Create a test profile
        create_response = self.session.post(f"{BASE_URL}/api/company", json={
            "company_name": "TEST_Toggle Active",
            "address": "Toggle Address",
            "phone": "+91 22222 22222",
            "email": "toggle@test.com"
        })
        assert create_response.status_code == 200
        profile_id = create_response.json()["id"]
        self.test_profile_id = profile_id
        
        # Activate the profile
        activate_response = self.session.put(f"{BASE_URL}/api/company/{profile_id}", json={
            "is_active": True
        })
        
        assert activate_response.status_code == 200
        
        # Verify it's now active
        get_response = self.session.get(f"{BASE_URL}/api/company")
        profiles = get_response.json()
        activated_profile = next((p for p in profiles if p["id"] == profile_id), None)
        
        assert activated_profile is not None
        assert activated_profile["is_active"] == True
        
        # Verify other profiles are deactivated (only one can be active)
        other_active = [p for p in profiles if p["is_active"] and p["id"] != profile_id]
        assert len(other_active) == 0, "Multiple active profiles found"
        
        print(f"✅ Profile activation toggle works correctly")
    
    def test_delete_company_profile(self):
        """Test DELETE /api/company/{id} - delete inactive profile"""
        # Create a profile to delete
        create_response = self.session.post(f"{BASE_URL}/api/company", json={
            "company_name": "TEST_Delete Profile",
            "address": "Delete Address",
            "phone": "+91 33333 33333",
            "email": "delete@test.com"
        })
        assert create_response.status_code == 200
        profile_id = create_response.json()["id"]
        
        # Delete the profile (it's inactive by default)
        delete_response = self.session.delete(f"{BASE_URL}/api/company/{profile_id}")
        
        assert delete_response.status_code == 200
        assert "message" in delete_response.json()
        
        # Verify deletion
        get_response = self.session.get(f"{BASE_URL}/api/company")
        profiles = get_response.json()
        deleted_profile = next((p for p in profiles if p["id"] == profile_id), None)
        
        assert deleted_profile is None
        print(f"✅ Profile deleted successfully")
    
    def test_cannot_delete_active_profile(self):
        """Test DELETE /api/company/{id} - cannot delete active profile"""
        # Create and activate a profile
        create_response = self.session.post(f"{BASE_URL}/api/company", json={
            "company_name": "TEST_Cannot Delete Active",
            "address": "Active Address",
            "phone": "+91 44444 44444",
            "email": "active@test.com"
        })
        assert create_response.status_code == 200
        profile_id = create_response.json()["id"]
        self.test_profile_id = profile_id
        
        # Activate the profile
        self.session.put(f"{BASE_URL}/api/company/{profile_id}", json={"is_active": True})
        
        # Try to delete active profile - should fail
        delete_response = self.session.delete(f"{BASE_URL}/api/company/{profile_id}")
        
        assert delete_response.status_code == 400
        assert "Cannot delete active profile" in delete_response.json().get("detail", "")
        print(f"✅ Active profile deletion correctly prevented")
        
        # Deactivate for cleanup
        self.session.put(f"{BASE_URL}/api/company/{profile_id}", json={"is_active": False})
    
    def test_upload_logo(self):
        """Test POST /api/company/upload-logo - upload logo image"""
        # Create a small test PNG image (1x1 pixel)
        import base64
        import io
        png_data = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
        
        # Use a fresh session for file upload to avoid Content-Type conflicts
        upload_session = requests.Session()
        
        # First login to get cookies
        login_response = upload_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert login_response.status_code == 200
        
        # Upload the file
        files = {"file": ("test_logo.png", io.BytesIO(png_data), "image/png")}
        
        response = upload_session.post(
            f"{BASE_URL}/api/company/upload-logo",
            files=files
        )
        
        assert response.status_code == 200, f"Upload failed: {response.text}"
        data = response.json()
        assert "logo_url" in data
        assert data["logo_url"].startswith("data:image/png;base64,")
        print(f"✅ Logo upload returns base64 data URL")
    
    def test_upload_logo_rejects_non_image(self):
        """Test POST /api/company/upload-logo - rejects non-image files"""
        import io
        
        # Use a fresh session for file upload
        upload_session = requests.Session()
        
        # First login to get cookies
        login_response = upload_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert login_response.status_code == 200
        
        files = {"file": ("test.txt", io.BytesIO(b"This is not an image"), "text/plain")}
        
        response = upload_session.post(
            f"{BASE_URL}/api/company/upload-logo",
            files=files
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        print(f"✅ Non-image file correctly rejected")
    
    def test_company_profile_requires_auth(self):
        """Test that company profile endpoints require authentication"""
        # Create a new session without auth
        unauth_session = requests.Session()
        
        response = unauth_session.get(f"{BASE_URL}/api/company")
        assert response.status_code == 401
        
        response = unauth_session.post(f"{BASE_URL}/api/company", json={
            "company_name": "Test",
            "address": "Test",
            "phone": "Test",
            "email": "test@test.com"
        })
        assert response.status_code == 401
        
        print(f"✅ Company profile endpoints require authentication")
    
    def test_active_profile_public_access(self):
        """Test GET /api/company/active - accessible without auth for PDF generation"""
        # Create a new session without auth
        unauth_session = requests.Session()
        
        response = unauth_session.get(f"{BASE_URL}/api/company/active")
        
        # This endpoint should be accessible without auth for PDF generation
        assert response.status_code == 200
        data = response.json()
        assert "company_name" in data
        print(f"✅ Active profile endpoint accessible for PDF generation")


class TestTermsAndConditionsAPI:
    """Terms & Conditions API tests for PDF generation"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with admin authentication"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        yield
    
    def test_get_active_terms(self):
        """Test GET /api/terms/active - returns active terms for PDF"""
        response = self.session.get(f"{BASE_URL}/api/terms/active")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "title" in data
        assert "content" in data
        print(f"✅ Active terms retrieved: {data.get('title', 'Default Terms')}")


class TestProjectPDFIntegration:
    """Tests for project details and PDF generation integration"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test session with admin authentication"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert response.status_code == 200
        yield
    
    def test_approved_project_has_cost_estimation(self):
        """Test that approved projects have cost estimation data for PDF"""
        response = self.session.get(f"{BASE_URL}/api/projects?status=approved")
        
        assert response.status_code == 200
        projects = response.json()
        
        if len(projects) > 0:
            project = projects[0]
            assert "cost_estimation" in project
            
            cost = project["cost_estimation"]
            required_fields = [
                "panels_required", "total_capacity_kw", "panel_cost",
                "inverter_cost", "structure_cost", "wiring_cost",
                "labor_cost", "transportation_cost", "subtotal",
                "margin", "gst", "total_cost"
            ]
            
            for field in required_fields:
                assert field in cost, f"Missing cost field: {field}"
            
            print(f"✅ Approved project has complete cost estimation data")
        else:
            pytest.skip("No approved projects to test")
    
    def test_project_details_endpoint(self):
        """Test GET /api/projects/{id} - returns full project details"""
        # Get an approved project
        list_response = self.session.get(f"{BASE_URL}/api/projects?status=approved")
        projects = list_response.json()
        
        if len(projects) > 0:
            project_id = projects[0]["id"]
            
            response = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
            
            assert response.status_code == 200
            data = response.json()
            
            # Verify all sections needed for PDF
            assert "customer" in data
            assert "location" in data
            assert "electrical" in data
            assert "solar_system" in data
            assert "mounting" in data
            assert "cost_estimation" in data
            
            print(f"✅ Project details endpoint returns all data for PDF generation")
        else:
            pytest.skip("No approved projects to test")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
