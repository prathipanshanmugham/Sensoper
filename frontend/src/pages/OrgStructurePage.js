/* Location-wise organisation structure — admins only. Leadership on top, then one card per location
 * with its managers, staff and internal teams. Each person shows today's attendance. */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Crown, Loader2, MapPin, Phone, Search, Users, UserX, Briefcase } from 'lucide-react';
import { orgAPI } from '../utils/api';

const DOT = { checked_in: 'bg-emerald-500', checked_out: 'bg-sky-500', absent: 'bg-slate-300' };
const DOT_LABEL = { checked_in: 'Working now', checked_out: 'Checked out', absent: 'Not checked in' };
const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

function Person({ p, accent }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50" data-testid={`org-person-${p.id}`}>
      <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${accent}`}>
        {initials(p.name)}
        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${DOT[p.today]}`} title={DOT_LABEL[p.today]} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
        <span className="block truncate text-[11px] text-slate-500">{p.email}{p.open_projects ? ` · ${p.open_projects} open project${p.open_projects === 1 ? '' : 's'}` : ''}</span>
      </span>
      {p.phone && <a href={`tel:${p.phone}`} className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-emerald-700" aria-label={`Call ${p.name}`}><Phone className="h-4 w-4" /></a>}
    </li>
  );
}

function Group({ title, people, accent, icon: I, empty }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><I className="h-3.5 w-3.5" />{title} <span className="font-normal text-slate-400">· {people.length}</span></p>
      {people.length ? <ul>{people.map((p) => <Person key={p.id} p={p} accent={accent} />)}</ul> : <p className="px-2 py-1 text-xs text-slate-400">{empty}</p>}
    </div>
  );
}

export default function OrgStructurePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { orgAPI.structure().then((r) => setData(r.data)).catch((e) => setError(e.response?.status === 403 ? 'Only admins can see the organisation chart.' : 'Could not load the organisation chart.')); }, []);

  const match = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (p) => !s || [p.name, p.email, p.phone].some((v) => (v || '').toLowerCase().includes(s));
  }, [q]);

  if (error) return <div className="p-6 text-sm text-slate-600">{error}</div>;
  if (!data) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  const t = data.totals;
  const blocks = data.locations.map((b) => ({ ...b, managers: b.managers.filter(match), staff: b.staff.filter(match) }))
    .filter((b) => !q.trim() || b.managers.length || b.staff.length || b.location.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6" data-testid="org-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-['Outfit'] text-2xl font-bold text-slate-900">Organisation</h1>
          <p className="text-sm text-slate-500">{t.locations} location{t.locations === 1 ? '' : 's'} · {t.managers} managers · {t.staff} staff · <span className="text-emerald-700">{t.present_today} checked in today</span></p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-400" data-testid="org-search" />
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-white" data-testid="org-leadership">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300"><Crown className="h-3.5 w-3.5 text-amber-300" />Leadership · admins</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.leadership.filter(match).map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-300 text-xs font-bold text-slate-900">{initials(p.name)}<span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-slate-800 ${DOT[p.today]}`} /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-[11px] text-slate-300">{p.email}</span></span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {blocks.map((b) => (
          <section key={b.location.id} className="rounded-2xl border border-slate-200 bg-white" data-testid={`org-location-${b.location.id}`}>
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-['Outfit'] text-base font-semibold text-slate-900"><Building2 className="h-4 w-4 text-emerald-600" /><span className="truncate">{b.location.name}</span>{b.location.code && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{b.location.code}</span>}</p>
                <p className="flex items-center gap-1 text-xs capitalize text-slate-500"><MapPin className="h-3 w-3" />{[b.location.type?.replace('_', ' '), b.location.district].filter(Boolean).join(' · ')}</p>
              </div>
              <p className="text-right text-xs text-slate-500"><span className="block text-lg font-semibold text-slate-900">{b.counts.people}</span>{b.counts.present_today} in today</p>
            </header>
            <div className="space-y-3 px-3 py-3">
              <Group title="Managers" people={b.managers} accent="bg-sky-100 text-sky-800" icon={Briefcase} empty="No manager assigned yet." />
              <Group title="Team" people={b.staff} accent="bg-emerald-100 text-emerald-800" icon={Users} empty="No staff assigned yet." />
              {b.teams.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Field teams</p>
                  <div className="flex flex-wrap gap-1.5">{b.teams.map((tm) => <span key={tm.id} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-700">{tm.name}{tm.lead ? ` · lead ${tm.lead}` : ''} · {tm.member_count}</span>)}</div>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      {(data.unassigned.filter(match).length > 0 || data.locations.length === 0) && (
        <section className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/40 p-4" data-testid="org-unassigned">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-amber-900"><UserX className="h-4 w-4" />Not assigned to a location</p>
          <p className="mb-2 text-xs text-amber-800">{data.locations.length === 0 ? 'Add branches under Locations, then assign people under Users.' : 'Assign them under Users so they show up in their branch.'}</p>
          <ul className="grid gap-1 sm:grid-cols-2">{data.unassigned.filter(match).map((p) => <Person key={p.id} p={p} accent={p.role === 'manager' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'} />)}</ul>
          <div className="mt-2 flex gap-3 text-xs"><Link to="/dashboard/locations" className="font-medium text-emerald-700 hover:underline">Locations</Link><Link to="/dashboard/users" className="font-medium text-emerald-700 hover:underline">Users</Link></div>
        </section>
      )}
      <p className="flex flex-wrap gap-4 text-[11px] text-slate-500">{Object.entries(DOT_LABEL).map(([k, v]) => <span key={k} className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${DOT[k]}`} />{v}</span>)}</p>
    </div>
  );
}
