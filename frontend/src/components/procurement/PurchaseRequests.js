/* Purchase requests: list what's needed → collect quotes from at least 3 vendors → compare → choose one,
 * and the purchase order is made from the chosen quote (it then goes through the normal PO approval). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Award, Check, ClipboardList, Loader2, Pencil, Plus, Settings2, Trash2, TrendingDown, X } from 'lucide-react';
import { inventoryAPI, procurementAPI, uploadAPI, vendorsAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { useLiveRefresh } from '../../lib/liveSync';
import { Chip, Empty, Field, FileAttach, Loading, Stars, Tile, Tiles, addDaysISO, errText, fmtDate, inputCls, inr, inrShort, todayISO } from '../kit/PageBits';

const STATUS = { open: ['Waiting for quotes', 'amber'], quoting: ['Getting quotes', 'blue'], ordered: ['PO made', 'green'], cancelled: ['Cancelled', 'slate'] };
const blankLine = () => ({ name: '', qty: '', unit: 'no', inventory_item_id: null, specs: '' });

function ItemLine({ line, items, onChange, onRemove, index }) {
  const [open, setOpen] = useState(false);
  const q = line.name.trim().toLowerCase();
  const hits = q.length >= 2 ? items.filter((i) => `${i.name} ${i.sku_code}`.toLowerCase().includes(q)).slice(0, 8) : [];
  return (
    <div className="grid grid-cols-[1fr_5.5rem_auto] items-start gap-2" data-testid={`pr-line-${index}`}>
      <div className="relative">
        <Input value={line.name} onChange={(e) => { onChange({ ...line, name: e.target.value, inventory_item_id: null }); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Item — type to pick from stock" className="h-11" data-testid={`pr-line-name-${index}`} />
        {line.inventory_item_id && <span className="absolute right-2 top-1/2 -translate-y-1/2"><Chip tone="green">in stock list</Chip></span>}
        {open && hits.length > 0 && (
          <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {hits.map((i) => <li key={i.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ ...line, name: i.name, inventory_item_id: i.id }); setOpen(false); }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50">{i.name} <span className="text-xs text-slate-400">{i.sku_code} · {i.quantity} in stock</span></button></li>)}
          </ul>
        )}
      </div>
      <Input type="number" inputMode="decimal" min="0" value={line.qty} onChange={(e) => onChange({ ...line, qty: e.target.value })} placeholder="Qty" className="h-11" data-testid={`pr-line-qty-${index}`} />
      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-slate-400" onClick={onRemove} aria-label="Remove line"><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}

function NewRequestDialog({ open, onOpenChange, onCreated }) {
  const [f, setF] = useState({ title: '', needed_by: '', notes: '', lines: [blankLine()] });
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({ title: '', needed_by: addDaysISO(todayISO(), 7), notes: '', lines: [blankLine()] });
    if (!items.length) inventoryAPI.getItems().then((r) => setItems(r.data || [])).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = f.lines.filter((l) => l.name.trim() && Number(l.qty) > 0);
  const save = async () => {
    setSaving(true);
    try {
      const r = await procurementAPI.create({ ...f, needed_by: f.needed_by || null, lines: lines.map((l) => ({ ...l, qty: Number(l.qty) })) });
      toast.success(`${r.data.number} made — now add the vendors' quotes`); onCreated(r.data); onOpenChange(false);
    } catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto" data-testid="pr-new-dialog">
        <DialogHeader><DialogTitle>New purchase request</DialogTitle><DialogDescription>What do you need? Then ask at least 3 vendors for a price.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {f.lines.map((l, i) => <ItemLine key={i} index={i} line={l} items={items} onChange={(nl) => setF((x) => ({ ...x, lines: x.lines.map((y, j) => (j === i ? nl : y)) }))}
            onRemove={() => setF((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((_, j) => j !== i) : [blankLine()] }))} />)}
          <Button type="button" variant="outline" size="sm" className="gap-1 border-dashed" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, blankLine()] }))} data-testid="pr-add-line"><Plus className="h-4 w-4" />Add item</Button>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Field label="Needed by"><input type="date" value={f.needed_by} min={todayISO()} onChange={(e) => setF((x) => ({ ...x, needed_by: e.target.value }))} className={inputCls} data-testid="pr-needed-by" /></Field>
            <Field label="Title (optional)"><Input value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} placeholder="e.g. Panels for Kongu Mill" className="h-11" /></Field>
            <Field label="Notes for vendors" className="col-span-2"><textarea rows={2} value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} placeholder="Brand, specs, delivery site…" className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" /></Field>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !lines.length} className="bg-emerald-600 text-white" data-testid="pr-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save request'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuoteDialog({ pr, quote, open, onOpenChange, onSaved }) {
  const [vendors, setVendors] = useState([]);
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !pr) return;
    vendorsAPI.list({ status: 'active', flag: 'not_blocked' }).then((r) => setVendors(r.data || [])).catch(() => setVendors([]));
    setF(quote ? { ...quote, lines: quote.lines.map((l) => ({ unit_price: l.unit_price ?? '', gst_pct: l.gst_pct ?? 18 })), freight: quote.freight || '', delivery_days: quote.delivery_days ?? '' }
      : { vendor_id: '', lines: pr.lines.map(() => ({ unit_price: '', gst_pct: 18 })), freight: '', delivery_days: '', payment_terms: '', valid_until: addDaysISO(todayISO(), 15), reference: '', notes: '', attachment: null });
  }, [open, pr, quote]);
  if (!f) return null;
  const taken = new Set((pr?.quotes || []).filter((q) => q.id !== quote?.id).map((q) => q.vendor_id));
  const choices = vendors.filter((v) => !taken.has(v.id));
  const setLine = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const total = pr.lines.reduce((s, ln, i) => s + (Number(ln.qty) || 0) * (Number(f.lines[i]?.unit_price) || 0) * (1 + (Number(f.lines[i]?.gst_pct) || 0) / 100), 0) + (Number(f.freight) || 0);
  const save = async () => {
    setSaving(true);
    const body = { ...f, lines: f.lines.map((l) => ({ unit_price: l.unit_price === '' ? null : Number(l.unit_price), gst_pct: Number(l.gst_pct) || 0 })),
      freight: Number(f.freight) || 0, delivery_days: f.delivery_days === '' ? null : Number(f.delivery_days), valid_until: f.valid_until || null };
    try {
      const r = quote ? await procurementAPI.editQuote(pr.id, quote.id, body) : await procurementAPI.addQuote(pr.id, body);
      toast.success('Quote saved'); onSaved(r.data); onOpenChange(false);
    } catch (e) { toast.error(errText(e, 'Could not save the quote')); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto" data-testid="pr-quote-dialog">
        <DialogHeader><DialogTitle>{quote ? `Edit quote — ${quote.vendor_name}` : 'Add a vendor quote'}</DialogTitle><DialogDescription>Prices before GST. Leave a price blank if they can't supply that item.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Vendor *">
            <Select value={f.vendor_id || ''} onValueChange={(v) => { const vv = vendors.find((x) => x.id === v); setF((x) => ({ ...x, vendor_id: v, payment_terms: x.payment_terms || vv?.payment_terms || '', delivery_days: x.delivery_days !== '' ? x.delivery_days : (vv?.lead_time_days ?? '') })); }}>
              <SelectTrigger className="h-11" data-testid="pr-quote-vendor"><SelectValue placeholder={choices.length ? 'Choose the vendor' : 'Every active vendor has quoted'} /></SelectTrigger>
              <SelectContent className="max-h-72">{choices.map((v) => <SelectItem key={v.id} value={v.id}>{v.preferred ? '★ ' : ''}{v.name}{v.rating ? ` · ${v.rating}★` : ''}{v.district ? ` · ${v.district}` : ''}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="space-y-2">
            {pr.lines.map((ln, i) => (
              <div key={i} className="grid grid-cols-[1fr_6.5rem_4.5rem] items-end gap-2">
                <div className="min-w-0 pb-2 text-sm"><p className="truncate font-medium text-slate-800">{ln.name}</p><p className="text-[11px] text-slate-500">{ln.qty} {ln.unit || 'no'}{pr.last_paid?.[i] ? ` · last paid ${inr(pr.last_paid[i].price)}` : ''}</p></div>
                <Field label="Price / unit"><Input type="number" inputMode="decimal" min="0" value={f.lines[i]?.unit_price ?? ''} onChange={(e) => setLine(i, 'unit_price', e.target.value)} className="h-11" data-testid={`pr-quote-price-${i}`} /></Field>
                <Field label="GST %"><Input type="number" inputMode="decimal" min="0" max="28" value={f.lines[i]?.gst_pct ?? 18} onChange={(e) => setLine(i, 'gst_pct', e.target.value)} className="h-11" /></Field>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Freight / transport (₹)"><Input type="number" inputMode="decimal" min="0" value={f.freight} onChange={(e) => setF((x) => ({ ...x, freight: e.target.value }))} className="h-11" data-testid="pr-quote-freight" /></Field>
            <Field label="Delivery in (days)"><Input type="number" inputMode="numeric" min="0" value={f.delivery_days} onChange={(e) => setF((x) => ({ ...x, delivery_days: e.target.value }))} className="h-11" data-testid="pr-quote-days" /></Field>
            <Field label="Payment terms"><Input value={f.payment_terms || ''} onChange={(e) => setF((x) => ({ ...x, payment_terms: e.target.value }))} className="h-11" /></Field>
            <Field label="Valid until"><input type="date" value={f.valid_until || ''} onChange={(e) => setF((x) => ({ ...x, valid_until: e.target.value }))} className={inputCls} /></Field>
            <Field label="Their quote no."><Input value={f.reference || ''} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} className="h-11" /></Field>
            <div className="flex items-end pb-1"><FileAttach value={f.attachment} onChange={(p) => setF((x) => ({ ...x, attachment: p }))} label="Attach their quote" testid="pr-quote-file" accept="application/pdf,image/png,image/jpeg,image/webp" /></div>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">Landed cost with GST and freight: <b className="tabular-nums">{inr(total)}</b></p>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !f.vendor_id} className="bg-emerald-600 text-white" data-testid="pr-quote-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save quote'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChooseDialog({ pr, row, onOpenChange, onDone }) {
  const { isAdmin } = useAuth();
  const [reason, setReason] = useState('');
  const [exp, setExp] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); setExp(row?.delivery_days != null ? addDaysISO(todayISO(), row.delivery_days) : ''); }, [row]);
  if (!pr || !row) return null;
  const c = pr.comparison;
  const cheapest = c.cheapest_id === row.id;
  const short = pr.quote_count < pr.min_quotes;
  const needReason = !cheapest || short;
  const vsAvg = (c.average_total || 0) - row.landed_total;
  const go = async () => {
    setBusy(true);
    try {
      const r = await procurementAPI.select(pr.id, { quote_id: row.id, reason: reason.trim() || null, expected_delivery: exp || null });
      toast.success(`Purchase order ${r.data.po_number} made — waiting for approval`); onDone(r.data); onOpenChange(false);
    } catch (e) { toast.error(errText(e, 'Could not choose this quote')); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="pr-choose-dialog">
        <DialogHeader><DialogTitle>Buy from {row.vendor_name}?</DialogTitle><DialogDescription>A purchase order is made from this quote and sent for approval.</DialogDescription></DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Landed cost" value={inr(row.landed_total)} sub={`${row.delivery_days ?? '—'} days delivery`} />
            <Tile label="vs average quote" value={vsAvg >= 0 ? `${inr(vsAvg)} less` : `${inr(-vsAvg)} more`} tone={vsAvg >= 0 ? 'good' : 'warn'} sub={`highest ${inr(c.highest_total)}`} />
          </div>
          {short && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Only {pr.quote_count} quote{pr.quote_count === 1 ? '' : 's'} — the rule is {pr.min_quotes}. {isAdmin ? 'As an admin you can go ahead with a reason.' : 'Get more quotes first.'}</p>}
          {!cheapest && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">This isn't the cheapest quote. Say why you chose it.</p>}
          {needReason && <Field label="Why this vendor? *"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Faster delivery, better quality, longer credit…" className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-emerald-400" data-testid="pr-choose-reason" /></Field>}
          <Field label="Expected delivery"><input type="date" value={exp} onChange={(e) => setExp(e.target.value)} className={inputCls} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={go} disabled={busy || (needReason && reason.trim().length < 5) || (short && !isAdmin)} className="bg-emerald-600 text-white" data-testid="pr-choose-confirm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Make the PO'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestSheet({ prId, onOpenChange, onChanged, canEdit, canChoose }) {
  const [pr, setPr] = useState(null);
  const [quoteDlg, setQuoteDlg] = useState(null);
  const [choose, setChoose] = useState(null);
  const load = useCallback(() => { if (prId) procurementAPI.get(prId).then((r) => setPr(r.data)).catch(() => toast.error('Could not load the request')); }, [prId]);
  useEffect(() => { setPr(null); load(); }, [load]);
  useLiveRefresh(['purchases'], load);
  const changed = (data) => { if (data?.id) setPr(data); else load(); onChanged?.(); };
  const removeQuote = async (q) => { if (!window.confirm(`Remove ${q.vendor_name}'s quote?`)) return; try { changed((await procurementAPI.removeQuote(pr.id, q.id)).data); } catch (e) { toast.error(errText(e)); } };
  const cancel = async () => { const r = window.prompt('Why cancel this request?'); if (r === null) return; try { await procurementAPI.cancel(pr.id, r); changed(); load(); } catch (e) { toast.error(errText(e)); } };
  const open = pr && ['open', 'quoting'].includes(pr.status);
  const c = pr?.comparison;
  const rowsById = useMemo(() => Object.fromEntries((c?.rows || []).map((r) => [r.id, r])), [c]);
  return (
    <Sheet open={!!prId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl" data-testid="pr-sheet">
        {!pr ? <Loading /> : (
          <div className="space-y-4">
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="flex flex-wrap items-center gap-2">{pr.number} · {pr.title}<Chip tone={STATUS[pr.status][1]}>{STATUS[pr.status][0]}</Chip></SheetTitle>
              <SheetDescription>{pr.needed_by ? `Needed by ${fmtDate(pr.needed_by)} · ` : ''}asked by {pr.created_by_name} on {fmtDate(pr.created_at)}{pr.notes ? ` · ${pr.notes}` : ''}</SheetDescription>
            </SheetHeader>
            {pr.status === 'ordered' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="pr-ordered">
                <p><b>{pr.selected_vendor}</b> chosen by {pr.selected_by} · PO <Link to="/dashboard/purchase-inbound?tab=orders" className="font-semibold underline">{pr.po_number}</Link></p>
                {pr.savings && <p className="mt-0.5">{pr.savings.vs_average > 0 ? `${inr(pr.savings.vs_average)} below the average quote` : 'At or above the average quote'} · {pr.savings.was_cheapest ? 'the cheapest quote' : `not the cheapest — ${pr.selection_reason}`}</p>}
              </div>
            )}
            {pr.status === 'cancelled' && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">Cancelled{pr.cancel_reason ? `: ${pr.cancel_reason}` : ''}</p>}
            {open && (
              <div className="rounded-xl border border-slate-200 p-3" data-testid="pr-progress">
                <div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-800">{pr.quote_count} of {pr.min_quotes} quotes</span>{pr.quotes_short > 0 ? <span className="text-amber-700">{pr.quotes_short} more needed</span> : <span className="text-emerald-700">Ready to choose</span>}</div>
                <div className="mt-1.5 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (pr.quote_count / pr.min_quotes) * 100)}%` }} /></div>
              </div>
            )}
            {pr.quotes.length > 0 && (
              <ul className="space-y-2 sm:hidden" data-testid="pr-compare-cards">
                {[...pr.quotes].sort((a, b) => (rowsById[a.id]?.complete === rowsById[b.id]?.complete ? (rowsById[a.id]?.landed_total || 0) - (rowsById[b.id]?.landed_total || 0) : rowsById[a.id]?.complete ? -1 : 1)).map((q) => {
                  const r = rowsById[q.id] || {};
                  return (
                    <li key={q.id} className={`rounded-xl border bg-white p-3 ${c.cheapest_id === q.id ? 'border-emerald-300' : 'border-slate-200'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><p className="font-medium text-slate-900">{q.vendor_name}</p><Stars value={r.rating} />{r.on_time_pct != null && <span className="ml-1 text-[11px] text-slate-500">{r.on_time_pct}% on time</span>}</div>
                        <div className="text-right"><p className="font-['Outfit'] text-lg font-bold tabular-nums">{r.complete ? inr(r.landed_total) : <span className="text-sm text-amber-700">incomplete</span>}</p><p className="text-[11px] text-slate-500">with GST & freight</p></div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">{c.cheapest_id === q.id && <Chip tone="green"><TrendingDown className="h-3 w-3" />Cheapest</Chip>}{c.recommended_id === q.id && c.recommended_id !== c.cheapest_id && <Chip tone="blue"><Award className="h-3 w-3" />Best value</Chip>}{r.low_rating && <Chip tone="amber">low rating</Chip>}</div>
                      <ul className="mt-2 space-y-0.5 text-xs">{pr.lines.map((ln, i) => { const p = q.lines[i]?.unit_price; const best = c.line_best[i]?.best_quote_id === q.id; return (
                        <li key={i} className="flex justify-between gap-2"><span className="min-w-0 truncate text-slate-600">{ln.name} × {ln.qty}</span><span className={`shrink-0 tabular-nums ${best ? 'font-semibold text-emerald-800' : 'text-slate-800'}`}>{p ? `${inr(p)}${best ? ' · lowest' : ''}` : "can't supply"}</span></li>); })}</ul>
                      <p className="mt-1 text-[11px] text-slate-500">{q.delivery_days != null ? `${q.delivery_days} days delivery` : 'delivery not given'}{q.freight ? ` · freight ${inr(q.freight)}` : ''}{q.payment_terms ? ` · ${q.payment_terms}` : ''}{q.attachment ? ' · ' : ''}{q.attachment && <a href={uploadAPI.getFileUrl(q.attachment)} target="_blank" rel="noreferrer" className="text-emerald-700 underline">their quote</a>}</p>
                      {open && canEdit && <div className="mt-2 flex items-center gap-2">
                        {canChoose && <Button size="sm" className="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!r.complete} onClick={() => setChoose(r)} data-testid={`pr-choose-m-${q.id}`}><Check className="h-4 w-4" />Choose</Button>}
                        <Button size="sm" variant="ghost" className="h-9 gap-1 text-xs" onClick={() => setQuoteDlg({ quote: q })}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                        <Button size="sm" variant="ghost" className="h-9 text-xs text-slate-400" onClick={() => removeQuote(q)}><X className="h-3.5 w-3.5" />Remove</Button>
                      </div>}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className={`overflow-x-auto rounded-xl border border-slate-200 ${pr.quotes.length ? 'hidden sm:block' : ''}`} data-testid="pr-compare">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr><th className="sticky left-0 bg-slate-50 p-2 text-left font-medium">Item</th>
                    {pr.quotes.map((q) => { const r = rowsById[q.id] || {}; return (
                      <th key={q.id} className="min-w-[9.5rem] p-2 text-right align-top font-medium">
                        <span className="block text-sm text-slate-900">{q.vendor_name}</span>
                        <span className="flex justify-end"><Stars value={r.rating} /></span>
                        {r.on_time_pct != null && <span className="block text-[11px]">{r.on_time_pct}% on time</span>}
                      </th>); })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pr.lines.map((ln, i) => (
                    <tr key={i}>
                      <td className="sticky left-0 bg-white p-2"><span className="block font-medium text-slate-800">{ln.name}</span><span className="text-[11px] text-slate-500">{ln.qty} {ln.unit || 'no'}{pr.last_paid?.[i] ? ` · last ${inr(pr.last_paid[i].price)} (${pr.last_paid[i].vendor})` : ''}</span></td>
                      {pr.quotes.map((q) => { const p = q.lines[i]?.unit_price; const best = c.line_best[i]?.best_quote_id === q.id; return (
                        <td key={q.id} className={`p-2 text-right tabular-nums ${best ? 'bg-emerald-50 font-semibold text-emerald-900' : ''}`}>{p ? inr(p) : <span className="text-slate-400">can't supply</span>}{best && <span className="block text-[10px] font-medium">lowest</span>}</td>); })}
                    </tr>
                  ))}
                  {[['Before GST', 'subtotal'], ['GST', 'gst'], ['Freight', 'freight']].map(([l, k]) => (
                    <tr key={k} className="text-slate-600"><td className="sticky left-0 bg-white p-2">{l}</td>{pr.quotes.map((q) => <td key={q.id} className="p-2 text-right tabular-nums">{inr(rowsById[q.id]?.[k])}</td>)}</tr>))}
                  <tr className="bg-slate-50 font-semibold"><td className="sticky left-0 bg-slate-50 p-2">Landed total</td>
                    {pr.quotes.map((q) => { const r = rowsById[q.id] || {}; return (
                      <td key={q.id} className="p-2 text-right tabular-nums" data-testid={`pr-total-${q.id}`}>{r.complete ? inr(r.landed_total) : <span className="text-amber-700">incomplete</span>}
                        <span className="mt-0.5 flex flex-wrap justify-end gap-1">{c.cheapest_id === q.id && <Chip tone="green"><TrendingDown className="h-3 w-3" />Cheapest</Chip>}{c.recommended_id === q.id && c.recommended_id !== c.cheapest_id && <Chip tone="blue"><Award className="h-3 w-3" />Best value</Chip>}{r.low_rating && <Chip tone="amber">low rating</Chip>}</span></td>); })}
                  </tr>
                  <tr className="text-slate-600"><td className="sticky left-0 bg-white p-2">Delivery · terms</td>{pr.quotes.map((q) => <td key={q.id} className="p-2 text-right text-xs">{q.delivery_days != null ? `${q.delivery_days} days` : '—'}{q.payment_terms ? ` · ${q.payment_terms}` : ''}{q.valid_until ? <span className="block text-slate-400">valid to {fmtDate(q.valid_until)}</span> : null}{q.attachment && <a href={uploadAPI.getFileUrl(q.attachment)} target="_blank" rel="noreferrer" className="block text-emerald-700 underline">their quote</a>}</td>)}</tr>
                  {open && canEdit && (
                    <tr><td className="sticky left-0 bg-white p-2" />{pr.quotes.map((q) => (
                      <td key={q.id} className="p-2 text-right">
                        <div className="flex flex-col items-end gap-1">
                          {canChoose && <Button size="sm" className="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" disabled={!rowsById[q.id]?.complete} onClick={() => setChoose(rowsById[q.id])} data-testid={`pr-choose-${q.id}`}><Check className="h-4 w-4" />Choose</Button>}
                          <span className="flex gap-1"><button type="button" onClick={() => setQuoteDlg({ quote: q })} className="text-xs text-slate-500 hover:text-slate-800" aria-label={`Edit ${q.vendor_name}'s quote`}><Pencil className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => removeQuote(q)} className="text-xs text-slate-400 hover:text-rose-600" aria-label={`Remove ${q.vendor_name}'s quote`}><X className="h-3.5 w-3.5" /></button></span>
                        </div>
                      </td>))}</tr>
                  )}
                </tbody>
              </table>
              {pr.quotes.length === 0 && <p className="p-4 text-center text-sm text-slate-500">No quotes yet — call or message at least {pr.min_quotes} vendors and add their prices.</p>}
            </div>
            {open && canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setQuoteDlg({})} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pr-add-quote"><Plus className="h-4 w-4" />Add a quote</Button>
                <Button variant="ghost" className="text-slate-500" onClick={cancel} data-testid="pr-cancel">Cancel request</Button>
              </div>
            )}
          </div>
        )}
        <QuoteDialog pr={pr} quote={quoteDlg?.quote} open={!!quoteDlg} onOpenChange={(o) => !o && setQuoteDlg(null)} onSaved={changed} />
        <ChooseDialog pr={pr} row={choose} onOpenChange={(o) => !o && setChoose(null)} onDone={() => { load(); onChanged?.(); }} />
      </SheetContent>
    </Sheet>
  );
}

function SettingsDialog({ open, onOpenChange }) {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) procurementAPI.settings().then((r) => setS(r.data)).catch(() => {}); }, [open]);
  const save = async () => {
    setSaving(true);
    try { await procurementAPI.saveSettings({ ...s, min_quotes: Number(s.min_quotes), skip_below_amount: Number(s.skip_below_amount) || 0, low_rating: Number(s.low_rating) || 0 }); toast.success('Purchase rules saved'); onOpenChange(false); }
    catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="pr-settings">
        <DialogHeader><DialogTitle>Purchase rules</DialogTitle><DialogDescription>Admins only.</DialogDescription></DialogHeader>
        {s && <div className="space-y-2">
          <Field label="Quotes needed before choosing"><Select value={String(s.min_quotes)} onValueChange={(v) => setS({ ...s, min_quotes: v })}><SelectTrigger className="h-11" data-testid="pr-set-min"><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent></Select></Field>
          <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span>Every PO needs quotes<span className="block text-[11px] text-slate-500">Off: anyone may raise a PO directly</span></span><Switch checked={!!s.require_quotes} onCheckedChange={(v) => setS({ ...s, require_quotes: v })} /></label>
          <Field label="Except POs below (₹)" hint="0 = every PO"><Input type="number" inputMode="decimal" min="0" value={s.skip_below_amount} onChange={(e) => setS({ ...s, skip_below_amount: e.target.value })} className="h-11" /></Field>
          <Field label="Flag vendors rated below (★)"><Input type="number" inputMode="decimal" min="0" max="5" step="0.5" value={s.low_rating} onChange={(e) => setS({ ...s, low_rating: e.target.value })} className="h-11" /></Field>
        </div>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={saving || !s} className="bg-emerald-600 text-white">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PurchaseRequests({ openId, onOpen }) {
  const { isAdmin, isManager, can } = useAuth();
  const canCreate = isAdmin || can('module_purchase_inbound', 'create');
  const canEdit = isAdmin || isManager || can('module_purchase_inbound', 'edit');
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState(null);
  const [sv, setSv] = useState(null);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const load = useCallback(() => {
    procurementAPI.list({ status }).then((r) => setRows(r.data)).catch(() => setRows([]));
    procurementAPI.savings().then((r) => setSv(r.data)).catch(() => {});
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(['purchases'], load);
  return (
    <div className="space-y-3" data-testid="purchase-requests">
      {sv && sv.orders > 0 && (
        <Tiles>
          <Tile label="Saved vs average quote" value={inrShort(sv.saved_vs_average)} sub="last 12 months" tone="good" testid="pr-kpi-saved" />
          <Tile label="Saved vs highest quote" value={inrShort(sv.saved_vs_highest)} sub={`${sv.orders} purchases compared`} />
          <Tile label="Bought from the cheapest" value={sv.cheapest_pct != null ? `${sv.cheapest_pct}%` : '—'} sub="others had a reason on record" />
          <Tile label="Quotes per purchase" value={sv.avg_quotes ?? '—'} sub="on average" />
        </Tiles>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-48"><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-10 bg-white" aria-label="Show" data-testid="pr-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="ordered">PO made</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem><SelectItem value="all">All</SelectItem></SelectContent></Select></div>
        <div className="ml-auto flex gap-2">
          {isAdmin && <Button variant="outline" className="h-10 gap-1.5" onClick={() => setSettings(true)} data-testid="pr-settings-btn"><Settings2 className="h-4 w-4" /><span className="hidden sm:inline">Rules</span></Button>}
          {canCreate && <Button onClick={() => setCreating(true)} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="pr-new"><Plus className="h-4 w-4" />New purchase request</Button>}
        </div>
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon={ClipboardList} title={status === 'open' ? 'No open purchase requests' : 'Nothing here'} text="Start with what you need; then add quotes from at least three vendors and choose one." /> : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-emerald-300" data-testid={`pr-row-${r.id}`}>
              <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{r.number} · {r.title}</p><Chip tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Chip></div>
              <p className="mt-0.5 text-xs text-slate-500">{r.lines.length} item{r.lines.length === 1 ? '' : 's'}{r.needed_by ? ` · needed by ${fmtDate(r.needed_by)}` : ''} · {r.created_by_name}</p>
              <div className="mt-2 flex items-center gap-2 text-xs">
                {['open', 'quoting'].includes(r.status) ? <>
                  <div className="h-1.5 w-24 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (r.quote_count / r.min_quotes) * 100)}%` }} /></div>
                  <span className={r.quotes_short ? 'text-amber-700' : 'text-emerald-700'}>{r.quote_count}/{r.min_quotes} quotes</span>
                  {r.lowest_total && <span className="ml-auto text-slate-600">lowest {inr(r.lowest_total)}</span>}
                </> : r.status === 'ordered' ? <span className="text-emerald-800">{r.selected_vendor} · {r.po_number}{r.savings?.vs_average > 0 ? ` · saved ${inr(r.savings.vs_average)}` : ''}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}
      <NewRequestDialog open={creating} onOpenChange={setCreating} onCreated={(pr) => { load(); onOpen(pr.id); }} />
      <RequestSheet prId={openId} onOpenChange={(o) => !o && onOpen(null)} onChanged={load} canEdit={canEdit} canChoose={isAdmin || can('can_select_quote')} />
      {isAdmin && <SettingsDialog open={settings} onOpenChange={setSettings} />}
    </div>
  );
}
