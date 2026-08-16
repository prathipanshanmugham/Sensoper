import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { thresholdsAPI as pricingAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import AdvancedConfigSection from '../components/AdvancedConfigSection';
import { 
  ArrowLeft,
  Save,
  Loader2,
  IndianRupee,
  Settings,
  RefreshCw
} from 'lucide-react';

const defaultPricing = {
  panel_price_per_watt: 25,
  inverter_price_per_kw: 8000,
  structure_price_per_kw: 5000,
  wiring_price_per_meter: 50,
  labor_price_per_kw: 3000,
  transportation_base: 5000,
  margin_percentage: 15,
  gst_percentage: 13.8,
  battery_price_per_ah: 150
};

const pricingFields = [
  { key: 'panel_price_per_watt', label: 'Panel Price (per Watt)', unit: '₹/W', step: 0.5 },
  { key: 'inverter_price_per_kw', label: 'Inverter Price (per kW)', unit: '₹/kW', step: 100 },
  { key: 'structure_price_per_kw', label: 'Structure Price (per kW)', unit: '₹/kW', step: 100 },
  { key: 'wiring_price_per_meter', label: 'Wiring Price (per meter)', unit: '₹/m', step: 5 },
  { key: 'labor_price_per_kw', label: 'Labor Cost (per kW)', unit: '₹/kW', step: 100 },
  { key: 'transportation_base', label: 'Transportation (base)', unit: '₹', step: 500 },
  { key: 'battery_price_per_ah', label: 'Battery Price (per Ah)', unit: '₹/Ah', step: 10 },
  { key: 'margin_percentage', label: 'Profit Margin', unit: '%', step: 0.5 },
  { key: 'gst_percentage', label: 'GST Rate', unit: '%', step: 0.1 }
];

export default function PricingConfig() {
  const [pricing, setPricing] = useState(defaultPricing);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchPricing = useCallback(async () => {
    try {
      const res = await pricingAPI.get();
      // Merge into defaults so partial API responses (or unrelated threshold shape) don't crash the UI
      setPricing(prev => ({ ...defaultPricing, ...prev, ...(res.data || {}) }));
    } catch (error) {
      console.error('Failed to fetch pricing:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPricing();
  }, [fetchPricing]);

  const handleChange = (key, value) => {
    setPricing(prev => ({
      ...prev,
      [key]: parseFloat(value) || 0
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await pricingAPI.update(pricing);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save pricing:', error);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    setPricing(defaultPricing);
    setSaved(false);
  };

  // Sample calculation preview
  const sampleCapacity = 5; // 5kW system
  const panelsNeeded = Math.ceil((sampleCapacity * 1000) / 540);
  const sampleCost = {
    panels: panelsNeeded * 540 * pricing.panel_price_per_watt,
    inverter: sampleCapacity * pricing.inverter_price_per_kw,
    structure: sampleCapacity * pricing.structure_price_per_kw,
    wiring: 50 * pricing.wiring_price_per_meter,
    labor: sampleCapacity * pricing.labor_price_per_kw,
    transport: pricing.transportation_base
  };
  const subtotal = Object.values(sampleCost).reduce((a, b) => a + b, 0);
  const margin = subtotal * (pricing.margin_percentage / 100);
  const gst = (subtotal + margin) * (pricing.gst_percentage / 100);
  const total = subtotal + margin + gst;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">Pricing Configuration</h1>
              <p className="text-slate-500">Configure cost estimation parameters</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline"
              onClick={resetToDefaults}
              className="gap-2"
              data-testid="reset-pricing-btn"
            >
              <RefreshCw className="h-4 w-4" />
              Reset
            </Button>
            <Button 
              onClick={handleSave}
              disabled={saving}
              className="gap-2 bg-[#4ADE40] hover:bg-[#3dba35] text-black"
              data-testid="save-pricing-btn"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <span className="text-green-200">Saved!</span>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#4ADE40]" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Pricing Fields */}
            <div className="lg:col-span-2">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2">
                    <Settings className="h-5 w-5 text-[#4ADE40]" />
                    Pricing Parameters
                  </CardTitle>
                  <CardDescription>
                    Adjust the base prices used in cost calculations
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {pricingFields.map((field) => (
                      <div key={field.key} className="space-y-2">
                        <Label htmlFor={field.key} className="text-slate-700">
                          {field.label}
                        </Label>
                        <div className="relative">
                          <Input
                            id={field.key}
                            type="number"
                            step={field.step}
                            min="0"
                            value={pricing[field.key]}
                            onChange={(e) => handleChange(field.key, e.target.value)}
                            className="pr-16"
                            data-testid={`pricing-${field.key}`}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                            {field.unit}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Preview */}
            <div>
              <Card className="border-slate-200 sticky top-6">
                <CardHeader>
                  <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2">
                    <IndianRupee className="h-5 w-5 text-[#4ADE40]" />
                    Sample Estimate
                  </CardTitle>
                  <CardDescription>
                    Preview for a 5 kW system
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Panels ({panelsNeeded}x540W)</span>
                      <span className="font-medium">₹{sampleCost.panels.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Inverter (5kW)</span>
                      <span className="font-medium">₹{sampleCost.inverter.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Structure</span>
                      <span className="font-medium">₹{sampleCost.structure.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Wiring (50m)</span>
                      <span className="font-medium">₹{sampleCost.wiring.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Labor</span>
                      <span className="font-medium">₹{sampleCost.labor.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Transport</span>
                      <span className="font-medium">₹{sampleCost.transport.toLocaleString('en-IN')}</span>
                    </div>
                    
                    <div className="border-t border-slate-200 my-2" />
                    
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Subtotal</span>
                      <span className="font-medium">₹{subtotal.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Margin ({pricing.margin_percentage}%)</span>
                      <span className="font-medium">₹{Math.round(margin).toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">GST ({pricing.gst_percentage}%)</span>
                      <span className="font-medium">₹{Math.round(gst).toLocaleString('en-IN')}</span>
                    </div>
                    
                    <div className="border-t-2 border-emerald-200 my-2" />
                    
                    <div className="flex justify-between py-2">
                      <span className="font-bold text-slate-900">TOTAL</span>
                      <span className="font-bold text-[#4ADE40] text-lg">
                        ₹{Math.round(total).toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Advanced admin configs — Calculator, Health, Expansion + PIN Backfill */}
        <div className="mt-8">
          <AdvancedConfigSection />
        </div>
      </div>
    </div>
  );
}
