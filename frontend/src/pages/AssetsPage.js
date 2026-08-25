import { useState, useEffect, useCallback } from 'react';
import { assetsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Loader2, Plus, Wrench, Search, AlertTriangle, QrCode, FileText, FileSpreadsheet, ArrowLeftRight, History } from 'lucide-react';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const CATEGORIES = ['vehicle', 'power_tool', 'hand_tool', 'test_equipment', 'safety', 'it', 'furniture', 'other'];
const STATUS_STYLES = {
  available: 'bg-emerald-100 text-emerald-700', issued: 'bg-blue-100 text-blue-700',
  in_maintenance: 'bg-amber-100 text-amber-700', under_repair: 'bg-orange-100 text-orange-700',
  lost: 'bg-rose-100 text-rose-700', scrapped: 'bg-slate-200 text-slate-600', sold: 'bg-slate-200 text-slate-600',
};
const REPORTS = [
  { id: 'register', label: 'Asset Register' }, { id: 'issue_log', label: 'Issue / Return Log' },
  { id: 'maintenance', label: 'Maintenance History' }, { id: 'compliance', label: 'Compliance Status' },
  { id: 'utilisation', label: 'Utilisation Report' }, { id: 'depreciation', label: 'Depreciation Schedule' },
  { id: 'writeoff', label: 'Lost / Damaged / Scrapped' },
];

