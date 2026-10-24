/* Vendors: supplier directory with tags, preferred / blocked flags, ratings and a scorecard (spend, on-time
 * delivery, QC, quotes won, prices against the cheapest source). Filters are dropdowns only. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Ban, Edit, Loader2, Mail, Phone, Plus, Receipt, Save, Search, Star, Store, ThumbsUp, Trash2, X } from 'lucide-react';
import { geoAPI, vendorsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import Can from '../components/Can';
import { useLiveRefresh } from '../lib/liveSync';
import { Chip, Empty, Field, Loading, PageHeader, PillTabs, StarInput, Stars, Tile, errText, fmtDate, inr, inrShort } from '../components/kit/PageBits';

const CATEGORIES = ['panels', 'inverters', 'batteries', 'structure', 'cables', 'transport', 'services', 'other'];
const SOUTH = ['Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana', 'Puducherry'];
const blankForm = { name: '', contact_person: '', phone: '', email: '', gstin: '', address: '', state: 'Tamil Nadu', district: '', payment_terms: '', category: 'other', notes: '',
  tags: [], preferred: false, blocked: false, blocked_reason: '', credit_days: '', lead_time_days: '', min_order_value: '' };
const ALL = 'all';

function Dropdown({ value, onChange, options, label, testid, className = '' }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-10 bg-white ${className}`} aria-label={label} data-testid={testid}><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function TagInput({ value, onChange, suggestions }) {
  const [text, setText] = useState('');
  const add = (t) => {
    const v = t.trim().replace(/\s+/g, ' ');
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase()) && value.length < 12) onChange([...value, v]);
    setText('');
  };
  const rest = suggestions.filter((s) => !value.some((x) => x.toLowerCase() === s.tag.toLowerCase())).slice(0, 8);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white p-1.5">
        {value.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-800 ring-1 ring-sky-200">{t}<button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button></span>)}
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } }} onBlur={() => text && add(text)}
          placeholder={value.length ? 'Add another' : 'e.g. Tier 1, Local, Credit 30'} className="h-8 min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none" data-testid="vendor-tag-input" />
      </div>
      {rest.length > 0 && <div className="flex flex-wrap gap-1">{rest.map((s) => <button key={s.tag} type="button" onClick={() => add(s.tag)} className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:border-sky-300 hover:text-sky-700">+ {s.tag}</button>)}</div>}
    </div>
  );
}

function RateDialog({ vendor, po, onOpenChange, onSaved }) {
  const [r, setR] = useState({ quality: 0, delivery: 0, price: 0, service: 0, comment: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { setR({ quality: 0, delivery: 0, price: 0, service: 0, comment: '' }); }, [vendor, po]);
  const ready = r.quality && r.delivery && r.price && r.service;
  const save = async () => {
    setSaving(true);
    try { await vendorsAPI.rate(vendor.id, { ...r, po_id: po?.id || null }); toast.success('Thanks — rating saved'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  return (
    <Dialog open={!!vendor} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="vendor-rate-dialog">
        <DialogHeader><DialogTitle>Rate {vendor?.name}</DialogTitle><DialogDescription>{po ? `Order ${po.po_number || ''} · ${fmtDate(po.date)}` : 'How did they do on recent orders?'}</DialogDescription></DialogHeader>
        <div className="space-y-1">
          <StarInput label="Quality of material" value={r.quality} onChange={(v) => setR({ ...r, quality: v })} testid="rate-quality" />
          <StarInput label="On-time delivery" value={r.delivery} onChange={(v) => setR({ ...r, delivery: v })} testid="rate-delivery" />
          <StarInput label="Price" value={r.price} onChange={(v) => setR({ ...r, price: v })} testid="rate-price" />
          <StarInput label="Service & support" value={r.service} onChange={(v) => setR({ ...r, service: v })} testid="rate-service" />
          <textarea rows={2} value={r.comment} onChange={(e) => setR({ ...r, comment: e.target.value })} placeholder="Anything to remember (optional)" className="mt-2 w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" />
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={!ready || saving} className="bg-emerald-600 text-white" data-testid="rate-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save rating'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VendorSheet({ vendorId, onOpenChange, canEdit, isAdmin, onChanged }) {
  const [sc, setSc] = useState(null);
  const [pos, setPos] = useState(null);
  const [tab, setTab] = useState('score');
  const [rate, setRate] = useState(null);
  const load = useCallback(() => {
    if (!vendorId) return;
    vendorsAPI.scorecard(vendorId).then((r) => setSc(r.data)).catch(() => toast.error('Could not load the scorecard'));
    vendorsAPI.purchaseOrders(vendorId).then((r) => setPos(r.data)).catch(() => setPos({ purchase_orders: [] }));
  }, [vendorId]);
  useEffect(() => { setSc(null); setPos(null); setTab('score'); load(); }, [load]);
  const removeRating = async (id) => { if (!window.confirm('Remove this rating?')) return; try { await vendorsAPI.removeRating(vendorId, id); load(); onChanged(); } catch (e) { toast.error(errText(e)); } };
  const v = sc?.vendor;
  return (
    <Sheet open={!!vendorId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-testid="vendor-sheet">
        {!sc ? <Loading /> : (
          <div className="space-y-4">
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="flex flex-wrap items-center gap-2">{v.name}{v.preferred && <Chip tone="green">Preferred</Chip>}{v.blocked && <Chip tone="red">Blocked</Chip>}</SheetTitle>
              <SheetDescription>{[v.category, v.district, v.payment_terms, v.credit_days != null && `${v.credit_days} days credit`].filter(Boolean).join(' · ')}</SheetDescription>
              {v.blocked && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800"><Ban className="mr-1 inline h-4 w-4" />{v.blocked_reason}</p>}
              <div className="pt-1"><Stars value={sc.rating.overall} count={sc.rating.count} size="lg" /></div>
            </SheetHeader>
            <PillTabs value={tab} onChange={setTab} testid="vendor-tab" tabs={[['score', 'Scorecard'], ['ratings', `Ratings (${sc.rating.count})`], ['orders', 'Orders'], ['prices', 'Prices']]} />
            {tab === 'score' && (
              <div className="grid grid-cols-2 gap-2" data-testid="vendor-scorecard">
                <Tile label="Spend · 12 months" value={inrShort(sc.spend_12m)} sub={`${inrShort(sc.spend)} all time`} />
                <Tile label="Orders" value={sc.orders} sub={`${sc.orders_12m} in 12 months`} />
                <Tile label="On time" value={sc.on_time_pct != null ? `${sc.on_time_pct}%` : '—'} sub={sc.avg_delay_days != null ? `late by ${sc.avg_delay_days} days on average` : 'no arrival dates yet'} tone={sc.on_time_pct != null && sc.on_time_pct < 70 ? 'warn' : undefined} />
                <Tile label="QC passed" value={sc.qc_pass_pct != null ? `${sc.qc_pass_pct}%` : '—'} sub="of checked deliveries" tone={sc.qc_pass_pct != null && sc.qc_pass_pct < 90 ? 'warn' : undefined} />
                <Tile label="Quotes won" value={sc.quote_win_pct != null ? `${sc.quote_win_pct}%` : '—'} sub={`${sc.quotes_won} of ${sc.quotes_asked} purchase requests`} />
                <Tile label="Lead time" value={v.lead_time_days != null ? `${v.lead_time_days} days` : '—'} sub={v.min_order_value ? `minimum order ${inr(v.min_order_value)}` : 'usual delivery time'} />
                {sc.rating.count > 0 && <div className="col-span-2 rounded-xl border border-slate-200 p-3 text-sm">{[['Quality', 'quality'], ['Delivery', 'delivery'], ['Price', 'price'], ['Service', 'service']].map(([l, k]) => <div key={k} className="flex items-center justify-between py-0.5"><span className="text-slate-600">{l}</span><Stars value={sc.rating[k]} /></div>)}</div>}
              </div>
            )}
            {tab === 'ratings' && (
              <div className="space-y-2">
                {canEdit && <Button variant="outline" className="w-full gap-1.5" onClick={() => setRate({ vendor: v })} data-testid="vendor-rate"><Star className="h-4 w-4" />Rate this vendor</Button>}
                {sc.ratings.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No ratings yet</p> : sc.ratings.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2"><Stars value={(r.quality + r.delivery + r.price + r.service) / 4} /><span className="text-[11px] text-slate-500">{r.by} · {fmtDate(r.at)}</span></div>
                    <p className="mt-1 text-xs text-slate-500">Quality {r.quality} · Delivery {r.delivery} · Price {r.price} · Service {r.service}</p>
                    {r.comment && <p className="mt-1 text-slate-700">“{r.comment}”</p>}
                    {isAdmin && <button type="button" onClick={() => removeRating(r.id)} className="mt-1 text-[11px] text-slate-400 hover:text-rose-600">Remove</button>}
                  </div>
                ))}
              </div>
            )}
            {tab === 'orders' && (
              !pos ? <Loading /> : !pos.purchase_orders.length ? <p className="py-6 text-center text-sm text-slate-500">No purchase orders yet</p> : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="vendor-orders">
                  {pos.purchase_orders.map((po) => (
                    <li key={po.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1"><span className="block font-medium text-slate-900">{po.po_number || 'PO'} · {inr(po.total)}</span>
                        <span className="text-[11px] text-slate-500">{fmtDate(po.date)} · {po.items_count} items · {po.status}{po.late_days != null ? ` · ${po.late_days > 0 ? `${po.late_days} days late` : 'on time'}` : ''}{po.qc ? ` · QC ${po.qc}` : ''}</span></span>
                      {canEdit && !po.rated && ['completed', 'qc_done', 'arrived'].includes(po.status) && <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setRate({ vendor: v, po })}><Star className="h-3.5 w-3.5" />Rate</Button>}
                      {po.rated && <Chip tone="green">Rated</Chip>}
                    </li>
                  ))}
                </ul>
              )
            )}
            {tab === 'prices' && (
              !sc.prices.length ? <p className="py-6 text-center text-sm text-slate-500">No prices yet — they come from purchase orders.</p> : (
                <div className="overflow-x-auto rounded-xl border border-slate-200" data-testid="vendor-prices">
                  <table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left font-medium">Item</th><th className="p-2 text-right font-medium">Their last price</th><th className="p-2 text-right font-medium">Best anyone</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{sc.prices.map((p, i) => (
                      <tr key={i}><td className="p-2">{p.item}<span className="block text-[11px] text-slate-400">{fmtDate(p.date)}</span></td><td className="p-2 text-right tabular-nums">{inr(p.last_price)}</td>
                        <td className="p-2 text-right tabular-nums">{inr(p.best_price)}{p.above_best_pct > 0 && <span className="block text-[11px] font-medium text-amber-700">{p.above_best_pct}% dearer</span>}</td></tr>))}</tbody></table>
                </div>
              )
            )}
          </div>
        )}
        <RateDialog vendor={rate?.vendor} po={rate?.po} onOpenChange={(o) => !o && setRate(null)} onSaved={() => { load(); onChanged(); }} />
      </SheetContent>
    </Sheet>
  );
}

export default function VendorsPage() {
  const { isAdmin, isManager, can } = useAuth();
  const canEdit = isAdmin || isManager || can('module_vendors', 'edit');
  const [vendors, setVendors] = useState(null);
  const [f, setF] = useState({ search: '', category: ALL, status: 'active', state: ALL, district: ALL, tag: ALL, rating: ALL, flag: ALL, sort: 'name' });
  const [states, setStates] = useState([]);
  const [districtMap, setDistrictMap] = useState({});
  const [tags, setTags] = useState([]);
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [more, setMore] = useState(false);

  const fetchAll = useCallback(async () => {
    const p = {};
    if (f.search) p.search = f.search;
    ['category', 'state', 'district', 'tag', 'flag'].forEach((k) => { if (f[k] !== ALL) p[k] = f[k]; });
    if (f.status !== ALL) p.status = f.status; else p.status = 'all';
    if (f.rating !== ALL) p.min_rating = f.rating;
    if (f.sort !== 'name') p.sort = f.sort;
    try { setVendors((await vendorsAPI.list(p)).data); } catch { setVendors([]); }
  }, [f]);
  useEffect(() => { const t = setTimeout(fetchAll, 250); return () => clearTimeout(t); }, [fetchAll]);
  const loadTags = useCallback(() => vendorsAPI.tags().then((r) => setTags(r.data || [])).catch(() => {}), []);
  useEffect(() => {
    geoAPI.states().then((r) => setStates(r.data || [])).catch(() => {});
    geoAPI.districts().then((r) => setDistrictMap(r.data || {})).catch(() => {});
    loadTags();
  }, [loadTags]);
  useLiveRefresh(['vendors', 'purchases'], () => { fetchAll(); loadTags(); });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v, ...(k === 'state' ? { district: ALL } : {}) }));
  const stateOptions = useMemo(() => [[ALL, 'All states'], ...[...new Set([...SOUTH, ...states])].map((s) => [s, s])], [states]);
  const districts = f.state !== ALL ? (districtMap[f.state] || []) : [];
  const anyFilter = f.search || ['category', 'state', 'tag', 'rating', 'flag'].some((k) => f[k] !== ALL) || f.status !== 'active';
  const moreCount = ['state', 'rating', 'flag'].filter((k) => f[k] !== ALL).length + (f.status !== 'active' ? 1 : 0);
  const extra = more ? '' : 'hidden lg:block';

  const openCreate = () => { setEditingId(null); setForm(blankForm); setOpenForm(true); };
  const openEdit = (v) => {
    setEditingId(v.id);
    setForm({ ...blankForm, ...Object.fromEntries(Object.keys(blankForm).map((k) => [k, v[k] ?? blankForm[k]])), tags: v.tags || [] });
    setOpenForm(true);
  };
  const handleSave = async () => {
    setSaving(true);
    const num = (x) => (x === '' || x == null ? null : Number(x));
    const body = { ...form, credit_days: num(form.credit_days), lead_time_days: num(form.lead_time_days), min_order_value: num(form.min_order_value) };
    try {
      if (editingId) await vendorsAPI.update(editingId, body); else await vendorsAPI.create(body);
      toast.success(editingId ? 'Vendor saved' : 'Vendor added'); setOpenForm(false); fetchAll(); loadTags();
    } catch (e) { toast.error(errText(e, 'Save failed')); } finally { setSaving(false); }
  };
  const handleDelete = async (v) => {
    if (!window.confirm(`Archive ${v.name}?`)) return;
    try { await vendorsAPI.remove(v.id); fetchAll(); } catch (e) { toast.error(errText(e, 'Could not archive')); }
  };

  return (
    <div className="px-4 py-5 sm:py-6" data-testid="vendors-page">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader icon={Store} title="Vendors" sub="Suppliers with tags, ratings and a scorecard — so every purchase goes to the right one">
          <Can module="module_vendors" action="create"><Button onClick={openCreate} className="h-10 gap-2 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="new-vendor-btn"><Plus className="h-4 w-4" />New vendor</Button></Can>
        </PageHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5" data-testid="vendor-filters">
          <div className="relative col-span-2 sm:col-span-4 lg:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={f.search} onChange={(e) => setF((x) => ({ ...x, search: e.target.value }))} placeholder="Name, GSTIN, contact or tag" className="h-10 bg-white pl-9" data-testid="vendor-search-input" />
          </div>
          <Dropdown label="Category" value={f.category} onChange={set('category')} testid="vendor-category-filter" options={[[ALL, 'All categories'], ...CATEGORIES.map((c) => [c, c[0].toUpperCase() + c.slice(1)])]} />
          <Dropdown label="Tag" value={f.tag} onChange={set('tag')} testid="vendor-tag-filter" options={[[ALL, 'All tags'], ...tags.map((t) => [t.tag, `${t.tag} (${t.count})`])]} />
          <Dropdown label="Sort" value={f.sort} onChange={set('sort')} testid="vendor-sort" options={[['name', 'Sort: name'], ['rating_desc', 'Sort: rating'], ['business_desc', 'Sort: spend'], ['recent_desc', 'Sort: latest order'], ['recent_asc', 'Sort: oldest order'], ['location_asc', 'Sort: place']]} />
          <Button variant="outline" className="h-10 bg-white text-sm lg:hidden" onClick={() => setMore((m) => !m)} aria-expanded={more} data-testid="vendor-more-filters">{more ? 'Fewer filters' : `More filters${moreCount ? ` (${moreCount})` : ''}`}</Button>
          <div className={extra}><Dropdown label="State" value={f.state} onChange={set('state')} testid="vendor-state-filter" options={stateOptions} /></div>
          <div className={extra}><Dropdown label="District" value={f.district} onChange={set('district')} testid="vendor-district-filter" options={[[ALL, f.state === ALL ? 'Pick a state first' : 'All districts'], ...districts.map((d) => [d, d])]} /></div>
          <div className={extra}><Dropdown label="Rating" value={f.rating} onChange={set('rating')} testid="vendor-rating-filter" options={[[ALL, 'Any rating'], ['4', '4★ and up'], ['3', '3★ and up']]} /></div>
          <div className={extra}><Dropdown label="Preferred or blocked" value={f.flag} onChange={set('flag')} testid="vendor-flag-filter" options={[[ALL, 'Preferred & others'], ['preferred', 'Preferred only'], ['not_blocked', 'Hide blocked'], ['blocked', 'Blocked only']]} /></div>
          <div className={extra}><Dropdown label="Status" value={f.status} onChange={set('status')} testid="vendor-status-filter" options={[['active', 'Active'], ['inactive', 'Archived'], [ALL, 'Active & archived']]} /></div>
          {anyFilter && <Button variant="ghost" className="h-10 text-xs text-slate-500" onClick={() => setF({ search: '', category: ALL, status: 'active', state: ALL, district: ALL, tag: ALL, rating: ALL, flag: ALL, sort: f.sort })} data-testid="vendor-clear-filters">Clear filters</Button>}
        </div>

        {!vendors ? <Loading /> : vendors.length === 0 ? <Empty icon={Store} title="No vendors found" text={anyFilter ? 'Try fewer filters.' : 'Add your first supplier.'} /> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="vendors-grid">
            {vendors.map((v) => (
              <div key={v.id} className={`flex flex-col rounded-xl border bg-white p-3 ${v.blocked ? 'border-rose-200' : v.preferred ? 'border-emerald-200' : 'border-slate-200'} ${v.active === false ? 'opacity-60' : ''}`} data-testid={`vendor-card-${v.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setOpenId(v.id)} className="min-w-0 text-left" data-testid={`vendor-open-${v.id}`}>
                    <p className="truncate font-semibold text-slate-900 hover:text-emerald-800">{v.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {v.category && <Chip>{v.category}</Chip>}
                      {v.preferred && <Chip tone="green"><ThumbsUp className="h-3 w-3" />Preferred</Chip>}
                      {v.blocked && <Chip tone="red"><Ban className="h-3 w-3" />Blocked</Chip>}
                    </div>
                  </button>
                  {canEdit && <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(v)} aria-label={`Edit ${v.name}`} data-testid={`edit-vendor-${v.id}`}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => handleDelete(v)} aria-label={`Archive ${v.name}`} data-testid={`delete-vendor-${v.id}`}><Trash2 className="h-4 w-4" /></Button>
                  </div>}
                </div>
                <div className="mt-1"><Stars value={v.rating} count={v.ratings_count || null} /></div>
                {v.tags?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{v.tags.map((t) => <button key={t} type="button" onClick={() => setF((x) => ({ ...x, tag: t }))} className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100">{t}</button>)}</div>}
                <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                  {v.contact_person && <p>{v.contact_person}</p>}
                  {v.phone && <a href={`tel:${v.phone}`} className="flex items-center gap-1 hover:text-emerald-700"><Phone className="h-3 w-3" />{v.phone}</a>}
                  {v.email && <p className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{v.email}</p>}
                  {v.gstin && <p className="flex items-center gap-1"><Receipt className="h-3 w-3" />{v.gstin}</p>}
                  {(v.district || v.state) && <p data-testid={`vendor-location-${v.id}`}>{[v.district, v.state].filter(Boolean).join(', ')}{v.credit_days != null ? ` · ${v.credit_days} days credit` : ''}</p>}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
                  <span className="font-medium text-emerald-700">{inr(v.business_value)}<span className="font-normal text-slate-400"> · {v.orders} order{v.orders === 1 ? '' : 's'}</span></span>
                  <span className="text-slate-500">{v.on_time_pct != null ? `${v.on_time_pct}% on time` : v.last_order_date ? `Last ${fmtDate(v.last_order_date)}` : 'No orders'}</span>
                </div>
                <Button variant="outline" size="sm" className="mt-2 h-9 w-full text-xs" onClick={() => setOpenId(v.id)} data-testid={`vendor-po-history-${v.id}`}>Scorecard, ratings & orders</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <VendorSheet vendorId={openId} onOpenChange={(o) => !o && setOpenId(null)} canEdit={canEdit} isAdmin={isAdmin} onChanged={fetchAll} />

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="vendor-form">
          <DialogHeader><DialogTitle>{editingId ? 'Edit vendor' : 'New vendor'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name *" className="col-span-2"><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="h-11" data-testid="vendor-name-input" /></Field>
            <Field label="Category"><Dropdown label="Category" value={form.category || 'other'} onChange={(v) => setForm((p) => ({ ...p, category: v }))} testid="vendor-category-select" className="h-11" options={CATEGORIES.map((c) => [c, c[0].toUpperCase() + c.slice(1)])} /></Field>
            <Field label="Contact person"><Input value={form.contact_person} onChange={(e) => setForm((p) => ({ ...p, contact_person: e.target.value }))} className="h-11" /></Field>
            <Field label="Phone"><Input type="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="h-11" data-testid="vendor-phone-input" /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} className="h-11" /></Field>
            <Field label="GSTIN" className="col-span-2"><Input value={form.gstin} onChange={(e) => setForm((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))} className="h-11" data-testid="vendor-gstin-input" /></Field>
            <Field label="Address" className="col-span-2"><Input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} className="h-11" /></Field>
            <Field label="State"><Dropdown label="State" value={form.state || 'Tamil Nadu'} onChange={(v) => setForm((p) => ({ ...p, state: v, district: '' }))} testid="vendor-state-select" className="h-11" options={(states.length ? states : SOUTH).map((s) => [s, s])} /></Field>
            <Field label="District"><Dropdown label="District" value={form.district || 'none'} onChange={(v) => setForm((p) => ({ ...p, district: v === 'none' ? '' : v }))} testid="vendor-district-select" className="h-11" options={[['none', 'Choose'], ...(districtMap[form.state] || []).map((d) => [d, d])]} /></Field>
            <Field label="Tags" className="col-span-2" hint="Press Enter after each tag"><TagInput value={form.tags} onChange={(tg) => setForm((p) => ({ ...p, tags: tg }))} suggestions={tags} /></Field>
            <Field label="Payment terms"><Input value={form.payment_terms} onChange={(e) => setForm((p) => ({ ...p, payment_terms: e.target.value }))} placeholder="Advance, PDC 30…" className="h-11" data-testid="vendor-payment-terms-input" /></Field>
            <Field label="Credit days"><Input type="number" inputMode="numeric" value={form.credit_days ?? ''} onChange={(e) => setForm((p) => ({ ...p, credit_days: e.target.value }))} className="h-11" data-testid="vendor-credit-days" /></Field>
            <Field label="Usual delivery (days)"><Input type="number" inputMode="numeric" value={form.lead_time_days ?? ''} onChange={(e) => setForm((p) => ({ ...p, lead_time_days: e.target.value }))} className="h-11" /></Field>
            <Field label="Minimum order (₹)"><Input type="number" inputMode="decimal" value={form.min_order_value ?? ''} onChange={(e) => setForm((p) => ({ ...p, min_order_value: e.target.value }))} className="h-11" /></Field>
            <label className="col-span-2 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span>Preferred vendor<span className="block text-[11px] text-slate-500">Shown first and suggested first for quotes</span></span>
              <Switch checked={!!form.preferred} disabled={form.blocked} onCheckedChange={(v) => setForm((p) => ({ ...p, preferred: v }))} data-testid="vendor-preferred" /></label>
            <label className="col-span-2 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span>Blocked<span className="block text-[11px] text-slate-500">Can't be asked for quotes or chosen</span></span>
              <Switch checked={!!form.blocked} onCheckedChange={(v) => setForm((p) => ({ ...p, blocked: v, preferred: v ? false : p.preferred }))} data-testid="vendor-blocked" /></label>
            {form.blocked && <Field label="Why blocked? *" className="col-span-2"><Input value={form.blocked_reason || ''} onChange={(e) => setForm((p) => ({ ...p, blocked_reason: e.target.value }))} className="h-11" data-testid="vendor-blocked-reason" /></Field>}
            <Field label="Notes" className="col-span-2"><textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim() || (form.blocked && !(form.blocked_reason || '').trim())} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="save-vendor-btn">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{editingId ? 'Save changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
