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
- [x] **Solar Project Report rendered as charts & graphs** — Live wizard preview and Quotation PDF both use charts instead of tables. Apple-style "At a Glance" plain-English hero (YOU INVEST / YOU SAVE MONTHLY / COST RECOVERED IN / TOTAL SAVED 25 YRS) + layman captions under every chart. PDF section is try/catch-wrapped; `drawBarChartV` hardened against NaN. Friendly text only — 'units' not 'u', 'Year 1' not 'Y1', '3 kWp and above' not '≥3 kWp'. *(May 2026)*
- [x] **Project Completion via Drive Link + Inverter Login (no upload)** — Mark-complete dialog replaced with Google Drive link input + Inverter Login (URL/Username/Password with show-toggle, Notes). Display card on project page shows the handover info with reveal+copy buttons. Backend validates URL prefix; legacy `completion_media` array kept for backward compat. *(May 2026)*
- [x] **AI / auto-suggestions completely removed** — `aiAPI` import removed from `SiteVisitForm.js`; AI Recommendation button gone; Smart System Suggestions card replaced with manual "Proposed Solution" entry (system_kw, panel_count, inverter_kw, panel_area, notes) persisted under `custom_fields.proposed_solution`. *(May 2026)*
- [x] **Solar Report — no duplicate fields, no irradiance** — Refactored to consume customer/electrical/solar-system data via props from upstream wizard steps. Only 5 unique inputs remain: TNEB Service No, Avg Monthly Bill, Tariff Category, System Type, Cost per kWp (+ battery days when off-grid/hybrid). GPS / NASA POWER / irradiance UI removed entirely; specific yield fixed internally at 4.0 kWh/kWp/day (Indian residential on-grid baseline). *(May 2026)*
- [x] **What3Words graceful degradation** — `fetchW3W` always saves GPS coordinates first, then enriches with W3W; W3W failures (401/402/429/network) show actionable error message + the GPS is still captured. API key `G4IVNNAW` retained in `frontend/.env`. *(May 2026)*
- [x] **Inventory bulk import + Excel/PDF export** — New backend endpoints: `GET /api/inventory/template` (sample xlsx), `POST /api/inventory/import` (.xlsx/.csv, upserts by `sku_code`, returns created/updated/errors), `GET /api/inventory/export?format=xlsx|pdf` (full inventory; PDF via reportlab landscape A4). Inventory page toolbar gets three new buttons: Import, Excel, PDF. Import dialog with Template download + summary panel. Routes namespaced under `/inventory/` (not `/inventory/items/`) to avoid conflict with `/items/{item_id}`. *(May 2026)*
- [x] **Dashboard conversion-rate math fixed** — Drafts no longer inflate the denominator on `/api/dashboard/stats` or `/api/dashboard/ceo`. Leads = total − drafts. Sales funnel `total_leads` aligned. *(Feb 2026)*
- [x] **Load Details removed from Site & Electrical step** — Obsolete `load_m` collapsible section dropped; sanction-load / monthly-units validation removed (those inputs now live solely inside the Solar Project Calculator). *(Feb 2026)*
- [x] **Terms & Conditions choosable per project + active toggle removed** — New `GET /api/terms/{id}` endpoint. Project schema accepts `terms_id` (POST/PUT/GET). Site Documentation step has a dropdown to pick a T&C template (falls back to Standard Terms if none selected). T&C admin page lost the Active switch, the Active badge, the "only one active" restriction, and the "cannot delete active" server-side block. *(Feb 2026)*
- [x] **Solar Project Calculator — fully editable manual mode** — `SolarReportSection` rewritten: every input is editable (Monthly Consumption, Bill, Sanctioned Load, Connection Type, Tariff, System Type, Panel Wattage, Cost per kWp, Specific Yield). TNEB lookup demoted to optional "Prefill from TNEB" block. Read-only upstream summary removed. ProjectDetails PDF accepts new `avg_monthly_consumption_units` key with legacy fallback. *(Feb 2026)*
- [x] **Solar Calculator → "Proposed Solution & Materials" merge** — Separate `SolarReportSection` removed entirely. New `ProposedSolutionSection` lives inside the Materials step (step renamed to "Proposed Solution & Materials" in stepper + page title). All inputs are pure manual entry (system size, panel/inverter/battery details, generation, EB consumption, tariff, cost, subsidy, diesel offset, life, degradation, notes). Live-computed metrics displayed: payback, ROI, monthly/annual/lifetime savings, diesel/petrol saved, CO₂ reduction, annual generation. No auto-sizing API any more. *(Feb 2026)*
- [x] **Universal Notes feature** — Every project carries an editable `notes` field + `notes_history` array. Backend: new `POST /api/projects/{id}/notes` appends timestamped entries with author info; `PUT /api/projects/{id}` accepts `notes` and is allowed for ANY status when *only* notes is being changed (so completed projects stay editable for follow-ups/service logs). UI: dedicated Notes card on `ProjectDetails` with Edit-main + Append-timestamped flows + reverse-chronological history. Final step's "Shadow Analysis Notes" textarea renamed to "Notes" and bound to the same field. Lazy migration: legacy `additional.shadow_analysis_notes` returns through `notes` on GET when the new field is empty. *(Feb 2026)*

## P2 - Future
- [ ] WhatsApp Business API & Email delivery for quote sharing
- [ ] Refactor server.py (~4000 lines) into modular routers
- [ ] Embed Unicode font in jsPDF so ₹ renders natively in PDFs
- [ ] Dead Stock classification (no movement for extended duration)
- [ ] Reorder Suggestions card driven by Fast-moving + low stock
