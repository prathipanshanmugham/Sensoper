/* Attendance — one tap to check in / check out (time + GPS). Managers see the team and the monthly register. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Clock, LogIn, LogOut, MapPin, Loader2, Download, ChevronLeft, ChevronRight, Pencil, Users, CalendarDays, UserCheck } from 'lucide-react';
import { attendanceAPI } from '../utils/api';
import { useAuth, formatApiErrorDetail } from '../contexts/AuthContext';
import { getPosition, mapsLink } from '../lib/geo';
import { localDate, dayLabel, timeOf } from '../lib/format';
import { DateNav } from '../components/FormBits';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import Can from '../components/Can';

const hm = (mins) => (mins == null ? '—' : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`);
const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return monthOf(d); };
const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };
const toHHMM = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function GpsLink({ punch }) {
  if (!punch || punch.lat == null) return null;
  return <a href={mapsLink(punch.lat, punch.lng)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-emerald-700 hover:underline"><MapPin className="h-3 w-3" />map</a>;
}

function MonthNav({ value, onChange, testid }) {
  const atMax = value >= monthOf();
  return (
    <div className="flex items-center gap-1" data-testid={testid}>
      <button type="button" onClick={() => onChange(shiftMonth(value, -1))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
      <span className="flex h-10 min-w-[150px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900">{monthLabel(value)}</span>
      <button type="button" disabled={atMax} onClick={() => onChange(shiftMonth(value, 1))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

function MyDay() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [now, setNow] = useState(Date.now());
  const [month, setMonth] = useState(monthOf());
  const [mine, setMine] = useState(null);
  const load = useCallback(() => attendanceAPI.today().then((r) => setData(r.data)).catch(() => toast.error('Could not load attendance')), []);
  const loadMonth = useCallback(() => attendanceAPI.myMonth(month).then((r) => setMine(r.data)).catch(() => setMine({ records: [] })), [month]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMonth(); }, [loadMonth]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const rec = data?.record;
  const punch = async (kind) => {
    setBusy(true);
    try {
      const pos = await getPosition();
      const r = await (kind === 'in' ? attendanceAPI.checkIn : attendanceAPI.checkOut)({ ...pos, note });
      setData((d) => ({ ...d, record: r.data }));
      setNote('');
      toast.success(kind === 'in' ? `Checked in at ${timeOf(r.data.check_in.at)}` : `Checked out — ${hm(r.data.worked_minutes)} today`);
      loadMonth();
    } catch (e) {
      toast.error(e.response ? (formatApiErrorDetail(e.response.data?.detail) || 'Could not save') : e.message);
    } finally { setBusy(false); }
  };
  const runningMins = rec && !rec.check_out ? Math.max(0, Math.floor((now - new Date(rec.check_in.at).getTime()) / 60000)) : null;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="attendance-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{dayLabel(localDate(), { long: true })}</p>
            <p className="font-['Outfit'] text-3xl font-bold tabular-nums text-slate-900" data-testid="attendance-clock">{new Date(now).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${!rec ? 'bg-slate-100 text-slate-600' : rec.check_out ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`} data-testid="attendance-state">
            {!rec ? 'Not checked in' : rec.check_out ? 'Day complete' : 'Working'}
          </span>
        </div>

        {data === null ? <div className="mt-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : (
          <>
            {rec && (
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Check in</p><p className="font-semibold tabular-nums text-slate-900" data-testid="attendance-in">{timeOf(rec.check_in.at)}</p><GpsLink punch={rec.check_in} /></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Check out</p><p className="font-semibold tabular-nums text-slate-900" data-testid="attendance-out">{rec.check_out ? timeOf(rec.check_out.at) : '—'}</p><GpsLink punch={rec.check_out} /></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{rec.check_out ? 'Worked' : 'So far'}</p><p className="font-semibold tabular-nums text-slate-900" data-testid="attendance-hours">{hm(rec.check_out ? rec.worked_minutes : runningMins)}</p></div>
              </div>
            )}
            {!rec?.check_out && (
              <div className="mt-5 space-y-3">
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={rec ? 'Note (optional) — e.g. left from site' : 'Where are you working today? (optional)'}
                  className="h-11 w-full rounded-lg border border-slate-200 px-3 text-[15px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" data-testid="attendance-note" />
                <Button onClick={() => punch(rec ? 'out' : 'in')} disabled={busy}
                  className={`h-14 w-full gap-2 text-base font-semibold text-white ${rec ? 'bg-slate-900 hover:bg-slate-800' : 'bg-emerald-600 hover:bg-emerald-700'}`} data-testid={rec ? 'check-out-btn' : 'check-in-btn'}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : rec ? <LogOut className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
                  {busy ? 'Getting your location…' : rec ? 'Check out' : 'Check in'}
                </Button>
                <p className="flex items-center justify-center gap-1 text-[11px] text-slate-500"><MapPin className="h-3 w-3" />Your location is saved with the time. Allow location when the phone asks.</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-['Outfit'] text-base font-semibold text-slate-900">My attendance</h2>
          <MonthNav value={month} onChange={setMonth} testid="my-month" />
        </div>
        {mine && (
          <p className="text-sm text-slate-600" data-testid="my-month-summary"><span className="font-semibold text-slate-900">{mine.days_present}</span> day{mine.days_present === 1 ? '' : 's'} · <span className="font-semibold text-slate-900">{hm(mine.worked_minutes)}</span> worked</p>
        )}
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="my-month-list">
          {(mine?.records || []).length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No attendance this month yet.</li>}
          {(mine?.records || []).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="font-medium text-slate-800">{dayLabel(r.date)}</span>
              <span className="tabular-nums text-slate-600">{timeOf(r.check_in?.at)} – {r.check_out ? timeOf(r.check_out.at) : <span className="text-amber-700">no check-out</span>}</span>
              <span className="w-24 text-right tabular-nums text-slate-900">{hm(r.worked_minutes)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FixDialog({ row, onClose, onSaved }) {
  const rec = row?.record;
  const [inT, setInT] = useState(toHHMM(rec?.check_in?.at));
  const [outT, setOutT] = useState(toHHMM(rec?.check_out?.at));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await attendanceAPI.correct(rec.id, { check_in_at: inT || null, check_out_at: outT || null, note }); toast.success('Attendance corrected'); onSaved(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not save'); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="fix-dialog">
        <DialogHeader><DialogTitle>Correct attendance</DialogTitle><DialogDescription>{row?.name} · {rec && dayLabel(rec.date)}. The change is logged with your name.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs font-medium text-slate-600">Check in<input type="time" value={inT} onChange={(e) => setInT(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 px-2 text-[15px]" data-testid="fix-in" /></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Check out<input type="time" value={outT} onChange={(e) => setOutT(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 px-2 text-[15px]" data-testid="fix-out" /></label>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (e.g. forgot to check out)" className="h-11 w-full rounded-lg border border-slate-200 px-3 text-[15px]" data-testid="fix-note" />
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="fix-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_UI = { checked_in: ['Working', 'bg-emerald-50 text-emerald-700'], checked_out: ['Done', 'bg-sky-50 text-sky-700'], absent: ['Absent', 'bg-slate-100 text-slate-500'] };

function TeamDay() {
  const [date, setDate] = useState(localDate());
  const [data, setData] = useState(null);
  const [fix, setFix] = useState(null);
  const [filter, setFilter] = useState('all');
  const load = useCallback(() => { setData(null); attendanceAPI.team(date).then((r) => setData(r.data)).catch(() => toast.error('Could not load the team')); }, [date]);
  useEffect(() => { load(); }, [load]);
  const rows = (data?.rows || []).filter((r) => filter === 'all' || (filter === 'present' ? r.record : !r.record));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateNav value={date} onChange={setDate} testid="team-date" />
        {data && (
          <div className="flex gap-1.5 text-xs" role="group" aria-label="Filter">
            {[['all', `All ${data.summary.people}`], ['present', `Present ${data.summary.present}`], ['absent', `Absent ${data.summary.absent}`]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full border px-3 py-1.5 font-medium ${filter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`} data-testid={`team-filter-${k}`}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {!data ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="team-list">
          {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">Nobody here.</li>}
          {rows.map((r) => {
            const [label, cls] = STATUS_UI[r.status];
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" data-testid={`team-row-${r.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{r.name}</p>
                  <p className="text-[11px] capitalize text-slate-500">{r.role}</p>
                </div>
                {r.record && (
                  <div className="text-right text-xs tabular-nums text-slate-600">
                    <p>{timeOf(r.record.check_in?.at)} <GpsLink punch={r.record.check_in} /> – {r.record.check_out ? <>{timeOf(r.record.check_out.at)} <GpsLink punch={r.record.check_out} /></> : '…'}</p>
                    <p className="font-medium text-slate-800">{hm(r.record.worked_minutes)}</p>
                  </div>
                )}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
                {r.record && <button type="button" onClick={() => setFix(r)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700" aria-label={`Correct ${r.name}`} data-testid={`fix-${r.id}`}><Pencil className="h-4 w-4" /></button>}
              </li>
            );
          })}
        </ul>
      )}
      {fix && <FixDialog row={fix} onClose={() => setFix(null)} onSaved={() => { setFix(null); load(); }} />}
    </div>
  );
}

const CELL_CLS = { P: 'bg-emerald-100 text-emerald-800', 'P*': 'bg-amber-100 text-amber-800', H: 'bg-sky-100 text-sky-800', A: 'bg-rose-50 text-rose-700', S: 'bg-slate-100 text-slate-400', '': '' };

function Register() {
  const [month, setMonth] = useState(monthOf());
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); attendanceAPI.register(month).then((r) => setData(r.data)).catch(() => toast.error('Could not load the register')); }, [month]);
  const download = () => {
    const head = ['Name', 'Role', ...data.days.map((d) => d.slice(8)), 'Present', 'Half days', 'Hours'];
    const body = data.rows.map((r) => [r.name, r.role, ...r.cells, r.present, r.half_days, +(r.worked_minutes / 60).toFixed(1)]);
    const legend = [[], ['Legend'], ...Object.entries(data.legend).map(([k, v]) => [k, v])];
    const ws = XLSX.utils.aoa_to_sheet([[`Attendance register — ${monthLabel(month)}`], [], head, ...body, ...legend]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Register');
    XLSX.writeFile(wb, `Attendance_${month}.xlsx`);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav value={month} onChange={setMonth} testid="register-month" />
        <Can module="module_attendance" action="export"><Button variant="outline" onClick={download} disabled={!data} className="h-10 gap-2" data-testid="register-download"><Download className="h-4 w-4" />Excel</Button></Can>
      </div>
      {!data ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" data-testid="register-table">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium">Name</th>
                  {data.days.map((d) => <th key={d} className="px-1 py-2 text-center font-medium tabular-nums">{Number(d.slice(8))}</th>)}
                  <th className="px-2 py-2 text-right font-medium">Days</th><th className="px-3 py-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="sticky left-0 z-10 max-w-[140px] truncate bg-white px-3 py-1.5 font-medium text-slate-800">{r.name}</td>
                    {r.cells.map((c, i) => <td key={i} className="px-0.5 py-1 text-center"><span className={`inline-block min-w-[22px] rounded px-1 py-0.5 text-[10px] font-semibold ${CELL_CLS[c] || ''}`}>{c}</span></td>)}
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.present + r.half_days / 2}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{(r.worked_minutes / 60).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex flex-wrap gap-3 text-[11px] text-slate-500">{Object.entries(data.legend).map(([k, v]) => <span key={k}><span className={`mr-1 inline-block rounded px-1 font-semibold ${CELL_CLS[k]}`}>{k}</span>{v}</span>)}</p>
        </>
      )}
    </div>
  );
}

export default function AttendancePage() {
  const { can } = useAuth();
  const isMgr = can('can_view_team_attendance');
  const [params, setParams] = useSearchParams();
  const tab = isMgr ? (params.get('tab') || 'me') : 'me';
  const tabs = useMemo(() => [['me', 'My day', UserCheck], ['team', 'Team', Users], ['register', 'Monthly register', CalendarDays]], []);
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6" data-testid="attendance-page">
      <div className="flex items-center gap-2"><Clock className="h-5 w-5 text-emerald-600" /><h1 className="font-['Outfit'] text-2xl font-bold text-slate-900">Attendance</h1></div>
      {isMgr && (
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist">
          {tabs.map(([k, l, I]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'me' ? {} : { tab: k })}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ${tab === k ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`} data-testid={`attendance-tab-${k}`}><I className="h-4 w-4" />{l}</button>
          ))}
        </div>
      )}
      {tab === 'me' && <MyDay />}
      {tab === 'team' && <TeamDay />}
      {tab === 'register' && <Register />}
    </div>
  );
}
