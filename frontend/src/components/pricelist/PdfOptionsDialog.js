import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { FileDown, Loader2 } from 'lucide-react';

const plus30 = () => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); };

export function PdfOptionsDialog({ open, onOpenChange, categories, defaultCategory, onGenerate }) {
  const [opts, setOpts] = useState({ preparedFor: '', validUntil: plus30(), showGst: true, showCost: false, categories: defaultCategory && defaultCategory !== 'all' ? [defaultCategory] : categories.map(c => c.slug), notes: 'Prices are ex-works and subject to change without prior notice. Freight, installation and civil work are quoted separately.' });
  const [busy, setBusy] = useState(false);
  const toggle = (slug) => setOpts(o => ({ ...o, categories: o.categories.includes(slug) ? o.categories.filter(s => s !== slug) : [...o.categories, slug] }));
  const go = async () => { setBusy(true); try { await onGenerate(opts); onOpenChange(false); } finally { setBusy(false); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="pdf-options-dialog">
        <DialogHeader><DialogTitle>Generate Price List PDF</DialogTitle><DialogDescription>Company-branded, grouped by category, prices ex-GST with GST breakup.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Prepared for (optional)</Label><Input value={opts.preparedFor} onChange={e => setOpts(o => ({ ...o, preparedFor: e.target.value }))} placeholder="Customer / dealer name" className="h-9" data-testid="pdf-prepared-for" /></div>
            <div className="space-y-1"><Label className="text-xs">Valid until</Label><Input type="date" value={opts.validUntil} onChange={e => setOpts(o => ({ ...o, validUntil: e.target.value }))} className="h-9" data-testid="pdf-valid-until" /></div>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={opts.showGst} onChange={e => setOpts(o => ({ ...o, showGst: e.target.checked }))} data-testid="pdf-show-gst" />Show GST columns</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={opts.showCost} onChange={e => setOpts(o => ({ ...o, showCost: e.target.checked }))} data-testid="pdf-show-cost" />Include cost &amp; margin (internal copy)</label>
          </div>
          <div className="space-y-1"><Label className="text-xs">Categories</Label>
            <div className="flex flex-wrap gap-1.5">
              {categories.map(c => <button key={c.slug} onClick={() => toggle(c.slug)} className={`px-2.5 py-1 text-xs rounded-full border ${opts.categories.includes(c.slug) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200'}`} data-testid={`pdf-cat-${c.slug}`}>{c.name} ({c.count})</button>)}
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Footer note</Label><Input value={opts.notes} onChange={e => setOpts(o => ({ ...o, notes: e.target.value }))} className="h-9" data-testid="pdf-notes" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={go} disabled={busy || opts.categories.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="pdf-generate-btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Generate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
