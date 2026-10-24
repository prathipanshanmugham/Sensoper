/* AMC overview: how big the AMC book is (kW, contracts, value), how service is going (visits), what's coming
 * (renewals, offers, quotes), money, and where it all is (system types, plans, districts, month by month). */
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CalendarCheck2, CalendarClock, FileSignature, Gauge, IndianRupee, LifeBuoy, MapPin, RefreshCw, Sun, TrendingUp, Users, Wallet } from 'lucide-react';
import { inr, SYSTEM_TYPE_OPTIONS } from './amcCommon';

const BLUE = '#2a78d6', ORANGE = '#eb6834';
const GRID = '#e2e8f0', AXIS = '#64748b';
const monthLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
const typeLabel = (t) => (SYSTEM_TYPE_OPTIONS.find(([v]) => v === t) || [null, t])[1];
const kw = (v) => `${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kW`;

function Tile({ label, value, sub, icon: Icon, tone, testid, to, onClick }) {
  const toneCls = tone === 'bad' ? 'border-rose-200 bg-rose-50/60' : tone === 'warn' ? 'border-amber-200 bg-amber-50/60' : tone === 'hero' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white';
  const body = (
    <div className={`h-full rounded-xl border p-3 ${toneCls}`} data-testid={testid}>
      <div className="mb-1 flex items-center gap-1.5 text-slate-500"><Icon className="h-4 w-4" /><span className="text-[11px] font-medium uppercase tracking-wide">{label}</span></div>
      <p className="font-['Outfit'] text-xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
  if (to) return <Link to={to} className="block h-full">{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className="block h-full w-full text-left">{body}</button>;
  return body;
}

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function HBars({ rows, valueKey, label, fmt, testid }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  return (
    <ul className="space-y-2" data-testid={testid}>
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex justify-between text-xs"><span className="text-slate-700">{r.name}</span><span className="tabular-nums text-slate-900">{fmt(r)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${Math.max(2, (Number(r[valueKey]) || 0) / max * 100)}%`, background: BLUE }} aria-label={`${r.name}: ${label} ${fmt(r)}`} /></div>
        </li>
      ))}
    </ul>
  );
}

