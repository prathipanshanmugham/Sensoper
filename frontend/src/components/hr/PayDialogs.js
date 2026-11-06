/* Dialogs for Pay & benefits: set a salary (with a live take-home preview), PF / ESI / tax / bank details,
 * an incentive / bonus / deduction, and a salary advance. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { payrollAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, errText, inr, inputCls, todayISO } from '../kit/PageBits';
import { EMPLOYMENT, KIND, MoneyRows, PersonPick, monthLabel, n0, thisMonth } from './payBits';

const COMP = [['basic', 'Basic *'], ['da', 'Dearness allowance (DA)'], ['hra', 'HRA'], ['conveyance', 'Conveyance'], ['special', 'Special allowance']];

function Rows({ rows, onChange, addLabel, testid }) {
  return (
    <div className="space-y-2" data-testid={testid}>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input value={r.name} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name (e.g. Mobile, Fuel)" className="h-10 min-w-0 flex-1" />
          <Input value={r.amount} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} inputMode="decimal" placeholder="₹ / month" className="h-10 w-28" />
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
        </div>))}
      <Button type="button" variant="outline" size="sm" className="h-9 gap-1" onClick={() => onChange([...rows, { name: '', amount: '' }])}><Plus className="h-3.5 w-3.5" />{addLabel}</Button>
    </div>
  );
}

export function SalaryDialog({ person, current, profile, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [split, setSplit] = useState('');
  const [prev, setPrev] = useState(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    if (!person) return;
    const c = current || {};
    setF({ effective_from: thisMonth(), basic: c.basic || '', da: c.da || '', hra: c.hra || '', conveyance: c.conveyance || '', special: c.special || '',
      others: (c.others || []).map((o) => ({ ...o })), deductions: (c.deductions || []).map((o) => ({ ...o })), note: '' });
    setSplit(''); setPrev(null);
  }, [person, current]);
  const body = useMemo(() => f && ({ ...f, ...Object.fromEntries(COMP.map(([k]) => [k, n0(f[k])])),
    others: f.others.filter((o) => n0(o.amount) > 0).map((o) => ({ name: o.name || 'Allowance', amount: n0(o.amount) })),
    deductions: f.deductions.filter((o) => n0(o.amount) > 0).map((o) => ({ name: o.name || 'Deduction', amount: n0(o.amount) })) }), [f]);
  useEffect(() => {
    if (!body) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (body.basic <= 0) { setPrev(null); return; }
      payrollAPI.preview({ structure: body, profile: profile ? { pf_applicable: profile.pf_applicable, esi_applicable: profile.esi_applicable, pt_applicable: profile.pt_applicable,
        tds_mode: profile.tds_mode, tds_fixed: profile.tds_fixed, pf_full_wages: profile.pf_full_wages, eps_member: profile.eps_member } : null })
        .then((r) => setPrev(r.data)).catch(() => setPrev(null));
    }, 350);
    return () => clearTimeout(timer.current);
  }, [body, profile]);
  if (!person || !f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const doSplit = () => {
    const g = n0(split);
    if (g <= 0) return;
    const basic = Math.round(g * 0.5); const hra = Math.round(g * 0.2);
    setF((x) => ({ ...x, basic, da: '', hra, conveyance: '', special: g - basic - hra, others: [] }));
  };
  const save = async () => {
    setSaving(true);
    try { await payrollAPI.setSalary(person.id, body); toast.success(`Salary saved from ${monthLabel(f.effective_from)}`); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not save the salary')); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" data-testid="pay-salary-dialog">
        <DialogHeader><DialogTitle>Salary for {person.name}</DialogTitle><DialogDescription>Monthly amounts. A change applies from the month you choose; earlier months keep the old salary.</DialogDescription></DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Applies from"><input type="month" value={f.effective_from} onChange={set('effective_from')} className={inputCls} data-testid="pay-salary-from" /></Field>
              <Field label="Quick split of a monthly gross" hint="Basic 50% · HRA 20% · rest special">
                <div className="flex gap-1.5"><Input value={split} onChange={(e) => setSplit(e.target.value)} inputMode="decimal" placeholder="₹ gross" className="h-11 min-w-0" data-testid="pay-salary-split" />
                  <Button type="button" variant="outline" className="h-11 shrink-0 px-2.5" onClick={doSplit} aria-label="Split" data-testid="pay-salary-split-go"><Wand2 className="h-4 w-4" /></Button></div>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {COMP.map(([k, l]) => <Field key={k} label={l}><Input value={f[k]} onChange={set(k)} inputMode="decimal" placeholder="0" className="h-11" data-testid={`pay-salary-${k}`} /></Field>)}
            </div>
            <div><p className="mb-1 text-xs font-medium text-slate-700">Other monthly allowances</p><Rows rows={f.others} onChange={(v) => setF((x) => ({ ...x, others: v }))} addLabel="Add an allowance" /></div>
            <div><p className="mb-1 text-xs font-medium text-slate-700">Fixed deductions every month</p><Rows rows={f.deductions} onChange={(v) => setF((x) => ({ ...x, deductions: v }))} addLabel="Add a deduction" /></div>
            <Field label="Note (why it changed)"><Input value={f.note} onChange={set('note')} placeholder="e.g. Annual increment" className="h-11" /></Field>
          </div>
          <aside className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 md:self-start" data-testid="pay-salary-preview">
            <p className="text-xs font-semibold text-emerald-800">A normal month</p>
            {!prev ? <p className="text-xs text-slate-500">Enter the basic to see the take-home.</p> : (<>
              <MoneyRows rows={[{ label: 'Gross pay', amount: prev.gross }, ...prev.deductions.map((d) => ({ label: `− ${d.label}`, amount: d.amount }))]}
                total={prev.net} totalLabel="Take-home" tone="green" />
              <p className="text-[11px] text-slate-500">PT shown as a monthly average; TDS as a full-year average.</p>
              <div className="border-t border-emerald-100 pt-2"><p className="mb-1 text-[11px] font-medium text-slate-600">Company pays on top</p><MoneyRows rows={prev.employer} total={prev.cost} totalLabel="Cost to company / month" /></div>
              <p className="text-sm font-semibold text-slate-900">CTC {inr(prev.annual_ctc)} / year</p>
            </>)}
          </aside>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || n0(f.basic) <= 0} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-salary-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save salary'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ label, hint, checked, onChange, testid }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
      <span><span className="block text-sm text-slate-800">{label}</span>{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</span>
      <Switch checked={!!checked} onCheckedChange={onChange} aria-label={label} data-testid={testid} />
    </label>
  );
}

export function ProfileDialog({ person, profile, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (person && profile) setF({ ...profile, tds_fixed: profile.tds_fixed ?? '' }); }, [person, profile]);
  if (!person || !f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pick = (k, opts, testid) => (
    <Select value={f[k] || opts[0][0]} onValueChange={(v) => setF((x) => ({ ...x, [k]: v }))}>
      <SelectTrigger className="h-11" data-testid={testid}><SelectValue /></SelectTrigger>
      <SelectContent>{opts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
  const save = async () => {
    setSaving(true);
    const keys = ['on_payroll', 'employment_type', 'uan', 'pf_member_id', 'esi_number', 'pan', 'date_of_birth', 'bank_name', 'account_holder', 'account_number', 'ifsc', 'pay_mode',
      'pf_applicable', 'pf_full_wages', 'eps_member', 'esi_applicable', 'pt_applicable', 'tds_mode', 'notes'];
    const data = Object.fromEntries(keys.map((k) => [k, f[k] ?? null]));
    data.tds_fixed = f.tds_mode === 'fixed' ? n0(f.tds_fixed) : null;
    data.fy_opening_income = f.fy_opening_income === '' || f.fy_opening_income == null ? 0 : n0(f.fy_opening_income);
    data.fy_opening_tds = f.fy_opening_tds === '' || f.fy_opening_tds == null ? 0 : n0(f.fy_opening_tds);
    try { await payrollAPI.saveProfile(person.id, data); toast.success('Saved'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto" data-testid="pay-profile-dialog">
        <DialogHeader><DialogTitle>PF, ESI, tax & bank — {person.name}</DialogTitle><DialogDescription>Used on payslips and in the bank, PF and ESI files.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Employment">{pick('employment_type', EMPLOYMENT, 'pay-prof-type')}</Field>
            <Field label="Date of birth"><input type="date" value={f.date_of_birth || ''} onChange={set('date_of_birth')} className={inputCls} /></Field>
            <Field label="UAN (PF)" hint="12 digits"><Input value={f.uan || ''} onChange={set('uan')} inputMode="numeric" className="h-11" data-testid="pay-prof-uan" /></Field>
            <Field label="PF member ID"><Input value={f.pf_member_id || ''} onChange={set('pf_member_id')} className="h-11" /></Field>
            <Field label="ESI (IP) number" hint="10 digits"><Input value={f.esi_number || ''} onChange={set('esi_number')} inputMode="numeric" className="h-11" data-testid="pay-prof-esi" /></Field>
            <Field label="PAN"><Input value={f.pan || ''} onChange={set('pan')} className="h-11 uppercase" data-testid="pay-prof-pan" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Paid by">{pick('pay_mode', [['bank', 'Bank transfer'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['upi', 'UPI']], 'pay-prof-mode')}</Field>
            <Field label="Bank"><Input value={f.bank_name || ''} onChange={set('bank_name')} placeholder="e.g. SBI, Erode main" className="h-11" /></Field>
            <Field label="Name on the account"><Input value={f.account_holder || ''} onChange={set('account_holder')} placeholder={person.name} className="h-11" /></Field>
            <Field label="Account number"><Input value={f.account_number || ''} onChange={set('account_number')} inputMode="numeric" className="h-11" data-testid="pay-prof-account" /></Field>
            <Field label="IFSC"><Input value={f.ifsc || ''} onChange={set('ifsc')} className="h-11 uppercase" data-testid="pay-prof-ifsc" /></Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="On payroll" hint="Off for partners and directors paid outside payroll" checked={f.on_payroll} onChange={(v) => setF((x) => ({ ...x, on_payroll: v }))} />
            <Toggle label="PF" hint="12% from them, 12% from the company" checked={f.pf_applicable} onChange={(v) => setF((x) => ({ ...x, pf_applicable: v }))} testid="pay-prof-pf" />
            <Toggle label="PF on full wages" hint="They chose to pay PF above the ceiling" checked={f.pf_full_wages} onChange={(v) => setF((x) => ({ ...x, pf_full_wages: v }))} />
            <Toggle label="Pension (EPS) member" hint="Off for anyone not in EPS" checked={f.eps_member} onChange={(v) => setF((x) => ({ ...x, eps_member: v }))} />
            <Toggle label="Professional tax" checked={f.pt_applicable} onChange={(v) => setF((x) => ({ ...x, pt_applicable: v }))} />
            <Field label="ESI">{pick('esi_applicable', [['auto', 'Automatic (by pay)'], ['yes', 'Always'], ['no', 'Never']], 'pay-prof-esi-mode')}</Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Income tax (TDS)">{pick('tds_mode', [['estimate', 'Work it out (new regime)'], ['fixed', 'Fixed amount a month'], ['none', 'No TDS']], 'pay-prof-tds')}</Field>
            {f.tds_mode === 'fixed' && <Field label="TDS a month"><Input value={f.tds_fixed} onChange={set('tds_fixed')} inputMode="decimal" className="h-11" /></Field>}
          </div>
          {f.tds_mode === 'estimate' && (
            <div className="rounded-lg border border-slate-200 p-2.5">
              <p className="text-xs font-medium text-slate-700">Earlier this financial year, before payroll here</p>
              <p className="mb-2 text-[11px] text-slate-500">Leave blank and the months not paid here count at their salary, with no TDS taken then.</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Salary paid (₹)"><Input value={f.fy_opening_income ?? ''} onChange={set('fy_opening_income')} inputMode="decimal" className="h-11" data-testid="pay-prof-open-income" /></Field>
                <Field label="TDS already taken (₹)"><Input value={f.fy_opening_tds ?? ''} onChange={set('fy_opening_tds')} inputMode="decimal" className="h-11" /></Field>
              </div>
            </div>)}
          <Field label="Notes"><Input value={f.notes || ''} onChange={set('notes')} className="h-11" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-prof-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExtraDialog({ open, people, initial, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ user_id: '', month: thisMonth(), kind: 'incentive', amount: '', reason: '', ...(initial || {}) }); }, [open, initial]);
  if (!open || !f) return null;
  const editing = !!f.id;
  const save = async () => {
    setSaving(true);
    const data = { user_id: f.user_id, month: f.month, kind: f.kind, amount: n0(f.amount), reason: f.reason };
    try { if (editing) await payrollAPI.editExtra(f.id, data); else await payrollAPI.addExtra(data); toast.success(editing ? 'Saved' : 'Added — waiting for approval'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="pay-extra-dialog">
        <DialogHeader><DialogTitle>{editing ? 'Change entry' : 'Add to someone’s pay'}</DialogTitle><DialogDescription>It goes into that month’s payroll once approved.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Person" className="col-span-2">{editing ? <p className="text-sm font-medium">{f.user_name}</p> : <PersonPick people={people} value={f.user_id} onChange={(v) => setF((x) => ({ ...x, user_id: v }))} testid="pay-extra-person" />}</Field>
          <Field label="What">
            <Select value={f.kind} onValueChange={(v) => setF((x) => ({ ...x, kind: v }))} disabled={editing}>
              <SelectTrigger className="h-11" data-testid="pay-extra-kind"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(KIND).filter(([k]) => k !== 'commission').map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Pay with"><input type="month" value={f.month} onChange={(e) => setF((x) => ({ ...x, month: e.target.value }))} className={inputCls} /></Field>
          <Field label="Amount (₹)"><Input value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} inputMode="decimal" className="h-11" data-testid="pay-extra-amount" /></Field>
          <Field label="Reason"><Input value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} placeholder={f.kind === 'deduction' ? 'e.g. Lost tool' : 'e.g. Target hit'} className="h-11" data-testid="pay-extra-reason" /></Field>
        </div>
        {f.kind === 'reimbursement' && <p className="text-[11px] text-slate-500">Reimbursements aren’t taxed and don’t count for ESI.</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !f.user_id || n0(f.amount) <= 0} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-extra-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdvanceDialog({ open, people, presetUser, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ user_id: presetUser || '', amount: '', monthly: '', given_on: todayISO(), start_month: thisMonth(), reason: '' }); }, [open, presetUser]);
  if (!open || !f) return null;
  const months = n0(f.monthly) > 0 ? Math.ceil(n0(f.amount) / n0(f.monthly)) : 0;
  const save = async () => {
    setSaving(true);
    try { await payrollAPI.addAdvance({ ...f, amount: n0(f.amount), monthly: n0(f.monthly) }); toast.success('Advance recorded'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="pay-advance-dialog">
        <DialogHeader><DialogTitle>Salary advance</DialogTitle><DialogDescription>Recovered from salary each month until it’s paid back.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Person" className="col-span-2"><PersonPick people={people} value={f.user_id} onChange={(v) => setF((x) => ({ ...x, user_id: v }))} testid="pay-adv-person" /></Field>
          <Field label="Amount given (₹)"><Input value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} inputMode="decimal" className="h-11" data-testid="pay-adv-amount" /></Field>
          <Field label="Given on"><input type="date" value={f.given_on} onChange={(e) => setF((x) => ({ ...x, given_on: e.target.value }))} className={inputCls} /></Field>
          <Field label="Recover a month (₹)" hint={months ? `About ${months} month${months > 1 ? 's' : ''}` : ''}><Input value={f.monthly} onChange={(e) => setF((x) => ({ ...x, monthly: e.target.value }))} inputMode="decimal" className="h-11" data-testid="pay-adv-monthly" /></Field>
          <Field label="Start recovering in"><input type="month" value={f.start_month} onChange={(e) => setF((x) => ({ ...x, start_month: e.target.value }))} className={inputCls} /></Field>
          <Field label="Reason" className="col-span-2"><Input value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} className="h-11" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !f.user_id || n0(f.amount) <= 0 || n0(f.monthly) <= 0} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-adv-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
