"""
Product Catalogue + Fuel Model (Iteration 44 — Phase 1)
=========================================================
Replaces the 9 flat pricing constants (panel_price_per_watt, inverter_price_per_kw, ...)
with a real catalogue: panel_products, inverter_products, battery_products, pump_products,
structure_products, service_rates + a fuel_types collection that generalises the diesel-only
assumptions in ProposedSolutionSection.

Every product carries:
 * effective_from date for price versioning (a quote snapshots the price used, editing a
   price later does not silently mutate old quotes)
 * per-product margin_pct (with global default fallback)
 * source_note + last_reviewed_date on constants so whoever updates a value records provenance
 * linked_inventory_item_id so pricing and stock stay one source of truth

All routes are auth-guarded and admin-only for writes.
"""
from __future__ import annotations
from datetime import datetime, timezone, date
from typing import Optional, List, Dict, Any, Literal
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel, Field
from bson import ObjectId
import io
import csv
import uuid

router = APIRouter(prefix="/catalogue", tags=["catalogue"])

# ---------------------------------------------------------------------------
# COLLECTIONS
# ---------------------------------------------------------------------------
COLLECTIONS = {
    "panel":     "panel_products",
    "inverter":  "inverter_products",
    "battery":   "battery_products",
    "pump":      "pump_products",
    "structure": "structure_products",
    "service":   "service_rates",
    "fuel":      "fuel_types",
    "history":   "price_history",
    "addon_group": "addon_groups",
}
CATEGORIES = ["panel", "inverter", "battery", "pump", "structure", "service"]


# ---------------------------------------------------------------------------
# PYDANTIC MODELS
# ---------------------------------------------------------------------------
class PanelProduct(BaseModel):
    make: str
    model: str
    wattage: float
    technology: str = "Mono PERC"      # Mono PERC | TOPCon | HJT | Bifacial | Poly
    cell_type: str = ""
    efficiency_pct: Optional[float] = None
    voc: Optional[float] = None
    vmp: Optional[float] = None
    isc: Optional[float] = None
    imp: Optional[float] = None
    temp_coefficient_voc: Optional[float] = -0.29   # %/°C, typical for silicon
    dimensions_mm: Optional[str] = None
    area_sqft: Optional[float] = None
    weight_kg: Optional[float] = None
    purchase_price: Optional[float] = None
    price_per_watt: Optional[float] = None          # derived if purchase_price + wattage present
    selling_price: Optional[float] = None
    margin_pct: Optional[float] = None
    warranty_product_years: int = 12
    warranty_performance_years: int = 25
    supplier: str = ""
    lead_time_days: int = 15
    tier: str = "Tier 2"                             # Tier 1 | Tier 2 | Tier 3
    is_dcr: bool = False
    active: bool = True
    effective_from: Optional[str] = None
    linked_inventory_item_id: Optional[str] = None

class InverterProduct(BaseModel):
    make: str
    model: str
    type: str = "on-grid"                            # on-grid | off-grid | hybrid | pump_drive
    rated_kw: float
    max_dc_input_kw: Optional[float] = None
    mppt_count: int = 1
    mppt_voltage_min: Optional[float] = None
    mppt_voltage_max: Optional[float] = None
    max_input_voltage: Optional[float] = None        # Voc-at-Tmin limit
    max_input_current_per_mppt: Optional[float] = None
    output_phase: str = "single"                     # single | three
    output_voltage: int = 230
    battery_compatible: bool = False
    battery_voltage: Optional[float] = None
    efficiency_pct: float = 96.0
    purchase_price: Optional[float] = None
    selling_price: Optional[float] = None
    margin_pct: Optional[float] = None
    warranty_years: int = 5
    supplier: str = ""
    active: bool = True
    effective_from: Optional[str] = None
    linked_inventory_item_id: Optional[str] = None

