/**
 * Price List PDF (Iter 51) — company-branded, grouped per category, unicode ₹, validity,
 * optional "prepared for", optional GST breakup, optional internal cost/margin columns.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadUnicodeFont } from './pdfFont';

const inr = (v) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hexToRgb = (hex) => { const h = (hex || '#10b981').replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };

export async function generatePriceListPDF({ groups, company, options = {} }) {
  const doc = new jsPDF();
  const FONT = await loadUnicodeFont(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const m = 14;
  const pRgb = hexToRgb(company?.primary_color);
  const showGst = options.showGst !== false, showCost = !!options.showCost;

  const header = () => {
    doc.setFillColor(...pRgb); doc.rect(0, 0, pageW, 26, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont(FONT, 'bold'); doc.setFontSize(15);
    doc.text(company?.company_name || company?.name || 'Sensoper Controls & Renewables', m, 12);
    doc.setFont(FONT, 'normal'); doc.setFontSize(8);
    doc.text((company?.address || '').replace(/\n/g, ', ').slice(0, 110), m, 18);
    doc.text(`GSTIN: ${company?.gst_number || '—'}${company?.phone ? `  ·  ${company.phone}` : ''}${company?.email ? `  ·  ${company.email}` : ''}`, m, 23);
  };
  header();
  doc.setTextColor(30, 41, 59); doc.setFont(FONT, 'bold'); doc.setFontSize(14);
  doc.text(showCost ? 'PRICE LIST — INTERNAL' : 'PRICE LIST', pageW - m, 34, { align: 'right' });
  doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139);
  doc.text(`Issued: ${new Date().toLocaleDateString('en-IN')}`, pageW - m, 39.5, { align: 'right' });
  if (options.validUntil) doc.text(`Valid until: ${new Date(options.validUntil).toLocaleDateString('en-IN')}`, pageW - m, 44, { align: 'right' });
  doc.text(showGst ? 'GST applied per item at its own rate' : 'All prices exclusive of GST', pageW - m, 48.5, { align: 'right' });
  if (options.preparedFor) { doc.setTextColor(30, 41, 59); doc.setFontSize(10); doc.text(`Prepared for: ${options.preparedFor}`, m, 36); }

  let y = 54;
  const head = ['#', 'Item', 'SKU / HSN', ...(showCost ? ['Cost', 'Margin'] : []), 'Price (ex-GST)', ...(showGst ? ['GST', 'Price incl. GST'] : [])];
  groups.forEach((g) => {
    if (y > 250) { doc.addPage(); header(); y = 34; }
    doc.setFont(FONT, 'bold'); doc.setFontSize(10.5); doc.setTextColor(...pRgb);
    doc.text(`${g.label}  (${g.items.length})`, m, y);
    y += 2;
    autoTable(doc, {
      startY: y, margin: { left: m, right: m }, theme: 'grid',
      styles: { font: FONT, fontSize: 8, cellPadding: 2, textColor: [30, 41, 59] },
      headStyles: { font: FONT, fillColor: pRgb, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: { 0: { cellWidth: 8 }, [head.length - 1]: { fontStyle: 'bold' } },
      head: [head],
      body: g.items.map((it, i) => [
        i + 1, it.name, `${it.sku_code || '—'}${it.hsn_code ? `\nHSN ${it.hsn_code}` : ''}`,
        ...(showCost ? [inr(it.unit_price), it.margin_pct == null ? 'MISSING' : `${it.margin_pct}%`] : []),
        it.selling_price == null ? 'MARGIN MISSING' : inr(it.selling_price),
        ...(showGst ? [it.gst_pct == null ? 'GST MISSING' : `${it.gst_pct}% · ${inr(it.gst_amount)}`, it.price_incl_gst == null ? '—' : inr(it.price_incl_gst)] : []),
      ]),
      didDrawPage: (d) => { if (d.pageNumber > 1 && d.cursor.y < 40) header(); },
    });
    y = doc.lastAutoTable.finalY + 9;
  });

  if (y > 270) { doc.addPage(); header(); y = 40; }
  doc.setFont(FONT, 'italic'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
  doc.text(options.notes || 'Prices are indicative and subject to change without prior notice.', m, y, { maxWidth: pageW - 2 * m });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
    doc.text(`Page ${p} of ${pages}`, pageW - m, 291, { align: 'right' });
    doc.text(company?.company_name || 'Sensoper Controls & Renewables', m, 291);
  }
  doc.save(`PriceList_${options.preparedFor ? options.preparedFor.replace(/\s+/g, '_') + '_' : ''}${new Date().toISOString().slice(0, 10)}.pdf`);
}
