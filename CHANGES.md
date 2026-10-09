# Sensoper — October 2026 restructure

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
