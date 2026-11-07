/* Home page: a story you scroll through — sunrise over a house, the bill, the subsidy, the calculator, how it works,
   solutions, a night with a battery, why us — with a way to ask for the free plan at every step.
   The animation library (GSAP + ScrollTrigger in /assets/vendor) is optional: without it, or with reduced motion,
   every section simply shows its finished state. */
import { $, $$, boot, site, openLead, schedulePopups, exitIntent, notify, inr, fmt, esc, store, reduceMotion, reveal,
  billFor, unitsFor, subsidyFor, homeEstimate, YIELD, PANEL_W, LIFE, PUMP_KW } from './core.js';

boot('site');

const G = window.gsap, ST = window.ScrollTrigger;
const MOTION = Boolean(G && ST) && !reduceMotion();
if (MOTION) { G.registerPlugin(ST); ST.config({ ignoreMobileResize: true }); document.documentElement.classList.add('js-film'); }
const HEAD = () => ($('.top') ? $('.top').offsetHeight : 72);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
const mix3 = (a, b, c, t) => (t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2));

/* ───────── headings: words rise out of a mask ───────── */
function splitWords(el) {
  const walk = (node) => [...node.childNodes].forEach((n) => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach((t) => {
        if (!t) return;
        if (/^\s+$/.test(t)) { frag.append(t); return; }
        const w = document.createElement('span'); w.className = 'w';
        const i = document.createElement('span'); i.textContent = t; w.append(i); frag.append(w);
      });
      n.replaceWith(frag);
    } else if (n.nodeType === 1) walk(n);
  });
  walk(el);
  return $$('.w > span', el);
}
function headings(root) {
  if (!MOTION) return;
  $$('[data-split]', root).forEach((h) => {
    G.from(splitWords(h), { yPercent: 118, duration: 0.9, ease: 'power4.out', stagger: 0.05, scrollTrigger: { trigger: h, start: 'top 88%' } });
  });
}

