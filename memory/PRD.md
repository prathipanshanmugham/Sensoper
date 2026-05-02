# Sensoper Controls & Renewables - Solar Project Cost Estimator

## Original Problem Statement
Build a production-ready Solar Project Cost Estimator / ERP web application for "Sensoper Controls and Renewables" with role-based auth, multi-step site visit data collection, dynamic cost estimation engine, project tracking dashboard, professional PDF quotation generation, approvals workflow, dynamic permissions, admin-controlled dynamic form tabs, CEO dashboard, and comprehensive reports engine.

## Tech Stack
- Frontend: React, Tailwind CSS, Shadcn UI, Recharts, jsPDF + autoTable, xlsx/SheetJS, file-saver, DOMPurify
- Backend: FastAPI, MongoDB, Motor (Async), JWT Authentication (cookie-based)
- Storage: Emergent Object Storage, Google Drive (site images via manual link)
- AI: Emergent LLM Key for recommendations

## Core Features (All Implemented)
- [x] Role-based JWT Authentication (Admin, Manager, Staff)
- [x] Multi-step Site Visit Form (fully dynamic - all tabs ordered via API)
- [x] Merged Site Measurements & Electrical into "Site & Electrical" tab
- [x] Smart System Suggestions in Materials step
- [x] **Admin-Controlled Dynamic Tabs (Form Tab Builder)** — Full CRUD, 6 field types, mandatory rules, role visibility
- [x] **System Tabs Fully Editable** — Rename, add fields, toggle active/inactive, delete, reorder
- [x] **CEO Dashboard** — 8 KPIs, Revenue Trend chart, Project Status pie, Sales Funnel, Top Staff, drill-down navigation
- [x] **Reports Engine** — 10 report types (Sales, Profit, Execution, Inventory, Technical, O&M, Compliance, HR, Marketing, Customer Satisfaction), global filters, PDF + Excel export
- [x] Dynamic Cost Estimation Engine with per-item margins
- [x] Professional PDF Quotation with logo, QR codes, UPI QR
- [x] Project Tracking Dashboard with status workflow
- [x] Approvals Dashboard with auto-execution
- [x] Dynamic Permissions System (16 per role)
- [x] Company Branding, Terms & Conditions, Inventory Management
- [x] Google Drive Integration, Audit Logs, Mobile Responsive
- [x] DOMPurify XSS protection, memoized AuthContext, stable React keys

## Key API Endpoints
- Auth: /api/auth/login, /register, /me, /refresh, /logout
- Projects: CRUD + /submit, /approve, /reject, /complete, /margin, /reference, /status, /gallery
- **CEO Dashboard: GET /api/dashboard/ceo**
- **Reports: GET /api/reports/{type} (sales|profit|execution|inventory|technical|om|compliance|hr|marketing|customer)**
- Form Tabs: GET/POST /api/form-tabs, PUT /api/form-tabs/{id}, DELETE /api/form-tabs/{id}, PUT /api/form-tabs/reorder
- Approvals, Permissions, Inventory, Company, Upload endpoints

## P1 - Upcoming
- [ ] Enhanced Form Builder: Multi-select, file upload, GPS, toggle field types
- [ ] Make ALL form fields dynamic (remove hardcoded sections)
- [ ] Wire staff actions to Approvals workflow
- [ ] Google Maps API for site location capture
- [ ] Project-level notes/comments

## P2 - Future/Backlog
- [ ] Auto inventory deduction on project approval
- [ ] Offline PWA mode
- [ ] WhatsApp Business API for quote sharing
- [ ] Email PDF delivery
- [ ] Component splitting, backend refactoring
