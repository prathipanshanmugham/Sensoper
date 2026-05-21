import { useState, useCallback, useEffect } from 'react';
import { solarReportAPI } from '../utils/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import {
  Loader2, Search, Crosshair, RefreshCw, Sun, Zap, IndianRupee,
  Leaf, Calendar, AlertCircle, Edit3, CheckCircle2, ChevronDown, ChevronRight
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const INDIA_AVG_IRRADIATION = 5.0;

const blank = {
  // TNEB inputs
  service_number: '',
  phone: '',
  // Consumer (editable, fetched or manual)
  consumer_name: '',
  address: '',
  sanctioned_load_kw: '',
  avg_monthly_consumption: '',
  avg_monthly_bill: '',
  tariff_category: 'Domestic',
  connection_type: 'Single Phase',
  // Location & config
  lat: '',
  lng: '',
  irradiation_kwh_m2_day: INDIA_AVG_IRRADIATION,
  system_type: 'on-grid',
  panel_wattage_w: 550,
  cost_per_kwp: 55000,
  battery_autonomy_days: 1.0,
  // Computed (filled after sizing call)
  sizing: null,
  financials: null,
  technical: null,
  assumptions: null,
  computed_at: null,
};

/**
 * Embeddable Solar Report section used inside the SiteVisitForm wizard.
 * Controlled component — receives `value` and `onChange`.
 * Optional `customerDefaults` to pre-fill consumer fields from earlier wizard steps.
 */
