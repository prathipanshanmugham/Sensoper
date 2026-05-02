import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { dashboardAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  LayoutDashboard, FolderPlus, Users, LogOut, FileText, TrendingUp,
  Menu, X, Package, History, ScrollText, Building2, ClipboardCheck, Shield,
  Layers, BarChart3
} from 'lucide-react';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_solar-estimator-14/artifacts/2dpfr2zb_slg.png";

export default function DashboardLayout({ children }) {
  const { user, logout, isAdmin, isManager } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await dashboardAPI.getStats();
      setStats(res.data);
    } catch (err) { /* silent */ }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleLogout = async () => {
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
    { icon: Package, label: 'Inventory', href: '/dashboard/inventory', show: isAdmin || isManager, badge: stats?.low_stock_alerts },
    { icon: ScrollText, label: 'Terms & Conditions', href: '/dashboard/terms', show: isAdmin || isManager },
    { icon: Users, label: 'User Management', href: '/dashboard/users', show: isAdmin },
    { icon: Shield, label: 'Permissions', href: '/dashboard/permissions', show: isAdmin },
    { icon: Layers, label: 'Form Builder', href: '/dashboard/form-tabs', show: isAdmin },
    { icon: Building2, label: 'Company Profile', href: '/dashboard/company-profile', show: isAdmin },
    { icon: History, label: 'Audit Logs', href: '/dashboard/audit-logs', show: isAdmin },
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
