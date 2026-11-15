"""Rules for AI agents (Settings → AI agents), as pure functions that agents.py applies to the MCP server and to API keys:

* canonical_path — the one spelling of an API path. Encoded slashes, `..`, `//` and query smuggling are refused, so the
  path an agent's call is checked against is the path the router runs.
* refusal — calls an agent may never make, or only with an admin's extra switch, or not at its access level.
* confirm_reason — calls that run only after a person says yes (deletes, bulk changes, logins, bank details, anything
  that reaches customers or the public). MCP: call_api holds them and confirm_action runs them. REST: send the header
  X-Sensoper-Confirm: yes.
* scrub — secrets (password hashes, TOTP secrets, encrypted fields, API keys, tokens) never reach an agent, even when a
  normal endpoint returns them.
* rank_endpoints — plain-English search over the API ("unpaid invoices", "stock of panels").
"""
import json
import posixpath
import re
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import unquote

READ_METHODS = {"GET", "HEAD", "OPTIONS"}
CALL_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")
CONFIRM_HEADER = "x-sensoper-confirm"

# POSTs that only work something out (previews and calculators): read-only agents may call them too.
READ_POSTS = {"/api/amc/quotes/preview", "/api/loans/emi-preview", "/api/payroll/preview", "/api/expansion/simulate",
              "/api/calculate/quick", "/api/calculate/solution", "/api/calculate/pump/string-voltage",
              "/api/calculate/bill-savings", "/api/solar/sizing"}


def method_allowed(access: str, method: str, path: str = "") -> bool:
    """read: GET (and calculator previews) · write: also POST / PUT / PATCH · full: also DELETE."""
    method = (method or "").upper()
    if access == "full":
        return method in CALL_METHODS or method in READ_METHODS
    if access == "write":
        return method in READ_METHODS or method in ("POST", "PUT", "PATCH")
    return method in READ_METHODS or (method == "POST" and path in READ_POSTS)


# ───────────────────────── paths ─────────────────────────
_CTRL = re.compile(r"[\x00-\x1f\x7f]")
_BAD_ESCAPE = re.compile(r"%(2f|5c|25|3f|23|00|0a|0d|2e)", re.I)


def canonical_path(raw: Any) -> str:
    """'/api/vendors/66ab' style, or ValueError with what to do instead. Never rewrites a trick into a real path."""
    p = str(raw or "").strip()
    if not p:
        raise ValueError("Give the path, e.g. /api/vendors. list_endpoints finds it.")
    if "://" in p:
        raise ValueError("Give only the path, e.g. /api/vendors, not a full web address.")
    if "?" in p or "#" in p:
        raise ValueError("Put query parameters in 'query', not in the path.")
    if _BAD_ESCAPE.search(p):
        raise ValueError("The path has an encoded /, \\, %, ., ? or # in it. Write it plainly, e.g. /api/vendors/66ab12.")
    d = unquote(p)
    if "\\" in d or "%" in d or _CTRL.search(d):
        raise ValueError("The path has characters Sensoper doesn't use in addresses. Write it plainly, e.g. /api/vendors/66ab12.")
    if d.startswith("//"):
        raise ValueError("Remove the double slash (//) from the path.")
    d = d.lstrip("/")
    path = "/" + d if (d == "api" or d.startswith("api/")) else "/api/" + d
    segs = path.split("/")[1:]
    if len(segs) > 1 and segs[-1] == "":
        segs = segs[:-1]          # a trailing slash
    if any(s == "" for s in segs):
        raise ValueError("Remove the double slash (//) from the path.")
    if any(s in (".", "..") for s in segs):
        raise ValueError("Paths can't contain . or .. parts. Write the full path, e.g. /api/vendors/66ab12.")
    if "{" in path or "}" in path:
        raise ValueError("Fill in the path parameters, e.g. /api/vendors/66ab12 instead of /api/vendors/{vendor_id}.")
    return "/" + "/".join(segs)


def _forms(path: str) -> Set[str]:
    """Every way the router might read this path, for refusal checks only (more forms can only refuse more)."""
    p = unquote(path or "/")
    collapsed = re.sub(r"/{2,}", "/", p).rstrip("/") or "/"
    return {collapsed, posixpath.normpath(collapsed) if collapsed.startswith("/") else collapsed, (p.rstrip("/") or "/")}


