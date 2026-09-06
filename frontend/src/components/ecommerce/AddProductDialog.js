import { useState, useMemo } from 'react';
import { ecommerceAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Loader2, Search } from 'lucide-react';

export function AddProductDialog({ open, onOpenChange, items, platforms, existingItemIds, onCreated }) {
  const [query, setQuery] = useState('');
  const [itemId, setItemId] = useState('');
  const [lines, setLines] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(i => !existingItemIds.has(i.id) && (!q || `${i.name} ${i.sku_code || ''}`.toLowerCase().includes(q))).slice(0, 8);
  }, [items, query, existingItemIds]);
  const selected = items.find(i => i.id === itemId);

  const reset = () => { setQuery(''); setItemId(''); setLines({}); setError(''); };
  const toggle = (pid, on) => setLines(l => { const n = { ...l }; if (on) n[pid] = n[pid] || { listed_price: selected?.selling_price ?? '', platform_commission_pct: '', status: 'draft' }; else delete n[pid]; return n; });

  const submit = async () => {
    setSaving(true); setError('');
    try {
      const payload = {
        inventory_item_id: itemId,
        platforms: Object.entries(lines).map(([platform_id, l]) => ({
          platform_id, listed_price: parseFloat(l.listed_price), status: l.status,
          platform_commission_pct: l.platform_commission_pct === '' ? null : parseFloat(l.platform_commission_pct),
        })),
      };
      if (payload.platforms.some(p => Number.isNaN(p.listed_price))) throw new Error('Every selected platform needs a listed price');
      await ecommerceAPI.products.create(payload);
      reset(); onOpenChange(false); onCreated();
    } catch (e) { setError(e.response?.data?.detail || e.message || 'Failed to add product'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl" data-testid="add-product-dialog">
        <DialogHeader>
          <DialogTitle>Add Product to Ecommerce</DialogTitle>
          <DialogDescription>Pick an inventory item, then set price &amp; commission per platform. Stock always comes from Inventory.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded" data-testid="add-product-error">{error}</div>}
          {!selected ? (
            <div className="space-y-2">
              <div className="relative"><Search className="h-4 w-4 absolute left-2.5 top-2.5 text-slate-400" /><Input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search inventory by name or SKU…" className="pl-8" data-testid="add-product-search-input" /></div>
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {candidates.map(i => (
                  <button key={i.id} onClick={() => setItemId(i.id)} className="w-full text-left p-2.5 hover:bg-emerald-50 flex items-center justify-between" data-testid={`add-product-item-${i.id}`}>
                    <div><p className="text-sm font-medium text-slate-900">{i.name}</p><p className="text-[11px] text-slate-500">{i.sku_code || 'no SKU'} · {i.category || '—'}</p></div>
                    <span className="text-xs text-slate-500">stock {i.quantity ?? 0}</span>
                  </button>
                ))}
                {candidates.length === 0 && <p className="p-3 text-sm text-slate-500">No matching inventory items (items already listed are hidden).</p>}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200" data-testid="add-product-selected">
                <div><p className="text-sm font-medium text-slate-900">{selected.name}</p><p className="text-[11px] text-slate-500">{selected.sku_code || 'no SKU'} · stock {selected.quantity ?? 0}{selected.selling_price ? ` · list ₹${selected.selling_price.toLocaleString('en-IN')}` : ''}</p></div>
                <Button size="sm" variant="ghost" onClick={() => { setItemId(''); setLines({}); }} data-testid="add-product-change-item-btn">Change</Button>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">Platforms</Label>
                {platforms.map(p => {
                  const on = !!lines[p.id];
                  return (
                    <div key={p.id} className={`p-2.5 rounded-lg border ${on ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`} data-testid={`add-product-platform-${p.id}`}>
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-800 cursor-pointer">
                        <input type="checkbox" checked={on} onChange={e => toggle(p.id, e.target.checked)} data-testid={`add-product-platform-check-${p.id}`} />{p.name}
                        <span className="text-[11px] text-slate-400 font-normal">ref. {p.commission_pct}%</span>
                      </label>
                      {on && (
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          <Input type="number" placeholder="Price ₹" value={lines[p.id].listed_price} onChange={e => setLines(l => ({ ...l, [p.id]: { ...l[p.id], listed_price: e.target.value } }))} className="h-8 text-sm" data-testid={`add-product-price-${p.id}`} />
                          <Input type="number" placeholder="Commission %" value={lines[p.id].platform_commission_pct} onChange={e => setLines(l => ({ ...l, [p.id]: { ...l[p.id], platform_commission_pct: e.target.value } }))} className="h-8 text-sm" data-testid={`add-product-commission-${p.id}`} />
                          <select value={lines[p.id].status} onChange={e => setLines(l => ({ ...l, [p.id]: { ...l[p.id], status: e.target.value } }))} className="h-8 text-sm rounded-md border border-slate-200 px-2 bg-white" data-testid={`add-product-status-${p.id}`}>
                            <option value="draft">Draft</option><option value="live">Live</option><option value="paused">Paused</option>
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
                {platforms.length === 0 && <p className="text-sm text-amber-700">Add a platform first (Manage Platforms).</p>}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !selected || Object.keys(lines).length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="add-product-submit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `List on ${Object.keys(lines).length || ''} platform${Object.keys(lines).length === 1 ? '' : 's'}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
