import { useState, useEffect, useCallback } from 'react';
import { creditsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Loader2, Plus, IndianRupee, X, Save, Trash2 } from 'lucide-react';
import AccountsSection from '../components/AccountsSection';

const STATUS_COLORS = { active: 'bg-blue-100 text-blue-700', overdue: 'bg-red-100 text-red-700', closed: 'bg-emerald-100 text-emerald-700' };

export default function CustomerCreditsPage() {
  const [section, setSection] = useState('credits');
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showPay, setShowPay] = useState(null);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', invoice_ref: '', total_amount: '', due_date: '', notes: '' });
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'cash', notes: '' });
  const [saving, setSaving] = useState(false);

  const fetch = useCallback(async () => {
    try { const res = await creditsAPI.list({ status: filter !== 'all' ? filter : undefined }); setCredits(res.data); }
    catch (err) { console.error(err); } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async () => {
    if (!form.customer_name || !form.total_amount) return;
    setSaving(true);
    try { await creditsAPI.create({ ...form, total_amount: parseFloat(form.total_amount) }); setShowForm(false); setForm({ customer_name: '', customer_phone: '', invoice_ref: '', total_amount: '', due_date: '', notes: '' }); await fetch(); }
    catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const handlePay = async () => {
    if (!payForm.amount || !showPay) return;
    setSaving(true);
    try { await creditsAPI.pay(showPay, { credit_id: showPay, amount: parseFloat(payForm.amount), payment_method: payForm.payment_method, notes: payForm.notes }); setShowPay(null); setPayForm({ amount: '', payment_method: 'cash', notes: '' }); await fetch(); }
    catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const totalOutstanding = credits.reduce((s, c) => s + (c.balance || 0), 0);
  const overdue = credits.filter(c => c.status === 'overdue').length;
  const aging = { '0_30': 0, '30_60': 0, '60_plus': 0 };
  const now = Date.now();
  credits.forEach(c => {
    if (c.status === 'closed') return;
    const created = new Date(c.created_at).getTime();
    const days = Math.floor((now - created) / 86400000);
    if (days <= 30) aging['0_30'] += c.balance || 0;
    else if (days <= 60) aging['30_60'] += c.balance || 0;
    else aging['60_plus'] += c.balance || 0;
  });

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div><h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="credits-title">Customer Credits & Accounts</h1><p className="text-sm text-slate-500">Manage receivables and financial account snapshots</p></div>
          {section === 'credits' && <Button onClick={() => setShowForm(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="new-credit-btn"><Plus className="h-4 w-4" />New Credit</Button>}
        </div>

        {/* Section tabs */}
        <div className="flex gap-2 mb-5 border-b border-slate-200" data-testid="section-tabs">
          <button onClick={() => setSection('credits')} className={`px-4 py-2 text-sm border-b-2 transition-colors ${section === 'credits' ? 'border-emerald-500 text-emerald-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'}`} data-testid="tab-credits">Customer Credits</button>
          <button onClick={() => setSection('accounts')} className={`px-4 py-2 text-sm border-b-2 transition-colors ${section === 'accounts' ? 'border-emerald-500 text-emerald-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'}`} data-testid="tab-accounts">Accounts</button>
        </div>

        {section === 'accounts' ? <AccountsSection /> : (<>
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" data-testid="credit-kpis">
          <Card className="border-slate-200"><CardContent className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-slate-400">Total Outstanding</p><p className="text-xl font-bold text-slate-900">₹{totalOutstanding.toLocaleString('en-IN')}</p></CardContent></Card>
          <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-red-400">Overdue</p><p className="text-xl font-bold text-red-700">{overdue}</p></CardContent></Card>
          <Card className="border-slate-200"><CardContent className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-slate-400">0-30 Days</p><p className="text-lg font-bold text-slate-700">₹{aging['0_30'].toLocaleString('en-IN')}</p></CardContent></Card>
          <Card className="border-amber-200"><CardContent className="p-4 text-center"><p className="text-[10px] uppercase tracking-wider text-amber-500">60+ Days</p><p className="text-lg font-bold text-amber-700">₹{aging['60_plus'].toLocaleString('en-IN')}</p></CardContent></Card>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-4">
          {['all', 'active', 'overdue', 'closed'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 text-xs rounded-full border ${filter === s ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium' : 'bg-white border-slate-200 text-slate-600'}`} data-testid={`filter-${s}`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
          ))}
        </div>

        {/* Create Form */}
        {showForm && (
          <Card className="border-emerald-200 mb-4" data-testid="credit-form">
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Customer Name *</Label><Input value={form.customer_name} onChange={(e) => setForm(p => ({...p, customer_name: e.target.value}))} className="h-9" data-testid="credit-name" /></div>
                <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={form.customer_phone} onChange={(e) => setForm(p => ({...p, customer_phone: e.target.value}))} className="h-9" data-testid="credit-phone" /></div>
                <div className="space-y-1"><Label className="text-xs">Invoice Ref</Label><Input value={form.invoice_ref} onChange={(e) => setForm(p => ({...p, invoice_ref: e.target.value}))} className="h-9" data-testid="credit-invoice" /></div>
                <div className="space-y-1"><Label className="text-xs">Total Amount (₹) *</Label><Input type="number" value={form.total_amount} onChange={(e) => setForm(p => ({...p, total_amount: e.target.value}))} className="h-9" data-testid="credit-amount" /></div>
                <div className="space-y-1"><Label className="text-xs">Due Date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm(p => ({...p, due_date: e.target.value}))} className="h-9" data-testid="credit-due" /></div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={saving} className="bg-emerald-600 text-white" data-testid="save-credit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pay Modal */}
        {showPay && (
          <Card className="border-blue-200 mb-4" data-testid="pay-form">
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-sm">Record Payment</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Amount (₹) *</Label><Input type="number" value={payForm.amount} onChange={(e) => setPayForm(p => ({...p, amount: e.target.value}))} className="h-9" data-testid="pay-amount" /></div>
                <div className="space-y-1"><Label className="text-xs">Method</Label>
                  <Select value={payForm.payment_method} onValueChange={(v) => setPayForm(p => ({...p, payment_method: v}))}><SelectTrigger className="h-9" data-testid="pay-method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="cheque">Cheque</SelectItem><SelectItem value="bank_transfer">Bank Transfer</SelectItem></SelectContent></Select>
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowPay(null)}><X className="h-4 w-4" /></Button>
                  <Button size="sm" onClick={handlePay} disabled={saving} className="bg-blue-600 text-white" data-testid="record-pay-btn"><IndianRupee className="h-4 w-4 mr-1" />Pay</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Credits Table */}
        <Card className="border-slate-200" data-testid="credits-table">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Customer</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Invoice</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Total</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Paid</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Balance</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Due</th>
                  <th className="px-4 py-2.5"></th>
                </tr></thead>
                <tbody>
                  {credits.map(c => (
                    <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`credit-row-${c.id}`}>
                      <td className="px-4 py-2.5 font-medium">{c.customer_name}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{c.invoice_ref || '-'}</td>
                      <td className="px-4 py-2.5">₹{(c.total_amount || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 text-emerald-600">₹{(c.amount_paid || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 font-semibold">₹{(c.balance || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5"><Badge className={`text-[10px] ${STATUS_COLORS[c.status] || ''}`}>{c.status}</Badge></td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{c.due_date || '-'}</td>
                      <td className="px-4 py-2.5 flex gap-1">
                        {c.status !== 'closed' && <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-600" onClick={() => setShowPay(c.id)} data-testid={`pay-btn-${c.id}`}>Pay</Button>}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={async () => { await creditsAPI.delete(c.id); fetch(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {credits.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No credits found</p>}
          </CardContent>
        </Card>
        </>)}
      </div>
    </div>
  );
}
