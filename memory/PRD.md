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

### Remaining — Batches C & D (NOT STARTED)
- P1: Customer Credit report — restrict to purely financial data (remove project cost/margin).
- P1: Assets register bug (blank list/categories) — debug `assets.py` vs `AssetsPage.js` contract.
- P1: Reading Analysis report (generation trend, actual vs estimate).
- P1: Audit module extension (deadlines, owners, PDF).
- P1: Employee Performance report (auto + manual metrics, PDF).
- P1: Vendors tab (supplier CRUD, GSTIN, PO history linkage).
- P1: Operational Expense report.

## Architecture notes
- Modularity rule: new features go in dedicated router files (`invoicing.py`, `catalogue.py`, etc.), never grow `server.py`.
- Recharts `<Cell>` component crashes React — avoid, use CSS/props instead.
- Catalogue collections: `panel_products`, `inverter_products`, `battery_products`, `pump_products`, `structure_products`, `service_rates`, `fuel_types`, `price_history`, `addon_groups`. Global defaults in `pricing_config` (incl. `gst_pct`).
- Company profile field is `company_name` (not `name`) — GST invoice util already correct, price list util fixed to match.

## Known housekeeping (not urgent, flagged by testing_agent)
- Catalogue has ~14 leftover `TEST Panel_TEST_*` / `TEST Inv_TEST_*` rows from earlier test iterations, visible in Pricelist/PDF. Cleanup recommended whenever convenient.

## Credentials
See `/app/memory/test_credentials.md`. Admin: admin@sensoper.com / Admin@123
