/* Pay & benefits → Incentives: sales commission worked out from customer payments, incentives / bonus / other pay
 * waiting for approval, bonus for many people at once, salary advances, and the commission rules. */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck, ChevronDown, ChevronRight, Gift, HandCoins, Loader2, Pencil, Percent, Plus, Trash2, UserRoundPen, X } from 'lucide-react';
import { payrollAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, Chip, Empty, Field, Loading, PillTabs, Tile, Tiles, errText, fmtDate, inr, inputCls } from '../kit/PageBits';
import { EXTRA_STATUS, MonthPicker, PersonPick, StatusChip, addMonth, monthLabel, n0, thisMonth } from './payBits';
import { AdvanceDialog, ExtraDialog } from './PayDialogs';

const MODE = { percent: 'Percent of payments', slab: 'Slab rate on the month’s total', per_kw: '₹ per kW sold' };

function CreditDialog({ row, people, onOpenChange, onSaved }) {
  const [uid, setUid] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setUid(row?.credited_to || ''); }, [row]);
  if (!row) return null;
  const save = async () => {
    setSaving(true);
    try { await payrollAPI.credit(row.project_id, uid); toast.success('Credit changed'); onSaved(); onOpenChange(false); } catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="pay-credit-dialog">
        <DialogHeader><DialogTitle>Whose sale is it?</DialogTitle><DialogDescription>{row.customer}{row.reference ? ` · ${row.reference}` : ''}. Every payment on this project counts for this person.</DialogDescription></DialogHeader>
        <PersonPick people={people} value={uid} onChange={setUid} placeholder="Whoever made the project" allowNone testid="pay-credit-person" />
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-credit-save">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Commission({ people, canEdit, canApprove }) {
  const [month, setMonth] = useState(thisMonth());
  const [d, setD] = useState(null);
  const [openRow, setOpenRow] = useState(null);
  const [credit, setCredit] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { setD(null); payrollAPI.commission(month).then((r) => setD(r.data)).catch((e) => { toast.error(errText(e)); setD(false); }); }, [month]);
  useEffect(() => { load(); }, [load]);
  const approve = async (ids) => {
    setBusy(ids ? ids[0] : 'all');
    try { const r = await payrollAPI.approveCommission({ month, user_ids: ids || [] }); toast.success(`${inr(r.data.total)} added to ${monthLabel(month)} salaries`); load(); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-3" data-testid="pay-commission">
      <div className="flex flex-wrap items-center gap-2"><MonthPicker value={month} onChange={setMonth} max={thisMonth()} testid="pay-com-month" />
        <p className="text-xs text-slate-500">Worked out from customer payments received this month, for the salesperson each project is credited to.</p></div>
      {d === null ? <Loading /> : !d ? <Empty title="Could not load" /> : (<>
        {d.rules === 0 && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">No commission rule yet — add one under Rules (for example 2% of payments, or ₹1,000 per kW).</p>}
        <Tiles>
          <Tile label="Commission this month" value={inr(d.total)} sub={`${d.people.length} salespeople`} tone={d.total ? 'good' : undefined} testid="pay-com-total" />
          <Tile label="Payments counted" value={d.people.reduce((a, p) => a + p.lines.length, 0)} sub={inr(d.people.reduce((a, p) => a + p.collected, 0))} />
          <Tile label="Already added" value={d.counted.length} sub="payments in approved commission" />
          <Tile label="Nobody credited" value={d.unassigned.length} tone={d.unassigned.length ? 'warn' : undefined} sub="set whose sale it is" />
        </Tiles>
        {d.people.length === 0 ? <Empty icon={Percent} title="Nothing to pay yet" text="Commission shows here when customers pay on projects." /> : (
          <ul className="space-y-2">{d.people.map((p) => (
            <li key={p.user_id} className="rounded-xl border border-slate-200 bg-white" data-testid={`pay-com-${p.user_id}`}>
              <div className="flex flex-wrap items-center gap-2 p-3">
                <button type="button" onClick={() => setOpenRow(openRow === p.user_id ? null : p.user_id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={openRow === p.user_id}>
                  {openRow === p.user_id ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                  <span className="min-w-0"><span className="block truncate font-medium text-slate-900">{p.name}</span>
                    <span className="block text-[11px] text-slate-500">{p.rule ? `${p.rule.name} · ${p.rule.mode === 'per_kw' ? `${p.kw} kW` : `${p.rate}% on ${inr(p.base)}`}` : 'No rule applies'} · collected {inr(p.collected)}</span></span>
                </button>
                <span className="font-semibold tabular-nums text-slate-900">{inr(p.amount)}</span>
                {canApprove && p.amount > 0 && <Button size="sm" className="h-8 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!!busy} onClick={() => approve([p.user_id])} data-testid={`pay-com-approve-${p.user_id}`}>{busy === p.user_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}Add to salary</Button>}
              </div>
              {openRow === p.user_id && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">{p.lines.map((l) => (
                  <li key={l.payment_id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                    <span className="min-w-0 flex-1"><span className="block truncate">{l.customer}{l.reference ? ` · ${l.reference}` : ''}</span><span className="text-[11px] text-slate-500">{fmtDate(l.paid_on)} · paid {inr(l.amount)} of {inr(l.project_total)}{l.kw_total ? ` · ${l.kw_total} kW` : ''}</span></span>
                    <span className="tabular-nums text-slate-900">{inr(l.commission || 0)}</span>
                    {canEdit && <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setCredit(l)}><UserRoundPen className="h-3.5 w-3.5" />Credit</Button>}
                  </li>))}</ul>)}
            </li>))}</ul>)}
        {canApprove && d.people.some((p) => p.amount > 0) && <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!!busy} onClick={() => approve(null)} data-testid="pay-com-approve-all">{busy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}Add everyone’s commission to {monthLabel(month, true)} salary</Button>}
        {d.unassigned.length > 0 && (
          <Card title="Payments with nobody credited" sub="The project was made by someone who isn't on the staff list. Choose whose sale it is.">
            <ul className="divide-y divide-slate-100 text-sm">{d.unassigned.map((l) => (
              <li key={l.payment_id} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{l.customer} · {inr(l.amount)} <span className="text-[11px] text-slate-500">{fmtDate(l.paid_on)}</span></span>
                {canEdit && <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setCredit(l)}><UserRoundPen className="h-3.5 w-3.5" />Credit</Button>}</li>))}</ul>
          </Card>)}
      </>)}
      <CreditDialog row={credit} people={people} onOpenChange={(o) => !o && setCredit(null)} onSaved={load} />
    </div>
  );
}

