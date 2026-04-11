# Sensoper Controls & Renewables - Solar Project Cost Estimator

## Original Problem Statement
Build a production-ready Solar Project Cost Estimator web application for "Sensoper Controls and Renewables" with role-based auth, multi-step site visit data collection, dynamic cost estimation engine, project tracking dashboard, professional PDF quotation generation, approvals workflow, dynamic permissions system, and admin-controlled dynamic form tabs.

## Tech Stack
- Frontend: React, Tailwind CSS, Shadcn UI, jsPDF, jspdf-autotable, qrcode, DOMPurify
- Backend: FastAPI, MongoDB, JWT Authentication (cookie-based)
- Storage: Emergent Object Storage, Google Drive (site images via manual link)
- AI: Emergent LLM Key for recommendations

## Core Features (All Implemented)
- [x] Role-based JWT Authentication (Admin, Manager, Staff)
- [x] Multi-step Site Visit Form (fully dynamic - all tabs ordered via API)
- [x] Merged Site Measurements & Electrical into "Site & Electrical" tab
- [x] Smart System Suggestions in Materials step (auto-calculates kW, panels, inverter, area)
- [x] **Admin-Controlled Dynamic Tabs (Form Tab Builder)** — Admin can create/edit/delete/reorder custom tabs with 6 field types, mandatory rules, and role-based visibility
- [x] **System Tabs in Form Builder** — Base tabs (Customer, Location, Site & Electrical, Materials, Site Docs) appear in builder as non-editable "System" entries, fully reorderable alongside custom tabs
- [x] Dynamic Cost Estimation Engine with per-item margins
- [x] Professional PDF Quotation with logo, QR codes, UPI QR
- [x] Project Tracking Dashboard with status workflow
- [x] **Approvals Dashboard** — Pending/Approved/Rejected tabs, filters, search
- [x] **Dynamic Permissions System** — Admin can toggle 16 permissions per role
- [x] **Approval Workflow** — 5 types with auto-execution on approval
- [x] Company Branding, Terms & Conditions, Inventory Management
- [x] Google Drive Integration (folder link per project, QR in PDF)
- [x] DOMPurify XSS protection, React hook stabilization, proper error handling
- [x] Audit Logs, Mobile Responsive

## Key API Endpoints
- Auth: /api/auth/login, /register, /me, /refresh, /logout
- Projects: CRUD + /submit, /approve, /reject, /complete, /margin, /reference, /status, /gallery
- Approvals: GET/POST /api/approvals, PUT /approve, PUT /reject, GET /pending-count
- Permissions: GET /api/permissions, GET/PUT /api/permissions/{role}
- **Form Tabs: GET/POST /api/form-tabs, PUT /api/form-tabs/{id}, DELETE /api/form-tabs/{id}, PUT /api/form-tabs/reorder**
- Inventory, Company, Upload, Drive endpoints

## DB Collections
- users, projects, inventory_items, inventory_categories, terms_conditions, company_profiles, audit_logs, approvals, deletion_requests, permissions, login_attempts, **form_tabs** (system + custom)

## P1 - Upcoming
- [ ] Wire staff actions to Approvals workflow (auto-create approval request on 403)
- [ ] Google Maps API for site location capture
- [ ] Project-level notes/comments for manager review

## P2 - Future/Backlog
- [ ] Auto inventory deduction on project approval
- [ ] Offline PWA mode
- [ ] WhatsApp Business API for quote sharing
- [ ] Email PDF delivery
- [ ] Advanced analytics dashboard + Excel export
- [ ] Refactor server.py into route modules
- [ ] Component splitting (CompanyProfile, ProjectDetails, InventoryManagement)
