/* HR: people details (designation, department, reports-to, shift), hiring, cover for absent staff,
 * shifts and the weekly roster, and exits with notice periods. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeftRight, Briefcase, CalendarClock, Check, ChevronLeft, ChevronRight, Copy, IdCard, Loader2, LogOut, Pencil, Plus, Settings2, Sparkles, UserPlus, Users } from 'lucide-react';
import { hrAPI, uploadAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { useLiveRefresh } from '../lib/liveSync';
import { Card, Chip, Empty, Field, FileAttach, Loading, PageHeader, PillTabs, Stars, Tile, Tiles, addDaysISO, errText, fmtDate, inputCls, todayISO } from '../components/kit/PageBits';

const STAGES = [['applied', 'Applied'], ['screening', 'Screening'], ['interview', 'Interview'], ['offer', 'Offer made'], ['hired', 'Hired'], ['rejected', 'Not selected'], ['withdrawn', 'Withdrew']];
const STAGE_TONE = { applied: 'slate', screening: 'blue', interview: 'violet', offer: 'amber', hired: 'green', rejected: 'red', withdrawn: 'slate' };
const EXIT_TYPES = [['resignation', 'Resignation'], ['termination', 'Termination'], ['end_of_contract', 'End of contract'], ['retirement', 'Retirement']];
const REASONS = [['leave', 'On leave'], ['sick', 'Sick'], ['training', 'Training'], ['field_work', 'Away on field work'], ['other', 'Other']];
const SOURCES = [['referral', 'Referral'], ['walk_in', 'Walk-in'], ['job_portal', 'Job portal'], ['social', 'Social media'], ['agency', 'Agency'], ['other', 'Other']];
const label = (list, k) => (list.find(([v]) => v === k) || [k, k])[1];
const NONE = '__none__';

function Pick({ value, onChange, options, placeholder, testid, labelText }) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
      <SelectTrigger className="h-11" data-testid={testid} aria-label={labelText}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-72"><SelectItem value={NONE}>{placeholder || 'None'}</SelectItem>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

// ───────────────────────── overview ─────────────────────────
function Overview({ onTab }) {
  const [d, setD] = useState(null);
  const load = useCallback(() => hrAPI.overview().then((r) => setD(r.data)).catch(() => setD(false)), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(['hr'], load);
  if (d === null) return <Loading />;
  if (!d) return <Empty title="Could not load HR numbers" />;
  const depts = Object.entries(d.by_department || {});
  const max = Math.max(1, ...depts.map(([, n]) => n));
  return (
    <div className="space-y-4" data-testid="hr-overview">
      <Tiles>
        <Tile label="People" value={d.headcount} sub={`${d.joined_this_month} joined this month · ${d.left_12m} left in a year (${d.attrition_pct}%)`} icon={Users} testid="hr-kpi-headcount" onClick={() => onTab('people')} />
        <Tile label="On notice" value={d.on_notice.length} sub={d.on_notice[0] ? `next: ${d.on_notice[0].name} · ${fmtDate(d.on_notice[0].last_working_day)}` : 'nobody'} icon={LogOut} tone={d.on_notice.length ? 'warn' : undefined} />
        <Tile label="Open positions" value={d.open_positions} sub={`${Object.values(d.pipeline).reduce((a, b) => a + b, 0)} candidates in process`} icon={Briefcase} onClick={() => onTab('hiring')} />
        <Tile label="Covering today" value={d.covers_today.length} sub={d.covers_today.length ? `${d.covers_today.map((c) => c.absent).slice(0, 2).join(', ')} away` : 'everyone is in'} icon={ArrowLeftRight} onClick={() => onTab('cover')} />
      </Tiles>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="People by department" testid="hr-by-dept">
          <ul className="space-y-2">{depts.map(([k, n]) => (
            <li key={k}><div className="flex justify-between text-xs"><span className="text-slate-700">{k}</span><span className="tabular-nums text-slate-900">{n}</span></div>
              <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${(n / max) * 100}%`, background: '#2a78d6' }} /></div></li>))}</ul>
          {depts.some(([k]) => k === 'Not set') && <button type="button" onClick={() => onTab('people')} className="mt-2 text-xs text-emerald-700 underline">Set departments in People</button>}
        </Card>
        <Card title="Covering today" sub="Who is away and who is doing their work">
          {d.covers_today.length === 0 ? <p className="py-4 text-center text-xs text-slate-400">Everyone is in</p> : <ul className="space-y-1.5 text-sm">{d.covers_today.map((c, i) => (
            <li key={i}><b>{c.cover}</b> for {c.absent} <span className="text-xs text-slate-500">· {label(REASONS, c.reason)} until {fmtDate(c.until, { day: 'numeric', month: 'short' })}</span></li>))}</ul>}
        </Card>
        <Card title="Interviews this week">
          {d.interviews_week.length === 0 ? <p className="py-4 text-center text-xs text-slate-400">None planned</p> : <ul className="space-y-1.5 text-sm">{d.interviews_week.map((i, k) => (
            <li key={k}><b>{i.candidate}</b> <span className="text-xs text-slate-500">· {new Date(i.at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {i.interviewer || 'interviewer not set'}</span></li>))}</ul>}
        </Card>
      </div>
      {d.on_notice.length > 0 && (
        <Card title="Serving notice">
          <ul className="divide-y divide-slate-100 text-sm">{d.on_notice.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 py-1.5"><span><b>{e.name}</b> <span className="text-xs text-slate-500">· {label(EXIT_TYPES, e.type)}</span></span><Chip tone={e.days_left <= 7 ? 'amber' : 'slate'}>Last day {fmtDate(e.last_working_day)} · {e.days_left} days</Chip></li>))}</ul>
        </Card>
      )}
    </div>
  );
}

// ───────────────────────── people ─────────────────────────
function PersonDialog({ person, people, shifts, settings, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (person) setF({ designation: person.designation || '', department: person.department || '', reports_to: person.reports_to || '', joining_date: person.joining_date || '', employee_code: person.employee_code || '', default_shift_id: person.default_shift_id || '' }); }, [person]);
  if (!person || !f) return null;
  const save = async () => {
    setSaving(true);
    try { await hrAPI.updatePerson(person.id, { ...f, joining_date: f.joining_date || '', reports_to: f.reports_to || null, default_shift_id: f.default_shift_id || null }); toast.success('Saved'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  return (
    <Dialog open={!!person} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="hr-person-dialog">
        <DialogHeader><DialogTitle>{person.name}</DialogTitle><DialogDescription>{person.email} · {person.role}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Designation" className="col-span-2"><Input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} placeholder="Site engineer, Technician…" className="h-11" data-testid="hr-person-designation" /></Field>
          <Field label="Department" className="col-span-2"><Pick value={f.department} onChange={(v) => setF({ ...f, department: v })} options={(settings?.departments || []).map((d) => [d, d])} placeholder="Not set" testid="hr-person-dept" /></Field>
          <Field label="Reports to" className="col-span-2" hint="This draws the org chart"><Pick value={f.reports_to} onChange={(v) => setF({ ...f, reports_to: v })} options={people.filter((p) => p.id !== person.id).map((p) => [p.id, `${p.name}${p.designation ? ` · ${p.designation}` : ''}`])} placeholder="Nobody (top of the chart)" testid="hr-person-boss" /></Field>
          <Field label="Joined on"><input type="date" value={f.joining_date} onChange={(e) => setF({ ...f, joining_date: e.target.value })} className={inputCls} /></Field>
          <Field label="Employee code"><Input value={f.employee_code} onChange={(e) => setF({ ...f, employee_code: e.target.value })} className="h-11" /></Field>
          <Field label="Usual shift" className="col-span-2"><Pick value={f.default_shift_id} onChange={(v) => setF({ ...f, default_shift_id: v })} options={shifts.map((s) => [s.id, `${s.name} · ${s.start}–${s.end}`])} placeholder="No fixed shift" testid="hr-person-shift" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving} className="bg-emerald-600 text-white" data-testid="hr-person-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function People({ people, shifts, settings, canEdit, reload }) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [edit, setEdit] = useState(null);
  const shown = people.filter((p) => (dept === 'all' || (p.department || 'Not set') === dept) && (!q || `${p.name} ${p.designation || ''} ${p.employee_code || ''}`.toLowerCase().includes(q.toLowerCase())));
  const depts = [...new Set(people.map((p) => p.department || 'Not set'))];
  return (
    <div className="space-y-3" data-testid="hr-people">
      <div className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" className="h-10 w-full bg-white sm:w-64" />
        <div className="w-52"><Select value={dept} onValueChange={setDept}><SelectTrigger className="h-10 bg-white" aria-label="Department"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All departments</SelectItem>{depts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></div>
        <Link to="/dashboard/org-structure" className="ml-auto inline-flex h-10 items-center text-sm font-medium text-emerald-700 hover:underline">See the org chart →</Link>
      </div>
      {shown.length === 0 && <Empty title="Nobody matches" />}
      <ul className="space-y-2 sm:hidden" data-testid="hr-people-cards">{shown.map((p) => (
        <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">{p.name}{p.status === 'on_notice' && <Chip tone="amber" className="ml-1">notice · {fmtDate(p.last_working_day, { day: 'numeric', month: 'short' })}</Chip>}</p>
              <p className="text-xs text-slate-600">{[p.designation, p.department].filter(Boolean).join(' · ') || <span className="text-slate-400">Designation not set</span>}</p>
              <p className="mt-1 text-[11px] text-slate-500">{[p.employee_code, p.role, p.reports_to_name && `reports to ${p.reports_to_name}`, p.default_shift && `shift ${p.default_shift}`].filter(Boolean).join(' · ')}</p>
            </div>
            {canEdit && <Button size="sm" variant="outline" className="h-9 shrink-0 gap-1 text-xs" onClick={() => setEdit(p)}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
          </div>
        </li>))}</ul>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Name', 'Designation', 'Department', 'Reports to', 'Joined', 'Shift', ''].map((h) => <th key={h} className="p-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{shown.map((p) => (
            <tr key={p.id} data-testid={`hr-person-${p.id}`}>
              <td className="p-2"><span className="font-medium text-slate-900">{p.name}</span>{p.status === 'on_notice' && <Chip tone="amber" className="ml-1">notice · {fmtDate(p.last_working_day, { day: 'numeric', month: 'short' })}</Chip>}<span className="block text-[11px] text-slate-500">{p.employee_code ? `${p.employee_code} · ` : ''}{p.role}</span></td>
              <td className="p-2">{p.designation || <span className="text-slate-400">—</span>}</td><td className="p-2">{p.department || <span className="text-slate-400">—</span>}</td>
              <td className="p-2">{p.reports_to_name || <span className="text-slate-400">—</span>}</td><td className="p-2 text-xs">{p.joining_date ? fmtDate(p.joining_date) : '—'}</td>
              <td className="p-2 text-xs">{p.default_shift || '—'}</td>
              <td className="p-2 text-right">{canEdit && <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setEdit(p)} data-testid={`hr-person-edit-${p.id}`}><Pencil className="h-3.5 w-3.5" />Edit</Button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <PersonDialog person={edit} people={people} shifts={shifts} settings={settings} onOpenChange={(o) => !o && setEdit(null)} onSaved={reload} />
    </div>
  );
}

// ───────────────────────── hiring ─────────────────────────
function OpeningDialog({ open, initial, settings, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF(initial || { title: '', department: '', positions: 1, employment_type: 'full_time', pay_range: '', description: '', status: 'open' }); }, [open, initial]);
  if (!f) return null;
  const save = async () => {
    setSaving(true);
    try { if (f.id) await hrAPI.updateOpening(f.id, { ...f, positions: Number(f.positions) || 1 }); else await hrAPI.addOpening({ ...f, positions: Number(f.positions) || 1 }); toast.success('Opening saved'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="hr-opening-dialog">
        <DialogHeader><DialogTitle>{f.id ? 'Edit opening' : 'New opening'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Role *" className="col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Solar technician" className="h-11" data-testid="hr-opening-title" /></Field>
          <Field label="Department"><Pick value={f.department} onChange={(v) => setF({ ...f, department: v })} options={(settings?.departments || []).map((d) => [d, d])} placeholder="Not set" /></Field>
          <Field label="How many"><Input type="number" inputMode="numeric" min="1" value={f.positions} onChange={(e) => setF({ ...f, positions: e.target.value })} className="h-11" /></Field>
          <Field label="Type"><Select value={f.employment_type} onValueChange={(v) => setF({ ...f, employment_type: v })}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full_time">Full time</SelectItem><SelectItem value="part_time">Part time</SelectItem><SelectItem value="contract">Contract</SelectItem><SelectItem value="intern">Intern</SelectItem></SelectContent></Select></Field>
          <Field label="Status"><Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="on_hold">On hold</SelectItem><SelectItem value="filled">Filled</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent></Select></Field>
          <Field label="Pay range (optional)" className="col-span-2"><Input value={f.pay_range || ''} onChange={(e) => setF({ ...f, pay_range: e.target.value })} className="h-11" /></Field>
          <Field label="About the job" className="col-span-2"><textarea rows={3} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || f.title.trim().length < 2} className="bg-emerald-600 text-white" data-testid="hr-opening-save">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CandidateDialog({ open, openings, defaultOpening, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ opening_id: defaultOpening || '', name: '', phone: '', email: '', source: 'referral', experience_years: '', current_location: '', expected_pay: '', resume_path: null, notes: '' }); }, [open, defaultOpening]);
  if (!f) return null;
  const save = async () => {
    setSaving(true);
    try { const r = await hrAPI.addCandidate({ ...f, opening_id: f.opening_id || null, experience_years: f.experience_years === '' ? null : Number(f.experience_years) }); toast.success('Candidate added'); onSaved(r.data); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto" data-testid="hr-candidate-dialog">
        <DialogHeader><DialogTitle>Add a candidate</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="For" className="col-span-2"><Pick value={f.opening_id} onChange={(v) => setF({ ...f, opening_id: v })} options={openings.filter((o) => o.status === 'open').map((o) => [o.id, o.title])} placeholder="No particular opening" testid="hr-cand-opening" /></Field>
          <Field label="Name *" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11" data-testid="hr-cand-name" /></Field>
          <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="h-11" data-testid="hr-cand-phone" /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="h-11" /></Field>
          <Field label="Came through"><Select value={f.source} onValueChange={(v) => setF({ ...f, source: v })}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{SOURCES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Experience (years)"><Input type="number" inputMode="decimal" value={f.experience_years} onChange={(e) => setF({ ...f, experience_years: e.target.value })} className="h-11" /></Field>
          <Field label="Lives in"><Input value={f.current_location} onChange={(e) => setF({ ...f, current_location: e.target.value })} className="h-11" /></Field>
          <Field label="Expects (pay)"><Input value={f.expected_pay} onChange={(e) => setF({ ...f, expected_pay: e.target.value })} className="h-11" /></Field>
          <div className="col-span-2"><FileAttach value={f.resume_path} onChange={(p) => setF({ ...f, resume_path: p })} label="Attach resume" testid="hr-cand-resume" /></div>
          <Field label="Notes" className="col-span-2"><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || f.name.trim().length < 2} className="bg-emerald-600 text-white" data-testid="hr-cand-save">Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CandidateSheet({ cand, people, settings, onOpenChange, onChanged }) {
  const { isAdmin } = useAuth();
  const [stage, setStage] = useState('');
  const [iv, setIv] = useState(null);
  const [hire, setHire] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStage(cand?.stage || ''); setIv(null); setHire(null); }, [cand]);
  if (!cand) return null;
  const run = async (fn, ok) => { setBusy(true); try { await fn(); toast.success(ok); onChanged(); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); } };
  return (
    <Sheet open={!!cand} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="hr-candidate-sheet">
        <div className="space-y-4">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="flex flex-wrap items-center gap-2">{cand.name}<Chip tone={STAGE_TONE[cand.stage]}>{label(STAGES, cand.stage)}</Chip></SheetTitle>
            <SheetDescription>{[cand.opening_title, cand.phone, cand.email, cand.experience_years != null && `${cand.experience_years} yrs`, cand.current_location, label(SOURCES, cand.source)].filter(Boolean).join(' · ')}</SheetDescription>
          </SheetHeader>
          {cand.resume_path && <a href={uploadAPI.getFileUrl(cand.resume_path)} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 underline">Open resume</a>}
          {cand.notes && <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700">{cand.notes}</p>}
          {cand.stage !== 'hired' && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-48"><Field label="Move to"><Select value={stage} onValueChange={setStage}><SelectTrigger className="h-11" data-testid="hr-cand-stage"><SelectValue /></SelectTrigger><SelectContent>{STAGES.filter(([k]) => k !== 'hired').map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field></div>
              <Button variant="outline" className="h-11" disabled={busy || stage === cand.stage} onClick={() => run(() => hrAPI.moveStage(cand.id, stage), 'Moved')} data-testid="hr-cand-move">Move</Button>
              <Button className="h-11 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setHire({ joining_date: addDaysISO(todayISO(), 15), designation: '', department: '', reports_to: '', create_login: false, email: cand.email || '', role: 'staff', temp_password: '' })} data-testid="hr-cand-hire"><UserPlus className="h-4 w-4" />Hire</Button>
            </div>
          )}
          {cand.stage === 'hired' && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Joins on <b>{fmtDate(cand.joining_date)}</b>{cand.user_id ? ' · login created' : ' · no login yet — an admin can add one under Users'}</p>}
          <Card title="Interviews" action={cand.stage !== 'hired' && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setIv({ at: `${addDaysISO(todayISO(), 1)}T11:00`, mode: 'in_person', interviewer_id: '', notes: '' })} data-testid="hr-iv-add"><Plus className="h-3.5 w-3.5" />Plan</Button>}>
            {(cand.interviews || []).length === 0 ? <p className="text-xs text-slate-400">None yet</p> : <ul className="space-y-2">{cand.interviews.map((i) => (
              <li key={i.id} className="rounded-lg border border-slate-200 p-2 text-sm">
                <p className="font-medium">{new Date(i.at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {i.mode.replace('_', ' ')}</p>
                <p className="text-xs text-slate-500">{i.interviewer_name || 'Interviewer not set'}{i.notes ? ` · ${i.notes}` : ''}</p>
                {i.result ? <Chip tone={i.result === 'passed' ? 'green' : i.result === 'failed' ? 'red' : 'slate'} className="mt-1">{i.result.replace('_', ' ')}</Chip> : (
                  <div className="mt-1 flex flex-wrap gap-1">{[['passed', 'Passed'], ['failed', 'Not good enough'], ['no_show', "Didn't come"]].map(([k, l]) => (
                    <Button key={k} size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => run(() => hrAPI.interviewResult(cand.id, i.id, { result: k }), 'Result saved')}>{l}</Button>))}</div>)}
              </li>))}</ul>}
          </Card>
          <Card title="History"><ul className="space-y-1 text-xs text-slate-600">{(cand.stage_history || []).slice().reverse().map((h, k) => <li key={k}>{fmtDate(h.at)} · {label(STAGES, h.stage)} · {h.by}{h.note ? ` — ${h.note}` : ''}</li>)}</ul></Card>
        </div>
        <Dialog open={!!iv} onOpenChange={(o) => !o && setIv(null)}>
          <DialogContent className="max-w-sm" data-testid="hr-iv-dialog">
            <DialogHeader><DialogTitle>Plan an interview</DialogTitle><DialogDescription>The interviewer gets a note two hours before.</DialogDescription></DialogHeader>
            {iv && <div className="space-y-2">
              <Field label="When"><input type="datetime-local" value={iv.at} onChange={(e) => setIv({ ...iv, at: e.target.value })} className={inputCls} data-testid="hr-iv-at" /></Field>
              <Field label="How"><Select value={iv.mode} onValueChange={(v) => setIv({ ...iv, mode: v })}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in_person">In person</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="video">Video call</SelectItem></SelectContent></Select></Field>
              <Field label="Interviewer"><Pick value={iv.interviewer_id} onChange={(v) => setIv({ ...iv, interviewer_id: v })} options={people.map((p) => [p.id, p.name])} placeholder="Choose" testid="hr-iv-who" /></Field>
              <Field label="Note"><Input value={iv.notes} onChange={(e) => setIv({ ...iv, notes: e.target.value })} className="h-11" /></Field>
            </div>}
            <DialogFooter><Button variant="outline" onClick={() => setIv(null)}>Cancel</Button><Button disabled={busy || !iv?.at} className="bg-emerald-600 text-white" onClick={() => run(async () => { await hrAPI.addInterview(cand.id, { ...iv, interviewer_id: iv.interviewer_id || null }); setIv(null); }, 'Interview planned')} data-testid="hr-iv-save">Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!hire} onOpenChange={(o) => !o && setHire(null)}>
          <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto" data-testid="hr-hire-dialog">
            <DialogHeader><DialogTitle>Hire {cand.name}</DialogTitle><DialogDescription>Their joining day goes on the calendar.</DialogDescription></DialogHeader>
            {hire && <div className="grid grid-cols-2 gap-2">
              <Field label="Joins on *"><input type="date" value={hire.joining_date} onChange={(e) => setHire({ ...hire, joining_date: e.target.value })} className={inputCls} data-testid="hr-hire-date" /></Field>
              <Field label="Designation"><Input value={hire.designation} onChange={(e) => setHire({ ...hire, designation: e.target.value })} className="h-11" /></Field>
              <Field label="Department"><Pick value={hire.department} onChange={(v) => setHire({ ...hire, department: v })} options={(settings?.departments || []).map((d) => [d, d])} placeholder="Not set" /></Field>
              <Field label="Reports to"><Pick value={hire.reports_to} onChange={(v) => setHire({ ...hire, reports_to: v })} options={people.map((p) => [p.id, p.name])} placeholder="Choose" /></Field>
              {isAdmin && <label className="col-span-2 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span>Create their login now</span><Switch checked={hire.create_login} onCheckedChange={(v) => setHire({ ...hire, create_login: v })} data-testid="hr-hire-login" /></label>}
              {hire.create_login && <>
                <Field label="Login email" className="col-span-2"><Input type="email" value={hire.email} onChange={(e) => setHire({ ...hire, email: e.target.value })} className="h-11" /></Field>
                <Field label="Role"><Select value={hire.role} onValueChange={(v) => setHire({ ...hire, role: v })}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="staff">Staff</SelectItem><SelectItem value="manager">Manager</SelectItem></SelectContent></Select></Field>
                <Field label="Temporary password" hint="8+ characters; they change it at first sign-in"><Input value={hire.temp_password} onChange={(e) => setHire({ ...hire, temp_password: e.target.value })} className="h-11" autoComplete="new-password" /></Field>
              </>}
            </div>}
            <DialogFooter><Button variant="outline" onClick={() => setHire(null)}>Cancel</Button><Button disabled={busy || !hire?.joining_date} className="bg-emerald-600 text-white" onClick={() => run(async () => { await hrAPI.hire(cand.id, { ...hire, reports_to: hire.reports_to || null }); setHire(null); }, 'Hired')} data-testid="hr-hire-save">Hire</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function Hiring({ people, settings, canEdit }) {
  const [openings, setOpenings] = useState(null);
  const [cands, setCands] = useState([]);
  const [opening, setOpening] = useState('all');
  const [stage, setStage] = useState('open');
  const [openDlg, setOpenDlg] = useState(null);
  const [candDlg, setCandDlg] = useState(false);
  const [sel, setSel] = useState(null);
  const load = useCallback(() => {
    hrAPI.openings().then((r) => setOpenings(r.data)).catch(() => setOpenings([]));
    hrAPI.candidates({ ...(opening !== 'all' ? { opening_id: opening } : {}), ...(stage !== 'all' ? { stage } : {}) }).then((r) => setCands(r.data)).catch(() => setCands([]));
  }, [opening, stage]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (sel) setSel(cands.find((c) => c.id === sel.id) || null); }, [cands]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!openings) return <Loading />;
  return (
    <div className="space-y-4" data-testid="hr-hiring">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">Openings</p>
        {canEdit && <Button variant="outline" className="h-9 gap-1" onClick={() => setOpenDlg({})} data-testid="hr-opening-new"><Plus className="h-4 w-4" />New opening</Button>}
      </div>
      {openings.length === 0 ? <Empty icon={Briefcase} title="No openings" text="Add the roles you are hiring for, then the candidates for each." /> : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{openings.map((o) => (
          <button key={o.id} type="button" onClick={() => setOpening(o.id)} className={`rounded-xl border bg-white p-3 text-left ${opening === o.id ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-slate-200'}`} data-testid={`hr-opening-${o.id}`}>
            <div className="flex items-center gap-2"><p className="font-medium text-slate-900">{o.title}</p><Chip tone={o.status === 'open' ? 'green' : 'slate'}>{o.status.replace('_', ' ')}</Chip></div>
            <p className="text-xs text-slate-500">{[o.department, `${o.filled || 0}/${o.positions} filled`, `${o.in_process} in process`].filter(Boolean).join(' · ')}</p>
            {canEdit && <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setOpenDlg(o); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setOpenDlg(o); } }} className="mt-1 inline-block text-xs text-slate-500 underline">Edit</span>}
          </button>))}</div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <p className="mr-auto text-sm font-semibold text-slate-900">Candidates</p>
        <div className="w-48"><Select value={opening} onValueChange={setOpening}><SelectTrigger className="h-10 bg-white" aria-label="Opening" data-testid="hr-cand-filter-opening"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All openings</SelectItem>{openings.map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}</SelectContent></Select></div>
        <div className="w-44"><Select value={stage} onValueChange={setStage}><SelectTrigger className="h-10 bg-white" aria-label="Stage" data-testid="hr-cand-filter-stage"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">In process</SelectItem><SelectItem value="all">Everyone</SelectItem>{STAGES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
        {canEdit && <Button onClick={() => setCandDlg(true)} className="h-10 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="hr-cand-new"><UserPlus className="h-4 w-4" />Add candidate</Button>}
      </div>
      {cands.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No candidates here</p> : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{cands.map((c) => (
          <button key={c.id} type="button" onClick={() => setSel(c)} className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-emerald-300" data-testid={`hr-cand-${c.id}`}>
            <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{c.name}</p><Chip tone={STAGE_TONE[c.stage]}>{label(STAGES, c.stage)}</Chip>{c.rating && <Stars value={c.rating} />}</div>
            <p className="text-xs text-slate-500">{[c.opening_title, c.phone, c.experience_years != null && `${c.experience_years} yrs`, label(SOURCES, c.source)].filter(Boolean).join(' · ')}</p>
            {(c.interviews || []).filter((i) => !i.result).slice(0, 1).map((i) => <p key={i.id} className="mt-1 text-xs text-violet-800"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />Interview {new Date(i.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>)}
          </button>))}</div>
      )}
      <OpeningDialog open={!!openDlg} initial={openDlg?.id ? openDlg : null} settings={settings} onOpenChange={(o) => !o && setOpenDlg(null)} onSaved={load} />
      <CandidateDialog open={candDlg} openings={openings} defaultOpening={opening !== 'all' ? opening : ''} onOpenChange={setCandDlg} onSaved={(c) => { load(); setSel(c); }} />
      <CandidateSheet cand={sel} people={people} settings={settings} onOpenChange={(o) => !o && setSel(null)} onChanged={load} />
    </div>
  );
}

// ───────────────────────── cover for absent staff ─────────────────────────
function CoverDialog({ open, people, shifts, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [sug, setSug] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setF({ absent_user_id: '', cover_user_id: '', start_date: todayISO(), end_date: todayISO(), reason: 'leave', shift_id: '', handover_notes: '' }); setSug([]); } }, [open]);
  useEffect(() => {
    if (!f?.absent_user_id || !f.start_date || !f.end_date || f.end_date < f.start_date) { setSug([]); return; }
    hrAPI.suggestCover({ user_id: f.absent_user_id, start: f.start_date, end: f.end_date }).then((r) => setSug(r.data)).catch(() => setSug([]));
  }, [f?.absent_user_id, f?.start_date, f?.end_date]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const save = async () => {
    setSaving(true);
    try { await hrAPI.addCover({ ...f, shift_id: f.shift_id || null }); toast.success('Cover arranged — they have been told'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto" data-testid="hr-cover-dialog">
        <DialogHeader><DialogTitle>Arrange cover</DialogTitle><DialogDescription>Who is away, and who does their work. The cover person gets a note with your handover.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Who is away *" className="col-span-2"><Pick value={f.absent_user_id} onChange={(v) => setF({ ...f, absent_user_id: v, cover_user_id: '' })} options={people.map((p) => [p.id, p.name])} placeholder="Choose" testid="hr-cover-absent" /></Field>
          <Field label="From"><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} className={inputCls} data-testid="hr-cover-from" /></Field>
          <Field label="To"><input type="date" value={f.end_date} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} className={inputCls} data-testid="hr-cover-to" /></Field>
          <Field label="Why"><Select value={f.reason} onValueChange={(v) => setF({ ...f, reason: v })}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{REASONS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Shift (optional)"><Pick value={f.shift_id} onChange={(v) => setF({ ...f, shift_id: v })} options={shifts.map((s) => [s.id, `${s.name} ${s.start}–${s.end}`])} placeholder="Their usual" /></Field>
          {sug.length > 0 && (
            <div className="col-span-2 space-y-1" data-testid="hr-cover-suggest">
              <p className="flex items-center gap-1 text-xs font-medium text-slate-700"><Sparkles className="h-3.5 w-3.5 text-emerald-600" />Free on those days</p>
              <div className="flex flex-wrap gap-1.5">{sug.slice(0, 8).map((s) => (
                <button key={s.id} type="button" aria-pressed={f.cover_user_id === s.id} onClick={() => setF({ ...f, cover_user_id: s.id })} className={`rounded-full border px-2.5 py-1 text-xs ${f.cover_user_id === s.id ? 'border-emerald-300 bg-emerald-100 font-medium text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}>
                  {s.name}{s.same_department ? ' · same team' : s.same_branch ? ' · same branch' : ''}{s.recent_covers ? ` · ${s.recent_covers} recent` : ''}</button>))}</div>
            </div>
          )}
          <Field label="Covering *" className="col-span-2"><Pick value={f.cover_user_id} onChange={(v) => setF({ ...f, cover_user_id: v })} options={people.filter((p) => p.id !== f.absent_user_id).map((p) => [p.id, p.name])} placeholder="Choose" testid="hr-cover-who" /></Field>
          <Field label="Handover notes" className="col-span-2" hint="Open jobs, customers to call, keys…"><textarea rows={3} value={f.handover_notes} onChange={(e) => setF({ ...f, handover_notes: e.target.value })} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" data-testid="hr-cover-notes" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !f.absent_user_id || !f.cover_user_id} className="bg-emerald-600 text-white" data-testid="hr-cover-save">Arrange</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Cover({ people, shifts, canEdit }) {
  const [rows, setRows] = useState(null);
  const [dlg, setDlg] = useState(false);
  const load = useCallback(() => hrAPI.covers().then((r) => setRows(r.data)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(['hr'], load);
  const cancel = async (c) => { if (!window.confirm('Cancel this cover?')) return; try { await hrAPI.cancelCover(c.id); load(); } catch (e) { toast.error(errText(e)); } };
  const t = todayISO();
  return (
    <div className="space-y-3" data-testid="hr-cover">
      <div className="flex items-center justify-between gap-2"><p className="text-sm text-slate-600">When someone is on leave or away, choose who does their work.</p>
        {canEdit && <Button onClick={() => setDlg(true)} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="hr-cover-new"><ArrowLeftRight className="h-4 w-4" />Arrange cover</Button>}</div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon={ArrowLeftRight} title="No covers planned" text="Arrange cover when someone will be away — the cover person gets your handover notes." /> : (
        <ul className="space-y-2">{rows.map((c) => (
          <li key={c.id} className={`rounded-xl border bg-white p-3 ${c.today ? 'border-emerald-300' : 'border-slate-200'}`} data-testid={`hr-cover-${c.id}`}>
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm"><b>{c.cover_name}</b> covers for <b>{c.absent_name}</b></p>{c.today && <Chip tone="green">Today</Chip>}{c.end_date < t && <Chip>Done</Chip>}</div>
            <p className="text-xs text-slate-500">{fmtDate(c.start_date, { day: 'numeric', month: 'short' })}{c.end_date !== c.start_date ? ` – ${fmtDate(c.end_date, { day: 'numeric', month: 'short' })}` : ''} · {label(REASONS, c.reason)}{c.shift_name ? ` · ${c.shift_name} shift` : ''} · arranged by {c.created_by}</p>
            {c.handover_notes && <p className="mt-1 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">{c.handover_notes}</p>}
            {canEdit && c.end_date >= t && <button type="button" onClick={() => cancel(c)} className="mt-1 text-xs text-slate-400 hover:text-rose-600">Cancel cover</button>}
          </li>))}</ul>
      )}
      <CoverDialog open={dlg} people={people} shifts={shifts} onOpenChange={setDlg} onSaved={load} />
    </div>
  );
}

// ───────────────────────── shifts & roster ─────────────────────────
function ShiftDialog({ open, initial, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  useEffect(() => { if (open) setF(initial || { name: '', start: '09:00', end: '18:00', break_minutes: 60, color: '', active: true }); }, [open, initial]);
  if (!f) return null;
  const save = async () => {
    try { if (f.id) await hrAPI.updateShift(f.id, { ...f, break_minutes: Number(f.break_minutes) || 0, color: f.color || null }); else await hrAPI.addShift({ ...f, break_minutes: Number(f.break_minutes) || 0, color: f.color || null }); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="hr-shift-dialog">
        <DialogHeader><DialogTitle>{f.id ? 'Edit shift' : 'New shift'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name *" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="General, Early, Site…" className="h-11" data-testid="hr-shift-name" /></Field>
          <Field label="Starts"><input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className={inputCls} data-testid="hr-shift-start" /></Field>
          <Field label="Ends"><input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className={inputCls} /></Field>
          <Field label="Break (minutes)" className="col-span-2"><Input type="number" inputMode="numeric" value={f.break_minutes} onChange={(e) => setF({ ...f, break_minutes: e.target.value })} className="h-11" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={!f.name.trim()} className="bg-emerald-600 text-white" data-testid="hr-shift-save">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Shifts({ shifts, canEdit, reloadShifts }) {
  const [week, setWeek] = useState(todayISO());
  const [ros, setRos] = useState(null);
  const [edits, setEdits] = useState({});
  const [dlg, setDlg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [day, setDay] = useState(null);
  const load = useCallback(() => hrAPI.roster(week).then((r) => { setRos(r.data); setEdits({}); }).catch(() => setRos(false)), [week]);
  useEffect(() => { load(); }, [load]);
  const n = Object.keys(edits).length;
  const save = async () => {
    setSaving(true);
    try { await hrAPI.saveRoster(Object.entries(edits).map(([k, v]) => { const [user_id, date] = k.split('|'); return { user_id, date, shift_id: v === 'default' ? null : v }; })); toast.success('Roster saved'); load(); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  const copy = async () => {
    const next = addDaysISO(ros.days[0], 7);
    try { const r = await hrAPI.copyWeek(ros.days[0], next); toast.success(`Copied ${r.data.copied} entries to next week`); } catch (e) { toast.error(errText(e)); }
  };
  if (ros === null) return <Loading />;
  if (!ros) return <Empty title="Could not load the roster" />;
  const t = todayISO();
  const shownDay = day && ros.days.includes(day) ? day : (ros.days.includes(t) ? t : ros.days[0]);
  const cellBody = (p, c) => {
    const key = `${p.id}|${c.date}`;
    const val = edits[key] ?? (c.set ? (c.shift_id || 'default') : 'default');
    return (
      <>
        {canEdit ? (
          <Select value={val} onValueChange={(v) => setEdits((e) => ({ ...e, [key]: v }))}>
            <SelectTrigger className="h-9 text-xs sm:h-8" aria-label={`${p.name} on ${c.date}`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="default">{p.default_shift_id ? `Usual (${(shifts.find((s) => s.id === p.default_shift_id) || {}).name || 'shift'})` : 'No shift'}</SelectItem>
              {shifts.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} {s.start}</SelectItem>)}<SelectItem value="off">Day off</SelectItem></SelectContent>
          </Select>
        ) : <span className="text-xs">{c.off ? 'Day off' : c.shift_name || '—'}</span>}
        <span className="mt-0.5 block text-[10px] leading-tight">
          {c.away && <span className="block text-amber-900">Away · {c.away.cover ? `${c.away.cover} covers` : label(REASONS, c.away.reason)}</span>}
          {c.covering_for && <span className="block text-violet-800">Covers {c.covering_for}</span>}
          {c.check_in && <span className={c.late_minutes ? 'font-semibold text-rose-700' : 'text-slate-500'}>In {new Date(c.check_in).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}{c.late_minutes ? ` · ${c.late_minutes} min late` : ''}</span>}
          {c.missing && <span className="text-rose-700">No check-in</span>}
        </span>
      </>
    );
  };
  return (
    <div className="space-y-3" data-testid="hr-shifts">
      <Card title="Shifts" action={canEdit && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setDlg({})} data-testid="hr-shift-new"><Plus className="h-3.5 w-3.5" />New shift</Button>}>
        {shifts.length === 0 ? <p className="text-xs text-slate-500">No shifts yet — add one (for example General 09:00–18:00), then set each person's usual shift in People.</p> : (
          <div className="flex flex-wrap gap-2">{shifts.map((s) => <button key={s.id} type="button" disabled={!canEdit} onClick={() => setDlg(s)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-left text-sm hover:border-emerald-300"><b>{s.name}</b> <span className="text-xs text-slate-500">{s.start}–{s.end}{s.overnight ? ' (next day)' : ''}</span></button>)}</div>)}
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => setWeek(addDaysISO(ros.days[0], -7))} aria-label="Previous week"><ChevronLeft className="h-5 w-5" /></Button>
        <p className="font-medium text-slate-900" data-testid="hr-week-label">{fmtDate(ros.days[0], { day: 'numeric', month: 'short' })} – {fmtDate(ros.days[6])}</p>
        <Button variant="ghost" size="icon" onClick={() => setWeek(addDaysISO(ros.days[0], 7))} aria-label="Next week"><ChevronRight className="h-5 w-5" /></Button>
        <div className="ml-auto flex gap-2">
          {canEdit && <Button variant="outline" className="h-9 gap-1" onClick={copy} data-testid="hr-week-copy"><Copy className="h-4 w-4" />Copy to next week</Button>}
          {canEdit && n > 0 && <Button className="h-9 gap-1 bg-emerald-600 text-white" onClick={save} disabled={saving} data-testid="hr-roster-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save {n} change{n === 1 ? '' : 's'}</Button>}
        </div>
      </div>
      <div className="space-y-2 sm:hidden" data-testid="hr-roster-phone">
        <div className="grid grid-cols-7 gap-1">{ros.days.map((d) => {
          const dt = new Date(`${d}T00:00:00`);
          return (
            <button key={d} type="button" onClick={() => setDay(d)} aria-pressed={d === shownDay}
              className={`rounded-lg border py-1.5 text-center ${d === shownDay ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'}`}>
              <span className="block text-[10px] uppercase">{dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
              <b className={`block text-sm ${d === t ? 'underline decoration-2 underline-offset-2' : ''}`}>{dt.getDate()}</b>
            </button>);
        })}</div>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">{ros.people.map((p) => {
          const c = p.cells.find((x) => x.date === shownDay);
          if (!c) return null;
          return (
            <li key={p.id} className={`flex items-start gap-3 p-3 ${c.away ? 'bg-amber-50' : ''}`}>
              <div className="min-w-0 flex-1"><span className="block font-medium text-slate-900">{p.name}</span><span className="text-[11px] text-slate-500">{p.designation || p.department || ''}</span></div>
              <div className="w-40 shrink-0">{cellBody(p, c)}</div>
            </li>);
        })}</ul>
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block" data-testid="hr-roster">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="sticky left-0 z-10 bg-slate-50 p-2 text-left font-medium">Person</th>
            {ros.days.map((d) => <th key={d} className={`p-2 text-left font-medium ${d === t ? 'text-emerald-700' : ''}`}>{new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{ros.people.map((p) => (
            <tr key={p.id}>
              <td className="sticky left-0 z-10 bg-white p-2"><span className="block font-medium text-slate-900">{p.name}</span><span className="text-[11px] text-slate-500">{p.designation || p.department || ''}</span></td>
              {p.cells.map((c) => (
                <td key={c.date} className={`min-w-[7.5rem] p-1.5 align-top ${c.away ? 'bg-amber-50' : ''}`}>{cellBody(p, c)}</td>
              ))}
            </tr>))}</tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">Late = checked in more than {ros.grace_minutes} minutes after the shift start. “Usual” follows the shift set for the person in People.</p>
      <ShiftDialog open={!!dlg} initial={dlg?.id ? dlg : null} onOpenChange={(o) => !o && setDlg(null)} onSaved={() => { reloadShifts(); load(); }} />
    </div>
  );
}

// ───────────────────────── exits ─────────────────────────
function ExitDialog({ open, people, settings, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ user_id: '', type: 'resignation', reason: '', notice_start: todayISO(), notice_days: settings?.notice_days?.resignation ?? 30, waived_days: 0, last_working_day: '', notes: '' }); }, [open, settings]);
  if (!f) return null;
  const lwd = f.last_working_day || addDaysISO(f.notice_start, Math.max(Number(f.notice_days || 0) - Number(f.waived_days || 0) - 1, 0));
  const save = async () => {
    setSaving(true);
    try { await hrAPI.addExit({ ...f, notice_days: Number(f.notice_days), waived_days: Number(f.waived_days) || 0, last_working_day: f.last_working_day || null }); toast.success('Exit recorded'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto" data-testid="hr-exit-dialog">
        <DialogHeader><DialogTitle>Record an exit</DialogTitle><DialogDescription>Their login keeps working until the last working day, then closes.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Person *" className="col-span-2"><Pick value={f.user_id} onChange={(v) => setF({ ...f, user_id: v })} options={people.filter((p) => p.status === 'active').map((p) => [p.id, `${p.name}${p.designation ? ` · ${p.designation}` : ''}`])} placeholder="Choose" testid="hr-exit-person" /></Field>
          <Field label="Type"><Select value={f.type} onValueChange={(v) => setF({ ...f, type: v, notice_days: settings?.notice_days?.[v] ?? f.notice_days })}><SelectTrigger className="h-11" data-testid="hr-exit-type"><SelectValue /></SelectTrigger><SelectContent>{EXIT_TYPES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Notice given on"><input type="date" value={f.notice_start} onChange={(e) => setF({ ...f, notice_start: e.target.value })} className={inputCls} data-testid="hr-exit-start" /></Field>
          <Field label="Notice period (days)"><Input type="number" inputMode="numeric" value={f.notice_days} onChange={(e) => setF({ ...f, notice_days: e.target.value })} className="h-11" data-testid="hr-exit-days" /></Field>
          <Field label="Days waived / bought out"><Input type="number" inputMode="numeric" value={f.waived_days} onChange={(e) => setF({ ...f, waived_days: e.target.value })} className="h-11" /></Field>
          <Field label="Last working day" className="col-span-2" hint={f.last_working_day ? 'Set by hand' : 'Worked out from the notice'}><input type="date" value={f.last_working_day || lwd} onChange={(e) => setF({ ...f, last_working_day: e.target.value })} className={inputCls} data-testid="hr-exit-lwd" /></Field>
          <Field label={f.type === 'termination' ? 'Reason *' : 'Reason'} className="col-span-2"><textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" data-testid="hr-exit-reason" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !f.user_id || (f.type === 'termination' && f.reason.trim().length < 5)} className="bg-rose-600 text-white hover:bg-rose-700" data-testid="hr-exit-save">Record exit</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Exits({ people, settings, reloadPeople }) {
  const [rows, setRows] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [sel, setSel] = useState(null);
  const load = useCallback(() => hrAPI.exits().then((r) => { setRows(r.data); setSel((s) => (s ? r.data.find((x) => x.id === s.id) || null : null)); }).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const update = async (e, body) => { try { await hrAPI.updateExit(e.id, body); load(); } catch (err) { toast.error(errText(err)); } };
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); load(); reloadPeople(); } catch (err) { toast.error(errText(err)); } };
  return (
    <div className="space-y-3" data-testid="hr-exits">
      <div className="flex items-center justify-between gap-2"><p className="text-sm text-slate-600">Resignations, terminations and the notice period.</p>
        <Button onClick={() => setDlg(true)} variant="outline" className="h-10 gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50" data-testid="hr-exit-new"><LogOut className="h-4 w-4" />Record exit</Button></div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon={LogOut} title="No exits" /> : (
        <ul className="space-y-2">{rows.map((e) => (
          <li key={e.id}><button type="button" onClick={() => setSel(e)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-emerald-300" data-testid={`hr-exit-${e.id}`}>
            <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{e.name}</p><Chip tone={e.type === 'termination' ? 'red' : 'slate'}>{label(EXIT_TYPES, e.type)}</Chip>
              <Chip tone={e.status === 'serving_notice' ? 'amber' : e.status === 'completed' ? 'slate' : 'green'}>{e.status === 'serving_notice' ? `Last day ${fmtDate(e.last_working_day)} · ${e.days_left} days` : e.status === 'completed' ? `Left ${fmtDate(e.last_working_day)}` : 'Withdrawn'}</Chip></div>
            <p className="text-xs text-slate-500">{e.designation || ''}{e.designation ? ' · ' : ''}checklist {e.checklist_done}/{e.checklist_total}{e.assets_with_person ? ` · ${e.assets_with_person} company asset${e.assets_with_person === 1 ? '' : 's'} still with them` : ''}</p>
          </button></li>))}</ul>
      )}
      <ExitDialog open={dlg} people={people} settings={settings} onOpenChange={setDlg} onSaved={() => { load(); reloadPeople(); }} />
      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="hr-exit-sheet">
          {sel && <div className="space-y-4">
            <SheetHeader className="space-y-1 text-left"><SheetTitle>{sel.name} · {label(EXIT_TYPES, sel.type)}</SheetTitle>
              <SheetDescription>Notice from {fmtDate(sel.notice_start)} · {sel.notice_days} days{sel.waived_days ? ` (${sel.waived_days} waived)` : ''} · last working day {fmtDate(sel.last_working_day)}</SheetDescription></SheetHeader>
            {sel.reason && <p className="rounded-lg bg-slate-50 p-2 text-sm">{sel.reason}</p>}
            {sel.assets_with_person > 0 && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{sel.assets_with_person} company asset{sel.assets_with_person === 1 ? ' is' : 's are'} still with them — <Link to="/dashboard/assets" className="underline">see Assets</Link>.</p>}
            <Card title="Handover checklist">
              <ul className="space-y-1">{sel.checklist.map((c, i) => (
                <li key={c.item}><button type="button" disabled={sel.status !== 'serving_notice'} aria-pressed={c.done} onClick={() => update(sel, { checklist: sel.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50" data-testid={`hr-exit-check-${i}`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${c.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>{c.done && <Check className="h-3.5 w-3.5" />}</span>
                  <span className={c.done ? 'text-slate-500 line-through' : 'text-slate-800'}>{c.item}</span>{c.done_by && <span className="ml-auto text-[10px] text-slate-400">{c.done_by}</span>}</button></li>))}</ul>
            </Card>
            <Field label="Exit interview notes"><textarea rows={3} defaultValue={sel.exit_interview || ''} onBlur={(e) => e.target.value !== (sel.exit_interview || '') && update(sel, { exit_interview: e.target.value })} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
            {sel.status === 'serving_notice' && <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => act(() => hrAPI.withdrawExit(sel.id), 'Exit withdrawn — they stay')} data-testid="hr-exit-withdraw">Withdraw (they stay)</Button>
              <Button className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => window.confirm(`Relieve ${sel.name} now? Their login is switched off.`) && act(() => hrAPI.completeExit(sel.id), 'Relieved — login switched off')} data-testid="hr-exit-complete">Relieve now</Button>
            </div>}
          </div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SettingsDialog({ open, settings, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  useEffect(() => { if (open && settings) setF({ ...settings, departments_text: settings.departments.join('\n') }); }, [open, settings]);
  if (!f) return null;
  const save = async () => {
    try { await hrAPI.saveSettings({ notice_days: f.notice_days, grace_minutes: Number(f.grace_minutes) || 0, departments: f.departments_text.split('\n').map((x) => x.trim()).filter(Boolean) }); toast.success('HR settings saved'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-sm overflow-y-auto" data-testid="hr-settings">
        <DialogHeader><DialogTitle>HR settings</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Notice period (days)</p>
          {EXIT_TYPES.map(([k, l]) => <Field key={k} label={l}><Input type="number" inputMode="numeric" value={f.notice_days[k] ?? 0} onChange={(e) => setF({ ...f, notice_days: { ...f.notice_days, [k]: Number(e.target.value) } })} className="h-11" /></Field>)}
          <Field label="Late after (minutes past shift start)"><Input type="number" inputMode="numeric" value={f.grace_minutes} onChange={(e) => setF({ ...f, grace_minutes: e.target.value })} className="h-11" /></Field>
          <Field label="Departments" hint="One per line"><textarea rows={6} value={f.departments_text} onChange={(e) => setF({ ...f, departments_text: e.target.value })} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} className="bg-emerald-600 text-white">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HRPage() {
  const { isAdmin, isManager, can } = useAuth();
  const canEdit = isAdmin || isManager || can('module_hr', 'edit');
  const seesExits = isAdmin || can('can_manage_exits');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const [people, setPeople] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [setOpen, setSetOpen] = useState(false);
  const loadPeople = useCallback(() => hrAPI.people().then((r) => setPeople(r.data)).catch(() => setPeople([])), []);
  const loadShifts = useCallback(() => hrAPI.shifts().then((r) => setShifts(r.data)).catch(() => {}), []);
  const loadSettings = useCallback(() => hrAPI.settings().then((r) => setSettings(r.data)).catch(() => {}), []);
  useEffect(() => { loadPeople(); loadShifts(); loadSettings(); }, [loadPeople, loadShifts, loadSettings]);
  useLiveRefresh(['hr', 'users'], loadPeople);
  const activePeople = useMemo(() => (people || []).filter((p) => p.active), [people]);
  if (!people) return <Loading />;
  return (
    <div className="px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader icon={IdCard} title="HR" sub="People, hiring, cover for absent staff, shifts and exits" testid="hr-page">
          {isAdmin && <Button variant="outline" className="h-10 gap-1.5" onClick={() => setSetOpen(true)} data-testid="hr-settings-btn"><Settings2 className="h-4 w-4" />Settings</Button>}
        </PageHeader>
        <PillTabs value={tab} onChange={setTab} testid="hr-tab" tabs={[['overview', 'Overview'], ['people', 'People'], ['hiring', 'Hiring'], ['cover', 'Cover'], ['shifts', 'Shifts'], seesExits && ['exits', 'Exits']]} />
        {tab === 'overview' && <Overview onTab={setTab} />}
        {tab === 'people' && <People people={people} shifts={shifts} settings={settings} canEdit={canEdit} reload={loadPeople} />}
        {tab === 'hiring' && <Hiring people={activePeople} settings={settings} canEdit={canEdit} />}
        {tab === 'cover' && <Cover people={activePeople} shifts={shifts} canEdit={canEdit} />}
        {tab === 'shifts' && <Shifts shifts={shifts} canEdit={canEdit} reloadShifts={loadShifts} />}
        {tab === 'exits' && seesExits && <Exits people={activePeople} settings={settings} reloadPeople={loadPeople} />}
      </div>
      {isAdmin && <SettingsDialog open={setOpen} settings={settings} onOpenChange={setSetOpen} onSaved={loadSettings} />}
    </div>
  );
}
