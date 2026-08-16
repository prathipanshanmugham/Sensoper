"""Shared helpers + dispatcher for solar calculators."""
from __future__ import annotations
from typing import Any, Dict, Optional


def ROUND(x: float, digits: int = 2) -> float:
    """Safe rounding that tolerates None."""
    if x is None or x == "":
        return 0
    try:
        return round(float(x), digits)
    except (ValueError, TypeError):
        return 0


def num(x: Any, default: float = 0.0) -> float:
    """Coerce str/None/'' to float. Returns default on failure."""
    if x is None or x == "":
        return default
    try:
        return float(x)
    except (ValueError, TypeError):
        return default


def apply_overrides(computed: Dict[str, Any], overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Overrides win — any field explicitly set by user is preserved as-is."""
    if not overrides:
        return computed
    out = dict(computed)
    for k, v in overrides.items():
        if v is None or v == "":
            continue
        out[k] = v
    return out


def calculate_solution(
    system_type: str,
    pincode: Optional[str],
    inputs: Dict[str, Any],
    overrides: Optional[Dict[str, Any]] = None,
    config: Optional[Dict[str, Any]] = None,
    discom: Optional[Dict[str, Any]] = None,
    pin: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Dispatch to the right calculator module and return {result, breakdown}."""
    system_type = (system_type or "on-grid").lower()
    config = config or {}
    inputs = inputs or {}
    overrides = overrides or {}

    if system_type == "on-grid":
        from .ongrid import compute as _c
    elif system_type == "off-grid":
        from .offgrid import compute as _c
    elif system_type == "hybrid":
        from .hybrid import compute as _c
    elif system_type in ("solar-pump", "pump-dc", "pump-ac"):
        from .pump import compute as _c
    else:
        from .ongrid import compute as _c

    result = _c(inputs=inputs, overrides=overrides, config=config, discom=discom, pin=pin)
    result["result"]["system_type"] = system_type
    return result
