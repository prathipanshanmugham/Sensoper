import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { pricelistAPI, companyAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Search, FileDown, Loader2, Tags, History, SlidersHorizontal, Archive, ArchiveRestore, AlertTriangle } from 'lucide-react';
import { PriceCell } from '../components/pricelist/PriceCell';
import { BulkAdjustDialog, PriceHistoryDialog } from '../components/pricelist/PricelistDialogs';
import { PdfOptionsDialog } from '../components/pricelist/PdfOptionsDialog';
import { generatePriceListPDF } from '../utils/priceListPDF';

const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;
const STATUS = [{ id: 'active', label: 'Active' }, { id: 'archived', label: 'Archived' }, { id: 'all', label: 'All' }];

export default function PricelistPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('active');
  const [selected, setSelected] = useState(new Set());
  const [showBulk, setShowBulk] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [historyItem, setHistoryItem] = useState(null);
  const [normPlan, setNormPlan] = useState(null);
  const [normalising, setNormalising] = useState(false);

  const load = useCallback(async () => {
    try { const r = await pricelistAPI.list({ status }); setData(r.data); }
    catch (e) { toast.error('Could not load pricelist'); } finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (isAdmin) pricelistAPI.normalisePreview().then(r => setNormPlan(r.data.plan)).catch(() => {}); }, [isAdmin, data?.total]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items || []).filter(r => (category === 'all' || r.category === category) && (!q || `${r.name} ${r.sku_code || ''} ${r.supplier || ''} ${r.hsn_code || ''}`.toLowerCase().includes(q)));
  }, [data, search, category]);
  const grouped = useMemo(() => {
    const order = (data?.categories || []).map(c => c.slug);
    const map = new Map();
    items.forEach(r => { if (!map.has(r.category)) map.set(r.category, { slug: r.category, label: r.category_label, items: [] }); map.get(r.category).items.push(r); });
    return [...map.values()].sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
  }, [items, data]);

  const patchRow = (row) => setData(d => ({ ...d, items: d.items.map(x => x.id === row.id ? row : x) }));
  const save = async (row, field, value) => { const r = await pricelistAPI.update(row.id, { [field]: value }); patchRow(r.data); };
  const toggleArchive = async (row) => {
    try { const r = await pricelistAPI.update(row.id, { active: !row.active }); patchRow(r.data); toast.success(row.active ? `${row.name} archived` : `${row.name} restored`); if (status !== 'all') load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };
  const allVisibleSelected = items.length > 0 && items.every(r => selected.has(r.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(items.map(r => r.id)));
  const toggleOne = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const fixableCount = (normPlan || []).filter(p => p.to).reduce((n, p) => n + p.count, 0);
  const normalise = async () => {
    setNormalising(true);
    try { const r = await pricelistAPI.normaliseApply(); toast.success(`${r.data.moved} item${r.data.moved === 1 ? '' : 's'} moved to standard categories`); await load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Normalise failed'); } finally { setNormalising(false); }
  };
  const moveToCategory = async (row, slug) => {
    try { await pricelistAPI.setCategory(row.id, slug); toast.success(`${row.name} → ${data.categories.find(c => c.slug === slug)?.name}`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  const generatePdf = async (opts) => {
    try {
      const company = (await companyAPI.getActive()).data;
      const groups = grouped.filter(g => opts.categories.includes(g.slug)).map(g => ({ ...g, items: g.items.filter(i => i.active) })).filter(g => g.items.length);
      if (!groups.length) { toast.error('Nothing to print for the chosen categories'); return; }
      await generatePriceListPDF({ groups, company, gstPct: data.gst_pct, options: opts });
      toast.success('Price list PDF downloaded');
    } catch (e) { console.error(e); toast.error('Failed to generate PDF'); }
  };

  const stdCategories = (data?.categories || []).filter(c => c.slug !== 'uncategorised');

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4" data-testid="pricelist-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold font-['Outfit'] flex items-center gap-2"><Tags className="h-5 w-5 text-emerald-600" />Pricelist</h1>
            <p className="text-sm text-slate-500">Cost, margin and selling price for every inventory item — edits save instantly and feed the calculator and PDFs. Default margin {data?.default_margin_pct ?? 15}%.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setHistoryItem({})} className="gap-1.5" data-testid="pricelist-history-btn"><History className="h-4 w-4" />History</Button>
          <Button variant="outline" onClick={() => setShowBulk(true)} disabled={selected.size === 0} className="gap-1.5" data-testid="pricelist-bulk-btn"><SlidersHorizontal className="h-4 w-4" />Bulk adjust{selected.size ? ` (${selected.size})` : ''}</Button>
          <Button onClick={() => setShowPdf(true)} disabled={!data || items.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="pricelist-generate-pdf-btn"><FileDown className="h-4 w-4" />Price List PDF</Button>
        </div>
      </div>

      {isAdmin && fixableCount > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm" data-testid="normalise-banner">
          <p className="text-amber-900 flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /><span><b>{fixableCount}</b> item{fixableCount === 1 ? '' : 's'} use non-standard category names ({normPlan.filter(p => p.to).map(p => `"${p.from}" → ${p.to}`).join(', ')}). They're shown under Uncategorised until fixed.</span></p>
          <Button size="sm" onClick={normalise} disabled={normalising} className="bg-amber-600 hover:bg-amber-700 text-white shrink-0" data-testid="normalise-apply-btn">{normalising ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fix categories'}</Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        <aside className="space-y-1" data-testid="pricelist-categories">
          <button onClick={() => setCategory('all')} className={`w-full flex justify-between px-3 py-2 rounded-md text-sm ${category === 'all' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'}`} data-testid="pricelist-cat-all"><span>All items</span><span className="opacity-70">{data?.total ?? 0}</span></button>
          {(data?.categories || []).map(c => (
            <button key={c.slug} onClick={() => setCategory(c.slug)} className={`w-full flex justify-between px-3 py-2 rounded-md text-sm ${category === c.slug ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'} ${c.slug === 'uncategorised' ? 'italic' : ''}`} data-testid={`pricelist-cat-${c.slug}`}><span className="truncate">{c.name}</span><span className="opacity-70">{c.count}</span></button>
          ))}
        </aside>

        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item, SKU, HSN, supplier…" className="pl-9 h-9" data-testid="pricelist-search-input" /></div>
            <div className="flex gap-1 p-1 rounded-lg bg-slate-100" data-testid="pricelist-status-filter">
              {STATUS.map(s => <button key={s.id} onClick={() => { setStatus(s.id); setSelected(new Set()); }} className={`px-3 py-1 text-xs rounded-md ${status === s.id ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-600'}`} data-testid={`pricelist-status-${s.id}`}>{s.label}</button>)}
            </div>
            <span className="text-xs text-slate-500 ml-auto" data-testid="pricelist-count">{items.length} item{items.length === 1 ? '' : 's'}</span>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
            {loading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div> : items.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10" data-testid="pricelist-empty">No items match. Add items via the Inventory page.</p>
            ) : (
              <table className="w-full text-sm" data-testid="pricelist-table">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 w-8"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} data-testid="pricelist-select-all" /></th>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-left px-3 py-2">SKU · HSN</th>
                    <th className="text-right px-3 py-2">Cost ₹</th>
                    <th className="text-right px-3 py-2">Margin %</th>
                    <th className="text-right px-3 py-2">Selling ₹</th>
                    <th className="text-right px-3 py-2">GST %</th>
                    <th className="text-right px-3 py-2">Incl. GST ₹</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(g => (
                    <GroupRows key={g.slug} group={g} selected={selected} toggleOne={toggleOne} save={save} toggleArchive={toggleArchive} setHistoryItem={setHistoryItem} stdCategories={stdCategories} moveToCategory={moveToCategory} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <BulkAdjustDialog open={showBulk} onOpenChange={setShowBulk} itemIds={[...selected]} onDone={(r) => { r.items.forEach(patchRow); setSelected(new Set()); toast.success(`${r.updated} item${r.updated === 1 ? '' : 's'} updated`); }} />
      <PriceHistoryDialog item={historyItem} onClose={() => setHistoryItem(null)} />
      {data && <PdfOptionsDialog key={`${category}-${showPdf}`} open={showPdf} onOpenChange={setShowPdf} categories={data.categories} defaultCategory={category} onGenerate={generatePdf} />}
    </div>
  );
}

function GroupRows({ group, selected, toggleOne, save, toggleArchive, setHistoryItem, stdCategories, moveToCategory }) {
  return (
    <>
      <tr className="bg-slate-50/80 border-y border-slate-200" data-testid={`pricelist-group-${group.slug}`}>
        <td colSpan={9} className="px-3 py-1.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">{group.label} <span className="text-slate-400 font-normal">· {group.items.length}</span></td>
      </tr>
      {group.items.map(r => (
        <tr key={r.id} className={`border-b border-slate-100 last:border-0 ${r.active ? 'hover:bg-slate-50/60' : 'opacity-50'}`} data-testid={`pricelist-row-${r.id}`}>
          <td className="px-3 py-2"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} data-testid={`pricelist-select-${r.id}`} /></td>
          <td className="px-3 py-2">
            <p className="font-medium text-slate-900">{r.name}</p>
            <p className="text-[11px] text-slate-400">{r.supplier || 'no supplier'} · stock {r.quantity}{!r.active && <Badge variant="outline" className="ml-1 text-[10px]">Archived</Badge>}</p>
            {group.slug === 'uncategorised' && (
              <select defaultValue="" onChange={e => e.target.value && moveToCategory(r, e.target.value)} className="mt-1 h-6 text-[11px] rounded border border-amber-300 bg-amber-50 px-1" data-testid={`pricelist-move-${r.id}`}>
                <option value="">Move "{r.raw_category || 'blank'}" to…</option>{stdCategories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            )}
          </td>
          <td className="px-3 py-2 text-xs text-slate-500"><p>{r.sku_code || '—'}</p><PriceCell type="text" value={r.hsn_code || ''} placeholder="HSN" onSave={v => save(r, 'hsn_code', v)} testId={`pricelist-hsn-${r.id}`} width="w-24" /></td>
          <td className="px-3 py-2"><PriceCell value={r.unit_price} onSave={v => save(r, 'unit_price', v)} testId={`pricelist-unit-price-${r.id}`} width="w-28" /></td>
          <td className="px-3 py-2"><PriceCell value={r.margin_pct} muted={r.margin_is_default} onSave={v => save(r, 'margin_pct', v)} testId={`pricelist-margin-${r.id}`} width="w-20" suffix="%" /></td>
          <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums" data-testid={`pricelist-selling-${r.id}`}>{inr(r.selling_price)}</td>
          <td className="px-3 py-2"><PriceCell value={r.gst_pct} onSave={v => save(r, 'gst_percentage', v)} testId={`pricelist-gst-${r.id}`} width="w-20" suffix="%" /></td>
          <td className="px-3 py-2 text-right tabular-nums text-slate-800" data-testid={`pricelist-incl-${r.id}`}>{inr(r.price_incl_gst)}</td>
          <td className="px-3 py-2">
            <div className="flex gap-1 justify-end">
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Price history" onClick={() => setHistoryItem(r)} data-testid={`pricelist-history-${r.id}`}><History className="h-3.5 w-3.5 text-slate-500" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title={r.active ? 'Archive' : 'Restore'} onClick={() => toggleArchive(r)} data-testid={`pricelist-archive-${r.id}`}>{r.active ? <Archive className="h-3.5 w-3.5 text-slate-500" /> : <ArchiveRestore className="h-3.5 w-3.5 text-emerald-600" />}</Button>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
