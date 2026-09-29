import { useState, useEffect, useCallback, useMemo } from 'react';
import { auditsAPI, usersAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Plus, CheckCircle2, AlertTriangle, Clock, FileDown, Undo2, X } from 'lucide-react';

/** Iter 57 — Weekly Audit rebuilt around the walk-through: one status board (open / overdue / resolved), a 4-field quick
 *  point entry (what · severity · owner · by when), reusable templates, PDF export in place. */
const SEV = [['low', 'Low', 'bg-slate-100 text-slate-700 border-slate-300'], ['medium', 'Medium', 'bg-amber-100 text-amber-800 border-amber-300'], ['high', 'High', 'bg-red-100 text-red-800 border-red-300']];
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function WeeklyAuditPage() {
  const { user, isAdmin, isManager } = useAuth();
  const [audits, setAudits] = useState([]);
  const [week, setWeek] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('open');
  const [p, setP] = useState({ description: '', severity: 'medium', owner_name: '', fix_deadline: plusDays(7) });
  const [newTpl, setNewTpl] = useState('');

  const load = useCallback(async () => {
    try {
      const [a, w, t] = await Promise.all([auditsAPI.list(), auditsAPI.thisWeek(), auditsAPI.templates()]);
      setAudits(a.data); setWeek(w.data); setTemplates(t.data.templates);
      if (isAdmin || isManager) usersAPI.getAll().then(r => setUsers(r.data || [])).catch(() => {});
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load audits'); }
    finally { setLoading(false); }
  }, [isAdmin, isManager]);
  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const points = useMemo(() => audits.flatMap(a => (a.issues || []).map((is, idx) => {
    const st = is.status === 'resolved' ? 'resolved' : (is.fix_deadline && is.fix_deadline < today ? 'overdue' : 'open');
    return { ...is, idx, audit_id: a.id, audit_title: a.title, st };
  })), [audits, today]);
  const counts = { open: points.filter(x => x.st === 'open').length, overdue: points.filter(x => x.st === 'overdue').length, resolved: points.filter(x => x.st === 'resolved').length };
  const shown = points.filter(x => view === 'all' ? true : x.st === view).sort((a, b) => (a.fix_deadline || '9').localeCompare(b.fix_deadline || '9'));

  const addPoint = async () => {
    if (!p.description.trim() || !week) return;
    setSaving(true);
    try { await auditsAPI.addIssue(week.id, { ...p, owner_name: p.owner_name || user?.name || '' }); setP(q => ({ ...q, description: '' })); toast.success('Point added'); await load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not add'); }
    finally { setSaving(false); }
  };
  const setStatus = async (pt, status) => { try { await auditsAPI.setPointStatus(pt.audit_id, pt.idx, status); await load(); } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); } };
  const saveTemplates = async (next) => { try { const r = await auditsAPI.saveTemplates(next); setTemplates(r.data.templates); } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); } };

  const exportPdf = async () => {
    const { default: jsPDF } = await import('jspdf'); const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF();
    doc.setFontSize(14); doc.text(`Weekly Audit — ${week?.title || ''}`, 14, 16);
    doc.setFontSize(9); doc.text(`Generated ${today} · Open ${counts.open} · Overdue ${counts.overdue} · Resolved ${counts.resolved}`, 14, 22);
    autoTable(doc, { startY: 27, head: [['#', 'Point', 'Severity', 'Owner', 'By when', 'Status', 'Week']], body: points.map((x, i) => [i + 1, x.description, x.severity, x.owner_name || '', x.fix_deadline || '', x.st, x.audit_title]), styles: { fontSize: 8 } });
    doc.save(`weekly-audit-${today}.pdf`);
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-4" data-testid="weekly-audit-page">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h1 className="text-2xl font-bold font-['Outfit']">Weekly Audit</h1><p className="text-sm text-slate-500">{week?.title} · auditor {week?.auditor_name}</p></div>
        <Button variant="outline" size="sm" onClick={exportPdf} className="gap-1" data-testid="audit-export-pdf"><FileDown className="h-4 w-4" />Export PDF</Button>
      </div>

      <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-3 space-y-2" data-testid="audit-quick-entry">
        <div className="flex flex-wrap gap-1.5" data-testid="audit-templates">
          {templates.map(t => <button key={t} type="button" onClick={() => setP(q => ({ ...q, description: t }))} className={`px-2.5 py-1.5 rounded-full border text-xs ${p.description === t ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300 text-slate-700'}`} data-testid={`audit-template-${t.split(':')[0].replace(/\s+/g, '-')}`}>{t}</button>)}
          {(isAdmin || isManager) && (
            <span className="inline-flex items-center gap-1"><Input value={newTpl} onChange={e => setNewTpl(e.target.value)} placeholder="+ template" className="h-7 w-36 text-xs" data-testid="audit-template-new" />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!newTpl.trim()} onClick={() => { saveTemplates([...templates, newTpl.trim()]); setNewTpl(''); }} data-testid="audit-template-add">Add</Button></span>
          )}
        </div>
        <Input value={p.description} onChange={e => setP(q => ({ ...q, description: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addPoint()} placeholder="What's wrong? (pick a template above or type)" className="h-12 text-base bg-white" data-testid="audit-point-desc" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">{SEV.map(([v, l, cls]) => <button key={v} type="button" onClick={() => setP(q => ({ ...q, severity: v }))} className={`px-3 py-2 rounded-full border text-xs font-medium ${p.severity === v ? cls + ' ring-2 ring-offset-1 ring-slate-400' : 'bg-white border-slate-200 text-slate-500'}`} data-testid={`audit-sev-${v}`}>{l}</button>)}</div>
          {users.length > 0 ? (
            <select value={p.owner_name} onChange={e => setP(q => ({ ...q, owner_name: e.target.value }))} className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm" data-testid="audit-owner"><option value="">Owner: me</option>{users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}</select>
          ) : <Input value={p.owner_name} onChange={e => setP(q => ({ ...q, owner_name: e.target.value }))} placeholder="Owner (blank = me)" className="h-10 w-40 bg-white" data-testid="audit-owner" />}
          <Input type="date" value={p.fix_deadline} onChange={e => setP(q => ({ ...q, fix_deadline: e.target.value }))} className="h-10 w-40 bg-white" data-testid="audit-deadline" />
          <Button onClick={addPoint} disabled={!p.description.trim() || saving} className="h-10 ml-auto bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid="audit-add-point">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add point</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2" data-testid="audit-board-tabs">
        {[['open', 'Open', Clock, 'text-sky-700'], ['overdue', 'Overdue', AlertTriangle, 'text-red-700'], ['resolved', 'Resolved', CheckCircle2, 'text-emerald-700'], ['all', 'All', null, 'text-slate-700']].map(([k, l, I, c]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`rounded-xl border p-2.5 text-left ${view === k ? 'border-slate-900 bg-white shadow-sm' : 'border-slate-200 bg-slate-50'}`} data-testid={`audit-board-${k}`}>
            <p className={`text-[11px] uppercase tracking-wider flex items-center gap-1 ${c}`}>{I && <I className="h-3.5 w-3.5" />}{l}</p>
            <p className="text-2xl font-bold text-slate-900" data-testid={`audit-count-${k}`}>{k === 'all' ? points.length : counts[k]}</p>
          </button>
        ))}
      </div>

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" data-testid="audit-board-list">
        {shown.length === 0 ? <li className="py-10 text-center text-sm text-slate-400" data-testid="audit-board-empty">{view === 'open' ? 'Nothing open — nice.' : `No ${view} points.`}</li> : shown.map(x => (
          <li key={`${x.audit_id}-${x.idx}`} className="px-3 py-2.5 flex items-center gap-3" data-testid={`audit-point-${x.audit_id}-${x.idx}`}>
            <Badge className={`${SEV.find(s => s[0] === x.severity)?.[2] || ''} hover:bg-inherit text-[10px] shrink-0`}>{x.severity}</Badge>
            <div className="flex-1 min-w-0"><p className={`text-sm font-medium truncate ${x.st === 'resolved' ? 'line-through text-slate-400' : 'text-slate-900'}`}>{x.description}</p>
              <p className="text-[11px] text-slate-500">{x.owner_name || '—'} · by {x.fix_deadline || '—'}{x.st === 'overdue' ? <span className="text-red-600 font-medium"> · overdue</span> : ''}{x.st === 'resolved' && x.resolved_by ? ` · resolved by ${x.resolved_by}` : ''} · {x.audit_title}</p></div>
            {x.st === 'resolved' ? <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setStatus(x, 'open')} data-testid={`audit-reopen-${x.audit_id}-${x.idx}`}><Undo2 className="h-3.5 w-3.5 mr-1" />Reopen</Button>
              : <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setStatus(x, 'resolved')} data-testid={`audit-resolve-${x.audit_id}-${x.idx}`}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Resolve</Button>}
          </li>
        ))}
      </ul>
      {(isAdmin || isManager) && templates.length > 0 && <p className="text-[11px] text-slate-400">Templates: click a chip to remove — {templates.map(t => <button key={t} type="button" className="underline mr-2" onClick={() => saveTemplates(templates.filter(x => x !== t))} data-testid={`audit-template-remove-${t.split(':')[0].replace(/\s+/g, '-')}`}>{t.split(':')[0]}<X className="inline h-3 w-3" /></button>)}</p>}
    </div>
  );
}
