/* Admin-only: AMC settings — the company on AMC documents, offer time, plan rates, benefit assumptions. */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { amcAPI, companyAPI } from '../../utils/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';

const Num = ({ label, value, onChange, unit, step = 1, testid, hint }) => (
  <div className="space-y-1">
    <Label className="text-xs text-slate-700">{label}{unit && <span className="text-slate-400"> ({unit})</span>}</Label>
    <Input type="number" inputMode="decimal" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="h-10" data-testid={testid} />
    {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
  </div>
);

export function AmcSettingsSheet({ open, onOpenChange, onSaved }) {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    if (!open) return;
    amcAPI.settings().then((r) => setS(r.data)).catch(() => toast.error('Could not load AMC settings'));
    companyAPI.getAll().then((r) => setCompanies(r.data || [])).catch(() => setCompanies([]));
  }, [open]);
  const brand = companies.find((c) => c.id === s?.brand_company_id) || companies.find((c) => c.is_active);
  const set = (k) => (v) => setS((x) => ({ ...x, [k]: v }));
  const setPlan = (i, k, v) => setS((x) => ({ ...x, plans: x.plans.map((p, j) => (j === i ? { ...p, [k]: v } : p)) }));
  const save = async () => {
    setSaving(true);
    try { const r = await amcAPI.saveSettings(s); setS(r.data); toast.success('AMC settings saved'); onSaved?.(); onOpenChange(false); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not save'); } finally { setSaving(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-testid="amc-settings-sheet">
        <SheetHeader><SheetTitle>AMC settings</SheetTitle><SheetDescription>When to offer an AMC, what each plan costs and the figures used to show its benefits.</SheetDescription></SheetHeader>
        {!s ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : (
          <div className="space-y-5 py-4">
            <section className="space-y-2" data-testid="amc-set-brand">
              <h3 className="text-sm font-semibold text-slate-900">Company on AMC quotes &amp; reports</h3>
              <p className="text-xs text-slate-500">Its logo, name, address, phone and GSTIN go on every AMC quote, the AMC report and the AMC page.</p>
              <Select value={s.brand_company_id || 'active'} onValueChange={(v) => setS((x) => ({ ...x, brand_company_id: v === 'active' ? null : v }))}>
                <SelectTrigger className="h-11" data-testid="amc-set-brand-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Same as the main company profile</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.company_name}{c.is_active ? ' (main)' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
              {brand && (
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5" data-testid="amc-set-brand-preview">
                  {brand.logo_url ? <img src={brand.logo_url} alt="" className="h-10 w-auto max-w-[120px] object-contain" /> : <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-100"><Building2 className="h-5 w-5 text-slate-400" /></div>}
                  <div className="min-w-0 text-xs"><p className="truncate font-semibold text-slate-900">{brand.company_name}</p><p className="truncate text-slate-500">{[brand.phone, brand.email, brand.gst_number && `GSTIN ${brand.gst_number}`].filter(Boolean).join(' · ')}</p></div>
                </div>
              )}
              <Link to="/dashboard/company-profile" className="inline-block text-xs font-medium text-emerald-700 hover:underline" data-testid="amc-set-brand-new">+ Add a new company (logo &amp; details) in Company profile</Link>
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">When to offer an AMC</h3>
              <div className="grid grid-cols-2 gap-3">
                <Num label="Offer after" unit="years from commissioning" step={0.5} value={s.offer_after_years} onChange={set('offer_after_years')} testid="amc-set-years" hint="Usually when the free service period ends" />
                <Num label="Start showing it" unit="days before" value={s.offer_lead_days} onChange={set('offer_lead_days')} testid="amc-set-lead" />
                <Num label="“Later” hides it for" unit="days" value={s.snooze_days} onChange={set('snooze_days')} />
                <Num label="Quote valid for" unit="days" value={s.quote_valid_days} onChange={set('quote_valid_days')} />
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Plans</h3>
              {s.plans.map((p, i) => (
                <div key={p.key} className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid={`amc-set-plan-${p.key}`}>
                  <Input value={p.name} onChange={(e) => setPlan(i, 'name', e.target.value)} className="h-10 font-semibold" aria-label="Plan name" />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Num label="Rate" unit="₹ per kW a year" value={p.rate_per_kw} onChange={(v) => setPlan(i, 'rate_per_kw', v)} testid={`amc-set-rate-${p.key}`} />
                    <Num label="Minimum" unit="₹ a year" value={p.min_per_year} onChange={(v) => setPlan(i, 'min_per_year', v)} />
                    <Num label="Visits a year" value={p.visits_per_year} onChange={(v) => setPlan(i, 'visits_per_year', v)} />
                    <Num label="Breakdown visit within" unit="hours" value={p.response_hours} onChange={(v) => setPlan(i, 'response_hours', v)} />
                    <Num label="Loss it prevents" unit="%" value={p.recovers_pct} onChange={(v) => setPlan(i, 'recovers_pct', v)} hint="of the power lost without care" />
                  </div>
                  <div className="space-y-1"><Label className="text-xs text-slate-700">What's included <span className="text-slate-400">(one per line)</span></Label>
                    <textarea rows={4} value={(p.includes || []).join('\n')} onChange={(e) => setPlan(i, 'includes', e.target.value.split('\n'))} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></div>
                </div>
              ))}
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Figures behind the benefits</h3>
              <div className="grid grid-cols-2 gap-3">
                <Num label="Power made" unit="units per kW a year" value={s.units_per_kw_year} onChange={set('units_per_kw_year')} />
                <Num label="Lost without care" unit="%" value={s.loss_without_amc_pct} onChange={set('loss_without_amc_pct')} />
                <Num label="Default tariff" unit="₹/unit" step={0.5} value={s.default_tariff} onChange={set('default_tariff')} />
                <Num label="GST on AMC" unit="%" value={s.gst_pct} onChange={set('gst_pct')} />
                <Num label="Life without care" unit="years" value={s.life_without_amc_years} onChange={set('life_without_amc_years')} />
                <Num label="Life with care" unit="years" value={s.life_with_amc_years} onChange={set('life_with_amc_years')} />
              </div>
            </section>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white py-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="amc-set-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
