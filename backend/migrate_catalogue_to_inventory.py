"""Iteration 45 — one-time migration: catalogue product collections -> inventory_items.

Moves real (non-TEST, active) panel/inverter/battery/pump/structure products into
inventory_items (adding a `specs` sub-object for electrical fields the calculator needs),
then the caller drops the source collections. Idempotent: skips a product if it already
has a linked_inventory_item_id pointing to an existing inventory item.

Run once: `python migrate_catalogue_to_inventory.py`
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

IS_TEST = lambda s: bool(s) and "test" in str(s).lower()

CATEGORY_MAP = {"panel": "solar_panels", "inverter": "inverters", "battery": "batteries", "pump": "pumps"}
STRUCTURE_SUBCAT_MAP = {"structure": "mounting_structures", "cable": "cables_accessories"}  # else -> bos

PANEL_SPEC_FIELDS = ["wattage", "technology", "cell_type", "efficiency_pct", "voc", "vmp", "isc", "imp",
                      "temp_coefficient_voc", "dimensions_mm", "area_sqft", "weight_kg", "tier", "is_dcr",
                      "warranty_product_years", "warranty_performance_years"]
INVERTER_SPEC_FIELDS = ["type", "rated_kw", "max_dc_input_kw", "mppt_count", "mppt_voltage_min",
                         "mppt_voltage_max", "max_input_voltage", "max_input_current_per_mppt",
                         "output_phase", "output_voltage", "battery_compatible", "battery_voltage",
                         "efficiency_pct", "warranty_years"]
BATTERY_SPEC_FIELDS = ["chemistry", "capacity_ah", "voltage", "kwh", "dod_pct", "cycles", "warranty_years"]
PUMP_SPEC_FIELDS = ["hp", "kw", "voltage", "phase", "ac_or_dc", "pump_type", "body_diameter_mm",
                     "min_bore_casing_mm", "max_head_m", "max_discharge_lph", "curve_points",
                     "controller_make", "controller_model", "controller_type", "controller_input_v_min",
                     "controller_input_v_max", "controller_input_v_absolute_max",
                     "controller_input_current_max", "motor_efficiency_pct", "pump_efficiency_pct",
                     "warranty_years"]
STRUCTURE_SPEC_FIELDS = ["category", "mounting_surface", "height_ft", "material"]


def _specs(doc, fields):
    return {f: doc.get(f) for f in fields if doc.get(f) is not None}


def _sku(prefix, doc, name_field="model"):
    base = f"{prefix}-{doc.get('make', doc.get('name', ''))}-{doc.get(name_field, '')}"
    return "".join(c for c in base.upper().replace(" ", "-") if c.isalnum() or c == "-")[:40] or f"{prefix}-{str(doc['_id'])[-6:]}"


async def migrate():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    stats = {"migrated": 0, "skipped_test": 0, "skipped_existing_link": 0, "skipped_inactive": 0}

    async def migrate_collection(coll_name, cat, spec_fields, name_field="model", unit_field="purchase_price"):
        cursor = db[coll_name].find({})
        async for doc in cursor:
            label = doc.get("make", "") + " " + doc.get(name_field, doc.get("name", ""))
            if IS_TEST(doc.get("make")) or IS_TEST(doc.get("model")) or IS_TEST(doc.get("name")) or IS_TEST(doc.get("supplier")):
                stats["skipped_test"] += 1
                continue
            if not doc.get("active", True):
                stats["skipped_inactive"] += 1
                continue
            linked_id = doc.get("linked_inventory_item_id")
            if linked_id:
                existing = await db.inventory_items.find_one({"_id": linked_id if not isinstance(linked_id, str) else __import__("bson").ObjectId(linked_id)}) if linked_id else None
                if existing:
                    stats["skipped_existing_link"] += 1
                    continue

            if cat == "structure":
                sub = STRUCTURE_SUBCAT_MAP.get(doc.get("category", "structure"), "bos")
                name = doc.get("name", "Structure item")
                sku = _sku("BOS", doc, "name")
            else:
                sub = CATEGORY_MAP[cat]
                name = f"{doc.get('make', '')} {doc.get(name_field, '')}".strip()
                sku = _sku(cat[:3].upper(), doc, name_field)

            purchase_price = doc.get("purchase_price", 0) or 0
            inv_doc = {
                "name": name or f"Migrated {cat} item",
                "sku_code": sku,
                "category": sub,
                "quantity": 0,
                "unit_price": purchase_price,
                "supplier": doc.get("supplier", ""),
                "gst_percentage": 18.0,
                "hsn_code": None,
                "reorder_level": 10,
                "image_url": None,
                "margin_pct": doc.get("margin_pct") or 15,
                "active": True,
                "qc_checklist": [],
                "procurement_date": None,
                "addon_group": None,
                "location_id": None,
                "specs": _specs(doc, spec_fields),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "migrated_from": {"collection": coll_name, "original_id": str(doc["_id"])},
            }
            await db.inventory_items.insert_one(inv_doc)
            stats["migrated"] += 1
            print(f"  + {cat}: {label.strip()} -> inventory_items ({sub})")

    await migrate_collection("panel_products", "panel", PANEL_SPEC_FIELDS)
    await migrate_collection("inverter_products", "inverter", INVERTER_SPEC_FIELDS)
    await migrate_collection("battery_products", "battery", BATTERY_SPEC_FIELDS)
    await migrate_collection("pump_products", "pump", PUMP_SPEC_FIELDS)
    await migrate_collection("structure_products", "structure", STRUCTURE_SPEC_FIELDS, name_field="name")

    print("\n=== Migration summary ===")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    client.close()
    return stats


if __name__ == "__main__":
    result = asyncio.run(migrate())
    sys.exit(0)
