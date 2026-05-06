import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Loader2, Sun, Eye, EyeOff } from 'lucide-react';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_solar-estimator-14/artifacts/2dpfr2zb_slg.png";

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Light branded section */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-emerald-50 via-white to-sky-50 relative overflow-hidden">
        <div className="absolute top-20 left-10 w-32 h-32 rounded-full bg-[#4ADE40] opacity-10 blur-3xl"></div>
        <div className="absolute bottom-40 right-20 w-48 h-48 rounded-full bg-[#2D9BF0] opacity-10 blur-3xl"></div>
        <div className="absolute top-1/2 left-1/4 w-64 h-64 rounded-full bg-emerald-200 opacity-20 blur-3xl"></div>
        
        <div className="relative z-10 flex flex-col justify-center px-12">
          <img src={LOGO_URL} alt="Sensoper Controls & Renewables" className="h-28 w-auto object-contain mb-8" />
          <h1 className="text-4xl font-bold font-['Outfit'] mb-4">
            <span className="text-[#4ADE40]">Solar</span>{' '}
            <span className="text-[#2D9BF0]">Project</span>{' '}
            <span className="text-slate-800">Cost Estimator</span>
          </h1>
          <p className="text-base text-slate-500 leading-relaxed max-w-md">
            Streamline your solar installations with accurate cost estimations,
            professional quotations, and efficient project management.
          </p>
          <div className="mt-8 flex items-center gap-3 text-sm text-slate-400">
            <Sun className="h-4 w-4 text-[#4ADE40]" />
            <span>Powering India's solar future</span>
          </div>
        </div>
      </div>

      {/* Right side */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <Card className="w-full max-w-md border-slate-200 shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="flex items-center justify-center mb-4 lg:hidden">
              <img src={LOGO_URL} alt="Sensoper" className="h-16 w-auto object-contain" />
            </div>
            <CardTitle className="text-2xl font-['Outfit'] text-slate-900">Welcome back</CardTitle>
            <CardDescription className="text-slate-500">Sign in to your account to continue</CardDescription>
          </CardHeader>
          <CardContent>
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
            <div className="mt-6 text-center text-sm text-slate-500">
              Don't have an account?{' '}
              <Link to="/register" className="text-[#2D9BF0] hover:text-[#1a8ae0] font-medium" data-testid="register-link">Create account</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
