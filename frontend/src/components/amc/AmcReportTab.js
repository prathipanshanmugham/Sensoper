/* AMC report: pick the period, read the numbers, download PDF / Excel. */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { amcAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import Can from '../Can';
import { inr } from './amcCommon';
import { amcReportExcel, amcReportPDF } from '../../utils/amcPdf';

const BLUE = '#2a78d6', ORANGE = '#eb6834';
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;  // local date, not UTC
const monthLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });

function Tile({ label, value, testid }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid={testid}>
      <p className="font-['Outfit'] text-xl font-bold tabular-nums text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

export default function AmcReportTab() {
  const today = new Date();
  const [start, setStart] = useState(iso(new Date(today.getFullYear(), today.getMonth() - 11, 1)));
  const [end, setEnd] = useState(iso(today));
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    setRep(null);
    amcAPI.report({ start, end }).then((r) => setRep(r.data)).catch((e) => { toast.error(e.response?.data?.detail || 'Could not load the report'); setRep(false); });
  }, [start, end]);
  useEffect(() => { load(); }, [load]);

  const pdf = async () => {
    setBusy('pdf');
    try {
      let cp = {};
      try { cp = (await amcAPI.brand()).data || cp; } catch { /* name only */ }   // the company chosen in AMC settings
      await amcReportPDF(rep, { companyProfile: cp });
    } catch (e) { console.error(e); toast.error('Could not make the PDF'); } finally { setBusy(''); }
  };

  const s = rep?.summary;
  const chart = (rep?.monthly || []).map((m) => ({ month: monthLabel(m.month), 'New contracts': m.new_contracts, Renewals: m.renewals }));
  return (
    <div className="space-y-4" data-testid="amc-report-tab">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="h-10" data-testid="amc-report-start" /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="h-10" data-testid="amc-report-end" /></div>
        <div className="ml-auto flex gap-2">
          <Can module="module_amc" action="export"><Button variant="outline" className="h-10 gap-1.5" onClick={pdf} disabled={!rep || busy === 'pdf'} data-testid="amc-report-pdf">{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}PDF</Button></Can>
          <Can module="module_amc" action="export"><Button variant="outline" className="h-10 gap-1.5" onClick={() => amcReportExcel(rep)} disabled={!rep} data-testid="amc-report-excel"><FileSpreadsheet className="h-4 w-4" />Excel</Button></Can>
        </div>
      </div>
      {rep === null && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {rep && (
        <>
          <p className="text-sm text-slate-600">{new Date(rep.period.start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} – {new Date(rep.period.end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Active contracts" value={s.active_contracts} testid="amc-rep-active" />
            <Tile label="Yearly value" value={inr(s.yearly_value)} testid="amc-rep-value" />
            <Tile label="kW under AMC" value={s.capacity_kw} />
            <Tile label="New · renewed · cancelled" value={`${s.new_contracts} · ${s.renewals} · ${s.cancelled}`} />
            <Tile label="Visits done · planned" value={`${s.visits_done} · ${s.visits_scheduled}`} />
            <Tile label="Visits overdue" value={s.visits_overdue} />
            <Tile label="Customers to offer AMC" value={s.offers_due} testid="amc-rep-offers" />
            <Tile label={`Quotes won (of ${s.quotes_made})`} value={`${s.quotes_accepted} · ${s.quote_win_pct}%`} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-2 text-sm font-semibold text-slate-900">Contracts started, month by month</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="New contracts" stackId="a" fill={BLUE} radius={[0, 0, 0, 0]} />
                <Bar dataKey="Renewals" stackId="a" fill={ORANGE} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {[['Renewals due in the next 60 days', rep.renewals_due, ['contract_number', 'customer', 'end_date'], ['Contract', 'Customer', 'Ends']],
            ['Customers to offer AMC', rep.offers_due, ['customer', 'kw', 'due_on', 'quote'], ['Customer', 'kW', 'Due', 'Quote']],
            ['Contracts', rep.contracts.slice(0, 50), ['contract_number', 'customer', 'plan', 'end_date', 'status'], ['Contract', 'Customer', 'Plan', 'Ends', 'Status']]]
            .filter(([, rows]) => rows.length).map(([title, rows, keys, heads]) => (
              <div key={title} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">{title} <span className="font-normal text-slate-400">({rows.length})</span></p>
                <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{heads.map((h) => <th key={h} className="p-2 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">{rows.map((r, i) => <tr key={i}>{keys.map((k) => <td key={k} className="p-2 text-slate-700">{r[k] ?? '—'}</td>)}</tr>)}</tbody></table>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
