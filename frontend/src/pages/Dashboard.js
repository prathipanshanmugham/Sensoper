import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { dashboardAPI, projectsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { 
  FileText, Clock, CheckCircle2, AlertCircle, TrendingUp, DollarSign,
  Package, ClipboardCheck, XCircle, Trash2
} from 'lucide-react';

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-amber-100 text-amber-800', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-800', icon: AlertCircle },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800', icon: XCircle },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  deletion_requested: { label: 'Deletion Requested', color: 'bg-orange-100 text-orange-800', icon: Trash2 }
};

function StatCard({ title, value, icon: Icon, trend, color = "emerald", alert = false }) {
  return (
    <Card className={`border-slate-200 card-hover ${alert ? 'border-amber-300 bg-amber-50' : ''}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">{title}</p>
            <p className={`text-3xl font-bold font-['Outfit'] text-${color}-600 mt-1`}>{value}</p>
            {trend && (
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> {trend}
              </p>
            )}
          </div>
          <div className={`p-3 bg-${color}-100 rounded-xl`}>
            <Icon className={`h-6 w-6 text-${color}-600`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectRow({ project, onClick }) {
  const config = statusConfig[project.status] || statusConfig.draft;
  const StatusIcon = config.icon;

  return (
    <tr 
      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
      onClick={onClick}
      data-testid={`project-row-${project.id}`}
    >
      <td className="py-4 px-4">
        <div>
          <p className="font-medium text-slate-900">{project.customer?.name || 'N/A'}</p>
          <p className="text-sm text-slate-500">{project.customer?.phone || 'N/A'}</p>
        </div>
      </td>
      <td className="py-4 px-4">
        <p className="text-sm text-slate-600 truncate max-w-[200px]">
          {project.location?.site_location_words || project.location?.address || '-'}
        </p>
      </td>
      <td className="py-4 px-4">
        <p className="font-semibold text-slate-900">
          ₹{(project.cost_estimation?.total_cost || 0).toLocaleString('en-IN')}
        </p>
      </td>
      <td className="py-4 px-4">
        <Badge className={`${config.color} gap-1`}>
          <StatusIcon className="h-3 w-3" />
          {config.label}
        </Badge>
      </td>
      <td className="py-4 px-4 text-sm text-slate-500">
        {new Date(project.created_at).toLocaleDateString('en-IN')}
      </td>
    </tr>
  );
}

export default function Dashboard() {
  const { user, isAdmin, isManager } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, projectsRes] = await Promise.all([
        dashboardAPI.getStats(),
        projectsAPI.getAll()
      ]);
      setStats(statsRes.data);
      setRecentProjects(projectsRes.data.slice(0, 5));
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="p-6">
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={`skeleton-${i}`} className="animate-pulse"><CardContent className="p-6"><div className="h-20 bg-slate-200 rounded" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <>
          <h1 className="text-xl font-semibold font-['Outfit'] text-slate-900 mb-6">Welcome back, {user?.name?.split(' ')[0]}!</h1>

          {(stats?.low_stock_alerts > 0 || stats?.pending_approvals > 0) && (isAdmin || isManager) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {stats?.pending_approvals > 0 && (
                <Link to="/dashboard/approvals">
                  <Card className="border-blue-300 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer">
                    <CardContent className="p-4 flex items-center gap-3">
                      <ClipboardCheck className="h-5 w-5 text-blue-600" />
                      <div>
                        <p className="font-medium text-blue-800" data-testid="pending-approvals-alert">{stats.pending_approvals} Approval{stats.pending_approvals > 1 ? 's' : ''} Pending</p>
                        <p className="text-sm text-blue-600">Click to review</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )}
              {stats?.low_stock_alerts > 0 && (
                <Link to="/dashboard/inventory">
                  <Card className="border-red-300 bg-red-50 hover:bg-red-100 transition-colors cursor-pointer">
                    <CardContent className="p-4 flex items-center gap-3">
                      <Package className="h-5 w-5 text-red-600" />
                      <div>
                        <p className="font-medium text-red-800">{stats.low_stock_alerts} Item{stats.low_stock_alerts > 1 ? 's' : ''} Low on Stock</p>
                        <p className="text-sm text-red-600">Click to manage inventory</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatCard title="Total Projects" value={stats?.total || 0} icon={FileText} color="emerald" />
            <StatCard title="Pending Review" value={stats?.submitted || 0} icon={AlertCircle} color="blue" />
            <StatCard title="Approved" value={stats?.approved || 0} icon={CheckCircle2} color="green" />
            <StatCard title="Total Revenue" value={`Rs ${((stats?.total_revenue || 0) / 100000).toFixed(1)}L`} icon={DollarSign} trend={`${stats?.conversion_rate || 0}% conversion`} color="amber" />
          </div>

          <Card className="border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between py-4 px-6 border-b border-slate-200">
              <CardTitle className="text-lg font-['Outfit'] text-slate-900">Recent Projects</CardTitle>
              <Link to="/dashboard/projects"><Button variant="ghost" size="sm" className="text-emerald-600 hover:text-emerald-700" data-testid="view-all-projects-btn">View all</Button></Link>
            </CardHeader>
            <CardContent className="p-0">
              {recentProjects.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Customer</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Location</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Est. Cost</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Date</th>
                    </tr></thead>
                    <tbody>{recentProjects.map((project) => (<ProjectRow key={project.id} project={project} onClick={() => navigate(`/dashboard/projects/${project.id}`)} />))}</tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-slate-500">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-slate-300" />
                  <p>No projects yet</p>
                  <Link to="/dashboard/projects/new"><Button className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white">Create your first project</Button></Link>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
