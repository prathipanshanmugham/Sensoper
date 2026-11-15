/* Settings → AI agents (admins). Claude or ChatGPT connect with one address and an approval here; your own tools get
 * a key. Each agent works as a chosen login with the access given here: read only, read & write, or full control.
 * Every call an agent makes is listed under Activity (kept 90 days). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Bot, Check, Copy, Globe, KeyRound, Loader2, Pause, Pencil, Play, Plug, Plus, RefreshCw, Search, ShieldOff } from 'lucide-react';
import { agentsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Card, Chip, Empty, Field, Loading, PageHeader, PillTabs, addDaysISO, errText, fmtDate, inputCls, todayISO } from '../components/kit/PageBits';

export const ACCESS = [
  ['read', 'Read only', 'Looks things up. Changes nothing.'],
  ['write', 'Read & write', 'Adds and changes records. Can’t delete.'],
  ['full', 'Full control', 'Everything the login can do, deleting too. Deletes still wait for your yes.'],
];
const accessLabel = (k) => (ACCESS.find((a) => a[0] === k) || [k, k])[1];
const ACCESS_TONE = { read: 'slate', write: 'blue', full: 'amber' };
export const ROLE = { admin: 'Admin', manager: 'Manager', staff: 'Staff' };

export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** "All branches" for an admin, else the login's branches. */
export const branchText = (role, branches) => (role === 'admin' ? 'All branches' : (branches && branches.length ? branches.join(', ') : 'No branch set'));

