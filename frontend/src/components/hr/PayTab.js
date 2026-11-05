/* HR → Pay & benefits: overview, Salaries, Payroll, Incentives (commission, bonus, advances), Insurance, and the
 * payroll settings (PF / ESI / PT / TDS rates, pay days, who can open payroll). */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Banknote, CalendarClock, Gift, HandCoins, Loader2, Plus, Settings2, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { payrollAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, Empty, Field, Loading, Tile, Tiles, errText, fmtDate, inr, inrShort } from '../kit/PageBits';
import { RUN_STATUS, SubTabs, n0 } from './payBits';
import PaySalaries from './PaySalaries';
import PayrollRun from './PayrollRun';
import PayIncentives from './PayIncentives';
import PayInsurance from './PayInsurance';

const BLUE = '#2a78d6', ORANGE = '#eb6834', GREEN = '#1baf7a';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Overview({ go }) {
  const [d, setD] = useState(null);
  useEffect(() => { payrollAPI.overview().then((r) => setD(r.data)).catch(() => setD(false)); }, []);
  if (d === null) return <Loading />;
  if (!d) return <Empty title="Could not load payroll" />;
  const tm = d.this_month;
  const trend = d.trend.map((t) => ({ month: t.label, 'Net pay': t.net, Deductions: t.deductions, "Company's share": t.employer }));
  return (
    <div className="space-y-3" data-testid="pay-overview">
      <Tiles>
        <Tile label={d.month_label} value={tm ? inr(tm.totals?.to_pay) : 'Not prepared'} sub={tm ? RUN_STATUS[tm.status][0] : 'Prepare it under Payroll'} icon={Banknote}
          tone={tm?.status === 'paid' ? 'good' : tm ? 'warn' : undefined} onClick={() => go('payroll')} testid="pay-ov-month" />
        <Tile label="Salary bill / month" value={inr(d.monthly_gross)} sub={`${inr(d.monthly_cost)} with the company's PF & ESI`} icon={Users} onClick={() => go('salaries')} />
        <Tile label="Waiting for approval" value={d.pending_extras} sub="incentives, bonus & other pay" icon={Gift} tone={d.pending_extras ? 'warn' : undefined} onClick={() => go('incentives')} />
        <Tile label="Advances to recover" value={inr(d.advances.balance)} sub={`${d.advances.count} open`} icon={HandCoins} onClick={() => go('incentives')} />
      </Tiles>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="Payroll by month" sub="What each approved month cost, split three ways" className="lg:col-span-2" testid="pay-ov-trend">
          {trend.length === 0 ? <p className="py-10 text-center text-xs text-slate-400">Nothing yet — the first payroll will show here.</p> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend} margin={{ top: 4, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" interval={0} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => inrShort(v).replace('₹', '')} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={56} />
                <Tooltip formatter={(v) => inr(v)} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Net pay" stackId="a" fill={BLUE} stroke="#fff" strokeWidth={2} />
                <Bar dataKey="Deductions" stackId="a" fill={ORANGE} stroke="#fff" strokeWidth={2} />
                <Bar dataKey="Company's share" stackId="a" fill={GREEN} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>)}
        </Card>
        <Card title="To sort out" testid="pay-ov-todo">
          <ul className="space-y-2 text-sm">
            {d.no_salary.length > 0 && <li className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><button type="button" className="text-left hover:underline" onClick={() => go('salaries')}>No salary for <b>{d.no_salary.slice(0, 3).join(', ')}</b>{d.no_salary.length > 3 ? ` and ${d.no_salary.length - 3} more` : ''} — set it, or mark them “not on payroll”</button></li>}
            {d.missing_uan > 0 && <li className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><button type="button" className="text-left hover:underline" onClick={() => go('salaries')}>{d.missing_uan} without a UAN (needed for the PF return)</button></li>}
            {d.missing_bank > 0 && <li className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><button type="button" className="text-left hover:underline" onClick={() => go('salaries')}>{d.missing_bank} without bank details</button></li>}
            {d.renewals.map((r) => <li key={r.id} className="flex gap-1.5"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><button type="button" className="text-left hover:underline" onClick={() => go('insurance')}><b>{r.name}</b> ends {fmtDate(r.end_date)} ({r.days_left} days)</button></li>)}
            {!d.no_salary.length && !d.missing_uan && !d.missing_bank && !d.renewals.length && <li className="text-xs text-slate-400">Nothing — everyone’s details are in.</li>}
            <li className="flex gap-1.5 text-xs text-slate-500"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />PF and ESI are due by the 15th of the next month.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function SlabEditor({ rows, onChange, valueLabel, testid }) {
  return (
    <div className="space-y-1.5" data-testid={testid}>
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 text-slate-500">{last ? 'above' : 'up to ₹'}</span>
            {last ? <span className="h-9 min-w-0 flex-1 rounded-md bg-slate-50 px-3 leading-9 text-slate-500">{rows.length > 1 ? `₹${Number(rows[i - 1][0] || 0).toLocaleString('en-IN')}` : 'everything'}</span>
              : <Input value={r[0] ?? ''} onChange={(e) => onChange(rows.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} inputMode="decimal" className="h-9 min-w-0 flex-1" />}
            <Input value={r[1] ?? ''} onChange={(e) => onChange(rows.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} inputMode="decimal" className="h-9 w-24" aria-label={valueLabel} />
            <span className="w-6 text-slate-500">{valueLabel}</span>
            {!last && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>}
          </div>);
      })}
      <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => onChange([...rows.slice(0, -1), ['', ''], rows[rows.length - 1]])}><Plus className="h-3.5 w-3.5" />Add slab</Button>
    </div>
  );
}