export default function SolarReportSection({ value, onChange, customerDefaults = {} }) {
  const data = { ...blank, ...(value || {}) };
  const update = (patch) => onChange({ ...data, ...patch });

  // Pre-fill from customer step (one-time)
  useEffect(() => {
    if (value && (value.consumer_name || value.phone)) return;
    const patch = {};
    if (!data.consumer_name && customerDefaults.name) patch.consumer_name = customerDefaults.name;
    if (!data.phone && customerDefaults.phone) patch.phone = (customerDefaults.phone || '').replace(/\D/g, '').slice(0, 10);
    if (!data.address && customerDefaults.address) patch.address = customerDefaults.address;
    if (Object.keys(patch).length) onChange({ ...data, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [collapsed, setCollapsed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchInfo, setFetchInfo] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [irradLoading, setIrradLoading] = useState(false);
  const [sizingLoading, setSizingLoading] = useState(false);

  const handleFetchTneb = useCallback(async () => {
    if (!data.service_number || data.service_number.length < 6) { toast.error('Enter a valid TNEB service number (min 6 chars)'); return; }
    if (!/^\d{10}$/.test(data.phone)) { toast.error('Enter a valid 10-digit Indian mobile number'); return; }
    setFetching(true);
    setFetchInfo(null);
    try {
      const res = await solarReportAPI.fetchTneb(data.service_number, data.phone);
      const { success, message, data: fetched, fallback } = res.data;
      setFetchInfo({ success, message, fallback });
      if (success && fetched) {
        update({
          consumer_name: fetched.consumer_name || data.consumer_name,
          address: fetched.address || data.address,
          sanctioned_load_kw: fetched.sanctioned_load_kw || data.sanctioned_load_kw,
          avg_monthly_consumption: fetched.avg_monthly_consumption || data.avg_monthly_consumption,
          avg_monthly_bill: fetched.avg_monthly_bill || data.avg_monthly_bill,
          tariff_category: fetched.tariff_category || data.tariff_category,
          connection_type: fetched.connection_type || data.connection_type,
        });
        toast.success('TNEB data fetched');
      } else {
        toast.info('Manual entry mode — fill consumer details below');
      }
    } catch (e) {
      setFetchInfo({ success: false, message: e.response?.data?.detail || 'Fetch failed', fallback: 'manual' });
      toast.error(e.response?.data?.detail || 'TNEB fetch failed');
    } finally { setFetching(false); }
  }, [data.service_number, data.phone]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleGPS = () => {
    if (!navigator.geolocation) { toast.error('GPS not available'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { update({ lat: pos.coords.latitude.toFixed(4), lng: pos.coords.longitude.toFixed(4) }); setGpsLoading(false); toast.success('GPS captured'); },
      (err) => { setGpsLoading(false); toast.error(`GPS error: ${err.message}`); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleIrradiation = async () => {
    if (!data.lat || !data.lng) { toast.error('Set GPS coordinates first'); return; }
    setIrradLoading(true);
    try {
      const res = await solarReportAPI.irradiation(parseFloat(data.lat), parseFloat(data.lng));
      update({ irradiation_kwh_m2_day: res.data.annual_avg_kwh_m2_day });
      toast.success(`Irradiation: ${res.data.annual_avg_kwh_m2_day} kWh/m²/day`);
    } catch (e) { toast.error('Irradiation fetch failed'); }
    finally { setIrradLoading(false); }
  };

  const handleSizing = async () => {
    if (!data.avg_monthly_consumption || parseFloat(data.avg_monthly_consumption) <= 0) { toast.error('Enter average monthly consumption'); return; }
    if (!data.consumer_name?.trim()) { toast.error('Enter consumer name'); return; }
    setSizingLoading(true);
    try {
      const payload = {
        monthly_consumption_units: parseFloat(data.avg_monthly_consumption),
        sanctioned_load_kw: data.sanctioned_load_kw ? parseFloat(data.sanctioned_load_kw) : null,
        tariff_category: data.tariff_category,
        connection_type: data.connection_type,
        avg_monthly_bill: data.avg_monthly_bill ? parseFloat(data.avg_monthly_bill) : null,
        irradiation_kwh_m2_day: parseFloat(data.irradiation_kwh_m2_day) || INDIA_AVG_IRRADIATION,
        system_type: data.system_type,
        panel_wattage_w: parseInt(data.panel_wattage_w, 10),
        cost_per_kwp: parseFloat(data.cost_per_kwp),
        battery_autonomy_days: parseFloat(data.battery_autonomy_days),
      };
      const res = await solarReportAPI.sizing(payload);
      update({
        sizing: res.data.sizing,
        financials: res.data.financials,
        technical: res.data.technical,
        assumptions: res.data.assumptions,
        computed_at: new Date().toISOString(),
      });
      toast.success(`Sized: ${res.data.sizing.kwp_recommended} kWp — payback ${res.data.financials.payback_years}y`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Sizing failed'); }
    finally { setSizingLoading(false); }
  };

  return (
    <Card className="border-amber-200 bg-amber-50/30" data-testid="solar-report-section">
      <CardContent className="p-4 space-y-4">
        <button type="button" onClick={() => setCollapsed(c => !c)} className="w-full flex items-center justify-between gap-2 text-left" data-testid="solar-report-toggle">
          <div className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-amber-600" />
            <div>
              <h3 className="text-sm font-semibold font-['Outfit'] text-amber-800">Solar Project Report (TNEB Auto-Fetch)</h3>
              <p className="text-[11px] text-amber-700">Pull live consumer data, calculate sizing + ROI. Saved with the project — auto-appended to the quotation PDF.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.sizing && <Badge className="bg-emerald-100 text-emerald-700 text-[10px] gap-1"><CheckCircle2 className="h-3 w-3" />{data.sizing.kwp_recommended} kWp</Badge>}
            {collapsed ? <ChevronRight className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
          </div>
        </button>

        {!collapsed && (
          <>
            {/* TNEB Fetch row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">TNEB Service Number *</Label><Input value={data.service_number} onChange={(e) => update({ service_number: e.target.value.trim() })} placeholder="e.g., 012345678901" className="h-9 bg-white" data-testid="sr-service-input" /></div>
              <div className="space-y-1"><Label className="text-xs">Registered Phone *</Label><Input value={data.phone} onChange={(e) => update({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10-digit mobile" className="h-9 bg-white" data-testid="sr-phone-input" /></div>
              <div className="flex items-end"><Button type="button" onClick={handleFetchTneb} disabled={fetching} className="h-9 w-full gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="sr-fetch-btn">{fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{fetching ? 'Fetching...' : 'Auto-Fetch'}</Button></div>
            </div>
            {fetchInfo && (
              <div className={`p-2.5 rounded-md border text-xs flex items-start gap-2 ${fetchInfo.success ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`} data-testid="sr-fetch-status">
                {fetchInfo.success ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                <div>{fetchInfo.success ? 'Fetched — review below.' : fetchInfo.message}</div>
              </div>
            )}

            {/* Consumer fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-amber-200 pt-3">
              <div className="space-y-1 md:col-span-2"><Label className="text-xs flex items-center gap-1"><Edit3 className="h-3 w-3" />Consumer Name *</Label><Input value={data.consumer_name} onChange={(e) => update({ consumer_name: e.target.value })} className="h-9 bg-white" data-testid="sr-consumer-name" /></div>
              <div className="space-y-1"><Label className="text-xs">Sanctioned Load (kW)</Label><Input type="number" step="0.1" value={data.sanctioned_load_kw} onChange={(e) => update({ sanctioned_load_kw: e.target.value })} className="h-9 bg-white" data-testid="sr-sanctioned-load" /></div>
              <div className="space-y-1"><Label className="text-xs">Avg Monthly Units *</Label><Input type="number" value={data.avg_monthly_consumption} onChange={(e) => update({ avg_monthly_consumption: e.target.value })} className="h-9 bg-white" data-testid="sr-consumption" /></div>
              <div className="space-y-1"><Label className="text-xs">Avg Monthly Bill (₹)</Label><Input type="number" value={data.avg_monthly_bill} onChange={(e) => update({ avg_monthly_bill: e.target.value })} className="h-9 bg-white" data-testid="sr-bill" /></div>
              <div className="space-y-1"><Label className="text-xs">Tariff Category</Label>
                <Select value={data.tariff_category} onValueChange={(v) => update({ tariff_category: v })}>
                  <SelectTrigger className="h-9 bg-white" data-testid="sr-tariff"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Domestic">Domestic</SelectItem><SelectItem value="Commercial">Commercial</SelectItem><SelectItem value="Industrial">Industrial</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Connection</Label>
                <Select value={data.connection_type} onValueChange={(v) => update({ connection_type: v })}>
                  <SelectTrigger className="h-9 bg-white" data-testid="sr-connection"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Single Phase">Single Phase</SelectItem><SelectItem value="Three Phase">Three Phase</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-3"><Label className="text-xs">Address</Label><Input value={data.address} onChange={(e) => update({ address: e.target.value })} className="h-9 bg-white" data-testid="sr-address" /></div>
            </div>

            {/* Location + system config */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 border-t border-amber-200 pt-3">
              <div className="space-y-1"><Label className="text-xs">Latitude</Label><Input value={data.lat} onChange={(e) => update({ lat: e.target.value })} className="h-9 bg-white" data-testid="sr-lat" /></div>
              <div className="space-y-1"><Label className="text-xs">Longitude</Label><Input value={data.lng} onChange={(e) => update({ lng: e.target.value })} className="h-9 bg-white" data-testid="sr-lng" /></div>
              <div className="flex items-end"><Button type="button" onClick={handleGPS} disabled={gpsLoading} variant="outline" className="h-9 w-full gap-1 bg-white" data-testid="sr-gps-btn">{gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}GPS</Button></div>
              <div className="flex items-end"><Button type="button" onClick={handleIrradiation} disabled={irradLoading || !data.lat} variant="outline" className="h-9 w-full gap-1 bg-white" data-testid="sr-irradiation-btn">{irradLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}NASA</Button></div>
              <div className="space-y-1"><Label className="text-xs">Irradiation</Label><Input type="number" step="0.1" value={data.irradiation_kwh_m2_day} onChange={(e) => update({ irradiation_kwh_m2_day: e.target.value })} className="h-9 bg-white" data-testid="sr-irradiation" /></div>
              <div className="space-y-1"><Label className="text-xs">System</Label>
                <Select value={data.system_type} onValueChange={(v) => update({ system_type: v })}>
                  <SelectTrigger className="h-9 bg-white" data-testid="sr-system-type"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="on-grid">On-Grid</SelectItem><SelectItem value="off-grid">Off-Grid</SelectItem><SelectItem value="hybrid">Hybrid</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Panel W</Label><Input type="number" value={data.panel_wattage_w} onChange={(e) => update({ panel_wattage_w: e.target.value })} className="h-9 bg-white" data-testid="sr-panel-w" /></div>
              <div className="space-y-1"><Label className="text-xs">Cost/kWp (₹)</Label><Input type="number" value={data.cost_per_kwp} onChange={(e) => update({ cost_per_kwp: e.target.value })} className="h-9 bg-white" data-testid="sr-cost-kwp" /></div>
              {data.system_type !== 'on-grid' && (<div className="space-y-1"><Label className="text-xs">Battery Days</Label><Input type="number" step="0.1" value={data.battery_autonomy_days} onChange={(e) => update({ battery_autonomy_days: e.target.value })} className="h-9 bg-white" data-testid="sr-batt-days" /></div>)}
            </div>

            <Button type="button" onClick={handleSizing} disabled={sizingLoading} className="w-full h-10 gap-2 bg-blue-600 hover:bg-blue-700 text-white" data-testid="sr-calculate-btn">
              {sizingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Calculate Solar Sizing & Financials
            </Button>

            {/* Results — charts & graphs */}
            {data.sizing && (
              <div className="space-y-3 border-t border-amber-200 pt-3" data-testid="sr-results">
                {/* KPI Strip */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div className="rounded-lg p-2.5 bg-emerald-600 text-white" data-testid="sr-kpi-kwp">
                    <p className="text-[9px] uppercase tracking-wider opacity-90">Capacity</p>
                    <p className="text-base font-bold leading-tight">{data.sizing.kwp_recommended} kWp</p>
                  </div>
                  <div className="rounded-lg p-2.5 bg-blue-600 text-white">
                    <p className="text-[9px] uppercase tracking-wider opacity-90">Panels</p>
                    <p className="text-base font-bold leading-tight">{data.sizing.num_panels} × {data.sizing.panel_wattage_w}W</p>
                  </div>
                  <div className="rounded-lg p-2.5 bg-amber-500 text-white">
                    <p className="text-[9px] uppercase tracking-wider opacity-90">Inverter</p>
                    <p className="text-base font-bold leading-tight">{data.sizing.inverter_capacity_kw} kW</p>
                  </div>
                  <div className="rounded-lg p-2.5 bg-violet-600 text-white">
                    <p className="text-[9px] uppercase tracking-wider opacity-90">Payback</p>
                    <p className="text-base font-bold leading-tight">{data.financials.payback_years} yrs</p>
                  </div>
                  <div className="rounded-lg p-2.5 bg-rose-600 text-white">
                    <p className="text-[9px] uppercase tracking-wider opacity-90">25-Yr Savings</p>
                    <p className="text-base font-bold leading-tight">₹{(data.financials.total_25yr_savings / 100000).toFixed(1)}L</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Cost Breakdown — conic-gradient donut (no Recharts Cell) */}
                  <div className="bg-white border border-slate-200 rounded-lg p-3" data-testid="sr-chart-cost-pie">
                    <p className="text-xs font-semibold text-slate-600 mb-2">Cost Breakdown</p>
                    <div className="flex items-center gap-4">
                      {(() => {
                        const total = Math.max(data.financials.total_cost, 1);
                        const subsidyPct = (data.financials.subsidy / total) * 100;
                        const netPct = 100 - subsidyPct;
                        const gradient = `conic-gradient(#10b981 0% ${subsidyPct}%, #3b82f6 ${subsidyPct}% 100%)`;
                        return (
                          <div className="relative w-28 h-28 rounded-full" style={{ background: gradient }}>
                            <div className="absolute inset-3 bg-white rounded-full flex flex-col items-center justify-center text-center">
                              <p className="text-[9px] uppercase tracking-wider text-slate-500">Total</p>
                              <p className="text-sm font-bold text-slate-900 leading-none">₹{(data.financials.total_cost/100000).toFixed(2)}L</p>
                            </div>
                            <span className="sr-only">subsidy {subsidyPct.toFixed(1)}% net {netPct.toFixed(1)}%</span>
                          </div>
                        );
                      })()}
                      <div className="flex-1 space-y-2 text-xs">
                        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-emerald-500" /><span className="text-slate-700">Subsidy</span><span className="ml-auto font-bold text-slate-900">₹{data.financials.subsidy.toLocaleString('en-IN')}</span></div>
                        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-blue-500" /><span className="text-slate-700">Net Cost</span><span className="ml-auto font-bold text-slate-900">₹{data.financials.net_cost.toLocaleString('en-IN')}</span></div>
                        <div className="pt-1.5 border-t border-slate-100 flex items-center gap-2"><span className="text-slate-500">Tariff</span><span className="ml-auto font-medium text-slate-700">₹{data.financials.tariff_per_unit}/unit</span></div>
                      </div>
                    </div>
                  </div>

                  {/* Energy Source Mix — conic donut */}
                  <div className="bg-white border border-slate-200 rounded-lg p-3" data-testid="sr-chart-energy-pie">
                    <p className="text-xs font-semibold text-slate-600 mb-2">Energy Source Mix (Monthly)</p>
                    {(() => {
                      const consumption = parseFloat(data.avg_monthly_consumption) || data.financials.monthly_generation_units;
                      const solar = Math.min(data.financials.monthly_generation_units, consumption);
                      const grid = Math.max(consumption - solar, 0);
                      const totalU = Math.max(solar + grid, 1);
                      const solarPct = (solar / totalU) * 100;
                      const gradient = `conic-gradient(#10b981 0% ${solarPct}%, #64748b ${solarPct}% 100%)`;
                      return (
                        <div className="flex items-center gap-4">
                          <div className="relative w-28 h-28 rounded-full" style={{ background: gradient }}>
                            <div className="absolute inset-3 bg-white rounded-full flex flex-col items-center justify-center">
                              <p className="text-[9px] uppercase tracking-wider text-slate-500">Total</p>
                              <p className="text-sm font-bold text-slate-900 leading-none">{Math.round(totalU)} u</p>
                            </div>
                          </div>
                          <div className="flex-1 space-y-2 text-xs">
                            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-emerald-500" /><span className="text-slate-700">Solar</span><span className="ml-auto font-bold text-slate-900">{Math.round(solar)} u</span></div>
                            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-slate-500" /><span className="text-slate-700">Grid</span><span className="ml-auto font-bold text-slate-900">{Math.round(grid)} u</span></div>
                            <div className="pt-1.5 border-t border-slate-100 flex items-center gap-2"><span className="text-slate-500">CO₂/yr</span><span className="ml-auto font-medium text-emerald-700">{data.technical.co2_offset_kg_per_year.toLocaleString('en-IN')} kg</span></div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Monthly Economics Bar */}
                <div className="bg-white border border-slate-200 rounded-lg p-3" data-testid="sr-chart-monthly-bar">
                  <p className="text-xs font-semibold text-slate-600 mb-1">Monthly Economics</p>
                  <ResponsiveContainer width="100%" height={170}>
                    <BarChart data={[
                      { name: 'Avg Bill', value: parseFloat(data.avg_monthly_bill) || 0 },
                      { name: 'Solar Savings', value: data.financials.monthly_savings },
                      { name: 'Generation ₹', value: Math.round(data.financials.monthly_generation_units * data.financials.tariff_per_unit) },
                      { name: 'Net Bill', value: Math.max((parseFloat(data.avg_monthly_bill) || 0) - data.financials.monthly_savings, 0) }
                    ]} margin={{ top: 16, right: 8, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 9 }} stroke="#94a3b8" tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                      <Tooltip formatter={(v) => [`₹${v.toLocaleString('en-IN')}`, '']} />
                      <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* 25-Year Cumulative Savings Area */}
                <div className="bg-white border border-slate-200 rounded-lg p-3" data-testid="sr-chart-25yr-line">
                  <p className="text-xs font-semibold text-slate-600 mb-1">25-Year Savings Projection</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={data.financials.yearly_breakdown} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                      <defs>
                        <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="year" tick={{ fontSize: 9 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 9 }} stroke="#94a3b8" tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${(v / 1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v) => [`₹${v.toLocaleString('en-IN')}`, '']} labelFormatter={(y) => `Year ${y}`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="cumulative" stroke="#f59e0b" strokeWidth={2.5} fill="url(#cumGrad)" name="Cumulative Savings" />
                      <Line type="monotone" dataKey="savings" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Yearly Savings" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Technical KPI gauge bars */}
                <div className="bg-white border border-slate-200 rounded-lg p-3" data-testid="sr-chart-tech-gauges">
                  <p className="text-xs font-semibold text-slate-600 mb-2">Technical Performance</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      { label: 'Performance Ratio (PR)', value: data.technical.performance_ratio, max: 1, fmt: (v) => v.toFixed(2), color: 'bg-violet-500' },
                      { label: 'Capacity Utilization Factor (CUF)', value: data.technical.cuf_pct, max: 25, fmt: (v) => `${v}%`, color: 'bg-sky-500' },
                      { label: 'Annual Generation (units)', value: data.technical.annual_generation_units, max: data.technical.annual_generation_units * 1.2, fmt: (v) => v.toLocaleString('en-IN'), color: 'bg-blue-500' },
                      { label: 'CO₂ Offset / Year (kg)', value: data.technical.co2_offset_kg_per_year, max: data.technical.co2_offset_kg_per_year * 1.2, fmt: (v) => v.toLocaleString('en-IN'), color: 'bg-emerald-500' },
                      { label: 'ROI (25-Year)', value: data.financials.roi_pct || 0, max: Math.max(data.financials.roi_pct || 0, 500), fmt: (v) => `${v}%`, color: 'bg-amber-500' },
                      { label: 'Panel Efficiency', value: 100 - data.technical.degradation_pct_per_year, max: 100, fmt: (v) => `${v.toFixed(1)}%`, color: 'bg-emerald-500' },
                    ].map((g, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex justify-between text-[11px]"><span className="text-slate-600">{g.label}</span><span className="font-bold text-slate-900">{g.fmt(g.value)}</span></div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${g.color}`} style={{ width: `${Math.min((g.value / g.max) * 100, 100)}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Saved with project. The Quotation PDF will include all these charts & graphs in the solar-report section.</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
