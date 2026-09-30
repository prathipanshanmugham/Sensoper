import { useCallback, useEffect, useState } from 'react';
import { catalogueAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Plus, Check, X, Trash2, Loader2, Pencil } from 'lucide-react';

const UNITS = [['per_kw', 'per kW'], ['per_unit', 'per unit'], ['per_km', 'per km'], ['flat', 'flat']];
const SCOPES = ['any', 'on-grid', 'off-grid', 'hybrid', 'solar-pump'];
const blank = { name: '', system_type_scope: 'any', unit: 'per_kw', rate: '', margin_pct: '', gst_pct: '', active: true };
const err = (e, fb) => formatApiErrorDetail(e.response?.data?.detail) || fb;

/** Iter 60 — Services tab: structure / cabling / installation rates as ONE inline-editable table (no dialogs). */
export function ServiceRatesTable() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null); // {id|null, ...fields}
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const r = await catalogueAPI.list('service'); setRows(r.data || []); } catch (e) { toast.error(err(e, 'Could not load service rates')); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!edit.name.trim() || edit.rate === '') { toast.error('Name and rate are required'); return; }
    setSaving(true);
    try {
      const { id, ...data } = edit;
      const payload = { ...data, rate: parseFloat(data.rate), margin_pct: data.margin_pct === '' ? null : parseFloat(data.margin_pct), gst_pct: data.gst_pct === '' ? null : parseFloat(data.gst_pct) };
      if (id) await catalogueAPI.update('service', id, payload); else await catalogueAPI.create('service', payload);
      toast.success('Saved'); setEdit(null); load();
    } catch (e) { toast.error(err(e, 'Save failed')); } finally { setSaving(false); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Remove "${r.name}"?`)) return;
    try { await catalogueAPI.delete('service', r.id); toast.success('Removed'); load(); } catch (e) { toast.error(err(e, 'Remove failed')); }
  };
  const cell = (k, type = 'text', extra = {}) => <Input type={type} value={edit[k] ?? ''} onChange={e => setEdit(p => ({ ...p, [k]: e.target.value }))} className="h-8 text-xs" data-testid={`svc-${k}`} {...extra} />;
  const sel = (k, opts) => <select value={edit[k]} onChange={e => setEdit(p => ({ ...p, [k]: e.target.value }))} className="h-8 rounded-md border border-slate-300 bg-white px-1 text-xs" data-testid={`svc-${k}`}>{opts.map(o => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}</select>;
  const missing = (v) => v === null || v === undefined || v === '';

  const editRow = (r) => (
    <tr key={r.id || 'new'} className="bg-emerald-50/50" data-testid={`svc-row-edit-${r.id || 'new'}`}>
      <td className="px-2 py-1.5">{cell('name', 'text', { placeholder: 'e.g. Installation & Commissioning — On-Grid' })}</td>
      <td className="px-2 py-1.5">{sel('system_type_scope', SCOPES)}</td>
      <td className="px-2 py-1.5">{sel('unit', UNITS)}</td>
      <td className="px-2 py-1.5">{cell('rate', 'number', { step: 50 })}</td>
      <td className="px-2 py-1.5">{cell('margin_pct', 'number', { step: 0.5, placeholder: 'required' })}</td>
      <td className="px-2 py-1.5">{cell('gst_pct', 'number', { step: 0.5, placeholder: 'required' })}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <Button size="sm" onClick={save} disabled={saving} className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="svc-save">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</Button>
        <Button size="sm" variant="ghost" onClick={() => setEdit(null)} className="h-7 px-2 ml-1" data-testid="svc-cancel"><X className="h-3.5 w-3.5" /></Button>
      </td>
    </tr>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto" data-testid="service-rates-table">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr>
          <th className="text-left px-2 py-2">Service</th><th className="text-left px-2 py-2">Scope</th><th className="text-left px-2 py-2">Unit</th><th className="text-left px-2 py-2">Rate ₹</th><th className="text-left px-2 py-2">Margin %</th><th className="text-left px-2 py-2">GST %</th><th className="px-2 py-2" />
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {loading && <tr><td colSpan={7} className="px-3 py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>}
          {rows.map(r => edit?.id === r.id ? editRow(r) : (
            <tr key={r.id} className="hover:bg-slate-50" data-testid={`svc-row-${r.id}`}>
              <td className="px-2 py-1.5 font-medium text-slate-800">{r.name}{r.active === false && <span className="ml-1 text-[10px] text-slate-400">(inactive)</span>}</td>
              <td className="px-2 py-1.5 text-slate-600 text-xs">{r.system_type_scope || 'any'}</td>
              <td className="px-2 py-1.5 text-slate-600 text-xs">{(UNITS.find(u => u[0] === r.unit) || [])[1] || r.unit}</td>
              <td className="px-2 py-1.5 tabular-nums">₹{Number(r.rate || 0).toLocaleString('en-IN')}</td>
              <td className="px-2 py-1.5">{missing(r.margin_pct) ? <span className="rounded bg-amber-100 text-amber-800 px-1.5 text-[10px]">missing</span> : `${r.margin_pct}%`}</td>
              <td className="px-2 py-1.5">{missing(r.gst_pct) ? <span className="rounded bg-amber-100 text-amber-800 px-1.5 text-[10px]">missing</span> : `${r.gst_pct}%`}</td>
              <td className="px-2 py-1.5 whitespace-nowrap text-right">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEdit({ ...blank, ...r, rate: r.rate ?? '', margin_pct: r.margin_pct ?? '', gst_pct: r.gst_pct ?? '' })} data-testid={`svc-edit-${r.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => remove(r)} data-testid={`svc-delete-${r.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              </td>
            </tr>
          ))}
          {edit && !edit.id && editRow({})}
        </tbody>
      </table>
      <div className="p-2 border-t border-slate-100">
        <Button size="sm" variant="outline" onClick={() => setEdit({ ...blank })} disabled={!!edit} className="h-8 gap-1" data-testid="svc-add"><Plus className="h-3.5 w-3.5" />Add service rate</Button>
      </div>
    </div>
  );
}
