import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { dailyReportsAPI, companyAPI, usersAPI } from '../utils/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';
import { Button } from '../components/ui/button';
import { DateNav, Section, Stepper, Chip, Field, ProjectPicker, inputCls, textareaCls } from '../components/FormBits';
import { localDate, shiftDate, dayLabel, fullDate, inr, timeOf } from '../lib/format';
import { generateDailyReportPDF } from '../utils/dailyReportPDF';
import { Plus, Trash2, Loader2, Download, Send, Save, CheckCircle2, Clock, CircleDashed, Eye, MessageSquare, CalendarRange, Lightbulb, UserMinus } from 'lucide-react';
import { Switch } from '../components/ui/switch';
import Can from '../components/Can';

const WORK_CHIPS = ['Site survey', 'Material delivered', 'Structure erected', 'Panels mounted', 'DC wiring done', 'Inverter installed', 'AC wiring & earthing', 'Testing & commissioning', 'Net-meter applied', 'Handover done'];
const PCT = [10, 25, 50, 75, 90, 100];
const PAY = [['upi', 'UPI'], ['cash', 'Cash'], ['bank_transfer', 'Bank'], ['cheque', 'Cheque'], ['emi', 'EMI']];
const SERVICE_CHIPS = ['Panel cleaning', 'Inverter fault', 'Wiring repair', 'Monitoring check', 'Customer training', 'Warranty claim'];
const LEADS = [['total_leads', 'New leads'], ['qualified_leads', 'Qualified'], ['site_visits', 'Site visits'], ['quotes_sent', 'Quotes sent'], ['followups', 'Follow-ups'], ['conversions', 'Won']];
const EMPTY = () => ({ site_work: [], leads: Object.fromEntries(LEADS.map(([k]) => [k, 0])), payments: [], service: [], highlights: '', issues: '', tomorrow_plan: '', hours_worked: '', km_travelled: '' });
const STATE = {
  submitted: { label: 'Submitted', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', Icon: CheckCircle2 },
  draft: { label: 'Draft', cls: 'bg-amber-50 text-amber-800 ring-amber-200', Icon: Clock },
  not_started: { label: 'Not started', cls: 'bg-slate-100 text-slate-600 ring-slate-200', Icon: CircleDashed },
  missing: { label: 'Not started', cls: 'bg-red-50 text-red-700 ring-red-200', Icon: CircleDashed },
};
export function ReportStatus({ status }) {
  const s = STATE[status] || STATE.not_started;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}><s.Icon className="h-3 w-3" />{s.label}</span>;
}

const toForm = (r) => ({
  ...EMPTY(),
  site_work: (r.site_work || []).map((w) => ({ ...w, progress_pct: w.progress_pct ?? null, crew_count: w.crew_count ?? 0 })),
  leads: { ...EMPTY().leads, ...(r.leads || {}) },
  payments: (r.payments || []).map((p) => ({ ...p, amount: p.amount ? String(p.amount) : '' })),
  service: r.service || [],
  highlights: r.highlights || '', issues: r.issues || '', tomorrow_plan: r.tomorrow_plan || '',
  hours_worked: r.hours_worked ?? '', km_travelled: r.km_travelled ?? '',
});
const toPayload = (f, submit) => ({
  site_work: f.site_work.filter((w) => w.project_id).map((w) => ({ project_id: w.project_id, work_done: w.work_done || '', progress_pct: w.progress_pct === '' || w.progress_pct == null ? null : Number(w.progress_pct), crew_count: Number(w.crew_count) || null, issues: w.issues || '' })),
  leads: Object.fromEntries(LEADS.map(([k]) => [k, Number(f.leads[k]) || 0])),
  payments: f.payments.filter((p) => Number(p.amount) > 0).map((p) => ({ project_id: p.project_id || null, customer: p.customer || '', amount: Number(p.amount), method: p.method || 'upi', reference: p.reference || '' })),
  service: f.service.filter((s) => s.issue || s.action).map((s) => ({ project_id: s.project_id || null, customer: s.customer || '', issue: s.issue || '', action: s.action || '', resolved: !!s.resolved })),
  highlights: f.highlights, issues: f.issues, tomorrow_plan: f.tomorrow_plan,
  hours_worked: f.hours_worked === '' ? null : Number(f.hours_worked), km_travelled: f.km_travelled === '' ? null : Number(f.km_travelled),
  submit,
});

