import { useState, useEffect } from 'react';
import { pricelistAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Loader2, History } from 'lucide-react';

const ACTIONS = [
  { id: 'set_margin', label: 'Set margin to', suffix: '%', hint: 'Every selected item gets exactly this margin.' },
  { id: 'adjust_margin_pts', label: 'Change margin by', suffix: 'pts', hint: 'Adds/subtracts percentage points (e.g. +5 turns 15% into 20%).' },
  { id: 'adjust_price_pct', label: 'Change cost price by', suffix: '%', hint: 'Supplier revision: raise or lower cost by a percentage; margins stay as they are.' },
  { id: 'set_gst', label: 'Set GST to', suffix: '%', hint: 'Applies one GST rate to all selected items.' },
];

export function BulkAdjustDialog({ open, onOpenChange, itemIds, onDone }) {
  const [action, setAction] = useState('set_margin');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const meta = ACTIONS.find(a => a.id === action);

  const run = async () => {
    setSaving(true); setError('');
    try { const r = await pricelistAPI.bulk({ item_ids: itemIds, action, value: parseFloat(value) }); onDone(r.data); onOpenChange(false); setValue(''); }
    catch (e) { setError(e.response?.data?.detail || 'Bulk update failed'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="bulk-adjust-dialog">
        <DialogHeader><DialogTitle>Bulk adjust {itemIds.length} item{itemIds.length === 1 ? '' : 's'}</DialogTitle><DialogDescription>Changes are written to Inventory and recorded in price history.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {ACTIONS.map(a => <button key={a.id} onClick={() => setAction(a.id)} className={`text-left text-sm p-2.5 rounded-lg border ${action === a.id ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-slate-200 hover:bg-slate-50'}`} data-testid={`bulk-action-${a.id}`}>{a.label}</button>)}
          </div>
          <div className="space-y-1"><Label className="text-xs">{meta.label}</Label>
            <div className="flex items-center gap-2"><Input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 20" className="h-9" data-testid="bulk-value-input" /><span className="text-sm text-slate-500 w-8">{meta.suffix}</span></div>
            <p className="text-[11px] text-slate-500">{meta.hint}</p>
          </div>
          {error && <p className="text-xs text-red-600" data-testid="bulk-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={run} disabled={saving || value === '' || Number.isNaN(parseFloat(value))} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="bulk-apply-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_LABEL = { unit_price: 'Cost ₹', margin_pct: 'Margin %', gst_percentage: 'GST %', hsn_code: 'HSN', active: 'Status' };
const fmt = (k, v) => v == null ? '—' : k === 'active' ? (v ? 'Active' : 'Archived') : k === 'unit_price' ? `₹${Number(v).toLocaleString('en-IN')}` : String(v);

export function PriceHistoryDialog({ item, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!item) return;
    setRows(null);
    (item.id ? pricelistAPI.history(item.id) : pricelistAPI.recentHistory(80)).then(r => setRows(r.data)).catch(() => setRows([]));
  }, [item]);
  return (
    <Dialog open={!!item} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="price-history-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" />{item?.id ? `Price history — ${item.name}` : 'Recent price changes'}</DialogTitle></DialogHeader>
        {rows === null ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div> : rows.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center" data-testid="price-history-empty">No price changes recorded yet.</p>
        ) : (
          <table className="w-full text-xs" data-testid="price-history-table">
            <thead><tr className="text-left text-slate-500 border-b"><th className="py-1.5 pr-2">When</th>{!item?.id && <th className="py-1.5 pr-2">Item</th>}<th className="py-1.5 pr-2">By</th><th className="py-1.5 pr-2">Change</th><th className="py-1.5">Source</th></tr></thead>
            <tbody>{rows.map(h => (
              <tr key={h.id} className="border-b last:border-0 align-top">
                <td className="py-1.5 pr-2 whitespace-nowrap text-slate-600">{new Date(h.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                {!item?.id && <td className="py-1.5 pr-2 font-medium text-slate-800">{h.item_name || h.product_id}</td>}
                <td className="py-1.5 pr-2">{h.user_name}</td>
                <td className="py-1.5 pr-2">{Object.keys(h.after || {}).map(k => <p key={k}><span className="text-slate-500">{FIELD_LABEL[k] || k}:</span> {fmt(k, h.before?.[k])} → <b>{fmt(k, h.after[k])}</b></p>)}</td>
                <td className="py-1.5 text-slate-500">{(h.action || '').replace(/_/g, ' ')}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
