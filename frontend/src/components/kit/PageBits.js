/* Small shared pieces for the Oct 2026 pages (Brands, HR, Loans, Calendar, Vendors, Purchase requests):
 * page header, pill tabs, number tiles, empty states, stars, chips and date / money formatting. */
import { useRef, useState } from 'react';
import { Loader2, Paperclip, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadAPI } from '../../utils/api';

export const inr = (v) => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
export const inrShort = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return inr(n);
};
export const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', opts) : '—');
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const addDaysISO = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const errText = (e, fallback = 'Something went wrong') => {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d[0]?.msg || fallback;
  return typeof d === 'string' ? d : fallback;
};

export function PageHeader({ icon: Icon, title, sub, children, testid }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3" data-testid={testid}>
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 font-['Outfit'] text-2xl font-bold text-slate-900">{Icon && <Icon className="h-6 w-6 text-emerald-600" />}{title}</h1>
        {sub && <p className="text-sm text-slate-500">{sub}</p>}
      </div>
      {children && <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">{children}</div>}
    </div>
  );
}

export function PillTabs({ tabs, value, onChange, label = 'Sections', testid = 'tab' }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4" role="tablist" aria-label={label}>
      <div className="flex w-max gap-1.5">
        {tabs.filter(Boolean).map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm ${value === k ? 'border-emerald-300 bg-emerald-100 font-medium text-emerald-800' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200'}`}
            data-testid={`${testid}-${k}`}>
            {l}{n > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{n}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Tile({ label, value, sub, icon: Icon, tone, testid, onClick }) {
  const toneCls = tone === 'bad' ? 'border-rose-200 bg-rose-50/60' : tone === 'warn' ? 'border-amber-200 bg-amber-50/60' : tone === 'good' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white';
  const body = (
    <div className={`h-full rounded-xl border p-3 text-left ${toneCls}`} data-testid={testid}>
      <div className="mb-1 flex items-center gap-1.5 text-slate-500">{Icon && <Icon className="h-4 w-4" />}<span className="text-[11px] font-medium uppercase tracking-wide">{label}</span></div>
      <p className="font-['Outfit'] text-xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
  return onClick ? <button type="button" onClick={onClick} className="block h-full w-full">{body}</button> : body;
}

export function Tiles({ children }) {
  return <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">{children}</div>;
}

export function Empty({ icon: Icon, title, text, children }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
      {Icon && <Icon className="mx-auto h-8 w-8 text-slate-300" />}
      <p className="mt-2 text-sm font-medium text-slate-700">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">{text}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>;
}

export function Card({ title, sub, action, children, testid, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-3 sm:p-4 ${className}`} data-testid={testid}>
      {(title || action) && (
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">{title && <p className="text-sm font-semibold text-slate-900">{title}</p>}{sub && <p className="text-[11px] text-slate-500">{sub}</p>}</div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Chip({ children, tone = 'slate', className = '', testid }) {
  const t = { slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200', amber: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
    red: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200', blue: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200', violet: 'bg-violet-50 text-violet-800 ring-1 ring-violet-200' }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${t} ${className}`} data-testid={testid}>{children}</span>;
}

/** Read-only stars, e.g. 4.2 ★ (text too, so it never relies on colour alone). */
export function Stars({ value, count, size = 'sm' }) {
  if (value == null) return <span className="text-[11px] text-slate-400">Not rated</span>;
  const h = size === 'lg' ? 'h-4 w-4' : 'h-3 w-3';
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Rated ${value} out of 5`}>
      <span className="flex">{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`${h} ${value >= i - 0.25 ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />)}</span>
      <span className="text-[11px] font-semibold tabular-nums text-slate-700">{Number(value).toFixed(1)}</span>
      {count != null && <span className="text-[11px] text-slate-400">({count})</span>}
    </span>
  );
}

/** 1–5 star picker. */
export function StarInput({ label, value, onChange, testid }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-slate-700">{label}</span>
      <span className="flex" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? 's' : ''}`} onClick={() => onChange(i)} className="p-1" data-testid={`${testid}-${i}`}>
            <Star className={`h-6 w-6 ${value >= i ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
          </button>
        ))}
      </span>
    </div>
  );
}

/** Attach a PDF / Word file / picture; shows the file name with a remove button. */
export function FileAttach({ value, onChange, label = 'Attach file', testid = 'file-attach', accept = 'application/pdf,image/png,image/jpeg,image/webp,.doc,.docx' }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error('The file must be under 10 MB'); return; }
    setBusy(true);
    try { const r = await uploadAPI.uploadDocument(f); onChange(r.data.storage_path, f.name); } catch (err) { toast.error(errText(err, 'Upload failed')); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={pick} data-testid={`${testid}-input`} />
      {value ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <a href={uploadAPI.getFileUrl(value)} target="_blank" rel="noreferrer" className="truncate text-emerald-700 hover:underline">{value.split('/').pop()}</a>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove file" className="text-slate-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
        </span>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-emerald-300 hover:text-emerald-700" data-testid={testid}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}{label}
        </button>
      )}
    </div>
  );
}

/** Native date / select / text field with a label — the same height everywhere (44px for thumbs). */
export const inputCls = 'h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}
