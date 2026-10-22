import { useState } from 'react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { AlertTriangle, ChevronDown, PackageOpen } from 'lucide-react';
import { OverridableNumber, NumberField } from './CalcFields';
import { CalcResult } from './CalcResult';

const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;
const filled = (v) => v !== undefined && v !== null && v !== '' && Number(v) !== 0;

function StepTitle({ n, title, sub }) {
  return (
    <div className="flex items-baseline gap-2 pt-1">
      <span className="h-5 w-5 rounded-full bg-slate-900 text-white text-[11px] font-bold inline-flex items-center justify-center flex-shrink-0">{n}</span>
      <p className="text-sm font-semibold text-slate-800">{title}{sub && <span className="text-slate-400 font-normal"> — {sub}</span>}</p>
    </div>
  );
}

/** A fold-away box for the things most quotes don't need. Opens by itself when something inside is filled in. */
function More({ title, note, startOpen, children, testid }) {
  const [open, setOpen] = useState(!!startOpen);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60" data-testid={testid}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left" data-testid={`${testid}-toggle`}>
        <span className="flex-1 text-xs font-semibold text-slate-700">{title}{note && <span className="font-normal text-slate-500"> — {note}</span>}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-3 border-t border-slate-200 p-3">{children}</div>}
    </div>
  );
}

const MODES = [['inventory', 'From stock'], ['custom', 'Type it in'], ['none', 'Not needed']];

