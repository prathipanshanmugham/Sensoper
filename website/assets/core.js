/* Sensoper website — shared by every page. No framework, no build step. */
const HOST = location.hostname;
export const LIVE = /(^|\.)sensoper\.in$/.test(HOST);
export const URLS = LIVE
  ? { home: 'https://sensoper.in/', shop: 'https://shop.sensoper.in/', account: 'https://sensoper.in/account/', erp: 'https://quote.sensoper.in/login' }
  : { home: '/', shop: '/shop/', account: '/account/', erp: `${location.protocol}//${HOST}:3000/login` };

export const ICON = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 19.5l1.3-3.8A8 8 0 1 1 8.4 18.6z"/><path d="M9.2 9.2c.3 1.9 2 3.6 3.9 4.1l1.1-1 1.7.8-.4 1.4c-3.5.2-6.9-3.2-6.8-6.6l1.4-.4.8 1.7z" fill="currentColor" stroke="none"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  calc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/></svg>',
};

/* ───────── storage that never throws (private windows, blocked storage) ───────── */
export const store = {
  get(k, d = null, s = localStorage) { try { const v = s.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const session = (() => { try { return sessionStorage; } catch { return localStorage; } })();

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
    const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('. ') : r.status >= 500 ? 'Something went wrong on our side. Please try again, or call us.' : 'That didn’t work. Please try again.';
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return data;
}

/* ───────── company details, WhatsApp, links ───────── */
let SITE = { company: { name: 'Sensoper Controls & Renewables', phone: '9043547047', whatsapp: '9043547047', email: 'info@sensoper.com' }, popups: [], prices: null, shop: { products: 0 } };
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

/* ───────── header ───────── */
function header() {
  const top = $('.top');
  if (top) {
    const on = () => top.classList.toggle('scrolled', scrollY > 8 || top.hasAttribute('data-solid'));
    on(); addEventListener('scroll', on, { passive: true });
  }
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

/* ───────── the lead form — every "Get a quote" button on the site opens this ───────── */
const KINDS = [['home', 'Home'], ['farm', 'Farm / pump'], ['business', 'Business'], ['battery', 'Battery / UPS'], ['service', 'Service / AMC'], ['other', 'Something else']];
let leadCtx = {};
export function openLead(ctx = {}) {
  leadCtx = { kind: 'home', source: 'quote', ...ctx };
  const d = sheet('lead-sheet', `
    <div class="sheet-head"><div><h2 id="lead-title">Get your free quote</h2><p id="lead-sub">Leave your number and our team will call you back.</p></div>
      <button type="button" class="x-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <form class="form" id="lead-form" novalidate>
      <div class="calc-chip" id="lead-calc" hidden></div>
      <label class="fld"><span>Your name</span><input class="input" name="name" autocomplete="name" maxlength="80" required></label>
      <label class="fld"><span>Mobile number</span><span class="phone-in"><span>+91</span><input class="input" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" required></span></label>
      <div class="form-row two">
        <label class="fld"><span>Area or town</span><input class="input" name="area" autocomplete="address-level2" maxlength="80" placeholder="e.g. Perundurai"></label>
        <label class="fld"><span>PIN code <em>(optional)</em></span><input class="input" name="pincode" inputmode="numeric" maxlength="6" autocomplete="postal-code"></label>
      </div>
      <div class="fld"><span id="kind-l">What’s it for?</span><div class="chips" role="radiogroup" aria-labelledby="kind-l">${KINDS.map(([k, l]) => `<button type="button" class="chip" role="radio" data-kind="${k}" aria-checked="false">${l}</button>`).join('')}</div></div>
      <label class="fld"><span>Anything else? <em>(optional)</em></span><textarea class="input" name="message" rows="2" maxlength="1000" placeholder="Roof type, best time to call…"></textarea></label>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="form-err" role="alert"></p>
      <button class="btn btn-leaf btn-lg btn-block" type="submit">Call me back</button>
      <p class="fine">We use your number only to talk to you about your enquiry.</p>
    </form>
    <div class="done" id="lead-done" hidden></div>`);
  const f = $('#lead-form', d), done = $('#lead-done', d);
  if (!f.dataset.ready) {
    f.dataset.ready = '1';
    $$('[data-kind]', f).forEach((b) => b.addEventListener('click', () => pickKind(f, b.dataset.kind)));
    f.addEventListener('submit', (e) => { e.preventDefault(); submitLead(f, d); });
  }
  f.hidden = false; done.hidden = true; $('.sheet-head', d).hidden = false;
  $('.form-err', f).textContent = '';
  const me = store.get('sp_me', {});
  if (!f.name.value && me.name) f.name.value = me.name;
  if (!f.phone.value && me.phone) f.phone.value = me.phone;
  if (!f.area.value && me.area) f.area.value = me.area;
  pickKind(f, leadCtx.kind);
  $('#lead-title', d).textContent = leadCtx.title || 'Get your free quote';
  $('#lead-sub', d).textContent = leadCtx.sub || 'Leave your number and our team will call you back.';
  const chip = $('#lead-calc', d);
  chip.hidden = !leadCtx.calcLine;
  if (leadCtx.calcLine) chip.innerHTML = `${ICON.calc}<span>${esc(leadCtx.calcLine)} — we’ll send these figures with your quote</span>`;
  openSheet(d);
  setTimeout(() => (f.name.value ? f.phone : f.name).focus({ preventScroll: true }), 60);
}
function pickKind(f, kind) {
  $$('[data-kind]', f).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === kind)));
  f.dataset.kind = kind;
}
async function submitLead(f, d) {
  const err = $('.form-err', f), btn = $('[type=submit]', f);
  err.textContent = ''; $$('[aria-invalid]', f).forEach((i) => i.removeAttribute('aria-invalid'));
  const name = f.name.value.trim(), phone = mobile(f.phone.value);
  if (name.length < 2) { f.name.setAttribute('aria-invalid', 'true'); err.textContent = 'Tell us your name.'; f.name.focus(); return; }
  if (!phone) { f.phone.setAttribute('aria-invalid', 'true'); err.textContent = 'Enter your 10-digit mobile number.'; f.phone.focus(); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await api('/api/public/leads', { method: 'POST', body: {
      name, phone, area: f.area.value, pincode: f.pincode.value, kind: f.dataset.kind || 'home', message: f.message.value,
      source: leadCtx.source, calc: leadCtx.calc || null, page: location.pathname + location.hash, utm: utm(), website: f.website.value } });
    store.set('sp_me', { name, phone, area: f.area.value.trim() });
    store.set('sp_lead_at', Date.now());
    const first = name.split(' ')[0];
    const ref = r.number ? ` (${r.number})` : '';
    const done = $('#lead-done', d);
    done.innerHTML = `<div class="done-ico">${ICON.check}</div><h2>Thanks, ${esc(first)}!</h2>
      <p class="muted">We’ve got your request${esc(ref)}. Our team will call you on <b>+91 ${phone.slice(0, 5)} ${phone.slice(5)}</b>.</p>
      <a class="btn btn-wa btn-lg btn-block" target="_blank" rel="noopener" href="${waLink(`Hi Sensoper, I just asked for a quote on your website${ref}. My name is ${name}.`)}">${ICON.chat}Chat on WhatsApp now</a>
      <button type="button" class="btn btn-ghost btn-block" data-close>Close</button>`;
    f.hidden = true; done.hidden = false; $('.sheet-head', d).hidden = true;
    f.message.value = '';
    document.dispatchEvent(new CustomEvent('sp:lead', { detail: r }));
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Call me back';
  }
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
  if (document.querySelector('dialog[open]') || document.visibilityState !== 'visible') { setTimeout(pump, 1500); return; }
  const n = queue.shift();
  if (!notifBox) { notifBox = document.createElement('div'); notifBox.className = 'notifs'; notifBox.setAttribute('aria-live', 'polite'); document.body.append(notifBox); }
  showing = true;
  store.set('sp_pop_n', shownThisVisit() + 1, session);
  const el = document.createElement('div');
  el.className = 'notif'; el.setAttribute('role', 'status');
  const act = n.cta_action && n.cta_action !== 'none' ? (n.cta_label || ({ quote: 'Get a free quote', whatsapp: 'Chat on WhatsApp', shop: 'Open the shop', link: 'Open' })[n.cta_action]) : '';
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
  if (n.cta_action === 'quote') openLead({ source: 'popup', kind: n.kind || 'home', title: n.title.length < 40 ? n.title : undefined });
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

/** Desktop only: when the pointer heads for the tab bar, offer a call-back once a week (never after a lead). */
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
    openLead({ kind: b.dataset.lead || 'home', source: b.dataset.source || 'quote', title: b.dataset.title, sub: b.dataset.sub });
  });
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();
}
