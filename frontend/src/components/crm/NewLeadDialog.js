/* Add a lead in a few seconds: number first, then what they want and when to call back.
 * Opens from the Leads page, the N key anywhere, and Ctrl+K → New lead. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronDown, Loader2, UserPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Field, inputCls, errText } from '../kit/PageBits';
import { crmAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { followUpChoices, loadMeta, leadsChanged, digits } from './leadBits';
import { MOD } from '../../lib/hotkeys';

const KIND_SHORT = { home: 'Home rooftop', farm: 'Farm / pump', business: 'Business', battery: 'Battery & UPS', service: 'Service / AMC', other: 'Other' };
const blank = () => ({ phone: '', name: '', kind: 'home', channel: 'phone', area: '', message: '', fu: 'tomorrow', follow_up_at: '',
  assigned_to: '', email: '', company: '', pincode: '', kw: '', value: '', heat: 'warm', referred_by: '' });

export default function NewLeadDialog({ open, onOpenChange, onCreated, initial }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [f, setF] = useState(blank);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState(null);
  const phoneRef = useRef(null);
  const choices = useMemo(() => followUpChoices(), [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setF({ ...blank(), ...(initial || {}) });
    setDup(null); setMore(false);
    loadMeta().then(setMeta).catch(() => {});
    setTimeout(() => phoneRef.current?.focus(), 50);
  }, [open, initial]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const save = async (allowDuplicate = false) => {
    if (digits(f.phone).length !== 10) { toast.error('Enter a 10-digit mobile number'); phoneRef.current?.focus(); return; }
    const day = choices.find((c) => c.key === f.fu)?.day || (f.fu && /^\d{4}-/.test(f.fu) ? f.fu : null);
    setBusy(true);
    try {
      const r = await crmAPI.create({
        phone: f.phone, name: f.name, kind: f.kind, channel: f.channel, area: f.area, message: f.message,
        follow_up_on: day, follow_up_at: day && f.follow_up_at ? f.follow_up_at : null,
        assigned_to: f.assigned_to || null, email: f.email, company: f.company, pincode: f.pincode,
        kw: f.kw === '' ? null : f.kw, value: f.value === '' ? null : f.value, heat: f.heat, referred_by: f.referred_by,
        allow_duplicate: allowDuplicate,
      });
      if (!r.data.created) { setDup(r.data.existing); return; }
      const lead = r.data.lead;
      leadsChanged();
      toast.success(`${lead.name || `+91 ${lead.phone}`} added — ${lead.number}`, {
        action: onCreated ? undefined : { label: 'Open', onClick: () => navigate(`/dashboard/leads?lead=${lead.id}`) },
      });
      onOpenChange(false);
      onCreated?.(lead);
    } catch (e) { toast.error(errText(e, 'Couldn’t add the lead')); } finally { setBusy(false); }
  };

  const onKeyDown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); } };
  const people = meta?.people || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" onKeyDown={onKeyDown} data-testid="new-lead-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-emerald-700" />New lead</DialogTitle>
          <DialogDescription>The number is enough to start. Add when to call back so it shows on the right day.</DialogDescription>
        </DialogHeader>

        {dup ? (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" data-testid="lead-duplicate">
            <p><b>+91 {digits(f.phone)}</b> is already a lead: {dup.number}{dup.name ? ` — ${dup.name}` : ''}, {dup.status_label?.toLowerCase()}{dup.assigned_to_name ? `, with ${dup.assigned_to_name}` : ''}.</p>
            <div className="flex flex-wrap gap-2">
              {dup.can_open && <Button className="h-10 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => { onOpenChange(false); navigate(`/dashboard/leads?lead=${dup.id}`); }} data-testid="lead-duplicate-open">Open that lead</Button>}
              <Button variant="outline" className="h-10" onClick={() => save(true)} disabled={busy}>Add a new one anyway</Button>
              <Button variant="ghost" className="h-10" onClick={() => setDup(null)}>Change the number</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Mobile number">
                <input ref={phoneRef} className={inputCls} inputMode="tel" autoComplete="off" value={f.phone} onChange={set('phone')} placeholder="98765 43210" data-testid="new-lead-phone" />
              </Field>
              <Field label="Name"><input className={inputCls} value={f.name} onChange={set('name')} placeholder="Their name" data-testid="new-lead-name" /></Field>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-700">What they want</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What they want">
                {Object.entries(KIND_SHORT).map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => set('kind')(k)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${f.kind === k ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}
                    data-testid={`new-lead-kind-${k}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Came from">
                <select className={inputCls} value={f.channel} onChange={set('channel')} data-testid="new-lead-channel">
                  {(meta?.channels || [{ key: 'phone', label: 'Phone call' }]).filter((c) => c.key !== 'website').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Area or town"><input className={inputCls} value={f.area} onChange={set('area')} placeholder="Perundurai" /></Field>
            </div>
            {f.channel === 'referral' && <Field label="Referred by"><input className={inputCls} value={f.referred_by} onChange={set('referred_by')} placeholder="Who sent them" /></Field>}
            <Field label="What did they say?">
              <textarea className={`${inputCls} h-auto min-h-[72px] py-2`} value={f.message} onChange={set('message')} placeholder="e.g. 3-phase, ₹6,000 bill, wants a site visit on Saturday" data-testid="new-lead-message" />
            </Field>
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-700">Call back</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {[...choices, { key: '', label: 'No date' }].map((c) => (
                  <button key={c.key || 'none'} type="button" onClick={() => set('fu')(c.key)} aria-pressed={f.fu === c.key}
                    className={`rounded-full border px-3 py-1.5 text-sm ${f.fu === c.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}
                    data-testid={`new-lead-fu-${c.key || 'none'}`}>{c.label}</button>
                ))}
                {f.fu && <input type="time" className="h-9 rounded-md border border-slate-300 px-2 text-sm" value={f.follow_up_at} onChange={set('follow_up_at')} aria-label="Time (optional)" />}
              </div>
            </div>
            {(meta?.sees_all || people.length > 1) && (
              <Field label="Who handles it">
                <select className={inputCls} value={f.assigned_to || meta?.me || user?.id || ''} onChange={set('assigned_to')} data-testid="new-lead-owner">
                  {people.map((p) => <option key={p.id} value={p.id}>{p.id === (meta?.me || user?.id) ? `${p.name} (me)` : p.name}</option>)}
                </select>
              </Field>
            )}
            <button type="button" onClick={() => setMore((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900" aria-expanded={more}>
              <ChevronDown className={`h-4 w-4 transition-transform ${more ? '' : '-rotate-90'}`} />More details
            </button>
            {more && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email"><input className={inputCls} type="email" value={f.email} onChange={set('email')} /></Field>
                <Field label="Company"><input className={inputCls} value={f.company} onChange={set('company')} /></Field>
                <Field label="PIN code"><input className={inputCls} inputMode="numeric" value={f.pincode} onChange={set('pincode')} /></Field>
                <Field label="Size (kW)"><input className={inputCls} inputMode="decimal" value={f.kw} onChange={set('kw')} placeholder="5" /></Field>
                <Field label="Likely value (₹)"><input className={inputCls} inputMode="numeric" value={f.value} onChange={set('value')} placeholder="3,00,000" /></Field>
                <Field label="How keen">
                  <select className={inputCls} value={f.heat} onChange={set('heat')}><option value="hot">Hot — ready to buy</option><option value="warm">Warm</option><option value="cold">Cold — just asking</option></select>
                </Field>
              </div>
            )}
          </div>
        )}

        {!dup && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => save()} disabled={busy} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="new-lead-save">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Add lead<kbd className="hidden rounded bg-emerald-700/60 px-1.5 text-[10px] font-medium sm:inline">{MOD}+Enter</kbd>
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
