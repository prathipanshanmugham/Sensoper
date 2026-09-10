"""Iter 52 — Internal Teams: named sub-teams (Alpha, Beta…) with rosters, multi-team project assignment
and per-team performance (projects handled / completed / on-time %, revenue)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel


class TeamCreate(BaseModel):
    name: str
    description: str = ""
    lead_user_id: Optional[str] = None
    member_user_ids: List[str] = []
    specialities: List[str] = []
    location_id: Optional[str] = None
    status: str = "active"          # active | inactive


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    lead_user_id: Optional[str] = None
    member_user_ids: Optional[List[str]] = None
    specialities: Optional[List[str]] = None
    location_id: Optional[str] = None
    status: Optional[str] = None


class ProjectTeams(BaseModel):
    team_ids: List[str]
    notes: str = ""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")


def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    d = {**d}
    d["id"] = str(d.pop("_id"))
    return d


def _project_revenue(p: Dict[str, Any]) -> float:
    try:
        return float(((p.get("cost_estimation") or {}).get("total_cost")) or 0)
    except (TypeError, ValueError):
        return 0.0


def compute_team_performance(projects: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Pure: projects → handled / completed / on-time % / revenue / avg days to complete."""
    handled = len(projects)
    completed = [p for p in projects if p.get("status") == "completed"]
    on_time = 0
    durations = []
    for p in completed:
        due = p.get("installation_date")
        done = p.get("completed_at") or p.get("updated_at")
        if due and done and str(done)[:10] <= str(due)[:10]:
            on_time += 1
        try:
            start = datetime.fromisoformat(str(p.get("created_at")).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(done).replace("Z", "+00:00"))
            durations.append(max((end - start).days, 0))
        except (TypeError, ValueError):
            pass
    active = sum(1 for p in projects if p.get("status") not in ("completed", "cancelled", "lost"))
    return {
        "projects_handled": handled,
        "projects_active": active,
        "projects_completed": len(completed),
        "completion_rate_pct": round(len(completed) / handled * 100, 1) if handled else 0,
        "on_time_pct": round(on_time / len(completed) * 100, 1) if completed else None,
        "avg_days_to_complete": round(sum(durations) / len(durations), 1) if durations else None,
        "revenue_handled": round(sum(_project_revenue(p) for p in projects), 2),
        "revenue_completed": round(sum(_project_revenue(p) for p in completed), 2),
    }


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    async def _users_by_id(ids: List[str]) -> Dict[str, Dict[str, Any]]:
        valid = [ObjectId(i) for i in ids if ObjectId.is_valid(i)]
        if not valid:
            return {}
        docs = await db.users.find({"_id": {"$in": valid}}, {"name": 1, "email": 1, "role": 1}).to_list(500)
        return {str(u["_id"]): {"id": str(u["_id"]), "name": u.get("name"), "email": u.get("email"), "role": u.get("role")} for u in docs}

    async def _team_out(t: Dict[str, Any], with_perf: bool = False) -> Dict[str, Any]:
        out = _clean(t)
        ids = list(out.get("member_user_ids") or [])
        if out.get("lead_user_id") and out["lead_user_id"] not in ids:
            ids.append(out["lead_user_id"])
        users = await _users_by_id(ids)
        out["members"] = [users[i] for i in out.get("member_user_ids") or [] if i in users]
        out["lead"] = users.get(out.get("lead_user_id") or "")
        out["member_count"] = len(out["members"])
        projects = await db.projects.find({"team_ids": out["id"]}, {"status": 1, "installation_date": 1, "completed_at": 1,
                                                                       "updated_at": 1, "created_at": 1, "cost_estimation.total_cost": 1}).to_list(5000)
        out["performance"] = compute_team_performance(projects)
        return out

    @router.get("/internal-teams")
    async def list_teams(request: Request, status: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {}
        if status and status != "all":
            q["status"] = status
        docs = await db.internal_teams.find(q).sort("name", 1).to_list(500)
        return [await _team_out(t) for t in docs]

    @router.post("/internal-teams")
    async def create_team(payload: TeamCreate, request: Request):
        user = await require_role("admin", "manager")(request)
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Team name is required")
        if await db.internal_teams.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}}):
            raise HTTPException(status_code=400, detail=f"A team named '{name}' already exists")
        if payload.status not in ("active", "inactive"):
            raise HTTPException(status_code=400, detail="status must be active or inactive")
        doc = {**payload.model_dump(), "name": name, "created_by": user["id"], "created_at": _now(), "updated_at": _now()}
        res = await db.internal_teams.insert_one(doc)
        doc["_id"] = res.inserted_id
        await create_audit_log(user["id"], user["name"], "team_created", "internal_team", str(res.inserted_id), new_data={"name": name})
        return await _team_out(doc)

    @router.get("/internal-teams/performance")
    async def teams_performance(request: Request):
        await require_role("admin", "manager")(request)
        docs = await db.internal_teams.find({}).sort("name", 1).to_list(500)
        rows = []
        for t in docs:
            out = await _team_out(t)
            rows.append({"id": out["id"], "name": out["name"], "status": out.get("status"), "member_count": out["member_count"],
                         "lead": (out.get("lead") or {}).get("name"), **out["performance"]})
        rows.sort(key=lambda r: (r["projects_completed"], r["revenue_completed"]), reverse=True)
        return {"rows": rows, "generated_at": _now()}

    @router.get("/internal-teams/{team_id}")
    async def get_team(team_id: str, request: Request):
        await get_current_user(request)
        t = await db.internal_teams.find_one({"_id": _oid(team_id)})
        if not t:
            raise HTTPException(status_code=404, detail="Team not found")
        out = await _team_out(t)
        projects = await db.projects.find({"team_ids": team_id}, {"reference_number": 1, "customer.name": 1, "status": 1,
                                                                    "installation_date": 1, "cost_estimation.total_cost": 1, "created_at": 1}).sort("created_at", -1).to_list(500)
        out["projects"] = [{"id": str(p["_id"]), "reference_number": p.get("reference_number"), "customer_name": (p.get("customer") or {}).get("name"),
                            "status": p.get("status"), "installation_date": p.get("installation_date"),
                            "total_cost": _project_revenue(p), "created_at": p.get("created_at")} for p in projects]
        return out

    @router.put("/internal-teams/{team_id}")
    async def update_team(team_id: str, payload: TeamUpdate, request: Request):
        user = await require_role("admin", "manager")(request)
        oid = _oid(team_id)
        existing = await db.internal_teams.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Team not found")
        changes = {k: v for k, v in payload.model_dump().items() if v is not None}
        if "name" in changes:
            changes["name"] = changes["name"].strip()
            if not changes["name"]:
                raise HTTPException(status_code=400, detail="Team name is required")
            dup = await db.internal_teams.find_one({"_id": {"$ne": oid}, "name": {"$regex": f"^{changes['name']}$", "$options": "i"}})
            if dup:
                raise HTTPException(status_code=400, detail=f"A team named '{changes['name']}' already exists")
        if "status" in changes and changes["status"] not in ("active", "inactive"):
            raise HTTPException(status_code=400, detail="status must be active or inactive")
        changes["updated_at"] = _now()
        await db.internal_teams.update_one({"_id": oid}, {"$set": changes})
        await create_audit_log(user["id"], user["name"], "team_updated", "internal_team", team_id, old_data=_clean(existing), new_data=changes)
        return await _team_out(await db.internal_teams.find_one({"_id": oid}))

    @router.delete("/internal-teams/{team_id}")
    async def delete_team(team_id: str, request: Request):
        user = await require_role("admin")(request)
        oid = _oid(team_id)
        existing = await db.internal_teams.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Team not found")
        live = await db.projects.count_documents({"team_ids": team_id, "status": {"$nin": ["completed", "cancelled", "lost"]}})
        if live:
            raise HTTPException(status_code=409, detail=f"Cannot delete: team is assigned to {live} open project(s) — reassign them first")
        await db.internal_teams.delete_one({"_id": oid})
        await db.projects.update_many({"team_ids": team_id}, {"$pull": {"team_ids": team_id}})
        await create_audit_log(user["id"], user["name"], "team_deleted", "internal_team", team_id, old_data=_clean(existing))
        return {"message": "Team deleted"}

    # ── Project ↔ teams (a project can be handled by several teams) ──
    @router.get("/projects/{project_id}/teams")
    async def get_project_teams(project_id: str, request: Request):
        await get_current_user(request)
        p = await db.projects.find_one({"_id": _oid(project_id)}, {"team_ids": 1, "team_notes": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        ids = [ObjectId(i) for i in (p.get("team_ids") or []) if ObjectId.is_valid(i)]
        teams = await db.internal_teams.find({"_id": {"$in": ids}}).to_list(100) if ids else []
        return {"team_ids": p.get("team_ids") or [], "notes": p.get("team_notes", ""),
                "teams": [{"id": str(t["_id"]), "name": t["name"], "status": t.get("status"), "lead_user_id": t.get("lead_user_id"),
                           "member_count": len(t.get("member_user_ids") or [])} for t in teams]}

    @router.put("/projects/{project_id}/teams")
    async def set_project_teams(project_id: str, payload: ProjectTeams, request: Request):
        user = await require_role("admin", "manager")(request)
        oid = _oid(project_id)
        p = await db.projects.find_one({"_id": oid}, {"team_ids": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        wanted = list(dict.fromkeys(payload.team_ids))
        valid = [ObjectId(i) for i in wanted if ObjectId.is_valid(i)]
        found = await db.internal_teams.find({"_id": {"$in": valid}}).to_list(100) if valid else []
        if len(found) != len(wanted):
            raise HTTPException(status_code=400, detail="One or more team ids are unknown")
        inactive = [t["name"] for t in found if t.get("status") == "inactive"]
        if inactive:
            raise HTTPException(status_code=400, detail=f"Inactive team(s) cannot take projects: {', '.join(inactive)}")
        await db.projects.update_one({"_id": oid}, {"$set": {"team_ids": wanted, "team_notes": payload.notes, "teams_updated_at": _now()}})
        await create_audit_log(user["id"], user["name"], "project_teams_set", "project", project_id,
                               old_data={"team_ids": p.get("team_ids") or []}, new_data={"team_ids": wanted})
        return await get_project_teams(project_id, request)

    return router
