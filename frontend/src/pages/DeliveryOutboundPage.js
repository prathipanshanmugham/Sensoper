import { useState, useEffect, useCallback } from 'react';
import { deliveriesAPI, projectsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Loader2, Plus, Truck, CheckCircle2, X, Save } from 'lucide-react';

export default function DeliveryOutboundPage() {
  const [deliveries, setDeliveries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ project_id: '', customer_name: '', customer_address: '', customer_contact: '', items: [{ name: '', qty: '' }], transporter_name: '', vehicle_number: '', driver_contact: '', dispatch_date: '', delivery_date: '', distance_km: '', notes: '' });

  const fetch = useCallback(async () => {
    try {
      const [dRes, pRes] = await Promise.all([deliveriesAPI.list(), projectsAPI.getAll()]);
      setDeliveries(dRes.data); setProjects(pRes.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetch(); }, [fetch]);

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

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="delivery-title">Delivery Outbound</h1><p className="text-sm text-slate-500">Track material dispatches to customers/projects</p></div>
          <Button onClick={() => setShowForm(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="new-delivery-btn"><Plus className="h-4 w-4" />New Delivery</Button>
        </div>

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
                  {d.status === 'dispatched' && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={async () => { await deliveriesAPI.complete(d.id); fetch(); }} data-testid={`complete-${d.id}`}><CheckCircle2 className="h-3.5 w-3.5" />Mark Delivered</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
          {deliveries.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No deliveries found</p>}
        </div>
      </div>
    </div>
  );
}
