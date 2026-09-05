/**
 * Kit Quotation PDF (Iter 44 Phase 3 — Change 4)
 *
 * Lump-sum customer-facing quotation. Renders:
 *   - System as ONE priced line: "5 kW On-Grid Solar Power Plant .... ₹2,50,000"
 *   - Inclusions list with specifications but NO per-item prices
 *   - Add-on groups as separate lump-sum lines with their inclusions and one price
 *   - Totals: system total, add-ons total, GST, subsidy, net payable
 *
 * CRITICAL: Per-item unit_price values MUST NOT appear anywhere in the PDF
 * text layer. This module builds the document from a separate `presentation`
 * data shape rather than hiding a column — the raw project.selected_items
 * array is never passed to jsPDF.
 */
import autoTable from 'jspdf-autotable';
import { parseTermsHtml } from './termsParser';
import { loadTermsFont } from './pdfFont';
import { createBrandDoc, drawHeader, drawFooters, drawCoverPage, drawWhyUs, drawComparisonChart, drawFinancing, drawCTA, ensureSpace, sectionTitle, inr, inrCompact, fmtDate, INK, MUTED, LINE, PAPER } from './pdfBrand';
import { deriveSalesNumbers } from './detailedQuotationPDF';

/**
 * Round a number to nearest step per admin config
 * @param {number} val
 * @param {number} step - e.g., 500, 1000, 5000
 * @param {'nearest'|'up'|'down'} mode
 */
export function roundKitPrice(val, step = 500, mode = 'nearest') {
  if (!val || step <= 0) return Math.round(val || 0);
  if (mode === 'up') return Math.ceil(val / step) * step;
  if (mode === 'down') return Math.floor(val / step) * step;
  return Math.round(val / step) * step;
}

/**
 * Build the presentation shape for a Kit Quotation.
 *
 * @param {object} project - project doc from /api/projects/{id}
 * @param {object} config  - { kit_rounding_step, kit_rounding_mode, gst_pct }
 * @param {Array}  addonGroups - from /api/catalogue/addon-groups
 * @returns {{ systemLine, addonGroupLines, totals, meta }}
 */
export function buildKitPresentation(project, config = {}, addonGroups = []) {
  const kwp = project.solar_system?.system_size_kw
    || project.custom_fields?.proposed_solution?.system_size_kw
    || 0;
  const sysType = project.solar_system?.system_type || 'on-grid';
  const step = config.kit_rounding_step || 500;
  const mode = config.kit_rounding_mode || 'nearest';
  const gstPct = config.gst_pct || 13.8;

  // Kit base price = sum of ONLY genuine core-system items (kit-applied) — cost + margin
  // Add-ons are collected in a separate bucket.
  const items = project.selected_items || [];
  const groupMap = {};                                 // group_name → { items, subtotal, price }
  let systemSubtotal = 0;                              // core items (no addon_group)
  const systemInclusions = [];

  items.forEach(it => {
    const line = (it.unit_price || 0) * (it.quantity || 1);
    const withMargin = line * (1 + (it.margin_percentage || 0) / 100);
    if (!it.addon_group) {
      // core kit
      systemSubtotal += withMargin;
      systemInclusions.push(`${it.quantity || 1} × ${it.name}${it.specifications ? ` — ${it.specifications}` : ''}`);
    } else {
      const g = groupMap[it.addon_group] || { items: [], subtotal: 0 };
      g.items.push(`${it.quantity || 1} × ${it.name}${it.specifications ? ` — ${it.specifications}` : ''}`);
      g.subtotal += withMargin;
      groupMap[it.addon_group] = g;
    }
  });

  // Manual costs go into the system
  (project.manual_costs || []).forEach(c => { systemSubtotal += c.amount || 0; });

  // Round kit price to admin-configurable step
  const systemPrice = roundKitPrice(systemSubtotal, step, mode);

  const systemLine = {
    name: `${kwp} kWp ${sysTypeLabel(sysType)} Solar Power Plant`,
    price: systemPrice,
    inclusions: systemInclusions.length ? systemInclusions : defaultInclusions(sysType, kwp),
  };

  const addonGroupLines = Object.entries(groupMap).map(([groupName, g]) => {
    const meta = addonGroups.find(ag => ag.name === groupName) || {};
    return {
      name: groupName,
      description: meta.description || '',
      price: roundKitPrice(g.subtotal, step, mode),
      inclusions: g.items,
      show_on_pdf: meta.show_on_pdf !== false,           // default true
      optional_priced_separately: !!meta.optional_priced_separately,
    };
  }).filter(g => g.show_on_pdf);

  const addonsTotal = addonGroupLines
    .filter(g => !g.optional_priced_separately)
    .reduce((s, g) => s + g.price, 0);
  const optionalTotal = addonGroupLines
    .filter(g => g.optional_priced_separately)
    .reduce((s, g) => s + g.price, 0);

  const subtotal = systemPrice + addonsTotal;
  const gst = Math.round(subtotal * (gstPct / 100));
  const subsidy = project.subsidy_tracking?.eligible_amount || parseFloat(project.custom_fields?.proposed_solution?.subsidy) || 0;
  const netPayable = subtotal + gst - subsidy;

  return {
    systemLine,
    addonGroupLines,
    totals: { subtotal, gst, gstPct, subsidy, netPayable, optionalTotal, addonsTotal, systemPrice },
    meta: { kwp, sysType, step, mode },
  };
}

