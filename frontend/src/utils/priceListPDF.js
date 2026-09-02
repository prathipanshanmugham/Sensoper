/**
 * Price List PDF (Iteration 44 — Batch B)
 * Company-branded flat catalogue price list with a per-item GST breakup
 * (CGST+SGST split, using the global gst_pct from Pricing & Config).
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const CURRENCY = (v) => `Rs. ${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function generatePriceListPDF(items, company, gstPct) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const m = 14;
  const primaryHex = company?.primary_color || '#4ADE40';
  const pRgb = [parseInt(primaryHex.slice(1, 3), 16), parseInt(primaryHex.slice(3, 5), 16), parseInt(primaryHex.slice(5, 7), 16)];

  doc.setFillColor(...pRgb);
  doc.rect(0, 0, pageW, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text(company?.company_name || company?.name || 'Sensoper Controls & Renewables', m, 12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text((company?.address || '').replace(/\n/g, ', '), m, 18);
  doc.text(`GSTIN: ${company?.gst_number || '—'}`, m, 23);

  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('PRICE LIST', pageW - m, 33, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, pageW - m, 39, { align: 'right' });
  doc.text(`GST Rate: ${gstPct}%`, pageW - m, 44, { align: 'right' });

  const half = gstPct / 2;
  const body = items.map((it, i) => {
    const gstAmt = it.sellingPrice * (gstPct / 100);
    return [
      i + 1, it.categoryLabel, it.label, CURRENCY(it.sellingPrice),
      `${half.toFixed(1)}% + ${half.toFixed(1)}%`, CURRENCY(gstAmt), CURRENCY(it.sellingPrice + gstAmt),
    ];
  });

  autoTable(doc, {
    startY: 52, margin: { left: m, right: m }, theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: pRgb, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    head: [['#', 'Category', 'Item', 'Unit Price', 'CGST+SGST', 'GST Amt', 'Price incl. GST']],
    body,
  });
  let y = doc.lastAutoTable.finalY + 10;

  if (y > 270) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
  doc.text('Prices are indicative and subject to change without prior notice.', m, y);

  doc.save(`PriceList_${new Date().toISOString().slice(0, 10)}.pdf`);
}
