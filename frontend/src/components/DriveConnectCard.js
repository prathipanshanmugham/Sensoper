/* Settings → Connections: Google Drive (site photos) and What3words. */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, CloudOff, ExternalLink, Loader2, MapPin, RefreshCw, Unplug } from 'lucide-react';
import { driveAPI, w3wAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from './ui/button';

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export function DriveConnectCard() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => driveAPI.status().then((r) => setS(r.data)).catch(() => setS({ connected: false, error: true })), []);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy('connect');
    try {
      const r = await driveAPI.connect();
      window.location.assign(r.data.auth_url);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not start the Google sign-in');
      setBusy('');
    }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Drive? Photos already in Drive stay there; new photos wait here until you connect again.')) return;
    setBusy('disconnect');
    try { await driveAPI.disconnect(); toast.success('Google Drive disconnected'); await load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not disconnect'); }
    finally { setBusy(''); }
  };
  const syncAll = async () => {
    setBusy('sync');
    try { const r = await driveAPI.syncAll(); toast.success(`Checked ${r.data.projects} project(s)`); await load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Copy failed'); }
    finally { setBusy(''); }
  };

  if (!s) return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Checking Google Drive…</div>;
  const appHost = typeof window !== 'undefined' ? window.location.host : '';
  let redirectHost = '';
  try { redirectHost = s.redirect_uri ? new URL(s.redirect_uri).host : ''; } catch { redirectHost = ''; }
  const hostMismatch = redirectHost && appHost && redirectHost !== appHost && !appHost.startsWith('localhost');
  const needsReconnect = s.status === 'needs_reconnect';

  return (
    <div id="google-drive" className="rounded-xl border border-slate-200 bg-white p-4 scroll-mt-20" data-testid="drive-connect-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-['Outfit'] text-[15px] font-semibold text-slate-900">
            Google Drive
            {s.connected ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Connected</span>
              : needsReconnect ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Needs reconnecting</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"><CloudOff className="h-3.5 w-3.5" />Not connected</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Site photos from New project are copied here automatically — one folder per project, split into Site, Roof, Electrical, Documents and Proof of visit.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.connected ? (
            <>
              {s.root_folder_link && <a href={s.root_folder_link} target="_blank" rel="noopener noreferrer"><Button variant="outline" className="h-10 gap-1.5" data-testid="drive-open-root"><ExternalLink className="h-4 w-4" />Open folder</Button></a>}
              <Button variant="outline" onClick={disconnect} disabled={!!busy} className="h-10 gap-1.5 text-slate-600" data-testid="drive-disconnect">{busy === 'disconnect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}Disconnect</Button>
            </>
          ) : (
            <Button onClick={connect} disabled={!!busy || s.configured === false} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="drive-connect">
              {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{needsReconnect ? 'Reconnect Google Drive' : 'Connect Google Drive'}
            </Button>
          )}
        </div>
      </div>

      {s.connected && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2 sm:block"><dt className="text-xs text-slate-500">Google account</dt><dd className="truncate font-medium text-slate-800" data-testid="drive-account">{s.account_email || '—'}</dd></div>
          <div className="flex justify-between gap-2 sm:block"><dt className="text-xs text-slate-500">Last copied</dt><dd className="text-slate-800">{when(s.last_sync_at)}</dd></div>
          <div className="flex items-center justify-between gap-2 sm:block"><dt className="text-xs text-slate-500">Waiting to copy</dt>
            <dd className="flex items-center gap-2 text-slate-800"><span className="tabular-nums">{s.pending_photos || 0} photo{s.pending_photos === 1 ? '' : 's'}</span>
              {s.pending_photos > 0 && <button type="button" onClick={syncAll} disabled={!!busy} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50" data-testid="drive-sync-all"><RefreshCw className={`h-3 w-3 ${busy === 'sync' ? 'animate-spin' : ''}`} />Copy now</button>}</dd></div>
          <div className="flex justify-between gap-2 sm:block"><dt className="text-xs text-slate-500">Connected by</dt><dd className="text-slate-800">{s.connected_by || '—'}</dd></div>
        </dl>
      )}
      {s.last_error && (s.connected || needsReconnect) && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{s.last_error}</p>}
      {s.connected && <p className="mt-3 text-[11px] text-slate-500">Tip: share the “Sensoper — Site photos” folder in Drive with your team once — every project folder inside it is shared too.</p>}

      {!s.connected && (
        <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600" data-testid="drive-setup">
          {s.configured === false && <p className="font-medium text-amber-800">Before connecting, the server needs {(s.missing || ['GOOGLE_CLIENT_SECRET']).join(' and ')} in its backend .env file (then restart the service).</p>}
          <p>In Google Cloud Console → Credentials → this OAuth client, the <strong>Authorized redirect URI</strong> must be exactly:</p>
          <code className="block break-all rounded bg-white px-2 py-1 font-mono text-[11px] text-slate-800" data-testid="drive-redirect-uri">{s.redirect_uri}</code>
          {hostMismatch && <p className="text-amber-800">This app is open on <strong>{appHost}</strong> but Google will send you back to <strong>{redirectHost}</strong>. Unless that address also opens this app, add <code className="font-mono">https://{appHost}/auth/google/callback</code> to the OAuth client and set GOOGLE_REDIRECT_URI to it.</p>}
          <p>Also enable the <strong>Google Drive API</strong> for that Google Cloud project.</p>
        </div>
      )}
    </div>
  );
}

export function W3wStatusRow() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { w3wAPI.status().then((r) => setCfg(r.data.configured)).catch(() => setCfg(false)); }, []);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="w3w-status">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-['Outfit'] text-[15px] font-semibold text-slate-900"><MapPin className="h-4 w-4 text-red-500" />What3words</p>
        <p className="text-xs text-slate-500">“Use my location” on New project fills in the GPS and the 3-word address by itself.</p>
      </div>
      {cfg === null ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        : cfg ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Ready</span>
          : <span className="text-xs text-amber-800">Add <code className="font-mono">W3W_API_KEY</code> to the backend .env file and restart.</span>}
    </div>
  );
}
