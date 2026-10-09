/* Google sends the admin back here after "Connect Google Drive". We hand the one-time code to the server,
 * which swaps it for a token and keeps it encrypted. Nothing secret is stored in the browser. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { driveAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';

export default function GoogleCallback() {
  const [state, setState] = useState({ phase: 'working', text: 'Finishing the Google Drive connection…' });
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;           // React StrictMode runs effects twice; the code works only once
    sent.current = true;
    const q = new URLSearchParams(window.location.search);
    const body = { code: q.get('code'), state: q.get('state') || '', error: q.get('error') };
    window.history.replaceState({}, '', window.location.pathname);   // keep the one-time code out of history
    if (!body.state) { setState({ phase: 'error', text: 'This page needs to be opened by Google. Go to Settings and press Connect.' }); return; }
    driveAPI.callback(body)
      .then((r) => setState({ phase: 'done', text: `Google Drive is connected${r.data.account_email ? ` as ${r.data.account_email}` : ''}. Site photos will now be copied there automatically.` }))
      .catch((e) => setState({ phase: 'error', text: formatApiErrorDetail(e.response?.data?.detail) || 'Could not finish connecting Google Drive.' }));
  }, []);

  const Icon = state.phase === 'working' ? Loader2 : state.phase === 'done' ? CheckCircle2 : XCircle;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm" data-testid="google-callback">
        <Icon className={`mx-auto h-10 w-10 ${state.phase === 'working' ? 'animate-spin text-slate-400' : state.phase === 'done' ? 'text-emerald-600' : 'text-red-500'}`} />
        <h1 className="mt-3 font-['Outfit'] text-lg font-semibold text-slate-900">{state.phase === 'done' ? 'Connected' : state.phase === 'error' ? 'Not connected' : 'Connecting…'}</h1>
        <p className="mt-1 text-sm text-slate-600" data-testid="google-callback-text">{state.text}</p>
        {state.phase !== 'working' && (
          <Link to="/dashboard/pricing-config#google-drive" className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800">Back to Settings</Link>
        )}
      </div>
    </div>
  );
}
