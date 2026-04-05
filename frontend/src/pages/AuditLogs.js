import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { auditLogsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { 
  ArrowLeft,
  Loader2,
  History,
  User,
  FileText,
  Package,
  Settings,
  Trash2,
  Edit,
  Plus,
  Check,
  X,
  Send
} from 'lucide-react';

const actionConfig = {
  create: { label: 'Created', icon: Plus, color: 'bg-green-100 text-green-800' },
  update: { label: 'Updated', icon: Edit, color: 'bg-blue-100 text-blue-800' },
  delete: { label: 'Deleted', icon: Trash2, color: 'bg-red-100 text-red-800' },
  submit: { label: 'Submitted', icon: Send, color: 'bg-purple-100 text-purple-800' },
  approve: { label: 'Approved', icon: Check, color: 'bg-emerald-100 text-emerald-800' },
  reject: { label: 'Rejected', icon: X, color: 'bg-red-100 text-red-800' },
  complete: { label: 'Completed', icon: Check, color: 'bg-emerald-100 text-emerald-800' },
  deletion_request: { label: 'Deletion Requested', icon: Trash2, color: 'bg-amber-100 text-amber-800' },
  deletion_approved: { label: 'Deletion Approved', icon: Check, color: 'bg-red-100 text-red-800' },
  deletion_rejected: { label: 'Deletion Rejected', icon: X, color: 'bg-blue-100 text-blue-800' },
  force_delete: { label: 'Force Deleted', icon: Trash2, color: 'bg-red-100 text-red-800' }
};

const entityConfig = {
  project: { label: 'Project', icon: FileText },
  user: { label: 'User', icon: User },
  pricing: { label: 'Pricing', icon: Settings },
  inventory_item: { label: 'Inventory', icon: Package },
  inventory_location: { label: 'Location', icon: Package },
  terms_conditions: { label: 'Terms', icon: FileText }
};

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState('all');
  const [filterAction, setFilterAction] = useState('all');

  useEffect(() => {
    fetchLogs();
  }, [filterEntity, filterAction]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterEntity !== 'all') params.entity_type = filterEntity;
      if (filterAction !== 'all') params.action_type = filterAction;
      
      const res = await auditLogsAPI.getAll(params);
      setLogs(res.data);
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">Audit Logs</h1>
              <p className="text-slate-500">Activity history and change tracking</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card className="border-slate-200 mb-6">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">Entity:</span>
                <Select value={filterEntity} onValueChange={setFilterEntity}>
                  <SelectTrigger className="w-[150px]" data-testid="filter-entity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Entities</SelectItem>
                    <SelectItem value="project">Projects</SelectItem>
                    <SelectItem value="user">Users</SelectItem>
                    <SelectItem value="pricing">Pricing</SelectItem>
                    <SelectItem value="inventory_item">Inventory</SelectItem>
                    <SelectItem value="terms_conditions">Terms</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">Action:</span>
                <Select value={filterAction} onValueChange={setFilterAction}>
                  <SelectTrigger className="w-[150px]" data-testid="filter-action">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    <SelectItem value="create">Created</SelectItem>
                    <SelectItem value="update">Updated</SelectItem>
                    <SelectItem value="delete">Deleted</SelectItem>
                    <SelectItem value="approve">Approved</SelectItem>
                    <SelectItem value="reject">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logs List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : logs.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center">
              <History className="h-12 w-12 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No logs found</h3>
              <p className="text-slate-500">Activity logs will appear here</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => {
              const action = actionConfig[log.action_type] || { label: log.action_type, icon: History, color: 'bg-slate-100 text-slate-800' };
              const entity = entityConfig[log.entity_type] || { label: log.entity_type, icon: FileText };
              const ActionIcon = action.icon;
              const EntityIcon = entity.icon;

              return (
                <Card key={log.id} className="border-slate-200" data-testid={`log-${log.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className={`p-2 rounded-lg ${action.color}`}>
                        <ActionIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-slate-900">{log.user_name}</span>
                          <Badge className={action.color}>{action.label}</Badge>
                          <Badge variant="outline" className="gap-1">
                            <EntityIcon className="h-3 w-3" />
                            {entity.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {log.details || `${action.label} ${entity.label.toLowerCase()} (ID: ${log.entity_id.slice(0, 8)}...)`}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          {formatTimestamp(log.timestamp)}
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
