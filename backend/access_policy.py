"""One map of who may do what — the source of truth for the Permissions page, the menu and the API.

Every page in the app is listed once (grouped like the menu) with the actions it supports and the extra
options that belong to it. Each API route that belongs to a page or an option is listed in RULES, so a
switch on the Permissions page really opens or closes that part of the app for a role:

  * switched OFF → the API refuses the request for that role, even if the old code allowed it;
  * switched ON  → the request is allowed for that role, even where the old code only allowed admins/managers.

Admins always have everything. A few pages are locked to admins and can never be given to anyone else.
Routes not listed here are shared look-ups (inventory items, locations, terms…) that many pages need, and keep
their own checks.
"""
import re
import time
from typing import Any, Dict, List, Optional, Tuple

ACTIONS = ("view", "create", "edit", "delete", "export")
POLICY_VERSION = 2

V, C, E, D, X = "view", "create", "edit", "delete", "export"
ALL = (V, C, E, D, X)


def _page(key, label, what, actions=ALL, options=(), locked=False, always=False, staff=(), manager=(), opts_default=None):
    """staff / manager = the actions those roles get by default (matching how the app behaved before)."""
    return {"key": key, "label": label, "what": what, "actions": list(actions), "options": [dict(o) for o in options],
            "locked": locked, "always": always, "defaults": {"staff": list(staff), "manager": list(manager)},
            "opts_default": opts_default or {}}


def _opt(key, label, what, staff=False, manager=True):
    return {"key": key, "label": label, "what": what, "defaults": {"staff": staff, "manager": manager}}


