import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { dailyUpdatesAPI, projectsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { Megaphone, ClipboardList, IndianRupee, Wrench, Loader2, Check, Minus, Plus } from 'lucide-react';

/** Iter 57 — Daily Updates rebuilt for a phone in a hurry: 4 types, chips over typing, recent-project one-tap, own history.
 *  Kept fields = exactly what reports read: leads counters → Marketing/CAC report; progress/payment/service → project timeline. */
const TYPES = [
  { id: 'leads', label: 'Leads', icon: Megaphone, color: 'pink', project: false },
  { id: 'progress', label: 'Site visit', icon: ClipboardList, color: 'emerald', project: true },
  { id: 'payment', label: 'Payment', icon: IndianRupee, color: 'amber', project: true },
  { id: 'om', label: 'Service', icon: Wrench, color: 'teal', project: true },
];
const WORK_CHIPS = ['Site survey', 'Structure erected', 'Panels mounted', 'Wiring done', 'Inverter commissioned', 'Net-meter applied', 'Handover done'];
const PCT_CHIPS = [10, 25, 50, 75, 100];
const PAY_CHIPS = [['upi', 'UPI'], ['cash', 'Cash'], ['bank_transfer', 'Bank'], ['cheque', 'Cheque'], ['emi', 'EMI']];
const SERVICE_CHIPS = ['Panel cleaning', 'Inverter fault', 'Wiring repair', 'Monitoring check', 'Customer training', 'Warranty claim'];
const LEAD_FIELDS = [['total_leads', 'New leads'], ['qualified_leads', 'Qualified'], ['site_visits', 'Site visits'], ['quotes_sent', 'Quotes sent'], ['followups', 'Follow-ups'], ['conversions', 'Won']];
const COLORS = { pink: 'bg-pink-600 border-pink-600', emerald: 'bg-emerald-600 border-emerald-600', amber: 'bg-amber-500 border-amber-500', teal: 'bg-teal-600 border-teal-600' };

function Chip({ active, onClick, children, testid }) {
  return <button type="button" onClick={onClick} className={`px-3.5 py-2.5 rounded-full border text-sm font-medium transition-colors active:scale-95 ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}`} data-testid={testid}>{children}</button>;
}

export default function DailyUpdatesPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [type, setType] = useState(params.get('project') ? 'progress' : 'leads');
  const [projectId, setProjectId] = useState(params.get('project') || '');
  const [projects, setProjects] = useState([]);
  const [mine, setMine] = useState([]);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({});
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    const from = new Date(); from.setDate(from.getDate() - 7);
    const [p, u] = await Promise.all([projectsAPI.getAll().catch(() => ({ data: [] })), dailyUpdatesAPI.list({ date_from: from.toISOString().slice(0, 10) }).catch(() => ({ data: [] }))]);
    setProjects((p.data || []).filter(x => x.status !== 'draft'));
    setMine((u.data || []).filter(x => x.created_by === user?.id));
  }, [user?.id]);
  useEffect(() => { load(); }, [load]);

  const recent = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const u of mine) { if (u.project_id && u.project_id !== 'general' && !seen.has(u.project_id)) { seen.add(u.project_id); const pr = projects.find(p => p.id === u.project_id); if (pr) out.push(pr); } if (out.length >= 3) break; }
    return out;
  }, [mine, projects]);
  const meta = TYPES.find(t => t.id === type);
  const today = new Date().toISOString().slice(0, 10);
  const ready = type === 'leads' ? Object.values(f).some(v => Number(v) > 0) : projectId && (type === 'progress' ? f.work_done : type === 'payment' ? Number(f.amount) > 0 : f.service);

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const data = type === 'leads' ? Object.fromEntries(LEAD_FIELDS.map(([k]) => [k, Number(f[k] || 0)])) : type === 'payment' ? { amount: Number(f.amount), payment_method: f.payment_method || 'upi', notes: f.notes || '' } : type === 'progress' ? { work_done: f.work_done, completion_pct: f.completion_pct || '', issues: f.issues || '' } : { service: f.service, notes: f.notes || '' };
      await dailyUpdatesAPI.create({ project_id: type === 'leads' ? 'general' : projectId, update_type: type, data });
      toast.success('Logged'); setF({}); await load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not save'); }
    finally { setSaving(false); }
  };

  const summarise = (u) => u.update_type === 'leads' ? `Leads ${u.data?.total_leads || 0} · won ${u.data?.conversions || 0}` : u.update_type === 'payment' ? `₹${Number(u.data?.amount || 0).toLocaleString('en-IN')} ${u.data?.payment_method || ''}` : u.data?.work_done || u.data?.service || u.data?.item_name || u.update_type;
  const projName = (id) => projects.find(p => p.id === id)?.customer?.name || (id === 'general' ? 'General' : '—');

  return (
    <div className="p-3 sm:p-6 max-w-lg mx-auto space-y-4" data-testid="daily-updates-page">
      <div><h1 className="text-2xl font-bold font-['Outfit']">Daily Update</h1><p className="text-sm text-slate-500">Tap, don't type. Under a minute.</p></div>

      <div className="grid grid-cols-4 gap-2" data-testid="du-type-chips">
        {TYPES.map(t => { const I = t.icon; return (
          <button key={t.id} type="button" onClick={() => { setType(t.id); setF({}); }} className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-xs font-semibold transition-colors ${type === t.id ? `${COLORS[t.color]} text-white` : 'bg-white border-slate-200 text-slate-600'}`} data-testid={`du-type-${t.id}`}><I className="h-5 w-5" />{t.label}</button>); })}
      </div>

      {meta.project && (
        <div className="space-y-2" data-testid="du-project-block">
          {recent.length > 0 && <div className="flex flex-wrap gap-2">{recent.map(p => <Chip key={p.id} active={projectId === p.id} onClick={() => setProjectId(p.id)} testid={`du-recent-${p.id}`}>{p.customer?.name || p.reference_number}</Chip>)}</div>}
          <Select value={projectId} onValueChange={setProjectId}><SelectTrigger className="h-12 text-base" data-testid="du-project-select"><SelectValue placeholder="Choose customer / project" /></SelectTrigger>
            <SelectContent className="max-h-72">{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.customer?.name || 'Unnamed'} · {p.reference_number}</SelectItem>)}</SelectContent></Select>
        </div>
      )}

      {type === 'leads' && (
        <div className="grid grid-cols-2 gap-2" data-testid="du-leads-fields">
          {LEAD_FIELDS.map(([k, label]) => (
            <div key={k} className="rounded-xl border border-slate-200 p-2.5 flex items-center justify-between bg-white">
              <span className="text-sm text-slate-700">{label}</span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => set(k, Math.max(0, Number(f[k] || 0) - 1))} data-testid={`du-lead-minus-${k}`}><Minus className="h-4 w-4" /></Button>
                <span className="w-7 text-center font-bold text-lg" data-testid={`du-lead-value-${k}`}>{Number(f[k] || 0)}</span>
                <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => set(k, Number(f[k] || 0) + 1)} data-testid={`du-lead-plus-${k}`}><Plus className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {type === 'progress' && (
        <div className="space-y-3" data-testid="du-progress-fields">
          <div className="flex flex-wrap gap-2">{WORK_CHIPS.map(c => <Chip key={c} active={f.work_done === c} onClick={() => set('work_done', c)} testid={`du-work-${c.replace(/\s+/g, '-')}`}>{c}</Chip>)}</div>
          <Input value={WORK_CHIPS.includes(f.work_done) ? '' : (f.work_done || '')} onChange={e => set('work_done', e.target.value)} placeholder="…or type what was done" className="h-12 text-base" data-testid="du-work-custom" />
          <div className="flex flex-wrap gap-2">{PCT_CHIPS.map(p => <Chip key={p} active={String(f.completion_pct) === String(p)} onClick={() => set('completion_pct', p)} testid={`du-pct-${p}`}>{p}%</Chip>)}</div>
          <Input value={f.issues || ''} onChange={e => set('issues', e.target.value)} placeholder="Any issue? (optional)" className="h-12 text-base" data-testid="du-issues" />
        </div>
      )}
      {type === 'payment' && (
        <div className="space-y-3" data-testid="du-payment-fields">
          <Input type="number" inputMode="decimal" value={f.amount || ''} onChange={e => set('amount', e.target.value)} placeholder="Amount ₹" className="h-14 text-2xl font-semibold" data-testid="du-amount" />
          <div className="flex flex-wrap gap-2">{PAY_CHIPS.map(([v, l]) => <Chip key={v} active={(f.payment_method || 'upi') === v} onClick={() => set('payment_method', v)} testid={`du-pay-${v}`}>{l}</Chip>)}</div>
        </div>
      )}
      {type === 'om' && (
        <div className="space-y-3" data-testid="du-service-fields">
          <div className="flex flex-wrap gap-2">{SERVICE_CHIPS.map(c => <Chip key={c} active={f.service === c} onClick={() => set('service', c)} testid={`du-service-${c.replace(/\s+/g, '-')}`}>{c}</Chip>)}</div>
          <Input value={f.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Note (optional)" className="h-12 text-base" data-testid="du-service-notes" />
        </div>
      )}

      <Button onClick={submit} disabled={!ready || saving} className={`w-full h-14 text-base font-semibold text-white ${COLORS[meta.color].split(' ')[0]} hover:opacity-90`} data-testid="du-submit">{saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5 mr-2" />Log {meta.label.toLowerCase()}</>}</Button>

      <div data-testid="du-history">
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">My entries · today {mine.filter(u => u.created_at?.startsWith(today)).length} · this week {mine.length}</p>
        {mine.length === 0 ? <p className="text-sm text-slate-400">Nothing logged in the last 7 days.</p> : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {mine.slice(0, 12).map(u => (
              <li key={u.id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm" data-testid={`du-history-${u.id}`}>
                <span className="truncate"><span className="font-medium text-slate-900">{projName(u.project_id)}</span> <span className="text-slate-500">· {summarise(u)}</span></span>
                <span className="text-[11px] text-slate-400 shrink-0">{u.created_at?.startsWith(today) ? u.created_at.slice(11, 16) : u.created_at?.slice(5, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
