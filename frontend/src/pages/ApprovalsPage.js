import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { approvalsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import {
  Loader2, CheckCircle2, XCircle, Clock, Trash2, Percent,
  FileText, Package, Users, Filter, Search, AlertTriangle
} from 'lucide-react';

const TYPE_CONFIG = {
  deletion: { label: 'Deletion', icon: Trash2, color: 'bg-red-100 text-red-800' },
  margin_change: { label: 'Margin Change', icon: Percent, color: 'bg-amber-100 text-amber-800' },
  quotation_approval: { label: 'Quotation', icon: FileText, color: 'bg-blue-100 text-blue-800' },
  inventory_edit: { label: 'Inventory Edit', icon: Package, color: 'bg-purple-100 text-purple-800' },
  user_access_change: { label: 'User Access', icon: Users, color: 'bg-cyan-100 text-cyan-800' }
};

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-800', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800', icon: XCircle }
};

export default function ApprovalsPage() {
  const { isAdmin, isManager } = useAuth();
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => { fetchApprovals(); }, [activeTab, typeFilter]);

  const fetchApprovals = async () => {
    setLoading(true);
    try {
      const params = { status: activeTab };
      if (typeFilter !== 'all') params.type = typeFilter;
      const res = await approvalsAPI.getAll(params);
      setApprovals(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleApprove = async (id) => {
    setActionLoading(id);
    try {
      await approvalsAPI.approve(id);
      fetchApprovals();
    } catch (err) { alert(err.response?.data?.detail || 'Failed to approve'); }
    finally { setActionLoading(null); }
  };

  const openRejectDialog = (approval) => {
    setRejectTarget(approval);
    setRejectReason('');
    setShowRejectDialog(true);
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setActionLoading(rejectTarget.id);
    try {
      await approvalsAPI.reject(rejectTarget.id, rejectReason);
      setShowRejectDialog(false);
      setRejectTarget(null);
      fetchApprovals();
    } catch (err) { alert(err.response?.data?.detail || 'Failed to reject'); }
    finally { setActionLoading(null); }
  };

  const filtered = approvals.filter(a => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return a.description?.toLowerCase().includes(q) ||
           a.requested_by_name?.toLowerCase().includes(q) ||
           a.type?.toLowerCase().includes(q);
  });

  const tabs = [
    { key: 'pending', label: 'Pending', icon: Clock },
    { key: 'approved', label: 'Approved', icon: CheckCircle2 },
    { key: 'rejected', label: 'Rejected', icon: XCircle }
  ];

  const pendingCount = activeTab === 'pending' ? filtered.length : null;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold font-['Outfit'] text-slate-900 mb-1" data-testid="approvals-title">Approvals</h1>
          <p className="text-sm text-slate-500">Review and manage all pending approval requests</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.key ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
              data-testid={`tab-${tab.key}`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.key === 'pending' && pendingCount !== null && pendingCount > 0 && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab.key ? 'bg-white/20' : 'bg-red-500 text-white'}`}>{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by description, user..." className="pl-10 h-11" data-testid="search-approvals" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-48 h-11" data-testid="type-filter">
              <Filter className="h-4 w-4 mr-2 text-slate-400" />
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Approvals List */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
        ) : filtered.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-16 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-slate-300" />
              <p className="text-lg font-medium text-slate-500">No {activeTab} approvals found</p>
              <p className="text-sm text-slate-400 mt-1">
                {activeTab === 'pending' ? 'All caught up! No pending requests.' : `No ${activeTab} requests matching your filters.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(approval => {
              const typeConf = TYPE_CONFIG[approval.type] || { label: approval.type, icon: FileText, color: 'bg-slate-100 text-slate-800' };
              const TypeIcon = typeConf.icon;
              const statusConf = STATUS_CONFIG[approval.status] || STATUS_CONFIG.pending;

              return (
                <Card key={approval.id} className="border-slate-200 hover:shadow-md transition-shadow" data-testid={`approval-${approval.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className={`p-2.5 rounded-lg ${typeConf.color}`}>
                        <TypeIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge className={typeConf.color} data-testid={`type-badge-${approval.id}`}>{typeConf.label}</Badge>
                          <Badge className={statusConf.color}>{statusConf.label}</Badge>
                          {approval.entity_type && (
                            <span className="text-xs text-slate-400">{approval.entity_type} {approval.entity_id ? `#${approval.entity_id.slice(-6)}` : ''}</span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-slate-900 mb-1" data-testid={`desc-${approval.id}`}>{approval.description || 'No description'}</p>
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span>By <strong>{approval.requested_by_name}</strong> ({approval.role})</span>
                          <span>{new Date(approval.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        {approval.status === 'approved' && approval.approved_by_name && (
                          <p className="text-xs text-green-600 mt-1">Approved by {approval.approved_by_name} on {new Date(approval.resolved_at).toLocaleDateString('en-IN')}</p>
                        )}
                        {approval.status === 'rejected' && (
                          <div className="mt-1">
                            <p className="text-xs text-red-600">Rejected by {approval.approved_by_name}</p>
                            {approval.rejection_reason && <p className="text-xs text-red-500 italic mt-0.5">Reason: {approval.rejection_reason}</p>}
                          </div>
                        )}
                      </div>
                      {approval.status === 'pending' && (isAdmin || isManager) && (
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm" onClick={() => handleApprove(approval.id)}
                            disabled={actionLoading === approval.id}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 gap-1"
                            data-testid={`approve-${approval.id}`}
                          >
                            {actionLoading === approval.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            Approve
                          </Button>
                          <Button
                            size="sm" variant="destructive" onClick={() => openRejectDialog(approval)}
                            disabled={actionLoading === approval.id} className="h-9 gap-1"
                            data-testid={`reject-${approval.id}`}
                          >
                            <XCircle className="h-3.5 w-3.5" />Reject
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

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Request</DialogTitle></DialogHeader>
          <div className="py-4">
            {rejectTarget && <p className="text-sm text-slate-600 mb-3">{rejectTarget.description}</p>}
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for rejection (optional)..." rows={3} data-testid="reject-approval-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={actionLoading} data-testid="confirm-reject-approval">
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
