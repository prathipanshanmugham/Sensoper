import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dailyUpdatesAPI, paymentsAPI, materialUsageAPI, projectsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import {
  Loader2, Save, Trash2, ClipboardList, IndianRupee, Package, Wrench, HardHat, Calendar, Megaphone, Receipt
} from 'lucide-react';

// Global (business-level) update types — not tied to a specific project
const GLOBAL_TYPES = [
  { id: 'leads', label: 'Leads Update', icon: Megaphone, color: 'pink' },
  { id: 'invoicing', label: 'Invoicing', icon: Receipt, color: 'indigo' }
];

// Project-scoped update types
const PROJECT_TYPES = [
  { id: 'progress', label: 'Project Progress', icon: ClipboardList, color: 'emerald' },
  { id: 'material', label: 'Material Usage', icon: Package, color: 'blue' },
  { id: 'payment', label: 'Payment', icon: IndianRupee, color: 'amber' },
  { id: 'installation', label: 'Installation', icon: HardHat, color: 'violet' },
  { id: 'om', label: 'O&M Service', icon: Wrench, color: 'teal' }
];

const ALL_TYPES = [...GLOBAL_TYPES, ...PROJECT_TYPES];

export default function DailyUpdatesPage() {
  const [searchParams] = useSearchParams();
  const preselectedProject = searchParams.get('project') || '';
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(preselectedProject);
  const [activeType, setActiveType] = useState('progress');
  const [updates, setUpdates] = useState([]);
  const [globalUpdates, setGlobalUpdates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [progressForm, setProgressForm] = useState({ work_done: '', completion_pct: '', issues: '' });
  const [materialForm, setMaterialForm] = useState({ item_name: '', estimated_qty: '', actual_qty: '', wastage: '', notes: '' });
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'upi', notes: '' });
  const [installForm, setInstallForm] = useState({ team: '', work_status: '', completion_date: '', notes: '' });
  const [omForm, setOmForm] = useState({ service: '', issues_resolved: '', notes: '' });
  const [leadsForm, setLeadsForm] = useState({ total_leads: '', qualified_leads: '', site_visits: '', quotes_sent: '', followups: '', conversions: '' });
  const [invoicingForm, setInvoicingForm] = useState({ invoices_generated: '', total_amount: '', payments_received: '', pending_invoices: '' });

  const fetchProjects = useCallback(async () => {
    try {
      const res = await projectsAPI.getAll();
      setProjects(res.data.filter(p => p.status !== 'draft'));
    } catch (err) { console.error(err); }
  }, []);

  const fetchUpdates = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const res = await dailyUpdatesAPI.getByProject(selectedProject);
      setUpdates(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [selectedProject]);

  const fetchGlobalUpdates = useCallback(async () => {
    try {
      const res = await dailyUpdatesAPI.getByProject('general');
      setGlobalUpdates(res.data);
    } catch (err) { /* silent */ }
  }, []);

  useEffect(() => { fetchProjects(); fetchGlobalUpdates(); }, [fetchProjects, fetchGlobalUpdates]);
  useEffect(() => { fetchUpdates(); }, [fetchUpdates]);

  const isGlobalType = (t) => GLOBAL_TYPES.some(g => g.id === t);

  const handleSave = async () => {
    const isGlobal = isGlobalType(activeType);
    if (!isGlobal && !selectedProject) { setError('Select a project first'); return; }
    setSaving(true);
    setError('');
    try {
      if (activeType === 'progress') {
        if (!progressForm.work_done) { setError('Work done is required'); setSaving(false); return; }
        await dailyUpdatesAPI.create({ project_id: selectedProject, update_type: 'progress', data: progressForm });
        setProgressForm({ work_done: '', completion_pct: '', issues: '' });
      } else if (activeType === 'material') {
        if (!materialForm.item_name || !materialForm.actual_qty) { setError('Item name and actual qty required'); setSaving(false); return; }
        await materialUsageAPI.create({ project_id: selectedProject, item_name: materialForm.item_name, estimated_qty: parseFloat(materialForm.estimated_qty) || 0, actual_qty: parseFloat(materialForm.actual_qty) || 0, wastage: parseFloat(materialForm.wastage) || 0, notes: materialForm.notes });
        await dailyUpdatesAPI.create({ project_id: selectedProject, update_type: 'material', data: materialForm });
        setMaterialForm({ item_name: '', estimated_qty: '', actual_qty: '', wastage: '', notes: '' });
      } else if (activeType === 'payment') {
        if (!paymentForm.amount) { setError('Amount required'); setSaving(false); return; }
        await paymentsAPI.create({ project_id: selectedProject, amount: parseFloat(paymentForm.amount), payment_method: paymentForm.payment_method, notes: paymentForm.notes });
        await dailyUpdatesAPI.create({ project_id: selectedProject, update_type: 'payment', data: paymentForm });
        setPaymentForm({ amount: '', payment_method: 'upi', notes: '' });
      } else if (activeType === 'installation') {
        if (!installForm.team) { setError('Team name required'); setSaving(false); return; }
        await dailyUpdatesAPI.create({ project_id: selectedProject, update_type: 'installation', data: installForm });
        setInstallForm({ team: '', work_status: '', completion_date: '', notes: '' });
      } else if (activeType === 'om') {
        if (!omForm.service) { setError('Service description required'); setSaving(false); return; }
        await dailyUpdatesAPI.create({ project_id: selectedProject, update_type: 'om', data: omForm });
        setOmForm({ service: '', issues_resolved: '', notes: '' });
      } else if (activeType === 'leads') {
        if (!leadsForm.total_leads) { setError('Total leads required'); setSaving(false); return; }
        await dailyUpdatesAPI.create({ project_id: 'general', update_type: 'leads', data: leadsForm });
        setLeadsForm({ total_leads: '', qualified_leads: '', site_visits: '', quotes_sent: '', followups: '', conversions: '' });
      } else if (activeType === 'invoicing') {
        if (!invoicingForm.invoices_generated) { setError('Invoice count required'); setSaving(false); return; }
        await dailyUpdatesAPI.create({ project_id: 'general', update_type: 'invoicing', data: invoicingForm });
        setInvoicingForm({ invoices_generated: '', total_amount: '', payments_received: '', pending_invoices: '' });
      }
      if (isGlobal) await fetchGlobalUpdates();
      else await fetchUpdates();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id, isGlobal = false) => {
    if (!window.confirm('Delete this update?')) return;
    try { await dailyUpdatesAPI.delete(id); if (isGlobal) await fetchGlobalUpdates(); else await fetchUpdates(); } catch (err) { console.error(err); }
  };

  const selectedProjectData = projects.find(p => p.id === selectedProject);
  const showProjectCtx = !isGlobalType(activeType);

  const renderForm = () => (
    <CardContent className="p-4 space-y-3">
      {activeType === 'progress' && (
        <>
          <div className="space-y-1"><Label className="text-xs">Work Completed Today *</Label><Textarea rows={2} value={progressForm.work_done} onChange={(e) => setProgressForm(p => ({...p, work_done: e.target.value}))} placeholder="Describe work done..." data-testid="progress-work" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">% Completion</Label><Input type="number" min="0" max="100" value={progressForm.completion_pct} onChange={(e) => setProgressForm(p => ({...p, completion_pct: e.target.value}))} placeholder="e.g., 45" data-testid="progress-pct" /></div>
            <div className="space-y-1"><Label className="text-xs">Issues Faced</Label><Input value={progressForm.issues} onChange={(e) => setProgressForm(p => ({...p, issues: e.target.value}))} placeholder="Any blockers..." data-testid="progress-issues" /></div>
          </div>
        </>
      )}
      {activeType === 'material' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Item Name *</Label><Input value={materialForm.item_name} onChange={(e) => setMaterialForm(p => ({...p, item_name: e.target.value}))} placeholder="e.g., Solar Panel 540W" data-testid="material-item" /></div>
            <div className="space-y-1"><Label className="text-xs">Estimated Qty</Label><Input type="number" value={materialForm.estimated_qty} onChange={(e) => setMaterialForm(p => ({...p, estimated_qty: e.target.value}))} placeholder="0" data-testid="material-est" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Actual Qty Used *</Label><Input type="number" value={materialForm.actual_qty} onChange={(e) => setMaterialForm(p => ({...p, actual_qty: e.target.value}))} placeholder="0" data-testid="material-actual" /></div>
            <div className="space-y-1"><Label className="text-xs">Wastage</Label><Input type="number" value={materialForm.wastage} onChange={(e) => setMaterialForm(p => ({...p, wastage: e.target.value}))} placeholder="0" data-testid="material-waste" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={materialForm.notes} onChange={(e) => setMaterialForm(p => ({...p, notes: e.target.value}))} placeholder="Additional notes..." data-testid="material-notes" /></div>
        </>
      )}
      {activeType === 'payment' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Amount Received (₹) *</Label><Input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm(p => ({...p, amount: e.target.value}))} placeholder="0" data-testid="payment-amount" /></div>
            <div className="space-y-1"><Label className="text-xs">Payment Method</Label>
              <Select value={paymentForm.payment_method} onValueChange={(v) => setPaymentForm(p => ({...p, payment_method: v}))}>
                <SelectTrigger className="h-9" data-testid="payment-method"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="cheque">Cheque</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="bank_transfer">Bank Transfer</SelectItem><SelectItem value="emi">EMI</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={paymentForm.notes} onChange={(e) => setPaymentForm(p => ({...p, notes: e.target.value}))} placeholder="Payment reference..." data-testid="payment-notes" /></div>
        </>
      )}
      {activeType === 'installation' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Team / Technician *</Label><Input value={installForm.team} onChange={(e) => setInstallForm(p => ({...p, team: e.target.value}))} placeholder="e.g., Team A" data-testid="install-team" /></div>
            <div className="space-y-1"><Label className="text-xs">Work Status</Label>
              <Select value={installForm.work_status} onValueChange={(v) => setInstallForm(p => ({...p, work_status: v}))}>
                <SelectTrigger className="h-9" data-testid="install-status"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="delayed">Delayed</SelectItem><SelectItem value="on_hold">On Hold</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Expected Completion</Label><Input type="date" value={installForm.completion_date} onChange={(e) => setInstallForm(p => ({...p, completion_date: e.target.value}))} data-testid="install-date" /></div>
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={installForm.notes} onChange={(e) => setInstallForm(p => ({...p, notes: e.target.value}))} placeholder="Additional info..." data-testid="install-notes" /></div>
          </div>
        </>
      )}
      {activeType === 'om' && (
        <>
          <div className="space-y-1"><Label className="text-xs">Service Performed *</Label><Textarea rows={2} value={omForm.service} onChange={(e) => setOmForm(p => ({...p, service: e.target.value}))} placeholder="Describe service..." data-testid="om-service" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Issues Resolved</Label><Input value={omForm.issues_resolved} onChange={(e) => setOmForm(p => ({...p, issues_resolved: e.target.value}))} placeholder="Issues fixed..." data-testid="om-issues" /></div>
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={omForm.notes} onChange={(e) => setOmForm(p => ({...p, notes: e.target.value}))} placeholder="Additional..." data-testid="om-notes" /></div>
          </div>
        </>
      )}
      {activeType === 'leads' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1"><Label className="text-xs">Total Leads *</Label><Input type="number" value={leadsForm.total_leads} onChange={(e) => setLeadsForm(p => ({...p, total_leads: e.target.value}))} className="h-9" data-testid="leads-total" /></div>
          <div className="space-y-1"><Label className="text-xs">Qualified Leads</Label><Input type="number" value={leadsForm.qualified_leads} onChange={(e) => setLeadsForm(p => ({...p, qualified_leads: e.target.value}))} className="h-9" data-testid="leads-qualified" /></div>
          <div className="space-y-1"><Label className="text-xs">Site Visits</Label><Input type="number" value={leadsForm.site_visits} onChange={(e) => setLeadsForm(p => ({...p, site_visits: e.target.value}))} className="h-9" data-testid="leads-visits" /></div>
          <div className="space-y-1"><Label className="text-xs">Quotes Sent</Label><Input type="number" value={leadsForm.quotes_sent} onChange={(e) => setLeadsForm(p => ({...p, quotes_sent: e.target.value}))} className="h-9" data-testid="leads-quotes" /></div>
          <div className="space-y-1"><Label className="text-xs">Follow-ups</Label><Input type="number" value={leadsForm.followups} onChange={(e) => setLeadsForm(p => ({...p, followups: e.target.value}))} className="h-9" data-testid="leads-followups" /></div>
          <div className="space-y-1"><Label className="text-xs">Conversions</Label><Input type="number" value={leadsForm.conversions} onChange={(e) => setLeadsForm(p => ({...p, conversions: e.target.value}))} className="h-9" data-testid="leads-conversions" /></div>
        </div>
      )}
      {activeType === 'invoicing' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1"><Label className="text-xs">Invoices Generated *</Label><Input type="number" value={invoicingForm.invoices_generated} onChange={(e) => setInvoicingForm(p => ({...p, invoices_generated: e.target.value}))} className="h-9" data-testid="inv-count" /></div>
          <div className="space-y-1"><Label className="text-xs">Total Amount (₹)</Label><Input type="number" value={invoicingForm.total_amount} onChange={(e) => setInvoicingForm(p => ({...p, total_amount: e.target.value}))} className="h-9" data-testid="inv-amount" /></div>
          <div className="space-y-1"><Label className="text-xs">Payments Received (₹)</Label><Input type="number" value={invoicingForm.payments_received} onChange={(e) => setInvoicingForm(p => ({...p, payments_received: e.target.value}))} className="h-9" data-testid="inv-received" /></div>
          <div className="space-y-1"><Label className="text-xs">Pending Invoices</Label><Input type="number" value={invoicingForm.pending_invoices} onChange={(e) => setInvoicingForm(p => ({...p, pending_invoices: e.target.value}))} className="h-9" data-testid="inv-pending" /></div>
        </div>
      )}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="save-update-btn">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save Update
        </Button>
      </div>
    </CardContent>
  );

  const renderUpdateRow = (u, isGlobal = false) => {
    const typeInfo = ALL_TYPES.find(t => t.id === u.update_type) || ALL_TYPES[0];
    return (
      <div key={u.id} className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50" data-testid={`update-${u.id}`}>
        <typeInfo.icon className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">{typeInfo.label}</Badge>
            <span className="text-[10px] text-slate-400">{new Date(u.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            <span className="text-[10px] text-slate-400">by {u.created_by_name}</span>
          </div>
          <div className="mt-1 text-sm text-slate-700">
            {u.update_type === 'progress' && <span>{u.data?.work_done}{u.data?.completion_pct ? ` (${u.data.completion_pct}% done)` : ''}</span>}
            {u.update_type === 'material' && <span>{u.data?.item_name}: Est {u.data?.estimated_qty} / Actual {u.data?.actual_qty}</span>}
            {u.update_type === 'payment' && <span>₹{parseFloat(u.data?.amount || 0).toLocaleString('en-IN')} via {u.data?.payment_method}</span>}
            {u.update_type === 'installation' && <span>Team: {u.data?.team} — {u.data?.work_status}</span>}
            {u.update_type === 'om' && <span>{u.data?.service}</span>}
            {u.update_type === 'leads' && <span>Leads: {u.data?.total_leads} total, {u.data?.qualified_leads} qualified, {u.data?.conversions} converted</span>}
            {u.update_type === 'invoicing' && <span>Invoices: {u.data?.invoices_generated} generated, ₹{parseFloat(u.data?.total_amount || 0).toLocaleString('en-IN')}</span>}
          </div>
          {u.data?.notes && <p className="text-xs text-slate-400 mt-0.5">{u.data.notes}</p>}
          {u.data?.issues && <p className="text-xs text-red-400 mt-0.5">Issues: {u.data.issues}</p>}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 shrink-0" onClick={() => handleDelete(u.id, isGlobal)} data-testid={`delete-update-${u.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    );
  };

  return (
    <div className="py-6 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="daily-updates-title">Daily Data Updates</h1>
          <p className="text-sm text-slate-500">Log daily progress, materials, payments, leads and invoicing</p>
        </div>

        {error && <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="error-msg">{error}</div>}

        {/* Tab selector (visible always) */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1" data-testid="update-type-tabs">
          {ALL_TYPES.map(ut => (
            <button key={ut.id} onClick={() => setActiveType(ut.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border whitespace-nowrap text-sm transition-all ${activeType === ut.id ? 'border-emerald-400 bg-emerald-50 text-emerald-800 font-medium' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              data-testid={`tab-${ut.id}`}>
              <ut.icon className="h-4 w-4" />{ut.label}
              {GLOBAL_TYPES.some(g => g.id === ut.id) && <Badge variant="outline" className="ml-1 text-[9px] border-pink-200 bg-pink-50 text-pink-700">Global</Badge>}
            </button>
          ))}
        </div>

        {/* Global forms (Leads / Invoicing) — independent of project */}
        {!showProjectCtx && (
          <>
            <Card className="border-pink-200 mb-6" data-testid="global-update-form">
              <CardHeader className="py-3 border-b border-pink-100 bg-pink-50/40">
                <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Calendar className="h-4 w-4" />Daily {ALL_TYPES.find(u => u.id === activeType)?.label} <span className="text-xs font-normal text-pink-700">(business-wide, not tied to a project)</span></CardTitle>
              </CardHeader>
              {renderForm()}
            </Card>

            <Card className="border-slate-200" data-testid="global-update-history">
              <CardHeader className="py-3 border-b border-slate-200">
                <CardTitle className="text-base font-['Outfit']">Business History ({globalUpdates.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {globalUpdates.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No business-level updates yet.</p> :
                <div className="space-y-2">{globalUpdates.map(u => renderUpdateRow(u, true))}</div>}
              </CardContent>
            </Card>
          </>
        )}

        {/* Project-scoped updates */}
        {showProjectCtx && (
          <>
            <Card className="border-slate-200 mb-6" data-testid="project-selector">
              <CardContent className="p-4">
                <div className="flex items-end gap-4">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs font-medium">Select Project</Label>
                    <Select value={selectedProject} onValueChange={setSelectedProject}>
                      <SelectTrigger className="h-11" data-testid="select-project"><SelectValue placeholder="Choose a project..." /></SelectTrigger>
                      <SelectContent>
                        {projects.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.customer?.name || 'Unnamed'} — {p.reference_number || p.id.slice(-6)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedProjectData && (
                    <Badge variant="outline" className="h-11 px-4 flex items-center gap-2">
                      <span className="capitalize">{selectedProjectData.status}</span>
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {selectedProject && (
              <>
                <Card className="border-slate-200 mb-6" data-testid="update-form">
                  <CardHeader className="py-3 border-b border-slate-200">
                    <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Calendar className="h-4 w-4" />New {ALL_TYPES.find(u => u.id === activeType)?.label} Update</CardTitle>
                  </CardHeader>
                  {renderForm()}
                </Card>

                <Card className="border-slate-200" data-testid="update-history">
                  <CardHeader className="py-3 border-b border-slate-200">
                    <CardTitle className="text-base font-['Outfit']">Update History ({updates.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    {loading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div> :
                     updates.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No updates yet for this project.</p> :
                     <div className="space-y-2">{updates.map(u => renderUpdateRow(u, false))}</div>}
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
