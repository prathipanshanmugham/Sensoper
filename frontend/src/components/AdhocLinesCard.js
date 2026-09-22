import { useState, useEffect, useCallback } from 'react';
import { adhocAPI, materialKitsAPI, invoicingAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import { PackagePlus, AlertTriangle, Loader2, Boxes, Link2, CheckCircle2 } from 'lucide-react';

/** Iter 55 — ad-hoc lines on a confirmed project: promote to inventory (+ invoice), then optionally feed a Solution Kit. */
export default function AdhocLinesCard({ projectId, canManage, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState({});           // line_id → existing inventory id chosen instead of creating
  const [kitPrompt, setKitPrompt] = useState(null); // { promoted: [...] }
  const [kits, setKits] = useState([]);
  const [kitSel, setKitSel] = useState({});         // line_id → { kit_id, quantity, qty_formula, done }

  const load = useCallback(() => adhocAPI.list(projectId).then(r => setData(r.data)).catch(() => setData(null)), [projectId]);
  useEffect(() => { load(); }, [load]);

  if (!data || data.lines.length === 0) return null;
  const pending = data.lines.filter(l => !l.promoted);

  const promote = async (lineIds) => {
    setBusy(true);
    try {
      const r = await adhocAPI.promote(projectId, { line_ids: lineIds, link_existing: Object.fromEntries(Object.entries(links).filter(([k]) => !lineIds || lineIds.includes(k))) });
      const created = r.data.promoted;
      toast.success(`${created.length} line${created.length === 1 ? '' : 's'} now in inventory (stock 0 until received)`);
      let inv = null;
      if (!data.invoice_number) {
        try { const ir = await invoicingAPI.generateInvoice(projectId); inv = ir.data.invoice_number; toast.success(`Invoice ${inv} generated with SKU/HSN references`); }
        catch (e) { toast.error(e.response?.data?.detail || 'Promoted, but invoice could not be generated yet'); }
      } else {
        toast.message(`Invoice ${data.invoice_number} already exists — it keeps the originally quoted lines (price lock)`);
      }
      const ks = await materialKitsAPI.getAll().catch(() => ({ data: [] }));
      setKits(ks.data || []);
      setKitPrompt({ promoted: created });
      setKitSel(Object.fromEntries(created.map(c => [c.line_id, { kit_id: '', quantity: 1, qty_formula: '', done: false }])));
      await load(); onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || 'Promotion failed'); }
    finally { setBusy(false); }
  };

  const addToKit = async (line) => {
    const sel = kitSel[line.line_id];
    if (!sel?.kit_id) return;
    try {
      const r = await adhocAPI.addToKit(projectId, line.line_id, { kit_id: sel.kit_id, quantity: parseFloat(sel.quantity) || 1, qty_formula: sel.qty_formula || null });
      toast.success(r.data.message);
      setKitSel(p => ({ ...p, [line.line_id]: { ...p[line.line_id], done: true } }));
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not add to kit'); }
  };

  return (
    <>
      <Card className="border-amber-200" data-testid="adhoc-lines-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><PackagePlus className="h-4 w-4 text-amber-600" />Items not yet in inventory
            <Badge variant="secondary" className="ml-auto" data-testid="adhoc-pending-count">{pending.length} pending</Badge>
          </CardTitle>
          <p className="text-xs text-slate-500">Provisional lines quoted to the customer. {data.can_promote ? 'Project is confirmed — promote them to real catalogue items (starting stock 0).' : `Promotion unlocks once the project is confirmed (currently '${data.project_status}').`}</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.lines.map(l => (
            <div key={l.line_id} className="p-3 rounded-lg border border-slate-200 bg-white" data-testid={`adhoc-line-${l.line_id}`}>
              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-medium text-slate-900 flex items-center gap-2">{l.name}
                    {l.promoted ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]" data-testid={`adhoc-promoted-${l.line_id}`}><CheckCircle2 className="h-3 w-3 mr-1" />In inventory · {l.sku_code}</Badge>
                      : <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">Not yet in inventory</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{l.category}{l.specification ? ` · ${l.specification}` : ''} · ₹{Number(l.unit_price).toLocaleString('en-IN')} × {l.quantity} · GST {l.gst_percentage}%{l.hsn_code ? ` · HSN ${l.hsn_code}` : ''}{l.supplier_hint ? ` · from ${l.supplier_hint}` : ''}</p>
                </div>
                {canManage && !l.promoted && data.can_promote && (
                  <Button size="sm" disabled={busy} onClick={() => promote([l.line_id])} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid={`adhoc-promote-${l.line_id}`}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Boxes className="h-3.5 w-3.5 mr-1" />{links[l.line_id] ? 'Link & Invoice' : 'Add to Inventory & Invoice'}</>}</Button>
                )}
              </div>
              {!l.promoted && l.similar?.length > 0 && (
                <div className="mt-2 p-2 rounded bg-amber-50 border border-amber-200 text-xs" data-testid={`adhoc-similar-${l.line_id}`}>
                  <p className="text-amber-800 font-medium flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Looks similar to an existing item — link instead of creating a near-duplicate?</p>
                  <div className="mt-1 space-y-1">
                    <label className="flex items-center gap-2 text-slate-700"><input type="radio" name={`link-${l.line_id}`} checked={!links[l.line_id]} onChange={() => setLinks(p => { const c = { ...p }; delete c[l.line_id]; return c; })} data-testid={`adhoc-link-none-${l.line_id}`} />Create new item "{l.name}"</label>
                    {l.similar.map(s => (
                      <label key={s.id} className="flex items-center gap-2 text-slate-700"><input type="radio" name={`link-${l.line_id}`} checked={links[l.line_id] === s.id} onChange={() => setLinks(p => ({ ...p, [l.line_id]: s.id }))} data-testid={`adhoc-link-${l.line_id}-${s.id}`} /><Link2 className="h-3 w-3 text-sky-600" />Link to <span className="font-medium">{s.name}</span> <span className="text-slate-400">({s.sku_code} · ₹{Number(s.unit_price || 0).toLocaleString('en-IN')} · {Math.round(s.similarity * 100)}% match)</span></label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {canManage && data.can_promote && pending.length > 1 && (
            <div className="flex justify-end"><Button disabled={busy} onClick={() => promote(null)} variant="outline" className="border-emerald-300 text-emerald-800" data-testid="adhoc-promote-all">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Boxes className="h-4 w-4 mr-1" />Add all {pending.length} to Inventory & Invoice</>}</Button></div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!kitPrompt} onOpenChange={v => !v && setKitPrompt(null)}>
        <DialogContent className="max-w-lg" data-testid="adhoc-kit-dialog">
          <DialogHeader><DialogTitle>Add to a Solution Kit?</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">Optional — makes the item a standard kit line so the next similar quote doesn't need manual entry. Skip for genuinely one-off items.</p>
          <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            {(kitPrompt?.promoted || []).map(c => {
              const sel = kitSel[c.line_id] || {};
              return (
                <div key={c.line_id} className="p-2 rounded border border-slate-200 space-y-2" data-testid={`adhoc-kit-row-${c.line_id}`}>
                  <p className="text-sm font-medium">{c.name} <span className="text-xs text-slate-400">{c.sku_code}</span>{sel.done && <Badge className="ml-2 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">Added</Badge>}</p>
                  {!sel.done && (
                    <div className="grid grid-cols-6 gap-2 items-end">
                      <div className="col-span-3 space-y-1"><Label className="text-xs">Kit</Label>
                        <Select value={sel.kit_id} onValueChange={v => setKitSel(p => ({ ...p, [c.line_id]: { ...p[c.line_id], kit_id: v } }))}><SelectTrigger className="h-9" data-testid={`adhoc-kit-select-${c.line_id}`}><SelectValue placeholder="Choose kit" /></SelectTrigger>
                          <SelectContent className="max-h-60">{kits.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label className="text-xs">Qty</Label><Input type="number" min="0" step="0.5" value={sel.quantity} onChange={e => setKitSel(p => ({ ...p, [c.line_id]: { ...p[c.line_id], quantity: e.target.value } }))} className="h-9" data-testid={`adhoc-kit-qty-${c.line_id}`} /></div>
                      <div className="col-span-2 space-y-1"><Label className="text-xs">Formula (optional)</Label><Input value={sel.qty_formula} onChange={e => setKitSel(p => ({ ...p, [c.line_id]: { ...p[c.line_id], qty_formula: e.target.value } }))} placeholder="1 per kW" className="h-9" data-testid={`adhoc-kit-formula-${c.line_id}`} /></div>
                      <div className="col-span-6 flex justify-end"><Button size="sm" disabled={!sel.kit_id} onClick={() => addToKit(c)} className="h-8" data-testid={`adhoc-kit-add-${c.line_id}`}>Add to kit</Button></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setKitPrompt(null)} data-testid="adhoc-kit-skip">Skip / Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
