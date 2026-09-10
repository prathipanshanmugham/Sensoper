import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Trash2, Upload, Download } from 'lucide-react';
import { toast } from 'sonner';
import { assetsAPI } from '../utils/api';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const API_URL = process.env.REACT_APP_BACKEND_URL;
const DOC_TYPES = [['calibration_report', 'Calibration report'], ['service_report', 'Service report'], ['invoice', 'Purchase invoice'], ['warranty', 'Warranty'], ['insurance', 'Insurance'], ['certificate', 'Certificate'], ['other', 'Other']];
const fmtSize = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Iter 52 — reports/documents attached to an asset (stored in Emergent object storage). */
export function AssetDocuments({ assetId, canManage }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState('service_report');
  const [progress, setProgress] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await assetsAPI.documents(assetId); setDocs(r.data || []); }
    catch (e) { console.warn('asset documents load failed', e); }
    finally { setLoading(false); }
  }, [assetId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setProgress(0);
    try {
      await assetsAPI.uploadDocument(assetId, file, docType, '', (ev) => setProgress(ev.total ? Math.round(ev.loaded / ev.total * 100) : 50));
      toast.success(`${file.name} attached`); await load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed'); }
    finally { setProgress(null); e.target.value = ''; }
  };
  const remove = async (d) => {
    if (!window.confirm(`Remove "${d.filename}"?`)) return;
    try { await assetsAPI.deleteDocument(assetId, d.id); toast.success('Document removed'); await load(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Delete failed'); }
  };

  return (
    <div data-testid="asset-documents">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-slate-500">Documents & reports <span className="font-normal text-slate-400">({docs.length})</span></p>
        {canManage && (
          <div className="flex items-center gap-1.5">
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="h-7 w-40 text-xs" data-testid="asset-doc-type-select"><SelectValue /></SelectTrigger>
              <SelectContent>{DOC_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls,.doc,.docx,.txt" onChange={upload} data-testid="asset-doc-file-input" />
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={progress !== null} onClick={() => fileRef.current?.click()} data-testid="asset-doc-upload-btn">
              {progress !== null ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}{progress !== null ? `${progress}%` : 'Attach'}
            </Button>
          </div>
        )}
      </div>
      {progress !== null && <div className="h-1 w-full bg-slate-100 rounded mb-1"><div className="h-1 bg-emerald-500 rounded transition-all" style={{ width: `${progress}%` }} /></div>}
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : docs.length === 0 ? <p className="text-xs text-slate-400" data-testid="asset-docs-empty">No documents attached yet{canManage ? ' — attach calibration/service reports, invoices or warranties (PDF, image, Excel, Word · max 25 MB)' : ''}.</p> : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {docs.map(d => (
            <li key={d.id} className="flex items-center gap-2 px-2 py-1.5 text-xs" data-testid={`asset-doc-${d.id}`}>
              <FileText className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-slate-800 font-medium">{d.filename}</p>
                <p className="text-[10px] text-slate-400">{DOC_TYPES.find(t => t[0] === d.doc_type)?.[1] || d.doc_type} · {fmtSize(d.size)} · {d.uploaded_by || '—'} · {d.uploaded_at?.slice(0, 10)}</p>
              </div>
              <a href={`${API_URL}${d.url}`} target="_blank" rel="noreferrer" className="text-emerald-700 hover:text-emerald-900" title="Open" data-testid={`asset-doc-open-${d.id}`}><Download className="h-3.5 w-3.5" /></a>
              {canManage && <button type="button" onClick={() => remove(d)} className="text-rose-500 hover:text-rose-700" title="Remove" data-testid={`asset-doc-delete-${d.id}`}><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
