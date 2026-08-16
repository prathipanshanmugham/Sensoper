import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  Package, Leaf, Calendar, TrendingUp, Fuel, Sun,
  Wand2, Loader2, RotateCcw, MapPin, Zap, ChevronDown, ChevronUp
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

  // ───── On-Grid specific ─────
  net_metering: true,
  export_limit_kw: '',

  // ───── Off-Grid specific ─────
  battery_dod_pct: 80,
  autonomy_days: 1,
  charge_controller_type: 'MPPT',

  // ───── Hybrid specific ─────
  grid_charge_enabled: true,
  battery_chemistry: 'LiFePO4',

  // ───── Solar Pump specific ─────
  pump_hp: '',
  pump_type: 'Submersible',
  pump_head_m: '',
  pump_discharge_lph: '',
  pump_controller_type: 'DC (Direct)',
  pump_water_source: 'Borewell',

  // ───── Generation ─────
  estimated_generation_units_monthly: '',
  estimated_generation_units_annual: '',

  // ───── Financials ─────
  total_cost: '',
  subsidy: '',

  // ───── Fuel offset (auto-calculated from generation) ─────
  fuel_type: 'Diesel',
  diesel_offset_liters_yearly: '',   // legacy key kept for backward-compat
  diesel_price_per_liter: '',

  // ───── ROI assumptions ─────
  system_life_years: 25,
  panel_degradation_pct_per_year: 0.7,

  // ───── Notes ─────
  notes: '',

  // ───── Internal state ─────
  _overrides: {},
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
const COST_PER_KWP = { 'on-grid': 55000, 'hybrid': 75000, 'off-grid': 95000, 'solar-pump': 65000 };

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
  // Solar Pump: size from HP (0.75 kW/HP × 1.2 headroom); EB units unused.
  let sysKw;
  if (d.system_type === 'solar-pump') {
    const hp = num(d.pump_hp);
    sysKw = ov.system_size_kw
      ? num(d.system_size_kw)
      : (hp > 0 ? +(hp * 0.75 * 1.2).toFixed(2) : 0);
  } else {
    sysKw = ov.system_size_kw
      ? num(d.system_size_kw)
      : (dailyUnits > 0 ? +(dailyUnits / yield_kwh).toFixed(2) : 0);
  }

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
  if ((d.system_type === 'hybrid' || d.system_type === 'off-grid') && backupHrs > 0 && dailyUnits > 0) {
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

  // Fuel saved — auto-calc from annual generation × fuel factor.
  // We assume a typical diesel genset (~3.6 kWh/L → 0.28 L/kWh). The UI just
  // calls it "Fuel" — internally still flexible if someone overrides via _overrides.
  const FUEL_LITRES_PER_KWH = 0.28;
  const dieselL = ov.diesel_offset_liters_yearly
    ? num(d.diesel_offset_liters_yearly)
    : Math.round(annualGen * FUEL_LITRES_PER_KWH);
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
    diesel_offset_liters_yearly: dieselL,
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
  'diesel_offset_liters_yearly',
];

// ───── Sub-components (module-scoped → stable identity, no remount on parent re-render) ─────

function Badge({ override }) {
  return override
    ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">Manual Override</span>
    : <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">Auto Calculated</span>;
}

function AutoField({ label, field, type = 'number', step = 'any', placeholder, suffix, value, override, onChange, onReset }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-1">
          <Badge override={override} />
          {override && (
            <button type="button" onClick={onReset} title="Reset to auto-calculated value" className="text-[10px] text-slate-400 hover:text-emerald-600" data-testid={`reset-${field}`}>
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <div className="relative">
        <Input
          type={type}
          step={step}
          value={value ?? ''}
          onChange={(e) => onChange(field, e.target.value)}
          placeholder={placeholder}
          className={`h-10 ${override ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50/40 border-emerald-200'} ${suffix ? 'pr-12' : ''}`}
          data-testid={`ps-${field.replace(/_/g, '-')}`}
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">{suffix}</span>}
      </div>
    </div>
  );
}

function DriverField({ label, field, type = 'number', step = 'any', placeholder, suffix, value, onChange }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          type={type}
          step={step}
          value={value ?? ''}
          onChange={(e) => onChange(field, e.target.value)}
          placeholder={placeholder}
          className={`h-10 bg-white ${suffix ? 'pr-12' : ''}`}
          data-testid={`ps-${field.replace(/_/g, '-')}`}
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">{suffix}</span>}
      </div>
    </div>
  );
}

