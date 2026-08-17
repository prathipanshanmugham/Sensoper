/**
 * Iter 44 Phase 3 — Kit Quotation presentation shape test
 *
 * The critical assertion: NO per-item price ever leaks into the presentation
 * data shape that feeds the PDF. All line items should carry name + quantity +
 * specifications ONLY, never `unit_price`.
 *
 * Run with:  node frontend/src/utils/kitQuotationPDF.spec.js
 */
import { buildKitPresentation, roundKitPrice } from './kitQuotationPDF.js';

const sampleProject = {
  id: '6a1065cb1b5eace19fe23532',
  customer: { name: 'Test Farmer', address: 'Somewhere', phone: '9998887771' },
  solar_system: { system_type: 'on-grid', system_size_kw: 5 },
  selected_items: [
    { name: 'Adani 550W panel', quantity: 9, unit_price: 15125, margin_percentage: 18, specifications: 'Mono PERC Tier 1' },
    { name: 'Growatt 5kW inverter', quantity: 1, unit_price: 42000, margin_percentage: 15, specifications: 'Dual MPPT' },
    { name: 'SPD 40kA', quantity: 1, unit_price: 2500, margin_percentage: 20, specifications: 'Type-II SPD', addon_group: 'Safety & Protection' },
    { name: 'Wi-Fi datalogger', quantity: 1, unit_price: 5000, margin_percentage: 25, addon_group: 'Monitoring' },
  ],
  manual_costs: [{ description: 'Installation labour', amount: 12000 }],
  subsidy_tracking: { eligible_amount: 78000 },
};
const addonGroups = [
  { name: 'Safety & Protection', description: 'SPDs, extra earthing, fire safety.', show_on_pdf: true, optional_priced_separately: false },
  { name: 'Monitoring', description: 'Wi-Fi datalogger + cloud subscription.', show_on_pdf: true, optional_priced_separately: false },
];
const config = { kit_rounding_step: 500, kit_rounding_mode: 'nearest', gst_pct: 13.8 };

const pres = buildKitPresentation(sampleProject, config, addonGroups);

// ============ ASSERTIONS ============
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log('✓', msg); pass++; }
  else { console.error('✗', msg); fail++; }
}

// System line has one aggregate price only
assert(typeof pres.systemLine.price === 'number', 'systemLine.price is a number');
assert(pres.systemLine.price > 0, 'systemLine.price > 0 (had core items + manual)');
assert(!('unit_price' in pres.systemLine), 'systemLine has NO unit_price key');
assert(!JSON.stringify(pres.systemLine).includes('15125'), 'panel unit_price 15125 does not appear in systemLine JSON');
assert(!JSON.stringify(pres.systemLine).includes('42000'), 'inverter unit_price 42000 does not appear in systemLine JSON');

// Inclusions are just strings with qty + name
assert(pres.systemLine.inclusions.every(inc => !inc.match(/₹|\bINR\b|\d{3,},\d{3}/)), 'inclusions strings do NOT contain rupee amounts');

// Add-on groups: 1 lump price per group
assert(pres.addonGroupLines.length === 2, 'two visible addon groups');
pres.addonGroupLines.forEach(g => {
  assert(typeof g.price === 'number', `${g.name} has a single lump price`);
  assert(!JSON.stringify(g).includes('2500'), `${g.name} does not leak SPD unit_price`);
  assert(!JSON.stringify(g).includes('5000'), `${g.name} does not leak datalogger unit_price`);
});

// Rounding
assert(roundKitPrice(96351, 500, 'nearest') === 96500, 'roundKitPrice ₹96,351 → ₹96,500 (nearest 500)');
assert(roundKitPrice(96351, 1000, 'up') === 97000, 'roundKitPrice up to nearest 1000');
assert(roundKitPrice(96351, 5000, 'down') === 95000, 'roundKitPrice down to nearest 5000');

// Totals present
assert(typeof pres.totals.gst === 'number', 'totals.gst is a number');
assert(pres.totals.subsidy === 78000, 'totals.subsidy pulled from subsidy_tracking');
assert(pres.totals.netPayable > 0, 'totals.netPayable computed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
