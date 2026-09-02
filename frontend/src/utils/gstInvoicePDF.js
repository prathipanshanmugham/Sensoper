/**
 * GST Tax Invoice PDF (Iteration 44 — Batch A)
 *
 * A proper Indian tax invoice — distinct from the Kit Quotation PDF. Renders every
 * field a GST tax invoice legally needs: invoice number/date, company + customer
 * GSTIN, place of supply, reverse-charge indicator, HSN/SAC per line, taxable value,
 * CGST+SGST or IGST (never both), amount in words, declaration and signatory block.
 *
 * Takes the invoice object exactly as returned by GET/POST /api/projects/{id}/invoice —
 * never recomputes GST here, only renders what the backend already calculated.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const CURRENCY = (v) => `Rs. ${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export function generateGstInvoicePDF(invoice, companyProfile) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const m = 14;
  const primaryHex = companyProfile?.primary_color || '#4ADE40';
  const pRgb = [parseInt(primaryHex.slice(1, 3), 16), parseInt(primaryHex.slice(3, 5), 16), parseInt(primaryHex.slice(5, 7), 16)];

  // ============ Header ============
  doc.setFillColor(...pRgb);
  doc.rect(0, 0, pageW, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text(invoice.company?.name || 'Sensoper Controls & Renewables', m, 12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(invoice.company?.address?.replace(/\n/g, ', ') || '', m, 18);
  doc.text(`GSTIN: ${invoice.company?.gstin || '—'}`, m, 23);

  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('TAX INVOICE', pageW - m, 33, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Invoice No: ${invoice.invoice_number}`, pageW - m, 39, { align: 'right' });
  doc.text(`Invoice Date: ${new Date(invoice.invoice_date).toLocaleDateString('en-IN')}`, pageW - m, 44, { align: 'right' });
  doc.text(`Reverse Charge: ${invoice.reverse_charge ? 'Yes' : 'No'}`, pageW - m, 49, { align: 'right' });

  let y = 33;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Bill To:', m, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(invoice.customer?.name || '—', m, y); y += 4.5;
  doc.splitTextToSize(invoice.customer?.billing_address || '', 90).forEach(l => { doc.text(l, m, y); y += 4.5; });
  if (invoice.customer?.gstin) { doc.text(`GSTIN: ${invoice.customer.gstin}`, m, y); y += 4.5; }
  doc.text(`Phone: ${invoice.customer?.phone || '—'}`, m, y); y += 4.5;

  const shipY = 33;
  if (invoice.customer?.shipping_address && invoice.customer.shipping_address !== invoice.customer.billing_address) {
    let sy = shipY;
    doc.setFont('helvetica', 'bold'); doc.text('Ship To:', pageW / 2, sy); sy += 5;
    doc.setFont('helvetica', 'normal');
    doc.splitTextToSize(invoice.customer.shipping_address, 60).forEach(l => { doc.text(l, pageW / 2, sy); sy += 4.5; });
  }

  y = Math.max(y, 55) + 3;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(`Place of Supply: ${invoice.place_of_supply}`, m, y);
  y += 6;

  // ============ Line items ============
  const body = (invoice.line_items || []).map((li, i) => [
    i + 1, li.description, li.hsn_sac || '—', li.quantity, CURRENCY(li.unit_price),
    CURRENCY(li.taxable_value), `${li.gst_pct}%`,
    invoice.total_igst > 0 ? CURRENCY(li.igst) : CURRENCY(li.cgst + li.sgst),
  ]);
  autoTable(doc, {
    startY: y, margin: { left: m, right: m }, theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: pRgb, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    head: [['#', 'Description', 'HSN/SAC', 'Qty', 'Unit Price', 'Taxable Value', 'GST%', invoice.total_igst > 0 ? 'IGST' : 'CGST+SGST']],
    body,
  });
  y = doc.lastAutoTable.finalY + 4;

  // ============ Totals ============
  const totalRows = [['Total Taxable Value', CURRENCY(invoice.total_taxable_value)]];
  if (invoice.total_igst > 0) {
    totalRows.push(['IGST', CURRENCY(invoice.total_igst)]);
  } else {
    totalRows.push(['CGST', CURRENCY(invoice.total_cgst)]);
    totalRows.push(['SGST', CURRENCY(invoice.total_sgst)]);
  }
  totalRows.push([{ content: 'GRAND TOTAL', styles: { fontStyle: 'bold', fillColor: pRgb, textColor: [255, 255, 255] } },
                  { content: CURRENCY(invoice.grand_total), styles: { fontStyle: 'bold', fillColor: pRgb, textColor: [255, 255, 255] } }]);
  autoTable(doc, {
    startY: y, margin: { left: pageW / 2, right: m }, theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 45, halign: 'right', fontStyle: 'bold' } },
    body: totalRows,
  });
  y = doc.lastAutoTable.finalY + 6;

  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
  doc.text(`Amount in words: ${invoice.amount_in_words}`, m, y); y += 8;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 80);
  const decl = doc.splitTextToSize(`Declaration: ${invoice.declaration}`, pageW - 2 * m);
  decl.forEach(l => { doc.text(l, m, y); y += 4; });
  y += 10;

  if (y > 260) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(`For ${invoice.company?.name || ''}`, pageW - m, y, { align: 'right' }); y += 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(invoice.company?.authorized_signatory || 'Authorized Signatory', pageW - m, y, { align: 'right' }); y += 4.5;
  if (invoice.company?.designation) { doc.text(invoice.company.designation, pageW - m, y, { align: 'right' }); }

  doc.save(`TaxInvoice_${invoice.invoice_number}.pdf`);
}
