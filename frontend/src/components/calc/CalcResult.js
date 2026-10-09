import { IndianRupee, PiggyBank, Clock, TrendingUp, Sun } from 'lucide-react';

const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;
/** "bill ₹6,000 → ₹0 + ₹1,096 back" when feed-in income pays more than the bill. */
const billAfter = (bill, saving) => (saving > bill ? `${inr(bill)} → ₹0 + ${inr(saving - bill)} back` : `${inr(bill)} → ${inr(bill - saving)}`);
const lakh = (v) => (v >= 1e5 ? `₹${(v / 1e5).toFixed(v >= 1e7 ? 0 : 1)} L` : inr(v));

export function CalcResult({ r }) {
  if (!r || !(r.system_size_kw > 0)) {
    return <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500" data-testid="calc-result-strip">Result appears here once the bill or a system size is entered.</div>;
  }
  const perBill = r.period_months === 2;
  const extras = (r.export_income_monthly || 0) > 0 || (r.network_charge_monthly || 0) > 0;
  const tiles = [
    { icon: IndianRupee, label: 'Customer pays', value: inr(r.net_cost), sub: r.subsidy > 0 ? `after ${inr(r.subsidy)} subsidy` : 'no subsidy entered', testid: 'result-net-cost', accent: true },
    perBill
      ? { icon: PiggyBank, label: 'Saves per bill', value: inr(r.saving_per_period), sub: r.bill_now_per_period > 0 ? `2-month bill ${billAfter(r.bill_now_per_period, r.saving_per_period)}` : `${inr(r.monthly_saving)} a month`, testid: 'result-monthly-saving' }
      : { icon: PiggyBank, label: 'Saves per month', value: inr(r.monthly_saving), sub: r.monthly_bill_now > 0 ? `bill ${billAfter(r.monthly_bill_now, r.monthly_saving)}` : `${r.monthly_generation_units} units/month`, testid: 'result-monthly-saving' },
    { icon: Clock, label: 'Payback', value: r.payback_years == null ? '—' : `${r.payback_years} yrs`, sub: r.payback_years == null ? 'needs a bill to compute' : `${r.roi_pct}% return / year`, testid: 'result-payback' },
    { icon: TrendingUp, label: '25-year savings', value: lakh(r.lifetime_savings), sub: `${r.annual_generation_units.toLocaleString('en-IN')} units / year`, testid: 'result-lifetime' },
  ];
  return (
    <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3 space-y-2" data-testid="calc-result-strip">
      <p className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1"><Sun className="h-3.5 w-3.5" />{r.system_size_kw} kW {r.system_type} · {r.panel_count ? `${r.panel_count} panels` : 'panels TBD'}{r.battery_count ? ` · ${r.battery_count} battery` : ''}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tiles.map(t => (
          <div key={t.testid} className={`rounded-lg p-2.5 ${t.accent ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-100'}`}>
            <p className={`text-[10px] uppercase tracking-wider flex items-center gap-1 ${t.accent ? 'text-emerald-100' : 'text-slate-500'}`}><t.icon className="h-3 w-3" />{t.label}</p>
            <p className={`text-base font-bold leading-tight mt-0.5 ${t.accent ? 'text-white' : 'text-slate-900'}`} data-testid={t.testid}>{t.value}</p>
            <p className={`text-[10px] mt-0.5 ${t.accent ? 'text-emerald-100' : 'text-slate-500'}`}>{t.sub}</p>
          </div>
        ))}
      </div>
      {extras && (
        <p className="text-[11px] text-slate-600 rounded-md bg-white/70 border border-slate-100 px-2.5 py-1.5" data-testid="saving-breakdown">
          Each month: units saved {inr(r.energy_saving_monthly)}
          {(r.export_income_monthly || 0) > 0 && <> + {r.export_units_monthly} surplus units sold {inr(r.export_income_monthly)}</>}
          {(r.network_charge_monthly || 0) > 0 && <> − network charge {inr(r.network_charge_monthly)}</>}
          {' '}= <span className="font-semibold text-slate-800">{inr(r.monthly_saving)}</span>
        </p>
      )}
    </div>
  );
}
