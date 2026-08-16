"""
Iteration 18 Tests: 5 Operational Modules
- Customer Credits (credit entries, payment tracking, aging)
- Purchase Inbound (PO → Approve → Arrival → QC → Inventory)
- Delivery Outbound (dispatch tracking)
- Brand Returns (damage/excess/defect)
- Weekly Audits (checklist, issues, status)
"""
import pytest
import requests
import os
import time
TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"


BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def session(self):
        return requests.Session()
    
    def test_admin_login(self, session):
        """Test admin login with credentials"""
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert data["email"] == "admin@sensoper.com"
        assert data["role"] == "admin"
        print(f"✓ Admin login successful: {data['name']}")


class TestCustomerCredits:
    """Customer Credits module tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_list_credits(self, auth_session):
        """Test GET /api/credits returns list"""
        response = auth_session.get(f"{BASE_URL}/api/credits")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Credits list returned {len(data)} items")
    
    def test_create_credit(self, auth_session):
        """Test POST /api/credits creates credit entry"""
        credit_data = {
            "customer_name": "TEST_Credit_Customer",
            "customer_phone": "9876543210",
            "invoice_ref": "INV-TEST-001",
            "total_amount": 50000,
            "due_date": "2026-02-15",
            "notes": "Test credit entry"
        }
        response = auth_session.post(f"{BASE_URL}/api/credits", json=credit_data)
        assert response.status_code == 200, f"Create credit failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["message"] == "Credit created"
        print(f"✓ Credit created with ID: {data['id']}")
        return data["id"]
    
    def test_credit_appears_in_list(self, auth_session):
        """Test created credit appears in list"""
        # First create a credit
        credit_data = {
            "customer_name": "TEST_Credit_List_Check",
            "customer_phone": "9876543211",
            "total_amount": 25000,
            "due_date": "2026-02-20"
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/credits", json=credit_data)
        assert create_resp.status_code == 200
        credit_id = create_resp.json()["id"]
        
        # Verify it appears in list
        list_resp = auth_session.get(f"{BASE_URL}/api/credits")
        assert list_resp.status_code == 200
        credits = list_resp.json()
        found = any(c["id"] == credit_id for c in credits)
        assert found, "Created credit not found in list"
        print(f"✓ Credit {credit_id} found in list")
    
    def test_record_payment(self, auth_session):
        """Test POST /api/credits/{id}/pay records payment"""
        # Create a credit first
        credit_data = {
            "customer_name": "TEST_Payment_Customer",
            "total_amount": 100000
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/credits", json=credit_data)
        assert create_resp.status_code == 200
        credit_id = create_resp.json()["id"]
        
        # Record payment
        payment_data = {
            "credit_id": credit_id,
            "amount": 30000,
            "payment_method": "upi",
            "notes": "Partial payment"
        }
        pay_resp = auth_session.post(f"{BASE_URL}/api/credits/{credit_id}/pay", json=payment_data)
        assert pay_resp.status_code == 200, f"Payment failed: {pay_resp.text}"
        data = pay_resp.json()
        assert data["message"] == "Payment recorded"
        assert data["new_balance"] == 70000  # 100000 - 30000
        print(f"✓ Payment recorded, new balance: {data['new_balance']}")
    
    def test_balance_updates_after_payment(self, auth_session):
        """Test balance updates correctly after payment"""
        # Create credit
        credit_data = {"customer_name": "TEST_Balance_Check", "total_amount": 50000}
        create_resp = auth_session.post(f"{BASE_URL}/api/credits", json=credit_data)
        credit_id = create_resp.json()["id"]
        
        # Record payment
        auth_session.post(f"{BASE_URL}/api/credits/{credit_id}/pay", json={
            "credit_id": credit_id, "amount": 20000, "payment_method": "cash"
        })
        
        # Check balance in list
        list_resp = auth_session.get(f"{BASE_URL}/api/credits")
        credits = list_resp.json()
        credit = next((c for c in credits if c["id"] == credit_id), None)
        assert credit is not None
        assert credit["balance"] == 30000
        assert credit["amount_paid"] == 20000
        print(f"✓ Balance correctly updated: paid={credit['amount_paid']}, balance={credit['balance']}")
    
    def test_filter_by_status(self, auth_session):
        """Test filtering credits by status"""
        # Test active filter
        active_resp = auth_session.get(f"{BASE_URL}/api/credits", params={"status": "active"})
        assert active_resp.status_code == 200
        
        # Test closed filter
        closed_resp = auth_session.get(f"{BASE_URL}/api/credits", params={"status": "closed"})
        assert closed_resp.status_code == 200
        
        # Test overdue filter
        overdue_resp = auth_session.get(f"{BASE_URL}/api/credits", params={"status": "overdue"})
        assert overdue_resp.status_code == 200
        print("✓ Status filters work correctly")
    
    def test_credit_auto_closes_when_fully_paid(self, auth_session):
        """Test credit status changes to closed when fully paid"""
        # Create credit
        credit_data = {"customer_name": "TEST_Auto_Close", "total_amount": 10000}
        create_resp = auth_session.post(f"{BASE_URL}/api/credits", json=credit_data)
        credit_id = create_resp.json()["id"]
        
        # Pay full amount
        auth_session.post(f"{BASE_URL}/api/credits/{credit_id}/pay", json={
            "credit_id": credit_id, "amount": 10000, "payment_method": "bank_transfer"
        })
        
        # Check status
        list_resp = auth_session.get(f"{BASE_URL}/api/credits")
        credit = next((c for c in list_resp.json() if c["id"] == credit_id), None)
        assert credit["status"] == "closed"
        assert credit["balance"] == 0
        print("✓ Credit auto-closed when fully paid")


class TestPurchaseInbound:
    """Purchase Inbound (PO) module tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_list_purchase_orders(self, auth_session):
        """Test GET /api/purchase-orders returns list"""
        response = auth_session.get(f"{BASE_URL}/api/purchase-orders")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Purchase orders list returned {len(data)} items")
    
    def test_create_purchase_order(self, auth_session):
        """Test POST /api/purchase-orders creates PO"""
        po_data = {
            "supplier_name": "TEST_Supplier_Co",
            "supplier_contact": "9876543212",
            "items": [
                {"name": "Solar Panel 540W", "qty": 10, "unit_price": 15000},
                {"name": "Inverter 5kW", "qty": 2, "unit_price": 45000}
            ],
            "expected_delivery": "2026-02-10",
            "notes": "Test PO"
        }
        response = auth_session.post(f"{BASE_URL}/api/purchase-orders", json=po_data)
        assert response.status_code == 200, f"Create PO failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["message"] == "PO created"
        print(f"✓ PO created with ID: {data['id']}")
        return data["id"]
    
    def test_po_appears_in_list(self, auth_session):
        """Test created PO appears in list with correct status"""
        # Create PO
        po_data = {
            "supplier_name": "TEST_PO_List_Check",
            "items": [{"name": "Test Item", "qty": 5, "unit_price": 1000}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/purchase-orders", json=po_data)
        po_id = create_resp.json()["id"]
        
        # Verify in list
        list_resp = auth_session.get(f"{BASE_URL}/api/purchase-orders")
        pos = list_resp.json()
        po = next((p for p in pos if p["id"] == po_id), None)
        assert po is not None
        assert po["status"] == "pending"
        assert po["total_amount"] == 5000  # 5 * 1000
        print(f"✓ PO found in list with status: {po['status']}")
    
    def test_approve_po(self, auth_session):
        """Test PUT /api/purchase-orders/{id}/approve changes status"""
        # Create PO
        po_data = {
            "supplier_name": "TEST_Approve_PO",
            "items": [{"name": "Test Item", "qty": 1, "unit_price": 100}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/purchase-orders", json=po_data)
        po_id = create_resp.json()["id"]
        
        # Approve
        approve_resp = auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/approve")
        assert approve_resp.status_code == 200, f"Approve failed: {approve_resp.text}"
        
        # Verify status changed
        list_resp = auth_session.get(f"{BASE_URL}/api/purchase-orders")
        po = next((p for p in list_resp.json() if p["id"] == po_id), None)
        assert po["status"] == "approved"
        print("✓ PO approved successfully")
    
    def test_record_arrival(self, auth_session):
        """Test PUT /api/purchase-orders/{id}/arrival records transport details"""
        # Create and approve PO
        po_data = {
            "supplier_name": "TEST_Arrival_PO",
            "items": [{"name": "Test Item", "qty": 1, "unit_price": 100}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/purchase-orders", json=po_data)
        po_id = create_resp.json()["id"]
        auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/approve")
        
        # Record arrival
        arrival_data = {
            "transporter": "ABC Transport",
            "vehicle": "TN01AB1234",
            "driver_contact": "9876543213",
            "lr_number": "LR-001"
        }
        arrival_resp = auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/arrival", json=arrival_data)
        assert arrival_resp.status_code == 200
        
        # Verify status and transport
        list_resp = auth_session.get(f"{BASE_URL}/api/purchase-orders")
        po = next((p for p in list_resp.json() if p["id"] == po_id), None)
        assert po["status"] == "arrived"
        assert po["transport"]["transporter"] == "ABC Transport"
        print("✓ Arrival recorded with transport details")
    
    def test_complete_qc(self, auth_session):
        """Test PUT /api/purchase-orders/{id}/qc records QC check"""
        # Create, approve, and record arrival
        po_data = {
            "supplier_name": "TEST_QC_PO",
            "items": [{"name": "Test Item", "qty": 1, "unit_price": 100}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/purchase-orders", json=po_data)
        po_id = create_resp.json()["id"]
        auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/approve")
        auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/arrival", json={"transporter": "Test"})
        
        # Complete QC
        qc_data = {
            "qty_check": "pass",
            "damage_check": "pass",
            "spec_match": "pass",
            "overall": "pass"
        }
        qc_resp = auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/qc", json=qc_data)
        assert qc_resp.status_code == 200
        
        # Verify status and QC
        list_resp = auth_session.get(f"{BASE_URL}/api/purchase-orders")
        po = next((p for p in list_resp.json() if p["id"] == po_id), None)
        assert po["status"] == "qc_done"
        assert po["qc"]["overall"] == "pass"
        print("✓ QC check completed")
    
    def test_complete_inbound(self, auth_session):
        """Test PUT /api/purchase-orders/{id}/inbound completes PO"""
        # Full workflow
        po_data = {
            "supplier_name": "TEST_Inbound_PO",
            "items": [{"name": "Test Item", "qty": 1, "unit_price": 100}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/purchase-orders", json=po_data)
        po_id = create_resp.json()["id"]
        auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/approve")
        auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/arrival", json={"transporter": "Test"})
        auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/qc", json={"overall": "pass"})
        
        # Complete inbound
        inbound_data = {"storage_location": "A/2/3/1/5"}
        inbound_resp = auth_session.put(f"{BASE_URL}/api/purchase-orders/{po_id}/inbound", json=inbound_data)
        assert inbound_resp.status_code == 200
        
        # Verify status and location
        list_resp = auth_session.get(f"{BASE_URL}/api/purchase-orders")
        po = next((p for p in list_resp.json() if p["id"] == po_id), None)
        assert po["status"] == "completed"
        assert po["storage_location"] == "A/2/3/1/5"
        print("✓ Inbound completed with storage location")
    
    def test_po_status_filter(self, auth_session):
        """Test filtering POs by status"""
        pending_resp = auth_session.get(f"{BASE_URL}/api/purchase-orders", params={"status": "pending"})
        assert pending_resp.status_code == 200
        
        approved_resp = auth_session.get(f"{BASE_URL}/api/purchase-orders", params={"status": "approved"})
        assert approved_resp.status_code == 200
        
        completed_resp = auth_session.get(f"{BASE_URL}/api/purchase-orders", params={"status": "completed"})
        assert completed_resp.status_code == 200
        print("✓ PO status filters work correctly")


class TestDeliveryOutbound:
    """Delivery Outbound module tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_list_deliveries(self, auth_session):
        """Test GET /api/deliveries returns list"""
        response = auth_session.get(f"{BASE_URL}/api/deliveries")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Deliveries list returned {len(data)} items")
    
    def test_create_delivery(self, auth_session):
        """Test POST /api/deliveries creates delivery"""
        delivery_data = {
            "customer_name": "TEST_Delivery_Customer",
            "customer_address": "123 Test Street",
            "customer_contact": "9876543214",
            "items": [
                {"name": "Solar Panel 540W", "qty": 5},
                {"name": "Inverter 5kW", "qty": 1}
            ],
            "transporter_name": "XYZ Logistics",
            "vehicle_number": "TN02CD5678",
            "driver_contact": "9876543215",
            "dispatch_date": "2026-01-20",
            "delivery_date": "2026-01-22",
            "distance_km": 150,
            "notes": "Test delivery"
        }
        response = auth_session.post(f"{BASE_URL}/api/deliveries", json=delivery_data)
        assert response.status_code == 200, f"Create delivery failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["message"] == "Delivery created"
        print(f"✓ Delivery created with ID: {data['id']}")
    
    def test_delivery_appears_in_list(self, auth_session):
        """Test created delivery appears in list"""
        # Create delivery
        delivery_data = {
            "customer_name": "TEST_Delivery_List_Check",
            "items": [{"name": "Test Item", "qty": 1}],
            "transporter_name": "Test Transport"
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/deliveries", json=delivery_data)
        delivery_id = create_resp.json()["id"]
        
        # Verify in list
        list_resp = auth_session.get(f"{BASE_URL}/api/deliveries")
        deliveries = list_resp.json()
        delivery = next((d for d in deliveries if d["id"] == delivery_id), None)
        assert delivery is not None
        assert delivery["status"] == "dispatched"
        print(f"✓ Delivery found in list with status: {delivery['status']}")
    
    def test_complete_delivery(self, auth_session):
        """Test PUT /api/deliveries/{id}/complete marks as delivered"""
        # Create delivery
        delivery_data = {
            "customer_name": "TEST_Complete_Delivery",
            "items": [{"name": "Test Item", "qty": 1}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/deliveries", json=delivery_data)
        delivery_id = create_resp.json()["id"]
        
        # Complete delivery
        complete_resp = auth_session.put(f"{BASE_URL}/api/deliveries/{delivery_id}/complete")
        assert complete_resp.status_code == 200
        
        # Verify status
        list_resp = auth_session.get(f"{BASE_URL}/api/deliveries")
        delivery = next((d for d in list_resp.json() if d["id"] == delivery_id), None)
        assert delivery["status"] == "delivered"
        print("✓ Delivery marked as completed")


class TestBrandReturns:
    """Brand Returns module tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_list_returns(self, auth_session):
        """Test GET /api/returns returns list"""
        response = auth_session.get(f"{BASE_URL}/api/returns")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Returns list returned {len(data)} items")
    
    def test_create_return_damage(self, auth_session):
        """Test POST /api/returns creates return with damage reason"""
        return_data = {
            "item_name": "TEST_Damaged_Panel",
            "quantity": 2,
            "reason": "damage",
            "supplier_name": "Panel Supplier Co",
            "notes": "Cracked during transport"
        }
        response = auth_session.post(f"{BASE_URL}/api/returns", json=return_data)
        assert response.status_code == 200, f"Create return failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["message"] == "Return created"
        print(f"✓ Return (damage) created with ID: {data['id']}")
    
    def test_create_return_excess(self, auth_session):
        """Test POST /api/returns creates return with excess reason"""
        return_data = {
            "item_name": "TEST_Excess_Cables",
            "quantity": 50,
            "reason": "excess",
            "notes": "Unused cables from project"
        }
        response = auth_session.post(f"{BASE_URL}/api/returns", json=return_data)
        assert response.status_code == 200
        print("✓ Return (excess) created")
    
    def test_create_return_defect(self, auth_session):
        """Test POST /api/returns creates return with defect reason"""
        return_data = {
            "item_name": "TEST_Defective_Inverter",
            "quantity": 1,
            "reason": "defect",
            "notes": "Manufacturing defect"
        }
        response = auth_session.post(f"{BASE_URL}/api/returns", json=return_data)
        assert response.status_code == 200
        print("✓ Return (defect) created")
    
    def test_return_appears_in_list(self, auth_session):
        """Test created return appears in list"""
        # Create return
        return_data = {
            "item_name": "TEST_Return_List_Check",
            "quantity": 1,
            "reason": "damage"
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/returns", json=return_data)
        return_id = create_resp.json()["id"]
        
        # Verify in list
        list_resp = auth_session.get(f"{BASE_URL}/api/returns")
        returns = list_resp.json()
        ret = next((r for r in returns if r["id"] == return_id), None)
        assert ret is not None
        assert ret["status"] == "pending"
        assert ret["reason"] == "damage"
        print(f"✓ Return found in list with status: {ret['status']}")
    
    def test_complete_return(self, auth_session):
        """Test PUT /api/returns/{id}/complete marks as completed"""
        # Create return
        return_data = {
            "item_name": "TEST_Complete_Return",
            "quantity": 1,
            "reason": "excess"
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/returns", json=return_data)
        return_id = create_resp.json()["id"]
        
        # Complete return
        complete_resp = auth_session.put(f"{BASE_URL}/api/returns/{return_id}/complete")
        assert complete_resp.status_code == 200
        
        # Verify status
        list_resp = auth_session.get(f"{BASE_URL}/api/returns")
        ret = next((r for r in list_resp.json() if r["id"] == return_id), None)
        assert ret["status"] == "completed"
        print("✓ Return marked as completed")


class TestWeeklyAudits:
    """Weekly Audits module tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_list_audits(self, auth_session):
        """Test GET /api/audits returns list"""
        response = auth_session.get(f"{BASE_URL}/api/audits")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Audits list returned {len(data)} items")
    
    def test_create_audit_with_checklist(self, auth_session):
        """Test POST /api/audits creates audit with checklist"""
        audit_data = {
            "title": "TEST_Weekly_Audit_001",
            "auditor_name": "Test Auditor",
            "deadline": "2026-01-25",
            "checklist": [
                {"item": "Safety Compliance", "status": "pending", "notes": ""},
                {"item": "Material Usage Accuracy", "status": "pending", "notes": ""},
                {"item": "Installation Quality", "status": "pending", "notes": ""},
                {"item": "Documentation Complete", "status": "pending", "notes": ""},
                {"item": "Site Cleanliness", "status": "pending", "notes": ""}
            ],
            "notes": "Test audit"
        }
        response = auth_session.post(f"{BASE_URL}/api/audits", json=audit_data)
        assert response.status_code == 200, f"Create audit failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["message"] == "Audit created"
        print(f"✓ Audit created with ID: {data['id']}")
    
    def test_audit_appears_in_list(self, auth_session):
        """Test created audit appears in list"""
        # Create audit
        audit_data = {
            "title": "TEST_Audit_List_Check",
            "auditor_name": "Test Auditor",
            "checklist": [{"item": "Test Check", "status": "pending"}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/audits", json=audit_data)
        audit_id = create_resp.json()["id"]
        
        # Verify in list
        list_resp = auth_session.get(f"{BASE_URL}/api/audits")
        audits = list_resp.json()
        audit = next((a for a in audits if a["id"] == audit_id), None)
        assert audit is not None
        assert audit["status"] == "open"
        assert len(audit["checklist"]) == 1
        print(f"✓ Audit found in list with status: {audit['status']}")
    
    def test_add_issue_to_audit(self, auth_session):
        """Test PUT /api/audits/{id}/issue adds issue"""
        # Create audit
        audit_data = {
            "title": "TEST_Audit_Issue",
            "auditor_name": "Test Auditor",
            "checklist": [{"item": "Test Check", "status": "pending"}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/audits", json=audit_data)
        audit_id = create_resp.json()["id"]
        
        # Add issue
        issue_data = {
            "description": "Safety violation found",
            "severity": "high",
            "fix_deadline": "2026-01-22"
        }
        issue_resp = auth_session.put(f"{BASE_URL}/api/audits/{audit_id}/issue", json=issue_data)
        assert issue_resp.status_code == 200
        
        # Verify issue added
        list_resp = auth_session.get(f"{BASE_URL}/api/audits")
        audit = next((a for a in list_resp.json() if a["id"] == audit_id), None)
        assert len(audit["issues"]) == 1
        assert audit["issues"][0]["description"] == "Safety violation found"
        assert audit["issues"][0]["severity"] == "high"
        print("✓ Issue added to audit")
    
    def test_change_audit_status_to_in_progress(self, auth_session):
        """Test PUT /api/audits/{id} changes status to in_progress"""
        # Create audit
        audit_data = {
            "title": "TEST_Audit_Status_Change",
            "auditor_name": "Test Auditor",
            "checklist": [{"item": "Test Check", "status": "pending"}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/audits", json=audit_data)
        audit_id = create_resp.json()["id"]
        
        # Change status
        update_resp = auth_session.put(f"{BASE_URL}/api/audits/{audit_id}", json={"status": "in_progress"})
        assert update_resp.status_code == 200
        
        # Verify status
        list_resp = auth_session.get(f"{BASE_URL}/api/audits")
        audit = next((a for a in list_resp.json() if a["id"] == audit_id), None)
        assert audit["status"] == "in_progress"
        print("✓ Audit status changed to in_progress")
    
    def test_change_audit_status_to_resolved(self, auth_session):
        """Test PUT /api/audits/{id} changes status to resolved"""
        # Create audit
        audit_data = {
            "title": "TEST_Audit_Resolve",
            "auditor_name": "Test Auditor",
            "checklist": [{"item": "Test Check", "status": "pass"}]
        }
        create_resp = auth_session.post(f"{BASE_URL}/api/audits", json=audit_data)
        audit_id = create_resp.json()["id"]
        
        # Change to in_progress then resolved
        auth_session.put(f"{BASE_URL}/api/audits/{audit_id}", json={"status": "in_progress"})
        auth_session.put(f"{BASE_URL}/api/audits/{audit_id}", json={"status": "resolved"})
        
        # Verify status
        list_resp = auth_session.get(f"{BASE_URL}/api/audits")
        audit = next((a for a in list_resp.json() if a["id"] == audit_id), None)
        assert audit["status"] == "resolved"
        print("✓ Audit status changed to resolved")
    
    def test_audit_status_filter(self, auth_session):
        """Test filtering audits by status"""
        open_resp = auth_session.get(f"{BASE_URL}/api/audits", params={"status": "open"})
        assert open_resp.status_code == 200
        
        in_progress_resp = auth_session.get(f"{BASE_URL}/api/audits", params={"status": "in_progress"})
        assert in_progress_resp.status_code == 200
        
        resolved_resp = auth_session.get(f"{BASE_URL}/api/audits", params={"status": "resolved"})
        assert resolved_resp.status_code == 200
        print("✓ Audit status filters work correctly")


class TestSidebarNavLinks:
    """Test sidebar navigation links exist"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return session
    
    def test_credits_endpoint_accessible(self, auth_session):
        """Test /api/credits endpoint is accessible"""
        response = auth_session.get(f"{BASE_URL}/api/credits")
        assert response.status_code == 200
        print("✓ Credits endpoint accessible")
    
    def test_purchase_orders_endpoint_accessible(self, auth_session):
        """Test /api/purchase-orders endpoint is accessible"""
        response = auth_session.get(f"{BASE_URL}/api/purchase-orders")
        assert response.status_code == 200
        print("✓ Purchase orders endpoint accessible")
    
    def test_deliveries_endpoint_accessible(self, auth_session):
        """Test /api/deliveries endpoint is accessible"""
        response = auth_session.get(f"{BASE_URL}/api/deliveries")
        assert response.status_code == 200
        print("✓ Deliveries endpoint accessible")
    
    def test_returns_endpoint_accessible(self, auth_session):
        """Test /api/returns endpoint is accessible"""
        response = auth_session.get(f"{BASE_URL}/api/returns")
        assert response.status_code == 200
        print("✓ Returns endpoint accessible")
    
    def test_audits_endpoint_accessible(self, auth_session):
        """Test /api/audits endpoint is accessible"""
        response = auth_session.get(f"{BASE_URL}/api/audits")
        assert response.status_code == 200
        print("✓ Audits endpoint accessible")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])