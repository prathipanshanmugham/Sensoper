/**
 * Site diary PDF — the installation record for one project: a summary of the whole job,
 * then one section per day with crew, stages, progress, materials, safety and photos.
 */
import autoTable from 'jspdf-autotable';
import { createBrandDoc, drawHeader, drawFooters, ensureSpace, INK, MUTED, LINE, PAPER } from './pdfBrand';

const API_URL = process.env.REACT_APP_BACKEND_URL;
const SUB = 'Site diary';
const niceDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

async function photoData(path) {
  try {
    const r = await fetch(`${API_URL}/api/files/${path}`, { credentials: 'include' });
    if (!r.ok) return null;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return { data: c.toDataURL('image/jpeg', 0.78), w: c.width, h: c.height };
  } catch { return null; }
}

const tableBase = (ctx) => ({
  theme: 'grid', margin: { left: ctx.m, right: ctx.m },
  styles: { font: ctx.FONT, fontSize: 8.5, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0.2, valign: 'top' },
  headStyles: { fillColor: PAPER, textColor: MUTED, fontStyle: 'bold', fontSize: 7.5 },
});

function para(doc, ctx, y, title, body) {
  if (!body || !String(body).trim()) return y;
  const { FONT, m, contentW } = ctx;
  const lines = doc.splitTextToSize(String(body).trim(), contentW);
  y = ensureSpace(doc, ctx, y, 8 + lines.length * 4.4, SUB);
  doc.setFont(FONT, 'bold'); doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(title.toUpperCase(), m, y);
  doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK); doc.text(lines, m, y + 4.6);
  return y + 6 + lines.length * 4.4 + 1.5;
}

