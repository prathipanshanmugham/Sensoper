/* Pay & benefits → Salaries: everyone's pay at a glance, and one person's full pay record (salary and its history,
 * PF / ESI / bank details, insurance, advances, incentives, payslips, gratuity). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, FileText, HandCoins, Pencil, ShieldCheck, Trash2, Wallet } from 'lucide-react';
import { payrollAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { Card, Chip, Empty, Loading, Tile, Tiles, errText, fmtDate, inr } from '../kit/PageBits';
import { COVER, EXTRA_STATUS, MoneyRows, StatusChip, monthLabel, openPdf } from './payBits';
import { AdvanceDialog, ProfileDialog, SalaryDialog } from './PayDialogs';

const MISSING = { salary: 'No salary', UAN: 'No UAN', bank: 'No bank account' };

export function PersonPaySheet({ personId, people, canEdit, onOpenChange, onChanged }) {
  const [d, setD] = useState(null);
  const [dlg, setDlg] = useState(null);     // 'salary' | 'profile' | 'advance'
  const load = useCallback(() => (personId ? payrollAPI.person(personId).then((r) => setD(r.data)).catch((e) => { toast.error(errText(e)); setD(false); }) : null), [personId]);
  useEffect(() => { setD(null); load(); }, [load]);
  if (!personId) return null;
  const changed = () => { load(); onChanged?.(); };
  const latest = d && d.history?.[0];
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-testid="pay-person-sheet">
        {d === null ? <Loading /> : !d ? <Empty title="Could not load" /> : (
          <div className="space-y-4">
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle>{d.name}</SheetTitle>
              <SheetDescription>{[d.designation, d.department, d.employee_code, d.joining_date && `joined ${fmtDate(d.joining_date)}`].filter(Boolean).join(' · ')}</SheetDescription>
            </SheetHeader>
            <Tiles>
              <Tile label="Gross / month" value={inr(d.structure?.gross || 0)} sub={d.structure ? `from ${monthLabel(d.structure.effective_from, true)}` : 'not set'} />
              <Tile label="Take-home" value={d.estimate ? inr(d.estimate.net) : '—'} sub="a normal month" tone={d.estimate ? 'good' : undefined} />
              <Tile label={`Paid in ${d.fy}`} value={inr(d.ytd?.net || 0)} sub={`TDS ${inr(d.ytd?.tds || 0)} · PF ${inr(d.ytd?.pf_ee || 0)}`} />
              <Tile label="Gratuity today" value={d.gratuity.eligible ? inr(d.gratuity.amount) : 'Not yet'} sub={`${d.gratuity.service} of service`} />
            </Tiles>
            <Card title="Salary" sub={d.structure ? `In force from ${monthLabel(d.structure.effective_from)}` : 'No salary set yet'}
              action={canEdit && <Button size="sm" className="h-8 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setDlg('salary')} data-testid="pay-person-salary"><Wallet className="h-3.5 w-3.5" />{d.structure ? 'Change' : 'Set salary'}</Button>}>
              {d.estimate ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><p className="mb-1 text-[11px] font-medium uppercase text-slate-500">Earnings</p><MoneyRows rows={d.estimate.earnings} total={d.estimate.gross} totalLabel="Gross" /></div>
                  <div><p className="mb-1 text-[11px] font-medium uppercase text-slate-500">Deductions (normal month)</p><MoneyRows rows={d.estimate.deductions} total={d.estimate.net} totalLabel="Take-home" tone="green" /></div>
                  <div className="sm:col-span-2"><p className="mb-1 text-[11px] font-medium uppercase text-slate-500">Company pays on top</p><MoneyRows rows={d.estimate.employer} total={d.estimate.cost} totalLabel="Cost to company / month" /></div>
                </div>) : <p className="text-sm text-slate-500">Set a salary to put {d.name.split(' ')[0]} on payroll.</p>}
              {d.history.length > 0 && (
                <details className="mt-3 text-sm"><summary className="cursor-pointer text-xs font-medium text-emerald-700">Salary history ({d.history.length})</summary>
                  <ul className="mt-2 divide-y divide-slate-100">{d.history.map((h) => (
                    <li key={h.effective_from} className="flex items-center justify-between gap-2 py-1.5">
                      <span><b>{monthLabel(h.effective_from)}</b> · {inr(h.gross)}{h.note && <span className="text-xs text-slate-500"> · {h.note}</span>}<span className="block text-[11px] text-slate-400">by {h.by}</span></span>
                      {canEdit && h === latest && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove this revision"
                        onClick={async () => { try { await payrollAPI.dropSalary(d.id, h.effective_from); toast.success('Removed'); changed(); } catch (e) { toast.error(errText(e)); } }}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </li>))}</ul></details>)}
            </Card>
            <Card title="PF, ESI, tax & bank" action={canEdit && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setDlg('profile')} data-testid="pay-person-profile"><Pencil className="h-3.5 w-3.5" />Edit</Button>}>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                {[['UAN', d.profile.uan], ['ESI number', d.profile.esi_number], ['PAN', d.profile.pan], ['Paid by', d.profile.pay_mode === 'bank' ? `${d.profile.bank_name || 'Bank'} ${d.profile.account_masked || ''}` : d.profile.pay_mode],
                  ['IFSC', d.profile.ifsc], ['TDS', { estimate: 'Worked out', fixed: `${inr(d.profile.tds_fixed)} a month`, none: 'None' }[d.profile.tds_mode]],
                  ['PF', d.profile.pf_applicable ? (d.profile.pf_full_wages ? 'Yes — on full wages' : 'Yes') : 'No'], ['ESI', { auto: 'By pay', yes: 'Always', no: 'Never' }[d.profile.esi_applicable]]].map(([k, v]) => (
                  <div key={k} className="min-w-0"><dt className="text-[11px] text-slate-500">{k}</dt><dd className="truncate text-slate-900">{v || <span className="text-amber-700">not set</span>}</dd></div>))}
              </dl>
            </Card>
            <Card title="Insurance" sub={d.insurance.length ? undefined : 'Not on any policy — add them from the Insurance tab'}>
              <ul className="space-y-2 text-sm">{d.insurance.map((p) => (
                <li key={p.id} className="rounded-lg bg-slate-50 p-2"><p className="font-medium text-slate-900"><ShieldCheck className="mr-1 inline h-4 w-4 text-emerald-600" />{p.name}</p>
                  <p className="text-xs text-slate-600">{[p.insurer, p.member && COVER[p.member.cover], p.member?.member_number, `till ${fmtDate(p.end_date)}`].filter(Boolean).join(' · ')}</p>
                  {p.member?.dependants?.length > 0 && <p className="text-[11px] text-slate-500">Covers {p.member.dependants.map((x) => `${x.name} (${x.relation})`).join(', ')}</p>}
                  {p.claims.length > 0 && <p className="text-[11px] text-slate-500">{p.claims.length} claim{p.claims.length > 1 ? 's' : ''}</p>}</li>))}</ul>
            </Card>
            <Card title="Salary advances" action={canEdit && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setDlg('advance')} data-testid="pay-person-advance"><HandCoins className="h-3.5 w-3.5" />Give</Button>}>
              {d.advances.length === 0 ? <p className="text-xs text-slate-400">None</p> : <ul className="divide-y divide-slate-100 text-sm">{d.advances.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-1.5"><span>{inr(a.amount)} on {fmtDate(a.given_on)}<span className="block text-[11px] text-slate-500">{inr(a.monthly)} a month from {monthLabel(a.start_month, true)}{a.reason ? ` · ${a.reason}` : ''}</span></span>
                  <Chip tone={a.status === 'closed' ? 'green' : 'amber'}>{a.status === 'closed' ? 'Paid back' : `${inr(a.balance)} left`}</Chip></li>))}</ul>}
            </Card>
            {d.extras.length > 0 && (
              <Card title="Incentives, bonus & other pay">
                <ul className="divide-y divide-slate-100 text-sm">{d.extras.slice(0, 12).map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0"><span className="block truncate">{x.label}</span><span className="text-[11px] text-slate-500">{monthLabel(x.month, true)}</span></span>
                    <span className="flex shrink-0 items-center gap-1.5"><span className={`tabular-nums ${x.kind === 'deduction' ? 'text-rose-700' : 'text-slate-900'}`}>{x.kind === 'deduction' ? '−' : ''}{inr(x.amount)}</span><StatusChip map={EXTRA_STATUS} value={x.status} /></span></li>))}</ul>
              </Card>)}
            <Card title="Payslips">
              {d.payslips.length === 0 ? <p className="text-xs text-slate-400">None yet</p> : <ul className="divide-y divide-slate-100 text-sm">{d.payslips.map((s) => (
                <li key={s.month} className="flex items-center justify-between gap-2 py-1.5"><span>{monthLabel(s.month)} · <b>{inr(s.net)}</b></span>
                  <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => openPdf(payrollAPI.payslip(s.month, d.id), `payslip-${s.month}.pdf`)}><FileText className="h-3.5 w-3.5" />Payslip</Button></li>))}</ul>}
            </Card>
          </div>)}
        {d && dlg === 'salary' && <SalaryDialog person={d} current={d.structure} profile={d.profile} onOpenChange={() => setDlg(null)} onSaved={changed} />}
        {d && dlg === 'profile' && <ProfileDialog person={d} profile={d.profile} onOpenChange={() => setDlg(null)} onSaved={changed} />}
        {d && <AdvanceDialog open={dlg === 'advance'} people={people} presetUser={d.id} onOpenChange={() => setDlg(null)} onSaved={changed} />}
      </SheetContent>
    </Sheet>
  );
}

export default function PaySalaries({ people, reload, canEdit }) {
  const [q, setQ] = useState('');
  const [attention, setAttention] = useState(false);
  const [open, setOpen] = useState(null);
  const shown = useMemo(() => (people || []).filter((p) => (!attention || p.missing.length) && (!q || `${p.name} ${p.designation || ''} ${p.department || ''} ${p.employee_code || ''}`.toLowerCase().includes(q.toLowerCase()))), [people, q, attention]);
  if (!people) return <Loading />;
  const needs = people.filter((p) => p.missing.length).length;
  return (
    <div className="space-y-3" data-testid="pay-salaries">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" className="h-10 w-full bg-white sm:w-64" data-testid="pay-salaries-search" />
        <Button variant={attention ? 'default' : 'outline'} className={`h-10 gap-1.5 ${attention ? 'bg-amber-500 text-white hover:bg-amber-600' : ''}`} onClick={() => setAttention((v) => !v)} data-testid="pay-salaries-attention">
          <AlertTriangle className="h-4 w-4" />Needs details ({needs})</Button>
      </div>
      {shown.length === 0 && <Empty title={attention ? 'Everyone’s details are complete' : 'Nobody matches'} />}
      <ul className="space-y-2 md:hidden">{shown.map((p) => (
        <li key={p.id}><button type="button" onClick={() => setOpen(p.id)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left" data-testid={`pay-row-${p.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="truncate font-medium text-slate-900">{p.name}</p><p className="truncate text-xs text-slate-600">{[p.designation, p.department].filter(Boolean).join(' · ') || '—'}</p></div>
            <div className="shrink-0 text-right"><p className="font-semibold tabular-nums text-slate-900">{p.gross ? inr(p.gross) : '—'}</p><p className="text-[11px] text-slate-500">{p.net != null ? `${inr(p.net)} take-home` : ''}</p></div>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">{p.pf && <Chip tone="blue">PF</Chip>}{p.esi && <Chip tone="violet">ESI</Chip>}{p.insurance.length > 0 && <Chip tone="green">Insured</Chip>}
            {p.advance_balance > 0 && <Chip>{inr(p.advance_balance)} advance</Chip>}{!p.on_payroll && <Chip>Not on payroll</Chip>}{p.missing.map((m) => <Chip key={m} tone="amber">{MISSING[m]}</Chip>)}</div>
        </button></li>))}</ul>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Name', 'Department', 'Gross / month', 'Take-home', 'Cost to company', 'Covered', 'Needs'].map((h, i) => <th key={h} className={`p-2 font-medium ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{shown.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-emerald-50/40" onClick={() => setOpen(p.id)} data-testid={`pay-trow-${p.id}`}>
              <td className="p-2"><span className="font-medium text-slate-900">{p.name}</span><span className="block text-[11px] text-slate-500">{[p.employee_code, p.designation].filter(Boolean).join(' · ')}</span></td>
              <td className="p-2 text-xs">{p.department || '—'}</td>
              <td className="p-2 text-right tabular-nums">{p.gross ? inr(p.gross) : <span className="text-slate-400">—</span>}</td>
              <td className="p-2 text-right tabular-nums">{p.net != null ? inr(p.net) : '—'}</td>
              <td className="p-2 text-right tabular-nums text-slate-600">{p.cost != null ? inr(p.cost) : '—'}</td>
              <td className="p-2"><span className="flex flex-wrap gap-1">{p.pf && <Chip tone="blue">PF</Chip>}{p.esi && <Chip tone="violet">ESI</Chip>}{p.insurance.length > 0 && <Chip tone="green">Insured</Chip>}{!p.on_payroll && <Chip>Off payroll</Chip>}</span></td>
              <td className="p-2"><span className="flex flex-wrap gap-1">{p.missing.map((m) => <Chip key={m} tone="amber">{MISSING[m]}</Chip>)}{p.advance_balance > 0 && <Chip>{inr(p.advance_balance)} advance</Chip>}</span></td>
            </tr>))}</tbody>
        </table>
      </div>
      {open && <PersonPaySheet personId={open} people={people} canEdit={canEdit} onOpenChange={(o) => !o && setOpen(null)} onChanged={reload} />}
    </div>
  );
}
