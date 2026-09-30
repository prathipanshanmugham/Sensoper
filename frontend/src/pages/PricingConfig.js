import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Package, Layers, Wrench, Building2, Target, ArrowRight } from 'lucide-react';
import { Input } from '../components/ui/input';
import PricelistPage from './PricelistPage';
import { SlabRatesCard } from '../components/SlabRatesCard';
import { ServiceRatesTable } from '../components/ServiceRatesTable';
import { CompanyDefaultsCard } from '../components/CompanyDefaultsCard';
import AdvancedConfigSection from '../components/AdvancedConfigSection';

/** Iter 60 — Pricing & Config: exactly five tabs, one inline editing pattern, one global search.
 *  Orphans audited: "Pincode / DISCOM data tools" (utilities) moved out to Expansion → Needs Location Review (auto-resolve);
 *  calculator benchmarks + PM Surya Ghar reference live under Slabs (they are the fallback rates when no slab applies). */
export const TABS = [
  { id: 'products', label: 'Products', icon: Package, line: 'Every priced inventory item — cost, margin % and GST % per row. Edit a cell, press Enter.' },
  { id: 'slabs', label: 'Slabs', icon: Layers, line: 'Package ₹ per kW / HP / unit by size band for each kit category; benchmarks below apply when no slab matches.' },
  { id: 'services', label: 'Services', icon: Wrench, line: 'Structure, cabling and installation rates, each with its own margin % and GST %.' },
  { id: 'company', label: 'Company Defaults', icon: Building2, line: 'Single company-wide numbers: rounding of totals, overdue interest, design temperature.' },
  { id: 'targets', label: 'Targets', icon: Target, line: 'Revenue, margin, CAC and health-score targets, with a per-location revenue override table.' },
];
// Global search index — every setting on the page, one plain-language line each
export const SEARCH_INDEX = [
  { label: 'Panel / inverter / battery / camera price, margin %, GST %', tab: 'products', hint: 'search the product name in the Products table' },
  { label: 'Inventory item HSN code', tab: 'products' },
  { label: 'Slab package rate per kW (on-grid / off-grid / hybrid)', tab: 'slabs', anchor: 'slab-rates-card' },
  { label: 'Slab package rate per HP (solar pump)', tab: 'slabs', anchor: 'slab-rates-card' },
  { label: 'Slab package rate per unit (Solar Camera and other product kits)', tab: 'slabs', anchor: 'slab-rates-card' },
  { label: 'Benchmark cost per kWp when no product / slab is picked', tab: 'slabs', anchor: 'calc-constants' },
  { label: 'Specific yield, default tariff, system life, degradation', tab: 'slabs', anchor: 'calc-constants' },
  { label: 'PM Surya Ghar subsidy reference slabs and cap', tab: 'slabs', anchor: 'calc-constants' },
  { label: 'Battery benchmark price per kWh', tab: 'slabs', anchor: 'calc-constants' },
  { label: 'Installation & commissioning rate (per kW)', tab: 'services', anchor: 'service-rates-table' },
  { label: 'Structure / cabling / net-metering rate, margin %, GST %', tab: 'services', anchor: 'service-rates-table' },
  { label: 'Rounding of final totals (₹1 / ₹10 / ₹100) and direction', tab: 'company', anchor: 'rounding-rule-card' },
  { label: 'Overdue credit interest (% per month)', tab: 'company', anchor: 'rounding-rule-card' },
  { label: 'Coldest design temperature for string voltage check', tab: 'company', anchor: 'rounding-rule-card' },
  { label: 'Monthly revenue target (company-wide)', tab: 'targets', anchor: 'targets-health' },
  { label: 'Per-location monthly revenue target override', tab: 'targets', anchor: 'location-targets-table' },
  { label: 'Target margin %, minimum acceptable margin %', tab: 'targets', anchor: 'targets-health' },
  { label: 'Collection days, overdue %, on-time delivery %, conversion %, CAC', tab: 'targets', anchor: 'targets-health' },
  { label: 'Health score pillar weights and bands', tab: 'targets', anchor: 'targets-health' },
  { label: 'Expansion ranking weights (demand, revenue share, growth, margin)', tab: 'targets', anchor: 'targets-expansion' },
];

