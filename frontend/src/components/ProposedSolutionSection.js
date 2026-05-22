import { useMemo } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Package, IndianRupee, Leaf, Calendar, TrendingUp, Fuel, Sun } from 'lucide-react';

const blank = {
  // System hardware (manual)
  system_size_kw: '',
  panel_count: '',
  panel_wattage_w: '',
  panel_model: '',
  inverter_kw: '',
  inverter_model: '',
  battery_kwh: '',
  battery_count: '',
  // Generation & consumption
  estimated_generation_units_monthly: '',
  eb_consumption_units_monthly: '',
  // Costs
  total_cost: '',
  subsidy: '',
  tariff_per_unit: '',
  // Fuel offset
  diesel_offset_liters_yearly: '',
  diesel_price_per_liter: '',
  // ROI assumptions
  system_life_years: 25,
  panel_degradation_pct_per_year: 0.7,
  // Notes
  notes: '',
};

/** Convert empty string → 0 numerically; preserves user-typed leading zeros. */
const n = (v) => {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : 0;
};

const inr = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const inrL = (v) => `₹${(v / 100000).toFixed(2)} L`;

/**
 * Manual editable Proposed Solution + Materials calculator.
 * Lives inside the Materials step. NO auto-sizing — every value is typed
 * by the user; the right column shows live-derived ROI / payback / savings
 * etc. so the calculator updates as you type.
 *
 * `value` is the persisted `proposed_solution` object on the project.
 * `onChange` receives the merged object on every edit.
 */
