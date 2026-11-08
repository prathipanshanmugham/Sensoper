# Deploying Sensoper (Hostinger VPS · quote.sensoper.in)

Your server already has `/root/Sensoper/deploy.sh`. It pulls the code, installs backend packages, builds the frontend,
copies the build to `/var/www/sensoper`, restarts the `sensoper` service and checks the live bundle. This release needs
nothing new installed.

## This release: the website and the ERP on quote.sensoper.in

Until sensoper.in's DNS moves to this server, the website runs on quote.sensoper.in, next to the ERP:

- `https://quote.sensoper.in/` is the website. `/shop/` is the shop and `/account/` is customer login.
- `https://quote.sensoper.in/login` is the ERP, as before. So are `/dashboard` and everything else. The installed ERP
  app on phones still opens the ERP.
- On this address every link stays on it: **Shop** opens `/shop/`, and **ERP login** in the footer opens `/login`.

No new packages and no new settings. On the server, as root:

    cd /root/Sensoper && ./deploy.sh
    bash website/deploy/deploy-website.sh
    bash website/deploy/enable-on-quote.sh

The last line runs once. It adds one `include` line to the quote.sensoper.in nginx file. It keeps a copy in
`/root/nginx-backups` first, and if `nginx -t` doesn't accept the change, it puts the file back and reloads nothing.
Running it again is safe. To make quote.sensoper.in the ERP only again: `bash website/deploy/enable-on-quote.sh --undo`.

From then on, deploy with `./deploy.sh` and then `deploy-website.sh`. Or add the website line to `deploy.sh` once (step 1
below). Then set the website up in the ERP and check it, as in steps 4 and 5 below, with quote.sensoper.in in place
of sensoper.in.

## When sensoper.in is ready: the website on its own addresses (sensoper.in, shop.sensoper.in)

The backend and ERP deploy as usual (`/root/Sensoper/deploy.sh`). No new packages and no new settings. Moving the
website to its own addresses needs a one-time setup: DNS, nginx and SSL. Once https://sensoper.in shows the website,
run `bash /root/Sensoper/website/deploy/enable-on-quote.sh --undo` so quote.sensoper.in is the ERP only again. The
website's links switch to sensoper.in and shop.sensoper.in by themselves.

### 1. Copy the website on every deploy (once)
Add this line to `/root/Sensoper/deploy.sh`, after `git pull`:

    bash /root/Sensoper/website/deploy/deploy-website.sh

It copies `website/` to `/var/www/sensoper-site`, then checks the three addresses.

### 2. Point the domains at the VPS (once)
sensoper.in currently runs on Odoo. At your domain's DNS provider:

- Set the **A records** for `sensoper.in`, `www.sensoper.in` and `shop.sensoper.in` to the VPS address. It's the same
  address as `quote.sensoper.in`. For `www` and `shop`, a CNAME to `sensoper.in` also works.
- **Do not change MX or TXT records.** Email and Google verification keep working.
- Changes usually show within an hour.

Don't switch Odoo off until the new site is live and checked.

### 3. nginx and https (once, after DNS has switched)

    cp /root/Sensoper/website/deploy/nginx-sensoper-website.conf /etc/nginx/sites-available/sensoper-website
    ln -s /etc/nginx/sites-available/sensoper-website /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx
    certbot --nginx -d sensoper.in -d www.sensoper.in -d shop.sensoper.in

These domains pass only `/api/public/*` and `/api/client/*` to the backend. The ERP stays on quote.sensoper.in.
Use this file as it is. Don't copy the ERP's `location /api/` block into it: that would put the whole ERP API on the
public site. The backend must keep listening on 127.0.0.1 only, so the visitor limits see real addresses. If you ever
put Cloudflare in front, tell me first; the visitor-address setting has to change with it.

### 4. Set it up in the ERP (Sales & projects → Website)
1. **Pop-ups & settings:** check the WhatsApp number. It defaults to the company phone, 9043547047. Turn the price
   estimate in the calculator on or off. It uses Price list → Package slabs, so check those rates first.
2. **Shop:** use **Add product**. Pick a stock item, then set the shop price *including GST* and add a photo. Until a
   product is live, the shop asks visitors what they need, and their answers arrive as leads.
3. **Customer logins:** on any customer's project page → Customer dashboard → **Make customer login**. Then tap
   **Send on WhatsApp**. They sign in at sensoper.in/account and choose their own password.
4. **Permissions:** the new page is called **Website**. Staff can see leads and make logins. Managers can also run
   the shop, pop-ups and settings (the option is "Run the shop, pop-ups and website settings").

### 5. Check after it's live
1. On a phone, open https://sensoper.in. The sky should match the time of day, and the calculator should respond.
   Send yourself a quote request.
2. The request appears under Website → Leads, the bell shows a note, and the menu badge counts it.
3. Open https://shop.sensoper.in, add something to the cart and send an order request. It arrives as a lead marked
   "Shop order".
4. Make a customer login for a test project, sign in at https://sensoper.in/account, set a password and raise a
   service request. It appears in Customer support.
5. The footer's **ERP login** opens https://quote.sensoper.in/login.

## Earlier release: error sweep and a cleaner look

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
