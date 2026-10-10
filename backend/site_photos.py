"""Site photo checklist for the New project form (Site photos step) and the project page.

A photo is uploaded once (POST /api/site-photos/upload), kept on the server's own storage, and
attached to a project under one checklist slot. `google_drive.DriveSync` then copies every
attached photo into the company Google Drive (one folder per project, one sub-folder per
checklist section) whenever Drive is connected.

Project fields:
    site_photos          {slot_key: [photo, ...]}   photo = see _record()
    site_photos_pending  int — photos not yet copied to Drive (lets the retry loop find work)
    site_photos_drive    {folder_id, folder_link, folder_name, subfolders{section: id}, last_synced_at, last_error}
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

MAX_PER_SLOT = 12
MAX_BYTES = 15 * 1024 * 1024

# ── The checklist. `min` = how many shots make the slot complete; `optional` slots never block. ──
CHECKLIST: List[Dict[str, Any]] = [
    {"key": "site", "title": "Site & access", "folder": "1 Site & access", "items": [
        {"key": "building_front", "label": "Building front", "hint": "Door or house number visible"},
        {"key": "approach_road", "label": "Approach road & unloading spot", "hint": "Where the vehicle can unload material"},
        {"key": "roof_access", "label": "Staircase or ladder to the roof", "hint": "The path for shifting panels up"},
    ]},
    {"key": "roof", "title": "Roof", "folder": "2 Roof", "items": [
        {"key": "roof_corners", "label": "Full roof from all 4 corners", "hint": "Wide shots — one from each corner", "min": 4},
        {"key": "roof_surface", "label": "Roof surface close-up", "hint": "RCC or sheet; cracks, seepage, waterproofing"},
        {"key": "sheet_roof", "label": "Sheet roof details", "hint": "Purlin spacing, sheet profile, rust — sheet roofs only", "optional": True},
        {"key": "parapet", "label": "Parapet wall height", "hint": "Keep a measuring tape in the frame"},
        {"key": "obstructions", "label": "Obstructions", "hint": "Water tank, staircase headroom, solar water heater, dish, pipes"},
        {"key": "shadow_sources", "label": "Shadow sources", "hint": "Trees, taller buildings nearby, mobile towers"},
        {"key": "compass", "label": "Compass showing south", "hint": "Phone compass screenshot"},
        {"key": "drainage", "label": "Drainage points & roof slope"},
    ]},
    {"key": "electrical", "title": "Electrical", "folder": "3 Electrical", "items": [
        {"key": "eb_meter", "label": "EB meter close-up", "hint": "Meter number must be readable"},
        {"key": "service_cable", "label": "Incoming service cable", "hint": "Single or three phase"},
        {"key": "main_db", "label": "Main DB / MCB panel, opened", "hint": "Main switch rating visible"},
        {"key": "existing_earthing", "label": "Existing earthing pit", "hint": "If there is one", "optional": True},
        {"key": "inverter_wall", "label": "Proposed inverter wall", "hint": "Shade, ventilation, close to the DB"},
        {"key": "cable_route", "label": "Cable route", "hint": "Roof → inverter → DB"},
        {"key": "earthing_la_spot", "label": "Proposed earthing pit & lightning arrester spot"},
        {"key": "backup_power", "label": "Existing UPS, batteries or DG set", "hint": "If there is one", "optional": True},
        {"key": "ci_panels", "label": "C&I: transformer nameplate, HT/LT & APFC panels", "hint": "Commercial & industrial sites only", "optional": True},
    ]},
    {"key": "documents", "title": "Documents", "folder": "4 Documents", "items": [
        {"key": "eb_bill", "label": "Latest EB bill — both sides", "hint": "Consumer number, tariff, sanctioned load", "min": 2, "docs": True},
        {"key": "consumption_history", "label": "6–12 months consumption history", "hint": "Bill or TNPDCL app screenshot", "docs": True},
    ]},
    {"key": "proof", "title": "Proof of visit", "folder": "5 Proof of visit", "items": [
        {"key": "team_with_customer", "label": "Team with the customer at the site", "hint": "Location, date and time are stamped on the photo", "geotag": True},
    ]},
    {"key": "other", "title": "More project photos", "folder": "6 More photos", "items": [
        {"key": "other_photos", "label": "Other project photos", "hint": "Anything else — installation progress, handover, damage, documents", "optional": True, "max": 30, "docs": True},
    ]},
]

SLOTS: Dict[str, Dict[str, Any]] = {}
for _ci, _cat in enumerate(CHECKLIST, 1):
    for _ii, _it in enumerate(_cat["items"], 1):
        SLOTS[_it["key"]] = {**_it, "min": _it.get("min", 1), "optional": bool(_it.get("optional")),
                             "category": _cat["key"], "folder": _cat["folder"], "no": f"{_ci}.{_ii}"}

SERVER_FIELDS = ("drive_status", "drive_file_id", "drive_link", "drive_error", "drive_attempts", "drive_synced_at")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def summarise(site_photos: Optional[dict]) -> dict:
    """Checklist progress for a project's site_photos."""
    sp = site_photos or {}
    req = [k for k, s in SLOTS.items() if not s["optional"]]
    done = [k for k in req if len(sp.get(k) or []) >= SLOTS[k]["min"]]
    all_photos = [p for k in SLOTS for p in (sp.get(k) or [])]
    return {
        "required_total": len(req),
        "required_done": len(done),
        "photos": len(all_photos),
        "drive_uploaded": sum(1 for p in all_photos if p.get("drive_status") == "uploaded"),
        "drive_pending": sum(1 for p in all_photos if p.get("drive_status") != "uploaded"),
        "missing": [SLOTS[k]["label"] for k in req if k not in done],
    }


