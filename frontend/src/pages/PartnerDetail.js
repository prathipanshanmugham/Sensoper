import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { partnersAPI, projectsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Loader2, ArrowLeft, Star, Plus, ShieldCheck, Clock, Wallet } from 'lucide-react';

const STATUS_COLORS = { active: 'bg-emerald-100 text-emerald-800', inactive: 'bg-slate-100 text-slate-600', blacklisted: 'bg-red-100 text-red-800' };
const ASSIGN_STATUS_COLORS = { assigned: 'bg-blue-100 text-blue-800', in_progress: 'bg-amber-100 text-amber-800', completed: 'bg-emerald-100 text-emerald-800', payment_pending: 'bg-orange-100 text-orange-800', closed: 'bg-slate-100 text-slate-600' };

export default function PartnerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  const [partner, setPartner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('assignments');
  const [showAssign, setShowAssign] = useState(false);
  const [projects, setProjects] = useState([]);
  const [assignForm, setAssignForm] = useState({ project_id: '', expected_completion: '', activities: [] });
  const [scopeHint, setScopeHint] = useState(null);
  const [showRate, setShowRate] = useState(false);
  const [rateForm, setRateForm] = useState({ activity: '', unit: '', rate: '', effective_from: new Date().toISOString().slice(0, 10) });
  const [showPayment, setShowPayment] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', mode: 'bank_transfer', type: 'advance', reference: '', notes: '' });
  const [showQuality, setShowQuality] = useState(null);
  const [qualityForm, setQualityForm] = useState({ status: '', actual_completion: '', quality_rating: '', quality_notes: '', delay_reason: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchPartner = useCallback(async () => {
    try { const r = await partnersAPI.get(id); setPartner(r.data); } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { fetchPartner(); }, [fetchPartner]);

  const openAssign = async () => {
    setError('');
    setAssignForm({ project_id: '', expected_completion: '', activities: [] });
    setScopeHint(null);
    try { const r = await projectsAPI.getAll('approved'); setProjects(r.data.items || r.data || []); } catch (e) { console.error(e); }
    setShowAssign(true);
  };

  const handleProjectPick = async (projectId) => {
    setAssignForm(p => ({ ...p, project_id: projectId }));
    try { const r = await partnersAPI.projectScope(projectId); setScopeHint(r.data); } catch (e) { setScopeHint(null); }
  };

  const activityOptions = [...new Set((partner?.rate_card || []).map(r => r.activity))];
  const toggleActivity = (activity) => {
    setAssignForm(p => {
      const exists = p.activities.find(a => a.activity === activity);
      if (exists) return { ...p, activities: p.activities.filter(a => a.activity !== activity) };
      let suggestedQty = '';
      if (scopeHint?.system_size_kw && /kw/i.test(activity)) suggestedQty = scopeHint.system_size_kw;
      else if (scopeHint?.structure_sqft && /sq\s?ft|structure/i.test(activity)) suggestedQty = scopeHint.structure_sqft;
      else if (scopeHint?.cable_length_m && /cable|meter/i.test(activity)) suggestedQty = scopeHint.cable_length_m;
      return { ...p, activities: [...p.activities, { activity, quantity: suggestedQty || 1 }] };
    });
  };
  const updateActivityQty = (activity, qty) => setAssignForm(p => ({ ...p, activities: p.activities.map(a => a.activity === activity ? { ...a, quantity: qty } : a) }));

  const submitAssign = async () => {
    if (!assignForm.project_id || assignForm.activities.length === 0) { setError('Pick a project and at least one activity'); return; }
    setSaving(true); setError('');
    try {
      await partnersAPI.createAssignment(id, { ...assignForm, activities: assignForm.activities.map(a => ({ activity: a.activity, quantity: parseFloat(a.quantity) || 0 })) });
      setShowAssign(false); fetchPartner();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to create assignment'); } finally { setSaving(false); }
  };

  const submitRateCard = async () => {
    setSaving(true);
    try { await partnersAPI.addRateCard(id, { ...rateForm, rate: parseFloat(rateForm.rate) }); setShowRate(false); fetchPartner(); }
    catch (err) { setError(err.response?.data?.detail || 'Failed'); } finally { setSaving(false); }
  };

  const submitPayment = async () => {
    setSaving(true); setError('');
    try {
      await partnersAPI.recordPayment(id, { assignment_id: showPayment.id, amount: parseFloat(paymentForm.amount), mode: paymentForm.mode, type: paymentForm.type, reference: paymentForm.reference, notes: paymentForm.notes });
      setShowPayment(null); setPaymentForm({ amount: '', mode: 'bank_transfer', type: 'advance', reference: '', notes: '' }); fetchPartner();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to record payment'); } finally { setSaving(false); }
  };

  const submitQuality = async () => {
    setSaving(true); setError('');
    try {
      const payload = {};
      if (qualityForm.status) payload.status = qualityForm.status;
      if (qualityForm.actual_completion) payload.actual_completion = qualityForm.actual_completion;
      if (qualityForm.quality_rating) payload.quality_rating = parseFloat(qualityForm.quality_rating);
      if (qualityForm.quality_notes) payload.quality_notes = qualityForm.quality_notes;
      if (qualityForm.delay_reason) payload.delay_reason = qualityForm.delay_reason;
      await partnersAPI.updateAssignment(showQuality.id, payload);
      setShowQuality(null); fetchPartner();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to update'); } finally { setSaving(false); }
  };

  const handleReleaseRetention = async (assignmentId) => {
    try { await partnersAPI.releaseRetention(assignmentId); fetchPartner(); }
    catch (err) { alert(err.response?.data?.detail || 'Failed to release retention'); }
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  if (!partner) return <div className="p-6">Partner not found.</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="partner-detail-page">
      <Button variant="ghost" onClick={() => navigate('/dashboard/partners')} className="gap-1.5 mb-4 -ml-2"><ArrowLeft className="h-4 w-4" />Back to Partners</Button>

      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="partner-name">{partner.name}</h1>
            <Badge className={STATUS_COLORS[partner.status]}>{partner.status}</Badge>
            <span className="flex items-center gap-1 text-amber-600 text-sm"><Star className="h-4 w-4 fill-amber-400 text-amber-400" />{partner.rating || '—'}</span>
          </div>
          <p className="text-sm text-slate-500">{partner.partner_type === 'internal_team' ? 'Internal Team' : (partner.company_name || 'External Subcontractor')} • {(partner.specialities || []).join(', ')}</p>
        </div>
        {canManage && <Button onClick={openAssign} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="new-assignment-btn"><Plus className="h-4 w-4" />New Assignment</Button>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card className="border-slate-200"><CardContent className="p-3"><p className="text-xs text-slate-500 flex items-center gap-1"><Clock className="h-3 w-3" />On-time Rate</p><p className="text-lg font-bold" data-testid="partner-ontime-rate">{partner.scorecard?.on_time_rate != null ? `${partner.scorecard.on_time_rate}%` : '—'}</p></CardContent></Card>
        <Card className="border-slate-200"><CardContent className="p-3"><p className="text-xs text-slate-500 flex items-center gap-1"><Star className="h-3 w-3" />Avg Quality</p><p className="text-lg font-bold" data-testid="partner-avg-rating">{partner.scorecard?.avg_quality_rating ?? '—'}</p></CardContent></Card>
        <Card className="border-slate-200"><CardContent className="p-3"><p className="text-xs text-slate-500 flex items-center gap-1"><ShieldCheck className="h-3 w-3" />Active Jobs</p><p className="text-lg font-bold">{partner.scorecard?.active_jobs ?? 0}</p></CardContent></Card>
        <Card className="border-slate-200"><CardContent className="p-3"><p className="text-xs text-slate-500 flex items-center gap-1"><Wallet className="h-3 w-3" />Running Balance</p><p className="text-lg font-bold text-emerald-700" data-testid="partner-running-balance">₹{(partner.running_balance || 0).toLocaleString('en-IN')}</p></CardContent></Card>
      </div>

      <div className="flex gap-2 mb-4">
        {['assignments', 'rate_card', 'payments', 'profile'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-sm rounded-full border ${tab === t ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium' : 'bg-white border-slate-200 text-slate-600'}`} data-testid={`partner-tab-${t}`}>
            {t === 'rate_card' ? 'Rate Card' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'assignments' && (
        <div className="space-y-3" data-testid="partner-assignments-list">
          {(partner.assignments || []).length === 0 && <p className="text-slate-500 text-sm">No assignments yet.</p>}
          {(partner.assignments || []).map(a => (
            <Card key={a.id} className="border-slate-200" data-testid={`assignment-card-${a.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{a.project_name}</p>
                    <p className="text-xs text-slate-500">Assigned {a.assigned_date} • Expected {a.expected_completion || '—'} • Actual {a.actual_completion || '—'}{a.delay_days ? ` (${a.delay_days}d late)` : ''}</p>
                    <div className="flex gap-1.5 flex-wrap mt-1">{(a.activities || []).map((act, i) => <Badge key={i} variant="outline" className="text-[10px]">{act.activity} × {act.quantity} = ₹{act.amount.toLocaleString('en-IN')}</Badge>)}</div>
                  </div>
                  <Badge className={ASSIGN_STATUS_COLORS[a.status]}>{a.status}</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mt-3 pt-3 border-t">
                  <div><p className="text-slate-500 text-xs">Gross</p><p className="font-medium">₹{a.gross_amount.toLocaleString('en-IN')}</p></div>
                  <div><p className="text-slate-500 text-xs">Retention Held</p><p className="font-medium">₹{a.retention_held.toLocaleString('en-IN')} {a.retention_released && <span className="text-emerald-600 text-xs">(released)</span>}</p></div>
                  <div><p className="text-slate-500 text-xs">Advance Paid</p><p className="font-medium">₹{a.advance_paid.toLocaleString('en-IN')}</p></div>
                  <div><p className="text-slate-500 text-xs">Balance Due</p><p className="font-medium text-orange-600">₹{a.balance_due.toLocaleString('en-IN')}</p></div>
                </div>
                {canManage && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowQuality(a); setQualityForm({ status: a.status, actual_completion: a.actual_completion || '', quality_rating: a.quality_rating || '', quality_notes: a.quality_notes || '', delay_reason: a.delay_reason || '' }); }} data-testid={`update-status-${a.id}`}>Update Status / Rating</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowPayment(a)} data-testid={`record-payment-${a.id}`}>Record Payment</Button>
                    {!a.retention_released && a.retention_held > 0 && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-700 border-emerald-300" onClick={() => handleReleaseRetention(a.id)} data-testid={`release-retention-${a.id}`}>Release Retention</Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === 'rate_card' && (
        <Card className="border-slate-200" data-testid="partner-rate-card">
          <CardHeader className="py-3 flex-row items-center justify-between"><CardTitle className="text-sm font-['Outfit']">Rate Card (versioned)</CardTitle>{canManage && <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowRate(true)} data-testid="add-rate-card-btn"><Plus className="h-3 w-3" />Add Rate</Button>}</CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Activity</th><th>Unit</th><th>Rate</th><th>Effective From</th></tr></thead>
              <tbody>{(partner.rate_card || []).map((r, i) => <tr key={i} className="border-b last:border-0"><td className="py-2">{r.activity}</td><td>{r.unit}</td><td>₹{r.rate}</td><td>{r.effective_from}</td></tr>)}</tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === 'payments' && (
        <Card className="border-slate-200" data-testid="partner-payments-list">
          <CardContent className="pt-4">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Date</th><th>Type</th><th>Mode</th><th>Amount</th><th>Notes</th></tr></thead>
              <tbody>{(partner.payments || []).map(p => (
                <tr key={p.id} className="border-b last:border-0"><td className="py-2">{p.date}</td><td><Badge variant="outline">{p.type}</Badge></td><td>{p.mode}</td><td className="text-emerald-700 font-medium">₹{p.amount.toLocaleString('en-IN')}</td><td className="text-slate-500 text-xs">{p.notes}</td></tr>
              ))}</tbody>
            </table>
            {(partner.payments || []).length === 0 && <p className="text-slate-500 text-sm py-4">No payments recorded yet.</p>}
          </CardContent>
        </Card>
      )}

      {tab === 'profile' && (
        <Card className="border-slate-200"><CardContent className="p-5 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-slate-500 text-xs">Contact Person</p><p>{partner.contact_person || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Phone</p><p>{partner.phone || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Email</p><p>{partner.email || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">GSTIN</p><p>{partner.gstin || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Service Districts</p><p>{(partner.service_districts || []).join(', ') || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Retention %</p><p>{partner.retention_pct}%</p></div>
          <div><p className="text-slate-500 text-xs">Payment Terms</p><p>{partner.payment_terms || '—'}</p></div>
          <div><p className="text-slate-500 text-xs">Onboarded</p><p>{partner.onboarded_date}</p></div>
        </CardContent></Card>
      )}

      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Assign {partner.name} to a Project</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="space-y-1"><Label>Project</Label>
              <Select value={assignForm.project_id} onValueChange={handleProjectPick}>
                <SelectTrigger data-testid="assign-project-select"><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.customer?.name || p.id.slice(-6)} — {p.system_type || p.solar_system?.system_type}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {scopeHint && <p className="text-xs text-slate-500">Project scope: {scopeHint.system_size_kw ? `${scopeHint.system_size_kw} kW` : ''} {scopeHint.system_type || ''}</p>}
            <div className="space-y-1"><Label>Expected Completion</Label><Input type="date" value={assignForm.expected_completion} onChange={e => setAssignForm(p => ({ ...p, expected_completion: e.target.value }))} data-testid="assign-expected-completion" /></div>
            <div className="space-y-2">
              <Label>Activities (from rate card)</Label>
              {activityOptions.length === 0 && <p className="text-xs text-amber-600">This partner has no rate card entries yet — add one first.</p>}
              {activityOptions.map(act => {
                const picked = assignForm.activities.find(a => a.activity === act);
                return (
                  <div key={act} className="flex items-center gap-2">
                    <button type="button" onClick={() => toggleActivity(act)} className={`px-2 py-1 text-xs rounded border flex-1 text-left ${picked ? 'bg-emerald-100 border-emerald-300' : 'bg-white border-slate-200'}`} data-testid={`assign-activity-${act.replace(/\s+/g, '-')}`}>{act}</button>
                    {picked && <Input type="number" className="w-24 h-8" value={picked.quantity} onChange={e => updateActivityQty(act, e.target.value)} data-testid={`assign-qty-${act.replace(/\s+/g, '-')}`} />}
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowAssign(false)}>Cancel</Button><Button onClick={submitAssign} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="assign-submit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Assignment'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRate} onOpenChange={setShowRate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Rate Card Entry</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1"><Label>Activity</Label><Input value={rateForm.activity} onChange={e => setRateForm(p => ({ ...p, activity: e.target.value }))} data-testid="new-rate-activity" /></div>
            <div className="space-y-1"><Label>Unit</Label><Input value={rateForm.unit} onChange={e => setRateForm(p => ({ ...p, unit: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Rate ₹</Label><Input type="number" value={rateForm.rate} onChange={e => setRateForm(p => ({ ...p, rate: e.target.value }))} data-testid="new-rate-amount" /></div>
            <div className="space-y-1"><Label>Effective From</Label><Input type="date" value={rateForm.effective_from} onChange={e => setRateForm(p => ({ ...p, effective_from: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowRate(false)}>Cancel</Button><Button onClick={submitRateCard} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="new-rate-submit">Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showPayment} onOpenChange={() => setShowPayment(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment — {showPayment?.project_name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="space-y-1"><Label>Type</Label>
              <Select value={paymentForm.type} onValueChange={v => setPaymentForm(p => ({ ...p, type: v }))}>
                <SelectTrigger data-testid="payment-type-select"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="advance">Advance</SelectItem><SelectItem value="milestone">Milestone</SelectItem><SelectItem value="final">Final</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Amount ₹</Label><Input type="number" value={paymentForm.amount} onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))} data-testid="payment-amount-input" /></div>
            <div className="space-y-1"><Label>Mode</Label>
              <Select value={paymentForm.mode} onValueChange={v => setPaymentForm(p => ({ ...p, mode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="bank_transfer">Bank Transfer</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="cheque">Cheque</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Reference</Label><Input value={paymentForm.reference} onChange={e => setPaymentForm(p => ({ ...p, reference: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={paymentForm.notes} onChange={e => setPaymentForm(p => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowPayment(null)}>Cancel</Button><Button onClick={submitPayment} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="payment-submit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showQuality} onOpenChange={() => setShowQuality(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Assignment</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="space-y-1"><Label>Status</Label>
              <Select value={qualityForm.status} onValueChange={v => setQualityForm(p => ({ ...p, status: v }))}>
                <SelectTrigger data-testid="quality-status-select"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="assigned">Assigned</SelectItem><SelectItem value="in_progress">In Progress</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="payment_pending">Payment Pending</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Actual Completion</Label><Input type="date" value={qualityForm.actual_completion} onChange={e => setQualityForm(p => ({ ...p, actual_completion: e.target.value }))} data-testid="quality-actual-completion" /></div>
            <div className="space-y-1"><Label>Quality Rating (1-5)</Label><Input type="number" min="1" max="5" step="0.5" value={qualityForm.quality_rating} onChange={e => setQualityForm(p => ({ ...p, quality_rating: e.target.value }))} data-testid="quality-rating-input" /></div>
            <div className="space-y-1"><Label>Quality Notes</Label><Textarea rows={2} value={qualityForm.quality_notes} onChange={e => setQualityForm(p => ({ ...p, quality_notes: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Delay Reason (if any)</Label><Input value={qualityForm.delay_reason} onChange={e => setQualityForm(p => ({ ...p, delay_reason: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowQuality(null)}>Cancel</Button><Button onClick={submitQuality} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="quality-submit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
