/* AMC page tabs: customers due an AMC offer, and saved quotes. */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BellRing, Check, Clock3, Download, FileSignature, Loader2, MessageCircle, Send, X } from 'lucide-react';
import { amcAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { inr, systemLabel } from './amcCommon';
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
export function OffersTab({ canEdit, onQuote, reloadKey }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => amcAPI.offers().then((r) => setData(r.data)).catch(() => setData({ rows: [] })), []);
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
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">{o.customer_name}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${o.state === 'due' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>{o.state === 'due' ? (o.days_overdue > 0 ? `Due ${o.days_overdue} days ago` : 'Due today') : `Due ${fmt(o.due_on)}`}</span></p>
                  <p className="text-xs text-slate-500">{o.system_capacity_kw} kW {systemLabel(o)} · running since {fmt(o.commissioned_on)} ({o.years} years){o.district ? ` · ${o.district}` : ''}{o.reference_number ? ` · ${o.reference_number}` : ''}</p>
                  {o.quote && <p className="mt-1 text-xs text-emerald-800">Quote {o.quote.number} · {STATUS_LABEL[o.quote.status] || o.quote.status}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {o.phone && <a href={`tel:${o.phone}`} className="inline-flex h-9 items-center rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-700">Call</a>}
                  {canEdit && <Button size="sm" onClick={() => onQuote({ source_type: o.source_type, source_id: o.source_id, customer_name: o.customer_name, phone: o.phone || '', district: o.district || '', system_capacity_kw: o.system_capacity_kw, system_type: o.system_type || 'on-grid', commissioning_date: o.commissioned_on })} className="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" data-testid={`amc-offer-quote-${o.source_id}`}><FileSignature className="h-4 w-4" />{o.quote ? 'New quote' : 'Make quote'}</Button>}
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
export function QuotesTab({ brand, canEdit, reloadKey, onChanged }) {
  const [rows, setRows] = useState(null);
  const [accept, setAccept] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => amcAPI.quotes().then((r) => setRows(r.data)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const pdf = async (q) => {
    setBusy(`pdf-${q.id}`);
    try {
      let cp = { company_name: brand?.company_name };
      try { cp = (await amcAPI.brand()).data || cp; } catch { /* name only */ }   // the company chosen in AMC settings
      await generateAmcQuotePDF({ quote: q, companyProfile: cp });
    } catch (e) { console.error(e); toast.error('Could not make the PDF'); } finally { setBusy(''); }
  };
  const share = (q) => {
    const text = amcQuoteMessage(q, brand?.company_name);
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
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">{q.customer_name}
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