/* ───────── 1. the sunrise film ───────── */
const SKY = [['#0B1A3F', '#2C4F95', '#3E95F2'], ['#3A3F78', '#E39A8C', '#8CC8FF'], ['#F28C5E', '#FFD39A', '#E4F3FF']];
function film() {
  const hero = $('#hero'), svg = $('#scene');
  if (!hero || !svg) return;
  const q = (s) => svg.querySelector(s), qa = (s) => [...svg.querySelectorAll(s)];
  const el = { sun: q('.sun'), stars: q('.stars'), tint: q('.tint'), clouds: qa('.cloud'), birds: q('.birds'), pv: qa('.pv'), shine: qa('.pv-shine'),
    flow: q('.flow'), meter: q('.meter-screen'), wins: qa('.win'), glows: q('.glows'), stops: ['#sk1', '#sk2', '#sk3'].map(q) };
  const cloudAt = el.clouds.map((c) => (c.getAttribute('transform').match(/[-\d.]+/g) || [0, 0]).map(Number));
  const est = homeEstimate(4500);
  // The camera: V0 is the opening frame, V1 the frame it pushes in to while the panels go on. Ground always in view.
  let V0 = { x: 0, y: 0, w: 1440, h: 900 }, V1 = V0, V = V0, SUN = { x: 800, y: 200 }, last = -1;
  const box = (w, a, anchor) => { const h = Math.min(w / a, 900); w = h * a; return { x: clamp(1030 - w * anchor, 0, 1440 - w), y: 900 - h, w, h }; };

  function frame() {
    const w = hero.clientWidth, h = hero.clientHeight;
    if (!w || !h) return;
    const a = w / h;
    if (a < 1.25) {                             // phones and tablets held upright: frame the house
      V0 = V1 = box(Math.min(900 * a, 1440), a, 0.5);
      SUN = { x: V1.x + V1.w * 0.82, y: 372 };
    } else {                                    // wide screens: open wide, then push in on the house
      V0 = box(Math.min(1440, 900 * a), a, 0.6);
      V1 = MOTION ? box(V0.w * 0.78, a, 0.6) : V0;
      SUN = { x: V1.x + V1.w * (MOTION ? 0.86 : 0.84), y: V1.y + V1.h * 0.22 };
    }
    svg.setAttribute('preserveAspectRatio', 'xMidYMax slice');
    last = -1;
  }
  function camera(z) {
    V = { x: V0.x + (V1.x - V0.x) * z, y: V0.y + (V1.y - V0.y) * z, w: V0.w + (V1.w - V0.w) * z, h: V0.h + (V1.h - V0.h) * z };
    svg.setAttribute('viewBox', `${V.x.toFixed(1)} ${V.y.toFixed(1)} ${V.w.toFixed(1)} ${V.h.toFixed(1)}`);
  }

  function draw(p) {
    if (Math.abs(p - last) < 1e-4) return;
    last = p;
    const z = seg(p, 0.28, 0.78);
    camera(z * z * (3 - 2 * z));
    const day = seg(p, 0.06, 0.46);
    el.stops.forEach((s, i) => s.setAttribute('stop-color', mix3(...SKY[i], day)));
    const s = easeOut(seg(p, 0.04, 0.5));
    el.sun.setAttribute('transform', `translate(${(1210 + (SUN.x - 1210) * s).toFixed(1)} ${(860 + (SUN.y - 860) * s).toFixed(1)})`);
    el.stars.setAttribute('opacity', (1 - seg(p, 0.04, 0.3)).toFixed(3));
    el.tint.setAttribute('opacity', (0.5 * (1 - seg(p, 0.04, 0.36))).toFixed(3));
    el.clouds.forEach((c, i) => {
      c.setAttribute('transform', `translate(${(cloudAt[i][0] + (i % 2 ? -1 : 1) * 150 * p).toFixed(1)} ${cloudAt[i][1]})`);
      c.setAttribute('opacity', (0.35 + 0.57 * day).toFixed(3));
    });
    const b = seg(p, 0.26, 0.7);
    el.birds.setAttribute('transform', `translate(${(V.x - 120 + (V.w + 240) * b).toFixed(1)} ${(V.y + V.h * 0.36 - 110 * b).toFixed(1)})`);
    el.birds.setAttribute('opacity', b > 0 && b < 1 ? 0.7 : 0);
    el.pv.forEach((g, i) => {
      const t = seg(p, 0.44 + i * 0.045, 0.52 + i * 0.045);
      g.setAttribute('transform', `translate(0 ${(-(1 - easeOut(t)) * 320).toFixed(1)})`);
      g.setAttribute('opacity', Math.min(t * 3, 1).toFixed(3));
    });
    el.shine.forEach((x, i) => x.setAttribute('opacity', (Math.sin(seg(p, 0.66 + i * 0.02, 0.73 + i * 0.02) * Math.PI) * 0.75).toFixed(3)));
    const f = seg(p, 0.66, 0.72);
    el.flow.setAttribute('opacity', f.toFixed(3));
    el.flow.classList.toggle('flow-on', f > 0);
    el.meter.setAttribute('fill', mix('#183044', '#2FD27A', seg(p, 0.7, 0.74)));
    el.wins.forEach((r, i) => r.setAttribute('fill', mix('#2A3456', '#FFD772', seg(p, 0.72 + i * 0.012, 0.76 + i * 0.012))));
    el.glows.setAttribute('opacity', seg(p, 0.72, 0.8).toFixed(3));
  }

  frame();
  addEventListener('resize', () => { frame(); draw(MOTION ? Math.max(last, 0) : 1); });
  const amt = $('#hb-amt');
  $('.hb-note', hero).textContent = `Estimate for a home with a ${fmt(est.kw, 1)} kW roof`;
  amt.textContent = inr(est.bill);

  if (!MOTION) { hero.classList.add('is-day'); $('.scroll-hint', hero).hidden = true; draw(1); return; }

  const P = { p: 0 };
  const caps = $$('.cap', hero), card = $('.hb', hero), stamp = $('.stamp', hero);
  const tl = G.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
    trigger: hero, start: () => `top ${HEAD()}px`, end: () => `+=${Math.round(innerHeight * 2.4)}`,
    scrub: 0.6, pin: true, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority: 3,
    onRefresh: () => { frame(); draw(P.p); } } });
  tl.to(P, { p: 1, duration: 10, onUpdate: () => draw(P.p) }, 0);
  tl.to('.scroll-hint', { autoAlpha: 0, duration: 0.4 }, 0);
  // the heading only fades (it stays the page's h1 for screen readers); the form is hidden properly so it can't take focus
  tl.to('#hero-h', { y: -80, opacity: 0, duration: 1.1, ease: 'power1.in' }, 0.2);
  tl.to($$('#hero-copy > :not(h1)'), { y: -80, autoAlpha: 0, duration: 1.1, ease: 'power1.in' }, 0.2);
  const at = [1.4, 4.2, 6.5, 7.9];
  caps.forEach((c, i) => {
    tl.fromTo(c, { y: 26, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, ease: 'power2.out' }, at[i]);
    if (i < caps.length - 1) tl.to(c, { y: -26, autoAlpha: 0, duration: 0.4, ease: 'power1.in' }, at[i + 1] - 0.45);
  });
  tl.fromTo(card, { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, 8.1);
  const bill = { v: est.bill };
  tl.to(bill, { v: est.after, duration: 1.2, ease: 'power1.inOut', onUpdate: () => { amt.textContent = inr(bill.v); } }, 8.5);
  tl.fromTo(stamp, { scale: 2.4, rotation: -26, autoAlpha: 0 }, { scale: 1, rotation: -8, autoAlpha: 1, duration: 0.45, ease: 'back.out(2)' }, 9.6);
  tl.to({}, { duration: 0.6 }, 10.05);
  draw(0);
}

