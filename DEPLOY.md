# Deploying Sensoper (Hostinger VPS · quote.sensoper.in)

Your server already has `/root/Sensoper/deploy.sh`. It pulls the code, installs backend packages, builds the frontend,
copies the build to `/var/www/sensoper`, restarts the `sensoper` service and checks the live bundle. This release needs
nothing new installed.

## This release: site photos → Google Drive, What3words, simpler Settings

### 1. Server settings
Check `backend/.env` on the server (see `backend/.env.example`):

| Setting | Value |
|---|---|
| `VAULT_MASTER_KEY` | **Must be set.** It encrypts the Google token and the keys you paste in Settings. |
| `GOOGLE_REDIRECT_URI` | Leave unset. It defaults to `https://quote.sensoper.in/auth/google/callback`, which is already on the Google OAuth client. |
| `W3W_API_KEY` | Optional. Easier: after deploying, paste the new key in **Settings → What3words**. The old key is in this public repo's history, so don't reuse it. |
| `GOOGLE_CLIENT_SECRET` | Optional. Easier: paste it in **Settings → Google Drive**. |
| `GOOGLE_CLIENT_ID` | Optional. It defaults to `712570910460-423uajd5qq8jr73dl0rmtqiv667img00.apps.googleusercontent.com`. |

### 2. Google Cloud Console (once)
In the Google Cloud project that owns the client ID:
1. **APIs & Services → Library → Google Drive API → Enable.**
2. **Credentials → the OAuth client → Authorized redirect URIs**: `https://quote.sensoper.in/auth/google/callback` (already added). Under **Authorized JavaScript origins**, add `https://quote.sensoper.in`.
3. **OAuth consent screen**: add the scope `.../auth/drive.file`. If the app is in "Testing", add the Google account you'll connect as a test user. For a Workspace account, choose "Internal" so the sign-in never expires.

### 3. Deploy
Merge the pull request on GitHub, then on the server:

    cd /root/Sensoper && ./deploy.sh

Nothing new to install (`httpx` is already in requirements). Check that nginx allows uploads of at least 20 MB
(`client_max_body_size 20m;`, see below). Otherwise larger bill PDFs fail with "413 Request Entity Too Large".

### 4. Connect Google Drive and check it
1. Sign in as admin → **Settings**:
   - What3words → paste the new API key → Save. It's checked with What3words straight away.
   - Google Drive → paste the client secret (if you didn't put it in `.env`) → **Connect Google Drive** → pick the company Google account → Allow.
   You land on a "Connected" page. A folder **Sensoper — Site photos** appears in that Drive.
2. In Drive, share that folder with your team once. Every project folder inside it is shared too.
3. Smoke test on a phone: New project → Location → **Use my location** (the words fill in) → … → Site photos → add a
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
New collections (`daily_reports`, `site_diaries`, `site_photo_uploads`, `integrations`, `w3w_cache`) are only added to, so rolling back loses nothing. Photos already copied to Drive stay in Drive.

## Running the tests
Against the live API, with an admin login:

    cd backend && REACT_APP_BACKEND_URL=https://quote.sensoper.in ADMIN_PASSWORD='…' pytest tests/test_daily_reports.py

Site photos, Drive and What3words need no server or network (fake Google, in-memory database):

    cd backend && pip install mongomock-motor && pytest tests/test_site_photos_drive.py

The test creates `dr_staff…@example.com` users and a "DR Customer …" project. Delete them afterwards, or run it
against a staging database instead.
