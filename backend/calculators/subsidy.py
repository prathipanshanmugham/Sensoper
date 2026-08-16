"""Subsidy calculators — PM Surya Ghar (rooftop) + PM-KUSUM (pump)."""
from __future__ import annotations
from typing import Dict, Optional
from .base import num


def pm_surya_ghar_subsidy(system_size_kw: float, category: str = "Domestic",
                          system_type: str = "on-grid", config: Optional[Dict] = None) -> Dict:
    """PM Surya Ghar Muft Bijli Yojana — Feb 2026 schedule.

    Residential on-grid only; cap ₹78,000. Config can override slabs & cap.
    """
    kw = max(0, num(system_size_kw))
    if system_type != "on-grid" or category != "Domestic" or kw <= 0:
        return {"amount": 0, "eligible": False, "reason": "Not eligible (only residential on-grid)"}

    cfg = (config or {}).get("pm_surya_ghar", {}) or {}
    cap = num(cfg.get("cap", 78000), 78000)

    # Default slabs: ₹30k for first kW, ₹18k for 2nd kW, ₹6k for 3rd kW, capped at 3 kW
    slabs = cfg.get("slabs") or [
        {"upto_kw": 1, "amount": 30000},
        {"upto_kw": 2, "amount": 48000},
        {"upto_kw": 3, "amount": 78000},
    ]
    slabs = sorted(slabs, key=lambda s: num(s.get("upto_kw", 0)))

    amount = 0
    for s in slabs:
        if kw >= num(s["upto_kw"]):
            amount = num(s["amount"])
        else:
            # Partial slab — interpolate linearly for partial kW is not how PM Surya Ghar works
            # (it's an actual-kW schedule), so we take the previous fully-achieved band
            break
    amount = min(amount, cap)
    return {"amount": round(amount), "eligible": True, "cap": cap}


def pm_kusum_subsidy(pump_kw: float, component: str = "B",
                     central_share_pct: float = 30, state_share_pct: float = 30,
                     farmer_share_pct: float = 40, config: Optional[Dict] = None) -> Dict:
    """PM-KUSUM component B (standalone off-grid solar pump) or C (grid-connected).

    Standard funding pattern: 30% central + 30% state + 40% farmer (adjustable).
    Config may override with region-specific splits. Amount is calculated on the
    benchmark cost per kW published by MNRE.
    """
    kw = max(0, num(pump_kw))
    if kw <= 0:
        return {"amount": 0, "eligible": False, "reason": "Invalid pump size"}

    cfg = (config or {}).get("pm_kusum", {}) or {}
    # MNRE benchmark ~ ₹40k / kW for solar pumps
    per_kw = num(cfg.get("benchmark_per_kw", 40000), 40000)

    total_benchmark = kw * per_kw
    central = total_benchmark * num(central_share_pct, 30) / 100
    state = total_benchmark * num(state_share_pct, 30) / 100
    farmer = total_benchmark * num(farmer_share_pct, 40) / 100

    return {
        "amount": round(central + state),
        "eligible": True,
        "component": component,
        "benchmark_cost": round(total_benchmark),
        "central_share": round(central),
        "state_share": round(state),
        "farmer_share": round(farmer),
    }