SECTIONS: List[Dict[str, Any]] = [
    {"id": "home", "label": "Home", "pages": [
        _page("module_dashboard", "Home", "The starting screen: today’s to-dos and quick buttons.", actions=(V,), always=True,
              staff=(V,), manager=(V,)),
        _page("module_ceo_dashboard", "Business health", "Revenue, profit, cash and the Company Health Score (Home → Business health).",
              actions=(V, X), manager=(V, X)),
    ]},
    {"id": "daily", "label": "Daily work", "pages": [
        _page("module_attendance", "Attendance", "Check in and check out with time and location.", actions=(V, C),
              staff=(V, C), manager=(V, C),
              options=[_opt("can_view_team_attendance", "See the team’s attendance", "Team tab, monthly register and fixing check-in times.")]),
        _page("module_daily_updates", "Daily report", "One short report per person per day.", actions=(V, C, D, X),
              staff=(V, C, D, X), manager=(V, C, D, X),
              options=[_opt("can_review_daily_reports", "See and review everyone’s reports", "Team tab: who has sent their report, and review notes.")]),
        _page("module_site_diary", "Site diary", "Day-by-day log of each installation site.", actions=(V, C, D, X),
              staff=(V, C, D, X), manager=(V, C, D, X)),
        _page("module_readings", "Readings", "Generation checks for finished sites.", staff=(V, C, E, X), manager=(V, C, E, D, X)),
        _page("module_audits", "Weekly audits", "The weekly operations checklist.", manager=(V, C, E, X)),
    ]},
    {"id": "sales", "label": "Sales & projects", "pages": [
        _page("module_projects", "New project & Projects", "Site visits, quotations and every project page.",
              staff=(V, C, E), manager=(V, C, E, X),
              options=[_opt("can_approve_quotation", "Approve or reject quotations", "Approve / Reject on a project, and changing its status."),
                       _opt("can_complete_project", "Mark projects as completed", "The Mark as Completed button and handover details."),
                       _opt("can_make_invoice", "Make GST invoices", "Generate Invoice on approved projects."),
                       _opt("can_set_margin", "Change project margins", "Apply margins on a project’s cost summary."),
                       _opt("can_delete_project", "Delete projects straight away", "Force delete, without asking for approval.", manager=False)]),
        _page("module_approvals", "Approvals", "Requests waiting for a decision.", actions=(V, E), manager=(V, E),
              options=[_opt("can_approve_deletion", "Approve deletion requests", "Say yes to a request to delete a project.")]),
        _page("module_customer_offers", "Customer offers", "Offers on customers’ dashboards and who to call back.", actions=(V, C, E, D),
              manager=(V, C, E, D)),
        _page("module_direct_sales", "Direct sales", "Counter and B2B sales with GST invoices.", staff=(V, C), manager=(V, C, E, X)),
        _page("module_ecommerce", "Online orders", "Marketplace products and orders.", manager=(V, C, E, D, X)),
        _page("module_amc", "AMC & service", "Maintenance contracts, visits and support tickets.", manager=(V, C, E, X)),
    ]},
    {"id": "stock", "label": "Stock & purchase", "pages": [
        _page("module_inventory", "Inventory", "Everything in the store.", manager=(V, C, E, X)),
        _page("module_kits", "Solution kits", "Ready-made material bundles.", actions=(V, C, E, D), manager=(V, C, E, D)),
        _page("module_purchase_inbound", "Purchases", "Purchase orders from order to stock.", manager=(V, C, E, X),
              options=[_opt("can_approve_purchase", "Approve purchase orders", "Approve / Reject on a pending PO.")]),
        _page("module_delivery_outbound", "Deliveries", "Material sent to sites.", manager=(V, C, E, X)),
        _page("module_returns", "Brand returns", "Material going back to suppliers.", manager=(V, C, E, D, X)),
        _page("module_vendors", "Vendors", "Supplier directory.", manager=(V, C, E, D, X)),
        _page("module_pricelist", "Price list", "Product prices, package slabs and service rates.", actions=(V, C, E, D, X)),
    ]},
    {"id": "people", "label": "People & field", "pages": [
        _page("module_org", "Organisation", "Who works where, and who is in today.", actions=(V,)),
        _page("module_partners", "Subcontractors", "Crews, rate cards, assignments and payments.", manager=(V, C, E, X)),
        _page("module_teams", "Internal teams", "Our own installation teams.", manager=(V, C, E, X)),
        _page("module_assets", "Assets & tools", "Vehicles, tools and safety gear.", staff=(V, E), manager=(V, C, E, X)),
    ]},
    {"id": "money", "label": "Money & insights", "pages": [
        _page("module_credits", "Accounts", "Money owed, payments, expenses and GST.", manager=(V, C, E, D, X)),
        _page("module_alerts", "Profit alerts", "Projects that may be losing money.", actions=(V, E, X), manager=(V, E, X)),
        _page("module_reports", "Reports", "Ready-made reports to download.", actions=(V, X), manager=(V, X)),
        _page("module_expansion", "Expansion", "Where to open the next branch.", actions=(V, C, E, D, X), manager=(V, C, E, D, X)),
        _page("module_investors", "Investors", "Investor logins, their money and what they can see.", locked=True),
    ]},
    {"id": "settings", "label": "Settings", "pages": [
        _page("module_company", "Company profile", "Name, logo, GSTIN and invoice numbering.", actions=(V, C, E, D)),
        _page("module_users", "Users", "Who can sign in, and their role.", locked=True),
        _page("module_permissions", "Permissions", "This page.", locked=True),
        _page("module_locations", "Locations", "Branches and who belongs to each.", actions=(V, C, E, D)),
        _page("module_settings", "Settings", "Rounding, sales target, calculator and Google Drive.", actions=(V, E)),
        _page("module_terms", "Terms & conditions", "Terms printed on quotations and invoices.", actions=(V, C, E, D), manager=(V, C, E)),
        _page("module_form_builder", "Form builder", "Extra steps and fields on New project.", actions=(V, C, E, D)),
        _page("module_audit_logs", "Activity log", "Who changed what, and when.", actions=(V, X)),
        _page("module_vault", "Company logins", "Passwords for outside services.", locked=True),
        _page("module_security", "My login & 2FA", "Everyone can change their own password.", actions=(V,), always=True,
              staff=(V,), manager=(V,)),
    ]},
]

PAGES: Dict[str, Dict[str, Any]] = {p["key"]: {**p, "section": s["label"]} for s in SECTIONS for p in s["pages"]}
OPTIONS: Dict[str, Dict[str, Any]] = {o["key"]: {**o, "page": p["key"]} for p in PAGES.values() for o in p["options"]}
LOCKED = {k for k, p in PAGES.items() if p["locked"]}
ALWAYS = {k for k, p in PAGES.items() if p["always"]}

