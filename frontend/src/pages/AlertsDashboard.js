import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { alertsAPI, thresholdsAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Loader2, AlertTriangle, IndianRupee, Shield, TrendingDown, Save, Settings2
} from 'lucide-react';

const RISK_COLORS = { High: '#ef4444', Medium: '#f59e0b', Low: '#10b981' };
const PIE_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899'];

export default function AlertsDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [thresholds, setThresholds] = useState({});
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await alertsAPI.getDashboard();
      setData(res.data);
      setThresholds(res.data.thresholds || {});
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const saveThresholds = async () => {
    setSaving(true);
    try {
      await thresholdsAPI.update(thresholds);
      await fetchData();
      setShowSettings(false);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  if (!data) return <div className="p-6 text-center text-slate-500">Failed to load alerts</div>;

  return (
    <div className="py-6 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="alerts-title">Profit Leakage Alerts</h1>
            <p className="text-sm text-slate-500">Real-time financial intelligence & risk monitoring</p>
          </div>
          <Button variant="outline" onClick={() => setShowSettings(!showSettings)} className="gap-2" data-testid="threshold-settings-btn"><Settings2 className="h-4 w-4" />Thresholds</Button>
        </div>

        {/* Threshold Settings */}
        {showSettings && (
          <Card className="border-amber-200 bg-amber-50 mb-6" data-testid="threshold-settings">
            <CardHeader className="py-3"><CardTitle className="text-base">Alert Thresholds</CardTitle></CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="space-y-1"><Label className="text-xs">Min Margin %</Label><Input type="number" value={thresholds.min_margin_pct || ''} onChange={(e) => setThresholds(p => ({...p, min_margin_pct: parseFloat(e.target.value)}))} className="h-9" data-testid="thresh-margin" /></div>
                <div className="space-y-1"><Label className="text-xs">Max Material Var %</Label><Input type="number" value={thresholds.max_material_variance_pct || ''} onChange={(e) => setThresholds(p => ({...p, max_material_variance_pct: parseFloat(e.target.value)}))} className="h-9" data-testid="thresh-variance" /></div>
                <div className="space-y-1"><Label className="text-xs">Payment Delay Days</Label><Input type="number" value={thresholds.payment_delay_days || ''} onChange={(e) => setThresholds(p => ({...p, payment_delay_days: parseInt(e.target.value)}))} className="h-9" data-testid="thresh-delay" /></div>
                <div className="space-y-1"><Label className="text-xs">Max Project Days</Label><Input type="number" value={thresholds.max_project_duration_days || ''} onChange={(e) => setThresholds(p => ({...p, max_project_duration_days: parseInt(e.target.value)}))} className="h-9" data-testid="thresh-duration" /></div>
                <div className="flex items-end"><Button onClick={saveThresholds} disabled={saving} className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white w-full" data-testid="save-thresholds-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</Button></div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" data-testid="alert-kpis">
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 text-center">
              <IndianRupee className="h-6 w-6 text-red-500 mx-auto mb-1" />
              <p className="text-2xl font-bold text-red-700">₹{(data.total_leakage || 0).toLocaleString('en-IN')}</p>
              <p className="text-xs text-red-500 uppercase tracking-wider">Total Leakage</p>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4 text-center">
              <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto mb-1" />
              <p className="text-2xl font-bold text-amber-700">{data.total_alerts}</p>
              <p className="text-xs text-amber-500 uppercase tracking-wider">Active Alerts</p>
            </CardContent>
          </Card>
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-4 text-center">
              <Shield className="h-6 w-6 text-orange-500 mx-auto mb-1" />
              <p className="text-2xl font-bold text-orange-700">{data.risky_projects}</p>
              <p className="text-xs text-orange-500 uppercase tracking-wider">Risky Projects</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-4 text-center">
              <TrendingDown className="h-6 w-6 text-slate-400 mx-auto mb-1" />
              <p className="text-2xl font-bold text-slate-700">{Object.keys(data.alerts_by_type || {}).length}</p>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Alert Types</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Leakage by Category */}
          <Card className="border-slate-200" data-testid="leakage-chart">
            <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit']">Leakage by Category</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              {data.chart_data?.length > 0 ? (
                <div className="space-y-3 pt-2">
                  {data.chart_data.map((item, i) => {
                    const maxVal = Math.max(...data.chart_data.map(d => d.value));
                    const pct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
                    return (
                      <div key={item.name} className="space-y-1">
                        <div className="flex justify-between text-xs"><span className="text-slate-600">{item.name}</span><span className="font-bold text-slate-900">₹{item.value.toLocaleString('en-IN')}</span></div>
                        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length]}} /></div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-sm text-emerald-500 text-center py-8">No leakage detected</p>}
            </CardContent>
          </Card>

          {/* Risk Distribution */}
          <Card className="border-slate-200" data-testid="risk-heatmap">
            <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit']">Risk Distribution</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              {data.top_risks?.length > 0 ? (
                <div className="space-y-2.5 pt-2">
                  {data.top_risks.slice(0, 8).map(p => (
                    <div key={p.id} className="flex items-center gap-3">
                      <span className="text-xs text-slate-600 w-24 truncate">{p.customer}</span>
                      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width: `${p.risk_score}%`, backgroundColor: RISK_COLORS[p.risk_level]}} /></div>
                      <span className="text-xs font-bold w-8 text-right" style={{color: RISK_COLORS[p.risk_level]}}>{p.risk_score}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-emerald-500 text-center py-8">All projects within safe limits</p>}
            </CardContent>
          </Card>
        </div>

        {/* Top Risk Projects */}
        <Card className="border-slate-200" data-testid="top-risks">
          <CardHeader className="py-3 border-b border-slate-200">
            <CardTitle className="text-base font-['Outfit']">High-Risk Projects ({data.top_risks?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.top_risks?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Customer</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Ref</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Risk Score</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Level</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Alerts</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Status</th>
                    <th className="px-4 py-2.5"></th>
                  </tr></thead>
                  <tbody>
                    {data.top_risks.map(p => (
                      <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{p.customer}</td>
                        <td className="px-4 py-2.5 text-slate-600 font-mono text-xs">{p.ref}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width: `${p.risk_score}%`, backgroundColor: RISK_COLORS[p.risk_level]}} /></div>
                            <span className="text-xs font-bold" style={{color: RISK_COLORS[p.risk_level]}}>{p.risk_score}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5"><Badge className={`text-[10px] ${p.risk_level==='High'?'bg-red-100 text-red-700':p.risk_level==='Medium'?'bg-amber-100 text-amber-700':'bg-emerald-100 text-emerald-700'}`}>{p.risk_level}</Badge></td>
                        <td className="px-4 py-2.5 text-slate-600">{p.alert_count}</td>
                        <td className="px-4 py-2.5"><Badge variant="outline" className="text-[10px] capitalize">{p.status}</Badge></td>
                        <td className="px-4 py-2.5"><Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate(`/dashboard/projects/${p.id}`)} data-testid={`view-project-${p.id}`}>View</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-emerald-500 text-center py-8">No risky projects detected</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
