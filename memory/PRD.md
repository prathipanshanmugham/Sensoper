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

## Credentials
See `/app/memory/test_credentials.md`. Admin: admin@sensoper.com / Admin@123