def _rx(pattern: str) -> "re.Pattern[str]":
    """'/api/x/{}/y' (one segment) and a trailing '/**' (this path or anything under it)."""
    out = re.escape(pattern).replace(r"/\*\*", r"(?:/.*)?").replace(r"\{\}", r"[^/]+")
    return re.compile("^" + out + "$")


def _methods(m: str) -> Optional[Set[str]]:
    return None if m == "*" else set(m.split(","))


# ───────────────────────── never, or only with an admin's switch ─────────────────────────
AGENTS_MSG = "AI agents can't change AI agent access. An admin does that in Settings → AI agents."
SIGNIN_MSG = "Signing in, passwords and 2FA are for people, not AI agents."
LOGINS_MSG = ("This agent can't change logins, roles or login security. An admin can allow it in Settings → AI agents "
              "(Manage logins & permissions).")
SAVED_MSG = ("This agent can't open saved passwords (Company logins, inverter passwords). An admin can allow it in "
             "Settings → AI agents (Read saved passwords).")

_HARD: List[Tuple[Optional[Set[str]], "re.Pattern[str]", str, str]] = []   # (methods, path, needs: never | switch name, reason)


def _hard(methods: str, pattern: str, needs: str, reason: str) -> None:
    _HARD.append((_methods(methods), _rx(pattern), needs, reason))


for _p in ("/api/agents/**", "/api/oauth/**", "/api/mcp/**"):
    _hard("*", _p, "never", AGENTS_MSG)
_hard("*", "/api/auth/**", "never", SIGNIN_MSG)                       # GET /api/auth/me is let through in refusal()
for _p in ("/api/investor/**", "/api/client/**", "/api/portal/**"):
    _hard("*", _p, "never", "That is the investor / customer side of Sensoper. Use the staff endpoints instead.")
_hard("POST,PUT,PATCH,DELETE", "/api/public/**", "never", "That is the public website's form. Use the staff endpoints instead.")
_hard("*", "/api/integrations/google-drive/client-secret", "never", "Keys for outside services are for an admin in Settings.")
_hard("POST", "/api/integrations/google-drive/connect", "never", "Connecting Google Drive is for an admin in Settings.")
_hard("POST", "/api/integrations/google-drive/callback", "never", "Connecting Google Drive is for an admin in Settings.")
_hard("DELETE", "/api/integrations/google-drive", "never", "Disconnecting Google Drive is for an admin in Settings.")
_hard("PUT", "/api/audit-logs/archive-config", "never", "Archiving and clearing the activity log is for an admin.")
_hard("POST", "/api/audit-logs/archives/**", "never", "Archiving and clearing the activity log is for an admin.")
_hard("PUT", "/api/vault/config", "never", "Company logins settings are for an admin.")
_hard("GET", "/api/audit-logs/archives/{}/download", "never", "Activity log archives hold old values, passwords included. An admin downloads them.")
_hard("*", "/api/agent-approvals/**", "never", "Only a person signed in to Sensoper can approve what an AI agent asks to do.")
# logins, roles, permissions and login security
_hard("*", "/api/security/**", "manage_access", LOGINS_MSG)
_hard("POST,PUT,PATCH,DELETE", "/api/users/**", "manage_access", LOGINS_MSG)
_hard("POST,PUT,PATCH,DELETE", "/api/permissions/**", "manage_access", LOGINS_MSG)
_hard("POST", "/api/hr/candidates/{}/hire", "manage_access", LOGINS_MSG)              # makes a staff login
_hard("POST,PUT,PATCH", "/api/investors", "manage_access", LOGINS_MSG)                 # investor logins and passwords
_hard("PUT,PATCH,DELETE", "/api/investors/{}", "manage_access", LOGINS_MSG)
# saved passwords
_hard("*", "/api/vault/**", "read_saved_logins", SAVED_MSG)
_hard("GET", "/api/projects/{}/inverter-password", "read_saved_logins", SAVED_MSG)