function Num({ label, value, onChange, hint, testid }) {
  return <Field label={label} hint={hint}><Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="h-10" data-testid={testid} /></Field>;
}

function SettingsDialog({ open, people, onOpenChange }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) payrollAPI.settings().then((r) => setF(JSON.parse(JSON.stringify(r.data)))).catch((e) => toast.error(errText(e))); else setF(null); }, [open]);
  if (!open) return null;
  const sub = (k, kk) => (v) => setF((x) => ({ ...x, [k]: { ...x[k], [kk]: v } }));
  const save = async () => {
    setSaving(true);
    const numify = (o, keys) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, keys.includes(k) ? n0(v) : v]));
    const slabs = (rows) => rows.map((r, i) => [i === rows.length - 1 ? null : n0(r[0]), n0(r[1])]);
    const data = { ...f, pf: numify(f.pf, ['employee_rate', 'employer_rate', 'eps_rate', 'wage_ceiling', 'edli_rate', 'admin_rate']),
      esi: numify(f.esi, ['employee_rate', 'employer_rate', 'wage_limit']), pt: { ...f.pt, slabs: slabs(f.pt.slabs) },
      tds: { ...numify(f.tds, ['standard_deduction', 'rebate_limit', 'rebate_max', 'cess']), slabs: slabs(f.tds.slabs) }, paid_leaves_per_month: n0(f.paid_leaves_per_month) };
    try { await payrollAPI.saveSettings(data); toast.success('Payroll settings saved'); onOpenChange(false); } catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  const sw = (label, checked, onChange, hint, testid) => (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-2.5"><span><span className="block text-sm">{label}</span>{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</span>
      <Switch checked={!!checked} onCheckedChange={onChange} aria-label={label} data-testid={testid} /></label>);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto" data-testid="pay-settings-dialog">
        <DialogHeader><DialogTitle>Payroll settings</DialogTitle><DialogDescription>Rates change from time to time — check them with your auditor. Changes apply to payroll you prepare or recalculate from now on.</DialogDescription></DialogHeader>
        {!f ? <Loading /> : (
          <div className="space-y-5">
            <section className="space-y-2"><p className="text-sm font-semibold text-slate-900">Pay days</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Name on payslips"><Input value={f.employer_name || ''} onChange={(e) => setF((x) => ({ ...x, employer_name: e.target.value }))} placeholder={f.employer_name_default} className="h-10" /></Field>
                <Field label="A month's salary is for"><Select value={f.pay_days} onValueChange={(v) => setF((x) => ({ ...x, pay_days: v }))}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="calendar">The days in that month</SelectItem><SelectItem value="fixed_26">26 days</SelectItem><SelectItem value="fixed_30">30 days</SelectItem></SelectContent></Select></Field>
              </div>
              {sw('Count unpaid days from attendance', f.lop_from_attendance, (v) => setF((x) => ({ ...x, lop_from_attendance: v })), 'Working days with no check-in (after the free days below) are cut. HR can still change each person.', 'pay-set-lop')}
              <div className="grid grid-cols-2 gap-2">
                <Num label="Free absences a month" value={f.paid_leaves_per_month} onChange={(v) => setF((x) => ({ ...x, paid_leaves_per_month: v }))} />
                <Field label="Weekly off"><div className="flex flex-wrap gap-1">{DAYS.map((d, i) => (
                  <button key={d} type="button" onClick={() => setF((x) => ({ ...x, weekly_off: x.weekly_off.includes(i) ? x.weekly_off.filter((y) => y !== i) : [...x.weekly_off, i] }))}
                    className={`rounded-full border px-2.5 py-1 text-xs ${f.weekly_off.includes(i) ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>{d}</button>))}</div></Field>
              </div>
            </section>
            <section className="space-y-2"><p className="text-sm font-semibold text-slate-900">Provident fund (PF)</p>
              {sw('Take PF', f.pf.enabled, sub('pf', 'enabled'))}
              <div className="grid grid-cols-3 gap-2">
                <Num label="Employee %" value={f.pf.employee_rate} onChange={sub('pf', 'employee_rate')} />
                <Num label="Employer %" value={f.pf.employer_rate} onChange={sub('pf', 'employer_rate')} />
                <Num label="Of which pension (EPS) %" value={f.pf.eps_rate} onChange={sub('pf', 'eps_rate')} />
                <Num label="Wage ceiling ₹" value={f.pf.wage_ceiling} onChange={sub('pf', 'wage_ceiling')} hint="₹25,000 from 17 Sep 2026" testid="pay-set-ceiling" />
                <Num label="EDLI %" value={f.pf.edli_rate} onChange={sub('pf', 'edli_rate')} />
                <Num label="Admin charges %" value={f.pf.admin_rate} onChange={sub('pf', 'admin_rate')} />
              </div>
              {sw('Stop at the ceiling', f.pf.cap_at_ceiling, sub('pf', 'cap_at_ceiling'), 'Off = the company pays PF on full wages for everyone')}
              {sw('Labour-code wages', f.pf.labour_code_wages, sub('pf', 'labour_code_wages'), 'PF wages are never less than half the fixed pay (Code on Wages)')}
              <Field label="PF establishment code"><Input value={f.pf.establishment_code || ''} onChange={(e) => sub('pf', 'establishment_code')(e.target.value)} className="h-10 uppercase" /></Field>
            </section>
            <section className="space-y-2"><p className="text-sm font-semibold text-slate-900">ESI</p>
              {sw('Take ESI', f.esi.enabled, sub('esi', 'enabled'))}
              <div className="grid grid-cols-3 gap-2">
                <Num label="Employee %" value={f.esi.employee_rate} onChange={sub('esi', 'employee_rate')} />
                <Num label="Employer %" value={f.esi.employer_rate} onChange={sub('esi', 'employer_rate')} />
                <Num label="For gross up to ₹" value={f.esi.wage_limit} onChange={sub('esi', 'wage_limit')} />
              </div>
              <Field label="ESI employer code"><Input value={f.esi.employer_code || ''} onChange={(e) => sub('esi', 'employer_code')(e.target.value)} className="h-10" /></Field>
            </section>
            <section className="space-y-2"><p className="text-sm font-semibold text-slate-900">Professional tax</p>
              {sw('Take professional tax', f.pt.enabled, sub('pt', 'enabled'))}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Taken"><Select value={f.pt.mode} onValueChange={sub('pt', 'mode')}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="half_yearly">Twice a year (half-yearly)</SelectItem><SelectItem value="monthly">A sixth every month</SelectItem></SelectContent></Select></Field>
                {f.pt.mode === 'half_yearly' && <Field label="In the months of"><div className="flex flex-wrap gap-1">{MONTHS.slice(1).map((m, i) => (
                  <button key={m} type="button" onClick={() => setF((x) => { const cur = x.pt.months.includes(i + 1) ? x.pt.months.filter((y) => y !== i + 1) : [...x.pt.months, i + 1].slice(-2); return { ...x, pt: { ...x.pt, months: cur } }; })}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${f.pt.months.includes(i + 1) ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>{m}</button>))}</div></Field>}
              </div>
              <p className="text-[11px] text-slate-500">Half-year income → tax for the half-year. Tamil Nadu rates differ a little between corporations and municipalities — check yours (Coimbatore, Erode…).</p>
              <SlabEditor rows={f.pt.slabs} onChange={(v) => sub('pt', 'slabs')(v)} valueLabel="₹" testid="pay-set-pt" />
            </section>
            <section className="space-y-2"><p className="text-sm font-semibold text-slate-900">Income tax (TDS, new regime)</p>
              {sw('Work out TDS', f.tds.enabled, sub('tds', 'enabled'), 'Each person can also be fixed or set to none')}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Num label="Standard deduction ₹" value={f.tds.standard_deduction} onChange={sub('tds', 'standard_deduction')} />
                <Num label="No tax up to ₹" value={f.tds.rebate_limit} onChange={sub('tds', 'rebate_limit')} hint="87A rebate" />
                <Num label="Rebate up to ₹" value={f.tds.rebate_max} onChange={sub('tds', 'rebate_max')} />
                <Num label="Cess %" value={f.tds.cess} onChange={sub('tds', 'cess')} />
              </div>
              <SlabEditor rows={f.tds.slabs} onChange={(v) => sub('tds', 'slabs')(v)} valueLabel="%" />
            </section>
            <section className="space-y-2"><p className="text-sm font-semibold text-slate-900">Who can open payroll</p>
              <p className="text-[11px] text-slate-500">Admins always can. Roles given Payroll in Settings → Permissions can too — pick people here to allow only them.</p>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{people.map((p) => (
                <button key={p.id} type="button" onClick={() => setF((x) => ({ ...x, people_allowed: x.people_allowed.includes(p.id) ? x.people_allowed.filter((u) => u !== p.id) : [...x.people_allowed, p.id] }))}
                  className={`rounded-full border px-2.5 py-1 text-xs ${f.people_allowed.includes(p.id) ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>{p.name}</button>))}</div>
            </section>
          </div>)}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !f} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-set-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PayTab() {
  const { isAdmin, can } = useAuth();
  const canEdit = isAdmin || can('module_payroll', 'edit');
  const canApprove = isAdmin || (can('module_payroll', 'edit') && can('can_approve_payroll'));
  const [params, setParams] = useSearchParams();
  const part = params.get('pay') || 'overview';
  const go = (p) => setParams((x) => { const n = new URLSearchParams(x); n.set('tab', 'pay'); n.set('pay', p); return n; }, { replace: true });
  const [people, setPeople] = useState(null);
  const [setOpen, setSetOpen] = useState(false);
  const loadPeople = useCallback(() => payrollAPI.people().then((r) => setPeople(r.data)).catch((e) => { toast.error(errText(e, 'Could not load payroll')); setPeople([]); }), []);
  useEffect(() => { loadPeople(); }, [loadPeople]);
  const pick = (people || []).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, department: p.department }));
  return (
    <div className="space-y-3" data-testid="pay-tab">
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 sm:flex-1"><SubTabs value={part} onChange={go} testid="pay-part" label="Pay & benefits"
          tabs={[['overview', 'Overview'], ['salaries', 'Salaries'], ['payroll', 'Payroll'], ['incentives', 'Incentives & commission'], ['insurance', 'Insurance']]} /></div>
        {isAdmin && <Button variant="outline" className="h-10 gap-1.5 self-end sm:mb-1" onClick={() => setSetOpen(true)} data-testid="pay-settings-btn"><Settings2 className="h-4 w-4" />Payroll settings</Button>}
      </div>
      {part === 'overview' && <Overview go={go} />}
      {part === 'salaries' && <PaySalaries people={people} reload={loadPeople} canEdit={canEdit} />}
      {part === 'payroll' && <PayrollRun canEdit={canEdit} canApprove={canApprove} initialMonth={params.get('month')} />}
      {part === 'incentives' && <PayIncentives people={pick} canEdit={canEdit} canApprove={canApprove} />}
      {part === 'insurance' && <PayInsurance people={pick} canEdit={canEdit} />}
      <SettingsDialog open={setOpen} people={pick} onOpenChange={setSetOpen} />
    </div>
  );
}
