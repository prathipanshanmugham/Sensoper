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
- [x] **Hybrid auto-calc + Manual Override** — `ProposedSolutionSection` now has 8 *driver inputs* (Monthly EB Bill / Units, Roof Area, Tariff, Connection Type, Tariff Category, Location, System Type, Backup hrs) that auto-suggest 11 *output fields* (System Size, Panel Count, Panel Area, Roof Util %, Monthly+Annual Gen, Inverter, Battery kWh+count, Total Cost, Subsidy). Every field shows an **"Auto Calculated"** badge by default; if the user types over it the badge flips to **"Manual Override"** with a one-click reset icon. **Auto Calculate** button clears all overrides and refreshes everything. Smart recalculation: editing any driver re-derives non-overridden fields live. Subsidy formula follows PM Surya Ghar Feb 2026 schedule (cap ₹78k, residential on-grid domestic only). State-specific specific yield lookup. *(Feb 2026)*
- [x] **Iteration 38 — Phases B & C: CEO Health Score + Expansion Module (Feb 2026)**:
  - **Phase B — Company Health Score**: New `backend/health.py` computes a 0-100 composite from 5 admin-weightable pillars — Sales & Growth (25%), Profitability (25%), Cash & Collections (20%), Operations (20%), Team & Compliance (10%). Each pillar breaks into 3-4 metrics scored 0-100 with plain-language "What's dragging the score" (top 3 lowest metrics named). Backed by `db.health_config` (singleton, weights + targets + bands admin-editable) and `db.health_snapshots` (monthly persistence, idempotent). New endpoints: `GET/PUT /api/dashboard/health/config`, `POST /api/dashboard/health/snapshot`, `GET /api/dashboard/health/history?months=N`. Payload also joined to `/api/dashboard/ceo` under `health_score`.
  - **Phase B UI — `HealthScoreCard`**: hero gauge (SVG needle 0-180°, gradient arc), verdict banner (Strong/Healthy/Needs Attention/Critical), 5-pillar strip with weight badges + colour-coded bars, "What's dragging the score" panel, save-monthly-snapshot link, 90-day trend sparkline from health history. Drill-through per pillar navigates to the owner page (Sales→Reports, Cash→Accounts, Ops→Inventory, Profit→Alerts).
  - **Phase C — Expansion Module**: New `backend/expansion.py` scores every district on 8 admin-weightable sub-components (Demand Density 20, Revenue Share 15, Growth Momentum 15, Margin Quality 15, Service Burden 10, Travel Cost Drag 10, Payment Health 10, Market Headroom 5). Districts under 10 projects flagged `confidence_low: true` and greyed in the UI so nobody opens a branch on 3 lucky jobs. Break-even simulator answers "how many projects/month do we need and are we there yet". Backed by `db.expansion_config` + `db.branches`. Full CRUD: `GET /api/expansion/{overview, district/{name}, config}`, `POST /api/expansion/{simulate}`, `GET/POST/PUT/DELETE /api/expansion/branches`. Distance-drag score uses Haversine to the nearest branch.
  - **Phase C UI — `/dashboard/expansion`** (admin/manager, `module_expansion` permission): summary card, state filter, ranked opportunity table with band badges, "View" opens district drawer with 8-axis radar chart + metric grid, break-even simulator dialog with editable inputs + coloured gap indicator, branches registry dialog (add/remove/list with lat/lon + monthly cost).
  - **Tests**: 9 pytest (`test_health_and_expansion.py`) + 9 API integration (`test_iter42_api.py`) all green; full Playwright validation of the CEO dashboard health card, expansion table, district drawer, simulator, and branches dialog (`iteration_42.json` — `retest_needed: false`).

