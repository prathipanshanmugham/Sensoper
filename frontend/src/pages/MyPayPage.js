/* My pay (everyone): my payslips, take-home, incentives and commission, salary advance, PF / ESI numbers and my
 * insurance cover with the helpline. Questions go to the help desk (HR & salary). */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, HeartPulse, LifeBuoy, Phone, ShieldCheck, Wallet } from 'lucide-react';
import { payrollAPI, uploadAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, Chip, Empty, Loading, PageHeader, Tile, Tiles, fmtDate, inr } from '../components/kit/PageBits';
import { COVER, EXTRA_STATUS, MoneyRows, StatusChip, monthLabel, openPdf } from '../components/hr/payBits';

export default function MyPayPage() {
  const [d, setD] = useState(null);
  useEffect(() => { payrollAPI.me().then((r) => setD(r.data)).catch(() => setD(false)); }, []);
  if (d === null) return <div className="px-4 py-6"><Loading /></div>;
  if (!d) return <div className="px-4 py-6"><Empty title="Could not load your pay" /></div>;
  const last = d.payslips[0];
  return (
    <div className="px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader icon={Wallet} title="My pay" sub="Your payslips, incentives, PF and insurance" testid="my-pay-page">
          <Button asChild variant="outline" className="h-10 gap-1.5"><Link to="/dashboard/help-desk?new=hr" data-testid="my-pay-ask"><LifeBuoy className="h-4 w-4" />Question about pay?</Link></Button>
        </PageHeader>
        {!d.has_salary && d.payslips.length === 0 ? <Empty icon={Wallet} title="Your salary isn't set up here yet" text="HR adds it under HR → Pay & benefits. Ask on the help desk if you think it's missing." /> : (
          <Tiles>
            <Tile label="Take-home" value={d.estimate ? inr(d.estimate.net) : '—'} sub="a normal month" tone="good" testid="my-pay-net" />
            <Tile label="Last payslip" value={last ? inr(last.net) : '—'} sub={last ? `${monthLabel(last.month)}${last.paid_on ? ` · paid ${fmtDate(last.paid_on, { day: 'numeric', month: 'short' })}` : ''}` : 'none yet'} />
            <Tile label={`Paid in ${d.fy}`} value={inr(d.ytd.net)} sub={`gross ${inr(d.ytd.gross)}`} />
            <Tile label={`PF in ${d.fy}`} value={inr(d.ytd.pf)} sub={`TDS ${inr(d.ytd.tds)}`} />
          </Tiles>)}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card title="Payslips" className="lg:col-span-2" testid="my-payslips">
            {d.payslips.length === 0 ? <p className="py-4 text-center text-xs text-slate-400">Your payslips appear here once a month's payroll is approved.</p> : (
              <ul className="divide-y divide-slate-100">{d.payslips.map((s) => (
                <li key={s.month} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0"><span className="block font-medium text-slate-900">{s.label}</span>
                    <span className="text-[11px] text-slate-500">gross {inr(s.gross)} · deductions {inr(s.deductions)}{s.status === 'paid' ? '' : ' · not paid yet'}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><span className="font-semibold tabular-nums">{inr(s.net)}</span>
                    <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => openPdf(payrollAPI.myPayslip(s.month), `payslip-${s.month}.pdf`)} data-testid={`my-slip-${s.month}`}><FileText className="h-3.5 w-3.5" />PDF</Button></span>
                </li>))}</ul>)}
          </Card>
          <Card title="My numbers" testid="my-pay-ids">
            <dl className="space-y-1.5 text-sm">{[['UAN (PF)', d.ids.uan], ['PF member ID', d.ids.pf_member_id], ['ESI number', d.ids.esi_number], ['PAN', d.ids.pan],
              ['Salary paid to', d.ids.pay_mode === 'bank' ? `${d.ids.bank_name || 'Bank'} ${d.ids.account_masked || ''}` : d.ids.pay_mode]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-right text-slate-900">{v || '—'}</dd></div>))}</dl>
            <p className="mt-2 text-[11px] text-slate-500">Something wrong? <Link to="/dashboard/help-desk?new=hr" className="text-emerald-700 underline">Tell HR</Link>.</p>
          </Card>
        </div>
        {d.estimate && (
          <Card title="A normal month" sub="From your current salary — the payslip is what was actually paid">
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyRows rows={d.estimate.earnings} total={d.estimate.gross} totalLabel="Gross" />
              <MoneyRows rows={d.estimate.deductions} total={d.estimate.net} totalLabel="Take-home" tone="green" />
            </div>
            {d.estimate.employer?.length > 0 && <p className="mt-2 text-[11px] text-slate-500">The company also pays for you: {d.estimate.employer.map((e) => `${e.label} ${inr(e.amount)}`).join(' · ')}</p>}
          </Card>)}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title="Insurance" testid="my-pay-insurance">
            {d.insurance.length === 0 ? <p className="text-xs text-slate-400">You aren't on a company policy.</p> : (
              <ul className="space-y-2">{d.insurance.map((p) => (
                <li key={p.name} className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 text-sm">
                  <p className="font-medium text-slate-900"><ShieldCheck className="mr-1 inline h-4 w-4 text-emerald-600" />{p.name}</p>
                  <p className="text-xs text-slate-600">{[p.insurer, p.policy_number && `Policy ${p.policy_number}`, `till ${fmtDate(p.end_date)}`].filter(Boolean).join(' · ')}</p>
                  <p className="mt-1">{COVER[p.cover]} · cover {inr(p.sum_insured)}{p.member_number ? <> · card <b>{p.member_number}</b></> : null}</p>
                  {p.dependants.length > 0 && <p className="text-xs text-slate-600">Also covers {p.dependants.map((x) => `${x.name}${x.relation ? ` (${x.relation})` : ''}`).join(', ')}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p.helpline && <a href={`tel:${p.helpline.replace(/\s/g, '')}`} className="inline-flex h-9 items-center gap-1 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white"><Phone className="h-3.5 w-3.5" />{p.tpa || 'Helpline'} {p.helpline}</a>}
                    {p.document && <a href={uploadAPI.getFileUrl(p.document)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-xs"><FileText className="h-3.5 w-3.5" />Policy</a>}
                  </div>
                  {p.claims.length > 0 && <ul className="mt-2 space-y-0.5 text-xs">{p.claims.map((c) => <li key={c.id}><HeartPulse className="mr-1 inline h-3 w-3" />{c.hospital || 'Claim'} · {inr(c.amount_claimed)} · {c.status}</li>)}</ul>}
                </li>))}</ul>)}
          </Card>
          <Card title="Incentives, commission & advances" testid="my-pay-extras">
            {d.extras.length === 0 && d.advances.length === 0 ? <p className="text-xs text-slate-400">Nothing yet.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {d.advances.filter((a) => a.status === 'active').map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-1.5"><span>Salary advance {inr(a.amount)}<span className="block text-[11px] text-slate-500">{inr(a.monthly)} a month from salary</span></span><Chip tone="amber">{inr(a.balance)} left</Chip></li>))}
                {d.extras.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0"><span className="block truncate">{x.label}</span><span className="text-[11px] text-slate-500">with {monthLabel(x.month)} pay</span></span>
                    <span className="flex shrink-0 items-center gap-1.5"><span className="tabular-nums">{x.kind === 'deduction' ? '−' : ''}{inr(x.amount)}</span><StatusChip map={EXTRA_STATUS} value={x.status} /></span></li>))}
              </ul>)}
          </Card>
        </div>
      </div>
    </div>
  );
}
