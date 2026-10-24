/* Loans: the company's borrowings — what is still owed, EMIs, interest paid and still to come. */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CalendarClock, HandCoins, Landmark, Loader2, Pencil, Percent, Plus, Trash2, Wallet } from 'lucide-react';
import { loansAPI, uploadAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { useLiveRefresh } from '../lib/liveSync';
import { Card, Chip, Empty, Field, FileAttach, Loading, PageHeader, PillTabs, Tile, Tiles, errText, fmtDate, inputCls, inr, inrShort, todayISO } from '../components/kit/PageBits';

const TYPES = [['term_loan', 'Term loan'], ['working_capital', 'Working capital'], ['od_cc', 'OD / CC limit'], ['vehicle', 'Vehicle loan'], ['equipment', 'Equipment loan'],
  ['business', 'Business loan'], ['property', 'Property loan'], ['other', 'Other']];
const REVOLVING = ['working_capital', 'od_cc'];
const KINDS = [['emi', 'EMI'], ['prepayment', 'Prepayment (reduces principal)'], ['interest', 'Interest only'], ['charges', 'Charges / penalty'], ['repayment', 'Repayment (OD / CC)'], ['drawdown', 'Drawdown (OD / CC)']];
const typeLabel = (t) => (TYPES.find(([k]) => k === t) || [t, t])[1];
const BLUE = '#2a78d6', ORANGE = '#eb6834';
const SHORT = { day: 'numeric', month: 'short', year: '2-digit' };
const blankLoan = { lender: '', loan_type: 'term_loan', reference: '', purpose: '', principal: '', disbursed_amount: '', disbursal_date: todayISO(), interest_rate: '', rate_type: 'fixed',
  tenure_months: '', emi_amount: '', emi_day: '', first_emi_date: '', processing_fee: '', security: '', contact: '', documents: [], notes: '' };

function LoanForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState(initial);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const revolving = REVOLVING.includes(f.loan_type);
  useEffect(() => {
    const amount = Number(f.disbursed_amount || f.principal), rate = Number(f.interest_rate), months = Number(f.tenure_months);
    if (revolving || !(amount > 0) || !(months > 0) || f.interest_rate === '') { setPreview(null); return undefined; }
    const t = setTimeout(() => loansAPI.emiPreview({ amount, interest_rate: rate, tenure_months: months }).then((r) => setPreview(r.data)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [f.principal, f.disbursed_amount, f.interest_rate, f.tenure_months, revolving]);
  const save = async () => {
    setSaving(true);
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const body = { ...f, principal: Number(f.principal), disbursed_amount: n(f.disbursed_amount), interest_rate: Number(f.interest_rate), tenure_months: revolving ? null : n(f.tenure_months),
      emi_amount: revolving ? null : n(f.emi_amount), emi_day: n(f.emi_day), first_emi_date: f.first_emi_date || null, processing_fee: n(f.processing_fee) };
    try { const r = f.id ? await loansAPI.update(f.id, body) : await loansAPI.create(body); toast.success('Loan saved'); onSaved(r.data); }
    catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-3" data-testid="loan-form">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Bank / lender *" className="col-span-2"><Input value={f.lender} onChange={set('lender')} className="h-11" data-testid="loan-lender" /></Field>
        <Field label="Type"><Select value={f.loan_type} onValueChange={set('loan_type')}><SelectTrigger className="h-11" data-testid="loan-type"><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Loan / account ref."><Input value={f.reference || ''} onChange={set('reference')} className="h-11" /></Field>
        <Field label={revolving ? 'Limit (₹) *' : 'Sanctioned amount (₹) *'}><Input type="number" inputMode="decimal" value={f.principal} onChange={set('principal')} className="h-11" data-testid="loan-principal" /></Field>
        <Field label={revolving ? 'Used now (₹)' : 'Disbursed (₹)'} hint={revolving ? '' : 'Blank = the full amount'}><Input type="number" inputMode="decimal" value={f.disbursed_amount ?? ''} onChange={set('disbursed_amount')} className="h-11" /></Field>
        <Field label="Disbursed on *"><input type="date" value={f.disbursal_date || ''} onChange={set('disbursal_date')} className={inputCls} data-testid="loan-disbursal" /></Field>
        <Field label="Interest % a year *"><Input type="number" inputMode="decimal" step="0.05" value={f.interest_rate} onChange={set('interest_rate')} className="h-11" data-testid="loan-rate" /></Field>
        <Field label="Rate"><Select value={f.rate_type} onValueChange={set('rate_type')}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="floating">Floating</SelectItem></SelectContent></Select></Field>
        {!revolving && <>
          <Field label="Tenure (months) *"><Input type="number" inputMode="numeric" value={f.tenure_months ?? ''} onChange={set('tenure_months')} className="h-11" data-testid="loan-tenure" /></Field>
          <Field label="EMI day of month"><Input type="number" inputMode="numeric" min="1" max="31" value={f.emi_day ?? ''} onChange={set('emi_day')} placeholder="5" className="h-11" /></Field>
          <Field label="First EMI on" hint="Blank = a month after disbursal"><input type="date" value={f.first_emi_date || ''} onChange={set('first_emi_date')} className={inputCls} /></Field>
          <Field label="EMI (₹)" hint={preview ? `Worked out: ${inr(preview.emi)}` : 'Blank = worked out'}><Input type="number" inputMode="decimal" value={f.emi_amount ?? ''} onChange={set('emi_amount')} placeholder={preview ? String(preview.emi) : ''} className="h-11" data-testid="loan-emi" /></Field>
        </>}
        <Field label="Processing fee (₹)"><Input type="number" inputMode="decimal" value={f.processing_fee ?? ''} onChange={set('processing_fee')} className="h-11" /></Field>
        <Field label="Security / collateral"><Input value={f.security || ''} onChange={set('security')} className="h-11" /></Field>
        <Field label="Purpose" className="col-span-2"><Input value={f.purpose || ''} onChange={set('purpose')} className="h-11" placeholder="Vehicle for field team, stock for the season…" /></Field>
        <Field label="Bank contact" className="col-span-2"><Input value={f.contact || ''} onChange={set('contact')} className="h-11" placeholder="Relationship manager, phone" /></Field>
      </div>
      {preview && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm" data-testid="loan-preview">EMI <b>{inr(f.emi_amount || preview.emi)}</b> × {f.tenure_months} months · total interest about <b>{inr(preview.total_interest)}</b></p>}
      <div className="space-y-1"><p className="text-xs font-medium text-slate-700">Papers (sanction letter, schedule)</p>
        {(f.documents || []).map((d) => <FileAttach key={d} value={d} onChange={() => setF((x) => ({ ...x, documents: x.documents.filter((y) => y !== d) }))} />)}
        <FileAttach value={null} onChange={(p) => p && setF((x) => ({ ...x, documents: [...(x.documents || []), p] }))} label="Attach a paper" /></div>
      <Field label="Notes"><textarea rows={2} value={f.notes || ''} onChange={set('notes')} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={save} disabled={saving || !f.lender.trim() || !(Number(f.principal) > 0) || f.interest_rate === '' || (!revolving && !(Number(f.tenure_months) > 0))} className="bg-emerald-600 text-white" data-testid="loan-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save loan'}</Button></div>
    </div>
  );
}

function PaymentDialog({ loan, open, onOpenChange, onSaved }) {
  const revolving = REVOLVING.includes(loan?.loan_type);
  const [f, setF] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open && loan) setF({ date: loan.next_due && loan.next_due <= todayISO() ? loan.next_due : todayISO(), amount: loan.emi_amount || '', kind: revolving ? 'interest' : 'emi', reference: '', notes: '' });
  }, [open, loan, revolving]);
  const save = async () => {
    setSaving(true);
    try { const r = await loansAPI.addPayment(loan.id, { ...f, amount: Number(f.amount) }); toast.success('Payment recorded'); onSaved(r.data); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not record')); } finally { setSaving(false); }
  };
  const kinds = KINDS.filter(([k]) => (revolving ? !['emi'].includes(k) : !['repayment', 'drawdown'].includes(k)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="loan-payment-dialog">
        <DialogHeader><DialogTitle>Record a payment</DialogTitle><DialogDescription>{loan?.lender} · {inr(loan?.outstanding)} still owed</DialogDescription></DialogHeader>
        <div className="space-y-2">
          <Field label="What is it?"><Select value={f.kind || ''} onValueChange={(v) => setF((x) => ({ ...x, kind: v, amount: v === 'emi' ? loan?.emi_amount || '' : x.amount }))}><SelectTrigger className="h-11" data-testid="loan-pay-kind"><SelectValue /></SelectTrigger><SelectContent>{kinds.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date"><input type="date" value={f.date || ''} max={todayISO()} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} className={inputCls} data-testid="loan-pay-date" /></Field>
            <Field label="Amount (₹)"><Input type="number" inputMode="decimal" value={f.amount ?? ''} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} className="h-11" data-testid="loan-pay-amount" /></Field>
          </div>
          <Field label="Bank reference (optional)"><Input value={f.reference || ''} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} className="h-11" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !(Number(f.amount) > 0) || !f.date} className="bg-emerald-600 text-white" data-testid="loan-pay-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoanSheet({ loanId, onOpenChange, onChanged, canEdit, isAdmin }) {
  const [l, setL] = useState(null);
  const [tab, setTab] = useState('payments');
  const [pay, setPay] = useState(false);
  const [edit, setEdit] = useState(false);
  const load = useCallback(() => { if (loanId) loansAPI.get(loanId).then((r) => setL(r.data)).catch(() => toast.error('Could not load the loan')); }, [loanId]);
  useEffect(() => { setL(null); setTab('payments'); setEdit(false); load(); }, [load]);
  const changed = (d) => { if (d?.id) setL(d); else load(); onChanged(); };
  const close = async () => {
    const how = l.outstanding > 1 ? 'foreclosed' : 'closed';
    if (!window.confirm(how === 'closed' ? 'Mark this loan as closed?' : `₹${Math.round(l.outstanding).toLocaleString('en-IN')} is still outstanding. Mark it foreclosed (paid off early)?`)) return;
    try { await loansAPI.close(l.id, { closed_on: todayISO(), how }); load(); onChanged(); } catch (e) { toast.error(errText(e)); }
  };
  const removePay = async (p) => { if (!window.confirm('Remove this payment?')) return; try { await loansAPI.removePayment(l.id, p.id); load(); onChanged(); } catch (e) { toast.error(errText(e)); } };
  const removeLoan = async () => { if (!window.confirm(`Delete ${l.lender} and all its payments?`)) return; try { await loansAPI.remove(l.id); onOpenChange(false); onChanged(); } catch (e) { toast.error(errText(e)); } };
  const paidPct = l ? Math.min(100, Math.round((l.principal_paid / (l.disbursed_amount || l.principal || 1)) * 100)) : 0;
  return (
    <Sheet open={!!loanId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" data-testid="loan-sheet">
        {!l ? <Loading /> : edit ? <LoanForm initial={{ ...blankLoan, ...l }} onSaved={(d) => { setEdit(false); changed(d); }} onCancel={() => setEdit(false)} /> : (
          <div className="space-y-4">
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="flex flex-wrap items-center gap-2">{l.lender}<Chip>{typeLabel(l.loan_type)}</Chip>{l.status !== 'active' && <Chip tone="green">{l.status === 'foreclosed' ? 'Foreclosed' : 'Closed'}</Chip>}</SheetTitle>
              <SheetDescription>{[l.reference, `${l.interest_rate}% ${l.rate_type}`, l.purpose, `since ${fmtDate(l.disbursal_date)}`].filter(Boolean).join(' · ')}</SheetDescription>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Still owed" value={inr(l.outstanding)} sub={REVOLVING.includes(l.loan_type) ? `${l.utilisation_pct ?? 0}% of the limit used` : `${paidPct}% of the principal repaid`} tone="warn" />
              <Tile label={REVOLVING.includes(l.loan_type) ? 'Interest a year (now)' : 'EMI'} value={REVOLVING.includes(l.loan_type) ? inr(l.interest_to_come) : inr(l.emi_amount)} sub={l.next_due ? `next on ${fmtDate(l.next_due)}` : ''} />
              <Tile label="Interest paid" value={inr(l.interest_paid)} sub={`${inr(l.interest_paid_fy)} this financial year`} />
              <Tile label="Interest still to come" value={inr(l.interest_to_come)} sub={l.closes_on ? `${l.emis_left} EMIs · ends ${fmtDate(l.closes_on)}` : ''} />
            </div>
            {!REVOLVING.includes(l.loan_type) && <div><div className="flex justify-between text-xs text-slate-500"><span>Principal repaid</span><span>{inr(l.principal_paid)} of {inr(l.disbursed_amount)}</span></div><div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${paidPct}%` }} /></div></div>}
            {l.missed_emis?.length > 0 && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" data-testid="loan-missed"><AlertTriangle className="mr-1 inline h-4 w-4" />No EMI recorded for {l.missed_emis.map((d) => fmtDate(d, { month: 'short', year: 'numeric' })).join(', ')}</p>}
            {canEdit && l.status === 'active' && <div className="flex flex-wrap gap-2">
              <Button onClick={() => setPay(true)} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="loan-pay"><Wallet className="h-4 w-4" />Record payment</Button>
              <Button variant="outline" className="gap-1.5" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit</Button>
              <Button variant="ghost" onClick={close} data-testid="loan-close">Close loan</Button>
              {isAdmin && <Button variant="ghost" className="text-rose-600" onClick={removeLoan}><Trash2 className="h-4 w-4" /></Button>}
            </div>}
            <PillTabs value={tab} onChange={setTab} testid="loan-tab" tabs={[['payments', `Payments (${l.payments.length})`], ['schedule', `EMIs left (${l.schedule.length})`], ['papers', 'Papers']]} />
            {tab === 'payments' && (l.payments.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No payments recorded yet</p> : (
              <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left font-medium">Date</th><th className="p-2 text-left font-medium">Kind</th><th className="p-2 text-right font-medium">Paid</th><th className="p-2 text-right font-medium">Interest</th><th className="p-2 text-right font-medium">Principal</th><th className="p-2 text-right font-medium">Balance</th>{isAdmin && <th />}</tr></thead>
                <tbody className="divide-y divide-slate-100">{l.payments.map((p) => (
                  <tr key={p.id}><td className="whitespace-nowrap p-2">{fmtDate(p.date, SHORT)}</td><td className="p-2 text-xs">{(KINDS.find(([k]) => k === p.kind) || [p.kind, p.kind])[1].split(' (')[0]}</td><td className="p-2 text-right tabular-nums">{inr(p.amount)}</td>
                    <td className="p-2 text-right tabular-nums text-slate-600">{inr(p.interest_part)}</td><td className="p-2 text-right tabular-nums text-slate-600">{inr(p.principal_part)}</td><td className="p-2 text-right tabular-nums">{inr(p.balance_after)}</td>
                    {isAdmin && <td className="p-2"><button type="button" onClick={() => removePay(p)} className="text-slate-400 hover:text-rose-600" aria-label="Remove payment"><Trash2 className="h-3.5 w-3.5" /></button></td>}</tr>))}</tbody></table></div>))}
            {tab === 'schedule' && (l.schedule.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">{REVOLVING.includes(l.loan_type) ? 'An OD / CC limit has no EMIs — record interest and repayments as they happen.' : 'Nothing left to pay'}</p> : (
              <div className="max-h-[50vh] overflow-auto rounded-xl border border-slate-200"><table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left font-medium">#</th><th className="p-2 text-left font-medium">Due</th><th className="p-2 text-right font-medium">EMI</th><th className="p-2 text-right font-medium">Interest</th><th className="p-2 text-right font-medium">Principal</th><th className="p-2 text-right font-medium">Balance after</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{l.schedule.map((r) => (<tr key={r.n}><td className="p-2 text-slate-400">{r.n}</td><td className="whitespace-nowrap p-2">{fmtDate(r.date, SHORT)}</td><td className="p-2 text-right tabular-nums">{inr(r.emi)}</td><td className="p-2 text-right tabular-nums text-slate-600">{inr(r.interest)}</td><td className="p-2 text-right tabular-nums text-slate-600">{inr(r.principal)}</td><td className="p-2 text-right tabular-nums">{inr(r.balance)}</td></tr>))}</tbody></table></div>))}
            {tab === 'papers' && ((l.documents || []).length ? <ul className="space-y-1">{l.documents.map((d) => <li key={d}><a href={uploadAPI.getFileUrl(d)} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 underline">{d.split('/').pop()}</a></li>)}</ul> : <p className="py-6 text-center text-sm text-slate-500">No papers attached — use Edit to add the sanction letter.</p>)}
          </div>
        )}
        <PaymentDialog loan={l} open={pay} onOpenChange={setPay} onSaved={changed} />
      </SheetContent>
    </Sheet>
  );
}

export default function LoansPage() {
  const { isAdmin, can } = useAuth();
  const canEdit = isAdmin || can('module_loans', 'edit');
  const [params, setParams] = useSearchParams();
  const openId = params.get('loan');
  const setOpen = (id) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('loan', id); else n.delete('loan'); return n; }, { replace: true });
  const [data, setData] = useState(null);
  const [show, setShow] = useState('active');
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => loansAPI.list().then((r) => setData(r.data)).catch((e) => { toast.error(errText(e, 'Could not load loans')); setData({ rows: [], totals: {}, next_12_months: [], by_lender: [] }); }), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(['loans'], load);
  if (!data) return <Loading />;
  const t = data.totals;
  const rows = data.rows.filter((r) => (show === 'all' ? true : show === 'active' ? r.status === 'active' : r.status !== 'active'));
  const months = data.next_12_months.map((m) => ({ month: new Date(`${m.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }).slice(0, 3), Principal: Math.round(m.principal), Interest: Math.round(m.interest) }));
  return (
    <div className="px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader icon={HandCoins} title="Loans" sub="What we owe, the EMIs, and the interest paid and still to come" testid="loans-page">
          {canEdit && <Button onClick={() => setAdding(true)} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="loan-add"><Plus className="h-4 w-4" />Add loan</Button>}
        </PageHeader>
        {data.rows.length === 0 ? <Empty icon={Landmark} title="No loans recorded" text="Add each bank loan, vehicle loan or OD / CC limit — the EMIs, interest and balance are worked out for you." /> : <>
          <Tiles>
            <Tile label="Still owed" value={inrShort(t.outstanding)} sub={`${t.active} active loan${t.active === 1 ? '' : 's'}`} icon={Wallet} testid="loan-kpi-outstanding" />
            <Tile label="EMIs a month" value={inr(t.monthly_emi)} sub={t.next_due ? `next on ${fmtDate(t.next_due)}` : 'no EMI due'} icon={CalendarClock} testid="loan-kpi-emi" />
            <Tile label="Interest paid this year" value={inr(t.interest_paid_fy)} sub={`about ${inr(t.interest_next_12m)} in the next 12 months`} icon={Percent} />
            <Tile label={t.missed ? 'EMIs not recorded' : 'Average rate'} value={t.missed ? t.missed : (t.avg_rate != null ? `${t.avg_rate}%` : '—')} sub={t.missed ? 'months with no EMI entered' : 'weighted by what is owed'} icon={t.missed ? AlertTriangle : Percent} tone={t.missed ? 'bad' : undefined} testid="loan-kpi-missed" />
          </Tiles>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card title="EMIs in the next 12 months" sub="How much of each month's EMIs is interest" className="lg:col-span-2" testid="loan-chart-months">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={months} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" interval={0} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => inrShort(v).replace('₹', '')} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v) => inr(v)} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Principal" stackId="a" fill={BLUE} stroke="#fff" strokeWidth={2} />
                  <Bar dataKey="Interest" stackId="a" fill={ORANGE} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Owed to each lender" testid="loan-by-lender">
              <ul className="space-y-2">{data.by_lender.map((r) => {
                const max = Math.max(...data.by_lender.map((x) => x.outstanding), 1);
                return <li key={r.lender}><div className="flex justify-between text-xs"><span className="text-slate-700">{r.lender}</span><span className="tabular-nums text-slate-900">{inrShort(r.outstanding)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${Math.max(2, (r.outstanding / max) * 100)}%`, background: BLUE }} /></div></li>;
              })}</ul>
            </Card>
          </div>
          <div className="w-44"><Select value={show} onValueChange={setShow}><SelectTrigger className="h-10 bg-white" aria-label="Show" data-testid="loan-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active loans</SelectItem><SelectItem value="closed">Closed loans</SelectItem><SelectItem value="all">All loans</SelectItem></SelectContent></Select></div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((l) => {
              const pct = Math.min(100, Math.round((l.principal_paid / (l.disbursed_amount || l.principal || 1)) * 100));
              return (
                <button key={l.id} type="button" onClick={() => setOpen(l.id)} className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-emerald-300" data-testid={`loan-card-${l.id}`}>
                  <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{l.lender}</p><Chip>{typeLabel(l.loan_type)}</Chip>{l.missed_emis?.length > 0 && <Chip tone="red">{l.missed_emis.length} EMI not entered</Chip>}{l.status !== 'active' && <Chip tone="green">Closed</Chip>}</div>
                  <p className="text-xs text-slate-500">{[l.reference, `${l.interest_rate}%`, l.purpose].filter(Boolean).join(' · ')}</p>
                  <p className="mt-2 font-['Outfit'] text-xl font-bold tabular-nums text-slate-900">{inr(l.outstanding)} <span className="text-xs font-normal text-slate-500">owed</span></p>
                  {REVOLVING.includes(l.loan_type) ? <p className="text-xs text-slate-500">{l.utilisation_pct ?? 0}% of {inr(l.principal)} limit used</p> : <>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                    <p className="mt-1 text-xs text-slate-500">EMI {inr(l.emi_amount)}{l.next_due ? ` · next ${fmtDate(l.next_due)}` : ''}{l.closes_on ? ` · ends ${fmtDate(l.closes_on, { month: 'short', year: 'numeric' })}` : ''}</p></>}
                </button>
              );
            })}
          </div>
        </>}
      </div>
      <LoanSheet loanId={openId} onOpenChange={(o) => !o && setOpen(null)} onChanged={load} canEdit={canEdit} isAdmin={isAdmin} />
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="loan-add-dialog">
          <DialogHeader><DialogTitle>Add a loan</DialogTitle><DialogDescription>Enter the terms from the sanction letter; the EMI is worked out if you leave it blank.</DialogDescription></DialogHeader>
          {adding && <LoanForm initial={blankLoan} onSaved={(l) => { setAdding(false); load(); setOpen(l.id); }} onCancel={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
