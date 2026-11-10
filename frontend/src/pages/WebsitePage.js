/* Website — what staff run for sensoper.in and shop.sensoper.in:
 * leads from the site, the shop's products, client testimonials, pickup stores, customer logins, and the pop-ups visitors see. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Globe, Phone, MessageCircle, Search, Plus, Pencil, Trash2, Loader2, ExternalLink, FolderPlus, FolderOpen, KeyRound, Star, ImagePlus, X, Power, ShoppingBag, Users, Megaphone, Inbox, CalendarClock, Video, Upload, Store, MapPin, Clock, PlayCircle } from 'lucide-react';
import { websiteAPI, inventoryAPI, uploadAPI, projectsAPI, usersAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { PageHeader, PillTabs, Tile, Tiles, Empty, Loading, Card, Chip, Field, inputCls, inr, fmtDate, errText } from '../components/kit/PageBits';
import Can from '../components/Can';
import { useAuth } from '../contexts/AuthContext';
import { confirmAction } from '../components/kit/confirm';
import ClientPasswordDialog from '../components/ClientPasswordDialog';

const API_URL = process.env.REACT_APP_BACKEND_URL;
const LIVE_SITE = 'https://sensoper.in';
const LIVE_SHOP = 'https://shop.sensoper.in';
const STATUS_TONE = { new: 'amber', contacted: 'blue', site_visit: 'violet', quoted: 'blue', won: 'green', lost: 'slate' };
const textareaCls = 'min-h-[84px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25';
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const wa = (phone, text) => `https://wa.me/91${digits(phone)}?text=${encodeURIComponent(text)}`;
const ago = (iso) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return d < 7 ? `${d} day${d === 1 ? '' : 's'} ago` : fmtDate(iso);
};
const imgSrc = (ref) => (String(ref).startsWith('http') ? ref : `${API_URL}/api/files/${ref}`);
const rows = (r) => (Array.isArray(r?.data) ? r.data : r?.data?.items || []);

/* ───────────────────────── leads ───────────────────────── */
function LeadDialog({ id, onClose, onChanged, staff }) {
  const navigate = useNavigate();
  const [l, setL] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { websiteAPI.leads.get(id).then((r) => setL(r.data)).catch((e) => { toast.error(errText(e, 'Couldn’t open that lead')); onClose(); }); }, [id, onClose]);
  const save = async (patch, msg = 'Saved') => {
    setBusy(true);
    try { const r = await websiteAPI.leads.update(id, patch); setL(r.data); setNote(''); onChanged(); toast.success(msg); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!await confirmAction({ title: `Delete the lead from ${l.name || `+91 ${l.phone}`}?`, message: 'It can’t be brought back.', confirmLabel: 'Delete', tone: 'danger' })) return;
    try { await websiteAPI.leads.remove(id); toast.success('Lead deleted'); onChanged(); onClose(); } catch (e) { toast.error(errText(e)); }
  };
  const c = l?.calc || {};
  const first = (l?.name || '').split(' ')[0] || 'there';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" data-testid="lead-dialog">
        {!l ? <Loading /> : (<>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">{l.name || <span className="text-slate-500">Only their number so far</span>}<Chip tone={STATUS_TONE[l.status]}>{l.status_label}</Chip></DialogTitle>
            <DialogDescription>{l.number} — {l.kind_label}, from the {l.source_label.toLowerCase()} — {ago(l.created_at)}{l.submissions > 1 ? ` — asked ${l.submissions} times` : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <a href={`tel:+91${l.phone}`}><Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="lead-call"><Phone className="h-4 w-4" />+91 {l.phone}</Button></a>
              <a href={wa(l.phone, `Hi ${first}, this is Sensoper — thanks for your enquiry on our website.`)} target="_blank" rel="noopener noreferrer"><Button className="h-10 gap-1.5 bg-[#12803D] text-white hover:bg-[#0F6E34]"><MessageCircle className="h-4 w-4" />WhatsApp</Button></a>
              {l.project_id
                ? <Button variant="outline" className="h-10 gap-1.5" onClick={() => navigate(`/dashboard/projects/${l.project_id}`)}><FolderOpen className="h-4 w-4" />Open {l.project_reference || 'project'}</Button>
                : l.kind !== 'shop_order' && <Can module="module_projects" action="create"><Button variant="outline" className="h-10 gap-1.5" onClick={() => navigate(`/dashboard/projects/new?lead=${l.id}`)} data-testid="lead-make-project"><FolderPlus className="h-4 w-4" />Make project</Button></Can>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-3">
              {[['Area', l.area], ['PIN code', l.pincode], ['Email', l.email], ['Best time', l.best_time], ['Page', l.page],
                ['Came from', Object.entries(l.utm || {}).map(([k, v]) => `${k.replace('utm_', '')}: ${v}`).join(', ')]].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-xs text-slate-500">{k}</dt><dd className="truncate text-slate-800">{v}</dd></div>))}
            </dl>
            {l.message && <p className="rounded-lg border border-slate-200 p-3 text-slate-700">“{l.message}”</p>}
            {Object.keys(c).length > 0 && (
              <Card title="Their calculator figures" sub="An estimate from the website — the site visit decides the real numbers.">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[['EB bill', c.bill && (c.mode === 'business' ? `${inr(c.bill)}/month` : `${inr(c.bill)} (2 months)`)], ['Units', c.units && `${c.units}${c.mode === 'home' ? ' / 2 months' : ' / month'}`], ['System', c.kw && `${c.kw} kW`],
                    ['Pump', c.pump_hp && `${c.pump_hp} HP`], ['Subsidy shown', c.subsidy && inr(c.subsidy)], ['Price shown', c.price && inr(c.price)], ['Saving', c.monthly_saving && `${inr(c.monthly_saving)}/month`],
                    ['Payback', c.payback_years && `${c.payback_years} years`]].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><p className="text-[11px] text-slate-500">{k}</p><p className="font-medium tabular-nums text-slate-900">{v}</p></div>))}
                </div>
              </Card>
            )}
            {(l.items || []).length > 0 && (
              <Card title={`Order request — ${l.delivery !== 'pickup' ? 'deliver it' : l.pickup_store ? `they’ll pick it up at ${l.pickup_store.name}` : 'they’ll pick it up'}`} testid="lead-order"
                sub={l.delivery !== 'pickup' ? [l.address, l.pincode].filter(Boolean).join(', ') : l.pickup_store ? [l.pickup_store.address, l.pickup_store.phone && `Store phone ${l.pickup_store.phone}`].filter(Boolean).join(' — ') : 'From our office'}>
                <div className="divide-y divide-slate-100">
                  {l.items.map((it) => <div key={it.listing_id} className="flex justify-between gap-3 py-1.5"><span>{it.title} × {it.qty}</span><span className="tabular-nums">{inr(it.amount)}</span></div>)}
                  <div className="flex justify-between py-1.5 font-semibold"><span>Total, incl. GST</span><span className="tabular-nums">{inr(l.order_total)}</span></div>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Confirm stock and payment with them, then record it in Direct sales or Online orders.</p>
              </Card>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Stage">
                <select className={inputCls} value={l.status} onChange={(e) => save({ status: e.target.value }, 'Stage changed')} disabled={busy} data-testid="lead-status">
                  {['new', 'contacted', 'site_visit', 'quoted', 'won', 'lost'].map((k) => <option key={k} value={k}>{{ new: 'New', contacted: 'Called', site_visit: 'Site visit booked', quoted: 'Quote sent', won: 'Won', lost: 'Not going ahead' }[k]}</option>)}
                </select>
              </Field>
              <Field label="Call back on"><input type="date" className={inputCls} value={l.follow_up_on || ''} onChange={(e) => save({ follow_up_on: e.target.value }, 'Call-back date saved')} disabled={busy} data-testid="lead-follow-up" /></Field>
              <Field label="Who’s handling it" className="sm:col-span-2">
                <select className={inputCls} value={l.assigned_to || ''} onChange={(e) => save({ assigned_to: e.target.value }, 'Given to them')} disabled={busy}>
                  <option value="">Nobody yet</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="space-y-2">
              <textarea className={textareaCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did they say? e.g. Wants a visit on Saturday, terrace is 30×40 ft" data-testid="lead-note" />
              <Button onClick={() => save({ note }, 'Note added')} disabled={busy || !note.trim()} className="h-10 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="lead-add-note">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add note'}</Button>
            </div>
            <ol className="space-y-2 border-l-2 border-slate-100 pl-3">
              {[...(l.activity || [])].reverse().map((a, i) => (
                <li key={i}><p className="text-slate-800">{a.text}</p><p className="text-[11px] text-slate-500">{a.by} — {ago(a.at)}</p></li>))}
            </ol>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Can module="module_website" action="delete"><Button variant="ghost" className="gap-1.5 text-rose-600" onClick={remove}><Trash2 className="h-4 w-4" />Delete</Button></Can>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </>)}
      </DialogContent>
    </Dialog>
  );
}

function LeadsTab({ onCount }) {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const open = params.get('lead');
  const load = useCallback(() => {
    websiteAPI.leads.list({ status: status === 'all' ? undefined : status, q: q || undefined }).then((r) => setData(r.data)).catch((e) => { toast.error(errText(e, 'Couldn’t load leads')); setData({ items: [], counts: {} }); });
    onCount();
  }, [status, q, onCount]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { usersAPI.directory().then((r) => setStaff(rows(r))).catch(() => {}); }, []);
  const counts = data?.counts || {};
  const openCount = ['new', 'contacted', 'site_visit', 'quoted'].reduce((n, k) => n + (counts[k] || 0), 0);
  const setOpen = (id) => { const p = new URLSearchParams(params); if (id) p.set('lead', id); else p.delete('lead'); setParams(p, { replace: true }); };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 overflow-x-auto px-4"><div className="flex w-max gap-1.5">
          {[['open', 'Open', openCount], ['new', 'New', counts.new], ['contacted', 'Called', counts.contacted], ['site_visit', 'Site visit', counts.site_visit], ['quoted', 'Quote sent', counts.quoted], ['won', 'Won', counts.won], ['lost', 'Not going ahead', counts.lost], ['all', 'All']].map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setStatus(k)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${status === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`} data-testid={`leads-filter-${k}`}>
              {label}{n ? <span className="ml-1 tabular-nums opacity-70">{n}</span> : null}
            </button>))}
        </div></div>
        <label className="relative sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputCls} pl-9`} placeholder="Name, phone, area or WL number" value={q} onChange={(e) => setQ(e.target.value)} data-testid="leads-search" /></label>
      </div>
      {!data ? <Loading /> : !data.items.length ? (
        <Empty icon={Inbox} title={status === 'open' ? 'No open leads' : 'Nothing here'} text="Enquiries from the calculator, the quote form, pop-ups and the shop land here — the team gets a bell note for each one.">
          <a href={LIVE_SITE} target="_blank" rel="noopener noreferrer"><Button variant="outline" className="gap-1.5"><ExternalLink className="h-4 w-4" />Open the website</Button></a>
        </Empty>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="leads-list">
          {data.items.map((l) => (
            <button key={l.id} type="button" onClick={() => setOpen(l.id)} className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-slate-50 sm:px-4" data-testid={`lead-row-${l.number}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${l.needs_attention ? 'bg-amber-500' : 'bg-transparent'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium text-slate-900">{l.name || <span className="font-normal italic text-slate-500">Name not given yet</span>}</span><Chip tone={STATUS_TONE[l.status]}>{l.status_label}</Chip>{l.kind === 'shop_order' && <Chip tone="violet">Shop order</Chip>}</span>
                <span className="mt-0.5 block truncate text-sm text-slate-600">{l.summary}</span>
                <span className="mt-0.5 block text-[11px] text-slate-500">{l.number} — +91 {l.phone} — {l.source_label} — {ago(l.last_submitted_at || l.created_at)}{l.assigned_to_name ? ` — ${l.assigned_to_name}` : ''}</span>
              </span>
              {l.follow_up_on && <span className={`hidden shrink-0 items-center gap-1 text-xs sm:flex ${l.follow_up_on <= today ? 'text-amber-700' : 'text-slate-500'}`}><CalendarClock className="h-3.5 w-3.5" />{fmtDate(l.follow_up_on, { day: 'numeric', month: 'short' })}</span>}
            </button>))}
        </div>
      )}
      {open && <LeadDialog id={open} staff={staff} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

/* ───────────────────────── shop ───────────────────────── */
function ProductDialog({ product, onClose, onSaved }) {
  const editing = !!product?.id;
  const [items, setItems] = useState([]);
  const [find, setFind] = useState('');
  const [item, setItem] = useState(null);
  const [f, setF] = useState({ price: product?.price ?? '', title: product?.title || '', description: product?.description || '', images: product?.images || [], featured: !!product?.featured, status: product?.status === 'live' || !editing ? 'live' : 'draft' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  useEffect(() => { if (!editing) inventoryAPI.getItems().then((r) => setItems(rows(r))).catch(() => {}); }, [editing]);
  const ref = (it) => { const m = it.margin_pct ?? it.margin_percentage, g = it.gst_percentage ?? it.gst_pct; return it.unit_price && m != null && g != null ? Math.round(it.unit_price * (1 + m / 100) * (1 + g / 100)) : null; };
  const pick = (it) => { setItem(it); const r = ref(it); set({ title: it.name, price: r ?? '' }); };
  const matches = useMemo(() => { const w = find.toLowerCase().trim(); return items.filter((it) => !w || `${it.name} ${it.sku_code || ''}`.toLowerCase().includes(w)).slice(0, 30); }, [items, find]);
  const upload = async (files) => {
    setUploading(true);
    try {
      for (const file of [...files].slice(0, 6 - f.images.length)) {
        const r = await uploadAPI.uploadImage(file);
        setF((x) => ({ ...x, images: [...x.images, r.data.storage_path] }));
      }
    } catch (e) { toast.error(errText(e, 'Couldn’t upload the picture')); } finally { setUploading(false); }
  };
  const save = async () => {
    setBusy(true);
    const body = { ...f, price: f.price === '' ? null : Number(f.price) };
    try {
      await (editing ? websiteAPI.shop.update(product.id, body) : websiteAPI.shop.add({ ...body, inventory_item_id: item.id }));
      toast.success(f.status === 'live' ? 'In the shop now' : 'Saved — hidden from the shop'); onSaved();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" data-testid="shop-product-dialog">
        <DialogHeader><DialogTitle>{editing ? 'Edit shop product' : 'Add to the shop'}</DialogTitle><DialogDescription>Shown at shop.sensoper.in with its price, stock level and pictures. Orders come in as leads.</DialogDescription></DialogHeader>
        {!editing && !item ? (
          <div className="space-y-2">
            <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input autoFocus className={`${inputCls} pl-9`} placeholder="Find an item in Inventory" value={find} onChange={(e) => setFind(e.target.value)} data-testid="shop-item-search" /></label>
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {matches.map((it) => <button key={it.id} type="button" onClick={() => pick(it)} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50" data-testid="shop-item-option"><span className="min-w-0"><span className="block truncate font-medium text-slate-900">{it.name}</span><span className="text-[11px] text-slate-500">{it.sku_code} — {it.quantity ?? 0} in stock</span></span>{ref(it) ? <span className="shrink-0 tabular-nums text-slate-600">{inr(ref(it))}</span> : null}</button>)}
              {!matches.length && <p className="px-3 py-6 text-center text-sm text-slate-500">{items.length ? 'No item matches that' : 'Loading inventory…'}</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!editing && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">From Inventory: <b>{item.name}</b> <button type="button" className="ml-1 text-xs text-sky-700 underline" onClick={() => setItem(null)}>Change</button></p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shop price (₹, incl. GST)" hint={editing && product.reference_price ? `Price list: ${inr(product.reference_price)}` : item && ref(item) ? `Price list: ${inr(ref(item))}` : 'Set a price list margin and GST to get a suggestion'}>
                <input type="number" min="0" className={inputCls} value={f.price} onChange={(e) => set({ price: e.target.value })} data-testid="shop-price" /></Field>
              <Field label="Show in the shop">
                <select className={inputCls} value={f.status} onChange={(e) => set({ status: e.target.value })} data-testid="shop-status"><option value="live">Yes — live</option><option value="draft">No — keep hidden</option></select></Field>
            </div>
            <Field label="Name in the shop"><input className={inputCls} value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} /></Field>
            <Field label="Description" hint="What it is, warranty, what’s in the box."><textarea className={textareaCls} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={1200} /></Field>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-700">Pictures <span className="font-normal text-slate-500">(up to 6 — the first is the main one)</span></p>
              <div className="flex flex-wrap gap-2">
                {f.images.map((src, i) => (
                  <span key={src} className="relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"><img src={imgSrc(src)} alt="" className="h-full w-full object-contain" />
                    <button type="button" aria-label="Remove picture" onClick={() => set({ images: f.images.filter((_, j) => j !== i) })} className="absolute right-0.5 top-0.5 rounded-full bg-white/90 p-0.5 text-slate-600 shadow"><X className="h-3 w-3" /></button></span>))}
                {f.images.length < 6 && <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-5 w-5" />}<input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => upload(e.target.files)} data-testid="shop-image-input" /></label>}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.featured} onChange={(e) => set({ featured: e.target.checked })} className="h-4 w-4" />Feature it at the top of the shop</label>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          {(editing || item) && <Button onClick={save} disabled={busy || f.price === ''} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="shop-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShopTab({ onCount }) {
  const { can } = useAuth();
  const manage = can('can_manage_website');
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => { websiteAPI.shop.list().then((r) => setData(r.data)).catch((e) => { toast.error(errText(e)); setData({ items: [] }); }); onCount(); }, [onCount]);
  useEffect(() => { load(); }, [load]);
  const toggle = async (p) => { try { await websiteAPI.shop.update(p.id, { status: p.status === 'live' ? 'draft' : 'live' }); toast.success(p.status === 'live' ? 'Hidden from the shop' : 'In the shop now'); load(); } catch (e) { toast.error(errText(e)); } };
  const remove = async (p) => { if (!await confirmAction({ title: `Take ${p.title} out of the shop?`, message: 'The item stays in Inventory. You can add it back any time.', confirmLabel: 'Remove' })) return; try { await websiteAPI.shop.remove(p.id); toast.success('Removed from the shop'); load(); } catch (e) { toast.error(errText(e)); } };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Products at <a href={LIVE_SHOP} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">shop.sensoper.in</a>. Prices include GST; stock comes from Inventory.</p>
        {manage && <Button onClick={() => setEdit({})} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="shop-add"><Plus className="h-4 w-4" />Add product</Button>}
      </div>
      {!data ? <Loading /> : !data.items.length ? (
        <Empty icon={ShoppingBag} title="The shop is empty" text="Add items from Inventory with a shop price. Until then, the shop asks visitors what they need and sends it here as a lead.">
          {manage && <Button onClick={() => setEdit({})} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"><Plus className="h-4 w-4" />Add the first product</Button>}
        </Empty>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="shop-list">
          {data.items.map((p) => (
            <div key={p.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50">{p.images[0] ? <img src={imgSrc(p.images[0])} alt="" className="h-full w-full object-contain" /> : <ShoppingBag className="h-6 w-6 text-slate-300" />}</span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-medium text-slate-900"><span className="truncate">{p.title}</span>{p.featured && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Featured" />}</p>
                <p className="text-sm tabular-nums text-slate-700">{inr(p.price)} <span className="text-[11px] text-slate-500">incl. GST{p.reference_price && Math.abs(p.reference_price - p.price) > 1 ? ` — price list ${inr(p.reference_price)}` : ''}</span></p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5"><Chip tone={p.status === 'live' ? 'green' : 'slate'}>{p.status === 'live' ? 'In the shop' : 'Hidden'}</Chip><span className="text-[11px] text-slate-500">{p.stock ?? 0} in stock</span>{p.missing_item && <Chip tone="red">Item deleted from Inventory</Chip>}</div>
                {manage && <div className="mt-2 flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setEdit(p)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => toggle(p)}><Power className="h-3.5 w-3.5" />{p.status === 'live' ? 'Hide' : 'Show'}</Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-rose-600" onClick={() => remove(p)}><Trash2 className="h-3.5 w-3.5" />Remove</Button>
                </div>}
              </div>
            </div>))}
        </div>
      )}
      {edit && <ProductDialog product={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/* ───────────────────────── customer logins ───────────────────────── */
function AccountDialog({ account, onClose, onSaved, onPassword }) {
  const editing = !!account?.id;
  const [projects, setProjects] = useState([]);
  const [find, setFind] = useState('');
  const [f, setF] = useState({ name: account?.name || '', phone: account?.phone || '', project_ids: account?.project_ids || [] });
  const [busy, setBusy] = useState(false);
  useEffect(() => { projectsAPI.getAll().then((r) => setProjects(rows(r))).catch(() => {}); }, []);
  const ph = digits(f.phone);
  const list = useMemo(() => {
    const w = find.toLowerCase().trim();
    const scored = projects.map((p) => ({ p, same: ph.length === 10 && digits(p.customer?.phone) === ph, hit: !w || `${p.customer?.name || ''} ${p.customer?.phone || ''} ${p.reference_number || ''}`.toLowerCase().includes(w) }));
    return scored.filter((x) => x.hit || f.project_ids.includes(x.p.id)).sort((a, b) => Number(f.project_ids.includes(b.p.id)) - Number(f.project_ids.includes(a.p.id)) || Number(b.same) - Number(a.same)).slice(0, 40);
  }, [projects, find, ph, f.project_ids]);
  useEffect(() => {   // tick this customer's projects once the number is typed in
    if (editing || ph.length !== 10) return;
    const mine = projects.filter((p) => digits(p.customer?.phone) === ph).map((p) => p.id);
    if (mine.length) setF((x) => ({ ...x, project_ids: [...new Set([...x.project_ids, ...mine])], name: x.name || projects.find((p) => p.id === mine[0])?.customer?.name || '' }));
  }, [ph, projects, editing]);
  const toggle = (id) => setF((x) => ({ ...x, project_ids: x.project_ids.includes(id) ? x.project_ids.filter((i) => i !== id) : [...x.project_ids, id] }));
  const save = async () => {
    setBusy(true);
    try {
      if (editing) { await websiteAPI.accounts.update(account.id, { name: f.name, project_ids: f.project_ids }); toast.success('Login updated'); onSaved(); }
      else { const r = await websiteAPI.accounts.create(f); onSaved(); onPassword(r.data); }
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" data-testid="account-dialog">
        <DialogHeader><DialogTitle>{editing ? `${account.name}’s login` : 'New customer login'}</DialogTitle><DialogDescription>The customer signs in at sensoper.in/account with this mobile number and sees only the projects you tick.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mobile number"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} disabled={editing} inputMode="numeric" placeholder="10-digit mobile" data-testid="account-phone" /></Field>
            <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="account-name" /></Field>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-700">Projects they can see</p>
            <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputCls} pl-9`} placeholder="Customer name, phone or reference" value={find} onChange={(e) => setFind(e.target.value)} /></label>
            <div className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {list.map(({ p, same }) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={f.project_ids.includes(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4" />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-900">{p.customer?.name || 'No name'} <span className="font-normal text-slate-500">{p.reference_number}</span></span><span className="text-[11px] text-slate-500">{p.customer?.phone || 'No phone'} — {p.status}</span></span>
                  {same && <Chip tone="green">Same number</Chip>}
                </label>))}
              {!list.length && <p className="px-3 py-6 text-center text-sm text-slate-500">{projects.length ? 'No project matches' : 'Loading projects…'}</p>}
            </div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || f.name.trim().length < 2 || (!editing && ph.length !== 10) || !f.project_ids.length} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="account-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save' : 'Make login'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoginsTab({ onCount }) {
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [shown, setShown] = useState(null);
  const load = useCallback(() => { websiteAPI.accounts.list({ q: q || undefined }).then((r) => setList(r.data)).catch((e) => { toast.error(errText(e)); setList([]); }); onCount(); }, [q, onCount]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  const reset = async (a) => {
    if (!await confirmAction({ title: `Make a new password for ${a.name}?`, message: 'Their old password stops working and they’re signed out. They choose their own after signing in again.', confirmLabel: 'Make new password' })) return;
    try { const r = await websiteAPI.accounts.resetPassword(a.id); setShown(r.data); load(); } catch (e) { toast.error(errText(e)); }
  };
  const onOff = async (a) => { try { await websiteAPI.accounts.update(a.id, { active: !a.active }); toast.success(a.active ? 'Login turned off' : 'Login turned on'); load(); } catch (e) { toast.error(errText(e)); } };
  const remove = async (a) => { if (!await confirmAction({ title: `Delete ${a.name}’s login?`, message: 'They won’t be able to sign in. Their projects aren’t touched.', confirmLabel: 'Delete', tone: 'danger' })) return; try { await websiteAPI.accounts.remove(a.id); toast.success('Login deleted'); load(); } catch (e) { toast.error(errText(e)); } };
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputCls} pl-9`} placeholder="Name or mobile" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <Can module="module_website" action="create"><Button onClick={() => setEdit({})} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="account-new"><Plus className="h-4 w-4" />New login</Button></Can>
      </div>
      {!list ? <Loading /> : !list.length ? (
        <Empty icon={Users} title="No customer logins yet" text="Make one here, or from a project page → Customer dashboard. Customers sign in at sensoper.in/account to see savings, payments and service." />
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="accounts-list">
          {list.map((a) => (
            <div key={a.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:px-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">{a.name}{!a.active ? <Chip>Off</Chip> : a.must_change_password ? <Chip tone="amber">Hasn’t signed in yet</Chip> : <Chip tone="green">Active</Chip>}</p>
                <p className="text-[11px] text-slate-500">+91 {a.phone} — {a.projects.map((p) => p.reference).filter(Boolean).join(', ') || 'no projects'}{a.other_projects ? ` + ${a.other_projects} handled by others` : ''} — {a.last_login_at ? `last in ${ago(a.last_login_at)}` : `made by ${a.created_by_name || '—'} ${ago(a.created_at)}`}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setEdit(a)}><Pencil className="h-3.5 w-3.5" />Projects</Button>
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => reset(a)} data-testid="account-reset"><KeyRound className="h-3.5 w-3.5" />New password</Button>
                {(user?.role !== 'staff' || a.created_by_name === user?.name) && <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => onOff(a)}><Power className="h-3.5 w-3.5" />{a.active ? 'Turn off' : 'Turn on'}</Button>}
                <Can module="module_website" action="delete"><Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-rose-600" onClick={() => remove(a)}><Trash2 className="h-3.5 w-3.5" />Delete</Button></Can>
              </div>
            </div>))}
        </div>
      )}
      {edit && <AccountDialog account={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} onPassword={setShown} />}
      {shown && <ClientPasswordDialog result={shown} onClose={() => setShown(null)} />}
    </div>
  );
}

/* ───────────────────────── client testimonials ───────────────────────── */
const VIDEO_MAX = 100 * 1024 * 1024;
const VIDEO_TYPES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const EMPTY_T = { name: '', place: '', system: '', quote: '', youtube_url: '', video_path: '', poster_path: '', status: 'live', order: 0 };
const mb = (n) => `${(Number(n || 0) / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
const ytId = (url) => (String(url || '').match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/) || [])[1] || '';

function Thumb({ t, className = 'h-16 w-28' }) {
  const [bad, setBad] = useState(false);
  const src = t.poster_path ? imgSrc(t.poster_path) : ytId(t.youtube_url) ? `https://i.ytimg.com/vi/${ytId(t.youtube_url)}/hqdefault.jpg` : null;
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ${className}`}>
      {src && !bad ? <img src={src} alt="" onError={() => setBad(true)} className="h-full w-full object-cover" /> : <Video className="h-6 w-6 text-slate-400" />}
      {src && !bad && <PlayCircle className="absolute h-6 w-6 text-white drop-shadow" aria-hidden="true" />}
    </span>
  );
}

function TestimonialDialog({ item, onClose, onSaved }) {
  const editing = !!item?.id;
  const [f, setF] = useState(editing ? { ...EMPTY_T, ...item } : EMPTY_T);
  const [mode, setMode] = useState(item?.video_path ? 'file' : 'youtube');
  const [size, setSize] = useState(item?.video_size || null);
  const [preview, setPreview] = useState(null);         // the file just chosen, to watch before saving
  const [progress, setProgress] = useState(null);
  const [posterBusy, setPosterBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const uploadVideo = async (file) => {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!VIDEO_TYPES[ext]) { toast.error('Upload the video as an MP4, WebM or MOV file.'); return; }
    if (file.size > VIDEO_MAX) { toast.error(`This video is ${mb(file.size)}. Keep it under 100 MB — trim it, or export it at 720p.`); return; }
    // some phones and Windows don't say what a .mov is; the server checks the file itself as well
    const sendable = file.type === VIDEO_TYPES[ext] ? file : new File([file], file.name, { type: VIDEO_TYPES[ext] });
    setProgress(0);
    try {
      const r = await websiteAPI.testimonials.uploadVideo(sendable, setProgress);
      set({ video_path: r.data.video_path }); setSize(r.data.size); setPreview(URL.createObjectURL(file)); toast.success('Video uploaded');
    } catch (e) { toast.error(errText(e, 'Couldn’t upload the video')); } finally { setProgress(null); }
  };
  const uploadPoster = async (file) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast.error('Choose a PNG, JPG or WebP picture.'); return; }
    setPosterBusy(true);
    try { const r = await uploadAPI.uploadImage(file); set({ poster_path: r.data.storage_path }); }
    catch (e) { toast.error(errText(e, 'Couldn’t upload the picture')); } finally { setPosterBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    const body = { name: f.name, place: f.place, system: f.system, quote: f.quote, poster_path: f.poster_path || '', status: f.status,
      order: Number(f.order) || 0, youtube_url: mode === 'youtube' ? f.youtube_url : '', video_path: mode === 'file' ? f.video_path : '' };
    try {
      await (editing ? websiteAPI.testimonials.update(item.id, body) : websiteAPI.testimonials.create(body));
      toast.success(f.status === 'live' ? 'Testimonial saved — it’s on the website' : 'Testimonial saved as a draft'); onSaved();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const hasVideo = mode === 'youtube' ? !!f.youtube_url.trim() : !!f.video_path;
  const tabCls = (on) => `rounded-full px-3 py-1.5 text-sm ${on ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`;
  return (
    <Dialog open onOpenChange={(o) => !o && progress === null && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" data-testid="testimonial-dialog">
        <DialogHeader><DialogTitle>{editing ? 'Edit testimonial' : 'Add a client testimonial'}</DialogTitle><DialogDescription>A short video of a happy customer, shown on the website with their name and what they said.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer’s name"><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder="e.g. Ravi Kumar" data-testid="testimonial-name" /></Field>
            <Field label="Place"><input className={inputCls} value={f.place} onChange={(e) => set({ place: e.target.value })} maxLength={80} placeholder="e.g. Perundurai" /></Field>
          </div>
          <Field label="Their system"><input className={inputCls} value={f.system} onChange={(e) => set({ system: e.target.value })} maxLength={80} placeholder="e.g. 5 kW on-grid" /></Field>
          <Field label="What they said" hint={`${f.quote.length} of 400 characters. Shown under the video.`}>
            <textarea className={textareaCls} value={f.quote} onChange={(e) => set({ quote: e.target.value })} maxLength={400} placeholder="e.g. Bill went from ₹4,200 to ₹300." data-testid="testimonial-quote" /></Field>
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-700">The video</p>
            <div className="flex gap-1.5" role="group" aria-label="Where the video is">
              <button type="button" className={tabCls(mode === 'youtube')} onClick={() => setMode('youtube')} aria-pressed={mode === 'youtube'} data-testid="testimonial-mode-youtube">YouTube link</button>
              <button type="button" className={tabCls(mode === 'file')} onClick={() => setMode('file')} aria-pressed={mode === 'file'} data-testid="testimonial-mode-file">Upload a video</button>
            </div>
            {mode === 'youtube' ? (
              <Field label="YouTube link" hint="Open the video on YouTube, tap Share, copy the link and paste it here. Shorts work too.">
                <input className={inputCls} value={f.youtube_url} onChange={(e) => set({ youtube_url: e.target.value })} inputMode="url" placeholder="https://youtu.be/…" data-testid="testimonial-youtube" /></Field>
            ) : (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                {f.video_path && <p className="text-sm text-slate-700">Uploaded video{size ? ` — ${mb(size)}` : ''}</p>}
                {preview && <video src={preview} controls playsInline className="max-h-56 w-full rounded-md bg-black" />}
                {progress !== null ? (
                  <div className="space-y-1" aria-live="polite">
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-600 transition-[width]" style={{ width: `${progress}%` }} /></div>
                    <p className="text-[11px] text-slate-500">Uploading… {progress}% — keep this window open.</p>
                  </div>
                ) : (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Upload className="h-4 w-4" />{f.video_path ? 'Upload a different video' : 'Upload video'}
                    <input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" className="sr-only" onChange={(e) => { uploadVideo(e.target.files?.[0]); e.target.value = ''; }} data-testid="testimonial-video-input" />
                  </label>
                )}
                <p className="text-[11px] text-slate-500">MP4, WebM or MOV, up to 100 MB. A minute or two at 720p is plenty.</p>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-700">Poster picture <span className="font-normal text-slate-500">(optional)</span></p>
            <div className="flex items-center gap-3">
              {f.poster_path ? <img src={imgSrc(f.poster_path)} alt="" className="h-16 w-28 rounded-lg border border-slate-200 object-cover" /> : <span className="flex h-16 w-28 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400"><ImagePlus className="h-5 w-5" /></span>}
              <div className="flex flex-col items-start gap-1">
                <label className="cursor-pointer text-sm font-medium text-sky-700 underline">{posterBusy ? 'Uploading…' : f.poster_path ? 'Change picture' : 'Upload picture'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={posterBusy} onChange={(e) => { uploadPoster(e.target.files?.[0]); e.target.value = ''; }} data-testid="testimonial-poster-input" /></label>
                {f.poster_path && <button type="button" className="text-[11px] text-slate-500 underline" onClick={() => set({ poster_path: '' })}>Remove picture</button>}
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Shown before the video plays. Leave it empty on a YouTube video to use YouTube’s own picture.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Show on the website"><select className={inputCls} value={f.status} onChange={(e) => set({ status: e.target.value })} data-testid="testimonial-status"><option value="live">Yes — show it</option><option value="draft">No — keep as a draft</option></select></Field>
            <Field label="Order" hint="Smaller numbers show first."><input type="number" min="0" max="9999" className={inputCls} value={f.order} onChange={(e) => set({ order: e.target.value })} /></Field>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={progress !== null}>Cancel</Button>
          <Button onClick={save} disabled={busy || progress !== null || f.name.trim().length < 2 || !hasVideo} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="testimonial-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save testimonial'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestimonialsTab() {
  const { can } = useAuth();
  const manage = can('can_manage_website');
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => { websiteAPI.testimonials.list().then((r) => setList(r.data?.items || [])).catch((e) => { toast.error(errText(e, 'Couldn’t load testimonials')); setList([]); }); }, []);
  useEffect(() => { load(); }, [load]);
  const bodyOf = (t, patch) => ({ name: t.name, place: t.place, system: t.system, quote: t.quote, youtube_url: t.youtube_url, video_path: t.video_path,
    poster_path: t.poster_path, status: t.status, order: t.order, ...patch });
  const toggle = async (t) => {
    try { await websiteAPI.testimonials.update(t.id, bodyOf(t, { status: t.status === 'live' ? 'draft' : 'live' })); toast.success(t.status === 'live' ? 'Taken off the website' : 'On the website now'); load(); }
    catch (e) { toast.error(errText(e)); }
  };
  const remove = async (t) => {
    if (!await confirmAction({ title: `Delete ${t.name}’s testimonial?`, message: t.video_path ? 'It comes off the website and the uploaded video is deleted.' : 'It comes off the website straight away.', confirmLabel: 'Delete', tone: 'danger' })) return;
    try { await websiteAPI.testimonials.remove(t.id); toast.success('Testimonial deleted'); load(); } catch (e) { toast.error(errText(e)); }
  };
  const watch = (t) => (t.youtube_url ? t.youtube_url : t.status === 'live' && t.video_path ? `${API_URL}/api/public/testimonials/${t.id}/video` : null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Videos of happy customers on the website. Up to 24 show, smallest order number first.</p>
        {manage && <Button onClick={() => setEdit({})} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="testimonial-new"><Plus className="h-4 w-4" />Add testimonial</Button>}
      </div>
      {!list ? <Loading /> : !list.length ? (
        <Empty icon={Video} title="No testimonials yet" text="Add a YouTube link or upload a short video of a customer talking about their system. The website shows the section once there’s one.">
          {manage && <Button onClick={() => setEdit({})} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"><Plus className="h-4 w-4" />Add the first testimonial</Button>}
        </Empty>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="testimonials-list">
          {list.map((t) => (
            <div key={t.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <Thumb t={t} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900"><span className="truncate">{t.name}</span><Chip tone={t.status === 'live' ? 'green' : 'slate'}>{t.status === 'live' ? 'On the website' : 'Draft'}</Chip></p>
                <p className="truncate text-[11px] text-slate-500">{[t.place, t.system, t.youtube_url ? 'YouTube' : `Uploaded video${t.video_size ? `, ${mb(t.video_size)}` : ''}`, `order ${t.order}`].filter(Boolean).join(' — ')}</p>
                {t.quote && <p className="mt-1 line-clamp-2 text-sm text-slate-700">“{t.quote}”</p>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {watch(t) && <a href={watch(t)} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="sm" className="h-8 gap-1 px-2"><ExternalLink className="h-3.5 w-3.5" />Watch</Button></a>}
                  {manage && <>
                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setEdit(t)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => toggle(t)}><Power className="h-3.5 w-3.5" />{t.status === 'live' ? 'Hide' : 'Show'}</Button>
                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-rose-600" onClick={() => remove(t)}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
                  </>}
                </div>
              </div>
            </div>))}
        </div>
      )}
      {edit && <TestimonialDialog item={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/* ───────────────────────── pickup stores (the ERP's locations) ───────────────────────── */
const storeName = (st) => st.pickup?.public_name || String(st.name || '').replace(/_/g, ' ');
const coordText = (p) => (p?.lat != null && p?.lng != null ? `${p.lat}, ${p.lng}` : '');
const parseCoords = (text) => { const m = String(text || '').match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/); return m ? [Number(m[1]), Number(m[2])] : null; };

function StoreDialog({ store, onClose, onSaved }) {
  const p = store.pickup || {};
  const fallback = String(store.name || '').replace(/_/g, ' ');
  const [f, setF] = useState({ enabled: p.address ? !!p.enabled : true, public_name: p.public_name || '', address: p.address || store.address || '',
    phone: p.phone || '', hours: p.hours || '', coordinates: coordText(p) });
  const [busy, setBusy] = useState(false);
  const set = (x) => setF((y) => ({ ...y, ...x }));
  const ll = parseCoords(f.coordinates);
  const save = async () => {
    setBusy(true);
    try { await websiteAPI.stores.save(store.location_id, f); toast.success(f.enabled ? 'Store saved — customers can pick up there' : 'Store saved — pickup is off'); onSaved(); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" data-testid="store-dialog">
        <DialogHeader><DialogTitle>Pickup from {fallback}</DialogTitle><DialogDescription>Customers who choose to pick up a shop order see this store’s name, address, phone, hours and a directions link.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="mt-0.5 h-4 w-4" data-testid="store-enabled" />
            <span>Customers can pick up orders here<span className="block text-[11px] text-slate-500">Untick to stop offering this store. The details are kept.</span></span></label>
          <Field label="Name on the website" hint={`Leave it empty to show “${fallback}”.`}><input className={inputCls} value={f.public_name} onChange={(e) => set({ public_name: e.target.value })} maxLength={80} placeholder={fallback} /></Field>
          <Field label="Address" hint="Door number, street, town and PIN code — as customers should find it.">
            <textarea className={textareaCls} value={f.address} onChange={(e) => set({ address: e.target.value })} maxLength={300} data-testid="store-address" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" hint="Mobile, or landline with STD code"><input className={inputCls} value={f.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" placeholder="e.g. 9043547047" data-testid="store-phone" /></Field>
            <Field label="Opening hours"><input className={inputCls} value={f.hours} onChange={(e) => set({ hours: e.target.value })} maxLength={80} placeholder="Mon–Sat, 9:30 am – 6:30 pm" /></Field>
          </div>
          <Field label="Map coordinates" hint="Open the store in Google Maps, long-press the pin and paste the numbers here (for example 11.2712, 77.5845)">
            <input className={inputCls} value={f.coordinates} onChange={(e) => set({ coordinates: e.target.value })} inputMode="decimal" placeholder="11.2712, 77.5845" data-testid="store-coordinates" /></Field>
          {ll && <a href={`https://www.google.com/maps?q=${ll[0]},${ll[1]}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-sky-700 underline"><MapPin className="h-3.5 w-3.5" />Check the pin on Google Maps</a>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || (f.enabled && f.address.trim().length < 5)} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="store-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save store'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StoresTab() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const manage = can('can_manage_website');
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => { websiteAPI.stores.list().then((r) => setList(r.data?.items || [])).catch((e) => { toast.error(errText(e, 'Couldn’t load the stores')); setList([]); }); }, []);
  useEffect(() => { load(); }, [load]);
  const onOff = async (st) => {
    const p = st.pickup || {};
    try {
      await websiteAPI.stores.save(st.location_id, { enabled: !p.enabled, public_name: p.public_name, address: p.address, phone: p.phone, hours: p.hours, coordinates: coordText(p) });
      toast.success(p.enabled ? 'Pickup switched off for this store' : 'Customers can pick up here now'); load();
    } catch (e) { toast.error(errText(e)); }
  };
  const on = (list || []).filter((x) => x.pickup?.enabled).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">When a shop customer chooses to pick up their order, they choose one of the stores switched on here. {list && !on ? 'None is on now, so the shop offers pickup from our office.' : ''}</p>
      {!list ? <Loading /> : !list.length ? (
        <Empty icon={Store} title="No locations yet" text="Add your branches on the Locations page first. Each one can then be offered as a pickup store.">
          <Can module="module_locations" action="view"><Button variant="outline" className="gap-1.5" onClick={() => navigate('/dashboard/locations')}><MapPin className="h-4 w-4" />Open Locations</Button></Can>
        </Empty>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="stores-list">
          {list.map((st) => {
            const p = st.pickup || {};
            return (
              <div key={st.location_id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`store-${st.location_id}`}>
                <p className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">{storeName(st)}<Chip tone={p.enabled ? 'green' : 'slate'}>{p.enabled ? 'Pickup on' : 'Pickup off'}</Chip></p>
                <p className="text-[11px] text-slate-500">{[String(st.type || '').replace(/_/g, ' '), st.district, p.public_name && `ERP name ${st.name}`].filter(Boolean).join(' — ')}</p>
                {p.address ? (
                  <div className="mt-1.5 space-y-0.5 text-sm text-slate-700">
                    <p className="flex gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />{p.address}</p>
                    {p.phone && <p className="flex gap-1.5"><Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />{p.phone}</p>}
                    {p.hours && <p className="flex gap-1.5"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />{p.hours}</p>}
                    {p.lat == null && p.enabled && <p className="text-[11px] text-amber-700">No map pin yet — customers won’t get a directions link.</p>}
                  </div>
                ) : <p className="mt-1.5 text-sm text-slate-500">Not set up for pickup.</p>}
                {manage && <div className="mt-2 flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setEdit(st)} data-testid="store-edit"><Pencil className="h-3.5 w-3.5" />{p.address ? 'Edit' : 'Set up pickup'}</Button>
                  {p.address && <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => onOff(st)}><Power className="h-3.5 w-3.5" />{p.enabled ? 'Switch off' : 'Switch on'}</Button>}
                </div>}
              </div>);
          })}
        </div>
      )}
      {edit && <StoreDialog store={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/* ───────────────────────── pop-ups & settings ───────────────────────── */
const ACTIONS = [['quote', 'Opens the quote form'], ['whatsapp', 'Opens WhatsApp'], ['shop', 'Opens the shop'], ['link', 'Opens a link'], ['none', 'No button']];
const EMPTY_POP = { title: '', message: '', cta_label: '', cta_action: 'quote', cta_url: '', where: 'site', delay_seconds: 8, valid_till: '', active: true };

function PopupDialog({ popup, onClose, onSaved }) {
  const [f, setF] = useState(popup?.id ? { ...EMPTY_POP, ...popup, valid_till: popup.valid_till || '' } : EMPTY_POP);
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    setBusy(true);
    const body = { ...f, valid_till: f.valid_till || null, delay_seconds: Number(f.delay_seconds) || 0 };
    try { await (popup?.id ? websiteAPI.popups.update(popup.id, body) : websiteAPI.popups.create(body)); toast.success('Pop-up saved'); onSaved(); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const label = f.cta_label || { quote: 'Get a free quote', whatsapp: 'Chat on WhatsApp', shop: 'Open the shop', link: 'Open' }[f.cta_action];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" data-testid="popup-dialog">
        <DialogHeader><DialogTitle>{popup?.id ? 'Edit pop-up' : 'New pop-up'}</DialogTitle><DialogDescription>Slides in like a phone notification. Each visitor sees at most two a visit, and not the same one again for 3 days.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Title"><input className={inputCls} value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={70} placeholder="e.g. Free panel cleaning this month" data-testid="popup-title" /></Field>
          <Field label="Message"><textarea className={textareaCls} value={f.message} onChange={(e) => set({ message: e.target.value })} maxLength={220} placeholder="One or two short lines" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Button"><select className={inputCls} value={f.cta_action} onChange={(e) => set({ cta_action: e.target.value })}>{ACTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            {f.cta_action !== 'none' && <Field label="Button text"><input className={inputCls} value={f.cta_label} onChange={(e) => set({ cta_label: e.target.value })} maxLength={30} placeholder={label} /></Field>}
          </div>
          {f.cta_action === 'link' && <Field label="Link" hint="https://… or a page on the site like /#subsidy"><input className={inputCls} value={f.cta_url} onChange={(e) => set({ cta_url: e.target.value })} /></Field>}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Show on"><select className={inputCls} value={f.where} onChange={(e) => set({ where: e.target.value })}><option value="site">Website</option><option value="shop">Shop</option><option value="both">Both</option></select></Field>
            <Field label="After (seconds)"><input type="number" min="0" max="120" className={inputCls} value={f.delay_seconds} onChange={(e) => set({ delay_seconds: e.target.value })} /></Field>
            <Field label="Until"><input type="date" className={inputCls} value={f.valid_till} onChange={(e) => set({ valid_till: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} className="h-4 w-4" />Show it now</label>
          <div className="rounded-2xl bg-gradient-to-br from-sky-100 to-emerald-50 p-3" aria-label="Preview">
            <div className="flex gap-3 rounded-2xl bg-white/90 p-3 shadow-lg">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 text-white"><Megaphone className="h-5 w-5" /></span>
              <div className="min-w-0"><p className="text-[11px] text-slate-400">Sensoper now</p><p className="text-sm font-semibold text-slate-900">{f.title || 'Your title'}</p>{f.message && <p className="text-xs text-slate-600">{f.message}</p>}{f.cta_action !== 'none' && <span className="mt-2 inline-block rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white">{label}</span>}</div>
            </div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || f.title.trim().length < 3} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="popup-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PopupsTab({ onCount }) {
  const { can } = useAuth();
  const manage = can('can_manage_website');
  const [list, setList] = useState(null);
  const [s, setS] = useState(null);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    websiteAPI.popups.list().then((r) => setList(r.data)).catch(() => setList([]));
    websiteAPI.settings.get().then((r) => setS(r.data)).catch(() => {});
    onCount();
  }, [onCount]);
  useEffect(() => { load(); }, [load]);
  const saveSettings = async () => {
    setSaving(true);
    try {
      const r = await websiteAPI.settings.save({ whatsapp_number: s.whatsapp_number, call_number: s.call_number, show_price_estimate: s.show_price_estimate,
        site_url: (s.site_url || '').trim(), shop_url: (s.shop_url || '').trim() });
      setS(r.data); toast.success('Website settings saved');
    }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  const remove = async (p) => { if (!await confirmAction({ title: `Delete the pop-up “${p.title}”?`, confirmLabel: 'Delete', tone: 'danger' })) return; try { await websiteAPI.popups.remove(p.id); load(); } catch (e) { toast.error(errText(e)); } };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2"><p className="text-sm text-slate-600">Short notices that slide in on the website or the shop.</p>
          {manage && <Button onClick={() => setEdit({})} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="popup-new"><Plus className="h-4 w-4" />New pop-up</Button>}</div>
        {!list ? <Loading /> : !list.length ? <Empty icon={Megaphone} title="No pop-ups of your own" text="The website already shows the PM Surya Ghar deadline and a call-back offer. Add your own for offers, events or holidays." /> : (
          <div className="space-y-2" data-testid="popups-list">
            {list.map((p) => {
              const expired = p.valid_till && p.valid_till < today;
              return (
                <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">{p.title}<Chip tone={p.active && !expired ? 'green' : 'slate'}>{expired ? 'Ended' : p.active ? 'Showing' : 'Off'}</Chip></p>
                    <p className="text-[11px] text-slate-500">{{ site: 'Website', shop: 'Shop', both: 'Website and shop' }[p.where]} — after {p.delay_seconds} s{p.valid_till ? ` — until ${fmtDate(p.valid_till)}` : ''}</p></div>
                  {manage && <div className="flex gap-1"><Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={() => setEdit(p)}><Pencil className="h-3.5 w-3.5" />Edit</Button><Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-rose-600" onClick={() => remove(p)}><Trash2 className="h-3.5 w-3.5" />Delete</Button></div>}
                </div>);
            })}
          </div>
        )}
      </div>
      <Card title="Website settings" sub="Used on sensoper.in, the shop and the customer login page.">
        {!s ? <Loading /> : (
          <div className="space-y-3">
            <Field label="WhatsApp number" hint={`Empty = the company phone (${s.company_phone || 'not set'}). Now: ${s.effective_whatsapp || '—'}`}><input className={inputCls} value={s.whatsapp_number || ''} onChange={(e) => setS({ ...s, whatsapp_number: e.target.value })} disabled={!manage} inputMode="numeric" data-testid="settings-whatsapp" /></Field>
            <Field label="Phone number for calls" hint={`Empty = the company phone. Now: ${s.effective_call || '—'}`}><input className={inputCls} value={s.call_number || ''} onChange={(e) => setS({ ...s, call_number: e.target.value })} disabled={!manage} inputMode="numeric" /></Field>
            <Field label="Main website address" hint={`Where the website opens, starting with https://. Empty = ${s.default_site_url || 'https://quote.sensoper.in'}`}>
              <input className={inputCls} value={s.site_url || ''} onChange={(e) => setS({ ...s, site_url: e.target.value })} disabled={!manage} inputMode="url" placeholder={s.default_site_url || 'https://quote.sensoper.in'} data-testid="settings-site-url" /></Field>
            <Field label="Shop address" hint={`For example https://shop.sensoper.in. Empty = the main website address + /shop/ (${(s.urls?.site || s.default_site_url || 'https://quote.sensoper.in')}/shop/)`}>
              <input className={inputCls} value={s.shop_url || ''} onChange={(e) => setS({ ...s, shop_url: e.target.value })} disabled={!manage} inputMode="url" placeholder="https://shop.sensoper.in" data-testid="settings-shop-url" /></Field>
            <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!s.show_price_estimate} onChange={(e) => setS({ ...s, show_price_estimate: e.target.checked })} disabled={!manage} className="mt-0.5 h-4 w-4" /><span>Show an estimated price in the savings calculator<span className="block text-[11px] text-slate-500">Uses Price list → Package slabs — the per-kW rates you quote customers.</span></span></label>
            {manage && <Button onClick={saveSettings} disabled={saving} className="w-full bg-emerald-600 text-white hover:bg-emerald-700" data-testid="settings-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save settings'}</Button>}
          </div>
        )}
      </Card>
      {edit && <PopupDialog popup={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/* ───────────────────────── the page ───────────────────────── */
export default function WebsitePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'leads';
  const [sum, setSum] = useState(null);
  const refresh = useCallback(() => { websiteAPI.summary().then((r) => setSum(r.data)).catch(() => {}); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const go = (t) => { const p = new URLSearchParams(params); p.set('tab', t); p.delete('lead'); setParams(p, { replace: true }); };
  return (
    <div className="space-y-4" data-testid="website-page">
      <PageHeader icon={Globe} title="Website" sub="sensoper.in and shop.sensoper.in — leads, the shop, testimonials, pickup stores, customer logins and pop-ups.">
        <a href={LIVE_SITE} target="_blank" rel="noopener noreferrer"><Button variant="outline" className="gap-1.5"><ExternalLink className="h-4 w-4" />Website</Button></a>
        <a href={LIVE_SHOP} target="_blank" rel="noopener noreferrer"><Button variant="outline" className="gap-1.5"><ShoppingBag className="h-4 w-4" />Shop</Button></a>
      </PageHeader>
      <Tiles>
        <Tile label="New leads" value={sum?.new_leads ?? '—'} icon={Inbox} tone={sum?.new_leads ? 'warn' : undefined} onClick={() => go('leads')} testid="tile-new-leads" />
        <Tile label="Call-backs due" value={sum?.follow_ups_due ?? '—'} sub={`${sum?.open_leads ?? 0} open in all`} icon={CalendarClock} tone={sum?.follow_ups_due ? 'warn' : undefined} onClick={() => go('leads')} />
        <Tile label="In the shop" value={sum?.shop_products ?? '—'} sub="products live" icon={ShoppingBag} onClick={() => go('shop')} />
        <Tile label="Customer logins" value={sum?.client_logins ?? '—'} icon={Users} onClick={() => go('logins')} />
      </Tiles>
      <PillTabs value={tab} onChange={go} testid="website-tab" tabs={[['leads', 'Leads', sum?.new_leads], ['shop', 'Shop'], ['testimonials', 'Testimonials'], ['stores', 'Pickup stores'], ['logins', 'Customer logins'], ['popups', 'Pop-ups & settings']]} />
      {tab === 'leads' && <LeadsTab onCount={refresh} />}
      {tab === 'shop' && <ShopTab onCount={refresh} />}
      {tab === 'testimonials' && <TestimonialsTab />}
      {tab === 'stores' && <StoresTab />}
      {tab === 'logins' && <LoginsTab onCount={refresh} />}
      {tab === 'popups' && <PopupsTab onCount={refresh} />}
    </div>
  );
}
