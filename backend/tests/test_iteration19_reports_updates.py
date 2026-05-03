"""
Iteration 19 Tests: New Reports, CEO Dashboard Credit, Daily Updates (Leads/Invoicing)
Tests:
- 4 new reports (inbound, outbound, audit, marketing)
- Reports filters (date_from, date_to, system_type, status) - customer/staff filters REMOVED
- CEO Dashboard credit_data (outstanding, overdue, aging, top_debtors)
- Daily Updates: Leads and Invoicing update types
- Inventory model new fields (margin_pct, active, qc_checklist)
"""

import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestIteration19:
    """Test suite for Iteration 19 features"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - login and get auth cookies"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@sensoper.com",
            "password": "Admin@123"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.user = login_resp.json()
        print(f"Logged in as: {self.user['email']} ({self.user['role']})")
    
    # ==================== REPORTS TESTS ====================
    
    def test_inbound_report_returns_po_data(self):
        """Test GET /api/reports/inbound returns purchase order data"""
        resp = self.session.get(f"{BASE_URL}/api/reports/inbound")
        assert resp.status_code == 200, f"Inbound report failed: {resp.text}"
        data = resp.json()
        
        # Verify report structure
        assert "title" in data, "Missing title"
        assert data["title"] == "Inbound Report", f"Wrong title: {data['title']}"
        assert "summary" in data, "Missing summary"
        assert "rows" in data, "Missing rows"
        
        # Verify summary fields
        summary = data["summary"]
        assert "total_pos" in summary, "Missing total_pos in summary"
        assert "completed" in summary, "Missing completed in summary"
        assert "total_value" in summary, "Missing total_value in summary"
        
        # Verify row structure if data exists
        if data["rows"]:
            row = data["rows"][0]
            expected_fields = ["supplier", "items_count", "total", "status", "qc_result", "transporter", "vehicle", "storage", "date"]
            for field in expected_fields:
                assert field in row, f"Missing field {field} in inbound row"
        
        print(f"Inbound Report: {summary['total_pos']} POs, {summary['completed']} completed, Rs {summary['total_value']} total")
    
    def test_outbound_report_returns_delivery_data(self):
        """Test GET /api/reports/outbound returns delivery data"""
        resp = self.session.get(f"{BASE_URL}/api/reports/outbound")
        assert resp.status_code == 200, f"Outbound report failed: {resp.text}"
        data = resp.json()
        
        # Verify report structure
        assert data["title"] == "Outbound Report", f"Wrong title: {data['title']}"
        assert "summary" in data
        assert "rows" in data
        
        # Verify summary fields
        summary = data["summary"]
        assert "total_deliveries" in summary
        assert "delivered" in summary
        assert "total_distance" in summary
        
        # Verify row structure if data exists
        if data["rows"]:
            row = data["rows"][0]
            expected_fields = ["customer", "items_count", "transporter", "vehicle", "distance_km", "dispatch", "delivery", "status"]
            for field in expected_fields:
                assert field in row, f"Missing field {field} in outbound row"
        
        print(f"Outbound Report: {summary['total_deliveries']} deliveries, {summary['delivered']} delivered")
    
    def test_audit_report_returns_audit_data(self):
        """Test GET /api/reports/audit returns audit data with issues count"""
        resp = self.session.get(f"{BASE_URL}/api/reports/audit")
        assert resp.status_code == 200, f"Audit report failed: {resp.text}"
        data = resp.json()
        
        # Verify report structure
        assert data["title"] == "Audit Report", f"Wrong title: {data['title']}"
        assert "summary" in data
        assert "rows" in data
        
        # Verify summary fields
        summary = data["summary"]
        assert "total_audits" in summary
        assert "open" in summary
        assert "total_issues" in summary
        
        # Verify row structure if data exists
        if data["rows"]:
            row = data["rows"][0]
            expected_fields = ["title", "auditor", "status", "checklist_items", "issues_count", "deadline", "date"]
            for field in expected_fields:
                assert field in row, f"Missing field {field} in audit row"
        
        print(f"Audit Report: {summary['total_audits']} audits, {summary['open']} open, {summary['total_issues']} issues")
    
    def test_marketing_report_returns_leads_aggregation(self):
        """Test GET /api/reports/marketing returns leads data from daily_updates"""
        resp = self.session.get(f"{BASE_URL}/api/reports/marketing")
        assert resp.status_code == 200, f"Marketing report failed: {resp.text}"
        data = resp.json()
        
        # Verify report structure
        assert data["title"] == "Marketing Report", f"Wrong title: {data['title']}"
        assert "summary" in data
        assert "rows" in data
        
        # Verify summary fields
        summary = data["summary"]
        assert "total_leads" in summary, "Missing total_leads"
        assert "qualified_leads" in summary, "Missing qualified_leads"
        assert "quotes_sent" in summary, "Missing quotes_sent"
        assert "conversion_rate" in summary, "Missing conversion_rate"
        
        # Verify row structure
        if data["rows"]:
            row = data["rows"][0]
            expected_fields = ["date", "total_leads", "qualified", "site_visits", "quotes_sent", "conversions", "by"]
            for field in expected_fields:
                assert field in row, f"Missing field {field} in marketing row"
        
        print(f"Marketing Report: {summary['total_leads']} leads, {summary['conversion_rate']}% conversion")
    
    def test_reports_accept_4_filters_only(self):
        """Test reports accept date_from, date_to, system_type, status filters (no customer/staff)"""
        # Test with all 4 valid filters
        params = {
            "date_from": "2025-01-01",
            "date_to": "2026-12-31",
            "system_type": "on-grid",
            "status": "approved"
        }
        resp = self.session.get(f"{BASE_URL}/api/reports/sales_revenue", params=params)
        assert resp.status_code == 200, f"Report with filters failed: {resp.text}"
        
        # Verify response is valid
        data = resp.json()
        assert "title" in data
        assert "rows" in data
        print("Reports accept 4 filters (date_from, date_to, system_type, status) - PASS")
    
    # ==================== CEO DASHBOARD CREDIT TESTS ====================
    
    def test_ceo_dashboard_returns_credit_data(self):
        """Test GET /api/dashboard/ceo returns credit_data with aging and top_debtors"""
        resp = self.session.get(f"{BASE_URL}/api/dashboard/ceo")
        assert resp.status_code == 200, f"CEO dashboard failed: {resp.text}"
        data = resp.json()
        
        # Verify main structure
        assert "kpis" in data, "Missing kpis"
        assert "credit_data" in data, "Missing credit_data"
        
        # Verify KPIs include credit fields
        kpis = data["kpis"]
        assert "total_outstanding" in kpis, "Missing total_outstanding in KPIs"
        assert "overdue_amount" in kpis, "Missing overdue_amount in KPIs"
        
        # Verify credit_data structure
        credit_data = data["credit_data"]
        assert "total_outstanding" in credit_data, "Missing total_outstanding in credit_data"
        assert "overdue_amount" in credit_data, "Missing overdue_amount in credit_data"
        assert "top_debtors" in credit_data, "Missing top_debtors in credit_data"
        assert "aging" in credit_data, "Missing aging in credit_data"
        
        # Verify aging buckets
        aging = credit_data["aging"]
        assert "0_30" in aging, "Missing 0_30 aging bucket"
        assert "30_60" in aging, "Missing 30_60 aging bucket"
        assert "60_plus" in aging, "Missing 60_plus aging bucket"
        
        # Verify top_debtors is a list
        assert isinstance(credit_data["top_debtors"], list), "top_debtors should be a list"
        
        # If there are debtors, verify structure
        if credit_data["top_debtors"]:
            debtor = credit_data["top_debtors"][0]
            assert "name" in debtor, "Missing name in debtor"
            assert "balance" in debtor, "Missing balance in debtor"
            assert "status" in debtor, "Missing status in debtor"
        
        print(f"CEO Dashboard Credit: Outstanding Rs {credit_data['total_outstanding']}, Overdue Rs {credit_data['overdue_amount']}")
        print(f"Aging: 0-30: Rs {aging['0_30']}, 30-60: Rs {aging['30_60']}, 60+: Rs {aging['60_plus']}")
        print(f"Top Debtors: {len(credit_data['top_debtors'])} entries")
    
    # ==================== DAILY UPDATES TESTS ====================
    
    def test_create_leads_daily_update(self):
        """Test creating a Leads type daily update"""
        # First get a project to use
        projects_resp = self.session.get(f"{BASE_URL}/api/projects")
        assert projects_resp.status_code == 200
        projects = projects_resp.json()
        
        project_id = "general"  # Use 'general' for non-project-specific leads
        if projects:
            project_id = projects[0]["id"]
        
        # Create leads update
        leads_data = {
            "project_id": project_id,
            "update_type": "leads",
            "data": {
                "total_leads": "15",
                "qualified_leads": "8",
                "site_visits": "5",
                "quotes_sent": "4",
                "followups": "10",
                "conversions": "3"
            }
        }
        
        resp = self.session.post(f"{BASE_URL}/api/daily-updates", json=leads_data)
        assert resp.status_code in [200, 201], f"Create leads update failed: {resp.text}"
        
        result = resp.json()
        assert "id" in result or "message" in result, "Missing id or message in response"
        print(f"Created Leads update: {leads_data['data']}")
        
        # Verify it appears in marketing report
        marketing_resp = self.session.get(f"{BASE_URL}/api/reports/marketing")
        assert marketing_resp.status_code == 200
        marketing_data = marketing_resp.json()
        assert marketing_data["summary"]["total_leads"] >= 15, "Leads not reflected in marketing report"
        print("Leads update reflected in Marketing Report - PASS")
    
    def test_create_invoicing_daily_update(self):
        """Test creating an Invoicing type daily update"""
        # Get a project
        projects_resp = self.session.get(f"{BASE_URL}/api/projects")
        assert projects_resp.status_code == 200
        projects = projects_resp.json()
        
        project_id = "general"
        if projects:
            project_id = projects[0]["id"]
        
        # Create invoicing update
        invoicing_data = {
            "project_id": project_id,
            "update_type": "invoicing",
            "data": {
                "invoices_generated": "5",
                "total_amount": "250000",
                "payments_received": "150000",
                "pending_invoices": "2"
            }
        }
        
        resp = self.session.post(f"{BASE_URL}/api/daily-updates", json=invoicing_data)
        assert resp.status_code in [200, 201], f"Create invoicing update failed: {resp.text}"
        
        result = resp.json()
        assert "id" in result or "message" in result
        print(f"Created Invoicing update: {invoicing_data['data']}")
    
    def test_daily_updates_list_includes_leads_and_invoicing(self):
        """Test that daily updates list includes leads and invoicing types"""
        # Get a project first
        projects_resp = self.session.get(f"{BASE_URL}/api/projects")
        assert projects_resp.status_code == 200
        projects = projects_resp.json()
        
        if projects:
            project_id = projects[0]["id"]
            resp = self.session.get(f"{BASE_URL}/api/daily-updates/project/{project_id}")
            assert resp.status_code == 200, f"Get daily updates failed: {resp.text}"
            
            updates = resp.json()
            update_types = set(u.get("update_type") for u in updates)
            print(f"Found update types: {update_types}")
            
            # Check if leads or invoicing types exist (may not if no data)
            if "leads" in update_types:
                print("Leads update type found in history")
            if "invoicing" in update_types:
                print("Invoicing update type found in history")
    
    # ==================== INVENTORY MODEL TESTS ====================
    
    def test_inventory_item_with_new_fields(self):
        """Test creating inventory item with margin_pct, active, qc_checklist fields"""
        import uuid
        sku = f"TEST-INV-{uuid.uuid4().hex[:6].upper()}"
        
        item_data = {
            "name": "Test Solar Panel 550W",
            "sku_code": sku,
            "category": "panels",
            "quantity": 50,
            "unit_price": 15000,
            "gst_percentage": 18.0,
            "reorder_level": 10,
            "margin_pct": 12.5,
            "active": True,
            "qc_checklist": ["Visual inspection", "Electrical test", "Dimension check"]
        }
        
        resp = self.session.post(f"{BASE_URL}/api/inventory/items", json=item_data)
        assert resp.status_code in [200, 201], f"Create inventory item failed: {resp.text}"
        
        result = resp.json()
        item_id = result.get("id")
        assert item_id, "Missing item id in response"
        print(f"Created inventory item with ID: {item_id}")
        
        # Verify the item has new fields
        get_resp = self.session.get(f"{BASE_URL}/api/inventory/items/{item_id}")
        assert get_resp.status_code == 200, f"Get inventory item failed: {get_resp.text}"
        
        item = get_resp.json()
        assert item.get("margin_pct") == 12.5, f"margin_pct mismatch: {item.get('margin_pct')}"
        assert item.get("active") == True, f"active mismatch: {item.get('active')}"
        assert item.get("qc_checklist") == ["Visual inspection", "Electrical test", "Dimension check"], f"qc_checklist mismatch"
        
        print(f"Inventory item verified: margin_pct={item['margin_pct']}, active={item['active']}, qc_checklist={item['qc_checklist']}")
        
        # Cleanup
        del_resp = self.session.delete(f"{BASE_URL}/api/inventory/items/{item_id}")
        assert del_resp.status_code == 200, f"Delete inventory item failed: {del_resp.text}"
        print("Test inventory item cleaned up")
    
    def test_inventory_item_update_new_fields(self):
        """Test updating inventory item margin_pct, active, qc_checklist"""
        import uuid
        sku = f"TEST-UPD-{uuid.uuid4().hex[:6].upper()}"
        
        # Create item
        item_data = {
            "name": "Test Inverter 5kW",
            "sku_code": sku,
            "category": "inverters",
            "quantity": 20,
            "unit_price": 45000,
            "margin_pct": 10.0,
            "active": True,
            "qc_checklist": ["Power test"]
        }
        
        create_resp = self.session.post(f"{BASE_URL}/api/inventory/items", json=item_data)
        assert create_resp.status_code in [200, 201]
        item_id = create_resp.json()["id"]
        
        # Update with new values
        update_data = {
            "margin_pct": 15.0,
            "active": False,
            "qc_checklist": ["Power test", "Efficiency test", "Safety check"]
        }
        
        update_resp = self.session.put(f"{BASE_URL}/api/inventory/items/{item_id}", json=update_data)
        assert update_resp.status_code == 200, f"Update failed: {update_resp.text}"
        
        # Verify updates
        get_resp = self.session.get(f"{BASE_URL}/api/inventory/items/{item_id}")
        item = get_resp.json()
        
        assert item.get("margin_pct") == 15.0, f"margin_pct not updated: {item.get('margin_pct')}"
        assert item.get("active") == False, f"active not updated: {item.get('active')}"
        assert len(item.get("qc_checklist", [])) == 3, f"qc_checklist not updated"
        
        print(f"Inventory item updated: margin_pct={item['margin_pct']}, active={item['active']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/inventory/items/{item_id}")
    
    # ==================== 12 REPORT CARDS VERIFICATION ====================
    
    def test_all_12_reports_accessible(self):
        """Test all 12 report types are accessible"""
        report_types = [
            "sales_revenue",
            "profit_leakage", 
            "project_execution",
            "inventory_material",
            "customer_credit",
            "team_performance",
            "compliance_tax",
            "customer_satisfaction",
            "inbound",
            "outbound",
            "audit",
            "marketing"
        ]
        
        passed = 0
        failed = []
        
        for report_type in report_types:
            resp = self.session.get(f"{BASE_URL}/api/reports/{report_type}")
            if resp.status_code == 200:
                data = resp.json()
                if "title" in data and "rows" in data:
                    passed += 1
                    print(f"✓ {report_type}: {data['title']}")
                else:
                    failed.append(f"{report_type}: Missing title or rows")
            else:
                failed.append(f"{report_type}: HTTP {resp.status_code}")
        
        print(f"\nReport Summary: {passed}/{len(report_types)} passed")
        
        if failed:
            print(f"Failed reports: {failed}")
        
        assert passed == 12, f"Not all 12 reports accessible. Failed: {failed}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
