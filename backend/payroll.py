"""Payroll & benefits (Nov 2026): salary, PF / ESI / professional tax / TDS, health insurance, incentives, sales
commission, bonus, salary advances, the monthly payroll run, payslips, and the files for the bank, EPFO and ESIC.

Built-in rules (every rate is editable in Payroll settings, because they change):
* PF: 12% from the employee, 12% from the employer (8.33% to EPS pension, the rest to EPF), on PF wages up to the
  ceiling (₹25,000 from 17 Sep 2026). PF wages use the labour-code definition: basic + DA, but never less than half
  the fixed pay. EDLI (0.5%) and EPF admin (0.5%) are employer costs.
* ESI: 0.75% employee + 3.25% employer on gross pay, for people whose fixed gross is up to ₹21,000. Anyone covered at
  the start of a contribution period (Apr–Sep, Oct–Mar) stays covered until it ends.
* Professional tax: Tamil Nadu half-yearly slabs, taken in September and March (or spread over the months). It is
  also taken in someone's last month.
* TDS: a new-regime estimate (standard deduction, slabs, rebate up to ₹12 lakh with marginal relief, 4% cess),
  spread over the months left in the financial year. HR can override any month or set a fixed amount.

Each month's run goes draft (prepared, checked, edited) → approved → paid. Approved and paid runs don't change,
and their payslips are what staff see under My pay.
"""
from __future__ import annotations

import calendar
import csv
import io
import math
import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

import notify
from calendar_events import occurrences

MONTH_RX = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
IFSC_RX = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
PAN_RX = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
COMPONENTS = (("basic", "Basic"), ("da", "Dearness allowance"), ("hra", "HRA"), ("conveyance", "Conveyance"), ("special", "Special allowance"))
EXTRA_KINDS = {"incentive": "Incentive", "commission": "Sales commission", "bonus": "Bonus", "reimbursement": "Reimbursement",
               "arrears": "Arrears", "other_earning": "Other earning", "deduction": "Other deduction"}
EARNING_KINDS = set(EXTRA_KINDS) - {"deduction"}
NOT_TAXED = {"reimbursement"}
NOT_ESI = {"reimbursement", "bonus"}
POLICY_KINDS = ("group_health", "personal_accident", "term_life", "other")
COVERS = ("self", "self_spouse", "family", "family_parents")
CLAIM_STATUS = ("filed", "approved", "settled", "rejected")
PAY_MODES = ("bank", "cash", "cheque", "upi")
DEFAULT_SETTINGS: Dict[str, Any] = {
    "employer_name": "",
    "pay_days": "calendar",              # calendar (days in the month) | fixed_26 | fixed_30
    "lop_from_attendance": False,        # count unpaid days from attendance (working days with no check-in)
    "paid_leaves_per_month": 1,          # absences a month that aren't cut, when counting from attendance
    "weekly_off": [6],                   # Mon = 0 … Sun = 6
    "pf": {"enabled": True, "employee_rate": 12.0, "employer_rate": 12.0, "eps_rate": 8.33, "wage_ceiling": 25000,
           "cap_at_ceiling": True, "labour_code_wages": True, "edli_rate": 0.5, "admin_rate": 0.5, "establishment_code": ""},
    "esi": {"enabled": True, "employee_rate": 0.75, "employer_rate": 3.25, "wage_limit": 21000, "employer_code": ""},
    "pt": {"enabled": True, "mode": "half_yearly", "months": [9, 3],
           "slabs": [[21000, 0], [30000, 135], [45000, 315], [60000, 690], [75000, 1025], [None, 1250]]},
    "tds": {"enabled": True, "standard_deduction": 75000, "rebate_limit": 1200000, "rebate_max": 60000, "cess": 4,
            "slabs": [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [None, 30]]},
    "people_allowed": [],                # named people (with admins) are the only ones who open payroll, when set
}


# ───────────────────────── small pure helpers ─────────────────────────
def r0(x: Any) -> int:
    """Nearest rupee, halves up (round() would send 0.5 to the even number)."""
    v = float(x or 0)
    return int(math.floor(v + 0.5)) if v >= 0 else -int(math.floor(-v + 0.5))


def up(x: Any) -> int:
    """Next higher rupee (ESIC rounds contributions up)."""
    return int(math.ceil(round(float(x or 0), 6)))


def num(v: Any, lo: float = 0, hi: float = 1e9) -> float:
    try:
        f = float(v or 0)
    except (TypeError, ValueError):
        return lo
    if math.isnan(f):
        return lo
    return round(min(max(f, lo), hi), 2)


def month_ok(m: Optional[str], label: str = "Month") -> str:
    if not m or not MONTH_RX.match(str(m)):
        raise HTTPException(status_code=400, detail=f"{label} must look like 2026-11")
    return str(m)


def month_bounds(m: str) -> Tuple[date, date]:
    y, mo = int(m[:4]), int(m[5:7])
    return date(y, mo, 1), date(y, mo, calendar.monthrange(y, mo)[1])


def add_months(m: str, n: int) -> str:
    y, mo = int(m[:4]), int(m[5:7]) - 1 + n
    return f"{y + mo // 12:04d}-{mo % 12 + 1:02d}"


def fy_start(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    return f"{y if mo >= 4 else y - 1:04d}-04"


def fy_months_left(m: str) -> int:
    """Months from this one to March, both counted (April → 12, March → 1)."""
    mo = int(m[5:7])
    return 16 - mo if mo >= 4 else 4 - mo


def half_start(m: str) -> str:
    """Start of the half-year (and ESI contribution period): April–September or October–March."""
    y, mo = int(m[:4]), int(m[5:7])
    if 4 <= mo <= 9:
        return f"{y:04d}-04"
    return f"{y:04d}-10" if mo >= 10 else f"{y - 1:04d}-10"


def fy_label(m: str) -> str:
    s = int(fy_start(m)[:4])
    return f"{s}-{str(s + 1)[2:]}"


def month_label(m: str) -> str:
    return date(int(m[:4]), int(m[5:7]), 1).strftime("%B %Y")


def mask(v: Optional[str], keep: int = 4) -> Optional[str]:
    v = (v or "").strip()
    if not v:
        return None
    return ("•" * 4) + v[-keep:] if len(v) > keep else v


def structure_total(s: Optional[Dict[str, Any]]) -> float:
    if not s:
        return 0.0
    return round(sum(num(s.get(k)) for k, _ in COMPONENTS) + sum(num(o.get("amount")) for o in (s.get("others") or [])), 2)


def pick_structure(history: List[Dict[str, Any]], month: str) -> Optional[Dict[str, Any]]:
    """The salary in force in `month`: the latest revision that started on or before it."""
    best = None
    for h in history or []:
        if str(h.get("effective_from") or "") <= month and (best is None or str(h["effective_from"]) >= str(best["effective_from"])):
            best = h
    return best


def slab_amount(value: float, slabs: List[List[Any]]) -> float:
    """Slabs are [[up to, amount], …, [None, amount]] in rising order."""
    for upto, amount in slabs or []:
        if upto is None or value <= float(upto):
            return float(amount or 0)
    return 0.0


def slab_rate(total: float, slabs: List[Dict[str, Any]]) -> float:
    """Commission slabs [{from, percent}]: the rate of the highest slab the month's total has reached."""
    rate = 0.0
    for s in sorted(slabs or [], key=lambda x: num(x.get("from"))):
        if total >= num(s.get("from")):
            rate = num(s.get("percent"), 0, 100)
    return rate


def tax_new_regime(taxable: float, t: Dict[str, Any]) -> float:
    """Income tax on taxable income: slabs, 87A rebate up to the limit, marginal relief just above it, cess."""
    tax, lower = 0.0, 0.0
    for upto, rate in t["slabs"]:
        hi = float(upto) if upto is not None else float("inf")
        if taxable > lower:
            tax += (min(taxable, hi) - lower) * float(rate) / 100
        lower = hi
        if taxable <= hi:
            break
    limit = float(t.get("rebate_limit") or 0)
    if taxable <= limit:
        tax = max(0.0, tax - float(t.get("rebate_max") or 0))
    elif limit:
        tax = min(tax, taxable - limit)          # marginal relief: never more tax than the income above the limit
    return round(tax * (1 + float(t.get("cess") or 0) / 100), 2)


def annual_tax(annual_gross: float, t: Dict[str, Any]) -> float:
    return tax_new_regime(max(0.0, annual_gross - float(t.get("standard_deduction") or 0)), t)


def pf_wages(basic_da: float, fixed_gross: float, labour_code: bool) -> float:
    """PF wages: basic + DA. Under the labour codes, allowances above half the pay count back in, so PF wages are
    never less than half the fixed gross."""
    w = basic_da
    if labour_code:
        w = max(w, fixed_gross / 2)
    return round(min(w, fixed_gross), 2)


def pf_split(wage: float, pf: Dict[str, Any], profile: Dict[str, Any]) -> Dict[str, Any]:
    """Employee 12% (on full PF wages if they chose to pay above the ceiling); employer 12% up to the ceiling, unless
    the company pays on full wages for everyone; EPS 8.33% of wages up to the ceiling, out of the employer's 12%."""
    ceiling = float(pf.get("wage_ceiling") or 0) or float("inf")
    capped = min(wage, ceiling)
    cap = bool(pf.get("cap_at_ceiling", True))
    ee_wage = wage if (profile.get("pf_full_wages") or not cap) else capped
    er_wage = capped if cap else wage
    eps_wage = capped if profile.get("eps_member", True) else 0.0
    ee = r0(ee_wage * float(pf["employee_rate"]) / 100)
    er_total = r0(er_wage * float(pf["employer_rate"]) / 100)
    eps = min(r0(eps_wage * float(pf["eps_rate"]) / 100), er_total)
    return {"epf_wage": r0(ee_wage), "eps_wage": r0(eps_wage), "edli_wage": r0(capped), "ee": ee, "eps": eps, "er_epf": er_total - eps,
            "edli": r0(capped * float(pf.get("edli_rate") or 0) / 100), "admin": r0(er_wage * float(pf.get("admin_rate") or 0) / 100)}


def esi_covered(profile: Dict[str, Any], period_start_gross: Optional[float], current_gross: float, esi: Dict[str, Any]) -> bool:
    mode = profile.get("esi_applicable") or "auto"
    if mode in ("yes", "no"):
        return mode == "yes"
    ref = period_start_gross if period_start_gross else current_gross
    return 0 < ref <= float(esi.get("wage_limit") or 0)


def gratuity_estimate(joining: Optional[date], as_of: date, monthly_wage: float, fixed_term: bool = False) -> Dict[str, Any]:
    """15 days' wages (wages ÷ 26 × 15) per year of service; a part-year over six months counts as a year. Payable
    after five years (one year for fixed-term staff under the labour codes). Capped at ₹20 lakh."""
    if not joining or joining > as_of:
        return {"years": 0, "eligible": False, "amount": 0, "service": "—"}
    days = (as_of - joining).days
    full_years, rem = divmod(days, 365)
    years = full_years + (1 if rem > 182 else 0)
    # five years; courts count 4 years + 240 days worked as five
    eligible = days >= 365 if fixed_term else (full_years >= 5 or (full_years == 4 and rem >= 240))
    months = (as_of.year - joining.year) * 12 + as_of.month - joining.month - (1 if as_of.day < joining.day else 0)
    return {"years": years, "eligible": eligible, "amount": min(r0(monthly_wage * 15 / 26 * years), 2_000_000),
            "service": f"{months // 12} yr {months % 12} mo"}


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
         "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n: int) -> str:
    return _ONES[n] if n < 20 else (_TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else ""))


def _three(n: int) -> str:
    h, rest = divmod(n, 100)
    return " ".join(x for x in ((_ONES[h] + " Hundred") if h else "", _two(rest) if rest else "") if x)


def amount_words(n: int) -> str:
    """Indian numbering: 1,23,45,678 → One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight."""
    n = int(abs(n))
    if n == 0:
        return "Zero"
    parts = []
    crore, n = divmod(n, 10_000_000)
    lakh, n = divmod(n, 100_000)
    thousand, n = divmod(n, 1000)
    if crore:
        parts.append(amount_words(crore) + " Crore")
    if lakh:
        parts.append(_two(lakh) + " Lakh")
    if thousand:
        parts.append(_two(thousand) + " Thousand")
    if n:
        parts.append(_three(n))
    return " ".join(parts)


def commission_line(rule: Dict[str, Any], pay_amount: float, project_total: float, taxable_total: float, kw: float) -> Dict[str, float]:
    """What one customer payment is worth toward a salesperson's commission (before slab rates are known)."""
    share = min(pay_amount / project_total, 1.0) if project_total > 0 else 0.0
    if rule.get("base") == "with_gst" or not (project_total > 0 and taxable_total > 0):
        base = pay_amount
    else:
        base = pay_amount * min(taxable_total / project_total, 1.0)
    kw_share = round(kw * share, 3)
    return {"base": round(base, 2), "share": round(share, 4), "kw": kw_share}


def commission_total(rule: Dict[str, Any], lines: List[Dict[str, Any]]) -> Tuple[float, float]:
    """(commission, rate used). percent: base × %; slab: the rate of the slab the month's base total reached, on all
    of it; per_kw: ₹ per kW, for the share of the project the customer has paid this month."""
    mode = rule.get("mode") or "percent"
    if mode == "per_kw":
        total = sum(l["kw"] for l in lines) * num(rule.get("per_kw"))
        return round(total, 2), num(rule.get("per_kw"))
    base = sum(l["base"] for l in lines)
    rate = slab_rate(base, rule.get("slabs") or []) if mode == "slab" else num(rule.get("percent"), 0, 100)
    return round(base * rate / 100, 2), rate


