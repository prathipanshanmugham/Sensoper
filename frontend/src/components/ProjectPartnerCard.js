import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { partnersAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Loader2, HardHat, Plus } from 'lucide-react';

const ASSIGN_STATUS_COLORS = { assigned: 'bg-blue-100 text-blue-800', in_progress: 'bg-amber-100 text-amber-800', completed: 'bg-emerald-100 text-emerald-800', payment_pending: 'bg-orange-100 text-orange-800', closed: 'bg-slate-100 text-slate-600' };

/** Inline "Assign Partner" card on Project Details — reuses the same rate-card /
 * scope-hint flow as PartnerDetail.js, just with the project fixed and the partner picked here. */
export default function ProjectPartnerCard({ projectId, canManage }) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const [partners, setPartners] = useState([]);
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [scopeHint, setScopeHint] = useState(null);
  const [form, setForm] = useState({ partner_id: '', expected_completion: '', activities: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try { const r = await partnersAPI.assignmentsByProject(projectId); setAssignments(r.data); }
    catch (e) { console.error(e); } finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  const openAssign = async () => {
    setError(''); setForm({ partner_id: '', expected_completion: '', activities: [] }); setSelectedPartner(null);
    try {
      const [pRes, sRes] = await Promise.all([partnersAPI.list({ status: 'active' }), partnersAPI.projectScope(projectId)]);
      setPartners(pRes.data); setScopeHint(sRes.data);
    } catch (e) { console.error(e); }
    setShowAssign(true);
  };

  const handlePartnerPick = (partnerId) => {
    const p = partners.find(x => x.id === partnerId);
    setSelectedPartner(p);
    setForm(f => ({ ...f, partner_id: partnerId, activities: [] }));
  };

  const activityOptions = [...new Set((selectedPartner?.rate_card || []).map(r => r.activity))];
  const toggleActivity = (activity) => {
    setForm(f => {
      const exists = f.activities.find(a => a.activity === activity);
      if (exists) return { ...f, activities: f.activities.filter(a => a.activity !== activity) };
      let suggestedQty = '';
      if (scopeHint?.system_size_kw && /kw/i.test(activity)) suggestedQty = scopeHint.system_size_kw;
      else if (scopeHint?.structure_sqft && /sq\s?ft|structure/i.test(activity)) suggestedQty = scopeHint.structure_sqft;
      else if (scopeHint?.cable_length_m && /cable|meter/i.test(activity)) suggestedQty = scopeHint.cable_length_m;
      return { ...f, activities: [...f.activities, { activity, quantity: suggestedQty || 1 }] };
    });
  };
  const updateActivityQty = (activity, qty) => setForm(f => ({ ...f, activities: f.activities.map(a => a.activity === activity ? { ...a, quantity: qty } : a) }));

  const submitAssign = async () => {
    if (!form.partner_id || form.activities.length === 0) { setError('Pick a partner and at least one activity'); return; }
    setSaving(true); setError('');
    try {
      await partnersAPI.createAssignment(form.partner_id, {
        project_id: projectId, expected_completion: form.expected_completion,
        activities: form.activities.map(a => ({ activity: a.activity, quantity: parseFloat(a.quantity) || 0 })),
      });
      setShowAssign(false); fetchAssignments();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to create assignment'); } finally { setSaving(false); }
  };

  return (
    <Card className="border-slate-200" data-testid="project-partner-card">
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><HardHat className="h-5 w-5 text-emerald-600" />Labour &amp; Subcontractors</CardTitle>
        {canManage && <Button size="sm" onClick={openAssign} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-8" data-testid="project-assign-partner-btn"><Plus className="h-3.5 w-3.5" />Assign Partner</Button>}
      </CardHeader>
      <CardContent>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-emerald-600" /> : assignments.length === 0 ? (
          <p className="text-sm text-slate-500">No partner assigned to this project yet.</p>
        ) : (
          <div className="space-y-2" data-testid="project-partner-assignments-list">
            {assignments.map(a => (
              <div key={a.id} className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 text-sm" data-testid={`project-assignment-${a.id}`}>
                <div>
                  <Link to={`/dashboard/partners/${a.partner_id}`} className="font-medium text-slate-900 hover:text-emerald-700">{a.partner_name}</Link>
                  <p className="text-xs text-slate-500">₹{a.gross_amount.toLocaleString('en-IN')} gross &bull; ₹{a.balance_due.toLocaleString('en-IN')} balance due</p>
                </div>
                <Badge className={ASSIGN_STATUS_COLORS[a.status]}>{a.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Assign Partner to this Project</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="space-y-1"><Label>Partner</Label>
              <Select value={form.partner_id} onValueChange={handlePartnerPick}>
                <SelectTrigger data-testid="project-assign-partner-select"><SelectValue placeholder="Select partner" /></SelectTrigger>
                <SelectContent>{partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name} {p.partner_type === 'internal_team' ? '(Internal)' : ''}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {scopeHint && <p className="text-xs text-slate-500">Project scope: {scopeHint.system_size_kw ? `${scopeHint.system_size_kw} kW` : ''} {scopeHint.system_type || ''}</p>}
            <div className="space-y-1"><Label>Expected Completion</Label><Input type="date" value={form.expected_completion} onChange={e => setForm(f => ({ ...f, expected_completion: e.target.value }))} data-testid="project-assign-expected-completion" /></div>
            {selectedPartner && (
              <div className="space-y-2">
                <Label>Activities (from rate card)</Label>
                {activityOptions.length === 0 && <p className="text-xs text-amber-600">This partner has no rate card entries yet — add one from the Partners page first.</p>}
                {activityOptions.map(act => {
                  const picked = form.activities.find(a => a.activity === act);
                  return (
                    <div key={act} className="flex items-center gap-2">
                      <button type="button" onClick={() => toggleActivity(act)} className={`px-2 py-1 text-xs rounded border flex-1 text-left ${picked ? 'bg-emerald-100 border-emerald-300' : 'bg-white border-slate-200'}`} data-testid={`project-assign-activity-${act.replace(/\s+/g, '-')}`}>{act}</button>
                      {picked && <Input type="number" className="w-24 h-8" value={picked.quantity} onChange={e => updateActivityQty(act, e.target.value)} data-testid={`project-assign-qty-${act.replace(/\s+/g, '-')}`} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowAssign(false)}>Cancel</Button><Button onClick={submitAssign} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="project-assign-submit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Assignment'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