def refusal(path: str, method: str, agent: Dict[str, Any]) -> Optional[str]:
    """Why this agent may not make this call (None = it may; the login's own permissions are checked after this)."""
    method = (method or "GET").upper()
    forms = _forms(path)
    for p in forms:
        if method == "GET" and p == "/api/auth/me":
            continue
        for methods, rx, needs, reason in _HARD:
            if (methods is None or method in methods) and rx.match(p):
                if needs == "never" or not agent.get(needs):
                    return reason
    access = agent.get("access", "read")
    if not all(method_allowed(access, method, p) for p in forms):
        return ("This agent has read-only access. An admin can give it Read & write in Settings → AI agents." if access == "read"
                else "This agent can't delete. An admin can give it Full control in Settings → AI agents.")
    return None


# ───────────────────────── a person's yes first ─────────────────────────
_CONFIRM: List[Tuple[Optional[Set[str]], "re.Pattern[str]", str]] = []


def _confirm(methods: str, pattern: str, what: str) -> None:
    _CONFIRM.append((_methods(methods), _rx(pattern), what))


_confirm("DELETE", "/api/hard-delete/**", "Permanently deletes this record. It can't be undone or restored.")
# logins and saved passwords (the switches above must be on as well)
_confirm("POST,PUT,PATCH,DELETE", "/api/users/**", "Changes who can sign in to Sensoper, or what they may do.")
_confirm("POST,PUT,PATCH,DELETE", "/api/permissions/**", "Changes what a role may do in Sensoper.")
_confirm("POST,PUT,PATCH,DELETE", "/api/security/**", "Changes login security (passwords or 2FA).")
_confirm("POST", "/api/hr/candidates/{}/hire", "Hires this candidate and creates their Sensoper login.")
_confirm("POST,PUT,PATCH", "/api/investors", "Creates an investor login.")
_confirm("PUT,PATCH", "/api/investors/{}", "Changes an investor's login or password.")
_confirm("POST", "/api/vault/{}/reveal", "Shows a saved password (Company logins) to the AI.")
_confirm("POST,PUT,PATCH,DELETE", "/api/vault/**", "Changes saved passwords (Company logins).")
_confirm("GET", "/api/projects/{}/inverter-password", "Shows this customer's inverter-app password to the AI.")
# customers and the public
_confirm("POST", "/api/client-accounts/{}/reset-password", "Resets a customer's website password and shows the new one.")
_confirm("POST,PUT,PATCH,DELETE", "/api/client-accounts/**", "Creates or changes a customer's login on the website.")
_confirm("POST", "/api/projects/{}/client-login", "Creates a website login for this project's customer.")
_confirm("POST", "/api/projects/{}/portal-link", "Makes a link the customer can open to see their project.")
_confirm("POST,PUT,PATCH,DELETE", "/api/website/popups/**", "Changes a pop-up that every visitor to sensoper.in sees.")
_confirm("PUT", "/api/website/settings", "Changes the public website's settings (WhatsApp number, contact details).")
_confirm("DELETE", "/api/website/leads/**", "Deletes this record.")
_confirm("PUT,PATCH", "/api/website/leads/**", None)                  # a lead's own follow-up is everyday work, not public
_confirm("POST,PUT,PATCH,DELETE", "/api/website/**", "Changes what the public website or shop shows (products, prices, testimonials, stores).")
_confirm("POST,PUT,PATCH,DELETE", "/api/customer-offers/**", "Changes offers that customers see on their dashboards.")
_confirm("POST", "/api/tneb/fetch", "Sends this customer's details to the bill-fetch service outside Sensoper.")
_confirm("POST", "/api/amc/contracts/{}/schedule", "Schedules visit reminders that go to the customer.")
# company, bank and pay details, and settings that decide who sees what
_confirm("POST,PUT,PATCH,DELETE", "/api/company/**", "Changes the company profile (name, GSTIN, bank details on invoices).")
_confirm("PUT", "/api/invoice-settings", "Changes invoice numbering and what invoices show.")
_confirm("PUT,PATCH", "/api/payroll/people/{}", "Changes a person's pay details (bank account, PAN, UAN).")
_confirm("PUT", "/api/payroll/settings", "Changes payroll settings, including who can open payroll.")
_confirm("PUT", "/api/drive/settings", "Changes where Sensoper copies files (Google Drive).")
# money that leaves, and work that can't easily be undone
for _p in ("approve", "paid", "reopen"):
    _confirm("POST", f"/api/payroll/runs/{{}}/{_p}", "Approves, reopens or marks a month's payroll as paid. This affects salaries.")
