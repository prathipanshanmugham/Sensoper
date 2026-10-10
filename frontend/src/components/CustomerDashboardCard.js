/* Project page: share the customer's own dashboard (private link + their mobile number). */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, Loader2, MessageCircle, RefreshCw, Smartphone, XCircle } from 'lucide-react';
import { customerDashboardAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from './ui/button';

export default function CustomerDashboardCard({ project }) {
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => customerDashboardAPI.getLink(project.id).then((r) => setLink(r.data)).catch(() => setLink({ active: false })), [project.id]);
  useEffect(() => { load(); }, [load]);
  const url = link?.path ? `${window.location.origin}${link.path}` : '';
  const phone = String(project.customer?.phone || '').replace(/\D/g, '').slice(-10);
  const first = (project.customer?.name || '').split(' ')[0];
  const message = `Hi ${first}, here is your solar dashboard from Sensoper — see your savings, breakeven, CO₂ saved, payments and service, and raise a request anytime:\n${url}\n\nOpen it and enter this mobile number to sign in.`;

  const create = async (rotate) => {
    if (rotate && !window.confirm('Make a new link? The old link will stop working.')) return;
    setBusy('create');
    try { const r = await customerDashboardAPI.createLink(project.id); setLink(r.data); toast.success(rotate ? 'New link ready — share it again' : 'Link ready to share'); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not create the link'); }
    finally { setBusy(''); }
  };
  const revoke = async () => {
    if (!window.confirm('Turn off this customer\'s dashboard link?')) return;
    setBusy('revoke');
    try { await customerDashboardAPI.revokeLink(project.id); setLink({ active: false }); toast.success('Link turned off'); }
    catch (e) { toast.error('Could not turn it off'); } finally { setBusy(''); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { toast.error('Copy failed — long-press the link to copy'); } };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="customer-dashboard-card">
      <p className="flex items-center gap-2 font-['Outfit'] text-[15px] font-semibold text-slate-900"><Smartphone className="h-4 w-4 text-emerald-600" />Customer dashboard</p>
      {link === null ? <Loader2 className="mt-3 h-4 w-4 animate-spin text-slate-400" /> : !link.active ? (
        <>
          <p className="mt-1 text-sm text-slate-600">Give {first || 'the customer'} their own page: savings, breakeven, CO₂ saved, payments, service visits, offers — and a button to raise a request.</p>
          <Button onClick={() => create(false)} disabled={!!busy} className="mt-3 h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="portal-create-link">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Create link</Button>
          {phone.length < 10 && <p className="mt-2 text-xs text-amber-700">Add the customer's 10-digit mobile number first — they use it to sign in.</p>}
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">The customer opens the link and enters their mobile number (…{phone.slice(-4)}).{link.open_count ? ` Opened ${link.open_count} time${link.open_count === 1 ? '' : 's'}${link.last_opened_at ? `, last on ${new Date(link.last_opened_at).toLocaleDateString('en-IN')}` : ''}.` : ' Not opened yet.'}</p>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2"><code className="min-w-0 flex-1 truncate text-xs text-slate-700" data-testid="portal-link-url">{url}</code><button type="button" onClick={copy} className="rounded p-1 text-slate-500 hover:bg-white" aria-label="Copy link"><Copy className="h-4 w-4" /></button></div>
          <div className="mt-3 flex flex-wrap gap-2">
            {phone.length === 10 && <a href={`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"><Button className="h-9 gap-1.5 bg-[#25D366] text-white hover:bg-[#1fb457]" data-testid="portal-share-whatsapp"><MessageCircle className="h-4 w-4" />Send on WhatsApp</Button></a>}
            <a href={url} target="_blank" rel="noopener noreferrer"><Button variant="outline" className="h-9 gap-1.5"><ExternalLink className="h-4 w-4" />Open</Button></a>
            <Button variant="ghost" onClick={() => create(true)} disabled={!!busy} className="h-9 gap-1.5 text-slate-600" data-testid="portal-rotate"><RefreshCw className="h-4 w-4" />New link</Button>
            <Button variant="ghost" onClick={revoke} disabled={!!busy} className="h-9 gap-1.5 text-slate-500" data-testid="portal-revoke"><XCircle className="h-4 w-4" />Turn off</Button>
          </div>
        </>
      )}
    </div>
  );
}
