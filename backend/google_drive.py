"""Google Drive connection + automatic copy of site photos into Drive.

Setup (once, by an admin): Settings → Google Drive → Connect. Google asks the admin to pick the
company Google account and allow "See, edit, create and delete only the specific Google Drive files
you use with this app" (scope drive.file — the app can only touch folders and files it created).

Environment (backend/.env):
    GOOGLE_CLIENT_ID       OAuth client ID (Web application) from Google Cloud Console
    GOOGLE_CLIENT_SECRET   its secret — never commit it
    GOOGLE_REDIRECT_URI    must exactly match an "Authorized redirect URI" on that client and point at
                           this app's /auth/google/callback page
    VAULT_MASTER_KEY       used to encrypt the stored refresh token (same key as Company logins)

Drive layout:
    Sensoper — Site photos/
        SCR-1A2B3C · Customer name · District/
            1 Site & access/  2 Roof/  3 Electrical/  4 Documents/  5 Proof of visit/

Every uploaded file carries appProperties {sensoper_project, sensoper_photo_id}. Before uploading, the
sync asks Drive which photo ids it already has, so a retry never creates a duplicate.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import httpx
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from site_photos import SLOTS, CHECKLIST, pending_count
from vault import encrypt_secret, decrypt_secret

logger = logging.getLogger("google_drive")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
FILES_URL = "https://www.googleapis.com/drive/v3/files"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
SCOPE_DRIVE = "https://www.googleapis.com/auth/drive.file"
SCOPES = f"openid email {SCOPE_DRIVE}"
FOLDER_MIME = "application/vnd.google-apps.folder"
ROOT_FOLDER_NAME = "Sensoper — Site photos"
DEFAULT_CLIENT_ID = "712570910460-423uajd5qq8jr73dl0rmtqiv667img00.apps.googleusercontent.com"
DEFAULT_REDIRECT_URI = "https://sensoper.in/auth/google/callback"
MAX_ATTEMPTS = 5
RETRY_EVERY_SECONDS = 600
KEY = "google_drive"


def client_id() -> str:
    return (os.environ.get("GOOGLE_CLIENT_ID") or DEFAULT_CLIENT_ID).strip()


def client_secret() -> str:
    return (os.environ.get("GOOGLE_CLIENT_SECRET") or "").strip()


def redirect_uri() -> str:
    return (os.environ.get("GOOGLE_REDIRECT_URI") or DEFAULT_REDIRECT_URI).strip()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_name(s: str, limit: int = 120) -> str:
    s = re.sub(r"[\\/\r\n\t]+", " ", str(s or "")).strip()
    return re.sub(r"\s{2,}", " ", s)[:limit] or "Untitled"


def _q(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


class DriveError(Exception):
    def __init__(self, message: str, status: int = 0, reconnect: bool = False):
        super().__init__(message)
        self.status = status
        self.reconnect = reconnect


class DriveSync:
    """Owns the Google tokens and copies pending site photos into Drive."""

    def __init__(self, db, get_object, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.db = db
        self.get_object = get_object
        self.transport = transport          # tests inject httpx.MockTransport
        self._token: Optional[str] = None
        self._token_exp: Optional[datetime] = None
        self._token_for: Optional[str] = None
        self._locks: Dict[str, asyncio.Lock] = {}
        self._tasks: set = set()
        self._loop_task: Optional[asyncio.Task] = None

    # ── connection state ──
    async def integration(self) -> Optional[dict]:
        return await self.db.integrations.find_one({"key": KEY})

    async def is_connected(self) -> bool:
        doc = await self.integration()
        return bool(doc and doc.get("refresh_token_enc") and doc.get("status") == "connected")

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=60, transport=self.transport)

    async def _set_error(self, message: str, reconnect: bool = False):
        upd = {"last_error": message, "last_error_at": _now().isoformat()}
        if reconnect:
            upd["status"] = "needs_reconnect"
            self._token = None
        await self.db.integrations.update_one({"key": KEY}, {"$set": upd})

    async def access_token(self) -> str:
        doc = await self.integration()
        if not doc or not doc.get("refresh_token_enc"):
            raise DriveError("Google Drive is not connected", reconnect=True)
        if self._token and self._token_for == doc.get("connected_at") and self._token_exp and self._token_exp > _now() + timedelta(seconds=60):
            return self._token
        if not client_secret():
            raise DriveError("GOOGLE_CLIENT_SECRET is missing on the server")
        try:
            refresh = decrypt_secret(doc["refresh_token_enc"])
        except HTTPException as e:
            raise DriveError(str(e.detail))
        async with self._client() as c:
            r = await c.post(TOKEN_URL, data={"client_id": client_id(), "client_secret": client_secret(),
                                              "refresh_token": refresh, "grant_type": "refresh_token"})
        body = _json(r)
        if r.status_code >= 400 or "access_token" not in body:
            err = body.get("error", "")
            if err in ("invalid_grant", "unauthorized_client", "invalid_client"):
                raise DriveError("Google access was removed or expired — reconnect Google Drive in Settings.", r.status_code, reconnect=True)
            raise DriveError(f"Google token refresh failed ({r.status_code} {err})", r.status_code)
        self._token = body["access_token"]
        self._token_exp = _now() + timedelta(seconds=int(body.get("expires_in", 3600)))
        self._token_for = doc.get("connected_at")
        return self._token

    # ── Drive primitives ──
    async def _api(self, method: str, url: str, token: str, **kw) -> dict:
        async with self._client() as c:
            r = await c.request(method, url, headers={"Authorization": f"Bearer {token}", **kw.pop("headers", {})}, **kw)
        body = _json(r)
        if r.status_code == 401:
            self._token = None
            raise DriveError("Google rejected the access token", 401)
        if r.status_code >= 400:
            msg = ((body.get("error") or {}).get("message") if isinstance(body.get("error"), dict) else body.get("error")) or r.text[:200]
            raise DriveError(f"Drive {r.status_code}: {msg}", r.status_code)
        return body

    async def create_folder(self, token: str, name: str, parent: Optional[str] = None) -> dict:
        meta: Dict[str, Any] = {"name": _safe_name(name), "mimeType": FOLDER_MIME}
        if parent:
            meta["parents"] = [parent]
        return await self._api("POST", FILES_URL, token, params={"fields": "id,webViewLink", "supportsAllDrives": "true"}, json=meta)

    async def folder_alive(self, token: str, folder_id: str) -> bool:
        try:
            f = await self._api("GET", f"{FILES_URL}/{folder_id}", token, params={"fields": "id,trashed", "supportsAllDrives": "true"})
            return not f.get("trashed")
        except DriveError as e:
            if e.status == 404:
                return False
            raise

    async def upload(self, token: str, name: str, parent: str, data: bytes, ctype: str, app_props: dict, description: str = "") -> dict:
        boundary = f"sensoper{uuid.uuid4().hex}"
        meta = {"name": _safe_name(name, 180), "parents": [parent], "appProperties": app_props}
        if description:
            meta["description"] = description[:900]
        body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(meta)}\r\n"
                f"--{boundary}\r\nContent-Type: {ctype or 'application/octet-stream'}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
        return await self._api("POST", UPLOAD_URL, token, params={"uploadType": "multipart", "fields": "id,webViewLink", "supportsAllDrives": "true"},
                               content=body, headers={"Content-Type": f"multipart/related; boundary={boundary}"})

    async def existing_files(self, token: str, project_id: str) -> Dict[str, dict]:
        q = f"appProperties has {{ key='sensoper_project' and value='{_q(project_id)}' }} and trashed=false"
        out: Dict[str, dict] = {}
        page = None
        for _ in range(20):
            params = {"q": q, "fields": "nextPageToken,files(id,webViewLink,appProperties)", "pageSize": "1000", "spaces": "drive"}
            if page:
                params["pageToken"] = page
            res = await self._api("GET", FILES_URL, token, params=params)
            for f in res.get("files", []):
                pid = (f.get("appProperties") or {}).get("sensoper_photo_id")
                if pid:
                    out[pid] = f
            page = res.get("nextPageToken")
            if not page:
                break
        return out

    async def ensure_root(self, token: str) -> str:
        doc = await self.integration() or {}
        rid = doc.get("root_folder_id")
        if rid and await self.folder_alive(token, rid):
            return rid
        f = await self.create_folder(token, ROOT_FOLDER_NAME)
        await self.db.integrations.update_one({"key": KEY}, {"$set": {"root_folder_id": f["id"], "root_folder_link": f.get("webViewLink", "")}})
        return f["id"]

    async def ensure_project_folders(self, token: str, project: dict, sections: set) -> dict:
        state = dict(project.get("site_photos_drive") or {})
        subs = dict(state.get("subfolders") or {})
        changed = False
        if not state.get("folder_id") or not await self.folder_alive(token, state["folder_id"]):
            root = await self.ensure_root(token)
            cust = (project.get("customer") or {}).get("name") or "Customer"
            district = (project.get("location") or {}).get("district") or ""
            ref = project.get("reference_number") or f"SCR-{str(project['_id'])[-6:].upper()}"
            name = " · ".join(x for x in [ref, cust, district] if x)
            f = await self.create_folder(token, name, root)
            state.update(folder_id=f["id"], folder_link=f.get("webViewLink", ""), folder_name=_safe_name(name))
            subs = {}
            changed = True
        for cat in CHECKLIST:
            if cat["key"] in sections and not subs.get(cat["key"]):
                f = await self.create_folder(token, cat["folder"], state["folder_id"])
                subs[cat["key"]] = f["id"]
                changed = True
        state["subfolders"] = subs
        if changed:
            upd = {"site_photos_drive.folder_id": state["folder_id"], "site_photos_drive.folder_link": state.get("folder_link", ""),
                   "site_photos_drive.folder_name": state.get("folder_name", ""), "site_photos_drive.subfolders": subs}
            # The project's own "Drive folder" link points at this folder unless someone already set one by hand
            if not project.get("drive_folder_link"):
                upd.update(drive_folder_link=state.get("folder_link", ""), drive_folder_id=state["folder_id"],
                           drive_folder_name=state.get("folder_name", ""))
            await self.db.projects.update_one({"_id": project["_id"]}, {"$set": upd})
        return state

    # ── sync ──
    def _lock(self, project_id: str) -> asyncio.Lock:
        if project_id not in self._locks:
            self._locks[project_id] = asyncio.Lock()
        return self._locks[project_id]

    async def sync_project(self, project_id: str, force: bool = False) -> dict:
        async with self._lock(project_id):
            return await self._sync(project_id, force)

    async def _sync(self, project_id: str, force: bool) -> dict:
        result = {"uploaded": 0, "already_in_drive": 0, "failed": 0, "pending": 0, "folder_link": ""}
        if not await self.is_connected():
            result["status"] = "not_connected"
            return result
        try:
            oid = ObjectId(project_id)
        except Exception:
            result["status"] = "not_found"
            return result
        project = await self.db.projects.find_one({"_id": oid, "deleted_at": {"$exists": False}})
        if not project:
            result["status"] = "not_found"
            return result
        sp = project.get("site_photos") or {}
        todo = [(slot, p) for slot, lst in sp.items() if slot in SLOTS for p in (lst or [])
                if p.get("drive_status") != "uploaded" and (force or int(p.get("drive_attempts") or 0) < MAX_ATTEMPTS)]
        result["folder_link"] = (project.get("site_photos_drive") or {}).get("folder_link", "")
        if not todo:
            result["status"] = "up_to_date"
            result["pending"] = pending_count(sp)
            return result
        try:
            token = await self.access_token()
            state = await self.ensure_project_folders(token, project, {SLOTS[s]["category"] for s, _ in todo})
            result["folder_link"] = state.get("folder_link", "")
            already = await self.existing_files(token, project_id)
        except DriveError as e:
            await self._set_error(str(e), e.reconnect)
            await self.db.projects.update_one({"_id": oid}, {"$set": {"site_photos_drive.last_error": str(e)}})
            result.update(status="error", error=str(e))
            return result

        for slot, p in todo:
            meta = SLOTS[slot]
            idx = next((i for i, x in enumerate(sp.get(slot) or [], 1) if x.get("id") == p["id"]), 1)
            total = len(sp.get(slot) or [])
            ext = (p.get("storage_path") or "").rsplit(".", 1)[-1] if "." in (p.get("storage_path") or "") else "jpg"
            name = f"{meta['no']} {meta['label']}" + (f" ({idx})" if total > 1 else "") + f".{ext}"
            set_ok = None
            try:
                f = already.get(p["id"])
                if f:
                    result["already_in_drive"] += 1
                else:
                    try:
                        data, ctype = self.get_object(p["storage_path"])
                    except FileNotFoundError:
                        raise DriveError("The original file is missing on the server")
                    desc = " · ".join(x for x in [
                        meta["label"],
                        f"Taken {p.get('taken_at', '')[:16].replace('T', ' ')}" if p.get("taken_at") else "",
                        f"GPS {p['lat']:.6f}, {p['lng']:.6f}" if isinstance(p.get("lat"), (int, float)) and isinstance(p.get("lng"), (int, float)) else "",
                        f"By {p.get('uploaded_by_name')}" if p.get("uploaded_by_name") else "",
                    ] if x)
                    f = await self.upload(token, name, state["subfolders"][meta["category"]], data, p.get("content_type") or ctype,
                                          {"sensoper_project": project_id, "sensoper_photo_id": p["id"], "sensoper_slot": slot}, desc)
                    result["uploaded"] += 1
                set_ok = {"drive_status": "uploaded", "drive_file_id": f["id"], "drive_link": f.get("webViewLink", ""),
                          "drive_error": None, "drive_synced_at": _now().isoformat()}
            except DriveError as e:
                result["failed"] += 1
                await self.db.projects.update_one(
                    {"_id": oid, f"site_photos.{slot}.id": p["id"]},
                    {"$set": {f"site_photos.{slot}.$.drive_status": "error", f"site_photos.{slot}.$.drive_error": str(e)[:300]},
                     "$inc": {f"site_photos.{slot}.$.drive_attempts": 1}})
                if e.reconnect or e.status == 401:
                    await self._set_error(str(e), e.reconnect)
                    break
                continue
            await self.db.projects.update_one({"_id": oid, f"site_photos.{slot}.id": p["id"]},
                                              {"$set": {f"site_photos.{slot}.$.{k}": v for k, v in set_ok.items()}})

        fresh = await self.db.projects.find_one({"_id": oid}, {"site_photos": 1})
        result["pending"] = pending_count((fresh or {}).get("site_photos"))
        await self.db.projects.update_one({"_id": oid}, {"$set": {
            "site_photos_pending": result["pending"], "site_photos_drive.last_synced_at": _now().isoformat(),
            "site_photos_drive.last_error": None if not result["failed"] else f"{result['failed']} file(s) could not be copied — will retry",
        }})
        if result["uploaded"] or result["already_in_drive"]:
            await self.db.integrations.update_one({"key": KEY}, {"$set": {"last_sync_at": _now().isoformat(), "last_error": None}})
        result["status"] = "ok" if not result["failed"] else "partial"
        return result

    def spawn(self, coro):
        """Run a coroutine in the background, keeping a reference so it isn't garbage-collected."""
        try:
            t = asyncio.get_event_loop().create_task(coro)
        except RuntimeError:
            coro.close()
            return None
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return t

    def schedule(self, project_id: str):
        """Fire-and-forget sync after a save. Never raises into the request."""
        async def run():
            try:
                if await self.is_connected():
                    await self.sync_project(project_id)
            except Exception as e:  # pragma: no cover — logged, retried by the loop
                logger.warning(f"Drive sync for {project_id} failed: {e}")
        self.spawn(run())

    async def sync_all_pending(self, limit: int = 50) -> dict:
        done = 0
        async for p in self.db.projects.find({"site_photos_pending": {"$gt": 0}, "deleted_at": {"$exists": False}}, {"_id": 1}).limit(limit):
            if not await self.is_connected():
                break
            await self.sync_project(str(p["_id"]))
            done += 1
        return {"projects": done}

    def start(self):
        async def loop():
            await asyncio.sleep(30)
            while True:
                try:
                    if await self.is_connected():
                        await self.sync_all_pending()
                except Exception as e:  # pragma: no cover
                    logger.warning(f"Drive retry loop: {e}")
                await asyncio.sleep(RETRY_EVERY_SECONDS)
        if not self._loop_task:
            self._loop_task = asyncio.get_event_loop().create_task(loop())


