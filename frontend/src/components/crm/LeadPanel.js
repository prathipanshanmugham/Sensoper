/* One lead, opened from the list or the board: call / WhatsApp, log what happened in two taps, set the next
 * follow-up, move the stage, and make a quotation or a project from it. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Phone, MessageCircle, FileText, FolderPlus, FolderOpen, Trash2, Loader2, Pencil, CalendarClock, X, Check, Flame, ChevronUp, ChevronDown,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { Button } from '../ui/button';
import { Chip, Field, inputCls, errText, inr, fmtDate, Loading } from '../kit/PageBits';
import Can from '../Can';
import { confirmAction } from '../kit/confirm';
import { crmAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { useHotkeys, MOD } from '../../lib/hotkeys';
import FromOdoo from '../odoo/FromOdoo';
import { STAGE_TONE, HEAT_TONE, OPEN_STAGES, waLink, telLink, firstName, ago, whenLabel, followUpChoices, loadMeta, leadsChanged, inrPlain } from './leadBits';

const LOG_TYPES = [['call', 'Call'], ['whatsapp', 'WhatsApp'], ['visit', 'Visit'], ['note', 'Note']];
const OUTCOMES = [['answered', 'Talked'], ['no_answer', 'No answer'], ['busy', 'Busy'], ['call_back', 'Call back later'], ['interested', 'Interested'], ['not_interested', 'Not interested']];
const QUOTE_TONE = { draft: 'slate', sent: 'blue', accepted: 'green', rejected: 'red', converted: 'green' };
const kbd = (k) => <kbd className="ml-1 hidden rounded border border-slate-200 bg-slate-50 px-1 text-[10px] font-medium text-slate-500 lg:inline">{k}</kbd>;

function FollowUpPicker({ lead, onSave, onCancel, busy }) {
  const choices = useMemo(() => followUpChoices(), []);
  const [day, setDay] = useState(lead.follow_up_on || choices[1].day);
  const [time, setTime] = useState(lead.follow_up_at || '');
  const [note, setNote] = useState(lead.follow_up_note || '');
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="followup-picker">
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => (
          <button key={c.key} type="button" onClick={() => setDay(c.day)} aria-pressed={day === c.day}
            className={`rounded-full border px-3 py-1.5 text-sm ${day === c.day ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{c.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date"><input type="date" className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} data-testid="followup-date" /></Field>
        <Field label="Time (optional)"><input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      <Field label="What to do"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Send the quotation, confirm the visit" /></Field>
      <div className="flex gap-2">
        <Button onClick={() => onSave({ follow_up_on: day, follow_up_at: time || null, follow_up_note: note })} disabled={busy || !day} className="h-10 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="followup-save">Save</Button>
        <Button variant="ghost" className="h-10" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function LostPicker({ reasons, onSave, onCancel, busy }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const final = reason === 'Other' ? other.trim() : reason;
  return (
    <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/60 p-3" data-testid="lost-picker">
      <p className="text-sm font-medium text-slate-900">Why isn’t it going ahead?</p>
      <div className="flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
            className={`rounded-full border px-3 py-1.5 text-sm ${reason === r ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{r}</button>
        ))}
      </div>
      {reason === 'Other' && <input className={inputCls} value={other} onChange={(e) => setOther(e.target.value)} placeholder="In a few words" autoFocus />}
      <div className="flex gap-2">
        <Button onClick={() => onSave(final)} disabled={busy || !final} className="h-10 bg-rose-600 text-white hover:bg-rose-700" data-testid="lost-save">Mark lost</Button>
        <Button variant="ghost" className="h-10" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function EditDetails({ lead, meta, onSave, onCancel, busy }) {
  const [f, setF] = useState({ name: lead.name, phone: lead.phone, email: lead.email, company: lead.company, area: lead.area, city: lead.city,
    pincode: lead.pincode, kind: lead.kind, channel: lead.channel, referred_by: lead.referred_by, message: lead.message });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3" data-testid="lead-edit">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={set('name')} /></Field>
        <Field label="Mobile"><input className={inputCls} inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input className={inputCls} value={f.email} onChange={set('email')} /></Field>
        <Field label="Company"><input className={inputCls} value={f.company} onChange={set('company')} /></Field>
        <Field label="Area"><input className={inputCls} value={f.area} onChange={set('area')} /></Field>
        <Field label="Town / city"><input className={inputCls} value={f.city} onChange={set('city')} /></Field>
        <Field label="PIN code"><input className={inputCls} inputMode="numeric" value={f.pincode} onChange={set('pincode')} /></Field>
        <Field label="What they want">
          <select className={inputCls} value={f.kind} onChange={set('kind')}>{(meta?.kinds || []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        </Field>
        <Field label="Came from">
          <select className={inputCls} value={f.channel} onChange={set('channel')}>{(meta?.channels || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        </Field>
        <Field label="Referred by"><input className={inputCls} value={f.referred_by} onChange={set('referred_by')} /></Field>
      </div>
      <Field label="What they said"><textarea className={`${inputCls} h-auto min-h-[64px] py-2`} value={f.message} onChange={set('message')} /></Field>
      <div className="flex gap-2">
        <Button onClick={() => onSave(f)} disabled={busy} className="h-10 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="lead-edit-save">Save details</Button>
        <Button variant="ghost" className="h-10" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default function LeadPanel({ id, onClose, onNext, onPrev, onChanged }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [l, setL] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);           // 'followup' | 'lost' | 'edit'
  const [logType, setLogType] = useState('call');
  const [outcome, setOutcome] = useState('');
  const [text, setText] = useState('');
  const [nextKey, setNextKey] = useState('');
  const noteRef = useRef(null);
  const choices = useMemo(() => followUpChoices(), [id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => crmAPI.get(id).then((r) => setL(r.data)).catch((e) => { toast.error(errText(e, 'Couldn’t open that lead')); onClose(); }), [id, onClose]);
  useEffect(() => { setL(null); setMode(null); setText(''); setOutcome(''); setNextKey(''); setLogType('call'); load(); }, [load]);
  useEffect(() => { loadMeta().then(setMeta).catch(() => {}); }, []);

  const done = (data, msg) => { setL(data); leadsChanged(); onChanged?.(); if (msg) toast.success(msg); };
  const save = async (patch, msg = 'Saved') => {
    setBusy(true);
    try { const r = await crmAPI.update(id, patch); done(r.data, msg); setMode(null); return true; }
    catch (e) { toast.error(errText(e)); return false; } finally { setBusy(false); }
  };
  const log = async () => {
    if (logType === 'note' && !text.trim()) { noteRef.current?.focus(); return; }
    const day = choices.find((c) => c.key === nextKey)?.day || null;
    setBusy(true);
    try {
      const r = await crmAPI.log(id, { type: logType, outcome: logType === 'note' ? null : (outcome || null), text, follow_up_on: day });
      done(r.data, logType === 'note' ? 'Note added' : 'Logged');
      setText(''); setOutcome(''); setNextKey('');
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!await confirmAction({ title: `Delete ${l.name || `+91 ${l.phone}`}?`, message: 'The lead and its history go for good. To keep the record, mark it lost instead.', confirmLabel: 'Delete', tone: 'danger' })) return;
    try { await crmAPI.remove(id); leadsChanged(); onChanged?.(); toast.success('Lead deleted'); onClose(); } catch (e) { toast.error(errText(e)); }
  };
  const whatsapp = () => {
    if (!l) return;
    window.open(waLink(l.phone, `Hi ${firstName(l.name)}, this is Sensoper — `), '_blank', 'noopener');
  };
  const newQuote = () => navigate(`/dashboard/quotations/new?lead=${id}`);

  useHotkeys([
    { keys: 'c', inDialog: true, when: () => !!l && !mode, run: () => { setLogType('call'); setTimeout(() => noteRef.current?.focus(), 0); } },
    { keys: 'w', inDialog: true, when: () => !!l, run: whatsapp },
    { keys: 'f', inDialog: true, when: () => !!l && OPEN_STAGES.includes(l.status), run: () => setMode('followup') },
    { keys: 'q', inDialog: true, when: () => !!l && can('module_material_quotes', 'create'), run: newQuote },
    { keys: 'j', inDialog: true, when: () => !!onNext, run: () => onNext?.() },
    { keys: 'k', inDialog: true, when: () => !!onPrev, run: () => onPrev?.() },
    // Ctrl+Enter saves the call / note — from the box, or after tapping an outcome or "call again" chip
    { keys: 'mod+enter', inDialog: true, inInput: true, when: () => !!l && !mode && (document.activeElement === noteRef.current || !!document.activeElement?.closest?.('[data-testid="lead-log"]') || !!text.trim() || !!outcome), run: log },
  ], [l, mode, logType, outcome, text, nextKey, onNext, onPrev]);

  const isOpen = l && OPEN_STAGES.includes(l.status);
  const fuTone = l?.follow_up_state === 'overdue' ? 'text-rose-700' : l?.follow_up_state === 'today' ? 'text-amber-800' : 'text-slate-700';

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl" data-testid="lead-panel">
        {!l ? <div className="p-6"><SheetTitle className="sr-only">Lead</SheetTitle><Loading /></div> : (<>
          <SheetHeader className="space-y-1 border-b border-slate-200 px-5 pb-4 pt-5 text-left">
            <div className="flex items-center gap-2 pr-8">
              {(onPrev || onNext) && (
                <div className="mr-1 hidden gap-0.5 sm:flex">
                  <button type="button" onClick={onPrev} disabled={!onPrev} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label="Previous lead (K)" title="Previous lead (K)"><ChevronUp className="h-4 w-4" /></button>
                  <button type="button" onClick={onNext} disabled={!onNext} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label="Next lead (J)" title="Next lead (J)"><ChevronDown className="h-4 w-4" /></button>
                </div>
              )}
              <SheetTitle className="min-w-0 truncate font-['Outfit'] text-xl" data-testid="lead-panel-name">{l.name || <span className="text-slate-500">+91 {l.phone}</span>}</SheetTitle>
              <Chip tone={STAGE_TONE[l.status]}>{l.status_label}</Chip>
              {l.heat && <Chip tone={HEAT_TONE[l.heat]}>{l.heat === 'hot' && <Flame className="h-3 w-3" />}{l.heat[0].toUpperCase() + l.heat.slice(1)}</Chip>}
            </div>
            <SheetDescription className="text-xs">
              {l.number} — {l.kind_label} — {l.source_label}{l.referred_by ? `, referred by ${l.referred_by}` : ''} — added {ago(l.created_at)}{l.created_by_name ? ` by ${l.created_by_name}` : ''}
            </SheetDescription>
            <div className="flex flex-wrap gap-2 pt-2">
              <a href={telLink(l.phone)} className="inline-flex"><Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="lead-call"><Phone className="h-4 w-4" />+91 {l.phone}</Button></a>
              <Button onClick={whatsapp} className="h-10 gap-1.5 bg-[#12803D] text-white hover:bg-[#0F6E34]" data-testid="lead-whatsapp"><MessageCircle className="h-4 w-4" />WhatsApp{kbd('W')}</Button>
              <Button variant="outline" className="h-10 gap-1.5" onClick={() => setMode(mode === 'edit' ? null : 'edit')} data-testid="lead-edit-btn"><Pencil className="h-4 w-4" />Edit</Button>
            </div>
          </SheetHeader>

          <div className="space-y-5 px-5 py-4 text-sm">
            {mode === 'edit' && <EditDetails lead={l} meta={meta} busy={busy} onCancel={() => setMode(null)} onSave={(f) => save(f, 'Details saved')} />}

            {/* next follow-up */}
            {isOpen && (mode === 'followup' ? (
              <FollowUpPicker lead={l} busy={busy} onCancel={() => setMode(null)} onSave={(p) => save(p, 'Follow-up saved')} />
            ) : (
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3" data-testid="lead-next">
                <CalendarClock className={`mt-0.5 h-5 w-5 shrink-0 ${l.follow_up_state === 'overdue' ? 'text-rose-600' : l.follow_up_state === 'today' ? 'text-amber-600' : 'text-slate-400'}`} />
                <div className="min-w-0 flex-1">
                  {l.follow_up_on ? (<>
                    <p className={`font-semibold ${fuTone}`}>Next: {whenLabel(l.follow_up_on, l.follow_up_at)}</p>
                    {l.follow_up_note && <p className="text-slate-600">{l.follow_up_note}</p>}
                  </>) : <p className="text-slate-500">No follow-up planned. Set one so it shows on the right day.</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setMode('followup')} data-testid="lead-set-followup">{l.follow_up_on ? 'Change' : 'Set'}{kbd('F')}</Button>
                  {l.follow_up_on && <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-500" onClick={() => save({ follow_up_on: '' }, 'Follow-up cleared')} aria-label="Clear the follow-up"><X className="h-4 w-4" /></Button>}
                </div>
              </div>
            ))}

            {/* log what happened */}
            <div className="space-y-3 rounded-lg border border-slate-200 p-3" data-testid="lead-log">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">What happened?</p>
                <div className="flex rounded-md bg-slate-100 p-0.5" role="tablist" aria-label="Kind">
                  {LOG_TYPES.map(([k, label]) => (
                    <button key={k} type="button" role="tab" aria-selected={logType === k} onClick={() => { setLogType(k); setOutcome(''); }}
                      className={`rounded px-2.5 py-1 text-xs ${logType === k ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600'}`} data-testid={`log-type-${k}`}>{label}</button>
                  ))}
                </div>
              </div>
              {logType !== 'note' && (
                <div className="flex flex-wrap gap-1.5">
                  {OUTCOMES.map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setOutcome(outcome === k ? '' : k)} aria-pressed={outcome === k}
                      className={`rounded-full border px-2.5 py-1 text-xs ${outcome === k ? (k === 'not_interested' ? 'border-rose-600 bg-rose-600 text-white' : 'border-emerald-600 bg-emerald-600 text-white') : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}
                      data-testid={`log-outcome-${k}`}>{label}</button>
                  ))}
                </div>
              )}
              <textarea ref={noteRef} value={text} onChange={(e) => setText(e.target.value)} rows={2}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25"
                placeholder={logType === 'note' ? 'Write a note…' : 'What did they say? (optional)'} data-testid="lead-log-text" />
              {isOpen && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-slate-500">Call again</span>
                  {choices.map((c) => (
                    <button key={c.key} type="button" onClick={() => setNextKey(nextKey === c.key ? '' : c.key)} aria-pressed={nextKey === c.key}
                      className={`rounded-full border px-2.5 py-1 text-xs ${nextKey === c.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                      data-testid={`log-next-${c.key}`}>{c.label}</button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-400">{logType === 'note' ? '' : 'Logging a call clears today’s follow-up unless you pick the next one.'}</p>
                <Button onClick={log} disabled={busy || (logType === 'note' && !text.trim())} className="h-9 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" data-testid="lead-log-save">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save<kbd className="ml-1 hidden rounded bg-white/15 px-1 text-[10px] lg:inline">{MOD}+Enter</kbd>
                </Button>
              </div>
            </div>

            {/* stage, owner, value */}
            {mode === 'lost' ? (
              <LostPicker reasons={meta?.lost_reasons || ['Other']} busy={busy} onCancel={() => setMode(null)} onSave={(reason) => save({ status: 'lost', lost_reason: reason }, 'Marked lost')} />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Stage">
                  {(meta?.stages || []).map((s) => (
                    <button key={s.key} type="button" role="radio" aria-checked={l.status === s.key} disabled={busy}
                      onClick={() => { if (s.key === l.status) return; if (s.key === 'lost') setMode('lost'); else save({ status: s.key }, `Moved to ${s.label}`); }}
                      className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${l.status === s.key ? (s.key === 'lost' ? 'border-slate-700 bg-slate-700 text-white' : s.key === 'won' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-sky-700 bg-sky-700 text-white') : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}
                      data-testid={`lead-stage-${s.key}`}>{s.label}</button>
                  ))}
                </div>
                {l.status === 'lost' && l.lost_reason && <p className="text-xs text-slate-500">Why: {l.lost_reason}</p>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Handled by" className="col-span-2">
                    <select className={inputCls} value={l.assigned_to || ''} onChange={(e) => save({ assigned_to: e.target.value }, e.target.value ? 'Handed over' : 'Unassigned')} disabled={busy} data-testid="lead-owner">
                      <option value="">Nobody yet</option>
                      {(meta?.people || []).map((p) => <option key={p.id} value={p.id}>{p.id === meta?.me ? `${p.name} (me)` : p.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Value (₹)">
                    <input key={`v-${l.value}`} className={inputCls} inputMode="numeric" defaultValue={l.value ?? ''} placeholder="—"
                      onBlur={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); if (String(l.value ?? '') !== v) save({ value: v === '' ? null : v }, 'Value saved'); }} data-testid="lead-value" />
                  </Field>
                  <Field label="Size (kW)">
                    <input key={`k-${l.kw}`} className={inputCls} inputMode="decimal" defaultValue={l.kw ?? ''} placeholder="—"
                      onBlur={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); if (String(l.kw ?? '') !== v) save({ kw: v === '' ? null : v }, 'Size saved'); }} />
                  </Field>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="mr-1 text-xs text-slate-500">How keen</span>
                  {[['hot', 'Hot'], ['warm', 'Warm'], ['cold', 'Cold']].map(([k, label]) => (
                    <button key={k} type="button" onClick={() => save({ heat: l.heat === k ? '' : k }, 'Saved')} aria-pressed={l.heat === k}
                      className={`rounded-full border px-2.5 py-1 text-xs ${l.heat === k ? (k === 'hot' ? 'border-rose-600 bg-rose-600 text-white' : k === 'warm' ? 'border-amber-500 bg-amber-500 text-white' : 'border-sky-600 bg-sky-600 text-white') : 'border-slate-300 bg-white text-slate-700'}`}>{label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* make something from it */}
            <div className="flex flex-wrap gap-2">
              <Can module="module_material_quotes" action="create">
                <Button variant="outline" className="h-10 gap-1.5" onClick={newQuote} data-testid="lead-new-quote"><FileText className="h-4 w-4" />Material quotation{kbd('Q')}</Button>
              </Can>
              {l.project_id
                ? <Button variant="outline" className="h-10 gap-1.5" onClick={() => navigate(`/dashboard/projects/${l.project_id}`)}><FolderOpen className="h-4 w-4" />Open {l.project_reference || 'project'}</Button>
                : l.kind !== 'shop_order' && <Can module="module_projects" action="create"><Button variant="outline" className="h-10 gap-1.5" onClick={() => navigate(`/dashboard/projects/new?lead=${id}`)} data-testid="lead-make-project"><FolderPlus className="h-4 w-4" />Start project (site visit)</Button></Can>}
            </div>

            {(l.quotes || []).length > 0 && (
              <div className="rounded-lg border border-slate-200" data-testid="lead-quotes">
                <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">Quotations</p>
                {l.quotes.map((q) => (
                  <button key={q.id} type="button" onClick={() => navigate(`/dashboard/quotations/${q.id}`)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50">
                    <span className="min-w-0 truncate"><b className="font-medium">{q.number}{q.revision ? `-R${q.revision}` : ''}</b> <span className="text-xs text-slate-500">{fmtDate(q.created_at)}</span></span>
                    <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums">{inr(q.grand_total)}</span><Chip tone={QUOTE_TONE[q.status]}>{{ draft: 'Draft', sent: 'Sent', accepted: 'Accepted', rejected: 'Not accepted', converted: 'Sold' }[q.status]}</Chip></span>
                  </button>
                ))}
              </div>
            )}

            {/* what we know */}
            {(l.message || l.area || l.email || l.company || l.pincode || l.city) && (
              <div className="space-y-2">
                {l.message && <p className="rounded-lg bg-slate-50 p-3 text-slate-700">“{l.message}”</p>}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {[['Area', [l.area, l.city].filter(Boolean).join(', ')], ['PIN code', l.pincode], ['Email', l.email], ['Company', l.company], ['Best time', l.best_time],
                    ['Asked', l.submissions > 1 ? `${l.submissions} times` : '']].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="min-w-0"><dt className="text-xs text-slate-500">{k}</dt><dd className="truncate text-slate-800">{v}</dd></div>))}
                </dl>
              </div>
            )}
            {Object.keys(l.calc || {}).length > 0 && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-700">Their figures from the website calculator</p>
                <div className="grid grid-cols-3 gap-2">
                  {[['Bill', l.calc.bill && inrPlain(l.calc.bill)], ['System', l.calc.kw && `${l.calc.kw} kW`], ['Pump', l.calc.pump_hp && `${l.calc.pump_hp} HP`],
                    ['Price shown', l.calc.price && inrPlain(l.calc.price)], ['Subsidy', l.calc.subsidy && inrPlain(l.calc.subsidy)], ['Saving', l.calc.monthly_saving && `${inrPlain(l.calc.monthly_saving)}/mo`]]
                    .filter(([, v]) => v).map(([k, v]) => <div key={k}><p className="text-[11px] text-slate-500">{k}</p><p className="font-medium tabular-nums">{v}</p></div>)}
                </div>
              </div>
            )}
            {(l.items || []).length > 0 && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-1 text-xs font-semibold text-slate-700">Shop order — {l.delivery !== 'pickup' ? 'deliver it' : `pick up${l.pickup_store ? ` at ${l.pickup_store.name}` : ''}`}</p>
                {l.items.map((it) => <div key={it.listing_id} className="flex justify-between py-0.5"><span>{it.title} × {it.qty}</span><span className="tabular-nums">{inr(it.amount)}</span></div>)}
                <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold"><span>Total incl. GST</span><span className="tabular-nums">{inr(l.order_total)}</span></div>
              </div>
            )}

            {l.odoo && <FromOdoo odoo={l.odoo} url={meta?.odoo?.url} labels={meta?.odoo?.lead_fields} rows={[['Odoo stage', l.odoo.stage], ['Odoo salesperson', l.odoo.salesperson]]} />}

            {/* history */}
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">History</p>
              <ol className="space-y-2.5 border-l-2 border-slate-100 pl-3" data-testid="lead-history">
                {(l.activity || []).map((a, i) => (
                  <li key={`${a.at}-${i}`}><p className="text-slate-800">{a.text}</p><p className="text-[11px] text-slate-500">{a.by} — {ago(a.at)}</p></li>
                ))}
              </ol>
            </div>

            <Can module="module_leads" action="delete">
              <div className="border-t border-slate-100 pt-3"><Button variant="ghost" className="gap-1.5 text-rose-600" onClick={remove} data-testid="lead-delete"><Trash2 className="h-4 w-4" />Delete lead</Button></div>
            </Can>
          </div>
        </>)}
      </SheetContent>
    </Sheet>
  );
}
