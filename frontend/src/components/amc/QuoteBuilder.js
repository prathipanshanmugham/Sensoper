/* Make an AMC quote: pick the customer (an offer, one of our finished projects, or someone new),
 * check the plant details, and see Basic / Standard / Premium side by side with what each one protects. */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { amcAPI, projectsAPI } from '../../utils/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { inr, SYSTEM_TYPE_OPTIONS } from './amcCommon';

const blank = { source_type: 'manual', source_id: null, customer_name: '', phone: '', site_address: '', district: '', system_type: 'on-grid', system_type_other: '', system_capacity_kw: '', commissioning_date: '', tariff: '', notes: '', terms_text: '', recommended_plan: 'standard' };

export function PlanCards({ calc, recommended, onRecommend, chosen, onChoose, compact }) {
  if (!calc?.plans?.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="amc-plan-cards">
      {calc.plans.map((p) => {
        const rec = p.key === recommended;
        const sel = chosen === p.key;
        return (
          <div key={p.key} className={`relative flex flex-col rounded-xl border p-3 ${sel ? 'border-emerald-500 ring-2 ring-emerald-200' : rec ? 'border-emerald-300' : 'border-slate-200'} bg-white`} data-testid={`amc-plan-${p.key}`}>
            {rec && <span className="absolute -top-2.5 left-3 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white"><Star className="h-3 w-3" />Recommended</span>}
            <p className="font-['Outfit'] text-base font-semibold text-slate-900">{p.name}</p>
            <p className="mt-1 font-['Outfit'] text-2xl font-bold text-slate-900" data-testid={`amc-plan-${p.key}-total`}>{inr(p.total)}<span className="text-xs font-normal text-slate-500"> / year</span></p>
            <p className="text-[11px] text-slate-500">{inr(p.price)} + GST {p.gst_pct}% · about {inr(p.per_month)} a month</p>
            <div className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-900">
              Protects about <b>{p.units_protected.toLocaleString('en-IN')} units</b> ({inr(p.value_protected)}) a year{p.return_per_rupee >= 1 && <> · <b>₹{p.return_per_rupee.toFixed(2)}</b> back for every ₹1</>}
            </div>
            {!compact && (
              <ul className="mt-2 space-y-1 text-xs text-slate-700">
                <li className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{p.visits_per_year} service visits a year</li>
                <li className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />Breakdown visit within {p.response_hours} hours</li>
                {p.includes.map((t) => <li key={t} className="flex gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{t}</li>)}
              </ul>
            )}
            <div className="mt-auto pt-3">
              {onChoose ? (
                <Button type="button" size="sm" variant={sel ? 'default' : 'outline'} onClick={() => onChoose(p.key)} className={`h-9 w-full ${sel ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`} data-testid={`amc-plan-${p.key}-choose`}>{sel ? 'Chosen' : 'Choose'}</Button>
              ) : onRecommend && !rec ? (
                <button type="button" onClick={() => onRecommend(p.key)} className="text-[11px] font-medium text-slate-500 hover:text-emerald-700" data-testid={`amc-plan-${p.key}-recommend`}>Mark as recommended</button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LifeStrip({ calc }) {
  if (!calc || !(calc.kw > 0)) return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-center" data-testid="amc-life-strip">
      <div className="rounded-lg border border-slate-200 bg-white p-2"><p className="font-['Outfit'] text-base font-bold text-slate-900">{calc.annual_generation.toLocaleString('en-IN')}</p><p className="text-[10px] text-slate-500">units a year</p></div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2"><p className="font-['Outfit'] text-base font-bold text-amber-900">{inr(calc.value_at_risk)}</p><p className="text-[10px] text-amber-800">at risk a year without care</p></div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2"><p className="font-['Outfit'] text-base font-bold text-emerald-900">+{calc.extra_years} years</p><p className="text-[10px] text-emerald-800">longer life — about {inr(calc.extra_life_value)} more power</p></div>
    </div>
  );
}

export default function QuoteBuilder({ open, onOpenChange, prefill, onSaved }) {
  const [f, setF] = useState(blank);
  const [who, setWho] = useState('manual');           // project | manual
  const [projects, setProjects] = useState([]);
  const [calc, setCalc] = useState(null);
  const [saving, setSaving] = useState(false);
  const [terms, setTerms] = useState({ default_text: '', templates: [] });
  const [termsOpen, setTermsOpen] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));

  useEffect(() => {
    if (!open) return;
    const start = { ...blank, ...(prefill || {}) };
    setF(start); setWho(start.source_type || 'manual'); setCalc(null); setTermsOpen(false);
    amcAPI.quoteTerms().then((r) => { setTerms(r.data); setF((x) => ({ ...x, terms_text: x.terms_text || r.data.default_text || '' })); }).catch(() => {});
    projectsAPI.getAll('completed').then((r) => setProjects(r.data || [])).catch(() => {});
  }, [open, prefill]);

  const fromProject = async (id) => {
    const slim = projects.find((x) => x.id === id);
    setF((x) => ({ ...x, source_type: 'project', source_id: id, customer_name: slim?.customer?.name || '', system_capacity_kw: slim?.system_size_kw || '' }));
    try {
      const p = (await projectsAPI.getOne(id)).data;
      const ps = p.custom_fields?.proposed_solution || {};
      setF((x) => (x.source_id !== id ? x : { ...x, customer_name: p.customer?.name || '', phone: p.customer?.phone || '', site_address: p.customer?.address || p.location?.address || '',
        district: p.location?.district || '', system_type: ps.system_type || 'on-grid', system_capacity_kw: ps.system_size_kw || slim?.system_size_kw || '',
        system_type_other: '', commissioning_date: (p.commissioning_date || p.completed_at || '').slice(0, 10), tariff: ps.tariff_per_unit || p.electrical?.eb_tariff || '' }));
    } catch { /* the slim row is enough to quote */ }
  };

  // live price of the three plans
  useEffect(() => {
    if (!open) return undefined;
    const kw = parseFloat(f.system_capacity_kw);
    if (!(kw > 0)) { setCalc(null); return undefined; }
    const t = setTimeout(() => { amcAPI.quotePreview({ system_capacity_kw: kw, tariff: parseFloat(f.tariff) || null }).then((r) => setCalc(r.data)).catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [open, f.system_capacity_kw, f.tariff]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...f, source_type: who === 'manual' ? 'manual' : f.source_type, source_id: who === 'manual' ? null : f.source_id,
        system_capacity_kw: parseFloat(f.system_capacity_kw) || 0, tariff: parseFloat(f.tariff) || null, commissioning_date: f.commissioning_date || null,
        system_type_other: f.system_type === 'others' ? f.system_type_other.trim() : null, terms_text: f.terms_text.trim() || null };
      const r = await amcAPI.createQuote(body);
      toast.success(`Quote ${r.data.quote_number} saved`);
      onSaved?.(r.data);
      onOpenChange(false);
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not save the quote'); } finally { setSaving(false); }
  };

  const choices = [['project', 'Our customer'], ['manual', 'Someone new']];
  const fromOffer = !!prefill?.source_id;
  const ready = f.customer_name.trim() && parseFloat(f.system_capacity_kw) > 0 && (who === 'manual' || f.source_id) && (f.system_type !== 'others' || f.system_type_other.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" data-testid="amc-quote-builder">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" />New AMC quote</DialogTitle>
          <DialogDescription>Three plans side by side, priced for this plant, with how each one protects its power and life.</DialogDescription>
        </DialogHeader>

        {!fromOffer && (
          <div className="space-y-2">
            <Label className="text-xs text-slate-700">Who is it for?</Label>
            <div className={`grid gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm ${choices.length === 3 ? "grid-cols-3" : "grid-cols-2"}`} role="group">
              {choices.map(([k, l]) => (
                <button key={k} type="button" onClick={() => { setWho(k); setF((x) => ({ ...blank, recommended_plan: x.recommended_plan, terms_text: x.terms_text, source_type: k })); }} aria-pressed={who === k}
                  className={`rounded-md px-2 py-2 font-medium ${who === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`} data-testid={`amc-quote-who-${k}`}>{l}</button>
              ))}
            </div>
            {who === 'project' && (
              <Select value={f.source_id || ''} onValueChange={fromProject}>
                <SelectTrigger className="h-11" data-testid="amc-quote-project"><SelectValue placeholder={projects.length ? 'Choose a finished project' : 'No finished projects yet'} /></SelectTrigger>
                <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.customer?.name} — {p.reference_number}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        )}
        {fromOffer && <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><Sparkles className="h-4 w-4" />Quote for <b>{f.customer_name}</b></p>}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="col-span-2 space-y-1"><Label className="text-xs">Customer name *</Label><Input value={f.customer_name} onChange={set('customer_name')} className="h-11" data-testid="amc-quote-name" /></div>
          <div className="col-span-2 space-y-1 sm:col-span-1"><Label className="text-xs">Phone</Label><Input type="tel" value={f.phone} onChange={set('phone')} className="h-11" data-testid="amc-quote-phone" /></div>
          <div className="col-span-2 space-y-1 sm:col-span-1"><Label className="text-xs">District</Label><Input value={f.district} onChange={set('district')} className="h-11" /></div>
          <div className="space-y-1"><Label className="text-xs">Plant size (kW) *</Label><Input type="number" inputMode="decimal" min="0" step="0.5" value={f.system_capacity_kw} onChange={set('system_capacity_kw')} className="h-11" data-testid="amc-quote-kw" /></div>
          <div className="space-y-1"><Label className="text-xs">Type</Label>
            <Select value={f.system_type || 'on-grid'} onValueChange={set('system_type')}><SelectTrigger className="h-11" data-testid="amc-quote-type"><SelectValue /></SelectTrigger><SelectContent>{SYSTEM_TYPE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Running since</Label><Input type="date" value={f.commissioning_date || ''} onChange={set('commissioning_date')} className="h-11" data-testid="amc-quote-commissioned" /></div>
          <div className="space-y-1"><Label className="text-xs">Tariff (₹/unit)</Label><Input type="number" inputMode="decimal" min="0" step="0.5" value={f.tariff} onChange={set('tariff')} placeholder="8" className="h-11" data-testid="amc-quote-tariff" /></div>
          {f.system_type === 'others' && <div className="col-span-2 space-y-1 sm:col-span-4"><Label className="text-xs">What system is it? *</Label><Input value={f.system_type_other} onChange={set('system_type_other')} placeholder="e.g. UPS, street lights, EV charger" className="h-11" data-testid="amc-quote-type-other" /></div>}
          <div className="col-span-2 space-y-1 sm:col-span-4"><Label className="text-xs">Site address</Label><Input value={f.site_address} onChange={set('site_address')} className="h-11" /></div>
        </div>

        {calc ? (
          <div className="space-y-3">
            <LifeStrip calc={calc} />
            <PlanCards calc={calc} recommended={f.recommended_plan} onRecommend={(k) => setF((x) => ({ ...x, recommended_plan: k }))} />
          </div>
        ) : <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">Enter the plant size to see the three plans.</p>}

        <div className="space-y-1"><Label className="text-xs">Notes on the quote (optional)</Label>
          <textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="e.g. First cleaning within 7 days of signing" className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" data-testid="amc-quote-notes" /></div>
        <div className="rounded-lg border border-slate-200" data-testid="amc-quote-terms">
          <button type="button" onClick={() => setTermsOpen((v) => !v)} aria-expanded={termsOpen} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left" data-testid="amc-quote-terms-toggle">
            <span className="text-sm font-medium text-slate-800">Terms &amp; conditions <span className="font-normal text-slate-500">— {f.terms_text.trim() ? `${f.terms_text.trim().split('\n').filter(Boolean).length} lines, printed on the quote` : 'none'}</span></span>
            <span className="text-xs font-medium text-emerald-700">{termsOpen ? 'Done' : 'Edit'}</span>
          </button>
          {termsOpen && (
            <div className="space-y-2 border-t border-slate-200 p-3">
              {terms.templates.length > 0 && (
                <Select onValueChange={(id) => { const t = terms.templates.find((x) => x.id === id); if (t) setF((x) => ({ ...x, terms_text: t.text })); }}>
                  <SelectTrigger className="h-10" data-testid="amc-quote-terms-template"><SelectValue placeholder="Use a saved AMC terms template…" /></SelectTrigger>
                  <SelectContent>{terms.templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}{t.is_active ? ' (active)' : ''}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <textarea rows={8} value={f.terms_text} onChange={set('terms_text')} className="w-full rounded-md border border-slate-200 p-2 font-mono text-xs leading-relaxed outline-none focus:border-emerald-400" data-testid="amc-quote-terms-text" />
              <div className="flex justify-between text-[11px] text-slate-500"><span>One term per line. Change it just for this quote, or save templates in Terms &amp; conditions (type AMC).</span>
                <button type="button" onClick={() => setF((x) => ({ ...x, terms_text: terms.default_text }))} className="shrink-0 font-medium text-slate-600 hover:text-slate-900">Reset</button></div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!ready || saving} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="amc-quote-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save quote'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
