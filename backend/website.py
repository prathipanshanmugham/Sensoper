"""The public website (sensoper.in and shop.sensoper.in) and what staff manage for it (Nov 2026).

Public — no sign-in, served on the website's own domain through nginx (only /api/public/* and /api/client/*):
    GET  /api/public/site                  company details, WhatsApp number, live pop-ups, calculator prices
    POST /api/public/leads                 a lead from any form on the site (calculator, quote, contact, pop-up)
    GET  /api/public/shop/products         products staff put live on the shop
    GET  /api/public/shop/image/{id}/{n}   a shop product's picture
    POST /api/public/shop/order            an order request from the shop's cart (becomes a lead); delivery or pick-up
    GET  /api/public/brands/{id}/logo      the logo of a brand shown on the website
    GET  /api/public/testimonials/{id}/poster | video   a live testimonial's poster picture / uploaded video (HTTP Range)

Customer logins — staff create them, customers sign in on sensoper.in/account with their mobile number:
    POST /api/client/auth/login | logout | change-password,  GET /api/client/me
    GET  /api/client/projects/{id}/dashboard  (the same dashboard as the private customer link)
    POST /api/client/projects/{id}/tickets,  POST /api/client/projects/{id}/offers/{offer_id}/interest

Staff (Website page in the ERP, permission "Website"; changes need "Run the shop, pop-ups and website settings"):
    /api/website/summary, /api/website/leads…, /api/website/popups…, /api/website/settings, /api/website/shop/products…
    /api/website/testimonials… (+ /video upload), /api/website/stores…  (pick-up stores = ERP locations)
    /api/client-accounts…, /api/projects/{id}/client-login

Storage
    website_leads        {number, name, phone, kind, status, source, calc{}, items[], activity[], project_id…}
    website_popups       {title, message, cta_label, cta_action, cta_url, where, delay_seconds, valid_till, active}
    website_settings     {key: "main", whatsapp_number, call_number, show_price_estimate, shop_platform_id, site_url, shop_url}
    website_testimonials {name, place, system, quote, youtube_id, youtube_url | video_path, video_size, video_type,
                          poster_path, status (live|draft), order}
    locations.pickup     {enabled, public_name, address, phone, hours, lat, lng}   (on the ERP's own locations)
    brands.on_website    see brands.shown_on_website
    client_accounts      {name, phone, password_hash, password_version, must_change_password, project_ids[], active…}
    website_lead_hits    {ip, at}   (rate limit for the public forms)
    client_login_attempts {phone, ip, at}
"""
from __future__ import annotations

import math
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

import anyio
import jwt
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

try:   # python-multipart ≥ 0.0.13 names its module python_multipart; older ones only "multipart"
    from python_multipart.multipart import MultipartParser, parse_options_header
except ImportError:  # pragma: no cover
    from multipart.multipart import MultipartParser, parse_options_header

import notify
from brands import shown_on_website
from customer_portal import TicketIn, company_info, offer_interest_for, project_dashboard, raise_ticket_for

IST = timezone(timedelta(hours=5, minutes=30))
CLIENT_COOKIE = "sp_client"
CLIENT_COOKIE_PATH = "/api/client"
CLIENT_SESSION_DAYS = 30
LOGIN_TRIES, LOGIN_WINDOW_MIN = 6, 15
LEAD_HITS, LEAD_WINDOW_MIN = 12, 10       # the number box and the quiz each count; many phones share one carrier IP
SHOP_PLATFORM_NAME = "Sensoper shop (shop.sensoper.in)"

KINDS = {
    "home": "Home rooftop", "farm": "Farm / solar pump", "business": "Business / factory", "battery": "Battery, UPS & inverter",
    "service": "Service, AMC & cleaning", "shop_order": "Shop order", "other": "Something else",
}
STATUSES = {
    "new": "New", "contacted": "Called", "site_visit": "Site visit booked", "quoted": "Quote sent",
    "won": "Won", "lost": "Not going ahead",
}
OPEN_STATUSES = ("new", "contacted", "site_visit", "quoted")
SOURCES = {"calculator": "Savings calculator", "quote": "Free quote form", "contact": "Contact form", "popup": "Pop-up",
           "shop": "Shop", "service": "Service request", "account": "Customer login page", "quick": "Mobile number box",
           "quiz": "Free solar plan quiz", "header": "Header button", "subsidy": "Subsidy section", "how": "How it works section",
           "solutions": "Solutions section", "backup": "Battery backup section", "mobile-bar": "Phone bottom bar",
           "systems": "Systems section (on-grid, off-grid, battery, pump)"}
POPUP_ACTIONS = ("quote", "whatsapp", "shop", "link", "none")
POPUP_WHERE = ("site", "shop", "both")
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}   # never SVG: it can carry script
UTM_KEYS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid")
DEFAULT_SITE_URL = "https://quote.sensoper.in"
PICTURE_HEADERS = {"Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff",
                   "Content-Security-Policy": "default-src 'none'; sandbox"}
VIDEO_TYPES = {"mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime"}
VIDEO_MAX_BYTES = 100 * 1024 * 1024
VIDEO_CHUNK = 256 * 1024
QUOTE_MAX = 400
TESTIMONIALS_SHOWN, BRANDS_SHOWN = 24, 60
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"}
YOUTUBE_ID = re.compile(r"[A-Za-z0-9_-]{11}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


def _digits(v: Any) -> str:
    return re.sub(r"\D", "", str(v or ""))


def mobile(v: Any) -> Optional[str]:
    """A 10-digit Indian mobile number from whatever was typed (+91, spaces, a leading 0) — or None."""
    d = _digits(v)
    if len(d) == 12 and d.startswith("91"):
        d = d[2:]
    elif len(d) == 11 and d.startswith("0"):
        d = d[1:]
    return d if len(d) == 10 and d[0] in "6789" else None


def _clean(text: Any, limit: int) -> str:
    """Plain, single-spaced text without tags or control characters. Cut to size first, so a huge input costs nothing."""
    s = re.sub(r"<[^<>]*>", " ", str(text or "")[: max(limit, 1) * 4])
    s = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", s)
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s[:limit]


def _num(v: Any, lo: float = 0, hi: float = 1e9) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or math.isinf(f):
        return None
    return round(min(max(f, lo), hi), 2)


def _oid(v: str, what: str = "record") -> ObjectId:
    if not v or not ObjectId.is_valid(v):
        raise HTTPException(status_code=404, detail=f"That {what} doesn't exist")
    return ObjectId(v)


def temp_password() -> str:
    """Easy to read out and type on a phone: 4 letters + 4 digits, no look-alike characters."""
    return "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz") for _ in range(4)) + "".join(secrets.choice("23456789") for _ in range(4))


def _client_ip(request: Request) -> str:
    """The visitor's address as our nginx saw it — the LAST X-Forwarded-For entry (nginx appends the real one;
    anything before it was sent by the visitor and can be made up)."""
    fwd = request.headers.get("x-forwarded-for", "")
    last = fwd.split(",")[-1].strip() if fwd else ""
    return last or (request.client.host if request.client else "")


