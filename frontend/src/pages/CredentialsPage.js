import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, ShieldOff, KeyRound, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { authAPI, securityAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/** Iter 53 — Credentials Management (admin) + personal 2FA / password section. */
export default function CredentialsPage() {
  const { isAdmin, refreshToken } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('');

  const load = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true);
    try { const r = await securityAPI.credentials(); setData(r.data); setDays(String(r.data.config.password_rotation_days)); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed to load credentials'); }
    finally { setLoading(false); }
  }, [isAdmin]);
  useEffect(() => { load(); }, [load]);

  const saveDays = async () => {
    try { await securityAPI.updateConfig({ password_rotation_days: parseInt(days) }); toast.success('Rotation threshold saved'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
  };
  const requireReset = async (u) => {
    try { await securityAPI.requireReset(u.id); toast.success(`${u.name} must reset their password at next login`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };
  const adminDisable = async (u) => {
    if (!window.confirm(`Turn off 2FA for ${u.name}? Use only if they lost their phone and backup codes.`)) return;
    try { await securityAPI.adminDisable2fa(u.id); toast.success('2FA disabled'); load(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4" data-testid="credentials-page">
      <div className="flex items-center gap-3">
        <Link to="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold font-['Outfit'] flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" />Account Security</h1>
          <p className="text-sm text-slate-500">Two-factor authentication, password age and forced resets{isAdmin ? ' for every account' : ''}.</p>
        </div>
      </div>

      <MySecurity onChanged={refreshToken} />

      {isAdmin && (loading ? <Loader2 className="h-5 w-5 animate-spin text-emerald-600" /> : data && (
        <Card data-testid="credentials-admin-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 flex-wrap gap-2">
            <CardTitle className="text-base font-['Outfit']">Credentials Management <span className="text-xs text-slate-400 font-normal">admin only</span></CardTitle>
            <div className="flex items-center gap-2 text-xs">
              <Label className="text-xs">Flag passwords older than</Label>
              <Input type="number" min="7" max="3650" value={days} onChange={(e) => setDays(e.target.value)} className="h-8 w-20" data-testid="rotation-days-input" />
              <span>days</span>
              <Button size="sm" variant="outline" className="h-8" onClick={saveDays} data-testid="rotation-days-save">Save</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 pb-3 text-center">
              <Stat label="Accounts" value={data.summary.users} testid="cred-summary-users" />
              <Stat label="2FA on" value={data.summary.with_2fa} testid="cred-summary-2fa" />
              <Stat label="Stale passwords" value={data.summary.stale_passwords} warn={data.summary.stale_passwords > 0} testid="cred-summary-stale" />
              <Stat label="Reset pending" value={data.summary.reset_pending} testid="cred-summary-reset" />
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-y border-slate-200 text-[10px] uppercase text-slate-500">
                <tr><th className="text-left px-3 py-2">User</th><th className="text-left px-3 py-2">Role</th><th className="text-left px-3 py-2">Password changed</th><th className="text-left px-3 py-2">Age</th><th className="text-left px-3 py-2">2FA</th><th className="text-left px-3 py-2">Last login</th><th className="text-right px-3 py-2">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map(u => (
                  <tr key={u.id} data-testid={`cred-row-${u.id}`} className={u.password_stale ? 'bg-amber-50/40' : ''}>
                    <td className="px-3 py-2"><p className="font-medium text-slate-800">{u.name}</p><p className="text-[11px] text-slate-400">{u.email}</p></td>
                    <td className="px-3 py-2 capitalize text-slate-600">{u.role}</td>
                    <td className="px-3 py-2 text-slate-600">{u.password_never_changed ? <span className="text-slate-400">never (since {fmt(u.password_changed_at) === '—' ? 'account creation' : ''})</span> : fmt(u.password_changed_at)}</td>
                    <td className="px-3 py-2" data-testid={`cred-age-${u.id}`}>{u.password_age_days == null ? '—' : <span className={u.password_stale ? 'text-amber-700 font-semibold' : 'text-slate-700'}>{u.password_age_days} d{u.password_stale && <AlertTriangle className="inline h-3.5 w-3.5 ml-1" />}</span>}</td>
                    <td className="px-3 py-2" data-testid={`cred-2fa-${u.id}`}>{u.totp_enabled ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">On · {u.backup_codes_left} codes</Badge> : <Badge variant="outline" className="text-slate-500">Off</Badge>}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{fmt(u.last_login_at)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {u.must_reset_password ? <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 mr-1" data-testid={`cred-reset-pending-${u.id}`}>Reset pending</Badge>
                        : <Button size="sm" variant="outline" className="h-7 text-xs mr-1" onClick={() => requireReset(u)} data-testid={`cred-require-reset-${u.id}`}><KeyRound className="h-3 w-3 mr-1" />Require reset</Button>}
                      {u.totp_enabled && <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-600" onClick={() => adminDisable(u)} data-testid={`cred-disable-2fa-${u.id}`}><ShieldOff className="h-3 w-3 mr-1" />Disable 2FA</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Stat({ label, value, warn, testid }) {
  return <div className="rounded-md bg-slate-50 py-2"><p className={`text-lg font-bold ${warn ? 'text-amber-700' : 'text-slate-900'}`} data-testid={testid}>{value}</p><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p></div>;
}

export function MySecurity({ onChanged }) {
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [disable, setDisable] = useState(null);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(() => authAPI.twoFaStatus().then(r => setStatus(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const start = async () => { setBusy('setup'); try { const r = await authAPI.twoFaSetup(); setSetup(r.data); } catch (e) { toast.error(e.response?.data?.detail || 'Setup failed'); } finally { setBusy(''); } };
  const enable = async () => { setBusy('enable'); try { await authAPI.twoFaEnable(code); toast.success('Two-factor authentication enabled'); setSetup(null); setCode(''); load(); onChanged?.(); } catch (e) { toast.error(e.response?.data?.detail || 'Invalid code'); } finally { setBusy(''); } };
  const doDisable = async () => { setBusy('disable'); try { await authAPI.twoFaDisable(disable.password, disable.code); toast.success('2FA disabled'); setDisable(null); load(); onChanged?.(); } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); } finally { setBusy(''); } };
  const changePw = async () => { setBusy('pw'); try { await authAPI.changePassword(pw.current_password, pw.new_password); toast.success('Password changed'); setPw({ current_password: '', new_password: '' }); load(); onChanged?.(); } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); } finally { setBusy(''); } };

  return (
    <Card data-testid="my-security-card">
      <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit']">My account</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-800 flex items-center gap-2">Two-factor authentication {status && (status.enabled ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100" data-testid="my-2fa-status">On · {status.backup_codes_left} backup codes left</Badge> : <Badge variant="outline" data-testid="my-2fa-status">Off</Badge>)}</div>
          {status?.must_reset_password && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2" data-testid="must-reset-banner">An admin has asked you to change your password now.</p>}
          {status && !status.enabled && !setup && <Button size="sm" onClick={start} disabled={!!busy} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="2fa-setup-btn"><ShieldCheck className="h-4 w-4 mr-1" />Set up authenticator app</Button>}
          {setup && (
            <div className="rounded-md border border-slate-200 p-3 space-y-2" data-testid="2fa-setup-panel">
              <img src={setup.qr_code} alt="Scan with your authenticator app" className="h-44 w-44" data-testid="2fa-qr" />
              <p className="text-xs text-slate-500">Manual key: <code className="font-mono" data-testid="2fa-manual-key">{setup.manual_key}</code></p>
              <p className="text-xs font-semibold text-amber-700">Save these backup codes now — shown once:</p>
              <pre className="text-xs bg-slate-50 rounded p-2 grid grid-cols-2 gap-x-4" data-testid="2fa-backup-codes">{setup.backup_codes.join('\n')}</pre>
              <div className="flex gap-2"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" className="h-9 w-40" data-testid="2fa-enable-code" /><Button size="sm" onClick={enable} disabled={busy === 'enable' || code.length < 6} data-testid="2fa-enable-btn">Confirm & enable</Button></div>
            </div>
          )}
          {status?.enabled && <Button size="sm" variant="outline" className="text-rose-700 border-rose-200" onClick={() => setDisable({ password: '', code: '' })} data-testid="2fa-disable-btn"><ShieldOff className="h-4 w-4 mr-1" />Turn off 2FA</Button>}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">Change password {status && status.password_age_days != null && <span className={`text-xs ${status.password_age_days > status.rotation_days ? 'text-amber-700 font-semibold' : 'text-slate-400'}`} data-testid="my-password-age">· {status.password_age_days} days old{status.password_age_days > status.rotation_days ? ` (over ${status.rotation_days}-day policy)` : ''}</span>}</p>
          <Input type="password" value={pw.current_password} onChange={(e) => setPw(p => ({ ...p, current_password: e.target.value }))} placeholder="Current password" className="h-9" data-testid="pw-current" />
          <Input type="password" value={pw.new_password} onChange={(e) => setPw(p => ({ ...p, new_password: e.target.value }))} placeholder="New password (min 8 chars)" className="h-9" data-testid="pw-new" />
          <Button size="sm" onClick={changePw} disabled={busy === 'pw' || !pw.current_password || pw.new_password.length < 8} data-testid="pw-change-btn"><RefreshCw className="h-4 w-4 mr-1" />Change password</Button>
        </div>
      </CardContent>
      <Dialog open={!!disable} onOpenChange={(v) => !v && setDisable(null)}>
        <DialogContent className="max-w-sm" data-testid="2fa-disable-dialog">
          <DialogHeader><DialogTitle>Turn off two-factor authentication</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input type="password" placeholder="Your password" value={disable?.password || ''} onChange={(e) => setDisable(d => ({ ...d, password: e.target.value }))} data-testid="2fa-disable-password" />
            <Input placeholder="Authenticator or backup code" value={disable?.code || ''} onChange={(e) => setDisable(d => ({ ...d, code: e.target.value }))} data-testid="2fa-disable-code" />
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setDisable(null)}>Cancel</Button><Button className="bg-rose-600 hover:bg-rose-700 text-white" onClick={doDisable} disabled={busy === 'disable'} data-testid="2fa-disable-confirm">Turn off</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
