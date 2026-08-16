import { useState, useEffect, useCallback } from 'react';
import { accountsAPI, marketingAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Loader2, Plus, Save, Trash2, Edit, Wallet, Banknote, Megaphone, TrendingUp } from 'lucide-react';

const ENTRY_META = {
  cash_on_hand:      { label: 'Cash on Hand',      icon: Wallet,    color: 'emerald', accent: 'border-emerald-200 bg-emerald-50/40' },
  account_balance:   { label: 'Account Balance',   icon: Banknote,  color: 'violet',  accent: 'border-violet-200 bg-violet-50/40' },
  marketing_expense: { label: 'Marketing Expense', icon: Megaphone, color: 'rose',    accent: 'border-rose-200 bg-rose-50/40' },
};

const MARKETING_CHANNELS = [
  { value: 'google_ads',   label: 'Google Ads' },
  { value: 'meta',         label: 'Meta (FB/IG)' },
  { value: 'whatsapp',     label: 'WhatsApp Broadcast' },
  { value: 'hoardings',    label: 'Hoardings / OOH' },
  { value: 'local_events', label: 'Local Events / Melas' },
  { value: 'print',        label: 'Newspaper / Print' },
  { value: 'tv_radio',     label: 'TV / Radio' },
  { value: 'referral',     label: 'Referral Bonus' },
  { value: 'organic',      label: 'Organic / Word of Mouth' },
  { value: 'other',        label: 'Other' },
];

const blank = {
  entry_type: 'cash_on_hand',
  entry_date: new Date().toISOString().slice(0, 10),
  amount: '',
  description: '',
  marketing_channel: 'google_ads',
  campaign_name: '',
  target_district: '',
};