function sysTypeLabel(s) {
  const map = { 'on-grid': 'On-Grid', 'off-grid': 'Off-Grid', 'hybrid': 'Hybrid', 'solar-pump': 'Solar Pump' };
  return map[s] || 'Solar';
}

/**
 * Iter 44 Change 4 — Sales-side breakdown for the Kit Price Explainer modal.
 * Mirrors the customer presentation but keeps every raw price, margin and
 * rounding step visible. NEVER pipe this into the PDF generator.
 */
export function buildKitSalesBreakdown(project, config = {}, addonGroups = []) {
  const items = project.selected_items || [];
  const manualCosts = project.manual_costs || [];
  const step = config.kit_rounding_step || 500;
  const mode = config.kit_rounding_mode || 'nearest';
  const gstPct = config.gst_pct || 13.8;

  const coreLines = [];
  const groupMap = {};
  let coreSubtotal = 0, coreWithMargin = 0;

  items.forEach(it => {
    const qty = it.quantity || 1;
    const rawLine = (it.unit_price || 0) * qty;
    const marginPct = it.margin_percentage || 0;
    const lineWithMargin = rawLine * (1 + marginPct / 100);
    const entry = {
      name: it.name, qty,
      unit_price: it.unit_price || 0,
      line_cost: rawLine,
      margin_pct: marginPct,
      line_with_margin: lineWithMargin,
      specifications: it.specifications || '',
      addon_group: it.addon_group || null,
    };
    if (!it.addon_group) {
      coreLines.push(entry);
      coreSubtotal += rawLine;
      coreWithMargin += lineWithMargin;
    } else {
      const g = groupMap[it.addon_group] || { name: it.addon_group, lines: [], subtotal: 0, withMargin: 0 };
      g.lines.push(entry);
      g.subtotal += rawLine;
      g.withMargin += lineWithMargin;
      groupMap[it.addon_group] = g;
    }
  });

  manualCosts.forEach(c => {
    coreLines.push({
      name: c.description || 'Manual cost', qty: 1,
      unit_price: c.amount || 0, line_cost: c.amount || 0,
      margin_pct: 0, line_with_margin: c.amount || 0,
      specifications: c.notes || '', is_manual: true,
    });
    coreSubtotal += c.amount || 0;
    coreWithMargin += c.amount || 0;
  });

  const coreRounded = roundKitPrice(coreWithMargin, step, mode);
  const groups = Object.values(groupMap).map(g => {
    const meta = addonGroups.find(ag => ag.name === g.name) || {};
    const rounded = roundKitPrice(g.withMargin, step, mode);
    return {
      ...g, rounded, roundingDelta: rounded - g.withMargin,
      show_on_pdf: meta.show_on_pdf !== false,
      optional_priced_separately: !!meta.optional_priced_separately,
      description: meta.description || '',
    };
  });

  const groupsRawCost = groups.reduce((s, g) => s + g.subtotal, 0);
  const groupsWithMargin = groups.reduce((s, g) => s + g.withMargin, 0);
  const groupsRounded = groups.filter(g => !g.optional_priced_separately).reduce((s, g) => s + g.rounded, 0);

  const rawCost = coreSubtotal + groupsRawCost;
  const rawWithMargin = coreWithMargin + groupsWithMargin;
  const roundedTotal = coreRounded + groupsRounded;
  const roundingImpact = roundedTotal - rawWithMargin;
  const gst = Math.round(roundedTotal * (gstPct / 100));
  const subsidy = project.subsidy_tracking?.eligible_amount || parseFloat(project.custom_fields?.proposed_solution?.subsidy) || 0;
  const netPayable = roundedTotal + gst - subsidy;
  const netMarginRupees = rawWithMargin - rawCost + roundingImpact;
  const netMarginPct = rawCost > 0 ? (netMarginRupees / rawCost * 100) : 0;

  return {
    core: { lines: coreLines, subtotal: coreSubtotal, withMargin: coreWithMargin, rounded: coreRounded, roundingDelta: coreRounded - coreWithMargin },
    groups,
    totals: {
      rawCost, rawWithMargin, roundedTotal, gst, subsidy, netPayable,
      roundingImpact, netMarginRupees, netMarginPct, gstPct,
    },
    config: { step, mode, gstPct },
  };
}



