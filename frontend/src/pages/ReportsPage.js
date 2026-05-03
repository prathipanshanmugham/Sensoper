import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { reportsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import {
  Loader2, FileSpreadsheet, FileText, IndianRupee, TrendingUp, Briefcase,
  Package, Users, Receipt, Star, AlertTriangle, Truck, ClipboardList, Megaphone
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

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
  { id: 'marketing', label: 'Marketing Report', icon: Megaphone, desc: 'Leads, conversions, site visits, quotes' }
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

export default function ReportsPage() {
  const [searchParams] = useSearchParams();
  const [activeReport, setActiveReport] = useState(searchParams.get('type') || '');
  const [activeTab, setActiveTab] = useState('');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ date_from: '', date_to: '', system_type: 'all', status: 'all', movement_type: 'all' });

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
      if (tab) params.tab = tab;
      const res = await reportsAPI.get(type, params);
      setReportData(res.data);
    } catch (err) { console.error('Report fetch failed:', err); }
    finally { setLoading(false); }
  }, [filters]);

  const handleSelectReport = (type) => {
    setActiveReport(type);
    setActiveTab('');
    fetchReport(type);
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    fetchReport(activeReport, tab);
  };

  const getColumns = () => {
    if (!reportData?.rows?.length) return [];
    return Object.keys(reportData.rows[0]).filter(k => !['has_feedback'].includes(k));
  };

  const exportPDF = () => {
    if (!reportData) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(18); doc.setTextColor(16, 185, 129);
    doc.text('Sensoper Controls & Renewables', 14, 18);
    doc.setFontSize(14); doc.setTextColor(30, 41, 59);
    doc.text(reportData.title, 14, 28);
    doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 14, 34);
    if (reportData.summary) {
      let y = 42; doc.setFontSize(10); doc.setTextColor(30, 41, 59);
      Object.entries(reportData.summary).forEach(([k, v]) => { doc.text(`${formatHeader(k)}: ${typeof v === 'number' ? v.toLocaleString('en-IN') : v}`, 14, y); y += 6; });
    }
    const cols = getColumns();
    if (reportData.rows?.length) {
      autoTable(doc, { startY: 42 + (reportData.summary ? Object.keys(reportData.summary).length * 6 + 4 : 0), head: [cols.map(formatHeader)], body: reportData.rows.map(r => cols.map(c => { const v = r[c]; return typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? ''); })), theme: 'striped', headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 8 }, bodyStyles: { fontSize: 7 }, margin: { left: 14, right: 14 } });
    }
    doc.save(`${reportData.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const exportExcel = () => {
    if (!reportData) return;
    const wb = XLSX.utils.book_new();
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
          <p className="text-sm text-slate-500">12 business intelligence reports</p>
        </div>

        {/* Filters */}
        <Card className="border-slate-200 mb-5" data-testid="filters-card">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          </CardContent>
        </Card>

        {/* Report Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6" data-testid="report-cards">
          {REPORTS.map(r => (
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
                <CardTitle className="font-['Outfit'] text-lg">{reportData.title}</CardTitle>
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
                    <SummaryCard key={k} label={formatHeader(k)} value={typeof v === 'number' && v > 999 ? `₹${v.toLocaleString('en-IN')}` : v} />
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
                        <div key={item.name} className="flex items-center gap-3">
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
            <p className="text-sm text-slate-400">Choose from 8 consolidated business intelligence reports</p>
          </div>
        )}
      </div>
    </div>
  );
}
