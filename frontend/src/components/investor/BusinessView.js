/* The business dashboard — the same view for admins (everything) and investors (only the sections they're
 * allowed). Totals only: no customer names. Colours follow one validated palette (blue, then orange) and
 * every chart has a legend or label, a hover tooltip and a "show the numbers" table. */
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, Building2, Gauge, HandCoins, Landmark, Layers, PieChart, Sun, TrendingUp, Wrench } from 'lucide-react';

const C = { blue: '#2a78d6', orange: '#eb6834', grid: '#ecebe8', track: '#cde2fb', ink: '#0b0b0b', ink2: '#52514e', muted: '#8a8984' };
const STAGE = ['#86b6ef', '#5598e7', '#2a78d6', '#184f95'];

export const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
export function inrShort(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '')}Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, '')}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(0)}k`;
  return `₹${Math.round(v)}`;
}
const kw = (n) => `${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kW`;
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
const monthLong = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const dateLabel = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Card({ title, icon: I, note, children, testid, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 ${className}`} data-testid={testid}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-['Outfit'] text-base font-semibold text-slate-900">{I && <I className="h-4 w-4 text-slate-400" />}{title}</h3>
          {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Tile({ label, value, sub, testid }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3" data-testid={testid}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-['Outfit'] text-xl font-semibold text-slate-900 sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function ChartTip({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-slate-900">{monthLong(label)}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <b className="text-slate-900">{(fmt?.[p.dataKey] || inr)(p.value)}</b>
        </p>
      ))}
    </div>
  );
}

