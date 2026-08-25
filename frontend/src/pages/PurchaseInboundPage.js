import { useState, useEffect, useCallback } from 'react';
import { purchaseOrdersAPI, inventoryAPI, inboundApprovalsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Loader2, Plus, Truck, CheckCircle2, ClipboardCheck, Package, X, Save, Trash2, Pencil, Undo2, AlertTriangle } from 'lucide-react';

const STATUS_COLORS = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-blue-100 text-blue-700', arrived: 'bg-violet-100 text-violet-700', qc_done: 'bg-teal-100 text-teal-700', completed: 'bg-emerald-100 text-emerald-700' };
const STATUS_LABELS = { pending: 'Pending Approval', approved: 'Approved', arrived: 'Material Arrived', qc_done: 'QC Passed', completed: 'Completed' };

export default function PurchaseInboundPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [activeAction, setActiveAction] = useState(null); // {poId, type}
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ supplier_name: '', supplier_contact: '', items: [{ name: '', qty: '', unit_price: '', inventory_item_id: '', sku_code: '' }], expected_delivery: '', notes: '' });
  const [actionForm, setActionForm] = useState({});
  const [editInbound, setEditInbound] = useState(null); // { po, lines }
  const [reverseTarget, setReverseTarget] = useState(null); // po
  const [actionError, setActionError] = useState('');

  const fetch = useCallback(async () => {
    try { const res = await purchaseOrdersAPI.list({ status: filter !== 'all' ? filter : undefined }); setOrders(res.data); }
    catch (err) { console.error(err); } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { inventoryAPI.getItems().then(r => setInventoryItems(r.data || [])).catch(() => {}); }, []);
  const fetchApprovals = useCallback(async () => {
    if (user?.role !== 'admin') return;
    try { const r = await inboundApprovalsAPI.list('pending'); setPendingApprovals(r.data || []); } catch { /* noop */ }
  }, [user]);
  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  const handleApproveReversal = async (id) => {
    setSaving(true);
    try { await inboundApprovalsAPI.approve(id); await fetchApprovals(); await fetch(); }
    catch (err) { setActionError(err.response?.data?.detail || 'Could not approve'); } finally { setSaving(false); }
  };
  const handleRejectReversal = async (id) => {
    setSaving(true);
    try { await inboundApprovalsAPI.reject(id); await fetchApprovals(); }
    catch (err) { setActionError(err.response?.data?.detail || 'Could not reject'); } finally { setSaving(false); }
  };

  const addItem = () => setForm(p => ({...p, items: [...p.items, { name: '', qty: '', unit_price: '', inventory_item_id: '', sku_code: '' }]}));
  const removeItem = (i) => setForm(p => ({...p, items: p.items.filter((_, idx) => idx !== i)}));
  const updateItem = (i, k, v) => setForm(p => { const items = [...p.items]; items[i] = {...items[i], [k]: v}; return {...p, items}; });
  const pickInventoryItem = (i, invId) => setForm(p => {
    const items = [...p.items];
    const inv = inventoryItems.find(it => it.id === invId);
    items[i] = { ...items[i], inventory_item_id: invId, name: inv?.name || items[i].name, sku_code: inv?.sku_code || '', unit_price: items[i].unit_price || inv?.unit_price || '' };
    return { ...p, items };
  });

  const handleCreate = async () => {
    if (!form.supplier_name || form.items.length === 0) return;
    setSaving(true);
    try {
      const items = form.items.filter(i => i.name).map(i => ({name: i.name, qty: parseFloat(i.qty) || 0, unit_price: parseFloat(i.unit_price) || 0, inventory_item_id: i.inventory_item_id || null, sku_code: i.sku_code || null}));
      await purchaseOrdersAPI.create({...form, items});
      setShowCreate(false); setForm({ supplier_name: '', supplier_contact: '', items: [{ name: '', qty: '', unit_price: '', inventory_item_id: '', sku_code: '' }], expected_delivery: '', notes: '' }); await fetch();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const handleAction = async () => {
    if (!activeAction) return;
    setSaving(true); setActionError('');
    try {
      if (activeAction.type === 'approve') await purchaseOrdersAPI.approve(activeAction.poId);
      else if (activeAction.type === 'arrival') await purchaseOrdersAPI.arrival(activeAction.poId, actionForm);
      else if (activeAction.type === 'qc') await purchaseOrdersAPI.qc(activeAction.poId, actionForm);
      else if (activeAction.type === 'inbound') await purchaseOrdersAPI.inbound(activeAction.poId, actionForm);
      setActiveAction(null); setActionForm({}); await fetch();
    } catch (err) { setActionError(err.response?.data?.detail || 'Action failed'); console.error(err); } finally { setSaving(false); }
  };

  const openEditInbound = (po) => {
    const lines = (po.received_items || []).map(r => ({ inventory_item_id: r.inventory_item_id, name: r.name, sku_code: r.sku_code, qty_received: r.qty_received }));
    setEditInbound({ po, lines });
    setActionError('');
  };

  const saveEditInbound = async () => {
    if (!editInbound) return;
    setSaving(true); setActionError('');
    try {
      await purchaseOrdersAPI.editInbound(editInbound.po.id, { lines: editInbound.lines });
      setEditInbound(null); await fetch();
    } catch (err) { setActionError(err.response?.data?.detail || 'Could not save changes'); } finally { setSaving(false); }
  };

  const confirmReverse = async () => {
    if (!reverseTarget) return;
    setSaving(true); setActionError('');
    try {
      const res = await purchaseOrdersAPI.reverseInbound(reverseTarget.id);
      if (res.data.status === 'pending_approval') { setActionError(res.data.message); }
      else { setReverseTarget(null); await fetch(); }
    } catch (err) { setActionError(err.response?.data?.detail || 'Could not reverse this inbound'); } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="po-title">Purchase Inbound</h1><p className="text-sm text-slate-500">Procurement lifecycle: PO → Approve → Arrival → QC → Inventory</p></div>
          <Button onClick={() => setShowCreate(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="new-po-btn"><Plus className="h-4 w-4" />New PO</Button>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-4 overflow-x-auto">
          {['all', 'pending', 'approved', 'arrived', 'qc_done', 'completed'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 text-xs rounded-full border whitespace-nowrap ${filter === s ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium' : 'bg-white border-slate-200 text-slate-600'}`} data-testid={`po-filter-${s}`}>{STATUS_LABELS[s] || 'All'}</button>
          ))}
        </div>

        {/* Pending reversal approvals (admin only) */}
        {pendingApprovals.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/50 mb-4" data-testid="pending-inbound-approvals">
            <CardHeader className="py-3"><CardTitle className="text-sm text-amber-800">Pending Reversal Approvals ({pendingApprovals.length})</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {pendingApprovals.map(req => (
                <div key={req.id} className="flex items-center justify-between rounded border border-amber-200 bg-white p-2.5" data-testid={`approval-req-${req.id}`}>
                  <div className="text-xs">
                    <p className="font-medium text-slate-800">{req.supplier_name} — requested by {req.requested_by_name}</p>
                    <p className="text-slate-500">{(req.received_items_snapshot || []).map(r => `${r.name}: ${r.qty_received}`).join(', ')}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleRejectReversal(req.id)} data-testid={`reject-approval-${req.id}`}>Reject</Button>
                    <Button size="sm" className="h-7 text-xs bg-emerald-600 text-white" onClick={() => handleApproveReversal(req.id)} data-testid={`approve-approval-${req.id}`}>Approve</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Create PO */}
        {showCreate && (
          <Card className="border-emerald-200 mb-4" data-testid="po-form">
            <CardHeader className="py-3"><CardTitle className="text-base">New Purchase Order</CardTitle></CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Supplier Name *</Label><Input value={form.supplier_name} onChange={(e) => setForm(p => ({...p, supplier_name: e.target.value}))} className="h-9" data-testid="po-supplier" /></div>
                <div className="space-y-1"><Label className="text-xs">Contact</Label><Input value={form.supplier_contact} onChange={(e) => setForm(p => ({...p, supplier_contact: e.target.value}))} className="h-9" data-testid="po-contact" /></div>
                <div className="space-y-1"><Label className="text-xs">Expected Delivery</Label><Input type="date" value={form.expected_delivery} onChange={(e) => setForm(p => ({...p, expected_delivery: e.target.value}))} className="h-9" data-testid="po-delivery" /></div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Items</Label>
                {form.items.map((item, i) => (
                  <div key={`po-item-${i}`} className="grid grid-cols-5 gap-2">
                    <select className="h-9 border rounded-md px-2 text-xs bg-white" value={item.inventory_item_id || ''} onChange={(e) => pickInventoryItem(i, e.target.value)} data-testid={`po-item-link-${i}`}>
                      <option value="">Link to inventory (optional)</option>
                      {inventoryItems.map(inv => <option key={inv.id} value={inv.id}>{inv.name} ({inv.sku_code})</option>)}
                    </select>
                    <Input value={item.name} onChange={(e) => updateItem(i, 'name', e.target.value)} placeholder="Item name" className="h-9" data-testid={`po-item-name-${i}`} />
                    <Input type="number" value={item.qty} onChange={(e) => updateItem(i, 'qty', e.target.value)} placeholder="Qty" className="h-9" data-testid={`po-item-qty-${i}`} />
                    <Input type="number" value={item.unit_price} onChange={(e) => updateItem(i, 'unit_price', e.target.value)} placeholder="Price" className="h-9" data-testid={`po-item-price-${i}`} />
                    <Button variant="ghost" size="icon" className="h-9 text-red-400" onClick={() => removeItem(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addItem} className="h-8 text-xs"><Plus className="h-3.5 w-3.5 mr-1" />Add Item</Button>
                <p className="text-[10px] text-slate-400">Linking to an inventory item lets Complete Inbound match it precisely — unlinked items must be resolved before the inbound can be completed.</p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={saving} className="bg-emerald-600 text-white" data-testid="save-po-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Create PO</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Form */}
        {activeAction && (
          <Card className="border-blue-200 mb-4" data-testid="action-form">
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-sm capitalize">{activeAction.type === 'qc' ? 'Quality Check' : activeAction.type.replace('_', ' ')}</h3>
              {activeAction.type === 'arrival' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Transporter</Label><Input value={actionForm.transporter || ''} onChange={(e) => setActionForm(p => ({...p, transporter: e.target.value}))} className="h-9" data-testid="arrival-transporter" /></div>
                  <div className="space-y-1"><Label className="text-xs">Vehicle No.</Label><Input value={actionForm.vehicle || ''} onChange={(e) => setActionForm(p => ({...p, vehicle: e.target.value}))} className="h-9" data-testid="arrival-vehicle" /></div>
                  <div className="space-y-1"><Label className="text-xs">Driver Contact</Label><Input value={actionForm.driver_contact || ''} onChange={(e) => setActionForm(p => ({...p, driver_contact: e.target.value}))} className="h-9" data-testid="arrival-driver" /></div>
                  <div className="space-y-1"><Label className="text-xs">LR Number</Label><Input value={actionForm.lr_number || ''} onChange={(e) => setActionForm(p => ({...p, lr_number: e.target.value}))} className="h-9" data-testid="arrival-lr" /></div>
                </div>
              )}
              {activeAction.type === 'qc' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {['qty_check', 'damage_check', 'spec_match', 'overall'].map(f => (
                    <div key={f} className="space-y-1"><Label className="text-xs capitalize">{f.replace('_', ' ')}</Label>
                      <select className="w-full h-9 border rounded-md px-2 text-sm" value={actionForm[f] || 'pass'} onChange={(e) => setActionForm(p => ({...p, [f]: e.target.value}))} data-testid={`qc-${f}`}>
                        <option value="pass">Pass</option><option value="fail">Fail</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {activeAction.type === 'inbound' && (
                <div className="space-y-1"><Label className="text-xs">Storage Location (Zone/Aisle/Shelf/Rack/Bin)</Label><Input value={actionForm.storage_location || ''} onChange={(e) => setActionForm(p => ({...p, storage_location: e.target.value}))} placeholder="e.g., A/2/3/1/5" className="h-9" data-testid="inbound-location" /></div>
              )}
              {actionError && <p className="text-xs text-rose-600 flex items-center gap-1" data-testid="action-error"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{actionError}</p>}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setActiveAction(null); setActionForm({}); setActionError(''); }}><X className="h-4 w-4 mr-1" />Cancel</Button>
                <Button size="sm" onClick={handleAction} disabled={saving} className="bg-blue-600 text-white" data-testid="submit-action-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}Submit</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* PO List */}
        <div className="space-y-3" data-testid="po-list">
          {orders.map(po => (
            <Card key={po.id} className="border-slate-200" data-testid={`po-${po.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-slate-900">{po.supplier_name}</h3>
                      <Badge className={`text-[10px] ${STATUS_COLORS[po.status] || ''}`}>{STATUS_LABELS[po.status] || po.status}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{po.items?.length || 0} items | ₹{(po.total_amount || 0).toLocaleString('en-IN')} | {new Date(po.created_at).toLocaleDateString('en-IN')}</p>
                    {po.transport && <p className="text-xs text-slate-400 mt-1"><Truck className="inline h-3 w-3 mr-1" />{po.transport.transporter} | {po.transport.vehicle}</p>}
                    {po.qc && <p className="text-xs text-slate-400 mt-1"><ClipboardCheck className="inline h-3 w-3 mr-1" />QC: {po.qc.overall}</p>}
                    {po.storage_location && <p className="text-xs text-slate-400 mt-1"><Package className="inline h-3 w-3 mr-1" />Location: {po.storage_location}</p>}
                    {po.status === 'completed' && po.received_items?.length > 0 && (
                      <div className="mt-2 text-xs text-slate-500 space-y-0.5" data-testid={`receipt-history-${po.id}`}>
                        <p className="font-medium text-slate-600">Receipt history:</p>
                        {po.received_items.map((r, i) => <p key={i}>{r.name}: {r.qty_received} received{r.received_at ? ` on ${new Date(r.received_at).toLocaleDateString('en-IN')}` : ''}</p>)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {po.status === 'pending' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setActiveAction({ poId: po.id, type: 'approve' }); handleAction(); }} data-testid={`approve-${po.id}`}>Approve</Button>}
                    {po.status === 'approved' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActiveAction({ poId: po.id, type: 'arrival' })} data-testid={`arrival-${po.id}`}>Record Arrival</Button>}
                    {po.status === 'arrived' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActiveAction({ poId: po.id, type: 'qc' })} data-testid={`qc-${po.id}`}>QC Check</Button>}
                    {po.status === 'qc_done' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActiveAction({ poId: po.id, type: 'inbound' })} data-testid={`inbound-${po.id}`}>Complete Inbound</Button>}
                    {po.status === 'completed' && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openEditInbound(po)} data-testid={`edit-inbound-${po.id}`}><Pencil className="h-3 w-3" />Edit</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-rose-600 border-rose-200" onClick={() => { setReverseTarget(po); setActionError(''); }} data-testid={`reverse-inbound-${po.id}`}><Undo2 className="h-3 w-3" />Reverse</Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {orders.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No purchase orders found</p>}
        </div>
      </div>

      {/* Edit Inbound Dialog */}
      <Dialog open={!!editInbound} onOpenChange={(v) => !v && setEditInbound(null)}>
        <DialogContent className="sm:max-w-lg" data-testid="edit-inbound-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5 text-blue-600" />Edit Received Quantities</DialogTitle>
            <DialogDescription>Only the difference is applied to stock — safe to correct a mis-keyed quantity.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {editInbound?.lines.map((l, i) => (
              <div key={l.inventory_item_id} className="flex items-center justify-between gap-3">
                <div className="text-sm min-w-0 flex-1 truncate">{l.name} <span className="text-xs text-slate-400">({l.sku_code})</span></div>
                <Input type="number" value={l.qty_received} onChange={(e) => setEditInbound(p => { const lines = [...p.lines]; lines[i] = {...lines[i], qty_received: e.target.value}; return {...p, lines}; })} className="h-9 w-28" data-testid={`edit-qty-${l.inventory_item_id}`} />
              </div>
            ))}
            {editInbound?.lines.length === 0 && <p className="text-xs text-slate-400">No linked inventory items to correct.</p>}
            {actionError && <p className="text-xs text-rose-600 flex items-center gap-1" data-testid="edit-inbound-error"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditInbound(null)}>Cancel</Button>
            <Button onClick={saveEditInbound} disabled={saving || !editInbound?.lines?.length} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-inbound-edit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverse Inbound Confirmation */}
      <Dialog open={!!reverseTarget} onOpenChange={(v) => !v && setReverseTarget(null)}>
        <DialogContent className="sm:max-w-lg" data-testid="reverse-inbound-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700"><Undo2 className="h-5 w-5" />Reverse This Inbound?</DialogTitle>
            <DialogDescription>This subtracts exactly what was added and reopens the PO for QC. It cannot be done if any of the stock has already been issued or sold.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            {(reverseTarget?.received_items || []).map((r, i) => <p key={i}>{r.name}: <strong>{r.qty_received}</strong> will be removed from stock</p>)}
            {actionError && <p className="text-xs text-rose-600 flex items-center gap-1 mt-2" data-testid="reverse-inbound-error"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseTarget(null)}>Cancel</Button>
            <Button onClick={confirmReverse} disabled={saving} className="bg-rose-600 hover:bg-rose-700 text-white" data-testid="confirm-reverse-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reverse Inbound'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
