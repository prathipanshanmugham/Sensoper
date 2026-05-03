# Sensoper Controls & Renewables - Solar ERP

## Tech Stack
- Frontend: React, Tailwind CSS, Shadcn UI, Recharts, jsPDF, xlsx/SheetJS, DOMPurify
- Backend: FastAPI, MongoDB, Motor (Async), JWT Auth (cookie-based)

## Implemented Modules

### Core
- [x] Role-based Auth, Dynamic Form Builder, Multi-step Site Visit Form
- [x] Dynamic Cost Estimation, PDF Quotation, Approvals, Permissions, Inventory

### Intelligence
- [x] CEO Dashboard (KPIs, Revenue Trend, Sales Funnel, **Credit Aging + Top Debtors**)
- [x] Profit Leakage Alerts (7 types, risk scoring, configurable thresholds)
- [x] **12 Reports** with charts + PDF/Excel export

### Operations
- [x] Customer Credits, Purchase Inbound (5-step PO flow), Delivery Outbound
- [x] Brand Returns, Weekly Audits, Daily Updates (**7 types: Progress, Leads, Invoicing, Material, Payment, Installation, O&M**)
- [x] Payment Tracking, Material Usage Logging, Data Completeness Score

### Reports (12 total)
1. Sales & Revenue (tabs: overview, lead_sources)
2. Profit & Leakage (tabs: profit, material_variance)
3. Project Execution
4. Inventory & Material (tabs: stock_levels, material_usage, alerts)
5. Customer Credit
6. Team Performance
7. Compliance & Tax
8. Customer Satisfaction
9. **Inbound Report** (PO details, QC, transport)
10. **Outbound Report** (deliveries, dispatch, transport)
11. **Audit Report** (checklist, issues, resolution)
12. **Marketing Report** (leads from daily updates, conversions)

### Inventory Enhancements
- [x] Image URL field (Drive link)
- [x] Margin % per product (internal)
- [x] Active/Inactive status
- [x] QC Checklist template per product

### Filters (cleaned)
- Date range, System type, Status only (customer/staff filters removed)

## P1 - Upcoming
- [ ] Project-level PDF/Excel download in ProjectDetails
- [ ] In-app notification bell for alerts
- [ ] Inventory UI updates (status dot, QC checklist UI)

## P2 - Future
- [ ] WhatsApp/Email notifications, Offline PWA, Backend route modules
