import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { teamsAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';

/** Iter 52 — assign one or more internal teams (Alpha, Beta…) to a project from its detail page. */
export default function ProjectTeamsCard({ projectId, canManage }) {
  const [teams, setTeams] = useState([]);
  const [current, setCurrent] = useState([]);
  const [draft, setDraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, p] = await Promise.all([teamsAPI.list({ status: 'active' }), teamsAPI.projectTeams(projectId)]);
      setTeams(t.data || []);
      setCurrent(p.data.team_ids || []);
      setDraft(p.data.team_ids || []);
    } catch (e) { console.warn('ProjectTeamsCard load failed', e); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setDraft(d => d.includes(id) ? d.filter(x => x !== id) : [...d, id]);
  const dirty = JSON.stringify([...draft].sort()) !== JSON.stringify([...current].sort());
  const save = async () => {
    setSaving(true);
    try { const r = await teamsAPI.setProjectTeams(projectId, draft); setCurrent(r.data.team_ids); toast.success('Teams updated'); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed to save teams'); }
    finally { setSaving(false); }
  };
  const assigned = teams.filter(t => current.includes(t.id));

  return (
    <Card data-testid="project-teams-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Users className="h-4 w-4 text-indigo-600" />Internal Teams</CardTitle>
        <Link to="/dashboard/teams" className="text-xs text-indigo-700 underline" data-testid="project-teams-manage-link">Manage teams</Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : (
          <>
            <div className="flex flex-wrap gap-1.5" data-testid="project-teams-assigned">
              {assigned.length === 0 && <span className="text-xs text-slate-400">No team assigned yet.</span>}
              {assigned.map(t => <Badge key={t.id} className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100" data-testid={`project-team-badge-${t.id}`}>{t.name}</Badge>)}
            </div>
            {canManage && (
              <div className="rounded-md border border-slate-200 divide-y divide-slate-100">
                {teams.length === 0 && <p className="text-xs text-slate-400 p-2">No active teams. Create one under Teams.</p>}
                {teams.map(t => (
                  <label key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-slate-50" data-testid={`project-team-option-${t.id}`}>
                    <Checkbox checked={draft.includes(t.id)} onCheckedChange={() => toggle(t.id)} data-testid={`project-team-check-${t.id}`} />
                    <span className="flex-1 text-slate-800">{t.name}</span>
                    <span className="text-[11px] text-slate-400">{t.member_count} member{t.member_count === 1 ? '' : 's'}{t.lead ? ` · lead ${t.lead.name}` : ''}</span>
                  </label>
                ))}
              </div>
            )}
            {canManage && dirty && (
              <Button size="sm" onClick={save} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1" data-testid="project-teams-save-btn">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save teams
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
