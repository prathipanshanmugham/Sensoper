/**
 * solarCalc.js — pure Step-4 calculator engine. Exact mirror of backend/quick_calc.py
 * (pinned by backend/tests/test_iter48_calculator.py). Keep both in sync.
 */
export const DEFAULT_MARGIN_PCT = 15;
const BOS_SHARE = 0.40, PANEL_BENCH_SHARE = 0.45, INVERTER_BENCH_SHARE = 0.15;
const ROOF_SQFT_PER_KW = 100, BATTERY_HEADROOM = 1.2;

export const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const isSet = (v) => v !== undefined && v !== null && v !== '';
const round = (v, dp = 0) => { const f = 10 ** dp; return Math.round(v * f) / f; };

export const sellPrice = (item) => {
  if (!item) return 0;
  const margin = item.margin_pct === undefined || item.margin_pct === null ? DEFAULT_MARGIN_PCT : num(item.margin_pct, DEFAULT_MARGIN_PCT);
  return num(item.unit_price) * (1 + margin / 100);
};

export const pmSuryaGharReference = (kw, config) => {
  const cfg = (config || {}).pm_surya_ghar || {};
  const slabs = [...(cfg.slabs || [])].sort((a, b) => num(a.upto_kw) - num(b.upto_kw));
  let amount = 0;
  slabs.forEach(s => { if (kw >= num(s.upto_kw)) amount = num(s.amount); });
  return Math.min(amount, num(cfg.cap, 78000));
};

