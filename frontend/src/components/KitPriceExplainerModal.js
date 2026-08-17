import { useState, useEffect } from 'react';
import { catalogueAPI } from '../utils/api';
import { buildKitSalesBreakdown, buildKitPresentation } from '../utils/kitQuotationPDF';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Eye, EyeOff, Loader2, TrendingUp, Receipt, ArrowRight, Calculator } from 'lucide-react';
const inr = (v) => `₹${(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/**
 * Kit Price Explainer Modal (Iter 44 Change 4 debug view)
 *
 * Splits the modal into two panes:
 *   LEFT  — Sales / Internal: every product's real cost + margin + rounding
 *   RIGHT — Customer / Kit PDF: only the lump-sum lines the customer sees
 *
 * Purpose: the sales person opens this on the phone with a customer and can
 * defend the lump-sum on the Kit PDF, line-item by line-item, without
 * showing the customer the internal margin.
 */
export default function KitPriceExplainerModal({ project, open, onClose }) {
  const [config, setConfig] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCustomerSide, setShowCustomerSide] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [c, g] = await Promise.all([catalogueAPI.getConfig(), catalogueAPI.addonGroups()]);
        if (cancelled) return;
        setConfig(c.data);
        setGroups(g.data);
      } catch (e) { console.error(e); }
      finally { !cancelled && setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;
  if (loading || !config) return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md"><div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div></DialogContent>
    </Dialog>
  );

  const sales = buildKitSalesBreakdown(project, config, groups);
  const customer = buildKitPresentation(project, config, groups);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto" data-testid="kit-explainer-modal">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg font-['Outfit']">
              <Calculator className="h-5 w-5 text-emerald-600" /> Kit Price Explainer
              <Badge variant="outline" className="text-[10px] uppercase">Internal only</Badge>
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCustomerSide(v => !v)} className="h-8 text-xs gap-1" data-testid="explainer-toggle-customer">
                {showCustomerSide ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showCustomerSide ? 'Hide' : 'Show'} customer side
              </Button>
            </div>
          </div>
          <p className="text-xs text-slate-500">Line-by-line reconciliation: how the customer&apos;s lump sum is built from your real product prices. Never share this view.</p>
        </DialogHeader>

        <div className={`grid ${showCustomerSide ? 'md:grid-cols-2' : 'grid-cols-1'} gap-4 mt-3`}>

          {/* LEFT — Sales / Internal */}
          <div className="space-y-3" data-testid="explainer-sales-side">
            <div className="flex items-center gap-2 pb-1 border-b border-slate-200">
              <Receipt className="h-4 w-4 text-rose-600" />
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">Sales / Internal View</p>
            </div>

            {/* Core system */}
            <Card className="border-slate-200">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-800">Core System</p>
                  <Badge variant="secondary" className="text-[10px]">{sales.core.lines.length} lines</Badge>
                </div>
                {sales.core.lines.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">No core items — customer sees only default inclusions.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                        <tr>
                          <th className="text-left px-1.5 py-1">Item</th>
                          <th className="text-right px-1.5 py-1">Qty</th>
                          <th className="text-right px-1.5 py-1">Cost</th>
                          <th className="text-right px-1.5 py-1">Margin</th>
                          <th className="text-right px-1.5 py-1">Line</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sales.core.lines.map((l, i) => (
                          <tr key={i} className={l.is_manual ? 'bg-blue-50/40' : 'hover:bg-slate-50'} data-testid={`explainer-core-row-${i}`}>
                            <td className="px-1.5 py-1 text-slate-800">
                              <div className="font-medium">{l.name}</div>
                              {l.specifications && <div className="text-[9px] text-slate-400 truncate max-w-[180px]">{l.specifications}</div>}
                              {l.is_manual && <Badge variant="outline" className="text-[9px] mt-0.5">manual</Badge>}
                            </td>
                            <td className="px-1.5 py-1 text-right text-slate-600">{l.qty}</td>
                            <td className="px-1.5 py-1 text-right text-slate-600">{inr(l.line_cost)}</td>
                            <td className="px-1.5 py-1 text-right text-emerald-700">{l.margin_pct}%</td>
                            <td className="px-1.5 py-1 text-right font-medium text-slate-900">{inr(l.line_with_margin)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50">
                          <td colSpan={2} className="px-1.5 py-1.5 font-semibold text-slate-700">Subtotal (cost + margin)</td>
                          <td className="px-1.5 py-1.5 text-right text-slate-500 text-[10px]">{inr(sales.core.subtotal)}</td>
                          <td className="px-1.5 py-1.5 text-right text-slate-500 text-[10px]">→</td>
                          <td className="px-1.5 py-1.5 text-right font-bold text-slate-900">{inr(sales.core.withMargin)}</td>
                        </tr>
                        <tr className="bg-emerald-50/70">
                          <td colSpan={4} className="px-1.5 py-1.5 text-slate-700">
                            Rounded to nearest ₹{sales.config.step} ({sales.config.mode})
                            <span className={`ml-2 text-[10px] ${sales.core.roundingDelta >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                              {sales.core.roundingDelta >= 0 ? '+' : ''}{inr(sales.core.roundingDelta)}
                            </span>
                          </td>
                          <td className="px-1.5 py-1.5 text-right font-bold text-emerald-800" data-testid="explainer-core-rounded">{inr(sales.core.rounded)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Add-on groups */}
            {sales.groups.map((g, gi) => (
              <Card key={gi} className={`${g.optional_priced_separately ? 'border-amber-200 bg-amber-50/20' : 'border-slate-200'}`} data-testid={`explainer-group-${g.name}`}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {g.name}
                      {g.optional_priced_separately && <Badge variant="outline" className="ml-2 text-[9px] border-amber-400 text-amber-700">Optional</Badge>}
                      {!g.show_on_pdf && <Badge variant="outline" className="ml-1 text-[9px]">Hidden from PDF</Badge>}
                    </p>
                    <Badge variant="secondary" className="text-[10px]">{g.lines.length} lines</Badge>
                  </div>
                  <table className="w-full text-[11px]">
                    <tbody className="divide-y divide-slate-100">
                      {g.lines.map((l, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-1.5 py-1 text-slate-800">{l.qty} × {l.name}</td>
                          <td className="px-1.5 py-1 text-right text-slate-500 text-[10px]">{inr(l.line_cost)} +{l.margin_pct}%</td>
                          <td className="px-1.5 py-1 text-right font-medium text-slate-900">{inr(l.line_with_margin)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-emerald-50/70 border-t-2 border-slate-200">
                        <td className="px-1.5 py-1.5 font-semibold text-slate-700" colSpan={2}>Rounded lump</td>
                        <td className="px-1.5 py-1.5 text-right font-bold text-emerald-800">{inr(g.rounded)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </CardContent>
              </Card>
            ))}

            {/* Sales-side totals */}
            <Card className="border-2 border-rose-200 bg-rose-50/30">
              <CardContent className="p-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-slate-600">Raw cost (all items)</span><span className="font-mono">{inr(sales.totals.rawCost)}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">+ Margin (weighted)</span><span className="font-mono text-emerald-700">{inr(sales.totals.rawWithMargin - sales.totals.rawCost)}</span></div>
                <div className="flex justify-between border-t border-slate-200 pt-1"><span className="text-slate-600">Cost + margin</span><span className="font-mono">{inr(sales.totals.rawWithMargin)}</span></div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Rounding impact ({sales.config.mode} ₹{sales.config.step})</span>
                  <span className={`font-mono ${sales.totals.roundingImpact >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {sales.totals.roundingImpact >= 0 ? '+' : ''}{inr(sales.totals.roundingImpact)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold border-t border-rose-200 pt-1 text-slate-900" data-testid="explainer-sales-net-margin">
                  <span>Effective margin (₹ / %)</span>
                  <span className="font-mono">{inr(sales.totals.netMarginRupees)} · {sales.totals.netMarginPct.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Subsidy (info only, farmer-facing)</span>
                  <span className="font-mono">{inr(sales.totals.subsidy)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT — Customer / Kit PDF */}
          {showCustomerSide && (
            <div className="space-y-3" data-testid="explainer-customer-side">
              <div className="flex items-center gap-2 pb-1 border-b border-slate-200">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Customer View (what prints on the Kit PDF)</p>
              </div>

              {/* System line */}
              <Card className="border-emerald-200 bg-emerald-50/30">
                <CardContent className="p-3">
                  <div className="flex justify-between items-start">
                    <p className="text-sm font-semibold text-slate-800">{customer.systemLine.name}</p>
                    <p className="text-lg font-bold text-slate-900" data-testid="explainer-customer-system-price">{inr(customer.systemLine.price)}</p>
                  </div>
                  <p className="text-[10px] uppercase text-slate-500 mt-2 mb-1">Includes:</p>
                  <ul className="text-[11px] text-slate-700 space-y-0.5">
                    {customer.systemLine.inclusions.map((inc, i) => <li key={i}>• {inc}</li>)}
                  </ul>
                </CardContent>
              </Card>

              {/* Add-on groups */}
              {customer.addonGroupLines.map((g, gi) => (
                <Card key={gi} className={g.optional_priced_separately ? 'border-amber-200 bg-amber-50/20' : 'border-slate-200'}>
                  <CardContent className="p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Add-ons — {g.name}</p>
                        {g.description && <p className="text-[10px] italic text-slate-500 mt-0.5">{g.description}</p>}
                      </div>
                      <p className="text-base font-bold text-slate-900">
                        {inr(g.price)}
                        {g.optional_priced_separately && <span className="block text-[9px] font-normal text-amber-700">(Optional)</span>}
                      </p>
                    </div>
                    <ul className="text-[11px] text-slate-700 space-y-0.5 mt-2">
                      {g.inclusions.map((inc, i) => <li key={i}>• {inc}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              ))}

              {/* Customer totals */}
              <Card className="border-2 border-emerald-300">
                <CardContent className="p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-slate-600">System total</span><span className="font-mono">{inr(customer.totals.systemPrice)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Add-ons total</span><span className="font-mono">{inr(customer.totals.addonsTotal)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">GST @ {customer.totals.gstPct}%</span><span className="font-mono">{inr(customer.totals.gst)}</span></div>
                  {customer.totals.subsidy > 0 && (
                    <div className="flex justify-between text-rose-700"><span>Less subsidy</span><span className="font-mono">− {inr(customer.totals.subsidy)}</span></div>
                  )}
                  <div className="flex justify-between font-bold text-slate-900 border-t border-emerald-200 pt-1.5 text-sm" data-testid="explainer-customer-net-payable">
                    <span>Net payable</span><span className="font-mono">{inr(customer.totals.netPayable)}</span>
                  </div>
                  {customer.totals.optionalTotal > 0 && (
                    <div className="flex justify-between text-[10px] italic text-slate-500 pt-1">
                      <span>Optional add-ons (not in total)</span><span className="font-mono">{inr(customer.totals.optionalTotal)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Reconciliation strip — visible only when both sides shown */}
        {showCustomerSide && (
          <Card className="mt-4 border-slate-200 bg-gradient-to-r from-rose-50/50 to-emerald-50/50" data-testid="explainer-reconciliation">
            <CardContent className="p-3 flex items-center justify-around text-xs">
              <div className="text-center">
                <p className="text-[10px] uppercase text-rose-700 tracking-wider">Sales cost + margin</p>
                <p className="text-sm font-bold text-slate-900">{inr(sales.totals.rawWithMargin)}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400" />
              <div className="text-center">
                <p className="text-[10px] uppercase text-amber-700 tracking-wider">After rounding ({sales.config.mode} ₹{sales.config.step})</p>
                <p className="text-sm font-bold text-slate-900">{inr(sales.totals.roundedTotal)}</p>
                <p className={`text-[10px] ${sales.totals.roundingImpact >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {sales.totals.roundingImpact >= 0 ? '+' : ''}{inr(sales.totals.roundingImpact)}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400" />
              <div className="text-center">
                <p className="text-[10px] uppercase text-emerald-700 tracking-wider">Customer lump-sum</p>
                <p className="text-sm font-bold text-slate-900">{inr(customer.totals.systemPrice + customer.totals.addonsTotal)}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}
