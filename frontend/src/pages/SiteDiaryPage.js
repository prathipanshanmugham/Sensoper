import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { siteDiaryAPI, dailyReportsAPI, partnersAPI, inventoryAPI, uploadAPI, companyAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { DateNav, Section, Stepper, Chip, Field, ProjectPicker, inputCls, textareaCls } from '../components/FormBits';
import PhotoSourceButtons from '../components/PhotoSourceButtons';
import { localDate, dayLabel, fullDate, compressImage } from '../lib/format';
import { generateSiteDiaryPDF } from '../utils/siteDiaryPDF';
import { StatusPill } from './Dashboard';
import { Plus, Trash2, Loader2, Download, Save, Sun, Cloud, CloudRain, CloudDrizzle, ShieldCheck, ShieldAlert, ArrowRight, NotebookPen, BookOpen, X } from 'lucide-react';
import Can from '../components/Can';

export const STAGES = ['Site survey', 'Material delivered', 'Structure erected', 'Panels mounted', 'DC wiring done', 'Inverter installed', 'AC wiring & earthing', 'Testing & commissioning', 'Net-meter applied', 'Handover done'];
const WEATHER = [['Sunny', Sun], ['Cloudy', Cloud], ['Light rain', CloudDrizzle], ['Heavy rain', CloudRain]];
const PCT = [10, 25, 40, 50, 60, 75, 90, 100];
const UNITS = ['nos', 'm', 'kg', 'set', 'box', 'litre'];
const ROLES = ['Installer', 'Electrician', 'Helper', 'Supervisor', 'Engineer'];
const EMPTY = () => ({ weather: '', start_time: '', end_time: '', crew: [], stages_done: [], work_done: '', progress_pct: null, materials_used: [], issues: '', safety_ok: null, safety_notes: '', customer_feedback: '', next_steps: '', photos: [] });
const API_URL = process.env.REACT_APP_BACKEND_URL;

let companyCache = null;
const company = async () => { if (!companyCache) { try { companyCache = (await companyAPI.getActive()).data; } catch { companyCache = {}; } } return companyCache; };

function Photo({ path, onRemove }) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      <img src={`${API_URL}/api/files/${path}`} alt="Site" className="h-full w-full object-cover" loading="lazy" />
      {onRemove && <button type="button" onClick={onRemove} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/70 text-white" aria-label="Remove photo"><X className="h-4 w-4" /></button>}
    </div>
  );
}

