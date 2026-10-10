import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, formatApiErrorDetail } from '../contexts/AuthContext';
import { investorPortalAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Loader2, Eye, EyeOff, Building2, ShieldCheck, Leaf, Lock } from 'lucide-react';

const LOGO_URL = `${process.env.PUBLIC_URL}/logo.png`;
const PILLARS = [
  { icon: Building2, title: 'Solar EPC, end to end', line: 'Design, engineering, procurement and installation for homes, farms and industry.' },
  { icon: ShieldCheck, title: 'Built to last', line: 'Trusted components, trained installers and service that stays with every system.' },
  { icon: Leaf, title: 'Powering a cleaner India', line: 'Every plant we commission cuts bills and carbon for decades.' },
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, completeTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [needs2fa, setNeeds2fa] = useState(false);
  const [code, setCode] = useState('');

  const handleCode = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try { await completeTwoFactor(code); navigate('/dashboard'); }
    catch (err) { setError(formatApiErrorDetail(err.response?.data?.detail) || 'Invalid code'); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(email, password);
      if (res?.requires_2fa) { setNeeds2fa(true); return; }
      navigate('/dashboard');
    } catch (err) {
      // Investors use the same page; their account lives apart from staff logins.
      if (err.response?.status === 401) {
        try {
          await investorPortalAPI.login(email, password);
          navigate('/investor');
          return;
        } catch (invErr) {
          if (invErr.response?.status === 429) { setError(formatApiErrorDetail(invErr.response.data?.detail)); return; }
        }
      }
      setError(formatApiErrorDetail(err.response?.data?.detail) || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side — corporate welcome */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-sky-50" data-testid="login-brand-panel">
        <div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-[#4ADE40] opacity-10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-[#2D9BF0] opacity-10 blur-3xl" />
        <div className="relative z-10 flex w-full flex-col justify-between px-14 py-12">
          <img src={LOGO_URL} alt="Sensoper Controls & Renewables" className="h-20 w-auto self-start object-contain" />
          <div className="max-w-lg">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Sensoper Controls &amp; Renewables</p>
            <h1 className="mt-3 font-['Outfit'] text-5xl font-bold leading-tight text-slate-900">Welcome to <span className="text-[#2D9BF0]">Sensoper</span></h1>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">Engineering clean, dependable solar power — and running every project, team and customer relationship from one secure workspace.</p>
            <ul className="mt-10 space-y-5">
              {PILLARS.map(({ icon: I, title, line }) => (
                <li key={title} className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200"><I className="h-5 w-5" /></span>
                  <span><span className="block font-semibold text-slate-900">{title}</span><span className="block text-sm text-slate-500">{line}</span></span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} Sensoper Controls &amp; Renewables · Authorised users only</p>
        </div>
      </div>

      {/* Right side */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <Card className="w-full max-w-md border-slate-200 shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="mb-4 flex flex-col items-center lg:hidden">
              <img src={LOGO_URL} alt="Sensoper" className="h-16 w-auto object-contain" />
              <p className="mt-4 font-['Outfit'] text-2xl font-bold text-slate-900">Welcome to <span className="text-[#2D9BF0]">Sensoper</span></p>
              <p className="mt-1 text-sm text-slate-500">Engineering clean, dependable solar power.</p>
            </div>
            <CardTitle className="text-2xl font-['Outfit'] text-slate-900" data-testid="login-title">Sign in</CardTitle>
            <CardDescription className="text-slate-500">Use your Sensoper work account</CardDescription>
          </CardHeader>
          <CardContent>
            {needs2fa ? (
              <form onSubmit={handleCode} className="space-y-4" data-testid="login-2fa-form">
                <div className="space-y-2">
                  <Label htmlFor="code">Authenticator code</Label>
                  <p className="text-xs text-slate-500">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
                  <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" autoFocus autoComplete="one-time-code" className="h-11 tracking-widest" data-testid="login-2fa-code-input" />
                </div>
                <Button type="submit" disabled={loading || !code} className="w-full h-11 bg-emerald-600 hover:bg-emerald-700" data-testid="login-2fa-submit">{loading ? 'Verifying…' : 'Verify & sign in'}</Button>
                <button type="button" onClick={() => { setNeeds2fa(false); setCode(''); }} className="text-xs text-slate-500 underline w-full" data-testid="login-2fa-back">Back</button>
              </form>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="login-error">{error}</div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-700">Email</Label>
                <Input id="email" type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12" data-testid="login-email-input" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-700">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-12 pr-11"
                    data-testid="login-password-input"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors p-1 rounded"
                    data-testid="login-password-toggle"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full h-12 bg-[#4ADE40] hover:bg-[#3dba35] text-black font-medium text-base" disabled={loading} data-testid="login-submit-btn">
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in...</> : 'Sign in'}
              </Button>
            </form>
            )}
            <p className="mt-6 text-center text-sm text-slate-500" data-testid="login-account-help">
              No account yet? Ask your admin to add you under Settings → Users.
            </p>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-400"><Lock className="h-3 w-3" />Secure sign-in · for Sensoper team members only</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