export default function AccountsSection() {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [marketingSummary, setMarketingSummary] = useState(null);
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
      const [list, sum, mkt] = await Promise.all([
        accountsAPI.list(params),
        accountsAPI.summary(),
        marketingAPI.summary({}).catch(() => ({ data: null })),
      ]);
      setEntries(list.data);
      setSummary(sum.data);
      setMarketingSummary(mkt.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filterType, from, to]);

  useEffect(() => { load(); }, [load]);

  const openCreate = (defaultType = 'cash_on_hand') => {
    setEditingId(null);
    setForm({ ...blank, entry_type: defaultType });
    setError('');
    setShowForm(true);
  };
  const openEdit = (e) => {
    setEditingId(e.id);
    setForm({
      entry_type: e.entry_type,
      entry_date: e.entry_date,
      amount: e.amount,
      description: e.description || '',
      marketing_channel: e.marketing_channel || 'google_ads',
      campaign_name: e.campaign_name || '',
      target_district: e.target_district || '',
    });
    setError(''); setShowForm(true);
  };

  const save = async () => {
    if (!form.entry_type || !form.entry_date || form.amount === '' || form.amount === null) { setError('Type, date and amount are required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, amount: parseFloat(form.amount) };
      // Only send marketing fields for marketing_expense
      if (payload.entry_type !== 'marketing_expense') {
        delete payload.marketing_channel;
        delete payload.campaign_name;
        delete payload.target_district;
      }
      if (editingId) await accountsAPI.update(editingId, payload);
      else await accountsAPI.create(payload);
      setShowForm(false);
      await load();
    } catch (e) { setError(formatApiErrorDetail(e.response?.data?.detail) || 'Save failed'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this account entry?')) return;
    try { await accountsAPI.delete(id); await load(); }
    catch (e) { alert(e.response?.data?.detail || 'Delete failed'); }
  };

  const isMarketing = form.entry_type === 'marketing_expense';

  return (
    <div data-testid="accounts-section">
      {/* Snapshot cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
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

      {/* Marketing 90-day summary strip */}
      {marketingSummary && (
        <Card className="border-rose-200 mb-4" data-testid="marketing-mini-summary">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-rose-600" />
              <p className="text-xs uppercase tracking-wider text-rose-700 font-semibold">Marketing — last 90 days</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div>
                <p className="text-[10px] uppercase text-slate-500">Total Spend</p>
                <p className="text-lg font-bold text-slate-900">₹{(marketingSummary.total_spend || 0).toLocaleString('en-IN')}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">Entries</p>
                <p className="text-lg font-bold text-slate-900">{marketingSummary.entry_count || 0}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">Channels Used</p>
                <p className="text-lg font-bold text-slate-900">{Object.keys(marketingSummary.by_channel || {}).length}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">Top Channel</p>
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {Object.entries(marketingSummary.by_channel || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'}
                </p>
              </div>
            </div>
            {(!marketingSummary.entry_count) && (
              <p className="text-[10px] text-slate-400 italic text-center mt-2">No spend recorded in the last 90 days — log a Marketing Expense to start tracking CAC.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filter & New */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1"><Label className="text-xs">Type</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 w-44" data-testid="accounts-filter-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="cash_on_hand">Cash on Hand</SelectItem>
              <SelectItem value="account_balance">Account Balance</SelectItem>
              <SelectItem value="marketing_expense">Marketing Expense</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" data-testid="accounts-filter-from" /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" data-testid="accounts-filter-to" /></div>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => openCreate('marketing_expense')} variant="outline" className="h-9 gap-1 border-rose-300 text-rose-700 hover:bg-rose-50" data-testid="accounts-new-marketing-btn"><Megaphone className="h-4 w-4" />New Marketing Spend</Button>
          <Button onClick={() => openCreate('cash_on_hand')} className="h-9 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="accounts-new-btn"><Plus className="h-4 w-4" />New Entry</Button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <Card className={`mb-4 ${isMarketing ? 'border-rose-200' : 'border-emerald-200'}`} data-testid="accounts-form">
          <CardContent className="p-4 space-y-3">
            {error && <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">Type *</Label>
                <Select value={form.entry_type} onValueChange={(v) => setForm(p => ({ ...p, entry_type: v }))}>
                  <SelectTrigger className="h-9" data-testid="accounts-form-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash_on_hand">Cash on Hand</SelectItem>
                    <SelectItem value="account_balance">Account Balance</SelectItem>
                    <SelectItem value="marketing_expense">Marketing Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Date *</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm(p => ({ ...p, entry_date: e.target.value }))} className="h-9" data-testid="accounts-form-date" /></div>
              <div className="space-y-1"><Label className="text-xs">Amount (₹) *</Label><Input type="number" value={form.amount} onChange={(e) => setForm(p => ({ ...p, amount: e.target.value }))} className="h-9" data-testid="accounts-form-amount" /></div>
              <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} className="h-9" placeholder={isMarketing ? 'e.g., Diwali festive push' : 'e.g., Branch float'} data-testid="accounts-form-desc" /></div>
            </div>
            {isMarketing && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-rose-100" data-testid="accounts-form-marketing-fields">
                <div className="space-y-1"><Label className="text-xs">Channel *</Label>
                  <Select value={form.marketing_channel} onValueChange={(v) => setForm(p => ({ ...p, marketing_channel: v }))}>
                    <SelectTrigger className="h-9" data-testid="accounts-form-channel"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MARKETING_CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Campaign Name</Label><Input value={form.campaign_name} onChange={(e) => setForm(p => ({ ...p, campaign_name: e.target.value }))} className="h-9" placeholder="e.g., Summer_2026_Rooftop" data-testid="accounts-form-campaign" /></div>
                <div className="space-y-1"><Label className="text-xs">Target District</Label><Input value={form.target_district} onChange={(e) => setForm(p => ({ ...p, target_district: e.target.value }))} className="h-9" placeholder="e.g., Coimbatore" data-testid="accounts-form-district" /></div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving} className={`text-white gap-1 ${isMarketing ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`} data-testid="accounts-save-btn">
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
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Channel / Campaign</th>
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
                          <td className="px-4 py-2.5 text-xs text-slate-600">
                            {e.entry_type === 'marketing_expense' ? (
                              <div className="flex flex-col">
                                <span className="font-medium">{MARKETING_CHANNELS.find(c => c.value === e.marketing_channel)?.label || e.marketing_channel || '—'}</span>
                                {e.campaign_name && <span className="text-[10px] text-slate-400">{e.campaign_name}{e.target_district ? ` · ${e.target_district}` : ''}</span>}
                              </div>
                            ) : '—'}
                          </td>
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