export async function generateSiteDiaryPDF({ project, diaries, companyProfile, filename, stages = [] }) {
  const { doc, ctx } = await createBrandDoc(companyProfile, API_URL);
  const { FONT, m, W, contentW, p } = ctx;
  const days = [...diaries].sort((a, b) => a.date.localeCompare(b.date));
  drawHeader(doc, ctx, SUB);
  let y = 46;
  doc.setFont(FONT, 'bold'); doc.setFontSize(17); doc.setTextColor(...INK);
  doc.text(`Site diary — ${project.customer}`, m, y); y += 6;
  doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
  const meta = [project.reference_number, project.system_size_kw ? `${project.system_size_kw} kW ${project.system_type || ''}`.trim() : null, project.district, project.phone].filter(Boolean).join(' · ');
  if (meta) { doc.text(meta, m, y); y += 5; }
  if (project.address) { doc.text(doc.splitTextToSize(project.address, contentW), m, y); y += 5; }

  // whole-job summary
  const last = days[days.length - 1];
  const crewDays = days.reduce((s, d) => s + (d.crew_total || 0), 0);
  const done = new Set(days.flatMap((d) => d.stages_done || []));
  const kpis = [['Days logged', String(days.length)], ['From', days[0] ? niceDate(days[0].date) : '—'], ['To', last ? niceDate(last.date) : '—'],
    ['Crew-days', String(crewDays)], ['Progress', last?.progress_pct != null ? `${last.progress_pct}%` : '—']];
  y += 2; doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.roundedRect(m, y, contentW, 16, 1.5, 1.5, 'FD');
  const cw = contentW / kpis.length;
  kpis.forEach(([k, v], i) => {
    doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(k.toUpperCase(), m + 4 + i * cw, y + 5.5);
    doc.setFont(FONT, 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK); doc.text(v, m + 4 + i * cw, y + 12);
  });
  y += 22;
  if (stages.length) {
    doc.setFont(FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text('Installation stages', m, y); y += 3;
    const firstDay = (s) => days.find((d) => (d.stages_done || []).includes(s))?.date;
    autoTable(doc, { ...tableBase(ctx), startY: y,
      head: [['Stage', 'Status', 'Finished on']],
      body: stages.map((s) => [s, done.has(s) ? 'Done' : 'Pending', firstDay(s) ? niceDate(firstDay(s)) : '']),
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 1) d.cell.styles.textColor = d.cell.raw === 'Done' ? [4, 120, 87] : MUTED; },
      columnStyles: { 1: { cellWidth: 24 }, 2: { cellWidth: 40 } } });
    y = doc.lastAutoTable.finalY + 8;
  }
  if (!days.length) {
    doc.setFont(FONT, 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED); doc.text('No diary entries yet for this project.', m, y + 4);
  }

  for (const d of days) {
    y = ensureSpace(doc, ctx, y, 36, SUB);
    doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.roundedRect(m, y, contentW, 13, 1.5, 1.5, 'FD');
    doc.setFillColor(...p); doc.rect(m, y, 1.6, 13, 'F');
    doc.setFont(FONT, 'bold'); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(niceDate(d.date), m + 5, y + 8.3);
    doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    const right = [d.progress_pct != null ? `${d.progress_pct}% complete` : null, d.weather, d.start_time && d.end_time ? `${d.start_time}–${d.end_time}` : null].filter(Boolean).join(' · ');
    doc.text(right, W - m - 4, y + 8.3, { align: 'right' });
    y += 17;
    if ((d.stages_done || []).length) {
      doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text('STAGES FINISHED', m, y);
      doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(d.stages_done.join('  ·  '), contentW); doc.text(lines, m, y + 4.6); y += 6 + lines.length * 4.4 + 1.5;
    }
    y = para(doc, ctx, y, 'Work done', d.work_done);
    if ((d.crew || []).length) {
      y = ensureSpace(doc, ctx, y, 18, SUB);
      autoTable(doc, { ...tableBase(ctx), startY: y, head: [['Crew on site', 'Role', 'People']],
        body: [...d.crew.map((c) => [c.name || '—', c.role || '', c.count]), [{ content: 'Total', colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } }, { content: String(d.crew_total || 0), styles: { fontStyle: 'bold' } }]],
        columnStyles: { 2: { cellWidth: 18, halign: 'right' } } });
      y = doc.lastAutoTable.finalY + 4;
    }
    if ((d.materials_used || []).length) {
      y = ensureSpace(doc, ctx, y, 18, SUB);
      autoTable(doc, { ...tableBase(ctx), startY: y, head: [['Material used', 'Qty', 'Unit']],
        body: d.materials_used.map((mt) => [mt.item, mt.qty, mt.unit]), columnStyles: { 1: { cellWidth: 18, halign: 'right' }, 2: { cellWidth: 18 } } });
      y = doc.lastAutoTable.finalY + 4;
    }
    if (d.safety_ok != null || d.safety_notes) y = para(doc, ctx, y, 'Safety', `${d.safety_ok === false ? 'Issue reported' : d.safety_ok ? 'All safe — PPE used' : ''}${d.safety_notes ? `${d.safety_ok != null ? '. ' : ''}${d.safety_notes}` : ''}`);
    y = para(doc, ctx, y, 'Problems', d.issues);
    y = para(doc, ctx, y, 'Customer feedback', d.customer_feedback);
    y = para(doc, ctx, y, 'Next steps', d.next_steps);
    if ((d.photos || []).length) {
      const imgs = (await Promise.all(d.photos.slice(0, 6).map(photoData))).filter(Boolean);
      const per = 3, gap = 3, w = (contentW - gap * (per - 1)) / per, h = w * 0.72;
      for (let i = 0; i < imgs.length; i += per) {
        y = ensureSpace(doc, ctx, y, h + 4, SUB);
        imgs.slice(i, i + per).forEach((im, j) => {
          const fit = Math.min(w / im.w, h / im.h), iw = im.w * fit, ih = im.h * fit;
          const x = m + j * (w + gap);
          doc.setDrawColor(...LINE); doc.rect(x, y, w, h);
          try { doc.addImage(im.data, 'JPEG', x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); } catch { /* skip broken image */ }
        });
        y += h + gap;
      }
    }
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(`Logged by ${(d.authors || []).join(', ') || d.updated_by || '—'}`, m, y + 2);
    y += 9;
  }
  drawFooters(doc, ctx, `${companyProfile?.company_name || 'Sensoper Controls & Renewables'} · ${SUB}`, project.reference_number || '', '');
  doc.save(filename || `Site-diary-${(project.customer || 'project').replace(/\s+/g, '-')}.pdf`);
}
