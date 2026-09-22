import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { PackagePlus, X } from 'lucide-react';

const blank = { name: '', category: '', specification: '', description: '', unit_price: '', gst_percentage: '', hsn_code: '', quantity: 1, supplier_hint: '' };

/** Iter 55 — quote a line that is not in inventory yet. Behaves like any other line; only flagged internally. */
export function AdhocLineForm({ categories, onAdd, onCancel }) {
  const [f, setF] = useState(blank);
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e?.target ? e.target.value : e }));
  const valid = f.name.trim() && f.category && parseFloat(f.unit_price) > 0 && f.gst_percentage !== '' && parseInt(f.quantity) >= 1;
  const submit = () => {
    if (!valid) return;
    onAdd({
      inventory_item_id: null, is_adhoc: true, promoted: false, promoted_inventory_item_id: null,
      name: f.name.trim(), category: f.category, specification: f.specification || null, description: f.description || null,
      unit_price: parseFloat(f.unit_price), gst_percentage: f.gst_percentage, hsn_code: f.hsn_code || null,
      quantity: parseInt(f.quantity) || 1, supplier_hint: f.supplier_hint || null, margin_percentage: null
    });
    setF(blank);
  };
  return (
    <div className="p-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 space-y-2" data-testid="adhoc-line-form">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5"><PackagePlus className="h-4 w-4" />New item — not yet in inventory</p>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700" data-testid="adhoc-cancel"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Item name *</Label><Input value={f.name} onChange={set('name')} placeholder="e.g. Waaree 585W TOPCon panel" className="h-9" data-testid="adhoc-name" /></div>
        <div className="space-y-1"><Label className="text-xs">Category *</Label>
          <Select value={f.category} onValueChange={set('category')}><SelectTrigger className="h-9" data-testid="adhoc-category"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent className="max-h-60">{categories.map(c => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label className="text-xs">Specification</Label><Input value={f.specification} onChange={set('specification')} placeholder="585W / 48V / 6 sqmm…" className="h-9" data-testid="adhoc-spec" /></div>
        <div className="space-y-1"><Label className="text-xs">Unit price (₹) *</Label><Input type="number" min="0" value={f.unit_price} onChange={set('unit_price')} className="h-9" data-testid="adhoc-price" /></div>
        <div className="space-y-1"><Label className="text-xs">GST % *</Label><Input type="number" min="0" max="100" step="0.5" value={f.gst_percentage} onChange={set('gst_percentage')} className="h-9" data-testid="adhoc-gst" /></div>
        <div className="space-y-1"><Label className="text-xs">HSN code</Label><Input value={f.hsn_code} onChange={set('hsn_code')} placeholder="8541" className="h-9" data-testid="adhoc-hsn" /></div>
        <div className="space-y-1"><Label className="text-xs">Quantity *</Label><Input type="number" min="1" value={f.quantity} onChange={set('quantity')} className="h-9" data-testid="adhoc-qty" /></div>
        <div className="space-y-1"><Label className="text-xs">Supplier hint</Label><Input value={f.supplier_hint} onChange={set('supplier_hint')} placeholder="Where you expect to source it" className="h-9" data-testid="adhoc-supplier" /></div>
        <div className="space-y-1 sm:col-span-3"><Label className="text-xs">Description</Label><Input value={f.description} onChange={set('description')} className="h-9" data-testid="adhoc-description" /></div>
      </div>
      <div className="flex justify-end"><Button type="button" size="sm" disabled={!valid} onClick={submit} className="bg-amber-600 hover:bg-amber-700 text-white h-8" data-testid="adhoc-add-btn"><PackagePlus className="h-3.5 w-3.5 mr-1" />Add to quote</Button></div>
    </div>
  );
}

export function AdhocTag({ item, className = '' }) {
  if (!item?.is_adhoc) return null;
  if (item.promoted) return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 ${className}`} data-testid="adhoc-promoted-tag">In inventory{item.sku_code ? ` · ${item.sku_code}` : ''}</span>;
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 ${className}`} data-testid="adhoc-tag">Not yet in inventory</span>;
}