function NumbersTable({ head, rows }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-700">Show the numbers</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-100">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr>{head.map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
          <tbody className="tabular-nums text-slate-700">{rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="px-2 py-1.5">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

/** Horizontal bars in plain HTML: label · bar · value. One hue unless colours are given. */
function HBars({ rows, valueKey, format, sub, colors, testid }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  return (
    <ul className="space-y-2.5" data-testid={testid}>
      {rows.map((r, i) => {
        const v = Number(r[valueKey]) || 0;
        return (
          <li key={r.label} title={`${r.label}: ${format(v)}${sub ? ` · ${sub(r)}` : ''}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-slate-700">{r.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-900">{format(v)}{sub && <span className="ml-1 font-normal text-slate-500">· {sub(r)}</span>}</span>
            </div>
            <div className="h-2.5 w-full rounded bg-slate-100">
              <div className="h-2.5 rounded-r" style={{ width: `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%`, background: colors?.[i] || C.blue }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export const SECTION_TITLES = {
  kpis: 'Headline numbers', growth: 'Monthly growth', capacity: 'Capacity', pipeline: 'Pipeline', branches: 'Branches',
  cash: 'Cash', amc: 'Service income', investment: 'Your investment',
};

export default function BusinessView({ data, audience = 'admin' }) {
  const months = data?.period?.months;
  const periodText = months ? `last ${months} months` : 'all time';
  const growth = useMemo(() => (data?.growth || []).map((r) => ({ ...r, label: monthLabel(r.month) })), [data]);
  const cap = data?.capacity;
  if (!data) return null;
  const k = data.kpis;
  const inv = data.investment;
  const show = (key) => !!data[key];

  return (
    <div className="space-y-4" data-testid="business-view">
      {show('kpis') && (
        <Card title="Headline numbers" icon={TrendingUp} note={`For the ${periodText}. Won = approved or installed projects, plus direct sales.`} testid="bv-kpis">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Tile label="Revenue" value={inrShort(k.revenue)} sub={`${inrShort(k.project_revenue)} projects · ${inrShort(k.direct_sales_revenue)} sales`} testid="kpi-revenue" />
            <Tile label="Gross margin" value={inrShort(k.gross_margin)} sub={`${k.margin_pct}% of revenue`} testid="kpi-margin" />
            <Tile label="Projects won" value={k.projects_won.toLocaleString('en-IN')} sub={`${kw(k.kw_won)} · ${k.win_rate_pct}% of quotes`} testid="kpi-won" />
            <Tile label="Installed" value={kw(k.kw_installed)} sub={`${k.plants_installed} plant${k.plants_installed === 1 ? '' : 's'} switched on`} testid="kpi-installed" />
          </div>
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            Since the start: <b>{k.all_time.plants_installed}</b> plant{k.all_time.plants_installed === 1 ? '' : 's'} · <b>{kw(k.all_time.kw_installed)}</b> installed · <b>{inrShort(k.all_time.value_won)}</b> of projects won.
            {' '}Average project {inrShort(k.avg_project_value)} · {inrShort(k.collected)} collected in this period.
          </p>
        </Card>
      )}

      {inv && (
        <Card title={audience === 'investor' ? 'Your investment' : 'Investment'} icon={Landmark} note="Money in, payouts and your share — as recorded by the company." testid="bv-investment">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Tile label="You put in" value={inrShort(inv.invested)} sub={inv.since ? `since ${dateLabel(inv.since)}` : 'nothing recorded yet'} testid="inv-invested" />
            <Tile label="Your share" value={inv.share_pct ? `${inv.share_pct}%` : '—'} sub="as agreed" testid="inv-share" />
            <Tile label="Paid out to you" value={inrShort(inv.payouts)} sub={`${inv.return_pct}% of what you put in`} testid="inv-payouts" />
            <Tile label="Still invested" value={inrShort(inv.capital_in_business)} sub={inv.capital_returned ? `${inrShort(inv.capital_returned)} returned` : 'none returned yet'} testid="inv-capital" />
          </div>
          {inv.committed > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-slate-600"><span>Put in vs agreed amount</span><span className="tabular-nums">{inrShort(inv.invested)} of {inrShort(inv.committed)}</span></div>
              <div className="h-2.5 w-full rounded bg-[#cde2fb]"><div className="h-2.5 rounded-r" style={{ width: `${Math.min(100, (inv.invested / inv.committed) * 100)}%`, background: C.blue }} /></div>
            </div>
          )}
          {inv.entries?.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100" data-testid="inv-entries">
              {inv.entries.slice(0, 12).map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${e.type === 'investment' ? 'bg-[#2a78d6]' : 'bg-[#eb6834]'}`} />
                  <span className="min-w-0 flex-1"><span className="block text-slate-800">{e.type_label}</span><span className="block truncate text-[11px] text-slate-500">{dateLabel(e.date)}{e.note ? ` · ${e.note}` : ''}</span></span>
                  <span className="font-semibold tabular-nums text-slate-900">{inr(e.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {show('growth') && (
          <Card title="Monthly growth" icon={Banknote} note="Value of projects won and money collected each month" testid="bv-growth" className="lg:col-span-2">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={growth} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barGap={2} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={inrShort} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: C.ink2 }} itemSorter={(item) => (item.dataKey === 'won_value' ? 0 : 1)} />
                  <Bar dataKey="won_value" name="Value won" fill={C.blue} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="collected" name="Collected" fill={C.orange} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <NumbersTable head={['Month', 'Value won', 'Projects', 'Collected', 'Direct sales']} rows={growth.map((r) => [monthLong(r.month), inr(r.won_value), r.projects_won, inr(r.collected), inr(r.direct_sales)])} />
          </Card>
        )}

        {show('capacity') && (
          <Card title="Capacity installed" icon={Sun} note="Total kW switched on, growing month by month" testid="bv-capacity">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cap.monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v) => `${v}`} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<ChartTip fmt={{ kw_cumulative: kw, kw_installed: kw }} />} />
                  <Area type="monotone" dataKey="kw_cumulative" name="Total installed" stroke={C.blue} strokeWidth={2} fill={C.blue} fillOpacity={0.1}
                    dot={false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-xs text-slate-500">Now <b className="text-slate-800">{kw(cap.monthly.at(-1)?.kw_cumulative)}</b> · +{kw(cap.monthly.reduce((s, r) => s + r.kw_installed, 0))} in the {periodText}</p>
            {cap.system_mix?.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><PieChart className="h-3.5 w-3.5" />Won by system type</p>
                <HBars rows={cap.system_mix.map((m) => ({ ...m, label: m.type }))} valueKey="kw" format={kw} sub={(r) => `${r.count} project${r.count === 1 ? '' : 's'}`} testid="bv-mix" />
              </div>
            )}
            <NumbersTable head={['Month', 'kW switched on', 'Total kW']} rows={cap.monthly.map((r) => [monthLong(r.month), kw(r.kw_installed), kw(r.kw_cumulative)])} />
          </Card>
        )}

        {show('pipeline') && (
          <Card title="Pipeline today" icon={Layers} note="Every live project by stage, with its size and value" testid="bv-pipeline">
            <HBars rows={data.pipeline.map((p) => ({ ...p, label: p.label }))} valueKey="count" format={(v) => `${v} project${v === 1 ? '' : 's'}`}
              sub={(r) => `${kw(r.kw)} · ${inrShort(r.value)}`} colors={STAGE} testid="bv-pipeline-bars" />
            <p className="mt-3 text-[11px] text-slate-500">Leads are site visits still being written; Quoted are waiting for approval.</p>
          </Card>
        )}

        {show('branches') && (
          <Card title="By branch" icon={Building2} note={`Value of projects won in the ${periodText}`} testid="bv-branches">
            {data.branches.length ? <HBars rows={data.branches.map((b) => ({ ...b, label: b.branch }))} valueKey="value" format={inrShort} sub={(r) => `${kw(r.kw)} · ${r.projects} project${r.projects === 1 ? '' : 's'}`} testid="bv-branch-bars" />
              : <p className="py-6 text-center text-sm text-slate-400">No projects won in this period.</p>}
          </Card>
        )}

        {show('cash') && (
          <Card title="Cash" icon={HandCoins} note="On all won projects: billed vs collected" testid="bv-cash">
            <p className="font-['Outfit'] text-3xl font-semibold text-slate-900">{data.cash.collected_pct}%<span className="ml-2 text-sm font-normal text-slate-500">collected</span></p>
            <div className="mt-3 flex h-3 w-full gap-[2px]" role="img" aria-label={`${inr(data.cash.collected)} collected, ${inr(data.cash.to_collect)} still to collect`}>
              <div className="h-3 rounded-l" style={{ width: `${data.cash.collected_pct}%`, background: C.blue }} />
              <div className="h-3 flex-1 rounded-r" style={{ background: C.track }} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <p className="flex items-center gap-1.5 text-slate-600"><span className="h-2 w-2 rounded-full bg-[#2a78d6]" />Collected <b className="ml-auto tabular-nums text-slate-900">{inrShort(data.cash.collected)}</b></p>
              <p className="flex items-center gap-1.5 text-slate-600"><span className="h-2 w-2 rounded-full bg-[#cde2fb]" />To collect <b className="ml-auto tabular-nums text-slate-900">{inrShort(data.cash.to_collect)}</b></p>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Billed {inrShort(data.cash.billed)} · customer credit outstanding {inrShort(data.cash.credit_outstanding)}</p>
          </Card>
        )}

        {show('amc') && (
          <Card title="Service income" icon={Wrench} note="Maintenance contracts (AMC) — steady yearly income" testid="bv-amc">
            <div className="grid grid-cols-3 gap-2">
              <Tile label="Active contracts" value={data.amc.active_contracts} />
              <Tile label="Yearly income" value={inrShort(data.amc.yearly_income)} />
              <Tile label="Renewals due" value={data.amc.renewals_due_60d} sub="next 60 days" />
            </div>
          </Card>
        )}
      </div>

      {!Object.keys(SECTION_TITLES).some(show) && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"><Gauge className="mx-auto mb-2 h-6 w-6 text-slate-300" />Nothing has been shared here yet.</div>
      )}
      <p className="text-center text-[11px] text-slate-400">Totals only — no customer names or contact details. Updated {new Date(data.generated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.</p>
    </div>
  );
}

export const PERIODS = [[6, '6 months'], [12, '12 months'], [24, '2 years'], [0, 'All time']];

export function PeriodPicker({ value, onChange }) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Period">
      {PERIODS.map(([m, l]) => (
        <button key={m} type="button" role="tab" aria-selected={value === m} onClick={() => onChange(m)}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium ${value === m ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`} data-testid={`period-${m}`}>{l}</button>
      ))}
    </div>
  );
}