# Older keys that are still read in a few places (approvals types, company/terms/audit flags).
LEGACY_FLAGS = ("can_create_project", "can_edit_project", "can_request_delete", "can_approve_margin", "can_edit_inventory",
                "can_approve_inventory", "can_manage_users", "can_change_user_access", "can_view_reports", "can_view_audit_logs",
                "can_manage_company", "can_manage_terms")


def default_permissions(role: str) -> Dict[str, Any]:
    """The recommended matrix for a role (admin = everything)."""
    out: Dict[str, Any] = {}
    for key, p in PAGES.items():
        if role == "admin":
            allowed = set(ACTIONS)
        elif p["locked"]:
            allowed = set()
        else:
            allowed = set(p["defaults"].get(role, ()))
        out[key] = {a: (a in allowed) for a in ACTIONS}
    for key, o in OPTIONS.items():
        out[key] = True if role == "admin" else bool(o["defaults"].get(role, False))
    legacy_mgr = {"can_create_project": True, "can_edit_project": True, "can_request_delete": True, "can_approve_margin": True,
                  "can_edit_inventory": True, "can_approve_inventory": True, "can_manage_users": False, "can_change_user_access": False,
                  "can_view_reports": True, "can_view_audit_logs": False, "can_manage_company": False, "can_manage_terms": True}
    legacy_staff = {k: k in ("can_create_project", "can_edit_project", "can_request_delete") for k in LEGACY_FLAGS}
    for k in LEGACY_FLAGS:
        out[k] = True if role == "admin" else (legacy_mgr if role == "manager" else legacy_staff).get(k, False)
    return out


