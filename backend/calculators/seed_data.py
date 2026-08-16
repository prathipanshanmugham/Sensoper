"""Idempotent seed data for DISCOMs (TANGEDCO / TNPDCL / KSEB / BESCOM full;
others flat fallback) and a representative pincode set.

Loaded by /api/calculate/seed-defaults endpoint.
"""
from __future__ import annotations
from datetime import datetime, timezone


DEFAULT_DISCOMS = [
    # ══════════════ TAMIL NADU — TANGEDCO ══════════════
    {
        "id": "TANGEDCO",
        "short_code": "TANGEDCO",
        "name": "Tamil Nadu Generation & Distribution Corp (TANGEDCO)",
        "state": "Tamil Nadu",
        "active": True,
        "billing_cycle": "bimonthly",
        "slab_structure": "telescopic",
        "effective_from": "2024-07-01",
        "source_note": "TNERC tariff order 2024-25 (LT-1A domestic, telescopic bimonthly slabs)",
        "categories": [
            {
                "name": "Domestic",
                "fixed_charge": 25,
                "export_rate": 3.0,
                "net_metering_type": "net_metering",
                "slabs": [
                    {"from_units": 0, "to_units": 100, "rate_per_unit": 0},
                    {"from_units": 100, "to_units": 200, "rate_per_unit": 2.35},
                    {"from_units": 200, "to_units": 400, "rate_per_unit": 4.7},
                    {"from_units": 400, "to_units": 500, "rate_per_unit": 6.3},
                    {"from_units": 500, "to_units": 600, "rate_per_unit": 8.4},
                    {"from_units": 600, "to_units": 800, "rate_per_unit": 9.45},
                    {"from_units": 800, "to_units": 1000, "rate_per_unit": 10.5},
                    {"from_units": 1000, "to_units": None, "rate_per_unit": 11.55}
                ]
            },
            {
                "name": "Commercial LT-5",
                "fixed_charge": 75,
                "export_rate": 3.5,
                "net_metering_type": "net_metering",
                "slabs": [
                    {"from_units": 0, "to_units": 100, "rate_per_unit": 5.85},
                    {"from_units": 100, "to_units": 500, "rate_per_unit": 8.15},
                    {"from_units": 500, "to_units": None, "rate_per_unit": 9.85}
                ]
            },
            {
                "name": "Industrial LT-3",
                "fixed_charge": 125,
                "export_rate": 3.5,
                "net_metering_type": "net_metering",
                "slabs": [
                    {"from_units": 0, "to_units": None, "rate_per_unit": 8.05}
                ]
            },
            {
                "name": "Agricultural",
                "fixed_charge": 0,
                "export_rate": 0,
                "net_metering_type": "none",
                "slabs": [
                    {"from_units": 0, "to_units": None, "rate_per_unit": 0.0}
                ],
                "note": "Free power for farmers in Tamil Nadu (subsidised by GoTN)"
            },
            {
                "name": "HT-1",
                "fixed_charge": 400,
                "export_rate": 3.5,
                "net_metering_type": "net_metering",
                "slabs": [
                    {"from_units": 0, "to_units": None, "rate_per_unit": 7.5}
                ]
            }
        ]
    },
    # ══════════════ TN NORTH — TNPDCL ══════════════
    {
        "id": "TNPDCL",
        "short_code": "TNPDCL",
        "name": "Tamil Nadu Power Distribution Corp (TNPDCL, northern zone)",
        "state": "Tamil Nadu",
        "active": True,
        "billing_cycle": "bimonthly",
        "slab_structure": "telescopic",
        "effective_from": "2024-07-01",
        "source_note": "Same tariff schedule as TANGEDCO, distribution split effective 2023",
        "categories": [
            {"name": "Domestic", "fixed_charge": 25, "export_rate": 3.0,
             "net_metering_type": "net_metering",
             "slabs": [
                 {"from_units": 0, "to_units": 100, "rate_per_unit": 0},
                 {"from_units": 100, "to_units": 200, "rate_per_unit": 2.35},
                 {"from_units": 200, "to_units": 400, "rate_per_unit": 4.7},
                 {"from_units": 400, "to_units": 500, "rate_per_unit": 6.3},
                 {"from_units": 500, "to_units": 600, "rate_per_unit": 8.4},
                 {"from_units": 600, "to_units": 800, "rate_per_unit": 9.45},
                 {"from_units": 800, "to_units": 1000, "rate_per_unit": 10.5},
                 {"from_units": 1000, "to_units": None, "rate_per_unit": 11.55}]},
            {"name": "Commercial LT-5", "fixed_charge": 75, "export_rate": 3.5,
             "slabs": [
                 {"from_units": 0, "to_units": 100, "rate_per_unit": 5.85},
                 {"from_units": 100, "to_units": 500, "rate_per_unit": 8.15},
                 {"from_units": 500, "to_units": None, "rate_per_unit": 9.85}]},
            {"name": "Agricultural", "fixed_charge": 0, "export_rate": 0,
             "slabs": [{"from_units": 0, "to_units": None, "rate_per_unit": 0.0}]}
        ]
    },
    # ══════════════ KERALA — KSEB ══════════════
    {
        "id": "KSEB",
        "short_code": "KSEB",
        "name": "Kerala State Electricity Board Ltd",
        "state": "Kerala",
        "active": True,
        "billing_cycle": "monthly",
        "slab_structure": "telescopic",
        "effective_from": "2024-04-01",
        "source_note": "KSERC tariff 2024-25 (LT-1A domestic)",
        "categories": [
            {"name": "Domestic", "fixed_charge": 40, "export_rate": 2.85,
             "net_metering_type": "net_metering",
             "slabs": [
                 {"from_units": 0, "to_units": 50, "rate_per_unit": 3.25},
                 {"from_units": 50, "to_units": 100, "rate_per_unit": 4.05},
                 {"from_units": 100, "to_units": 150, "rate_per_unit": 5.10},
                 {"from_units": 150, "to_units": 200, "rate_per_unit": 6.95},
                 {"from_units": 200, "to_units": 250, "rate_per_unit": 8.20},
                 {"from_units": 250, "to_units": 300, "rate_per_unit": 6.40},
                 {"from_units": 300, "to_units": 350, "rate_per_unit": 7.25},
                 {"from_units": 350, "to_units": 400, "rate_per_unit": 7.60},
                 {"from_units": 400, "to_units": 500, "rate_per_unit": 8.20},
                 {"from_units": 500, "to_units": None, "rate_per_unit": 9.65}]},
            {"name": "Commercial LT-VII", "fixed_charge": 80, "export_rate": 3.0,
             "slabs": [
                 {"from_units": 0, "to_units": 100, "rate_per_unit": 8.60},
                 {"from_units": 100, "to_units": 300, "rate_per_unit": 9.80},
                 {"from_units": 300, "to_units": None, "rate_per_unit": 11.20}]},
            {"name": "Agricultural", "fixed_charge": 20, "export_rate": 2.5,
             "slabs": [{"from_units": 0, "to_units": None, "rate_per_unit": 2.20}]}
        ]
    },
    # ══════════════ KARNATAKA — BESCOM ══════════════
    {
        "id": "BESCOM",
        "short_code": "BESCOM",
        "name": "Bangalore Electricity Supply Company",
        "state": "Karnataka",
        "active": True,
        "billing_cycle": "monthly",
        "slab_structure": "telescopic",
        "effective_from": "2024-04-01",
        "source_note": "KERC tariff order 2024-25 (LT-2a domestic)",
        "categories": [
            {"name": "Domestic", "fixed_charge": 110, "export_rate": 3.15,
             "net_metering_type": "net_metering",
             "slabs": [
                 {"from_units": 0, "to_units": 50, "rate_per_unit": 4.50},
                 {"from_units": 50, "to_units": 100, "rate_per_unit": 6.55},
                 {"from_units": 100, "to_units": 200, "rate_per_unit": 8.15},
                 {"from_units": 200, "to_units": None, "rate_per_unit": 9.65}]},
            {"name": "Commercial LT-3", "fixed_charge": 150, "export_rate": 3.5,
             "slabs": [
                 {"from_units": 0, "to_units": 50, "rate_per_unit": 9.10},
                 {"from_units": 50, "to_units": None, "rate_per_unit": 10.45}]},
            {"name": "Agricultural", "fixed_charge": 0, "export_rate": 0,
             "slabs": [{"from_units": 0, "to_units": None, "rate_per_unit": 0.0}]}
        ]
    },
    # ══════════════ NATIONAL FALLBACK ══════════════
    {
        "id": "FALLBACK",
        "short_code": "FALLBACK",
        "name": "National Fallback (flat rate estimate)",
        "state": "ALL",
        "active": True,
        "billing_cycle": "monthly",
        "slab_structure": "non_telescopic",
        "is_estimate": True,
        "effective_from": "2024-01-01",
        "source_note": "Placeholder — replace with local DISCOM slabs before quoting",
        "categories": [
            {"name": "Domestic",   "fixed_charge": 0, "export_rate": 3.0,
             "slabs": [{"from_units": 0, "to_units": None, "rate_per_unit": 6.5}]},
            {"name": "Commercial", "fixed_charge": 0, "export_rate": 3.0,
             "slabs": [{"from_units": 0, "to_units": None, "rate_per_unit": 9.0}]},
            {"name": "Industrial", "fixed_charge": 0, "export_rate": 3.0,
             "slabs": [{"from_units": 0, "to_units": None, "rate_per_unit": 8.5}]},
            {"name": "Agricultural", "fixed_charge": 0, "export_rate": 0,
             "slabs": [{"from_units": 0, "to_units": None, "rate_per_unit": 1.5}]}
        ]
    },
]

