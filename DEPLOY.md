# Deploying Sensoper (Hostinger VPS · quote.sensoper.in)

Your server already has `/root/Sensoper/deploy.sh`. It pulls the code, installs backend packages, builds the frontend,
copies the build to `/var/www/sensoper`, restarts the `sensoper` service and checks the live bundle. This release needs
nothing new installed.

## This release: error sweep and a cleaner look

Code-only release with no new settings. Deploy as usual (`/root/Sensoper/deploy.sh`).

On first start, the server fills in the missing stock cost on direct sales saved without one. The log shows
"Direct sales: filled the missing stock cost on N sale(s)" when it does.

**After deploy, check:**
1. Open a few stock items and older projects; they should open without errors.
2. Delete something harmless, such as a test category. The confirmation is an in-app box, not a browser pop-up.
3. Sales → Direct sales → Summary shows real margins.
4. Find any quote warning "margin … isn't a sensible percentage", open its calculator, enter the margin as a %, and
   save it again.
5. On a project with inverter details, **Show** fetches the password, and Settings → Activity log records it.

## Earlier release: payroll & benefits, help desk, and the https fix for Claude connectors

Nothing new to install. After `./deploy.sh`:

### 1. Claude asked for https — fixed
Sensoper used to build the connector address from what nginx passed on. Without `X-Forwarded-Proto` (or `Host`), it
showed `http://…` or `http://127.0.0.1:8001`, and Claude refused it. Now a public address is always https. Opening
**Settings → AI agents** once as admin also saves the address you use, and **Change** there sets it by hand.

To make it certain, add this line to `backend/.env` and restart (`systemctl restart sensoper`):

    PUBLIC_BASE_URL=https://quote.sensoper.in

Then add the connector in Claude: Settings → Connectors → Add custom connector → `https://quote.sensoper.in/api/mcp`.
If Claude says it can't find the sign-in page, add the nginx block from the earlier release below.

### 2. Payroll — first steps (HR → Pay & benefits, admins)
1. **Payroll settings**:
   - Check the professional-tax slabs for your corporation or municipality (Coimbatore, Erode).
   - Add the PF establishment code and the ESI employer code.
   - The PF ceiling is already ₹25,000, from 17 Sep 2026.
2. **Salaries**: set each person's salary, then their UAN, ESI number, PAN and bank account. Mark partners and directors
   *not on payroll*. For anyone paid earlier this year outside Sensoper, enter that income and TDS so the tax estimate
   is right.
3. **Incentives & commission → Commission rules**: add a rule, for example 2% of payments before GST.
4. **Payroll**:
   - Prepare the month, check each line, then approve.
   - Download the bank file, PF ECR and ESI file.
   - Mark it paid. Payslips then appear for everyone under **My pay**.

Payroll is admin-only by default. To give it to an HR person, switch on Payroll in **Settings → Permissions** for their
role, plus *Approve payroll and mark it paid* if they should approve. **Payroll settings → Who can open payroll** can then
limit it to named people.

### 3. Help desk
Everyone can open **Help desk**. As admin, open Help desk → **Settings** and choose who handles each category (IT, HR &
salary, tools, office, app…). A category with one handler sends requests straight to that person; one with none goes to
admins.

### 4. Smoke test
- HR → Pay & benefits → Payroll: prepare this month. Net pay, PF and ESI show, and the files download.
- A staff login: **My pay** shows their payslip once the month is approved. **Help desk** → Ask for help.

---

## Earlier release: AI agents (MCP) and vendor dropdown on purchase orders

Nothing new to install. After `./deploy.sh`:

