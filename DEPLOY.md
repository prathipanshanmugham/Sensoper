# Deploying Sensoper (Hostinger VPS · quote.sensoper.in)

Your server already has `/root/Sensoper/deploy.sh`. It pulls the code, installs backend packages, builds the frontend,
copies the build to `/var/www/sensoper`, restarts the `sensoper` service and checks the live bundle. This release needs
nothing new installed.

## 1. Before you deploy (once)
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
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

## 2. Deploy
Merge the pull request into `main` on GitHub, then on the server:

    cd /root/Sensoper && ./deploy.sh

## 3. Right after deploying
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
The new collections (`daily_reports`, `site_diaries`) are only added to, so rolling back loses nothing.

## Running the tests
Against the live API, with an admin login:

    cd backend && REACT_APP_BACKEND_URL=https://quote.sensoper.in ADMIN_PASSWORD='…' pytest tests/test_daily_reports.py

The test creates `dr_staff…@example.com` users and a "DR Customer …" project. Delete them afterwards, or run it
against a staging database instead.
