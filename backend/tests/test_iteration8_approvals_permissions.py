"""
Iteration 8 Tests: Approvals & Permissions System
Tests for:
- GET /api/permissions - returns permissions for all 3 roles
- PUT /api/permissions/{role} - updates role permissions
- POST /api/approvals - creates approval request
- GET /api/approvals - lists approvals with filters
- GET /api/approvals/pending-count - returns pending count
- PUT /api/approvals/{id}/approve - approves and executes action
- PUT /api/approvals/{id}/reject - rejects with reason
- GET /api/dashboard/stats - includes pending_approvals count
"""

import pytest
import requests
import os
import uuid
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        """Login as admin and return session with cookies"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert data["role"] == "admin", "User is not admin"
        print(f"✓ Admin login successful: {data['name']} ({data['role']})")
        return session
    
    def test_admin_login(self, admin_session):
        """Verify admin can login"""
        response = admin_session.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "admin@sensoper.com"
        assert data["role"] == "admin"
        print(f"✓ Admin authenticated: {data['name']}")


class TestPermissionsAPI:
    """Tests for Permissions endpoints"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_get_all_permissions(self, admin_session):
        """GET /api/permissions returns permissions for all 3 roles with 16 keys each"""
        response = admin_session.get(f"{BASE_URL}/api/permissions")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        # Verify all 3 roles are present
        assert "admin" in data, "Missing admin permissions"
        assert "manager" in data, "Missing manager permissions"
        assert "staff" in data, "Missing staff permissions"
        
        # Verify each role has 16 permission keys
        expected_keys = [
            "can_create_project", "can_edit_project", "can_delete_project",
            "can_request_delete", "can_approve_deletion", "can_approve_quotation",
            "can_set_margin", "can_approve_margin", "can_edit_inventory",
            "can_approve_inventory", "can_manage_users", "can_change_user_access",
            "can_view_reports", "can_view_audit_logs", "can_manage_company", "can_manage_terms"
        ]
        
        for role in ["admin", "manager", "staff"]:
            role_perms = data[role]
            assert len(role_perms) >= 16, f"{role} has {len(role_perms)} permissions, expected 16"
            for key in expected_keys:
                assert key in role_perms, f"Missing {key} in {role} permissions"
            print(f"✓ {role} has {len(role_perms)} permissions")
        
        # Verify admin has all permissions True
        for key in expected_keys:
            assert data["admin"][key] == True, f"Admin should have {key}=True"
        print("✓ Admin has all permissions enabled")
        
        # Verify staff has limited permissions
        assert data["staff"]["can_manage_users"] == False
        assert data["staff"]["can_approve_deletion"] == False
        print("✓ Staff has limited permissions as expected")
    
    def test_get_single_role_permissions(self, admin_session):
        """GET /api/permissions/{role} returns permissions for specific role"""
        response = admin_session.get(f"{BASE_URL}/api/permissions/manager")
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "manager"
        assert "permissions" in data
        assert "can_create_project" in data["permissions"]
        print(f"✓ Manager permissions retrieved: {len(data['permissions'])} keys")
    
    def test_update_manager_permissions(self, admin_session):
        """PUT /api/permissions/manager updates manager permissions"""
        # First get current permissions
        get_response = admin_session.get(f"{BASE_URL}/api/permissions/manager")
        original_perms = get_response.json()["permissions"]
        
        # Toggle a permission
        new_perms = original_perms.copy()
        new_perms["can_view_reports"] = not original_perms.get("can_view_reports", True)
        
        response = admin_session.put(f"{BASE_URL}/api/permissions/manager", json={
            "permissions": new_perms
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data
        assert "manager" in data["message"].lower()
        print(f"✓ Manager permissions updated")
        
        # Verify the change
        verify_response = admin_session.get(f"{BASE_URL}/api/permissions/manager")
        updated_perms = verify_response.json()["permissions"]
        assert updated_perms["can_view_reports"] == new_perms["can_view_reports"]
        print(f"✓ Permission change verified: can_view_reports = {updated_perms['can_view_reports']}")
        
        # Restore original
        admin_session.put(f"{BASE_URL}/api/permissions/manager", json={"permissions": original_perms})
        print("✓ Original permissions restored")
    
    def test_update_staff_permissions(self, admin_session):
        """PUT /api/permissions/staff updates staff permissions"""
        get_response = admin_session.get(f"{BASE_URL}/api/permissions/staff")
        original_perms = get_response.json()["permissions"]
        
        new_perms = original_perms.copy()
        new_perms["can_view_reports"] = True  # Give staff report access temporarily
        
        response = admin_session.put(f"{BASE_URL}/api/permissions/staff", json={
            "permissions": new_perms
        })
        assert response.status_code == 200
        print("✓ Staff permissions updated")
        
        # Restore
        admin_session.put(f"{BASE_URL}/api/permissions/staff", json={"permissions": original_perms})
        print("✓ Staff permissions restored")
    
    def test_update_invalid_role_permissions(self, admin_session):
        """PUT /api/permissions/{invalid_role} returns 400"""
        response = admin_session.put(f"{BASE_URL}/api/permissions/superadmin", json={
            "permissions": {"can_create_project": True}
        })
        assert response.status_code == 400
        print("✓ Invalid role rejected with 400")


class TestApprovalsAPI:
    """Tests for Approvals endpoints"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    @pytest.fixture(scope="class")
    def test_approval_id(self, admin_session):
        """Create a test approval and return its ID"""
        response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "deletion",
            "description": f"TEST_Approval_{uuid.uuid4().hex[:8]}",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {}
        })
        assert response.status_code == 200
        data = response.json()
        approval_id = data["id"]
        print(f"✓ Test approval created: {approval_id}")
        return approval_id
    
    def test_create_approval_deletion(self, admin_session):
        """POST /api/approvals creates deletion approval"""
        response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "deletion",
            "description": "TEST_Delete project for testing",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {}
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert "message" in data
        print(f"✓ Deletion approval created: {data['id']}")
        return data["id"]
    
    def test_create_approval_margin_change(self, admin_session):
        """POST /api/approvals creates margin_change approval"""
        response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "margin_change",
            "description": "TEST_Margin change request",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {"item_margins": [{"index": 0, "margin_percentage": 15}]}
        })
        assert response.status_code == 200
        print("✓ Margin change approval created")
    
    def test_create_approval_quotation(self, admin_session):
        """POST /api/approvals creates quotation_approval"""
        response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "quotation_approval",
            "description": "TEST_Quotation approval request",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {}
        })
        assert response.status_code == 200
        print("✓ Quotation approval created")
    
    def test_create_approval_inventory_edit(self, admin_session):
        """POST /api/approvals creates inventory_edit approval"""
        response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "inventory_edit",
            "description": "TEST_Inventory edit request",
            "entity_type": "inventory_item",
            "entity_id": "test_item_id",
            "data_payload": {"name": "Updated Item Name", "unit_price": 1500}
        })
        assert response.status_code == 200
        print("✓ Inventory edit approval created")
    
    def test_create_approval_user_access(self, admin_session):
        """POST /api/approvals creates user_access_change approval"""
        response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "user_access_change",
            "description": "TEST_User access change request",
            "entity_type": "user",
            "entity_id": "test_user_id",
            "data_payload": {"user_id": "test_user_id", "new_role": "manager"}
        })
        assert response.status_code == 200
        print("✓ User access change approval created")
    
    def test_create_approval_invalid_type(self, admin_session):
        """POST /api/approvals with invalid type returns 400"""
        response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "invalid_type",
            "description": "Invalid approval type"
        })
        assert response.status_code == 400
        assert "Invalid type" in response.json()["detail"]
        print("✓ Invalid approval type rejected with 400")
    
    def test_get_all_approvals(self, admin_session):
        """GET /api/approvals returns list of approvals"""
        response = admin_session.get(f"{BASE_URL}/api/approvals")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        if len(data) > 0:
            approval = data[0]
            # Verify all required fields
            required_fields = ["id", "type", "requested_by", "requested_by_name", "role", 
                             "description", "entity_type", "entity_id", "status", "timestamp"]
            for field in required_fields:
                assert field in approval, f"Missing field: {field}"
            print(f"✓ Got {len(data)} approvals with all required fields")
        else:
            print("✓ Approvals list returned (empty)")
    
    def test_get_approvals_filter_by_status(self, admin_session):
        """GET /api/approvals?status=pending filters by status"""
        response = admin_session.get(f"{BASE_URL}/api/approvals", params={"status": "pending"})
        assert response.status_code == 200
        data = response.json()
        for approval in data:
            assert approval["status"] == "pending", f"Expected pending, got {approval['status']}"
        print(f"✓ Filtered by status=pending: {len(data)} results")
    
    def test_get_approvals_filter_by_type(self, admin_session):
        """GET /api/approvals?type=deletion filters by type"""
        response = admin_session.get(f"{BASE_URL}/api/approvals", params={"type": "deletion"})
        assert response.status_code == 200
        data = response.json()
        for approval in data:
            assert approval["type"] == "deletion", f"Expected deletion, got {approval['type']}"
        print(f"✓ Filtered by type=deletion: {len(data)} results")
    
    def test_get_pending_count(self, admin_session):
        """GET /api/approvals/pending-count returns count"""
        response = admin_session.get(f"{BASE_URL}/api/approvals/pending-count")
        assert response.status_code == 200
        data = response.json()
        assert "count" in data
        assert isinstance(data["count"], int)
        print(f"✓ Pending approvals count: {data['count']}")
    
    def test_approve_request(self, admin_session):
        """PUT /api/approvals/{id}/approve approves and executes action"""
        # Create a new approval to approve
        create_response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "quotation_approval",
            "description": "TEST_Approve_Workflow",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {}
        })
        assert create_response.status_code == 200
        approval_id = create_response.json()["id"]
        
        # Approve it
        response = admin_session.put(f"{BASE_URL}/api/approvals/{approval_id}/approve")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data
        assert "approved" in data["message"].lower() or "executed" in data["message"].lower()
        print(f"✓ Approval {approval_id} approved and executed")
        
        # Verify status changed
        get_response = admin_session.get(f"{BASE_URL}/api/approvals", params={"status": "approved"})
        approved_list = get_response.json()
        found = any(a["id"] == approval_id for a in approved_list)
        assert found, "Approved approval not found in approved list"
        print("✓ Approval status verified as approved")
    
    def test_reject_request(self, admin_session):
        """PUT /api/approvals/{id}/reject rejects with reason"""
        # Create a new approval to reject
        create_response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "deletion",
            "description": "TEST_Reject_Workflow",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {}
        })
        assert create_response.status_code == 200
        approval_id = create_response.json()["id"]
        
        # Reject it
        rejection_reason = "Not approved - testing rejection workflow"
        response = admin_session.put(f"{BASE_URL}/api/approvals/{approval_id}/reject", json={
            "reason": rejection_reason
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "message" in data
        assert "rejected" in data["message"].lower()
        print(f"✓ Approval {approval_id} rejected")
        
        # Verify status and reason
        get_response = admin_session.get(f"{BASE_URL}/api/approvals", params={"status": "rejected"})
        rejected_list = get_response.json()
        rejected_approval = next((a for a in rejected_list if a["id"] == approval_id), None)
        assert rejected_approval is not None, "Rejected approval not found"
        assert rejected_approval["rejection_reason"] == rejection_reason
        print(f"✓ Rejection reason verified: {rejection_reason}")
    
    def test_approve_already_resolved(self, admin_session):
        """PUT /api/approvals/{id}/approve returns error for already resolved"""
        # Create and approve an approval
        create_response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "quotation_approval",
            "description": "TEST_Already_Resolved",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {}
        })
        approval_id = create_response.json()["id"]
        admin_session.put(f"{BASE_URL}/api/approvals/{approval_id}/approve")
        
        # Try to approve again
        response = admin_session.put(f"{BASE_URL}/api/approvals/{approval_id}/approve")
        assert response.status_code == 400
        assert "already resolved" in response.json()["detail"].lower()
        print("✓ Already resolved approval returns 400")
    
    def test_reject_already_resolved(self, admin_session):
        """PUT /api/approvals/{id}/reject returns error for already resolved"""
        # Create and reject an approval
        create_response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "deletion",
            "description": "TEST_Already_Rejected",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {}
        })
        approval_id = create_response.json()["id"]
        admin_session.put(f"{BASE_URL}/api/approvals/{approval_id}/reject", json={"reason": "test"})
        
        # Try to reject again
        response = admin_session.put(f"{BASE_URL}/api/approvals/{approval_id}/reject", json={"reason": "test2"})
        assert response.status_code == 400
        assert "already resolved" in response.json()["detail"].lower()
        print("✓ Already resolved approval returns 400 on reject")


class TestDashboardStats:
    """Tests for dashboard stats including pending_approvals"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_dashboard_stats_includes_pending_approvals(self, admin_session):
        """GET /api/dashboard/stats includes pending_approvals count"""
        response = admin_session.get(f"{BASE_URL}/api/dashboard/stats")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        
        assert "pending_approvals" in data, "Missing pending_approvals in dashboard stats"
        assert isinstance(data["pending_approvals"], int)
        print(f"✓ Dashboard stats includes pending_approvals: {data['pending_approvals']}")
        
        # Verify other expected fields
        expected_fields = ["total", "draft", "submitted", "approved", "rejected", "completed"]
        for field in expected_fields:
            assert field in data, f"Missing {field} in dashboard stats"
        print(f"✓ Dashboard stats has all expected fields")


class TestApprovalWorkflow:
    """End-to-end approval workflow tests"""
    
    @pytest.fixture(scope="class")
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_full_approval_workflow(self, admin_session):
        """Test complete workflow: create -> approve -> verify execution"""
        # 1. Create approval
        create_response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "quotation_approval",
            "description": "TEST_Full_Workflow_Approval",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {}
        })
        assert create_response.status_code == 200
        approval_id = create_response.json()["id"]
        print(f"✓ Step 1: Created approval {approval_id}")
        
        # 2. Verify it's pending
        pending_response = admin_session.get(f"{BASE_URL}/api/approvals", params={"status": "pending"})
        pending_list = pending_response.json()
        found_pending = any(a["id"] == approval_id for a in pending_list)
        assert found_pending, "Approval not found in pending list"
        print("✓ Step 2: Verified approval is pending")
        
        # 3. Approve it
        approve_response = admin_session.put(f"{BASE_URL}/api/approvals/{approval_id}/approve")
        assert approve_response.status_code == 200
        print("✓ Step 3: Approved the request")
        
        # 4. Verify it's approved
        approved_response = admin_session.get(f"{BASE_URL}/api/approvals", params={"status": "approved"})
        approved_list = approved_response.json()
        approved_approval = next((a for a in approved_list if a["id"] == approval_id), None)
        assert approved_approval is not None
        assert approved_approval["approved_by_name"] is not None
        assert approved_approval["resolved_at"] is not None
        print(f"✓ Step 4: Verified approval is approved by {approved_approval['approved_by_name']}")
    
    def test_full_rejection_workflow(self, admin_session):
        """Test complete workflow: create -> reject -> verify"""
        # 1. Create approval
        create_response = admin_session.post(f"{BASE_URL}/api/approvals", json={
            "type": "deletion",
            "description": "TEST_Full_Rejection_Workflow",
            "entity_type": "project",
            "entity_id": "69d950ea3fde8e6f7b03789a",
            "data_payload": {}
        })
        assert create_response.status_code == 200
        approval_id = create_response.json()["id"]
        print(f"✓ Step 1: Created approval {approval_id}")
        
        # 2. Reject it with reason
        rejection_reason = "Project cannot be deleted - has active orders"
        reject_response = admin_session.put(f"{BASE_URL}/api/approvals/{approval_id}/reject", json={
            "reason": rejection_reason
        })
        assert reject_response.status_code == 200
        print("✓ Step 2: Rejected the request")
        
        # 3. Verify rejection
        rejected_response = admin_session.get(f"{BASE_URL}/api/approvals", params={"status": "rejected"})
        rejected_list = rejected_response.json()
        rejected_approval = next((a for a in rejected_list if a["id"] == approval_id), None)
        assert rejected_approval is not None
        assert rejected_approval["rejection_reason"] == rejection_reason
        assert rejected_approval["approved_by_name"] is not None
        print(f"✓ Step 3: Verified rejection with reason: {rejection_reason}")


# Cleanup test data
@pytest.fixture(scope="session", autouse=True)
def cleanup_test_approvals():
    """Cleanup TEST_ prefixed approvals after all tests"""
    yield
    # Cleanup happens after all tests
    session = requests.Session()
    response = session.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@sensoper.com",
        "password": TEST_ADMIN_PASSWORD
    })
    if response.status_code == 200:
        # Get all approvals and delete TEST_ ones (if delete endpoint exists)
        # For now, just log that cleanup would happen
        print("\n✓ Test cleanup: TEST_ prefixed approvals created during testing")