# ── Representative pincode seeds — expand incrementally ──────────────
# yield_kwh_per_kwp_day is district-level average (NASA POWER / MNRE)
DEFAULT_PINCODES = [
    # Tamil Nadu — Chennai / North / West
    {"pincode": "600001", "district": "Chennai",   "state": "Tamil Nadu", "discom": "TANGEDCO",
     "latitude": 13.084, "longitude": 80.276, "specific_yield_kwh_per_kwp_day": 4.35, "peak_sun_hours": 5.6, "region_cost_factor": 1.0},
    {"pincode": "600028", "district": "Chennai",   "state": "Tamil Nadu", "discom": "TANGEDCO",
     "latitude": 13.031, "longitude": 80.257, "specific_yield_kwh_per_kwp_day": 4.35, "peak_sun_hours": 5.6, "region_cost_factor": 1.0},
    {"pincode": "641001", "district": "Coimbatore","state": "Tamil Nadu", "discom": "TANGEDCO",
     "latitude": 11.017, "longitude": 76.958, "specific_yield_kwh_per_kwp_day": 4.65, "peak_sun_hours": 5.9, "region_cost_factor": 1.0},
    {"pincode": "641004", "district": "Coimbatore","state": "Tamil Nadu", "discom": "TANGEDCO",
     "latitude": 11.014, "longitude": 76.978, "specific_yield_kwh_per_kwp_day": 4.65, "peak_sun_hours": 5.9, "region_cost_factor": 1.0},
    {"pincode": "625001", "district": "Madurai",   "state": "Tamil Nadu", "discom": "TANGEDCO",
     "latitude": 9.925,  "longitude": 78.119, "specific_yield_kwh_per_kwp_day": 4.85, "peak_sun_hours": 6.1, "region_cost_factor": 1.0},
    {"pincode": "620001", "district": "Tiruchirappalli", "state": "Tamil Nadu", "discom": "TANGEDCO",
     "latitude": 10.79,  "longitude": 78.7,   "specific_yield_kwh_per_kwp_day": 4.75, "peak_sun_hours": 6.0, "region_cost_factor": 1.0},
    {"pincode": "636001", "district": "Salem",     "state": "Tamil Nadu", "discom": "TNPDCL",
     "latitude": 11.664, "longitude": 78.146, "specific_yield_kwh_per_kwp_day": 4.7,  "peak_sun_hours": 5.95,"region_cost_factor": 1.02},
    {"pincode": "638001", "district": "Erode",     "state": "Tamil Nadu", "discom": "TNPDCL",
     "latitude": 11.34,  "longitude": 77.72,  "specific_yield_kwh_per_kwp_day": 4.7,  "peak_sun_hours": 5.95,"region_cost_factor": 1.02},
    {"pincode": "628001", "district": "Thoothukudi","state": "Tamil Nadu","discom": "TANGEDCO",
     "latitude": 8.76,   "longitude": 78.13,  "specific_yield_kwh_per_kwp_day": 5.10, "peak_sun_hours": 6.3, "region_cost_factor": 1.0},
    {"pincode": "627001", "district": "Tirunelveli","state": "Tamil Nadu","discom": "TANGEDCO",
     "latitude": 8.71,   "longitude": 77.75,  "specific_yield_kwh_per_kwp_day": 5.0,  "peak_sun_hours": 6.2, "region_cost_factor": 1.0},
    {"pincode": "612001", "district": "Thanjavur",  "state": "Tamil Nadu","discom": "TANGEDCO",
     "latitude": 10.79,  "longitude": 79.14,  "specific_yield_kwh_per_kwp_day": 4.7,  "peak_sun_hours": 5.95,"region_cost_factor": 1.0},
    # Kerala
    {"pincode": "682001", "district": "Ernakulam",  "state": "Kerala",     "discom": "KSEB",
     "latitude": 9.98,   "longitude": 76.28,  "specific_yield_kwh_per_kwp_day": 4.1,  "peak_sun_hours": 5.4, "region_cost_factor": 1.05},
    {"pincode": "695001", "district": "Thiruvananthapuram","state": "Kerala","discom": "KSEB",
     "latitude": 8.52,   "longitude": 76.94,  "specific_yield_kwh_per_kwp_day": 4.25, "peak_sun_hours": 5.5, "region_cost_factor": 1.05},
    {"pincode": "673001", "district": "Kozhikode",  "state": "Kerala",     "discom": "KSEB",
     "latitude": 11.25,  "longitude": 75.78,  "specific_yield_kwh_per_kwp_day": 4.0,  "peak_sun_hours": 5.3, "region_cost_factor": 1.05},
    {"pincode": "680001", "district": "Thrissur",   "state": "Kerala",     "discom": "KSEB",
     "latitude": 10.52,  "longitude": 76.21,  "specific_yield_kwh_per_kwp_day": 4.1,  "peak_sun_hours": 5.4, "region_cost_factor": 1.05},
    # Karnataka
    {"pincode": "560001", "district": "Bengaluru Urban","state": "Karnataka","discom": "BESCOM",
     "latitude": 12.97,  "longitude": 77.59,  "specific_yield_kwh_per_kwp_day": 4.6,  "peak_sun_hours": 5.85,"region_cost_factor": 1.0},
    {"pincode": "570001", "district": "Mysuru",     "state": "Karnataka",  "discom": "BESCOM",
     "latitude": 12.30,  "longitude": 76.65,  "specific_yield_kwh_per_kwp_day": 4.65, "peak_sun_hours": 5.9, "region_cost_factor": 1.02},
    {"pincode": "580001", "district": "Dharwad",    "state": "Karnataka",  "discom": "BESCOM",
     "latitude": 15.46,  "longitude": 75.01,  "specific_yield_kwh_per_kwp_day": 4.8,  "peak_sun_hours": 6.05,"region_cost_factor": 1.02},
]


def get_default_discoms():
    return DEFAULT_DISCOMS


def get_default_pincodes():
    return DEFAULT_PINCODES
