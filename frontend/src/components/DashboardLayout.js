import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { dashboardAPI, alertsAPI, notificationsAPI } from '../utils/api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
import {
  LogOut, Menu, X, Bell, AlertTriangle, HelpCircle, Search, ChevronDown, Plus, Home, FolderKanban, CalendarCheck,
  LayoutGrid, Lightbulb, KeyRound,
} from 'lucide-react';
import { NAV_SECTIONS, canSee, routeInfo, activeHref } from '../lib/navigation';

const LOGO_URL = `${process.env.PUBLIC_URL}/logo.png`;
const COLLAPSE_KEY = 'sensoper.nav.collapsed';
const HELP_SEEN_KEY = 'sensoper.help.nudge.seen';

const readStore = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const writeStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage is optional */ } };

function NavLink({ item, active, badge, onNavigate }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
      data-testid={`nav-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
    >
      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
      <span className="flex-1 truncate">{item.label}</span>
      {badge > 0 && <span className="min-w-[20px] rounded-full bg-red-500 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{badge > 99 ? '99+' : badge}</span>}
    </Link>
  );
}

function SidebarContent({ sections, active, stats, user, onNavigate, onLogout, onClose }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(() => readStore(COLLAPSE_KEY, ['settings']));
  const toggle = (id) => setCollapsed((c) => { const n = c.includes(id) ? c.filter((x) => x !== id) : [...c, id]; writeStore(COLLAPSE_KEY, n); return n; });
  const q = query.trim().toLowerCase();
  const results = q ? sections.flatMap((s) => s.items.filter((i) => `${i.label} ${i.keywords || ''} ${s.label}`.toLowerCase().includes(q)).map((i) => ({ ...i, section: s.label }))) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <Link to="/dashboard" onClick={onNavigate} className="shrink-0"><img src={LOGO_URL} alt="Sensoper Controls & Renewables" className="h-11 w-auto object-contain" /></Link>
        {onClose && <button type="button" className="ml-auto rounded-md p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close menu" data-testid="mobile-menu-close"><X className="h-5 w-5" /></button>}
      </div>

      <div className="px-3 pt-3">
        <label className="relative block">
          <span className="sr-only">Find a page</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="nav-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a page…"
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            data-testid="nav-search"
          />
        </label>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main menu">
        {results ? (
          <div className="space-y-0.5">
            {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No page matches “{query}”.</p>}
            {results.map((i) => (
              <div key={i.href}>
                <NavLink item={i} active={i.href === active} badge={i.badge ? stats?.[i.badge] : 0} onNavigate={() => { setQuery(''); onNavigate?.(); }} />
                <p className="-mt-1 pb-1 pl-[42px] text-[11px] text-slate-400">{i.section}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {sections.map((s) => {
              const isCollapsed = collapsed.includes(s.id) && !s.items.some((i) => i.href === active);
              if (s.id === 'home') {
                return <div key={s.id} className="space-y-0.5">{s.items.map((i) => <NavLink key={i.href} item={i} active={i.href === active} onNavigate={onNavigate} />)}</div>;
              }
              const sectionBadges = s.items.reduce((n, i) => n + (i.badge ? (stats?.[i.badge] || 0) : 0), 0);
              return (
                <div key={s.id}>
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600"
                    aria-expanded={!isCollapsed}
                    data-testid={`nav-section-${s.id}`}
                  >
                    <span className="flex-1 text-left">{s.label}</span>
                    {isCollapsed && sectionBadges > 0 && <span className="h-2 w-2 rounded-full bg-red-500" />}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                  </button>
                  {!isCollapsed && (
                    <div className="mt-1 space-y-0.5">
                      {s.items.map((i) => <NavLink key={i.href} item={i} active={i.href === active} badge={i.badge ? stats?.[i.badge] : 0} onNavigate={onNavigate} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      <div className="border-t border-slate-200 px-3 py-3">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">{user?.name?.charAt(0).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
            <p className="text-[11px] capitalize text-slate-500">{user?.role}</p>
          </div>
          <button type="button" onClick={onLogout} className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Sign out" title="Sign out" data-testid="logout-btn"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}

function HelpPanel({ open, onOpenChange, info }) {
  const help = info?.help;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="help-panel">
        <SheetHeader className="text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{info?.section || 'Help'}</p>
          <SheetTitle className="font-['Outfit'] text-xl">{info?.label}</SheetTitle>
          <SheetDescription className="text-[15px] leading-relaxed text-slate-600">{help?.what || 'Help for this screen is coming soon.'}</SheetDescription>
        </SheetHeader>
        {help?.steps?.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">How to use it</h3>
            <ol className="space-y-3">
              {help.steps.map((s, i) => (
                <li key={s} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{i + 1}</span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {help?.tip && (
          <div className="mt-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><p>{help.tip}</p>
          </div>
        )}
        <div className="mt-8 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
          Looking for another screen? Use <b>Find a page</b> at the top of the menu. Every screen has this Help button.
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NotificationBell({ alertInfo, onRefresh }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!e.target.closest?.('[data-alert-panel-root]')) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" data-alert-panel-root data-testid="notification-bell-wrapper">
      <button type="button" onClick={() => setOpen((v) => !v)} className="relative rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100" data-testid="notification-bell-btn" aria-label="Alerts and notifications">
        <Bell className="h-5 w-5" />
        {alertInfo?.total_alerts > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white" data-testid="notification-count">{alertInfo.total_alerts > 99 ? '99+' : alertInfo.total_alerts}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96" data-testid="notification-panel">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><AlertTriangle className="h-4 w-4 text-red-500" />Alerts & notifications</p>
            <p className="text-xs text-slate-500">{alertInfo?.total_alerts || 0} active · money at risk ₹{(alertInfo?.total_leakage || 0).toLocaleString('en-IN')}</p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {alertInfo?.notifications?.length > 0 && (
              <ul className="divide-y divide-slate-100 border-b border-slate-200 bg-amber-50/40" data-testid="notification-inapp-list">
                {alertInfo.notifications.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 px-4 py-2.5" data-testid={`inapp-notification-${n.id}`}>
                    <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.kind === 'vault_rotation' ? 'bg-red-500' : 'bg-sky-500'}`} />
                    <Link to={n.link} onClick={() => setOpen(false)} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{n.title}</p>
                      <p className="truncate text-xs text-slate-500">{n.message}</p>
                    </Link>
                    <button type="button" onClick={async (e) => { e.stopPropagation(); try { await notificationsAPI.dismiss(n.id); onRefresh(); } catch { /* ignore */ } }} className="shrink-0 text-[11px] text-slate-400 hover:text-slate-700" data-testid={`inapp-dismiss-${n.id}`}>Dismiss</button>
                  </li>
                ))}
              </ul>
            )}
            {alertInfo?.top_risks?.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {alertInfo.top_risks.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <Link to={`/dashboard/projects/${r.id}`} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50" data-testid={`notification-item-${r.id}`}>
                      <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.risk_level === 'High' ? 'bg-red-500' : r.risk_level === 'Medium' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{r.customer || 'Unnamed'}</p>
                        <p className="truncate text-xs text-slate-500">{r.ref} · {r.alert_count} alert{r.alert_count !== 1 ? 's' : ''}</p>
                      </div>
                      <Badge variant="outline" className={`shrink-0 text-[10px] ${r.risk_level === 'High' ? 'border-red-300 bg-red-50 text-red-700' : r.risk_level === 'Medium' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}>{r.risk_level}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-10 text-center"><p className="text-sm font-medium text-slate-600">All clear</p><p className="text-xs text-slate-400">No projects are losing money right now.</p></div>
            )}
          </div>
          <Link to="/dashboard/alerts" onClick={() => setOpen(false)} className="block border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-center text-xs font-medium text-emerald-700 hover:bg-emerald-50" data-testid="notification-view-all">See all profit alerts →</Link>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({ children }) {
  const { user, logout, perms, can: allowed } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [alertInfo, setAlertInfo] = useState(null);
  const [nudge, setNudge] = useState(() => !readStore(HELP_SEEN_KEY, false));
  const seesAlerts = allowed('module_alerts');

  const fetchStats = useCallback(async () => { try { setStats((await dashboardAPI.getStats()).data); } catch { /* the menu works without counts */ } }, []);
  const fetchAlerts = useCallback(async () => {
    if (!seesAlerts) return;
    try { setAlertInfo((await alertsAPI.getDashboard()).data); } catch { /* optional */ }
  }, [seesAlerts]);
  useEffect(() => { fetchStats(); fetchAlerts(); }, [fetchStats, fetchAlerts]);
  useEffect(() => { setDrawerOpen(false); window.scrollTo?.(0, 0); }, [location.pathname]);

  const sections = useMemo(() => NAV_SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => canSee(i, user?.role, perms)) }))
    .filter((s) => s.items.length > 0), [user?.role, perms]);
  const visible = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const active = activeHref(location.pathname, visible);
  const info = routeInfo(location.pathname);
  const can = (href) => visible.some((i) => i.href === href);

  const handleLogout = async () => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try { navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' }); } catch { /* ignore */ }
    }
    await logout();
    navigate('/login');
  };
  const openHelp = () => { setHelpOpen(true); if (nudge) { setNudge(false); writeStore(HELP_SEEN_KEY, true); } };

  const sidebarProps = { sections, active, stats, user, onLogout: handleLogout };
  const bottomItems = [
    { href: '/dashboard', label: 'Home', icon: Home },
    { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
    { href: '/dashboard/projects/new', label: 'New', icon: Plus, primary: true },
    { href: '/dashboard/daily-report', label: 'Report', icon: CalendarCheck },
  ].filter((i) => can(i.href));

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-200 bg-white lg:block" data-testid="sidebar">
        <SidebarContent {...sidebarProps} />
      </aside>

      {/* Phone / tablet drawer */}
      {drawerOpen && <div className="fixed inset-0 z-50 bg-slate-900/40 lg:hidden" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      <aside className={`fixed inset-y-0 left-0 z-50 w-[86%] max-w-xs bg-white shadow-xl transition-transform duration-200 lg:hidden ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`} aria-hidden={!drawerOpen} data-testid="mobile-drawer">
        {drawerOpen && <SidebarContent {...sidebarProps} onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />}
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="flex h-14 items-center gap-2 px-3 sm:px-6">
            <button type="button" className="-ml-1 rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open menu" data-testid="mobile-menu-btn"><Menu className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1">
              <p className="hidden text-[11px] font-medium uppercase tracking-wider text-slate-400 sm:block">{info?.section}</p>
              <p className="truncate font-['Outfit'] text-base font-semibold leading-tight text-slate-900 sm:text-[15px]" data-testid="page-title">{info?.label}</p>
            </div>
            <div className="relative">
              <Button variant="ghost" size="sm" onClick={openHelp} className="gap-1.5 px-2.5 text-slate-600" data-testid="help-btn" aria-label="Help for this screen">
                <HelpCircle className="h-5 w-5" /><span className="hidden sm:inline">Help</span>
              </Button>
              {nudge && (
                <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-white shadow-lg" role="note" data-testid="help-nudge">
                  New here? Every screen has a Help button explaining what it's for.
                  <button type="button" onClick={() => { setNudge(false); writeStore(HELP_SEEN_KEY, true); }} className="mt-2 block font-semibold text-emerald-300">Got it</button>
                </div>
              )}
            </div>
            {seesAlerts && <NotificationBell alertInfo={alertInfo} onRefresh={fetchAlerts} />}
            {can('/dashboard/projects/new') && (
              <Link to="/dashboard/projects/new" className="hidden sm:block">
                <Button size="sm" className="gap-1.5 bg-emerald-600 font-medium text-white hover:bg-emerald-700" data-testid="new-project-btn"><Plus className="h-4 w-4" />New project</Button>
              </Link>
            )}
          </div>
        </header>

        {user?.must_reset_password && location.pathname !== '/dashboard/security' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 sm:px-6" data-testid="must-reset-banner">
            <KeyRound className="h-4 w-4 shrink-0" />
            <span className="flex-1">Your password needs to be changed.</span>
            <Link to="/dashboard/security" className="font-semibold underline underline-offset-2">Change it now</Link>
          </div>
        )}

        <main className="pb-24 lg:pb-8">{children}</main>
      </div>

      {/* Phone bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} aria-label="Quick menu" data-testid="bottom-bar">
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {bottomItems.map((i) => {
            const on = i.href === active;
            if (i.primary) {
              return (
                <Link key={i.href} to={i.href} className="flex flex-1 flex-col items-center justify-center py-1.5" aria-label="New project" data-testid="bottom-new">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md shadow-emerald-600/30"><Plus className="h-6 w-6" /></span>
                </Link>
              );
            }
            return (
              <Link key={i.href} to={i.href} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${on ? 'text-emerald-700' : 'text-slate-500'}`} aria-current={on ? 'page' : undefined} data-testid={`bottom-${i.label.toLowerCase()}`}>
                <i.icon className="h-5 w-5" />{i.label}
              </Link>
            );
          })}
          <button type="button" onClick={() => setDrawerOpen(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500" data-testid="bottom-menu">
            <LayoutGrid className="h-5 w-5" />Menu
          </button>
        </div>
      </nav>

      <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} info={info} />
    </div>
  );
}