export function computeQuick(inputs, config, panel, inverter, battery) {
  const systemType = inputs.system_type || 'on-grid';
  const overrides = inputs.overrides || {};
  const customerType = inputs.customer_type || 'residential';
  const warnings = [];
  const warn = (field, message) => warnings.push({ field, message });
  const fmt = (v) => Math.round(v).toLocaleString('en-IN');

  const costMap = (config || {}).cost_per_kwp || {};
  const baseKwp = num(costMap['on-grid'], 55000);
  const typeKwp = num(costMap[systemType], baseKwp);
  const sy = num(config?.default_specific_yield, 4.4) || 4.4;
  const tariff = num(inputs.tariff_per_unit) || num(config?.default_tariff_per_unit, 8) || 8;

  let units = num(inputs.monthly_eb_units);
  const bill = num(inputs.monthly_eb_bill);
  let unitsSource = 'entered';
  if (units <= 0 && bill > 0) { units = Math.round(bill / tariff); unitsSource = 'from_bill'; }
  if (units <= 0) unitsSource = 'none';
  const daily = units > 0 ? units / 30 : 0;

  let kwAuto = daily > 0 ? Math.ceil((daily / sy) * 2) / 2 : 0;
  const roofSqft = num(inputs.roof_area_sqft);
  const roofCapKw = roofSqft > 0 ? Math.floor((roofSqft / ROOF_SQFT_PER_KW) * 2) / 2 : null;
  let roofLimited = false;
  if (roofCapKw !== null && kwAuto > roofCapKw) { kwAuto = roofCapKw; roofLimited = true; }
  const kw = isSet(overrides.system_size_kw) ? num(overrides.system_size_kw) : kwAuto;
  if (roofCapKw !== null && kw > roofCapKw) warn('system_size_kw', `Roof of ${roofSqft} sq ft fits about ${roofCapKw} kW (${ROOF_SQFT_PER_KW} sq ft per kW). ${kw} kW may not fit.`);
  else if (roofLimited) warn('system_size_kw', `Size limited by roof: ${roofSqft} sq ft fits about ${roofCapKw} kW.`);

  const panelW = panel ? num(panel.specs?.wattage) : 0;
  if (panel && panelW <= 0) warn('panel_item_id', `'${panel.name}' has no wattage in Inventory — set the panel count manually or add specs.wattage.`);
  const panelCountAuto = kw > 0 && panelW > 0 ? Math.ceil(kw * 1000 / panelW) : null;
  const panelCount = isSet(overrides.panel_count) ? Math.trunc(num(overrides.panel_count)) : (panelCountAuto || 0);

  const inverterKw = inverter ? num(inverter.specs?.rated_kw) : 0;
  if (inverter && inverterKw > 0 && kw > 0) {
    if (inverterKw < kw * 0.8) warn('inverter_item_id', `Inverter is ${inverterKw} kW for a ${kw} kW array — undersized (below 80%). Pick a larger inverter.`);
    else if (inverterKw > kw * 1.5) warn('inverter_item_id', `Inverter is ${inverterKw} kW for a ${kw} kW array — oversized (over 150%). A smaller unit would cost less.`);
  }

  const needsBattery = systemType === 'hybrid' || systemType === 'off-grid';
  const backupHours = num(inputs.backup_hours) || (systemType === 'off-grid' ? 8 : 4);
  let batteryKwhNeeded = 0, batteryUnitKwh = 0, batteryCountAuto = null, batteryCount = 0;
  if (needsBattery && daily > 0) {
    let dod = battery ? num(battery.specs?.dod_pct) : 0;
    dod = dod > 0 ? dod / 100 : 0.8;
    batteryKwhNeeded = round(daily * backupHours / 24 * BATTERY_HEADROOM / dod, 2);
    batteryUnitKwh = battery ? num(battery.specs?.kwh) : 0;
    if (battery && batteryUnitKwh <= 0) warn('battery_item_id', `'${battery.name}' has no kWh in Inventory — set the battery count manually or add specs.kwh.`);
    if (batteryUnitKwh <= 0) batteryUnitKwh = num(config?.battery_unit_kwh, 5) || 5;
    batteryCountAuto = batteryKwhNeeded > 0 ? Math.ceil(batteryKwhNeeded / batteryUnitKwh) : 0;
  }
  if (needsBattery) batteryCount = isSet(overrides.battery_count) ? Math.trunc(num(overrides.battery_count)) : (batteryCountAuto || 0);

  const panelSell = sellPrice(panel);
  const panelReal = panel && panelSell > 0 && panelCount > 0;
  const panelCost = panelReal ? panelSell * panelCount : PANEL_BENCH_SHARE * baseKwp * kw;
  const inverterSell = sellPrice(inverter);
  const inverterReal = inverter && inverterSell > 0;
  const inverterCost = inverterReal ? inverterSell : INVERTER_BENCH_SHARE * typeKwp * kw;
  const batterySell = sellPrice(battery);
  let batteryCost = 0, batteryBenchmark = false;
  if (needsBattery && batteryCount > 0) {
    if (battery && batterySell > 0) batteryCost = batterySell * batteryCount;
    else { batteryCost = batteryCount * batteryUnitKwh * num(config?.battery_benchmark_per_kwh, 20000); batteryBenchmark = true; }
  }
  const bosAuto = BOS_SHARE * baseKwp * kw;
  const bosCost = isSet(overrides.bos_cost) ? num(overrides.bos_cost) : bosAuto;

  const totalCost = kw > 0 ? Math.round(panelCost + inverterCost + batteryCost + bosCost) : 0;
  const subsidy = Math.max(num(inputs.subsidy), 0);
  if (totalCost > 0 && subsidy > totalCost) warn('subsidy', `Subsidy ₹${fmt(subsidy)} is more than the system cost ₹${fmt(totalCost)} — check the amount.`);
  const netCost = Math.max(totalCost - subsidy, 0);

  const annualGen = kw * sy * 365;
  const monthlyGen = annualGen / 12;
  const offsetUnits = units > 0 ? Math.min(monthlyGen, units) : monthlyGen;
  const monthlySaving = offsetUnits * tariff;
  const annualSaving = monthlySaving * 12;
  const paybackYears = annualSaving > 0 && netCost > 0 ? round(netCost / annualSaving, 1) : (netCost === 0 && annualSaving > 0 ? 0 : null);
  if (units > 0 && monthlyGen > units * 1.25) warn('system_size_kw', `System makes ~${fmt(monthlyGen)} units/month but the customer uses ${fmt(units)} — savings are capped at what they use.`);

  const life = Math.trunc(num(config?.system_life_years, 25)) || 25;
  const deg = num(config?.panel_degradation_pct_per_year, 0.7) / 100;
  const monthlyBillNow = units > 0 ? units * tariff : bill;
  const yearly = [];
  let cumWithout = 0, cumWith = netCost, lifetime = 0;
  for (let y = 1; y <= life; y++) {
    const savingY = annualSaving * (1 - deg) ** (y - 1);
    lifetime += savingY;
    cumWithout += monthlyBillNow * 12;
    cumWith += Math.max(monthlyBillNow * 12 - savingY, 0);
    yearly.push({ year: y, without_solar: Math.round(cumWithout), with_solar: Math.round(cumWith) });
  }
  const subsidyRef = customerType === 'residential' && (systemType === 'on-grid' || systemType === 'hybrid') && kw > 0 ? pmSuryaGharReference(kw, config) : 0;

  return {
    system_type: systemType, customer_type: customerType, tariff_per_unit: tariff, specific_yield: sy,
    monthly_eb_units: Math.round(units), units_source: unitsSource, daily_units: round(daily, 2),
    system_size_kw_auto: kwAuto, system_size_kw: kw, roof_cap_kw: roofCapKw,
    panel_wattage_w: panelW || null, panel_count_auto: panelCountAuto, panel_count: panelCount,
    inverter_rated_kw: inverterKw || null,
    backup_hours: needsBattery ? backupHours : null, battery_kwh_needed: needsBattery ? batteryKwhNeeded : null,
    battery_unit_kwh: needsBattery ? batteryUnitKwh : null, battery_count_auto: batteryCountAuto, battery_count: batteryCount,
    lines: {
      panels: { amount: Math.round(panelCost), benchmark: !panelReal, unit_price: panel ? round(panelSell, 2) : null },
      inverter: { amount: Math.round(inverterCost), benchmark: !inverterReal, unit_price: inverter ? round(inverterSell, 2) : null },
      battery: needsBattery ? { amount: Math.round(batteryCost), benchmark: batteryBenchmark, unit_price: battery ? round(batterySell, 2) : null } : null,
      bos: { amount: Math.round(bosCost), auto: Math.round(bosAuto) },
    },
    total_cost: totalCost, subsidy: Math.round(subsidy), subsidy_reference: subsidyRef, net_cost: Math.round(netCost),
    annual_generation_units: Math.round(annualGen), monthly_generation_units: Math.round(monthlyGen),
    monthly_bill_now: Math.round(monthlyBillNow), monthly_saving: Math.round(monthlySaving), annual_saving: Math.round(annualSaving),
    payback_years: paybackYears, lifetime_savings: Math.round(lifetime),
    roi_pct: netCost > 0 ? round(annualSaving / netCost * 100, 1) : null,
    yearly, warnings,
  };
}

/** Project the engine result onto the `proposed_solution` shape the rest of the app reads. */
export function projectResult(data, r) {
  return {
    ...data,
    system_size_kw: r.system_size_kw, panel_count: r.panel_count, battery_count: r.battery_count,
    monthly_eb_units: r.monthly_eb_units, tariff_per_unit: r.tariff_per_unit,
    total_cost: r.total_cost, net_cost: r.net_cost,
    _derived: {
      annual_savings: r.annual_saving, monthly_savings: r.monthly_saving, payback_years: r.payback_years, roi_pct: r.roi_pct,
      annual_generation_units: r.annual_generation_units, lifetime_savings: r.lifetime_savings, monthly_units: r.monthly_eb_units,
    },
    _quick: r,
  };
}
