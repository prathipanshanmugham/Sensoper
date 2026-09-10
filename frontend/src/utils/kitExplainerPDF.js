/**
 * Iter 52 — Kit Explainer (INTERNAL). Full cost → margin → GST → rounding breakdown of a kit,
 * one row per priced line. Admin/Manager only. NEVER hand this to a customer — every page is
 * watermarked and the footer says so.
 */
import autoTable from 'jspdf-autotable';
import { buildKitSalesBreakdown, buildKitPresentation } from './kitQuotationPDF';
import { createBrandDoc, drawHeader, drawFooters, ensureSpace, sectionTitle, inr, fmtDate, INK, MUTED, LINE, PAPER } from './pdfBrand';

const pctLabel = (v) => (v === null || v === undefined ? 'MISSING' : `${v}%`);
const signed = (v) => `${v >= 0 ? '+' : '−'} ${inr(Math.abs(v))}`;

function watermark(doc, ctx) {
  const { FONT, W, H } = ctx;
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.08 }));
  doc.setFont(FONT, 'bold'); doc.setFontSize(46); doc.setTextColor(220, 38, 38);
  doc.text('INTERNAL — NOT FOR CUSTOMER', W / 2, H / 2, { align: 'center', angle: 35 });
  doc.restoreGraphicsState();
}

function banner(doc, ctx, y) {
  const { FONT, W, m } = ctx;
  doc.setFillColor(254, 226, 226); doc.setDrawColor(220, 38, 38); doc.setLineWidth(0.5);
  doc.roundedRect(m, y, W - 2 * m, 12, 1.5, 1.5, 'FD');
  doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(153, 27, 27);
  doc.text('INTERNAL DOCUMENT — NOT FOR CUSTOMER. Shows cost, margin and GST for every line of this kit.', W / 2, y + 7.5, { align: 'center' });
  return y + 18;
}

function lineRows(lines) {
  return lines.map(l => [
    `${l.name}${l.benchmark ? ' (benchmark)' : ''}${l.specifications ? ` — ${l.specifications}` : ''}`,
    String(l.qty ?? 1), inr(l.line_cost), pctLabel(l.margin_pct), inr(l.line_with_margin - l.line_cost), inr(l.line_with_margin),
    pctLabel(l.gst_pct), inr(l.gst_amount || 0), inr((l.line_with_margin || 0) + (l.gst_amount || 0)),
  ]);
}

