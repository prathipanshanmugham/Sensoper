import { useEffect, useState } from 'react';
import { catalogueAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Loader2, Check, X, Pencil } from 'lucide-react';

const FIELDS = [
  { key: 'rounding_step', label: 'Round final totals to', line: 'Only the grand total of quotes, kits and invoices is rounded — never a line price.', type: 'select', opts: [[1, '₹1'], [10, '₹10'], [100, '₹100']] },
  { key: 'rounding_mode', label: 'Rounding direction', line: 'Nearest, always up, or always down.', type: 'select', opts: [['nearest', 'Nearest'], ['up', 'Always up'], ['down', 'Always down']] },
  { key: 'credit_interest_monthly_pct', label: 'Overdue credit interest (% per month)', line: 'What a slow-paying customer costs you on the Profit Leakage report; never billed to the customer.', type: 'number', step: 0.1 },
  { key: 'string_low_temp_default_c', label: 'Coldest design temperature (°C)', line: 'Coldest morning used to check a panel string stays under the inverter voltage limit.', type: 'number', step: 1 },
];

/** Iter 60 — Company Defaults: four company-wide numbers, each edited in place with save / cancel. */
export function CompanyDefaultsCard() {
  const [config, setConfig] = useState(null);
  const [edit, setEdit] = useState(null); // key being edited
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { catalogueAPI.getConfig().then(r => setConfig(r.data)).catch(() => toast.error('Could not load company defaults')); }, []);

  const save = async (f) => {
    setSaving(true);
    try {
      const { _id, key, updated_at, ...payload } = config;
      payload[f.key] = f.type === 'number' ? parseFloat(val) : (f.key === 'rounding_step' ? parseInt(val, 10) : val);
      const r = await catalogueAPI.updateConfig(payload); setConfig(r.data); setEdit(null); toast.success('Saved');
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Save failed'); } finally { setSaving(false); }
  };
  const show = (f) => { const v = config?.[f.key]; if (f.type === 'select') return (f.opts.find(o => String(o[0]) === String(v ?? f.opts[0][0])) || [])[1]; return v ?? '—'; };
  const example = () => { const st = config?.rounding_step || 1, md = config?.rounding_mode || 'nearest', v = 123456.7; return (md === 'up' ? Math.ceil(v / st) * st : md === 'down' ? Math.floor(v / st) * st : Math.round(v / st) * st).toLocaleString('en-IN'); };

  if (!config) return <div className="p-4"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  return (
    <div id="rounding-rule-card" className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100" data-testid="rounding-rule-card">
      {FIELDS.map(f => (
        <div key={f.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid={`cd-row-${f.key}`}>
          <div className="flex-1 min-w-[240px]"><p className="text-sm font-medium text-slate-800">{f.label}</p><p className="text-[11px] text-slate-500">{f.line}{f.key === 'rounding_mode' && <span data-testid="rounding-example"> e.g. ₹1,23,456.70 → ₹{example()}</span>}</p></div>
          {edit === f.key ? (
            <div className="flex items-center gap-1">
              {f.type === 'select' ? <select value={val} onChange={e => setVal(e.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm" data-testid={`cd-input-${f.key}`}>{f.opts.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
                : <Input type="number" step={f.step} value={val} onChange={e => setVal(e.target.value)} className="h-8 w-28 text-sm" autoFocus onKeyDown={e => { if (e.key === 'Enter') save(f); if (e.key === 'Escape') setEdit(null); }} data-testid={`cd-input-${f.key}`} />}
              <Button size="sm" onClick={() => save(f)} disabled={saving} className="h-8 px-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid={`cd-save-${f.key}`}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)} className="h-8 px-2" data-testid={`cd-cancel-${f.key}`}><X className="h-3.5 w-3.5" /></Button>
            </div>
          ) : (
            <button type="button" onClick={() => { setEdit(f.key); setVal(String(config[f.key] ?? (f.type === 'select' ? f.opts[0][0] : ''))); }} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 h-8 text-sm hover:border-emerald-400" data-testid={`cd-value-${f.key}`}><span className="font-semibold text-slate-900 tabular-nums">{show(f)}</span><Pencil className="h-3 w-3 text-slate-400" /></button>
          )}
        </div>
      ))}
    </div>
  );
}
