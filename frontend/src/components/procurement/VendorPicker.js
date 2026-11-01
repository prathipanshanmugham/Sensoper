/* Choose a vendor from the Vendors list — never typed. Search by name, category, district or tag; preferred vendors
 * first, then by rating. Blocked and inactive vendors are not offered. People who may add vendors can add one here
 * without leaving the form, and it is picked straight away. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Plus, Star } from 'lucide-react';
import { toast } from 'sonner';
import { vendorsAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, errText } from '../kit/PageBits';

const CATEGORIES = ['panels', 'inverters', 'batteries', 'structure', 'cables', 'transport', 'services', 'other'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Active, not-blocked vendors for a picker. Returns [vendors|null while loading, reload, setVendors]. */
export function useVendorChoices(enabled = true) {
  const [vendors, setVendors] = useState(null);
  const load = useCallback(() => vendorsAPI.list({ status: 'active', flag: 'not_blocked' })
    .then((r) => setVendors(r.data || [])).catch(() => setVendors([])), []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return [vendors, load, setVendors];
}

export const vendorLine = (v) => [v.category && cap(v.category), v.district, v.rating ? `${v.rating}★` : null,
  v.credit_days ? `${v.credit_days} days credit` : null].filter(Boolean).join(' · ');

function QuickVendorDialog({ name, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (name !== null) setF({ name, contact_person: '', phone: '', category: 'other', district: '' }); }, [name]);
  if (name === null || !f) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try { const r = await vendorsAPI.create(f); toast.success(`${r.data.name} added to Vendors`); onSaved(r.data); onOpenChange(false); }
    catch (e) { toast.error(errText(e, 'Could not add the vendor')); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="vendor-quick-add">
        <DialogHeader><DialogTitle>Add a vendor</DialogTitle><DialogDescription>Saved in Vendors. Add GSTIN, address and tags there later.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Vendor name *" className="col-span-2"><Input value={f.name} onChange={set('name')} className="h-11" autoFocus data-testid="vendor-quick-name" /></Field>
          <Field label="Contact person"><Input value={f.contact_person} onChange={set('contact_person')} className="h-11" /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={set('phone')} inputMode="tel" className="h-11" /></Field>
          <Field label="Category">
            <Select value={f.category} onValueChange={(v) => setF((x) => ({ ...x, category: v }))}>
              <SelectTrigger className="h-11" aria-label="Category"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{cap(c)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="District"><Input value={f.district} onChange={set('district')} className="h-11" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || f.name.trim().length < 2} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="vendor-quick-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add vendor'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VendorPicker({ value, onChange, vendors, exclude, onAdded, testid = 'vendor-picker', placeholder = 'Choose the vendor', disabled }) {
  const { can, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(null);
  const skip = useMemo(() => new Set(exclude || []), [exclude]);
  const list = useMemo(() => (vendors || []).filter((v) => !skip.has(v.id))
    .sort((a, b) => (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0) || (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name)), [vendors, skip]);
  const chosen = (vendors || []).find((v) => v.id === value);
  const exact = (vendors || []).some((v) => v.name.trim().toLowerCase() === q.trim().toLowerCase());
  const canAdd = isAdmin || can('module_vendors', 'create');
  return (
    <>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled || vendors === null}
            className="h-11 w-full justify-between bg-white px-3 text-left font-normal text-slate-900 hover:bg-slate-50 hover:text-slate-900 data-[state=open]:border-emerald-500" data-testid={testid}>
            {chosen
              ? <span className="min-w-0 truncate">{chosen.preferred && <Star className="mr-1 inline h-3.5 w-3.5 fill-amber-400 text-amber-400" />}{chosen.name}</span>
              : <span className="truncate text-slate-500">{vendors === null ? 'Loading vendors…' : list.length ? placeholder : 'No vendors to choose'}</span>}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-slate-400" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search name, category, district, tag" value={q} onValueChange={setQ} data-testid={`${testid}-search`} />
            <CommandList className="max-h-72">
              <CommandEmpty>{canAdd ? 'No vendor by that name.' : 'No vendor by that name. Ask someone who manages Vendors to add it.'}</CommandEmpty>
              <CommandGroup>
                {list.map((v) => (
                  <CommandItem key={v.id} value={`${v.name} ${v.category || ''} ${v.district || ''} ${(v.tags || []).join(' ')} ${v.id}`}
                    onSelect={() => { onChange(v.id, v); setOpen(false); setQ(''); }} data-testid={`${testid}-option`}
                    className="data-[selected=true]:bg-emerald-50 data-[selected=true]:text-slate-900">
                    <Check className={`mr-2 h-4 w-4 shrink-0 ${v.id === value ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{v.preferred && <Star className="mr-1 inline h-3 w-3 fill-amber-400 text-amber-400" />}{v.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">{vendorLine(v) || 'No details yet'}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {canAdd && !exact && (
                <CommandGroup forceMount>
                  <CommandItem forceMount value="__add_new_vendor" onSelect={() => { setOpen(false); setAdding(q.trim()); setQ(''); }} className="text-emerald-700 data-[selected=true]:bg-emerald-50 data-[selected=true]:text-emerald-800" data-testid={`${testid}-add`}>
                    <Plus className="mr-2 h-4 w-4" />Add a new vendor{q.trim() ? ` “${q.trim()}”` : ''}
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <QuickVendorDialog name={adding} onOpenChange={(o) => !o && setAdding(null)} onSaved={(v) => { onAdded?.(v); onChange(v.id, v); }} />
    </>
  );
}