function BulkDialog({ open, people, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ kind: 'bonus', mode: 'pct_basic', value: '', month: thisMonth(), department: '', reason: 'Diwali bonus' }); }, [open]);
  if (!open || !f) return null;
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean))];
  const save = async () => {
    setSaving(true);
    try { const r = await payrollAPI.bulkExtra({ ...f, value: n0(f.value), department: f.department || null }); toast.success(`${r.data.added} people · ${inr(r.data.total)} — waiting for approval`); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="pay-bulk-dialog">
        <DialogHeader><DialogTitle>Bonus or incentive for many</DialogTitle><DialogDescription>Adds an entry for each person on payroll. They wait for approval like any other.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="What"><Select value={f.kind} onValueChange={(v) => setF((x) => ({ ...x, kind: v }))}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bonus">Bonus</SelectItem><SelectItem value="incentive">Incentive</SelectItem></SelectContent></Select></Field>
          <Field label="Pay with"><input type="month" value={f.month} onChange={(e) => setF((x) => ({ ...x, month: e.target.value }))} className={inputCls} /></Field>
          <Field label="Worked out as"><Select value={f.mode} onValueChange={(v) => setF((x) => ({ ...x, mode: v }))}><SelectTrigger className="h-11" data-testid="pay-bulk-mode"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="pct_basic">% of basic</SelectItem><SelectItem value="pct_gross">% of gross</SelectItem><SelectItem value="fixed">Same amount each</SelectItem></SelectContent></Select></Field>
          <Field label={f.mode === 'fixed' ? 'Amount (₹)' : 'Percent'}><Input value={f.value} onChange={(e) => setF((x) => ({ ...x, value: e.target.value }))} inputMode="decimal" className="h-11" data-testid="pay-bulk-value" /></Field>
          <Field label="Department"><Select value={f.department || '__all'} onValueChange={(v) => setF((x) => ({ ...x, department: v === '__all' ? '' : v }))}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all">Everyone</SelectItem>{depts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Reason"><Input value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} className="h-11" /></Field>
        </div>
        {f.kind === 'bonus' && f.mode === 'pct_basic' && <p className="text-[11px] text-slate-500">Statutory bonus is at least 8.33% of wages (capped) for people earning up to ₹21,000 a month.</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || n0(f.value) <= 0} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-bulk-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OtherPay({ people, canEdit, canApprove }) {
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState(null);
  const [dlg, setDlg] = useState(null);        // {initial} | 'bulk'
  const load = useCallback(() => { setRows(null); payrollAPI.extras({ month }).then((r) => setRows(r.data)).catch(() => setRows([])); }, [month]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(errText(e)); } };
  const pending = (rows || []).filter((r) => r.status === 'pending');
  return (
    <div className="space-y-3" data-testid="pay-extras">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker value={month} onChange={setMonth} max={addMonth(thisMonth(), 2)} testid="pay-extra-month" />
        {canEdit && <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setDlg({ initial: { month } })} data-testid="pay-extra-add"><Plus className="h-4 w-4" />Add</Button>}
        {canEdit && <Button variant="outline" className="h-10 gap-1.5" onClick={() => setDlg('bulk')} data-testid="pay-bulk-open"><Gift className="h-4 w-4" />Bonus for many</Button>}
        {canApprove && pending.length > 1 && <Button variant="outline" className="h-10 gap-1.5 sm:ml-auto" onClick={() => act(() => payrollAPI.approveAll(month), `${pending.length} approved`)} data-testid="pay-extra-approve-all"><BadgeCheck className="h-4 w-4" />Approve all {pending.length}</Button>}
      </div>
      {rows === null ? <Loading /> : rows.length === 0 ? <Empty icon={Gift} title={`Nothing extra for ${monthLabel(month)}`} text="Incentives, bonus, reimbursements and one-off deductions for this month appear here." /> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">{rows.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3" data-testid={`pay-extra-${x.id}`}>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-900">{x.user_name}</span><span className="block truncate text-xs text-slate-600">{x.label}</span>
              <span className="text-[11px] text-slate-400">added by {x.created_by}{x.approved_by && x.status !== 'pending' ? ` · ${x.status === 'rejected' ? 'rejected' : 'approved'} by ${x.approved_by}` : ''}</span></span>
            <span className={`font-semibold tabular-nums ${x.kind === 'deduction' ? 'text-rose-700' : 'text-slate-900'}`}>{x.kind === 'deduction' ? '−' : ''}{inr(x.amount)}</span>
            <StatusChip map={EXTRA_STATUS} value={x.status} />
            <span className="flex gap-1">
              {canApprove && x.status === 'pending' && <Button size="sm" className="h-8 bg-emerald-600 px-2.5 text-white hover:bg-emerald-700" onClick={() => act(() => payrollAPI.approveExtra(x.id), 'Approved')} data-testid={`pay-extra-approve-${x.id}`}>Approve</Button>}
              {canApprove && ['pending', 'approved'].includes(x.status) && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Reject" onClick={() => act(() => payrollAPI.rejectExtra(x.id), 'Rejected')}><X className="h-4 w-4" /></Button>}
              {canEdit && x.status === 'pending' && x.source !== 'commission' && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit" onClick={() => setDlg({ initial: x })}><Pencil className="h-3.5 w-3.5" /></Button>}
              {canEdit && ['pending', 'rejected'].includes(x.status) && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Delete" onClick={() => act(() => payrollAPI.deleteExtra(x.id), 'Deleted')}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </span>
          </li>))}</ul>)}
      <ExtraDialog open={!!dlg && dlg !== 'bulk'} people={people} initial={dlg?.initial} onOpenChange={(o) => !o && setDlg(null)} onSaved={load} />
      <BulkDialog open={dlg === 'bulk'} people={people} onOpenChange={(o) => !o && setDlg(null)} onSaved={load} />
    </div>
  );
}

