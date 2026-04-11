"""
Iteration 10: Site Measurements Tab (Step 5) Tests
Tests for the new Site Measurements feature with 8 collapsible sections:
- Roof Details, Orientation & Tilt, Shadow Analysis, Obstructions
- Electrical Details, Load Details, Inverter & Earthing, Access & Safety
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSiteMeasurementsAPI:
    """Test site_measurements field in projects API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Login and get auth cookies"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.user = login_resp.json()
        print(f"Logged in as: {self.user['email']}")
    
    def test_01_create_project_with_full_site_measurements(self):
        """Test creating a project with all site_measurements fields populated"""
        unique_id = str(uuid.uuid4())[:8]
        
        site_measurements = {
            "roof": {
                "length": 30.5,
                "width": 20.0,
                "area": 610.0,
                "type": "RCC",
                "height": 12.5
            },
            "orientation": {
                "direction": "South",
                "tilt_angle": "12"
            },
            "shadow": {
                "present": True,
                "sources": ["Trees", "Buildings"],
                "obstruction_height": "15",
                "distance": "20"
            },
            "obstructions": [
                {"name": "Water Tank", "notes": "North-East corner"},
                {"name": "AC Unit", "notes": "Near parapet"}
            ],
            "electrical": {
                "meter_location": "Ground floor, left wall",
                "db_distance": "25",
                "cable_length": "50"
            },
            "load": {
                "monthly_units": "500",
                "connected_load": "5",
                "connection_type": "Residential"
            },
            "inverter": {
                "location": "Near main DB, ground floor",
                "wall_space": "Yes",
                "earthing_available": "Yes",
                "earthing_distance": "15"
            },
            "access": {
                "type": "Stairs",
                "working_space": "Yes",
                "notes": "Good access, no safety concerns"
            }
        }
        
        project_data = {
            "customer": {"name": f"TEST_SiteMeas_{unique_id}", "phone": "9876543210", "address": "Test Address"},
            "location": {"site_location_words": "test.site.measurements", "address": "Test Location"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7, "service_type": "Single Phase"},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC", "tilt_angle": 12, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_name": "Test_Folder",
            "drive_folder_link": "https://drive.google.com/drive/folders/test123",
            "site_measurements": site_measurements
        }
        
        resp = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert resp.status_code == 200, f"Create project failed: {resp.text}"
        
        data = resp.json()
        assert "id" in data
        project_id = data["id"]
        print(f"Created project with site_measurements: {project_id}")
        
        # Verify by fetching the project
        get_resp = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_resp.status_code == 200
        
        project = get_resp.json()
        assert "site_measurements" in project
        sm = project["site_measurements"]
        
        # Verify roof details
        assert sm["roof"]["length"] == 30.5
        assert sm["roof"]["width"] == 20.0
        assert sm["roof"]["area"] == 610.0
        assert sm["roof"]["type"] == "RCC"
        assert sm["roof"]["height"] == 12.5
        
        # Verify orientation
        assert sm["orientation"]["direction"] == "South"
        assert sm["orientation"]["tilt_angle"] == "12"
        
        # Verify shadow analysis
        assert sm["shadow"]["present"] == True
        assert "Trees" in sm["shadow"]["sources"]
        assert "Buildings" in sm["shadow"]["sources"]
        
        # Verify obstructions
        assert len(sm["obstructions"]) == 2
        assert sm["obstructions"][0]["name"] == "Water Tank"
        
        # Verify electrical
        assert sm["electrical"]["meter_location"] == "Ground floor, left wall"
        
        # Verify load
        assert sm["load"]["connection_type"] == "Residential"
        
        # Verify inverter
        assert sm["inverter"]["wall_space"] == "Yes"
        assert sm["inverter"]["earthing_available"] == "Yes"
        
        # Verify access
        assert sm["access"]["type"] == "Stairs"
        assert sm["access"]["working_space"] == "Yes"
        
        print("All site_measurements fields verified successfully")
    
    def test_02_create_project_with_empty_site_measurements(self):
        """Test creating a project with empty site_measurements"""
        unique_id = str(uuid.uuid4())[:8]
        
        project_data = {
            "customer": {"name": f"TEST_EmptySiteMeas_{unique_id}", "phone": "9876543210", "address": "Test Address"},
            "location": {"site_location_words": "test.empty.meas", "address": "Test Location"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC", "tilt_angle": 12, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_name": "Test_Folder",
            "drive_folder_link": "https://drive.google.com/drive/folders/test123",
            "site_measurements": {}
        }
        
        resp = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert resp.status_code == 200, f"Create project failed: {resp.text}"
        
        project_id = resp.json()["id"]
        
        # Verify
        get_resp = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_resp.status_code == 200
        
        project = get_resp.json()
        assert "site_measurements" in project
        assert project["site_measurements"] == {}
        
        print("Empty site_measurements handled correctly")
    
    def test_03_update_project_site_measurements(self):
        """Test updating site_measurements on an existing project"""
        unique_id = str(uuid.uuid4())[:8]
        
        # Create project first
        project_data = {
            "customer": {"name": f"TEST_UpdateSiteMeas_{unique_id}", "phone": "9876543210", "address": "Test Address"},
            "location": {"site_location_words": "test.update.meas", "address": "Test Location"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC", "tilt_angle": 12, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_name": "Test_Folder",
            "drive_folder_link": "https://drive.google.com/drive/folders/test123",
            "site_measurements": {"roof": {"length": 10, "width": 10}}
        }
        
        create_resp = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert create_resp.status_code == 200
        project_id = create_resp.json()["id"]
        
        # Update site_measurements
        update_data = {
            "site_measurements": {
                "roof": {"length": 25, "width": 15, "area": 375, "type": "Sheet", "height": 10},
                "orientation": {"direction": "North-East", "tilt_angle": "15"},
                "shadow": {"present": False, "sources": [], "obstruction_height": "", "distance": ""},
                "obstructions": [{"name": "Chimney", "notes": "Center of roof"}],
                "electrical": {"meter_location": "First floor", "db_distance": "30", "cable_length": "60"},
                "load": {"monthly_units": "600", "connected_load": "6", "connection_type": "Commercial"},
                "inverter": {"location": "Basement", "wall_space": "No", "earthing_available": "No", "earthing_distance": ""},
                "access": {"type": "Ladder", "working_space": "No", "notes": "Limited access"}
            }
        }
        
        update_resp = self.session.put(f"{BASE_URL}/api/projects/{project_id}", json=update_data)
        assert update_resp.status_code == 200, f"Update failed: {update_resp.text}"
        
        # Verify update
        get_resp = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_resp.status_code == 200
        
        project = get_resp.json()
        sm = project["site_measurements"]
        
        assert sm["roof"]["length"] == 25
        assert sm["roof"]["type"] == "Sheet"
        assert sm["orientation"]["direction"] == "North-East"
        assert sm["shadow"]["present"] == False
        assert len(sm["obstructions"]) == 1
        assert sm["obstructions"][0]["name"] == "Chimney"
        assert sm["load"]["connection_type"] == "Commercial"
        assert sm["access"]["type"] == "Ladder"
        
        print("Site measurements updated successfully")
    
    def test_04_get_existing_project_with_site_measurements(self):
        """Test fetching the test project 69da537a503bbadabc32c2d4 with site_measurements"""
        project_id = "69da537a503bbadabc32c2d4"
        
        resp = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        
        if resp.status_code == 404:
            pytest.skip(f"Test project {project_id} not found - may have been deleted")
        
        assert resp.status_code == 200, f"Get project failed: {resp.text}"
        
        project = resp.json()
        assert "site_measurements" in project
        
        sm = project["site_measurements"]
        print(f"Project {project_id} site_measurements: {sm}")
        
        # Check if site_measurements has expected structure
        if sm:
            # Verify structure exists
            expected_sections = ["roof", "orientation", "shadow", "obstructions", "electrical", "load", "inverter", "access"]
            for section in expected_sections:
                if section in sm:
                    print(f"  - {section}: {sm[section]}")
        
        print("Existing project site_measurements retrieved successfully")
    
    def test_05_roof_type_dropdown_values(self):
        """Test that roof type accepts RCC, Sheet, Tile, Other values"""
        unique_id = str(uuid.uuid4())[:8]
        
        roof_types = ["RCC", "Sheet", "Tile", "Other"]
        
        for roof_type in roof_types:
            project_data = {
                "customer": {"name": f"TEST_RoofType_{roof_type}_{unique_id}", "phone": "9876543210", "address": "Test Address"},
                "location": {"site_location_words": f"test.roof.{roof_type.lower()}", "address": "Test Location"},
                "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
                "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
                "mounting": {"roof_type": roof_type, "tilt_angle": 12, "structure_type": "GI"},
                "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
                "selected_items": [],
                "manual_costs": [],
                "drive_folder_name": "Test_Folder",
                "drive_folder_link": "https://drive.google.com/drive/folders/test123",
                "site_measurements": {"roof": {"type": roof_type}}
            }
            
            resp = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
            assert resp.status_code == 200, f"Create project with roof type {roof_type} failed: {resp.text}"
            
            project_id = resp.json()["id"]
            get_resp = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
            assert get_resp.status_code == 200
            
            project = get_resp.json()
            assert project["site_measurements"]["roof"]["type"] == roof_type
            print(f"Roof type '{roof_type}' accepted and stored correctly")
    
    def test_06_orientation_direction_values(self):
        """Test that orientation direction accepts all 8 compass directions"""
        unique_id = str(uuid.uuid4())[:8]
        
        directions = ["North", "South", "East", "West", "North-East", "North-West", "South-East", "South-West"]
        
        for direction in directions:
            project_data = {
                "customer": {"name": f"TEST_Direction_{direction}_{unique_id}", "phone": "9876543210", "address": "Test Address"},
                "location": {"site_location_words": f"test.dir.{direction.lower()}", "address": "Test Location"},
                "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
                "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
                "mounting": {"roof_type": "RCC", "tilt_angle": 12, "structure_type": "GI"},
                "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
                "selected_items": [],
                "manual_costs": [],
                "drive_folder_name": "Test_Folder",
                "drive_folder_link": "https://drive.google.com/drive/folders/test123",
                "site_measurements": {"orientation": {"direction": direction, "tilt_angle": "12"}}
            }
            
            resp = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
            assert resp.status_code == 200, f"Create project with direction {direction} failed: {resp.text}"
            print(f"Direction '{direction}' accepted")
        
        print("All 8 compass directions accepted successfully")
    
    def test_07_shadow_sources_multi_select(self):
        """Test that shadow sources accepts multiple values"""
        unique_id = str(uuid.uuid4())[:8]
        
        shadow_sources = ["Trees", "Buildings", "Poles", "Tanks", "Other"]
        
        project_data = {
            "customer": {"name": f"TEST_ShadowSources_{unique_id}", "phone": "9876543210", "address": "Test Address"},
            "location": {"site_location_words": "test.shadow.sources", "address": "Test Location"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC", "tilt_angle": 12, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_name": "Test_Folder",
            "drive_folder_link": "https://drive.google.com/drive/folders/test123",
            "site_measurements": {
                "shadow": {
                    "present": True,
                    "sources": shadow_sources,
                    "obstruction_height": "20",
                    "distance": "15"
                }
            }
        }
        
        resp = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert resp.status_code == 200, f"Create project failed: {resp.text}"
        
        project_id = resp.json()["id"]
        get_resp = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_resp.status_code == 200
        
        project = get_resp.json()
        stored_sources = project["site_measurements"]["shadow"]["sources"]
        
        for source in shadow_sources:
            assert source in stored_sources, f"Shadow source '{source}' not found in stored data"
        
        print(f"All shadow sources stored correctly: {stored_sources}")
    
    def test_08_obstructions_dynamic_rows(self):
        """Test that obstructions can have multiple dynamic rows"""
        unique_id = str(uuid.uuid4())[:8]
        
        obstructions = [
            {"name": "Water Tank", "notes": "North corner"},
            {"name": "AC Unit", "notes": "East wall"},
            {"name": "Chimney", "notes": "Center"},
            {"name": "Antenna", "notes": "South-West"},
            {"name": "Solar Water Heater", "notes": "Already installed"}
        ]
        
        project_data = {
            "customer": {"name": f"TEST_Obstructions_{unique_id}", "phone": "9876543210", "address": "Test Address"},
            "location": {"site_location_words": "test.obstructions", "address": "Test Location"},
            "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
            "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
            "mounting": {"roof_type": "RCC", "tilt_angle": 12, "structure_type": "GI"},
            "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
            "selected_items": [],
            "manual_costs": [],
            "drive_folder_name": "Test_Folder",
            "drive_folder_link": "https://drive.google.com/drive/folders/test123",
            "site_measurements": {"obstructions": obstructions}
        }
        
        resp = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
        assert resp.status_code == 200, f"Create project failed: {resp.text}"
        
        project_id = resp.json()["id"]
        get_resp = self.session.get(f"{BASE_URL}/api/projects/{project_id}")
        assert get_resp.status_code == 200
        
        project = get_resp.json()
        stored_obstructions = project["site_measurements"]["obstructions"]
        
        assert len(stored_obstructions) == 5, f"Expected 5 obstructions, got {len(stored_obstructions)}"
        
        for i, obs in enumerate(obstructions):
            assert stored_obstructions[i]["name"] == obs["name"]
            assert stored_obstructions[i]["notes"] == obs["notes"]
        
        print(f"All {len(obstructions)} obstructions stored correctly")
    
    def test_09_connection_type_values(self):
        """Test that connection type accepts Residential, Commercial, Industrial"""
        unique_id = str(uuid.uuid4())[:8]
        
        connection_types = ["Residential", "Commercial", "Industrial"]
        
        for conn_type in connection_types:
            project_data = {
                "customer": {"name": f"TEST_ConnType_{conn_type}_{unique_id}", "phone": "9876543210", "address": "Test Address"},
                "location": {"site_location_words": f"test.conn.{conn_type.lower()}", "address": "Test Location"},
                "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
                "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
                "mounting": {"roof_type": "RCC", "tilt_angle": 12, "structure_type": "GI"},
                "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
                "selected_items": [],
                "manual_costs": [],
                "drive_folder_name": "Test_Folder",
                "drive_folder_link": "https://drive.google.com/drive/folders/test123",
                "site_measurements": {"load": {"connection_type": conn_type}}
            }
            
            resp = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
            assert resp.status_code == 200, f"Create project with connection type {conn_type} failed: {resp.text}"
            print(f"Connection type '{conn_type}' accepted")
        
        print("All connection types accepted successfully")
    
    def test_10_access_type_values(self):
        """Test that access type accepts Stairs, Ladder, Direct Access"""
        unique_id = str(uuid.uuid4())[:8]
        
        access_types = ["Stairs", "Ladder", "Direct"]
        
        for access_type in access_types:
            project_data = {
                "customer": {"name": f"TEST_AccessType_{access_type}_{unique_id}", "phone": "9876543210", "address": "Test Address"},
                "location": {"site_location_words": f"test.access.{access_type.lower()}", "address": "Test Location"},
                "electrical": {"sanction_load_kw": 5, "connected_load_kw": 4, "monthly_consumption_units": 500, "eb_tariff": 7},
                "solar_system": {"system_type": "on-grid", "panel_wattage": 540, "battery_required": False},
                "mounting": {"roof_type": "RCC", "tilt_angle": 12, "structure_type": "GI"},
                "additional": {"cable_length_meters": 50, "inverter_to_panel_distance": 10, "installation_complexity": "simple"},
                "selected_items": [],
                "manual_costs": [],
                "drive_folder_name": "Test_Folder",
                "drive_folder_link": "https://drive.google.com/drive/folders/test123",
                "site_measurements": {"access": {"type": access_type}}
            }
            
            resp = self.session.post(f"{BASE_URL}/api/projects", json=project_data)
            assert resp.status_code == 200, f"Create project with access type {access_type} failed: {resp.text}"
            print(f"Access type '{access_type}' accepted")
        
        print("All access types accepted successfully")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
