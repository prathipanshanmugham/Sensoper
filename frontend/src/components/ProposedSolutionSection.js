import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  Package, IndianRupee, Leaf, Calendar, TrendingUp, Fuel, Sun,
  Wand2, Loader2, RotateCcw, MapPin, Zap
} from 'lucide-react';

// ───────────────────────── default form shape ─────────────────────────
const blank = {
  // ───── Driver inputs (used by auto-calc) ─────
  monthly_eb_bill: '',
  monthly_eb_units: '',
  roof_area_sqft: '',
  connection_type: 'Single Phase',
  tariff_category: 'Domestic',
  tariff_per_unit: '',
  location: 'Tamil Nadu',
  power_backup_hours: '',
  system_type: 'on-grid',

  // ───── Hardware ─────
  system_size_kw: '',
  panel_count: '',
  panel_wattage_w: 540,
  panel_model: '',
  panel_area_sqft: '',
  roof_utilization_pct: '',
  inverter_kw: '',
  inverter_model: '',
  battery_kwh: '',
  battery_count: '',

  // ───── Generation ─────
  estimated_generation_units_monthly: '',
  estimated_generation_units_annual: '',

  // ───── Financials ─────
  total_cost: '',
  subsidy: '',

  // ───── Diesel offset (optional) ─────
  diesel_offset_liters_yearly: '',
  diesel_price_per_liter: '',

  // ───── ROI assumptions ─────
  system_life_years: 25,
  panel_degradation_pct_per_year: 0.7,

  // ───── Notes ─────
  notes: '',

  // ───── Internal state ─────
  _overrides: {},   // { fieldName: true } when user has manually overridden
  _derived: {},
};

// ───────────────────────── helpers ─────────────────────────
const num = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : 0;
};
const inr = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const inrL = (v) => `₹${(v / 100000).toFixed(2)} L`;

// Tariff defaults (₹/unit) — used only when user hasn't typed one
const DEFAULT_TARIFFS = { Domestic: 6.5, Commercial: 9.0, Industrial: 8.5 };

// Cost per kWp (₹) by system_type — Feb 2026 indicative
const COST_PER_KWP = { 'on-grid': 55000, 'hybrid': 75000, 'off-grid': 95000 };

// Specific yield (kWh/kWp/day) — India residential average; tweakable per location
const SPECIFIC_YIELD = {
  'Tamil Nadu': 4.2, 'Karnataka': 4.3, 'Andhra Pradesh': 4.4, 'Telangana': 4.4,
  'Kerala': 4.0, 'Maharashtra': 4.3, 'Gujarat': 4.6, 'Rajasthan': 4.8,
  'Delhi': 4.4, 'Punjab': 4.3, 'Haryana': 4.4, 'Uttar Pradesh': 4.3,
  'West Bengal': 3.9, 'Odisha': 4.1,
};
const DEFAULT_SPECIFIC_YIELD = 4.2;

// PM Surya Ghar subsidy (Feb 2026 — residential on-grid only)
// First 1 kW: ₹30,000 ; 1-2 kW: +₹30,000 ; 2-3 kW: +₹18,000 ; cap ₹78,000.
const calcSubsidy = (kwp, tariff_category, system_type) => {
  if (system_type !== 'on-grid') return 0;
  if (tariff_category !== 'Domestic') return 0;
  if (kwp <= 0) return 0;
  if (kwp <= 1) return Math.round(kwp * 30000);
  if (kwp <= 2) return Math.round(30000 + (kwp - 1) * 30000);
  if (kwp <= 3) return Math.round(60000 + (kwp - 2) * 18000);
  return 78000;
};

