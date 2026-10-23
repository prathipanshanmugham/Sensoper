/* Brands: our own brands (logos, trademarks) and the brands we deal or distribute (agreement, target),
 * the stock items of each brand, and brand-wise reports. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { AlertTriangle, BadgeCheck, Building2, FileSpreadsheet, ImagePlus, Link2, Loader2, Package, Pencil, Plus, Search, Stamp, Trash2, X } from 'lucide-react';
import { brandsAPI, inventoryAPI, uploadAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import Can from '../components/Can';
import { useLiveRefresh } from '../lib/liveSync';
import { Card, Chip, Empty, Field, FileAttach, Loading, PageHeader, PillTabs, Tile, Tiles, addDaysISO, errText, fmtDate, inputCls, inr, inrShort, todayISO } from '../components/kit/PageBits';

const KIND = { own: ['Our brand', 'green'], dealership: ['Dealership', 'blue'], distribution: ['Distribution', 'violet'] };
const TM_STATUS = [['planned', 'Planned'], ['filed', 'Filed'], ['formalities_check', 'Formalities check'], ['examined', 'Examined'], ['objected', 'Objected'],
  ['accepted', 'Accepted'], ['advertised', 'Advertised in journal'], ['opposed', 'Opposed'], ['registered', 'Registered'], ['refused', 'Refused'],
  ['abandoned', 'Abandoned'], ['withdrawn', 'Withdrawn']];
const TM_TONE = { registered: 'green', objected: 'amber', opposed: 'amber', refused: 'red', abandoned: 'slate', withdrawn: 'slate', planned: 'slate' };
const OFFICES = ['Chennai', 'Mumbai', 'Delhi', 'Kolkata', 'Ahmedabad'];
const SERIES = { counter: '#2a78d6', online: '#eb6834', projects: '#1baf7a' };   // validated categorical slots 1–3
const statusLabel = (s) => (TM_STATUS.find(([k]) => k === s) || [s, s])[1];
const logoSrc = (b) => (b?.logo_path ? uploadAPI.getFileUrl(b.logo_path) : null);
const blankBrand = { name: '', kind: 'own', logo_path: null, tagline: '', website: '', notes: '', active: true,
  contact: { company: '', person: '', phone: '', email: '' }, agreement: { start_date: '', end_date: '', territory: '', margin_pct: '', target_amount: '', credit_days: '', notes: '' } };
const blankTm = { mark: '', mark_type: 'word', classes: '', application_number: '', filing_date: '', status: 'planned', registration_number: '', registration_date: '',
  valid_until: '', agent: '', office: 'Chennai', next_action: '', next_action_date: '', documents: [], notes: '' };

function BrandLogo({ brand, size = 'h-12 w-12' }) {
  const [bad, setBad] = useState(false);
  const src = logoSrc(brand);
  if (!src || bad) {
    return <div className={`flex ${size} shrink-0 items-center justify-center rounded-lg bg-slate-100 font-['Outfit'] text-sm font-bold text-slate-500`}>{(brand?.name || '?').slice(0, 2).toUpperCase()}</div>;
  }
  return <img src={src} alt={`${brand.name} logo`} onError={() => setBad(true)} className={`${size} shrink-0 rounded-lg border border-slate-100 bg-white object-contain p-1`} />;
}

// ───────────────────────── brand form (create / edit) ─────────────────────────
function BrandForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const setIn = (grp, k) => (e) => setF((x) => ({ ...x, [grp]: { ...x[grp], [k]: e?.target ? e.target.value : e } }));
  const uploadLogo = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') { toast.error('Choose a PNG or JPG picture'); return; }
    setUploading(true);
    try { const r = await uploadAPI.uploadImage(file); setF((x) => ({ ...x, logo_path: r.data.storage_path })); } catch (err) { toast.error(errText(err, 'Upload failed')); } finally { setUploading(false); }
  };
  const save = async () => {
    setSaving(true);
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const body = { ...f, name: f.name.trim(), agreement: { ...f.agreement, start_date: f.agreement.start_date || null, end_date: f.agreement.end_date || null,
      margin_pct: num(f.agreement.margin_pct), target_amount: num(f.agreement.target_amount), credit_days: num(f.agreement.credit_days) } };
    try {
      const r = f.id ? await brandsAPI.update(f.id, body) : await brandsAPI.create(body);
      toast.success(f.id ? 'Brand saved' : 'Brand added'); onSaved(r.data);
    } catch (err) { toast.error(errText(err, 'Could not save')); } finally { setSaving(false); }
  };
  const dealer = f.kind !== 'own';
  return (
    <div className="space-y-3" data-testid="brand-form">
      <div className="flex items-center gap-3">
        <BrandLogo brand={{ ...f, name: f.name || '?' }} size="h-16 w-16" />
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadLogo} data-testid="brand-logo-input" />
        <div className="flex flex-col gap-1">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="brand-logo-upload">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{f.logo_path ? 'Change logo' : 'Add logo'}</Button>
          {f.logo_path && <button type="button" className="text-left text-[11px] text-slate-500 underline" onClick={() => setF((x) => ({ ...x, logo_path: null }))}>Remove logo</button>}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Brand name *"><Input value={f.name} onChange={set('name')} className="h-11" data-testid="brand-name" /></Field>
        <Field label="Kind">
          <Select value={f.kind} onValueChange={set('kind')}><SelectTrigger className="h-11" data-testid="brand-kind"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="own">Our brand</SelectItem><SelectItem value="dealership">Dealership (we sell their brand)</SelectItem><SelectItem value="distribution">Distribution (we supply dealers)</SelectItem></SelectContent></Select>
        </Field>
        <Field label="Tagline / what it is"><Input value={f.tagline || ''} onChange={set('tagline')} className="h-11" placeholder="e.g. Solar panel coating" /></Field>
        <Field label="Website"><Input value={f.website || ''} onChange={set('website')} className="h-11" placeholder="https://" /></Field>
      </div>
      {dealer && (
        <>
          <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Agreement</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts"><input type="date" value={f.agreement.start_date || ''} onChange={setIn('agreement', 'start_date')} className={inputCls} /></Field>
            <Field label="Ends"><input type="date" value={f.agreement.end_date || ''} onChange={setIn('agreement', 'end_date')} className={inputCls} data-testid="brand-agreement-end" /></Field>
            <Field label="Territory" className="col-span-2"><Input value={f.agreement.territory || ''} onChange={setIn('agreement', 'territory')} className="h-11" placeholder="Districts or states" /></Field>
            <Field label="Our margin (%)"><Input type="number" inputMode="decimal" value={f.agreement.margin_pct ?? ''} onChange={setIn('agreement', 'margin_pct')} className="h-11" /></Field>
            <Field label="Yearly target (₹)"><Input type="number" inputMode="decimal" value={f.agreement.target_amount ?? ''} onChange={setIn('agreement', 'target_amount')} className="h-11" data-testid="brand-target" /></Field>
            <Field label="Credit days"><Input type="number" inputMode="numeric" value={f.agreement.credit_days ?? ''} onChange={setIn('agreement', 'credit_days')} className="h-11" /></Field>
          </div>
          <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Their contact</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Company"><Input value={f.contact.company || ''} onChange={setIn('contact', 'company')} className="h-11" /></Field>
            <Field label="Person"><Input value={f.contact.person || ''} onChange={setIn('contact', 'person')} className="h-11" /></Field>
            <Field label="Phone"><Input type="tel" value={f.contact.phone || ''} onChange={setIn('contact', 'phone')} className="h-11" /></Field>
            <Field label="Email"><Input type="email" value={f.contact.email || ''} onChange={setIn('contact', 'email')} className="h-11" /></Field>
          </div>
        </>
      )}
      <Field label="Notes"><textarea rows={2} value={f.notes || ''} onChange={set('notes')} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
      {f.id && <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span>Active<span className="block text-[11px] text-slate-500">Switch off to hide it from lists</span></span><Switch checked={f.active !== false} onCheckedChange={set('active')} /></label>}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button onClick={save} disabled={saving || !f.name.trim()} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="brand-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
      </div>
    </div>
  );
}

// ───────────────────────── trademark dialog ─────────────────────────
function TrademarkDialog({ open, onOpenChange, brandId, initial, onSaved }) {
  const [f, setF] = useState(blankTm);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF(initial ? { ...blankTm, ...initial, classes: (initial.classes || []).join(', ') } : blankTm); }, [open, initial]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setSaving(true);
    const classes = String(f.classes || '').split(/[\s,]+/).filter(Boolean).map(Number);
    if (classes.some((c) => !Number.isInteger(c))) { toast.error('Classes are numbers, e.g. 2, 9'); setSaving(false); return; }
    const body = { ...f, classes };
    ['filing_date', 'registration_date', 'valid_until', 'next_action_date'].forEach((k) => { if (!body[k]) body[k] = null; });
    try {
      if (f.id) await brandsAPI.updateTrademark(f.id, body); else await brandsAPI.addTrademark(brandId, body);
      toast.success('Trademark saved'); onSaved(); onOpenChange(false);
    } catch (err) { toast.error(errText(err, 'Could not save')); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="trademark-dialog">
        <DialogHeader><DialogTitle>{f.id ? 'Edit trademark' : 'Add trademark'}</DialogTitle><DialogDescription>Registered marks in India run 10 years from filing; you get a note 6 months, 2 months and 2 weeks before renewal.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mark (word or logo name) *" className="col-span-2"><Input value={f.mark} onChange={set('mark')} className="h-11" data-testid="tm-mark" /></Field>
          <Field label="Type">
            <Select value={f.mark_type} onValueChange={set('mark_type')}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="word">Word mark</SelectItem><SelectItem value="logo">Logo (device)</SelectItem><SelectItem value="word_and_logo">Word + logo</SelectItem></SelectContent></Select>
          </Field>
          <Field label="Classes" hint="1–45, e.g. 2, 9"><Input value={f.classes} onChange={set('classes')} className="h-11" data-testid="tm-classes" /></Field>
          <Field label="Status">
            <Select value={f.status} onValueChange={set('status')}><SelectTrigger className="h-11" data-testid="tm-status"><SelectValue /></SelectTrigger>
              <SelectContent>{TM_STATUS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
          </Field>
          <Field label="Application no."><Input value={f.application_number || ''} onChange={set('application_number')} className="h-11" data-testid="tm-app-no" /></Field>
          <Field label="Filing date"><input type="date" value={f.filing_date || ''} onChange={set('filing_date')} className={inputCls} data-testid="tm-filing" /></Field>
          <Field label="Registry office">
            <Select value={f.office || 'Chennai'} onValueChange={set('office')}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{OFFICES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select>
          </Field>
          {['registered', 'advertised', 'accepted'].includes(f.status) && <>
            <Field label="Registration no."><Input value={f.registration_number || ''} onChange={set('registration_number')} className="h-11" /></Field>
            <Field label="Registered on"><input type="date" value={f.registration_date || ''} onChange={set('registration_date')} className={inputCls} /></Field>
            <Field label="Valid until" hint="Blank = 10 years from filing" className="col-span-2"><input type="date" value={f.valid_until || ''} onChange={set('valid_until')} className={inputCls} /></Field>
          </>}
          <Field label="Agent / attorney" className="col-span-2"><Input value={f.agent || ''} onChange={set('agent')} className="h-11" /></Field>
          <Field label="Next action"><Input value={f.next_action || ''} onChange={set('next_action')} className="h-11" placeholder="Reply to examination report" /></Field>
          <Field label="By"><input type="date" value={f.next_action_date || ''} onChange={set('next_action_date')} className={inputCls} /></Field>
          <div className="col-span-2 space-y-1">
            <p className="text-xs font-medium text-slate-700">Papers (certificate, filing receipt, reports)</p>
            {(f.documents || []).map((d) => <FileAttach key={d} value={d} onChange={() => setF((x) => ({ ...x, documents: x.documents.filter((y) => y !== d) }))} />)}
            {(f.documents || []).length < 12 && <FileAttach value={null} onChange={(p) => p && setF((x) => ({ ...x, documents: [...(x.documents || []), p] }))} label="Attach a paper" testid="tm-doc" />}
          </div>
          <Field label="Notes" className="col-span-2"><textarea rows={2} value={f.notes || ''} onChange={set('notes')} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !f.mark.trim()} className="bg-emerald-600 text-white" data-testid="tm-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenewalChip({ tm }) {
  if (!tm.renewal_due) return null;
  const d = tm.days_to_renewal;
  const tone = d < 0 ? 'red' : d <= 60 ? 'amber' : 'slate';
  return <Chip tone={tone}>{d < 0 ? `Renewal ${-d} days late` : `Renew by ${fmtDate(tm.renewal_due)} · ${d} days`}</Chip>;
}

// ───────────────────────── brand sheet ─────────────────────────
function BrandSheet({ brandId, onOpenChange, onChanged, canEdit, isAdmin }) {
  const [b, setB] = useState(null);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [tm, setTm] = useState(null);
  const [suggest, setSuggest] = useState(null);
  const [pick, setPick] = useState(false);
  const [allItems, setAllItems] = useState([]);
  const [q, setQ] = useState('');
  const load = useCallback(() => { if (brandId) brandsAPI.get(brandId).then((r) => setB(r.data)).catch(() => toast.error('Could not load the brand')); }, [brandId]);
  useEffect(() => { setB(null); setTab('overview'); setEditing(false); setSuggest(null); load(); }, [load]);
  const changed = () => { load(); onChanged?.(); };
  const loadSuggest = async () => { try { setSuggest((await brandsAPI.suggestItems(brandId)).data); } catch { setSuggest([]); } };
  const link = async (ids) => {
    try { const r = await brandsAPI.linkItems(brandId, ids); toast.success(`${r.data.linked} item${r.data.linked === 1 ? '' : 's'} linked`); setSuggest(null); setPick(false); changed(); }
    catch (err) { toast.error(errText(err, 'Could not link')); }
  };
  const unlink = async (it) => { try { await brandsAPI.unlinkItem(brandId, it.id); changed(); } catch (err) { toast.error(errText(err)); } };
  const openPicker = async () => { setPick(true); if (!allItems.length) { try { setAllItems((await inventoryAPI.getItems()).data || []); } catch { /* list stays empty */ } } };
  const removeTm = async (t) => {
    if (!window.confirm(`Delete the trademark record ${t.mark}?`)) return;
    try { await brandsAPI.removeTrademark(t.id); changed(); } catch (err) { toast.error(errText(err)); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${b.name}? Its stock items are kept but lose the brand.`)) return;
    try { await brandsAPI.remove(b.id); toast.success('Brand deleted'); onOpenChange(false); onChanged?.(); } catch (err) { toast.error(errText(err)); }
  };
  const linked = new Set((b?.items || []).map((i) => i.id));
  const filtered = allItems.filter((i) => !linked.has(i.id) && (!q || `${i.name} ${i.sku_code}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 60);
  const [kindLabel, kindTone] = KIND[b?.kind] || ['', 'slate'];
  return (
    <Sheet open={!!brandId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-testid="brand-sheet">
        {!b ? <Loading /> : (
          <div className="space-y-4">
            <SheetHeader className="space-y-1 text-left">
              <div className="flex items-center gap-3">
                <BrandLogo brand={b} size="h-14 w-14" />
                <div className="min-w-0">
                  <SheetTitle className="flex flex-wrap items-center gap-2">{b.name}<Chip tone={kindTone}>{kindLabel}</Chip>{b.active === false && <Chip>Off</Chip>}</SheetTitle>
                  <SheetDescription>{b.tagline || (b.kind === 'own' ? 'Our own brand' : b.contact?.company || '')}</SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <PillTabs value={tab} onChange={setTab} testid="brand-tab" tabs={[['overview', 'Overview'], ['trademarks', 'Trademarks', 0], ['items', `Stock items (${b.items.length})`]]} />
            {tab === 'overview' && (editing ? <BrandForm initial={{ ...blankBrand, ...b, contact: { ...blankBrand.contact, ...(b.contact || {}) }, agreement: { ...blankBrand.agreement, ...(b.agreement || {}) } }}
              onSaved={() => { setEditing(false); changed(); }} onCancel={() => setEditing(false)} /> : (
              <div className="space-y-3">
                <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                  {[['Website', b.website && <a href={b.website} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">{b.website}</a>],
                    b.kind !== 'own' && ['Agreement', [b.agreement?.start_date && fmtDate(b.agreement.start_date), b.agreement?.end_date && fmtDate(b.agreement.end_date)].filter(Boolean).join(' – ')],
                    b.kind !== 'own' && ['Territory', b.agreement?.territory], b.kind !== 'own' && ['Our margin', b.agreement?.margin_pct != null && `${b.agreement.margin_pct}%`],
                    b.kind !== 'own' && ['Yearly target', b.agreement?.target_amount && inr(b.agreement.target_amount)], b.kind !== 'own' && ['Credit days', b.agreement?.credit_days],
                    b.kind !== 'own' && ['Contact', [b.contact?.person, b.contact?.company, b.contact?.phone, b.contact?.email].filter(Boolean).join(' · ')],
                    ['Notes', b.notes]].filter((r) => r && r[1]).map(([k, v]) => (
                    <div key={k} className="flex gap-3 px-3 py-2"><dt className="w-28 shrink-0 text-slate-500">{k}</dt><dd className="min-w-0 flex-1 text-slate-900">{v}</dd></div>
                  ))}
                  {b.trademarks.length > 0 && <div className="flex gap-3 px-3 py-2"><dt className="w-28 shrink-0 text-slate-500">Trademarks</dt><dd className="flex flex-wrap gap-1">{b.trademarks.map((t) => <Chip key={t.id} tone={TM_TONE[t.status] || 'blue'}>{t.mark} · {statusLabel(t.status)}</Chip>)}</dd></div>}
                </dl>
                <div className="flex flex-wrap gap-2">
                  {canEdit && <Button variant="outline" className="gap-1.5" onClick={() => setEditing(true)} data-testid="brand-edit"><Pencil className="h-4 w-4" />Edit</Button>}
                  {isAdmin && <Button variant="ghost" className="gap-1.5 text-rose-600" onClick={remove} data-testid="brand-delete"><Trash2 className="h-4 w-4" />Delete</Button>}
                </div>
              </div>
            ))}
            {tab === 'trademarks' && (
              <div className="space-y-2" data-testid="brand-trademarks">
                {b.trademarks.length === 0 && <Empty icon={Stamp} title="No trademarks yet" text="Add the marks you have filed or plan to file — with classes, numbers and the renewal date." />}
                {b.trademarks.map((t) => (
                  <div key={t.id} className="rounded-xl border border-slate-200 p-3" data-testid={`tm-row-${t.id}`}>
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{t.mark}</p><Chip tone={TM_TONE[t.status] || 'blue'}>{statusLabel(t.status)}</Chip><RenewalChip tm={t} /></div>
                    <p className="mt-0.5 text-xs text-slate-500">Class {t.classes.join(', ') || '—'} · {t.application_number ? `Appl. ${t.application_number}` : 'not filed yet'}{t.registration_number ? ` · Reg. ${t.registration_number}` : ''}{t.filing_date ? ` · filed ${fmtDate(t.filing_date)}` : ''}{t.office ? ` · ${t.office}` : ''}</p>
                    {t.next_action && <p className="mt-1 text-xs text-amber-900"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{t.next_action}{t.next_action_date ? ` by ${fmtDate(t.next_action_date)}` : ''}</p>}
                    {(t.documents || []).length > 0 && <div className="mt-1 flex flex-wrap gap-2">{t.documents.map((d) => <a key={d} href={uploadAPI.getFileUrl(d)} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline">{d.split('/').pop()}</a>)}</div>}
                    {canEdit && <div className="mt-2 flex gap-1.5"><Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setTm(t)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                      {isAdmin && <Button size="sm" variant="ghost" className="h-8 text-xs text-rose-600" onClick={() => removeTm(t)}><Trash2 className="h-3.5 w-3.5" /></Button>}</div>}
                  </div>
                ))}
                {canEdit && <Button variant="outline" className="w-full gap-1.5 border-dashed" onClick={() => setTm({})} data-testid="tm-add"><Plus className="h-4 w-4" />Add trademark</Button>}
              </div>
            )}
            {tab === 'items' && (
              <div className="space-y-2" data-testid="brand-items">
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="gap-1.5" onClick={loadSuggest} data-testid="brand-suggest"><Search className="h-4 w-4" />Find items named “{b.name}”</Button>
                    <Button variant="outline" className="gap-1.5" onClick={openPicker} data-testid="brand-pick"><Link2 className="h-4 w-4" />Pick items</Button>
                  </div>
                )}
                {suggest && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3" data-testid="brand-suggestions">
                    {suggest.length === 0 ? <p className="text-sm text-slate-600">No unbranded items mention “{b.name}”.</p> : <>
                      <p className="mb-1 text-sm text-slate-700">{suggest.length} item{suggest.length === 1 ? '' : 's'} without a brand mention “{b.name}”:</p>
                      <ul className="mb-2 max-h-40 overflow-y-auto text-xs text-slate-700">{suggest.map((s) => <li key={s.id}>• {s.name} <span className="text-slate-400">{s.sku_code}</span></li>)}</ul>
                      <div className="flex gap-2"><Button size="sm" className="bg-emerald-600 text-white" onClick={() => link(suggest.map((s) => s.id))} data-testid="brand-link-all">Link all {suggest.length}</Button><Button size="sm" variant="ghost" onClick={() => setSuggest(null)}>Close</Button></div>
                    </>}
                  </div>
                )}
                {pick && (
                  <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center gap-2"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stock items" className="h-10" autoFocus /><Button size="icon" variant="ghost" onClick={() => setPick(false)} aria-label="Close"><X className="h-4 w-4" /></Button></div>
                    <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">{filtered.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-sm"><span className="min-w-0 truncate">{i.name} <span className="text-xs text-slate-400">{i.sku_code}</span>{i.brand_id && <span className="ml-1 text-[11px] text-amber-700">(another brand)</span>}</span>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => link([i.id])}>Link</Button></li>))}</ul>
                  </div>
                )}
                {b.items.length === 0 ? <Empty icon={Package} title="No stock items linked" text="Link the products of this brand so stock, purchases and sales add up by brand." /> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {b.items.map((i) => (
                      <li key={i.id} className="flex items-center gap-2 px-3 py-2 text-sm" data-testid={`brand-item-${i.id}`}>
                        <span className="min-w-0 flex-1"><span className="block truncate text-slate-900">{i.name}</span><span className="text-[11px] text-slate-500">{i.sku_code} · {i.quantity} in stock · {inr(i.unit_price)}</span></span>
                        {canEdit && <button type="button" onClick={() => unlink(i)} className="text-xs text-slate-400 hover:text-rose-600" aria-label={`Unlink ${i.name}`}>Unlink</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        <TrademarkDialog open={!!tm} onOpenChange={(v) => !v && setTm(null)} brandId={brandId} initial={tm?.id ? tm : null} onSaved={changed} />
      </SheetContent>
    </Sheet>
  );
}

// ───────────────────────── report tab ─────────────────────────
function periodRange(p) {
  const t = todayISO();
  const d = new Date(`${t}T00:00:00`);
  if (p === 'month') return [t.slice(0, 8) + '01', t];
  if (p === 'fy') { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return [`${y}-04-01`, t]; }
  if (p === 'quarter') return [addDaysISO(t, -90), t];
  return [addDaysISO(t, -364), t];
}

function BrandReport({ onOpen }) {
  const [period, setPeriod] = useState('12m');
  const [rep, setRep] = useState(null);
  const [focus, setFocus] = useState('');
  useEffect(() => {
    const [start, end] = periodRange(period);
    setRep(null);
    brandsAPI.report({ start, end }).then((r) => setRep(r.data)).catch((e) => { toast.error(errText(e, 'Could not load the report')); setRep(false); });
  }, [period]);
  const rows = rep?.rows || [];
  const ranked = rows.filter((r) => r.sales > 0).slice(0, 10);
  const bars = ranked.map((r) => ({ name: r.name, Counter: Math.round(r.counter_sales), Online: Math.round(r.online_sales), Projects: Math.round(r.project_sales), id: r.brand_id }));
  const branded = rows.filter((r) => r.brand_id);
  const focusRow = branded.find((r) => r.brand_id === focus) || branded.find((r) => r.sales > 0) || branded[0];
  const trend = (rep?.months || []).map((m, i) => ({ month: new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }),
    Counter: Math.round(focusRow?.monthly[i]?.counter || 0), Online: Math.round(focusRow?.monthly[i]?.online || 0), Projects: Math.round(focusRow?.monthly[i]?.projects || 0) }));
  const excel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => ({ Brand: r.name, Kind: KIND[r.kind]?.[0] || '—', 'Sales ₹': r.sales, 'Share %': r.share_pct, 'Counter ₹': r.counter_sales,
      'Online ₹': r.online_sales, 'Projects ₹': r.project_sales, Projects: r.projects, 'Project kW': r.project_kw, 'Target ₹': r.target_amount || '', 'Target %': r.target_pct ?? '',
      'Purchased qty': r.purchased_qty, 'Purchased ₹': r.purchased_value, 'Stock qty': r.stock_qty, 'Stock value ₹': r.stock_value, 'Margin ₹ (counter)': r.margin, Returns: r.returns }))), 'Brands');
    saveAs(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }), `Brand_report_${rep.period.start}_${rep.period.end}.xlsx`);
  };
  return (
    <div className="space-y-4" data-testid="brand-report">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-56"><Select value={period} onValueChange={setPeriod}><SelectTrigger className="h-10 bg-white" data-testid="brand-report-period" aria-label="Period"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="month">This month</SelectItem><SelectItem value="quarter">Last 90 days</SelectItem><SelectItem value="fy">This financial year</SelectItem><SelectItem value="12m">Last 12 months</SelectItem></SelectContent></Select></div>
        {rep && <Can module="module_brands" action="export"><Button variant="outline" className="h-10 gap-1.5" onClick={excel} data-testid="brand-report-excel"><FileSpreadsheet className="h-4 w-4" />Excel</Button></Can>}
      </div>
      {rep === null && <Loading />}
      {rep && <>
        <Tiles>
          <Tile label="Sales by brand" value={inrShort(rep.totals.sales)} sub={`${fmtDate(rep.period.start)} – ${fmtDate(rep.period.end)}`} tone="good" testid="brand-kpi-sales" />
          <Tile label="Stock value" value={inrShort(rep.totals.stock_value)} sub="branded items, at cost" />
          <Tile label="Bought" value={inrShort(rep.totals.purchased_value)} sub="purchase orders in the period" />
          <Tile label="No brand set" value={inrShort(rep.totals.unbranded_sales)} sub="sales of items without a brand" tone={rep.totals.unbranded_sales > 0 ? 'warn' : undefined} testid="brand-kpi-unbranded" />
        </Tiles>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title="Sales by brand" sub="Counter, online and project sales — top 10" testid="brand-chart-sales">
            {bars.length ? (
              <ResponsiveContainer width="100%" height={Math.max(180, bars.length * 34 + 50)}>
                <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(v) => inrShort(v).replace('₹', '')} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => inr(v)} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Counter" stackId="s" fill={SERIES.counter} stroke="#fff" strokeWidth={2} onClick={(d) => d?.id && onOpen(d.id)} />
                  <Bar dataKey="Online" stackId="s" fill={SERIES.online} stroke="#fff" strokeWidth={2} onClick={(d) => d?.id && onOpen(d.id)} />
                  <Bar dataKey="Projects" stackId="s" fill={SERIES.projects} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} onClick={(d) => d?.id && onOpen(d.id)} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="py-10 text-center text-xs text-slate-400">No sales of branded items in this period</p>}
          </Card>
          <Card title="Month by month" sub={focusRow ? `${focusRow.name} — sales by channel` : 'Sales by channel'} testid="brand-chart-trend"
            action={branded.length > 1 && <div className="w-40"><Select value={focusRow?.brand_id || ''} onValueChange={setFocus}><SelectTrigger className="h-9" aria-label="Brand" data-testid="brand-trend-pick"><SelectValue /></SelectTrigger>
              <SelectContent>{branded.map((r) => <SelectItem key={r.brand_id} value={r.brand_id}>{r.name}</SelectItem>)}</SelectContent></Select></div>}>
            {focusRow && focusRow.sales > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trend} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v) => inrShort(v).replace('₹', '')} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v) => inr(v)} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Counter" stackId="m" fill={SERIES.counter} stroke="#fff" strokeWidth={2} />
                  <Bar dataKey="Online" stackId="m" fill={SERIES.online} stroke="#fff" strokeWidth={2} />
                  <Bar dataKey="Projects" stackId="m" fill={SERIES.projects} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="py-10 text-center text-xs text-slate-400">No sales for this brand in the period</p>}
          </Card>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" data-testid="brand-report-table">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Brand', 'Sales', 'Share', 'vs target', 'Projects', 'Bought', 'In stock', 'Margin', 'Returns'].map((h, i) => <th key={h} className={`p-2 font-medium ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.brand_id || 'none'} className={r.brand_id ? 'cursor-pointer hover:bg-slate-50' : 'text-slate-500'} onClick={() => r.brand_id && onOpen(r.brand_id)}>
                  <td className="p-2"><span className="font-medium text-slate-900">{r.name}</span> {r.kind && <Chip tone={KIND[r.kind][1]}>{KIND[r.kind][0]}</Chip>}</td>
                  <td className="p-2 text-right tabular-nums">{inr(r.sales)}</td>
                  <td className="p-2 text-right tabular-nums">{r.share_pct}%</td>
                  <td className="p-2 text-right tabular-nums">{r.target_pct != null ? `${r.target_pct}%` : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{r.projects || '—'}{r.project_kw ? ` · ${r.project_kw} kW` : ''}</td>
                  <td className="p-2 text-right tabular-nums">{r.purchased_value ? inr(r.purchased_value) : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{r.stock_value ? inr(r.stock_value) : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{r.margin ? inr(r.margin) : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{r.returns || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}

// ───────────────────────── page ─────────────────────────
export default function BrandsPage() {
  const { isAdmin, isManager, can } = useAuth();
  const canEdit = isAdmin || isManager || can('module_brands', 'edit');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'brands';
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const openId = params.get('brand');
  const setOpen = (id) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('brand', id); else n.delete('brand'); return n; }, { replace: true });
  const [rows, setRows] = useState(null);
  const [kind, setKind] = useState('all');
  const [marks, setMarks] = useState(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    brandsAPI.list({ include_inactive: true }).then((r) => setRows(r.data)).catch(() => setRows([]));
    brandsAPI.trademarks().then((r) => setMarks(r.data)).catch(() => setMarks([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(['brands', 'inventory'], load);
  const shown = useMemo(() => (rows || []).filter((b) => kind === 'all' || b.kind === kind), [rows, kind]);
  const dueSoon = (marks || []).filter((t) => t.days_to_renewal != null && t.days_to_renewal <= 180).length;
  if (!rows) return <Loading />;
  return (
    <div className="px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader icon={BadgeCheck} title="Brands" sub="Our brands and trademarks, and the brands we deal or distribute" testid="brands-page">
          {canEdit && <Button onClick={() => setCreating(true)} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="brand-new"><Plus className="h-4 w-4" />New brand</Button>}
        </PageHeader>
        <PillTabs value={tab} onChange={setTab} testid="brands-tab" tabs={[['brands', 'Brands'], ['trademarks', 'Trademarks', dueSoon], ['report', 'Report']]} />
        {tab === 'brands' && (
          <div className="space-y-3">
            <div className="w-56"><Select value={kind} onValueChange={setKind}><SelectTrigger className="h-10 bg-white" data-testid="brand-kind-filter" aria-label="Kind"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All brands</SelectItem><SelectItem value="own">Our brands</SelectItem><SelectItem value="dealership">Dealerships</SelectItem><SelectItem value="distribution">Distribution</SelectItem></SelectContent></Select></div>
            {shown.length === 0 ? <Empty icon={Building2} title="No brands yet" text="Add your own brands (with their trademarks) and the brands you sell as a dealer or distributor." /> : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((b) => {
                  const [kl, kt] = KIND[b.kind] || ['', 'slate'];
                  const end = b.agreement?.end_date;
                  const daysToEnd = end ? Math.round((new Date(`${end}T00:00:00`) - new Date(`${todayISO()}T00:00:00`)) / 864e5) : null;
                  return (
                    <button key={b.id} type="button" onClick={() => setOpen(b.id)} className={`rounded-xl border bg-white p-3 text-left transition hover:border-emerald-300 ${b.active === false ? 'opacity-60' : 'border-slate-200'}`} data-testid={`brand-card-${b.id}`}>
                      <div className="flex items-center gap-3"><BrandLogo brand={b} /><div className="min-w-0"><p className="truncate font-medium text-slate-900">{b.name}</p><Chip tone={kt}>{kl}</Chip></div></div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div><p className="font-['Outfit'] text-lg font-bold tabular-nums">{b.items}</p><p className="text-[10px] text-slate-500">items</p></div>
                        <div><p className="font-['Outfit'] text-lg font-bold tabular-nums">{inrShort(b.stock_value)}</p><p className="text-[10px] text-slate-500">in stock</p></div>
                        <div><p className="font-['Outfit'] text-lg font-bold tabular-nums">{b.registered}/{b.trademarks}</p><p className="text-[10px] text-slate-500">marks registered</p></div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {b.next_renewal && <Chip tone="amber">Renew by {fmtDate(b.next_renewal)}</Chip>}
                        {daysToEnd != null && <Chip tone={daysToEnd < 0 ? 'red' : daysToEnd <= 60 ? 'amber' : 'slate'}>{daysToEnd < 0 ? 'Agreement ended' : `Agreement ends ${fmtDate(end)}`}</Chip>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {tab === 'trademarks' && (
          !marks?.length ? <Empty icon={Stamp} title="No trademarks yet" text="Open one of your brands → Trademarks to add its marks." /> : (<>
            <ul className="space-y-2 sm:hidden" data-testid="trademarks-cards">{marks.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpen(t.brand_id)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium text-slate-900">{t.mark}</span><Chip tone={TM_TONE[t.status] || 'blue'}>{statusLabel(t.status)}</Chip></div>
                  <p className="mt-0.5 text-xs text-slate-500">{t.brand_name} · class {t.classes.join(', ') || '—'}{t.application_number ? ` · no. ${t.application_number}` : ''}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs"><RenewalChip tm={t} />{t.next_action && <span className="text-slate-700">{t.next_action}{t.next_action_date ? ` · ${fmtDate(t.next_action_date)}` : ''}</span>}</div>
                </button>
              </li>))}</ul>
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block" data-testid="trademarks-table">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Mark', 'Brand', 'Class', 'Status', 'Application', 'Renewal', 'Next action'].map((h) => <th key={h} className="p-2 text-left font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">{marks.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(t.brand_id)}>
                    <td className="p-2 font-medium text-slate-900">{t.mark}</td><td className="p-2">{t.brand_name}</td><td className="p-2">{t.classes.join(', ')}</td>
                    <td className="p-2"><Chip tone={TM_TONE[t.status] || 'blue'}>{statusLabel(t.status)}</Chip></td><td className="p-2 text-xs">{t.application_number || '—'}</td>
                    <td className="p-2"><RenewalChip tm={t} /></td><td className="p-2 text-xs">{t.next_action ? `${t.next_action}${t.next_action_date ? ` · ${fmtDate(t.next_action_date)}` : ''}` : '—'}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </>)
        )}
        {tab === 'report' && <BrandReport onOpen={setOpen} />}
      </div>
      <BrandSheet brandId={openId} onOpenChange={(v) => !v && setOpen(null)} onChanged={load} canEdit={canEdit} isAdmin={isAdmin} />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="brand-create-dialog">
          <DialogHeader><DialogTitle>New brand</DialogTitle><DialogDescription>Our own brand, or one we hold a dealership or distribution for.</DialogDescription></DialogHeader>
          {creating && <BrandForm initial={blankBrand} onSaved={(b) => { setCreating(false); load(); setOpen(b.id); }} onCancel={() => setCreating(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
