import { useCallback, useEffect, useState } from 'react';
import { pricingSlabsAPI, kitCategoriesAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { slabPriceFor } from '../utils/solarCalc';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Plus, Pencil, Trash2, Loader2, Layers, X } from 'lucide-react';

const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;
const UNIT_LABEL = { kw: 'kW', hp: 'HP', unit: 'unit' };
const DEFAULT_UNIT = { 'on-grid': 'kw', 'off-grid': 'kw', hybrid: 'kw', 'solar-pump': 'hp' };
const today = () => new Date().toISOString().slice(0, 10);
const blankRow = () => ({ _key: Math.random().toString(36).slice(2), from_value: '', to_value: '', rate_per_unit: '', effective_from: today() });
const err = (e, fb) => formatApiErrorDetail(e.response?.data?.detail) || fb;

/** Iter 59 — slab package rates per kit category (kW / HP / unit). Flat rate × size; boundary → lower slab; latest effective_from wins. */
export function SlabRatesCard() {
  const [docs, setDocs] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([pricingSlabsAPI.list({ include_inactive: true }), kitCategoriesAPI.list()]);
      setDocs(d.data || []); setCats(c.data || []);
    } catch (e) { toast.error(err(e, 'Could not load slab rates')); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (d) => {
    if (!window.confirm(`Remove all slab rates for ${d.category_label}?`)) return;
    try { await pricingSlabsAPI.remove(d.id); toast.success('Removed'); load(); } catch (e) { toast.error(err(e, 'Remove failed')); }
  };
  const free = cats.filter(c => !docs.some(d => d.category === c.slug));

  return (
    <div className="rounded-lg border border-slate-200 bg-white" data-testid="slab-rates-card">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-slate-100">
        <div><p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Layers className="h-4 w-4 text-emerald-600" />Slab package rates</p>
          <p className="text-[11px] text-slate-500">₹ per kW / HP / unit by size band, per kit category. Used by the calculator's "Slab rate" mode and shown on kits. Size on a boundary takes the lower band.</p></div>
        <Button size="sm" variant="outline" onClick={() => setEditing({ category: free[0]?.slug || '', unit: DEFAULT_UNIT[free[0]?.slug] || 'unit', gst_pct: '', slabs: [blankRow()], active: true })} disabled={!free.length} className="gap-1" data-testid="slab-add-btn"><Plus className="h-3.5 w-3.5" />Add category rates</Button>
      </div>
      {loading ? <div className="p-4"><Loader2 className="h-4 w-4 animate-spin" /></div> : docs.length === 0 ? (
        <p className="p-4 text-xs text-slate-400" data-testid="slab-empty">No slab rates yet. Add e.g. On-Grid: 1–3 kW ₹60,000/kW · 3–5 kW ₹55,000/kW · 5–10 kW ₹50,000/kW · 10+ kW ₹45,000/kW.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.map(d => (
            <li key={d.id} className={`px-3 py-2.5 ${d.active ? '' : 'opacity-60'}`} data-testid={`slab-doc-${d.category}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-slate-800">{d.category_label}</span>
                <Badge variant="outline" className="text-[10px]">per {UNIT_LABEL[d.unit] || d.unit}</Badge>
                {d.gst_pct !== null && d.gst_pct !== undefined ? <Badge variant="outline" className="text-[10px]">GST {d.gst_pct}%</Badge> : <Badge className="bg-amber-100 text-amber-800 text-[10px]">GST% not set</Badge>}
                {!d.active && <Badge className="bg-slate-200 text-slate-700 text-[10px]">inactive</Badge>}
                <span className="flex-1" />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing({ ...d, gst_pct: d.gst_pct ?? '', slabs: d.slabs.map(s => ({ ...s, _key: Math.random().toString(36).slice(2), to_value: s.to_value ?? '' })) })} data-testid={`slab-edit-${d.category}`}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => remove(d)} data-testid={`slab-remove-${d.category}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d.slabs.map((s, i) => <span key={i} className={`text-[11px] rounded-full border px-2 py-0.5 ${String(s.effective_from) > today() ? 'border-dashed border-slate-300 text-slate-400' : 'border-slate-200 text-slate-700 bg-slate-50'}`} title={`effective ${s.effective_from}`} data-testid={`slab-chip-${d.category}-${i}`}>{s.from_value}–{s.to_value ?? '∞'} {UNIT_LABEL[d.unit]} · {inr(s.rate_per_unit)}{String(s.effective_from) > today() ? ` · from ${s.effective_from}` : ''}</span>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <SlabEditor doc={editing} cats={cats} isNew={!editing.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function SlabEditor({ doc, cats, isNew, onClose, onSaved }) {
  const [form, setForm] = useState(doc);
  const [saving, setSaving] = useState(false);
  const [testValue, setTestValue] = useState('');
  const setRow = (i, k, v) => setForm(f => { const slabs = [...f.slabs]; slabs[i] = { ...slabs[i], [k]: v }; return { ...f, slabs }; });
  const preview = slabPriceFor({ ...form, active: true, slabs: form.slabs.filter(s => s.from_value !== '' && s.rate_per_unit !== '') }, parseFloat(testValue));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { unit: form.unit, gst_pct: form.gst_pct === '' ? null : parseFloat(form.gst_pct), active: form.active !== false,
        slabs: form.slabs.map(s => ({ from_value: parseFloat(s.from_value), to_value: s.to_value === '' || s.to_value === null ? null : parseFloat(s.to_value), rate_per_unit: parseFloat(s.rate_per_unit), effective_from: s.effective_from })) };
      if (isNew) await pricingSlabsAPI.create({ ...payload, category: form.category }); else await pricingSlabsAPI.update(form.id, payload);
      toast.success('Slab rates saved'); onSaved();
    } catch (e) { toast.error(err(e, 'Save failed')); } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="slab-editor">
        <DialogHeader><DialogTitle>{isNew ? 'New slab rates' : `Slab rates — ${doc.category_label}`}</DialogTitle>
          <DialogDescription>Flat ₹/{UNIT_LABEL[form.unit]} for the whole system in each size band (not progressive). Leave "to" blank for the open-ended top band. Add a second row for the same band with a later "effective from" to schedule a price change.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1"><Label className="text-xs">Category</Label>
            {isNew ? (
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v, unit: DEFAULT_UNIT[v] || 'unit' }))}><SelectTrigger className="h-9" data-testid="slab-category-select"><SelectValue placeholder="Pick category" /></SelectTrigger>
                <SelectContent>{cats.map(c => <SelectItem key={c.slug} value={c.slug} data-testid={`slab-category-option-${c.slug}`}>{c.label}</SelectItem>)}</SelectContent></Select>
            ) : <Input value={doc.category_label} disabled className="h-9" />}
          </div>
          <div className="space-y-1"><Label className="text-xs">Size axis</Label>
            <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}><SelectTrigger className="h-9" data-testid="slab-unit-select"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="kw">kW (system size)</SelectItem><SelectItem value="hp">HP (pump)</SelectItem><SelectItem value="unit">Units (cameras, lights…)</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">GST % on package</Label><Input type="number" step="0.1" value={form.gst_pct} onChange={e => setForm(f => ({ ...f, gst_pct: e.target.value }))} placeholder="required" className="h-9" data-testid="slab-gst-input" /></div>
        </div>
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_1fr_1.3fr_1.3fr_28px] gap-2 text-[10px] uppercase tracking-wider text-slate-400 px-0.5"><span>From</span><span>To (blank = ∞)</span><span>₹ per {UNIT_LABEL[form.unit]}</span><span>Effective from</span><span /></div>
          {form.slabs.map((s, i) => (
            <div key={s._key} className="grid grid-cols-[1fr_1fr_1.3fr_1.3fr_28px] gap-2 items-center" data-testid={`slab-row-${i}`}>
              <Input type="number" step="0.5" value={s.from_value} onChange={e => setRow(i, 'from_value', e.target.value)} className="h-9" data-testid={`slab-from-${i}`} />
              <Input type="number" step="0.5" value={s.to_value ?? ''} onChange={e => setRow(i, 'to_value', e.target.value)} placeholder="∞" className="h-9" data-testid={`slab-to-${i}`} />
              <Input type="number" step="100" value={s.rate_per_unit} onChange={e => setRow(i, 'rate_per_unit', e.target.value)} className="h-9" data-testid={`slab-rate-${i}`} />
              <Input type="date" value={s.effective_from} onChange={e => setRow(i, 'effective_from', e.target.value)} className="h-9" data-testid={`slab-eff-${i}`} />
              <Button size="icon" variant="ghost" className="h-8 w-7 text-red-500" onClick={() => setForm(f => ({ ...f, slabs: f.slabs.filter((_, j) => j !== i) }))} data-testid={`slab-row-remove-${i}`}><X className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, slabs: [...f.slabs, blankRow()] }))} className="h-8 gap-1" data-testid="slab-row-add"><Plus className="h-3.5 w-3.5" />Add band</Button>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-slate-50 border border-slate-200 p-2 text-xs" data-testid="slab-preview">
          <span className="text-slate-600">Try a size:</span>
          <Input type="number" step="0.5" value={testValue} onChange={e => setTestValue(e.target.value)} placeholder={`e.g. 3 ${UNIT_LABEL[form.unit]}`} className="h-8 w-28" data-testid="slab-test-input" />
          <span className="text-slate-800" data-testid="slab-test-result">{testValue && preview ? `${preview.from_value}–${preview.to_value ?? '∞'} band · ${inr(preview.rate_per_unit)} × ${testValue} = ${inr(preview.total)}${preview.gst_pct !== null ? ` + GST ${inr(preview.gst_amount)}` : ''}` : testValue ? 'No band covers this size' : ''}</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={form.active !== false} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} data-testid="slab-active-checkbox" />Active (uncheck to hide from the calculator and kits without deleting)</label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.category || form.slabs.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="slab-save-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
