/* AMC report: pick the company and the period, read the numbers, download PDF / Excel. */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { amcAPI, companyAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import Can from '../Can';
import { ALL, imageDataUrl, inr, logoUrl, OrgSelect } from './jv';
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

export default function AmcReportTab({ jv, org: pageOrg }) {
  const today = new Date();
  const [org, setOrg] = useState(pageOrg);
  const [start, setStart] = useState(iso(new Date(today.getFullYear(), today.getMonth() - 11, 1)));
  const [end, setEnd] = useState(iso(today));
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { setOrg(pageOrg); }, [pageOrg]);
  const load = useCallback(() => {
    setRep(null);
    amcAPI.report({ org: jv?.is_partner ? undefined : org, start, end }).then((r) => setRep(r.data)).catch((e) => { toast.error(e.response?.data?.detail || 'Could not load the report'); setRep(false); });
  }, [org, start, end, jv?.is_partner]);
  useEffect(() => { load(); }, [load]);

  const partner = jv?.is_partner ? jv.partners?.[0] : (org !== ALL ? jv?.partners?.find((p) => p.id === org) : null);
  const pdf = async () => {
    setBusy('pdf');
    try {
      let cp = { company_name: jv?.ours?.name };
      if (!jv?.is_partner) { try { cp = (await companyAPI.getActive()).data || cp; } catch { /* name only */ } }
      const partnerLogo = partner?.logo_path ? await imageDataUrl(logoUrl(partner.logo_path)) : null;
      await amcReportPDF(rep, { companyProfile: cp, partner, partnerLogo });
    } catch (e) { console.error(e); toast.error('Could not make the PDF'); } finally { setBusy(''); }
  };

  const s = rep?.summary;
  const chart = (rep?.monthly || []).map((m) => ({ month: monthLabel(m.month), 'New contracts': m.new_contracts, Renewals: m.renewals }));
  return (
    <div className="space-y-4" data-testid="amc-report-tab">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        {!jv?.is_partner && jv?.partners?.length > 0 && <div className="w-full space-y-1 sm:w-56"><Label className="text-xs">Company</Label><OrgSelect jv={jv} value={org} onChange={setOrg} /></div>}
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
          <p className="text-sm text-slate-600"><b className="text-slate-900">{rep.org_label}</b> · {new Date(rep.period.start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} – {new Date(rep.period.end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
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
          {rep.by_org?.length > 1 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="amc-rep-by-org">
              <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900">By company</p>
              <table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left">Company</th><th className="p-2 text-right">Active</th><th className="p-2 text-right">kW</th><th className="p-2 text-right">Yearly value</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{rep.by_org.map((r) => <tr key={r.org_id}><td className="p-2">{r.org_name}</td><td className="p-2 text-right tabular-nums">{r.active}</td><td className="p-2 text-right tabular-nums">{r.kw.toFixed(1)}</td><td className="p-2 text-right tabular-nums">{inr(r.yearly_value)}</td></tr>)}</tbody></table>
            </div>
          )}
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
          {[['Renewals due in the next 60 days', rep.renewals_due, ['contract_number', 'customer', 'company', 'end_date'], ['Contract', 'Customer', 'Company', 'Ends']],
            ['Customers to offer AMC', rep.offers_due, ['customer', 'company', 'kw', 'due_on', 'quote'], ['Customer', 'Company', 'kW', 'Due', 'Quote']],
            ['Contracts', rep.contracts.slice(0, 50), ['contract_number', 'company', 'customer', 'plan', 'end_date', 'status'], ['Contract', 'Company', 'Customer', 'Plan', 'Ends', 'Status']]]
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
