import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { solarReportAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { toast } from 'sonner';
import {
  Loader2, Search, Crosshair, RefreshCw, Sun, Zap, IndianRupee, TrendingUp,
  Leaf, Calendar, FileDown, Upload, Combine, ArrowDown, ArrowUp, AlertCircle, Edit3, CheckCircle2
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadUnicodeFont, PDF_UNICODE_FONT } from '../utils/pdfFont';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_solar-estimator-14/artifacts/2dpfr2zb_slg.png";

const INDIA_AVG_IRRADIATION = 5.0;

const blankConsumer = {
  service_number: '',
  phone: '',
  consumer_name: '',
  address: '',
  sanctioned_load_kw: '',
  avg_monthly_consumption: '',
  avg_monthly_bill: '',
  tariff_category: 'Domestic',
  connection_type: 'Single Phase',
};

const blankConfig = {
  system_type: 'on-grid',
  panel_wattage_w: 550,
  cost_per_kwp: 55000,
  battery_autonomy_days: 1.0,
  irradiation_kwh_m2_day: INDIA_AVG_IRRADIATION,
  lat: '',
  lng: '',
};

export default function SolarReport() {
  const [searchParams] = useSearchParams();
  // Step 1 — TNEB inputs
  const [consumer, setConsumer] = useState(blankConsumer);
  const [config, setConfig] = useState(blankConfig);

  // Prefill from query params (when opened from Create Project wizard)
  useEffect(() => {
    const name = searchParams.get('name');
    const phone = searchParams.get('phone');
    const address = searchParams.get('address');
    if (name || phone || address) {
      setConsumer(p => ({
        ...p,
        consumer_name: name || p.consumer_name,
        phone: phone || p.phone,
        address: address || p.address,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loading / status
  const [fetching, setFetching] = useState(false);
  const [fetchInfo, setFetchInfo] = useState(null);  // {success, message, fallback}
  const [editingManual, setEditingManual] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [irradLoading, setIrradLoading] = useState(false);
  const [sizingLoading, setSizingLoading] = useState(false);

  // Results
  const [report, setReport] = useState(null);

  // PDF state
  const [pdfBuilding, setPdfBuilding] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [generatedPdfBlob, setGeneratedPdfBlob] = useState(null);
  const [uploadedPdf, setUploadedPdf] = useState(null);
  const [mergePosition, setMergePosition] = useState('prepend');
  const [merging, setMerging] = useState(false);

  // ============ STEP 1: Fetch TNEB ============
  const handleFetchTneb = useCallback(async () => {
    if (!consumer.service_number || consumer.service_number.length < 6) {
      toast.error('Enter a valid TNEB service number (min 6 chars)');
      return;
    }
    if (!/^\d{10}$/.test(consumer.phone)) {
      toast.error('Enter a valid 10-digit Indian mobile number');
      return;
    }
    setFetching(true);
    setFetchInfo(null);
    try {
      const res = await solarReportAPI.fetchTneb(consumer.service_number, consumer.phone);
      const { success, message, data, fallback } = res.data;
      setFetchInfo({ success, message, fallback });
      if (success && data) {
        setConsumer(p => ({ ...p,
          consumer_name: data.consumer_name || p.consumer_name,
          address: data.address || p.address,
          sanctioned_load_kw: data.sanctioned_load_kw || p.sanctioned_load_kw,
          avg_monthly_consumption: data.avg_monthly_consumption || p.avg_monthly_consumption,
          avg_monthly_bill: data.avg_monthly_bill || p.avg_monthly_bill,
          tariff_category: data.tariff_category || p.tariff_category,
          connection_type: data.connection_type || p.connection_type,
        }));
        toast.success('TNEB data fetched. Review below.');
      } else {
        setEditingManual(true);
        toast.info('Manual entry mode — fill consumer details below.');
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'TNEB fetch failed');
      setFetchInfo({ success: false, message: e.response?.data?.detail || 'Fetch failed', fallback: 'manual' });
      setEditingManual(true);
    } finally {
      setFetching(false);
    }
  }, [consumer.service_number, consumer.phone]);

  // ============ GPS + NASA POWER ============
  const handleGPS = () => {
    if (!navigator.geolocation) { toast.error('GPS not available on this device'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setConfig(p => ({ ...p, lat: pos.coords.latitude.toFixed(4), lng: pos.coords.longitude.toFixed(4) }));
        setGpsLoading(false);
        toast.success('Location captured. Click "Fetch Irradiation".');
      },
      (err) => { setGpsLoading(false); toast.error(`GPS error: ${err.message}`); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleIrradiation = async () => {
    if (!config.lat || !config.lng) { toast.error('Set GPS coordinates first'); return; }
    setIrradLoading(true);
    try {
      const res = await solarReportAPI.irradiation(parseFloat(config.lat), parseFloat(config.lng));
      setConfig(p => ({ ...p, irradiation_kwh_m2_day: res.data.annual_avg_kwh_m2_day }));
      toast.success(`Irradiation: ${res.data.annual_avg_kwh_m2_day} kWh/m²/day (${res.data.source})`);
    } catch (e) { toast.error('Irradiation fetch failed'); }
    finally { setIrradLoading(false); }
  };

  // ============ STEP 2: Sizing ============
  const handleGenerate = async () => {
    if (!consumer.avg_monthly_consumption || parseFloat(consumer.avg_monthly_consumption) <= 0) {
      toast.error('Enter average monthly consumption (units)'); return;
    }
    if (!consumer.consumer_name?.trim()) { toast.error('Enter consumer name'); return; }
    setSizingLoading(true);
    try {
      const payload = {
        monthly_consumption_units: parseFloat(consumer.avg_monthly_consumption),
        sanctioned_load_kw: consumer.sanctioned_load_kw ? parseFloat(consumer.sanctioned_load_kw) : null,
        tariff_category: consumer.tariff_category,
        connection_type: consumer.connection_type,
        avg_monthly_bill: consumer.avg_monthly_bill ? parseFloat(consumer.avg_monthly_bill) : null,
        irradiation_kwh_m2_day: parseFloat(config.irradiation_kwh_m2_day) || INDIA_AVG_IRRADIATION,
        system_type: config.system_type,
        panel_wattage_w: parseInt(config.panel_wattage_w, 10),
        cost_per_kwp: parseFloat(config.cost_per_kwp),
        battery_autonomy_days: parseFloat(config.battery_autonomy_days),
      };
      const res = await solarReportAPI.sizing(payload);
      setReport(res.data);
      setGeneratedPdfBlob(null); // invalidate previous PDF
      toast.success('Solar report generated below');
    } catch (e) { toast.error(e.response?.data?.detail || 'Sizing failed'); }
    finally { setSizingLoading(false); }
  };

  // ============ STEP 3: PDF Generation ============
  const safeFileName = useCallback(() => {
    const n = (consumer.consumer_name || 'Customer').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    const s = (consumer.service_number || 'NoSvc').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
    return `SENSOPER_${n}_${s}_ProjectReport.pdf`;
  }, [consumer.consumer_name, consumer.service_number]);

  const buildPdf = useCallback(async () => {
    if (!report) { toast.error('Generate the report first'); return null; }
    setPdfBuilding(true);
    setPdfProgress(5);
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      setPdfProgress(15);

      // Try to load Unicode font (₹). Fallback handled inside loader.
      const fontFamily = await loadUnicodeFont(doc);
      setPdfProgress(35);

      // Header band
      doc.setFillColor(74, 222, 64);
      doc.rect(0, 0, W, 22, 'F');
      doc.setFont(fontFamily, 'bold');
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(16);
      doc.text('SENSOPER CONTROLS & RENEWABLES', 12, 10);
      doc.setFontSize(10);
      doc.setFont(fontFamily, 'normal');
      doc.text('Solar Project Report', 12, 17);
      doc.setFontSize(8);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, W - 12, 17, { align: 'right' });

      // Consumer block
      let y = 32;
      doc.setFontSize(12); doc.setFont(fontFamily, 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('Consumer Details', 12, y); y += 5;
      doc.setDrawColor(226, 232, 240); doc.line(12, y, W - 12, y); y += 4;
      doc.setFontSize(9); doc.setFont(fontFamily, 'normal');
      const cdRows = [
        ['Consumer Name', consumer.consumer_name || '-'],
        ['Service Number', consumer.service_number || '-'],
        ['Phone', consumer.phone || '-'],
        ['Address', consumer.address || '-'],
        ['Sanctioned Load', consumer.sanctioned_load_kw ? `${consumer.sanctioned_load_kw} kW` : '-'],
        ['Tariff Category', consumer.tariff_category],
        ['Connection Type', consumer.connection_type],
        ['Avg Monthly Consumption', `${consumer.avg_monthly_consumption || 0} units`],
        ['Avg Monthly Bill', consumer.avg_monthly_bill ? `₹${parseFloat(consumer.avg_monthly_bill).toLocaleString('en-IN')}` : '-'],
      ];
      autoTable(doc, {
        startY: y, head: [], body: cdRows,
        theme: 'plain', styles: { font: fontFamily, fontSize: 9, cellPadding: 1.2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, textColor: [71, 85, 105] }, 1: { textColor: [15, 23, 42] } },
        margin: { left: 12 }
      });
      y = (doc.lastAutoTable?.finalY || y) + 8;
      setPdfProgress(55);

      // Sizing
      doc.setFontSize(12); doc.setFont(fontFamily, 'bold');
      doc.text('Recommended Solar System', 12, y); y += 5;
      doc.line(12, y, W - 12, y); y += 4;
      const sz = report.sizing;
      autoTable(doc, {
        startY: y, head: [['Item', 'Value']],
        body: [
          ['Recommended Capacity', `${sz.kwp_recommended} kWp`],
          ['Number of Panels', `${sz.num_panels} × ${sz.panel_wattage_w}W`],
          ['Inverter Capacity', `${sz.inverter_capacity_kw} kW`],
          ...(sz.battery_ah > 0 ? [['Battery Storage', `${sz.battery_ah} Ah @ ${sz.battery_voltage}V`]] : []),
        ],
        theme: 'striped', styles: { font: fontFamily, fontSize: 9 },
        headStyles: { fillColor: [16, 185, 129], textColor: 255 },
        margin: { left: 12, right: 12 }
      });
      y = (doc.lastAutoTable?.finalY || y) + 8;

      // Financials
      doc.setFontSize(12); doc.setFont(fontFamily, 'bold');
      doc.text('Financial Projection', 12, y); y += 5;
      doc.line(12, y, W - 12, y); y += 4;
      const f = report.financials;
      autoTable(doc, {
        startY: y, head: [['Item', 'Value']],
        body: [
          ['Total Project Cost', `₹${f.total_cost.toLocaleString('en-IN')}`],
          ['Govt Subsidy (PM Surya Ghar)', `₹${f.subsidy.toLocaleString('en-IN')}`],
          ['Net Cost After Subsidy', `₹${f.net_cost.toLocaleString('en-IN')}`],
          ['Tariff', `₹${f.tariff_per_unit}/unit`],
          ['Monthly Generation', `${f.monthly_generation_units} units`],
          ['Monthly Savings', `₹${f.monthly_savings.toLocaleString('en-IN')}`],
          ['Annual Savings', `₹${f.annual_savings.toLocaleString('en-IN')}`],
          ['Payback Period', f.payback_years ? `${f.payback_years} years` : '-'],
          ['ROI (25 years)', f.roi_pct ? `${f.roi_pct}%` : '-'],
          ['Total 25-Year Savings', `₹${f.total_25yr_savings.toLocaleString('en-IN')}`],
        ],
        theme: 'striped', styles: { font: fontFamily, fontSize: 9 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255 },
        margin: { left: 12, right: 12 }
      });
      y = (doc.lastAutoTable?.finalY || y) + 8;
      setPdfProgress(70);

      // Technical
      if (y > 240) { doc.addPage(); y = 18; }
      doc.setFontSize(12); doc.setFont(fontFamily, 'bold');
      doc.text('Technical KPIs', 12, y); y += 5;
      doc.line(12, y, W - 12, y); y += 4;
      const t = report.technical;
      autoTable(doc, {
        startY: y, head: [['KPI', 'Value']],
        body: [
          ['Performance Ratio (PR)', `${t.performance_ratio}`],
          ['Capacity Utilization Factor (CUF)', `${t.cuf_pct}%`],
          ['Annual Generation', `${t.annual_generation_units} units`],
          ['CO₂ Offset per Year', `${t.co2_offset_kg_per_year} kg`],
          ['Solar Irradiation', `${t.irradiation_kwh_m2_day} kWh/m²/day`],
          ['Panel Degradation', `${t.degradation_pct_per_year}% per year`],
        ],
        theme: 'striped', styles: { font: fontFamily, fontSize: 9 },
        headStyles: { fillColor: [139, 92, 246], textColor: 255 },
        margin: { left: 12, right: 12 }
      });
      y = (doc.lastAutoTable?.finalY || y) + 8;
      setPdfProgress(82);

      // 25-yr breakdown — every 5 years
      if (y > 220) { doc.addPage(); y = 18; }
      doc.setFontSize(12); doc.setFont(fontFamily, 'bold');
      doc.text('25-Year Savings Projection (5-year snapshots)', 12, y); y += 5;
      doc.line(12, y, W - 12, y); y += 4;
      const fiveYearRows = f.yearly_breakdown.filter(r => r.year % 5 === 0 || r.year === 1).map(r => [
        `Year ${r.year}`,
        `${r.generation_units} units`,
        `₹${r.tariff}/unit`,
        `₹${r.savings.toLocaleString('en-IN')}`,
        `₹${r.cumulative.toLocaleString('en-IN')}`
      ]);
      autoTable(doc, {
        startY: y, head: [['Year', 'Generation', 'Tariff', 'Savings', 'Cumulative']],
        body: fiveYearRows,
        theme: 'grid', styles: { font: fontFamily, fontSize: 8 },
        headStyles: { fillColor: [245, 158, 11], textColor: 255 },
        margin: { left: 12, right: 12 }
      });
      setPdfProgress(95);

      // Footer
      const pageCount = doc.internal.pages.length - 1;
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont(fontFamily, 'normal'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
        doc.text(`Sensoper Controls & Renewables · This report is an indicative projection. Actual savings may vary based on site conditions.`, 12, 290);
        doc.text(`Page ${i} of ${pageCount}`, W - 12, 290, { align: 'right' });
      }

      const blob = doc.output('blob');
      setGeneratedPdfBlob(blob);
      setPdfProgress(100);
      toast.success('PDF generated');
      return blob;
    } catch (e) {
      toast.error(`PDF generation failed: ${e.message || e}`);
      return null;
    } finally {
      setTimeout(() => { setPdfBuilding(false); setPdfProgress(0); }, 500);
    }
  }, [report, consumer]);

  const handleDownload = async () => {
    let blob = generatedPdfBlob;
    if (!blob) blob = await buildPdf();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = safeFileName(); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleMergeDownload = async () => {
    if (!uploadedPdf) { toast.error('Upload your existing project PDF first'); return; }
    let blob = generatedPdfBlob;
    if (!blob) blob = await buildPdf();
    if (!blob) return;
    setMerging(true);
    try {
      const res = await solarReportAPI.mergePdf(blob, uploadedPdf, mergePosition);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      const base = safeFileName().replace('.pdf', '_Merged.pdf');
      a.download = base; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Merged PDF downloaded');
    } catch (e) { toast.error(`Merge failed: ${e.response?.data?.detail || e.message}`); }
    finally { setMerging(false); }
  };

  // ============ RENDER ============
  const yearlyChart = report?.financials?.yearly_breakdown?.map(r => ({ year: `Y${r.year}`, savings: r.savings, cumulative: r.cumulative })) || [];
  const monthlySavings = report ? Array.from({ length: 12 }, (_, i) => ({ month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i], savings: report.financials.monthly_savings })) : [];

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="solar-report-title">Solar Project Report Generator</h1>
          <p className="text-sm text-slate-500">Auto-fetch TNEB consumer data → calculate optimal solar system → download branded PDF report.</p>
        </div>

        {/* ===== STEP 1: TNEB FETCH ===== */}
        <Card className="border-slate-200" data-testid="tneb-fetch-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Search className="h-4 w-4 text-emerald-600" />1. Fetch TNEB Consumer Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">TNEB Service Number *</Label>
                <Input value={consumer.service_number} onChange={(e) => setConsumer(p => ({ ...p, service_number: e.target.value.trim() }))} placeholder="e.g., 012345678901" className="h-9" data-testid="tneb-service-input" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Registered Phone Number *</Label>
                <Input value={consumer.phone} onChange={(e) => setConsumer(p => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="10-digit mobile" className="h-9" data-testid="tneb-phone-input" />
              </div>
              <div className="flex items-end">
                <Button onClick={handleFetchTneb} disabled={fetching} className="h-9 w-full gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="tneb-fetch-btn">
                  {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {fetching ? 'Fetching...' : 'Auto-Fetch'}
                </Button>
              </div>
            </div>
            {fetchInfo && (
              <div className={`p-3 rounded-md border text-sm flex items-start gap-2 ${fetchInfo.success ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`} data-testid="tneb-fetch-status">
                {fetchInfo.success ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                <div className="flex-1">
                  <p className="font-medium">{fetchInfo.success ? 'Data fetched' : 'Manual entry required'}</p>
                  <p className="text-xs">{fetchInfo.message}</p>
                </div>
                {!editingManual && <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setEditingManual(true)}><Edit3 className="h-3 w-3" />Edit</Button>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== STEP 1B: Consumer details (manual / preview) ===== */}
        {(fetchInfo || editingManual) && (
          <Card className="border-slate-200" data-testid="consumer-details-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Edit3 className="h-4 w-4 text-blue-600" />Consumer Details (editable)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Consumer Name *</Label><Input value={consumer.consumer_name} onChange={(e) => setConsumer(p => ({ ...p, consumer_name: e.target.value }))} className="h-9" data-testid="consumer-name-input" /></div>
                <div className="space-y-1 md:col-span-2"><Label className="text-xs">Address</Label><Input value={consumer.address} onChange={(e) => setConsumer(p => ({ ...p, address: e.target.value }))} className="h-9" data-testid="consumer-address-input" /></div>
                <div className="space-y-1"><Label className="text-xs">Sanctioned Load (kW)</Label><Input type="number" step="0.1" value={consumer.sanctioned_load_kw} onChange={(e) => setConsumer(p => ({ ...p, sanctioned_load_kw: e.target.value }))} className="h-9" data-testid="sanctioned-load-input" /></div>
                <div className="space-y-1"><Label className="text-xs">Avg Monthly Consumption (units) *</Label><Input type="number" value={consumer.avg_monthly_consumption} onChange={(e) => setConsumer(p => ({ ...p, avg_monthly_consumption: e.target.value }))} className="h-9" data-testid="consumption-input" /></div>
                <div className="space-y-1"><Label className="text-xs">Avg Monthly Bill (₹)</Label><Input type="number" value={consumer.avg_monthly_bill} onChange={(e) => setConsumer(p => ({ ...p, avg_monthly_bill: e.target.value }))} className="h-9" data-testid="bill-input" /></div>
                <div className="space-y-1"><Label className="text-xs">Tariff Category</Label>
                  <Select value={consumer.tariff_category} onValueChange={(v) => setConsumer(p => ({ ...p, tariff_category: v }))}>
                    <SelectTrigger className="h-9" data-testid="tariff-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Domestic">Domestic</SelectItem>
                      <SelectItem value="Commercial">Commercial</SelectItem>
                      <SelectItem value="Industrial">Industrial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Connection Type</Label>
                  <Select value={consumer.connection_type} onValueChange={(v) => setConsumer(p => ({ ...p, connection_type: v }))}>
                    <SelectTrigger className="h-9" data-testid="connection-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Single Phase">Single Phase</SelectItem>
                      <SelectItem value="Three Phase">Three Phase</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== STEP 2: System & Location Config ===== */}
        {(fetchInfo || editingManual) && (
          <Card className="border-slate-200" data-testid="config-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Sun className="h-4 w-4 text-amber-500" />2. System & Location Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* GPS + Irradiation */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="space-y-1"><Label className="text-xs">Latitude</Label><Input value={config.lat} onChange={(e) => setConfig(p => ({ ...p, lat: e.target.value }))} className="h-9" data-testid="lat-input" /></div>
                <div className="space-y-1"><Label className="text-xs">Longitude</Label><Input value={config.lng} onChange={(e) => setConfig(p => ({ ...p, lng: e.target.value }))} className="h-9" data-testid="lng-input" /></div>
                <div className="flex items-end"><Button onClick={handleGPS} disabled={gpsLoading} variant="outline" className="h-9 w-full gap-1" data-testid="gps-btn">{gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}GPS</Button></div>
                <div className="flex items-end"><Button onClick={handleIrradiation} disabled={irradLoading || !config.lat} variant="outline" className="h-9 w-full gap-1" data-testid="irradiation-btn">{irradLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Fetch Irradiation</Button></div>
                <div className="space-y-1"><Label className="text-xs">Irradiation (kWh/m²/day)</Label><Input type="number" step="0.1" value={config.irradiation_kwh_m2_day} onChange={(e) => setConfig(p => ({ ...p, irradiation_kwh_m2_day: e.target.value }))} className="h-9" data-testid="irradiation-input" /></div>
              </div>

              {/* System config */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1"><Label className="text-xs">System Type</Label>
                  <Select value={config.system_type} onValueChange={(v) => setConfig(p => ({ ...p, system_type: v }))}>
                    <SelectTrigger className="h-9" data-testid="system-type-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="on-grid">On-Grid</SelectItem>
                      <SelectItem value="off-grid">Off-Grid</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Panel Wattage (W)</Label><Input type="number" value={config.panel_wattage_w} onChange={(e) => setConfig(p => ({ ...p, panel_wattage_w: e.target.value }))} className="h-9" data-testid="panel-wattage-input" /></div>
                <div className="space-y-1"><Label className="text-xs">Cost/kWp (₹)</Label><Input type="number" value={config.cost_per_kwp} onChange={(e) => setConfig(p => ({ ...p, cost_per_kwp: e.target.value }))} className="h-9" data-testid="cost-per-kwp-input" /></div>
                {(config.system_type !== 'on-grid') && (
                  <div className="space-y-1"><Label className="text-xs">Battery Autonomy (days)</Label><Input type="number" step="0.1" value={config.battery_autonomy_days} onChange={(e) => setConfig(p => ({ ...p, battery_autonomy_days: e.target.value }))} className="h-9" data-testid="battery-autonomy-input" /></div>
                )}
              </div>

              <Button onClick={handleGenerate} disabled={sizingLoading} className="w-full h-11 gap-2 bg-blue-600 hover:bg-blue-700 text-white" data-testid="generate-report-btn">
                {sizingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Generate Solar Report
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ===== STEP 3: REPORT ===== */}
        {report && (
          <>
            {/* Sizing snapshot */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="sizing-kpis">
              <Card className="border-emerald-200 bg-emerald-50/40"><CardContent className="p-4"><Sun className="h-5 w-5 text-emerald-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Recommended</p><p className="text-2xl font-bold text-slate-900">{report.sizing.kwp_recommended} kWp</p></CardContent></Card>
              <Card className="border-blue-200 bg-blue-50/40"><CardContent className="p-4"><Zap className="h-5 w-5 text-blue-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Panels</p><p className="text-2xl font-bold text-slate-900">{report.sizing.num_panels}</p><p className="text-[10px] text-slate-500">× {report.sizing.panel_wattage_w}W</p></CardContent></Card>
              <Card className="border-amber-200 bg-amber-50/40"><CardContent className="p-4"><Zap className="h-5 w-5 text-amber-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Inverter</p><p className="text-2xl font-bold text-slate-900">{report.sizing.inverter_capacity_kw} kW</p></CardContent></Card>
              <Card className="border-violet-200 bg-violet-50/40"><CardContent className="p-4"><Leaf className="h-5 w-5 text-violet-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">CO₂ Offset</p><p className="text-2xl font-bold text-slate-900">{report.technical.co2_offset_kg_per_year.toLocaleString('en-IN')} kg/yr</p></CardContent></Card>
            </div>

            {/* Financial snapshot */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="financial-kpis">
              <Card className="border-slate-200"><CardContent className="p-4"><IndianRupee className="h-5 w-5 text-slate-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Total Cost</p><p className="text-xl font-bold text-slate-900">₹{report.financials.total_cost.toLocaleString('en-IN')}</p><p className="text-[10px] text-emerald-600">Subsidy: ₹{report.financials.subsidy.toLocaleString('en-IN')}</p></CardContent></Card>
              <Card className="border-emerald-200"><CardContent className="p-4"><IndianRupee className="h-5 w-5 text-emerald-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Net Cost</p><p className="text-xl font-bold text-emerald-700">₹{report.financials.net_cost.toLocaleString('en-IN')}</p><p className="text-[10px] text-slate-500">after subsidy</p></CardContent></Card>
              <Card className="border-blue-200"><CardContent className="p-4"><Calendar className="h-5 w-5 text-blue-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">Payback</p><p className="text-xl font-bold text-blue-700">{report.financials.payback_years} yrs</p><p className="text-[10px] text-slate-500">ROI: {report.financials.roi_pct}%</p></CardContent></Card>
              <Card className="border-amber-200 bg-amber-50/40"><CardContent className="p-4"><TrendingUp className="h-5 w-5 text-amber-600 mb-1" /><p className="text-[10px] uppercase tracking-wider text-slate-500">25-Yr Savings</p><p className="text-xl font-bold text-amber-700">₹{(report.financials.total_25yr_savings / 100000).toFixed(1)}L</p><p className="text-[10px] text-slate-500">₹{report.financials.annual_savings.toLocaleString('en-IN')}/yr</p></CardContent></Card>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-slate-200" data-testid="monthly-savings-chart">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-['Outfit']">Estimated Monthly Savings (Year 1)</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={monthlySavings}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}K` : v} />
                      <Tooltip formatter={(v) => [`₹${v.toLocaleString('en-IN')}`, 'Savings']} />
                      <Bar dataKey="savings" fill="#10b981" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-slate-200" data-testid="cumulative-savings-chart">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-['Outfit']">25-Year Cumulative Savings</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={yearlyChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => v >= 100000 ? `${(v/100000).toFixed(1)}L` : `${(v/1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v) => [`₹${v.toLocaleString('en-IN')}`, '']} />
                      <Legend />
                      <Line type="monotone" dataKey="savings" stroke="#3b82f6" strokeWidth={2} dot={false} name="Yearly" />
                      <Line type="monotone" dataKey="cumulative" stroke="#f59e0b" strokeWidth={2.5} dot={false} name="Cumulative" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* PDF Actions */}
            <Card className="border-slate-200" data-testid="pdf-actions-card">
              <CardHeader className="pb-3"><CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><FileDown className="h-4 w-4 text-rose-600" />3. Download & Merge PDF</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {pdfBuilding && (
                  <div className="space-y-1" data-testid="pdf-progress"><Progress value={pdfProgress} className="h-2" /><p className="text-xs text-slate-500">Building PDF... {pdfProgress}%</p></div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">Upload existing quotation/DPR PDF (optional, for merge)</Label>
                    <Input type="file" accept="application/pdf" onChange={(e) => setUploadedPdf(e.target.files?.[0] || null)} className="h-9" data-testid="upload-pdf-input" />
                    {uploadedPdf && <p className="text-[11px] text-slate-500 flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" />{uploadedPdf.name} ({(uploadedPdf.size / 1024).toFixed(0)} KB)</p>}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Merge Position</Label>
                    <Select value={mergePosition} onValueChange={setMergePosition}>
                      <SelectTrigger className="h-9" data-testid="merge-position-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prepend"><span className="inline-flex items-center gap-1"><ArrowUp className="h-3 w-3" />Prepend (our report first)</span></SelectItem>
                        <SelectItem value="append"><span className="inline-flex items-center gap-1"><ArrowDown className="h-3 w-3" />Append (our report last)</span></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-3 flex-wrap">
                  <Button onClick={handleDownload} disabled={pdfBuilding} className="gap-2 bg-rose-600 hover:bg-rose-700 text-white" data-testid="download-pdf-btn">
                    <FileDown className="h-4 w-4" />Download Report
                  </Button>
                  <Button onClick={handleMergeDownload} disabled={pdfBuilding || merging || !uploadedPdf} className="gap-2 bg-slate-800 hover:bg-slate-900 text-white" data-testid="merge-download-btn">
                    {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Combine className="h-4 w-4" />}
                    Merge & Download
                  </Button>
                  {generatedPdfBlob && <Badge variant="outline" className="text-emerald-700 border-emerald-300 gap-1"><CheckCircle2 className="h-3 w-3" />PDF cached</Badge>}
                </div>
                <p className="text-[11px] text-slate-500">Filename: <code className="bg-slate-100 px-1.5 py-0.5 rounded">{safeFileName()}</code></p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
