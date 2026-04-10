# Sensoper Controls & Renewables - Solar Project Cost Estimator

## Original Problem Statement
Build a production-ready Solar Project Cost Estimator web application for "Sensoper Controls and Renewables" with role-based auth, multi-step site visit data collection, dynamic cost estimation engine, project tracking dashboard, professional PDF quotation generation, approvals workflow, and dynamic permissions system.

## Tech Stack
- Frontend: React, Tailwind CSS, Shadcn UI, jsPDF, jspdf-autotable, qrcode
- Backend: FastAPI, MongoDB, JWT Authentication
- Storage: Emergent Object Storage, Google Drive (site images)
- AI: Emergent LLM Key for recommendations

## Core Features (All Implemented)
- [x] Role-based JWT Authentication (Admin, Manager, Staff)
- [x] Multi-step Site Visit Form (5 steps)
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
- [x] Typeable dropdowns (ComboInput) for Service Type, System Type, Complexity
- [x] Add Category on-the-fly
- [x] Mandatory completion photos/videos + customer feedback
- [x] Editable reference number and project status
- [x] Site images as QR code in PDF
- [x] Edit projects (draft/approved)
- [x] Google Drive OAuth for site images
- [x] Audit Logs, Deletion Approvals, Mobile Responsive, AI recommendations

## Permissions (16 per role)
can_create_project, can_edit_project, can_delete_project, can_request_delete, can_approve_deletion, can_approve_quotation, can_set_margin, can_approve_margin, can_edit_inventory, can_approve_inventory, can_manage_users, can_change_user_access, can_view_reports, can_view_audit_logs, can_manage_company, can_manage_terms

## Key API Endpoints
- Auth: /api/auth/login, /register, /me
- Projects: CRUD + /submit, /approve, /reject, /complete, /margin, /reference, /status, /gallery
- Approvals: GET /api/approvals, POST /api/approvals, PUT /approve, PUT /reject, GET /pending-count
- Permissions: GET /api/permissions, GET/PUT /api/permissions/{role}
- Inventory, Company, Upload, Drive endpoints

## P1 - Upcoming
- [ ] Google Maps API for site location capture
- [ ] Project-level notes/comments for manager review

## P2 - Future/Backlog
- [ ] Auto inventory deduction on project approval
- [ ] Offline PWA mode
- [ ] WhatsApp Business API for quote sharing
- [ ] Email PDF delivery
- [ ] Advanced analytics dashboard + Excel export