export default function AmcOverview({ d, offerCount, onTab }) {
  if (!d) return null;
  const types = Object.entries(d.capacity_by_type || {}).map(([t, v]) => ({ name: typeLabel(t), kw: Math.round(v * 10) / 10, count: (d.count_by_type || {})[t] || 0 })).sort((a, b) => b.kw - a.kw);
  const plans = Object.entries(d.plan_mix || {}).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const monthly = (d.monthly || []).map((m) => ({ month: monthLabel(m.month), 'New contracts': m.new, Renewals: m.renewals, Visits: m.visits }));
  const anyMonthly = monthly.some((m) => m['New contracts'] || m.Renewals || m.Visits);
  return (
    <div className="space-y-5" data-testid="amc-overview-metrics">
      <Section title="Size of the AMC book">
        <Tile label="Total kW looked after" value={kw(d.total_kw)} sub={`${d.active_contracts} plant${d.active_contracts === 1 ? "" : "s"} · avg ${kw(d.avg_kw_per_contract)}${d.pump_hp_total ? ` · ${d.pump_hp_total} HP pumps` : ''}`} icon={Sun} tone="hero" testid="amc-kpi-kw" />
        <Tile label="Active contracts" value={d.active_contracts} sub={`${d.contracts_total} ever · ${d.new_this_year} new this year`} icon={Users} testid="amc-kpi-active" onClick={() => onTab('contracts')} />
        <Tile label="Yearly value" value={inr(d.arr)} sub={`${inr(d.mrr)} a month · avg ${inr(d.avg_contract_value)}`} icon={IndianRupee} testid="amc-kpi-arr" />
        <Tile label="Value per kW" value={`${inr(d.value_per_kw)}`} sub="a year, across active contracts" icon={Gauge} testid="amc-kpi-value-kw" />
      </Section>

      <Section title="Service visits">
        <Tile label="Done this month" value={d.visits_done_month} sub={`${d.visits_done_year} this year`} icon={CalendarCheck2} testid="amc-kpi-visits-done" />
        <Tile label="Planned · next 30 days" value={d.visits_next_30} sub="already on the calendar" icon={CalendarClock} testid="amc-kpi-visits-next" />
        <Tile label="Overdue visits" value={d.overdue_visits} sub={d.overdue_visits ? 'planned date has passed' : 'none late'} icon={AlertTriangle} tone={d.overdue_visits ? 'bad' : undefined} testid="amc-kpi-visits-overdue" />
        <Tile label="Visits still owed" value={d.visits_due} sub="left in this term's plans" icon={RefreshCw} testid="amc-kpi-visits-owed" />
      </Section>

      <Section title="Renewals & new business">
        <Tile label="Ending soon" value={d.expiring_30} sub={`${d.expiring_60} in 60 days · ${d.expiring_90} in 90`} icon={CalendarClock} tone={d.expiring_30 ? 'warn' : undefined} testid="amc-kpi-expiring" />
        <Tile label="Renewal rate" value={`${d.renewal_rate_pct}%`} sub={`${d.renewed} renewed · ${d.cancelled} cancelled`} icon={TrendingUp} testid="amc-kpi-renewal" />
        <Tile label="Ready for an AMC offer" value={offerCount} sub="plants old enough, no AMC" icon={FileSignature} tone={offerCount ? 'warn' : undefined} testid="amc-kpi-offers" onClick={() => onTab('offers')} />
        <Tile label="Open quotes" value={d.quotes_open} sub={`${inr(d.quotes_open_value)} · won ${d.quote_win_pct}% (12 mo)`} icon={FileSignature} testid="amc-kpi-quotes" onClick={() => onTab('quotes')} />
      </Section>

      <Section title="Money & reach">
        <Tile label="Billed" value={inr(d.total_billed)} sub={`collected ${d.collection_pct}%`} icon={Wallet} testid="amc-kpi-billed" />
        <Tile label="Outstanding" value={inr(d.outstanding)} sub="billed, not yet paid" icon={IndianRupee} tone={d.outstanding ? 'warn' : undefined} testid="amc-kpi-outstanding" />
        <Tile label="Plants under AMC" value={`${d.penetration_pct}%`} sub={`of ${d.commissioned_projects} finished plants`} icon={Sun} testid="amc-kpi-penetration" />
        <Tile label="Open support tickets" value={d.tickets_open} sub="on these contracts" icon={LifeBuoy} tone={d.tickets_open ? 'warn' : undefined} testid="amc-kpi-tickets" to="/dashboard/support" />
      </Section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="amc-chart-monthly">
          <p className="text-sm font-semibold text-slate-900">Contracts started, last 12 months</p>
          <p className="mb-2 text-[11px] text-slate-500">New contracts and renewals by start month</p>
          {anyMonthly ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={monthly} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="New contracts" stackId="a" fill={BLUE} />
                <Bar dataKey="Renewals" stackId="a" fill={ORANGE} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="py-10 text-center text-xs text-slate-400">No contracts started in the last 12 months</p>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="amc-chart-types">
          <p className="text-sm font-semibold text-slate-900">kW by system type</p>
          <p className="mb-3 text-[11px] text-slate-500">Active contracts</p>
          {types.length ? <HBars rows={types} valueKey="kw" label="kW" fmt={(r) => `${kw(r.kw)} · ${r.count}`} testid="amc-types-bars" /> : <p className="py-10 text-center text-xs text-slate-400">No active contracts yet</p>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="amc-chart-plans">
          <p className="text-sm font-semibold text-slate-900">Plans</p>
          <p className="mb-3 text-[11px] text-slate-500">Active contracts by plan</p>
          {plans.length ? <HBars rows={plans} valueKey="count" label="contracts" fmt={(r) => `${r.count}`} testid="amc-plan-bars" /> : <p className="py-10 text-center text-xs text-slate-400">No active contracts yet</p>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="amc-top-districts">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><MapPin className="h-4 w-4 text-slate-400" />Where the kW are</p>
          {(d.top_districts || []).length ? (
            <table className="w-full text-sm">
              <thead className="text-[11px] text-slate-500"><tr><th className="py-1 text-left font-medium">District</th><th className="py-1 text-right font-medium">Contracts</th><th className="py-1 text-right font-medium">kW</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{d.top_districts.map((r) => <tr key={r.district}><td className="py-1.5 text-slate-700">{r.district}</td><td className="py-1.5 text-right tabular-nums">{r.contracts}</td><td className="py-1.5 text-right tabular-nums">{r.kw}</td></tr>)}</tbody>
            </table>
          ) : <p className="py-10 text-center text-xs text-slate-400">No active contracts yet</p>}
        </div>
      </div>
    </div>
  );
}
