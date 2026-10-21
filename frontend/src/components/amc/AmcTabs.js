/* AMC page tabs: customers due an AMC offer, saved quotes, and the joint-venture partner's own projects. */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BellRing, CalendarClock, Check, Clock3, Download, FileSignature, Loader2, MessageCircle, Pencil, Plus, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { amcAPI, companyAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import PhotoStrip from '../PhotoStrip';
import { ALL, OURS, OrgChip, imageDataUrl, inr, logoUrl } from './jv';
import { PlanCards } from './QuoteBuilder';
import { amcQuoteMessage, generateAmcQuotePDF } from '../../utils/amcPdf';

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS = { draft: 'bg-slate-100 text-slate-700', sent: 'bg-sky-50 text-sky-800', accepted: 'bg-emerald-50 text-emerald-800', declined: 'bg-rose-50 text-rose-700' };
const STATUS_LABEL = { draft: 'Not sent', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' };

function Empty({ icon: Icon, title, text }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
      <Icon className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-2 text-sm font-medium text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">{text}</p>
    </div>
  );
}

// ───────────────────────── Offers ─────────────────────────
export function OffersTab({ jv, org, canEdit, onQuote, reloadKey }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => amcAPI.offers({ org: jv?.is_partner ? ALL : org }).then((r) => setData(r.data)).catch(() => setData({ rows: [] })), [org, jv?.is_partner]);
  useEffect(() => { load(); }, [load, reloadKey]);
  const flag = async (o, action) => {
    try { await amcAPI.flagOffer(o.source_type, o.source_id, action); toast.success(action === 'later' ? 'We will remind you later' : 'Marked not interested'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not update'); }
  };
  if (!data) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  return (
    <div className="space-y-3" data-testid="amc-offers-tab">
      <p className="text-sm text-slate-600">Customers whose plant is <b>{data.offer_after_years} years</b> old (or will be within {data.offer_lead_days} days) and who have no AMC yet. Change the time in AMC settings.</p>
      {data.rows.length === 0 ? <Empty icon={BellRing} title="No one to offer an AMC right now" text="When a finished plant reaches the offer age, the customer shows up here, on Home and in the bell." /> : (
        <ul className="space-y-2">
          {data.rows.map((o) => (
            <li key={`${o.source_type}-${o.source_id}`} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`amc-offer-${o.source_id}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">{o.customer_name}<OrgChip jv={jv} orgId={o.org_id} />
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${o.state === 'due' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>{o.state === 'due' ? (o.days_overdue > 0 ? `Due ${o.days_overdue} days ago` : 'Due today') : `Due ${fmt(o.due_on)}`}</span></p>
                  <p className="text-xs text-slate-500">{o.system_capacity_kw} kW {o.system_type} · running since {fmt(o.commissioned_on)} ({o.years} years){o.district ? ` · ${o.district}` : ''}{o.reference_number ? ` · ${o.reference_number}` : ''}</p>
                  {o.quote && <p className="mt-1 text-xs text-emerald-800">Quote {o.quote.number} · {STATUS_LABEL[o.quote.status] || o.quote.status}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {o.phone && <a href={`tel:${o.phone}`} className="inline-flex h-9 items-center rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-700">Call</a>}
                  {canEdit && <Button size="sm" onClick={() => onQuote({ source_type: o.source_type, source_id: o.source_id, org_id: o.org_id, customer_name: o.customer_name, phone: o.phone || '', district: o.district || '', system_capacity_kw: o.system_capacity_kw, system_type: o.system_type || 'on-grid', commissioning_date: o.commissioned_on })} className="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" data-testid={`amc-offer-quote-${o.source_id}`}><FileSignature className="h-4 w-4" />{o.quote ? 'New quote' : 'Make quote'}</Button>}
                  {canEdit && <Button size="sm" variant="ghost" onClick={() => flag(o, 'later')} className="h-9 gap-1 text-slate-600" data-testid={`amc-offer-later-${o.source_id}`}><Clock3 className="h-4 w-4" />Later</Button>}
                  {canEdit && <Button size="sm" variant="ghost" onClick={() => flag(o, 'not_interested')} className="h-9 text-slate-500" data-testid={`amc-offer-no-${o.source_id}`}><X className="h-4 w-4" /></Button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── Quotes ─────────────────────────
export function QuotesTab({ jv, org, canEdit, reloadKey, onChanged }) {
  const [rows, setRows] = useState(null);
  const [accept, setAccept] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => amcAPI.quotes({ org: jv?.is_partner ? undefined : org }).then((r) => setRows(r.data)).catch(() => setRows([])), [org, jv?.is_partner]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const partnerOf = (q) => (q.org_id ? (jv?.partners || []).find((p) => p.id === q.org_id) || { id: q.org_id, name: q.org_name, logo_path: q.org_logo_path } : null);
  const pdf = async (q) => {
    setBusy(`pdf-${q.id}`);
    try {
      let cp = { company_name: jv?.ours?.name };
      if (!jv?.is_partner) { try { cp = (await companyAPI.getActive()).data || cp; } catch { /* name only */ } }
      const partner = partnerOf(q);
      const partnerLogo = partner?.logo_path ? await imageDataUrl(logoUrl(partner.logo_path)) : null;
      await generateAmcQuotePDF({ quote: q, companyProfile: cp, partner, partnerLogo });
    } catch (e) { console.error(e); toast.error('Could not make the PDF'); } finally { setBusy(''); }
  };
  const share = (q) => {
    const text = amcQuoteMessage(q, partnerOf(q));
    const phone = String(q.phone || '').replace(/\D/g, '');
    window.open(`https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  const status = async (q, s) => {
    try { await amcAPI.quoteStatus(q.id, s); toast.success(s === 'sent' ? 'Marked as sent' : 'Marked as declined'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not update'); }
  };
  const doAccept = async () => {
    setBusy('accept');
    try {
      const r = await amcAPI.acceptQuote(accept.q.id, { plan_key: accept.plan, start_date: accept.start, duration_months: 12 });
      toast.success(`Contract ${r.data.contract.contract_number} created`);
      setAccept(null); load(); onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not create the contract'); } finally { setBusy(''); }
  };

  if (!rows) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  return (
    <div className="space-y-2" data-testid="amc-quotes-tab">
      {rows.length === 0 ? <Empty icon={FileSignature} title="No AMC quotes yet" text="Make one from “Time to offer AMC”, or with the New quote button." /> : rows.map((q) => {
        const rec = q.calc?.plans?.find((p) => p.key === (q.accepted_plan || q.recommended_plan));
        return (
          <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`amc-quote-row-${q.id}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">{q.customer_name}<OrgChip jv={jv} orgId={q.org_id} />
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[q.status]}`} data-testid={`amc-quote-status-${q.id}`}>{STATUS_LABEL[q.status] || q.status}</span></p>
                <p className="text-xs text-slate-500">{q.quote_number} · {fmt(q.created_at)} · {q.system_capacity_kw} kW · {q.status === 'accepted' ? `${rec?.name} plan → ${q.contract_number}` : `${rec?.name || ''} ${inr(rec?.total)}/year`}{q.status !== 'accepted' && q.valid_until ? ` · valid until ${fmt(q.valid_until)}` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => pdf(q)} disabled={busy === `pdf-${q.id}`} data-testid={`amc-quote-pdf-${q.id}`}>{busy === `pdf-${q.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF</Button>
                {q.phone && <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => share(q)} data-testid={`amc-quote-wa-${q.id}`}><MessageCircle className="h-4 w-4" />WhatsApp</Button>}
                {canEdit && q.status === 'draft' && <Button size="sm" variant="ghost" className="h-9 gap-1" onClick={() => status(q, 'sent')} data-testid={`amc-quote-sent-${q.id}`}><Send className="h-4 w-4" />Sent</Button>}
                {canEdit && !['accepted', 'declined'].includes(q.status) && <Button size="sm" className="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setAccept({ q, plan: q.recommended_plan || 'standard', start: new Date().toISOString().slice(0, 10) })} data-testid={`amc-quote-accept-${q.id}`}><Check className="h-4 w-4" />Customer said yes</Button>}
                {canEdit && !['accepted', 'declined'].includes(q.status) && <Button size="sm" variant="ghost" className="h-9 text-slate-500" onClick={() => status(q, 'declined')} data-testid={`amc-quote-decline-${q.id}`}>Said no</Button>}
              </div>
            </div>
          </div>
        );
      })}
      <Dialog open={!!accept} onOpenChange={(v) => !v && setAccept(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" data-testid="amc-accept-dialog">
          <DialogHeader><DialogTitle>Which plan did {accept?.q.customer_name} choose?</DialogTitle><DialogDescription>We will create the AMC contract with this plan's price, visits and inclusions.</DialogDescription></DialogHeader>
          {accept && <PlanCards calc={accept.q.calc} recommended={accept.q.recommended_plan} chosen={accept.plan} onChoose={(k) => setAccept((a) => ({ ...a, plan: k }))} compact />}
          {accept && <div className="max-w-xs space-y-1"><Label className="text-xs">Contract starts on</Label><Input type="date" value={accept.start} onChange={(e) => setAccept((a) => ({ ...a, start: e.target.value }))} className="h-11" data-testid="amc-accept-start" /></div>}
          <DialogFooter><Button variant="outline" onClick={() => setAccept(null)}>Cancel</Button><Button onClick={doAccept} disabled={busy === 'accept'} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="amc-accept-confirm">{busy === 'accept' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create contract'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────── Partner projects ─────────────────────────
const TYPES = [['on-grid', 'On-grid'], ['hybrid', 'Hybrid'], ['off-grid', 'Off-grid'], ['solar-pump', 'Solar pump']];
const blankProject = { org_id: '', customer_name: '', phone: '', site_address: '', district: '', state: '', pincode: '', system_type: 'on-grid', system_capacity_kw: '', commissioning_date: '', tariff: '', notes: '', photos: [] };

export function JvProjectsTab({ jv, org, canEdit, reloadKey, onChanged }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => amcAPI.jvProjects({ org: jv?.is_partner ? undefined : (org === OURS ? ALL : org) }).then((r) => setRows(r.data)).catch(() => setRows([])), [org, jv?.is_partner]);
  useEffect(() => { load(); }, [load, reloadKey]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, system_capacity_kw: parseFloat(form.system_capacity_kw) || 0, tariff: parseFloat(form.tariff) || null, commissioning_date: form.commissioning_date || null, org_id: jv?.is_partner ? null : form.org_id };
      if (form.id) await amcAPI.updateJvProject(form.id, body); else await amcAPI.createJvProject(body);
      toast.success('Saved'); setForm(null); load(); onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail?.[0]?.msg || e.response?.data?.detail || 'Could not save'); } finally { setSaving(false); }
  };
  const remove = async (p) => {
    if (!window.confirm(`Remove ${p.customer_name}?`)) return;
    try { await amcAPI.deleteJvProject(p.id); load(); } catch (e) { toast.error(e.response?.data?.detail || 'Could not remove'); }
  };
  const contract = async (p) => {
    try { const r = await amcAPI.contractFromJvProject(p.id); toast.success(`Contract ${r.data.contract_number} created (Standard plan)`); load(); onChanged?.(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not create the contract'); }
  };
  const firstPartner = jv?.partners?.[0]?.id || '';
  if (!rows) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  return (
    <div className="space-y-3" data-testid="amc-jv-projects-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-slate-600">{jv?.is_partner ? 'Plants your company installed. They are kept separate from Sensoper’s projects and never count towards Sensoper’s targets.' : 'Plants our joint-venture partner installed. They are kept apart from our projects and never count towards our targets or numbers.'}</p>
        {canEdit && <Button onClick={() => setForm({ ...blankProject, org_id: (org !== ALL && org !== OURS ? org : firstPartner) })} className="h-10 gap-1.5 bg-violet-600 text-white hover:bg-violet-700" data-testid="amc-jv-add"><Plus className="h-4 w-4" />Add partner project</Button>}
      </div>
      {rows.length === 0 ? <Empty icon={ShieldCheck} title="No partner projects yet" text="Add the plants the partner company installed — each one can then get an AMC and shows up for an AMC offer when it's due." /> : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {rows.map((p) => (
            <div key={p.id} className="flex gap-3 rounded-xl border border-violet-200 bg-white p-3" data-testid={`amc-jv-project-${p.id}`}>
              {p.photos?.[0] ? <img src={logoUrl(p.photos[0])} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-400"><ShieldCheck className="h-6 w-6" /></div>}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">{p.customer_name}<OrgChip jv={jv} orgId={p.org_id} />{p.has_active_amc && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">AMC active</span>}</p>
                <p className="text-xs text-slate-500">{p.system_capacity_kw} kW {p.system_type}{p.commissioning_date ? ` · since ${fmt(p.commissioning_date)}` : ''}{p.district ? ` · ${p.district}` : ''}</p>
                {canEdit && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!p.has_active_amc && <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => contract(p)} data-testid={`amc-jv-contract-${p.id}`}><CalendarClock className="h-3.5 w-3.5" />Start AMC</Button>}
                    <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setForm({ ...blankProject, ...p, tariff: p.tariff ?? '', commissioning_date: p.commissioning_date || '' })} data-testid={`amc-jv-edit-${p.id}`}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-rose-600" onClick={() => remove(p)} data-testid={`amc-jv-delete-${p.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="amc-jv-form">
          <DialogHeader><DialogTitle>{form?.id ? 'Edit partner project' : 'Add partner project'}</DialogTitle><DialogDescription>A plant the partner company built. It stays separate from Sensoper’s projects.</DialogDescription></DialogHeader>
          {form && (
            <div className="grid grid-cols-2 gap-2">
              {!jv?.is_partner && (jv?.partners?.length > 1) && (
                <div className="col-span-2 space-y-1"><Label className="text-xs">Partner company</Label>
                  <Select value={form.org_id || ''} onValueChange={set('org_id')}><SelectTrigger className="h-11"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent>{jv.partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              )}
              <div className="col-span-2 space-y-1"><Label className="text-xs">Customer name *</Label><Input value={form.customer_name} onChange={set('customer_name')} className="h-11" data-testid="amc-jv-name" /></div>
              <div className="space-y-1"><Label className="text-xs">Phone</Label><Input type="tel" value={form.phone || ''} onChange={set('phone')} className="h-11" /></div>
              <div className="space-y-1"><Label className="text-xs">District</Label><Input value={form.district || ''} onChange={set('district')} className="h-11" /></div>
              <div className="col-span-2 space-y-1"><Label className="text-xs">Site address</Label><Input value={form.site_address || ''} onChange={set('site_address')} className="h-11" /></div>
              <div className="space-y-1"><Label className="text-xs">Plant size (kW) *</Label><Input type="number" inputMode="decimal" min="0" step="0.5" value={form.system_capacity_kw} onChange={set('system_capacity_kw')} className="h-11" data-testid="amc-jv-kw" /></div>
              <div className="space-y-1"><Label className="text-xs">Type</Label><Select value={form.system_type} onValueChange={set('system_type')}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label className="text-xs">Running since</Label><Input type="date" max={new Date().toISOString().slice(0, 10)} value={form.commissioning_date || ''} onChange={set('commissioning_date')} className="h-11" data-testid="amc-jv-date" /></div>
              <div className="space-y-1"><Label className="text-xs">Tariff (₹/unit)</Label><Input type="number" inputMode="decimal" value={form.tariff ?? ''} onChange={set('tariff')} placeholder="8" className="h-11" /></div>
              <div className="col-span-2"><PhotoStrip value={form.photos || []} onChange={(photos) => setForm((f) => ({ ...f, photos }))} max={6} testid="amc-jv-photos" label="Photos of the plant" /></div>
              <div className="col-span-2 space-y-1"><Label className="text-xs">Notes</Label><Input value={form.notes || ''} onChange={set('notes')} className="h-11" /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save} disabled={saving || !form?.customer_name || !(parseFloat(form?.system_capacity_kw) > 0) || (!jv?.is_partner && !form?.org_id)} className="bg-violet-600 text-white hover:bg-violet-700" data-testid="amc-jv-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