def compute_line(*, month: str, profile: Dict[str, Any], structure: Dict[str, Any], s: Dict[str, Any], days: Dict[str, Any],
                 extras: List[Dict[str, Any]], advances: List[Dict[str, Any]], insurance: List[Dict[str, Any]],
                 prior: Dict[str, float], edits: Dict[str, Any]) -> Dict[str, Any]:
    """One person's pay for the month. Pure: everything it needs comes in as arguments."""
    basis = float(days["basis"])
    lop = num(edits["lop_days"], 0, basis) if edits.get("lop_days") is not None else float(days.get("auto_lop") or 0)
    paid_days = round(max(0.0, basis - lop - float(days.get("offroll_scaled") or 0)), 2)
    ratio = paid_days / basis if basis else 0.0
    earnings: List[Dict[str, Any]] = []
    deductions: List[Dict[str, Any]] = []
    employer: List[Dict[str, Any]] = []
    warnings: List[str] = []
    fixed: Dict[str, int] = {}
    for key, lab in COMPONENTS:
        fixed[key] = r0(num(structure.get(key)) * ratio)
        if fixed[key]:
            earnings.append({"code": key, "label": lab, "amount": fixed[key], "fixed": True})
    for i, o in enumerate(structure.get("others") or []):
        amt = r0(num(o.get("amount")) * ratio)
        if amt:
            earnings.append({"code": f"allowance_{i}", "label": (o.get("name") or "Allowance")[:40], "amount": amt, "fixed": True})
    fixed_gross = sum(e["amount"] for e in earnings)
    extra_ids = []
    for x in extras:
        amt = r0(x.get("amount"))
        if not amt:
            continue
        extra_ids.append(x["id"])
        row = {"code": x["kind"], "label": (x.get("label") or EXTRA_KINDS.get(x["kind"], "Other"))[:60], "amount": amt, "extra_id": x["id"]}
        (deductions if x["kind"] == "deduction" else earnings).append(row)
    for a in edits.get("adjustments") or []:
        amt = r0(a.get("amount"))
        if amt:
            row = {"code": "adjustment", "label": (a.get("label") or "Adjustment")[:60], "amount": abs(amt)}
            (earnings if amt > 0 else deductions).append(row)
    gross = sum(e["amount"] for e in earnings)
    taxable = gross - sum(e["amount"] for e in earnings if e["code"] in NOT_TAXED)
    esi_base = gross - sum(e["amount"] for e in earnings if e["code"] in NOT_ESI)

    stat: Dict[str, Any] = {"pf_wage": 0, "eps_wage": 0, "edli_wage": 0, "esi_wage": 0, "esi_covered": False, "pf_ee": 0, "eps": 0, "pf_er_epf": 0,
                            "esi_ee": 0, "esi_er": 0, "pt": 0, "tds": 0}
    pf = s["pf"]
    if pf.get("enabled") and profile.get("pf_applicable", True) and fixed_gross > 0:
        wage = pf_wages(fixed["basic"] + fixed["da"], fixed_gross, bool(pf.get("labour_code_wages", True)))
        sp = pf_split(wage, pf, profile)
        stat.update(pf_wage=sp["epf_wage"], eps_wage=sp["eps_wage"], edli_wage=sp["edli_wage"], pf_ee=sp["ee"], eps=sp["eps"], pf_er_epf=sp["er_epf"])
        if sp["ee"]:
            deductions.append({"code": "pf", "label": "Provident fund (PF)", "amount": sp["ee"]})
        employer += [r for r in ({"code": "pf_er", "label": "Employer PF (EPF)", "amount": sp["er_epf"]},
                                 {"code": "eps", "label": "Employer pension (EPS)", "amount": sp["eps"]},
                                 {"code": "edli", "label": "EDLI insurance", "amount": sp["edli"]},
                                 {"code": "pf_admin", "label": "EPF admin charges", "amount": sp["admin"]}) if r["amount"]]
        if not profile.get("uan"):
            warnings.append("No UAN yet — add it before filing the PF return")
    esi = s["esi"]
    if esi.get("enabled") and esi_covered(profile, days.get("esi_period_gross"), structure_total(structure), esi) and esi_base > 0:
        ee, er = up(esi_base * float(esi["employee_rate"]) / 100), up(esi_base * float(esi["employer_rate"]) / 100)
        stat.update(esi_wage=r0(esi_base), esi_covered=True, esi_ee=ee, esi_er=er)
        deductions.append({"code": "esi", "label": "ESI", "amount": ee})
        employer.append({"code": "esi_er", "label": "Employer ESI", "amount": er})
        if not profile.get("esi_number"):
            warnings.append("No ESI number yet — add it before filing the ESI return")
    pt = s["pt"]
    if pt.get("enabled") and profile.get("pt_applicable", True) and gross > 0:
        if pt.get("mode") == "monthly":
            stat["pt"] = r0(slab_amount(gross * 6, pt["slabs"]) / 6)
        elif int(month[5:7]) in [int(x) for x in pt.get("months") or []] or days.get("leaving_this_month"):
            stat["pt"] = max(0, r0(slab_amount(float(prior.get("half_gross") or 0) + gross, pt["slabs"]) - float(prior.get("half_pt") or 0)))
        if stat["pt"]:
            deductions.append({"code": "pt", "label": "Professional tax", "amount": stat["pt"]})
    t = s["tds"]
    if edits.get("tds") is not None:
        stat["tds"] = r0(num(edits["tds"]))
    elif not t.get("enabled") or profile.get("tds_mode") == "none":
        stat["tds"] = 0
    elif profile.get("tds_mode") == "fixed":
        stat["tds"] = r0(num(profile.get("tds_fixed")))
    else:
        left = max(int(days.get("fy_months_left") or 1), 1)
        projected = float(prior.get("fy_taxable") or 0) + taxable + structure_total(structure) * (left - 1)
        stat["tds"] = r0(max(0.0, annual_tax(projected, t) - float(prior.get("fy_tds") or 0)) / left)
    if stat["tds"]:
        deductions.append({"code": "tds", "label": "Income tax (TDS)", "amount": stat["tds"]})
    for ins in insurance:
        if r0(ins.get("amount")):
            deductions.append({"code": "insurance", "label": (ins.get("label") or "Health insurance")[:60], "amount": r0(ins["amount"]), "policy_id": ins.get("policy_id")})
    for i, d in enumerate(structure.get("deductions") or []):
        if r0(d.get("amount")):
            deductions.append({"code": f"fixed_deduction_{i}", "label": (d.get("name") or "Deduction")[:40], "amount": r0(d["amount"])})
    # advances come last and never take pay below zero
    room = gross - sum(d["amount"] for d in deductions)
    recoveries = []
    if not edits.get("skip_advances"):
        for a in advances:
            amt = min(r0(a["monthly"]), r0(a["balance"]), max(room, 0))
            if amt > 0:
                recoveries.append({"advance_id": a["id"], "amount": amt})
                deductions.append({"code": "advance", "label": "Salary advance recovery", "amount": amt, "advance_id": a["id"]})
                room -= amt
            elif r0(a["balance"]) > 0:
                warnings.append("Advance recovery skipped — not enough pay this month")
    total_ded = sum(d["amount"] for d in deductions)
    net = gross - total_ded
    if net < 0:
        warnings.append("Deductions are more than the pay — check this person")
    if paid_days < basis and lop:
        warnings.append(f"{lop:g} unpaid day{'s' if lop != 1 else ''} cut")
    emp_total = sum(e["amount"] for e in employer)
    return {"paid_days": paid_days, "basis_days": basis, "lop_days": lop, "earnings": earnings, "deductions": deductions, "employer": employer,
            "gross": gross, "fixed_gross": fixed_gross, "taxable_gross": taxable, "total_deductions": total_ded, "net": net,
            "employer_total": emp_total, "cost": gross + emp_total, **stat, "extra_ids": extra_ids, "advance_recoveries": recoveries,
            "warnings": warnings}


# ───────────────────────── request bodies ─────────────────────────
class NamedAmount(BaseModel):
    name: str = Field(default="", max_length=40)
    amount: float = Field(default=0, ge=0, le=10_000_000)


class StructureIn(BaseModel):
    effective_from: str
    basic: float = Field(default=0, ge=0, le=10_000_000)
    da: float = Field(default=0, ge=0, le=10_000_000)
    hra: float = Field(default=0, ge=0, le=10_000_000)
    conveyance: float = Field(default=0, ge=0, le=10_000_000)
    special: float = Field(default=0, ge=0, le=10_000_000)
    others: List[NamedAmount] = Field(default_factory=list, max_length=12)
    deductions: List[NamedAmount] = Field(default_factory=list, max_length=12)
    note: Optional[str] = Field(default=None, max_length=200)


class ProfileIn(BaseModel):
    on_payroll: Optional[bool] = None
    employment_type: Optional[str] = None        # permanent | probation | contract | fixed_term | trainee | intern
    uan: Optional[str] = None
    pf_member_id: Optional[str] = None
    esi_number: Optional[str] = None
    pan: Optional[str] = None
    date_of_birth: Optional[str] = None
    bank_name: Optional[str] = None
    account_holder: Optional[str] = None
    account_number: Optional[str] = None
    ifsc: Optional[str] = None
    pay_mode: Optional[str] = None
    pf_applicable: Optional[bool] = None
    pf_full_wages: Optional[bool] = None         # PF on the full PF wages, above the ceiling too
    eps_member: Optional[bool] = None
    esi_applicable: Optional[str] = None         # auto | yes | no
    pt_applicable: Optional[bool] = None
    tds_mode: Optional[str] = None               # estimate | fixed | none
    tds_fixed: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    fy_opening_income: Optional[float] = Field(default=None, ge=0, le=1e9)   # paid this financial year before payroll here
    fy_opening_tds: Optional[float] = Field(default=None, ge=0, le=1e8)
    notes: Optional[str] = Field(default=None, max_length=500)


class PreviewIn(BaseModel):
    structure: StructureIn
    profile: Optional[ProfileIn] = None


class ExtraIn(BaseModel):
    user_id: str
    month: str
    kind: str
    amount: float = Field(gt=0, le=10_000_000)
    reason: str = Field(default="", max_length=200)


class BulkBonusIn(BaseModel):
    user_ids: List[str] = Field(default_factory=list, max_length=500)    # empty = everyone on payroll
    department: Optional[str] = None
    month: str
    mode: str = "fixed"                         # fixed | pct_basic | pct_gross
    value: float = Field(gt=0, le=10_000_000)
    reason: str = Field(default="Bonus", max_length=200)
    kind: str = "bonus"                         # bonus | incentive


class AdvanceIn(BaseModel):
    user_id: str
    amount: float = Field(gt=0, le=10_000_000)
    given_on: str
    monthly: float = Field(gt=0, le=10_000_000)
    start_month: str
    reason: str = Field(default="", max_length=200)


class RuleIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    user_ids: List[str] = Field(default_factory=list, max_length=200)   # empty = everyone credited on a project
    mode: str = "percent"                       # percent | slab | per_kw
    percent: float = Field(default=0, ge=0, le=100)
    slabs: List[Dict[str, float]] = Field(default_factory=list, max_length=12)
    per_kw: float = Field(default=0, ge=0, le=1_000_000)
    base: str = "before_gst"                    # before_gst | with_gst
    active: bool = True
    note: Optional[str] = Field(default=None, max_length=200)


class CommissionApproveIn(BaseModel):
    month: str
    user_ids: List[str] = Field(default_factory=list, max_length=500)  # empty = everyone listed
    pay_month: Optional[str] = None


class CreditIn(BaseModel):
    user_id: Optional[str] = None               # None = back to whoever made the project


class LineEditIn(BaseModel):
    lop_days: Optional[float] = Field(default=None, ge=0, le=31)
    clear_lop: bool = False
    tds: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    clear_tds: bool = False
    adjustments: Optional[List[Dict[str, Any]]] = Field(default=None, max_length=10)
    skip_advances: Optional[bool] = None
    hold: Optional[bool] = None
    note: Optional[str] = Field(default=None, max_length=200)


class PaidIn(BaseModel):
    paid_on: str
    mode: str = "bank"
    reference: str = Field(default="", max_length=100)


class PolicyIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    kind: str = "group_health"
    insurer: str = Field(default="", max_length=80)
    policy_number: str = Field(default="", max_length=60)
    sum_insured: float = Field(default=0, ge=0, le=1e9)
    premium: float = Field(default=0, ge=0, le=1e9)
    start_date: str
    end_date: str
    tpa: str = Field(default="", max_length=80)
    helpline: str = Field(default="", max_length=40)
    employee_share_monthly: float = Field(default=0, ge=0, le=1_000_000)
    document: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=500)


class MemberIn(BaseModel):
    user_id: str
    cover: str = "self"
    dependants: List[Dict[str, str]] = Field(default_factory=list, max_length=8)
    member_number: str = Field(default="", max_length=60)
    sum_insured: Optional[float] = Field(default=None, ge=0, le=1e9)
    employee_share_monthly: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    added_on: Optional[str] = None
    removed_on: Optional[str] = None


class ClaimIn(BaseModel):
    user_id: str
    patient: str = Field(default="", max_length=80)
    hospital: str = Field(default="", max_length=120)
    admitted_on: Optional[str] = None
    amount_claimed: float = Field(default=0, ge=0, le=1e9)
    amount_settled: float = Field(default=0, ge=0, le=1e9)
    status: str = "filed"
    notes: Optional[str] = Field(default=None, max_length=300)


def _clean_text(v: Optional[str], n: int = 60, upper: bool = False) -> Optional[str]:
    v = " ".join(str(v or "").split())[:n]
    return (v.upper() if upper else v) or None


