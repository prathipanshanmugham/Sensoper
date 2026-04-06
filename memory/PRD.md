# Sensoper Controls & Renewables - Solar Project Cost Estimator

## Original Problem Statement
Build a production-ready web application for "Sensoper Controls and Renewables" - a Solar Project Cost Estimator platform used by field staff, managers, and admin teams to collect site data, estimate solar project costs, and generate professional quotations in PDF format.

## Architecture & Tech Stack
- **Frontend**: React.js + Tailwind CSS + Shadcn UI (Light Theme)
- **Backend**: FastAPI (Python) with MongoDB
- **Authentication**: JWT-based with role-based access (Admin, Manager, Staff)
- **PDF Generation**: jsPDF + jspdf-autotable (light theme, no margin display, grid borders)
- **AI**: OpenAI GPT-5.2 (via Emergent LLM Key) for solar recommendations

## User Personas
1. **Admin**: Full access — user management, inventory, terms, audit logs, company profile
2. **Manager**: Review submissions, approve/reject/complete projects, inventory, terms, deletion approvals
3. **Staff**: Create site visits, view own projects, request deletions

## What's Been Implemented (All Complete)

### Core Features
- [x] JWT auth with role-based access + brute force protection
- [x] Multi-step site visit form (Customer, Location/What3Words, Electrical, Materials & Cost)
- [x] Inventory-based cost estimation (items selected from inventory dropdowns + manual costs)
- [x] Project workflow (Draft > Submitted > Approved/Rejected > Completed)
- [x] Dashboard with stats, alerts, and recent projects table
- [x] User management (Admin only)

### Enterprise Features
- [x] Terms & Conditions with version control and HTML editor
- [x] Inventory Management with warehouse hierarchy (Zone/Aisle/Shelf/Rack/Bin)
- [x] Project deletion workflow with manager approval
- [x] Audit logging system
- [x] Company Profile Management (Basic Info, Branding with logo upload, Bank Details)

### PDF & Branding
- [x] Advanced multi-page PDF quotation with jspdf-autotable
- [x] Light/white theme PDF (no dark backgrounds)
- [x] Dynamic company branding (logo, colors, bank details, signatory)
- [x] Margin is internal only — NOT displayed in customer PDF
- [x] Grid borders for readability, right-aligned currency

### Recent Refactoring (April 2026)
- [x] Removed Pricing Config module — costs now come from inventory items
- [x] Replaced location codes with warehouse hierarchy (Zone > Aisle > Shelf > Rack > Bin)
- [x] Replaced lat/lng with What3Words text input for site location
- [x] Converted app to light theme (white sidebar, no dark backgrounds)
- [x] Updated cost estimation to use selected_items + manual_costs arrays

### Database Schema (MongoDB)
- users, projects, terms_conditions, inventory_items, inventory_transactions
- deletion_requests, audit_logs, company_profiles

### Key API Endpoints
- POST /api/auth/login, /api/auth/register
- CRUD /api/projects (with selected_items, manual_costs)
- CRUD /api/inventory/items (with zone, aisle, shelf, rack, bin_location)
- GET /api/company/active, CRUD /api/company
- CRUD /api/terms, /api/users, /api/audit-logs, /api/deletion-requests
- GET /api/dashboard/stats

## Test Credentials
- Admin: admin@sensoper.com / Admin@123

## Prioritized Backlog

### P1 — Pending (User Action Required)
- [ ] Google Maps integration for site location (requires user API key)
- [ ] Google Drive integration for image uploads (requires user OAuth)

### P2 — Future Enhancements
- [ ] Auto inventory deduction on project approval
- [ ] Offline mode (PWA) for field staff
- [ ] WhatsApp Business API for quote sharing
- [ ] Email delivery of PDF quotes
- [ ] Advanced analytics dashboard
- [ ] Export data to Excel