_confirm("POST", "/api/payroll/commission/approve", "Approves sales commission for payment.")
for _p in ("/api/deletion-requests/{}/approve", "/api/action-requests/{}/approve", "/api/inbound-action-requests/{}/approve",
           "/api/approvals/inbox/deletion_request/{}/approve", "/api/approvals/inbox/action_request/{}/approve",
           "/api/approvals/inbox/inbound_action/{}/approve"):
    _confirm("POST", _p, "Approves a request to delete or reverse a record. It runs as soon as it is approved.")
_confirm("PUT", "/api/approvals/{}/approve", "Approves a request, which may delete or change records.")
_confirm("POST", "/api/hr/exits/{}/complete", "Completes this exit. Their login closes on the last working day.")
_confirm("POST,PUT,PATCH,DELETE", "/api/hr/exits/**", "Starts or changes someone's exit. Their Sensoper login stops working after the last working day.")
# many records at once
for _p in ("/api/inventory/import", "/api/ecommerce/orders/import-commit", "/api/catalogue/products/{}/import",
           "/api/calculate/pincodes/import"):
    _confirm("POST", _p, "Imports many records from a file at once.")
for _p in ("/api/pricelist/bulk", "/api/pricelist/normalise-categories", "/api/payroll/extras/bulk", "/api/payroll/extras/approve-all",
           "/api/amc/contracts/bulk-renew", "/api/ecommerce/listings/bulk-status", "/api/catalogue/seed", "/api/calculate/seed-defaults",
           "/api/projects/backfill-locations", "/api/projects/location-review/auto-resolve", "/api/hr/roster/copy"):
    _confirm("POST", _p, "Changes many records at once.")
_confirm("DELETE", "/api/**", "Deletes this record.")

_BANK_KEY = re.compile(r"(^|_)(bank|ifsc|iban|swift|upi(_id)?|account_?(no|number|holder(_name)?)|acc_?no)($|_)", re.I)


def _bank_keys(body: Any, depth: int = 0) -> bool:
    if depth > 3:
        return False
    if isinstance(body, dict):
        return any(_BANK_KEY.search(str(k)) or _bank_keys(v, depth + 1) for k, v in body.items())
    if isinstance(body, list):
        return any(_bank_keys(x, depth + 1) for x in body[:50])
    return False


_PUBLIC_KEY = re.compile(r"^(on_website|show_on_website|shown_on_website|published|is_public|public|show_on_shop)$", re.I)


def confirm_reason(path: str, method: str, body: Any = None) -> Optional[str]:
    """What will happen, when this call needs a person's approval first (None = it runs straight away)."""
    method = (method or "GET").upper()
    forms = _forms(path)
    for methods, rx, what in _CONFIRM:
        if (methods is None or method in methods) and any(rx.match(p) for p in forms):
            if what is None:
                break                 # an exception listed before a broader hold
            return what
    if method in ("POST", "PUT", "PATCH") and _bank_keys(body):
        return "Changes bank or payment details."
    if method in ("POST", "PUT", "PATCH") and isinstance(body, dict) and any(_PUBLIC_KEY.match(str(k)) for k in body):
        return "Changes what the public website shows."
    return None


# Answers that are meant to carry a password (and are only reachable with the right switch and a person's yes)
# Customer logins and resets are not here: their new password never reaches an agent (the person who approved sees it).
_PASSWORD_ANSWERS = [(_rx("/api/vault/{}/reveal"), "read_saved_logins"), (_rx("/api/projects/{}/inverter-password"), "read_saved_logins")]


def passwords_allowed(path: str, method: str, agent: Dict[str, Any]) -> bool:
    if (method or "").upper() not in ("GET", "POST"):
        return False
    for rx, needs in _PASSWORD_ANSWERS:
        if any(rx.match(p) for p in _forms(path)):
            return needs is None or bool(agent.get(needs))
    return False


# ───────────────────────── secrets never reach an agent ─────────────────────────
HIDDEN = "[hidden]"
_SECRET_KEY = re.compile(
    r"(password|passwd|pwd)_?(hash|enc|encrypted)|hashed_?password|(^|_)hash(es)?$|_hashes$|_enc$|^enc_|encrypted|cipher|"
    r"secret|api_?key|private_?key|manual_key|(^|_)token$|(^|_)tokens$|token_(hash|enc)|"
    r"(^|_)(pin|mpin|upi_pin|login_pin|otp|otp_code|otp_secret)$|totp|backup_?codes?|recovery_?codes?", re.I)
