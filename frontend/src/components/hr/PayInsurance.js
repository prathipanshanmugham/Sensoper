/* Pay & benefits → Insurance: the company's policies (group health, accident, term life), who is covered with which
 * family members, each person's share taken from salary, claims, and renewal dates. */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { HeartPulse, Loader2, Pencil, Plus, ShieldCheck, Trash2, UserMinus } from 'lucide-react';
import { payrollAPI, uploadAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { Card, Chip, Empty, Field, FileAttach, Loading, errText, fmtDate, inr, inputCls, todayISO } from '../kit/PageBits';
import { CLAIM_STATUS, COVER, POLICY_KIND, PersonPick, StatusChip, n0 } from './payBits';

function PolicyDialog({ open, initial, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const y = new Date().getFullYear();
    setF({ name: '', kind: 'group_health', insurer: '', policy_number: '', sum_insured: '', premium: '', start_date: todayISO(), end_date: `${y + 1}-${todayISO().slice(5, 10)}`,
      tpa: '', helpline: '', employee_share_monthly: '', document: null, notes: '', ...(initial || {}) });
  }, [open, initial]);
  if (!open || !f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    const data = { ...f, sum_insured: n0(f.sum_insured), premium: n0(f.premium), employee_share_monthly: n0(f.employee_share_monthly) };
    ['id', 'members', 'claims', 'state', 'days_left', 'active_members', 'created_by'].forEach((k) => delete data[k]);
    try { if (f.id) await payrollAPI.editPolicy(f.id, data); else await payrollAPI.addPolicy(data); toast.success('Saved'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="pay-policy-dialog">
        <DialogHeader><DialogTitle>{f.id ? 'Change policy' : 'Add a policy'}</DialogTitle><DialogDescription>You get a reminder 30 and 7 days before it ends.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={set('name')} placeholder="e.g. Group health 2026-27" className="h-11" data-testid="pay-pol-name" /></Field>
          <Field label="Type"><Select value={f.kind} onValueChange={(v) => setF((x) => ({ ...x, kind: v }))}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(POLICY_KIND).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Insurer"><Input value={f.insurer} onChange={set('insurer')} placeholder="e.g. Star Health" className="h-11" data-testid="pay-pol-insurer" /></Field>
          <Field label="Policy number"><Input value={f.policy_number} onChange={set('policy_number')} className="h-11" /></Field>
          <Field label="Sum insured (₹)"><Input value={f.sum_insured} onChange={set('sum_insured')} inputMode="decimal" className="h-11" /></Field>
          <Field label="Starts"><input type="date" value={f.start_date} onChange={set('start_date')} className={inputCls} /></Field>
          <Field label="Ends"><input type="date" value={f.end_date} onChange={set('end_date')} className={inputCls} data-testid="pay-pol-end" /></Field>
          <Field label="Premium a year (₹)"><Input value={f.premium} onChange={set('premium')} inputMode="decimal" className="h-11" /></Field>
          <Field label="Staff share a month (₹)" hint="Taken from salary; 0 = company pays all"><Input value={f.employee_share_monthly} onChange={set('employee_share_monthly')} inputMode="decimal" className="h-11" data-testid="pay-pol-share" /></Field>
          <Field label="TPA / claims desk"><Input value={f.tpa} onChange={set('tpa')} className="h-11" /></Field>
          <Field label="Helpline"><Input value={f.helpline} onChange={set('helpline')} inputMode="tel" className="h-11" /></Field>
          <div className="col-span-2"><FileAttach value={f.document} onChange={(p) => setF((x) => ({ ...x, document: p }))} label="Attach policy document" testid="pay-pol-doc" /></div>
          <Field label="Notes" className="col-span-2"><Input value={f.notes || ''} onChange={set('notes')} className="h-11" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || f.name.trim().length < 2} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-pol-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberDialog({ policy, member, people, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (policy) setF({ user_id: '', cover: 'self', member_number: '', dependants: [], sum_insured: '', employee_share_monthly: '', added_on: todayISO(), removed_on: '', ...(member || {}),
    ...(member ? { sum_insured: member.sum_insured ?? '', employee_share_monthly: member.employee_share_monthly ?? '', removed_on: member.removed_on || '' } : {}) }); }, [policy, member]);
  if (!policy || !f) return null;
  const save = async () => {
    setSaving(true);
    const data = { user_id: f.user_id, cover: f.cover, member_number: f.member_number, dependants: f.dependants.filter((d) => d.name), added_on: f.added_on || null, removed_on: f.removed_on || null,
      sum_insured: f.sum_insured === '' ? null : n0(f.sum_insured), employee_share_monthly: f.employee_share_monthly === '' ? null : n0(f.employee_share_monthly) };
    try { if (member) await payrollAPI.editMember(policy.id, member.id, data); else await payrollAPI.addMember(policy.id, data); toast.success('Saved'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  const covered = new Set((policy.members || []).filter((m) => !m.removed_on).map((m) => m.user_id));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto" data-testid="pay-member-dialog">
        <DialogHeader><DialogTitle>{member ? `Cover for ${member.name}` : 'Add someone'}</DialogTitle><DialogDescription>{policy.name}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {!member && <Field label="Person" className="col-span-2"><PersonPick people={people.filter((p) => !covered.has(p.id))} value={f.user_id} onChange={(v) => setF((x) => ({ ...x, user_id: v }))} testid="pay-mem-person" /></Field>}
          <Field label="Cover"><Select value={f.cover} onValueChange={(v) => setF((x) => ({ ...x, cover: v }))}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(COVER).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Member / e-card number"><Input value={f.member_number} onChange={(e) => setF((x) => ({ ...x, member_number: e.target.value }))} className="h-11" data-testid="pay-mem-number" /></Field>
          <Field label="Sum insured (blank = policy's)"><Input value={f.sum_insured} onChange={(e) => setF((x) => ({ ...x, sum_insured: e.target.value }))} inputMode="decimal" className="h-11" /></Field>
          <Field label="Their share a month (blank = policy's)"><Input value={f.employee_share_monthly} onChange={(e) => setF((x) => ({ ...x, employee_share_monthly: e.target.value }))} inputMode="decimal" className="h-11" /></Field>
          <Field label="Covered from"><input type="date" value={f.added_on || ''} onChange={(e) => setF((x) => ({ ...x, added_on: e.target.value }))} className={inputCls} /></Field>
          {member && <Field label="Removed on"><input type="date" value={f.removed_on || ''} onChange={(e) => setF((x) => ({ ...x, removed_on: e.target.value }))} className={inputCls} /></Field>}
        </div>
        {f.cover !== 'self' && (
          <div className="space-y-2"><p className="text-xs font-medium text-slate-700">Family covered</p>
            {f.dependants.map((d, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem_8.5rem_2.5rem] gap-1.5">
                <Input value={d.name} onChange={(e) => setF((x) => ({ ...x, dependants: x.dependants.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} placeholder="Name" className="h-10" />
                <Input value={d.relation} onChange={(e) => setF((x) => ({ ...x, dependants: x.dependants.map((y, j) => (j === i ? { ...y, relation: e.target.value } : y)) }))} placeholder="Relation" className="h-10" />
                <input type="date" value={d.dob || ''} onChange={(e) => setF((x) => ({ ...x, dependants: x.dependants.map((y, j) => (j === i ? { ...y, dob: e.target.value } : y)) }))} className={`${inputCls} h-10`} aria-label="Date of birth" />
                <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setF((x) => ({ ...x, dependants: x.dependants.filter((_, j) => j !== i) }))} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
              </div>))}
            <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setF((x) => ({ ...x, dependants: [...x.dependants, { name: '', relation: '', dob: '' }] }))}><Plus className="h-3.5 w-3.5" />Add family member</Button></div>)}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || (!member && !f.user_id)} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pay-mem-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClaimDialog({ policy, claim, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (policy) setF({ user_id: '', patient: '', hospital: '', admitted_on: todayISO(), amount_claimed: '', amount_settled: '', status: 'filed', notes: '', ...(claim || {}) }); }, [policy, claim]);
  if (!policy || !f) return null;
  const members = (policy.members || []).map((m) => ({ id: m.user_id, name: m.name || 'Member' }));
  const save = async () => {
    setSaving(true);
    const data = { user_id: f.user_id, patient: f.patient, hospital: f.hospital, admitted_on: f.admitted_on || null, amount_claimed: n0(f.amount_claimed), amount_settled: n0(f.amount_settled), status: f.status, notes: f.notes };
    try { if (claim) await payrollAPI.editClaim(policy.id, claim.id, data); else await payrollAPI.addClaim(policy.id, data); toast.success('Saved'); onSaved(); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="pay-claim-dialog">
        <DialogHeader><DialogTitle>{claim ? 'Update claim' : 'Record a claim'}</DialogTitle><DialogDescription>{policy.name}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {!claim && <Field label="Staff member" className="col-span-2"><PersonPick people={members} value={f.user_id} onChange={(v) => setF((x) => ({ ...x, user_id: v }))} /></Field>}
          <Field label="Patient"><Input value={f.patient} onChange={(e) => setF((x) => ({ ...x, patient: e.target.value }))} placeholder="Self, or family member" className="h-11" /></Field>
          <Field label="Hospital"><Input value={f.hospital} onChange={(e) => setF((x) => ({ ...x, hospital: e.target.value }))} className="h-11" /></Field>
          <Field label="Admitted on"><input type="date" value={f.admitted_on || ''} onChange={(e) => setF((x) => ({ ...x, admitted_on: e.target.value }))} className={inputCls} /></Field>
          <Field label="Status"><Select value={f.status} onValueChange={(v) => setF((x) => ({ ...x, status: v }))}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(CLAIM_STATUS).map(([k, [l]]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Claimed (₹)"><Input value={f.amount_claimed} onChange={(e) => setF((x) => ({ ...x, amount_claimed: e.target.value }))} inputMode="decimal" className="h-11" /></Field>
          <Field label="Settled (₹)"><Input value={f.amount_settled} onChange={(e) => setF((x) => ({ ...x, amount_settled: e.target.value }))} inputMode="decimal" className="h-11" /></Field>
          <Field label="Notes" className="col-span-2"><Input value={f.notes || ''} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} className="h-11" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || (!claim && !f.user_id)} className="bg-emerald-600 text-white hover:bg-emerald-700">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function stateChip(p) {
  if (p.state === 'ended') return <Chip tone="red">Ended {fmtDate(p.end_date, { day: 'numeric', month: 'short' })}</Chip>;
  if (p.state === 'renew_soon') return <Chip tone="amber">Renew in {p.days_left} days</Chip>;
  return <Chip tone="green">Till {fmtDate(p.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}</Chip>;
}

export default function PayInsurance({ people, canEdit }) {
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [dlg, setDlg] = useState(null);     // {kind:'policy'|'member'|'claim', item}
  const load = useCallback(() => payrollAPI.policies().then((r) => setRows(r.data)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  if (rows === null) return <Loading />;
  const p = rows.find((x) => x.id === openId);
  return (
    <div className="space-y-3" data-testid="pay-insurance">
      {canEdit && <Button className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setDlg({ kind: 'policy' })} data-testid="pay-pol-add"><Plus className="h-4 w-4" />Add a policy</Button>}
      {rows.length === 0 ? <Empty icon={HeartPulse} title="No insurance policies yet" text="Add the company's group health, accident or life cover, then add the people it covers." /> : (
        <ul className="grid gap-2 md:grid-cols-2">{rows.map((x) => (
          <li key={x.id}><button type="button" onClick={() => setOpenId(x.id)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-emerald-200" data-testid={`pay-pol-${x.id}`}>
            <div className="flex items-start justify-between gap-2"><p className="font-medium text-slate-900"><ShieldCheck className="mr-1 inline h-4 w-4 text-emerald-600" />{x.name}</p>{stateChip(x)}</div>
            <p className="text-xs text-slate-600">{[POLICY_KIND[x.kind], x.insurer, x.policy_number].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 text-sm text-slate-700">{x.active_members} covered · {inr(x.sum_insured)} each · premium {inr(x.premium)}/yr{x.employee_share_monthly ? ` · staff pay ${inr(x.employee_share_monthly)}/mo` : ''}</p>
          </button></li>))}</ul>)}
      {p && (
        <Sheet open onOpenChange={(o) => !o && setOpenId(null)}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-testid="pay-pol-sheet">
            <div className="space-y-4">
              <SheetHeader className="space-y-1 text-left"><SheetTitle className="flex flex-wrap items-center gap-2">{p.name}{stateChip(p)}</SheetTitle>
                <SheetDescription>{[POLICY_KIND[p.kind], p.insurer, p.policy_number && `No. ${p.policy_number}`, `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}`].filter(Boolean).join(' · ')}</SheetDescription></SheetHeader>
              <div className="flex flex-wrap gap-2 text-sm">
                {p.tpa && <span className="rounded-lg bg-slate-50 px-2 py-1">TPA: {p.tpa}</span>}
                {p.helpline && <a href={`tel:${p.helpline.replace(/\s/g, '')}`} className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-800">Call {p.helpline}</a>}
                {p.document && <a href={uploadAPI.getFileUrl(p.document)} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-50 px-2 py-1 text-emerald-700 underline">Policy document</a>}
                {canEdit && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setDlg({ kind: 'policy', item: p })}><Pencil className="h-3.5 w-3.5" />Edit policy</Button>}
                {canEdit && <Button size="sm" variant="ghost" className="h-8 gap-1 text-rose-700" onClick={async () => { try { await payrollAPI.deletePolicy(p.id); setOpenId(null); load(); toast.success('Deleted'); } catch (e) { toast.error(errText(e)); } }}><Trash2 className="h-3.5 w-3.5" />Delete</Button>}
              </div>
              <Card title={`Covered (${p.active_members})`} action={canEdit && <Button size="sm" className="h-8 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setDlg({ kind: 'member' })} data-testid="pay-mem-add"><Plus className="h-3.5 w-3.5" />Add</Button>}>
                {p.members.length === 0 ? <p className="text-xs text-slate-400">Nobody yet</p> : <ul className="divide-y divide-slate-100 text-sm">{p.members.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-2 py-2">
                    <span className="min-w-0"><span className="block font-medium text-slate-900">{m.name || 'Someone who left'} {m.removed_on && <Chip><UserMinus className="h-3 w-3" />removed {fmtDate(m.removed_on, { day: 'numeric', month: 'short' })}</Chip>}</span>
                      <span className="block text-xs text-slate-600">{[COVER[m.cover], m.member_number, m.sum_insured ? inr(m.sum_insured) : null].filter(Boolean).join(' · ')}</span>
                      {m.dependants?.length > 0 && <span className="block text-[11px] text-slate-500">{m.dependants.map((d) => `${d.name}${d.relation ? ` (${d.relation})` : ''}`).join(', ')}</span>}</span>
                    {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Edit cover" onClick={() => setDlg({ kind: 'member', item: m })}><Pencil className="h-3.5 w-3.5" /></Button>}
                  </li>))}</ul>}
              </Card>
              <Card title={`Claims (${p.claims.length})`} action={canEdit && p.members.length > 0 && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setDlg({ kind: 'claim' })}><Plus className="h-3.5 w-3.5" />Record</Button>}>
                {p.claims.length === 0 ? <p className="text-xs text-slate-400">None</p> : <ul className="divide-y divide-slate-100 text-sm">{p.claims.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2 py-2">
                    <span className="min-w-0"><span className="block font-medium">{c.name}{c.patient ? ` · ${c.patient}` : ''}</span><span className="block text-xs text-slate-600">{[c.hospital, c.admitted_on && fmtDate(c.admitted_on)].filter(Boolean).join(' · ')}</span>
                      <span className="text-[11px] text-slate-500">claimed {inr(c.amount_claimed)}{c.amount_settled ? ` · settled ${inr(c.amount_settled)}` : ''}</span></span>
                    <span className="flex shrink-0 items-center gap-1"><StatusChip map={CLAIM_STATUS} value={c.status} />{canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Update claim" onClick={() => setDlg({ kind: 'claim', item: c })}><Pencil className="h-3.5 w-3.5" /></Button>}</span>
                  </li>))}</ul>}
              </Card>
            </div>
            {/* dialogs opened from the sheet live inside it, so focus stays with them */}
            <PolicyDialog open={dlg?.kind === 'policy'} initial={dlg?.item} onOpenChange={(o) => !o && setDlg(null)} onSaved={load} />
            {dlg?.kind === 'member' && <MemberDialog policy={p} member={dlg.item} people={people} onOpenChange={(o) => !o && setDlg(null)} onSaved={load} />}
            {dlg?.kind === 'claim' && <ClaimDialog policy={p} claim={dlg.item} onOpenChange={(o) => !o && setDlg(null)} onSaved={load} />}
          </SheetContent>
        </Sheet>)}
      {!p && <PolicyDialog open={dlg?.kind === 'policy'} initial={dlg?.item} onOpenChange={(o) => !o && setDlg(null)} onSaved={load} />}
    </div>
  );
}
