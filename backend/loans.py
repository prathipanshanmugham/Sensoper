"""Loans (Oct 2026): the company's borrowings — term loans, vehicle and equipment loans, working-capital limits.

* Each loan keeps its terms (amount, rate, tenure, EMI day) and the payments made against it.
* An EMI payment is split into interest (balance × monthly rate) and principal; a prepayment is all principal;
  interest-only and charges payments don't reduce the balance; a drawdown (OD / CC limit) raises it.
* The schedule shows what is still to come (EMI, interest, principal, balance) from today's balance.
* EMIs plan bell notes 3 days before; the event calendar shows every EMI date.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Callable, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import notify

LOAN_TYPES = ("term_loan", "working_capital", "od_cc", "vehicle", "equipment", "business", "property", "other")
REVOLVING = ("working_capital", "od_cc")
PAY_KINDS = ("emi", "prepayment", "interest", "charges", "drawdown", "repayment")


def _f(v, d: float = 0.0) -> float:
    try:
        x = float(v)
        return x if math.isfinite(x) else d
    except (TypeError, ValueError):
        return d


def emi_amount(principal: float, annual_rate_pct: float, months: int) -> float:
    """Equal monthly instalment on a reducing balance. Pure.  EMI = P·r·(1+r)^n / ((1+r)^n − 1), r = rate/12."""
    p, n = max(_f(principal), 0.0), max(int(months or 0), 0)
    if p <= 0 or n <= 0:
        return 0.0
    r = _f(annual_rate_pct) / 1200
    if r == 0:
        return round(p / n, 2)
    k = (1 + r) ** n
    return round(p * r * k / (k - 1), 2)


def add_months(d: date, months: int, day: Optional[int] = None) -> date:
    m = d.month - 1 + months
    y, m = d.year + m // 12, m % 12 + 1
    last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
    return date(y, m, min(day or d.day, last))


def schedule(balance: float, annual_rate_pct: float, emi: float, first_due: date, max_rows: int = 480, emi_day: Optional[int] = None) -> List[Dict[str, Any]]:
    """From a balance, the instalments to come until it is paid off (the last one is smaller). Pure."""
    rows: List[Dict[str, Any]] = []
    bal, r = max(_f(balance), 0.0), _f(annual_rate_pct) / 1200
    if bal <= 0 or emi <= 0:
        return rows
    if emi <= bal * r:   # the EMI doesn't even cover the interest — the loan would never close
        return rows
    d = first_due
    for i in range(max_rows):
        interest = round(bal * r, 2)
        pay = round(min(emi, bal + interest), 2)
        principal = round(pay - interest, 2)
        bal = round(max(bal - principal, 0.0), 2)
        rows.append({"n": i + 1, "date": d.isoformat(), "emi": pay, "interest": interest, "principal": principal, "balance": bal})
        if bal <= 0.5:
            rows[-1]["balance"] = 0.0
            break
        d = add_months(d, 1, emi_day)
    return rows


def apply_payments(loan: Dict[str, Any], payments: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Walk the payments in date order and split each one; return the balance and the totals. Pure.

    emi        → interest = balance × monthly rate (for each month since the last EMI, at least one), rest is principal
    prepayment → all principal          repayment (OD/CC) → all principal
    interest   → all interest            charges → neither          drawdown → balance goes up"""
    r = _f(loan.get("interest_rate")) / 1200
    bal = _f(loan.get("disbursed_amount")) or _f(loan.get("principal"))
    last = notify.to_date(loan.get("disbursal_date"))
    totals = {"interest_paid": 0.0, "principal_paid": 0.0, "charges_paid": 0.0, "drawn": 0.0}
    split = []
    for p in sorted(payments, key=lambda x: (str(x.get("date")), str(x.get("created_at") or ""))):
        amt, kind, d = _f(p.get("amount")), p.get("kind"), notify.to_date(p.get("date"))
        interest = principal = 0.0
        if kind == "emi":
            months = 1
            if last and d:
                months = max(1, round((d - last).days / 30.4))
            interest = round(min(amt, bal * r * months), 2)
            principal = round(min(amt - interest, bal), 2)
            last = d or last
        elif kind in ("prepayment", "repayment"):
            principal = round(min(amt, bal), 2)
        elif kind == "interest":
            interest = amt
        elif kind == "drawdown":
            bal += amt
            totals["drawn"] += amt
        if kind == "charges":
            totals["charges_paid"] += amt
        bal = round(max(bal - principal, 0.0), 2)
        totals["interest_paid"] += interest
        totals["principal_paid"] += principal
        split.append({**p, "interest_part": interest, "principal_part": principal, "balance_after": bal})
    return {"balance": round(bal, 2), **{k: round(v, 2) for k, v in totals.items()}, "payments": split}