_PASSWORD_KEY = re.compile(r"(^|_)(password|passwd|pwd|passcode|new_password|temp_password)$", re.I)
_SECRET_VALUE = re.compile(r"snp_(key|at|rt)_[A-Za-z0-9_-]{20,}|\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}|"
                           r"eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|gAAAAA[A-Za-z0-9_=-]{40,}")
# "password: hunter2" or "api_key=xyz" written inside text (not PIN: in India that is also a postal code)
_SECRET_TEXT = re.compile(r"(?i)\b(password|passwd|pwd|passcode|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?token|"
                          r"refresh[_ -]?token|otp)(\s*[:=]\s*)(\"[^\"]*\"|'[^']*'|[^\s,;&\"']+)")
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def _key(k: Any) -> str:
    """'passwordHash' and 'password-hash' read as 'password_hash'."""
    return _CAMEL.sub("_", str(k)).replace("-", "_").lower()


def secret_key(k: Any, allow_passwords: bool = False) -> bool:
    kk = _key(k)
    return bool(_SECRET_KEY.search(kk) or (not allow_passwords and _PASSWORD_KEY.search(kk)))


def scrub_text(text: str) -> str:
    text = _SECRET_VALUE.sub(HIDDEN, text)
    return _SECRET_TEXT.sub(lambda m: f"{m.group(1)}{m.group(2)}{HIDDEN}", text)


def _scrub_str(v: str, allow_passwords: bool, depth: int) -> str:
    t = v.strip()
    if len(t) > 1 and t[0] in "{[" and t[-1] in "}]":     # JSON kept as text (audit old_data / new_data)
        try:
            inner = json.loads(t)
        except ValueError:
            inner = None
        if isinstance(inner, (dict, list)):
            return json.dumps(scrub(inner, allow_passwords, depth + 1), ensure_ascii=False, default=str)
    return scrub_text(v) if len(v) > 6 else v


def scrub(data: Any, allow_passwords: bool = False, _depth: int = 0) -> Any:
    """The same data with secrets replaced by "[hidden]" (yes/no flags such as totp_enabled stay). A hidden value is
    also taken out of the other fields next to it (a portal token inside its link)."""
    if _depth > 40:
        return data
    if isinstance(data, dict):
        out: Dict[str, Any] = {}
        found: List[str] = []
        pair_name = next((data[n] for n in ("key", "name", "field", "label") if isinstance(data.get(n), str)), None)
        pair_secret = pair_name is not None and secret_key(pair_name, allow_passwords)    # {"key": "api_key", "value": "…"}
        for k, v in data.items():
            hide = secret_key(k, allow_passwords) or (pair_secret and str(k) in ("value", "val", "secret"))
            if hide and v not in (None, "", [], {}) and not isinstance(v, (bool, int, float)):
                out[k] = HIDDEN
                if isinstance(v, str) and len(v) >= 8:
                    found.append(v)
            else:
                out[k] = scrub(v, allow_passwords, _depth + 1)
        if found:
            for k, v in out.items():
                if isinstance(v, str) and v != HIDDEN:
                    for f in found:
                        v = v.replace(f, HIDDEN)
                    out[k] = v
        return out
    if isinstance(data, list):
        return [scrub(x, allow_passwords, _depth + 1) for x in data]
    if isinstance(data, str):
        return _scrub_str(data, allow_passwords, _depth)
    return data


def scrub_json_bytes(raw: bytes, allow_passwords: bool = False) -> bytes:
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return scrub_text(raw.decode("utf-8", "replace")).encode()
    return json.dumps(scrub(data, allow_passwords), ensure_ascii=False, default=str, separators=(",", ":")).encode()


def scrub_csv(text: str) -> str:
    """A CSV download: columns whose header names a secret are blanked, and secrets written in cells are hidden."""
    import csv
    import io
    try:
        rows = list(csv.reader(io.StringIO(text)))
    except csv.Error:
        return scrub_text(text)
    if not rows:
        return text
    bad = {i for i, h in enumerate(rows[0]) if secret_key(h.strip())}
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(rows[0])
    for r in rows[1:]:
        w.writerow([HIDDEN if i in bad and c else scrub_text(c) for i, c in enumerate(r)])
    return out.getvalue()


