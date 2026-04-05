# Sensoper Controls & Renewables - Solar Project Cost Estimator

## Original Problem Statement
Build a production-ready web application for "Sensoper Controls and Renewables" - a Solar Project Cost Estimator platform used by field staff, managers, and admin teams to collect site data, estimate solar project costs, and generate professional quotations in PDF format.

### Enterprise Enhancements (Phase 2)
1. Dynamic Terms & Conditions (Admin controlled with version control)
2. Inventory Management with location codes
3. Project Deletion Approval Workflow + Audit Logs

## Architecture & Tech Stack
- **Frontend**: React.js + Tailwind CSS + Shadcn UI
- **Backend**: FastAPI (Python) with MongoDB
- **Authentication**: JWT-based with role-based access (Admin, Manager, Staff)
- **PDF Generation**: jsPDF with dynamic terms from backend
- **AI**: OpenAI GPT-5.2 (via Emergent LLM Key) for solar recommendations

## User Personas
1. **Admin**: Full access - user management, pricing config, inventory, terms, audit logs
2. **Manager**: Review submissions, approve/reject/complete projects, inventory, terms, deletion approvals
3. **Staff**: Create site visits, view own projects, request deletions (requires approval)

## Core Requirements (Static)
- Role-based authentication with JWT
- Multi-step site visit data collection form
- Dynamic cost estimation engine
- Project workflow (Draft → Submitted → Approved/Rejected → Completed)
- PDF quotation generation with company branding
- Admin pricing configuration
- User management (Admin only)
- Dashboard with project statistics

## Enterprise Features (New)
- Terms & Conditions version control with HTML editor
- Inventory management with locations, items, categories
- Project deletion workflow with manager approval
- Comprehensive audit logging system

## What's Been Implemented (April 5, 2026)

### Backend (100% Complete - 22/22 Tests Passed)
- [x] JWT authentication with role-based access
- [x] User management CRUD (Admin only)
- [x] Project CRUD with workflow status
- [x] Cost estimation engine with configurable pricing
- [x] Pricing configuration endpoints
- [x] Dashboard statistics API
- [x] AI-powered solar recommendations
- [x] Brute force protection for login
- [x] **Terms & Conditions API** (create, update, activate, version control)
- [x] **Inventory Locations API** (create, delete, list)
- [x] **Inventory Items API** (CRUD with categories, stock tracking)
- [x] **Low Stock Alerts API**
- [x] **Deletion Requests API** (request, approve, reject)
- [x] **Audit Logs API** (filter by entity/action)
- [x] Soft delete for projects

### Frontend (100% Complete)
- [x] Login/Register pages
- [x] Dashboard with stats and alert banners (deletions, low stock)
- [x] Multi-step site visit form (4 steps)
- [x] Project list with search and filtering
- [x] Project details with cost breakdown
- [x] Project workflow actions (submit, approve, reject, complete)
- [x] PDF quotation with **dynamic terms from backend**
- [x] **Terms & Conditions Management** (create, edit, activate versions)
- [x] **Inventory Management** (Items tab, Locations tab, filters, search)
- [x] **Deletion Approvals Panel** (approve/reject requests)
- [x] **Audit Logs Viewer** (entity/action filters)
- [x] Updated navigation for enterprise features

### Database Schema (MongoDB Collections)
- users
- projects
- pricing_config
- login_attempts
- **terms_conditions** (title, content, version, is_active, language)
- **inventory_locations** (code, name, address)
- **inventory_items** (name, sku_code, category, location_code, quantity, unit_price, supplier, gst_percentage, reorder_level)
- **inventory_transactions** (item_id, type, quantity, notes, timestamp)
- **deletion_requests** (project_id, requested_by, reason, status, resolved_by)
- **audit_logs** (user_id, action_type, entity_type, entity_id, old_data, new_data, timestamp)

## Prioritized Backlog

### P0 - Completed
- All core features implemented and tested
- All enterprise features implemented and tested

### P1 - Pending (User Action Required)
- [ ] Google Maps integration (requires API key from user)
- [ ] Google Drive integration for image uploads (requires OAuth setup)
- [ ] Company logo integration in PDF (logo URL provided)

### P2 - Future Enhancements
- [ ] Offline mode (PWA support) for field staff
- [ ] Voice input for site data
- [ ] Email integration for quote sharing
- [ ] CRM follow-up reminders
- [ ] Advanced analytics dashboard
- [ ] Export data to Excel
- [ ] Auto deduction of inventory when project approved

## Permissions Matrix

| Feature | Staff | Manager | Admin |
|---------|-------|---------|-------|
| Create Projects | ✓ | ✓ | ✓ |
| View Own Projects | ✓ | ✓ | ✓ |
| View All Projects | - | ✓ | ✓ |
| Submit Projects | ✓ | ✓ | ✓ |
| Approve/Reject | - | ✓ | ✓ |
| Request Deletion | ✓ (own) | - | - |
| Approve Deletions | - | ✓ | ✓ |
| Force Delete | - | - | ✓ |
| Manage Inventory | - | ✓ | ✓ |
| Manage Terms | - | ✓ | ✓ |
| View Audit Logs | - | Limited | ✓ |
| Manage Users | - | - | ✓ |
| Configure Pricing | - | - | ✓ |

## Test Credentials
- Admin: admin@sensoper.com / Admin@123

## API Endpoints Summary

### Authentication
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
- POST /api/auth/refresh

### Projects
- GET/POST /api/projects
- GET/PUT/DELETE /api/projects/{id}
- POST /api/projects/{id}/submit
- POST /api/projects/{id}/approve
- POST /api/projects/{id}/reject
- POST /api/projects/{id}/complete
- POST /api/projects/{id}/request-deletion
- DELETE /api/projects/{id}/force

### Terms & Conditions
- GET /api/terms
- GET /api/terms/active
- POST /api/terms
- PUT /api/terms/{id}
- DELETE /api/terms/{id}

### Inventory
- GET/POST /api/inventory/locations
- DELETE /api/inventory/locations/{id}
- GET/POST /api/inventory/items
- GET/PUT/DELETE /api/inventory/items/{id}
- GET /api/inventory/alerts

### Deletion Requests
- GET /api/deletion-requests
- POST /api/deletion-requests/{id}/approve
- POST /api/deletion-requests/{id}/reject

### Audit Logs
- GET /api/audit-logs

### Other
- GET/PUT /api/pricing
- GET/POST /api/users
- PUT/DELETE /api/users/{id}
- GET /api/dashboard/stats
- POST /api/ai/recommendations
