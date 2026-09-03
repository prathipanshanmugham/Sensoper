import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { inventoryAPI, companyAPI, calcAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ArrowLeft, Search, FileDown, Loader2, Tags } from 'lucide-react';
import { generatePriceListPDF } from '../utils/priceListPDF';

/** Pricelist — Iteration 45: reads/writes inventory_items directly (no separate catalogue).
 * A price edited here is immediately what the calculator's panel/inverter picker uses and
 * what the next Price List PDF prints — there is only one place a price can live. */
const CATEGORIES = [
  { slug: 'solar_panels', label: 'Panels' },
  { slug: 'inverters', label: 'Inverters' },
  { slug: 'batteries', label: 'Batteries' },
  { slug: 'mounting_structures', label: 'Structures' },
  { slug: 'cables_accessories', label: 'Cables' },
  { slug: 'pumps', label: 'Pumps' },
  { slug: 'bos', label: 'BOS' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.slug, c.label]));
const DEFAULT_MARGIN = 15;

const sellingPrice = (item) => (item.unit_price || 0) * (1 + (item.margin_pct ?? DEFAULT_MARGIN) / 100);

export default function PricelistPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [savingKey, setSavingKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const lists = await Promise.all(CATEGORIES.map((c) => inventoryAPI.getItems({ category: c.slug })));
      const flat = lists.flatMap((r) => r.data || []);
      setRows(flat);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (catFilter !== 'all' && r.category !== catFilter) return false;
      if (!q) return true;
      const hay = `${r.name} ${r.supplier || ''} ${r.sku_code || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, catFilter]);

  const saveField = async (row, field, value) => {
    const key = `${row.id}_${field}`;
    setSavingKey(key);
    try {
      const payload = { [field]: value === '' ? 0 : parseFloat(value) };
      const r = await inventoryAPI.updateItem(row.id, payload);
      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, ...r.data } : x)));
    } catch (e) { alert(e.response?.data?.detail || 'Update failed'); }
    finally { setSavingKey(''); }
  };

  const generatePdf = async () => {
    setGenerating(true);
    try {
      const [companyRes, configRes] = await Promise.all([companyAPI.getActive(), calcAPI.getConfig()]);
      const items = filtered.filter((r) => r.active !== false).map((r) => ({
        categoryLabel: CATEGORY_LABEL[r.category] || r.category,
        label: r.name,
        sellingPrice: sellingPrice(r),
      }));
      generatePriceListPDF(items, companyRes.data, configRes.data?.gst_pct ?? 18);
    } catch (e) { alert('Failed to generate PDF'); }
    finally { setGenerating(false); }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4" data-testid="pricelist-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold font-['Outfit'] flex items-center gap-2"><Tags className="h-5 w-5 text-emerald-600" />Pricelist</h1>
            <p className="text-sm text-slate-500">Filtered, editable view over Inventory — one source of truth for pricing.</p>
          </div>
        </div>
        <Button onClick={generatePdf} disabled={generating || filtered.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="pricelist-generate-pdf-btn">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Generate Price List PDF
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, SKU, supplier..." className="pl-9 h-10" data-testid="pricelist-search-input" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="h-10 w-48" data-testid="pricelist-category-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-10">No inventory items match your search. Add items via the Inventory page.</p>
        ) : (
          <table className="w-full text-sm" data-testid="pricelist-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-right px-3 py-2">{'Unit Price ₹'}</th>
                <th className="text-right px-3 py-2">Margin %</th>
                <th className="text-right px-3 py-2">{'Selling ₹'}</th>
                <th className="text-left px-3 py-2">Supplier</th>
                <th className="text-center px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => {
                return (
                  <tr key={r.id} className={r.active === false ? 'opacity-40' : 'hover:bg-slate-50'} data-testid={`pricelist-row-${r.id}`}>
                    <td className="px-3 py-2"><Badge variant="secondary" className="text-[10px]">{CATEGORY_LABEL[r.category] || r.category}</Badge></td>
                    <td className="px-3 py-2 font-medium text-slate-800">{r.name}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.sku_code}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        key={`unit-${r.id}-${r.unit_price}`}
                        type="number" defaultValue={r.unit_price ?? 0}
                        onBlur={(e) => e.target.value !== String(r.unit_price ?? '') && saveField(r, 'unit_price', e.target.value)}
                        className="h-8 w-24 text-right ml-auto" data-testid={`pricelist-unit-price-${r.id}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        key={`margin-${r.id}-${r.margin_pct}`}
                        type="number" defaultValue={r.margin_pct ?? DEFAULT_MARGIN}
                        onBlur={(e) => e.target.value !== String(r.margin_pct ?? DEFAULT_MARGIN) && saveField(r, 'margin_pct', e.target.value)}
                        className="h-8 w-20 text-right ml-auto" data-testid={`pricelist-margin-${r.id}`}
                      />
                      {savingKey === `${r.id}_margin_pct` && <Loader2 className="h-3 w-3 animate-spin inline ml-1" />}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-700">{'₹'}{Math.round(sellingPrice(r)).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.supplier || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {r.active !== false ? <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Active</Badge> : <Badge variant="outline" className="text-[10px]">Archived</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
