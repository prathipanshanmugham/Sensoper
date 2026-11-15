/* An AI agent asked to do something that needs a person: a delete, a change to logins or bank details, or anything
 * customers or the public see. The login it works as (or an admin) opens this page from the link, the bell or
 * Settings → AI agents, reads exactly what will happen, and approves or declines. The AI can't do this itself.
 * The page never works inside another site's frame. */
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Bot, Check, CheckCircle2, Clock, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { agentsAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { errText } from '../components/kit/PageBits';
import { CopyBox, ago, isFramed } from './AIAgentsPage';

function Shell({ children }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-8 sm:items-center sm:py-10">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testid="agent-approval">{children}</div>
    </div>
  );
}

const minutesLeft = (iso) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));

/** A value as a person reads it: secrets as dots, empty as a dash. */
const shown = (v) => {
  if (v === '[hidden]') return '••••••';
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return '(empty list)';
  if (typeof v === 'object') return '(empty)';
  return String(v);
};

/** Every value the agent will send, each on its own line with its full path ("bank details › account number"), and
 *  what it is now when Sensoper could read the record. Changed lines are highlighted. Long lists scroll; "Show all"
 *  opens the rest — nothing is cut. */
function Fields({ title, rows, compared, testid }) {
  const [all, setAll] = useState(false);
  if (!rows || rows.length === 0) return null;
  const changed = rows.filter((r) => r.changed).length;
  const list = all ? rows : rows.slice(0, 40);
  return (
    <div className="mt-3" data-testid={testid}>
      <p className="text-xs font-medium text-slate-700">{title} · {rows.length} value{rows.length === 1 ? '' : 's'}{compared ? ` · ${changed} changed` : ''}</p>
      <ul className="mt-1 max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {list.map((r) => (
          <li key={r.path} className={`px-3 py-2 text-xs ${r.changed ? 'bg-amber-50' : ''}`} data-testid="approval-field">
            <p className="break-words font-medium text-slate-600">{r.path.replace(/_/g, ' ')}</p>
            {compared && 'before' in r ? (
              <p className="mt-0.5 break-all font-mono text-[12px]">
                {r.changed ? <><span className="text-slate-400 line-through">{shown(r.before)}</span><span className="mx-1 text-slate-400">→</span>
                  <span className="font-semibold text-amber-900">{shown(r.value)}</span></>
                  : <span className="text-slate-800">{shown(r.value)} <span className="font-sans text-[10px] text-slate-400">(no change)</span></span>}
              </p>
            ) : <p className="mt-0.5 break-all font-mono text-[12px] text-slate-900">{shown(r.value)}</p>}
          </li>))}
      </ul>
      {rows.length > list.length && <button type="button" onClick={() => setAll(true)} className="mt-1 text-xs font-medium text-emerald-700 underline" data-testid={`${testid}-all`}>Show all {rows.length}</button>}
    </div>
  );
}

const STATUS = {
  approved: ['You approved it. The AI runs it the next time it checks — tell it to go ahead if it’s waiting.', 'green', CheckCircle2],
  running: ['Running now.', 'green', Loader2],
  done: ['Done.', 'green', CheckCircle2],
  failed: ['It was approved but didn’t go through.', 'amber', AlertTriangle],
  declined: ['Declined. It didn’t run.', 'slate', XCircle],
  expired: ['Nobody approved it in time, so it didn’t run. Ask the AI again if you still want it.', 'slate', Clock],
};

