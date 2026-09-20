"""Iter 54 — Sensobrain: AI assistant over the app's OWN endpoints (never raw DB access).

* Every tool call is an in-process HTTP request to this same FastAPI app carrying the asking user's session cookie,
  so role + location scoping is exactly what that user gets in the UI.
* Hard-blocked path prefixes (Credential Vault, auth, users, permissions, security, Sensobrain settings) can never be
  reached; a configurable `excluded_paths` list extends the block list.
* Every request logs token usage → cost (USD at configured per-1M pricing, INR at configured FX) and the full
  transcript is stored per conversation for admin review. Users see a permanent notice in the UI.
"""
from __future__ import annotations
import json
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from vault import encrypt_secret, decrypt_secret

HARD_BLOCKED_PREFIXES = ["/api/vault", "/api/auth", "/api/users", "/api/permissions", "/api/security", "/api/sensobrain/settings"]
DEFAULT_EXCLUDED = ["/api/audit-logs", "/api/hard-delete"]
DEFAULT_PRICING = {  # USD per 1M tokens, OpenAI published (2026)
    "gpt-5.4-mini": {"input": 0.75, "output": 4.50},
    "gpt-5.4": {"input": 2.50, "output": 15.00},
    "gpt-5-mini": {"input": 0.25, "output": 2.00},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
}
SYSTEM_PROMPT = """You are Sensobrain, the in-house assistant of Sensoper Controls & Renewables, a solar EPC company in Tamil Nadu, India.
Rules:
- Reply in the SAME language the user writes in: English or Tamil (தமிழ்). Tamil users get fluent Tamil; keep technical terms (kW, kWh, inverter) in English letters.
- Use the tools to answer anything about the business (projects, customers, inventory, pricing, credits, AMC, vendors, reports). Never invent figures — if a tool returns nothing or an error, say so plainly.
- For system sizing / quotes ALWAYS call quick_solar_calculation (it is the company's own calculator) and present its numbers; never estimate yourself.
- Currency is INR (₹). Be concise; use short bullet lists for data.
- If a tool says the user is not permitted, tell the user that data is outside their access rather than guessing.
"""