def pending_count(site_photos: Optional[dict]) -> int:
    return summarise(site_photos)["drive_pending"]


def _record(up: dict) -> dict:
    return {
        "id": up["id"], "slot": up["slot"], "storage_path": up["storage_path"],
        "filename": up.get("filename", ""), "content_type": up.get("content_type", ""), "size": up.get("size", 0),
        "lat": up.get("lat"), "lng": up.get("lng"), "accuracy": up.get("accuracy"), "taken_at": up.get("taken_at"),
        "uploaded_by": up.get("uploaded_by"), "uploaded_by_name": up.get("uploaded_by_name"), "uploaded_at": up.get("uploaded_at"),
        "drive_status": "pending", "drive_file_id": None, "drive_link": None, "drive_error": None, "drive_attempts": 0,
    }


async def normalise_for_save(db, incoming: Optional[dict], existing: Optional[dict]) -> Tuple[dict, int]:
    """Turn what the form sent ({slot: [photo or id, ...]}) into trusted records.

    Only photo ids matter from the browser: a photo already on the project keeps its stored record (so a
    form opened before Drive finished never resets drive_file_id and causes a duplicate upload); a new id
    must match a row from POST /site-photos/upload. Unknown ids and unknown slots are dropped."""
    existing_by_id: Dict[str, dict] = {}
    for lst in (existing or {}).values():
        for p in lst or []:
            if isinstance(p, dict) and p.get("id"):
                existing_by_id[p["id"]] = p
    wanted: List[Tuple[str, str]] = []
    for slot, lst in (incoming or {}).items():
        if slot not in SLOTS or not isinstance(lst, list):
            continue
        for p in lst[:SLOTS[slot].get("max", MAX_PER_SLOT)]:
            pid = p.get("id") if isinstance(p, dict) else p
            if isinstance(pid, str) and pid:
                wanted.append((slot, pid))
    new_ids = [pid for _, pid in wanted if pid not in existing_by_id]
    uploads = {}
    if new_ids:
        async for up in db.site_photo_uploads.find({"id": {"$in": new_ids}}, {"_id": 0}):
            uploads[up["id"]] = up
    out: Dict[str, List[dict]] = {}
    seen = set()
    for slot, pid in wanted:
        if pid in seen:
            continue
        rec = existing_by_id.get(pid)
        if rec is None and pid in uploads:
            rec = _record({**uploads[pid], "slot": slot})
        if rec is None:
            continue
        seen.add(pid)
        out.setdefault(slot, []).append({**rec, "slot": slot})
    return out, pending_count(out)


