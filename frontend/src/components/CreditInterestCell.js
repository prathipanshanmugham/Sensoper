import { useState } from 'react';
import { creditsAPI } from '../utils/api';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { Percent, RotateCcw, Check } from 'lucide-react';

/** Iter 54 — implied credit-interest cell: default rate, marked when overridden per customer / per record. */
export function CreditInterestCell({ credit, onChanged }) {
  const [editing, setEditing] = useState(null); // 'record' | 'customer' | null
  const [val, setVal] = useState('');
  const overridden = credit.rate_source !== 'default';
  const save = async () => {
    const pct = val === '' ? null : parseFloat(val);
    try {
      if (editing === 'record') await creditsAPI.setRate(credit.id, pct); else await creditsAPI.setCustomerRate(credit.customer_name, pct);
      toast.success(pct == null ? 'Override cleared' : `Rate set to ${pct}%/month`); setEditing(null); onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };
  if (editing) {
    return (
      <div className="flex items-center gap-1" data-testid={`credit-rate-editor-${credit.id}`}>
        <Input type="number" step="0.1" value={val} onChange={e => setVal(e.target.value)} placeholder="%/mo" className="h-7 w-16 text-xs" autoFocus data-testid={`credit-rate-input-${credit.id}`} />
        <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={save} data-testid={`credit-rate-save-${credit.id}`}><Check className="h-3.5 w-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(null)}><RotateCcw className="h-3.5 w-3.5" /></Button>
        <span className="text-[10px] text-slate-400">{editing === 'record' ? 'this record' : 'all of this customer'} · blank = clear</span>
      </div>
    );
  }
  return (
    <div className="text-xs" data-testid={`credit-interest-${credit.id}`}>
      <p className={`font-semibold ${credit.interest_cost > 0 ? 'text-amber-700' : 'text-slate-400'}`}>₹{Math.round(credit.interest_cost || 0).toLocaleString('en-IN')}</p>
      <p className="text-[10px] text-slate-500 flex items-center gap-1">
        {credit.days_overdue > 0 ? `${credit.days_overdue}d overdue · ` : ''}{credit.effective_monthly_pct}%/mo
        {overridden && <span className="px-1 rounded bg-sky-100 text-sky-800" data-testid={`credit-rate-override-${credit.id}`}>{credit.rate_source} override</span>}
        <button type="button" className="text-slate-400 hover:text-emerald-700" title="Override rate for this record" onClick={() => { setVal(credit.interest_rate_override ?? ''); setEditing('record'); }} data-testid={`credit-rate-edit-${credit.id}`}><Percent className="h-3 w-3" /></button>
        <button type="button" className="text-slate-400 hover:text-sky-700 underline" title="Override rate for this customer" onClick={() => { setVal(''); setEditing('customer'); }} data-testid={`credit-customer-rate-edit-${credit.id}`}>customer</button>
      </p>
    </div>
  );
}
