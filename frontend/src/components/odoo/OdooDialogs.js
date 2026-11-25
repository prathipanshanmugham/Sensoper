/* The Odoo sync set-up dialogs: pick extra Odoo fields, set up one of the four syncs, add an Odoo table, preview a run. */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, Plus, X, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Chip, Field, inputCls, errText, Loading } from '../kit/PageBits';
import { odooAPI } from '../../utils/api';

const STAGES = [['new', 'New'], ['contacted', 'Called'], ['site_visit', 'Site visit booked'], ['quoted', 'Quote sent'], ['won', 'Won'], ['lost', 'Not going ahead']];
const ORDER_STATES = [['draft', 'Quotation'], ['sent', 'Quotation sent'], ['sale', 'Sales order'], ['done', 'Locked / done'], ['cancel', 'Cancelled']];
const OPS = ['=', '!=', '>', '>=', '<', '<=', 'contains', 'is set', 'is not set'];
const selectCls = `${inputCls.replace('w-full ', '')} w-full`;

export function Check({ checked, onChange, children, hint, testid }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md py-1 text-sm text-slate-800">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" checked={!!checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
      <span>{children}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}

/** Tick Odoo fields; custom (x_) fields first. `exclude` = fields the sync already copies. */
export function FieldPicker({ model, value, onChange, exclude = [], max = 40 }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [onlyCustom, setOnlyCustom] = useState(false);
  useEffect(() => {
    if (!model) { setRows(null); return; }
    setRows(null);
    odooAPI.fields(model).then((r) => setRows(r.data.fields)).catch((e) => { toast.error(errText(e, 'Couldn’t read the fields from Odoo')); setRows([]); });
  }, [model]);
  const shown = useMemo(() => (rows || []).filter((f) => !exclude.includes(f.name) && (!onlyCustom || f.custom)
    && (!q || `${f.label} ${f.name}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, onlyCustom, exclude]);
  const toggle = (name) => onChange(value.includes(name) ? value.filter((x) => x !== name) : value.length >= max ? value : [...value, name]);
  if (!model) return null;
  if (!rows) return <div className="py-6"><Loading /></div>;
  return (
    <div className="rounded-lg border border-slate-200" data-testid="field-picker">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-2">
        <label className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} className={`${inputCls} h-9 pl-8`} placeholder="Find a field" aria-label="Find a field" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" className="accent-emerald-600" checked={onlyCustom} onChange={(e) => setOnlyCustom(e.target.checked)} />Only custom fields</label>
        <span className="text-xs text-slate-500">{value.length} picked</span>
      </div>
      <ul className="max-h-64 overflow-y-auto p-1">
        {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No field matches.</li>}
        {shown.map((f) => (
          <li key={f.name}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={value.includes(f.name)} onChange={() => toggle(f.name)} data-testid={`field-${f.name}`} />
              <span className="min-w-0 flex-1 truncate">{f.label} <span className="text-xs text-slate-400">{f.name}</span></span>
              {f.custom && <Chip tone="violet">Custom</Chip>}
              <span className="w-20 shrink-0 text-right text-[11px] text-slate-400">{f.type}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

const BASE_FIELDS = {
  contacts: ['name', 'display_name', 'is_company', 'parent_id', 'email', 'phone', 'mobile', 'street', 'street2', 'city', 'zip', 'state_id', 'vat', 'customer_rank', 'supplier_rank', 'active', 'write_date', 'create_date'],
  products: ['name', 'display_name', 'default_code', 'list_price', 'lst_price', 'standard_price', 'categ_id', 'l10n_in_hsn_code', 'taxes_id', 'qty_available', 'type', 'active', 'write_date', 'create_date'],
  leads: ['name', 'contact_name', 'partner_name', 'email_from', 'phone', 'mobile', 'street', 'street2', 'city', 'zip', 'description', 'stage_id', 'user_id', 'expected_revenue', 'probability', 'active', 'lost_reason_id', 'activity_date_deadline', 'activity_summary', 'source_id', 'medium_id', 'priority', 'write_date', 'create_date'],
  orders: ['name', 'partner_id', 'date_order', 'validity_date', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'user_id', 'note', 'opportunity_id', 'client_order_ref', 'order_line', 'write_date', 'create_date'],
};

export function SyncSetupDialog({ preset, cfg, onClose, onSaved }) {
  const [opts, setOpts] = useState(cfg.options || {});
  const [extra, setExtra] = useState(cfg.extra_fields || []);
  const [look, setLook] = useState(null);
  const [busy, setBusy] = useState(false);
  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }));
  useEffect(() => {
    if (preset.key !== 'leads') return;
    odooAPI.lookups().then((r) => {
      setLook(r.data);
      setOpts((o) => ({
        ...o,
        stage_map: Object.fromEntries(r.data.stages.map((s) => [s.id, (o.stage_map || {})[s.id] || s.guess])),
        owner_map: Object.fromEntries(r.data.users.map((u) => [u.id, (o.owner_map || {})[u.id] ?? u.guess ?? ''])),
      }));
    }).catch((e) => toast.error(errText(e, 'Couldn’t read the stages and salespeople from Odoo')));
  }, [preset.key]);
  const save = async () => {
    setBusy(true);
    try { const r = await odooAPI.saveSync(preset.key, { options: opts, extra_fields: extra }); toast.success(`${preset.label}: saved`); onSaved(r.data); onClose(); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto" data-testid={`setup-${preset.key}`}>
        <DialogHeader>
          <DialogTitle>Set up: {preset.label}</DialogTitle>
          <DialogDescription>Odoo {preset.model} → {preset.into}. Changes made in Sensoper are never overwritten by a later sync.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          {preset.key === 'contacts' && (
            <section>
              <p className="mb-1.5 text-xs font-medium text-slate-700">Which contacts</p>
              {[['both', 'Customers and vendors'], ['customers', 'Only customers'], ['vendors', 'Only vendors']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 py-1"><input type="radio" name="who" className="accent-emerald-600" checked={opts.who === k} onChange={() => setOpt('who', k)} />{l}</label>
              ))}
              <p className="mt-1 text-xs text-slate-500">Contacts that are neither (no sale or purchase yet) are left in Odoo.</p>
            </section>
          )}
          {preset.key === 'products' && (
            <section className="space-y-1">
              <Check checked={opts.skip_services} onChange={(v) => setOpt('skip_services', v)} hint="Leave out labour, installation and other services.">Only goods, not services</Check>
              <Check checked={opts.update_stock} onChange={(v) => setOpt('update_stock', v)} testid="opt-update-stock"
                hint="Off (best while Sensoper does your sales and purchases): stock is copied once, when the item is created. On: every sync sets Sensoper's stock to Odoo's on-hand quantity.">
                Keep stock in step with Odoo
              </Check>
            </section>
          )}
          {preset.key === 'orders' && (
            <section>
              <p className="mb-1.5 text-xs font-medium text-slate-700">Bring in Odoo orders that are</p>
              <div className="grid grid-cols-2 gap-x-4">
                {ORDER_STATES.map(([k, l]) => (
                  <Check key={k} checked={(opts.states || []).includes(k)} onChange={(v) => setOpt('states', v ? [...(opts.states || []), k] : (opts.states || []).filter((x) => x !== k))}>{l}</Check>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">They come in read-only, exactly as Odoo priced them. Copy one in Sensoper to quote again.</p>
            </section>
          )}
          {preset.key === 'leads' && (
            <section className="space-y-4">
              <Check checked={opts.include_lost} onChange={(v) => setOpt('include_lost', v)} hint="Lost and archived Odoo leads come in as “Not going ahead”, with the reason.">Include lost leads</Check>
              {!look ? <Loading /> : (<>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-700">Odoo stage → Sensoper stage</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {look.stages.map((s) => (
                      <label key={s.id} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 truncate text-slate-700">{s.name}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <select className={selectCls} value={(opts.stage_map || {})[s.id] || s.guess} onChange={(e) => setOpt('stage_map', { ...(opts.stage_map || {}), [s.id]: e.target.value })} data-testid={`stage-${s.id}`}>
                          {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Won and lost in Odoo always come in as Won and Not going ahead.</p>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-700">Odoo salesperson → who handles it in Sensoper</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {look.users.map((u) => (
                      <label key={u.id} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 truncate text-slate-700" title={u.login}>{u.name}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <select className={selectCls} value={(opts.owner_map || {})[u.id] ?? ''} onChange={(e) => setOpt('owner_map', { ...(opts.owner_map || {}), [u.id]: e.target.value })}>
                          <option value="">Nobody (unassigned)</option>
                          {look.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              </>)}
            </section>
          )}
          <section>
            <p className="mb-1 text-xs font-medium text-slate-700">Extra Odoo fields to keep with each record</p>
            <p className="mb-2 text-xs text-slate-500">Your custom (Studio) fields and anything else Odoo has. They show in a “From Odoo” box and on the Odoo data page.</p>
            <FieldPicker model={preset.model} value={extra} onChange={setExtra} exclude={BASE_FIELDS[preset.key]} />
          </section>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="setup-save">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TableDialog({ table, onClose, onSaved }) {
  const editing = !!table;
  const [model, setModel] = useState(table?.model || '');
  const [label, setLabel] = useState(table?.label || '');
  const [fields, setFields] = useState(table?.fields || []);
  const [filters, setFilters] = useState(table?.filters || []);
  const [q, setQ] = useState('');
  const [models, setModels] = useState([]);
  const [meta, setMeta] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (editing) return undefined;
    const t = setTimeout(() => odooAPI.models(q).then((r) => setModels(r.data.models)).catch(() => setModels([])), 200);
    return () => clearTimeout(t);
  }, [q, editing]);
  useEffect(() => { if (model) odooAPI.fields(model).then((r) => setMeta(r.data.fields)).catch(() => setMeta([])); }, [model]);
  const save = async () => {
    if (!model) { toast.error('Pick the Odoo table first'); return; }
    if (!fields.length) { toast.error('Pick at least one field'); return; }
    setBusy(true);
    const body = { label: label || model, model, fields, filters: filters.filter((f) => f.field), enabled: true };
    try { const r = editing ? await odooAPI.editTable(table.key, body) : await odooAPI.addTable(body); toast.success(editing ? 'Saved' : `${body.label} added — press Sync now to bring it in`); onSaved(r.data); onClose(); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto" data-testid="table-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${table.label}` : 'Add an Odoo table'}</DialogTitle>
          <DialogDescription>Any Odoo table — a Studio model, a custom app, anything — copied into Sensoper to look through, search and download.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {!editing && !model && (
            <div>
              <Field label="Find the Odoo table"><input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. survey, x_site, helpdesk" autoFocus data-testid="model-search" /></Field>
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                {models.length === 0 && <li className="px-3 py-3 text-slate-500">Type part of its name.</li>}
                {models.map((m) => (
                  <li key={m.model}><button type="button" onClick={() => { setModel(m.model); setLabel(m.name); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50" data-testid={`model-${m.model}`}>
                    <span>{m.name} <span className="text-xs text-slate-400">{m.model}</span></span>{m.custom && <Chip tone="violet">Custom</Chip>}
                  </button></li>
                ))}
              </ul>
            </div>
          )}
          {model && (<>
            <div className="flex items-end gap-2">
              <Field label="Name in Sensoper" className="flex-1"><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} data-testid="table-label" /></Field>
              <div className="pb-2 text-xs text-slate-500">Odoo: {model}{!editing && <button type="button" className="ml-2 font-medium text-emerald-700 hover:underline" onClick={() => { setModel(''); setFields([]); setFilters([]); }}>Change</button>}</div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-700">Fields to bring in</p>
              <FieldPicker model={model} value={fields} onChange={setFields} max={60} />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-700">Only records where (optional)</p>
              <div className="space-y-2">
                {filters.map((f, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select className={`${inputCls.replace('w-full ', '')} w-44`} value={f.field} onChange={(e) => setFilters((x) => x.map((y, j) => (j === i ? { ...y, field: e.target.value } : y)))} aria-label="Field">
                      <option value="">Field…</option>{meta.map((m) => <option key={m.name} value={m.name}>{m.label}</option>)}
                    </select>
                    <select className={`${inputCls.replace('w-full ', '')} w-28`} value={f.op} onChange={(e) => setFilters((x) => x.map((y, j) => (j === i ? { ...y, op: e.target.value } : y)))} aria-label="Condition">
                      {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    {!['is set', 'is not set'].includes(f.op) && <input className={`${inputCls.replace('w-full ', '')} w-36`} value={f.value ?? ''} onChange={(e) => setFilters((x) => x.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} aria-label="Value" />}
                    <button type="button" onClick={() => setFilters((x) => x.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Remove this condition"><X className="h-4 w-4" /></button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => setFilters((x) => [...x, { field: '', op: '=', value: '' }])}><Plus className="h-3.5 w-3.5" />Add a condition</Button>
              </div>
            </div>
          </>)}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !model} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="table-save">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? 'Save' : 'Add table'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_TONE = { created: 'green', updated: 'blue', unchanged: 'slate' };
const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function PreviewDialog({ title, data, onClose, onRun }) {
  const totals = Object.values(data?.results || {}).reduce((a, r) => ({ created: a.created + (r.created || 0), updated: a.updated + (r.updated || 0), unchanged: a.unchanged + (r.unchanged || 0), kept: a.kept + (r.kept_local || 0) }), { created: 0, updated: 0, unchanged: 0, kept: 0 });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto" data-testid="preview-dialog">
        <DialogHeader>
          <DialogTitle>Preview: {title}</DialogTitle>
          <DialogDescription>The first 25 Odoo records and what a sync would do with them. Nothing has been changed.</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-slate-700"><b>{totals.created}</b> new · <b>{totals.updated}</b> updated · {totals.unchanged} already the same{totals.kept ? ` · ${totals.kept} of your changes kept` : ''}</p>
        {(data?.errors || []).length > 0 && <div className="rounded-md bg-rose-50 p-3 text-xs text-rose-800">{data.errors.map((e, i) => <p key={i}>{e.record ? `${e.record}: ` : ''}{e.message}</p>)}</div>}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {(data?.changes || []).length === 0 && <li className="px-3 py-6 text-center text-slate-500">Nothing to change — Sensoper already matches Odoo.</li>}
          {(data?.changes || []).map((c, i) => (
            <li key={i} className="px-3 py-2">
              <p className="flex items-center gap-2"><Chip tone={ACTION_TONE[c.action]}>{c.action === 'created' ? 'New' : c.action === 'updated' ? 'Update' : 'Same'}</Chip><span className="truncate font-medium text-slate-900">{c.title}</span></p>
              {c.action === 'updated' && (c.changes || []).length > 0 && (
                <ul className="mt-1 space-y-0.5 pl-1 text-xs text-slate-600">
                  {c.changes.map((ch, j) => <li key={j}><span className="text-slate-500">{ch.field}:</span> {show(ch.from)} <ArrowRight className="inline h-3 w-3" /> <b className="font-medium text-slate-800">{show(ch.to)}</b></li>)}
                </ul>
              )}
              {(c.kept || []).length > 0 && <p className="mt-0.5 text-xs text-amber-800">Keeps your change to: {c.kept.join(', ')}</p>}
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {onRun && <Button onClick={() => { onClose(); onRun(); }} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="preview-run">Sync now</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
