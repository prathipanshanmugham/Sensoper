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
- [x] **Accounts module** (Cash on Hand / Meter Reading / Account Balance) — embedded as a sub-tab inside Customer Credits *(shipped Feb 2026)*
- [x] **Readings module** (site reading-phase tracker, auto-overdue derivation, summary KPIs, status filter) *(shipped Feb 2026)*
- [x] **CEO Dashboard expansion** — Cash / Readings / Account Balance snapshot cards with trend line *(shipped Feb 2026)*
- [x] **Permissions refresh** — module-level access matrix (view/create/edit/delete/export × 16 modules) with admin lock + mobile cards *(shipped Feb 2026)*
- [x] **PWA + offline support** — manifest, service worker (cache-first static, network-first navigation, offline fallback, no-cache /api/*, background-sync queue for /api/readings & /api/accounts), install prompt, CLEAR_CACHE on logout *(shipped Feb 2026)*

## P2 - Future
- [ ] WhatsApp Business API & Email delivery for quote sharing
- [ ] Refactor server.py (~4000 lines) into modular routers
- [ ] Embed Unicode font in jsPDF so ₹ renders natively in PDFs
- [ ] Dead Stock classification (no movement for extended duration)
- [ ] Reorder Suggestions card driven by Fast-moving + low stock
