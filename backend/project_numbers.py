"""One definition of a project's money numbers, so every screen and report agrees.

  value   = cost_estimation.total_cost      — what the customer pays (incl. GST, after subsidy, cash-rounded)
  margin  = cost_estimation.margin_total    — our margin: add-ons + other charges + the calculator's own lines
  taxable = cost_estimation.taxable_total   — the price before GST (system + add-ons at selling price + charges)

Older projects were saved before `margin_total` / `taxable_total` existed (several screens read a key that was never
written, so margin showed as 0). `fill_missing()` works them out from what is stored; a one-time start-up pass
writes them back."""
from __future__ import annotations

from typing import Any, Dict


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def system_margin(ce: Dict[str, Any]) -> float:
    """Margin inside the calculator's lines (panels, inverter, battery at selling price; structure/cabling/installation
    carry their cost). Market-rate (benchmark) lines have no known margin."""
    lines = ce.get("system_lines") or {}
    total = 0.0
    for key, ln in lines.items():
        if not isinstance(ln, dict) or key == "bos" or ln.get("benchmark") or ln.get("excluded"):
            continue
        amt = _f(ln.get("amount"))
        if "cost" in ln and ln.get("cost") is not None:          # service lines
            total += max(amt - _f(ln.get("cost")), 0)
        elif ln.get("margin_pct") not in (None, ""):
            m = _f(ln.get("margin_pct"))
            total += amt - amt / (1 + m / 100) if m > -100 else 0
    return round(min(total, _f(ce.get("system_cost")) or total), 2)


def fill_missing(ce: Dict[str, Any]) -> Dict[str, Any]:
    """Add margin_total / taxable_total / system_margin to a stored cost estimation that lacks them."""
    ce = dict(ce or {})
    if "system_margin" not in ce:
        ce["system_margin"] = system_margin(ce)
    if "margin_total" not in ce:
        ce["margin_total"] = round(_f(ce.get("total_margin")) + _f(ce.get("system_margin")), 2)
    if "taxable_total" not in ce:
        gross = ce.get("gross_total")
        ce["taxable_total"] = round(_f(gross) - _f(ce.get("total_gst")), 2) if gross is not None else round(_f(ce.get("subtotal")) + _f(ce.get("total_margin")), 2)
    return ce


def project_value(p: Dict[str, Any]) -> float:
    return _f((p.get("cost_estimation") or {}).get("total_cost"))


def project_margin(p: Dict[str, Any]) -> float:
    ce = p.get("cost_estimation") or {}
    return _f(ce["margin_total"]) if "margin_total" in ce else fill_missing(ce)["margin_total"]


def project_gst(p: Dict[str, Any]) -> float:
    return _f((p.get("cost_estimation") or {}).get("total_gst"))
