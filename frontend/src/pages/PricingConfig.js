import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Check, Loader2, Pencil, Tags, X } from 'lucide-react';
import { healthAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { CompanyDefaultsCard } from '../components/CompanyDefaultsCard';
import { DriveConnectCard, W3wStatusRow } from '../components/DriveConnectCard';

/** Settings — only the few company-wide basics. Product prices, package slabs and service rates live in Price list. */

function Group({ title, line, children }) {
  return (
    <section className="space-y-2">
      <div><h2 className="font-['Outfit'] text-base font-semibold text-slate-900">{title}</h2>{line && <p className="text-xs text-slate-500">{line}</p>}</div>
      {children}
    </section>
  );
}

function MonthlyTargetRow() {
  const [value, setValue] = useState(null);
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { healthAPI.getConfig().then((r) => setValue(r.data?.targets?.monthly_revenue_target ?? 0)).catch(() => setValue(0)); }, []);
  const save = async () => {
    const n = Math.round(parseFloat(String(val).replace(/[^\d.]/g, '')) || 0);
    setSaving(true);
    try { await healthAPI.updateConfig({ 'targets.monthly_revenue_target': n }); setValue(n); setEdit(false); toast.success('Saved'); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Save failed'); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5" data-testid="monthly-target-row">
      <div className="min-w-[240px] flex-1"><p className="text-sm font-medium text-slate-800">Monthly sales target</p><p className="text-[11px] text-slate-500">Home and Business health show progress against this every month.</p></div>
      {value === null ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : edit ? (
        <div className="flex items-center gap-1">
          <span className="text-sm text-slate-500">₹</span>
          <Input type="number" inputMode="numeric" min="0" step="10000" value={val} onChange={(e) => setVal(e.target.value)} className="h-8 w-36 text-sm" autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(false); }} data-testid="monthly-target-input" />
          <Button size="sm" onClick={save} disabled={saving} className="h-8 bg-emerald-600 px-2 text-white hover:bg-emerald-700" data-testid="monthly-target-save">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</Button>
          <Button size="sm" variant="ghost" onClick={() => setEdit(false)} className="h-8 px-2"><X className="h-3.5 w-3.5" /></Button>
        </div>
      ) : (
        <button type="button" onClick={() => { setVal(String(value || '')); setEdit(true); }} className="flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm hover:border-emerald-400" data-testid="monthly-target-value">
          <span className="font-semibold tabular-nums text-slate-900">₹{Number(value || 0).toLocaleString('en-IN')}</span><Pencil className="h-3 w-3 text-slate-400" />
        </button>
      )}
    </div>
  );
}

export default function PricingConfig() {
  useEffect(() => {
    if (!window.location.hash) return undefined;
    const t = setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6" data-testid="pricing-config-page">
      <div>
        <h1 className="font-['Outfit'] text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">A few company-wide basics. Tap a value to change it.</p>
      </div>

      <Group title="Money" line="How quote and invoice totals are rounded, and a few company defaults.">
        <CompanyDefaultsCard />
      </Group>

      <Group title="Target">
        <MonthlyTargetRow />
      </Group>

      <Group title="Connections" line="Where site photos go and how site locations are found.">
        <DriveConnectCard />
        <W3wStatusRow />
      </Group>

      <Link to="/dashboard/pricelist" className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-300" data-testid="settings-pricelist-link">
        <span className="flex items-center gap-3"><Tags className="h-5 w-5 text-emerald-600" /><span><span className="block text-sm font-medium text-slate-900">Looking for prices?</span><span className="block text-xs text-slate-500">Product prices, package slab rates and service rates are in Price list.</span></span></span>
        <ArrowRight className="h-4 w-4 text-slate-400" />
      </Link>
    </div>
  );
}
