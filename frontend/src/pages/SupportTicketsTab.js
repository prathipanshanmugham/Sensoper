import { useState, useEffect, useCallback } from 'react';
import { supportAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Loader2, Plus, Ticket, Clock, AlertTriangle, TrendingUp, Star, Users, Settings } from 'lucide-react';

const STATUS_STYLES = { open: 'bg-slate-100 text-slate-700', assigned: 'bg-blue-100 text-blue-700', in_progress: 'bg-amber-100 text-amber-700', pending_customer: 'bg-purple-100 text-purple-700', resolved: 'bg-emerald-100 text-emerald-700', closed: 'bg-slate-200 text-slate-600', reopened: 'bg-rose-100 text-rose-700' };
const PRIORITY_STYLES = { low: 'bg-slate-100 text-slate-600', medium: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700' };
const SLA_STYLES = { on_track: 'bg-emerald-100 text-emerald-700', at_risk: 'bg-amber-100 text-amber-700', breached: 'bg-red-100 text-red-700' };
const CATEGORIES = ['generation_drop', 'inverter_fault', 'no_power', 'billing_query', 'net_metering_issue', 'physical_damage', 'warranty_claim', 'installation_query', 'other'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const REPORTED_VIA = ['phone', 'whatsapp', 'email', 'walk_in', 'app'];

const emptyTicket = () => ({ customer_name: '', contact_phone: '', contact_email: '', category: 'other', priority: 'medium', description: '', reported_via: 'phone', district: '', system_capacity_kw: 0 });

function KpiCard({ label, value, icon: Icon, testid, tone = 'slate' }) {
  const toneCls = { slate: 'text-slate-500', red: 'text-red-500', emerald: 'text-emerald-500', amber: 'text-amber-500' }[tone] || 'text-slate-500';
  return (
    <Card className="border-slate-200" data-testid={testid}><CardContent className="p-4">
      <div className={`flex items-center gap-2 mb-1 ${toneCls}`}><Icon className="h-4 w-4" /><span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span></div>
      <p className="text-xl font-bold text-slate-900">{value}</p>
    </CardContent></Card>
  );
}

export default function SupportTicketsTab() {
  const { isAdmin } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: 'all', priority: 'all', category: 'all', sla_bucket: 'all', search: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);
  const [showSLA, setShowSLA] = useState(false);
  const [sla, setSla] = useState(null);
  const [showClose, setShowClose] = useState(false);
  const [csat, setCsat] = useState(5);
  const [closeNotes, setCloseNotes] = useState('');
  const [form, setForm] = useState(emptyTicket());
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.priority !== 'all') params.priority = filters.priority;
      if (filters.category !== 'all') params.category = filters.category;
      if (filters.sla_bucket !== 'all') params.sla_bucket = filters.sla_bucket;
      if (filters.search) params.search = filters.search;
      const [d, t] = await Promise.all([supportAPI.dashboard(), supportAPI.tickets.list(params)]);
      setDashboard(d.data); setTickets(t.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openSLA = async () => { try { const r = await supportAPI.slaConfig.get(); setSla({ critical_response_hours: r.data.critical.response, critical_resolution_hours: r.data.critical.resolution, high_response_hours: r.data.high.response, high_resolution_hours: r.data.high.resolution, medium_response_hours: r.data.medium.response, medium_resolution_hours: r.data.medium.resolution, low_response_hours: r.data.low.response, low_resolution_hours: r.data.low.resolution }); setShowSLA(true); } catch (e) { alert('Could not load SLA config'); } };
  const saveSLA = async () => { try { await supportAPI.slaConfig.update(sla); setShowSLA(false); fetchAll(); } catch (e) { alert(e.response?.data?.detail || 'Save failed'); } };

  const handleCreate = async () => {
    if (!form.customer_name || !form.description) { alert('Customer & description required'); return; }
    setSaving(true);
    try { await supportAPI.tickets.create({ ...form, system_capacity_kw: parseFloat(form.system_capacity_kw) || 0 }); setShowCreate(false); setForm(emptyTicket()); fetchAll(); }
    catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setSaving(false); }
  };

  const transitionStatus = async (id, status) => { try { await supportAPI.tickets.transitionStatus(id, { status }); fetchAll(); if (selected && selected.id === id) { const r = await supportAPI.tickets.get(id); setSelected(r.data); } } catch (e) { alert(e.response?.data?.detail || 'Failed'); } };

  const openClose = (t) => { setSelected(t); setCsat(5); setCloseNotes(''); setShowClose(true); };
  const doClose = async () => { try { await supportAPI.tickets.close(selected.id, { customer_satisfaction_rating: csat, resolution_notes: closeNotes }); setShowClose(false); setSelected(null); fetchAll(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } };

  const [assignTo, setAssignTo] = useState('');
  const doAssign = async () => { if (!assignTo || !selected) return; try { await supportAPI.tickets.update(selected.id, { assigned_to: assignTo, assigned_to_name: assignTo, note: `Assigned to ${assignTo}` }); const r = await supportAPI.tickets.get(selected.id); setSelected(r.data); setAssignTo(''); fetchAll(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="space-y-5" data-testid="support-tab">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold font-['Outfit'] flex items-center gap-2"><Ticket className="h-5 w-5 text-emerald-600" />Customer Support Tickets</h2>
          <p className="text-xs text-slate-500">Reactive support requests — separate from scheduled maintenance visits</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <Button variant="outline" onClick={openSLA} className="gap-1.5" data-testid="sla-config-btn"><Settings className="h-4 w-4" />SLA Config</Button>}
          <Button onClick={() => setShowCreate(true)} className="bg-emerald-600 text-white gap-1.5" data-testid="new-ticket-btn"><Plus className="h-4 w-4" />New Ticket</Button>
        </div>
      </div>

      {dashboard && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Open Tickets" value={dashboard.open_tickets} icon={Ticket} testid="support-kpi-open" />
          <KpiCard label="Overdue by SLA" value={dashboard.overdue_by_sla} icon={AlertTriangle} testid="support-kpi-overdue" tone={dashboard.overdue_by_sla > 0 ? 'red' : 'slate'} />
          <KpiCard label="Avg Resolution (hrs)" value={dashboard.avg_resolution_hours} icon={Clock} testid="support-kpi-avgres" />
          <KpiCard label="Avg CSAT" value={dashboard.avg_csat ? `${dashboard.avg_csat} / 5` : '—'} icon={Star} testid="support-kpi-csat" tone="emerald" />
        </div>
      )}

      {dashboard && dashboard.top_recurring?.length > 0 && (
        <Card className="border-slate-200"><CardHeader className="py-3"><CardTitle className="text-sm font-['Outfit']">Top Recurring Categories (drives product/installation quality feedback)</CardTitle></CardHeader>
          <CardContent><div className="flex flex-wrap gap-2">
            {dashboard.top_recurring.map(([cat, n]) => <Badge key={cat} className="bg-emerald-50 text-emerald-700 border border-emerald-200">{cat.replace(/_/g,' ')} · {n}</Badge>)}
          </div></CardContent></Card>
      )}

      {/* Filters */}
      <Card className="border-slate-200"><CardContent className="p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Input placeholder="Search ticket # or customer..." value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} className="h-9" data-testid="ticket-search" />
        <Select value={filters.status} onValueChange={v => setFilters(p => ({ ...p, status: v }))}><SelectTrigger className="h-9" data-testid="ticket-status-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.keys(STATUS_STYLES).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
        <Select value={filters.priority} onValueChange={v => setFilters(p => ({ ...p, priority: v }))}><SelectTrigger className="h-9" data-testid="ticket-priority-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All priorities</SelectItem>{PRIORITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
        <Select value={filters.category} onValueChange={v => setFilters(p => ({ ...p, category: v }))}><SelectTrigger className="h-9" data-testid="ticket-category-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{CATEGORIES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g,' ')}</SelectItem>)}</SelectContent></Select>
        <Select value={filters.sla_bucket} onValueChange={v => setFilters(p => ({ ...p, sla_bucket: v }))}><SelectTrigger className="h-9" data-testid="ticket-sla-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All SLA</SelectItem><SelectItem value="on_track">On track</SelectItem><SelectItem value="at_risk">At risk</SelectItem><SelectItem value="breached">Breached</SelectItem></SelectContent></Select>
      </CardContent></Card>

      {/* Ticket list */}
      <Card className="border-slate-200"><CardContent className="p-0">
        <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="tickets-table">
          <thead className="bg-slate-50"><tr>
            <th className="text-left p-2">Ticket</th><th className="text-left p-2">Customer</th><th className="text-left p-2">Category</th><th className="text-left p-2">Priority</th><th className="text-left p-2">Status</th><th className="text-left p-2">SLA</th><th className="text-left p-2">Assigned</th><th className="text-right p-2">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {tickets.map(t => (
              <tr key={t.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(t)} data-testid={`ticket-row-${t.id}`}>
                <td className="p-2 font-medium">{t.ticket_number}</td>
                <td className="p-2">{t.customer_name}</td>
                <td className="p-2">{(t.category || '').replace(/_/g,' ')}</td>
                <td className="p-2"><Badge className={PRIORITY_STYLES[t.priority]}>{t.priority}</Badge></td>
                <td className="p-2"><Badge className={STATUS_STYLES[t.status]}>{t.status}</Badge></td>
                <td className="p-2"><Badge className={SLA_STYLES[t.sla_bucket]}>{t.sla_bucket.replace(/_/g,' ')}</Badge></td>
                <td className="p-2">{t.assigned_to_name || '—'}</td>
                <td className="p-2 text-right">
                  {t.status !== 'closed' && <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={(e) => { e.stopPropagation(); openClose(t); }} data-testid={`close-ticket-${t.id}`}>Close</Button>}
                </td>
              </tr>
            ))}
            {tickets.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-slate-400">No tickets match your filters.</td></tr>}
          </tbody>
        </table></div>
      </CardContent></Card>

      {/* Create ticket dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="create-ticket-dialog">
          <DialogHeader><DialogTitle>New Support Ticket</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1"><Label className="text-xs">Customer Name *</Label><Input value={form.customer_name} onChange={e => setForm(p => ({ ...p, customer_name: e.target.value }))} data-testid="ticket-customer-input" /></div>
            <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={form.contact_phone} onChange={e => setForm(p => ({ ...p, contact_phone: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Email</Label><Input value={form.contact_email} onChange={e => setForm(p => ({ ...p, contact_email: e.target.value }))} /></div>
            <div className="space-y-1"><Label className="text-xs">Category</Label>
              <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}><SelectTrigger data-testid="ticket-category-select"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g,' ')}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}><SelectTrigger data-testid="ticket-priority-select"><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Reported via</Label>
              <Select value={form.reported_via} onValueChange={v => setForm(p => ({ ...p, reported_via: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{REPORTED_VIA.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g,' ')}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">District</Label><Input value={form.district} onChange={e => setForm(p => ({ ...p, district: e.target.value }))} /></div>
            <div className="col-span-2 space-y-1"><Label className="text-xs">Description *</Label><Textarea rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} data-testid="ticket-description-input" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={handleCreate} disabled={saving} className="bg-emerald-600 text-white" data-testid="save-ticket-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Open Ticket'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ticket detail dialog */}
      <Dialog open={!!selected && !showClose} onOpenChange={v => !v && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="ticket-detail-dialog">
          {selected && (<>
            <DialogHeader><DialogTitle className="flex items-center gap-2">{selected.ticket_number} <Badge className={STATUS_STYLES[selected.status]}>{selected.status}</Badge> <Badge className={SLA_STYLES[selected.sla_bucket]}>{selected.sla_bucket.replace(/_/g,' ')}</Badge></DialogTitle></DialogHeader>
            <div className="space-y-4 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-xs text-slate-500">Customer</span><p className="font-medium">{selected.customer_name}</p></div>
                <div><span className="text-xs text-slate-500">Category</span><p>{(selected.category || '').replace(/_/g,' ')}</p></div>
                <div><span className="text-xs text-slate-500">Priority</span><p><Badge className={PRIORITY_STYLES[selected.priority]}>{selected.priority}</Badge></p></div>
                <div><span className="text-xs text-slate-500">SLA (response / resolution)</span><p>{selected.sla_response_hours}h / {selected.sla_resolution_hours}h</p></div>
                <div className="col-span-2"><span className="text-xs text-slate-500">Description</span><p>{selected.description}</p></div>
                {selected.assigned_to_name && <div><span className="text-xs text-slate-500">Assigned to</span><p>{selected.assigned_to_name}</p></div>}
                {selected.customer_satisfaction_rating && <div><span className="text-xs text-slate-500">CSAT</span><p>{selected.customer_satisfaction_rating} / 5</p></div>}
              </div>

              {selected.status !== 'closed' && <div className="flex gap-2 flex-wrap p-2 border rounded bg-slate-50">
                <Input placeholder="Assign to (technician name)" value={assignTo} onChange={e => setAssignTo(e.target.value)} className="h-8 flex-1 min-w-40" data-testid="assign-input" />
                <Button size="sm" onClick={doAssign} disabled={!assignTo} data-testid="assign-btn">Assign</Button>
                {['assigned','in_progress','pending_customer','resolved','reopened'].map(s => (
                  <Button key={s} size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => transitionStatus(selected.id, s)} data-testid={`transition-${s}`}>{s}</Button>
                ))}
              </div>}

              <div><p className="text-xs text-slate-500 mb-1">Timeline</p><div className="space-y-1 max-h-52 overflow-y-auto">
                {(selected.timeline || []).map((tl, i) => (
                  <div key={i} className="text-xs p-2 rounded bg-slate-50 border border-slate-100">
                    <span className="font-medium">{tl.actor}</span> · <span className="text-slate-500">{(tl.timestamp || '').slice(0,16).replace('T',' ')}</span> · <span className="text-emerald-700">{tl.action}</span>
                    {tl.note && <p className="text-slate-600 mt-0.5">{tl.note}</p>}
                  </div>
                ))}
              </div></div>
            </div>
            <DialogFooter>
              {selected.status !== 'closed' && <Button className="bg-emerald-600 text-white" onClick={() => openClose(selected)} data-testid="close-with-csat-btn">Close + Rate CSAT</Button>}
              <Button variant="outline" onClick={() => setSelected(null)}>Done</Button>
            </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>

      {/* CSAT close dialog */}
      <Dialog open={showClose} onOpenChange={setShowClose}>
        <DialogContent className="max-w-md" data-testid="csat-dialog">
          <DialogHeader><DialogTitle>Close Ticket — Customer Satisfaction</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex justify-center gap-2">
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => setCsat(n)} className={`p-2 ${n <= csat ? 'text-amber-400' : 'text-slate-300'}`} data-testid={`csat-star-${n}`}><Star className={`h-8 w-8 ${n <= csat ? 'fill-amber-400' : ''}`} /></button>
              ))}
            </div>
            <p className="text-center text-sm text-slate-500">CSAT: {csat} / 5</p>
            <Textarea rows={2} placeholder="Resolution notes (optional)" value={closeNotes} onChange={e => setCloseNotes(e.target.value)} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowClose(false)}>Cancel</Button><Button className="bg-emerald-600 text-white" onClick={doClose} data-testid="confirm-close-btn">Close &amp; Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SLA config dialog */}
      <Dialog open={showSLA} onOpenChange={setShowSLA}>
        <DialogContent className="max-w-md" data-testid="sla-config-dialog">
          <DialogHeader><DialogTitle>SLA Configuration (hours)</DialogTitle></DialogHeader>
          {sla && (<div className="space-y-3 py-2 text-sm">
            {['critical','high','medium','low'].map(p => (
              <div key={p} className="grid grid-cols-3 gap-2 items-center">
                <span className="capitalize font-medium">{p}</span>
                <Input type="number" value={sla[`${p}_response_hours`]} onChange={e => setSla(s => ({ ...s, [`${p}_response_hours`]: parseFloat(e.target.value) || 0 }))} placeholder="Response" className="h-8" data-testid={`sla-${p}-response`} />
                <Input type="number" value={sla[`${p}_resolution_hours`]} onChange={e => setSla(s => ({ ...s, [`${p}_resolution_hours`]: parseFloat(e.target.value) || 0 }))} placeholder="Resolution" className="h-8" data-testid={`sla-${p}-resolution`} />
              </div>
            ))}
            <p className="text-xs text-slate-400">Left: response target · Right: resolution target</p>
          </div>)}
          <DialogFooter><Button variant="outline" onClick={() => setShowSLA(false)}>Cancel</Button><Button className="bg-emerald-600 text-white" onClick={saveSLA} data-testid="save-sla-btn">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
