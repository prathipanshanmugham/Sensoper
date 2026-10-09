"""Site photo checklist, Google Drive copy and What3words — no network, no MongoDB server needed.

Google and What3words are replaced by httpx.MockTransport fakes; MongoDB by mongomock-motor.

    pip install mongomock-motor pytest
    cd backend && pytest tests/test_site_photos_drive.py
"""
import asyncio
import base64
import json
import os
import re
import sys
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import APIRouter, FastAPI, HTTPException, Request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")

import geo_w3w  # noqa: E402
import google_drive  # noqa: E402
import site_photos  # noqa: E402
from bson import ObjectId  # noqa: E402

USERS = {
    "admin": {"id": "u-admin", "name": "Admin", "role": "admin"},
    "staff": {"id": "u-staff", "name": "Ravi", "role": "staff"},
    "staff2": {"id": "u-staff2", "name": "Other", "role": "staff"},
}
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("VAULT_MASTER_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "https://quote.example.in/auth/google/callback")
    monkeypatch.setenv("W3W_API_KEY", "TESTKEY")


class FakeGoogle:
    """Just enough of OAuth + Drive v3 for the sync code."""

    def __init__(self):
        self.items = {}       # id -> {name, parents, mimeType, appProperties, size}
        self.n = 0
        self.uploads = 0
        self.revoked = set()
        self.calls = []
        self.secrets_seen = []

    def _id(self):
        self.n += 1
        return f"f{self.n}"

    def handler(self, req: httpx.Request) -> httpx.Response:
        url = req.url
        self.calls.append((req.method, url.host, url.path))
        if url.host == "oauth2.googleapis.com" and url.path == "/token":
            form = parse_qs(req.content.decode())
            self.secrets_seen.append(form.get("client_secret", [""])[0])
            if form.get("grant_type") == ["refresh_token"]:
                if form["refresh_token"][0] in self.revoked:
                    return httpx.Response(400, json={"error": "invalid_grant"})
                return httpx.Response(200, json={"access_token": "at-refreshed", "expires_in": 3600})
            idt = "x." + base64.urlsafe_b64encode(json.dumps({"email": "office@sensoper.in"}).encode()).decode().rstrip("=") + ".y"
            scope = "openid email" if form.get("code") == ["no-drive"] else "openid email https://www.googleapis.com/auth/drive.file"
            return httpx.Response(200, json={"access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3600, "scope": scope, "id_token": idt})
        if url.host == "oauth2.googleapis.com" and url.path == "/revoke":
            self.revoked.add(parse_qs(req.content.decode())["token"][0])
            return httpx.Response(200, json={})
        assert req.headers.get("authorization", "").startswith("Bearer "), "Drive call without token"
        if url.path == "/drive/v3/files" and req.method == "POST":
            meta = json.loads(req.content)
            fid = self._id()
            self.items[fid] = {**meta, "trashed": False}
            return httpx.Response(200, json={"id": fid, "webViewLink": f"https://drive.google.com/drive/folders/{fid}"})
        m = re.match(r"^/drive/v3/files/(\w+)$", url.path)
        if m and req.method == "GET":
            it = self.items.get(m.group(1))
            return httpx.Response(200, json={"id": m.group(1), "trashed": it["trashed"]}) if it else httpx.Response(404, json={"error": {"message": "not found"}})
        if url.path == "/drive/v3/files" and req.method == "GET":
            q = url.params["q"]
            pid = re.search(r"value='([^']+)'", q).group(1)
            files = [{"id": k, "webViewLink": f"https://drive.google.com/file/d/{k}", "appProperties": v.get("appProperties")}
                     for k, v in self.items.items() if (v.get("appProperties") or {}).get("sensoper_project") == pid and not v["trashed"]]
            return httpx.Response(200, json={"files": files})
        if url.path == "/upload/drive/v3/files" and req.method == "POST":
            boundary = req.headers["content-type"].split("boundary=")[1]
            parts = req.content.split(f"--{boundary}".encode())
            meta = json.loads(parts[1].split(b"\r\n\r\n", 1)[1].strip())
            fid = self._id()
            self.items[fid] = {**meta, "trashed": False, "size": len(parts[2])}
            self.uploads += 1
            return httpx.Response(200, json={"id": fid, "webViewLink": f"https://drive.google.com/file/d/{fid}"})
        return httpx.Response(404, json={"error": {"message": f"unexpected {req.method} {url}"}})


def build(fake: FakeGoogle):
    geo_w3w.invalidate_key_cache()          # caches are per process; every test gets a fresh DB
    google_drive.invalidate_secret_cache()
    db = mongomock_motor.AsyncMongoMockClient()["t"]
    store = {}

    def put_object(path, data, ctype):
        store[path] = (data, ctype)
        return {"path": path, "size": len(data)}

    def get_object(path):
        if path not in store:
            raise FileNotFoundError(path)
        return store[path]

    async def get_current_user(request: Request):
        u = USERS.get(request.headers.get("x-user", ""))
        if not u:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return u

    def require_role(*roles):
        async def dep(request: Request):
            u = await get_current_user(request)
            if u["role"] not in roles:
                raise HTTPException(status_code=403, detail="Forbidden")
            return u
        return dep

    async def audit(*a, **k):
        return None

    drive = google_drive.DriveSync(db, get_object, transport=httpx.MockTransport(fake.handler))
    drive.schedule = lambda pid: None   # tests call sync explicitly
    drive.spawn = lambda coro: coro.close()
    api = APIRouter(prefix="/api")
    api.include_router(site_photos.create_router(db, get_current_user, require_role, audit, put_object, "app", drive=drive))
    api.include_router(google_drive.create_router(db, get_current_user, require_role, audit, drive))
    api.include_router(geo_w3w.create_router(db, get_current_user, require_role, audit))
    app = FastAPI()
    app.include_router(api)
    return app, db, drive, store


def client(app, who="admin"):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", headers={"x-user": who})


async def _project(db, created_by="u-staff", **extra):
    res = await db.projects.insert_one({"customer": {"name": "Lakshmi"}, "location": {"district": "Erode"}, "reference_number": "SCR-ABC123",
                                        "status": "draft", "created_by": created_by, **extra})
    return str(res.inserted_id)


async def _upload(c, slot, project_id=None, ctype="image/png", data=PNG, **form):
    fields = {"slot": slot, **{k: str(v) for k, v in form.items()}}
    if project_id:
        fields["project_id"] = project_id
    return await c.post("/api/site-photos/upload", data=fields, files={"file": (f"{slot}.png", data, ctype)})


async def _connect(app, fake, code="good"):
    async with client(app) as c:
        r = await c.post("/api/integrations/google-drive/connect")
        assert r.status_code == 200, r.text
        state = parse_qs(urlparse(r.json()["auth_url"]).query)["state"][0]
        assert "drive.file" in r.json()["auth_url"] and "access_type=offline" in r.json()["auth_url"]
    async with client(app, who="nobody") as anon:          # the state alone authorises the callback
        return await anon.post("/api/integrations/google-drive/callback", json={"code": code, "state": state})


def run(coro):
    return asyncio.run(coro)


# ───────────────────────── checklist & uploads ─────────────────────────

def test_checklist_matches_the_brief():
    labels = [i["key"] for c in site_photos.CHECKLIST for i in c["items"]]
    assert len(labels) == len(set(labels)) == 23
    assert [c["folder"] for c in site_photos.CHECKLIST] == ["1 Site & access", "2 Roof", "3 Electrical", "4 Documents", "5 Proof of visit"]
    assert site_photos.SLOTS["roof_corners"]["min"] == 4 and site_photos.SLOTS["eb_bill"]["min"] == 2
    assert {k for k, s in site_photos.SLOTS.items() if s["optional"]} == {"sheet_roof", "existing_earthing", "backup_power", "ci_panels"}
    assert site_photos.summarise({})["required_total"] == 19


def test_upload_rules():
    async def go():
        app, db, _, store = build(FakeGoogle())
        async with client(app, "staff") as c:
            r = await _upload(c, "eb_meter", lat=11.34, lng=77.71)
            assert r.status_code == 200, r.text
            rec = r.json()
            assert rec["drive_status"] == "pending" and rec["uploaded_by"] == "u-staff" and rec["lat"] == 11.34
            assert rec["storage_path"] in store
            assert (await _upload(c, "not_a_slot")).status_code == 400
            assert (await _upload(c, "eb_meter", ctype="application/pdf", data=b"%PDF-1.4")).status_code == 400   # PDFs only for documents
            assert (await _upload(c, "eb_bill", ctype="application/pdf", data=b"%PDF-1.4")).status_code == 200
            assert (await _upload(c, "eb_meter", ctype="text/plain", data=b"hi")).status_code == 400
        async with client(app, "nobody") as anon:
            assert (await _upload(anon, "eb_meter")).status_code == 401
    run(go())


def test_upload_straight_onto_a_project_respects_ownership():
    async def go():
        app, db, _, _ = build(FakeGoogle())
        pid = await _project(db)
        async with client(app, "staff2") as c:
            assert (await _upload(c, "compass", project_id=pid)).status_code == 403
        async with client(app, "staff") as c:
            r = await _upload(c, "compass", project_id=pid)
            assert r.status_code == 200
            p = await db.projects.find_one({"_id": ObjectId(pid)})
            assert [x["id"] for x in p["site_photos"]["compass"]] == [r.json()["id"]] and p["site_photos_pending"] == 1
            g = (await c.get(f"/api/projects/{pid}/site-photos")).json()
            assert g["summary"]["photos"] == 1 and g["drive_connected"] is False
            assert (await c.delete(f"/api/projects/{pid}/site-photos/{r.json()['id']}")).status_code == 200
            p = await db.projects.find_one({"_id": ObjectId(pid)})
            assert p["site_photos"]["compass"] == [] and p["site_photos_pending"] == 0
    run(go())


def test_normalise_keeps_drive_state_and_drops_unknowns():
    async def go():
        app, db, _, _ = build(FakeGoogle())
        async with client(app, "staff") as c:
            a = (await _upload(c, "building_front")).json()
            b = (await _upload(c, "parapet")).json()
        existing = {"building_front": [{**a, "drive_status": "uploaded", "drive_file_id": "F1"}]}
        # The browser sends a stale copy of `a` (still pending), `b`, an id that was never uploaded and a bad slot
        incoming = {"building_front": [{**a, "drive_status": "pending", "drive_file_id": None, "storage_path": "../../etc/passwd"}],
                    "parapet": [b["id"], "deadbeef"], "hacker_slot": [b["id"]]}
        out, pending = await site_photos.normalise_for_save(db, incoming, existing)
        assert out["building_front"][0]["drive_file_id"] == "F1" and out["building_front"][0]["storage_path"] == a["storage_path"]
        assert [p["id"] for p in out["parapet"]] == [b["id"]]
        assert "hacker_slot" not in out and pending == 1
    run(go())


# ───────────────────────── Google Drive ─────────────────────────

def test_connect_requires_admin_and_secret(monkeypatch):
    async def go():
        app, _, _, _ = build(FakeGoogle())
        async with client(app, "staff") as c:
            assert (await c.post("/api/integrations/google-drive/connect")).status_code == 403
            s = (await c.get("/api/integrations/google-drive")).json()
            assert s == {"connected": False, "status": "not_connected"}          # staff see no config details
        monkeypatch.delenv("GOOGLE_CLIENT_SECRET")
        async with client(app) as c:
            r = await c.post("/api/integrations/google-drive/connect")
            assert r.status_code == 503 and "GOOGLE_CLIENT_SECRET" in r.json()["detail"]
            assert (await c.get("/api/integrations/google-drive")).json()["missing"] == ["GOOGLE_CLIENT_SECRET"]
    run(go())


def test_callback_state_is_single_use_and_checks_drive_scope():
    async def go():
        fake = FakeGoogle()
        app, db, drive, _ = build(fake)
        r = await _connect(app, fake, code="no-drive")
        assert r.status_code == 400 and "Drive permission" in r.json()["detail"]
        assert not await drive.is_connected()
        async with client(app) as c:
            assert (await c.post("/api/integrations/google-drive/callback", json={"code": "x", "state": "made-up"})).status_code == 400
        r = await _connect(app, fake)
        assert r.status_code == 200 and r.json()["account_email"] == "office@sensoper.in"
        doc = await db.integrations.find_one({"key": "google_drive"})
        assert doc["refresh_token_enc"] != "rt-1"                    # encrypted at rest
        assert doc["root_folder_id"] and fake.items[doc["root_folder_id"]]["name"] == google_drive.ROOT_FOLDER_NAME
        async with client(app) as c:
            s = (await c.get("/api/integrations/google-drive")).json()
            assert s["connected"] and s["account_email"] == "office@sensoper.in" and s["redirect_uri"].endswith("/auth/google/callback")
    run(go())


def test_sync_copies_into_section_folders_once():
    async def go():
        fake = FakeGoogle()
        app, db, drive, _ = build(fake)
        pid = await _project(db)
        async with client(app, "staff") as c:
            ids = {}
            for slot in ("building_front", "roof_corners", "roof_corners", "eb_meter", "team_with_customer"):
                r = await _upload(c, slot, project_id=pid, lat=11.341, lng=77.717)
                ids.setdefault(slot, []).append(r.json()["id"])
            assert (await c.post(f"/api/projects/{pid}/site-photos/sync")).status_code == 409   # not connected yet
        assert (await _connect(app, fake)).status_code == 200
        res = await drive.sync_project(pid)
        assert res["uploaded"] == 5 and res["failed"] == 0 and res["pending"] == 0
        p = await db.projects.find_one({"_id": ObjectId(pid)})
        state = p["site_photos_drive"]
        assert fake.items[state["folder_id"]]["name"] == "SCR-ABC123 · Lakshmi · Erode"
        assert set(state["subfolders"]) == {"site", "roof", "electrical", "proof"}
        assert p["drive_folder_link"] == state["folder_link"]                  # project's Drive link filled in
        corners = [v for v in fake.items.values() if (v.get("appProperties") or {}).get("sensoper_slot") == "roof_corners"]
        assert sorted(v["name"] for v in corners) == ["2.1 Full roof from all 4 corners (1).png", "2.1 Full roof from all 4 corners (2).png"]
        assert all(v["parents"] == [state["subfolders"]["roof"]] for v in corners)
        assert "GPS 11.341000, 77.717000" in corners[0]["description"]
        assert all(ph["drive_status"] == "uploaded" and ph["drive_file_id"] for lst in p["site_photos"].values() for ph in lst)
        # Nothing left to do → no new uploads
        res = await drive.sync_project(pid)
        assert res["status"] == "up_to_date" and fake.uploads == 5
    run(go())


def test_retry_never_duplicates_a_file_already_in_drive():
    async def go():
        fake = FakeGoogle()
        app, db, drive, _ = build(fake)
        pid = await _project(db)
        async with client(app, "staff") as c:
            await _upload(c, "eb_meter", project_id=pid)
        await _connect(app, fake)
        await drive.sync_project(pid)
        # Simulate the app losing track (e.g. a save that raced the sync): photo marked pending again
        await db.projects.update_one({"_id": ObjectId(pid)}, {"$set": {"site_photos.eb_meter.0.drive_status": "pending", "site_photos_pending": 1}})
        res = await drive.sync_project(pid)
        assert res["already_in_drive"] == 1 and res["uploaded"] == 0 and fake.uploads == 1
    run(go())


def test_missing_file_and_revoked_access_are_reported():
    async def go():
        fake = FakeGoogle()
        app, db, drive, store = build(fake)
        pid = await _project(db)
        async with client(app, "staff") as c:
            a = (await _upload(c, "eb_meter", project_id=pid)).json()
            await _upload(c, "compass", project_id=pid)
        store.pop(a["storage_path"])
        await _connect(app, fake)
        res = await drive.sync_project(pid)
        assert res["uploaded"] == 1 and res["failed"] == 1 and res["status"] == "partial"
        p = await db.projects.find_one({"_id": ObjectId(pid)})
        assert p["site_photos"]["eb_meter"][0]["drive_status"] == "error" and p["site_photos"]["eb_meter"][0]["drive_attempts"] == 1
        # Google access revoked → integration flagged for reconnect, nothing crashes
        fake.revoked.add("rt-1")
        drive._token = None
        res = await drive.sync_project(pid, force=True)
        assert res["status"] == "error" and "reconnect" in res["error"].lower()
        doc = await db.integrations.find_one({"key": "google_drive"})
        assert doc["status"] == "needs_reconnect" and not await drive.is_connected()
    run(go())


def test_disconnect_revokes_token():
    async def go():
        fake = FakeGoogle()
        app, db, drive, _ = build(fake)
        await _connect(app, fake)
        async with client(app) as c:
            assert (await c.delete("/api/integrations/google-drive")).status_code == 200
        assert "rt-1" in fake.revoked and not await drive.is_connected()
    run(go())


# ───────────────────────── What3words ─────────────────────────

def test_what3words_lookup_is_cached_and_key_stays_server_side(monkeypatch):
    seen = []

    def w3w(req: httpx.Request):
        seen.append(req.url)
        assert req.headers.get("x-api-key") == "TESTKEY" and "key" not in req.url.params   # key never in the URL
        if req.url.path.endswith("convert-to-3wa"):
            return httpx.Response(200, json={"words": "index.home.raft", "nearestPlace": "Erode, Tamil Nadu", "country": "IN",
                                             "coordinates": {"lat": 11.341036, "lng": 77.717163}, "map": "https://w3w.co/index.home.raft"})
        return httpx.Response(402, json={"error": {"code": "Forbidden", "message": "plan"}})
    monkeypatch.setattr(geo_w3w, "_transport", httpx.MockTransport(w3w))

    async def go():
        app, db, _, _ = build(FakeGoogle())
        async with client(app, "staff") as c:
            r = await c.get("/api/geo/what3words", params={"lat": 11.341036, "lng": 77.717163})
            assert r.status_code == 200 and r.json()["words"] == "index.home.raft" and r.json()["nearest_place"].startswith("Erode")
            assert "TESTKEY" not in r.text
            r2 = await c.get("/api/geo/what3words", params={"lat": 11.341036, "lng": 77.717163})
            assert r2.json()["source"] == "cache" and len(seen) == 1
            assert (await c.get("/api/geo/what3words", params={"lat": 123, "lng": 0})).status_code == 400
            r3 = await c.get("/api/geo/what3words/coordinates", params={"words": "///Index.Home.Raft"})
            assert r3.status_code == 503 and "plan" in r3.json()["detail"]
            assert seen[-1].params["words"] == "index.home.raft"
            assert (await c.get("/api/geo/what3words/coordinates", params={"words": "not words"})).status_code == 400
            assert (await c.get("/api/geo/what3words/status")).json() == {"configured": True, "source": "env"}   # no key hint for staff
        monkeypatch.delenv("W3W_API_KEY")
        async with client(app, "staff") as c:
            r = await c.get("/api/geo/what3words", params={"lat": 10.0, "lng": 78.0})
            assert r.status_code == 503 and "Settings" in r.json()["detail"]
    run(go())


def test_what3words_bad_key_message(monkeypatch):
    monkeypatch.setattr(geo_w3w, "_transport", httpx.MockTransport(
        lambda req: httpx.Response(401, json={"error": {"code": "InvalidKey", "message": "Authentication failed; invalid API key"}})))

    async def go():
        app, _, _, _ = build(FakeGoogle())
        async with client(app, "staff") as c:
            r = await c.get("/api/geo/what3words", params={"lat": 11.0, "lng": 77.0})
            assert r.status_code == 503 and "not valid" in r.json()["detail"]
    run(go())


def _w3w_fake(valid=("TESTKEY", "NEWKEY123"), seen=None):
    def handler(req: httpx.Request):
        key = req.headers.get("x-api-key")
        if seen is not None:
            seen.append(key)
        if key not in valid:
            return httpx.Response(401, json={"error": {"code": "InvalidKey", "message": "Authentication failed; invalid API key"}})
        return httpx.Response(200, json={"words": "filled.count.soap", "nearestPlace": "Erode, Tamil Nadu", "country": "IN",
                                         "coordinates": {"lat": 11.341036, "lng": 77.717163}, "map": ""})
    return httpx.MockTransport(handler)


def test_what3words_key_pasted_in_settings_wins(monkeypatch):
    seen = []
    monkeypatch.setattr(geo_w3w, "_transport", _w3w_fake(seen=seen))

    async def go():
        app, db, _, _ = build(FakeGoogle())
        async with client(app, "staff") as c:
            assert (await c.put("/api/geo/what3words/key", json={"api_key": "NEWKEY123"})).status_code == 403
        async with client(app) as c:
            r = await c.put("/api/geo/what3words/key", json={"api_key": "BADKEY99"})
            assert r.status_code == 400 and "not valid" in r.json()["detail"]
            assert (await c.put("/api/geo/what3words/key", json={"api_key": "no spaces allowed"})).status_code == 400
            r = await c.put("/api/geo/what3words/key", json={"api_key": "NEWKEY123"})
            assert r.status_code == 200 and r.json()["tested"] is True and r.json()["hint"] == "…Y123"
            doc = await db.integrations.find_one({"key": "what3words"})
            assert doc["api_key_enc"] and "NEWKEY123" not in str(doc)            # encrypted at rest
            assert (await c.get("/api/geo/what3words/status")).json() == {"configured": True, "source": "settings", "hint": "…Y123"}
            seen.clear()
            await c.get("/api/geo/what3words", params={"lat": 10.5, "lng": 78.1})
            assert seen == ["NEWKEY123"]                                          # Settings key beats W3W_API_KEY=TESTKEY
            r = await c.delete("/api/geo/what3words/key")
            assert r.json() == {"configured": True, "source": "env"}
    run(go())


def test_what3words_key_saved_even_when_offline(monkeypatch):
    def offline(req):
        raise httpx.ConnectError("no network")
    monkeypatch.setattr(geo_w3w, "_transport", httpx.MockTransport(offline))

    async def go():
        app, _, _, _ = build(FakeGoogle())
        async with client(app) as c:
            r = await c.put("/api/geo/what3words/key", json={"api_key": "NEWKEY123"})
            assert r.status_code == 200 and r.json()["tested"] is False and "could not be checked" in r.json()["message"]
    run(go())


def test_update_location_on_a_saved_project(monkeypatch):
    monkeypatch.setattr(geo_w3w, "_transport", _w3w_fake())

    async def go():
        app, db, _, _ = build(FakeGoogle())
        pid = await _project(db, status="approved")
        async with client(app, "staff2") as c:
            assert (await c.put(f"/api/projects/{pid}/geo", json={"lat": 11.34, "lng": 77.71})).status_code == 403
        async with client(app, "staff") as c:
            r = await c.put(f"/api/projects/{pid}/geo", json={"lat": 11.341036, "lng": 77.717163, "accuracy": 6})
            assert r.status_code == 200 and r.json()["words_updated"] and r.json()["site_location_words"] == "filled.count.soap"
            p = await db.projects.find_one({"_id": ObjectId(pid)})
            assert p["location"]["latitude"] == 11.341036 and p["location"]["site_location_words"] == "filled.count.soap"
            assert p["status"] == "approved"                                       # a map pin never sends it back for approval
            assert (await c.put(f"/api/projects/{pid}/geo", json={"lat": 95, "lng": 0})).status_code == 400
        monkeypatch.delenv("W3W_API_KEY")
        geo_w3w.invalidate_key_cache()
        async with client(app, "staff") as c:
            r = await c.put(f"/api/projects/{pid}/geo", json={"lat": 11.4, "lng": 77.8})
            assert r.status_code == 200 and r.json()["words_updated"] is False and "Settings" in r.json()["note"]
            p = await db.projects.find_one({"_id": ObjectId(pid)})
            assert p["location"]["latitude"] == 11.4 and p["location"]["site_location_words"] == "filled.count.soap"   # old words kept
    run(go())


def test_google_client_secret_pasted_in_settings(monkeypatch):
    async def go():
        fake = FakeGoogle()
        app, db, drive, _ = build(fake)
        monkeypatch.delenv("GOOGLE_CLIENT_SECRET")
        async with client(app, "staff") as c:
            assert (await c.put("/api/integrations/google-drive/client-secret", json={"client_secret": "GOCSPX-abcdef123456"})).status_code == 403
        async with client(app) as c:
            assert (await c.get("/api/integrations/google-drive")).json()["configured"] is False
            assert (await c.put("/api/integrations/google-drive/client-secret", json={"client_secret": "bad secret!"})).status_code == 400
            r = await c.put("/api/integrations/google-drive/client-secret", json={"client_secret": "GOCSPX-abcdef123456"})
            assert r.status_code == 200
            s = (await c.get("/api/integrations/google-drive")).json()
            assert s["configured"] is True and s["secret_source"] == "settings" and s["missing"] == []
            assert s["redirect_uri"] == "https://quote.example.in/auth/google/callback"
        doc = await db.integrations.find_one({"key": "google_oauth_client"})
        assert "GOCSPX-abcdef123456" not in str(doc)
        assert (await _connect(app, fake)).status_code == 200
        assert fake.secrets_seen[-1] == "GOCSPX-abcdef123456"
    run(go())


def test_default_redirect_is_the_app_domain(monkeypatch):
    monkeypatch.delenv("GOOGLE_REDIRECT_URI")
    assert google_drive.redirect_uri() == "https://quote.sensoper.in/auth/google/callback"
