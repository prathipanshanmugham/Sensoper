import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { dashboardAPI, projectsAPI, dailyReportsAPI, attendanceAPI } from '../utils/api';
import { MonthlyTargetPanel } from '../components/MonthlyTargetPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import CeoDashboard from './CeoDashboard';
import { NAV_SECTIONS, canSee } from '../lib/navigation';
import { localDate, greeting, inrShort, inr } from '../lib/format';
import {
  FolderPlus, CalendarCheck, NotebookPen, ClipboardCheck, FolderKanban, Package, Users, ChevronRight, CheckCircle2,
  Clock, AlertCircle, XCircle, Trash2, Activity, FileText,
} from 'lucide-react';

export const STATUS = {
  draft: { label: 'Draft', cls: 'bg-amber-50 text-amber-800 ring-amber-200', icon: Clock },
  submitted: { label: 'Waiting approval', cls: 'bg-sky-50 text-sky-800 ring-sky-200', icon: AlertCircle },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: CheckCircle2 },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-800 ring-red-200', icon: XCircle },
  completed: { label: 'Completed', cls: 'bg-slate-100 text-slate-700 ring-slate-200', icon: CheckCircle2 },
  deletion_requested: { label: 'Deletion requested', cls: 'bg-orange-50 text-orange-800 ring-orange-200', icon: Trash2 },
};

export function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.draft;
  const I = s.icon;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}><I className="h-3 w-3" />{s.label}</span>;
}

const REPORT_STATE = {
  not_started: { text: 'Not started', cls: 'text-amber-700' },
  draft: { text: 'Draft saved — not submitted', cls: 'text-amber-700' },
  submitted: { text: 'Submitted', cls: 'text-emerald-700' },
};

function ActionTile({ to, icon: Icon, title, note, noteCls = 'text-slate-500', tone = 'slate', testid }) {
  const tones = {
    green: 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600',
    slate: 'bg-white text-slate-900 hover:border-slate-300 hover:shadow-sm border-slate-200',
  };
  const isGreen = tone === 'green';
  return (
    <Link to={to} className={`flex min-h-[92px] flex-col justify-between rounded-xl border p-4 transition ${tones[tone]}`} data-testid={testid}>
      <Icon className={`h-6 w-6 ${isGreen ? 'text-white' : 'text-emerald-600'}`} />
      <div>
        <p className="font-['Outfit'] text-[15px] font-semibold leading-tight">{title}</p>
        {note && <p className={`mt-0.5 text-xs ${isGreen ? 'text-emerald-50' : noteCls}`}>{note}</p>}
      </div>
    </Link>
  );
}

function AttentionRow({ to, icon: Icon, tone, title, detail, testid }) {
  const tones = { red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600', sky: 'bg-sky-50 text-sky-600', green: 'bg-emerald-50 text-emerald-600' };
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50" data-testid={testid}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-900">{title}</span><span className="block truncate text-xs text-slate-500">{detail}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </Link>
  );
}

