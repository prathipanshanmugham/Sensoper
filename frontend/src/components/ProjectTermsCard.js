import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectsAPI, termsAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

/** Iter 53 — pick which T&C template prints on the Quotation / Detailed PDF (terms_id) and the GST Invoice (invoice_terms_id). */
export default function ProjectTermsCard({ projectId, project, canManage, onSaved }) {
  const [quoteList, setQuoteList] = useState([]);
  const [invoiceList, setInvoiceList] = useState([]);
  const [saving, setSaving] = useState('');

  useEffect(() => {
    Promise.all([termsAPI.getAll('quotation'), termsAPI.getAll('invoice')])
      .then(([q, i]) => { setQuoteList(q.data || []); setInvoiceList(i.data || []); })
      .catch(e => console.warn('terms list failed', e));
  }, []);

  const save = async (field, value) => {
    setSaving(field);
    try {
      await projectsAPI.update(projectId, { [field]: value === 'none' ? '' : value });
      toast.success(field === 'terms_id' ? 'Quotation terms updated' : 'Invoice terms updated');
      onSaved?.();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not save terms selection'); }
    finally { setSaving(''); }
  };

  const label = (t) => `${t.title} (v${t.version}, ${t.language === 'en' ? 'EN' : 'TA'})${t.is_active ? '' : ' — inactive'}`;

  return (
    <Card data-testid="project-terms-card">
      <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><FileText className="h-4 w-4 text-emerald-600" />Terms & Conditions on documents</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Quotation & Detailed PDF {saving === 'terms_id' && <Loader2 className="inline h-3 w-3 animate-spin" />}</Label>
          <Select value={project.terms_id || 'none'} onValueChange={(v) => save('terms_id', v)} disabled={!canManage}>
            <SelectTrigger className="h-9" data-testid="project-terms-select"><SelectValue placeholder="Standard terms" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Active standard quotation terms —</SelectItem>
              {quoteList.map(t => <SelectItem key={t.id} value={t.id} data-testid={`project-terms-option-${t.id}`}>{label(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">GST Invoice {saving === 'invoice_terms_id' && <Loader2 className="inline h-3 w-3 animate-spin" />}</Label>
          <Select value={project.invoice_terms_id || 'none'} onValueChange={(v) => save('invoice_terms_id', v)} disabled={!canManage}>
            <SelectTrigger className="h-9" data-testid="project-invoice-terms-select"><SelectValue placeholder="Standard invoice terms" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Active standard invoice terms —</SelectItem>
              {invoiceList.map(t => <SelectItem key={t.id} value={t.id} data-testid={`project-invoice-terms-option-${t.id}`}>{label(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[11px] text-slate-500 sm:col-span-2" data-testid="project-terms-hint">Changing these re-renders the next PDF you download — works in any project status.</p>
      </CardContent>
    </Card>
  );
}