function DiaryForm({ projectId, date, projects, partners, items, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [open, setOpen] = useState({ work: true, crew: true, materials: false, safety: false, photos: false, next: true });

  useEffect(() => {
    let live = true;
    setData(null);
    siteDiaryAPI.get(projectId, date).then((r) => {
      if (!live) return;
      setData(r.data);
      const f = r.data.exists ? { ...EMPTY(), ...Object.fromEntries(Object.keys(EMPTY()).map((k) => [k, r.data[k] ?? EMPTY()[k]])) } : EMPTY();
      setForm(f); setDirty(false);
      setOpen({ work: true, crew: true, materials: f.materials_used.length > 0, safety: f.safety_ok != null || !!f.safety_notes, photos: f.photos.length > 0, next: true });
    }).catch(() => toast.error('Could not load the diary'));
    return () => { live = false; };
  }, [projectId, date]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const setRow = (key, i, patch) => set({ [key]: form[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const toggleStage = (s) => set({ stages_done: form.stages_done.includes(s) ? form.stages_done.filter((x) => x !== s) : [...form.stages_done, s] });
  const earlier = new Set(data?.previous?.stages_done || []);

  const upload = async (files) => {
    const list = [...files].slice(0, 10 - form.photos.length);
    if (!list.length) return;
    setUploading(list.length); setOpen((o) => ({ ...o, photos: true }));
    const added = [];
    for (const f of list) {
      try { const small = await compressImage(f); added.push((await uploadAPI.uploadSiteImage(small)).data.storage_path); }
      catch (e) { toast.error(e.response?.data?.detail || `Could not upload ${f.name}`); }
      setUploading((n) => n - 1);
    }
    if (added.length) { setForm((f) => ({ ...f, photos: [...f.photos, ...added] })); setDirty(true); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, progress_pct: form.progress_pct == null || form.progress_pct === '' ? null : Number(form.progress_pct),
        crew: form.crew.filter((c) => c.name || c.count).map((c) => ({ ...c, count: Number(c.count) || 0 })),
        materials_used: form.materials_used.filter((m) => m.item).map((m) => ({ ...m, qty: Number(m.qty) || 0 })) };
      const r = await siteDiaryAPI.save(projectId, date, payload);
      setData((d) => ({ ...d, ...r.data })); setDirty(false);
      toast.success('Site diary saved'); onSaved?.();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not save'); }
    finally { setSaving(false); }
  };
  const pdf = async (all) => {
    if (dirty) await save();
    try {
      const book = (await siteDiaryAPI.book(projectId, all ? {} : { date_from: date, date_to: date })).data;
      if (!book.diaries.length) { toast.error('Save the diary first'); return; }
      await generateSiteDiaryPDF({ project: book.project, diaries: book.diaries, companyProfile: await company(), stages: STAGES,
        filename: `Site-diary-${book.project.customer.replace(/\s+/g, '-')}${all ? '' : `-${date}`}.pdf` });
    } catch (e) { console.error(e); toast.error('Could not create the PDF'); }
  };

  if (!data) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>;
  const crewTotal = form.crew.reduce((s, c) => s + (Number(c.count) || 0), 0);
  const prev = data.previous;

  return (
    <div className="space-y-3">
      {prev && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" data-testid="diary-previous">
          <p className="font-medium">Last entry {dayLabel(prev.date).toLowerCase()}{prev.progress_pct != null ? ` · ${prev.progress_pct}% done` : ''}</p>
          {prev.next_steps && <p className="mt-0.5 flex gap-1.5"><ArrowRight className="mt-0.5 h-4 w-4 shrink-0" />Planned next: {prev.next_steps}</p>}
        </div>
      )}
      {data.exists && <p className="text-xs text-slate-500">Saved by {(data.authors || []).join(', ')}{data.updated_at ? ` · last change ${new Date(data.updated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}{dirty && <b className="ml-1 text-amber-700">· Unsaved changes</b>}</p>}

      <Section n={1} title="Work done today" hint="Stages finished, progress and a short note" summary={form.stages_done.length || form.work_done ? `${form.stages_done.length} stage${form.stages_done.length === 1 ? '' : 's'}${form.progress_pct != null ? ` · ${form.progress_pct}%` : ''}` : ''} open={open.work} onToggle={() => setOpen((o) => ({ ...o, work: !o.work }))} testid="diary-section-work">
        <div className="space-y-4">
          <Field group label="Weather"><div className="flex flex-wrap gap-1.5">{WEATHER.map(([w, I]) => <Chip key={w} active={form.weather === w} onClick={() => set({ weather: form.weather === w ? '' : w })}><I className="h-4 w-4" />{w}</Chip>)}</div></Field>
          <Field group label="Stages finished today" hint={earlier.size ? 'Green = finished on an earlier day' : 'Tap every stage completed today'}>
            <div className="flex flex-wrap gap-1.5">{STAGES.map((s) => <Chip key={s} active={form.stages_done.includes(s)} done={!form.stages_done.includes(s) && earlier.has(s)} onClick={() => toggleStage(s)} testid={`diary-stage-${s.replace(/\W+/g, '-')}`}>{s}</Chip>)}</div>
          </Field>
          <Field group label="Overall progress">
            <div className="flex flex-wrap gap-1.5">{PCT.map((p) => <Chip key={p} active={Number(form.progress_pct) === p} onClick={() => set({ progress_pct: Number(form.progress_pct) === p ? null : p })} testid={`diary-pct-${p}`}>{p}%</Chip>)}</div>
          </Field>
          <Field label="What happened on site"><textarea value={form.work_done} onChange={(e) => set({ work_done: e.target.value })} placeholder="e.g. Structure fixed on east roof, 6 of 10 panels mounted" className={textareaCls} id="diary-work" data-testid="diary-work" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time"><input type="time" value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} className={inputCls} id="diary-start" /></Field>
            <Field label="End time"><input type="time" value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} className={inputCls} id="diary-end" /></Field>
          </div>
        </div>
      </Section>

      <Section n={2} title="Crew on site" hint="Who worked here today" summary={form.crew.length ? `${crewTotal} people` : ''} open={open.crew} onToggle={() => setOpen((o) => ({ ...o, crew: !o.crew }))} testid="diary-section-crew">
        <div className="space-y-3">
          {form.crew.map((c, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex gap-2">
                <input list="diary-partners" value={c.name} onChange={(e) => { const p = partners.find((x) => x.name === e.target.value); setRow('crew', i, { name: e.target.value, partner_id: p?.id || null }); }} placeholder="Crew or person name" className={`${inputCls} min-w-0 flex-1`} data-testid={`diary-crew-name-${i}`} />
                <button type="button" onClick={() => set({ crew: form.crew.filter((_, j) => j !== i) })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={c.role} onChange={(e) => setRow('crew', i, { role: e.target.value })} className={`${inputCls} w-auto flex-1`} aria-label="Role">{['', ...ROLES].map((r) => <option key={r} value={r}>{r || 'Role…'}</option>)}</select>
                <Stepper value={c.count} onChange={(v) => setRow('crew', i, { count: v })} min={1} label="people" />
              </div>
            </div>
          ))}
          <datalist id="diary-partners">{partners.map((p) => <option key={p.id} value={p.name} />)}</datalist>
          <Button type="button" variant="outline" onClick={() => set({ crew: [...form.crew, { name: '', role: 'Installer', count: 1, partner_id: null }] })} className="w-full gap-2 border-dashed" data-testid="diary-add-crew"><Plus className="h-4 w-4" />Add crew</Button>
        </div>
      </Section>

      <Section n={3} title="Materials used" hint="What was fitted or used up today" summary={form.materials_used.length ? `${form.materials_used.length} item${form.materials_used.length > 1 ? 's' : ''}` : ''} open={open.materials} onToggle={() => setOpen((o) => ({ ...o, materials: !o.materials }))} testid="diary-section-materials">
        <div className="space-y-3">
          {form.materials_used.map((m, i) => (
            <div key={i} className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <input list="diary-items" value={m.item} onChange={(e) => { const it = items.find((x) => x.name === e.target.value); setRow('materials_used', i, { item: e.target.value, inventory_item_id: it?.id || null }); }} placeholder="Item" className={`${inputCls} min-w-[180px] flex-1`} />
              <input inputMode="decimal" value={m.qty} onChange={(e) => setRow('materials_used', i, { qty: e.target.value.replace(/[^\d.]/g, '') })} placeholder="Qty" className={`${inputCls} w-20`} aria-label="Quantity" />
              <select value={m.unit} onChange={(e) => setRow('materials_used', i, { unit: e.target.value })} className={`${inputCls} w-24`} aria-label="Unit">{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
              <button type="button" onClick={() => set({ materials_used: form.materials_used.filter((_, j) => j !== i) })} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <datalist id="diary-items">{items.map((it) => <option key={it.id} value={it.name} />)}</datalist>
          <Button type="button" variant="outline" onClick={() => set({ materials_used: [...form.materials_used, { item: '', qty: '', unit: 'nos', inventory_item_id: null }] })} className="w-full gap-2 border-dashed" data-testid="diary-add-material"><Plus className="h-4 w-4" />Add material</Button>
        </div>
      </Section>

      <Section n={4} title="Safety & problems" hint="PPE, hazards, anything that slowed the work" summary={form.safety_ok === true ? 'All safe' : form.safety_ok === false ? 'Safety issue' : form.issues ? 'Problem noted' : ''} open={open.safety} onToggle={() => setOpen((o) => ({ ...o, safety: !o.safety }))} testid="diary-section-safety">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Chip active={form.safety_ok === true} onClick={() => set({ safety_ok: true })}><ShieldCheck className="h-4 w-4" />All safe, PPE used</Chip>
            <Chip active={form.safety_ok === false} onClick={() => set({ safety_ok: false })}><ShieldAlert className="h-4 w-4" />Safety issue</Chip>
          </div>
          {form.safety_ok === false && <input value={form.safety_notes} onChange={(e) => set({ safety_notes: e.target.value })} placeholder="What happened?" className={inputCls} />}
          <Field label="Problems on site"><textarea value={form.issues} onChange={(e) => set({ issues: e.target.value })} placeholder="Material short, roof access, customer requests, rain…" className={textareaCls} id="diary-issues" /></Field>
          <Field label="Customer feedback"><input value={form.customer_feedback} onChange={(e) => set({ customer_feedback: e.target.value })} placeholder="Optional" className={inputCls} /></Field>
        </div>
      </Section>

      <Section n={5} title="Photos" hint="Before / after shots, structure, wiring, meter" summary={form.photos.length ? `${form.photos.length} photo${form.photos.length > 1 ? 's' : ''}` : ''} open={open.photos} onToggle={() => setOpen((o) => ({ ...o, photos: !o.photos }))} testid="diary-section-photos">
        <div className="space-y-3">
          {form.photos.length > 0 && <div className="grid grid-cols-3 gap-2">{form.photos.map((p) => <Photo key={p} path={p} onRemove={() => set({ photos: form.photos.filter((x) => x !== p) })} />)}</div>}
          {uploading > 0
            ? <p className="flex h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 text-sm text-emerald-700" data-testid="diary-uploading"><Loader2 className="h-4 w-4 animate-spin" />Uploading {uploading}…</p>
            : <PhotoSourceButtons onFiles={upload} disabled={form.photos.length >= 10} testid="diary-photo" />}
          <p className="text-[11px] text-slate-400">Up to 10 photos per day. Big phone photos are shrunk before upload to save data.</p>
        </div>
      </Section>

      <Section n={6} title="Next steps" hint="What the next team should do here" summary={form.next_steps ? 'Filled in' : ''} open={open.next} onToggle={() => setOpen((o) => ({ ...o, next: !o.next }))} testid="diary-section-next">
        <textarea value={form.next_steps} onChange={(e) => set({ next_steps: e.target.value })} placeholder="e.g. Mount remaining 4 panels, start DC wiring" className={textareaCls} id="diary-next" data-testid="diary-next" />
      </Section>

      <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom,0px))] z-20 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border lg:bottom-4">
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving || (!dirty && data.exists)} className="h-12 flex-1 gap-2 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="diary-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{data.exists && !dirty ? 'Saved' : 'Save diary'}</Button>
          <Can module="module_site_diary" action="export"><Button variant="outline" onClick={() => pdf(false)} disabled={!data.exists} className="h-12 gap-2 px-3" title="PDF of this day" data-testid="diary-pdf-day"><Download className="h-4 w-4" /><span className="hidden sm:inline">This day</span></Button></Can>
          <Can module="module_site_diary" action="export"><Button variant="outline" onClick={() => pdf(true)} className="h-12 gap-2 px-3" title="PDF of the whole diary" data-testid="diary-pdf-all"><BookOpen className="h-4 w-4" /><span className="hidden sm:inline">Whole diary</span></Button></Can>
        </div>
      </div>
    </div>
  );
}

export default function SiteDiaryPage() {
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [partners, setPartners] = useState([]);
  const [items, setItems] = useState([]);
  const [recent, setRecent] = useState(null);
  const today = localDate();
  const projectId = params.get('project') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') && params.get('date') <= today ? params.get('date') : today;
  const update = (patch) => {
    const n = { project: projectId, date, ...patch }; const out = {};
    if (n.project) out.project = n.project; if (n.date !== today) out.date = n.date;
    setParams(out, { replace: true });
  };

  const loadRecent = useCallback(() => siteDiaryAPI.list({ limit: 40, ...(projectId ? { project_id: projectId } : {}) }).then((r) => setRecent(r.data)).catch(() => setRecent({ diaries: [], project_info: {} })), [projectId]);
  useEffect(() => {
    dailyReportsAPI.projects().then((r) => setProjects(r.data || [])).catch(() => {});
    partnersAPI.list().then((r) => setPartners(Array.isArray(r.data) ? r.data : (r.data?.partners || []))).catch(() => {});
    inventoryAPI.getItems().then((r) => setItems(Array.isArray(r.data) ? r.data : (r.data?.items || []))).catch(() => {});
  }, []);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const project = projects.find((p) => p.id === projectId);
  const active = useMemo(() => projects.filter((p) => ['approved', 'submitted'].includes(p.status)).slice(0, 8), [projects]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 sm:py-6" data-testid="site-diary-page">
      <div className="mb-4">
        <h1 className="font-['Outfit'] text-2xl font-semibold text-slate-900">Site diary</h1>
        <p className="text-sm text-slate-500">One page per site per day — crew, stages, materials and photos.</p>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <Field group label="Project"><ProjectPicker projects={projects} value={projectId} onChange={(v) => update({ project: v })} placeholder="Choose the site / project" testid="diary-project" /></Field>
        {project && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
            <StatusPill status={project.status} />
            <span>{project.reference_number}</span>
            {project.system_size_kw && <span>{project.system_size_kw} kW</span>}
            {project.location?.district && <span>{project.location.district}</span>}
            <Link to={`/dashboard/projects/${project.id}`} className="ml-auto font-medium text-emerald-700 hover:underline">Open project</Link>
          </div>
        )}
        {projectId && <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-slate-700">{fullDate(date)}</span><DateNav value={date} onChange={(d) => update({ date: d })} testid="diary-date" /></div>}
      </div>

      {!projectId ? (
        <div className="space-y-4">
          {active.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Active sites</p>
              <div className="flex flex-wrap gap-2">{active.map((p) => <button key={p.id} type="button" onClick={() => update({ project: p.id })} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-300 hover:text-emerald-800" data-testid={`diary-quick-${p.id}`}>{p.customer?.name}</button>)}</div>
            </div>
          )}
          <RecentList recent={recent} onOpen={(d) => update({ project: d.project_id, date: d.date })} showProject />
        </div>
      ) : (
        <div className="space-y-6">
          <DiaryForm key={`${projectId}-${date}`} projectId={projectId} date={date} projects={projects} partners={partners} items={items} onSaved={loadRecent} />
          <RecentList recent={recent} onOpen={(d) => update({ date: d.date })} title="Earlier days on this site" />
        </div>
      )}
    </div>
  );
}

function RecentList({ recent, onOpen, showProject, title = 'Latest diary entries' }) {
  if (!recent) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (!recent.diaries.length) return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center">
      <NotebookPen className="mx-auto mb-2 h-8 w-8 text-slate-300" />
      <p className="text-sm text-slate-500">No diary entries yet. Pick a project above to write the first one.</p>
    </div>
  );
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100" data-testid="diary-recent">
        {recent.diaries.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onOpen(d)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
              <span className="w-20 shrink-0 text-sm font-semibold text-slate-900">{dayLabel(d.date)}</span>
              <span className="min-w-0 flex-1">
                {showProject && <span className="block truncate text-sm font-medium text-slate-900">{recent.project_info?.[d.project_id]?.customer || d.customer}</span>}
                <span className="block truncate text-xs text-slate-500">{[(d.stages_done || []).join(', '), d.crew_total ? `crew ${d.crew_total}` : null, (d.photos || []).length ? `${d.photos.length} photos` : null].filter(Boolean).join(' · ') || d.work_done || 'Entry'}</span>
              </span>
              {d.progress_pct != null && <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-700">{d.progress_pct}%</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
