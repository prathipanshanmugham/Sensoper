/* Sensoper website — shared by every page. No framework, no build step. */
const HOST = location.hostname;
// LIVE: the site has its own addresses (sensoper.in, www and shop). Anywhere else every page is on this one host:
// quote.sensoper.in, where the site and the ERP share one address until sensoper.in's DNS moves, or a dev machine.
export const LIVE = /^((www|shop)\.)?sensoper\.in$/.test(HOST);
const WITH_ERP = /(^|\.)sensoper\.in$/.test(HOST);
export const URLS = LIVE
  ? { home: 'https://sensoper.in/', shop: 'https://shop.sensoper.in/', account: 'https://sensoper.in/account/', erp: 'https://quote.sensoper.in/login' }
  : { home: '/', shop: '/shop/', account: '/account/', erp: WITH_ERP ? '/login' : `${location.protocol}//${HOST}:3000/login` };

export const ICON = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 19.5l1.3-3.8A8 8 0 1 1 8.4 18.6z"/><path d="M9.2 9.2c.3 1.9 2 3.6 3.9 4.1l1.1-1 1.7.8-.4 1.4c-3.5.2-6.9-3.2-6.8-6.6l1.4-.4.8 1.7z" fill="currentColor" stroke="none"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  calc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5c3.2 4 5.5 7.2 5.5 10a5.5 5.5 0 0 1-11 0c0-2.8 2.3-6 5.5-10z"/></svg>',
  factory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 20V10l5 3V10l5 3V5h4v15z"/><path d="M3 20h18"/></svg>',
  battery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10.5v3M11 9l-2 3h4l-2 3"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14.5 6.5a4 4 0 0 0-5.3 5.2L4 17l3 3 5.3-5.2a4 4 0 0 0 5.2-5.3l-2.4 2.4-2.8-.6-.6-2.8z"/></svg>',
};

