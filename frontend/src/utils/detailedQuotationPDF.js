/**
 * Detailed Quotation PDF (Iteration 48 rebuild) — a sales document that keeps every
 * compliance fact. Cover → Why us / 25-yr comparison / financing → System & site →
 * Cost breakdown → Pay now → Reference installation → Terms → Call to action.
 */
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { parseTermsHtml } from './termsParser';
import { loadTermsFont } from './pdfFont';
import { createBrandDoc, drawHeader, drawFooters, drawCoverPage, drawWhyUs, drawComparisonChart, drawFinancing, drawCTA, ensureSpace, sectionTitle, paragraph, inr, inrCompact, fmtDate, INK, MUTED, LINE, PAPER } from './pdfBrand';

const round1 = (v) => Math.round(v * 10) / 10;
const val = (v, unit = '') => (v === 0 || v === '' || v === null || v === undefined ? null : `${v}${unit}`);

/** Every headline number on the cover derives from here — one source, consistent everywhere. */
export function deriveSalesNumbers(project) {
  const ps = project.custom_fields?.proposed_solution || {};
  const q = ps._quick || {}, d = ps._derived || {}, ce = project.cost_estimation || {};
  const kw = parseFloat(ps.system_size_kw || project.solar_system?.system_size_kw) || 0;
  const totalQuoted = ce.total_cost || ps.total_cost || 0;
  const subsidy = project.subsidy_tracking?.eligible_amount || parseFloat(ps.subsidy) || 0;
  const netPay = Math.max(totalQuoted - subsidy, 0);
  const monthlySaving = q.monthly_saving ?? d.monthly_savings ?? (d.annual_savings ? d.annual_savings / 12 : 0);
  const annualSaving = q.annual_saving ?? d.annual_savings ?? monthlySaving * 12;
  const payback = annualSaving > 0 ? (netPay > 0 ? round1(netPay / annualSaving) : 0) : null;
  const monthlyBillNow = q.monthly_bill_now || ((project.electrical?.monthly_consumption_units || 0) * (project.electrical?.eb_tariff || 0)) || 0;
  const life = 25, deg = 0.007;
  const yearly = []; let cumWithout = 0, cumWith = netPay, lifetime = 0;
  if (monthlyBillNow > 0 && annualSaving > 0) {
    for (let y = 1; y <= life; y++) { const s = annualSaving * (1 - deg) ** (y - 1); lifetime += s; cumWithout += monthlyBillNow * 12; cumWith += Math.max(monthlyBillNow * 12 - s, 0); yearly.push({ year: y, without_solar: Math.round(cumWithout), with_solar: Math.round(cumWith) }); }
  } else if (annualSaving > 0) { for (let y = 1; y <= life; y++) lifetime += annualSaving * (1 - deg) ** (y - 1); }
  return { ps, q, kw, totalQuoted, subsidy, netPay, monthlySaving: Math.round(monthlySaving || 0), annualSaving: Math.round(annualSaving || 0), payback, yearly, lifetime: Math.round(lifetime),
    panels: ps.panel_count || q.panel_count || 0, panelW: q.panel_wattage_w || null, batteries: ps.battery_count || 0, annualGen: q.annual_generation_units || d.annual_generation_units || 0,
    monthlyBillNow: Math.round(monthlyBillNow) };
}

const SYS_LABEL = { 'on-grid': 'On-Grid', 'off-grid': 'Off-Grid', hybrid: 'Hybrid', 'solar-pump': 'Solar Pump' };

