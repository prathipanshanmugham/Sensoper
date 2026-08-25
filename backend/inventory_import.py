"""Inventory bulk-import helpers — column alias matching, header detection,
value cleaning and per-row validation. Pure functions, no DB access, so they
can be unit-tested and reused by both the preview and commit endpoints.
"""
from __future__ import annotations
import re
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

REQUIRED_CANONICAL = ["name", "sku_code", "category", "quantity", "unit_price"]

# canonical field -> accepted header spellings (already lowercased/underscored on our side)
COLUMN_ALIASES: Dict[str, List[str]] = {
    "name": ["name", "item_name", "item", "product", "product_name", "description", "particulars"],
    "sku_code": ["sku_code", "sku", "sku_no", "sku_number", "item_code", "code", "product_code"],
    "category": ["category", "cat", "type", "item_type"],
    "quantity": ["quantity", "qty", "stock", "stock_qty", "current_stock", "in_stock"],
    "unit_price": ["unit_price", "price", "rate", "unit_rate", "selling_price", "mrp", "cost"],
    "reorder_level": ["reorder_level", "reorder", "min_stock", "minimum_stock", "reorder_point"],
    "supplier": ["supplier", "vendor", "supplier_name", "vendor_name"],
    "gst_percentage": ["gst_percentage", "gst", "gst_%", "tax_%", "tax", "gst_pct"],
    "hsn_code": ["hsn_code", "hsn", "hsn_no"],
    "margin_pct": ["margin_pct", "margin", "margin_%"],
    "zone": ["zone"],
    "aisle": ["aisle"],
    "shelf": ["shelf"],
    "rack": ["rack"],
    "bin_location": ["bin_location", "bin", "bin_no"],
    "procurement_date": ["procurement_date", "purchase_date", "date"],
    "active": ["active", "status", "is_active"],
    "image_url": ["image_url", "image", "photo_url"],
}


def normalize_col(c: Any) -> str:
    """'SKU Code' -> 'sku_code' ; 'GST %' -> 'gst_%'"""
    s = str(c).strip().lower()
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"[^a-z0-9_%]", "", s)
    return s


def build_column_mapping(raw_columns: List[str], overrides: Optional[Dict[str, str]] = None) -> Dict[str, Optional[str]]:
    """Returns {canonical: raw_column_name_or_None} for every alias key we care about."""
    norm_to_raw = {normalize_col(c): c for c in raw_columns}
    mapping: Dict[str, Optional[str]] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        found = None
        for alias in aliases:
            if alias in norm_to_raw:
                found = norm_to_raw[alias]
                break
        mapping[canonical] = found
    if overrides:
        for canonical, raw_col in overrides.items():
            if raw_col:
                match = next((c for c in raw_columns if c == raw_col), raw_col)
                mapping[canonical] = match
    return mapping


def clean_number(val: Any) -> Optional[float]:
    """'₹1,250.00' -> 1250.0 ; NaN/blank -> None"""
    if val is None:
        return None
    try:
        import pandas as _pd
        if isinstance(val, float) and _pd.isna(val):
            return None
    except Exception:
        pass
    s = str(val).strip()
    if s == "" or s.lower() == "nan":
        return None
    s = re.sub(r"[₹$,\s]", "", s)
    try:
        return float(s)
    except ValueError:
        return None


def read_spreadsheet(raw: bytes, filename: str):
    """Reads csv/xlsx, auto-detects a title row above the real header, drops blank rows.
    Returns (dataframe, raw_columns)."""
    import pandas as _pd
    fname = (filename or "").lower()
    is_csv = fname.endswith(".csv")

    def _load(skiprows=0):
        if is_csv:
            return _pd.read_csv(BytesIO(raw), skiprows=skiprows)
        return _pd.read_excel(BytesIO(raw), engine="openpyxl", skiprows=skiprows)

    df = _load(0)
    df.columns = [str(c).strip() for c in df.columns]
    best_df, best_score = df, _score_header(df.columns)
    # Scan up to 5 rows down for a better-looking header (handles a title row above headers)
    for skip in range(1, 6):
        try:
            candidate = _load(skip)
            candidate.columns = [str(c).strip() for c in candidate.columns]
        except Exception:
            break
        score = _score_header(candidate.columns)
        if score > best_score:
            best_df, best_score = candidate, score
        if score >= 4:
            break
    df = best_df.dropna(how="all").reset_index(drop=True)
    return df, list(df.columns)


