# Sensoper — change log

## October 2026 · Customer dashboard, attendance, organisation chart

### Customer dashboard (`/my/<link>`)
- **Sharing:** project page → **Customer dashboard** → Create link → **Send on WhatsApp**.
  - The customer opens the link and enters their registered mobile number once. They then stay signed in for 30 days on that phone. There's no password or SMS.
  - The number check allows 8 wrong tries per 15 minutes.
  - **New link** replaces the old link; **Turn off** disables it.
- **What the customer sees:**
  - **Hero:** savings so far, savings per month and CO₂ avoided.
  - **Breakeven:** a progress ring, the payback date and 25-year savings.
  - **Planet:** CO₂ avoided so far, per year and over 25 years, the tree equivalent, and units generated. Units are measured when Readings have data, otherwise estimated.
  - **Installation journey:** site visit → approval → installation (progress from the Site diary) → switched on → net meter → handover.
  - **Plant and money:** panels, inverter and battery; payments and balance.
  - **Service:** AMC plan and next service visit, warranty.
  - **Offers** with "I'm interested".
  - **Support:** their support requests, plus a **Need help?** form. Each request becomes a support ticket (`reported_via: customer_dashboard`) in AMC → Support.
  - **Contact:** call, WhatsApp and email buttons.
- **Customer offers** (Sales menu, admins and managers): create offers (badge, valid till, which system types see them) and call back the people who tapped "I'm interested".
- **CO₂ factor:** 0.82 kg per grid unit, the same as the solar sizing calculator. A tree absorbs about 21.77 kg CO₂ a year.
- **Backend:** `backend/customer_portal.py`. New collections: `customer_portal_links` (token stored hashed and encrypted), `customer_offers`, `offer_interests`, `portal_attempts` (24 h TTL). The ticket logic is now shared through `support.open_ticket`.

### Attendance (Daily work → Attendance)
- **Check in / Check out** saves the time and the phone's GPS. Everyone has it, and Home reminds people who haven't checked in.
- Admins and managers get:
  - a **Team** tab: who is in or out, hours, map links, and a pencil to correct a time (logged);
  - a **Monthly register** (P / H / A / Sunday) with Excel download.
- In the register, days before someone joined, or before attendance started being used, are blank rather than "absent".
- **Scope:** managers with locations see their locations' people.
- **Backend:** `backend/attendance.py`, collection `attendance` (one record per person per day, India time).

### Organisation chart (People & field → Organisation, admins only)
- Leadership (admins) on top, then each location with its managers, staff and field teams.
- Every person shows today's attendance and their open projects.
- People with no location are listed at the bottom so they can be assigned.
- **Backend:** `backend/org_structure.py` (`GET /api/org-structure`, admin only).

### Login page
- It now reads "Welcome to Sensoper", with a short corporate introduction (Solar EPC end to end · Built to last · Powering a cleaner India). The old "Solar Project Cost Estimator" wording is gone.

### Project photos: camera and gallery
- Every photo slot on the site photo checklist (New project and the project page) has separate **Camera** and **Gallery** buttons. Proof of visit is camera-only, so an old photo can't be stamped with today's GPS.
- The Site diary has **Take photo** and **From gallery** as well.
- A new **More project photos** section (up to 30 files) takes any other picture or PDF. Like the rest, it's copied to Google Drive under `6 More photos`.

## October 2026 · What3words removed (GPS coordinates only)
- **Location step:** **Use my location** fills in latitude and longitude, with an "Open in Google Maps" link. The 3-word box and its refresh button are gone. The step needs either the GPS or a site address.
- **Project page:** **Update location** saves the phone's GPS only (`PUT /api/projects/{id}/geo`). The What3words row is gone, and the Excel export shows GPS instead.
- **Proof-of-visit photo:** the stamp shows customer, date/time and GPS.
- **Settings:** the What3words card is gone. The server no longer has `/api/geo/what3words*` and ignores `W3W_API_KEY`. On startup it deletes the `w3w_cache` collection and the saved (encrypted) What3words key.
- **Old projects:** a stored `site_location_words` stays in the database but isn't shown. Saving a project from the form clears it.
- **Code:** `backend/geo_w3w.py` is replaced by `backend/geo_location.py`.
- **Bug fix:** saving New project used to drop the PIN code, district, state and DISCOM that the Proposed Solution step had filled in. These now save with the project.

## October 2026 · go-live helpers
- **No server editing needed for keys.** If `VAULT_MASTER_KEY` isn't set, the server creates one at `STORAGE_ROOT/.keys/vault_master.key` (mode 600) the first time it's needed. Settings can then store the Google and What3words keys straight away. Back that file up.
- **Settings → Google Drive** accepts the whole `client_secret_….json` downloaded from Google Cloud Console. It saves the client ID and the secret together, and refuses a file whose redirect URIs don't include this app's callback. Settings also shows which OAuth client is in use.
- Settings now tells you to **Publish** the OAuth consent screen. In "Testing" mode, Google ends the Drive connection every 7 days.

## October 2026 · follow-ups

