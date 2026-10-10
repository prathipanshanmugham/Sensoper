/* Offers shown on customers' dashboards, and the customers who tapped "I'm interested". */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Gift, Plus, Pencil, Trash2, Loader2, Phone, Check, Users } from 'lucide-react';
import { customerDashboardAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { inputCls, textareaCls, Field, Chip } from '../components/FormBits';
import Can from '../components/Can';

const TYPES = [['on-grid', 'On-grid'], ['hybrid', 'Hybrid'], ['off-grid', 'Off-grid'], ['solar-pump', 'Solar pump']];
const EMPTY = { title: '', description: '', badge: '', valid_till: '', cta_label: "I'm interested", system_types: [], active: true };
const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function OfferDialog({ offer, onClose, onSaved }) {
  const [f, setF] = useState(offer?.id ? { ...EMPTY, ...offer, valid_till: offer.valid_till || '' } : EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    setSaving(true);
    const body = { ...f, valid_till: f.valid_till || null };
    try { await (offer?.id ? customerDashboardAPI.updateOffer(offer.id, body) : customerDashboardAPI.createOffer(body)); toast.success('Offer saved'); onSaved(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not save'); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="offer-dialog">
        <DialogHeader><DialogTitle>{offer?.id ? 'Edit offer' : 'New offer'}</DialogTitle><DialogDescription>Shown on every matching customer's dashboard while it's on.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Title"><input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Add a battery — 10% off" className={inputCls} data-testid="offer-title" /></Field>
          <Field label="Details"><textarea value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="What the customer gets, in one or two lines" className={textareaCls} data-testid="offer-description" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Badge"><input value={f.badge} onChange={(e) => set({ badge: e.target.value })} placeholder="10% off" className={inputCls} /></Field>
            <Field label="Valid till"><input type="date" value={f.valid_till} onChange={(e) => set({ valid_till: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Button text"><input value={f.cta_label} onChange={(e) => set({ cta_label: e.target.value })} className={inputCls} /></Field>
          <Field label="Show to" group hint="Pick none to show it to everyone.">
            <div className="flex flex-wrap gap-2">{TYPES.map(([v, l]) => <Chip key={v} active={f.system_types.includes(v)} onClick={() => set({ system_types: f.system_types.includes(v) ? f.system_types.filter((x) => x !== v) : [...f.system_types, v] })}>{l}</Chip>)}</div>
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} className="h-4 w-4" />Show on dashboards now</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving || !f.title.trim()} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="offer-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomerOffersPage() {
  const [offers, setOffers] = useState(null);
  const [interests, setInterests] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => {
    customerDashboardAPI.offers().then((r) => setOffers(r.data)).catch(() => setOffers([]));
    customerDashboardAPI.interests().then((r) => setInterests(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const remove = async (o) => {
    if (!window.confirm(`Delete "${o.title}"?`)) return;
    await customerDashboardAPI.deleteOffer(o.id).catch(() => toast.error('Could not delete'));
    load();
  };
  const handled = async (i) => { await customerDashboardAPI.markInterest(i.id).catch(() => {}); load(); };
  const open = interests.filter((i) => !i.handled);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6" data-testid="offers-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-['Outfit'] text-2xl font-bold text-slate-900">Customer offers</h1><p className="text-sm text-slate-500">Offers appear on customers' dashboards. When someone taps “I'm interested”, they show up below to call back.</p></div>
        <Can module="module_customer_offers" action="create"><Button onClick={() => setEdit({})} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="new-offer"><Plus className="h-4 w-4" />New offer</Button></Can>
      </div>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-['Outfit'] text-base font-semibold text-slate-900"><Users className="h-4 w-4 text-emerald-600" />To call back <span className="text-sm font-normal text-slate-500">· {open.length}</span></h2>
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="interest-list">
          {open.length === 0 && <li className="px-4 py-5 text-center text-sm text-slate-400">Nobody waiting.</li>}
          {open.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{i.customer_name}</p><p className="text-xs text-slate-500">{i.offer_title} · {i.reference_number} · {fmt(i.created_at)}</p></div>
              {i.phone && <a href={`tel:${i.phone}`} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"><Phone className="h-3.5 w-3.5" />{i.phone}</a>}
              <Link to={`/dashboard/projects/${i.project_id}`} className="text-xs font-medium text-emerald-700 hover:underline">Project</Link>
              <button type="button" onClick={() => handled(i)} className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white" data-testid={`interest-done-${i.id}`}><Check className="h-3.5 w-3.5" />Called</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-['Outfit'] text-base font-semibold text-slate-900"><Gift className="h-4 w-4 text-emerald-600" />Offers</h2>
        {!offers ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : offers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">No offers yet. Try an AMC plan, a battery add-on, panel cleaning or a referral bonus.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {offers.map((o) => (
              <li key={o.id} className={`rounded-xl border bg-white p-4 ${o.active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`} data-testid={`offer-${o.id}`}>
                <div className="flex items-start justify-between gap-2"><p className="font-semibold text-slate-900">{o.title}</p>{o.badge && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">{o.badge}</span>}</div>
                {o.description && <p className="mt-1 text-sm text-slate-600">{o.description}</p>}
                <p className="mt-2 text-[11px] text-slate-500">{o.active ? 'Live' : 'Hidden'}{o.valid_till ? ` · till ${fmt(o.valid_till)}` : ''} · {o.system_types?.length ? o.system_types.join(', ') : 'all customers'} · {o.interest_count} interested</p>
                <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => setEdit(o)} className="h-8 gap-1"><Pencil className="h-3.5 w-3.5" />Edit</Button><Button size="sm" variant="ghost" onClick={() => remove(o)} className="h-8 gap-1 text-slate-500"><Trash2 className="h-3.5 w-3.5" />Delete</Button></div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {edit && <OfferDialog offer={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}