def create_router(db, get_current_user, create_audit_log, get_permissions,
                  check_module_permission: Callable[[Dict[str, Any], str, str], Awaitable[bool]]):
    router = APIRouter()

    # ═══════════════ settings & access ═══════════════
    async def settings() -> Dict[str, Any]:
        doc = await db.payroll_settings.find_one({"key": "defaults"}) or {}
        out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_SETTINGS.items()}
        for k, v in doc.items():
            if k in DEFAULT_SETTINGS and v is not None:
                out[k] = {**DEFAULT_SETTINGS[k], **v} if isinstance(DEFAULT_SETTINGS[k], dict) and isinstance(v, dict) else v
        if not out.get("employer_name"):
            co = await db.company_profiles.find_one({"is_active": True}) or await db.company_profiles.find_one({}, sort=[("created_at", 1)]) or {}
            out["employer_name_default"] = co.get("company_name") or "Sensoper Controls & Renewables"
        return out

    async def _pay(request: Request, action: str = "view") -> Dict[str, Any]:
        user = await get_current_user(request)
        if user["role"] == "admin":
            return user
        if not await check_module_permission(user, "module_payroll", action):
            raise HTTPException(status_code=403, detail="Your role can't open payroll. An admin can change this in Settings → Permissions.")
        allowed = (await settings()).get("people_allowed") or []
        if allowed and user["id"] not in allowed:
            raise HTTPException(status_code=403, detail="Payroll is open only to the people named in Payroll settings")
        return user

    async def _approver(request: Request) -> Dict[str, Any]:
        user = await _pay(request, "edit")
        if user["role"] != "admin" and not (await get_permissions(user["role"])).get("can_approve_payroll"):
            raise HTTPException(status_code=403, detail="Approving payroll is for admins (or roles given “Approve payroll and mark it paid”)")
        return user

    async def can_open(user: Dict[str, Any]) -> bool:
        if user["role"] == "admin":
            return True
        if not await check_module_permission(user, "module_payroll", "view"):
            return False
        allowed = (await settings()).get("people_allowed") or []
        return not allowed or user["id"] in allowed

    router.can_open = can_open

    @router.get("/payroll/settings")
    async def get_settings(request: Request):
        await _pay(request)
        return await settings()

    @router.put("/payroll/settings")
    async def put_settings(request: Request):
        user = await get_current_user(request)
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can change payroll settings")
        body = await request.json()
        cur = await settings()
        out: Dict[str, Any] = {}
        out["employer_name"] = _clean_text(body.get("employer_name"), 100) or ""
        out["pay_days"] = body.get("pay_days") if body.get("pay_days") in ("calendar", "fixed_26", "fixed_30") else cur["pay_days"]
        out["lop_from_attendance"] = bool(body.get("lop_from_attendance", cur["lop_from_attendance"]))
        out["paid_leaves_per_month"] = num(body.get("paid_leaves_per_month", cur["paid_leaves_per_month"]), 0, 10)
        out["weekly_off"] = sorted({int(x) for x in (body.get("weekly_off", cur["weekly_off"]) or []) if str(x).isdigit() and 0 <= int(x) <= 6})
        p, e, t, pt = body.get("pf") or {}, body.get("esi") or {}, body.get("tds") or {}, body.get("pt") or {}
        out["pf"] = {"enabled": bool(p.get("enabled", cur["pf"]["enabled"])),
                     **{k: num(p.get(k, cur["pf"][k]), 0, 100) for k in ("employee_rate", "employer_rate", "eps_rate", "edli_rate", "admin_rate")},
                     "wage_ceiling": num(p.get("wage_ceiling", cur["pf"]["wage_ceiling"]), 0, 1_000_000),
                     "cap_at_ceiling": bool(p.get("cap_at_ceiling", cur["pf"]["cap_at_ceiling"])),
                     "labour_code_wages": bool(p.get("labour_code_wages", cur["pf"]["labour_code_wages"])),
                     "establishment_code": _clean_text(p.get("establishment_code", cur["pf"].get("establishment_code")), 40, True) or ""}
        out["esi"] = {"enabled": bool(e.get("enabled", cur["esi"]["enabled"])),
                      "employee_rate": num(e.get("employee_rate", cur["esi"]["employee_rate"]), 0, 100),
                      "employer_rate": num(e.get("employer_rate", cur["esi"]["employer_rate"]), 0, 100),
                      "wage_limit": num(e.get("wage_limit", cur["esi"]["wage_limit"]), 0, 1_000_000),
                      "employer_code": _clean_text(e.get("employer_code", cur["esi"].get("employer_code")), 40, True) or ""}

        def slabs_of(raw, fallback, hi):
            rows = []
            for row in raw or []:
                if not isinstance(row, (list, tuple)) or len(row) != 2:
                    continue
                upto = None if row[0] in (None, "", "null") else num(row[0], 0, 1e10)
                rows.append([upto, num(row[1], 0, hi)])
            rows = sorted([r for r in rows if r[0] is not None], key=lambda r: r[0]) + [r for r in rows if r[0] is None][:1]
            if not rows or rows[-1][0] is not None:
                return fallback
            return rows

        out["pt"] = {"enabled": bool(pt.get("enabled", cur["pt"]["enabled"])), "mode": pt.get("mode") if pt.get("mode") in ("half_yearly", "monthly") else cur["pt"]["mode"],
                     "months": sorted({int(x) for x in (pt.get("months", cur["pt"]["months"]) or []) if str(x).isdigit() and 1 <= int(x) <= 12})[:2] or [9, 3],
                     "slabs": slabs_of(pt.get("slabs"), cur["pt"]["slabs"], 100_000)}
        out["tds"] = {"enabled": bool(t.get("enabled", cur["tds"]["enabled"])),
                      "standard_deduction": num(t.get("standard_deduction", cur["tds"]["standard_deduction"]), 0, 1e7),
                      "rebate_limit": num(t.get("rebate_limit", cur["tds"]["rebate_limit"]), 0, 1e8),
                      "rebate_max": num(t.get("rebate_max", cur["tds"]["rebate_max"]), 0, 1e7),
                      "cess": num(t.get("cess", cur["tds"]["cess"]), 0, 20),
                      "slabs": slabs_of(t.get("slabs"), cur["tds"]["slabs"], 100)}
        ids = [str(x) for x in (body.get("people_allowed", cur["people_allowed"]) or []) if ObjectId.is_valid(str(x))][:50]
        out["people_allowed"] = ids
        await db.payroll_settings.update_one({"key": "defaults"}, {"$set": {**out, "key": "defaults"}}, upsert=True)
        await create_audit_log(user["id"], user["name"], "payroll_settings_updated", "payroll_settings", "defaults", None, {k: v for k, v in out.items() if k != "people_allowed"})
        return await settings()

    # ═══════════════ people & salary ═══════════════
    async def _people(include_left: bool = False) -> Dict[str, Dict[str, Any]]:
        q = {} if include_left else {"active": {"$ne": False}}
        q["role"] = {"$in": ["admin", "manager", "staff"]}
        return {str(u["_id"]): u async for u in db.users.find(q, {"password_hash": 0, "totp_secret": 0, "totp_secret_enc": 0})}

    async def _profiles(ids: Optional[List[str]] = None) -> Dict[str, Dict[str, Any]]:
        q = {"user_id": {"$in": ids}} if ids is not None else {}
        return {p["user_id"]: p async for p in db.payroll_profiles.find(q)}

    async def _user(uid: str) -> Dict[str, Any]:
        u = await db.users.find_one({"_id": ObjectId(uid)}) if uid and ObjectId.is_valid(uid) else None
        if not u:
            raise HTTPException(status_code=404, detail="Person not found")
        return u

    def _date(v: Optional[str], label: str, required: bool = False) -> Optional[date]:
        d = notify.to_date(v)
        if v and not d:
            raise HTTPException(status_code=400, detail=f"{label} must be a date (YYYY-MM-DD)")
        if required and not d:
            raise HTTPException(status_code=400, detail=f"Enter the {label.lower()}")
        return d

    def _left_on(u: Dict[str, Any], exits: Dict[str, Dict[str, Any]]) -> Optional[date]:
        return notify.to_date(u.get("left_on")) or notify.to_date((exits.get(str(u["_id"])) or {}).get("last_working_day"))

    async def _exits() -> Dict[str, Dict[str, Any]]:
        return {e["user_id"]: e async for e in db.hr_exits.find({"status": {"$in": ["serving_notice", "completed"]}})}

    def _estimate(structure: Optional[Dict[str, Any]], profile: Dict[str, Any], s: Dict[str, Any], month: str,
                  insurance: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
        """A normal full month on this salary (no unpaid days, tax averaged over a full year)."""
        if not structure or structure_total(structure) <= 0:
            return None
        sp = dict(s)
        if (sp["pt"] or {}).get("mode") != "monthly":
            sp = {**sp, "pt": {**sp["pt"], "mode": "monthly"}}      # show PT as a monthly average
        line = compute_line(month=month, profile=profile, structure=structure, s=sp, days={"basis": 30, "fy_months_left": 12},
                            extras=[], advances=[], insurance=insurance or [], prior={}, edits={})
        return {k: line[k] for k in ("gross", "net", "total_deductions", "employer_total", "cost", "pf_ee", "esi_ee", "pt", "tds", "earnings", "deductions", "employer", "pf_wage", "esi_covered")}

    def _profile_out(p: Dict[str, Any], full: bool) -> Dict[str, Any]:
        keys = ("on_payroll", "employment_type", "uan", "pf_member_id", "esi_number", "date_of_birth", "bank_name", "account_holder", "ifsc", "pay_mode",
                "pf_applicable", "pf_full_wages", "eps_member", "esi_applicable", "pt_applicable", "tds_mode", "tds_fixed", "notes")
        out = {k: p.get(k) for k in keys}
        out.update(on_payroll=p.get("on_payroll", True), pf_applicable=p.get("pf_applicable", True), eps_member=p.get("eps_member", True),
                   pt_applicable=p.get("pt_applicable", True), esi_applicable=p.get("esi_applicable") or "auto", tds_mode=p.get("tds_mode") or "estimate",
                   pay_mode=p.get("pay_mode") or "bank", employment_type=p.get("employment_type") or "permanent")
        out["account_number"] = p.get("account_number") if full else mask(p.get("account_number"))
        out["account_masked"] = mask(p.get("account_number"))
        out["pan"] = p.get("pan") if full else mask(p.get("pan"), 3)
        op = p.get("fy_opening") or {}
        same = op.get("fy") == fy_label(_this_month())
        out["fy_opening_income"] = op.get("income") if same else None
        out["fy_opening_tds"] = op.get("tds") if same else None
        return out

    async def _insurance_for(uid: str, month: str) -> List[Dict[str, Any]]:
        first, last = month_bounds(month)
        out = []
        async for pol in db.insurance_policies.find({"members.user_id": uid, "start_date": {"$lte": last.isoformat()}, "end_date": {"$gte": first.isoformat()}}):
            for m in pol.get("members") or []:
                if m.get("user_id") != uid or str(m.get("added_on") or "") > last.isoformat() or (m.get("removed_on") and m["removed_on"] < first.isoformat()):
                    continue
                share = m.get("employee_share_monthly")
                share = pol.get("employee_share_monthly") if share is None else share
                if share:
                    out.append({"policy_id": str(pol["_id"]), "label": f"{pol.get('name') or 'Insurance'} (your share)", "amount": share})
        return out

    def _this_month() -> str:
        return notify.today_ist().strftime("%Y-%m")

    @router.get("/payroll/people")
    async def people(request: Request, include_left: bool = False):
        await _pay(request)
        s = await settings()
        month = _this_month()
        pm = await _people(include_left)
        profs = await _profiles(list(pm))
        ins_members = defaultdict(list)
        async for pol in db.insurance_policies.find({"end_date": {"$gte": notify.today_ist().isoformat()}}):
            for m in pol.get("members") or []:
                if not m.get("removed_on"):
                    ins_members[m["user_id"]].append(pol.get("name"))
        adv = defaultdict(float)
        async for a in db.pay_advances.find({"status": "active"}):
            adv[a["user_id"]] += max(0, float(a["amount"]) - float(a.get("recovered") or 0))
        rows = []
        for uid, u in pm.items():
            p = profs.get(uid) or {}
            st = pick_structure(p.get("history") or [], month)
            est = _estimate(st, p, s, month)
            missing = []
            if not st:
                missing.append("salary")
            if st and p.get("pf_applicable", True) and not p.get("uan"):
                missing.append("UAN")
            if st and (p.get("pay_mode") or "bank") == "bank" and not (p.get("account_number") and p.get("ifsc")):
                missing.append("bank")
            rows.append({"id": uid, "name": u.get("name"), "role": u.get("role"), "designation": u.get("designation"), "department": u.get("department"),
                         "employee_code": u.get("employee_code"), "joining_date": u.get("joining_date"), "active": u.get("active") is not False,
                         "on_payroll": p.get("on_payroll", True), "gross": structure_total(st), "net": (est or {}).get("net"), "cost": (est or {}).get("cost"),
                         "pf": bool(est and est["pf_ee"]), "esi": bool(est and est["esi_covered"]), "missing": missing,
                         "insurance": ins_members.get(uid, []), "advance_balance": round(adv.get(uid, 0)), "effective_from": (st or {}).get("effective_from"),
                         "uan": p.get("uan"), "account_masked": mask(p.get("account_number"))})
        rows.sort(key=lambda r: (not r["active"], (r["department"] or "zzz").lower(), (r["name"] or "").lower()))
        return rows

    @router.get("/payroll/people/{user_id}")
    async def person(user_id: str, request: Request):
        await _pay(request)
        u = await _user(user_id)
        s = await settings()
        p = await db.payroll_profiles.find_one({"user_id": user_id}) or {}
        month = _this_month()
        history = sorted(p.get("history") or [], key=lambda h: h["effective_from"], reverse=True)
        st = pick_structure(history, month)
        ins = await _insurance_for(user_id, month)
        est = _estimate(st, p, s, month, ins)
        policies = []
        async for pol in db.insurance_policies.find({"members.user_id": user_id}).sort("end_date", -1):
            m = next((m for m in pol.get("members") or [] if m["user_id"] == user_id), None)
            policies.append({"id": str(pol["_id"]), "name": pol.get("name"), "kind": pol.get("kind"), "insurer": pol.get("insurer"), "end_date": pol.get("end_date"),
                             "member": m, "claims": [c for c in pol.get("claims") or [] if c.get("user_id") == user_id]})
        advances = [{**{k: a.get(k) for k in ("amount", "given_on", "monthly", "start_month", "reason", "status", "recovered", "recoveries")}, "id": str(a["_id"]),
                     "balance": round(float(a["amount"]) - float(a.get("recovered") or 0), 2)} async for a in db.pay_advances.find({"user_id": user_id}).sort("given_on", -1)]
        extras = [_extra_out(x) async for x in db.pay_extras.find({"user_id": user_id}).sort("created_at", -1).limit(40)]
        fy0 = fy_start(month)
        ytd = defaultdict(float)
        slips = []
        async for r in db.payroll_runs.find({"status": {"$in": ["approved", "paid"]}, "lines.user_id": user_id}).sort("month", -1):
            line = next((l for l in r["lines"] if l["user_id"] == user_id), None)
            if not line:
                continue
            slips.append({"month": r["month"], "status": r["status"], "net": line["net"], "gross": line["gross"]})
            if r["month"] >= fy0:
                for k in ("gross", "net", "pf_ee", "esi_ee", "pt", "tds"):
                    ytd[k] += float(line.get(k) or 0)
        wage = pf_wages(num((st or {}).get("basic")) + num((st or {}).get("da")), structure_total(st), True) if st else 0
        grat = gratuity_estimate(notify.to_date(u.get("joining_date")), notify.today_ist(), wage, (p.get("employment_type") == "fixed_term"))
        return {"id": user_id, "name": u.get("name"), "email": u.get("email"), "phone": u.get("phone"), "designation": u.get("designation"),
                "department": u.get("department"), "employee_code": u.get("employee_code"), "joining_date": u.get("joining_date"), "active": u.get("active") is not False,
                "profile": _profile_out(p, True), "structure": st, "history": history, "estimate": est, "insurance": policies, "advances": advances,
                "extras": extras, "payslips": slips[:24], "ytd": {k: round(v) for k, v in ytd.items()}, "fy": fy_label(month), "gratuity": grat}

    @router.put("/payroll/people/{user_id}")
    async def update_profile(user_id: str, body: ProfileIn, request: Request):
        user = await _pay(request, "edit")
        await _user(user_id)
        raw = body.model_dump(exclude_unset=True)
        upd: Dict[str, Any] = {}
        if "fy_opening_income" in raw or "fy_opening_tds" in raw:
            inc, tds = raw.pop("fy_opening_income", None), raw.pop("fy_opening_tds", None)
            upd["fy_opening"] = {"fy": fy_label(_this_month()), "income": num(inc), "tds": num(tds)} if (inc or tds) else None
        for k, v in raw.items():
            if k in ("uan", "pf_member_id", "esi_number", "account_number"):
                v = re.sub(r"[^0-9A-Za-z/]", "", str(v or ""))[:30] or None
                if k == "uan" and v and not re.fullmatch(r"\d{12}", v):
                    raise HTTPException(status_code=400, detail="UAN is 12 digits")
                if k == "esi_number" and v and not re.fullmatch(r"\d{10}", v):
                    raise HTTPException(status_code=400, detail="The ESI (IP) number is 10 digits")
            elif k == "pan":
                v = re.sub(r"\s", "", str(v or "")).upper() or None
                if v and not PAN_RX.match(v):
                    raise HTTPException(status_code=400, detail="PAN looks like ABCDE1234F")
            elif k == "ifsc":
                v = re.sub(r"\s", "", str(v or "")).upper() or None
                if v and not IFSC_RX.match(v):
                    raise HTTPException(status_code=400, detail="IFSC looks like SBIN0001234 (11 characters)")
            elif k in ("bank_name", "account_holder", "notes"):
                v = _clean_text(v, 500 if k == "notes" else 80)
            elif k == "date_of_birth":
                v = _date(v, "Date of birth").isoformat() if v else None
            elif k == "pay_mode" and v not in PAY_MODES:
                raise HTTPException(status_code=400, detail="Pay mode is bank, cash, cheque or upi")
            elif k == "esi_applicable" and v not in ("auto", "yes", "no"):
                raise HTTPException(status_code=400, detail="ESI is auto, yes or no")
            elif k == "tds_mode" and v not in ("estimate", "fixed", "none"):
                raise HTTPException(status_code=400, detail="TDS is estimate, fixed or none")
            elif k == "employment_type" and v not in ("permanent", "probation", "contract", "fixed_term", "trainee", "intern"):
                raise HTTPException(status_code=400, detail="Unknown employment type")
            upd[k] = v
        upd["updated_at"] = notify.now_utc().isoformat()
        upd["updated_by"] = user["name"]
        await db.payroll_profiles.update_one({"user_id": user_id}, {"$set": upd, "$setOnInsert": {"user_id": user_id, "history": []}}, upsert=True)
        # bank and ID numbers stay out of the activity log — only which fields changed
        await create_audit_log(user["id"], user["name"], "payroll_profile_updated", "user", user_id, None, {"fields": sorted(raw)})
        return {"ok": True}

    def _structure_doc(body: StructureIn, user: Dict[str, Any]) -> Dict[str, Any]:
        doc = {"effective_from": month_ok(body.effective_from, "Effective from"), **{k: num(getattr(body, k)) for k, _ in COMPONENTS},
               "others": [{"name": _clean_text(o.name, 40) or "Allowance", "amount": num(o.amount)} for o in body.others if o.amount > 0],
               "deductions": [{"name": _clean_text(o.name, 40) or "Deduction", "amount": num(o.amount)} for o in body.deductions if o.amount > 0],
               "note": _clean_text(body.note, 200), "by": user["name"], "at": notify.now_utc().isoformat()}
        doc["gross"] = structure_total(doc)
        if doc["gross"] <= 0:
            raise HTTPException(status_code=400, detail="Enter the salary (at least the basic)")
        if doc["basic"] <= 0:
            raise HTTPException(status_code=400, detail="Enter the basic pay")
        return doc

    @router.post("/payroll/people/{user_id}/salary")
    async def set_salary(user_id: str, body: StructureIn, request: Request):
        user = await _pay(request, "edit")
        await _user(user_id)
        doc = _structure_doc(body, user)
        p = await db.payroll_profiles.find_one({"user_id": user_id}) or {}
        locked = await db.payroll_runs.find_one({"status": {"$in": ["approved", "paid"]}, "month": {"$gte": doc["effective_from"]}, "lines.user_id": user_id}, {"month": 1})
        if locked:
            raise HTTPException(status_code=400, detail=f"{month_label(locked['month'])} payroll is already approved. Start the change from a later month, or pay the difference as arrears.")
        history = [h for h in (p.get("history") or []) if h.get("effective_from") != doc["effective_from"]] + [doc]
        await db.payroll_profiles.update_one({"user_id": user_id}, {"$set": {"history": history, "updated_at": doc["at"]}, "$setOnInsert": {"user_id": user_id}}, upsert=True)
        await create_audit_log(user["id"], user["name"], "salary_set", "user", user_id, None, {"effective_from": doc["effective_from"], "gross": doc["gross"]})
        return {"ok": True, "structure": doc}

    @router.delete("/payroll/people/{user_id}/salary/{effective_from}")
    async def drop_salary(user_id: str, effective_from: str, request: Request):
        user = await _pay(request, "edit")
        month_ok(effective_from)
        if await db.payroll_runs.find_one({"status": {"$in": ["approved", "paid"]}, "month": {"$gte": effective_from}, "lines.user_id": user_id}, {"_id": 1}):
            raise HTTPException(status_code=400, detail="This salary was already used in an approved payroll")
        res = await db.payroll_profiles.update_one({"user_id": user_id}, {"$pull": {"history": {"effective_from": effective_from}}})
        if not res.modified_count:
            raise HTTPException(status_code=404, detail="Not found")
        await create_audit_log(user["id"], user["name"], "salary_removed", "user", user_id, {"effective_from": effective_from}, None)
        return {"ok": True}

    @router.post("/payroll/preview")
    async def preview(body: PreviewIn, request: Request):
        user = await _pay(request)
        s = await settings()
        doc = {**{k: num(getattr(body.structure, k)) for k, _ in COMPONENTS},
               "others": [o.model_dump() for o in body.structure.others], "deductions": [o.model_dump() for o in body.structure.deductions]}
        prof = (body.profile.model_dump(exclude_none=True) if body.profile else {})
        est = _estimate(doc, prof, s, month_ok(body.structure.effective_from) if body.structure.effective_from else _this_month())
        if not est:
            return {"gross": 0, "net": 0, "earnings": [], "deductions": [], "employer": [], "cost": 0, "annual_ctc": 0}
        return {**est, "annual_ctc": est["cost"] * 12}

    # ═══════════════ extras: incentive, commission, bonus, reimbursement, deductions ═══════════════
    def _extra_out(x: Dict[str, Any]) -> Dict[str, Any]:
        out = {k: x.get(k) for k in ("user_id", "user_name", "month", "kind", "amount", "reason", "status", "source", "created_by", "created_at",
                                     "approved_by", "approved_at", "run_month", "details", "rejected_reason")}
        out["id"] = str(x["_id"])
        out["label"] = x.get("label") or EXTRA_KINDS.get(x.get("kind"), "Other")
        return out

    async def _check_month_open(month: str, uid: Optional[str] = None) -> None:
        r = await db.payroll_runs.find_one({"month": month}, {"status": 1})
        if r and r["status"] != "draft":
            raise HTTPException(status_code=400, detail=f"{month_label(month)} payroll is {r['status']}. Choose a later month.")

    @router.get("/payroll/extras")
    async def list_extras(request: Request, month: Optional[str] = None, status: Optional[str] = None, user_id: Optional[str] = None, kind: Optional[str] = None):
        await _pay(request)
        q: Dict[str, Any] = {}
        if month:
            q["month"] = month_ok(month)
        if status:
            q["status"] = {"$in": status.split(",")}
        if user_id:
            q["user_id"] = user_id
        if kind:
            q["kind"] = {"$in": kind.split(",")}
        return [_extra_out(x) async for x in db.pay_extras.find(q).sort([("month", -1), ("created_at", -1)]).limit(500)]

    @router.post("/payroll/extras")
    async def add_extra(body: ExtraIn, request: Request):
        user = await _pay(request, "create")
        if body.kind not in EXTRA_KINDS:
            raise HTTPException(status_code=400, detail="Unknown kind")
        month = month_ok(body.month)
        await _check_month_open(month)
        u = await _user(body.user_id)
        now = notify.now_utc().isoformat()
        doc = {"user_id": body.user_id, "user_name": u.get("name"), "month": month, "kind": body.kind, "amount": num(body.amount),
               "reason": _clean_text(body.reason, 200) or "", "label": f"{EXTRA_KINDS[body.kind]}" + (f" — {_clean_text(body.reason, 40)}" if body.reason.strip() else ""),
               "status": "pending", "source": "manual", "created_by": user["name"], "created_by_id": user["id"], "created_at": now}
        res = await db.pay_extras.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "pay_extra_added", "pay_extra", str(res.inserted_id), None, {k: doc[k] for k in ("user_name", "month", "kind", "amount")})
        return _extra_out({**doc, "_id": res.inserted_id})

    @router.post("/payroll/extras/bulk")
    async def bulk_extra(body: BulkBonusIn, request: Request):
        user = await _pay(request, "create")
        month = month_ok(body.month)
        await _check_month_open(month)
        if body.kind not in ("bonus", "incentive"):
            raise HTTPException(status_code=400, detail="Bulk is for bonus or incentive")
        if body.mode not in ("fixed", "pct_basic", "pct_gross") or (body.mode != "fixed" and body.value > 1000):
            raise HTTPException(status_code=400, detail="Choose a fixed amount, or a % of basic or gross (up to 1000%)")
        pm = await _people()
        profs = await _profiles(list(pm))
        ids = [i for i in (body.user_ids or list(pm)) if i in pm]
        if body.department:
            ids = [i for i in ids if (pm[i].get("department") or "") == body.department]
        now = notify.now_utc().isoformat()
        made = []
        for uid in ids:
            p = profs.get(uid) or {}
            if p.get("on_payroll", True) is False:
                continue
            st = pick_structure(p.get("history") or [], month)
            if body.mode == "fixed":
                amt = num(body.value)
            elif not st:
                continue
            else:
                amt = r0((num(st.get("basic")) if body.mode == "pct_basic" else structure_total(st)) * body.value / 100)
            if amt <= 0:
                continue
            reason = _clean_text(body.reason, 200) or EXTRA_KINDS[body.kind]
            made.append({"user_id": uid, "user_name": pm[uid].get("name"), "month": month, "kind": body.kind, "amount": amt, "reason": reason,
                         "label": f"{EXTRA_KINDS[body.kind]} — {reason[:40]}", "status": "pending", "source": "bulk", "created_by": user["name"],
                         "created_by_id": user["id"], "created_at": now})
        if made:
            await db.pay_extras.insert_many(made)
        await create_audit_log(user["id"], user["name"], "pay_extra_bulk", "pay_extra", month, None, {"kind": body.kind, "people": len(made), "total": sum(m["amount"] for m in made)})
        return {"added": len(made), "total": sum(m["amount"] for m in made)}

    async def _extra(eid: str) -> Dict[str, Any]:
        x = await db.pay_extras.find_one({"_id": ObjectId(eid)}) if ObjectId.is_valid(eid) else None
        if not x:
            raise HTTPException(status_code=404, detail="Not found")
        return x

    @router.put("/payroll/extras/{extra_id}")
    async def edit_extra(extra_id: str, body: ExtraIn, request: Request):
        user = await _pay(request, "edit")
        x = await _extra(extra_id)
        if x["status"] not in ("pending", "rejected"):
            raise HTTPException(status_code=400, detail="Only entries waiting for approval can be changed")
        month = month_ok(body.month)
        await _check_month_open(month)
        upd = {"month": month, "amount": num(body.amount), "reason": _clean_text(body.reason, 200) or "", "status": "pending",
               "label": f"{EXTRA_KINDS.get(x['kind'])}" + (f" — {_clean_text(body.reason, 40)}" if body.reason.strip() else "")}
        await db.pay_extras.update_one({"_id": x["_id"]}, {"$set": upd})
        await create_audit_log(user["id"], user["name"], "pay_extra_updated", "pay_extra", extra_id, {k: x.get(k) for k in upd}, upd)
        return {"ok": True}

    @router.post("/payroll/extras/{extra_id}/approve")
    async def approve_extra(extra_id: str, request: Request):
        user = await _approver(request)
        x = await _extra(extra_id)
        if x["status"] != "pending":
            raise HTTPException(status_code=400, detail="Already decided")
        await _check_month_open(x["month"])
        await db.pay_extras.update_one({"_id": x["_id"]}, {"$set": {"status": "approved", "approved_by": user["name"], "approved_at": notify.now_utc().isoformat()}})
        await create_audit_log(user["id"], user["name"], "pay_extra_approved", "pay_extra", extra_id, None, {"amount": x["amount"], "kind": x["kind"]})
        return {"ok": True}

    @router.post("/payroll/extras/approve-all")
    async def approve_all(request: Request, month: str):
        user = await _approver(request)
        month = month_ok(month)
        await _check_month_open(month)
        res = await db.pay_extras.update_many({"month": month, "status": "pending"}, {"$set": {"status": "approved", "approved_by": user["name"], "approved_at": notify.now_utc().isoformat()}})
        await create_audit_log(user["id"], user["name"], "pay_extra_approved_all", "pay_extra", month, None, {"count": res.modified_count})
        return {"approved": res.modified_count}

    @router.post("/payroll/extras/{extra_id}/reject")
    async def reject_extra(extra_id: str, request: Request):
        user = await _approver(request)
        x = await _extra(extra_id)
        if x["status"] not in ("pending", "approved"):
            raise HTTPException(status_code=400, detail="This is already in a payroll")
        body = await request.json() if (request.headers.get("content-length") or "0") != "0" else {}
        await db.pay_extras.update_one({"_id": x["_id"]}, {"$set": {"status": "rejected", "rejected_reason": _clean_text((body or {}).get("reason"), 200),
                                                                 "approved_by": user["name"], "approved_at": notify.now_utc().isoformat()}})
        if x.get("source") == "commission":
            await db.commission_links.delete_many({"extra_id": extra_id})     # the payments can be counted again
        await create_audit_log(user["id"], user["name"], "pay_extra_rejected", "pay_extra", extra_id, None, {"amount": x["amount"], "kind": x["kind"]})
        return {"ok": True}

    @router.delete("/payroll/extras/{extra_id}")
    async def delete_extra(extra_id: str, request: Request):
        user = await _pay(request, "delete")
        x = await _extra(extra_id)
        if x["status"] not in ("pending", "rejected"):
            raise HTTPException(status_code=400, detail="Approved entries can't be deleted — reject them instead")
        await db.pay_extras.delete_one({"_id": x["_id"]})
        await db.commission_links.delete_many({"extra_id": extra_id})
        await create_audit_log(user["id"], user["name"], "pay_extra_deleted", "pay_extra", extra_id, {"amount": x["amount"], "kind": x["kind"]}, None)
        return {"ok": True}

    # ═══════════════ salary advances ═══════════════
    def _adv_out(a: Dict[str, Any]) -> Dict[str, Any]:
        out = {k: a.get(k) for k in ("user_id", "user_name", "amount", "given_on", "monthly", "start_month", "reason", "status", "recovered", "recoveries", "created_by")}
        out["id"] = str(a["_id"])
        out["balance"] = round(float(a["amount"]) - float(a.get("recovered") or 0), 2)
        return out

    @router.get("/payroll/advances")
    async def list_advances(request: Request, status: Optional[str] = None):
        await _pay(request)
        q = {"status": status} if status else {}
        return [_adv_out(a) async for a in db.pay_advances.find(q).sort("given_on", -1).limit(300)]

    @router.post("/payroll/advances")
    async def add_advance(body: AdvanceIn, request: Request):
        user = await _pay(request, "create")
        u = await _user(body.user_id)
        given = _date(body.given_on, "Date given", True)
        doc = {"user_id": body.user_id, "user_name": u.get("name"), "amount": num(body.amount), "given_on": given.isoformat(),
               "monthly": min(num(body.monthly), num(body.amount)), "start_month": month_ok(body.start_month, "First recovery month"),
               "reason": _clean_text(body.reason, 200) or "", "status": "active", "recovered": 0, "recoveries": [],
               "created_by": user["name"], "created_at": notify.now_utc().isoformat()}
        res = await db.pay_advances.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "salary_advance_added", "pay_advance", str(res.inserted_id), None, {k: doc[k] for k in ("user_name", "amount", "monthly", "start_month")})
        return _adv_out({**doc, "_id": res.inserted_id})

    @router.put("/payroll/advances/{advance_id}")
    async def edit_advance(advance_id: str, request: Request):
        user = await _pay(request, "edit")
        a = await db.pay_advances.find_one({"_id": ObjectId(advance_id)}) if ObjectId.is_valid(advance_id) else None
        if not a:
            raise HTTPException(status_code=404, detail="Not found")
        body = await request.json()
        upd: Dict[str, Any] = {}
        if "monthly" in body:
            upd["monthly"] = num(body["monthly"], 1, float(a["amount"]))
        if "start_month" in body:
            upd["start_month"] = month_ok(body["start_month"], "First recovery month")
        if body.get("status") in ("active", "closed"):
            upd["status"] = body["status"]
        if "reason" in body:
            upd["reason"] = _clean_text(body.get("reason"), 200) or ""
        await db.pay_advances.update_one({"_id": a["_id"]}, {"$set": upd})
        await create_audit_log(user["id"], user["name"], "salary_advance_updated", "pay_advance", advance_id, {k: a.get(k) for k in upd}, upd)
        return {"ok": True}

    # ═══════════════ sales commission ═══════════════
    def _rule_out(r: Dict[str, Any]) -> Dict[str, Any]:
        out = {k: r.get(k) for k in ("name", "user_ids", "mode", "percent", "slabs", "per_kw", "base", "active", "note")}
        out["id"] = str(r["_id"])
        return out

    def _rule_doc(body: RuleIn) -> Dict[str, Any]:
        if body.mode not in ("percent", "slab", "per_kw"):
            raise HTTPException(status_code=400, detail="Choose percent, slab or per kW")
        if body.base not in ("before_gst", "with_gst"):
            raise HTTPException(status_code=400, detail="Base is before_gst or with_gst")
        slabs = sorted([{"from": num(x.get("from")), "percent": num(x.get("percent"), 0, 100)} for x in body.slabs], key=lambda x: x["from"])
        if body.mode == "slab" and not slabs:
            raise HTTPException(status_code=400, detail="Add at least one slab")
        if body.mode == "percent" and body.percent <= 0:
            raise HTTPException(status_code=400, detail="Enter the commission %")
        if body.mode == "per_kw" and body.per_kw <= 0:
            raise HTTPException(status_code=400, detail="Enter the amount per kW")
        return {"name": body.name.strip(), "user_ids": [u for u in body.user_ids if ObjectId.is_valid(u)], "mode": body.mode, "percent": num(body.percent, 0, 100),
                "slabs": slabs, "per_kw": num(body.per_kw), "base": body.base, "active": body.active, "note": _clean_text(body.note, 200)}

    @router.get("/payroll/commission/rules")
    async def rules(request: Request):
        await _pay(request)
        return [_rule_out(r) async for r in db.commission_rules.find({}).sort("name", 1)]

    @router.post("/payroll/commission/rules")
    async def add_rule(body: RuleIn, request: Request):
        user = await _pay(request, "edit")
        doc = {**_rule_doc(body), "created_by": user["name"], "created_at": notify.now_utc().isoformat()}
        res = await db.commission_rules.insert_one(doc)
        await create_audit_log(user["id"], user["name"], "commission_rule_added", "commission_rule", str(res.inserted_id), None, {k: doc[k] for k in ("name", "mode", "percent", "per_kw")})
        return _rule_out({**doc, "_id": res.inserted_id})

    @router.put("/payroll/commission/rules/{rule_id}")
    async def edit_rule(rule_id: str, body: RuleIn, request: Request):
        user = await _pay(request, "edit")
        r = await db.commission_rules.find_one({"_id": ObjectId(rule_id)}) if ObjectId.is_valid(rule_id) else None
        if not r:
            raise HTTPException(status_code=404, detail="Not found")
        doc = _rule_doc(body)
        await db.commission_rules.update_one({"_id": r["_id"]}, {"$set": doc})
        await create_audit_log(user["id"], user["name"], "commission_rule_updated", "commission_rule", rule_id, {k: r.get(k) for k in doc}, doc)
        return _rule_out({**r, **doc})

    @router.delete("/payroll/commission/rules/{rule_id}")
    async def delete_rule(rule_id: str, request: Request):
        user = await _pay(request, "delete")
        res = await db.commission_rules.delete_one({"_id": ObjectId(rule_id)}) if ObjectId.is_valid(rule_id) else None
        if not res or not res.deleted_count:
            raise HTTPException(status_code=404, detail="Not found")
        await create_audit_log(user["id"], user["name"], "commission_rule_deleted", "commission_rule", rule_id, None, None)
        return {"ok": True}

    def _ist_range(month: str) -> Tuple[str, str]:
        first, last = month_bounds(month)
        start = datetime(first.year, first.month, 1, tzinfo=notify.IST).astimezone(timezone.utc)
        end = datetime(last.year, last.month, last.day, tzinfo=notify.IST).astimezone(timezone.utc) + timedelta(days=1)
        return start.isoformat(), end.isoformat()

    def _f(v: Any) -> float:
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0

    async def commission_for(month: str) -> Dict[str, Any]:
        """Payments received in the month on projects, grouped by the salesperson they're credited to."""
        s0, s1 = _ist_range(month)
        pays = [p async for p in db.payments.find({"created_at": {"$gte": s0, "$lt": s1}}).sort("created_at", 1)]
        done = {l["payment_id"]: l async for l in db.commission_links.find({"payment_id": {"$in": [str(p["_id"]) for p in pays]}})}
        pids = list({p.get("project_id") for p in pays if ObjectId.is_valid(str(p.get("project_id") or ""))})
        projects = {str(p["_id"]): p async for p in db.projects.find({"_id": {"$in": [ObjectId(x) for x in pids]}},
                                                                      {"customer": 1, "reference_number": 1, "created_by": 1, "created_by_name": 1, "sales_owner_id": 1,
                                                                       "cost_estimation.total_cost": 1, "cost_estimation.taxable_total": 1, "cost_estimation.system_size_kw": 1,
                                                                       "custom_fields.proposed_solution.system_size_kw": 1, "status": 1})}
        pm = await _people(include_left=True)
        rules_ = [r async for r in db.commission_rules.find({"active": True})]

        def rule_for(uid: str) -> Optional[Dict[str, Any]]:
            named = [r for r in rules_ if uid in (r.get("user_ids") or [])]
            return (named or [r for r in rules_ if not r.get("user_ids")] or [None])[0]

        people: Dict[str, Dict[str, Any]] = {}
        unassigned, counted = [], []
        for p in pays:
            pr = projects.get(str(p.get("project_id")))
            if not pr:
                continue
            owner = pr.get("sales_owner_id") or pr.get("created_by")
            ce = pr.get("cost_estimation") or {}
            kw = _f(ce.get("system_size_kw")) or _f(((pr.get("custom_fields") or {}).get("proposed_solution") or {}).get("system_size_kw"))
            row = {"payment_id": str(p["_id"]), "project_id": str(pr["_id"]), "customer": ((pr.get("customer") or {}).get("name")) or "Customer",
                   "reference": pr.get("reference_number"), "paid_on": str(p.get("created_at"))[:10], "amount": round(_f(p.get("amount")), 2),
                   "project_total": round(_f(ce.get("total_cost")), 2), "kw_total": kw, "credited_to": owner,
                   "credited_name": (pm.get(owner) or {}).get("name") or pr.get("created_by_name"), "manual_credit": bool(pr.get("sales_owner_id"))}
            if row["payment_id"] in done:
                counted.append({**row, "extra_id": done[row["payment_id"]].get("extra_id")})
                continue
            if not owner or owner not in pm:
                unassigned.append(row)
                continue
            person = people.setdefault(owner, {"user_id": owner, "name": pm[owner].get("name"), "rule": None, "lines": []})
            person["lines"].append(row)
        out = []
        for uid, person in people.items():
            rule = rule_for(uid)
            lines = person["lines"]
            if rule:
                for l in lines:
                    l.update(commission_line(rule, l["amount"], l["project_total"], _f((projects[l["project_id"]].get("cost_estimation") or {}).get("taxable_total")), l["kw_total"]))
                amount, rate = commission_total(rule, lines)
                for l in lines:   # show each payment's part of the total
                    l["commission"] = round(l["kw"] * rate if rule["mode"] == "per_kw" else l["base"] * rate / 100, 2)
            else:
                amount, rate = 0.0, 0.0
            out.append({**person, "rule": _rule_out(rule) if rule else None, "collected": round(sum(l["amount"] for l in lines), 2),
                        "base": round(sum(l.get("base", 0) for l in lines), 2), "kw": round(sum(l.get("kw", 0) for l in lines), 3),
                        "rate": rate, "amount": r0(amount)})
        out.sort(key=lambda x: -x["amount"])
        return {"month": month, "people": out, "unassigned": unassigned, "counted": counted, "rules": len(rules_),
                "total": sum(x["amount"] for x in out)}

    @router.get("/payroll/commission")
    async def commission(request: Request, month: str):
        await _pay(request)
        return await commission_for(month_ok(month))

    @router.post("/payroll/commission/approve")
    async def approve_commission(body: CommissionApproveIn, request: Request):
        user = await _approver(request)
        month = month_ok(body.month)
        pay_month = month_ok(body.pay_month or month, "Pay with")
        await _check_month_open(pay_month)
        data = await commission_for(month)
        now = notify.now_utc().isoformat()
        made, total = 0, 0
        for person in data["people"]:
            if (body.user_ids and person["user_id"] not in body.user_ids) or not person["rule"] or person["amount"] <= 0:
                continue
            rule = person["rule"]
            how = {"percent": f"{rule['percent']:g}%", "slab": f"{person['rate']:g}% (slab)", "per_kw": f"₹{rule['per_kw']:g}/kW"}[rule["mode"]]
            doc = {"user_id": person["user_id"], "user_name": person["name"], "month": pay_month, "kind": "commission", "amount": person["amount"],
                   "reason": f"{month_label(month)} collections · {how}", "label": f"Sales commission — {month_label(month)}", "status": "approved",
                   "source": "commission", "commission_month": month, "approved_by": user["name"], "approved_at": now, "created_by": user["name"],
                   "created_by_id": user["id"], "created_at": now,
                   "details": {"rule": rule["name"], "collected": person["collected"], "base": person["base"], "kw": person["kw"], "rate": person["rate"],
                               "payments": [{k: l.get(k) for k in ("payment_id", "customer", "reference", "paid_on", "amount", "base", "kw", "commission")} for l in person["lines"]]}}
            res = await db.pay_extras.insert_one(doc)
            for l in person["lines"]:
                await db.commission_links.update_one({"payment_id": l["payment_id"]}, {"$setOnInsert": {"payment_id": l["payment_id"], "extra_id": str(res.inserted_id),
                                                                                                         "user_id": person["user_id"], "month": month}}, upsert=True)
            made += 1
            total += person["amount"]
        await create_audit_log(user["id"], user["name"], "commission_approved", "pay_extra", month, None, {"people": made, "total": total, "pay_month": pay_month})
        return {"approved": made, "total": total}

    @router.put("/payroll/commission/credit/{project_id}")
    async def credit(project_id: str, body: CreditIn, request: Request):
        user = await _pay(request, "edit")
        pr = await db.projects.find_one({"_id": ObjectId(project_id)}, {"sales_owner_id": 1, "created_by": 1}) if ObjectId.is_valid(project_id) else None
        if not pr:
            raise HTTPException(status_code=404, detail="Project not found")
        if body.user_id:
            await _user(body.user_id)
        await db.projects.update_one({"_id": pr["_id"]}, {"$set": {"sales_owner_id": body.user_id or None}})
        await create_audit_log(user["id"], user["name"], "sales_credit_changed", "project", project_id, {"sales_owner_id": pr.get("sales_owner_id")}, {"sales_owner_id": body.user_id})
        return {"ok": True}

    # ═══════════════ the monthly run ═══════════════
    async def _holidays(first: date, last: date) -> set:
        out = set()
        async for ev in db.calendar_events.find({"type": "holiday"}):
            fd = notify.to_date(ev.get("date"))
            ld = notify.to_date(ev.get("end_date")) or fd
            if not fd:
                continue
            span = (ld - fd).days
            for d0 in occurrences(ev, first, last):
                for i in range(span + 1):
                    d = d0 + timedelta(days=i)
                    if first <= d <= last:
                        out.add(d.isoformat())
        return out

    async def build_lines(month: str, edits_all: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        s = await settings()
        first, last = month_bounds(month)
        mdays = last.day
        basis = {"calendar": mdays, "fixed_26": 26, "fixed_30": 30}.get(s["pay_days"], mdays)
        pm = await _people(include_left=True)
        exits = await _exits()
        profs = await _profiles(list(pm))
        holidays = await _holidays(first, last)
        ids = list(pm)
        att = defaultdict(float)
        async for a in db.attendance.find({"date": {"$gte": first.isoformat(), "$lte": last.isoformat()}, "user_id": {"$in": ids}}):
            ci, co = ((a.get("check_in") or {}).get("at")), ((a.get("check_out") or {}).get("at"))
            if not ci:
                continue
            short = False
            try:
                if co:
                    short = (datetime.fromisoformat(str(co).replace("Z", "+00:00")) - datetime.fromisoformat(str(ci).replace("Z", "+00:00"))).total_seconds() < 4 * 3600
            except ValueError:
                pass
            att[(a["user_id"], a["date"])] = 0.5 if short else 1.0
        roster = {(r["user_id"], r["date"]): r.get("shift_id") async for r in db.hr_roster.find({"date": {"$gte": first.isoformat(), "$lte": last.isoformat()}, "user_id": {"$in": ids}})}
        working_covers = [c async for c in db.hr_covers.find({"status": {"$ne": "cancelled"}, "reason": {"$in": ["training", "field_work"]},
                                                              "start_date": {"$lte": last.isoformat()}, "end_date": {"$gte": first.isoformat()}})]
        extras = defaultdict(list)
        pending = defaultdict(int)
        async for x in db.pay_extras.find({"month": month, "status": {"$in": ["approved", "in_payroll", "pending"]}}):
            if x["status"] == "pending":
                pending[x["user_id"]] += 1
            else:
                extras[x["user_id"]].append({"id": str(x["_id"]), "kind": x["kind"], "amount": x["amount"], "label": x.get("label")})
        advances = defaultdict(list)
        async for a in db.pay_advances.find({"status": "active", "start_month": {"$lte": month}}):
            bal = float(a["amount"]) - float(a.get("recovered") or 0)
            if bal > 0:
                advances[a["user_id"]].append({"id": str(a["_id"]), "monthly": a["monthly"], "balance": bal})
        # what earlier approved months of this financial year (and half-year) already paid and took
        prior = defaultdict(lambda: {"fy_taxable": 0.0, "fy_tds": 0.0, "half_gross": 0.0, "half_pt": 0.0})
        run_months = defaultdict(set)
        h0 = half_start(month)
        async for r in db.payroll_runs.find({"status": {"$in": ["approved", "paid"]}, "month": {"$gte": fy_start(month), "$lt": month}}):
            for l in r.get("lines") or []:
                run_months[l["user_id"]].add(r["month"])
                pr = prior[l["user_id"]]
                pr["fy_taxable"] += float(l.get("taxable_gross") or 0)
                pr["fy_tds"] += float(l.get("tds") or 0)
                if r["month"] >= h0:
                    pr["half_gross"] += float(l.get("gross") or 0)
                    pr["half_pt"] += float(l.get("pt") or 0)
        lines, missing = [], []
        weekly = set(s.get("weekly_off") or [])
        for uid, u in pm.items():
            p = profs.get(uid) or {}
            if p.get("on_payroll", True) is False:
                continue
            joined = notify.to_date(u.get("joining_date"))
            left = _left_on(u, exits)
            emp_from = max(first, joined) if joined else first
            emp_to = min(last, left) if left else last
            if u.get("active") is False and not left:
                continue
            if emp_from > emp_to:
                continue
            st = pick_structure(p.get("history") or [], month)
            if not st:
                if u.get("active") is not False:
                    missing.append({"user_id": uid, "name": u.get("name")})
                continue
            offroll = (emp_from - first).days + (last - emp_to).days
            working, present = 0, 0.0
            d = emp_from
            while d <= emp_to:
                iso = d.isoformat()
                sid = roster.get((uid, iso))
                off = (sid == "off") or (d.weekday() in weekly and not sid) or iso in holidays
                if not off:
                    working += 1
                    pres = att.get((uid, iso), 0.0)
                    if pres < 1 and any(c["absent_user_id"] == uid and c["start_date"] <= iso <= c["end_date"] for c in working_covers):
                        pres = 1.0
                    present += pres
                d += timedelta(days=1)
            absent = max(0.0, working - present)
            auto_lop = max(0.0, absent - float(s.get("paid_leaves_per_month") or 0)) if s.get("lop_from_attendance") else 0.0
            ps = pick_structure(p.get("history") or [], h0)
            # income earlier this financial year that wasn't paid through payroll here: the opening figures HR entered,
            # or else the salary in force each of those months (TDS taken then counts as nothing)
            pr = prior[uid]
            op = p.get("fy_opening") or {}
            pr["estimated_months"] = 0
            if op.get("fy") == fy_label(month):
                pr["fy_taxable"] += num(op.get("income"))
                pr["fy_tds"] += num(op.get("tds"))
            else:
                m = fy_start(month)
                while m < month:
                    mf, ml = month_bounds(m)
                    sm = pick_structure(p.get("history") or [], m)
                    if m not in run_months[uid] and sm and (not joined or joined <= ml) and (not left or left >= mf):
                        pr["fy_taxable"] += structure_total(sm)
                        pr["estimated_months"] += 1
                    m = add_months(m, 1)
            days = {"basis": basis, "month_days": mdays, "offroll_scaled": round(basis * offroll / mdays, 2), "working_days": working,
                    "present_days": present, "absent_days": absent, "auto_lop": round(auto_lop, 1), "fy_months_left": fy_months_left(month),
                    "leaving_this_month": bool(left and first <= left <= last), "esi_period_gross": structure_total(ps) if ps else None,
                    "employed_from": emp_from.isoformat(), "employed_to": emp_to.isoformat()}
            ed = edits_all.get(uid) or {}
            line = compute_line(month=month, profile=p, structure=st, s=s, days=days, extras=extras.get(uid, []), advances=advances.get(uid, []),
                                insurance=await _insurance_for(uid, month), prior=prior[uid], edits=ed)
            line["tds_estimated_months"] = pr["estimated_months"]
            if pending.get(uid):
                line["warnings"].append(f"{pending[uid]} incentive/bonus entr{'ies' if pending[uid] > 1 else 'y'} still waiting for approval")
            if (p.get("pay_mode") or "bank") == "bank" and not (p.get("account_number") and p.get("ifsc")):
                line["warnings"].append("No bank account — add it, or set the pay mode to cash")
            if days["leaving_this_month"]:
                line["warnings"].append(f"Leaving on {left.strftime('%d %b')} — check the final settlement")
            if joined and first < joined <= last:
                line["warnings"].append(f"Joined on {joined.strftime('%d %b')}")
            lines.append({"user_id": uid, "name": u.get("name"), "employee_code": u.get("employee_code"), "designation": u.get("designation"),
                          "department": u.get("department"), "uan": p.get("uan"), "esi_number": p.get("esi_number"), "pan_masked": mask(p.get("pan"), 3),
                          "pay_mode": p.get("pay_mode") or "bank", "bank_name": p.get("bank_name"), "account_masked": mask(p.get("account_number")),
                          "structure": {k: st.get(k) for k in ("effective_from", "gross", *[c for c, _ in COMPONENTS])},
                          "attendance": {k: days[k] for k in ("working_days", "present_days", "absent_days", "employed_from", "employed_to")},
                          "auto_lop": days["auto_lop"], "edits": ed, "hold": bool(ed.get("hold")), "note": ed.get("note"), **line})
        lines.sort(key=lambda l: ((l.get("department") or "zzz").lower(), (l.get("name") or "").lower()))
        return {"lines": lines, "missing": missing, "basis": basis, "holidays": sorted(holidays)}

    def _totals(lines: List[Dict[str, Any]]) -> Dict[str, Any]:
        t = defaultdict(float)
        for l in lines:
            for k in ("gross", "total_deductions", "net", "employer_total", "cost", "pf_ee", "eps", "pf_er_epf", "esi_ee", "esi_er", "pt", "tds"):
                t[k] += float(l.get(k) or 0)
            if l.get("hold"):
                t["held"] += float(l.get("net") or 0)
        t["to_pay"] = t["net"] - t["held"]
        t["people"] = len(lines)
        t["warnings"] = sum(len(l.get("warnings") or []) for l in lines)
        return {k: round(v) for k, v in t.items()}

    def _run_out(r: Dict[str, Any], full: bool = True) -> Dict[str, Any]:
        out = {k: r.get(k) for k in ("month", "status", "totals", "missing", "basis", "holidays", "created_by", "created_at", "updated_at",
                                     "approved_by", "approved_at", "paid_on", "paid_mode", "paid_reference", "paid_by")}
        out["id"] = str(r["_id"])
        out["label"] = month_label(r["month"])
        if full:
            out["lines"] = r.get("lines") or []
        return out

    async def _run(month: str) -> Dict[str, Any]:
        r = await db.payroll_runs.find_one({"month": month_ok(month)})
        if not r:
            raise HTTPException(status_code=404, detail=f"No payroll for {month_label(month)} yet")
        return r

    async def _recompute(r: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
        built = await build_lines(r["month"], r.get("edits") or {})
        upd = {**built, "totals": _totals(built["lines"]), "updated_at": notify.now_utc().isoformat(), "updated_by": user["name"]}
        await db.payroll_runs.update_one({"_id": r["_id"]}, {"$set": upd})
        return {**r, **upd}

    @router.get("/payroll/runs")
    async def runs(request: Request):
        await _pay(request)
        return [_run_out(r, False) async for r in db.payroll_runs.find({}, {"lines": 0}).sort("month", -1).limit(36)]

    @router.get("/payroll/runs/{month}")
    async def get_run(month: str, request: Request, optional: bool = False):
        await _pay(request)
        if optional and not await db.payroll_runs.find_one({"month": month_ok(month)}, {"_id": 1}):
            return None
        r = await _run(month)
        if r["status"] == "draft":
            r = await _recompute(r, {"name": r.get("updated_by") or "System"})   # drafts always show today's numbers
        return _run_out(r)

    @router.post("/payroll/runs")
    async def create_run(request: Request):
        user = await _pay(request, "create")
        body = await request.json()
        month = month_ok(body.get("month"))
        if await db.payroll_runs.find_one({"month": month}, {"_id": 1}):
            raise HTTPException(status_code=400, detail=f"{month_label(month)} payroll is already there")
        if month > add_months(_this_month(), 1):
            raise HTTPException(status_code=400, detail="That month is too far ahead")
        now = notify.now_utc().isoformat()
        doc = {"month": month, "status": "draft", "edits": {}, "created_by": user["name"], "created_at": now}
        res = await db.payroll_runs.insert_one(doc)
        r = await _recompute({**doc, "_id": res.inserted_id}, user)
        await create_audit_log(user["id"], user["name"], "payroll_prepared", "payroll_run", month, None, r["totals"])
        return _run_out(r)

    @router.put("/payroll/runs/{month}/lines/{user_id}")
    async def edit_line(month: str, user_id: str, body: LineEditIn, request: Request):
        user = await _pay(request, "edit")
        r = await _run(month)
        if r["status"] != "draft":
            raise HTTPException(status_code=400, detail="Reopen the payroll to change it")
        ed = dict((r.get("edits") or {}).get(user_id) or {})
        raw = body.model_dump(exclude_unset=True)
        if raw.get("clear_lop"):
            ed.pop("lop_days", None)
        elif "lop_days" in raw and body.lop_days is not None:
            ed["lop_days"] = num(body.lop_days, 0, 31)
        if raw.get("clear_tds"):
            ed.pop("tds", None)
        elif "tds" in raw and body.tds is not None:
            ed["tds"] = num(body.tds)
        if body.adjustments is not None:
            ed["adjustments"] = [{"label": _clean_text(a.get("label"), 60) or "Adjustment", "amount": num(a.get("amount"), -10_000_000, 10_000_000)}
                                 for a in body.adjustments if num(a.get("amount"), -10_000_000, 10_000_000)]
        for k in ("skip_advances", "hold"):
            if raw.get(k) is not None:
                ed[k] = bool(raw[k])
        if "note" in raw:
            ed["note"] = _clean_text(body.note, 200)
        await db.payroll_runs.update_one({"_id": r["_id"]}, {"$set": {f"edits.{user_id}": ed}})
        r["edits"] = {**(r.get("edits") or {}), user_id: ed}
        r = await _recompute(r, user)
        await create_audit_log(user["id"], user["name"], "payroll_line_edited", "payroll_run", month, None, {"user_id": user_id, **{k: v for k, v in ed.items() if k != "adjustments"},
                                                                                                         "adjustments": len(ed.get("adjustments") or [])})
        return _run_out(r)

    @router.post("/payroll/runs/{month}/recalculate")
    async def recalc(month: str, request: Request):
        user = await _pay(request, "edit")
        r = await _run(month)
        if r["status"] != "draft":
            raise HTTPException(status_code=400, detail="Reopen the payroll to recalculate it")
        return _run_out(await _recompute(r, user))

    @router.delete("/payroll/runs/{month}")
    async def delete_run(month: str, request: Request):
        user = await _approver(request)
        r = await _run(month)
        if r["status"] != "draft":
            raise HTTPException(status_code=400, detail="Only a draft can be deleted — reopen it first")
        await db.payroll_runs.delete_one({"_id": r["_id"]})
        await create_audit_log(user["id"], user["name"], "payroll_deleted", "payroll_run", month, r.get("totals"), None)
        return {"ok": True}

    @router.post("/payroll/runs/{month}/approve")
    async def approve_run(month: str, request: Request):
        user = await _approver(request)
        r = await _run(month)
        if r["status"] != "draft":
            raise HTTPException(status_code=400, detail="Already approved")
        earlier = await db.payroll_runs.find_one({"month": {"$lt": month}, "status": "draft"}, {"month": 1})
        if earlier:
            raise HTTPException(status_code=400, detail=f"Approve {month_label(earlier['month'])} first — tax and PT carry over month to month")
        r = await _recompute(r, user)
        if not r["lines"]:
            raise HTTPException(status_code=400, detail="Nobody to pay — set salaries first")
        now = notify.now_utc().isoformat()
        ids = [ObjectId(i) for l in r["lines"] for i in l.get("extra_ids") or []]
        if ids:
            await db.pay_extras.update_many({"_id": {"$in": ids}}, {"$set": {"status": "in_payroll", "run_month": month}})
        await db.payroll_runs.update_one({"_id": r["_id"]}, {"$set": {"status": "approved", "approved_by": user["name"], "approved_at": now}})
        await create_audit_log(user["id"], user["name"], "payroll_approved", "payroll_run", month, None, r["totals"])
        return _run_out({**r, "status": "approved", "approved_by": user["name"], "approved_at": now})

    @router.post("/payroll/runs/{month}/reopen")
    async def reopen_run(month: str, request: Request):
        user = await _approver(request)
        r = await _run(month)
        if r["status"] != "approved":
            raise HTTPException(status_code=400, detail="Only an approved (not yet paid) payroll can be reopened")
        later = await db.payroll_runs.find_one({"month": {"$gt": month}, "status": {"$in": ["approved", "paid"]}}, {"month": 1})
        if later:
            raise HTTPException(status_code=400, detail=f"{month_label(later['month'])} is approved after this one — reopen that first")
        await db.pay_extras.update_many({"run_month": month, "status": "in_payroll"}, {"$set": {"status": "approved"}, "$unset": {"run_month": ""}})
        await db.payroll_runs.update_one({"_id": r["_id"]}, {"$set": {"status": "draft"}, "$unset": {"approved_by": "", "approved_at": ""}})
        await create_audit_log(user["id"], user["name"], "payroll_reopened", "payroll_run", month, None, None)
        return _run_out(await _recompute({**r, "status": "draft"}, user))

    @router.post("/payroll/runs/{month}/paid")
    async def mark_paid(month: str, body: PaidIn, request: Request):
        user = await _approver(request)
        r = await _run(month)
        if r["status"] != "approved":
            raise HTTPException(status_code=400, detail="Approve the payroll first")
        paid_on = _date(body.paid_on, "Paid on", True).isoformat()
        for l in r["lines"]:
            if l.get("hold"):
                continue
            for rec in l.get("advance_recoveries") or []:
                a = await db.pay_advances.find_one({"_id": ObjectId(rec["advance_id"])})
                if not a or any(x.get("month") == month for x in a.get("recoveries") or []):
                    continue
                recovered = round(float(a.get("recovered") or 0) + rec["amount"], 2)
                await db.pay_advances.update_one({"_id": a["_id"]}, {"$set": {"recovered": recovered, "status": "closed" if recovered >= float(a["amount"]) - 0.5 else "active"},
                                                                      "$push": {"recoveries": {"month": month, "amount": rec["amount"]}}})
        await db.pay_extras.update_many({"run_month": month, "status": "in_payroll"}, {"$set": {"status": "paid", "paid_on": paid_on}})
        upd = {"status": "paid", "paid_on": paid_on, "paid_mode": body.mode if body.mode in PAY_MODES else "bank", "paid_reference": _clean_text(body.reference, 100), "paid_by": user["name"]}
        await db.payroll_runs.update_one({"_id": r["_id"]}, {"$set": upd})
        paid_ids = [l["user_id"] for l in r["lines"] if not l.get("hold")]
        await notify.plan(db, kind="payslip", source_type="payroll_run", source_id=month, user_ids=paid_ids, tag="paid",
                          title=f"Your payslip for {month_label(month)} is ready", message="Open My pay to see or download it.", link="/dashboard/my-pay")
        await create_audit_log(user["id"], user["name"], "payroll_paid", "payroll_run", month, None, {**upd, "to_pay": r["totals"].get("to_pay")})
        return _run_out({**r, **upd})

    # ═══════════════ files: bank, register, PF ECR, ESI, payslip ═══════════════
    def _csv(rows: List[List[Any]], name: str) -> Response:
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        return Response(buf.getvalue().encode("utf-8-sig"), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @router.get("/payroll/runs/{month}/export/{kind}")
    async def export(month: str, kind: str, request: Request):
        user = await _pay(request, "export")
        r = await _run(month)
        lines = r["lines"]
        await create_audit_log(user["id"], user["name"], "payroll_exported", "payroll_run", month, None, {"kind": kind})
        if kind == "bank":
            profs = await _profiles([l["user_id"] for l in lines])
            rows = [["Name", "Account number", "IFSC", "Bank", "Amount", "Narration"]]
            for l in lines:
                p = profs.get(l["user_id"]) or {}
                if l.get("hold") or l["net"] <= 0 or (p.get("pay_mode") or "bank") != "bank":
                    continue
                rows.append([p.get("account_holder") or l["name"], p.get("account_number") or "", p.get("ifsc") or "", p.get("bank_name") or "", l["net"],
                             f"Salary {date(int(month[:4]), int(month[5:]), 1).strftime('%b %Y')}"])
            return _csv(rows, f"salary-bank-{month}.csv")
        if kind == "register":
            e_cols, d_cols = [], []
            for l in lines:
                for e in l["earnings"]:
                    if e["label"] not in e_cols:
                        e_cols.append(e["label"])
                for d in l["deductions"]:
                    if d["label"] not in d_cols:
                        d_cols.append(d["label"])
            rows = [["Employee code", "Name", "Department", "Designation", "Paid days", "Unpaid days", *e_cols, "Gross", *d_cols, "Total deductions", "Net pay",
                     "Employer PF", "Employer EPS", "Employer ESI", "Cost to company", "Pay mode", "On hold"]]
            for l in lines:
                em = defaultdict(int)
                dm = defaultdict(int)
                for e in l["earnings"]:
                    em[e["label"]] += e["amount"]
                for d in l["deductions"]:
                    dm[d["label"]] += d["amount"]
                rows.append([l.get("employee_code") or "", l["name"], l.get("department") or "", l.get("designation") or "", l["paid_days"], l["lop_days"],
                             *[em.get(c, 0) for c in e_cols], l["gross"], *[dm.get(c, 0) for c in d_cols], l["total_deductions"], l["net"],
                             l.get("pf_er_epf", 0), l.get("eps", 0), l.get("esi_er", 0), l["cost"], l.get("pay_mode"), "yes" if l.get("hold") else ""])
            return _csv(rows, f"salary-register-{month}.csv")
        if kind == "pf_ecr":
            out = []
            for l in lines:
                if not l.get("pf_ee"):
                    continue
                out.append("#~#".join(str(x) for x in (l.get("uan") or "", (l["name"] or "").upper(), r0(l["gross"]), r0(l["pf_wage"]), r0(l["eps_wage"]),
                                                       r0(l["edli_wage"]), r0(l["pf_ee"]), r0(l["eps"]), r0(l["pf_er_epf"]), r0(l.get("lop_days") or 0), 0)))
            return Response("\n".join(out).encode(), media_type="text/plain", headers={"Content-Disposition": f'attachment; filename="pf-ecr-{month}.txt"'})
        if kind == "esi":
            rows = [["IP Number", "IP Name", "No of Days for which wages paid/payable during the month", "Total Monthly Wages", "Reason Code for Zero workings days", "Last Working Day"]]
            for l in lines:
                if not l.get("esi_covered"):
                    continue
                rows.append([l.get("esi_number") or "", l["name"], min(int(math.floor(l["paid_days"] + 0.5)), 31), r0(l["esi_wage"]),
                             "" if l["paid_days"] > 0 else "1", l["attendance"]["employed_to"] if l["attendance"]["employed_to"] < month_bounds(month)[1].isoformat() else ""])
            return _csv(rows, f"esi-contribution-{month}.csv")
        raise HTTPException(status_code=404, detail="Unknown file")

    def _payslip_pdf(r: Dict[str, Any], line: Dict[str, Any], employer: str) -> bytes:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                                title=f"Payslip {month_label(r['month'])} - {line['name']}")
        ss = getSampleStyleSheet()
        h = ParagraphStyle("h", parent=ss["Title"], fontSize=15, leading=18, spaceAfter=2, alignment=0)
        small = ParagraphStyle("s", parent=ss["Normal"], fontSize=8.5, leading=11, textColor=colors.HexColor("#475569"))
        body = ParagraphStyle("b", parent=ss["Normal"], fontSize=9.5, leading=12)
        rs = lambda v: f"Rs. {int(v):,}"   # noqa: E731  (Helvetica has no ₹)
        story = [Paragraph(employer, h), Paragraph(f"Payslip for {month_label(r['month'])}", ParagraphStyle("t", parent=body, fontSize=11, textColor=colors.HexColor("#047857"))),
                 Spacer(1, 6)]
        info = [["Name", line["name"], "Employee code", line.get("employee_code") or "—"],
                ["Designation", line.get("designation") or "—", "Department", line.get("department") or "—"],
                ["UAN", line.get("uan") or "—", "ESI number", line.get("esi_number") or "—"],
                ["PAN", line.get("pan_masked") or "—", "Bank account", (line.get("bank_name") or "") + " " + (line.get("account_masked") or "—") if line.get("pay_mode") == "bank" else (line.get("pay_mode") or "").title()],
                ["Paid days", f"{line['paid_days']:g} of {line['basis_days']:g}", "Unpaid days", f"{line['lop_days']:g}"]]
        t = Table(info, colWidths=[28 * mm, 58 * mm, 30 * mm, 62 * mm])
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.5), ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#64748b")),
                               ("TEXTCOLOR", (2, 0), (2, -1), colors.HexColor("#64748b")), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3),
                               ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc"))]))
        story += [t, Spacer(1, 8)]
        er, dr = line["earnings"], line["deductions"]
        n = max(len(er), len(dr))
        rows = [["Earnings", "Amount", "Deductions", "Amount"]]
        for i in range(n):
            e = er[i] if i < len(er) else None
            d = dr[i] if i < len(dr) else None
            rows.append([e["label"] if e else "", rs(e["amount"]) if e else "", d["label"] if d else "", rs(d["amount"]) if d else ""])
        rows.append(["Gross pay", rs(line["gross"]), "Total deductions", rs(line["total_deductions"])])
        t = Table(rows, colWidths=[60 * mm, 29 * mm, 60 * mm, 29 * mm])
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                               ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#ecfdf5")), ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("ALIGN", (3, 0), (3, -1), "RIGHT"),
                               ("LINEABOVE", (0, -1), (-1, -1), 0.6, colors.HexColor("#94a3b8")), ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                               ("LINEAFTER", (1, 0), (1, -1), 0.5, colors.HexColor("#cbd5e1")), ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 4)]))
        story += [t, Spacer(1, 8)]
        net = Table([["Net pay", rs(line["net"])], ["In words", f"Rupees {amount_words(line['net'])} only"]], colWidths=[28 * mm, 150 * mm])
        net.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 12), ("FONTSIZE", (0, 1), (-1, 1), 8.5),
                                 ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0fdf4")), ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#86efac")),
                                 ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 5)]))
        story += [net, Spacer(1, 8)]
        if line.get("employer"):
            story.append(Paragraph("Paid by the company on top of your salary: " + ", ".join(f"{e['label']} {rs(e['amount'])}" for e in line["employer"]) + ".", small))
        paid = notify.to_date(r.get("paid_on"))
        story += [Spacer(1, 4), Paragraph(f"{'Paid on ' + paid.strftime('%d %b %Y').lstrip('0') if paid else 'Approved, not yet paid'} · This is a computer-generated payslip and needs no signature.", small)]
        doc.build(story)
        return buf.getvalue()

    async def _employer() -> str:
        s = await settings()
        return s.get("employer_name") or s.get("employer_name_default") or "Sensoper Controls & Renewables"

    @router.get("/payroll/runs/{month}/payslip/{user_id}")
    async def payslip(month: str, user_id: str, request: Request):
        await _pay(request)
        r = await _run(month)
        line = next((l for l in r["lines"] if l["user_id"] == user_id), None)
        if not line:
            raise HTTPException(status_code=404, detail="Not in this payroll")
        pdf = _payslip_pdf(r, line, await _employer())
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="payslip-{month}-{(line["name"] or "staff").replace(" ", "-")}.pdf"'})

    # ═══════════════ insurance ═══════════════
    def _policy_out(p: Dict[str, Any]) -> Dict[str, Any]:
        out = {k: p.get(k) for k in ("name", "kind", "insurer", "policy_number", "sum_insured", "premium", "start_date", "end_date", "tpa", "helpline",
                                     "employee_share_monthly", "document", "notes", "members", "claims", "created_by")}
        out["id"] = str(p["_id"])
        today = notify.today_ist()
        end = notify.to_date(p.get("end_date"))
        out["days_left"] = (end - today).days if end else None
        out["state"] = "ended" if end and end < today else ("renew_soon" if end and (end - today).days <= 45 else "active")
        out["active_members"] = sum(1 for m in p.get("members") or [] if not m.get("removed_on") or m["removed_on"] >= today.isoformat())
        return out

    async def _policy(pid: str) -> Dict[str, Any]:
        p = await db.insurance_policies.find_one({"_id": ObjectId(pid)}) if ObjectId.is_valid(pid) else None
        if not p:
            raise HTTPException(status_code=404, detail="Policy not found")
        return p

    async def _plan_renewal(p: Dict[str, Any]) -> None:
        pid = str(p["_id"])
        await notify.clear(db, "insurance_renewal", "insurance_policy", pid)
        end = notify.to_date(p.get("end_date"))
        if not end:
            return
        who = await notify.users_who_can(db, get_permissions, "module_payroll", "edit")
        for days_before in (30, 7):
            when = end - timedelta(days=days_before)
            if when >= notify.today_ist():
                await notify.plan(db, kind="insurance_renewal", source_type="insurance_policy", source_id=pid, user_ids=who, tag=f"d{days_before}",
                                  notify_at=notify.morning_of(when), title=f"Renew {p.get('name')}: ends {end.strftime('%d %b %Y')}",
                                  message=f"{p.get('insurer') or 'Insurer'} · {len(p.get('members') or [])} people covered", link="/dashboard/hr?tab=pay&pay=insurance")

    def _policy_doc(body: PolicyIn) -> Dict[str, Any]:
        if body.kind not in POLICY_KINDS:
            raise HTTPException(status_code=400, detail="Unknown policy type")
        s0, s1 = _date(body.start_date, "Start date", True), _date(body.end_date, "End date", True)
        if s1 < s0:
            raise HTTPException(status_code=400, detail="The end date is before the start date")
        return {"name": body.name.strip(), "kind": body.kind, "insurer": _clean_text(body.insurer, 80) or "", "policy_number": _clean_text(body.policy_number, 60) or "",
                "sum_insured": num(body.sum_insured, 0, 1e9), "premium": num(body.premium, 0, 1e9), "start_date": s0.isoformat(), "end_date": s1.isoformat(),
                "tpa": _clean_text(body.tpa, 80) or "", "helpline": _clean_text(body.helpline, 40) or "", "employee_share_monthly": num(body.employee_share_monthly),
                "document": body.document or None, "notes": _clean_text(body.notes, 500)}

    @router.get("/payroll/insurance")
    async def policies(request: Request):
        await _pay(request)
        pm = await _people(include_left=True)
        out = []
        async for p in db.insurance_policies.find({}).sort("end_date", -1):
            o = _policy_out(p)
            for m in o["members"] or []:
                m["name"] = (pm.get(m["user_id"]) or {}).get("name")
            for c in o["claims"] or []:
                c["name"] = (pm.get(c["user_id"]) or {}).get("name")
            out.append(o)
        return out

    @router.post("/payroll/insurance")
    async def add_policy(body: PolicyIn, request: Request):
        user = await _pay(request, "create")
        doc = {**_policy_doc(body), "members": [], "claims": [], "created_by": user["name"], "created_at": notify.now_utc().isoformat()}
        res = await db.insurance_policies.insert_one(doc)
        doc["_id"] = res.inserted_id
        await _plan_renewal(doc)
        await create_audit_log(user["id"], user["name"], "insurance_policy_added", "insurance_policy", str(res.inserted_id), None, {k: doc[k] for k in ("name", "insurer", "end_date")})
        return _policy_out(doc)

    @router.put("/payroll/insurance/{policy_id}")
    async def edit_policy(policy_id: str, body: PolicyIn, request: Request):
        user = await _pay(request, "edit")
        p = await _policy(policy_id)
        doc = _policy_doc(body)
        await db.insurance_policies.update_one({"_id": p["_id"]}, {"$set": doc})
        p.update(doc)
        await _plan_renewal(p)
        await create_audit_log(user["id"], user["name"], "insurance_policy_updated", "insurance_policy", policy_id, None, {k: doc[k] for k in ("name", "end_date", "premium")})
        return _policy_out(p)

    @router.delete("/payroll/insurance/{policy_id}")
    async def delete_policy(policy_id: str, request: Request):
        user = await _pay(request, "delete")
        p = await _policy(policy_id)
        await db.insurance_policies.delete_one({"_id": p["_id"]})
        await notify.clear(db, "insurance_renewal", "insurance_policy", policy_id)
        await create_audit_log(user["id"], user["name"], "insurance_policy_deleted", "insurance_policy", policy_id, {"name": p.get("name")}, None)
        return {"ok": True}

    def _member_doc(body: MemberIn, existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if body.cover not in COVERS:
            raise HTTPException(status_code=400, detail="Unknown cover")
        deps = []
        for d in body.dependants:
            name = _clean_text(d.get("name"), 60)
            if not name:
                continue
            deps.append({"name": name, "relation": _clean_text(d.get("relation"), 20) or "", "dob": (_date(d.get("dob"), "Date of birth").isoformat() if d.get("dob") else None)})
        return {"id": (existing or {}).get("id") or uuid.uuid4().hex[:10], "user_id": body.user_id, "cover": body.cover, "dependants": deps,
                "member_number": _clean_text(body.member_number, 60) or "", "sum_insured": body.sum_insured, "employee_share_monthly": body.employee_share_monthly,
                "added_on": (_date(body.added_on, "Added on").isoformat() if body.added_on else notify.today_ist().isoformat()),
                "removed_on": (_date(body.removed_on, "Removed on").isoformat() if body.removed_on else None)}

    @router.post("/payroll/insurance/{policy_id}/members")
    async def add_member(policy_id: str, body: MemberIn, request: Request):
        user = await _pay(request, "edit")
        p = await _policy(policy_id)
        await _user(body.user_id)
        if any(m["user_id"] == body.user_id and not m.get("removed_on") for m in p.get("members") or []):
            raise HTTPException(status_code=400, detail="Already covered — edit their cover instead")
        m = _member_doc(body)
        await db.insurance_policies.update_one({"_id": p["_id"]}, {"$push": {"members": m}})
        await create_audit_log(user["id"], user["name"], "insurance_member_added", "insurance_policy", policy_id, None, {"user_id": body.user_id, "cover": m["cover"]})
        return m

    @router.put("/payroll/insurance/{policy_id}/members/{member_id}")
    async def edit_member(policy_id: str, member_id: str, body: MemberIn, request: Request):
        user = await _pay(request, "edit")
        p = await _policy(policy_id)
        cur = next((m for m in p.get("members") or [] if m.get("id") == member_id), None)
        if not cur:
            raise HTTPException(status_code=404, detail="Member not found")
        m = _member_doc(body, cur)
        m["user_id"] = cur["user_id"]
        await db.insurance_policies.update_one({"_id": p["_id"], "members.id": member_id}, {"$set": {"members.$": m}})
        await create_audit_log(user["id"], user["name"], "insurance_member_updated", "insurance_policy", policy_id, None, {"user_id": cur["user_id"], "removed_on": m["removed_on"]})
        return m

    @router.post("/payroll/insurance/{policy_id}/claims")
    async def add_claim(policy_id: str, body: ClaimIn, request: Request):
        user = await _pay(request, "edit")
        p = await _policy(policy_id)
        if body.status not in CLAIM_STATUS:
            raise HTTPException(status_code=400, detail="Unknown claim status")
        c = {"id": uuid.uuid4().hex[:10], "user_id": body.user_id, "patient": _clean_text(body.patient, 80) or "", "hospital": _clean_text(body.hospital, 120) or "",
             "admitted_on": _date(body.admitted_on, "Admitted on").isoformat() if body.admitted_on else None, "amount_claimed": num(body.amount_claimed),
             "amount_settled": num(body.amount_settled), "status": body.status, "notes": _clean_text(body.notes, 300), "added_by": user["name"],
             "added_at": notify.now_utc().isoformat()}
        await db.insurance_policies.update_one({"_id": p["_id"]}, {"$push": {"claims": c}})
        await create_audit_log(user["id"], user["name"], "insurance_claim_added", "insurance_policy", policy_id, None, {"user_id": body.user_id, "amount": c["amount_claimed"]})
        return c

    @router.put("/payroll/insurance/{policy_id}/claims/{claim_id}")
    async def edit_claim(policy_id: str, claim_id: str, body: ClaimIn, request: Request):
        user = await _pay(request, "edit")
        p = await _policy(policy_id)
        cur = next((c for c in p.get("claims") or [] if c.get("id") == claim_id), None)
        if not cur:
            raise HTTPException(status_code=404, detail="Claim not found")
        if body.status not in CLAIM_STATUS:
            raise HTTPException(status_code=400, detail="Unknown claim status")
        c = {**cur, "patient": _clean_text(body.patient, 80) or "", "hospital": _clean_text(body.hospital, 120) or "",
             "admitted_on": _date(body.admitted_on, "Admitted on").isoformat() if body.admitted_on else None, "amount_claimed": num(body.amount_claimed),
             "amount_settled": num(body.amount_settled), "status": body.status, "notes": _clean_text(body.notes, 300)}
        await db.insurance_policies.update_one({"_id": p["_id"], "claims.id": claim_id}, {"$set": {"claims.$": c}})
        await create_audit_log(user["id"], user["name"], "insurance_claim_updated", "insurance_policy", policy_id, None, {"claim": claim_id, "status": c["status"]})
        return c

    # ═══════════════ overview ═══════════════
    @router.get("/payroll/overview")
    async def overview(request: Request):
        await _pay(request)
        month = _this_month()
        runs_ = [r async for r in db.payroll_runs.find({}, {"lines": 0}).sort("month", -1).limit(12)]
        people_rows = await people(request)
        on = [p for p in people_rows if p["active"] and p["on_payroll"]]
        pending = await db.pay_extras.count_documents({"status": "pending"})
        today = notify.today_ist()
        soon = [_policy_out(p) async for p in db.insurance_policies.find({"end_date": {"$gte": today.isoformat(), "$lte": (today + timedelta(days=45)).isoformat()}})]
        adv = [a async for a in db.pay_advances.find({"status": "active"})]
        return {"month": month, "month_label": month_label(month), "this_month": next((_run_out(r, False) for r in runs_ if r["month"] == month), None),
                "trend": [{"month": r["month"], "label": date(int(r["month"][:4]), int(r["month"][5:]), 1).strftime("%b %y"), "status": r["status"],
                           "net": (r.get("totals") or {}).get("net", 0), "deductions": (r.get("totals") or {}).get("total_deductions", 0),
                           "employer": (r.get("totals") or {}).get("employer_total", 0)} for r in reversed(runs_[:6])],
                "people": len(on), "with_salary": sum(1 for p in on if p["gross"] > 0), "monthly_gross": round(sum(p["gross"] for p in on)),
                "monthly_cost": round(sum(p["cost"] or 0 for p in on)), "missing_uan": sum(1 for p in on if "UAN" in p["missing"]),
                "missing_bank": sum(1 for p in on if "bank" in p["missing"]), "no_salary": [p["name"] for p in on if "salary" in p["missing"]],
                "pending_extras": pending, "renewals": [{k: x[k] for k in ("id", "name", "end_date", "days_left")} for x in soon],
                "advances": {"count": len(adv), "balance": round(sum(float(a["amount"]) - float(a.get("recovered") or 0) for a in adv))}}

    # ═══════════════ my pay (everyone, their own) ═══════════════
    @router.get("/payroll/me")
    async def me(request: Request):
        user = await get_current_user(request)
        uid = user["id"]
        s = await settings()
        p = await db.payroll_profiles.find_one({"user_id": uid}) or {}
        month = _this_month()
        st = pick_structure(p.get("history") or [], month)
        slips = []
        async for r in db.payroll_runs.find({"status": {"$in": ["approved", "paid"]}, "lines.user_id": uid}).sort("month", -1).limit(24):
            l = next((x for x in r["lines"] if x["user_id"] == uid), None)
            if l and not l.get("hold"):
                slips.append({"month": r["month"], "label": month_label(r["month"]), "status": r["status"], "paid_on": r.get("paid_on"), "gross": l["gross"],
                              "net": l["net"], "deductions": l["total_deductions"], "pf": l.get("pf_ee", 0), "tds": l.get("tds", 0)})
        extras = [{k: v for k, v in _extra_out(x).items() if k not in ("created_by", "approved_by")} async for x in db.pay_extras.find({"user_id": uid}).sort("created_at", -1).limit(30)]
        advances = [_adv_out(a) async for a in db.pay_advances.find({"user_id": uid}).sort("given_on", -1).limit(10)]
        cover = []
        async for pol in db.insurance_policies.find({"members.user_id": uid, "end_date": {"$gte": notify.today_ist().isoformat()}}):
            m = next((m for m in pol.get("members") or [] if m["user_id"] == uid and not m.get("removed_on")), None)
            if m:
                cover.append({"name": pol.get("name"), "kind": pol.get("kind"), "insurer": pol.get("insurer"), "policy_number": pol.get("policy_number"),
                              "tpa": pol.get("tpa"), "helpline": pol.get("helpline"), "start_date": pol.get("start_date"), "end_date": pol.get("end_date"),
                              "sum_insured": m.get("sum_insured") or pol.get("sum_insured"), "cover": m.get("cover"), "member_number": m.get("member_number"),
                              "dependants": m.get("dependants") or [], "document": pol.get("document"),
                              "claims": [c for c in pol.get("claims") or [] if c.get("user_id") == uid]})
        fy0 = fy_start(month)
        ytd = {k: round(sum(sl[k] for sl in slips if sl["month"] >= fy0)) for k in ("gross", "net", "pf", "tds")}
        est = _estimate(st, p, s, month, await _insurance_for(uid, month))
        prof = _profile_out(p, False)
        return {"name": user.get("name"), "fy": fy_label(month), "has_salary": bool(st), "estimate": est, "payslips": slips, "extras": extras, "advances": advances,
                "insurance": cover, "ytd": ytd, "ids": {k: prof.get(k) for k in ("uan", "pf_member_id", "esi_number", "pan", "bank_name", "account_masked", "pay_mode")}}

    @router.get("/payroll/me/payslip/{month}")
    async def my_payslip(month: str, request: Request):
        user = await get_current_user(request)
        r = await db.payroll_runs.find_one({"month": month_ok(month), "status": {"$in": ["approved", "paid"]}})
        line = next((l for l in (r or {}).get("lines") or [] if l["user_id"] == user["id"] and not l.get("hold")), None)
        if not r or not line:
            raise HTTPException(status_code=404, detail="No payslip for that month")
        pdf = _payslip_pdf(r, line, await _employer())
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="payslip-{month}.pdf"'})

    async def ensure_indexes() -> None:
        await db.payroll_profiles.create_index("user_id", unique=True)
        await db.payroll_runs.create_index("month", unique=True)
        await db.pay_extras.create_index([("month", 1), ("status", 1)])
        await db.pay_extras.create_index("user_id")
        await db.pay_advances.create_index([("user_id", 1), ("status", 1)])
        await db.commission_links.create_index("payment_id", unique=True)
        await db.insurance_policies.create_index("members.user_id")

    router.ensure_indexes = ensure_indexes
    return router
