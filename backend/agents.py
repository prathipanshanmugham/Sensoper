"""AI agents — let AI agents (Claude, ChatGPT, n8n, your own scripts) read and work with Sensoper's data.

* Settings → AI agents (admins only): one connection per agent. A connection works *as* a chosen login, so that
  login's role, permissions and branches apply to everything the agent does. Access is read only, read & write, or
  full (delete too). Two more switches, both off by default: manage logins & permissions, read saved passwords.
* API keys (``snp_key_…``): send ``Authorization: Bearer <key>`` to any /api endpoint, or to the MCP server.
* MCP server: POST /api/mcp (Streamable HTTP, JSON responses, stateless). Tools: whoami, app_map, list_endpoints,
  describe_endpoint and call_api — together they reach every endpoint of the app.
* OAuth 2.1 (PKCE S256 + dynamic client registration) so the Claude / ChatGPT "custom connector" can connect. An admin
  approves each connection on /connect-agent and chooses what it may do.
* Every call is logged (Settings → AI agents → Activity, 90 days) and changes appear in the Activity log under the
  agent's name. Keys and tokens are stored only as SHA-256 hashes; a key is shown once.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode, urlparse

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel

import access_policy

PREFIX = "snp_"
ACCESS_LEVELS = ("read", "write", "full")
ACCESS_LABEL = {"read": "Read only", "write": "Read & write", "full": "Full control"}
READ_METHODS = {"GET", "HEAD", "OPTIONS"}
CALL_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")
ACCESS_TOKEN_SECONDS = 3600
REFRESH_TOKEN_DAYS = 60
CODE_SECONDS = 300
REQUEST_SECONDS = 900
ACTIVITY_DAYS = 90
RATE_PER_MINUTE = 300
MAX_TEXT = 100_000
PROTOCOLS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
SCOPE = "sensoper"
KNOWN_APP_HOSTS = ("claude.ai", "claude.com", "anthropic.com", "chatgpt.com", "openai.com", "localhost", "127.0.0.1")
DEFAULT_SETTINGS = {"enabled": False, "allow_connectors": True}


# ───────────────────────── pure helpers ─────────────────────────
def new_secret(kind: str) -> str:
    return f"{PREFIX}{kind}_{secrets.token_urlsafe(32)}"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_ist() -> str:
    return (now_utc() + timedelta(hours=5, minutes=30)).date().isoformat()


def method_allowed(access: str, method: str) -> bool:
    method = method.upper()
    if access == "full":
        return True
    if access == "write":
        return method != "DELETE"
    return method in READ_METHODS


def _under(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def refusal(path: str, method: str, agent: Dict[str, Any]) -> Optional[str]:
    """Why this agent may not make this call (None = it may; the login's own permissions are checked after this)."""
    p = (path or "/").rstrip("/") or "/"
    method = method.upper()
    if _under(p, "/api/agents") or _under(p, "/api/oauth") or _under(p, "/api/mcp"):
        return "AI agents can't change AI agent access. An admin does that in Settings → AI agents."
    if _under(p, "/api/auth"):
        return None if (method == "GET" and p == "/api/auth/me") else "Signing in, passwords and 2FA are for people, not AI agents."
    if _under(p, "/api/security") and not agent.get("manage_access"):
        return "This agent can't see or change login security. An admin can allow it in Settings → AI agents."
    if (_under(p, "/api/users") or _under(p, "/api/permissions")) and method not in READ_METHODS and not agent.get("manage_access"):
        return "This agent can't change logins or permissions. An admin can allow it in Settings → AI agents."
    if re.match(r"^/api/vault/[^/]+/reveal$", p) and not agent.get("read_saved_logins"):
        return "This agent can't read saved passwords. An admin can allow it in Settings → AI agents."
    if not method_allowed(agent.get("access", "read"), method):
        return ("This agent has read-only access." if agent.get("access", "read") == "read"
                else "This agent can't delete. An admin can give it full control in Settings → AI agents.")
    return None


def pkce_ok(verifier: str, challenge: str) -> bool:
    if not verifier or not challenge or not (43 <= len(verifier) <= 128):
        return False
    digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return secrets.compare_digest(digest, challenge)


def redirect_uri_ok(uri: str) -> bool:
    """https anywhere; http only to this computer (local apps); an app's own scheme (cursor://…) is allowed."""
    try:
        u = urlparse(uri or "")
    except ValueError:
        return False
    if not u.scheme or u.fragment or len(uri) > 500:
        return False
    if u.scheme == "https":
        return bool(u.hostname)
    if u.scheme == "http":
        return u.hostname in ("localhost", "127.0.0.1", "::1")
    return bool(re.match(r"^[a-z][a-z0-9+.-]{1,30}$", u.scheme)) and u.scheme not in ("javascript", "data", "file", "vbscript", "about", "blob")


def known_app(uri: str) -> bool:
    host = (urlparse(uri).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in KNOWN_APP_HOSTS)


def with_query(uri: str, params: Dict[str, Any]) -> str:
    q = urlencode({k: v for k, v in params.items() if v not in (None, "")})
    return uri + ("&" if "?" in uri else "?") + q


def _keep(items: List[Any], budget: int) -> int:
    size = 2
    for i, item in enumerate(items):
        size += len(json.dumps(item, ensure_ascii=False, default=str)) + 1
        if size > budget:
            return i
    return len(items)


def fit(data: Any, limit: int = MAX_TEXT) -> str:
    """JSON text for a tool result, cut down to the size limit (long lists keep their first items)."""
    text = json.dumps(data, ensure_ascii=False, default=str)
    if len(text) <= limit:
        return text
    note = "Narrow the call with its query parameters (search, status, dates, limit) to see the rest."
    if isinstance(data, list):
        n = _keep(data, limit - 400)
        return json.dumps({"items": data[:n], "note": f"Showing the first {n} of {len(data)} items. {note}"}, ensure_ascii=False, default=str)
    if isinstance(data, dict):
        for key in ("data", "items", "rows", "endpoints"):
            inner = data.get(key)
            if isinstance(inner, list) and len(inner) > 1:
                rest = len(text) - len(json.dumps(inner, ensure_ascii=False, default=str))
                n = _keep(inner, limit - rest - 400)
                return json.dumps({**data, key: inner[:n], "note": f"Showing the first {n} of {len(inner)} items. {note}"}, ensure_ascii=False, default=str)
    return text[: limit - 200] + f"… [cut: the full answer is {len(text)} characters — narrow the call]"


def header_text(text: str) -> str:
    """Plain ASCII for an HTTP header (headers can't carry → or curly quotes)."""
    for a, b in (("→", "->"), ("—", "-"), ("–", "-"), ("’", "'"), ("‘", "'"), ("“", "'"), ("”", "'"), ('"', "'"), ("…", "...")):
        text = text.replace(a, b)
    return text.encode("ascii", "ignore").decode()


def compact_schema(schema: Any, components: Dict[str, Any], depth: int = 0) -> Any:
    """A short, readable version of an OpenAPI schema (refs resolved, 4 levels deep)."""
    if not isinstance(schema, dict):
        return schema
    if "$ref" in schema:
        name = schema["$ref"].split("/")[-1]
        if depth >= 4:
            return {"type": "object", "model": name}
        return compact_schema(components.get(name, {}), components, depth + 1)
    for key in ("anyOf", "oneOf"):
        if key in schema:
            opts = [compact_schema(s, components, depth) for s in schema[key]]
            non_null = [o for o in opts if not (isinstance(o, dict) and o.get("type") == "null")]
            if len(non_null) == 1 and len(non_null) < len(opts):
                out = dict(non_null[0]) if isinstance(non_null[0], dict) else {"type": non_null[0]}
                out["nullable"] = True
                if "default" in schema:
                    out["default"] = schema["default"]
                return out
            return {"any_of": opts}
    if "allOf" in schema and len(schema["allOf"]) == 1:
        return compact_schema(schema["allOf"][0], components, depth)
    t = schema.get("type")
    out: Dict[str, Any] = {}
    if t == "object" or "properties" in schema:
        props = schema.get("properties") or {}
        if depth >= 4:
            return {"type": "object"}
        out = {"type": "object", "properties": {k: compact_schema(v, components, depth + 1) for k, v in props.items()}}
        if schema.get("required"):
            out["required"] = schema["required"]
        if not props and schema.get("additionalProperties") not in (None, False):
            out["additional_properties"] = True
        return out
    if t == "array":
        return {"type": "array", "items": compact_schema(schema.get("items", {}), components, depth + 1)}
    for k in ("type", "format", "enum", "default", "description", "minimum", "maximum", "maxLength"):
        if k in schema:
            out[k] = schema[k]
    return out or {"type": "any"}


def endpoint_area(method: str, path: str) -> str:
    """The Permissions page an endpoint belongs to (its key), or 'api:<first segment>' for shared look-ups."""
    t = access_policy.match(method, path)
    if t and t[0] == "page":
        return t[1]
    if t and t[0] == "option":
        o = access_policy.OPTIONS.get(t[1])
        if o:
            return o["page"]
    seg = (path.split("/") + ["", "", ""])[2] or "general"
    return f"api:{seg}"


def area_label(area: str) -> str:
    p = access_policy.PAGES.get(area)
    if p:
        return p["label"]
    return area.split(":", 1)[-1].replace("-", " ").replace("_", " ").capitalize()


def humanize(name: str) -> str:
    return (name or "").replace("_", " ").strip().capitalize()


def first_line(doc: Optional[str]) -> str:
    return " ".join((doc or "").strip().split())[:400]


# ───────────────────────── request bodies ─────────────────────────
class AgentSettingsBody(BaseModel):
    enabled: Optional[bool] = None
    allow_connectors: Optional[bool] = None


class AgentBody(BaseModel):
    name: Optional[str] = None
    run_as_user_id: Optional[str] = None
    access: Optional[str] = None
    manage_access: Optional[bool] = None
    read_saved_logins: Optional[bool] = None
    expires_on: Optional[str] = None
    note: Optional[str] = None
    status: Optional[str] = None


class ApproveBody(BaseModel):
    name: Optional[str] = None
    run_as_user_id: Optional[str] = None
    access: str = "write"
    manage_access: bool = False
    read_saved_logins: bool = False


INSTRUCTIONS = (
    "Sensoper is the business system of Sensoper Controls & Renewables, a solar EPC company in Tamil Nadu, India: "
    "leads and projects (site visits, quotations, installation, handover), inventory and purchases (vendors, purchase "
    "requests with vendor quotes, purchase orders, inbound and QC), direct and online sales, AMC and customer support, "
    "HR, attendance and daily reports, money (credits, invoices, loans), brands and trademarks, and the event calendar.\n"
    "You are an AI agent that works as one Sensoper login: its role, permissions and branches apply, and every change "
    "is recorded under your agent's name.\n"
    "How to work: 1) app_map shows the areas you can use. 2) list_endpoints with a word or an area finds the API. "
    "3) describe_endpoint shows its parameters and body. 4) call_api reads or changes data.\n"
    "Money is in Indian rupees, dates are YYYY-MM-DD and times are India time (IST, UTC+5:30) unless a field says "
    "otherwise. Confirm with the person you work for before deleting anything or making large changes."
)

TOOLS = [
    {"name": "whoami", "title": "Who am I",
     "description": "Which agent this is, the Sensoper login it works as (role, branches), its access level and today's date (IST).",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "app_map", "title": "Map of Sensoper",
     "description": "The areas of Sensoper (projects, inventory, purchases, AMC, HR, loans…), what each is for, what this "
                    "agent may do there and how many API endpoints it has. Start here.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "list_endpoints", "title": "Find API endpoints",
     "description": "Find Sensoper API endpoints this agent may call. Filter by words (e.g. 'purchase order', 'vendor "
                    "rating', 'loan payment') and/or an area key from app_map.",
     "inputSchema": {"type": "object", "properties": {
         "query": {"type": "string", "description": "Words to look for in the path or description"},
         "area": {"type": "string", "description": "An area key from app_map, e.g. module_purchase_inbound"},
         "method": {"type": "string", "enum": list(CALL_METHODS)},
         "limit": {"type": "integer", "minimum": 1, "maximum": 300, "default": 80}}, "additionalProperties": False},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "describe_endpoint", "title": "Describe an endpoint",
     "description": "The path and query parameters and the JSON body of one endpoint (as listed by list_endpoints).",
     "inputSchema": {"type": "object", "properties": {
         "method": {"type": "string", "enum": list(CALL_METHODS)},
         "path": {"type": "string", "description": "e.g. /api/purchase-orders or /api/vendors/{vendor_id}"}},
         "required": ["method", "path"], "additionalProperties": False},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "call_api", "title": "Call the Sensoper API",
     "description": "Call any Sensoper API endpoint as this agent and get its JSON answer. Fill path parameters into "
                    "the path (/api/vendors/66ab…). Read-only agents can only GET; deleting needs full control.",
     "inputSchema": {"type": "object", "properties": {
         "method": {"type": "string", "enum": list(CALL_METHODS)},
         "path": {"type": "string", "description": "Starts with /api/"},
         "query": {"type": "object", "description": "Query parameters", "additionalProperties": True},
         "body": {"description": "JSON body for POST / PUT / PATCH"}},
         "required": ["method", "path"], "additionalProperties": False},
     "annotations": {"readOnlyHint": False, "destructiveHint": True, "openWorldHint": False}},
]


# ───────────────────────── activity middleware ─────────────────────────
class AgentActivityMiddleware:
    """Logs every API request made with an agent key or token (method, path, status, time) after it is answered."""

    def __init__(self, app, db_getter):
        self.app, self.db_getter = app, db_getter

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"")
        path = scope.get("path", "")
        if not auth.startswith(b"Bearer " + PREFIX.encode()) or path.rstrip("/") == "/api/mcp":
            return await self.app(scope, receive, send)
        started, status = time.monotonic(), {"code": 500}

        async def send_wrap(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrap)
        finally:
            ctx = (scope.get("state") or {}).get("agent_ctx")
            if ctx:
                try:
                    via = headers.get(b"x-sensoper-via", b"").decode("latin-1")[:20] or "api"
                    at = now_utc()
                    await self.db_getter().agent_activity.insert_one({
                        "agent_id": ctx["id"], "agent_name": ctx["name"], "at": at.isoformat(), "at_dt": at,
                        "method": scope.get("method", ""), "path": path[:300], "status": status["code"],
                        "ms": int((time.monotonic() - started) * 1000), "via": via, "ip": ctx.get("ip", "")})
                except Exception:  # noqa: BLE001 — logging must never break the request
                    pass