def summarize(body: Any, limit: int = 180) -> str:
    """A short, secret-free line about what was sent: 'name=Erode Solar · qty=10 · items=[3]'."""
    if body is None or body == "" or body == {}:
        return ""
    body = scrub(body)
    if isinstance(body, list):
        return f"[{len(body)} items]"
    if not isinstance(body, dict):
        s = " ".join(str(body).split())
        return s[:limit]
    parts = []
    for k, v in body.items():
        if isinstance(v, list):
            parts.append(f"{k}=[{len(v)}]")
        elif isinstance(v, dict):
            parts.append(f"{k}={{…}}")
        elif v is None or v == "":
            continue
        else:
            s = " ".join(str(v).split())
            parts.append(f"{k}={s[:40] + '…' if len(s) > 40 else s}")
    out = " · ".join(parts)
    return out[: limit - 1] + "…" if len(out) > limit else out


# ───────────────────────── finding endpoints in plain words ─────────────────────────
STOP = {"a", "an", "the", "of", "for", "all", "list", "show", "me", "my", "get", "find", "with", "in", "on", "to", "and", "which",
        "what", "how", "many", "is", "are", "do", "we", "our", "by", "from", "at", "any", "give", "see", "please", "this", "that",
        "there", "who", "where", "api", "endpoint", "endpoints", "data", "details", "record", "records"}
# Status and time words are filters on a list (query parameters), not what the endpoint is about.
FILTER_WORDS = {"pending", "approved", "completed", "complete", "open", "closed", "active", "today", "todays", "yesterday", "week",
                "month", "year", "current", "new", "latest", "recent", "due", "last", "next", "upcoming", "total",
                "count", "number", "status"}

SYNONYMS: Dict[str, Tuple[str, ...]] = {
    "unpaid": ("credits", "outstanding", "due", "pending", "balance", "receivable"),
    "outstanding": ("credits", "due", "pending", "balance"),
    "owed": ("credits", "outstanding"), "receivable": ("credits", "outstanding"), "overdue": ("credits", "outstanding"),
    "invoice": ("invoice", "credits", "sales", "billing", "gst"), "bill": ("invoice", "credits", "billing"),
    "stock": ("inventory", "items", "stock"), "inventory": ("inventory", "items", "stock"), "store": ("inventory", "storage"),
    "panel": ("inventory", "items", "module", "solar"), "module": ("inventory", "items"), "inverter": ("inventory", "items"),
    "battery": ("inventory", "items"), "cable": ("inventory", "items"), "material": ("inventory", "items", "material"),
    "customer": ("customer", "client", "projects", "credits"), "client": ("client", "customer", "projects"),
    "vendor": ("vendors", "supplier"), "supplier": ("vendors", "supplier"), "po": ("purchase-orders", "purchase"),
    "purchase": ("purchase-orders", "purchase-requests", "purchase"), "buy": ("purchase-orders", "purchase-requests"),
    "staff": ("users", "hr", "people", "employees"), "employee": ("users", "hr", "people", "payroll"),
    "people": ("users", "hr", "people", "org-structure"), "salary": ("payroll", "salary", "payslip"), "pay": ("payroll", "payments"),
    "payslip": ("payroll", "payslip"), "attendance": ("attendance", "check"), "present": ("attendance",), "leave": ("hr", "covers"),
    "loan": ("loans", "emi"), "emi": ("loans", "emi"), "expense": ("accounts", "expenses"), "spend": ("accounts", "expenses"),
    "quote": ("projects", "quotation", "quotes"), "quotation": ("projects", "quotation", "quotes"), "estimate": ("projects", "calculate"),
    "lead": ("website", "leads", "projects"), "enquiry": ("website", "leads"), "amc": ("amc", "contracts", "maintenance"),
    "maintenance": ("amc", "visits"), "service": ("amc", "support"), "complaint": ("support", "tickets", "helpdesk"),
    "ticket": ("support", "tickets", "helpdesk"), "delivery": ("deliveries",), "dispatch": ("deliveries",),
    "return": ("returns",), "report": ("reports", "daily-reports"), "payment": ("payments", "credits", "pay"),
    "receipt": ("payments", "credits"), "gst": ("accounts", "gst", "invoice"), "tax": ("gst", "tds", "accounts"),
    "site": ("projects", "site-diaries", "site"), "project": ("projects",), "install": ("projects", "installation"),
    "installation": ("projects",), "sale": ("sales",), "sold": ("sales",), "order": ("orders", "purchase-orders", "ecommerce"),
    "price": ("pricelist", "pricing-slabs", "price"), "rate": ("pricelist", "rate"), "branch": ("locations",), "location": ("locations",),
    "subcontractor": ("partners",), "crew": ("partners", "internal-teams"), "team": ("internal-teams", "teams"),
    "asset": ("assets",), "tool": ("assets",), "vehicle": ("assets",), "brand": ("brands",), "trademark": ("brands", "trademarks"),
    "profit": ("alerts", "ceo", "dashboard"), "revenue": ("ceo", "dashboard", "reports"), "kit": ("material-kits", "kits"),
    "event": ("calendar", "events"), "meeting": ("calendar",), "todo": ("dashboard",), "task": ("dashboard",),
    "approval": ("approvals", "inbox"), "approve": ("approve", "approvals"), "investor": ("investors",),
    "subsidy": ("subsidy",), "reading": ("readings", "generation"), "generation": ("readings",),
}

