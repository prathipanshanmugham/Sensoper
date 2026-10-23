"""Live refresh: every successful change (POST / PUT / PATCH / DELETE under /api) bumps a counter for its area
("projects", "inventory", "amc", …). Screens poll GET /api/sync/version every few seconds — and when the app comes
back to the front — and reload only the areas that changed, so what one person saves shows up for everyone
without pressing refresh.

The counters live in MongoDB (`sync_state`), so it works with several server processes."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request

# Calls that don't change shared data (or that only the caller sees).
SKIP = {"auth", "sync", "upload", "files", "calculate", "notifications", "investor", "permissions"}
# Areas that move together on screen.
ALIAS = {
    "material-kits": "inventory", "kit-categories": "inventory", "inventory-approvals": "inventory",
    "site-visits": "projects", "deletion-requests": "projects", "adhoc-lines": "projects", "project-payments": "projects",
    "purchase-orders": "purchases", "purchase-inbound": "purchases", "grn": "purchases",
    "approvals": "approvals",
    "purchase-requests": "purchases", "procurement": "purchases",
}
SKIP_PATHS = ("/api/amc/quotes/preview",)


def topic_for(method: str, path: str) -> Optional[str]:
    """Pure: which area a request changes, or None."""
    if method not in ("POST", "PUT", "PATCH", "DELETE") or not path.startswith("/api/") or path.startswith(SKIP_PATHS):
        return None
    seg = path[5:].split("/", 1)[0].strip().lower()
    if not seg or seg in SKIP:
        return None
    return ALIAS.get(seg, seg)


class LiveSyncMiddleware:
    """Pure ASGI middleware (no BaseHTTPMiddleware) — looks at the response status and bumps the area's counter."""

    def __init__(self, app, db_getter):
        self.app = app
        self._db = db_getter

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        topic = topic_for(scope.get("method", ""), scope.get("path", ""))
        if not topic:
            return await self.app(scope, receive, send)
        status = {"code": 500}

        async def watch(message):
            if message["type"] == "http.response.start":
                status["code"] = message.get("status", 500)
            await send(message)

        await self.app(scope, receive, watch)
        if status["code"] < 400:
            try:
                await self._db().sync_state.update_one({"_id": topic}, {"$inc": {"v": 1}, "$set": {"at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
            except Exception:  # never let the refresh signal break a save
                pass


def create_router(db, get_current_user):
    router = APIRouter()

    @router.get("/sync/version")
    async def version(request: Request):
        """{area: {v, at}} — cheap enough to poll; screens compare `v` with what they loaded."""
        await get_current_user(request)
        topics: Dict[str, Any] = {d["_id"]: {"v": d.get("v", 0), "at": d.get("at")} async for d in db.sync_state.find({})}
        return {"topics": topics, "now": datetime.now(timezone.utc).isoformat()}

    return router
