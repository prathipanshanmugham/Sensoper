import { useState, useEffect, useCallback } from 'react';
import { readingsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Loader2, Plus, Save, Trash2, Edit, Activity, AlertTriangle, CheckCircle2, Clock, MapPin, User, Cpu } from 'lucide-react';

const STATUS_META = {
  active: { label: 'Active', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Clock },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  overdue: { label: 'Overdue', color: 'bg-red-100 text-red-700 border-red-200', icon: AlertTriangle }
};

const blankForm = {
  site_name: '', site_ref: '', site_address: '',
  device_id: '', device_type: '', device_serial: '',
  customer_name: '', customer_phone: '', customer_account: '',
  start_date: new Date().toISOString().slice(0, 10), days: 30,
  status: 'active', notes: ''
};

function computeEnd(start, days) {
  if (!start || !days) return '-';
  try {
    const d = new Date(start);
    if (isNaN(d.getTime())) return '-';
    d.setDate(d.getDate() + parseInt(days, 10));
    return d.toISOString().slice(0, 10);
  } catch { return '-'; }
}

export default function ReadingsPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, completed: 0, overdue: 0 });
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [openForm, setOpenForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterFrom) params.date_from = filterFrom;
      if (filterTo) params.date_to = filterTo;
      const [list, sum] = await Promise.all([readingsAPI.list(params), readingsAPI.summary()]);
      setRows(list.data);
      setSummary(sum.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filterStatus, filterFrom, filterTo]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openCreate = () => { setEditingId(null); setForm(blankForm); setError(''); setOpenForm(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      site_name: r.site_name || '', site_ref: r.site_ref || '', site_address: r.site_address || '',
      device_id: r.device_id || '', device_type: r.device_type || '', device_serial: r.device_serial || '',
      customer_name: r.customer_name || '', customer_phone: r.customer_phone || '', customer_account: r.customer_account || '',
      start_date: r.start_date || '', days: r.days || 30, status: r.status || 'active', notes: r.notes || ''
    });
    setError('');
    setOpenForm(true);
  };

  const handleSave = async () => {
    if (!form.site_name || !form.start_date) { setError('Site name and start date are required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, days: parseInt(form.days, 10) || 0 };
      if (editingId) await readingsAPI.update(editingId, payload);
      else await readingsAPI.create(payload);
      setOpenForm(false);
      await fetchAll();
    } catch (e) { setError(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this reading entry?')) return;
    try { await readingsAPI.delete(id); await fetchAll(); }
    catch (e) { alert(e.response?.data?.detail || 'Delete failed'); }
  };

  const markComplete = async (r) => {
    try { await readingsAPI.update(r.id, { status: 'completed' }); await fetchAll(); }
    catch (e) { alert(e.response?.data?.detail || 'Failed'); }
  };

  return (
    <div className="py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="readings-title">Readings</h1>
            <p className="text-sm text-slate-500">Track sites currently in the reading phase</p>
          </div>
          <Button onClick={openCreate} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="new-reading-btn">
            <Plus className="h-4 w-4" />New Reading
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" data-testid="readings-summary">
          <Card className="border-slate-200"><CardContent className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-slate-400">Total</p><p className="text-2xl font-bold text-slate-900">{summary.total}</p></CardContent></Card>
          <Card className="border-blue-200 bg-blue-50/40"><CardContent className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-blue-500 flex items-center justify-center gap-1"><Activity className="h-3 w-3" />Active</p><p className="text-2xl font-bold text-blue-700" data-testid="summary-active">{summary.active}</p></CardContent></Card>
          <Card className="border-red-200 bg-red-50/40"><CardContent className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-red-500 flex items-center justify-center gap-1"><AlertTriangle className="h-3 w-3" />Overdue</p><p className="text-2xl font-bold text-red-700" data-testid="summary-overdue">{summary.overdue}</p></CardContent></Card>
          <Card className="border-emerald-200 bg-emerald-50/40"><CardContent className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-emerald-500 flex items-center justify-center gap-1"><CheckCircle2 className="h-3 w-3" />Completed</p><p className="text-2xl font-bold text-emerald-700" data-testid="summary-completed">{summary.completed}</p></CardContent></Card>
        </div>

        {/* Filters */}
        <Card className="border-slate-200 mb-5">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-9" data-testid="filter-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Start From</Label><Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-9" data-testid="filter-from" /></div>
              <div className="space-y-1"><Label className="text-xs">Start To</Label><Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-9" data-testid="filter-to" /></div>
            </div>
          </CardContent>
        </Card>

        {/* List */}
        <Card className="border-slate-200" data-testid="readings-list">
          <CardHeader className="py-3 border-b border-slate-200"><CardTitle className="text-base font-['Outfit']">All Readings ({rows.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div> :
              rows.length === 0 ? <p className="text-sm text-slate-400 text-center py-10">No reading entries.</p> : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Site</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Customer</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Device</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Start → End</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Days</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Status</th>
                        <th className="px-4 py-2.5"></th>
                      </tr></thead>
                      <tbody>
                        {rows.map(r => {
                          const meta = STATUS_META[r.status] || STATUS_META.active;
                          const StatusIcon = meta.icon;
                          return (
                            <tr key={r.id} className={`border-b border-slate-100 hover:bg-slate-50 ${r.status === 'overdue' ? 'bg-red-50/30' : ''}`} data-testid={`reading-row-${r.id}`}>
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-slate-900">{r.site_name}</div>
                                <div className="text-xs text-slate-500">{r.site_ref || '-'} · {r.site_address || ''}</div>
                              </td>
                              <td className="px-4 py-2.5"><div className="text-slate-700">{r.customer_name || '-'}</div><div className="text-xs text-slate-400">{r.customer_phone || ''}</div></td>
                              <td className="px-4 py-2.5"><div className="text-slate-700">{r.device_type || '-'}</div><div className="text-xs text-slate-400 font-mono">{r.device_serial || r.device_id || ''}</div></td>
                              <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">{r.start_date} → <span className={r.status === 'overdue' ? 'text-red-600 font-semibold' : ''}>{r.end_date}</span></td>
                              <td className="px-4 py-2.5 text-slate-700">{r.days}</td>
                              <td className="px-4 py-2.5"><Badge className={`text-[10px] gap-1 ${meta.color}`} data-testid={`status-${r.id}`}><StatusIcon className="h-3 w-3" />{meta.label}</Badge></td>
                              <td className="px-4 py-2.5">
                                <div className="flex justify-end gap-1">
                                  {r.status !== 'completed' && (
                                    <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-600" onClick={() => markComplete(r)} data-testid={`complete-${r.id}`}>Complete</Button>
                                  )}
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)} data-testid={`edit-${r.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDelete(r.id)} data-testid={`delete-${r.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile cards */}
                  <div className="md:hidden divide-y divide-slate-100">
                    {rows.map(r => {
                      const meta = STATUS_META[r.status] || STATUS_META.active;
                      const StatusIcon = meta.icon;
                      return (
                        <div key={r.id} className={`p-4 ${r.status === 'overdue' ? 'bg-red-50/30' : ''}`} data-testid={`reading-card-${r.id}`}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 truncate flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />{r.site_name}</p>
                              <p className="text-xs text-slate-500">{r.site_ref || '-'} · {r.start_date} → <span className={r.status === 'overdue' ? 'text-red-600 font-semibold' : ''}>{r.end_date}</span></p>
                            </div>
                            <Badge className={`text-[10px] gap-1 shrink-0 ${meta.color}`}><StatusIcon className="h-3 w-3" />{meta.label}</Badge>
                          </div>
                          <div className="text-xs text-slate-600 grid grid-cols-2 gap-y-1">
                            <span className="flex items-center gap-1 truncate"><User className="h-3 w-3 text-slate-400" />{r.customer_name || '-'}</span>
                            <span className="flex items-center gap-1 truncate"><Cpu className="h-3 w-3 text-slate-400" />{r.device_type || '-'}</span>
                          </div>
                          <div className="flex gap-1 mt-3">
                            {r.status !== 'completed' && <Button variant="outline" size="sm" className="h-8 text-xs flex-1" onClick={() => markComplete(r)}>Complete</Button>}
                            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openEdit(r)}><Edit className="h-3.5 w-3.5" /></Button>
                            <Button variant="outline" size="sm" className="h-8 text-xs text-red-500" onClick={() => handleDelete(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
          </CardContent>
        </Card>
      </div>

      {/* Form Dialog */}
      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? 'Edit Reading' : 'New Reading'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {error && <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Site Name *</Label><Input value={form.site_name} onChange={(e) => setForm(p => ({...p, site_name: e.target.value}))} className="h-9" data-testid="reading-site-name" /></div>
              <div className="space-y-1"><Label className="text-xs">Site Reference</Label><Input value={form.site_ref} onChange={(e) => setForm(p => ({...p, site_ref: e.target.value}))} className="h-9" data-testid="reading-site-ref" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Site Address</Label><Input value={form.site_address} onChange={(e) => setForm(p => ({...p, site_address: e.target.value}))} className="h-9" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Device ID</Label><Input value={form.device_id} onChange={(e) => setForm(p => ({...p, device_id: e.target.value}))} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Device Type</Label><Input value={form.device_type} onChange={(e) => setForm(p => ({...p, device_type: e.target.value}))} className="h-9" placeholder="e.g., net-meter" /></div>
              <div className="space-y-1"><Label className="text-xs">Device Serial</Label><Input value={form.device_serial} onChange={(e) => setForm(p => ({...p, device_serial: e.target.value}))} className="h-9 font-mono" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Customer Name</Label><Input value={form.customer_name} onChange={(e) => setForm(p => ({...p, customer_name: e.target.value}))} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Customer Phone</Label><Input value={form.customer_phone} onChange={(e) => setForm(p => ({...p, customer_phone: e.target.value}))} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Account No.</Label><Input value={form.customer_account} onChange={(e) => setForm(p => ({...p, customer_account: e.target.value}))} className="h-9" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Start Date *</Label><Input type="date" value={form.start_date} onChange={(e) => setForm(p => ({...p, start_date: e.target.value}))} className="h-9" data-testid="reading-start-date" /></div>
              <div className="space-y-1"><Label className="text-xs">Days</Label><Input type="number" min="0" value={form.days} onChange={(e) => setForm(p => ({...p, days: e.target.value}))} className="h-9" data-testid="reading-days" /></div>
              <div className="space-y-1"><Label className="text-xs">End Date (auto)</Label><Input value={computeEnd(form.start_date, form.days)} disabled className="h-9 bg-slate-50" data-testid="reading-end-date" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm(p => ({...p, status: v}))}>
                  <SelectTrigger className="h-9" data-testid="reading-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={(e) => setForm(p => ({...p, notes: e.target.value}))} className="h-9" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2" data-testid="save-reading-btn">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{editingId ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
