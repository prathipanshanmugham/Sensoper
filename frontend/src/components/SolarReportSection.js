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

            {/* Results */}
            {data.sizing && (
              <div className="space-y-3 border-t border-amber-200 pt-3" data-testid="sr-results">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="border-emerald-200 bg-white"><CardContent className="p-3"><Sun className="h-4 w-4 text-emerald-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Recommended</p><p className="text-xl font-bold text-slate-900">{data.sizing.kwp_recommended} kWp</p></CardContent></Card>
                  <Card className="border-blue-200 bg-white"><CardContent className="p-3"><Zap className="h-4 w-4 text-blue-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Panels</p><p className="text-xl font-bold text-slate-900">{data.sizing.num_panels} × {data.sizing.panel_wattage_w}W</p></CardContent></Card>
                  <Card className="border-amber-200 bg-white"><CardContent className="p-3"><Zap className="h-4 w-4 text-amber-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Inverter</p><p className="text-xl font-bold text-slate-900">{data.sizing.inverter_capacity_kw} kW</p></CardContent></Card>
                  <Card className="border-violet-200 bg-white"><CardContent className="p-3"><Leaf className="h-4 w-4 text-violet-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">CO₂/yr</p><p className="text-xl font-bold text-slate-900">{data.technical.co2_offset_kg_per_year.toLocaleString('en-IN')} kg</p></CardContent></Card>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="border-slate-200 bg-white"><CardContent className="p-3"><IndianRupee className="h-4 w-4 text-slate-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Total Cost</p><p className="text-lg font-bold text-slate-900">₹{data.financials.total_cost.toLocaleString('en-IN')}</p><p className="text-[10px] text-emerald-600">Subsidy ₹{data.financials.subsidy.toLocaleString('en-IN')}</p></CardContent></Card>
                  <Card className="border-emerald-200 bg-white"><CardContent className="p-3"><IndianRupee className="h-4 w-4 text-emerald-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Net Cost</p><p className="text-lg font-bold text-emerald-700">₹{data.financials.net_cost.toLocaleString('en-IN')}</p></CardContent></Card>
                  <Card className="border-blue-200 bg-white"><CardContent className="p-3"><Calendar className="h-4 w-4 text-blue-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Payback</p><p className="text-lg font-bold text-blue-700">{data.financials.payback_years} yrs</p><p className="text-[10px] text-slate-500">ROI {data.financials.roi_pct}%</p></CardContent></Card>
                  <Card className="border-amber-200 bg-white"><CardContent className="p-3"><IndianRupee className="h-4 w-4 text-amber-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">25-Yr Savings</p><p className="text-lg font-bold text-amber-700">₹{(data.financials.total_25yr_savings / 100000).toFixed(1)}L</p></CardContent></Card>
                </div>
                <p className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Saved with project. The Quotation PDF will include a full solar-report section.</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
