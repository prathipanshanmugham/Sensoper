import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsAPI, aiAPI, inventoryAPI, driveAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Progress } from '../components/ui/progress';
import { 
  User, MapPin, Zap, ArrowRight, ArrowLeft, Loader2, CheckCircle2,
  Sparkles, Plus, Trash2, Package, Camera, Cloud, CloudOff, X, Percent, FolderPlus
} from 'lucide-react';

const STEPS = [
  { id: 1, title: 'Customer', icon: User },
  { id: 2, title: 'Location', icon: MapPin },
  { id: 3, title: 'Electrical', icon: Zap },
  { id: 4, title: 'Materials', icon: Package },
  { id: 5, title: 'Site Images', icon: Camera }
];

const SYSTEM_TYPES = [
  { value: 'on-grid', label: 'On-Grid (Grid-Tied)' },
  { value: 'off-grid', label: 'Off-Grid (Standalone)' },
  { value: 'hybrid', label: 'Hybrid' }
];
const COMPLEXITY_LEVELS = [
  { value: 'simple', label: 'Simple' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'complex', label: 'Complex' }
];
const SERVICE_TYPES = [
  { value: 'single_phase', label: 'Single Phase' },
  { value: 'three_phase', label: 'Three Phase' },
  { value: 'ht_service', label: 'HT Service (High Tension)' }
];