function defaultInclusions(sysType, kwp) {
  const panels = Math.max(1, Math.ceil(kwp * 1000 / 550));
  const common = [
    `${panels} × 550 Wp Mono PERC panels`,
    `Suitable capacity inverter with dual MPPT`,
    `Galvanised iron mounting structure — cyclone rated`,
    `DC + AC cabling, DCDB, ACDB, earthing (3 pits), lightning arrestor`,
    `Installation, commissioning, testing`,
  ];
  if (sysType === 'on-grid') common.push('Net-metering liaison with DISCOM');
  if (sysType === 'off-grid' || sysType === 'hybrid') common.push('LiFePO4 / Tubular battery bank with charge controller');
  if (sysType === 'solar-pump') common.push('MPPT solar pump controller with dry-run protection');
  return common;
}

/**
 * Generate the Kit Quotation PDF (Iteration 48 — sales rebuild on the shared brand system).
 * Per-item prices never enter this function: only the `presentation` shape does.
 *
 * @param {object} extra - { stats, apiUrl } — real cumulative company figures for "Why us"
 */
export async function generateKitQuotationPDF(project, companyProfile, config, addonGroups, terms, extra = {}) {
  const pres = buildKitPresentation(project, config, addonGroups);
  const cp = companyProfile || {};
  const { doc, ctx } = await createBrandDoc(cp, extra.apiUrl || process.env.REACT_APP_BACKEND_URL);
  const { FONT, m, contentW, W, p } = ctx;
  const n = deriveSalesNumbers(project);
  const cust = project.customer || {};
  const first = (cust.name || 'your').split(' ')[0];
  const refNo = project.reference_number || `SC/${project.id?.slice(-6).toUpperCase() || 'DRAFT'}`;
  const netPay = Math.max(pres.totals.netPayable, 0);
  const payback = n.annualSaving > 0 ? (netPay > 0 ? Math.round(netPay / n.annualSaving * 10) / 10 : 0) : null;
  const hasSavings = n.monthlySaving > 0;

  // Comparison series must use THIS document's price, not the calculator's estimate
  const yearly = []; let cumWithout = 0, cumWith = netPay, lifetime = 0;
  if (n.monthlyBillNow > 0 && n.annualSaving > 0) for (let y = 1; y <= 25; y++) { const s = n.annualSaving * 0.993 ** (y - 1); lifetime += s; cumWithout += n.monthlyBillNow * 12; cumWith += Math.max(n.monthlyBillNow * 12 - s, 0); yearly.push({ year: y, without_solar: Math.round(cumWithout), with_solar: Math.round(cumWith) }); }

  // 1. Cover
  drawCoverPage(doc, ctx, {
    docTitle: 'Kit Quotation', refNo, date: fmtDate(), validTill: fmtDate(new Date(Date.now() + 30 * 864e5)), customer: cust,
    headline: hasSavings ? `Cut ${first}'s electricity bill by ${inr(n.monthlySaving)} every month.` : `${pres.systemLine.name} for ${first}.`,
    subhead: [pres.systemLine.name, pres.systemLine.inclusions.length ? `${pres.systemLine.inclusions.length} inclusions, one price` : null, payback ? `pays for itself in ${payback} years` : null].filter(Boolean).join('  ·  '),
    boxes: hasSavings
      ? [{ label: 'You pay', value: inr(netPay), sub: pres.totals.subsidy > 0 ? `after ${inr(pres.totals.subsidy)} subsidy · incl. GST` : 'one price, incl. GST' },
         { label: 'You save', value: `${inr(n.monthlySaving)}/mo`, sub: `${inr(n.annualSaving)} every year` },
         { label: 'Payback', value: payback == null ? '—' : payback === 0 ? 'Day one' : `${payback} yrs`, sub: payback == null ? '' : payback === 0 ? 'fully covered by subsidy' : `then ${Math.max(25 - Math.ceil(payback), 0)} more years of near-free power` }]
      : [{ label: 'You pay', value: inr(netPay), sub: pres.totals.subsidy > 0 ? `after ${inr(pres.totals.subsidy)} subsidy` : 'incl. GST' },
         { label: 'System', value: `${pres.meta.kwp} kW`, sub: sysTypeLabel(pres.meta.sysType) },
         { label: 'GST included', value: inr(pres.totals.gst), sub: `@ ${pres.totals.gstPct}%` }],
    strip: [lifetime > 0 && { value: inrCompact(lifetime), label: '25-year savings' }, n.annualGen > 0 && { value: `${Math.round(n.annualGen).toLocaleString('en-IN')} units`, label: 'generated every year' }, cp.warranty_headline && { value: cp.warranty_headline.split(' ').slice(0, 2).join(' '), label: cp.warranty_headline.split(' ').slice(2).join(' ') }].filter(Boolean),
    preparedBy: project.created_by_name ? `${project.created_by_name}, Solar Consultant` : null,
  });

  // 2. Why us · comparison · financing (each auto-hides without data)
  doc.addPage(); drawHeader(doc, ctx, 'Kit Quotation'); let y = 44; const y0 = y;
  y = drawWhyUs(doc, ctx, y, { stats: extra.stats, certifications: cp.certifications || [], warrantyHeadline: cp.warranty_headline });
  y = drawComparisonChart(doc, ctx, y, yearly, { netCost: netPay, lifetimeSavings: Math.round(lifetime) });
  y = drawFinancing(doc, ctx, y, cp.financing_options);
  if (y === y0) { doc.deletePage(doc.getNumberOfPages()); doc.addPage(); drawHeader(doc, ctx, 'Kit Quotation'); y = 44; }

  // 3. The system — one line, one price
  y = ensureSpace(doc, ctx, y, 60);
  y = sectionTitle(doc, ctx, y, 'Your solar kit', 'One complete system, one price');
  autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'grid', styles: { font: FONT, fontSize: 11, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.3 },
    headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold' }, columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 50, halign: 'right', fontStyle: 'bold' } },
    head: [['System', 'Price']], body: [[pres.systemLine.name, inr(pres.systemLine.price)]] });
  y = doc.lastAutoTable.finalY + 4;
  doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text('WHAT\'S INCLUDED', m, y); y += 5;
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
  pres.systemLine.inclusions.forEach(inc => { y = ensureSpace(doc, ctx, y, 8, 'Kit Quotation'); doc.setFillColor(...p); doc.circle(m + 1.5, y - 1.3, 1.1, 'F'); const ls = doc.splitTextToSize(inc, contentW - 6); doc.text(ls, m + 5, y); y += ls.length * 4.6; });
  y += 4;

  // 4. Add-on groups
  pres.addonGroupLines.forEach(g => {
    y = ensureSpace(doc, ctx, y, 30, 'Kit Quotation');
    autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'grid', styles: { font: FONT, fontSize: 10, cellPadding: 3.2, textColor: INK, lineColor: LINE, lineWidth: 0.3 },
      headStyles: { fillColor: PAPER, textColor: INK, fontStyle: 'bold' }, columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 62, halign: 'right', fontStyle: 'bold' } },
      head: [[`Add-on — ${g.name}`, g.optional_priced_separately ? `${inr(g.price)} (optional)` : inr(g.price)]], body: [] });
    y = doc.lastAutoTable.finalY + 3;
    if (g.description) { doc.setFont(FONT, 'italic'); doc.setFontSize(8); doc.setTextColor(...MUTED); const ls = doc.splitTextToSize(g.description, contentW - 4); doc.text(ls, m + 2, y); y += ls.length * 4; }
    doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK);
    g.inclusions.forEach(inc => { const ls = doc.splitTextToSize(`• ${inc}`, contentW - 6); doc.text(ls, m + 4, y); y += ls.length * 4.2; });
    y += 4;
  });

  // 5. Totals
  y = ensureSpace(doc, ctx, y, 50, 'Kit Quotation');
  const rows = [['System', inr(pres.totals.systemPrice)]];
  if (pres.totals.addonsTotal > 0) rows.push(['Add-ons', inr(pres.totals.addonsTotal)]);
  rows.push([`GST @ ${pres.totals.gstPct}%`, inr(pres.totals.gst)]);
  if (pres.totals.subsidy > 0) rows.push(['Less subsidy (PM Surya Ghar / KUSUM)', `− ${inr(pres.totals.subsidy)}`]);
  rows.push([{ content: 'YOU PAY', styles: { fontStyle: 'bold', fillColor: p, textColor: INK, fontSize: 11 } }, { content: inr(netPay), styles: { fontStyle: 'bold', fillColor: p, textColor: INK, fontSize: 11, halign: 'right' } }]);
  autoTable(doc, { startY: y, margin: { left: W / 2, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9.5, cellPadding: 2.4, textColor: INK }, columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 45, halign: 'right' } }, body: rows });
  y = doc.lastAutoTable.finalY + 4;
  if (pres.totals.optionalTotal > 0) { doc.setFont(FONT, 'italic'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(`Optional add-ons (priced separately, not in total): ${inr(pres.totals.optionalTotal)}`, m, y); y += 6; }
  y += 4;

  // 6. Terms
  y = ensureSpace(doc, ctx, y, 40, 'Kit Quotation');
  y = sectionTitle(doc, ctx, y, 'Terms & conditions');
  const termsFont = await loadTermsFont(doc, terms, FONT);
  const termsLines = terms?.content ? parseTermsHtml(terms.content) : ['No terms configured yet — set one under Terms & Conditions.'];
  autoTable(doc, { startY: y, margin: { left: m, right: m, top: 44 }, theme: 'plain', styles: { font: termsFont, fontSize: 7.5, cellPadding: { top: 1.2, bottom: 1.2, left: 1, right: 1 }, textColor: [60, 70, 85] }, body: termsLines.map((t, i) => [`${i + 1}. ${t}`]), didDrawPage: () => drawHeader(doc, ctx, 'Kit Quotation') });
  y = doc.lastAutoTable.finalY + 3;
  doc.setFont(termsFont, 'italic'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(`Terms used: ${terms?.title || 'Standard Terms'} (v${terms?.version ?? 0})`, m, y); y += 10;

  // 7. Call to action
  drawCTA(doc, ctx, y, { refNo, primaryLabel: `Call ${cp.sales_contact_phone || cp.phone || 'us'} to confirm your installation date` });
  drawFooters(doc, ctx, `${cp.company_name || 'Sensoper Controls & Renewables'} · Kit Quotation`, terms ? `Terms: ${terms.title || 'Standard Terms'} v${terms.version ?? 0}` : null, refNo);
  doc.save(`KitQuotation_${(cust.name || 'Customer').replace(/\s+/g, '_')}_${project.id?.slice(-6) || 'DRAFT'}.pdf`);
}
