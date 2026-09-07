import { useState, useEffect } from 'react';
import { dashboardAPI } from '../utils/api';
import { Card, CardContent } from './ui/card';
import { useLocationScope, LocationScopeSelect } from './LocationScope';
import { Target, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, Minus } from 'lucide-react';

const inr = (v) => `₹${Math.round(v || 0).toLocaleString('en-IN')}`;
const PACE = {
  achieved: { label: 'Target achieved', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', bar: 'bg-emerald-500', Icon: CheckCircle2 },
  on_track: { label: 'On track', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', bar: 'bg-emerald-500', Icon: TrendingUp },
  at_risk: { label: 'Slightly behind pace', cls: 'text-amber-700 bg-amber-50 border-amber-200', bar: 'bg-amber-500', Icon: AlertTriangle },
  behind: { label: 'Behind pace', cls: 'text-red-700 bg-red-50 border-red-200', bar: 'bg-red-500', Icon: TrendingDown },
  no_target: { label: 'No target set', cls: 'text-slate-600 bg-slate-50 border-slate-200', bar: 'bg-slate-400', Icon: Minus },
};

export function MonthlyTargetPanel() {
  const locScope = useLocationScope('dashboard_location_scope');
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!locScope.ready) return;
    dashboardAPI.getMonthlyTarget(locScope.locationId ? { location_id: locScope.locationId } : {}).then(r => setData(r.data)).catch(() => setData(null));
  }, [locScope.locationId, locScope.ready]);

  if (!data) return null;
  const pace = PACE[data.pace] || PACE.no_target;
  const pct = Math.min(data.pct ?? 0, 100);
  const monthLabel = new Date(`${data.month}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <Card className="border-slate-200 mb-6 overflow-hidden" data-testid="monthly-target-panel">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-emerald-600" />Monthly Target · {monthLabel}</p>
            <p className="text-[11px] text-slate-400 mt-0.5" data-testid="monthly-target-scope">
              {data.location_name ? `${data.location_name} · ` : 'Company-wide · '}{data.target_source === 'location' ? 'location target' : 'company target'} · day {data.day} of {data.days_in_month}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${pace.cls}`} data-testid="monthly-target-pace"><pace.Icon className="h-3.5 w-3.5" />{pace.label}</span>
            <div className="w-52"><LocationScopeSelect scope={locScope} testIdPrefix="dashboard-location" className="h-8 text-xs" /></div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-3">
          <div><p className="text-[11px] uppercase tracking-wide text-slate-400">Target</p><p className="text-xl font-bold font-['Outfit'] text-slate-900" data-testid="monthly-target-value">{inr(data.target)}</p></div>
          <div><p className="text-[11px] uppercase tracking-wide text-slate-400">Achieved</p><p className="text-xl font-bold font-['Outfit'] text-emerald-600" data-testid="monthly-achieved-value">{inr(data.achieved)}</p><p className="text-[11px] text-slate-400">{data.won_count} won this month{data.pct != null ? ` · ${data.pct}%` : ''}</p></div>
          <div><p className="text-[11px] uppercase tracking-wide text-slate-400">To Be Achieved</p><p className={`text-xl font-bold font-['Outfit'] ${data.remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`} data-testid="monthly-remaining-value">{inr(data.remaining)}</p>{data.remaining > 0 && data.days_remaining > 0 && <p className="text-[11px] text-slate-400">needs {inr(data.required_daily)}/day for {data.days_remaining} days</p>}</div>
        </div>

        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden" data-testid="monthly-target-bar">
          <div className={`h-full rounded-full ${pace.bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-slate-500 mt-2" data-testid="monthly-target-projection">
          {data.pace === 'no_target' ? 'Set a monthly revenue target in Advanced Config to enable pace tracking.'
            : data.pace === 'achieved' ? `Target met with ${data.days_remaining} day${data.days_remaining === 1 ? '' : 's'} to spare.`
            : `At the current pace (${inr(data.daily_rate)}/day) you'll finish the month at about ${inr(data.projected)} — ${data.projected >= data.target ? 'above' : 'short of'} target${data.previous_month_achieved ? ` · last month ${inr(data.previous_month_achieved)}` : ''}.`}
        </p>
      </CardContent>
    </Card>
  );
}
