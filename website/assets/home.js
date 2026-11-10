/* Home page: a day on solar in 3D, five kinds of system with live diagrams, the day hour by hour, the bill, the subsidy,
   the calculator, customer videos, how it works, the brands we deal with and why us — with a way to ask for the free plan
   at every step. Customer videos and brands come from the ERP (/api/public/site); each section hides when its list is empty.
   The animation library (GSAP + ScrollTrigger in /assets/vendor) and the 3D scene (/assets/hero3d.js, built from
   src/hero3d.js) are optional: without them, or with reduced motion, every section shows its finished state. */
import { $, $$, boot, site, openLead, schedulePopups, exitIntent, notify, inr, fmt, esc, store, reduceMotion, reveal,
  billFor, unitsFor, subsidyFor, homeEstimate, YIELD, PANEL_W, LIFE, PUMP_KW } from './core.js';

boot('site');

const G = window.gsap, ST = window.ScrollTrigger;
const MOTION = Boolean(G && ST) && !reduceMotion();
if (MOTION) { G.registerPlugin(ST); ST.config({ ignoreMobileResize: true }); document.documentElement.classList.add('js-film'); }
const HEAD = () => ($('.top') ? $('.top').offsetHeight : 72);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = seg(x, a, b); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clock12 = (h) => { const m = Math.round(((h % 24) + 24) % 24 * 60 / 5) * 5 % 1440; const hh = Math.floor(m / 60), mm = m % 60; return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };

/* The same day as the 3D scene and the chart: 6.6 kW of panels and a 10 kWh battery, a clear November day near Erode.
   (src/hero3d.js has the same formulas — keep them in step.) */
const hourAt = (p) => (p < 0.5 ? lerp(5.95, 12.5, p / 0.5) : p < 0.82 ? lerp(12.5, 18.2, (p - 0.5) / 0.32) : lerp(18.2, 20.2, (p - 0.82) / 0.18));
function energyAt(h) {
  const elev = Math.sin(Math.PI * clamp((h - 6.05) / 12.1, 0, 1)) * 58;
  const solar = elev > 0.5 ? 6.6 * 0.78 * Math.pow(Math.sin(elev * Math.PI / 180), 1.12) : 0;
  const home = 0.45 + 0.9 * Math.exp(-((h - 7.5) ** 2) / 1.2) + 1.3 * Math.exp(-((h - 19.5) ** 2) / 2.5);
  const battery = h < 6 ? 65 - 30 * h / 6 : h < 7 ? 35 : h < 15 ? lerp(35, 100, smooth(7, 15, h)) : h < 18 ? 100 : 100 - 38 * (1 - Math.exp(-(h - 18) / 2.5));
  return { elev, solar, home, battery };
}

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
  if (!MOTION || !root) return;
  $$('[data-split]', root).forEach((h) => {
    if (h.dataset.done) return; h.dataset.done = '1';
    G.from(splitWords(h), { yPercent: 118, duration: 1.1, ease: 'expo.out', stagger: 0.045, scrollTrigger: { trigger: h, start: 'top 88%' } });
  });
}