/** Panel / inverter: pick from Inventory, type in one that isn't in Inventory yet, or leave it out of this quote. */
function EquipmentPicker({ kind, label, items, mode, onMode, value, onChange, custom, onCustom, warnings, format, hint, testid }) {
  const empty = items.length === 0;
  const m = mode || (empty && filled(custom?.unit_price) ? 'custom' : 'inventory');
  const setC = (k, v) => onCustom({ ...(custom || {}), [k]: v });
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3" data-testid={`${testid}-field`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-sm font-medium text-slate-800">{label}</Label>
        <div className="grid grid-cols-3 rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs" role="group" aria-label={`${label}: where it comes from`}>
          {MODES.map(([v, l]) => (
            <button key={v} type="button" onClick={() => onMode(v)} aria-pressed={m === v} data-testid={`${testid}-mode-${v}`}
              className={`rounded px-2.5 py-1.5 font-medium transition-colors ${m === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white'}`}>{l}</button>
          ))}
        </div>
      </div>
      {m === 'inventory' && (
        <>
          <Select value={value || ''} onValueChange={onChange} disabled={empty}>
            <SelectTrigger className="h-11 bg-white text-base" data-testid={testid}><SelectValue placeholder={empty ? 'None in inventory' : `Choose ${label.toLowerCase()}…`} /></SelectTrigger>
            <SelectContent>{items.map(it => <SelectItem key={it.id} value={it.id}>{format(it)}</SelectItem>)}</SelectContent>
          </Select>
          {empty && <p className="text-[11px] text-amber-800 flex items-start gap-1" data-testid={`${testid}-empty`}><PackageOpen className="h-3 w-3 mt-0.5 flex-shrink-0" />No {label.toLowerCase()}s in Inventory yet — tap “Type it in” to price one now.</p>}
          {!empty && !value && <p className="text-[11px] text-slate-500">Not chosen yet — a typical market price is used until you pick one.</p>}
        </>
      )}
      {m === 'custom' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid={`${testid}-custom`}>
          <div className="col-span-2 space-y-1"><Label className="text-xs text-slate-700">Name / model</Label>
            <Input value={custom?.name || ''} onChange={(e) => setC('name', e.target.value)} placeholder={kind === 'panel' ? 'e.g. Waaree 550 W' : 'e.g. Growatt 5 kW'} className="h-11 bg-white text-base" data-testid={`${testid}-custom-name`} /></div>
          <div className="space-y-1"><Label className="text-xs text-slate-700">{kind === 'panel' ? 'Watts each' : 'Size (kW)'}</Label>
            <Input type="number" inputMode="decimal" min="0" value={custom?.[kind === 'panel' ? 'wattage' : 'rated_kw'] ?? ''} onChange={(e) => setC(kind === 'panel' ? 'wattage' : 'rated_kw', e.target.value)} placeholder={kind === 'panel' ? '550' : '5'} className="h-11 bg-white text-base" data-testid={`${testid}-custom-size`} /></div>
          <div className="space-y-1"><Label className="text-xs text-slate-700">GST %</Label>
            <Input type="number" inputMode="decimal" min="0" max="28" step="0.5" value={custom?.gst_percentage ?? ''} onChange={(e) => setC('gst_percentage', e.target.value)} placeholder="12" className="h-11 bg-white text-base" data-testid={`${testid}-custom-gst`} /></div>
          <div className="col-span-2 space-y-1 sm:col-span-4"><Label className="text-xs text-slate-700">Selling price {kind === 'panel' ? 'per panel' : ''} (₹, before GST)</Label>
            <Input type="number" inputMode="decimal" min="0" step="100" value={custom?.unit_price ?? ''} onChange={(e) => setC('unit_price', e.target.value)} placeholder={kind === 'panel' ? '14500' : '42000'} className="h-11 bg-white text-base" data-testid={`${testid}-custom-price`} />
            <p className="text-[11px] text-slate-500">Used only on this quote. Add it to Inventory later if you stock it.</p></div>
        </div>
      )}
      {m === 'none' && <p className="text-xs text-slate-500" data-testid={`${testid}-none`}>No {label.toLowerCase()} in this quote (customer already has one, or it's a different job).</p>}
      {m !== 'none' && hint && !warnings.length && <p className="text-[11px] text-slate-500" data-testid={`${testid}-hint`}>{hint}</p>}
      {m !== 'none' && warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-800 flex items-start gap-1" data-testid={`${testid}-warning`}><AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />{w}</p>)}
    </div>
  );
}

export function GridSolarFlow({ data, r, set, config, panels, inverters, batteries }) {
  const ov = data.overrides || {};
  const setOv = (k, v) => set({ overrides: { ...ov, [k]: v } });
  const setOvMany = (patch) => set({ overrides: { ...ov, ...patch } });
  const warnFor = (f) => (r?.warnings || []).filter(w => w.field === f).map(w => w.message);
  const needsBattery = data.system_type === 'hybrid' || data.system_type === 'off-grid';
  const hasUnits = (r?.monthly_eb_units || 0) > 0;
  const configMissing = !config;
  const cycle = data.billing_cycle === 'bimonthly' ? 'bimonthly' : 'monthly';
  const bimonthly = cycle === 'bimonthly';
  const gridTied = (data.system_type || 'on-grid') === 'on-grid' || data.system_type === 'hybrid';
  const networkPerKw = data.network_charge_basis === 'per_kw_month';
  const panelOff = data.panel_mode === 'none';
  const svcKeys = ['structure', 'cabling', 'installation'];
  const svcSame = (f) => { const vals = svcKeys.map(k => ov[`${k}_${f}`]); return vals.every(v => v === vals[0]) ? (vals[0] ?? '') : ''; };
  const setSvcAll = (f, v) => setOvMany(Object.fromEntries(svcKeys.map(k => [`${k}_${f}`, v])));
  const svcMissing = svcKeys.some(k => r?.lines?.[k]?.gst_missing || r?.lines?.[k]?.margin_missing);
  const svcTotal = svcKeys.reduce((s, k) => s + (r?.lines?.[k]?.amount || 0), 0);
  const svcEdited = svcKeys.some(k => filled(ov[`${k}_cost`])) || svcKeys.some(k => ov[`${k}_gst_pct`] !== ov.structure_gst_pct || ov[`${k}_margin_pct`] !== ov.structure_margin_pct);

  return (
    <div className="space-y-5">
      {configMissing && <p className="text-[11px] text-amber-800 flex items-center gap-1" data-testid="calc-config-loading"><AlertTriangle className="h-3 w-3" />Loading calculator constants… results use built-in defaults until then.</p>}

      {/* Step 1 — customer's bill */}
      <StepTitle n={1} title="How much power the customer uses" sub="the bill or the units — or skip and type a size in step 2" />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="How often the EB bill comes" data-testid="billing-cycle">
        <span className="text-xs text-slate-700">EB bill comes every</span>
        <div className="grid grid-cols-2 rounded-md border border-slate-200 bg-white p-0.5 h-10 text-sm">
          {[['monthly', '1 month'], ['bimonthly', '2 months']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => set({ billing_cycle: v })} aria-pressed={cycle === v} data-testid={`billing-cycle-${v}`}
              className={`rounded px-4 font-medium transition-colors ${cycle === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <NumberField label={bimonthly ? 'EB bill (2 months)' : 'Monthly EB bill'} unit="₹" value={data.monthly_eb_bill} onChange={(v) => set({ monthly_eb_bill: v })} step={100} placeholder={bimonthly ? 'e.g. 6000' : 'e.g. 3000'} testid="bill"
          hint={r?.units_source === 'from_bill' ? `≈ ${bimonthly ? `${r.bill_units} units per bill · ` : ''}${r.monthly_eb_units} units/month at ₹${r.tariff_per_unit}/unit` : undefined} />
        <NumberField label={bimonthly ? 'Units per bill (2 months)' : 'Units per month'} unit="kWh" value={data.monthly_eb_units_entered} onChange={(v) => set({ monthly_eb_units_entered: v })} step={10} placeholder="if known" testid="units" optional
          hint={r?.units_source === 'entered' ? (bimonthly ? `= ${r.monthly_eb_units} units/month · overrides the bill` : 'Units override the bill') : undefined} />
        <OverridableNumber label="Tariff" unit="₹/unit" autoValue={config?.default_tariff_per_unit ?? 8} value={data.tariff_per_unit_manual} onChange={(v) => set({ tariff_per_unit_manual: v })} step={0.5} testid="tariff"
          hint="What the customer pays the EB per unit" />
      </div>
      {gridTied && (
        <More title="Feed-in rate & network charge" note="only if they apply" startOpen={filled(data.export_rate) || filled(data.network_charge)} testid="grid-charges">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumberField label="Feed-in rate" unit="₹/unit" value={data.export_rate} onChange={(v) => set({ export_rate: v })} step={0.25} placeholder="0" testid="export-rate"
              hint={r?.export_units_monthly > 0 && r?.export_rate > 0 ? `${r.export_units_monthly} surplus units/month → ${inr(r.export_income_monthly)}` : 'What the DISCOM pays for each surplus unit sent to the grid'} />
            <NumberField label="Network charge" unit={networkPerKw ? '₹/kW/month' : '₹/unit'} value={data.network_charge} onChange={(v) => set({ network_charge: v })} step={networkPerKw ? 10 : 0.1} placeholder="0" testid="network-charge"
              warnings={warnFor('network_charge')}
              hint={r?.network_charge_monthly > 0 ? `${inr(r.network_charge_monthly)}/month taken off the saving` : 'Grid / network charge the DISCOM levies on solar'} />
            <div className="space-y-1">
              <Label className="text-xs text-slate-700">Network charge is</Label>
              <Select value={networkPerKw ? 'per_kw_month' : 'per_unit'} onValueChange={(v) => set({ network_charge_basis: v })}>
                <SelectTrigger className="h-11 bg-white text-base" data-testid="network-basis"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_unit">per unit of solar generated</SelectItem>
                  <SelectItem value="per_kw_month">per kW, every month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </More>
      )}

      {/* Step 2 — system size & equipment */}
      <StepTitle n={2} title="System" sub={hasUnits ? `${r.daily_units} units/day ÷ ${r.specific_yield} sun-hours` : undefined} />
      <OverridableNumber label="System size" unit="kW" autoValue={r?.system_size_kw_auto ?? 0} value={ov.system_size_kw} onChange={(v) => setOv('system_size_kw', v)} step={0.5} testid="system-size"
        warnings={warnFor('system_size_kw')} hint={hasUnits ? 'Worked out from the bill (rounded up to 0.5 kW) — type to change' : 'Type the size, or fill in the bill above'} />
      <EquipmentPicker kind="panel" label="Panel" items={panels} mode={data.panel_mode} onMode={(v) => set({ panel_mode: v })} value={data.panel_item_id} onChange={(v) => set({ panel_item_id: v })}
        custom={data.panel_custom} onCustom={(c) => set({ panel_custom: c })} testid="panel-picker" warnings={warnFor('panel_item_id')}
        format={(p) => `${p.name}${p.specs?.wattage ? ` — ${p.specs.wattage} W` : ''}`} hint={r?.lines?.panels?.unit_price ? `${inr(r.lines.panels.unit_price)} each` : undefined} />
      {!panelOff && (
        <OverridableNumber label="Number of panels" unit="nos" autoValue={r?.panel_count_auto ?? ''} value={ov.panel_count} onChange={(v) => setOv('panel_count', v)} step={1} testid="panel-count"
          placeholder={r?.panel_wattage_w ? '' : 'needs the panel watts'} hint={r?.panel_wattage_w ? `${r.system_size_kw} kW ÷ ${r.panel_wattage_w} W, rounded up` : undefined} />
      )}
      <EquipmentPicker kind="inverter" label="Inverter" items={inverters} mode={data.inverter_mode} onMode={(v) => set({ inverter_mode: v })} value={data.inverter_item_id} onChange={(v) => set({ inverter_item_id: v })}
        custom={data.inverter_custom} onCustom={(c) => set({ inverter_custom: c })} testid="inverter-picker" warnings={warnFor('inverter_item_id')}
        format={(i) => `${i.name}${i.specs?.rated_kw ? ` — ${i.specs.rated_kw} kW` : ''}`} hint={r?.inverter_rated_kw ? `${r.inverter_rated_kw} kW inverter for a ${r.system_size_kw} kW array — OK` : undefined} />

      {needsBattery && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 space-y-3" data-testid="battery-block">
          <p className="text-xs font-semibold text-sky-900">Battery backup</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumberField label="Backup needed" unit="hours" value={data.backup_hours} onChange={(v) => set({ backup_hours: v })} step={1} placeholder={data.system_type === 'off-grid' ? '8' : '4'} testid="backup-hours"
              hint={r?.battery_kwh_needed ? `Needs ${r.battery_kwh_needed} kWh of storage` : undefined} />
            <div className="space-y-1" data-testid="battery-picker-field">
              <Label className="text-xs text-slate-700">Battery</Label>
              <Select value={data.battery_item_id || ''} onValueChange={(v) => set({ battery_item_id: v })} disabled={!batteries.length}>
                <SelectTrigger className="h-11 bg-white text-base" data-testid="battery-picker"><SelectValue placeholder={batteries.length ? 'Choose battery…' : 'None in inventory'} /></SelectTrigger>
                <SelectContent>{batteries.map(b => <SelectItem key={b.id} value={b.id}>{`${b.name}${b.specs?.kwh ? ` — ${b.specs.kwh} kWh` : ''}`}</SelectItem>)}</SelectContent>
              </Select>
              {warnFor('battery_item_id').map((w, i) => <p key={i} className="text-[11px] text-amber-800" data-testid="battery-picker-warning">{w}</p>)}
            </div>
            <OverridableNumber label="Battery count" unit="nos" autoValue={r?.battery_count_auto ?? ''} value={ov.battery_count} onChange={(v) => setOv('battery_count', v)} step={1} testid="battery-count"
              hint={r?.battery_unit_kwh ? `${r.battery_kwh_needed} kWh ÷ ${r.battery_unit_kwh} kWh each` : undefined} />
          </div>
        </div>
      )}

      <More title="Check it fits the roof" note="optional" startOpen={filled(data.roof_area_sqft)} testid="roof-check">
        <NumberField label="Roof area" unit="sq ft" value={data.roof_area_sqft} onChange={(v) => set({ roof_area_sqft: v })} step={50} placeholder="caps the size" testid="roof" optional
          hint={r?.roof_cap_kw != null ? `Fits up to ${r.roof_cap_kw} kW (100 sq ft per kW)` : 'We limit the size to what fits (100 sq ft per kW)'} />
      </More>

      {/* Step 3 — price */}
      <StepTitle n={3} title="Price" sub="before GST" />
      {r?.slab && (
        <div className={`rounded-lg border p-3 flex flex-wrap items-center gap-3 ${r.pricing_source === 'slab' ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`} data-testid="slab-rate-strip">
          <div className="flex-1 min-w-[220px]">
            <p className="text-xs font-semibold text-slate-800">Package rate available · {r.slab.from_value}–{r.slab.to_value ?? '∞'} {r.slab.unit} @ {inr(r.slab.rate_per_unit)}/{r.slab.unit}</p>
            <p className="text-[11px] text-slate-500">{r.system_size_kw} {r.slab.unit} × {inr(r.slab.rate_per_unit)} = <span className="font-medium text-slate-800" data-testid="slab-rate-total">{inr(r.slab.total)}</span> before GST{r.slab.gst_pct !== null ? ` · GST ${r.slab.gst_pct}%` : ' · GST% not set'} · item by item {inr(r.itemised_total)}</p>
          </div>
          <div className="grid grid-cols-2 rounded-md border border-slate-200 bg-white p-0.5 h-9 text-xs" data-testid="pricing-mode-toggle">
            {[['itemised', 'Item by item'], ['slab', 'Package rate']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => set({ pricing_mode: v })} data-testid={`pricing-mode-${v}`}
                className={`rounded px-3 font-medium transition-colors ${(data.pricing_mode || 'itemised') === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
        </div>
      )}
      <div className={`rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 text-sm ${r?.pricing_source === 'slab' ? 'opacity-90' : ''}`} data-testid="cost-lines">
        {r?.pricing_source === 'slab' && <p className="px-3 py-1.5 text-[11px] text-emerald-800 bg-emerald-50" data-testid="slab-pricing-note">Priced by package rate — the lines below are for reference only.</p>}
        <CostLine label={`Panels${r?.panel_count ? ` · ${r.panel_count} × ${r.panel_wattage_w || '?'} W` : ''}`} line={r?.lines?.panels} testid="line-panels" />
        <CostLine label="Inverter" line={r?.lines?.inverter} testid="line-inverter" />
        {needsBattery && <CostLine label={`Battery${r?.battery_count ? ` · ${r.battery_count} nos` : ''}`} line={r?.lines?.battery} testid="line-battery" />}
        <div className="px-3 py-2.5 space-y-2" data-testid="line-services">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-700">Structure, cabling &amp; installation{svcMissing && <span className="ml-2 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider" data-testid="line-services-missing">needs GST% / margin%</span>}</span>
            <span className="font-medium text-slate-900 whitespace-nowrap" data-testid="line-services-amount">{inr(svcTotal)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Margin for all three" unit="%" value={svcSame('margin_pct')} onChange={(v) => setSvcAll('margin_pct', v)} step={0.5} placeholder="e.g. 15" testid="services-margin" />
            <NumberField label="GST for all three" unit="%" value={svcSame('gst_pct')} onChange={(v) => setSvcAll('gst_pct', v)} step={0.5} placeholder="e.g. 18" testid="services-gst" />
          </div>
          <More title="Change each line" note="cost, margin and GST one by one" startOpen={svcEdited} testid="services-detail">
            {svcKeys.map(key => <ServiceLine key={key} keyName={key} line={r?.lines?.[key]} ov={ov} setOv={setOv} warnFor={warnFor} />)}
          </More>
        </div>
        <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50">
          <span className="font-semibold text-slate-800">Total system price <span className="text-slate-400 font-normal text-xs">before GST{r?.pricing_source === 'slab' ? ' · package rate' : ''}</span></span>
          <span className="font-bold text-slate-900 text-base" data-testid="result-total-cost">{inr(r?.total_cost)}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-600">
          <span>GST (per line)</span>
          <span className="tabular-nums" data-testid="result-total-gst">{inr(r?.total_gst)}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-sm">
          <span className="font-medium text-slate-800">System incl. GST</span>
          <span className="font-semibold text-slate-900 tabular-nums" data-testid="result-total-incl-gst">{inr(r?.total_incl_gst)}</span>
        </div>
        {(r?.pricing_issues || []).length > 0 && (
          <div className="px-3 py-2 bg-amber-50 border-t border-amber-200" data-testid="pricing-issues">
            <p className="text-[11px] font-semibold text-amber-800 mb-0.5">To finish the price — {r.pricing_issues.length} thing{r.pricing_issues.length === 1 ? '' : 's'} to fill in</p>
            {r.pricing_issues.map((m, i) => <p key={i} className="text-[11px] text-amber-800">• {m}</p>)}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-slate-700">Subsidy <span className="text-slate-400">(₹, sanctioned amount)</span></Label>
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
  if (line?.excluded) {
    return <div className="flex items-center justify-between gap-3 px-3 py-2 text-slate-400" data-testid={testid}><span>{label.split(' · ')[0]} <span className="text-[11px]">— not in this quote</span></span><span>—</span></div>;
  }
  const missing = line && !line.benchmark && (line.gst_pct === null || line.margin_pct === null);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2" data-testid={testid}>
      <span className="text-slate-700">{label}
        {line?.benchmark && <span className="ml-2 rounded bg-slate-100 text-slate-500 px-1.5 py-0.5 text-[10px] uppercase tracking-wider" data-testid={`${testid}-benchmark`}>market rate</span>}
        {line?.custom && <span className="ml-2 rounded bg-sky-50 text-sky-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider" data-testid={`${testid}-custom`}>typed in</span>}
        {line && !line.benchmark && !line.custom && !missing && <span className="ml-2 text-[10px] text-slate-400">margin {line.margin_pct}% · GST {line.gst_pct}%</span>}
        {missing && <span className="ml-2 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider" data-testid={`${testid}-missing`}>{line.margin_pct === null ? 'margin' : ''}{line.margin_pct === null && line.gst_pct === null ? ' + ' : ''}{line.gst_pct === null ? 'GST' : ''} missing</span>}
      </span>
      <span className="font-medium text-slate-900 whitespace-nowrap">{inr(line?.amount)}</span>
    </div>
  );
}

const SERVICE_LABELS = { structure: 'Mounting structure', cabling: 'Cabling & electrical', installation: 'Installation & commissioning' };

function ServiceLine({ keyName, line, ov, setOv, warnFor }) {
  const label = SERVICE_LABELS[keyName];
  const missing = line && (line.gst_missing || line.margin_missing);
  return (
    <div className="space-y-1.5" data-testid={`line-${keyName}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-700 text-sm">{label}{missing && <span className="ml-2 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider" data-testid={`line-${keyName}-missing`}>needs GST% / margin%</span>}</span>
        <span className="font-medium text-slate-900 whitespace-nowrap" data-testid={`line-${keyName}-amount`}>{inr(line?.amount)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <OverridableNumber label="Cost" unit="₹" autoValue={line?.auto ?? 0} value={ov[`${keyName}_cost`]} onChange={(v) => setOv(`${keyName}_cost`, v)} step={500} testid={`${keyName}-cost`} />
        <NumberField label="Margin" unit="%" value={ov[`${keyName}_margin_pct`] ?? ''} onChange={(v) => setOv(`${keyName}_margin_pct`, v)} step={0.5} placeholder="required" testid={`${keyName}-margin`} warnings={warnFor(`${keyName}_margin_pct`)} />
        <NumberField label="GST" unit="%" value={ov[`${keyName}_gst_pct`] ?? ''} onChange={(v) => setOv(`${keyName}_gst_pct`, v)} step={0.5} placeholder="required" testid={`${keyName}-gst`} warnings={warnFor(`${keyName}_gst_pct`)} />
      </div>
    </div>
  );
}
