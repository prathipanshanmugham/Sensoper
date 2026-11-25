/* Odoo data — a copied Odoo table (or the customers that came from Odoo): search, page through, download as CSV. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Search, Download, Loader2, Table2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Empty, Loading, inputCls, errText } from '../components/kit/PageBits';
import { odooAPI } from '../utils/api';
import { useHotkeys } from '../lib/hotkeys';

const cell = (v) => (v === null || v === undefined || v === '' ? '' : v === true ? 'Yes' : v === false ? 'No' : String(v));
const csvCell = (v) => { const s = cell(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default function OdooDataPage() {
  const { key } = useParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef(null);
  const load = useCallback(async () => {
    try { const r = await odooAPI.data(key, { q: q || undefined, page, size: 50 }); setData(r.data); }
    catch (e) { toast.error(errText(e, 'Couldn’t load this table')); setData((d) => d || { rows: [], columns: [], total: 0 }); }
  }, [key, q, page]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setPage(1); }, [q]);
  useHotkeys([{ keys: '/', run: () => searchRef.current?.focus() }], []);

  const download = async () => {
    setBusy(true);
    try {
      let rows = [];
      for (let p = 1; p <= 25; p += 1) {
        const r = await odooAPI.data(key, { q: q || undefined, page: p, size: 200 });
        rows = rows.concat(r.data.rows);
        if (rows.length >= r.data.total || r.data.rows.length === 0) break;
      }
      const cols = data.columns;
      const csv = [['Odoo ID', ...cols.map((c) => c.label)].map(csvCell).join(','), ...rows.map((r) => [r.odoo_id, ...cols.map((c) => r[c.key])].map(csvCell).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
      a.download = `${(data.label || key).replace(/[^\w-]+/g, '_')}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { toast.error(errText(e, 'Couldn’t download')); } finally { setBusy(false); }
  };

  if (!data) return <Loading />;
  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.size || 50)));
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6" data-testid="odoo-data-page">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/dashboard/odoo" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Back to Odoo sync"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="mr-auto min-w-0">
          <h1 className="font-['Outfit'] text-xl font-semibold text-slate-900">{data.label}</h1>
          <p className="text-xs text-slate-500">From Odoo ({data.model}) · {data.total} record{data.total === 1 ? '' : 's'} · read-only copy, updated by the Odoo sync</p>
        </div>
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} className={`${inputCls} pl-9`} placeholder="Search" data-shortcut="search" data-testid="odoo-data-search" />
        </label>
        <Button variant="outline" className="h-10 gap-1.5" onClick={download} disabled={busy || !data.total} data-testid="odoo-data-csv">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}CSV</Button>
      </div>
      {data.rows.length === 0 ? (
        <Empty icon={Table2} title={q ? `Nothing matches “${q}”` : 'Nothing copied yet'} text="Press Sync now on the Odoo sync page to bring this table in." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>{data.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">{c.label}</th>)}<th className="px-3 py-2 text-right font-medium">Odoo ID</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                  {data.columns.map((c) => <td key={c.key} className="max-w-[320px] px-3 py-2 text-slate-800"><span className="line-clamp-3">{cell(r[c.key])}</span></td>)}
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-400">{r.odoo_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-slate-600">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
