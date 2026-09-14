import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, Check, X, Loader2, Trash2, FileText, ShoppingCart, Undo2, ShieldAlert, History } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { inboxAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';

const SOURCE_META = {
  approval: { label: 'Deletion / change request', icon: ShieldAlert, color: 'bg-red-100 text-red-800' },
  project_submission: { label: 'Project review', icon: FileText, color: 'bg-blue-100 text-blue-800' },
  deletion_request: { label: 'Project deletion', icon: Trash2, color: 'bg-rose-100 text-rose-800' },
  inbound_action: { label: 'Inbound reversal', icon: Undo2, color: 'bg-amber-100 text-amber-800' },
  purchase_order: { label: 'Purchase order', icon: ShoppingCart, color: 'bg-emerald-100 text-emerald-800' },
};
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Iter 53 — ONE inbox for every approval flow (generic engine, project reviews, project deletions, inbound reversals, POs). */
export default function ApprovalsPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState({ items: [], counts: {}, total: 0 });
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('pending');
  const [source, setSource] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [reject, setReject] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'pending') { const r = await inboxAPI.list(source); setData(r.data); }
      else { const r = await inboxAPI.history(); setHistory(r.data); }
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to load approvals'); }
    finally { setLoading(false); }
  }, [tab, source]);
  useEffect(() => { load(); }, [load]);

  const approve = async (it) => {
    setBusy(it.id);
    try { const r = await inboxAPI.approve(it.source, it.id); toast.success(r.data.result || 'Approved'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Approve failed'); }
    finally { setBusy(''); }
  };
  const doReject = async () => {
    setBusy(reject.id);
    try { await inboxAPI.reject(reject.source, reject.id, reason || 'Rejected'); toast.success('Rejected'); setReject(null); setReason(''); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Reject failed'); }
    finally { setBusy(''); }
  };
  const canAct = (it) => it.approver_roles.includes(isAdmin ? 'admin' : 'manager');

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4" data-testid="approvals-page">
      <div className="flex items-center gap-3">
        <Link to="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold font-['Outfit'] flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-emerald-600" />Approvals Inbox</h1>
          <p className="text-sm text-slate-500">Every request waiting on a decision — project reviews, deletions, inbound reversals and purchase orders — in one queue.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <button type="button" onClick={() => setTab('pending')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'pending' ? 'bg-white shadow' : 'text-slate-500'}`} data-testid="approvals-tab-pending">Pending {data.total > 0 && <span className="ml-1 text-xs bg-red-500 text-white rounded-full px-1.5">{data.total}</span>}</button>
          <button type="button" onClick={() => setTab('history')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'history' ? 'bg-white shadow' : 'text-slate-500'}`} data-testid="approvals-tab-history"><History className="inline h-3.5 w-3.5 mr-1" />History</button>
        </div>
        {tab === 'pending' && (
          <div className="flex flex-wrap gap-1" data-testid="approvals-source-filter">
            <FilterChip active={source === 'all'} onClick={() => setSource('all')} label="All" testid="approvals-source-all" />
            {Object.entries(SOURCE_META).map(([k, m]) => <FilterChip key={k} active={source === k} onClick={() => setSource(k)} label={`${m.label}${data.counts[k] ? ` (${data.counts[k]})` : ''}`} testid={`approvals-source-${k}`} />)}
          </div>
        )}
      </div>

      {loading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div> : tab === 'pending' ? (
        data.items.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-slate-400" data-testid="approvals-empty">Nothing waiting for approval.</CardContent></Card> : (
          <div className="space-y-2">
            {data.items.map(it => {
              const m = SOURCE_META[it.source]; const Icon = m.icon;
              return (
                <Card key={`${it.source}-${it.id}`} data-testid={`approval-item-${it.source}-${it.id}`}>
                  <CardContent className="p-4 flex flex-wrap items-start gap-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${m.color}`}><Icon className="h-4 w-4" /></div>
                    <div className="flex-1 min-w-[220px]">
                      <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-900">{it.title}</p><Badge variant="outline" className="text-[10px]">{m.label}</Badge></div>
                      <p className="text-sm text-slate-600 mt-0.5">{it.description}</p>
                      <p className="text-xs text-slate-400 mt-1">Requested by {it.requested_by_name || '—'} · {fmt(it.requested_at)}</p>
                      {it.data?.pricing_issues?.length > 0 && <p className="text-xs text-amber-700 mt-1" data-testid={`approval-pricing-issues-${it.id}`}>⚠ {it.data.pricing_issues.length} pricing line(s) missing GST% / margin%</p>}
                    </div>
                    <div className="flex gap-2">
                      {canAct(it) ? (<>
                        <Button size="sm" onClick={() => approve(it)} disabled={busy === it.id} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid={`approve-${it.source}-${it.id}`}>{busy === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => { setReject(it); setReason(''); }} disabled={busy === it.id} className="text-rose-700 border-rose-200" data-testid={`reject-${it.source}-${it.id}`}><X className="h-4 w-4 mr-1" />Reject</Button>
                      </>) : <Badge variant="outline" className="text-xs text-slate-500">Admin approval required</Badge>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : (
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-y border-slate-200 text-[10px] uppercase text-slate-500"><tr><th className="text-left px-3 py-2">Request</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Outcome</th><th className="text-left px-3 py-2">By</th><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Reason</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {history.map(h => (
                <tr key={`${h.source}-${h.id}`} data-testid={`history-${h.source}-${h.id}`}>
                  <td className="px-3 py-2 font-medium text-slate-800">{h.title}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{SOURCE_META[h.source]?.label}</td>
                  <td className="px-3 py-2"><Badge className={`${h.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'} hover:bg-inherit capitalize`}>{h.status}</Badge></td>
                  <td className="px-3 py-2 text-slate-600">{h.resolved_by_name || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{fmt(h.resolved_at)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{h.reason || '—'}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-400">No decisions yet</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      <Dialog open={!!reject} onOpenChange={(v) => !v && setReject(null)}>
        <DialogContent className="max-w-md" data-testid="reject-dialog">
          <DialogHeader><DialogTitle>Reject: {reject?.title}</DialogTitle></DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shared with the requester)" data-testid="reject-reason-input" />
          <DialogFooter><Button variant="ghost" onClick={() => setReject(null)}>Cancel</Button><Button className="bg-rose-600 hover:bg-rose-700 text-white" onClick={doReject} disabled={busy === reject?.id} data-testid="reject-confirm-btn">Reject</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterChip({ active, onClick, label, testid }) {
  return <button type="button" onClick={onClick} className={`px-2.5 py-1 rounded-full text-xs border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`} data-testid={testid}>{label}</button>;
}
