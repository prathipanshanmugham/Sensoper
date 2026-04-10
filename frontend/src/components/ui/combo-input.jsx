import { useState, useRef, useEffect } from 'react';
import { Input } from './input';
import { ChevronDown } from 'lucide-react';

export function ComboInput({ value, onChange, options = [], placeholder = 'Type or select...', className = '', 'data-testid': testId }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes((search || value || '').toLowerCase())
  );

  const displayValue = options.find(o => o.value === value)?.label || value || '';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div className="relative">
        <Input
          value={open ? search : displayValue}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => { setOpen(true); setSearch(displayValue); }}
          placeholder={placeholder}
          className="h-11 pr-8"
          data-testid={testId}
        />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          tabIndex={-1}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
              onClick={() => { onChange(o.value); setSearch(''); setOpen(false); }}
              data-testid={testId ? `${testId}-option-${o.value}` : undefined}
            >
              {o.label}
            </button>
          ))}
          {filtered.length === 0 && search && (
            <div className="px-3 py-2 text-sm text-slate-500">
              Using custom value: <span className="font-medium text-slate-700">{search}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
