import { useState, useEffect, useMemo, useRef } from 'react';
import { inventoryAPI, calcAPI } from '../utils/api';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { computeQuick, projectResult } from '../utils/solarCalc';
import { GridSolarFlow } from './calc/GridSolarFlow';
import { PumpFlow } from './calc/PumpFlow';

/**
 * Step 4 — Proposed Solution calculator (Iteration 48 rebuild).
 * On-grid / off-grid / hybrid: pure client-side engine (utils/solarCalc.js, mirrored by backend
 * quick_calc.py) recomputes on every keystroke. Solar pump keeps its dedicated hydraulic path.
 * All state lives in the parent form's `proposed_solution`, so it survives step navigation.
 */
const SYSTEM_TYPES = [
  { value: 'on-grid', label: 'On-Grid (net metering)' },
  { value: 'hybrid', label: 'Hybrid (grid + battery)' },
  { value: 'off-grid', label: 'Off-Grid (battery only)' },
  { value: 'solar-pump', label: 'Solar Pump' },
];
const GRID_KEYS = ['monthly_eb_bill', 'monthly_eb_units_entered', 'tariff_per_unit_manual', 'roof_area_sqft', 'panel_item_id', 'inverter_item_id', 'battery_item_id', 'backup_hours', 'subsidy', 'overrides', 'customer_type'];
const PUMP_KEYS = ['pump_path', 'required_flow_lpm', 'static_water_level_m', 'bore_casing_diameter_mm', 'daily_operating_hours', 'controller_max_voltage', 'string_voltage_v', '_pump_result', '_pump_warnings', 'pump_hp', 'pump_head_m', 'pump_discharge_lph', 'pump_type'];
const BATTERY_KEYS = ['battery_item_id', 'backup_hours'];
const RESULT_KEYS = ['system_size_kw', 'panel_count', 'battery_count', 'monthly_eb_units', 'tariff_per_unit', 'total_cost', 'net_cost', '_derived', '_quick'];
const filled = (v) => v !== undefined && v !== null && v !== '' && !(typeof v === 'object' && Object.keys(v).length === 0);
const active = (i) => i.active !== false;

export default function ProposedSolutionSection({ value, onChange }) {
  const data = value || {};
  const [panels, setPanels] = useState([]);
  const [inverters, setInverters] = useState([]);
  const [batteries, setBatteries] = useState([]);
  const [config, setConfig] = useState(null);
  const [pendingType, setPendingType] = useState(null);
  const systemType = data.system_type || 'on-grid';
  const isPump = systemType === 'solar-pump';

  useEffect(() => {
    inventoryAPI.getItems({ category: 'solar_panels' }).then(r => setPanels((r.data || []).filter(active))).catch(() => {});
    inventoryAPI.getItems({ category: 'inverters' }).then(r => setInverters((r.data || []).filter(active))).catch(() => {});
    inventoryAPI.getItems({ category: 'batteries' }).then(r => setBatteries((r.data || []).filter(active))).catch(() => {});
    calcAPI.getConfig().then(r => setConfig(r.data)).catch(() => {});
  }, []);

  const recompute = useMemo(() => (merged) => {
    const inputs = { ...merged, system_type: merged.system_type || 'on-grid', monthly_eb_units: merged.monthly_eb_units_entered, tariff_per_unit: merged.tariff_per_unit_manual };
    const r = computeQuick(inputs, config, panels.find(p => p.id === merged.panel_item_id), inverters.find(i => i.id === merged.inverter_item_id), batteries.find(b => b.id === merged.battery_item_id));
    return projectResult(merged, r);
  }, [config, panels, inverters, batteries]);

  const set = (patch) => { const merged = { ...data, ...patch }; onChange(isPump ? merged : recompute(merged)); };

  // Re-run once inventory/config arrive so a saved project shows live numbers immediately.
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const dataRef = useRef(data); dataRef.current = data;
  useEffect(() => {
    const d = dataRef.current;
    if ((d.system_type || 'on-grid') !== 'solar-pump' && GRID_KEYS.some(k => filled(d[k]))) onChangeRef.current(recompute(d));
  }, [recompute]);

  const r = data._quick;

  const requestTypeChange = (next) => {
    if (next === systemType) return;
    const fromPump = isPump, toPump = next === 'solar-pump';
    let discard = [];
    if (fromPump !== toPump) discard = (fromPump ? PUMP_KEYS : GRID_KEYS).filter(k => filled(data[k]));
    else if (next === 'on-grid') discard = BATTERY_KEYS.filter(k => filled(data[k])).concat(filled(data.overrides?.battery_count) ? ['battery count override'] : []);
    if (discard.length) setPendingType({ next, discard }); else applyTypeChange(next);
  };
  const applyTypeChange = (next) => {
    const fromPump = isPump, toPump = next === 'solar-pump';
    const cleared = {};
    if (fromPump !== toPump) [...(fromPump ? PUMP_KEYS : GRID_KEYS), ...RESULT_KEYS].forEach(k => { cleared[k] = undefined; });
    else if (next === 'on-grid') { BATTERY_KEYS.forEach(k => { cleared[k] = undefined; }); cleared.overrides = { ...(data.overrides || {}), battery_count: undefined }; }
    const merged = { ...data, ...cleared, system_type: next };
    onChange(toPump ? merged : recompute(merged));
    setPendingType(null);
  };

  return (
    <div className="space-y-4" data-testid="proposed-solution-section">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-700">System type</Label>
          <Select value={systemType} onValueChange={requestTypeChange}>
            <SelectTrigger className="h-11 bg-white text-base" data-testid="system-type-select"><SelectValue /></SelectTrigger>
            <SelectContent>{SYSTEM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {!isPump && (
          <div className="space-y-1">
            <Label className="text-xs text-slate-700">Customer type</Label>
            <div className="grid grid-cols-2 rounded-md border border-slate-200 bg-white p-0.5 h-11" data-testid="customer-type-toggle">
              {[['residential', 'Residential'], ['commercial', 'Commercial']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => set({ customer_type: v })} data-testid={`customer-type-${v}`}
                  className={`rounded text-sm font-medium transition-colors ${(data.customer_type || 'residential') === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {isPump ? <PumpFlow data={data} set={set} onChange={onChange} />
        : <GridSolarFlow data={data} r={r} set={set} config={config} panels={panels} inverters={inverters} batteries={batteries} />}

      <AlertDialog open={!!pendingType} onOpenChange={(o) => !o && setPendingType(null)}>
        <AlertDialogContent data-testid="system-type-switch-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to {SYSTEM_TYPES.find(t => t.value === pendingType?.next)?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              These entries don't apply to the new system type and will be cleared: <span className="font-medium text-slate-800">{(pendingType?.discard || []).map(k => k.replace(/_/g, ' ')).join(', ')}</span>. Everything else is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="system-type-switch-cancel">Keep current</AlertDialogCancel>
            <AlertDialogAction onClick={() => applyTypeChange(pendingType.next)} data-testid="system-type-switch-confirm">Switch &amp; clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
