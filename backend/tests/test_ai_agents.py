"""Nov 2026: AI agents (API keys, permissions, MCP server, OAuth connectors, activity) and POs picked from Vendors.
In-process, no MongoDB server:
    cd backend && pytest tests/test_ai_agents.py
"""
import asyncio
import base64
import hashlib
import json
import os
import sys
from urllib.parse import parse_qs, urlparse

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mongomock_motor = pytest.importorskip("mongomock_motor")
httpx = pytest.importorskip("httpx")

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "ai_agents_test")
os.environ.setdefault("JWT_SECRET", "t" * 48)
os.environ.setdefault("ADMIN_EMAIL", "boss@example.com")
os.environ.setdefault("ADMIN_PASSWORD", "Adm1n-pass-123")
os.environ.setdefault("STORAGE_ROOT", "/tmp/sensoper-ai-agents-test")
ADMIN = {"email": os.environ["ADMIN_EMAIL"], "password": os.environ["ADMIN_PASSWORD"]}

import motor.motor_asyncio as _m  # noqa: E402
_m.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient
import agents  # noqa: E402
import server  # noqa: E402

PW = "Passw0rd!x"
BASE = "https://quote.example.in"


# ───────────── pure helpers ─────────────
def test_pure_helpers():
    full = {"access": "full"}
    assert agents.refusal("/api/agents", "GET", full) and agents.refusal("/api/oauth/requests/x", "GET", full)
    assert agents.refusal("/api/auth/me", "GET", full) is None and agents.refusal("/api/auth/change-password", "POST", full)
    assert agents.refusal("/api/users", "GET", full) is None
    assert agents.refusal("/api/users/1", "PUT", full) and agents.refusal("/api/users/1", "PUT", {**full, "manage_access": True}) is None
    assert agents.refusal("/api/security/credentials", "GET", full) and agents.refusal("/api/permissions/staff", "PUT", full)
    assert agents.refusal("/api/vault/abc/reveal", "POST", full) and agents.refusal("/api/vault/abc/reveal", "POST", {**full, "read_saved_logins": True}) is None
    assert agents.refusal("/api/vendors", "POST", {"access": "read"}) and agents.refusal("/api/vendors", "GET", {"access": "read"}) is None
    assert agents.refusal("/api/vendors/1", "DELETE", {"access": "write"}) and agents.refusal("/api/vendors/1", "DELETE", full) is None
    verifier = "v" * 50
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    assert agents.pkce_ok(verifier, challenge) and not agents.pkce_ok("w" * 50, challenge) and not agents.pkce_ok("short", challenge)
    assert agents.redirect_uri_ok("https://claude.ai/api/mcp/auth_callback") and agents.redirect_uri_ok("http://localhost:6274/callback")
    assert not agents.redirect_uri_ok("http://evil.example/cb") and not agents.redirect_uri_ok("javascript:alert(1)")
    assert not agents.redirect_uri_ok("https://x.example/cb#frag") and agents.redirect_uri_ok("cursor://anysphere.cursor-mcp/oauth/callback")
    assert agents.known_app("https://claude.ai/api/mcp/auth_callback") and not agents.known_app("https://claude.ai.evil.example/cb")
    big = {"status": 200, "ok": True, "data": [{"n": i, "text": "x" * 500} for i in range(1000)]}
    out = json.loads(agents.fit(big, 20_000))
    assert len(json.dumps(out)) <= 20_000 and 0 < len(out["data"]) < 1000 and "Showing the first" in out["note"]
    comps = {"M": {"type": "object", "properties": {"a": {"type": "string"}, "b": {"anyOf": [{"type": "integer"}, {"type": "null"}], "default": None}}, "required": ["a"]}}
    assert agents.compact_schema({"$ref": "#/components/schemas/M"}, comps) == {
        "type": "object", "properties": {"a": {"type": "string"}, "b": {"type": "integer", "nullable": True, "default": None}}, "required": ["a"]}
    assert agents.endpoint_area("POST", "/api/vendors") == "module_vendors"
    assert agents.header_text("Settings → AI agents — “on”") == "Settings -> AI agents - 'on'"


# ───────────── API ─────────────
@pytest.fixture(scope="module")
def loop():
    lp = asyncio.new_event_loop()
    yield lp
    lp.close()


