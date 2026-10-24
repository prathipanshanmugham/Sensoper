/**
 * AMC quote PDF (three plans side by side, with what each plan protects) and the AMC report (PDF + Excel),
 * on the letterhead of the company chosen in AMC settings.
 */
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { createBrandDoc, drawFooters, INK, MUTED, LINE, PAPER, inr, fmtDate, paragraph } from './pdfBrand';

const API_URL = process.env.REACT_APP_BACKEND_URL;
const PLAN_FILL = { basic: [241, 245, 249], standard: [236, 253, 245], premium: [237, 233, 254] };
const num = (v) => Math.round(Number(v) || 0).toLocaleString('en-IN');

function imgFormat(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp)/i.exec(dataUrl || '');
  return m ? (m[1].toLowerCase().startsWith('jp') ? 'JPEG' : m[1].toUpperCase()) : 'PNG';
}

function fitLogo(doc, dataUrl, x, y, maxW, maxH) {
  try {
    const p = doc.getImageProperties(dataUrl);
    const k = Math.min(maxW / p.width, maxH / p.height);
    doc.addImage(dataUrl, imgFormat(dataUrl), x, y + (maxH - p.height * k) / 2, p.width * k, p.height * k);
    return p.width * k;
  } catch { return 0; }
}

/** Header: the company logo, its contacts on the right, brand rule. */
function letterhead(doc, ctx, { subtitle }) {
  const { cp, FONT, logo, W, m, p } = ctx;
  doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, 34, 'F');
  let x = m;
  const w1 = logo ? fitLogo(doc, logo, x, 6, 44, 22) : 0;
  if (!w1) { doc.setFont(FONT, 'bold'); doc.setFontSize(13); doc.setTextColor(...INK); doc.text(cp.company_name || 'Sensoper Controls & Renewables', x, 19); x += doc.getTextWidth(cp.company_name || 'Sensoper Controls & Renewables'); } else x += w1;
  doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  const lines = [cp.address ? doc.splitTextToSize(String(cp.address).replace(/\s+/g, ' '), 70)[0] : null, [cp.phone, cp.email].filter(Boolean).join(' · '), cp.website,
       cp.gst_number ? `GSTIN ${cp.gst_number}` : null].filter(Boolean);
  lines.forEach((t, i) => doc.text(t, W - m, 9.5 + i * 4.2, { align: 'right' }));
  doc.setDrawColor(...p); doc.setLineWidth(1.2); doc.line(m, 33, W - m, 33);
  if (subtitle) { doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(subtitle.toUpperCase(), m, 38.5); }
}

const BENEFITS = [
  ['More units every day', 'Clean panels and tight connections keep the plant making what it should — dust alone can cut output by 5–7%.'],
  ['Problems found early', 'Inverter, wiring and earthing checks catch small faults before they stop the plant for days.'],
  ['A longer life', 'Looked-after plants keep running well for their full 25 years; neglected ones often wear out years earlier.'],
  ['Warranty kept safe', 'Service records and timely claims protect the panel and inverter warranties.'],
  ['Safety', 'Earthing, lightning arrestor and cable checks keep the family and the building safe.'],
  ['No running around', 'One call — we plan the visits, send the technician and handle the paperwork.'],
];

/** The letterhead logo. `brand` comes from /api/amc/brand (the company chosen in AMC settings): when a company is
 *  chosen, only its own logo is used (a text header if it has none); otherwise the main company's, else the app logo. */
async function withOurLogo(ctx, brand) {
  if (brand?.chosen) { ctx.logo = brand.logo_base64 || null; return; }
  if (brand?.logo_base64) { ctx.logo = brand.logo_base64; return; }
  if (ctx.logo) return;
  try {
    const r = await fetch(`${process.env.PUBLIC_URL || ''}/logo.png`);
    if (!r.ok) return;
    const b = await r.blob();
    ctx.logo = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); });
  } catch { /* text header instead */ }
}

