import { useState } from 'react';
import { ecommerceAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Loader2, Plus, Pencil, Check, X, Store } from 'lucide-react';

const EMPTY = { name: '', platform_type: 'marketplace', seller_id: '', store_url: '', commission_pct: '' };

function PlatformForm({ value, onChange, onSubmit, onCancel, saving, error, submitLabel }) {
  return (
    <div className="grid grid-cols-2 gap-2 p-3 rounded-lg border border-emerald-200 bg-emerald-50/40" data-testid="platform-form">
      <div className="space-y-1 col-span-2"><Label className="text-xs">Name</Label><Input value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="Amazon, Flipkart, Own website…" className="h-8" data-testid="platform-name-input" /></div>
      <div className="space-y-1"><Label className="text-xs">Type</Label>
        <Select value={value.platform_type} onValueChange={v => onChange({ ...value, platform_type: v })}>
          <SelectTrigger className="h-8" data-testid="platform-type-select"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="marketplace">Marketplace</SelectItem><SelectItem value="custom_website">Custom Website</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="space-y-1"><Label className="text-xs">Reference commission %</Label><Input type="number" value={value.commission_pct} onChange={e => onChange({ ...value, commission_pct: e.target.value })} className="h-8" data-testid="platform-commission-input" /></div>
      <div className="space-y-1"><Label className="text-xs">Seller ID</Label><Input value={value.seller_id} onChange={e => onChange({ ...value, seller_id: e.target.value })} className="h-8" data-testid="platform-seller-input" /></div>
      <div className="space-y-1"><Label className="text-xs">Store URL</Label><Input value={value.store_url} onChange={e => onChange({ ...value, store_url: e.target.value })} className="h-8" data-testid="platform-url-input" /></div>
      {error && <p className="col-span-2 text-xs text-red-600" data-testid="platform-form-error">{error}</p>}
      <p className="col-span-2 text-[11px] text-slate-500 italic">Reference only — each product listing carries its own commission rate.</p>
      <div className="col-span-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="platform-cancel-btn"><X className="h-3.5 w-3.5" /></Button>
        <Button size="sm" onClick={onSubmit} disabled={saving || !value.name.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid="platform-submit-btn">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{submitLabel}</Button>
      </div>
    </div>
  );
}

export function PlatformsDialog({ open, onOpenChange, platforms, onChanged, isAdmin }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => { setAdding(false); setEditingId(null); setForm(EMPTY); setError(''); };
  const submit = async () => {
    setSaving(true); setError('');
    try {
      const payload = { ...form, commission_pct: parseFloat(form.commission_pct) || 0 };
      if (editingId) await ecommerceAPI.platforms.update(editingId, payload); else await ecommerceAPI.platforms.create(payload);
      reset(); onChanged();
    } catch (e) { setError(e.response?.data?.detail || 'Failed to save platform'); } finally { setSaving(false); }
  };
  const archive = async (p) => {
    if (!window.confirm(`Archive "${p.name}"? Its listings stay in history but it disappears from the Products grid.`)) return;
    try { await ecommerceAPI.platforms.remove(p.id); onChanged(); } catch (e) { setError(e.response?.data?.detail || 'Failed to archive'); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg" data-testid="platforms-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Store className="h-4 w-4 text-emerald-600" />Sales Platforms</DialogTitle>
          <DialogDescription>Each platform becomes a column in the Products grid.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {platforms.map(p => editingId === p.id ? (
            <PlatformForm key={p.id} value={form} onChange={setForm} onSubmit={submit} onCancel={reset} saving={saving} error={error} submitLabel="Save" />
          ) : (
            <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200" data-testid={`platform-row-${p.id}`}>
              <div>
                <p className="text-sm font-medium text-slate-900">{p.name}</p>
                <p className="text-[11px] text-slate-500 capitalize">{p.platform_type?.replace('_', ' ')} · ref. commission {p.commission_pct}%{p.seller_id ? ` · ${p.seller_id}` : ''}</p>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setAdding(false); setEditingId(p.id); setForm({ name: p.name || '', platform_type: p.platform_type || 'marketplace', seller_id: p.seller_id || '', store_url: p.store_url || '', commission_pct: p.commission_pct ?? '' }); }} data-testid={`edit-platform-${p.id}`}><Pencil className="h-3.5 w-3.5 text-slate-500" /></Button>
                {isAdmin && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => archive(p)} data-testid={`archive-platform-${p.id}`}><X className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>
          ))}
          {platforms.length === 0 && !adding && <p className="text-sm text-slate-500 py-4 text-center">No platforms yet — add Amazon, Flipkart or your own store.</p>}
          {adding && <PlatformForm value={form} onChange={setForm} onSubmit={submit} onCancel={reset} saving={saving} error={error} submitLabel="Add" />}
        </div>
        {!adding && !editingId && <Button variant="outline" onClick={() => { setForm(EMPTY); setAdding(true); }} className="gap-1.5 w-full" data-testid="add-platform-btn"><Plus className="h-4 w-4" />Add Platform</Button>}
      </DialogContent>
    </Dialog>
  );
}
