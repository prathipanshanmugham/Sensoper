"""Odoo → Sensoper sync (one way: nothing in Odoo is ever changed).

What comes in
  * Contacts      res.partner      → customers (Odoo customers) and Vendors (Odoo vendors)
  * Products      product.product  → Inventory items: SKU, HSN, GST, cost and the Price list margin (stock only when created,
                                     unless "keep stock in step with Odoo" is on — Sensoper's own stock moves come first)
  * CRM leads     crm.lead         → Leads, with stage, owner, value and the next activity as the follow-up
  * Quotations    sale.order       → Material quotations, read-only, exactly as Odoo priced them (copy one to quote again)
  * Custom fields any extra Odoo field (Studio x_ fields too) picked per sync, kept with the record under odoo.extra
  * Custom tables any Odoo model and fields, kept in odoo_records and shown on the Odoo data page

How it stays safe
  * Each Sensoper record remembers the Odoo values it last copied. A field is updated from Odoo only while it still
    holds that value — if someone changed it in Sensoper, their change stays ("kept your change" in the run summary).
  * Incremental: each run asks Odoo only for records changed since the last one (write_date).
  * The API key is encrypted with the vault key, never sent back to a browser, never logged.
  * The address must be https and a public host (no internal addresses), so the setting can't be used to probe the server.

The API: Odoo 19's JSON-2 (/json/2/<model>/<method>, bearer key) and, for Odoo 14–18, JSON-RPC (/jsonrpc execute_kw with
database, login and the key as the password). Which one works is found on the first connection test.
"""
from __future__ import annotations

import asyncio
import html as html_lib
import ipaddress
import logging
import os
import re
import socket
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from vault import decrypt_secret, encrypt_secret
from website import mobile

logger = logging.getLogger("sensoper.odoo")
IST = timezone(timedelta(hours=5, minutes=30))
BATCH = 200
LOCK_MINUTES = 45
HOURLY_SECONDS = 3600
TRANSPORT: Optional[httpx.AsyncBaseTransport] = None   # tests plug a fake Odoo in here
UA = "Sensoper-ERP-Odoo-sync/1.0"
MISSING = object()

PRESETS: Dict[str, Dict[str, Any]] = {
    "contacts": {"label": "Contacts", "model": "res.partner", "into": "Customers and Vendors",
                 "what": "Odoo customers become Sensoper customers (picked on quotations); Odoo vendors become Vendors."},
    "products": {"label": "Products & prices", "model": "product.product", "into": "Inventory and the Price list",
                 "what": "Name, SKU, HSN, GST, cost and sale price. Stock is copied when an item is created."},
    "leads": {"label": "CRM leads", "model": "crm.lead", "into": "Leads",
              "what": "Leads and opportunities with their stage, salesperson, value and next activity."},
    "orders": {"label": "Quotations & orders", "model": "sale.order", "into": "Material quotations (read-only)",
               "what": "Odoo quotations and sales orders exactly as Odoo priced them. Copy one to quote again in Sensoper."},
}
WANT = {
    "res.partner": ["name", "display_name", "is_company", "parent_id", "email", "phone", "mobile", "street", "street2", "city", "zip",
                    "state_id", "country_id", "vat", "customer_rank", "supplier_rank", "active", "comment", "category_id", "ref",
                    "website", "write_date", "create_date"],
    "product.product": ["name", "display_name", "default_code", "barcode", "list_price", "lst_price", "standard_price", "categ_id",
                        "l10n_in_hsn_code", "taxes_id", "qty_available", "type", "active", "uom_id", "description_sale",
                        "write_date", "create_date"],
    "crm.lead": ["name", "contact_name", "partner_name", "partner_id", "email_from", "phone", "mobile", "street", "street2", "city", "zip",
                 "state_id", "description", "stage_id", "user_id", "expected_revenue", "probability", "type", "active", "lost_reason_id",
                 "activity_date_deadline", "activity_summary", "source_id", "medium_id", "tag_ids", "priority", "create_date",
                 "write_date", "won_status", "date_closed"],
    "sale.order": ["name", "partner_id", "date_order", "validity_date", "state", "amount_untaxed", "amount_tax", "amount_total",
                   "user_id", "note", "opportunity_id", "client_order_ref", "order_line", "write_date", "create_date"],
    "sale.order.line": ["order_id", "product_id", "name", "product_uom_qty", "product_uom", "product_uom_id", "price_unit", "discount",
                        "tax_id", "tax_ids", "price_subtotal", "price_tax", "price_total", "display_type", "sequence"],
}
ORDER_STATES = {"draft": "draft", "sent": "sent", "sale": "accepted", "done": "accepted", "cancel": "rejected"}
SKIP_TYPES = {"binary", "properties", "properties_definition", "json"}


# ───────────────────────── small helpers ─────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