- **Solution kits:** removed "Seed Starter Kits" (the button, the empty-state button and `POST /api/material-kits/seed-starter`). Kits it already created stay in the library; delete them from Solution kits if you don't want them.
- **What3words:**
  - An admin can paste a new API key in **Settings → What3words**. It's checked with What3words, stored encrypted, and wins over `W3W_API_KEY`.
  - The Location step has a refresh button inside the 3-words box. It gets the words for the current GPS coordinates.
  - The project page has **Update location**, which saves the phone's GPS and the 3 words to a saved project in one tap (`PUT /api/projects/{id}/geo`). It works in any status and doesn't send the project back for approval.
- **Google Drive:**
  - The redirect now defaults to `https://quote.sensoper.in/auth/google/callback`.
  - The OAuth client secret can be pasted in **Settings → Google Drive** instead of editing `.env`. It's stored encrypted.
- **Project date:**
  - New project asks for a **Project date** (today by default) and stores it as `project_date`.
  - It shows on the project page, in the Projects list, the review dialog and the Excel export.
  - Older projects show the day they were created (IST).
- **Proposed solution (Step 4 calculator):**
  - **EB bill comes every 1 month / 2 months.** With 2 months, the bill and units are entered per bill. The calculator works per month and also shows savings per 2-month bill.
  - **Feed-in rate (₹/unit):** what the DISCOM pays for surplus units exported (on-grid and hybrid).
  - **Network charge:** ₹ per unit of solar generated, or ₹ per kW per month. It's taken off the saving.
  - A line under the result shows: units saved + surplus sold − network charge = saving. The quotation PDF lists the billing, surplus and network-charge figures.
  - Old projects compute exactly as before; the new inputs default to monthly and 0.
  - The engine change is mirrored in `backend/quick_calc.py` and `frontend/src/utils/solarCalc.js`. `backend/tests/test_calc_billing.py` checks both give the same numbers.

## October 2026 · Site photos to Google Drive, What3words, simpler Settings

### Site photos checklist (New project → Site photos)
- The last step of New project is now a photo checklist in five sections — Site & access, Roof, Electrical, Documents, Proof of visit — 23 items, 19 required (sheet-roof details, existing earthing, UPS/DG and C&I panels are "if applicable"). "Full roof from all 4 corners" needs 4 shots and "EB bill — both sides" needs 2. The bill and consumption history accept PDFs.
- Photos are shrunk on the phone before upload (about 1600 px, roughly 150–300 KB) and keep the phone's GPS when location is allowed.
- **Proof of visit** asks for the location and stamps customer, date/time, GPS and the What3words address in a strip under the photo.
- The project page has the same checklist, so missing photos can be added after the project is submitted, without sending it back for approval.
- The old "Drive folder link" box is still there, folded away, for customers who already have a folder.

### Google Drive
- An admin connects the company Google account once in **Settings → Google Drive**. After that, every site photo is copied to Drive by itself: `Sensoper — Site photos / SCR-XXXXXX · Customer · District / 1 Site & access …`.
- Copies happen right after each save, and a background job retries every 10 minutes. Each file carries the photo's id, so a retry never makes a duplicate. If the photo folder is the only Drive folder on the project, the project's Drive link points at it.
- The app only gets the `drive.file` permission, so it can see only the folders and files it creates. The Google refresh token is stored encrypted with `VAULT_MASTER_KEY`.
- Backend: `backend/site_photos.py` (checklist, upload, project photo endpoints), `backend/google_drive.py` (OAuth connect, sync). New collections: `site_photo_uploads`, `integrations`, `oauth_states`. New project fields: `site_photos`, `site_photos_pending`, `site_photos_drive`.

