import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { 
  FolderPlus, 
  Search, 
  Filter,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  ArrowLeft,
  Loader2
} from 'lucide-react';

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-amber-100 text-amber-800', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-800', icon: AlertCircle },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800', icon: XCircle },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 }
};

export default function ProjectList() {
  const navigate = useNavigate();
  const { isAdmin, isManager } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await projectsAPI.getAll(filter === 'all' ? null : filter);
      setProjects(res.data);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchProjects();
  }, [filter, fetchProjects]);

  const filteredProjects = projects.filter(project => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      project.customer?.name?.toLowerCase().includes(query) ||
      project.customer?.phone?.includes(query) ||
      project.customer?.address?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">All Projects</h1>
              <p className="text-slate-500">{filteredProjects.length} projects</p>
            </div>
          </div>
          <Link to="/dashboard/projects/new">
            <Button className="bg-[#4ADE40] hover:bg-[#3dba35] text-black text-white" data-testid="new-project-btn">
              <FolderPlus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <Card className="border-slate-200 mb-6">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by customer name, phone, or address..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="search-input"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400" />
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="status-filter">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Projects List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#4ADE40]" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No projects found</h3>
              <p className="text-slate-500 mb-4">
                {searchQuery ? 'Try a different search term' : 'Create your first project to get started'}
              </p>
              {!searchQuery && (
                <Link to="/dashboard/projects/new">
                  <Button className="bg-[#4ADE40] hover:bg-[#3dba35] text-black text-white">
                    <FolderPlus className="h-4 w-4 mr-2" />
                    New Project
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredProjects.map((project) => {
              const config = statusConfig[project.status] || statusConfig.draft;
              const StatusIcon = config.icon;

              return (
                <Card 
                  key={project.id} 
                  className="border-slate-200 card-hover cursor-pointer"
                  onClick={() => navigate(`/dashboard/projects/${project.id}`)}
                  data-testid={`project-card-${project.id}`}
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-slate-900">
                            {project.customer?.name || 'Unknown Customer'}
                          </h3>
                          <Badge className={`${config.color} gap-1`}>
                            <StatusIcon className="h-3 w-3" />
                            {config.label}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                          <span>{project.customer?.phone || 'No phone'}</span>
                          <span>•</span>
                          <span className="truncate max-w-[300px]">
                            {project.location?.site_location_words || project.location?.address || '-'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-2">
                          Created by {project.created_by_name} • {new Date(project.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold font-['Outfit'] text-[#4ADE40]">
                          ₹{(project.cost_estimation?.total_cost || 0).toLocaleString('en-IN')}
                        </p>
                        <p className="text-sm text-slate-500">
                          {project.cost_estimation?.total_capacity_kw || 0} kW System
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
