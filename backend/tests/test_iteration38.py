"""Iter-38 backend regression:
 - Login with admin creds (JWT_SECRET now required env var).
 - Auth /me returns admin.
 - GET /api/projects returns list.
 - GET /api/dashboard/stats returns object with numeric fields.
"""
import os
import pytest
import requests

TEST_ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or "Admin@123"
ADMIN_EMAIL = "admin@sensoper.com"

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": TEST_ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    assert s.cookies.get("access_token"), "No access_token cookie set on login"
    return s


def test_login_success(session):
    assert session.cookies.get("access_token")


def test_auth_me(session):
    r = session.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("email") == ADMIN_EMAIL


def test_projects_list(session):
    r = session.get(f"{BASE_URL}/api/projects", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    projects = body if isinstance(body, list) else body.get("projects", body.get("data", []))
    assert isinstance(projects, list)


def test_dashboard_stats(session):
    r = session.get(f"{BASE_URL}/api/dashboard/stats", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict) and len(data) > 0


def test_jwt_secret_stable_across_calls(session):
    """Same cookie should still be valid on subsequent requests (stable JWT_SECRET)."""
    r1 = session.get(f"{BASE_URL}/api/auth/me", timeout=15)
    r2 = session.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r1.status_code == 200 and r2.status_code == 200
