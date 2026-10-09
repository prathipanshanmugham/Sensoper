import { useEffect, useState } from 'react';
import { Layers, Package, Wrench } from 'lucide-react';
import PricelistPage from './PricelistPage';
import { SlabRatesCard } from '../components/SlabRatesCard';
import { ServiceRatesTable } from '../components/ServiceRatesTable';
import AdvancedConfigSection from '../components/AdvancedConfigSection';

/** Price list — every rate the calculator and quotes use, in three tabs. (These used to sit in Pricing & config.) */
const TABS = [
  { id: 'products', label: 'Products', icon: Package, line: 'Cost, margin % and GST % for every item. Edit a cell, press Enter.' },
  { id: 'slabs', label: 'Package slabs', icon: Layers, line: 'Package ₹ per kW / HP / unit by size band for each kit category. Benchmarks below apply when no slab matches.' },
  { id: 'services', label: 'Service rates', icon: Wrench, line: 'Structure, cabling and installation rates, each with its own margin % and GST %.' },
];

export default function PriceListHub() {
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return TABS.some((x) => x.id === t) ? t : 'products';
  });
  useEffect(() => { const u = new URL(window.location.href); u.searchParams.set('tab', tab); window.history.replaceState(window.history.state, '', u); }, [tab]);
  const meta = TABS.find((t) => t.id === tab);
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4" data-testid="price-list-hub">
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" data-testid="pl-tabs">
        {TABS.map((t) => { const I = t.icon; return (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ${tab === t.id ? 'bg-white text-slate-900 shadow' : 'text-slate-500 hover:text-slate-800'}`} data-testid={`pl-tab-${t.id}`}><I className="h-4 w-4" />{t.label}</button>
        ); })}
      </div>
      {tab !== 'products' && <p className="text-xs text-slate-500">{meta.line}</p>}
      {tab === 'products' && <PricelistPage embedded />}
      {tab === 'slabs' && (
        <div className="space-y-4">
          <SlabRatesCard />
          <div id="calc-constants" className="space-y-2 rounded-lg border border-slate-200 bg-white p-3" data-testid="calc-constants">
            <p className="text-sm font-semibold text-slate-800">Benchmarks &amp; subsidy reference <span className="text-xs font-normal text-slate-400">— used by the calculator only when no slab rate or product applies</span></p>
            <AdvancedConfigSection only={['calc']} />
          </div>
        </div>
      )}
      {tab === 'services' && <div id="service-rates-table"><ServiceRatesTable /></div>}
    </div>
  );
}
