/* One material quotation: customer, items picked from stock (type, ↑↓, Enter), live GST totals, PDF and WhatsApp,
 * and the sale once the customer says yes. New: /dashboard/quotations/new (?lead=… fills the customer). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, Plus, Search, Trash2, Loader2, Download, MessageCircle, Copy, Receipt, Check, X, Send, Package, AlertTriangle, Save, Contact,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { Chip, Field, inputCls, errText, inr, fmtDate, Loading } from '../components/kit/PageBits';
import { confirmAction } from '../components/kit/confirm';
import { quotesAPI, crmAPI, companyAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useHotkeys, MOD } from '../lib/hotkeys';
import { INDIA_STATES, isInterState } from '../lib/indiaStates';
import { materialQuotePDF } from '../utils/materialQuotePDF';
import { waLink, firstName, leadsChanged } from '../components/crm/leadBits';
import { QUOTE_TONE } from './QuotationsPage';
import { num, r2, priceIt } from '../utils/quoteMath';

const money = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const blankCustomer = { name: '', phone: '', email: '', company: '', address: '', state: 'Tamil Nadu', gstin: '' };
function usePhone() {   // lines show as cards on a phone, as a table from 640 px up
  const q = '(max-width: 639px)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return undefined;
    const h = () => setOn(m.matches);
    m.addEventListener?.('change', h);
    return () => m.removeEventListener?.('change', h);
  }, []);
  return !!on;
}
const cellCls = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm tabular-nums outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25';

function ItemPicker({ onPick, sees, inputRef }) {
  // The whole active list is loaded once and filtered on every key, so Enter always takes what's on screen.
  const [q, setQ] = useState('');
  const [all, setAll] = useState(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open || all) return;
    quotesAPI.items({ limit: 3000 }).then((r) => setAll(r.data.items || [])).catch(() => setAll([]));
  }, [open, all]);
  const rows = useMemo(() => {
    if (!all) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = all.filter((it) => { const hay = `${it.name} ${it.sku_code} ${it.hsn_code} ${it.brand} ${it.category}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
    if (words[0]) hits.sort((a, b) => Number(!a.name.toLowerCase().startsWith(words[0])) - Number(!b.name.toLowerCase().startsWith(words[0])));
    return hits.slice(0, 30);
  }, [all, q]);
  const loading = open && !all;
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pick = (it) => { onPick(it); setQ(''); setOpen(false); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[hi]) pick(rows[hi]); }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false); } else inputRef.current?.blur(); }
  };
  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
        placeholder="Add an item — type a name, SKU or HSN" className={`${inputCls} pl-9 pr-16`} role="combobox" aria-expanded={open} aria-controls="item-picker-list"
        aria-autocomplete="list" data-testid="item-picker" />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] text-slate-500 sm:block">A</kbd>
      {open && (
        <ul id="item-picker-list" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {loading && rows.length === 0 && <li className="px-3 py-3 text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin" /> Looking…</li>}
          {!loading && rows.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No stock item matches “{q}”. Use “Add a line” for anything else.</li>}
          {rows.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === hi}>
              <button type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(it)}
                className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left ${i === hi ? 'bg-emerald-50' : ''}`} data-testid={`pick-${it.id}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{it.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{[it.brand, it.sku_code, it.hsn_code && `HSN ${it.hsn_code}`].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm tabular-nums text-slate-900">{it.selling_price != null ? money(it.selling_price) : <span className="text-amber-700">No price set</span>}</span>
                  <span className={`block text-[11px] ${Number(it.stock) > 0 ? 'text-slate-500' : 'text-rose-600'}`}>{Number(it.stock) > 0 ? `${it.stock} in stock` : 'Out of stock'}{it.gst_percentage != null ? ` · ${it.gst_percentage}% GST` : ''}{sees && it.cost_price != null ? ` · cost ${money(it.cost_price)}` : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function QuotationEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [params] = useSearchParams();
  const leadParam = isNew ? params.get('lead') : null;
  const navigate = useNavigate();
  const { can } = useAuth();
  const [defaults, setDefaults] = useState(null);
  const [quote, setQuote] = useState(null);         // as saved on the server
  const [customer, setCustomer] = useState(blankCustomer);
  const [lines, setLines] = useState([]);
  const [billDisc, setBillDisc] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [internal, setInternal] = useState('');
  const [termsText, setTermsText] = useState('');
  const [leadId, setLeadId] = useState(leadParam);
  const [lead, setLead] = useState(null);
  const [profile, setProfile] = useState(null);
  const [dirty, setDirty] = useState(isNew);
  const [busy, setBusy] = useState('');
  const pickerRef = useRef(null);
  const isPhone = usePhone();
  const qtyRefs = useRef({});
  const focusQty = useRef(null);

  const fill = useCallback((q) => {
    setQuote(q);
    setCustomer({ ...blankCustomer, ...(q.customer || {}) });
    setLines((q.lines || []).map((l, i) => ({ ...l, key: `${i}-${l.inventory_item_id || l.name}` })));
    setBillDisc(q.discount_amount ? String(q.discount_amount) : '');
    setValidUntil(q.valid_until || '');
    setSubject(q.subject || ''); setNotes(q.notes || ''); setInternal(q.internal_note || '');
    setTermsText((q.terms || []).join('\n'));
    setLeadId(q.lead_id || null);
    setDirty(false);
  }, []);

  useEffect(() => {
    quotesAPI.defaults().then((r) => {
      setDefaults(r.data);
      if (isNew) { setValidUntil(r.data.valid_until); setTermsText((r.data.terms || []).join('\n')); }
    }).catch(() => {});
    companyAPI.getActive().then((r) => setProfile(r.data)).catch(() => {});
  }, [isNew]);
  useEffect(() => {
    if (isNew) return;
    quotesAPI.get(id).then((r) => fill(r.data)).catch((e) => { toast.error(errText(e, 'Couldn’t open that quotation')); navigate('/dashboard/quotations'); });
  }, [id, isNew, fill, navigate]);
  useEffect(() => {
    if (!leadId) { setLead(null); return; }
    crmAPI.get(leadId).then((r) => {
      setLead(r.data);
      if (isNew) setCustomer((c) => ({ ...c, name: c.name || r.data.name, phone: c.phone || r.data.phone, email: c.email || r.data.email, company: c.company || r.data.company,
        address: c.address || [r.data.area, r.data.city, r.data.pincode].filter(Boolean).join(', ') }));
    }).catch(() => setLead(null));
  }, [leadId, isNew]);
  useEffect(() => {   // start in the customer's name — unless the person already went somewhere (e.g. pressed A for the item box)
    if (!isNew) return undefined;
    const t = setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) document.querySelector('[data-testid="q-customer-name"]')?.focus(); }, 80);
    return () => clearTimeout(t);
  }, [isNew]);
  useEffect(() => {   // after adding an item, put the cursor in its quantity
    if (focusQty.current && qtyRefs.current[focusQty.current]) { qtyRefs.current[focusQty.current].focus(); qtyRefs.current[focusQty.current].select(); focusQty.current = null; }
  }, [lines]);

  const locked = quote?.status === 'converted';
  const lineWarnings = (l) => ({
    short: !!(l.inventory_item_id && l.stock != null && num(l.quantity) > num(l.stock)),
    low: !!(defaults?.sees_cost && l.cost_price && num(l.unit_price) * (1 - num(l.discount_pct) / 100) < num(l.cost_price)),
  });
  const sees = !!defaults?.sees_cost;
  const inter = isInterState(defaults?.company_state || 'Tamil Nadu', profile?.gst_number, customer.state, customer.gstin);
  const t = useMemo(() => priceIt(lines, billDisc, inter), [lines, billDisc, inter]);
  const changed = (fn) => (...a) => { fn(...a); setDirty(true); };
  const setC = (k) => changed((e) => setCustomer((c) => ({ ...c, [k]: e.target.value })));
  const updLine = changed((i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l))));
  const rmLine = changed((i) => setLines((ls) => ls.filter((_, j) => j !== i)));
  const addItem = changed((it) => {
    const key = `${Date.now()}-${it.id}`;
    const existing = lines.findIndex((l) => l.inventory_item_id === it.id);
    if (existing >= 0) {
      setLines((ls) => ls.map((l, j) => (j === existing ? { ...l, quantity: num(l.quantity) + 1 } : l)));
      focusQty.current = lines[existing].key;
      toast.message(`${it.name}: quantity +1`);
      return;
    }
    if (it.selling_price == null) toast.warning(`${it.name} has no selling price in the Price list — type the rate.`);
    focusQty.current = key;
    setLines((ls) => [...ls, { key, inventory_item_id: it.id, name: it.name, sku_code: it.sku_code, hsn_code: it.hsn_code, description: '', quantity: 1, unit: it.unit || 'Nos',
      unit_price: it.selling_price ?? 0, discount_pct: 0, gst_percentage: it.gst_percentage ?? 18, stock: it.stock, cost_price: it.cost_price }]);
  });
  const addCustom = changed(() => {
    const key = `${Date.now()}-custom`;
    setLines((ls) => [...ls, { key, inventory_item_id: null, name: '', hsn_code: '', description: '', quantity: 1, unit: 'Job', unit_price: 0, discount_pct: 0, gst_percentage: 18 }]);
    setTimeout(() => document.querySelector(`[data-line-name="${key}"]`)?.focus(), 30);
  });

  const payload = () => ({
    customer, lead_id: leadId || null, discount_amount: num(billDisc), valid_until: validUntil, subject, notes, internal_note: internal,
    terms: termsText.split('\n').map((x) => x.trim()).filter(Boolean),
    lines: lines.map((l) => ({ inventory_item_id: l.inventory_item_id || null, name: l.name, description: l.description || '', sku_code: l.sku_code || '', hsn_code: l.hsn_code || '',
      quantity: num(l.quantity), unit: l.unit || 'Nos', unit_price: num(l.unit_price), discount_pct: num(l.discount_pct), gst_percentage: num(l.gst_percentage, 18) })),
  });
  const save = async ({ quiet = false } = {}) => {
    if (locked) return quote;
    if (!customer.name.trim()) { toast.error('Enter the customer’s name'); document.querySelector('[data-testid="q-customer-name"]')?.focus(); return null; }
    if (!lines.length) { toast.error('Add at least one item'); pickerRef.current?.focus(); return null; }
    const bad = lines.find((l) => !String(l.name || '').trim() || !(num(l.quantity) > 0) || num(l.unit_price) < 0);
    if (bad) { toast.error(`Check “${bad.name || 'the new line'}”: it needs a name, a quantity above 0 and a rate`); return null; }
    setBusy('save');
    try {
      const r = isNew ? await quotesAPI.create(payload()) : await quotesAPI.update(id, payload());
      if (!quiet) toast.success(isNew ? `Quotation ${r.data.number} saved` : (r.data.revision > (quote?.revision || 0) ? `Saved as revision R${r.data.revision}` : 'Saved'));
      if (leadId) leadsChanged();
      if (isNew) { navigate(`/dashboard/quotations/${r.data.id}`, { replace: true }); return r.data; }
      fill(r.data);
      return r.data;
    } catch (e) { toast.error(errText(e, 'Couldn’t save the quotation')); return null; } finally { setBusy(''); }
  };
  const ensureSaved = async () => (dirty || isNew ? save({ quiet: true }) : quote);

  const pdf = async (opts) => {
    const q = await ensureSaved();
    if (!q) return null;
    setBusy('pdf');
    try { return await materialQuotePDF(q, profile, opts); } catch { toast.error('Couldn’t make the PDF'); return null; } finally { setBusy(''); }
  };
  const setStatus = async (status, reason = '', known = null) => {
    const q = known || await ensureSaved();
    if (!q) return;
    try { const r = await quotesAPI.setStatus(q.id, status, reason); fill(r.data); if (q.lead_id) leadsChanged(); toast.success({ sent: 'Marked sent', accepted: 'Marked accepted — make the sale when they pay', rejected: 'Marked not accepted', draft: 'Back to draft' }[status]); }
    catch (e) { toast.error(errText(e)); }
  };
  const whatsapp = async () => {
    const q = await ensureSaved();
    if (!q) return;
    const msg = `Hi ${firstName(q.customer?.name)}, here is our quotation ${q.display_number} for ${inr(q.grand_total)} (incl. GST), valid till ${fmtDate(q.valid_until)}. — ${profile?.company_name || 'Sensoper'}`;
    const made = await pdf({ save: false });
    if (!made) return;
    const file = new File([made.blob], made.filename, { type: 'application/pdf' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: msg }); }
      else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(made.blob); a.download = made.filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        if (q.customer?.phone) window.open(waLink(q.customer.phone, msg), '_blank', 'noopener');
        toast.message('The PDF is downloaded — attach it in the WhatsApp chat.');
      }
      if (q.status === 'draft') await setStatus('sent', '', q);
    } catch (e) { if (e?.name !== 'AbortError') toast.error('Couldn’t share it — download the PDF instead'); }
  };
  const copy = async () => {
    const q = await ensureSaved();
    if (!q) return;
    try { const r = await quotesAPI.duplicate(q.id); toast.success(`Copied to ${r.data.number}`); navigate(`/dashboard/quotations/${r.data.id}`); } catch (e) { toast.error(errText(e)); }
  };
  const remove = async () => {
    if (!await confirmAction({ title: `Delete quotation ${quote.display_number}?`, message: 'It goes for good. A quotation the customer has seen is better marked “Not accepted”.', confirmLabel: 'Delete', tone: 'danger' })) return;
    try { await quotesAPI.remove(quote.id); if (quote.lead_id) leadsChanged(); toast.success('Deleted'); navigate('/dashboard/quotations'); } catch (e) { toast.error(errText(e)); }
  };
  const makeSale = async () => {
    const q = await ensureSaved();
    if (q) navigate(`/dashboard/sales?quote=${q.id}`);
  };

  useHotkeys([
    { keys: 'mod+s', inInput: true, when: () => !locked, run: () => save() },
    { keys: 'mod+p', inInput: true, run: () => pdf() },
    { keys: 'a', when: () => !locked, run: () => pickerRef.current?.focus() },
  ], [customer, lines, billDisc, validUntil, subject, notes, internal, termsText, leadId, dirty, quote, profile, locked]);
  useEffect(() => {   // don't lose typed work by closing the tab
    if (!dirty || locked) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, locked]);

  if (!isNew && !quote) return <Loading />;
  const st = quote?.status || 'draft';
  const stockShort = lines.filter((l) => l.inventory_item_id && l.stock != null && num(l.quantity) > num(l.stock));
  const below = sees ? lines.filter((l) => l.cost_price && num(l.unit_price) * (1 - num(l.discount_pct) / 100) < num(l.cost_price)) : [];
  const marginAmt = sees ? r2(t.taxable - lines.reduce((n, l) => n + num(l.cost_price) * num(l.quantity), 0)) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 pb-28 sm:p-6 sm:pb-28" data-testid="quotation-editor">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/dashboard/quotations" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Back to quotations"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 font-['Outfit'] text-xl font-semibold text-slate-900">
            {isNew ? 'New material quotation' : quote.display_number}
            {!isNew && <Chip tone={quote.expired ? 'amber' : QUOTE_TONE[st]}>{quote.expired ? 'Expired' : quote.status_label}</Chip>}
            {dirty && !isNew && !locked && <Chip tone="amber">Not saved</Chip>}
          </h1>
          {!isNew && <p className="text-xs text-slate-500">{fmtDate(quote.quote_date || quote.created_at)} · by {quote.created_by_name}{quote.copied_from ? ` · copy of ${quote.copied_from}` : ''}</p>}
        </div>
        {!isNew && (<>
          <Button variant="outline" className="h-10 gap-1.5" onClick={() => pdf()} disabled={!!busy} data-testid="q-pdf">{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF</Button>
          <Button className="h-10 gap-1.5 bg-[#12803D] text-white hover:bg-[#0F6E34]" onClick={whatsapp} disabled={!!busy} data-testid="q-whatsapp"><MessageCircle className="h-4 w-4" />WhatsApp</Button>
          {!locked && can('module_direct_sales', 'create') && ['sent', 'accepted'].includes(st) && (
            <Button className="h-10 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={makeSale} data-testid="q-make-sale"><Receipt className="h-4 w-4" />Make the sale</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" className="h-10" data-testid="q-more">More</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {!locked && st !== 'sent' && <DropdownMenuItem onClick={() => setStatus('sent')}><Send className="mr-2 h-4 w-4" />Mark sent</DropdownMenuItem>}
              {!locked && st !== 'accepted' && <DropdownMenuItem onClick={() => setStatus('accepted')} data-testid="q-accepted"><Check className="mr-2 h-4 w-4" />Customer said yes</DropdownMenuItem>}
              {!locked && st !== 'rejected' && <DropdownMenuItem onClick={() => setStatus('rejected')}><X className="mr-2 h-4 w-4" />Not accepted</DropdownMenuItem>}
              {!locked && can('module_direct_sales', 'create') && !['sent', 'accepted'].includes(st) && <DropdownMenuItem onClick={makeSale}><Receipt className="mr-2 h-4 w-4" />Make the sale</DropdownMenuItem>}
              <DropdownMenuSeparator />
              {can('module_material_quotes', 'create') && <DropdownMenuItem onClick={copy}><Copy className="mr-2 h-4 w-4" />Copy to a new quotation</DropdownMenuItem>}
              {!locked && can('module_material_quotes', 'delete') && <DropdownMenuItem onClick={remove} className="text-rose-600"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </>)}
      </div>

      {locked && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="q-sold">
          <Receipt className="h-4 w-4" />Sold — invoice <b>{quote.invoice_number}</b> for {inr(quote.sale_total || quote.grand_total)}. This quotation can’t change now; copy it to quote again.
          <Link to="/dashboard/sales" className="ml-auto font-semibold underline underline-offset-2">Open Direct sales</Link>
        </div>
      )}
      {quote?.expired && !locked && <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"><AlertTriangle className="h-4 w-4" />Valid till {fmtDate(quote.valid_until)} has passed. Check the rates and move the date before sending it again.</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {/* customer */}
          <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="q-customer">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">Customer</p>
              {lead && <Link to={`/dashboard/leads?lead=${lead.id}`} className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"><Contact className="h-3.5 w-3.5" />Lead {lead.number}{lead.name ? ` — ${lead.name}` : ''}</Link>}
            </div>
            <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Name"><input className={inputCls} value={customer.name} onChange={setC('name')} data-testid="q-customer-name" /></Field>
              <Field label="Mobile"><input className={inputCls} inputMode="tel" value={customer.phone} onChange={setC('phone')} placeholder="For WhatsApp" data-testid="q-customer-phone" /></Field>
              <Field label="Company (optional)"><input className={inputCls} value={customer.company} onChange={setC('company')} /></Field>
              <Field label="GSTIN (for a business)"><input className={`${inputCls} uppercase`} value={customer.gstin} onChange={setC('gstin')} placeholder="33ABCDE1234F1Z5" /></Field>
              <Field label="State" hint={inter ? 'Outside our state — IGST' : 'Same state — CGST + SGST'}>
                <select className={inputCls} value={customer.state} onChange={setC('state')} data-testid="q-customer-state">{INDIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </Field>
              <Field label="Email (optional)"><input className={inputCls} type="email" value={customer.email} onChange={setC('email')} /></Field>
              <Field label="Address" className="sm:col-span-2 xl:col-span-3"><input className={inputCls} value={customer.address} onChange={setC('address')} placeholder="Street, town, PIN" /></Field>
            </fieldset>
          </section>

          {/* items */}
          <section className="rounded-xl border border-slate-200 bg-white" data-testid="q-items">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
              <p className="mr-auto text-sm font-semibold text-slate-900">Items <span className="font-normal text-slate-500">{lines.length || ''}</span><span className="ml-2 text-xs font-normal text-slate-500">Rates are before GST</span></p>
              {!locked && <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={addCustom} data-testid="q-add-line"><Plus className="h-4 w-4" />Add a line (transport, labour…)</Button>}
            </div>
            {!locked && <div className="border-b border-slate-100 p-4"><ItemPicker onPick={addItem} sees={sees} inputRef={pickerRef} /></div>}
            {lines.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500"><Package className="mx-auto mb-2 h-8 w-8 text-slate-300" />Type in the box above to add panels, inverters, cables… Press <b>Enter</b> to add, then type the quantity.</div>
            ) : isPhone ? (
              <ul className="divide-y divide-slate-100" data-testid="q-line-cards">
                {lines.map((l, i) => {
                  const w = lineWarnings(l);
                  return (
                    <li key={l.key} className="space-y-2 px-4 py-3" data-testid={`q-line-${i}`}>
                      <div className="flex items-start gap-2">
                        <input data-line-name={l.key} className={`${cellCls} font-medium`} value={l.name} onChange={(e) => updLine(i, 'name', e.target.value)} disabled={locked} placeholder="Item or service" aria-label="Item" />
                        {!locked && <button type="button" onClick={() => rmLine(i)} className="shrink-0 rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${l.name || 'line'}`}><Trash2 className="h-4 w-4" /></button>}
                      </div>
                      <div className="grid grid-cols-[1fr_1.4fr_0.8fr_0.8fr] gap-2">
                        <label className="text-[11px] text-slate-500">Qty ({l.unit || 'Nos'})<input ref={(el) => { qtyRefs.current[l.key] = el; }} className={`${cellCls} mt-0.5 text-right`} inputMode="decimal" value={l.quantity} onChange={(e) => updLine(i, 'quantity', e.target.value)} disabled={locked} data-testid={`q-qty-${i}`} /></label>
                        <label className="text-[11px] text-slate-500">Rate<input className={`${cellCls} mt-0.5 text-right`} inputMode="decimal" value={l.unit_price} onChange={(e) => updLine(i, 'unit_price', e.target.value)} disabled={locked} data-testid={`q-rate-${i}`} /></label>
                        <label className="text-[11px] text-slate-500">Disc %<input className={`${cellCls} mt-0.5 text-right`} inputMode="decimal" value={l.discount_pct || ''} onChange={(e) => updLine(i, 'discount_pct', e.target.value)} disabled={locked} placeholder="0" /></label>
                        <label className="text-[11px] text-slate-500">GST %<input className={`${cellCls} mt-0.5 text-right`} inputMode="decimal" value={l.gst_percentage} onChange={(e) => updLine(i, 'gst_percentage', e.target.value)} disabled={locked} /></label>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex flex-wrap gap-x-3">
                          {l.hsn_code && <span className="text-slate-500">HSN {l.hsn_code}</span>}
                          {w.short && <span className="text-amber-700">Only {l.stock} in stock</span>}
                          {w.low && <span className="text-rose-700">Below cost</span>}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-slate-900">{money(t.rows[i]?.total)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="w-7 px-3 py-2 text-left font-medium">#</th>
                      <th className="px-2 py-2 text-left font-medium">Item</th>
                      <th className="w-24 px-2 py-2 text-right font-medium">Qty</th>
                      <th className="w-32 px-2 py-2 text-right font-medium">Rate</th>
                      <th className="w-16 px-2 py-2 text-right font-medium">Disc %</th>
                      <th className="w-16 px-2 py-2 text-right font-medium">GST %</th>
                      <th className="w-28 px-2 py-2 text-right font-medium">Amount</th>
                      <th className="w-9" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const { short, low } = lineWarnings(l);
                      return (
                        <tr key={l.key} className="border-t border-slate-100 align-top" data-testid={`q-line-${i}`}>
                          <td className="px-3 py-2.5 text-xs text-slate-400">{i + 1}</td>
                          <td className="px-2 py-1.5">
                            <input data-line-name={l.key} className={`${cellCls} font-medium`} value={l.name} onChange={(e) => updLine(i, 'name', e.target.value)} disabled={locked} placeholder="Item or service" aria-label="Item" />
                            <div className="mt-1 flex gap-1">
                              <input className="h-7 min-w-0 flex-1 rounded border border-transparent px-2 text-xs text-slate-600 outline-none hover:border-slate-200 focus:border-emerald-500" value={l.description || ''} onChange={(e) => updLine(i, 'description', e.target.value)} disabled={locked} placeholder="Add a description (optional)" aria-label="Description" />
                              <label className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">HSN
                                <input className="h-7 w-[86px] rounded border border-slate-200 px-1.5 text-xs tabular-nums text-slate-700 outline-none focus:border-emerald-500" value={l.hsn_code || ''} onChange={(e) => updLine(i, 'hsn_code', e.target.value)} disabled={locked} aria-label="HSN code" />
                              </label>
                            </div>
                            {(short || low) && (
                              <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px]">
                                {short && <span className="text-amber-700">Only {l.stock} in stock</span>}
                                {low && <span className="text-rose-700">Below cost ({money(l.cost_price)})</span>}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <input ref={(el) => { qtyRefs.current[l.key] = el; }} className={`${cellCls} text-right`} inputMode="decimal" value={l.quantity} onChange={(e) => updLine(i, 'quantity', e.target.value)} disabled={locked} aria-label="Quantity" data-testid={`q-qty-${i}`}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pickerRef.current?.focus(); } }} />
                            <select className="mt-1 h-7 w-full rounded border border-transparent bg-transparent px-1 text-right text-xs text-slate-600 outline-none hover:border-slate-200 focus:border-emerald-500" value={l.unit || 'Nos'} onChange={(e) => updLine(i, 'unit', e.target.value)} disabled={locked} aria-label="Unit">
                              {[...new Set([...(defaults?.units || ['Nos']), l.unit || 'Nos'])].map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5"><input className={`${cellCls} text-right`} inputMode="decimal" value={l.unit_price} onChange={(e) => updLine(i, 'unit_price', e.target.value)} disabled={locked} aria-label="Rate before GST" data-testid={`q-rate-${i}`} /></td>
                          <td className="px-2 py-1.5"><input className={`${cellCls} text-right`} inputMode="decimal" value={l.discount_pct || ''} onChange={(e) => updLine(i, 'discount_pct', e.target.value)} disabled={locked} placeholder="0" aria-label="Discount %" /></td>
                          <td className="px-2 py-1.5"><input className={`${cellCls} text-right`} inputMode="decimal" value={l.gst_percentage} onChange={(e) => updLine(i, 'gst_percentage', e.target.value)} disabled={locked} aria-label="GST %" /></td>
                          <td className="px-2 py-2.5 text-right tabular-nums font-medium text-slate-900">{money(t.rows[i]?.total)}</td>
                          <td className="px-1 py-1.5">{!locked && <button type="button" onClick={() => rmLine(i)} className="rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${l.name || 'line'}`}><Trash2 className="h-4 w-4" /></button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* printed extras */}
          <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
            <fieldset disabled={locked} className="contents">
              <Field label="Subject (optional)" className="sm:col-span-2"><input className={inputCls} value={subject} onChange={changed((e) => setSubject(e.target.value))} placeholder="e.g. Material for 5 kW on-grid system" /></Field>
              <Field label="Notes for the customer (printed)"><textarea className={`${inputCls} h-auto min-h-[88px] py-2`} value={notes} onChange={changed((e) => setNotes(e.target.value))} placeholder="e.g. Delivery to site included within 30 km" /></Field>
              <Field label="Terms (one per line, printed)"><textarea className={`${inputCls} h-auto min-h-[88px] py-2 text-xs`} value={termsText} onChange={changed((e) => setTermsText(e.target.value))} /></Field>
              <Field label="Internal note (only our team sees it)" className="sm:col-span-2"><input className={inputCls} value={internal} onChange={changed((e) => setInternal(e.target.value))} placeholder="e.g. Price matched with the dealer’s offer" /></Field>
            </fieldset>
          </section>
        </div>

        {/* totals */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="q-totals">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Items total</dt><dd className="tabular-nums">{money(t.subtotal)}</dd></div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Discount on the whole order</dt>
                <dd><input className="h-8 w-28 rounded-md border border-slate-300 px-2 text-right text-sm tabular-nums outline-none focus:border-emerald-500" inputMode="decimal" value={billDisc} onChange={changed((e) => setBillDisc(e.target.value))} disabled={locked} placeholder="₹0" aria-label="Discount on the whole order" data-testid="q-bill-discount" /></dd>
              </div>
              {t.discount > 0 && <div className="flex justify-between text-slate-600"><dt>All discounts</dt><dd className="tabular-nums">− {money(t.discount)}</dd></div>}
              <div className="flex justify-between border-t border-slate-100 pt-1.5"><dt className="text-slate-600">Taxable value</dt><dd className="tabular-nums">{money(t.taxable)}</dd></div>
              {inter ? <div className="flex justify-between"><dt className="text-slate-600">IGST</dt><dd className="tabular-nums">{money(t.igst)}</dd></div> : (<>
                <div className="flex justify-between"><dt className="text-slate-600">CGST</dt><dd className="tabular-nums">{money(t.cgst)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-600">SGST</dt><dd className="tabular-nums">{money(t.sgst)}</dd></div>
              </>)}
              {t.roundOff !== 0 && <div className="flex justify-between text-slate-500"><dt>Round off</dt><dd className="tabular-nums">{t.roundOff > 0 ? '+' : '−'} {money(Math.abs(t.roundOff))}</dd></div>}
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2"><dt className="font-semibold text-slate-900">Total</dt><dd className="font-['Outfit'] text-2xl font-semibold tabular-nums text-slate-900" data-testid="q-grand-total">{inr(t.grand)}</dd></div>
            </dl>
            {sees && lines.length > 0 && (
              <p className={`mt-3 rounded-md px-3 py-2 text-xs ${marginAmt < 0 ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-600'}`} data-testid="q-margin">
                Margin {money(marginAmt)}{t.taxable > 0 ? ` (${Math.round((marginAmt / t.taxable) * 1000) / 10}%)` : ''} — only people who can see the Price list see this.
                {below.length > 0 && <span className="block font-medium text-rose-700">{below.length} item{below.length === 1 ? ' is' : 's are'} below cost.</span>}
              </p>
            )}
            {stockShort.length > 0 && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{stockShort.length} item{stockShort.length === 1 ? '' : 's'} short of stock — order before promising a date.</p>}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <Field label="Valid till"><input type="date" className={inputCls} value={validUntil} onChange={changed((e) => setValidUntil(e.target.value))} disabled={locked} data-testid="q-valid-until" /></Field>
          </section>
          {quote?.history?.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="mb-2 text-xs font-semibold text-slate-700">History</p>
              <ol className="space-y-1.5 text-xs">{[...quote.history].reverse().slice(0, 12).map((h, i) => <li key={`${h.at}-${i}`}><span className="text-slate-800">{h.text}</span> <span className="text-slate-400">— {h.by}, {fmtDate(h.at)}</span></li>)}</ol>
            </section>
          )}
        </aside>
      </div>

      {/* save bar */}
      {!locked && (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-64">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-sm text-slate-600"><b className="font-['Outfit'] text-base text-slate-900">{inr(t.grand)}</b> · {lines.length} item{lines.length === 1 ? '' : 's'}{inter ? ' · IGST' : ''}</p>
            <Button onClick={() => save()} disabled={busy === 'save' || (!dirty && !isNew)} className="h-11 gap-1.5 bg-emerald-600 px-5 text-white hover:bg-emerald-700" data-testid="q-save">
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{isNew ? 'Save quotation' : dirty ? 'Save changes' : 'Saved'}
              <kbd className="ml-1 hidden rounded bg-emerald-700/60 px-1.5 text-[10px] sm:inline">{MOD}+S</kbd>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