export async function generateKitExplainerPDF(project, companyProfile, config, addonGroups, extra = {}) {
  const sb = buildKitSalesBreakdown(project, config, addonGroups);
  const pres = buildKitPresentation(project, config, addonGroups);
  const { doc, ctx } = await createBrandDoc(companyProfile, extra.apiUrl);
  const { FONT, W, m, contentW } = ctx;
  const refNo = project.reference_number || `SCR-${(project.id || '').slice(0, 8).toUpperCase()}`;
  const subtitle = 'Kit Explainer · Internal';
  const head = [['Line', 'Qty', 'Cost', 'Margin %', 'Margin ₹', 'Sell (ex-GST)', 'GST %', 'GST ₹', 'Line total']];
  const colStyles = { 0: { cellWidth: contentW * 0.30 }, 1: { halign: 'center', cellWidth: contentW * 0.05 }, 2: { halign: 'right', cellWidth: contentW * 0.10 },
    3: { halign: 'center', cellWidth: contentW * 0.08 }, 4: { halign: 'right', cellWidth: contentW * 0.09 }, 5: { halign: 'right', cellWidth: contentW * 0.11 },
    6: { halign: 'center', cellWidth: contentW * 0.07 }, 7: { halign: 'right', cellWidth: contentW * 0.09 }, 8: { halign: 'right', cellWidth: contentW * 0.11, fontStyle: 'bold' } };
  const tableOpts = (startY) => ({
    startY, margin: { left: m, right: m, top: 44 }, theme: 'grid', head, columnStyles: colStyles,
    headStyles: { font: FONT, fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    styles: { font: FONT, fontSize: 7.5, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0.3 },
    alternateRowStyles: { fillColor: PAPER },
    didParseCell: (d) => { if (d.section === 'body' && d.cell.raw === 'MISSING') { d.cell.styles.textColor = [185, 28, 28]; d.cell.styles.fontStyle = 'bold'; } },
    didDrawPage: () => { drawHeader(doc, ctx, subtitle); watermark(doc, ctx); },
  });

  drawHeader(doc, ctx, subtitle); watermark(doc, ctx);
  let y = 44;
  y = banner(doc, ctx, y);
  doc.setFont(FONT, 'bold'); doc.setFontSize(16); doc.setTextColor(...INK); doc.text(`Kit Explainer — ${pres.systemLine.name}`, m, y); y += 7;
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text(`${refNo} · ${project.customer?.name || '—'} · ${fmtDate()} · prepared by ${extra.preparedBy || '—'}`, m, y); y += 4;
  doc.text(`Customer-facing kit price: ${inr(pres.totals.netPayable)} (incl. GST${pres.totals.subsidy > 0 ? `, after ${inr(pres.totals.subsidy)} subsidy` : ''}). Cash rounding: nearest ₹${sb.config.step}, ${sb.config.mode}.`, m, y); y += 8;

  if (sb.missingLines.length) {
    y = ensureSpace(doc, ctx, y, 16, subtitle);
    doc.setFillColor(255, 247, 237); doc.setDrawColor(251, 146, 60); doc.roundedRect(m, y, W - 2 * m, 10, 1.5, 1.5, 'FD');
    doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(154, 52, 18);
    doc.text(`Pricing incomplete — ${sb.missingLines.length} line(s) missing margin% or GST%: ${sb.missingLines.slice(0, 4).join(', ')}${sb.missingLines.length > 4 ? '…' : ''}`, m + 3, y + 6.5);
    y += 14;
  }

  // 1. Base system lines
  if (sb.system.lines.length) {
    y = ensureSpace(doc, ctx, y, 40, subtitle);
    y = sectionTitle(doc, ctx, y, 'Base system (Solar Calculator)', 'Panels · inverter · battery · structure · cabling · installation');
    autoTable(doc, { ...tableOpts(y), body: lineRows(sb.system.lines) });
    y = doc.lastAutoTable.finalY + 6;
  }
  // 2. Core items + other priced lines
  if (sb.core.lines.length) {
    y = ensureSpace(doc, ctx, y, 40, subtitle);
    y = sectionTitle(doc, ctx, y, 'Kit items & other priced lines', 'Part of the single kit price');
    autoTable(doc, { ...tableOpts(y), body: lineRows(sb.core.lines) });
    y = doc.lastAutoTable.finalY + 6;
  }
  // 3. Add-on groups
  sb.groups.forEach(g => {
    y = ensureSpace(doc, ctx, y, 40, subtitle);
    y = sectionTitle(doc, ctx, y, `Add-on group: ${g.name}`, [g.optional_priced_separately ? 'Optional — priced separately' : 'Included in total', g.show_on_pdf ? 'shown on customer PDF' : 'hidden on customer PDF'].join(' · '));
    autoTable(doc, { ...tableOpts(y), body: lineRows(g.lines) });
    y = doc.lastAutoTable.finalY + 6;
  });

  // 4. Totals & margin story
  y = ensureSpace(doc, ctx, y, 70, subtitle);
  y = sectionTitle(doc, ctx, y, 'How the customer price is built', 'Cost → margin → GST → subsidy → rounding');
  const t = sb.totals;
  const rows = [
    ['Total cost (all lines)', inr(t.rawCost)],
    ['Margin added', `${signed(t.netMarginRupees)}  (${t.netMarginPct.toFixed(1)}% on cost)`],
    ['Selling price (ex-GST)', inr(t.rawWithMargin)],
    ['GST (sum of every line\u2019s own rate)', `${inr(t.gst)}  (effective ${t.gstPct}%)`],
    ...(t.subsidy > 0 ? [['Less subsidy', `− ${inr(t.subsidy)}`]] : []),
    ['Exact payable', inr(t.netExact)],
    [`Round off (nearest ₹${sb.config.step}, ${sb.config.mode})`, signed(t.roundingImpact)],
    [{ content: 'CUSTOMER PAYS', styles: { fontStyle: 'bold', fontSize: 10.5 } }, { content: inr(t.netPayable), styles: { fontStyle: 'bold', fontSize: 10.5, halign: 'right' } }],
  ];
  autoTable(doc, { startY: y, margin: { left: W / 2 - 10, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9, cellPadding: 2.2, textColor: INK }, columnStyles: { 1: { halign: 'right', cellWidth: 50 } }, body: rows,
    didDrawPage: () => { drawHeader(doc, ctx, subtitle); watermark(doc, ctx); } });
  y = doc.lastAutoTable.finalY + 6;
  doc.setFont(FONT, 'italic'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text('Customer documents show one kit price and add-on group prices only — never these per-line figures.', m, y);

  drawFooters(doc, ctx, 'INTERNAL — NOT FOR CUSTOMER · Kit Explainer', `Generated ${fmtDate()}`, refNo);
  doc.save(`Kit-Explainer-INTERNAL-${refNo}.pdf`);
}
