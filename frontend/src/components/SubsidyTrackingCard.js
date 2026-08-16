import { useEffect, useState, useCallback } from 'react';
import { subsidyAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Loader2, IndianRupee, CheckCircle2, Clock, XCircle, FileCheck, Save } from 'lucide-react';

const STATUS_STEPS = [
  { key: 'eligible',       label: 'Eligible',       color: 'bg-slate-200 text-slate-700', border: 'border-slate-300', icon: CheckCircle2 },
  { key: 'applied',        label: 'Applied',        color: 'bg-blue-100 text-blue-700',    border: 'border-blue-300',  icon: FileCheck },
  { key: 'under_review',   label: 'Under Review',   color: 'bg-amber-100 text-amber-700',  border: 'border-amber-300', icon: Clock },
  { key: 'approved',       label: 'Approved',       color: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-300', icon: CheckCircle2 },
  { key: 'disbursed',      label: 'Disbursed',      color: 'bg-emerald-200 text-emerald-800', border: 'border-emerald-400', icon: IndianRupee },
];
const SCHEMES = [
  { value: 'pm_surya_ghar', label: 'PM Surya Ghar (Rooftop Residential)' },
  { value: 'pm_kusum_b',    label: 'PM-KUSUM Component B (Standalone Pump)' },
  { value: 'pm_kusum_c',    label: 'PM-KUSUM Component C (Feeder Solarisation)' },
  { value: 'state_scheme',  label: 'State Scheme' },
  { value: 'none',          label: 'Not Applicable' },
];
const stepIndex = (s) => STATUS_STEPS.findIndex(st => st.key === s);

export default function SubsidyTrackingCard({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await subsidyAPI.get(projectId);
      setData(r.data);
      setForm({
        scheme: r.data.scheme || 'pm_surya_ghar',
        status: r.data.status && r.data.status !== 'not_started' ? r.data.status : 'eligible',
        eligible_amount: r.data.eligible_amount || 0,
        claimed_amount: r.data.claimed_amount || 0,
        approved_amount: r.data.approved_amount || 0,
        disbursed_amount: r.data.disbursed_amount || 0,
        application_number: r.data.application_number || '',
        application_date: r.data.application_date || '',
        approval_date: r.data.approval_date || '',
        disbursement_date: r.data.disbursement_date || '',
        discom_inspection_date: r.data.discom_inspection_date || '',
        net_meter_installation_date: r.data.net_meter_installation_date || '',
        rejection_reason: r.data.rejection_reason || '',
        notes: r.data.notes || '',
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { project_id: projectId, ...form };
      // Blank strings → null so backend doesn't compute weird days_to_disburse
      ['application_date', 'approval_date', 'disbursement_date', 'discom_inspection_date', 'net_meter_installation_date'].forEach(k => {
        if (!payload[k]) delete payload[k];
      });
      await subsidyAPI.upsert(payload);
      setEditing(false);
      await load();
    } catch (e) { alert(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const advanceTo = async (newStatus) => {
    setSaving(true);
    try {
      const patch = { project_id: projectId, status: newStatus };
      const today = new Date().toISOString().slice(0, 10);
      if (newStatus === 'applied' && !form.application_date) patch.application_date = today;
      if (newStatus === 'approved' && !form.approval_date) patch.approval_date = today;
      if (newStatus === 'disbursed' && !form.disbursement_date) patch.disbursement_date = today;
      await subsidyAPI.upsert(patch);
      await load();
    } catch (e) { alert(e.response?.data?.detail || 'Failed'); }
    finally { setSaving(false); }
  };

  const reject = async () => {
    const reason = window.prompt('Rejection reason?');
    if (!reason) return;
    setSaving(true);
    try {
      await subsidyAPI.upsert({ project_id: projectId, status: 'rejected', rejection_reason: reason });
      await load();
    } catch (e) { alert('Failed'); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <Card className="border-emerald-200" data-testid="subsidy-card-loading">
      <CardContent className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></CardContent>
    </Card>
  );

  const current = data?.status && data.status !== 'not_started' ? data.status : 'eligible';
  const currentIdx = stepIndex(current);
  const isRejected = current === 'rejected';

  return (
    <Card className="border-emerald-200" data-testid="subsidy-card">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2">
          <IndianRupee className="h-5 w-5 text-emerald-600" />Subsidy Tracking
        </CardTitle>
        <div className="flex gap-2">
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-8" data-testid="subsidy-edit-btn">Edit Details</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Timeline */}
        {!isRejected ? (
          <div className="flex items-center gap-1 overflow-x-auto pb-2" data-testid="subsidy-timeline">
            {STATUS_STEPS.map((s, idx) => {
              const done = idx <= currentIdx;
              const isCurrent = idx === currentIdx;
              const Icon = s.icon;
              return (
                <div key={s.key} className="flex items-center gap-1 shrink-0">
                  <div
                    className={`flex flex-col items-center rounded-lg px-3 py-2 border-2 min-w-[110px] ${done ? s.color : 'bg-slate-50 text-slate-400'} ${isCurrent ? `${s.border} ring-2 ring-offset-1 ring-emerald-200` : 'border-transparent'}`}
                    data-testid={`subsidy-step-${s.key}`}
                  >
                    <Icon className="h-4 w-4 mb-0.5" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide">{s.label}</span>
                  </div>
                  {idx < STATUS_STEPS.length - 1 && (
                    <div className={`h-0.5 w-3 ${idx < currentIdx ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-center gap-2" data-testid="subsidy-rejected-banner">
            <XCircle className="h-4 w-4" />
            <span>Application rejected {data?.rejection_reason ? `— ${data.rejection_reason}` : ''}</span>
          </div>
        )}

        {/* Quick advance buttons (non-editing mode) */}
        {!editing && !isRejected && current !== 'disbursed' && (
          <div className="flex flex-wrap gap-2" data-testid="subsidy-quick-actions">
            {currentIdx < STATUS_STEPS.length - 1 && (
              <Button size="sm" onClick={() => advanceTo(STATUS_STEPS[currentIdx + 1].key)} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 gap-1.5" data-testid="subsidy-advance-btn">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Advance to {STATUS_STEPS[currentIdx + 1].label}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={reject} disabled={saving} className="h-8 gap-1.5 text-rose-700 border-rose-200 hover:bg-rose-50" data-testid="subsidy-reject-btn">
              <XCircle className="h-3.5 w-3.5" /> Mark Rejected
            </Button>
          </div>
        )}

        {/* Amounts + scheme summary (read-only) */}
        {!editing && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <p className="text-[10px] uppercase text-slate-500">Scheme</p>
              <p className="text-xs font-semibold text-slate-800 mt-0.5">{SCHEMES.find(s => s.value === (data?.scheme || 'pm_surya_ghar'))?.label.split(' (')[0] || data?.scheme || '—'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <p className="text-[10px] uppercase text-slate-500">Eligible</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">₹{(data?.eligible_amount || 0).toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <p className="text-[10px] uppercase text-slate-500">Approved</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">₹{(data?.approved_amount || 0).toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2.5">
              <p className="text-[10px] uppercase text-emerald-700">Disbursed</p>
              <p className="text-sm font-bold text-emerald-800 mt-0.5">₹{(data?.disbursed_amount || 0).toLocaleString('en-IN')}</p>
            </div>
          </div>
        )}

        {/* Dates strip */}
        {!editing && (data?.application_date || data?.approval_date || data?.disbursement_date) && (
          <div className="flex flex-wrap gap-3 text-xs pt-2 border-t border-slate-100" data-testid="subsidy-dates">
            {data.application_date && <Badge variant="outline" className="gap-1"><FileCheck className="h-3 w-3" />Applied {data.application_date}</Badge>}
            {data.approval_date && <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" />Approved {data.approval_date}</Badge>}
            {data.disbursement_date && <Badge variant="outline" className="gap-1"><IndianRupee className="h-3 w-3 text-emerald-600" />Disbursed {data.disbursement_date}</Badge>}
            {data.days_to_disburse != null && (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Cycle: {data.days_to_disburse} days</Badge>
            )}
            {data.application_number && <Badge variant="outline">App# {data.application_number}</Badge>}
          </div>
        )}

        {/* Edit form */}
        {editing && (
          <div className="space-y-3 pt-2 border-t border-slate-100" data-testid="subsidy-edit-form">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Scheme</Label>
                <Select value={form.scheme} onValueChange={(v) => setForm(p => ({ ...p, scheme: v }))}>
                  <SelectTrigger className="h-9" data-testid="subsidy-form-scheme"><SelectValue /></SelectTrigger>
                  <SelectContent>{SCHEMES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger className="h-9" data-testid="subsidy-form-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_STEPS.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Application #</Label>
                <Input value={form.application_number} onChange={(e) => setForm(p => ({ ...p, application_number: e.target.value }))} className="h-9" placeholder="MNRE/2026/..." data-testid="subsidy-form-appno" />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">Eligible ₹</Label><Input type="number" value={form.eligible_amount} onChange={(e) => setForm(p => ({ ...p, eligible_amount: parseFloat(e.target.value) || 0 }))} className="h-9" data-testid="subsidy-form-eligible" /></div>
              <div className="space-y-1"><Label className="text-xs">Claimed ₹</Label><Input type="number" value={form.claimed_amount} onChange={(e) => setForm(p => ({ ...p, claimed_amount: parseFloat(e.target.value) || 0 }))} className="h-9" data-testid="subsidy-form-claimed" /></div>
              <div className="space-y-1"><Label className="text-xs">Approved ₹</Label><Input type="number" value={form.approved_amount} onChange={(e) => setForm(p => ({ ...p, approved_amount: parseFloat(e.target.value) || 0 }))} className="h-9" data-testid="subsidy-form-approved" /></div>
              <div className="space-y-1"><Label className="text-xs">Disbursed ₹</Label><Input type="number" value={form.disbursed_amount} onChange={(e) => setForm(p => ({ ...p, disbursed_amount: parseFloat(e.target.value) || 0 }))} className="h-9" data-testid="subsidy-form-disbursed" /></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Application Date</Label><Input type="date" value={form.application_date} onChange={(e) => setForm(p => ({ ...p, application_date: e.target.value }))} className="h-9" data-testid="subsidy-form-appdate" /></div>
              <div className="space-y-1"><Label className="text-xs">Approval Date</Label><Input type="date" value={form.approval_date} onChange={(e) => setForm(p => ({ ...p, approval_date: e.target.value }))} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Disbursement Date</Label><Input type="date" value={form.disbursement_date} onChange={(e) => setForm(p => ({ ...p, disbursement_date: e.target.value }))} className="h-9" data-testid="subsidy-form-disbdate" /></div>
              <div className="space-y-1"><Label className="text-xs">DISCOM Inspection</Label><Input type="date" value={form.discom_inspection_date} onChange={(e) => setForm(p => ({ ...p, discom_inspection_date: e.target.value }))} className="h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Net Meter Installed</Label><Input type="date" value={form.net_meter_installation_date} onChange={(e) => setForm(p => ({ ...p, net_meter_installation_date: e.target.value }))} className="h-9" /></div>
            </div>
            {form.status === 'rejected' && (
              <div className="space-y-1"><Label className="text-xs">Rejection Reason</Label><Input value={form.rejection_reason} onChange={(e) => setForm(p => ({ ...p, rejection_reason: e.target.value }))} className="h-9" /></div>
            )}
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Textarea value={form.notes} rows={2} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} className="min-h-[60px]" data-testid="subsidy-form-notes" /></div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="subsidy-save-btn">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
              </Button>
            </div>
          </div>
        )}

        {data?.notes && !editing && (
          <p className="text-xs text-slate-600 italic pt-2 border-t border-slate-100" data-testid="subsidy-notes-display">{data.notes}</p>
        )}
      </CardContent>
    </Card>
  );
}