export async function generateAmcQuotePDF({ quote, companyProfile }) {
  const { doc, ctx } = await createBrandDoc(companyProfile || {}, API_URL);
  await withOurLogo(ctx, companyProfile);
  const { FONT, W, m, contentW, p } = ctx;
  const calc = quote.calc || {};
  const plans = calc.plans || [];
  const rec = quote.recommended_plan || 'standard';
  const sub = 'AMC quotation';
  letterhead(doc, ctx, { subtitle: sub });

  let y = 47;
  doc.setFont(FONT, 'bold'); doc.setFontSize(19); doc.setTextColor(...INK); doc.text('Annual Maintenance Plan', m, y);
  y += 6;
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text(`${quote.quote_number} · ${fmtDate(quote.created_at)} · valid until ${fmtDate(quote.valid_until)}`, m, y);

  // customer + plant
  y += 7;
  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.roundedRect(m, y, contentW, 24, 2, 2, 'FD');
  const age = quote.commissioning_date ? Math.max(0, (Date.now() - new Date(quote.commissioning_date).getTime()) / (365.25 * 864e5)) : null;
  const col = (x, label, value, extra) => {
    doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(label.toUpperCase(), x, y + 6);
    doc.setFont(FONT, 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK); doc.text(doc.splitTextToSize(value || '—', 82)[0], x, y + 12);
    if (extra) { doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(extra, 82).slice(0, 2), x, y + 17); }
  };
  col(m + 4, 'Prepared for', quote.customer_name, [quote.phone, quote.site_address || quote.district].filter(Boolean).join(' · '));
  const sysName = quote.system_type === 'others' ? (quote.system_type_other || 'system') : (quote.system_type || '').replace('-', ' ');
  col(m + contentW / 2 + 2, 'Your solar plant', `${quote.system_capacity_kw} kW ${sysName}`,
    quote.commissioning_date ? `Running since ${fmtDate(quote.commissioning_date)}${age != null ? ` (${age.toFixed(1)} years)` : ''}` : null);
  y += 31;

  // why
  doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(...INK); doc.text('Why your plant needs regular care', m, y);
  doc.setFillColor(...p); doc.rect(m, y + 2, 14, 1.1, 'F');
  y += 8;
  y = paragraph(doc, ctx, y, `Your ${quote.system_capacity_kw} kW plant can make about ${num(calc.annual_generation)} units of power a year. Without care — dust on the panels, loose joints, faults found late — about ${num(calc.units_at_risk)} of those units (${inr(calc.value_at_risk)} at ₹${calc.tariff}/unit) can be lost every year. A maintenance plan protects that power and keeps the plant going for its full life.`, { size: 9 });
  y += 1;
  const tiles = [
    [`${num(calc.annual_generation)} units`, 'your plant can make a year'],
    [inr(calc.value_at_risk), 'of power at risk each year without care'],
    [`+${calc.extra_years} years`, `of life with care (${calc.life_with_years} vs about ${calc.life_without_years}) — about ${num(calc.extra_life_units)} more units, worth ${inr(calc.extra_life_value)}`],
  ];
  const tw = (contentW - 8) / 3;
  tiles.forEach(([v, l], i) => {
    const x = m + i * (tw + 4);
    doc.setDrawColor(...LINE); doc.setFillColor(255, 255, 255); doc.roundedRect(x, y, tw, 21, 2, 2, 'FD');
    doc.setFont(FONT, 'bold'); doc.setFontSize(12.5); doc.setTextColor(...INK); doc.text(v, x + 4, y + 7.5);
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(l, tw - 8).slice(0, 3), x + 4, y + 12);
  });
  y += 27;

  // plans side by side
  doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(...INK); doc.text('Choose your plan', m, y);
  doc.setFillColor(...p); doc.rect(m, y + 2, 14, 1.1, 'F');
  y += 5;
  const head = [['', ...plans.map((pl) => `${pl.name}${pl.key === rec ? ' — recommended' : ''}`)]];
  const row = (label, f) => [label, ...plans.map(f)];
  const body = [
    row('Price per year', (pl) => inr(pl.price)),
    row(`GST (${plans[0]?.gst_pct ?? 18}%)`, (pl) => inr(pl.gst)),
    row('Total per year', (pl) => inr(pl.total)),
    row('About per month', (pl) => inr(pl.per_month)),
    row('Service visits a year', (pl) => `${pl.visits_per_year}`),
    row('Breakdown visit within', (pl) => `${pl.response_hours} hours`),
    row("What's included", (pl) => (pl.includes || []).map((t) => `• ${t}`).join('\n')),
    row('Power protected a year', (pl) => `${num(pl.units_protected)} units\n${inr(pl.value_protected)}`),
    ...(plans.every((pl) => (pl.return_per_rupee || 0) >= 1) ? [row('Back for every ₹1 paid', (pl) => `₹${pl.return_per_rupee.toFixed(2)}`)] : []),
  ];
  autoTable(doc, {
    startY: y, head, body, margin: { left: m, right: m }, theme: 'grid',
    styles: { font: FONT, fontSize: 8.5, cellPadding: 2.2, textColor: INK, lineColor: LINE, lineWidth: 0.2, valign: 'top' },
    headStyles: { fontStyle: 'bold', fontSize: 9.5, textColor: INK, fillColor: [255, 255, 255] },
    columnStyles: { 0: { fontStyle: 'bold', textColor: MUTED, cellWidth: 38 } },
    didParseCell: (d) => {
      const pl = plans[d.column.index - 1];
      if (pl && (d.section === 'head' || d.section === 'body')) d.cell.styles.fillColor = PLAN_FILL[pl.key] || [255, 255, 255];
      if (d.section === 'body' && [2].includes(d.row.index) && d.column.index > 0) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 10; }
    },
  });
  y = doc.lastAutoTable.finalY + 4;
  doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED);
  doc.text(doc.splitTextToSize(`Estimates: ${num(calc.annual_generation / (quote.system_capacity_kw || 1))} units per kW a year, ${calc.units_at_risk && calc.annual_generation ? Math.round(calc.units_at_risk / calc.annual_generation * 100) : 0}% lost without care, ₹${calc.tariff} per unit. Real results depend on weather, shade and use.`, contentW), m, y);
  y += 7;

  // benefits
  if (y > 225) { doc.addPage(); letterhead(doc, ctx, { subtitle: sub }); y = 46; }
  doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(...INK); doc.text('What you get', m, y);
  doc.setFillColor(...p); doc.rect(m, y + 2, 14, 1.1, 'F');
  y += 8;
  const bw = (contentW - 6) / 2;
  BENEFITS.forEach(([t, d], i) => {
    const x = m + (i % 2) * (bw + 6);
    const yy = y + Math.floor(i / 2) * 15;
    doc.setFillColor(...p); doc.circle(x + 1.6, yy - 1.2, 1.1, 'F');
    doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(t, x + 5, yy);
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.8); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(d, bw - 6).slice(0, 2), x + 5, yy + 4);
  });
  y += Math.ceil(BENEFITS.length / 2) * 15 + 2;

  // accept
  if (y > 250) { doc.addPage(); letterhead(doc, ctx, { subtitle: sub }); y = 46; }
  doc.setDrawColor(...LINE); doc.setFillColor(...PAPER); doc.roundedRect(m, y, contentW, 26, 2, 2, 'FD');
  doc.setFont(FONT, 'bold'); doc.setFontSize(10); doc.setTextColor(...INK); doc.text('To start, tick a plan and sign', m + 4, y + 7);
  doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK);
  plans.forEach((pl, i) => { const x = m + 4 + i * 34; doc.rect(x, y + 11, 3.5, 3.5); doc.text(pl.name, x + 5.5, y + 14); });
  doc.line(W - m - 70, y + 20, W - m - 4, y + 20);
  doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text('Customer signature & date', W - m - 70, y + 24);
  y += 32;
  if (quote.notes) { y = paragraph(doc, ctx, y, `Notes: ${quote.notes}`, { size: 8.5 }); y += 2; }

  // terms & conditions (from the quote — edited in the quote builder, default = the active AMC terms template)
  const termLines = String(quote.terms_text || '').split('\n').map((t) => t.trim());
  if (termLines.some(Boolean)) {
    if (y > 245) { doc.addPage(); letterhead(doc, ctx, { subtitle: sub }); y = 46; }
    doc.setFont(FONT, 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK); doc.text('Terms & conditions', m, y);
    doc.setFillColor(...p); doc.rect(m, y + 1.8, 12, 1, 'F');
    y += 6;
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.8); doc.setTextColor(...MUTED);
    termLines.forEach((t) => {
      if (!t) { y += 1.5; return; }
      const lines = doc.splitTextToSize(t, contentW);
      if (y + lines.length * 3.6 > ctx.H - 18) { doc.addPage(); letterhead(doc, ctx, { subtitle: sub }); y = 46; doc.setFont(FONT, 'normal'); doc.setFontSize(7.8); doc.setTextColor(...MUTED); }
      doc.text(lines, m, y); y += lines.length * 3.6 + 0.8;
    });
  }

  const footer = companyProfile?.company_name || 'Sensoper Controls & Renewables';
  drawFooters(doc, ctx, footer, 'Prices in ₹. GST as shown.', quote.quote_number);
  doc.save(`${quote.quote_number}_${(quote.customer_name || 'customer').replace(/[^\w]+/g, '_')}.pdf`);
}

