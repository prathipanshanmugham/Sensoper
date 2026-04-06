# Sensoper Controls & Renewables - Solar Project Cost Estimator

## Original Problem Statement
Build a production-ready web application for "Sensoper Controls and Renewables" - a Solar Project Cost Estimator platform used by field staff, managers, and admin teams to collect site data, estimate solar project costs, and generate professional quotations in PDF format.

### Enterprise Enhancements (Phase 2)
1. Dynamic Terms & Conditions (Admin controlled with version control)
2. Inventory Management with location codes
3. Project Deletion Approval Workflow + Audit Logs

### Company Branding & PDF (Phase 3)
1. Dynamic Company Profile Management (Admin)
2. Advanced Multi-page PDF Quotation with jspdf-autotable
3. Logo Upload for Company Profile

## Architecture & Tech Stack
- **Frontend**: React.js + Tailwind CSS + Shadcn UI
- **Backend**: FastAPI (Python) with MongoDB
- **Authentication**: JWT-based with role-based access (Admin, Manager, Staff)
- **PDF Generation**: jsPDF + jspdf-autotable with dynamic company branding
- **AI**: OpenAI GPT-5.2 (via Emergent LLM Key) for solar recommendations

## User Personas
1. **Admin**: Full access - user management, pricing config, inventory, terms, audit logs, company profile
2. **Manager**: Review submissions, approve/reject/complete projects, inventory, terms, deletion approvals
3. **Staff**: Create site visits, view own projects, request deletions (requires approval)

## Core Requirements (Static)
- Role-based authentication with JWT
- Multi-step site visit data collection form
- Dynamic cost estimation engine
- Project workflow (Draft > Submitted > Approved/Rejected > Completed)
- PDF quotation generation with company branding
- Admin pricing configuration
- User management (Admin only)
- Dashboard with project statistics

## Enterprise Features
- Terms & Conditions version control with HTML editor
- Inventory management with locations, items, categories
- Project deletion workflow with manager approval
- Comprehensive audit logging system

## Company Branding Features
- Company Profile CRUD with Basic Info, Branding, and Bank Details tabs
- Logo upload (base64 data URL or external URL)
- Dynamic branding colors (primary/secondary) in PDF
- Authorized signatory and designation in PDF
- Bank details section in PDF for payment reference
- Multi-page PDF with consistent headers/footers on every page

## What's Been Implemented

### Backend (100% Complete)
- [x] JWT authentication with role-based access
- [x] User management CRUD (Admin only)
- [x] Project CRUD with workflow status
- [x] Cost estimation engine with configurable pricing
- [x] Pricing configuration endpoints
- [x] Dashboard statistics API
- [x] AI-powered solar recommendations
- [x] Brute force protection for login
- [x] Terms & Conditions API (create, update, activate, version control)
- [x] Inventory Locations API (create, delete, list)
- [x] Inventory Items API (CRUD with categories, stock tracking)
- [x] Low Stock Alerts API
- [x] Deletion Requests API (request, approve, reject)
- [x] Audit Logs API (filter by entity/action)
- [x] Soft delete for projects
- [x] Company Profile CRUD API (create, update, delete, toggle active)
- [x] Logo Upload API (base64 data URL)
- [x] Active Company Profile API (for PDF generation)

### Frontend (100% Complete)
- [x] Login/Register pages
- [x] Dashboard with stats and alert banners
- [x] Multi-step site visit form (4 steps)
- [x] Project list with search and filtering
- [x] Project details with cost breakdown
- [x] Project workflow actions (submit, approve, reject, complete)
- [x] Advanced PDF quotation with jspdf-autotable, dynamic company branding, multi-page support
- [x] Terms & Conditions Management
- [x] Inventory Management
- [x] Deletion Approvals Panel
- [x] Audit Logs Viewer
- [x] Company Profile Management (Basic Info, Branding with logo upload, Bank Details)
- [x] Updated navigation for all features

### Database Schema (MongoDB Collections)
- users
- projects
- pricing_config
- login_attempts
- terms_conditions
- inventory_locations
- inventory_items
- inventory_transactions
- deletion_requests
- audit_logs
- company_profiles

## Permissions Matrix

| Feature | Staff | Manager | Admin |
|---------|-------|---------|-------|
| Create Projects | Y | Y | Y |
| View Own Projects | Y | Y | Y |
| View All Projects | - | Y | Y |
| Submit Projects | Y | Y | Y |
| Approve/Reject | - | Y | Y |
| Request Deletion | Y (own) | - | - |
| Approve Deletions | - | Y | Y |
| Force Delete | - | - | Y |
| Manage Inventory | - | Y | Y |
| Manage Terms | - | Y | Y |
| View Audit Logs | - | Limited | Y |
| Manage Users | - | - | Y |
| Configure Pricing | - | - | Y |
| Company Profile | - | - | Y |

## Test Credentials
- Admin: admin@sensoper.com / Admin@123

## Prioritized Backlog

### P0 - Completed
- All core features implemented and tested
- All enterprise features implemented and tested
- Company Profile + Advanced PDF implemented and tested

### P1 - Pending (User Action Required)
- [ ] Google Maps integration (requires API key from user)
- [ ] Google Drive integration for image uploads (requires OAuth setup)

### P2 - Future Enhancements
- [ ] Offline mode (PWA support) for field staff
- [ ] WhatsApp Business API integration for quote sharing
- [ ] Auto deduction of inventory when project approved
- [ ] Voice input for site data
- [ ] Email integration for quote sharing
- [ ] CRM follow-up reminders
- [ ] Advanced analytics dashboard
- [ ] Export data to Excel
