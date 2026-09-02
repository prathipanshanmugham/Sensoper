import { useState, useEffect, useCallback } from 'react';
import { invoicingAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Loader2, TrendingUp, Lock } from 'lucide-react';

const CATEGORY_LABELS = { material: 'Material', labour_subcontractor: 'Labour / Subcontractor' };

/** Admin-only profit breakdown — reads the same cost_estimation as everything else, never
 * recomputes its own numbers (Iter 44 Batch A). Server also enforces role=admin. */
export default function ProjectProfitCard({ projectId, isAdmin }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true);
    try { const r = await invoicingAPI.getProfit(projectId); setData(r.data); }
    catch (e) { setError(e.response?.data?.detail || 'Could not load profit data'); }
    finally { setLoading(false); }
  }, [projectId, isAdmin]);
  useEffect(() => { fetchData(); }, [fetchData]);

  if (!isAdmin) return null; // hidden entirely for manager/staff — API also blocks with 403

  return (
    <Card className="border-amber-200" data-testid="profit-calculator-card">
      <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-600" />Profit Calculator <Lock className="h-3 w-3 text-slate-400" /></CardTitle></CardHeader>
      <CardContent>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-amber-600" /> : error ? (
          <p className="text-xs text-rose-600">{error}</p>
        ) : data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-slate-400">Revenue (excl. GST)</p><p className="font-semibold" data-testid="profit-revenue">₹{data.revenue.toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-slate-400">Material Cost</p><p className="font-semibold">₹{data.material_cost.toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-slate-400">Labour/Subcontractor</p><p className="font-semibold">₹{data.labour_subcontractor_cost.toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-slate-400">Other Direct Costs</p><p className="font-semibold">₹{data.other_direct_costs.toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-slate-400">Gross Profit</p><p className={`font-bold ${data.gross_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} data-testid="profit-gross-profit">₹{data.gross_profit.toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-slate-400">Gross Margin</p><p className={`font-bold ${data.gross_margin_pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} data-testid="profit-gross-margin-pct">{data.gross_margin_pct}%</p></div>
            </div>
            {data.breakdown_by_category.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 mb-1.5">Breakdown by Category</p>
                <table className="w-full text-xs" data-testid="profit-category-breakdown-table">
                  <thead className="text-slate-400"><tr><th className="text-left py-1">Category</th><th className="text-right py-1">Base Cost</th><th className="text-right py-1">Margin</th></tr></thead>
                  <tbody>
                    {data.breakdown_by_category.map(c => (
                      <tr key={c.category} className="border-t border-slate-50"><td className="py-1 capitalize">{CATEGORY_LABELS[c.category] || c.category}</td><td className="text-right py-1">₹{c.base_cost.toLocaleString('en-IN')}</td><td className="text-right py-1">₹{c.margin_amount.toLocaleString('en-IN')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