class BatteryProduct(BaseModel):
    make: str
    model: str
    chemistry: str = "LiFePO4"                       # LiFePO4 | Li-ion | Tubular | Gel
    capacity_ah: float
    voltage: float = 12.0
    kwh: Optional[float] = None
    dod_pct: float = 80.0
    cycles: int = 3000
    warranty_years: int = 5
    purchase_price: Optional[float] = None
    selling_price: Optional[float] = None
    margin_pct: Optional[float] = None
    supplier: str = ""
    active: bool = True
    effective_from: Optional[str] = None
    linked_inventory_item_id: Optional[str] = None

class PumpProduct(BaseModel):
    make: str
    model: str
    hp: float
    kw: Optional[float] = None
    voltage: float = 230
    phase: str = "single"                            # single | three
    ac_or_dc: str = "AC"                              # AC | DC
    pump_type: str = "submersible"                    # submersible | surface | openwell
    body_diameter_mm: Optional[float] = None          # for bore-casing fit
    min_bore_casing_mm: Optional[float] = None
    max_head_m: Optional[float] = None
    max_discharge_lph: Optional[float] = None
    curve_points: Optional[List[Dict[str, float]]] = None   # [{head_m, lph}, ...]
    controller_make: str = ""
    controller_model: str = ""
    controller_type: str = "MPPT"                     # MPPT | VFD
    controller_input_v_min: Optional[float] = None
    controller_input_v_max: Optional[float] = None
    controller_input_v_absolute_max: Optional[float] = None    # Voc-at-Tmin absolute limit
    controller_input_current_max: Optional[float] = None
    motor_efficiency_pct: Optional[float] = None
    pump_efficiency_pct: Optional[float] = None
    purchase_price: Optional[float] = None
    selling_price: Optional[float] = None
    margin_pct: Optional[float] = None
    warranty_years: int = 5
    supplier: str = ""
    active: bool = True
    effective_from: Optional[str] = None
    linked_inventory_item_id: Optional[str] = None

class StructureProduct(BaseModel):
    name: str
    category: str = "structure"                       # structure | cable | dcdb | acdb | earthing | la | connector
    mounting_surface: str = "roof"                    # roof | ground | pole
    height_ft: Optional[float] = None
    material: str = "GI"
    unit: str = "per_kw"                              # per_kw | per_unit | per_meter
    purchase_price: float = 0.0
    selling_price: Optional[float] = None
    margin_pct: Optional[float] = None
    supplier: str = ""
    active: bool = True
    effective_from: Optional[str] = None
    linked_inventory_item_id: Optional[str] = None

class ServiceRate(BaseModel):
    name: str
    system_type_scope: str = "any"                    # any | on-grid | off-grid | hybrid | solar-pump
    unit: str = "per_kw"                              # per_kw | per_unit | per_km | flat
    rate: float
    description: str = ""
    active: bool = True
    effective_from: Optional[str] = None

class FuelType(BaseModel):
    name: str                                          # Diesel | Petrol | Kerosene | LPG | CNG | Biodiesel | Grid Electricity
    unit: str                                          # litre | kg | scm | kWh
    energy_content_kwh_per_unit: float                 # Higher heating value in kWh per unit
    genset_efficiency_pct: float = 30.0                # electrical output vs fuel energy (typical genset)
    default_price_per_unit: float = 0.0
    co2_kg_per_unit: float = 0.0
    active: bool = True
    source_note: str = ""
    last_reviewed_date: Optional[str] = None

class AddonGroup(BaseModel):
    name: str
    display_order: int = 100
    description: str = ""
    show_on_pdf: bool = True
    optional_priced_separately: bool = False           # if True, price excluded from grand total on PDF
    icon: Optional[str] = None
    active: bool = True


# ---------------------------------------------------------------------------
# HELPERS — attached lazily so this module doesn't hard-depend on server.py
# ---------------------------------------------------------------------------
_db = None
_get_user = None

def bind(db_handle, get_current_user_fn):
    """Wire the shared Mongo handle + auth dependency from server.py."""
    global _db, _get_user
    _db = db_handle
    _get_user = get_current_user_fn


async def _require_admin(request: Request):
    user = await _get_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


async def _current_user(request: Request):
    return await _get_user(request)


