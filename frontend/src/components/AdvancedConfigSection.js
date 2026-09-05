/**
 * Advanced admin configuration:
 *  1. Solar Calculator constants  (/api/calculate/config)
 *  2. Health Score weights + targets  (/api/dashboard/health/config)
 *  3. Expansion Module weights + thresholds  (/api/expansion/config)
 * Plus a one-shot PIN Backfill runner and the seed-defaults button for DISCOMs.
 */
import { useEffect, useState, useCallback } from 'react';
import { calcAPI, healthAPI, expansionAPI, projectsAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Loader2, Save, RefreshCw, Wand2, AlertTriangle, CheckCircle2, Zap, Activity, MapPin } from 'lucide-react';


function NumberField({ label, value, onChange, suffix, step = 1 }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-slate-600">{label}</Label>
      <div className="relative">
        <Input
          type="number" step={step}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
          className="h-9 text-sm"
        />
        {suffix && <span className="absolute right-2 top-1.5 text-xs text-slate-400 pointer-events-none">{suffix}</span>}
      </div>
    </div>
  );
}


function SectionCard({ icon: Icon, title, desc, loading, saving, saved, onSave, onReload, children, testid }) {
  return (
    <Card className="border-slate-200" data-testid={testid}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Icon className="h-4 w-4 text-emerald-600" />{title}</CardTitle>
            <CardDescription className="text-xs">{desc}</CardDescription>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="ghost" onClick={onReload} className="h-8 text-xs" disabled={loading} data-testid={`${testid}-reload`}><RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />Reload</Button>
            <Button size="sm" onClick={onSave} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={saving} data-testid={`${testid}-save`}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : saved ? <CheckCircle2 className="h-3 w-3 mr-1 text-white" /> : <Save className="h-3 w-3 mr-1" />}
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>{loading ? <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : children}</CardContent>
    </Card>
  );
}


