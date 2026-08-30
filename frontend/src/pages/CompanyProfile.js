import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { companyAPI, locationsAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { 
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  Loader2,
  Building2,
  Check,
  Palette,
  CreditCard,
  Globe,
  Upload
} from 'lucide-react';

export default function CompanyProfile() {
  const [profiles, setProfiles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await companyAPI.getAll();
      setProfiles(res.data);
    } catch (error) {
      console.error('Failed to fetch company profiles:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
    locationsAPI.list().then(r => setLocations(r.data || [])).catch(() => {});
  }, [fetchProfiles]);

  const [formData, setFormData] = useState({
    company_name: '',
    tagline: '',
    logo_url: '',
    primary_color: '#4ADE40',
    secondary_color: '#2D9BF0',
    address: '',
    phone: '',
    email: '',
    website: '',
    gst_number: '',
    pan_number: '',
    state: '',
    location_id: '',
    bank_details: {
      account_name: '',
      account_number: '',
      ifsc_code: '',
      bank_name: '',
      branch: '',
      upi_id: ''
    },
    authorized_signatory: '',
    designation: ''
  });

  const openCreateDialog = () => {
    setEditingProfile(null);
    setFormData({
      company_name: '',
      tagline: '',
      logo_url: '',
      primary_color: '#4ADE40',
      secondary_color: '#2D9BF0',
      address: '',
      phone: '',
      email: '',
      website: '',
      gst_number: '',
      pan_number: '',
      state: '',
      location_id: '',
      bank_details: {
        account_name: '',
        account_number: '',
        ifsc_code: '',
        bank_name: '',
        branch: ''
      },
      authorized_signatory: '',
      designation: ''
    });
    setActiveTab('basic');
    setError('');
    setShowDialog(true);
  };

  const openEditDialog = (profile) => {
    setEditingProfile(profile);
    setFormData({
      company_name: profile.company_name || '',
      tagline: profile.tagline || '',
      logo_url: profile.logo_url || '',
      primary_color: profile.primary_color || '#4ADE40',
      secondary_color: profile.secondary_color || '#2D9BF0',
      address: profile.address || '',
      phone: profile.phone || '',
      email: profile.email || '',
      website: profile.website || '',
      gst_number: profile.gst_number || '',
      pan_number: profile.pan_number || '',
      state: profile.state || '',
      location_id: profile.location_id || '',
      bank_details: profile.bank_details || {
        account_name: '',
        account_number: '',
        ifsc_code: '',
        bank_name: '',
        branch: '',
        upi_id: ''
      },
      authorized_signatory: profile.authorized_signatory || '',
      designation: profile.designation || ''
    });
    setActiveTab('basic');
    setError('');
    setShowDialog(true);
  };

  const handleSubmit = async () => {
    if (!formData.company_name || !formData.address || !formData.phone || !formData.email) {
      setError('Company name, address, phone, and email are required');
      return;
    }

    setActionLoading(true);
    setError('');

    try {
      const payload = {
        ...formData,
        bank_details: formData.bank_details.account_name ? formData.bank_details : null
      };

      if (editingProfile) {
        await companyAPI.update(editingProfile.id, payload);
      } else {
        await companyAPI.create(payload);
      }
      setShowDialog(false);
      fetchProfiles();
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || 'Operation failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleActive = async (profile) => {
    setActionLoading(true);
    try {
      await companyAPI.update(profile.id, { is_active: !profile.is_active });
      fetchProfiles();
    } catch (err) {
      console.error('Failed to toggle active:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (profile) => {
    if (!window.confirm('Delete this company profile?')) return;
    
    try {
      await companyAPI.delete(profile.id);
      fetchProfiles();
    } catch (err) {
      alert(err.response?.data?.detail || 'Cannot delete active profile');
    }
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateBankField = (field, value) => {
    setFormData(prev => ({
      ...prev,
      bank_details: { ...prev.bank_details, [field]: value }
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">Company Profile</h1>
              <p className="text-slate-500">Manage company branding and details for quotations</p>
            </div>
          </div>
          <Button 
            onClick={openCreateDialog}
            className="bg-[#4ADE40] hover:bg-[#3dba35] text-black"
            data-testid="add-profile-btn"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Profile
          </Button>
        </div>

        {/* Info Card */}
        <Card className="border-blue-200 bg-blue-50 mb-6">
          <CardContent className="p-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> Only one profile can be active at a time. The active profile will be used in all PDF quotations and branding across the application.
            </p>
          </CardContent>
        </Card>

        {/* Profiles List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#4ADE40]" />
          </div>
        ) : profiles.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center">
              <Building2 className="h-12 w-12 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No company profiles</h3>
              <p className="text-slate-500 mb-4">Create your first company profile</p>
              <Button onClick={openCreateDialog} className="bg-[#4ADE40] hover:bg-[#3dba35] text-black">
                <Plus className="h-4 w-4 mr-2" />
                Create Profile
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {profiles.map((profile) => (
              <Card key={profile.id} className="border-slate-200" data-testid={`profile-card-${profile.id}`}>
                <CardContent className="p-6">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                    {/* Logo Preview */}
                    <div className="flex-shrink-0">
                      {profile.logo_url ? (
                        <img 
                          src={profile.logo_url} 
                          alt={profile.company_name}
                          className="h-20 w-auto object-contain bg-white rounded border p-2"
                        />
                      ) : (
                        <div className="h-20 w-32 bg-slate-100 rounded flex items-center justify-center">
                          <Building2 className="h-8 w-8 text-slate-400" />
                        </div>
                      )}
                    </div>
                    
                    {/* Profile Details */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-slate-900">{profile.company_name}</h3>
                        {profile.is_active && (
                          <Badge className="bg-[#4ADE40]/20 text-[#3dba35]">
                            <Check className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        )}
                      </div>
                      {profile.tagline && (
                        <p className="text-sm text-slate-500 mb-2">{profile.tagline}</p>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-slate-400" />
                          {profile.email}
                        </div>
                        <div>{profile.phone}</div>
                        {profile.gst_number && (
                          <div className="text-slate-500">GST: {profile.gst_number}</div>
                        )}
                      </div>
                      
                      {/* Color Preview */}
                      <div className="flex items-center gap-2 mt-3">
                        <span className="text-xs text-slate-500">Brand Colors:</span>
                        <div 
                          className="w-6 h-6 rounded border"
                          style={{ backgroundColor: profile.primary_color }}
                          title="Primary Color"
                        />
                        <div 
                          className="w-6 h-6 rounded border"
                          style={{ backgroundColor: profile.secondary_color }}
                          title="Secondary Color"
                        />
                      </div>
                    </div>
                    
                    {/* Actions */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`active-${profile.id}`} className="text-sm text-slate-500">
                          Active
                        </Label>
                        <Switch
                          id={`active-${profile.id}`}
                          checked={profile.is_active}
                          onCheckedChange={() => handleToggleActive(profile)}
                          disabled={actionLoading}
                          data-testid={`toggle-active-${profile.id}`}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openEditDialog(profile)}
                        data-testid={`edit-profile-${profile.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {!profile.is_active && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDelete(profile)}
                          data-testid={`delete-profile-${profile.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProfile ? 'Edit Company Profile' : 'Create Company Profile'}</DialogTitle>
            <DialogDescription>Configure company details for quotations and branding</DialogDescription>
          </DialogHeader>
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic" className="gap-2">
                <Building2 className="h-4 w-4" />
                Basic Info
              </TabsTrigger>
              <TabsTrigger value="branding" className="gap-2">
                <Palette className="h-4 w-4" />
                Branding
              </TabsTrigger>
              <TabsTrigger value="bank" className="gap-2">
                <CreditCard className="h-4 w-4" />
                Bank Details
              </TabsTrigger>
            </TabsList>

            {error && (
              <div className="mt-4 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
                {error}
              </div>
            )}

            <TabsContent value="basic" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Company Name *</Label>
                  <Input
                    value={formData.company_name}
                    onChange={(e) => updateField('company_name', e.target.value)}
                    placeholder="Sensoper Controls & Renewables"
                    data-testid="company-name-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tagline</Label>
                  <Input
                    value={formData.tagline}
                    onChange={(e) => updateField('tagline', e.target.value)}
                    placeholder="Solar Solutions Provider"
                    data-testid="tagline-input"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Address *</Label>
                <Textarea
                  value={formData.address}
                  onChange={(e) => updateField('address', e.target.value)}
                  placeholder="123 Solar Street&#10;City, State - PIN"
                  rows={3}
                  data-testid="address-input"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Phone *</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    placeholder="+91 98765 43210"
                    data-testid="phone-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    placeholder="info@company.com"
                    data-testid="email-input"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Website</Label>
                  <Input
                    value={formData.website}
                    onChange={(e) => updateField('website', e.target.value)}
                    placeholder="www.company.com"
                    data-testid="website-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>GST Number</Label>
                  <Input
                    value={formData.gst_number}
                    onChange={(e) => updateField('gst_number', e.target.value)}
                    placeholder="33XXXXX1234X1ZX"
                    data-testid="gst-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>PAN Number</Label>
                  <Input
                    value={formData.pan_number}
                    onChange={(e) => updateField('pan_number', e.target.value)}
                    placeholder="XXXXX1234X"
                    data-testid="pan-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>State (for GST split)</Label>
                  <Input
                    value={formData.state}
                    onChange={(e) => updateField('state', e.target.value)}
                    placeholder="Tamil Nadu"
                    data-testid="company-state-input"
                  />
                  <p className="text-xs text-slate-400">Used to decide CGST/SGST vs IGST on Direct Sales invoices.</p>
                </div>
                <div className="space-y-2">
                  <Label>Scoped Location (optional)</Label>
                  <Select value={formData.location_id || 'none'} onValueChange={(v) => updateField('location_id', v === 'none' ? '' : v)}>
                    <SelectTrigger data-testid="company-location-select"><SelectValue placeholder="Global (all locations)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Global (all locations)</SelectItem>
                      {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-400">Set this to give one branch its own GSTIN/state — it overrides the global profile for that branch's sales.</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Authorized Signatory</Label>
                  <Input
                    value={formData.authorized_signatory}
                    onChange={(e) => updateField('authorized_signatory', e.target.value)}
                    placeholder="John Doe"
                    data-testid="signatory-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Designation</Label>
                  <Input
                    value={formData.designation}
                    onChange={(e) => updateField('designation', e.target.value)}
                    placeholder="Managing Director"
                    data-testid="designation-input"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="branding" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>Company Logo</Label>
                <div className="flex gap-3 items-start">
                  <div className="flex-1">
                    <Input
                      value={formData.logo_url}
                      onChange={(e) => updateField('logo_url', e.target.value)}
                      placeholder="https://example.com/logo.png or upload below"
                      data-testid="logo-url-input"
                    />
                    <div className="mt-2">
                      <label className="inline-flex items-center gap-2 px-4 py-2 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                        <Upload className="h-4 w-4 text-slate-500" />
                        <span className="text-sm text-slate-600">{uploading ? 'Uploading...' : 'Upload Logo Image'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          data-testid="logo-file-input"
                          disabled={uploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setUploading(true);
                            try {
                              const res = await companyAPI.uploadLogo(file);
                              updateField('logo_url', res.data.logo_url);
                            } catch (err) {
                              setError(formatApiErrorDetail(err.response?.data?.detail) || 'Logo upload failed');
                            } finally {
                              setUploading(false);
                            }
                          }}
                        />
                      </label>
                      <p className="text-xs text-slate-400 mt-1">Max 2MB. PNG, JPG, SVG supported.</p>
                    </div>
                  </div>
                  {formData.logo_url && (
                    <div className="flex-shrink-0 p-3 bg-slate-100 rounded-lg border">
                      <img 
                        src={formData.logo_url} 
                        alt="Logo preview"
                        className="h-16 w-auto object-contain"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </div>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Primary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={formData.primary_color}
                      onChange={(e) => updateField('primary_color', e.target.value)}
                      className="w-16 h-10 p-1 cursor-pointer"
                      data-testid="primary-color-input"
                    />
                    <Input
                      value={formData.primary_color}
                      onChange={(e) => updateField('primary_color', e.target.value)}
                      placeholder="#4ADE40"
                      className="flex-1"
                    />
                  </div>
                  <p className="text-xs text-slate-500">Used for headings, buttons, highlights</p>
                </div>
                <div className="space-y-2">
                  <Label>Secondary Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={formData.secondary_color}
                      onChange={(e) => updateField('secondary_color', e.target.value)}
                      className="w-16 h-10 p-1 cursor-pointer"
                      data-testid="secondary-color-input"
                    />
                    <Input
                      value={formData.secondary_color}
                      onChange={(e) => updateField('secondary_color', e.target.value)}
                      placeholder="#2D9BF0"
                      className="flex-1"
                    />
                  </div>
                  <p className="text-xs text-slate-500">Used for accents, links</p>
                </div>
              </div>
              
              {/* Preview */}
              <Card className="border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Branding Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <Button style={{ backgroundColor: formData.primary_color, color: '#000' }}>
                      Primary Button
                    </Button>
                    <Button variant="outline" style={{ borderColor: formData.secondary_color, color: formData.secondary_color }}>
                      Secondary Button
                    </Button>
                    <span style={{ color: formData.primary_color }} className="font-semibold">
                      Heading Text
                    </span>
                    <span style={{ color: formData.secondary_color }}>
                      Link Text
                    </span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="bank" className="mt-4 space-y-4">
              <p className="text-sm text-slate-500">Bank details will be displayed on quotation PDFs for payment reference.</p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Account Name</Label>
                  <Input
                    value={formData.bank_details.account_name}
                    onChange={(e) => updateBankField('account_name', e.target.value)}
                    placeholder="Company Name"
                    data-testid="account-name-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Account Number</Label>
                  <Input
                    value={formData.bank_details.account_number}
                    onChange={(e) => updateBankField('account_number', e.target.value)}
                    placeholder="1234567890123456"
                    data-testid="account-number-input"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>IFSC Code</Label>
                  <Input
                    value={formData.bank_details.ifsc_code}
                    onChange={(e) => updateBankField('ifsc_code', e.target.value)}
                    placeholder="SBIN0001234"
                    data-testid="ifsc-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Bank Name</Label>
                  <Input
                    value={formData.bank_details.bank_name}
                    onChange={(e) => updateBankField('bank_name', e.target.value)}
                    placeholder="State Bank of India"
                    data-testid="bank-name-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Input
                    value={formData.bank_details.branch}
                    onChange={(e) => updateBankField('branch', e.target.value)}
                    placeholder="Main Branch"
                    data-testid="branch-input"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>UPI ID</Label>
                  <Input
                    value={formData.bank_details.upi_id || ''}
                    onChange={(e) => updateBankField('upi_id', e.target.value)}
                    placeholder="company@upi"
                    data-testid="upi-id-input"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={actionLoading}
              className="bg-[#4ADE40] hover:bg-[#3dba35] text-black"
              data-testid="save-profile-btn"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingProfile ? 'Save Changes' : 'Create Profile'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}