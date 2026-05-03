import { useState, useEffect, useCallback } from 'react';
import { auditsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Loader2, Plus, X, Save, ClipboardCheck, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';

const CHECKLIST_DEFAULTS = ['Safety Compliance', 'Material Usage Accuracy', 'Installation Quality', 'Documentation Complete', 'Site Cleanliness'];

export default function WeeklyAuditPage() {
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showIssue, setShowIssue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ title: '', auditor_name: '', project_id: '', deadline: '', checklist: CHECKLIST_DEFAULTS.map(item => ({ item, status: 'pending', notes: '' })), notes: '' });
  const [issueForm, setIssueForm] = useState({ description: '', severity: 'medium', fix_deadline: '' });

  const fetch = useCallback(async () => {
    try { const res = await auditsAPI.list({ status: filter !== 'all' ? filter : undefined }); setAudits(res.data); }
    catch (err) { console.error(err); } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { fetch(); }, [fetch]);

  const updateChecklist = (i, k, v) => setForm(p => { const cl = [...p.checklist]; cl[i] = {...cl[i], [k]: v}; return {...p, checklist: cl}; });
  const addChecklistItem = () => setForm(p => ({...p, checklist: [...p.checklist, { item: '', status: 'pending', notes: '' }]}));
  const removeChecklistItem = (i) => setForm(p => ({...p, checklist: p.checklist.filter((_, idx) => idx !== i)}));

  const handleCreate = async () => {
    if (!form.title || !form.auditor_name) return;
    setSaving(true);
    try { await auditsAPI.create(form); setShowForm(false); setForm({ title: '', auditor_name: '', project_id: '', deadline: '', checklist: CHECKLIST_DEFAULTS.map(item => ({ item, status: 'pending', notes: '' })), notes: '' }); await fetch(); }
    catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const handleAddIssue = async () => {
    if (!issueForm.description || !showIssue) return;
    setSaving(true);
    try { await auditsAPI.addIssue(showIssue, issueForm); setShowIssue(null); setIssueForm({ description: '', severity: 'medium', fix_deadline: '' }); await fetch(); }
    catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const handleStatusChange = async (auditId, newStatus) => {
    try { await auditsAPI.update(auditId, { status: newStatus }); await fetch(); }
    catch (err) { console.error(err); }
  };

  const openAudits = audits.filter(a => a.status === 'open').length;
  const totalIssues = audits.reduce((s, a) => s + (a.issues?.length || 0), 0);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div><h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="audit-title">Weekly Audits</h1><p className="text-sm text-slate-500">Structured audit system with issue tracking</p></div>
          <Button onClick={() => setShowForm(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="new-audit-btn"><Plus className="h-4 w-4" />New Audit</Button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="border-blue-200 bg-blue-50"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-blue-700">{audits.length}</p><p className="text-xs text-blue-500">Total Audits</p></CardContent></Card>
          <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-700">{openAudits}</p><p className="text-xs text-amber-500">Open</p></CardContent></Card>
          <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-red-700">{totalIssues}</p><p className="text-xs text-red-500">Issues Found</p></CardContent></Card>
        </div>

        <div className="flex gap-2 mb-4">
          {['all', 'open', 'in_progress', 'resolved'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 text-xs rounded-full border ${filter === s ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium' : 'bg-white border-slate-200 text-slate-600'}`} data-testid={`audit-filter-${s}`}>{s === 'all' ? 'All' : s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</button>
          ))}
        </div>

        {showForm && (
          <Card className="border-emerald-200 mb-4" data-testid="audit-form">
            <CardHeader className="py-3"><CardTitle className="text-base">New Audit</CardTitle></CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1"><Label className="text-xs">Title *</Label><Input value={form.title} onChange={(e) => setForm(p => ({...p, title: e.target.value}))} placeholder="Weekly Audit #1" className="h-9" data-testid="audit-title-input" /></div>
                <div className="space-y-1"><Label className="text-xs">Auditor *</Label><Input value={form.auditor_name} onChange={(e) => setForm(p => ({...p, auditor_name: e.target.value}))} className="h-9" data-testid="audit-auditor" /></div>
                <div className="space-y-1"><Label className="text-xs">Deadline</Label><Input type="date" value={form.deadline} onChange={(e) => setForm(p => ({...p, deadline: e.target.value}))} className="h-9" data-testid="audit-deadline" /></div>
                <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={(e) => setForm(p => ({...p, notes: e.target.value}))} className="h-9" data-testid="audit-notes" /></div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Checklist</Label>
                {form.checklist.map((cl, i) => (
                  <div key={`cl-${i}`} className="grid grid-cols-4 gap-2 items-center">
                    <Input value={cl.item} onChange={(e) => updateChecklist(i, 'item', e.target.value)} placeholder="Check item" className="h-9 col-span-2" data-testid={`cl-item-${i}`} />
                    <select className="h-9 border rounded-md px-2 text-sm" value={cl.status} onChange={(e) => updateChecklist(i, 'status', e.target.value)} data-testid={`cl-status-${i}`}>
                      <option value="pending">Pending</option><option value="pass">Pass</option><option value="fail">Fail</option>
                    </select>
                    <Button variant="ghost" size="icon" className="h-9 text-red-400" onClick={() => removeChecklistItem(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addChecklistItem} className="h-8 text-xs"><Plus className="h-3.5 w-3.5 mr-1" />Add Check</Button>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={saving} className="bg-emerald-600 text-white" data-testid="save-audit-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Create Audit</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {showIssue && (
          <Card className="border-red-200 mb-4" data-testid="issue-form">
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-sm">Log Issue</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Description *</Label><Input value={issueForm.description} onChange={(e) => setIssueForm(p => ({...p, description: e.target.value}))} className="h-9" data-testid="issue-desc" /></div>
                <div className="space-y-1"><Label className="text-xs">Severity</Label>
                  <Select value={issueForm.severity} onValueChange={(v) => setIssueForm(p => ({...p, severity: v}))}><SelectTrigger className="h-9" data-testid="issue-severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select>
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowIssue(null)}><X className="h-4 w-4" /></Button>
                  <Button size="sm" onClick={handleAddIssue} disabled={saving} className="bg-red-600 text-white" data-testid="save-issue-btn"><AlertCircle className="h-4 w-4 mr-1" />Log</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3" data-testid="audit-list">
          {audits.map(a => (
            <Card key={a.id} className="border-slate-200" data-testid={`audit-${a.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <ClipboardCheck className="h-4 w-4 text-slate-400" />
                      <h3 className="font-semibold">{a.title}</h3>
                      <Badge className={`text-[10px] ${a.status === 'open' ? 'bg-amber-100 text-amber-700' : a.status === 'resolved' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{a.status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Auditor: {a.auditor_name} | {new Date(a.created_at).toLocaleDateString('en-IN')}{a.deadline ? ` | Deadline: ${a.deadline}` : ''}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowIssue(a.id)} data-testid={`add-issue-${a.id}`}><AlertCircle className="h-3 w-3 mr-1" />Issue</Button>
                    {a.status === 'open' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleStatusChange(a.id, 'in_progress')} data-testid={`start-${a.id}`}>Start</Button>}
                    {a.status === 'in_progress' && <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-600" onClick={() => handleStatusChange(a.id, 'resolved')} data-testid={`resolve-${a.id}`}><CheckCircle2 className="h-3 w-3 mr-1" />Resolve</Button>}
                  </div>
                </div>
                {a.checklist?.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-2">
                    {a.checklist.map((cl, i) => (
                      <span key={`${a.id}-cl-${i}`} className={`text-[10px] px-2 py-0.5 rounded-full ${cl.status === 'pass' ? 'bg-emerald-100 text-emerald-700' : cl.status === 'fail' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{cl.item}: {cl.status}</span>
                    ))}
                  </div>
                )}
                {a.issues?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {a.issues.map((issue, i) => (
                      <div key={`${a.id}-issue-${i}`} className="flex items-center gap-2 text-xs">
                        <AlertCircle className={`h-3 w-3 ${issue.severity === 'high' ? 'text-red-500' : issue.severity === 'medium' ? 'text-amber-500' : 'text-slate-400'}`} />
                        <span className="text-slate-700">{issue.description}</span>
                        <Badge variant="outline" className="text-[9px]">{issue.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {audits.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No audits found</p>}
        </div>
      </div>
    </div>
  );
}
