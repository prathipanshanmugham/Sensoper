import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { deletionRequestsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { 
  ArrowLeft,
  Loader2,
  Trash2,
  Check,
  X,
  Clock,
  FileText
} from 'lucide-react';

const statusConfig = {
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-800', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800', icon: Check },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800', icon: X }
};

export default function DeletionApprovals() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    fetchRequests();
  }, [filter]);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await deletionRequestsAPI.getAll(filter === 'all' ? null : filter);
      setRequests(res.data);
    } catch (error) {
      console.error('Failed to fetch deletion requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id) => {
    if (!window.confirm('Approve this deletion request? The project will be soft-deleted.')) return;
    
    setActionLoading(id);
    try {
      await deletionRequestsAPI.approve(id);
      fetchRequests();
    } catch (error) {
      console.error('Failed to approve:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id) => {
    if (!window.confirm('Reject this deletion request? The project status will be restored.')) return;
    
    setActionLoading(id);
    try {
      await deletionRequestsAPI.reject(id);
      fetchRequests();
    } catch (error) {
      console.error('Failed to reject:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">Deletion Approvals</h1>
              <p className="text-slate-500">
                {pendingCount > 0 ? `${pendingCount} pending requests` : 'No pending requests'}
              </p>
            </div>
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[150px]" data-testid="status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Requests List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#4ADE40]" />
          </div>
        ) : requests.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center">
              <Trash2 className="h-12 w-12 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No deletion requests</h3>
              <p className="text-slate-500">
                {filter === 'pending' ? 'All caught up!' : 'No requests match this filter'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const config = statusConfig[request.status] || statusConfig.pending;
              const StatusIcon = config.icon;

              return (
                <Card key={request.id} className="border-slate-200" data-testid={`deletion-request-${request.id}`}>
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <FileText className="h-5 w-5 text-slate-400" />
                          <h3 className="font-semibold text-slate-900">{request.project_name}</h3>
                          <Badge className={`${config.color} gap-1`}>
                            <StatusIcon className="h-3 w-3" />
                            {config.label}
                          </Badge>
                        </div>
                        <div className="space-y-1 text-sm text-slate-500">
                          <p>
                            <span className="font-medium">Requested by:</span> {request.requested_by}
                          </p>
                          <p>
                            <span className="font-medium">Reason:</span> {request.reason}
                          </p>
                          <p>
                            <span className="font-medium">Date:</span>{' '}
                            {new Date(request.requested_at).toLocaleString('en-IN')}
                          </p>
                          {request.resolved_by && (
                            <p>
                              <span className="font-medium">
                                {request.status === 'approved' ? 'Approved by:' : 'Rejected by:'}
                              </span>{' '}
                              {request.resolved_by} on {new Date(request.resolved_at).toLocaleString('en-IN')}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      {request.status === 'pending' && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleReject(request.id)}
                            disabled={actionLoading === request.id}
                            data-testid={`reject-deletion-${request.id}`}
                          >
                            {actionLoading === request.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <X className="h-4 w-4 mr-2" />
                                Reject
                              </>
                            )}
                          </Button>
                          <Button
                            className="bg-[#4ADE40] hover:bg-[#3dba35] text-black"
                            onClick={() => handleApprove(request.id)}
                            disabled={actionLoading === request.id}
                            data-testid={`approve-deletion-${request.id}`}
                          >
                            {actionLoading === request.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="h-4 w-4 mr-2" />
                                Approve
                              </>
                            )}
                          </Button>
                        </div>
                      )}
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