export async function generateDetailedQuotationPDF({ project, companyProfile, terms, refSummary, stats, categoryLabels = {}, apiUrl, inventoryNames = {} }) {
  const cp = companyProfile || {};
  const { doc, ctx } = await createBrandDoc(cp, apiUrl);
  const { FONT, m, contentW, W, p } = ctx;
  const n = deriveSalesNumbers(project);
  const cust = project.customer || {};
  const first = (cust.name || 'your').split(' ')[0];
  const sysType = SYS_LABEL[project.solar_system?.system_type || n.ps.system_type] || 'Solar';
  const refNo = project.reference_number || `SCR-${(project.id || '').slice(0, 8).toUpperCase()}`;
  const validTill = fmtDate(new Date(Date.now() + 30 * 864e5));

  // ── 1. Cover ──────────────────────────────────────────────────────
  const hasSavings = n.monthlySaving > 0;
  const headline = hasSavings ? `Cut ${first}'s electricity bill by ${inr(n.monthlySaving)} every month.` : n.kw ? `A ${n.kw} kW ${sysType} solar power plant for ${first}.` : `Solar proposal for ${cust.name || 'you'}.`;
  const subhead = [n.kw ? `${n.kw} kW ${sysType} rooftop solar` : null, n.panels ? `${n.panels} panels${n.panelW ? ` × ${n.panelW} W` : ''}` : null, n.batteries ? `${n.batteries} battery bank` : null, n.payback ? `pays for itself in ${n.payback} years` : null].filter(Boolean).join('  ·  ');
  const boxes = hasSavings
    ? [{ label: 'You pay', value: inr(n.netPay), sub: n.subsidy > 0 ? `after ${inr(n.subsidy)} subsidy · incl. GST` : 'all-inclusive, incl. GST' },
       { label: 'You save', value: `${inr(n.monthlySaving)}/mo`, sub: `${inr(n.annualSaving)} every year` },
       { label: 'Payback', value: n.payback == null ? '—' : n.payback === 0 ? 'Day one' : `${n.payback} yrs`, sub: n.payback == null ? 'add the bill to compute' : n.payback === 0 ? 'fully covered by subsidy' : `then ${Math.max(25 - Math.ceil(n.payback), 0)} more years of near-free power` }]
    : [{ label: 'You pay', value: inr(n.netPay), sub: n.subsidy > 0 ? `after ${inr(n.subsidy)} subsidy` : 'incl. GST' },
       { label: 'System size', value: n.kw ? `${n.kw} kW` : '—', sub: sysType },
       { label: 'Panels', value: n.panels ? `${n.panels}` : '—', sub: n.panelW ? `${n.panelW} W each` : '' }];
  const strip = [n.lifetime > 0 && { value: inrCompact(n.lifetime), label: '25-year savings' }, n.annualGen > 0 && { value: `${Math.round(n.annualGen).toLocaleString('en-IN')} units`, label: 'generated every year' }, cp.warranty_headline && { value: cp.warranty_headline.split(' ').slice(0, 2).join(' '), label: cp.warranty_headline.split(' ').slice(2).join(' ') }].filter(Boolean);
  drawCoverPage(doc, ctx, { docTitle: 'Detailed Quotation', refNo, date: fmtDate(), validTill, customer: cust, headline, subhead, boxes, strip, preparedBy: project.created_by_name ? `${project.created_by_name}, Solar Consultant` : null });

  // ── 2. Why us · comparison · financing ───────────────────────────
  doc.addPage(); drawHeader(doc, ctx, 'Detailed Quotation'); let y = 44;
  const y0 = y;
  y = drawWhyUs(doc, ctx, y, { stats, certifications: cp.certifications || [], warrantyHeadline: cp.warranty_headline });
  y = drawComparisonChart(doc, ctx, y, n.yearly, { netCost: n.netPay, lifetimeSavings: n.lifetime });
  y = drawFinancing(doc, ctx, y, cp.financing_options);
  if (y === y0) { doc.deletePage(doc.getNumberOfPages()); doc.addPage(); drawHeader(doc, ctx, 'Detailed Quotation'); y = 44; }

  // ── 3. Your system + site & electrical (compliance page) ─────────
  y = ensureSpace(doc, ctx, y, 70);
  y = sectionTitle(doc, ctx, y, 'Your system', 'Proposed solution');
  const specRows = [
    ['System type', sysType], ['System size', val(n.kw, ' kW')],
    ['Solar panels', n.panels ? `${n.panels} nos${n.panelW ? ` × ${n.panelW} W` : ''}${inventoryNames[n.ps.panel_item_id] ? ` — ${inventoryNames[n.ps.panel_item_id]}` : ''}` : null],
    ['Inverter', inventoryNames[n.ps.inverter_item_id] || (n.q.inverter_rated_kw ? `${n.q.inverter_rated_kw} kW` : null)],
    ['Battery', n.batteries ? `${n.batteries} nos${inventoryNames[n.ps.battery_item_id] ? ` — ${inventoryNames[n.ps.battery_item_id]}` : ''}${n.q.backup_hours ? ` · ${n.q.backup_hours} h backup` : ''}` : null],
    ['Estimated generation', n.annualGen ? `${Math.round(n.annualGen).toLocaleString('en-IN')} units/year (${Math.round(n.annualGen / 12).toLocaleString('en-IN')}/month)` : null],
    ['Current consumption', n.q.monthly_eb_units ? `${n.q.monthly_eb_units} units/month at ₹${n.q.tariff_per_unit}/unit` : null],
    ['Pump', n.ps.pump_hp ? `${n.ps.pump_hp} HP ${n.ps.pump_type || ''} · head ${n.ps.pump_head_m} m · ${n.ps.pump_discharge_lph} LPH` : null],
  ].filter(r => r[1]);
  const kv = (rows, startY) => { autoTable(doc, { startY, margin: { left: m, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9, cellPadding: 1.8, textColor: INK }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 52, textColor: MUTED } }, body: rows }); return doc.lastAutoTable.finalY + 6; };
  y = kv(specRows, y);

  y = ensureSpace(doc, ctx, y, 60);
  y = sectionTitle(doc, ctx, y, 'Site & electrical details', 'For the installer and DISCOM');
  const el = project.electrical || {}, loc = project.location || {}, mt = project.mounting || {}, add = project.additional || {};
  const connected = el.connected_load_kw ?? project.site_measurements?.load?.connected_load;
  const monthly = el.monthly_consumption_units ?? project.site_measurements?.load?.monthly_units;
  const siteRows = [
    ['Customer', [cust.name, cust.phone, cust.email].filter(Boolean).join(' · ')], ['Address', cust.address],
    ['Site', [loc.address, loc.site_location_words ? `///${loc.site_location_words}` : null].filter(Boolean).join(' · ')],
    ['Roof', [mt.roof_type, mt.structure_type, mt.tilt_angle ? `${mt.tilt_angle}° tilt` : null].filter(Boolean).join(' · ')],
    ['Service type', [el.service_type, el.connection_phase].filter(Boolean).join(' · ')],
    ['Sanctioned load', val(el.sanction_load_kw, ' kW')], ['Connected load', val(connected, ' kW')],
    ['Monthly consumption', val(monthly, ' units')], ['EB tariff', el.eb_tariff ? `₹${el.eb_tariff}/unit` : null],
    ['Cable run (roof → DB)', val(add.cable_length_meters, ' m')], ['Inverter → panel distance', val(add.inverter_to_panel_distance, ' m')],
  ].filter(r => r[1]);
  y = kv(siteRows, y);

  // ── 4. Cost breakdown ────────────────────────────────────────────
  const items = project.cost_estimation?.items_breakdown || project.selected_items || [];
  const manualCosts = project.cost_estimation?.manual_costs || project.manual_costs || [];
  const ce = project.cost_estimation || {};
  y = ensureSpace(doc, ctx, y, 70);
  y = sectionTitle(doc, ctx, y, 'Price breakdown', 'Every item, nothing hidden');
  autoTable(doc, {
    startY: y, margin: { left: m, right: m, top: 44 }, theme: 'grid',
    head: [['Item', 'Category', 'Qty', 'Unit price', 'GST', 'Amount']],
    body: [...items.map(it => [it.name, categoryLabels[it.category] || it.category || '', String(it.quantity ?? 1), inr(it.unit_price), `${it.gst_percentage ?? 18}%`, inr(it.amount || (it.unit_price || 0) * (it.quantity || 1))]),
           ...manualCosts.map(c => [{ content: c.description || 'Additional', styles: { fontStyle: 'italic' } }, '', '', '', '', inr(c.amount)])],
    headStyles: { font: FONT, fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    styles: { font: FONT, fontSize: 8.5, cellPadding: 2.6, textColor: INK, lineColor: LINE, lineWidth: 0.3 },
    columnStyles: { 0: { cellWidth: contentW * 0.32 }, 1: { cellWidth: contentW * 0.17 }, 2: { halign: 'center', cellWidth: contentW * 0.07 }, 3: { halign: 'right', cellWidth: contentW * 0.15 }, 4: { halign: 'center', cellWidth: contentW * 0.09 }, 5: { halign: 'right', cellWidth: contentW * 0.2, fontStyle: 'bold' } },
    alternateRowStyles: { fillColor: PAPER },
    didDrawPage: () => drawHeader(doc, ctx, 'Detailed Quotation'),
  });
  y = doc.lastAutoTable.finalY + 2;
  const totals = [['Subtotal', inr(ce.subtotal)], ['GST', inr(ce.total_gst)], [{ content: 'Total (incl. GST)', styles: { fontStyle: 'bold' } }, { content: inr(n.totalQuoted), styles: { fontStyle: 'bold' } }]];
  if (n.subsidy > 0) totals.push(['Less subsidy', `− ${inr(n.subsidy)}`]);
  totals.push([{ content: 'YOU PAY', styles: { fontStyle: 'bold', fillColor: p, textColor: INK, fontSize: 11 } }, { content: inr(n.netPay), styles: { fontStyle: 'bold', fillColor: p, textColor: INK, fontSize: 11, halign: 'right' } }]);
  autoTable(doc, { startY: y, margin: { left: W / 2, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9.5, cellPadding: 2.4, textColor: INK }, columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 45 } }, body: totals });
  y = doc.lastAutoTable.finalY + 8;

  // ── 5. Pay now (bank + UPI) ──────────────────────────────────────
  const bank = cp.bank_details;
  if (bank?.account_name) {
    y = ensureSpace(doc, ctx, y, 62);
    y = sectionTitle(doc, ctx, y, 'Pay now — bank transfer or UPI', 'Booking advance');
    const paid = (project.payments || []).reduce((a, x) => a + (x.amount || 0), 0);
    const due = Math.max(n.totalQuoted - paid, 0);
    let upiQR = null;
    if (bank.upi_id) {
      const upi = `upi://pay?pa=${bank.upi_id}&pn=${encodeURIComponent(cp.company_name || 'Sensoper')}&am=${due || n.totalQuoted}&cu=INR&tn=${encodeURIComponent(`Quote ${refNo} - ${(cust.name || '').slice(0, 20)}`)}`;
      try { upiQR = await QRCode.toDataURL(upi, { width: 220, margin: 1, errorCorrectionLevel: 'M' }); } catch { /* skip QR */ }
    }
    const bankRows = [['Account name', bank.account_name], ['Account no.', bank.account_number], ['IFSC', bank.ifsc_code], ['Bank', [bank.bank_name, bank.branch].filter(Boolean).join(', ')], ['UPI ID', bank.upi_id]].filter(r => r[1]);
    if (paid > 0) bankRows.push(['Received so far', `${inr(paid)} · balance ${inr(due)}`]);
    const tableW = upiQR ? contentW * 0.6 : contentW;
    autoTable(doc, { startY: y, margin: { left: m, right: W - m - tableW }, theme: 'plain', styles: { font: FONT, fontSize: 9, cellPadding: 1.8, textColor: INK }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40, textColor: MUTED } }, body: bankRows });
    if (upiQR) { const qx = W - m - 38; doc.setDrawColor(...LINE); doc.roundedRect(qx - 3, y - 3, 44, 50, 2, 2, 'S'); try { doc.addImage(upiQR, 'PNG', qx, y, 38, 38); } catch { /* skip */ } doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...INK); doc.text('Scan to pay via UPI', qx + 19, y + 43, { align: 'center' }); }
    y = Math.max(doc.lastAutoTable.finalY, y + 50) + 8;
  }

  // ── 6. Site documentation QR ─────────────────────────────────────
  if (project.drive_folder_link) {
    let qr = null; try { qr = await QRCode.toDataURL(project.drive_folder_link, { width: 150, margin: 1 }); } catch { /* skip */ }
    y = ensureSpace(doc, ctx, y, 40);
    y = sectionTitle(doc, ctx, y, 'Site photos & documents');
    if (qr) { try { doc.addImage(qr, 'PNG', m, y, 26, 26); } catch { /* skip */ } }
    doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(`${project.drive_folder_name ? `Folder: ${project.drive_folder_name}. ` : ''}Scan to open all site images and documents.`, contentW - 32), m + 30, y + 6);
    doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(project.drive_folder_link, contentW - 32), m + 30, y + 16);
    y += 34;
  }

  // ── 7. Reference installation (real data only) ───────────────────
  if (refSummary?.system_size_kw) {
    y = ensureSpace(doc, ctx, y, 40);
    y = sectionTitle(doc, ctx, y, 'A system like yours, already running', 'Reference installation');
    const t = refSummary.till_date || {};
    const facts = [[`${refSummary.system_size_kw} kW`, refSummary.location || refSummary.customer_name || 'installed site'], t.units_generated > 0 && [`${Math.round(t.units_generated).toLocaleString('en-IN')} units`, `generated in ${t.months_elapsed || 0} months`], t.savings_inr > 0 && [inrCompact(t.savings_inr), 'saved so far']].filter(Boolean);
    const cw = contentW / facts.length;
    facts.forEach((f, i) => { doc.setFont(FONT, 'bold'); doc.setFontSize(14); doc.setTextColor(...INK); doc.text(f[0], m + cw * i, y + 4); doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(f[1], cw - 6)[0], m + cw * i, y + 10); });
    y += 18;
    y = paragraph(doc, ctx, y, `Figures above are measured from an actual ${cp.company_name || ''} installation (ref ${refSummary.reference_number || ''}), not estimates.`, { size: 7.5, color: MUTED });
  }

  // ── 8. Terms & conditions ────────────────────────────────────────
  y = ensureSpace(doc, ctx, y, 40);
  y = sectionTitle(doc, ctx, y, 'Terms & conditions');
  const termsFont = await loadTermsFont(doc, terms, FONT);
  const termsList = terms?.content ? parseTermsHtml(terms.content) : ['No terms configured yet — set one under Terms & Conditions.'];
  autoTable(doc, { startY: y, margin: { left: m, right: m, top: 44 }, theme: 'plain', styles: { font: termsFont, fontSize: 7.5, cellPadding: { top: 1.2, bottom: 1.2, left: 1, right: 1 }, textColor: [60, 70, 85] }, body: termsList.map((t, i) => [`${i + 1}. ${t}`]),
    didDrawPage: () => drawHeader(doc, ctx, 'Detailed Quotation') });
  y = doc.lastAutoTable.finalY + 3;
  doc.setFont(termsFont, 'italic'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(`Terms used: ${terms?.title || 'Standard Terms'} (v${terms?.version ?? 0})`, m, y); y += 10;

  // ── 9. Call to action + signature ────────────────────────────────
  y = drawCTA(doc, ctx, y, { refNo, primaryLabel: `Call ${cp.sales_contact_phone || cp.phone || 'us'} to confirm your installation date` });

  drawFooters(doc, ctx, `${cp.company_name || 'Sensoper Controls & Renewables'} · Detailed Quotation`, terms ? `Terms: ${terms.title || 'Standard Terms'} v${terms.version ?? 0}` : null, refNo);
  doc.save(`Quotation_${(cust.name || 'Customer').replace(/\s+/g, '_')}_${refNo}.pdf`);
}
