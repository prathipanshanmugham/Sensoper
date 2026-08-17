import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ChevronDown, ChevronRight, Info, CheckCircle2, AlertTriangle, Zap, Ruler, IndianRupee, TrendingUp } from 'lucide-react';

/**
 * 4-Stage Guided Solution Flow (Iter 44 Phase 2 — Change 1)
 * Renders backend-computed `stages` from /api/calculate/solution as
 * Consumption → Sizing → Cost → Savings with per-line Show Working.
 *
 * Props:
 *   stages: { consumption: [WorkingLine], sizing: [], cost: [], savings: [] }
 *   result: canonical result object (system_size_kw, total_cost, net_cost, payback_years, ...)
 *   systemType: 'on-grid' | 'off-grid' | 'hybrid' | 'solar-pump'
 *   warnings: string[]
 *   validation?: string-voltage validation result (pump only)
 */
export default function GuidedSolutionFlow({ stages, result, systemType, warnings = [], validation = null }) {
  const [openStage, setOpenStage] = useState('consumption');
  const [openLine, setOpenLine] = useState({});

  if (!stages || !result) return null;

  const STAGE_META = {
    consumption: { title: 'What does the customer need?', icon: Zap,        color: 'blue',    subtitle: 'Load / consumption / water requirement' },
    sizing:      { title: 'What size system does that need?', icon: Ruler,  color: 'emerald', subtitle: 'Sizing calculation, step by step' },
    cost:        { title: 'What will it cost?',           icon: IndianRupee, color: 'amber',  subtitle: 'Component-wise cost build-up' },
    savings:     { title: 'What does the customer get back?', icon: TrendingUp, color: 'violet', subtitle: 'Savings, payback and lifetime returns' },
  };

  const toggleLine = (stageKey, i) => {
    const k = `${stageKey}-${i}`;
    setOpenLine(p => ({ ...p, [k]: !p[k] }));
  };

  const fmt = (v, unit) => {
    if (v === null || v === undefined || v === '—') return '—';
    if (typeof v === 'string') return v;
    if (unit === '₹' || (unit || '').startsWith('₹')) return `₹${Math.abs(v).toLocaleString('en-IN')}${v < 0 ? ' ↓' : ''}`;
    if (typeof v === 'number') return v.toLocaleString('en-IN');
    return String(v);
  };

  // Live headline strip (always pinned at the top)
  const kwp = result.system_size_kw || 0;
  const totalCost = result.total_cost || 0;
  const subsidy = result.subsidy || 0;
  const netCost = result.net_cost || 0;
  const payback = result.payback_years;
  const monthlySaving = result.monthly_saving || result.annual_saving ? (result.monthly_saving ?? Math.round((result.annual_saving || 0) / 12)) : 0;

  return (
    <div className="space-y-3" data-testid="guided-solution-flow">
      {/* Live summary — always visible */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="guided-summary-strip">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-center">
          <p className="text-[10px] uppercase text-emerald-700 tracking-wider">System</p>
          <p className="text-lg font-bold text-slate-900">{kwp} <span className="text-xs">{systemType === 'solar-pump' ? 'kWp' : 'kWp'}</span></p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center">
          <p className="text-[10px] uppercase text-slate-700 tracking-wider">Total Cost</p>
          <p className="text-lg font-bold text-slate-900">₹{(totalCost / 100000).toFixed(2)}L</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-center">
          <p className="text-[10px] uppercase text-blue-700 tracking-wider">Subsidy</p>
          <p className="text-lg font-bold text-slate-900">₹{subsidy > 0 ? (subsidy / 1000).toFixed(0) + 'k' : '—'}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-center">
          <p className="text-[10px] uppercase text-amber-700 tracking-wider">Customer Pays</p>
          <p className="text-lg font-bold text-slate-900">₹{(netCost / 100000).toFixed(2)}L</p>
        </div>
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-center">
          <p className="text-[10px] uppercase text-violet-700 tracking-wider">Payback</p>
          <p className="text-lg font-bold text-slate-900">{payback ? `${payback}y` : '—'}</p>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40" data-testid="guided-warnings">
          <CardContent className="p-3 space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* String voltage validation (pump only) */}
      {validation && (validation.errors?.length > 0 || validation.warnings?.length > 0) && (
        <Card className={`${validation.ok ? 'border-amber-200 bg-amber-50/40' : 'border-rose-200 bg-rose-50/40'}`} data-testid="guided-string-validation">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-['Outfit'] flex items-center gap-1.5">
            {validation.ok ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />}
            String Design {validation.ok ? 'Warning' : 'Error'} — Voc@{validation.site_min_temp_c}°C = {validation.string_voc_tmin}V (limit {validation.controller_absolute_max}V)
          </CardTitle></CardHeader>
          <CardContent className="p-3 pt-0 space-y-1 text-xs">
            {validation.errors?.map((e, i) => <p key={i} className="text-rose-800">✕ {e}</p>)}
            {validation.warnings?.map((w, i) => <p key={i} className="text-amber-800">⚠ {w}</p>)}
          </CardContent>
        </Card>
      )}

      {/* 4 stages */}
      {['consumption', 'sizing', 'cost', 'savings'].map((sKey, sIdx) => {
        const meta = STAGE_META[sKey];
        const lines = stages[sKey] || [];
        const isOpen = openStage === sKey;
        const Icon = meta.icon;
        // Auto-open first stage; earlier stages auto-mark complete when a later one is open
        const isCompleted = ['consumption', 'sizing', 'cost', 'savings'].indexOf(openStage) > sIdx;
        return (
          <Card key={sKey} className={`${isOpen ? `border-${meta.color}-300 shadow-sm` : 'border-slate-200'}`} data-testid={`guided-stage-${sKey}`}>
            <button
              type="button"
              className={`w-full flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors ${isOpen ? `bg-${meta.color}-50/50` : ''}`}
              onClick={() => setOpenStage(isOpen ? null : sKey)}
              data-testid={`guided-stage-toggle-${sKey}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isCompleted ? `bg-${meta.color}-500 text-white` : isOpen ? `bg-${meta.color}-100 text-${meta.color}-700` : 'bg-slate-100 text-slate-400'}`}>
                {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-slate-800">Stage {sIdx + 1} — {meta.title}</p>
                <p className="text-[11px] text-slate-500">{meta.subtitle}</p>
              </div>
              <Badge variant="outline" className="text-[10px]">{lines.length} step{lines.length !== 1 ? 's' : ''}</Badge>
              {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
            </button>

            {isOpen && (
              <CardContent className="p-0">
                <div className="divide-y divide-slate-100">
                  {lines.map((L, i) => {
                    const key = `${sKey}-${i}`;
                    const showW = openLine[key];
                    return (
                      <div key={i} className="p-3 hover:bg-slate-50/50" data-testid={`guided-line-${sKey}-${i}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-xs font-medium text-slate-700">{L.label}</p>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{L.operation}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-slate-900" data-testid={`guided-value-${sKey}-${i}`}>
                              {fmt(L.result, L.unit)} <span className="text-[10px] font-normal text-slate-500">{L.unit && !['₹', '₹/month', '₹/year'].includes(L.unit) ? L.unit : ''}</span>
                            </p>
                            {(L.why || L.constant) && (
                              <button type="button" className="text-[10px] text-blue-600 hover:underline mt-0.5" onClick={() => toggleLine(sKey, i)} data-testid={`guided-show-working-${sKey}-${i}`}>
                                {showW ? 'Hide working' : 'Show working'}
                              </button>
                            )}
                          </div>
                        </div>
                        {showW && (
                          <div className="mt-2 p-2.5 rounded bg-blue-50/60 border border-blue-100 space-y-1" data-testid={`guided-working-${sKey}-${i}`}>
                            {L.constant && (
                              <p className="text-[11px] text-slate-700"><b>Constant:</b> {typeof L.constant === 'object' ? JSON.stringify(L.constant) : String(L.constant)}</p>
                            )}
                            {L.why && <p className="text-[11px] text-slate-700 flex items-start gap-1"><Info className="h-3 w-3 mt-0.5 shrink-0 text-blue-500" /><span>{L.why}</span></p>}
                            {L.source && <p className="text-[10px] text-slate-500"><i>Source:</i> {L.source}</p>}
                            {L.inputs && Object.keys(L.inputs).length > 0 && (
                              <details className="text-[10px] text-slate-500">
                                <summary className="cursor-pointer">Raw inputs</summary>
                                <pre className="mt-1 text-[10px] bg-white/60 p-1 rounded overflow-x-auto">{JSON.stringify(L.inputs, null, 2)}</pre>
                              </details>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