def next_due(loan: Dict[str, Any], today: date) -> Optional[date]:
    """The next EMI date on or after today (EMI day each month, from the first EMI date). Pure."""
    first = notify.to_date(loan.get("first_emi_date"))
    if not first:
        return None
    if first >= today:
        return first
    day = int(loan.get("emi_day") or first.day)
    d = add_months(date(today.year, today.month, 1), 0, day)
    return d if d >= today else add_months(d, 1, day)


def fy_start(today: date) -> date:
    return date(today.year if today.month >= 4 else today.year - 1, 4, 1)


class LoanIn(BaseModel):
    lender: str = Field(min_length=2, max_length=100)
    loan_type: str = "term_loan"
    reference: Optional[str] = None                 # the bank's loan / account reference
    purpose: Optional[str] = None
    principal: float = Field(gt=0)                  # sanctioned amount (limit for OD / CC)
    disbursed_amount: Optional[float] = None
    disbursal_date: str
    interest_rate: float = Field(ge=0, le=60)        # % a year
    rate_type: str = "fixed"                         # fixed | floating
    tenure_months: Optional[int] = Field(default=None, ge=1, le=480)
    emi_amount: Optional[float] = None               # leave blank to work it out
    emi_day: Optional[int] = Field(default=None, ge=1, le=31)
    first_emi_date: Optional[str] = None
    processing_fee: Optional[float] = None
    security: Optional[str] = None
    contact: Optional[str] = None
    documents: List[str] = []
    notes: Optional[str] = None


class PaymentIn(BaseModel):
    date: str
    amount: float = Field(gt=0)
    kind: str = "emi"
    reference: Optional[str] = None
    notes: Optional[str] = None


class CloseIn(BaseModel):
    closed_on: str
    how: str = "closed"                              # closed | foreclosed
    notes: Optional[str] = None