def _score_header(columns) -> int:
    norm = {normalize_col(c) for c in columns}
    hits = 0
    for aliases in COLUMN_ALIASES.values():
        if norm & set(aliases):
            hits += 1
    return hits


def validate_rows(df, mapping: Dict[str, Optional[str]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Returns (clean_rows, error_rows). Each clean_row carries every canonical field.
    Flags duplicate SKUs within the file (keeps first, flags subsequent as errors)."""
    clean_rows, error_rows = [], []
    seen_skus: Dict[str, int] = {}

    def _get(row, canonical, default=None):
        col = mapping.get(canonical)
        if col is None or col not in row:
            return default
        v = row[col]
        try:
            import pandas as _pd
            if isinstance(v, float) and _pd.isna(v):
                return default
        except Exception:
            pass
        if v is None:
            return default
        s = str(v).strip()
        return s if s and s.lower() != "nan" else default

    for idx, row in df.iterrows():
        excel_row = idx + 2  # header row + 1-index
        name = _get(row, "name")
        sku = _get(row, "sku_code")
        category = _get(row, "category")
        qty_raw = _get(row, "quantity")
        price_raw = _get(row, "unit_price")

        missing = []
        if not name: missing.append("name")
        if not sku: missing.append("sku_code")
        if not category: missing.append("category")
        if qty_raw is None: missing.append("quantity")
        if price_raw is None: missing.append("unit_price")
        if missing:
            error_rows.append({"row": int(excel_row), "error": f"Missing required value(s): {', '.join(missing)}",
                                "column": ", ".join(missing), "value": None})
            continue

        quantity = clean_number(qty_raw)
        unit_price = clean_number(price_raw)
        if quantity is None:
            error_rows.append({"row": int(excel_row), "error": f'"{qty_raw}" is not a valid quantity', "column": "quantity", "value": qty_raw})
            continue
        if unit_price is None:
            error_rows.append({"row": int(excel_row), "error": f'"{price_raw}" is not a valid price', "column": "unit_price", "value": price_raw})
            continue
        if quantity < 0 or unit_price < 0:
            error_rows.append({"row": int(excel_row), "error": "quantity and unit_price must be at least 0", "column": "quantity/unit_price", "value": None})
            continue

        sku_key = sku.strip().lower()
        if sku_key in seen_skus:
            error_rows.append({"row": int(excel_row), "error": f"Duplicate SKU '{sku}' — first seen on row {seen_skus[sku_key]}", "column": "sku_code", "value": sku})
            continue
        seen_skus[sku_key] = excel_row

        active_raw = _get(row, "active", "true")
        clean_rows.append({
            "row": int(excel_row),
            "name": name,
            "sku_code": sku,
            "category": category,
            "quantity": int(quantity),
            "unit_price": float(unit_price),
            "reorder_level": int(clean_number(_get(row, "reorder_level")) or 10),
            "supplier": _get(row, "supplier", "") or "",
            "gst_percentage": float(clean_number(_get(row, "gst_percentage")) if _get(row, "gst_percentage") is not None else 18.0) or 18.0,
            "hsn_code": _get(row, "hsn_code"),
            "margin_pct": float(clean_number(_get(row, "margin_pct")) or 0.0),
            "zone": _get(row, "zone", "") or "",
            "aisle": _get(row, "aisle", "") or "",
            "shelf": _get(row, "shelf", "") or "",
            "rack": _get(row, "rack", "") or "",
            "bin_location": _get(row, "bin_location", "") or "",
            "procurement_date": _get(row, "procurement_date"),
            "active": str(active_raw).strip().lower() in ("true", "1", "yes", "y"),
            "image_url": _get(row, "image_url"),
        })
    return clean_rows, error_rows
