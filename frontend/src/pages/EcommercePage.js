import { useState, useEffect, useCallback } from 'react';
import { ecommerceAPI, inventoryAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Loader2, Plus, ShoppingBag, AlertTriangle, CheckCircle2, Upload, Trash2, Pencil } from 'lucide-react';

const STATUS_COLORS = { draft: 'bg-slate-100 text-slate-600', live: 'bg-emerald-100 text-emerald-800', paused: 'bg-amber-100 text-amber-800', delisted: 'bg-red-100 text-red-800', out_of_stock: 'bg-orange-100 text-orange-800' };
const ORDER_STATUS_COLORS = { placed: 'bg-blue-100 text-blue-800', shipped: 'bg-indigo-100 text-indigo-800', delivered: 'bg-emerald-100 text-emerald-800', returned: 'bg-orange-100 text-orange-800', cancelled: 'bg-slate-100 text-slate-600', refunded: 'bg-red-100 text-red-800' };

export default function EcommercePage() {
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  const [tab, setTab] = useState('platforms');
  const [platforms, setPlatforms] = useState([]);
  const [listings, setListings] = useState([]);
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [recon, setRecon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPlatform, setShowPlatform] = useState(false);
  const [editingPlatformId, setEditingPlatformId] = useState(null);
  const [platformForm, setPlatformForm] = useState({ name: '', platform_type: 'marketplace', seller_id: '', store_url: '', commission_pct: '' });
  const [showListing, setShowListing] = useState(false);
  const [listingForm, setListingForm] = useState({ platform_id: '', inventory_item_id: '', platform_sku: '', listed_price: '', platform_commission_pct: '', status: 'draft' });
  const [showOrder, setShowOrder] = useState(false);
  const [orderForm, setOrderForm] = useState({ platform_id: '', platform_order_id: '', order_date: new Date().toISOString().slice(0, 10), inventory_item_id: '', quantity: 1, sold_price: '', shipping_cost: 0 });
  const [showImport, setShowImport] = useState(false);
  const [importPlatformId, setImportPlatformId] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedListings, setSelectedListings] = useState([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, l, o, i] = await Promise.all([ecommerceAPI.platforms.list(), ecommerceAPI.listings.list(), ecommerceAPI.orders.list(), inventoryAPI.getItems()]);
      setPlatforms(p.data); setListings(l.data); setOrders(o.data); setItems(i.data.items || i.data || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => { if (tab === 'reconciliation') ecommerceAPI.reconciliation().then(r => setRecon(r.data)).catch(console.error); }, [tab]);

  const submitPlatform = async () => {
    setSaving(true); setError('');
    try {
      const payload = { ...platformForm, commission_pct: parseFloat(platformForm.commission_pct) || 0 };
      if (editingPlatformId) await ecommerceAPI.platforms.update(editingPlatformId, payload);
      else await ecommerceAPI.platforms.create(payload);
      setShowPlatform(false); setEditingPlatformId(null);
      setPlatformForm({ name: '', platform_type: 'marketplace', seller_id: '', store_url: '', commission_pct: '' });
      fetchAll();
    } catch (err) { setError(err.response?.data?.detail || 'Failed'); } finally { setSaving(false); }
  };
  const openEditPlatform = (p) => {
    setEditingPlatformId(p.id);
    setPlatformForm({ name: p.name || '', platform_type: p.platform_type || 'marketplace', seller_id: p.seller_id || '', store_url: p.store_url || '', commission_pct: p.commission_pct ?? '' });
    setShowPlatform(true);
  };

  const submitListing = async () => {
    setSaving(true); setError('');
    try {
      await ecommerceAPI.listings.create({ ...listingForm, listed_price: parseFloat(listingForm.listed_price), platform_commission_pct: listingForm.platform_commission_pct ? parseFloat(listingForm.platform_commission_pct) : null });
      setShowListing(false); setListingForm({ platform_id: '', inventory_item_id: '', platform_sku: '', listed_price: '', platform_commission_pct: '', status: 'draft' }); fetchAll();
    } catch (err) { setError(err.response?.data?.detail || 'Failed'); } finally { setSaving(false); }
  };

  const submitOrder = async () => {
    setSaving(true); setError('');
    try {
      const listing = listings.find(l => l.platform_id === orderForm.platform_id && l.inventory_item_id === orderForm.inventory_item_id);
      await ecommerceAPI.orders.create({
        platform_id: orderForm.platform_id, platform_order_id: orderForm.platform_order_id, order_date: orderForm.order_date,
        shipping_cost: parseFloat(orderForm.shipping_cost) || 0,
        lines: [{ listing_id: listing?.id, inventory_item_id: orderForm.inventory_item_id, quantity: parseFloat(orderForm.quantity), sold_price: parseFloat(orderForm.sold_price) }],
      });
      setShowOrder(false); setOrderForm({ platform_id: '', platform_order_id: '', order_date: new Date().toISOString().slice(0, 10), inventory_item_id: '', quantity: 1, sold_price: '', shipping_cost: 0 }); fetchAll();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to record order'); } finally { setSaving(false); }
  };

  const handleBulkStatus = async (status) => {
    if (selectedListings.length === 0) return;
    await ecommerceAPI.listings.bulkStatus({ listing_ids: selectedListings, status });
    setSelectedListings([]); fetchAll();
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!file || !importPlatformId) return;
    try { const r = await ecommerceAPI.orders.importPreview(importPlatformId, file); setImportPreview(r.data); } catch (err) { setError(err.response?.data?.detail || 'Import preview failed'); }
  };

  const commitImport = async () => {
    if (!importPreview) return;
    setSaving(true);
    try {
      const rows = importPreview.rows.filter(r => r.matched).map(r => ({ platform_order_id: r.platform_order_id, order_date: r.order_date, customer_name_masked: r.customer_name_masked, inventory_item_id: r.inventory_item_id, quantity: r.quantity, sold_price: r.sold_price, shipping_cost: r.shipping_cost }));
      const res = await ecommerceAPI.orders.importCommit({ platform_id: importPlatformId, rows });
      alert(`Imported ${res.data.created} orders. ${res.data.skipped_duplicates.length} duplicates skipped.`);
      setShowImport(false); setImportPreview(null); fetchAll();
    } catch (err) { setError(err.response?.data?.detail || 'Import failed'); } finally { setSaving(false); }
  };

  const handleOrderStatusChange = async (orderId, order_status) => {
    try { await ecommerceAPI.orders.update(orderId, { order_status }); fetchAll(); }
    catch (err) { alert(err.response?.data?.detail || 'Failed to update order status'); }
  };

  const handlePaymentStatusChange = async (order, payment_status) => {
    try {
      const payload = { payment_status };
      if (payment_status === 'settled') { payload.settlement_date = new Date().toISOString().slice(0, 10); payload.net_payout = order.net_payout; }
      await ecommerceAPI.orders.update(order.id, payload); fetchAll();
    } catch (err) { alert(err.response?.data?.detail || 'Failed to update payment status'); }
  };

  const handleDeleteOrder = async (orderId) => {
    if (!window.confirm('Delete this order? Stock will be restored if it was still active.')) return;
    try { await ecommerceAPI.orders.remove(orderId); fetchAll(); }
    catch (err) { alert(err.response?.data?.detail || 'Failed to delete order'); }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="ecommerce-page">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900 flex items-center gap-2"><ShoppingBag className="h-6 w-6 text-emerald-600" />Ecommerce</h1>
          <p className="text-sm text-slate-500">Marketplace platforms, listings and orders — separate from counter/direct sales</p>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {['platforms', 'listings', 'orders', 'reconciliation'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-sm rounded-full border capitalize ${tab === t ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium' : 'bg-white border-slate-200 text-slate-600'}`} data-testid={`ecommerce-tab-${t}`}>{t}</button>
        ))}
      </div>

      {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div> : (
        <>
          {tab === 'platforms' && (
            <div>
              {canManage && <Button onClick={() => setShowPlatform(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 mb-4" data-testid="add-platform-btn"><Plus className="h-4 w-4" />Add Platform</Button>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {platforms.map(p => (
                  <Card key={p.id} className="border-slate-200" data-testid={`platform-card-${p.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-slate-900">{p.name}</h3>
                          <p className="text-xs text-slate-500 capitalize">{p.platform_type}</p>
                        </div>
                        {canManage && <Button size="icon" variant="ghost" onClick={() => openEditPlatform(p)} className="h-7 w-7" data-testid={`edit-platform-${p.id}`}><Pencil className="h-3.5 w-3.5 text-slate-500" /></Button>}
                      </div>
                      <p className="text-xs text-slate-400 mt-2">Reference commission: <span className="font-medium">{p.commission_pct}%</span> <span className="italic">(each listing carries its own rate)</span></p>
                      {p.store_url && <p className="text-xs text-blue-600 truncate mt-1">{p.store_url}</p>}
                    </CardContent>
                  </Card>
                ))}
              </div>
              {platforms.length === 0 && <p className="text-slate-500 text-sm">No platforms added yet.</p>}
            </div>
          )}

          {tab === 'listings' && (
            <div>
              <div className="flex gap-2 mb-4 flex-wrap">
                {canManage && <Button onClick={() => setShowListing(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="add-listing-btn"><Plus className="h-4 w-4" />New Listing</Button>}
                {selectedListings.length > 0 && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => handleBulkStatus('live')} data-testid="bulk-status-live-btn">Mark Live ({selectedListings.length})</Button>
                    <Button size="sm" variant="outline" onClick={() => handleBulkStatus('paused')}>Mark Paused</Button>
                  </>
                )}
              </div>
              <Card className="border-slate-200"><CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm" data-testid="listings-table">
                  <thead><tr className="text-left text-slate-500 border-b bg-slate-50"><th className="p-2"></th><th className="p-2">Item</th><th className="p-2">Platform</th><th className="p-2">SKU</th><th className="p-2">Listed Price</th><th className="p-2">Stock</th><th className="p-2">Status</th></tr></thead>
                  <tbody>{listings.map(l => (
                    <tr key={l.id} className="border-b last:border-0" data-testid={`listing-row-${l.id}`}>
                      <td className="p-2"><input type="checkbox" checked={selectedListings.includes(l.id)} onChange={e => setSelectedListings(p => e.target.checked ? [...p, l.id] : p.filter(x => x !== l.id))} /></td>
                      <td className="p-2">{l.item_name}</td><td className="p-2">{l.platform_name}</td><td className="p-2">{l.platform_sku}</td>
                      <td className="p-2">₹{l.listed_price?.toLocaleString('en-IN')}</td><td className="p-2">{l.stock_available}</td>
                      <td className="p-2"><Badge className={STATUS_COLORS[l.status]}>{l.status}</Badge></td>
                    </tr>
                  ))}</tbody>
                </table>
                {listings.length === 0 && <p className="text-slate-500 text-sm p-4">No listings yet.</p>}
              </CardContent></Card>
            </div>
          )}

          {tab === 'orders' && (
            <div>
              <div className="flex gap-2 mb-4">
                {canManage && <Button onClick={() => setShowOrder(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="add-order-btn"><Plus className="h-4 w-4" />Record Order</Button>}
                {canManage && <Button variant="outline" onClick={() => setShowImport(true)} className="gap-1.5" data-testid="import-orders-btn"><Upload className="h-4 w-4" />Import CSV</Button>}
              </div>
              <Card className="border-slate-200"><CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm" data-testid="orders-table">
                  <thead><tr className="text-left text-slate-500 border-b bg-slate-50"><th className="p-2">Order ID</th><th className="p-2">Platform</th><th className="p-2">Date</th><th className="p-2">Total</th><th className="p-2">Commission</th><th className="p-2">Net Payout</th><th className="p-2">Payment</th><th className="p-2">Status</th>{isAdmin && <th className="p-2"></th>}</tr></thead>
                  <tbody>{orders.map(o => (
                    <tr key={o.id} className="border-b last:border-0" data-testid={`order-row-${o.id}`}>
                      <td className="p-2">{o.platform_order_id}</td><td className="p-2">{o.platform_name}</td><td className="p-2">{o.order_date}</td>
                      <td className="p-2">₹{o.order_total?.toLocaleString('en-IN')}</td><td className="p-2">₹{o.commission_total?.toLocaleString('en-IN')}</td>
                      <td className="p-2 font-medium text-emerald-700">₹{o.net_payout?.toLocaleString('en-IN')}</td>
                      <td className="p-2">
                        {canManage ? (
                          <Select value={o.payment_status} onValueChange={v => handlePaymentStatusChange(o, v)}>
                            <SelectTrigger className="h-7 w-28 text-xs" data-testid={`order-payment-select-${o.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="settled">Settled</SelectItem></SelectContent>
                          </Select>
                        ) : <Badge variant="outline" className="capitalize">{o.payment_status}</Badge>}
                      </td>
                      <td className="p-2">
                        {canManage ? (
                          <Select value={o.order_status} onValueChange={v => handleOrderStatusChange(o.id, v)}>
                            <SelectTrigger className="h-7 w-32 text-xs" data-testid={`order-status-select-${o.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="placed">Placed</SelectItem><SelectItem value="shipped">Shipped</SelectItem>
                              <SelectItem value="delivered">Delivered</SelectItem><SelectItem value="returned">Returned</SelectItem>
                              <SelectItem value="cancelled">Cancelled</SelectItem><SelectItem value="refunded">Refunded</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : <Badge className={ORDER_STATUS_COLORS[o.order_status]}>{o.order_status}</Badge>}
                      </td>
                      {isAdmin && <td className="p-2"><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:bg-red-50" onClick={() => handleDeleteOrder(o.id)} data-testid={`delete-order-${o.id}`}><Trash2 className="h-3.5 w-3.5" /></Button></td>}
                    </tr>
                  ))}</tbody>
                </table>
                {orders.length === 0 && <p className="text-slate-500 text-sm p-4">No orders recorded yet.</p>}
              </CardContent></Card>
            </div>
          )}

          {tab === 'reconciliation' && recon && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                {recon.mismatch_count > 0 ? <Badge className="bg-red-100 text-red-800 gap-1"><AlertTriangle className="h-3 w-3" />{recon.mismatch_count} mismatch{recon.mismatch_count === 1 ? '' : 'es'} flagged</Badge> : <Badge className="bg-emerald-100 text-emerald-800 gap-1"><CheckCircle2 className="h-3 w-3" />All settled payouts match expected</Badge>}
              </div>
              <Card className="border-slate-200"><CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm" data-testid="reconciliation-table">
                  <thead><tr className="text-left text-slate-500 border-b bg-slate-50"><th className="p-2">Order</th><th className="p-2">Platform</th><th className="p-2">Expected Payout</th><th className="p-2">Actual Payout</th><th className="p-2">Difference</th><th className="p-2">Status</th></tr></thead>
                  <tbody>{recon.rows.map(r => (
                    <tr key={r.id} className={`border-b last:border-0 ${r.mismatch ? 'bg-red-50' : ''}`}>
                      <td className="p-2">{r.platform_order_id}</td><td className="p-2">{r.platform_name}</td>
                      <td className="p-2">₹{r.expected_payout?.toLocaleString('en-IN')}</td><td className="p-2">{r.actual_payout != null ? `₹${r.actual_payout.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="p-2">{r.difference != null ? `₹${r.difference.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="p-2">{r.mismatch ? <Badge className="bg-red-100 text-red-800">Mismatch</Badge> : <Badge className="bg-emerald-100 text-emerald-800">OK</Badge>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </CardContent></Card>
            </div>
          )}
        </>
      )}

      <Dialog open={showPlatform} onOpenChange={setShowPlatform}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingPlatformId ? 'Edit Platform' : 'Add Platform'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="space-y-1"><Label>Name</Label><Input value={platformForm.name} onChange={e => setPlatformForm(p => ({ ...p, name: e.target.value }))} placeholder="Amazon, Flipkart, Custom Website..." data-testid="platform-name-input" /></div>
            <div className="space-y-1"><Label>Type</Label>
              <Select value={platformForm.platform_type} onValueChange={v => setPlatformForm(p => ({ ...p, platform_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="marketplace">Marketplace</SelectItem><SelectItem value="custom_website">Custom Website</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Seller ID</Label><Input value={platformForm.seller_id} onChange={e => setPlatformForm(p => ({ ...p, seller_id: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Store URL</Label><Input value={platformForm.store_url} onChange={e => setPlatformForm(p => ({ ...p, store_url: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Reference Commission %</Label><Input type="number" value={platformForm.commission_pct} onChange={e => setPlatformForm(p => ({ ...p, commission_pct: e.target.value }))} placeholder="Reference only — each listing carries its own rate" data-testid="platform-commission-input" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowPlatform(false)}>Cancel</Button><Button onClick={submitPlatform} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="platform-submit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showListing} onOpenChange={setShowListing}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Listing</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="space-y-1"><Label>Platform</Label>
              <Select value={listingForm.platform_id} onValueChange={v => setListingForm(p => ({ ...p, platform_id: v }))}>
                <SelectTrigger data-testid="listing-platform-select"><SelectValue placeholder="Select platform" /></SelectTrigger>
                <SelectContent>{platforms.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Inventory Item</Label>
              <Select value={listingForm.inventory_item_id} onValueChange={v => setListingForm(p => ({ ...p, inventory_item_id: v }))}>
                <SelectTrigger data-testid="listing-item-select"><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Platform SKU</Label><Input value={listingForm.platform_sku} onChange={e => setListingForm(p => ({ ...p, platform_sku: e.target.value }))} data-testid="listing-sku-input" /></div>
            <div className="space-y-1"><Label>Listed Price ₹</Label><Input type="number" value={listingForm.listed_price} onChange={e => setListingForm(p => ({ ...p, listed_price: e.target.value }))} data-testid="listing-price-input" /></div>
            <div className="space-y-1"><Label>Listing Commission % <span className="text-red-500">*</span></Label><Input type="number" value={listingForm.platform_commission_pct} onChange={e => setListingForm(p => ({ ...p, platform_commission_pct: e.target.value }))} placeholder="Required before status can be 'live'" data-testid="listing-commission-input" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowListing(false)}>Cancel</Button><Button onClick={submitListing} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="listing-submit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showOrder} onOpenChange={setShowOrder}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Order</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="space-y-1"><Label>Platform</Label>
              <Select value={orderForm.platform_id} onValueChange={v => setOrderForm(p => ({ ...p, platform_id: v }))}>
                <SelectTrigger data-testid="order-platform-select"><SelectValue placeholder="Select platform" /></SelectTrigger>
                <SelectContent>{platforms.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Platform Order ID</Label><Input value={orderForm.platform_order_id} onChange={e => setOrderForm(p => ({ ...p, platform_order_id: e.target.value }))} data-testid="order-id-input" /></div>
            <div className="space-y-1"><Label>Order Date</Label><Input type="date" value={orderForm.order_date} onChange={e => setOrderForm(p => ({ ...p, order_date: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Item</Label>
              <Select value={orderForm.inventory_item_id} onValueChange={v => setOrderForm(p => ({ ...p, inventory_item_id: v }))}>
                <SelectTrigger data-testid="order-item-select"><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name} (stock: {i.quantity})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Quantity</Label><Input type="number" value={orderForm.quantity} onChange={e => setOrderForm(p => ({ ...p, quantity: e.target.value }))} data-testid="order-qty-input" /></div>
              <div className="space-y-1"><Label>Sold Price ₹</Label><Input type="number" value={orderForm.sold_price} onChange={e => setOrderForm(p => ({ ...p, sold_price: e.target.value }))} data-testid="order-price-input" /></div>
            </div>
            <div className="space-y-1"><Label>Shipping Cost ₹</Label><Input type="number" value={orderForm.shipping_cost} onChange={e => setOrderForm(p => ({ ...p, shipping_cost: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowOrder(false)}>Cancel</Button><Button onClick={submitOrder} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="order-submit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record Order'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Import Orders from CSV</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="space-y-1"><Label>Platform</Label>
              <Select value={importPlatformId} onValueChange={setImportPlatformId}>
                <SelectTrigger data-testid="import-platform-select"><SelectValue placeholder="Select platform" /></SelectTrigger>
                <SelectContent>{platforms.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Order Report CSV</Label><Input type="file" accept=".csv" onChange={handleImportFile} disabled={!importPlatformId} data-testid="import-file-input" /></div>
            {importPreview && (
              <div>
                <p className="text-sm text-slate-600 mb-2">{importPreview.matched_count} of {importPreview.total_count} rows matched an inventory item.</p>
                <div className="max-h-60 overflow-y-auto border rounded">
                  <table className="w-full text-xs" data-testid="import-preview-table">
                    <thead><tr className="bg-slate-50 text-left"><th className="p-1.5">Order ID</th><th className="p-1.5">SKU</th><th className="p-1.5">Item</th><th className="p-1.5">Qty</th><th className="p-1.5">Price</th><th className="p-1.5">Matched</th></tr></thead>
                    <tbody>{importPreview.rows.map((r, i) => (
                      <tr key={i} className={r.matched ? '' : 'bg-red-50'}><td className="p-1.5">{r.platform_order_id}</td><td className="p-1.5">{r.sku}</td><td className="p-1.5">{r.item_name || '—'}</td><td className="p-1.5">{r.quantity}</td><td className="p-1.5">₹{r.sold_price}</td><td className="p-1.5">{r.matched ? '✓' : '✗'}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => { setShowImport(false); setImportPreview(null); }}>Cancel</Button>
            <Button onClick={commitImport} disabled={saving || !importPreview} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="import-commit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Import ${importPreview?.matched_count || 0} Orders`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
