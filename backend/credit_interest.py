"""Iter 54 — implied carrying cost of overdue customer credit (reporting only, never invoiced)."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional

DEFAULT_MONTHLY_PCT = 1.5


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def days_overdue(credit: Dict[str, Any], now: Optional[datetime] = None) -> int:
    due = _parse_date(credit.get("due_date"))
    if not due:
        return 0
    return max(((now or datetime.now(timezone.utc)) - due).days, 0)


def effective_rate(credit: Dict[str, Any], default_pct: float, customer_rates: Dict[str, float]) -> Dict[str, Any]:
    """Record override > customer override > company default. Returns rate + where it came from."""
    if credit.get("interest_rate_override") is not None:
        return {"monthly_pct": float(credit["interest_rate_override"]), "source": "record"}
    key = (credit.get("customer_name") or "").strip().lower()
    if key in customer_rates:
        return {"monthly_pct": float(customer_rates[key]), "source": "customer"}
    return {"monthly_pct": float(default_pct), "source": "default"}


def interest_cost(balance: float, monthly_pct: float, overdue_days: int) -> float:
    """Simple interest, pro-rata on a 30-day month."""
    if balance <= 0 or overdue_days <= 0 or monthly_pct <= 0:
        return 0.0
    return round(balance * (monthly_pct / 100.0) * (overdue_days / 30.0), 2)


def annotate_credit(credit: Dict[str, Any], default_pct: float, customer_rates: Dict[str, float], now: Optional[datetime] = None) -> Dict[str, Any]:
    rate = effective_rate(credit, default_pct, customer_rates)
    od = days_overdue(credit, now) if credit.get("status") != "closed" else 0
    balance = float(credit.get("balance") or 0)
    return {
        "days_overdue": od,
        "effective_monthly_pct": rate["monthly_pct"],
        "rate_source": rate["source"],
        "interest_cost": interest_cost(balance, rate["monthly_pct"], od),
    }


async def load_rate_inputs(db) -> Dict[str, Any]:
    cfg = await db.pricing_config.find_one({"key": "defaults"}) or {}
    default_pct = float(cfg.get("credit_interest_monthly_pct", DEFAULT_MONTHLY_PCT))
    customer_rates = {r["customer_key"]: float(r["monthly_pct"]) async for r in db.customer_credit_rates.find({})}
    return {"default_pct": default_pct, "customer_rates": customer_rates}
