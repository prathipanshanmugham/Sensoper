import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectsAPI, aiAPI, inventoryAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Progress } from '../components/ui/progress';
import { 
  User, 
  MapPin, 
  Zap, 
  Sun,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Sparkles,
  Plus,
  Trash2,
  Package
} from 'lucide-react';

const STEPS = [
  { id: 1, title: 'Customer Info', icon: User },
  { id: 2, title: 'Location', icon: MapPin },
  { id: 3, title: 'Electrical', icon: Zap },
  { id: 4, title: 'Materials & Cost', icon: Package }
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

export default function SiteVisitForm() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [error, setError] = useState('');
  const [inventoryItems, setInventoryItems] = useState([]);

  const [categories, setCategories] = useState([]);
  const [formData, setFormData] = useState({
    customer: { name: '', phone: '', address: '', email: '' },
    location: { latitude: null, longitude: null, address: '', site_location_words: '' },
    electrical: { sanction_load_kw: '', connected_load_kw: '', monthly_consumption_units: '', eb_tariff: '' },
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
  }, []);

  const fetchInventory = async () => {
    try { const res = await inventoryAPI.getItems(); setInventoryItems(res.data); } catch (err) { console.error(err); }
  };
  const fetchCategories = async () => {
    try { const res = await inventoryAPI.getCategories(); setCategories(res.data); } catch (err) { console.error(err); }
  };

  const updateField = (section, field, value) => {
    setFormData(prev => ({
      ...prev,
      [section]: { ...prev[section], [field]: value }
    }));
  };

  const addSelectedItem = (itemId) => {
    const invItem = inventoryItems.find(i => i.id === itemId);
    if (!invItem) return;
    if (formData.selected_items.find(si => si.inventory_item_id === itemId)) return;

    setFormData(prev => ({
      ...prev,
      selected_items: [...prev.selected_items, {
        inventory_item_id: invItem.id,
        name: invItem.name,
        category: invItem.category,
        unit_price: invItem.unit_price,
        gst_percentage: invItem.gst_percentage,
        quantity: 1
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
    setFormData(prev => ({
      ...prev,
      selected_items: prev.selected_items.filter((_, i) => i !== index)
    }));
  };

  const addManualCost = () => {
    setFormData(prev => ({
      ...prev,
      manual_costs: [...prev.manual_costs, { description: '', amount: 0 }]
    }));
  };

  const updateManualCost = (index, field, value) => {
    setFormData(prev => {
      const costs = [...prev.manual_costs];
      costs[index] = { ...costs[index], [field]: value };
      return { ...prev, manual_costs: costs };
    });
  };

  const removeManualCost = (index) => {
    setFormData(prev => ({
      ...prev,
      manual_costs: prev.manual_costs.filter((_, i) => i !== index)
    }));
  };

  const getAIRecommendation = async () => {
    setAiLoading(true);
    try {
      const res = await aiAPI.getRecommendations({
        monthly_consumption_units: parseFloat(formData.electrical.monthly_consumption_units) || 0,
        sanction_load_kw: parseFloat(formData.electrical.sanction_load_kw) || 0,
        roof_type: formData.mounting.roof_type,
        budget_range: null
      });
      setAiRecommendation(res.data.recommendation);
    } catch (err) {
      setError('Failed to get AI recommendation');
    } finally {
      setAiLoading(false);
    }
  };

  const getItemsByCategory = (cat) => inventoryItems.filter(i => i.category === cat && i.quantity > 0);
  const getCategoryLabel = (slug) => categories.find(c => c.slug === slug)?.name || slug;

  const calculateTotal = () => {
    const itemsTotal = formData.selected_items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    const manualTotal = formData.manual_costs.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
    const gstTotal = formData.selected_items.reduce((sum, i) => sum + i.unit_price * i.quantity * (i.gst_percentage / 100), 0);
    return { itemsTotal, manualTotal, gstTotal, total: itemsTotal + manualTotal + gstTotal };
  };

  const validateStep = () => {
    switch (currentStep) {
      case 1:
        if (!formData.customer.name || !formData.customer.phone || !formData.customer.address) {
          setError('Please fill in all required customer fields');
          return false;
        }
        break;
      case 2:
        if (!formData.location.site_location_words && !formData.location.address) {
          setError('Please enter a What3Words address or site address');
          return false;
        }
        break;
      case 3:
        if (!formData.electrical.sanction_load_kw || !formData.electrical.monthly_consumption_units) {
          setError('Please fill in the required electrical details');
          return false;
        }
        break;
      case 4:
        if (formData.selected_items.length === 0) {
          setError('Please add at least one item from inventory');
          return false;
        }
        break;
      default:
        break;
    }
    setError('');
    return true;
  };

  const nextStep = () => {
    if (validateStep()) setCurrentStep(prev => Math.min(prev + 1, 4));
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
    setError('');
  };

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
          address: formData.location.address,
          site_location_words: formData.location.site_location_words
        },
        electrical: {
          sanction_load_kw: parseFloat(formData.electrical.sanction_load_kw),
          connected_load_kw: parseFloat(formData.electrical.connected_load_kw) || 0,
          monthly_consumption_units: parseFloat(formData.electrical.monthly_consumption_units),
          eb_tariff: parseFloat(formData.electrical.eb_tariff) || 0
        },
        solar_system: {
          ...formData.solar_system,
          panel_wattage: parseInt(formData.solar_system.panel_wattage) || 540,
          battery_capacity_ah: formData.solar_system.battery_required 
            ? parseInt(formData.solar_system.battery_capacity_ah) || 0 : null
        },
        mounting: { ...formData.mounting, tilt_angle: parseInt(formData.mounting.tilt_angle) },
        additional: {
          ...formData.additional,
          cable_length_meters: parseFloat(formData.additional.cable_length_meters),
          inverter_to_panel_distance: parseFloat(formData.additional.inverter_to_panel_distance)
        },
        selected_items: formData.selected_items.map(si => ({
          inventory_item_id: si.inventory_item_id,
          name: si.name,
          category: si.category,
          unit_price: si.unit_price,
          gst_percentage: si.gst_percentage,
          quantity: parseInt(si.quantity) || 1
        })),
        manual_costs: formData.manual_costs.filter(c => c.description && c.amount > 0).map(c => ({
          description: c.description,
          amount: parseFloat(c.amount) || 0
        })),
        site_images: formData.site_images
      };

      const res = await projectsAPI.create(payload);
      navigate(`/dashboard/projects/${res.data.id}`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const progress = (currentStep / 4) * 100;
  const totals = calculateTotal();

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold font-['Outfit'] text-slate-900 mb-2">New Site Visit</h1>
          <p className="text-slate-500">Collect site data to generate an accurate solar project estimate</p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <Progress value={progress} className="h-2 mb-4" />
          <div className="flex justify-between">
            {STEPS.map((step) => (
              <div key={step.id} className={`flex flex-col items-center ${currentStep >= step.id ? 'text-emerald-600' : 'text-slate-400'}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                  currentStep > step.id ? 'bg-emerald-600 text-white' 
                    : currentStep === step.id ? 'bg-emerald-100 text-emerald-600 border-2 border-emerald-600' 
                    : 'bg-slate-100 text-slate-400'
                }`}>
                  {currentStep > step.id ? <CheckCircle2 className="h-5 w-5" /> : <step.icon className="h-5 w-5" />}
                </div>
                <span className="text-xs font-medium hidden sm:block">{step.title}</span>
              </div>
            ))}
          </div>
        </div>

        <Card className="border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200">
            <CardTitle className="font-['Outfit'] text-xl">{STEPS[currentStep - 1].title}</CardTitle>
            <CardDescription>
              {currentStep === 1 && 'Enter the customer details'}
              {currentStep === 2 && 'Capture the site location'}
              {currentStep === 3 && 'Enter electrical load information'}
              {currentStep === 4 && 'Select materials from inventory & add costs'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            {error && (
              <div className="mb-6 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="form-error">{error}</div>
            )}

            {/* Step 1: Customer */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Customer Name *</Label>
                    <Input value={formData.customer.name} onChange={(e) => updateField('customer', 'name', e.target.value)} placeholder="Enter customer name" className="h-11" data-testid="customer-name-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone Number *</Label>
                    <Input type="tel" value={formData.customer.phone} onChange={(e) => updateField('customer', 'phone', e.target.value)} placeholder="Enter phone number" className="h-11" data-testid="customer-phone-input" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Email (Optional)</Label>
                  <Input type="email" value={formData.customer.email} onChange={(e) => updateField('customer', 'email', e.target.value)} placeholder="Enter email address" data-testid="customer-email-input" />
                </div>
                <div className="space-y-2">
                  <Label>Address *</Label>
                  <Textarea rows={3} value={formData.customer.address} onChange={(e) => updateField('customer', 'address', e.target.value)} placeholder="Enter full address" data-testid="customer-address-input" />
                </div>
              </div>
            )}

            {/* Step 2: Location */}
            {currentStep === 2 && (
              <div className="space-y-4">
                {/* What3Words */}
                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                  <h3 className="font-semibold text-emerald-800 mb-1">What3Words Address</h3>
                  <p className="text-sm text-emerald-600 mb-3">Enter the 3-word location (e.g., apple.orange.table)</p>
                  <Input 
                    value={formData.location.site_location_words} 
                    onChange={(e) => updateField('location', 'site_location_words', e.target.value)} 
                    placeholder="word.word.word" 
                    data-testid="what3words-input"
                    className="font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Site Address</Label>
                  <Textarea rows={2} value={formData.location.address} onChange={(e) => updateField('location', 'address', e.target.value)} placeholder="Enter site location description" data-testid="location-address-input" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Roof Type</Label>
                    <Input value={formData.mounting.roof_type} onChange={(e) => updateField('mounting', 'roof_type', e.target.value)} placeholder="e.g., RCC Flat Roof, Metal Sheet, Terrace with slope" className="h-11" data-testid="roof-type-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>Tilt Angle (degrees)</Label>
                    <Input type="number" min="0" max="90" value={formData.mounting.tilt_angle} onChange={(e) => updateField('mounting', 'tilt_angle', e.target.value)} data-testid="tilt-angle-input" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Structure Type</Label>
                  <Input value={formData.mounting.structure_type} onChange={(e) => updateField('mounting', 'structure_type', e.target.value)} placeholder="e.g., Galvanized Iron" data-testid="structure-type-input" />
                </div>
              </div>
            )}

            {/* Step 3: Electrical */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Sanction Load (kW) *</Label>
                    <Input type="number" step="0.1" value={formData.electrical.sanction_load_kw} onChange={(e) => updateField('electrical', 'sanction_load_kw', e.target.value)} placeholder="e.g., 5" data-testid="sanction-load-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>Connected Load (kW)</Label>
                    <Input type="number" step="0.1" value={formData.electrical.connected_load_kw} onChange={(e) => updateField('electrical', 'connected_load_kw', e.target.value)} placeholder="e.g., 4" data-testid="connected-load-input" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Monthly Consumption (units) *</Label>
                    <Input type="number" value={formData.electrical.monthly_consumption_units} onChange={(e) => updateField('electrical', 'monthly_consumption_units', e.target.value)} placeholder="e.g., 500" data-testid="monthly-consumption-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>EB Tariff (Rs/unit)</Label>
                    <Input type="number" step="0.1" value={formData.electrical.eb_tariff} onChange={(e) => updateField('electrical', 'eb_tariff', e.target.value)} placeholder="e.g., 7" data-testid="eb-tariff-input" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Cable Length (meters)</Label>
                    <Input type="number" value={formData.additional.cable_length_meters} onChange={(e) => updateField('additional', 'cable_length_meters', e.target.value)} placeholder="50" data-testid="cable-length-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>Installation Complexity</Label>
                    <Select value={formData.additional.installation_complexity} onValueChange={(v) => updateField('additional', 'installation_complexity', v)}>
                      <SelectTrigger data-testid="complexity-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMPLEXITY_LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="p-4 bg-sky-50 rounded-lg border border-sky-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sky-800 flex items-center gap-2"><Sparkles className="h-4 w-4" />AI Recommendation</h3>
                      <p className="text-sm text-sky-600">Get personalized solar system advice</p>
                    </div>
                    <Button type="button" onClick={getAIRecommendation} disabled={aiLoading || !formData.electrical.monthly_consumption_units} variant="outline" className="border-sky-300 text-sky-700 hover:bg-sky-100" data-testid="ai-recommendation-btn">
                      {aiLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      Get Advice
                    </Button>
                  </div>
                  {aiRecommendation && (
                    <div className="mt-4 p-3 bg-white rounded border border-sky-200">
                      <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{aiRecommendation}</pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 4: Materials & Cost */}
            {currentStep === 4 && (
              <div className="space-y-6">
                {/* System Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>System Type</Label>
                    <Select value={formData.solar_system.system_type} onValueChange={(v) => updateField('solar_system', 'system_type', v)}>
                      <SelectTrigger data-testid="system-type-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SYSTEM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <div className="flex items-center space-x-3">
                      <Checkbox id="batteryRequired" checked={formData.solar_system.battery_required} onCheckedChange={(c) => updateField('solar_system', 'battery_required', c)} data-testid="battery-checkbox" />
                      <Label htmlFor="batteryRequired">Battery Backup Required</Label>
                    </div>
                  </div>
                </div>

                {/* Inventory Item Selection */}
                <div>
                  <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2"><Package className="h-4 w-4" /> Select Items from Inventory</h3>
                  {categories.map(cat => {
                    const catItems = getItemsByCategory(cat.slug);
                    if (catItems.length === 0) return null;
                    return (
                      <div key={cat.slug} className="mb-3">
                        <Label className="text-xs uppercase tracking-wider text-slate-500 mb-1 block">{cat.name}</Label>
                        <Select onValueChange={(v) => addSelectedItem(v)}>
                          <SelectTrigger className="h-11" data-testid={`select-${cat.slug}`}>
                            <SelectValue placeholder={`Add ${cat.name.toLowerCase()}...`} />
                          </SelectTrigger>
                          <SelectContent>
                            {catItems.map(item => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.name} - Rs {item.unit_price.toLocaleString('en-IN')} (Stock: {item.quantity})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>

                {/* Selected Items List */}
                {formData.selected_items.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-2">Selected Items</h3>
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="text-left py-2 px-3 font-medium text-slate-600">Item</th>
                            <th className="text-right py-2 px-3 font-medium text-slate-600 w-20">Qty</th>
                            <th className="text-right py-2 px-3 font-medium text-slate-600 w-28">Unit Price</th>
                            <th className="text-right py-2 px-3 font-medium text-slate-600 w-20">GST%</th>
                            <th className="text-right py-2 px-3 font-medium text-slate-600 w-28">Amount</th>
                            <th className="w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {formData.selected_items.map((item, idx) => (
                            <tr key={idx} className="border-t border-slate-100" data-testid={`selected-item-${idx}`}>
                              <td className="py-2 px-3">
                                <div className="font-medium text-slate-900">{item.name}</div>
                                <div className="text-xs text-slate-500">{getCategoryLabel(item.category)}</div>
                              </td>
                              <td className="py-2 px-3">
                                <Input type="number" min="1" value={item.quantity} onChange={(e) => updateSelectedItem(idx, 'quantity', parseInt(e.target.value) || 1)} className="w-16 h-8 text-right text-sm" data-testid={`item-qty-${idx}`} />
                              </td>
                              <td className="py-2 px-3 text-right text-slate-700">Rs {item.unit_price.toLocaleString('en-IN')}</td>
                              <td className="py-2 px-3 text-right text-slate-500">{item.gst_percentage}%</td>
                              <td className="py-2 px-3 text-right font-medium text-slate-900">Rs {(item.unit_price * item.quantity).toLocaleString('en-IN')}</td>
                              <td className="py-2 px-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeSelectedItem(idx)} data-testid={`remove-item-${idx}`}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Manual Costs */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-slate-900">Manual Costs (Labor, Transport, etc.)</h3>
                    <Button type="button" variant="outline" size="sm" onClick={addManualCost} data-testid="add-manual-cost-btn">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Cost
                    </Button>
                  </div>
                  {formData.manual_costs.map((cost, idx) => (
                    <div key={idx} className="flex gap-3 mb-2" data-testid={`manual-cost-${idx}`}>
                      <Input value={cost.description} onChange={(e) => updateManualCost(idx, 'description', e.target.value)} placeholder="e.g., Installation Labor" className="flex-1" />
                      <Input type="number" min="0" value={cost.amount} onChange={(e) => updateManualCost(idx, 'amount', parseFloat(e.target.value) || 0)} placeholder="Amount" className="w-32" />
                      <Button variant="ghost" size="icon" className="text-red-500 shrink-0" onClick={() => removeManualCost(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                {/* Cost Summary */}
                <Card className="border-emerald-200 bg-emerald-50">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-slate-900 mb-2">Cost Summary</h3>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-slate-600">Items Subtotal</span><span className="font-medium">Rs {totals.itemsTotal.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between"><span className="text-slate-600">Manual Costs</span><span className="font-medium">Rs {totals.manualTotal.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between"><span className="text-slate-600">GST</span><span className="font-medium">Rs {totals.gstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
                      <div className="flex justify-between pt-2 border-t border-emerald-300 text-base">
                        <span className="font-bold text-slate-900">Estimated Total</span>
                        <span className="font-bold text-emerald-700">Rs {totals.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">* Final cost may include internal margin</p>
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  <Label>Shadow Analysis Notes (Optional)</Label>
                  <Textarea rows={2} value={formData.additional.shadow_analysis_notes} onChange={(e) => updateField('additional', 'shadow_analysis_notes', e.target.value)} placeholder="Any observations about shadows, obstructions, etc." data-testid="shadow-notes-input" />
                </div>
              </div>
            )}

            {/* Navigation — Sticky on mobile */}
            <div className="flex justify-between mt-8 pt-6 border-t border-slate-200 sticky bottom-0 bg-white pb-4 -mx-6 px-6 sm:static sm:bg-transparent sm:pb-0">
              <Button type="button" variant="outline" onClick={prevStep} disabled={currentStep === 1} className="gap-2 h-12" data-testid="prev-step-btn">
                <ArrowLeft className="h-4 w-4" /> Previous
              </Button>
              {currentStep < 4 ? (
                <Button type="button" onClick={nextStep} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-12" data-testid="next-step-btn">
                  Next <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button type="button" onClick={handleSubmit} disabled={loading} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-12" data-testid="submit-project-btn">
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