@pytest.fixture(scope="module")
def app(loop):
    loop.run_until_complete(server.app.router.startup())
    return server.app


def run(loop, coro):
    return loop.run_until_complete(coro)


def client(app, token=None):
    headers = {"x-forwarded-proto": "https", "host": "quote.example.in"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=BASE, headers=headers)


async def login(app, email, password):
    c = client(app)
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


async def rpc(c, method, params=None, mid=1):
    r = await c.post("/api/mcp", json={"jsonrpc": "2.0", "id": mid, "method": method, **({"params": params} if params is not None else {})})
    assert r.status_code == 200, r.text
    return r.json()


def tool_json(reply):
    return json.loads(reply["result"]["content"][0]["text"])


@pytest.fixture(scope="module")
def world(app, loop):
    async def go():
        a = await login(app, ADMIN["email"], ADMIN["password"])
        ids = {}
        for email, name, role in (("mgr9@example.com", "Mani Manager", "manager"), ("staff9@example.com", "Selvi Staff", "staff")):
            r = await a.post("/api/users", json={"email": email, "password": PW, "name": name, "role": role, "phone": "98765430" + str(len(ids)).zfill(2)})
            assert r.status_code == 200, r.text
            ids[role] = str((await server.db.users.find_one({"email": email}))["_id"])
        v = (await a.post("/api/vendors", json={"name": "Kongu Solar Traders", "phone": "9443300011", "contact_person": "Ravi", "category": "panels"})).json()
        bad = (await a.post("/api/vendors", json={"name": "Late Lines", "blocked": True, "blocked_reason": "Missed three deliveries"})).json()
        return {"admin": a, "ids": ids, "vendor": v["id"], "blocked": bad["id"]}

    async def tidy():   # other test files share this in-memory database
        db = server.db
        names = ["Kongu Solar Traders", "Late Lines", "Bot Vendor", "MCP Vendor", "Nope", "X"]
        vids = [str(v["_id"]) async for v in db.vendors.find({"name": {"$in": names}})]
        await db.purchase_orders.delete_many({"vendor_id": {"$in": vids}})
        await db.vendors.delete_many({"name": {"$in": names}})
        await db.users.delete_many({"email": {"$in": ["mgr9@example.com", "staff9@example.com"]}})
        for col in ("agents", "agent_tokens", "agent_activity", "agent_settings", "oauth_clients", "oauth_codes", "oauth_requests"):
            await db[col].delete_many({})

    yield run(loop, go())
    run(loop, tidy())


def test_po_vendor_comes_from_the_list(app, loop, world):
    async def go():
        a = world["admin"]
        item = {"items": [{"name": "MC4 connectors", "qty": 10, "unit_price": 40}], "skip_reason": "Emergency repair"}
        r = await a.post("/api/purchase-orders", json={**item, "vendor_id": world["vendor"], "supplier_name": "typed text is ignored"})
        assert r.status_code == 200, r.text
        po = await server.db.purchase_orders.find_one({"po_number": r.json()["po_number"]})
        assert po["supplier_name"] == "Kongu Solar Traders" and po["vendor_id"] == world["vendor"] and "9443300011" in po["supplier_contact"]
        assert (await a.post("/api/purchase-orders", json={**item, "vendor_id": world["blocked"]})).json()["detail"].startswith("Late Lines is blocked")
        assert "Pick the vendor" in (await a.post("/api/purchase-orders", json={**item, "supplier_name": "Someone New"})).json()["detail"]
        assert (await a.post("/api/purchase-orders", json={**item, "vendor_id": "nope"})).status_code == 400
        r = await a.post("/api/purchase-orders", json={**item, "supplier_name": "kongu solar traders"})     # older callers: exact name
        assert r.status_code == 200 and (await server.db.purchase_orders.find_one({"po_number": r.json()["po_number"]}))["vendor_id"] == world["vendor"]
    run(loop, go())


