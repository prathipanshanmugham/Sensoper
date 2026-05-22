import { useState, useEffect, useCallback } from 'react';
import { accountsAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Loader2, Plus, Save, Trash2, Edit, Receipt, TrendingDown } from 'lucide-react';

const blank = { entry_type: 'operational_expense', entry_date: new Date().toISOString().slice(0,10), amount: '', description: '' };

export default function ExpensesSection() {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { entry_type: 'operational_expense' };
      if (from) params.date_from = from;
      if (to) params.date_to = to;
      const [opRes, sumRes] = await Promise.all([
        accountsAPI.list(params),
        accountsAPI.summary()
      ]);
      setEntries(opRes.data);
      setSummary(sumRes.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditingId(null); setForm(blank); setError(''); setShowForm(true); };
  const openEdit = (e) => {
    setEditingId(e.id);
    setForm({ entry_type: e.entry_type, entry_date: e.entry_date, amount: e.amount, description: e.description || '' });
    setError(''); setShowForm(true);
  };

  const save = async () => {
    if (!form.entry_date || form.amount === '' || form.amount === null) { setError('Date and amount are required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, entry_type: 'operational_expense', amount: parseFloat(form.amount) };
      if (editingId) await accountsAPI.update(editingId, payload);
      else await accountsAPI.create(payload);
      setShowForm(false);
      await load();
    } catch (e) { setError(formatApiErrorDetail(e.response?.data?.detail) || 'Save failed'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this expense entry?')) return;
    try { await accountsAPI.delete(id); await load(); }
    catch (e) { alert(e.response?.data?.detail || 'Delete failed'); }
  };

  const opExpMtd = summary?.operational_expense_mtd || 0;
  const monthPrefix = new Date().toISOString().slice(0,8); // YYYY-MM-
  const monthCount = entries.filter(e => (e.entry_date || '').startsWith(monthPrefix)).length;

  return (
    <div data-testid="expenses-section">
      {/* Snapshot — Operational Expense only (GST moved to its own tab) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <Card className="border-amber-200 bg-amber-50/40" data-testid="exp-snapshot-op">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="h-4 w-4 text-amber-600" />
              <p className="text-xs uppercase tracking-wider text-slate-500">Operational Expense (MTD)</p>
            </div>
            <p className="text-2xl font-bold text-slate-900" data-testid="exp-op-amount">₹{opExpMtd.toLocaleString('en-IN')}</p>
            <p className="text-[11px] text-slate-500 mt-1">Rent, salaries, utilities, etc.</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200" data-testid="exp-snapshot-count">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-slate-600" />
              <p className="text-xs uppercase tracking-wider text-slate-500">Entries This Month</p>
            </div>
            <p className="text-2xl font-bold text-slate-900" data-testid="exp-count">{monthCount}</p>
            <p className="text-[11px] text-slate-500 mt-1">Operational expense entries logged this month</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters & New */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" data-testid="exp-filter-from" /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" data-testid="exp-filter-to" /></div>
        <Button onClick={openCreate} className="ml-auto h-9 gap-1 bg-amber-600 hover:bg-amber-700 text-white" data-testid="exp-new-btn"><Plus className="h-4 w-4" />New Operational Expense</Button>
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-amber-200 mb-4" data-testid="exp-form">
          <CardContent className="p-4 space-y-3">
            {error && <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Date *</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm(p => ({...p, entry_date: e.target.value}))} className="h-9" data-testid="exp-form-date" /></div>
              <div className="space-y-1"><Label className="text-xs">Amount (₹) *</Label><Input type="number" value={form.amount} onChange={(e) => setForm(p => ({...p, amount: e.target.value}))} className="h-9" data-testid="exp-form-amount" /></div>
              <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={form.description} onChange={(e) => setForm(p => ({...p, description: e.target.value}))} className="h-9" placeholder="e.g., Office rent, Salaries" data-testid="exp-form-desc" /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white gap-1" data-testid="exp-save-btn">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{editingId ? 'Save Changes' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entries list */}
      <Card className="border-slate-200" data-testid="exp-list">
        <CardHeader className="py-3 border-b border-slate-200"><CardTitle className="text-base font-['Outfit']">Expense History ({entries.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-amber-600" /></div> :
            entries.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No expenses yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Date</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Amount (₹)</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Description</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">By</th>
                    <th className="px-4 py-2.5"></th>
                  </tr></thead>
                  <tbody>
                    {entries.map(e => (
                      <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`exp-row-${e.id}`}>
                        <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{e.entry_date}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-900">₹{(e.amount || 0).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2.5 text-slate-600">{e.description || '-'}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{e.entered_by || '-'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(e)} data-testid={`exp-edit-${e.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => remove(e.id)} data-testid={`exp-delete-${e.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}