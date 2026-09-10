import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Users, Loader2, Pencil, Trash2, Save, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { teamsAPI, usersAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;
const EMPTY = { name: '', description: '', lead_user_id: '', member_user_ids: [], specialities: '', status: 'active' };

export default function TeamsPage() {
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, u] = await Promise.all([teamsAPI.list({ status: 'all' }), canManage ? usersAPI.getAll() : Promise.resolve({ data: [] })]);
      setTeams(t.data || []); setUsers(u.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load teams'); }
    finally { setLoading(false); }
  }, [canManage]);
  useEffect(() => { load(); }, [load]);

  const remove = async (t) => {
    if (!window.confirm(`Delete team "${t.name}"? Completed projects keep their history.`)) return;
    try { await teamsAPI.remove(t.id); toast.success('Team deleted'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); }
  };
  const openDetail = async (t) => {
    try { const r = await teamsAPI.get(t.id); setDetail(r.data); } catch (e) { toast.error('Failed to load team'); }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4" data-testid="teams-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold font-['Outfit'] flex items-center gap-2"><Users className="h-5 w-5 text-indigo-600" />Internal Teams</h1>
            <p className="text-sm text-slate-500">Alpha, Beta… sub-teams with their own roster. Assign one or more teams to a project and track how each performs.</p>
          </div>
        </div>
        {canManage && <Button onClick={() => setEditing({ ...EMPTY })} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5" data-testid="team-new-btn"><Plus className="h-4 w-4" />New Team</Button>}
      </div>

      {loading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-indigo-600" /></div> : teams.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-slate-400" data-testid="teams-empty">No teams yet. Create “Alpha Team” to get started.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {teams.map(t => <TeamCard key={t.id} team={t} canManage={canManage} isAdmin={isAdmin} onEdit={() => setEditing({ ...t, specialities: (t.specialities || []).join(', '), lead_user_id: t.lead_user_id || '' })} onDelete={() => remove(t)} onOpen={() => openDetail(t)} />)}
        </div>
      )}

      {canManage && <PerformanceTable teams={teams} />}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="team-editor">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit team' : 'New team'}</DialogTitle></DialogHeader>
          {editing && <TeamForm initial={editing} users={users} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="team-detail">
          {detail && <TeamDetail team={detail} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeamCard({ team, canManage, isAdmin, onEdit, onDelete, onOpen }) {
  const p = team.performance || {};
  return (
    <Card className={team.status === 'inactive' ? 'opacity-60' : ''} data-testid={`team-card-${team.id}`}>
      <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><button type="button" onClick={onOpen} className="hover:underline text-left" data-testid={`team-open-${team.id}`}>{team.name}</button>
            {team.status === 'inactive' && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}</CardTitle>
          <p className="text-xs text-slate-500 mt-0.5">{team.description || 'No description'}</p>
        </div>
        {canManage && (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} data-testid={`team-edit-${team.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
            {isAdmin && <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={onDelete} data-testid={`team-delete-${team.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {team.lead && <Badge className="bg-indigo-600 text-white hover:bg-indigo-600 text-[10px]">Lead: {team.lead.name}</Badge>}
          {(team.members || []).filter(m => m.id !== team.lead_user_id).map(m => <Badge key={m.id} variant="secondary" className="text-[10px]">{m.name}</Badge>)}
          {(team.members || []).length === 0 && !team.lead && <span className="text-xs text-slate-400">No members yet</span>}
        </div>
        {(team.specialities || []).length > 0 && <p className="text-[11px] text-slate-500">{team.specialities.join(' · ')}</p>}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
          <Stat label="Projects" value={p.projects_handled ?? 0} testid={`team-${team.id}-handled`} />
          <Stat label="Completed" value={p.projects_completed ?? 0} testid={`team-${team.id}-completed`} />
          <Stat label="On-time" value={p.on_time_pct == null ? '—' : `${p.on_time_pct}%`} testid={`team-${team.id}-ontime`} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, testid }) {
  return <div><p className="text-lg font-bold text-slate-900 tabular-nums" data-testid={testid}>{value}</p><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p></div>;
}

function TeamForm({ initial, users, onDone, onCancel }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleMember = (id) => set('member_user_ids', form.member_user_ids.includes(id) ? form.member_user_ids.filter(x => x !== id) : [...form.member_user_ids, id]);
  const submit = async () => {
    if (!form.name.trim()) { setErr('Team name is required'); return; }
    setSaving(true); setErr('');
    const payload = { name: form.name.trim(), description: form.description || '', lead_user_id: form.lead_user_id || null, member_user_ids: form.member_user_ids,
      specialities: String(form.specialities || '').split(',').map(s => s.trim()).filter(Boolean), status: form.status || 'active' };
    try {
      if (form.id) await teamsAPI.update(form.id, payload); else await teamsAPI.create(payload);
      toast.success(form.id ? 'Team updated' : 'Team created'); onDone();
    } catch (e) { setErr(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-3">
      {err && <div className="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded" data-testid="team-form-error">{err}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label className="text-xs">Team name *</Label><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Alpha Team" className="h-9" data-testid="team-name-input" /></div>
        <div className="space-y-1"><Label className="text-xs">Status</Label>
          <Select value={form.status} onValueChange={v => set('status', v)}><SelectTrigger className="h-9" data-testid="team-status-select"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></div>
        <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Rooftop installs, Erode & Salem" className="h-9" data-testid="team-description-input" /></div>
        <div className="space-y-1"><Label className="text-xs">Team lead</Label>
          <Select value={form.lead_user_id || 'none'} onValueChange={v => set('lead_user_id', v === 'none' ? '' : v)}><SelectTrigger className="h-9" data-testid="team-lead-select"><SelectValue placeholder="Pick a lead" /></SelectTrigger>
            <SelectContent><SelectItem value="none">No lead</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label className="text-xs">Specialities <span className="text-slate-400">(comma separated)</span></Label><Input value={form.specialities} onChange={e => set('specialities', e.target.value)} placeholder="Rooftop, Pump, Commercial" className="h-9" data-testid="team-specialities-input" /></div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Roster ({form.member_user_ids.length} selected)</Label>
        <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100" data-testid="team-roster">
          {users.map(u => (
            <label key={u.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
              <Checkbox checked={form.member_user_ids.includes(u.id)} onCheckedChange={() => toggleMember(u.id)} data-testid={`team-member-check-${u.id}`} />
              <span className="flex-1">{u.name}</span><span className="text-[11px] text-slate-400">{u.role}</span>
            </label>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1" data-testid="team-save-btn">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save</Button>
      </DialogFooter>
    </div>
  );
}

function PerformanceTable({ teams }) {
  const rows = [...teams].sort((a, b) => (b.performance?.projects_completed || 0) - (a.performance?.projects_completed || 0));
  return (
    <Card data-testid="teams-performance">
      <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" />Team performance</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-y border-slate-200 text-[10px] uppercase text-slate-500">
            <tr><th className="text-left px-3 py-2">Team</th><th className="text-right px-3 py-2">Handled</th><th className="text-right px-3 py-2">Active</th><th className="text-right px-3 py-2">Completed</th><th className="text-right px-3 py-2">Completion</th><th className="text-right px-3 py-2">On-time</th><th className="text-right px-3 py-2">Avg days</th><th className="text-right px-3 py-2">Revenue completed</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(t => { const p = t.performance || {}; return (
              <tr key={t.id} data-testid={`team-perf-row-${t.id}`}>
                <td className="px-3 py-2 font-medium text-slate-800">{t.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.projects_handled ?? 0}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.projects_active ?? 0}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.projects_completed ?? 0}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.completion_rate_pct ?? 0}%</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.on_time_pct == null ? '—' : `${p.on_time_pct}%`}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.avg_days_to_complete ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">{inr(p.revenue_completed)}</td>
              </tr>); })}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-400">No teams yet</td></tr>}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function TeamDetail({ team }) {
  return (
    <>
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-indigo-600" />{team.name} — projects</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">{(team.members || []).map(m => <Badge key={m.id} variant="secondary" className="text-[10px]">{m.name}</Badge>)}</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-y border-slate-200 text-[10px] uppercase text-slate-500"><tr><th className="text-left px-3 py-2">Ref</th><th className="text-left px-3 py-2">Customer</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Install date</th><th className="text-right px-3 py-2">Value</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(team.projects || []).map(p => (
              <tr key={p.id} data-testid={`team-project-row-${p.id}`}>
                <td className="px-3 py-2"><Link to={`/dashboard/projects/${p.id}`} className="text-indigo-700 underline">{p.reference_number || p.id.slice(0, 8)}</Link></td>
                <td className="px-3 py-2">{p.customer_name || '—'}</td>
                <td className="px-3 py-2"><Badge variant="outline" className="text-[10px] capitalize">{p.status}</Badge></td>
                <td className="px-3 py-2 text-xs text-slate-500">{p.installation_date || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(p.total_cost)}</td>
              </tr>
            ))}
            {(team.projects || []).length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">No projects assigned to this team yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