export default function SiteVisitForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin, isManager } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [error, setError] = useState('');
  const [inventoryItems, setInventoryItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveChecking, setDriveChecking] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  const canSetMargin = isAdmin || isManager;

  const [formData, setFormData] = useState({
    customer: { name: '', phone: '', address: '', email: '' },
    location: { latitude: null, longitude: null, address: '', site_location_words: '' },
    electrical: { sanction_load_kw: '', connected_load_kw: '', monthly_consumption_units: '', eb_tariff: '', service_type: '' },
    solar_system: { system_type: 'on-grid', inverter_model: '', panel_wattage: 540, battery_required: false, battery_capacity_ah: '' },
    mounting: { roof_type: '', tilt_angle: 15, structure_type: '' },
    additional: { cable_length_meters: 50, inverter_to_panel_distance: 10, installation_complexity: 'simple', shadow_analysis_notes: '' },
    selected_items: [],
    manual_costs: [],
    site_images: []
  });

  useEffect(() => {
    fetchInventory();
    fetchCategories();
    checkDriveStatus();
  }, []);

  useEffect(() => {
    if (searchParams.get('drive_connected') === 'true') {
      setDriveConnected(true);
      setDriveChecking(false);
    }
  }, [searchParams]);

  const fetchInventory = async () => {
    try { const res = await inventoryAPI.getItems(); setInventoryItems(res.data); } catch (err) { console.error(err); }
  };
  const fetchCategories = async () => {
    try { const res = await inventoryAPI.getCategories(); setCategories(res.data); } catch (err) { console.error(err); }
  };
  const checkDriveStatus = async () => {
    try {
      const res = await driveAPI.status();
      setDriveConnected(res.data.connected);
    } catch (err) { console.error(err); }
    finally { setDriveChecking(false); }
  };

  const connectDrive = async () => {
    try {
      const res = await driveAPI.connect();
      window.location.href = res.data.authorization_url;
    } catch (err) {
      setError('Failed to connect Google Drive');
    }
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadingImage(true);
    setError('');
    for (const file of files) {
      try {
        const res = await driveAPI.upload(file);
        setFormData(prev => ({
          ...prev,
          site_images: [...prev.site_images, {
            file_id: res.data.file_id,
            image_url: res.data.image_url,
            view_url: res.data.view_url,
            filename: res.data.filename
          }]
        }));
      } catch (err) {
        setError(err.response?.data?.detail || `Failed to upload ${file.name}`);
        break;
      }
    }
    setUploadingImage(false);
    e.target.value = '';
  };

  const removeImage = (index) => {
    setFormData(prev => ({ ...prev, site_images: prev.site_images.filter((_, i) => i !== index) }));
  };

  const updateField = (section, field, value) => {
    setFormData(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  };

  const addSelectedItem = (itemId) => {
    const invItem = inventoryItems.find(i => i.id === itemId);
    if (!invItem || formData.selected_items.find(si => si.inventory_item_id === itemId)) return;
    setFormData(prev => ({
      ...prev,
      selected_items: [...prev.selected_items, {
        inventory_item_id: invItem.id, name: invItem.name, category: invItem.category,
        unit_price: invItem.unit_price, gst_percentage: invItem.gst_percentage, quantity: 1,
        margin_percentage: 0
      }]
    }));
  };

  const updateSelectedItem = (index, field, value) => {
    setFormData(prev => {
      const items = [...prev.selected_items];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, selected_items: items };
    });
  };
  const removeSelectedItem = (index) => {
    setFormData(prev => ({ ...prev, selected_items: prev.selected_items.filter((_, i) => i !== index) }));
  };
  const addManualCost = () => {
    setFormData(prev => ({ ...prev, manual_costs: [...prev.manual_costs, { description: '', amount: 0 }] }));
  };
  const updateManualCost = (index, field, value) => {
    setFormData(prev => {
      const costs = [...prev.manual_costs];
      costs[index] = { ...costs[index], [field]: value };
      return { ...prev, manual_costs: costs };
    });
  };
  const removeManualCost = (index) => {
    setFormData(prev => ({ ...prev, manual_costs: prev.manual_costs.filter((_, i) => i !== index) }));
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    try {
      const slug = newCategoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      await inventoryAPI.createCategory({ name: newCategoryName.trim(), slug, description: '' });
      await fetchCategories();
      setNewCategoryName('');
      setShowAddCategory(false);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create category');
    } finally { setCreatingCategory(false); }
  };

  const getAIRecommendation = async () => {
    setAiLoading(true);
    try {
      const res = await aiAPI.getRecommendations({
        monthly_consumption_units: parseFloat(formData.electrical.monthly_consumption_units) || 0,
        sanction_load_kw: parseFloat(formData.electrical.sanction_load_kw) || 0,
        roof_type: formData.mounting.roof_type, budget_range: null
      });
      setAiRecommendation(res.data.recommendation);
    } catch (err) { setError('Failed to get AI recommendation'); }
    finally { setAiLoading(false); }
  };

  const getItemsByCategory = (cat) => inventoryItems.filter(i => i.category === cat && i.quantity > 0);
  const getCategoryLabel = (slug) => categories.find(c => c.slug === slug)?.name || slug;

  const calculateTotal = () => {
    const itemsTotal = formData.selected_items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    const manualTotal = formData.manual_costs.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
    const gstTotal = formData.selected_items.reduce((sum, i) => sum + i.unit_price * i.quantity * (i.gst_percentage / 100), 0);
    const marginTotal = formData.selected_items.reduce((sum, i) => sum + i.unit_price * i.quantity * ((i.margin_percentage || 0) / 100), 0);
    return { itemsTotal, manualTotal, gstTotal, marginTotal, total: itemsTotal + manualTotal + gstTotal + marginTotal };
  };

  const validateStep = () => {
    setError('');
    switch (currentStep) {
      case 1:
        if (!formData.customer.name || !formData.customer.phone || !formData.customer.address) { setError('Please fill all required fields'); return false; }
        break;
      case 2:
        if (!formData.location.site_location_words && !formData.location.address) { setError('Enter What3Words or site address'); return false; }
        break;
      case 3:
        if (!formData.electrical.sanction_load_kw || !formData.electrical.monthly_consumption_units) { setError('Fill in required electrical details'); return false; }
        break;
      case 4:
        if (formData.selected_items.length === 0) { setError('Add at least one inventory item'); return false; }
        break;
      case 5:
        if (formData.site_images.length === 0) { setError('Upload at least one site image (mandatory)'); return false; }
        break;
      default: break;
    }
    return true;
  };

  const nextStep = () => { if (validateStep()) setCurrentStep(prev => Math.min(prev + 1, 5)); };
  const prevStep = () => { setCurrentStep(prev => Math.max(prev - 1, 1)); setError(''); };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setLoading(true);
    setError('');
    try {
      const payload = {
        customer: formData.customer,
        location: {
          latitude: formData.location.latitude ? parseFloat(formData.location.latitude) : null,
          longitude: formData.location.longitude ? parseFloat(formData.location.longitude) : null,
          address: formData.location.address, site_location_words: formData.location.site_location_words
        },
        electrical: {
          sanction_load_kw: parseFloat(formData.electrical.sanction_load_kw),
          connected_load_kw: parseFloat(formData.electrical.connected_load_kw) || 0,
          monthly_consumption_units: parseFloat(formData.electrical.monthly_consumption_units),
          eb_tariff: parseFloat(formData.electrical.eb_tariff) || 0,
          service_type: formData.electrical.service_type || null
        },
        solar_system: {
          ...formData.solar_system, panel_wattage: parseInt(formData.solar_system.panel_wattage) || 540,
          battery_capacity_ah: formData.solar_system.battery_required ? parseInt(formData.solar_system.battery_capacity_ah) || 0 : null
        },
        mounting: { ...formData.mounting, tilt_angle: parseInt(formData.mounting.tilt_angle) },
        additional: {
          ...formData.additional,
          cable_length_meters: parseFloat(formData.additional.cable_length_meters),
          inverter_to_panel_distance: parseFloat(formData.additional.inverter_to_panel_distance)
        },
        selected_items: formData.selected_items.map(si => ({
          inventory_item_id: si.inventory_item_id, name: si.name, category: si.category,
          unit_price: si.unit_price, gst_percentage: si.gst_percentage, quantity: parseInt(si.quantity) || 1,
          margin_percentage: parseFloat(si.margin_percentage) || 0
        })),
        manual_costs: formData.manual_costs.filter(c => c.description && c.amount > 0).map(c => ({
          description: c.description, amount: parseFloat(c.amount) || 0
        })),
        site_images: formData.site_images.map(img => img.image_url)
      };
      const res = await projectsAPI.create(payload);
      navigate(`/dashboard/projects/${res.data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create project');
    } finally { setLoading(false); }
  };

  const progress = (currentStep / 5) * 100;
  const totals = calculateTotal();

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 pb-24 sm:pb-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold font-['Outfit'] text-slate-900 mb-1">New Site Visit</h1>
          <p className="text-sm text-slate-500">Collect site data for an accurate solar project estimate</p>
        </div>

        {/* Progress Steps */}
        <div className="mb-6">
          <Progress value={progress} className="h-2 mb-3" />
          <div className="flex justify-between overflow-x-auto gap-1">
            {STEPS.map((step) => (
              <button key={step.id} onClick={() => { if (step.id < currentStep) setCurrentStep(step.id); }}
                className={`flex flex-col items-center min-w-[56px] ${currentStep >= step.id ? 'text-emerald-600' : 'text-slate-400'}`}>
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center mb-1 transition-colors ${
                  currentStep > step.id ? 'bg-emerald-600 text-white' : currentStep === step.id ? 'bg-emerald-100 text-emerald-600 ring-2 ring-emerald-600' : 'bg-slate-100 text-slate-400'
                }`}>
                  {currentStep > step.id ? <CheckCircle2 className="h-4 w-4" /> : <step.icon className="h-4 w-4" />}
                </div>
                <span className="text-[10px] sm:text-xs font-medium">{step.title}</span>
              </button>
            ))}
          </div>
        </div>

        <Card className="border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="font-['Outfit'] text-lg">{STEPS[currentStep - 1].title}</CardTitle>
            <CardDescription className="text-sm">
              {currentStep === 1 && 'Customer contact details'}
              {currentStep === 2 && 'Site location and roof details'}
              {currentStep === 3 && 'Electrical load information'}
              {currentStep === 4 && 'Select materials & add costs'}
              {currentStep === 5 && 'Upload site photos (mandatory)'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {error && <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="form-error">{error}</div>}

            {/* Step 1: Customer */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Customer Name *</Label><Input value={formData.customer.name} onChange={(e) => updateField('customer', 'name', e.target.value)} placeholder="Customer name" className="h-11" data-testid="customer-name-input" /></div>
                  <div className="space-y-2"><Label>Phone *</Label><Input type="tel" value={formData.customer.phone} onChange={(e) => updateField('customer', 'phone', e.target.value)} placeholder="Phone number" className="h-11" data-testid="customer-phone-input" /></div>
                </div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.customer.email} onChange={(e) => updateField('customer', 'email', e.target.value)} placeholder="Email (optional)" className="h-11" data-testid="customer-email-input" /></div>
                <div className="space-y-2"><Label>Address *</Label><Textarea rows={3} value={formData.customer.address} onChange={(e) => updateField('customer', 'address', e.target.value)} placeholder="Full address" className="min-h-[80px]" data-testid="customer-address-input" /></div>
              </div>
            )}

            {/* Step 2: Location */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                  <h3 className="font-semibold text-emerald-800 mb-1">What3Words Address</h3>
                  <p className="text-sm text-emerald-600 mb-2">Enter the 3-word location (e.g., apple.orange.table)</p>
                  <Input value={formData.location.site_location_words} onChange={(e) => updateField('location', 'site_location_words', e.target.value)} placeholder="word.word.word" className="font-mono h-11" data-testid="what3words-input" />
                </div>
                <div className="space-y-2"><Label>Site Address</Label><Textarea rows={2} value={formData.location.address} onChange={(e) => updateField('location', 'address', e.target.value)} placeholder="Site location description" data-testid="location-address-input" /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Roof Type</Label><Input value={formData.mounting.roof_type} onChange={(e) => updateField('mounting', 'roof_type', e.target.value)} placeholder="e.g., RCC Flat Roof, Metal Sheet" className="h-11" data-testid="roof-type-input" /></div>
                  <div className="space-y-2"><Label>Tilt Angle (degrees)</Label><Input type="number" min="0" max="90" value={formData.mounting.tilt_angle} onChange={(e) => updateField('mounting', 'tilt_angle', e.target.value)} className="h-11" data-testid="tilt-angle-input" /></div>
                </div>
                <div className="space-y-2"><Label>Structure Type</Label><Input value={formData.mounting.structure_type} onChange={(e) => updateField('mounting', 'structure_type', e.target.value)} placeholder="e.g., Galvanized Iron" className="h-11" data-testid="structure-type-input" /></div>
              </div>
            )}

            {/* Step 3: Electrical */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Type of Service *</Label>
                    <Select value={formData.electrical.service_type} onValueChange={(v) => updateField('electrical', 'service_type', v)}>
                      <SelectTrigger className="h-11" data-testid="service-type-select"><SelectValue placeholder="Select service type" /></SelectTrigger>
                      <SelectContent>{SERVICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Sanction Load (kW) *</Label><Input type="number" step="0.1" value={formData.electrical.sanction_load_kw} onChange={(e) => updateField('electrical', 'sanction_load_kw', e.target.value)} placeholder="e.g., 5" className="h-11" data-testid="sanction-load-input" /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Connected Load (kW)</Label><Input type="number" step="0.1" value={formData.electrical.connected_load_kw} onChange={(e) => updateField('electrical', 'connected_load_kw', e.target.value)} placeholder="e.g., 4" className="h-11" data-testid="connected-load-input" /></div>
                  <div className="space-y-2"><Label>Monthly Consumption (units) *</Label><Input type="number" value={formData.electrical.monthly_consumption_units} onChange={(e) => updateField('electrical', 'monthly_consumption_units', e.target.value)} placeholder="e.g., 500" className="h-11" data-testid="monthly-consumption-input" /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>EB Tariff (Rs/unit)</Label><Input type="number" step="0.1" value={formData.electrical.eb_tariff} onChange={(e) => updateField('electrical', 'eb_tariff', e.target.value)} placeholder="e.g., 7" className="h-11" data-testid="eb-tariff-input" /></div>
                  <div className="space-y-2"><Label>Cable Length (m)</Label><Input type="number" value={formData.additional.cable_length_meters} onChange={(e) => updateField('additional', 'cable_length_meters', e.target.value)} placeholder="50" className="h-11" data-testid="cable-length-input" /></div>
                </div>
                <div className="space-y-2"><Label>Complexity</Label>
                  <Select value={formData.additional.installation_complexity} onValueChange={(v) => updateField('additional', 'installation_complexity', v)}>
                    <SelectTrigger className="h-11" data-testid="complexity-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{COMPLEXITY_LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="p-4 bg-sky-50 rounded-lg border border-sky-200">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div><h3 className="font-semibold text-sky-800 flex items-center gap-2"><Sparkles className="h-4 w-4" />AI Recommendation</h3></div>
                    <Button type="button" onClick={getAIRecommendation} disabled={aiLoading || !formData.electrical.monthly_consumption_units} variant="outline" className="border-sky-300 text-sky-700 hover:bg-sky-100 h-10" data-testid="ai-recommendation-btn">
                      {aiLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}Advice
                    </Button>
                  </div>
                  {aiRecommendation && <div className="mt-3 p-3 bg-white rounded border border-sky-200"><pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{aiRecommendation}</pre></div>}
                </div>
              </div>
            )}

            {/* Step 4: Materials */}
            {currentStep === 4 && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>System Type</Label>
                    <Select value={formData.solar_system.system_type} onValueChange={(v) => updateField('solar_system', 'system_type', v)}>
                      <SelectTrigger className="h-11" data-testid="system-type-select"><SelectValue /></SelectTrigger>
                      <SelectContent>{SYSTEM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end pb-2">
                    <div className="flex items-center space-x-3">
                      <Checkbox id="batteryRequired" checked={formData.solar_system.battery_required} onCheckedChange={(c) => updateField('solar_system', 'battery_required', c)} data-testid="battery-checkbox" />
                      <Label htmlFor="batteryRequired">Battery Backup</Label>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Package className="h-4 w-4" />Select from Inventory</h3>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowAddCategory(true)} className="h-9 text-xs gap-1" data-testid="add-category-btn">
                      <FolderPlus className="h-3.5 w-3.5" />Add Category
                    </Button>
                  </div>

                  {showAddCategory && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg" data-testid="add-category-form">
                      <Label className="text-xs text-blue-800 mb-1 block">New Category Name</Label>
                      <div className="flex gap-2">
                        <Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="e.g., Surge Protectors" className="h-10 flex-1" data-testid="new-category-name-input" />
                        <Button type="button" size="sm" onClick={handleAddCategory} disabled={creatingCategory || !newCategoryName.trim()} className="h-10 bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-category-btn">
                          {creatingCategory ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create'}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => { setShowAddCategory(false); setNewCategoryName(''); }} className="h-10">Cancel</Button>
                      </div>
                    </div>
                  )}

                  {categories.map(cat => {
                    const catItems = getItemsByCategory(cat.slug);
                    if (catItems.length === 0) return null;
                    return (
                      <div key={cat.slug} className="mb-3">
                        <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">{cat.name}</Label>
                        <Select onValueChange={(v) => addSelectedItem(v)}>
                          <SelectTrigger className="h-11" data-testid={`select-${cat.slug}`}><SelectValue placeholder={`Add ${cat.name.toLowerCase()}...`} /></SelectTrigger>
                          <SelectContent>{catItems.map(item => (<SelectItem key={item.id} value={item.id}>{item.name} - Rs {item.unit_price.toLocaleString('en-IN')} (Stock: {item.quantity})</SelectItem>))}</SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>

                {formData.selected_items.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-2">Selected Items</h3>
                    <div className="space-y-2">
                      {formData.selected_items.map((item, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200" data-testid={`selected-item-${idx}`}>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm text-slate-900 truncate">{item.name}</p>
                              <p className="text-xs text-slate-500">{getCategoryLabel(item.category)} - Rs {item.unit_price.toLocaleString('en-IN')} x</p>
                            </div>
                            <Input type="number" min="1" value={item.quantity} onChange={(e) => updateSelectedItem(idx, 'quantity', parseInt(e.target.value) || 1)} className="w-16 h-9 text-center text-sm" data-testid={`item-qty-${idx}`} />
                            <span className="text-sm font-medium text-slate-900 w-24 text-right">Rs {(item.unit_price * item.quantity).toLocaleString('en-IN')}</span>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={() => removeSelectedItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                          {canSetMargin && (
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
                              <Percent className="h-3.5 w-3.5 text-amber-600" />
                              <span className="text-xs text-amber-700 font-medium">Margin</span>
                              <Input
                                type="number" min="0" max="100" step="0.5"
                                value={item.margin_percentage}
                                onChange={(e) => updateSelectedItem(idx, 'margin_percentage', parseFloat(e.target.value) || 0)}
                                className="w-20 h-7 text-xs text-center"
                                data-testid={`item-margin-${idx}`}
                              />
                              <span className="text-xs text-slate-500">%</span>
                              {item.margin_percentage > 0 && (
                                <span className="text-xs text-amber-600 ml-auto">+Rs {(item.unit_price * item.quantity * item.margin_percentage / 100).toLocaleString('en-IN')}</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-slate-900">Manual Costs</h3>
                    <Button type="button" variant="outline" size="sm" onClick={addManualCost} className="h-9" data-testid="add-manual-cost-btn"><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
                  </div>
                  {formData.manual_costs.map((cost, idx) => (
                    <div key={idx} className="flex gap-2 mb-2" data-testid={`manual-cost-${idx}`}>
                      <Input value={cost.description} onChange={(e) => updateManualCost(idx, 'description', e.target.value)} placeholder="e.g., Labor" className="flex-1 h-10" />
                      <Input type="number" min="0" value={cost.amount} onChange={(e) => updateManualCost(idx, 'amount', parseFloat(e.target.value) || 0)} placeholder="Amount" className="w-28 h-10" />
                      <Button variant="ghost" size="icon" className="text-red-500 shrink-0 h-10 w-10" onClick={() => removeManualCost(idx)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>

                <Card className="border-emerald-200 bg-emerald-50">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-slate-900 mb-2">Cost Summary</h3>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-slate-600">Items</span><span className="font-medium">Rs {totals.itemsTotal.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between"><span className="text-slate-600">Manual</span><span className="font-medium">Rs {totals.manualTotal.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between"><span className="text-slate-600">GST</span><span className="font-medium">Rs {totals.gstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
                      {canSetMargin && totals.marginTotal > 0 && (
                        <div className="flex justify-between text-amber-700"><span>Margin</span><span className="font-medium">Rs {totals.marginTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
                      )}
                      <div className="flex justify-between pt-2 border-t border-emerald-300"><span className="font-bold">Estimated Total</span><span className="font-bold text-emerald-700">Rs {totals.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Step 5: Site Images */}
            {currentStep === 5 && (
              <div className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm font-medium text-amber-800">Site images are mandatory. Upload at least one photo of the installation site.</p>
                </div>

                {!driveChecking && !driveConnected ? (
                  <div className="text-center py-8">
                    <CloudOff className="h-12 w-12 mx-auto mb-4 text-slate-400" />
                    <h3 className="font-semibold text-slate-900 mb-2">Connect Google Drive</h3>
                    <p className="text-sm text-slate-500 mb-4">Site images are stored in your Google Drive for safe keeping.</p>
                    <Button onClick={connectDrive} className="bg-blue-600 hover:bg-blue-700 text-white h-12 px-6" data-testid="connect-drive-btn">
                      <Cloud className="h-5 w-5 mr-2" />Connect Google Drive
                    </Button>
                  </div>
                ) : driveChecking ? (
                  <div className="text-center py-8"><Loader2 className="h-8 w-8 animate-spin mx-auto text-emerald-600" /><p className="text-sm text-slate-500 mt-2">Checking Drive connection...</p></div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                      <Cloud className="h-5 w-5 text-emerald-600" />
                      <span className="text-sm font-medium text-emerald-800">Google Drive Connected</span>
                    </div>
                    <label className="block cursor-pointer">
                      <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors">
                        {uploadingImage ? (
                          <><Loader2 className="h-10 w-10 animate-spin mx-auto text-emerald-600 mb-2" /><p className="text-sm text-slate-600">Uploading to Google Drive...</p></>
                        ) : (
                          <><Camera className="h-10 w-10 mx-auto text-slate-400 mb-2" /><p className="font-medium text-slate-700">Tap to upload site photos</p><p className="text-sm text-slate-500">Supports JPG, PNG (max 10MB each)</p></>
                        )}
                      </div>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} disabled={uploadingImage} data-testid="site-image-input" />
                    </label>
                    {formData.site_images.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {formData.site_images.map((img, idx) => (
                          <div key={idx} className="relative group rounded-xl overflow-hidden border border-slate-200 aspect-square bg-slate-100" data-testid={`site-image-${idx}`}>
                            <img src={img.image_url} alt={img.filename} className="w-full h-full object-cover" loading="lazy" />
                            <button onClick={() => removeImage(idx)} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1.5 opacity-80 hover:opacity-100 transition-opacity" data-testid={`remove-image-${idx}`}>
                              <X className="h-3.5 w-3.5" />
                            </button>
                            <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-1.5">
                              <p className="text-[10px] text-white truncate">{img.filename}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Shadow Analysis Notes (Optional)</Label>
                      <Textarea rows={2} value={formData.additional.shadow_analysis_notes} onChange={(e) => updateField('additional', 'shadow_analysis_notes', e.target.value)} placeholder="Observations about shadows, obstructions..." data-testid="shadow-notes-input" />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-6 pt-4 border-t border-slate-200 sticky bottom-0 bg-white pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6 sm:static sm:bg-transparent sm:pb-0">
              <Button type="button" variant="outline" onClick={prevStep} disabled={currentStep === 1} className="gap-2 h-12" data-testid="prev-step-btn">
                <ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Previous</span><span className="sm:hidden">Back</span>
              </Button>
              {currentStep < 5 ? (
                <Button type="button" onClick={nextStep} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-12" data-testid="next-step-btn">
                  Next <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button type="button" onClick={handleSubmit} disabled={loading || formData.site_images.length === 0} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-12" data-testid="submit-project-btn">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Creating...</> : <><CheckCircle2 className="h-4 w-4" />Create Project</>}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