- [x] **Iteration 38 — Phase A (Change 1): Server-side Solar Calculator + PIN/DISCOM engine + Solar Pump AC/DC split (Feb 2026)**:
  - New backend package `/app/backend/calculators/` (10 files: base, tariffs, subsidy, geo, ongrid, offgrid, hybrid, pump, seed_data, __init__) — no more constants in the browser. All rates, subsidies, cost/kWp are DB-backed and admin-editable so quotes are reproducible after tariff revisions.
  - PIN-code driven DISCOM slab engine: 5 seed DISCOMs (TANGEDCO, TNPDCL, KSEB, BESCOM, FALLBACK) with telescopic domestic + commercial + industrial + agricultural + HT slabs; 18 pincodes across TN/KL/KA with district-level `specific_yield_kwh_per_kwp_day`.
  - Slab-aware bill savings: pre-solar vs post-solar computed on the actual slab curve — removing 300 units from a 500-unit TN Domestic bill saves ₹1,570 (top-slab-first), not the flat-rate average. Zero-rate Agricultural tariff returns `payback: None` instead of divide-by-zero.
  - `LocationDetails` schema extended with `pincode / district / state / discom_id`. `calculation_snapshot` (versioned constants used) is persisted on every project so an old quote reproduces its original numbers even after a tariff change.
  - Solar Pump split into **DC** (MPPT + BLDC direct-coupled, 85% motor efficiency) vs **AC** (VFD + induction, 75% motor efficiency × 95% VFD efficiency) paths. TDH assembly captures static/dynamic water level, delivery head, horizontal pipe run with Hazen-Williams friction loss. Pump HP rounds to standard 0.5/1/2/3/5/7.5/10/12.5/15 HP with warnings when the required duty jumps > 0.6 HP, when bore casing is too narrow (min ≥ 90-200mm by HP), or when the DC string voltage falls outside the controller's MPPT window. PM-KUSUM subsidy separately configurable per component (B/C) with central/state/farmer split.
  - New API surface: `POST /api/calculate/solution`, `GET /api/calculate/lookup/{pincode}`, `POST /api/calculate/bill-savings`, `GET|PUT /api/calculate/config`, admin CRUD on `/api/calculate/discoms` and `/api/calculate/pincodes`, `POST /api/calculate/seed-defaults` (idempotent).
  - Frontend `ProposedSolutionSection` became a thin client: PIN Code block (600ms debounced lookup + 600ms debounced full calculation), TANGEDCO/KSEB/BESCOM badge, yield display, 3-number bill-savings strip (Pre / Post / Monthly Saving), tariff category dropdown populated from the resolved DISCOM's categories. Solar Pump path toggle (DC/AC), full TDH input set, PM-KUSUM section, live warnings panel.
  - 13 pytest unit tests + 11 integration API tests cover slab math, back-solve, top-slab-first savings, PM Surya Ghar slabs, PM-KUSUM shares, TN-vs-KL sizing differences, agricultural ₹0-tariff no-crash, DC pump sizing, casing warning, AC > DC array kWp, and override-wins.

- [x] **Iteration 40 — Phases 2, 3, 4 (Feb 2026)**: Added Solar Pump as 4th system type with per-type detail blocks (On-Grid net-metering, Off-Grid DoD/autonomy/MPPT, Hybrid chemistry/grid-charge, Solar Pump HP/head/LPH). Material Kits (Solution Kits) — new backend collection with CRUD + auto-match, dedicated `/dashboard/inventory/kits` admin page, one-click "Apply Kit" in Materials step. Draft resume banner (localStorage) + Review & Submit dialog on wizard final step.
  - **Phase 1**: What3Words made manual-only (API removed), Google Drive folder link made optional, JWT_SECRET fail-fast startup validation, test suite refactored to use `TEST_ADMIN_PASSWORD` env var.
  - **Phase 2 — 4th System Type "Solar Pump" + per-type detail fields**: `ProposedSolutionSection` now offers On-Grid / Off-Grid / Hybrid / **Solar Pump** with system-type-specific detail blocks — On-Grid: Net Metering + Export Limit; Off-Grid: DoD + Autonomy Days + Charge Controller (MPPT/PWM); Hybrid: Grid-Charging toggle + Battery Chemistry (LiFePO4/Li-ion/Tubular/Gel); Solar Pump: HP + Pump Type (Submersible/Surface/Openwell) + Total Head + Discharge (LPH) + Controller (DC/VFD) + Water Source. Auto-sizing: Solar Pump derives system_size_kw = HP × 0.75 × 1.2. `ProjectDetails` System Configuration card renders per-type detail sub-block.
  - **Phase 3 — Material Kits (Solution Kits)**: New backend collection `material_kits` with full CRUD `/api/material-kits` + `/match` endpoint (range-first, then nearest-capacity) + `/seed-starter` (8 idempotent kits: 2 per system type). Dedicated admin page `/dashboard/inventory/kits` with filter chips, kit editor (inventory-item picker + free-text lines + qty formula), and Seed Starter Kits button. Inventory page toolbar gains a "Solution Kits" link. In the New Project wizard's Materials step, kits auto-suggest based on `system_type + capacity`, one-click "Apply Kit" populates `selected_items`; "Browse all kits" details expander shows the full library.
  - **Phase 4 — Draft Resume + Review dialog**: LocalStorage-backed draft autosave (3-second debounce). On wizard mount, if a fresh draft exists (customer name set, <7 days old) a **Resume Draft** amber banner offers Resume / Discard. Last-step submit now opens a **Review & Submit** dialog showing Customer, Location, Proposed Solution (with type-specific summary), Materials count + total, Documentation status. Back-to-Edit or final submit from the dialog; localStorage draft is cleared on successful create. *(Feb 2026)*

## P2 - Future
- [ ] WhatsApp Business API & Email delivery for quote sharing
- [ ] Refactor server.py (~4000 lines) into modular routers
- [ ] Embed Unicode font in jsPDF so ₹ renders natively in PDFs
- [ ] Dead Stock classification (no movement for extended duration)
- [ ] Reorder Suggestions card driven by Fast-moving + low stock
