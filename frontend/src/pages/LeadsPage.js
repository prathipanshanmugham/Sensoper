/* Leads — who to call next. One list for every enquiry (calls, walk-ins, WhatsApp, referrals, the website…),
 * sorted so overdue and today's follow-ups come first, with a board view to move them through the stages. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Contact, Plus, Search, Phone, MessageCircle, List, Columns3, Flame, CalendarClock, Inbox, AlertCircle, Trophy, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';
import { PageHeader, Tile, Empty, Loading, Chip, inputCls, errText, inrShort } from '../components/kit/PageBits';
import { crmAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useLiveRefresh } from '../lib/liveSync';
import { useHotkeys } from '../lib/hotkeys';
import LeadPanel from '../components/crm/LeadPanel';
import NewLeadDialog from '../components/crm/NewLeadDialog';
import { STAGE_TONE, OPEN_STAGES, waLink, telLink, firstName, ago, whenLabel, loadMeta, leadsChanged } from '../components/crm/leadBits';

const VIEWS = [['open', 'Open leads'], ['today', 'To call today'], ['overdue', 'Overdue'], ['new', 'New'], ['no_follow_up', 'No follow-up date'],
  ['won', 'Won'], ['lost', 'Lost'], ['all', 'Everything']];
const VIEW_KEY = 'sensoper.leads.layout';
const readLayout = () => { try { return localStorage.getItem(VIEW_KEY) || 'list'; } catch { return 'list'; } };

function FollowUp({ l }) {
  if (!l.follow_up_on) return OPEN_STAGES.includes(l.status) ? <span className="text-xs text-slate-400">Not planned</span> : null;
  const tone = l.follow_up_state === 'overdue' ? 'text-rose-700' : l.follow_up_state === 'today' ? 'text-amber-800' : 'text-slate-700';
  return (
    <span className="min-w-0">
      <span className={`flex items-center gap-1 text-xs font-semibold ${tone}`}><CalendarClock className="h-3.5 w-3.5 shrink-0" />{whenLabel(l.follow_up_on, l.follow_up_at)}</span>
      {l.follow_up_note && <span className="block truncate text-xs text-slate-500">{l.follow_up_note}</span>}
    </span>
  );
}

function QuickContact({ l, compact }) {
  const stop = (e) => e.stopPropagation();
  return (
    <span className="flex shrink-0 gap-1" onClick={stop} onKeyDown={stop} role="presentation">
      <a href={telLink(l.phone)} className={`flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 ${compact ? 'h-8 w-8' : 'h-9 flex-1 px-3 text-sm'}`} aria-label={`Call ${l.name || l.phone}`} title={`Call +91 ${l.phone}`}>
        <Phone className="h-4 w-4" />{!compact && 'Call'}
      </a>
      <a href={waLink(l.phone, `Hi ${firstName(l.name)}, this is Sensoper — `)} target="_blank" rel="noopener noreferrer" className={`flex items-center justify-center gap-1.5 rounded-md bg-[#12803D] text-white hover:bg-[#0F6E34] ${compact ? 'h-8 w-8' : 'h-9 flex-1 px-3 text-sm'}`} aria-label={`WhatsApp ${l.name || l.phone}`} title="WhatsApp">
        <MessageCircle className="h-4 w-4" />{!compact && 'WhatsApp'}
      </a>
    </span>
  );
}

function LeadRow({ l, selected, onOpen, rowRef }) {
  return (
    <div ref={rowRef} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className={`group grid cursor-pointer grid-cols-1 gap-2 border-b border-slate-100 px-3 py-3 outline-none transition-colors last:border-0 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_auto] sm:items-center sm:gap-4 sm:px-4 ${selected ? 'bg-emerald-50/70 ring-1 ring-inset ring-emerald-300' : 'hover:bg-slate-50 focus-visible:bg-slate-50'}`}
      data-testid={`lead-row-${l.id}`} aria-current={selected ? 'true' : undefined}>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate font-medium text-slate-900">
          {l.needs_attention && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="New from the website" />}
          {l.heat === 'hot' && <Flame className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-label="Hot" />}
          <span className="truncate">{l.name || `+91 ${l.phone}`}</span>
          <span className="shrink-0 text-[11px] font-normal text-slate-400">{l.number}</span>
        </p>
        <p className="truncate text-xs text-slate-500">{[l.kind_label, l.area || l.city, l.source_label].filter(Boolean).join(' · ')}{l.value ? ` · ${inrShort(l.value)}` : ''}</p>
      </div>
      <div className="flex items-center gap-2 sm:block"><Chip tone={STAGE_TONE[l.status]}>{l.status_label}</Chip><span className="sm:hidden"><FollowUp l={l} /></span></div>
      <div className="hidden min-w-0 sm:block"><FollowUp l={l} /></div>
      <div className="hidden min-w-0 sm:block">
        {l.last_activity ? (<><p className="truncate text-xs text-slate-700">{l.last_activity.text}</p><p className="truncate text-[11px] text-slate-400">{ago(l.last_activity.at)}{l.assigned_to_name ? ` · ${l.assigned_to_name}` : ' · nobody yet'}</p></>) : null}
      </div>
      <div className="hidden sm:block"><QuickContact l={l} compact /></div>
      <div className="sm:hidden"><QuickContact l={l} /></div>
    </div>
  );
}

function Board({ leads, stages, onOpen, onMove }) {
  const [over, setOver] = useState(null);
  const monthAgo = Date.now() - 30 * 86400000;
  const cols = stages.filter((s) => s.key !== 'lost');
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2" data-testid="lead-board">
      <div className="flex min-w-max gap-3">
        {[...cols, stages.find((s) => s.key === 'lost')].filter(Boolean).map((s) => {
          const rows = leads.filter((l) => l.status === s.key && (OPEN_STAGES.includes(s.key) || (l.closed_at && new Date(l.closed_at).getTime() > monthAgo)));
          const value = rows.reduce((n, l) => n + (Number(l.value) || 0), 0);
          return (
            <section key={s.key}
              onDragOver={(e) => { e.preventDefault(); setOver(s.key); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/lead'); if (id) onMove(id, s.key); }}
              className={`flex w-[260px] shrink-0 flex-col rounded-xl border p-2 transition-colors ${over === s.key ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-100/60'}`}
              data-testid={`board-col-${s.key}`} aria-label={s.label}>
              <header className="flex items-baseline justify-between px-1.5 pb-2 pt-1">
                <p className="text-sm font-semibold text-slate-800">{s.label} <span className="font-normal text-slate-500">{rows.length}</span></p>
                {value > 0 && <p className="text-xs tabular-nums text-slate-500">{inrShort(value)}</p>}
              </header>
              {!OPEN_STAGES.includes(s.key) && <p className="px-1.5 pb-2 text-[11px] text-slate-500">Last 30 days</p>}
              <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto">
                {rows.map((l) => (
                  <button key={l.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/lead', l.id)} onClick={() => onOpen(l.id)}
                    className="rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:border-slate-300" data-testid={`board-card-${l.id}`}>
                    <p className="flex items-center gap-1 truncate text-sm font-medium text-slate-900">{l.heat === 'hot' && <Flame className="h-3.5 w-3.5 shrink-0 text-rose-600" />}{l.name || `+91 ${l.phone}`}</p>
                    <p className="truncate text-xs text-slate-500">{[l.kind_label, l.area || l.city].filter(Boolean).join(' · ')}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <FollowUp l={l} />
                      {l.value ? <span className="shrink-0 text-xs font-medium tabular-nums text-slate-700">{inrShort(l.value)}</span> : null}
                    </div>
                  </button>
                ))}
                {rows.length === 0 && <p className="px-1.5 py-4 text-center text-xs text-slate-400">Drag a lead here</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const openId = params.get('lead');
  const [view, setView] = useState(params.get('view') || 'open');
  const [layout, setLayout] = useState(readLayout);
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [channel, setChannel] = useState('');
  const [kind, setKind] = useState('');
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [newOpen, setNewOpen] = useState(params.get('new') === '1');
  const [sel, setSel] = useState(0);
  const searchRef = useRef(null);
  const rowRefs = useRef([]);
  const reqId = useRef(0);

  useEffect(() => { loadMeta().then(setMeta).catch(() => {}); }, []);
  const load = useCallback(async () => {
    const my = ++reqId.current;
    try {
      const r = await crmAPI.list({ view: layout === 'board' ? 'all' : view, q: q || undefined, owner: owner || undefined, channel: channel || undefined, kind: kind || undefined, limit: layout === 'board' ? 800 : 300 });
      if (my === reqId.current) setData(r.data);
    } catch (e) { if (my === reqId.current) { toast.error(errText(e, 'Couldn’t load the leads')); setData((d) => d || { items: [], counts: {} }); } }
  }, [view, q, owner, channel, kind, layout]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLiveRefresh(['crm', 'public', 'material-quotes', 'sales', 'website'], load);
  useEffect(() => { const h = () => load(); window.addEventListener('sensoper:leads-changed', h); return () => window.removeEventListener('sensoper:leads-changed', h); }, [load]);
  useEffect(() => { if (params.get('new') === '1') { setNewOpen(true); const p = new URLSearchParams(params); p.delete('new'); setParams(p, { replace: true }); } }, [params, setParams]);

  const items = useMemo(() => data?.items || [], [data]);
  const c = data?.counts || {};
  useEffect(() => { setSel((s) => Math.min(s, Math.max(items.length - 1, 0))); }, [items.length]);

  const setOpen = (id) => { const p = new URLSearchParams(params); if (id) p.set('lead', id); else p.delete('lead'); setParams(p, { replace: !id }); };
  const pickView = (v) => { setView(v); setSel(0); if (layout === 'board') setLayoutSaved('list'); };
  const setLayoutSaved = (v) => { setLayout(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* optional */ } };
  const openIndex = items.findIndex((l) => l.id === openId);
  const step = (d) => {
    if (!items.length) return;
    const from = openId && openIndex >= 0 ? openIndex : sel;
    const next = Math.min(Math.max(from + d, 0), items.length - 1);
    setSel(next);
    if (openId) setOpen(items[next].id);
    else rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
  };
  const move = async (id, status) => {
    const lead = items.find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    if (status === 'lost') { setOpen(id); toast.message('Say why it’s not going ahead, then Mark lost'); return; }
    setData((d) => ({ ...d, items: d.items.map((l) => (l.id === id ? { ...l, status, status_label: meta?.stages?.find((s) => s.key === status)?.label } : l)) }));
    try { await crmAPI.update(id, { status }); leadsChanged(); } catch (e) { toast.error(errText(e)); load(); }
  };

  useHotkeys([
    { keys: '/', run: () => searchRef.current?.focus() },
    { keys: 'j', when: () => layout === 'list', run: () => step(1) },
    { keys: 'k', when: () => layout === 'list', run: () => step(-1) },
    { keys: 'enter', when: () => layout === 'list' && !!items[sel], run: () => setOpen(items[sel].id) },
    { keys: 'b', run: () => setLayoutSaved(layout === 'board' ? 'list' : 'board') },
    { keys: 'escape', inInput: true, when: () => document.activeElement === searchRef.current, run: () => { setQ(''); searchRef.current?.blur(); } },
  ], [items, sel, layout, openId]);

  const tiles = [
    { key: 'today', label: 'To call today', value: (c.due_today || 0) + (c.overdue || 0), sub: c.overdue ? `${c.overdue} overdue` : 'All on time', icon: CalendarClock, tone: c.overdue ? 'bad' : (c.due_today ? 'warn' : undefined) },
    { key: 'new', label: 'New — not called yet', value: c.new || 0, sub: 'Call within the hour', icon: Sparkles, tone: c.new ? 'warn' : undefined },
    { key: 'no_follow_up', label: 'No follow-up date', value: c.no_follow_up || 0, sub: 'Easy to forget', icon: AlertCircle },
    { key: 'won', label: 'Won this month', value: c.won_month || 0, sub: c.won_month_value ? inrShort(c.won_month_value) : '—', icon: Trophy, tone: c.won_month ? 'good' : undefined },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6" data-testid="leads-page">
      <PageHeader icon={Contact} title="Leads" sub="Who to call next — every enquiry, its follow-up and what they said.">
        <div className="flex rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Layout">
          {[['list', 'List', List], ['board', 'Board', Columns3]].map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={layout === k} onClick={() => setLayoutSaved(k)} title={`${label} (B)`}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${layout === k ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600'}`} data-testid={`leads-layout-${k}`}><Icon className="h-4 w-4" />{label}</button>
          ))}
        </div>
        {can('module_leads', 'create') && (
          <Button onClick={() => setNewOpen(true)} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="leads-new">
            <Plus className="h-4 w-4" />New lead<kbd className="ml-1 hidden rounded bg-emerald-700/60 px-1.5 text-[10px] sm:inline">N</kbd>
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.key} className={view === t.key && layout === 'list' ? 'rounded-xl ring-2 ring-emerald-500/50' : ''}>
            <Tile label={t.label} value={t.value} sub={t.sub} icon={t.icon} tone={t.tone} onClick={() => pickView(t.key)} testid={`leads-tile-${t.key}`} />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search leads</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, number, area…" data-shortcut="search"
            className={`${inputCls} pl-9 pr-10`} data-testid="leads-search" />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] text-slate-500 sm:block">/</kbd>
        </label>
        {layout === 'list' && (
          <select className={`${inputCls} w-auto`} value={view} onChange={(e) => pickView(e.target.value)} aria-label="Show" data-testid="leads-view">
            {VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        <select className={`${inputCls} w-auto`} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Handled by" data-testid="leads-owner">
          <option value="">Anyone</option><option value="me">Mine</option><option value="none">Nobody yet</option>
          {meta?.sees_all && (meta?.people || []).filter((p) => p.id !== meta.me).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className={`${inputCls} hidden w-auto md:block`} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Came from">
          <option value="">Any source</option>{(meta?.channels || []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <select className={`${inputCls} hidden w-auto md:block`} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What they want">
          <option value="">Anything</option>{(meta?.kinds || []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </div>

      {!data ? <Loading /> : layout === 'board' ? (
        <Board leads={items} stages={meta?.stages || []} onOpen={setOpen} onMove={move} />
      ) : items.length === 0 ? (
        <Empty icon={Inbox} title={q ? `No lead matches “${q}”` : view === 'today' ? 'Nobody to call today' : 'No leads here'}
          text={view === 'today' ? 'Follow-ups you set show up here on their day.' : 'Add the next enquiry as soon as it comes in — the number is enough.'}>
          {can('module_leads', 'create') && <Button onClick={() => setNewOpen(true)} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"><Plus className="h-4 w-4" />New lead</Button>}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="leads-list">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_auto] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 sm:grid">
            <span>Lead</span><span>Stage</span><span>Next follow-up</span><span>Last contact</span><span className="w-[68px]" />
          </div>
          {items.map((l, i) => (
            <LeadRow key={l.id} l={l} selected={i === sel && !openId ? true : l.id === openId} onOpen={() => { setSel(i); setOpen(l.id); }} rowRef={(el) => { rowRefs.current[i] = el; }} />
          ))}
          {items.length >= 300 && <p className="border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-500">Showing the first 300 — search or filter to narrow it down.</p>}
        </div>
      )}
      <p className="hidden text-center text-[11px] text-slate-400 lg:block">J / K to move, Enter to open, B for the board, N for a new lead, ? for every shortcut</p>

      {openId && <LeadPanel id={openId} onClose={() => setOpen(null)} onChanged={load}
        onNext={openIndex >= 0 && openIndex < items.length - 1 ? () => step(1) : undefined}
        onPrev={openIndex > 0 ? () => step(-1) : undefined} />}
      <NewLeadDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(lead) => { load(); setOpen(lead.id); }} />
    </div>
  );
}
