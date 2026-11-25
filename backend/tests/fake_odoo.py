"""A small fake Odoo for tests: JSON-2 (Odoo 19) and JSON-RPC (Odoo 14–18) over the same in-memory records.

    from tests.fake_odoo import FakeOdoo
    fake = FakeOdoo(mode="json2")          # or "jsonrpc"
    odoo_sync.TRANSPORT = httpx.ASGITransport(app=fake.app)

Run it as a server for a browser walk-through:  python -m tests.fake_odoo 8069
"""
from __future__ import annotations

import copy
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

KEY = "a1" * 20          # the fake's valid API key (40 hex characters)
DB = "sensoper-test"
LOGIN = "admin@sensoper.in"


def _ts(minutes_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%d %H:%M:%S")


def F(string, type_, **kw):
    return {"string": string, "type": type_, "store": True, "readonly": False, **kw}


FIELDS: Dict[str, Dict[str, Any]] = {
    "res.users": {"name": F("Name", "char"), "login": F("Login", "char"), "company_id": F("Company", "many2one", relation="res.company"),
                  "share": F("Share user", "boolean"), "write_date": F("Last Updated on", "datetime")},
    "res.company": {"name": F("Name", "char")},
    "res.partner": {"name": F("Name", "char"), "display_name": F("Display Name", "char"), "is_company": F("Is a Company", "boolean"),
                    "parent_id": F("Related Company", "many2one", relation="res.partner"), "email": F("Email", "char"), "phone": F("Phone", "char"),
                    "mobile": F("Mobile", "char"), "street": F("Street", "char"), "street2": F("Street2", "char"), "city": F("City", "char"),
                    "zip": F("Zip", "char"), "state_id": F("State", "many2one", relation="res.country.state"), "vat": F("Tax ID", "char"),
                    "customer_rank": F("Customer Rank", "integer"), "supplier_rank": F("Supplier Rank", "integer"), "active": F("Active", "boolean"),
                    "comment": F("Notes", "html"), "category_id": F("Tags", "many2many", relation="res.partner.category"),
                    "x_studio_customer_code": F("Customer code", "char"), "image_1920": F("Image", "binary"),
                    "write_date": F("Last Updated on", "datetime"), "create_date": F("Created on", "datetime")},
    "account.tax": {"name": F("Tax Name", "char"), "amount": F("Amount", "float"), "amount_type": F("Tax Computation", "selection"),
                    "children_tax_ids": F("Children Taxes", "many2many", relation="account.tax")},
    "product.product": {"name": F("Name", "char"), "display_name": F("Display Name", "char"), "default_code": F("Internal Reference", "char"),
                        "list_price": F("Sales Price", "float"), "lst_price": F("Sales Price", "float"), "standard_price": F("Cost", "float"),
                        "categ_id": F("Product Category", "many2one", relation="product.category"), "l10n_in_hsn_code": F("HSN/SAC Code", "char"),
                        "taxes_id": F("Customer Taxes", "many2many", relation="account.tax"), "qty_available": F("Quantity On Hand", "float", store=False),
                        "type": F("Product Type", "selection", selection=[["consu", "Goods"], ["service", "Service"], ["combo", "Combo"]]),
                        "active": F("Active", "boolean"), "x_warranty_years": F("Warranty (years)", "integer"),
                        "write_date": F("Last Updated on", "datetime"), "create_date": F("Created on", "datetime")},
    "crm.stage": {"name": F("Stage Name", "char"), "sequence": F("Sequence", "integer"), "is_won": F("Is Won Stage?", "boolean")},
    "crm.lead": {"name": F("Opportunity", "char"), "contact_name": F("Contact Name", "char"), "partner_name": F("Company Name", "char"),
                 "partner_id": F("Customer", "many2one", relation="res.partner"), "email_from": F("Email", "char"), "phone": F("Phone", "char"),
                 "mobile": F("Mobile", "char"), "street": F("Street", "char"), "city": F("City", "char"), "zip": F("Zip", "char"),
                 "description": F("Notes", "html"), "stage_id": F("Stage", "many2one", relation="crm.stage"),
                 "user_id": F("Salesperson", "many2one", relation="res.users"), "expected_revenue": F("Expected Revenue", "monetary"),
                 "probability": F("Probability", "float"), "type": F("Type", "selection"), "active": F("Active", "boolean"),
                 "lost_reason_id": F("Lost Reason", "many2one", relation="crm.lost.reason"),
                 "activity_date_deadline": F("Next Activity Deadline", "date", store=False), "activity_summary": F("Next Activity Summary", "char", store=False),
                 "source_id": F("Source", "many2one", relation="utm.source"), "priority": F("Priority", "selection"),
                 "x_studio_roof_type": F("Roof type", "selection", selection=[["rcc", "RCC"], ["sheet", "Metal sheet"]]),
                 "write_date": F("Last Updated on", "datetime"), "create_date": F("Created on", "datetime")},
    "sale.order": {"name": F("Order Reference", "char"), "partner_id": F("Customer", "many2one", relation="res.partner"),
                   "date_order": F("Order Date", "datetime"), "validity_date": F("Expiration", "date"),
                   "state": F("Status", "selection", selection=[["draft", "Quotation"], ["sent", "Quotation Sent"], ["sale", "Sales Order"], ["cancel", "Cancelled"]]),
                   "amount_untaxed": F("Untaxed Amount", "monetary"), "amount_tax": F("Taxes", "monetary"), "amount_total": F("Total", "monetary"),
                   "user_id": F("Salesperson", "many2one", relation="res.users"), "note": F("Terms and conditions", "html"),
                   "opportunity_id": F("Opportunity", "many2one", relation="crm.lead"), "client_order_ref": F("Customer Reference", "char"),
                   "order_line": F("Order Lines", "one2many", relation="sale.order.line"),
                   "write_date": F("Last Updated on", "datetime"), "create_date": F("Created on", "datetime")},
    "sale.order.line": {"order_id": F("Order", "many2one", relation="sale.order"), "product_id": F("Product", "many2one", relation="product.product"),
                        "name": F("Description", "text"), "product_uom_qty": F("Quantity", "float"), "product_uom_id": F("Unit", "many2one", relation="uom.uom"),
                        "price_unit": F("Unit Price", "float"), "discount": F("Discount (%)", "float"), "tax_ids": F("Taxes", "many2many", relation="account.tax"),
                        "price_subtotal": F("Subtotal", "monetary"), "price_tax": F("Total Tax", "float"), "price_total": F("Total", "monetary"),
                        "display_type": F("Display Type", "selection"), "sequence": F("Sequence", "integer")},
    "x_site_survey": {"x_name": F("Site", "char"), "x_roof_type": F("Roof", "selection", selection=[["rcc", "RCC"], ["sheet", "Metal sheet"]]),
                      "x_area_sqft": F("Area (sq ft)", "float"), "x_tag_ids": F("Tags", "many2many", relation="x_tag"),
                      "x_photo": F("Photo", "binary"), "write_date": F("Last Updated on", "datetime")},
    "x_tag": {"x_name": F("Name", "char"), "display_name": F("Display Name", "char")},
    "ir.model": {"model": F("Model", "char"), "name": F("Model Description", "char"), "transient": F("Transient Model", "boolean")},
}


def seed() -> Dict[str, Dict[int, Dict[str, Any]]]:
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    tn = [598, "Tamil Nadu (IN)"]
    return {
        "res.users": {1: {"name": "Prathipan", "login": LOGIN, "company_id": [1, "Sensoper Controls & Renewables"], "share": False},
                      2: {"name": "Ravi Kumar", "login": "ravi@sensoper.in", "company_id": [1, "Sensoper Controls & Renewables"], "share": False}},
        "res.company": {1: {"name": "Sensoper Controls & Renewables"}},
        "res.partner": {
            10: {"name": "Murugan Textiles", "display_name": "Murugan Textiles", "is_company": True, "parent_id": False, "email": "accounts@murugantex.in",
                 "phone": False, "mobile": "+91 98765 43210", "street": "12, Mill Road", "street2": False, "city": "Erode", "zip": "638001", "state_id": tn,
                 "vat": "33AAACM1234A1Z5", "customer_rank": 2, "supplier_rank": 0, "active": True, "x_studio_customer_code": "C-101",
                 "write_date": _ts(300), "create_date": _ts(9000)},
            11: {"name": "Sky Power", "display_name": "Sky Power", "is_company": True, "parent_id": False, "email": "sales@skypower.in",
                 "phone": "0424 2251234", "mobile": "9443322110", "street": "Perundurai Road", "street2": False, "city": "Erode", "zip": "638011",
                 "state_id": tn, "vat": "33ABCDE9999F1Z2", "customer_rank": 0, "supplier_rank": 3, "active": True, "x_studio_customer_code": False,
                 "write_date": _ts(290), "create_date": _ts(9000)},
            12: {"name": "Kala Devi", "display_name": "Kala Devi", "is_company": False, "parent_id": False, "email": False, "phone": False,
                 "mobile": "98420 99999", "street": "4, Gandhi Street", "street2": "Bhavani", "city": "Erode", "zip": "638301", "state_id": tn, "vat": False,
                 "customer_rank": 1, "supplier_rank": 0, "active": True, "x_studio_customer_code": "C-102", "write_date": _ts(280), "create_date": _ts(9000)},
            13: {"name": "Website visitor", "display_name": "Website visitor", "is_company": False, "parent_id": False, "email": "x@y.z", "phone": False,
                 "mobile": False, "street": False, "street2": False, "city": False, "zip": False, "state_id": False, "vat": False, "customer_rank": 0,
                 "supplier_rank": 0, "active": True, "x_studio_customer_code": False, "write_date": _ts(270), "create_date": _ts(9000)},
        },
        "account.tax": {1: {"name": "GST 5%", "amount": 5, "amount_type": "group", "children_tax_ids": [2, 3]},
                        2: {"name": "CGST 2.5%", "amount": 2.5, "amount_type": "percent", "children_tax_ids": []},
                        3: {"name": "SGST 2.5%", "amount": 2.5, "amount_type": "percent", "children_tax_ids": []},
                        4: {"name": "GST 18%", "amount": 18, "amount_type": "group", "children_tax_ids": [5, 6]},
                        5: {"name": "CGST 9%", "amount": 9, "amount_type": "percent", "children_tax_ids": []},
                        6: {"name": "SGST 9%", "amount": 9, "amount_type": "percent", "children_tax_ids": []},
                        7: {"name": "IGST 18%", "amount": 18, "amount_type": "percent", "children_tax_ids": []}},
        "product.product": {
            100: {"name": "Waaree 605 W Panel", "display_name": "[WAR-605] Waaree 605 W Panel", "default_code": "WAR-605", "list_price": 17644.11,
                  "lst_price": 17644.11, "standard_price": 16040.1, "categ_id": [5, "All / Saleable / Solar Panels"], "l10n_in_hsn_code": "85414300",
                  "taxes_id": [1], "qty_available": 19, "type": "consu", "active": True, "x_warranty_years": 30, "write_date": _ts(250), "create_date": _ts(9000)},
            101: {"name": "Deye 5 kW Hybrid Inverter", "display_name": "[DEYE-5H] Deye 5 kW Hybrid Inverter", "default_code": "DEYE-5H", "list_price": 87360,
                  "lst_price": 87360, "standard_price": 78000, "categ_id": [6, "All / Inverters"], "l10n_in_hsn_code": "85044010", "taxes_id": [4],
                  "qty_available": 6, "type": "consu", "active": True, "x_warranty_years": 5, "write_date": _ts(240), "create_date": _ts(9000)},
            102: {"name": "Installation labour", "display_name": "Installation labour", "default_code": False, "list_price": 5000, "lst_price": 5000,
                  "standard_price": 0, "categ_id": [7, "All / Services"], "l10n_in_hsn_code": "995461", "taxes_id": [4], "qty_available": 0,
                  "type": "service", "active": True, "x_warranty_years": False, "write_date": _ts(230), "create_date": _ts(9000)},
        },
        "crm.stage": {1: {"name": "New", "sequence": 1, "is_won": False}, 2: {"name": "Qualified", "sequence": 2, "is_won": False},
                      3: {"name": "Proposition", "sequence": 3, "is_won": False}, 4: {"name": "Won", "sequence": 70, "is_won": True}},
        "crm.lead": {
            200: {"name": "30 kW rooftop for the factory", "contact_name": "Senthil", "partner_name": "Senthil Spinning Mills", "partner_id": False,
                  "email_from": "senthil@ssm.in", "phone": "+91 94430 11111", "mobile": False, "street": "SIPCOT", "city": "Perundurai", "zip": "638052",
                  "description": "<p>3-phase, <b>₹40k</b> bill</p>", "stage_id": [3, "Proposition"], "user_id": [2, "Ravi Kumar"], "expected_revenue": 1500000,
                  "probability": 60, "type": "opportunity", "active": True, "lost_reason_id": False, "activity_date_deadline": tomorrow,
                  "activity_summary": "Send the revised quote", "source_id": [1, "IndiaMART"], "priority": "2", "x_studio_roof_type": "sheet",
                  "write_date": _ts(200), "create_date": _ts(5000)},
            201: {"name": "Home 3 kW", "contact_name": "Lakshmi", "partner_name": False, "partner_id": False, "email_from": False, "phone": False,
                  "mobile": "9500012345", "street": False, "city": "Gobi", "zip": False, "description": False, "stage_id": [1, "New"], "user_id": False,
                  "expected_revenue": 0, "probability": 10, "type": "lead", "active": True, "lost_reason_id": False, "activity_date_deadline": False,
                  "activity_summary": False, "source_id": [2, "Website"], "priority": "0", "x_studio_roof_type": "rcc", "write_date": _ts(190), "create_date": _ts(4000)},
            202: {"name": "Pump 5 HP", "contact_name": "Ganesan", "partner_name": False, "partner_id": False, "email_from": False, "phone": "9790011223",
                  "mobile": False, "street": False, "city": "Sathy", "zip": False, "description": "Farm pump", "stage_id": [2, "Qualified"], "user_id": [1, "Prathipan"],
                  "expected_revenue": 250000, "probability": 0, "type": "opportunity", "active": False, "lost_reason_id": [1, "Too expensive"],
                  "activity_date_deadline": False, "activity_summary": False, "source_id": False, "priority": "1", "x_studio_roof_type": False,
                  "write_date": _ts(180), "create_date": _ts(3000)},
            203: {"name": "School 10 kW", "contact_name": "Principal", "partner_name": "Govt School", "partner_id": False, "email_from": False,
                  "phone": "9894455667", "mobile": False, "street": False, "city": "Erode", "zip": False, "description": False, "stage_id": [4, "Won"],
                  "user_id": [2, "Ravi Kumar"], "expected_revenue": 500000, "probability": 100, "type": "opportunity", "active": True, "lost_reason_id": False,
                  "activity_date_deadline": False, "activity_summary": False, "source_id": [3, "Referral"], "priority": "0", "x_studio_roof_type": "rcc",
                  "write_date": _ts(170), "create_date": _ts(2000)},
        },
        "sale.order": {
            300: {"name": "S00042", "partner_id": [10, "Murugan Textiles"], "date_order": _ts(160), "validity_date": (date.today() + timedelta(days=20)).isoformat(),
                  "state": "sent", "amount_untaxed": 254979.05, "amount_tax": 24105.75, "amount_total": 279084.80, "user_id": [2, "Ravi Kumar"],
                  "note": "<p>Delivery in 7 days</p>", "opportunity_id": [200, "30 kW rooftop for the factory"], "client_order_ref": "PO-77",
                  "order_line": [400, 401, 402], "write_date": _ts(160), "create_date": _ts(1000)},
            301: {"name": "S00043", "partner_id": [12, "Kala Devi"], "date_order": _ts(150), "validity_date": False, "state": "cancel",
                  "amount_untaxed": 5000, "amount_tax": 900, "amount_total": 5900, "user_id": [1, "Prathipan"], "note": False, "opportunity_id": False,
                  "client_order_ref": False, "order_line": [403], "write_date": _ts(150), "create_date": _ts(900)},
        },
        "sale.order.line": {
            402: {"order_id": [300, "S00042"], "product_id": False, "name": "Panels", "product_uom_qty": 0, "product_uom_id": False, "price_unit": 0,
                  "discount": 0, "tax_ids": [], "price_subtotal": 0, "price_tax": 0, "price_total": 0, "display_type": "line_section", "sequence": 1},
            400: {"order_id": [300, "S00042"], "product_id": [100, "[WAR-605] Waaree 605 W Panel"], "name": "[WAR-605] Waaree 605 W Panel\nTOPCon bifacial",
                  "product_uom_qty": 10, "product_uom_id": [1, "Units"], "price_unit": 17644.11, "discount": 5, "tax_ids": [1], "price_subtotal": 167619.05,
                  "price_tax": 8380.95, "price_total": 176000.00, "display_type": False, "sequence": 2},
            401: {"order_id": [300, "S00042"], "product_id": [101, "[DEYE-5H] Deye 5 kW Hybrid Inverter"], "name": "[DEYE-5H] Deye 5 kW Hybrid Inverter",
                  "product_uom_qty": 1, "product_uom_id": [1, "Units"], "price_unit": 87360, "discount": 0, "tax_ids": [4], "price_subtotal": 87360,
                  "price_tax": 15724.80, "price_total": 103084.80, "display_type": False, "sequence": 3},
            403: {"order_id": [301, "S00043"], "product_id": [102, "Installation labour"], "name": "Installation labour", "product_uom_qty": 1,
                  "product_uom_id": [2, "Job"], "price_unit": 5000, "discount": 0, "tax_ids": [4], "price_subtotal": 5000, "price_tax": 900,
                  "price_total": 5900, "display_type": False, "sequence": 1},
        },
        "x_tag": {1: {"x_name": "Priority", "display_name": "Priority"}, 2: {"x_name": "Shade", "display_name": "Shade"}},
        "x_site_survey": {
            500: {"x_name": "Murugan Textiles roof", "x_roof_type": "sheet", "x_area_sqft": 4200.0, "x_tag_ids": [1, 2], "x_photo": "AAAA", "write_date": _ts(100)},
            501: {"x_name": "Kala Devi house", "x_roof_type": "rcc", "x_area_sqft": 450.0, "x_tag_ids": [], "x_photo": False, "write_date": _ts(90)},
        },
        "ir.model": {1: {"model": "res.partner", "name": "Contact", "transient": False}, 2: {"model": "x_site_survey", "name": "Site survey", "transient": False},
                     3: {"model": "crm.lead", "name": "Lead/Opportunity", "transient": False}, 4: {"model": "x_tag", "name": "Tag", "transient": False}},
    }


class OdooFault(Exception):
    def __init__(self, status: int, name: str, message: str):
        self.status, self.name, self.message = status, name, message


class FakeOdoo:
    def __init__(self, mode: str = "json2"):
        self.mode = mode
        self.data = seed()
        self.calls: List[tuple] = []
        self.app = self._make_app()

    # -- record helpers --
    def touch(self, model: str, rid: int, **values) -> None:
        self.data[model][rid].update(values)
        self.data[model][rid]["write_date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    def _match(self, rec: Dict[str, Any], dom: list) -> bool:
        stack: List[bool] = []
        for term in reversed(dom or []):
            if term == "|":
                a, b = stack.pop(), stack.pop()
                stack.append(a or b)
            elif term == "&":
                a, b = stack.pop(), stack.pop()
                stack.append(a and b)
            elif term == "!":
                stack.append(not stack.pop())
            else:
                f, op, v = term
                cur = rec.get(f)
                if isinstance(cur, list) and len(cur) == 2 and isinstance(cur[0], int) and isinstance(cur[1], str):
                    cur = cur[0]
                if op == "=":
                    ok = (cur in (False, None)) if v is False else cur == v
                elif op == "!=":
                    ok = (cur not in (False, None)) if v is False else cur != v
                elif op == "in":
                    ok = cur in v
                elif op == "not in":
                    ok = cur not in v
                elif op == "ilike":
                    ok = str(v).lower() in str(cur or "").lower()
                else:
                    if cur in (False, None):
                        ok = False
                    else:
                        ok = {">": cur > v, ">=": cur >= v, "<": cur < v, "<=": cur <= v}[op]
                stack.append(ok)
        return all(stack)

    def _rows(self, model: str, dom: list, context: dict) -> List[Dict[str, Any]]:
        if model not in FIELDS:
            raise OdooFault(404, "KeyError", f"Object {model} doesn't exist")
        rows = []
        for rid, rec in self.data.get(model, {}).items():
            r = {"id": rid, **rec}
            if "active" in FIELDS[model] and context.get("active_test", True) and r.get("active") is False and not any(
                    isinstance(t, (list, tuple)) and t[0] == "active" for t in dom or []):
                continue
            if self._match(r, dom):
                rows.append(r)
        return rows

    def _pick(self, rows, fields):
        return [{"id": r["id"], **{f: copy.deepcopy(r.get(f, False)) for f in (fields or list(r.keys())) if f != "id"}} for r in rows]

    def call(self, model: str, method: str, args: list, kw: dict) -> Any:
        self.calls.append((model, method))
        ctx = kw.get("context") or {}
        if method == "fields_get":
            if model not in FIELDS:
                raise OdooFault(404, "KeyError", f"Object {model} doesn't exist")
            return copy.deepcopy(FIELDS[model])
        if method == "context_get":
            return {"lang": "en_IN", "tz": "Asia/Kolkata", "uid": 1}
        if method == "search_count":
            return len(self._rows(model, args[0] if args else kw.get("domain") or [], ctx))
        if method == "search_read":
            dom = args[0] if args else kw.get("domain") or []
            rows = self._rows(model, dom, ctx)
            order = (kw.get("order") or "id asc").split(",")
            for part in reversed(order):
                bits = part.strip().split()
                if not bits:
                    continue
                f, desc = bits[0], len(bits) > 1 and bits[1].lower() == "desc"
                rows.sort(key=lambda r: (r.get(f) is False or r.get(f) is None, str(r.get(f)) if not isinstance(r.get(f), (int, float)) else r.get(f)), reverse=desc)
            off, lim = int(kw.get("offset") or 0), kw.get("limit")
            rows = rows[off: off + lim] if lim else rows[off:]
            fields = kw.get("fields") or list(FIELDS[model])
            return self._pick(rows, fields)
        if method == "read":
            ids = args[0] if args else kw.get("ids") or []
            fields = kw.get("fields") or list(FIELDS[model])
            out = []
            for i in ids:
                if i in self.data.get(model, {}):
                    rec = {"id": i, **self.data[model][i]}
                    if "display_name" in fields and "display_name" not in rec:
                        rec["display_name"] = rec.get("name") or rec.get("x_name")
                    out.append(rec)
            return self._pick(out, fields)
        raise OdooFault(404, "AttributeError", f"The method '{method}' does not exist on {model}")

    def _make_app(self) -> FastAPI:
        app = FastAPI()

        @app.post("/json/2/{model}/{method}")
        async def json2(model: str, method: str, request: Request):
            if self.mode != "json2":
                return JSONResponse({"error": "not found"}, status_code=404)
            if request.headers.get("authorization", "") != f"bearer {KEY}":
                return JSONResponse({"name": "werkzeug.exceptions.Unauthorized", "message": "Invalid apikey", "arguments": [], "context": {}, "debug": ""}, status_code=401)
            body = await request.json()
            args = [body["domain"]] if "domain" in body else ([body["ids"]] if "ids" in body else [])
            kw = {k: v for k, v in body.items() if k not in ("domain", "ids")}
            try:
                return JSONResponse(self.call(model, method, args, kw))
            except OdooFault as e:
                return JSONResponse({"name": e.name, "message": e.message, "arguments": [], "context": {}, "debug": ""}, status_code=e.status)

        @app.get("/web/version")
        async def version():
            return {"version": "19.0" if self.mode == "json2" else "18.0", "version_info": [19, 0, 0, "final", 0, ""]}

        @app.post("/jsonrpc")
        async def jsonrpc(request: Request):
            body = await request.json()
            p = body.get("params") or {}
            service, method, args = p.get("service"), p.get("method"), p.get("args") or []

            def ok(result):
                return {"jsonrpc": "2.0", "id": body.get("id"), "result": result}

            def err(name, message):
                return {"jsonrpc": "2.0", "id": body.get("id"), "error": {"code": 200, "message": "Odoo Server Error", "data": {"name": name, "message": message}}}
            if service == "common" and method == "version":
                return ok({"server_version": "18.0", "server_version_info": [18, 0, 0, "final", 0, ""]})
            if service == "common" and method == "authenticate":
                db, login, key = args[0], args[1], args[2]
                if db != DB:
                    return err("psycopg2.OperationalError", f'database "{db}" does not exist')
                return ok(1 if (login == LOGIN and key == KEY) else False)
            if service == "db" and method == "list":
                return ok([DB])
            if service == "object" and method == "execute_kw":
                db, uid, key, model, meth = args[:5]
                a = args[5] if len(args) > 5 else []
                kw = args[6] if len(args) > 6 else {}
                if db != DB or uid != 1 or key != KEY:
                    return err("odoo.exceptions.AccessDenied", "Access Denied")
                try:
                    return ok(self.call(model, meth, a, kw))
                except OdooFault as e:
                    return err(e.name, e.message)
            return err("KeyError", "unknown service")
        return app


if __name__ == "__main__":   # a real server for the browser walk-through
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8069
    uvicorn.run(FakeOdoo(sys.argv[2] if len(sys.argv) > 2 else "json2").app, host="127.0.0.1", port=port, log_level="warning")
