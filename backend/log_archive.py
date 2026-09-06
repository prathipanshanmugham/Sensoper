"""Audit-log quarterly archive & retention (Iteration 49 §5).

Guarantee: a quarter's live audit_logs may only be purged AFTER a complete archive (XLSX + PDF) of that
quarter is written to object storage, recorded in `log_archives`, and its row count re-verified against
the live table at purge time. Hard-delete snapshot entries travel inside the archive, so the permanent
audit-trail guarantee moves from the live table to the archived file — never lost.
Defaults: archive automatically at quarter end, keep current + previous quarter live, purge is MANUAL.
"""
from __future__ import annotations
import asyncio, io, json, logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

log = logging.getLogger("log_archive")
DELETION_ACTIONS = ("hard_delete", "hard-delete", "force_delete", "delete")


def quarter_label(dt: datetime) -> str:
    return f"{dt.year}-Q{(dt.month - 1) // 3 + 1}"


def quarter_bounds(label: str):
    year, q = label.split("-Q")
    year, q = int(year), int(q)
    start = datetime(year, 3 * (q - 1) + 1, 1, tzinfo=timezone.utc)
    end = datetime(year + (q == 4), 1 if q == 4 else 3 * q + 1, 1, tzinfo=timezone.utc)
    return start.isoformat(), end.isoformat()


def quarter_index(label: str) -> int:
    y, q = label.split("-Q")
    return int(y) * 4 + int(q) - 1


def is_purgeable(label: str, keep_quarters_live: int, now: Optional[datetime] = None) -> bool:
    """A quarter may be purged only if it is older than the `keep_quarters_live` most recent quarters."""
    current = quarter_index(quarter_label(now or datetime.now(timezone.utc)))
    return quarter_index(label) <= current - max(int(keep_quarters_live), 1)


def previous_quarter(now: Optional[datetime] = None) -> str:
    idx = quarter_index(quarter_label(now or datetime.now(timezone.utc))) - 1
    return f"{idx // 4}-Q{idx % 4 + 1}"


def _rows_to_xlsx(rows) -> bytes:
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active; ws.title = "audit_logs"
    cols = ["timestamp", "user_name", "action_type", "entity_type", "entity_id", "details"]
    ws.append(cols)
    for r in rows:
        ws.append([str(r.get(c) if c != "details" else json.dumps(r.get("details"), default=str)) for c in cols])
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()


def _rows_to_pdf(rows, label: str) -> bytes:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24)
    st = getSampleStyleSheet()
    data = [["Timestamp", "User", "Action", "Entity", "Entity ID", "Details"]]
    for r in rows:
        det = json.dumps(r.get("details"), default=str)
        data.append([str(r.get("timestamp", ""))[:19], str(r.get("user_name", ""))[:22], str(r.get("action_type", ""))[:22], str(r.get("entity_type", ""))[:18], str(r.get("entity_id", ""))[:26], det[:120]])
    t = Table(data, repeatRows=1, colWidths=[95, 90, 90, 70, 120, 300])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("FONTSIZE", (0, 0), (-1, -1), 6.5), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
                           ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")])]))
    doc.build([Paragraph(f"Audit Log Archive — {label} ({len(rows)} entries)", st["Title"]), Spacer(1, 8), t])
    return buf.getvalue()


class RetentionConfig(BaseModel):
    keep_quarters_live: int = 2
    auto_archive: bool = True
    auto_purge: bool = False


