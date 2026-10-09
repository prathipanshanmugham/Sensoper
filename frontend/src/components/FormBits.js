/* Small, phone-friendly building blocks shared by the Daily report and Site diary screens. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, Search, Check, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { dayLabel, localDate, shiftDate } from '../lib/format';

export function DateNav({ value, onChange, max = localDate(), testid = 'date-nav' }) {
  const atMax = value >= max;
  return (
    <div className="flex items-center gap-1" data-testid={testid}>
      <button type="button" onClick={() => onChange(shiftDate(value, -1))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label="Previous day" data-testid={`${testid}-prev`}><ChevronLeft className="h-4 w-4" /></button>
      <label className="relative flex h-10 min-w-[150px] cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 hover:bg-slate-50">
        <span>{dayLabel(value)}</span>
        {value !== localDate() && <span className="ml-1.5 font-normal text-slate-500">{value.slice(8)}/{value.slice(5, 7)}</span>}
        <input type="date" value={value} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Pick a date" data-testid={`${testid}-input`} />
      </label>
      <button type="button" disabled={atMax} onClick={() => onChange(shiftDate(value, 1))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40" aria-label="Next day" data-testid={`${testid}-next`}><ChevronRight className="h-4 w-4" /></button>
      {value !== localDate() && <button type="button" onClick={() => onChange(localDate())} className="ml-1 h-10 rounded-lg px-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">Today</button>}
    </div>
  );
}

/** A numbered, collapsible form section with a one-line summary when closed. */
export function Section({ n, title, hint, summary, open, onToggle, children, testid, action }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid={testid}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${summary ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{summary ? <Check className="h-4 w-4" /> : n}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-['Outfit'] text-[15px] font-semibold text-slate-900">{title}</span>
            <span className="block truncate text-xs text-slate-500">{open ? hint : (summary || hint)}</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {action}
      </div>
      {open && <div className="border-t border-slate-100 px-4 py-4">{children}</div>}
    </section>
  );
}

export function Stepper({ value, onChange, min = 0, label, testid }) {
  const v = Number(value) || 0;
  return (
    <div className="flex items-center gap-1" data-testid={testid}>
      <button type="button" onClick={() => onChange(Math.max(min, v - 1))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 active:scale-95" aria-label={`Less ${label || ''}`}><Minus className="h-4 w-4" /></button>
      <input inputMode="numeric" value={v} onChange={(e) => onChange(Math.max(min, parseInt(e.target.value.replace(/\D/g, '') || '0', 10)))} className="h-10 w-12 rounded-lg border border-transparent text-center text-lg font-semibold tabular-nums text-slate-900 focus:border-slate-200 focus:outline-none" aria-label={label} />
      <button type="button" onClick={() => onChange(v + 1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 active:scale-95" aria-label={`More ${label || ''}`}><Plus className="h-4 w-4" /></button>
    </div>
  );
}

export function Chip({ active, onClick, children, testid, done }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-2 text-sm font-medium transition-colors active:scale-95 ${active ? 'border-slate-900 bg-slate-900 text-white' : done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
      data-testid={testid}>
      {(active || done) && <Check className="h-3.5 w-3.5" />}{children}
    </button>
  );
}

export function Field({ label, children, hint, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputCls = 'h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
export const textareaCls = 'min-h-[84px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';

/** Searchable project picker. `projects` = [{id, customer:{name,phone}, reference_number, location:{district}, status}] */
export function ProjectPicker({ projects, value, onChange, placeholder = 'Choose a project', testid = 'project-picker', allowClear = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  const selected = projects.find((p) => p.id === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = s ? projects.filter((p) => [p.customer?.name, p.customer?.phone, p.reference_number, p.location?.district].some((v) => (v || '').toLowerCase().includes(s))) : projects;
    return rows.slice(0, 60);
  }, [projects, q]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); else setQ(''); }, [open]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`flex h-11 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-[15px] hover:border-slate-300 ${selected ? 'text-slate-900' : 'text-slate-400'}`} data-testid={testid}>
          <span className="min-w-0 flex-1 truncate">{selected ? <>{selected.customer?.name || 'Unnamed'} <span className="text-slate-400">· {selected.reference_number}</span></> : placeholder}</span>
          {allowClear && selected ? <X className="h-4 w-4 shrink-0 text-slate-400" onClick={(e) => { e.stopPropagation(); onChange(''); }} /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,420px)] p-0">
        <div className="relative border-b border-slate-100">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or ref" className="h-11 w-full bg-transparent pl-9 pr-3 text-[15px] outline-none" data-testid={`${testid}-search`} />
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No project matches.</li>}
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onChange(p.id); setOpen(false); }} className={`flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 ${p.id === value ? 'bg-emerald-50' : ''}`} data-testid={`${testid}-option-${p.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{p.customer?.name || 'Unnamed'}</span>
                  <span className="block truncate text-xs text-slate-500">{[p.reference_number, p.location?.district, p.customer?.phone].filter(Boolean).join(' · ')}</span>
                </span>
                {p.id === value && <Check className="h-4 w-4 text-emerald-600" />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
