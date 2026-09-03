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

## Iteration 46 — DONE (2026-09-03, tested via testing_agent, 38/38 new pytest pass)
1. **Labour & Subcontractor Management** (`/dashboard/partners`, `backend/partners.py`): partner directory (external_subcontractor/internal_team), versioned rate cards, project assignments priced off rate card (gross = qty×rate), retention held/released (gated on `subsidy_tracking.net_meter_installation_date` — DISCOM commissioning), payments posting into `account_entries` (entry_type=`partner_payment`), scorecard (on-time rate, avg quality). New "Partner Performance" report.
2. **Ecommerce module** (`/dashboard/ecommerce`, `backend/ecommerce.py`): platforms (Amazon/Flipkart/custom), listings linked to `inventory_items`, orders (stock decremented via `inventory_movements` on create, restored on cancel/return — no double-restore), CSV import (preview-before-commit), reconciliation tab. New "Ecommerce" report. CEO dashboard shows ecommerce revenue/commission/net_revenue as its own section (not blended with project/counter-sale revenue).
3. **T&C linkage**: `terms_conditions` now has `category` (quotation/invoice/amc); GST Invoice (Combined/List) and Kit Quotation PDFs pull the active template per category instead of hardcoded text.
4. **Task 3 (this session)**: inline "Assign Partner" card on Project Details (`ProjectPartnerCard.js`, new backend `GET /partners/assignments/by-project/{id}`) — assign a partner to the current project without leaving the page; shares the same data as the standalone Partners module.
- Post-testing_agent fixes: `GET /reports/ecommerce` was returning a nested dict (`listing_status`) inside `summary`, crashing ReportsPage (React "object as child") — flattened to scalar `listings_live/draft/paused/delisted` fields + added a defensive `formatSummaryValue` guard for any future non-primitive. `POST /ecommerce/orders` and CSV import-commit decremented stock with `reference_id=null` (order inserted after decrement) — now pre-generates the order `_id` so `inventory_movements` correctly trace back to the order. Added order-status (placed/shipped/delivered/returned/cancelled/refunded) and payment-status (pending/settled) dropdowns to the EcommercePage Orders tab so the existing stock-restore-on-return backend path is reachable from the UI (previously read-only). `PartnerDetail.js` had a pre-existing typo (`projectsAPI.list` — does not exist) that silently emptied the project picker in "New Assignment"; fixed to `projectsAPI.getAll('approved')`. Data hygiene: deleted 4 leftover `TEST_Invoice_Terms_*` templates and re-activated "Standard Invoice Terms" for category=invoice (a TEST template had been left active, which would have embedded test clauses in real GST invoices).
- New regression suite `backend/tests/test_iter46_partners_ecommerce.py` (38/38 pass).

### Backlog (flagged by testing_agent, not fixed this session — needs a product decision or separate pass)
- Partner assignment cost does not feed the Project Profit Calculator's "Labour/Subcontractor" figure (it still reads only `cost_estimation`) — decide whether subcontracted labour should override/add to that number.
- `POST /api/auth/register` is a pre-existing (not Iter 46) open endpoint that accepts an arbitrary `role` and sets session cookies for the caller — potential admin self-demotion/privilege issue. Flagged for a dedicated auth-hardening pass (requires `integration_expert` per auth rules), not fixed in this session.
- Cosmetic: `PartnerDetail`/`ProjectPartnerCard` assign-dialog logic duplicated (~40 lines) — could extract a shared hook. `server.py get_report()` is a very long single function (~700+ lines across 22 report branches) — flagged by testing_agent for a future extraction into per-report modules, not done (large refactor, no functional impact).
- 80 pre-existing pytest failures found when running the FULL `backend/tests/` suite (2026-09-03) — all in legacy files from iterations 5/6/12/13/14/15/16/18/21/23/24/31/44, referencing report_type names or endpoints that were renamed/migrated in later iterations (e.g. `report_type=sales` → `sales_revenue`, old `/catalogue/products/*` tests after the catalogue→inventory_items migration). Confirmed unrelated to this session's changes (all Iter 46/51 suites — 69/69 — pass). Not fixed; would need a dedicated legacy-test-cleanup pass.

## Iteration 46 revision pass — DONE (2026-09-03, 69/69 pytest across iter46/51/terms suites, testing_agent pass)
Closed the remaining gaps from the full original Iter 46 spec ("Definition of done"):
- Partner Performance report: added `district` (text) + `speciality` (dropdown) filters, both on the API (`GET /reports/partner_performance`) and the Reports page UI.
- Ecommerce report: added `platform_id` + `category` filters; added a "Revenue by Platform" table and a new "Revenue by Month" (`monthly_rows`) breakdown, both rendered on the Reports page.
- Detailed Quotation PDF (`ProjectDetails.js generatePDF`) previously had NO "Terms used: {title} (v{version})" footer — added it, matching the pattern already in `gstInvoicePDF.js` and `kitQuotationPDF.js`. Verified via testing_agent: all 3 document types (Detailed Quotation, Kit Quotation, GST Invoice Combined/List) show the correct matching template title+version, no `TEST_` leakage.
- Post-testing_agent fixes (iteration_51.json): `summary.net_margin` on the ecommerce report now subtracts COGS (previously only revenue−commission, contradicting the per-item table below it); `PUT /ecommerce/orders/{id}` auto-stamps `settlement_date` server-side when `payment_status→settled` instead of trusting the client; added `DELETE /ecommerce/orders/{id}` (admin-only, restores stock if still active) + a delete button on the Orders tab so bad/test orders can be removed; fixed a duplicate-React-key console warning on the Reports "Visual Breakdown" chart; made `formatSummaryValue` currency detection key-driven instead of magnitude-driven (previously small ₹ amounts showed with no symbol and large counts could get a false ₹ prefix).
- Data hygiene: deleted all leftover `TEST_*`/`Test *` seed rows across `partners`, `partner_assignments`, `partner_payments`, `ecommerce_platforms`, `ecommerce_listings`, `ecommerce_orders`, `terms_conditions`, and 7 orphaned `inventory_movements` (null `reference_id` from the pre-fix era) — restoring stock first for any test orders that were still "active". Reports now reflect only real data.
- New tests added to `backend/tests/test_iter51_new_gaps.py` (21 tests) covering the new filters, summary-flatness regression, and the reference_id/movement fixes.

