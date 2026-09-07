import { useState, useEffect } from 'react';
import { Check, Loader2, RotateCcw } from 'lucide-react';

/** Inline numeric/text price cell — Enter/blur saves, Esc reverts, shows saving/saved states. */
export function PriceCell({ value, onSave, testId, suffix, prefix, width = 'w-24', type = 'number', muted = false, disabled = false, placeholder }) {
  const [draft, setDraft] = useState(value ?? '');
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const dirty = String(draft) !== String(value ?? '');
  const commit = async () => {
    if (!dirty || disabled) return;
    setState('saving'); setError('');
    try {
      await onSave(type === 'number' ? (draft === '' ? null : parseFloat(draft)) : draft);
      setState('saved'); setTimeout(() => setState('idle'), 1200);
    } catch (e) { setState('idle'); setError(e.response?.data?.detail || 'Save failed'); }
  };

  return (
    <div className="flex flex-col items-end">
      <div className={`relative flex items-center gap-1 ${width}`}>
        {prefix && <span className="text-xs text-slate-400">{prefix}</span>}
        <input
          type={type} value={draft} disabled={disabled || state === 'saving'} placeholder={placeholder}
          onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setDraft(value ?? ''); e.target.blur(); } }}
          className={`h-8 w-full rounded-md border px-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500 ${dirty ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'} ${muted ? 'text-slate-400 italic' : 'text-slate-900'} disabled:opacity-60`}
          data-testid={testId}
        />
        {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
        <span className="w-4 flex justify-center">
          {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" data-testid={`${testId}-saving`} />}
          {state === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" data-testid={`${testId}-saved`} />}
          {state === 'idle' && dirty && <RotateCcw className="h-3 w-3 text-amber-500 cursor-pointer" title="Revert" onMouseDown={e => { e.preventDefault(); setDraft(value ?? ''); }} />}
        </span>
      </div>
      {error && <p className="text-[10px] text-red-600 mt-0.5" data-testid={`${testId}-error`}>{error}</p>}
    </div>
  );
}
