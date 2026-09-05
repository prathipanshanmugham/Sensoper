import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { RotateCcw, AlertTriangle } from 'lucide-react';

const isSet = (v) => v !== undefined && v !== null && v !== '';

/** Number input that shows an auto-calculated value, flips to "Manually set" once edited, one tap resets. */
export function OverridableNumber({ label, unit, autoValue, value, onChange, step = 1, min = 0, placeholder, hint, warnings = [], testid, disabled }) {
  const manual = isSet(value);
  const shown = manual ? value : (autoValue ?? '');
  return (
    <div className="space-y-1" data-testid={`${testid}-field`}>
      <div className="flex items-center justify-between gap-2 min-h-[18px]">
        <Label className="text-xs text-slate-700">{label}{unit ? <span className="text-slate-400"> ({unit})</span> : null}</Label>
        {manual ? (
          <button type="button" onClick={() => onChange('')} className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-semibold hover:bg-amber-200 transition-colors" data-testid={`${testid}-reset`}>
            Manually set <RotateCcw className="h-3 w-3" /> reset
          </button>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold" data-testid={`${testid}-auto-badge`}>auto</span>
        )}
      </div>
      <Input type="number" inputMode="decimal" min={min} step={step} value={shown} placeholder={placeholder} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`h-11 text-base ${manual ? 'border-amber-400 bg-amber-50/40' : 'bg-white'}`} data-testid={`${testid}-input`} />
      {hint && !warnings.length && <p className="text-[11px] text-slate-500" data-testid={`${testid}-hint`}>{hint}</p>}
      {warnings.map((w, i) => (
        <p key={i} className="text-[11px] text-amber-800 flex items-start gap-1" data-testid={`${testid}-warning`}><AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />{w}</p>
      ))}
    </div>
  );
}

/** Plain number input with the same inline hint/warning treatment. */
export function NumberField({ label, unit, value, onChange, step = 1, min = 0, placeholder, hint, warnings = [], testid, optional }) {
  return (
    <div className="space-y-1" data-testid={`${testid}-field`}>
      <Label className="text-xs text-slate-700">{label}{unit ? <span className="text-slate-400"> ({unit})</span> : null}{optional ? <span className="text-slate-400 font-normal"> · optional</span> : null}</Label>
      <Input type="number" inputMode="decimal" min={min} step={step} value={value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} className="h-11 text-base bg-white" data-testid={`${testid}-input`} />
      {hint && !warnings.length && <p className="text-[11px] text-slate-500" data-testid={`${testid}-hint`}>{hint}</p>}
      {warnings.map((w, i) => (
        <p key={i} className="text-[11px] text-amber-800 flex items-start gap-1" data-testid={`${testid}-warning`}><AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />{w}</p>
      ))}
    </div>
  );
}
