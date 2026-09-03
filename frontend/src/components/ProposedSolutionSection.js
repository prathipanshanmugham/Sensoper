import { useState, useEffect, useMemo, useCallback } from 'react';
import { inventoryAPI, calcAPI } from '../utils/api';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Loader2, IndianRupee, Percent, Clock, Gauge, Zap, AlertTriangle, Calculator } from 'lucide-react';

/**
 * Proposed Solution & Materials — Iteration 45 rewrite.
 * The old dense multi-mode engine (driver inputs, advanced toggle, flat COST_PER_KWP) is
 * gone entirely. On-Grid/Off-Grid/Hybrid is now exactly 4 things: system type, manual kW,
 * a panel + inverter picker sourced live from Inventory, and a short result. Solar Pump is
 * its own flow (head/flow/bore/string-voltage) because pump sizing genuinely needs those
 * hydraulic calculations — it calls the existing backend pump calculator.
 */

const SYSTEM_TYPES = [
  { value: 'on-grid', label: 'On-Grid' },
  { value: 'off-grid', label: 'Off-Grid' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'solar-pump', label: 'Solar Pump' },
];

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;

export default function ProposedSolutionSection({ value, onChange }) {
  const data = value || {};
  const [panels, setPanels] = useState([]);
  const [inverters, setInverters] = useState([]);
  const [pumps, setPumps] = useState([]);
  const [config, setConfig] = useState(null);
  const [pumpLoading, setPumpLoading] = useState(false);
  const [pumpError, setPumpError] = useState('');

  useEffect(() => {
    inventoryAPI.getItems({ category: 'solar_panels' }).then(r => setPanels((r.data || []).filter(i => i.active !== false))).catch(() => {});
    inventoryAPI.getItems({ category: 'inverters' }).then(r => setInverters((r.data || []).filter(i => i.active !== false))).catch(() => {});
    inventoryAPI.getItems({ category: 'pumps' }).then(r => setPumps((r.data || []).filter(i => i.active !== false))).catch(() => {});
    calcAPI.getConfig().then(r => setConfig(r.data)).catch(() => {});
  }, []);

  const systemType = data.system_type || 'on-grid';
  const isPump = systemType === 'solar-pump';

  // ═════════════════════════ Simple flow (on-grid / off-grid / hybrid) ═════════════════════════
  const computeSimple = useCallback((merged) => {
    const kw = num(merged.system_size_kw);
    if (kw <= 0 || !config) {
      return { ...merged, total_cost: 0, net_cost: 0, panel_count: 0, _derived: null };
    }
    const panel = panels.find(p => p.id === merged.panel_item_id);
    const inverter = inverters.find(i => i.id === merged.inverter_item_id);
    const costPerKwp = (config.cost_per_kwp || {})[merged.system_type] || 55000;

    const panelWattage = panel?.specs?.wattage || 0;
    const panelSellPerUnit = panel ? (panel.unit_price || 0) * (1 + (panel.margin_pct ?? 15) / 100) : 0;
    const panelCost = (panelSellPerUnit > 0 && panelWattage > 0) ? (panelSellPerUnit / panelWattage) * kw * 1000 : costPerKwp * 0.45 * kw;
    const panelCount = panelWattage > 0 ? Math.ceil((kw * 1000) / panelWattage) : 0;

    const inverterSell = inverter ? (inverter.unit_price || 0) * (1 + (inverter.margin_pct ?? 15) / 100) : 0;
    const inverterCost = inverterSell > 0 ? inverterSell : costPerKwp * 0.15 * kw;

    const bosCost = costPerKwp * 0.40 * kw;
    const totalCost = Math.round(panelCost + inverterCost + bosCost);
    const subsidy = num(merged.subsidy);
    const netCost = Math.max(totalCost - subsidy, 0);

    const specificYield = config.default_specific_yield || 4.4;
    const annualGenKwh = kw * specificYield * 365;
    const ASSUMED_TARIFF_PER_UNIT = 8; // simple flat assumption — no bill/location input in this flow
    const annualSavings = Math.round(annualGenKwh * ASSUMED_TARIFF_PER_UNIT);
    const paybackYears = annualSavings > 0 ? Math.round((netCost / annualSavings) * 10) / 10 : null;
    const roiPct = netCost > 0 ? Math.round((annualSavings / netCost) * 1000) / 10 : 0;

    return {
      ...merged, total_cost: totalCost, subsidy, net_cost: netCost, panel_count: panelCount,
      _derived: { annual_savings: annualSavings, payback_years: paybackYears, roi_pct: roiPct },
    };
  }, [panels, inverters, config]);

  const set = (patch) => {
    const merged = { ...data, ...patch };
    onChange(isPump ? merged : computeSimple(merged));
  };

  const selectedPanel = panels.find(p => p.id === data.panel_item_id);
  const selectedInverter = inverters.find(i => i.id === data.inverter_item_id);

  // ═════════════════════════ Pump flow ═════════════════════════
  const runPumpCalc = async () => {
    setPumpLoading(true); setPumpError('');
    try {
      const inputs = {
        pump_path: data.pump_path || 'DC',
        required_flow_lpm: num(data.required_flow_lpm),
        daily_operating_hours: num(data.daily_operating_hours) || undefined,
        static_water_level_m: num(data.static_water_level_m),
        bore_casing_diameter_mm: num(data.bore_casing_diameter_mm),
        controller_max_voltage: num(data.controller_max_voltage),
        string_voltage_v: num(data.string_voltage_v),
      };
      const r = await calcAPI.solution({ system_type: 'solar-pump', inputs, overrides: {} });
      const res = r.data.result;
      onChange({
        ...data,
        system_size_kw: res.system_size_kw, pump_hp: res.pump_hp_selected, pump_type: data.pump_path,
        pump_head_m: res.tdh_m, pump_discharge_lph: Math.round((res.flow_lpm || 0) * 60),
        total_cost: res.total_cost, subsidy: res.subsidy, net_cost: res.net_cost,
        _derived: { annual_savings: res.annual_saving, payback_years: res.payback_years, roi_pct: res.net_cost > 0 ? Math.round((res.annual_saving / res.net_cost) * 1000) / 10 : 0 },
        _pump_result: res, _pump_warnings: r.data.warnings || [],
      });
    } catch (e) { setPumpError(e.response?.data?.detail || 'Could not calculate pump sizing'); }
    finally { setPumpLoading(false); }
  };

  const pumpResult = data._pump_result;

  return (
    <div className="space-y-4" data-testid="proposed-solution-section">
      {/* 1. System type */}
      <div className="space-y-1.5">
        <Label className="text-xs">System Type</Label>
        <Select value={systemType} onValueChange={(v) => set({ system_type: v, panel_item_id: '', inverter_item_id: '' })}>
          <SelectTrigger className="h-11 bg-white" data-testid="system-type-select"><SelectValue /></SelectTrigger>
          <SelectContent>{SYSTEM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {!isPump ? (
        <>
          {/* 2. System size (kW), manual */}
          <div className="space-y-1.5">
            <Label className="text-xs">System Size (kW)</Label>
            <Input type="number" min="0" step="0.1" value={data.system_size_kw || ''} onChange={(e) => set({ system_size_kw: e.target.value })}
              placeholder="e.g. 5" className="h-11" data-testid="system-size-input" />
          </div>

          {/* 3. Panel + Inverter picker from inventory */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Panel</Label>
              <Select value={data.panel_item_id || ''} onValueChange={(v) => set({ panel_item_id: v })}>
                <SelectTrigger className="h-11 bg-white" data-testid="panel-picker"><SelectValue placeholder="Select a panel..." /></SelectTrigger>
                <SelectContent>
                  {panels.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.specs?.wattage ? ` — ${p.specs.wattage}W` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Inverter</Label>
              <Select value={data.inverter_item_id || ''} onValueChange={(v) => set({ inverter_item_id: v })}>
                <SelectTrigger className="h-11 bg-white" data-testid="inverter-picker"><SelectValue placeholder="Select an inverter..." /></SelectTrigger>
                <SelectContent>
                  {inverters.map(iv => <SelectItem key={iv.id} value={iv.id}>{iv.name}{iv.specs?.rated_kw ? ` — ${iv.specs.rated_kw}kW` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 4. Short result */}
          <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid="calc-result-strip">
            {num(data.system_size_kw) <= 0 ? (
              <p className="text-xs text-slate-400">Enter a system size to see cost, subsidy and payback.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div><p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-center gap-1"><IndianRupee className="h-3 w-3" />Cost</p><p className="text-sm font-bold text-slate-800" data-testid="result-total-cost">{inr(data.total_cost)}</p></div>
                <div className="space-y-1">
                  <Label className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-center gap-1"><Percent className="h-3 w-3" />Subsidy</Label>
                  <Input type="number" min="0" value={data.subsidy ?? ''} onChange={(e) => set({ subsidy: e.target.value })} placeholder="0" className="h-7 text-center text-sm" data-testid="subsidy-input" />
                </div>
                <div><p className="text-[9px] uppercase tracking-wider text-emerald-600">Net Cost</p><p className="text-sm font-bold text-emerald-700" data-testid="result-net-cost">{inr(data.net_cost)}</p></div>
                <div><p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-center gap-1"><Clock className="h-3 w-3" />Payback</p><p className="text-sm font-bold text-slate-800" data-testid="result-payback">{data._derived?.payback_years ? `${data._derived.payback_years} yrs` : '—'}</p></div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-4" data-testid="pump-flow-section">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Pump Path</Label>
              <Select value={data.pump_path || 'DC'} onValueChange={(v) => set({ pump_path: v })}>
                <SelectTrigger className="h-10 bg-white" data-testid="pump-path-select"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="DC">DC (MPPT)</SelectItem><SelectItem value="AC">AC (VFD)</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Required Flow (LPM)</Label>
              <Input type="number" min="0" value={data.required_flow_lpm || ''} onChange={(e) => set({ required_flow_lpm: e.target.value })} className="h-10" data-testid="pump-flow-input" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Head (m)</Label>
              <Input type="number" min="0" value={data.static_water_level_m || ''} onChange={(e) => set({ static_water_level_m: e.target.value })} className="h-10" data-testid="pump-head-input" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bore Casing Diameter (mm)</Label>
              <Input type="number" min="0" value={data.bore_casing_diameter_mm || ''} onChange={(e) => set({ bore_casing_diameter_mm: e.target.value })} className="h-10" data-testid="pump-bore-input" />
            </div>
          </div>
          {(data.pump_path || 'DC') === 'DC' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Controller Max Voltage (V)</Label>
                <Input type="number" min="0" value={data.controller_max_voltage || ''} onChange={(e) => set({ controller_max_voltage: e.target.value })} className="h-10" data-testid="pump-controller-vmax-input" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">String Voltage (V)</Label>
                <Input type="number" min="0" value={data.string_voltage_v || ''} onChange={(e) => set({ string_voltage_v: e.target.value })} className="h-10" data-testid="pump-string-voltage-input" />
              </div>
            </div>
          )}

          <Button type="button" onClick={runPumpCalc} disabled={pumpLoading} className="w-full gap-2 bg-sky-600 hover:bg-sky-700 text-white" data-testid="pump-calculate-btn">
            {pumpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}Calculate Pump Sizing
          </Button>
          {pumpError && <p className="text-xs text-rose-600" data-testid="pump-calc-error">{pumpError}</p>}

          {pumpResult && (
            <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 space-y-2" data-testid="pump-result-strip">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div><p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-center gap-1"><Gauge className="h-3 w-3" />Array</p><p className="text-sm font-bold text-slate-800">{pumpResult.system_size_kw} kWp</p></div>
                <div><p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-center gap-1"><Zap className="h-3 w-3" />Pump</p><p className="text-sm font-bold text-slate-800">{pumpResult.pump_hp_selected} HP</p></div>
                <div><p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-center gap-1"><IndianRupee className="h-3 w-3" />Cost</p><p className="text-sm font-bold text-slate-800">{inr(data.total_cost)}</p></div>
                <div><p className="text-[9px] uppercase tracking-wider text-emerald-600">Net Cost</p><p className="text-sm font-bold text-emerald-700">{inr(data.net_cost)}</p></div>
              </div>
              <p className="text-[11px] text-slate-500 text-center">Subsidy (PM-KUSUM): {inr(data.subsidy)} · Payback: {data._derived?.payback_years ? `${data._derived.payback_years} yrs` : '—'}</p>
              {(data._pump_warnings || []).map((w, i) => (
                <p key={i} className="text-[11px] text-amber-700 flex items-start gap-1" data-testid={`pump-warning-${i}`}><AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />{w}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
