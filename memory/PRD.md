# Sensoper Controls & Renewables - Solar ERP

## Original Problem Statement
Full-featured Solar Project ERP with role-based auth, dynamic forms, cost estimation, project tracking, PDF quotations, approvals, permissions, CEO dashboard, profit leakage intelligence, consolidated reports, daily data updates, payment tracking, data completeness, customer credit management, procurement (inbound), delivery (outbound), brand returns, and weekly audit system.

## Tech Stack
- Frontend: React, Tailwind CSS, Shadcn UI, Recharts, jsPDF + autoTable, xlsx/SheetJS, DOMPurify
- Backend: FastAPI, MongoDB, Motor (Async), JWT Auth (cookie-based)

## Implemented Modules

### Core
- [x] Role-based Auth (Admin, Manager, Staff)
- [x] Dynamic Form Builder (all tabs editable, 6 field types)
- [x] Multi-step Site Visit Form (API-driven)
- [x] Dynamic Cost Estimation Engine
- [x] PDF Quotation with QR codes
- [x] Approvals + Permissions System
- [x] Inventory Management

### Intelligence
- [x] CEO Dashboard (KPIs, Revenue Trend, Sales Funnel)
- [x] Profit Leakage Alert System (7 alert types, risk scoring)
- [x] 8 Consolidated Reports with tab views + PDF/Excel export
- [x] Data Completeness Score (0-100%)
- [x] Configurable Thresholds

### Operations
- [x] **Customer Credits** — Credit entries, payment tracking, aging analysis (0-30/30-60/60+ days), auto-overdue, auto-close
- [x] **Purchase Inbound** — Full procurement lifecycle: PO → Approve → Arrival (transport) → QC → Inventory update with storage location
- [x] **Delivery Outbound** — Dispatch tracking with customer, transport, items, distance
- [x] **Brand Returns** — Return logging (damage/excess/defect), supplier tracking, status workflow
- [x] **Weekly Audits** — Structured audits with checklist, issue tracking, severity, deadline, resolution status
- [x] **Daily Data Updates** — 5 sections (Progress, Material, Payment, Installation, O&M)
- [x] **Payment Tracking** + **Material Usage Logging**

### UI/UX
- [x] Sticky Sidebar across all pages
- [x] Sensoper Favicon
- [x] Auto-save Draft
- [x] Mobile-responsive forms

## DB Collections (20)
users, projects, inventory_items, inventory_categories, terms_conditions, company_profiles, audit_logs, approvals, deletion_requests, permissions, login_attempts, form_tabs, daily_updates, payments, material_usage_logs, settings, **customer_credits**, **credit_payments**, **purchase_orders**, **deliveries**, **brand_returns**, **audits**

## P1 - Upcoming
- [ ] Project-level PDF/Excel download in ProjectDetails
- [ ] Data completeness UI indicators in project list
- [ ] In-app notification bell for alerts
- [ ] Report integration for new operational modules

## P2 - Future
- [ ] WhatsApp/Email notifications
- [ ] Offline PWA mode
- [ ] Auto inventory deduction
- [ ] Backend route module refactoring
