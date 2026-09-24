"""Iter 53 — AMC pipeline & scheduling: customer AMC interest flag, visit scheduling with lead-time notifications
(in-app bell for the technician + customer outbox with one-tap WhatsApp/SMS text), and pincode/district travel batching."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

DEFAULT_LEAD_DAYS = [3, 1]


class InterestIn(BaseModel):
    interested: bool
    notes: str = ""


class ScheduleIn(BaseModel):
    scheduled_date: str                 # YYYY-MM-DD
    technician_id: Optional[str] = None
    technician_name: Optional[str] = None
    visit_type: str = "preventive"
    lead_days: Optional[List[int]] = None
    notes: str = ""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat()


def haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dphi, dl = math.radians(b_lat - a_lat), math.radians(b_lon - a_lon)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def build_notifications(contract: Dict[str, Any], visit: Dict[str, Any], lead_days: List[int], created_by: str) -> List[Dict[str, Any]]:
    """Pure: one technician (in-app) + one customer (outbox) notification per lead day, due at 08:00 UTC-agnostic on that date."""
    out: List[Dict[str, Any]] = []
    day = datetime.fromisoformat(visit["scheduled_date"]).replace(tzinfo=timezone.utc)
    cust_msg = (f"Dear {contract.get('customer_name', 'Customer')}, your solar AMC service visit ({contract.get('contract_number', '')}) is scheduled on "
                f"{day.strftime('%d %b %Y')}. Our technician {visit.get('technician_name') or 'team'} will visit your site. — Sensoper Controls & Renewables")
    phone = "".join(ch for ch in str(contract.get("contact") or "") if ch.isdigit())
    wa = f"https://wa.me/{'91' + phone if len(phone) == 10 else phone}?text={quote(cust_msg)}" if phone else None
    for d in sorted(set(lead_days), reverse=True):
        notify_at = _iso(day - timedelta(days=d))
        base = {"contract_id": str(contract["_id"]), "visit_id": visit["id"], "scheduled_date": visit["scheduled_date"], "lead_days": d,
                "notify_at": notify_at, "status": "pending", "created_at": _iso(_now()), "created_by": created_by}
        if visit.get("technician_id"):
            out.append({**base, "channel": "in_app", "audience": "technician", "user_id": visit["technician_id"],
                        "title": f"AMC visit in {d} day{'s' if d != 1 else ''}: {contract.get('customer_name')}",
                        "message": f"{contract.get('contract_number', '')} · {contract.get('site_address') or contract.get('district') or ''} · {visit['scheduled_date']}"})
        out.append({**base, "channel": "outbox", "audience": "customer", "customer_name": contract.get("customer_name"), "phone": phone or None,
                    "title": f"Remind {contract.get('customer_name')} — visit in {d} day{'s' if d != 1 else ''}", "message": cust_msg, "whatsapp_url": wa,
                    "sms_url": f"sms:{phone}?body={quote(cust_msg)}" if phone else None})
    return out


def cluster_visits(rows: List[Dict[str, Any]], hq: Optional[Dict[str, float]], km_cost: float, hop_km: float = 8.0) -> List[Dict[str, Any]]:
    """Pure: group due visits by district (pincode prefix fallback); compare separate round trips vs one batched trip."""
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        key = r.get("district") or (str(r.get("pincode") or "")[:3] + "xxx" if r.get("pincode") else "Unknown area")
        groups.setdefault(key, []).append(r)
    out = []
    for key, items in groups.items():
        dists = [i["distance_km"] for i in items if i.get("distance_km") is not None]
        separate = round(sum(2 * d * km_cost for d in dists), 2) if dists else None
        batched = round((2 * max(dists) + hop_km * (len(items) - 1)) * km_cost, 2) if dists else None
        revenue = round(sum(i.get("visit_revenue", 0) for i in items), 2)
        out.append({"cluster": key, "count": len(items), "contracts": items, "separate_trip_cost": separate, "batched_trip_cost": batched,
                    "saving": round(separate - batched, 2) if separate is not None else None, "visit_revenue": revenue,
                    "margin_separate": round(revenue - separate, 2) if separate is not None else None,
                    "margin_batched": round(revenue - batched, 2) if batched is not None else None,
                    "suggested_date": min(i["due_date"] for i in items),
                    "suggestion": (f"Visit these {len(items)} contracts in {key} on the same day" if len(items) > 1 else "Single visit — try to join a nearby cluster")})
    out.sort(key=lambda g: (-(g["saving"] or 0), -g["count"]))
    return out


def create_router(db, get_current_user, require_role, create_audit_log):
    router = APIRouter()

    # ── 1. AMC interest / opt-in on completed projects ──
    @router.put("/amc/interest/{project_id}")
    async def set_interest(project_id: str, body: InterestIn, request: Request):
        user = await get_current_user(request)
        p = await db.projects.find_one({"_id": ObjectId(project_id)}, {"status": 1, "customer": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        flag = {"interested": body.interested, "notes": body.notes, "set_by": user["name"], "set_at": _iso(_now())}
        await db.projects.update_one({"_id": ObjectId(project_id)}, {"$set": {"amc_interest": flag}})
        await create_audit_log(user["id"], user["name"], "amc_interest_set", "project", project_id, None, flag)
        return flag

    @router.get("/amc/follow-ups")
    async def follow_ups(request: Request):
        """Completed projects whose customer expressed AMC interest but have no active contract yet."""
        await get_current_user(request)
        covered = {c["project_id"] async for c in db.amc_contracts.find({"status": "active"}, {"project_id": 1})}
        rows = []
        async for p in db.projects.find({"status": "completed", "amc_interest.interested": True, "deleted_at": {"$exists": False}}).sort("completed_at", -1):
            pid = str(p["_id"])
            if pid in covered:
                continue
            rows.append({"project_id": pid, "reference_number": p.get("reference_number"), "customer_name": (p.get("customer") or {}).get("name"),
                         "phone": (p.get("customer") or {}).get("phone"), "district": (p.get("location") or {}).get("district"), "pincode": (p.get("location") or {}).get("pincode"),
                         "completed_at": p.get("completed_at"), "system_size_kw": ((p.get("custom_fields") or {}).get("proposed_solution") or {}).get("system_size_kw"),
                         "interest": p.get("amc_interest")})
        return {"rows": rows, "total": len(rows)}

    # ── 2. Scheduling with notifications ──
    @router.post("/amc/contracts/{contract_id}/schedule")
    async def schedule_with_notifications(contract_id: str, body: ScheduleIn, request: Request):
        user = await require_role("admin", "manager")(request)
        c = await db.amc_contracts.find_one({"_id": ObjectId(contract_id)})
        if not c or c.get("status") != "active":
            raise HTTPException(status_code=400, detail="Only active contracts can be scheduled")
        try:
            datetime.fromisoformat(body.scheduled_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="scheduled_date must be YYYY-MM-DD")
        lead = [int(x) for x in (body.lead_days or DEFAULT_LEAD_DAYS) if int(x) >= 0]
        now_iso = _iso(_now())
        visit = {"contract_id": contract_id, "visit_number": await db.amc_service_visits.count_documents({"contract_id": contract_id}) + 1,
                 "scheduled_date": body.scheduled_date, "actual_date": None, "visit_type": body.visit_type, "technician_id": body.technician_id,
                 "technician_name": body.technician_name, "notes": body.notes, "checklist": [], "status": "scheduled", "created_at": now_iso, "lead_days": lead}
        res = await db.amc_service_visits.insert_one(visit)
        visit["id"] = str(res.inserted_id)
        visit.pop("_id", None)
        notes = build_notifications(c, visit, lead, user["id"])
        if notes:
            await db.notifications.insert_many([dict(n) for n in notes])
        await db.amc_contracts.update_one({"_id": c["_id"]}, {"$push": {"service_schedule": {"visit_id": visit["id"], "date": body.scheduled_date, "technician_name": body.technician_name, "status": "scheduled"}},
                                                             "$set": {"next_visit_date": body.scheduled_date, "updated_at": now_iso}})
        await create_audit_log(user["id"], user["name"], "amc_visit_scheduled", "amc_contract", contract_id, None, {"date": body.scheduled_date, "technician": body.technician_name, "notifications": len(notes)})
        return {"visit": visit, "notifications_created": len(notes), "notifications": [{k: v for k, v in n.items() if k != "_id"} for n in notes]}

    @router.get("/amc/schedule")
    async def schedule_calendar(request: Request, start: Optional[str] = None, end: Optional[str] = None):
        await get_current_user(request)
        q: Dict[str, Any] = {"status": "scheduled"}
        if start or end:
            q["scheduled_date"] = {k: v for k, v in (("$gte", start), ("$lte", end)) if v}
        rows = []
        async for v in db.amc_service_visits.find(q).sort("scheduled_date", 1):
            c = await db.amc_contracts.find_one({"_id": ObjectId(v["contract_id"])}, {"customer_name": 1, "contract_number": 1, "district": 1, "site_address": 1}) if ObjectId.is_valid(v["contract_id"]) else None
            rows.append({"id": str(v["_id"]), "contract_id": v["contract_id"], "scheduled_date": v.get("scheduled_date"), "technician_name": v.get("technician_name"), "visit_type": v.get("visit_type"),
                         "customer_name": (c or {}).get("customer_name"), "contract_number": (c or {}).get("contract_number"), "district": (c or {}).get("district")})
        return rows

    @router.get("/notifications")
    async def my_notifications(request: Request, include_upcoming: bool = False):
        user = await get_current_user(request)
        q: Dict[str, Any] = {"channel": "in_app", "user_id": user["id"], "status": {"$nin": ["dismissed", "resolved"]}}
        if not include_upcoming:
            q["notify_at"] = {"$lte": _iso(_now())}
        rows = [{**{k: v for k, v in n.items() if k != "_id"}, "id": str(n["_id"])} async for n in db.notifications.find(q).sort("notify_at", -1).limit(100)]
        return {"rows": rows, "unread": sum(1 for r in rows if r["status"] == "pending")}

    @router.post("/notifications/{notif_id}/dismiss")
    async def dismiss(notif_id: str, request: Request):
        user = await get_current_user(request)
        r = await db.notifications.update_one({"_id": ObjectId(notif_id), "user_id": user["id"]}, {"$set": {"status": "dismissed", "dismissed_at": _iso(_now())}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"ok": True}

    @router.get("/amc/outbox")
    async def outbox(request: Request, all_pending: bool = False):
        """Customer reminders that are due — staff send them with the one-tap WhatsApp/SMS link and mark sent."""
        await require_role("admin", "manager", "staff")(request)
        q: Dict[str, Any] = {"channel": "outbox", "status": "pending"}
        if not all_pending:
            q["notify_at"] = {"$lte": _iso(_now())}
        rows = [{**{k: v for k, v in n.items() if k != "_id"}, "id": str(n["_id"])} async for n in db.notifications.find(q).sort("notify_at", 1).limit(200)]
        return {"rows": rows, "due": len(rows)}

    @router.post("/amc/outbox/{notif_id}/sent")
    async def mark_sent(notif_id: str, request: Request):
        user = await get_current_user(request)
        r = await db.notifications.update_one({"_id": ObjectId(notif_id), "channel": "outbox"}, {"$set": {"status": "sent", "sent_by": user["name"], "sent_at": _iso(_now())}})
        if not r.matched_count:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"ok": True}

    # ── 3. Pincode / district batching ──
    @router.get("/amc/batching")
    async def batching(request: Request, days: int = 30):
        await require_role("admin", "manager")(request)
        thresholds = await db.expansion_thresholds.find_one({"key": "defaults"}) or {}
        km_cost = float(thresholds.get("distance_per_km_cost", 50) or 50)
        cp = await db.company_profile.find_one({}) or {}
        hq_pin = await db.pincodes.find_one({"pincode": str(cp.get("pincode") or "")}) if cp.get("pincode") else None
        hq = {"lat": hq_pin["latitude"], "lon": hq_pin["longitude"]} if hq_pin and hq_pin.get("latitude") else None
        horizon = (_now() + timedelta(days=days)).date().isoformat()
        rows: List[Dict[str, Any]] = []
        async for c in db.amc_contracts.find({"status": "active"}):
            cid = str(c["_id"])
            sched = await db.amc_service_visits.find_one({"contract_id": cid, "status": "scheduled"}, sort=[("scheduled_date", 1)])
            due = sched["scheduled_date"] if sched else c.get("next_visit_date")
            if not due:
                # fall back: evenly spaced visits from the start date
                per_year = int(c.get("visits_per_year") or 2)
                done = int(c.get("visits_completed") or 0)
                start = datetime.fromisoformat(c.get("start_date")) if c.get("start_date") else _now()
                due = (start + timedelta(days=int(365 / max(per_year, 1)) * (done + 1))).date().isoformat()
            if due > horizon:
                continue
            proj = await db.projects.find_one({"_id": ObjectId(c["project_id"])}, {"location.pincode": 1}) if ObjectId.is_valid(str(c.get("project_id") or "")) else None
            pincode = c.get("pincode") or ((proj or {}).get("location") or {}).get("pincode")
            pin = await db.pincodes.find_one({"pincode": str(pincode)}) if pincode else None
            dist = round(haversine_km(hq["lat"], hq["lon"], pin["latitude"], pin["longitude"]), 1) if (hq and pin and pin.get("latitude")) else None
            rows.append({"contract_id": cid, "contract_number": c.get("contract_number"), "customer_name": c.get("customer_name"), "district": c.get("district") or (pin or {}).get("district"),
                         "pincode": pincode, "due_date": due, "already_scheduled": bool(sched), "technician_name": (sched or {}).get("technician_name"),
                         "distance_km": dist, "visit_revenue": round(float(c.get("annual_value") or 0) / max(int(c.get("visits_per_year") or 2), 1), 2)})
        clusters = cluster_visits(rows, hq, km_cost)
        return {"horizon_days": days, "km_cost": km_cost, "hq_pincode": cp.get("pincode"), "hq_geocoded": hq is not None, "due_visits": len(rows), "clusters": clusters,
                "total_saving": round(sum(g["saving"] or 0 for g in clusters), 2)}

    return router
