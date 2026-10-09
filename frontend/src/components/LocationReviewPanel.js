import { useCallback, useEffect, useState } from 'react';
import { locationReviewAPI } from '../utils/api';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { MapPinOff, Wand2, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

/** Iter 60 — projects Expansion would bucket as "Unknown": one row each, district/state/PIN typed inline, saved in one click. */
export function LocationReviewPanel({ onChanged }) {
  const [data, setData] = useState({ count: 0, items: [] });
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState('');
  const [drafts, setDrafts] = useState({});
  const [autoResult, setAutoResult] = useState(null);

  const load = useCallback(async () => { try { const r = await locationReviewAPI.list(); setData(r.data); } catch (e) { toast.error(e.response?.data?.detail || 'Could not load location review'); } }, []);
  useEffect(() => { load(); }, [load]);

  const autoResolve = async () => {
    setBusy('auto');
    try { const r = await locationReviewAPI.autoResolve(); setAutoResult(r.data); toast.success(`${r.data.resolved_count} resolved automatically · ${r.data.remaining_count} still need you`); await load(); onChanged?.(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Auto-resolve failed'); } finally { setBusy(''); }
  };
  const fix = async (row) => {
    const d = drafts[row.id] || {};
    if (!d.district?.trim()) { toast.error('Type the district'); return; }
    setBusy(row.id);
    try { await locationReviewAPI.fix(row.id, { district: d.district.trim(), state: d.state?.trim() || row.state || null, pincode: d.pincode?.trim() || row.pincode || null }); toast.success(`${row.customer_name || row.reference_number}: ${d.district.trim()}`); await load(); onChanged?.(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not save'); } finally { setBusy(''); }
  };
  const setD = (id, k, v) => setDrafts(p => ({ ...p, [id]: { ...(p[id] || {}), [k]: v } }));

  return (
    <div className={`rounded-xl border-2 ${data.count ? 'border-amber-300 bg-amber-50/40' : 'border-emerald-200 bg-emerald-50/30'}`} data-testid="location-review-panel">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <MapPinOff className={`h-5 w-5 ${data.count ? 'text-amber-600' : 'text-emerald-600'}`} />
        <div className="flex-1 min-w-[220px]">
          <div className="text-sm font-semibold text-slate-900">Needs Location Review <Badge className={`ml-1 ${data.count ? 'bg-amber-500' : 'bg-emerald-600'} text-white`} data-testid="location-review-count">{data.count}</Badge></div>
          <p className="text-[11px] text-slate-600">Projects with no resolved district are invisible to every district chart and score below. Type the district and save — five seconds each.</p>
        </div>
        <Button size="sm" variant="outline" onClick={autoResolve} disabled={busy === 'auto' || !data.count} className="h-8 gap-1" data-testid="location-review-auto"><Wand2 className="h-3.5 w-3.5" />{busy === 'auto' ? 'Resolving…' : 'Auto-resolve all'}</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setOpen(o => !o)} data-testid="location-review-toggle">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
      </div>
      {autoResult && <p className="px-4 pb-2 text-[11px] text-slate-600" data-testid="location-review-auto-result">Last pass: {autoResult.resolved_count} fixed automatically{autoResult.resolved.slice(0, 5).map(r => ` · ${r.customer_name || r.reference_number} → ${r.district}`)}{autoResult.resolved_count > 5 ? ' …' : ''}</p>}
      {open && data.count > 0 && (
        <div className="max-h-96 overflow-y-auto border-t border-amber-200/60">
          <table className="w-full text-xs">
            <thead className="bg-white/60 text-[10px] uppercase tracking-wider text-slate-500 sticky top-0"><tr><th className="text-left px-3 py-1.5">Project</th><th className="text-left px-3 py-1.5">Address on file</th><th className="text-left px-3 py-1.5">District</th><th className="text-left px-3 py-1.5">State</th><th className="text-left px-3 py-1.5">PIN</th><th className="px-3 py-1.5" /></tr></thead>
            <tbody className="divide-y divide-amber-100">
              {data.items.map(r => (
                <tr key={r.id} className="bg-white/70" data-testid={`lr-row-${r.id}`}>
                  <td className="px-3 py-1.5"><p className="font-medium text-slate-800">{r.customer_name || '—'}</p><p className="text-[10px] text-slate-400">{r.reference_number || r.id.slice(-6)} · {r.status} · {(r.created_at || '').slice(0, 10)}</p></td>
                  <td className="px-3 py-1.5 text-slate-600 max-w-[260px] truncate" title={r.location_text}>{r.location_text || <span className="text-slate-300">no address</span>}</td>
                  <td className="px-3 py-1.5"><Input value={drafts[r.id]?.district ?? ''} onChange={e => setD(r.id, 'district', e.target.value)} onKeyDown={e => e.key === 'Enter' && fix(r)} placeholder="District" className="h-7 w-32 text-xs bg-white" data-testid={`lr-district-${r.id}`} /></td>
                  <td className="px-3 py-1.5"><Input value={drafts[r.id]?.state ?? r.state ?? ''} onChange={e => setD(r.id, 'state', e.target.value)} placeholder="State" className="h-7 w-28 text-xs bg-white" data-testid={`lr-state-${r.id}`} /></td>
                  <td className="px-3 py-1.5"><Input value={drafts[r.id]?.pincode ?? r.pincode ?? ''} onChange={e => setD(r.id, 'pincode', e.target.value)} placeholder="PIN" className="h-7 w-20 text-xs bg-white" data-testid={`lr-pin-${r.id}`} /></td>
                  <td className="px-3 py-1.5"><Button size="sm" onClick={() => fix(r)} disabled={busy === r.id || !drafts[r.id]?.district?.trim()} className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid={`lr-save-${r.id}`}>{busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