// Auto-calc engine — pure function of drivers + overrides
function autoCalc(d) {
  const ov = d._overrides || {};
  // Resolve usable drivers
  const yield_kwh = SPECIFIC_YIELD[d.location] || DEFAULT_SPECIFIC_YIELD;
  let tariff = num(d.tariff_per_unit);
  if (!tariff) tariff = DEFAULT_TARIFFS[d.tariff_category] || 6.5;

  // Step 1 — resolve monthly EB units (from bill if needed)
  let monthlyUnits = num(d.monthly_eb_units);
  let monthlyBill = num(d.monthly_eb_bill);
  if (!monthlyUnits && monthlyBill && tariff) monthlyUnits = monthlyBill / tariff;
  if (!monthlyBill && monthlyUnits && tariff) monthlyBill = monthlyUnits * tariff;

  const dailyUnits = monthlyUnits / 30;

  // Step 2 — recommended system size (kWp)
  const sysKw = ov.system_size_kw
    ? num(d.system_size_kw)
    : (dailyUnits > 0 ? +(dailyUnits / yield_kwh).toFixed(2) : 0);

  // Step 3 — panel count & area
  const panelW = num(d.panel_wattage_w) || 540;
  const panelCount = ov.panel_count
    ? Math.round(num(d.panel_count))
    : (sysKw > 0 ? Math.ceil((sysKw * 1000) / panelW) : 0);

  // ~21 sqft per panel (≈ 2 m²)
  const PANEL_SQFT = 21;
  const panelArea = ov.panel_area_sqft
    ? num(d.panel_area_sqft)
    : Math.round(panelCount * PANEL_SQFT);
  const roofArea = num(d.roof_area_sqft);
  const roofUtil = ov.roof_utilization_pct
    ? num(d.roof_utilization_pct)
    : (roofArea > 0 && panelArea > 0 ? +((panelArea / roofArea) * 100).toFixed(1) : 0);

  // Step 4 — generation
  const monthlyGen = ov.estimated_generation_units_monthly
    ? num(d.estimated_generation_units_monthly)
    : +(sysKw * yield_kwh * 30).toFixed(0);
  const annualGen = ov.estimated_generation_units_annual
    ? num(d.estimated_generation_units_annual)
    : monthlyGen * 12;

  // Step 5 — inverter (typically 1:1 for on-grid)
  const inverterKw = ov.inverter_kw
    ? num(d.inverter_kw)
    : (d.system_type === 'on-grid'
        ? +sysKw.toFixed(2)
        : +(sysKw * 1.1).toFixed(2));

  // Step 6 — battery (hybrid / off-grid only)
  const backupHrs = num(d.power_backup_hours);
  let batteryKwh = num(d.battery_kwh);
  let batteryCount = num(d.battery_count);
  if (d.system_type !== 'on-grid' && backupHrs > 0 && dailyUnits > 0) {
    if (!ov.battery_kwh) {
      // assume daily consumption needs `backupHrs/24` proportion of energy from battery
      const wh = (dailyUnits * 1000) * (backupHrs / 24);
      batteryKwh = +(wh / 1000).toFixed(2);  // kWh total
    }
    if (!ov.battery_count) {
      batteryCount = 1;  // single unit by default
    }
  }

  // Step 7 — cost & subsidy
  const costPerKwp = COST_PER_KWP[d.system_type] || COST_PER_KWP['on-grid'];
  const totalCost = ov.total_cost
    ? num(d.total_cost)
    : Math.round(sysKw * costPerKwp);
  const subsidy = ov.subsidy
    ? num(d.subsidy)
    : calcSubsidy(sysKw, d.tariff_category, d.system_type);
  const netCost = Math.max(totalCost - subsidy, 0);

  // Step 8 — savings
  const offsetUnits = Math.min(monthlyGen, monthlyUnits > 0 ? monthlyUnits : monthlyGen);
  const monthlyElec = offsetUnits * tariff;
  const annualElec = monthlyElec * 12;
  const dieselL = num(d.diesel_offset_liters_yearly);
  const dieselP = num(d.diesel_price_per_liter);
  const annualDiesel = dieselL * dieselP;
  const annualSavings = annualElec + annualDiesel;
  const monthlySavings = annualSavings / 12;

  // Step 9 — lifetime & ROI
  const life = Math.max(num(d.system_life_years) || 25, 1);
  const degr = Math.max(num(d.panel_degradation_pct_per_year), 0) / 100;
  let lifetimeElec = 0;
  for (let y = 1; y <= life; y++) lifetimeElec += annualElec * Math.pow(1 - degr, y - 1);
  const lifetimeSavings = lifetimeElec + annualDiesel * life;
  const paybackYears = annualSavings > 0 ? netCost / annualSavings : 0;
  const roiPct = netCost > 0 ? ((lifetimeSavings - netCost) / netCost) * 100 : 0;

  // CO₂: 0.82 kg per kWh (India grid mix)
  const co2KgYear = annualGen * 0.82;

  return {
    // resolved input echoes
    resolved_tariff: tariff,
    resolved_yield: yield_kwh,
    resolved_monthly_units: monthlyUnits,
    resolved_monthly_bill: monthlyBill,
    // auto-suggested hardware/finance fields
    system_size_kw: sysKw,
    panel_count: panelCount,
    panel_area_sqft: panelArea,
    roof_utilization_pct: roofUtil,
    estimated_generation_units_monthly: monthlyGen,
    estimated_generation_units_annual: annualGen,
    inverter_kw: inverterKw,
    battery_kwh: batteryKwh,
    battery_count: batteryCount,
    total_cost: totalCost,
    subsidy: subsidy,
    // derived outputs
    net_cost: netCost,
    monthly_savings: monthlySavings,
    annual_savings: annualSavings,
    annual_elec_savings: annualElec,
    annual_diesel_savings: annualDiesel,
    payback_years: paybackYears,
    roi_pct: roiPct,
    lifetime_savings: lifetimeSavings,
    annual_generation_units: annualGen,
    co2_kg_year: co2KgYear,
    diesel_petrol_saved_liters_yearly: dieselL,
  };
}

