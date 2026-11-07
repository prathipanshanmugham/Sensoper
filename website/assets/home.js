/* Home page: the live sun over Perundurai, the savings calculator and the subsidy countdown. */
import { $, $$, boot, site, openLead, schedulePopups, exitIntent, notify, inr, fmt, store } from './core.js';

boot('site');

const RAD = Math.PI / 180;
const LAT = 11.2755, LON = 77.587;          // Perundurai
const IST_MS = 5.5 * 3600e3;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────── the sun ───────── */
export function sunElevation(ms) {
  const d = ms / 864e5 - 10957.5;                                  // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = ((gmst * 15 + LON - ra) % 360 + 540) % 360 - 180;
  return Math.asin(Math.sin(LAT * RAD) * Math.sin(dec) + Math.cos(LAT * RAD) * Math.cos(dec) * Math.cos(ha * RAD)) / RAD;
}
/** kW from a roof of `kwp` under a clear sky (air-mass model, 80% system efficiency). */
export function clearSkyKw(elev, kwp = 3) {
  if (elev <= 0.5) return 0;
  const z = 90 - elev, cz = Math.cos(z * RAD);
  const am = 1 / (cz + 0.50572 * Math.pow(96.07995 - z, -1.6364));
  const dni = 1.353 * Math.pow(0.7, Math.pow(am, 0.678));
  return Math.max(0, kwp * 1.1 * dni * cz * 0.8);
}
const istMidnight = (ms) => { const t = new Date(ms + IST_MS); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - IST_MS; };
const kwText = (v) => (v > 0 && v < 0.095 ? v.toFixed(2) : v.toFixed(1));
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).replace(' ', ' ');

function dayProfile(nowMs) {
  const m0 = istMidnight(nowMs);
  const pts = [];
  for (let min = 0; min <= 1440; min += 5) pts.push({ t: m0 + min * 60e3, e: sunElevation(m0 + min * 60e3) });
  let rise = null, set = null, max = 0, kwh = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.e < -0.833 && b.e >= -0.833) rise = a.t + (b.t - a.t) * ((-0.833 - a.e) / (b.e - a.e));
    if (a.e >= -0.833 && b.e < -0.833) set = a.t + (b.t - a.t) * ((a.e + 0.833) / (a.e - b.e));
    max = Math.max(max, b.e);
    kwh += clearSkyKw(b.e) * (5 / 60);
  }
  return { m0, pts, rise, set, max, kwh };
}