/* ───────── 2. why the bill is so high ───────── */
function billChapter() {
  const sec = $('#bill');
  if (!sec) return;
  const e = homeEstimate(4500);
  const gen = Math.round(e.kw * YIELD * 60);
  const B = (k) => $(`[data-b=${k}]`, sec);
  const paid = $('.paid', sec), lines = $$('.bill-lines p', sec), card = $('#bill-card');
  $('.bill-row.solar span', sec).textContent = `Made by a ${fmt(e.kw, 1)} kW roof`;
  B('units').textContent = fmt(e.units);
  const U = unitsFor(e.bill);                 // unrounded, so the bill starts at exactly what the hero showed
  const set = (t) => {
    const left = Math.max(U - gen * t, 0);
    B('solar').textContent = '−' + fmt(gen * t);
    B('left').textContent = fmt(left);
    B('total').textContent = inr(billFor(left));
    paid.classList.toggle('on', t >= 0.985);
  };
  if (!MOTION) { set(1); lines.forEach((l) => l.classList.add('on')); return; }
  headings(sec);
  set(0);
  const mm = G.matchMedia();
  mm.add('(min-width: 980px)', () => {
    ST.create({ trigger: sec, start: () => `top ${HEAD()}px`, end: () => `+=${Math.round(innerHeight * 1.1)}`, pin: true, refreshPriority: 2,
      onUpdate: (s) => { lines.forEach((l, i) => l.classList.toggle('on', s.progress >= i * 0.2)); set(easeOut(seg(s.progress, 0.2, 0.85))); } });
  });
  mm.add('(max-width: 979px)', () => {
    lines.forEach((l) => ST.create({ trigger: l, start: 'top 80%', onToggle: (s) => l.classList.toggle('on', s.isActive || s.progress > 0), end: 'max' }));
    ST.create({ trigger: card, start: 'top 75%', end: 'bottom 60%', onUpdate: (s) => set(easeOut(s.progress)) });
  });
}