/* ───────── 1. the film: a day on solar, in 3D ───────── */
function film() {
  const hero = $('#hero'), canvas = $('#hero3d');
  if (!hero) return;
  const pic = $('.poster', hero), img = $('img', pic), src = $('source', pic);
  const hud = { time: $('#hud-time'), solar: $('#hud-solar'), batt: $('#hud-batt'), day: $('#hud-day') };
  const amt = $('#hb-amt');
  const est = homeEstimate(4500);
  amt.textContent = inr(est.bill);
  if (!MOTION) {                                                   // the finished daytime picture, nothing moves
    hero.classList.add('is-static');
    img.src = '/assets/img/hero-day.webp'; src.srcset = '/assets/img/hero-day-m.webp';
    $('.scroll-hint', hero).hidden = true;
    return;
  }
  const P = { p: 0 };
  let H = null;
  const paint = () => {
    const h = hourAt(P.p), e = energyAt(h);
    hud.time.textContent = clock12(h);
    hud.solar.textContent = `${e.solar.toFixed(1)} kW`;
    hud.batt.textContent = `${Math.round(e.battery)}%`;
    hud.day.style.transform = `scaleX(${seg(h, 6, 18.2).toFixed(3)})`;
    if (H) H.set(P.p);
  };
  const tl = G.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
    trigger: hero, start: () => `top ${HEAD()}px`, end: () => `+=${Math.round(innerHeight * 3)}`,
    scrub: 0.8, pin: true, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority: 3, onRefresh: () => { if (H) H.resize(); paint(); } } });
  tl.to(P, { p: 1, duration: 10, onUpdate: paint }, 0);
  tl.to('.scroll-hint', { autoAlpha: 0, duration: 0.3 }, 0);
  tl.to('#hero-h', { y: -60, opacity: 0, duration: 0.9, ease: 'power2.in' }, 0.15);        // the h1 only fades: it stays the page's heading
  tl.to($$('#hero-copy > :not(h1)'), { y: -60, autoAlpha: 0, duration: 0.9, ease: 'power2.in', stagger: 0.04 }, 0.1);
  tl.fromTo('.hud', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, ease: 'power3.out' }, 0.7);
  const chaps = $$('.chap', hero), at = [1.3, 3.2, 5.4, 8.0];
  chaps.forEach((c, i) => {
    tl.fromTo(c, { y: 28, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, ease: 'power3.out' }, at[i]);
    if (i < chaps.length - 1) tl.to(c, { y: -28, autoAlpha: 0, duration: 0.45, ease: 'power2.in' }, at[i + 1] - 0.5);
  });
  tl.fromTo('.bill-chip', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, ease: 'power3.out' }, 8.3);
  const bill = { v: est.bill };
  tl.to(bill, { v: est.after, duration: 1.1, ease: 'power1.inOut', onUpdate: () => { amt.textContent = inr(bill.v); } }, 8.7);
  tl.to({}, { duration: 0.5 }, 10);
  paint();

  // the 3D scene loads after the page has shown; the poster stands in until then (and if WebGL isn't there)
  const webgl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
  if (!webgl || !canvas) return;
  const load = () => import(window.SP_HERO3D || '/assets/hero3d.js').then(({ createHero }) => {
    H = createHero(canvas, { mobile: matchMedia('(max-width: 899px)').matches });
    H.resize(); H.set(P.p); H.render();
    requestAnimationFrame(() => canvas.classList.add('on'));
    let visible = true;
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible && document.visibilityState === 'visible') H.start(); else H.stop(); }).observe(hero);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && visible) H.start(); else H.stop(); });
    addEventListener('resize', () => H.resize());
    H.start();
  }).catch(() => { /* the poster stays */ });
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  if (document.readyState === 'complete') idle(load); else addEventListener('load', () => idle(load), { once: true });
}

/* ───────── numbers band ───────── */
function proof() {
  const stats = $$('.stat');
  if (!MOTION || !stats.length) return;
  stats.forEach((s, i) => {
    G.fromTo(s, { '--line-s': 0 }, { '--line-s': 1, duration: 1.2, ease: 'expo.out', delay: i * 0.08, scrollTrigger: { trigger: s, start: 'top 90%' } });
    G.from(s.children, { y: 26, autoAlpha: 0, duration: 0.9, ease: 'expo.out', stagger: 0.06, delay: 0.1 + i * 0.08, scrollTrigger: { trigger: s, start: 'top 90%' } });
    $$('[data-n]', s).forEach((n) => {
      const to = Number(n.dataset.n), dec = Number(n.dataset.dec || 0), o = { v: 0 };
      const show = (v) => { n.textContent = n.hasAttribute('data-inr') ? Math.round(v).toLocaleString('en-IN') : v.toFixed(dec); };
      show(0);
      G.to(o, { v: to, duration: 1.8, ease: 'power3.out', delay: i * 0.08, onUpdate: () => show(o.v), scrollTrigger: { trigger: s, start: 'top 90%' } });
    });
  });
}

