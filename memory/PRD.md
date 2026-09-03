# Sensoper Solar ERP — PRD

## Original problem statement (Iteration 44, 4 batches)
1. Indian tax invoice (PDF) generation in Project details (configurable sequence, GSTIN, HSN/SAC, CGST/SGST vs IGST).
2. Project profit calculator — admin-only, on project detail page.
3. Simplify Solar Calculator (Step 4): System Type + kW + Panel/Inverter picker from catalogue, cost/subsidy/payback, full engine behind "Advanced" toggle.
4. Pricelist tab: manage catalogue, generate PDF.
5. Customer Credit report restricted to financial data only.
6. Assets register bug fix (blank list/categories).
7. Reading Analysis report (generation trend, vs estimate).
8. Audit module extension (deadlines, PDF).
9. Employee Performance report (auto + manual metrics, PDF).
10. Vendors tab.
11. Operational Expense report.

User explicitly requested this be built in 4 batches, testing (pytest + testing_agent) after each batch.

## Status by batch

### Batch A — DONE (tested, 14/14 pytest, testing_agent pass)
- `ProjectProfitCard.js` — admin-only profit calculator on project detail.
- GST Tax Invoice: `invoicing.py`, `ProjectInvoiceCard.js`, `gstInvoicePDF.js`. CGST/SGST vs IGST by state, HSN/SAC auto-fetch, configurable invoice prefix/next-number in Company Profile.

### Batch B — DONE (2026-09-02, tested via testing_agent + self-verify, all pass)
- **Simplified Solar Calculator** (`ProposedSolutionSection.js`): default/simple view = System Type, System Size (kW), Monthly EB Bill, Location, Panel picker (catalogue), Inverter picker (catalogue), Total Cost (auto), Subsidy ₹ (always manual — no auto slab), Net Cost (auto). "Show more options" toggle reveals the full pre-existing advanced engine unchanged (driver inputs, on-grid/hybrid/off-grid/pump blocks, hardware overrides, fuel, ROI).
  - Cost formula: panel cost = catalogue price-per-watt × kW×1000 if panel selected, else 45% flat share of COST_PER_KWP; inverter cost = catalogue selling price if selected, else 15% flat share; BOS = flat 40% share.
  - `calcSubsidy()` slab function removed — subsidy is now always a manual/custom entry per user's explicit choice.
- **Pricelist page** (`PricelistPage.js`, new route `/dashboard/pricelist`, admin-only nav item): flat searchable/filterable table across all 6 catalogue categories, inline-editable Margin % / Selling Price (Rate for services), "Generate Price List PDF" button (`priceListPDF.js` — company-branded, per-item CGST+SGST breakup using global `gst_pct`).
  - Fixed post-testing: company name field mismatch (`company_name` not `name`), PDF currency 3-decimal rounding bug, stale selling-price cell after margin edit (now recomputes when no explicit selling_price override exists; forces input remount via `key`).
- Backend: no changes needed — `catalogue.py` CRUD already supported everything. New regression suite `backend/tests/test_iter44_batch_b_pricelist.py` (17/18 pass, RBAC verified 403 for non-admin writes).

