import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Loader2 } from 'lucide-react';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_solar-estimator-14/artifacts/2dpfr2zb_slg.png";

export default function Register() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    role: 'staff'
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      await register({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        phone: formData.phone || null,
        role: formData.role
      });
      navigate('/dashboard');
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Dark branded section */}
      <div 
        className="hidden lg:flex lg:w-1/2 bg-[#0a0a0a] relative overflow-hidden"
      >
        {/* Decorative elements */}
        <div className="absolute top-20 left-10 w-4 h-4 rounded-full bg-[#2D9BF0] opacity-80"></div>
        <div className="absolute top-28 left-16 w-3 h-3 rounded-full bg-[#2D9BF0] opacity-60"></div>
        <div className="absolute top-24 left-24 w-2 h-2 rounded-full bg-[#2D9BF0] opacity-40"></div>
        <div className="absolute top-36 left-12 w-2 h-2 rounded-full bg-[#2D9BF0] opacity-50"></div>
        <div className="absolute top-16 left-20 w-3 h-3 rounded-full bg-[#2D9BF0] opacity-70"></div>
        
        <div className="absolute bottom-40 right-20 w-32 h-32 rounded-full bg-[#4ADE40] opacity-10 blur-3xl"></div>
        <div className="absolute top-40 right-40 w-48 h-48 rounded-full bg-[#2D9BF0] opacity-10 blur-3xl"></div>
        
        <div className="relative z-10 flex flex-col justify-center px-12 text-white">
          <img 
            src={LOGO_URL} 
            alt="Sensoper Controls & Renewables" 
            className="h-32 w-auto object-contain mb-8"
          />
          <h1 className="text-4xl font-bold font-['Outfit'] mb-4">
            <span className="text-[#4ADE40]">Join</span>{' '}
            <span className="text-[#2D9BF0]">Our</span>{' '}
            <span className="text-white">Team</span>
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed">
            Create your account to start managing solar projects, 
            generate accurate estimates, and deliver professional quotations.
          </p>
        </div>
      </div>

      {/* Right side - Register form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-50">
        <Card className="w-full max-w-md border-slate-200 shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="flex items-center justify-center mb-4 lg:hidden">
              <img 
                src={LOGO_URL} 
                alt="Sensoper" 
                className="h-16 w-auto object-contain"
              />
            </div>
            <CardTitle className="text-2xl font-['Outfit'] text-slate-900">Create account</CardTitle>
            <CardDescription className="text-slate-500">
              Fill in your details to get started
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="register-error">
                  {error}
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="name" className="text-slate-700">Full Name</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Enter your full name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="h-11"
                  data-testid="register-name-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-700">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  className="h-11"
                  data-testid="register-email-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-slate-700">Phone (Optional)</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  placeholder="Enter your phone number"
                  value={formData.phone}
                  onChange={handleChange}
                  className="h-11"
                  data-testid="register-phone-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role" className="text-slate-700">Role</Label>
                <Select value={formData.role} onValueChange={(value) => setFormData(prev => ({ ...prev, role: value }))}>
                  <SelectTrigger className="h-11" data-testid="register-role-select">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-700">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Create a password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  className="h-11"
                  data-testid="register-password-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-slate-700">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                  className="h-11"
                  data-testid="register-confirm-password-input"
                />
              </div>

              <Button 
                type="submit" 
                className="w-full h-11 bg-[#4ADE40] hover:bg-[#3dba35] text-black font-medium"
                disabled={loading}
                data-testid="register-submit-btn"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Create account'
                )}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-slate-500">
              Already have an account?{' '}
              <Link to="/login" className="text-[#2D9BF0] hover:text-[#1a8ae0] font-medium" data-testid="login-link">
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
