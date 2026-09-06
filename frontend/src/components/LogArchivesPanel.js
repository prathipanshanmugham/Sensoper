import { useCallback, useEffect, useState } from 'react';
import { auditLogsAPI } from '../utils/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Archive, Download, Loader2, Trash2 } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL;

/** Iter 49 §5 — quarterly archive list + retention settings. Purge stays a deliberate admin action. */
export default function LogArchivesPanel({ isAdmin }) {
  const [archives, setArchives] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [quarter, setQuarter] = useState('');

  const load = useCallback(async () => {
    try { setArchives((await auditLogsAPI.archives()).data); } catch (e) { console.error(e); }
    if (isAdmin) { try { setCfg((await auditLogsAPI.getArchiveConfig()).data); } catch (e) { console.error(e); } }
  }, [isAdmin]);
  useEffect(() => { load(); }, [load]);

  const run = async (label, fn) => {
    setBusy(label); setMsg('');
    try { const r = await fn(); setMsg(r); } catch (e) { setMsg(e.response?.data?.detail || 'Failed'); }
    finally { setBusy(''); load(); }
  };
  const saveCfg = (patch) => run('cfg', async () => { const r = await auditLogsAPI.updateArchiveConfig({ ...cfg, ...patch }); setCfg(r.data); return 'Retention settings saved'; });
  const download = async (a, format) => {
    const res = await fetch(`${API_URL}/api/audit-logs/archives/${a.id}/download?format=${format}`, { credentials: 'include' });
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = url; el.download = `audit_logs_${a.quarter}.${format}`; el.click(); URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-slate-200" data-testid="log-archives-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Archive className="h-4 w-4 text-emerald-600" />Log Archives</CardTitle>
        <p className="text-xs text-slate-500">Each quarter is exported (PDF + Excel) to permanent storage before anything leaves the live table. Archives are never deleted; hard-delete snapshots travel inside them.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isAdmin && cfg && (
          <div className="flex flex-wrap items-center gap-4 rounded-md bg-slate-50 border border-slate-200 p-3 text-sm" data-testid="log-retention-config">
            <label className="flex items-center gap-2">Keep live <Input type="number" min={1} value={cfg.keep_quarters_live} onChange={(e) => setCfg(c => ({ ...c, keep_quarters_live: parseInt(e.target.value || '1', 10) }))} onBlur={() => saveCfg({})} className="h-8 w-16" data-testid="retention-quarters-input" /> quarters</label>
            <label className="flex items-center gap-2"><Switch checked={cfg.auto_archive} onCheckedChange={(v) => saveCfg({ auto_archive: v })} data-testid="auto-archive-switch" />Auto-archive at quarter end</label>
            <label className="flex items-center gap-2"><Switch checked={cfg.auto_purge} onCheckedChange={(v) => saveCfg({ auto_purge: v })} data-testid="auto-purge-switch" />Auto-purge after archive <span className="text-[11px] text-slate-500">(off = manual purge only)</span></label>
            <div className="flex items-center gap-2 ml-auto">
              <Input placeholder="e.g. 2026-Q1" value={quarter} onChange={(e) => setQuarter(e.target.value)} className="h-8 w-28" data-testid="archive-quarter-input" />
              <Button size="sm" variant="outline" disabled={!!busy || !quarter} onClick={() => run('run', async () => { const r = await auditLogsAPI.runArchive(quarter); return `${r.data.quarter}: ${r.data.status} (${r.data.row_count} rows)`; })} data-testid="archive-run-btn">
                {busy === 'run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5 mr-1" />}Archive quarter now
              </Button>
            </div>
          </div>
        )}
        {msg && <p className="text-xs text-slate-700" data-testid="log-archive-msg">{msg}</p>}
        {archives.length === 0 ? <p className="text-xs text-slate-400">No archives yet — the first one is created automatically after the current quarter ends.</p> : (
          <table className="w-full text-sm" data-testid="log-archives-table">
            <thead><tr className="text-left text-slate-500 border-b"><th className="py-1.5">Quarter</th><th>Status</th><th>Rows</th><th>Deletion snapshots</th><th>Created</th><th>Purged</th><th className="text-right">Files</th></tr></thead>
            <tbody>{archives.map(a => (
              <tr key={a.id} className="border-b last:border-0" data-testid={`archive-row-${a.quarter}`}>
                <td className="py-1.5 font-medium">{a.quarter}</td>
                <td><span className={`px-2 py-0.5 rounded-full text-[11px] ${a.status === 'archived' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{a.status}</span>{a.error && <span className="ml-2 text-[11px] text-rose-600">{a.error}</span>}</td>
                <td>{a.row_count}</td><td>{a.deletion_snapshot_count}</td>
                <td className="text-slate-500">{(a.created_at || '').slice(0, 10)}</td>
                <td className="text-slate-500">{a.purged_at ? `${a.purged_at.slice(0, 10)} (${a.purged_rows} rows)` : '—'}</td>
                <td className="text-right whitespace-nowrap">
                  {a.status === 'archived' && <>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => download(a, 'xlsx')} data-testid={`archive-download-xlsx-${a.quarter}`}><Download className="h-3.5 w-3.5 mr-1" />Excel</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => download(a, 'pdf')} data-testid={`archive-download-pdf-${a.quarter}`}><Download className="h-3.5 w-3.5 mr-1" />PDF</Button>
                    {isAdmin && !a.purged_at && <Button size="sm" variant="ghost" className="h-7 px-2 text-rose-700" disabled={!!busy} onClick={() => { if (window.confirm(`Purge live logs for ${a.quarter}? The archive stays available forever.`)) run('purge', async () => { const r = await auditLogsAPI.purgeQuarter(a.quarter); return `Purged ${r.data.purged_rows} live rows for ${a.quarter}`; }); }} data-testid={`archive-purge-${a.quarter}`}><Trash2 className="h-3.5 w-3.5 mr-1" />Purge live</Button>}
                  </>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
