import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { StatusPill } from './Dashboard';
import { inr } from '../lib/format';
import { FolderPlus, Search, Loader2, FolderKanban, X, ChevronRight } from 'lucide-react';

const FILTERS = [
  ['all', 'All'], ['draft', 'Draft'], ['submitted', 'Waiting approval'], ['approved', 'Approved'], ['completed', 'Completed'], ['rejected', 'Rejected'],
];

const sizeOf = (p) => p.system_size_kw || p.cost_estimation?.total_capacity_kw || null;
const placeOf = (p) => p.location?.district || p.location?.site_location_words || p.location?.address || p.customer?.address || '';

export default function ProjectList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.some(([k]) => k === params.get('status')) ? params.get('status') : 'all';
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try { setProjects((await projectsAPI.getAll()).data || []); } catch (e) { console.error('Failed to fetch projects', e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const counts = useMemo(() => {
    const c = { all: projects.length };
    projects.forEach((p) => { c[p.status] = (c[p.status] || 0) + 1; });
    return c;
  }, [projects]);

  const shown = projects.filter((p) => {
    if (filter !== 'all' && p.status !== filter) return false;
    if (mineOnly && p.created_by !== user?.id) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return [p.customer?.name, p.customer?.phone, p.customer?.address, p.reference_number, p.location?.district].some((v) => (v || '').toLowerCase().includes(q));
  });

  const setFilter = (k) => setParams(k === 'all' ? {} : { status: k }, { replace: true });

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-['Outfit'] text-2xl font-semibold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500">{loading ? 'Loading…' : `${shown.length} of ${projects.length} shown`}</p>
        </div>
        <Link to="/dashboard/projects/new" className="hidden sm:block">
          <Button className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="new-project-btn"><FolderPlus className="h-4 w-4" />New project</Button>
        </Link>
      </div>

      <div className="mb-3 flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search projects</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id="project-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, ref or district"
            className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-[15px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" data-testid="search-input" />
          {query && <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </label>
        <button type="button" onClick={() => setMineOnly((v) => !v)} aria-pressed={mineOnly}
          className={`h-11 shrink-0 rounded-lg border px-3 text-sm font-medium ${mineOnly ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`} data-testid="mine-only">Mine</button>
      </div>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Filter by status" data-testid="status-filter">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${filter === k ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
            data-testid={`status-filter-${k}`}>
            {label}<span className={`ml-1.5 tabular-nums ${filter === k ? 'text-emerald-100' : 'text-slate-400'}`}>{counts[k] || 0}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-emerald-600" /></div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-14 text-center">
          <FolderKanban className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="font-medium text-slate-900">No projects here</p>
          <p className="mt-1 text-sm text-slate-500">{query || filter !== 'all' || mineOnly ? 'Try clearing the search or picking “All”.' : 'Create the first project to get started.'}</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => navigate(`/dashboard/projects/${p.id}`)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50" data-testid={`project-card-${p.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium text-slate-900">{p.customer?.name || 'Unnamed customer'}</span>
                    <StatusPill status={p.status} />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {[p.reference_number, placeOf(p), p.customer?.phone].filter(Boolean).join(' · ')}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {p.created_by_name ? `${p.created_by_name} · ` : ''}{new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold tabular-nums text-slate-900">{inr(p.cost_estimation?.total_cost)}</span>
                  {sizeOf(p) && <span className="block text-xs text-slate-500">{sizeOf(p)} kW</span>}
                </span>
                <ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-300 sm:block" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
