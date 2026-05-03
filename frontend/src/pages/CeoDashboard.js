import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  BarChart3, TrendingUp, IndianRupee, CheckCircle2, Clock, Package,
  AlertTriangle, Users, ArrowLeft, Loader2, ClipboardCheck, ArrowUpRight
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const STATUS_COLORS = { draft: '#f59e0b', submitted: '#3b82f6', approved: '#10b981', rejected: '#ef4444', completed: '#059669', deletion_requested: '#f97316' };

function KpiCard({ title, value, icon: Icon, color = 'emerald', subtitle, onClick }) {
  return (
    <Card className={`border-slate-200 hover:shadow-md transition-shadow ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick} data-testid={`kpi-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</p>
            <p className={`text-2xl font-bold font-['Outfit'] text-${color}-600`}>{value}</p>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          <div className={`p-2.5 bg-${color}-50 rounded-xl`}>
            <Icon className={`h-5 w-5 text-${color}-600`} />
          </div>
        </div>
        {onClick && <div className="mt-2 flex items-center gap-1 text-xs text-slate-400"><ArrowUpRight className="h-3 w-3" />View details</div>}
      </CardContent>
    </Card>
  );
}

export default function CeoDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await dashboardAPI.getCeo();
      setData(res.data);
    } catch (err) {
      console.error('Failed to load CEO dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  if (!data) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><p className="text-slate-500">Failed to load dashboard</p></div>;

  const { kpis, status_distribution, revenue_trend, sales_funnel, top_staff } = data;

  const funnelData = [
    { name: 'Leads', value: sales_funnel.total_leads, fill: '#94a3b8' },
    { name: 'Quotes', value: sales_funnel.quotes_generated, fill: '#3b82f6' },
    { name: 'Approved', value: sales_funnel.approved, fill: '#10b981' },
    { name: 'Completed', value: sales_funnel.completed, fill: '#059669' }
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1">
            <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="ceo-title">CEO Dashboard</h1>
            <p className="text-sm text-slate-500">High-level business overview</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/dashboard/reports')} className="gap-2" data-testid="goto-reports-btn"><BarChart3 className="h-4 w-4" />Reports</Button>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" data-testid="kpi-grid">
          <KpiCard title="Total Revenue" value={`₹${(kpis.total_revenue || 0).toLocaleString('en-IN')}`} icon={IndianRupee} color="emerald" subtitle="Approved + Completed" onClick={() => navigate('/dashboard/reports?type=sales')} />
          <KpiCard title="Total Profit" value={`₹${(kpis.total_profit || 0).toLocaleString('en-IN')}`} icon={TrendingUp} color="blue" subtitle="Internal margins" onClick={() => navigate('/dashboard/reports?type=profit')} />
          <KpiCard title="Conversion Rate" value={`${kpis.conversion_rate}%`} icon={BarChart3} color="violet" subtitle={`${kpis.completed_projects} of ${kpis.total_projects} projects`} />
          <KpiCard title="Active Projects" value={kpis.active_projects} icon={Clock} color="amber" onClick={() => navigate('/dashboard/projects')} />
          <KpiCard title="Completed" value={kpis.completed_projects} icon={CheckCircle2} color="emerald" onClick={() => navigate('/dashboard/reports?type=execution')} />
          <KpiCard title="Pending Approvals" value={kpis.pending_approvals} icon={ClipboardCheck} color="red" onClick={() => navigate('/dashboard/approvals')} />
          <KpiCard title="Inventory Value" value={`₹${(kpis.inventory_value || 0).toLocaleString('en-IN')}`} icon={Package} color="slate" onClick={() => navigate('/dashboard/reports?type=inventory')} />
          <KpiCard title="Low Stock Alerts" value={kpis.low_stock_alerts} icon={AlertTriangle} color="amber" onClick={() => navigate('/dashboard/inventory')} />
          <KpiCard title="Outstanding Credit" value={`₹${(kpis.total_outstanding || 0).toLocaleString('en-IN')}`} icon={IndianRupee} color="red" subtitle={`Overdue: Rs ${(kpis.overdue_amount || 0).toLocaleString('en-IN')}`} onClick={() => navigate('/dashboard/credits')} />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Revenue Trend */}
          <Card className="border-slate-200 lg:col-span-2" data-testid="revenue-chart">
            <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit']">Revenue Trend</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              {revenue_trend.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={revenue_trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={(v) => v >= 100000 ? `${(v/100000).toFixed(1)}L` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                    <Tooltip formatter={(v) => [`₹${v.toLocaleString('en-IN')}`, 'Revenue']} />
                    <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: '#10b981' }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-slate-400 text-center py-16">No revenue data yet</p>}
            </CardContent>
          </Card>

          {/* Status Distribution */}
          <Card className="border-slate-200" data-testid="status-chart">
            <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit']">Project Status</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              {status_distribution.length > 0 ? (
                <div className="space-y-3 pt-2">
                  {status_distribution.map((item) => {
                    const total = status_distribution.reduce((s, i) => s + i.value, 0);
                    const pct = total > 0 ? (item.value / total) * 100 : 0;
                    const color = STATUS_COLORS[item.name] || '#94a3b8';
                    return (
                      <div key={item.name} className="space-y-1">
                        <div className="flex justify-between text-xs"><span className="text-slate-600 capitalize">{item.name}</span><span className="font-bold" style={{color}}>{item.value} ({pct.toFixed(0)}%)</span></div>
                        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width: `${pct}%`, backgroundColor: color}} /></div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-sm text-slate-400 text-center py-16">No projects yet</p>}
            </CardContent>
          </Card>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Sales Funnel */}
          <Card className="border-slate-200" data-testid="funnel-chart">
            <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit']">Sales Funnel</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={funnelData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" width={80} />
                  <Tooltip formatter={(v) => [v, 'Count']} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Top Staff */}
          <Card className="border-slate-200" data-testid="top-staff">
            <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Users className="h-4 w-4" />Top Performing Staff</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              {top_staff.length > 0 ? (
                <div className="space-y-3">
                  {top_staff.map((s, idx) => (
                    <div key={s.name || idx} className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${idx === 0 ? 'bg-amber-500' : idx === 1 ? 'bg-slate-400' : 'bg-orange-300'}`}>{idx + 1}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{s.name}</p>
                        <p className="text-xs text-slate-500">{s.count} projects</p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">Rs {s.revenue.toLocaleString('en-IN')}</Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-400 text-center py-8">No staff data</p>}
            </CardContent>
          </Card>
        </div>

        {/* Credit Section */}
        {data.credit_data && (
          <Card className="border-slate-200 mt-4" data-testid="credit-section">
            <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><IndianRupee className="h-4 w-4" />Customer Credit Overview</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Aging Chart */}
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Credit Aging</p>
                  {[
                    { label: '0-30 Days', value: data.credit_data.aging?.['0_30'] || 0, color: '#10b981' },
                    { label: '30-60 Days', value: data.credit_data.aging?.['30_60'] || 0, color: '#f59e0b' },
                    { label: '60+ Days', value: data.credit_data.aging?.['60_plus'] || 0, color: '#ef4444' }
                  ].map(bucket => {
                    const maxVal = Math.max(data.credit_data.aging?.['0_30'] || 0, data.credit_data.aging?.['30_60'] || 0, data.credit_data.aging?.['60_plus'] || 0, 1);
                    return (
                      <div key={bucket.label} className="space-y-1">
                        <div className="flex justify-between text-xs"><span className="text-slate-600">{bucket.label}</span><span className="font-bold">Rs {bucket.value.toLocaleString('en-IN')}</span></div>
                        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width: `${(bucket.value / maxVal) * 100}%`, backgroundColor: bucket.color}} /></div>
                      </div>
                    );
                  })}
                </div>
                {/* Top Debtors */}
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-3">Top 5 Outstanding</p>
                  {data.credit_data.top_debtors?.length > 0 ? (
                    <div className="space-y-2">
                      {data.credit_data.top_debtors.map((d, i) => (
                        <div key={d.name || i} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                          <span className="text-sm text-slate-700">{d.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">Rs {d.balance.toLocaleString('en-IN')}</span>
                            {d.status === 'overdue' && <Badge className="bg-red-100 text-red-700 text-[9px]">Overdue</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-slate-400 text-center py-4">No outstanding credits</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
