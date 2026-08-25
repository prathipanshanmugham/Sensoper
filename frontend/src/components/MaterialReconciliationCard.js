import { useState, useEffect, useCallback } from 'react';
import { reconciliationAPI } from '../utils/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Loader2, PackageCheck, Save, AlertTriangle } from 'lucide-react';

/** Excess Material Report — reconciliation form shown once a project is completed (Iter 42 Change 4). */
export default function MaterialReconciliationCard({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const r = await reconciliationAPI.get(projectId); setData(r.data); }
    catch (e) { setError('Could not load reconciliation data'); } finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const updateLine = (i, field, val) => setData(p => { const lines = [...p.lines]; lines[i] = { ...lines[i], [field]: val }; return { ...p, lines }; });

  const save = async (status) => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const lines = data.lines.map(l => ({
        ...l,
        qty_consumed: parseFloat(l.qty_consumed) || 0,
        qty_returned: parseFloat(l.qty_returned) || 0,
        qty_damaged: parseFloat(l.qty_damaged) || 0,
        qty_at_site: parseFloat(l.qty_at_site) || 0,
      }));
      await reconciliationAPI.submit(projectId, { lines, status });
      setSaved(true); await fetchData();
    } catch (e) { setError(e.response?.data?.detail || 'Could not save'); } finally { setSaving(false); }
  };

  if (loading) return <Card className="border-slate-200"><CardContent className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></CardContent></Card>;
  if (!data) return null;

  return (
    <Card className="border-amber-200" data-testid="material-reconciliation-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2 justify-between">
          <span className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-amber-600" />Material Reconciliation</span>
          <Badge className={data.status === 'verified' ? 'bg-emerald-100 text-emerald-700' : data.status === 'submitted' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'} data-testid="reconciliation-status-badge">
            {data.status === 'pending' ? 'Not filled yet' : data.status}
          </Badge>
        </CardTitle>
        <p className="text-xs text-slate-500">What was issued vs consumed, returned, damaged, or left at site — required to close this job out cleanly.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.lines.length === 0 && <p className="text-sm text-slate-400">No bill-of-materials found for this project.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="reconciliation-table">
            <thead>
              <tr className="text-slate-400 uppercase text-[10px]">
                <th className="text-left p-1.5">Item</th>
                <th className="text-right p-1.5">Issued</th>
                <th className="text-right p-1.5">Consumed</th>
                <th className="text-right p-1.5">Returned</th>
                <th className="text-right p-1.5">Damaged</th>
                <th className="text-right p-1.5">At Site</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.lines.map((l, i) => (
                <tr key={i}>
                  <td className="p-1.5 font-medium text-slate-700 max-w-[140px] truncate">{l.name}</td>
                  <td className="p-1.5 text-right text-slate-500">{l.qty_issued}</td>
                  <td className="p-1.5"><Input type="number" value={l.qty_consumed} onChange={(e) => updateLine(i, 'qty_consumed', e.target.value)} className="h-8 w-20 text-right" data-testid={`recon-consumed-${i}`} /></td>
                  <td className="p-1.5"><Input type="number" value={l.qty_returned} onChange={(e) => updateLine(i, 'qty_returned', e.target.value)} className="h-8 w-20 text-right" data-testid={`recon-returned-${i}`} /></td>
                  <td className="p-1.5"><Input type="number" value={l.qty_damaged} onChange={(e) => updateLine(i, 'qty_damaged', e.target.value)} className="h-8 w-20 text-right" data-testid={`recon-damaged-${i}`} /></td>
                  <td className="p-1.5"><Input type="number" value={l.qty_at_site} onChange={(e) => updateLine(i, 'qty_at_site', e.target.value)} className="h-8 w-20 text-right" data-testid={`recon-atsite-${i}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && <p className="text-xs text-rose-600 flex items-center gap-1" data-testid="reconciliation-error"><AlertTriangle className="h-3.5 w-3.5" />{error}</p>}
        {saved && <p className="text-xs text-emerald-600">Saved.</p>}
        {data.lines.length > 0 && (
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => save('submitted')} disabled={saving} data-testid="save-reconciliation-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => save('verified')} disabled={saving} data-testid="verify-reconciliation-btn">Mark Verified</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
