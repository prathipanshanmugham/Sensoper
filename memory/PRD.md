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
4. Inventory & Material (tabs: stock_levels, material_usage, alerts, **movement — Fast/Slow moving with Product · Status · Procurement Date · Last Used · Usage Count · Movement Type; filter by movement_type**)
5. Customer Credit
6. Team Performance
7. Compliance & Tax
8. Customer Satisfaction
9. **Inbound Report** (PO details, QC, transport)
10. **Outbound Report** (deliveries, dispatch, transport)
11. **Audit Report** (checklist, issues, resolution)
12. **Marketing Report** (leads from daily updates, conversions)

### Inventory Enhancements
- [x] Image URL field (pasteable https link + live preview, replacing file upload — Feb 2026)
- [x] Margin % per product (internal)
- [x] Active/Inactive status (green/grey dot in list)
- [x] QC Checklist template per product
- [x] Procurement Date field (used for movement analysis — Feb 2026)
- [x] Fast / Slow moving classification (≥5 usages in last 30 days = Fast) — Feb 2026

### Filters (cleaned)
- Date range, System type, Status only (customer/staff filters removed)
- Inventory → Movement tab: adds Movement Type filter (All / Fast / Slow)

## P1 - Upcoming
- [x] Project-level PDF/Excel download in ProjectDetails *(shipped Feb 2026)*
- [x] In-app notification bell for alerts *(shipped Feb 2026)*
- [x] Inventory UI updates — status dot + QC checklist *(shipped Feb 2026)*
- [x] Decouple Leads & Invoicing in Daily Updates *(shipped Feb 2026)*
- [x] Currency consistency *(shipped Feb 2026)*
- [x] Inventory movement intelligence — Fast/Slow + procurement_date + URL-based image *(shipped Feb 2026)*
- [x] **Accounts module** — Customer Credits page renamed to **Accounts**. Sub-tabs: Customer Credits | Accounts (Cash on Hand + Account Balance — Meter Reading dropped) | **Expenses** (Operational Expense + GST Input). Backend `/api/accounts/summary` returns per-type snapshots + `operational_expense_mtd` + `gst_input_mtd` totals. *(Feb 2026)*
- [x] **Readings module** *(Feb 2026)*
- [x] **CEO Dashboard refresh** — 4-card snapshot row (Cash · Op Exp MTD · GST Input MTD · Account Balance) + **Net Cash Flow** strip with explicit `+₹` / `-₹` sign + Readings card. *(Feb 2026, Net-Cash-Flow sign added May 2026)*
- [x] **What3Words integration** — `Auto-fill from GPS` button on Site Visit form Location step. Browser geolocation → W3W v3 API (key `REACT_APP_W3W_API_KEY=G4IVNNAW`) → autofills `site_location_words` + lat/lng + nearestPlace. Privacy-friendly: GPS button only, no auto-fetch on typing. *(May 2026)*
- [x] **Permissions refresh** — module-level access matrix (view/create/edit/delete/export × 16 modules) with admin lock + mobile cards *(shipped Feb 2026)*
- [x] **PWA + offline support** — manifest, service worker (cache-first static, network-first navigation, offline fallback, no-cache /api/*, background-sync queue for /api/readings & /api/accounts), install prompt, CLEAR_CACHE on logout *(shipped Feb 2026)*
- [x] **Login/Register password-eye toggle** — Eye/EyeOff icon button toggles input type between password ↔ text. *(shipped May 2026)*
- [x] **Accounting page reorganized into 5 tabs** — `Customer | Credits | Accounts | Expenses | GST`. New `Customer` tab aggregates per-customer (invoices/total/paid/balance/overdue) with search. GST tab snapshot now includes **Total GST Paid (MTD)**, **Input Credits (MTD)**, **Net GST Liability (MTD)** (paid − input). Backend `/api/accounts` accepts `entry_type=gst_paid`; `/api/accounts/summary` exposes `gst_paid_mtd`, `gst_input_mtd`, `gst_net_mtd`. *(May 2026)*
- [x] **CEO Dashboard symmetric refresh** — Net Cash Flow strip removed. Layout: 8 KPI cards (4×2) → 4 financial snapshots (Cash · Op Exp MTD · GST Input MTD · Account Balance) → 4-col charts row (Revenue 2col + Project Status 1col + Readings 1col) → Sales Funnel + Top Staff (2×1) → Credit overview. *(May 2026)*
- [x] **Solar Project Report rendered as charts & graphs** — Live wizard preview and Quotation PDF both now use charts instead of tables. **Wizard** (`SolarReportSection.js`): 5-box gradient KPI strip, two CSS conic-gradient donut charts (Cost Breakdown: Subsidy vs Net; Energy Source Mix: Solar vs Grid), Recharts BarChart for Monthly Economics (Avg Bill / Solar Savings / Generation ₹ / Net Bill), Recharts AreaChart for 25-Year Cumulative + Yearly Savings, horizontal gauge bars for Technical KPIs (PR, CUF, Annual Gen, CO₂, ROI, Panel Efficiency). **PDF** (`ProjectDetails.js` generatePDF): native jsPDF chart helpers — `drawPie` (triangle-fan donuts), `drawBarChartV`, `drawLineChart` (with gradient fill), `drawHGauge`, `drawKpiBox`. All same data, no Recharts in PDF gen. Recharts `<Cell>` strictly avoided (known v3 crash). Section now defaults to expanded inside the wizard step. *(May 2026)*

## P2 - Future
- [ ] WhatsApp Business API & Email delivery for quote sharing
- [ ] Refactor server.py (~4000 lines) into modular routers
- [ ] Embed Unicode font in jsPDF so ₹ renders natively in PDFs
- [ ] Dead Stock classification (no movement for extended duration)
- [ ] Reorder Suggestions card driven by Fast-moving + low stock