def _json(r: httpx.Response) -> dict:
    try:
        d = r.json()
        return d if isinstance(d, dict) else {}
    except ValueError:
        return {}


def _id_token_email(id_token: str) -> str:
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("email", "")
    except Exception:
        return ""


class CallbackBody(BaseModel):
    code: Optional[str] = None
    state: str
    error: Optional[str] = None


def create_router(db, get_current_user, require_role, create_audit_log, drive: DriveSync):
    router = APIRouter()

    @router.get("/integrations/google-drive")
    async def status(request: Request):
        user = await get_current_user(request)
        doc = await drive.integration() or {}
        connected = await drive.is_connected()
        out = {"connected": connected, "status": doc.get("status") or "not_connected"}
        if user["role"] in ("admin", "manager"):
            pending = 0
            async for p in db.projects.find({"site_photos_pending": {"$gt": 0}, "deleted_at": {"$exists": False}}, {"site_photos_pending": 1}):
                pending += int(p.get("site_photos_pending") or 0)
            out.update({
                "configured": bool(client_id() and client_secret()),
                "missing": [k for k, v in (("GOOGLE_CLIENT_SECRET", client_secret()), ("VAULT_MASTER_KEY", os.environ.get("VAULT_MASTER_KEY"))) if not v],
                "client_id": client_id(), "redirect_uri": redirect_uri(),
                "account_email": doc.get("account_email", ""), "connected_by": doc.get("connected_by_name", ""),
                "connected_at": doc.get("connected_at"), "root_folder_link": doc.get("root_folder_link", ""),
                "last_sync_at": doc.get("last_sync_at"), "last_error": doc.get("last_error"), "pending_photos": pending,
            })
        return out

    @router.post("/integrations/google-drive/connect")
    async def connect(request: Request):
        user = await require_role("admin")(request)
        if not client_secret():
            raise HTTPException(status_code=503, detail="Add GOOGLE_CLIENT_SECRET to the backend .env file and restart, then try again.")
        if not os.environ.get("VAULT_MASTER_KEY"):
            raise HTTPException(status_code=503, detail="Add VAULT_MASTER_KEY to the backend .env file (it encrypts the Google token), restart, then try again.")
        state = secrets.token_urlsafe(32)
        await db.oauth_states.insert_one({"state": state, "provider": KEY, "user_id": user["id"], "user_name": user.get("name", ""),
                                          "created_at": _now().isoformat(), "expires_at": (_now() + timedelta(minutes=15)).isoformat()})
        params = {"client_id": client_id(), "redirect_uri": redirect_uri(), "response_type": "code", "scope": SCOPES,
                  "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true", "state": state}
        return {"auth_url": f"{AUTH_URL}?{urlencode(params)}", "redirect_uri": redirect_uri()}

    @router.post("/integrations/google-drive/callback")
    async def callback(body: CallbackBody, request: Request):
        """Finishes the Google sign-in. The single-use `state` (15 min, tied to the admin who pressed Connect)
        is what authorises this call, so it works even if Google sends the browser back on another sub-domain."""
        st = await db.oauth_states.find_one_and_delete({"state": body.state, "provider": KEY})
        if not st or st.get("expires_at", "") < _now().isoformat():
            raise HTTPException(status_code=400, detail="This Google sign-in link has expired. Go back to Settings and press Connect again.")
        if body.error or not body.code:
            raise HTTPException(status_code=400, detail="Google sign-in was cancelled." if body.error == "access_denied" else f"Google sign-in failed ({body.error or 'no code'}).")
        async with drive._client() as c:
            r = await c.post(TOKEN_URL, data={"code": body.code, "client_id": client_id(), "client_secret": client_secret(),
                                              "redirect_uri": redirect_uri(), "grant_type": "authorization_code"})
        tok = _json(r)
        if r.status_code >= 400 or "access_token" not in tok:
            err = tok.get("error_description") or tok.get("error") or f"HTTP {r.status_code}"
            if tok.get("error") == "redirect_uri_mismatch":
                err = f"the redirect URI {redirect_uri()} is not listed on the Google OAuth client"
            raise HTTPException(status_code=400, detail=f"Google did not accept the sign-in: {err}")
        if SCOPE_DRIVE not in (tok.get("scope") or ""):
            raise HTTPException(status_code=400, detail="Google Drive permission was not ticked. Press Connect again and allow access to Google Drive.")
        prev = await drive.integration() or {}
        refresh = tok.get("refresh_token") or (decrypt_secret(prev["refresh_token_enc"]) if prev.get("refresh_token_enc") else "")
        if not refresh:
            raise HTTPException(status_code=400, detail="Google did not return a long-lived token. Remove Sensoper from https://myaccount.google.com/permissions and connect again.")
        email = _id_token_email(tok.get("id_token", ""))
        now = _now().isoformat()
        doc = {"key": KEY, "status": "connected", "refresh_token_enc": encrypt_secret(refresh), "scope": tok.get("scope", ""),
               "account_email": email, "connected_by": st.get("user_id"), "connected_by_name": st.get("user_name", ""),
               "connected_at": now, "last_error": None}
        switched = bool(prev.get("account_email") and email and prev.get("account_email") != email)
        if switched:
            doc.update(root_folder_id=None, root_folder_link="")
        await db.integrations.update_one({"key": KEY}, {"$set": doc}, upsert=True)
        drive._token = tok["access_token"]
        drive._token_exp = _now() + timedelta(seconds=int(tok.get("expires_in", 3600)))
        drive._token_for = now
        if switched:
            await _reset_all_drive_state(db)
        try:
            await drive.ensure_root(drive._token)
        except DriveError as e:
            logger.warning(f"Could not create the Drive root folder yet: {e}")
        await create_audit_log(st.get("user_id"), st.get("user_name", ""), "connect", "google_drive", KEY, details=email)
        drive.spawn(drive.sync_all_pending(limit=500))
        return {"connected": True, "account_email": email}

    @router.delete("/integrations/google-drive")
    async def disconnect(request: Request):
        user = await require_role("admin")(request)
        doc = await drive.integration()
        if doc and doc.get("refresh_token_enc"):
            try:
                async with drive._client() as c:
                    await c.post(REVOKE_URL, data={"token": decrypt_secret(doc["refresh_token_enc"])})
            except Exception as e:
                logger.info(f"Google token revoke failed (ignored): {e}")
        await db.integrations.update_one({"key": KEY}, {"$set": {"status": "not_connected", "refresh_token_enc": None,
                                                                 "disconnected_at": _now().isoformat()}})
        drive._token = None
        await create_audit_log(user["id"], user.get("name", ""), "disconnect", "google_drive", KEY)
        return {"connected": False}

    @router.post("/integrations/google-drive/sync")
    async def sync_all(request: Request):
        await require_role("admin", "manager")(request)
        if not await drive.is_connected():
            raise HTTPException(status_code=409, detail="Google Drive is not connected")
        return await drive.sync_all_pending(limit=200)

    return router


async def _reset_all_drive_state(db):
    """A different Google account was connected: its Drive has none of our folders, so copy everything again."""
    async for p in db.projects.find({"site_photos": {"$exists": True}}, {"site_photos": 1, "site_photos_drive": 1, "drive_folder_id": 1}):
        sp = p.get("site_photos") or {}
        for lst in sp.values():
            for ph in lst or []:
                ph.update(drive_status="pending", drive_file_id=None, drive_link=None, drive_error=None, drive_attempts=0)
        unset = {"site_photos_drive": ""}
        old_folder = (p.get("site_photos_drive") or {}).get("folder_id")
        if old_folder and p.get("drive_folder_id") == old_folder:   # the project link pointed at the old account's folder
            unset.update(drive_folder_link="", drive_folder_id="", drive_folder_name="")
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {"site_photos": sp, "site_photos_pending": pending_count(sp)},
                                                         "$unset": unset})
