/* An AI app (Claude, ChatGPT, Cursor…) asks to connect to Sensoper through OAuth. An admin signs in, chooses which
 * login it works as and what it may do, and allows or refuses it. Then the browser goes back to the AI app. */
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Bot, Loader2, ShieldCheck } from 'lucide-react';
import { agentsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Field, errText } from '../components/kit/PageBits';
import { AccessPicker, ExtraSwitches, WorksAs } from './AIAgentsPage';

function Shell({ children }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-10 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testid="connect-agent">{children}</div>
    </div>
  );
}

export default function ConnectAgentPage() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const rid = params.get('request') || '';
  const [req, setReq] = useState(null);
  const [problem, setProblem] = useState('');
  const [users, setUsers] = useState([]);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!user || !rid) return;
    agentsAPI.request(rid).then((r) => {
      setReq(r.data);
      setF({ name: r.data.client_name, run_as_user_id: r.data.me.id, access: 'write', manage_access: false, read_saved_logins: false });
      agentsAPI.users().then((u) => setUsers(u.data || [])).catch(() => {});
    }).catch((e) => setProblem(e.response?.status === 403
      ? 'Only an admin can connect an AI app to Sensoper. Ask an admin to sign in on this page, or to add the connection for you.'
      : errText(e, 'This connection request could not be loaded. Start again from the AI app.')));
  }, [user, rid]);

  if (loading) return <Shell><div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div></Shell>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!rid) return <Shell><p className="text-sm text-slate-700">Nothing to approve here. Start the connection from the AI app.</p></Shell>;
  if (problem) return <Shell><div className="flex items-start gap-2 text-sm text-slate-700"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" /><p data-testid="connect-problem">{problem}</p></div></Shell>;
  if (!req || !f) return <Shell><div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div></Shell>;

  const switchOn = async () => {
    setBusy('on');
    try { await agentsAPI.saveSettings({ enabled: true, allow_connectors: true }); setReq((r) => ({ ...r, enabled: true, allow_connectors: true })); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(''); }
  };
  const decide = async (allow) => {
    setBusy(allow ? 'allow' : 'deny');
    try {
      const r = allow ? await agentsAPI.approve(rid, f) : await agentsAPI.deny(rid);
      window.location.assign(r.data.redirect);
    } catch (e) { toast.error(errText(e, 'Could not finish')); setBusy(''); }
  };
  const off = !(req.enabled && req.allow_connectors);
  return (
    <Shell>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50"><Bot className="h-6 w-6 text-emerald-600" /></span>
        <div className="min-w-0"><h1 className="font-['Outfit'] text-xl font-bold text-slate-900">Connect {req.client_name} to Sensoper?</h1>
          <p className="text-xs text-slate-500">You are signed in as {user.name}</p></div>
      </div>
      <div className={`mt-4 flex items-start gap-2 rounded-lg p-3 text-xs ${req.known_app ? 'bg-slate-50 text-slate-700' : 'bg-amber-50 text-amber-900'}`} data-testid="connect-return-host">
        {req.known_app ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <p>After you allow it, access goes to <b>{req.return_host}</b>.{req.known_app ? '' : ' This is not a well-known AI app — only continue if you started this connection yourself just now.'}</p>
      </div>
      {off && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          AI agent connections are switched off.
          <Button size="sm" onClick={switchOn} disabled={!!busy} className="ml-2 h-8 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="connect-switch-on">{busy === 'on' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Switch on'}</Button>
        </div>
      )}
      <div className="mt-4 space-y-3">
        <Field label="Name in Sensoper"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11" data-testid="connect-name" /></Field>
        <Field label="Works as" hint="It sees and does what this login may — that login’s permissions and branches apply."><WorksAs users={users.length ? users : [{ id: req.me.id, name: req.me.name, role: 'admin' }]} value={f.run_as_user_id} onChange={(v) => setF({ ...f, run_as_user_id: v })} /></Field>
        <div className="space-y-1"><p className="text-xs font-medium text-slate-700">Access</p><AccessPicker value={f.access} onChange={(v) => setF({ ...f, access: v })} testid="connect-access" /></div>
        <ExtraSwitches f={f} setF={setF} />
        <p className="text-[11px] text-slate-500">Every call it makes is listed in Settings → AI agents → Activity. You can pause or remove it there any time.</p>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => decide(false)} disabled={!!busy} className="h-11" data-testid="connect-deny">{busy === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Don’t allow'}</Button>
        <Button onClick={() => decide(true)} disabled={!!busy || off || f.name.trim().length < 2} className="h-11 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="connect-allow">{busy === 'allow' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Allow'}</Button>
      </div>
    </Shell>
  );
}
