import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { catalogueAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import AdvancedConfigSection from '../components/AdvancedConfigSection';
import { SlabRatesCard } from '../components/SlabRatesCard';
import {
  Save, Loader2, Plus, Trash2, Edit, Upload,
  Settings2, Fuel, Sprout, Search, Package, Building2, Zap, Target, ChevronDown, ChevronRight
} from 'lucide-react';

const CAT_META = {
  service:   { icon: Settings2, label: 'Services & Rates', color: 'violet', fields: [
    { key: 'name', label: 'Service Name', required: true },
    { key: 'system_type_scope', label: 'System Scope', type: 'select', opts: ['any', 'on-grid', 'off-grid', 'hybrid', 'solar-pump'] },
    { key: 'unit', label: 'Unit', type: 'select', opts: ['per_kw', 'per_unit', 'per_km', 'flat'] },
    { key: 'rate', label: 'Rate ₹', type: 'number', required: true },
    { key: 'margin_pct', label: 'Margin %', type: 'number', required: true, hint: 'Own margin for this service line — no global default' },
    { key: 'gst_pct', label: 'GST %', type: 'number', required: true, hint: 'Own GST rate for this service line (e.g. 18 for installation services)' },
    { key: 'description', label: 'Description' },
  ], summary: (p) => `${p.name} · ${p.unit} · ₹${(p.rate || 0).toLocaleString('en-IN')}${p.gst_pct == null ? ' · GST MISSING' : ` · GST ${p.gst_pct}%`}` },
  fuel:      { icon: Fuel,     label: 'Fuel Types',       color: 'rose', fields: [
    { key: 'name', label: 'Fuel Name', required: true, hint: 'Diesel / Petrol / LPG / Grid Electricity' },
    { key: 'unit', label: 'Unit', type: 'select', opts: ['litre', 'kg', 'scm', 'kWh'] },
    { key: 'energy_content_kwh_per_unit', label: 'Energy content (kWh/unit)', type: 'number', required: true, hint: 'Diesel HHV ≈ 10.7 kWh/L' },
    { key: 'genset_efficiency_pct', label: 'Genset eff %', type: 'number', hint: 'Diesel ~30%, Petrol ~25%' },
    { key: 'default_price_per_unit', label: 'Default Price ₹/unit', type: 'number' },
    { key: 'co2_kg_per_unit', label: 'CO₂ kg/unit', type: 'number' },
    { key: 'source_note', label: 'Source note', type: 'textarea', hint: 'Where did this figure come from?' },
    { key: 'last_reviewed_date', label: 'Last reviewed', type: 'date' },
  ], summary: (p) => `${p.name} · ${p.energy_content_kwh_per_unit} kWh/${p.unit} · ${p.units_per_kwh?.toFixed(3) || '?'} ${p.unit}/kWh · ₹${p.default_price_per_unit}/${p.unit}` },
};
const CAT_ORDER = ['service', 'fuel'];
const SECTION_TITLES = { products: 'Products & Materials', company: 'Company Defaults', solar: 'Solar & Subsidy Rates', targets: 'Targets' };
// Iter 57 — search index: every setting on this page (plus the Pricelist) by plain-language name
const SETTINGS_INDEX = [
  { label: 'Panel / inverter / battery price, margin %, GST % (Pricelist)', section: 'products', href: '/dashboard/pricelist' },
  { label: 'Inventory item GST % and margin %', section: 'products', href: '/dashboard/pricelist' },
  { label: 'Installation & service rates (₹ per kW / km / flat)', section: 'products', advanced: true },
  { label: 'Fuel types (diesel, petrol, LPG) — energy content, price, CO₂', section: 'products', advanced: true },
  { label: 'Rounding of final totals (₹1 / ₹10 / ₹100)', section: 'company' },
  { label: 'Rounding direction (nearest / up / down)', section: 'company' },
  { label: 'Overdue credit interest rate (% per month)', section: 'company' },
  { label: 'Coldest design temperature for string voltage check', section: 'company', advanced: true },
  { label: 'Cost per kWp — on-grid / hybrid / off-grid / solar pump', section: 'solar' },
  { label: 'Slab package rates (₹ per kW / HP / unit by size band, per kit category)', section: 'solar' },
  { label: 'Specific yield default (units per kWp per day)', section: 'solar' },
  { label: 'Battery unit size, benchmark price per kWh', section: 'solar' },
  { label: 'System life, panel degradation % per year', section: 'solar' },
  { label: 'Default electricity tariff per unit', section: 'solar' },
  { label: 'PM Surya Ghar subsidy slabs and cap', section: 'solar' },
  { label: 'PM-KUSUM solar pump benchmark', section: 'solar' },
  { label: 'Diesel price and litres per hour per kW', section: 'solar' },
  { label: 'Pincode / DISCOM database import & backfill', section: 'solar', advanced: true },
  { label: 'Monthly revenue target', section: 'targets' },
  { label: 'Target margin %, minimum acceptable margin %', section: 'targets' },
  { label: 'Collection days, overdue %, on-time delivery %', section: 'targets' },
  { label: 'Conversion % and monthly growth targets', section: 'targets' },
  { label: 'Health score pillar weights and bands (Strong / Healthy / Attention)', section: 'targets' },
  { label: 'Expansion ranking weights (demand, revenue share, growth, margin)', section: 'targets', advanced: true },
];

export default function PricingConfig() {
  const [active, setActive] = useState('service');
  const [q, setQ] = useState('');
  const [openAdv, setOpenAdv] = useState({});
  const navigate = useNavigate();
  const [products, setProducts] = useState({});           // cat -> list
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState(null);
  const [config, setConfig] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, ...lists] = await Promise.all([
        catalogueAPI.getConfig(),
        ...CAT_ORDER.map(cat => catalogueAPI.list(cat)),
      ]);
      setConfig(c.data);
      const p = {};
      CAT_ORDER.forEach((cat, i) => { p[cat] = lists[i].data; });
      setProducts(p);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    if (!window.confirm('Seed generic fallback products & fuel types? (Idempotent — safe to re-run)')) return;
    await catalogueAPI.seed();
    await load();
  };

  const openNew = () => { setEditing({}); setShowEditor(true); };
  const openEdit = (p) => { setEditing(p); setShowEditor(true); };
  const del = async (p) => {
    if (!window.confirm(`Archive ${p.make || p.name || p.model}?`)) return;
    await catalogueAPI.delete(active, p.id);
    await load();
  };

  const saveProduct = async (data) => {
    if (editing?.id) await catalogueAPI.update(active, editing.id, data);
    else await catalogueAPI.create(active, data);
    setShowEditor(false); setEditing(null);
    await load();
  };

  const handleImport = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const r = await catalogueAPI.importCsv(active, f);
      setImportResult(r.data);
      await load();
    } catch (err) { alert(err.response?.data?.detail || 'Import failed'); }
    finally { e.target.value = ''; }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try { const { _id, key, updated_at, ...payload } = config; const r = await catalogueAPI.updateConfig(payload); setConfig(r.data); }
    catch (e) { alert(e.response?.data?.detail || 'Save failed'); } finally { setSavingConfig(false); }
  };

  const currentMeta = CAT_META[active];
  const cfgSet = (k, v) => setConfig(p => ({ ...p, [k]: v }));
  const matches = q.trim() ? SETTINGS_INDEX.filter(x => x.label.toLowerCase().includes(q.trim().toLowerCase())) : [];
  const jump = (m) => { setOpenAdv(o => ({ ...o, [m.section]: true })); setQ(''); setTimeout(() => document.getElementById(`section-${m.section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const renderList = (cat) => (
          <div key={cat} className="space-y-3">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2 font-['Outfit']">
                  {(() => { const I = CAT_META[cat].icon; return <I className={`h-4 w-4 text-${CAT_META[cat].color}-600`} />; })()}
                  {CAT_META[cat].label} <Badge variant="secondary" className="ml-1">{(products[cat] || []).length}</Badge>
                </CardTitle>
                <div className="flex gap-2">
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
                  <Button variant="outline" size="sm" onClick={() => { setActive(cat); fileRef.current?.click(); }} className="gap-1" data-testid={`pricing-import-${cat}`}><Upload className="h-3.5 w-3.5" />Import CSV</Button>
                  <Button size="sm" onClick={() => { setActive(cat); openNew(); }} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid={`pricing-add-${cat}`}><Plus className="h-3.5 w-3.5" />New</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div> :
                  (products[cat] || []).length === 0 ? <p className="text-sm text-slate-400 text-center py-10">No {cat}s yet. Click Seed Generic Fallback or Add New to begin.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                          <tr>
                            <th className="text-left px-3 py-2">Summary</th>
                            <th className="text-left px-3 py-2">Effective From</th>
                            <th className="text-right px-3 py-2">Margin</th>
                            <th className="text-left px-3 py-2">Supplier</th>
                            <th className="text-center px-3 py-2">Status</th>
                            <th className="text-right px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(products[cat] || []).map(p => (
                            <tr key={p.id} className={p.active === false ? 'opacity-40' : 'hover:bg-slate-50'} data-testid={`pricing-row-${p.id}`}>
                              <td className="px-3 py-2 font-medium text-slate-800">{CAT_META[cat].summary(p)}</td>
                              <td className="px-3 py-2 text-xs text-slate-500">{p.effective_from || '—'}</td>
                              <td className="px-3 py-2 text-right text-xs">{p.margin_pct != null ? `${p.margin_pct}%` : '—'}</td>
                              <td className="px-3 py-2 text-xs text-slate-600">{p.supplier || '—'}</td>
                              <td className="px-3 py-2 text-center">{p.active !== false ? <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Active</Badge> : <Badge variant="outline" className="text-[10px]">Archived</Badge>}</td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setActive(cat); openEdit(p); }} data-testid={`pricing-edit-${p.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={() => { setActive(cat); del(p); }} data-testid={`pricing-del-${p.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </CardContent>
            </Card>
            {importResult && (
              <Card className="border-emerald-200 bg-emerald-50/40">
                <CardContent className="p-3 text-xs">
                  <b>Import result:</b> {importResult.inserted} inserted, {importResult.skipped} skipped, total now {importResult.total_after}.
                  {importResult.errors?.length > 0 && <details className="mt-1"><summary>Errors ({importResult.errors.length})</summary><pre className="text-[10px]">{JSON.stringify(importResult.errors, null, 2)}</pre></details>}
                  <Button size="sm" variant="ghost" onClick={() => setImportResult(null)} className="ml-2 h-6">Dismiss</Button>
                </CardContent>
              </Card>
            )}
          </div>
        );


  const Section = ({ id, icon: Icon, title, desc, children, advanced, advancedLabel = 'Advanced settings' }) => (
    <Card id={`section-${id}`} className="border-slate-200 scroll-mt-4" data-testid={`pc-section-${id}`}>
      <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Icon className="h-4 w-4 text-emerald-600" />{title}</CardTitle><p className="text-xs text-slate-500">{desc}</p></CardHeader>
      <CardContent className="space-y-3">
        {children}
        {advanced && (
          <div className="border-t border-dashed border-slate-200 pt-2">
            <button type="button" onClick={() => setOpenAdv(o => ({ ...o, [id]: !o[id] }))} className="text-xs font-medium text-slate-600 hover:text-emerald-700 flex items-center gap-1" data-testid={`pc-advanced-toggle-${id}`}>
              {openAdv[id] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{advancedLabel} <span className="text-slate-400 font-normal">— rarely changed</span>
            </button>
            {openAdv[id] && <div className="mt-3 space-y-3" data-testid={`pc-advanced-${id}`}>{advanced}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4" data-testid="pricing-config-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-['Outfit']">Pricing &amp; Config</h1>
          <p className="text-sm text-slate-500">Four sections. What you change often is on top; rarely-touched constants sit under "Advanced".</p>
        </div>
        <Button onClick={seed} variant="outline" size="sm" className="gap-1.5" data-testid="pricing-seed-btn"><Sprout className="h-4 w-4" />Seed defaults</Button>
      </div>

      <div className="relative" data-testid="pc-search-wrap">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder='Find a setting… e.g. "GST", "rounding", "subsidy", "panel price"' className="pl-9 h-11" data-testid="pc-search" />
        {matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto" data-testid="pc-search-results">
            {matches.slice(0, 12).map((m, i) => (
              <button key={i} type="button" onClick={() => m.href ? navigate(m.href) : jump(m)} className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center justify-between" data-testid={`pc-search-result-${i}`}>
                <span>{m.label}</span><span className="text-[11px] text-slate-400">{SECTION_TITLES[m.section]}{m.advanced ? ' · Advanced' : ''}{m.href ? ' · opens page' : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Section id="products" icon={Package} title="Products &amp; Materials" desc="Panels, inverters, batteries, structure and BOS: price, margin % and GST % per item. Backed directly by Inventory."
        advanced={<>{renderList('service')}{renderList('fuel')}</>} advancedLabel="Service rates & fuel types">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <div><p className="text-sm font-medium text-slate-800">Open the Pricelist</p><p className="text-xs text-slate-500">Edit any product's cost, margin and GST in one table; changes flow to quotes and kits.</p></div>
          <Button size="sm" onClick={() => navigate('/dashboard/pricelist')} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="pc-open-pricelist">Pricelist →</Button>
        </div>
        <p className="text-xs text-slate-500">Installation / service rates (₹ per kW, per km…) and the fuel model used for diesel-vs-solar comparisons live under Advanced below.</p>
      </Section>

      <Section id="company" icon={Building2} title="Company Defaults" desc="Company-wide rules that apply to every quote and report."
        advanced={config && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Coldest design temperature (°C)</Label><Input type="number" value={config.string_low_temp_default_c ?? ''} onChange={e => cfgSet('string_low_temp_default_c', parseFloat(e.target.value))} className="h-9" data-testid="config-string_low_temp_default_c" /><p className="text-[11px] text-slate-500">Used when checking that a panel string's voltage stays within the inverter's limit on the coldest morning. Lower = stricter check.</p></div>
          </div>
        )}>
        {!config ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="rounding-rule-card">
            <div className="space-y-1"><Label className="text-xs">Round final totals to</Label>
              <Select value={String(config.rounding_step ?? 1)} onValueChange={v => cfgSet('rounding_step', parseInt(v))}><SelectTrigger className="h-9" data-testid="rounding-step-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">₹1</SelectItem><SelectItem value="10">₹10</SelectItem><SelectItem value="100">₹100</SelectItem></SelectContent></Select>
              <p className="text-[11px] text-slate-500">Applies only to the grand total of quotes, kits and invoices — never to line prices.</p></div>
            <div className="space-y-1"><Label className="text-xs">Rounding direction</Label>
              <Select value={config.rounding_mode || 'nearest'} onValueChange={v => cfgSet('rounding_mode', v)}><SelectTrigger className="h-9" data-testid="rounding-mode-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nearest">Nearest</SelectItem><SelectItem value="up">Always up</SelectItem><SelectItem value="down">Always down</SelectItem></SelectContent></Select>
              <p className="text-[11px] text-slate-500" data-testid="rounding-example">e.g. ₹1,23,456.70 → ₹{(() => { const st = config.rounding_step || 1, md = config.rounding_mode || 'nearest', v = 123456.7; return (md === 'up' ? Math.ceil(v / st) * st : md === 'down' ? Math.floor(v / st) * st : Math.round(v / st) * st).toLocaleString('en-IN'); })()}</p></div>
            <div className="space-y-1"><Label className="text-xs">Overdue credit interest (% per month)</Label>
              <Input type="number" step="0.1" value={config.credit_interest_monthly_pct ?? ''} onChange={e => cfgSet('credit_interest_monthly_pct', parseFloat(e.target.value))} className="h-9" data-testid="config-credit_interest_monthly_pct" />
              <p className="text-[11px] text-slate-500">What slow-paying customers cost you, shown on the Profit Leakage report. Never added to a customer's bill.</p></div>
          </div>
        )}
        <div className="flex justify-end"><Button onClick={saveConfig} disabled={savingConfig || !config} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid="config-save-btn">{savingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save company defaults</Button></div>
        <p className="text-[11px] text-slate-400">There is no company-wide GST % or margin % — every priced line carries its own, and anything missing is flagged on the Pricelist and in quotes.</p>
      </Section>

      <Section id="solar" icon={Zap} title="Solar &amp; Subsidy Rates" desc="Cost per kW by system type, slab package rates, PM Surya Ghar subsidy slabs, tariff and yield assumptions the calculator uses for every quote."
        advanced={<AdvancedConfigSection only={['utilities']} />} advancedLabel="Pincode / DISCOM data tools">
        <SlabRatesCard />
        <AdvancedConfigSection only={['calc']} />
      </Section>

      <Section id="targets" icon={Target} title="Targets" desc="Revenue, margin, collection and conversion targets that drive the CEO dashboard, health score and expansion ranking."
        advanced={<AdvancedConfigSection only={['expansion']} />} advancedLabel="Expansion scoring weights">
        <AdvancedConfigSection only={['health']} />
      </Section>

      {/* Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={(v) => { if (!v) { setShowEditor(false); setEditing(null); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="pricing-editor">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit' : 'New'} {currentMeta?.label.slice(0, -1)}</DialogTitle></DialogHeader>
          <ProductForm meta={currentMeta} initial={editing} onSave={saveProduct} onCancel={() => { setShowEditor(false); setEditing(null); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductForm({ meta, initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    for (const f of meta.fields) {
      if (f.required && (form[f.key] === undefined || form[f.key] === '')) {
        setErr(`${f.label} is required`); return;
      }
    }
    setErr(''); setSaving(true);
    try { await onSave(form); } catch (e) { setErr(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      {err && <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded">{err}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {meta.fields.map(f => (
          <div key={f.key} className={`space-y-1 ${f.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
            <Label className="text-xs">{f.label}{f.required && ' *'}</Label>
            {f.type === 'select' ? (
              <Select value={form[f.key] ?? ''} onValueChange={(v) => set(f.key, v)}>
                <SelectTrigger className="h-9" data-testid={`ef-${f.key}`}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>{f.opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            ) : f.type === 'bool' ? (
              <div className="flex items-center gap-2 h-9"><Checkbox checked={!!form[f.key]} onCheckedChange={(v) => set(f.key, !!v)} data-testid={`ef-${f.key}`} /><span className="text-xs text-slate-600">Yes</span></div>
            ) : f.type === 'textarea' ? (
              <textarea value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} rows={2} className="w-full min-h-[60px] rounded-md border border-slate-300 px-3 py-2 text-sm" data-testid={`ef-${f.key}`} />
            ) : (
              <Input type={f.type || 'text'} value={form[f.key] ?? ''} onChange={(e) => set(f.key, f.type === 'number' ? (e.target.value === '' ? '' : parseFloat(e.target.value)) : e.target.value)} className="h-9" data-testid={`ef-${f.key}`} />
            )}
            {f.hint && <p className="text-[10px] text-slate-400">{f.hint}</p>}
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid="pricing-save-product">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save
        </Button>
      </DialogFooter>
    </div>
  );
}
