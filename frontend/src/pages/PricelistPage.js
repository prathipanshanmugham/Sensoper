import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { catalogueAPI, companyAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ArrowLeft, Search, FileDown, Loader2, Tags } from 'lucide-react';
import { generatePriceListPDF } from '../utils/priceListPDF';

const CAT_ORDER = ['panel', 'inverter', 'battery', 'pump', 'structure', 'service'];
const CAT_LABELS = { panel: 'Panel', inverter: 'Inverter', battery: 'Battery', pump: 'Pump', structure: 'Structure/BOS', service: 'Service' };
const DEFAULT_MARGIN = 15;

const itemLabel = (cat, p) => (cat === 'structure' || cat === 'service') ? (p.name || '—') : `${p.make || ''} ${p.model || ''}`.trim();
const basePrice = (cat, p) => (cat === 'service' ? (p.rate ?? 0) : (p.purchase_price ?? 0));
const sellingPrice = (cat, p) => {
  if (p.selling_price != null) return p.selling_price;
  if (cat === 'service') return p.rate ?? 0;
  return basePrice(cat, p) * (1 + (p.margin_pct ?? DEFAULT_MARGIN) / 100);
};

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
      const lists = await Promise.all(CAT_ORDER.map((cat) => catalogueAPI.list(cat, false)));
      const flat = [];
      CAT_ORDER.forEach((cat, i) => {
        (lists[i].data || []).forEach((p) => flat.push({ cat, ...p }));
      });
      setRows(flat);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (catFilter !== 'all' && r.cat !== catFilter) return false;
      if (!q) return true;
      const hay = `${itemLabel(r.cat, r)} ${r.supplier || ''} ${CAT_LABELS[r.cat]}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, catFilter]);

  const saveField = async (row, field, value) => {
    const key = `${row.cat}_${row.id}_${field}`;
    setSavingKey(key);
    try {
      const payload = { [field]: value === '' ? null : parseFloat(value) };
      // Margin changes recompute selling_price server-side isn't automatic — do it here too
      // so the Selling ₹ cell doesn't go stale until a reload.
      if (field === 'margin_pct' && row.cat !== 'service' && row.selling_price == null) {
        payload.selling_price = basePrice(row.cat, row) * (1 + (payload.margin_pct ?? DEFAULT_MARGIN) / 100);
      }
      const r = await catalogueAPI.update(row.cat, row.id, payload);
      setRows((prev) => prev.map((x) => (x.cat === row.cat && x.id === row.id ? { ...x, ...r.data } : x)));
    } catch (e) { alert(e.response?.data?.detail || 'Update failed'); }
    finally { setSavingKey(''); }
  };

  const generatePdf = async () => {
    setGenerating(true);
    try {
      const [companyRes, configRes] = await Promise.all([companyAPI.getActive(), catalogueAPI.getConfig()]);
      const items = filtered.filter((r) => r.active !== false).map((r) => ({
        categoryLabel: CAT_LABELS[r.cat],
        label: itemLabel(r.cat, r),
        sellingPrice: sellingPrice(r.cat, r),
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
            <p className="text-sm text-slate-500">Search the full catalogue, adjust margins/prices inline, and export a branded price list.</p>
          </div>
        </div>
        <Button onClick={generatePdf} disabled={generating || filtered.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="pricelist-generate-pdf-btn">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Generate Price List PDF
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, make, supplier..." className="pl-9 h-10" data-testid="pricelist-search-input" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="h-10 w-48" data-testid="pricelist-category-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CAT_ORDER.map((c) => <SelectItem key={c} value={c}>{CAT_LABELS[c]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-10">No catalogue items match your search.</p>
        ) : (
          <table className="w-full text-sm" data-testid="pricelist-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">{'Purchase / Rate ₹'}</th>
                <th className="text-right px-3 py-2">Margin %</th>
                <th className="text-right px-3 py-2">{'Selling ₹'}</th>
                <th className="text-left px-3 py-2">Supplier</th>
                <th className="text-center px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => {
                const rowId = `${r.cat}_${r.id}`;
                return (
                  <tr key={rowId} className={r.active === false ? 'opacity-40' : 'hover:bg-slate-50'} data-testid={`pricelist-row-${rowId}`}>
                    <td className="px-3 py-2"><Badge variant="secondary" className="text-[10px]">{CAT_LABELS[r.cat]}</Badge></td>
                    <td className="px-3 py-2 font-medium text-slate-800">{itemLabel(r.cat, r)}</td>
                    <td className="px-3 py-2 text-right">
                      {r.cat === 'service' ? (
                        <Input
                          type="number" defaultValue={r.rate ?? ''}
                          onBlur={(e) => e.target.value !== String(r.rate ?? '') && saveField(r, 'rate', e.target.value)}
                          className="h-8 w-24 text-right ml-auto" data-testid={`pricelist-rate-${rowId}`}
                        />
                      ) : (
                        <span>{'₹'}{(r.purchase_price || 0).toLocaleString('en-IN')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.cat === 'service' ? '—' : (
                        <Input
                          type="number" defaultValue={r.margin_pct ?? DEFAULT_MARGIN}
                          onBlur={(e) => e.target.value !== String(r.margin_pct ?? DEFAULT_MARGIN) && saveField(r, 'margin_pct', e.target.value)}
                          className="h-8 w-20 text-right ml-auto" data-testid={`pricelist-margin-${rowId}`}
                        />
                      )}
                      {savingKey === `${r.cat}_${r.id}_margin_pct` && <Loader2 className="h-3 w-3 animate-spin inline ml-1" />}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.cat === 'service' ? (
                        <span className="font-semibold text-emerald-700">{'₹'}{Math.round(sellingPrice(r.cat, r)).toLocaleString('en-IN')}</span>
                      ) : (
                        <Input
                          key={`sell-${rowId}-${r.selling_price ?? ''}`}
                          type="number" defaultValue={r.selling_price ?? Math.round(sellingPrice(r.cat, r))}
                          onBlur={(e) => e.target.value !== String(r.selling_price ?? '') && saveField(r, 'selling_price', e.target.value)}
                          className="h-8 w-24 text-right ml-auto font-semibold text-emerald-700" data-testid={`pricelist-selling-${rowId}`}
                        />
                      )}
                      {savingKey === `${r.cat}_${r.id}_selling_price` && <Loader2 className="h-3 w-3 animate-spin inline ml-1" />}
                    </td>
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