export default function ProposedSolutionSection({ value, onChange }) {
  const data = { ...blank, ...(value || {}) };
  const update = (patch) => onChange({ ...data, ...patch });

  // ---------- Derived (live) ----------
  const derived = useMemo(() => {
    const totalCost = n(data.total_cost);
    const subsidy = n(data.subsidy);
    const netCost = Math.max(totalCost - subsidy, 0);

    const monthlyGen = n(data.estimated_generation_units_monthly);
    const monthlyEB = n(data.eb_consumption_units_monthly);
    const tariff = n(data.tariff_per_unit);

    // Electricity savings — only counts the units that actually offset EB usage
    const offsetUnitsMonthly = Math.min(monthlyGen, monthlyEB > 0 ? monthlyEB : monthlyGen);
    const monthlyElec = offsetUnitsMonthly * tariff;
    const annualElec = monthlyElec * 12;

    const dieselLiters = n(data.diesel_offset_liters_yearly);
    const dieselPrice = n(data.diesel_price_per_liter);
    const annualDiesel = dieselLiters * dieselPrice;

    const annualSavings = annualElec + annualDiesel;
    const monthlySavings = annualSavings / 12;

    const life = Math.max(n(data.system_life_years) || 25, 1);
    const degr = Math.max(n(data.panel_degradation_pct_per_year), 0) / 100;

    // Lifetime savings — applies degradation to electricity portion only
    let lifetimeElec = 0;
    for (let y = 1; y <= life; y++) {
      lifetimeElec += annualElec * Math.pow(1 - degr, y - 1);
    }
    const lifetimeSavings = lifetimeElec + annualDiesel * life;

    const paybackYears = annualSavings > 0 ? netCost / annualSavings : 0;
    const roiPct = netCost > 0 ? ((lifetimeSavings - netCost) / netCost) * 100 : 0;

    // CO₂ reduction — India grid emission factor ~0.82 kg CO2 per kWh
    const annualGen = monthlyGen * 12;
    const co2KgYear = annualGen * 0.82;

    return {
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
      diesel_petrol_saved_liters_yearly: dieselLiters,
    };
  }, [data.total_cost, data.subsidy, data.estimated_generation_units_monthly,
      data.eb_consumption_units_monthly, data.tariff_per_unit,
      data.diesel_offset_liters_yearly, data.diesel_price_per_liter,
      data.system_life_years, data.panel_degradation_pct_per_year]);

  // Push derived into the persisted object so backend/PDF have access.
  // Use a stable JSON compare to avoid an update loop.
  const derivedString = JSON.stringify(derived);
  const persistedDerivedString = JSON.stringify(data._derived || {});
  if (derivedString !== persistedDerivedString) {
    // Defer to next tick to dodge "setState during render" warning.
    setTimeout(() => onChange({ ...data, _derived: derived }), 0);
  }

  const Field = ({ label, testId, type = 'number', step = 'any', placeholder, prop, suffix }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Input
          type={type}
          step={step}
          value={data[prop]}
          onChange={(e) => update({ [prop]: e.target.value })}
          placeholder={placeholder}
          className={`h-10 bg-white ${suffix ? 'pr-12' : ''}`}
          data-testid={testId}
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <Card className="border-emerald-200 bg-emerald-50/30" data-testid="proposed-solution-section">
      <CardContent className="p-4 space-y-5">
        <div className="flex items-center gap-2">
          <Sun className="h-5 w-5 text-emerald-600" />
          <div>
            <h3 className="text-base font-semibold font-['Outfit'] text-emerald-800">Proposed Solution &amp; Materials</h3>
            <p className="text-[11px] text-emerald-700">Manual calculator — type values and derived metrics update live.</p>
          </div>
        </div>

        {/* --- System Hardware --- */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Package className="h-3.5 w-3.5" /> System Hardware</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="System Size (kW)" prop="system_size_kw" testId="ps-system-size" placeholder="e.g., 5" />
            <Field label="Panel Count" prop="panel_count" testId="ps-panel-count" placeholder="e.g., 10" />
            <Field label="Panel Wattage (W)" prop="panel_wattage_w" testId="ps-panel-w" placeholder="540" />
            <div className="space-y-1">
              <Label className="text-xs">Panel Model</Label>
              <Input type="text" value={data.panel_model} onChange={(e) => update({ panel_model: e.target.value })} placeholder="e.g., Adani 540W Mono PERC" className="h-10 bg-white" data-testid="ps-panel-model" />
            </div>
            <Field label="Inverter (kW)" prop="inverter_kw" testId="ps-inverter-kw" placeholder="e.g., 5" />
            <div className="space-y-1">
              <Label className="text-xs">Inverter Model</Label>
              <Input type="text" value={data.inverter_model} onChange={(e) => update({ inverter_model: e.target.value })} placeholder="e.g., Sungrow SG5K-D" className="h-10 bg-white" data-testid="ps-inverter-model" />
            </div>
            <Field label="Battery (kWh each)" prop="battery_kwh" testId="ps-battery-kwh" placeholder="e.g., 5" />
            <Field label="Battery Count" prop="battery_count" testId="ps-battery-count" placeholder="e.g., 1" />
          </div>
        </div>

        {/* --- Generation & EB Consumption --- */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Generation &amp; EB Consumption</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Est. Generation (units / month)" prop="estimated_generation_units_monthly" testId="ps-est-gen" placeholder="e.g., 600" />
            <Field label="EB Consumption (units / month)" prop="eb_consumption_units_monthly" testId="ps-eb-cons" placeholder="e.g., 500" />
            <Field label="Tariff (₹ / unit)" prop="tariff_per_unit" testId="ps-tariff" placeholder="e.g., 7.5" />
          </div>
        </div>

        {/* --- Cost & Subsidy --- */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><IndianRupee className="h-3.5 w-3.5" /> Cost &amp; Subsidy</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Total Project Cost (₹)" prop="total_cost" testId="ps-total-cost" placeholder="e.g., 275000" />
            <Field label="Govt Subsidy (₹)" prop="subsidy" testId="ps-subsidy" placeholder="e.g., 78000" />
            <div className="space-y-1">
              <Label className="text-xs">Net Cost (auto)</Label>
              <Input value={inr(derived.net_cost)} readOnly className="h-10 bg-slate-50 font-medium" data-testid="ps-net-cost" />
            </div>
          </div>
        </div>

        {/* --- Diesel / Petrol Offset --- */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Fuel className="h-3.5 w-3.5" /> Diesel / Petrol Offset (optional)</p>
          <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
            <Field label="Litres Saved per Year" prop="diesel_offset_liters_yearly" testId="ps-diesel-l" placeholder="e.g., 200" />
            <Field label="Fuel Price (₹ / litre)" prop="diesel_price_per_liter" testId="ps-diesel-price" placeholder="e.g., 95" />
          </div>
        </div>

        {/* --- ROI Assumptions --- */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> ROI Assumptions</p>
          <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
            <Field label="System Life (years)" prop="system_life_years" testId="ps-life" placeholder="25" />
            <Field label="Panel Degradation (% / year)" prop="panel_degradation_pct_per_year" testId="ps-degr" placeholder="0.7" />
          </div>
        </div>

        {/* --- Notes --- */}
        <div className="space-y-1">
          <Label className="text-xs">Solution Notes / Justification</Label>
          <Textarea
            rows={2}
            value={data.notes}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="Why this configuration? Any customer-specific tweaks…"
            className="min-h-[60px] bg-white"
            data-testid="ps-solution-notes"
          />
        </div>

        {/* --- Live Derived Metrics --- */}
        <div data-testid="ps-derived">
          <p className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold mb-2 flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Live Calculated Outcomes</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-lg p-2.5 bg-emerald-600 text-white" data-testid="ps-out-payback">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Payback</p>
              <p className="text-base font-bold leading-tight">{derived.payback_years > 0 ? `${derived.payback_years.toFixed(1)} yrs` : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-blue-600 text-white" data-testid="ps-out-roi">
              <p className="text-[9px] uppercase tracking-wider opacity-90">ROI (life)</p>
              <p className="text-base font-bold leading-tight">{derived.roi_pct ? `${Math.round(derived.roi_pct)}%` : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-amber-500 text-white" data-testid="ps-out-monthly">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Monthly Savings</p>
              <p className="text-base font-bold leading-tight">{derived.monthly_savings > 0 ? inr(derived.monthly_savings) : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-violet-600 text-white" data-testid="ps-out-annual">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Annual Savings</p>
              <p className="text-base font-bold leading-tight">{derived.annual_savings > 0 ? inr(derived.annual_savings) : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-rose-600 text-white" data-testid="ps-out-lifetime">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Lifetime Savings</p>
              <p className="text-base font-bold leading-tight">{derived.lifetime_savings > 0 ? inrL(derived.lifetime_savings) : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-sky-600 text-white" data-testid="ps-out-diesel">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Diesel / Petrol Saved</p>
              <p className="text-base font-bold leading-tight">{derived.diesel_petrol_saved_liters_yearly > 0 ? `${Math.round(derived.diesel_petrol_saved_liters_yearly)} L/yr` : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-emerald-700 text-white" data-testid="ps-out-co2">
              <p className="text-[9px] uppercase tracking-wider opacity-90 flex items-center gap-1"><Leaf className="h-3 w-3" /> CO₂ Reduction</p>
              <p className="text-base font-bold leading-tight">{derived.co2_kg_year > 0 ? `${Math.round(derived.co2_kg_year).toLocaleString('en-IN')} kg/yr` : '—'}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-slate-700 text-white" data-testid="ps-out-gen">
              <p className="text-[9px] uppercase tracking-wider opacity-90">Annual Generation</p>
              <p className="text-base font-bold leading-tight">{derived.annual_generation_units > 0 ? `${Math.round(derived.annual_generation_units).toLocaleString('en-IN')} units` : '—'}</p>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-2">All numbers above are live-derived from your manual inputs. They are saved with the project and used in the PDF.</p>
        </div>
      </CardContent>
    </Card>
  );
}