TOOLS: List[Dict[str, Any]] = [
    {"type": "function", "function": {"name": "list_projects", "description": "List solar projects (quotes/jobs) visible to the user, optionally filtered by status or customer name.", "parameters": {"type": "object", "properties": {"status": {"type": "string", "description": "draft|submitted|approved|rejected|completed"}, "customer_search": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "get_project", "description": "Full details of one project by id: customer, site, electrical, system, cost estimate.", "parameters": {"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}}},
    {"type": "function", "function": {"name": "search_inventory", "description": "Search stock items (panels, inverters, batteries, cables…) with quantity and prices.", "parameters": {"type": "object", "properties": {"search": {"type": "string"}, "category": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "get_pricelist", "description": "Current selling price list (cost, margin, GST, selling price) by category.", "parameters": {"type": "object", "properties": {"category": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "quick_solar_calculation", "description": "The company's own solar calculator: system size, panel count, cost, subsidy, savings, payback from a monthly electricity bill.", "parameters": {"type": "object", "properties": {"monthly_eb_bill": {"type": "number"}, "system_type": {"type": "string", "description": "on-grid|hybrid|off-grid"}, "customer_type": {"type": "string", "description": "residential|commercial"}, "roof_area_sqft": {"type": "number"}, "backup_hours": {"type": "number"}, "subsidy": {"type": "number"}}, "required": ["monthly_eb_bill"]}}},
    {"type": "function", "function": {"name": "get_report", "description": "Management report (admin/manager only): sales_revenue, profit_leakage, project_execution, inventory_material, amc, assets, customer_support, partner_performance, ecommerce.", "parameters": {"type": "object", "properties": {"report_type": {"type": "string"}, "date_from": {"type": "string"}, "date_to": {"type": "string"}}, "required": ["report_type"]}}},
    {"type": "function", "function": {"name": "dashboard_stats", "description": "Headline counts: projects, pending approvals, low stock, revenue.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "list_customer_credits", "description": "Customer receivables / credits with balance, due date and overdue interest cost.", "parameters": {"type": "object", "properties": {"status": {"type": "string", "description": "active|overdue|closed|all"}}}}},
    {"type": "function", "function": {"name": "list_amc_contracts", "description": "Annual maintenance contracts.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "list_vendors", "description": "Supplier directory.", "parameters": {"type": "object", "properties": {"search": {"type": "string"}}}}},
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _trim_project(p: Dict[str, Any]) -> Dict[str, Any]:
    ce = p.get("cost_estimation") or {}
    return {"id": p.get("id"), "reference_number": p.get("reference_number"), "customer": (p.get("customer") or {}).get("name"),
            "phone": (p.get("customer") or {}).get("phone"), "status": p.get("status"), "district": (p.get("location") or {}).get("district"),
            "system_type": (p.get("solar_system") or {}).get("system_type"), "system_size_kw": ce.get("system_size_kw") or (p.get("proposed_solution") or {}).get("system_size_kw"),
            "total_cost": ce.get("total_cost"), "created_at": (p.get("created_at") or "")[:10]}


class ChatIn(BaseModel):
    message: str
    conversation_id: Optional[str] = None


class SettingsIn(BaseModel):
    openai_api_key: Optional[str] = None
    model: Optional[str] = None
    pricing: Optional[Dict[str, Dict[str, float]]] = None
    excluded_paths: Optional[List[str]] = None
    usd_to_inr: Optional[float] = None


def create_router(db, app, get_current_user, require_role):
    router = APIRouter()

    async def _settings() -> Dict[str, Any]:
        doc = await db.sensobrain_settings.find_one({"key": "defaults"}) or {}
        return {"model": doc.get("model", "gpt-5.4-mini"), "pricing": {**DEFAULT_PRICING, **doc.get("pricing", {})},
                "excluded_paths": doc.get("excluded_paths", DEFAULT_EXCLUDED), "usd_to_inr": float(doc.get("usd_to_inr", 84.0)),
                "openai_api_key_enc": doc.get("openai_api_key_enc")}

    def _blocked(path: str, excluded: List[str]) -> bool:
        return any(path.startswith(p) for p in HARD_BLOCKED_PREFIXES + list(excluded))

    async def _call(request: Request, method: str, path: str, excluded: List[str], params: Dict[str, Any] | None = None, body: Dict[str, Any] | None = None) -> Any:
        """In-process request to our own API, as the asking user (cookie forwarded)."""
        if _blocked(path, excluded):
            return {"error": "This data source is excluded from Sensobrain by policy."}
        cookies = {k: v for k, v in request.cookies.items() if k in ("access_token", "refresh_token")}
        headers = {"Authorization": request.headers["Authorization"]} if request.headers.get("Authorization") else {}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sensobrain.internal", cookies=cookies, headers=headers, timeout=60) as client:
            resp = await client.request(method, path, params={k: v for k, v in (params or {}).items() if v not in (None, "")}, json=body)
        if resp.status_code == 403:
            return {"error": "Not permitted for your role/location."}
        if resp.status_code >= 400:
            return {"error": f"Request failed ({resp.status_code}): {resp.text[:200]}"}
        return resp.json()

    async def dispatch(request: Request, name: str, args: Dict[str, Any], excluded: List[str]) -> Any:
        if name == "list_projects":
            data = await _call(request, "GET", "/api/projects", excluded, {"status": args.get("status")})
            if isinstance(data, dict):
                return data
            rows = [_trim_project(p) for p in data]
            if args.get("customer_search"):
                s = args["customer_search"].lower()
                rows = [r for r in rows if s in (r.get("customer") or "").lower()]
            return {"count": len(rows), "projects": rows[:25]}
        if name == "get_project":
            p = await _call(request, "GET", f"/api/projects/{args.get('project_id')}", excluded)
            if isinstance(p, dict) and "error" in p:
                return p
            keep = ["id", "reference_number", "status", "customer", "location", "electrical", "solar_system", "proposed_solution", "cost_estimation", "site_measurements", "created_at", "notes"]
            return {k: p.get(k) for k in keep if k in p}
        if name == "search_inventory":
            data = await _call(request, "GET", "/api/inventory/items", excluded, {"category": args.get("category")})
            if isinstance(data, dict):
                return data
            s = (args.get("search") or "").lower()
            rows = [{"id": i.get("id"), "name": i.get("name"), "sku": i.get("sku_code"), "category": i.get("category"), "quantity": i.get("quantity"), "unit_price": i.get("unit_price"), "selling_price": i.get("selling_price"), "wattage": (i.get("specs") or {}).get("wattage")} for i in data if not s or s in (i.get("name") or "").lower()]
            return {"count": len(rows), "items": rows[:30]}
        if name == "get_pricelist":
            data = await _call(request, "GET", "/api/pricelist", excluded, {"category": args.get("category")})
            if isinstance(data, dict) and "error" in data:
                return data
            items = data.get("items", data) if isinstance(data, dict) else data
            rows = [{"name": i.get("name"), "category": i.get("category"), "cost": i.get("unit_price") or i.get("cost"), "margin_pct": i.get("margin_pct"), "gst_pct": i.get("gst_percentage") or i.get("gst_pct"), "selling_price": i.get("selling_price"), "wattage_w": i.get("wattage_w")} for i in (items or [])]
            return {"count": len(rows), "items": rows[:40]}
        if name == "quick_solar_calculation":
            body = {"system_type": args.get("system_type") or "on-grid", "customer_type": args.get("customer_type") or "residential",
                    "monthly_eb_bill": args.get("monthly_eb_bill"), "roof_area_sqft": args.get("roof_area_sqft"), "backup_hours": args.get("backup_hours"), "subsidy": args.get("subsidy") or 0}
            return await _call(request, "POST", "/api/calculate/quick", excluded, body={k: v for k, v in body.items() if v is not None})
        if name == "get_report":
            data = await _call(request, "GET", f"/api/reports/{args.get('report_type')}", excluded, {"date_from": args.get("date_from"), "date_to": args.get("date_to")})
            if isinstance(data, dict) and "rows" in data:
                data = {**data, "rows": data["rows"][:30]}
            return data
        if name == "dashboard_stats":
            return await _call(request, "GET", "/api/dashboard/stats", excluded)
        if name == "list_customer_credits":
            data = await _call(request, "GET", "/api/credits", excluded, {"status": args.get("status")})
            if isinstance(data, dict):
                return data
            return {"count": len(data), "credits": [{"customer": c.get("customer_name"), "invoice": c.get("invoice_ref"), "total": c.get("total_amount"), "balance": c.get("balance"), "due_date": c.get("due_date"), "status": c.get("status"), "days_overdue": c.get("days_overdue"), "interest_cost": c.get("interest_cost")} for c in data[:40]]}
        if name == "list_amc_contracts":
            data = await _call(request, "GET", "/api/amc/contracts", excluded)
            if isinstance(data, dict) and "error" in data:
                return data
            rows = data.get("contracts", data) if isinstance(data, dict) else data
            return {"count": len(rows), "contracts": [{k: c.get(k) for k in ("id", "customer_name", "status", "start_date", "end_date", "annual_value", "visits_per_year")} for c in rows[:40]]}
        if name == "list_vendors":
            data = await _call(request, "GET", "/api/vendors", excluded, {"search": args.get("search")})
            if isinstance(data, dict):
                return data
            return {"count": len(data), "vendors": [{k: v.get(k) for k in ("name", "category", "district", "state", "phone", "gstin", "business_value")} for v in data[:40]]}
        return {"error": f"Unknown tool {name}"}

    def _cost(model: str, pricing: Dict[str, Dict[str, float]], inp: int, out: int) -> float:
        p = pricing.get(model) or {"input": 0, "output": 0}
        return round(inp / 1e6 * p["input"] + out / 1e6 * p["output"], 6)

    # ── settings (admin) ──
    @router.get("/sensobrain/settings")
    async def get_settings(request: Request):
        await require_role("admin")(request)
        s = await _settings()
        key = decrypt_secret(s["openai_api_key_enc"]) if s.get("openai_api_key_enc") else ""
        return {"model": s["model"], "pricing": s["pricing"], "excluded_paths": s["excluded_paths"], "hard_blocked": HARD_BLOCKED_PREFIXES,
                "usd_to_inr": s["usd_to_inr"], "api_key_configured": bool(key), "api_key_hint": f"{key[:5]}…{key[-4:]}" if key else None}

    @router.put("/sensobrain/settings")
    async def put_settings(payload: SettingsIn, request: Request):
        user = await require_role("admin")(request)
        changes: Dict[str, Any] = {"updated_by": user["id"], "updated_at": _now().isoformat()}
        if payload.openai_api_key is not None and payload.openai_api_key.strip():
            key = payload.openai_api_key.strip()
            if not key.startswith("sk-"):
                raise HTTPException(status_code=400, detail="That does not look like an OpenAI API key (should start with sk-)")
            changes["openai_api_key_enc"] = encrypt_secret(key)
        if payload.model:
            changes["model"] = payload.model.strip()
        if payload.pricing is not None:
            changes["pricing"] = payload.pricing
        if payload.excluded_paths is not None:
            changes["excluded_paths"] = [p.strip() for p in payload.excluded_paths if p.strip().startswith("/api/")]
        if payload.usd_to_inr is not None:
            changes["usd_to_inr"] = float(payload.usd_to_inr)
        await db.sensobrain_settings.update_one({"key": "defaults"}, {"$set": changes}, upsert=True)
        return await get_settings(request)

    @router.get("/sensobrain/status")
    async def status(request: Request):
        await get_current_user(request)
        s = await _settings()
        return {"configured": bool(s.get("openai_api_key_enc")), "model": s["model"]}

    # ── chat ──
    @router.post("/sensobrain/chat")
    async def chat(payload: ChatIn, request: Request):
        user = await get_current_user(request)
        s = await _settings()
        if not s.get("openai_api_key_enc"):
            raise HTTPException(status_code=503, detail="Sensobrain is not configured yet — an admin must add the OpenAI API key in Sensobrain settings")
        if not payload.message.strip():
            raise HTTPException(status_code=400, detail="Message is empty")
        api_key = decrypt_secret(s["openai_api_key_enc"])
        convo = None
        if payload.conversation_id and ObjectId.is_valid(payload.conversation_id):
            convo = await db.sensobrain_conversations.find_one({"_id": ObjectId(payload.conversation_id), "user_id": user["id"]})
        if not convo:
            res = await db.sensobrain_conversations.insert_one({"user_id": user["id"], "user_name": user.get("name"), "role": user["role"], "location_ids": user.get("location_ids") or [],
                                                                 "title": payload.message.strip()[:80], "messages": [], "created_at": _now().isoformat(), "updated_at": _now().isoformat(),
                                                                 "total_tokens": 0, "total_cost_usd": 0.0})
            convo = await db.sensobrain_conversations.find_one({"_id": res.inserted_id})
        convo_id = str(convo["_id"])
        history = [{"role": "system", "content": SYSTEM_PROMPT}] + [{"role": m["role"], "content": m["content"]} for m in convo.get("messages", [])[-20:] if m.get("role") in ("user", "assistant") and m.get("content")]

        from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, ToolCallReady, StreamDone
        llm = LlmChat(api_key=api_key, session_id=convo_id, system_message=SYSTEM_PROMPT, initial_messages=history).with_model("openai", s["model"]).with_tools(TOOLS, tool_choice="auto")

        async def gen():
            yield f"data: {json.dumps({'type': 'start', 'conversation_id': convo_id})}\n\n"
            text_parts: List[str] = []
            tools_used: List[Dict[str, Any]] = []
            inp = out = 0
            user_msg = UserMessage(text=payload.message)
            try:
                for _ in range(6):
                    pending = []
                    async for ev in llm.stream_message(user_msg):
                        if isinstance(ev, TextDelta):
                            text_parts.append(ev.content)
                            yield f"data: {json.dumps({'type': 'delta', 'content': ev.content})}\n\n"
                        elif isinstance(ev, ToolCallReady):
                            pending.append(ev.tool_call)
                        elif isinstance(ev, StreamDone):
                            inp += ev.usage.input_tokens or 0
                            out += ev.usage.output_tokens or 0
                    if not pending:
                        break
                    for tc in pending:
                        yield f"data: {json.dumps({'type': 'tool', 'name': tc.name})}\n\n"
                        result = await dispatch(request, tc.name, tc.arguments or {}, s["excluded_paths"])
                        tools_used.append({"name": tc.name, "arguments": tc.arguments, "ok": not (isinstance(result, dict) and "error" in result)})
                        llm.add_tool_result(tc.id, json.dumps(result, default=str)[:60000])
                    user_msg = None
            except Exception as e:  # provider/network errors → surface to the user, still log the turn
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)[:300]})}\n\n"
            answer = "".join(text_parts)
            cost = _cost(s["model"], s["pricing"], inp, out)
            ts = _now().isoformat()
            await db.sensobrain_conversations.update_one({"_id": convo["_id"]}, {
                "$push": {"messages": {"$each": [{"role": "user", "content": payload.message, "ts": ts},
                                                 {"role": "assistant", "content": answer, "ts": ts, "tools_used": tools_used, "input_tokens": inp, "output_tokens": out, "cost_usd": cost}]}},
                "$set": {"updated_at": ts}, "$inc": {"total_tokens": inp + out, "total_cost_usd": cost}})
            await db.sensobrain_usage.insert_one({"user_id": user["id"], "user_name": user.get("name"), "conversation_id": convo_id, "model": s["model"],
                                                  "input_tokens": inp, "output_tokens": out, "cost_usd": cost, "cost_inr": round(cost * s["usd_to_inr"], 4), "ts": ts})
            yield f"data: {json.dumps({'type': 'done', 'conversation_id': convo_id, 'input_tokens': inp, 'output_tokens': out, 'cost_usd': cost, 'cost_inr': round(cost * s['usd_to_inr'], 4), 'tools_used': [t['name'] for t in tools_used]})}\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # ── conversations ──
    def _convo_public(c: Dict[str, Any], with_messages: bool) -> Dict[str, Any]:
        out = {"id": str(c["_id"]), "user_id": c.get("user_id"), "user_name": c.get("user_name"), "role": c.get("role"), "title": c.get("title"),
               "created_at": c.get("created_at"), "updated_at": c.get("updated_at"), "message_count": len(c.get("messages", [])),
               "total_tokens": c.get("total_tokens", 0), "total_cost_usd": round(c.get("total_cost_usd", 0), 6)}
        if with_messages:
            out["messages"] = c.get("messages", [])
        return out

    @router.get("/sensobrain/conversations")
    async def my_conversations(request: Request):
        user = await get_current_user(request)
        return [_convo_public(c, False) async for c in db.sensobrain_conversations.find({"user_id": user["id"]}).sort("updated_at", -1).limit(50)]

    @router.get("/sensobrain/conversations/{convo_id}")
    async def one_conversation(convo_id: str, request: Request):
        user = await get_current_user(request)
        if not ObjectId.is_valid(convo_id):
            raise HTTPException(status_code=400, detail="Invalid id")
        q: Dict[str, Any] = {"_id": ObjectId(convo_id)}
        if user["role"] != "admin":
            q["user_id"] = user["id"]
        c = await db.sensobrain_conversations.find_one(q)
        if not c:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return _convo_public(c, True)

    @router.get("/sensobrain/admin/conversations")
    async def admin_conversations(request: Request, user_id: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None, q: Optional[str] = None):
        await require_role("admin")(request)
        query: Dict[str, Any] = {}
        if user_id:
            query["user_id"] = user_id
        if date_from or date_to:
            query["updated_at"] = {}
            if date_from:
                query["updated_at"]["$gte"] = date_from
            if date_to:
                query["updated_at"]["$lte"] = date_to + "T23:59:59"
        if q:
            query["$or"] = [{"title": {"$regex": q, "$options": "i"}}, {"messages.content": {"$regex": q, "$options": "i"}}]
        return [_convo_public(c, False) async for c in db.sensobrain_conversations.find(query).sort("updated_at", -1).limit(200)]

    @router.get("/sensobrain/admin/usage")
    async def usage_summary(request: Request):
        await require_role("admin")(request)
        s = await _settings()
        now = _now()
        today = now.strftime("%Y-%m-%d")
        month = now.strftime("%Y-%m")
        buckets = {"today": {"requests": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
                   "this_month": {"requests": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
                   "all_time": {"requests": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}}
        by_user: Dict[str, Dict[str, Any]] = {}
        async for u in db.sensobrain_usage.find({}):
            ts = u.get("ts", "")
            for name, ok in (("today", ts.startswith(today)), ("this_month", ts.startswith(month)), ("all_time", True)):
                if ok:
                    b = buckets[name]
                    b["requests"] += 1; b["input_tokens"] += u.get("input_tokens", 0); b["output_tokens"] += u.get("output_tokens", 0); b["cost_usd"] += u.get("cost_usd", 0)
            bu = by_user.setdefault(u.get("user_id"), {"user_name": u.get("user_name"), "requests": 0, "cost_usd": 0.0})
            bu["requests"] += 1; bu["cost_usd"] += u.get("cost_usd", 0)
        for b in buckets.values():
            b["cost_usd"] = round(b["cost_usd"], 4); b["cost_inr"] = round(b["cost_usd"] * s["usd_to_inr"], 2)
        return {**buckets, "model": s["model"], "usd_to_inr": s["usd_to_inr"], "by_user": sorted(by_user.values(), key=lambda x: -x["cost_usd"])[:20]}

    return router