// Fields whose value comes from autoCalc (must be in sync with the engine output).
const AUTO_FIELDS = [
  'system_size_kw', 'panel_count', 'panel_area_sqft', 'roof_utilization_pct',
  'estimated_generation_units_monthly', 'estimated_generation_units_annual',
  'inverter_kw', 'battery_kwh', 'battery_count', 'total_cost', 'subsidy',
];

// ───────────────────────── component ─────────────────────────
export default function ProposedSolutionSection({ value, onChange }) {
  const data = { ...blank, ...(value || {}) };
  const overrides = data._overrides || {};
  const [recomputing, setRecomputing] = useState(false);

  // Engine output for current data
  const engine = useMemo(() => autoCalc(data), [
    data.monthly_eb_bill, data.monthly_eb_units, data.roof_area_sqft,
    data.connection_type, data.tariff_category, data.tariff_per_unit,
    data.location, data.power_backup_hours, data.system_type,
    data.panel_wattage_w, data.system_life_years, data.panel_degradation_pct_per_year,
    data.diesel_offset_liters_yearly, data.diesel_price_per_liter,
    // override-honoured fields:
    data.system_size_kw, data.panel_count, data.panel_area_sqft,
    data.roof_utilization_pct, data.estimated_generation_units_monthly,
    data.estimated_generation_units_annual, data.inverter_kw,
    data.battery_kwh, data.battery_count, data.total_cost, data.subsidy,
    JSON.stringify(overrides),
  ]);

  // Push auto-suggested values back into data for any field NOT manually overridden.
  // Also persists `_derived` for backend/PDF consumers.
  const lastPushed = useRef('');
  useEffect(() => {
    const patch = {};
    AUTO_FIELDS.forEach((f) => {
      if (!overrides[f]) {
        const newVal = engine[f];
        if (newVal !== undefined && newVal !== null && String(newVal) !== String(data[f])) {
          patch[f] = newVal;
        }
      }
    });
    const derived = {
      net_cost: engine.net_cost,
      monthly_savings: engine.monthly_savings,
      annual_savings: engine.annual_savings,
      annual_elec_savings: engine.annual_elec_savings,
      annual_diesel_savings: engine.annual_diesel_savings,
      payback_years: engine.payback_years,
      roi_pct: engine.roi_pct,
      lifetime_savings: engine.lifetime_savings,
      annual_generation_units: engine.annual_generation_units,
      co2_kg_year: engine.co2_kg_year,
      diesel_petrol_saved_liters_yearly: engine.diesel_petrol_saved_liters_yearly,
      resolved_tariff: engine.resolved_tariff,
      resolved_yield: engine.resolved_yield,
      resolved_monthly_units: engine.resolved_monthly_units,
      resolved_monthly_bill: engine.resolved_monthly_bill,
    };
    const derivedKey = JSON.stringify(derived);
    if (Object.keys(patch).length > 0 || derivedKey !== lastPushed.current) {
      lastPushed.current = derivedKey;
      onChange({ ...data, ...patch, _derived: derived });
    }
  }, [engine]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Setter for any field — driver inputs DON'T flip the override flag; only
  // the auto-calc-able output fields do.
  const updateDriver = useCallback((field, val) => {
    onChange({ ...data, [field]: val });
  }, [data, onChange]);

  const updateAutoField = useCallback((field, val) => {
    const nextOv = { ...(data._overrides || {}), [field]: true };
    onChange({ ...data, [field]: val, _overrides: nextOv });
  }, [data, onChange]);

  const resetField = useCallback((field) => {
    const nextOv = { ...(data._overrides || {}) };
    delete nextOv[field];
    onChange({ ...data, [field]: engine[field], _overrides: nextOv });
  }, [data, onChange, engine]);

  const handleAutoCalculateAll = async () => {
    setRecomputing(true);
    // Clear all overrides → engine output flows back into every AUTO_FIELDS slot
    await new Promise((r) => setTimeout(r, 350));
    onChange({ ...data, _overrides: {} });
    setRecomputing(false);
  };

  // ───── Sub-components ─────
  const Badge = ({ field }) =>
    overrides[field]
      ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">Manual Override</span>
      : <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">Auto Calculated</span>;

  const AutoField = ({ label, field, type = 'number', step = 'any', placeholder, suffix }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-1">
          <Badge field={field} />
          {overrides[field] && (
            <button type="button" onClick={() => resetField(field)} title="Reset to auto-calculated value" className="text-[10px] text-slate-400 hover:text-emerald-600" data-testid={`reset-${field}`}>
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <div className="relative">
        <Input
          type={type}
          step={step}
          value={data[field] ?? ''}
          onChange={(e) => updateAutoField(field, e.target.value)}
          placeholder={placeholder}
          className={`h-10 ${overrides[field] ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50/40 border-emerald-200'} ${suffix ? 'pr-12' : ''}`}
          data-testid={`ps-${field.replace(/_/g, '-')}`}
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">{suffix}</span>}
      </div>
    </div>
  );

  const DriverField = ({ label, field, type = 'number', step = 'any', placeholder, suffix }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          type={type}
          step={step}
          value={data[field] ?? ''}
          onChange={(e) => updateDriver(field, e.target.value)}
          placeholder={placeholder}
          className={`h-10 bg-white ${suffix ? 'pr-12' : ''}`}
          data-testid={`ps-${field.replace(/_/g, '-')}`}
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <Card className="border-emerald-200 bg-emerald-50/30" data-testid="proposed-solution-section">
      <CardContent className="p-4 space-y-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-emerald-600" />
            <div>
              <h3 className="text-base font-semibold font-['Outfit'] text-emerald-800">Proposed Solution &amp; Materials</h3>
              <p className="text-[11px] text-emerald-700">Hybrid calculator — fill the driver inputs, the system auto-suggests hardware &amp; financials. Override anything you like.</p>
            </div>
          </div>
          <Button
            type="button"
            onClick={handleAutoCalculateAll}
            disabled={recomputing}
            className="h-9 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            data-testid="ps-auto-calc-btn"
          >
            {recomputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {recomputing ? 'Calculating…' : 'Auto Calculate'}
          </Button>
        </div>

        {/* ───── 1. Driver Inputs ───── */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Driver Inputs</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DriverField label="Monthly EB Bill (₹)" field="monthly_eb_bill" placeholder="e.g., 3500" />
            <DriverField label="Monthly EB Units" field="monthly_eb_units" placeholder="e.g., 500" />
            <DriverField label="Roof Area (sq ft)" field="roof_area_sqft" placeholder="e.g., 600" />
            <DriverField label="Tariff (₹ / unit)" field="tariff_per_unit" placeholder={`auto: ₹${engine.resolved_tariff}/unit`} />

            <div className="space-y-1">
              <Label className="text-xs">Connection Type</Label>
              <Select value={data.connection_type} onValueChange={(v) => updateDriver('connection_type', v)}>
                <SelectTrigger className="h-10 bg-white" data-testid="ps-connection-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Single Phase">Single Phase</SelectItem>
                  <SelectItem value="Three Phase">Three Phase</SelectItem>
                  <SelectItem value="HT Service">HT Service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tariff Category</Label>
              <Select value={data.tariff_category} onValueChange={(v) => updateDriver('tariff_category', v)}>
                <SelectTrigger className="h-10 bg-white" data-testid="ps-tariff-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Domestic">Domestic</SelectItem>
                  <SelectItem value="Commercial">Commercial</SelectItem>
                  <SelectItem value="Industrial">Industrial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Location (state)</Label>
              <Select value={data.location} onValueChange={(v) => updateDriver('location', v)}>
                <SelectTrigger className="h-10 bg-white" data-testid="ps-location"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(SPECIFIC_YIELD).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">System Type</Label>
              <Select value={data.system_type} onValueChange={(v) => updateDriver('system_type', v)}>
                <SelectTrigger className="h-10 bg-white" data-testid="ps-system-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on-grid">On-Grid</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="off-grid">Off-Grid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(data.system_type === 'hybrid' || data.system_type === 'off-grid') && (
              <DriverField label="Backup Required (hrs / day)" field="power_backup_hours" placeholder="e.g., 4" />
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Specific yield resolved from location: <strong>{engine.resolved_yield} kWh/kWp/day</strong>. Tariff resolved: <strong>₹{engine.resolved_tariff}/unit</strong>. Auto-calc uses these.</p>
        </div>

        {/* ───── 2. System Hardware (auto-fillable, editable) ───── */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" /> System Hardware</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <AutoField label="System Size (kW)" field="system_size_kw" placeholder="auto" />
            <AutoField label="Panel Count" field="panel_count" placeholder="auto" />
            <DriverField label="Panel Wattage (W)" field="panel_wattage_w" placeholder="540" />
            <div className="space-y-1">
              <Label className="text-xs">Panel Model</Label>
              <Input type="text" value={data.panel_model} onChange={(e) => updateDriver('panel_model', e.target.value)} placeholder="e.g., Adani 540W Mono PERC" className="h-10 bg-white" data-testid="ps-panel-model" />
            </div>
            <AutoField label="Panel Area (sq ft)" field="panel_area_sqft" placeholder="auto" />
            <AutoField label="Roof Utilization (%)" field="roof_utilization_pct" placeholder="auto" suffix="%" />
            <AutoField label="Inverter (kW)" field="inverter_kw" placeholder="auto" />
            <div className="space-y-1">
              <Label className="text-xs">Inverter Model</Label>
              <Input type="text" value={data.inverter_model} onChange={(e) => updateDriver('inverter_model', e.target.value)} placeholder="e.g., Sungrow SG5K-D" className="h-10 bg-white" data-testid="ps-inverter-model" />
            </div>
            <AutoField label="Battery (kWh each)" field="battery_kwh" placeholder="auto" />
            <AutoField label="Battery Count" field="battery_count" placeholder="auto" />
          </div>
        </div>

        {/* ───── 3. Generation & Financials ───── */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Generation &amp; Financials</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <AutoField label="Est. Generation (units / month)" field="estimated_generation_units_monthly" placeholder="auto" />
            <AutoField label="Est. Generation (units / year)" field="estimated_generation_units_annual" placeholder="auto" />
            <AutoField label="Total Project Cost (₹)" field="total_cost" placeholder="auto" />
            <AutoField label="Govt Subsidy (₹)" field="subsidy" placeholder="auto" />
            <div className="space-y-1 md:col-span-1">
              <Label className="text-xs">Net Cost (auto)</Label>
              <Input value={inr(engine.net_cost)} readOnly className="h-10 bg-slate-50 font-medium" data-testid="ps-net-cost" />
            </div>
          </div>
        </div>

        {/* ───── 4. Diesel / Petrol Offset ───── */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Fuel className="h-3.5 w-3.5" /> Diesel / Petrol Offset (optional)</p>
          <div className="grid grid-cols-2 gap-3">
            <DriverField label="Litres Saved per Year" field="diesel_offset_liters_yearly" placeholder="e.g., 200" />
            <DriverField label="Fuel Price (₹ / litre)" field="diesel_price_per_liter" placeholder="e.g., 95" />
          </div>
        </div>

        {/* ───── 5. ROI Assumptions ───── */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> ROI Assumptions</p>
          <div className="grid grid-cols-2 gap-3">
            <DriverField label="System Life (years)" field="system_life_years" placeholder="25" />
            <DriverField label="Panel Degradation (% / year)" field="panel_degradation_pct_per_year" placeholder="0.7" />
          </div>
        </div>

        {/* ───── 6. Notes ───── */}
        <div className="space-y-1">
          <Label className="text-xs">Solution Notes / Justification</Label>
          <Textarea
            rows={2}
            value={data.notes}
            onChange={(e) => updateDriver('notes', e.target.value)}
            placeholder="Why this configuration? Any customer-specific tweaks…"
            className="min-h-[60px] bg-white"
            data-testid="ps-solution-notes"
          />
        </div>

        {/* ───── Final Outputs ───── */}
        <div data-testid="ps-derived">
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Final Outputs (live)</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-lg p-2.5 bg-emerald-600 text-white" data-testid="ps-out-payback">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Payback</p>
              <p className="text-base font-bold leading-tight">{engine.payback_years > 0 ? `${engine.payback_years.toFixed(1)} yrs` : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-blue-600 text-white" data-testid="ps-out-roi">
              <p className="text-[9px] uppercase tracking-wider opacity-90">ROI (lifetime)</p>
              <p className="text-base font-bold leading-tight">{engine.roi_pct ? `${Math.round(engine.roi_pct)}%` : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-amber-500 text-white" data-testid="ps-out-monthly">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Monthly Savings</p>
              <p className="text-base font-bold leading-tight">{engine.monthly_savings > 0 ? inr(engine.monthly_savings) : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-violet-600 text-white" data-testid="ps-out-annual">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Annual Savings</p>
              <p className="text-base font-bold leading-tight">{engine.annual_savings > 0 ? inr(engine.annual_savings) : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-rose-600 text-white" data-testid="ps-out-lifetime">
              <p className="text-[9px] uppercase tracking-wider opacity-90">25-Year Lifetime Savings</p>
              <p className="text-base font-bold leading-tight">{engine.lifetime_savings > 0 ? inrL(engine.lifetime_savings) : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-sky-600 text-white" data-testid="ps-out-diesel">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Petrol / Diesel Saved</p>
              <p className="text-base font-bold leading-tight">{engine.diesel_petrol_saved_liters_yearly > 0 ? `${Math.round(engine.diesel_petrol_saved_liters_yearly)} L/yr` : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-emerald-700 text-white" data-testid="ps-out-co2">
              <p className="text-[9px] uppercase tracking-wider opacity-90 flex items-center gap-1"><Leaf className="h-3 w-3" /> CO₂ Saved</p>
              <p className="text-base font-bold leading-tight">{engine.co2_kg_year > 0 ? `${Math.round(engine.co2_kg_year).toLocaleString('en-IN')} kg/yr` : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-slate-700 text-white" data-testid="ps-out-gen">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Annual Generation</p>
              <p className="text-base font-bold leading-tight">{engine.annual_generation_units > 0 ? `${Math.round(engine.annual_generation_units).toLocaleString('en-IN')} units` : '—'}</p>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Outputs live-update as you type. Use <strong>Auto Calculate</strong> to refresh all auto fields at once (manual overrides are kept until you reset them).</p>
        </div>
      </CardContent>
    </Card>
  );
}
