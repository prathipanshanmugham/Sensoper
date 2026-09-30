import { useState } from 'react';
import { Input } from './ui/input';
import { CalendarRange } from 'lucide-react';

const iso = (d) => d.toISOString().slice(0, 10);
const startOfWeek = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; };
export const PRESETS = [
  ['all', 'All time', () => ({})],
  ['this_week', 'This week', (n) => ({ from: iso(startOfWeek(n)), to: iso(n) })],
  ['this_month', 'This month', (n) => ({ from: iso(new Date(n.getFullYear(), n.getMonth(), 1)), to: iso(n) })],
  ['last_month', 'Last month', (n) => ({ from: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: iso(new Date(n.getFullYear(), n.getMonth(), 0)) })],
  ['this_quarter', 'This quarter', (n) => ({ from: iso(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1)), to: iso(n) })],
  ['this_year', 'This year', (n) => ({ from: `${n.getFullYear()}-01-01`, to: iso(n) })],
  ['last_year', 'Last year', (n) => ({ from: `${n.getFullYear() - 1}-01-01`, to: `${n.getFullYear() - 1}-12-31` })],
  ['custom', 'Custom…', null],
];
export const rangeLabel = (r) => (!r.from && !r.to ? 'All time' : `${fmt(r.from)} – ${fmt(r.to)}`);
const fmt = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '…');

/** Iter 60 — CEO report period: explicit presets + a genuinely custom from–to. `value` = {preset, from, to}. */
export function DateRangePicker({ value, onChange, testIdPrefix = 'ceo-range' }) {
  const [custom, setCustom] = useState({ from: value.from || '', to: value.to || '' });
  const pick = (id) => {
    const p = PRESETS.find(x => x[0] === id);
    if (id === 'custom') { onChange({ preset: 'custom', from: custom.from || null, to: custom.to || null }); return; }
    onChange({ preset: id, ...(p[2](new Date())) });
  };
  const setC = (k, v) => { const next = { ...custom, [k]: v }; setCustom(next); if (next.from && next.to && next.from <= next.to) onChange({ preset: 'custom', from: next.from, to: next.to }); };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`${testIdPrefix}-picker`}>
      <CalendarRange className="h-4 w-4 text-slate-500" />
      <select value={value.preset || 'all'} onChange={e => pick(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" data-testid={`${testIdPrefix}-preset`}>
        {PRESETS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      {value.preset === 'custom' && (<>
        <Input type="date" value={custom.from} onChange={e => setC('from', e.target.value)} className="h-9 w-40" data-testid={`${testIdPrefix}-from`} />
        <span className="text-xs text-slate-400">to</span>
        <Input type="date" value={custom.to} min={custom.from || undefined} onChange={e => setC('to', e.target.value)} className="h-9 w-40" data-testid={`${testIdPrefix}-to`} />
      </>)}
      <span className="text-xs text-slate-600" data-testid={`${testIdPrefix}-label`}>{rangeLabel(value)}</span>
    </div>
  );
}
