/**
 * Daily report PDF — one or many people/days in a single branded document.
 * A summary table opens the document when it holds more than one report; each report then
 * gets its own section: sites worked on, leads, payments, service visits and the wrap-up.
 */
import autoTable from 'jspdf-autotable';
import { createBrandDoc, drawHeader, drawFooters, ensureSpace, INK, MUTED, LINE, PAPER } from './pdfBrand';

const API_URL = process.env.REACT_APP_BACKEND_URL;
const inr = (v) => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const niceDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const time = (ts) => (ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
const METHOD = { upi: 'UPI', cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', emi: 'EMI' };
const LEADS = [['total_leads', 'New leads'], ['qualified_leads', 'Qualified'], ['site_visits', 'Site visits'], ['quotes_sent', 'Quotes sent'], ['followups', 'Follow-ups'], ['conversions', 'Won']];
const SUB = 'Daily report';

function projName(info, id, fallback) {
  const p = id && info?.[id];
  return p ? `${p.customer}${p.reference_number ? ` (${p.reference_number})` : ''}` : (fallback || '—');
}

function totals(r) {
  const leads = r.leads || {};
  return {
    sites: (r.site_work || []).length,
    leads: Number(leads.total_leads) || 0,
    won: Number(leads.conversions) || 0,
    paid: (r.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    service: (r.service || []).length,
  };
}

function label(doc, ctx, y, text) {
  const { FONT, m } = ctx;
  doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(text, m, y);
  return y + 2;
}

function paragraph(doc, ctx, y, title, body) {
  if (!body || !String(body).trim()) return y;
  const { FONT, m, contentW } = ctx;
  const lines = doc.splitTextToSize(String(body).trim(), contentW);
  y = ensureSpace(doc, ctx, y, 8 + lines.length * 4.4, SUB);
  doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(title.toUpperCase(), m, y);
  doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK); doc.text(lines, m, y + 4.8);
  return y + 6 + lines.length * 4.4 + 2;
}

const tableBase = (ctx) => ({
  theme: 'grid', margin: { left: ctx.m, right: ctx.m },
  styles: { font: ctx.FONT, fontSize: 8.5, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0.2, valign: 'top' },
  headStyles: { fillColor: PAPER, textColor: MUTED, fontStyle: 'bold', fontSize: 7.5 },
});

function drawReport(doc, ctx, y, r, info) {
  const { FONT, m, W, contentW, p } = ctx;
  const t = totals(r);
  y = ensureSpace(doc, ctx, y, 40, SUB);
  // person + day band
  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.roundedRect(m, y, contentW, 17, 1.5, 1.5, 'FD');
  doc.setFillColor(...p); doc.rect(m, y, 1.6, 17, 'F');
  doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(...INK); doc.text(r.user_name || 'Team member', m + 5, y + 7);
  doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  doc.text(`${niceDate(r.date)} · ${r.role ? r.role.charAt(0).toUpperCase() + r.role.slice(1) : ''}`, m + 5, y + 12.5);
  const status = r.status === 'submitted' ? `Submitted ${time(r.submitted_at)}` : 'Draft — not submitted';
  doc.setFont(FONT, 'bold'); doc.setTextColor(...(r.status === 'submitted' ? [4, 120, 87] : [180, 83, 9]));
  doc.text(status, W - m - 4, y + 7, { align: 'right' });
  if (r.reviewed_at) { doc.setFont(FONT, 'normal'); doc.setTextColor(...MUTED); doc.text(`Reviewed by ${r.reviewed_by}`, W - m - 4, y + 12.5, { align: 'right' }); }
  y += 21;
  // key numbers
  const kpis = [['Sites', String(t.sites)], ['Leads', String(t.leads)], ['Won', String(t.won)], ['Collected', inr(t.paid)], ['Service visits', String(t.service)]];
  if (r.hours_worked) kpis.push(['Hours', String(r.hours_worked)]);
  if (r.km_travelled) kpis.push(['Km', String(r.km_travelled)]);
  const cw = contentW / kpis.length;
  kpis.forEach(([k, v], i) => {
    doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(k.toUpperCase(), m + i * cw, y + 3);
    doc.setFont(FONT, 'bold'); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(v, m + i * cw, y + 9);
  });
  y += 14;

  if ((r.site_work || []).length) {
    y = ensureSpace(doc, ctx, y, 24, SUB); y = label(doc, ctx, y + 2, 'Sites worked on');
    autoTable(doc, { ...tableBase(ctx), startY: y + 1,
      head: [['Project', 'Work done', 'Progress', 'Crew', 'Problems']],
      body: r.site_work.map((w) => [projName(info, w.project_id), w.work_done || '—', w.progress_pct != null ? `${w.progress_pct}%` : '—', w.crew_count ?? '—', w.issues || '']),
      columnStyles: { 0: { cellWidth: 46 }, 2: { cellWidth: 18, halign: 'right' }, 3: { cellWidth: 13, halign: 'right' } } });
    y = doc.lastAutoTable.finalY + 5;
  }
  const leads = r.leads || {};
  if (LEADS.some(([k]) => Number(leads[k]) > 0)) {
    y = ensureSpace(doc, ctx, y, 20, SUB); y = label(doc, ctx, y + 2, 'Leads & sales');
    autoTable(doc, { ...tableBase(ctx), startY: y + 1, head: [LEADS.map(([, l]) => l)], body: [LEADS.map(([k]) => String(Number(leads[k]) || 0))],
      styles: { ...tableBase(ctx).styles, halign: 'center' } });
    y = doc.lastAutoTable.finalY + 5;
  }
  if ((r.payments || []).length) {
    y = ensureSpace(doc, ctx, y, 24, SUB); y = label(doc, ctx, y + 2, 'Payments collected');
    autoTable(doc, { ...tableBase(ctx), startY: y + 1,
      head: [['Customer / project', 'Method', 'Reference', 'Amount']],
      body: [...r.payments.map((pm) => [projName(info, pm.project_id, pm.customer), METHOD[pm.method] || pm.method, pm.reference || '', inr(pm.amount)]),
        [{ content: 'Total', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } }, { content: inr(t.paid), styles: { fontStyle: 'bold' } }]],
      columnStyles: { 3: { halign: 'right', cellWidth: 30 } } });
    y = doc.lastAutoTable.finalY + 5;
  }
  if ((r.service || []).length) {
    y = ensureSpace(doc, ctx, y, 24, SUB); y = label(doc, ctx, y + 2, 'Service visits');
    autoTable(doc, { ...tableBase(ctx), startY: y + 1,
      head: [['Customer / project', 'Problem', 'What was done', 'Fixed?']],
      body: r.service.map((s) => [projName(info, s.project_id, s.customer), s.issue || '—', s.action || '—', s.resolved ? 'Yes' : 'No']),
      columnStyles: { 3: { cellWidth: 16, halign: 'center' } } });
    y = doc.lastAutoTable.finalY + 5;
  }
  y = paragraph(doc, ctx, y, 'What went well', r.highlights);
  y = paragraph(doc, ctx, y, 'Problems / help needed', r.issues);
  y = paragraph(doc, ctx, y, "Tomorrow's plan", r.tomorrow_plan);
  if (r.review_comment) y = paragraph(doc, ctx, y, `Manager note — ${r.reviewed_by || ''}`, r.review_comment);
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(m, y + 1, W - m, y + 1);
  return y + 8;
}

/**
 * @param {object} opts
 * @param {Array} opts.reports      daily_report documents
 * @param {object} opts.projectInfo {projectId: {customer, reference_number}}
 * @param {object} opts.companyProfile
 * @param {string} opts.title       e.g. "Daily report — Fri 9 Oct 2026"
 * @param {string} opts.filename
 * @param {Array}  [opts.missing]   names of people with no report (team PDFs)
 */
export async function generateDailyReportPDF({ reports, projectInfo = {}, companyProfile, title, filename, missing = [] }) {
  const { doc, ctx } = await createBrandDoc(companyProfile, API_URL);
  const { FONT, m } = ctx;
  drawHeader(doc, ctx, SUB);
  let y = 46;
  doc.setFont(FONT, 'bold'); doc.setFontSize(17); doc.setTextColor(...INK); doc.text(title, m, y); y += 8;

  const sorted = [...reports].sort((a, b) => (a.date === b.date ? (a.user_name || '').localeCompare(b.user_name || '') : a.date.localeCompare(b.date)));
  if (sorted.length > 1 || missing.length) {
    const all = sorted.map(totals);
    const sum = (k) => all.reduce((s, x) => s + x[k], 0);
    doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    doc.text(`${sorted.length} report${sorted.length === 1 ? '' : 's'} · ${sum('sites')} site visits · ${sum('leads')} leads · ${inr(sum('paid'))} collected`, m, y); y += 4;
    autoTable(doc, { ...tableBase(ctx), startY: y,
      head: [['Person', 'Date', 'Status', 'Sites', 'Leads', 'Won', 'Collected']],
      body: [
        ...sorted.map((r, i) => [r.user_name, niceDate(r.date), r.status === 'submitted' ? 'Submitted' : 'Draft', all[i].sites, all[i].leads, all[i].won, inr(all[i].paid)]),
        ...missing.map((n) => [n, '', { content: 'Not started', styles: { textColor: [185, 28, 28] } }, '', '', '', '']),
      ],
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } } });
    y = doc.lastAutoTable.finalY + 10;
  }
  if (!sorted.length) {
    doc.setFont(FONT, 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED); doc.text('No reports were submitted for this period.', m, y + 4);
  }
  for (const r of sorted) y = drawReport(doc, ctx, y, r, projectInfo);
  drawFooters(doc, ctx, `${companyProfile?.company_name || 'Sensoper Controls & Renewables'} · ${SUB}`, `Generated ${new Date().toLocaleString('en-IN')}`);
  doc.save(filename || 'daily-report.pdf');
}
