/**
 * GST Tax Invoice PDF (Iteration 44 — Batch A; Iteration 48 brand restyle)
 *
 * A proper Indian tax invoice — distinct from the quotations. Renders every field a GST tax
 * invoice legally needs: invoice number/date, company + customer GSTIN, place of supply,
 * reverse-charge indicator, HSN/SAC per line, taxable value, CGST+SGST or IGST (never both),
 * amount in words, declaration and signatory block.
 *
 * Takes the invoice object exactly as returned by GET/POST /api/projects/{id}/invoice —
 * never recomputes GST here, only renders what the backend already calculated.
 * Deliberately contains NO sales copy: shares the quotation's logo/colour/typography only.
 */
import autoTable from 'jspdf-autotable';
import { parseTermsHtml } from './termsParser';
import { loadTermsFont } from './pdfFont';
import { createBrandDoc, drawHeader, drawFooters, ensureSpace, INK, MUTED, LINE, PAPER } from './pdfBrand';

const CURRENCY = (v) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generateGstInvoicePDF(invoice, companyProfile, format = 'list', terms) {
  const cp = { ...(companyProfile || {}), company_name: invoice.company?.name || companyProfile?.company_name, gst_number: invoice.company?.gstin || companyProfile?.gst_number };
  const { doc, ctx } = await createBrandDoc(cp, process.env.REACT_APP_BACKEND_URL);
  const { FONT, m, contentW, W, p } = ctx;
  const SUB = `Tax Invoice · ${format === 'combined' ? 'Combined' : 'Itemised'}`;
  drawHeader(doc, ctx, SUB);

  // ── Title block ──────────────────────────────────────────────────
  let y = 46;
  doc.setFont(FONT, 'bold'); doc.setFontSize(18); doc.setTextColor(...INK); doc.text('TAX INVOICE', m, y + 4);
  doc.setFillColor(...p); doc.rect(m, y + 7, 16, 1.2, 'F');
  const meta = [['Invoice No.', invoice.invoice_number], ['Invoice Date', new Date(invoice.invoice_date).toLocaleDateString('en-IN')], ['Place of Supply', invoice.place_of_supply], ['Reverse Charge', invoice.reverse_charge ? 'Yes' : 'No']];
  autoTable(doc, { startY: y - 4, margin: { left: W / 2 + 10, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 8.5, cellPadding: 1.2, textColor: INK }, columnStyles: { 0: { textColor: MUTED, cellWidth: 32 }, 1: { fontStyle: 'bold', halign: 'right' } }, body: meta });
  y = Math.max(doc.lastAutoTable.finalY, y + 12) + 6;

  // ── Parties ──────────────────────────────────────────────────────
  const party = (title, lines, x) => {
    doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(title, x, y);
    let yy = y + 5;
    lines.filter(Boolean).forEach((l, i) => { doc.setFont(FONT, i === 0 ? 'bold' : 'normal'); doc.setFontSize(i === 0 ? 10 : 8.5); doc.setTextColor(...INK); const ls = doc.splitTextToSize(l, contentW / 2 - 8); doc.text(ls, x, yy); yy += ls.length * 4.3; });
    return yy;
  };
  const yl = party('BILLED BY', [invoice.company?.name, invoice.company?.address?.replace(/\n/g, ', '), invoice.company?.gstin ? `GSTIN ${invoice.company.gstin}` : null, invoice.company?.pan ? `PAN ${invoice.company.pan}` : null], m);
  const shipDiff = invoice.customer?.shipping_address && invoice.customer.shipping_address !== invoice.customer.billing_address;
  const yr = party('BILLED TO', [invoice.customer?.name, invoice.customer?.billing_address, invoice.customer?.gstin ? `GSTIN ${invoice.customer.gstin}` : null, invoice.customer?.phone ? `Phone ${invoice.customer.phone}` : null, shipDiff ? `Ship to: ${invoice.customer.shipping_address}` : null], W / 2 + 4);
  y = Math.max(yl, yr) + 6;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(m, y, W - m, y); y += 6;

  // ── Line items — List (per line) or Combined (rolled up per GST rate slab) ──
  const igst = invoice.total_igst > 0;
  let body, head, columnStyles;
  if (format === 'combined') {
    const byRate = new Map();
    (invoice.line_items || []).forEach((li) => {
      const g = byRate.get(li.gst_pct) || { gst_pct: li.gst_pct, taxable_value: 0, cgst: 0, sgst: 0, igst: 0 };
      g.taxable_value += li.taxable_value; g.cgst += li.cgst; g.sgst += li.sgst; g.igst += li.igst; byRate.set(li.gst_pct, g);
    });
    head = [['Description', 'Taxable Value', 'GST %', igst ? 'IGST' : 'CGST + SGST', 'Total']];
    body = [...byRate.values()].sort((a, b) => a.gst_pct - b.gst_pct).map((g) => { const tax = igst ? g.igst : g.cgst + g.sgst; return [`Goods/Services taxed @ ${g.gst_pct}%`, CURRENCY(g.taxable_value), `${g.gst_pct}%`, CURRENCY(tax), CURRENCY(g.taxable_value + tax)]; });
    columnStyles = { 1: { halign: 'right' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } };
  } else {
    head = [['#', 'Description', 'HSN/SAC', 'Qty', 'Unit Price', 'Taxable Value', 'GST %', igst ? 'IGST' : 'CGST + SGST']];
    body = (invoice.line_items || []).map((li, i) => [i + 1, li.description, li.hsn_sac || '—', li.quantity, CURRENCY(li.unit_price), CURRENCY(li.taxable_value), `${li.gst_pct}%`, CURRENCY(igst ? li.igst : li.cgst + li.sgst)]);
    columnStyles = { 0: { cellWidth: 7, halign: 'center' }, 1: { cellWidth: 52 }, 2: { cellWidth: 18, halign: 'center' }, 3: { cellWidth: 10, halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { cellWidth: 13, halign: 'center' }, 7: { halign: 'right' } };
  }
  autoTable(doc, {
    startY: y, margin: { left: m, right: m, top: 44 }, theme: 'grid', head, body, columnStyles,
    styles: { font: FONT, fontSize: 8, cellPadding: 2.4, textColor: INK, lineColor: LINE, lineWidth: 0.3 },
    headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: PAPER },
    didDrawPage: () => drawHeader(doc, ctx, SUB),
  });
  y = doc.lastAutoTable.finalY + 4;

  // Combined format still discloses every HSN/SAC covered — consolidation changes
  // presentation, not the tax information disclosed (compliance requirement).
  if (format === 'combined') {
    const hsnList = [...new Set((invoice.line_items || []).map(li => li.hsn_sac).filter(Boolean))];
    if (hsnList.length) { doc.setFont(FONT, 'italic'); doc.setFontSize(8); doc.setTextColor(...MUTED); const ls = doc.splitTextToSize(`HSN/SAC codes covered: ${hsnList.join(', ')}`, contentW); doc.text(ls, m, y); y += ls.length * 4 + 3; }
  }

  // ── Tax summary ──────────────────────────────────────────────────
  y = ensureSpace(doc, ctx, y, 50, SUB);
  const totalRows = [['Total Taxable Value', CURRENCY(invoice.total_taxable_value)]];
  if (igst) totalRows.push(['IGST', CURRENCY(invoice.total_igst)]); else totalRows.push(['CGST', CURRENCY(invoice.total_cgst)], ['SGST', CURRENCY(invoice.total_sgst)]);
  if (invoice.round_off) totalRows.push(['Round off', CURRENCY(invoice.round_off)]);
  totalRows.push([{ content: 'GRAND TOTAL', styles: { fontStyle: 'bold', fillColor: INK, textColor: [255, 255, 255], fontSize: 10 } }, { content: CURRENCY(invoice.grand_total), styles: { fontStyle: 'bold', fillColor: INK, textColor: [255, 255, 255], fontSize: 10, halign: 'right' } }]);
  autoTable(doc, { startY: y, margin: { left: W / 2, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9, cellPadding: 2.4, textColor: INK }, columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 45, halign: 'right', fontStyle: 'bold' } }, body: totalRows });
  const totalsEnd = doc.lastAutoTable.finalY;
  doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text('AMOUNT IN WORDS', m, y + 2);
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(doc.splitTextToSize(invoice.amount_in_words || '', W / 2 - m - 8), m, y + 7);
  y = totalsEnd + 8;

  // ── Declaration + Terms ──────────────────────────────────────────
  y = ensureSpace(doc, ctx, y, 30, SUB);
  doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
  const decl = doc.splitTextToSize(`Declaration: ${invoice.declaration}`, contentW); doc.text(decl, m, y); y += decl.length * 4 + 6;
  y = ensureSpace(doc, ctx, y, 30, SUB);
  doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text('Terms & Conditions', m, y); y += 5;
  const termsFont = await loadTermsFont(doc, terms, FONT);
  const termsLines = terms?.content ? parseTermsHtml(terms.content) : ['No terms configured yet — set one under Terms & Conditions.'];
  autoTable(doc, { startY: y, margin: { left: m, right: m, top: 44 }, theme: 'plain', styles: { font: termsFont, fontSize: 7.5, cellPadding: { top: 1, bottom: 1, left: 0, right: 1 }, textColor: [60, 70, 85] }, body: termsLines.map((t, i) => [`${i + 1}. ${t}`]), didDrawPage: () => drawHeader(doc, ctx, SUB) });
  y = doc.lastAutoTable.finalY + 6;

  // ── Signatory ────────────────────────────────────────────────────
  y = ensureSpace(doc, ctx, y, 30, SUB);
  doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(`For ${invoice.company?.name || ''}`, W - m, y, { align: 'right' }); y += 16;
  doc.setDrawColor(...INK); doc.setLineWidth(0.4); doc.line(W - m - 60, y, W - m, y); y += 4.5;
  doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.text(invoice.company?.authorized_signatory || 'Authorised Signatory', W - m, y, { align: 'right' }); y += 4.5;
  if (invoice.company?.designation) doc.text(invoice.company.designation, W - m, y, { align: 'right' });

  drawFooters(doc, ctx, invoice.company?.name || '', `Terms used: ${terms?.title || 'Standard Terms'} (v${terms?.version ?? 0})`, invoice.invoice_number);
  doc.save(`TaxInvoice_${invoice.invoice_number}${format === 'combined' ? '_Combined' : ''}.pdf`);
}
