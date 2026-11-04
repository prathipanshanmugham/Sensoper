/* Pay & benefits → Payroll: prepare the month, check and fix each person's line, approve, pay, and download the
 * bank file, salary register, PF ECR and ESI file. */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, BadgeCheck, Banknote, CheckCircle2, Download, FileText, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { payrollAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Card, Chip, Empty, Field, Loading, Tile, Tiles, errText, fmtDate, inr, inputCls, todayISO } from '../kit/PageBits';
import { MonthPicker, MoneyRows, RUN_STATUS, StatusChip, addMonth, monthLabel, n0, openPdf, saveFile, thisMonth } from './payBits';

function LineDialog({ month, line, editable, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!line) return;
    const e = line.edits || {};
    setF({ lop_days: e.lop_days ?? '', tds: e.tds ?? '', adjustments: (e.adjustments || []).map((a) => ({ ...a })), skip_advances: !!e.skip_advances, hold: !!e.hold, note: e.note || '' });
  }, [line]);
  if (!line || !f) return null;
  const save = async () => {
    setSaving(true);
    const data = { adjustments: f.adjustments.filter((a) => n0(a.amount)).map((a) => ({ label: a.label || 'Adjustment', amount: n0(a.amount) })),
      skip_advances: f.skip_advances, hold: f.hold, note: f.note };
    if (f.lop_days === '' || f.lop_days === null) data.clear_lop = true; else data.lop_days = n0(f.lop_days);
    if (f.tds === '' || f.tds === null) data.clear_tds = true; else data.tds = n0(f.tds);
    try { await payrollAPI.editLine(month, line.user_id, data); toast.success('Updated'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  const a = line.attendance || {};
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto" data-testid="pay-line-dialog">
        <DialogHeader><DialogTitle>{line.name} · {monthLabel(month)}</DialogTitle>
          <DialogDescription>{line.paid_days} of {line.basis_days} days paid{a.present_days > 0 || line.auto_lop ? ` · checked in ${a.present_days} of ${a.working_days} working days` : ''}{line.auto_lop ? ` · attendance suggests ${line.auto_lop} unpaid` : ''}</DialogDescription></DialogHeader>
        {line.warnings?.length > 0 && <ul className="space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{line.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</li>)}</ul>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><p className="mb-1 text-[11px] font-medium uppercase text-slate-500">Earnings</p><MoneyRows rows={line.earnings} total={line.gross} totalLabel="Gross" testid="pay-line-earnings" /></div>
          <div><p className="mb-1 text-[11px] font-medium uppercase text-slate-500">Deductions</p><MoneyRows rows={line.deductions} total={line.net} totalLabel="Net pay" tone="green" testid="pay-line-deductions" /></div>
        </div>
        {line.employer?.length > 0 && <p className="text-[11px] text-slate-500">Company pays on top: {line.employer.map((e) => `${e.label} ${inr(e.amount)}`).join(' · ')}</p>}
        {editable && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Unpaid days (LOP)" hint={line.auto_lop ? `Blank = attendance figure (${line.auto_lop})` : 'Blank = none'}><Input value={f.lop_days} onChange={(e) => setF((x) => ({ ...x, lop_days: e.target.value }))} inputMode="decimal" className="h-11" data-testid="pay-line-lop" /></Field>
              <Field label="TDS this month" hint={`Blank = worked out (${inr(line.tds)})${line.tds_estimated_months ? ` · counts ${line.tds_estimated_months} earlier month${line.tds_estimated_months > 1 ? 's' : ''} at their salary, no TDS taken` : ''}`}><Input value={f.tds} onChange={(e) => setF((x) => ({ ...x, tds: e.target.value }))} inputMode="decimal" className="h-11" data-testid="pay-line-tds" /></Field>
            </div>
            <div><p className="mb-1 text-xs font-medium text-slate-700">One-off adjustments (minus to take off)</p>
              <div className="space-y-2">{f.adjustments.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={r.label} onChange={(e) => setF((x) => ({ ...x, adjustments: x.adjustments.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) }))} placeholder="e.g. Mobile bill, Late arrival" className="h-10 min-w-0 flex-1" />
                  <Input value={r.amount} onChange={(e) => setF((x) => ({ ...x, adjustments: x.adjustments.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)) }))} inputMode="decimal" placeholder="₹ (−500)" className="h-10 w-28" data-testid={`pay-line-adj-${i}`} />
                  <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setF((x) => ({ ...x, adjustments: x.adjustments.filter((_, j) => j !== i) }))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                </div>))}
                <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setF((x) => ({ ...x, adjustments: [...x.adjustments, { label: '', amount: '' }] }))} data-testid="pay-line-adj-add"><Plus className="h-3.5 w-3.5" />Add adjustment</Button></div></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-sm">Skip advance recovery this month<Switch checked={f.skip_advances} onCheckedChange={(v) => setF((x) => ({ ...x, skip_advances: v }))} /></label>
              <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-sm">Hold this salary<Switch checked={f.hold} onCheckedChange={(v) => setF((x) => ({ ...x, hold: v }))} data-testid="pay-line-hold" /></label>
            </div>
            <Field label="Note"><Input value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} className="h-11" /></Field>
          </div>)}
        <DialogFooter>
          <Button variant="outline" className="gap-1" onClick={() => openPdf(payrollAPI.payslip(month, line.user_id), `payslip-${month}.pdf`)}><FileText className="h-4 w-4" />Payslip</Button>
          {editable && <Button onClick={save} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-line-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaidDialog({ open, run, onOpenChange, onSaved }) {
  const [f, setF] = useState({ paid_on: todayISO(), mode: 'bank', reference: '' });
  const [saving, setSaving] = useState(false);
  if (!open) return null;
  const save = async () => {
    setSaving(true);
    try { await payrollAPI.markPaid(run.month, f); toast.success('Marked paid — everyone can see their payslip'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="pay-paid-dialog">
        <DialogHeader><DialogTitle>Salaries paid?</DialogTitle><DialogDescription>{inr(run.totals.to_pay)} for {monthLabel(run.month)}. Advances are recovered and payslips go out.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Paid on"><input type="date" value={f.paid_on} onChange={(e) => setF((x) => ({ ...x, paid_on: e.target.value }))} className={inputCls} /></Field>
          <Field label="How"><Select value={f.mode} onValueChange={(v) => setF((x) => ({ ...x, mode: v }))}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>{[['bank', 'Bank'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['upi', 'UPI']].map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Reference" className="col-span-2"><Input value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} placeholder="e.g. NEFT batch number" className="h-11" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-paid-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Mark paid'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FILES = [['bank', 'Bank transfer file', 'salary-bank'], ['register', 'Salary register', 'salary-register'], ['pf_ecr', 'PF ECR (EPFO)', 'pf-ecr'], ['esi', 'ESI contribution', 'esi-contribution']];

export default function PayrollRun({ canEdit, canApprove, initialMonth }) {
  const [month, setMonth] = useState(initialMonth || thisMonth());
  const [run, setRun] = useState(undefined);      // undefined = loading, null = not prepared
  const [busy, setBusy] = useState('');
  const [line, setLine] = useState(null);
  const [paid, setPaid] = useState(false);
  const [q, setQ] = useState('');
  const load = useCallback(() => {
    setRun(undefined);
    return payrollAPI.run(month, true).then((r) => setRun(r.data || null)).catch((e) => { toast.error(errText(e)); setRun(null); });
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const act = async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (r?.data?.month) setRun(r.data); else await load(); if (ok) toast.success(ok); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(''); }
  };
  const lines = (run?.lines || []).filter((l) => !q || `${l.name} ${l.department || ''}`.toLowerCase().includes(q.toLowerCase()));
  const t = run?.totals || {};
  return (
    <div className="space-y-3" data-testid="pay-run">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker value={month} onChange={setMonth} max={addMonth(thisMonth(), 1)} testid="pay-run-month" />
        {run && <StatusChip map={RUN_STATUS} value={run.status} testid="pay-run-status" />}
        {run?.status === 'paid' && <span className="text-xs text-slate-500">on {fmtDate(run.paid_on)}{run.paid_reference ? ` · ${run.paid_reference}` : ''}</span>}
        {run?.status === 'approved' && <span className="text-xs text-slate-500">by {run.approved_by}</span>}
      </div>
      {run === undefined ? <Loading /> : run === null ? (
        <Empty icon={Banknote} title={`No payroll for ${monthLabel(month)} yet`} text="Preparing it works out everyone's pay from their salary, attendance, approved incentives and commission, advances and insurance. Nothing is final until you approve it.">
          {canEdit && <Button onClick={() => act('create', () => payrollAPI.createRun(month), 'Prepared — check each line, then approve')} disabled={busy === 'create'} className="h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-run-create">
            {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Prepare {monthLabel(month)} payroll</Button>}
        </Empty>
      ) : (<>
        <Tiles>
          <Tile label="Net to pay" value={inr(t.to_pay)} sub={`${t.people} people${t.held ? ` · ${inr(t.held)} on hold` : ''}`} tone="good" testid="pay-run-net" />
          <Tile label="Gross pay" value={inr(t.gross)} sub={`${inr(t.total_deductions)} deducted`} />
          <Tile label="Company's share" value={inr(t.employer_total)} sub="PF, pension, EDLI, ESI" />
          <Tile label="Cost to company" value={inr(t.cost)} sub={`${monthLabel(month, true)}`} />
        </Tiles>
        <Card title="To deposit" sub="From this payroll — due by the 15th (PF, ESI) and per your PT schedule">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="pay-run-statutory">
            <div><p className="text-[11px] text-slate-500">PF (EPFO)</p><p className="font-semibold tabular-nums">{inr(n0(t.pf_ee) + n0(t.pf_er_epf) + n0(t.eps))}</p><p className="text-[11px] text-slate-500">staff {inr(t.pf_ee)} · company {inr(n0(t.pf_er_epf) + n0(t.eps))}</p></div>
            <div><p className="text-[11px] text-slate-500">ESI (ESIC)</p><p className="font-semibold tabular-nums">{inr(n0(t.esi_ee) + n0(t.esi_er))}</p><p className="text-[11px] text-slate-500">staff {inr(t.esi_ee)} · company {inr(t.esi_er)}</p></div>
            <div><p className="text-[11px] text-slate-500">Professional tax</p><p className="font-semibold tabular-nums">{inr(t.pt)}</p></div>
            <div><p className="text-[11px] text-slate-500">Income tax (TDS)</p><p className="font-semibold tabular-nums">{inr(t.tds)}</p></div>
          </div>
        </Card>
        {run.status === 'draft' && run.missing?.length > 0 && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900" data-testid="pay-run-missing"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />No salary set for {run.missing.map((m) => m.name).join(', ')} — they aren't in this payroll. Set it under Salaries (or mark them “not on payroll”), then recalculate.</p>}
        <div className="flex flex-wrap items-center gap-2">
          {run.status === 'draft' && canEdit && <Button variant="outline" className="h-10 gap-1.5" disabled={!!busy} onClick={() => act('recalc', () => payrollAPI.recalc(month), 'Recalculated')} data-testid="pay-run-recalc">{busy === 'recalc' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Recalculate</Button>}
          {run.status === 'draft' && canApprove && <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!!busy} onClick={() => act('approve', () => payrollAPI.approveRun(month), 'Approved')} data-testid="pay-run-approve">{busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}Approve</Button>}
          {run.status === 'approved' && canApprove && <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!!busy} onClick={() => setPaid(true)} data-testid="pay-run-paid"><CheckCircle2 className="h-4 w-4" />Mark paid</Button>}
          {run.status === 'approved' && canApprove && <Button variant="outline" className="h-10 gap-1.5" disabled={!!busy} onClick={() => act('reopen', () => payrollAPI.reopenRun(month), 'Reopened')} data-testid="pay-run-reopen"><Undo2 className="h-4 w-4" />Reopen</Button>}
          {run.status === 'draft' && canApprove && <Button variant="ghost" className="h-10 gap-1.5 text-rose-700" disabled={!!busy} onClick={() => act('delete', () => payrollAPI.deleteRun(month), 'Draft deleted')}><RotateCcw className="h-4 w-4" />Start over</Button>}
          <div className="flex flex-wrap gap-1.5 sm:ml-auto">{FILES.map(([k, l, fn]) => (
            <Button key={k} variant="outline" size="sm" className="h-9 gap-1" onClick={() => saveFile(payrollAPI.exportFile(month, k), `${fn}-${month}.${k === 'pf_ecr' ? 'txt' : 'csv'}`)} data-testid={`pay-run-file-${k}`}><Download className="h-3.5 w-3.5" />{l}</Button>))}</div>
        </div>
        {run.lines.length > 6 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" className="h-10 w-full bg-white sm:w-64" />}
        <ul className="space-y-2 md:hidden">{lines.map((l) => (
          <li key={l.user_id}><button type="button" onClick={() => setLine(l)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left" data-testid={`pay-line-${l.user_id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="truncate font-medium text-slate-900">{l.name}</p><p className="text-xs text-slate-600">{l.paid_days} / {l.basis_days} days · gross {inr(l.gross)}</p></div>
              <div className="shrink-0 text-right"><p className="font-semibold tabular-nums text-emerald-800">{inr(l.net)}</p><p className="text-[11px] text-slate-500">−{inr(l.total_deductions)}</p></div>
            </div>
            {(l.hold || l.warnings?.length > 0) && <div className="mt-1.5 flex flex-wrap gap-1">{l.hold && <Chip tone="red">On hold</Chip>}{l.warnings.slice(0, 2).map((w) => <Chip key={w} tone="amber" className="max-w-full truncate">{w}</Chip>)}</div>}
          </button></li>))}</ul>
        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Name', 'Paid days', 'Gross', 'PF', 'ESI', 'TDS / PT', 'Other deductions', 'Net pay', ''].map((h, i) => <th key={h || i} className={`p-2 font-medium ${i >= 1 && i <= 7 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{lines.map((l) => {
              const other = l.total_deductions - n0(l.pf_ee) - n0(l.esi_ee) - n0(l.tds) - n0(l.pt);
              return (
                <tr key={l.user_id} className="hover:bg-emerald-50/40" data-testid={`pay-tline-${l.user_id}`}>
                  <td className="p-2"><span className="font-medium text-slate-900">{l.name}</span>{l.hold && <Chip tone="red" className="ml-1">On hold</Chip>}
                    <span className="block text-[11px] text-slate-500">{l.department || ''}{l.warnings?.length ? <span className="text-amber-700"> · {l.warnings.length} to check</span> : ''}</span></td>
                  <td className="p-2 text-right tabular-nums">{l.paid_days}{l.lop_days ? <span className="block text-[11px] text-rose-600">−{l.lop_days} unpaid</span> : null}</td>
                  <td className="p-2 text-right tabular-nums">{inr(l.gross)}</td>
                  <td className="p-2 text-right tabular-nums">{l.pf_ee ? inr(l.pf_ee) : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{l.esi_ee ? inr(l.esi_ee) : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{l.tds || l.pt ? `${inr(l.tds)} / ${inr(l.pt)}` : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{other ? inr(other) : '—'}</td>
                  <td className="p-2 text-right font-semibold tabular-nums text-emerald-800">{inr(l.net)}</td>
                  <td className="p-2 text-right"><Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setLine(l)} data-testid={`pay-tline-open-${l.user_id}`}>{run.status === 'draft' && canEdit ? <><Pencil className="h-3.5 w-3.5" />Check</> : <><FileText className="h-3.5 w-3.5" />Open</>}</Button></td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      </>)}
      {line && <LineDialog month={month} line={line} editable={run?.status === 'draft' && canEdit} onOpenChange={(o) => !o && setLine(null)} onSaved={load} />}
      {run && <PaidDialog open={paid} run={run} onOpenChange={setPaid} onSaved={load} />}
    </div>
  );
}