function Advances({ people, canEdit }) {
  const [rows, setRows] = useState(null);
  const [add, setAdd] = useState(false);
  const load = useCallback(() => payrollAPI.advances().then((r) => setRows(r.data)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  if (rows === null) return <Loading />;
  const open = rows.filter((a) => a.status === 'active');
  return (
    <div className="space-y-3" data-testid="pay-advances">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-700"><b>{inr(open.reduce((s, a) => s + a.balance, 0))}</b> still to recover from {open.length} {open.length === 1 ? 'person' : 'people'}</p>
        {canEdit && <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 sm:ml-auto" onClick={() => setAdd(true)} data-testid="pay-adv-add"><HandCoins className="h-4 w-4" />Give an advance</Button>}
      </div>
      {rows.length === 0 ? <Empty icon={HandCoins} title="No salary advances" /> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">{rows.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
            <span className="min-w-0 flex-1"><span className="block font-medium text-slate-900">{a.user_name}</span>
              <span className="text-xs text-slate-600">{inr(a.amount)} on {fmtDate(a.given_on)} · {inr(a.monthly)} a month from {monthLabel(a.start_month, true)}{a.reason ? ` · ${a.reason}` : ''}</span></span>
            <span className="w-28 text-right"><span className="block text-[11px] text-slate-500">recovered {inr(a.recovered)}</span>
              <span className="mt-1 block h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (a.recovered / a.amount) * 100)}%` }} /></span></span>
            <Chip tone={a.status === 'closed' ? 'green' : 'amber'}>{a.status === 'closed' ? 'Paid back' : `${inr(a.balance)} left`}</Chip>
            {canEdit && a.status === 'active' && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={async () => { try { await payrollAPI.editAdvance(a.id, { status: 'closed' }); toast.success('Closed'); load(); } catch (e) { toast.error(errText(e)); } }}>Close</Button>}
          </li>))}</ul>)}
      <AdvanceDialog open={add} people={people} onOpenChange={setAdd} onSaved={load} />
    </div>
  );
}