const SD = { x0: 18, x1: 302, yH: 128, yTop: 26, from: 5, to: 19 };    // 5 am – 7 pm IST across the dial
function sundial() {
  const fig = $('#sundial');
  if (!fig) return;
  const hero = $('#hero');
  const svg = $('.sd-svg', fig);
  let prof = dayProfile(Date.now());
  let scrub = null;                          // a time the visitor dragged the sun to, or null for "now"
  const xOf = (t) => SD.x0 + ((t - prof.m0) / 3600e3 - SD.from) / (SD.to - SD.from) * (SD.x1 - SD.x0);
  const tOf = (x) => prof.m0 + (SD.from + (Math.min(Math.max(x, SD.x0), SD.x1) - SD.x0) / (SD.x1 - SD.x0) * (SD.to - SD.from)) * 3600e3;
  const yOf = (e) => SD.yH - Math.max(e, -12) / Math.max(prof.max, 20) * (SD.yH - SD.yTop);

  function drawCurve() {
    const win = prof.pts.filter((p) => { const h = (p.t - prof.m0) / 3600e3; return h >= SD.from && h <= SD.to; });
    $('.sd-curve', svg).setAttribute('d', 'M' + win.map((p) => `${xOf(p.t).toFixed(1)} ${yOf(p.e).toFixed(1)}`).join('L'));
    const ticks = [[prof.rise, 'rise'], [prof.m0 + 12.25 * 3600e3, 'noon'], [prof.set, 'set']];
    ticks.forEach(([t, k]) => { const el = $(`.sd-t-${k}`, svg); if (el && t) { el.setAttribute('x', xOf(t).toFixed(1)); el.textContent = hhmm(t); } });
    $('#sd-rise').textContent = prof.rise ? hhmm(prof.rise) : '—';
    $('#sd-set').textContent = prof.set ? hhmm(prof.set) : '—';
    $('#sd-day').textContent = fmt(prof.kwh, 0);
  }
  function lit(t) {
    const win = prof.pts.filter((p) => p.t <= t && p.e > 0 && (p.t - prof.m0) / 3600e3 >= SD.from);
    $('.sd-lit', svg).setAttribute('d', win.length > 1 ? 'M' + win.map((p) => `${xOf(p.t).toFixed(1)} ${yOf(p.e).toFixed(1)}`).join('L') : '');
  }
  function phase(e, t) {
    const noon = prof.m0 + 12.25 * 3600e3;
    return e < -6 ? 'night' : e < 8 ? (t < noon ? 'dawn' : 'dusk') : 'day';
  }
  let shown = 0;
  function render(animate) {
    const now = Date.now();
    if (istMidnight(now) !== prof.m0 && !scrub) { prof = dayProfile(now); drawCurve(); }
    const t = scrub ?? now;
    const e = sunElevation(t);
    const kw = clearSkyKw(e);
    const h = (t - prof.m0) / 3600e3;
    const inWin = h >= SD.from && h <= SD.to;
    const x = xOf(Math.min(Math.max(t, prof.m0 + SD.from * 3600e3), prof.m0 + SD.to * 3600e3));
    const g = $('.sd-sun-g', svg);
    g.setAttribute('transform', `translate(${x.toFixed(1)} ${Math.min(yOf(e), SD.yH + 22).toFixed(1)})`);
    g.style.opacity = inWin && e > -8 ? 1 : 0;
    $('.sd-moon', svg).style.opacity = e < -6 ? 1 : 0;
    lit(t);
    hero.dataset.phase = document.documentElement.dataset.phase = phase(e, t);
    $('#sd-time').textContent = hhmm(t);
    $('#sd-when').textContent = scrub ? 'At' : 'Now,';
    const target = kw;
    const from = shown;
    const big = $('#sd-kw');
    if (animate && !reduce) {
      const t0 = performance.now();
      const step = (n) => { const k = Math.min((n - t0) / 500, 1); const v = from + (target - from) * (1 - Math.pow(1 - k, 3)); big.textContent = kwText(v); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    } else big.textContent = kwText(target);
    shown = target;
    const line = $('#sd-line');
    if (e <= 0.5) {
      const next = t < (prof.rise || 0) ? prof.rise : dayProfile(prof.m0 + 30 * 3600e3).rise;
      line.textContent = `The sun is down. Panels rest; the grid or a battery takes over until sunrise at ${hhmm(next)}.`;
    } else line.textContent = scrub ? 'What a 3 kW roof here makes at this time on a clear day.' : 'What a 3 kW roof here is making right now, if the sky is clear.';
    const sun = $('.sd-sun-g', svg);
    sun.setAttribute('aria-valuenow', String(Math.round(h * 60)));
    sun.setAttribute('aria-valuetext', `${hhmm(t)}, about ${kw.toFixed(1)} kilowatts`);
    $('#sd-now').hidden = !scrub;
  }
  drawCurve();
  render(true);
  setInterval(() => { if (!scrub) render(false); }, 60e3);

  const toX = (ev) => { const r = svg.getBoundingClientRect(); return (ev.clientX - r.left) / r.width * 320; };
  let dragging = false;
  svg.addEventListener('pointerdown', (ev) => { dragging = true; svg.setPointerCapture(ev.pointerId); scrub = tOf(toX(ev)); render(false); });
  svg.addEventListener('pointermove', (ev) => { if (!dragging) return; scrub = tOf(toX(ev)); render(false); });
  const end = () => { dragging = false; };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  $('.sd-sun-g', svg).addEventListener('keydown', (ev) => {
    const d = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15, PageUp: 60, PageDown: -60 }[ev.key];
    if (ev.key === 'Home' || ev.key === 'Escape') { scrub = null; render(true); ev.preventDefault(); return; }
    if (!d) return;
    ev.preventDefault();
    const base = scrub ?? Date.now();
    scrub = Math.min(Math.max(base + d * 60e3, prof.m0 + SD.from * 3600e3), prof.m0 + SD.to * 3600e3);
    render(false);
  });
  $('#sd-now').addEventListener('click', () => { scrub = null; render(true); });
}

