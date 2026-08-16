"""
Sensoper Solar Calculator package.

Server-side calculation engine for solar solutions (on-grid / off-grid /
hybrid / solar-pump AC + DC).  Every constant used lives in DB collections
(`calc_config`, `discoms`, `pincodes`) so quotes are reproducible and
tariffs can change without a redeploy.

Public entry points:
    - calculate_solution(system_type, pincode, inputs, overrides, config, discom, pin)
    - lookup_pincode(pincode) → { pincode, district, state, discom_id, yield, ... }
"""
from .base import calculate_solution, ROUND
from .geo import lookup_pincode
from .tariffs import compute_bill_from_slabs, compute_bill_savings, back_solve_units
from .subsidy import pm_surya_ghar_subsidy, pm_kusum_subsidy

__all__ = [
    "calculate_solution",
    "lookup_pincode",
    "compute_bill_from_slabs",
    "compute_bill_savings",
    "back_solve_units",
    "pm_surya_ghar_subsidy",
    "pm_kusum_subsidy",
    "ROUND",
]
