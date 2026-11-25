/* Odoo sync — connect Odoo once (address + API key), pick what comes in, press Sync now; it also runs every hour.
 * One way: Sensoper copies and updates, nothing in Odoo is ever changed. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CloudDownload, KeyRound, Loader2, RefreshCw, Eye, Settings2, Plus, Table2, Trash2, Pencil, CheckCircle2, AlertTriangle, Users, Package, Contact, FileSpreadsheet,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { PageHeader, Chip, Field, inputCls, errText, fmtDate, Loading } from '../components/kit/PageBits';
import { confirmAction } from '../components/kit/confirm';
import { odooAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { SyncSetupDialog, TableDialog, PreviewDialog } from '../components/odoo/OdooDialogs';

const ICON = { contacts: Users, products: Package, leads: Contact, orders: FileSpreadsheet };
const WHERE = { contacts: '/dashboard/odoo/data/customers', products: '/dashboard/inventory', leads: '/dashboard/leads', orders: '/dashboard/quotations' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0);

function summary(r) {
  if (!r) return 'Not run yet';
  if (r.error) return r.error;
  const bits = [];
  if (r.created) bits.push(`${r.created} new`);
  if (r.updated) bits.push(`${r.updated} updated`);
  if (r.kept_local) bits.push(`${r.kept_local} of your changes kept`);
  if (r.errors) bits.push(`${r.errors} couldn’t come in`);
  return bits.length ? bits.join(' · ') : 'Nothing new';
}

function ConnectionCard({ s, onSaved, isAdmin }) {
  const [editing, setEditing] = useState(!s.has_key);
  const [f, setF] = useState({ url: s.url || '', database: s.database || '', login: s.login || '', api_key: '' });
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(null);
  useEffect(() => { setEditing(!s.has_key); }, [s.has_key]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy('save');
    try { const r = await odooAPI.connect(f); toast.success('Connected to Odoo'); setF((x) => ({ ...x, api_key: '' })); setEditing(false); onSaved(r.data); }
    catch (e) { toast.error(errText(e, 'Couldn’t connect to Odoo'), { duration: 8000 }); } finally { setBusy(''); }
  };
  const runTest = async () => {
    setBusy('test');
    try { const r = await odooAPI.test(); setTest(r.data); toast.success('Odoo answered'); }
    catch (e) { toast.error(errText(e, 'Odoo didn’t answer'), { duration: 8000 }); } finally { setBusy(''); }
  };
  const forget = async () => {
    if (!await confirmAction({ title: 'Forget the Odoo key?', message: 'Syncing stops until someone pastes a new key. Everything already copied stays in Sensoper.', confirmLabel: 'Forget the key', tone: 'danger' })) return;
    try { await odooAPI.forgetKey(); toast.success('Key removed'); onSaved(); } catch (e) { toast.error(errText(e)); }
  };
  const age = daysSince(s.key_saved_at);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" data-testid="odoo-connection">
      <div className="mb-3 flex items-center gap-2"><KeyRound className="h-5 w-5 text-slate-500" /><h2 className="font-semibold text-slate-900">Connection</h2>
        {s.has_key && !s.last_error && <Chip tone="green"><CheckCircle2 className="h-3 w-3" />Connected</Chip>}
        {s.has_key && s.last_error && <Chip tone="red"><AlertTriangle className="h-3 w-3" />Needs attention</Chip>}
      </div>
      {s.has_key && !editing ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-700">
            <b className="text-slate-900">{s.url}</b>{s.odoo_version ? ` — Odoo ${s.odoo_version}` : ''}{s.odoo_user ? `, as ${s.odoo_user}` : ''}{s.odoo_company ? ` (${s.odoo_company})` : ''}
            <span className="block text-xs text-slate-500">Key …{s.key_last4} saved {fmtDate(s.key_saved_at)}{s.key_saved_by ? ` by ${s.key_saved_by}` : ''} · {s.api === 'json2' ? 'JSON-2 API' : 'JSON-RPC API'}{s.database ? ` · database ${s.database}` : ''}</span>
          </p>
          {s.last_error && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800" data-testid="odoo-error">{s.last_error}</p>}
          {age >= 75 && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">Odoo keys last at most 3 months. This one is {age} days old — make a new key in Odoo and paste it here before it stops.</p>}
          {test && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-slate-700" data-testid="odoo-test-result">
              In Odoo now: {Object.entries(test.counts || {}).map(([k, v]) => `${v ?? '—'} ${{ contacts: 'contacts', products: 'products', leads: 'CRM leads', orders: 'quotations & orders' }[k]}`).join(' · ')}
              {(test.missing || []).length > 0 && <span className="block text-xs text-amber-800">{test.missing.join(' · ')}</span>}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-9 gap-1.5" onClick={runTest} disabled={!!busy} data-testid="odoo-test">{busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Test connection</Button>
            {isAdmin && <Button variant="outline" className="h-9 gap-1.5" onClick={() => setEditing(true)} data-testid="odoo-change"><Pencil className="h-4 w-4" />Change / new key</Button>}
            {isAdmin && <Button variant="ghost" className="h-9 text-rose-600" onClick={forget}>Forget the key</Button>}
          </div>
        </div>
      ) : !isAdmin ? (
        <p className="text-sm text-slate-600">An admin connects Odoo here with its address and an API key.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Odoo address" hint="The address you open Odoo at"><input className={inputCls} value={f.url} onChange={set('url')} placeholder="https://sensoper.odoo.com" data-testid="odoo-url" /></Field>
            <Field label="API key" hint={s.has_key ? `Saved (…${s.key_last4}). Paste a new one to replace it.` : 'Sensoper keeps it encrypted and never shows it again'}>
              <input className={inputCls} type="password" autoComplete="new-password" spellCheck={false} value={f.api_key} onChange={set('api_key')} placeholder={s.has_key ? '••••••••••' : 'Paste the key'} data-testid="odoo-key" />
            </Field>
            <Field label="Login email (Odoo 18 and older)" hint="The Odoo user the key belongs to"><input className={inputCls} value={f.login} onChange={set('login')} placeholder="you@sensoper.in" data-testid="odoo-login" /></Field>
            <Field label="Database (if Odoo asks)" hint="On odoo.com it’s filled in for you"><input className={inputCls} value={f.database} onChange={set('database')} placeholder="sensoper" data-testid="odoo-db" /></Field>
          </div>
          <details className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">How to make the API key in Odoo</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>In Odoo, click your name (top right) → <b>My Profile</b> (or Preferences) → <b>Account Security</b>.</li>
              <li><b>New API Key</b>, confirm your password, name it “Sensoper sync” and pick the longest duration (at most 3 months).</li>
              <li>Copy the key Odoo shows once and paste it here. Use an Odoo user that can see contacts, products, CRM and sales.</li>
              <li>On Odoo Online, the API needs the Custom plan.</li>
            </ol>
          </details>
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy === 'save' || !f.url} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="odoo-connect">
              {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}Connect and test
            </Button>
            {s.has_key && <Button variant="ghost" className="h-10" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </div>
      )}
    </section>
  );
}

export default function OdooSyncPage() {
  const { user, can } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canRun = can('module_odoo_sync', 'edit');
  const [s, setS] = useState(null);
  const [runs, setRuns] = useState([]);
  const [active, setActive] = useState(null);       // the run in progress
  const [setup, setSetup] = useState(null);
  const [table, setTable] = useState(undefined);    // undefined = closed, null = new
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const poll = useRef(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([odooAPI.settings(), odooAPI.runs()]);
      setS(a.data); setRuns(b.data.items || []);
      const running = (b.data.items || []).find((r) => r.status === 'running');
      if (running) setActive(running);
    } catch (e) { toast.error(errText(e, 'Couldn’t load the Odoo sync')); setS((x) => x || {}); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!active || active.status !== 'running') return undefined;
    poll.current = setInterval(async () => {
      try {
        const r = await odooAPI.runStatus(active.id);
        setActive(r.data);
        if (r.data.status !== 'running') {
          clearInterval(poll.current);
          const fails = (r.data.errors || []).length;
          if (r.data.status === 'failed') toast.error(r.data.error || 'The sync stopped', { duration: 8000 });
          else toast.success(fails ? `Sync finished — ${fails} record${fails === 1 ? '' : 's'} couldn’t come in` : 'Sync finished');
          load();
        }
      } catch { /* keep polling */ }
    }, 1200);
    return () => clearInterval(poll.current);
  }, [active, load]);

  const run = async (name, full = false) => {
    setBusy(`run-${name}`);
    try { const r = await odooAPI.run(name, full); setActive({ id: r.data.run_id, status: 'running', results: {}, which: [name] }); toast.message('Syncing…'); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(''); }
  };
  const doPreview = async (name, title) => {
    setBusy(`preview-${name}`);
    try { const r = await odooAPI.preview(name); setPreview({ name, title, data: r.data }); }
    catch (e) { toast.error(errText(e, 'Couldn’t preview')); } finally { setBusy(''); }
  };
  const toggle = async (name, enabled) => {
    try { const r = await odooAPI.saveSync(name, { enabled }); setS((x) => ({ ...x, ...r.data, counts: x.counts })); } catch (e) { toast.error(errText(e)); }
  };
  const saveSettings = async (data) => {
    try { const r = await odooAPI.saveSettings(data); setS((x) => ({ ...x, ...r.data, counts: x.counts })); } catch (e) { toast.error(errText(e)); }
  };
  const removeTable = async (t) => {
    if (!await confirmAction({ title: `Remove ${t.label}?`, message: `Its ${t.count || 0} copied records are deleted from Sensoper. Nothing changes in Odoo.`, confirmLabel: 'Remove', tone: 'danger' })) return;
    try { await odooAPI.removeTable(t.key); toast.success('Removed'); load(); } catch (e) { toast.error(errText(e)); }
  };

  if (!s) return <Loading />;
  const running = active?.status === 'running';
  const progress = (key) => (running && active.results?.[key]) || null;
  const anyOn = (s.presets || []).some((p) => s.syncs?.[p.key]?.enabled) || (s.tables || []).length > 0;
  const counts = s.counts || {};
  const countText = { contacts: `${counts.customers || 0} customers · ${counts.vendors || 0} vendors`, products: `${counts.products || 0} items`,
    leads: `${counts.leads || 0} leads`, orders: `${counts.orders || 0} quotations` };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6" data-testid="odoo-page">
      <PageHeader icon={CloudDownload} title="Odoo sync" sub="Copies your Odoo contacts, products, CRM leads and quotations into Sensoper. Nothing in Odoo is ever changed." />

      <ConnectionCard s={s} isAdmin={isAdmin} onSaved={load} />

      {s.has_key && (<>
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="odoo-controls">
          <label className="flex items-center gap-2.5 text-sm">
            <Switch checked={!!s.auto_hourly} onCheckedChange={(v) => saveSettings({ auto_hourly: v })} disabled={!canRun} data-testid="odoo-hourly" />
            <span><b className="font-medium text-slate-900">Sync every hour</b><span className="block text-xs text-slate-500">{s.auto_hourly ? (s.next_auto_at ? `Next about ${when(s.next_auto_at)}` : 'Starts within the hour') : 'Only when someone presses Sync'}</span></span>
          </label>
          <div className="ml-auto flex items-center gap-3">
            {s.last_run && !running && <span className="hidden text-xs text-slate-500 sm:block">Last sync {when(s.last_run.started_at)} — {{ done: 'done', partial: 'done, with problems', failed: 'stopped' }[s.last_run.status] || s.last_run.status}</span>}
            {canRun && (
              <Button onClick={() => run('all')} disabled={running || !anyOn || !!busy} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="odoo-sync-all">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{running ? 'Syncing…' : 'Sync everything now'}
              </Button>
            )}
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          {(s.presets || []).map((p) => {
            const cfg = s.syncs?.[p.key] || {};
            const Icon = ICON[p.key];
            const pr = progress(p.key);
            return (
              <section key={p.key} className={`flex flex-col rounded-xl border bg-white p-4 ${cfg.enabled ? 'border-slate-200' : 'border-dashed border-slate-300'}`} data-testid={`odoo-card-${p.key}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900">{p.label}</h3>
                    <p className="text-xs text-slate-500">Odoo {p.model} → {p.into}</p>
                  </div>
                  <Switch checked={!!cfg.enabled} onCheckedChange={(v) => toggle(p.key, v)} disabled={!canRun} aria-label={`Sync ${p.label}`} data-testid={`odoo-toggle-${p.key}`} />
                </div>
                <p className="mt-2 text-sm text-slate-600">{p.what}</p>
                <div className="mt-3 space-y-1 text-xs">
                  <p className="text-slate-700"><Link to={WHERE[p.key]} className="font-medium text-emerald-700 hover:underline">{countText[p.key]}</Link> in Sensoper from Odoo
                    {(cfg.extra_fields || []).length > 0 && <span className="text-slate-500"> · {cfg.extra_fields.length} extra field{cfg.extra_fields.length === 1 ? '' : 's'}</span>}</p>
                  {pr ? (
                    <div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${pr.total ? Math.min(100, Math.round((pr.done / pr.total) * 100)) : 5}%` }} /></div>
                      <p className="mt-1 text-slate-500">{pr.done} of {pr.total}…</p>
                    </div>
                  ) : <p className={cfg.last_run?.errors ? 'text-amber-800' : 'text-slate-500'}>{cfg.last_run ? `${when(cfg.last_run.at)}: ${summary(cfg.last_run)}` : 'Not run yet'}</p>}
                </div>
                {canRun && (
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => run(p.key)} disabled={running || !!busy} data-testid={`odoo-run-${p.key}`}><RefreshCw className="h-4 w-4" />Sync now</Button>
                    <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => doPreview(p.key, p.label)} disabled={!!busy} data-testid={`odoo-preview-${p.key}`}>
                      {busy === `preview-${p.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Preview
                    </Button>
                    <Button size="sm" variant="ghost" className="h-9 gap-1.5" onClick={() => setSetup(p)} data-testid={`odoo-setup-${p.key}`}><Settings2 className="h-4 w-4" />Set up</Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="odoo-tables">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Table2 className="h-5 w-5 text-slate-500" />
            <div className="mr-auto"><h2 className="font-semibold text-slate-900">Other Odoo tables</h2><p className="text-xs text-slate-500">Any Odoo table — Studio models, custom apps — to look through and download in Sensoper.</p></div>
            {canRun && <Button variant="outline" className="h-9 gap-1.5" onClick={() => setTable(null)} data-testid="odoo-add-table"><Plus className="h-4 w-4" />Add an Odoo table</Button>}
          </div>
          {(s.tables || []).length === 0 ? <p className="py-3 text-sm text-slate-500">None yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {s.tables.map((t) => {
                const pr = progress(`table:${t.key}`);
                return (
                  <li key={t.key} className="flex flex-wrap items-center gap-3 py-3" data-testid={`odoo-table-${t.key}`}>
                    <div className="min-w-0 flex-1">
                      <Link to={`/dashboard/odoo/data/${t.key}`} className="font-medium text-slate-900 hover:underline">{t.label}</Link>
                      <p className="text-xs text-slate-500">{t.model} · {t.fields.length} fields · {t.count || 0} records{pr ? ` · ${pr.done} of ${pr.total}…` : t.last_run ? ` · ${when(t.last_run.at)}: ${summary(t.last_run)}` : ''}</p>
                    </div>
                    {canRun && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => run(`table:${t.key}`)} disabled={running}><RefreshCw className="h-3.5 w-3.5" />Sync</Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setTable(t)} aria-label={`Edit ${t.label}`}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-8 text-rose-600" onClick={() => removeTable(t)} aria-label={`Remove ${t.label}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white" data-testid="odoo-history">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">History</h2>
          {runs.length === 0 ? <p className="px-4 py-4 text-sm text-slate-500">No syncs yet.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {runs.slice(0, 15).map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-900">{when(r.started_at)}</span>
                    <Chip tone={{ done: 'green', partial: 'amber', failed: 'red', running: 'blue' }[r.status]}>{{ done: 'Done', partial: 'Done, with problems', failed: 'Stopped', running: 'Running' }[r.status]}</Chip>
                    <span className="text-xs text-slate-500">{r.trigger === 'hourly' ? 'every hour' : `by ${r.by}`}{r.full ? ' · checked everything' : ''}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {r.error || Object.entries(r.results || {}).map(([k, v]) => `${(s.presets || []).find((p) => p.key === k)?.label || (s.tables || []).find((t) => `table:${t.key}` === k)?.label || k}: ${summary(v)}`).join(' — ')}
                  </p>
                  {(r.errors || []).length > 0 && (
                    <details className="mt-1 text-xs text-rose-800"><summary className="cursor-pointer">{r.errors.length} problem{r.errors.length === 1 ? '' : 's'}</summary>
                      <ul className="mt-1 space-y-0.5">{r.errors.map((e, i) => <li key={i}>{e.record ? `${e.record}: ` : ''}{e.message}</li>)}</ul></details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        {canRun && (
          <p className="text-center text-xs text-slate-500">
            Something missing? <button type="button" className="font-medium text-emerald-700 hover:underline" onClick={() => run('all', true)} disabled={running}>Check every record again</button> — slower, but it re-reads all of Odoo instead of only what changed.
          </p>
        )}
      </>)}

      {setup && <SyncSetupDialog preset={setup} cfg={s.syncs?.[setup.key] || {}} onClose={() => setSetup(null)} onSaved={(d) => setS((x) => ({ ...x, ...d, counts: x.counts }))} />}
      {table !== undefined && <TableDialog table={table} onClose={() => setTable(undefined)} onSaved={() => load()} />}
      {preview && <PreviewDialog title={preview.title} data={preview.data} onClose={() => setPreview(null)} onRun={canRun ? () => run(preview.name) : null} />}
    </div>
  );
}
