/* The customer's own solar dashboard (/my/:token). Opened from a private link shared on WhatsApp;
 * the customer confirms their registered mobile number once, then the page stays signed in for 30 days. */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Leaf, Sun, Zap, IndianRupee, CalendarCheck, Check, Loader2, Phone, MessageCircle, Mail, LogOut, ShieldCheck,
  Wrench, Gift, LifeBuoy, ChevronRight, TreePine, Clock, Lock, Send,
} from 'lucide-react';
import { portalAPI } from '../utils/api';

const LOGO_URL = `${process.env.PUBLIC_URL}/logo.png`;
const inr = (v) => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const inrShort = (v) => { const n = Number(v) || 0; return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : inr(n); };
const fmtDate = (d) => (d ? new Date(String(d).length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const kgOrT = (kg) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`);
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const TYPE = { 'on-grid': 'On-grid', 'off-grid': 'Off-grid', hybrid: 'Hybrid', 'solar-pump': 'Solar pump' };
const TICKET_STATUS = { open: ['Received', 'bg-sky-50 text-sky-700'], assigned: ['Technician assigned', 'bg-indigo-50 text-indigo-700'], in_progress: ['Being worked on', 'bg-amber-50 text-amber-800'],
  pending_customer: ['Waiting for you', 'bg-orange-50 text-orange-700'], resolved: ['Resolved', 'bg-emerald-50 text-emerald-700'], closed: ['Closed', 'bg-slate-100 text-slate-600'], reopened: ['Reopened', 'bg-amber-50 text-amber-800'] };
const errText = (e, fallback) => e?.response?.data?.detail || (e?.response ? fallback : 'No internet connection — try again.');

function Card({ title, icon: I, children, testid, right }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" data-testid={testid}>
      {title && <div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-['Outfit'] text-base font-semibold text-slate-900"><I className="h-4 w-4 text-emerald-600" />{title}</h2>{right}</div>}
      {children}
    </section>
  );
}

function Ring({ pct, children }) {
  const r = 52, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="url(#ringGrad)" strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} />
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#22c55e" /><stop offset="100%" stopColor="#0ea5e9" /></linearGradient></defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

function Verify({ token, hello, onDone }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await portalAPI.verify(token, phone); onDone(); }
    catch (ex) { setErr(errText(ex, 'Could not check the number.')); }
    finally { setBusy(false); }
  };
  const co = hello?.company || {};
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-xl" data-testid="portal-verify">
        <img src={co.logo_url || LOGO_URL} alt={co.name || 'Sensoper'} className="mx-auto h-14 w-auto object-contain" onError={(e) => { e.currentTarget.src = LOGO_URL; }} />
        <h1 className="mt-5 text-center font-['Outfit'] text-2xl font-bold text-slate-900">Your solar dashboard</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Savings, breakeven, CO₂ saved, service and offers — all in one place.</p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-sm font-medium text-slate-700" htmlFor="portal-phone">Your mobile number{hello?.phone_hint ? <span className="font-normal text-slate-500"> (ends in {hello.phone_hint.slice(-2)})</span> : null}</label>
          <div className="flex h-12 items-center rounded-xl border border-slate-200 px-3 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100">
            <span className="mr-2 text-slate-500">+91</span>
            <input id="portal-phone" type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s-]/g, ''))} placeholder="98765 43210" className="h-full flex-1 bg-transparent text-lg tracking-wide outline-none" data-testid="portal-phone" autoFocus />
          </div>
          {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" data-testid="portal-verify-error">{err}</p>}
          <button type="submit" disabled={busy || digits(phone).length < 10} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-50" data-testid="portal-continue">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-4 w-4" />}Open my dashboard
          </button>
        </form>
        <p className="mt-4 text-center text-[11px] text-slate-400">Use the number you gave {co.name || 'us'}. This keeps your details private.</p>
      </div>
    </div>
  );
}

function RaiseTicket({ token, categories, onRaised }) {
  const [cat, setCat] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await portalAPI.raiseTicket(token, { category: cat || 'other', description: text });
      setMsg({ ok: true, text: `Request ${r.data.number} received. Our team will call you soon.` });
      setText(''); setCat(''); onRaised();
    } catch (ex) { setMsg({ ok: false, text: errText(ex, 'Could not send your request.') }); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={send} className="space-y-3" data-testid="portal-ticket-form">
      <div className="flex flex-wrap gap-2" role="group" aria-label="What's it about?">
        {categories.map((c) => (
          <button key={c.value} type="button" onClick={() => setCat(c.value)} aria-pressed={cat === c.value}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${cat === c.value ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`} data-testid={`portal-cat-${c.value}`}>{c.label}</button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder="Tell us what's happening — e.g. the inverter shows an error, or generation is lower than usual."
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[15px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" data-testid="portal-ticket-text" />
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`} data-testid="portal-ticket-msg">{msg.text}</p>}
      <button type="submit" disabled={busy || text.trim().length < 5} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50" data-testid="portal-ticket-send">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send request
      </button>
    </form>
  );
}

function Dashboard({ token, d, reload, onLogout }) {
  const [pending, setPending] = useState({});
  const co = d.company || {};
  const s = d.savings, e = d.energy, m = d.money, pr = d.project;
  const first = (d.customer.name || '').split(' ')[0] || 'there';
  const coPhone = digits(co.phone);
  const interested = async (o) => {
    setPending((p) => ({ ...p, [o.id]: true }));
    try { await portalAPI.interested(token, o.id); reload(); } catch { /* button stays */ } finally { setPending((p) => ({ ...p, [o.id]: false })); }
  };
  const statusLine = s.running ? `Generating since ${fmtDate(s.running_since)}` : d.progress_pct > 0 ? `Installation ${d.progress_pct}% done` : 'Getting ready for installation';

  return (
    <div className="min-h-screen bg-slate-50 pb-10" data-testid="portal-dashboard">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <img src={co.logo_url || LOGO_URL} alt={co.name} className="h-8 w-auto object-contain" onError={(ev) => { ev.currentTarget.src = LOGO_URL; }} />
          <button type="button" onClick={onLogout} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100" data-testid="portal-logout"><LogOut className="h-3.5 w-3.5" />Sign out</button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-500 to-sky-500 p-5 text-white shadow-lg" data-testid="portal-hero">
          <p className="text-sm text-emerald-50">Hello, {first}</p>
          <h1 className="mt-1 font-['Outfit'] text-3xl font-bold leading-tight">{pr.size_kw ? `${pr.size_kw} kW` : 'Your'} {TYPE[pr.system_type] || 'solar'} solar plant</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-50"><Sun className="h-4 w-4" />{statusLine}</p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-white/15 p-2.5"><p className="text-[11px] text-emerald-50">Saved so far</p><p className="font-['Outfit'] text-lg font-bold" data-testid="portal-saved">{inrShort(s.so_far)}</p></div>
            <div className="rounded-2xl bg-white/15 p-2.5"><p className="text-[11px] text-emerald-50">Every month</p><p className="font-['Outfit'] text-lg font-bold">{inr(s.monthly)}</p></div>
            <div className="rounded-2xl bg-white/15 p-2.5"><p className="text-[11px] text-emerald-50">CO₂ avoided</p><p className="font-['Outfit'] text-lg font-bold" data-testid="portal-co2">{kgOrT(e.co2_kg_so_far)}</p></div>
          </div>
          <p className="mt-3 text-[11px] text-emerald-50/90">Ref {pr.reference}</p>
        </section>

        <Card title="Breakeven" icon={CalendarCheck} testid="portal-breakeven">
          <div className="flex items-center gap-4">
            <Ring pct={s.breakeven_pct}>
              <span className="font-['Outfit'] text-2xl font-bold text-slate-900">{Math.round(s.breakeven_pct)}%</span>
              <span className="text-[10px] text-slate-500">paid back</span>
            </Ring>
            <div className="min-w-0 space-y-1.5 text-sm">
              {s.breakeven_reached ? <p className="font-semibold text-emerald-700">Your plant has paid for itself. Everything from here is profit.</p>
                : s.breakeven_date ? <p className="text-slate-700">Pays for itself by <span className="font-semibold text-slate-900" data-testid="portal-breakeven-date">{fmtDate(s.breakeven_date)}</span></p>
                  : s.payback_years ? <p className="text-slate-700">Pays for itself about <span className="font-semibold text-slate-900">{s.payback_years} years</span> after switch-on.</p>
                    : <p className="text-slate-500">We'll show your breakeven once the plant is running.</p>}
              {s.payback_years && <p className="text-xs text-slate-500">Payback period: {s.payback_years} years</p>}
              <p className="text-xs text-slate-500">25-year savings: <span className="font-semibold text-slate-800">{inrShort(s.lifetime)}</span></p>
            </div>
          </div>
        </Card>

        <Card title="Your impact on the planet" icon={Leaf} testid="portal-planet">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-emerald-50 p-3"><p className="flex items-center gap-1 text-[11px] text-emerald-800"><Leaf className="h-3 w-3" />CO₂ avoided so far</p><p className="font-['Outfit'] text-xl font-bold text-emerald-900">{kgOrT(e.co2_kg_so_far)}</p><p className="text-[11px] text-emerald-800/80">{kgOrT(e.co2_kg_per_year)} every year</p></div>
            <div className="rounded-xl bg-lime-50 p-3"><p className="flex items-center gap-1 text-[11px] text-lime-800"><TreePine className="h-3 w-3" />Same as trees</p><p className="font-['Outfit'] text-xl font-bold text-lime-900" data-testid="portal-trees">{(s.running ? e.trees_equivalent : e.trees_per_year).toLocaleString('en-IN')}</p><p className="text-[11px] text-lime-800/80">{s.running ? 'trees absorbing CO₂ for a year' : 'trees, every year'}</p></div>
            <div className="rounded-xl bg-sky-50 p-3"><p className="flex items-center gap-1 text-[11px] text-sky-800"><Zap className="h-3 w-3" />Clean units {e.measured ? 'measured' : 'generated'}</p><p className="font-['Outfit'] text-xl font-bold text-sky-900">{e.units_so_far.toLocaleString('en-IN')}</p><p className="text-[11px] text-sky-800/80">~{e.monthly_units.toLocaleString('en-IN')} units a month</p></div>
            <div className="rounded-xl bg-amber-50 p-3"><p className="flex items-center gap-1 text-[11px] text-amber-800"><Sun className="h-3 w-3" />Over 25 years</p><p className="font-['Outfit'] text-xl font-bold text-amber-900">{e.co2_t_lifetime} t</p><p className="text-[11px] text-amber-800/80">CO₂ kept out of the air</p></div>
          </div>
          {!e.measured && s.running && <p className="mt-2 text-[11px] text-slate-400">Estimated from your plant size; updates with meter readings when we take them.</p>}
        </Card>

        <Card title="Your installation" icon={Wrench} testid="portal-journey">
          <ol className="relative space-y-4 pl-7">
            <span className="absolute bottom-2 left-[11px] top-2 w-px bg-slate-200" aria-hidden="true" />
            {d.journey.map((j) => (
              <li key={j.key} className="relative">
                <span className={`absolute -left-7 top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 ${j.done ? 'border-emerald-600 bg-emerald-600 text-white' : j.active ? 'border-amber-500 bg-white text-amber-600' : 'border-slate-300 bg-white text-slate-300'}`}>
                  {j.done ? <Check className="h-3.5 w-3.5" /> : j.active ? <Clock className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
                </span>
                <p className={`text-sm font-medium ${j.done ? 'text-slate-900' : j.active ? 'text-amber-800' : 'text-slate-400'}`}>{j.label}</p>
                {(j.date || j.detail) && <p className="text-xs text-slate-500">{[j.detail, j.date && fmtDate(j.date)].filter(Boolean).join(' · ')}</p>}
              </li>
            ))}
          </ol>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
            {pr.panels?.count ? <p><span className="text-slate-400">Panels</span><br /><span className="font-medium text-slate-800">{pr.panels.count}{pr.panels.watt ? ` × ${pr.panels.watt} W` : ''}</span>{pr.panels.name ? <span className="block truncate text-slate-500">{pr.panels.name}</span> : null}</p> : null}
            {pr.inverter ? <p><span className="text-slate-400">Inverter</span><br /><span className="font-medium text-slate-800">{pr.inverter}</span></p> : null}
            {pr.battery ? <p><span className="text-slate-400">Battery</span><br /><span className="font-medium text-slate-800">{pr.battery.count} × {pr.battery.name || 'battery'}</span></p> : null}
            <p><span className="text-slate-400">Site</span><br /><span className="font-medium text-slate-800">{d.customer.address || '—'}</span></p>
          </div>
        </Card>

        {(m.price > 0 || m.paid > 0) && (
          <Card title="Payments" icon={IndianRupee} testid="portal-payments">
            <div className="flex items-end justify-between text-sm">
              <div><p className="text-xs text-slate-500">Paid</p><p className="font-['Outfit'] text-xl font-bold text-slate-900">{inr(m.paid)}</p></div>
              {m.price > 0 && <div className="text-right"><p className="text-xs text-slate-500">{m.balance > 0 ? 'Balance' : 'Fully paid'}</p><p className={`font-['Outfit'] text-xl font-bold ${m.balance > 0 ? 'text-amber-700' : 'text-emerald-700'}`} data-testid="portal-balance">{m.balance > 0 ? inr(m.balance) : '✓'}</p></div>}
            </div>
            {m.price > 0 && <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${m.paid_pct || 0}%` }} /></div>}
            {m.price > 0 && <p className="mt-1 text-[11px] text-slate-500">Total {inr(m.price)}{m.subsidy > 0 ? ` after ${inr(m.subsidy)} subsidy` : ''}</p>}
            {m.payments.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">{m.payments.map((p, i) => <li key={i} className="flex justify-between py-1.5"><span className="text-slate-600">{fmtDate(p.date)}{p.method ? <span className="ml-1 text-xs uppercase text-slate-400">{p.method.replace('_', ' ')}</span> : null}</span><span className="font-medium tabular-nums text-slate-900">{inr(p.amount)}</span></li>)}</ul>
            )}
          </Card>
        )}

        <Card title="Service & warranty" icon={ShieldCheck} testid="portal-amc">
          {d.amc ? (
            <div className="space-y-1 text-sm text-slate-700">
              <p><span className="font-semibold capitalize text-slate-900">{(d.amc.contract_type || 'AMC').replace('-', ' ')}</span> maintenance plan · valid till <span className="font-medium">{fmtDate(d.amc.end_date)}</span></p>
              {d.amc.next_visit && <p className="flex items-center gap-1.5 text-emerald-800"><CalendarCheck className="h-4 w-4" />Next service visit: <span className="font-semibold">{fmtDate(d.amc.next_visit)}</span></p>}
              {d.amc.last_visit && <p className="text-xs text-slate-500">Last visit: {fmtDate(d.amc.last_visit)}{d.amc.visits_per_year ? ` · ${d.amc.visits_per_year} visits a year` : ''}</p>}
            </div>
          ) : <p className="text-sm text-slate-600">No maintenance plan yet. Regular cleaning and checks keep generation high — ask us about an AMC.</p>}
          {co.warranty_headline && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600"><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />{co.warranty_headline}</p>}
        </Card>

        {d.offers.length > 0 && (
          <Card title="Offers for you" icon={Gift} testid="portal-offers">
            <ul className="space-y-3">
              {d.offers.map((o) => (
                <li key={o.id} className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-3" data-testid={`portal-offer-${o.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">{o.title}</p>
                    {o.badge && <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">{o.badge}</span>}
                  </div>
                  {o.description && <p className="mt-1 text-sm text-slate-600">{o.description}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">{o.valid_till ? `Till ${fmtDate(o.valid_till)}` : ''}</span>
                    {o.interested
                      ? <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check className="h-3.5 w-3.5" />We'll call you</span>
                      : <button type="button" onClick={() => interested(o)} disabled={pending[o.id]} className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" data-testid={`portal-offer-btn-${o.id}`}>{pending[o.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{o.cta_label}<ChevronRight className="h-3 w-3" /></button>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Need help?" icon={LifeBuoy} testid="portal-help">
          <RaiseTicket token={token} categories={d.ticket_categories} onRaised={reload} />
          {d.tickets.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Your requests</p>
              <ul className="divide-y divide-slate-100" data-testid="portal-tickets">
                {d.tickets.map((t) => { const [label, cls] = TICKET_STATUS[t.status] || [t.status, 'bg-slate-100 text-slate-600']; return (
                  <li key={t.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-900">{t.category}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span></div>
                    <p className="line-clamp-2 text-xs text-slate-500">{t.description}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{t.number} · {fmtDate(t.created_at)}{t.last_update ? ` · ${t.last_update}` : ''}</p>
                  </li>
                ); })}
              </ul>
            </div>
          )}
        </Card>

        <Card testid="portal-contact">
          <p className="text-sm font-semibold text-slate-900">{co.name}</p>
          {co.address && <p className="text-xs text-slate-500">{co.address}</p>}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {coPhone && <a href={`tel:+91${coPhone}`} className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Phone className="h-4 w-4 text-emerald-600" />Call</a>}
            {coPhone && <a href={`https://wa.me/91${coPhone}?text=${encodeURIComponent(`Hi, this is ${d.customer.name} (Ref ${pr.reference}).`)}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><MessageCircle className="h-4 w-4 text-emerald-600" />WhatsApp</a>}
            {co.email && <a href={`mailto:${co.email}?subject=${encodeURIComponent(`Ref ${pr.reference}`)}`} className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Mail className="h-4 w-4 text-emerald-600" />Email</a>}
          </div>
        </Card>
        <p className="px-2 text-center text-[10px] leading-relaxed text-slate-400">Savings and CO₂ are estimates from your plant's design: {d.factors.grid_kg_co2_per_kwh} kg CO₂ per grid unit avoided, {d.factors.kg_co2_per_tree_year} kg CO₂ per tree per year.</p>
      </main>
    </div>
  );
}

export default function CustomerPortal() {
  const { token } = useParams();
  const [state, setState] = useState({ phase: 'loading' });
  const load = useCallback(async () => {
    try {
      const r = await portalAPI.dashboard(token);
      setState({ phase: 'ready', data: r.data });
    } catch (e) {
      if (e.response?.status === 401) {
        const h = await portalAPI.hello(token).then((x) => x.data).catch((ex) => (ex.response?.status === 404 ? 'gone' : null));
        setState(h === 'gone' ? { phase: 'gone' } : { phase: 'verify', hello: h });
      } else if (e.response?.status === 404) setState({ phase: 'gone' });
      else setState({ phase: 'error', text: errText(e, 'Something went wrong.') });
    }
  }, [token]);
  useEffect(() => { document.title = 'My solar dashboard'; load(); }, [load]);
  const logout = async () => { await portalAPI.logout(token).catch(() => {}); setState({ phase: 'loading' }); load(); };

  if (state.phase === 'loading') return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-7 w-7 animate-spin text-emerald-600" /></div>;
  if (state.phase === 'verify') return <Verify token={token} hello={state.hello} onDone={load} />;
  if (state.phase === 'ready') return <Dashboard token={token} d={state.data} reload={load} onLogout={logout} />;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center" data-testid="portal-gone">
      <div className="max-w-sm">
        <img src={LOGO_URL} alt="Sensoper" className="mx-auto h-12 w-auto" />
        <p className="mt-5 font-['Outfit'] text-lg font-semibold text-slate-900">{state.phase === 'gone' ? 'This link has expired' : 'Could not load your dashboard'}</p>
        <p className="mt-1 text-sm text-slate-500">{state.phase === 'gone' ? 'Ask Sensoper to send you a new link on WhatsApp.' : state.text}</p>
        {state.phase === 'error' && <button type="button" onClick={load} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Try again</button>}
      </div>
    </div>
  );
}
