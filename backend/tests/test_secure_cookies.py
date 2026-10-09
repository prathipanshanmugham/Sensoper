"""Auth cookies carry the Secure flag when the site is reached over HTTPS (COOKIE_SECURE=auto)."""
import os
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
CREDS = {"email": os.environ.get("ADMIN_EMAIL", "admin@sensoper.com"), "password": os.environ.get("ADMIN_PASSWORD", "Admin@123")}


def _cookies(headers):
    return [v for k, v in headers if k.lower() == "set-cookie"]


def _login(extra_headers):
    r = requests.post(f"{BASE}/api/auth/login", json=CREDS, headers=extra_headers, timeout=30)
    assert r.status_code == 200, r.text
    return _cookies(r.raw.headers.items())


def test_secure_flag_behind_https_proxy():
    cookies = _login({"X-Forwarded-Proto": "https"})
    assert cookies and all("secure" in c.lower() for c in cookies), cookies


def test_no_secure_flag_on_plain_http():
    if BASE.startswith("https"):
        return  # the live site is HTTPS — nothing to check
    cookies = _login({})
    assert cookies and not any("secure" in c.lower() for c in cookies), cookies
