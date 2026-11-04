/* Shared pieces for HR → Pay & benefits, My pay and the Help desk: month picker, money rows, person picker,
 * file downloads and labels. */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Chip, inr, todayISO } from '../kit/PageBits';

export const KIND = { incentive: 'Incentive', commission: 'Sales commission', bonus: 'Bonus', reimbursement: 'Reimbursement', arrears: 'Arrears',
  other_earning: 'Other earning', deduction: 'Other deduction' };
export const EXTRA_STATUS = { pending: ['Waiting for approval', 'amber'], approved: ['Approved', 'blue'], in_payroll: ['In payroll', 'violet'], paid: ['Paid', 'green'], rejected: ['Rejected', 'red'] };
export const RUN_STATUS = { draft: ['Draft — not approved', 'amber'], approved: ['Approved — not paid', 'blue'], paid: ['Paid', 'green'] };
export const POLICY_KIND = { group_health: 'Group health', personal_accident: 'Personal accident', term_life: 'Term life', other: 'Other' };
export const COVER = { self: 'Self', self_spouse: 'Self + spouse', family: 'Self, spouse & children', family_parents: 'Family + parents' };
export const CLAIM_STATUS = { filed: ['Filed', 'amber'], approved: ['Approved', 'blue'], settled: ['Settled', 'green'], rejected: ['Rejected', 'red'] };
export const EMPLOYMENT = [['permanent', 'Permanent'], ['probation', 'On probation'], ['contract', 'Contract'], ['fixed_term', 'Fixed term'], ['trainee', 'Trainee'], ['intern', 'Intern']];

export const thisMonth = () => todayISO().slice(0, 7);
export const addMonth = (m, n) => { const d = new Date(`${m}-01T00:00:00`); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const monthLabel = (m, short = false) => (m ? new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: short ? 'short' : 'long', year: 'numeric' }) : '—');
export const n0 = (v) => (Number(v) || 0);

export function StatusChip({ map, value, testid }) {
  const [l, t] = map[value] || [value, 'slate'];
  return <Chip tone={t} testid={testid}>{l}</Chip>;
}

/** Second-level tabs (underlined), so they read differently from the page's pill tabs. */
export function SubTabs({ tabs, value, onChange, testid = 'subtab', label = 'Sections' }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4" role="tablist" aria-label={label}>
      <div className="flex w-max gap-1 border-b border-slate-200">
        {tabs.filter(Boolean).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${value === k ? 'border-emerald-600 font-semibold text-emerald-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
            data-testid={`${testid}-${k}`}>{l}</button>))}
      </div>
    </div>
  );
}

/** ‹ November 2026 › — never later than `max`. */
export function MonthPicker({ value, onChange, max, testid = 'month' }) {
  const atMax = max && value >= max;
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white" data-testid={testid}>
      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => onChange(addMonth(value, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
      <span className="min-w-[8.5rem] text-center text-sm font-medium text-slate-800" data-testid={`${testid}-label`}>{monthLabel(value)}</span>
      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => onChange(addMonth(value, 1))} disabled={atMax} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
    </div>
  );
}

/** Label … ₹amount rows, with an optional bold total. */
export function MoneyRows({ rows, total, totalLabel, tone = 'slate', testid }) {
  return (
    <ul className="space-y-1 text-sm" data-testid={testid}>
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-slate-600">{r.label}</span><span className="tabular-nums text-slate-900">{inr(r.amount)}</span></li>))}
      {rows.length === 0 && <li className="text-xs text-slate-400">Nothing</li>}
      {total != null && (
        <li className={`flex items-baseline justify-between gap-3 border-t pt-1 font-semibold ${tone === 'green' ? 'border-emerald-200 text-emerald-800' : 'border-slate-200 text-slate-900'}`}>
          <span>{totalLabel}</span><span className="tabular-nums">{inr(total)}</span></li>)}
    </ul>
  );
}

const NONE = '__none__';
export function PersonPick({ people, value, onChange, placeholder = 'Choose a person', testid, allowNone = false, className = 'h-11' }) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
      <SelectTrigger className={`${className} bg-white`} data-testid={testid} aria-label={placeholder}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {allowNone ? <SelectItem value={NONE}>{placeholder}</SelectItem> : !value && <SelectItem value={NONE} disabled>{placeholder}</SelectItem>}
        {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function clickDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Download a file the API returns as a blob. */
export async function saveFile(promise, filename) {
  try { const r = await promise; clickDownload(r.data, filename); }
  catch (e) { toast.error(e?.response?.status === 404 ? 'Not found' : 'Could not download the file'); }
}

/** Open a PDF in a new tab (the tab is opened first so phones don't block it); falls back to a download. */
export async function openPdf(promise, filename) {
  const w = window.open('', '_blank');
  try {
    const r = await promise;
    const blob = new Blob([r.data], { type: 'application/pdf' });
    if (w && !w.closed) { w.location.href = URL.createObjectURL(blob); } else { clickDownload(blob, filename); }
  } catch (e) { if (w) w.close(); toast.error(e?.response?.status === 404 ? 'No payslip for that month' : 'Could not open the payslip'); }
}
