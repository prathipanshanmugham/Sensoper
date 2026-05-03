# Sensoper Controls & Renewables - Solar ERP

## Original Problem Statement
Build a production-ready Solar Project ERP for "Sensoper Controls and Renewables" with role-based auth, multi-step site visit forms, dynamic cost estimation, project tracking, PDF quotations, approvals, permissions, dynamic form builder, CEO dashboard, comprehensive reports engine, daily data updates, payment tracking, and data completeness scoring.

## Tech Stack
- Frontend: React, Tailwind CSS, Shadcn UI, Recharts, jsPDF + autoTable, xlsx/SheetJS, file-saver, DOMPurify
- Backend: FastAPI, MongoDB, Motor (Async), JWT Auth (cookie-based)
- Storage: Emergent Object Storage, Google Drive (manual link)

## Implemented Features
- [x] Role-based JWT Authentication (Admin, Manager, Staff)
- [x] Multi-step Site Visit Form (fully dynamic via API)
- [x] Admin-Controlled Dynamic Form Builder (all tabs editable)
- [x] Smart System Suggestions in Materials step
- [x] CEO Dashboard (8 KPIs, Revenue Trend, Status Pie, Sales Funnel, Top Staff)
- [x] **20 Report Types** with pie charts + PDF/Excel export
- [x] **Daily Data Updates** (5 sections: Progress, Material, Payment, Installation, O&M)
- [x] **Payment Tracking** (per-project payments with history)
- [x] **Material Usage Logging** (estimated vs actual with variance)
- [x] **Data Completeness Score** (0-100% per project, 6 checks)
- [x] **Project-Level Report API** (full details + payments + materials + updates)
- [x] **Enhanced Report Filters** (date range, system type, status, customer, staff)
- [x] **Sticky Sidebar** across all dashboard pages
- [x] **Sensoper Favicon**
- [x] **Auto-save Draft** when project form is partially filled
- [x] Dynamic Cost Estimation Engine
- [x] Professional PDF Quotation with QR codes
- [x] Approvals Dashboard with auto-execution
- [x] Dynamic Permissions (16 per role)
- [x] Inventory Management, Company Branding, Terms & Conditions
- [x] Audit Logs, DOMPurify XSS protection, Mobile Responsive

## Report Types (20)
Sales, Profit, Expense, Execution, Inventory, Inbound, Outbound, Low Stock, Excess Materials, Scrap, Price Fluctuation, Technical & O&M, Compliance & Tax, HR & Productivity, Marketing, Customer Satisfaction, Customer Credit, Referral, Team Load, Excess Material Utilisation

## DB Collections
users, projects, inventory_items, inventory_categories, terms_conditions, company_profiles, audit_logs, approvals, deletion_requests, permissions, login_attempts, form_tabs, **daily_updates**, **payments**, **material_usage_logs**

## P1 - Upcoming
- [ ] Project-level PDF/Excel download button in ProjectDetails page
- [ ] Data completeness UI indicators in project list
- [ ] Configurable report restriction based on completeness
- [ ] Google Maps API for site location
- [ ] Project-level notes/comments

## P2 - Future/Backlog
- [ ] Auto inventory deduction on project approval
- [ ] Offline PWA mode
- [ ] WhatsApp/Email for quote sharing
- [ ] Component splitting, backend route modules
