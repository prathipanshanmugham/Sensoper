/* shop.sensoper.in — live products from the ERP, a cart in this browser, and an order request staff confirm.
   Served at / on shop.sensoper.in and at /shop/ on quote.sensoper.in: every file and API path here is absolute (/assets/…, /api/…). */
import { $, $$, boot, api, site, inr, fmt, esc, store, mobile, sheet, openSheet, toast, waLink, utm, schedulePopups, ICON } from './core.js';

boot('shop');

/* pick-up stores: the ERP's locations with pick-up turned on. None set up → pick-up "from our office", as before. */
let STORES = [];
const storesReady = site('shop').then((s) => { STORES = (Array.isArray(s.stores) ? s.stores : []).filter((x) => x && x.id && x.name); });
const hasXY = (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && !(s.lat === 0 && s.lng === 0);
function km(a, b) {                       // straight-line distance (haversine)
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const away = (d) => (d < 1 ? 'less than 1 km away' : `about ${fmt(d < 10 ? Math.round(d * 10) / 10 : Math.round(d), 1)} km away`);
function phoneOf(p) {
  const d = String(p || '').replace(/\D/g, ''), m = mobile(d);
  if (m) return { href: `tel:+91${m}`, text: `+91 ${m.slice(0, 5)} ${m.slice(5)}` };
  if (d.length < 6) return null;
  return { href: `tel:+91${d.replace(/^0/, '')}`, text: d.startsWith('0') ? d : `0${d}` };
}
const httpsOnly = (u) => (/^https:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : '');
const LOCATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>';
function storeHtml(s, checked) {
  const ph = phoneOf(s.phone), dir = httpsOnly(s.directions);
  return `<div class="store" data-store="${esc(s.id)}">
    <label class="store-pick"><input type="radio" name="store_id" value="${esc(s.id)}"${checked ? ' checked' : ''}>
      <span class="store-txt"><b>${esc(s.name)}</b><span class="store-dist"></span>${s.address ? `<span>${esc(s.address)}</span>` : ''}${s.hours ? `<span>${esc(s.hours)}</span>` : ''}</span></label>
    ${ph || dir ? `<div class="store-links">${ph ? `<a href="${ph.href}">Call ${esc(ph.text)}</a>` : ''}${dir ? `<a href="${esc(dir)}" target="_blank" rel="noopener">Directions<span class="sr"> to ${esc(s.name)}, opens Google Maps</span></a>` : ''}</div>` : ''}
  </div>`;
}
function storePicker() {
  if (!STORES.length) return '';
  const one = STORES.length === 1, near = !one && STORES.some(hasXY);
  return `<fieldset class="stores" id="store-f" hidden><legend>${one ? 'Pick it up from' : 'Which store will you pick it up from?'}</legend>
    ${near ? `<div class="store-near"><button type="button" class="btn btn-ghost btn-sm" data-near>${LOCATE}Find the nearest store</button></div>` : ''}
    <p class="store-msg" role="status"></p>
    <div class="store-list">${STORES.map((s) => storeHtml(s, one)).join('')}</div></fieldset>`;
}
function findNearest(f) {
  const msg = $('.store-msg', f), btn = $('[data-near]', f);
  if (!('geolocation' in navigator)) { msg.textContent = 'This browser can’t share your location. Choose the store from the list.'; return; }
  btn.disabled = true; msg.textContent = 'Finding where you are…';
  navigator.geolocation.getCurrentPosition((pos) => {
    btn.disabled = false;
    const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const list = $('.store-list', f);
    const rows = STORES.map((s, i) => ({ s, i, d: hasXY(s) ? km(here, s) : Infinity }));
    rows.sort((a, b) => a.d - b.d || a.i - b.i);            // stores without a map pin keep their order, at the end
    rows.forEach(({ s, d }) => {
      const el = list.querySelector(`[data-store="${CSS.escape(s.id)}"]`);
      $('.store-dist', el).textContent = Number.isFinite(d) ? away(d) : '';
      list.append(el);
    });
    const best = rows[0];
    if (!Number.isFinite(best.d)) { msg.textContent = 'None of our stores has a map location yet. Choose one from the list.'; return; }
    $(`[data-store="${CSS.escape(best.s.id)}"] input`, list).checked = true;
    msg.textContent = `Nearest to you: ${best.s.name}, ${away(best.d)}.`;
  }, (e) => {
    btn.disabled = false;
    msg.textContent = e.code === 1
      ? 'Location is turned off for this site, so we can’t find the nearest store. Choose one from the list.'
      : 'We couldn’t find where you are just now. Choose the store from the list.';
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60e3 });
}

const CAT_ICON = {
  solar_panels: '<path d="M3 15l2.5-9h13L21 15z"/><path d="M4.3 10.5h15.4M9 6l-1 9M15 6l1 9"/><path d="M12 15v4M8 19h8"/>',
  inverters: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 13c1-2 2-2 3.5 0s2.5 2 3.5 0"/><path d="M9 7h6"/>',
  batteries: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M9 6V4h6v2M12 10l-2 4h4l-2 4"/>',
  ups: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M9 6V4h6v2M12 10l-2 4h4l-2 4"/>',
  mppt_charge_controller: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  cables_accessories: '<path d="M4 18c4 0 4-12 8-12s4 12 8 12"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="18" r="1.6"/>',
  mounting_structures: '<path d="M3 20L12 5l9 15M7.5 12.5h9M5.5 16.5h13M12 5v15"/>',
  solar_drive: '<circle cx="12" cy="12" r="7"/><path d="M12 5v3M12 16v3M5 12h3M16 12h3M12 12l3-3"/>',
  pumps: '<path d="M12 3.5c3.2 4 5.5 7.2 5.5 10a5.5 5.5 0 0 1-11 0c0-2.8 2.3-6 5.5-10z"/>',
  panel_cleaning_system: '<path d="M6 21l3-9h6l3 9M9 12V8h6v4M12 8V3M17 5l2-1M17 8h2"/>',
};
const catIcon = (c) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${CAT_ICON[c] || '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>'}</svg>`;
const STOCK = { low: ['Few left', 'low'], on_order: ['On order', 'order'] };

let PRODUCTS = [], CATS = [], cat = 'all', q = '';
const byId = () => Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
const cart = { get: () => store.get('sp_cart', {}) || {}, set: (c) => { store.set('sp_cart', c); badge(); } };
function setQty(id, n) {
  const c = cart.get();
  n = Math.max(0, Math.min(999, Math.round(n)));
  if (n) c[id] = n; else delete c[id];
  cart.set(c);
}
function badge() {
  const n = Object.values(cart.get()).reduce((a, b) => a + b, 0);
  $('#cart-count').textContent = n ? String(n) : '';
  $('#cart-btn').setAttribute('aria-label', n ? `Cart, ${n} item${n === 1 ? '' : 's'}` : 'Cart, empty');
}

function priceHtml(p) { return `<p class="prod-price">${inr(p.price)}<small>incl. GST</small></p>`; }
function buyHtml(p) {
  const n = cart.get()[p.id] || 0;
  return n
    ? `<div class="qty" data-id="${p.id}"><button type="button" data-dec aria-label="One less">${ICON.minus}</button><span aria-live="polite">${n}</span><button type="button" data-inc aria-label="One more">${ICON.plus}</button></div>`
    : `<button type="button" class="add-btn" data-add="${p.id}">${ICON.plus}Add</button>`;
}
function imgHtml(p, cls = '') {
  return p.images.length ? `<img src="${esc(p.images[0])}" alt="" loading="lazy" decoding="async"${cls}>` : catIcon(p.category);
}
function card(p) {
  const st = STOCK[p.stock];
  return `<article class="prod" data-card="${p.id}">
    <button type="button" class="prod-img" data-open="${p.id}" aria-label="${esc(p.title)} — details">${imgHtml(p)}${p.featured ? '<span class="badge feat">Featured</span>' : st ? `<span class="badge ${st[1]}">${st[0]}</span>` : ''}</button>
    <div class="prod-body"><span class="prod-cat">${esc(p.category_label)}</span><button type="button" class="prod-title" data-open="${p.id}">${esc(p.title)}</button>${priceHtml(p)}<div data-buy="${p.id}">${buyHtml(p)}</div></div>
  </article>`;
}

function render() {
  const grid = $('#grid'), empty = $('#empty');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = PRODUCTS.filter((p) => (cat === 'all' || p.category === cat) && words.every((w) => `${p.title} ${p.category_label} ${p.brand}`.toLowerCase().includes(w)));
  $$('#cats .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.cat === cat)));
  if (!PRODUCTS.length) {
    grid.hidden = true; empty.hidden = false;
    empty.innerHTML = `<h2>Our online counter is being stocked</h2><p class="muted">Tell us what you need — panels, inverters, batteries, cables or a full kit — and we’ll send you a price on WhatsApp.</p>
      <div class="cta-row" style="margin:0"><button type="button" class="btn btn-leaf btn-lg" data-lead="other" data-source="shop" data-title="Ask for a price" data-sub="Tell us the items and quantities — we’ll reply with a price.">Ask for a price</button>
      <a class="btn btn-wa btn-lg" target="_blank" rel="noopener" href="${waLink('Hi Sensoper, I’d like a price for some solar materials.')}">${ICON.chat}WhatsApp us</a></div>`;
    return;
  }
  grid.hidden = false;
  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:24px 0"><h2 style="font-size:1.4rem">Nothing matches “${esc(q)}”</h2><p class="muted">We may still have it in the store. Ask us and we’ll check.</p>
      <a class="btn btn-wa" target="_blank" rel="noopener" href="${waLink(`Hi Sensoper, do you have ${q}?`)}">${ICON.chat}Ask on WhatsApp</a></div>`;
    return;
  }
  grid.innerHTML = list.map(card).join('');
}
function refreshBuy(id) {
  const p = byId()[id];
  $$(`[data-buy="${id}"]`).forEach((el) => { el.innerHTML = buyHtml(p); });
}

