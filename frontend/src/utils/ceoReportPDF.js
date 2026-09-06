import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadUnicodeFont } from './pdfFont';

// Strict one-page A4 CEO Report — mirrors every block on the CEO Dashboard screen.
const M = 10;               // page margin (mm)
const W = 210 - M * 2;      // usable width
const INK = [15, 23, 42], MUTED = [100, 116, 139], LINE = [226, 232, 240], BRAND = [16, 185, 129];

const rs = (v) => `Rs ${Math.round(v || 0).toLocaleString('en-IN')}`;
const num = (v) => (v ?? 0).toLocaleString('en-IN');

function tileRow(doc, FONT, y, tiles, { h = 13, cols = tiles.length, accent = BRAND } = {}) {
  const gap = 2, w = (W - gap * (cols - 1)) / cols;
  tiles.forEach((t, i) => {
    const x = M + i * (w + gap);
    doc.setFillColor(248, 250, 252); doc.setDrawColor(...LINE);
    doc.roundedRect(x, y, w, h, 1.2, 1.2, 'FD');
    doc.setFillColor(...(t.accent || accent)); doc.rect(x, y, 1, h, 'F');
    doc.setFont(FONT, 'normal'); doc.setFontSize(6); doc.setTextColor(...MUTED);
    doc.text(t.label.toUpperCase(), x + 3, y + 4);
    doc.setFont(FONT, 'bold'); doc.setFontSize(t.small ? 8 : 9.5); doc.setTextColor(...INK);
    doc.text(String(t.value), x + 3, y + 8.6);
    if (t.sub) { doc.setFont(FONT, 'normal'); doc.setFontSize(5.5); doc.setTextColor(...MUTED); doc.text(String(t.sub).slice(0, 48), x + 3, y + 11.6); }
  });
  return y + h + 2.5;
}

function sectionTitle(doc, FONT, x, y, text) {
  doc.setFont(FONT, 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK);
  doc.text(text, x, y);
  return y + 1.5;
}

function miniTable(doc, FONT, { x, y, width, head, body, fill }) {
  autoTable(doc, {
    startY: y, margin: { left: x, right: 210 - x - width }, tableWidth: width,
    head: [head], body, theme: 'grid',
    styles: { font: FONT, fontSize: 6.3, cellPadding: 0.9, lineColor: LINE, lineWidth: 0.15, textColor: INK },
    headStyles: { font: FONT, fontStyle: 'bold', fillColor: fill, textColor: 255, fontSize: 6.3 },
    alternateRowStyles: { fillColor: [250, 250, 252] },
  });
  return doc.lastAutoTable.finalY + 3;
}