/* ───────── storage that never throws (private windows, blocked storage, sandboxed previews) ───────── */
const safeStore = (name) => { try { const s = window[name]; s.getItem('_'); return s; } catch { return null; } };
const LS = safeStore('localStorage');
const SS = safeStore('sessionStorage') || LS;
export const store = {
  get(k, d = null, s = LS) { try { if (!s) return d; const v = s.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v, s = LS) { try { if (s) s.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const session = SS;

/* ───────── formatting ───────── */
export const inr = (n, { short = false } = {}) => {
  n = Math.round(Number(n) || 0);
  if (short && n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '')} Cr`;
  if (short && n >= 1e5) return `₹${(n / 1e5).toFixed(n >= 1e6 ? 1 : 2).replace(/\.?0+$/, '')} lakh`;
  return '₹' + n.toLocaleString('en-IN');
};
export const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const mobile = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); if (d.length === 11 && d[0] === '0') d = d.slice(1); return /^[6-9]\d{9}$/.test(d) ? d : null; };
export const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/* ───────── solar sums (shared by the calculator and the quiz) ───────── */
// TNEB domestic, bimonthly, telescopic — the same slabs as the ERP's calculator
const SLABS = [[100, 0], [200, 2.35], [400, 4.7], [500, 6.3], [600, 8.4], [800, 9.45], [1000, 10.5], [Infinity, 11.55]];
export const YIELD = 4.4;                 // units per kW per day around Erode
export const PANEL_W = 550;
export const LIFE = Array.from({ length: 25 }, (_, i) => Math.pow(0.993, i)).reduce((a, b) => a + b, 0);
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
export const subsidyFor = (kw) => Math.round(Math.min(kw, 2) * 30000 + Math.min(Math.max(kw - 2, 0), 1) * 18000);
export function homeEstimate(bill) {
  const units = unitsFor(bill);
  const kw = Math.min(Math.max(Math.round(units / (60 * YIELD) * 2) / 2, 1), 10);
  const after = billFor(Math.max(units - kw * YIELD * 60, 0));
  return { mode: 'home', bill, units: Math.round(units), kw, monthly: Math.round(Math.max(bill - after, 0) / 2), subsidy: subsidyFor(kw), after: Math.round(after) };
}
export function businessEstimate(bill) {
  const units = bill / 9;
  const kw = Math.min(Math.max(Math.round(units / (30 * YIELD)), 3), 500);
  return { mode: 'business', bill, units: Math.round(units), kw, monthly: Math.round(Math.min(kw * YIELD * 30 / units, 1) * bill * 0.95) };
}
export const PUMP_KW = { 3: 3, 5: 4.8, 7.5: 6.75, 10: 9.3 };

/* ───────── API ───────── */
export async function api(path, { method = 'GET', body, signal } = {}) {
  let r;
  try {
    r = await fetch(path, { method, signal, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('No connection. Check your internet and try again.');
  }
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    const d = data && data.detail;
    const msg = typeof d === 'string' ? d : Array.isArray(d) ? 'Please check what you typed and try again.' : r.status >= 500 ? 'Something went wrong on our side. Please try again, or call us.' : 'That didn’t work. Please try again.';
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return data;
}

/* ───────── company details, WhatsApp, links ───────── */
let SITE = { company: { name: 'Sensoper Controls & Renewables', phone: '9043547047', whatsapp: '9043547047', email: 'info@sensoper.in' }, popups: [], prices: null, shop: { products: 0 } };
let sitePromise = null;
export function site(where = 'site') {
  if (!sitePromise) {
    const cached = store.get('sp_site_' + where, null, session);
    sitePromise = (cached && Date.now() - cached.t < 5 * 60e3 ? Promise.resolve(cached.d) : api(`/api/public/site?where=${where}`).then((d) => { store.set('sp_site_' + where, { t: Date.now(), d }, session); return d; }))
      .then((d) => { SITE = { ...SITE, ...d, company: { ...SITE.company, ...Object.fromEntries(Object.entries(d.company || {}).filter(([, v]) => v)) } }; applyContacts(); return SITE; })
      .catch(() => SITE);
  }
  return sitePromise;
}
export const company = () => SITE.company;
export const waLink = (text) => `https://wa.me/91${SITE.company.whatsapp || SITE.company.phone}?text=${encodeURIComponent(text || 'Hi Sensoper, I’d like to know more about solar for my place.')}`;

function applyContacts() {
  const c = SITE.company;
  $$('[data-wa]').forEach((a) => { a.href = waLink(a.dataset.wa || undefined); a.target = '_blank'; a.rel = 'noopener'; });
  $$('[data-call]').forEach((a) => { a.href = `tel:+91${c.phone}`; if (a.hasAttribute('data-call-text')) a.textContent = `+91 ${c.phone.slice(0, 5)} ${c.phone.slice(5)}`; });
  $$('[data-email]').forEach((a) => { if (c.email) { a.href = `mailto:${c.email}`; if (a.hasAttribute('data-email-text')) a.textContent = c.email; } });
}
function rewriteLinks() {
  if (LIVE) return;
  $$('a[data-to]').forEach((a) => { const hash = a.hash || ''; a.href = URLS[a.dataset.to] + hash; });
}

/* ───────── where visitors came from (first touch, this visit) ───────── */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
(function captureUtm() {
  const q = new URLSearchParams(location.search);
  const got = Object.fromEntries(UTM_KEYS.filter((k) => q.get(k)).map((k) => [k, q.get(k).slice(0, 120)]));
  if (Object.keys(got).length && !store.get('sp_utm', null, session)) store.set('sp_utm', got, session);
})();
export const utm = () => store.get('sp_utm', {}, session) || {};

/* ───────── toast ───────── */
let toastEl, toastT;
export function toast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.append(toastEl); }
  toastEl.textContent = msg;
  requestAnimationFrame(() => toastEl.classList.add('in'));
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('in'), 3200);
}

/* ───────── header: shadow and reading progress ───────── */
function header() {
  const top = $('.top'), bar = $('.progress i');
  const on = () => {
    if (top) top.classList.toggle('scrolled', scrollY > 8);
    if (bar) { const h = document.documentElement.scrollHeight - innerHeight; bar.style.transform = `scaleX(${h > 0 ? Math.min(scrollY / h, 1) : 0})`; }
  };
  on(); addEventListener('scroll', on, { passive: true });
  const btn = $('.menu-btn'), nav = $('#mnav');
  if (btn && nav) {
    btn.addEventListener('click', () => { const open = nav.hidden; nav.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
    nav.addEventListener('click', (e) => { if (e.target.closest('a,button')) { nav.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  }
}

/* ───────── sheets (native <dialog>) ───────── */
export function sheet(id, html) {
  let d = document.getElementById(id);
  if (!d) {
    d = document.createElement('dialog'); d.id = id; d.className = 'sheet';
    d.innerHTML = `<div class="sheet-in"><div class="sheet-grab" aria-hidden="true"></div>${html}</div>`;
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    document.body.append(d);
  }
  return d;
}
export function openSheet(d) {
  if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
}

/* ───────── the free solar plan — a 3-tap quiz behind every quote button ───────── */
const KIND_OPTS = [
  ['home', 'My home', 'Cut the EB bill, up to ₹78,000 subsidy', 'home'],
  ['farm', 'My farm pump', 'Run the pump on sunshine, not diesel', 'drop'],
  ['business', 'Factory, shop or office', 'Lower running costs every month', 'factory'],
  ['battery', 'Backup for power cuts', 'Battery, inverter or UPS', 'battery'],
  ['service', 'Service for my system', 'Cleaning, AMC or a repair', 'wrench'],
];
const BILL_OPTS = {
  home: { q: 'Your last EB bill?', help: 'TNEB bills come every two months — the total from your latest one.', opts: [['Under ₹1,000', 700], ['₹1,000 – 3,000', 2000], ['₹3,000 – 6,000', 4500], ['₹6,000 – 10,000', 8000], ['Over ₹10,000', 13000], ['Not sure', null]] },
  business: { q: 'Your monthly EB bill?', help: 'For one month.', opts: [['Under ₹20,000', 12000], ['₹20,000 – 50,000', 35000], ['₹50,000 – 1 lakh', 75000], ['₹1 – 3 lakh', 200000], ['Over ₹3 lakh', 400000], ['Not sure', null]] },
  farm: { q: 'How big is your pump?', help: 'The motor’s horsepower.', opts: [['3 HP', 3], ['5 HP', 5], ['7.5 HP', 7.5], ['10 HP', 10], ['Bigger', 15], ['Not sure', null]] },
  battery: { q: 'What should keep running in a power cut?', help: '', opts: [['Lights and fans', 1], ['Most of the house', 2], ['Shop or office', 3], ['Not sure', null]] },
};
let Q = {};
function estimateLine(q) {
  if (q.kind === 'home' && q.value) { const e = homeEstimate(q.value); return { line: `Homes with this bill usually need about <b>${fmt(e.kw, 1)} kW</b> and save about <b>${inr(e.monthly)} a month</b>, with up to <b>${inr(e.subsidy)}</b> subsidy.`, calc: { mode: 'home', bill: e.bill, units: e.units, kw: e.kw, subsidy: e.subsidy, monthly_saving: e.monthly } }; }
  if (q.kind === 'business' && q.value) { const e = businessEstimate(q.value); return { line: `A site with this bill usually needs about <b>${fmt(e.kw)} kW</b> and saves about <b>${inr(e.monthly, { short: true })} a month</b>.`, calc: { mode: 'business', bill: e.bill, units: e.units, kw: e.kw, monthly_saving: e.monthly } }; }
  if (q.kind === 'farm' && q.value) { const kw = PUMP_KW[q.value] || Math.round(q.value * 0.93 * 10) / 10; return { line: `A ${q.value} HP pump runs on about <b>${fmt(kw, 1)} kW</b> of panels — no diesel, water all day.`, calc: { mode: 'farm', pump_hp: q.value, kw } }; }
  return null;
}
export function openLead(ctx = {}) {
  const me = store.get('sp_me', {});
  Q = { source: 'quiz', ...ctx, name: me.name || '', phone: ctx.phone || me.phone || '', area: me.area || '' };
  if (ctx.calc) { Q.kind = ctx.calc.mode || ctx.kind || 'home'; Q.step = 'you'; }
  else if (ctx.kind && ctx.kind !== 'quiz') { Q.kind = ctx.kind; Q.step = BILL_OPTS[ctx.kind] ? 'bill' : 'you'; }   // 'other' and 'service' go straight to the details
  else Q.step = 'kind';
  const d = sheet('lead-sheet', '<div id="quiz"></div>');
  renderQuiz(d);
  openSheet(d);
}
const STEPS = ['kind', 'bill', 'you'];
function renderQuiz(d) {
  const box = $('#quiz', d);
  const n = STEPS.indexOf(Q.step) + 1;
  const back = (Q.step === 'bill' && !Q.lockKind) || (Q.step === 'you' && !Q.calc);
  const head = (title, sub) => `<div class="sheet-head"><div>${Q.step !== 'done' ? `<p class="q-step">${back ? `<button type="button" class="q-back" data-back aria-label="Back">${ICON.back}</button>` : ''}Step ${n} of 3</p>` : ''}<h2 id="lead-title">${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>
    <button type="button" class="x-btn" data-close aria-label="Close">${ICON.close}</button></div>${Q.step !== 'done' ? `<div class="q-bar"><i style="width:${(n / 3) * 100}%"></i></div>` : ''}`;
  if (Q.step === 'kind') {
    box.innerHTML = head(Q.title || 'Your free solar plan', Q.saved ? 'We’ve saved your number. Three quick taps and we’ll make your plan.' : 'Three quick taps. Then our team calls you with a plan and a price.')
      + `<div class="q-opts">${KIND_OPTS.map(([k, l, s, i]) => `<button type="button" class="q-opt" data-kind="${k}"><span class="q-ico">${ICON[i]}</span><span><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>`;
  } else if (Q.step === 'bill') {
    const b = BILL_OPTS[Q.kind];
    box.innerHTML = head(b.q, b.help) + `<div class="q-chips">${b.opts.map(([l, v], i) => `<button type="button" class="q-chip" data-bill="${i}">${l}</button>`).join('')}</div>`;
  } else if (Q.step === 'you') {
    const est = Q.calc ? { line: Q.calcLine ? esc(Q.calcLine) : '', calc: Q.calc } : estimateLine(Q);
    Q.est = est;
    box.innerHTML = head(Q.kind === 'service' ? (Q.title || 'Book a service visit') : 'Where should we call you?', Q.kind === 'service' ? 'Tell us what’s wrong — we’ll call you back.' : 'Our team calls to fix a free site visit. No spam.')
      + (est && est.line ? `<div class="q-est">${ICON.sun}<p>${est.line}</p></div>` : '')
      + `<form class="form" id="lead-form" novalidate>
      <label class="fld"><span>Your name</span><input class="input" name="name" autocomplete="name" maxlength="80" value="${esc(Q.name)}"></label>
      <label class="fld"><span>Mobile number</span><span class="phone-in"><span>+91</span><input class="input" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" value="${esc(Q.phone)}"></span></label>
      <div class="form-row two">
        <label class="fld"><span>Area or town</span><input class="input" name="area" autocomplete="address-level2" maxlength="80" placeholder="e.g. Perundurai" value="${esc(Q.area)}"></label>
        <label class="fld"><span>PIN code <em>(optional)</em></span><input class="input" name="pincode" inputmode="numeric" maxlength="6" autocomplete="postal-code"></label>
      </div>
      ${Q.kind === 'service' || Q.kind === 'battery' || Q.kind === 'other' ? '<label class="fld"><span>Anything else? <em>(optional)</em></span><textarea class="input" name="message" rows="2" maxlength="1000"></textarea></label>' : ''}
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="form-err" role="alert"></p>
      <button class="btn btn-leaf btn-lg btn-block" type="submit">${Q.kind === 'service' ? 'Book my visit' : 'Get my free solar plan'}</button>
      <p class="fine">We use your number only to talk to you about your enquiry.</p></form>`;
    const f = $('#lead-form', box);
    f.addEventListener('submit', (e) => { e.preventDefault(); submitQuiz(f, d); });
    setTimeout(() => (f.name.value ? (f.phone.value ? f.area : f.phone) : f.name).focus({ preventScroll: true }), 80);
  }
  $$('[data-kind]', box).forEach((b) => b.addEventListener('click', () => { Q.kind = b.dataset.kind; Q.step = BILL_OPTS[Q.kind] ? 'bill' : 'you'; renderQuiz(d); }));
  $$('[data-bill]', box).forEach((b) => b.addEventListener('click', () => { const [l, v] = BILL_OPTS[Q.kind].opts[Number(b.dataset.bill)]; Q.billLabel = l; Q.value = v; Q.step = 'you'; renderQuiz(d); }));
  const bk = $('[data-back]', box);
  if (bk) bk.addEventListener('click', () => { Q.step = Q.step === 'you' && BILL_OPTS[Q.kind] ? 'bill' : 'kind'; renderQuiz(d); });
}
async function submitQuiz(f, d) {
  const err = $('.form-err', f), btn = $('[type=submit]', f);
  err.textContent = ''; $$('[aria-invalid]', f).forEach((i) => i.removeAttribute('aria-invalid'));
  const name = f.name.value.trim(), phone = mobile(f.phone.value);
  if (name.length < 2) { f.name.setAttribute('aria-invalid', 'true'); err.textContent = 'Tell us your name.'; f.name.focus(); return; }
  if (!phone) { f.phone.setAttribute('aria-invalid', 'true'); err.textContent = 'Enter your 10-digit mobile number.'; f.phone.focus(); return; }
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
  const answer = Q.billLabel ? `${BILL_OPTS[Q.kind].q.replace('?', '')}: ${Q.billLabel}` : '';
  try {
    const r = await api('/api/public/leads', { method: 'POST', body: {
      name, phone, area: f.area.value, pincode: f.pincode.value, kind: Q.kind || 'home', message: [Q.note, answer, f.message ? f.message.value : ''].filter(Boolean).join(' — '),
      source: Q.source || 'quiz', calc: (Q.est && Q.est.calc) || null, page: location.pathname + location.hash, utm: utm(), website: f.website.value } });
    store.set('sp_me', { name, phone, area: f.area.value.trim() });
    store.set('sp_lead_at', Date.now());
    const first = name.split(' ')[0];
    const ref = r.number ? ` (${r.number})` : '';
    Q.step = 'done';
    $('#quiz', d).innerHTML = `<div class="sheet-head"><div></div><button type="button" class="x-btn" data-close aria-label="Close">${ICON.close}</button></div>
      <div class="done"><div class="done-ico">${ICON.check}</div><h2>Your free solar plan is on its way, ${esc(first)}!</h2>
      <p class="muted">We’ve got your request${esc(ref)}. Our team will call you on <b>+91 ${phone.slice(0, 5)} ${phone.slice(5)}</b> to fix a free site visit.</p>
      ${Q.kind !== 'service' ? '<p class="muted small">Want it faster? Send us a photo of your EB bill on WhatsApp.</p>' : ''}
      <a class="btn btn-wa btn-lg btn-block" target="_blank" rel="noopener" href="${waLink(`Hi Sensoper, I just asked for my free solar plan on your website${ref}. My name is ${name}${f.area.value ? `, from ${f.area.value}` : ''}.`)}">${ICON.chat}Chat on WhatsApp now</a>
      <button type="button" class="btn btn-ghost btn-block" data-close>Close</button></div>`;
    document.dispatchEvent(new CustomEvent('sp:lead', { detail: r }));
  } catch (e) {
    err.textContent = e.message; btn.disabled = false; btn.textContent = label;
  }
}

/** The one-box form ("your mobile number → my free plan"): saves the number first, then opens the quiz. */
export function bindQuick(form) {
  if (!form) return;
  const me = store.get('sp_me', {});
  if (me.phone && !form.phone.value) form.phone.value = me.phone;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.quick-err', form.parentElement) || $('.quick-err');
    const phone = mobile(form.phone.value);
    if (err) err.textContent = '';
    if (!phone) { if (err) err.textContent = 'Enter your 10-digit mobile number.'; form.phone.focus(); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); return; }
    const btn = $('button', form); btn.disabled = true;
    let saved = false;
    try {
      if (!form.website || !form.website.value) {
        await api('/api/public/leads', { method: 'POST', body: { phone, source: 'quick', kind: 'home', page: location.pathname, utm: utm() } });
        saved = true;
      }
    } catch { /* the quiz still collects it */ }
    btn.disabled = false;
    store.set('sp_me', { ...store.get('sp_me', {}), phone });
    openLead({ phone, saved });
  });
}

/* ───────── pop-up notifications (phone-style banners) ───────── */
let notifBox; const queue = []; let showing = false;
const SEEN_DAYS = 3;
const seen = (id) => { const t = (store.get('sp_seen', {}) || {})[id]; return t && Date.now() - t < SEEN_DAYS * 864e5; };
const markSeen = (id) => { const s = store.get('sp_seen', {}) || {}; s[id] = Date.now(); store.set('sp_seen', s); };
const shownThisVisit = () => store.get('sp_pop_n', 0, session) || 0;

export function notify(n, { force = false } = {}) {
  if (!force && (seen(n.id) || shownThisVisit() >= 2)) return;
  queue.push(n); pump();
}
function pump() {
  if (showing || !queue.length) return;
  if (document.querySelector('dialog[open]') || document.visibilityState === 'hidden') { setTimeout(pump, 1500); return; }
  const n = queue.shift();
  if (!notifBox) { notifBox = document.createElement('div'); notifBox.className = 'notifs'; notifBox.setAttribute('aria-live', 'polite'); document.body.append(notifBox); }
  showing = true;
  store.set('sp_pop_n', shownThisVisit() + 1, session);
  const el = document.createElement('div');
  el.className = 'notif'; el.setAttribute('role', 'status');
  const act = n.cta_action && n.cta_action !== 'none' ? (n.cta_label || ({ quote: 'Get my free plan', whatsapp: 'Chat on WhatsApp', shop: 'Open the shop', link: 'Open' })[n.cta_action]) : '';
  el.innerHTML = `<div class="notif-ico">${ICON.sun}</div><div><div class="notif-top">Sensoper <span>now</span></div><b>${esc(n.title)}</b>${n.message ? `<p>${esc(n.message)}</p>` : ''}${act ? `<button type="button" class="btn btn-leaf btn-sm" data-act>${esc(act)}</button>` : ''}</div>
    <button type="button" class="notif-x" aria-label="Dismiss">${ICON.close}</button>`;
  notifBox.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  let t, hovering = false;
  const close = () => { clearTimeout(t); markSeen(n.id); el.classList.remove('in'); setTimeout(() => { el.remove(); showing = false; setTimeout(pump, 800); }, 350); };
  const arm = () => { clearTimeout(t); t = setTimeout(() => (hovering ? arm() : close()), 14000); };
  el.addEventListener('mouseenter', () => { hovering = true; }); el.addEventListener('mouseleave', () => { hovering = false; });
  el.addEventListener('focusin', () => { hovering = true; });
  $('.notif-x', el).addEventListener('click', close);
  const b = $('[data-act]', el);
  if (b) b.addEventListener('click', () => { close(); runAction(n); });
  arm();
}
function runAction(n) {
  if (n.cta_action === 'quote') openLead({ source: 'popup', kind: n.kind });
  else if (n.cta_action === 'whatsapp') window.open(waLink(`Hi Sensoper — about “${n.title}”`), '_blank', 'noopener');
  else if (n.cta_action === 'shop') location.href = URLS.shop;
  else if (n.cta_action === 'link' && n.cta_url) location.href = n.cta_url;
  else if (n.cta_action === 'scroll' && n.cta_url) document.querySelector(n.cta_url)?.scrollIntoView({ behavior: 'smooth' });
}

/** Pop-ups staff made in the ERP, plus the page's own (each after its delay, while the page is open). */
export async function schedulePopups(where, builtIn = []) {
  const s = await site(where);
  const all = [...(s.popups || []).map((p) => ({ ...p, id: 'erp-' + p.id })), ...builtIn];
  all.forEach((p) => setTimeout(() => notify(p), Math.max(0, (p.delay_seconds ?? 6) * 1000)));
}

/** Desktop only: when the pointer heads for the tab bar, offer the free plan once a week (never after a lead). */
export function exitIntent(n) {
  if (!matchMedia('(pointer:fine)').matches) return;
  const start = Date.now();
  const onOut = (e) => {
    if (e.clientY > 0 || e.relatedTarget || Date.now() - start < 12000) return;
    const last = store.get('sp_lead_at', 0);
    if (last && Date.now() - last < 30 * 864e5) return;
    const ex = store.get('sp_exit_at', 0);
    if (ex && Date.now() - ex < 7 * 864e5) return;
    store.set('sp_exit_at', Date.now());
    document.removeEventListener('mouseout', onOut);
    notify(n, { force: true });
  };
  document.addEventListener('mouseout', onOut);
}

/** Things that rise into view as you scroll — for pages without the big animation library. */
export function reveal(selector = '[data-reveal]') {
  const els = $$(selector);
  if (!('IntersectionObserver' in window) || reduceMotion()) { els.forEach((e) => e.classList.add('shown')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('shown'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
}

/* ───────── start ───────── */
export function boot(where = 'site') {
  rewriteLinks();
  header();
  applyContacts();
  site(where);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lead]');
    if (!b) return;
    e.preventDefault();
    openLead({ kind: b.dataset.lead || 'quiz', source: b.dataset.source || 'quiz', title: b.dataset.title, note: b.dataset.note });
  });
  $$('form[data-quick]').forEach(bindQuick);
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();
}
