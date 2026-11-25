/* Material quotations — the list: what's out with customers, what was accepted and is ready to bill, what has expired. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FileText, Plus, Search, Send, CheckCircle2, Clock, Receipt } from 'lucide-react';
import { Button } from '../components/ui/button';
import { PageHeader, PillTabs, Tile, Empty, Loading, Chip, inputCls, errText, inr, inrShort, fmtDate } from '../components/kit/PageBits';
import { quotesAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useLiveRefresh } from '../lib/liveSync';
import { useHotkeys } from '../lib/hotkeys';

export const QUOTE_TONE = { draft: 'slate', sent: 'blue', accepted: 'green', rejected: 'red', converted: 'green' };

export default function QuotationsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(0);
  const searchRef = useRef(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    try {
      const r = await quotesAPI.list({ status: tab === 'all' ? undefined : tab, q: q || undefined });
      if (my === reqId.current) setData(r.data);
    } catch (e) { if (my === reqId.current) { toast.error(errText(e, 'Couldn’t load the quotations')); setData((d) => d || { items: [], counts: {} }); } }
  }, [tab, q]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLiveRefresh(['material-quotes', 'sales'], load);

  const items = data?.items || [];
  const c = data?.counts || {};
  useHotkeys([
    { keys: '/', run: () => searchRef.current?.focus() },
    { keys: 'j', run: () => setSel((s) => Math.min(s + 1, items.length - 1)) },
    { keys: 'k', run: () => setSel((s) => Math.max(s - 1, 0)) },
    { keys: 'enter', when: () => !!items[sel], run: () => navigate(`/dashboard/quotations/${items[sel].id}`) },
  ], [items, sel]);

  const tabs = [['open', 'Open', (c.draft || 0) + (c.sent || 0)], ['draft', 'Drafts'], ['sent', 'Sent'], ['accepted', 'Accepted', c.accepted], ['expired', 'Expired'],
    ['converted', 'Sold'], ['rejected', 'Not accepted'], ['all', 'All']];

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6" data-testid="quotations-page">
      <PageHeader icon={FileText} title="Material quotations" sub="Itemised quotes for panels, inverters, cables and other material — PDF, WhatsApp and one-click sale.">
        {can('module_material_quotes', 'create') && (
          <Button onClick={() => navigate('/dashboard/quotations/new')} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="quotations-new">
            <Plus className="h-4 w-4" />New quotation<kbd className="ml-1 hidden rounded bg-emerald-700/60 px-1.5 text-[10px] sm:inline">Q</kbd>
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Tile label="Out with customers" value={c.sent || 0} sub={c.open_value ? `${inrShort(c.open_value)} sent or accepted` : 'Sent, waiting for a yes'} icon={Send} onClick={() => setTab('sent')} testid="q-tile-sent" />
        <Tile label="Accepted — make the sale" value={c.accepted || 0} sub="Ready to bill" icon={CheckCircle2} tone={c.accepted ? 'good' : undefined} onClick={() => setTab('accepted')} testid="q-tile-accepted" />
        <Tile label="Expired" value={c.expired || 0} sub="Past their 'valid till' date" icon={Clock} tone={c.expired ? 'warn' : undefined} onClick={() => setTab('expired')} testid="q-tile-expired" />
        <Tile label="Sold this month" value={c.converted_month || 0} sub={c.converted_month_value ? inrShort(c.converted_month_value) : '—'} icon={Receipt} onClick={() => setTab('converted')} testid="q-tile-sold" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1"><PillTabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setSel(0); }} testid="q-tab" /></div>
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search quotations</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, customer, item…" data-shortcut="search" className={`${inputCls} pl-9`} data-testid="quotations-search" />
        </label>
      </div>

      {!data ? <Loading /> : items.length === 0 ? (
        <Empty icon={FileText} title={q ? `No quotation matches “${q}”` : 'No quotations here yet'} text="Make one from a lead, or start a new one and pick the items from stock.">
          {can('module_material_quotes', 'create') && <Button onClick={() => navigate('/dashboard/quotations/new')} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"><Plus className="h-4 w-4" />New quotation</Button>}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="quotations-list">
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 md:grid">
            <span>Quotation</span><span>Customer</span><span className="text-right">Total</span><span>Status</span><span>Valid till</span>
          </div>
          {items.map((x, i) => (
            <button key={x.id} type="button" onClick={() => navigate(`/dashboard/quotations/${x.id}`)}
              className={`grid w-full grid-cols-2 gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-3 text-left last:border-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center ${i === sel ? 'bg-emerald-50/60' : 'hover:bg-slate-50'}`}
              data-testid={`quote-row-${x.id}`}>
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-900">{x.display_number}</span><span className="block text-[11px] text-slate-500">{fmtDate(x.quote_date || x.created_at)} · {x.created_by_name}</span></span>
              <span className="order-3 min-w-0 md:order-none"><span className="block truncate text-sm text-slate-800">{x.customer?.name}{x.customer?.company ? ` — ${x.customer.company}` : ''}</span><span className="block truncate text-[11px] text-slate-500">{x.item_count} item{x.item_count === 1 ? '' : 's'}{x.subject ? ` · ${x.subject}` : ''}{x.lead_number ? ` · lead ${x.lead_number}` : ''}</span></span>
              <span className="text-right text-sm font-semibold tabular-nums text-slate-900 md:text-right">{inr(x.grand_total)}</span>
              <span className="order-4 md:order-none"><Chip tone={x.expired ? 'amber' : QUOTE_TONE[x.status]}>{x.expired ? 'Expired' : x.status_label}</Chip>{x.invoice_number && <span className="ml-1.5 text-[11px] text-slate-500">{x.invoice_number}</span>}</span>
              <span className="hidden text-xs text-slate-600 md:block">{fmtDate(x.valid_until)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
