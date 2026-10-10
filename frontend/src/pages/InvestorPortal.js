/* What an investor sees after signing in: their company's numbers (only the sections an admin shared)
 * and their own money. A separate session from staff — it can't open any staff page. */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { investorPortalAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import BusinessView, { PeriodPicker } from '../components/investor/BusinessView';

const LOGO_URL = `${process.env.PUBLIC_URL}/logo.png`;
const inputCls = 'h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[15px] outline-none focus:border-emerald-400';

function ChangePassword({ forced, onDone, onCancel }) {
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (f.next.length < 8) return setErr('Use at least 8 characters.');
    if (f.next !== f.again) return setErr('The two new passwords are not the same.');
    setBusy(true);
    try { await investorPortalAPI.changePassword(f.current, f.next); toast.success('Password changed'); onDone(); }
    catch (e2) { setErr(formatApiErrorDetail(e2.response?.data?.detail)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="mx-auto max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white p-5" data-testid="investor-password-form">
      <h2 className="flex items-center gap-2 font-['Outfit'] text-lg font-semibold text-slate-900"><KeyRound className="h-5 w-5 text-emerald-600" />{forced ? 'Choose your own password' : 'Change password'}</h2>
      {forced && <p className="text-sm text-slate-600">You signed in with a temporary password. Please pick your own before you continue.</p>}
      <input type="password" autoComplete="current-password" placeholder={forced ? 'Temporary password' : 'Current password'} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} className={inputCls} data-testid="inv-pw-current" />
      <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} className={inputCls} data-testid="inv-pw-new" />
      <input type="password" autoComplete="new-password" placeholder="New password again" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} className={inputCls} data-testid="inv-pw-again" />
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="flex gap-2">
        {!forced && <Button type="button" variant="outline" onClick={onCancel} className="h-11 flex-1">Cancel</Button>}
        <Button type="submit" disabled={busy} className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="inv-pw-save">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save password'}</Button>
      </div>
    </form>
  );
}

export default function InvestorPortal() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [months, setMonths] = useState(12);
  const [pwOpen, setPwOpen] = useState(false);

  const loadMe = useCallback(() => investorPortalAPI.me().then((r) => setMe(r.data)).catch(() => navigate('/login', { replace: true })), [navigate]);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    if (!me || me.must_reset_password) return;
    setData(null);
    investorPortalAPI.dashboard(months).then((r) => setData(r.data)).catch((e) => {
      if (e.response?.status === 401) navigate('/login', { replace: true });
      else toast.error('Could not load the dashboard');
    });
  }, [me, months, navigate]);

  const signOut = async () => { await investorPortalAPI.logout().catch(() => {}); navigate('/login', { replace: true }); };

  if (!me) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-7 w-7 animate-spin text-emerald-600" /></div>;
  const logo = me.company?.logo_url || LOGO_URL;

  return (
    <div className="min-h-screen bg-slate-50" data-testid="investor-portal">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <img src={logo} onError={(e) => { e.currentTarget.src = LOGO_URL; }} alt={me.company?.name || 'Sensoper'} className="h-9 w-auto" />
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPwOpen(true)} className="gap-1.5 text-slate-600" data-testid="inv-change-pw"><KeyRound className="h-4 w-4" /><span className="hidden sm:inline">Password</span></Button>
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 text-slate-600" data-testid="inv-signout"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:py-6">
        {me.must_reset_password ? (
          <ChangePassword forced onDone={loadMe} />
        ) : pwOpen ? (
          <ChangePassword onDone={() => setPwOpen(false)} onCancel={() => setPwOpen(false)} />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Investor dashboard</p>
                <h1 className="font-['Outfit'] text-2xl font-bold text-slate-900" data-testid="investor-hello">Hello, {me.name?.split(' ')[0]}</h1>
                <p className="text-sm text-slate-500">How {me.company?.name || 'the company'} is doing{me.organisation ? ` · ${me.organisation}` : ''}</p>
              </div>
              <PeriodPicker value={months} onChange={setMonths} />
            </div>
            {data ? <BusinessView data={data} audience="investor" /> : <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          </>
        )}
      </main>
    </div>
  );
}