def _clean_doc(d: dict) -> dict:
    """Convert Mongo doc to JSON-safe dict with id string."""
    if not d:
        return d
    d = {**d}
    if "_id" in d:
        d["id"] = str(d.pop("_id"))
    return d


def _pricing_config_defaults() -> dict:
    return {
        "gst_pct": 13.8,
        "default_margin_pct": 15.0,
        "kit_rounding_step": 500,          # Change 4: kit price rounds to nearest ₹500 (admin-configurable)
        "kit_rounding_mode": "nearest",     # nearest | up | down
        "specific_yield_kwh_per_kwp_day": 4.5,
        "peak_sun_hours_availability": 0.95,
        "pump_oversizing_factor": 1.30,
        "pump_derating_factor": 0.85,
        "diesel_price_per_litre": 92.0,     # fallback if fuel_types collection is empty
        "discount_rate_pct": 10.0,
        "panel_area_sqft_per_kwp": 65.0,
        "co2_kg_per_kwh_grid": 0.82,
        "string_low_temp_default_c": -10.0,  # Change 5 — admin-configurable per DISCOM/pincode
    }


# ---------------------------------------------------------------------------
# GENERIC ROUTES  — /catalogue/products/{cat}
# ---------------------------------------------------------------------------
@router.get("/products/{cat}")
async def list_products(cat: str, request: Request, active_only: bool = False):
    await _current_user(request)
    if cat not in COLLECTIONS or cat == "history":
        raise HTTPException(400, "Unknown category")
    coll_name = COLLECTIONS[cat]
    q = {"active": True} if active_only else {}
    docs = await _db[coll_name].find(q).sort("make", 1).to_list(2000)
    return [_clean_doc(d) for d in docs]


MODEL_MAP: Dict[str, type[BaseModel]] = {
    "panel": PanelProduct,
    "inverter": InverterProduct,
    "battery": BatteryProduct,
    "pump": PumpProduct,
    "structure": StructureProduct,
    "service": ServiceRate,
    "fuel": FuelType,
    "addon_group": AddonGroup,
}


async def _write_history(request: Request, cat: str, doc_id: str, before: Optional[dict], after: dict, action: str):
    user = await _current_user(request)
    await _db[COLLECTIONS["history"]].insert_one({
        "cat": cat,
        "product_id": doc_id,
        "action": action,
        "before": before,
        "after": after,
        "user_id": user.get("id"),
        "user_name": user.get("name", ""),
        "at": datetime.now(timezone.utc).isoformat(),
    })


@router.post("/products/{cat}")
async def create_product(cat: str, payload: dict, request: Request):
    await _require_admin(request)
    if cat not in MODEL_MAP:
        raise HTTPException(400, "Unknown category")
    model = MODEL_MAP[cat](**payload)          # validate
    doc = model.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    if not doc.get("effective_from"):
        doc["effective_from"] = date.today().isoformat()

    # Panel: auto-derive price_per_watt when missing
    if cat == "panel" and doc.get("purchase_price") and doc.get("wattage") and not doc.get("price_per_watt"):
        doc["price_per_watt"] = round(doc["purchase_price"] / doc["wattage"], 3)

    # Battery: auto-derive kWh
    if cat == "battery" and doc.get("capacity_ah") and doc.get("voltage") and not doc.get("kwh"):
        doc["kwh"] = round(doc["capacity_ah"] * doc["voltage"] / 1000.0, 3)

    # Fuel: auto-derive effective_kwh_per_unit + units_per_kwh
    if cat == "fuel":
        eff = doc.get("energy_content_kwh_per_unit", 0) * (doc.get("genset_efficiency_pct", 30) / 100.0)
        doc["effective_kwh_per_unit"] = round(eff, 4)
        doc["units_per_kwh"] = round(1 / eff, 4) if eff > 0 else None

    result = await _db[COLLECTIONS[cat]].insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    await _write_history(request, cat, doc["id"], None, doc, "create")
    return doc


