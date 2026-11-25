/**
 * Material quotation PDF — itemised: every line with its HSN, quantity, rate, discount, taxable value and GST,
 * then the tax summary (CGST + SGST or IGST), the amount in words, payment details, terms and the signatory.
 *
 * Renders what the server worked out (never recomputes tax). Cost and margin are never passed in.
 * Returns { blob, filename } so the page can download it or share it to WhatsApp.
 */
import autoTable from 'jspdf-autotable';
import { createBrandDoc, drawHeader, drawFooters, ensureSpace, INK, MUTED, LINE, PAPER } from './pdfBrand';

const money = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (q) => (Number(q) % 1 === 0 ? String(Number(q)) : Number(q).toFixed(2).replace(/0+$/, ''));
const dateText = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
  'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigits(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`; }
function threeDigits(n) { const h = Math.floor(n / 100); const r = n % 100; return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' '); }
/** Indian numbering in words: "Rupees One Lakh Twenty Thousand Five Hundred and Fifty Paise Only". */
export function amountInWords(amount) {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100);
  let rupees = Math.floor(v / 100);
  const paise = v % 100;
  const parts = [];
  const crore = Math.floor(rupees / 1e7); rupees %= 1e7;
  const lakh = Math.floor(rupees / 1e5); rupees %= 1e5;
  const thousand = Math.floor(rupees / 1e3); rupees %= 1e3;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rupees) parts.push(threeDigits(rupees));
  const words = parts.join(' ') || 'Zero';
  return `${Number(amount) < 0 ? 'Minus ' : ''}Rupees ${words}${paise ? ` and ${twoDigits(paise)} Paise` : ''} Only`;
}