/** Short text for WhatsApp / SMS. */
export function amcQuoteMessage(quote, brandName = 'Sensoper Controls & Renewables') {
  const plans = quote.calc?.plans || [];
  const who = brandName || 'Sensoper Controls & Renewables';
  return [`Dear ${quote.customer_name},`, `Your ${quote.system_capacity_kw} kW solar plant is due for regular maintenance. Our AMC plans (per year, incl. GST):`,
    ...plans.map((p) => `• ${p.name}: ${inr(p.total)} — ${p.visits_per_year} visits, protects about ${inr(p.value_protected)} of power a year`),
    `Quote ${quote.quote_number}, valid until ${fmtDate(quote.valid_until)}. Reply to choose a plan. — ${who}`].join('\n');
}

// ───────────────────────── AMC report ─────────────────────────
const SUMMARY_LABELS = [
  ['active_contracts', 'Active contracts'], ['capacity_kw', 'kW under AMC'], ['yearly_value', 'Yearly value (₹)'], ['new_contracts', 'New contracts'],
  ['renewals', 'Renewals'], ['cancelled', 'Cancelled'], ['visits_done', 'Visits done'], ['visits_scheduled', 'Visits planned'],
  ['visits_overdue', 'Visits overdue'], ['renewals_due_60d', 'Renewals due (60 days)'], ['offers_due', 'Customers to offer AMC'],
  ['quotes_made', 'Quotes made'], ['quotes_accepted', 'Quotes accepted'], ['quote_win_pct', 'Quote win %'],
];
const monthLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