@router.put("/products/{cat}/{pid}")
async def update_product(cat: str, pid: str, payload: dict, request: Request):
    await _require_admin(request)
    if cat not in MODEL_MAP:
        raise HTTPException(400, "Unknown category")
    coll = _db[COLLECTIONS[cat]]
    try:
        oid = ObjectId(pid)
    except Exception:
        raise HTTPException(400, "Invalid id")
    before = await coll.find_one({"_id": oid})
    if not before:
        raise HTTPException(404, "Not found")
    # partial update — validate only supplied fields
    update = {k: v for k, v in payload.items() if k in MODEL_MAP[cat].model_fields}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    if cat == "panel" and update.get("purchase_price") and (update.get("wattage") or before.get("wattage")):
        w = update.get("wattage") or before.get("wattage")
        update["price_per_watt"] = round(update["purchase_price"] / w, 3)
    if cat == "battery":
        ah = update.get("capacity_ah") or before.get("capacity_ah")
        v = update.get("voltage") or before.get("voltage")
        if ah and v:
            update["kwh"] = round(ah * v / 1000.0, 3)
    if cat == "fuel":
        e = update.get("energy_content_kwh_per_unit") or before.get("energy_content_kwh_per_unit", 0)
        g = update.get("genset_efficiency_pct") or before.get("genset_efficiency_pct", 30)
        eff = e * (g / 100.0)
        update["effective_kwh_per_unit"] = round(eff, 4)
        update["units_per_kwh"] = round(1 / eff, 4) if eff > 0 else None

    await coll.update_one({"_id": oid}, {"$set": update})
    after = await coll.find_one({"_id": oid})
    await _write_history(request, cat, pid, _clean_doc(before), _clean_doc(after), "update")
    return _clean_doc(after)


@router.delete("/products/{cat}/{pid}")
async def delete_product(cat: str, pid: str, request: Request):
    await _require_admin(request)
    if cat not in MODEL_MAP:
        raise HTTPException(400, "Unknown category")
    coll = _db[COLLECTIONS[cat]]
    try:
        oid = ObjectId(pid)
    except Exception:
        raise HTTPException(400, "Invalid id")
    before = await coll.find_one({"_id": oid})
    if not before:
        raise HTTPException(404, "Not found")
    # Soft-delete: set active=False so old quote snapshots still reference the row
    await coll.update_one({"_id": oid}, {"$set": {"active": False, "deleted_at": datetime.now(timezone.utc).isoformat()}})
    await _write_history(request, cat, pid, _clean_doc(before), {"active": False}, "delete")
    return {"message": "archived"}


# ---------------------------------------------------------------------------
# EXCEL / CSV IMPORT
# ---------------------------------------------------------------------------
@router.post("/products/{cat}/import")
async def import_csv(cat: str, request: Request, file: UploadFile = File(...)):
    await _require_admin(request)
    if cat not in MODEL_MAP:
        raise HTTPException(400, "Unknown category")
    content = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    inserted, skipped, errors = 0, 0, []
    coll = _db[COLLECTIONS[cat]]
    for i, row in enumerate(reader, 2):
        try:
            # coerce numeric fields
            clean = {}
            for k, v in row.items():
                if v is None or v == "":
                    continue
                k = k.strip().lower().replace(" ", "_")
                try:
                    clean[k] = float(v) if "." in v or v.replace("-", "").isdigit() else v.strip()
                except Exception:
                    clean[k] = v.strip()
            model = MODEL_MAP[cat](**clean)
            doc = model.model_dump()
            doc["created_at"] = datetime.now(timezone.utc).isoformat()
            if not doc.get("effective_from"):
                doc["effective_from"] = date.today().isoformat()
            if cat == "panel" and doc.get("purchase_price") and doc.get("wattage") and not doc.get("price_per_watt"):
                doc["price_per_watt"] = round(doc["purchase_price"] / doc["wattage"], 3)
            if cat == "fuel":
                eff = doc.get("energy_content_kwh_per_unit", 0) * (doc.get("genset_efficiency_pct", 30) / 100.0)
                doc["effective_kwh_per_unit"] = round(eff, 4)
                doc["units_per_kwh"] = round(1 / eff, 4) if eff > 0 else None
            await coll.insert_one(doc)
            inserted += 1
        except Exception as e:
            skipped += 1
            errors.append({"row": i, "error": str(e)[:120]})
    return {"inserted": inserted, "skipped": skipped, "errors": errors[:20], "total_after": await coll.count_documents({})}