function Stat({ label, value, sub, to }) {
  const body = (
    <div className="h-full rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-['Outfit'] text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Overview({ user, isMgr, can, allowed }) {
  const seesTeamReports = allowed('can_review_daily_reports');
  const mustReport = user?.daily_report_required !== false;
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [myReport, setMyReport] = useState(null);
  const [team, setTeam] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const today = localDate();

  const load = useCallback(async () => {
    const jobs = [dashboardAPI.getStats(), projectsAPI.getAll(), dailyReportsAPI.mine(today)];
    if (seesTeamReports) jobs.push(dailyReportsAPI.team(today));
    const [s, p, r, t] = await Promise.allSettled(jobs);
    if (s.status === 'fulfilled') setStats(s.value.data);
    if (p.status === 'fulfilled') setProjects(p.value.data || []);
    if (r.status === 'fulfilled') setMyReport(r.value.data);
    if (t?.status === 'fulfilled') setTeam(t.value.data);
    setLoading(false);
  }, [today, seesTeamReports]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { attendanceAPI.today().then((r) => setAttendance(r.data)).catch(() => {}); }, []);

  const reportState = REPORT_STATE[myReport?.status || 'not_started'] || REPORT_STATE.not_started;
  const mine = projects.filter((p) => p.created_by === user?.id);
  const myDrafts = mine.filter((p) => p.status === 'draft');
  const recent = projects.slice(0, 6);
  const attention = [];
  if (attendance && !attendance.record && new Date().getHours() < 20) attention.push({ to: '/dashboard/attendance', icon: Clock, tone: 'amber', title: "You haven't checked in today", detail: 'Tap to check in — your time and location are saved', testid: 'checkin-alert' });
  if (allowed('module_approvals') && stats?.pending_approvals > 0) attention.push({ to: '/dashboard/approvals', icon: ClipboardCheck, tone: 'sky', title: `${stats.pending_approvals} waiting for your approval`, detail: 'Project reviews, deletions and purchase orders', testid: 'pending-approvals-alert' });
  const expected = team ? (team.counts.expected ?? team.rows.length) : 0;
  if (team && team.counts.missing + team.counts.draft > 0) attention.push({ to: '/dashboard/daily-report?tab=team', icon: Users, tone: 'amber', title: `${team.counts.submitted} of ${expected} daily reports in today`, detail: `${team.counts.missing} not started · ${team.counts.draft} in draft`, testid: 'team-reports-alert' });
  if (allowed('module_inventory') && stats?.low_stock_alerts > 0) attention.push({ to: '/dashboard/inventory', icon: Package, tone: 'red', title: `${stats.low_stock_alerts} item${stats.low_stock_alerts > 1 ? 's' : ''} low on stock`, detail: 'Reorder before the next installation', testid: 'low-stock-alert' });
  if (mustReport && myReport && myReport.status !== 'submitted' && can('/dashboard/daily-report')) attention.push({ to: '/dashboard/daily-report', icon: CalendarCheck, tone: 'amber', title: "Your daily report isn't submitted yet", detail: reportState.text, testid: 'my-report-alert' });
  if (myDrafts.length > 0) attention.push({ to: '/dashboard/projects?status=draft', icon: FileText, tone: 'amber', title: `${myDrafts.length} draft project${myDrafts.length > 1 ? 's' : ''} to finish`, detail: myDrafts.slice(0, 3).map((p) => p.customer?.name).join(', '), testid: 'my-drafts-alert' });

  return (
    <div className="space-y-6">
      <section aria-label="Quick actions" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {can('/dashboard/projects/new') && <ActionTile to="/dashboard/projects/new" icon={FolderPlus} title="New project" note="Site visit & quotation" tone="green" testid="qa-new-project" />}
        {can('/dashboard/daily-report') && <ActionTile to="/dashboard/daily-report" icon={CalendarCheck} title="Daily report" note={!mustReport && reportState === REPORT_STATE.not_started ? 'Optional for you' : reportState.text} noteCls={!mustReport && reportState === REPORT_STATE.not_started ? 'text-slate-500' : reportState.cls} testid="qa-daily-report" />}
        {can('/dashboard/site-diary') && <ActionTile to="/dashboard/site-diary" icon={NotebookPen} title="Site diary" note="Log today's site work" testid="qa-site-diary" />}
        {can('/dashboard/approvals')
          ? <ActionTile to="/dashboard/approvals" icon={ClipboardCheck} title="Approvals" note={stats?.pending_approvals ? `${stats.pending_approvals} waiting` : 'Nothing waiting'} noteCls={stats?.pending_approvals ? 'text-sky-700' : 'text-slate-500'} testid="qa-approvals" />
          : can('/dashboard/readings') && <ActionTile to="/dashboard/readings" icon={Activity} title="Readings" note="Generation checks" testid="qa-readings" />}
      </section>

      {attention.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-labelledby="attention-h">
          <h2 id="attention-h" className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Needs attention</h2>
          <div className="divide-y divide-slate-100">{attention.map((a) => <AttentionRow key={a.title} {...a} />)}</div>
        </section>
      )}

      {isMgr && <MonthlyTargetPanel />}

      <section aria-label="Project numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={isMgr ? 'All projects' : 'Projects'} value={loading ? '–' : stats?.total ?? 0} sub={`${stats?.draft || 0} in draft`} to="/dashboard/projects" />
        <Stat label="Waiting approval" value={loading ? '–' : stats?.submitted ?? 0} to="/dashboard/projects?status=submitted" />
        <Stat label="Approved · in progress" value={loading ? '–' : stats?.approved ?? 0} sub={`${stats?.completed || 0} completed`} to="/dashboard/projects?status=approved" />
        {isMgr
          ? <Stat label="Revenue (approved + done)" value={loading ? '–' : inrShort(stats?.total_revenue)} sub={`${stats?.conversion_rate || 0}% of quotes won`} />
          : <Stat label="My projects" value={loading ? '–' : mine.length} sub={`${myDrafts.length} draft`} />}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-labelledby="recent-h">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 id="recent-h" className="text-sm font-semibold text-slate-900">Latest projects</h2>
          <Link to="/dashboard/projects" className="text-sm font-medium text-emerald-700 hover:text-emerald-800" data-testid="view-all-projects-btn">See all</Link>
        </div>
        {recent.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <FolderKanban className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">{loading ? 'Loading projects…' : 'No projects yet.'}</p>
            {!loading && can('/dashboard/projects/new') && <Link to="/dashboard/projects/new" className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Create the first project</Link>}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => navigate(`/dashboard/projects/${p.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50" data-testid={`project-row-${p.id}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{p.customer?.name || 'Unnamed'}</span>
                    <span className="block truncate text-xs text-slate-500">{[p.location?.district || p.location?.address, p.reference_number].filter(Boolean).join(' · ') || p.customer?.phone}</span>
                  </span>
                  <span className="hidden text-right text-sm font-semibold tabular-nums text-slate-900 sm:block">{inr(p.cost_estimation?.total_cost)}</span>
                  <StatusPill status={p.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function Dashboard() {
  const { user, isAdmin, isManager, perms, can: allowed } = useAuth();
  const isMgr = isAdmin || isManager;
  const [params, setParams] = useSearchParams();
  const ceoAllowed = allowed('module_ceo_dashboard');
  const tab = ceoAllowed && params.get('tab') === 'health' ? 'health' : 'overview';
  const visible = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => canSee(i, user?.role, perms || {}));
  const can = (href) => visible.some((i) => i.href === href);

  const day = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-5">
        <p className="text-sm text-slate-500">{day}</p>
        <h1 className="font-['Outfit'] text-2xl font-semibold text-slate-900" data-testid="home-greeting">{greeting()}, {user?.name?.split(' ')[0]}</h1>
      </div>
      {ceoAllowed ? (
        <Tabs value={tab} onValueChange={(v) => setParams(v === 'health' ? { tab: 'health' } : {}, { replace: true })}>
          <TabsList className="mb-5 grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
            <TabsTrigger value="overview" data-testid="home-tab-overview">Today</TabsTrigger>
            <TabsTrigger value="health" data-testid="home-tab-health">Business health</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><Overview user={user} isMgr={isMgr} can={can} allowed={allowed} /></TabsContent>
          <TabsContent value="health">{tab === 'health' && <CeoDashboard embedded />}</TabsContent>
        </Tabs>
      ) : (
        <Overview user={user} isMgr={isMgr} can={can} allowed={allowed} />
      )}
    </div>
  );
}