def test_agent_keys_access_levels_and_activity(app, loop, world):
    async def go():
        a, ids = world["admin"], world["ids"]
        m = await login(app, "mgr9@example.com", PW)
        assert (await m.get("/api/agents")).status_code == 403                        # admins only
        r = await a.post("/api/agents", json={"name": "Stock checker", "access": "read"})
        assert r.status_code == 200, r.text
        reader, key = r.json()["agent"], r.json()["key"]
        assert key.startswith("snp_key_") and reader["key_hint"] == key[-4:] and reader["run_as_role"] == "admin"
        assert (await server.db.agent_tokens.find_one({"agent_id": server.ObjectId(reader["id"])}))["hash"] != key   # only the hash is kept
        c = client(app, key)
        r = await c.get("/api/vendors")
        assert r.status_code == 401 and "switched off" in r.json()["detail"]          # off until an admin switches it on
        assert (await a.put("/api/agents/settings", json={"enabled": True})).json()["enabled"] is True
        assert (await c.get("/api/vendors")).status_code == 200
        me = (await c.get("/api/auth/me")).json()
        assert me["name"] == "Stock checker (AI agent)" and me["agent"]["works_as"] and me["agent"]["access"] == "read"
        assert "read-only" in (await c.post("/api/vendors", json={"name": "Nope"})).json()["detail"]
        assert (await c.get("/api/agents")).status_code == 403                        # agents never manage agents
        assert (await c.post("/api/auth/change-password", json={"current_password": "x", "new_password": "y" * 10})).status_code == 403
        # read & write: changes are recorded under the agent's name; deleting needs full control
        w = (await a.post("/api/agents", json={"name": "Buyer bot", "access": "write"})).json()
        cw = client(app, w["key"])
        r = await cw.post("/api/vendors", json={"name": "Bot Vendor", "category": "cables"})
        assert r.status_code == 200, r.text
        vid = r.json()["id"]
        log = await server.db.audit_logs.find_one({"entity_type": "vendor", "entity_id": vid})
        assert log["user_name"] == "Buyer bot (AI agent)"
        assert (await cw.delete(f"/api/vendors/{vid}")).status_code == 403
        assert (await cw.put(f"/api/users/{ids['staff']}", json={"name": "Hacked"})).status_code == 403
        assert (await a.put(f"/api/agents/{w['agent']['id']}", json={"access": "full"})).json()["access"] == "full"
        assert (await cw.delete(f"/api/vendors/{vid}")).status_code == 200
        # working as a staff login: that role's permissions apply (loans are admin-only)
        s = (await a.post("/api/agents", json={"name": "Field helper", "access": "full", "run_as_user_id": ids["staff"]})).json()
        cs = client(app, s["key"])
        assert (await cs.get("/api/loans")).status_code == 403
        assert (await cs.get("/api/auth/me")).json()["role"] == "staff"
        # pause, expire, rotate, remove
        aid = reader["id"]
        await a.put(f"/api/agents/{aid}", json={"status": "paused"})
        assert "paused" in (await c.get("/api/vendors")).json()["detail"]
        await a.put(f"/api/agents/{aid}", json={"status": "active"})
        assert (await a.put(f"/api/agents/{aid}", json={"expires_on": "2020-01-01"})).status_code == 400
        new_key = (await a.post(f"/api/agents/{aid}/rotate")).json()["key"]
        assert (await c.get("/api/vendors")).status_code == 401
        assert (await client(app, new_key).get("/api/vendors")).status_code == 200
        # activity: every call with its status
        rows = (await a.get(f"/api/agents/activity?agent_id={w['agent']['id']}")).json()["rows"]
        assert {(r["method"], r["status"]) for r in rows} >= {("POST", 200), ("DELETE", 403), ("DELETE", 200)}
        listed = {x["name"]: x for x in (await a.get("/api/agents")).json()["agents"]}
        assert listed["Buyer bot"]["calls_24h"] >= 4 and listed["Field helper"]["run_as_name"] == "Selvi Staff"
        assert (await a.delete(f"/api/agents/{s['agent']['id']}")).status_code == 200
        assert (await cs.get("/api/auth/me")).status_code == 401
        world["writer_key"], world["reader_key"] = w["key"], new_key
    run(loop, go())