def create_router(db, get_current_user, require_role, create_audit_log, get_permissions, check_module_permission: Callable):
    router = APIRouter()

    async def _gate(request: Request, action: str = "view") -> Dict[str, Any]:
        user = await get_current_user(request)
        if user["role"] != "admin" and not await check_module_permission(user, "module_loans", action):
            raise HTTPException(status_code=403, detail="Your role can't see loans. An admin can change this in Settings → Permissions.")
        return user

    def _oid(v: str) -> ObjectId:
        if not v or not ObjectId.is_valid(v):
            raise HTTPException(status_code=404, detail="Loan not found")
        return ObjectId(v)

    async def _loan(loan_id: str) -> Dict[str, Any]:
        l = await db.loans.find_one({"_id": _oid(loan_id)})
        if not l:
            raise HTTPException(status_code=404, detail="Loan not found")
        return l

    def _clean(body: LoanIn) -> Dict[str, Any]:
        if body.loan_type not in LOAN_TYPES:
            raise HTTPException(status_code=400, detail="Unknown loan type")
        if body.rate_type not in ("fixed", "floating"):
            raise HTTPException(status_code=400, detail="Rate type must be fixed or floating")
        disb = notify.to_date(body.disbursal_date)
        if not disb:
            raise HTTPException(status_code=400, detail="Disbursal date must be a date (YYYY-MM-DD)")
        first = notify.to_date(body.first_emi_date) if body.first_emi_date else None
        if body.first_emi_date and not first:
            raise HTTPException(status_code=400, detail="First EMI date must be a date (YYYY-MM-DD)")
        disbursed = _f(body.disbursed_amount) or body.principal
        if disbursed > body.principal * 1.0001 and body.loan_type not in REVOLVING:
            raise HTTPException(status_code=400, detail="Disbursed amount can't be more than the sanctioned amount")
        doc = {**body.model_dump(), "lender": body.lender.strip(), "disbursed_amount": round(disbursed, 2)}
        if body.loan_type not in REVOLVING:
            if not body.tenure_months:
                raise HTTPException(status_code=400, detail="Enter the tenure in months")
            emi = _f(body.emi_amount) or emi_amount(disbursed, body.interest_rate, body.tenure_months)
            if emi <= disbursed * body.interest_rate / 1200:
                raise HTTPException(status_code=400, detail="That EMI doesn't cover the monthly interest — check the EMI or the rate")
            doc["emi_amount"] = round(emi, 2)
            first = first or add_months(disb, 1, body.emi_day)
            doc["first_emi_date"] = first.isoformat()
            doc["emi_day"] = body.emi_day or first.day
            if first < disb:
                raise HTTPException(status_code=400, detail="The first EMI can't be before the disbursal")
        else:
            doc["emi_amount"] = None
        doc["documents"] = [p for p in body.documents if isinstance(p, str)][:12]
        return doc

    async def _payments(loan_id: str) -> List[Dict[str, Any]]:
        return [{**{k: v for k, v in p.items() if k != "_id"}, "id": str(p["_id"])} async for p in db.loan_payments.find({"loan_id": loan_id})]

    def _summary(l: Dict[str, Any], pays: List[Dict[str, Any]], today: date) -> Dict[str, Any]:
        st = apply_payments(l, pays)
        out = {k: v for k, v in l.items() if k != "_id"}
        out["id"] = str(l["_id"])
        out.update({"outstanding": st["balance"] if l.get("status", "active") == "active" else 0.0, "interest_paid": st["interest_paid"],
                    "principal_paid": st["principal_paid"], "charges_paid": st["charges_paid"], "payments_count": len(pays)})
        fy0 = fy_start(today).isoformat()
        out["interest_paid_fy"] = round(sum(p["interest_part"] for p in st["payments"] if str(p.get("date")) >= fy0), 2)
        nd = next_due(l, today) if l.get("status", "active") == "active" and l.get("emi_amount") and st["balance"] > 0 else None
        out["next_due"] = nd.isoformat() if nd else None
        # missed: EMI dates already passed with no EMI paid that month
        missed = []
        first = notify.to_date(l.get("first_emi_date"))
        if first and l.get("emi_amount") and l.get("status", "active") == "active" and st["balance"] > 0:
            paid_months = {str(p.get("date"))[:7] for p in pays if p.get("kind") in ("emi", "prepayment")}
            d, day = first, int(l.get("emi_day") or first.day)
            while d < today and len(missed) < 24:
                if d.isoformat()[:7] not in paid_months:
                    missed.append(d.isoformat())
                d = add_months(d, 1, day)
        out["missed_emis"] = missed
        if l.get("emi_amount") and st["balance"] > 0 and l.get("status", "active") == "active":
            sch = schedule(st["balance"], _f(l.get("interest_rate")), _f(l.get("emi_amount")), nd or today, emi_day=l.get("emi_day"))
            out["emis_left"] = len(sch)
            out["closes_on"] = sch[-1]["date"] if sch else None
            out["interest_to_come"] = round(sum(r["interest"] for r in sch), 2)
            out["interest_next_12m"] = round(sum(r["interest"] for r in sch[:12]), 2)
        else:
            out["emis_left"] = 0
            out["closes_on"] = None
            out["interest_to_come"] = round(st["balance"] * _f(l.get("interest_rate")) / 100, 2) if l.get("loan_type") in REVOLVING else 0.0
            out["interest_next_12m"] = out["interest_to_come"]
        out["utilisation_pct"] = round(st["balance"] / _f(l.get("principal")) * 100, 1) if l.get("loan_type") in REVOLVING and _f(l.get("principal")) else None
        return out

    async def _plan_notes(l: Dict[str, Any]) -> None:
        lid = str(l["_id"])
        await notify.clear(db, "loan_emi", "loan", lid)
        if l.get("status", "active") != "active" or not l.get("emi_amount"):
            return
        people = await notify.users_who_can(db, get_permissions, "module_loans")
        today = notify.today_ist()
        d = next_due(l, today)
        for _ in range(3):   # the next three EMIs; later ones are planned as payments come in
            if not d:
                break
            await notify.plan(db, kind="loan_emi", source_type="loan", source_id=lid, user_ids=people, tag=d.isoformat(),
                              title=f"EMI ₹{_f(l['emi_amount']):,.0f} to {l['lender']} on {d.strftime('%d %b')}",
                              message=f"{l.get('reference') or l['loan_type'].replace('_', ' ')} · keep the balance in the account",
                              link=f"/dashboard/loans?loan={lid}", notify_at=notify.morning_of(max(d - timedelta(days=3), today)))
            d = add_months(d, 1, l.get("emi_day"))

    @router.get("/loans")
    async def list_loans(request: Request, status: Optional[str] = None):
        await _gate(request)
        today = notify.today_ist()
        q = {"status": status} if status else {}
        pays: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        async for p in db.loan_payments.find({}):
            pays[p["loan_id"]].append({**{k: v for k, v in p.items() if k != "_id"}, "id": str(p["_id"])})
        rows = [_summary(l, pays.get(str(l["_id"]), []), today) async for l in db.loans.find(q).sort("disbursal_date", -1)]
        active = [r for r in rows if r.get("status", "active") == "active"]
        total_out = sum(r["outstanding"] for r in active)
        months = []
        d0 = date(today.year, today.month, 1)
        for i in range(12):
            m = add_months(d0, i, 1)
            months.append({"month": m.isoformat()[:7], "emi": 0.0, "interest": 0.0, "principal": 0.0})
        for l in active:
            if not l.get("emi_amount") or l["outstanding"] <= 0:
                continue
            for r in schedule(l["outstanding"], _f(l.get("interest_rate")), _f(l.get("emi_amount")), notify.to_date(l["next_due"]) or today, emi_day=l.get("emi_day")):
                k = r["date"][:7]
                row = next((m for m in months if m["month"] == k), None)
                if row:
                    row["emi"] += r["emi"]
                    row["interest"] += r["interest"]
                    row["principal"] += r["principal"]
        by_lender: Dict[str, float] = defaultdict(float)
        for r in active:
            by_lender[r["lender"]] += r["outstanding"]
        return {
            "rows": rows,
            "totals": {"active": len(active), "outstanding": round(total_out, 2),
                       "monthly_emi": round(sum(_f(r.get("emi_amount")) for r in active if r["outstanding"] > 0), 2),
                       "interest_paid_fy": round(sum(r["interest_paid_fy"] for r in rows), 2),
                       "interest_next_12m": round(sum(r["interest_next_12m"] for r in active), 2),
                       "avg_rate": round(sum(_f(r.get("interest_rate")) * r["outstanding"] for r in active) / total_out, 2) if total_out else None,
                       "missed": sum(len(r["missed_emis"]) for r in active),
                       "next_due": min((r["next_due"] for r in active if r.get("next_due")), default=None)},
            "next_12_months": [{**m, **{k: round(m[k], 2) for k in ("emi", "interest", "principal")}} for m in months],
            "by_lender": [{"lender": k, "outstanding": round(v, 2)} for k, v in sorted(by_lender.items(), key=lambda kv: -kv[1])],
        }

    @router.post("/loans")
    async def add_loan(body: LoanIn, request: Request):
        user = await _gate(request, "create")
        doc = {**_clean(body), "status": "active", "created_by": user["name"], "created_at": notify.now_utc().isoformat()}
        res = await db.loans.insert_one(doc)
        doc["_id"] = res.inserted_id
        await _plan_notes(doc)
        await create_audit_log(user["id"], user["name"], "loan_added", "loan", str(res.inserted_id), None,
                               {"lender": doc["lender"], "amount": doc["disbursed_amount"], "rate": doc["interest_rate"]})
        return _summary(doc, [], notify.today_ist())

    @router.post("/loans/emi-preview")
    async def emi_preview(request: Request):
        await _gate(request)
        b = await request.json()
        amt, rate, months = _f(b.get("amount")), _f(b.get("interest_rate")), int(_f(b.get("tenure_months")))
        emi = emi_amount(amt, rate, months)
        total = round(emi * months, 2)
        return {"emi": emi, "total_payable": total, "total_interest": round(total - amt, 2)}

    @router.get("/loans/{loan_id}")
    async def get_loan(loan_id: str, request: Request):
        await _gate(request)
        l = await _loan(loan_id)
        pays = await _payments(loan_id)
        today = notify.today_ist()
        out = _summary(l, pays, today)
        st = apply_payments(l, pays)
        out["payments"] = sorted(st["payments"], key=lambda p: str(p.get("date")), reverse=True)
        out["schedule"] = (schedule(out["outstanding"], _f(l.get("interest_rate")), _f(l.get("emi_amount")), notify.to_date(out["next_due"]) or today, emi_day=l.get("emi_day"))
                           if l.get("emi_amount") and out["outstanding"] > 0 else [])
        return out

    @router.put("/loans/{loan_id}")
    async def edit_loan(loan_id: str, body: LoanIn, request: Request):
        user = await _gate(request, "edit")
        cur = await _loan(loan_id)
        doc = _clean(body)
        doc["updated_at"] = notify.now_utc().isoformat()
        await db.loans.update_one({"_id": cur["_id"]}, {"$set": doc})
        fresh = await db.loans.find_one({"_id": cur["_id"]})
        await _plan_notes(fresh)
        await create_audit_log(user["id"], user["name"], "loan_updated", "loan", loan_id, {"rate": cur.get("interest_rate"), "emi": cur.get("emi_amount")},
                               {"rate": doc["interest_rate"], "emi": doc.get("emi_amount")})
        return _summary(fresh, await _payments(loan_id), notify.today_ist())

    @router.post("/loans/{loan_id}/payments")
    async def add_payment(loan_id: str, body: PaymentIn, request: Request):
        user = await _gate(request, "edit")
        l = await _loan(loan_id)
        if body.kind not in PAY_KINDS:
            raise HTTPException(status_code=400, detail="Unknown payment kind")
        d = notify.to_date(body.date)
        if not d:
            raise HTTPException(status_code=400, detail="Payment date must be a date (YYYY-MM-DD)")
        if d > notify.today_ist() + timedelta(days=1):
            raise HTTPException(status_code=400, detail="That date is in the future")
        if d < (notify.to_date(l.get("disbursal_date")) or d):
            raise HTTPException(status_code=400, detail="That date is before the loan was disbursed")
        if body.kind == "drawdown" and l.get("loan_type") not in REVOLVING:
            raise HTTPException(status_code=400, detail="Drawdowns are for working-capital / OD / CC limits")
        pays = await _payments(loan_id)
        st = apply_payments(l, pays)
        if body.kind == "drawdown" and st["balance"] + body.amount > _f(l.get("principal")) * 1.0001:
            raise HTTPException(status_code=400, detail=f"That goes over the limit of ₹{_f(l.get('principal')):,.0f}")
        if body.kind in ("prepayment", "repayment") and body.amount > st["balance"] + 1:
            raise HTTPException(status_code=400, detail=f"More than the balance of ₹{st['balance']:,.0f}")
        doc = {"loan_id": loan_id, "date": d.isoformat(), "amount": round(body.amount, 2), "kind": body.kind, "reference": body.reference,
               "notes": body.notes, "by": user["name"], "created_at": notify.now_utc().isoformat()}
        await db.loan_payments.insert_one(doc)
        await _plan_notes(l)
        await create_audit_log(user["id"], user["name"], f"loan_{body.kind}", "loan", loan_id, None, {"amount": doc["amount"], "date": doc["date"]})
        return await get_loan(loan_id, request)

    @router.delete("/loans/{loan_id}/payments/{payment_id}")
    async def delete_payment(loan_id: str, payment_id: str, request: Request):
        user = await get_current_user(request)
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can remove a loan payment")
        p = await db.loan_payments.find_one({"_id": ObjectId(payment_id), "loan_id": loan_id}) if ObjectId.is_valid(payment_id) else None
        if not p:
            raise HTTPException(status_code=404, detail="Payment not found")
        await db.loan_payments.delete_one({"_id": p["_id"]})
        await _plan_notes(await _loan(loan_id))
        await create_audit_log(user["id"], user["name"], "loan_payment_removed", "loan", loan_id, {k: v for k, v in p.items() if k != "_id"}, None)
        return {"ok": True}

    @router.post("/loans/{loan_id}/close")
    async def close_loan(loan_id: str, body: CloseIn, request: Request):
        user = await _gate(request, "edit")
        l = await _loan(loan_id)
        d = notify.to_date(body.closed_on)
        if not d or body.how not in ("closed", "foreclosed"):
            raise HTTPException(status_code=400, detail="Give the closing date (and closed / foreclosed)")
        st = apply_payments(l, await _payments(loan_id))
        if st["balance"] > 1 and body.how == "closed":
            raise HTTPException(status_code=400, detail=f"₹{st['balance']:,.0f} is still outstanding — record the last payment, or choose foreclosed")
        await db.loans.update_one({"_id": l["_id"]}, {"$set": {"status": body.how, "closed_on": d.isoformat(), "close_notes": body.notes}})
        await notify.clear(db, "loan_emi", "loan", loan_id)
        await create_audit_log(user["id"], user["name"], f"loan_{body.how}", "loan", loan_id, None, {"closed_on": d.isoformat(), "balance": st["balance"]})
        return {"ok": True}

    @router.delete("/loans/{loan_id}")
    async def delete_loan(loan_id: str, request: Request):
        user = await get_current_user(request)
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only an admin can delete a loan")
        l = await _loan(loan_id)
        n = (await db.loan_payments.delete_many({"loan_id": loan_id})).deleted_count
        await db.loans.delete_one({"_id": l["_id"]})
        await notify.clear(db, "loan_emi", "loan", loan_id)
        await create_audit_log(user["id"], user["name"], "loan_deleted", "loan", loan_id, {k: v for k, v in l.items() if k != "_id"}, None, f"{n} payments removed")
        return {"ok": True}

    async def calendar_items(start: date, end: date) -> List[Dict[str, Any]]:
        out = []
        async for l in db.loans.find({"status": "active", "emi_amount": {"$gt": 0}}):
            first = notify.to_date(l.get("first_emi_date"))
            if not first:
                continue
            d, day = first, int(l.get("emi_day") or first.day)
            while d <= end:
                if d >= start:
                    out.append({"date": d.isoformat(), "title": f"EMI ₹{_f(l['emi_amount']):,.0f} · {l['lender']}", "detail": l.get("reference"),
                                "source": "loans", "link": f"/dashboard/loans?loan={l['_id']}", "id": f"emi-{l['_id']}-{d.isoformat()}"})
                d = add_months(d, 1, day)
        return out

    router.calendar_items = calendar_items
    return router