### 1. nginx — one extra block (for Claude / ChatGPT connectors)
Claude and ChatGPT look for Sensoper's sign-in details at the site root (`/.well-known/…`), which nginx currently sends
to the frontend. Add this next to the `location /api/` block, then `nginx -t && systemctl reload nginx`:

    location ~ ^/\.well-known/(oauth-|openid-configuration) {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

Only these OAuth addresses go to the backend; `/.well-known/acme-challenge/` (SSL certificate renewal) is untouched.

Check: `curl https://quote.sensoper.in/.well-known/oauth-authorization-server/api` returns JSON (not the app's HTML).
API keys (Claude Code, the Claude API, n8n, scripts) work without this step.

### 2. Switch it on
Sign in as admin → **Settings → AI agents** → switch on **Let AI agents connect**. It is off after deploy, so no key or
connector works until you do.

- **Claude (web, desktop, phone)**: Claude → Settings → Connectors → Add custom connector → name *Sensoper*, address
  `https://quote.sensoper.in/api/mcp` → Connect → Sensoper opens → choose what it may do → **Allow**.
- **Your own agents / n8n / Claude Code**: Settings → AI agents → **Add an agent** → copy the key (shown once) and use
  the ready-made setup on the next screen.

### 3. Smoke test
- Purchases → Purchase orders → *PO without quotes*: the Vendor box is a list you search and pick from.
- Settings → AI agents → Activity lists every call an agent makes.

---

## Earlier release: site photos → Google Drive, site GPS, simpler Settings

### 1. Server settings
Check `backend/.env` on the server (see `backend/.env.example`):

| Setting | Value |
|---|---|
| `VAULT_MASTER_KEY` | Optional now. If it's empty, the server creates `storage/.keys/vault_master.key` on first use. **Back that file up** (or set this variable): it unlocks the keys saved in Settings and the Company logins. |
| `GOOGLE_REDIRECT_URI` | Leave unset. It defaults to `https://quote.sensoper.in/auth/google/callback`, which is already on the Google OAuth client. |
| `GOOGLE_CLIENT_SECRET` | Optional. Easier: paste it in **Settings → Google Drive**. |
| `GOOGLE_CLIENT_ID` | Optional. It defaults to `712570910460-6bsesslamu2umt6sf7mbe7h4a3o82og1.apps.googleusercontent.com`. |

### 2. Google Cloud Console (once)
In the Google Cloud project that owns the client ID:
1. **APIs & Services → Library → Google Drive API → Enable.**
2. **Credentials → the OAuth client → Authorized redirect URIs**: `https://quote.sensoper.in/auth/google/callback` (already added). Under **Authorized JavaScript origins**, add `https://quote.sensoper.in`.
3. **OAuth consent screen**:
   - Add the scope `.../auth/drive.file`.
   - Press **Publish app**. While it says "Testing", Google ends the connection every 7 days. `drive.file` is a non-sensitive scope, so publishing needs no Google review.
   - Or, for a Google Workspace account, choose "Internal".

### 3. Deploy
Merge the pull request on GitHub, then on the server:

    cd /root/Sensoper && ./deploy.sh

Nothing new to install (`httpx` is already in requirements). Check that nginx allows uploads of at least 20 MB
(`client_max_body_size 20m;`, see below). Otherwise larger bill PDFs fail with "413 Request Entity Too Large".

### 4. Connect Google Drive and check it
1. Sign in as admin → **Settings**:
   - Google Drive → paste the whole JSON file you downloaded from Google Cloud Console (or just the client secret) → Save → **Connect Google Drive** → pick the company Google account → Allow.
   You land on a "Connected" page. A folder **Sensoper — Site photos** appears in that Drive.
2. In Drive, share that folder with your team once. Every project folder inside it is shared too.
3. Smoke test on a phone: New project → Location → **Use my location** (the coordinates fill in) → … → Site photos → add a
   couple of photos → Create. Within a few seconds the project page shows a green tick on each photo and an
   **Open Drive folder** link.

---

## Every release

### Before you deploy (once)
Check `backend/.env` on the server against `backend/.env.example`:

| Setting | What it should be |
|---|---|
| `JWT_SECRET` | A long random string (not empty). Keep it unchanged between deploys. |
| `VAULT_MASTER_KEY` | Set, and backed up somewhere safe. |
| `CORS_ORIGINS` | `https://quote.sensoper.in` (not `*`). |
| `ADMIN_PASSWORD` | Anything. From this release it's only used if the admin account doesn't exist. |
| `COOKIE_SECURE` | Leave unset (`auto`). |

Make sure nginx passes `X-Forwarded-Proto` to the backend (most configs already do):

    location /api/ {
        client_max_body_size 20m;          # site photos and EB-bill PDFs (nginx's default is 1 MB)
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

### Deploy
Merge the pull request into `main` on GitHub, then on the server:

    cd /root/Sensoper && ./deploy.sh

### Right after the October restructure release
1. **Change the admin password** (Settings → My login & 2FA). Before this release every restart reset it to the
   default, and that default was written in this public repo, so assume it is known.
2. Sign in and press **Ctrl+Shift+R** once. The app's offline cache updates to v1.2.0 by itself; a hard refresh just
   makes it immediate.
3. Smoke test: Home loads → Daily report → submit a test report → Download PDF → Site diary for a live project → Save.
4. Optional clean-up:
   - `pip uninstall openai` in the backend virtualenv (Sensobrain is gone).
   - In MongoDB: `db.sensobrain_settings.drop(); db.sensobrain_conversations.drop(); db.sensobrain_usage.drop()`

## Rolling back
On GitHub, open the merged pull request and press **Revert**, merge the revert, then run `./deploy.sh` again.
New collections (`daily_reports`, `site_diaries`, `site_photo_uploads`, `integrations`) are only added to, so rolling back loses nothing. Photos already copied to Drive stay in Drive.

## Running the tests
Against the live API, with an admin login:

    cd backend && REACT_APP_BACKEND_URL=https://quote.sensoper.in ADMIN_PASSWORD='…' pytest tests/test_daily_reports.py

Site photos, Drive and site GPS need no server or network (fake Google, in-memory database):

    cd backend && pip install mongomock-motor && pytest tests/test_site_photos_drive.py

The test creates `dr_staff…@example.com` users and a "DR Customer …" project. Delete them afterwards, or run it
against a staging database instead.