let companyCache = null;
async function company() {
  if (companyCache) return companyCache;
  try { companyCache = (await companyAPI.getActive()).data; } catch { companyCache = {}; }
  return companyCache;
}

// ───────────────────────────── read-only report ─────────────────────────────
function ReportView({ r, info }) {
  const name = (id, fb) => (id && info?.[id] ? `${info[id].customer} · ${info[id].reference_number}` : fb || '—');
  const paid = (r.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const leads = r.leads || {};
  const block = (title, children) => <div className="space-y-2"><h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h4>{children}</div>;
  return (
    <div className="space-y-5 text-sm">
      <div className="grid grid-cols-4 gap-2 text-center">
        {[['Sites', (r.site_work || []).length], ['Leads', leads.total_leads || 0], ['Won', leads.conversions || 0], ['Collected', inr(paid)]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 px-2 py-2"><p className="text-[11px] text-slate-500">{k}</p><p className="font-semibold tabular-nums text-slate-900">{v}</p></div>
        ))}
      </div>
      {(r.site_work || []).length > 0 && block('Sites worked on', <ul className="space-y-2">{r.site_work.map((w, i) => (
        <li key={i} className="rounded-lg border border-slate-200 p-3"><p className="font-medium text-slate-900">{name(w.project_id)}</p>
          <p className="text-slate-700">{w.work_done || '—'}{w.progress_pct != null && <span className="text-slate-500"> · {w.progress_pct}%</span>}{w.crew_count ? <span className="text-slate-500"> · crew {w.crew_count}</span> : null}</p>
          {w.issues && <p className="mt-1 text-red-700">Problem: {w.issues}</p>}</li>))}</ul>)}
      {LEADS.some(([k]) => Number(leads[k]) > 0) && block('Leads & sales', <div className="grid grid-cols-3 gap-2">{LEADS.map(([k, l]) => <div key={k} className="rounded-lg border border-slate-200 px-2 py-1.5"><p className="text-[11px] text-slate-500">{l}</p><p className="font-semibold tabular-nums">{leads[k] || 0}</p></div>)}</div>)}
      {(r.payments || []).length > 0 && block('Payments collected', <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{r.payments.map((p, i) => (
        <li key={i} className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate">{name(p.project_id, p.customer)}<span className="text-slate-500"> · {(PAY.find(([k]) => k === p.method) || [0, p.method])[1]}{p.reference ? ` · ${p.reference}` : ''}</span></span><span className="font-semibold tabular-nums">{inr(p.amount)}</span></li>))}</ul>)}
      {(r.service || []).length > 0 && block('Service visits', <ul className="space-y-2">{r.service.map((s, i) => (
        <li key={i} className="rounded-lg border border-slate-200 p-3"><p className="font-medium">{name(s.project_id, s.customer)} <span className={`ml-1 text-xs ${s.resolved ? 'text-emerald-700' : 'text-amber-700'}`}>{s.resolved ? 'Fixed' : 'Open'}</span></p><p className="text-slate-700">{s.issue}{s.action ? ` — ${s.action}` : ''}</p></li>))}</ul>)}
      {[['What went well', r.highlights], ['Problems / help needed', r.issues], ["Tomorrow's plan", r.tomorrow_plan]].filter(([, v]) => v).map(([t, v]) => block(t, <p className="whitespace-pre-wrap text-slate-700">{v}</p>))}
      {(r.hours_worked || r.km_travelled) && <p className="text-xs text-slate-500">{r.hours_worked ? `${r.hours_worked} hours worked` : ''}{r.hours_worked && r.km_travelled ? ' · ' : ''}{r.km_travelled ? `${r.km_travelled} km travelled` : ''}</p>}
    </div>
  );
}

function ReportSheet({ open, onOpenChange, reportId, onReviewed, canReview }) {
  const [r, setR] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !reportId) return;
    setR(null); setComment('');
    dailyReportsAPI.get(reportId).then((x) => setR(x.data)).catch(() => toast.error('Could not open the report'));
  }, [open, reportId]);
  const review = async () => {
    setBusy(true);
    try { await dailyReportsAPI.review(reportId, comment); toast.success('Marked as reviewed'); const x = await dailyReportsAPI.get(reportId); setR(x.data); onReviewed?.(); }
    catch { toast.error('Could not save the review'); } finally { setBusy(false); }
  };
  const pdf = async () => {
    try { await generateDailyReportPDF({ reports: [r], projectInfo: r.project_info, companyProfile: await company(), title: `Daily report — ${r.user_name}`, filename: `Daily-report-${r.user_name.replace(/\s+/g, '-')}-${r.date}.pdf` }); }
    catch (e) { console.error(e); toast.error('Could not create the PDF'); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="report-sheet">
        {!r ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div> : (
          <>
            <SheetHeader className="mb-4 text-left">
              <SheetTitle className="font-['Outfit']">{r.user_name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">{fullDate(r.date)} <ReportStatus status={r.status} />{r.submitted_at && <span className="text-xs">at {timeOf(r.submitted_at)}</span>}</SheetDescription>
            </SheetHeader>
            <ReportView r={r} info={r.project_info} />
            {r.reviewed_at && <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><p className="font-medium">Reviewed by {r.reviewed_by}</p>{r.review_comment && <p className="mt-1">{r.review_comment}</p>}</div>}
            <div className="mt-6 space-y-3 border-t border-slate-200 pt-4">
              {canReview && !r.reviewed_at && r.status === 'submitted' && (
                <div className="space-y-2">
                  <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Note for them (optional)" className={textareaCls} id="review-comment" />
                  <Button onClick={review} disabled={busy} className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="review-btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Mark as reviewed</Button>
                </div>
              )}
              <Can module="module_daily_updates" action="export"><Button variant="outline" onClick={pdf} className="w-full gap-2" data-testid="sheet-pdf-btn"><Download className="h-4 w-4" />Download PDF</Button></Can>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ───────────────────────────── my report ─────────────────────────────
function MyReport({ date, projects }) {
  const [form, setForm] = useState(EMPTY());
  const [meta, setMeta] = useState(null);
  const [yesterdayPlan, setYesterdayPlan] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState({ site: true, leads: false, pay: false, service: false, wrap: true });
  const formRef = useRef(form); formRef.current = form;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const dateRef = useRef(date);

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const [r, y] = await Promise.all([dailyReportsAPI.mine(d), dailyReportsAPI.mine(shiftDate(d, -1)).catch(() => ({ data: {} }))]);
      const f = r.data.exists ? toForm(r.data) : EMPTY();
      setForm(f); setMeta(r.data); setDirty(false);
      setYesterdayPlan(y.data?.tomorrow_plan || '');
      setOpen({ site: true, leads: LEADS.some(([k]) => f.leads[k] > 0), pay: f.payments.length > 0, service: f.service.length > 0, wrap: true });
    } catch { toast.error('Could not load your report'); }
    finally { setLoading(false); }
  }, []);

  // switching dates keeps unsaved work: it is saved as a draft first
  useEffect(() => {
    const prev = dateRef.current; dateRef.current = date;
    (async () => {
      if (prev !== date && dirtyRef.current) {
        try { await dailyReportsAPI.saveMine(prev, toPayload(formRef.current, false)); toast.message(`Unsaved changes for ${dayLabel(prev)} kept as a draft`); } catch { /* ignore */ }
      }
      load(date);
    })();
  }, [date, load]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const setRow = (key, i, patch) => set({ [key]: form[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRow = (key, row) => set({ [key]: [...form[key], row] });
  const delRow = (key, i) => set({ [key]: form[key].filter((_, j) => j !== i) });

  const save = async (submit) => {
    if (submit && form.site_work.some((w) => !w.project_id)) { toast.error('Pick a project for every site you added, or remove the empty row'); setOpen((o) => ({ ...o, site: true })); return; }
    setSaving(true);
    try {
      const r = await dailyReportsAPI.saveMine(date, toPayload(form, submit));
      setMeta(r.data); setForm(toForm(r.data)); setDirty(false);
      toast.success(submit ? 'Report submitted — thank you!' : 'Draft saved');
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not save'); }
    finally { setSaving(false); }
  };
  const pdf = async () => {
    if (dirty) await save(false);
    try {
      const r = (await dailyReportsAPI.mine(date)).data;
      if (!r.exists) { toast.error('Save the report first'); return; }
      await generateDailyReportPDF({ reports: [r], projectInfo: r.project_info, companyProfile: await company(), title: `Daily report — ${r.user_name}`, filename: `Daily-report-${r.date}.pdf` });
    } catch (e) { console.error(e); toast.error('Could not create the PDF'); }
  };

  const paid = form.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const leadTotal = LEADS.reduce((s, [k]) => s + (Number(form.leads[k]) || 0), 0);
  const summaries = {
    site: form.site_work.length ? `${form.site_work.length} site${form.site_work.length > 1 ? 's' : ''}` : '',
    leads: leadTotal ? `${form.leads.total_leads} new · ${form.leads.conversions} won` : '',
    pay: form.payments.length ? `${form.payments.length} payment${form.payments.length > 1 ? 's' : ''} · ${inr(paid)}` : '',
    service: form.service.length ? `${form.service.length} visit${form.service.length > 1 ? 's' : ''}` : '',
    wrap: form.tomorrow_plan || form.highlights || form.issues ? 'Filled in' : '',
  };
  const status = meta?.status || 'not_started';

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ReportStatus status={status} />
        {status === 'submitted' && <span className="text-slate-500">at {timeOf(meta.submitted_at)} · you can still make changes</span>}
        {status === 'draft' && <span className="text-slate-500">Saved, but your manager can't see it as final until you submit.</span>}
        {status === 'not_started' && <span className="text-slate-500">Fill in what applies to your day. Empty sections are skipped.</span>}
        {dirty && <span className="font-medium text-amber-700">· Unsaved changes</span>}
      </div>
      {meta?.reviewed_at && <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="review-note"><MessageSquare className="mt-0.5 h-4 w-4 shrink-0" /><p><b>{meta.reviewed_by}</b> reviewed this{meta.review_comment ? `: “${meta.review_comment}”` : '.'}</p></div>}
      {yesterdayPlan && status !== 'submitted' && <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0" /><p><b>Your plan from the day before:</b> {yesterdayPlan}</p></div>}

      <Section n={1} title="Sites I worked on" hint="Projects you visited or installed today" summary={summaries.site} open={open.site} onToggle={() => setOpen((o) => ({ ...o, site: !o.site }))} testid="dr-section-site">
        <div className="space-y-4">
          {form.site_work.length === 0 && <p className="text-sm text-slate-500">No site work today? Skip this section.</p>}
          {form.site_work.map((w, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3" data-testid={`dr-site-row-${i}`}>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1"><ProjectPicker projects={projects} value={w.project_id} onChange={(v) => setRow('site_work', i, { project_id: v })} testid={`dr-site-project-${i}`} /></div>
                <button type="button" onClick={() => delRow('site_work', i)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove this site"><Trash2 className="h-4 w-4" /></button>
              </div>
              <Field group label="What was done">
                <div className="mb-2 flex flex-wrap gap-1.5">{WORK_CHIPS.map((c) => <Chip key={c} active={w.work_done === c} onClick={() => setRow('site_work', i, { work_done: w.work_done === c ? '' : c })}>{c}</Chip>)}</div>
                <input value={WORK_CHIPS.includes(w.work_done) ? '' : (w.work_done || '')} onChange={(e) => setRow('site_work', i, { work_done: e.target.value })} placeholder="…or describe it" className={inputCls} />
              </Field>
              <Field group label="Job progress">
                <div className="flex flex-wrap gap-1.5">{PCT.map((p) => <Chip key={p} active={Number(w.progress_pct) === p} onClick={() => setRow('site_work', i, { progress_pct: Number(w.progress_pct) === p ? null : p })}>{p}%</Chip>)}</div>
              </Field>
              <div className="flex flex-wrap items-end gap-4">
                <Field group label="People on site"><Stepper value={w.crew_count} onChange={(v) => setRow('site_work', i, { crew_count: v })} label="people on site" /></Field>
                <Field label="Any problem?" className="min-w-[200px] flex-1"><input value={w.issues || ''} onChange={(e) => setRow('site_work', i, { issues: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => addRow('site_work', { project_id: '', work_done: '', progress_pct: null, crew_count: 0, issues: '' })} className="w-full gap-2 border-dashed" data-testid="dr-add-site"><Plus className="h-4 w-4" />Add a site</Button>
        </div>
      </Section>

      <Section n={2} title="Leads & sales" hint="Enquiries, visits, quotes and wins today" summary={summaries.leads} open={open.leads} onToggle={() => setOpen((o) => ({ ...o, leads: !o.leads }))} testid="dr-section-leads">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {LEADS.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5">
              <span className="text-sm text-slate-700">{label}</span>
              <Stepper value={form.leads[k]} onChange={(v) => set({ leads: { ...form.leads, [k]: v } })} label={label} testid={`dr-lead-${k}`} />
            </div>
          ))}
        </div>
      </Section>

      <Section n={3} title="Payments collected" hint="Money received from customers today" summary={summaries.pay} open={open.pay} onToggle={() => setOpen((o) => ({ ...o, pay: !o.pay }))} testid="dr-section-pay">
        <div className="space-y-4">
          {form.payments.map((p, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3" data-testid={`dr-pay-row-${i}`}>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1"><ProjectPicker projects={projects} value={p.project_id || ''} onChange={(v) => setRow('payments', i, { project_id: v })} placeholder="Project (optional)" allowClear testid={`dr-pay-project-${i}`} /></div>
                <button type="button" onClick={() => delRow('payments', i)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove this payment"><Trash2 className="h-4 w-4" /></button>
              </div>
              {!p.project_id && <input value={p.customer || ''} onChange={(e) => setRow('payments', i, { customer: e.target.value })} placeholder="Customer name" className={inputCls} />}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Amount (₹)"><input inputMode="decimal" value={p.amount} onChange={(e) => setRow('payments', i, { amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" className={`${inputCls} text-lg font-semibold`} data-testid={`dr-pay-amount-${i}`} /></Field>
                <Field label="UTR / cheque no."><input value={p.reference || ''} onChange={(e) => setRow('payments', i, { reference: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
              </div>
              <div className="flex flex-wrap gap-1.5">{PAY.map(([v, l]) => <Chip key={v} active={(p.method || 'upi') === v} onClick={() => setRow('payments', i, { method: v })}>{l}</Chip>)}</div>
            </div>
          ))}
          {form.payments.length > 0 && <p className="text-right text-sm text-slate-600">Total today <b className="tabular-nums text-slate-900">{inr(paid)}</b></p>}
          <Button type="button" variant="outline" onClick={() => addRow('payments', { project_id: '', customer: '', amount: '', method: 'upi', reference: '' })} className="w-full gap-2 border-dashed" data-testid="dr-add-payment"><Plus className="h-4 w-4" />Add a payment</Button>
        </div>
      </Section>

      <Section n={4} title="Service visits" hint="Complaints, cleaning and repairs at existing customers" summary={summaries.service} open={open.service} onToggle={() => setOpen((o) => ({ ...o, service: !o.service }))} testid="dr-section-service">
        <div className="space-y-4">
          {form.service.map((s, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex gap-2">
                <div className="min-w-0 flex-1"><ProjectPicker projects={projects} value={s.project_id || ''} onChange={(v) => setRow('service', i, { project_id: v })} placeholder="Customer's project (optional)" allowClear /></div>
                <button type="button" onClick={() => delRow('service', i)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove this visit"><Trash2 className="h-4 w-4" /></button>
              </div>
              {!s.project_id && <input value={s.customer || ''} onChange={(e) => setRow('service', i, { customer: e.target.value })} placeholder="Customer name" className={inputCls} />}
              <Field group label="Problem">
                <div className="mb-2 flex flex-wrap gap-1.5">{SERVICE_CHIPS.map((c) => <Chip key={c} active={s.issue === c} onClick={() => setRow('service', i, { issue: s.issue === c ? '' : c })}>{c}</Chip>)}</div>
                <input value={SERVICE_CHIPS.includes(s.issue) ? '' : (s.issue || '')} onChange={(e) => setRow('service', i, { issue: e.target.value })} placeholder="…or describe it" className={inputCls} />
              </Field>
              <Field label="What you did"><input value={s.action || ''} onChange={(e) => setRow('service', i, { action: e.target.value })} placeholder="e.g. Reset inverter, cleaned 12 panels" className={inputCls} /></Field>
              <div className="flex gap-1.5"><Chip active={!!s.resolved} onClick={() => setRow('service', i, { resolved: true })}>Fixed</Chip><Chip active={!s.resolved} onClick={() => setRow('service', i, { resolved: false })}>Still open</Chip></div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => addRow('service', { project_id: '', customer: '', issue: '', action: '', resolved: false })} className="w-full gap-2 border-dashed" data-testid="dr-add-service"><Plus className="h-4 w-4" />Add a service visit</Button>
        </div>
      </Section>

      <Section n={5} title="Wrap-up" hint="How the day went and what's next" summary={summaries.wrap} open={open.wrap} onToggle={() => setOpen((o) => ({ ...o, wrap: !o.wrap }))} testid="dr-section-wrap">
        <div className="space-y-3">
          <Field label="What went well"><textarea value={form.highlights} onChange={(e) => set({ highlights: e.target.value })} placeholder="Wins, good feedback, things finished" className={textareaCls} id="dr-highlights" /></Field>
          <Field label="Problems / help needed"><textarea value={form.issues} onChange={(e) => set({ issues: e.target.value })} placeholder="Anything blocking you — material short, customer not available, approvals pending" className={textareaCls} id="dr-issues" /></Field>
          <Field label="Tomorrow's plan"><textarea value={form.tomorrow_plan} onChange={(e) => set({ tomorrow_plan: e.target.value })} placeholder="Where you'll be and what you'll do" className={textareaCls} id="dr-tomorrow" data-testid="dr-tomorrow" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hours worked"><input inputMode="decimal" value={form.hours_worked} onChange={(e) => set({ hours_worked: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 9" className={inputCls} /></Field>
            <Field label="Km travelled"><input inputMode="decimal" value={form.km_travelled} onChange={(e) => set({ km_travelled: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 42" className={inputCls} /></Field>
          </div>
        </div>
      </Section>

      <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom,0px))] z-20 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border lg:bottom-4">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => save(false)} disabled={saving || (!dirty && status !== 'not_started')} className="h-12 flex-1 gap-2" data-testid="dr-save-draft">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save draft</Button>
          <Button onClick={() => save(true)} disabled={saving || (status === 'submitted' && !dirty)} className="h-12 flex-[1.4] gap-2 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="dr-submit">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{status === 'submitted' ? (dirty ? 'Update report' : 'Submitted') : 'Submit report'}</Button>
          {meta?.exists && <Can module="module_daily_updates" action="export"><Button variant="outline" onClick={pdf} className="h-12 w-12 shrink-0 p-0" aria-label="Download PDF" title="Download PDF" data-testid="dr-pdf"><Download className="h-4 w-4" /></Button></Can>}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── team view (managers) ─────────────────────────────
function RangeDownload({ onDownload, label = 'Download a date range' }) {
  const [from, setFrom] = useState(shiftDate(localDate(), -6));
  const [to, setTo] = useState(localDate());
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarRange className="h-4 w-4 text-slate-400" />{label}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} id="range-from" /></Field>
        <Field label="To"><input type="date" value={to} min={from} max={localDate()} onChange={(e) => setTo(e.target.value)} className={inputCls} id="range-to" /></Field>
        <Can module="module_daily_updates" action="export"><Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { await onDownload(from, to); } finally { setBusy(false); } }} className="h-11 gap-2" data-testid="range-pdf-btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF</Button></Can>
      </div>
    </div>
  );
}

function PersonRow({ r, onOpen }) {
  return (
    <button type="button" disabled={!r.report_id} onClick={() => onOpen(r.report_id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors enabled:hover:bg-slate-50 disabled:cursor-default" data-testid={`team-row-${r.user_id}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{(r.name || '?').charAt(0).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{r.name} {r.reviewed && <span className="ml-1 text-xs font-normal text-emerald-700">· reviewed</span>}</span>
        <span className="block truncate text-xs text-slate-500">{r.totals ? `${r.totals.projects} site${r.totals.projects === 1 ? '' : 's'} · ${r.totals.leads} leads · ${inr(r.totals.payments)} collected` : <span className="capitalize">{r.role}</span>}{r.submitted_at ? ` · ${timeOf(r.submitted_at)}` : ''}</span>
      </span>
      <ReportStatus status={r.status} />
    </button>
  );
}

/** Admins choose who must send a daily report. People switched off don't count as "not started". */
function WhoReports({ rows, onChanged }) {
  const [saving, setSaving] = useState(null);
  const toggle = async (r) => {
    setSaving(r.user_id);
    try {
      await usersAPI.update(r.user_id, { daily_report_required: !r.required });
      toast.success(r.required ? `${r.name} no longer needs to send a daily report` : `${r.name} now sends a daily report`);
      onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not change this'); } finally { setSaving(null); }
  };
  return (
    <details className="rounded-xl border border-slate-200 bg-white" data-testid="who-reports">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-900">Who must send a daily report <span className="font-normal text-slate-500">· {rows.filter((r) => r.required).length} of {rows.length}</span></summary>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {rows.map((r) => (
          <li key={r.user_id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-800">{r.name}</span><span className="block text-[11px] capitalize text-slate-500">{r.role}</span></span>
            {saving === r.user_id && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <Switch checked={!!r.required} onCheckedChange={() => toggle(r)} disabled={saving === r.user_id} aria-label={`${r.name} must send a daily report`} data-testid={`must-report-${r.user_id}`} />
          </li>
        ))}
      </ul>
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">Also in Settings → Users. People switched off can still send a report if they want.</p>
    </details>
  );
}

function TeamView({ date }) {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => dailyReportsAPI.team(date).then((r) => setData(r.data)).catch(() => toast.error('Could not load the team')), [date]);
  useEffect(() => { setData(null); load(); }, [load]);

  const dayPdf = async () => {
    setBusy(true);
    try {
      const r = (await dailyReportsAPI.list({ date_from: date, date_to: date })).data;
      const missing = data.rows.filter((x) => x.status === 'missing' && x.required !== false).map((x) => x.name);
      await generateDailyReportPDF({ reports: r.reports, projectInfo: r.project_info, companyProfile: await company(), title: `Team daily report — ${fullDate(date)}`, filename: `Team-daily-report-${date}.pdf`, missing });
    } catch (e) { console.error(e); toast.error('Could not create the PDF'); } finally { setBusy(false); }
  };
  const rangePdf = async (from, to) => {
    const r = (await dailyReportsAPI.list({ date_from: from, date_to: to, limit: 1000 })).data;
    await generateDailyReportPDF({ reports: r.reports, projectInfo: r.project_info, companyProfile: await company(), title: `Team daily reports — ${dayLabel(from)} to ${dayLabel(to)}`, filename: `Team-daily-reports-${from}-to-${to}.pdf` });
  };

  if (!data) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>;
  const { counts, rows } = data;
  const expected = rows.filter((r) => r.required !== false || r.status !== 'missing');
  const optional = rows.filter((r) => r.required === false && r.status === 'missing');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[['submitted', 'Submitted', 'text-emerald-700'], ['draft', 'In draft', 'text-amber-700'], ['missing', 'Not started', 'text-red-700']].map(([k, l, c]) => (
          <div key={k} className="rounded-xl border border-slate-200 bg-white p-3 text-center"><p className={`font-['Outfit'] text-2xl font-semibold tabular-nums ${c}`}>{counts[k]}</p><p className="text-xs text-slate-500">{l}</p></div>
        ))}
      </div>
      <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100" data-testid="team-list">
        {expected.map((r) => <li key={r.user_id}><PersonRow r={r} onOpen={setOpenId} /></li>)}
        {expected.length === 0 && <li className="px-4 py-5 text-center text-sm text-slate-400">Nobody needs to send a report today.</li>}
      </ul>
      {optional.length > 0 && (
        <div data-testid="team-optional">
          <p className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><UserMinus className="h-3.5 w-3.5" />Don’t need to report · {optional.length}</p>
          <p className="px-1 text-xs text-slate-500">{optional.map((r) => r.name).join(', ')}</p>
        </div>
      )}
      {isAdmin && <WhoReports rows={rows} onChanged={load} />}
      <Can module="module_daily_updates" action="export"><Button onClick={dayPdf} disabled={busy} className="w-full gap-2 bg-slate-900 text-white hover:bg-slate-800 sm:w-auto" data-testid="team-pdf-btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download {dayLabel(date).toLowerCase() === 'today' ? "today's" : 'this day’s'} team PDF</Button></Can>
      <RangeDownload onDownload={rangePdf} label="Team PDF for a date range" />
      <ReportSheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} reportId={openId} canReview onReviewed={load} />
    </div>
  );
}

// ───────────────────────────── history ─────────────────────────────
function HistoryView({ isMgr }) {
  const [rows, setRows] = useState(null);
  const [info, setInfo] = useState({});
  const [person, setPerson] = useState('');
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    dailyReportsAPI.list({ date_from: shiftDate(localDate(), -60), limit: 500 }).then((r) => { setRows(r.data.reports); setInfo(r.data.project_info); }).catch(() => setRows([]));
  }, []);
  const people = useMemo(() => [...new Map((rows || []).map((r) => [r.user_id, r.user_name])).entries()], [rows]);
  const shown = (rows || []).filter((r) => !person || r.user_id === person);
  const rangePdf = async (from, to) => {
    const r = (await dailyReportsAPI.list({ date_from: from, date_to: to, user_id: person || undefined, limit: 1000 })).data;
    const who = person ? people.find(([id]) => id === person)?.[1] : (isMgr ? 'Team' : r.reports[0]?.user_name || 'My');
    await generateDailyReportPDF({ reports: r.reports, projectInfo: r.project_info, companyProfile: await company(), title: `${who} daily reports — ${dayLabel(from)} to ${dayLabel(to)}`, filename: `Daily-reports-${from}-to-${to}.pdf` });
  };
  if (!rows) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>;
  return (
    <div className="space-y-4">
      {isMgr && people.length > 1 && (
        <select value={person} onChange={(e) => setPerson(e.target.value)} className={inputCls} aria-label="Whose reports" id="history-person" data-testid="history-person">
          <option value="">Everyone</option>
          {people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
      )}
      {shown.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">No reports in the last 60 days.</p> : (
        <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100" data-testid="history-list">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <span className="w-16 shrink-0 text-sm font-semibold text-slate-900">{dayLabel(r.date)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{isMgr && <b className="font-medium text-slate-700">{r.user_name} · </b>}{r.totals.projects} sites · {r.totals.leads} leads · {inr(r.totals.payments)}{r.site_work?.[0] && info[r.site_work[0].project_id] ? ` · ${info[r.site_work[0].project_id].customer}` : ''}</span>
                <ReportStatus status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <RangeDownload onDownload={rangePdf} />
      <ReportSheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} reportId={openId} canReview={isMgr} />
    </div>
  );
}

// ───────────────────────────── page ─────────────────────────────
export default function DailyReportPage() {
  const { can } = useAuth();
  const isMgr = can('can_review_daily_reports');
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const today = localDate();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') && params.get('date') <= today ? params.get('date') : today;
  const rawTab = params.get('tab');
  const tab = rawTab === 'history' || (rawTab === 'team' && isMgr) ? rawTab : 'mine';
  const update = (patch) => {
    const next = { tab, date, ...patch };
    const out = {};
    if (next.tab !== 'mine') out.tab = next.tab;
    if (next.date !== today) out.date = next.date;
    setParams(out, { replace: true });
  };
  useEffect(() => { dailyReportsAPI.projects().then((r) => setProjects(r.data || [])).catch(() => {}); }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-6" data-testid="daily-report-page">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-['Outfit'] text-2xl font-semibold text-slate-900">Daily report</h1>
          <p className="text-sm text-slate-500">{fullDate(date)}</p>
        </div>
        {tab !== 'history' && <DateNav value={date} onChange={(d) => update({ date: d })} />}
      </div>
      <Tabs value={tab} onValueChange={(t) => update({ tab: t })}>
        <TabsList className={`mb-4 grid w-full ${isMgr ? 'grid-cols-3' : 'grid-cols-2'} sm:inline-flex sm:w-auto`}>
          <TabsTrigger value="mine" data-testid="dr-tab-mine">My report</TabsTrigger>
          {isMgr && <TabsTrigger value="team" data-testid="dr-tab-team">Team</TabsTrigger>}
          <TabsTrigger value="history" data-testid="dr-tab-history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="mine">{tab === 'mine' && <MyReport date={date} projects={projects} />}</TabsContent>
        {isMgr && <TabsContent value="team">{tab === 'team' && <TeamView date={date} />}</TabsContent>}
        <TabsContent value="history">{tab === 'history' && <HistoryView isMgr={isMgr} />}</TabsContent>
      </Tabs>
      <p className="mt-6 text-center text-xs text-slate-400">Logging a site's installation day? Use the <Link to="/dashboard/site-diary" className="font-medium text-emerald-700 underline-offset-2 hover:underline">Site diary</Link> for crew, materials and photos.</p>
    </div>
  );
}
