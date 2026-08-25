import { useState, useEffect, useCallback } from 'react';
import { amcAPI, projectsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Loader2, RefreshCw, Plus, IndianRupee, Zap, Users, TrendingUp, CalendarClock, Sparkles } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const STATUS_STYLES = { active: 'bg-emerald-100 text-emerald-700', expiring: 'bg-amber-100 text-amber-700', expired: 'bg-rose-100 text-rose-700', renewed: 'bg-blue-100 text-blue-700', cancelled: 'bg-slate-200 text-slate-600', 'on-hold': 'bg-violet-100 text-violet-700' };

function KpiCard({ label, value, icon: Icon, testid }) {
  return (
    <Card className="border-slate-200" data-testid={testid}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-slate-400 mb-1"><Icon className="h-4 w-4" /><span className="text-[11px] uppercase tracking-wide">{label}</span></div>
        <p className="text-xl font-bold text-slate-900">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function AMCDashboard() {
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  const [dashboard, setDashboard] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showFromProject, setShowFromProject] = useState(false);
  const [completedProjects, setCompletedProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [tab, setTab] = useState('contracts');
  const [revenueReport, setRevenueReport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ customer_name: '', contact: '', site_address: '', district: '', system_type: 'on-grid', system_capacity_kw: '', contract_type: 'comprehensive', start_date: '', duration_months: 12, annual_value: '', billing_frequency: 'annual', visits_per_year: 2 });

  const fetchAll = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([amcAPI.dashboard(), amcAPI.list(statusFilter !== 'all' ? { status: statusFilter } : {})]);
      setDashboard(d.data); setContracts(c.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [statusFilter]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const fetchRevenueReport = async () => { try { const r = await amcAPI.recurringRevenueReport(); setRevenueReport(r.data); } catch (e) { console.error(e); } };
  useEffect(() => { if (tab === 'revenue') fetchRevenueReport(); }, [tab]);

  const openFromProject = async () => {
    setShowFromProject(true);
    try { const r = await projectsAPI.getAll('completed'); setCompletedProjects(r.data || []); } catch (e) { console.error(e); }
  };

  const handleCreateFromProject = async () => {
    if (!selectedProjectId) return;
    setSaving(true);
    try { await amcAPI.createFromProject(selectedProjectId); setShowFromProject(false); setSelectedProjectId(''); await fetchAll(); }
    catch (e) { alert(e.response?.data?.detail || 'Could not create contract'); } finally { setSaving(false); }
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await amcAPI.create({ ...form, system_capacity_kw: parseFloat(form.system_capacity_kw) || 0, annual_value: parseFloat(form.annual_value) || 0, duration_months: parseInt(form.duration_months) || 12, visits_per_year: parseInt(form.visits_per_year) || 2 });
      setShowCreate(false); await fetchAll();
    } catch (e) { alert(e.response?.data?.detail || 'Could not create contract'); } finally { setSaving(false); }
  };

  const handleRenew = async (id) => { try { await amcAPI.renew(id); await fetchAll(); } catch (e) { alert('Could not renew'); } };
  const handleCancel = async (id) => { const reason = window.prompt('Reason for cancellation (optional)') || ''; try { await amcAPI.cancel(id, reason); await fetchAll(); } catch (e) { alert('Could not cancel'); } };

  const capacityChartData = dashboard ? Object.entries(dashboard.capacity_by_type || {}).map(([name, value]) => ({ name: name.replace(/-/g, ' '), value: Math.round(value * 10) / 10 })) : [];

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="py-6 px-4">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="amc-title"><RefreshCw className="inline h-6 w-6 mr-2 text-emerald-600" />AMC Contracts</h1>
            <p className="text-sm text-slate-500">Recurring maintenance revenue — tracked separately from project revenue</p>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={openFromProject} className="gap-1.5" data-testid="create-amc-from-project-btn"><Sparkles className="h-4 w-4" />From Completed Project</Button>
              <Button onClick={() => setShowCreate(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="add-amc-btn"><Plus className="h-4 w-4" />New Contract</Button>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => setTab('contracts')} className={`px-3 py-1.5 text-xs rounded-full border ${tab === 'contracts' ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium' : 'bg-white border-slate-200 text-slate-600'}`} data-testid="amc-tab-contracts">Dashboard &amp; Contracts</button>
          <button onClick={() => setTab('revenue')} className={`px-3 py-1.5 text-xs rounded-full border ${tab === 'revenue' ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium' : 'bg-white border-slate-200 text-slate-600'}`} data-testid="amc-tab-revenue">Recurring Revenue Report</button>
        </div>

        {tab === 'contracts' && dashboard && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard label="ARR" value={`₹${dashboard.arr.toLocaleString('en-IN')}`} icon={IndianRupee} testid="amc-kpi-arr" />
              <KpiCard label="MRR" value={`₹${dashboard.mrr.toLocaleString('en-IN')}`} icon={IndianRupee} testid="amc-kpi-mrr" />
              <KpiCard label="Active Contracts" value={dashboard.active_contracts} icon={Users} testid="amc-kpi-active" />
              <KpiCard label="Renewal Rate" value={`${dashboard.renewal_rate_pct}%`} icon={TrendingUp} testid="amc-kpi-renewal" />
              <KpiCard label="Expiring ≤30d" value={dashboard.expiring_30} icon={CalendarClock} testid="amc-kpi-exp30" />
              <KpiCard label="Pump HP under AMC" value={dashboard.pump_hp_total} icon={Zap} testid="amc-kpi-pumphp" />
              <KpiCard label="AMC Penetration" value={`${dashboard.penetration_pct}%`} icon={TrendingUp} testid="amc-kpi-penetration" />
              <KpiCard label="Outstanding" value={`₹${dashboard.outstanding.toLocaleString('en-IN')}`} icon={IndianRupee} testid="amc-kpi-outstanding" />
            </div>

            <Card className="border-slate-200">
              <CardHeader className="py-3"><CardTitle className="text-sm font-['Outfit']">Capacity Under AMC by System Type (kW)</CardTitle></CardHeader>
              <CardContent>
                {capacityChartData.length ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={capacityChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-xs text-slate-400 text-center py-8">No active AMC capacity yet</p>}
              </CardContent>
            </Card>

            <Card className="border-slate-200">
              <CardHeader className="py-3 flex-row items-center justify-between">
                <CardTitle className="text-sm font-['Outfit']">Contracts</CardTitle>
                <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="h-8 w-40 text-xs" data-testid="amc-status-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{Object.keys(STATUS_STYLES).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50"><tr><th className="text-left p-2">Contract</th><th className="text-left p-2">Customer</th><th className="text-left p-2">System</th><th className="text-right p-2">Annual Value</th><th className="text-left p-2">End Date</th><th className="text-left p-2">Status</th><th className="text-right p-2">Actions</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {contracts.map(c => (
                        <tr key={c.id} data-testid={`amc-row-${c.id}`}>
                          <td className="p-2 font-medium">{c.contract_number}</td>
                          <td className="p-2">{c.customer_name}</td>
                          <td className="p-2">{c.system_type} {c.system_capacity_kw ? `(${c.system_capacity_kw}kW)` : ''}{c.pump_hp ? `(${c.pump_hp}HP)` : ''}</td>
                          <td className="p-2 text-right">₹{(c.annual_value || 0).toLocaleString('en-IN')}</td>
                          <td className="p-2">{c.end_date}</td>
                          <td className="p-2"><Badge className={STATUS_STYLES[c.status] || ''}>{c.status}</Badge></td>
                          <td className="p-2 text-right space-x-1">
                            {canManage && c.status === 'active' && <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => handleRenew(c.id)} data-testid={`renew-amc-${c.id}`}>Renew</Button>}
                            {canManage && c.status === 'active' && <Button size="sm" variant="outline" className="h-7 text-[11px] text-rose-600" onClick={() => handleCancel(c.id)} data-testid={`cancel-amc-${c.id}`}>Cancel</Button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {contracts.length === 0 && <p className="text-center py-8 text-slate-400 text-xs">No AMC contracts yet</p>}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {tab === 'revenue' && revenueReport && (
          <Card className="border-slate-200" data-testid="amc-revenue-report">
            <CardHeader className="py-3"><CardTitle className="text-sm font-['Outfit']">Recurring Revenue Report</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(revenueReport.summary).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-slate-200 p-3 text-center"><p className="text-[10px] uppercase text-slate-400">{k.replace(/_/g, ' ')}</p><p className="text-lg font-bold text-slate-900">{typeof v === 'number' && v > 999 ? v.toLocaleString('en-IN') : v}</p></div>
                ))}
              </div>
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50"><tr><th className="text-left p-2">Contract</th><th className="text-left p-2">Customer</th><th className="text-right p-2">Annual Value</th><th className="text-left p-2">Status</th><th className="text-right p-2">Outstanding</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {revenueReport.rows.map((r, i) => <tr key={i}><td className="p-2">{r.contract_number}</td><td className="p-2">{r.customer}</td><td className="p-2 text-right">₹{(r.annual_value || 0).toLocaleString('en-IN')}</td><td className="p-2">{r.status}</td><td className="p-2 text-right">₹{(r.outstanding || 0).toLocaleString('en-IN')}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showFromProject} onOpenChange={setShowFromProject}>
        <DialogContent data-testid="amc-from-project-dialog">
          <DialogHeader><DialogTitle>Create AMC from Completed Project</DialogTitle></DialogHeader>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="h-9" data-testid="amc-project-select"><SelectValue placeholder="Select a completed project" /></SelectTrigger>
            <SelectContent>{completedProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.customer?.name} — {p.reference_number}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter><Button variant="outline" onClick={() => setShowFromProject(false)}>Cancel</Button><Button onClick={handleCreateFromProject} disabled={saving || !selectedProjectId} className="bg-emerald-600 text-white" data-testid="confirm-amc-from-project-btn">Create Contract</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="create-amc-dialog">
          <DialogHeader><DialogTitle>New AMC Contract</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Customer Name" value={form.customer_name} onChange={e => setForm(p => ({ ...p, customer_name: e.target.value }))} className="h-9 col-span-2" data-testid="amc-customer-input" />
            <Input placeholder="Contact" value={form.contact} onChange={e => setForm(p => ({ ...p, contact: e.target.value }))} className="h-9" />
            <Input placeholder="District" value={form.district} onChange={e => setForm(p => ({ ...p, district: e.target.value }))} className="h-9" />
            <Select value={form.system_type} onValueChange={v => setForm(p => ({ ...p, system_type: v }))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="on-grid">On-Grid</SelectItem><SelectItem value="off-grid">Off-Grid</SelectItem><SelectItem value="hybrid">Hybrid</SelectItem><SelectItem value="solar-pump">Solar Pump</SelectItem></SelectContent></Select>
            <Input type="number" placeholder="Capacity (kW)" value={form.system_capacity_kw} onChange={e => setForm(p => ({ ...p, system_capacity_kw: e.target.value }))} className="h-9" />
            <Select value={form.contract_type} onValueChange={v => setForm(p => ({ ...p, contract_type: v }))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="comprehensive">Comprehensive</SelectItem><SelectItem value="non-comprehensive">Non-Comprehensive</SelectItem><SelectItem value="labour-only">Labour Only</SelectItem></SelectContent></Select>
            <Input type="date" placeholder="Start Date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} className="h-9" data-testid="amc-start-date-input" />
            <Input type="number" placeholder="Duration (months)" value={form.duration_months} onChange={e => setForm(p => ({ ...p, duration_months: e.target.value }))} className="h-9" />
            <Input type="number" placeholder="Annual Value (₹)" value={form.annual_value} onChange={e => setForm(p => ({ ...p, annual_value: e.target.value }))} className="h-9" data-testid="amc-value-input" />
            <Select value={form.billing_frequency} onValueChange={v => setForm(p => ({ ...p, billing_frequency: v }))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="half-yearly">Half-Yearly</SelectItem><SelectItem value="annual">Annual</SelectItem></SelectContent></Select>
            <Input type="number" placeholder="Visits/year" value={form.visits_per_year} onChange={e => setForm(p => ({ ...p, visits_per_year: e.target.value }))} className="h-9" />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={handleCreate} disabled={saving || !form.customer_name || !form.start_date} className="bg-emerald-600 text-white" data-testid="save-amc-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
