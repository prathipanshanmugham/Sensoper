import { useState } from 'react';
import { ecommerceAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Loader2 } from 'lucide-react';

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_ORDER = { platform_id: '', platform_order_id: '', order_date: today(), inventory_item_id: '', quantity: 1, sold_price: '', shipping_cost: 0 };

export function RecordOrderDialog({ open, onOpenChange, platforms, products, items, onSaved }) {
  const [form, setForm] = useState(EMPTY_ORDER);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Items listed on the chosen platform first, then the rest of inventory
  const listedIds = new Set(products.filter(p => form.platform_id && p.listings[form.platform_id]).map(p => p.inventory_item_id));
  const orderedItems = [...items].sort((a, b) => (listedIds.has(b.id) ? 1 : 0) - (listedIds.has(a.id) ? 1 : 0));
  const pickItem = (id) => {
    const listing = products.find(p => p.inventory_item_id === id)?.listings?.[form.platform_id];
    setForm(f => ({ ...f, inventory_item_id: id, sold_price: listing?.listed_price ?? f.sold_price }));
  };

  const submit = async () => {
    setSaving(true); setError('');
    try {
      const listing = products.find(p => p.inventory_item_id === form.inventory_item_id)?.listings?.[form.platform_id];
      await ecommerceAPI.orders.create({
        platform_id: form.platform_id, platform_order_id: form.platform_order_id, order_date: form.order_date,
        shipping_cost: parseFloat(form.shipping_cost) || 0,
        lines: [{ listing_id: listing?.id, inventory_item_id: form.inventory_item_id, quantity: parseFloat(form.quantity), sold_price: parseFloat(form.sold_price) }],
      });
      setForm(EMPTY_ORDER); onOpenChange(false); onSaved();
    } catch (e) { setError(e.response?.data?.detail || 'Failed to record order'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="record-order-dialog">
        <DialogHeader><DialogTitle>Record Order</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded" data-testid="record-order-error">{error}</div>}
          <div className="space-y-1"><Label>Platform</Label>
            <Select value={form.platform_id} onValueChange={v => setForm(f => ({ ...f, platform_id: v }))}>
              <SelectTrigger data-testid="order-platform-select"><SelectValue placeholder="Select platform" /></SelectTrigger>
              <SelectContent>{platforms.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Platform Order ID</Label><Input value={form.platform_order_id} onChange={e => setForm(f => ({ ...f, platform_order_id: e.target.value }))} data-testid="order-id-input" /></div>
            <div className="space-y-1"><Label>Order Date</Label><Input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} data-testid="order-date-input" /></div>
          </div>
          <div className="space-y-1"><Label>Product</Label>
            <Select value={form.inventory_item_id} onValueChange={pickItem}>
              <SelectTrigger data-testid="order-item-select"><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>{orderedItems.map(i => <SelectItem key={i.id} value={i.id}>{i.name} (stock: {i.quantity}){listedIds.has(i.id) ? ' · listed' : ''}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Quantity</Label><Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} data-testid="order-qty-input" /></div>
            <div className="space-y-1"><Label>Sold Price ₹</Label><Input type="number" value={form.sold_price} onChange={e => setForm(f => ({ ...f, sold_price: e.target.value }))} data-testid="order-price-input" /></div>
            <div className="space-y-1"><Label>Shipping ₹</Label><Input type="number" value={form.shipping_cost} onChange={e => setForm(f => ({ ...f, shipping_cost: e.target.value }))} data-testid="order-shipping-input" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.platform_id || !form.inventory_item_id || !form.platform_order_id} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="order-submit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record Order'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportOrdersDialog({ open, onOpenChange, platforms, onImported }) {
  const [platformId, setPlatformId] = useState('');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const close = () => { setPreview(null); setError(''); onOpenChange(false); };
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file || !platformId) return;
    setError('');
    try { setPreview((await ecommerceAPI.orders.importPreview(platformId, file)).data); } catch (err) { setError(err.response?.data?.detail || 'Import preview failed'); }
  };
  const commit = async () => {
    if (!preview) return;
    setSaving(true); setError('');
    try {
      const rows = preview.rows.filter(r => r.matched).map(r => ({ platform_order_id: r.platform_order_id, order_date: r.order_date, customer_name_masked: r.customer_name_masked, inventory_item_id: r.inventory_item_id, quantity: r.quantity, sold_price: r.sold_price, shipping_cost: r.shipping_cost }));
      const res = await ecommerceAPI.orders.importCommit({ platform_id: platformId, rows });
      onImported(res.data); close();
    } catch (err) { setError(err.response?.data?.detail || 'Import failed'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); else onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="import-orders-dialog">
        <DialogHeader><DialogTitle>Import Orders from CSV</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded" data-testid="import-error">{error}</div>}
          <div className="space-y-1"><Label>Platform</Label>
            <Select value={platformId} onValueChange={setPlatformId}>
              <SelectTrigger data-testid="import-platform-select"><SelectValue placeholder="Select platform" /></SelectTrigger>
              <SelectContent>{platforms.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Order Report CSV</Label><Input type="file" accept=".csv" onChange={handleFile} disabled={!platformId} data-testid="import-file-input" /></div>
          {preview && (
            <div>
              <p className="text-sm text-slate-600 mb-2" data-testid="import-preview-summary">{preview.matched_count} of {preview.total_count} rows matched an inventory item.</p>
              <div className="max-h-60 overflow-y-auto border rounded">
                <table className="w-full text-xs" data-testid="import-preview-table">
                  <thead><tr className="bg-slate-50 text-left"><th className="p-1.5">Order ID</th><th className="p-1.5">SKU</th><th className="p-1.5">Item</th><th className="p-1.5">Qty</th><th className="p-1.5">Price</th><th className="p-1.5">Matched</th></tr></thead>
                  <tbody>{preview.rows.map((r, i) => (
                    <tr key={i} className={r.matched ? '' : 'bg-red-50'}><td className="p-1.5">{r.platform_order_id}</td><td className="p-1.5">{r.sku}</td><td className="p-1.5">{r.item_name || '—'}</td><td className="p-1.5">{r.quantity}</td><td className="p-1.5">₹{r.sold_price}</td><td className="p-1.5">{r.matched ? '✓' : '✗'}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={commit} disabled={saving || !preview || !preview.matched_count} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="import-commit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Import ${preview?.matched_count || 0} Orders`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
