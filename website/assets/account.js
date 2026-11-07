/* sensoper.in/account — customers sign in with the mobile number staff made their login for. */
import { $, $$, boot, api, inr, fmt, esc, mobile, sheet, openSheet, toast, waLink, ICON, store } from './core.js';

boot('site');
const app = $('#app');
let ME = null, current = null, tempPw = '';

const day = (s) => (s ? new Date(String(s).length === 10 ? s + 'T00:00:00+05:30' : s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const TYPE = { 'on-grid': 'on-grid', 'off-grid': 'off-grid', hybrid: 'hybrid', 'solar-pump': 'solar pump' };
const STATUS = { open: ['Open', 'warn'], assigned: ['With our team', 'warn'], in_progress: ['Being fixed', 'warn'], pending_customer: ['Waiting for you', 'warn'], reopened: ['Reopened', 'warn'], resolved: ['Fixed', 'ok'], closed: ['Closed', 'ok'] };
const PAY = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', cheque: 'Cheque', card: 'Card', emi: 'EMI' };
const payMethod = (m) => PAY[String(m || '').toLowerCase()] || (m ? String(m).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

/* ───────── sign in ───────── */
function loginView(msg = '') {
  $('#signout').hidden = true;
  const me = store.get('sp_me', {});
  app.innerHTML = `<div class="login-card">
    <h1>Customer login</h1>
    <p class="muted" style="margin:8px 0 20px">See your solar plant’s savings, payments and service — and raise a request from your phone.</p>
    <form class="form" id="login" novalidate>
      <label class="fld"><span>Mobile number</span><span class="phone-in"><span>+91</span><input class="input" name="phone" type="tel" inputmode="numeric" autocomplete="username" maxlength="14" value="${esc(me.phone || '')}"></span></label>
      <label class="fld"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" maxlength="200"></label>
      <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="showpw" style="width:18px;height:18px;accent-color:var(--leaf)">Show password</label>
      <p class="form-err" role="alert">${esc(msg)}</p>
      <button class="btn btn-leaf btn-lg btn-block" type="submit">Sign in</button>
    </form>
    <div class="list" style="margin-top:18px">
      <div><span class="muted">No login yet?</span><a data-wa="Hi Sensoper, I’m your customer — please make a login for me." href="#">Ask us on WhatsApp</a></div>
      <div><span class="muted">Forgot your password?</span><a data-wa="Hi Sensoper, please reset my customer login password." href="#">We’ll reset it</a></div>
    </div>
  </div>`;
  $$('[data-wa]', app).forEach((a) => { a.href = waLink(a.dataset.wa); a.target = '_blank'; a.rel = 'noopener'; });
  const f = $('#login');
  $('#showpw').addEventListener('change', (e) => { f.password.type = e.target.checked ? 'text' : 'password'; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-err', f), btn = $('[type=submit]', f);
    err.textContent = '';
    const phone = mobile(f.phone.value);
    if (!phone) { err.textContent = 'Enter the 10-digit mobile number we made your login with.'; f.phone.focus(); return; }
    if (!f.password.value) { err.textContent = 'Enter your password.'; f.password.focus(); return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const r = await api('/api/client/auth/login', { method: 'POST', body: { phone, password: f.password.value } });
      tempPw = r.must_change_password ? f.password.value : '';
      start();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Sign in'; }
  });
  (me.phone ? f.password : f.phone).focus({ preventScroll: true });
}

function passwordView() {
  $('#signout').hidden = false;
  app.innerHTML = `<div class="login-card">
    <h1>Choose your own password</h1>
    <p class="muted" style="margin:8px 0 20px">Hi ${esc((ME.name || '').split(' ')[0])}. The password we sent you works once — pick one only you know. At least 8 characters.</p>
    <form class="form" id="pw" novalidate>
      <label class="fld" ${tempPw ? 'hidden' : ''}><span>Password we gave you</span><input class="input" name="current" type="password" autocomplete="current-password" value="${esc(tempPw)}"></label>
      <label class="fld"><span>New password</span><input class="input" name="next" type="password" autocomplete="new-password" minlength="8" maxlength="200"></label>
      <label class="fld"><span>Type it again</span><input class="input" name="again" type="password" autocomplete="new-password" maxlength="200"></label>
      <p class="form-err" role="alert"></p>
      <button class="btn btn-leaf btn-lg btn-block" type="submit">Save and continue</button>
    </form></div>`;
  const f = $('#pw');
  f.next.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-err', f), btn = $('[type=submit]', f);
    err.textContent = '';
    if (f.next.value.length < 8) { err.textContent = 'Use at least 8 characters.'; f.next.focus(); return; }
    if (f.next.value !== f.again.value) { err.textContent = 'The two passwords don’t match.'; f.again.focus(); return; }
    btn.disabled = true;
    try {
      await api('/api/client/auth/change-password', { method: 'POST', body: { current_password: f.current.value, new_password: f.next.value } });
      tempPw = ''; toast('Password saved');
      start();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; if (ex.status === 400) { f.current.closest('label').hidden = false; } }
  });
}

/* ───────── the dashboard ───────── */
async function start() {
  try {
    ME = await api('/api/client/me');
  } catch (e) {
    if (e.status === 401) return loginView();
    app.innerHTML = `<div class="login-card"><h1>Couldn’t open your page</h1><p class="muted" style="margin:10px 0 18px">${esc(e.message)}</p><button class="btn btn-leaf" id="again">Try again</button></div>`;
    $('#again').addEventListener('click', start);
    return;
  }
  if (ME.must_change_password) return passwordView();
  $('#signout').hidden = false;
  if (!ME.projects.length) {
    app.innerHTML = `<div class="login-card"><h1>Hi ${esc(ME.name.split(' ')[0])}</h1><p class="muted" style="margin:10px 0 18px">There’s no project on your login yet. Ask us and we’ll add it.</p><a class="btn btn-wa btn-block" target="_blank" rel="noopener" href="${waLink('Hi Sensoper, please add my project to my customer login.')}">${ICON.chat}Ask on WhatsApp</a></div>`;
    return;
  }
  const want = new URLSearchParams(location.search).get('p');
  current = ME.projects.find((p) => p.id === want) ? want : ME.projects[0].id;
  showProject(current);
}

async function showProject(id) {
  current = id;
  const tabs = ME.projects.length > 1 ? `<div class="proj-tabs" role="tablist" aria-label="Your projects">${ME.projects.map((p) => `<button type="button" class="chip" role="tab" data-proj="${p.id}" aria-selected="${p.id === id}" aria-pressed="${p.id === id}">${p.size_kw ? fmt(p.size_kw, 1) + ' kW ' : ''}${esc(TYPE[p.system_type] || p.system_type)}${p.place ? ` — ${esc(p.place)}` : ''}</button>`).join('')}</div>` : '';
  app.innerHTML = `<div class="acc-head"><div><p class="muted small">Welcome back</p><h1>${esc(ME.name)}</h1></div></div>${tabs}<div id="dash"><div class="loading"><div class="spin" aria-label="Loading"></div></div></div>`;
  try {
    const d = await api(`/api/client/projects/${id}/dashboard`);
    renderDash(d);
  } catch (e) {
    if (e.status === 401) return loginView('Please sign in again.');
    $('#dash').innerHTML = `<div class="tile"><p>${esc(e.message)}</p></div>`;
  }
}

function renderDash(d) {
  const p = d.project, s = d.savings, en = d.energy, m = d.money;
  const running = s.running;
  const status = { draft: 'Quotation being prepared', submitted: 'Quotation sent', approved: 'Installation under way', completed: 'Running' }[p.status] || 'In progress';
  const hero = `<section class="tile hero-tile span-6">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div><p class="muted small">${esc(p.reference || '')}</p><h2 style="font-family:var(--display);font-size:clamp(1.4rem,4vw,2rem);font-weight:600;letter-spacing:-.03em;margin:4px 0 0">Your ${p.size_kw ? esc(fmt(p.size_kw, 1)) + ' kW ' : ''}${esc(TYPE[p.system_type] || p.system_type || '')} system</h2></div>
      <span class="tag ${running ? 'ok' : 'warn'}">${running ? 'Running since ' + day(s.running_since) : status}</span>
    </div>
    ${running ? `<div class="kpis">
      <div class="kpi"><span>Saved so far</span><b>${inr(s.so_far, { short: true })}</b></div>
      <div class="kpi"><span>Units made${en.measured ? '' : ' (est.)'}</span><b>${fmt(en.units_so_far)}</b></div>
      <div class="kpi"><span>CO₂ avoided</span><b>${fmt(en.co2_kg_so_far / 1000, 1)} t</b></div>
      <div class="kpi"><span>Like planting</span><b>${fmt(en.trees_equivalent)} trees</b></div></div>
      ${s.payback_years ? `<div><div style="display:flex;justify-content:space-between;font-size:.875rem;margin-bottom:6px"><span>${s.breakeven_reached ? 'Paid for itself — everything now is profit' : `Paying itself back — ${fmt(s.breakeven_pct)}%`}</span><span class="muted">${s.breakeven_date ? 'Breakeven ' + day(s.breakeven_date) : ''}</span></div><div class="bar"><i style="width:${Math.min(100, s.breakeven_pct)}%"></i></div></div>` : ''}`
    : `<div><div style="display:flex;justify-content:space-between;font-size:.875rem;margin-bottom:6px"><span>Installation progress</span><b>${fmt(d.progress_pct)}%</b></div><div class="bar"><i style="width:${Math.min(100, d.progress_pct)}%"></i></div></div>
      <div class="kpis"><div class="kpi"><span>Expected saving</span><b>${s.monthly ? inr(s.monthly) + '/mo' : '—'}</b></div><div class="kpi"><span>Units a month</span><b>${fmt(en.monthly_units)}</b></div><div class="kpi"><span>CO₂ avoided a year</span><b>${fmt(en.co2_kg_per_year / 1000, 1)} t</b></div><div class="kpi"><span>Pays back in</span><b>${s.payback_years ? fmt(s.payback_years, 1) + ' yrs' : '—'}</b></div></div>`}
  </section>`;

  const journey = `<section class="tile span-3"><h2>Your project, step by step</h2><ol class="journey">${d.journey.map((j) => `<li class="${j.done ? 'is-done' : j.active ? 'is-active' : ''}"><div><b>${esc(j.label)}</b><span>${[j.date ? day(j.date) : '', j.detail || ''].filter(Boolean).map(esc).join(' — ') || (j.done ? 'Done' : j.active ? 'In progress' : 'Coming up')}</span></div></li>`).join('')}</ol></section>`;

  const money = m.price ? `<section class="tile span-3"><h2>Payments</h2>
    <div class="list"><div><span class="muted">System price</span><b>${inr(m.price)}</b></div>${m.subsidy ? `<div><span class="muted">Subsidy (paid to you)</span><b>${inr(m.subsidy)}</b></div>` : ''}<div><span class="muted">Paid so far</span><b>${inr(m.paid)}</b></div><div><span class="muted">Balance</span><b>${inr(m.balance)}</b></div></div>
    ${m.paid_pct != null ? `<div class="bar" style="margin:10px 0 4px"><i style="width:${m.paid_pct}%"></i></div><p class="small muted">${m.paid_pct}% paid</p>` : ''}
    ${m.payments.length ? `<p class="small" style="margin-top:14px;font-weight:700">Recent payments</p><div class="list">${m.payments.slice(0, 5).map((x) => `<div><span>${day(x.date)}${x.method ? ` — ${esc(payMethod(x.method))}` : ''}</span><b>${inr(x.amount)}</b></div>`).join('')}</div>` : ''}
  </section>` : `<section class="tile span-3"><h2>Payments</h2><p class="muted">Your payment details appear here once your quotation is final.</p></section>`;

  const sys = `<section class="tile span-2"><h2>Your system</h2><div class="list">
    ${p.panels && p.panels.count ? `<div><span class="muted">Panels</span><b style="text-align:right">${esc(p.panels.count)}${p.panels.watt ? ` × ${esc(p.panels.watt)} W` : ''}</b></div>${p.panels.name ? `<div><span class="muted">Make</span><span style="text-align:right">${esc(p.panels.name)}</span></div>` : ''}` : ''}
    ${p.inverter ? `<div><span class="muted">Inverter</span><span style="text-align:right">${esc(p.inverter)}</span></div>` : ''}
    ${p.battery ? `<div><span class="muted">Battery</span><span style="text-align:right">${esc(p.battery.count || '')} ${esc(p.battery.name || '')}</span></div>` : ''}
    ${p.installation_date ? `<div><span class="muted">Installed</span><span>${day(p.installation_date)}</span></div>` : ''}
    ${p.commissioning_date ? `<div><span class="muted">Switched on</span><span>${day(p.commissioning_date)}</span></div>` : ''}
    ${en.last_reading ? `<div><span class="muted">Last reading</span><span>${day(en.last_reading)}</span></div>` : ''}
  </div></section>`;

  const amc = d.amc ? `<div class="list" style="margin-bottom:12px"><div><span class="muted">Maintenance plan</span><b>${esc((d.amc.contract_type || 'AMC').replace(/_/g, ' '))}</b></div>${d.amc.next_visit ? `<div><span class="muted">Next visit</span><b>${day(d.amc.next_visit)}</b></div>` : ''}${d.amc.end_date ? `<div><span class="muted">Plan ends</span><span>${day(d.amc.end_date)}</span></div>` : ''}</div>` : '';
  const tickets = d.tickets.length ? `<div class="list">${d.tickets.slice(0, 6).map((t) => { const st = STATUS[t.status] || [t.status || 'Open', '']; return `<div><span><b style="font-weight:600">${esc(t.category)}</b><br><span class="small muted">${esc(t.number || '')} — ${day(t.created_at)}${t.last_update ? ` — ${esc(t.last_update)}` : ''}</span></span><span class="tag ${st[1]}">${esc(st[0])}</span></div>`; }).join('')}</div>` : '<p class="muted">No service requests. If anything looks wrong, tell us here.</p>';
  const service = `<section class="tile span-4"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px"><h2 style="margin:0">Service</h2><button type="button" class="btn btn-leaf btn-sm" id="raise">Raise a request</button></div>${amc}${tickets}</section>`;

  const offers = d.offers.length ? `<section class="tile span-6"><h2>Offers for you</h2>${d.offers.map((o) => `<div class="offer"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(o.title)}</b>${o.badge ? `<span class="tag warn">${esc(o.badge)}</span>` : ''}</div>${o.description ? `<p class="small muted">${esc(o.description)}</p>` : ''}<div>${o.interested ? '<span class="tag ok">We’ll call you about this</span>' : `<button type="button" class="btn btn-dark btn-sm" data-offer="${o.id}">${esc(o.cta_label || 'I’m interested')}</button>`}</div></div>`).join('')}</section>` : '';

  const c = d.company || {};
  const contact = `<section class="tile span-6" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between"><div><b>Need us?</b><p class="small muted">${esc(c.name || 'Sensoper')}${c.address ? ` — ${esc(c.address)}` : ''}</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${waLink(`Hi Sensoper, this is ${ME.name} (${p.reference || ''}).`)}">${ICON.chat}WhatsApp</a>${c.phone ? `<a class="btn btn-ghost btn-sm" href="tel:+91${esc(String(c.phone).replace(/\D/g, '').slice(-10))}">Call</a>` : ''}</div></section>`;

  $('#dash').innerHTML = `<div class="dash">${hero}${journey}${money}${sys}${service}${offers}${contact}</div>`;
  $('#raise').addEventListener('click', () => raise(d));
  $$('[data-offer]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api(`/api/client/projects/${current}/offers/${b.dataset.offer}/interest`, { method: 'POST' }); b.outerHTML = '<span class="tag ok">We’ll call you about this</span>'; toast('Thanks — we’ll call you'); }
    catch (e) { b.disabled = false; toast(e.message); }
  }));
}

