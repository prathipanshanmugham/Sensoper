import { useState } from 'react';
import { invoicingAPI } from '../utils/api';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Loader2, Receipt, Download } from 'lucide-react';
import { generateGstInvoicePDF } from '../utils/gstInvoicePDF';

const FORMAT_STORAGE_KEY = 'sensoper_invoice_format_pref';

/** GST Tax Invoice — separate legal document from the sales quotation PDF (Iter 44 Batch A).
 * Offers List (per line item) and Combined (rolled up per GST rate slab) formats — both
 * legally complete, last choice remembered per-browser (Iter 45). */
export default function ProjectInvoiceCard({ projectId, companyProfile }) {
  const [invoice, setInvoice] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [format, setFormat] = useState(() => localStorage.getItem(FORMAT_STORAGE_KEY) || 'list');

  const chooseFormat = (f) => { setFormat(f); localStorage.setItem(FORMAT_STORAGE_KEY, f); };

  const handleGenerate = async () => {
    setLoading(true); setError('');
    try {
      const r = await invoicingAPI.generateInvoice(projectId);
      setInvoice(r.data);
      setShowPreview(true);
    } catch (e) { setError(e.response?.data?.detail || 'Could not generate invoice'); }
    finally { setLoading(false); }
  };

  const handleDownload = () => { if (invoice) generateGstInvoicePDF(invoice, companyProfile, format); };

  return (
    <>
      <div className="inline-flex items-center gap-2">
        <Button variant="outline" onClick={handleGenerate} disabled={loading} className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50" data-testid="generate-invoice-btn">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}Generate Invoice
        </Button>
        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden" data-testid="invoice-format-toggle">
          <button type="button" onClick={() => chooseFormat('list')} className={`px-2.5 py-1.5 text-xs font-medium ${format === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`} data-testid="invoice-format-list">List</button>
          <button type="button" onClick={() => chooseFormat('combined')} className={`px-2.5 py-1.5 text-xs font-medium ${format === 'combined' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`} data-testid="invoice-format-combined">Combined</button>
        </div>
      </div>
      {error && <p className="text-xs text-rose-600 mt-1" data-testid="invoice-error">{error}</p>}

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="invoice-preview-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Receipt className="h-5 w-5 text-blue-600" />Tax Invoice {invoice?.invoice_number}</DialogTitle>
            <DialogDescription>{invoice?.already_existed ? 'Previously generated for this project — the number never changes.' : 'Generated from this project\'s confirmed cost data.'}</DialogDescription>
          </DialogHeader>
          {invoice && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-slate-400">Invoice Date</p><p className="font-medium">{new Date(invoice.invoice_date).toLocaleDateString('en-IN')}</p></div>
                <div><p className="text-xs text-slate-400">Place of Supply</p><p className="font-medium">{invoice.place_of_supply}</p></div>
                <div><p className="text-xs text-slate-400">Customer GSTIN</p><p className="font-medium">{invoice.customer?.gstin || '—'}</p></div>
                <div><p className="text-xs text-slate-400">Reverse Charge</p><p className="font-medium">{invoice.reverse_charge ? 'Yes' : 'No'}</p></div>
              </div>
              <table className="w-full text-xs border border-slate-200 rounded" data-testid="invoice-line-items-table">
                <thead className="bg-slate-50"><tr><th className="text-left p-2">Item</th><th className="text-left p-2">HSN</th><th className="text-right p-2">Taxable</th><th className="text-right p-2">GST</th></tr></thead>
                <tbody>
                  {invoice.line_items.map((li, i) => (
                    <tr key={i} className="border-t border-slate-100"><td className="p-2">{li.description}</td><td className="p-2">{li.hsn_sac || '—'}</td><td className="p-2 text-right">₹{li.taxable_value.toLocaleString('en-IN')}</td><td className="p-2 text-right">{invoice.total_igst > 0 ? `IGST ₹${li.igst}` : `₹${li.cgst + li.sgst}`}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-between font-bold text-base pt-2 border-t"><span>Grand Total</span><span data-testid="invoice-grand-total">₹{invoice.grand_total.toLocaleString('en-IN')}</span></div>
              <p className="text-xs text-slate-500 italic">{invoice.amount_in_words}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>Close</Button>
            <Button onClick={handleDownload} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white" data-testid="download-invoice-pdf-btn"><Download className="h-4 w-4" />Download PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
