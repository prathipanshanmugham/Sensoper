import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { catalogueAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import AdvancedConfigSection from '../components/AdvancedConfigSection';
import {
  ArrowLeft, Save, Loader2, Plus, Trash2, Edit, Upload,
  Settings2, Fuel, Sprout
} from 'lucide-react';

const CAT_META = {
  service:   { icon: Settings2, label: 'Services & Rates', color: 'violet', fields: [
    { key: 'name', label: 'Service Name', required: true },
    { key: 'system_type_scope', label: 'System Scope', type: 'select', opts: ['any', 'on-grid', 'off-grid', 'hybrid', 'solar-pump'] },
    { key: 'unit', label: 'Unit', type: 'select', opts: ['per_kw', 'per_unit', 'per_km', 'flat'] },
    { key: 'rate', label: 'Rate ₹', type: 'number', required: true },
    { key: 'description', label: 'Description' },
  ], summary: (p) => `${p.name} · ${p.unit} · ₹${(p.rate || 0).toLocaleString('en-IN')}` },
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

export default function PricingConfig() {
  const [active, setActive] = useState('service');
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
    try { const r = await catalogueAPI.updateConfig(config); setConfig(r.data); }
    catch (e) { alert('Save failed'); } finally { setSavingConfig(false); }
  };

  const currentList = products[active] || [];
  const currentMeta = CAT_META[active];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold font-['Outfit']">Pricing & Config</h1>
            <p className="text-sm text-slate-500">Service rates, fuel model, add-on groups and calculator constants. Panel/inverter/battery/pump/structure pricing lives on the <Link to="/dashboard/pricelist" className="underline">Pricelist</Link> tab now, backed directly by Inventory.</p>
          </div>
        </div>
        <Button onClick={seed} variant="outline" className="gap-1.5" data-testid="pricing-seed-btn">
          <Sprout className="h-4 w-4" />Seed Defaults
        </Button>
      </div>

      <Tabs value={active} onValueChange={setActive}>
        <TabsList className="grid grid-cols-3 h-auto p-1" data-testid="pricing-tabs">
          {CAT_ORDER.map(cat => {
            const m = CAT_META[cat]; const Icon = m.icon;
            return (
              <TabsTrigger key={cat} value={cat} className="gap-1.5 py-2" data-testid={`pricing-tab-${cat}`}>
                <Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{m.label}</span>
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="defaults" className="gap-1.5 py-2" data-testid="pricing-tab-defaults">
            <Settings2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Global Defaults</span>
          </TabsTrigger>
        </TabsList>

        {CAT_ORDER.map(cat => (
          <TabsContent key={cat} value={cat} className="space-y-3">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2 font-['Outfit']">
                  {(() => { const I = CAT_META[cat].icon; return <I className={`h-4 w-4 text-${CAT_META[cat].color}-600`} />; })()}
                  {CAT_META[cat].label} <Badge variant="secondary" className="ml-1">{(products[cat] || []).length}</Badge>
                </CardTitle>
                <div className="flex gap-2">
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1" data-testid={`pricing-import-${cat}`}><Upload className="h-3.5 w-3.5" />Import CSV</Button>
                  <Button size="sm" onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid={`pricing-add-${cat}`}><Plus className="h-3.5 w-3.5" />New</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div> :
                  currentList.length === 0 ? <p className="text-sm text-slate-400 text-center py-10">No {cat}s yet. Click Seed Generic Fallback or Add New to begin.</p> : (
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
                          {currentList.map(p => (
                            <tr key={p.id} className={p.active === false ? 'opacity-40' : 'hover:bg-slate-50'} data-testid={`pricing-row-${p.id}`}>
                              <td className="px-3 py-2 font-medium text-slate-800">{CAT_META[cat].summary(p)}</td>
                              <td className="px-3 py-2 text-xs text-slate-500">{p.effective_from || '—'}</td>
                              <td className="px-3 py-2 text-right text-xs">{p.margin_pct != null ? `${p.margin_pct}%` : '—'}</td>
                              <td className="px-3 py-2 text-xs text-slate-600">{p.supplier || '—'}</td>
                              <td className="px-3 py-2 text-center">{p.active !== false ? <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Active</Badge> : <Badge variant="outline" className="text-[10px]">Archived</Badge>}</td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)} data-testid={`pricing-edit-${p.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={() => del(p)} data-testid={`pricing-del-${p.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
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
          </TabsContent>
        ))}

        {/* Global Defaults */}
        <TabsContent value="defaults" className="space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit']">Global Defaults & Calculator Constants</CardTitle></CardHeader>
            <CardContent>
              {!config ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {Object.entries(config).filter(([k]) => !['_id', 'key', 'updated_at'].includes(k)).map(([k, v]) => (
                    <div key={k} className="space-y-1">
                      <Label className="text-xs capitalize">{k.replace(/_/g, ' ')}</Label>
                      <Input value={v ?? ''} onChange={(e) => setConfig(p => ({ ...p, [k]: isNaN(parseFloat(e.target.value)) ? e.target.value : parseFloat(e.target.value) }))} className="h-9" data-testid={`config-${k}`} />
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end mt-3">
                <Button onClick={saveConfig} disabled={savingConfig} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid="config-save-btn">
                  {savingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save Defaults
                </Button>
              </div>
            </CardContent>
          </Card>
          {/* Retain the advanced thresholds panel */}
          <AdvancedConfigSection />
        </TabsContent>
      </Tabs>

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
