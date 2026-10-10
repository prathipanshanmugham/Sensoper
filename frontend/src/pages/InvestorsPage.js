/* Money & insights → Investors (admins only).
 *  Business  — charts of the whole business (the same view investors get, with everything switched on).
 *  Investors — each investor's login, what they may see, the money they put in and were paid, sign-ins,
 *              and a preview of exactly what they see. */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Eye, KeyRound, Landmark, Loader2, Plus, RefreshCw, Trash2, UserPlus, Users, Wand2, X } from 'lucide-react';
import { investorsAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import BusinessView, { PeriodPicker, inr, inrShort } from '../components/investor/BusinessView';

const inputCls = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400';
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never');
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = { name: '', email: '', phone: '', organisation: '', share_pct: '', committed_amount: '', notes: '', active: true, password: '', sections: null };

function tempPassword() {
  const words = ['solar', 'river', 'mango', 'cloud', 'rocket', 'garden', 'sunny', 'tiger', 'lotus', 'amber'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(100 + Math.random() * 900)}`;
}

function Field({ label, hint, children }) {
  return <label className="block space-y-1"><span className="block text-xs font-medium text-slate-700">{label}</span>{children}{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</label>;
}

function SectionSwitches({ meta, value, onChange }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="investor-sections">
      {meta.sections.map((s) => (
        <li key={s.key} className="flex items-start gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-800">{s.label}</span><span className="block text-[11px] text-slate-500">{s.what}</span></span>
          <Switch checked={value?.[s.key] !== false} onCheckedChange={(v) => onChange({ ...value, [s.key]: v })} aria-label={s.label} data-testid={`inv-section-${s.key}`} />
        </li>
      ))}
    </ul>
  );
}

function InvestorForm({ meta, initial, onSaved, onCancel }) {
  const editing = !!initial?.id;
  const [f, setF] = useState(() => ({ ...EMPTY, ...(initial || {}), password: editing ? '' : tempPassword(),
    sections: initial?.sections || Object.fromEntries(meta.sections.map((s) => [s.key, true])) }));
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    setBusy(true);
    const body = { name: f.name, email: f.email, phone: f.phone || null, organisation: f.organisation || null, notes: f.notes || null, active: f.active,
      share_pct: f.share_pct === '' || f.share_pct == null ? null : Number(f.share_pct), committed_amount: f.committed_amount === '' || f.committed_amount == null ? null : Number(f.committed_amount),
      sections: f.sections, password: f.password || undefined };
    try {
      const r = await (editing ? investorsAPI.update(initial.id, body) : investorsAPI.create(body));
      toast.success(editing ? 'Saved' : `${f.name} can now sign in`);
      onSaved(r.data, editing ? null : f.password);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not save'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="investor-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input value={f.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} data-testid="inv-name" /></Field>
        <Field label="Email (their sign-in)"><input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} className={inputCls} data-testid="inv-email" /></Field>
        <Field label="Phone"><input value={f.phone || ''} onChange={(e) => set({ phone: e.target.value })} className={inputCls} /></Field>
        <Field label="Company / family office"><input value={f.organisation || ''} onChange={(e) => set({ organisation: e.target.value })} className={inputCls} /></Field>
        <Field label="Share (%)" hint="Their agreed share, shown to them"><input type="number" min="0" max="100" step="0.01" value={f.share_pct ?? ''} onChange={(e) => set({ share_pct: e.target.value })} className={inputCls} data-testid="inv-share" /></Field>
        <Field label="Agreed amount (₹)" hint="What they plan to put in, in total"><input type="number" min="0" value={f.committed_amount ?? ''} onChange={(e) => set({ committed_amount: e.target.value })} className={inputCls} data-testid="inv-committed" /></Field>
      </div>
      <Field label={editing ? 'New temporary password (leave empty to keep theirs)' : 'Temporary password'} hint="They must choose their own password the first time they sign in.">
        <div className="flex gap-2">
          <input value={f.password} onChange={(e) => set({ password: e.target.value })} className={`${inputCls} font-mono`} placeholder={editing ? 'Unchanged' : ''} data-testid="inv-password" />
          <Button type="button" variant="outline" onClick={() => set({ password: tempPassword() })} className="h-10 shrink-0 gap-1" title="Make one up"><Wand2 className="h-4 w-4" /></Button>
        </div>
      </Field>
      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-700">What they can see</p>
        <SectionSwitches meta={meta} value={f.sections} onChange={(sections) => set({ sections })} />
        <p className="mt-1 text-[11px] text-slate-500">Investors never see customer names, phone numbers or any staff page.</p>
      </div>
      <Field label="Private notes (only admins see these)"><textarea value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} rows={2} className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-emerald-400" /></Field>
      {editing && (
        <label className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
          <span><span className="block text-sm font-medium text-slate-800">Can sign in</span><span className="block text-[11px] text-slate-500">Switching off signs them out straight away.</span></span>
          <Switch checked={f.active} onCheckedChange={(v) => set({ active: v })} data-testid="inv-active" />
        </label>
      )}
      <div className="flex gap-2">
        {onCancel && <Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>}
        <Button onClick={save} disabled={busy || !f.name.trim() || !f.email.trim()} className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="inv-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save' : 'Create login'}</Button>
      </div>
    </div>
  );
}

function Ledger({ meta, investor, onChanged }) {
  const [data, setData] = useState(null);
  const [f, setF] = useState({ type: 'investment', amount: '', date: today(), mode: '', reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => investorsAPI.ledger(investor.id).then((r) => setData(r.data)), [investor.id]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    setBusy(true);
    try {
      await investorsAPI.addEntry(investor.id, { ...f, amount: Number(f.amount) });
      setF((x) => ({ ...x, amount: '', reference: '', note: '' }));
      toast.success('Recorded'); load(); onChanged();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not save'); } finally { setBusy(false); }
  };
  const remove = async (e) => {
    if (!window.confirm(`Remove ${e.type_label.toLowerCase()} of ${inr(e.amount)} on ${e.date}?`)) return;
    await investorsAPI.removeEntry(investor.id, e.id).catch(() => toast.error('Could not remove'));
    load(); onChanged();
  };
  if (!data) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />;
  const s = data.summary;
  return (
    <div className="space-y-3" data-testid="investor-ledger">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 p-2"><p className="text-[11px] text-slate-500">Put in</p><p className="font-semibold text-slate-900">{inrShort(s.invested)}</p></div>
        <div className="rounded-lg bg-slate-50 p-2"><p className="text-[11px] text-slate-500">Paid out</p><p className="font-semibold text-slate-900">{inrShort(s.payouts)}</p></div>
        <div className="rounded-lg bg-slate-50 p-2"><p className="text-[11px] text-slate-500">Return</p><p className="font-semibold text-slate-900">{s.return_pct}%</p></div>
      </div>
      <div className="space-y-2 rounded-xl border border-slate-200 p-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {meta.ledger_types.map((t) => <button key={t.key} type="button" onClick={() => setF({ ...f, type: t.key })} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${f.type === t.key ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`} data-testid={`ledger-type-${t.key}`}>{t.label}</button>)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min="1" placeholder="Amount ₹" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={inputCls} data-testid="ledger-amount" />
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} data-testid="ledger-date" />
          <input placeholder="Mode (bank, UPI…)" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} className={inputCls} />
          <input placeholder="Reference / UTR" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} className={inputCls} />
        </div>
        <input placeholder="Note (shown to the investor)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inputCls} />
        <Button onClick={add} disabled={busy || !(Number(f.amount) > 0)} className="h-10 w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800" data-testid="ledger-add">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Record</Button>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {data.entries.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-400">Nothing recorded yet.</li>}
        {data.entries.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className={`h-2 w-2 shrink-0 rounded-full ${e.type === 'investment' ? 'bg-[#2a78d6]' : 'bg-[#eb6834]'}`} />
            <span className="min-w-0 flex-1"><span className="block text-slate-800">{e.type_label} · <b className="tabular-nums">{inr(e.amount)}</b></span><span className="block truncate text-[11px] text-slate-500">{e.date}{e.mode ? ` · ${e.mode}` : ''}{e.reference ? ` · ${e.reference}` : ''}{e.note ? ` · ${e.note}` : ''}</span></span>
            <button type="button" onClick={() => remove(e)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove entry"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InvestorSheet({ meta, investor, onClose, onChanged, onPreview }) {
  const [tab, setTab] = useState('money');
  const [activity, setActivity] = useState(null);
  useEffect(() => { if (tab === 'signins') investorsAPI.activity(investor.id).then((r) => setActivity(r.data)).catch(() => setActivity([])); }, [tab, investor.id]);
  const remove = async () => {
    if (!window.confirm(`Remove ${investor.name}? Their login and every money entry will be deleted.`)) return;
    await investorsAPI.remove(investor.id).then(() => { toast.success('Investor removed'); onChanged(); onClose(); }).catch(() => toast.error('Could not remove'));
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="investor-sheet">
        <SheetHeader className="text-left">
          <SheetTitle className="font-['Outfit']">{investor.name}</SheetTitle>
          <SheetDescription>{investor.email}{investor.organisation ? ` · ${investor.organisation}` : ''}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => onPreview(investor)} variant="outline" className="flex-1 gap-1.5" data-testid="inv-preview"><Eye className="h-4 w-4" />See what they see</Button>
        </div>
        <div className="mt-4 flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
          {[['money', 'Money'], ['details', 'Details & access'], ['signins', 'Sign-ins']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${tab === k ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`} data-testid={`inv-tab-${k}`}>{l}</button>
          ))}
        </div>
        <div className="mt-4">
          {tab === 'money' && <Ledger meta={meta} investor={investor} onChanged={onChanged} />}
          {tab === 'details' && <InvestorForm meta={meta} initial={investor} onSaved={() => onChanged()} />}
          {tab === 'signins' && (
            !activity ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /> : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                {activity.length === 0 && <li className="px-3 py-4 text-center text-slate-400">Hasn’t signed in yet.</li>}
                {activity.map((a, i) => <li key={i} className="flex justify-between px-3 py-2"><span>{when(a.at)}</span><span className="text-xs text-slate-400">{a.ip}</span></li>)}
              </ul>
            )
          )}
        </div>
        <button type="button" onClick={remove} className="mt-6 flex items-center gap-1.5 text-xs font-medium text-red-600 hover:underline" data-testid="inv-remove"><Trash2 className="h-3.5 w-3.5" />Remove this investor</button>
      </SheetContent>
    </Sheet>
  );
}

function InvestorsTab({ meta }) {
  const [ov, setOv] = useState(null);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState(null);
  const [open, setOpen] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewMonths, setPreviewMonths] = useState(12);
  const load = useCallback(() => investorsAPI.overview().then((r) => setOv(r.data)).catch(() => toast.error('Could not load investors')), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!preview?.investor) return;
    setPreview((p) => ({ ...p, data: null }));
    investorsAPI.preview(preview.investor.id, previewMonths).then((r) => setPreview((p) => ({ ...p, data: r.data })));
  }, [preview?.investor, previewMonths]);
  if (!ov) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  const t = ov.totals;
  return (
    <div className="space-y-5" data-testid="investors-tab">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[['Investors', `${t.active} of ${t.investors}`, 'can sign in'], ['Money in', inrShort(t.invested), t.committed ? `of ${inrShort(t.committed)} agreed` : 'recorded'],
          ['Paid out', inrShort(t.payouts), t.invested ? `${Math.round((t.payouts / t.invested) * 1000) / 10}% of money in` : '—'], ['Still invested', inrShort(t.capital_in_business), t.capital_returned ? `${inrShort(t.capital_returned)} returned` : 'none returned']]
          .map(([l, v, s]) => <div key={l} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">{l}</p><p className="mt-1 font-['Outfit'] text-xl font-semibold text-slate-900">{v}</p><p className="text-[11px] text-slate-500">{s}</p></div>)}
      </div>

      {ov.flows.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="investor-flows">
          <h3 className="font-['Outfit'] text-base font-semibold text-slate-900">Money in and payouts</h3>
          <p className="mb-2 text-xs text-slate-500">By month, across all investors</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ov.flows} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="#ecebe8" />
                <XAxis dataKey="month" tickFormatter={(m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })} tick={{ fontSize: 11, fill: '#8a8984' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={inrShort} tick={{ fontSize: 11, fill: '#8a8984' }} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(v) => inr(v)} labelFormatter={(m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="invested" name="Money in" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="payouts" name="Payouts" fill="#eb6834" radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-['Outfit'] text-base font-semibold text-slate-900"><Users className="h-4 w-4 text-emerald-600" />Investors</h3>
          <Button onClick={() => setAdding(true)} className="h-9 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="add-investor"><UserPlus className="h-4 w-4" />Add investor</Button>
        </div>
        {ov.rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"><Landmark className="mx-auto mb-2 h-6 w-6 text-slate-300" />No investors yet. Add one to give them their own sign-in and dashboard.</div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="investor-list">
            {ov.rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r)} className={`w-full rounded-2xl border bg-white p-4 text-left transition-colors hover:border-emerald-300 ${r.active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`} data-testid={`investor-${r.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{r.name}</p><p className="truncate text-xs text-slate-500">{r.organisation || r.email}</p></div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${r.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{r.active ? (r.must_reset_password ? 'Invited' : 'Active') : 'Off'}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <p><span className="block text-slate-500">Put in</span><b className="text-slate-900">{inrShort(r.money.invested)}</b></p>
                    <p><span className="block text-slate-500">Paid out</span><b className="text-slate-900">{inrShort(r.money.payouts)}</b></p>
                    <p><span className="block text-slate-500">Share</span><b className="text-slate-900">{r.share_pct ? `${r.share_pct}%` : '—'}</b></p>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">Sees {Object.values(r.sections).filter(Boolean).length} of {meta.sections.length} sections · last sign-in {when(r.last_login_at)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ov.recent_logins.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 flex items-center gap-2 font-['Outfit'] text-base font-semibold text-slate-900"><KeyRound className="h-4 w-4 text-slate-400" />Recent sign-ins</h3>
          <ul className="divide-y divide-slate-100 text-sm">{ov.recent_logins.map((l, i) => <li key={i} className="flex justify-between py-1.5"><span>{l.name}</span><span className="text-xs text-slate-500">{when(l.at)}</span></li>)}</ul>
        </section>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="add-investor-dialog">
          <DialogHeader><DialogTitle>Add an investor</DialogTitle><DialogDescription>They sign in on the normal sign-in page and see only what you tick.</DialogDescription></DialogHeader>
          <InvestorForm meta={meta} onCancel={() => setAdding(false)} onSaved={(inv, pw) => { setAdding(false); setCreated({ ...inv, password: pw }); load(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="max-w-md" data-testid="investor-created">
          <DialogHeader><DialogTitle>Login ready for {created?.name}</DialogTitle><DialogDescription>Send these to them privately. They’ll be asked to choose their own password the first time.</DialogDescription></DialogHeader>
          <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
            <p><span className="text-slate-500">Address:</span> <b>{window.location.origin}/login</b></p>
            <p><span className="text-slate-500">Email:</span> <b>{created?.email}</b></p>
            <p><span className="text-slate-500">Temporary password:</span> <b className="font-mono">{created?.password}</b></p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(`Sign in at ${window.location.origin}/login\nEmail: ${created?.email}\nTemporary password: ${created?.password}`); toast.success('Copied'); }}>Copy</Button>
            <Button onClick={() => setCreated(null)} className="bg-emerald-600 text-white hover:bg-emerald-700">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {open && <InvestorSheet meta={meta} investor={open} onClose={() => setOpen(null)} onChanged={load} onPreview={(inv) => { setOpen(null); setPreviewMonths(12); setPreview({ investor: inv, data: null }); }} />}

      {preview && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-50" role="dialog" aria-label={`What ${preview.investor.name} sees`} data-testid="investor-preview">
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
            <Eye className="h-4 w-4 shrink-0 text-amber-700" />
            <p className="min-w-0 flex-1 truncate text-sm text-amber-900">Preview — exactly what <b>{preview.investor.name}</b> sees</p>
            <Button size="sm" variant="outline" onClick={() => { const inv = preview.investor; setPreview(null); setOpen(ov.rows.find((r) => r.id === inv.id) || inv); }} className="h-8 gap-1" data-testid="preview-close"><X className="h-4 w-4" />Close</Button>
          </div>
          <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="font-['Outfit'] text-2xl font-bold text-slate-900">Hello, {preview.investor.name.split(' ')[0]}</h2>
              <PeriodPicker value={previewMonths} onChange={setPreviewMonths} />
            </div>
            {preview.data ? <BusinessView data={preview.data} audience="investor" /> : <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InvestorsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'investors' ? 'investors' : 'business';
  const [months, setMonths] = useState(12);
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const loadBusiness = useCallback(() => { setData(null); investorsAPI.business(months).then((r) => setData(r.data)).catch(() => toast.error('Could not load the numbers')); }, [months]);
  useEffect(() => { investorsAPI.meta().then((r) => setMeta(r.data)).catch(() => {}); }, []);
  useEffect(() => { if (tab === 'business') loadBusiness(); }, [tab, loadBusiness]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6" data-testid="investors-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-['Outfit'] text-2xl font-bold text-slate-900"><Landmark className="h-6 w-6 text-emerald-600" />Investors</h1>
          <p className="text-sm text-slate-500">The business at a glance, and your investors’ own logins.</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
          {[['business', 'Business'], ['investors', 'Investors']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'business' ? {} : { tab: k }, { replace: true })}
              className={`rounded-md px-4 py-2 text-sm font-medium ${tab === k ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`} data-testid={`investors-tab-${k}`}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'business' ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <PeriodPicker value={months} onChange={setMonths} />
            <Button variant="ghost" size="sm" onClick={loadBusiness} className="gap-1 text-slate-500"><RefreshCw className="h-4 w-4" /><span className="hidden sm:inline">Refresh</span></Button>
          </div>
          {data ? <BusinessView data={data} audience="admin" /> : <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
        </>
      ) : meta ? <InvestorsTab meta={meta} /> : <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
    </div>
  );
}
