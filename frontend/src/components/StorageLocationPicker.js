import { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { inventoryAPI } from '../utils/api';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const LEVELS = [['zone', 'Zone', true], ['aisle', 'Aisle', false], ['shelf', 'Shelf', false], ['rack', 'Rack', false], ['bin', 'Bin', false]];
const NEW = '__new__';

/** Iter 53 — cascading Zone → Aisle → Shelf → Rack → Bin picker for inbound receiving. Deeper levels optional; no free text blob. */
export function StorageLocationPicker({ value = {}, onChange, locationId }) {
  const [combos, setCombos] = useState([]);
  const [adding, setAdding] = useState({});

  useEffect(() => { inventoryAPI.storageLocations(locationId).then(r => setCombos(r.data.combos || [])).catch(() => setCombos([])); }, [locationId]);

  const optionsFor = useMemo(() => (key) => {
    const idx = LEVELS.findIndex(l => l[0] === key);
    const parents = LEVELS.slice(0, idx).map(l => l[0]);
    const pool = combos.filter(c => parents.every(p => !value[p] || c[p] === value[p]));
    return [...new Set(pool.map(c => c[key]).filter(Boolean))].sort();
  }, [combos, value]);

  const set = (key, v) => {
    const idx = LEVELS.findIndex(l => l[0] === key);
    const next = { ...value, [key]: v };
    LEVELS.slice(idx + 1).forEach(([k]) => { delete next[k]; });   // changing a parent clears deeper levels
    onChange(next);
  };
  const summary = LEVELS.filter(([k]) => value[k]).map(([k, l]) => `${l} ${value[k]}`).join(' / ');

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3 bg-slate-50/50" data-testid="storage-location-picker">
      <Label className="text-xs flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-emerald-600" />Where is this stock going? <span className="text-slate-400">Zone required · deeper levels optional</span></Label>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {LEVELS.map(([key, label, required], idx) => {
          const parentKey = idx > 0 ? LEVELS[idx - 1][0] : null;
          const disabled = parentKey ? !value[parentKey] : false;
          const opts = optionsFor(key);
          return (
            <div key={key} className="space-y-1">
              <Label className="text-[11px] text-slate-500">{label}{required && ' *'}</Label>
              {adding[key] ? (
                <Input autoFocus value={value[key] || ''} placeholder={`New ${label.toLowerCase()}`} className="h-9" onChange={(e) => set(key, e.target.value.toUpperCase())} onBlur={() => setAdding(a => ({ ...a, [key]: false }))} data-testid={`storage-${key}-new-input`} />
              ) : (
                <Select value={value[key] || ''} disabled={disabled} onValueChange={(v) => { if (v === NEW) { setAdding(a => ({ ...a, [key]: true })); set(key, ''); } else set(key, v); }}>
                  <SelectTrigger className="h-9" data-testid={`storage-${key}-select`}><SelectValue placeholder={disabled ? `Pick ${LEVELS[idx - 1][1].toLowerCase()} first` : `Select ${label.toLowerCase()}`} /></SelectTrigger>
                  <SelectContent>
                    {opts.map(o => <SelectItem key={o} value={o} data-testid={`storage-${key}-option-${o}`}>{o}</SelectItem>)}
                    <SelectItem value={NEW} data-testid={`storage-${key}-new`}>+ New {label.toLowerCase()}…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-600" data-testid="storage-location-summary">{summary ? <>Will be recorded as <b>{summary}</b></> : 'Pick at least a zone (or add a new one).'}</p>
    </div>
  );
}