### What3words
- New project → Location has a **Use my location** button. It fills in latitude/longitude, then the What3words address and the nearest place. Typing coordinates fills in the words as well, and typing the words fills in empty coordinates (that needs a What3words plan that allows it). Words a person typed are never overwritten, except when they tap the button again.
- The key stays on the server (`W3W_API_KEY`), is sent to What3words in a header (so it isn't written to logs), and results are cached in `w3w_cache`. Backend: `backend/geo_w3w.py`.
- The project page shows the What3words address and GPS as links.

### Settings (was "Pricing & config")
- Only the basics are left: cash rounding (₹1 / ₹10 / ₹100, nearest / up / down), overdue interest, design temperature, the monthly sales target, and the Google Drive / What3words connections.
- Package slab rates, calculator benchmarks and service rates moved to **Price list**, which now has three tabs: Products, Package slabs, Service rates.
- Health-score weights, expansion weights and per-location targets are no longer on screen. Their stored values keep working.

### Security
- The What3words key used by an earlier version was committed to this public repo (`test_reports/iteration_24.json`, now redacted; it is still in git history). Create a new key and put it only in the server's `.env`.

### Tests
`backend/tests/test_site_photos_drive.py`, 12 tests. They use fake Google and What3words servers and an in-memory database, so no network or MongoDB is needed:

    cd backend && pip install mongomock-motor pytest && pytest tests/test_site_photos_drive.py

---

# October 2026 restructure

## What changed

### Bugs fixed
- **Admin password reset on every restart.** Startup re-applied `ADMIN_PASSWORD` (or `Admin@123`) to the admin account on every deploy, undoing any password change. The admin is now only created if missing. To recover a lost admin password, set `RESET_ADMIN_PASSWORD=true` together with `ADMIN_PASSWORD` for one restart, then remove it. A brand-new admin created with the built-in default password is asked to change it.
- **Admin credentials written to disk.** Startup no longer writes `/app/memory/test_credentials.md`.
- **"Unexpected token '<'" crash.** The service worker served `offline.html` in place of any failed third-party script (ad-blockers, flaky network). It now leaves other sites' files alone (`service-worker.js` v1.2.0).
- **Emergent leftovers.** Removed Emergent's script and PostHog analytics from `index.html`. Logo, favicon, app icons and PDF fonts are now inside the app (`public/`), so they no longer depend on Emergent's CDN or jsDelivr.
- **Broken links.** CEO dashboard tiles linked to `/dashboard/accounts` (doesn't exist) and to renamed reports (`sales`, `profit`, `execution`, `inventory`), which opened a blank page.
- **Company Health Score.** The "daily updates in the last 30 days" signal always read 0 (it looked for a `date` field the entries never had).
- **Daily updates permissions.** Any user could edit or delete anyone's entries; staff now only see and change their own.
- **Projects list.** Didn't return `created_by` or system size; shows "kW" from the calculator.
- **Login page.** "Create account" pointed to a sign-up that only works for the very first user. It now explains how to get an account.
- **Phone layouts.** Sideways scrolling fixed on Direct sales, AMC, Inventory, Solution kits, Price list, Users, Activity log and My login & 2FA.
- **Smaller fixes.** Sidebar highlighted two items at once on New project. Expansion page had invalid HTML nesting. Asset-document delete used a query some Mongo-compatible stores reject.

### Removed
- **Sensobrain**: page, menu item, `backend/sensobrain.py`, `/api/sensobrain/*`, the legacy `/api/ai/recommendations` endpoint, the `module_sensobrain` permission and the `openai` dependency.
  - The old data is still in MongoDB. To delete it: `db.sensobrain_settings.drop(); db.sensobrain_conversations.drop(); db.sensobrain_usage.drop()` (the settings collection holds the encrypted OpenAI key).

### New: daily reporting
- **Daily report** (`/dashboard/daily-report`): one report per person per day — sites worked on, leads, payments collected, service visits, wrap-up and tomorrow's plan. Has Save draft / Submit, a Team tab for managers (submitted / draft / not started, review with a note) and a History tab. PDFs come per report, per team-day or per date range.
- **Site diary** (`/dashboard/site-diary`): one page per project per day. It records crew, stages finished, progress %, materials, safety, photos and next steps, and shows the previous day's next steps. PDFs come per day or as the whole installation record.
- Backend: `backend/daily_reports.py` (new collections `daily_reports`, `site_diaries`). Submitted reports and diaries also write tagged rows into `daily_updates`, so the Marketing report, project timeline, health score and performance reports keep working.
- The old `/dashboard/daily-updates` URL redirects to the daily report.

### Restructured app
- **Navigation** (`frontend/src/lib/navigation.js`): 7 sections, with a "Find a page" search. Staff get a short menu: Home, Daily report, Site diary, Readings, New project, Projects, Direct sales, Assets & tools, My login & 2FA.
- **Help on every screen**: the Help button explains what the page is for and how to use it.
- **Phones**: slide-out menu plus a bottom bar (Home, Projects, +New, Report, Menu).
- **Home**: quick actions, a "Needs attention" list, numbers and latest projects. The CEO dashboard is now the **Business health** tab (`/dashboard/ceo` redirects there).
- **Projects list**: status chips with counts, search by name / phone / ref / district, and a "Mine" filter.
- **Project page**: one action row — Edit, a **Documents** menu (all PDFs, Excel, WhatsApp), Generate invoice and Site diary.

### Production hardening
- Auth cookies (login, refresh, 2FA) get the `Secure` flag automatically when the site is reached over HTTPS (`COOKIE_SECURE=auto`, the default).
- A startup warning appears if `CORS_ORIGINS` is still `*`.
- `backend/.env.example` and `frontend/.env.example` document every setting. Real `.env` files stay git-ignored.
- `memory/PRD.md` no longer contains the admin password (the repo is public).
- `frontend/yarn.lock` added, so every deploy installs the exact package versions this release was built and tested with.
- Removed the `@emergentbase/visual-edits` dev package, which was downloaded from Emergent's server on every install. It only powered Emergent's in-editor visual editing.

## Deploying
See **DEPLOY.md** for the step-by-step checklist. Nothing new to install; your existing `deploy.sh` works as-is.

## Tests
`backend/tests/test_daily_reports.py` (11 tests) covers daily reports, site diary, permissions and the legacy mirror. `backend/tests/test_secure_cookies.py` (2 tests) covers the cookie flag:

    REACT_APP_BACKEND_URL=https://quote.sensoper.in pytest backend/tests/test_daily_reports.py