_SPLIT = re.compile(r"[^a-z0-9]+")


def stem(w: str) -> str:
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith(("ses", "xes", "ches", "shes")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def words(text: str) -> List[str]:
    return [stem(w) for w in _SPLIT.split((text or "").lower()) if w]


def query_terms(query: str) -> List[Tuple[str, Set[str]]]:
    """[(word, {its synonyms})] for the meaningful words of a plain-English query."""
    out = []
    for w in words(query):
        if w in STOP or w in FILTER_WORDS or len(w) < 2:
            continue
        syn = {stem(s) for x in SYNONYMS.get(w, ()) for s in _SPLIT.split(x) if s}
        out.append((w, syn - {w}))
    return out


def score_endpoint(terms: List[Tuple[str, Set[str]]], e: Dict[str, Any], area_name: str) -> float:
    path_w = set(words(re.sub(r"\{[^}]*\}", " ", e["path"])))
    summary_w = set(words(e.get("summary", "")))
    area_w = set(words(area_name))
    about_w = set(words(e.get("about", "")))
    total, hit = 0.0, 0
    path_hits: Set[str] = set()
    for w, syn in terms:
        best = 0.0
        for bag, exact, alt in ((path_w, 6.0, 3.5), (summary_w, 5.0, 2.5), (area_w, 4.0, 2.0), (about_w, 1.5, 0.75)):
            if w in bag:
                best = max(best, exact)
            elif syn & bag:
                best = max(best, alt)
            elif len(w) >= 4 and any(b.startswith(w) for b in bag):
                best = max(best, exact / 2)
        path_hits |= ({w} | syn) & path_w
        if best:
            hit += 1
        total += best
    if not hit:
        return 0.0
    total *= hit / len(terms)                       # every word that matches counts; matching them all counts most
    total += 0.5 * max(0, len(path_hits) - 1)        # 'stock of panels': inventory *items* over inventory export
    if e["method"] == "GET":
        total += 0.5
    if e["method"] == "DELETE" and not any(w in DELETE_WORDS for w, _ in terms):
        total -= 1.5
    total -= 0.25 * e["path"].count("{") + 0.1 * e["path"].count("/")   # lists and short paths first
    return total


DELETE_WORDS = {"delete", "remove", "drop", "cancel", "erase", "purge", "clear"}


def rank_endpoints(query: str, endpoints: Iterable[Dict[str, Any]], area_name: Callable[[str], str]) -> List[Dict[str, Any]]:
    terms = query_terms(query)
    if not terms:
        return sorted(endpoints, key=lambda e: (e["path"], CALL_METHODS.index(e["method"]) if e["method"] in CALL_METHODS else 9))
    scored = [(score_endpoint(terms, e, area_name(e["area"])), e) for e in endpoints]
    scored = [(s, e) for s, e in scored if s > 0]
    scored.sort(key=lambda x: (-x[0], x[1]["path"], x[1]["method"]))
    return [e for _, e in scored]