# ───────────────────────── router ─────────────────────────
def create_router(db, get_current_user, require_role, create_audit_log, user_out, get_permissions, app_getter):
    router = APIRouter()        # mounted under /api
    root = APIRouter()          # site root: /.well-known/… (nginx sends /.well-known/oauth-* and openid-* here)
    router.root_router = root
    _settings_cache: Dict[str, Any] = {"at": 0.0, "value": None}
    _touched: Dict[str, float] = {}
    _hits: Dict[str, deque] = {}
    _openapi: Dict[str, Any] = {}

    async def settings() -> Dict[str, Any]:
        if _settings_cache["value"] is not None and time.monotonic() - _settings_cache["at"] < 5:
            return _settings_cache["value"]
        doc = await db.agent_settings.find_one({"key": "defaults"}) or {}
        value = {k: bool(doc.get(k, v)) for k, v in DEFAULT_SETTINGS.items()}
        _settings_cache.update(at=time.monotonic(), value=value)
        return value

    def base_url(request: Request) -> str:
        env = (os.environ.get("PUBLIC_BASE_URL") or "").strip().rstrip("/")
        if env:
            return env
        proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",")[0].strip()
        host = request.headers.get("host") or request.url.netloc     # nginx sets Host; X-Forwarded-Host isn't trusted
        return f"{proto}://{host.split(',')[0].strip()}"

    def client_ip(request: Request) -> str:
        fwd = request.headers.get("x-forwarded-for", "")
        return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else ""))[:64]

    def rate_ok(agent_id: str) -> bool:
        dq = _hits.setdefault(agent_id, deque())
        now = time.monotonic()
        while dq and now - dq[0] > 60:
            dq.popleft()
        if len(dq) >= RATE_PER_MINUTE:
            return False
        dq.append(now)
        return True

    async def issue(agent_id: ObjectId, kind: str, seconds: Optional[int] = None) -> str:
        token = new_secret({"key": "key", "access": "at", "refresh": "rt"}[kind])
        doc = {"hash": token_hash(token), "agent_id": agent_id, "kind": kind, "revoked": False, "created_at": now_utc().isoformat()}
        if seconds:
            exp = now_utc() + timedelta(seconds=seconds)
            doc.update(expires_at=exp.isoformat(), expires_dt=exp)
        await db.agent_tokens.insert_one(doc)
        return token

    # ── who is calling ──
    async def authenticate(request: Request, token: str, check_route: bool = True) -> Dict[str, Any]:
        bad = HTTPException(status_code=401, detail="This AI agent key isn't valid — it may have been replaced or removed")
        t = await db.agent_tokens.find_one({"hash": token_hash(token)})
        if not t or t.get("revoked") or t.get("kind") == "refresh":
            raise bad
        if t.get("expires_at") and t["expires_at"] < now_utc().isoformat():
            raise HTTPException(status_code=401, detail="This access token has expired")
        agent = await db.agents.find_one({"_id": t["agent_id"]})
        if not agent:
            raise bad
        aid, ip = str(agent["_id"]), client_ip(request)
        request.state.agent_ctx = {"id": aid, "name": agent["name"], "ip": ip}     # refused calls are logged too
        st = await settings()
        if not st["enabled"]:
            raise HTTPException(status_code=401, detail="AI agents are switched off in Sensoper (Settings → AI agents)")
        if agent.get("kind") == "connector" and not st["allow_connectors"]:
            raise HTTPException(status_code=401, detail="Claude / ChatGPT connectors are switched off in Settings → AI agents")
        if agent.get("status") != "active":
            raise HTTPException(status_code=401, detail="This AI agent is paused in Settings → AI agents")
        if agent.get("expires_on") and today_ist() > agent["expires_on"]:
            raise HTTPException(status_code=401, detail="This AI agent's access has expired")
        user = await db.users.find_one({"_id": ObjectId(agent["run_as_user_id"])}) if ObjectId.is_valid(agent.get("run_as_user_id") or "") else None
        if not user or user.get("active") is False or (user.get("access_until") and today_ist() > str(user["access_until"])[:10]):
            raise HTTPException(status_code=401, detail="The login this agent works as is closed. Choose another in Settings → AI agents.")
        if not rate_ok(aid):
            raise HTTPException(status_code=429, detail=f"Too many calls — this agent may make {RATE_PER_MINUTE} a minute")
        if check_route:
            reason = refusal(request.url.path, request.method, agent)
            if reason:
                raise HTTPException(status_code=403, detail=reason)
        if time.monotonic() - _touched.get(aid, 0) > 60:
            _touched[aid] = time.monotonic()
            await db.agents.update_one({"_id": agent["_id"]}, {"$set": {"last_used_at": now_utc().isoformat(), "last_ip": ip}})
        out = user_out(user)
        out.update({"name": f"{agent['name']} (AI agent)", "must_reset_password": False, "is_agent": True,
                    "agent": {"id": aid, "name": agent["name"], "kind": agent.get("kind", "key"), "access": agent.get("access", "read"),
                              "manage_access": bool(agent.get("manage_access")), "read_saved_logins": bool(agent.get("read_saved_logins")),
                              "works_as": user["name"]}})
        return out

    router.authenticate = authenticate

    async def admin(request: Request) -> Dict[str, Any]:
        user = await get_current_user(request)
        if user.get("role") != "admin" or user.get("is_agent"):
            raise HTTPException(status_code=403, detail="Only an admin can manage AI agents")
        return user

    async def active_user(uid: Optional[str]) -> Dict[str, Any]:
        u = await db.users.find_one({"_id": ObjectId(uid)}) if uid and ObjectId.is_valid(uid) else None
        if not u or u.get("active") is False:
            raise HTTPException(status_code=400, detail="Choose an active login for the agent to work as")
        return u

    def check_fields(body: Dict[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        if "name" in body and body["name"] is not None:
            name = " ".join(str(body["name"]).split())[:60]
            if len(name) < 2:
                raise HTTPException(status_code=400, detail="Give the agent a name (for example Purchase assistant)")
            out["name"] = name
        if body.get("access") is not None:
            if body["access"] not in ACCESS_LEVELS:
                raise HTTPException(status_code=400, detail="Access is read, write or full")
            out["access"] = body["access"]
        for k in ("manage_access", "read_saved_logins"):
            if body.get(k) is not None:
                out[k] = bool(body[k])
        if "expires_on" in body:
            exp = body["expires_on"] or None
            if exp:
                try:
                    datetime.strptime(exp, "%Y-%m-%d")
                except ValueError:
                    raise HTTPException(status_code=400, detail="Expiry must be a date (YYYY-MM-DD)")
                if exp < today_ist():
                    raise HTTPException(status_code=400, detail="The expiry date has already passed")
            out["expires_on"] = exp
        if "note" in body and body["note"] is not None:
            out["note"] = str(body["note"]).strip()[:300]
        if body.get("status") is not None:
            if body["status"] not in ("active", "paused"):
                raise HTTPException(status_code=400, detail="Status is active or paused")
            out["status"] = body["status"]
        return out

    async def agent_rows(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        uids = {ObjectId(d["run_as_user_id"]) for d in docs if ObjectId.is_valid(d.get("run_as_user_id") or "")}
        users = {str(u["_id"]): u async for u in db.users.find({"_id": {"$in": list(uids)}}, {"name": 1, "role": 1, "active": 1})}
        since = (now_utc() - timedelta(hours=24)).isoformat()
        counts: Dict[str, int] = {}
        async for row in db.agent_activity.aggregate([{"$match": {"at": {"$gte": since}}}, {"$group": {"_id": "$agent_id", "n": {"$sum": 1}}}]):
            counts[row["_id"]] = row["n"]
        out = []
        for d in docs:
            u = users.get(d.get("run_as_user_id") or "") or {}
            out.append({"id": str(d["_id"]), "name": d["name"], "kind": d.get("kind", "key"), "client_name": d.get("client_name"),
                        "run_as_user_id": d.get("run_as_user_id"), "run_as_name": u.get("name"), "run_as_role": u.get("role"),
                        "run_as_active": bool(u) and u.get("active") is not False,
                        "access": d.get("access", "read"), "manage_access": bool(d.get("manage_access")), "read_saved_logins": bool(d.get("read_saved_logins")),
                        "status": d.get("status", "active"), "expires_on": d.get("expires_on"), "note": d.get("note", ""), "key_hint": d.get("key_hint"),
                        "created_by_name": d.get("created_by_name"), "created_at": d.get("created_at"), "last_used_at": d.get("last_used_at"),
                        "last_ip": d.get("last_ip"), "calls_24h": counts.get(str(d["_id"]), 0)})
        return out

    def links(request: Request) -> Dict[str, str]:
        b = base_url(request)
        return {"base_url": b, "mcp_url": f"{b}/api/mcp", "openapi_url": f"{b}/api/mcp/openapi.json", "api_url": f"{b}/api"}

    # ── Settings → AI agents ──
    @router.get("/agents/settings")
    async def get_settings(request: Request):
        await admin(request)
        return {**(await settings()), **links(request), "access_levels": [{"key": k, "label": ACCESS_LABEL[k]} for k in ACCESS_LEVELS]}

    @router.put("/agents/settings")
    async def put_settings(body: AgentSettingsBody, request: Request):
        user = await admin(request)
        update = {k: v for k, v in body.model_dump().items() if v is not None}
        before = await settings()
        await db.agent_settings.update_one({"key": "defaults"}, {"$set": update}, upsert=True)
        _settings_cache["value"] = None
        await create_audit_log(user["id"], user["name"], "update", "ai_agent_settings", "defaults", before, update)
        return {**(await settings()), **links(request)}

    @router.get("/agents/users")
    async def agent_user_choices(request: Request):
        await admin(request)
        return [{"id": str(u["_id"]), "name": u["name"], "email": u.get("email"), "role": u.get("role")}
                async for u in db.users.find({"active": {"$ne": False}, "role": {"$in": ["admin", "manager", "staff"]}}, {"name": 1, "email": 1, "role": 1}).sort("name", 1)]

    @router.get("/agents")
    async def list_agents(request: Request):
        await admin(request)
        docs = [d async for d in db.agents.find({}).sort("created_at", -1)]
        return {"agents": await agent_rows(docs), **(await settings()), **links(request)}

    @router.post("/agents")
    async def create_agent(body: AgentBody, request: Request):
        user = await admin(request)
        fields = check_fields({**body.model_dump(), "name": body.name or ""})
        runner = await active_user(body.run_as_user_id or user["id"])
        now = now_utc().isoformat()
        doc = {"name": fields["name"], "kind": "key", "run_as_user_id": str(runner["_id"]), "access": fields.get("access", "read"),
               "manage_access": fields.get("manage_access", False), "read_saved_logins": fields.get("read_saved_logins", False),
               "expires_on": fields.get("expires_on"), "note": fields.get("note", ""), "status": "active",
               "created_by": user["id"], "created_by_name": user["name"], "created_at": now}
        res = await db.agents.insert_one(doc)
        key = await issue(res.inserted_id, "key")
        await db.agents.update_one({"_id": res.inserted_id}, {"$set": {"key_hint": key[-4:]}})
        await create_audit_log(user["id"], user["name"], "create", "ai_agent", str(res.inserted_id), None,
                               {k: doc[k] for k in ("name", "access", "manage_access", "read_saved_logins", "expires_on")} | {"works_as": runner["name"]})
        row = (await agent_rows([{**doc, "_id": res.inserted_id, "key_hint": key[-4:]}]))[0]
        return {"agent": row, "key": key, **links(request)}

    @router.put("/agents/{agent_id}")
    async def update_agent(agent_id: str, body: AgentBody, request: Request):
        user = await admin(request)
        agent = await find_agent(agent_id)
        fields = check_fields(body.model_dump(exclude_unset=True))
        if body.run_as_user_id:
            fields["run_as_user_id"] = str((await active_user(body.run_as_user_id))["_id"])
        if not fields:
            raise HTTPException(status_code=400, detail="Nothing to change")
        fields["updated_at"] = now_utc().isoformat()
        await db.agents.update_one({"_id": agent["_id"]}, {"$set": fields})
        await create_audit_log(user["id"], user["name"], "update", "ai_agent", agent_id, {k: agent.get(k) for k in fields}, fields)
        return (await agent_rows([await db.agents.find_one({"_id": agent["_id"]})]))[0]

    @router.post("/agents/{agent_id}/rotate")
    async def rotate_key(agent_id: str, request: Request):
        user = await admin(request)
        agent = await find_agent(agent_id)
        if agent.get("kind") != "key":
            raise HTTPException(status_code=400, detail="A connector gets its tokens by signing in — remove it and connect again instead")
        await db.agent_tokens.update_many({"agent_id": agent["_id"], "kind": "key"}, {"$set": {"revoked": True}})
        key = await issue(agent["_id"], "key")
        await db.agents.update_one({"_id": agent["_id"]}, {"$set": {"key_hint": key[-4:], "updated_at": now_utc().isoformat()}})
        await create_audit_log(user["id"], user["name"], "rotate_key", "ai_agent", agent_id, None, {"name": agent["name"]})
        return {"key": key, **links(request)}

    @router.delete("/agents/{agent_id}")
    async def delete_agent(agent_id: str, request: Request):
        user = await admin(request)
        agent = await find_agent(agent_id)
        await db.agent_tokens.delete_many({"agent_id": agent["_id"]})
        await db.agents.delete_one({"_id": agent["_id"]})
        await create_audit_log(user["id"], user["name"], "delete", "ai_agent", agent_id, {"name": agent["name"], "kind": agent.get("kind")}, None)
        return {"message": "Agent removed — its keys stop working now"}

    @router.get("/agents/activity")
    async def activity(request: Request, agent_id: Optional[str] = None, errors_only: bool = False, limit: int = 100, before: Optional[str] = None):
        await admin(request)
        q: Dict[str, Any] = {}
        if agent_id:
            q["agent_id"] = agent_id
        if errors_only:
            q["status"] = {"$gte": 400}
        if before:
            q["at"] = {"$lt": before}
        rows = [r async for r in db.agent_activity.find(q, {"_id": 0, "at_dt": 0}).sort("at", -1).limit(max(1, min(limit, 500)))]
        return {"rows": rows, "next_before": rows[-1]["at"] if len(rows) >= max(1, min(limit, 500)) else None}

    async def find_agent(agent_id: str) -> Dict[str, Any]:
        a = await db.agents.find_one({"_id": ObjectId(agent_id)}) if ObjectId.is_valid(agent_id) else None
        if not a:
            raise HTTPException(status_code=404, detail="Agent not found")
        return a

    # ── endpoint index (built from the app's routes once) ──
    def index() -> List[Dict[str, Any]]:
        if "index" in _openapi:
            return _openapi["index"]
        from fastapi.routing import APIRoute
        rows = []
        for r in app_getter().routes:
            if not isinstance(r, APIRoute) or not r.path.startswith("/api/"):
                continue
            for m in sorted((r.methods or set()) - {"HEAD", "OPTIONS"}):
                rows.append({"method": m, "path": r.path, "summary": r.summary or humanize(r.name),
                             "about": first_line(r.description or r.endpoint.__doc__), "area": endpoint_area(m, r.path)})
        _openapi["index"] = rows
        return rows

    def spec() -> Dict[str, Any]:
        if "spec" not in _openapi:
            _openapi["spec"] = app_getter().openapi()
        return _openapi["spec"]

    async def visible(agent_user: Dict[str, Any]) -> List[Dict[str, Any]]:
        agent = agent_user["agent"]
        perms = None if agent_user["role"] == "admin" else await get_permissions(agent_user["role"])
        out = []
        for e in index():
            if refusal(e["path"], e["method"], agent):
                continue
            if perms is not None and access_policy.decide(perms, e["method"], e["path"])[0] is False:
                continue
            out.append(e)
        return out

    async def tool_whoami(u: Dict[str, Any], args: Dict[str, Any], request: Request) -> Dict[str, Any]:
        locs = [ObjectId(x) for x in (u.get("location_ids") or []) if ObjectId.is_valid(str(x))]
        names = [loc.get("name") async for loc in db.locations.find({"_id": {"$in": locs}}, {"name": 1})] if locs else []
        a = u["agent"]
        return {"agent": a["name"], "works_as": {"name": a["works_as"], "email": u.get("email"), "role": u["role"],
                                                 "branches": names or ("all branches" if u["role"] == "admin" else "none set")},
                "access": ACCESS_LABEL[a["access"]], "can_manage_logins": a["manage_access"], "can_read_saved_passwords": a["read_saved_logins"],
                "today_ist": today_ist(), "api_base": f"{base_url(request)}/api"}

    async def tool_app_map(u: Dict[str, Any], args: Dict[str, Any], request: Request) -> Dict[str, Any]:
        eps = await visible(u)
        counts: Dict[str, int] = {}
        for e in eps:
            counts[e["area"]] = counts.get(e["area"], 0) + 1
        perms = None if u["role"] == "admin" else await get_permissions(u["role"])
        access = u["agent"]["access"]
        sections = []
        for s in access_policy.SECTIONS:
            pages = []
            for p in s["pages"]:
                row = {a: True for a in p["actions"]} if perms is None else {a: bool((perms.get(p["key"]) or {}).get(a)) for a in p["actions"]}
                if not row.get("view") or p["key"] == "module_agents":
                    continue
                can = [a for a, ok in row.items() if ok and method_allowed(access, {"view": "GET", "create": "POST", "edit": "PUT", "delete": "DELETE", "export": "GET"}[a])]
                pages.append({"area": p["key"], "name": p["label"], "what": p["what"], "agent_can": can, "endpoints": counts.get(p["key"], 0)})
            if pages:
                sections.append({"section": s["label"], "areas": pages})
        shared = sorted(({"area": k, "name": area_label(k), "endpoints": n} for k, n in counts.items() if k.startswith("api:")), key=lambda r: -r["endpoints"])
        return {"sections": sections, "shared_lookups": shared, "total_endpoints": len(eps),
                "next": "list_endpoints(area=…) or list_endpoints(query=…), then describe_endpoint and call_api"}

    async def tool_list(u: Dict[str, Any], args: Dict[str, Any], request: Request) -> Dict[str, Any]:
        eps = await visible(u)
        words = [w for w in re.split(r"\W+", (args.get("query") or "").lower()) if w]
        area, method = (args.get("area") or "").strip(), (args.get("method") or "").upper()
        limit = max(1, min(int(args.get("limit") or 80), 300))
        hits = []
        for e in eps:
            if area and e["area"] != area and area_label(e["area"]).lower() != area.lower():
                continue
            if method and e["method"] != method:
                continue
            hay = f"{e['path']} {e['summary']} {e['about']} {area_label(e['area'])}".lower()
            if words and not all(w in hay or w.rstrip("s") in hay for w in words):
                continue
            hits.append(e)
        hits.sort(key=lambda e: (e["path"], CALL_METHODS.index(e["method"]) if e["method"] in CALL_METHODS else 9))
        return {"total": len(hits), "endpoints": [{"method": e["method"], "path": e["path"], "summary": e["summary"], "area": area_label(e["area"]),
                                                    **({"about": e["about"][:200]} if e["about"] else {})} for e in hits[:limit]],
                **({"note": f"{len(hits) - limit} more — narrow the query"} if len(hits) > limit else {})}

    async def tool_describe(u: Dict[str, Any], args: Dict[str, Any], request: Request) -> Dict[str, Any]:
        method, path = (args.get("method") or "GET").upper(), (args.get("path") or "").split("?")[0]
        if not path.startswith("/api/"):
            path = "/api/" + path.lstrip("/")
        e = next((x for x in index() if x["method"] == method and x["path"] == path), None)
        if not e:
            raise ValueError(f"No endpoint {method} {path}. Use list_endpoints to find it (paths look like /api/vendors/{{vendor_id}}).")
        why = refusal(path, method, u["agent"])
        sp = spec()
        op = ((sp.get("paths") or {}).get(path) or {}).get(method.lower()) or {}
        comps = (sp.get("components") or {}).get("schemas") or {}
        params = {"path": [], "query": []}
        for prm in op.get("parameters") or []:
            where = prm.get("in")
            if where in params:
                params[where].append({"name": prm.get("name"), "required": bool(prm.get("required")),
                                      "schema": compact_schema(prm.get("schema") or {}, comps), **({"description": prm["description"]} if prm.get("description") else {})})
        body = None
        content = (op.get("requestBody") or {}).get("content") or {}
        if "application/json" in content:
            body = compact_schema(content["application/json"].get("schema") or {}, comps)
        elif content:
            body = {"note": f"This endpoint takes {', '.join(content)} (a file upload) — not available through call_api"}
        return {"method": method, "path": path, "summary": e["summary"], "about": e["about"], "area": area_label(e["area"]),
                "path_parameters": params["path"], "query_parameters": params["query"], "body": body,
                **({"agent_may_not_call": why} if why else {})}

    async def tool_call(u: Dict[str, Any], args: Dict[str, Any], request: Request, token: str) -> Dict[str, Any]:
        import httpx
        method = (args.get("method") or "GET").upper()
        if method not in CALL_METHODS:
            raise ValueError("method must be GET, POST, PUT, PATCH or DELETE")
        path = (args.get("path") or "").strip()
        if "://" in path or ".." in path or "#" in path:
            raise ValueError("Give only the path, e.g. /api/vendors")
        if "?" in path:
            raise ValueError("Put query parameters in 'query', not in the path")
        if not path.startswith("/api/"):
            path = "/api/" + path.lstrip("/")
        if "{" in path:
            raise ValueError("Fill in the path parameters, e.g. /api/vendors/66ab12… instead of /api/vendors/{vendor_id}")
        why = refusal(path, method, u["agent"])
        if why:
            return {"status": 403, "ok": False, "error": why}
        query = args.get("query") or {}
        if not isinstance(query, dict):
            raise ValueError("query must be an object of name: value")
        query = {k: (json.dumps(v) if isinstance(v, (dict,)) else v) for k, v in query.items() if v is not None}
        b = base_url(request)
        headers = {"authorization": f"Bearer {token}", "x-sensoper-via": "mcp", "x-forwarded-for": client_ip(request),
                   "x-forwarded-proto": b.split("://")[0], "accept": "application/json"}
        kwargs: Dict[str, Any] = {"params": query, "headers": headers}
        if method in ("POST", "PUT", "PATCH") and "body" in args:
            kwargs["json"] = args["body"]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_getter()), base_url=b, timeout=120) as c:
            try:
                r = await c.request(method, path, **kwargs)
            except Exception as exc:  # noqa: BLE001 — report it to the agent instead of failing the MCP call
                return {"status": 500, "ok": False, "error": f"The server failed on this call: {type(exc).__name__}"}
        ctype = r.headers.get("content-type", "")
        if "json" in ctype:
            try:
                data = r.json()
            except ValueError:
                data = r.text[:2000]
        elif ctype.startswith("text/"):
            data = r.text
        else:
            data = {"file": ctype or "binary", "bytes": len(r.content),
                    "note": "This endpoint returns a file. Download it with the REST API directly (same key, Authorization: Bearer …)."}
        out = {"status": r.status_code, "ok": r.status_code < 400}
        if r.status_code >= 400:
            out["error"] = data.get("detail", data) if isinstance(data, dict) else data
        else:
            out["data"] = data
        return out

    HANDLERS = {"whoami": tool_whoami, "app_map": tool_app_map, "list_endpoints": tool_list, "describe_endpoint": tool_describe}

    # ── MCP server ──
    def unauthorized(request: Request, detail: str, error: str = "invalid_token") -> JSONResponse:
        meta = f"{base_url(request)}/api/.well-known/oauth-protected-resource"
        plain = header_text(detail)
        return JSONResponse({"error": error, "error_description": detail}, status_code=401,
                            headers={"WWW-Authenticate": f'Bearer error="{error}", error_description="{plain}", resource_metadata="{meta}", scope="{SCOPE}"'})

    def rpc_error(mid: Any, code: int, message: str) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}

    async def log_tool(u: Dict[str, Any], name: str, ok: bool, request: Request, started: float) -> None:
        at = now_utc()
        await db.agent_activity.insert_one({"agent_id": u["agent"]["id"], "agent_name": u["agent"]["name"], "at": at.isoformat(), "at_dt": at,
                                            "method": "TOOL", "path": name, "status": 200 if ok else 400,
                                            "ms": int((time.monotonic() - started) * 1000), "via": "mcp", "ip": client_ip(request)})

    async def handle(msg: Dict[str, Any], u: Dict[str, Any], request: Request, token: str) -> Dict[str, Any]:
        mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
        if method == "initialize":
            asked = params.get("protocolVersion")
            a = u["agent"]
            return {"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": asked if asked in PROTOCOLS else PROTOCOLS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "sensoper", "title": "Sensoper", "version": "1.0.0"},
                "instructions": INSTRUCTIONS + f"\nThis connection: agent “{a['name']}”, works as {a['works_as']} ({u['role']}), access: {ACCESS_LABEL[a['access']]}."}}
        if method == "ping":
            return {"jsonrpc": "2.0", "id": mid, "result": {}}
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
        if method == "resources/list":
            return {"jsonrpc": "2.0", "id": mid, "result": {"resources": []}}
        if method == "resources/templates/list":
            return {"jsonrpc": "2.0", "id": mid, "result": {"resourceTemplates": []}}
        if method == "prompts/list":
            return {"jsonrpc": "2.0", "id": mid, "result": {"prompts": []}}
        if method == "logging/setLevel":
            return {"jsonrpc": "2.0", "id": mid, "result": {}}
        if method == "tools/call":
            name, args = params.get("name"), params.get("arguments") or {}
            if name != "call_api" and name not in HANDLERS:
                return rpc_error(mid, -32602, f"Unknown tool: {name}")
            if not isinstance(args, dict):
                return rpc_error(mid, -32602, "arguments must be an object")
            started = time.monotonic()
            try:
                result = await (tool_call(u, args, request, token) if name == "call_api" else HANDLERS[name](u, args, request))
                is_error = name == "call_api" and not result.get("ok")
            except (ValueError, TypeError) as exc:
                result, is_error = {"error": str(exc)}, True
            if name != "call_api":
                await log_tool(u, name, not is_error, request, started)
            return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": fit(result)}], "isError": is_error}}
        return rpc_error(mid, -32601, f"Method not found: {method}")

    @router.post("/mcp")
    async def mcp(request: Request):
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            return unauthorized(request, "Sign in: send this agent's key as Authorization: Bearer <key>, or connect with OAuth", "invalid_request")
        token = auth[7:].strip()
        if not token.startswith(PREFIX):
            return unauthorized(request, "That is not a Sensoper AI agent key")
        try:
            u = await authenticate(request, token, check_route=False)
        except HTTPException as exc:
            if exc.status_code == 401:
                return unauthorized(request, exc.detail)
            return JSONResponse(rpc_error(None, -32000, exc.detail), status_code=exc.status_code)
        try:
            payload = await request.json()
        except ValueError:
            return JSONResponse(rpc_error(None, -32700, "Parse error"), status_code=400)
        batch = isinstance(payload, list)
        replies = []
        for msg in (payload if batch else [payload]):
            if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
                replies.append(rpc_error(None, -32600, "Invalid request"))
                continue
            if "method" not in msg or "id" not in msg:      # notifications and client responses need no answer
                continue
            replies.append(await handle(msg, u, request, token))
        if not replies:
            return Response(status_code=202)
        return JSONResponse(replies if batch else replies[0])

    @router.get("/mcp")
    async def mcp_get():
        return Response(status_code=405, headers={"Allow": "POST"})

    @router.delete("/mcp")
    async def mcp_delete():
        return Response(status_code=405, headers={"Allow": "POST"})

    @router.get("/mcp/openapi.json")
    async def agent_openapi(request: Request):
        """The API description for agents that use REST directly (n8n, custom GPT actions, scripts)."""
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer " + PREFIX):
            u = await authenticate(request, auth[7:].strip(), check_route=False)
            allowed = {(e["method"].lower(), e["path"]) for e in await visible(u)}
        else:
            await admin(request)
            allowed = None
        sp = json.loads(json.dumps(spec(), default=str))
        paths = {}
        for path, ops in (sp.get("paths") or {}).items():
            if not path.startswith("/api/"):
                continue
            keep = {m: op for m, op in ops.items() if (allowed is None and refusal(path, m, {"access": "full", "manage_access": True, "read_saved_logins": True}) is None)
                    or (allowed is not None and (m, path) in allowed)}
            if keep:
                paths[path] = keep
        sp["paths"] = paths
        sp["servers"] = [{"url": base_url(request)}]
        sp["components"] = {**(sp.get("components") or {}), "securitySchemes": {"agentKey": {"type": "http", "scheme": "bearer", "description": "A Sensoper AI agent key (Settings → AI agents)"}}}
        sp["security"] = [{"agentKey": []}]
        sp.setdefault("info", {})["description"] = INSTRUCTIONS
        return JSONResponse(sp)

    # ── OAuth 2.1 for Claude / ChatGPT connectors ──
    def prm(request: Request) -> Dict[str, Any]:
        b = base_url(request)
        return {"resource": f"{b}/api/mcp", "authorization_servers": [f"{b}/api"], "scopes_supported": [SCOPE],
                "bearer_methods_supported": ["header"], "resource_name": "Sensoper", "resource_documentation": f"{b}/dashboard/ai-agents"}

    def asm(request: Request) -> Dict[str, Any]:
        b = base_url(request)
        return {"issuer": f"{b}/api", "authorization_endpoint": f"{b}/api/oauth/authorize", "token_endpoint": f"{b}/api/oauth/token",
                "registration_endpoint": f"{b}/api/oauth/register", "revocation_endpoint": f"{b}/api/oauth/revoke",
                "response_types_supported": ["code"], "response_modes_supported": ["query"], "grant_types_supported": ["authorization_code", "refresh_token"],
                "code_challenge_methods_supported": ["S256"], "token_endpoint_auth_methods_supported": ["none"],
                "revocation_endpoint_auth_methods_supported": ["none"], "scopes_supported": [SCOPE], "service_documentation": f"{b}/dashboard/ai-agents"}

    async def prm_route(request: Request):
        return JSONResponse(prm(request))

    async def asm_route(request: Request):
        return JSONResponse(asm(request))

    for p in ("/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/mcp/.well-known/oauth-protected-resource"):
        router.add_api_route(p, prm_route, methods=["GET"], include_in_schema=False)
    for p in ("/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"):
        router.add_api_route(p, asm_route, methods=["GET"], include_in_schema=False)
    for p in ("/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"):
        root.add_api_route(p, prm_route, methods=["GET"], include_in_schema=False)
    for p in ("/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/api", "/.well-known/openid-configuration/api"):
        root.add_api_route(p, asm_route, methods=["GET"], include_in_schema=False)

    def oauth_error(error: str, detail: str, status: int = 400) -> JSONResponse:
        return JSONResponse({"error": error, "error_description": detail}, status_code=status, headers={"Cache-Control": "no-store"})

    def error_page(title: str, text: str, status: int = 400) -> HTMLResponse:
        safe = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")  # noqa: E731
        return HTMLResponse(f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                            f"<title>Sensoper</title><body style='font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#0f172a'>"
                            f"<h1 style='font-size:1.25rem'>{safe(title)}</h1><p style='color:#475569'>{safe(text)}</p></body>", status_code=status)

    @router.post("/oauth/register", include_in_schema=False)
    async def oauth_register(request: Request):
        st = await settings()
        if not (st["enabled"] and st["allow_connectors"]):
            return oauth_error("invalid_client_metadata", "AI agent connections are switched off in Sensoper (Settings → AI agents)")
        try:
            body = await request.json()
        except ValueError:
            return oauth_error("invalid_client_metadata", "Send the client details as JSON")
        uris = body.get("redirect_uris") if isinstance(body, dict) else None
        if not isinstance(uris, list) or not uris or len(uris) > 10 or not all(isinstance(u, str) and redirect_uri_ok(u) for u in uris):
            return oauth_error("invalid_redirect_uri", "redirect_uris must be 1–10 https addresses (or http://localhost for local apps)")
        name = " ".join(str(body.get("client_name") or "AI app").split())[:80]
        cutoff = (now_utc() - timedelta(days=7)).isoformat()
        await db.oauth_clients.delete_many({"used": {"$ne": True}, "created_at": {"$lt": cutoff}})
        client_id = "snpc_" + secrets.token_urlsafe(18)
        issued = int(time.time())
        await db.oauth_clients.insert_one({"client_id": client_id, "client_name": name, "redirect_uris": uris, "created_at": now_utc().isoformat(), "used": False})
        return JSONResponse({"client_id": client_id, "client_id_issued_at": issued, "client_name": name, "redirect_uris": uris,
                             "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
                             "token_endpoint_auth_method": "none", "scope": SCOPE}, status_code=201)

    @router.get("/oauth/authorize", include_in_schema=False)
    async def oauth_authorize(request: Request):
        q = request.query_params
        client = await db.oauth_clients.find_one({"client_id": q.get("client_id") or ""})
        if not client:
            return error_page("This app isn't registered", "Start the connection again from the AI app (remove the connector and add it again).")
        redirect_uri = q.get("redirect_uri") or (client["redirect_uris"][0] if len(client["redirect_uris"]) == 1 else "")
        if redirect_uri not in client["redirect_uris"]:
            return error_page("Wrong return address", "The AI app asked to come back to an address it didn't register. Start the connection again.")
        state = q.get("state")
        # Problems show a page here instead of bouncing to the app's address: anyone can register an app, so an
        # automatic redirect would let this site be used to send people elsewhere. Only an admin's decision redirects.
        if q.get("response_type") != "code":
            return error_page("This app asked in a way Sensoper doesn't support", "Only the authorization code flow is supported.")
        if not q.get("code_challenge") or q.get("code_challenge_method") != "S256":
            return error_page("This app's sign-in isn't secure enough", "Sensoper needs PKCE (S256). Update the AI app or use an agent key instead.")
        st = await settings()
        if not (st["enabled"] and st["allow_connectors"]):
            return error_page("AI agent connections are switched off", "An admin can switch them on in Sensoper → Settings → AI agents, then connect again.", 403)
        rid = secrets.token_urlsafe(24)
        exp = now_utc() + timedelta(seconds=REQUEST_SECONDS)
        await db.oauth_requests.insert_one({"_id": rid, "client_id": client["client_id"], "client_name": client["client_name"], "redirect_uri": redirect_uri,
                                            "state": state, "code_challenge": q["code_challenge"], "scope": q.get("scope") or SCOPE,
                                            "resource": q.get("resource"), "created_at": now_utc().isoformat(), "expires_at": exp.isoformat(),
                                            "expires_dt": exp, "status": "waiting"})
        return RedirectResponse(f"{base_url(request)}/connect-agent?request={rid}", status_code=302)

    async def pending(rid: str) -> Dict[str, Any]:
        r = await db.oauth_requests.find_one({"_id": rid})
        if not r or r.get("status") != "waiting":
            raise HTTPException(status_code=404, detail="This connection request was already used or doesn't exist. Start again from the AI app.")
        if r["expires_at"] < now_utc().isoformat():
            raise HTTPException(status_code=410, detail="This connection request has expired. Start again from the AI app.")
        return r

    @router.get("/oauth/requests/{rid}")
    async def oauth_request(rid: str, request: Request):
        user = await admin(request)
        r = await pending(rid)
        host = urlparse(r["redirect_uri"]).hostname or urlparse(r["redirect_uri"]).scheme
        return {"id": rid, "client_name": r["client_name"], "return_host": host, "known_app": known_app(r["redirect_uri"]),
                "expires_at": r["expires_at"], "me": {"id": user["id"], "name": user["name"]}, **(await settings())}

    @router.post("/oauth/requests/{rid}/approve")
    async def oauth_approve(rid: str, body: ApproveBody, request: Request):
        user = await admin(request)
        r = await pending(rid)
        st = await settings()
        if not (st["enabled"] and st["allow_connectors"]):
            raise HTTPException(status_code=400, detail="Switch on AI agents and connectors in Settings → AI agents first")
        fields = check_fields({"name": body.name or r["client_name"], "access": body.access,
                               "manage_access": body.manage_access, "read_saved_logins": body.read_saved_logins})
        runner = await active_user(body.run_as_user_id or user["id"])
        now = now_utc().isoformat()
        doc = {"name": fields["name"], "kind": "connector", "client_id": r["client_id"], "client_name": r["client_name"],
               "run_as_user_id": str(runner["_id"]), "access": fields["access"], "manage_access": fields["manage_access"],
               "read_saved_logins": fields["read_saved_logins"], "expires_on": None, "note": "", "status": "active",
               "created_by": user["id"], "created_by_name": user["name"], "created_at": now}
        res = await db.agents.insert_one(doc)
        code = secrets.token_urlsafe(32)
        exp = now_utc() + timedelta(seconds=CODE_SECONDS)
        await db.oauth_codes.insert_one({"hash": token_hash(code), "agent_id": res.inserted_id, "client_id": r["client_id"], "redirect_uri": r["redirect_uri"],
                                         "code_challenge": r["code_challenge"], "expires_at": exp.isoformat(), "expires_dt": exp, "used": False})
        await db.oauth_requests.update_one({"_id": rid}, {"$set": {"status": "approved", "agent_id": res.inserted_id}})
        await db.oauth_clients.update_one({"client_id": r["client_id"]}, {"$set": {"used": True}})
        await create_audit_log(user["id"], user["name"], "connect", "ai_agent", str(res.inserted_id), None,
                               {"name": doc["name"], "app": r["client_name"], "access": doc["access"], "works_as": runner["name"]})
        return {"redirect": with_query(r["redirect_uri"], {"code": code, "state": r.get("state"), "iss": f"{base_url(request)}/api"})}

    @router.post("/oauth/requests/{rid}/deny")
    async def oauth_deny(rid: str, request: Request):
        await admin(request)
        r = await pending(rid)
        await db.oauth_requests.update_one({"_id": rid}, {"$set": {"status": "denied"}})
        return {"redirect": with_query(r["redirect_uri"], {"error": "access_denied", "error_description": "An admin said no", "state": r.get("state")})}

    async def form_or_json(request: Request) -> Dict[str, Any]:
        if "application/json" in (request.headers.get("content-type") or ""):
            try:
                body = await request.json()
                return body if isinstance(body, dict) else {}
            except ValueError:
                return {}
        return dict(await request.form())

    async def token_pair(agent_id: ObjectId) -> JSONResponse:
        access = await issue(agent_id, "access", ACCESS_TOKEN_SECONDS)
        refresh = await issue(agent_id, "refresh", REFRESH_TOKEN_DAYS * 86400)
        return JSONResponse({"access_token": access, "token_type": "Bearer", "expires_in": ACCESS_TOKEN_SECONDS,
                             "refresh_token": refresh, "scope": SCOPE}, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})

    @router.post("/oauth/token", include_in_schema=False)
    async def oauth_token(request: Request):
        f = await form_or_json(request)
        grant = f.get("grant_type")
        if grant == "authorization_code":
            c = await db.oauth_codes.find_one_and_update({"hash": token_hash(str(f.get("code") or "")), "used": False}, {"$set": {"used": True}})
            if not c or c["expires_at"] < now_utc().isoformat():
                return oauth_error("invalid_grant", "The sign-in code is wrong, used or expired")
            if f.get("client_id") and f["client_id"] != c["client_id"]:
                return oauth_error("invalid_grant", "This code was given to another app")
            if (f.get("redirect_uri") or c["redirect_uri"]) != c["redirect_uri"]:
                return oauth_error("invalid_grant", "redirect_uri doesn't match")
            if not pkce_ok(str(f.get("code_verifier") or ""), c["code_challenge"]):
                return oauth_error("invalid_grant", "PKCE check failed")
            if not await db.agents.find_one({"_id": c["agent_id"]}):
                return oauth_error("invalid_grant", "This connection was removed")
            return await token_pair(c["agent_id"])
        if grant == "refresh_token":
            t = await db.agent_tokens.find_one({"hash": token_hash(str(f.get("refresh_token") or "")), "kind": "refresh", "revoked": False})
            if not t or (t.get("expires_at") and t["expires_at"] < now_utc().isoformat()):
                return oauth_error("invalid_grant", "Sign in again — this connection's refresh token is no longer valid")
            agent = await db.agents.find_one({"_id": t["agent_id"]})
            if not agent or (f.get("client_id") and agent.get("client_id") and f["client_id"] != agent["client_id"]):
                return oauth_error("invalid_grant", "This connection was removed")
            await db.agent_tokens.update_one({"_id": t["_id"]}, {"$set": {"revoked": True}})
            return await token_pair(agent["_id"])
        return oauth_error("unsupported_grant_type", "Use authorization_code or refresh_token")

    @router.post("/oauth/revoke", include_in_schema=False)
    async def oauth_revoke(request: Request):
        f = await form_or_json(request)
        tok = str(f.get("token") or "")
        if tok.startswith(PREFIX):
            await db.agent_tokens.update_one({"hash": token_hash(tok), "kind": {"$in": ["access", "refresh"]}}, {"$set": {"revoked": True}})
        return Response(status_code=200)

    async def ensure_indexes() -> None:
        await db.agent_tokens.create_index("hash", unique=True)
        await db.agent_tokens.create_index("agent_id")
        await db.agent_tokens.create_index("expires_dt", expireAfterSeconds=0)
        await db.agent_activity.create_index([("agent_id", 1), ("at", -1)])
        await db.agent_activity.create_index("at")
        await db.agent_activity.create_index("at_dt", expireAfterSeconds=ACTIVITY_DAYS * 86400)
        await db.oauth_clients.create_index("client_id", unique=True)
        await db.oauth_codes.create_index("hash", unique=True)
        await db.oauth_codes.create_index("expires_dt", expireAfterSeconds=3600)
        await db.oauth_requests.create_index("expires_dt", expireAfterSeconds=3600)

    router.ensure_indexes = ensure_indexes
    return router
