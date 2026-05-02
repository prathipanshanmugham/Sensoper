import { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { reportsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import {
  ArrowLeft, Loader2, Download, FileSpreadsheet, FileText,
  BarChart3, DollarSign, Briefcase, Package, Zap, Wrench, Receipt, Users, Megaphone, Star,
  TrendingDown, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Trash2, Activity
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const REPORT_TYPES = [
  { id: 'sales', label: 'Sales', icon: DollarSign, color: 'emerald' },
  { id: 'profit', label: 'Profit', icon: BarChart3, color: 'blue' },
  { id: 'expense', label: 'Expense', icon: TrendingDown, color: 'red' },
  { id: 'execution', label: 'Execution', icon: Briefcase, color: 'violet' },
  { id: 'inventory', label: 'Inventory', icon: Package, color: 'amber' },
  { id: 'inbound', label: 'Inbound', icon: ArrowDownToLine, color: 'teal' },
  { id: 'outbound', label: 'Outbound', icon: ArrowUpFromLine, color: 'indigo' },
  { id: 'low_stock', label: 'Low Stock', icon: AlertTriangle, color: 'orange' },
  { id: 'excess', label: 'Excess Materials', icon: Package, color: 'cyan' },
  { id: 'scrap', label: 'Scrap', icon: Trash2, color: 'slate' },
  { id: 'price_fluctuation', label: 'Price Fluctuation', icon: Activity, color: 'pink' },
  { id: 'technical_om', label: 'Technical & O&M', icon: Zap, color: 'yellow' },
  { id: 'compliance', label: 'Compliance & Tax', icon: Receipt, color: 'red' },
  { id: 'hr', label: 'HR & Productivity', icon: Users, color: 'indigo' },
  { id: 'marketing', label: 'Marketing', icon: Megaphone, color: 'pink' },
  { id: 'customer', label: 'Customer Satisfaction', icon: Star, color: 'orange' }
];

function SummaryCard({ label, value }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 text-center" data-testid={`summary-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">{label}</p>
      <p className="text-lg font-bold text-slate-900">{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</p>
    </div>
  );
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeReport, setActiveReport] = useState(searchParams.get('type') || '');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ date_from: '', date_to: '', system_type: 'all', status: 'all' });

  const fetchReport = useCallback(async (type) => {
    setLoading(true);
    setReportData(null);
    try {
      const params = {};
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.system_type !== 'all') params.system_type = filters.system_type;
      if (filters.status !== 'all') params.status = filters.status;
      const res = await reportsAPI.get(type, params);
      setReportData(res.data);
    } catch (err) {
      console.error('Report fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const handleSelectReport = (type) => {
    setActiveReport(type);
    fetchReport(type);
  };

  const getColumns = () => {
    if (!reportData?.rows?.length) return [];
    return Object.keys(reportData.rows[0]).filter(k => k !== 'has_feedback');
  };

  const formatHeader = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const exportPDF = () => {
    if (!reportData) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(18);
    doc.setTextColor(16, 185, 129);
    doc.text('Sensoper Controls & Renewables', 14, 18);
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text(reportData.title, 14, 28);
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 14, 34);
    if (reportData.summary) {
      let y = 42;
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      Object.entries(reportData.summary).forEach(([k, v]) => {
        doc.text(`${formatHeader(k)}: ${typeof v === 'number' ? v.toLocaleString('en-IN') : v}`, 14, y);
        y += 6;
      });
    }
    const cols = getColumns();
    if (reportData.rows?.length) {
      autoTable(doc, {
        startY: 42 + (reportData.summary ? Object.keys(reportData.summary).length * 6 + 4 : 0),
        head: [cols.map(formatHeader)],
        body: reportData.rows.map(r => cols.map(c => {
          const v = r[c];
          return typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? '');
        })),
        theme: 'striped',
        headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 8 },
        bodyStyles: { fontSize: 7 },
        margin: { left: 14, right: 14 }
      });
    }
    doc.save(`${reportData.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const exportExcel = () => {
    if (!reportData) return;
    const wb = XLSX.utils.book_new();
    if (reportData.summary) {
      const summaryRows = Object.entries(reportData.summary).map(([k, v]) => ({ Metric: formatHeader(k), Value: v }));
      const ws1 = XLSX.utils.json_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
    }
    if (reportData.rows?.length) {
      const cols = getColumns();
      const formatted = reportData.rows.map(r => {
        const row = {};
        cols.forEach(c => { row[formatHeader(c)] = r[c]; });
        return row;
      });
      const ws2 = XLSX.utils.json_to_sheet(formatted);
      XLSX.utils.book_append_sheet(wb, ws2, 'Data');
    }
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${reportData.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1">
            <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="reports-title">Reports</h1>
            <p className="text-sm text-slate-500">Generate and export business reports</p>
          </div>
        </div>

        {/* Global Filters */}
        <Card className="border-slate-200 mb-6" data-testid="filters-card">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Date From</Label>
                <Input type="date" value={filters.date_from} onChange={(e) => setFilters(p => ({ ...p, date_from: e.target.value }))} className="h-9" data-testid="filter-date-from" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date To</Label>
                <Input type="date" value={filters.date_to} onChange={(e) => setFilters(p => ({ ...p, date_to: e.target.value }))} className="h-9" data-testid="filter-date-to" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">System Type</Label>
                <Select value={filters.system_type} onValueChange={(v) => setFilters(p => ({ ...p, system_type: v }))}>
                  <SelectTrigger className="h-9" data-testid="filter-system-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="on-grid">On-Grid</SelectItem>
                    <SelectItem value="off-grid">Off-Grid</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={filters.status} onValueChange={(v) => setFilters(p => ({ ...p, status: v }))}>
                  <SelectTrigger className="h-9" data-testid="filter-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Report Type Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6" data-testid="report-types">
          {REPORT_TYPES.map(rt => (
            <button key={rt.id} onClick={() => handleSelectReport(rt.id)}
              className={`p-3 rounded-xl border text-left transition-all ${activeReport === rt.id ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              data-testid={`report-btn-${rt.id}`}>
              <rt.icon className={`h-5 w-5 mb-1.5 ${activeReport === rt.id ? 'text-emerald-600' : 'text-slate-400'}`} />
              <p className={`text-xs font-medium ${activeReport === rt.id ? 'text-emerald-800' : 'text-slate-700'}`}>{rt.label}</p>
            </button>
          ))}
        </div>

        {/* Report Results */}
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
            </CardHeader>
            <CardContent className="p-4">
              {/* Summary Cards */}
              {reportData.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4" data-testid="report-summary">
                  {Object.entries(reportData.summary).map(([k, v]) => (
                    <SummaryCard key={k} label={formatHeader(k)} value={typeof v === 'number' && v > 999 ? `Rs ${v.toLocaleString('en-IN')}` : v} />
                  ))}
                </div>
              )}

              {/* Pie Chart Visualization */}
              {reportData.chart_data && reportData.chart_data.length > 0 && (
                <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200" data-testid="report-chart">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-2">Visual Breakdown</p>
                  <div className="flex items-center gap-6">
                    <ResponsiveContainer width="50%" height={200}>
                      <PieChart>
                        <Pie data={reportData.chart_data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`} labelLine={{ stroke: '#94a3b8' }} fontSize={11}>
                          {reportData.chart_data.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => [typeof v === 'number' && v > 999 ? v.toLocaleString('en-IN') : v, 'Value']} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1.5">
                      {reportData.chart_data.map((item, idx) => (
                        <div key={item.name} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                          <span className="text-xs text-slate-600 flex-1 truncate">{item.name}</span>
                          <span className="text-xs font-medium text-slate-900">{typeof item.value === 'number' && item.value > 999 ? item.value.toLocaleString('en-IN') : item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Data Table */}
              {reportData.rows?.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200" data-testid="report-table">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {getColumns().map(col => (
                          <th key={col} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">{formatHeader(col)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.rows.map((row, idx) => (
                        <tr key={row.ref || idx} className="border-b border-slate-100 hover:bg-slate-50">
                          {getColumns().map(col => (
                            <td key={col} className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                              {col === 'status' ? <Badge variant="outline" className="text-[10px]">{row[col]}</Badge> :
                               col === 'low_stock' ? (row[col] ? <Badge className="bg-red-100 text-red-700 text-[10px]">Low</Badge> : <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">OK</Badge>) :
                               typeof row[col] === 'number' && row[col] > 999 ? row[col].toLocaleString('en-IN') :
                               typeof row[col] === 'boolean' ? (row[col] ? 'Yes' : 'No') :
                               String(row[col] ?? '-')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-8">No data for this report with current filters.</p>
              )}
              <p className="text-xs text-slate-400 mt-3">{reportData.rows?.length || 0} records</p>
            </CardContent>
          </Card>
        )}

        {!activeReport && !loading && (
          <div className="text-center py-16">
            <Download className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-600 mb-2">Select a Report</h3>
            <p className="text-sm text-slate-400">Choose a report type above to generate data with filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
