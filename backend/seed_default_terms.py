"""Iter 46 Change 3 — seed one active 'Standard Terms' template per document
category (quotation/invoice/amc) if none exists yet, so PDFs never fall back
to hardcoded in-code terms. Idempotent — safe to re-run."""
import asyncio
import os
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

QUOTATION_CONTENT = """<ol>
<li>This quotation is valid for 30 days from the date of issue.</li>
<li>50% advance payment required to confirm the order.</li>
<li>Balance payment due upon installation completion.</li>
<li>Installation timeline: 7-14 working days after material delivery.</li>
<li>5-year warranty on installation workmanship.</li>
<li>Panel warranty as per manufacturer terms (typically 25 years).</li>
<li>Inverter warranty as per manufacturer terms.</li>
<li>All prices are subject to change without prior notice.</li>
<li>Any additional civil work will be charged extra.</li>
<li>Net metering application fees not included.</li>
</ol>"""

INVOICE_CONTENT = """<ol>
<li>Payment terms are as stated on this invoice; interest may apply on overdue balances.</li>
<li>Goods once sold under this invoice are not returnable except for manufacturing defects reported within 7 days.</li>
<li>Warranty on equipment supplied is as per the original manufacturer's terms, not this invoice.</li>
<li>Any dispute regarding this invoice must be raised in writing within 15 days of the invoice date.</li>
<li>All disputes are subject to the exclusive jurisdiction of the courts at the company's registered office location.</li>
<li>This is a computer-generated invoice and is valid without a physical signature.</li>
</ol>"""

AMC_CONTENT = """<ol>
<li>This AMC contract covers preventive maintenance visits as per the agreed frequency; it does not cover physical damage, theft, or acts of god.</li>
<li>Consumables and parts replaced during a visit are billed separately unless explicitly included in the contract value.</li>
<li>Response time for breakdown calls is best-effort and subject to site accessibility and technician availability.</li>
<li>Renewal is not automatic; a fresh contract must be signed before the expiry date to continue coverage.</li>
<li>All disputes are subject to the exclusive jurisdiction of the courts at the company's registered office location.</li>
</ol>"""

DEFAULTS = [
    ("quotation", "Standard Terms & Conditions", QUOTATION_CONTENT),
    ("invoice", "Standard Invoice Terms", INVOICE_CONTENT),
    ("amc", "Standard AMC Terms", AMC_CONTENT),
]


async def main():
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    for category, title, content in DEFAULTS:
        existing = await db.terms_conditions.find_one({"category": category, "language": "en"})
        if existing:
            print(f"[skip] '{category}' already has a template: {existing.get('title')}")
            continue
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "title": title, "content": content, "version": 1, "is_active": True,
            "language": "en", "category": category,
            "created_by": "system", "created_by_name": "System (seeded)",
            "created_at": now, "updated_at": now,
        }
        res = await db.terms_conditions.insert_one(doc)
        print(f"[seeded] '{category}' -> {title} (id={res.inserted_id})")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
