"""Site GPS for saved projects.

    PUT /api/projects/{id}/geo {lat, lng, accuracy} → pin a saved project to the phone's location

New projects capture GPS on the Location step ("Use my location"); this endpoint lets someone standing at the
site later update a saved project in one tap. It's a map pin, not quote content, so it works in any status and
never sends a project back for approval. (What3words was removed in Oct 2026 — coordinates only.)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel


class GeoPin(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None


def create_router(db, get_current_user, create_audit_log=None):
    router = APIRouter()

    @router.put("/projects/{project_id}/geo")
    async def pin_project(project_id: str, body: GeoPin, request: Request):
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
        if not (-90 <= body.lat <= 90 and -180 <= body.lng <= 180) or (body.lat == 0 and body.lng == 0):
            raise HTTPException(status_code=400, detail="Those coordinates are not valid.")
        upd = {"location.latitude": round(body.lat, 6), "location.longitude": round(body.lng, 6),
               "location.gps_accuracy_m": body.accuracy, "location.gps_updated_at": datetime.now(timezone.utc).isoformat(),
               "location.gps_updated_by": user.get("name", "")}
        await db.projects.update_one({"_id": oid}, {"$set": upd})
        if create_audit_log:
            await create_audit_log(user["id"], user.get("name", ""), "update", "project_location", project_id,
                                   details=f"{body.lat:.6f},{body.lng:.6f}")
        return {"latitude": upd["location.latitude"], "longitude": upd["location.longitude"], "accuracy": body.accuracy}

    return router
