/**
 * Worked-example regression for the client-side engine — same three cases as
 * backend/tests/test_iter48_calculator.py. Run:  node frontend/src/utils/solarCalc.spec.js
 */
import { computeQuick } from './solarCalc.js';

const config = { default_specific_yield: 4.6, cost_per_kwp: { 'on-grid': 55000, hybrid: 75000, 'off-grid': 95000 },
  system_life_years: 25, panel_degradation_pct_per_year: 0.7, battery_unit_kwh: 5, default_tariff_per_unit: 8,
  pm_surya_ghar: { cap: 78000, slabs: [{ upto_kw: 1, amount: 30000 }, { upto_kw: 2, amount: 60000 }, { upto_kw: 3, amount: 78000 }] } };
const panel540 = { name: 'P540', unit_price: 13500, margin_pct: 15, specs: { wattage: 540 } };
const panel550 = { name: 'P550', unit_price: 15125, margin_pct: 30, specs: { wattage: 550 } };
const inv3 = { name: 'I3', unit_price: 30000, margin_pct: 10, specs: { rated_kw: 3 } };
const inv10 = { name: 'I10', unit_price: 80000, margin_pct: 15, specs: { rated_kw: 10 } };
const inv5h = { name: 'I5H', unit_price: 60000, margin_pct: 15, specs: { rated_kw: 5 } };
const bat5 = { name: 'B5', unit_price: 120000, margin_pct: 10, specs: { kwh: 5.12, dod_pct: 80 } };

let failed = 0;
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const a = computeQuick({ system_type: 'on-grid', customer_type: 'residential', monthly_eb_bill: 3000, tariff_per_unit: 8, subsidy: 78000 }, config, panel540, inv3);
eq('A units', a.monthly_eb_units, 375); eq('A kW', a.system_size_kw, 3); eq('A panels', a.panel_count, 6);
eq('A total', a.total_cost, 192150); eq('A net', a.net_cost, 114150); eq('A annual saving', a.annual_saving, 36000); eq('A payback', a.payback_years, 3.2);
eq('A warnings', a.warnings, []);

const b = computeQuick({ system_type: 'on-grid', customer_type: 'commercial', monthly_eb_units: 1500, tariff_per_unit: 9, subsidy: 0, overrides: { system_size_kw: 10 } }, config, panel550, inv10);
eq('B kW auto', b.system_size_kw_auto, 11); eq('B kW', b.system_size_kw, 10); eq('B panels', b.panel_count, 19);
eq('B total', b.total_cost, 685588); eq('B annual saving', b.annual_saving, 151110); eq('B payback', b.payback_years, 4.5); eq('B subsidy ref', b.subsidy_reference, 0);

const c = computeQuick({ system_type: 'hybrid', customer_type: 'residential', monthly_eb_units: 600, tariff_per_unit: 8, backup_hours: 4, subsidy: 78000, overrides: { system_size_kw: 5 } }, config, panel540, inv5h, bat5);
eq('C battery need', c.battery_kwh_needed, 5); eq('C batteries', c.battery_count, 1); eq('C panels', c.panel_count, 10);
eq('C total', c.total_cost, 466250); eq('C net', c.net_cost, 388250); eq('C annual saving', c.annual_saving, 57600); eq('C payback', c.payback_years, 6.7);

const z = computeQuick({ system_type: 'on-grid' }, config);
eq('Empty is zero not NaN', [z.system_size_kw, z.total_cost, z.payback_years], [0, 0, null]);
const roof = computeQuick({ system_type: 'on-grid', monthly_eb_units: 1500, tariff_per_unit: 8, roof_area_sqft: 500 }, config);
eq('Roof cap', [roof.roof_cap_kw, roof.system_size_kw, roof.warnings.length > 0], [5, 5, true]);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
