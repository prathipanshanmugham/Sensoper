"""Location-wise organisation structure (Oct 2026) — admins only.

    GET /api/org-structure → every location with its managers, staff and internal teams, plus the
    leadership row (admins) and people not assigned to any location. Each person carries today's
    attendance state and their open project count, so the chart doubles as a live roll-call.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Request

IST = timezone(timedelta(hours=5, minutes=30))
ROLE_ORDER = {"admin": 0, "manager": 1, "staff": 2}
OPEN_STATUSES = ["draft", "submitted", "approved"]


def create_router(db, require_role):
    router = APIRouter()

    @router.get("/org-structure")
    async def org_structure(request: Request):
        await require_role("admin")(request)
        today = datetime.now(timezone.utc).astimezone(IST).date().isoformat()
        locations = [{**{k: v for k, v in d.items() if k != "_id"}, "id": str(d["_id"])}
                     async for d in db.locations.find({"active": {"$ne": False}}).sort("name", 1)]
        attendance = {r["user_id"]: ("checked_out" if r.get("check_out") else "checked_in")
                      async for r in db.attendance.find({"date": today}, {"user_id": 1, "check_out": 1})}
        open_projects: Dict[str, int] = {}
        async for p in db.projects.find({"deleted_at": {"$exists": False}, "status": {"$in": OPEN_STATUSES}}, {"created_by": 1}):
            open_projects[p.get("created_by")] = open_projects.get(p.get("created_by"), 0) + 1

        people: List[Dict[str, Any]] = []
        async for u in db.users.find({}, {"password_hash": 0, "totp_secret": 0, "totp_secret_enc": 0}):
            if u.get("disabled") or u.get("is_active") is False:
                continue
            uid = str(u["_id"])
            people.append({
                "id": uid, "name": u.get("name", ""), "email": u.get("email", ""), "phone": u.get("phone"),
                "role": u.get("role", "staff"), "location_ids": u.get("location_ids") or [],
                "default_location_id": u.get("default_location_id"),
                "today": attendance.get(uid, "absent"), "open_projects": open_projects.get(uid, 0),
            })
        people.sort(key=lambda x: (ROLE_ORDER.get(x["role"], 9), x["name"].lower()))

        teams: List[Dict[str, Any]] = []
        names = {p["id"]: p["name"] for p in people}
        async for t in db.internal_teams.find({"status": {"$ne": "inactive"}}):
            teams.append({"id": str(t["_id"]), "name": t.get("name", ""), "location_id": t.get("location_id"),
                          "lead": names.get(t.get("lead_user_id") or "", ""), "member_count": len(t.get("member_user_ids") or []),
                          "specialities": t.get("specialities") or []})

        loc_ids = {l["id"] for l in locations}
        out_locations = []
        for loc in locations:
            members = [p for p in people if loc["id"] in p["location_ids"] and p["role"] != "admin"]
            out_locations.append({
                "location": loc,
                "managers": [p for p in members if p["role"] == "manager"],
                "staff": [p for p in members if p["role"] == "staff"],
                "teams": [t for t in teams if t.get("location_id") == loc["id"]],
                "counts": {"people": len(members), "present_today": sum(1 for p in members if p["today"] != "absent")},
            })
        leadership = [p for p in people if p["role"] == "admin"]
        unassigned = [p for p in people if p["role"] != "admin" and not (set(p["location_ids"]) & loc_ids)]
        return {
            "date": today,
            "leadership": leadership,
            "locations": out_locations,
            "unassigned": unassigned,
            "unassigned_teams": [t for t in teams if t.get("location_id") not in loc_ids],
            "totals": {"people": len(people), "locations": len(locations), "managers": sum(1 for p in people if p["role"] == "manager"),
                       "staff": sum(1 for p in people if p["role"] == "staff"), "present_today": sum(1 for p in people if p["today"] != "absent")},
        }

    return router