# ---------------------------------------------------------------------------
# PRICE HISTORY
# ---------------------------------------------------------------------------
@router.get("/products/{cat}/{pid}/history")
async def price_history(cat: str, pid: str, request: Request):
    await _current_user(request)
    docs = await _db[COLLECTIONS["history"]].find({"cat": cat, "product_id": pid}).sort("at", -1).to_list(200)
    return [_clean_doc(d) for d in docs]


# ---------------------------------------------------------------------------
# GLOBAL DEFAULTS  (Tab 7)
# ---------------------------------------------------------------------------
@router.get("/config")
async def get_config(request: Request):
    await _current_user(request)
    doc = await _db.pricing_config.find_one({"key": "defaults"}) or {}
    return {**_pricing_config_defaults(), **{k: v for k, v in doc.items() if k not in ("_id", "key")}}


@router.put("/config")
async def update_config(payload: dict, request: Request):
    await _require_admin(request)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    await _db.pricing_config.update_one({"key": "defaults"}, {"$set": payload}, upsert=True)
    doc = await _db.pricing_config.find_one({"key": "defaults"}) or {}
    return {**_pricing_config_defaults(), **{k: v for k, v in doc.items() if k not in ("_id", "key")}}


# ---------------------------------------------------------------------------
# SEED  (Generic fallback products + fuel types + addon groups)
# ---------------------------------------------------------------------------
@router.post("/seed")
async def seed_catalogue(request: Request):
    """Idempotent — seeds one Generic/Unbranded product per category so existing projects
    (that were priced against the flat global constants) still open and price."""
    await _require_admin(request)
    seeded = {}

    # 1) Migrate old flat pricing → Generic fallback products
    old = await _db.thresholds.find_one({"key": "pricing"}) or {}
    panel_pw = old.get("panel_price_per_watt", 25)
    inv_pkw = old.get("inverter_price_per_kw", 8000)
    struct_pkw = old.get("structure_price_per_kw", 5000)
    bat_pah = old.get("battery_price_per_ah", 150)
    wiring_pm = old.get("wiring_price_per_meter", 50)
    labor_pkw = old.get("labor_price_per_kw", 3000)
    trans_base = old.get("transportation_base", 5000)

    # Panels — Generic 540W
    if not await _db[COLLECTIONS["panel"]].find_one({"make": "Generic", "model": "540W Mono"}):
        await _db[COLLECTIONS["panel"]].insert_one({
            **PanelProduct(make="Generic", model="540W Mono", wattage=540, technology="Mono PERC",
                efficiency_pct=20.5, voc=49.8, vmp=41.5, isc=13.8, imp=13.02,
                area_sqft=24.0, purchase_price=540 * panel_pw, price_per_watt=panel_pw,
                margin_pct=15, tier="Tier 2", supplier="Generic").model_dump(),
            "effective_from": date.today().isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        seeded["panel"] = 1

    # Inverters — Generic 5kW ongrid
    if not await _db[COLLECTIONS["inverter"]].find_one({"make": "Generic", "model": "5kW On-Grid"}):
        await _db[COLLECTIONS["inverter"]].insert_one({
            **InverterProduct(make="Generic", model="5kW On-Grid", type="on-grid", rated_kw=5,
                max_dc_input_kw=6.5, mppt_count=2, mppt_voltage_min=120, mppt_voltage_max=500,
                max_input_voltage=550, purchase_price=5 * inv_pkw, margin_pct=15,
                supplier="Generic").model_dump(),
            "effective_from": date.today().isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        seeded["inverter"] = 1

    # Battery — Generic tubular 150Ah
    if not await _db[COLLECTIONS["battery"]].find_one({"make": "Generic", "model": "150Ah Tubular"}):
        await _db[COLLECTIONS["battery"]].insert_one({
            **BatteryProduct(make="Generic", model="150Ah Tubular", chemistry="Tubular",
                capacity_ah=150, voltage=12, kwh=1.8, dod_pct=50, cycles=1500,
                purchase_price=150 * bat_pah, margin_pct=15, supplier="Generic").model_dump(),
            "effective_from": date.today().isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        seeded["battery"] = 1

    # Pump — Generic 3HP DC
    if not await _db[COLLECTIONS["pump"]].find_one({"make": "Generic", "model": "3HP DC Submersible"}):
        await _db[COLLECTIONS["pump"]].insert_one({
            **PumpProduct(make="Generic", model="3HP DC Submersible", hp=3, kw=2.24, voltage=220,
                phase="single", ac_or_dc="DC", pump_type="submersible", body_diameter_mm=100,
                min_bore_casing_mm=125, max_head_m=60, max_discharge_lph=5000,
                controller_type="MPPT", controller_input_v_min=120, controller_input_v_max=380,
                controller_input_v_absolute_max=450, controller_input_current_max=15,
                motor_efficiency_pct=85, pump_efficiency_pct=55,
                purchase_price=80000, margin_pct=15, supplier="Generic").model_dump(),
            "effective_from": date.today().isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        seeded["pump"] = 1

    # Structure & BOS lines — Generic per-kW
    for name, per, price in [
        ("Structure (GI, roof)",  "per_kw", struct_pkw),
        ("DC + AC Cabling",       "per_meter", wiring_pm),
        ("DCDB / ACDB / Earthing / LA (kit)", "per_kw", 800),
        ("Transportation",        "flat", trans_base),
    ]:
        if not await _db[COLLECTIONS["structure"]].find_one({"name": name}):
            await _db[COLLECTIONS["structure"]].insert_one({
                **StructureProduct(name=name, unit=per, purchase_price=price, margin_pct=15,
                    supplier="Generic").model_dump(),
                "effective_from": date.today().isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    seeded["structure"] = 4

    # Service rates — installation / commissioning
    for name, scope, unit, rate in [
        ("Installation & Commissioning — On-Grid",  "on-grid",   "per_kw", labor_pkw),
        ("Installation & Commissioning — Off-Grid", "off-grid",  "per_kw", labor_pkw * 1.15),
        ("Installation & Commissioning — Hybrid",   "hybrid",    "per_kw", labor_pkw * 1.20),
        ("Installation & Commissioning — Pump",     "solar-pump","per_unit", 8000),
        ("Net-metering liaison",                    "any",       "flat",    3500),
    ]:
        if not await _db[COLLECTIONS["service"]].find_one({"name": name}):
            await _db[COLLECTIONS["service"]].insert_one({
                **ServiceRate(name=name, system_type_scope=scope, unit=unit, rate=rate).model_dump(),
                "effective_from": date.today().isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    seeded["service"] = 5

    # Fuel types — replaces the hardcoded 0.28 L/kWh
    fuels = [
        {"name": "Diesel",           "unit": "litre", "energy_content_kwh_per_unit": 10.7,  "genset_efficiency_pct": 30, "default_price_per_unit": 92.0,  "co2_kg_per_unit": 2.68,
         "source_note": "MoP&NG 2024 avg + typical genset thermal-to-electrical efficiency 28-32%. 10.7 kWh/L HHV × 0.30 ≈ 3.21 kWh/L → 0.31 L/kWh (was hardcoded 0.28)."},
        {"name": "Petrol",           "unit": "litre", "energy_content_kwh_per_unit": 9.5,   "genset_efficiency_pct": 25, "default_price_per_unit": 100.0, "co2_kg_per_unit": 2.31,
         "source_note": "Typical petrol HHV; smaller petrol gensets ~25% electrical efficiency."},
        {"name": "Kerosene",         "unit": "litre", "energy_content_kwh_per_unit": 10.0,  "genset_efficiency_pct": 28, "default_price_per_unit": 60.0,  "co2_kg_per_unit": 2.53,
         "source_note": ""},
        {"name": "LPG",              "unit": "kg",    "energy_content_kwh_per_unit": 12.9,  "genset_efficiency_pct": 30, "default_price_per_unit": 55.0,  "co2_kg_per_unit": 2.98,
         "source_note": "LPG cylinder-basis; commercial rate varies by state."},
        {"name": "CNG",              "unit": "scm",   "energy_content_kwh_per_unit": 10.5,  "genset_efficiency_pct": 32, "default_price_per_unit": 80.0,  "co2_kg_per_unit": 2.02,
         "source_note": "Standard cubic metre."},
        {"name": "Grid Electricity", "unit": "kWh",   "energy_content_kwh_per_unit": 1.0,   "genset_efficiency_pct": 100,"default_price_per_unit": 7.5,   "co2_kg_per_unit": 0.82,
         "source_note": "Grid CO2 factor CEA v20."},
    ]
    for f in fuels:
        if not await _db[COLLECTIONS["fuel"]].find_one({"name": f["name"]}):
            model = FuelType(**f)
            doc = model.model_dump()
            eff = doc["energy_content_kwh_per_unit"] * (doc["genset_efficiency_pct"] / 100.0)
            doc["effective_kwh_per_unit"] = round(eff, 4)
            doc["units_per_kwh"] = round(1 / eff, 4) if eff > 0 else None
            doc["last_reviewed_date"] = date.today().isoformat()
            doc["created_at"] = datetime.now(timezone.utc).isoformat()
            await _db[COLLECTIONS["fuel"]].insert_one(doc)
    seeded["fuel"] = len(fuels)

    # Addon groups (Change 3)
    addon_groups = [
        {"name": "Safety & Protection", "display_order": 10, "description": "Surge protection devices, additional earthing, fire safety gear."},
        {"name": "Monitoring",          "display_order": 20, "description": "Wi-Fi datalogger, cloud-monitoring subscription, energy meter."},
        {"name": "Structure Upgrades",  "display_order": 30, "description": "Elevated mounting frames, cyclone-rated bolts, custom pergolas."},
        {"name": "Electrical Extras",   "display_order": 40, "description": "Additional MCBs, changeover switches, isolation transformers."},
        {"name": "Civil Work",          "display_order": 50, "description": "Foundation, plinth, cable trenching, cable trays."},
        {"name": "Water & Plumbing",    "display_order": 60, "description": "Tank, plumbing fittings, foot-valve, GI riser pipe — pump systems only."},
        {"name": "Service & AMC",       "display_order": 70, "description": "Annual maintenance contract, extended warranty, insurance."},
        {"name": "Miscellaneous",       "display_order": 99, "description": "Uncategorised add-ons."},
    ]
    for g in addon_groups:
        if not await _db[COLLECTIONS["addon_group"]].find_one({"name": g["name"]}):
            model = AddonGroup(**g)
            doc = model.model_dump()
            doc["created_at"] = datetime.now(timezone.utc).isoformat()
            await _db[COLLECTIONS["addon_group"]].insert_one(doc)
    seeded["addon_group"] = len(addon_groups)

    return {"message": "seeded", "seeded": seeded}


# ---------------------------------------------------------------------------
# ADD-ON GROUPS (Change 3) — dedicated list route because they're used inline
# ---------------------------------------------------------------------------
@router.get("/addon-groups")
async def list_addon_groups(request: Request):
    await _current_user(request)
    docs = await _db[COLLECTIONS["addon_group"]].find({"active": True}).sort("display_order", 1).to_list(200)
    return [_clean_doc(d) for d in docs]


# ---------------------------------------------------------------------------
# ATTACH — this is called from server.py
# ---------------------------------------------------------------------------
def attach(app_router, db_handle, get_current_user_fn):
    bind(db_handle, get_current_user_fn)
    app_router.include_router(router)
