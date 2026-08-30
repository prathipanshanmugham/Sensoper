import { useState, useEffect, useCallback } from 'react';
import { deliveriesAPI, projectsAPI, actionRequestsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Loader2, Plus, Truck, CheckCircle2, X, Save, Pencil, Ban, AlertTriangle, Trash2 } from 'lucide-react';

export default function DeliveryOutboundPage() {
  const { isAdmin, isManager } = useAuth();
  const [deliveries, setDeliveries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ project_id: '', customer_name: '', customer_address: '', customer_contact: '', items: [{ name: '', qty: '' }], transporter_name: '', vehicle_number: '', driver_contact: '', dispatch_date: '', delivery_date: '', distance_km: '', notes: '' });
  const [editDelivery, setEditDelivery] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [actionError, setActionError] = useState('');
  const canManage = isAdmin || isManager;

  const fetch = useCallback(async () => {
    try {
      const [dRes, pRes] = await Promise.all([deliveriesAPI.list(), projectsAPI.getAll()]);
      setDeliveries(dRes.data); setProjects(pRes.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetch(); }, [fetch]);

  const fetchApprovals = useCallback(async () => {
    if (!canManage) return;
    try { const r = await actionRequestsAPI.list({ status: 'pending', resource_type: 'delivery' }); setPendingApprovals(r.data || []); } catch { /* noop */ }
  }, [canManage]);
  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  const handleApproveCancel = async (id) => {
    try { await actionRequestsAPI.approve(id); await fetchApprovals(); await fetch(); }
    catch (e) { alert(e.response?.data?.detail || 'Could not approve'); }
  };
  const handleRejectCancel = async (id) => {
    try { await actionRequestsAPI.reject(id); await fetchApprovals(); }
    catch (e) { alert(e.response?.data?.detail || 'Could not reject'); }
  };

  const addItem = () => setForm(p => ({...p, items: [...p.items, { name: '', qty: '' }]}));
  const updateItem = (i, k, v) => setForm(p => { const items = [...p.items]; items[i] = {...items[i], [k]: v}; return {...p, items}; });

  const handleCreate = async () => {
    if (!form.customer_name) return;
    setSaving(true);
    try {
      const items = form.items.filter(i => i.name).map(i => ({name: i.name, qty: parseFloat(i.qty) || 0}));
      await deliveriesAPI.create({...form, items, distance_km: parseFloat(form.distance_km) || 0});
      setShowForm(false); setForm({ project_id: '', customer_name: '', customer_address: '', customer_contact: '', items: [{ name: '', qty: '' }], transporter_name: '', vehicle_number: '', driver_contact: '', dispatch_date: '', delivery_date: '', distance_km: '', notes: '' }); await fetch();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const openEditDelivery = (d) => {
    setEditDelivery({ id: d.id, items: (d.items || []).map(i => ({...i})), transporter_name: d.transporter_name || '', vehicle_number: d.vehicle_number || '', driver_contact: d.driver_contact || '', dispatch_date: d.dispatch_date || '', delivery_date: d.delivery_date || '', notes: d.notes || '' });
    setActionError('');
  };
  const updEditItem = (i, k, v) => setEditDelivery(p => { const items = [...p.items]; items[i] = {...items[i], [k]: v}; return {...p, items}; });
  const saveEditDelivery = async () => {
    if (!editDelivery) return;
    setSaving(true); setActionError('');
    try {
      const { id, ...rest } = editDelivery;
      const items = rest.items.filter(i => i.name).map(i => ({ name: i.name, qty: parseFloat(i.qty) || 0 }));
      const r = await deliveriesAPI.edit(id, { ...rest, items });
      if (r.data.status === 'needs_confirmation') {
        if (window.confirm(r.data.message)) await deliveriesAPI.edit(id, { ...rest, items, confirm_reconciliation_impact: true });
        else { setSaving(false); return; }
      }
      setEditDelivery(null); await fetch();
    } catch (err) { setActionError(err.response?.data?.detail || 'Could not save changes'); } finally { setSaving(false); }
  };

  const confirmCancelDelivery = async () => {
    if (!cancelTarget) return;
    setSaving(true); setActionError('');
    try {
      const r = await deliveriesAPI.cancel(cancelTarget.id);
      if (r.data.status === 'pending_approval') { setActionError(r.data.message); }
      else { setCancelTarget(null); await fetch(); }
    } catch (err) { setActionError(err.response?.data?.detail || 'Could not cancel this delivery'); } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="delivery-title">Delivery Outbound</h1><p className="text-sm text-slate-500">Track material dispatches to customers/projects</p></div>
          <Button onClick={() => setShowForm(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="new-delivery-btn"><Plus className="h-4 w-4" />New Delivery</Button>
        </div>

        {/* Pending cancellation approvals (admin/manager) */}
        {pendingApprovals.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/50 mb-4" data-testid="pending-delivery-approvals">
            <CardHeader className="py-3"><CardTitle className="text-sm text-amber-800">Pending Cancellation Approvals ({pendingApprovals.length})</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              {pendingApprovals.map(req => (
                <div key={req.id} className="flex items-center justify-between rounded border border-amber-200 bg-white p-2.5" data-testid={`delivery-approval-req-${req.id}`}>
                  <div className="text-xs">
                    <p className="font-medium text-slate-800">{req.snapshot?.customer_name} — requested by {req.requested_by_name}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleRejectCancel(req.id)} data-testid={`reject-delivery-approval-${req.id}`}>Reject</Button>
                    <Button size="sm" className="h-7 text-xs bg-emerald-600 text-white" onClick={() => handleApproveCancel(req.id)} data-testid={`approve-delivery-approval-${req.id}`}>Approve</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {showForm && (
          <Card className="border-emerald-200 mb-4" data-testid="delivery-form">
            <CardHeader className="py-3"><CardTitle className="text-base">New Delivery</CardTitle></CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Project (Optional)</Label>
                  <Select value={form.project_id} onValueChange={(v) => setForm(p => ({...p, project_id: v}))}><SelectTrigger className="h-9" data-testid="del-project"><SelectValue placeholder="Link project..." /></SelectTrigger><SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.customer?.name || p.id.slice(-6)}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Customer Name *</Label><Input value={form.customer_name} onChange={(e) => setForm(p => ({...p, customer_name: e.target.value}))} className="h-9" data-testid="del-customer" /></div>
                <div className="space-y-1"><Label className="text-xs">Contact</Label><Input value={form.customer_contact} onChange={(e) => setForm(p => ({...p, customer_contact: e.target.value}))} className="h-9" data-testid="del-contact" /></div>
                <div className="space-y-1"><Label className="text-xs">Address</Label><Input value={form.customer_address} onChange={(e) => setForm(p => ({...p, customer_address: e.target.value}))} className="h-9" data-testid="del-address" /></div>
                <div className="space-y-1"><Label className="text-xs">Transporter</Label><Input value={form.transporter_name} onChange={(e) => setForm(p => ({...p, transporter_name: e.target.value}))} className="h-9" data-testid="del-transporter" /></div>
                <div className="space-y-1"><Label className="text-xs">Vehicle No.</Label><Input value={form.vehicle_number} onChange={(e) => setForm(p => ({...p, vehicle_number: e.target.value}))} className="h-9" data-testid="del-vehicle" /></div>
                <div className="space-y-1"><Label className="text-xs">Dispatch Date</Label><Input type="date" value={form.dispatch_date} onChange={(e) => setForm(p => ({...p, dispatch_date: e.target.value}))} className="h-9" data-testid="del-dispatch" /></div>
                <div className="space-y-1"><Label className="text-xs">Delivery Date</Label><Input type="date" value={form.delivery_date} onChange={(e) => setForm(p => ({...p, delivery_date: e.target.value}))} className="h-9" data-testid="del-deliver" /></div>
                <div className="space-y-1"><Label className="text-xs">Distance (km)</Label><Input type="number" value={form.distance_km} onChange={(e) => setForm(p => ({...p, distance_km: e.target.value}))} className="h-9" data-testid="del-distance" /></div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Items</Label>
                {form.items.map((item, i) => (
                  <div key={`del-item-${i}`} className="grid grid-cols-3 gap-2">
                    <Input value={item.name} onChange={(e) => updateItem(i, 'name', e.target.value)} placeholder="Item" className="h-9 col-span-2" data-testid={`del-item-${i}`} />
                    <Input type="number" value={item.qty} onChange={(e) => updateItem(i, 'qty', e.target.value)} placeholder="Qty" className="h-9" data-testid={`del-qty-${i}`} />
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addItem} className="h-8 text-xs"><Plus className="h-3.5 w-3.5 mr-1" />Add Item</Button>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={saving} className="bg-emerald-600 text-white" data-testid="save-delivery-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Create</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3" data-testid="delivery-list">
          {deliveries.map(d => (
            <Card key={d.id} className="border-slate-200" data-testid={`delivery-${d.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2"><h3 className="font-semibold">{d.customer_name}</h3><Badge className={`text-[10px] ${d.status === 'delivered' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{d.status}</Badge></div>
                    <p className="text-xs text-slate-500 mt-1">{d.items?.length || 0} items | {d.dispatch_date || 'No date'}{d.distance_km ? ` | ${d.distance_km} km` : ''}</p>
                    {d.transporter_name && <p className="text-xs text-slate-400 mt-1"><Truck className="inline h-3 w-3 mr-1" />{d.transporter_name} | {d.vehicle_number}</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {d.status === 'dispatched' && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={async () => { await deliveriesAPI.complete(d.id); fetch(); }} data-testid={`complete-${d.id}`}><CheckCircle2 className="h-3.5 w-3.5" />Mark Delivered</Button>}
                    {(d.status === 'dispatched' || d.status === 'delivered') && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-blue-600 border-blue-200" onClick={() => openEditDelivery(d)} data-testid={`edit-delivery-${d.id}`}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                    )}
                    {d.status === 'dispatched' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-rose-600 border-rose-200" onClick={() => { setCancelTarget(d); setActionError(''); }} data-testid={`cancel-delivery-${d.id}`}><Ban className="h-3.5 w-3.5" />Cancel</Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {deliveries.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No deliveries found</p>}
        </div>
      </div>

      {/* Edit Delivery Dialog */}
      <Dialog open={!!editDelivery} onOpenChange={(v) => !v && setEditDelivery(null)}>
        <DialogContent className="sm:max-w-lg" data-testid="edit-delivery-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5 text-blue-600" />Edit Delivery</DialogTitle></DialogHeader>
          {editDelivery && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Transporter" value={editDelivery.transporter_name} onChange={e => setEditDelivery(p => ({...p, transporter_name: e.target.value}))} className="h-9" data-testid="edit-del-transporter" />
                <Input placeholder="Vehicle No." value={editDelivery.vehicle_number} onChange={e => setEditDelivery(p => ({...p, vehicle_number: e.target.value}))} className="h-9" data-testid="edit-del-vehicle" />
                <Input type="date" value={editDelivery.dispatch_date} onChange={e => setEditDelivery(p => ({...p, dispatch_date: e.target.value}))} className="h-9" />
                <Input type="date" value={editDelivery.delivery_date} onChange={e => setEditDelivery(p => ({...p, delivery_date: e.target.value}))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Items</Label>
                {editDelivery.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2">
                    <Input value={item.name} onChange={(e) => updEditItem(i, 'name', e.target.value)} className="h-9 col-span-2" data-testid={`edit-del-item-${i}`} />
                    <Input type="number" value={item.qty} onChange={(e) => updEditItem(i, 'qty', e.target.value)} className="h-9" data-testid={`edit-del-qty-${i}`} />
                  </div>
                ))}
              </div>
              {actionError && <p className="text-xs text-rose-600 flex items-center gap-1" data-testid="edit-delivery-error"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{actionError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDelivery(null)}>Cancel</Button>
            <Button onClick={saveEditDelivery} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-delivery-edit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Delivery Confirmation */}
      <Dialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent data-testid="cancel-delivery-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-rose-700"><Trash2 className="h-5 w-5" />Cancel This Delivery?</DialogTitle><DialogDescription>Voids a dispatched-but-not-delivered outbound.</DialogDescription></DialogHeader>
          <div className="space-y-1 text-sm">
            <p>Customer: <strong>{cancelTarget?.customer_name}</strong></p>
            {actionError && <p className="text-xs text-rose-600 flex items-center gap-1 mt-2" data-testid="cancel-delivery-error"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Back</Button>
            <Button onClick={confirmCancelDelivery} disabled={saving} className="bg-rose-600 hover:bg-rose-700 text-white" data-testid="confirm-cancel-delivery-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel Delivery'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