export default function AdvancedConfigSection() {
  // ── Calculator config ────────────────────────────────────────────
  const [calc, setCalc] = useState(null);
  const [calcLoading, setCalcLoading] = useState(true);
  const [calcSaving, setCalcSaving] = useState(false);
  const [calcSaved, setCalcSaved] = useState(false);

  const loadCalc = useCallback(async () => {
    setCalcLoading(true);
    try { const r = await calcAPI.getConfig(); setCalc(r.data); } catch (e) { console.error(e); }
    finally { setCalcLoading(false); }
  }, []);
  useEffect(() => { loadCalc(); }, [loadCalc]);
  const saveCalc = async () => {
    setCalcSaving(true);
    try {
      const r = await calcAPI.updateConfig(calc);
      setCalc(r.data); setCalcSaved(true);
      setTimeout(() => setCalcSaved(false), 2000);
    } catch { alert('Save failed'); }
    finally { setCalcSaving(false); }
  };
  const setCalcField = (path, val) => setCalc(prev => {
    const next = { ...prev };
    const keys = path.split('.');
    let cur = next;
    for (let i = 0; i < keys.length - 1; i++) { cur[keys[i]] = { ...(cur[keys[i]] || {}) }; cur = cur[keys[i]]; }
    cur[keys[keys.length - 1]] = val;
    return next;
  });

  // ── Health config ────────────────────────────────────────────────
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthSaving, setHealthSaving] = useState(false);
  const [healthSaved, setHealthSaved] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try { const r = await healthAPI.getConfig(); setHealth(r.data); } catch (e) { console.error(e); }
    finally { setHealthLoading(false); }
  }, []);
  useEffect(() => { loadHealth(); }, [loadHealth]);
  const saveHealth = async () => {
    setHealthSaving(true);
    try { const r = await healthAPI.updateConfig(health); setHealth(r.data); setHealthSaved(true); setTimeout(() => setHealthSaved(false), 2000); }
    catch { alert('Save failed'); }
    finally { setHealthSaving(false); }
  };
  const setHealthField = (path, val) => setHealth(prev => {
    const next = { ...prev };
    const keys = path.split('.');
    let cur = next;
    for (let i = 0; i < keys.length - 1; i++) { cur[keys[i]] = { ...(cur[keys[i]] || {}) }; cur = cur[keys[i]]; }
    cur[keys[keys.length - 1]] = val;
    return next;
  });

  // ── Expansion config ─────────────────────────────────────────────
  const [exp, setExp] = useState(null);
  const [expLoading, setExpLoading] = useState(true);
  const [expSaving, setExpSaving] = useState(false);
  const [expSaved, setExpSaved] = useState(false);

  const loadExp = useCallback(async () => {
    setExpLoading(true);
    try { const r = await expansionAPI.getConfig(); setExp(r.data); } catch (e) { console.error(e); }
    finally { setExpLoading(false); }
  }, []);
  useEffect(() => { loadExp(); }, [loadExp]);
  const saveExp = async () => {
    setExpSaving(true);
    try { const r = await expansionAPI.updateConfig(exp); setExp(r.data); setExpSaved(true); setTimeout(() => setExpSaved(false), 2000); }
    catch { alert('Save failed'); }
    finally { setExpSaving(false); }
  };
  const setExpField = (path, val) => setExp(prev => {
    const next = { ...prev };
    const keys = path.split('.');
    let cur = next;
    for (let i = 0; i < keys.length - 1; i++) { cur[keys[i]] = { ...(cur[keys[i]] || {}) }; cur = cur[keys[i]]; }
    cur[keys[keys.length - 1]] = val;
    return next;
  });

  // ── Utility actions ──────────────────────────────────────────────
  const [seeding, setSeeding] = useState(false);
  const runSeedDefaults = async () => {
    if (!window.confirm('Seed default DISCOMs (TANGEDCO / KSEB / BESCOM / FALLBACK) and 18 sample pincodes? Existing rows are preserved.')) return;
    setSeeding(true);
    try {
      const r = await calcAPI.seedDefaults();
      alert(`Seeded ${r.data.discoms_created} DISCOMs + ${r.data.pincodes_created} pincodes.\nTotals: ${r.data.total_discoms} DISCOMs, ${r.data.total_pincodes} pincodes.`);
    } catch { alert('Seed failed'); }
    finally { setSeeding(false); }
  };

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const importCsv = async (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert('CSV must be under 20 MB'); return; }
    setImporting(true); setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/calculate/pincodes/import`, {
        method: 'POST', body: fd, credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Import failed');
      setImportResult(data);
    } catch (e) { alert(e.message || 'Import failed'); }
    finally { setImporting(false); }
  };

  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const runBackfill = async (dryRun = false) => {
    setBackfilling(true); setBackfillResult(null);
    try {
      const r = await projectsAPI.backfillLocations({ dry_run: dryRun, only_missing: true });
      setBackfillResult(r.data);
    } catch { alert('Backfill failed'); }
    finally { setBackfilling(false); }
  };

  return (
    <div className="space-y-4" data-testid="advanced-config">
      {/* ── DISCOM + PIN Backfill utility ── */}
      <Card className="border-emerald-200 bg-emerald-50/40" data-testid="admin-utilities">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Wand2 className="h-4 w-4 text-emerald-600" />Admin Utilities</CardTitle>
          <CardDescription className="text-xs">One-shot data operations — safe to run repeatedly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={runSeedDefaults} disabled={seeding} className="h-9" data-testid="seed-defaults-btn">
              {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
              Seed default DISCOMs &amp; PIN codes
            </Button>
            <label className={`inline-flex items-center gap-1 h-9 px-3 rounded border border-slate-300 bg-white text-xs cursor-pointer hover:bg-slate-50 ${importing ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
              Import PIN CSV
              <input type="file" accept=".csv" hidden onChange={(e) => importCsv(e.target.files?.[0])} disabled={importing} data-testid="import-pins-csv" />
            </label>
            <Button size="sm" variant="outline" onClick={() => runBackfill(true)} disabled={backfilling} className="h-9" data-testid="backfill-dryrun-btn">
              {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <MapPin className="h-3.5 w-3.5 mr-1" />}
              Preview PIN backfill (dry run)
            </Button>
            <Button size="sm" onClick={() => runBackfill(false)} disabled={backfilling} className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="backfill-run-btn">
              {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <MapPin className="h-3.5 w-3.5 mr-1" />}
              Run PIN backfill
            </Button>
          </div>
          {importResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs" data-testid="import-result">
              <p className="font-semibold text-slate-800 mb-1">CSV import complete</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><p className="text-[10px] text-slate-500">Inserted</p><p className="font-bold text-emerald-700">{importResult.inserted}</p></div>
                <div><p className="text-[10px] text-slate-500">Skipped (existing)</p><p className="font-bold">{importResult.skipped_existing}</p></div>
                <div><p className="text-[10px] text-slate-500">Skipped (invalid)</p><p className="font-bold text-amber-700">{importResult.skipped_invalid}</p></div>
                <div><p className="text-[10px] text-slate-500">Total PINs now</p><p className="font-bold">{importResult.total_after}</p></div>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Uploaded {importResult.file_size_kb} KB · CSV headers accepted: Pincode, District, StateName, Latitude, Longitude, DISCOM (case-insensitive)</p>
            </div>
          )}
          {backfillResult && (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs" data-testid="backfill-result">
              <p className="font-semibold text-slate-800 mb-1">Backfill {backfillResult.dry_run ? 'preview' : 'complete'}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><p className="text-[10px] text-slate-500">Scanned</p><p className="font-bold">{backfillResult.scanned}</p></div>
                <div><p className="text-[10px] text-slate-500">Full match</p><p className="font-bold text-emerald-700">{backfillResult.resolved_full}</p></div>
                <div><p className="text-[10px] text-slate-500">Partial (state only)</p><p className="font-bold text-amber-700">{backfillResult.resolved_partial}</p></div>
                <div><p className="text-[10px] text-slate-500">Unresolved</p><p className="font-bold text-rose-600">{backfillResult.unresolved}</p></div>
              </div>
              {backfillResult.unresolved > 0 && (
                <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-600" />
                  Unresolved projects have no PIN or state in their stored address. Update them by editing the project or adding more PINs to the database.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Solar Calculator constants ── */}
      <SectionCard testid="calc-config" icon={Zap} title="Solar Calculator Constants" desc="Cost per kWp, PSH default, PM-Surya-Ghar slabs, PM-KUSUM benchmark, diesel prices."
                    loading={calcLoading} saving={calcSaving} saved={calcSaved} onSave={saveCalc} onReload={loadCalc}>
        {calc && (
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Cost per kWp (₹) by System Type</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumberField label="On-Grid" step={1000} value={calc.cost_per_kwp?.['on-grid']} onChange={(v) => setCalcField('cost_per_kwp.on-grid', v)} suffix="₹" />
              <NumberField label="Hybrid" step={1000} value={calc.cost_per_kwp?.hybrid} onChange={(v) => setCalcField('cost_per_kwp.hybrid', v)} suffix="₹" />
              <NumberField label="Off-Grid" step={1000} value={calc.cost_per_kwp?.['off-grid']} onChange={(v) => setCalcField('cost_per_kwp.off-grid', v)} suffix="₹" />
              <NumberField label="Solar Pump" step={1000} value={calc.cost_per_kwp?.['solar-pump']} onChange={(v) => setCalcField('cost_per_kwp.solar-pump', v)} suffix="₹" />
            </div>

            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold pt-2 border-t">Generation &amp; Battery Defaults</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumberField label="Default Specific Yield" step={0.05} value={calc.default_specific_yield} onChange={(v) => setCalcField('default_specific_yield', v)} suffix="kWh/kWp/day" />
              <NumberField label="Battery Unit Size" step={0.5} value={calc.battery_unit_kwh} onChange={(v) => setCalcField('battery_unit_kwh', v)} suffix="kWh" />
              <NumberField label="System Life" step={1} value={calc.system_life_years} onChange={(v) => setCalcField('system_life_years', v)} suffix="yrs" />
              <NumberField label="Panel Degradation" step={0.05} value={calc.panel_degradation_pct_per_year} onChange={(v) => setCalcField('panel_degradation_pct_per_year', v)} suffix="%/yr" />
              <NumberField label="Default Tariff" step={0.5} value={calc.default_tariff_per_unit} onChange={(v) => setCalcField('default_tariff_per_unit', v)} suffix="₹/unit" />
              <NumberField label="Battery Benchmark" step={1000} value={calc.battery_benchmark_per_kwh} onChange={(v) => setCalcField('battery_benchmark_per_kwh', v)} suffix="₹/kWh" />
            </div>

            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold pt-2 border-t">PM Surya Ghar (Residential On-Grid)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumberField label="Subsidy Cap" step={1000} value={calc.pm_surya_ghar?.cap} onChange={(v) => setCalcField('pm_surya_ghar.cap', v)} suffix="₹" />
              <NumberField label="Slab: 1 kW" step={1000} value={calc.pm_surya_ghar?.slabs?.[0]?.amount} onChange={(v) => setCalcField('pm_surya_ghar.slabs.0.amount', v)} suffix="₹" />
              <NumberField label="Slab: 2 kW" step={1000} value={calc.pm_surya_ghar?.slabs?.[1]?.amount} onChange={(v) => setCalcField('pm_surya_ghar.slabs.1.amount', v)} suffix="₹" />
              <NumberField label="Slab: 3+ kW" step={1000} value={calc.pm_surya_ghar?.slabs?.[2]?.amount} onChange={(v) => setCalcField('pm_surya_ghar.slabs.2.amount', v)} suffix="₹" />
            </div>

            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold pt-2 border-t">PM-KUSUM (Solar Pump) &amp; Diesel Baseline</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <NumberField label="PM-KUSUM benchmark" step={1000} value={calc.pm_kusum?.benchmark_per_kw} onChange={(v) => setCalcField('pm_kusum.benchmark_per_kw', v)} suffix="₹/kW" />
              <NumberField label="Diesel Price" step={0.5} value={calc.diesel_price_per_liter} onChange={(v) => setCalcField('diesel_price_per_liter', v)} suffix="₹/L" />
              <NumberField label="Diesel LPH per kW" step={0.05} value={calc.diesel_lph_per_kw} onChange={(v) => setCalcField('diesel_lph_per_kw', v)} suffix="L/kWh" />
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Company Health Score config ── */}
      <SectionCard testid="health-config" icon={Activity} title="Company Health Score" desc="Pillar weights + targets + band thresholds — feeds the CEO Dashboard hero gauge."
                    loading={healthLoading} saving={healthSaving} saved={healthSaved} onSave={saveHealth} onReload={loadHealth}>
        {health && (
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Pillar Weights (must sum to 100)</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <NumberField label="Sales & Growth"      value={health.weights?.sales_growth}     onChange={(v) => setHealthField('weights.sales_growth', v)} suffix="%" />
              <NumberField label="Profitability"        value={health.weights?.profitability}    onChange={(v) => setHealthField('weights.profitability', v)} suffix="%" />
              <NumberField label="Cash & Collections"   value={health.weights?.cash_collections} onChange={(v) => setHealthField('weights.cash_collections', v)} suffix="%" />
              <NumberField label="Operations"           value={health.weights?.operations}       onChange={(v) => setHealthField('weights.operations', v)} suffix="%" />
              <NumberField label="Team & Compliance"    value={health.weights?.team_compliance}  onChange={(v) => setHealthField('weights.team_compliance', v)} suffix="%" />
            </div>
            <p className="text-[11px] text-slate-500">
              Current sum: <strong className={(Object.values(health.weights || {}).reduce((a, b) => a + (parseFloat(b) || 0), 0)) === 100 ? 'text-emerald-700' : 'text-amber-700'}>
                {Object.values(health.weights || {}).reduce((a, b) => a + (parseFloat(b) || 0), 0)}%
              </strong>
            </p>

            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold pt-2 border-t">Targets</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumberField label="Monthly Revenue Target" step={10000} value={health.targets?.monthly_revenue_target} onChange={(v) => setHealthField('targets.monthly_revenue_target', v)} suffix="₹" />
              <NumberField label="Target Margin"         value={health.targets?.target_margin_pct}          onChange={(v) => setHealthField('targets.target_margin_pct', v)} suffix="%" />
              <NumberField label="Min Acceptable Margin" value={health.targets?.minimum_acceptable_margin_pct} onChange={(v) => setHealthField('targets.minimum_acceptable_margin_pct', v)} suffix="%" />
              <NumberField label="Max Collection Days"   value={health.targets?.max_collection_days}       onChange={(v) => setHealthField('targets.max_collection_days', v)} suffix="days" />
              <NumberField label="Max Overdue"           value={health.targets?.max_overdue_pct}           onChange={(v) => setHealthField('targets.max_overdue_pct', v)} suffix="%" />
              <NumberField label="On-Time Delivery"      value={health.targets?.on_time_delivery_pct}      onChange={(v) => setHealthField('targets.on_time_delivery_pct', v)} suffix="%" />
              <NumberField label="Target Conversion"     value={health.targets?.target_conversion_pct}     onChange={(v) => setHealthField('targets.target_conversion_pct', v)} suffix="%" />
              <NumberField label="Monthly Growth Target" value={health.targets?.monthly_growth_target_pct} onChange={(v) => setHealthField('targets.monthly_growth_target_pct', v)} suffix="%" />
            </div>

            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold pt-2 border-t">Band Thresholds</p>
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Strong ≥"    value={health.bands?.strong}    onChange={(v) => setHealthField('bands.strong', v)} />
              <NumberField label="Healthy ≥"   value={health.bands?.healthy}   onChange={(v) => setHealthField('bands.healthy', v)} />
              <NumberField label="Attention ≥" value={health.bands?.attention} onChange={(v) => setHealthField('bands.attention', v)} />
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Expansion config ── */}
      <SectionCard testid="expansion-config" icon={MapPin} title="Expansion Module Weights" desc="Sub-component weights + thresholds — governs the district ranking on /dashboard/expansion."
                    loading={expLoading} saving={expSaving} saved={expSaved} onSave={saveExp} onReload={loadExp}>
        {exp && (
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Component Weights (must sum to 100)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumberField label="Demand Density"     value={exp.weights?.demand_density}       onChange={(v) => setExpField('weights.demand_density', v)} suffix="%" />
              <NumberField label="Revenue Share"       value={exp.weights?.revenue_contribution} onChange={(v) => setExpField('weights.revenue_contribution', v)} suffix="%" />
              <NumberField label="Growth Momentum"     value={exp.weights?.growth_momentum}      onChange={(v) => setExpField('weights.growth_momentum', v)} suffix="%" />
              <NumberField label="Margin Quality"      value={exp.weights?.margin_quality}       onChange={(v) => setExpField('weights.margin_quality', v)} suffix="%" />
              <NumberField label="Service Burden"      value={exp.weights?.service_burden}       onChange={(v) => setExpField('weights.service_burden', v)} suffix="%" />
              <NumberField label="Travel Cost Drag"    value={exp.weights?.travel_cost_drag}     onChange={(v) => setExpField('weights.travel_cost_drag', v)} suffix="%" />
              <NumberField label="Payment Health"      value={exp.weights?.payment_health}       onChange={(v) => setExpField('weights.payment_health', v)} suffix="%" />
              <NumberField label="Market Headroom"     value={exp.weights?.market_headroom}      onChange={(v) => setExpField('weights.market_headroom', v)} suffix="%" />
            </div>
            <p className="text-[11px] text-slate-500">
              Current sum: <strong className={(Object.values(exp.weights || {}).reduce((a, b) => a + (parseFloat(b) || 0), 0)) === 100 ? 'text-emerald-700' : 'text-amber-700'}>
                {Object.values(exp.weights || {}).reduce((a, b) => a + (parseFloat(b) || 0), 0)}%
              </strong>
            </p>

            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold pt-2 border-t">Thresholds &amp; Simulator Defaults</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <NumberField label="Min Projects for Score"     value={exp.thresholds?.minimum_projects_for_score} onChange={(v) => setExpField('thresholds.minimum_projects_for_score', v)} />
              <NumberField label="Default Branch Cost/month"  step={10000} value={exp.thresholds?.default_branch_monthly_cost} onChange={(v) => setExpField('thresholds.default_branch_monthly_cost', v)} suffix="₹" />
              <NumberField label="Default Setup CAPEX"        step={10000} value={exp.thresholds?.default_setup_capex}         onChange={(v) => setExpField('thresholds.default_setup_capex', v)} suffix="₹" />
              <NumberField label="Target Margin"              value={exp.thresholds?.target_margin_pct}         onChange={(v) => setExpField('thresholds.target_margin_pct', v)} suffix="%" />
              <NumberField label="Distance Cost per km"       value={exp.thresholds?.distance_per_km_cost}      onChange={(v) => setExpField('thresholds.distance_per_km_cost', v)} suffix="₹/km" />
            </div>

            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold pt-2 border-t">Band Thresholds</p>
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Strong ≥"  value={exp.bands?.strong} onChange={(v) => setExpField('bands.strong', v)} />
              <NumberField label="Watch ≥"   value={exp.bands?.watch}  onChange={(v) => setExpField('bands.watch', v)} />
              <NumberField label="Serve ≥"   value={exp.bands?.serve}  onChange={(v) => setExpField('bands.serve', v)} />
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
