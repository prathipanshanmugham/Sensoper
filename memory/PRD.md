# Sensoper Controls & Renewables - Solar ERP

## Original Problem Statement
Build a production-ready Solar Project ERP with role-based auth, dynamic forms, cost estimation, project tracking, PDF quotations, approvals, permissions, CEO dashboard, profit leakage intelligence, consolidated reports, daily data updates, payment tracking, and data completeness scoring.

## Tech Stack
- Frontend: React, Tailwind CSS, Shadcn UI, Recharts (LineChart only), jsPDF + autoTable, xlsx/SheetJS, file-saver, DOMPurify
- Backend: FastAPI, MongoDB, Motor (Async), JWT Auth (cookie-based)

## Implemented Features
- [x] Role-based JWT Authentication (Admin, Manager, Staff)
- [x] Multi-step Dynamic Site Visit Form (API-driven tab order)
- [x] Admin-Controlled Dynamic Form Builder (all tabs editable)
- [x] CEO Dashboard (KPIs, Revenue Trend, Status Distribution, Sales Funnel, Top Staff)
- [x] **Profit Leakage Alert System** — 7 alert types (low margin, underpriced quote, payment delay, project delay, material variance, excess material, team inefficiency), risk scoring 0-100, configurable thresholds
- [x] **8 Consolidated Reports** — Sales & Revenue, Profit & Leakage, Project Execution, Inventory & Material, Customer Credit, Team Performance, Compliance & Tax, Customer Satisfaction (reduced from 20 redundant reports)
- [x] **Tab-based Report Views** — Multi-tab navigation within reports (overview/lead_sources, profit/material_variance, stock/usage/alerts)
- [x] **Daily Data Updates** (5 sections: Progress, Material, Payment, Installation, O&M)
- [x] **Payment Tracking** + **Material Usage Logging** with variance
- [x] **Data Completeness Score** (0-100% per project)
- [x] **Project-Level Report API** (full details + payments + materials + updates)
- [x] Enhanced Report Filters (date, system type, status, customer, staff)
- [x] Sticky Sidebar, Sensoper Favicon, Auto-save Draft
- [x] Dynamic Cost Estimation, PDF Quotation with QR, Approvals, Permissions, Inventory, Audit Logs

## Report Types (8 Consolidated)
1. Sales & Revenue (tabs: overview, lead_sources)
2. Profit & Leakage (tabs: profit, material_variance)
3. Project Execution
4. Inventory & Material (tabs: stock_levels, material_usage, alerts)
5. Customer Credit
6. Team Performance
7. Compliance & Tax
8. Customer Satisfaction

## Alert Types (7)
low_margin, underpriced_quote, payment_delay, project_delay, material_variance, excess_material, team_inefficiency

## P1 - Upcoming
- [ ] Project-level PDF/Excel download button in ProjectDetails
- [ ] Data completeness UI indicators in project list
- [ ] In-app notification bell for alerts
- [ ] Project-level alert badges on project cards

## P2 - Future/Backlog
- [ ] WhatsApp/Email notifications for alerts
- [ ] Auto inventory deduction on project approval
- [ ] Offline PWA mode
- [ ] Component splitting, backend route modules
