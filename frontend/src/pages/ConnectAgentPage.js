/* An AI app (Claude, ChatGPT, Cursor…) asks to connect to Sensoper through OAuth. An admin signs in, sees who is
 * asking and where access would go, chooses which login it works as, what it may do and for how long, and allows or
 * refuses it. Then the browser goes back to the AI app. The page never works inside another site's frame. */
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Bot, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { agentsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Field, errText } from '../components/kit/PageBits';
import { AccessPicker, ExpiryPicker, ExtraSwitches, ROLE, WorksAs, branchText, expiryDate } from './AIAgentsPage';

const framed = () => { try { return window.self !== window.top; } catch { return true; } };

function Shell({ children }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-8 sm:items-center sm:py-10">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testid="connect-agent">{children}</div>
    </div>
  );
}

function Section({ n, title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{n}</span>{title}</h2>
      {children}
    </section>
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
  const [exp, setExp] = useState('never');
  const [busy, setBusy] = useState('');
  const inFrame = framed();

  useEffect(() => {
    if (!user || !rid || inFrame) return;
    agentsAPI.request(rid).then((r) => {
      setReq(r.data);
      setF({ name: r.data.client_name, run_as_user_id: r.data.me.id, access: 'read', manage_access: false, read_saved_logins: false, expires_on: '' });
      agentsAPI.users().then((u) => setUsers(u.data || [])).catch(() => {});
    }).catch((e) => setProblem(e.response?.status === 403
      ? 'Only an admin can connect an AI app to Sensoper. Ask an admin to sign in on this page.'
      : errText(e, 'This connection request could not be loaded. Start again from the AI app.')));
  }, [user, rid, inFrame]);

  // Clickjacking: another website could show this page in a hidden frame and trick a click on Allow. Never draw the buttons there.
  if (inFrame) {
    return <Shell><div className="space-y-3 text-sm text-slate-700" data-testid="connect-framed"><p className="font-medium text-slate-900">Open this page on its own</p>
      <p>For your safety, Sensoper doesn’t show connection approvals inside another website.</p>
      <a href={window.location.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-emerald-700 underline">Open in a new tab<ExternalLink className="h-3.5 w-3.5" /></a></div></Shell>;
  }
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
      const r = allow
        ? await agentsAPI.approve(rid, { ...f, expires_on: expiryDate(exp, f.expires_on), consent_token: req.consent_token })
        : await agentsAPI.deny(rid, { consent_token: req.consent_token });
      window.location.assign(r.data.redirect);
    } catch (e) { toast.error(errText(e, 'Could not finish')); setBusy(''); }
  };
  const off = !(req.enabled && req.allow_connectors);
  const pool = users.length ? users : [{ id: req.me.id, name: req.me.name, role: 'admin', branches: [] }];
  const runner = pool.find((u) => u.id === f.run_as_user_id) || pool[0];
  return (
    <Shell>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50"><Bot className="h-6 w-6 text-emerald-600" /></span>
        <div className="min-w-0"><h1 className="font-['Outfit'] text-xl font-bold text-slate-900">{req.client_name} wants to use Sensoper</h1>
          <p className="text-xs text-slate-500">You are signed in as {user.name}. Nothing happens until you press Allow.</p></div>
      </div>

      <div className={`mt-4 rounded-lg p-3 text-sm ${req.warning ? 'border border-amber-300 bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`} data-testid="connect-return-host">
        <div className="flex items-start gap-2">
          {req.warning ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
          <div className="min-w-0 space-y-1">
            <p><b>Who is asking:</b> an app that calls itself “{req.client_name}”.</p>
            <p><b>Access goes to:</b> <span data-testid="connect-host">{req.return_host}</span></p>
            <p className="break-all font-mono text-[11px] text-slate-500">{req.redirect_uri}</p>
            {req.warning && <p className="font-medium" data-testid="connect-warning">{req.warning}</p>}
          </div>
        </div>
      </div>

      {off && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="min-w-0 flex-1">AI connections are switched off.</span>
          <Button size="sm" onClick={switchOn} disabled={!!busy} className="h-9 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="connect-switch-on">{busy === 'on' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Switch on'}</Button>
        </div>
      )}

      <div className="mt-5 space-y-5">
        <Section n={1} title="It works as">
          <WorksAs users={pool} value={f.run_as_user_id} onChange={(v) => setF({ ...f, run_as_user_id: v })} />
          <p className="text-xs text-slate-600" data-testid="connect-runner">
            {ROLE[runner.role] || runner.role} · {branchText(runner.role, runner.branches)}. It sees and changes only what {runner.name} may.</p>
        </Section>
        <Section n={2} title="What it may do">
          <AccessPicker value={f.access} onChange={(v) => setF({ ...f, access: v })} testid="connect-access" />
        </Section>
        <Section n={3} title="For how long">
          <ExpiryPicker choice={exp} setChoice={setExp} date={f.expires_on} setDate={(v) => setF({ ...f, expires_on: v })} />
        </Section>
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">More options</summary>
          <div className="mt-3 space-y-3">
            <Field label="Name in Sensoper"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11" data-testid="connect-name" /></Field>
            <ExtraSwitches f={f} setF={setF} />
          </div>
        </details>
        <p className="text-xs text-slate-500">Deletes, bulk changes, logins, bank details and anything that reaches customers wait for your yes in the chat. Every call is listed in Settings → AI agents → Activity, where you can pause or revoke it.</p>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => decide(false)} disabled={!!busy} className="h-11" data-testid="connect-deny">{busy === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Don’t allow'}</Button>
        <Button onClick={() => decide(true)} disabled={!!busy || off || f.name.trim().length < 2 || (exp === 'date' && !f.expires_on)} className="h-11 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="connect-allow">{busy === 'allow' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Allow'}</Button>
      </div>
    </Shell>
  );
}
