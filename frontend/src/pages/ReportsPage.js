import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { reportsAPI, marketingAPI, reconciliationAPI, ecommerceAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import {
  Loader2, FileSpreadsheet, FileText, IndianRupee, TrendingUp, Briefcase,
  Package, Users, Receipt, Star, AlertTriangle, Truck, ClipboardList, Megaphone, PackageCheck,
  Wrench, ShieldCheck, Wallet, Activity, UserCheck, MapPin, HardHat, ShoppingBag
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { loadUnicodeFont } from '../utils/pdfFont';
import { useLocationScope, LocationScopeSelect } from '../components/LocationScope';

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const PARTNER_SPECIALITIES = ['on-grid', 'off-grid', 'hybrid', 'pump', 'electrical', 'civil'];

const REPORTS = [
  { id: 'sales_revenue', label: 'Sales & Revenue', icon: IndianRupee, desc: 'Revenue, quotes, conversion, lead sources' },
  { id: 'profit_leakage', label: 'Profit & Leakage', icon: TrendingUp, desc: 'Margins, cost analysis, leakage alerts' },
  { id: 'project_execution', label: 'Project Execution', icon: Briefcase, desc: 'Progress, delays, completion, O&M' },
  { id: 'inventory_material', label: 'Inventory & Material', icon: Package, desc: 'Stock, usage, variance, alerts' },
  { id: 'customer_credit', label: 'Customer Credit', icon: IndianRupee, desc: 'Receivables, payments, outstanding' },
  { id: 'team_performance', label: 'Team Performance', icon: Users, desc: 'Productivity, workload, efficiency' },
  { id: 'compliance_tax', label: 'Compliance & Tax', icon: Receipt, desc: 'GST, tax summaries, invoices' },
  { id: 'customer_satisfaction', label: 'Customer Satisfaction', icon: Star, desc: 'Feedback, complaints, resolution' },
  { id: 'inbound', label: 'Inbound Report', icon: Package, desc: 'Purchase orders, QC, transport, receiving' },
  { id: 'outbound', label: 'Outbound Report', icon: Truck, desc: 'Deliveries, dispatch, transport tracking' },
  { id: 'audit', label: 'Audit Report', icon: ClipboardList, desc: 'Audits, checklist, issues, resolution' },
  { id: 'marketing', label: 'Marketing Report', icon: Megaphone, desc: 'Leads, conversions, site visits, quotes' },
  { id: 'excess_material', label: 'Excess Material', icon: PackageCheck, desc: 'Quoted vs issued vs consumed, recoverable value' },
  { id: 'amc', label: 'AMC Contracts', icon: ShieldCheck, desc: 'ARR/MRR, renewals, outstanding by contract' },
  { id: 'assets', label: 'Assets', icon: Package, desc: 'Register, book value, status breakdown' },
  { id: 'tools', label: 'Tools', icon: Wrench, desc: 'Tool utilisation and maintenance cost' },
  { id: 'expenses', label: 'Expenses', icon: Wallet, desc: 'Operational, marketing spend and GST input/paid' },
  { id: 'operational_expense', label: 'Operational Expense', icon: Wallet, desc: 'Operational spend only, monthly trend' },
  { id: 'reading_analysis', label: 'Reading Analysis', icon: Activity, desc: 'Generation trend vs estimate' },
  { id: 'employee_performance', label: 'Employee Performance', icon: UserCheck, desc: 'Auto activity + manual scores' },
  { id: 'partner_performance', label: 'Partner Performance', icon: HardHat, desc: 'On-time rate, ratings, payments, retention by partner' },
  { id: 'ecommerce', label: 'Ecommerce', icon: ShoppingBag, desc: 'Revenue, margin after commission, returns by platform/SKU' },
  { id: 'customer_support', label: 'Customer Support', icon: Star, desc: 'SLA breach %, resolution time, CSAT, top recurring issues' },
  { id: 'brand_returns', label: 'Brand Returns', icon: ShoppingBag, desc: 'Returns to suppliers, value returned, resolution time, supplier return-rate ranking' },
  { id: 'report_usage', label: 'Report Usage', icon: Activity, desc: 'Who ran which report, when, with what filters and format', adminOnly: true }
];

function SummaryCard({ label, value }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 text-center" data-testid={`summary-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">{label}</p>
      <p className="text-lg font-bold text-slate-900">{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</p>
    </div>
  );
}

const formatHeader = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

const formatSummaryValue = (key, v) => {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  if (typeof v !== 'number') return v;
  const k = key.toLowerCase();
  if (k.includes('pct') || k.includes('percent') || k.includes('rate')) return `${v}%`;
  const isCountLike = ['count', 'staff', 'entries', 'logs', 'sites', 'orders', 'listings', 'partners', 'assignments', 'kwh', 'districts', 'units'].some(w => k.includes(w));
  if (isCountLike) return v.toLocaleString('en-IN');
  const isMoneyLike = ['revenue', 'commission', 'margin', 'paid', 'balance', 'retention', 'outstanding', 'cost', 'amount', 'business', 'payout', 'expense', 'value'].some(w => k.includes(w));
  if (isMoneyLike) return `₹${v.toLocaleString('en-IN')}`;
  return v > 999 ? `₹${v.toLocaleString('en-IN')}` : v;
};

export default function ReportsPage() {
  const [searchParams] = useSearchParams();
  const locScope = useLocationScope('reports_location_scope');
  const [activeReport, setActiveReport] = useState(searchParams.get('type') || '');
  const [activeTab, setActiveTab] = useState('');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const { isAdmin } = useAuth();
  const [filters, setFilters] = useState({ date_from: '', date_to: '', system_type: 'all', status: 'all', movement_type: 'all', district: '', speciality: 'all', platform_id: 'all', category: '', supplier: '' });
  const [cacData, setCacData] = useState(null);
  const [cacLoading, setCacLoading] = useState(false);
  const [excessMaterialData, setExcessMaterialData] = useState(null);
  const [excessMaterialLoading, setExcessMaterialLoading] = useState(false);
  const [ecommercePlatforms, setEcommercePlatforms] = useState([]);

  const fetchExcessMaterial = useCallback(async () => {
    setExcessMaterialLoading(true);
    try { const r = await reconciliationAPI.report(); setExcessMaterialData(r.data); }
    catch (e) { console.error('Excess material report fetch failed', e); setExcessMaterialData(null); }
    finally { setExcessMaterialLoading(false); }
  }, []);

  const fetchCac = useCallback(async () => {
    setCacLoading(true);
    try {
      const params = {};
      if (filters.date_from) params.start = filters.date_from;
      if (filters.date_to) params.end = filters.date_to;
      const [cac, mkt] = await Promise.all([
        reportsAPI.getCac ? reportsAPI.getCac(params) : marketingAPI.cac(params),
        marketingAPI.summary(params),
      ]);
      setCacData({ cac: cac.data, marketing: mkt.data });
    } catch (e) { console.error('CAC fetch failed', e); setCacData(null); }
    finally { setCacLoading(false); }
  }, [filters.date_from, filters.date_to]);

  useEffect(() => {
    if (activeReport === 'marketing') fetchCac();
    if (activeReport === 'excess_material') fetchExcessMaterial();
    if (activeReport === 'ecommerce' && ecommercePlatforms.length === 0) {
      ecommerceAPI.platforms.list().then(r => setEcommercePlatforms(r.data)).catch(console.error);
    }
  }, [activeReport, fetchCac, fetchExcessMaterial, ecommercePlatforms.length]);

  const fetchReport = useCallback(async (type, tab, overrideFilters) => {
    setLoading(true);
    setReportData(null);
    try {
      const f = overrideFilters ? { ...filters, ...overrideFilters } : filters;
      const params = {};
      if (f.date_from) params.date_from = f.date_from;
      if (f.date_to) params.date_to = f.date_to;
      if (f.system_type !== 'all') params.system_type = f.system_type;
      if (f.status !== 'all') params.status = f.status;
      if (f.movement_type !== 'all' && type === 'inventory_material' && tab === 'movement') params.movement_type = f.movement_type;
      if (type === 'partner_performance') {
        if (f.district) params.district = f.district;
        if (f.supplier) params.supplier = f.supplier;
        if (f.speciality !== 'all') params.speciality = f.speciality;
      }
      if (type === 'ecommerce') {
        if (f.platform_id !== 'all') params.platform_id = f.platform_id;
        if (f.category) params.category = f.category;
      }
      if (tab) params.tab = tab;
      if (locScope.locationId) params.location_id = locScope.locationId;
      const res = await reportsAPI.get(type, params);
      setReportData(res.data);
    } catch (err) { console.error('Report fetch failed:', err); }
    finally { setLoading(false); }
  }, [filters, locScope.locationId]);

  const handleSelectReport = (type) => {
    setActiveReport(type);
    setActiveTab('');
    fetchReport(type);
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    fetchReport(activeReport, tab);
  };

  useEffect(() => {
    if (activeReport) fetchReport(activeReport, activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locScope.locationId]);

  const getColumns = () => {
    if (!reportData?.rows?.length) return [];
    return Object.keys(reportData.rows[0]).filter(k => !['has_feedback'].includes(k));
  };

  const logExport = (format) => reportsAPI.logUsage({ report_type: activeReport, format, filters: { ...filters, tab: activeTab }, location_id: locScope.locationId || null }).catch(() => {});
  const exportPDF = async () => {
    if (!reportData) return;
    logExport('pdf');
    const doc = new jsPDF({ orientation: 'landscape' });
    const FONT = await loadUnicodeFont(doc);
    doc.setFontSize(18); doc.setTextColor(16, 185, 129);
    doc.text('Sensoper Controls & Renewables', 14, 18);
    doc.setFontSize(14); doc.setTextColor(30, 41, 59);
    doc.text(reportData.title, 14, 28);
    doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}  ·  Location: ${locScope.locationLabel}`, 14, 34);
    if (reportData.summary) {
      let y = 42; doc.setFontSize(10); doc.setTextColor(30, 41, 59);
      Object.entries(reportData.summary).forEach(([k, v]) => { doc.text(`${formatHeader(k)}: ${typeof v === 'number' ? v.toLocaleString('en-IN') : v}`, 14, y); y += 6; });
    }
    const cols = getColumns();
    if (reportData.rows?.length) {
      autoTable(doc, { startY: 42 + (reportData.summary ? Object.keys(reportData.summary).length * 6 + 4 : 0), head: [cols.map(formatHeader)], body: reportData.rows.map(r => cols.map(c => { const v = r[c]; return typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? ''); })), theme: 'striped', styles: { font: FONT }, headStyles: { font: FONT, fillColor: [16, 185, 129], textColor: 255, fontSize: 8 }, bodyStyles: { font: FONT, fontSize: 7 }, margin: { left: 14, right: 14 } });
    }
    doc.save(`${reportData.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const exportExcel = () => {
    logExport('excel');
    if (!reportData) return;
    const wb = XLSX.utils.book_new();
    const ws0 = XLSX.utils.aoa_to_sheet([[reportData.title], [`Location: ${locScope.locationLabel}`], [`Generated: ${new Date().toLocaleDateString('en-IN')}`]]);
    XLSX.utils.book_append_sheet(wb, ws0, 'Info');
    if (reportData.summary) { const ws1 = XLSX.utils.json_to_sheet(Object.entries(reportData.summary).map(([k, v]) => ({ Metric: formatHeader(k), Value: v }))); XLSX.utils.book_append_sheet(wb, ws1, 'Summary'); }
    if (reportData.rows?.length) { const cols = getColumns(); const ws2 = XLSX.utils.json_to_sheet(reportData.rows.map(r => { const row = {}; cols.forEach(c => { row[formatHeader(c)] = r[c]; }); return row; })); XLSX.utils.book_append_sheet(wb, ws2, 'Data'); }
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${reportData.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="py-6 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="reports-title">Reports</h1>
          <p className="text-sm text-slate-500">{REPORTS.length} business intelligence reports</p>
        </div>

        {/* Filters */}
        <Card className="border-slate-200 mb-5" data-testid="filters-card">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="space-y-1"><Label className="text-xs">Location</Label><LocationScopeSelect scope={locScope} testIdPrefix="report-location" /></div>
              <div className="space-y-1"><Label className="text-xs">Date From</Label><Input type="date" value={filters.date_from} onChange={(e) => setFilters(p => ({...p, date_from: e.target.value}))} className="h-9" data-testid="filter-date-from" /></div>
              <div className="space-y-1"><Label className="text-xs">Date To</Label><Input type="date" value={filters.date_to} onChange={(e) => setFilters(p => ({...p, date_to: e.target.value}))} className="h-9" data-testid="filter-date-to" /></div>
              <div className="space-y-1"><Label className="text-xs">System Type</Label>
                <Select value={filters.system_type} onValueChange={(v) => setFilters(p => ({...p, system_type: v}))}><SelectTrigger className="h-9" data-testid="filter-system-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Types</SelectItem><SelectItem value="on-grid">On-Grid</SelectItem><SelectItem value="off-grid">Off-Grid</SelectItem><SelectItem value="hybrid">Hybrid</SelectItem></SelectContent></Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Status</Label>
                <Select value={filters.status} onValueChange={(v) => setFilters(p => ({...p, status: v}))}><SelectTrigger className="h-9" data-testid="filter-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="submitted">Submitted</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent></Select>
              </div>
            </div>
            {activeReport === 'inventory_material' && activeTab === 'movement' && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="movement-filter-row">
                <div className="space-y-1">
                  <Label className="text-xs">Movement Type</Label>
                  <Select value={filters.movement_type} onValueChange={(v) => { setFilters(p => ({...p, movement_type: v})); fetchReport(activeReport, activeTab, { movement_type: v }); }}>
                    <SelectTrigger className="h-9" data-testid="filter-movement-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="fast">Fast Moving</SelectItem>
                      <SelectItem value="slow">Slow Moving</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1 sm:col-span-3 flex items-end">
                  <p className="text-[11px] text-slate-400">Fast = ≥ 5 usages in the selected window (defaults to last 30 days if no date range).</p>
                </div>
              </div>
            )}
            {activeReport === 'report_usage' && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="report-usage-filter-row">
                <div className="space-y-1"><Label className="text-xs">User</Label><Input placeholder="name contains…" value={filters.supplier} onChange={(e) => setFilters(p => ({...p, supplier: e.target.value}))} onBlur={(e) => fetchReport(activeReport, activeTab, { supplier: e.target.value })} className="h-9" data-testid="filter-usage-user" /></div>
                <div className="space-y-1"><Label className="text-xs">Report type</Label>
                  <Select value={filters.category || 'all'} onValueChange={(v) => { const val = v === 'all' ? '' : v; setFilters(p => ({...p, category: val})); fetchReport(activeReport, activeTab, { category: val }); }}>
                    <SelectTrigger className="h-9" data-testid="filter-usage-report-type"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All reports</SelectItem>{REPORTS.filter(r => r.id !== 'report_usage').map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent>
                  </Select></div>
              </div>
            )}
            {activeReport === 'brand_returns' && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="brand-returns-filter-row">
                <div className="space-y-1"><Label className="text-xs">Supplier</Label><Input placeholder="e.g. Growatt India" value={filters.supplier} onChange={(e) => setFilters(p => ({...p, supplier: e.target.value}))} onBlur={(e) => fetchReport(activeReport, activeTab, { supplier: e.target.value })} className="h-9" data-testid="filter-supplier" /></div>
                <div className="space-y-1"><Label className="text-xs">Category</Label><Input placeholder="e.g. inverters" value={filters.category} onChange={(e) => setFilters(p => ({...p, category: e.target.value}))} onBlur={(e) => fetchReport(activeReport, activeTab, { category: e.target.value })} className="h-9" data-testid="filter-category-returns" /></div>
              </div>
            )}
            {activeReport === 'partner_performance' && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="partner-performance-filter-row">
                <div className="space-y-1">
                  <Label className="text-xs">District</Label>
                  <Input placeholder="e.g. Chennai" value={filters.district} onChange={(e) => setFilters(p => ({...p, district: e.target.value}))} onBlur={(e) => fetchReport(activeReport, activeTab, { district: e.target.value })} className="h-9" data-testid="filter-district" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Speciality</Label>
                  <Select value={filters.speciality} onValueChange={(v) => { setFilters(p => ({...p, speciality: v})); fetchReport(activeReport, activeTab, { speciality: v }); }}>
                    <SelectTrigger className="h-9" data-testid="filter-speciality"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All</SelectItem>{PARTNER_SPECIALITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {activeReport === 'ecommerce' && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="ecommerce-filter-row">
                <div className="space-y-1">
                  <Label className="text-xs">Platform</Label>
                  <Select value={filters.platform_id} onValueChange={(v) => { setFilters(p => ({...p, platform_id: v})); fetchReport(activeReport, activeTab, { platform_id: v }); }}>
                    <SelectTrigger className="h-9" data-testid="filter-platform"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All Platforms</SelectItem>{ecommercePlatforms.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Category</Label>
                  <Input placeholder="e.g. panels" value={filters.category} onChange={(e) => setFilters(p => ({...p, category: e.target.value}))} onBlur={(e) => fetchReport(activeReport, activeTab, { category: e.target.value })} className="h-9" data-testid="filter-category" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Report Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6" data-testid="report-cards">
          {REPORTS.filter(r => !r.adminOnly || isAdmin).map(r => (
            <button key={r.id} onClick={() => handleSelectReport(r.id)}
              className={`p-4 rounded-xl border text-left transition-all ${activeReport === r.id ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'}`}
              data-testid={`report-btn-${r.id}`}>
              <r.icon className={`h-5 w-5 mb-2 ${activeReport === r.id ? 'text-emerald-600' : 'text-slate-400'}`} />
              <p className={`text-sm font-semibold ${activeReport === r.id ? 'text-emerald-800' : 'text-slate-800'}`}>{r.label}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{r.desc}</p>
            </button>
          ))}
        </div>

        {/* Results */}
        {loading && <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>}

        {reportData && !loading && (
          <Card className="border-slate-200" data-testid="report-results">
            <CardHeader className="border-b border-slate-200 py-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="font-['Outfit'] text-lg">{reportData.title}</CardTitle>
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5" data-testid="report-location-label"><MapPin className="h-3 w-3" />{locScope.locationLabel}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportPDF} className="gap-1.5 h-8 text-xs" data-testid="export-pdf-btn"><FileText className="h-3.5 w-3.5" />PDF</Button>
                  <Button variant="outline" size="sm" onClick={exportExcel} className="gap-1.5 h-8 text-xs" data-testid="export-excel-btn"><FileSpreadsheet className="h-3.5 w-3.5" />Excel</Button>
                </div>
              </div>
              {/* Tab Navigation */}
              {reportData.tabs && reportData.tabs.length > 1 && (
                <div className="flex gap-2 mt-3" data-testid="report-tabs">
                  {reportData.tabs.map(t => (
                    <button key={t} onClick={() => handleTabChange(t)}
                      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${(!activeTab && reportData.tabs[0] === t) || activeTab === t ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                      data-testid={`tab-${t}`}>
                      {formatHeader(t)}
                    </button>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-4">
              {/* Summary */}
              {reportData.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4" data-testid="report-summary">
                  {Object.entries(reportData.summary).map(([k, v]) => (
                    <SummaryCard key={k} label={formatHeader(k)} value={formatSummaryValue(k, v)} />
                  ))}
                </div>
              )}
              {/* Chart */}
              {reportData.chart_data?.length > 0 && (
                <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200" data-testid="report-chart">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-3">Visual Breakdown</p>
                  <div className="space-y-2.5">
                    {reportData.chart_data.map((item, i) => {
                      const maxVal = Math.max(...reportData.chart_data.map(d => d.value));
                      const pct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
                      return (
                        <div key={`${item.name}-${i}`} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="text-xs text-slate-600 w-32 truncate">{item.name}</span>
                          <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length]}} /></div>
                          <span className="text-xs font-medium text-slate-900 w-20 text-right">{typeof item.value === 'number' && item.value > 999 ? item.value.toLocaleString('en-IN') : item.value}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Ecommerce: platform breakdown + monthly revenue trend (Iter 46 Change 2) */}
              {activeReport === 'brand_returns' && reportData.supplier_rows?.length > 0 && (
                <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200" data-testid="brand-returns-supplier-ranking">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-1">Supplier ranking by return rate</p>
                  <p className="text-[11px] text-slate-500 mb-3">Return rate = quantity returned ÷ quantity purchased from that supplier (purchase orders). Higher = more of their goods come back.</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-slate-500 border-b"><th className="py-1.5">#</th><th>Supplier</th><th>Returns</th><th>Qty returned / purchased</th><th>Return rate</th><th>Value returned</th><th>Open / Resolved</th><th>Avg resolution</th></tr></thead>
                    <tbody>{reportData.supplier_rows.map(r => (
                      <tr key={r.supplier} className="border-b last:border-0" data-testid={`supplier-rank-${r.rank}`}><td className="py-1.5">{r.rank}</td><td className="font-medium">{r.supplier}</td><td>{r.returns}</td><td>{r.qty_returned} / {r.qty_purchased || '—'}</td><td className={r.return_rate_pct > 5 ? 'text-rose-600 font-semibold' : ''}>{r.return_rate_pct == null ? 'n/a (no POs)' : `${r.return_rate_pct}%`}</td><td>₹{(r.value || 0).toLocaleString('en-IN')}</td><td>{r.open} / {r.resolved}</td><td>{r.avg_resolution_hours == null ? '—' : `${r.avg_resolution_hours} h`}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {activeReport === 'brand_returns' && (reportData.reason_rows?.length > 0 || reportData.item_rows?.length > 0) && (
                <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="brand-returns-breakdowns">
                  {[['By reason', reportData.reason_rows], ['By item', reportData.item_rows], ['By month', reportData.monthly_rows]].map(([title, list]) => list?.length > 0 && (
                    <div key={title} className="p-4 bg-white rounded-lg border border-slate-200">
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-2">{title}</p>
                      <table className="w-full text-sm"><thead><tr className="text-left text-slate-500 border-b"><th className="py-1">{title.replace('By ', '')}</th><th>Returns</th><th>Qty</th><th>Value</th></tr></thead>
                        <tbody>{list.map(r => <tr key={r.name} className="border-b last:border-0"><td className="py-1">{r.name}</td><td>{r.count}</td><td>{r.qty}</td><td>₹{(r.value || 0).toLocaleString('en-IN')}</td></tr>)}</tbody></table>
                    </div>
                  ))}
                </div>
              )}
              {activeReport === 'customer_support' && reportData.technician_rows?.length > 0 && (
                <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200" data-testid="support-technician-rows">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-3">Technician-level Resolution Performance</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-slate-500 border-b"><th className="py-1.5">Technician</th><th>Resolved</th><th>Avg CSAT</th><th>Avg Resolution (hrs)</th></tr></thead>
                    <tbody>{reportData.technician_rows.map(r => (
                      <tr key={r.technician} className="border-b last:border-0"><td className="py-1.5">{r.technician}</td><td>{r.resolved}</td><td>{r.avg_csat || '—'}</td><td>{r.avg_resolution_hours || '—'}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {activeReport === 'customer_support' && reportData.monthly_rows?.length > 0 && (
                <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200" data-testid="support-monthly-rows">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-3">Volume &amp; CSAT by Month</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-slate-500 border-b"><th className="py-1.5">Month</th><th>Ticket Count</th><th>Avg CSAT</th></tr></thead>
                    <tbody>{reportData.monthly_rows.map(r => (
                      <tr key={r.month} className="border-b last:border-0"><td className="py-1.5">{r.month}</td><td>{r.count}</td><td>{r.avg_csat || '—'}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {activeReport === 'customer_support' && reportData.top_recurring?.length > 0 && (
                <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200" data-testid="support-top-recurring">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-3">Top Recurring Issue Categories</p>
                  <div className="flex flex-wrap gap-2">{reportData.top_recurring.map(r => (
                    <span key={r.category} className="px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">{r.category.replace(/_/g, ' ')} · {r.count}</span>
                  ))}</div>
                </div>
              )}
              {activeReport === 'ecommerce' && reportData.platform_rows?.length > 0 && (
                <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200" data-testid="ecommerce-platform-breakdown">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-3">Revenue by Platform</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-slate-500 border-b"><th className="py-1.5">Platform</th><th>Revenue</th><th>Units</th><th>Commission</th><th>Orders</th></tr></thead>
                    <tbody>{reportData.platform_rows.map(r => (
                      <tr key={r.platform} className="border-b last:border-0"><td className="py-1.5">{r.platform}</td><td>₹{r.revenue.toLocaleString('en-IN')}</td><td>{r.units}</td><td>₹{r.commission.toLocaleString('en-IN')}</td><td>{r.orders}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {activeReport === 'ecommerce' && reportData.monthly_rows?.length > 0 && (
                <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200" data-testid="ecommerce-monthly-trend">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-3">Revenue by Month</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-slate-500 border-b"><th className="py-1.5">Month</th><th>Revenue</th><th>Units</th><th>Orders</th></tr></thead>
                    <tbody>{reportData.monthly_rows.map(r => (
                      <tr key={r.month} className="border-b last:border-0"><td className="py-1.5">{r.month}</td><td>₹{r.revenue.toLocaleString('en-IN')}</td><td>{r.units}</td><td>{r.orders}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {/* CAC / Marketing dashboard (Iter 39 Change 3b) */}
              {activeReport === 'marketing' && (
                <div className="mb-4" data-testid="cac-panel">
                  {cacLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-rose-500" /></div>
                  ) : cacData?.cac ? (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3" data-testid="cac-kpi-strip">
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                          <p className="text-[10px] uppercase text-rose-700">Marketing Spend</p>
                          <p className="text-lg font-bold text-slate-900">₹{(cacData.cac.total_spend || 0).toLocaleString('en-IN')}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{cacData.marketing?.entry_count || 0} entries</p>
                        </div>
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                          <p className="text-[10px] uppercase text-blue-700">New Customers</p>
                          <p className="text-lg font-bold text-slate-900">{cacData.cac.total_customers || 0}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{cacData.cac.unattributed_pct?.toFixed?.(0) || 0}% unattributed</p>
                        </div>
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <p className="text-[10px] uppercase text-amber-700">Blended CAC</p>
                          <p className="text-lg font-bold text-slate-900">
                            {cacData.cac.blended_cac == null ? '—' : `₹${cacData.cac.blended_cac.toLocaleString('en-IN')}`}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            Paid CAC: {cacData.cac.paid_cac == null ? '—' : `₹${cacData.cac.paid_cac.toLocaleString('en-IN')}`}
                          </p>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <p className="text-[10px] uppercase text-emerald-700">LTV : CAC</p>
                          <p className="text-lg font-bold text-slate-900">
                            {cacData.cac.ltv_cac_ratio == null ? '—' : `${cacData.cac.ltv_cac_ratio.toFixed(1)}×`}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            LTV: ₹{(cacData.cac.ltv || 0).toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        {/* Channel performance table */}
                        <Card className="border-slate-200" data-testid="cac-channels">
                          <CardHeader className="py-2 px-3 border-b border-slate-200"><CardTitle className="text-sm font-['Outfit'] flex items-center gap-1"><Megaphone className="h-4 w-4 text-rose-600" /> Channel Performance</CardTitle></CardHeader>
                          <CardContent className="p-0">
                            {cacData.cac.channels?.length ? (
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-500">
                                  <tr>
                                    <th className="text-left px-2 py-2">Channel</th>
                                    <th className="text-right px-2 py-2">Spend</th>
                                    <th className="text-right px-2 py-2">Cust</th>
                                    <th className="text-right px-2 py-2">CAC</th>
                                    <th className="text-right px-2 py-2">ROI</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {cacData.cac.channels.map((c) => (
                                    <tr key={c.channel} className="hover:bg-slate-50">
                                      <td className="px-2 py-1.5 font-medium text-slate-800 capitalize">{c.channel.replace(/_/g, ' ')}</td>
                                      <td className="px-2 py-1.5 text-right">₹{(c.spend || 0).toLocaleString('en-IN')}</td>
                                      <td className="px-2 py-1.5 text-right">{c.customers}</td>
                                      <td className="px-2 py-1.5 text-right">{c.cac == null ? '—' : `₹${c.cac.toLocaleString('en-IN')}`}</td>
                                      <td className={`px-2 py-1.5 text-right font-semibold ${c.roi > 0 ? 'text-emerald-700' : c.roi < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                                        {c.roi == null ? '—' : `${(c.roi * 100).toFixed(0)}%`}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : <p className="text-xs text-slate-400 text-center py-4">No paid channels with recorded spend.</p>}
                          </CardContent>
                        </Card>

                        {/* Attribution funnel */}
                        <Card className="border-slate-200" data-testid="cac-attribution">
                          <CardHeader className="py-2 px-3 border-b border-slate-200"><CardTitle className="text-sm font-['Outfit'] flex items-center gap-1"><TrendingUp className="h-4 w-4 text-blue-600" /> Attribution Split</CardTitle></CardHeader>
                          <CardContent className="p-3 space-y-2">
                            {Object.entries(cacData.cac.by_channel_customers || {})
                              .sort((a, b) => b[1] - a[1])
                              .map(([ch, count], i) => {
                                const total = Object.values(cacData.cac.by_channel_customers || {}).reduce((a, b) => a + b, 0) || 1;
                                const pct = (count / total) * 100;
                                return (
                                  <div key={ch} className="flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                    <span className="text-xs text-slate-700 w-28 truncate capitalize">{ch.replace(/_/g, ' ')}</span>
                                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                    </div>
                                    <span className="text-xs font-medium text-slate-900 w-16 text-right">{count} ({pct.toFixed(0)}%)</span>
                                  </div>
                                );
                              })}
                            <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                              Marketing % of revenue: <span className="font-semibold text-slate-700">{cacData.cac.marketing_pct_of_revenue?.toFixed(1) || 0}%</span>
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-6 text-xs text-slate-400" data-testid="cac-empty">
                      No marketing spend recorded yet. Add entries under Accounting → Marketing Expense to see CAC metrics.
                    </div>
                  )}
                </div>
              )}

              {/* Excess Material dashboard (Iter 42 Change 4) */}
              {activeReport === 'excess_material' && (
                <div className="mb-4" data-testid="excess-material-panel">
                  {excessMaterialLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-amber-500" /></div>
                  ) : excessMaterialData ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Card className="border-slate-200" data-testid="excess-by-item">
                        <CardHeader className="py-2 px-3 border-b border-slate-200"><CardTitle className="text-sm font-['Outfit'] flex items-center gap-1"><Package className="h-4 w-4 text-amber-600" />Over-Issue by Item</CardTitle></CardHeader>
                        <CardContent className="p-0">
                          {excessMaterialData.by_item?.length ? (
                            <table className="w-full text-xs">
                              <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-500"><tr><th className="text-left px-2 py-2">Item</th><th className="text-right px-2 py-2">Issued</th><th className="text-right px-2 py-2">Variance</th><th className="text-right px-2 py-2">Over-Issue %</th></tr></thead>
                              <tbody className="divide-y divide-slate-100">
                                {excessMaterialData.by_item.slice(0, 10).map(it => (
                                  <tr key={it.name}>
                                    <td className="px-2 py-1.5 font-medium text-slate-800 truncate max-w-[120px]">{it.name}</td>
                                    <td className="px-2 py-1.5 text-right">{it.qty_issued}</td>
                                    <td className="px-2 py-1.5 text-right">{it.variance}</td>
                                    <td className={`px-2 py-1.5 text-right font-semibold ${it.over_issue_pct > 10 ? 'text-rose-600' : 'text-slate-600'}`}>{it.over_issue_pct}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : <p className="text-xs text-slate-400 text-center py-4">No reconciliations submitted yet.</p>}
                        </CardContent>
                      </Card>
                      <Card className="border-slate-200" data-testid="excess-unreturned">
                        <CardHeader className="py-2 px-3 border-b border-slate-200"><CardTitle className="text-sm font-['Outfit'] flex items-center gap-1"><IndianRupee className="h-4 w-4 text-rose-600" />Unreturned Material by Project</CardTitle></CardHeader>
                        <CardContent className="p-0">
                          {excessMaterialData.unreturned_by_project?.length ? (
                            <table className="w-full text-xs">
                              <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-500"><tr><th className="text-left px-2 py-2">Project</th><th className="text-right px-2 py-2">Value at Site</th></tr></thead>
                              <tbody className="divide-y divide-slate-100">
                                {excessMaterialData.unreturned_by_project.slice(0, 10).map((p, i) => (
                                  <tr key={i}><td className="px-2 py-1.5 font-medium text-slate-800 truncate max-w-[160px]">{p.project_name}</td><td className="px-2 py-1.5 text-right">₹{p.value_at_site.toLocaleString('en-IN')}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          ) : <p className="text-xs text-slate-400 text-center py-4">Nothing unreturned yet.</p>}
                        </CardContent>
                      </Card>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-xs text-slate-400" data-testid="excess-material-empty">No reconciliations submitted yet — fill one from a completed project's page.</div>
                  )}
                </div>
              )}

              {/* Table */}
              {reportData.rows?.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200" data-testid="report-table">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 border-b border-slate-200">
                      {getColumns().map(col => <th key={col} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">{formatHeader(col)}</th>)}
                    </tr></thead>
                    <tbody>
                      {reportData.rows.map((row, idx) => (
                        <tr key={row.ref || idx} className="border-b border-slate-100 hover:bg-slate-50">
                          {getColumns().map(col => (
                            <td key={col} className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                              {col === 'movement_type' ? (
                                <Badge className={`text-[10px] ${row[col] === 'Fast' ? 'bg-emerald-100 text-emerald-700' : row[col] === 'Slow' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`} data-testid={`movement-badge-${idx}`}>
                                  {row[col]}
                                </Badge>
                              ) :
                               col === 'status' && (row[col] === 'Active' || row[col] === 'Inactive') ? (
                                <span className="inline-flex items-center gap-1.5" data-testid={`status-cell-${idx}`}>
                                  <span className={`inline-block h-2 w-2 rounded-full ${row[col] === 'Active' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                  <span className="text-xs text-slate-600">{row[col]}</span>
                                </span>
                              ) :
                               col === 'status' || col === 'payment_status' || col === 'load_status' || col === 'risk_level' ? <Badge variant="outline" className={`text-[10px] ${row[col]==='High'||row[col]==='Overloaded'?'border-red-300 text-red-700':row[col]==='Paid'||row[col]==='completed'?'border-emerald-300 text-emerald-700':''}`}>{row[col]}</Badge> :
                               col === 'low_stock' ? (row[col] ? <Badge className="bg-red-100 text-red-700 text-[10px]">Low</Badge> : <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">OK</Badge>) :
                               col === 'alert' && row[col] ? <span className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{row[col]}</span> :
                               typeof row[col]==='number' && row[col]>999 ? row[col].toLocaleString('en-IN') :
                               typeof row[col]==='boolean' ? (row[col]?'Yes':'No') : String(row[col]??'-')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-slate-400 text-center py-8">No data for current filters.</p>}
              <p className="text-xs text-slate-400 mt-3">{reportData.rows?.length || 0} records</p>
            </CardContent>
          </Card>
        )}

        {!activeReport && !loading && (
          <div className="text-center py-16">
            <TrendingUp className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-600 mb-2">Select a Report</h3>
            <p className="text-sm text-slate-400">Choose from {REPORTS.length} consolidated business intelligence reports</p>
          </div>
        )}
      </div>
    </div>
  );
}