export function CopyBox({ text, label, mono = true, testid, big = false }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }
    catch { toast.error('Could not copy. Select the text and copy it.'); }
  };
  return (
    <div className="space-y-1">
      {label && <p className="text-xs font-medium text-slate-700">{label}</p>}
      <div className={`flex items-center gap-2 rounded-lg border bg-slate-50 p-2 ${big ? 'border-emerald-200' : 'border-slate-200'}`}>
        <pre className={`min-w-0 flex-1 whitespace-pre-wrap break-all text-slate-800 ${big ? 'text-sm font-medium' : 'text-xs'} ${mono ? 'font-mono' : ''}`} data-testid={testid}>{text}</pre>
        <Button type="button" size="sm" variant={big ? 'default' : 'outline'} onClick={copy} aria-label={`Copy ${label || 'text'}`}
          className={`h-9 shrink-0 gap-1 ${big ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-white'}`} data-testid={testid ? `${testid}-copy` : undefined}>
          {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{done ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export function AccessPicker({ value, onChange, testid = 'agent-access' }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Access" data-testid={testid}>
      {ACCESS.map(([k, label, what]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} data-testid={`${testid}-${k}`}
          className={`rounded-xl border p-3 text-left transition-colors ${value === k ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
          <span className="block text-sm font-medium text-slate-900">{label}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{what}</span>
        </button>
      ))}
    </div>
  );
}

export function ExtraSwitches({ f, setF }) {
  return (
    <div className="space-y-2">
      {[['manage_access', 'Manage logins & permissions', 'Add or change users, roles, permissions and login security.'],
        ['read_saved_logins', 'Read saved passwords', 'Open passwords kept in Company logins and inverter passwords.']].map(([k, label, what]) => (
        <div key={k} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
          <div><p className="text-sm font-medium text-slate-900">{label}</p><p className="text-[11px] text-slate-500">{what} Each use still waits for your yes. Off unless you need it.</p></div>
          <Switch checked={!!f[k]} onCheckedChange={(v) => setF((x) => ({ ...x, [k]: v }))} aria-label={label} data-testid={`agent-${k}`} />
        </div>
      ))}
    </div>
  );
}

export function WorksAs({ users, value, onChange }) {
  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger className="h-11" data-testid="agent-works-as"><SelectValue placeholder="Choose a login" /></SelectTrigger>
      <SelectContent className="max-h-72">{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} · {ROLE[u.role] || u.role}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export const EXPIRY = [['never', 'Never'], ['30', 'In 30 days'], ['90', 'In 90 days'], ['date', 'On a date…']];
export const expiryDate = (choice, date) => (choice === 'never' ? null : choice === 'date' ? (date || null) : addDaysISO(todayISO(), Number(choice)));

export function ExpiryPicker({ choice, setChoice, date, setDate, label = 'Access ends' }) {
  const when = expiryDate(choice, date);
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={label}>
        <Select value={choice} onValueChange={setChoice}><SelectTrigger className="h-11" data-testid="agent-expiry"><SelectValue /></SelectTrigger>
          <SelectContent>{EXPIRY.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
      </Field>
      {choice === 'date' ? <Field label="Last day"><input type="date" min={todayISO()} value={date || ''} onChange={(e) => setDate(e.target.value)} className={inputCls} data-testid="agent-expiry-date" /></Field>
        : <p className="self-end pb-3 text-xs text-slate-500">{when ? `Last day ${fmtDate(when)}` : 'Until you revoke it'}</p>}
    </div>
  );
}

function AgentDialog({ open, agent, users, meId, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [exp, setExp] = useState('never');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(agent ? { name: agent.name, run_as_user_id: agent.run_as_user_id, access: agent.access, manage_access: agent.manage_access,
      read_saved_logins: agent.read_saved_logins, expires_on: agent.expires_on || '', note: agent.note || '' }
      : { name: '', run_as_user_id: meId, access: 'read', manage_access: false, read_saved_logins: false, expires_on: '', note: '' });
    setExp(agent?.expires_on ? 'date' : 'never');
  }, [open, agent, meId]);
  if (!open || !f) return null;
  const save = async () => {
    setSaving(true);
    const body = { ...f, expires_on: expiryDate(exp, f.expires_on) };
    try {
      if (agent) { await agentsAPI.update(agent.id, body); toast.success('Saved'); onSaved(null); }
      else { const r = await agentsAPI.create(body); onSaved(r.data); }
      onOpenChange(false);
    } catch (e) { toast.error(errText(e, 'Could not save')); } finally { setSaving(false); }
  };
  const runner = users.find((u) => u.id === f.run_as_user_id);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl grid-cols-[minmax(0,1fr)] overflow-y-auto" data-testid="agent-dialog">
        <DialogHeader><DialogTitle>{agent ? `Edit ${agent.name}` : 'Add an API key'}</DialogTitle>
          <DialogDescription>{agent ? 'Changes apply to its next call.' : 'For your own tools, n8n or scripts. You see the key once, on the next screen.'}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Purchase assistant, n8n daily report…" className="h-11" data-testid="agent-name" /></Field>
          <Field label="Works as" hint={runner ? `It sees and does only what ${runner.name} may: ${ROLE[runner.role] || runner.role}, ${branchText(runner.role, runner.branches).toLowerCase()}.` : ''}>
            <WorksAs users={users} value={f.run_as_user_id} onChange={(v) => setF({ ...f, run_as_user_id: v })} />
          </Field>
          <div className="space-y-1"><p className="text-xs font-medium text-slate-700">What it may do</p><AccessPicker value={f.access} onChange={(v) => setF({ ...f, access: v })} /></div>
          <ExpiryPicker choice={exp} setChoice={setExp} date={f.expires_on} setDate={(v) => setF({ ...f, expires_on: v })} />
          <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-800">More options</summary>
            <div className="mt-3 space-y-3"><ExtraSwitches f={f} setF={setF} />
              <Field label="Note (optional)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What it does, who set it up" className="h-11" /></Field></div></details>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || f.name.trim().length < 2 || !f.run_as_user_id || (exp === 'date' && !f.expires_on)} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="agent-save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : agent ? 'Save' : 'Make the key'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function setupSnippets(links, key) {
  const k = key || '<agent key>';
  return {
    claude_code: `claude mcp add --transport http sensoper ${links.mcp_url} \\\n  --header "Authorization: Bearer ${k}"`,
    desktop: JSON.stringify({ mcpServers: { sensoper: { command: 'npx', args: ['-y', 'mcp-remote', links.mcp_url, '--header', `Authorization: Bearer ${k}`] } } }, null, 2),
    api: JSON.stringify({ mcp_servers: [{ type: 'url', url: links.mcp_url, name: 'sensoper', authorization_token: k }] }, null, 2),
    curl: `curl ${links.api_url}/vendors \\\n  -H "Authorization: Bearer ${k}"`,
  };
}

function SetupGuide({ links, keyValue }) {
  const [tab, setTab] = useState('claude_code');
  const s = setupSnippets(links, keyValue);
  return (
    <div className="space-y-3">
      <PillTabs value={tab} onChange={setTab} testid="setup-tab" tabs={[['claude_code', 'Claude Code'], ['desktop', 'Claude Desktop'], ['api', 'Claude API'], ['other', 'n8n & other MCP'], ['rest', 'REST & scripts']]} />
      {tab === 'claude_code' && <CopyBox label="Run in a terminal" text={s.claude_code} />}
      {tab === 'desktop' && <><CopyBox label="Add to claude_desktop_config.json" text={s.desktop} /><p className="text-[11px] text-slate-500">Needs Node.js. The connector way (Agents tab) needs no key.</p></>}
      {tab === 'api' && <><CopyBox label="Messages API, MCP connector" text={s.api} /><p className="text-[11px] text-slate-500">The Claude Agent SDK takes the same address and header in mcpServers (type “http”).</p></>}
      {tab === 'other' && <div className="space-y-2"><CopyBox label="MCP server address (Streamable HTTP)" text={links.mcp_url} /><CopyBox label="Header" text={`Authorization: Bearer ${keyValue || '<agent key>'}`} />
        <p className="text-[11px] text-slate-500">n8n: add an MCP Client Tool to your AI Agent node. Endpoint = the address above, transport = HTTP Streamable, authentication = Bearer with the key. Cursor, Windsurf and the OpenAI Agents SDK take the same two values.</p></div>}
      {tab === 'rest' && <div className="space-y-2"><CopyBox label="Try it" text={s.curl} /><CopyBox label="API description (OpenAPI), same header" text={links.openapi_url} />
        <p className="text-[11px] text-slate-500">Every /api address works with the key, within the agent’s access. Deletes, bulk changes, logins, bank details and anything that reaches customers answer 403 until you send them again with the header <code>X-Sensoper-Confirm: yes</code>.</p></div>}
    </div>
  );
}

function KeyDialog({ shown, links, onClose }) {
  if (!shown) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl grid-cols-[minmax(0,1fr)] overflow-y-auto" data-testid="agent-key-dialog">
        <DialogHeader><DialogTitle>{shown.title}</DialogTitle><DialogDescription>Copy the key now. Sensoper keeps only a fingerprint of it and can’t show it again.</DialogDescription></DialogHeader>
        <CopyBox label="Agent key" text={shown.key} testid="agent-key-value" />
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Anyone with this key can do what this agent may. Keep it in the tool’s settings or a password manager, not in chats, email or shared code. If it leaks, press New key.</div>
        <div className="space-y-2"><p className="text-sm font-medium text-slate-900">Set it up</p><SetupGuide links={links} keyValue={shown.key} /></div>
        <DialogFooter><Button onClick={onClose} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="agent-key-done">I’ve saved the key</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Steps({ title, items, testid }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid={testid}>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <ol className="mt-2 space-y-2">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-slate-700">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-semibold text-white">{i + 1}</span>
            <span className="min-w-0">{t}</span>
          </li>))}
      </ol>
    </div>
  );
}

function ConnectPanel({ links, off, onSwitchOn, busy }) {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4" data-testid="connect-panel">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-emerald-200"><Plug className="h-5 w-5 text-emerald-700" /></span>
        <div className="min-w-0">
          <h2 className="font-['Outfit'] text-lg font-semibold text-slate-900">Connect Claude or ChatGPT</h2>
          <p className="text-sm text-slate-600">No key to copy. You approve it in Sensoper and choose what it may do.</p>
        </div>
      </div>
      {off && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="min-w-0 flex-1">AI connections are switched off. Switch them on first.</span>
          <Button size="sm" onClick={onSwitchOn} disabled={busy} className="h-9 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="connect-panel-switch-on">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Switch on'}</Button>
        </div>)}
      <div className="mt-3"><CopyBox big label="Connector address" text={links.mcp_url} testid="connect-mcp-url" /></div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Steps title="Claude" testid="connect-steps-claude" items={[
          <>In Claude, open <b>Settings → Connectors</b> and press <b>Add custom connector</b>.</>,
          <>Name it <b>Sensoper</b>, paste the address above, and press <b>Add</b>. Then press <b>Connect</b>.</>,
          <>Sensoper opens. Sign in, choose what Claude may do, and press <b>Allow</b>.</>]} />
        <Steps title="ChatGPT" testid="connect-steps-chatgpt" items={[
          <>In ChatGPT, open <b>Settings → Apps & Connectors → Advanced settings</b> and turn on <b>Developer mode</b>.</>,
          <>Press <b>Create</b>, name it <b>Sensoper</b>, paste the address above, and choose <b>OAuth</b>.</>,
          <>Sensoper opens. Sign in, choose what ChatGPT may do, and press <b>Allow</b>.</>]} />
      </div>
      <p className="mt-3 text-xs text-slate-600">It then shows in the list below. Pause or revoke it any time. Deletes and anything that reaches customers wait for your yes in the chat.</p>
    </section>
  );
}

function AgentCard({ a, onEdit, onToggle, onRotate, onRevoke, onActivity, toggling }) {
  const expired = a.expires_on && a.expires_on < todayISO();
  const paused = a.status === 'paused';
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={`agent-card-${a.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="mr-1 font-medium text-slate-900">{a.name}</p>
        <Chip tone={a.kind === 'connector' ? 'violet' : 'slate'}>{a.kind === 'connector' ? `Connector · ${a.client_name || 'AI app'}` : `Key …${a.key_hint || ''}`}</Chip>
        <Chip tone={ACCESS_TONE[a.access]}>{accessLabel(a.access)}</Chip>
        {paused && <Chip tone="amber">Paused</Chip>}
        {expired && <Chip tone="red">Ended</Chip>}
        {!a.run_as_active && <Chip tone="red">Login closed</Chip>}
        {a.signed_out_at && a.kind === 'connector' && <Chip tone="red">Signed out</Chip>}
      </div>
      <p className="mt-1 text-xs text-slate-600">Works as <b>{a.run_as_name || 'a removed login'}</b>{a.run_as_role ? ` · ${ROLE[a.run_as_role] || a.run_as_role} · ${branchText(a.run_as_role, a.run_as_branches)}` : ''}
        {a.manage_access ? ' · can manage logins' : ''}{a.read_saved_logins ? ' · can read saved passwords' : ''}</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><dt className="text-[11px] text-slate-500">Last used</dt><dd className="font-medium text-slate-800" data-testid={`agent-last-used-${a.id}`}>{ago(a.last_used_at)}</dd></div>
        <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><dt className="text-[11px] text-slate-500">Calls today</dt><dd className="font-medium tabular-nums text-slate-800" data-testid={`agent-calls-today-${a.id}`}>{a.calls_today ?? 0}</dd></div>
        <div className="col-span-2 rounded-lg bg-slate-50 px-2.5 py-1.5 sm:col-span-1"><dt className="text-[11px] text-slate-500">Access ends</dt><dd className="font-medium text-slate-800">{a.expires_on ? fmtDate(a.expires_on) : 'Never'}</dd></div>
      </dl>
      {a.signed_out_reason && a.kind === 'connector' && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 p-2 text-xs text-rose-800"><ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />{a.signed_out_reason}</p>}
      {a.note && <p className="mt-1 text-xs text-slate-500">{a.note}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {!(a.signed_out_at && a.kind === 'connector') && (
          <Button size="sm" variant="outline" className="h-9 gap-1" onClick={onToggle} disabled={toggling} data-testid={`agent-toggle-${a.id}`}>
            {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{paused ? 'Resume' : 'Pause'}</Button>)}
        <Button size="sm" variant="outline" className="h-9 gap-1 text-rose-700 hover:text-rose-800" onClick={onRevoke} data-testid={`agent-remove-${a.id}`}><ShieldOff className="h-3.5 w-3.5" />Revoke</Button>
        <Button size="sm" variant="ghost" className="h-9 gap-1" onClick={onEdit} data-testid={`agent-edit-${a.id}`}><Pencil className="h-3.5 w-3.5" />Edit</Button>
        {a.kind === 'key' && <Button size="sm" variant="ghost" className="h-9 gap-1" onClick={onRotate} data-testid={`agent-rotate-${a.id}`}><RefreshCw className="h-3.5 w-3.5" />New key</Button>}
        <Button size="sm" variant="ghost" className="h-9" onClick={onActivity} data-testid={`agent-activity-${a.id}`}>Activity</Button>
      </div>
    </li>
  );
}

function ConfirmDialog({ confirm, onClose }) {
  const [busy, setBusy] = useState(false);
  if (!confirm) return null;
  const go = async () => { setBusy(true); try { await confirm.run(); onClose(); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); } };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="agent-confirm">
        <DialogHeader><DialogTitle>{confirm.title}</DialogTitle><DialogDescription>{confirm.text}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={go} disabled={busy} className={confirm.danger ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'} data-testid="agent-confirm-go">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : confirm.button}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The address this browser reaches Sensoper at — what AI apps should use too. */
export const browserBase = () => (process.env.REACT_APP_BACKEND_URL || window.location.origin || '').replace(/\/+$/, '');

function AddressBox({ data, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const bad = !data.base_url_https;
  const save = async () => {
    setBusy(true);
    try { const r = await agentsAPI.saveSettings({ public_url: v }); onSaved(r.data); setEditing(false); toast.success('Address saved'); }
    catch (e) { toast.error(errText(e, 'Could not save the address')); } finally { setBusy(false); }
  };
  return (
    <div className={`rounded-xl border p-3 text-sm ${bad ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`} data-testid="agents-address">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {bad ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" /> : <Globe className="h-4 w-4 shrink-0 text-emerald-600" />}
        <span className="min-w-0 flex-1">Sensoper’s web address for AI apps: <b className="break-all" data-testid="agents-address-value">{data.base_url}</b>
          {data.base_url_source === 'env' && <span className="text-xs text-slate-500"> · set by PUBLIC_BASE_URL on the server</span>}</span>
        {data.base_url_source !== 'env' && !editing && (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => { setV(data.base_url_https ? data.base_url : browserBase()); setEditing(true); }} data-testid="agents-address-edit">Change</Button>)}
      </div>
      {bad && <p className="mt-1 text-xs">Claude, ChatGPT and other connectors only accept an <b>https://</b> address. Press Change and enter the address you open Sensoper at, like https://quote.sensoper.in.</p>}
      {editing && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="https://quote.sensoper.in" className="h-10 bg-white" inputMode="url" autoFocus data-testid="agents-address-input" />
          <div className="flex gap-2"><Button onClick={save} disabled={busy || !v.trim()} className="h-10 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="agents-address-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
            <Button variant="outline" className="h-10" onClick={() => setEditing(false)}>Cancel</Button></div>
        </div>)}
    </div>
  );
}

function KeysTab({ links, onAdd }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card title="Your own tools, n8n and scripts" sub="They use a key instead of signing in" testid="connect-keys">
        <ol className="space-y-2 text-sm text-slate-700">
          <li>1. Press <b>Add an API key</b>, choose the login it works as and what it may do.</li>
          <li>2. Copy the key. You see it once.</li>
          <li>3. Paste it into the tool, with the setup on the right.</li>
        </ol>
        <Button onClick={onAdd} variant="outline" className="mt-3 h-10 gap-1.5" data-testid="agent-add-key"><KeyRound className="h-4 w-4" />Add an API key</Button>
      </Card>
      <Card title="Setup" sub="Shown with a placeholder; the key screen fills in the real key"><SetupGuide links={links} /></Card>
    </div>
  );
}

const OUTCOMES = [['all', 'All calls'], ['changes', 'Changes'], ['held', 'Waited for a yes'], ['refused', 'Refused'], ['failed', 'Failed']];

function outcomeOf(r) {
  if (r.status === 428) return ['Waited for a yes', 'violet'];
  if ([401, 403, 429].includes(r.status)) return ['Refused', 'amber'];
  if (r.status >= 500) return ['Failed', 'red'];
  if (r.status >= 400) return ['Failed', 'amber'];
  return ['Done', 'green'];
}

function ActivityTab({ agents, initialAgent, keptDays }) {
  const [agentId, setAgentId] = useState(initialAgent || 'all');
  const [outcome, setOutcome] = useState('all');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [day, setDay] = useState('');
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(null);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const load = useCallback(async (before) => {
    const params = { limit: 100, ...(agentId !== 'all' ? { agent_id: agentId } : {}), ...(outcome !== 'all' ? { outcome } : {}),
      ...(query ? { q: query } : {}), ...(day ? { day } : {}), ...(before ? { before } : {}) };
    try { const r = await agentsAPI.activity(params); setRows((old) => (before ? [...(old || []), ...r.data.rows] : r.data.rows)); setMore(r.data.next_before); }
    catch (e) { toast.error(errText(e)); setRows([]); }
  }, [agentId, outcome, query, day]);
  useEffect(() => { setRows(null); load(); }, [load]);
  useEffect(() => { if (initialAgent) setAgentId(initialAgent); }, [initialAgent]);
  const filtered = agentId !== 'all' || outcome !== 'all' || query || day;
  return (
    <div className="space-y-3" data-testid="agent-activity">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Select value={agentId} onValueChange={setAgentId}><SelectTrigger className="h-10 bg-white" aria-label="Agent" data-testid="activity-agent"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All agents</SelectItem>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
        <Select value={outcome} onValueChange={setOutcome}><SelectTrigger className="h-10 bg-white" aria-label="Show" data-testid="activity-outcome"><SelectValue /></SelectTrigger>
          <SelectContent>{OUTCOMES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
        <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search what it did" className="h-10 bg-white pl-9" aria-label="Search activity" data-testid="activity-search" /></label>
        <input type="date" value={day} max={todayISO()} onChange={(e) => setDay(e.target.value)} className={`${inputCls} h-10`} aria-label="Day" data-testid="activity-day" />
        <Button variant="ghost" size="sm" className="h-10 gap-1" onClick={() => { setRows(null); load(); }}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
      </div>
      {rows === null ? <Loading /> : rows.length === 0 ? <Empty icon={Bot} title={filtered ? 'Nothing matches' : 'Nothing yet'} text={filtered ? 'Try fewer filters.' : `Calls appear here as agents use Sensoper. Kept for ${keptDays || 90} days.`} /> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {rows.map((r, i) => {
            const [label, tone] = outcomeOf(r);
            return (
              <li key={`${r.at}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2.5 text-sm sm:grid-cols-[8.5rem_10rem_minmax(0,1fr)_auto]" data-testid="activity-row">
                <span className="text-[11px] tabular-nums text-slate-500 sm:pt-0.5">{new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
                <span className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 sm:col-start-4">{r.confirmed && <Chip tone="green">You said yes</Chip>}<Chip tone={tone}>{label}</Chip></span>
                <span className="col-span-2 min-w-0 truncate text-xs font-medium text-slate-800 sm:col-span-1 sm:pt-0.5">{r.agent_name}{r.works_as ? <span className="font-normal text-slate-500"> as {r.works_as}</span> : null}</span>
                <span className="col-span-2 min-w-0 sm:col-span-1">
                  <span className="block truncate font-mono text-xs text-slate-700">{r.method === 'TOOL' ? `tool · ${r.path}` : r.method === 'AUTH' ? `sign-in · ${r.path}` : `${r.method} ${r.path}`}{r.query ? <span className="text-slate-400"> ? {r.query}</span> : null}</span>
                  {r.summary && <span className="block truncate text-[11px] text-slate-500">{r.summary}</span>}
                </span>
              </li>);
          })}
        </ul>)}
      {more && <div className="text-center"><Button variant="outline" size="sm" onClick={() => load(more)}>Show older</Button></div>}
      <p className="text-[11px] text-slate-500">Every call is kept for {keptDays || 90} days, without passwords or keys.</p>
    </div>
  );
}

export default function AIAgentsPage() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') || 'agents';
  const tab = rawTab === 'connect' ? 'keys' : rawTab;
  const setTab = (t, extra = {}) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); Object.entries(extra).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; }, { replace: true });
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [dlg, setDlg] = useState(null);           // {agent} | {} for new
  const [shownKey, setShownKey] = useState(null); // {title, key}
  const [confirm, setConfirm] = useState(null);
  const [savingSwitch, setSavingSwitch] = useState(false);
  const [toggling, setToggling] = useState('');
  const load = useCallback(() => agentsAPI.list().then((r) => setData(r.data)).catch((e) => { toast.error(errText(e, 'Could not load AI agents')); setData(false); }), []);
  useEffect(() => { load(); agentsAPI.users().then((r) => setUsers(r.data || [])).catch(() => setUsers([])); }, [load]);
  const links = useMemo(() => (data ? { mcp_url: data.mcp_url, api_url: data.api_url, openapi_url: data.openapi_url } : {}), [data]);
  const { user } = useAuth();
  const meId = user?.id;
  // First visit: remember the https address this browser uses, so AI apps are never sent to http:// or to the
  // server's own 127.0.0.1 (which happens when nginx doesn't pass the Host / X-Forwarded-Proto headers).
  const triedAddress = useRef(false);
  useEffect(() => {
    if (!data || data.base_url_source !== 'auto' || triedAddress.current) return;
    const mine = browserBase();
    if (!mine.startsWith('https://')) return;
    triedAddress.current = true;
    agentsAPI.saveSettings({ public_url: mine }).then((r) => setData((d) => ({ ...d, ...r.data }))).catch(() => {});
  }, [data]);
  if (data === null) return <div className="px-4 py-6"><Loading /></div>;
  if (!data) return <div className="px-4 py-6"><Empty title="Could not load AI agents" /></div>;
  const saveSwitches = async (patch) => {
    setSavingSwitch(true);
    try { const r = await agentsAPI.saveSettings(patch); setData((d) => ({ ...d, ...r.data })); toast.success(Object.values(patch).every(Boolean) ? 'Switched on' : 'Switched off'); }
    catch (e) { toast.error(errText(e)); } finally { setSavingSwitch(false); }
  };
  const agents = data.agents || [];
  const toggle = async (a) => {
    setToggling(a.id);
    try { await agentsAPI.update(a.id, { status: a.status === 'paused' ? 'active' : 'paused' }); toast.success(a.status === 'paused' ? `${a.name} works again` : `${a.name} is paused`); await load(); }
    catch (e) { toast.error(errText(e)); } finally { setToggling(''); }
  };
  return (
    <div className="px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader icon={Bot} title="AI agents" sub="Let Claude, ChatGPT or your own tools work in Sensoper as a login you choose, with only the access you give" testid="ai-agents-page">
          <Button variant="outline" onClick={() => setDlg({})} className="h-10 gap-1.5" data-testid="agent-add"><Plus className="h-4 w-4" />Add an API key</Button>
        </PageHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className={`flex items-start justify-between gap-3 rounded-2xl border p-4 ${data.enabled ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
            <div><p className="font-medium text-slate-900">Let AI agents connect</p>
              <p className="text-xs text-slate-600">{data.enabled ? 'On. Agents below work within their access.' : 'Off. Every key and connector is refused until you switch this on.'}</p></div>
            <Switch checked={!!data.enabled} disabled={savingSwitch} onCheckedChange={(v) => saveSwitches({ enabled: v })} aria-label="Let AI agents connect" data-testid="agents-enabled" />
          </div>
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div><p className="font-medium text-slate-900">Allow Claude and ChatGPT</p>
              <p className="text-xs text-slate-600">They sign in through Sensoper and an admin approves each one. Off stops them at once; keys keep working.</p></div>
            <Switch checked={!!data.allow_connectors} disabled={savingSwitch || !data.enabled} onCheckedChange={(v) => saveSwitches({ allow_connectors: v })} aria-label="Allow Claude and ChatGPT" data-testid="agents-connectors" />
          </div>
        </div>
        {!data.base_url_https && <AddressBox data={data} onSaved={(r) => setData((d) => ({ ...d, ...r }))} />}
        <PillTabs value={tab} onChange={(t) => setTab(t, { agent: null })} testid="agents-tab" tabs={[['agents', `Agents (${agents.length})`], ['activity', 'Activity'], ['keys', 'Keys & scripts']]} />
        {tab === 'agents' && (
          <div className="space-y-4">
            <ConnectPanel links={links} off={!(data.enabled && data.allow_connectors)} busy={savingSwitch} onSwitchOn={() => saveSwitches({ enabled: true, allow_connectors: true })} />
            {agents.length === 0
              ? <Empty icon={Plug} title="No AI agents yet" text="Connect Claude or ChatGPT with the steps above, or add an API key for your own tools." />
              : <ul className="grid gap-3 lg:grid-cols-2" data-testid="agent-list">{agents.map((a) => (
                <AgentCard key={a.id} a={a} toggling={toggling === a.id} onEdit={() => setDlg({ agent: a })} onActivity={() => setTab('activity', { agent: a.id })}
                  onToggle={() => toggle(a)}
                  onRotate={() => setConfirm({ title: `New key for ${a.name}?`, text: 'The old key stops working at once. Put the new key into the tool.', button: 'Make a new key',
                    run: async () => { const r = await agentsAPI.rotate(a.id); setShownKey({ title: `New key for ${a.name}`, key: r.data.key }); load(); } })}
                  onRevoke={() => setConfirm({ title: `Revoke ${a.name}?`, text: a.kind === 'connector'
                    ? `${a.client_name || 'The app'} is signed out at once and can’t use Sensoper until someone connects it again. Its activity stays in the log.`
                    : 'Its key stops working at once. Its activity stays in the log.', button: 'Revoke', danger: true,
                    run: async () => { await agentsAPI.remove(a.id); toast.success(`${a.name} is revoked`); load(); } })} />))}</ul>}
            {!data.enabled && agents.length > 0 && <p className="flex items-center gap-1.5 text-xs text-amber-800"><KeyRound className="h-3.5 w-3.5" />Agents are switched off. Switch on “Let AI agents connect” above.</p>}
          </div>)}
        {tab === 'keys' && (
          <div className="space-y-3">
            {data.base_url_https && <AddressBox data={data} onSaved={(r) => setData((d) => ({ ...d, ...r }))} />}
            <KeysTab links={links} onAdd={() => setDlg({})} />
          </div>)}
        {tab === 'activity' && <ActivityTab agents={agents} initialAgent={params.get('agent')} keptDays={data.activity_days} />}
      </div>
      <AgentDialog open={!!dlg} agent={dlg?.agent} users={users} meId={meId} onOpenChange={(o) => !o && setDlg(null)}
        onSaved={(created) => { load(); if (created) setShownKey({ title: `${created.agent.name} is ready`, key: created.key }); }} />
      <KeyDialog shown={shownKey} links={links} onClose={() => setShownKey(null)} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
