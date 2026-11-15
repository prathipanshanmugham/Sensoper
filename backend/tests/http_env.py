"""Settings for the HTTP tests — the test files that call a running Sensoper server over HTTP.

The repository is public, so no password is written in any test. Everything comes from the environment:

    REACT_APP_BACKEND_URL   the server under test, e.g. http://127.0.0.1:8001
    TEST_ADMIN_EMAIL        defaults to admin@sensoper.com
    TEST_ADMIN_PASSWORD     that admin's password on the server under test
    TEST_MANAGER_EMAIL      a manager login on that server (default qa_mgr_iter46@sensoper.com)
    TEST_MANAGER_PASSWORD
    TEST_STAFF_EMAIL        a staff login on that server (default qa_staff_iter46@sensoper.com)
    TEST_STAFF_PASSWORD

A test module that needs a value that isn't set is skipped (not failed). Never point these tests at the live
server: they create and delete records.

Users that a test creates for itself get a fresh random password per run (`throwaway_password`).
"""
import os
import secrets

import pytest

TEST_ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL") or "admin@sensoper.com"
TEST_MANAGER_EMAIL = os.environ.get("TEST_MANAGER_EMAIL") or "qa_mgr_iter46@sensoper.com"
TEST_STAFF_EMAIL = os.environ.get("TEST_STAFF_EMAIL") or "qa_staff_iter46@sensoper.com"


def _need(*names: str) -> None:
    missing = [n for n in names if not (os.environ.get(n) or "").strip()]
    if missing:
        pytest.skip(f"HTTP test against a running server — set {', '.join(missing)} to run it", allow_module_level=True)


def require_server(manager: bool = False, staff: bool = False):
    """(server URL, admin password) — or skip the whole module when they (or the manager / staff logins it uses)
    aren't set in the environment."""
    names = ["REACT_APP_BACKEND_URL", "TEST_ADMIN_PASSWORD"]
    if manager:
        names.append("TEST_MANAGER_PASSWORD")
    if staff:
        names.append("TEST_STAFF_PASSWORD")
    _need(*names)
    return os.environ["REACT_APP_BACKEND_URL"].strip().rstrip("/"), os.environ["TEST_ADMIN_PASSWORD"]


TEST_MANAGER_PASSWORD = os.environ.get("TEST_MANAGER_PASSWORD") or ""
TEST_STAFF_PASSWORD = os.environ.get("TEST_STAFF_PASSWORD") or ""


def throwaway_password() -> str:
    """A password for a user the test creates and deletes itself — new every run, meets the 8-character rule."""
    return "Tmp-" + secrets.token_hex(6) + "!9"


def ensure_vendor(session, api: str, name: str) -> str:
    """Since Nov 2026 a PO is raised only on a vendor from the Vendors list (a typed supplier name must match one).
    Older tests typed any name — this adds that vendor first (or finds it) and returns its id."""
    r = session.post(f"{api}/vendors", json={"name": name, "category": "other", "notes": "test vendor"}, timeout=60)
    if r.status_code in (200, 201):
        return r.json()["id"]
    rows = session.get(f"{api}/vendors", params={"search": name}, timeout=60).json()
    rows = rows.get("vendors", rows.get("rows", [])) if isinstance(rows, dict) else rows
    return next(v["id"] for v in rows if v["name"].lower() == name.lower())


def require_mongo():
    """For the few tests that also read MongoDB directly: (MONGO_URL, DB_NAME) of the server under test, or skip."""
    _need("MONGO_URL", "DB_NAME")
    return os.environ["MONGO_URL"], os.environ["DB_NAME"]
