import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { AlertTriangle, PackageOpen } from 'lucide-react';
import { OverridableNumber, NumberField } from './CalcFields';
import { CalcResult } from './CalcResult';

const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;

function StepTitle({ n, title, sub }) {
  return (
    <div className="flex items-baseline gap-2 pt-1">
      <span className="h-5 w-5 rounded-full bg-slate-900 text-white text-[11px] font-bold inline-flex items-center justify-center flex-shrink-0">{n}</span>
      <p className="text-sm font-semibold text-slate-800">{title}{sub && <span className="text-slate-400 font-normal"> — {sub}</span>}</p>
    </div>
  );
}

function ItemPicker({ label, items, value, onChange, category, testid, warnings, format, hint }) {
  const empty = items.length === 0;
  return (
    <div className="space-y-1" data-testid={`${testid}-field`}>
      <Label className="text-xs text-slate-700">{label}</Label>
      <Select value={value || ''} onValueChange={onChange} disabled={empty}>
        <SelectTrigger className="h-11 bg-white text-base" data-testid={testid}><SelectValue placeholder={empty ? 'None in inventory' : `Select ${label.toLowerCase()}…`} /></SelectTrigger>
        <SelectContent>{items.map(it => <SelectItem key={it.id} value={it.id}>{format(it)}</SelectItem>)}</SelectContent>
      </Select>
      {empty && <p className="text-[11px] text-amber-800 flex items-start gap-1" data-testid={`${testid}-empty`}><PackageOpen className="h-3 w-3 mt-0.5 flex-shrink-0" />No {label.toLowerCase()}s in Inventory (category “{category}”). Add one under Inventory to price exactly — a benchmark rate is used until then.</p>}
      {!empty && hint && !warnings.length && <p className="text-[11px] text-slate-500" data-testid={`${testid}-hint`}>{hint}</p>}
      {warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-800 flex items-start gap-1" data-testid={`${testid}-warning`}><AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />{w}</p>)}
    </div>
  );
}

export function GridSolarFlow({ data, r, set, config, panels, inverters, batteries }) {
  const ov = data.overrides || {};
  const setOv = (k, v) => set({ overrides: { ...ov, [k]: v } });
  const warnFor = (f) => (r?.warnings || []).filter(w => w.field === f).map(w => w.message);
  const needsBattery = data.system_type === 'hybrid' || data.system_type === 'off-grid';
  const hasUnits = (r?.monthly_eb_units || 0) > 0;
  const configMissing = !config;

  return (
    <div className="space-y-5">
      {configMissing && <p className="text-[11px] text-amber-800 flex items-center gap-1" data-testid="calc-config-loading"><AlertTriangle className="h-3 w-3" />Loading calculator constants… results use built-in defaults until then.</p>}

      {/* Step 1 — customer's bill */}
      <StepTitle n={1} title="Customer's electricity use" sub="enter the bill or the units" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <NumberField label="Monthly EB bill" unit="₹" value={data.monthly_eb_bill} onChange={(v) => set({ monthly_eb_bill: v })} step={100} placeholder="e.g. 3000" testid="bill"
          hint={r?.units_source === 'from_bill' ? `≈ ${r.monthly_eb_units} units/month at ₹${r.tariff_per_unit}/unit` : undefined} />
        <NumberField label="Units per month" unit="kWh" value={data.monthly_eb_units_entered} onChange={(v) => set({ monthly_eb_units_entered: v })} step={10} placeholder="if known" testid="units" optional
          hint={r?.units_source === 'entered' ? 'Units override the bill' : undefined} />
        <OverridableNumber label="Tariff" unit="₹/unit" autoValue={config?.default_tariff_per_unit ?? 8} value={data.tariff_per_unit_manual} onChange={(v) => set({ tariff_per_unit_manual: v })} step={0.5} testid="tariff" />
      </div>
      {!hasUnits && <p className="text-xs text-slate-500 rounded-md bg-slate-50 border border-dashed border-slate-200 px-3 py-2" data-testid="calc-waiting-bill">Enter the customer's monthly bill (or units) to size the system.</p>}

      {/* Step 2 — system size & products */}
      <StepTitle n={2} title="System" sub={hasUnits ? `${r.daily_units} units/day ÷ ${r.specific_yield} sun-hours` : undefined} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <OverridableNumber label="System size" unit="kW" autoValue={r?.system_size_kw_auto ?? 0} value={ov.system_size_kw} onChange={(v) => setOv('system_size_kw', v)} step={0.5} testid="system-size"
          warnings={warnFor('system_size_kw')} hint={hasUnits ? 'Rounded up to the next 0.5 kW' : 'Auto from the bill — or type a size'} />
        <NumberField label="Roof area" unit="sq ft" value={data.roof_area_sqft} onChange={(v) => set({ roof_area_sqft: v })} step={50} placeholder="caps the size" testid="roof" optional
          hint={r?.roof_cap_kw != null ? `Fits up to ${r.roof_cap_kw} kW (100 sq ft per kW)` : undefined} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ItemPicker label="Panel" category="solar_panels" items={panels} value={data.panel_item_id} onChange={(v) => set({ panel_item_id: v })} testid="panel-picker" warnings={warnFor('panel_item_id')}
          format={(p) => `${p.name}${p.specs?.wattage ? ` — ${p.specs.wattage} W` : ''}`} hint={r?.lines?.panels?.unit_price ? `${inr(r.lines.panels.unit_price)} each` : undefined} />
        <OverridableNumber label="Panel count" unit="nos" autoValue={r?.panel_count_auto ?? ''} value={ov.panel_count} onChange={(v) => setOv('panel_count', v)} step={1} testid="panel-count"
          disabled={!data.panel_item_id} placeholder={data.panel_item_id ? '' : 'pick a panel first'} hint={r?.panel_wattage_w ? `${r.system_size_kw} kW ÷ ${r.panel_wattage_w} W, rounded up` : undefined} />
      </div>
      <ItemPicker label="Inverter" category="inverters" items={inverters} value={data.inverter_item_id} onChange={(v) => set({ inverter_item_id: v })} testid="inverter-picker" warnings={warnFor('inverter_item_id')}
        format={(i) => `${i.name}${i.specs?.rated_kw ? ` — ${i.specs.rated_kw} kW` : ''}`} hint={r?.inverter_rated_kw ? `${r.inverter_rated_kw} kW inverter for a ${r.system_size_kw} kW array — OK` : undefined} />

      {needsBattery && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 space-y-3" data-testid="battery-block">
          <p className="text-xs font-semibold text-sky-900">Battery backup</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumberField label="Backup needed" unit="hours" value={data.backup_hours} onChange={(v) => set({ backup_hours: v })} step={1} placeholder={data.system_type === 'off-grid' ? '8' : '4'} testid="backup-hours"
              hint={r?.battery_kwh_needed ? `Needs ${r.battery_kwh_needed} kWh of storage` : undefined} />
            <ItemPicker label="Battery" category="batteries" items={batteries} value={data.battery_item_id} onChange={(v) => set({ battery_item_id: v })} testid="battery-picker" warnings={warnFor('battery_item_id')}
              format={(b) => `${b.name}${b.specs?.kwh ? ` — ${b.specs.kwh} kWh` : ''}`} hint={r?.lines?.battery?.unit_price ? `${inr(r.lines.battery.unit_price)} each` : undefined} />
            <OverridableNumber label="Battery count" unit="nos" autoValue={r?.battery_count_auto ?? ''} value={ov.battery_count} onChange={(v) => setOv('battery_count', v)} step={1} testid="battery-count"
              hint={r?.battery_unit_kwh ? `${r.battery_kwh_needed} kWh ÷ ${r.battery_unit_kwh} kWh each` : undefined} />
          </div>
        </div>
      )}

      {/* Step 3 — price */}
      <StepTitle n={3} title="Price" sub="before GST" />
      <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 text-sm" data-testid="cost-lines">
        <CostLine label={`Panels${r?.panel_count ? ` · ${r.panel_count} × ${r.panel_wattage_w || '?'} W` : ''}`} line={r?.lines?.panels} testid="line-panels" />
        <CostLine label="Inverter" line={r?.lines?.inverter} testid="line-inverter" />
        {needsBattery && <CostLine label={`Battery${r?.battery_count ? ` · ${r.battery_count} nos` : ''}`} line={r?.lines?.battery} testid="line-battery" />}
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex-1">
            <OverridableNumber label="Structure, cabling & installation" unit="₹" autoValue={r?.lines?.bos?.auto ?? 0} value={ov.bos_cost} onChange={(v) => setOv('bos_cost', v)} step={1000} testid="bos" />
          </div>
        </div>
        <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50">
          <span className="font-semibold text-slate-800">Total system price</span>
          <span className="font-bold text-slate-900 text-base" data-testid="result-total-cost">{inr(r?.total_cost)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-slate-700">Subsidy <span className="text-slate-400">(₹, enter sanctioned amount)</span></Label>
            <Input type="number" inputMode="numeric" min="0" step={1000} value={data.subsidy ?? ''} onChange={(e) => set({ subsidy: e.target.value })} placeholder="0" className="h-11 text-base bg-white" data-testid="subsidy-input" />
            {r?.subsidy_reference > 0 && !warnFor('subsidy').length && <p className="text-[11px] text-slate-500" data-testid="subsidy-hint">PM Surya Ghar reference for {r.system_size_kw} kW residential: {inr(r.subsidy_reference)}</p>}
            {warnFor('subsidy').map((w, i) => <p key={i} className="text-[11px] text-amber-800 flex items-start gap-1" data-testid="subsidy-warning"><AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />{w}</p>)}
          </div>
        </div>
      </div>

      <CalcResult r={r} />
    </div>
  );
}

function CostLine({ label, line, testid }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2" data-testid={testid}>
      <span className="text-slate-700">{label}{line?.benchmark && <span className="ml-2 rounded bg-slate-100 text-slate-500 px-1.5 py-0.5 text-[10px] uppercase tracking-wider" data-testid={`${testid}-benchmark`}>benchmark</span>}</span>
      <span className="font-medium text-slate-900 whitespace-nowrap">{inr(line?.amount)}</span>
    </div>
  );
}