/* ───────── 2. five systems, with diagrams that draw themselves ───────── */
function systems() {
  const sec = $('#systems'), cards = $$('.sys');
  if (!sec) return;
  cards.forEach((c, i) => c.style.setProperty('--i', i));
  const svgs = $$('.sys-svg', sec);
  if (!MOTION) { svgs.forEach((s) => { try { s.pauseAnimations(); } catch { /* old browsers */ } }); return; }
  headings(sec);
  svgs.forEach((svg) => {
    const flows = $$('.flow', svg), nodes = $$('.node', svg), pulses = $$('.pulse', svg);
    G.set(flows, { strokeDasharray: 1, strokeDashoffset: 1 });
    G.set(nodes, { autoAlpha: 0, scale: 0.86, transformOrigin: '50% 50%' });
    G.set(pulses, { autoAlpha: 0 });
    const tl = G.timeline({ scrollTrigger: { trigger: svg, start: 'top 72%' } });
    tl.to(nodes, { autoAlpha: 1, scale: 1, duration: 0.7, ease: 'expo.out', stagger: 0.08 })
      .to(flows, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut', stagger: 0.12 }, 0.25)
      .to(pulses, { autoAlpha: 1, duration: 0.4, stagger: 0.03 }, '-=0.3');
  });
  cards.forEach((c) => G.from($$('.sys-kind, h3, .sys-text > p, dl > div, .btn', c), { y: 24, autoAlpha: 0, duration: 0.9, ease: 'expo.out', stagger: 0.05, scrollTrigger: { trigger: c, start: 'top 74%' } }));
  G.matchMedia().add('(min-width: 980px)', () => {
    cards.forEach((c, i) => {
      if (i === cards.length - 1) return;
      G.to(c, { scale: 0.94, filter: 'brightness(0.94)', ease: 'none', scrollTrigger: { trigger: cards[i + 1], start: 'top bottom', end: () => `top ${HEAD() + 18 + (i + 1) * 14}px`, scrub: true } });
    });
  });
}

/* ───────── 3. a day on solar, hour by hour ───────── */
function dayChart() {
  const sec = $('#day'), svg = $('.day-svg', sec);
  if (!sec || !svg) return;
  const X0 = 56, X1 = 784, Y0 = 24, Y1 = 236, B0 = 286, B1 = 356;
  const xh = (h) => X0 + (X1 - X0) * h / 24, yk = (v) => Y1 - (Y1 - Y0) * v / 5, yb = (v) => B1 - (B1 - B0) * v / 100;
  const clip = $('#day-clip-r', svg), head = $('#day-head', svg), dSun = $('.d-sun', svg), dHome = $('.d-home', svg), dBat = $('.d-bat', svg);
  const read = { time: $('#dr-time'), sun: $('#dr-sun'), home: $('#dr-home'), bat: $('#dr-bat') };
  const steps = $$('.day-steps li', sec);
  let scrollH = 6, hoverH = null;
  const draw = (h) => {
    const e = energyAt(h), x = xh(h);
    clip.setAttribute('width', x.toFixed(1));
    head.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
    dSun.setAttribute('cy', yk(e.solar).toFixed(1)); dHome.setAttribute('cy', yk(e.home).toFixed(1)); dBat.setAttribute('cy', yb(e.battery).toFixed(1));
    read.time.textContent = clock12(h); read.sun.textContent = `${e.solar.toFixed(1)} kW`; read.home.textContent = `${e.home.toFixed(1)} kW`; read.bat.textContent = `${Math.round(e.battery)}%`;
    const k = h < 10 ? 0 : h < 17 ? 1 : h < 21.5 ? 2 : 3;
    steps.forEach((s, i) => s.classList.toggle('on', i === k));
  };
  const show = () => draw(hoverH ?? scrollH);
  // pointer: look at any hour
  const toH = (ev) => { const r = svg.getBoundingClientRect(); return clamp(((ev.clientX - r.left) / r.width * 800 - X0) / (X1 - X0) * 24, 0, 24); };
  svg.addEventListener('pointermove', (ev) => { hoverH = toH(ev); show(); });
  svg.addEventListener('pointerleave', () => { hoverH = null; show(); });
  if (!MOTION) { scrollH = 19.5; clip.setAttribute('width', '800'); show(); steps.forEach((s) => s.classList.add('on')); return; }
  headings(sec);
  const run = (p) => { scrollH = 5 + p * 18.5; show(); };
  run(0);
  const mm = G.matchMedia();
  mm.add('(min-width: 980px)', () => {
    ST.create({ trigger: sec, start: () => `top ${HEAD()}px`, end: () => `+=${Math.round(innerHeight * 1.6)}`, pin: true, refreshPriority: 2, onUpdate: (s) => run(s.progress) });
  });
  mm.add('(max-width: 979px)', () => {
    ST.create({ trigger: $('.day-fig', sec), start: 'top 75%', end: 'bottom 25%', onUpdate: (s) => run(s.progress) });
  });
}

/* ───────── 4. why the bill is so high ───────── */
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
    pin: true, scrub: 0.6, invalidateOnRefresh: true, refreshPriority: 1, onUpdate: (s) => { bar.style.transform = `scaleX(${0.15 + 0.85 * s.progress})`; } } });
  G.from($$('.step', sec), { y: 50, autoAlpha: 0, duration: 1, ease: 'expo.out', stagger: 0.08, scrollTrigger: { trigger: sec, start: 'top 70%' } });
}

