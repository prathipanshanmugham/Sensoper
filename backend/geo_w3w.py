"""What3words lookups for the New project → Location step and the project page.

The browser never sees the API key. It calls these endpoints and the server calls What3words.
Key: the one an admin saved in Settings (stored encrypted with VAULT_MASTER_KEY) wins; otherwise
W3W_API_KEY from backend/.env. Results are cached in `w3w_cache`, so the same spot looked up twice
costs one API call.

    GET    /api/geo/what3words/status              → {"configured": bool, "source": "settings"|"env"|null}
    PUT    /api/geo/what3words/key   {api_key}     → admin: test + save a new key
    DELETE /api/geo/what3words/key                 → admin: forget the saved key (falls back to .env)
    GET    /api/geo/what3words?lat=..&lng=..       → {"words": "index.home.raft", "nearest_place": ..., "map": ...}
    GET    /api/geo/what3words/coordinates?words=  → {"lat": .., "lng": .., ...}  (needs a plan that allows it)
    PUT    /api/projects/{id}/geo {lat, lng}       → pin a saved project to the phone's location (+ words)
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from vault import decrypt_secret, encrypt_secret

W3W_BASE = "https://api.what3words.com/v3"
WORDS_RE = re.compile(r"^/{0,3}([^\W\d_]+)\.([^\W\d_]+)\.([^\W\d_]+)$", re.UNICODE)
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
STORE_KEY = "what3words"
TEST_POINT = "11.341036,77.717163"   # Erode — used to check a new key works
CACHE_SECONDS = 60

# Tests swap this for an httpx.MockTransport.
_transport = None
_key_cache = {"value": None, "at": 0.0}


def invalidate_key_cache():
    _key_cache.update(value=None, at=0.0)


async def resolve_key(db) -> tuple:
    """(key, source) — the key saved in Settings wins over W3W_API_KEY in .env."""
    now = time.monotonic()
    if _key_cache["value"] is None or now - _key_cache["at"] > CACHE_SECONDS:
        saved = ""
        doc = await db.integrations.find_one({"key": STORE_KEY})
        if doc and doc.get("api_key_enc"):
            try:
                saved = decrypt_secret(doc["api_key_enc"])
            except HTTPException:
                saved = ""
        _key_cache.update(value=saved, at=now)
    if _key_cache["value"]:
        return _key_cache["value"], "settings"
    env = (os.environ.get("W3W_API_KEY") or "").strip()
    return (env, "env") if env else ("", None)


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=10, transport=_transport)


def _clean_words(words: str) -> str:
    m = WORDS_RE.match((words or "").strip().lower())
    if not m:
        raise HTTPException(status_code=400, detail="Use the format word.word.word")
    return ".".join(m.groups())


def _error_message(code: str, message: str) -> str:
    friendly = {
        "InvalidKey": "The What3words API key is not valid. An admin can paste a new key in Settings → What3words.",
        "MissingKey": "The What3words API key is missing. An admin can add it in Settings → What3words.",
        "QuotaExceeded": "The What3words monthly limit has been used up.",
        "SuspendedKey": "The What3words API key is suspended.",
        "BadCoordinates": "Those coordinates are not valid.",
        "BadWords": "Those three words are not a valid What3words address.",
        "Forbidden": "Your What3words plan does not allow this lookup.",
    }
    return friendly.get(code) or message or "What3words lookup failed"


async def _call(key: str, path: str, params: dict) -> dict:
    if not key:
        raise HTTPException(status_code=503, detail="What3words is not set up yet. An admin can add the API key in Settings → What3words.")
    try:
        async with _client() as c:
            # Key goes in a header, not the URL, so it never lands in access/httpx logs
            r = await c.get(f"{W3W_BASE}/{path}", params={**params, "format": "json"}, headers={"X-Api-Key": key})
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not reach What3words. Check the internet connection and try again.")
    try:
        data = r.json()
    except ValueError:
        data = {}
    err = data.get("error") if isinstance(data, dict) else None
    if r.status_code >= 400 or err:
        code = (err or {}).get("code", "")
        status = 400 if code in ("BadCoordinates", "BadWords") else 502
        if code in ("InvalidKey", "MissingKey", "SuspendedKey", "Forbidden", "QuotaExceeded") or r.status_code in (401, 402, 403):
            status = 503
        exc = HTTPException(status_code=status, detail=_error_message(code, (err or {}).get("message", "")))
        exc.w3w_code = code
        raise exc
    return data


def _shape(data: dict, source: str) -> dict:
    coords = data.get("coordinates") or {}
    return {
        "words": data.get("words", ""),
        "lat": coords.get("lat"),
        "lng": coords.get("lng"),
        "nearest_place": data.get("nearestPlace", ""),
        "country": data.get("country", ""),
        "map": data.get("map", ""),
        "source": source,
    }


class KeyBody(BaseModel):
    api_key: str


class GeoPin(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None


def create_router(db, get_current_user, require_role=None, create_audit_log=None):
    router = APIRouter()

    async def _admin(request: Request):
        if require_role:
            return await require_role("admin")(request)
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admins only")
        return user

    async def words_for(lat: float, lng: float) -> dict:
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise HTTPException(status_code=400, detail="Those coordinates are not valid.")
        # 5 decimals ≈ 1 m; a what3words square is 3 m, so one cache row per square-ish spot
        ck = f"{lat:.5f},{lng:.5f}"
        hit = await db.w3w_cache.find_one({"kind": "3wa", "key": ck}, {"_id": 0})
        if hit and hit.get("result"):
            return {**hit["result"], "source": "cache"}
        key, _ = await resolve_key(db)
        data = await _call(key, "convert-to-3wa", {"coordinates": f"{lat},{lng}", "language": "en"})
        result = _shape(data, "what3words")
        await db.w3w_cache.update_one({"kind": "3wa", "key": ck},
                                      {"$set": {"result": result, "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        return result

    @router.get("/geo/what3words/status")
    async def w3w_status(request: Request):
        user = await get_current_user(request)
        key, source = await resolve_key(db)
        out = {"configured": bool(key), "source": source}
        if user.get("role") == "admin" and key:
            out["hint"] = f"…{key[-4:]}"
        return out

    @router.put("/geo/what3words/key")
    async def save_key(body: KeyBody, request: Request):
        user = await _admin(request)
        key = (body.api_key or "").strip()
        if not KEY_RE.match(key):
            raise HTTPException(status_code=400, detail="That doesn't look like a What3words API key (letters and numbers only).")
        tested, note = True, "Key checked with What3words and saved."
        try:
            await _call(key, "convert-to-3wa", {"coordinates": TEST_POINT, "language": "en"})
        except HTTPException as e:
            code = getattr(e, "w3w_code", "")
            if code in ("InvalidKey", "MissingKey", "SuspendedKey") or (e.status_code == 503 and code not in ("Forbidden", "QuotaExceeded")):
                raise HTTPException(status_code=400, detail="What3words says this key is not valid. Copy it again from your What3words account.")
            tested, note = False, f"Saved, but it could not be checked just now ({e.detail})"
        await db.integrations.update_one({"key": STORE_KEY}, {"$set": {
            "key": STORE_KEY, "api_key_enc": encrypt_secret(key), "updated_by": user.get("name", ""),
            "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        await db.w3w_cache.delete_many({})   # old answers may have come from a different account/plan
        invalidate_key_cache()
        if create_audit_log:
            await create_audit_log(user["id"], user.get("name", ""), "update", "what3words_key", STORE_KEY, details=f"key …{key[-4:]}")
        return {"configured": True, "source": "settings", "hint": f"…{key[-4:]}", "tested": tested, "message": note}

    @router.delete("/geo/what3words/key")
    async def delete_key(request: Request):
        user = await _admin(request)
        await db.integrations.update_one({"key": STORE_KEY}, {"$unset": {"api_key_enc": ""}})
        invalidate_key_cache()
        if create_audit_log:
            await create_audit_log(user["id"], user.get("name", ""), "delete", "what3words_key", STORE_KEY)
        key, source = await resolve_key(db)
        return {"configured": bool(key), "source": source}

    @router.get("/geo/what3words")
    async def coords_to_words(lat: float, lng: float, request: Request):
        await get_current_user(request)
        return await words_for(lat, lng)

    @router.get("/geo/what3words/coordinates")
    async def words_to_coords(words: str, request: Request):
        await get_current_user(request)
        w = _clean_words(words)
        hit = await db.w3w_cache.find_one({"kind": "coords", "key": w}, {"_id": 0})
        if hit and hit.get("result"):
            return {**hit["result"], "source": "cache"}
        key, _ = await resolve_key(db)
        data = await _call(key, "convert-to-coordinates", {"words": w})
        result = _shape(data, "what3words")
        await db.w3w_cache.update_one({"kind": "coords", "key": w},
                                      {"$set": {"result": result, "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        return result

    @router.put("/projects/{project_id}/geo")
    async def pin_project(project_id: str, body: GeoPin, request: Request):
        """Standing at the site later? Update a saved project's GPS + What3words in one tap.
        Any status (it's a map pin, not quote content), so it never sends a project back for approval."""
        user = await get_current_user(request)
        try:
            oid = ObjectId(project_id)
        except Exception:
            raise HTTPException(status_code=404, detail="Project not found")
        project = await db.projects.find_one({"_id": oid, "deleted_at": {"$exists": False}})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if user.get("role") == "staff" and project.get("created_by") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only update your own projects")
        if not (-90 <= body.lat <= 90 and -180 <= body.lng <= 180):
            raise HTTPException(status_code=400, detail="Those coordinates are not valid.")
        words, note = "", ""
        try:
            words = (await words_for(body.lat, body.lng)).get("words", "")
        except HTTPException as e:
            note = e.detail
        upd = {"location.latitude": round(body.lat, 6), "location.longitude": round(body.lng, 6),
               "location.gps_accuracy_m": body.accuracy, "location.gps_updated_at": datetime.now(timezone.utc).isoformat(),
               "location.gps_updated_by": user.get("name", "")}
        if words:
            upd["location.site_location_words"] = words
        await db.projects.update_one({"_id": oid}, {"$set": upd})
        if create_audit_log:
            await create_audit_log(user["id"], user.get("name", ""), "update", "project_location", project_id,
                                   details=f"{body.lat:.6f},{body.lng:.6f} {words}".strip())
        return {"latitude": upd["location.latitude"], "longitude": upd["location.longitude"], "site_location_words": words or (project.get("location") or {}).get("site_location_words", ""),
                "words_updated": bool(words), "note": note}

    return router