def create_router(db, get_current_user, require_role, create_audit_log, put_object, get_object, app_name: str):
    router = APIRouter()

    async def get_config() -> Dict[str, Any]:
        doc = await db.log_retention_config.find_one({"_id": "singleton"}) or {}
        return {**RetentionConfig().model_dump(), **{k: v for k, v in doc.items() if k != "_id"}}

    async def quarter_live_rows(label: str):
        start, end = quarter_bounds(label)
        return await db.audit_logs.find({"timestamp": {"$gte": start, "$lt": end}}).sort("timestamp", 1).to_list(500000)

    async def run_archive(label: str, user: Optional[Dict[str, Any]] = None, fail_for_test: bool = False) -> Dict[str, Any]:
        rows = await quarter_live_rows(label)
        deletion_n = sum(1 for r in rows if any(a in str(r.get("action_type", "")).lower() for a in DELETION_ACTIONS))
        now = datetime.now(timezone.utc).isoformat()
        doc = {"quarter": label, "row_count": len(rows), "deletion_snapshot_count": deletion_n, "created_at": now,
               "created_by": (user or {}).get("name", "scheduler"), "status": "failed", "purged_at": None, "error": None}
        try:
            if fail_for_test:
                raise RuntimeError("simulated storage failure")
            xlsx = _rows_to_xlsx(rows); pdf = _rows_to_pdf(rows, label)
            base = f"{app_name}/log-archives/{label}/audit_logs_{label}_{now[:10]}"
            doc["xlsx_path"] = put_object(f"{base}.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")["path"]
            doc["pdf_path"] = put_object(f"{base}.pdf", pdf, "application/pdf")["path"]
            # verify the archive is readable before declaring success
            if len(get_object(doc["xlsx_path"])[0]) == 0:
                raise RuntimeError("archive verification failed: empty object")
            doc["status"] = "archived"
        except Exception as e:  # noqa: BLE001
            doc["error"] = str(e)
            log.error("Archive %s failed: %s", label, e)
        await db.log_archives.update_one({"quarter": label, "status": "archived"}, {"$setOnInsert": doc}, upsert=True) if doc["status"] == "archived" \
            else await db.log_archives.insert_one(doc)
        saved = await db.log_archives.find_one({"quarter": label, "status": "archived"}) or doc
        return _clean(saved)

    def _clean(d):
        d = dict(d); d["id"] = str(d.pop("_id", "")); return d

    @router.get("/audit-logs/archive-config")
    async def read_config(request: Request):
        await require_role("admin")(request)
        return await get_config()

    @router.put("/audit-logs/archive-config")
    async def write_config(payload: RetentionConfig, request: Request):
        user = await require_role("admin")(request)
        if payload.keep_quarters_live < 1:
            raise HTTPException(status_code=400, detail="Must keep at least the current quarter live")
        await db.log_retention_config.update_one({"_id": "singleton"}, {"$set": payload.model_dump()}, upsert=True)
        await create_audit_log(user["id"], user["name"], "update", "log_retention_config", "singleton", None, payload.model_dump())
        return await get_config()

    @router.get("/audit-logs/archives")
    async def list_archives(request: Request):
        await require_role("admin", "manager")(request)
        docs = await db.log_archives.find({}).sort("created_at", -1).to_list(500)
        return [_clean(d) for d in docs]

    @router.post("/audit-logs/archives/run")
    async def archive_now(request: Request, quarter: Optional[str] = None, fail_for_test: bool = False):
        user = await require_role("admin")(request)
        label = quarter or previous_quarter()
        try:
            quarter_bounds(label)
        except Exception:
            raise HTTPException(status_code=400, detail="quarter must look like 2026-Q1")
        result = await run_archive(label, user, fail_for_test=fail_for_test)
        await create_audit_log(user["id"], user["name"], "archive", "audit_logs", label, None, {"status": result["status"], "rows": result["row_count"]})
        return result

    @router.post("/audit-logs/archives/{quarter}/purge")
    async def purge_quarter(quarter: str, request: Request):
        user = await require_role("admin")(request)
        cfg = await get_config()
        if not is_purgeable(quarter, cfg["keep_quarters_live"]):
            raise HTTPException(status_code=409, detail=f"{quarter} is within the live retention window ({cfg['keep_quarters_live']} quarters) — cannot purge")
        archive = await db.log_archives.find_one({"quarter": quarter, "status": "archived"})
        if not archive:
            raise HTTPException(status_code=409, detail=f"No successful archive exists for {quarter} — archive first; purge refused")
        live = await quarter_live_rows(quarter)
        if len(live) != archive["row_count"]:
            raise HTTPException(status_code=409, detail=f"Archive holds {archive['row_count']} rows but the live table now has {len(live)} for {quarter} — re-run the archive before purging")
        start, end = quarter_bounds(quarter)
        res = await db.audit_logs.delete_many({"timestamp": {"$gte": start, "$lt": end}})
        await db.log_archives.update_one({"_id": archive["_id"]}, {"$set": {"purged_at": datetime.now(timezone.utc).isoformat(), "purged_rows": res.deleted_count, "purged_by": user["name"]}})
        await create_audit_log(user["id"], user["name"], "purge", "audit_logs", quarter, None, {"purged_rows": res.deleted_count, "archive_id": str(archive["_id"])})
        return {"quarter": quarter, "purged_rows": res.deleted_count, "archive_id": str(archive["_id"])}

    @router.get("/audit-logs/archives/{archive_id}/download")
    async def download_archive(archive_id: str, request: Request, format: str = "xlsx"):
        await require_role("admin", "manager")(request)
        from bson import ObjectId
        doc = await db.log_archives.find_one({"_id": ObjectId(archive_id)}) if ObjectId.is_valid(archive_id) else None
        if not doc or doc.get("status") != "archived":
            raise HTTPException(status_code=404, detail="Archive not found")
        path = doc["pdf_path"] if format == "pdf" else doc["xlsx_path"]
        data, ct = get_object(path)
        return Response(content=data, media_type=ct, headers={"Content-Disposition": f'attachment; filename="audit_logs_{doc["quarter"]}.{format}"'})

    async def run_due():
        """Scheduler body — archive the previous quarter if not yet archived; purge only if admin enabled auto_purge."""
        cfg = await get_config()
        if not cfg["auto_archive"]:
            return
        label = previous_quarter()
        if not await db.log_archives.find_one({"quarter": label, "status": "archived"}):
            await run_archive(label)
        if cfg["auto_purge"]:
            async for a in db.log_archives.find({"status": "archived", "purged_at": None}):
                if is_purgeable(a["quarter"], cfg["keep_quarters_live"]) and len(await quarter_live_rows(a["quarter"])) == a["row_count"]:
                    s, e = quarter_bounds(a["quarter"])
                    res = await db.audit_logs.delete_many({"timestamp": {"$gte": s, "$lt": e}})
                    await db.log_archives.update_one({"_id": a["_id"]}, {"$set": {"purged_at": datetime.now(timezone.utc).isoformat(), "purged_rows": res.deleted_count, "purged_by": "scheduler"}})

    @router.post("/audit-logs/archives/run-due")
    async def run_due_now(request: Request):
        await require_role("admin")(request)
        await run_due()
        return {"ok": True, "checked_quarter": previous_quarter()}

    async def scheduler():
        while True:
            try:
                await run_due()
            except Exception as e:  # noqa: BLE001
                log.error("log archive scheduler: %s", e)
            await asyncio.sleep(24 * 3600)

    router.start_scheduler = lambda: asyncio.get_event_loop().create_task(scheduler())
    return router
