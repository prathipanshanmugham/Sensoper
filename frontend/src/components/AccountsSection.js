import { useState, useEffect, useCallback } from 'react';
import { accountsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Loader2, Plus, Save, Trash2, Edit, Wallet, Banknote } from 'lucide-react';

const ENTRY_META = {
  cash_on_hand: { label: 'Cash on Hand', icon: Wallet, color: 'emerald', accent: 'border-emerald-200 bg-emerald-50/40' },
  account_balance: { label: 'Account Balance', icon: Banknote, color: 'violet', accent: 'border-violet-200 bg-violet-50/40' }
};

const blank = { entry_type: 'cash_on_hand', entry_date: new Date().toISOString().slice(0,10), amount: '', description: '' };

export default function AccountsSection() {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
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
      const params = {};
      if (filterType !== 'all') params.entry_type = filterType;
      if (from) params.date_from = from;
      if (to) params.date_to = to;
      const [list, sum] = await Promise.all([accountsAPI.list(params), accountsAPI.summary()]);
      setEntries(list.data);
      setSummary(sum.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filterType, from, to]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditingId(null); setForm(blank); setError(''); setShowForm(true); };
  const openEdit = (e) => {
    setEditingId(e.id);
    setForm({ entry_type: e.entry_type, entry_date: e.entry_date, amount: e.amount, description: e.description || '' });
    setError(''); setShowForm(true);
  };

  const save = async () => {
    if (!form.entry_type || !form.entry_date || form.amount === '' || form.amount === null) { setError('Type, date and amount are required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, amount: parseFloat(form.amount) };
      if (editingId) await accountsAPI.update(editingId, payload);
      else await accountsAPI.create(payload);
      setShowForm(false);
      await load();
    } catch (e) { setError(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this account entry?')) return;
    try { await accountsAPI.delete(id); await load(); }
    catch (e) { alert(e.response?.data?.detail || 'Delete failed'); }
  };

  return (
    <div data-testid="accounts-section">
      {/* Snapshot cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {Object.entries(ENTRY_META).map(([key, meta]) => {
          const s = summary?.[key];
          const Icon = meta.icon;
          return (
            <Card key={key} className={meta.accent} data-testid={`accounts-snapshot-${key}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 text-${meta.color}-600`} />
                  <p className="text-xs uppercase tracking-wider text-slate-500">{meta.label}</p>
                </div>
                <p className="text-2xl font-bold text-slate-900" data-testid={`accounts-amount-${key}`}>₹{(s?.amount || 0).toLocaleString('en-IN')}</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {s?.entry_date ? `As of ${s.entry_date}` : 'No entries yet'}
                  {s?.entered_by ? ` · by ${s.entered_by}` : ''}
                </p>
                {s?.description && <p className="text-xs text-slate-600 mt-1 truncate">{s.description}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filter & New */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1"><Label className="text-xs">Type</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 w-44" data-testid="accounts-filter-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="cash_on_hand">Cash on Hand</SelectItem>
              <SelectItem value="account_balance">Account Balance</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" data-testid="accounts-filter-from" /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" data-testid="accounts-filter-to" /></div>
        <Button onClick={openCreate} className="ml-auto h-9 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="accounts-new-btn"><Plus className="h-4 w-4" />New Entry</Button>
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-emerald-200 mb-4" data-testid="accounts-form">
          <CardContent className="p-4 space-y-3">
            {error && <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">Type *</Label>
                <Select value={form.entry_type} onValueChange={(v) => setForm(p => ({...p, entry_type: v}))}>
                  <SelectTrigger className="h-9" data-testid="accounts-form-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash_on_hand">Cash on Hand</SelectItem>
                    <SelectItem value="account_balance">Account Balance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Date *</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm(p => ({...p, entry_date: e.target.value}))} className="h-9" data-testid="accounts-form-date" /></div>
              <div className="space-y-1"><Label className="text-xs">Amount / Value (₹) *</Label><Input type="number" value={form.amount} onChange={(e) => setForm(p => ({...p, amount: e.target.value}))} className="h-9" data-testid="accounts-form-amount" /></div>
              <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={form.description} onChange={(e) => setForm(p => ({...p, description: e.target.value}))} className="h-9" placeholder="e.g., Branch float" data-testid="accounts-form-desc" /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving} className="bg-emerald-600 text-white gap-1" data-testid="accounts-save-btn">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{editingId ? 'Save Changes' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entries list */}
      <Card className="border-slate-200" data-testid="accounts-list">
        <CardHeader className="py-3 border-b border-slate-200"><CardTitle className="text-base font-['Outfit']">History ({entries.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div> :
            entries.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No entries yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Date</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Type</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Amount (₹)</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Description</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">By</th>
                    <th className="px-4 py-2.5"></th>
                  </tr></thead>
                  <tbody>
                    {entries.map(e => {
                      const meta = ENTRY_META[e.entry_type] || ENTRY_META.cash_on_hand;
                      const Icon = meta.icon;
                      return (
                        <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`accounts-row-${e.id}`}>
                          <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{e.entry_date}</td>
                          <td className="px-4 py-2.5"><Badge variant="outline" className="text-[10px] gap-1"><Icon className="h-3 w-3" />{meta.label}</Badge></td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-900">₹{(e.amount || 0).toLocaleString('en-IN')}</td>
                          <td className="px-4 py-2.5 text-slate-600">{e.description || '-'}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{e.entered_by || '-'}</td>
                          <td className="px-4 py-2.5 text-right">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(e)} data-testid={`accounts-edit-${e.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => remove(e.id)} data-testid={`accounts-delete-${e.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