def _odoo_dt(v: Any) -> Optional[str]:
    """Odoo's '2026-11-20 10:31:05' (UTC) → ISO with a zone."""
    if not v:
        return None
    try:
        return datetime.strptime(str(v)[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        try:
            return datetime.strptime(str(v)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            return None


def _ist_day(v: Any) -> Optional[str]:
    iso = _odoo_dt(v)
    return datetime.fromisoformat(iso).astimezone(IST).date().isoformat() if iso else None


def _m2o(v: Any) -> Optional[str]:
    """A many2one [id, 'Name'] → 'Name'."""
    if isinstance(v, (list, tuple)) and len(v) >= 2:
        return str(v[1])
    if isinstance(v, dict):
        return str(v.get("display_name") or v.get("name") or "") or None
    return None


def _m2o_id(v: Any) -> Optional[int]:
    if isinstance(v, (list, tuple)) and v:
        return int(v[0]) if isinstance(v[0], int) else None
    if isinstance(v, dict) and isinstance(v.get("id"), int):
        return v["id"]
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _text(v: Any, limit: int = 2000) -> str:
    """Plain text from Odoo text or HTML (notes, descriptions)."""
    if v in (None, False):
        return ""
    s = str(v)[: limit * 4]
    s = re.sub(r"<\s*(br|/p|/div|/li)\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<[^<>]*>", " ", s)
    s = html_lib.unescape(s)
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n", s).strip()
    return s[:limit]


def _str(v: Any, limit: int = 200) -> str:
    return "" if v in (None, False) else _text(v, limit)


def _num(v: Any) -> Optional[float]:
    if v in (None, False, ""):
        return None
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def _state_name(v: Any) -> str:
    return re.sub(r"\s*\([A-Z]{2}\)\s*$", "", _m2o(v) or "")


def _slug(s: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", (s or "").lower())).strip("_")[:60] or "other"


def _same(a: Any, b: Any) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        try:
            return abs(float(a or 0) - float(b or 0)) < 0.005 and (a is None) == (b is None)
        except (TypeError, ValueError):
            return False
    return (a if a not in ("", None) else None) == (b if b not in ("", None) else None)


def _display(v: Any, ftype: str = "", selection: Optional[Dict[str, str]] = None) -> Any:
    """An Odoo value as something a person can read in a table."""
    if v is False or v is None:
        return None if ftype != "boolean" else False
    if ftype == "many2one":
        return _m2o(v)
    if ftype in ("many2many", "one2many"):
        return v if isinstance(v, list) and v and isinstance(v[0], str) else (f"{len(v)} linked" if isinstance(v, list) else v)
    if ftype == "selection" and selection:
        return selection.get(str(v), v)
    if ftype == "html":
        return _text(v, 1500)
    if isinstance(v, str):
        return v[:1500]
    return v


# ───────────────────────── safe address ─────────────────────────
def clean_url(raw: str) -> str:
    """https://host[:port] from what was typed. Refuses other schemes, user:password@ and (unless allowed for tests)
    plain http and internal addresses."""
    s = (raw or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="Enter your Odoo address, like https://sensoper.odoo.com")
    if "://" not in s:
        s = "https://" + s
    u = urlparse(s)
    allow_http = os.environ.get("ODOO_ALLOW_HTTP") == "1"
    if u.scheme not in ("https",) + (("http",) if allow_http else ()):
        raise HTTPException(status_code=400, detail="The Odoo address must start with https://")
    if u.username or u.password or not u.hostname:
        raise HTTPException(status_code=400, detail="Enter just the address, like https://sensoper.odoo.com")
    host = u.hostname.lower()
    if not re.match(r"^[a-z0-9.-]+$", host) or host.startswith(".") or ".." in host:
        raise HTTPException(status_code=400, detail="That Odoo address doesn't look right")
    port = f":{u.port}" if u.port else ""
    return f"{u.scheme}://{host}{port}"


async def _check_public(url: str) -> None:
    """The host must resolve to public addresses only — the setting can't point the server at itself or the LAN."""
    if os.environ.get("ODOO_ALLOW_PRIVATE") == "1":
        return
    host = urlparse(url).hostname or ""
    try:
        infos = await asyncio.get_running_loop().run_in_executor(None, lambda: socket.getaddrinfo(host, None))
    except OSError:
        raise OdooError(f"Couldn't find {host}. Check the Odoo address.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise OdooError(f"{host} points to an internal address, so Sensoper won't connect to it.")


def guess_database(url: str) -> str:
    host = urlparse(url).hostname or ""
    return host[: -len(".odoo.com")] if host.endswith(".odoo.com") else ""


# ───────────────────────── the Odoo client ─────────────────────────
class OdooError(Exception):
    """A plain-English reason the sync couldn't talk to Odoo."""


class Odoo:
    def __init__(self, url: str, database: str, login: str, key: str, api: Optional[str] = None):
        self.url, self.db, self.login, self.key, self.api = url, database or "", login or "", key, api
        self.uid: Optional[int] = None
        self._fields: Dict[str, Dict[str, Any]] = {}
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=15.0), transport=TRANSPORT, follow_redirects=False,
                                       headers={"User-Agent": UA})
        self._n = 0

    async def close(self):
        await self._http.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        await self.close()

    # -- transport --
    async def _post(self, path: str, **kw) -> httpx.Response:
        try:
            return await self._http.post(f"{self.url}{path}", **kw)
        except httpx.TimeoutException:
            raise OdooError("Odoo took too long to answer. Try again in a minute.")
        except httpx.HTTPError as e:
            raise OdooError(f"Couldn't reach Odoo at {self.url} ({type(e).__name__}). Check the address.")

    def _json2_error(self, r: httpx.Response, model: str) -> OdooError:
        try:
            err = r.json()
        except ValueError:
            err = {}
        msg = _text(err.get("message") or "", 300)
        if r.status_code == 401:
            return OdooError("Odoo didn't accept the API key. It may be wrong or expired (keys last at most 3 months). "
                             "Make a new one in Odoo: your profile → Account Security → New API Key.")
        if r.status_code == 403:
            return OdooError(f"Odoo says this login may not read {model}{': ' + msg if msg else ''}.")
        if r.status_code == 404:
            return OdooError(f"This Odoo doesn't have {model} — is that app installed?{' (' + msg + ')' if msg else ''}")
        if r.status_code == 429:
            return OdooError("Odoo asked us to slow down. The next run will carry on.")
        return OdooError(f"Odoo answered with an error ({r.status_code}){': ' + msg if msg else ''}.")

    async def _json2(self, model: str, method: str, body: Dict[str, Any]) -> Any:
        headers = {"Authorization": f"bearer {self.key}", "Content-Type": "application/json; charset=utf-8"}
        if self.db:
            headers["X-Odoo-Database"] = self.db
        r = await self._post(f"/json/2/{model}/{method}", json=body, headers=headers)
        if r.status_code == 200:
            return r.json()
        raise self._json2_error(r, model)

    async def _rpc(self, service: str, method: str, *args) -> Any:
        self._n += 1
        r = await self._post("/jsonrpc", json={"jsonrpc": "2.0", "method": "call", "id": self._n,
                                               "params": {"service": service, "method": method, "args": list(args)}})
        if r.status_code == 404:
            raise OdooError("This Odoo doesn't answer API calls at /jsonrpc. Check the address.")
        try:
            data = r.json()
        except ValueError:
            raise OdooError(f"Odoo answered with something that isn't data ({r.status_code}). Check the address.")
        if data.get("error"):
            e = data["error"]
            name = str((e.get("data") or {}).get("name") or "")
            msg = _text((e.get("data") or {}).get("message") or e.get("message") or "", 300)
            if "AccessDenied" in name or "Access Denied" in msg:
                raise OdooError("Odoo didn't accept the login and API key. Check the login email, and make a new key if it expired.")
            if "AccessError" in name:
                raise OdooError(f"Odoo says this login may not read that data: {msg}")
            if "database" in msg.lower() and ("not exist" in msg.lower() or "doesn't exist" in msg.lower()):
                raise OdooError(f"Odoo has no database called “{self.db}”. Check the database name.")
            if "KeyError" in name or "doesn't exist" in msg or "does not exist" in msg:
                raise OdooError(f"This Odoo doesn't have that data — is the app installed? ({msg})")
            raise OdooError(f"Odoo said: {msg or name or 'an error'}")
        return data.get("result")

    async def connect(self) -> Dict[str, Any]:
        """Find the API this Odoo speaks and who the key belongs to."""
        if self.api in (None, "json2"):
            headers = {"Authorization": f"bearer {self.key}", "Content-Type": "application/json; charset=utf-8"}
            if self.db:
                headers["X-Odoo-Database"] = self.db
            r = await self._post("/json/2/res.users/context_get", json={}, headers=headers)
            if r.status_code == 200:
                self.api = "json2"
                ctx = r.json() or {}
                self.uid = ctx.get("uid")
                return {"api": "json2", "uid": self.uid}
            if r.status_code == 401:
                raise self._json2_error(r, "res.users")
            if self.api == "json2":
                raise self._json2_error(r, "res.users")
        # Odoo 14–18: JSON-RPC, the key as the password
        if not self.db:
            self.db = guess_database(self.url)
        if not self.db:
            try:
                dbs = await self._rpc("db", "list")
            except OdooError:
                dbs = []
            if isinstance(dbs, list) and len(dbs) == 1:
                self.db = dbs[0]
        if not self.db:
            raise OdooError("Enter the Odoo database name (Odoo → Settings → Activate developer mode shows it; on odoo.com it's the first part of the address).")
        if not self.login:
            raise OdooError("Enter the login email of the Odoo user the API key belongs to.")
        uid = await self._rpc("common", "authenticate", self.db, self.login, self.key, {})
        if not uid:
            raise OdooError("Odoo didn't accept the login and API key. Check the login email, and make a new key if it expired.")
        self.api, self.uid = "jsonrpc", int(uid)
        return {"api": "jsonrpc", "uid": self.uid}

    async def _kw(self, model: str, method: str, args: List[Any], kw: Dict[str, Any]) -> Any:
        if not self.api or (self.api == "jsonrpc" and not self.uid):
            await self.connect()
        if self.api == "json2":
            body = dict(kw)
            if method in ("search_read", "search_count", "search"):
                body["domain"] = args[0] if args else []
            elif method == "read":
                body["ids"] = args[0]
            return await self._json2(model, method, body)
        return await self._rpc("object", "execute_kw", self.db, self.uid, self.key, model, method, args, kw)

    async def version(self) -> Optional[str]:
        try:
            if self.api == "json2":
                r = await self._http.get(f"{self.url}/web/version")
                return str((r.json() or {}).get("version") or "") or "19+" if r.status_code == 200 else "19+"
            v = await self._rpc("common", "version")
            return str((v or {}).get("server_version") or "") or None
        except (OdooError, ValueError, httpx.HTTPError):
            return None

    async def fields(self, model: str) -> Dict[str, Any]:
        if model not in self._fields:
            self._fields[model] = await self._kw(model, "fields_get", [], {"attributes": ["string", "type", "relation", "selection", "store", "readonly"]}) or {}
        return self._fields[model]

    async def has_model(self, model: str) -> bool:
        try:
            await self.fields(model)
            return True
        except OdooError:
            return False

    async def search_read(self, model: str, domain: list, fields: List[str], limit: int = BATCH, offset: int = 0, order: str = "id asc",
                          archived: bool = False) -> List[Dict[str, Any]]:
        kw: Dict[str, Any] = {"fields": fields, "limit": limit, "offset": offset, "order": order}
        if archived:
            kw["context"] = {"active_test": False}
        return await self._kw(model, "search_read", [domain], kw) or []

    async def count(self, model: str, domain: list, archived: bool = False) -> int:
        kw: Dict[str, Any] = {"context": {"active_test": False}} if archived else {}
        return int(await self._kw(model, "search_count", [domain], kw) or 0)

    async def read(self, model: str, ids: List[int], fields: List[str]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for i in range(0, len(ids), BATCH):
            out += await self._kw(model, "read", [ids[i:i + BATCH]], {"fields": fields}) or []
        return out

    async def usable(self, model: str, wanted: Iterable[str]) -> List[str]:
        have = await self.fields(model)
        return [f for f in wanted if f in have]


# ───────────────────────── request bodies ─────────────────────────
class ConnectionIn(BaseModel):
    url: str = Field(..., max_length=300)
    database: Optional[str] = Field("", max_length=120)
    login: Optional[str] = Field("", max_length=200)
    api_key: Optional[str] = Field("", max_length=400)     # empty = keep the saved one


class SyncIn(BaseModel):
    enabled: Optional[bool] = None
    extra_fields: Optional[List[str]] = None
    options: Optional[Dict[str, Any]] = None


class TableIn(BaseModel):
    label: str = Field(..., max_length=80)
    model: str = Field(..., max_length=120)
    fields: List[str]
    filters: Optional[List[Dict[str, Any]]] = None          # [{field, op, value}]
    enabled: bool = True


class SettingsIn(BaseModel):
    auto_hourly: Optional[bool] = None
    location_id: Optional[str] = None                       # branch for new records ("" = none)


DEFAULT_OPTIONS = {
    "contacts": {"who": "both"},                            # customers | vendors | both
    "products": {"skip_services": False, "update_stock": False, "category": "auto"},
    "leads": {"include_lost": True, "stage_map": {}, "owner_map": {}},
    "orders": {"states": ["draft", "sent", "sale", "done", "cancel"]},
}
OPS = {"=": "=", "!=": "!=", ">": ">", ">=": ">=", "<": "<", "<=": "<=", "contains": "ilike", "is set": "!=", "is not set": "="}


def stage_guess(name: str, is_won: bool = False) -> str:
    n = (name or "").lower()
    if is_won or "won" in n:
        return "won"
    if "lost" in n or "cancel" in n:
        return "lost"
    if any(w in n for w in ("propos", "quot", "negoti", "offer")):
        return "quoted"
    if any(w in n for w in ("visit", "survey", "site", "meeting", "demo")):
        return "site_visit"
    if any(w in n for w in ("qualif", "contact", "call", "follow")):
        return "contacted"
    return "new"


def channel_guess(*names: Optional[str]) -> str:
    n = " ".join(x for x in names if x).lower()
    for words, ch in ((("indiamart", "india mart"), "indiamart"), (("justdial", "just dial"), "justdial"), (("whatsapp",), "whatsapp"),
                      (("referr", "refer"), "referral"), (("facebook", "instagram", "meta"), "meta_ads"), (("google",), "google_ads"),
                      (("walk",), "walk_in"), (("exhibit", "expo", "event"), "exhibition"), (("website", "web"), "website"),
                      (("phone", "call"), "phone"), (("dealer", "partner"), "partner")):
        if any(w in n for w in words):
            return ch
    return "other"


def kind_guess(*texts: Optional[str]) -> str:
    t = " ".join(x for x in texts if x).lower()
    for words, k in ((("pump", "farm", "agri", "kusum"), "farm"), (("battery", "ups", "inverter backup", "lithium"), "battery"),
                     (("amc", "service", "clean", "repair", "maintenance"), "service"),
                     (("factory", "industr", "commercial", "business", "mill", "hotel", "school", "hospital", "kw c&i", "c&i"), "business"),
                     (("home", "house", "residential", "rooftop", "surya ghar"), "home")):
        if any(w in t for w in words):
            return k
    return "other"


# ───────────────────────── the router ─────────────────────────
def create_router(db, get_current_user, get_permissions, check_module_permission, create_audit_log):
    router = APIRouter()
    running: set = set()   # keeps background runs alive

    async def _settings() -> Dict[str, Any]:
        s = await db.odoo_settings.find_one({"_id": "main"}) or {"_id": "main"}
        s.setdefault("syncs", {})
        for k in PRESETS:
            cfg = s["syncs"].setdefault(k, {})
            cfg.setdefault("enabled", False)
            cfg.setdefault("extra_fields", [])
            cfg["options"] = {**DEFAULT_OPTIONS[k], **(cfg.get("options") or {})}
        s.setdefault("tables", [])
        s.setdefault("auto_hourly", True)
        return s

    async def _client(s: Dict[str, Any]) -> Odoo:
        if not s.get("url") or not s.get("key_enc"):
            raise HTTPException(status_code=400, detail="Connect Odoo first: enter the address and the API key")
        await _check_public(s["url"])
        return Odoo(s["url"], s.get("database", ""), s.get("login", ""), decrypt_secret(s["key_enc"]), s.get("api"))

    async def _admin(request: Request) -> Dict[str, Any]:
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can change the Odoo connection")
        return user

    def _public_settings(s: Dict[str, Any]) -> Dict[str, Any]:
        out = {k: v for k, v in s.items() if k not in ("_id", "key_enc")}
        out["has_key"] = bool(s.get("key_enc"))
        out["presets"] = [{"key": k, **v} for k, v in PRESETS.items()]
        return out

    # ── settings & connection ──
    @router.get("/odoo/settings")
    async def get_settings(request: Request):
        await get_current_user(request)
        s = await _settings()
        out = _public_settings(s)
        out["counts"] = {
            "customers": await db.customers.count_documents({"odoo.model": "res.partner"}),
            "vendors": await db.vendors.count_documents({"odoo.model": "res.partner"}),
            "products": await db.inventory_items.count_documents({"odoo.model": "product.product"}),
            "leads": await db.website_leads.count_documents({"odoo.model": "crm.lead"}),
            "orders": await db.material_quotes.count_documents({"odoo.model": "sale.order"}),
        }
        for t in out["tables"]:
            t["count"] = await db.odoo_records.count_documents({"table": t["key"]})
        last = await db.odoo_runs.find({}, {"_id": 1, "status": 1, "started_at": 1, "finished_at": 1, "trigger": 1}).sort("started_at", -1).limit(1).to_list(1)
        out["last_run"] = {**last[0], "id": str(last[0].pop("_id"))} if last else None
        if out.get("auto_hourly") and out.get("has_key") and out.get("last_auto_at"):
            out["next_auto_at"] = (datetime.fromisoformat(out["last_auto_at"]) + timedelta(seconds=HOURLY_SECONDS)).isoformat()
        return out

    @router.put("/odoo/connection")
    async def save_connection(body: ConnectionIn, request: Request):
        user = await _admin(request)
        s = await _settings()
        url = clean_url(body.url)
        key = (body.api_key or "").strip()
        if key and (len(key) < 20 or re.search(r"\s", key)):
            raise HTTPException(status_code=400, detail="That doesn't look like an Odoo API key (40 letters and numbers)")
        if not key and not s.get("key_enc"):
            raise HTTPException(status_code=400, detail="Paste the Odoo API key")
        database = re.sub(r"[^\w.-]", "", (body.database or "").strip())[:120]
        login = (body.login or "").strip()[:200]
        changed_target = url != s.get("url") or database != s.get("database", "")
        enc = encrypt_secret(key) if key else s["key_enc"]
        # try it before saving, so a typo never replaces a working connection
        try:
            await _check_public(url)
            async with Odoo(url, database, login, key or decrypt_secret(s["key_enc"])) as o:
                who = await o.connect()
                info = await _whoami(o)
                api, db_name = who["api"], o.db
        except OdooError as e:
            raise HTTPException(status_code=400, detail=str(e))
        upd = {"url": url, "database": db_name or database, "login": login, "key_enc": enc, "api": api, "odoo_user": info.get("user"),
               "odoo_company": info.get("company"), "odoo_version": info.get("version"), "connected_at": _iso(), "last_error": None}
        if key:
            upd.update({"key_saved_at": _iso(), "key_saved_by": user.get("name") or user.get("email"), "key_last4": key[-4:]})
        if changed_target:   # another Odoo: start every sync from the beginning
            for k in PRESETS:
                upd[f"syncs.{k}.cursor"] = None
        await db.odoo_settings.update_one({"_id": "main"}, {"$set": upd}, upsert=True)
        await create_audit_log(user["id"], user.get("name", ""), "update", "odoo_connection", "main", None,
                               {"url": url, "database": upd["database"], "login": login, "key_changed": bool(key)})
        return _public_settings(await _settings())

    @router.delete("/odoo/connection")
    async def forget_key(request: Request):
        user = await _admin(request)
        await db.odoo_settings.update_one({"_id": "main"}, {"$set": {"key_enc": None, "key_last4": None, "api": None, "auto_hourly": False}}, upsert=True)
        await create_audit_log(user["id"], user.get("name", ""), "delete", "odoo_connection", "main", None, {"key": "removed"})
        return {"ok": True}

    async def _whoami(o: Odoo) -> Dict[str, Any]:
        info: Dict[str, Any] = {"api": o.api, "version": await o.version()}
        if o.uid:
            try:
                me = await o.read("res.users", [o.uid], ["name", "login", "company_id"])
                if me:
                    info["user"] = me[0].get("name")
                    info["company"] = _m2o(me[0].get("company_id"))
            except OdooError:
                pass
        return info

    @router.post("/odoo/test")
    async def test(request: Request):
        await get_current_user(request)
        s = await _settings()
        try:
            async with await _client(s) as o:
                await o.connect()
                info = await _whoami(o)
                counts = {}
                for k, p in PRESETS.items():
                    try:
                        counts[k] = await o.count(p["model"], await _domain(o, k, s["syncs"][k]["options"]), archived=k in ("leads", "products"))
                    except OdooError as e:
                        counts[k] = None
                        info.setdefault("missing", []).append(f"{p['label']}: {e}")
        except OdooError as e:
            await db.odoo_settings.update_one({"_id": "main"}, {"$set": {"last_error": str(e)}}, upsert=True)
            raise HTTPException(status_code=400, detail=str(e))
        await db.odoo_settings.update_one({"_id": "main"}, {"$set": {"api": o.api, "odoo_user": info.get("user"), "odoo_version": info.get("version"),
                                                                    "odoo_company": info.get("company"), "last_error": None}}, upsert=True)
        return {**info, "counts": counts}

    @router.put("/odoo/settings")
    async def save_settings(body: SettingsIn, request: Request):
        user = await get_current_user(request)
        upd: Dict[str, Any] = {}
        if body.auto_hourly is not None:
            upd["auto_hourly"] = bool(body.auto_hourly)
        if body.location_id is not None:
            if body.location_id and not await db.locations.find_one({"_id": ObjectId(body.location_id)} if ObjectId.is_valid(body.location_id) else {"_id": None}):
                raise HTTPException(status_code=400, detail="That branch doesn't exist")
            upd["location_id"] = body.location_id or None
        if upd:
            await db.odoo_settings.update_one({"_id": "main"}, {"$set": upd}, upsert=True)
            await create_audit_log(user["id"], user.get("name", ""), "update", "odoo_settings", "main", None, upd)
        return _public_settings(await _settings())

    @router.put("/odoo/syncs/{name}")
    async def save_sync(name: str, body: SyncIn, request: Request):
        user = await get_current_user(request)
        if name not in PRESETS:
            raise HTTPException(status_code=404, detail="Unknown sync")
        s = await _settings()
        cfg = s["syncs"][name]
        upd: Dict[str, Any] = {}
        if body.enabled is not None:
            upd[f"syncs.{name}.enabled"] = bool(body.enabled)
        if body.extra_fields is not None:
            fields = [f for f in body.extra_fields if isinstance(f, str) and re.match(r"^[a-z_][a-z0-9_]{0,80}$", f)][:40]
            upd[f"syncs.{name}.extra_fields"] = fields
            if set(fields) - set(cfg.get("extra_fields") or []):   # new extra fields: bring them for every record next time
                upd[f"syncs.{name}.cursor"] = None
        if body.options is not None:
            opts = {**cfg["options"]}
            o = body.options
            if name == "contacts" and o.get("who") in ("customers", "vendors", "both"):
                opts["who"] = o["who"]
            if name == "products":
                for k in ("skip_services", "update_stock"):
                    if k in o:
                        opts[k] = bool(o[k])
            if name == "leads":
                if "include_lost" in o:
                    opts["include_lost"] = bool(o["include_lost"])
                if isinstance(o.get("stage_map"), dict):
                    opts["stage_map"] = {str(k)[:20]: v for k, v in o["stage_map"].items() if v in ("new", "contacted", "site_visit", "quoted", "won", "lost")}
                if isinstance(o.get("owner_map"), dict):
                    opts["owner_map"] = {str(k)[:20]: v for k, v in o["owner_map"].items() if isinstance(v, str) and (v == "" or ObjectId.is_valid(v))}
            if name == "orders" and isinstance(o.get("states"), list):
                opts["states"] = [x for x in o["states"] if x in ORDER_STATES] or ["draft", "sent", "sale", "done"]
            upd[f"syncs.{name}.options"] = opts
            if opts != cfg["options"]:
                upd[f"syncs.{name}.cursor"] = None
        if upd:
            await db.odoo_settings.update_one({"_id": "main"}, {"$set": upd}, upsert=True)
            await create_audit_log(user["id"], user.get("name", ""), "update", "odoo_sync", name, None, {k: v for k, v in upd.items() if not k.endswith("cursor")})
        return _public_settings(await _settings())

    # ── look-ups for the set-up screens ──
    @router.get("/odoo/fields")
    async def odoo_fields(request: Request, model: str):
        await get_current_user(request)
        if not re.match(r"^[a-z_][a-z0-9_.]{1,100}$", model or ""):
            raise HTTPException(status_code=400, detail="Enter the model's technical name, like res.partner or x_site_survey")
        s = await _settings()
        try:
            async with await _client(s) as o:
                f = await o.fields(model)
        except OdooError as e:
            raise HTTPException(status_code=400, detail=str(e))
        rows = [{"name": k, "label": v.get("string") or k, "type": v.get("type"), "relation": v.get("relation"),
                 "custom": k.startswith("x_"), "stored": v.get("store", True)} for k, v in f.items() if v.get("type") not in SKIP_TYPES]
        rows.sort(key=lambda r: (not r["custom"], r["label"].lower()))
        return {"model": model, "fields": rows}

    @router.get("/odoo/models")
    async def odoo_models(request: Request, q: str = ""):
        await get_current_user(request)
        s = await _settings()
        dom: list = [("transient", "=", False)]
        if q.strip():
            dom += ["|", ("model", "ilike", q.strip()[:60]), ("name", "ilike", q.strip()[:60])]
        try:
            async with await _client(s) as o:
                rows = await o.search_read("ir.model", dom, ["model", "name"], limit=40, order="model asc")
        except OdooError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"models": [{"model": r["model"], "name": r.get("name") or r["model"], "custom": r["model"].startswith("x_")} for r in rows]}

    @router.get("/odoo/lookups")
    async def lookups(request: Request):
        """Odoo's CRM stages and salespeople, for the Leads set-up (stage → Sensoper stage, salesperson → Sensoper person)."""
        await get_current_user(request)
        s = await _settings()
        out: Dict[str, Any] = {"stages": [], "users": [], "people": []}
        try:
            async with await _client(s) as o:
                if await o.has_model("crm.stage"):
                    f = await o.usable("crm.stage", ["name", "sequence", "is_won"])
                    for r in await o.search_read("crm.stage", [], f, limit=100, order="sequence asc, id asc"):
                        out["stages"].append({"id": str(r["id"]), "name": r.get("name"), "guess": stage_guess(r.get("name"), bool(r.get("is_won")))})
                for r in await o.search_read("res.users", [("share", "=", False)], ["name", "login"], limit=200, order="name asc"):
                    out["users"].append({"id": str(r["id"]), "name": r.get("name"), "login": r.get("login")})
        except OdooError as e:
            raise HTTPException(status_code=400, detail=str(e))
        async for u in db.users.find({"active": {"$ne": False}}, {"name": 1, "email": 1}).sort("name", 1):
            out["people"].append({"id": str(u["_id"]), "name": u.get("name") or u.get("email"), "email": (u.get("email") or "").lower()})
        emails = {p["email"]: p["id"] for p in out["people"]}
        names = {(p["name"] or "").lower(): p["id"] for p in out["people"]}
        for u in out["users"]:
            u["guess"] = emails.get((u.get("login") or "").lower()) or names.get((u.get("name") or "").lower()) or ""
        return out

    # ── custom tables ──
    def _filters_domain(filters: Optional[List[Dict[str, Any]]], fields: Dict[str, Any]) -> list:
        dom: list = []
        for f in filters or []:
            name, op, value = str(f.get("field") or ""), str(f.get("op") or "="), f.get("value")
            if name not in fields or op not in OPS:
                raise HTTPException(status_code=400, detail=f"Check the filter on “{name or '?'}”")
            if op == "is set":
                dom.append((name, "!=", False))
            elif op == "is not set":
                dom.append((name, "=", False))
            else:
                t = fields[name].get("type")
                v: Any = value
                if t in ("integer", "many2one"):
                    v = int(value) if str(value).lstrip("-").isdigit() else value
                elif t in ("float", "monetary"):
                    try:
                        v = float(value)
                    except (TypeError, ValueError):
                        raise HTTPException(status_code=400, detail=f"“{name}” needs a number")
                elif t == "boolean":
                    v = str(value).lower() in ("1", "true", "yes")
                dom.append((name, OPS[op], v))
        return dom

    @router.post("/odoo/tables")
    async def add_table(body: TableIn, request: Request):
        user = await get_current_user(request)
        s = await _settings()
        if len(s["tables"]) >= 20:
            raise HTTPException(status_code=400, detail="Up to 20 extra Odoo tables")
        model = body.model.strip()
        if not re.match(r"^[a-z_][a-z0-9_.]{1,100}$", model):
            raise HTTPException(status_code=400, detail="Enter the model's technical name, like x_site_survey")
        try:
            async with await _client(s) as o:
                f = await o.fields(model)
        except OdooError as e:
            raise HTTPException(status_code=400, detail=str(e))
        fields = [x for x in body.fields if x in f and f[x].get("type") not in SKIP_TYPES][:60]
        if not fields:
            raise HTTPException(status_code=400, detail="Pick at least one field")
        _filters_domain(body.filters, f)
        key = _slug(body.label) or _slug(model)
        if any(t["key"] == key for t in s["tables"]):
            key = f"{key}_{len(s['tables']) + 1}"
        t = {"key": key, "label": _str(body.label, 80) or model, "model": model, "fields": fields, "filters": body.filters or [],
             "enabled": body.enabled, "cursor": None, "labels": {x: f[x].get("string") or x for x in fields},
             "types": {x: f[x].get("type") for x in fields}, "created_at": _iso(), "created_by": user.get("name")}
        await db.odoo_settings.update_one({"_id": "main"}, {"$push": {"tables": t}}, upsert=True)
        await create_audit_log(user["id"], user.get("name", ""), "create", "odoo_table", key, None, {"model": model, "fields": fields})
        return _public_settings(await _settings())

    @router.put("/odoo/tables/{key}")
    async def edit_table(key: str, body: TableIn, request: Request):
        user = await get_current_user(request)
        s = await _settings()
        t = next((x for x in s["tables"] if x["key"] == key), None)
        if not t:
            raise HTTPException(status_code=404, detail="That table isn't set up")
        try:
            async with await _client(s) as o:
                f = await o.fields(t["model"])
        except OdooError as e:
            raise HTTPException(status_code=400, detail=str(e))
        fields = [x for x in body.fields if x in f and f[x].get("type") not in SKIP_TYPES][:60]
        if not fields:
            raise HTTPException(status_code=400, detail="Pick at least one field")
        _filters_domain(body.filters, f)
        new = {**t, "label": _str(body.label, 80) or t["label"], "fields": fields, "filters": body.filters or [], "enabled": body.enabled,
               "labels": {x: f[x].get("string") or x for x in fields}, "types": {x: f[x].get("type") for x in fields}}
        if fields != t["fields"] or (body.filters or []) != (t.get("filters") or []):
            new["cursor"] = None
        await db.odoo_settings.update_one({"_id": "main", "tables.key": key}, {"$set": {"tables.$": new}})
        await create_audit_log(user["id"], user.get("name", ""), "update", "odoo_table", key, None, {"fields": fields})
        return _public_settings(await _settings())

    @router.delete("/odoo/tables/{key}")
    async def delete_table(key: str, request: Request):
        user = await get_current_user(request)
        await db.odoo_settings.update_one({"_id": "main"}, {"$pull": {"tables": {"key": key}}})
        n = (await db.odoo_records.delete_many({"table": key})).deleted_count
        await create_audit_log(user["id"], user.get("name", ""), "delete", "odoo_table", key, None, {"records": n})
        return {"deleted": True, "records": n}

    @router.get("/odoo/data/{key}")
    async def table_data(key: str, request: Request, q: str = "", page: int = 1, size: int = 50):
        await get_current_user(request)
        s = await _settings()
        size = max(1, min(size, 200))
        page = max(1, page)
        if key == "customers":
            cols = [("name", "Name"), ("company", "Company"), ("phone", "Phone"), ("email", "Email"), ("gstin", "GSTIN"), ("city", "City"), ("state", "State")]
            query: Dict[str, Any] = {"odoo.model": "res.partner"}
            if q.strip():
                rx = {"$regex": re.escape(q.strip()[:60]), "$options": "i"}
                query["$or"] = [{"name": rx}, {"phone": rx}, {"email": rx}, {"gstin": rx}, {"company": rx}, {"city": rx}]
            total = await db.customers.count_documents(query)
            rows = await db.customers.find(query).sort("name", 1).skip((page - 1) * size).limit(size).to_list(size)
            extra = s["syncs"]["contacts"].get("extra_fields") or []
            labels = (s["syncs"]["contacts"].get("extra_labels") or {})
            return {"label": "Customers from Odoo", "model": "res.partner", "total": total, "page": page, "size": size,
                    "columns": [{"key": k, "label": l} for k, l in cols] + [{"key": f"extra.{x}", "label": labels.get(x, x)} for x in extra],
                    "rows": [{**{k: r.get(k) for k, _ in cols}, **{f"extra.{x}": ((r.get("odoo") or {}).get("extra") or {}).get(x) for x in extra},
                              "id": str(r["_id"]), "odoo_id": (r.get("odoo") or {}).get("id")} for r in rows]}
        t = next((x for x in s["tables"] if x["key"] == key), None)
        if not t:
            raise HTTPException(status_code=404, detail="That table isn't set up")
        query = {"table": key}
        if q.strip():
            rx = {"$regex": re.escape(q.strip()[:60]), "$options": "i"}
            query["$or"] = [{f"values.{f}": rx} for f in t["fields"]]
        total = await db.odoo_records.count_documents(query)
        rows = await db.odoo_records.find(query).sort("odoo_id", -1).skip((page - 1) * size).limit(size).to_list(size)
        return {"label": t["label"], "model": t["model"], "total": total, "page": page, "size": size,
                "columns": [{"key": f, "label": (t.get("labels") or {}).get(f, f)} for f in t["fields"]],
                "rows": [{**(r.get("values") or {}), "id": str(r["_id"]), "odoo_id": r.get("odoo_id")} for r in rows]}

    # ── runs ──
    def _run_out(r: Dict[str, Any]) -> Dict[str, Any]:
        out = {k: v for k, v in r.items() if k != "_id"}
        out["id"] = str(r["_id"])
        return out

    @router.get("/odoo/runs")
    async def runs(request: Request, limit: int = 30):
        await get_current_user(request)
        rows = await db.odoo_runs.find({"dry": {"$ne": True}}).sort("started_at", -1).limit(max(1, min(limit, 100))).to_list(100)
        return {"items": [_run_out(r) for r in rows]}

    @router.get("/odoo/runs/{run_id}")
    async def run_status(run_id: str, request: Request):
        await get_current_user(request)
        r = await db.odoo_runs.find_one({"_id": ObjectId(run_id)}) if ObjectId.is_valid(run_id) else None
        if not r:
            raise HTTPException(status_code=404, detail="That run doesn't exist")
        return _run_out(r)

    @router.post("/odoo/syncs/{name}/run")
    async def run_now(name: str, request: Request, full: bool = False):
        user = await get_current_user(request)
        s = await _settings()
        names = _which(s, name)
        run_id = await start_run(names, "button", user, full=full)
        return {"run_id": run_id}

    @router.post("/odoo/syncs/{name}/preview")
    async def preview(name: str, request: Request):
        """What a sync would change — the first 25 records, nothing is written."""
        user = await get_current_user(request)
        s = await _settings()
        names = _which(s, name, preview=True)
        run = {"_id": ObjectId(), "which": names, "trigger": "preview", "dry": True, "started_at": _iso(), "by": user.get("name"), "status": "running",
               "results": {}, "changes": [], "errors": []}
        try:
            async with await _client(s) as o:
                await o.connect()
                for n in names:
                    await _sync_one(o, s, n, run, dry=True, limit=25)
        except OdooError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"results": run["results"], "changes": run["changes"][:80], "errors": run["errors"][:20]}

    def _which(s: Dict[str, Any], name: str, preview: bool = False) -> List[str]:
        if name == "all":
            names = [k for k in PRESETS if s["syncs"][k]["enabled"]] + [f"table:{t['key']}" for t in s["tables"] if t.get("enabled", True)]
            if not names:
                raise HTTPException(status_code=400, detail="Switch on at least one sync first")
            return names
        if name in PRESETS:
            return [name]
        if name.startswith("table:") and any(t["key"] == name[6:] for t in s["tables"]):
            return [name]
        raise HTTPException(status_code=404, detail="Unknown sync")

    async def _take_lock(run_id: str) -> bool:
        now = _now()
        try:
            await db.odoo_lock.find_one_and_update(
                {"_id": "lock", "$or": [{"until": {"$lt": now.isoformat()}}, {"until": None}]},
                {"$set": {"until": (now + timedelta(minutes=LOCK_MINUTES)).isoformat(), "run_id": run_id}}, upsert=True)
            return True
        except DuplicateKeyError:
            return False

    async def _release_lock(run_id: str) -> None:
        await db.odoo_lock.update_one({"_id": "lock", "run_id": run_id}, {"$set": {"until": None}})

    async def start_run(names: List[str], trigger: str, user: Optional[Dict[str, Any]], full: bool = False, wait: bool = False) -> str:
        run_id = ObjectId()
        if not await _take_lock(str(run_id)):
            busy = await db.odoo_lock.find_one({"_id": "lock"})
            raise HTTPException(status_code=409, detail="A sync is already running — wait for it to finish", headers={"X-Run": str((busy or {}).get("run_id") or "")})
        await db.odoo_runs.insert_one({"_id": run_id, "which": names, "trigger": trigger, "full": full, "status": "running", "started_at": _iso(),
                                       "by": (user or {}).get("name") or ("Every hour" if trigger == "hourly" else "Sensoper"), "results": {}, "errors": []})
        task = asyncio.get_running_loop().create_task(_execute(run_id, names, full))
        running.add(task)
        task.add_done_callback(running.discard)
        if wait:
            await task
        return str(run_id)

    async def _execute(run_id: ObjectId, names: List[str], full: bool) -> None:
        run: Dict[str, Any] = {"_id": run_id, "results": {}, "errors": [], "changes": []}
        status, fatal = "done", None
        try:
            s = await _settings()
            async with await _client(s) as o:
                await o.connect()
                for n in names:
                    try:
                        await _sync_one(o, s, n, run, full=full)
                    except OdooError as e:
                        run["results"].setdefault(n, {})["error"] = str(e)
                        run["errors"].append({"sync": n, "message": str(e)})
                    await db.odoo_runs.update_one({"_id": run_id}, {"$set": {"results": run["results"], "errors": run["errors"][:50]}})
            if run["errors"]:
                status = "partial"
        except (OdooError, HTTPException) as e:
            status, fatal = "failed", (str(e) if isinstance(e, OdooError) else e.detail)
        except Exception as e:   # noqa: BLE001 — a run must always end with a status
            logger.exception("Odoo sync crashed")
            status, fatal = "failed", f"The sync stopped on an unexpected error ({type(e).__name__}). It will try again next time."
        finally:
            upd = {"status": status, "finished_at": _iso(), "results": run["results"], "errors": run["errors"][:50]}
            if fatal:
                upd["error"] = fatal
            await db.odoo_runs.update_one({"_id": run_id}, {"$set": upd})
            await db.odoo_settings.update_one({"_id": "main"}, {"$set": {"last_error": fatal}}, upsert=True)
            await _release_lock(str(run_id))

    # ── the sync itself ──
    async def _domain(o: Odoo, name: str, opts: Dict[str, Any]) -> list:
        if name == "contacts":
            have = await o.fields("res.partner")
            if "customer_rank" not in have:
                return []
            if opts.get("who") == "customers":
                return [("customer_rank", ">", 0)]
            if opts.get("who") == "vendors":
                return [("supplier_rank", ">", 0)]
            return ["|", ("customer_rank", ">", 0), ("supplier_rank", ">", 0)]
        if name == "products":
            return [("type", "!=", "service")] if opts.get("skip_services") else []
        if name == "leads":
            return [] if opts.get("include_lost", True) else [("active", "=", True)]
        if name == "orders":
            return [("state", "in", opts.get("states") or list(ORDER_STATES))]
        return []

    async def _sync_one(o: Odoo, s: Dict[str, Any], name: str, run: Dict[str, Any], full: bool = False, dry: bool = False,
                        limit: Optional[int] = None) -> None:
        if name.startswith("table:"):
            t = next(x for x in s["tables"] if x["key"] == name[6:])
            return await _sync_table(o, t, run, full=full, dry=dry, limit=limit)
        cfg = s["syncs"][name]
        model = PRESETS[name]["model"]
        have = await o.fields(model)
        extra = [f for f in cfg.get("extra_fields") or [] if f in have and have[f].get("type") not in SKIP_TYPES]
        fields = await o.usable(model, WANT[model]) + [f for f in extra if f not in WANT[model]]
        dom = await _domain(o, name, cfg["options"])
        cursor = None if full or dry else cfg.get("cursor")
        if cursor and "write_date" in have:
            dom = dom + [("write_date", ">=", cursor)]
        archived = name in ("leads", "products", "contacts")
        total = await o.count(model, dom, archived=archived)
        res = run["results"].setdefault(name, {"total": total, "done": 0, "created": 0, "updated": 0, "unchanged": 0, "kept_local": 0, "skipped": 0, "errors": 0})
        res["total"] = total
        sel = {k: {str(a): b for a, b in (have[k].get("selection") or [])} for k in extra if have[k].get("type") == "selection"}
        ctx = await _context(o, name, s)
        offset, newest = 0, cursor
        order = "write_date asc, id asc" if "write_date" in have else "id asc"
        while True:
            batch = await o.search_read(model, dom, fields, limit=min(BATCH, limit or BATCH), offset=offset, order=order, archived=archived)
            if not batch:
                break
            await _prepare_batch(o, name, batch, ctx)
            for rec in batch:
                try:
                    extra_vals = {f: _display(rec.get(f), have[f].get("type"), sel.get(f)) for f in extra}
                    outcome = await APPLY[name](rec, extra_vals, ctx, s, dry)
                    res[outcome["action"]] = res.get(outcome["action"], 0) + 1
                    res["kept_local"] += len(outcome.get("kept") or [])
                    if outcome.get("changes") is not None and (dry or outcome["action"] in ("created", "updated")) and len(run["changes"]) < 200:
                        run["changes"].append({"sync": name, "action": outcome["action"], "title": outcome.get("title"),
                                               "changes": outcome.get("changes")[:12], "kept": outcome.get("kept") or []})
                except (ValueError, TypeError, KeyError, HTTPException) as e:
                    res["errors"] += 1
                    if len(run["errors"]) < 50:
                        detail = e.detail if isinstance(e, HTTPException) else str(e)
                        run["errors"].append({"sync": name, "record": f"{model} #{rec.get('id')} {_str(rec.get('display_name') or rec.get('name'), 60)}", "message": detail[:200]})
                res["done"] += 1
                if rec.get("write_date") and (not newest or str(rec["write_date"]) > str(newest)):
                    newest = str(rec["write_date"])
            if not dry and newest:
                await db.odoo_settings.update_one({"_id": "main"}, {"$set": {f"syncs.{name}.cursor": newest, f"syncs.{name}.last_synced_at": _iso()}})
                await db.odoo_runs.update_one({"_id": run["_id"]}, {"$set": {f"results.{name}": res}})
            if limit and res["done"] >= limit:
                break
            if len(batch) < BATCH:
                break
            offset += len(batch)
        if not dry:
            extra_labels = {f: have[f].get("string") or f for f in extra}
            await db.odoo_settings.update_one({"_id": "main"}, {"$set": {f"syncs.{name}.last_run": {**res, "at": _iso()},
                                                                         f"syncs.{name}.extra_labels": extra_labels}})

    async def _sync_table(o: Odoo, t: Dict[str, Any], run: Dict[str, Any], full: bool = False, dry: bool = False, limit: Optional[int] = None) -> None:
        key = t["key"]
        name = f"table:{key}"
        have = await o.fields(t["model"])
        fields = [f for f in t["fields"] if f in have]
        dom = _filters_domain(t.get("filters"), have)
        cursor = None if full or dry else t.get("cursor")
        if cursor and "write_date" in have:
            dom = dom + [("write_date", ">=", cursor)]
        total = await o.count(t["model"], dom)
        res = run["results"].setdefault(name, {"total": total, "done": 0, "created": 0, "updated": 0, "unchanged": 0, "kept_local": 0, "skipped": 0, "errors": 0})
        sel = {k: {str(a): b for a, b in (have[k].get("selection") or [])} for k in fields if have[k].get("type") == "selection"}
        rel_names: Dict[str, Dict[int, str]] = {}
        read_fields = fields + (["write_date"] if "write_date" in have and "write_date" not in fields else [])
        offset, newest = 0, cursor
        while True:
            batch = await o.search_read(t["model"], dom, read_fields, limit=min(BATCH, limit or BATCH), offset=offset,
                                        order="write_date asc, id asc" if "write_date" in have else "id asc")
            if not batch:
                break
            # many2many names (tags and the like), one read per related model
            for f in fields:
                if have[f].get("type") == "many2many" and have[f].get("relation"):
                    ids = sorted({i for r in batch for i in (r.get(f) or []) if isinstance(i, int)} - set(rel_names.get(f, {})))
                    if ids:
                        try:
                            got = await o.read(have[f]["relation"], ids, ["display_name"])
                            rel_names.setdefault(f, {}).update({g["id"]: g.get("display_name") for g in got})
                        except OdooError:
                            pass
            for rec in batch:
                vals = {}
                for f in fields:
                    v = rec.get(f)
                    if have[f].get("type") == "many2many" and isinstance(v, list):
                        v = ", ".join(str(rel_names.get(f, {}).get(i, i)) for i in v)
                    vals[f] = _display(v, have[f].get("type"), sel.get(f))
                old = await db.odoo_records.find_one({"table": key, "odoo_id": rec["id"]})
                if old and old.get("values") == vals:
                    res["unchanged"] += 1
                else:
                    action = "updated" if old else "created"
                    res[action] += 1
                    if dry:
                        run["changes"].append({"sync": name, "action": action, "title": f"{t['label']} #{rec['id']}",
                                               "changes": [{"field": (t.get("labels") or {}).get(f, f), "from": (old or {}).get("values", {}).get(f), "to": vals[f]}
                                                           for f in fields if (old or {}).get("values", {}).get(f) != vals[f]][:12]})
                    else:
                        await db.odoo_records.update_one({"table": key, "odoo_id": rec["id"]}, {"$set": {
                            "table": key, "model": t["model"], "odoo_id": rec["id"], "values": vals, "write_date": rec.get("write_date"),
                            "synced_at": _iso()}}, upsert=True)
                res["done"] += 1
                if rec.get("write_date") and (not newest or str(rec["write_date"]) > str(newest)):
                    newest = str(rec["write_date"])
            if limit and res["done"] >= limit:
                break
            if len(batch) < BATCH:
                break
            offset += len(batch)
        if not dry:
            await db.odoo_settings.update_one({"_id": "main", "tables.key": key}, {"$set": {"tables.$.cursor": newest, "tables.$.last_run": {**res, "at": _iso()}}})

    # ── per-sync preparation (look-ups done once per batch) ──
    async def _context(o: Odoo, name: str, s: Dict[str, Any]) -> Dict[str, Any]:
        ctx: Dict[str, Any] = {"location_id": s.get("location_id"), "taxes": {}, "opts": s["syncs"][name]["options"], "url": s.get("url")}
        if name == "leads":
            ctx["users"] = {str(u["_id"]): u.get("name") or u.get("email") async for u in db.users.find({"active": {"$ne": False}}, {"name": 1, "email": 1})}
            ctx["names"] = {(n or "").strip().lower(): i for i, n in ctx["users"].items() if n}
            ctx["stage_won"] = {}
            if await o.has_model("crm.stage"):
                f = await o.usable("crm.stage", ["name", "is_won"])
                for st in await o.search_read("crm.stage", [], f, limit=200):
                    ctx["stage_won"][st["id"]] = bool(st.get("is_won"))
            ctx["odoo_users"] = {}
        if name == "products":
            ctx["categories"] = {c.get("slug"): c async for c in db.inventory_categories.find({}, {"slug": 1, "name": 1})}
        return ctx

    async def _taxes(o: Odoo, ids: Iterable[int], ctx: Dict[str, Any]) -> None:
        need = sorted({i for i in ids if isinstance(i, int)} - set(ctx["taxes"]))
        if not need:
            return
        f = await o.usable("account.tax", ["name", "amount", "amount_type", "children_tax_ids"])
        rows = await o.read("account.tax", need, f)
        kids = sorted({k for r in rows for k in (r.get("children_tax_ids") or [])} - set(ctx["taxes"]))
        kid_rows = {r["id"]: r for r in (await o.read("account.tax", kids, f) if kids else [])}
        for r in rows:
            if r.get("amount_type") == "group" and r.get("children_tax_ids"):
                pct = sum(float(kid_rows.get(k, {}).get("amount") or 0) for k in r["children_tax_ids"])
            else:
                pct = float(r.get("amount") or 0) if r.get("amount_type") in (None, "percent", "division") else 0.0
            ctx["taxes"][r["id"]] = {"pct": round(pct, 2), "igst": "igst" in str(r.get("name") or "").lower()}

    async def _prepare_batch(o: Odoo, name: str, batch: List[Dict[str, Any]], ctx: Dict[str, Any]) -> None:
        if name == "products":
            await _taxes(o, [t for r in batch for t in (r.get("taxes_id") or [])], ctx)
        if name == "orders":
            line_ids = [i for r in batch for i in (r.get("order_line") or [])]
            lf = await o.usable("sale.order.line", WANT["sale.order.line"])
            lines = await o.read("sale.order.line", line_ids, lf) if line_ids else []
            tax_field = "tax_ids" if "tax_ids" in lf else "tax_id"
            uom_field = "product_uom_id" if "product_uom_id" in lf else "product_uom"
            await _taxes(o, [t for ln in lines for t in (ln.get(tax_field) or [])], ctx)
            by_order: Dict[int, List[Dict[str, Any]]] = {}
            for ln in sorted(lines, key=lambda x: (x.get("sequence") or 0, x["id"])):
                ln["_taxes"], ln["_uom"] = ln.get(tax_field) or [], _m2o(ln.get(uom_field)) or "Nos"
                by_order.setdefault(_m2o_id(ln.get("order_id")), []).append(ln)
            ctx["lines"] = by_order
            pids = sorted({_m2o_id(r.get("partner_id")) for r in batch} - {None})
            pf = await o.usable("res.partner", ["name", "phone", "mobile", "email", "vat", "street", "street2", "city", "zip", "state_id", "parent_id"])
            ctx["partners"] = {p["id"]: p for p in (await o.read("res.partner", pids, pf) if pids else [])}

    # ── merging: Odoo's value goes in only where Sensoper still has what Odoo last gave ──
    def _merge(doc: Dict[str, Any], new: Dict[str, Any], last: Dict[str, Any], create_only: Iterable[str] = (),
               force: Iterable[str] = ()) -> Tuple[Dict[str, Any], List[str], List[Dict[str, Any]]]:
        upd: Dict[str, Any] = {}
        kept: List[str] = []
        changes: List[Dict[str, Any]] = []
        for f, v in new.items():
            if f in create_only:
                continue
            cur = doc.get(f)
            if _same(cur, v):
                continue
            prev = last.get(f, MISSING)
            if f in force:   # Odoo is in charge of this one (e.g. stock with "keep stock in step with Odoo")
                upd[f] = v
            elif prev is MISSING:
                if cur in (None, "", [], {}):   # a field we didn't copy before: fill it if Sensoper has nothing
                    upd[f] = v
                else:
                    kept.append(f)
            elif _same(cur, prev):
                upd[f] = v
            else:
                kept.append(f)
            if f in upd:
                changes.append({"field": f, "from": cur, "to": v})
        return upd, kept, changes

    async def _upsert(coll, match: List[Dict[str, Any]], new: Dict[str, Any], create_extra: Dict[str, Any], odoo: Dict[str, Any], title: str,
                      dry: bool, create_only: Iterable[str] = (), on_create=None, on_update=None, force: Iterable[str] = ()) -> Dict[str, Any]:
        doc = None
        for m in match:
            if m and all(v not in (None, "") for v in m.values()):
                doc = await coll.find_one(m)
                if doc:
                    break
        now = _iso()
        if not doc:
            if dry:
                return {"action": "created", "title": title, "changes": [{"field": k, "from": None, "to": v} for k, v in new.items() if v not in (None, "")]}
            full = {**new, **create_extra, "odoo": {**odoo, "values": {**new}, "synced_at": now}, "created_at": create_extra.get("created_at") or now, "updated_at": now}
            res = await coll.insert_one(full)
            full["_id"] = res.inserted_id
            if on_create:
                await on_create(full)
            return {"action": "created", "title": title, "changes": [], "id": str(res.inserted_id)}
        last = ((doc.get("odoo") or {}).get("values") or {}) if (doc.get("odoo") or {}).get("id") == odoo["id"] else {}
        upd, kept, changes = _merge(doc, new, last, create_only, force)
        same_odoo = {**(doc.get("odoo") or {}), **odoo, "values": {**last, **new}, "synced_at": now}
        extra_changed = (doc.get("odoo") or {}).get("extra") != odoo.get("extra")
        if dry:
            return {"action": "updated" if (upd or extra_changed) else "unchanged", "title": title, "changes": changes, "kept": kept}
        sets = {**upd, "odoo": same_odoo}
        if upd:
            sets["updated_at"] = now
        await coll.update_one({"_id": doc["_id"]}, {"$set": sets})
        if upd and on_update:
            await on_update({**doc, **upd}, upd)
        return {"action": "updated" if (upd or extra_changed) else "unchanged", "title": title, "changes": changes, "kept": kept}

    def _odoo_ref(model: str, rec: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
        return {"model": model, "id": rec["id"], "write_date": rec.get("write_date"), "extra": extra, "archived": rec.get("active") is False}

    # contacts → customers / vendors
    async def apply_contact(rec, extra, ctx, s, dry):
        phone_raw = rec.get("mobile") or rec.get("phone") or ""
        phone = mobile(phone_raw) or ""
        name = _str(rec.get("name") or rec.get("display_name"), 120)
        if not name:
            return {"action": "skipped"}
        company = _str(_m2o(rec.get("parent_id")), 120) if rec.get("parent_id") else (name if rec.get("is_company") else "")
        gstin = re.sub(r"\s", "", _str(rec.get("vat"), 20)).upper()
        base = {"name": name, "company": company, "phone": phone, "email": _str(rec.get("email"), 120).lower(), "gstin": gstin,
                "address": ", ".join(x for x in (_str(rec.get("street"), 120), _str(rec.get("street2"), 120)) if x),
                "city": _str(rec.get("city"), 60), "state": _state_name(rec.get("state_id")), "pincode": re.sub(r"\D", "", _str(rec.get("zip"), 10))[:6]}
        ref = _odoo_ref("res.partner", rec, extra)
        out = {"action": "unchanged", "title": name}
        has_rank = "customer_rank" in rec
        is_customer = (rec.get("customer_rank") or 0) > 0 or not has_rank
        is_vendor = (rec.get("supplier_rank") or 0) > 0
        if is_customer:
            out = await _upsert(db.customers, [{"odoo.model": "res.partner", "odoo.id": rec["id"]}, {"phone": phone} if phone else {}, {"gstin": gstin} if gstin else {}],
                                base, {"source": "odoo", "first_touch_channel": "odoo", "created_at": _odoo_dt(rec.get("create_date"))}, ref, name, dry)
        if is_vendor:
            vend = {"name": name, "contact_person": "" if rec.get("is_company") else name, "phone": phone, "email": base["email"], "gstin": gstin,
                    "address": ", ".join(x for x in (base["address"], base["city"], base["pincode"]) if x), "state": base["state"]}
            vout = await _upsert(db.vendors, [{"odoo.model": "res.partner", "odoo.id": rec["id"]}, {"gstin": gstin} if gstin else {},
                                              {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}, "active": {"$ne": False}}],
                                 vend, {"active": rec.get("active", True) is not False, "tags": [], "preferred": False, "blocked": False,
                                        "notes": "Brought in from Odoo", "created_at": _odoo_dt(rec.get("create_date"))}, ref, name, dry)
            if not is_customer or out["action"] == "unchanged":
                out = vout
        return out

    # products → inventory items
    async def apply_product(rec, extra, ctx, s, dry):
        name = re.sub(r"^\[[^\]]*\]\s*", "", _str(rec.get("display_name") or rec.get("name"), 200))
        if not name:
            return {"action": "skipped"}
        sku = _str(rec.get("default_code"), 60) or f"ODOO-{rec['id']}"
        cost = _num(rec.get("standard_price")) or 0.0
        price = _num(rec.get("lst_price") if rec.get("lst_price") not in (None, False) else rec.get("list_price"))
        margin = round((price / cost - 1) * 100, 2) if cost and price else None
        taxes = [ctx["taxes"].get(t, {}).get("pct", 0) for t in (rec.get("taxes_id") or [])]
        gst = round(sum(taxes), 2) if taxes else None
        categ = _m2o(rec.get("categ_id")) or "Other"
        leaf = categ.split("/")[-1].strip() or "Other"
        slug = _slug(leaf)
        new = {"name": name, "sku_code": sku, "unit_price": cost, "margin_pct": margin, "hsn_code": _str(rec.get("l10n_in_hsn_code"), 12),
               "active": rec.get("active", True) is not False, "category": slug}
        if gst is not None:
            new["gst_percentage"] = gst
        qty = _num(rec.get("qty_available"))
        if ctx["opts"].get("update_stock") and qty is not None:
            new["quantity"] = qty
        ref = _odoo_ref("product.product", rec, extra)

        async def created(doc):
            if slug not in ctx["categories"]:
                await db.inventory_categories.update_one({"slug": slug}, {"$setOnInsert": {"name": leaf, "slug": slug, "created_at": _iso(), "source": "odoo"}}, upsert=True)
                ctx["categories"][slug] = {"slug": slug, "name": leaf}
            await db.inventory_transactions.insert_one({"item_id": str(doc["_id"]), "type": "initial_stock", "quantity": doc.get("quantity") or 0,
                                                        "user_id": None, "user_name": "Odoo sync", "notes": f"From Odoo product #{rec['id']}", "timestamp": _iso()})

        async def updated(doc, upd):
            if "quantity" in upd:
                await db.inventory_transactions.insert_one({"item_id": str(doc["_id"]), "type": "adjustment", "quantity": upd["quantity"],
                                                            "user_id": None, "user_name": "Odoo sync", "notes": "Stock set to Odoo's on-hand quantity", "timestamp": _iso()})
        create_extra = {"quantity": qty or 0, "gst_percentage": gst if gst is not None else 18, "reorder_level": 0, "supplier": "", "zone": "", "aisle": "",
                        "shelf": "", "rack": "", "bin_location": "", "photos": [], "specs": {}, "location_id": ctx.get("location_id"),
                        "created_at": _odoo_dt(rec.get("create_date"))}
        return await _upsert(db.inventory_items, [{"odoo.model": "product.product", "odoo.id": rec["id"]}, {"sku_code": sku}], new, create_extra, ref, name, dry,
                             create_only=() if ctx["opts"].get("update_stock") else ("quantity",), on_create=created, on_update=updated,
                             force=("quantity",) if ctx["opts"].get("update_stock") else ())

    # CRM leads → Leads
    async def apply_lead(rec, extra, ctx, s, dry):
        import crm   # here, not at the top: crm imports website, and the server loads us after both
        opts = ctx["opts"]
        stage_id = _m2o_id(rec.get("stage_id"))
        stage_name = _m2o(rec.get("stage_id")) or ""
        won = (rec.get("won_status") == "won") or (ctx["stage_won"].get(stage_id) if stage_id else False) or (rec.get("probability") == 100 and rec.get("active") is not False)
        lost = rec.get("won_status") == "lost" or (rec.get("active") is False and not won)
        if won:
            status = "won"
        elif lost:
            status = "lost"
        else:
            status = opts.get("stage_map", {}).get(str(stage_id)) or stage_guess(stage_name)
        owner_odoo = _m2o_id(rec.get("user_id"))
        owner = None
        if owner_odoo:   # the set-up's choice for this salesperson, else the Sensoper person with the same name
            owner = opts.get("owner_map", {}).get(str(owner_odoo))
            if owner is None:
                owner = ctx["names"].get((_m2o(rec.get("user_id")) or "").strip().lower())
        phone_raw = rec.get("mobile") or rec.get("phone") or ""
        title = _str(rec.get("name"), 200)
        desc = _text(rec.get("description"), 1500)
        priority = int(rec.get("priority") or 0) if str(rec.get("priority") or "0").isdigit() else 0
        name = _str(rec.get("contact_name"), 80) or _str(_m2o(rec.get("partner_id")), 80) or _str(rec.get("partner_name"), 80) or title[:80]
        fu = rec.get("activity_date_deadline") or None
        closed = status in ("won", "lost")
        new = {"name": name, "phone": mobile(phone_raw) or "", "email": _str(rec.get("email_from"), 120).lower(), "company": _str(rec.get("partner_name"), 120),
               "area": _str(rec.get("street2") or rec.get("street"), 80), "city": _str(rec.get("city"), 60),
               "pincode": re.sub(r"\D", "", _str(rec.get("zip"), 10))[:6], "message": "\n".join(x for x in (title, desc) if x)[:2000],
               "status": status, "value": _num(rec.get("expected_revenue")) or None, "heat": "hot" if priority >= 2 else ("warm" if priority == 1 else None),
               "follow_up_on": None if closed else (str(fu)[:10] if fu else None), "follow_up_note": "" if closed or not fu else _str(rec.get("activity_summary"), 200),
               "lost_reason": _str(_m2o(rec.get("lost_reason_id")), 200) or ("Lost in Odoo" if status == "lost" else "")}
        if owner is not None:
            new["assigned_to"] = owner or None
            new["assigned_to_name"] = ctx["users"].get(owner) if owner else None
        ref = _odoo_ref("crm.lead", rec, extra)
        ref["stage"] = stage_name
        ref["salesperson"] = _m2o(rec.get("user_id"))
        create_extra = {"kind": kind_guess(title, desc, " ".join(str(t) for t in (rec.get("tag_ids") or []) if isinstance(t, str))),
                        "channel": channel_guess(_m2o(rec.get("source_id")), _m2o(rec.get("medium_id"))), "source": "odoo",
                        "needs_attention": False, "submissions": 1, "contact_count": 0, "quote_count": 0, "follow_up_at": None,
                        "created_by": None, "created_by_name": "Odoo", "location_id": ctx.get("location_id"),
                        "closed_at": _odoo_dt(rec.get("date_closed")) if closed else None, "created_at": _odoo_dt(rec.get("create_date")),
                        "activity": [{"at": _iso(), "by": "Odoo sync", "type": "created", "text": f"Brought in from Odoo (CRM #{rec['id']}, stage {stage_name or '—'})"}]}
        if "assigned_to" not in new:
            create_extra.update({"assigned_to": None, "assigned_to_name": None})

        async def numbered(doc):
            seq = await db.counters.find_one_and_update({"_id": "crm_lead"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
            await db.website_leads.update_one({"_id": doc["_id"]}, {"$set": {"number": f"L-{int(seq['seq']):04d}"}})
            if doc.get("follow_up_on") and doc["follow_up_on"] >= crm.today_ist():
                await crm.plan_follow_up(db, doc)

        async def changed(doc, upd):
            lines = []
            if "status" in upd:
                lines.append(f"Odoo: moved to {crm.STATUSES.get(upd['status'], upd['status'])}")
                if upd["status"] in ("won", "lost"):
                    await db.website_leads.update_one({"_id": doc["_id"]}, {"$set": {"closed_at": _iso()}})
            if "assigned_to" in upd:
                lines.append(f"Odoo: given to {upd.get('assigned_to_name') or 'nobody'}")
            if "follow_up_on" in upd and upd["follow_up_on"]:
                lines.append(f"Odoo: next activity {crm.nice_day(upd['follow_up_on'])}" + (f" — {doc.get('follow_up_note')}" if doc.get("follow_up_note") else ""))
            if lines:
                await db.website_leads.update_one({"_id": doc["_id"]}, {"$push": {"activity": {"$each": [{"at": _iso(), "by": "Odoo sync", "type": "odoo", "text": t} for t in lines]}}})
            if {"follow_up_on", "status", "assigned_to"} & set(upd):
                await crm.plan_follow_up(db, await db.website_leads.find_one({"_id": doc["_id"]}))
        return await _upsert(db.website_leads, [{"odoo.model": "crm.lead", "odoo.id": rec["id"]}], new, create_extra, ref, name or title, dry,
                             on_create=numbered, on_update=changed)

    # quotations & orders → material quotations (read-only)
    async def apply_order(rec, extra, ctx, s, dry):
        lines_in = ctx["lines"].get(rec["id"], [])
        partner = ctx["partners"].get(_m2o_id(rec.get("partner_id")), {})
        any_igst = False
        lines = []
        products = {}
        pids = [_m2o_id(ln.get("product_id")) for ln in lines_in if ln.get("product_id")]
        if pids:
            async for it in db.inventory_items.find({"odoo.model": "product.product", "odoo.id": {"$in": pids}}, {"odoo.id": 1, "sku_code": 1, "hsn_code": 1}):
                products[it["odoo"]["id"]] = it
        notes = []
        for ln in lines_in:
            if ln.get("display_type") in ("line_section", "line_note"):
                if _str(ln.get("name"), 200):
                    notes.append(_str(ln.get("name"), 200))
                continue
            qty = float(ln.get("product_uom_qty") or 0)
            price = float(ln.get("price_unit") or 0)
            disc_pct = float(ln.get("discount") or 0)
            taxes = [ctx["taxes"].get(t, {}) for t in ln["_taxes"]]
            any_igst = any_igst or any(t.get("igst") for t in taxes)
            item = products.get(_m2o_id(ln.get("product_id")))
            text = _text(ln.get("name"), 600).split("\n")
            lines.append({"inventory_item_id": str(item["_id"]) if item else None, "name": text[0][:200] or (_m2o(ln.get("product_id")) or "Item"),
                          "description": " ".join(text[1:])[:300], "sku_code": (item or {}).get("sku_code") or "", "hsn_code": (item or {}).get("hsn_code") or "",
                          "quantity": qty, "unit": _str(ln["_uom"], 12) or "Nos", "unit_price": price, "discount_pct": disc_pct,
                          "discount_amount": round(qty * price * disc_pct / 100, 2), "bill_discount": 0,
                          "gst_percentage": round(sum(t.get("pct", 0) for t in taxes), 2), "gst_amount": round(float(ln.get("price_tax") or 0), 2),
                          "line_total": round(float(ln.get("price_total") or 0), 2), "cost_price": 0})
        untaxed, tax, total = float(rec.get("amount_untaxed") or 0), float(rec.get("amount_tax") or 0), float(rec.get("amount_total") or 0)
        subtotal = round(sum(l["quantity"] * l["unit_price"] for l in lines), 2)
        disc = round(sum(l["discount_amount"] for l in lines), 2)
        name = _str(rec.get("name"), 40)
        cust_name = _str(partner.get("name") or _m2o(rec.get("partner_id")), 120)
        lead = None
        opp = _m2o_id(rec.get("opportunity_id"))
        if opp:
            lead = await db.website_leads.find_one({"odoo.model": "crm.lead", "odoo.id": opp}, {"number": 1, "assigned_to": 1})
        status = ORDER_STATES.get(rec.get("state"), "draft")
        new = {
            "number": name, "revision": 0, "status": status, "source": "odoo", "read_only": True,
            "customer": {"name": cust_name or "Customer", "phone": mobile(partner.get("mobile") or partner.get("phone") or "") or "",
                         "email": _str(partner.get("email"), 120), "company": _str(_m2o(partner.get("parent_id")), 120),
                         "address": ", ".join(x for x in (_str(partner.get("street"), 120), _str(partner.get("street2"), 120), _str(partner.get("city"), 60),
                                                          re.sub(r"\D", "", _str(partner.get("zip"), 10))) if x),
                         "state": _state_name(partner.get("state_id")) or "Tamil Nadu", "gstin": re.sub(r"\s", "", _str(partner.get("vat"), 20)).upper()},
            "lines": lines, "subtotal": subtotal, "line_discount": disc, "header_discount": 0, "total_discount": disc, "discount_amount": 0,
            "taxable_value": round(untaxed, 2), "gst_total": round(tax, 2), "igst": round(tax, 2) if any_igst else 0,
            "cgst": 0 if any_igst else round(tax / 2, 2), "sgst": 0 if any_igst else round(tax - round(tax / 2, 2), 2),
            "round_off": round(total - untaxed - tax, 2), "auto_round": False, "grand_total": round(total, 2),
            "valid_until": str(rec.get("validity_date"))[:10] if rec.get("validity_date") else None,
            "quote_date": _ist_day(rec.get("date_order")), "subject": _str(rec.get("client_order_ref"), 160),
            "notes": "\n".join([_text(rec.get("note"), 1200)] + notes).strip()[:1500], "terms": [],
            "created_by_name": _m2o(rec.get("user_id")) or "Odoo",
            "lead_id": str(lead["_id"]) if lead else None, "lead_number": (lead or {}).get("number"), "lead_owner": (lead or {}).get("assigned_to"),
        }
        ref = _odoo_ref("sale.order", rec, extra)
        ref["state"] = rec.get("state")
        doc = await db.material_quotes.find_one({"odoo.model": "sale.order", "odoo.id": rec["id"]})
        title = f"{name} — {cust_name}"
        if dry:
            if not doc:
                return {"action": "created", "title": title, "changes": [{"field": "grand_total", "from": None, "to": new["grand_total"]}]}
            ch = [{"field": k, "from": doc.get(k), "to": v} for k, v in new.items() if k not in ("lines", "customer") and not _same(doc.get(k), v)]
            return {"action": "updated" if ch or doc.get("lines") != lines else "unchanged", "title": title, "changes": ch}
        now = _iso()
        if not doc:
            full = {**new, "odoo": {**ref, "synced_at": now}, "created_by": None, "location_id": ctx.get("location_id"),
                    "created_at": _odoo_dt(rec.get("create_date")) or now, "updated_at": now,
                    "history": [{"at": now, "by": "Odoo sync", "text": f"Brought in from Odoo ({rec.get('state')})"}]}
            res = await db.material_quotes.insert_one(full)
            if lead:
                await db.website_leads.update_one({"_id": lead["_id"]}, {"$inc": {"quote_count": 1}, "$push": {"activity": {
                    "at": now, "by": "Odoo sync", "type": "quote", "text": f"Odoo quotation {name} — ₹{round(total):,}"}}})
            return {"action": "created", "title": title, "changes": [], "id": str(res.inserted_id)}
        diff = any(not _same(doc.get(k), v) for k, v in new.items() if k not in ("lines", "customer")) or doc.get("lines") != lines or doc.get("customer") != new["customer"]
        if not diff and (doc.get("odoo") or {}).get("extra") == extra:
            return {"action": "unchanged", "title": title}
        push = {"history": {"at": now, "by": "Odoo sync", "text": f"Updated from Odoo ({rec.get('state')})"}} if diff else None
        upd: Dict[str, Any] = {"$set": {**new, "odoo": {**ref, "synced_at": now}, "updated_at": now}}
        if push:
            upd["$push"] = push
        await db.material_quotes.update_one({"_id": doc["_id"]}, upd)
        return {"action": "updated", "title": title, "changes": []}

    APPLY = {"contacts": apply_contact, "products": apply_product, "leads": apply_lead, "orders": apply_order}

    # ── every hour ──
    async def hourly_once() -> Optional[str]:
        s = await _settings()
        if not s.get("auto_hourly") or not s.get("key_enc") or not s.get("url"):
            return None
        last = s.get("last_auto_at")
        if last and _now() - datetime.fromisoformat(last) < timedelta(seconds=HOURLY_SECONDS - 120):
            return None
        names = [k for k in PRESETS if s["syncs"][k]["enabled"]] + [f"table:{t['key']}" for t in s["tables"] if t.get("enabled", True)]
        if not names:
            return None
        await db.odoo_settings.update_one({"_id": "main"}, {"$set": {"last_auto_at": _iso()}})
        try:
            return await start_run(names, "hourly", None)
        except HTTPException:
            return None   # a sync is already running

    async def scheduler():
        await asyncio.sleep(90)
        while True:
            try:
                await hourly_once()
            except Exception:   # noqa: BLE001
                logger.exception("Odoo hourly sync check failed")
            await asyncio.sleep(300)

    router.start_scheduler = lambda: asyncio.get_event_loop().create_task(scheduler())
    router.hourly_once = hourly_once
    router.start_run = start_run
    router.running = running
    return router


async def ensure_indexes(db) -> None:
    for coll, keys in ((db.customers, [("odoo.model", 1), ("odoo.id", 1)]), (db.vendors, [("odoo.model", 1), ("odoo.id", 1)]),
                       (db.inventory_items, [("odoo.model", 1), ("odoo.id", 1)]), (db.website_leads, [("odoo.model", 1), ("odoo.id", 1)]),
                       (db.material_quotes, [("odoo.model", 1), ("odoo.id", 1)]), (db.odoo_records, [("table", 1), ("odoo_id", 1)]),
                       (db.odoo_runs, [("started_at", -1)])):
        try:
            await coll.create_index(keys)
        except Exception:   # noqa: BLE001
            pass