/* ───────── the calculator ───────── */
// TNEB domestic, bimonthly, telescopic (same slabs as the ERP's calculator)
const SLABS = [[100, 0], [200, 2.35], [400, 4.7], [500, 6.3], [600, 8.4], [800, 9.45], [1000, 10.5], [Infinity, 11.55]];
const YIELD = 4.4;                                   // units per kW per day around Erode
const PANEL_W = 585;
const LIFE = Array.from({ length: 25 }, (_, i) => Math.pow(0.993, i)).reduce((a, b) => a + b, 0);
export function billFor(units) {
  let b = 0, prev = 0;
  for (const [to, rate] of SLABS) { const u = Math.min(units, to) - prev; if (u <= 0) break; b += u * rate; prev = to; }
  return b;
}
export function unitsFor(bill) {
  let lo = 0, hi = 20000;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (billFor(mid) < bill) lo = mid; else hi = mid; }
  return hi;
}
export function subsidyFor(kw) { return Math.round(Math.min(kw, 2) * 30000 + Math.min(Math.max(kw - 2, 0), 1) * 18000); }
const PUMP_KW = { 3: 3, 5: 4.8, 7.5: 6.75, 10: 9.3 };
let PRICES = null;
function ratePerKw(type, kw) {
  if (!PRICES) return null;
  const slabs = (PRICES.slabs || {})[type] || [];
  const s = slabs.find((r) => kw >= (r.from ?? 0) && (r.to == null || kw <= r.to));
  return s ? s.rate : (PRICES.per_kw || {})[type] || null;
}

export function homeCalc(bill) {
  const units = unitsFor(bill);
  const kw = Math.min(Math.max(Math.round(units / (60 * YIELD) * 2) / 2, 1), 10);
  const gen = kw * YIELD * 60;
  const after = billFor(Math.max(units - gen, 0));
  const monthly = Math.max(bill - after, 0) / 2;
  const subsidy = subsidyFor(kw);
  const rate = ratePerKw('on-grid', kw);
  const price = rate ? Math.round(kw * rate) : null;
  const net = price ? Math.max(price - subsidy, 0) : null;
  return { mode: 'home', bill, units: Math.round(units), kw, panels: Math.ceil(kw * 1000 / PANEL_W), roof: Math.round(kw * 100), monthly: Math.round(monthly),
    yearly: Math.round(monthly * 12), life: Math.round(monthly * 12 * LIFE), subsidy, price, net, payback: net && monthly > 0 ? net / (monthly * 12) : null };
}
export function farmCalc(hp, source, hours) {
  const kw = PUMP_KW[hp] || Math.round(hp * 0.93 * 10) / 10;
  const litres = source === 'diesel' ? Math.round(hp * 0.746 * 0.3 * hours * 300) : 0;
  const yearly = litres * 95;
  const rate = ratePerKw('solar-pump', kw);
  const price = rate ? Math.round(kw * rate) : null;
  return { mode: 'farm', pump_hp: hp, source, hours, kw, panels: Math.ceil(kw * 1000 / PANEL_W), roof: Math.round(kw * 100), litres, yearly, monthly: Math.round(yearly / 12),
    life: Math.round(yearly * LIFE), price, payback: price && yearly > 0 ? price / yearly : null };
}
export function bizCalc(bill) {
  const avg = 9;                                    // ₹ per unit incl. charges, LT commercial
  const units = bill / avg;
  const kw = Math.min(Math.max(Math.round(units / (30 * YIELD)), 3), 500);
  const gen = kw * YIELD * 30;
  const monthly = Math.min(gen / units, 1) * bill * 0.95;
  const rate = ratePerKw('on-grid', kw);
  const price = rate ? Math.round(kw * rate) : null;
  return { mode: 'business', bill, units: Math.round(units), kw, panels: Math.ceil(kw * 1000 / PANEL_W), roof: Math.round(kw * 100), monthly: Math.round(monthly),
    yearly: Math.round(monthly * 12), life: Math.round(monthly * 12 * LIFE), price, payback: price && monthly > 0 ? price / (monthly * 12) : null };
}

