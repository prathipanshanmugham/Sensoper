import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { dashboardAPI, alertsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  LayoutDashboard, FolderPlus, Users, LogOut, FileText, TrendingUp,
  Menu, X, Package, History, ScrollText, Building2, ClipboardCheck, Shield,
  Layers, BarChart3, CalendarDays, AlertTriangle, CreditCard, Truck, Undo2, ClipboardList, Bell, Activity, MapPin, Settings
} from 'lucide-react';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_solar-estimator-14/artifacts/2dpfr2zb_slg.png";

export default function DashboardLayout({ children }) {
  const { user, logout, isAdmin, isManager } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [alertInfo, setAlertInfo] = useState(null);
  const [showAlertPanel, setShowAlertPanel] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await dashboardAPI.getStats();
      setStats(res.data);
    } catch (err) { /* silent */ }
  }, []);

  const fetchAlerts = useCallback(async () => {
    if (!(isAdmin || isManager)) return;
    try {
      const res = await alertsAPI.getDashboard();
      setAlertInfo(res.data);
    } catch (err) { /* silent */ }
  }, [isAdmin, isManager]);

  useEffect(() => { fetchStats(); fetchAlerts(); }, [fetchStats, fetchAlerts]);

  // Close alert dropdown on outside click
  useEffect(() => {
    if (!showAlertPanel) return;
    const close = (e) => {
      if (!e.target.closest?.('[data-alert-panel-root]')) setShowAlertPanel(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showAlertPanel]);

  const handleLogout = async () => {
    // Notify service worker to purge cached assets so a different user signing in next gets fresh data
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try { navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' }); } catch (_) { /* ignore */ }
    }
    await logout();
    navigate('/login');
  };

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' , show: true },
    { icon: TrendingUp, label: 'CEO Dashboard', href: '/dashboard/ceo', show: isAdmin || isManager },
    { icon: FolderPlus, label: 'New Project', href: '/dashboard/projects/new', show: true },
    { icon: FileText, label: 'All Projects', href: '/dashboard/projects', show: true },
    { icon: ClipboardCheck, label: 'Approvals', href: '/dashboard/approvals', show: isAdmin || isManager, badge: stats?.pending_approvals },
    { icon: BarChart3, label: 'Reports', href: '/dashboard/reports', show: isAdmin || isManager },
    { icon: MapPin, label: 'Expansion', href: '/dashboard/expansion', show: isAdmin || isManager },
    { icon: AlertTriangle, label: 'Profit Alerts', href: '/dashboard/alerts', show: isAdmin || isManager },
    { icon: CreditCard, label: 'Accounts', href: '/dashboard/credits', show: isAdmin || isManager },
    { icon: Package, label: 'Purchase Inbound', href: '/dashboard/purchase-inbound', show: isAdmin || isManager },
    { icon: Truck, label: 'Delivery Outbound', href: '/dashboard/delivery-outbound', show: isAdmin || isManager },
    { icon: Undo2, label: 'Brand Returns', href: '/dashboard/returns', show: true },
    { icon: ClipboardList, label: 'Weekly Audits', href: '/dashboard/audits', show: isAdmin || isManager },
    { icon: CalendarDays, label: 'Daily Updates', href: '/dashboard/daily-updates', show: true },
    { icon: Activity, label: 'Readings', href: '/dashboard/readings', show: true },
    { icon: Package, label: 'Inventory', href: '/dashboard/inventory', show: isAdmin || isManager, badge: stats?.low_stock_alerts },
    { icon: ScrollText, label: 'Terms & Conditions', href: '/dashboard/terms', show: isAdmin || isManager },
    { icon: Users, label: 'User Management', href: '/dashboard/users', show: isAdmin },
    { icon: Shield, label: 'Permissions', href: '/dashboard/permissions', show: isAdmin },
    { icon: Layers, label: 'Form Builder', href: '/dashboard/form-tabs', show: isAdmin },
    { icon: Building2, label: 'Company Profile', href: '/dashboard/company-profile', show: isAdmin },
    { icon: History, label: 'Audit Logs', href: '/dashboard/audit-logs', show: isAdmin },
    { icon: Settings, label: 'Pricing & Config', href: '/dashboard/pricing-config', show: isAdmin },
  ].filter(item => item.show);

  const isActive = (href) => {
    if (href === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside className={`fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-slate-200 shadow-sm transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-200">
            <img src={LOGO_URL} alt="Sensoper" className="h-12 w-auto object-contain" />
            <button className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)}><X className="h-5 w-5 text-slate-400" /></button>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navItems.map((item) => (
              <Link key={item.href} to={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${isActive(item.href) ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                onClick={() => setSidebarOpen(false)}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
                <item.icon className="h-4.5 w-4.5" />
                <span className="text-sm flex-1">{item.label}</span>
                {item.badge > 0 && <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0">{item.badge}</Badge>}
              </Link>
            ))}
          </nav>

          <div className="px-3 py-3 border-t border-slate-200">
            <div className="flex items-center gap-3 px-4 py-2">
              <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center">
                <span className="text-emerald-700 font-semibold text-sm">{user?.name?.charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{user?.name}</p>
                <p className="text-[11px] text-slate-500 capitalize">{user?.role}</p>
              </div>
            </div>
            <Button variant="ghost" className="w-full mt-1 text-slate-500 hover:text-red-600 hover:bg-red-50 justify-start h-9 text-sm" onClick={handleLogout} data-testid="logout-btn">
              <LogOut className="h-4 w-4 mr-3" />Sign out
            </Button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-sm border-b border-slate-200">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3">
            <button className="lg:hidden" onClick={() => setSidebarOpen(true)} data-testid="mobile-menu-btn"><Menu className="h-6 w-6 text-slate-600" /></button>
            <div className="flex-1" />

            {/* Notification Bell */}
            {(isAdmin || isManager) && (
              <div className="relative mr-2" data-alert-panel-root data-testid="notification-bell-wrapper">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAlertPanel(v => !v); }}
                  className="relative p-2 rounded-full hover:bg-slate-100 transition-colors"
                  data-testid="notification-bell-btn"
                  aria-label="Notifications"
                >
                  <Bell className="h-5 w-5 text-slate-600" />
                  {alertInfo?.total_alerts > 0 && (
                    <span
                      className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold shadow-sm"
                      data-testid="notification-count"
                    >
                      {alertInfo.total_alerts > 99 ? '99+' : alertInfo.total_alerts}
                    </span>
                  )}
                </button>

                {showAlertPanel && (
                  <div
                    className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-40"
                    data-testid="notification-panel"
                  >
                    <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-red-50 to-amber-50 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-red-500" />Profit Leakage Alerts</p>
                        <p className="text-xs text-slate-500">{alertInfo?.total_alerts || 0} active · Impact ₹{(alertInfo?.total_leakage || 0).toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {alertInfo?.top_risks?.length > 0 ? (
                        <ul className="divide-y divide-slate-100">
                          {alertInfo.top_risks.slice(0, 6).map((r) => (
                            <li key={r.id}>
                              <Link
                                to={`/dashboard/projects/${r.id}`}
                                onClick={() => setShowAlertPanel(false)}
                                className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                                data-testid={`notification-item-${r.id}`}
                              >
                                <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${r.risk_level === 'High' ? 'bg-red-500' : r.risk_level === 'Medium' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-slate-900 truncate">{r.customer || 'Unnamed'}</p>
                                  <p className="text-xs text-slate-500 truncate">{r.ref} · {r.alert_count} alert{r.alert_count !== 1 ? 's' : ''}</p>
                                </div>
                                <Badge variant="outline" className={`text-[10px] shrink-0 ${r.risk_level === 'High' ? 'border-red-300 bg-red-50 text-red-700' : r.risk_level === 'Medium' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}>
                                  {r.risk_level}
                                </Badge>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="py-10 text-center">
                          <AlertTriangle className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                          <p className="text-sm text-slate-600 font-medium">All clear</p>
                          <p className="text-xs text-slate-400">No profit leakage alerts right now.</p>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-slate-100 bg-slate-50">
                      <Link
                        to="/dashboard/alerts"
                        onClick={() => setShowAlertPanel(false)}
                        className="block px-4 py-2.5 text-center text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                        data-testid="notification-view-all"
                      >
                        View all alerts →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Link to="/dashboard/projects/new">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-2" data-testid="new-project-btn"><FolderPlus className="h-4 w-4" />New Project</Button>
            </Link>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
