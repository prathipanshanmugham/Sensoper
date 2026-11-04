/* Settings → AI agents (admins). Each agent works as a chosen login with the access given here: read only, read &
 * write, or full control. Keys for your own agents and n8n; Claude / ChatGPT connect as a custom connector (MCP) and
 * are approved on /connect-agent. Every call an agent makes is listed under Activity. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Bot, Check, Copy, Globe, KeyRound, Loader2, Pause, Pencil, Play, Plug, Plus, RefreshCw, Trash2 } from 'lucide-react';
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
  ['full', 'Full control', 'Everything the login can do, deleting too.'],
];
const accessLabel = (k) => (ACCESS.find((a) => a[0] === k) || [k, k])[1];
const ACCESS_TONE = { read: 'slate', write: 'blue', full: 'amber' };
const ROLE = { admin: 'Admin', manager: 'Manager', staff: 'Staff' };

export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function CopyBox({ text, label, mono = true, testid }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }
    catch { toast.error('Could not copy — select the text and copy it'); }
  };
  return (
    <div className="space-y-1">
      {label && <p className="text-xs font-medium text-slate-700">{label}</p>}
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <pre className={`min-w-0 flex-1 whitespace-pre-wrap break-all text-xs text-slate-800 ${mono ? 'font-mono' : ''}`} data-testid={testid}>{text}</pre>
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 gap-1 bg-white" onClick={copy} aria-label={`Copy ${label || 'text'}`}>
          {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}{done ? 'Copied' : 'Copy'}
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
        ['read_saved_logins', 'Read saved passwords', 'Open passwords kept in Company logins.']].map(([k, label, what]) => (
        <div key={k} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
          <div><p className="text-sm font-medium text-slate-900">{label}</p><p className="text-[11px] text-slate-500">{what} Off unless you need it.</p></div>
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

const EXPIRY = [['never', 'Never'], ['30', 'In 30 days'], ['90', 'In 90 days'], ['365', 'In a year'], ['date', 'On a date…']];

function AgentDialog({ open, agent, users, meId, onOpenChange, onSaved }) {
  const [f, setF] = useState(null);
  const [exp, setExp] = useState('never');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(agent ? { name: agent.name, run_as_user_id: agent.run_as_user_id, access: agent.access, manage_access: agent.manage_access,
      read_saved_logins: agent.read_saved_logins, expires_on: agent.expires_on || '', note: agent.note || '' }
      : { name: '', run_as_user_id: meId, access: 'write', manage_access: false, read_saved_logins: false, expires_on: '', note: '' });
    setExp(agent?.expires_on ? 'date' : 'never');
  }, [open, agent, meId]);
  if (!open || !f) return null;
  const expiresOn = exp === 'never' ? null : exp === 'date' ? (f.expires_on || null) : addDaysISO(todayISO(), Number(exp));
  const save = async () => {
    setSaving(true);
    const body = { ...f, expires_on: expiresOn };
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
        <DialogHeader><DialogTitle>{agent ? `Edit ${agent.name}` : 'Add an AI agent'}</DialogTitle>
          <DialogDescription>{agent ? 'Changes apply to its next call.' : 'You get a key for it on the next screen. It is shown once.'}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Purchase assistant, n8n daily report…" className="h-11" data-testid="agent-name" /></Field>
          <Field label="Works as" hint={runner ? `It sees and does what ${runner.name} (${ROLE[runner.role] || runner.role}) may — that login’s permissions and branches apply.` : ''}>
            <WorksAs users={users} value={f.run_as_user_id} onChange={(v) => setF({ ...f, run_as_user_id: v })} />
          </Field>
          <div className="space-y-1"><p className="text-xs font-medium text-slate-700">Access</p><AccessPicker value={f.access} onChange={(v) => setF({ ...f, access: v })} /></div>
          <ExtraSwitches f={f} setF={setF} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Key stops working">
              <Select value={exp} onValueChange={setExp}><SelectTrigger className="h-11" data-testid="agent-expiry"><SelectValue /></SelectTrigger>
                <SelectContent>{EXPIRY.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
            </Field>
            {exp === 'date' ? <Field label="Date"><input type="date" min={todayISO()} value={f.expires_on || ''} onChange={(e) => setF({ ...f, expires_on: e.target.value })} className={inputCls} /></Field>
              : <p className="self-end pb-3 text-xs text-slate-500">{expiresOn ? `Last day ${fmtDate(expiresOn)}` : 'Until you remove it'}</p>}
          </div>
          <Field label="Note (optional)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What it does, who set it up" className="h-11" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || f.name.trim().length < 2 || !f.run_as_user_id || (exp === 'date' && !f.expires_on)} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="agent-save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : agent ? 'Save' : 'Add agent'}</Button></DialogFooter>
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
      <PillTabs value={tab} onChange={setTab} testid="setup-tab" tabs={[['claude_code', 'Claude Code'], ['desktop', 'Claude Desktop'], ['api', 'Claude API / Agent SDK'], ['other', 'n8n & other MCP'], ['rest', 'REST / scripts']]} />
      {tab === 'claude_code' && <CopyBox label="Run in a terminal" text={s.claude_code} />}
      {tab === 'desktop' && <><CopyBox label="Add to claude_desktop_config.json" text={s.desktop} /><p className="text-[11px] text-slate-500">Needs Node.js. Or use the connector way under Claude (web, desktop, phone) — no key needed.</p></>}
      {tab === 'api' && <><CopyBox label="Messages API — MCP connector" text={s.api} /><p className="text-[11px] text-slate-500">The Claude Agent SDK takes the same URL and header in its mcpServers option (type “http”).</p></>}
      {tab === 'other' && <div className="space-y-2"><CopyBox label="MCP server address (Streamable HTTP)" text={links.mcp_url} /><CopyBox label="Header" text={`Authorization: Bearer ${keyValue || '<agent key>'}`} />
        <p className="text-[11px] text-slate-500">n8n: add an “MCP Client Tool” to your AI Agent node → Endpoint = the address above, Server transport = HTTP Streamable, Authentication = Bearer → the key. Cursor, Windsurf, OpenAI Agents SDK and others take the same two values.</p></div>}
      {tab === 'rest' && <div className="space-y-2"><CopyBox label="Try it" text={s.curl} /><CopyBox label="API description (OpenAPI) — send the same header" text={links.openapi_url} />
        <p className="text-[11px] text-slate-500">Every /api address of the app works with the key, within this agent’s access.</p></div>}
    </div>
  );
}

function KeyDialog({ shown, links, onClose }) {
  if (!shown) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl grid-cols-[minmax(0,1fr)] overflow-y-auto" data-testid="agent-key-dialog">
        <DialogHeader><DialogTitle>{shown.title}</DialogTitle><DialogDescription>Copy the key now — Sensoper keeps only a fingerprint of it and can’t show it again.</DialogDescription></DialogHeader>
        <CopyBox label="Agent key" text={shown.key} testid="agent-key-value" />
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Anyone with this key can do what this agent may. Keep it in the agent’s settings or a password manager — not in chats, email or code you share. If it leaks, press New key.</div>
        <div className="space-y-2"><p className="text-sm font-medium text-slate-900">Set it up</p><SetupGuide links={links} keyValue={shown.key} /></div>
        <DialogFooter><Button onClick={onClose} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="agent-key-done">I’ve saved the key</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentCard({ a, onEdit, onToggle, onRotate, onRemove, onActivity }) {
  const expired = a.expires_on && a.expires_on < todayISO();
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={`agent-card-${a.id}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-medium text-slate-900">{a.name}</p>
            <Chip tone={a.kind === 'connector' ? 'violet' : 'slate'}>{a.kind === 'connector' ? `Connector · ${a.client_name || 'AI app'}` : `Key …${a.key_hint || ''}`}</Chip>
            <Chip tone={ACCESS_TONE[a.access]}>{accessLabel(a.access)}</Chip>
            {a.status === 'paused' && <Chip tone="amber">Paused</Chip>}
            {expired && <Chip tone="red">Expired</Chip>}
            {!a.run_as_active && <Chip tone="red">Login closed</Chip>}
          </div>
          <p className="mt-1 text-xs text-slate-600">Works as <b>{a.run_as_name || 'a removed login'}</b>{a.run_as_role ? ` · ${ROLE[a.run_as_role] || a.run_as_role}` : ''}
            {a.manage_access ? ' · can manage logins' : ''}{a.read_saved_logins ? ' · can read saved passwords' : ''}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Last used {ago(a.last_used_at)} · {a.calls_24h} call{a.calls_24h === 1 ? '' : 's'} in 24 h{a.expires_on ? ` · ${expired ? 'ended' : 'ends'} ${fmtDate(a.expires_on)}` : ''} · added by {a.created_by_name || '—'}</p>
          {a.note && <p className="mt-1 text-xs text-slate-500">{a.note}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="h-9 gap-1" onClick={onEdit} data-testid={`agent-edit-${a.id}`}><Pencil className="h-3.5 w-3.5" />Edit</Button>
        <Button size="sm" variant="outline" className="h-9 gap-1" onClick={onToggle} data-testid={`agent-toggle-${a.id}`}>{a.status === 'paused' ? <><Play className="h-3.5 w-3.5" />Resume</> : <><Pause className="h-3.5 w-3.5" />Pause</>}</Button>
        {a.kind === 'key' && <Button size="sm" variant="outline" className="h-9 gap-1" onClick={onRotate} data-testid={`agent-rotate-${a.id}`}><RefreshCw className="h-3.5 w-3.5" />New key</Button>}
        <Button size="sm" variant="ghost" className="h-9" onClick={onActivity}>Activity</Button>
        <Button size="sm" variant="ghost" className="ml-auto h-9 gap-1 text-rose-600 hover:text-rose-700" onClick={onRemove} data-testid={`agent-remove-${a.id}`}><Trash2 className="h-3.5 w-3.5" />Remove</Button>
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

function ConnectTab({ links }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Claude or ChatGPT (web, desktop, phone)" sub="No key to copy — you approve the connection here" testid="connect-connector">
        <ol className="list-decimal space-y-1.5 pl-4 text-sm text-slate-700">
          <li>In Claude: <b>Settings → Connectors → Add custom connector</b>. ChatGPT (developer mode) and other apps with custom connectors work the same way.</li>
          <li>Name it <b>Sensoper</b> and paste this address:</li>
        </ol>
        <div className="mt-2"><CopyBox text={links.mcp_url} testid="connect-mcp-url" /></div>
        <ol start={3} className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-slate-700">
          <li>Press <b>Connect</b>. Sensoper opens — sign in as an admin, choose what it may do, and press <b>Allow</b>.</li>
          <li>It appears in the list here as a connector. Pause or remove it any time.</li>
        </ol>
        <p className="mt-2 text-[11px] text-slate-500">If the app says it can’t find the sign-in page, the server needs the one-time nginx step in DEPLOY.md (“AI agents”).</p>
      </Card>
      <Card title="Your own agents, n8n, scripts" sub="Add an agent to get its key, then use one of these" testid="connect-keys">
        <SetupGuide links={links} />
      </Card>
    </div>
  );
}

function ActivityTab({ agents, initialAgent }) {
  const [agentId, setAgentId] = useState(initialAgent || 'all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(null);
  const load = useCallback(async (before) => {
    const params = { limit: 100, ...(agentId !== 'all' ? { agent_id: agentId } : {}), ...(errorsOnly ? { errors_only: true } : {}), ...(before ? { before } : {}) };
    try { const r = await agentsAPI.activity(params); setRows((old) => (before ? [...(old || []), ...r.data.rows] : r.data.rows)); setMore(r.data.next_before); }
    catch (e) { toast.error(errText(e)); setRows([]); }
  }, [agentId, errorsOnly]);
  useEffect(() => { setRows(null); load(); }, [load]);
  useEffect(() => { if (initialAgent) setAgentId(initialAgent); }, [initialAgent]);
  const tone = (s) => (s >= 500 ? 'red' : s >= 400 ? 'amber' : 'green');
  return (
    <div className="space-y-3" data-testid="agent-activity">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56"><Select value={agentId} onValueChange={setAgentId}><SelectTrigger className="h-10 bg-white" aria-label="Agent"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All agents</SelectItem>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><Switch checked={errorsOnly} onCheckedChange={setErrorsOnly} aria-label="Only refused or failed" />Only refused or failed</label>
        <Button variant="ghost" size="sm" className="ml-auto h-9 gap-1" onClick={() => { setRows(null); load(); }}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
      </div>
      {rows === null ? <Loading /> : rows.length === 0 ? <Empty icon={Bot} title="Nothing yet" text="Calls appear here as agents use Sensoper. Kept for 90 days." /> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {rows.map((r, i) => (
            <li key={`${r.at}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span className="w-32 shrink-0 text-[11px] tabular-nums text-slate-500">{new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
              <span className="w-36 shrink-0 truncate text-xs font-medium text-slate-800">{r.agent_name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{r.method === 'TOOL' ? `tool · ${r.path}` : `${r.method} ${r.path}`}</span>
              <span className="flex items-center gap-1.5">{r.via === 'mcp' && <Chip tone="violet">MCP</Chip>}<Chip tone={tone(r.status)}>{r.status}</Chip><span className="w-12 text-right text-[11px] tabular-nums text-slate-400">{r.ms} ms</span></span>
            </li>))}
        </ul>)}
      {more && <div className="text-center"><Button variant="outline" size="sm" onClick={() => load(more)}>Show older</Button></div>}
    </div>
  );
}

export default function AIAgentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'agents';
  const setTab = (t, extra = {}) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); Object.entries(extra).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; }, { replace: true });
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [dlg, setDlg] = useState(null);           // {agent} | {} for new
  const [shownKey, setShownKey] = useState(null); // {title, key}
  const [confirm, setConfirm] = useState(null);
  const [savingSwitch, setSavingSwitch] = useState(false);
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
  const toggleSetting = async (k, v) => {
    setSavingSwitch(true);
    try { const r = await agentsAPI.saveSettings({ [k]: v }); setData((d) => ({ ...d, ...r.data })); toast.success(v ? 'Switched on' : 'Switched off'); }
    catch (e) { toast.error(errText(e)); } finally { setSavingSwitch(false); }
  };
  const agents = data.agents || [];
  return (
    <div className="px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader icon={Bot} title="AI agents" sub="Let AI agents work with Sensoper — each as a chosen login, with only the access you give it" testid="ai-agents-page">
          <Button onClick={() => setDlg({})} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="agent-add"><Plus className="h-4 w-4" />Add an agent</Button>
        </PageHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className={`flex items-start justify-between gap-3 rounded-2xl border p-4 ${data.enabled ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
            <div><p className="font-medium text-slate-900">Let AI agents connect</p>
              <p className="text-xs text-slate-600">{data.enabled ? 'On — agents below can work within their access.' : 'Off — every key and connector is refused until you switch this on.'}</p></div>
            <Switch checked={!!data.enabled} disabled={savingSwitch} onCheckedChange={(v) => toggleSetting('enabled', v)} aria-label="Let AI agents connect" data-testid="agents-enabled" />
          </div>
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div><p className="font-medium text-slate-900">Allow Claude / ChatGPT connectors</p>
              <p className="text-xs text-slate-600">They sign in through Sensoper and an admin approves each one. Off stops all connectors; keys keep working.</p></div>
            <Switch checked={!!data.allow_connectors} disabled={savingSwitch || !data.enabled} onCheckedChange={(v) => toggleSetting('allow_connectors', v)} aria-label="Allow connectors" data-testid="agents-connectors" />
          </div>
        </div>
        {(tab === 'connect' || !data.base_url_https) && <AddressBox data={data} onSaved={(r) => setData((d) => ({ ...d, ...r }))} />}
        <PillTabs value={tab} onChange={(t) => setTab(t, { agent: null })} testid="agents-tab" tabs={[['agents', `Agents (${agents.length})`], ['connect', 'Connect'], ['activity', 'Activity']]} />
        {tab === 'agents' && (agents.length === 0
          ? <Empty icon={Plug} title="No AI agents yet" text="Add one for your own agent or n8n, or connect Claude / ChatGPT from the Connect tab." />
          : <ul className="grid gap-3 lg:grid-cols-2" data-testid="agent-list">{agents.map((a) => (
            <AgentCard key={a.id} a={a} onEdit={() => setDlg({ agent: a })} onActivity={() => setTab('activity', { agent: a.id })}
              onToggle={async () => { try { await agentsAPI.update(a.id, { status: a.status === 'paused' ? 'active' : 'paused' }); load(); } catch (e) { toast.error(errText(e)); } }}
              onRotate={() => setConfirm({ title: `New key for ${a.name}?`, text: 'The old key stops working straight away. Put the new key into the agent.', button: 'Make a new key',
                run: async () => { const r = await agentsAPI.rotate(a.id); setShownKey({ title: `New key for ${a.name}`, key: r.data.key }); load(); } })}
              onRemove={() => setConfirm({ title: `Remove ${a.name}?`, text: 'Its key or connection stops working now. Its activity stays in the log.', button: 'Remove', danger: true,
                run: async () => { await agentsAPI.remove(a.id); toast.success('Removed'); load(); } })} />))}</ul>)}
        {tab === 'connect' && <ConnectTab links={links} />}
        {tab === 'activity' && <ActivityTab agents={agents} initialAgent={params.get('agent')} />}
        {!data.enabled && agents.length > 0 && tab === 'agents' && <p className="flex items-center gap-1.5 text-xs text-amber-800"><KeyRound className="h-3.5 w-3.5" />Agents are switched off — switch on “Let AI agents connect” above.</p>}
      </div>
      <AgentDialog open={!!dlg} agent={dlg?.agent} users={users} meId={meId} onOpenChange={(o) => !o && setDlg(null)}
        onSaved={(created) => { load(); if (created) setShownKey({ title: `${created.agent.name} is ready`, key: created.key }); }} />
      <KeyDialog shown={shownKey} links={links} onClose={() => setShownKey(null)} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
