"""Report Usage log (Iteration 49 §6) — who ran which report, with which filters/location/format, when.
`record_usage()` is called from GET /api/reports/{type} (format=view) and POST /api/reports/usage
(format=pdf|excel from the browser-side exporters). `usage_report()` renders the log as its own report."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from fastapi import APIRouter, Request
from pydantic import BaseModel

SKIP = {"report_usage"}   # never log the usage report looking at itself


async def record_usage(db, user: Dict[str, Any], report_type: str, fmt: str, filters: Dict[str, Any], location_id: Optional[str]):
    if report_type in SKIP:
        return
    clean = {k: v for k, v in (filters or {}).items() if v not in (None, "", "all")}
    await db.report_usage.insert_one({
        "user_id": user.get("id"), "user_name": user.get("name"), "role": user.get("role"),
        "report_type": report_type, "format": fmt, "filters": clean,
        "date_from": clean.get("date_from"), "date_to": clean.get("date_to"), "location_id": location_id,
        "at": datetime.now(timezone.utc).isoformat(),
    })


async def usage_report(db, date_from: Optional[str], date_to: Optional[str], user_name: Optional[str],
                       report_type_filter: Optional[str], loc_filter: Dict[str, Any]) -> Dict[str, Any]:
    q: Dict[str, Any] = {}
    if date_from or date_to:
        q["at"] = {}
        if date_from: q["at"]["$gte"] = date_from
        if date_to: q["at"]["$lte"] = date_to + "T23:59:59"
    if user_name: q["user_name"] = {"$regex": user_name, "$options": "i"}
    if report_type_filter: q["report_type"] = report_type_filter
    if loc_filter.get("location_id"): q["location_id"] = loc_filter["location_id"]
    docs = await db.report_usage.find(q).sort("at", -1).to_list(20000)
    by_type: Dict[str, int] = {}
    by_user: Dict[str, int] = {}
    fmts = {"view": 0, "pdf": 0, "excel": 0}
    rows = []
    for d in docs:
        by_type[d["report_type"]] = by_type.get(d["report_type"], 0) + 1
        by_user[d.get("user_name") or "?"] = by_user.get(d.get("user_name") or "?", 0) + 1
        fmts[d.get("format") or "view"] = fmts.get(d.get("format") or "view", 0) + 1
        f = d.get("filters") or {}
        rows.append({"at": d["at"], "user": d.get("user_name"), "role": d.get("role"), "report_type": d["report_type"],
                     "format": d.get("format"), "date_range": f"{f.get('date_from') or '…'} → {f.get('date_to') or '…'}" if (f.get("date_from") or f.get("date_to")) else "all time",
                     "location_id": d.get("location_id") or "all",
                     "filters": ", ".join(f"{k}={v}" for k, v in f.items() if k not in ("date_from", "date_to")) or "—"})
    return {
        "summary": {"total_runs": len(docs), "distinct_users": len(by_user), "distinct_reports": len(by_type),
                    "views_count": fmts.get("view", 0), "pdf_exports_count": fmts.get("pdf", 0), "excel_exports_count": fmts.get("excel", 0),
                    "most_used_report": max(by_type, key=by_type.get) if by_type else "n/a"},
        "rows": rows,
        "type_rows": sorted([{"name": k, "count": v} for k, v in by_type.items()], key=lambda r: -r["count"]),
        "user_rows": sorted([{"name": k, "count": v} for k, v in by_user.items()], key=lambda r: -r["count"]),
        "chart_data": [{"name": k[:18], "value": v} for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])[:10]],
    }


class UsagePayload(BaseModel):
    report_type: str
    format: str = "pdf"
    filters: Dict[str, Any] = {}
    location_id: Optional[str] = None


def create_router(db, get_current_user):
    router = APIRouter()

    @router.post("/reports/usage")
    async def log_export(payload: UsagePayload, request: Request):
        user = await get_current_user(request)
        await record_usage(db, user, payload.report_type, payload.format if payload.format in ("pdf", "excel") else "pdf", payload.filters, payload.location_id)
        return {"ok": True}

    return router
