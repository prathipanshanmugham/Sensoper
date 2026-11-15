"""The public /api/files route must never serve the vault master key, .meta notes or audit-log archives."""
import os
import sys
import tempfile

import pytest

ROOT = tempfile.mkdtemp(prefix="sensoper-files-")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_files_route")
os.environ.setdefault("JWT_SECRET", "x" * 48)
os.environ["STORAGE_ROOT"] = ROOT
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mongomock_motor  # noqa: E402
import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="module")
def client():
    root = server.STORAGE_ROOT
    for rel, data in ((".keys/vault_master.key", b"SECRET-KEY"), ("app/images/a.png", b"\x89PNG..."),
                      ("app/images/a.png.meta", b"image/png"), ("app/log-archives/2026-Q3.json.gz", b"AUDIT")):
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    return TestClient(server.app)


@pytest.mark.parametrize("path", [".keys/vault_master.key", "%2ekeys/vault_master.key", "app/../.keys/vault_master.key",
                                  "app/images/a.png.meta", "app/log-archives/2026-Q3.json.gz", "/.keys/vault_master.key"])
def test_hidden_files_are_refused(client, path):
    r = client.get("/api/files/" + path)
    assert r.status_code == 404
    assert b"SECRET-KEY" not in r.content and b"AUDIT" not in r.content


def test_ordinary_upload_still_served(client):
    r = client.get("/api/files/app/images/a.png")
    assert r.status_code == 200 and r.content.startswith(b"\x89PNG")


def test_servable_rules():
    ok = server._publicly_servable
    assert ok("app/images/a.png")
    for bad in ("", ".keys/x", "a/.hidden/b", "a/b.meta", "x/log-archives/y", "a\\.keys\\b"):
        assert not ok(bad), bad
