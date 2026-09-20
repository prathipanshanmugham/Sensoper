import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { sensobrainAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { toast } from 'sonner';
import { Brain, Send, Loader2, Plus, Eye, Wrench, Settings, ScrollText, Coins, Save, ShieldCheck } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL;
const SUGGESTIONS = ['What system size suits a customer with a ₹3,000 monthly bill in Erode?', 'எந்த திட்டங்கள் இன்னும் draft நிலையில் உள்ளன?', 'Which inventory items are low on stock?', 'Show overdue customer credits and their interest cost'];

function ChatPane() {
  const [convos, setConvos] = useState([]);
  const [convoId, setConvoId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const bottomRef = useRef(null);

  const loadConvos = useCallback(() => sensobrainAPI.conversations().then(r => setConvos(r.data)).catch(() => {}), []);
  useEffect(() => { loadConvos(); sensobrainAPI.status().then(r => setStatus(r.data)).catch(() => {}); }, [loadConvos]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const openConvo = async (id) => {
    try { const r = await sensobrainAPI.conversation(id); setConvoId(id); setMessages(r.data.messages || []); } catch { toast.error('Could not open conversation'); }
  };
  const newChat = () => { setConvoId(null); setMessages([]); };

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput(''); setBusy(true);
    setMessages(m => [...m, { role: 'user', content: msg }, { role: 'assistant', content: '', tools_used: [], streaming: true }]);
    try {
      const res = await fetch(`${API_URL}/api/sensobrain/chat`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, conversation_id: convoId }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || `HTTP ${res.status}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      const patch = (fn) => setMessages(m => { const c = [...m]; c[c.length - 1] = fn({ ...c[c.length - 1] }); return c; });
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop();
        for (const p of parts) {
          if (!p.startsWith('data: ')) continue;
          const ev = JSON.parse(p.slice(6));
          if (ev.type === 'start') setConvoId(ev.conversation_id);
          else if (ev.type === 'delta') patch(a => ({ ...a, content: a.content + ev.content }));
          else if (ev.type === 'tool') patch(a => ({ ...a, tools_used: [...(a.tools_used || []), { name: ev.name }] }));
          else if (ev.type === 'error') patch(a => ({ ...a, content: (a.content || '') + `\n\n⚠️ ${ev.message}` }));
          else if (ev.type === 'done') patch(a => ({ ...a, streaming: false, cost_inr: ev.cost_inr, input_tokens: ev.input_tokens, output_tokens: ev.output_tokens }));
        }
      }
    } catch (e) {
      setMessages(m => { const c = [...m]; c[c.length - 1] = { role: 'assistant', content: `⚠️ ${e.message}`, streaming: false }; return c; });
    } finally { setBusy(false); loadConvos(); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-3" data-testid="sensobrain-chat">
      <Card className="border-slate-200 lg:col-span-1"><CardContent className="p-2 space-y-1">
        <Button variant="outline" size="sm" className="w-full gap-1 h-8 text-xs" onClick={newChat} data-testid="sensobrain-new-chat"><Plus className="h-3.5 w-3.5" />New chat</Button>
        <div className="max-h-[60vh] overflow-y-auto space-y-0.5">
          {convos.map(c => (
            <button key={c.id} onClick={() => openConvo(c.id)} className={`w-full text-left px-2 py-1.5 rounded text-xs truncate ${c.id === convoId ? 'bg-emerald-50 text-emerald-800 font-medium' : 'text-slate-600 hover:bg-slate-50'}`} data-testid={`sensobrain-convo-${c.id}`}>{c.title}</button>
          ))}
          {convos.length === 0 && <p className="text-[11px] text-slate-400 px-2 py-3">No conversations yet.</p>}
        </div>
      </CardContent></Card>

      <Card className="border-slate-200 lg:col-span-3 flex flex-col"><CardContent className="p-0 flex flex-col h-[70vh]">
        <div className="px-3 py-1.5 border-b border-amber-200 bg-amber-50 text-[11px] text-amber-800 flex items-center gap-1.5" data-testid="sensobrain-logging-notice">
          <Eye className="h-3.5 w-3.5 shrink-0" />All Sensobrain conversations are logged (who asked, when, and which data was used) and are reviewable by admins. Answers only use data your role and location already permit.
        </div>
        {status && !status.configured && <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200" data-testid="sensobrain-not-configured">Sensobrain is not configured yet — an admin must add the OpenAI API key under Settings.</div>}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center pt-8 space-y-3">
              <Brain className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="text-sm text-slate-600">Ask about projects, customers, stock, prices, credits — in English or தமிழ்.</p>
              <div className="flex flex-wrap justify-center gap-1.5">{SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:border-emerald-400 text-slate-600" data-testid="sensobrain-suggestion">{s}</button>)}</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`} data-testid={`sensobrain-msg-${m.role}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                {m.content || (m.streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : '')}
                {m.role === 'assistant' && (m.tools_used?.length > 0 || m.cost_inr != null) && (
                  <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                    {(m.tools_used || []).map((t, j) => <Badge key={j} variant="outline" className="text-[9px] gap-0.5"><Wrench className="h-2.5 w-2.5" />{t.name}</Badge>)}
                    {m.cost_inr != null && <span className="text-[10px] text-slate-400 ml-1" data-testid="sensobrain-msg-cost">{m.input_tokens + m.output_tokens} tokens · ₹{m.cost_inr.toFixed(3)}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={e => { e.preventDefault(); send(); }} className="border-t border-slate-200 p-2 flex gap-2">
          <Textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Type in English or Tamil… (Enter to send, Shift+Enter for newline)" rows={1} className="min-h-[40px] max-h-32 resize-none text-sm" data-testid="sensobrain-input" />
          <Button type="submit" disabled={busy || !input.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white h-10 w-10 p-0" data-testid="sensobrain-send">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
        </form>
      </CardContent></Card>
    </div>
  );
}

function SettingsPane() {
  const [s, setS] = useState(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [fx, setFx] = useState('');
  const [excluded, setExcluded] = useState('');
  const [pricing, setPricing] = useState({});
  const [usage, setUsage] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const [a, u] = await Promise.all([sensobrainAPI.settings(), sensobrainAPI.usage()]);
      setS(a.data); setModel(a.data.model); setFx(String(a.data.usd_to_inr)); setExcluded(a.data.excluded_paths.join('\n')); setPricing(a.data.pricing); setUsage(u.data);
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load settings'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setSaving(true);
    try {
      await sensobrainAPI.saveSettings({ openai_api_key: key || undefined, model, usd_to_inr: parseFloat(fx), excluded_paths: excluded.split('\n').map(x => x.trim()).filter(Boolean), pricing });
      toast.success('Settings saved'); setKey(''); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };
  if (!s) return <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />;
  const Bucket = ({ label, b }) => (
    <div className="rounded-lg border border-slate-200 p-3" data-testid={`sensobrain-usage-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-xl font-bold text-slate-900">₹{b.cost_inr.toLocaleString('en-IN')}</p>
      <p className="text-[11px] text-slate-500">${b.cost_usd} · {b.requests} requests · {(b.input_tokens + b.output_tokens).toLocaleString('en-IN')} tokens</p>
    </div>
  );
  return (
    <div className="space-y-4" data-testid="sensobrain-settings">
      {usage && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Bucket label="Today" b={usage.today} /><Bucket label="This month" b={usage.this_month} /><Bucket label="All time" b={usage.all_time} /></div>}
      <Card className="border-slate-200"><CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">OpenAI API key {s.api_key_configured && <Badge className="ml-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]" data-testid="sensobrain-key-status">configured · {s.api_key_hint}</Badge>}</Label><Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={s.api_key_configured ? 'Paste a new key to replace' : 'sk-…'} className="h-9" data-testid="sensobrain-api-key" /><p className="text-[10px] text-slate-400">Stored encrypted (same Fernet key as the Credential Vault). Never shown again in full.</p></div>
          <div className="space-y-1"><Label className="text-xs">Model</Label><Input value={model} onChange={e => setModel(e.target.value)} className="h-9" data-testid="sensobrain-model" /><p className="text-[10px] text-slate-400">Priced models: {Object.keys(pricing).join(', ')}</p></div>
          <div className="space-y-1"><Label className="text-xs">USD → INR rate (for cost display)</Label><Input type="number" value={fx} onChange={e => setFx(e.target.value)} className="h-9" data-testid="sensobrain-fx" /></div>
          <div className="space-y-1"><Label className="text-xs">Pricing for {model} (USD per 1M tokens)</Label>
            <div className="flex gap-2"><Input type="number" step="0.01" value={pricing[model]?.input ?? ''} onChange={e => setPricing(p => ({ ...p, [model]: { ...(p[model] || { output: 0 }), input: parseFloat(e.target.value) || 0 } }))} placeholder="input" className="h-9" data-testid="sensobrain-price-input" /><Input type="number" step="0.01" value={pricing[model]?.output ?? ''} onChange={e => setPricing(p => ({ ...p, [model]: { ...(p[model] || { input: 0 }), output: parseFloat(e.target.value) || 0 } }))} placeholder="output" className="h-9" data-testid="sensobrain-price-output" /></div>
          </div>
        </div>
        <div className="space-y-1"><Label className="text-xs flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />Excluded data sources (one API path prefix per line)</Label>
          <Textarea value={excluded} onChange={e => setExcluded(e.target.value)} rows={3} className="text-xs font-mono" data-testid="sensobrain-excluded" />
          <p className="text-[10px] text-slate-500">Always blocked regardless of this list: <span className="font-mono">{s.hard_blocked.join('  ')}</span></p>
        </div>
        <div className="flex justify-end"><Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid="sensobrain-save-settings">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</Button></div>
      </CardContent></Card>
      {usage?.by_user?.length > 0 && <Card className="border-slate-200"><CardContent className="p-3"><p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Cost by user (all time)</p>{usage.by_user.map((u, i) => <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-100"><span>{u.user_name}</span><span>{u.requests} req · ${u.cost_usd.toFixed(4)}</span></div>)}</CardContent></Card>}
    </div>
  );
}

function LogsPane() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => {
    try { const r = await sensobrainAPI.adminConversations({ q: q || undefined, date_from: from || undefined, date_to: to || undefined, user_id: userFilter || undefined }); setRows(r.data); } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  }, [q, from, to, userFilter]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  const users = Array.from(new Map(rows.map(r => [r.user_id, r.user_name])).entries());
  return (
    <div className="space-y-3" data-testid="sensobrain-logs">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search transcripts…" className="h-9" data-testid="sensobrain-log-search" />
        <select value={userFilter} onChange={e => setUserFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 text-sm px-2" data-testid="sensobrain-log-user"><option value="">All users</option>{users.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9" data-testid="sensobrain-log-from" />
        <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9" data-testid="sensobrain-log-to" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="border-slate-200"><CardContent className="p-0 max-h-[60vh] overflow-y-auto">
          {rows.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No conversations match.</p> : rows.map(r => (
            <button key={r.id} onClick={async () => { const d = await sensobrainAPI.conversation(r.id); setOpen(d.data); }} className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50 ${open?.id === r.id ? 'bg-emerald-50' : ''}`} data-testid={`sensobrain-log-row-${r.id}`}>
              <p className="text-sm font-medium text-slate-900 truncate">{r.title}</p>
              <p className="text-[11px] text-slate-500">{r.user_name} · {r.role} · {r.updated_at?.slice(0, 16).replace('T', ' ')} · {r.message_count} msgs · ${r.total_cost_usd}</p>
            </button>
          ))}
        </CardContent></Card>
        <Card className="border-slate-200"><CardContent className="p-3 max-h-[60vh] overflow-y-auto space-y-2" data-testid="sensobrain-log-transcript">
          {!open ? <p className="text-sm text-slate-400 text-center py-8">Select a conversation to read the transcript.</p> : open.messages.map((m, i) => (
            <div key={i} className={`text-sm rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-100 text-slate-800'}`}>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">{m.role} · {m.ts?.slice(0, 19).replace('T', ' ')}{m.tools_used?.length ? ` · data: ${m.tools_used.map(t => t.name).join(', ')}` : ''}</p>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ))}
        </CardContent></Card>
      </div>
    </div>
  );
}

export default function SensobrainPage() {
  const { isAdmin } = useAuth();
  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4" data-testid="sensobrain-page">
      <div>
        <h1 className="text-2xl font-bold font-['Outfit'] flex items-center gap-2"><Brain className="h-5 w-5 text-emerald-600" />Sensobrain</h1>
        <p className="text-sm text-slate-500">Your solar business assistant — answers from the app's own data, sized with the app's own calculator. Text chat in English &amp; Tamil (voice: not yet).</p>
      </div>
      {isAdmin ? (
        <Tabs defaultValue="chat">
          <TabsList><TabsTrigger value="chat" data-testid="sensobrain-tab-chat">Chat</TabsTrigger><TabsTrigger value="settings" data-testid="sensobrain-tab-settings"><Settings className="h-3.5 w-3.5 mr-1" />Settings &amp; cost</TabsTrigger><TabsTrigger value="logs" data-testid="sensobrain-tab-logs"><ScrollText className="h-3.5 w-3.5 mr-1" />Conversation log</TabsTrigger></TabsList>
          <TabsContent value="chat"><ChatPane /></TabsContent>
          <TabsContent value="settings"><SettingsPane /></TabsContent>
          <TabsContent value="logs"><LogsPane /></TabsContent>
        </Tabs>
      ) : <ChatPane />}
      <p className="text-[10px] text-slate-400 flex items-center gap-1"><Coins className="h-3 w-3" />Each answer shows its token cost. Admins see totals for today / this month / all time under Settings.</p>
    </div>
  );
}