export async function materialQuotePDF(quote, companyProfile, { save = true } = {}) {
  const cp = companyProfile || {};
  const { doc, ctx } = await createBrandDoc(cp, process.env.REACT_APP_BACKEND_URL);
  const { FONT, m, contentW, W, p } = ctx;
  const SUB = 'Material quotation';
  const number = quote.display_number || quote.number;
  drawHeader(doc, ctx, SUB);

  // ── title + meta ──
  let y = 46;
  doc.setFont(FONT, 'bold'); doc.setFontSize(18); doc.setTextColor(...INK); doc.text('QUOTATION', m, y + 4);
  doc.setFillColor(...p); doc.rect(m, y + 7, 16, 1.2, 'F');
  const meta = [['Quotation no.', number], ['Date', dateText(quote.quote_date || quote.created_at)], ['Valid till', dateText(quote.valid_until)]];
  if (quote.created_by_name) meta.push(['Prepared by', quote.created_by_name]);
  autoTable(doc, { startY: y - 4, margin: { left: W / 2 + 10, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 8.5, cellPadding: 1.2, textColor: INK },
    columnStyles: { 0: { textColor: MUTED, cellWidth: 30 }, 1: { fontStyle: 'bold', halign: 'right' } }, body: meta });
  y = Math.max(doc.lastAutoTable.finalY, y + 12) + 6;

  // ── parties ──
  const party = (title, lines, x) => {
    doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(title, x, y);
    let yy = y + 5;
    lines.filter(Boolean).forEach((l, i) => {
      doc.setFont(FONT, i === 0 ? 'bold' : 'normal'); doc.setFontSize(i === 0 ? 10 : 8.5); doc.setTextColor(...INK);
      const ls = doc.splitTextToSize(String(l), contentW / 2 - 8); doc.text(ls, x, yy); yy += ls.length * 4.3;
    });
    return yy;
  };
  const c = quote.customer || {};
  const yl = party('FROM', [cp.company_name || 'Sensoper Controls & Renewables', (cp.address || '').replace(/\n/g, ', '), cp.gst_number ? `GSTIN ${cp.gst_number}` : null,
    [cp.phone, cp.email].filter(Boolean).join(' · ')], m);
  const yr = party('QUOTATION FOR', [c.name, c.company, c.address, c.state ? `State: ${c.state}` : null, c.gstin ? `GSTIN ${c.gstin}` : null,
    [c.phone ? `+91 ${c.phone}` : null, c.email].filter(Boolean).join(' · ')], W / 2 + 4);
  y = Math.max(yl, yr) + 4;
  if (quote.subject) {
    doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK);
    const ls = doc.splitTextToSize(`Subject: ${quote.subject}`, contentW); doc.text(ls, m, y + 2); y += ls.length * 4.5 + 2;
  }
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(m, y, W - m, y); y += 5;

  // ── items ──
  const lines = quote.lines || [];
  const anyDisc = lines.some((l) => Number(l.discount_amount) > 0);
  const igst = Number(quote.igst) > 0;
  const head = [['#', 'Item', 'HSN', 'Qty', 'Rate', ...(anyDisc ? ['Discount'] : []), 'Taxable value', 'GST', 'Amount']];
  const body = lines.map((l, i) => {
    const taxable = Number(l.quantity) * Number(l.unit_price) - Number(l.discount_amount || 0) - Number(l.bill_discount || 0);
    const desc = [l.name, l.description, l.sku_code ? `SKU ${l.sku_code}` : null].filter(Boolean).join('\n');
    return [i + 1, desc, l.hsn_code || '—', `${qtyText(l.quantity)} ${l.unit || 'Nos'}`, money(l.unit_price), ...(anyDisc ? [Number(l.discount_amount) > 0 ? money(l.discount_amount) : '—'] : []),
      money(taxable), `${Number(l.gst_percentage ?? 18)}%`, money(l.line_total)];
  });
  const cs = anyDisc
    ? { 0: { cellWidth: 7, halign: 'center' }, 1: { cellWidth: 50 }, 2: { cellWidth: 16, halign: 'center' }, 3: { cellWidth: 15, halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { cellWidth: 11, halign: 'center' }, 8: { halign: 'right', fontStyle: 'bold' } }
    : { 0: { cellWidth: 7, halign: 'center' }, 1: { cellWidth: 62 }, 2: { cellWidth: 17, halign: 'center' }, 3: { cellWidth: 16, halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { cellWidth: 12, halign: 'center' }, 7: { halign: 'right', fontStyle: 'bold' } };
  autoTable(doc, {
    startY: y, margin: { left: m, right: m, top: 44 }, theme: 'grid', head, body, columnStyles: cs,
    styles: { font: FONT, fontSize: 8, cellPadding: 2.2, textColor: INK, lineColor: LINE, lineWidth: 0.3, valign: 'middle' },
    headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.8 },
    alternateRowStyles: { fillColor: PAPER },
    didDrawPage: () => drawHeader(doc, ctx, SUB),
  });
  y = doc.lastAutoTable.finalY + 5;
  if (Number(quote.header_discount) > 0) {
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);   // (the italic face has no ₹)
    doc.text(`Includes a discount of ${money(quote.header_discount)} on the whole order, shared across the items; GST is on the discounted value.`, m, y); y += 5;
  }

  // ── totals ──
  y = ensureSpace(doc, ctx, y, 52, SUB);
  const rows = [['Items total', money(quote.subtotal)]];
  if (Number(quote.total_discount) > 0) rows.push(['Discount', `− ${money(quote.total_discount)}`]);
  rows.push(['Taxable value', money(quote.taxable_value)]);
  if (igst) rows.push(['IGST', money(quote.igst)]); else rows.push(['CGST', money(quote.cgst)], ['SGST', money(quote.sgst)]);
  if (Number(quote.round_off)) rows.push(['Round off', `${Number(quote.round_off) > 0 ? '+ ' : '− '}${money(Math.abs(quote.round_off))}`]);
  rows.push([{ content: 'TOTAL', styles: { fontStyle: 'bold', fillColor: INK, textColor: [255, 255, 255], fontSize: 10 } },
    { content: money(quote.grand_total), styles: { fontStyle: 'bold', fillColor: INK, textColor: [255, 255, 255], fontSize: 10, halign: 'right' } }]);
  autoTable(doc, { startY: y, margin: { left: W / 2 + 4, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9, cellPadding: 1.7, textColor: INK },
    columnStyles: { 1: { cellWidth: 42, halign: 'right', fontStyle: 'bold' } }, body: rows });
  const totalsEnd = doc.lastAutoTable.finalY;

  // left of the totals: amount in words + GST by rate
  doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text('AMOUNT IN WORDS', m, y + 2);
  doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK);
  const words = doc.splitTextToSize(amountInWords(quote.grand_total), W / 2 - m - 6); doc.text(words, m, y + 7);
  let yLeft = y + 7 + words.length * 4 + 4;
  const byRate = new Map();
  lines.forEach((l) => {
    const r = Number(l.gst_percentage ?? 18);
    const taxable = Number(l.quantity) * Number(l.unit_price) - Number(l.discount_amount || 0) - Number(l.bill_discount || 0);
    const g = byRate.get(r) || { taxable: 0, tax: 0 }; g.taxable += taxable; g.tax += Number(l.gst_amount || 0); byRate.set(r, g);
  });
  if (byRate.size > 1) {
    autoTable(doc, { startY: yLeft, margin: { left: m, right: W / 2 + 6 }, theme: 'grid',
      head: [['GST rate', 'Taxable value', igst ? 'IGST' : 'CGST + SGST']],
      body: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([r, g]) => [`${r}%`, money(g.taxable), money(g.tax)]),
      styles: { font: FONT, fontSize: 7.5, cellPadding: 1.6, textColor: INK, lineColor: LINE, lineWidth: 0.2 },
      headStyles: { fillColor: PAPER, textColor: MUTED, fontStyle: 'bold' }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
    yLeft = doc.lastAutoTable.finalY + 2;
  }
  y = Math.max(totalsEnd, yLeft) + 6;

  // ── notes ──
  if (quote.notes) {
    y = ensureSpace(doc, ctx, y, 20, SUB);
    doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text('Notes', m, y); y += 4.5;
    doc.setFont(FONT, 'normal'); doc.setFontSize(8.5);
    const ls = doc.splitTextToSize(quote.notes, contentW); y = ensureSpace(doc, ctx, y, ls.length * 4, SUB); doc.text(ls, m, y); y += ls.length * 4 + 5;
  }

  // ── payment details ──
  const b = cp.bank_details || {};
  const bank = [['Account name', b.account_name], ['Account no.', b.account_number], ['IFSC', b.ifsc_code], ['Bank', [b.bank_name, b.branch].filter(Boolean).join(', ')], ['UPI', b.upi_id]].filter(([, v]) => v);
  if (bank.length) {
    y = ensureSpace(doc, ctx, y, 12 + bank.length * 5, SUB);
    doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text('Payment details', m, y); y += 2;
    autoTable(doc, { startY: y, margin: { left: m, right: W / 2 + 6 }, theme: 'plain',
      columnStyles: { 0: { textColor: MUTED, cellWidth: 26 } }, body: bank, styles: { font: FONT, fontSize: 8, cellPadding: 0.7, textColor: INK } });
    y = doc.lastAutoTable.finalY + 5;
  }

  // ── terms ──
  const terms = (quote.terms || []).filter(Boolean);
  if (terms.length) {
    y = ensureSpace(doc, ctx, y, 24, SUB);
    doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text('Terms & conditions', m, y); y += 2;
    autoTable(doc, { startY: y, margin: { left: m, right: m, top: 44 }, theme: 'plain', styles: { font: FONT, fontSize: 7.6, cellPadding: { top: 0.9, bottom: 0.9, left: 0, right: 1 }, textColor: [60, 70, 85] },
      body: terms.map((t, i) => [`${i + 1}. ${t}`]), didDrawPage: () => drawHeader(doc, ctx, SUB) });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── signatory ──
  y = ensureSpace(doc, ctx, y, 30, SUB);
  doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(`For ${cp.company_name || 'Sensoper Controls & Renewables'}`, W - m, y, { align: 'right' }); y += 16;
  doc.setDrawColor(...INK); doc.setLineWidth(0.4); doc.line(W - m - 60, y, W - m, y); y += 4.5;
  doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.text(cp.authorized_signatory || 'Authorised signatory', W - m, y, { align: 'right' });
  if (cp.designation) doc.text(cp.designation, W - m, y + 4.5, { align: 'right' });

  drawFooters(doc, ctx, cp.company_name || 'Sensoper Controls & Renewables', `Valid till ${dateText(quote.valid_until)}`, number);
  const filename = `Quotation_${String(number).replace(/[^\w-]+/g, '-')}_${String(c.name || '').replace(/[^\w]+/g, '-').slice(0, 30)}.pdf`;
  const blob = doc.output('blob');
  if (save) doc.save(filename);
  return { blob, filename };
}