export default function AssetsPage() {
  const { user, isAdmin, isManager } = useAuth();
  const [assets, setAssets] = useState([]);
  const [compliance, setCompliance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showIssue, setShowIssue] = useState(null);
  const [showReturn, setShowReturn] = useState(null);
  const [showMaintenance, setShowMaintenance] = useState(null);
  const [showQr, setShowQr] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showDetail, setShowDetail] = useState(null);
  const [reportType, setReportType] = useState('register');
  const [reportData, setReportData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'power_tool', make: '', model: '', serial_number: '', purchase_date: '', purchase_cost: '', useful_life_years: 5, requires_calibration: false, calibration_interval_days: '', insurance_expiry: '', registration_expiry: '', fitness_certificate_expiry: '', pollution_certificate_expiry: '', notes: '' });
  const [issueForm, setIssueForm] = useState({ assigned_to_name: '', expected_return_date: '', condition_out: 'good' });
  const [returnForm, setReturnForm] = useState({ condition_in: 'good', notes: '' });
  const [maintenanceForm, setMaintenanceForm] = useState({ type: 'scheduled', date: '', description: '', cost: '', is_calibration: false, next_due: '' });

  const canManage = isAdmin || isManager;

  const fetchAssets = useCallback(async () => {
    try {
      const params = {};
      if (categoryFilter !== 'all') params.category = categoryFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (search) params.search = search;
      const r = await assetsAPI.list(params); setAssets(r.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [categoryFilter, statusFilter, search]);
  useEffect(() => { fetchAssets(); }, [fetchAssets]);
  useEffect(() => { assetsAPI.compliance(90).then(r => setCompliance(r.data)).catch(() => {}); }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await assetsAPI.create({ ...form, purchase_cost: parseFloat(form.purchase_cost) || 0, calibration_interval_days: form.calibration_interval_days ? parseInt(form.calibration_interval_days) : null });
      setShowCreate(false);
      setForm({ name: '', category: 'power_tool', make: '', model: '', serial_number: '', purchase_date: '', purchase_cost: '', useful_life_years: 5, requires_calibration: false, calibration_interval_days: '', insurance_expiry: '', registration_expiry: '', fitness_certificate_expiry: '', pollution_certificate_expiry: '', notes: '' });
      await fetchAssets();
    } catch (e) { console.error(e); } finally { setSaving(false); }
  };

  const handleIssue = async () => {
    setSaving(true);
    try {
      await assetsAPI.issue(showIssue.id, { ...issueForm, assigned_to: issueForm.assigned_to_name });
      setShowIssue(null); await fetchAssets();
    } catch (e) { alert(e.response?.data?.detail || 'Could not issue asset'); } finally { setSaving(false); }
  };

  const handleReturn = async () => {
    setSaving(true);
    try { await assetsAPI.returnAsset(showReturn.id, returnForm); setShowReturn(null); await fetchAssets(); }
    catch (e) { alert(e.response?.data?.detail || 'Could not return asset'); } finally { setSaving(false); }
  };

  const handleMaintenance = async () => {
    setSaving(true);
    try {
      await assetsAPI.logMaintenance(showMaintenance.id, { ...maintenanceForm, cost: parseFloat(maintenanceForm.cost) || 0 });
      setShowMaintenance(null); await fetchAssets();
    } catch (e) { alert('Could not log maintenance'); } finally { setSaving(false); }
  };

  const openQr = async (asset) => {
    setShowQr(asset);
    try { setQrDataUrl(await QRCode.toDataURL(`ASSET:${asset.asset_code}`, { width: 220, margin: 1 })); } catch (e) { setQrDataUrl(''); }
  };

  const openDetail = async (asset) => {
    try { const r = await assetsAPI.get(asset.id); setShowDetail(r.data); } catch (e) { console.error(e); }
  };

  const fetchReport = async (type) => {
    setReportType(type); setReportData(null);
    try { const r = await assetsAPI.report(type); setReportData(r.data); } catch (e) { console.error(e); }
  };
  useEffect(() => { fetchReport('register'); }, []);

  const exportReportPDF = () => {
    if (!reportData) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(16); doc.text(reportData.title, 14, 16);
    const cols = reportData.rows?.length ? Object.keys(reportData.rows[0]) : [];
    autoTable(doc, { startY: 24, head: [cols], body: reportData.rows.map(r => cols.map(c => r[c])), theme: 'striped', headStyles: { fillColor: [16, 185, 129] } });
    doc.save(`${reportData.title.replace(/\s+/g, '_')}.pdf`);
  };
  const exportReportExcel = () => {
    if (!reportData?.rows?.length) return;
    const ws = XLSX.utils.json_to_sheet(reportData.rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${reportData.title.replace(/\s+/g, '_')}.xlsx`);
  };

  return (
    <div className="py-6 px-4">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="assets-title"><Wrench className="inline h-6 w-6 mr-2 text-emerald-600" />Assets &amp; Tools</h1>
            <p className="text-sm text-slate-500">Vehicles, tools, test equipment and safety gear register</p>
          </div>
          {canManage && <Button onClick={() => setShowCreate(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="add-asset-btn"><Plus className="h-4 w-4" />Add Asset</Button>}
        </div>

        {/* Compliance banner */}
        {compliance?.count > 0 && (
          <Card className="border-rose-200 bg-rose-50/50" data-testid="compliance-banner">
            <CardHeader className="py-3"><CardTitle className="text-sm text-rose-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{compliance.count} compliance item(s) expiring within 90 days</CardTitle></CardHeader>
            <CardContent className="pt-0 pb-3 space-y-1">
              {compliance.items.slice(0, 6).map((it, i) => (
                <p key={i} className="text-xs text-rose-700">{it.name} ({it.asset_code}) — {it.field.replace(/_/g, ' ')} expires {it.expiry_date} {it.days_left != null && `(${it.days_left}d)`}</p>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card className="border-slate-200"><CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input placeholder="Search assets…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" data-testid="asset-search" /></div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}><SelectTrigger className="h-9" data-testid="asset-category-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Categories</SelectItem>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}</SelectContent></Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="h-9" data-testid="asset-status-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem>{Object.keys(STATUS_STYLES).map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent></Select>
        </CardContent></Card>

        {/* Register */}
        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="assets-grid">
            {assets.map(a => (
              <Card key={a.id} className="border-slate-200" data-testid={`asset-card-${a.id}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate cursor-pointer hover:underline" onClick={() => openDetail(a)}>{a.name}</p>
                      <p className="text-[11px] text-slate-400">{a.asset_code} · {a.category.replace(/_/g, ' ')}</p>
                    </div>
                    <Badge className={STATUS_STYLES[a.status] || ''}>{a.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">Book value: ₹{(a.current_book_value || 0).toLocaleString('en-IN')}</p>
                  {a.assigned_to_name && <p className="text-xs text-blue-600">With: {a.assigned_to_name}</p>}
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {canManage && a.status === 'available' && <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => { setShowIssue(a); setIssueForm({ assigned_to_name: '', expected_return_date: '', condition_out: 'good' }); }} data-testid={`issue-asset-${a.id}`}><ArrowLeftRight className="h-3 w-3" />Issue</Button>}
                    {canManage && a.status === 'issued' && <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => { setShowReturn(a); setReturnForm({ condition_in: 'good', notes: '' }); }} data-testid={`return-asset-${a.id}`}>Return</Button>}
                    {canManage && <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => { setShowMaintenance(a); setMaintenanceForm({ type: 'scheduled', date: new Date().toISOString().slice(0, 10), description: '', cost: '', is_calibration: false, next_due: '' }); }} data-testid={`maintenance-asset-${a.id}`}><Wrench className="h-3 w-3" />Log Service</Button>}
                    <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => openQr(a)} data-testid={`qr-asset-${a.id}`}><QrCode className="h-3 w-3" />QR</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {assets.length === 0 && <p className="text-sm text-slate-400 col-span-full text-center py-8">No assets found</p>}
          </div>
        )}

        {/* Reports */}
        {canManage && (
          <Card className="border-slate-200" data-testid="assets-reports-card">
            <CardHeader className="border-b py-3"><CardTitle className="text-base font-['Outfit']">Reports</CardTitle></CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-2 flex-wrap">
                {REPORTS.map(r => (
                  <button key={r.id} onClick={() => fetchReport(r.id)} className={`px-3 py-1.5 text-xs rounded-full border ${reportType === r.id ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium' : 'bg-white border-slate-200 text-slate-600'}`} data-testid={`asset-report-${r.id}`}>{r.label}</button>
                ))}
              </div>
              {reportData && (
                <>
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <div className="flex gap-3 text-xs text-slate-600">
                      {Object.entries(reportData.summary || {}).map(([k, v]) => <span key={k}><strong>{typeof v === 'number' ? v.toLocaleString('en-IN') : v}</strong> {k.replace(/_/g, ' ')}</span>)}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportReportPDF}><FileText className="h-3 w-3" />PDF</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportReportExcel}><FileSpreadsheet className="h-3 w-3" />Excel</Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto border rounded-lg max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0"><tr>{reportData.rows?.[0] && Object.keys(reportData.rows[0]).map(c => <th key={c} className="text-left p-2 capitalize">{c.replace(/_/g, ' ')}</th>)}</tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {reportData.rows?.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="p-2">{typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? '')}</td>)}</tr>)}
                      </tbody>
                    </table>
                    {!reportData.rows?.length && <p className="text-center py-6 text-slate-400 text-xs">No data yet</p>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="create-asset-dialog">
          <DialogHeader><DialogTitle>Add Asset</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="h-9 col-span-2" data-testid="asset-name-input" />
            <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}><SelectTrigger className="h-9" data-testid="asset-category-input"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, ' ')}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="Make" value={form.make} onChange={e => setForm(p => ({ ...p, make: e.target.value }))} className="h-9" />
            <Input placeholder="Model" value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} className="h-9" />
            <Input placeholder="Serial Number" value={form.serial_number} onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))} className="h-9" />
            <Input type="date" placeholder="Purchase Date" value={form.purchase_date} onChange={e => setForm(p => ({ ...p, purchase_date: e.target.value }))} className="h-9" />
            <Input type="number" placeholder="Purchase Cost (₹)" value={form.purchase_cost} onChange={e => setForm(p => ({ ...p, purchase_cost: e.target.value }))} className="h-9" data-testid="asset-cost-input" />
            <Input type="number" placeholder="Useful Life (years)" value={form.useful_life_years} onChange={e => setForm(p => ({ ...p, useful_life_years: e.target.value }))} className="h-9" />
            <label className="flex items-center gap-2 text-xs col-span-2"><input type="checkbox" checked={form.requires_calibration} onChange={e => setForm(p => ({ ...p, requires_calibration: e.target.checked }))} />Requires periodic calibration</label>
            {form.requires_calibration && <Input type="number" placeholder="Calibration interval (days)" value={form.calibration_interval_days} onChange={e => setForm(p => ({ ...p, calibration_interval_days: e.target.value }))} className="h-9 col-span-2" />}
            <div className="col-span-2 text-[11px] text-slate-400 pt-1">Compliance dates (optional — for vehicles / calibrated equipment)</div>
            <Input type="date" placeholder="Insurance Expiry" value={form.insurance_expiry} onChange={e => setForm(p => ({ ...p, insurance_expiry: e.target.value }))} className="h-9" />
            <Input type="date" placeholder="Registration Expiry" value={form.registration_expiry} onChange={e => setForm(p => ({ ...p, registration_expiry: e.target.value }))} className="h-9" />
            <Input type="date" placeholder="Fitness Cert. Expiry" value={form.fitness_certificate_expiry} onChange={e => setForm(p => ({ ...p, fitness_certificate_expiry: e.target.value }))} className="h-9" />
            <Input type="date" placeholder="Pollution Cert. Expiry" value={form.pollution_certificate_expiry} onChange={e => setForm(p => ({ ...p, pollution_certificate_expiry: e.target.value }))} className="h-9" />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={handleCreate} disabled={saving || !form.name} className="bg-emerald-600 text-white" data-testid="save-asset-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue Dialog */}
      <Dialog open={!!showIssue} onOpenChange={v => !v && setShowIssue(null)}>
        <DialogContent data-testid="issue-asset-dialog">
          <DialogHeader><DialogTitle>Issue Asset — {showIssue?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input placeholder="Issued to (name)" value={issueForm.assigned_to_name} onChange={e => setIssueForm(p => ({ ...p, assigned_to_name: e.target.value }))} className="h-9" data-testid="issue-to-input" />
            <Input type="date" placeholder="Expected return" value={issueForm.expected_return_date} onChange={e => setIssueForm(p => ({ ...p, expected_return_date: e.target.value }))} className="h-9" />
            <Select value={issueForm.condition_out} onValueChange={v => setIssueForm(p => ({ ...p, condition_out: v }))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New</SelectItem><SelectItem value="good">Good</SelectItem><SelectItem value="fair">Fair</SelectItem><SelectItem value="poor">Poor</SelectItem></SelectContent></Select>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowIssue(null)}>Cancel</Button><Button onClick={handleIssue} disabled={saving || !issueForm.assigned_to_name} className="bg-blue-600 text-white" data-testid="confirm-issue-btn">Issue</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return Dialog */}
      <Dialog open={!!showReturn} onOpenChange={v => !v && setShowReturn(null)}>
        <DialogContent data-testid="return-asset-dialog">
          <DialogHeader><DialogTitle>Return Asset — {showReturn?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Select value={returnForm.condition_in} onValueChange={v => setReturnForm(p => ({ ...p, condition_in: v }))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="good">Good</SelectItem><SelectItem value="fair">Fair</SelectItem><SelectItem value="poor">Poor</SelectItem><SelectItem value="unserviceable">Unserviceable</SelectItem></SelectContent></Select>
            <Textarea placeholder="Notes (optional)" value={returnForm.notes} onChange={e => setReturnForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowReturn(null)}>Cancel</Button><Button onClick={handleReturn} disabled={saving} className="bg-emerald-600 text-white" data-testid="confirm-return-btn">Return</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maintenance Dialog */}
      <Dialog open={!!showMaintenance} onOpenChange={v => !v && setShowMaintenance(null)}>
        <DialogContent data-testid="maintenance-dialog">
          <DialogHeader><DialogTitle>Log Maintenance — {showMaintenance?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Select value={maintenanceForm.type} onValueChange={v => setMaintenanceForm(p => ({ ...p, type: v }))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="breakdown">Breakdown</SelectItem><SelectItem value="calibration">Calibration</SelectItem></SelectContent></Select>
            <Input type="date" value={maintenanceForm.date} onChange={e => setMaintenanceForm(p => ({ ...p, date: e.target.value }))} className="h-9" />
            <Textarea placeholder="What was done" value={maintenanceForm.description} onChange={e => setMaintenanceForm(p => ({ ...p, description: e.target.value }))} />
            <Input type="number" placeholder="Cost (₹)" value={maintenanceForm.cost} onChange={e => setMaintenanceForm(p => ({ ...p, cost: e.target.value }))} className="h-9" />
            <Input type="date" placeholder="Next due" value={maintenanceForm.next_due} onChange={e => setMaintenanceForm(p => ({ ...p, next_due: e.target.value }))} className="h-9" />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={maintenanceForm.is_calibration} onChange={e => setMaintenanceForm(p => ({ ...p, is_calibration: e.target.checked }))} />This was a calibration</label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowMaintenance(null)}>Cancel</Button><Button onClick={handleMaintenance} disabled={saving} className="bg-emerald-600 text-white" data-testid="save-maintenance-btn">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Dialog */}
      <Dialog open={!!showQr} onOpenChange={v => !v && setShowQr(null)}>
        <DialogContent className="sm:max-w-xs text-center" data-testid="qr-dialog">
          <DialogHeader><DialogTitle>{showQr?.asset_code}</DialogTitle><DialogDescription>{showQr?.name}</DialogDescription></DialogHeader>
          {qrDataUrl && <img src={qrDataUrl} alt="Asset QR" className="mx-auto" />}
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!showDetail} onOpenChange={v => !v && setShowDetail(null)}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto" data-testid="asset-detail-dialog">
          <DialogHeader><DialogTitle>{showDetail?.name}</DialogTitle><DialogDescription>{showDetail?.asset_code}</DialogDescription></DialogHeader>
          {showDetail && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">Category: {showDetail.category?.replace(/_/g, ' ')} · Status: <Badge className={STATUS_STYLES[showDetail.status]}>{showDetail.status}</Badge></div>
              <p>Book value: ₹{(showDetail.current_book_value || 0).toLocaleString('en-IN')}</p>
              <div>
                <p className="text-xs font-semibold text-slate-500 flex items-center gap-1 mb-1"><History className="h-3.5 w-3.5" />Movement history</p>
                {(showDetail.movements || []).length === 0 && <p className="text-xs text-slate-400">No movements yet</p>}
                {(showDetail.movements || []).map((m, i) => <p key={i} className="text-xs text-slate-600">{m.date?.slice(0, 10)} — {m.action} {m.to_user ? `to ${m.to_user}` : ''}</p>)}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">Maintenance</p>
                {(showDetail.maintenance || []).length === 0 && <p className="text-xs text-slate-400">No maintenance logged</p>}
                {(showDetail.maintenance || []).map((m, i) => <p key={i} className="text-xs text-slate-600">{m.date?.slice(0, 10)} — {m.type}: {m.description} (₹{m.cost || 0})</p>)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
