"""What3words lookups for the New project → Location step.

The browser never sees the API key: it calls these endpoints, the server calls what3words with
W3W_API_KEY from the environment (backend/.env). Results are cached in `w3w_cache`, so the same
spot looked up twice costs one API call.

    GET /api/geo/what3words/status              → {"configured": bool}
    GET /api/geo/what3words?lat=..&lng=..       → {"words": "index.home.raft", "nearest_place": ..., "map": ...}
    GET /api/geo/what3words/coordinates?words=  → {"lat": .., "lng": .., ...}  (needs a plan that allows it)
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Request

W3W_BASE = "https://api.what3words.com/v3"
WORDS_RE = re.compile(r"^/{0,3}([^\W\d_]+)\.([^\W\d_]+)\.([^\W\d_]+)$", re.UNICODE)

# Tests swap this for an httpx.MockTransport.
_transport = None


def _key() -> str:
    return (os.environ.get("W3W_API_KEY") or "").strip()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=10, transport=_transport)


def _clean_words(words: str) -> str:
    m = WORDS_RE.match((words or "").strip().lower())
    if not m:
        raise HTTPException(status_code=400, detail="Use the format word.word.word")
    return ".".join(m.groups())


def _error_message(code: str, message: str) -> str:
    friendly = {
        "InvalidKey": "The What3words API key is not valid. Check W3W_API_KEY in the server .env file.",
        "MissingKey": "The What3words API key is missing on the server.",
        "QuotaExceeded": "The What3words monthly limit has been used up.",
        "SuspendedKey": "The What3words API key is suspended.",
        "BadCoordinates": "Those coordinates are not valid.",
        "BadWords": "Those three words are not a valid What3words address.",
        "Forbidden": "Your What3words plan does not allow this lookup.",
    }
    return friendly.get(code) or message or "What3words lookup failed"


async def _call(path: str, params: dict) -> dict:
    key = _key()
    if not key:
        raise HTTPException(status_code=503, detail="What3words is not set up: add W3W_API_KEY to the backend .env file and restart.")
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
        raise HTTPException(status_code=status, detail=_error_message(code, (err or {}).get("message", "")))
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


def create_router(db, get_current_user):
    router = APIRouter()

    @router.get("/geo/what3words/status")
    async def w3w_status(request: Request):
        await get_current_user(request)
        return {"configured": bool(_key())}

    @router.get("/geo/what3words")
    async def coords_to_words(lat: float, lng: float, request: Request):
        await get_current_user(request)
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise HTTPException(status_code=400, detail="Those coordinates are not valid.")
        # 5 decimals ≈ 1 m; a what3words square is 3 m, so one cache row per square-ish spot
        ck = f"{lat:.5f},{lng:.5f}"
        hit = await db.w3w_cache.find_one({"kind": "3wa", "key": ck}, {"_id": 0})
        if hit and hit.get("result"):
            return {**hit["result"], "source": "cache"}
        data = await _call("convert-to-3wa", {"coordinates": f"{lat},{lng}", "language": "en"})
        result = _shape(data, "what3words")
        await db.w3w_cache.update_one({"kind": "3wa", "key": ck},
                                      {"$set": {"result": result, "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        return result

    @router.get("/geo/what3words/coordinates")
    async def words_to_coords(words: str, request: Request):
        await get_current_user(request)
        w = _clean_words(words)
        hit = await db.w3w_cache.find_one({"kind": "coords", "key": w}, {"_id": 0})
        if hit and hit.get("result"):
            return {**hit["result"], "source": "cache"}
        data = await _call("convert-to-coordinates", {"words": w})
        result = _shape(data, "what3words")
        await db.w3w_cache.update_one({"kind": "coords", "key": w},
                                      {"$set": {"result": result, "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        return result

    return router