def create_router(db, get_current_user, require_role, create_audit_log, put_object, app_name: str, drive=None):
    router = APIRouter()

    async def _project_for_photos(project_id: str, user: dict) -> dict:
        try:
            oid = ObjectId(project_id)
        except Exception:
            raise HTTPException(status_code=404, detail="Project not found")
        project = await db.projects.find_one({"_id": oid, "deleted_at": {"$exists": False}})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if user["role"] == "staff" and project.get("created_by") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only add photos to your own projects")
        return project

    @router.get("/site-photos/checklist")
    async def checklist(request: Request):
        await get_current_user(request)
        return {"sections": CHECKLIST, "slots": SLOTS, "max_per_slot": MAX_PER_SLOT}

    @router.post("/site-photos/upload")
    async def upload(request: Request, file: UploadFile = File(...), slot: str = Form(...),
                     lat: Optional[float] = Form(None), lng: Optional[float] = Form(None),
                     accuracy: Optional[float] = Form(None), taken_at: Optional[str] = Form(None),
                     project_id: Optional[str] = Form(None)):
        user = await get_current_user(request)
        if slot not in SLOTS:
            raise HTTPException(status_code=400, detail="Unknown checklist item")
        ctype = (file.content_type or "").lower()
        is_pdf = ctype == "application/pdf"
        if not (ctype.startswith("image/") or (is_pdf and SLOTS[slot].get("docs"))):
            raise HTTPException(status_code=400, detail="Only photos" + (" or PDFs" if SLOTS[slot].get("docs") else "") + " can be added here")
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="The file is empty")
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=400, detail="File must be under 15 MB")
        project = await _project_for_photos(project_id, user) if project_id else None
        limit = SLOTS[slot].get("max", MAX_PER_SLOT)
        if project and len((project.get("site_photos") or {}).get(slot) or []) >= limit:
            raise HTTPException(status_code=400, detail=f"Up to {limit} files for this item")
        ext = "pdf" if is_pdf else ((file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg")
        if not ext.isalnum() or len(ext) > 5:
            ext = "jpg"
        photo_id = uuid.uuid4().hex
        path = f"{app_name}/site-photos/{photo_id}.{ext}"
        put_object(path, data, ctype or "image/jpeg")
        up = {
            "id": photo_id, "slot": slot, "storage_path": path, "filename": (file.filename or f"{slot}.{ext}")[:120],
            "content_type": ctype or "image/jpeg", "size": len(data),
            "lat": lat, "lng": lng, "accuracy": accuracy, "taken_at": (taken_at or _now())[:40],
            "uploaded_by": user["id"], "uploaded_by_name": user.get("name", ""), "uploaded_at": _now(),
            "project_id": project_id or None,
        }
        await db.site_photo_uploads.insert_one(dict(up))
        rec = _record(up)
        if project:
            sp = project.get("site_photos") or {}
            sp.setdefault(slot, []).append(rec)
            await db.projects.update_one({"_id": project["_id"]}, {"$push": {f"site_photos.{slot}": rec},
                                                                   "$set": {"site_photos_pending": pending_count(sp), "updated_at": _now()}})
            if drive:
                drive.schedule(project_id)
        return rec

    @router.get("/projects/{project_id}/site-photos")
    async def project_photos(project_id: str, request: Request):
        user = await get_current_user(request)
        project = await _project_for_photos(project_id, user)
        sp = project.get("site_photos") or {}
        return {"site_photos": sp, "summary": summarise(sp), "drive": project.get("site_photos_drive") or {},
                "drive_connected": bool(drive and await drive.is_connected())}

    @router.delete("/projects/{project_id}/site-photos/{photo_id}")
    async def remove_photo(project_id: str, photo_id: str, request: Request):
        """Takes the photo off the checklist. A copy already in Google Drive is left there on purpose."""
        user = await get_current_user(request)
        project = await _project_for_photos(project_id, user)
        sp = project.get("site_photos") or {}
        slot = next((k for k, lst in sp.items() for p in (lst or []) if p.get("id") == photo_id), None)
        if not slot:
            raise HTTPException(status_code=404, detail="Photo not found")
        sp[slot] = [p for p in sp[slot] if p.get("id") != photo_id]
        await db.projects.update_one({"_id": project["_id"]}, {"$pull": {f"site_photos.{slot}": {"id": photo_id}},
                                                               "$set": {"site_photos_pending": pending_count(sp), "updated_at": _now()}})
        await create_audit_log(user["id"], user.get("name", ""), "delete", "site_photo", photo_id, details=f"project {project_id} · {SLOTS[slot]['label']}")
        return {"ok": True}

    @router.post("/projects/{project_id}/site-photos/sync")
    async def sync_now(project_id: str, request: Request):
        user = await get_current_user(request)
        await _project_for_photos(project_id, user)
        if not drive or not await drive.is_connected():
            raise HTTPException(status_code=409, detail="Google Drive is not connected. An admin can connect it in Settings.")
        return await drive.sync_project(project_id, force=True)

    return router
