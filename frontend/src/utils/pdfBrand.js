/**
 * pdfBrand.js — shared brand system for every customer-facing PDF (Detailed Quotation, Kit
 * Quotation, GST Invoice). One place for logo/colour/typography/header/footer plus the sales
 * building blocks (cover page, why-us, 25-year comparison, financing, call-to-action).
 *
 * Print rules: headline text is always near-black (prints crisp in B&W), brand colour is used
 * for fills/rules only, and every chart series is distinguishable by dash pattern + weight,
 * not just hue.
 */
import jsPDF from 'jspdf';
import { loadUnicodeFont } from './pdfFont';

export const INK = [15, 23, 42];        // slate-900
export const MUTED = [100, 116, 139];   // slate-500
export const LINE = [226, 232, 240];    // slate-200
export const PAPER = [248, 250, 252];   // slate-50

export const hexToRgb = (hex, fallback) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return fallback;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
};
export const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;
export const inrCompact = (v) => {
  const n = Math.round(v || 0);
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(n >= 1e6 ? 1 : 2)} L`;
  return inr(n);
};
export const fmtDate = (d = new Date()) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

/** Create the document + brand context. Loads the Unicode font (₹) and the logo once. */
export async function createBrandDoc(cp, apiUrl) {
  const doc = new jsPDF();
  const FONT = await loadUnicodeFont(doc);
  let logo = null;
  try { const r = await fetch(`${apiUrl}/api/company/logo-base64`); logo = (await r.json()).logo_base64 || null; } catch { /* no logo → text fallback */ }
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), m = 15;
  const ctx = { cp: cp || {}, FONT, logo, W, H, m, contentW: W - 2 * m,
    p: hexToRgb(cp?.primary_color, [74, 222, 64]), s: hexToRgb(cp?.secondary_color, [45, 155, 240]) };
  return { doc, ctx };
}

export function drawHeader(doc, ctx, subtitle) {
  const { cp, FONT, logo, W, m, p } = ctx;
  doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, 34, 'F');
  if (logo) { try { doc.addImage(logo, 'PNG', m, 5, 46, 24); } catch { /* fall through to text */ } }
  if (!logo) { doc.setFont(FONT, 'bold'); doc.setFontSize(15); doc.setTextColor(...INK); doc.text(cp.company_name || 'Sensoper Controls & Renewables', m, 18); }
  doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  [cp.phone, cp.email, cp.website, cp.gst_number ? `GSTIN ${cp.gst_number}` : null].filter(Boolean).forEach((t, i) => doc.text(t, W - m, 11 + i * 4.2, { align: 'right' }));
  doc.setDrawColor(...p); doc.setLineWidth(1.2); doc.line(m, 33, W - m, 33);
  if (subtitle) { doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(subtitle.toUpperCase(), m, 38.5); }
}

export function drawFooters(doc, ctx, footerLeft, termsLabel, refNo) {
  const { FONT, W, H, m } = ctx;
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(m, H - 12, W - m, H - 12);
    doc.setFont(FONT, 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
    doc.text(footerLeft, m, H - 7);
    if (termsLabel) doc.text(termsLabel, W / 2, H - 7, { align: 'center' });
    doc.text(`${refNo ? `${refNo} · ` : ''}Page ${i} of ${total}`, W - m, H - 7, { align: 'right' });
  }
}

/** Ensure `needed` mm remain; otherwise start a new branded page. Returns the y to draw at. */
export function ensureSpace(doc, ctx, y, needed, subtitle) {
  if (y + needed <= ctx.H - 18) return y;
  doc.addPage(); drawHeader(doc, ctx, subtitle); return 44;
}

export function sectionTitle(doc, ctx, y, title, kicker) {
  const { FONT, m, p } = ctx;
  if (kicker) { doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(kicker.toUpperCase(), m, y); y += 4.5; }
  doc.setFont(FONT, 'bold'); doc.setFontSize(13); doc.setTextColor(...INK); doc.text(title, m, y);
  doc.setFillColor(...p); doc.rect(m, y + 2, 14, 1.2, 'F');
  return y + 9;
}

export function paragraph(doc, ctx, y, text, { size = 9, color = INK, width } = {}) {
  doc.setFont(ctx.FONT, 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
  const lines = doc.splitTextToSize(text, width || ctx.contentW);
  doc.text(lines, ctx.m, y);
  return y + lines.length * (size * 0.48) + 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sales building blocks
// ─────────────────────────────────────────────────────────────────────────────

/** Landing-page style cover. `boxes` = [{label, value, sub}] × 3 (first box is the hero fill). */
export function drawCoverPage(doc, ctx, { docTitle, refNo, date, validTill, customer, headline, subhead, boxes, strip, preparedBy }) {
  const { cp, FONT, logo, W, H, m, contentW, p, s } = ctx;
  // Brand band
  doc.setFillColor(...INK); doc.rect(0, 0, W, 8, 'F');
  doc.setFillColor(...p); doc.rect(0, 8, W * 0.38, 1.6, 'F'); doc.setFillColor(...s); doc.rect(W * 0.38, 8, W * 0.62, 1.6, 'F');
  if (logo) { try { doc.addImage(logo, 'PNG', m, 18, 60, 30); } catch { /* text fallback below */ } }
  doc.setFont(FONT, 'bold'); doc.setFontSize(logo ? 10 : 18); doc.setTextColor(...INK);
  doc.text(cp.company_name || 'Sensoper Controls & Renewables', logo ? W - m : m, logo ? 26 : 30, { align: logo ? 'right' : 'left' });
  doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
  if (cp.tagline) doc.text(cp.tagline, logo ? W - m : m, logo ? 31 : 36, { align: logo ? 'right' : 'left' });
  doc.text([docTitle, refNo ? `Ref ${refNo}` : null, date].filter(Boolean).join('  ·  '), logo ? W - m : m, logo ? 37 : 42, { align: logo ? 'right' : 'left' });

  // Headline
  let y = 74;
  doc.setFont(FONT, 'bold'); doc.setFontSize(26); doc.setTextColor(...INK);
  const hl = doc.splitTextToSize(headline, contentW);
  doc.text(hl, m, y); y += hl.length * 12 + 4;
  if (subhead) { doc.setFont(FONT, 'normal'); doc.setFontSize(11); doc.setTextColor(...MUTED); const sh = doc.splitTextToSize(subhead, contentW); doc.text(sh, m, y); y += sh.length * 6 + 8; }

  // Three boxes
  const gap = 5, bw = (contentW - gap * 2) / 3, bh = 40;
  boxes.slice(0, 3).forEach((b, i) => {
    const x = m + i * (bw + gap);
    if (i === 0) { doc.setFillColor(...p); doc.roundedRect(x, y, bw, bh, 3, 3, 'F'); }
    else { doc.setDrawColor(...INK); doc.setLineWidth(0.6); doc.roundedRect(x, y, bw, bh, 3, 3, 'S'); }
    doc.setFont(FONT, 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK); doc.text(b.label.toUpperCase(), x + 5, y + 9);
    doc.setFontSize(b.value.length > 12 ? 15 : 19); doc.text(b.value, x + 5, y + 23);
    if (b.sub) { doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...(i === 0 ? INK : MUTED)); doc.text(doc.splitTextToSize(b.sub, bw - 10)[0], x + 5, y + 32); }
  });
  y += bh + 14;

  // Strip of proof points
  if (strip?.length) {
    doc.setFillColor(...PAPER); doc.roundedRect(m, y, contentW, 16, 2, 2, 'F');
    const cw = contentW / strip.length;
    strip.forEach((t, i) => {
      doc.setFont(FONT, 'bold'); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(t.value, m + cw * i + 5, y + 7);
      doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(t.label, m + cw * i + 5, y + 12.5);
    });
    y += 26;
  }

  // Prepared for / prepared by
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(m, y, W - m, y); y += 8;
  doc.setFont(FONT, 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text('PREPARED FOR', m, y); doc.text('PREPARED BY', W / 2 + 5, y); y += 5.5;
  doc.setFont(FONT, 'bold'); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(customer.name || '—', m, y); doc.text(cp.company_name || '', W / 2 + 5, y); y += 5;
  doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  const left = [customer.address, customer.phone ? `Phone ${customer.phone}` : null, customer.email].filter(Boolean);
  const right = [preparedBy, cp.address, cp.phone ? `Call ${cp.sales_contact_phone || cp.phone}` : null, cp.email].filter(Boolean);
  const lw = W / 2 - m - 10;
  let ly = y, ry = y;
  left.forEach(t => { const ls = doc.splitTextToSize(t, lw); doc.text(ls, m, ly); ly += ls.length * 4.2; });
  right.forEach(t => { const ls = doc.splitTextToSize(t, lw); doc.text(ls, W / 2 + 5, ry); ry += ls.length * 4.2; });
  y = Math.max(ly, ry) + 6;
  if (validTill) { doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(...INK); doc.text(`Prices valid till ${validTill}`, m, y); }

  // Bottom brand rule
  doc.setFillColor(...INK); doc.rect(0, H - 6, W, 6, 'F');
}

/** "Why us" — only renders facts that exist. Returns new y (unchanged if nothing to say). */
export function drawWhyUs(doc, ctx, y, { stats, certifications = [], warrantyHeadline }) {
  const { cp, FONT, m, contentW, p } = ctx;
  const facts = [];
  if (stats?.years_in_business > 0) facts.push({ value: `${stats.years_in_business}+ yrs`, label: 'in solar business' });
  if (stats?.installations_completed > 0) facts.push({ value: `${stats.installations_completed}`, label: 'installations completed' });
  if (stats?.kwp_installed > 0) facts.push({ value: stats.kwp_installed >= 1000 ? `${(stats.kwp_installed / 1000).toFixed(1)} MW` : `${stats.kwp_installed} kW`, label: 'capacity installed to date' });
  if (!facts.length && !certifications.length && !warrantyHeadline) return y;
  y = ensureSpace(doc, ctx, y, 60);
  y = sectionTitle(doc, ctx, y, `Why ${cp.company_name || 'us'}`, 'Backed by our record');
  if (facts.length) {
    const cw = contentW / facts.length;
    facts.forEach((f, i) => {
      doc.setFillColor(...p); doc.rect(m + cw * i, y, 1.5, 16, 'F');
      doc.setFont(FONT, 'bold'); doc.setFontSize(16); doc.setTextColor(...INK); doc.text(f.value, m + cw * i + 5, y + 8);
      doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(f.label, m + cw * i + 5, y + 14);
    });
    y += 24;
  }
  if (warrantyHeadline) { doc.setFillColor(...p); doc.circle(m + 1.5, y - 1.2, 1.5, 'F'); doc.setFont(FONT, 'bold'); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(warrantyHeadline, m + 5, y); y += 7; }
  if (certifications.length) {
    doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK);
    let x = m;
    certifications.forEach(c => {
      const w = doc.getTextWidth(c) + 8;
      if (x + w > m + contentW) { x = m; y += 8; }
      doc.setDrawColor(...INK); doc.setLineWidth(0.4); doc.roundedRect(x, y - 4.5, w, 7, 3.5, 3.5, 'S'); doc.text(c, x + 4, y);
      x += w + 3;
    });
    y += 8;
  }
  return y + 4;
}

/** Cumulative cost with vs without solar over the system life. `yearly` = [{year, without_solar, with_solar}]. */
export function drawComparisonChart(doc, ctx, y, yearly, { netCost, lifetimeSavings } = {}) {
  if (!yearly?.length || !(yearly[yearly.length - 1].without_solar > 0)) return y;
  const { FONT, m, contentW, p } = ctx;
  y = ensureSpace(doc, ctx, y, 90);
  y = sectionTitle(doc, ctx, y, 'What 25 years costs — with and without solar', 'The case for acting now');
  const chartH = 58, x0 = m + 22, x1 = m + contentW - 4, y0 = y + chartH, maxV = Math.max(...yearly.map(r => Math.max(r.without_solar, r.with_solar))) * 1.05;
  const px = (i) => x0 + (i / (yearly.length - 1)) * (x1 - x0), py = (v) => y0 - (v / maxV) * chartH;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  for (let g = 0; g <= 4; g++) { const gy = y0 - (g / 4) * chartH; doc.line(x0, gy, x1, gy); doc.setFont(FONT, 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED); doc.text(inrCompact(maxV * g / 4), x0 - 2, gy + 1.5, { align: 'right' }); }
  // Shaded savings gap (light brand tint)
  const setOpacity = (o) => { if (doc.GState && doc.setGState) doc.setGState(new doc.GState({ opacity: o })); };
  doc.setFillColor(p[0], p[1], p[2]); setOpacity(0.18);
  for (let i = 1; i < yearly.length; i++) {
    const a = yearly[i - 1], b = yearly[i];
    if (a.without_solar >= a.with_solar && b.without_solar >= b.with_solar) {
      doc.triangle(px(i - 1), py(a.with_solar), px(i - 1), py(a.without_solar), px(i), py(b.without_solar), 'F');
      doc.triangle(px(i - 1), py(a.with_solar), px(i), py(b.without_solar), px(i), py(b.with_solar), 'F');
    }
  }
  setOpacity(1);
  // Without solar: dashed dark; With solar: solid brand-dark
  doc.setLineWidth(0.9); doc.setDrawColor(...INK); doc.setLineDashPattern([2, 1.5], 0);
  yearly.forEach((r, i) => { if (i) doc.line(px(i - 1), py(yearly[i - 1].without_solar), px(i), py(r.without_solar)); });
  doc.setLineDashPattern([], 0); doc.setLineWidth(1.4); doc.setDrawColor(21, 128, 61);
  yearly.forEach((r, i) => { if (i) doc.line(px(i - 1), py(yearly[i - 1].with_solar), px(i), py(r.with_solar)); });
  // X axis
  doc.setFont(FONT, 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  [1, 5, 10, 15, 20, yearly.length].filter((v, i, a) => v <= yearly.length && a.indexOf(v) === i).forEach(yr => doc.text(`Yr ${yr}`, px(yr - 1), y0 + 4, { align: 'center' }));
  // Legend + end labels
  const last = yearly[yearly.length - 1];
  doc.setFont(FONT, 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK);
  doc.setLineDashPattern([2, 1.5], 0); doc.setLineWidth(0.9); doc.setDrawColor(...INK); doc.line(m, y0 + 11, m + 8, y0 + 11); doc.text(`Without solar: ${inrCompact(last.without_solar)} paid to the grid`, m + 11, y0 + 12.5);
  doc.setLineDashPattern([], 0); doc.setLineWidth(1.4); doc.setDrawColor(21, 128, 61); doc.line(m, y0 + 17, m + 8, y0 + 17); doc.text(`With solar: ${inrCompact(last.with_solar)} including the system${netCost ? ` (${inr(netCost)})` : ''}`, m + 11, y0 + 18.5);
  y = y0 + 26;
  const saved = lifetimeSavings || (last.without_solar - last.with_solar);
  if (saved > 0) { doc.setFillColor(...PAPER); doc.roundedRect(m, y, contentW, 11, 2, 2, 'F'); doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK); doc.text(`Shaded area = ${inrCompact(saved)} kept in your pocket over ${yearly.length} years (0.7%/yr panel ageing included, no tariff increases assumed).`, m + 4, y + 7.2); y += 16; }
  return y + 2;
}

export function drawFinancing(doc, ctx, y, options = []) {
  const opts = (options || []).filter(o => o?.title);
  if (!opts.length) return y;
  const { FONT, m, contentW } = ctx;
  y = ensureSpace(doc, ctx, y, 20 + opts.length * 12);
  y = sectionTitle(doc, ctx, y, 'Ways to pay', 'Financing options');
  opts.forEach(o => {
    doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK); doc.text(`• ${o.title}`, m, y);
    if (o.description) { doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED); const ls = doc.splitTextToSize(o.description, contentW - 6); doc.text(ls, m + 4, y + 4.5); y += ls.length * 4.2; }
    y += 7.5;
  });
  return y + 2;
}

/** One unambiguous next step with large contact details and a sign-off line. */
export function drawCTA(doc, ctx, y, { refNo, signatory, designation, primaryLabel }) {
  const { cp, FONT, m, contentW, p } = ctx;
  y = ensureSpace(doc, ctx, y, 62);
  const phone = cp.sales_contact_phone || cp.phone;
  doc.setFillColor(...INK); doc.roundedRect(m, y, contentW, 46, 3, 3, 'F');
  doc.setFillColor(...p); doc.rect(m, y, 3, 46, 'F');
  doc.setFont(FONT, 'bold'); doc.setFontSize(7.5); doc.setTextColor(...p); doc.text('YOUR NEXT STEP', m + 9, y + 9);
  doc.setFontSize(14); doc.setTextColor(255, 255, 255);
  doc.text(doc.splitTextToSize(primaryLabel || `Call us on ${phone} to confirm your installation date`, contentW - 18), m + 9, y + 18);
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(220, 228, 240);
  doc.text(`or sign below and send this page back to ${cp.email || 'us'}${refNo ? ` quoting ${refNo}` : ''}.`, m + 9, y + 30);
  doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(255, 255, 255); doc.text(phone || '', m + 9, y + 40);
  const phoneW = doc.getTextWidth(phone || '');
  if (cp.email) { doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.text(cp.email, m + 9 + phoneW + 10, y + 40); }
  y += 56;
  const half = contentW / 2 - 6;
  doc.setDrawColor(...INK); doc.setLineWidth(0.4); doc.line(m, y, m + half, y); doc.line(m + half + 12, y, m + contentW, y);
  doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text('Customer acceptance — signature & date', m, y + 4.5);
  doc.text(`For ${cp.company_name || ''} — ${signatory || cp.authorized_signatory || 'Authorised Signatory'}${designation || cp.designation ? `, ${designation || cp.designation}` : ''}`, m + half + 12, y + 4.5);
  return y + 12;
}
