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
- [x] Multi-step Site Visit Form (dynamic steps: 4 base + N custom + 1 final)
- [x] Merged Site Measurements & Electrical into single "Site & Electrical" tab (Step 3)
- [x] Smart System Suggestions in Materials step (auto-calculates kW, panels, inverter, area)
- [x] **Admin-Controlled Dynamic Tabs (Form Tab Builder)** — Admin can create/edit/delete/reorder custom tabs with field types (text, number, textarea, select, checkbox, date), mandatory rules, and role-based visibility
- [x] Dynamic Cost Estimation Engine with per-item margins
- [x] Professional PDF Quotation with logo, QR codes, UPI QR
- [x] Project Tracking Dashboard with status workflow
- [x] **Approvals Dashboard** — Pending/Approved/Rejected tabs, filters, search, approve/reject actions
- [x] **Dynamic Permissions System** — Admin can toggle 16 permissions per role via UI
- [x] **Approval Workflow** — 5 types (deletion, margin_change, quotation, inventory_edit, user_access)
- [x] **Auto-execution on Approval** — Approved actions are executed automatically
- [x] Company Branding (logo, colors, bank details, UPI ID)
- [x] Terms & Conditions Management
- [x] Inventory Management with categories
- [x] Per-product margin control (Admin/Manager only)
- [x] Google Drive Integration (simple folder name/link per project, no OAuth)
- [x] Site Documentation with QR code in PDF (drive folder link)
- [x] DOMPurify XSS protection, React hook stabilization, proper error handling
- [x] Audit Logs, Mobile Responsive

## Permissions (16 per role)
can_create_project, can_edit_project, can_delete_project, can_request_delete, can_approve_deletion, can_approve_quotation, can_set_margin, can_approve_margin, can_edit_inventory, can_approve_inventory, can_manage_users, can_change_user_access, can_view_reports, can_view_audit_logs, can_manage_company, can_manage_terms

## Key API Endpoints
- Auth: /api/auth/login, /register, /me, /refresh, /logout
- Projects: CRUD + /submit, /approve, /reject, /complete, /margin, /reference, /status, /gallery
- Approvals: GET /api/approvals, POST /api/approvals, PUT /approve, PUT /reject, GET /pending-count
- Permissions: GET /api/permissions, GET/PUT /api/permissions/{role}
- **Form Tabs: GET/POST /api/form-tabs, PUT /api/form-tabs/{id}, DELETE /api/form-tabs/{id}, PUT /api/form-tabs/reorder**
- Inventory, Company, Upload, Drive endpoints

## DB Collections
- users, projects, inventory_items, inventory_categories, terms_conditions, company_profiles, audit_logs, approvals, deletion_requests, permissions, login_attempts, **form_tabs**

## P0 - Completed
- [x] Merge Site Measurements + Electrical into Step 3
- [x] Smart System Suggestions calculator in Materials step
- [x] Admin-Controlled Dynamic Tabs (Dynamic Form Engine)

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