## Iteration 47 — DONE (2026-09-03, 86/86 pytest pass; testing_agent E2E pass with 7 fixes applied post-report)
Multi-module revision pass on Iter 46 features + brand-new Customer Support module:
1. **Labour & Subcontractor Management**:
   - Full partner edit (`PUT /api/partners/{id}`) — every field editable; status-change guard blocks moving `active → inactive/blacklisted` when live assignments exist unless `force_status_change=true` with a `status_change_reason` (kept in the audit trail).
   - **Speciality tags** now admin-managed (new `speciality_tags` collection + `GET/POST/PUT/DELETE /api/partners/tags/*`); the tag list itself is editable — rename cascades to every partner record. Directory filter accepts a comma-separated `specialities` list with AND semantics ("Plumbing AND Electrical").
   - Rate-card row edit-in-place (`PUT /api/partners/{id}/rate-card` — for typo fixes) alongside the existing append endpoint (versioned adds for real rate changes). Historical assignments already store the rate on the assignment line, so past pricing is preserved either way.
   - Partner directory shows the rating as a 5-star display (half-star supported) with the exact numeric on hover; filter by `min_rating` and sort by rating/business/name.
2. **Vendors tab**: added filters (`category`, `status`, `district`) + search across name AND GSTIN + sort options (`business_desc`, `recent_desc`, `recent_asc`). Backend now attaches computed `business_value` and `last_order_date` per vendor by matching `purchase_orders.supplier_name`. New `district` + `payment_terms` fields on the vendor form.
3. **AMC Customer Support module** (new): `backend/support.py` + `frontend/src/pages/SupportTicketsTab.js` wired as a 3rd tab in `/dashboard/amc`.
   - New `support_tickets` collection with ticket_number (`TKT-00001`), SLA tracking (response + resolution), 7-state status workflow with enforced transitions, timeline audit per ticket, CSAT capture on close (fed into technician performance).
   - Admin SLA config endpoint (`/api/support/sla-config`) — per-priority response/resolution hour targets. Breach and SLA bucket (`on_track / at_risk / breached`) computed per ticket.
   - Dashboard summary (`/api/support/dashboard`) — open, overdue, avg resolution, avg CSAT, top recurring categories, monthly volume.
   - New `report_type = customer_support` on `/api/reports/*` — summary (response/resolution breach %, avg CSAT), rows, monthly, technician-level performance, top recurring categories. UI renders technician table + monthly + top-recurring pills.
4. **Ecommerce**:
   - `PUT /api/ecommerce/platforms/{id}` fully editable; commission_pct on the platform is reference-only (labelled as such in the UI), never auto-copies to a listing.
   - Every listing must carry its own `platform_commission_pct` before its status can be `live` — enforced on POST, PUT, AND `bulk-status` (previously the bulk endpoint bypassed the rule, flagged by testing_agent and fixed). `_effective_commission_pct` favours the listing rate; past order commission stays immutable.
5. **Hard delete** (admin-only, distinct from cancel/reversal):
   - `DELETE /api/hard-delete/sale/{id}`, `.../purchase-order/{id}`, `.../delivery/{id}` — requires a written reason (min 3 chars), reverses stock/customer_credit before removing, blocks on dependent records (returns, submitted material reconciliations, consumed inbound stock), warns (409) on GST-filed sales that need explicit acknowledgement, stores a full snapshot of the deleted record in the audit log.
   - UI: shared `HardDeleteButton` component wired into DirectSalesPage / PurchaseInboundPage / DeliveryOutboundPage (visible for admins on all row states including cancelled — first testing_agent iteration had it hidden for cancelled sales, fixed).
6. **CEO dashboard** picks up the Customer Support snapshot (Open / Overdue / Avg Resolution / Avg CSAT) and the PDF export includes support metrics + technician performance + top recurring categories + partner performance on the single page.
7. **Post-testing_agent fixes** (iteration_52.json): commission-before-live guard applied to `bulk-status`; `support.first_response_at` now only auto-stamps on real assignment (was stamping on any first edit); ReportsPage renders `technician_rows` + `monthly_rows` + `top_recurring`; sale hard-delete visible for all statuses; user-facing copy on the status-guard error; duplicate React key on customer credits table fixed; `vendor-payment-terms-input` testid added.
- New regression suite `backend/tests/test_iter47_revamp.py` (17 tests): rate-card versioning + in-place edit, tag CRUD + AND filter, vendor filter/sort, SLA breach + status workflow + CSAT bounds, customer_support report shape, live-listing commission guard, hard-delete validation.

## Credentials
See `/app/memory/test_credentials.md`. Admin: admin@sensoper.com / Admin@123
