import { useState, useMemo } from 'react';
import { ecommerceAPI } from '../../utils/api';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Plus, Upload, Trash2, AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import { RecordOrderDialog, ImportOrdersDialog } from './OrderDialogs';

const ORDER_STATUS_COLORS = { placed: 'bg-blue-100 text-blue-800', shipped: 'bg-indigo-100 text-indigo-800', delivered: 'bg-emerald-100 text-emerald-800', returned: 'bg-orange-100 text-orange-800', cancelled: 'bg-slate-100 text-slate-600', refunded: 'bg-red-100 text-red-800' };
const ORDER_STATUSES = ['placed', 'shipped', 'delivered', 'returned', 'cancelled', 'refunded'];
const inr = (v) => `₹${(v ?? 0).toLocaleString('en-IN')}`;

export function OrdersTab({ orders, recon, platforms, products, items, canManage, isAdmin, refresh }) {
  const [showOrder, setShowOrder] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showRecon, setShowRecon] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [mismatchOnly, setMismatchOnly] = useState(false);

  const reconById = useMemo(() => Object.fromEntries((recon?.rows || []).map(r => [r.id, r])), [recon]);
  const rows = useMemo(() => orders.filter(o => {
    if (platformFilter !== 'all' && o.platform_id !== platformFilter) return false;
    if (statusFilter !== 'all' && o.order_status !== statusFilter) return false;
    if (mismatchOnly && !reconById[o.id]?.mismatch) return false;
    return true;
  }), [orders, platformFilter, statusFilter, mismatchOnly, reconById]);

  const active = orders.filter(o => !['cancelled', 'returned', 'refunded'].includes(o.order_status));
  const totals = { revenue: active.reduce((s, o) => s + (o.order_total || 0), 0), commission: active.reduce((s, o) => s + (o.commission_total || 0), 0), pending: orders.filter(o => o.payment_status === 'pending' && !['cancelled', 'returned', 'refunded'].includes(o.order_status)).length };

  const setOrderStatus = async (o, order_status) => {
    try { await ecommerceAPI.orders.update(o.id, { order_status }); toast.success(`Order ${o.platform_order_id} → ${order_status}`); refresh(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed to update order status'); }
  };
  const setPaymentStatus = async (o, payment_status) => {
    try {
      const payload = { payment_status };
      if (payment_status === 'settled') payload.net_payout = o.net_payout;
      await ecommerceAPI.orders.update(o.id, payload); refresh();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to update payment status'); }
  };
  const remove = async (o) => {
    if (!window.confirm(`Delete order ${o.platform_order_id}? Stock will be restored if it was still active.`)) return;
    try { await ecommerceAPI.orders.remove(o.id); toast.success('Order deleted'); refresh(); } catch (err) { toast.error(err.response?.data?.detail || 'Failed to delete order'); }
  };

  return (
    <div data-testid="orders-tab">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} className="h-9 text-sm rounded-md border border-slate-200 px-2 bg-white" data-testid="orders-platform-filter">
          <option value="all">All platforms</option>{platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-9 text-sm rounded-md border border-slate-200 px-2 bg-white capitalize" data-testid="orders-status-filter">
          <option value="all">All statuses</option>{ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant={showRecon ? 'default' : 'outline'} onClick={() => setShowRecon(v => !v)} className={`gap-1.5 h-9 ${showRecon ? 'bg-slate-900 text-white hover:bg-slate-800' : ''}`} data-testid="toggle-reconciliation-btn"><Scale className="h-4 w-4" />Payout reconciliation</Button>
        {showRecon && <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={mismatchOnly} onChange={e => setMismatchOnly(e.target.checked)} data-testid="recon-mismatch-only-check" />Mismatches only</label>}
        <div className="ml-auto flex gap-2">
          {canManage && <Button variant="outline" onClick={() => setShowImport(true)} className="gap-1.5 h-9" data-testid="import-orders-btn"><Upload className="h-4 w-4" />Import CSV</Button>}
          {canManage && <Button onClick={() => setShowOrder(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-9" data-testid="add-order-btn"><Plus className="h-4 w-4" />Record Order</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4" data-testid="orders-summary">
        <Card className="border-slate-200"><CardContent className="p-3"><p className="text-[11px] uppercase tracking-wide text-slate-400">Orders</p><p className="text-lg font-bold text-slate-900" data-testid="orders-count">{orders.length}</p><p className="text-[11px] text-slate-500">{active.length} active</p></CardContent></Card>
        <Card className="border-slate-200"><CardContent className="p-3"><p className="text-[11px] uppercase tracking-wide text-slate-400">Revenue (active)</p><p className="text-lg font-bold text-slate-900" data-testid="orders-revenue">{inr(totals.revenue)}</p><p className="text-[11px] text-slate-500">commission {inr(totals.commission)}</p></CardContent></Card>
        <Card className="border-slate-200"><CardContent className="p-3"><p className="text-[11px] uppercase tracking-wide text-slate-400">Awaiting settlement</p><p className="text-lg font-bold text-amber-700" data-testid="orders-pending-count">{totals.pending}</p></CardContent></Card>
        <Card className={`border-slate-200 ${recon?.mismatch_count ? 'border-red-200 bg-red-50/40' : ''}`}><CardContent className="p-3"><p className="text-[11px] uppercase tracking-wide text-slate-400">Payout mismatches</p><p className={`text-lg font-bold ${recon?.mismatch_count ? 'text-red-700' : 'text-emerald-700'}`} data-testid="orders-mismatch-count">{recon?.mismatch_count ?? 0}</p><p className="text-[11px] text-slate-500">{recon?.mismatch_count ? <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />settled ≠ expected</span> : <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />all settled payouts match</span>}</p></CardContent></Card>
      </div>

      <Card className="border-slate-200"><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm" data-testid="orders-table">
          <thead><tr className="text-left text-slate-500 border-b bg-slate-50">
            <th className="p-2.5 font-medium">Order</th><th className="p-2.5 font-medium">Platform</th><th className="p-2.5 font-medium">Date</th><th className="p-2.5 font-medium">Items</th>
            <th className="p-2.5 font-medium">Total</th><th className="p-2.5 font-medium">Commission</th><th className="p-2.5 font-medium">Net Payout</th>
            {showRecon && <><th className="p-2.5 font-medium">Expected</th><th className="p-2.5 font-medium">Actual</th><th className="p-2.5 font-medium">Diff</th></>}
            <th className="p-2.5 font-medium">Payment</th><th className="p-2.5 font-medium">Status</th>{isAdmin && <th className="p-2.5"></th>}
          </tr></thead>
          <tbody>{rows.map(o => {
            const rc = reconById[o.id];
            return (
              <tr key={o.id} className={`border-b last:border-0 ${showRecon && rc?.mismatch ? 'bg-red-50' : ''}`} data-testid={`order-row-${o.id}`}>
                <td className="p-2.5 font-medium text-slate-900">{o.platform_order_id}{o.customer_name_masked && <p className="text-[11px] text-slate-400 font-normal">{o.customer_name_masked}</p>}</td>
                <td className="p-2.5">{o.platform_name}</td><td className="p-2.5">{o.order_date}</td>
                <td className="p-2.5 text-xs text-slate-600">{(o.lines || []).map((l, i) => { const it = items.find(x => x.id === l.inventory_item_id); return <p key={i}>{l.quantity} × {it?.name || 'item'}</p>; })}</td>
                <td className="p-2.5">{inr(o.order_total)}</td><td className="p-2.5">{inr(o.commission_total)}</td>
                <td className="p-2.5 font-medium text-emerald-700">{inr(o.net_payout)}</td>
                {showRecon && <>
                  <td className="p-2.5">{rc ? inr(rc.expected_payout) : '—'}</td>
                  <td className="p-2.5">{rc?.actual_payout != null ? inr(rc.actual_payout) : '—'}</td>
                  <td className="p-2.5">{rc?.difference != null ? <span className={rc.mismatch ? 'text-red-700 font-medium' : ''}>{inr(rc.difference)}</span> : '—'}{rc?.mismatch && <Badge className="ml-1 bg-red-100 text-red-800 text-[10px]">Mismatch</Badge>}</td>
                </>}
                <td className="p-2.5">
                  {canManage ? (
                    <Select value={o.payment_status} onValueChange={v => setPaymentStatus(o, v)}>
                      <SelectTrigger className="h-7 w-28 text-xs" data-testid={`order-payment-select-${o.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="settled">Settled</SelectItem></SelectContent>
                    </Select>
                  ) : <Badge variant="outline" className="capitalize">{o.payment_status}</Badge>}
                </td>
                <td className="p-2.5">
                  {canManage ? (
                    <Select value={o.order_status} onValueChange={v => setOrderStatus(o, v)}>
                      <SelectTrigger className="h-7 w-32 text-xs" data-testid={`order-status-select-${o.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{ORDER_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : <Badge className={ORDER_STATUS_COLORS[o.order_status]}>{o.order_status}</Badge>}
                </td>
                {isAdmin && <td className="p-2.5"><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:bg-red-50" onClick={() => remove(o)} data-testid={`delete-order-${o.id}`}><Trash2 className="h-3.5 w-3.5" /></Button></td>}
              </tr>
            );
          })}</tbody>
        </table>
        {rows.length === 0 && <p className="text-slate-500 text-sm p-6 text-center" data-testid="orders-empty">{orders.length === 0 ? 'No orders recorded yet.' : 'No orders match these filters.'}</p>}
      </CardContent></Card>

      <RecordOrderDialog open={showOrder} onOpenChange={setShowOrder} platforms={platforms} products={products} items={items} onSaved={() => { toast.success('Order recorded'); refresh(); }} />
      <ImportOrdersDialog open={showImport} onOpenChange={setShowImport} platforms={platforms} onImported={(r) => { toast.success(`Imported ${r.created} orders · ${r.skipped_duplicates.length} duplicates skipped`); refresh(); }} />
    </div>
  );
}