### Batch C+D — DONE (2026-09-02, tested via testing_agent, 21/21 new pytest pass)
- **Verified already-satisfied (no code change needed)**: (5) Customer Credit report/page already financial-data-only (no cost/margin leak). (6) Assets register already renders correctly (list + category filter) — bug not reproducible.
- **Reading Analysis report** (new report_type + `ReadingsPage.js`): readings now carry `estimated_monthly_kwh` + a `generation_logs` array (Log Generation dialog, amber lightning icon per row). Reports > Reading Analysis shows actual vs estimated kWh, variance %, monthly trend chart. Sites with zero logs show "No Logs Yet" (not misleading -100%).
- **Audit owner** (`WeeklyAuditPage.js`, `PUT /audits/{id}/issue`): issue form now has an Owner field, shown in the issue list as "· Owner: X". Deadlines + PDF export already existed (audit report already supports generic PDF/Excel via Reports page).
- **Employee Performance report** (new report_type + `employee_scores` collection): auto metrics (projects_handled/completed, revenue, daily_updates_logged) merged with manual scores. "Log Performance" star-icon dialog added to `UserManagement.js` (period, score 1-5, notes) → `POST /employee-scores` (admin/manager only).
- **Vendors tab** (new `backend/vendors.py` + `VendorsPage.js`, nav item, admin+manager): supplier CRUD (name, category, GSTIN, contact), search, PO History dialog (`GET /vendors/{id}/purchase-orders`, matches `purchase_orders.supplier_name` case-insensitive against vendor name).
- **Operational Expense report** (new report_type): focused view of `entry_type=operational_expense` only, with monthly trend chart (existing "Expenses" report unchanged, kept both).
- Fixed post-testing: ReportsPage summary cards no longer show ₹ prefix on kWh/count/staff/entries values, and % suffix added for variance/pct fields; `employee_performance` field renamed `projects_assigned`→`projects_handled` (accuracy, it's creator-based not assignee-based); `vendors.py` router instantiated inside factory (was module-level, latent duplicate-registration risk); vendor search debounced 300ms.
- New regression suite `backend/tests/test_iter44_batch_cd.py` (21/21 pass) covering vendors CRUD/RBAC, readings generation logs + report math, audit owner persistence, employee-scores CRUD/RBAC, operational_expense isolation, and the two "already satisfied" regression checks.

## Architecture notes
- Modularity rule: new features go in dedicated router files (`invoicing.py`, `catalogue.py`, `vendors.py`, etc.), never grow `server.py`.
- Recharts `<Cell>` component crashes React — avoid, use CSS/props instead.
- Catalogue collections: `panel_products`, `inverter_products`, `battery_products`, `pump_products`, `structure_products`, `service_rates`, `fuel_types`, `price_history`, `addon_groups`. Global defaults in `pricing_config` (incl. `gst_pct`).
- Company profile field is `company_name` (not `name`) — GST invoice util already correct, price list util fixed to match.

## Known housekeeping (not urgent, flagged by testing_agent)
- Catalogue has ~14 leftover `TEST Panel_TEST_*` / `TEST Inv_TEST_*` rows from earlier test iterations, visible in Pricelist/PDF. Cleanup recommended whenever convenient.

## Iteration 45 — DONE (2026-09-03, tested via testing_agent, 34/34 new pytest pass)
1. **Invoice Combined/List format toggle** — done in a prior session (`ProjectInvoiceCard.js`, `gstInvoicePDF.js`).
2. **Calculator simplified to strict 4 fields** (`ProposedSolutionSection.js`): System Type, System Size (kW), Panel picker, Inverter picker (live from `inventory_items`) → result strip (Total Cost, manual Subsidy, Net Cost, Payback). No advanced toggle, no driver inputs. Solar Pump keeps its own hydraulic flow (path/flow/head/bore/controller-Vmax/string-V → `POST /calculate/solution`). Verified exact math by testing_agent (5kW example: ₹2,78,750 total, ₹50k subsidy → ₹2,28,750 net).
3/4. **Catalogue → inventory_items migration** — done in a prior session; `panel_products` etc. dropped, Pricelist/Calculator read directly from `inventory_items`.
5. **Assets register blank-list/category bug** — fixed in a prior session + regression test `test_iter45_assets_fix.py`.
6. **Location-scoped report exports (this session)**: new shared hook `frontend/src/components/LocationScope.js` (`useLocationScope` + `LocationScopeSelect`) — admins get "All Locations — Consolidated" + any location; non-admins restricted to their assigned location(s) (auto-selected+disabled if exactly one). Wired into:
   - Reports page (generic `/api/reports/{type}` engine — sales_revenue/profit_leakage/project_execution/inventory_material/amc/assets/tools/inbound/outbound all scope-filtered via `location_scope_filter()`), location label + PDF/Excel headers show it.
   - Assets page's own Reports tab (`/assets/reports/{type}?location_id=`).
   - CEO Dashboard (`/dashboard/ceo?location_id=`) + new "Export PDF" KPI-summary button.
   - AMC Dashboard (`/amc/{dashboard,contracts,recurring-revenue-report}?location_id=`) + new PDF/Excel export on Recurring Revenue Report tab.
   - Expansion page: PDF/Excel export added to Ranked Opportunities table (company-wide, no location scoping — expansion data is district/market-based, not org-location-based).
   - Backend: `location_scope_filter()` from `locations.py` (pre-existing, unchanged) now also applied in `assets.py::asset_report` and `amc.py` (contracts/dashboard/revenue-report), plus `server.py`'s reports engine and CEO dashboard.
   - Post-testing fixes: Excel export buttons now `disabled` when `rows.length===0` (previously silent dead-click) on Assets/AMC/Expansion; `/api/reports/assets` returns `rows: []` instead of a misleading "No data yet" placeholder row when scoped to an empty location; `useLocationScope` localStorage key now namespaced per user id (was previously bleeding a stale location choice across user switches on the same browser).
   - Regression suite: `backend/tests/test_iter45_location_scope.py` (34/34 pass) — locations list, reports×5 types with/without location_id + bogus id + staff 403, CEO dashboard, assets reports×4 types, AMC×3 endpoints, expansion overview, calculator config/solution.

### Remaining backlog from testing_agent (not urgent)
- `AssetsPage`/`AMCDashboard`/`ExpansionPage` empty-export buttons now disabled (fixed) rather than toast-driven — acceptable UX, no further action needed unless requested.
- Reports page date filters use native `<input type=date>` instead of the shadcn Calendar — cosmetic inconsistency, optional.
- `SiteVisitForm` step chips have no `data-testid` — optional testability improvement, not user-facing.

## Credentials
See `/app/memory/test_credentials.md`. Admin: admin@sensoper.com / Admin@123