/* ───────── 3. subsidy ───────── */
const PSG_END = Date.UTC(2027, 2, 31, 18, 29, 59);          // 31 Mar 2027, 11:59 pm IST
function subsidy() {
  const sec = $('#subsidy');
  const left = Math.ceil((PSG_END - Date.now()) / 864e5);
  const days = $('#psg-days');
  if (left > 0) days.textContent = fmt(left); else $('#psg-left').hidden = true;
  if (!sec || !MOTION) return left;
  headings(sec);
  const big = $('#big-amt');
  G.fromTo(big, { backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0', ease: 'none', scrollTrigger: { trigger: big, start: 'top 88%', end: 'top 35%', scrub: true } });
  G.fromTo(big, { scale: 0.82 }, { scale: 1, transformOrigin: '0% 50%', ease: 'none', scrollTrigger: { trigger: big, start: 'top 100%', end: 'top 40%', scrub: true } });
  const count = (b, to, render) => { const o = { v: 0 }; b.textContent = render(0); G.to(o, { v: to, duration: 1.6, ease: 'power2.out', onUpdate: () => { b.textContent = render(o.v); }, scrollTrigger: { trigger: b, start: 'top 90%' } }); };
  $$('[data-count]', sec).forEach((b) => count(b, Number(b.dataset.count), (v) => inr(Math.round(v / 500) * 500)));
  if (left > 0) count(days, left, (v) => fmt(Math.round(v)));
  G.from($$('.slab', sec), { y: 40, autoAlpha: 0, stagger: 0.12, duration: 0.7, ease: 'power3.out', scrollTrigger: { trigger: '.slabs', start: 'top 88%' } });
  return left;
}

/* ───────── 4. the calculator ───────── */
let PRICES = null;
function ratePerKw(type, kw) {
  if (!PRICES) return null;
  const slabs = (PRICES.slabs || {})[type] || [];
  const s = slabs.find((r) => kw >= (r.from ?? 0) && (r.to == null || kw <= r.to));
  return s ? s.rate : (PRICES.per_kw || {})[type] || null;
}
function homeCalc(bill) {
  const units = unitsFor(bill);
  const kw = Math.min(Math.max(Math.round(units / (60 * YIELD) * 2) / 2, 1), 10);
  const after = billFor(Math.max(units - kw * YIELD * 60, 0));
  const monthly = Math.max(bill - after, 0) / 2;
  const subsidy = subsidyFor(kw);
  const rate = ratePerKw('on-grid', kw);
  const price = rate ? Math.round(kw * rate) : null;
  const net = price ? Math.max(price - subsidy, 0) : null;
  return { mode: 'home', bill, units: Math.round(units), kw, panels: Math.ceil(kw * 1000 / PANEL_W), roof: Math.round(kw * 100), monthly: Math.round(monthly),
    yearly: Math.round(monthly * 12), life: Math.round(monthly * 12 * LIFE), subsidy, price, net, payback: net && monthly > 0 ? net / (monthly * 12) : null };
}
function farmCalc(hp, source, hours) {
  const kw = PUMP_KW[hp] || Math.round(hp * 0.93 * 10) / 10;
  const litres = source === 'diesel' ? Math.round(hp * 0.746 * 0.3 * hours * 300) : 0;
  const yearly = litres * 95;
  const rate = ratePerKw('solar-pump', kw);
  const price = rate ? Math.round(kw * rate) : null;
  return { mode: 'farm', pump_hp: hp, source, hours, kw, panels: Math.ceil(kw * 1000 / PANEL_W), roof: Math.round(kw * 100), litres, yearly, monthly: Math.round(yearly / 12),
    life: Math.round(yearly * LIFE), price, payback: price && yearly > 0 ? price / yearly : null };
}
function bizCalc(bill) {
  const units = bill / 9;                                 // about ₹9 a unit with charges, LT commercial
  const kw = Math.min(Math.max(Math.round(units / (30 * YIELD)), 3), 500);
  const monthly = Math.min(kw * YIELD * 30 / units, 1) * bill * 0.95;
  const rate = ratePerKw('on-grid', kw);
  const price = rate ? Math.round(kw * rate) : null;
  return { mode: 'business', bill, units: Math.round(units), kw, panels: Math.ceil(kw * 1000 / PANEL_W), roof: Math.round(kw * 100), monthly: Math.round(monthly),
    yearly: Math.round(monthly * 12), life: Math.round(monthly * 12 * LIFE), price, payback: price && monthly > 0 ? price / (monthly * 12) : null };
}
function countTo(el, value, render) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = value;
  if (reduceMotion() || Math.abs(value - from) < 1) { el.textContent = render(value); return; }
  const t0 = performance.now();
  const step = (n) => { const k = Math.min((n - t0) / 420, 1); el.textContent = render(from + (value - from) * easeOut(k)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const years = (y) => (y == null ? '—' : y < 1 ? 'under 1 year' : `${y.toFixed(1).replace(/\.0$/, '')} years`);
const BIZ = (v) => Math.round(5000 * Math.pow(100, v / 100) / 500) * 500;          // slider 0–100 → ₹5,000 – ₹5,00,000 (log scale)

function calculator() {
  const root = $('#calc');
  if (!root) return;
  if (MOTION) headings($('#calculator'));
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
    const eb = mode === 'farm' && state.source !== 'diesel';
    countTo(out('monthly'), eb ? 0 : r.monthly, (v) => inr(v));
    out('monthly-label').textContent = mode === 'farm' ? (state.source === 'diesel' ? 'Diesel money saved each month' : 'Daytime water, no waiting for 3-phase power') : 'Saved on your EB bill each month';
    countTo(out('kw'), r.kw, (v) => fmt(v, 1) + ' kW');
    out('roof').textContent = `about ${fmt(r.roof)} sq ft of shade-free roof`;
    roof(r.panels);
    const subRow = out('subsidy').closest('div');
    if (mode === 'home') { subRow.hidden = false; out('subsidy-l').textContent = 'PM Surya Ghar subsidy'; countTo(out('subsidy'), r.subsidy, (v) => inr(v)); }
    else if (mode === 'farm') { subRow.hidden = false; out('subsidy-l').textContent = state.source === 'diesel' ? 'Diesel saved a year' : 'Subsidy'; out('subsidy').textContent = state.source === 'diesel' ? `${fmt(r.litres)} litres` : 'PM-KUSUM'; out('subsidy').dataset.v = 0; }
    else subRow.hidden = true;
    out('price').closest('div').hidden = !r.price;
    out('net').closest('div').hidden = !(mode === 'home' && r.net != null);
    out('payback').closest('div').hidden = !r.payback;
    if (r.price) countTo(out('price'), r.price, (v) => inr(v, { short: true }));
    if (mode === 'home' && r.net != null) countTo(out('net'), r.net, (v) => inr(v, { short: true }));
    if (r.payback) out('payback').textContent = years(r.payback);
    countTo(out('life'), eb ? 0 : r.life, (v) => inr(v, { short: true }));
    out('life').closest('div').hidden = eb;
    out('note').textContent = mode === 'home'
      ? `Based on TNEB home tariff slabs and ${YIELD} units per kW a day around Erode. ${r.price ? 'Price is our package rate before any site-specific extras. ' : ''}Your exact figures come after a free site visit.`
      : mode === 'farm' ? `Diesel at ₹95 a litre, ${state.hours} hours a day, 300 days a year. PM-KUSUM subsidy depends on eligibility — we check it for you.`
        : 'Assumes about ₹9 a unit including charges. Bigger systems often cost less per kW — we’ll design and price yours after a site visit.';
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
    openLead({ source: 'calculator', kind: r.mode, calcLine: line, title: 'Get your exact quote',
      calc: { mode: r.mode, bill: r.bill, units: r.units, kw: r.kw, subsidy: r.subsidy, price: r.price, net_price: r.net, monthly_saving: r.monthly, yearly_saving: r.yearly,
        payback_years: r.payback ? Math.round(r.payback * 10) / 10 : null, pump_hp: r.pump_hp } });
  });
  site('site').then((s) => { PRICES = s.prices || null; show(false); });
  show(false);
}

/* ───────── 5. how it works: a sideways ride ───────── */
function how() {
  const sec = $('#how'), track = $('#how-track'), bar = $('.how-bar i');
  if (!sec || !MOTION) return;
  headings(sec);
  sec.classList.add('pinned');
  const dist = () => Math.max(track.scrollWidth - document.documentElement.clientWidth, 0);
  G.to(track, { x: () => -dist(), ease: 'none', scrollTrigger: { trigger: sec, start: () => `top ${HEAD()}px`, end: () => `+=${Math.max(dist(), 1)}`,
    pin: true, scrub: 0.5, invalidateOnRefresh: true, refreshPriority: 1, onUpdate: (s) => { bar.style.transform = `scaleX(${0.15 + 0.85 * s.progress})`; } } });
}

/* ───────── 6. solutions: cards that stack ───────── */
function stack() {
  const sec = $('#solutions'), cards = $$('.scard');
  cards.forEach((c, i) => c.style.setProperty('--i', i));
  if (!MOTION) return;
  headings(sec);
  cards.forEach((c, i) => {
    if (i === cards.length - 1) return;
    G.to(c, { scale: 0.93, ease: 'none', scrollTrigger: { trigger: cards[i + 1], start: 'top bottom', end: () => `top ${HEAD() + 18 + (i + 1) * 14}px`, scrub: true } });
  });
  cards.forEach((c) => G.from($$('h3, p, ul, .btn, .tag-big', c), { y: 30, autoAlpha: 0, stagger: 0.07, duration: 0.7, ease: 'power3.out', scrollTrigger: { trigger: c, start: 'top 75%' } }));
}

/* ───────── 7. night: a battery keeps the lights on ───────── */
const RAD = Math.PI / 180, LAT = 11.2755, LON = 77.587;            // Perundurai
function sunElevation(ms) {
  const d = ms / 864e5 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = ((gmst * 15 + LON - ra) % 360 + 540) % 360 - 180;
  return Math.asin(Math.sin(LAT * RAD) * Math.sin(dec) + Math.cos(LAT * RAD) * Math.cos(dec) * Math.cos(ha * RAD)) / RAD;
}
function clearSkyKw(elev, kwp = 3) {
  if (elev <= 0.5) return 0;
  const z = 90 - elev, cz = Math.cos(z * RAD);
  const am = 1 / (cz + 0.50572 * Math.pow(96.07995 - z, -1.6364));
  return Math.max(0, kwp * 1.1 * 1.353 * Math.pow(0.7, Math.pow(am, 0.678)) * cz * 0.8);
}
const clock = (mins) => { const m = ((Math.round(mins / 10) * 10) % 1440 + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
function night() {
  const sec = $('#backup'), svg = $('#batt');
  if (!sec || !svg) return;
  const live = $('#live-text');
  const tick = () => {
    const e = sunElevation(Date.now()), kw = clearSkyKw(e);
    live.textContent = e > 0.5 ? `Live: under a clear sky, a 3 kW roof in Perundurai would be making about ${kw.toFixed(1)} kW right now.` : 'Live: the sun is down in Perundurai right now — this is when a battery does the work.';
  };
  tick(); setInterval(tick, 60e3);
  const lvl = $('.b-level', svg), pct = $('.b-pct', svg), time = $('.b-time', svg);
  const set = (p) => {
    const level = 1 - 0.62 * p;
    lvl.setAttribute('y', (98 + 232 * (1 - level)).toFixed(1));
    lvl.setAttribute('height', (232 * level).toFixed(1));
    pct.textContent = `${Math.round(level * 100)}%`;
    time.textContent = clock(19 * 60 + p * 600);
  };
  if (!MOTION) { sec.classList.add('dark'); set(0.4); return; }
  headings(sec);
  set(0);
  const dark = { trigger: sec, start: 'top 80%', end: 'top 25%', scrub: true };
  G.to(sec, { backgroundColor: '#071528', color: '#EAF1FF', ease: 'none', scrollTrigger: dark });
  G.to($$('.b-moon, .b-stars', svg), { opacity: 1, ease: 'none', scrollTrigger: { ...dark } });
  ST.create({ trigger: sec, start: 'top 55%', end: 'bottom 55%', onUpdate: (s) => set(s.progress) });
}

/* ───────── 8. why us: the words light up as you read ───────── */
function why() {
  const p = $('#why-text');
  if (!p) return;
  p.innerHTML = p.textContent.trim().split(/\s+/).map((w) => `<span class="wd">${esc(w)}</span>`).join(' ');
  const words = $$('.wd', p);
  $$('.pillar').forEach((x, i) => { x.style.transitionDelay = `${i * 90}ms`; });
  if (!MOTION) { words.forEach((w) => w.classList.add('lit')); return; }
  ST.create({ trigger: p, start: 'top 82%', end: 'bottom 45%', onUpdate: (s) => { const n = Math.round(s.progress * words.length); words.forEach((w, i) => w.classList.toggle('lit', i < n)); } });
}

/* ───────── the bar at the bottom of phones ───────── */
function mobileBar() {
  const bar = $('#mbar'), after = $('#after-hero'), end = $('#contact');
  if (!bar || !after) return;
  let raf = 0;
  const check = () => {
    raf = 0;
    const past = after.getBoundingClientRect().top < innerHeight * 0.6;
    const atEnd = end && end.getBoundingClientRect().top < innerHeight * 0.85;
    const on = past && !atEnd;
    bar.classList.toggle('on', on);
    document.body.classList.toggle('mbar-on', on);
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(check); }, { passive: true });
  check();
}

/* ───────── start ───────── */
film();
billChapter();
const left = subsidy();
calculator();
how();
stack();
night();
why();
if (MOTION) headings($('#faq'));
if (MOTION) headings($('#contact'));
reveal();
mobileBar();
if (MOTION) addEventListener('load', () => ST.refresh());
schedulePopups('site', left > 0 ? [{ id: 'psg-2027', title: 'Up to ₹78,000 back on home solar', message: 'PM Surya Ghar subsidy — this phase runs till 31 March 2027. We do the paperwork for you.', cta_label: 'Get my free plan', cta_action: 'quote', kind: 'home', delay_seconds: 12 }] : []);
exitIntent({ id: 'exit', title: 'Before you go — a free site visit?', message: 'We’ll check your roof and EB bill and tell you exactly what solar will save.', cta_action: 'quote' });
if (store.get('sp_lead_at', 0)) document.documentElement.classList.add('has-lead');