function RuleDialog({ open, initial, people, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setF({ name: '', mode: 'percent', percent: '', per_kw: '', slabs: [{ from: 0, percent: '' }], base: 'before_gst', active: true, user_ids: [], note: '', ...(initial || {}),
      ...(initial?.slabs?.length ? {} : { slabs: [{ from: 0, percent: '' }] }) });
  }, [open, initial]);
  if (!open || !f) return null;
  const save = async () => {
    setSaving(true);
    const data = { name: f.name, mode: f.mode, percent: n0(f.percent), per_kw: n0(f.per_kw), base: f.base, active: f.active, user_ids: f.user_ids, note: f.note,
      slabs: f.mode === 'slab' ? f.slabs.filter((s) => s.percent !== '').map((s) => ({ from: n0(s.from), percent: n0(s.percent) })) : [] };
    try { if (f.id) await payrollAPI.editRule(f.id, data); else await payrollAPI.addRule(data); toast.success('Saved'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  const toggle = (id) => setF((x) => ({ ...x, user_ids: x.user_ids.includes(id) ? x.user_ids.filter((u) => u !== id) : [...x.user_ids, id] }));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="pay-rule-dialog">
        <DialogHeader><DialogTitle>{f.id ? 'Change rule' : 'Commission rule'}</DialogTitle><DialogDescription>A rule naming people is used for them; a rule naming nobody is for everyone else.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="e.g. Field sales" className="h-11" data-testid="pay-rule-name" /></Field>
          <Field label="Pay"><Select value={f.mode} onValueChange={(v) => setF((x) => ({ ...x, mode: v }))}><SelectTrigger className="h-11" data-testid="pay-rule-mode"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(MODE).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          {f.mode === 'percent' && <Field label="Percent of each payment"><Input value={f.percent} onChange={(e) => setF((x) => ({ ...x, percent: e.target.value }))} inputMode="decimal" placeholder="e.g. 2" className="h-11" data-testid="pay-rule-percent" /></Field>}
          {f.mode === 'per_kw' && <Field label="₹ per kW" hint="Paid in step with the customer's payments: half paid → half the commission"><Input value={f.per_kw} onChange={(e) => setF((x) => ({ ...x, per_kw: e.target.value }))} inputMode="decimal" placeholder="e.g. 1000" className="h-11" /></Field>}
          {f.mode === 'slab' && (
            <div className="space-y-2"><p className="text-xs font-medium text-slate-700">When the month’s collections reach… the % on all of it</p>
              {f.slabs.map((s, i) => (
                <div key={i} className="flex items-center gap-2"><span className="text-xs text-slate-500">from ₹</span>
                  <Input value={s.from} onChange={(e) => setF((x) => ({ ...x, slabs: x.slabs.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)) }))} inputMode="decimal" className="h-10 min-w-0 flex-1" />
                  <Input value={s.percent} onChange={(e) => setF((x) => ({ ...x, slabs: x.slabs.map((y, j) => (j === i ? { ...y, percent: e.target.value } : y)) }))} inputMode="decimal" placeholder="%" className="h-10 w-20" />
                  <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setF((x) => ({ ...x, slabs: x.slabs.filter((_, j) => j !== i) }))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button></div>))}
              <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setF((x) => ({ ...x, slabs: [...x.slabs, { from: '', percent: '' }] }))}><Plus className="h-3.5 w-3.5" />Add slab</Button></div>)}
          {f.mode !== 'per_kw' && <Field label="Count payments"><Select value={f.base} onValueChange={(v) => setF((x) => ({ ...x, base: v }))}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="before_gst">Before GST</SelectItem><SelectItem value="with_gst">With GST (the amount paid)</SelectItem></SelectContent></Select></Field>}
          <div><p className="mb-1 text-xs font-medium text-slate-700">For {f.user_ids.length ? `${f.user_ids.length} people` : 'everyone without their own rule'}</p>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{people.map((p) => (
              <button key={p.id} type="button" onClick={() => toggle(p.id)} className={`rounded-full border px-2.5 py-1 text-xs ${f.user_ids.includes(p.id) ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>{p.name}</button>))}</div></div>
          <label className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 text-sm">In use<Switch checked={f.active} onCheckedChange={(v) => setF((x) => ({ ...x, active: v }))} /></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || f.name.trim().length < 2} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-rule-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Rules({ people, canEdit }) {
  const [rows, setRows] = useState(null);
  const [dlg, setDlg] = useState(null);
  const load = useCallback(() => payrollAPI.rules().then((r) => setRows(r.data)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  if (rows === null) return <Loading />;
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  return (
    <div className="space-y-3" data-testid="pay-rules">
      {canEdit && <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setDlg({})} data-testid="pay-rule-add"><Plus className="h-4 w-4" />Add a rule</Button>}
      {rows.length === 0 ? <Empty icon={Percent} title="No commission rules" text="For example: 2% of every payment before GST, ₹1,000 per kW, or 1% up to ₹5 lakh a month and 1.5% above." /> : (
        <ul className="grid gap-2 md:grid-cols-2">{rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2"><p className="font-medium text-slate-900">{r.name} {!r.active && <Chip>Not in use</Chip>}</p>
              {canEdit && <span className="flex gap-1"><Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit" onClick={() => setDlg(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Delete" onClick={async () => { try { await payrollAPI.deleteRule(r.id); load(); } catch (e) { toast.error(errText(e)); } }}><Trash2 className="h-3.5 w-3.5" /></Button></span>}</div>
            <p className="text-sm text-slate-700">{r.mode === 'percent' ? `${r.percent}% of payments` : r.mode === 'per_kw' ? `₹${r.per_kw} per kW` : r.slabs.map((s) => `${s.percent}% from ${inr(s.from)}`).join(' · ')}{r.mode !== 'per_kw' ? ` · ${r.base === 'with_gst' ? 'with GST' : 'before GST'}` : ''}</p>
            <p className="text-[11px] text-slate-500">{r.user_ids?.length ? r.user_ids.map((u) => names[u] || 'someone who left').join(', ') : 'Everyone without their own rule'}</p>
          </li>))}</ul>)}
      <RuleDialog open={!!dlg} initial={dlg?.id ? dlg : null} people={people} onOpenChange={(o) => !o && setDlg(null)} onSaved={load} />
    </div>
  );
}

export default function PayIncentives({ people, canEdit, canApprove }) {
  const [part, setPart] = useState('commission');
  return (
    <div className="space-y-3" data-testid="pay-incentives">
      <PillTabs value={part} onChange={setPart} testid="pay-inc-tab" label="Incentives"
        tabs={[['commission', 'Sales commission'], ['other', 'Incentive, bonus & other'], ['advances', 'Advances'], ['rules', 'Commission rules']]} />
      <Fragment key={part}>
        {part === 'commission' && <Commission people={people} canEdit={canEdit} canApprove={canApprove} />}
        {part === 'other' && <OtherPay people={people} canEdit={canEdit} canApprove={canApprove} />}
        {part === 'advances' && <Advances people={people} canEdit={canEdit} />}
        {part === 'rules' && <Rules people={people} canEdit={canEdit} />}
      </Fragment>
    </div>
  );
}
