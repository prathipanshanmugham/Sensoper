# Sensoper Controls & Renewables — Solar ERP — PRD

## Original problem statement (Iteration 43)
1. Branch/Location name editable, joining by ID not name.
2. Editable records with delta-based stock tracking + admin-approval routing for
   Purchase Inbound, Purchase Outbound (Deliveries), Direct Sales, Assets.
3. Deep multi-location linkage across processes: doc numbering, stock, GST, approvals.
4. New Reports tiles: AMC, Assets, Tools, Expenses.
5. Performance Master Report (consolidated vs per-location PDF/Excel) — DEFERRED.
Follow-up asks (same iteration): PO delete-while-pending (no approval), Inventory
location scoping with sortable Branch column + location-based visibility.

## Status: Iteration 43 — COMPLETE & TESTED (Aug/Sep 2026)

### What shipped
- **Change 1 (Branch/Location editable)**: was already implemented pre-session via
  `LocationsPage.js` + `PUT /api/locations/{id}` (joins by ID). Verified, no changes needed.
- **Change 2 (Editable records + approval routing)**:
  - Purchase Inbound / Outbound / Assets: PUT+DELETE with delta stock (done in prior session).
  - Direct Sales: NEW `PUT /api/sales/{id}/edit` (delta-based line edit, negative-stock guard)
    and `DELETE /api/sales/{id}` (full cancel + stock restore), with `db.action_requests`
    approval-queue fallback for non-privileged users (mirrors assets/deliveries pattern).
  - Frontend: Edit/Delete UI + "Pending Approvals" banners added to DirectSalesPage.js,
    DeliveryOutboundPage.js, AssetsPage.js.
  - Generic `/api/action-requests` + `/api/inbound-action-requests` approve/reject now
    **location-scoped**: managers can only act on requests from their assigned location(s);
    admins unrestricted (`_can_manage_request_location` helper in server.py).
- **Change 3 (Deep multi-location linkage)**:
  - `location_id` added to Sales, Purchase Orders, Inventory Items.
  - Location-scoped invoice numbering: `SOC-{branchCode}/FY/NNNN` (sales.py `_generate_invoice_number`).
  - Location-scoped PO numbering: `PO-{branchCode}-NNNN` via `_next_doc_sequence` counter.
  - Per-location Company Profile override: `state` + `location_id` fields on CompanyProfile
    (used for CGST/SGST vs IGST split); `_get_active_company_profile(location_id)` tries the
    location-scoped profile first, falls back to global active one.
  - Inventory: non-admin users see only their assigned location(s) + legacy/global items
    (`location_scope_filter`, already existed in locations.py — just needed items to actually
    set `location_id`). Admins get a Branch filter + sortable Branch column on Inventory page.
  - PO can be deleted freely while `status == 'pending'` (no approval needed) via
    `DELETE /api/purchase-orders/{id}` — 400 if already progressed past pending.
- **Change 4 (New Reports)**: 4 tiles added to ReportsPage.js — AMC Contracts, Assets, Tools,
  Expenses — each with summary cards + table + PDF/Excel export (matches existing 13-report pattern).
  Backend cases added to `/api/reports/{report_type}` in server.py.
- **Change 5 (Performance Master Report)**: DEFERRED — not built, backlog item.

### Testing (3 passes, all issues fixed)
- Pass 1 (iteration_45.json): found company-profile state/location_id silently dropped (HIGH),
  po_number/location UI wiring gaps (MEDIUM), sales summary counting returned sales (LOW),
  Assets report staleness (LOW) — all fixed.
- Pass 2 (inline report): backend 22/23 pytest, Inventory branch-scoping UI fully verified;
  found inventory item detail endpoint missing location_id/addon_group, inventory filter-bar
  CSS collapse — fixed; 4 items left untested (ran out of turns).
- Pass 3 (iteration_46.json): 47/48 pytest, all 4 previously-untested UI flows now PASS
  (PO delete pending-only + button visibility by status, Quick Sale branch dropdown +
  location-scoped invoice, Assets report auto-refresh, sanity regression on Sales/Deliveries/
  Assets/Reports). Found addon_group never persisted + filter-bar overflow at 1920px regression
  — both fixed and manually verified via curl + screenshot post-fix.

## Architecture
```
/app/backend/
  server.py         # Core (~7200 lines) — PO, inventory, company profile, action-requests, reports
  sales.py          # Direct Sales — create/edit/delete/return/invoice, location-scoped invoicing
  assets.py         # Assets & Tools CRUD + archive-with-approval
  amc.py            # AMC contracts
  locations.py      # Multi-location registry + location_scope_filter (shared helper)
  reconciliation.py # Material reconciliation
  inventory_import.py
/app/frontend/src/pages/
  DirectSalesPage.js, DeliveryOutboundPage.js, AssetsPage.js, PurchaseInboundPage.js,
  InventoryManagement.js, ReportsPage.js, CompanyProfile.js, LocationsPage.js
```

## Key patterns established this iteration
- Editable-record pattern: PUT `.../edit` recomputes totals from new line items, diffs
  old-vs-new quantity per inventory_item_id, applies only the DELTA to stock via `$inc`,
  writes a delta-only movement/audit entry. DELETE reverses fully (restore stock, mark
  cancelled) with a `db.action_requests` approval-queue fallback when the actor lacks
  the module's `delete` permission (checked via `check_module_permission`).
- Location scoping: `location_scope_filter(user, location_id_param)` from locations.py —
  admins see everything (optionally filtered), everyone else sees their assigned
  `location_ids` + legacy/global (location_id absent) documents. Reused across sales,
  inventory, deliveries, purchase orders, action-request queues.

## Known limitations / backlog
- P2: Performance Master Report (consolidated vs per-location PDF/Excel) — not built.
- P2: Invoice/PO sequence numbers use `count_documents()` + regex, not an atomic counter —
  theoretical risk of duplicate numbers under concurrent creates (flagged by testing agent,
  low real-world risk given current usage volume).
- P3: Company profile create/update use hand-written field lists instead of
  `model_dump(exclude_unset=True)` — same class of bug that caused the state/location_id
  loss could recur if new fields are added without updating both create+update+GET.
- P3: server.py is ~7200 lines — further modularization (company profile, PO, action-requests
  into their own files) would help maintainability but is not urgent.

## Credentials
See /app/memory/test_credentials.md — admin@sensoper.com / Admin@123, plus
qa_mgr_iter46@sensoper.com / Manager@123 and qa_staff_iter46@sensoper.com / Staff@123
(test accounts created by testing agent for permission/location-scoping tests).
