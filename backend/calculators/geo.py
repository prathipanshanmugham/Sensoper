"""PIN-code lookup + geo helpers. DB-backed; falls back to state-level defaults."""
from __future__ import annotations
from typing import Dict, Optional


# In-memory state fallback (used when pincodes collection has no record).
# Values are cautious district-level averages for specific yield (kWh/kWp/day).
STATE_FALLBACK = {
    "Tamil Nadu":       {"discom": "TANGEDCO", "yield": 4.4, "region_cost_factor": 1.0},
    "Kerala":           {"discom": "KSEB",     "yield": 4.1, "region_cost_factor": 1.05},
    "Karnataka":        {"discom": "BESCOM",   "yield": 4.6, "region_cost_factor": 1.0},
    "Andhra Pradesh":   {"discom": "APEPDCL",  "yield": 4.6, "region_cost_factor": 1.0},
    "Telangana":        {"discom": "TSSPDCL",  "yield": 4.7, "region_cost_factor": 1.0},
    "Maharashtra":      {"discom": "MSEDCL",   "yield": 4.5, "region_cost_factor": 1.05},
    "Gujarat":          {"discom": "MGVCL",    "yield": 4.9, "region_cost_factor": 1.05},
    "Rajasthan":        {"discom": "JVVNL",    "yield": 5.2, "region_cost_factor": 1.05},
    "Delhi":            {"discom": "BSES",     "yield": 4.5, "region_cost_factor": 1.10},
}


def lookup_pincode(pincode: str, pincodes_map: Dict[str, Dict] = None,
                    discoms_by_code: Dict[str, Dict] = None) -> Dict:
    """Given a PIN and pre-fetched pincode/DISCOM lookups, return enrichment info.

    Never raises — returns {'resolved': False, ...} with best-effort fallback.
    """
    pincodes_map = pincodes_map or {}
    discoms_by_code = discoms_by_code or {}
    pin = (pincode or "").strip()
    if len(pin) != 6 or not pin.isdigit():
        return {"resolved": False, "reason": "Invalid PIN (must be 6 digits)", "pincode": pin}

    rec = pincodes_map.get(pin)
    if rec:
        discom_code = rec.get("discom") or rec.get("discom_id")
        discom = discoms_by_code.get(discom_code) if discom_code else None
        return {
            "resolved": True,
            "pincode": pin,
            "district": rec.get("district"),
            "state": rec.get("state"),
            "discom_id": discom_code,
            "discom_name": (discom or {}).get("name"),
            "specific_yield_kwh_per_kwp_day": rec.get("specific_yield_kwh_per_kwp_day", 4.5),
            "peak_sun_hours": rec.get("peak_sun_hours", rec.get("specific_yield_kwh_per_kwp_day", 4.5) / 0.75),
            "region_cost_factor": rec.get("region_cost_factor", 1.0),
            "latitude": rec.get("latitude"),
            "longitude": rec.get("longitude"),
            "is_estimate": False,
            "categories": (discom or {}).get("categories", []),
        }

    # Fallback: use PIN's leading digit → state hint is unreliable; user must confirm.
    # We return an "estimated" flag and default categories from a national FALLBACK DISCOM.
    fb_discom = discoms_by_code.get("FALLBACK")
    return {
        "resolved": False,
        "pincode": pin,
        "is_estimate": True,
        "reason": "PIN not in database — verify tariff",
        "specific_yield_kwh_per_kwp_day": 4.5,
        "peak_sun_hours": 6.0,
        "region_cost_factor": 1.0,
        "discom_id": "FALLBACK" if fb_discom else None,
        "discom_name": (fb_discom or {}).get("name"),
        "categories": (fb_discom or {}).get("categories", []),
    }