// ───────────────────────── component ─────────────────────────
export default function ProposedSolutionSection({ value, onChange }) {
  const data = { ...blank, ...(value || {}) };
  const overrides = data._overrides || {};
  const [recomputing, setRecomputing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Engine output for current data
  const engine = useMemo(() => autoCalc(data), [
    data.monthly_eb_bill, data.monthly_eb_units, data.roof_area_sqft,
    data.connection_type, data.tariff_category, data.tariff_per_unit,
    data.location, data.power_backup_hours, data.system_type,
    data.panel_wattage_w, data.system_life_years, data.panel_degradation_pct_per_year,
    data.diesel_price_per_liter,
    // Pump driver (solar-pump only):
    data.pump_hp,
    // override-honoured fields:
    data.system_size_kw, data.panel_count, data.panel_area_sqft,
    data.roof_utilization_pct, data.estimated_generation_units_monthly,
    data.estimated_generation_units_annual, data.inverter_kw,
    data.battery_kwh, data.battery_count, data.total_cost, data.subsidy,
    data.diesel_offset_liters_yearly,
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

  return (
    <Card className="border-emerald-200 bg-emerald-50/30" data-testid="proposed-solution-section">
      <CardContent className="p-4 space-y-4">

        {/* ───── Header ───── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-emerald-600" />
            <div>
              <h3 className="text-base font-semibold font-['Outfit'] text-emerald-800">Solar Calculator</h3>
              <p className="text-[11px] text-emerald-700">Type 1-3 inputs below — system size, savings &amp; ROI auto-fill instantly.</p>
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

        {/* ───── HERO Outputs (always visible, big) ───── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="ps-hero-outputs">
          <div className="rounded-lg p-3 bg-emerald-600 text-white">
            <p className="text-[9px] uppercase tracking-wider opacity-90">System Size</p>
            <p className="text-lg font-bold leading-tight">{data.system_size_kw ? `${data.system_size_kw} kW` : '—'}</p>
          </div>
          <div className="rounded-lg p-3 bg-amber-500 text-white" data-testid="ps-out-annual">
            <p className="text-[9px] uppercase tracking-wider opacity-90">Annual Savings</p>
            <p className="text-lg font-bold leading-tight">{engine.annual_savings > 0 ? inr(engine.annual_savings) : '—'}</p>
          </div>
          <div className="rounded-lg p-3 bg-blue-600 text-white" data-testid="ps-out-payback">
            <p className="text-[9px] uppercase tracking-wider opacity-90">Payback</p>
            <p className="text-lg font-bold leading-tight">{engine.payback_years > 0 ? `${engine.payback_years.toFixed(1)} yrs` : '—'}</p>
          </div>
          <div className="rounded-lg p-3 bg-violet-600 text-white" data-testid="ps-out-roi">
            <p className="text-[9px] uppercase tracking-wider opacity-90">ROI (lifetime)</p>
            <p className="text-lg font-bold leading-tight">{engine.roi_pct ? `${Math.round(engine.roi_pct)}%` : '—'}</p>
          </div>
        </div>

        {/* ───── Quick Inputs (always visible — 3 essentials) ───── */}
        <div data-testid="ps-quick-inputs">
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Quick Inputs</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <DriverField label="Monthly EB Bill (₹)" field="monthly_eb_bill" placeholder="e.g., 3500" value={data.monthly_eb_bill} onChange={updateDriver} />
            <div className="space-y-1">
              <Label className="text-xs">System Type</Label>
              <Select value={data.system_type} onValueChange={(v) => updateDriver('system_type', v)}>
                <SelectTrigger className="h-10 bg-white" data-testid="ps-system-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on-grid">On-Grid (no battery)</SelectItem>
                  <SelectItem value="hybrid">Hybrid (with battery)</SelectItem>
                  <SelectItem value="off-grid">Off-Grid (battery only)</SelectItem>
                  <SelectItem value="solar-pump">Solar Pump (agri / borewell)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Location</Label>
              <Select value={data.location} onValueChange={(v) => updateDriver('location', v)}>
                <SelectTrigger className="h-10 bg-white" data-testid="ps-location"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(SPECIFIC_YIELD).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* ───── Show / Hide advanced ───── */}
        <button
          type="button"
          onClick={() => setShowAdvanced(s => !s)}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-emerald-700 hover:text-emerald-900 py-1.5 border border-dashed border-emerald-300 rounded-md"
          data-testid="ps-toggle-advanced"
        >
          {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showAdvanced ? 'Hide advanced options' : 'Show more options (hardware, fuel, ROI assumptions)'}
        </button>

        {showAdvanced && (
        <>
          {/* ───── Extra Drivers ───── */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2">Optional Driver Inputs</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <DriverField label="Monthly EB Units" field="monthly_eb_units" placeholder="auto from bill" value={data.monthly_eb_units} onChange={updateDriver} />
              <DriverField label="Roof Area (sq ft)" field="roof_area_sqft" placeholder="e.g., 600" value={data.roof_area_sqft} onChange={updateDriver} />
              <DriverField label="Tariff (₹ / unit)" field="tariff_per_unit" placeholder={`auto: ₹${engine.resolved_tariff}/unit`} value={data.tariff_per_unit} onChange={updateDriver} />
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
              {(data.system_type === 'hybrid' || data.system_type === 'off-grid') && (
                <DriverField label="Backup (hrs / day)" field="power_backup_hours" placeholder="e.g., 4" value={data.power_backup_hours} onChange={updateDriver} />
              )}
            </div>
          </div>

          {/* ───── System-Type-Specific Fields ───── */}
          {data.system_type === 'on-grid' && (
            <div data-testid="ps-ongrid-block">
              <p className="text-[11px] uppercase tracking-wider text-blue-700 font-semibold mb-2 flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> On-Grid Details</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Net Metering</Label>
                  <Select value={String(!!data.net_metering)} onValueChange={(v) => updateDriver('net_metering', v === 'true')}>
                    <SelectTrigger className="h-10 bg-white" data-testid="ps-net-metering"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes (Bi-directional meter)</SelectItem>
                      <SelectItem value="false">No (Gross metering)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DriverField label="Export Limit (kW)" field="export_limit_kw" placeholder="e.g., 5" value={data.export_limit_kw} onChange={updateDriver} />
              </div>
            </div>
          )}

          {data.system_type === 'off-grid' && (
            <div data-testid="ps-offgrid-block">
              <p className="text-[11px] uppercase tracking-wider text-orange-700 font-semibold mb-2 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" /> Off-Grid Details</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <DriverField label="Depth of Discharge (%)" field="battery_dod_pct" placeholder="80" suffix="%" value={data.battery_dod_pct} onChange={updateDriver} />
                <DriverField label="Autonomy (days)" field="autonomy_days" placeholder="1" value={data.autonomy_days} onChange={updateDriver} />
                <div className="space-y-1">
                  <Label className="text-xs">Charge Controller</Label>
                  <Select value={data.charge_controller_type} onValueChange={(v) => updateDriver('charge_controller_type', v)}>
                    <SelectTrigger className="h-10 bg-white" data-testid="ps-charge-controller"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MPPT">MPPT (Recommended)</SelectItem>
                      <SelectItem value="PWM">PWM (Basic)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {data.system_type === 'hybrid' && (
            <div data-testid="ps-hybrid-block">
              <p className="text-[11px] uppercase tracking-wider text-violet-700 font-semibold mb-2 flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Hybrid Details</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Grid Charging</Label>
                  <Select value={String(!!data.grid_charge_enabled)} onValueChange={(v) => updateDriver('grid_charge_enabled', v === 'true')}>
                    <SelectTrigger className="h-10 bg-white" data-testid="ps-grid-charge"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Allowed</SelectItem>
                      <SelectItem value="false">Solar-only charge</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Battery Chemistry</Label>
                  <Select value={data.battery_chemistry} onValueChange={(v) => updateDriver('battery_chemistry', v)}>
                    <SelectTrigger className="h-10 bg-white" data-testid="ps-battery-chemistry"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LiFePO4">LiFePO4 (Lithium)</SelectItem>
                      <SelectItem value="Li-ion">Li-ion NMC</SelectItem>
                      <SelectItem value="Tubular">Tubular Lead Acid</SelectItem>
                      <SelectItem value="Gel">Gel Lead Acid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DriverField label="Depth of Discharge (%)" field="battery_dod_pct" placeholder="80" suffix="%" value={data.battery_dod_pct} onChange={updateDriver} />
              </div>
            </div>
          )}

          {data.system_type === 'solar-pump' && (
            <div data-testid="ps-pump-block">
              <p className="text-[11px] uppercase tracking-wider text-cyan-700 font-semibold mb-2 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" /> Solar Pump Details</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <DriverField label="Pump Rating (HP)" field="pump_hp" placeholder="e.g., 3" value={data.pump_hp} onChange={updateDriver} />
                <div className="space-y-1">
                  <Label className="text-xs">Pump Type</Label>
                  <Select value={data.pump_type} onValueChange={(v) => updateDriver('pump_type', v)}>
                    <SelectTrigger className="h-10 bg-white" data-testid="ps-pump-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Submersible">Submersible</SelectItem>
                      <SelectItem value="Surface">Surface (Monoblock)</SelectItem>
                      <SelectItem value="Openwell">Openwell</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DriverField label="Total Head (m)" field="pump_head_m" placeholder="e.g., 50" suffix="m" value={data.pump_head_m} onChange={updateDriver} />
                <DriverField label="Discharge (LPH)" field="pump_discharge_lph" placeholder="e.g., 10000" value={data.pump_discharge_lph} onChange={updateDriver} />
                <div className="space-y-1">
                  <Label className="text-xs">Controller</Label>
                  <Select value={data.pump_controller_type} onValueChange={(v) => updateDriver('pump_controller_type', v)}>
                    <SelectTrigger className="h-10 bg-white" data-testid="ps-pump-controller"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DC (Direct)">DC (Direct)</SelectItem>
                      <SelectItem value="VFD (AC)">VFD (AC)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Water Source</Label>
                  <Select value={data.pump_water_source} onValueChange={(v) => updateDriver('pump_water_source', v)}>
                    <SelectTrigger className="h-10 bg-white" data-testid="ps-pump-source"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Borewell">Borewell</SelectItem>
                      <SelectItem value="Openwell">Openwell</SelectItem>
                      <SelectItem value="Canal">Canal / Pond</SelectItem>
                      <SelectItem value="Tank">Overhead Tank</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Solar Pump sizing uses ≈0.75 kW per HP with 20% headroom; monthly EB &amp; tariff fields are ignored for savings calc — instead ROI compares against grid-pumping or diesel pumpset.</p>
            </div>
          )}

          {/* ───── System Hardware ───── */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" /> System Hardware</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <AutoField label="System Size (kW)" field="system_size_kw" placeholder="auto" value={data.system_size_kw} override={!!overrides.system_size_kw} onChange={updateAutoField} onReset={() => resetField('system_size_kw')} />
              <AutoField label="Panel Count" field="panel_count" placeholder="auto" value={data.panel_count} override={!!overrides.panel_count} onChange={updateAutoField} onReset={() => resetField('panel_count')} />
              <DriverField label="Panel Wattage (W)" field="panel_wattage_w" placeholder="540" value={data.panel_wattage_w} onChange={updateDriver} />
              <div className="space-y-1">
                <Label className="text-xs">Panel Model</Label>
                <Input type="text" value={data.panel_model} onChange={(e) => updateDriver('panel_model', e.target.value)} placeholder="e.g., Adani 540W Mono PERC" className="h-10 bg-white" data-testid="ps-panel-model" />
              </div>
              <AutoField label="Panel Area (sq ft)" field="panel_area_sqft" placeholder="auto" value={data.panel_area_sqft} override={!!overrides.panel_area_sqft} onChange={updateAutoField} onReset={() => resetField('panel_area_sqft')} />
              <AutoField label="Roof Utilization (%)" field="roof_utilization_pct" placeholder="auto" suffix="%" value={data.roof_utilization_pct} override={!!overrides.roof_utilization_pct} onChange={updateAutoField} onReset={() => resetField('roof_utilization_pct')} />
              <AutoField label="Inverter (kW)" field="inverter_kw" placeholder="auto" value={data.inverter_kw} override={!!overrides.inverter_kw} onChange={updateAutoField} onReset={() => resetField('inverter_kw')} />
              <div className="space-y-1">
                <Label className="text-xs">Inverter Model</Label>
                <Input type="text" value={data.inverter_model} onChange={(e) => updateDriver('inverter_model', e.target.value)} placeholder="e.g., Sungrow SG5K-D" className="h-10 bg-white" data-testid="ps-inverter-model" />
              </div>
              {(data.system_type === 'hybrid' || data.system_type === 'off-grid') && (
                <>
                  <AutoField label="Battery (kWh each)" field="battery_kwh" placeholder="auto" value={data.battery_kwh} override={!!overrides.battery_kwh} onChange={updateAutoField} onReset={() => resetField('battery_kwh')} />
                  <AutoField label="Battery Count" field="battery_count" placeholder="auto" value={data.battery_count} override={!!overrides.battery_count} onChange={updateAutoField} onReset={() => resetField('battery_count')} />
                </>
              )}
            </div>
          </div>

          {/* ───── Generation & Financials ───── */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Generation &amp; Financials</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <AutoField label="Generation (units / month)" field="estimated_generation_units_monthly" placeholder="auto" value={data.estimated_generation_units_monthly} override={!!overrides.estimated_generation_units_monthly} onChange={updateAutoField} onReset={() => resetField('estimated_generation_units_monthly')} />
              <AutoField label="Generation (units / year)" field="estimated_generation_units_annual" placeholder="auto" value={data.estimated_generation_units_annual} override={!!overrides.estimated_generation_units_annual} onChange={updateAutoField} onReset={() => resetField('estimated_generation_units_annual')} />
              <AutoField label="Total Cost (₹)" field="total_cost" placeholder="auto" value={data.total_cost} override={!!overrides.total_cost} onChange={updateAutoField} onReset={() => resetField('total_cost')} />
              <AutoField label="Govt Subsidy (₹)" field="subsidy" placeholder="auto" value={data.subsidy} override={!!overrides.subsidy} onChange={updateAutoField} onReset={() => resetField('subsidy')} />
              <div className="space-y-1">
                <Label className="text-xs">Net Cost (auto)</Label>
                <Input value={inr(engine.net_cost)} readOnly className="h-10 bg-slate-50 font-medium" data-testid="ps-net-cost" />
              </div>
            </div>
          </div>

          {/* ───── Fuel saved (auto from generation) ───── */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Fuel className="h-3.5 w-3.5" /> Fuel Saved <span className="font-normal text-slate-400">(auto from generation)</span></p>
            <div className="grid grid-cols-2 gap-3">
              <AutoField
                label="Fuel Saved (litres / year)"
                field="diesel_offset_liters_yearly"
                placeholder="auto"
                value={data.diesel_offset_liters_yearly}
                override={!!overrides.diesel_offset_liters_yearly}
                onChange={updateAutoField}
                onReset={() => resetField('diesel_offset_liters_yearly')}
              />
              <DriverField label="Fuel Price (₹ / litre)" field="diesel_price_per_liter" placeholder="e.g., 95" value={data.diesel_price_per_liter} onChange={updateDriver} />
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">Litres saved = Annual generation × 0.28 L/kWh (typical genset). Override if you have a measured figure.</p>
          </div>

          {/* ───── ROI Assumptions ───── */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> ROI Assumptions</p>
            <div className="grid grid-cols-2 gap-3">
              <DriverField label="System Life (years)" field="system_life_years" placeholder="25" value={data.system_life_years} onChange={updateDriver} />
              <DriverField label="Panel Degradation (% / year)" field="panel_degradation_pct_per_year" placeholder="0.7" value={data.panel_degradation_pct_per_year} onChange={updateDriver} />
            </div>
          </div>

          {/* ───── Secondary outputs (in advanced area) ───── */}
          <div data-testid="ps-derived">
            <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> All Outputs</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-lg p-2.5 bg-amber-500 text-white" data-testid="ps-out-monthly">
                <p className="text-[9px] uppercase tracking-wider opacity-90">Monthly Savings</p>
                <p className="text-base font-bold leading-tight">{engine.monthly_savings > 0 ? inr(engine.monthly_savings) : '—'}</p>
              </div>
              <div className="rounded-lg p-2.5 bg-rose-600 text-white" data-testid="ps-out-lifetime">
                <p className="text-[9px] uppercase tracking-wider opacity-90">25-Year Lifetime Savings</p>
                <p className="text-base font-bold leading-tight">{engine.lifetime_savings > 0 ? inrL(engine.lifetime_savings) : '—'}</p>
              </div>
              <div className="rounded-lg p-2.5 bg-sky-600 text-white" data-testid="ps-out-diesel">
                <p className="text-[9px] uppercase tracking-wider opacity-90">Fuel Saved</p>
                <p className="text-base font-bold leading-tight">{engine.diesel_petrol_saved_liters_yearly > 0 ? `${Math.round(engine.diesel_petrol_saved_liters_yearly)} L/yr` : '—'}</p>
              </div>
              <div className="rounded-lg p-2.5 bg-emerald-700 text-white" data-testid="ps-out-co2">
                <p className="text-[9px] uppercase tracking-wider opacity-90 flex items-center gap-1"><Leaf className="h-3 w-3" /> CO₂ Saved</p>
                <p className="text-base font-bold leading-tight">{engine.co2_kg_year > 0 ? `${Math.round(engine.co2_kg_year).toLocaleString('en-IN')} kg/yr` : '—'}</p>
              </div>
              <div className="rounded-lg p-2.5 bg-slate-700 text-white col-span-2 md:col-span-1" data-testid="ps-out-gen">
                <p className="text-[9px] uppercase tracking-wider opacity-90">Annual Generation</p>
                <p className="text-base font-bold leading-tight">{engine.annual_generation_units > 0 ? `${Math.round(engine.annual_generation_units).toLocaleString('en-IN')} units` : '—'}</p>
              </div>
            </div>
          </div>
        </>
        )}

        {/* ───── Notes (always visible) ───── */}
        <div className="space-y-1">
          <Label className="text-xs">Solution Notes</Label>
          <Textarea
            rows={2}
            value={data.notes}
            onChange={(e) => updateDriver('notes', e.target.value)}
            placeholder="Anything specific about this customer or installation…"
            className="min-h-[60px] bg-white"
            data-testid="ps-solution-notes"
          />
        </div>

      </CardContent>
    </Card>
  );
}
