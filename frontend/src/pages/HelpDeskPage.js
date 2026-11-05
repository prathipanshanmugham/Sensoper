/* Help desk (internal support): anyone raises a request — laptop or phone, HR & salary, tools, office, the app — and
 * it goes to whoever handles that kind of request. A conversation with internal notes, status, due time, and a
 * rating once it's solved. Admins set the categories and who handles each. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Clock, Inbox, LifeBuoy, Loader2, Lock, MessageSquare, Plus, Settings2, Star, Trash2, UserCheck } from 'lucide-react';
import { helpdeskAPI, uploadAPI, usersAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useLiveRefresh } from '../lib/liveSync';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Card, Chip, Empty, Field, FileAttach, Loading, PageHeader, PillTabs, StarInput, Tile, Tiles, errText } from '../components/kit/PageBits';

const PRIORITY = { urgent: ['Urgent', 'red'], high: ['High', 'amber'], normal: ['Normal', 'slate'], low: ['Low', 'slate'] };
const STATUS_TONE = { open: 'blue', in_progress: 'violet', waiting: 'amber', resolved: 'green', closed: 'slate' };
const MOVE = { in_progress: 'Start working on it', waiting: 'Need something from them', resolved: 'Mark solved', closed: 'Close', open: 'Reopen' };
const MOVE_SELF = { closed: 'Close — I don’t need this any more', open: 'Not solved — reopen' };

/** "Waiting for you" is for the person who raised it; handlers see who it's waiting on. */
const statusText = (t) => (t.status === 'waiting' && !t.mine ? `Waiting for ${(t.requester_name || 'them').split(' ')[0]}` : t.status_label);

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Math.abs(s) < 60) return 'just now';
  const fut = s < 0; const a = Math.abs(s);
  const t = a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  return fut ? `in ${t}` : `${t} ago`;
}

