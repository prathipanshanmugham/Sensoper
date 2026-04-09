import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Loader2, Sun } from 'lucide-react';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_solar-estimator-14/artifacts/2dpfr2zb_slg.png";

export default function Register() {
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '', phone: '', role: 'staff' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => { setFormData(prev => ({ ...prev, [e.target.name]: e.target.value })); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (formData.password !== formData.confirmPassword) { setError('Passwords do not match'); return; }
    if (formData.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await register({ name: formData.name, email: formData.email, password: formData.password, phone: formData.phone || null, role: formData.role });
      navigate('/dashboard');
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-emerald-50 via-white to-sky-50 relative overflow-hidden">
        <div className="absolute top-20 left-10 w-32 h-32 rounded-full bg-[#4ADE40] opacity-10 blur-3xl"></div>
        <div className="absolute bottom-40 right-20 w-48 h-48 rounded-full bg-[#2D9BF0] opacity-10 blur-3xl"></div>
        <div className="relative z-10 flex flex-col justify-center px-12">
          <img src={LOGO_URL} alt="Sensoper" className="h-28 w-auto object-contain mb-8" />
          <h1 className="text-4xl font-bold font-['Outfit'] mb-4">
            <span className="text-[#4ADE40]">Join</span>{' '}<span className="text-[#2D9BF0]">Our</span>{' '}<span className="text-slate-800">Team</span>
          </h1>
          <p className="text-base text-slate-500 leading-relaxed max-w-md">Create your account to start managing solar projects, generate estimates, and deliver professional quotations.</p>
          <div className="mt-8 flex items-center gap-3 text-sm text-slate-400"><Sun className="h-4 w-4 text-[#4ADE40]" /><span>Powering India's solar future</span></div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <Card className="w-full max-w-md border-slate-200 shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="flex items-center justify-center mb-4 lg:hidden"><img src={LOGO_URL} alt="Sensoper" className="h-16 w-auto object-contain" /></div>
            <CardTitle className="text-2xl font-['Outfit'] text-slate-900">Create account</CardTitle>
            <CardDescription className="text-slate-500">Fill in your details to get started</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="register-error">{error}</div>}
              <div className="space-y-2">
                <Label className="text-slate-700">Full Name</Label>
                <Input name="name" placeholder="Enter your full name" value={formData.name} onChange={handleChange} required className="h-12" data-testid="register-name-input" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Email</Label>
                <Input name="email" type="email" placeholder="Enter your email" value={formData.email} onChange={handleChange} required className="h-12" data-testid="register-email-input" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Phone (Optional)</Label>
                <Input name="phone" type="tel" placeholder="Enter phone" value={formData.phone} onChange={handleChange} className="h-12" data-testid="register-phone-input" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Role</Label>
                <Select value={formData.role} onValueChange={(v) => setFormData(p => ({ ...p, role: v }))}>
                  <SelectTrigger className="h-12" data-testid="register-role-select"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="staff">Staff</SelectItem><SelectItem value="manager">Manager</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Password</Label>
                <Input name="password" type="password" placeholder="Create a password" value={formData.password} onChange={handleChange} required className="h-12" data-testid="register-password-input" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Confirm Password</Label>
                <Input name="confirmPassword" type="password" placeholder="Confirm password" value={formData.confirmPassword} onChange={handleChange} required className="h-12" data-testid="register-confirm-password-input" />
              </div>
              <Button type="submit" className="w-full h-12 bg-[#4ADE40] hover:bg-[#3dba35] text-black font-medium text-base" disabled={loading} data-testid="register-submit-btn">
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : 'Create account'}
              </Button>
            </form>
            <div className="mt-6 text-center text-sm text-slate-500">Already have an account?{' '}<Link to="/login" className="text-[#2D9BF0] hover:text-[#1a8ae0] font-medium" data-testid="login-link">Sign in</Link></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
