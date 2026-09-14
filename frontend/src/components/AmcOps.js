import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, MapPin, Send, Loader2, UserCheck, Route } from 'lucide-react';
import { toast } from 'sonner';
import { amcAPI, usersAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const inr = (v) => (v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);

/** Iter 53 — AMC operations: follow-up pipeline, scheduled-visit calendar, pincode batching, customer outbox. */
export function AmcOpsPanel({ canManage }) {
  const [followUps, setFollowUps] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [batching, setBatching] = useState(null);
  const [outbox, setOutbox] = useState([]);
  const [techs, setTechs] = useState([]);
  const [dlg, setDlg] = useState(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [f, s, b, o] = await Promise.all([amcAPI.followUps(), amcAPI.schedule(), canManage ? amcAPI.batching(days) : Promise.resolve({ data: null }), amcAPI.outbox(true)]);
      setFollowUps(f.data.rows || []); setSchedule(s.data || []); setBatching(b.data); setOutbox(o.data.rows || []);
      if (canManage) usersAPI.getAll().then(r => setTechs(r.data || [])).catch(() => {});
    } catch (e) { console.warn('amc ops load failed', e); }
  }, [canManage, days]);
  useEffect(() => { load(); }, [load]);

  const scheduleVisit = async () => {
    setBusy('schedule');
    try {
      const tech = techs.find(t => t.id === dlg.technician_id);
      const r = await amcAPI.scheduleWithNotifications(dlg.contract_id, { scheduled_date: dlg.date, technician_id: dlg.technician_id || null, technician_name: tech?.name || null, lead_days: [3, 1], notes: dlg.notes || '' });
      toast.success(`Visit scheduled · ${r.data.notifications_created} reminders queued (3 days & 1 day before)`);
      setDlg(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Scheduling failed'); }
    finally { setBusy(''); }
  };
  const markSent = async (n) => { try { await amcAPI.outboxSent(n.id); load(); } catch (e) { toast.error('Failed'); } };

  return (
    <div className="space-y-4" data-testid="amc-ops-panel">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="amc-followups-card">
          <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><UserCheck className="h-4 w-4 text-emerald-600" />Customers to follow up for AMC <Badge variant="secondary">{followUps.length}</Badge></CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {followUps.length === 0 && <p className="text-xs text-slate-400" data-testid="amc-followups-empty">No completed projects flagged as interested yet — set the flag on a completed project's page.</p>}
            {followUps.slice(0, 8).map(f => (
              <div key={f.project_id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-1.5" data-testid={`amc-followup-${f.project_id}`}>
                <div><p className="font-medium text-slate-800">{f.customer_name}</p><p className="text-[11px] text-slate-400">{f.reference_number} · {f.district || f.pincode || '—'} · {f.system_size_kw || '?'} kW · {f.interest?.notes}</p></div>
                {canManage && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => { try { await amcAPI.createFromProject(f.project_id); toast.success('AMC contract created'); load(); } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); } }} data-testid={`amc-followup-convert-${f.project_id}`}>Create contract</Button>}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card data-testid="amc-schedule-card">
          <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><CalendarClock className="h-4 w-4 text-blue-600" />Upcoming scheduled visits <Badge variant="secondary">{schedule.length}</Badge></CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {schedule.length === 0 && <p className="text-xs text-slate-400" data-testid="amc-schedule-empty">Nothing scheduled — use "Schedule" on a batch below or on a contract.</p>}
            {schedule.slice(0, 8).map(v => (
              <div key={v.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-1.5" data-testid={`amc-scheduled-${v.id}`}>
                <div><p className="font-medium text-slate-800">{v.scheduled_date} · {v.customer_name}</p><p className="text-[11px] text-slate-400">{v.contract_number} · {v.district || '—'} · {v.technician_name || 'technician TBD'}</p></div>
                <Badge variant="outline" className="text-[10px] capitalize">{v.visit_type}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {canManage && batching && (
        <Card data-testid="amc-batching-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 flex-wrap gap-2">
            <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Route className="h-4 w-4 text-amber-600" />Suggested trip batches <span className="text-xs text-slate-400 font-normal">visits due in the next</span>
              <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v))}><SelectTrigger className="h-7 w-24 text-xs" data-testid="amc-batching-days"><SelectValue /></SelectTrigger><SelectContent>{[14, 30, 60, 90].map(d => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}</SelectContent></Select>
            </CardTitle>
            <p className="text-xs text-slate-500" data-testid="amc-batching-summary">{batching.due_visits} visit(s) due · ₹{batching.km_cost}/km · {batching.hq_geocoded ? `from HQ ${batching.hq_pincode}` : 'HQ pincode not geocoded — distances unavailable, grouping by district only'} · potential saving <b className="text-emerald-700">{inr(batching.total_saving)}</b></p>
          </CardHeader>
          <CardContent className="space-y-2">
            {batching.clusters.length === 0 && <p className="text-xs text-slate-400" data-testid="amc-batching-empty">No AMC visits due in this window.</p>}
            {batching.clusters.map(g => (
              <div key={g.cluster} className="rounded-md border border-slate-200 p-3" data-testid={`amc-cluster-${g.cluster}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800 flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-amber-600" />{g.cluster} <Badge variant="secondary">{g.count} visit{g.count === 1 ? '' : 's'}</Badge></div>
                  <p className="text-xs text-slate-600">Separate trips <b>{inr(g.separate_trip_cost)}</b> → one trip <b className="text-emerald-700">{inr(g.batched_trip_cost)}</b>{g.saving != null && <> · saves <b>{inr(g.saving)}</b></>} · revenue {inr(g.visit_revenue)} · margin {inr(g.margin_batched)}{g.margin_batched != null && g.margin_batched < 0 && <span className="text-rose-600"> (loss — adjust)</span>}</p>
                </div>
                <p className="text-xs text-emerald-800 mt-1" data-testid={`amc-cluster-suggestion-${g.cluster}`}>{g.suggestion} — earliest due {g.suggested_date}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.contracts.map(c => (
                    <button key={c.contract_id} type="button" disabled={c.already_scheduled} onClick={() => setDlg({ contract_id: c.contract_id, customer: c.customer_name, date: g.suggested_date, technician_id: '', notes: `Batched with ${g.cluster} cluster` })}
                      className={`text-xs rounded-full border px-2 py-0.5 ${c.already_scheduled ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-300 hover:border-slate-500'}`} data-testid={`amc-cluster-contract-${c.contract_id}`}>
                      {c.customer_name} · {c.pincode || '—'}{c.distance_km != null ? ` · ${c.distance_km} km` : ''} · due {c.due_date}{c.already_scheduled ? ' ✓ scheduled' : ' · Schedule'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card data-testid="amc-outbox-card">
        <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Send className="h-4 w-4 text-indigo-600" />Customer reminders outbox <Badge variant="secondary">{outbox.length}</Badge></CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {outbox.length === 0 && <p className="text-xs text-slate-400" data-testid="amc-outbox-empty">No customer reminders pending.</p>}
          {outbox.map(n => (
            <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-slate-100 pb-1.5" data-testid={`amc-outbox-${n.id}`}>
              <div className="min-w-0"><p className="font-medium text-slate-800">{n.title}</p><p className="text-[11px] text-slate-400">send on {n.notify_at?.slice(0, 10)} · {n.phone || 'no phone on file'}</p></div>
              <div className="flex gap-1.5">
                {n.whatsapp_url && <a href={n.whatsapp_url} target="_blank" rel="noreferrer" className="text-xs rounded-md bg-emerald-600 text-white px-2 py-1" data-testid={`amc-outbox-wa-${n.id}`}>WhatsApp</a>}
                {n.sms_url && <a href={n.sms_url} className="text-xs rounded-md border px-2 py-1" data-testid={`amc-outbox-sms-${n.id}`}>SMS</a>}
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markSent(n)} data-testid={`amc-outbox-sent-${n.id}`}>Mark sent</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!dlg} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent className="max-w-md" data-testid="amc-schedule-dialog">
          <DialogHeader><DialogTitle>Schedule AMC visit — {dlg?.customer}</DialogTitle></DialogHeader>
          {dlg && <div className="space-y-2">
            <div className="space-y-1"><Label className="text-xs">Visit date</Label><Input type="date" value={dlg.date} onChange={(e) => setDlg(d => ({ ...d, date: e.target.value }))} className="h-9" data-testid="amc-schedule-date" /></div>
            <div className="space-y-1"><Label className="text-xs">Technician</Label>
              <Select value={dlg.technician_id || 'none'} onValueChange={(v) => setDlg(d => ({ ...d, technician_id: v === 'none' ? '' : v }))}><SelectTrigger className="h-9" data-testid="amc-schedule-tech"><SelectValue placeholder="Assign later" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Assign later</SelectItem>{techs.map(t => <SelectItem key={t.id} value={t.id}>{t.name} · {t.role}</SelectItem>)}</SelectContent></Select></div>
            <p className="text-xs text-slate-500">Reminders go out 3 days and 1 day before: technician in-app (bell), customer via the outbox (WhatsApp/SMS one-tap).</p>
          </div>}
          <DialogFooter><Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button onClick={scheduleVisit} disabled={busy === 'schedule' || !dlg?.date} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="amc-schedule-confirm">{busy === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Schedule & queue reminders'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Small toggle on a completed project: "customer interested in AMC?" */
export function AmcInterestToggle({ projectId, interest, onChanged }) {
  const [busy, setBusy] = useState(false);
  const set = async (interested) => {
    setBusy(true);
    try { await amcAPI.setInterest(projectId, { interested, notes: interested ? 'Flagged after commissioning' : '' }); toast.success(interested ? 'Added to AMC follow-up list' : 'Removed from AMC follow-ups'); onChanged?.(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2.5 text-sm" data-testid="amc-interest-card">
      <div><p className="font-medium text-slate-800">AMC interest</p><p className="text-[11px] text-slate-400">{interest?.interested ? `Interested · set by ${interest.set_by} on ${interest.set_at?.slice(0, 10)}` : 'Has the customer asked about an annual maintenance contract?'}</p></div>
      {interest?.interested ? <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => set(false)} data-testid="amc-interest-off">Not interested</Button>
        : <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy} onClick={() => set(true)} data-testid="amc-interest-on">Interested in AMC</Button>}
    </div>
  );
}