export default function AgentApprovalPage() {
  const { id } = useParams();
  const { user, loading } = useAuth();
  const location = useLocation();
  const [a, setA] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');
  const inFrame = isFramed();

  const load = useCallback(() => agentsAPI.approval(id).then((r) => setA(r.data))
    .catch((e) => setProblem(errText(e, 'This request could not be loaded.'))), [id]);
  useEffect(() => { if (user && !inFrame) load(); }, [user, inFrame, load]);
  // After an approval, follow it until the AI has run it (and a new customer password appears here).
  useEffect(() => {
    if (!a || !['approved', 'running'].includes(a.status)) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [a, load]);

  if (inFrame) {
    return <Shell><div className="space-y-3 text-sm text-slate-700" data-testid="approval-framed"><p className="font-medium text-slate-900">Open this page on its own</p>
      <p>For your safety, Sensoper doesn’t show approvals inside another website.</p>
      <a href={window.location.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-emerald-700 underline">Open in a new tab<ExternalLink className="h-3.5 w-3.5" /></a></div></Shell>;
  }
  if (loading) return <Shell><div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div></Shell>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (problem) return <Shell><div className="flex items-start gap-2 text-sm text-slate-700"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" /><p data-testid="approval-problem">{problem}</p></div></Shell>;
  if (!a) return <Shell><div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div></Shell>;

  const decide = async (yes) => {
    setBusy(yes ? 'approve' : 'decline');
    try {
      const r = yes ? await agentsAPI.approveAction(id, { consent_token: a.consent_token }) : await agentsAPI.declineAction(id, { consent_token: a.consent_token });
      setA((x) => ({ ...x, ...r.data }));
      toast.success(yes ? 'Approved' : 'Declined');
    } catch (e) { toast.error(errText(e, 'Could not save your answer')); load(); } finally { setBusy(''); }
  };
  const waiting = a.status === 'waiting';
  const [msg, tone, Icon] = STATUS[a.status] || [];
  return (
    <Shell>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50"><Bot className="h-6 w-6 text-amber-600" /></span>
        <div className="min-w-0"><h1 className="font-['Outfit'] text-xl font-bold text-slate-900">{a.agent_name} asks for your approval</h1>
          <p className="text-xs text-slate-500">Asked {ago(a.created_at)} · it works as {a.works_as}</p></div>
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="approval-what">
        <p className="font-medium">What will happen</p>
        <p className="mt-1">{a.what}</p>
        <p className="mt-2 break-all font-mono text-[11px] text-amber-800">{a.detail ? a.detail.split(' with ')[0] : `${a.method} ${a.path}`}</p>
      </div>
      <Fields title="What it will send" rows={a.fields} compared={a.compared} testid="approval-fields" />
      <Fields title="Filters" rows={a.query_fields} testid="approval-query" />

      {waiting ? (
        <>
          <p className="mt-4 text-xs text-slate-600">Approve only if you asked the AI for this. If it came from something the AI read (an email, a note, a ticket), decline it.
            {' '}This request ends in {minutesLeft(a.expires_at)} min.</p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => decide(false)} disabled={!!busy} className="h-11" data-testid="approval-decline">{busy === 'decline' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Decline'}</Button>
            <Button onClick={() => decide(true)} disabled={!!busy} className="h-11 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="approval-approve">{busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1 h-4 w-4" />Approve</>}</Button>
          </div>
        </>
      ) : (
        <div className={`mt-4 flex items-start gap-2 rounded-lg p-3 text-sm ${tone === 'green' ? 'bg-emerald-50 text-emerald-900' : tone === 'amber' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`} data-testid="approval-status">
          {Icon && <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${a.status === 'running' ? 'animate-spin' : ''}`} />}
          <div className="min-w-0"><p>{msg}</p>
            {a.decided_by_name && <p className="mt-1 text-xs opacity-80">{a.status === 'declined' ? 'Declined' : 'Approved'} by {a.decided_by_name}{a.decided_at ? `, ${ago(a.decided_at)}` : ''}.</p>}
            {a.result_summary && a.status !== 'declined' && <p className="mt-1 text-xs opacity-80">{a.result_summary}</p>}</div>
        </div>
      )}

      {a.revealed && Object.keys(a.revealed).length > 0 && (
        <div className="mt-4 space-y-2" data-testid="approval-revealed">
          <p className="text-sm font-medium text-slate-900">New password — for you, not for the AI</p>
          {Object.entries(a.revealed).map(([k, v]) => <CopyBox key={k} label={k.replace(/_/g, ' ')} text={v} />)}
          <p className="text-[11px] text-slate-500">Give it to the customer. They are asked to change it when they first sign in.</p>
        </div>
      )}
    </Shell>
  );
}