def clean_calc(calc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep only the calculator figures we show staff, as numbers within sane limits."""
    if not isinstance(calc, dict):
        return {}
    out: Dict[str, Any] = {}
    mode = str(calc.get("mode") or "")
    if mode in ("home", "farm", "business"):
        out["mode"] = mode
    for key, hi in (("bill", 1e7), ("units", 1e6), ("kw", 5000), ("subsidy", 1e6), ("price", 1e9), ("net_price", 1e9),
                    ("monthly_saving", 1e7), ("yearly_saving", 1e8), ("payback_years", 100), ("pump_hp", 200)):
        n = _num(calc.get(key), 0, hi)
        if n is not None:
            out[key] = n
    return out


def inr(n: Any) -> str:
    """₹2,14,760 — Indian digit grouping."""
    try:
        v = int(round(float(n)))
    except (TypeError, ValueError):
        return "₹0"
    sign, s = ("-" if v < 0 else ""), str(abs(v))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = ",".join([head[max(i - 2, 0):i] for i in range(len(head), 0, -2)][::-1])
        s = f"{head},{tail}"
    return f"{sign}₹{s}"


def youtube_id(url: Any) -> Optional[str]:
    """The 11-character video id from a YouTube link — watch?v=, youtu.be/, /shorts/, /embed/, /live/ — or None.
    Links to any other site are refused, so the website only ever embeds YouTube."""
    s = str(url or "").strip()
    if not s or len(s) > 500 or re.search(r"[\s<>\"'\\]", s):
        return None
    if not re.match(r"^[a-z][a-z0-9+.-]*://", s, re.I):
        s = "https://" + s                          # "youtu.be/…" pasted without the https://
    try:
        u = urlsplit(s)
        port = u.port
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    if u.scheme.lower() not in ("http", "https") or u.username or u.password or port not in (None, 80, 443):
        return None
    cand = ""
    if host in ("youtu.be", "www.youtu.be"):
        cand = u.path.lstrip("/").split("/")[0]
    elif host in YOUTUBE_HOSTS:
        if u.path.rstrip("/") == "/watch":
            cand = (parse_qs(u.query).get("v") or [""])[0]
        else:
            m = re.match(r"^/(?:shorts|embed|live|v)/([^/]+)/?$", u.path)
            cand = m.group(1) if m else ""
    return cand if YOUTUBE_ID.fullmatch(cand or "") else None


def site_address(v: Any) -> Optional[str]:
    """An https:// web address for the settings, without a trailing slash ('' when empty) — or None when it isn't one."""
    s = str(v or "").strip().rstrip("/")
    if not s:
        return ""
    m = re.fullmatch(r"https://([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(:\d{2,5})?(/[A-Za-z0-9._~/-]*)?", s, re.I)
    if not m or len(s) > 200 or "//" in (m.group(3) or ""):
        return None
    return "https://" + m.group(1).lower() + (m.group(2) or "") + (m.group(3) or "")


def store_phone(v: Any) -> Optional[str]:
    """A store's phone: a 10-digit mobile, or a landline with its STD code kept as 0 + 10 digits ('' when empty) — or None."""
    d = _digits(v)
    if not d:
        return ""
    if len(d) == 12 and d.startswith("91"):
        d = d[2:]
    elif len(d) == 11 and d.startswith("0"):
        d = d[1:]
    if len(d) != 10 or d[0] == "0":
        return None
    return d if d[0] in "6789" else "0" + d


def coordinates(text: Any) -> Optional[Tuple[float, float]]:
    """(lat, lng) from what was pasted out of Google Maps — '11.2712, 77.5845' or a maps link with @lat,lng in it.
    None when empty; ValueError (with a message for staff) when it isn't a place in India."""
    s = str(text or "").strip()[:2000]
    if not s:
        return None
    m = (re.search(r"@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)", s) if "/" in s else None) or \
        re.search(r"(?:[?&](?:q|query|destination|ll)=)(-?\d{1,3}(?:\.\d+)?)(?:,|%2C)\s*(-?\d{1,3}(?:\.\d+)?)", s, re.I) or \
        re.fullmatch(r"\s*\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*N?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*E?\s*\)?\s*", s, re.I)
    if not m:
        raise ValueError("Coordinates should be two numbers like 11.2712, 77.5845 — latitude first, then longitude.")
    lat, lng = float(m.group(1)), float(m.group(2))
    if not (6 <= lat <= 37 and 68 <= lng <= 98):
        if 6 <= lng <= 37 and 68 <= lat <= 98:
            raise ValueError("Those numbers look swapped — put latitude first (for example 11.2712, 77.5845).")
        raise ValueError("Those coordinates aren't in India. Copy them again from Google Maps (for example 11.2712, 77.5845).")
    return round(lat, 6), round(lng, 6)


def byte_range(header: Optional[str], size: int) -> Optional[Tuple[int, int]]:
    """The (first, last) byte asked for in a Range header, or None to send the whole file. A range we can't serve
    raises LookupError (→ 416). A unit other than bytes, or several ranges at once, gets the whole file (RFC 9110)."""
    h = (header or "").strip()
    if not h:
        return None
    unit, _, spec = h.partition("=")
    if unit.strip().lower() != "bytes":
        return None
    if "," in spec:
        return None
    m = re.fullmatch(r"\s*(\d{0,19})\s*-\s*(\d{0,19})\s*", spec)
    if not m or not (m.group(1) or m.group(2)) or size <= 0:
        raise LookupError("unsatisfiable")
    a, b = m.groups()
    if not a:                                        # the last N bytes
        n = int(b)
        if n == 0:
            raise LookupError("unsatisfiable")
        return max(size - n, 0), size - 1
    first = int(a)
    last = int(b) if b else size - 1
    if first >= size or last < first:
        raise LookupError("unsatisfiable")
    return first, min(last, size - 1)


def public_link(v: Any) -> str:
    """A brand's own website as a safe https link for the public site ('' when it isn't a plain web address)."""
    s = str(v or "").strip()
    if not s or len(s) > 300 or re.search(r"[\s<>\"'\\]", s):
        return ""
    if not re.match(r"^https?://", s, re.I):
        if not re.match(r"^[a-z0-9-]+(\.[a-z0-9-]+)+(/|$)", s, re.I):
            return ""
        s = "https://" + s
    try:
        u = urlsplit(s)
    except ValueError:
        return ""
    if u.scheme.lower() not in ("http", "https") or not u.hostname or u.username or u.password:
        return ""
    return s


def lead_summary(lead: Dict[str, Any]) -> str:
    """One line for the bell and the list: 'Home rooftop — ₹4,500 bill, about 3 kW · Perundurai'."""
    bits = [KINDS.get(lead.get("kind"), "Enquiry")]
    c = lead.get("calc") or {}
    extra = []
    if c.get("bill"):
        extra.append(f"{inr(c['bill'])} bill")
    if c.get("kw"):
        extra.append(f"about {c['kw']:g} kW")
    if c.get("pump_hp"):
        extra.append(f"{c['pump_hp']:g} HP pump")
    if lead.get("order_total"):
        extra.append(f"{inr(lead['order_total'])} order")
    if extra:
        bits.append(", ".join(extra))
    place = lead.get("area") or lead.get("pincode")
    return " — ".join(bits) + (f" · {place}" if place else "")


# ───────────────────────── request bodies ─────────────────────────
class LeadIn(BaseModel):
    name: str = Field("", max_length=200)
    phone: str = Field("", max_length=40)
    email: Optional[str] = Field("", max_length=200)
    pincode: Optional[str] = Field("", max_length=20)
    area: Optional[str] = Field("", max_length=200)
    kind: Optional[str] = Field("home", max_length=20)
    message: Optional[str] = Field("", max_length=4000)
    source: Optional[str] = Field("quote", max_length=20)
    page: Optional[str] = Field("", max_length=500)
    calc: Optional[Dict[str, Any]] = None
    utm: Optional[Dict[str, Any]] = None
    best_time: Optional[str] = Field("", max_length=100)
    website: Optional[str] = Field("", max_length=500)          # honeypot — people never see or fill it


class OrderLineIn(BaseModel):
    id: str = Field(max_length=40)
    qty: float = 1


class OrderIn(BaseModel):
    name: str = Field("", max_length=200)
    phone: str = Field("", max_length=40)
    address: Optional[str] = Field("", max_length=1000)
    pincode: Optional[str] = Field("", max_length=20)
    delivery: Optional[str] = Field("delivery", max_length=20)     # delivery | pickup
    message: Optional[str] = Field("", max_length=2000)
    items: List[OrderLineIn] = Field(default_factory=list, max_length=50)
    store_id: Optional[str] = Field(None, max_length=40)            # the pick-up store (an ERP location) when delivery == pickup
    utm: Optional[Dict[str, Any]] = None
    website: Optional[str] = Field("", max_length=500)


class LeadUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None
    assigned_to: Optional[str] = None
    follow_up_on: Optional[str] = None
    lost_reason: Optional[str] = None
    project_id: Optional[str] = None


class PopupIn(BaseModel):
    title: str
    message: str = ""
    cta_label: Optional[str] = ""
    cta_action: str = "quote"
    cta_url: Optional[str] = ""
    where: str = "site"
    delay_seconds: int = 6
    valid_till: Optional[str] = None
    active: bool = True


class SettingsIn(BaseModel):
    whatsapp_number: Optional[str] = None
    show_price_estimate: Optional[bool] = None
    call_number: Optional[str] = None
    site_url: Optional[str] = Field(None, max_length=500)          # "Main website address" ("" = https://quote.sensoper.in)
    shop_url: Optional[str] = Field(None, max_length=500)          # "Shop address" ("" = <site>/shop/)


class TestimonialIn(BaseModel):
    name: str = Field("", max_length=300)
    place: Optional[str] = Field("", max_length=300)
    system: Optional[str] = Field("", max_length=300)
    quote: Optional[str] = Field("", max_length=4000)              # checked against QUOTE_MAX with a plain message
    youtube_url: Optional[str] = Field("", max_length=1000)
    video_path: Optional[str] = Field("", max_length=300)
    poster_path: Optional[str] = Field("", max_length=300)
    status: Optional[str] = Field("live", max_length=20)           # live | draft
    order: Optional[Any] = 0


class StoreIn(BaseModel):
    enabled: bool = False
    public_name: Optional[str] = Field("", max_length=300)
    address: Optional[str] = Field("", max_length=1000)
    phone: Optional[str] = Field("", max_length=60)
    hours: Optional[str] = Field("", max_length=300)
    coordinates: Optional[str] = Field("", max_length=2000)


class ShopProductIn(BaseModel):
    inventory_item_id: Optional[str] = None
    price: Optional[float] = None
    title: Optional[str] = None
    description: Optional[str] = None
    images: Optional[List[str]] = None
    featured: Optional[bool] = None
    status: Optional[str] = None             # live | draft


class ClientAccountIn(BaseModel):
    name: str = ""
    phone: str = ""
    project_ids: List[str] = []


class ClientAccountUpdate(BaseModel):
    name: Optional[str] = None
    project_ids: Optional[List[str]] = None
    active: Optional[bool] = None


class ClientLogin(BaseModel):
    phone: str = Field("", max_length=40)
    password: str = Field("", max_length=200)


class ClientPasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


async def ensure_indexes(db) -> None:
    """Fast look-ups for the public forms and logins; the attempt logs clean themselves up after a day."""
    for coll, keys, opts in (
        ("website_lead_hits", [("at", 1)], {"expireAfterSeconds": 86400}),
        ("website_lead_hits", [("ip", 1), ("bucket", 1), ("at", 1)], {}),
        ("client_login_attempts", [("at", 1)], {"expireAfterSeconds": 86400}),
        ("client_login_attempts", [("phone", 1), ("ip", 1), ("at", 1)], {}),
        ("client_accounts", [("phone", 1)], {"unique": True}),
        ("client_accounts", [("project_ids", 1)], {}),
        ("website_leads", [("phone", 1), ("status", 1), ("created_at", -1)], {}),
        ("website_leads", [("status", 1), ("last_submitted_at", -1)], {}),
    ):
        try:
            await db[coll].create_index(keys, **opts)
        except Exception:   # an old index with other options — leave it, the app works without
            pass


def create_router(db, get_current_user, require_role, create_audit_log, jwt_secret: str, hash_password, verify_password,
                  get_permissions, check_module_permission, app_name: str = "sensoper", get_object=None, storage_path=None):
    """get_object(path) → (bytes, content type) reads a small stored file; storage_path(path) → the file's place on disk
    (refusing anything outside the storage folder) — used to stream videos in and out without holding them in memory."""
    router = APIRouter(tags=["website"])
    picture_rx = re.compile(rf"{re.escape(app_name)}/images/[\w\-]+\.(png|jpe?g|webp|gif)", re.I)
    video_rx = re.compile(rf"{re.escape(app_name)}/videos/[0-9a-f]{{32}}\.(mp4|webm|mov)")

    # ───────────────────────── shared helpers ─────────────────────────
    async def _settings() -> Dict[str, Any]:
        s = await db.website_settings.find_one({"key": "main"}) or {}
        return {"whatsapp_number": s.get("whatsapp_number") or "", "call_number": s.get("call_number") or "",
                "show_price_estimate": s.get("show_price_estimate", True), "shop_platform_id": s.get("shop_platform_id"),
                "site_url": s.get("site_url") or "", "shop_url": s.get("shop_url") or ""}

    async def _site_editor(request: Request) -> Dict[str, Any]:
        """Changing what the public sees (testimonials, pick-up stores) — the same people who run the shop and pop-ups:
        admins, and managers (or anyone an admin gives it to) while their role has 'Run the shop, pop-ups and website
        settings' switched on in Settings → Permissions."""
        user = await require_role("admin", "manager")(request)
        if user.get("role") != "admin":
            perms = await get_permissions(user.get("role"))
            if not perms.get("can_manage_website") or not (perms.get("module_website") or {}).get("view"):
                raise HTTPException(status_code=403, detail="Your role isn’t allowed to run the shop, pop-ups and website settings. "
                                                            "An admin can change this in Settings → Permissions.")
        return user

    def _send_picture(ref: Any, folders=("images",)) -> Response:
        """A stored picture for the public site: only from our own upload folders, only raster images, safe headers."""
        path = str(ref or "").split("/api/files/", 1)[-1].lstrip("/")
        if (get_object is None or ".." in path or "\\" in path or len(path) > 300
                or not any(path.startswith(f"{app_name}/{f}/") for f in folders)):
            raise HTTPException(status_code=404, detail="Picture not found")
        try:
            data, ctype = get_object(path)
        except Exception:
            raise HTTPException(status_code=404, detail="Picture not found")
        if str(ctype).split(";")[0].strip().lower() not in IMAGE_TYPES:
            raise HTTPException(status_code=404, detail="Picture not found")
        return Response(content=data, media_type=ctype, headers=dict(PICTURE_HEADERS))

    def _video_file(path: Any):
        """The video's place on disk — only files our upload made (videos/<random>.mp4|webm|mov)."""
        p = str(path or "")
        if storage_path is None or not video_rx.fullmatch(p):
            return None
        try:
            full = storage_path(p)
        except ValueError:
            return None
        return full if full.is_file() else None

    async def _drop_video(path: Any, keep_id: Optional[ObjectId] = None) -> None:
        """Delete an uploaded video nobody uses any more (a testimonial's old video, or a deleted testimonial's)."""
        full = _video_file(path)
        if not full:
            return
        others = {"video_path": path}
        if keep_id is not None:
            others["_id"] = {"$ne": keep_id}
        if await db.website_testimonials.count_documents(others):
            return
        for f in (full, full.with_suffix(full.suffix + ".meta")):
            try:
                f.unlink()
            except OSError:
                pass

    def _urls(s: Dict[str, Any]) -> Dict[str, str]:
        return {"site": site_address(s.get("site_url")) or DEFAULT_SITE_URL, "shop": site_address(s.get("shop_url")) or ""}

    def _logo_ref(b: Dict[str, Any]) -> Optional[str]:
        path = str(b.get("logo_path") or "")
        ok = re.fullmatch(rf"{re.escape(app_name)}/(images|documents)/[\w\-]+\.(png|jpe?g|webp|gif)", path, re.I)
        return f"/api/public/brands/{b['_id']}/logo" if ok else None

    async def _public_brands() -> List[Dict[str, Any]]:
        out = []
        async for b in db.brands.find({"active": {"$ne": False}}):
            if not shown_on_website(b):
                continue
            out.append({"id": str(b["_id"]), "name": str(b.get("name") or "").strip(), "kind": b.get("kind") or "dealership",
                        "categories": [str(c) for c in b.get("categories") or [] if str(c).strip()], "logo": _logo_ref(b),
                        "website": public_link(b.get("website"))})
        out.sort(key=lambda b: b["name"].lower())
        return out[:BRANDS_SHOWN]

    def _testimonial_public(t: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        tid = str(t["_id"])
        if t.get("youtube_id") and YOUTUBE_ID.fullmatch(t["youtube_id"]):
            video = {"type": "youtube", "id": t["youtube_id"]}
        elif t.get("video_path") and video_rx.fullmatch(str(t["video_path"])):
            video = {"type": "file", "url": f"/api/public/testimonials/{tid}/video",
                     "mime": VIDEO_TYPES[str(t["video_path"]).rsplit(".", 1)[-1]]}
        else:
            return None
        return {"id": tid, "name": t.get("name") or "", "place": t.get("place") or "", "system": t.get("system") or "",
                "quote": t.get("quote") or "", "video": video,
                "poster": f"/api/public/testimonials/{tid}/poster" if t.get("poster_path") else None}

    async def _live_testimonials() -> List[Dict[str, Any]]:
        rows = await db.website_testimonials.find({"status": "live"}).sort([("order", 1), ("created_at", -1)]).to_list(200)
        return [o for o in (_testimonial_public(t) for t in rows) if o][:TESTIMONIALS_SHOWN]

    def _store_name(loc: Dict[str, Any]) -> str:
        p = loc.get("pickup") or {}
        return p.get("public_name") or str(loc.get("name") or "").replace("_", " ").strip() or "Sensoper store"

    async def _pickup_stores() -> List[Dict[str, Any]]:
        out = []
        async for loc in db.locations.find({"active": {"$ne": False}, "pickup.enabled": True}):
            p = loc.get("pickup") or {}
            lat, lng = p.get("lat"), p.get("lng")
            here = isinstance(lat, (int, float)) and isinstance(lng, (int, float))
            out.append({"id": str(loc["_id"]), "name": _store_name(loc), "address": p.get("address") or "",
                        "district": loc.get("district") or "", "phone": p.get("phone") or "", "hours": p.get("hours") or "",
                        "lat": lat if here else None, "lng": lng if here else None,
                        "directions": f"https://www.google.com/maps/dir/?api=1&destination={lat},{lng}" if here else ""})
        out.sort(key=lambda x: x["name"].lower())
        return out

    async def _shop_platform(create: bool = False) -> Optional[Dict[str, Any]]:
        """The platform the shop's products are listed on (an Online orders platform of type 'custom website')."""
        s = await _settings()
        if s.get("shop_platform_id") and ObjectId.is_valid(s["shop_platform_id"]):
            p = await db.ecommerce_platforms.find_one({"_id": ObjectId(s["shop_platform_id"]), "active": {"$ne": False}})
            if p:
                return p
        found = None
        async for p in db.ecommerce_platforms.find({"platform_type": "custom_website", "active": {"$ne": False}}):
            name = (p.get("name") or "").lower()
            if "shop" in name or "sensoper" in name:
                found = p
                if "shop" in name:
                    break
        if not found and create:
            doc = {"name": SHOP_PLATFORM_NAME, "platform_type": "custom_website", "seller_id": "", "store_url": "https://shop.sensoper.in",
                   "commission_pct": 0.0, "api_credentials_ref": "", "onboarded_date": _now().astimezone(IST).date().isoformat(),
                   "active": True, "created_at": _iso()}
            res = await db.ecommerce_platforms.insert_one(doc)
            found = {**doc, "_id": res.inserted_id}
        if found:
            await db.website_settings.update_one({"key": "main"}, {"$set": {"shop_platform_id": str(found["_id"])}}, upsert=True)
        return found

    async def _company_public() -> Dict[str, Any]:
        c = await company_info(db)
        s = await _settings()
        phone = mobile(s.get("call_number")) or mobile(c.get("phone")) or ""
        wa = mobile(s.get("whatsapp_number")) or phone
        return {"name": c.get("name"), "tagline": c.get("tagline"), "phone": phone, "whatsapp": wa, "email": c.get("email") or "",
                "address": c.get("address") or ""}

    def _popup_out(p: Dict[str, Any]) -> Dict[str, Any]:
        return {"id": str(p["_id"]), "title": p.get("title", ""), "message": p.get("message", ""), "cta_label": p.get("cta_label") or "",
                "cta_action": p.get("cta_action") or "none", "cta_url": p.get("cta_url") or "", "where": p.get("where") or "site",
                "delay_seconds": int(p.get("delay_seconds") or 0), "valid_till": p.get("valid_till"), "active": bool(p.get("active", True)),
                "updated_at": p.get("updated_at"), "created_by_name": p.get("created_by_name")}

    async def _live_popups() -> List[Dict[str, Any]]:
        today = _now().astimezone(IST).date().isoformat()
        out = []
        async for p in db.website_popups.find({"active": True}).sort("updated_at", -1).limit(10):
            if p.get("valid_till") and p["valid_till"] < today:
                continue
            o = _popup_out(p)
            out.append({k: o[k] for k in ("id", "title", "message", "cta_label", "cta_action", "cta_url", "where", "delay_seconds")})
        return out

    async def _price_table() -> Dict[str, Any]:
        """₹ per kW for the calculator's 'about ₹…' line — only Price list → Package slabs (the rates quoted to customers);
        the calculator's internal per-kW benchmark is never published."""
        slabs: Dict[str, List[Dict[str, Any]]] = {}
        async for d in db.pricing_slabs.find({"active": {"$ne": False}, "unit": "kw"}):
            rows = [{"from": s.get("from_value"), "to": s.get("to_value"), "rate": s.get("rate_per_unit")} for s in d.get("slabs") or []
                    if s.get("rate_per_unit")]
            if rows:
                slabs[d.get("category")] = rows
        return {"per_kw": {}, "slabs": slabs}

    async def _rate_limit(request: Request, bucket: str):
        ip = _client_ip(request)
        since = _now() - timedelta(minutes=LEAD_WINDOW_MIN)
        n = await db.website_lead_hits.count_documents({"ip": ip, "bucket": bucket, "at": {"$gte": since}})
        if n >= LEAD_HITS:
            raise HTTPException(status_code=429, detail="We've got your details already — we'll call you soon. For anything urgent, call or WhatsApp us.")
        await db.website_lead_hits.insert_one({"ip": ip, "bucket": bucket, "at": _now()})
        return ip

    async def _next_number() -> str:
        doc = await db.counters.find_one_and_update({"_id": "website_lead"}, {"$inc": {"seq": 1}}, upsert=True,
                                                    return_document=ReturnDocument.AFTER)
        return f"WL-{int(doc['seq']):04d}"

    async def _tell_staff(lead: Dict[str, Any], again: bool = False):
        try:
            users = await notify.users_who_can(db, get_permissions, "module_website", "view")
            who = lead.get("name") or "Someone"
            title = (f"{who} asked again on the website" if again else
                     (f"New shop order request from {who}" if lead.get("kind") == "shop_order" else
                      f"New website lead: {who}" if lead.get("name") else f"Someone left their number on the website: {lead.get('phone')}"))
            await notify.plan(db, kind="website_lead", source_type="website_lead", source_id=str(lead["_id"]), user_ids=users,
                              title=title, message=lead_summary(lead), link=f"/dashboard/website?lead={lead['_id']}",
                              tag=f"submission-{lead.get('submissions', 1)}")
        except Exception:   # the lead is saved either way
            pass

    async def _save_lead(fields: Dict[str, Any], ip: str) -> Dict[str, Any]:
        """New lead, or — when the same number already has an open lead from the last 30 days — add to that one."""
        now = _iso()
        since = (_now() - timedelta(days=30)).isoformat()
        existing = await db.website_leads.find_one({"phone": fields["phone"], "status": {"$in": list(OPEN_STATUSES)}, "created_at": {"$gte": since}},
                                                   sort=[("created_at", -1)])
        entry = {"at": now, "by": "Website", "type": "submitted", "text": SOURCES.get(fields.get("source"), "Website form"),
                 "kind": fields.get("kind")}
        if existing:
            # Anyone can type someone else's number, so a repeat enquiry only fills gaps — it never replaces the name,
            # email or address staff already have. What they typed this time goes into the timeline instead.
            upd: Dict[str, Any] = {k: fields[k] for k in ("kind", "calc", "source", "page") if fields.get(k)}
            for k in ("name", "email", "area", "pincode", "best_time", "message"):
                if fields.get(k) and not existing.get(k):
                    upd[k] = fields[k]
            if fields.get("utm") and not existing.get("utm"):
                upd["utm"] = fields["utm"]
            upd.update({"last_submitted_at": now, "needs_attention": True, "updated_at": now})
            differs = [f"{label}: {fields[k]}" for k, label in (("name", "name"), ("email", "email"), ("area", "area"), ("pincode", "PIN"))
                       if fields.get(k) and existing.get(k) and fields[k] != existing[k]]
            if fields.get("message"):
                entry["text"] += f": {fields['message'][:300]}"
            if differs:
                entry["text"] += f" (typed a different {'; '.join(differs)})"
            await db.website_leads.update_one({"_id": existing["_id"]}, {"$set": upd, "$inc": {"submissions": 1}, "$push": {"activity": entry}})
            lead = await db.website_leads.find_one({"_id": existing["_id"]})
            await _tell_staff(lead, again=bool(existing.get("name")))
            return lead
        doc = {**fields, "number": await _next_number(), "status": "new", "needs_attention": True, "submissions": 1, "ip": ip,
               "created_at": now, "updated_at": now, "last_submitted_at": now, "activity": [entry]}
        res = await db.website_leads.insert_one(doc)
        doc["_id"] = res.inserted_id
        await _tell_staff(doc)
        return doc

    def _lead_out(l: Dict[str, Any]) -> Dict[str, Any]:
        out = {k: v for k, v in l.items() if k not in ("_id", "ip")}
        out["id"] = str(l["_id"])
        out["kind_label"] = KINDS.get(l.get("kind"), "Enquiry")
        out["status_label"] = STATUSES.get(l.get("status"), l.get("status"))
        out["source_label"] = SOURCES.get(l.get("source"), "Website")
        out["summary"] = lead_summary(l)
        return out

    # ───────────────────────── public: the website ─────────────────────────
    @router.get("/public/site")
    async def public_site(response: Response, where: str = "site"):
        response.headers["Cache-Control"] = "public, max-age=60"
        s = await _settings()
        popups = [p for p in await _live_popups() if p["where"] in ("both", "shop" if where == "shop" else "site")]
        shop = await _shop_platform()
        live = await db.ecommerce_listings.count_documents({"platform_id": str(shop["_id"]), "status": "live",
                                                             "superseded_by": {"$exists": False}}) if shop else 0
        return {"company": await _company_public(), "popups": popups, "shop": {"products": live},
                "prices": (await _price_table()) if s.get("show_price_estimate", True) else None,
                "urls": _urls(s), "brands": await _public_brands(), "testimonials": await _live_testimonials(),
                "stores": await _pickup_stores()}

    @router.post("/public/leads")
    async def public_lead(body: LeadIn, request: Request):
        if body.website:   # a bot filled the hidden field — say thanks and drop it
            return {"ok": True, "number": None}
        phone = mobile(body.phone)
        if not phone:
            raise HTTPException(status_code=400, detail="Enter a 10-digit mobile number so we can call you back.")
        ip = await _rate_limit(request, "lead")
        name = _clean(body.name, 80)
        # the hero's mobile-number box saves the number straight away (so a call-back happens even if they stop there);
        # the quiz that follows fills in the name
        if len(name) < 2 and body.source != "quick":
            raise HTTPException(status_code=400, detail="Tell us your name.")
        pin = _digits(body.pincode)[:6]
        kind = body.kind if body.kind in KINDS and body.kind != "shop_order" else "other"
        email = _clean(body.email, 120)
        fields = {
            "name": name, "phone": phone, "email": email if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email or "") else "",
            "pincode": pin if len(pin) == 6 else "", "area": _clean(body.area, 80), "kind": kind,
            "message": _clean(body.message, 1000), "source": body.source if body.source in SOURCES else "quote",
            "page": _clean(body.page, 200), "calc": clean_calc(body.calc), "best_time": _clean(body.best_time, 40),
            "utm": {k: _clean(v, 120) for k, v in (body.utm or {}).items() if k in UTM_KEYS and v},
        }
        lead = await _save_lead(fields, ip)
        return {"ok": True, "number": lead.get("number")}

    async def _live_products() -> List[Dict[str, Any]]:
        shop = await _shop_platform()
        if not shop:
            return []
        listings = await db.ecommerce_listings.find({"platform_id": str(shop["_id"]), "status": "live",
                                                     "superseded_by": {"$exists": False}}).to_list(2000)
        ids = [ObjectId(l["inventory_item_id"]) for l in listings if ObjectId.is_valid(l.get("inventory_item_id") or "")]
        items = {str(i["_id"]): i for i in await db.inventory_items.find({"_id": {"$in": ids}}).to_list(2000)}
        out = []
        for l in listings:
            item = items.get(l.get("inventory_item_id"))
            price = _num(l.get("listed_price"), 0)
            if not item or not price:
                continue
            qty = float(item.get("quantity") or 0)
            low = float(item.get("min_stock_level") or item.get("reorder_level") or 0)
            out.append({
                "id": str(l["_id"]), "title": l.get("listing_title") or item.get("name") or "Product",
                "description": l.get("description") or "", "category": item.get("category") or "other",
                "brand": item.get("brand") or "", "price": price, "featured": bool(l.get("featured")),
                "images": [str(ref) if str(ref).startswith("https://") else f"/api/public/shop/image/{l['_id']}/{n}"
                           for n, ref in enumerate(l.get("images") or [])],
                "stock": "in_stock" if qty > max(low, 0) else ("low" if qty > 0 else "on_order"),
                "watt": item.get("wattage_w") or None, "gst_pct": item.get("gst_percentage") if item.get("gst_percentage") is not None else item.get("gst_pct"),
                "updated_at": l.get("updated_at"),
            })
        out.sort(key=lambda p: (not p["featured"], p["category"], p["title"].lower()))
        return out

    async def _category_labels() -> Dict[str, str]:
        labels = {}
        async for c in db.inventory_categories.find({}, {"slug": 1, "name": 1, "key": 1, "label": 1}):
            key = c.get("slug") or c.get("key")
            if key:
                labels[key] = c.get("name") or c.get("label") or key
        return labels

    @router.get("/public/shop/products")
    async def public_products(response: Response):
        response.headers["Cache-Control"] = "public, max-age=60"
        products = await _live_products()
        labels = await _category_labels()
        cats: Dict[str, int] = {}
        for p in products:
            cats[p["category"]] = cats.get(p["category"], 0) + 1
            p["category_label"] = labels.get(p["category"]) or p["category"].replace("_", " ").title()
        return {"products": products,
                "categories": [{"key": k, "label": labels.get(k) or k.replace("_", " ").title(), "count": n} for k, n in sorted(cats.items())]}

    @router.get("/public/shop/image/{listing_id}/{n}")
    async def public_product_image(listing_id: str, n: int):
        shop = await _shop_platform()
        l = await db.ecommerce_listings.find_one({"_id": _oid(listing_id, "picture"), "status": "live",
                                                  "platform_id": str(shop["_id"]) if shop else "__none__"})
        imgs = (l or {}).get("images") or []
        if not l or n < 0 or n >= len(imgs):
            raise HTTPException(status_code=404, detail="Picture not found")
        ref = str(imgs[n])
        if ref.startswith("https://") or ref.startswith("http://"):
            raise HTTPException(status_code=404, detail="Picture not found")    # outside pictures are linked directly
        return _send_picture(ref)

    @router.get("/public/brands/{brand_id}/logo")
    async def public_brand_logo(brand_id: str):
        b = await db.brands.find_one({"_id": _oid(brand_id, "picture")})
        if not b or not shown_on_website(b) or not _logo_ref(b):
            raise HTTPException(status_code=404, detail="Picture not found")
        return _send_picture(b["logo_path"], folders=("images", "documents"))

    async def _live_testimonial(testimonial_id: str) -> Dict[str, Any]:
        t = await db.website_testimonials.find_one({"_id": _oid(testimonial_id, "testimonial"), "status": "live"})
        if not t:
            raise HTTPException(status_code=404, detail="Not found")
        return t

    @router.get("/public/testimonials/{testimonial_id}/poster")
    async def public_testimonial_poster(testimonial_id: str):
        t = await _live_testimonial(testimonial_id)
        if not picture_rx.fullmatch(str(t.get("poster_path") or "")):
            raise HTTPException(status_code=404, detail="Picture not found")
        return _send_picture(t["poster_path"])

    @router.api_route("/public/testimonials/{testimonial_id}/video", methods=["GET", "HEAD"])
    async def public_testimonial_video(testimonial_id: str, request: Request):
        """The uploaded video, in pieces as the player asks for them (Range) — iPhones won't play it otherwise."""
        t = await _live_testimonial(testimonial_id)
        full = _video_file(t.get("video_path"))
        if not full:
            raise HTTPException(status_code=404, detail="Video not found")
        st = full.stat()
        size, mime = st.st_size, VIDEO_TYPES[full.suffix.lstrip(".").lower()]
        etag = f'"{size:x}-{int(st.st_mtime):x}"'
        headers = {"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400", "ETag": etag,
                   "Last-Modified": datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT"),
                   "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"}
        asked = request.headers.get("range")
        if_range = request.headers.get("if-range")
        if asked and if_range and if_range.strip() != etag:
            asked = None                                  # the file changed since the player's first piece: send it whole
        try:
            rng = byte_range(asked, size)
        except LookupError:
            return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
        first, last = rng if rng else (0, size - 1)
        length = max(last - first + 1, 0)
        headers["Content-Length"] = str(length)
        status = 200
        if rng:
            status = 206
            headers["Content-Range"] = f"bytes {first}-{last}/{size}"
        if request.method == "HEAD":
            return Response(status_code=status, headers=headers, media_type=mime)

        async def chunks():
            async with await anyio.open_file(full, "rb") as f:
                await f.seek(first)
                left = length
                while left > 0:
                    part = await f.read(min(VIDEO_CHUNK, left))
                    if not part:
                        break
                    left -= len(part)
                    yield part
        return StreamingResponse(chunks(), status_code=status, media_type=mime, headers=headers)

    @router.post("/public/shop/order")
    async def public_order(body: OrderIn, request: Request):
        if body.website:
            return {"ok": True, "number": None}
        phone = mobile(body.phone)
        if not phone:
            raise HTTPException(status_code=400, detail="Enter a 10-digit mobile number so we can confirm your order.")
        name = _clean(body.name, 80)
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Tell us your name.")
        if not body.items:
            raise HTTPException(status_code=400, detail="Your cart is empty.")
        ip = await _rate_limit(request, "order")
        live = {p["id"]: p for p in await _live_products()}
        lines, total, gone = [], 0.0, []
        for it in body.items[:50]:
            p = live.get(it.id)
            qty = int(_num(it.qty, 0, 999) or 0)
            if not p:
                gone.append(it.id)
                continue
            if qty < 1:
                continue
            amount = round(p["price"] * qty, 2)
            total += amount
            lines.append({"listing_id": p["id"], "title": p["title"], "qty": qty, "price": p["price"], "amount": amount})
        if gone and not lines:
            raise HTTPException(status_code=409, detail="These products aren't available any more. Refresh the shop and try again.")
        if not lines:
            raise HTTPException(status_code=400, detail="Your cart is empty.")
        delivery = body.delivery if body.delivery in ("delivery", "pickup") else "delivery"
        address = _clean(body.address, 300)
        if delivery == "delivery" and len(address) < 5:
            raise HTTPException(status_code=400, detail="Add the delivery address, or choose to pick it up from our store.")
        store = None
        if delivery == "pickup":
            stores = await _pickup_stores()
            if stores:      # with no store set up, pick-up is "from our office", as before
                store = next((x for x in stores if x["id"] == (body.store_id or "").strip()), None)
                if not store:
                    raise HTTPException(status_code=400, detail="Choose the store you'll pick it up from.")
        pin = _digits(body.pincode)[:6]
        fields = {"name": name, "phone": phone, "kind": "shop_order", "source": "shop", "page": "shop",
                  "address": address, "pincode": pin if len(pin) == 6 else "", "delivery": delivery,
                  "message": _clean(body.message, 600), "items": lines, "order_total": round(total, 2),
                  "utm": {k: _clean(v, 120) for k, v in (body.utm or {}).items() if k in UTM_KEYS and v}}
        if store:
            fields["pickup_store"] = {k: store[k] for k in ("id", "name", "address", "phone")}
        # an order is always its own lead (two orders are two jobs), so don't merge it into an open enquiry
        now = _iso()
        doc = {**fields, "number": await _next_number(), "status": "new", "needs_attention": True, "submissions": 1, "ip": ip,
               "created_at": now, "updated_at": now, "last_submitted_at": now,
               "activity": [{"at": now, "by": "Website", "type": "submitted",
                             "text": f"Order request — {len(lines)} item(s), {inr(total)}" + (f" — pick up at {store['name']}" if store else "")}]}
        res = await db.website_leads.insert_one(doc)
        doc["_id"] = res.inserted_id
        await _tell_staff(doc)
        return {"ok": True, "number": doc["number"], "total": round(total, 2), "lines": lines, "unavailable": gone}

    # ───────────────────────── customer logins: the customer's side ─────────────────────────
    def _client_token(acc: Dict[str, Any]) -> str:
        exp = _now() + timedelta(days=CLIENT_SESSION_DAYS)
        return jwt.encode({"sub": str(acc["_id"]), "type": "client", "pv": int(acc.get("password_version") or 1), "exp": exp},
                          jwt_secret, algorithm="HS256")

    def _set_cookie(response: Response, acc: Dict[str, Any]):
        response.set_cookie(CLIENT_COOKIE, _client_token(acc), max_age=CLIENT_SESSION_DAYS * 86400, httponly=True, samesite="lax",
                            path=CLIENT_COOKIE_PATH)

    async def _client(request: Request) -> Dict[str, Any]:
        raw = request.cookies.get(CLIENT_COOKIE)
        if not raw:
            raise HTTPException(status_code=401, detail="Please sign in")
        try:
            data = jwt.decode(raw, jwt_secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Please sign in again")
        if data.get("type") != "client" or not ObjectId.is_valid(data.get("sub") or ""):
            raise HTTPException(status_code=401, detail="Please sign in")
        acc = await db.client_accounts.find_one({"_id": ObjectId(data["sub"])})
        if not acc or not acc.get("active", True) or int(acc.get("password_version") or 1) != int(data.get("pv") or 0):
            raise HTTPException(status_code=401, detail="Please sign in again")
        return acc

    async def _client_projects(acc: Dict[str, Any]) -> List[Dict[str, Any]]:
        ids = [ObjectId(i) for i in acc.get("project_ids") or [] if ObjectId.is_valid(i)]
        rows = await db.projects.find({"_id": {"$in": ids}, "deleted_at": {"$exists": False}}).to_list(50)
        order = {str(i): n for n, i in enumerate(ids)}
        return sorted(rows, key=lambda p: order.get(str(p["_id"]), 99))

    async def _client_project(acc: Dict[str, Any], project_id: str) -> Dict[str, Any]:
        if project_id not in (acc.get("project_ids") or []):
            raise HTTPException(status_code=404, detail="That project isn't on your login. Ask Sensoper to add it.")
        p = await db.projects.find_one({"_id": _oid(project_id, "project"), "deleted_at": {"$exists": False}})
        if not p:
            raise HTTPException(status_code=404, detail="That project isn't on your login. Ask Sensoper to add it.")
        return p

    def _project_card(p: Dict[str, Any]) -> Dict[str, Any]:
        ps = (p.get("custom_fields") or {}).get("proposed_solution") or {}
        kw = _num(ps.get("system_size_kw")) or _num((p.get("solar_system") or {}).get("system_size_kw")) or None
        return {"id": str(p["_id"]), "reference": p.get("reference_number"), "size_kw": kw,
                "system_type": ps.get("system_type") or (p.get("solar_system") or {}).get("system_type") or "on-grid",
                "status": p.get("status"), "place": ((p.get("location") or {}).get("city") or (p.get("location") or {}).get("district")
                                                     or (p.get("location") or {}).get("address") or "")[:60]}

    dummy_hash = hash_password(secrets.token_urlsafe(12))   # checked when a number has no login, so both cases take as long

    @router.post("/client/auth/login")
    async def client_login(body: ClientLogin, request: Request, response: Response):
        phone = mobile(body.phone) or _digits(body.phone)[-10:]
        ip = _client_ip(request)
        since = _now() - timedelta(minutes=LOGIN_WINDOW_MIN)
        # one person guessing (this number from this address) is stopped quickly; a stranger can't lock a customer out,
        # because the per-number limit is much looser; one address can't try many numbers either
        pair = await db.client_login_attempts.count_documents({"phone": phone, "ip": ip, "at": {"$gte": since}})
        per_phone = await db.client_login_attempts.count_documents({"phone": phone, "at": {"$gte": since}})
        per_ip = await db.client_login_attempts.count_documents({"ip": ip, "at": {"$gte": since}}) if ip else 0
        if pair >= LOGIN_TRIES or per_phone >= LOGIN_TRIES * 5 or per_ip >= LOGIN_TRIES * 4:
            raise HTTPException(status_code=429, detail="Too many tries. Please wait 15 minutes, or ask us on WhatsApp to reset your password.")
        acc = await db.client_accounts.find_one({"phone": phone}) if phone else None
        ok = verify_password(body.password or "", (acc or {}).get("password_hash") or dummy_hash)
        if not acc or not acc.get("active", True) or not ok:
            await db.client_login_attempts.insert_one({"phone": phone, "ip": ip, "at": _now()})
            raise HTTPException(status_code=401, detail="That mobile number and password don't match.")
        await db.client_login_attempts.delete_many({"phone": phone, "ip": ip})
        await db.client_accounts.update_one({"_id": acc["_id"]}, {"$set": {"last_login_at": _iso()}, "$inc": {"login_count": 1}})
        _set_cookie(response, acc)
        return {"name": acc.get("name"), "must_change_password": bool(acc.get("must_change_password"))}

    @router.post("/client/auth/logout")
    async def client_logout(response: Response):
        response.delete_cookie(CLIENT_COOKIE, path=CLIENT_COOKIE_PATH)
        return {"ok": True}

    @router.get("/client/me")
    async def client_me(request: Request):
        acc = await _client(request)
        return {"name": acc.get("name"), "phone_masked": f"••••••{acc.get('phone', '')[-4:]}",
                "must_change_password": bool(acc.get("must_change_password")),
                "projects": [_project_card(p) for p in await _client_projects(acc)], "company": await _company_public()}

    @router.post("/client/auth/change-password")
    async def client_change_password(body: ClientPasswordChange, request: Request, response: Response):
        acc = await _client(request)
        if not verify_password(body.current_password, acc.get("password_hash") or ""):
            raise HTTPException(status_code=400, detail="Your current password isn't right.")
        if body.current_password == body.new_password:
            raise HTTPException(status_code=400, detail="Choose a new password that's different from the one we gave you.")
        pv = int(acc.get("password_version") or 1) + 1
        await db.client_accounts.update_one({"_id": acc["_id"]}, {"$set": {
            "password_hash": hash_password(body.new_password), "password_version": pv, "must_change_password": False,
            "password_changed_at": _iso()}})
        acc["password_version"] = pv
        _set_cookie(response, acc)
        return {"ok": True}

    @router.get("/client/projects/{project_id}/dashboard")
    async def client_dashboard(project_id: str, request: Request):
        acc = await _client(request)
        if acc.get("must_change_password"):
            raise HTTPException(status_code=403, detail="Set your own password first.")
        return await project_dashboard(db, await _client_project(acc, project_id))

    @router.post("/client/projects/{project_id}/tickets")
    async def client_ticket(project_id: str, body: TicketIn, request: Request):
        acc = await _client(request)
        return await raise_ticket_for(db, await _client_project(acc, project_id), body, via="customer_login")

    @router.post("/client/projects/{project_id}/offers/{offer_id}/interest")
    async def client_offer(project_id: str, offer_id: str, request: Request):
        acc = await _client(request)
        return await offer_interest_for(db, await _client_project(acc, project_id), offer_id)

    # ───────────────────────── staff: leads ─────────────────────────
    @router.get("/website/summary")
    async def summary(request: Request):
        await get_current_user(request)
        today = _now().astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
        shop = await _shop_platform()
        return {
            "new_leads": await db.website_leads.count_documents({"status": "new"}),
            "open_leads": await db.website_leads.count_documents({"status": {"$in": list(OPEN_STATUSES)}}),
            "today": await db.website_leads.count_documents({"last_submitted_at": {"$gte": today}}),
            "follow_ups_due": await db.website_leads.count_documents({"status": {"$in": list(OPEN_STATUSES)},
                                                                      "follow_up_on": {"$lte": _now().astimezone(IST).date().isoformat(), "$nin": [None, ""]}}),
            "shop_products": await db.ecommerce_listings.count_documents({"platform_id": str(shop["_id"]), "status": "live",
                                                                          "superseded_by": {"$exists": False}}) if shop else 0,
            "client_logins": await db.client_accounts.count_documents({"active": {"$ne": False}}),
            "popups_live": len(await _live_popups()),
        }

    @router.get("/website/leads")
    async def list_leads(request: Request, status: Optional[str] = None, kind: Optional[str] = None, q: Optional[str] = None,
                         limit: int = 200):
        await get_current_user(request)
        query: Dict[str, Any] = {}
        if status == "open":
            query["status"] = {"$in": list(OPEN_STATUSES)}
        elif status in STATUSES:
            query["status"] = status
        if kind in KINDS:
            query["kind"] = kind
        if q:
            rx = re.escape(q.strip()[:60])
            query["$or"] = [{"name": {"$regex": rx, "$options": "i"}}, {"phone": {"$regex": rx}}, {"number": {"$regex": rx, "$options": "i"}},
                            {"area": {"$regex": rx, "$options": "i"}}, {"pincode": {"$regex": rx}}]
        rows = await db.website_leads.find(query).sort("last_submitted_at", -1).limit(max(1, min(limit, 500))).to_list(500)
        counts = {k: await db.website_leads.count_documents({"status": k}) for k in STATUSES}
        return {"items": [_lead_out(l) for l in rows], "counts": counts,
                "statuses": [{"key": k, "label": v} for k, v in STATUSES.items()],
                "kinds": [{"key": k, "label": v} for k, v in KINDS.items()]}

    @router.get("/website/leads/{lead_id}")
    async def get_lead(lead_id: str, request: Request):
        await get_current_user(request)
        l = await db.website_leads.find_one({"_id": _oid(lead_id, "lead")})
        if not l:
            raise HTTPException(status_code=404, detail="That lead doesn't exist")
        return _lead_out(l)

    @router.put("/website/leads/{lead_id}")
    async def update_lead(lead_id: str, body: LeadUpdate, request: Request):
        user = await get_current_user(request)
        l = await db.website_leads.find_one({"_id": _oid(lead_id, "lead")})
        if not l:
            raise HTTPException(status_code=404, detail="That lead doesn't exist")
        now = _iso()
        upd: Dict[str, Any] = {"updated_at": now, "needs_attention": False}
        log: List[Dict[str, Any]] = []
        if body.status is not None:
            if body.status not in STATUSES:
                raise HTTPException(status_code=400, detail="Pick one of the listed stages")
            if body.status != l.get("status"):
                upd["status"] = body.status
                log.append({"at": now, "by": user.get("name", ""), "type": "status", "text": f"Moved to {STATUSES[body.status]}"})
                if body.status in ("won", "lost"):
                    upd["closed_at"] = now
        if body.lost_reason is not None:
            upd["lost_reason"] = _clean(body.lost_reason, 200)
        if body.follow_up_on is not None:
            d = str(body.follow_up_on)[:10]
            if d and not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
                raise HTTPException(status_code=400, detail="Follow-up date should look like 2026-11-20")
            upd["follow_up_on"] = d or None
            if d:
                log.append({"at": now, "by": user.get("name", ""), "type": "follow_up", "text": f"Call back on {d}"})
        if body.assigned_to is not None:
            if body.assigned_to:
                u = await db.users.find_one({"_id": _oid(body.assigned_to, "person")}, {"name": 1})
                if not u:
                    raise HTTPException(status_code=400, detail="That person isn't on the team")
                upd.update({"assigned_to": body.assigned_to, "assigned_to_name": u.get("name")})
                log.append({"at": now, "by": user.get("name", ""), "type": "assigned", "text": f"Given to {u.get('name')}"})
            else:
                upd.update({"assigned_to": None, "assigned_to_name": None})
        if body.project_id is not None:
            if body.project_id:
                p = await db.projects.find_one({"_id": _oid(body.project_id, "project")}, {"reference_number": 1})
                if not p:
                    raise HTTPException(status_code=400, detail="That project doesn't exist")
                upd.update({"project_id": body.project_id, "project_reference": p.get("reference_number")})
                if l.get("status") in ("new", "contacted"):
                    upd["status"] = "site_visit"
                log.append({"at": now, "by": user.get("name", ""), "type": "project", "text": f"Project {p.get('reference_number') or ''} made from this lead".strip()})
            else:
                upd.update({"project_id": None, "project_reference": None})
        if body.note:
            log.append({"at": now, "by": user.get("name", ""), "type": "note", "text": _clean(body.note, 1000)})
        if l.get("status") == "new" and "status" not in upd and (body.note or body.follow_up_on):
            upd["status"] = "contacted"
        update: Dict[str, Any] = {"$set": upd}
        if log:
            update["$push"] = {"activity": {"$each": log}}
        await db.website_leads.update_one({"_id": l["_id"]}, update)
        return _lead_out(await db.website_leads.find_one({"_id": l["_id"]}))

    @router.delete("/website/leads/{lead_id}")
    async def delete_lead(lead_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        l = await db.website_leads.find_one({"_id": _oid(lead_id, "lead")})
        if not l:
            raise HTTPException(status_code=404, detail="That lead doesn't exist")
        await db.website_leads.delete_one({"_id": l["_id"]})
        await create_audit_log(user["id"], user.get("name", ""), "delete", "website_lead", lead_id, {"name": l.get("name"), "phone": l.get("phone")})
        return {"deleted": True}

    # ───────────────────────── staff: pop-ups & settings ─────────────────────────
    def _check_popup(body: PopupIn) -> Dict[str, Any]:
        title = _clean(body.title, 70)
        if len(title) < 3:
            raise HTTPException(status_code=400, detail="Give the pop-up a short title")
        if body.cta_action not in POPUP_ACTIONS:
            raise HTTPException(status_code=400, detail="Choose what the button does")
        url = (body.cta_url or "").strip()
        if body.cta_action == "link" and not re.match(r"^(https://[^\s<>\"'/\\][^\s<>\"']{0,300}|/(?![/\\])[^\s<>\"']{0,300})$", url):
            raise HTTPException(status_code=400, detail="The button link should start with https:// or /")
        till = (body.valid_till or "")[:10] or None
        if till and not re.match(r"^\d{4}-\d{2}-\d{2}$", till):
            raise HTTPException(status_code=400, detail="'Show until' should look like 2026-12-31")
        return {"title": title, "message": _clean(body.message, 220), "cta_label": _clean(body.cta_label, 30),
                "cta_action": body.cta_action, "cta_url": url if body.cta_action == "link" else "",
                "where": body.where if body.where in POPUP_WHERE else "site",
                "delay_seconds": max(0, min(int(body.delay_seconds or 0), 120)), "valid_till": till, "active": bool(body.active)}

    @router.get("/website/popups")
    async def list_popups(request: Request):
        await get_current_user(request)
        return [_popup_out(p) async for p in db.website_popups.find({}).sort("updated_at", -1)]

    @router.post("/website/popups")
    async def create_popup(body: PopupIn, request: Request):
        user = await require_role("admin", "manager")(request)
        doc = {**_check_popup(body), "created_by_name": user.get("name", ""), "created_at": _iso(), "updated_at": _iso()}
        res = await db.website_popups.insert_one(doc)
        await create_audit_log(user["id"], user.get("name", ""), "create", "website_popup", str(res.inserted_id), None, {"title": doc["title"]})
        return _popup_out({**doc, "_id": res.inserted_id})

    @router.put("/website/popups/{popup_id}")
    async def update_popup(popup_id: str, body: PopupIn, request: Request):
        user = await require_role("admin", "manager")(request)
        res = await db.website_popups.update_one({"_id": _oid(popup_id, "pop-up")}, {"$set": {**_check_popup(body), "updated_at": _iso()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="That pop-up doesn't exist")
        await create_audit_log(user["id"], user.get("name", ""), "update", "website_popup", popup_id)
        return _popup_out(await db.website_popups.find_one({"_id": ObjectId(popup_id)}))

    @router.delete("/website/popups/{popup_id}")
    async def delete_popup(popup_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        await db.website_popups.delete_one({"_id": _oid(popup_id, "pop-up")})
        await create_audit_log(user["id"], user.get("name", ""), "delete", "website_popup", popup_id)
        return {"deleted": True}

    @router.get("/website/settings")
    async def get_settings(request: Request):
        await get_current_user(request)
        s = await _settings()
        c = await _company_public()
        shop = await _shop_platform()
        return {**s, "company_phone": mobile((await company_info(db)).get("phone")) or "", "effective_whatsapp": c["whatsapp"],
                "effective_call": c["phone"], "shop_platform": {"id": str(shop["_id"]), "name": shop.get("name")} if shop else None,
                "default_site_url": DEFAULT_SITE_URL, "urls": _urls(s)}

    @router.put("/website/settings")
    async def put_settings(body: SettingsIn, request: Request):
        user = await require_role("admin", "manager")(request)
        upd: Dict[str, Any] = {"updated_at": _iso(), "updated_by": user.get("name", "")}
        for key in ("whatsapp_number", "call_number"):
            v = getattr(body, key)
            if v is not None:
                if v.strip() and not mobile(v):
                    raise HTTPException(status_code=400, detail="Enter a 10-digit mobile number (or leave it empty to use the company phone).")
                upd[key] = mobile(v) or ""
        if body.show_price_estimate is not None:
            upd["show_price_estimate"] = bool(body.show_price_estimate)
        if body.site_url is not None:
            v = site_address(body.site_url)
            if v is None:
                raise HTTPException(status_code=400, detail="The main website address should start with https://, for example "
                                                            "https://quote.sensoper.in (or leave it empty).")
            upd["site_url"] = v
        if body.shop_url is not None:
            v = site_address(body.shop_url)
            if v is None:
                raise HTTPException(status_code=400, detail="The shop address should start with https://, for example https://shop.sensoper.in "
                                                            "(or leave it empty to use the main website address + /shop/).")
            upd["shop_url"] = v
        await db.website_settings.update_one({"key": "main"}, {"$set": upd}, upsert=True)
        await create_audit_log(user["id"], user.get("name", ""), "update", "website_settings", "main", None, upd)
        return await get_settings(request)

    # ───────────────────────── staff: client testimonials ─────────────────────────
    def _testimonial_out(t: Dict[str, Any]) -> Dict[str, Any]:
        return {"id": str(t["_id"]), "name": t.get("name") or "", "place": t.get("place") or "", "system": t.get("system") or "",
                "quote": t.get("quote") or "", "youtube_url": t.get("youtube_url") or "", "youtube_id": t.get("youtube_id") or "",
                "video_path": t.get("video_path") or "", "video_size": t.get("video_size"), "video_type": t.get("video_type") or "",
                "poster_path": t.get("poster_path") or "", "status": t.get("status") or "draft", "order": int(t.get("order") or 0),
                "created_at": t.get("created_at"), "updated_at": t.get("updated_at"), "created_by_name": t.get("created_by_name")}

    def _check_testimonial(body: TestimonialIn) -> Dict[str, Any]:
        name = _clean(body.name, 80)
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Enter the customer's name.")
        quote = _clean(body.quote, 4000)
        if len(quote) > QUOTE_MAX:
            raise HTTPException(status_code=400, detail=f"Keep the quote to {QUOTE_MAX} characters or fewer — it's {len(quote)} now.")
        yt_text, path = (body.youtube_url or "").strip(), (body.video_path or "").strip()
        if not yt_text and not path:
            raise HTTPException(status_code=400, detail="Add a YouTube link or upload a video.")
        if yt_text and path:
            raise HTTPException(status_code=400, detail="Use either a YouTube link or an uploaded video, not both.")
        doc: Dict[str, Any] = {"name": name, "place": _clean(body.place, 80), "system": _clean(body.system, 80), "quote": quote,
                               "youtube_id": None, "youtube_url": "", "video_path": None, "video_size": None, "video_type": None}
        if yt_text:
            vid = youtube_id(yt_text)
            if not vid:
                raise HTTPException(status_code=400, detail="That isn't a YouTube video link. Open the video on YouTube, tap Share, "
                                                            "copy the link and paste it here (for example https://youtu.be/dQw4w9WgXcQ).")
            doc.update({"youtube_id": vid, "youtube_url": f"https://www.youtube.com/watch?v={vid}"})
        else:
            full = _video_file(path)
            if not full:
                raise HTTPException(status_code=400, detail="That video isn't uploaded any more. Upload it again.")
            doc.update({"video_path": path, "video_size": full.stat().st_size, "video_type": VIDEO_TYPES[full.suffix.lstrip(".").lower()]})
        poster = (body.poster_path or "").strip().split("/api/files/", 1)[-1].lstrip("/")
        if poster and not picture_rx.fullmatch(poster):
            raise HTTPException(status_code=400, detail="Upload the poster as a picture (PNG, JPG or WebP).")
        doc["poster_path"] = poster or None
        status = (body.status or "live").strip()
        if status not in ("live", "draft"):
            raise HTTPException(status_code=400, detail="Show it on the website (live) or keep it as a draft.")
        doc["status"] = status
        try:
            order = int(float(body.order or 0))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Order should be a whole number — smaller numbers show first.")
        doc["order"] = max(0, min(order, 9999))
        return doc

    @router.get("/website/testimonials")
    async def list_testimonials(request: Request):
        await get_current_user(request)
        rows = await db.website_testimonials.find({}).sort([("order", 1), ("created_at", -1)]).to_list(500)
        return {"items": [_testimonial_out(t) for t in rows]}

    @router.post("/website/testimonials")
    async def create_testimonial(body: TestimonialIn, request: Request):
        user = await _site_editor(request)
        now = _iso()
        doc = {**_check_testimonial(body), "created_at": now, "updated_at": now, "created_by_name": user.get("name", "")}
        res = await db.website_testimonials.insert_one(doc)
        await create_audit_log(user["id"], user.get("name", ""), "create", "website_testimonial", str(res.inserted_id), None,
                               {"name": doc["name"], "status": doc["status"]})
        return _testimonial_out({**doc, "_id": res.inserted_id})

    @router.put("/website/testimonials/{testimonial_id}")
    async def update_testimonial(testimonial_id: str, body: TestimonialIn, request: Request):
        user = await _site_editor(request)
        cur = await db.website_testimonials.find_one({"_id": _oid(testimonial_id, "testimonial")})
        if not cur:
            raise HTTPException(status_code=404, detail="That testimonial doesn't exist")
        doc = {**_check_testimonial(body), "updated_at": _iso()}
        await db.website_testimonials.update_one({"_id": cur["_id"]}, {"$set": doc})
        if cur.get("video_path") and cur["video_path"] != doc.get("video_path"):
            await _drop_video(cur["video_path"], keep_id=cur["_id"])
        await create_audit_log(user["id"], user.get("name", ""), "update", "website_testimonial", testimonial_id, None,
                               {"name": doc["name"], "status": doc["status"]})
        return _testimonial_out(await db.website_testimonials.find_one({"_id": cur["_id"]}))

    @router.delete("/website/testimonials/{testimonial_id}")
    async def delete_testimonial(testimonial_id: str, request: Request):
        user = await _site_editor(request)
        cur = await db.website_testimonials.find_one({"_id": _oid(testimonial_id, "testimonial")})
        if not cur:
            raise HTTPException(status_code=404, detail="That testimonial doesn't exist")
        await db.website_testimonials.delete_one({"_id": cur["_id"]})
        if cur.get("video_path"):
            await _drop_video(cur["video_path"])
        await create_audit_log(user["id"], user.get("name", ""), "delete", "website_testimonial", testimonial_id, {"name": cur.get("name")})
        return {"deleted": True}

    @router.post("/website/testimonials/video")
    async def upload_testimonial_video(request: Request):
        """multipart/form-data, field "file": an MP4, WebM or MOV of at most 100 MB. Written to disk piece by piece as it
        arrives, and stopped as soon as it passes 100 MB — whatever Content-Length says."""
        user = await _site_editor(request)
        if storage_path is None:
            raise HTTPException(status_code=503, detail="Video uploads aren't set up on this server yet.")
        too_big = HTTPException(status_code=413, detail="The video is bigger than 100 MB. Trim it, or export it at 720p, and upload it again.")
        ctype, params = parse_options_header(request.headers.get("content-type", ""))
        boundary = params.get(b"boundary")
        if ctype.lower() != b"multipart/form-data" or not boundary:
            raise HTTPException(status_code=400, detail="Choose a video file to upload.")
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > VIDEO_MAX_BYTES + 1024 * 1024:
            raise too_big                                       # a cheap early "no"; the real limit is counted below
        name = uuid.uuid4().hex
        part_file = storage_path(f"{app_name}/videos/{name}.part")
        part_file.parent.mkdir(parents=True, exist_ok=True)
        st: Dict[str, Any] = {"headers": {}, "field": b"", "value": b"", "in_file": False, "seen": False, "size": 0,
                              "head": b"", "ext": "", "pending": []}

        def on_part_begin():
            st["headers"], st["field"], st["value"] = {}, b"", b""

        def on_header_field(data, start, end):
            st["field"] += data[start:end]

        def on_header_value(data, start, end):
            st["value"] += data[start:end]

        def on_header_end():
            st["headers"][st["field"].strip().lower()] = st["value"].strip()
            st["field"], st["value"] = b"", b""

        def on_headers_finished():
            _, opts = parse_options_header(st["headers"].get(b"content-disposition", b""))
            st["in_file"] = opts.get(b"name") == b"file" and not st["seen"]
            if not st["in_file"]:
                return
            st["seen"] = True
            filename = opts.get(b"filename", b"").decode("utf-8", "replace").replace("\\", "/").rsplit("/", 1)[-1]
            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            part_type = st["headers"].get(b"content-type", b"").decode("latin-1").split(";")[0].strip().lower()
            if ext not in VIDEO_TYPES or part_type not in VIDEO_TYPES.values():
                raise HTTPException(status_code=400, detail="Upload the video as an MP4, WebM or MOV file.")
            st["ext"] = ext

        def on_part_data(data, start, end):
            if not st["in_file"]:
                return
            piece = bytes(data[start:end])
            st["size"] += len(piece)
            if st["size"] > VIDEO_MAX_BYTES:
                raise too_big
            if len(st["head"]) < 16:
                st["head"] += piece[:16]
            st["pending"].append(piece)

        def on_part_end():
            st["in_file"] = False

        parser = MultipartParser(boundary, {"on_part_begin": on_part_begin, "on_header_field": on_header_field,
                                            "on_header_value": on_header_value, "on_header_end": on_header_end,
                                            "on_headers_finished": on_headers_finished, "on_part_data": on_part_data,
                                            "on_part_end": on_part_end})
        received, saved = 0, False
        try:
            with open(part_file, "wb") as out:
                async for chunk in request.stream():
                    received += len(chunk)
                    if received > VIDEO_MAX_BYTES + 1024 * 1024:  # the video plus a little room for the form's own lines
                        raise too_big
                    try:
                        parser.write(chunk)
                    except ValueError:
                        raise HTTPException(status_code=400, detail="The upload didn't come through properly. Try again.")
                    if st["pending"]:
                        out.write(b"".join(st["pending"]))
                        st["pending"].clear()
                try:
                    parser.finalize()
                except ValueError:
                    raise HTTPException(status_code=400, detail="The upload didn't come through properly. Try again.")
            if not st["seen"]:
                raise HTTPException(status_code=400, detail="Choose a video file to upload.")
            if not st["size"]:
                raise HTTPException(status_code=400, detail="That video file is empty. Choose the video again.")
            head = st["head"]
            looks_ok = head.startswith(b"\x1a\x45\xdf\xa3") if st["ext"] == "webm" else \
                head[4:8] in (b"ftyp", b"moov", b"mdat", b"free", b"wide", b"skip", b"pnot")
            if not looks_ok:
                raise HTTPException(status_code=400, detail="That file doesn't play as a video. Export it again as MP4 and upload that.")
            path = f"{app_name}/videos/{name}.{st['ext']}"
            final = storage_path(path)
            os.replace(part_file, final)
            mime = VIDEO_TYPES[st["ext"]]
            final.with_suffix(final.suffix + ".meta").write_text(mime)
            saved = True
        finally:
            if not saved:
                try:
                    part_file.unlink()
                except OSError:
                    pass
        await create_audit_log(user["id"], user.get("name", ""), "create", "website_video", path, None, {"size": st["size"]})
        return {"video_path": path, "size": st["size"], "content_type": mime}

    # ───────────────────────── staff: pick-up stores (the ERP's locations) ─────────────────────────
    def _store_row(loc: Dict[str, Any]) -> Dict[str, Any]:
        p = loc.get("pickup") or {}
        return {"location_id": str(loc["_id"]), "name": loc.get("name") or "", "type": loc.get("type") or "",
                "district": loc.get("district") or "", "address": loc.get("address") or "",
                "pickup": {"enabled": bool(p.get("enabled")), "public_name": p.get("public_name") or "", "address": p.get("address") or "",
                           "phone": p.get("phone") or "", "hours": p.get("hours") or "", "lat": p.get("lat"), "lng": p.get("lng")}}

    @router.get("/website/stores")
    async def list_stores(request: Request):
        await get_current_user(request)
        return {"items": [_store_row(l) async for l in db.locations.find({"active": {"$ne": False}}).sort("name", 1)]}

    @router.put("/website/stores/{location_id}")
    async def save_store(location_id: str, body: StoreIn, request: Request):
        user = await _site_editor(request)
        loc = await db.locations.find_one({"_id": _oid(location_id, "location"), "active": {"$ne": False}})
        if not loc:
            raise HTTPException(status_code=404, detail="That location doesn't exist. Add it in Settings → Locations first.")
        address = _clean(body.address, 300)
        if body.enabled and len(address) < 5:
            raise HTTPException(status_code=400, detail="Add the store's address — customers see it when they choose to pick up there.")
        phone = store_phone(body.phone)
        if phone is None:
            raise HTTPException(status_code=400, detail="Enter the store's phone as a 10-digit mobile number, or a landline with its "
                                                        "STD code (for example 0424 2233445).")
        try:
            where = coordinates(body.coordinates)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        pickup = {"enabled": bool(body.enabled), "public_name": _clean(body.public_name, 80), "address": address, "phone": phone,
                  "hours": _clean(body.hours, 80), "lat": where[0] if where else None, "lng": where[1] if where else None,
                  "updated_at": _iso(), "updated_by": user.get("name", "")}
        await db.locations.update_one({"_id": loc["_id"]}, {"$set": {"pickup": pickup}})
        await create_audit_log(user["id"], user.get("name", ""), "update", "pickup_store", location_id, loc.get("pickup"),
                               {k: v for k, v in pickup.items() if k != "updated_at"})
        return _store_row(await db.locations.find_one({"_id": loc["_id"]}))

    # ───────────────────────── staff: shop products ─────────────────────────
    def _shop_row(l: Dict[str, Any], item: Optional[Dict[str, Any]], ref_price: Optional[float]) -> Dict[str, Any]:
        return {"id": str(l["_id"]), "inventory_item_id": l.get("inventory_item_id"), "title": l.get("listing_title") or (item or {}).get("name"),
                "item_name": (item or {}).get("name"), "sku_code": (item or {}).get("sku_code"), "category": (item or {}).get("category"),
                "description": l.get("description") or "", "images": l.get("images") or [], "featured": bool(l.get("featured")),
                "price": l.get("listed_price"), "status": l.get("status"), "stock": (item or {}).get("quantity", 0),
                "reference_price": ref_price, "updated_at": l.get("updated_at"), "missing_item": item is None}

    def _ref_price(item: Dict[str, Any]) -> Optional[float]:
        """Price list selling price incl. GST — a starting point for the shop price."""
        cost = _num(item.get("unit_price"))
        margin = item.get("margin_percentage", item.get("margin_pct"))
        gst = item.get("gst_percentage", item.get("gst_pct"))
        if not cost or margin is None or gst is None:
            return None
        return round(cost * (1 + float(margin) / 100) * (1 + float(gst) / 100), 2)

    @router.get("/website/shop/products")
    async def staff_products(request: Request):
        await get_current_user(request)
        shop = await _shop_platform()
        if not shop:
            return {"platform": None, "items": []}
        listings = await db.ecommerce_listings.find({"platform_id": str(shop["_id"]), "superseded_by": {"$exists": False},
                                                     "status": {"$ne": "delisted"}}).to_list(2000)
        ids = [ObjectId(l["inventory_item_id"]) for l in listings if ObjectId.is_valid(l.get("inventory_item_id") or "")]
        items = {str(i["_id"]): i for i in await db.inventory_items.find({"_id": {"$in": ids}}).to_list(2000)}
        rows = [_shop_row(l, items.get(l.get("inventory_item_id")), _ref_price(items[l["inventory_item_id"]]) if l.get("inventory_item_id") in items else None)
                for l in listings]
        rows.sort(key=lambda r: (r["status"] != "live", (r["title"] or "").lower()))
        return {"platform": {"id": str(shop["_id"]), "name": shop.get("name")}, "items": rows}

    def _clean_images(images: Optional[List[str]]) -> List[str]:
        out = []
        for ref in (images or [])[:6]:
            ref = str(ref or "").strip()
            if ref.startswith("https://") and len(ref) < 500 and not re.search(r"[\s<>\"']", ref):
                out.append(ref)
            else:
                path = ref.split("/api/files/", 1)[-1].lstrip("/")
                if path.startswith(f"{app_name}/images/") and ".." not in path and len(path) < 200:
                    out.append(path)
        return out

    async def _write_listing(user, platform, item, existing, body: ShopProductIn) -> Dict[str, Any]:
        now = _iso()
        upd: Dict[str, Any] = {"updated_at": now}
        if body.price is not None:
            price = _num(body.price, 0, 1e8)
            if not price:
                raise HTTPException(status_code=400, detail="Set the shop price (₹, including GST)")
            upd["listed_price"] = price
        if body.title is not None:
            upd["listing_title"] = _clean(body.title, 120) or item.get("name")
        if body.description is not None:
            upd["description"] = _clean(body.description, 1200)
        if body.images is not None:
            upd["images"] = _clean_images(body.images)
        if body.featured is not None:
            upd["featured"] = bool(body.featured)
        if body.status is not None:
            if body.status not in ("live", "draft", "paused"):
                raise HTTPException(status_code=400, detail="Show it in the shop (live) or keep it hidden (draft)")
            upd["status"] = body.status
        if existing:
            if (upd.get("status") or existing.get("status")) == "live" and not (upd.get("listed_price") or existing.get("listed_price")):
                raise HTTPException(status_code=400, detail="Set the shop price before showing it in the shop")
            await db.ecommerce_listings.update_one({"_id": existing["_id"]}, {"$set": upd})
            await create_audit_log(user["id"], user.get("name", ""), "update", "shop_product", str(existing["_id"]), None,
                                   {k: v for k, v in upd.items() if k != "updated_at"})
            return await db.ecommerce_listings.find_one({"_id": existing["_id"]})
        if not upd.get("listed_price"):
            raise HTTPException(status_code=400, detail="Set the shop price (₹, including GST)")
        doc = {"platform_id": str(platform["_id"]), "inventory_item_id": str(item["_id"]),
               "platform_sku": item.get("sku_code") or item.get("name"), "platform_listing_id": "", "listing_url": "",
               "listing_title": upd.get("listing_title") or item.get("name"), "listed_price": upd["listed_price"],
               "platform_commission_pct": 0.0, "status": upd.get("status") or "live", "category_on_platform": item.get("category", ""),
               "images": upd.get("images", []), "description": upd.get("description", ""), "featured": upd.get("featured", False),
               "created_at": now, "updated_at": now, "last_synced_at": None}
        res = await db.ecommerce_listings.insert_one(doc)
        await create_audit_log(user["id"], user.get("name", ""), "create", "shop_product", str(res.inserted_id), None,
                               {"item": item.get("name"), "price": doc["listed_price"]})
        return {**doc, "_id": res.inserted_id}

    @router.post("/website/shop/products")
    async def add_product(body: ShopProductIn, request: Request):
        user = await require_role("admin", "manager")(request)
        item = await db.inventory_items.find_one({"_id": _oid(body.inventory_item_id or "", "stock item")})
        if not item:
            raise HTTPException(status_code=400, detail="Pick an item from Inventory")
        platform = await _shop_platform(create=True)
        existing = await db.ecommerce_listings.find_one({"platform_id": str(platform["_id"]), "inventory_item_id": str(item["_id"]),
                                                         "superseded_by": {"$exists": False}})
        if existing and existing.get("status") == "delisted" and body.status is None:
            body.status = "live"
        l = await _write_listing(user, platform, item, existing, body)
        return _shop_row(l, item, _ref_price(item))

    @router.put("/website/shop/products/{listing_id}")
    async def edit_product(listing_id: str, body: ShopProductIn, request: Request):
        user = await require_role("admin", "manager")(request)
        platform = await _shop_platform(create=True)
        existing = await db.ecommerce_listings.find_one({"_id": _oid(listing_id, "product"), "platform_id": str(platform["_id"])})
        if not existing:
            raise HTTPException(status_code=404, detail="That product isn't in the shop")
        item = await db.inventory_items.find_one({"_id": _oid(existing.get("inventory_item_id") or "", "stock item")}) or {}
        l = await _write_listing(user, platform, item, existing, body)
        return _shop_row(l, item or None, _ref_price(item) if item else None)

    @router.delete("/website/shop/products/{listing_id}")
    async def remove_product(listing_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        res = await db.ecommerce_listings.update_one({"_id": _oid(listing_id, "product")}, {"$set": {"status": "delisted", "updated_at": _iso()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="That product isn't in the shop")
        await create_audit_log(user["id"], user.get("name", ""), "delete", "shop_product", listing_id)
        return {"removed": True}

    # ───────────────────────── staff: customer logins ─────────────────────────
    async def _project_for_staff(project_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
        p = await db.projects.find_one({"_id": _oid(project_id, "project"), "deleted_at": {"$exists": False}})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        if user["role"] == "staff" and p.get("created_by") != user["id"]:
            raise HTTPException(status_code=403, detail="You can only make logins for your own projects")
        return p

    async def _own_project_ids(user: Dict[str, Any]) -> Optional[set]:
        """Staff: the ids of the projects they made. Managers and admins: None (everything)."""
        if user["role"] != "staff":
            return None
        return {str(p["_id"]) async for p in db.projects.find({"created_by": user["id"]}, {"_id": 1})}

    async def _staff_may_change(acc: Dict[str, Any], user: Dict[str, Any]) -> None:
        """A login shows the customer every project on it, so staff may change it only when every project on it is theirs —
        otherwise they could reset it, sign in as the customer and see another salesperson's project."""
        own = await _own_project_ids(user)
        if own is None:
            return
        if any(pid not in own for pid in acc.get("project_ids") or []):
            raise HTTPException(status_code=403, detail="This login also shows projects you don’t handle. Ask a manager to change it.")

    async def _account_out(acc: Dict[str, Any], with_projects: bool = True, own: Optional[set] = None) -> Dict[str, Any]:
        out = {"id": str(acc["_id"]), "name": acc.get("name"), "phone": acc.get("phone"), "active": acc.get("active", True),
               "must_change_password": bool(acc.get("must_change_password")), "last_login_at": acc.get("last_login_at"),
               "login_count": acc.get("login_count", 0), "created_at": acc.get("created_at"), "created_by_name": acc.get("created_by_name"),
               "project_ids": [i for i in acc.get("project_ids") or [] if own is None or i in own]}
        if own is not None:
            out["other_projects"] = len(acc.get("project_ids") or []) - len(out["project_ids"])
        if with_projects:
            out["projects"] = [{"id": str(p["_id"]), "reference": p.get("reference_number"), "name": (p.get("customer") or {}).get("name")}
                               for p in await _client_projects(acc) if own is None or str(p["_id"]) in own]
        return out

    async def _valid_projects(ids: List[str], user: Dict[str, Any]) -> List[str]:
        out = []
        for pid in ids[:50]:
            p = await _project_for_staff(pid, user)
            if str(p["_id"]) not in out:
                out.append(str(p["_id"]))
        return out

    @router.get("/client-accounts")
    async def list_accounts(request: Request, q: Optional[str] = None):
        user = await get_current_user(request)
        own = await _own_project_ids(user)
        query: Dict[str, Any] = {}
        if q:
            rx = re.escape(q.strip()[:60])
            query["$or"] = [{"name": {"$regex": rx, "$options": "i"}}, {"phone": {"$regex": rx}}]
        if own is not None:   # staff see the logins of their own customers only
            query["project_ids"] = {"$in": list(own)}
        return [await _account_out(a, own=own) async for a in db.client_accounts.find(query).sort("created_at", -1).limit(500)]

    @router.post("/client-accounts")
    async def create_account(body: ClientAccountIn, request: Request):
        user = await get_current_user(request)
        phone = mobile(body.phone)
        if not phone:
            raise HTTPException(status_code=400, detail="Enter the customer's 10-digit mobile number — they sign in with it.")
        name = _clean(body.name, 80)
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Enter the customer's name")
        if await db.client_accounts.find_one({"phone": phone}):
            raise HTTPException(status_code=409, detail="This mobile number already has a login. Open it to add projects or reset the password.")
        project_ids = await _valid_projects(body.project_ids, user)
        if not project_ids:
            raise HTTPException(status_code=400, detail="Choose at least one project for the customer to see")
        password = temp_password()
        doc = {"name": name, "phone": phone, "password_hash": hash_password(password), "password_version": 1, "must_change_password": True,
               "project_ids": project_ids, "active": True, "created_at": _iso(), "created_by": user["id"], "created_by_name": user.get("name", ""),
               "login_count": 0}
        res = await db.client_accounts.insert_one(doc)
        await create_audit_log(user["id"], user.get("name", ""), "create", "client_account", str(res.inserted_id), None,
                               {"name": name, "phone": phone, "projects": project_ids})
        return {"account": await _account_out({**doc, "_id": res.inserted_id}, own=await _own_project_ids(user)), "password": password}

    @router.put("/client-accounts/{account_id}")
    async def update_account(account_id: str, body: ClientAccountUpdate, request: Request):
        user = await get_current_user(request)
        acc = await db.client_accounts.find_one({"_id": _oid(account_id, "login")})
        if not acc:
            raise HTTPException(status_code=404, detail="That login doesn't exist")
        upd: Dict[str, Any] = {"updated_at": _iso()}
        if body.name is not None:
            name = _clean(body.name, 80)
            if len(name) < 2:
                raise HTTPException(status_code=400, detail="Enter the customer's name")
            upd["name"] = name
        await _staff_may_change(acc, user)
        if body.project_ids is not None:
            ids = await _valid_projects([i for i in body.project_ids if i not in (acc.get("project_ids") or [])], user)
            upd["project_ids"] = [i for i in body.project_ids if i in (acc.get("project_ids") or [])] + ids
            if not upd["project_ids"]:
                raise HTTPException(status_code=400, detail="Keep at least one project — or turn the login off instead")
        if body.active is not None:
            if user["role"] == "staff" and (acc.get("created_by") != user["id"] or (body.active and acc.get("turned_off_by_role") in ("admin", "manager"))):
                raise HTTPException(status_code=403, detail="Ask a manager to turn this login on or off")
            upd["active"] = bool(body.active)
            upd["turned_off_by_role"] = None if body.active else user["role"]
            if not body.active:
                upd["password_version"] = int(acc.get("password_version") or 1) + 1   # signs them out everywhere
        await db.client_accounts.update_one({"_id": acc["_id"]}, {"$set": upd})
        await create_audit_log(user["id"], user.get("name", ""), "update", "client_account", account_id, None,
                               {k: v for k, v in upd.items() if k != "updated_at"})
        return await _account_out(await db.client_accounts.find_one({"_id": acc["_id"]}), own=await _own_project_ids(user))

    @router.post("/client-accounts/{account_id}/reset-password")
    async def reset_password(account_id: str, request: Request):
        user = await get_current_user(request)
        acc = await db.client_accounts.find_one({"_id": _oid(account_id, "login")})
        if not acc:
            raise HTTPException(status_code=404, detail="That login doesn't exist")
        await _staff_may_change(acc, user)
        password = temp_password()
        await db.client_accounts.update_one({"_id": acc["_id"]}, {"$set": {
            "password_hash": hash_password(password), "must_change_password": True,
            "password_version": int(acc.get("password_version") or 1) + 1, "password_reset_at": _iso(), "password_reset_by": user.get("name", "")}})
        await db.client_login_attempts.delete_many({"phone": acc.get("phone")})
        await create_audit_log(user["id"], user.get("name", ""), "update", "client_account", account_id, None, {"password": "reset"})
        return {"account": await _account_out(await db.client_accounts.find_one({"_id": acc["_id"]}), own=await _own_project_ids(user)),
                "password": password}

    @router.delete("/client-accounts/{account_id}")
    async def delete_account(account_id: str, request: Request):
        user = await require_role("admin", "manager")(request)
        acc = await db.client_accounts.find_one({"_id": _oid(account_id, "login")})
        if not acc:
            raise HTTPException(status_code=404, detail="That login doesn't exist")
        await db.client_accounts.delete_one({"_id": acc["_id"]})
        await create_audit_log(user["id"], user.get("name", ""), "delete", "client_account", account_id, {"name": acc.get("name"), "phone": acc.get("phone")})
        return {"deleted": True}

    @router.get("/projects/{project_id}/client-login")
    async def project_login(project_id: str, request: Request):
        user = await get_current_user(request)
        p = await _project_for_staff(project_id, user)
        phone = mobile((p.get("customer") or {}).get("phone"))
        acc = await db.client_accounts.find_one({"phone": phone}) if phone else None
        own = await _own_project_ids(user)
        return {"phone": phone, "name": (p.get("customer") or {}).get("name") or "", "account": await _account_out(acc, own=own) if acc else None,
                "linked": bool(acc and project_id in (acc.get("project_ids") or [])),
                "can_change": bool(acc) and (own is None or all(i in own for i in acc.get("project_ids") or []))}

    @router.post("/projects/{project_id}/client-login")
    async def make_project_login(project_id: str, request: Request):
        """One tap on the project page: make the customer's login (or add this project to the login they already have)."""
        user = await get_current_user(request)
        p = await _project_for_staff(project_id, user)
        phone = mobile((p.get("customer") or {}).get("phone"))
        if not phone:
            raise HTTPException(status_code=400, detail="Add the customer's 10-digit mobile number to the project first — it's their login.")
        acc = await db.client_accounts.find_one({"phone": phone})
        if acc:
            if project_id not in (acc.get("project_ids") or []):
                await _staff_may_change(acc, user)
                await db.client_accounts.update_one({"_id": acc["_id"]}, {"$push": {"project_ids": project_id}, "$set": {"updated_at": _iso()}})
                await create_audit_log(user["id"], user.get("name", ""), "update", "client_account", str(acc["_id"]), None, {"added_project": project_id})
            return {"account": await _account_out(await db.client_accounts.find_one({"_id": acc["_id"]}), own=await _own_project_ids(user)),
                    "password": None, "added": True}
        body = ClientAccountIn(name=(p.get("customer") or {}).get("name") or "Customer", phone=phone, project_ids=[project_id])
        if len(_clean(body.name, 80)) < 2:
            body.name = "Customer"
        return {**(await create_account(body, request)), "added": False}

    return router
