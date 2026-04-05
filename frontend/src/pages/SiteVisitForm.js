import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectsAPI, aiAPI } from '../utils/api';
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
  Navigation
} from 'lucide-react';

const STEPS = [
  { id: 1, title: 'Customer Info', icon: User },
  { id: 2, title: 'Location', icon: MapPin },
  { id: 3, title: 'Electrical', icon: Zap },
  { id: 4, title: 'Solar System', icon: Sun }
];

const SYSTEM_TYPES = [
  { value: 'on-grid', label: 'On-Grid (Grid-Tied)' },
  { value: 'off-grid', label: 'Off-Grid (Standalone)' },
  { value: 'hybrid', label: 'Hybrid' }
];

const ROOF_TYPES = [
  { value: 'rcc', label: 'RCC (Concrete)' },
  { value: 'metal', label: 'Metal Sheet' },
  { value: 'ground', label: 'Ground Mount' }
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
  const [gettingLocation, setGettingLocation] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    // Customer Details
    customer: {
      name: '',
      phone: '',
      address: '',
      email: ''
    },
    // Location
    location: {
      latitude: 0,
      longitude: 0,
      address: ''
    },
    // Electrical Details
    electrical: {
      sanction_load_kw: '',
      connected_load_kw: '',
      monthly_consumption_units: '',
      eb_tariff: ''
    },
    // Solar System
    solar_system: {
      system_type: 'on-grid',
      inverter_model: '',
      panel_wattage: 540,
      battery_required: false,
      battery_capacity_ah: ''
    },
    // Mounting
    mounting: {
      roof_type: 'rcc',
      tilt_angle: 15,
      structure_type: 'Standard'
    },
    // Additional
    additional: {
      cable_length_meters: 50,
      inverter_to_panel_distance: 10,
      installation_complexity: 'simple',
      shadow_analysis_notes: ''
    },
    site_images: []
  });

  const updateField = (section, field, value) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }));
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateField('location', 'latitude', position.coords.latitude);
        updateField('location', 'longitude', position.coords.longitude);
        setGettingLocation(false);
      },
      (err) => {
        setError('Unable to retrieve your location');
        setGettingLocation(false);
      },
      { enableHighAccuracy: true }
    );
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

  const validateStep = () => {
    switch (currentStep) {
      case 1:
        if (!formData.customer.name || !formData.customer.phone || !formData.customer.address) {
          setError('Please fill in all required customer fields');
          return false;
        }
        break;
      case 2:
        if (!formData.location.latitude || !formData.location.longitude) {
          setError('Please capture the GPS location');
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
        if (!formData.solar_system.inverter_model) {
          setError('Please enter the inverter model');
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
    if (validateStep()) {
      setCurrentStep(prev => Math.min(prev + 1, 4));
    }
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
          ...formData.location,
          latitude: parseFloat(formData.location.latitude),
          longitude: parseFloat(formData.location.longitude)
        },
        electrical: {
          sanction_load_kw: parseFloat(formData.electrical.sanction_load_kw),
          connected_load_kw: parseFloat(formData.electrical.connected_load_kw) || 0,
          monthly_consumption_units: parseFloat(formData.electrical.monthly_consumption_units),
          eb_tariff: parseFloat(formData.electrical.eb_tariff) || 0
        },
        solar_system: {
          ...formData.solar_system,
          panel_wattage: parseInt(formData.solar_system.panel_wattage),
          battery_capacity_ah: formData.solar_system.battery_required 
            ? parseInt(formData.solar_system.battery_capacity_ah) || 0 
            : null
        },
        mounting: {
          ...formData.mounting,
          tilt_angle: parseInt(formData.mounting.tilt_angle)
        },
        additional: {
          ...formData.additional,
          cable_length_meters: parseFloat(formData.additional.cable_length_meters),
          inverter_to_panel_distance: parseFloat(formData.additional.inverter_to_panel_distance)
        },
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

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold font-['Outfit'] text-slate-900 mb-2">
            New Site Visit
          </h1>
          <p className="text-slate-500">
            Collect site data to generate an accurate solar project estimate
          </p>
        </div>

        {/* Progress Steps */}
        <div className="mb-8">
          <Progress value={progress} className="h-2 mb-4" />
          <div className="flex justify-between">
            {STEPS.map((step) => (
              <div 
                key={step.id}
                className={`flex flex-col items-center ${currentStep >= step.id ? 'text-[#4ADE40]' : 'text-slate-400'}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                  currentStep > step.id 
                    ? 'bg-emerald-600 text-white' 
                    : currentStep === step.id 
                      ? 'bg-emerald-100 text-[#4ADE40] border-2 border-emerald-600' 
                      : 'bg-slate-100 text-slate-400'
                }`}>
                  {currentStep > step.id ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <step.icon className="h-5 w-5" />
                  )}
                </div>
                <span className="text-xs font-medium hidden sm:block">{step.title}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Form Card */}
        <Card className="border-slate-200 shadow-lg">
          <CardHeader className="border-b border-slate-200">
            <CardTitle className="font-['Outfit'] text-xl">
              {STEPS[currentStep - 1].title}
            </CardTitle>
            <CardDescription>
              {currentStep === 1 && 'Enter the customer details'}
              {currentStep === 2 && 'Capture the site location'}
              {currentStep === 3 && 'Enter electrical load information'}
              {currentStep === 4 && 'Configure the solar system'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            {error && (
              <div className="mb-6 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="form-error">
                {error}
              </div>
            )}

            {/* Step 1: Customer Details */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="customerName">Customer Name *</Label>
                    <Input
                      id="customerName"
                      placeholder="Enter customer name"
                      value={formData.customer.name}
                      onChange={(e) => updateField('customer', 'name', e.target.value)}
                      data-testid="customer-name-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="customerPhone">Phone Number *</Label>
                    <Input
                      id="customerPhone"
                      type="tel"
                      placeholder="Enter phone number"
                      value={formData.customer.phone}
                      onChange={(e) => updateField('customer', 'phone', e.target.value)}
                      data-testid="customer-phone-input"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customerEmail">Email (Optional)</Label>
                  <Input
                    id="customerEmail"
                    type="email"
                    placeholder="Enter email address"
                    value={formData.customer.email}
                    onChange={(e) => updateField('customer', 'email', e.target.value)}
                    data-testid="customer-email-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customerAddress">Address *</Label>
                  <Textarea
                    id="customerAddress"
                    placeholder="Enter full address"
                    rows={3}
                    value={formData.customer.address}
                    onChange={(e) => updateField('customer', 'address', e.target.value)}
                    data-testid="customer-address-input"
                  />
                </div>
              </div>
            )}

            {/* Step 2: Location */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-emerald-800">GPS Coordinates</h3>
                      <p className="text-sm text-[#4ADE40]">Click to capture current location</p>
                    </div>
                    <Button 
                      type="button"
                      onClick={getCurrentLocation}
                      disabled={gettingLocation}
                      className="bg-[#4ADE40] hover:bg-[#3dba35] text-black"
                      data-testid="get-location-btn"
                    >
                      {gettingLocation ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Navigation className="h-4 w-4 mr-2" />
                      )}
                      {gettingLocation ? 'Getting...' : 'Get Location'}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="latitude">Latitude</Label>
                      <Input
                        id="latitude"
                        type="number"
                        step="0.000001"
                        placeholder="0.000000"
                        value={formData.location.latitude}
                        onChange={(e) => updateField('location', 'latitude', e.target.value)}
                        data-testid="latitude-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="longitude">Longitude</Label>
                      <Input
                        id="longitude"
                        type="number"
                        step="0.000001"
                        placeholder="0.000000"
                        value={formData.location.longitude}
                        onChange={(e) => updateField('location', 'longitude', e.target.value)}
                        data-testid="longitude-input"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locationAddress">Site Address (Optional)</Label>
                  <Textarea
                    id="locationAddress"
                    placeholder="Enter site location description"
                    rows={2}
                    value={formData.location.address}
                    onChange={(e) => updateField('location', 'address', e.target.value)}
                    data-testid="location-address-input"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="roofType">Roof Type</Label>
                    <Select 
                      value={formData.mounting.roof_type} 
                      onValueChange={(v) => updateField('mounting', 'roof_type', v)}
                    >
                      <SelectTrigger data-testid="roof-type-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROOF_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tiltAngle">Tilt Angle (degrees)</Label>
                    <Input
                      id="tiltAngle"
                      type="number"
                      min="0"
                      max="90"
                      value={formData.mounting.tilt_angle}
                      onChange={(e) => updateField('mounting', 'tilt_angle', e.target.value)}
                      data-testid="tilt-angle-input"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Electrical Details */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sanctionLoad">Sanction Load (kW) *</Label>
                    <Input
                      id="sanctionLoad"
                      type="number"
                      step="0.1"
                      placeholder="e.g., 5"
                      value={formData.electrical.sanction_load_kw}
                      onChange={(e) => updateField('electrical', 'sanction_load_kw', e.target.value)}
                      data-testid="sanction-load-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="connectedLoad">Connected Load (kW)</Label>
                    <Input
                      id="connectedLoad"
                      type="number"
                      step="0.1"
                      placeholder="e.g., 4"
                      value={formData.electrical.connected_load_kw}
                      onChange={(e) => updateField('electrical', 'connected_load_kw', e.target.value)}
                      data-testid="connected-load-input"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="monthlyConsumption">Monthly Consumption (units) *</Label>
                    <Input
                      id="monthlyConsumption"
                      type="number"
                      placeholder="e.g., 500"
                      value={formData.electrical.monthly_consumption_units}
                      onChange={(e) => updateField('electrical', 'monthly_consumption_units', e.target.value)}
                      data-testid="monthly-consumption-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ebTariff">EB Tariff (₹/unit)</Label>
                    <Input
                      id="ebTariff"
                      type="number"
                      step="0.1"
                      placeholder="e.g., 7"
                      value={formData.electrical.eb_tariff}
                      onChange={(e) => updateField('electrical', 'eb_tariff', e.target.value)}
                      data-testid="eb-tariff-input"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cableLength">Cable Length (meters)</Label>
                    <Input
                      id="cableLength"
                      type="number"
                      placeholder="50"
                      value={formData.additional.cable_length_meters}
                      onChange={(e) => updateField('additional', 'cable_length_meters', e.target.value)}
                      data-testid="cable-length-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="complexity">Installation Complexity</Label>
                    <Select 
                      value={formData.additional.installation_complexity} 
                      onValueChange={(v) => updateField('additional', 'installation_complexity', v)}
                    >
                      <SelectTrigger data-testid="complexity-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPLEXITY_LEVELS.map((level) => (
                          <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* AI Recommendation Button */}
                <div className="p-4 bg-sky-50 rounded-lg border border-sky-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sky-800 flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        AI Recommendation
                      </h3>
                      <p className="text-sm text-sky-600">Get personalized solar system advice</p>
                    </div>
                    <Button 
                      type="button"
                      onClick={getAIRecommendation}
                      disabled={aiLoading || !formData.electrical.monthly_consumption_units}
                      variant="outline"
                      className="border-sky-300 text-sky-700 hover:bg-sky-100"
                      data-testid="ai-recommendation-btn"
                    >
                      {aiLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Get Advice
                    </Button>
                  </div>
                  {aiRecommendation && (
                    <div className="mt-4 p-3 bg-white rounded border border-sky-200">
                      <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">
                        {aiRecommendation}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 4: Solar System */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="systemType">System Type</Label>
                    <Select 
                      value={formData.solar_system.system_type} 
                      onValueChange={(v) => updateField('solar_system', 'system_type', v)}
                    >
                      <SelectTrigger data-testid="system-type-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SYSTEM_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inverterModel">Inverter Model *</Label>
                    <Input
                      id="inverterModel"
                      placeholder="e.g., Growatt 5kW"
                      value={formData.solar_system.inverter_model}
                      onChange={(e) => updateField('solar_system', 'inverter_model', e.target.value)}
                      data-testid="inverter-model-input"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="panelWattage">Panel Wattage (W)</Label>
                    <Select 
                      value={String(formData.solar_system.panel_wattage)} 
                      onValueChange={(v) => updateField('solar_system', 'panel_wattage', parseInt(v))}
                    >
                      <SelectTrigger data-testid="panel-wattage-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="330">330W</SelectItem>
                        <SelectItem value="400">400W</SelectItem>
                        <SelectItem value="440">440W</SelectItem>
                        <SelectItem value="540">540W</SelectItem>
                        <SelectItem value="550">550W</SelectItem>
                        <SelectItem value="600">600W</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="structureType">Structure Type</Label>
                    <Input
                      id="structureType"
                      placeholder="e.g., Galvanized Iron"
                      value={formData.mounting.structure_type}
                      onChange={(e) => updateField('mounting', 'structure_type', e.target.value)}
                      data-testid="structure-type-input"
                    />
                  </div>
                </div>

                {/* Battery section */}
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center space-x-3 mb-4">
                    <Checkbox
                      id="batteryRequired"
                      checked={formData.solar_system.battery_required}
                      onCheckedChange={(checked) => updateField('solar_system', 'battery_required', checked)}
                      data-testid="battery-checkbox"
                    />
                    <Label htmlFor="batteryRequired" className="font-medium">
                      Battery Backup Required
                    </Label>
                  </div>
                  {formData.solar_system.battery_required && (
                    <div className="space-y-2">
                      <Label htmlFor="batteryCapacity">Battery Capacity (Ah)</Label>
                      <Input
                        id="batteryCapacity"
                        type="number"
                        placeholder="e.g., 150"
                        value={formData.solar_system.battery_capacity_ah}
                        onChange={(e) => updateField('solar_system', 'battery_capacity_ah', e.target.value)}
                        data-testid="battery-capacity-input"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="shadowNotes">Shadow Analysis Notes (Optional)</Label>
                  <Textarea
                    id="shadowNotes"
                    placeholder="Any observations about shadows, obstructions, etc."
                    rows={3}
                    value={formData.additional.shadow_analysis_notes}
                    onChange={(e) => updateField('additional', 'shadow_analysis_notes', e.target.value)}
                    data-testid="shadow-notes-input"
                  />
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
              <Button
                type="button"
                variant="outline"
                onClick={prevStep}
                disabled={currentStep === 1}
                className="gap-2"
                data-testid="prev-step-btn"
              >
                <ArrowLeft className="h-4 w-4" />
                Previous
              </Button>

              {currentStep < 4 ? (
                <Button
                  type="button"
                  onClick={nextStep}
                  className="gap-2 bg-[#4ADE40] hover:bg-[#3dba35] text-black"
                  data-testid="next-step-btn"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  className="gap-2 bg-[#4ADE40] hover:bg-[#3dba35] text-black"
                  data-testid="submit-project-btn"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Create Project
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
