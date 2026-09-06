import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { vendorsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { ArrowLeft, Plus, Search, Save, Loader2, Trash2, Edit, Store, Phone, Mail, Receipt, X, History } from 'lucide-react';

const CATEGORIES = ['panels', 'inverters', 'batteries', 'structure', 'transport', 'services', 'other'];
const blankForm = { name: '', contact_person: '', phone: '', email: '', gstin: '', address: '', district: '', payment_terms: '', category: 'other', notes: '' };

export default function VendorsPage() {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('active');
  const [district, setDistrict] = useState('');
  const [sort, setSort] = useState('name');
  const [openForm, setOpenForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (category !== 'all') params.category = category;
      if (status !== 'all') params.status = status;
      if (district) params.district = district;
      if (sort !== 'name') params.sort = sort;
      const r = await vendorsAPI.list(params);
      setVendors(r.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [search, category, status, district, sort]);

  useEffect(() => {
    const t = setTimeout(() => fetchAll(), 300);
    return () => clearTimeout(t);
  }, [fetchAll]);

  const openCreate = () => { setEditingId(null); setForm(blankForm); setOpenForm(true); };
  const openEdit = (v) => {
    setEditingId(v.id);
    setForm({ name: v.name || '', contact_person: v.contact_person || '', phone: v.phone || '', email: v.email || '', gstin: v.gstin || '', address: v.address || '', district: v.district || '', payment_terms: v.payment_terms || '', category: v.category || 'other', notes: v.notes || '' });
    setOpenForm(true);
  };

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      if (editingId) await vendorsAPI.update(editingId, form);
      else await vendorsAPI.create(form);
      setOpenForm(false);
      await fetchAll();
    } catch (e) { alert(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Archive this vendor?')) return;
    try { await vendorsAPI.remove(id); await fetchAll(); }
    catch (e) { alert(e.response?.data?.detail || 'Delete failed'); }
  };

  const openHistory = async (v) => {
    setHistoryFor(v);
    setHistoryLoading(true);
    try { const r = await vendorsAPI.purchaseOrders(v.id); setHistory(r.data); }
    catch (e) { setHistory(null); }
    finally { setHistoryLoading(false); }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4" data-testid="vendors-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold font-['Outfit'] flex items-center gap-2"><Store className="h-5 w-5 text-emerald-600" />Vendors</h1>
            <p className="text-sm text-slate-500">Supplier directory with GSTIN and purchase order history.</p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="new-vendor-btn"><Plus className="h-4 w-4" />New Vendor</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="relative sm:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or GSTIN..." className="pl-9 h-10" data-testid="vendor-search-input" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-10" data-testid="vendor-category-filter"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All categories</SelectItem>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-10" data-testid="vendor-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="all">All</SelectItem></SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="h-10" data-testid="vendor-sort"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="name">Sort: Name</SelectItem><SelectItem value="business_desc">Sort: Business value ↓</SelectItem><SelectItem value="recent_desc">Sort: Most recent order</SelectItem><SelectItem value="recent_asc">Sort: Oldest last order</SelectItem><SelectItem value="location_asc">Sort: Location (district)</SelectItem></SelectContent>
        </Select>
        <div className="sm:col-span-5">
          <Input value={district} onChange={e => setDistrict(e.target.value)} placeholder="Filter by district (exact match)" className="h-9" data-testid="vendor-district-filter" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="vendors-grid">
        {loading ? (
          <div className="col-span-full flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>
        ) : vendors.length === 0 ? (
          <p className="col-span-full text-sm text-slate-400 text-center py-10">No vendors found. Add your first supplier.</p>
        ) : vendors.map((v) => (
          <Card key={v.id} className="border-slate-200" data-testid={`vendor-card-${v.id}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{v.name}</p>
                  <Badge variant="secondary" className="text-[10px] mt-0.5">{v.category}</Badge>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(v)} data-testid={`edit-vendor-${v.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDelete(v.id)} data-testid={`delete-vendor-${v.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                {v.contact_person && <p>{v.contact_person}</p>}
                {v.phone && <p className="flex items-center gap-1"><Phone className="h-3 w-3" />{v.phone}</p>}
                {v.email && <p className="flex items-center gap-1"><Mail className="h-3 w-3" />{v.email}</p>}
                {v.gstin && <p className="flex items-center gap-1"><Receipt className="h-3 w-3" />{v.gstin}</p>}
                {v.district && <p>{v.district}</p>}
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                <span className="text-emerald-700 font-medium">₹{(v.business_value || 0).toLocaleString('en-IN')}</span>
                <span className="text-slate-400">{v.last_order_date ? `Last: ${v.last_order_date}` : 'No orders'}</span>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs w-full gap-1.5" onClick={() => openHistory(v)} data-testid={`vendor-po-history-${v.id}`}>
                <History className="h-3.5 w-3.5" />PO History
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? 'Edit Vendor' : 'New Vendor'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Name *</Label><Input value={form.name} onChange={(e) => setForm(p => ({...p, name: e.target.value}))} className="h-9" data-testid="vendor-name-input" /></div>
              <div className="space-y-1"><Label className="text-xs">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm(p => ({...p, category: v}))}>
                  <SelectTrigger className="h-9" data-testid="vendor-category-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Contact Person</Label><Input value={form.contact_person} onChange={(e) => setForm(p => ({...p, contact_person: e.target.value}))} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={(e) => setForm(p => ({...p, phone: e.target.value}))} className="h-9" data-testid="vendor-phone-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Email</Label><Input value={form.email} onChange={(e) => setForm(p => ({...p, email: e.target.value}))} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">GSTIN</Label><Input value={form.gstin} onChange={(e) => setForm(p => ({...p, gstin: e.target.value}))} className="h-9" data-testid="vendor-gstin-input" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Address</Label><Input value={form.address} onChange={(e) => setForm(p => ({...p, address: e.target.value}))} className="h-9" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">District</Label><Input value={form.district} onChange={(e) => setForm(p => ({...p, district: e.target.value}))} className="h-9" data-testid="vendor-district-input" /></div>
              <div className="space-y-1"><Label className="text-xs">Payment Terms</Label><Input value={form.payment_terms} onChange={(e) => setForm(p => ({...p, payment_terms: e.target.value}))} placeholder="Net 30, PDC 60, etc." className="h-9" data-testid="vendor-payment-terms-input" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={(e) => setForm(p => ({...p, notes: e.target.value}))} className="h-9" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2" data-testid="save-vendor-btn">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{editingId ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO History Dialog */}
      <Dialog open={!!historyFor} onOpenChange={(v) => !v && setHistoryFor(null)}>
        <DialogContent className="max-w-lg" data-testid="vendor-po-history-dialog">
          <DialogHeader><DialogTitle>Purchase Orders — {historyFor?.name}</DialogTitle></DialogHeader>
          <div className="py-2">
            {historyLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>
            ) : !history?.purchase_orders?.length ? (
              <p className="text-sm text-slate-400 text-center py-6">No purchase orders found for this supplier name yet.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                <p className="text-xs text-slate-500">Total value: ₹{(history.total_value || 0).toLocaleString('en-IN')}</p>
                {history.purchase_orders.map((po) => (
                  <div key={po.id} className="flex items-center justify-between text-xs border-b border-slate-100 py-1.5">
                    <span className="text-slate-600">{po.date} · {po.items_count} items</span>
                    <span className="font-semibold text-slate-800">₹{po.total.toLocaleString('en-IN')}</span>
                    <Badge variant="outline" className="text-[9px]">{po.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setHistoryFor(null)}><X className="h-4 w-4 mr-1" />Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
