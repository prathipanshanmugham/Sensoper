import { useState, useEffect, useCallback } from 'react';
import { returnsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Loader2, Plus, X, Save, CheckCircle2, Undo2, Trash2, Clock } from 'lucide-react';

export default function BrandReturnsPage() {
  const { isAdmin } = useAuth();
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ project_id: '', supplier_name: '', item_name: '', quantity: '', reason: 'damage', notes: '' });
  const [del, setDel] = useState(null);
  const [delReason, setDelReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  const fetch = useCallback(async () => {
    try { const res = await returnsAPI.list(); setReturns(res.data); }
    catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetch(); }, [fetch]);

  const confirmDelete = async () => {
    if (delReason.trim().length < 3) { toast.error('Please give a reason (at least 3 characters)'); return; }
    setDeleting(true);
    try {
      const r = await returnsAPI.remove(del.id, delReason.trim());
      toast[r.data.status === 'deleted' ? 'success' : 'info'](r.data.message);
      setDel(null); setDelReason(''); await fetch();
    } catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); }
    finally { setDeleting(false); }
  };

  const handleCreate = async () => {
    if (!form.item_name || !form.quantity) return;
    setSaving(true);
    try { await returnsAPI.create({...form, quantity: parseFloat(form.quantity)}); setShowForm(false); setForm({ project_id: '', supplier_name: '', item_name: '', quantity: '', reason: 'damage', notes: '' }); await fetch(); }
    catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const totalPending = returns.filter(r => r.status === 'pending').length;
  const totalCompleted = returns.filter(r => r.status === 'completed').length;

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="py-6 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="returns-title">Brand Returns</h1><p className="text-sm text-slate-500">Track returned materials (damaged/unused/defective)</p></div>
          <Button onClick={() => setShowForm(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="new-return-btn"><Plus className="h-4 w-4" />New Return</Button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-700">{totalPending}</p><p className="text-xs text-amber-500">Pending</p></CardContent></Card>
          <Card className="border-emerald-200 bg-emerald-50"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-emerald-700">{totalCompleted}</p><p className="text-xs text-emerald-500">Completed</p></CardContent></Card>
        </div>

        {showForm && (
          <Card className="border-emerald-200 mb-4" data-testid="return-form">
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Item Name *</Label><Input value={form.item_name} onChange={(e) => setForm(p => ({...p, item_name: e.target.value}))} className="h-9" data-testid="ret-item" /></div>
                <div className="space-y-1"><Label className="text-xs">Quantity *</Label><Input type="number" value={form.quantity} onChange={(e) => setForm(p => ({...p, quantity: e.target.value}))} className="h-9" data-testid="ret-qty" /></div>
                <div className="space-y-1"><Label className="text-xs">Reason</Label>
                  <Select value={form.reason} onValueChange={(v) => setForm(p => ({...p, reason: v}))}><SelectTrigger className="h-9" data-testid="ret-reason"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="damage">Damage</SelectItem><SelectItem value="excess">Excess</SelectItem><SelectItem value="defect">Defect</SelectItem></SelectContent></Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Supplier</Label><Input value={form.supplier_name} onChange={(e) => setForm(p => ({...p, supplier_name: e.target.value}))} className="h-9" data-testid="ret-supplier" /></div>
                <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={(e) => setForm(p => ({...p, notes: e.target.value}))} className="h-9" data-testid="ret-notes" /></div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={saving} className="bg-emerald-600 text-white" data-testid="save-return-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3" data-testid="returns-list">
          {returns.map(r => (
            <Card key={r.id} className="border-slate-200" data-testid={`return-${r.id}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2"><Undo2 className="h-4 w-4 text-slate-400" /><h3 className="font-semibold">{r.item_name}</h3><Badge className={`text-[10px] ${r.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.status}</Badge><Badge variant="outline" className="text-[10px]">{r.reason}</Badge></div>
                  <p className="text-xs text-slate-500 mt-1">Qty: {r.quantity}{r.supplier_name ? ` | Supplier: ${r.supplier_name}` : ''} | {new Date(r.created_at).toLocaleDateString('en-IN')}</p>
                </div>
                <div className="flex items-center gap-2">
                  {r.delete_pending && <Badge className="bg-amber-100 text-amber-700 text-[10px] gap-1" data-testid={`return-delete-pending-${r.id}`}><Clock className="h-3 w-3" />Deletion awaiting approval</Badge>}
                  {r.status === 'pending' && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={async () => { await returnsAPI.complete(r.id); fetch(); }} data-testid={`complete-return-${r.id}`}><CheckCircle2 className="h-3.5 w-3.5" />Complete</Button>}
                  {!r.delete_pending && <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => { setDel(r); setDelReason(''); }} title={isAdmin ? 'Delete (snapshot kept in audit log)' : 'Request deletion — needs manager/admin approval'} data-testid={`delete-return-${r.id}`}><Trash2 className="h-3.5 w-3.5" />{isAdmin ? 'Delete' : 'Request delete'}</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
          {returns.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No returns found</p>}
        </div>

        <Dialog open={!!del} onOpenChange={(v) => !v && setDel(null)}>
          <DialogContent className="max-w-md" data-testid="return-delete-dialog">
            <DialogHeader>
              <DialogTitle>{isAdmin ? 'Delete return' : 'Request deletion'}: {del?.item_name} × {del?.quantity}</DialogTitle>
              <DialogDescription>{isAdmin ? 'The record is removed immediately; a full snapshot is kept in the audit log.' : 'A manager or admin must approve before the record is removed. A full snapshot is kept in the audit log.'}</DialogDescription>
            </DialogHeader>
            <Textarea rows={3} value={delReason} onChange={(e) => setDelReason(e.target.value)} placeholder="Reason (required)" data-testid="return-delete-reason" />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDel(null)} disabled={deleting}>Cancel</Button>
              <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={confirmDelete} disabled={deleting || delReason.trim().length < 3} data-testid="return-delete-confirm">{deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}{isAdmin ? 'Delete' : 'Send request'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
