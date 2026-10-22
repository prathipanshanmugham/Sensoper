/* Joint venture helpers for the AMC page: who is looking, the partner companies, the co-brand and the
 * company dropdown ("All companies / Sensoper / partner"). Partner work is always shown with its own chip. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { amcAPI, uploadAPI } from '../../utils/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export const OURS = 'ours';
export const ALL = 'all';
const LOGO = `${process.env.PUBLIC_URL}/logo.png`;
export const inr = (v) => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
export const logoUrl = (path) => (path ? uploadAPI.getFileUrl(path) : null);

export function useJv() {
  const [jv, setJv] = useState(null);
  const load = useCallback(() => amcAPI.jvMe().then((r) => setJv(r.data)).catch(() => setJv({ is_partner: false, partners: [], ours: {} })), []);
  useEffect(() => { load(); }, [load]);
  return { jv, reload: load };
}

export function orgName(jv, orgId) {
  if (!orgId) return jv?.ours?.name ? shortName(jv.ours.name) : 'Sensoper';
  return jv?.partners?.find((p) => p.id === orgId)?.name || 'Partner';
}
const shortName = (n) => (/sensoper/i.test(n) ? 'Sensoper' : n);

/** Who did it — always text, colour only as a helper. */
export function OrgChip({ jv, orgId, className = '' }) {
  const ours = !orgId;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ours ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-violet-50 text-violet-800 ring-1 ring-violet-200'} ${className}`} data-testid={ours ? 'org-chip-ours' : 'org-chip-partner'}>
      {!ours && <Building2 className="h-3 w-3" />}{orgName(jv, orgId)}
    </span>
  );
}

function LogoBox({ src, alt, fallback, big }) {
  const [bad, setBad] = useState(false);
  const h = big ? 'h-10' : 'h-8';
  if (!src || bad) return fallback;
  return <img src={src} alt={alt} onError={() => setBad(true)} className={`${h} w-auto max-w-[110px] object-contain sm:max-w-[150px]`} />;
}

/** "Sensoper logo × Partner logo". Admins and the partner's own people can change the partner logo here. */
export function CoBrand({ jv, partner, canEditLogo, onLogoChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  if (!partner) return null;
  const upload = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/') || f.type === 'image/svg+xml') { toast.error('Choose a PNG or JPG picture'); return; }
    if (f.size > 5 * 1024 * 1024) { toast.error('The logo must be under 5 MB'); return; }
    setBusy(true);
    try {
      const path = (await uploadAPI.uploadImage(f)).data.storage_path;
      await amcAPI.setPartnerLogo(partner.id, path);
      toast.success('Logo updated');
      onLogoChanged?.();
    } catch (err) { toast.error(err.response?.data?.detail || 'Could not upload the logo'); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3" data-testid="amc-cobrand">
      <LogoBox big src={jv?.ours?.logo_url || LOGO} alt="Sensoper" fallback={<span className="font-['Outfit'] text-sm font-bold text-emerald-700">Sensoper</span>} />
      <span className="text-lg font-light text-slate-400" aria-hidden="true">×</span>
      <div className="flex min-w-0 items-center gap-2">
        <LogoBox big src={logoUrl(partner.logo_path)} alt={partner.name} fallback={<span className="truncate font-['Outfit'] text-sm font-bold text-violet-700" data-testid="amc-cobrand-partner-name">{partner.name}</span>} />
      </div>
      <p className="ml-auto hidden text-right text-[11px] leading-tight text-slate-500 sm:block">AMC joint venture<br />{partner.name}</p>
      {canEditLogo && (
        <>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload} data-testid="amc-logo-input" />
          <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-label={partner.logo_path ? 'Change partner logo' : 'Add partner logo'} className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:ml-2" data-testid="amc-logo-upload">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}<span className="hidden sm:inline">{partner.logo_path ? 'Change logo' : 'Add logo'}</span>
          </button>
        </>
      )}
    </div>
  );
}

/** Company dropdown for our people: all companies, ours, or one partner. */
export function OrgSelect({ jv, value, onChange, includeAll = true, className = '' }) {
  if (!jv || jv.is_partner || !jv.partners?.length) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-10 bg-white ${className}`} data-testid="amc-org-select" aria-label="Company"><SelectValue /></SelectTrigger>
      <SelectContent>
        {includeAll && <SelectItem value={ALL}>All companies</SelectItem>}
        <SelectItem value={OURS}>Sensoper (ours)</SelectItem>
        {jv.partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} (partner)</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Fetch an uploaded image as a data URL for PDFs. */
export async function imageDataUrl(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) return null;
    const b = await r.blob();
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); });
  } catch { return null; }
}