def merge_with_defaults(role: str, stored: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Stored values win; anything missing (a page added later) comes from the defaults. Locked/always pages are forced."""
    base = default_permissions(role)
    stored = stored or {}
    out = dict(base)
    for k, v in stored.items():
        if k in PAGES and isinstance(v, dict):
            out[k] = {a: bool(v.get(a, base[k][a])) for a in ACTIONS}
        elif k in PAGES:
            continue
        elif isinstance(v, (bool, int)) or isinstance(v, dict):
            out[k] = v
    if role == "admin":
        return default_permissions("admin")
    for k in LOCKED:
        out[k] = {a: False for a in ACTIONS}
    for k in ALWAYS:
        out[k] = {**out[k], "view": True}
    for k, p in PAGES.items():  # actions a page doesn't have are always off; no view → nothing else
        row = out[k]
        out[k] = {a: bool(row.get(a)) and a in p["actions"] and bool(row.get("view")) for a in ACTIONS}
    return out


def sanitize(role: str, incoming: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    """Keep only known keys from a Permissions-page save; unknown keys from older versions are preserved from `current`."""
    out = dict(current)
    for k, v in (incoming or {}).items():
        if k in PAGES and isinstance(v, dict):
            out[k] = {a: bool(v.get(a, False)) for a in ACTIONS}
        elif k in OPTIONS or k in LEGACY_FLAGS:
            out[k] = bool(v)
    return merge_with_defaults(role, out)


# The matrix as it was seeded before the Permissions page was connected (used once, to migrate stored values).
OLD_DEFAULTS = {
    "admin": {
        "can_create_project": True, "can_edit_project": True, "can_delete_project": True,
        "can_request_delete": True, "can_approve_deletion": True,
        "can_approve_quotation": True, "can_set_margin": True, "can_approve_margin": True,
        "can_edit_inventory": True, "can_approve_inventory": True,
        "can_manage_users": True, "can_change_user_access": True,
        "can_view_reports": True, "can_view_audit_logs": True,
        "can_manage_company": True, "can_manage_terms": True,
        # Module-level (added Feb 2026 for Accounts, Readings, refreshed UI)
        "module_dashboard": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_ceo_dashboard": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_expansion": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_direct_sales": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_accounts": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_readings": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_inventory": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_purchase_inbound": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_delivery_outbound": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_credits": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_returns": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_audits": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_reports": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_alerts": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_approvals": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_users": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_permissions": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_settings": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_assets": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_amc": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_locations": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_partners": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_ecommerce": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_teams": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_projects": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_daily_updates": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_vendors": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_vault": {"view": True, "create": True, "edit": True, "delete": True, "export": False},
    },
    "manager": {
        "can_create_project": True, "can_edit_project": True, "can_delete_project": False,
        "can_request_delete": True, "can_approve_deletion": True,
        "can_approve_quotation": True, "can_set_margin": True, "can_approve_margin": True,
        "can_edit_inventory": True, "can_approve_inventory": True,
        "can_manage_users": False, "can_change_user_access": False,
        "can_view_reports": True, "can_view_audit_logs": True,
        "can_manage_company": False, "can_manage_terms": True,
        "module_dashboard": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_ceo_dashboard": {"view": True, "create": False, "edit": False, "delete": False, "export": True},
        "module_expansion": {"view": True, "create": False, "edit": False, "delete": False, "export": True},
        "module_direct_sales": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_accounts": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_readings": {"view": True, "create": True, "edit": True, "delete": True, "export": True},
        "module_inventory": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_purchase_inbound": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_delivery_outbound": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_credits": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_returns": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_audits": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_reports": {"view": True, "create": False, "edit": False, "delete": False, "export": True},
        "module_alerts": {"view": True, "create": False, "edit": True, "delete": False, "export": True},
        "module_approvals": {"view": True, "create": False, "edit": True, "delete": False, "export": False},
        "module_users": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_permissions": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_settings": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_assets": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_amc": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_locations": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_partners": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_ecommerce": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_teams": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_projects": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_daily_updates": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_vendors": {"view": True, "create": True, "edit": True, "delete": False, "export": True},
        "module_vault": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
    },
    "staff": {
        "can_create_project": True, "can_edit_project": True, "can_delete_project": False,
        "can_request_delete": True, "can_approve_deletion": False,
        "can_approve_quotation": False, "can_set_margin": False, "can_approve_margin": False,
        "can_edit_inventory": False, "can_approve_inventory": False,
        "can_manage_users": False, "can_change_user_access": False,
        "can_view_reports": False, "can_view_audit_logs": False,
        "can_manage_company": False, "can_manage_terms": False,
        "module_dashboard": {"view": True, "create": True, "edit": True, "delete": False, "export": False},
        "module_ceo_dashboard": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_expansion": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_direct_sales": {"view": True, "create": True, "edit": False, "delete": False, "export": False},
        "module_accounts": {"view": True, "create": True, "edit": False, "delete": False, "export": False},
        "module_readings": {"view": True, "create": True, "edit": True, "delete": False, "export": False},
        "module_inventory": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_purchase_inbound": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_delivery_outbound": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_credits": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_returns": {"view": True, "create": True, "edit": False, "delete": False, "export": False},
        "module_audits": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_reports": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_alerts": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_approvals": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_users": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_permissions": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_settings": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_assets": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_amc": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_locations": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_partners": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_ecommerce": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_teams": {"view": True, "create": False, "edit": False, "delete": False, "export": False},
        "module_projects": {"view": True, "create": True, "edit": True, "delete": False, "export": False},
        "module_daily_updates": {"view": True, "create": True, "edit": True, "delete": False, "export": False},
        "module_vendors": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
        "module_vault": {"view": False, "create": False, "edit": False, "delete": False, "export": False},
    }
}

# What the old Permissions page showed — a "no" there was something an admin could see and choose.
OLD_UI_KEYS = {"module_dashboard", "module_ceo_dashboard", "module_accounts", "module_readings", "module_inventory", "module_purchase_inbound",
               "module_delivery_outbound", "module_credits", "module_returns", "module_audits", "module_reports", "module_alerts",
               "module_approvals", "module_users", "module_permissions", "module_settings", "module_partners", "module_ecommerce"}

# Old keys that the new pages were split out of: a "no" there carries over to the new page.
SPLIT_FROM = {"module_site_diary": "module_daily_updates", "module_kits": "module_inventory", "module_pricelist": "module_settings",
              "module_form_builder": "module_settings", "module_company": "module_settings", "module_terms": "module_settings"}


def _declared_no(role: str, stored: Dict[str, Any], key: str, action: str) -> bool:
    """True when the stored matrix says 'no' and an admin chose that (it was on the old page, or differs from the seed)."""
    sv = stored.get(key)
    if not isinstance(sv, dict) or sv.get(action, True) is not False:
        return False
    seeded = ((OLD_DEFAULTS.get(role) or {}).get(key) or {}).get(action)
    return key in OLD_UI_KEYS or seeded is not False


def migrate_v2(role: str, stored: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """One-time move to the connected matrix. Before this, the menu ignored most switches, so we start from the
    recommended defaults (which match what each role could really do) and keep every 'no' an admin had chosen.
    Nothing gets wider than it was."""
    new = default_permissions(role)
    if role == "admin" or not stored:
        return merge_with_defaults(role, new)
    for key in PAGES:
        src_key = key if isinstance(stored.get(key), dict) else SPLIT_FROM.get(key, "")
        new[key] = {a: new[key][a] and not _declared_no(role, stored, src_key, a) for a in ACTIONS}
    if _declared_no(role, stored, "module_accounts", "view"):
        new["module_credits"] = {a: False for a in ACTIONS}
    for flag, key in (("can_manage_terms", "module_terms"), ("can_view_audit_logs", "module_audit_logs"), ("can_manage_company", "module_company")):
        if stored.get(flag) is False:
            new[key] = {a: False for a in ACTIONS}
    for k in LEGACY_FLAGS:
        if k in stored:
            new[k] = bool(stored[k])
    for k in OPTIONS:  # the old flag of the same name keeps its value (e.g. can_approve_quotation)
        if k in stored and isinstance(stored[k], bool):
            new[k] = new[k] and stored[k] if k == "can_delete_project" else stored[k]
    return merge_with_defaults(role, new)


# ───────────────────────── API routes → page / option ─────────────────────────
# (methods, route template glob, target). Target: ("page", key, action or None=by method) | ("option", key) | None = shared.
METHOD_ACTION = {"GET": V, "POST": C, "PUT": E, "PATCH": E, "DELETE": D}
_R = []


def rule(methods, pattern, target):
    _R.append((set(methods.split(",")) if methods != "*" else None,
               re.compile("^" + re.escape(pattern).replace(r"\*", ".*") + "$"), target))


def page(key, action=None, grant=True):
    """grant=False: the switch can take this away, but can't hand it to a role the code doesn't already allow."""
    return ("page", key, action, grant)


def option(key):
    return ("option", key)


# options first (most specific)
rule("GET", "/api/attendance/team", option("can_view_team_attendance"))
rule("GET", "/api/attendance/register", option("can_view_team_attendance"))
rule("PUT", "/api/attendance/{record_id}", option("can_view_team_attendance"))
rule("GET", "/api/daily-reports/team", option("can_review_daily_reports"))
rule("PUT", "/api/daily-reports/{report_id}/review", option("can_review_daily_reports"))
rule("POST", "/api/projects/{project_id}/approve", option("can_approve_quotation"))
rule("POST", "/api/projects/{project_id}/reject", option("can_approve_quotation"))
rule("PUT", "/api/projects/{project_id}/status", option("can_approve_quotation"))
rule("POST", "/api/projects/{project_id}/complete", option("can_complete_project"))
rule("POST", "/api/projects/{project_id}/invoice", option("can_make_invoice"))
rule("PUT", "/api/projects/{project_id}/margin", option("can_set_margin"))
rule("DELETE", "/api/projects/{project_id}/force", option("can_delete_project"))
rule("PUT", "/api/projects/{project_id}/reference", option("can_approve_quotation"))
rule("POST", "/api/deletion-requests/{request_id}/*", option("can_approve_deletion"))
rule("PUT", "/api/purchase-orders/{po_id}/approve", option("can_approve_purchase"))
rule("PUT", "/api/purchase-orders/{po_id}/reject", option("can_approve_purchase"))

# shared look-ups and admin-only odds and ends — no decision here
for m, pat in [("GET", "/api/inventory/items*"), ("GET", "/api/inventory/alerts"), ("GET", "/api/inventory/categories"),
               ("GET", "/api/inventory/storage-locations"), ("GET", "/api/material-kits*"), ("GET", "/api/kit-categories"),
               ("GET", "/api/vendors"), ("GET", "/api/partners/assignments/*"), ("GET", "/api/partners/project-scope/*"),
               ("GET", "/api/partners/meta/*"), ("GET", "/api/partners/tags/*"), ("GET", "/api/internal-teams"), ("GET", "/api/internal-teams/{team_id}"),
               ("GET", "/api/alerts/project/*"), ("GET", "/api/accounts/marketing-summary"), ("GET", "/api/pricing-slabs*"),
               ("GET", "/api/catalogue/*"), ("GET", "/api/terms*"), ("GET", "/api/form-tabs"), ("GET", "/api/locations"), ("GET", "/api/company*"),
               ("GET", "/api/site-diaries/project/*"), ("GET", "/api/projects/{project_id}/*"), ("GET", "/api/projects/reference-candidates"),
               ("GET", "/api/projects/location-review/count"), ("GET", "/api/amc/contracts/{contract_id}"), ("GET", "/api/support/tickets/{ticket_id}"),
               ("*", "/api/support/sla-config"), ("*", "/api/integrations/google-drive/client-secret"), ("*", "/api/audit-logs/archive-config"),
               ("POST", "/api/audit-logs/archives/*"), ("GET", "/api/settings/thresholds"), ("GET", "/api/pricelist/items/{item_id}/history"),
               ("PUT", "/api/amc/interest/{project_id}"), ("GET", "/api/daily-reports/projects"), ("GET", "/api/daily-reports/options"),
               ("GET", "/api/integrations/google-drive"), ("GET", "/api/calculate/*"), ("GET", "/api/approvals/inbox/count"),
               ("GET", "/api/expansion/config"), ("GET", "/api/drive/settings")]:
    rule(m, pat, None)

# pages
rule("GET", "/api/dashboard/ceo", page("module_ceo_dashboard", V))
rule("GET", "/api/dashboard/health/history", page("module_ceo_dashboard", V))
rule("POST", "/api/dashboard/health/snapshot", page("module_ceo_dashboard", V))
rule("POST", "/api/attendance/check-*", page("module_attendance", C))
rule("GET", "/api/attendance/me*", page("module_attendance", V))
rule("PUT", "/api/daily-reports/me", page("module_daily_updates", C))
rule("*", "/api/daily-reports*", page("module_daily_updates"))
rule("PUT", "/api/daily-updates/*", page("module_daily_updates", C))
rule("*", "/api/daily-updates*", page("module_daily_updates"))
rule("PUT", "/api/site-diaries/{project_id}/{day}", page("module_site_diary", C))
rule("*", "/api/site-diaries*", page("module_site_diary"))
rule("POST", "/api/readings/{reading_id}/generation", page("module_readings", E))
rule("*", "/api/readings*", page("module_readings"))
rule("*", "/api/audits*", page("module_audits"))
rule("PUT", "/api/audit-templates", page("module_audits", E))

rule("GET", "/api/projects", page("module_projects", V))
rule("GET", "/api/projects/{project_id}", page("module_projects", V))
rule("POST", "/api/projects", page("module_projects", C))
rule("POST", "/api/site-photos/upload", page("module_projects", C))
rule("PUT", "/api/projects/{project_id}", page("module_projects", E))
rule("POST", "/api/projects/{project_id}/request-deletion", page("module_projects", E))
rule("POST", "/api/projects/{project_id}/adhoc-lines/*", page("module_kits", C))
rule("PUT", "/api/projects/{project_id}/location-fix", page("module_expansion", E))
rule("PUT", "/api/projects/{project_id}/teams", page("module_teams", E))
rule("POST", "/api/projects/{project_id}/*", page("module_projects", E))
rule("PUT", "/api/projects/{project_id}/*", page("module_projects", E))
rule("DELETE", "/api/projects/{project_id}/*", page("module_projects", E))
rule("POST", "/api/payments", page("module_projects", E))

rule("GET", "/api/approvals/inbox*", page("module_approvals", V))
rule("POST", "/api/approvals/inbox/*", page("module_approvals", E))
for pre in ("deletion-requests", "action-requests", "inbound-action-requests"):
    rule("GET", f"/api/{pre}", page("module_approvals", V))
    rule("POST", f"/api/{pre}/*", page("module_approvals", E))
rule("*", "/api/customer-offers*", page("module_customer_offers"))
rule("POST", "/api/sales", page("module_direct_sales", C))
rule("POST", "/api/sales/{sale_id}/payment", page("module_direct_sales", C))
rule("POST", "/api/sales/*", page("module_direct_sales", E))
rule("*", "/api/sales*", page("module_direct_sales"))
rule("POST", "/api/ecommerce/orders/import-preview", page("module_ecommerce", C))
rule("DELETE", "/api/ecommerce/orders/*", page("module_ecommerce", D, grant=False))
rule("DELETE", "/api/ecommerce/platforms/*", page("module_ecommerce", D, grant=False))
rule("*", "/api/ecommerce*", page("module_ecommerce"))
rule("POST", "/api/amc/contracts/{contract_id}/visits", page("module_amc", C))
rule("POST", "/api/amc/contracts/{contract_id}/*", page("module_amc", E))
rule("POST", "/api/amc/outbox/*", page("module_amc", E))
rule("*", "/api/amc*", page("module_amc"))
rule("POST", "/api/support/tickets", page("module_amc", C))
rule("POST", "/api/support/tickets/*", page("module_amc", E))
rule("*", "/api/support*", page("module_amc"))

rule("GET", "/api/inventory/export", page("module_inventory", X))
rule("POST", "/api/inventory/import*", page("module_inventory", C))
rule("*", "/api/inventory*", page("module_inventory"))
rule("*", "/api/material-kits*", page("module_kits"))
rule("*", "/api/kit-categories*", page("module_kits", grant=False))
rule("PUT", "/api/purchase-orders/*", page("module_purchase_inbound", E))
rule("*", "/api/purchase-orders*", page("module_purchase_inbound"))
rule("PUT", "/api/deliveries/*", page("module_delivery_outbound", E))
rule("*", "/api/deliveries*", page("module_delivery_outbound"))
rule("PUT", "/api/returns/*", page("module_returns", E))
rule("*", "/api/returns*", page("module_returns"))
rule("*", "/api/vendors*", page("module_vendors"))
rule("POST", "/api/pricelist/items/*", page("module_pricelist", E))
rule("*", "/api/pricelist*", page("module_pricelist"))
rule("*", "/api/pricing-slabs*", page("module_pricelist"))
rule("*", "/api/catalogue*", page("module_pricelist"))

rule("GET", "/api/org-structure", page("module_org", V))
rule("*", "/api/partners/tags*", page("module_partners", E, grant=False))
rule("POST", "/api/partners/{partner_id}/*", page("module_partners", E))
rule("POST", "/api/partners/assignments/*", page("module_partners", E))
rule("*", "/api/partners*", page("module_partners"))
rule("*", "/api/internal-teams*", page("module_teams"))
rule("GET", "/api/assets/reports/*", page("module_assets", X))
rule("POST", "/api/assets/{asset_id}/documents", page("module_assets", E, grant=False))
rule("DELETE", "/api/assets/{asset_id}/documents/*", page("module_assets", E, grant=False))
rule("PUT", "/api/assets/{asset_id}", page("module_assets", E, grant=False))
rule("POST", "/api/assets/{asset_id}/*", page("module_assets", E))
rule("*", "/api/assets*", page("module_assets"))

rule("POST", "/api/credits/{credit_id}/pay", page("module_credits", E))
rule("PUT", "/api/credits*", page("module_credits", E))
rule("*", "/api/credits*", page("module_credits"))
rule("*", "/api/accounts*", page("module_credits"))
rule("GET", "/api/alerts/dashboard", page("module_alerts", V))
rule("PUT", "/api/settings/thresholds", page("module_alerts", E))
rule("GET", "/api/reports/*", page("module_reports", V))
rule("GET", "/api/subsidy/analytics", page("module_reports", V))
rule("POST", "/api/expansion/simulate", page("module_expansion", V))
rule("PUT", "/api/expansion/config", page("module_expansion", E, grant=False))
rule("*", "/api/expansion*", page("module_expansion"))
rule("GET", "/api/projects/location-review", page("module_expansion", V))
rule("POST", "/api/projects/location-review/auto-resolve", page("module_expansion", E))

rule("POST", "/api/company/upload-logo", page("module_company", E))
rule("*", "/api/company*", page("module_company"))
rule("PUT", "/api/invoice-settings", page("module_company", E))
rule("PUT", "/api/users/{user_id}/locations", page("module_locations", E))
rule("*", "/api/locations*", page("module_locations"))
for m, pat in [("PUT", "/api/calculate/config"), ("*", "/api/calculate/discoms*"), ("POST", "/api/calculate/pincodes*"), ("POST", "/api/calculate/seed-defaults"),
               ("PUT", "/api/drive/settings"), ("*", "/api/integrations/google-drive"), ("POST", "/api/integrations/google-drive/connect"),
               ("POST", "/api/integrations/google-drive/sync"), ("PUT", "/api/dashboard/health/config"), ("POST", "/api/geo/districts")]:
    rule(m, pat, page("module_settings", E if m != "GET" else V))
rule("*", "/api/investors*", page("module_investors"))
rule("*", "/api/terms*", page("module_terms"))
rule("*", "/api/form-tabs*", page("module_form_builder"))
rule("GET", "/api/audit-logs/archives/*", page("module_audit_logs", X))
rule("*", "/api/audit-logs*", page("module_audit_logs"))
RULES = list(_R)


def match(method: str, path: str) -> Optional[Tuple]:
    """The first rule for this route, or None. Returns ("none",) for shared routes."""
    for methods, rx, target in RULES:
        if (methods is None or method in methods) and rx.match(path):
            return target if target is not None else ("none",)
    return None


def decide(perms: Dict[str, Any], method: str, path: str) -> Tuple[Optional[bool], str, bool]:
    """(True = this role may, False = it may not, None = not covered here), a friendly reason,
    and whether a 'yes' may open a route the code would otherwise keep to admins/managers."""
    target = match(method, path)
    if not target or target[0] == "none":
        return None, "", False
    if target[0] == "option":
        key = target[1]
        o = OPTIONS.get(key)
        page_ok = bool((perms.get(o["page"]) or {}).get("view")) if o else True
        ok = bool(perms.get(key)) and page_ok
        return ok, f"Your role isn’t allowed to {o['label'][0].lower() + o['label'][1:] if o else key}. An admin can change this in Settings → Permissions.", True
    _, key, action, grant = target
    action = action or METHOD_ACTION.get(method, V)
    p = PAGES.get(key)
    if p and p["locked"]:
        return False, f"{p['label']} is for admins only.", False
    row = perms.get(key) or {}
    ok = bool(row.get("view")) and bool(row.get(action))
    verb = {V: "open", C: "add to", E: "change", D: "delete from", X: "download from"}[action]
    return ok, f"Your role can’t {verb} {p['label'] if p else key}. An admin can change this in Settings → Permissions.", grant


class PermCache:
    """Tiny time-based cache so every request doesn't read role permissions from the database."""

    def __init__(self, ttl: float = 15.0):
        self.ttl, self._d = ttl, {}

    def get(self, role):
        hit = self._d.get(role)
        return hit[1] if hit and hit[0] > time.monotonic() else None

    def put(self, role, perms):
        self._d[role] = (time.monotonic() + self.ttl, perms)

    def clear(self):
        self._d.clear()


def catalog() -> Dict[str, Any]:
    return {"version": POLICY_VERSION, "actions": list(ACTIONS),
            "sections": [{"id": s["id"], "label": s["label"], "pages": [
                {k: p[k] for k in ("key", "label", "what", "actions", "locked", "always")} | {"options": [{k: o[k] for k in ("key", "label", "what")} for o in p["options"]]}
                for p in s["pages"]]} for s in SECTIONS],
            "recommended": {r: default_permissions(r) for r in ("manager", "staff")}}
