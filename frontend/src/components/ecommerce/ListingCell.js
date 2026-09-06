import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Check, X, Pencil, Plus, Loader2 } from 'lucide-react';

export const LISTING_STATUS_COLORS = { draft: 'bg-slate-100 text-slate-600', live: 'bg-emerald-100 text-emerald-800', paused: 'bg-amber-100 text-amber-800', delisted: 'bg-red-100 text-red-800', out_of_stock: 'bg-orange-100 text-orange-800' };
const STATUSES = ['draft', 'live', 'paused', 'out_of_stock', 'delisted'];

export function ListingCell({ itemId, platformId, listing, canManage, onSave }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ listed_price: '', platform_commission_pct: '', status: 'draft' });
  const tid = `listing-cell-${itemId}-${platformId}`;

  const start = () => {
    setForm({ listed_price: listing?.listed_price ?? '', platform_commission_pct: listing?.platform_commission_pct ?? '', status: listing?.status || 'draft' });
    setErr(''); setEditing(true);
  };
  const save = async () => {
    setSaving(true); setErr('');
    try {
      await onSave(itemId, platformId, {
        listed_price: form.listed_price === '' ? null : parseFloat(form.listed_price),
        platform_commission_pct: form.platform_commission_pct === '' ? null : parseFloat(form.platform_commission_pct),
        status: form.status,
      });
      setEditing(false);
    } catch (e) { setErr(e.response?.data?.detail || 'Save failed'); } finally { setSaving(false); }
  };

  if (editing) {
    return (
      <div className="space-y-1 min-w-[150px]" data-testid={`${tid}-editor`}>
        <Input type="number" placeholder="Price ₹" value={form.listed_price} onChange={e => setForm(f => ({ ...f, listed_price: e.target.value }))} className="h-7 text-xs" data-testid={`${tid}-price-input`} />
        <Input type="number" placeholder="Commission %" value={form.platform_commission_pct} onChange={e => setForm(f => ({ ...f, platform_commission_pct: e.target.value }))} className="h-7 text-xs" data-testid={`${tid}-commission-input`} />
        <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
          <SelectTrigger className="h-7 text-xs" data-testid={`${tid}-status-select`}><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}</SelectContent>
        </Select>
        {err && <p className="text-[10px] text-red-600 leading-tight" data-testid={`${tid}-error`}>{err}</p>}
        <div className="flex gap-1">
          <Button size="sm" className="h-6 px-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={save} disabled={saving} data-testid={`${tid}-save-btn`}>{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}</Button>
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditing(false)} data-testid={`${tid}-cancel-btn`}><X className="h-3 w-3" /></Button>
        </div>
      </div>
    );
  }

  if (!listing) {
    return canManage
      ? <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400 hover:text-emerald-700 gap-1" onClick={start} data-testid={`${tid}-add-btn`}><Plus className="h-3 w-3" />List</Button>
      : <span className="text-xs text-slate-300">—</span>;
  }

  return (
    <div className="group flex items-start gap-1" data-testid={tid}>
      <div>
        <p className="text-sm font-medium text-slate-900" data-testid={`${tid}-price`}>₹{(listing.listed_price ?? 0).toLocaleString('en-IN')}</p>
        <p className="text-[11px] text-slate-500" data-testid={`${tid}-commission`}>{listing.platform_commission_pct != null ? `${listing.platform_commission_pct}% comm.` : <span className="text-amber-600">no commission set</span>}</p>
        <Badge className={`${LISTING_STATUS_COLORS[listing.status] || ''} text-[10px] px-1.5 py-0 mt-0.5`} data-testid={`${tid}-status`}>{listing.status?.replace('_', ' ')}</Badge>
      </div>
      {canManage && <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={start} data-testid={`${tid}-edit-btn`}><Pencil className="h-3 w-3 text-slate-500" /></Button>}
    </div>
  );
}
