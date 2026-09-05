import { useState } from 'react';
import { calcAPI } from '../../utils/api';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Loader2, IndianRupee, Gauge, Zap, AlertTriangle, Calculator } from 'lucide-react';

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;

function PumpField({ label, k, unit, value, onChange }) {
  return (
    <div className="space-y-1"><Label className="text-xs">{label}{unit && <span className="text-slate-400"> ({unit})</span>}</Label>
      <Input type="number" inputMode="decimal" min="0" value={value || ''} onChange={(e) => onChange({ [k]: e.target.value })} className="h-11 text-base bg-white" data-testid={`pump-${k}-input`} /></div>
  );
}

/** Dedicated pump sizing path — head, flow, bore, string-voltage vs controller window (backend calculator). */
export function PumpFlow({ data, set, onChange }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isDC = (data.pump_path || 'DC') === 'DC';
  const missing = [
    !(num(data.required_flow_lpm) > 0) && 'Required flow', !(num(data.static_water_level_m) > 0) && 'Head', !(num(data.bore_casing_diameter_mm) > 0) && 'Bore diameter',
    isDC && !(num(data.controller_max_voltage) > 0) && 'Controller max voltage', isDC && !(num(data.string_voltage_v) > 0) && 'String voltage',
  ].filter(Boolean);
  const stringTooHigh = isDC && num(data.string_voltage_v) > 0 && num(data.controller_max_voltage) > 0 && num(data.string_voltage_v) > num(data.controller_max_voltage);

  const run = async () => {
    setLoading(true); setError('');
    try {
      const inputs = {
        pump_path: data.pump_path || 'DC', required_flow_lpm: num(data.required_flow_lpm), daily_operating_hours: num(data.daily_operating_hours) || undefined,
        static_water_level_m: num(data.static_water_level_m), bore_casing_diameter_mm: num(data.bore_casing_diameter_mm),
        controller_max_voltage: num(data.controller_max_voltage), string_voltage_v: num(data.string_voltage_v),
      };
      const r = await calcAPI.solution({ system_type: 'solar-pump', inputs, overrides: {} });
      const res = r.data.result;
      onChange({
        ...data, system_size_kw: res.system_size_kw, pump_hp: res.pump_hp_selected, pump_type: data.pump_path,
        pump_head_m: res.tdh_m, pump_discharge_lph: Math.round((res.flow_lpm || 0) * 60),
        total_cost: res.total_cost, subsidy: res.subsidy, net_cost: res.net_cost,
        _derived: { annual_savings: res.annual_saving, payback_years: res.payback_years, roi_pct: res.net_cost > 0 ? Math.round((res.annual_saving / res.net_cost) * 1000) / 10 : 0 },
        _pump_result: res, _pump_warnings: r.data.warnings || [],
      });
    } catch (e) { setError(e.response?.data?.detail || 'Could not calculate pump sizing'); }
    finally { setLoading(false); }
  };
  const res = data._pump_result;

  return (
    <div className="space-y-4" data-testid="pump-flow-section">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label className="text-xs">Pump path</Label>
          <Select value={data.pump_path || 'DC'} onValueChange={(v) => set({ pump_path: v })}>
            <SelectTrigger className="h-11 bg-white" data-testid="pump-path-select"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="DC">DC (MPPT controller)</SelectItem><SelectItem value="AC">AC (VFD)</SelectItem></SelectContent>
          </Select></div>
        <PumpField label="Required flow" k="required_flow_lpm" unit="LPM" value={data.required_flow_lpm} onChange={set} />
        <PumpField label="Head / water level" k="static_water_level_m" unit="m" value={data.static_water_level_m} onChange={set} />
        <PumpField label="Bore casing diameter" k="bore_casing_diameter_mm" unit="mm" value={data.bore_casing_diameter_mm} onChange={set} />
        <PumpField label="Operating hours per day" k="daily_operating_hours" unit="h" value={data.daily_operating_hours} onChange={set} />
        {isDC && <PumpField label="Controller max voltage" k="controller_max_voltage" unit="V" value={data.controller_max_voltage} onChange={set} />}
        {isDC && <PumpField label="String voltage" k="string_voltage_v" unit="V" value={data.string_voltage_v} onChange={set} />}
      </div>
      {stringTooHigh && <p className="text-[11px] text-rose-700 flex items-start gap-1" data-testid="pump-string-voltage-warning"><AlertTriangle className="h-3 w-3 mt-0.5" />String voltage {data.string_voltage_v} V is above the controller's {data.controller_max_voltage} V limit — reduce modules in series.</p>}
      {missing.length > 0 && <p className="text-[11px] text-slate-500" data-testid="pump-missing-hint">Still needed: {missing.join(', ')}</p>}
      <Button type="button" onClick={run} disabled={loading || missing.length > 0} className="w-full h-11 gap-2 bg-sky-600 hover:bg-sky-700 text-white" data-testid="pump-calculate-btn">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}Calculate pump sizing
      </Button>
      {error && <p className="text-xs text-rose-600" data-testid="pump-calc-error">{error}</p>}
      {res && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 space-y-2" data-testid="pump-result-strip">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div><p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-center gap-1"><Gauge className="h-3 w-3" />Array</p><p className="text-sm font-bold text-slate-800">{res.system_size_kw} kWp</p></div>
            <div><p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-center gap-1"><Zap className="h-3 w-3" />Pump</p><p className="text-sm font-bold text-slate-800">{res.pump_hp_selected} HP</p></div>
            <div><p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-center gap-1"><IndianRupee className="h-3 w-3" />Cost</p><p className="text-sm font-bold text-slate-800">{inr(data.total_cost)}</p></div>
            <div><p className="text-[9px] uppercase tracking-wider text-emerald-600">Net cost</p><p className="text-sm font-bold text-emerald-700">{inr(data.net_cost)}</p></div>
          </div>
          <p className="text-[11px] text-slate-500 text-center">Subsidy (PM-KUSUM): {inr(data.subsidy)} · Payback: {data._derived?.payback_years ? `${data._derived.payback_years} yrs` : '—'}</p>
          {(data._pump_warnings || []).map((w, i) => <p key={i} className="text-[11px] text-amber-700 flex items-start gap-1" data-testid={`pump-warning-${i}`}><AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />{w}</p>)}
        </div>
      )}
    </div>
  );
}
