"""Bell notifications planned ahead (Oct 2026).

A record that has a date coming up (an EMI, a trademark renewal, a last working day, a cover shift, a calendar
event) plans its own in-app notes with `notify_at` in the future; the bell only shows notes whose time has come.
When the record changes, its old pending notes are cleared and planned again, so nothing goes stale.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional

IST = timezone(timedelta(hours=5, minutes=30))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_ist() -> date:
    return now_utc().astimezone(IST).date()


def morning_of(d: date, hour: int = 9) -> str:
    """09:00 IST on that day, as a UTC ISO string (what notify_at compares against)."""
    return datetime.combine(d, time(hour, 0), tzinfo=IST).astimezone(timezone.utc).isoformat()


def to_date(v: Any) -> Optional[date]:
    if not v:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except ValueError:
        return None


async def users_who_can(db, get_permissions: Callable[[str], Awaitable[Dict[str, Any]]], module: str, action: str = "view") -> List[str]:
    """Active admins, plus everyone whose role has `module.action` switched on."""
    roles = {"admin"}
    for role in ("manager", "staff"):
        perms = await get_permissions(role)
        if bool((perms.get(module) or {}).get(action)):
            roles.add(role)
    return [str(u["_id"]) async for u in db.users.find({"role": {"$in": list(roles)}, "active": {"$ne": False}}, {"_id": 1})]


async def clear(db, kind: str, source_type: str, source_id: str) -> None:
    """Drop the notes of a record that haven't been read yet (they are planned again from the new data)."""
    await db.notifications.delete_many({"kind": kind, "source_type": source_type, "source_id": source_id, "status": "pending"})


async def plan(db, *, kind: str, source_type: str, source_id: str, user_ids: Iterable[str], title: str, message: str,
               link: str, notify_at: Optional[str] = None, tag: str = "") -> int:
    """One pending note per person (skipped if that exact note already exists). Returns how many were added."""
    when = notify_at or now_utc().isoformat()
    made = 0
    for uid in {u for u in user_ids if u}:
        key = {"kind": kind, "source_type": source_type, "source_id": source_id, "user_id": uid, "tag": tag}
        if await db.notifications.find_one(key, {"_id": 1}):
            continue
        await db.notifications.insert_one({**key, "channel": "in_app", "audience": "staff", "status": "pending", "notify_at": when,
                                           "created_at": now_utc().isoformat(), "created_by": "system", "title": title[:140],
                                           "message": message[:240], "link": link})
        made += 1
    return made
