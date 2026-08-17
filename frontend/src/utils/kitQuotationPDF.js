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
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const CURRENCY = (v) => `INR ${(v || 0).toLocaleString('en-IN')}`;

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
  const subsidy = project.subsidy_tracking?.eligible_amount || 0;
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
  const subsidy = project.subsidy_tracking?.eligible_amount || 0;
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
 * Generate the Kit Quotation PDF.
 *
 * @param {object} project
 * @param {object} companyProfile
 * @param {object} config
 * @param {Array}  addonGroups
 */
export async function generateKitQuotationPDF(project, companyProfile, config, addonGroups) {
  const pres = buildKitPresentation(project, config, addonGroups);
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const m = 15;

  // ============ Header ============
  const primaryHex = companyProfile?.primary_color || '#4ADE40';
  const pRgb = [parseInt(primaryHex.slice(1, 3), 16), parseInt(primaryHex.slice(3, 5), 16), parseInt(primaryHex.slice(5, 7), 16)];
  doc.setFillColor(...pRgb);
  doc.rect(0, 0, pageW, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(companyProfile?.company_name || 'Sensoper Controls & Renewables', m, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Solar Solutions | Kit Quotation', m, 22);
  doc.text(`Quote No: SC/${project.id?.slice(-6).toUpperCase() || 'DRAFT'}  |  ${new Date().toLocaleDateString('en-IN')}`, m, 27);

  let y = 40;

  // ============ Customer block ============
  doc.setTextColor(50, 50, 50);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('QUOTATION FOR', m, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(project.customer?.name || '—', m, y); y += 5;
  if (project.customer?.address) { doc.text(project.customer.address.slice(0, 80), m, y); y += 5; }
  if (project.customer?.phone) { doc.text(`Phone: ${project.customer.phone}`, m, y); y += 5; }
  y += 4;

  // ============ System line ============
  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m },
    theme: 'grid',
    styles: { fontSize: 11, cellPadding: 4 },
    headStyles: { fillColor: pRgb, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 50, halign: 'right', fontStyle: 'bold' } },
    head: [['System', 'Amount']],
    body: [[pres.systemLine.name, CURRENCY(pres.systemLine.price)]],
  });
  y = doc.lastAutoTable.finalY + 2;

  // Inclusions under the system line
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(80, 80, 80);
  doc.text('Includes:', m + 2, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
  pres.systemLine.inclusions.forEach(inc => {
    const wrapped = doc.splitTextToSize('• ' + inc, pageW - 2 * m - 4);
    wrapped.forEach(w => { doc.text(w, m + 4, y); y += 4.5; });
  });
  y += 4;

  // ============ Add-on groups ============
  pres.addonGroupLines.forEach(g => {
    if (y > 250) { doc.addPage(); y = 20; }
    const priceLabel = g.optional_priced_separately
      ? `${CURRENCY(g.price)} (Optional — priced separately)`
      : CURRENCY(g.price);
    autoTable(doc, {
      startY: y, margin: { left: m, right: m }, theme: 'grid',
      styles: { fontSize: 10, cellPadding: 3.5 },
      headStyles: { fillColor: [230, 240, 235], textColor: [40, 40, 40], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 60, halign: 'right', fontStyle: 'bold' } },
      head: [[`Add-ons — ${g.name}`, priceLabel]],
      body: [],
    });
    y = doc.lastAutoTable.finalY + 1;
    if (g.description) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      const wrapped = doc.splitTextToSize(g.description, pageW - 2 * m - 4);
      wrapped.forEach(w => { doc.text(w, m + 4, y); y += 4; });
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(80, 80, 80);
    doc.text('Includes:', m + 2, y); y += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(70, 70, 70);
    g.inclusions.forEach(inc => {
      const wrapped = doc.splitTextToSize('• ' + inc, pageW - 2 * m - 4);
      wrapped.forEach(w => { doc.text(w, m + 4, y); y += 4; });
    });
    y += 4;
  });

  // ============ Totals ============
  if (y > 240) { doc.addPage(); y = 20; }
  const totalRows = [
    ['System Total', CURRENCY(pres.totals.systemPrice)],
    ['Add-ons Total', CURRENCY(pres.totals.addonsTotal)],
    [`GST @ ${pres.totals.gstPct}%`, CURRENCY(pres.totals.gst)],
  ];
  if (pres.totals.subsidy > 0) totalRows.push(['Less PM Surya Ghar / KUSUM Subsidy', `− ${CURRENCY(pres.totals.subsidy)}`]);
  totalRows.push([{ content: 'NET PAYABLE', styles: { fontStyle: 'bold', fillColor: pRgb, textColor: [255, 255, 255] } },
                  { content: CURRENCY(pres.totals.netPayable), styles: { fontStyle: 'bold', fillColor: pRgb, textColor: [255, 255, 255], halign: 'right' } }]);
  autoTable(doc, {
    startY: y, margin: { left: pageW / 2, right: m }, theme: 'grid',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 45, halign: 'right', fontStyle: 'bold' } },
    body: totalRows,
  });
  y = doc.lastAutoTable.finalY + 6;

  if (pres.totals.optionalTotal > 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
    doc.text(`Optional add-ons (priced separately, not in total): ${CURRENCY(pres.totals.optionalTotal)}`, m, y);
    y += 5;
  }

  // ============ Terms ============
  if (y > 260) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
  doc.text('Terms & Conditions:', m, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(70, 70, 70);
  const terms = [
    '• Quotation valid for 30 days from issue date.',
    '• Payment schedule: 40% advance / 50% on delivery / 10% on commissioning.',
    '• Warranty: Panels 12yr product + 25yr performance, Inverter 5yr, Structure 5yr, Workmanship 1yr.',
    '• Subject to site conditions and DISCOM approvals as applicable.',
    '• All disputes subject to local jurisdiction.',
  ];
  terms.forEach(t => { doc.text(t, m, y); y += 4; });

  // Save
  const filename = `KitQuotation_${(project.customer?.name || 'Customer').replace(/\s+/g, '_')}_${project.id?.slice(-6) || 'DRAFT'}.pdf`;
  doc.save(filename);
}