/* ───────── 5½. customer videos, from the ERP (Website → Testimonials) ───────── */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
// only our own API's files, or https pictures — never javascript: or data: addresses from the data
const safeSrc = (u) => (typeof u === 'string' && (/^\/api\/public\/[\w./-]+$/.test(u) || /^https:\/\/[^\s"'<>]+$/.test(u)) ? u : '');
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z"/></svg>';
// a file video without a poster: a quiet array of panels on navy, in the diagrams' line style
const PANELS = `<svg viewBox="0 0 480 270" preserveAspectRatio="xMidYMid slice"><g transform="translate(118 150) skewX(-24)">${
  [0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5, 6].map((c) => `<rect x="${c * 51}" y="${r * 31}" width="46" height="26" rx="2"/>`).join('')).join('')}</g><path d="M40 252 H440"/></svg>`;
const storyWho = (t) => [t.name, t.place].filter(Boolean).join(', ');
function storyOk(t) {
  const v = t && t.video;
  return Boolean(t && String(t.name || '').trim() && v && ((v.type === 'youtube' && YT_ID.test(v.id || '')) || (v.type === 'file' && safeSrc(v.url))));
}
function storyPoster(t) {
  const v = t.video;
  const src = safeSrc(t.poster) || (v.type === 'youtube' ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : '');
  return `<button type="button" class="story-play" aria-label="Play the video from ${esc(storyWho(t))}">${src
    ? `<img src="${esc(src)}" alt="" width="480" height="270" loading="lazy" decoding="async">`
    : `<span class="story-ph" aria-hidden="true">${PANELS}</span>`}<span class="play-ico" aria-hidden="true">${PLAY}</span></button>`;
}
function storyCard(t, i) {
  const q = String(t.quote || '').trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '');
  return `<li class="story" data-i="${i}"><div class="story-media">${storyPoster(t)}</div>
    ${q ? `<blockquote class="story-q"><p>“${esc(q)}”</p></blockquote>` : ''}
    <div class="story-foot"><p class="story-who"><b>${esc(t.name)}</b>${t.place ? `<span>${esc(t.place)}</span>` : ''}</p>${t.system ? `<p class="story-sys">${esc(t.system)}</p>` : ''}</div></li>`;
}
function stories(list) {
  const sec = $('#stories'), rail = $('#story-list'), more = $('#story-more');
  if (!sec || !rail) return;
  const items = (Array.isArray(list) ? list : []).filter(storyOk);
  sec.hidden = !items.length;
  $$('[data-sec="stories"]').forEach((a) => { a.hidden = !items.length; });
  if (!items.length) { rail.innerHTML = ''; return; }
  sec.dataset.n = String(items.length);
  rail.innerHTML = items.map(storyCard).join('');
  // wide screens show six; the rest wait behind a button (phones swipe through all of them)
  const CLIP = 6;
  sec.classList.toggle('clip', items.length > CLIP);
  more.hidden = items.length <= CLIP;
  more.textContent = `Show all ${items.length} videos`;
  more.onclick = () => { sec.classList.remove('clip'); more.hidden = true; const b = $(`.story:nth-child(${CLIP + 1}) .story-play`, rail); if (b) b.focus(); if (MOTION) ST.refresh(); };

  const reset = (li) => { $('.story-media', li).innerHTML = storyPoster(items[Number(li.dataset.i)]); li.classList.remove('playing'); };
  // one video at a time: a file video just pauses, a YouTube player goes back to its poster
  const stopOthers = (keep) => $$('.story.playing', rail).forEach((li) => {
    if (li === keep) return;
    const vid = $('video', li);
    if (vid) vid.pause(); else reset(li);
  });
  const failed = (li, t) => {
    $('.story-media', li).innerHTML = `<div class="story-fail"><p>This video won’t play in this browser.</p><a href="${esc(t.video.url)}" target="_blank" rel="noopener">Open the video<span class="sr"> from ${esc(storyWho(t))} (opens in a new tab)</span></a></div>`;
  };
  const play = (li) => {
    const t = items[Number(li.dataset.i)], v = t.video;
    stopOthers(li);
    let el;
    if (v.type === 'youtube') {
      el = document.createElement('iframe');
      el.src = `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&playsinline=1`;
      el.title = `Video from ${storyWho(t)}`;
      el.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      el.allowFullscreen = true;
      el.referrerPolicy = 'strict-origin-when-cross-origin';
    } else {
      el = document.createElement('video');
      el.controls = true; el.playsInline = true; el.preload = 'none';
      el.setAttribute('playsinline', '');
      el.setAttribute('aria-label', `Video from ${storyWho(t)}`);
      if (safeSrc(t.poster)) el.poster = t.poster;
      const src = document.createElement('source');
      src.src = v.url;
      // a phone's .mov is usually plain H.264: Chrome plays it, but skips a source labelled video/quicktime — so let it look
      if (v.mime && v.mime !== 'video/quicktime') src.type = v.mime;
      src.addEventListener('error', () => failed(li, t));
      el.append(src);
      el.addEventListener('play', () => stopOthers(li));
    }
    $('.story-media', li).replaceChildren(el);
    li.classList.add('playing');
    el.focus({ preventScroll: true });
    if (el.tagName === 'VIDEO') el.play().catch(() => { /* the controls are there to try again */ });
  };
  rail.onclick = (e) => { const b = e.target.closest('.story-play'); if (b) play(b.closest('.story')); };
  if (MOTION) headings(sec);
}

/* ───────── 6. brands we deal with: from the ERP's Brands, with ribbons that drift with the scroll ───────── */
const CAT_ORDER = [/panel|module/i, /inverter/i, /batter|storage|\bess\b|\bups\b/i, /pump/i];
const catRank = (c) => { const i = CAT_ORDER.findIndex((r) => r.test(c)); return i < 0 ? CAT_ORDER.length : i; };
const brandItem = (b) => {
  const src = safeSrc(b.logo);
  return `<li>${src ? `<img class="blogo" src="${esc(src)}" alt="${esc(b.name)}" loading="lazy" decoding="async">` : esc(b.name)}</li>`;
};
function brandList(list) {
  const sec = $('#brands'), grid = $('#brand-grid');
  if (!sec || !grid || !Array.isArray(list)) return;            // the ERP didn't answer: the list in the page stays
  const items = list.filter((b) => b && String(b.name || '').trim());
  sec.hidden = !items.length;
  $$('[data-sec="brands"]').forEach((a) => { a.hidden = !items.length; });
  if (!items.length) return;
  // a column per category (panels, inverters, batteries, pumps first); a brand in two categories shows in both
  const groups = new Map();
  items.forEach((b) => {
    const cats = [...new Set((Array.isArray(b.categories) ? b.categories : []).map((c) => String(c).trim()).filter(Boolean))];
    (cats.length ? cats : ['']).forEach((c) => {
      const k = c.toLowerCase();
      if (!groups.has(k)) groups.set(k, { label: c, items: [] });
      groups.get(k).items.push(b);
    });
  });
  const named = [...groups.values()].filter((g) => g.label).sort((a, b) => catRank(a.label) - catRank(b.label) || a.label.localeCompare(b.label));
  if (!named.length) {
    grid.className = 'brand-grid flat';
    grid.innerHTML = `<ul>${items.map(brandItem).join('')}</ul>`;
  } else {
    if (groups.has('')) named.push({ label: 'More brands', items: groups.get('').items });
    grid.className = 'brand-grid';
    grid.innerHTML = named.map((g) => `<div class="bcol"><h3>${esc(g.label)}</h3><ul>${g.items.map(brandItem).join('')}</ul></div>`).join('');
  }
  // a logo that doesn't load becomes the brand's name
  $$('img.blogo', grid).forEach((img) => img.addEventListener('error', () => img.replaceWith(document.createTextNode(img.alt)), { once: true }));
  // the navy ribbon: every name, repeated until one copy is wider than a screen, then twice for the endless scroll
  const track = $('.r-a .track', sec);
  if (track) {
    const names = items.map((b) => String(b.name).trim());
    const one = Array.from({ length: Math.ceil(10 / names.length) }, () => names).flat();
    track.innerHTML = [...one, ...one].map((n) => `<span>${esc(n)}</span>`).join('');
    track.style.animationDuration = `${Math.max(30, Math.round(one.length * 5.3))}s`;
  }
}
function brands() {
  const sec = $('#brands');
  if (!sec || !MOTION) return;
  headings(sec);
  const drift = { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true };
  G.fromTo('.r-a', { xPercent: -6 }, { xPercent: 6, ease: 'none', scrollTrigger: drift });
  G.fromTo('.r-b', { xPercent: 6 }, { xPercent: -6, ease: 'none', scrollTrigger: { ...drift } });
  G.from('.ribbon', { scaleX: 0.6, autoAlpha: 0, duration: 1.2, ease: 'expo.out', stagger: 0.15, scrollTrigger: { trigger: sec, start: 'top 80%' } });
}

/* ───────── 7. why us: the words light up as you read ───────── */
function why() {
  const p = $('#why-text');
  if (!p) return;
  p.innerHTML = p.textContent.trim().split(/\s+/).map((w) => `<span class="wd">${esc(w)}</span>`).join(' ');
  const words = $$('.wd', p);
  $$('.pillar, .bcol').forEach((x, i) => { x.style.transitionDelay = `${(i % 4) * 90}ms`; });
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

/* ───────── start (in page order, so pinned sections measure correctly) ───────── */
film();
proof();
systems();
dayChart();
billChapter();
const left = subsidy();
calculator();
how();
brands();
why();
headings($('#faq'));
headings($('#contact'));
if (MOTION) {
  G.from($$('.faq details'), { y: 24, autoAlpha: 0, duration: 0.8, ease: 'expo.out', stagger: 0.05, scrollTrigger: { trigger: '.faq', start: 'top 85%' } });
  G.from($$('.final .quick, .final-lede, .reach > *'), { y: 30, autoAlpha: 0, duration: 1, ease: 'expo.out', stagger: 0.06, scrollTrigger: { trigger: '#contact', start: 'top 70%' } });
}
reveal();
mobileBar();
if (MOTION) addEventListener('load', () => ST.refresh());
// customer videos and brands from the ERP; the pinned sections below them measure again once they're in
site('site').then((s) => {
  stories(s.testimonials);
  brandList(s.brands);
  if (MOTION) ST.refresh();
});
schedulePopups('site', left > 0 ? [{ id: 'psg-2027', title: 'Up to ₹78,000 back on home solar', message: 'PM Surya Ghar subsidy — this phase runs till 31 March 2027. We do the paperwork for you.', cta_label: 'Get my free plan', cta_action: 'quote', kind: 'home', delay_seconds: 14 }] : []);
exitIntent({ id: 'exit', title: 'Before you go — a free site visit?', message: 'We’ll check your roof and EB bill and tell you exactly what solar will save.', cta_action: 'quote' });
if (store.get('sp_lead_at', 0)) document.documentElement.classList.add('has-lead');
