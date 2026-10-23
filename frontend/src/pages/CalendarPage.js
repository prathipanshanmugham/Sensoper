/* Event calendar: company events plus the dated work from the pages each person can open
 * (AMC visits, installations, deliveries, interviews, covers, EMIs, trademark renewals). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Pencil, Plus, Repeat, Trash2, Users } from 'lucide-react';
import { calendarAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { useLiveRefresh } from '../lib/liveSync';
import { Chip, Field, PageHeader, addDaysISO, errText, fmtDate, inputCls, todayISO } from '../components/kit/PageBits';

// one colour per kind of entry (categorical slots, fixed order) — every entry also carries its text label
const SOURCES = {
  event: ['Events', '#2a78d6'], amc: ['AMC visits', '#1baf7a'], projects: ['Installations & crews', '#eb6834'], purchases: ['Purchases', '#eda100'],
  hr: ['HR', '#6250d6'], loans: ['Loan EMIs', '#e87ba4'], brands: ['Trademarks & brands', '#008300'],
};
const TYPES = [['meeting', 'Meeting'], ['holiday', 'Holiday'], ['training', 'Training'], ['deadline', 'Deadline'], ['celebration', 'Celebration'], ['site', 'Site work'], ['other', 'Other']];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const blankEvent = (date) => ({ title: '', type: 'meeting', date, end_date: '', all_day: true, start_time: '10:00', end_time: '11:00', location: '', description: '',
  audience: 'everyone', attendee_ids: [], repeat: 'none', repeat_until: '', remind: true });
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
const shiftMonth = (iso, n) => { const d = new Date(`${monthStart(iso)}T00:00:00`); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const gridStart = (first) => { const d = new Date(`${first}T00:00:00`); const back = (d.getDay() + 6) % 7; return addDaysISO(first, -back); };
const covers = (it, day) => it.date <= day && (it.end || it.date) >= day;

function EventDialog({ open, onOpenChange, initial, onSaved }) {
  const [f, setF] = useState(initial);
  const [people, setPeople] = useState([]);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { if (open) { setF(initial); setQ(''); calendarAPI.people().then((r) => setPeople(r.data || [])).catch(() => {}); } }, [open, initial]);
  if (!f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const toggle = (id) => setF((x) => ({ ...x, attendee_ids: x.attendee_ids.includes(id) ? x.attendee_ids.filter((y) => y !== id) : [...x.attendee_ids, id] }));
  const save = async () => {
    setSaving(true);
    const body = { ...f, end_date: f.end_date || null, repeat_until: f.repeat_until || null, start_time: f.all_day ? null : f.start_time, end_time: f.all_day ? null : (f.end_time || null) };
    try {
      if (f.event_id) await calendarAPI.update(f.event_id, body); else await calendarAPI.add(body);
      toast.success('Event saved'); onSaved(); onOpenChange(false);
    } catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  const shown = people.filter((p) => !q || p.name?.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="event-dialog">
        <DialogHeader><DialogTitle>{f.event_id ? 'Edit event' : 'Add event'}</DialogTitle><DialogDescription>Everyone it is for gets a note in the bell, and a reminder on the day.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="What *" className="col-span-2"><Input value={f.title} onChange={set('title')} placeholder="Monthly review, Diwali, safety training…" className="h-11" data-testid="event-title" /></Field>
          <Field label="Kind"><Select value={f.type} onValueChange={set('type')}><SelectTrigger className="h-11" data-testid="event-type"><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Repeats"><Select value={f.repeat} onValueChange={set('repeat')}><SelectTrigger className="h-11" data-testid="event-repeat"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Doesn't repeat</SelectItem><SelectItem value="weekly">Every week</SelectItem><SelectItem value="monthly">Every month</SelectItem><SelectItem value="yearly">Every year</SelectItem></SelectContent></Select></Field>
          <Field label="Date *"><input type="date" value={f.date} onChange={set('date')} className={inputCls} data-testid="event-date" /></Field>
          <Field label="Ends on (optional)"><input type="date" value={f.end_date || ''} min={f.date} onChange={set('end_date')} className={inputCls} /></Field>
          <label className="col-span-2 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span>All day</span><Switch checked={f.all_day} onCheckedChange={set('all_day')} data-testid="event-all-day" /></label>
          {!f.all_day && <>
            <Field label="From"><input type="time" value={f.start_time || ''} onChange={set('start_time')} className={inputCls} data-testid="event-start" /></Field>
            <Field label="To"><input type="time" value={f.end_time || ''} onChange={set('end_time')} className={inputCls} /></Field>
          </>}
          {f.repeat !== 'none' && <Field label="Repeat until (optional)" className="col-span-2"><input type="date" value={f.repeat_until || ''} min={f.date} onChange={set('repeat_until')} className={inputCls} /></Field>}
          <Field label="Where" className="col-span-2"><Input value={f.location || ''} onChange={set('location')} placeholder="Erode office, Google Meet link…" className="h-11" /></Field>
          <Field label="Details" className="col-span-2"><textarea rows={2} value={f.description || ''} onChange={set('description')} className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
          <Field label="Who is it for?" className="col-span-2"><Select value={f.audience} onValueChange={set('audience')}><SelectTrigger className="h-11" data-testid="event-audience"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="everyone">Everyone</SelectItem><SelectItem value="people">Only the people I pick</SelectItem></SelectContent></Select></Field>
          {f.audience === 'people' && (
            <div className="col-span-2 space-y-1.5 rounded-lg border border-slate-200 p-2" data-testid="event-people">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" className="h-9" />
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {shown.map((p) => { const on = f.attendee_ids.includes(p.id); return (
                  <button key={p.id} type="button" aria-pressed={on} onClick={() => toggle(p.id)} className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-emerald-300 bg-emerald-100 font-medium text-emerald-800' : 'border-slate-200 bg-white text-slate-600'}`}>{on ? '✓ ' : ''}{p.name}</button>); })}
              </div>
              <p className="text-[11px] text-slate-500">{f.attendee_ids.length} picked</p>
            </div>
          )}
          <label className="col-span-2 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span>Remind them<span className="block text-[11px] text-slate-500">On the morning of the day, or an hour before a timed event</span></span><Switch checked={f.remind} onCheckedChange={set('remind')} /></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !f.title.trim() || !f.date || (f.audience === 'people' && !f.attendee_ids.length)} className="bg-emerald-600 text-white" data-testid="event-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Entry({ it, onEdit, onDelete }) {
  const [label, color] = SOURCES[it.source] || SOURCES.event;
  const kind = it.source === 'event' ? (TYPES.find(([k]) => k === it.type) || [it.type, it.type])[1] : label;
  return (
    <li className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3" data-testid={`cal-entry-${it.id}`}>
      <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900">{it.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          <span className="font-medium" style={{ color: '#475569' }}>{kind}</span>
          {it.time && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{it.time}{it.end_time ? `–${it.end_time}` : ''}</span>}
          {it.end && <span>until {fmtDate(it.end, { day: 'numeric', month: 'short' })}</span>}
          {it.detail && <span className="inline-flex items-center gap-1">{it.source === 'event' && <MapPin className="h-3 w-3" />}{it.detail}</span>}
          {it.repeat && it.repeat !== 'none' && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" />{it.repeat}</span>}
          {it.audience === 'people' && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{it.attendee_ids.length} people</span>}
        </p>
        {it.description && <p className="mt-1 text-sm text-slate-600">{it.description}</p>}
        <div className="mt-1 flex gap-3 text-xs">
          {it.link && <Link to={it.link} className="font-medium text-emerald-700 hover:underline">Open</Link>}
          {it.editable && <button type="button" onClick={() => onEdit(it)} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800" data-testid={`cal-edit-${it.event_id}`}><Pencil className="h-3 w-3" />Edit</button>}
          {it.editable && <button type="button" onClick={() => onDelete(it)} className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-600"><Trash2 className="h-3 w-3" />Delete</button>}
        </div>
      </div>
    </li>
  );
}

export default function CalendarPage() {
  const { can, isAdmin } = useAuth();
  const canAdd = isAdmin || can('module_calendar', 'create');
  const [params, setParams] = useSearchParams();
  const day = params.get('date') || todayISO();
  const setDay = (d) => setParams((p) => { const n = new URLSearchParams(p); n.set('date', d); return n; }, { replace: true });
  const [show, setShow] = useState('all');
  const [items, setItems] = useState(null);
  const [dlg, setDlg] = useState(null);
  const first = monthStart(day);
  const start = gridStart(first);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDaysISO(start, i)), [start]);
  const end = days[41];
  const load = useCallback(() => {
    calendarAPI.range(start, end, show === 'all' ? null : show).then((r) => setItems(r.data.items)).catch((e) => { toast.error(errText(e, 'Could not load the calendar')); setItems([]); });
  }, [start, end, show]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(['calendar', 'hr', 'amc', 'loans', 'brands', 'purchases', 'projects'], load);
  const byDay = useMemo(() => Object.fromEntries(days.map((d) => [d, (items || []).filter((it) => covers(it, d))])), [days, items]);
  const today = todayISO();
  const month = new Date(`${first}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const todays = byDay[day] || [];
  const upcoming = (items || []).filter((it) => it.date > day).slice(0, 8);
  const remove = async (it) => { if (!window.confirm(`Delete “${it.title}”${it.repeat && it.repeat !== 'none' ? ' (every repeat)' : ''}?`)) return; try { await calendarAPI.remove(it.event_id); load(); } catch (e) { toast.error(errText(e)); } };
  const edit = (it) => setDlg({ ...blankEvent(it.series_date), title: it.title, type: it.type, event_id: it.event_id, date: it.series_date, end_date: it.series_end || '',
    all_day: !it.time, start_time: it.time || '10:00', end_time: it.end_time || '', location: it.location || '', description: it.description || '', audience: it.audience || 'everyone',
    attendee_ids: it.attendee_ids || [], repeat: it.repeat || 'none', repeat_until: it.repeat_until || '', remind: it.remind !== false });
  return (
    <div className="px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader icon={CalendarDays} title="Event calendar" sub="Company events and the dated work you look after" testid="calendar-page">
          <div className="w-52"><Select value={show} onValueChange={setShow}><SelectTrigger className="h-10 bg-white" aria-label="Show" data-testid="cal-show"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Show everything</SelectItem>{Object.entries(SOURCES).map(([k, [l]]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
          {canAdd && <Button onClick={() => setDlg(blankEvent(day))} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="cal-add"><Plus className="h-4 w-4" />Add event</Button>}
        </PageHeader>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
          <section className="rounded-xl border border-slate-200 bg-white p-2 sm:p-3" data-testid="cal-month">
            <div className="mb-2 flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => setDay(shiftMonth(day, -1))} aria-label="Previous month" data-testid="cal-prev"><ChevronLeft className="h-5 w-5" /></Button>
              <div className="text-center"><p className="font-['Outfit'] text-lg font-semibold text-slate-900" data-testid="cal-month-label">{month}</p>
                {day.slice(0, 7) !== today.slice(0, 7) && <button type="button" onClick={() => setDay(today)} className="text-xs text-emerald-700 underline">Back to today</button>}</div>
              <Button variant="ghost" size="icon" onClick={() => setDay(shiftMonth(day, 1))} aria-label="Next month" data-testid="cal-next"><ChevronRight className="h-5 w-5" /></Button>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">{WEEK.map((w) => <div key={w} className="py-1">{w}</div>)}</div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-slate-100">
              {days.map((d) => {
                const list = byDay[d] || [];
                const inMonth = d.slice(0, 7) === first.slice(0, 7);
                const holiday = list.some((it) => it.source === 'event' && it.type === 'holiday');
                const sel = d === day;
                return (
                  <button key={d} type="button" onClick={() => setDay(d)} aria-label={`${fmtDate(d)}: ${list.length} item${list.length === 1 ? '' : 's'}`} aria-pressed={sel}
                    className={`flex min-h-[3.25rem] flex-col items-stretch p-1 text-left sm:min-h-[6.5rem] ${holiday ? 'bg-amber-50' : 'bg-white'} ${sel ? 'ring-2 ring-inset ring-emerald-500' : ''} ${inMonth ? '' : 'opacity-50'}`} data-testid={`cal-day-${d}`}>
                    <span className={`mb-0.5 inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs ${d === today ? 'bg-emerald-600 font-semibold text-white' : 'text-slate-700'}`}>{Number(d.slice(8))}</span>
                    <span className="hidden space-y-0.5 sm:block">
                      {list.slice(0, 3).map((it) => (
                        <span key={it.id} className="flex items-center gap-1 truncate text-[11px] leading-tight text-slate-700"><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: (SOURCES[it.source] || SOURCES.event)[1] }} />{it.time ? `${it.time} ` : ''}{it.title}</span>
                      ))}
                      {list.length > 3 && <span className="block text-[10px] text-slate-500">+{list.length - 3} more</span>}
                    </span>
                    {list.length > 0 && <span className="mt-auto flex flex-wrap gap-0.5 sm:hidden">{list.slice(0, 4).map((it) => <span key={it.id} className="h-1.5 w-1.5 rounded-full" style={{ background: (SOURCES[it.source] || SOURCES.event)[1] }} />)}</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1" aria-label="Legend">{Object.entries(SOURCES).map(([k, [l, c]]) => <span key={k} className="inline-flex items-center gap-1 text-[11px] text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>)}</div>
          </section>
          <aside className="space-y-3" data-testid="cal-day-list">
            <div className="flex items-center justify-between"><p className="font-semibold text-slate-900">{new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              {canAdd && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setDlg(blankEvent(day))}><Plus className="h-3.5 w-3.5" />Add</Button>}</div>
            {items === null ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : todays.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center text-sm text-slate-500">Nothing on this day</p> : (
              <ul className="space-y-2">{todays.map((it) => <Entry key={it.id} it={it} onEdit={edit} onDelete={remove} />)}</ul>
            )}
            {upcoming.length > 0 && <>
              <p className="pt-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Coming up</p>
              <ul className="space-y-1.5">{upcoming.map((it) => (
                <li key={it.id}><button type="button" onClick={() => setDay(it.date)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: (SOURCES[it.source] || SOURCES.event)[1] }} />
                  <span className="w-14 shrink-0 text-xs text-slate-500">{fmtDate(it.date, { day: 'numeric', month: 'short' })}</span>
                  <span className="min-w-0 truncate text-slate-800">{it.title}</span>
                  {it.source !== 'event' && <Chip className="ml-auto">{(SOURCES[it.source] || ['', ''])[0].split(' ')[0]}</Chip>}
                </button></li>))}</ul>
            </>}
          </aside>
        </div>
      </div>
      <EventDialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} initial={dlg} onSaved={load} />
    </div>
  );
}