export async function generateCeoReportPDF({ data, support, sparkline = [], locationLabel = 'All Locations', companyName = 'Sensoper Controls & Renewables' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const FONT = await loadUnicodeFont(doc);
  const { kpis = {}, status_distribution = [], sales_funnel = {}, top_staff = [], accounts_summary = {}, readings_summary = {}, health_score, credit_data, ecommerce, direct_sales } = data;

  // Header band
  doc.setFillColor(...INK); doc.rect(0, 0, 210, 17, 'F');
  doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
  doc.text('CEO Report', M, 8);
  doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(203, 213, 225);
  doc.text(companyName, M, 13);
  const meta = `${locationLabel}  ·  Generated ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`;
  doc.text(meta, 210 - M, 13, { align: 'right' });
  doc.setFillColor(...BRAND); doc.rect(0, 17, 210, 0.8, 'F');
  let y = 23;

  // Health score strip
  if (health_score) {
    const pillars = Object.entries(health_score.pillars || {});
    const tiles = [{ label: 'Company Health', value: `${Math.round(health_score.score ?? 0)} / 100`, sub: `${(health_score.band || '').toUpperCase()}${sparkline.length ? ` · trend ${sparkline.map(s => Math.round(s.score)).join(' / ')}` : ''}`, accent: [139, 92, 246] }];
    pillars.slice(0, 5).forEach(([k, p]) => tiles.push({ label: k.replace(/_/g, ' '), value: `${Math.round(p.score ?? 0)}`, sub: `weight ${p.weight ?? '—'}%`, small: true, accent: [139, 92, 246] }));
    y = tileRow(doc, FONT, y, tiles, { h: 12 });
  }

  // KPI grid (same 8 cards as on screen)
  y = tileRow(doc, FONT, y, [
    { label: 'Total Revenue', value: rs(kpis.total_revenue), sub: 'Approved + Completed' },
    { label: 'Total Profit', value: rs(kpis.total_profit), sub: 'Internal margins', accent: [59, 130, 246] },
    { label: 'Conversion Rate', value: `${kpis.conversion_rate ?? 0}%`, sub: `${kpis.wins || 0} won of ${kpis.total_projects || 0} leads`, accent: [139, 92, 246] },
    { label: 'Active Projects', value: num(kpis.active_projects), accent: [245, 158, 11] },
  ]);
  y = tileRow(doc, FONT, y, [
    { label: 'Completed', value: num(kpis.completed_projects) },
    { label: 'Pending Approvals', value: num(kpis.pending_approvals), accent: [239, 68, 68] },
    { label: 'Inventory Value', value: rs(kpis.inventory_value), accent: [100, 116, 139] },
    { label: 'Low Stock Alerts', value: num(kpis.low_stock_alerts), accent: [245, 158, 11] },
  ]);

  // Revenue by channel — kept separate, never blended
  y = tileRow(doc, FONT, y, [
    { label: 'Project Revenue', value: rs(data.project_revenue) },
    { label: 'Counter Sale Revenue', value: rs(direct_sales?.revenue), sub: `${direct_sales?.count || 0} sales · margin ${rs(direct_sales?.margin)}`, accent: [59, 130, 246] },
    { label: 'Ecommerce Revenue', value: rs(ecommerce?.revenue), sub: `${ecommerce?.count || 0} orders · commission ${rs(ecommerce?.commission)} · net ${rs(ecommerce?.net_revenue)}` },
  ]);

  // Accounts snapshot
  const cash = accounts_summary?.cash_on_hand, bal = accounts_summary?.account_balance;
  y = tileRow(doc, FONT, y, [
    { label: 'Cash on Hand', value: rs(cash?.amount), sub: cash?.entry_date ? `As of ${cash.entry_date}` : 'No entries yet' },
    { label: 'Op Exp (MTD)', value: rs(accounts_summary?.operational_expense_mtd), sub: 'Operational outflow this month', accent: [245, 158, 11] },
    { label: 'GST Input (MTD)', value: rs(accounts_summary?.gst_input_mtd), sub: 'Input tax credits this month', accent: [14, 165, 233] },
    { label: 'Account Balance', value: rs(bal?.amount), sub: bal?.entry_date ? `As of ${bal.entry_date}` : 'No entries yet', accent: [139, 92, 246] },
  ]);

  // Support snapshot + readings
  y = tileRow(doc, FONT, y, [
    { label: 'Open Tickets', value: num(support?.open_tickets), accent: [100, 116, 139] },
    { label: 'Overdue (SLA breach)', value: num(support?.overdue_by_sla), accent: support?.overdue_by_sla ? [239, 68, 68] : [100, 116, 139] },
    { label: 'Avg Resolution', value: support ? `${support.avg_resolution_hours ?? 0}h` : '—', accent: [100, 116, 139] },
    { label: 'Avg CSAT', value: support?.avg_csat ? `${support.avg_csat} / 5` : '—' },
    { label: 'Readings', value: num(readings_summary?.active), sub: `Active · ${readings_summary?.completed || 0} completed · ${readings_summary?.overdue || 0} overdue`, accent: [59, 130, 246] },
  ], { h: 12 });

  // Two-column tables
  const colW = (W - 4) / 2, xL = M, xR = M + colW + 4;
  let yL = sectionTitle(doc, FONT, xL, y + 2, 'Project Status');
  const totalStatus = status_distribution.reduce((s, i) => s + i.value, 0) || 1;
  yL = miniTable(doc, FONT, { x: xL, y: yL, width: colW, head: ['Status', 'Count', 'Share'], fill: [59, 130, 246],
    body: status_distribution.length ? status_distribution.map(s => [s.name.replace(/_/g, ' '), num(s.value), `${((s.value / totalStatus) * 100).toFixed(0)}%`]) : [['No projects yet', '', '']] });
  yL = sectionTitle(doc, FONT, xL, yL + 1, 'Sales Funnel');
  yL = miniTable(doc, FONT, { x: xL, y: yL, width: colW, head: ['Stage', 'Count'], fill: [59, 130, 246],
    body: [['Leads', num(sales_funnel.total_leads)], ['Quotes', num(sales_funnel.quotes_generated)], ['Approved', num(sales_funnel.approved)], ['Completed', num(sales_funnel.completed)]] });
  yL = sectionTitle(doc, FONT, xL, yL + 1, 'Revenue Trend');
  yL = miniTable(doc, FONT, { x: xL, y: yL, width: colW, head: ['Month', 'Revenue'], fill: BRAND,
    body: (data.revenue_trend || []).slice(-6).map(r => [r.month, rs(r.revenue)]).concat((data.revenue_trend || []).length ? [] : [['No revenue data yet', '']]) });

  let yR = sectionTitle(doc, FONT, xR, y + 2, 'Top Performing Staff');
  yR = miniTable(doc, FONT, { x: xR, y: yR, width: colW, head: ['#', 'Staff', 'Projects', 'Revenue'], fill: [245, 158, 11],
    body: top_staff.length ? top_staff.slice(0, 5).map((s, i) => [i + 1, s.name, num(s.count), rs(s.revenue)]) : [['', 'No staff data', '', '']] });
  if (credit_data) {
    const ag = credit_data.aging || {};
    yR = sectionTitle(doc, FONT, xR, yR + 1, 'Customer Credit — Aging');
    yR = miniTable(doc, FONT, { x: xR, y: yR, width: colW, head: ['Bucket', 'Outstanding'], fill: [239, 68, 68],
      body: [['0–30 days', rs(ag['0_30'])], ['30–60 days', rs(ag['30_60'])], ['60+ days', rs(ag['60_plus'])], ['Total outstanding', rs(kpis.total_outstanding)], ['Overdue amount', rs(kpis.overdue_amount)]] });
    yR = sectionTitle(doc, FONT, xR, yR + 1, 'Top 5 Outstanding');
    yR = miniTable(doc, FONT, { x: xR, y: yR, width: colW, head: ['Customer', 'Balance', 'Status'], fill: [239, 68, 68],
      body: credit_data.top_debtors?.length ? credit_data.top_debtors.slice(0, 5).map(d => [d.name, rs(d.balance), d.status || '']) : [['No outstanding credits', '', '']] });
  }
  if (support?.top_recurring?.length) {
    yR = sectionTitle(doc, FONT, xR, yR + 1, 'Top Recurring Support Categories');
    yR = miniTable(doc, FONT, { x: xR, y: yR, width: colW, head: ['Category', 'Tickets'], fill: [100, 116, 139],
      body: support.top_recurring.slice(0, 4).map(([c, n]) => [String(c).replace(/_/g, ' '), num(n)]) });
  }

  // Footer — hard one-page guarantee: drop any overflow pages autoTable may have added
  while (doc.getNumberOfPages() > 1) doc.deletePage(doc.getNumberOfPages());
  doc.setPage(1);
  doc.setDrawColor(...LINE); doc.line(M, 289, 210 - M, 289);
  doc.setFont(FONT, 'normal'); doc.setFontSize(6); doc.setTextColor(...MUTED);
  doc.text('Figures use the same aggregation as the CEO Dashboard / Performance Master Report. Revenue channels are reported separately and never blended.', M, 292.5);
  doc.text('Page 1 of 1', 210 - M, 292.5, { align: 'right' });
  doc.save(`CEO_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}