export async function amcReportPDF(rep, { companyProfile }) {
  const { doc, ctx } = await createBrandDoc(companyProfile || {}, API_URL);
  await withOurLogo(ctx, companyProfile);
  const { FONT, m, contentW } = ctx;
  const sub = 'AMC report';
  letterhead(doc, ctx, { subtitle: sub });
  let y = 47;
  doc.setFont(FONT, 'bold'); doc.setFontSize(18); doc.setTextColor(...INK); doc.text('AMC report', m, y);
  y += 6; doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text(`${fmtDate(rep.period.start)} to ${fmtDate(rep.period.end)} · made ${fmtDate(rep.generated_at)}`, m, y);
  y += 6;
  const s = rep.summary;
  const tiles = SUMMARY_LABELS;
  const cw = (contentW - 3 * 3) / 4;
  tiles.forEach(([k, label], i) => {
    const x = m + (i % 4) * (cw + 3); const yy = y + Math.floor(i / 4) * 15;
    doc.setDrawColor(...LINE); doc.setFillColor(...PAPER); doc.roundedRect(x, yy, cw, 13, 1.5, 1.5, 'FD');
    doc.setFont(FONT, 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text(k === 'yearly_value' ? inr(s[k]) : k === 'quote_win_pct' ? `${s[k]}%` : String(s[k] ?? 0), x + 3, yy + 6);
    doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(label, x + 3, yy + 10.5);
  });
  y += Math.ceil(tiles.length / 4) * 15 + 4;
  const table = (title, head, rows) => {
    if (!rows.length) return;
    if (y > 250) { doc.addPage(); letterhead(doc, ctx, { subtitle: sub }); y = 46; }
    doc.setFont(FONT, 'bold'); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(title, m, y); y += 2;
    autoTable(doc, { startY: y, head: [head], body: rows, margin: { left: m, right: m, top: 44 }, theme: 'striped',
      styles: { font: FONT, fontSize: 7.8, cellPadding: 1.6, textColor: INK }, headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
      didDrawPage: () => letterhead(doc, ctx, { subtitle: sub }) });
    y = doc.lastAutoTable.finalY + 8;
  };
  table('Month by month', ['Month', 'New', 'Renewed', 'New value', 'Visits done', 'Quotes'],
    rep.monthly.map((r) => [monthLabel(r.month), r.new_contracts, r.renewals, inr(r.new_value), r.visits_done, r.quotes]));
  table('Renewals due in 60 days', ['Contract', 'Customer', 'Ends', 'Yearly value'],
    rep.renewals_due.map((r) => [r.contract_number, r.customer, r.end_date, inr(r.yearly_value)]));
  table('Customers to offer AMC', ['Customer', 'kW', 'Running since', 'Due', 'Quote'], rep.offers_due.map((r) => [r.customer, r.kw, r.commissioned_on, r.due_on, r.quote || '—']));
  table('Contracts', ['Contract', 'Customer', 'kW', 'Plan', 'Start', 'End', 'Status', 'Yearly value'],
    rep.contracts.map((r) => [r.contract_number, r.customer, r.kw, r.plan || '—', r.start_date, r.end_date, r.status, inr(r.yearly_value)]));
  table('Service visits', ['Date', 'Contract', 'Customer', 'Type', 'Technician', 'Status'], rep.visits.map((v) => [v.date, v.contract_number, v.customer, v.type, v.technician || '—', v.status]));
  table('Quotes', ['Quote', 'Customer', 'kW', 'Status', 'Plan', 'Date'], rep.quotes.map((q) => [q.number, q.customer, q.kw, q.status, q.plan || '—', q.date]));
  drawFooters(doc, ctx, companyProfile?.company_name || 'Sensoper Controls & Renewables', null, 'AMC report');
  doc.save(`AMC_report_${rep.period.start}_${rep.period.end}.pdf`);
}

export function amcReportExcel(rep) {
  const wb = XLSX.utils.book_new();
  const info = [['AMC report'], [`${rep.period.start} to ${rep.period.end}`], [], ['Measure', 'Value'],
    ...SUMMARY_LABELS.map(([k, l]) => [l, rep.summary[k]])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Summary');
  const add = (name, rows) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name); };
  add('Monthly', rep.monthly.map((r) => ({ ...r, month: monthLabel(r.month) })));
  add('Contracts', rep.contracts);
  add('Visits', rep.visits);
  add('Renewals due', rep.renewals_due);
  add('Offer AMC to', rep.offers_due);
  add('Quotes', rep.quotes);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `AMC_report_${rep.period.start}_${rep.period.end}.xlsx`);
}
