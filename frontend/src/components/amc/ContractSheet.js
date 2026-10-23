/* One AMC contract: details, notes, visit history, and changes. A cancelled contract can be deleted for good —
 * only by a Sensoper admin, after typing its number. */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, Loader2, Pencil, Phone, Save, Trash2 } from 'lucide-react';
import { amcAPI } from '../../utils/api';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SYSTEM_TYPE_OPTIONS, inr, systemLabel } from './amcCommon';

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS = { active: 'bg-emerald-100 text-emerald-700', renewed: 'bg-blue-100 text-blue-700', cancelled: 'bg-slate-200 text-slate-600', expired: 'bg-rose-100 text-rose-700' };

export default function ContractSheet({ contractId, onOpenChange, canChange, isAdmin, onChanged, onPlanVisit, onRenew, onCancel }) {
  const [c, setC] = useState(null);
  const [notes, setNotes] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    if (!contractId) return;
    amcAPI.get(contractId).then((r) => { setC(r.data); setNotes(r.data.notes || ''); }).catch(() => toast.error('Could not open the contract'));
  }, [contractId]);
  useEffect(() => { setC(null); setEdit(null); setDel(''); load(); }, [load]);

  const save = async (patch, msg) => {
    setBusy('save');
    try { await amcAPI.update(c.id, patch); toast.success(msg); setEdit(null); load(); onChanged?.(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not save'); } finally { setBusy(''); }
  };
  const saveEdit = () => {
    if (edit.system_type === 'others' && !(edit.system_type_other || '').trim()) { toast.error('Say what the system is'); return; }
    const patch = { customer_name: edit.customer_name.trim(), contact: edit.contact, site_address: edit.site_address, district: edit.district,
      system_type: edit.system_type, system_type_other: edit.system_type === 'others' ? edit.system_type_other.trim() : null,
      system_capacity_kw: parseFloat(edit.system_capacity_kw) || 0, visits_per_year: parseInt(edit.visits_per_year, 10) || 1 };
    patch.annual_value = parseFloat(edit.annual_value) || 0;
    save(patch, 'Contract updated');
  };
  const hardDelete = async () => {
    setBusy('delete');
    try {
      await amcAPI.hardDelete(c.id, del);
      toast.success(`${c.contract_number} deleted for good`);
      onOpenChange(false); onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not delete'); } finally { setBusy(''); }
  };

  const open = !!contractId;
  const rows = c ? [
    ['System', `${systemLabel(c)}${c.system_capacity_kw ? ` · ${c.system_capacity_kw} kW` : ''}${c.pump_hp ? ` · ${c.pump_hp} HP` : ''}`],
    ['Plan', c.plan_name || (c.contract_type || '').replace('-', ' ')],
    ['Runs', `${fmt(c.start_date)} – ${fmt(c.end_date)}`],
    ['Visits', `${c.visits_completed || 0} done of ${c.visits_per_year} a year${c.response_time_hours ? ` · breakdown within ${c.response_time_hours} h` : ''}`],
    ['Yearly value', inr(c.annual_value)],
    ['Phone', c.contact],
    ['Site', [c.site_address, c.district].filter(Boolean).join(', ')],
    ['Running since', c.commissioning_date ? fmt(c.commissioning_date) : null],
    ['Cancelled because', c.status === 'cancelled' ? (c.churn_reason || 'no reason given') : null],
  ].filter(([, v]) => v) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="amc-contract-sheet">
        {!c ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : (
          <div className="space-y-5">
            <SheetHeader className="text-left">
              <SheetTitle className="flex flex-wrap items-center gap-2">{c.customer_name}<Badge className={STATUS[c.status] || ''}>{c.status}</Badge></SheetTitle>
              <SheetDescription>{c.contract_number}{c.created_by ? ` · made by ${c.created_by}` : ''}</SheetDescription>
            </SheetHeader>

            {!edit ? (
              <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="amc-contract-details">
                {rows.map(([k, v]) => <div key={k} className="flex gap-3 px-3 py-2 text-sm"><dt className="w-28 shrink-0 text-slate-500">{k}</dt><dd className="min-w-0 flex-1 text-slate-900">{v}</dd></div>)}
              </dl>
            ) : (
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-3" data-testid="amc-contract-edit">
                <div className="col-span-2 space-y-1"><Label className="text-xs">Customer</Label><Input value={edit.customer_name} onChange={(e) => setEdit({ ...edit, customer_name: e.target.value })} className="h-10" /></div>
                <div className="space-y-1"><Label className="text-xs">Phone</Label><Input type="tel" value={edit.contact || ''} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} className="h-10" /></div>
                <div className="space-y-1"><Label className="text-xs">District</Label><Input value={edit.district || ''} onChange={(e) => setEdit({ ...edit, district: e.target.value })} className="h-10" /></div>
                <div className="col-span-2 space-y-1"><Label className="text-xs">Site address</Label><Input value={edit.site_address || ''} onChange={(e) => setEdit({ ...edit, site_address: e.target.value })} className="h-10" /></div>
                <div className="space-y-1"><Label className="text-xs">System type</Label>
                  <Select value={edit.system_type || 'on-grid'} onValueChange={(v) => setEdit({ ...edit, system_type: v })}><SelectTrigger className="h-10" data-testid="amc-edit-type"><SelectValue /></SelectTrigger>
                    <SelectContent>{SYSTEM_TYPE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label className="text-xs">Size (kW)</Label><Input type="number" inputMode="decimal" value={edit.system_capacity_kw} onChange={(e) => setEdit({ ...edit, system_capacity_kw: e.target.value })} className="h-10" /></div>
                {edit.system_type === 'others' && <div className="col-span-2 space-y-1"><Label className="text-xs">What system is it?</Label><Input value={edit.system_type_other || ''} onChange={(e) => setEdit({ ...edit, system_type_other: e.target.value })} placeholder="e.g. UPS, street lights, EV charger" className="h-10" data-testid="amc-edit-type-other" /></div>}
                <div className="space-y-1"><Label className="text-xs">Visits a year</Label><Input type="number" min="1" value={edit.visits_per_year} onChange={(e) => setEdit({ ...edit, visits_per_year: e.target.value })} className="h-10" /></div>
                <div className="space-y-1"><Label className="text-xs">Yearly value (₹)</Label><Input type="number" min="0" value={edit.annual_value} onChange={(e) => setEdit({ ...edit, annual_value: e.target.value })} className="h-10" /></div>
                <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEdit(null)}>Cancel</Button>
                  <Button size="sm" onClick={saveEdit} disabled={busy === 'save' || !edit.customer_name?.trim()} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="amc-edit-save">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {c.contact && <a href={`tel:${c.contact}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700"><Phone className="h-4 w-4" />Call</a>}
              {c.status === 'active' && onPlanVisit && <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onPlanVisit(c)} data-testid="amc-sheet-plan-visit"><CalendarClock className="h-4 w-4" />Plan visit</Button>}
              {canChange && !edit && <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setEdit({ ...c, system_capacity_kw: c.system_capacity_kw ?? '', annual_value: c.annual_value ?? '' })} data-testid="amc-sheet-edit"><Pencil className="h-4 w-4" />Edit</Button>}
              {canChange && c.status === 'active' && <Button size="sm" variant="outline" className="h-9" onClick={async () => { await onRenew(c); load(); }} data-testid="amc-sheet-renew">Renew</Button>}
              {canChange && c.status === 'active' && <Button size="sm" variant="ghost" className="h-9 text-rose-600" onClick={async () => { await onCancel(c); load(); }} data-testid="amc-sheet-cancel">Cancel contract</Button>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-700">Notes</Label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canChange} placeholder="Gate code, best time to visit, who to call…"
                className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400 disabled:bg-slate-50" data-testid="amc-sheet-notes" />
              {canChange && notes !== (c.notes || '') && <Button size="sm" onClick={() => save({ notes }, 'Notes saved')} disabled={busy === 'save'} className="h-8 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="amc-sheet-notes-save"><Save className="h-3.5 w-3.5" />Save notes</Button>}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Visits</p>
              {(c.visit_history || []).length === 0 ? <p className="text-xs text-slate-400">No visits yet.</p> : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                  {c.visit_history.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2"><span>{fmt(v.actual_date || v.scheduled_date)} · {v.visit_type}{v.technician_name ? ` · ${v.technician_name}` : ''}</span>
                      <Badge variant="outline" className="text-[10px]">{v.status === 'completed' ? 'done' : 'planned'}</Badge></li>
                  ))}
                </ul>
              )}
            </div>

            {isAdmin && c.status === 'cancelled' && (
              <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3" data-testid="amc-delete-box">
                <p className="text-sm font-semibold text-rose-900">Delete this contract for good</p>
                <p className="text-xs text-rose-800">Removes the contract, its visits and reminders. It can't be undone; the audit log keeps a copy. Type <b>{c.contract_number}</b> to confirm.</p>
                <div className="flex gap-2">
                  <Input value={del} onChange={(e) => setDel(e.target.value)} placeholder={c.contract_number} className="h-10 bg-white" data-testid="amc-delete-confirm" />
                  <Button onClick={hardDelete} disabled={busy === 'delete' || del.trim().toUpperCase() !== c.contract_number.toUpperCase()} className="h-10 gap-1.5 bg-rose-600 text-white hover:bg-rose-700" data-testid="amc-delete-btn">
                    {busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
