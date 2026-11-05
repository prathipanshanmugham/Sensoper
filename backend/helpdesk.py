"""Help desk (Nov 2026): staff raise a request or a problem — laptop or phone, HR and salary, tools and vehicles,
office or site, the Sensoper app — and it goes to the people who handle that kind of request.

Each request has a priority with a due time, a conversation (with internal notes only handlers see), a status
(open → being worked on → waiting for you → solved → closed) and a rating from the person who raised it. Everyone
sees their own requests. Handlers see their categories' requests and the ones assigned to them. Admins, and roles
given "Handle every request", see them all. Categories and handlers are set by an admin.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

import notify

PRIORITIES = ("urgent", "high", "normal", "low")
STATUSES = ("open", "in_progress", "waiting", "resolved", "closed")
OPEN_STATES = ("open", "in_progress", "waiting")
DEFAULT_CATEGORIES = [
    {"key": "it", "label": "Laptop, phone & internet", "handler_ids": []},
    {"key": "hr", "label": "HR, leave & salary", "handler_ids": []},
    {"key": "tools", "label": "Tools, vehicle & safety gear", "handler_ids": []},
    {"key": "office", "label": "Office & site facilities", "handler_ids": []},
    {"key": "app", "label": "Sensoper app", "handler_ids": []},
    {"key": "stock", "label": "Stock & purchase", "handler_ids": []},
    {"key": "other", "label": "Something else", "handler_ids": []},
]
DEFAULT_DUE_HOURS = {"urgent": 4, "high": 8, "normal": 24, "low": 72}
# who may move a request to which status (handlers / the person who raised it)
HANDLER_MOVES = {"open": {"in_progress", "waiting", "resolved", "closed"}, "in_progress": {"waiting", "resolved", "closed"},
                 "waiting": {"in_progress", "resolved", "closed"}, "resolved": {"in_progress", "closed"}, "closed": {"in_progress"}}
REQUESTER_MOVES = {"open": {"closed"}, "in_progress": {"closed"}, "waiting": {"closed"}, "resolved": {"open", "closed"}, "closed": {"open"}}
STATUS_LABEL = {"open": "Open", "in_progress": "Being worked on", "waiting": "Waiting for you", "resolved": "Solved", "closed": "Closed"}
SLUG_RX = re.compile(r"[^a-z0-9]+")


def due_at(created: datetime, priority: str, hours: Dict[str, int]) -> str:
    return (created + timedelta(hours=int(hours.get(priority) or DEFAULT_DUE_HOURS["normal"]))).isoformat()


def is_overdue(t: Dict[str, Any], now_iso: str) -> bool:
    return t.get("status") in ("open", "in_progress") and bool(t.get("due_at")) and str(t["due_at"]) < now_iso


def move_ok(status: str, to: str, handler: bool, requester: bool) -> bool:
    return (handler and to in HANDLER_MOVES.get(status, set())) or (requester and to in REQUESTER_MOVES.get(status, set()))


class TicketIn(BaseModel):
    category: str
    title: str = Field(min_length=3, max_length=120)
    details: str = Field(default="", max_length=4000)
    priority: str = "normal"
    attachment: Optional[str] = None
    on_behalf_of: Optional[str] = None          # handlers can log a request for someone who phoned it in


class ReplyIn(BaseModel):
    text: str = Field(default="", max_length=4000)
    attachment: Optional[str] = None
    internal: bool = False


class StatusIn(BaseModel):
    status: str
    note: Optional[str] = Field(default=None, max_length=1000)


class AssignIn(BaseModel):
    user_id: Optional[str] = None


class TicketEditIn(BaseModel):
    category: Optional[str] = None
    priority: Optional[str] = None
    title: Optional[str] = Field(default=None, min_length=3, max_length=120)


class RateIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    note: Optional[str] = Field(default=None, max_length=500)


def create_router(db, get_current_user, create_audit_log, check_module_permission: Callable[[Dict[str, Any], str, str], Awaitable[bool]]):
    router = APIRouter()

    async def settings() -> Dict[str, Any]:
        s = await db.helpdesk_settings.find_one({"key": "defaults"}) or {}
        cats = s.get("categories") or DEFAULT_CATEGORIES
        return {"categories": [{"key": c["key"], "label": c["label"], "handler_ids": list(c.get("handler_ids") or [])} for c in cats],
                "due_hours": {**DEFAULT_DUE_HOURS, **(s.get("due_hours") or {})}}

    async def _admins() -> List[str]:
        return [str(u["_id"]) async for u in db.users.find({"role": "admin", "active": {"$ne": False}}, {"_id": 1})]

    async def ctx(user: Dict[str, Any]) -> Dict[str, Any]:
        s = await settings()
        desk = user["role"] == "admin" or await check_module_permission(user, "module_helpdesk", "edit")
        handles = {c["key"] for c in s["categories"] if user["id"] in c["handler_ids"]}
        if user["role"] == "admin":   # admins pick up categories nobody else handles
            handles |= {c["key"] for c in s["categories"] if not c["handler_ids"]}
        return {"s": s, "desk": desk, "handles": handles, "user": user}

    def sees(t: Dict[str, Any], c: Dict[str, Any]) -> bool:
        uid = c["user"]["id"]
        return c["desk"] or t.get("requester_id") == uid or t.get("assignee_id") == uid or t.get("category") in c["handles"]

    def handles(t: Dict[str, Any], c: Dict[str, Any]) -> bool:
        return c["desk"] or t.get("assignee_id") == c["user"]["id"] or t.get("category") in c["handles"]

    async def handlers_of(category: str, s: Dict[str, Any]) -> List[str]:
        cat = next((x for x in s["categories"] if x["key"] == category), None)
        return list((cat or {}).get("handler_ids") or []) or await _admins()

    def out(t: Dict[str, Any], c: Dict[str, Any], full: bool = False) -> Dict[str, Any]:
        is_handler = handles(t, c)
        o = {k: t.get(k) for k in ("number", "title", "category", "category_label", "priority", "status", "requester_id", "requester_name", "assignee_id",
                                   "assignee_name", "due_at", "created_at", "updated_at", "resolved_at", "closed_at", "first_response_at", "rating", "rating_note",
                                   "attachment", "last_reply_at", "last_reply_by")}
        o["id"] = str(t["_id"])
        o["status_label"] = STATUS_LABEL.get(t.get("status"), t.get("status"))
        o["overdue"] = is_overdue(t, notify.now_utc().isoformat())
        o["can_handle"] = is_handler
        o["mine"] = t.get("requester_id") == c["user"]["id"]
        o["replies_count"] = sum(1 for r in t.get("replies") or [] if is_handler or not r.get("internal"))
        if full:
            o["details"] = t.get("details")
            o["replies"] = [r for r in t.get("replies") or [] if is_handler or not r.get("internal")]
            o["moves"] = sorted({*(HANDLER_MOVES.get(t["status"], set()) if is_handler else set()),
                                 *(REQUESTER_MOVES.get(t["status"], set()) if o["mine"] else set())})
            o["history"] = t.get("history") or []
        return o

    async def _ticket(tid: str) -> Dict[str, Any]:
        t = await db.helpdesk_tickets.find_one({"_id": ObjectId(tid)}) if tid and ObjectId.is_valid(tid) else None
        if not t:
            raise HTTPException(status_code=404, detail="Request not found")
        return t

    async def tell(t: Dict[str, Any], user_ids: List[str], title: str, message: str, tag: str) -> None:
        await notify.plan(db, kind="helpdesk", source_type="helpdesk_ticket", source_id=str(t["_id"]), user_ids=[u for u in user_ids if u],
                          tag=tag, title=title, message=message, link=f"/dashboard/help-desk?ticket={t['_id']}")

    # ═══════════════ settings ═══════════════
    @router.get("/helpdesk/settings")
    async def get_settings(request: Request):
        user = await get_current_user(request)
        c = await ctx(user)
        s = c["s"]
        names = {str(u["_id"]): u.get("name") async for u in db.users.find({"_id": {"$in": [ObjectId(i) for c_ in s["categories"] for i in c_["handler_ids"] if ObjectId.is_valid(i)]}}, {"name": 1})}
        return {"categories": [{**cat, "handlers": [names.get(i) for i in cat["handler_ids"] if names.get(i)]} for cat in s["categories"]],
                "due_hours": s["due_hours"], "priorities": list(PRIORITIES), "desk": c["desk"], "handles": sorted(c["handles"]),
                "is_handler": bool(c["handles"]) or c["desk"]}

    @router.put("/helpdesk/settings")
    async def put_settings(request: Request):
        user = await get_current_user(request)
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can change help desk settings")
        body = await request.json()
        cats, seen = [], set()
        for c in body.get("categories") or []:
            label = " ".join(str(c.get("label") or "").split())[:50]
            if len(label) < 2:
                continue
            key = (str(c.get("key") or "") or SLUG_RX.sub("_", label.lower()).strip("_"))[:30] or uuid.uuid4().hex[:6]
            if key in seen:
                key = f"{key}_{uuid.uuid4().hex[:4]}"
            seen.add(key)
            cats.append({"key": key, "label": label, "handler_ids": [str(i) for i in (c.get("handler_ids") or []) if ObjectId.is_valid(str(i))][:20]})
        if not cats:
            raise HTTPException(status_code=400, detail="Keep at least one category")
        hours = {p: max(1, min(int((body.get("due_hours") or {}).get(p) or DEFAULT_DUE_HOURS[p]), 24 * 30)) for p in PRIORITIES}
        await db.helpdesk_settings.update_one({"key": "defaults"}, {"$set": {"key": "defaults", "categories": cats[:20], "due_hours": hours}}, upsert=True)
        await create_audit_log(user["id"], user["name"], "helpdesk_settings_updated", "helpdesk_settings", "defaults", None, {"categories": [c["label"] for c in cats]})
        return await get_settings(request)

    # ═══════════════ requests ═══════════════
    @router.get("/helpdesk/summary")
    async def summary(request: Request):
        user = await get_current_user(request)
        c = await ctx(user)
        now = notify.now_utc().isoformat()
        mine_waiting = await db.helpdesk_tickets.count_documents({"requester_id": user["id"], "status": {"$in": ["waiting", "resolved"]}})
        q: Dict[str, Any] = {"status": {"$in": ["open", "in_progress"]}}
        if not c["desk"]:
            q["$or"] = [{"assignee_id": user["id"]}, {"category": {"$in": list(c["handles"])}}]
        queue = [t async for t in db.helpdesk_tickets.find(q, {"due_at": 1, "status": 1, "assignee_id": 1})]
        return {"mine_needs_you": mine_waiting, "queue": len(queue), "unassigned": sum(1 for t in queue if not t.get("assignee_id")),
                "overdue": sum(1 for t in queue if is_overdue(t, now)), "is_handler": bool(c["handles"]) or c["desk"]}

    @router.get("/helpdesk/tickets")
    async def list_tickets(request: Request, scope: str = "mine", status: Optional[str] = None, category: Optional[str] = None, q: Optional[str] = None):
        user = await get_current_user(request)
        c = await ctx(user)
        query: Dict[str, Any] = {}
        if scope == "mine":
            query["requester_id"] = user["id"]
        elif scope == "queue":
            if not c["desk"]:
                query["$or"] = [{"assignee_id": user["id"]}, {"category": {"$in": list(c["handles"])}}]
        elif scope == "assigned":
            query["assignee_id"] = user["id"]
        elif scope == "all":
            if not c["desk"]:
                raise HTTPException(status_code=403, detail="Only admins (or roles given “Handle every request”) see every request")
        else:
            raise HTTPException(status_code=400, detail="Unknown list")
        if status == "open":
            query["status"] = {"$in": list(OPEN_STATES)}
        elif status == "done":
            query["status"] = {"$in": ["resolved", "closed"]}
        elif status in STATUSES:
            query["status"] = status
        if category:
            query["category"] = category
        if q and q.strip():
            rx = {"$regex": re.escape(q.strip()[:60]), "$options": "i"}
            query["$and"] = [{"$or": [{"title": rx}, {"number": rx}, {"requester_name": rx}, {"details": rx}]}]
        rows = [t async for t in db.helpdesk_tickets.find(query).sort("created_at", -1).limit(300)]
        rank = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
        rows.sort(key=lambda t: (t["status"] not in OPEN_STATES, not is_overdue(t, notify.now_utc().isoformat()), rank.get(t.get("priority"), 2), str(t.get("due_at") or "")))
        return [out(t, c) for t in rows if sees(t, c)]

    @router.post("/helpdesk/tickets")
    async def create_ticket(body: TicketIn, request: Request):
        user = await get_current_user(request)
        c = await ctx(user)
        s = c["s"]
        cat = next((x for x in s["categories"] if x["key"] == body.category), None)
        if not cat:
            raise HTTPException(status_code=400, detail="Choose what it is about")
        if body.priority not in PRIORITIES:
            raise HTTPException(status_code=400, detail="Unknown priority")
        requester = user
        if body.on_behalf_of and body.on_behalf_of != user["id"]:
            if not (c["desk"] or cat["key"] in c["handles"]):
                raise HTTPException(status_code=403, detail="Only handlers can raise a request for someone else")
            u = await db.users.find_one({"_id": ObjectId(body.on_behalf_of)}) if ObjectId.is_valid(body.on_behalf_of) else None
            if not u:
                raise HTTPException(status_code=400, detail="Person not found")
            requester = {"id": str(u["_id"]), "name": u.get("name")}
        seq = await db.counters.find_one_and_update({"_id": "helpdesk"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
        now = notify.now_utc()
        doc = {"number": f"HD-{int(seq['seq']):04d}", "title": " ".join(body.title.split()), "details": body.details.strip(), "category": cat["key"],
               "category_label": cat["label"], "priority": body.priority, "status": "open", "requester_id": requester["id"], "requester_name": requester["name"],
               "assignee_id": None, "assignee_name": None, "attachment": body.attachment or None, "due_at": due_at(now, body.priority, s["due_hours"]),
               "created_at": now.isoformat(), "updated_at": now.isoformat(), "created_by": user["name"], "replies": [],
               "history": [{"at": now.isoformat(), "by": user["name"], "what": "Raised" + (f" for {requester['name']}" if requester is not user else "")}]}
        if len(cat["handler_ids"]) == 1:     # one handler for the category: it's theirs straight away
            h = await db.users.find_one({"_id": ObjectId(cat["handler_ids"][0])}, {"name": 1}) if ObjectId.is_valid(cat["handler_ids"][0]) else None
            if h:
                doc.update(assignee_id=str(h["_id"]), assignee_name=h.get("name"))
        res = await db.helpdesk_tickets.insert_one(doc)
        doc["_id"] = res.inserted_id
        to = [doc["assignee_id"]] if doc["assignee_id"] else await handlers_of(cat["key"], s)
        await tell(doc, [u for u in to if u != user["id"]], f"{'⚡ ' if body.priority == 'urgent' else ''}{doc['number']}: {doc['title']}",
                   f"{requester['name']} · {cat['label']} · {body.priority}", "new")
        await create_audit_log(user["id"], user["name"], "helpdesk_ticket_raised", "helpdesk_ticket", str(res.inserted_id), None,
                               {"number": doc["number"], "category": cat["key"], "priority": body.priority})
        return out(doc, await ctx(user), True)

    @router.get("/helpdesk/tickets/{ticket_id}")
    async def get_ticket(ticket_id: str, request: Request):
        user = await get_current_user(request)
        c = await ctx(user)
        t = await _ticket(ticket_id)
        if not sees(t, c):
            raise HTTPException(status_code=404, detail="Request not found")
        return out(t, c, True)

    @router.post("/helpdesk/tickets/{ticket_id}/reply")
    async def reply(ticket_id: str, body: ReplyIn, request: Request):
        user = await get_current_user(request)
        c = await ctx(user)
        t = await _ticket(ticket_id)
        if not sees(t, c):
            raise HTTPException(status_code=404, detail="Request not found")
        if not body.text.strip() and not body.attachment:
            raise HTTPException(status_code=400, detail="Write a reply or attach a file")
        is_handler = handles(t, c)
        if body.internal and not is_handler:
            raise HTTPException(status_code=403, detail="Only handlers can add internal notes")
        now = notify.now_utc().isoformat()
        r = {"id": uuid.uuid4().hex[:10], "by_id": user["id"], "by_name": user["name"], "text": body.text.strip(), "attachment": body.attachment or None,
             "internal": bool(body.internal), "at": now, "by_handler": is_handler and t.get("requester_id") != user["id"]}
        upd: Dict[str, Any] = {"updated_at": now}
        if not body.internal:
            upd.update(last_reply_at=now, last_reply_by=user["name"])
        if r["by_handler"] and not body.internal and not t.get("first_response_at"):
            upd["first_response_at"] = now
        if r["by_handler"] and not body.internal and t["status"] == "open":
            upd["status"] = "in_progress"
        if t.get("requester_id") == user["id"] and t["status"] in ("waiting", "resolved"):
            upd["status"] = "in_progress" if t["status"] == "waiting" else "open"      # they answered, or it isn't solved after all
        if is_handler and not t.get("assignee_id") and r["by_handler"]:
            upd.update(assignee_id=user["id"], assignee_name=user["name"])
        await db.helpdesk_tickets.update_one({"_id": t["_id"]}, {"$push": {"replies": r}, "$set": upd})
        t.update(upd)
        if not body.internal:
            if t.get("requester_id") == user["id"]:
                to = [t["assignee_id"]] if t.get("assignee_id") else await handlers_of(t["category"], c["s"])
            else:
                to = [t["requester_id"]]
            await tell(t, [u for u in to if u != user["id"]], f"Reply on {t['number']}: {t['title']}", f"{user['name']}: {r['text'][:160]}", f"reply-{r['id']}")
        return out(await _ticket(ticket_id), c, True)

    @router.post("/helpdesk/tickets/{ticket_id}/status")
    async def set_status(ticket_id: str, body: StatusIn, request: Request):
        user = await get_current_user(request)
        c = await ctx(user)
        t = await _ticket(ticket_id)
        if not sees(t, c):
            raise HTTPException(status_code=404, detail="Request not found")
        if body.status not in STATUSES or body.status == t["status"]:
            raise HTTPException(status_code=400, detail="Choose a new status")
        is_handler, is_req = handles(t, c), t.get("requester_id") == user["id"]
        if not move_ok(t["status"], body.status, is_handler, is_req):
            raise HTTPException(status_code=400, detail=f"Can't go from “{STATUS_LABEL[t['status']]}” to “{STATUS_LABEL[body.status]}”")
        now = notify.now_utc().isoformat()
        upd: Dict[str, Any] = {"status": body.status, "updated_at": now}
        if body.status == "resolved":
            upd["resolved_at"] = now
        if body.status == "closed":
            upd["closed_at"] = now
        if body.status in ("open", "in_progress") and t["status"] in ("resolved", "closed"):
            upd.update(resolved_at=None, closed_at=None, rating=None, rating_note=None,
                       due_at=due_at(notify.now_utc(), t.get("priority") or "normal", c["s"]["due_hours"]))
        if is_handler and not is_req and not t.get("first_response_at"):
            upd["first_response_at"] = now
        hist = {"at": now, "by": user["name"], "what": f"{STATUS_LABEL[t['status']]} → {STATUS_LABEL[body.status]}" + (f": {body.note.strip()[:200]}" if body.note and body.note.strip() else "")}
        push: Dict[str, Any] = {"history": hist}
        if body.note and body.note.strip():
            push["replies"] = {"id": uuid.uuid4().hex[:10], "by_id": user["id"], "by_name": user["name"], "text": body.note.strip(), "attachment": None,
                               "internal": False, "at": now, "by_handler": is_handler and not is_req, "status_change": body.status}
        await db.helpdesk_tickets.update_one({"_id": t["_id"]}, {"$set": upd, "$push": push})
        t.update(upd)
        if is_req and not is_handler:
            to = [t.get("assignee_id")] if t.get("assignee_id") else await handlers_of(t["category"], c["s"])
        else:
            to = [t["requester_id"]]
        msg = {"waiting": "They need something from you — open it to reply.", "resolved": "Marked solved. Rate it, or reopen it if it isn't.",
               "closed": "Closed.", "in_progress": "Being worked on.", "open": "Reopened."}[body.status]
        await tell(t, [u for u in to if u and u != user["id"]], f"{t['number']} is {STATUS_LABEL[body.status].lower()}", msg, f"status-{now}")
        await create_audit_log(user["id"], user["name"], "helpdesk_status", "helpdesk_ticket", ticket_id, None, {"status": body.status})
        return out(await _ticket(ticket_id), c, True)

    @router.post("/helpdesk/tickets/{ticket_id}/assign")
    async def assign(ticket_id: str, body: AssignIn, request: Request):
        user = await get_current_user(request)
        c = await ctx(user)
        t = await _ticket(ticket_id)
        if not handles(t, c):
            raise HTTPException(status_code=403, detail="Only handlers can assign requests")
        name = None
        if body.user_id:
            u = await db.users.find_one({"_id": ObjectId(body.user_id), "active": {"$ne": False}}, {"name": 1}) if ObjectId.is_valid(body.user_id) else None
            if not u:
                raise HTTPException(status_code=400, detail="Person not found")
            name = u.get("name")
        now = notify.now_utc().isoformat()
        await db.helpdesk_tickets.update_one({"_id": t["_id"]}, {"$set": {"assignee_id": body.user_id or None, "assignee_name": name, "updated_at": now},
                                                                "$push": {"history": {"at": now, "by": user["name"], "what": f"Assigned to {name}" if name else "Unassigned"}}})
        if body.user_id and body.user_id != user["id"]:
            await tell(t, [body.user_id], f"{t['number']} is now yours: {t['title']}", f"{t['requester_name']} · {t.get('category_label')} · {t.get('priority')}", f"assign-{now}")
        return out(await _ticket(ticket_id), c, True)

    @router.put("/helpdesk/tickets/{ticket_id}")
    async def edit_ticket(ticket_id: str, body: TicketEditIn, request: Request):
        user = await get_current_user(request)
        c = await ctx(user)
        t = await _ticket(ticket_id)
        if not handles(t, c):
            raise HTTPException(status_code=403, detail="Only handlers can change this")
        upd: Dict[str, Any] = {}
        notes = []
        if body.category and body.category != t["category"]:
            cat = next((x for x in c["s"]["categories"] if x["key"] == body.category), None)
            if not cat:
                raise HTTPException(status_code=400, detail="Unknown category")
            upd.update(category=cat["key"], category_label=cat["label"])
            notes.append(f"Moved to {cat['label']}")
        if body.priority and body.priority != t.get("priority"):
            if body.priority not in PRIORITIES:
                raise HTTPException(status_code=400, detail="Unknown priority")
            created = datetime.fromisoformat(str(t["created_at"]).replace("Z", "+00:00"))
            upd.update(priority=body.priority, due_at=due_at(created, body.priority, c["s"]["due_hours"]))
            notes.append(f"Priority {body.priority}")
        if body.title and body.title.strip() != t["title"]:
            upd["title"] = " ".join(body.title.split())
        if not upd:
            return out(t, c, True)
        now = notify.now_utc().isoformat()
        upd["updated_at"] = now
        await db.helpdesk_tickets.update_one({"_id": t["_id"]}, {"$set": upd, "$push": {"history": {"at": now, "by": user["name"], "what": "; ".join(notes) or "Edited"}}})
        if "category" in upd:
            await tell({**t, **upd}, [u for u in await handlers_of(upd["category"], c["s"]) if u != user["id"]], f"{t['number']} moved to {upd['category_label']}",
                       t["title"], f"move-{now}")
        return out(await _ticket(ticket_id), c, True)

    @router.post("/helpdesk/tickets/{ticket_id}/rate")
    async def rate(ticket_id: str, body: RateIn, request: Request):
        user = await get_current_user(request)
        c = await ctx(user)
        t = await _ticket(ticket_id)
        if t.get("requester_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Only the person who raised it can rate it")
        if t["status"] not in ("resolved", "closed"):
            raise HTTPException(status_code=400, detail="Rate it once it's solved")
        now = notify.now_utc().isoformat()
        upd = {"rating": body.rating, "rating_note": (body.note or "").strip()[:500] or None, "updated_at": now}
        if t["status"] == "resolved":
            upd.update(status="closed", closed_at=now)
        await db.helpdesk_tickets.update_one({"_id": t["_id"]}, {"$set": upd, "$push": {"history": {"at": now, "by": user["name"], "what": f"Rated {body.rating}/5"}}})
        if t.get("assignee_id"):
            await tell(t, [t["assignee_id"]], f"{t['number']} rated {body.rating}/5", (body.note or "")[:160] or t["title"], f"rate-{now}")
        return out(await _ticket(ticket_id), c, True)

    @router.get("/helpdesk/report")
    async def report(request: Request, days: int = 90):
        user = await get_current_user(request)
        c = await ctx(user)
        if not (c["desk"] or c["handles"]):
            raise HTTPException(status_code=403, detail="For handlers")
        since = (notify.now_utc() - timedelta(days=max(7, min(days, 365)))).isoformat()
        q: Dict[str, Any] = {"created_at": {"$gte": since}}
        if not c["desk"]:
            q["category"] = {"$in": list(c["handles"])}
        rows = [t async for t in db.helpdesk_tickets.find(q, {"replies": 0, "history": 0})]
        now = notify.now_utc().isoformat()
        by_cat: Dict[str, Dict[str, Any]] = {}
        for t in rows:
            b = by_cat.setdefault(t.get("category_label") or t.get("category"), {"raised": 0, "open": 0, "overdue": 0, "solved": 0, "hours": [], "ratings": []})
            b["raised"] += 1
            if t["status"] in OPEN_STATES:
                b["open"] += 1
            if is_overdue(t, now):
                b["overdue"] += 1
            if t.get("resolved_at"):
                b["solved"] += 1
                try:
                    b["hours"].append((datetime.fromisoformat(str(t["resolved_at"]).replace("Z", "+00:00")) - datetime.fromisoformat(str(t["created_at"]).replace("Z", "+00:00"))).total_seconds() / 3600)
                except ValueError:
                    pass
            if t.get("rating"):
                b["ratings"].append(t["rating"])
        out_rows = [{"category": k, "raised": v["raised"], "open": v["open"], "overdue": v["overdue"], "solved": v["solved"],
                     "avg_hours": round(sum(v["hours"]) / len(v["hours"]), 1) if v["hours"] else None,
                     "rating": round(sum(v["ratings"]) / len(v["ratings"]), 1) if v["ratings"] else None} for k, v in by_cat.items()]
        out_rows.sort(key=lambda r: -r["raised"])
        return {"days": days, "rows": out_rows, "total": len(rows)}

    async def ensure_indexes() -> None:
        await db.helpdesk_tickets.create_index([("requester_id", 1), ("created_at", -1)])
        await db.helpdesk_tickets.create_index([("category", 1), ("status", 1)])
        await db.helpdesk_tickets.create_index("assignee_id")
        await db.helpdesk_tickets.create_index("number", unique=True)

    router.ensure_indexes = ensure_indexes
    return router