function NewDialog({ open, settings, preset, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ category: preset || '', title: '', details: '', priority: 'normal', attachment: null }); }, [open, preset]);
  if (!open || !f) return null;
  const save = async () => {
    setSaving(true);
    try { const r = await helpdeskAPI.create(f); toast.success(`${r.data.number} raised — you'll get a note when someone replies`); onSaved(r.data); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not raise it')); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="hd-new-dialog">
        <DialogHeader><DialogTitle>Ask for help</DialogTitle><DialogDescription>It goes to the person who handles this kind of request.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><p className="mb-1.5 text-xs font-medium text-slate-700">What is it about?</p>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Category">{settings.categories.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={f.category === c.key} onClick={() => setF((x) => ({ ...x, category: c.key }))}
                className={`min-h-[44px] rounded-lg border px-2.5 py-2 text-left text-sm ${f.category === c.key ? 'border-emerald-400 bg-emerald-50 font-medium text-emerald-900' : 'border-slate-200 text-slate-700'}`} data-testid={`hd-cat-${c.key}`}>{c.label}</button>))}</div></div>
          <Field label="In one line"><Input value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} placeholder="e.g. Laptop won't charge" className="h-11" data-testid="hd-new-title" /></Field>
          <Field label="Details"><Textarea value={f.details} onChange={(e) => setF((x) => ({ ...x, details: e.target.value }))} rows={4} placeholder="What happened, since when, anything you tried" data-testid="hd-new-details" /></Field>
          <Field label="How urgent?"><div className="grid grid-cols-4 gap-1.5">{Object.entries(PRIORITY).map(([k, [l]]) => (
            <button key={k} type="button" onClick={() => setF((x) => ({ ...x, priority: k }))} className={`h-10 rounded-lg border text-sm ${f.priority === k ? 'border-emerald-400 bg-emerald-50 font-medium text-emerald-900' : 'border-slate-200 text-slate-600'}`} data-testid={`hd-pri-${k}`}>{l}</button>))}</div>
            <span className="block text-[11px] text-slate-500">Answer due within {settings.due_hours[f.priority]} hours</span></Field>
          <FileAttach value={f.attachment} onChange={(p) => setF((x) => ({ ...x, attachment: p }))} label="Attach a photo or file" testid="hd-new-file" />
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !f.category || f.title.trim().length < 3} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="hd-new-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TicketSheet({ id, settings, onOpenChange, onChanged }) {
  const { user } = useAuth();
  const [t, setT] = useState(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState('');
  const [rating, setRating] = useState(0);
  const [rateNote, setRateNote] = useState('');
  const close = useRef(onOpenChange);
  close.current = onOpenChange;
  const load = useCallback(() => helpdeskAPI.get(id).then((r) => setT(r.data)).catch((e) => { toast.error(errText(e)); close.current(false); }), [id]);
  useEffect(() => { setT(null); setText(''); setFile(null); setInternal(false); setRating(0); setRateNote(''); load(); }, [load]);
  const act = async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); setT(r.data); onChanged(); if (ok) toast.success(ok); return true; } catch (e) { toast.error(errText(e)); return false; } finally { setBusy(''); }
  };
  if (!t) return <Sheet open onOpenChange={onOpenChange}><SheetContent side="right" className="w-full sm:max-w-xl"><Loading /></SheetContent></Sheet>;
  const cat = settings.categories.find((c) => c.key === t.category);
  const handlers = (cat?.handler_ids || []).map((hid, i) => ({ id: hid, name: cat.handlers[i] })).filter((h) => h.name);
  const assignOpts = [...(t.assignee_id && !handlers.some((h) => h.id === t.assignee_id) ? [{ id: t.assignee_id, name: t.assignee_name }] : []),
    ...(!handlers.some((h) => h.id === user.id) ? [{ id: user.id, name: `${user.name} (me)` }] : []), ...handlers];
  const send = async () => {
    const ok = await act('reply', () => helpdeskAPI.reply(t.id, { text, attachment: file, internal }));
    if (ok) { setText(''); setFile(null); setInternal(false); }
  };
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl" data-testid="hd-ticket-sheet">
        <div className="space-y-3 p-4 sm:p-6">
          <SheetHeader className="space-y-1 text-left">
            <SheetTitle className="pr-6">{t.title}</SheetTitle>
            <SheetDescription>{t.number} · {t.category_label} · raised by {t.mine ? 'you' : t.requester_name} {ago(t.created_at)}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={STATUS_TONE[t.status]} testid="hd-status">{statusText(t)}</Chip><Chip tone={PRIORITY[t.priority][1]}>{PRIORITY[t.priority][0]}</Chip>
            {t.overdue && <Chip tone="red"><Clock className="h-3 w-3" />Overdue</Chip>}
            {['open', 'in_progress'].includes(t.status) && !t.overdue && <span className="text-[11px] text-slate-500">due {ago(t.due_at)}</span>}
            <span className="text-[11px] text-slate-500">· {t.assignee_name ? `with ${t.assignee_name}` : 'not picked up yet'}</span>
          </div>
          {t.details && <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800">{t.details}</p>}
          {t.attachment && <a href={uploadAPI.getFileUrl(t.attachment)} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 underline">Attached file</a>}
          {t.can_handle && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-2.5">
              <Field label="With"><Select value={t.assignee_id || '__none'} onValueChange={(v) => act('assign', () => helpdeskAPI.assign(t.id, v === '__none' ? null : v), 'Assigned')}>
                <SelectTrigger className="h-10" data-testid="hd-assign"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__none">Nobody yet</SelectItem>{assignOpts.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Priority"><Select value={t.priority} onValueChange={(v) => act('pri', () => helpdeskAPI.edit(t.id, { priority: v }), 'Priority changed')}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PRIORITY).map(([k, [l]]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Category" className="col-span-2"><Select value={t.category} onValueChange={(v) => act('cat', () => helpdeskAPI.edit(t.id, { category: v }), 'Moved')}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{settings.categories.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent></Select></Field>
            </div>)}
          <ul className="space-y-2" data-testid="hd-replies">{t.replies.map((r) => (
            <li key={r.id} className={`rounded-lg p-2.5 text-sm ${r.internal ? 'border border-dashed border-amber-300 bg-amber-50' : r.by_id === user.id ? 'ml-6 bg-emerald-50' : 'mr-6 bg-slate-50'}`}>
              <p className="text-[11px] text-slate-500"><b className="text-slate-700">{r.by_id === user.id ? 'You' : r.by_name}</b> · {ago(r.at)}{r.internal && <span className="text-amber-800"> · <Lock className="inline h-3 w-3" /> only handlers see this</span>}{r.status_change && ` · ${MOVE[r.status_change] || r.status_change}`}</p>
              {r.text && <p className="whitespace-pre-wrap text-slate-800">{r.text}</p>}
              {r.attachment && <a href={uploadAPI.getFileUrl(r.attachment)} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline">Attached file</a>}
            </li>))}
            {t.replies.length === 0 && <li className="text-xs text-slate-400">No replies yet.</li>}</ul>
          {t.status !== 'closed' && (
            <div className="space-y-2 rounded-xl border border-slate-200 p-2.5">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={t.can_handle && !t.mine ? 'Reply to them, or add a note for handlers' : 'Write a reply'} data-testid="hd-reply-text" />
              <div className="flex flex-wrap items-center gap-2">
                <FileAttach value={file} onChange={(p) => setFile(p)} label="Attach" testid="hd-reply-file" />
                {t.can_handle && !t.mine && <label className="flex items-center gap-1.5 text-xs text-slate-700"><Switch checked={internal} onCheckedChange={setInternal} aria-label="Internal note" data-testid="hd-reply-internal" />Internal note</label>}
                <Button onClick={send} disabled={busy === 'reply' || (!text.trim() && !file)} className="ml-auto h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="hd-reply-send">{busy === 'reply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}{internal ? 'Add note' : 'Send'}</Button>
              </div>
            </div>)}
          {t.moves?.length > 0 && (
            <div className="flex flex-wrap gap-2">{t.moves.map((m) => {
              const lab = t.mine && !t.can_handle ? (MOVE_SELF[m] || MOVE[m]) : MOVE[m];
              return <Button key={m} variant={m === 'resolved' ? 'default' : 'outline'} disabled={!!busy} onClick={() => act(m, () => helpdeskAPI.status(t.id, m, text.trim() || null).then((r) => { setText(''); return r; }), 'Updated')}
                className={`h-10 ${m === 'resolved' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`} data-testid={`hd-move-${m}`}>{busy === m ? <Loader2 className="h-4 w-4 animate-spin" /> : lab}</Button>;
            })}</div>)}
          {t.mine && ['resolved', 'closed'].includes(t.status) && !t.rating && (
            <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3" data-testid="hd-rate">
              <StarInput label="How was the help?" value={rating} onChange={setRating} testid="hd-star" />
              <Input value={rateNote} onChange={(e) => setRateNote(e.target.value)} placeholder="Anything to add (optional)" className="h-10 bg-white" />
              <Button disabled={!rating || busy === 'rate'} onClick={() => act('rate', () => helpdeskAPI.rate(t.id, rating, rateNote), 'Thanks!')} className="h-10 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="hd-rate-save">Send rating</Button>
            </div>)}
          {t.rating && <p className="flex items-center gap-1 text-sm text-slate-700"><Star className="h-4 w-4 fill-amber-400 text-amber-400" />Rated {t.rating}/5{t.rating_note ? ` — “${t.rating_note}”` : ''}</p>}
          {t.history?.length > 0 && (
            <details className="text-xs text-slate-500"><summary className="cursor-pointer">History</summary>
              <ul className="mt-1 space-y-0.5">{t.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {h.by}: {h.what}</li>)}</ul></details>)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SettingsDialog({ open, settings, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({ categories: settings.categories.map((c) => ({ key: c.key, label: c.label, handler_ids: [...c.handler_ids] })), due_hours: { ...settings.due_hours } });
    usersAPI.getAll().then((r) => setUsers((r.data || []).filter((u) => u.active !== false && ['admin', 'manager', 'staff'].includes(u.role)))).catch(() => setUsers([]));
  }, [open, settings]);
  if (!open || !f) return null;
  const save = async () => {
    setSaving(true);
    try { await helpdeskAPI.saveSettings(f); toast.success('Saved'); onSaved(); onOpenChange(false); } catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto" data-testid="hd-settings-dialog">
        <DialogHeader><DialogTitle>Help desk settings</DialogTitle><DialogDescription>Who handles each kind of request. With one handler, requests go straight to them; with none, admins handle it.</DialogDescription></DialogHeader>
        <ul className="space-y-2">{f.categories.map((c, i) => (
          <li key={c.key || i} className="rounded-xl border border-slate-200 p-2.5">
            <div className="flex gap-2"><Input value={c.label} onChange={(e) => setF((x) => ({ ...x, categories: x.categories.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) }))} className="h-10" data-testid={`hd-set-label-${i}`} />
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Remove category" onClick={() => setF((x) => ({ ...x, categories: x.categories.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" /></Button></div>
            <div className="mt-2 flex flex-wrap gap-1">{users.map((u) => {
              const on = c.handler_ids.includes(u.id);
              return <button key={u.id} type="button" onClick={() => setF((x) => ({ ...x, categories: x.categories.map((y, j) => (j === i ? { ...y, handler_ids: on ? y.handler_ids.filter((h) => h !== u.id) : [...y.handler_ids, u.id] } : y)) }))}
                className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`} data-testid={`hd-set-h-${i}-${u.id}`}>{u.name}</button>;
            })}</div>
          </li>))}</ul>
        <Button variant="outline" size="sm" className="h-9 w-fit gap-1" onClick={() => setF((x) => ({ ...x, categories: [...x.categories, { key: '', label: '', handler_ids: [] }] }))}><Plus className="h-3.5 w-3.5" />Add a category</Button>
        <div><p className="mb-1 text-xs font-medium text-slate-700">Answer within (hours)</p>
          <div className="grid grid-cols-4 gap-2">{Object.entries(PRIORITY).map(([k, [l]]) => (
            <Field key={k} label={l}><Input value={f.due_hours[k]} onChange={(e) => setF((x) => ({ ...x, due_hours: { ...x.due_hours, [k]: e.target.value } }))} inputMode="numeric" className="h-10" /></Field>))}</div></div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="hd-set-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Report() {
  const [d, setD] = useState(null);
  useEffect(() => { helpdeskAPI.report(90).then((r) => setD(r.data)).catch(() => setD(false)); }, []);
  if (d === null) return <Loading />;
  if (!d || !d.rows.length) return <Empty title="Nothing in the last 90 days" />;
  return (
    <Card title="Last 90 days by category" testid="hd-report">
      <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
        <thead className="text-xs text-slate-500"><tr>{['Category', 'Raised', 'Open', 'Overdue', 'Solved', 'Avg time to solve', 'Rating'].map((h, i) => <th key={h} className={`p-2 font-medium ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{d.rows.map((r) => (
          <tr key={r.category}><td className="p-2">{r.category}</td><td className="p-2 text-right tabular-nums">{r.raised}</td><td className="p-2 text-right tabular-nums">{r.open}</td>
            <td className={`p-2 text-right tabular-nums ${r.overdue ? 'text-rose-700' : ''}`}>{r.overdue}</td><td className="p-2 text-right tabular-nums">{r.solved}</td>
            <td className="p-2 text-right tabular-nums">{r.avg_hours != null ? (r.avg_hours < 24 ? `${r.avg_hours} h` : `${(r.avg_hours / 24).toFixed(1)} d`) : '—'}</td>
            <td className="p-2 text-right tabular-nums">{r.rating != null ? `${r.rating} ★` : '—'}</td></tr>))}</tbody>
      </table></div>
    </Card>
  );
}

export default function HelpDeskPage() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState(null);
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [setOpen, setSetOpen] = useState(false);
  const tab = params.get('tab') || 'mine';
  const ticket = params.get('ticket');
  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const loadSettings = useCallback(() => helpdeskAPI.settings().then((r) => setSettings(r.data)).catch(() => setSettings(false)), []);
  const loadSummary = useCallback(() => helpdeskAPI.summary().then((r) => setSummary(r.data)).catch(() => {}), []);
  const scope = tab === 'report' ? null : tab;
  const loadRows = useCallback(() => {
    if (!scope) return;
    setRows(null);
    helpdeskAPI.list({ scope, status: status === 'all' ? undefined : status, q: q.trim() || undefined }).then((r) => setRows(r.data)).catch((e) => { toast.error(errText(e)); setRows([]); });
  }, [scope, status, q]);
  useEffect(() => { loadSettings(); loadSummary(); }, [loadSettings, loadSummary]);
  useEffect(() => { const t = setTimeout(loadRows, q ? 300 : 0); return () => clearTimeout(t); }, [loadRows, q]);
  useEffect(() => { if (params.get('new') && settings) { setNewOpen(true); } }, [params, settings]);
  const refresh = useCallback(() => { loadRows(); loadSummary(); }, [loadRows, loadSummary]);
  useLiveRefresh(['helpdesk'], refresh);
  const preset = params.get('new');
  const tabs = useMemo(() => (settings ? [['mine', 'My requests', summary?.mine_needs_you || 0], settings.is_handler && ['queue', 'To handle', summary?.queue || 0],
    settings.desk && ['all', 'Everything'], settings.is_handler && ['report', 'Report']] : []), [settings, summary]);
  if (settings === null) return <div className="px-4 py-6"><Loading /></div>;
  if (!settings) return <div className="px-4 py-6"><Empty title="Could not load the help desk" /></div>;
  return (
    <div className="px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader icon={LifeBuoy} title="Help desk" sub="Ask for help inside the company — it goes to the right person" testid="hd-page">
          {isAdmin && <Button variant="outline" className="h-10 gap-1.5" onClick={() => setSetOpen(true)} data-testid="hd-settings-btn"><Settings2 className="h-4 w-4" />Settings</Button>}
          <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setNewOpen(true)} data-testid="hd-new"><Plus className="h-4 w-4" />Ask for help</Button>
        </PageHeader>
        {settings.is_handler && summary && (
          <Tiles>
            <Tile label="To handle" value={summary.queue} sub="open or being worked on" icon={Inbox} onClick={() => setParam('tab', 'queue')} testid="hd-kpi-queue" />
            <Tile label="Not picked up" value={summary.unassigned} sub="nobody assigned" icon={UserCheck} tone={summary.unassigned ? 'warn' : undefined} onClick={() => setParam('tab', 'queue')} />
            <Tile label="Overdue" value={summary.overdue} sub="past the answer time" icon={AlertTriangle} tone={summary.overdue ? 'bad' : undefined} onClick={() => setParam('tab', 'queue')} />
            <Tile label="Your requests" value={summary.mine_needs_you} sub="waiting for you" icon={MessageSquare} onClick={() => setParam('tab', 'mine')} />
          </Tiles>)}
        <PillTabs value={tab} onChange={(t) => setParam('tab', t)} testid="hd-tab" tabs={tabs} />
        {tab === 'report' ? <Report /> : (<>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">{[['open', 'Open'], ['done', 'Solved & closed'], ['all', 'All']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setStatus(k)} className={`h-9 rounded-md px-3 text-sm ${status === k ? 'bg-emerald-100 font-medium text-emerald-800' : 'text-slate-600'}`} data-testid={`hd-filter-${k}`}>{l}</button>))}</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-10 w-full bg-white sm:w-56" />
          </div>
          {rows === null ? <Loading /> : rows.length === 0 ? (
            <Empty icon={LifeBuoy} title={tab === 'mine' ? 'Nothing open' : 'Nothing to handle'} text={tab === 'mine' ? 'Need a laptop fixed, a salary question answered, a tool, or help with the app? Ask here.' : 'New requests in your categories show here.'}>
              {tab === 'mine' && <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />Ask for help</Button>}
            </Empty>) : (
            <ul className="space-y-2" data-testid="hd-list">{rows.map((t) => (
              <li key={t.id}><button type="button" onClick={() => setParam('ticket', t.id)} className={`w-full rounded-xl border bg-white p-3 text-left hover:border-emerald-200 ${t.overdue ? 'border-rose-200' : 'border-slate-200'}`} data-testid={`hd-row-${t.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate font-medium text-slate-900">{t.title}</p>
                    <p className="truncate text-xs text-slate-600">{t.number} · {t.category_label}{tab !== 'mine' ? ` · ${t.requester_name}` : ''}{t.assignee_name ? ` · with ${t.assignee_name}` : ''}</p></div>
                  <span className="flex shrink-0 flex-col items-end gap-1"><Chip tone={STATUS_TONE[t.status]}>{statusText(t)}</Chip>{t.priority !== 'normal' && <Chip tone={PRIORITY[t.priority][1]}>{PRIORITY[t.priority][0]}</Chip>}</span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">{t.overdue ? <span className="font-medium text-rose-700">Overdue</span> : null}
                  <span>{t.last_reply_at ? `last reply ${ago(t.last_reply_at)} by ${t.last_reply_by}` : `raised ${ago(t.created_at)}`}</span>{t.replies_count ? <span>· {t.replies_count} repl{t.replies_count > 1 ? 'ies' : 'y'}</span> : null}</p>
              </button></li>))}</ul>)}
        </>)}
      </div>
      <NewDialog open={newOpen} settings={settings} preset={preset && settings.categories.some((c) => c.key === preset) ? preset : ''} onOpenChange={(o) => { setNewOpen(o); if (!o && preset) setParam('new', null); }}
        onSaved={(t) => { refresh(); setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); n.set('tab', 'mine'); n.set('ticket', t.id); return n; }, { replace: true }); }} />
      {ticket && <TicketSheet id={ticket} settings={settings} onOpenChange={(o) => !o && setParam('ticket', null)} onChanged={refresh} />}
      <SettingsDialog open={setOpen} settings={settings} onOpenChange={setSetOpen} onSaved={() => { loadSettings(); refresh(); }} />
    </div>
  );
}