/* product details */
function openProduct(id) {
  const p = byId()[id];
  if (!p) return;
  const d = sheet('pd-sheet', '<div id="pd-body"></div>');
  const st = STOCK[p.stock];
  const n = cart.get()[p.id] || 0;
  $('#pd-body', d).innerHTML = `
    <div class="sheet-head"><div><span class="prod-cat">${esc(p.category_label)}${p.brand ? ` — ${esc(p.brand)}` : ''}</span><h2 style="margin-top:4px">${esc(p.title)}</h2></div><button type="button" class="x-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="pd-img" id="pd-main">${p.images.length ? `<img src="${esc(p.images[0])}" alt="${esc(p.title)}">` : catIcon(p.category)}</div>
    ${p.images.length > 1 ? `<div class="pd-thumbs">${p.images.map((src, i) => `<button type="button" data-thumb="${esc(src)}" aria-current="${i === 0}" aria-label="Picture ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:12px">${priceHtml(p).replace('prod-price', 'prod-price" style="font-size:1.6rem')}${st ? `<span class="tag warn">${st[0]}</span>` : '<span class="tag ok">In stock</span>'}</div>
    ${p.description ? `<p class="muted" style="margin-bottom:14px;white-space:pre-line">${esc(p.description)}</p>` : ''}
    ${p.watt ? `<div class="list" style="margin-bottom:14px"><div><span class="muted">Power</span><b>${esc(p.watt)} W</b></div></div>` : ''}
    <div style="display:grid;gap:10px">
      <button type="button" class="btn btn-leaf btn-lg btn-block" data-pd-add="${p.id}">${n ? `In your cart (${n}) — add one more` : 'Add to cart'}</button>
      <a class="btn btn-ghost btn-block" target="_blank" rel="noopener" href="${waLink(`Hi Sensoper, I’m interested in: ${p.title} (${inr(p.price)}).`)}">${ICON.chat}Ask about it on WhatsApp</a>
    </div>`;
  openSheet(d);
}

/* cart + checkout */
function cartLines() {
  const all = byId();
  return Object.entries(cart.get()).map(([id, qty]) => ({ id, qty, p: all[id] }));
}
function openCart(step = 'cart') {
  const d = sheet('cart-sheet', '<div id="cart-body"></div>');
  const body = $('#cart-body', d);
  const lines = cartLines();
  const ok = lines.filter((l) => l.p);
  const total = ok.reduce((s, l) => s + l.p.price * l.qty, 0);
  if (step === 'cart') {
    body.innerHTML = `<div class="sheet-head"><div><h2>Your cart</h2><p>${ok.length ? 'We confirm stock and delivery before you pay.' : 'Nothing here yet.'}</p></div><button type="button" class="x-btn" data-close aria-label="Close">${ICON.close}</button></div>
      ${ok.length ? `<div class="cart-lines">${ok.map((l) => `<div class="cart-line"><div><b>${esc(l.p.title)}</b><div class="small muted">${inr(l.p.price)} each</div></div>
        <div class="qty" data-id="${l.id}" data-cart><button type="button" data-dec aria-label="One less">${ICON.minus}</button><span>${l.qty}</span><button type="button" data-inc aria-label="One more">${ICON.plus}</button></div></div>`).join('')}</div>
        ${lines.length > ok.length ? '<p class="small muted" style="margin-bottom:10px">Some items you added earlier aren’t in the shop any more, so we left them out.</p>' : ''}
        <div class="cart-total"><span>Total, incl. GST</span><b>${inr(total)}</b></div>
        <button type="button" class="btn btn-leaf btn-lg btn-block" data-checkout>Continue</button>`
      : `<button type="button" class="btn btn-ghost btn-block" data-close>Browse products</button>`}`;
  } else if (step === 'checkout') {
    const me = store.get('sp_me', {});
    body.innerHTML = `<div class="sheet-head"><div><h2>Where should it go?</h2><p>${ok.length} item${ok.length === 1 ? '' : 's'}, ${inr(total)} incl. GST. No payment now — we’ll call to confirm.</p></div><button type="button" class="x-btn" data-close aria-label="Close">${ICON.close}</button></div>
      <form class="form" id="order-form" novalidate>
        <div class="form-row two">
          <label class="fld"><span>Your name</span><input class="input" name="name" autocomplete="name" maxlength="80" value="${esc(me.name || '')}"></label>
          <label class="fld"><span>Mobile number</span><span class="phone-in"><span>+91</span><input class="input" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" value="${esc(me.phone || '')}"></span></label>
        </div>
        <div class="seg-radio" role="radiogroup" aria-label="Delivery or pick-up">
          <label><input type="radio" name="delivery" value="delivery" checked>Deliver to me</label>
          <label><input type="radio" name="delivery" value="pickup">I’ll pick it up</label>
        </div>
        <label class="fld" id="addr-f"><span>Delivery address</span><textarea class="input" name="address" rows="2" maxlength="300" autocomplete="street-address"></textarea></label>
        ${storePicker()}
        <label class="fld"><span>PIN code</span><input class="input" name="pincode" inputmode="numeric" maxlength="6" autocomplete="postal-code"></label>
        <label class="fld"><span>Note for us <em>(optional)</em></span><input class="input" name="message" maxlength="600" placeholder="GST number for the invoice, best time to deliver…"></label>
        <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="form-err" role="alert"></p>
        <button type="submit" class="btn btn-leaf btn-lg btn-block">Send order request</button>
        <button type="button" class="btn btn-ghost btn-block" data-back>Back to cart</button>
      </form>`;
    const f = $('#order-form', body);
    const sync = () => {
      const pickup = f.delivery.value === 'pickup';
      $('#addr-f', body).hidden = pickup;
      const sf = $('#store-f', body);
      if (sf) sf.hidden = !pickup;
    };
    f.addEventListener('change', sync); sync();
    const near = $('[data-near]', f);
    if (near) near.addEventListener('click', () => findNearest(f));
    f.addEventListener('submit', (e) => { e.preventDefault(); placeOrder(f, ok); });
  }
  openSheet(d);
}
async function placeOrder(f, lines) {
  const err = $('.form-err', f), btn = $('[type=submit]', f);
  err.textContent = '';
  const name = f.name.value.trim(), phone = mobile(f.phone.value);
  if (name.length < 2) { err.textContent = 'Tell us your name.'; f.name.focus(); return; }
  if (!phone) { err.textContent = 'Enter your 10-digit mobile number.'; f.phone.focus(); return; }
  if (f.delivery.value === 'delivery' && f.address.value.trim().length < 5) { err.textContent = 'Add the delivery address, or choose pick-up.'; f.address.focus(); return; }
  const pickup = f.delivery.value === 'pickup';
  const picked = pickup && STORES.length ? STORES.find((s) => s.id === ($('input[name=store_id]:checked', f) || {}).value) : null;
  if (pickup && STORES.length && !picked) { err.textContent = 'Choose the store you’ll pick it up from.'; $('input[name=store_id]', f).focus(); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await api('/api/public/shop/order', { method: 'POST', body: {
      name, phone, delivery: f.delivery.value, address: f.address.value, pincode: f.pincode.value, message: f.message.value,
      store_id: picked ? picked.id : undefined,
      items: lines.map((l) => ({ id: l.id, qty: l.qty })), utm: utm(), website: f.website.value } });
    store.set('sp_me', { ...store.get('sp_me', {}), name, phone });
    cart.set({});
    render();
    const text = `Hi Sensoper, I sent an order request on your shop${r.number ? ` (${r.number})` : ''}:\n` + (r.lines || []).map((l) => `• ${l.title} × ${l.qty}`).join('\n')
      + `\nTotal ${inr(r.total)}.${picked ? `\nI’ll pick it up from ${picked.name}.` : ''} — ${name}`;
    const dir = picked && httpsOnly(picked.directions);
    $('#cart-body').innerHTML = `<div class="done"><div class="done-ico">${ICON.check}</div><h2>Order request sent</h2>
      <p class="muted">${r.number ? `Your reference is <b>${esc(r.number)}</b>. ` : ''}We’ll call you on <b>+91 ${phone.slice(0, 5)} ${phone.slice(5)}</b> to confirm stock${picked ? ' and payment, and tell you when it’s ready to collect' : ', delivery and payment'}.</p>
      ${picked ? `<div class="pickup-at"><span class="pa-k">Collect it from</span><b>${esc(picked.name)}</b>${picked.address ? `<span>${esc(picked.address)}</span>` : ''}${picked.hours ? `<span>${esc(picked.hours)}</span>` : ''}${dir ? `<a href="${esc(dir)}" target="_blank" rel="noopener">Directions<span class="sr"> to ${esc(picked.name)}, opens Google Maps</span></a>` : ''}</div>` : ''}
      ${r.unavailable && r.unavailable.length ? '<p class="small muted">A few items had just gone out of the shop, so they’re not in this request.</p>' : ''}
      <a class="btn btn-wa btn-lg btn-block" target="_blank" rel="noopener" href="${waLink(text)}">${ICON.chat}Send it on WhatsApp too</a>
      <button type="button" class="btn btn-ghost btn-block" data-close>Keep browsing</button></div>`;
  } catch (e) {
    err.textContent = e.message;
    if (e.status === 409) load();
  } finally {
    btn.disabled = false; btn.textContent = 'Send order request';
  }
}

/* events */
document.addEventListener('click', (e) => {
  const t = e.target;
  const open = t.closest('[data-open]');
  if (open) { openProduct(open.dataset.open); return; }
  const add = t.closest('[data-add]');
  if (add) { setQty(add.dataset.add, (cart.get()[add.dataset.add] || 0) + 1); refreshBuy(add.dataset.add); toast('Added to your cart'); return; }
  const pdAdd = t.closest('[data-pd-add]');
  if (pdAdd) { const id = pdAdd.dataset.pdAdd; setQty(id, (cart.get()[id] || 0) + 1); refreshBuy(id); $('#pd-sheet').close(); toast('Added to your cart'); return; }
  const thumb = t.closest('[data-thumb]');
  if (thumb) { $('#pd-main img').src = thumb.dataset.thumb; $$('[data-thumb]').forEach((b) => b.setAttribute('aria-current', String(b === thumb))); return; }
  const step = t.closest('[data-inc],[data-dec]');
  if (step) {
    const box = step.closest('[data-id]'); const id = box.dataset.id;
    setQty(id, (cart.get()[id] || 0) + (step.hasAttribute('data-inc') ? 1 : -1));
    refreshBuy(id);
    if (box.hasAttribute('data-cart')) openCart('cart');
    return;
  }
  if (t.closest('#cart-btn')) { openCart('cart'); return; }
  if (t.closest('[data-checkout]')) { storesReady.then(() => openCart('checkout')); return; }
  if (t.closest('[data-back]')) { openCart('cart'); return; }
  const chip = t.closest('[data-cat]');
  if (chip) { cat = chip.dataset.cat; render(); }
});
let qt;
$('#q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value.trim(); render(); }, 120); });

async function load() {
  try {
    const r = await api('/api/public/shop/products');
    PRODUCTS = r.products || []; CATS = r.categories || [];
    $('#cats').innerHTML = PRODUCTS.length ? [`<button type="button" class="chip" data-cat="all" aria-pressed="true">All (${PRODUCTS.length})</button>`, ...CATS.map((c) => `<button type="button" class="chip" data-cat="${esc(c.key)}" aria-pressed="false">${esc(c.label)} (${c.count})</button>`)].join('') : '';
    $('.shop-bar').hidden = !PRODUCTS.length;
    const known = byId(); const c = cart.get();
    Object.keys(c).forEach((id) => { if (!known[id]) delete c[id]; });
    cart.set(c);
    render();
  } catch (e) {
    $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><h2 style="font-size:1.4rem">The shop didn’t load</h2><p class="muted">${esc(e.message)}</p><button type="button" class="btn btn-leaf" id="retry">Try again</button></div>`;
    $('#retry').addEventListener('click', load);
  }
}
badge();
load();
schedulePopups('shop', []);