function raise(d) {
  const s = sheet('ticket-sheet', '<div id="ticket-body"></div>');
  $('#ticket-body', s).innerHTML = `<div class="sheet-head"><div><h2>Raise a request</h2><p>Tell us what’s wrong — our team gets it straight away.</p></div><button type="button" class="x-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <form class="form" id="tk" novalidate>
      <label class="fld"><span>What’s it about?</span><select class="input" name="category">${d.ticket_categories.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('')}</select></label>
      <label class="fld"><span>Describe it</span><textarea class="input" name="description" rows="4" maxlength="2000" placeholder="What you see, since when, any error on the inverter screen…"></textarea></label>
      <label class="fld"><span>Number to call <em>(if not your login number)</em></span><input class="input" name="phone" type="tel" inputmode="numeric" maxlength="14"></label>
      <p class="form-err" role="alert"></p>
      <button class="btn btn-leaf btn-lg btn-block" type="submit">Send request</button>
    </form>`;
  const f = $('#tk', s);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-err', f), btn = $('[type=submit]', f);
    err.textContent = '';
    if (f.description.value.trim().length < 5) { err.textContent = 'Tell us a little more about the problem.'; f.description.focus(); return; }
    btn.disabled = true;
    try {
      const r = await api(`/api/client/projects/${current}/tickets`, { method: 'POST', body: { category: f.category.value, description: f.description.value, contact_phone: mobile(f.phone.value) || undefined } });
      s.close(); toast(`Request ${r.number || ''} sent — we’re on it`);
      showProject(current);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
  openSheet(s);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-proj]');
  if (t && t.dataset.proj !== current) { history.replaceState(null, '', `?p=${t.dataset.proj}`); showProject(t.dataset.proj); }
});
$('#signout').addEventListener('click', async () => {
  try { await api('/api/client/auth/logout', { method: 'POST' }); } catch { /* signed out anyway */ }
  ME = null; loginView();
});
start();