function countTo(el, value, render) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = value;
  if (reduce || Math.abs(value - from) < 1) { el.textContent = render(value); return; }
  const t0 = performance.now();
  const step = (n) => { const k = Math.min((n - t0) / 420, 1); el.textContent = render(from + (value - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const years = (y) => (y == null ? '—' : y < 1 ? 'under 1 year' : `${y.toFixed(1).replace(/\.0$/, '')} years`);
const BIZ = (v) => Math.round(5000 * Math.pow(100, v / 100) / 500) * 500;          // slider 0–100 → ₹5,000 – ₹5,00,000 (log scale)

function calculator() {
  const root = $('#calc');
  if (!root) return;
  let mode = 'home', last = null, nudged = false, nudgeT;
  const state = { bill: 4000, hp: 5, source: 'diesel', hours: 6, biz: 50 };
  const out = (k) => $(`[data-out=${k}]`, root);
  const setRange = (inp) => inp.style.setProperty('--p', ((inp.value - inp.min) / (inp.max - inp.min) * 100) + '%');

  function roof(n) {
    const cells = $$('.panel-cell', root);
    cells.forEach((c, i) => { c.classList.toggle('on', i < n); c.classList.toggle('shine', i < n && i % 3 === 0); });
    out('panels-cap').textContent = n > cells.length ? `${n} panels — showing ${cells.length}` : `${n} panel${n === 1 ? '' : 's'} of ${PANEL_W} W`;
  }
  function show(user = true) {
    const r = mode === 'home' ? homeCalc(state.bill) : mode === 'farm' ? farmCalc(state.hp, state.source, state.hours) : bizCalc(BIZ(state.biz));
    last = r;
    countTo(out('monthly'), mode === 'farm' && state.source !== 'diesel' ? 0 : r.monthly, (v) => inr(v));
    out('monthly-label').textContent = mode === 'farm' ? (state.source === 'diesel' ? 'Diesel money saved each month' : 'Daytime water, no waiting for 3-phase power') : 'Saved on your EB bill each month';
    countTo(out('kw'), r.kw, (v) => fmt(v, 1) + ' kW');
    out('roof').textContent = `about ${fmt(r.roof)} sq ft of shade-free roof`;
    roof(r.panels);
    const subRow = out('subsidy').closest('div');
    if (mode === 'home') { subRow.hidden = false; out('subsidy-l').textContent = 'PM Surya Ghar subsidy'; countTo(out('subsidy'), r.subsidy, (v) => inr(v)); }
    else if (mode === 'farm') { subRow.hidden = false; out('subsidy-l').textContent = state.source === 'diesel' ? 'Diesel saved a year' : 'Subsidy'; out('subsidy').textContent = state.source === 'diesel' ? `${fmt(r.litres)} litres` : 'PM-KUSUM'; out('subsidy').dataset.v = 0; }
    else subRow.hidden = true;
    const priceRow = out('price').closest('div'), netRow = out('net').closest('div'), pbRow = out('payback').closest('div');
    priceRow.hidden = !r.price; netRow.hidden = !(mode === 'home' && r.net != null); pbRow.hidden = !r.payback;
    if (r.price) countTo(out('price'), r.price, (v) => inr(v, { short: true }));
    if (mode === 'home' && r.net != null) countTo(out('net'), r.net, (v) => inr(v, { short: true }));
    if (r.payback) out('payback').textContent = years(r.payback);
    countTo(out('life'), mode === 'farm' && state.source !== 'diesel' ? 0 : r.life, (v) => inr(v, { short: true }));
    out('life').closest('div').hidden = mode === 'farm' && state.source !== 'diesel';
    out('note').textContent = mode === 'home'
      ? `Based on TNEB home tariff slabs and ${YIELD} units per kW a day around Erode. ${r.price ? 'Price is our package rate before any site-specific extras. ' : ''}Your exact figures come after a free site visit.`
      : mode === 'farm' ? `Diesel at ₹95 a litre, ${state.hours} hours a day, 300 days a year. PM-KUSUM subsidy depends on eligibility — we check it for you.`
        : `Assumes about ₹9 a unit including charges. Bigger systems often cost less per kW — we’ll design and price yours after a site visit.`;
    clearTimeout(nudgeT);
    if (user && !nudged) nudgeT = setTimeout(() => { nudged = true; notify({ id: 'calc-nudge', title: 'Want these numbers in writing?', message: `Book a free site visit and we’ll send an exact quote for your ${mode === 'farm' ? 'pump' : 'roof'}.`, cta_action: 'quote', kind: mode }); }, 9000);
  }

  $$('.seg [role=tab]', root).forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $$('.seg [role=tab]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $$('.calc-pane', root).forEach((p) => { p.hidden = p.dataset.pane !== mode; });
    show();
  }));
  const bill = $('#c-bill'), biz = $('#c-biz'), hours = $('#c-hours');
  bill.addEventListener('input', () => { state.bill = Number(bill.value); out('bill').textContent = inr(state.bill); setRange(bill); show(); });
  biz.addEventListener('input', () => { state.biz = Number(biz.value); out('biz').textContent = inr(BIZ(state.biz)); setRange(biz); show(); });
  hours.addEventListener('input', () => { state.hours = Number(hours.value); out('hours').textContent = `${state.hours} h`; setRange(hours); show(); });
  $$('[data-hp]', root).forEach((c) => c.addEventListener('click', () => { state.hp = Number(c.dataset.hp); $$('[data-hp]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === c))); show(); }));
  $$('[data-src]', root).forEach((c) => c.addEventListener('click', () => { state.source = c.dataset.src; $$('[data-src]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === c))); $('#c-hours-f').hidden = state.source !== 'diesel'; show(); }));
  [bill, biz, hours].forEach(setRange);

  $('#calc-cta').addEventListener('click', () => {
    clearTimeout(nudgeT); nudged = true;
    const r = last;
    const line = r.mode === 'farm' ? `${r.pump_hp} HP solar pump, about ${fmt(r.kw, 1)} kW` : `${fmt(r.kw, 1)} kW system, saves about ${inr(r.monthly)} a month`;
    openLead({ source: 'calculator', kind: r.mode, calcLine: line, title: 'Get your exact quote', sub: 'A free site visit turns this estimate into a fixed price.',
      calc: { mode: r.mode, bill: r.bill, units: r.units, kw: r.kw, subsidy: r.subsidy, price: r.price, net_price: r.net, monthly_saving: r.monthly, yearly_saving: r.yearly,
        payback_years: r.payback ? Math.round(r.payback * 10) / 10 : null, pump_hp: r.pump_hp } });
  });
  site('site').then((s) => { PRICES = s.prices || null; show(false); });
  show(false);
}

/* ───────── subsidy countdown ───────── */
const PSG_END = Date.UTC(2027, 2, 31, 18, 29, 59);          // 31 Mar 2027, 11:59 pm IST
function countdown() {
  const left = Math.ceil((PSG_END - Date.now()) / 864e5);
  const box = $('#psg-left');
  if (!box) return left;
  if (left > 0) $('#psg-days').textContent = fmt(left);
  else box.hidden = true;
  return left;
}

sundial();
calculator();
const left = countdown();
schedulePopups('site', left > 0 ? [{ id: 'psg-2027', title: 'Up to ₹78,000 back on home solar', message: 'PM Surya Ghar subsidy — this phase runs till 31 March 2027. We do the paperwork for you.', cta_label: 'Check my savings', cta_action: 'scroll', cta_url: '#calculator', delay_seconds: 10 }] : []);
exitIntent({ id: 'exit', title: 'Before you go — a free site visit?', message: 'We’ll check your roof and EB bill and tell you exactly what solar will save.', cta_action: 'quote' });
if (store.get('sp_lead_at', 0)) document.documentElement.classList.add('has-lead');