export default function PricingConfig() {
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'products');
  const [q, setQ] = useState('');
  const hits = q.trim().length > 1 ? SEARCH_INDEX.filter(s => s.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const jump = useCallback((s) => {
    setTab(s.tab); setQ('');
    setTimeout(() => { const el = s.anchor && document.getElementById(s.anchor); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('ring-2', 'ring-emerald-400'); setTimeout(() => el.classList.remove('ring-2', 'ring-emerald-400'), 1800); } }, 150);
  }, []);
  useEffect(() => { const u = new URL(window.location.href); u.searchParams.set('tab', tab); window.history.replaceState({}, '', u); }, [tab]);
  const meta = TABS.find(t => t.id === tab);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4" data-testid="pricing-config-page">
      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="flex-1"><h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">Pricing &amp; Config</h1><p className="text-sm text-slate-500">Five tabs. Every number on this page is edited in place — change it, save the row.</p></div>
        <div className="relative w-full lg:w-[420px]" data-testid="pc-search-wrap">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find any setting or product… e.g. margin, slab, rounding, target" className="h-9 pl-9" data-testid="pc-search" />
          {hits.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg" data-testid="pc-search-results">
              {hits.map((s, i) => <button key={s.label} type="button" onClick={() => jump(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center justify-between" data-testid={`pc-search-result-${i}`}><span>{s.label}</span><span className="text-[10px] uppercase text-slate-400 flex items-center gap-1">{TABS.find(t => t.id === s.tab)?.label}<ArrowRight className="h-3 w-3" /></span></button>)}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 overflow-x-auto" data-testid="pc-tabs">
        {TABS.map(t => { const I = t.icon; return (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap ${tab === t.id ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-800'}`} data-testid={`pc-tab-${t.id}`}><I className="h-4 w-4" />{t.label}</button>); })}
      </div>
      <p className="text-xs text-slate-500" data-testid="pc-tab-line">{meta.line}</p>

      <div data-testid={`pc-panel-${tab}`}>
        {tab === 'products' && <PricelistPage embedded />}
        {tab === 'slabs' && (<div className="space-y-4">
          <SlabRatesCard />
          <div id="calc-constants" className="rounded-lg border border-slate-200 bg-white p-3 space-y-2" data-testid="calc-constants">
            <p className="text-sm font-semibold text-slate-800">Benchmarks &amp; subsidy reference <span className="text-slate-400 font-normal text-xs">— used by the calculator only when no slab rate or inventory product applies</span></p>
            <AdvancedConfigSection only={['calc']} />
          </div>
        </div>)}
        {tab === 'services' && <div id="service-rates-table"><ServiceRatesTable /></div>}
        {tab === 'company' && <CompanyDefaultsCard />}
        {tab === 'targets' && (<div className="space-y-4">
          <div id="targets-health" data-testid="targets-health"><AdvancedConfigSection only={['health']} /></div>
          <div id="targets-expansion" className="rounded-lg border border-slate-200 bg-white p-3" data-testid="targets-expansion"><p className="text-sm font-semibold text-slate-800 mb-2">Expansion ranking weights <span className="text-slate-400 font-normal text-xs">— how districts are scored for opening a branch</span></p><AdvancedConfigSection only={['expansion']} /></div>
        </div>)}
      </div>
      <p className="text-[11px] text-slate-400">Looking for the PIN-code / DISCOM data tool? It moved to <Link to="/dashboard/expansion" className="underline">Expansion → Needs Location Review</Link>, where unresolved projects are fixed.</p>
    </div>
  );
}
