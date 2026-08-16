/**
 * Company Health Score — hero gauge + 5-pillar strip.
 * Consumes `health_score` payload returned by /api/dashboard/ceo.
 */
import { useMemo } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { AlertTriangle, TrendingUp, TrendingDown, Activity, ChevronRight } from 'lucide-react';

const BAND_COLORS = {
  strong:    { bg: 'from-emerald-500 to-emerald-600', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  healthy:   { bg: 'from-sky-500 to-blue-600',       text: 'text-sky-700',      badge: 'bg-sky-100 text-sky-700 border-sky-200' },
  attention: { bg: 'from-amber-500 to-orange-500',   text: 'text-amber-700',    badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  critical:  { bg: 'from-rose-500 to-red-600',       text: 'text-rose-700',     badge: 'bg-rose-100 text-rose-700 border-rose-200' },
};

const PILLAR_META = {
  sales_growth:     { label: 'Sales & Growth',    icon: TrendingUp,   linkTo: '/dashboard/ceo' },
  profitability:    { label: 'Profitability',     icon: TrendingDown, linkTo: '/dashboard/alerts' },
  cash_collections: { label: 'Cash & Collections',icon: Activity,     linkTo: '/dashboard/accounts' },
  operations:       { label: 'Operations',        icon: Activity,     linkTo: '/dashboard/inventory' },
  team_compliance:  { label: 'Team & Compliance', icon: Activity,     linkTo: '/dashboard/ceo' },
};


function Gauge({ score, band }) {
  const colors = BAND_COLORS[band] || BAND_COLORS.critical;
  const angle = (Math.max(0, Math.min(100, score)) / 100) * 180;
  return (
    <div className="relative w-52 h-28 mx-auto" data-testid="health-gauge">
      <svg viewBox="0 0 200 110" className="w-full h-full">
        <defs>
          <linearGradient id="gaugeBg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0"    stopColor="#ef4444" />
            <stop offset="0.4"  stopColor="#f59e0b" />
            <stop offset="0.65" stopColor="#38bdf8" />
            <stop offset="0.85" stopColor="#10b981" />
          </linearGradient>
        </defs>
        {/* Background arc */}
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeBg)" strokeWidth="14" strokeLinecap="round" opacity="0.25" />
        {/* Filled arc */}
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeBg)" strokeWidth="14" strokeLinecap="round"
              strokeDasharray={`${(angle / 180) * 251} 251`} />
        {/* Needle */}
        <line x1="100" y1="100" x2={100 + 70 * Math.cos((angle - 180) * Math.PI / 180)}
              y2={100 + 70 * Math.sin((angle - 180) * Math.PI / 180)}
              stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="100" cy="100" r="6" fill="#0f172a" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
        <p className={`text-4xl font-bold font-['Outfit'] leading-none ${colors.text}`}>{score?.toFixed(1) ?? '—'}</p>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">out of 100</p>
      </div>
    </div>
  );
}


function PillarBar({ pillarKey, pillar, onClick }) {
  const meta = PILLAR_META[pillarKey] || { label: pillarKey, icon: Activity };
  const Icon = meta.icon;
  const score = pillar.score;
  const barColor = score >= 80 ? 'bg-emerald-500' : score >= 65 ? 'bg-sky-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 hover:border-slate-300 transition-colors w-full"
      data-testid={`pillar-${pillarKey}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-slate-500" />
          <p className="text-[11px] font-medium text-slate-700">{meta.label}</p>
        </div>
        <p className="text-sm font-bold text-slate-900">{score?.toFixed(0) ?? '—'}</p>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.max(4, Math.min(100, score || 0))}%` }} />
      </div>
      <p className="text-[9px] uppercase tracking-wider text-slate-400 mt-1">{pillar.weight}% weight</p>
    </button>
  );
}


export default function HealthScoreCard({ health, onSnapshot, sparkline = [], onPillarClick }) {
  const band = health?.band || 'critical';
  const colors = BAND_COLORS[band] || BAND_COLORS.critical;

  const sortedPillars = useMemo(() => (
    Object.entries(health?.pillars || {}).sort(([a], [b]) => {
      const order = ['sales_growth', 'profitability', 'cash_collections', 'operations', 'team_compliance'];
      return order.indexOf(a) - order.indexOf(b);
    })
  ), [health]);

  if (!health) return null;

  return (
    <Card className="border-slate-200 overflow-hidden" data-testid="health-score-card">
      <div className={`bg-gradient-to-br ${colors.bg} text-white px-4 py-3 flex items-center justify-between`}>
        <div>
          <p className="text-[10px] uppercase tracking-wider opacity-90">Company Health</p>
          <p className="text-lg font-semibold font-['Outfit']">{health.verdict}</p>
        </div>
        <Badge className="bg-white/20 text-white border-white/30">{band.toUpperCase()}</Badge>
      </div>
      <CardContent className="p-4 space-y-4">
        {/* Gauge + weakest pillar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <div className="md:col-span-1">
            <Gauge score={health.score} band={band} />
          </div>
          <div className="md:col-span-2 space-y-2">
            <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/50">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">What's dragging the score</p>
                  <ul className="mt-1 space-y-1">
                    {(health.dragging || []).slice(0, 3).map((d, i) => (
                      <li key={i} className="text-xs text-slate-700 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        <span className="flex-1">{d.name}</span>
                        <span className="font-bold text-rose-600">{d.score?.toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            {onSnapshot && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Computed: {new Date(health.computed_at).toLocaleString('en-IN')}</span>
                <button onClick={onSnapshot} className="text-emerald-700 hover:underline" data-testid="save-health-snapshot">Save monthly snapshot →</button>
              </div>
            )}
          </div>
        </div>

        {/* Pillar strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2" data-testid="health-pillar-strip">
          {sortedPillars.map(([key, p]) => (
            <PillarBar key={key} pillarKey={key} pillar={p} onClick={() => onPillarClick && onPillarClick(key, p)} />
          ))}
        </div>

        {/* 90-day sparkline */}
        {sparkline?.length > 1 && (
          <div className="pt-2 border-t border-slate-100" data-testid="health-sparkline">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Score Trend</p>
            <svg viewBox={`0 0 ${sparkline.length * 20} 40`} className="w-full h-10">
              <polyline
                fill="none" stroke="#10b981" strokeWidth="2"
                points={sparkline.map((s, i) => `${i * 20},${40 - (s.score / 100) * 34 - 3}`).join(' ')}
              />
              {sparkline.map((s, i) => (
                <circle key={i} cx={i * 20} cy={40 - (s.score / 100) * 34 - 3} r="2" fill="#10b981" />
              ))}
            </svg>
            <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
              <span>{sparkline[0].month}</span>
              <span>{sparkline[sparkline.length - 1].month}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