def test_mcp_server(app, loop, world):
    async def go():
        anon = client(app)
        r = await anon.post("/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        assert r.status_code == 401 and "resource_metadata=" in r.headers["www-authenticate"]
        assert (await anon.get("/api/mcp")).status_code == 405
        c = client(app, world["reader_key"])
        init = await rpc(c, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}})
        assert init["result"]["protocolVersion"] == "2025-06-18" and "tools" in init["result"]["capabilities"]
        assert "Stock checker" in init["result"]["instructions"]
        assert (await c.post("/api/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})).status_code == 202
        names = {t["name"] for t in (await rpc(c, "tools/list"))["result"]["tools"]}
        assert names == {"whoami", "app_map", "list_endpoints", "describe_endpoint", "call_api"}
        who = tool_json(await rpc(c, "tools/call", {"name": "whoami", "arguments": {}}))
        assert who["access"] == "Read only" and who["works_as"]["role"] == "admin"
        amap = tool_json(await rpc(c, "tools/call", {"name": "app_map", "arguments": {}}))
        areas = {p["area"] for s in amap["sections"] for p in s["areas"]}
        assert "module_vendors" in areas and "module_agents" not in areas and amap["total_endpoints"] > 100
        found = tool_json(await rpc(c, "tools/call", {"name": "list_endpoints", "arguments": {"query": "vendor scorecard"}}))
        assert any(e["path"] == "/api/vendors/{vendor_id}/scorecard" for e in found["endpoints"])
        assert not tool_json(await rpc(c, "tools/call", {"name": "list_endpoints", "arguments": {"query": "vendor ratings", "method": "POST"}}))["endpoints"]
        assert all(e["method"] == "GET" for e in found["endpoints"])                     # read-only agent sees reads only
        assert not any("/api/agents" in e["path"] for e in tool_json(await rpc(c, "tools/call", {"name": "list_endpoints", "arguments": {"limit": 300}}))["endpoints"])
        d = tool_json(await rpc(c, "tools/call", {"name": "describe_endpoint", "arguments": {"method": "POST", "path": "/api/vendors"}}))
        assert "name" in d["body"]["properties"] and "agent_may_not_call" in d
        got = tool_json(await rpc(c, "tools/call", {"name": "call_api", "arguments": {"method": "GET", "path": "/api/vendors", "query": {"search": "Kongu"}}}))
        assert got["ok"] and [v["name"] for v in got["data"]] == ["Kongu Solar Traders"]
        no = await rpc(c, "tools/call", {"name": "call_api", "arguments": {"method": "POST", "path": "/api/vendors", "body": {"name": "X"}}})
        assert no["result"]["isError"] and "read-only" in tool_json(no)["error"]
        bad = await rpc(c, "tools/call", {"name": "call_api", "arguments": {"method": "GET", "path": "/api/vendors/{vendor_id}"}})
        assert bad["result"]["isError"]
        assert (await rpc(c, "nope/method"))["error"]["code"] == -32601
        # the writer changes data through MCP; the inner call is logged with via=mcp
        cw = client(app, world["writer_key"])
        made = tool_json(await rpc(cw, "tools/call", {"name": "call_api", "arguments": {"method": "POST", "path": "/api/vendors", "body": {"name": "MCP Vendor"}}}))
        assert made["ok"] and made["data"]["name"] == "MCP Vendor"
        assert await server.db.agent_activity.find_one({"path": "/api/vendors", "method": "POST", "via": "mcp"})
        assert await server.db.agent_activity.find_one({"method": "TOOL", "path": "app_map"})
        spec = (await c.get("/api/mcp/openapi.json")).json()
        assert "/api/vendors" in spec["paths"] and "post" not in spec["paths"]["/api/vendors"] and not any(p.startswith("/api/agents") for p in spec["paths"])
    run(loop, go())


def test_oauth_connector_flow(app, loop, world):
    async def go():
        a, anon = world["admin"], client(app)
        meta = (await anon.get("/api/.well-known/oauth-protected-resource")).json()
        assert meta["resource"] == f"{BASE}/api/mcp" and meta["authorization_servers"] == [f"{BASE}/api"]
        asm = (await anon.get("/.well-known/oauth-authorization-server/api")).json()
        assert asm["token_endpoint"] == f"{BASE}/api/oauth/token" and asm["code_challenge_methods_supported"] == ["S256"]
        assert (await anon.get("/api/.well-known/openid-configuration")).json()["issuer"] == f"{BASE}/api"
        assert (await anon.post("/api/oauth/register", json={"redirect_uris": ["http://evil.example/cb"]})).status_code == 400
        reg = await anon.post("/api/oauth/register", json={"client_name": "Claude", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"]})
        assert reg.status_code == 201
        cid = reg.json()["client_id"]
        verifier = "abc" * 20
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        q = {"response_type": "code", "client_id": cid, "redirect_uri": "https://claude.ai/api/mcp/auth_callback", "state": "st8",
             "code_challenge": challenge, "code_challenge_method": "S256", "scope": "sensoper"}
        bad = await anon.get("/api/oauth/authorize", params={**q, "redirect_uri": "https://claude.ai/other"})
        assert bad.status_code == 400 and "text/html" in bad.headers["content-type"]
        nopkce = await anon.get("/api/oauth/authorize", params={**q, "code_challenge_method": "plain"})
        assert nopkce.status_code == 400 and "location" not in nopkce.headers                 # never bounced to the app's address
        r = await anon.get("/api/oauth/authorize", params=q)
        assert r.status_code == 302 and r.headers["location"].startswith(f"{BASE}/connect-agent?request=")
        rid = parse_qs(urlparse(r.headers["location"]).query)["request"][0]
        m = await login(app, "mgr9@example.com", PW)
        assert (await m.get(f"/api/oauth/requests/{rid}")).status_code == 403              # only an admin approves
        info = (await a.get(f"/api/oauth/requests/{rid}")).json()
        assert info["client_name"] == "Claude" and info["known_app"] and info["return_host"] == "claude.ai"
        ok = (await a.post(f"/api/oauth/requests/{rid}/approve", json={"access": "read", "run_as_user_id": world["ids"]["manager"]})).json()
        back = parse_qs(urlparse(ok["redirect"]).query)
        assert ok["redirect"].startswith("https://claude.ai/api/mcp/auth_callback?") and back["state"] == ["st8"]
        assert (await a.post(f"/api/oauth/requests/{rid}/approve", json={"access": "read"})).status_code == 404   # used once
        code = back["code"][0]
        form = {"grant_type": "authorization_code", "code": code, "client_id": cid, "redirect_uri": q["redirect_uri"], "code_verifier": "x" * 60}
        r = await anon.post("/api/oauth/token", data=form)
        assert r.status_code == 400 and r.json()["error"] == "invalid_grant"                  # wrong verifier burns the code
        # a fresh approval, done properly
        r = await anon.get("/api/oauth/authorize", params=q)
        rid = parse_qs(urlparse(r.headers["location"]).query)["request"][0]
        code = parse_qs(urlparse((await a.post(f"/api/oauth/requests/{rid}/approve", json={"access": "write", "name": "Claude for Prathipan"})).json()["redirect"]).query)["code"][0]
        tok = await anon.post("/api/oauth/token", data={**form, "code": code, "code_verifier": verifier})
        assert tok.status_code == 200, tok.text
        t = tok.json()
        assert t["token_type"] == "Bearer" and t["access_token"].startswith("snp_at_") and t["refresh_token"].startswith("snp_rt_")
        assert (await anon.post("/api/oauth/token", data={**form, "code": code, "code_verifier": verifier})).status_code == 400   # codes work once
        cc = client(app, t["access_token"])
        who = tool_json(await rpc(cc, "tools/call", {"name": "whoami", "arguments": {}}))
        assert who["agent"] == "Claude for Prathipan" and who["access"] == "Read & write"
        assert (await client(app, t["refresh_token"]).get("/api/vendors")).status_code == 401  # a refresh token isn't an access token
        r2 = (await anon.post("/api/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": cid})).json()
        assert r2["access_token"] != t["access_token"]
        assert (await anon.post("/api/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": cid})).status_code == 400
        conn = [x for x in (await a.get("/api/agents")).json()["agents"] if x["kind"] == "connector"]
        assert {x["name"] for x in conn} >= {"Claude for Prathipan"} and all(x["client_name"] == "Claude" for x in conn)
        # connectors can be switched off on their own
        await a.put("/api/agents/settings", json={"allow_connectors": False})
        assert (await client(app, r2["access_token"]).post("/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})).status_code == 401
        assert (await client(app, world["reader_key"]).get("/api/vendors")).status_code == 200       # keys still work
        await a.put("/api/agents/settings", json={"allow_connectors": True})
    run(loop, go())
