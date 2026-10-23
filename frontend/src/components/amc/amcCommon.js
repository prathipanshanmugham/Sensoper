/* Shared bits for the AMC page: money format, the company AMC documents go out under (AMC settings → company),
 * and the system types used on contracts and quotes. */
import { useCallback, useEffect, useState } from 'react';
import { amcAPI } from '../../utils/api';

const LOGO = `${process.env.PUBLIC_URL}/logo.png`;
export const inr = (v) => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;

/** The company profile on every AMC quote, report and the AMC page header (chosen in AMC settings). */
export function useAmcBrand() {
  const [brand, setBrand] = useState(null);
  const load = useCallback(() => amcAPI.brand().then((r) => setBrand(r.data)).catch(() => setBrand({ company_name: 'Sensoper Controls & Renewables' })), []);
  useEffect(() => { load(); }, [load]);
  return { brand, reload: load };
}

function LogoBox({ src, alt, fallback }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return fallback;
  return <img src={src} alt={alt} onError={() => setBad(true)} className="h-10 w-auto max-w-[130px] object-contain sm:max-w-[160px]" />;
}

/** Logo and name of the company AMC documents go out under. */
export function BrandStrip({ brand }) {
  const name = brand?.company_name || 'Sensoper';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3" data-testid="amc-brand-strip">
      <LogoBox src={brand?.logo_base64 || brand?.logo_url || LOGO} alt={name} fallback={<span className="font-['Outfit'] text-sm font-bold text-emerald-700">{name}</span>} />
      <p className="ml-auto text-right text-[11px] leading-tight text-slate-500">AMC documents go out as<br /><b className="text-slate-700">{name}</b></p>
    </div>
  );
}

/** System types on AMC contracts and quotes ("Others" asks what it is). */
export const SYSTEM_TYPE_OPTIONS = [['on-grid', 'On-grid'], ['off-grid', 'Off-grid'], ['hybrid', 'Hybrid'], ['solar-pump', 'Solar pump'], ['others', 'Others']];
export const systemLabel = (row) => {
  if (!row) return '';
  if (row.system_type === 'others') return row.system_type_other || 'Other system';
  return (SYSTEM_TYPE_OPTIONS.find(([v]) => v === row.system_type) || [null, row.system_type || ''])[1];
};
