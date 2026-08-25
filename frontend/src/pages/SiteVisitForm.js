import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsAPI, inventoryAPI, formTabsAPI, termsAPI, materialKitsAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Progress } from '../components/ui/progress';
import { ComboInput } from '../components/ui/combo-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import ProposedSolutionSection from '../components/ProposedSolutionSection';
import { 
  User, MapPin, Zap, ArrowRight, ArrowLeft, Loader2, CheckCircle2,
  Sparkles, Plus, Trash2, Package, FolderOpen, X, Percent, FolderPlus, ExternalLink, CheckCircle, Link2,
  Ruler, ChevronDown, ChevronRight, Home, Compass, Eye, PlugZap, Settings2, HardHat, Shield, Layers,
  AlertCircle, FileText, Wand2, RefreshCw, Bolt
} from 'lucide-react';
import { Badge } from '../components/ui/badge';

const SYSTEM_SLUGS = ['customer', 'location', 'site_electrical', 'materials', 'site_docs'];
const SLUG_ICON_MAP = { customer: User, location: MapPin, site_electrical: Zap, materials: Package, site_docs: FolderOpen };

const SYSTEM_TYPE_OPTIONS = [
  { value: 'on-grid', label: 'On-Grid (Grid-Tied)' },
  { value: 'off-grid', label: 'Off-Grid (Standalone)' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'solar-pump', label: 'Solar Pump (Agri / Borewell)' }
];
const COMPLEXITY_OPTIONS = [
  { value: 'simple', label: 'Simple' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'complex', label: 'Complex' }
];
const SERVICE_TYPE_OPTIONS = [
  { value: 'Single Phase', label: 'Single Phase' },
  { value: 'Three Phase', label: 'Three Phase' },
  { value: 'HT Service', label: 'HT Service (High Tension)' }
];

// Iter 41 Change 1 — canonical service-category options (LT/HT/Ag) used on the
// PDF's Electrical Details section. Kept separate from SERVICE_TYPE_OPTIONS
// (phase) so both can coexist without breaking older projects.
const SERVICE_CATEGORY_OPTIONS = [
  { value: 'LT Domestic', label: 'LT Domestic' },
  { value: 'LT Commercial', label: 'LT Commercial' },
  { value: 'LT Industrial', label: 'LT Industrial' },
  { value: 'Agricultural', label: 'Agricultural' },
  { value: 'HT', label: 'HT (High Tension)' },
];
const CONNECTION_PHASE_OPTIONS = [
  { value: 'Single Phase', label: 'Single Phase' },
  { value: 'Three Phase', label: 'Three Phase' },
];

// Length conversion — user enters in either unit, we store in metres.
const toMetres = (val, unit) => {
  const n = parseFloat(val);
  if (isNaN(n)) return 0;
  return unit === 'ft' ? +(n * 0.3048).toFixed(2) : n;
};


export default function SiteVisitForm() {
  const navigate = useNavigate();
  const { editId } = useParams();
  const { isAdmin, isManager } = useAuth();
  const isEditMode = !!editId;

  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingProject, setLoadingProject] = useState(!!editId);
  const [w3wFormatError, setW3wFormatError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [error, setError] = useState('');
  const [inventoryItems, setInventoryItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [driveLinkValid, setDriveLinkValid] = useState(null);
  const [openSections, setOpenSections] = useState({ grid_electrical: true, roof: true, orientation: false, shadow: false, obstructions: false, electrical_m: false, load_m: false, inverter: false, access: false });
  const [allTabs, setAllTabs] = useState([]);
  const [termsList, setTermsList] = useState([]);
  const [refCandidates, setRefCandidates] = useState([]);
  const [refSearch, setRefSearch] = useState('');
  const [draftId, setDraftId] = useState(null);
  const autoSaveTimer = useRef(null);
  const lastSaved = useRef('');

  // Material Kits state
  const [availableKits, setAvailableKits] = useState([]);
  const [suggestedKit, setSuggestedKit] = useState(null);
  const [appliedKitId, setAppliedKitId] = useState(null);
  const [kitDismissed, setKitDismissed] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showResumeBanner, setShowResumeBanner] = useState(false);

  const canSetMargin = isAdmin || isManager;

  const [formData, setFormData] = useState({
    customer: { name: '', phone: '', address: '', email: '' },
    location: { latitude: null, longitude: null, address: '', site_location_words: '' },
    electrical: { sanction_load_kw: '', connected_load_kw: '', monthly_consumption_units: '', eb_tariff: '', service_type: '', connection_phase: '', _prefilled: {} },
    solar_system: { system_type: 'on-grid', inverter_model: '', panel_wattage: 540, battery_required: false, battery_capacity_ah: '' },
    mounting: { roof_type: '', tilt_angle: 15, structure_type: '' },
    additional: { cable_length_meters: 15, cable_length_unit: 'm', inverter_to_panel_distance: 3, inverter_to_panel_unit: 'm', installation_complexity: 'simple', shadow_analysis_notes: '' },
    selected_items: [],
    manual_costs: [],
    drive_folder_name: '',
    drive_folder_link: '',
    site_measurements: {
      roof: { length: '', width: '', area: '', type: '', height: '' },
      orientation: { direction: '', tilt_angle: '' },
      shadow: { present: false, sources: [], obstruction_height: '', distance: '' },
      obstructions: [],
      electrical: { meter_location: '', db_distance: '', cable_length: '' },
      load: { monthly_units: '', connected_load: '', connection_type: '' },
      inverter: { location: '', wall_space: '', earthing_available: '', earthing_distance: '' },
      access: { type: '', working_space: '', notes: '' }
    },
    custom_fields: {},
    solar_report: null,
    calculation_snapshot: null,
    terms_id: '',
    reference_project_id: '',
    installation_date: '',
    commissioning_date: '',
    notes: ''
  });

  const loadProject = useCallback(async () => {
    try {
      const res = await projectsAPI.getOne(editId);
      const p = res.data;
      setFormData({
        customer: p.customer || { name: '', phone: '', address: '', email: '' },
        location: p.location || { latitude: null, longitude: null, address: '', site_location_words: '' },
        electrical: {
          sanction_load_kw: p.electrical?.sanction_load_kw || '',
          connected_load_kw: p.electrical?.connected_load_kw || '',
          monthly_consumption_units: p.electrical?.monthly_consumption_units || '',
          eb_tariff: p.electrical?.eb_tariff || '',
          service_type: p.electrical?.service_type || '',
          connection_phase: p.electrical?.connection_phase || '',
          _prefilled: p.electrical?._prefilled || {}
        },
        solar_system: p.solar_system || { system_type: 'on-grid', inverter_model: '', panel_wattage: 540, battery_required: false, battery_capacity_ah: '' },
        mounting: p.mounting || { roof_type: '', tilt_angle: 15, structure_type: '' },
        additional: {
          cable_length_meters: p.additional?.cable_length_meters || 15,
          cable_length_unit: p.additional?.cable_length_unit || 'm',
          inverter_to_panel_distance: p.additional?.inverter_to_panel_distance || 3,
          inverter_to_panel_unit: p.additional?.inverter_to_panel_unit || 'm',
          installation_complexity: p.additional?.installation_complexity || 'simple',
          shadow_analysis_notes: p.additional?.shadow_analysis_notes || ''
        },
        selected_items: (p.selected_items || []).map(si => ({
          inventory_item_id: si.inventory_item_id, name: si.name, category: si.category,
          unit_price: si.unit_price, gst_percentage: si.gst_percentage || 18, quantity: si.quantity || 1,
          margin_percentage: si.margin_percentage || 0
        })),
        manual_costs: p.manual_costs || [],
        drive_folder_name: p.drive_folder_name || '',
        drive_folder_link: p.drive_folder_link || '',
        site_measurements: {
          roof: { length: '', width: '', area: '', type: '', height: '', ...(p.site_measurements?.roof || {}) },
          orientation: { direction: '', tilt_angle: '', ...(p.site_measurements?.orientation || {}) },
          shadow: { present: false, sources: [], obstruction_height: '', distance: '', ...(p.site_measurements?.shadow || {}) },
          obstructions: p.site_measurements?.obstructions || [],
          electrical: { meter_location: '', db_distance: '', cable_length: '', ...(p.site_measurements?.electrical || {}) },
          load: { monthly_units: '', connected_load: '', connection_type: '', ...(p.site_measurements?.load || {}) },
          inverter: { location: '', wall_space: '', earthing_available: '', earthing_distance: '', ...(p.site_measurements?.inverter || {}) },
          access: { type: '', working_space: '', notes: '', ...(p.site_measurements?.access || {}) }
        },
        custom_fields: p.custom_fields || {},
        solar_report: p.solar_report || null,
        terms_id: p.terms_id || '',
        reference_project_id: p.reference_project_id || '',
        installation_date: p.installation_date || '',
        commissioning_date: p.commissioning_date || '',
        notes: (p.notes !== undefined && p.notes !== null && p.notes !== '')
          ? p.notes
          : (p.additional?.shadow_analysis_notes || '')
      });
    } catch (err) {
      setError('Failed to load project for editing');
      console.error(err);
    } finally {
      setLoadingProject(false);
    }
  }, [editId]);

  const fetchInventory = useCallback(async () => {
    try { const res = await inventoryAPI.getItems(); setInventoryItems(res.data); } catch (err) { console.error(err); }
  }, []);
  const fetchCategories = useCallback(async () => {
    try { const res = await inventoryAPI.getCategories(); setCategories(res.data); } catch (err) { console.error(err); }
  }, []);
  const fetchDynamicTabs = useCallback(async () => {
    try { const res = await formTabsAPI.getAll(); setAllTabs((res.data || []).filter(t => t.active !== false)); } catch (err) { console.error(err); }
  }, []);
  const fetchTermsList = useCallback(async () => {
    try { const res = await termsAPI.getAll(); setTermsList(res.data || []); } catch (err) { console.error(err); }
  }, []);
  const fetchRefCandidates = useCallback(async () => {
    try { const res = await projectsAPI.getReferenceCandidates(); setRefCandidates(res.data || []); } catch (err) { console.error(err); }
  }, []);
  const fetchMaterialKits = useCallback(async () => {
    try { const res = await materialKitsAPI.getAll(); setAvailableKits(res.data || []); } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    fetchInventory();
    fetchCategories();
    fetchDynamicTabs();
    fetchTermsList();
    fetchRefCandidates();
    fetchMaterialKits();
    if (editId) loadProject();
  }, [editId, fetchInventory, fetchCategories, fetchDynamicTabs, fetchTermsList, fetchRefCandidates, fetchMaterialKits, loadProject]);

  // Auto-suggest a Material Kit when system_type/capacity changes on the Proposed Solution
  useEffect(() => {
    if (editId || kitDismissed) return;
    if (!availableKits.length) return;
    const ps = formData.custom_fields?.proposed_solution || {};
    const st = ps.system_type;
    const kw = parseFloat(ps.system_size_kw) || 0;
    if (!st || kw <= 0) { setSuggestedKit(null); return; }
    const candidates = availableKits.filter(k => k.system_type === st);
    if (candidates.length === 0) { setSuggestedKit(null); return; }
    // Prefer range match
    const within = candidates.filter(k =>
      k.capacity_min_kw != null && k.capacity_max_kw != null &&
      kw >= k.capacity_min_kw && kw <= k.capacity_max_kw
    );
    const pool = within.length ? within : candidates;
    const best = pool.reduce((a, b) =>
      Math.abs((a.capacity_kw||0) - kw) <= Math.abs((b.capacity_kw||0) - kw) ? a : b
    );
    setSuggestedKit(best);
  }, [availableKits, formData.custom_fields, editId, kitDismissed]);

  // Iter 41 Change 1 — Auto-prefill EB tariff + service type from the proposed-solution
  // section (which resolves DISCOM/tariff-category from PIN code). We only fill when
  // the user hasn't already typed something; mark _prefilled so the UI can badge it.
  useEffect(() => {
    const ps = formData.custom_fields?.proposed_solution || {};
    const psTariff = parseFloat(ps.tariff_per_unit) || 0;
    const psCategory = ps.tariff_category || '';
    if (!psTariff && !psCategory) return;
    setFormData(prev => {
      const el = prev.electrical || {};
      const patch = { ...el };
      const pref = { ...(el._prefilled || {}) };
      let changed = false;
      if (psTariff && (!el.eb_tariff || pref.eb_tariff)) {
        patch.eb_tariff = psTariff; pref.eb_tariff = true; changed = true;
      }
      // Only prefill service type if the user hasn't picked one; keep them separate — tariff
      // category ≠ service type but they usually coincide (e.g. "Domestic" → "LT Domestic")
      if (psCategory && !el.service_type) {
        const mapped =
          psCategory === 'Domestic'   ? 'LT Domestic'   :
          psCategory === 'Commercial' ? 'LT Commercial' :
          psCategory === 'Industrial' ? 'LT Industrial' :
          psCategory === 'Agricultural' ? 'Agricultural' :
          psCategory === 'HT' ? 'HT' : null;
        if (mapped) { patch.service_type = mapped; pref.service_type = true; changed = true; }
      }
      if (!changed) return prev;
      patch._prefilled = pref;
      return { ...prev, electrical: patch };
    });
  }, [formData.custom_fields?.proposed_solution?.tariff_per_unit,
      formData.custom_fields?.proposed_solution?.tariff_category]);

  const applyKit = (kit) => {
    if (!kit) return;
    // Convert kit lines into selected_items (using inventory info when linked)
    const newItems = kit.lines.map(line => {
      const inv = line.inventory_item_id ? inventoryItems.find(i => i.id === line.inventory_item_id) : null;
      if (inv) {
        return {
          inventory_item_id: inv.id, name: inv.name, category: inv.category,
          unit_price: inv.unit_price, gst_percentage: inv.gst_percentage || 18,
          quantity: parseInt(line.quantity) || 1, margin_percentage: 0
        };
      }
      // Free-text line — no inventory ref
      return {
        inventory_item_id: null, name: line.name, category: line.category || 'kit_line',
        unit_price: 0, gst_percentage: 18,
        quantity: parseInt(line.quantity) || 1, margin_percentage: 0
      };
    });
    setFormData(prev => ({ ...prev, selected_items: newItems }));
    setAppliedKitId(kit.id);
  };

  // Draft resume banner — check localStorage on mount
  useEffect(() => {
    if (editId) return;
    try {
      const saved = localStorage.getItem('site_visit_draft');
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft && draft.customer?.name && Date.now() - (draft._savedAt || 0) < 7 * 24 * 3600 * 1000) {
          setShowResumeBanner(true);
        }
      }
    } catch { /* ignore */ }
  }, [editId]);

  const resumeDraft = () => {
    try {
      const saved = localStorage.getItem('site_visit_draft');
      if (saved) {
        const draft = JSON.parse(saved);
        const { _savedAt, ...rest } = draft;
        setFormData(prev => ({ ...prev, ...rest }));
        setShowResumeBanner(false);
      }
    } catch { setShowResumeBanner(false); }
  };
  const discardDraft = () => {
    try { localStorage.removeItem('site_visit_draft'); } catch { /* ignore */ }
    setShowResumeBanner(false);
  };
  // Persist current form to localStorage every 3s while editing
  useEffect(() => {
    if (editId) return;
    if (!formData.customer.name.trim()) return;
    const t = setTimeout(() => {
      try { localStorage.setItem('site_visit_draft', JSON.stringify({ ...formData, _savedAt: Date.now() })); } catch { /* ignore */ }
    }, 3000);
    return () => clearTimeout(t);
  }, [formData, editId]);

  // Auto-save as draft when form has customer name
  useEffect(() => {
    if (editId) return; // Don't auto-save when editing existing project
    const hasData = formData.customer.name.trim().length >= 2;
    if (!hasData) return;
    
    const dataStr = JSON.stringify(formData);
    if (dataStr === lastSaved.current) return;
    
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        // Convert empty strings to appropriate defaults for auto-save
        const payload = {
          customer: {
            name: formData.customer.name,
            phone: formData.customer.phone || '0000000000',
            address: formData.customer.address || 'Draft - Address TBD',
            email: formData.customer.email || null
          },
          location: formData.location,
          electrical: {
            sanction_load_kw: parseFloat(formData.electrical.sanction_load_kw) || 0,
            connected_load_kw: parseFloat(formData.electrical.connected_load_kw) || 0,
            monthly_consumption_units: parseFloat(formData.electrical.monthly_consumption_units) || 0,
            eb_tariff: parseFloat(formData.electrical.eb_tariff) || 0,
            service_type: formData.electrical.service_type || null,
            connection_phase: formData.electrical.connection_phase || null,
            _prefilled: formData.electrical._prefilled || {}
          },
          solar_system: {
            system_type: formData.solar_system.system_type || 'on-grid',
            inverter_model: formData.solar_system.inverter_model || null,
            panel_wattage: parseInt(formData.solar_system.panel_wattage) || 540,
            battery_required: formData.solar_system.battery_required || false,
            battery_capacity_ah: formData.solar_system.battery_capacity_ah ? parseInt(formData.solar_system.battery_capacity_ah) : null
          },
          mounting: {
            roof_type: formData.mounting.roof_type || 'TBD',
            tilt_angle: parseInt(formData.mounting.tilt_angle) || 15,
            structure_type: formData.mounting.structure_type || 'TBD'
          },
          additional: {
            cable_length_meters: toMetres(formData.additional.cable_length_meters, formData.additional.cable_length_unit),
            cable_length_unit: formData.additional.cable_length_unit || 'm',
            inverter_to_panel_distance: toMetres(formData.additional.inverter_to_panel_distance, formData.additional.inverter_to_panel_unit),
            inverter_to_panel_unit: formData.additional.inverter_to_panel_unit || 'm',
            installation_complexity: formData.additional.installation_complexity || 'simple',
            shadow_analysis_notes: formData.additional.shadow_analysis_notes || ''
          },
          selected_items: formData.selected_items,
          manual_costs: formData.manual_costs,
          drive_folder_name: formData.drive_folder_name,
          drive_folder_link: formData.drive_folder_link || null,
          site_measurements: formData.site_measurements,
          custom_fields: formData.custom_fields,
          calculation_snapshot: formData.calculation_snapshot || null,
          terms_id: formData.terms_id || null,
          reference_project_id: formData.reference_project_id || null,
          installation_date: formData.installation_date || null,
          commissioning_date: formData.commissioning_date || null,
          notes: formData.notes || ''
        };
        if (draftId) {
          await projectsAPI.update(draftId, payload);
        } else {
          const res = await projectsAPI.create(payload);
          if (res.data?.id) setDraftId(res.data.id);
        }
        lastSaved.current = dataStr;
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, 5000);
    
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [formData, editId, draftId]);

  const validateDriveLink = (link) => {
    if (!link) { setDriveLinkValid(null); return false; }
    const valid = link.includes('drive.google.com/drive/folders/');
    setDriveLinkValid(valid);
    return valid;
  };

  const extractFolderId = (link) => {
    const match = link.match(/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
  };

  const autoSuggestFolderName = () => {
    const name = formData.customer.name || 'Project';
    const date = new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }).replace(' ', '_');
    return `${name.replace(/\s+/g, '_')}_SiteVisit_${date}`;
  };

  const updateField = (section, field, value) => {
    setFormData(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  };

  // ── What3Words: capture GPS → fetch w3w → autofill ───────────────────

  const updateMeasurement = (section, field, value) => {
    setFormData(prev => ({
      ...prev,
      site_measurements: {
        ...prev.site_measurements,
        [section]: { ...prev.site_measurements[section], [field]: value }
      }
    }));
  };

  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const addObstruction = () => {
    setFormData(prev => ({
      ...prev,
      site_measurements: {
        ...prev.site_measurements,
        obstructions: [...prev.site_measurements.obstructions, { name: '', notes: '' }]
      }
    }));
  };

  const updateObstruction = (idx, field, value) => {
    setFormData(prev => {
      const obs = [...prev.site_measurements.obstructions];
      obs[idx] = { ...obs[idx], [field]: value };
      return { ...prev, site_measurements: { ...prev.site_measurements, obstructions: obs } };
    });
  };

  const removeObstruction = (idx) => {
    setFormData(prev => ({
      ...prev,
      site_measurements: {
        ...prev.site_measurements,
        obstructions: prev.site_measurements.obstructions.filter((_, i) => i !== idx)
      }
    }));
  };

  const toggleShadowSource = (source) => {
    setFormData(prev => {
      const current = prev.site_measurements.shadow.sources || [];
      const updated = current.includes(source) ? current.filter(s => s !== source) : [...current, source];
      return { ...prev, site_measurements: { ...prev.site_measurements, shadow: { ...prev.site_measurements.shadow, sources: updated } } };
    });
  };

  const addSelectedItem = (itemId) => {
    const invItem = inventoryItems.find(i => i.id === itemId);
    if (!invItem || formData.selected_items.find(si => si.inventory_item_id === itemId)) return;
    setFormData(prev => ({
      ...prev,
      selected_items: [...prev.selected_items, {
        inventory_item_id: invItem.id, name: invItem.name, category: invItem.category,
        unit_price: invItem.unit_price, gst_percentage: invItem.gst_percentage, quantity: 1, margin_percentage: 0
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
  const removeSelectedItem = (index) => setFormData(prev => ({ ...prev, selected_items: prev.selected_items.filter((_, i) => i !== index) }));
  const addManualCost = () => setFormData(prev => ({ ...prev, manual_costs: [...prev.manual_costs, { description: '', amount: 0 }] }));
  const updateManualCost = (index, field, value) => {
    setFormData(prev => {
      const costs = [...prev.manual_costs];
      costs[index] = { ...costs[index], [field]: value };
      return { ...prev, manual_costs: costs };
    });
  };
  const removeManualCost = (index) => setFormData(prev => ({ ...prev, manual_costs: prev.manual_costs.filter((_, i) => i !== index) }));

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    try {
      const slug = newCategoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      await inventoryAPI.createCategory({ name: newCategoryName.trim(), slug, description: '' });
      await fetchCategories();
      setNewCategoryName('');
      setShowAddCategory(false);
    } catch (err) { setError(formatApiErrorDetail(err.response?.data?.detail) || 'Failed to create category'); }
    finally { setCreatingCategory(false); }
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

  const getTotalSteps = () => allTabs.length || 5;
  const getStepSlug = (step) => allTabs[step - 1]?.slug || '';

  const validateStep = () => {
    setError('');
    const slug = getStepSlug(currentStep);
    // Validate extra/custom fields for any tab (system or custom)
    const validateExtraFields = () => {
      const tab = allTabs[currentStep - 1];
      if (tab && tab.fields && tab.fields.length > 0) {
        const tabData = formData.custom_fields?.[slug] || {};
        for (const f of tab.fields) {
          if (f.required && !tabData[f.name] && tabData[f.name] !== 0 && tabData[f.name] !== false) {
            setError(`"${f.label}" is required`); return false;
          }
        }
      }
      return true;
    };
    switch (slug) {
      case 'customer': if (!formData.customer.name || !formData.customer.phone || !formData.customer.address) { setError('Please fill all required fields'); return false; } return validateExtraFields();
      case 'location': if (!formData.location.site_location_words && !formData.location.address) { setError('Enter What3Words or site address'); return false; } return validateExtraFields();
      case 'site_electrical': return validateExtraFields();
      case 'materials': {
        const ps = formData.custom_fields?.proposed_solution || {};
        if (ps.system_type !== 'solar-pump' && !(parseFloat(ps.system_size_kw) > 0)) {
          setError('Enter System Size (kW) in the Solar Calculator before continuing'); return false;
        }
        return validateExtraFields();
      }
      case 'site_docs': {
        // Drive folder is now optional; if provided, warn about format but do not block
        const link = formData.drive_folder_link;
        if (link && link.trim() && !link.includes('drive.google.com/drive/folders/')) {
          console.warn('Drive folder link does not match the standard Google Drive folder URL format.');
        }
        return validateExtraFields();
      }
      default: return validateExtraFields();
    }
  };

  const nextStep = () => { if (validateStep()) setCurrentStep(prev => Math.min(prev + 1, getTotalSteps())); };
  const prevStep = () => { setCurrentStep(prev => Math.max(prev - 1, 1)); setError(''); };

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setLoading(true);
    setError('');
    try {
      // Pull electrical defaults from the Proposed Solution calculator if not set elsewhere
      const ps = (formData.custom_fields && formData.custom_fields.proposed_solution) || {};
      const psMonthlyUnits = parseFloat(ps.monthly_eb_units) || 0;
      const psSanctionLoad = parseFloat(ps.sanctioned_load_kw) || parseFloat(ps.system_size_kw) || 0;
      const psTariff = parseFloat(ps.tariff_per_unit) || 0;

      const payload = {
        customer: formData.customer,
        location: {
          latitude: formData.location.latitude ? parseFloat(formData.location.latitude) : null,
          longitude: formData.location.longitude ? parseFloat(formData.location.longitude) : null,
          address: formData.location.address, site_location_words: formData.location.site_location_words
        },
        electrical: {
          sanction_load_kw: parseFloat(formData.electrical.sanction_load_kw) || psSanctionLoad || 0,
          connected_load_kw: parseFloat(formData.electrical.connected_load_kw) || 0,
          monthly_consumption_units: parseFloat(formData.electrical.monthly_consumption_units) || psMonthlyUnits || 0,
          eb_tariff: parseFloat(formData.electrical.eb_tariff) || psTariff || 0,
          service_type: formData.electrical.service_type || ps.connection_type || null,
          connection_phase: formData.electrical.connection_phase || null,
          _prefilled: formData.electrical._prefilled || {}
        },
        solar_system: {
          ...formData.solar_system, panel_wattage: parseInt(formData.solar_system.panel_wattage) || 540,
          battery_capacity_ah: formData.solar_system.battery_required ? parseInt(formData.solar_system.battery_capacity_ah) || 0 : null
        },
        mounting: { ...formData.mounting, tilt_angle: parseInt(formData.mounting.tilt_angle) || 15 },
        additional: {
          ...formData.additional,
          cable_length_meters: toMetres(formData.additional.cable_length_meters, formData.additional.cable_length_unit),
          cable_length_unit: formData.additional.cable_length_unit || 'm',
          inverter_to_panel_distance: toMetres(formData.additional.inverter_to_panel_distance, formData.additional.inverter_to_panel_unit),
          inverter_to_panel_unit: formData.additional.inverter_to_panel_unit || 'm'
        },
        selected_items: formData.selected_items.map(si => ({
          inventory_item_id: si.inventory_item_id, name: si.name, category: si.category,
          unit_price: si.unit_price, gst_percentage: si.gst_percentage, quantity: parseInt(si.quantity) || 1,
          margin_percentage: parseFloat(si.margin_percentage) || 0
        })),
        manual_costs: formData.manual_costs.filter(c => c.description && c.amount > 0).map(c => ({
          description: c.description, amount: parseFloat(c.amount) || 0
        })),
        drive_folder_name: formData.drive_folder_name || null,
        drive_folder_link: formData.drive_folder_link || null,
        drive_folder_id: formData.drive_folder_link ? extractFolderId(formData.drive_folder_link) : null,
        site_measurements: {
          roof: {
            length: parseFloat(formData.site_measurements.roof.length) || '',
            width: parseFloat(formData.site_measurements.roof.width) || '',
            area: parseFloat(formData.site_measurements.roof.area) || '',
            type: formData.site_measurements.roof.type,
            height: parseFloat(formData.site_measurements.roof.height) || ''
          },
          orientation: formData.site_measurements.orientation,
          shadow: formData.site_measurements.shadow,
          obstructions: formData.site_measurements.obstructions.filter(o => o.name),
          electrical: formData.site_measurements.electrical,
          load: formData.site_measurements.load,
          inverter: formData.site_measurements.inverter,
          access: formData.site_measurements.access
        },
        custom_fields: formData.custom_fields || {},
        solar_report: formData.solar_report || null,
        calculation_snapshot: formData.calculation_snapshot || null,
        terms_id: formData.terms_id || null,
        reference_project_id: formData.reference_project_id || null,
        installation_date: formData.installation_date || null,
        commissioning_date: formData.commissioning_date || null,
        notes: formData.notes || ''
      };

      if (isEditMode) {
        await projectsAPI.update(editId, payload);
        navigate(`/dashboard/projects/${editId}`);
      } else if (draftId) {
        await projectsAPI.update(draftId, payload);
        navigate(`/dashboard/projects/${draftId}`);
      } else {
        const res = await projectsAPI.create(payload);
        navigate(`/dashboard/projects/${res.data.id}`);
      }
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || `Failed to ${isEditMode ? 'update' : 'create'} project`);
    } finally { setLoading(false); }
  };

  if (loadingProject) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  const STEPS = allTabs.map((tab, idx) => ({
    id: idx + 1,
    title: tab.slug === 'materials' ? 'Proposed Solution & Materials' : tab.name,
    icon: SLUG_ICON_MAP[tab.slug] || Layers,
    slug: tab.slug,
    fields: tab.fields,
    system: !!tab.system
  }));
  const totalSteps = STEPS.length || 1;

  const renderExtraFields = (slug) => {
    const step = STEPS.find(s => s.slug === slug);
    const extraFields = (step?.fields || []);
    if (extraFields.length === 0) return null;
    const tabData = formData.custom_fields?.[slug] || {};
    const updateCustomField = (fieldName, value) => {
      setFormData(prev => ({
        ...prev,
        custom_fields: { ...prev.custom_fields, [slug]: { ...(prev.custom_fields?.[slug] || {}), [fieldName]: value } }
      }));
    };
    return (
      <div className="mt-4 pt-4 border-t border-slate-200 space-y-4" data-testid={`extra-fields-${slug}`}>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Additional Fields</p>
        {extraFields.map((field, fIdx) => (
          <div key={field.name || fIdx} className="space-y-1.5">
            <Label className="text-sm">{field.label}{field.required && ' *'}</Label>
            {field.type === 'text' && <Input value={tabData[field.name] || ''} onChange={(e) => updateCustomField(field.name, e.target.value)} placeholder={field.placeholder} className="h-11" data-testid={`custom-field-${field.name}`} />}
            {field.type === 'number' && <Input type="number" value={tabData[field.name] || ''} onChange={(e) => updateCustomField(field.name, e.target.value)} placeholder={field.placeholder} className="h-11" data-testid={`custom-field-${field.name}`} />}
            {field.type === 'textarea' && <Textarea rows={3} value={tabData[field.name] || ''} onChange={(e) => updateCustomField(field.name, e.target.value)} placeholder={field.placeholder} className="min-h-[80px]" data-testid={`custom-field-${field.name}`} />}
            {field.type === 'select' && <Select value={tabData[field.name] || ''} onValueChange={(v) => updateCustomField(field.name, v)}><SelectTrigger className="h-11" data-testid={`custom-field-${field.name}`}><SelectValue placeholder={field.placeholder || 'Select...'} /></SelectTrigger><SelectContent>{(field.options || []).map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent></Select>}
            {field.type === 'checkbox' && <div className="flex items-center gap-2 pt-1"><Checkbox id={`cf-${field.name}`} checked={!!tabData[field.name]} onCheckedChange={(c) => updateCustomField(field.name, !!c)} data-testid={`custom-field-${field.name}`} /><Label htmlFor={`cf-${field.name}`} className="text-sm">{field.placeholder || field.label}</Label></div>}
            {field.type === 'date' && <Input type="date" value={tabData[field.name] || ''} onChange={(e) => updateCustomField(field.name, e.target.value)} className="h-11" data-testid={`custom-field-${field.name}`} />}
          </div>
        ))}
      </div>
    );
  };

  const progress = (currentStep / totalSteps) * 100;
  const totals = calculateTotal();

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 pb-24 sm:pb-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold font-['Outfit'] text-slate-900 mb-1">{isEditMode ? 'Edit Project' : 'New Site Visit'}</h1>
          <p className="text-sm text-slate-500">{isEditMode ? 'Update project details' : 'Collect site data for an accurate solar project estimate'}</p>
        </div>

        {showResumeBanner && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-center gap-3" data-testid="resume-draft-banner">
            <RefreshCw className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">Continue where you left off?</p>
              <p className="text-[11px] text-amber-700">You have an unfinished draft in this browser.</p>
            </div>
            <Button type="button" size="sm" onClick={resumeDraft} className="h-8 bg-amber-600 hover:bg-amber-700 text-white" data-testid="resume-draft-btn">Resume</Button>
            <Button type="button" size="sm" variant="ghost" onClick={discardDraft} className="h-8 text-amber-700" data-testid="discard-draft-btn">Discard</Button>
          </div>
        )}

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
            <CardTitle className="font-['Outfit'] text-lg">{STEPS[currentStep - 1]?.slug === 'materials' ? 'Proposed Solution & Materials' : (STEPS[currentStep - 1]?.title || '')}</CardTitle>
            <CardDescription className="text-sm">
              {(() => {
                const slug = STEPS[currentStep - 1]?.slug;
                if (slug === 'customer') return 'Customer contact details';
                if (slug === 'location') return 'Site location and roof details';
                if (slug === 'site_electrical') return 'Site measurements, electrical & load information';
                if (slug === 'materials') return 'Define the proposed solution, select materials & view live ROI / payback metrics';
                if (slug === 'site_docs') return 'Link your Google Drive folder for site documentation';
                return `Fill in ${STEPS[currentStep - 1]?.title || ''} details`;
              })()}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {error && <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="form-error">{error}</div>}

            {/* Step: Customer */}
            {STEPS[currentStep - 1]?.slug === 'customer' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Customer Name *</Label><Input value={formData.customer.name} onChange={(e) => updateField('customer', 'name', e.target.value)} placeholder="Customer name" className="h-11" data-testid="customer-name-input" /></div>
                  <div className="space-y-2"><Label>Phone *</Label><Input type="tel" value={formData.customer.phone} onChange={(e) => updateField('customer', 'phone', e.target.value)} placeholder="Phone number" className="h-11" data-testid="customer-phone-input" /></div>
                </div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.customer.email} onChange={(e) => updateField('customer', 'email', e.target.value)} placeholder="Email (optional)" className="h-11" data-testid="customer-email-input" /></div>
                <div className="space-y-2"><Label>Address *</Label><Textarea rows={3} value={formData.customer.address} onChange={(e) => updateField('customer', 'address', e.target.value)} placeholder="Full address" className="min-h-[80px]" data-testid="customer-address-input" /></div>
                {renderExtraFields('customer')}
              </div>
            )}

            {/* Step: Location */}
            {STEPS[currentStep - 1]?.slug === 'location' && (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                  <div className="mb-2">
                    <h3 className="font-semibold text-emerald-800 mb-1">What3Words Address</h3>
                    <p className="text-sm text-emerald-600">Enter the 3-word location manually (optional). Use the What3Words app on your phone to look it up.</p>
                  </div>
                  <Input
                    value={formData.location.site_location_words}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const cleaned = raw.replace(/^\/{1,3}/, '');
                      updateField('location', 'site_location_words', cleaned);
                      if (!cleaned || /^[a-z]+\.[a-z]+\.[a-z]+$/i.test(cleaned)) setW3wFormatError('');
                      else setW3wFormatError('Format should be word.word.word (optional field — you can leave it blank).');
                    }}
                    placeholder="word.word.word"
                    className="font-mono h-11"
                    data-testid="what3words-input"
                  />
                  {(formData.location.latitude && formData.location.longitude) && (
                    <p className="text-[11px] text-emerald-600 mt-1.5 flex items-center gap-1" data-testid="w3w-coords">
                      <MapPin className="h-3 w-3" />
                      {Number(formData.location.latitude).toFixed(5)}, {Number(formData.location.longitude).toFixed(5)}
                    </p>
                  )}
                  {formData.location.site_location_words && (
                    <a href={`https://what3words.com/${formData.location.site_location_words.replace(/^\/{1,3}/, '')}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-emerald-700 hover:underline inline-block mt-1.5" data-testid="w3w-open-link">Open in W3W ↗</a>
                  )}
                  {w3wFormatError && (
                    <p className="text-[11px] text-amber-700 mt-1.5 flex items-center gap-1" data-testid="w3w-error"><AlertCircle className="h-3 w-3" />{w3wFormatError}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label className="text-xs">Latitude (optional)</Label><Input type="number" step="any" value={formData.location.latitude ?? ''} onChange={(e) => updateField('location', 'latitude', e.target.value)} placeholder="e.g., 13.0827" className="h-11 font-mono" data-testid="latitude-input" /></div>
                  <div className="space-y-2"><Label className="text-xs">Longitude (optional)</Label><Input type="number" step="any" value={formData.location.longitude ?? ''} onChange={(e) => updateField('location', 'longitude', e.target.value)} placeholder="e.g., 80.2707" className="h-11 font-mono" data-testid="longitude-input" /></div>
                </div>
                <div className="space-y-2"><Label>Site Address</Label><Textarea rows={2} value={formData.location.address} onChange={(e) => updateField('location', 'address', e.target.value)} placeholder="Site location description" data-testid="location-address-input" /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Roof Type</Label><Input value={formData.mounting.roof_type} onChange={(e) => updateField('mounting', 'roof_type', e.target.value)} placeholder="e.g., RCC Flat Roof, Metal Sheet" className="h-11" data-testid="roof-type-input" /></div>
                  <div className="space-y-2"><Label>Tilt Angle (degrees)</Label><Input type="number" min="0" max="90" value={formData.mounting.tilt_angle} onChange={(e) => updateField('mounting', 'tilt_angle', e.target.value)} className="h-11" data-testid="tilt-angle-input" /></div>
                </div>
                <div className="space-y-2"><Label>Structure Type</Label><Input value={formData.mounting.structure_type} onChange={(e) => updateField('mounting', 'structure_type', e.target.value)} placeholder="e.g., Galvanized Iron" className="h-11" data-testid="structure-type-input" /></div>
                {renderExtraFields('location')}
              </div>
            )}

            {/* Step: Site & Electrical (Merged) */}
            {STEPS[currentStep - 1]?.slug === 'site_electrical' && (
              <div className="space-y-3">

                {/* Roof Details */}
                <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="section-roof">
                  <button type="button" onClick={() => toggleSection('roof')} className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><Home className="h-4 w-4 text-orange-500" />Roof Details</span>
                    {openSections.roof ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {openSections.roof && (
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Roof Length (ft)</Label><Input type="number" step="0.1" min="0" value={formData.site_measurements.roof.length} onChange={(e) => { updateMeasurement('roof', 'length', e.target.value); const w = formData.site_measurements.roof.width; if (e.target.value && w) updateMeasurement('roof', 'area', (parseFloat(e.target.value) * parseFloat(w)).toFixed(1)); }} placeholder="e.g., 30" className="h-10" data-testid="roof-length-input" /></div>
                        <div className="space-y-1"><Label className="text-xs">Roof Width (ft)</Label><Input type="number" step="0.1" min="0" value={formData.site_measurements.roof.width} onChange={(e) => { updateMeasurement('roof', 'width', e.target.value); const l = formData.site_measurements.roof.length; if (e.target.value && l) updateMeasurement('roof', 'area', (parseFloat(e.target.value) * parseFloat(l)).toFixed(1)); }} placeholder="e.g., 20" className="h-10" data-testid="roof-width-input" /></div>
                        <div className="space-y-1"><Label className="text-xs">Total Area (sq ft)</Label><Input value={formData.site_measurements.roof.area} readOnly className="h-10 bg-slate-50 font-medium" data-testid="roof-area-input" /></div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Roof Type</Label>
                          <Select value={formData.site_measurements.roof.type} onValueChange={(v) => updateMeasurement('roof', 'type', v)}>
                            <SelectTrigger className="h-10" data-testid="roof-type-select"><SelectValue placeholder="Select type" /></SelectTrigger>
                            <SelectContent><SelectItem value="RCC">RCC</SelectItem><SelectItem value="Sheet">Sheet</SelectItem><SelectItem value="Tile">Tile</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1"><Label className="text-xs">Roof Height from Ground (ft)</Label><Input type="number" step="0.1" min="0" value={formData.site_measurements.roof.height} onChange={(e) => updateMeasurement('roof', 'height', e.target.value)} placeholder="e.g., 12" className="h-10" data-testid="roof-height-input" /></div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Orientation & Tilt */}
                <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="section-orientation">
                  <button type="button" onClick={() => toggleSection('orientation')} className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><Compass className="h-4 w-4 text-blue-500" />Orientation & Tilt</span>
                    {openSections.orientation ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {openSections.orientation && (
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Roof Direction</Label>
                          <Select value={formData.site_measurements.orientation.direction} onValueChange={(v) => updateMeasurement('orientation', 'direction', v)}>
                            <SelectTrigger className="h-10" data-testid="roof-direction-select"><SelectValue placeholder="Select direction" /></SelectTrigger>
                            <SelectContent><SelectItem value="North">North</SelectItem><SelectItem value="South">South</SelectItem><SelectItem value="East">East</SelectItem><SelectItem value="West">West</SelectItem><SelectItem value="North-East">North-East</SelectItem><SelectItem value="North-West">North-West</SelectItem><SelectItem value="South-East">South-East</SelectItem><SelectItem value="South-West">South-West</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1"><Label className="text-xs">Tilt Angle (degrees)</Label><Input type="number" min="0" max="90" value={formData.site_measurements.orientation.tilt_angle} onChange={(e) => updateMeasurement('orientation', 'tilt_angle', e.target.value)} placeholder="e.g., 12" className="h-10" data-testid="meas-tilt-angle-input" />
                          <p className="text-[10px] text-slate-400">Optimal: 10-15 degrees for South India</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Shadow Analysis */}
                <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="section-shadow">
                  <button type="button" onClick={() => toggleSection('shadow')} className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><Eye className="h-4 w-4 text-amber-500" />Shadow Analysis</span>
                    {openSections.shadow ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {openSections.shadow && (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center space-x-3">
                        <Checkbox id="shadowPresent" checked={formData.site_measurements.shadow.present} onCheckedChange={(c) => updateMeasurement('shadow', 'present', !!c)} data-testid="shadow-present-checkbox" />
                        <Label htmlFor="shadowPresent" className="text-sm">Shadow Present</Label>
                      </div>
                      {formData.site_measurements.shadow.present && (
                        <>
                          <div className="space-y-1"><Label className="text-xs">Shadow Sources</Label>
                            <div className="flex flex-wrap gap-2">
                              {['Trees', 'Buildings', 'Poles', 'Tanks', 'Other'].map(src => (
                                <button key={src} type="button" onClick={() => toggleShadowSource(src)}
                                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${formData.site_measurements.shadow.sources.includes(src) ? 'bg-amber-100 border-amber-300 text-amber-800 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                  data-testid={`shadow-source-${src.toLowerCase()}`}>{src}</button>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1"><Label className="text-xs">Obstruction Height (ft)</Label><Input type="number" step="0.1" min="0" value={formData.site_measurements.shadow.obstruction_height} onChange={(e) => updateMeasurement('shadow', 'obstruction_height', e.target.value)} placeholder="e.g., 15" className="h-10" data-testid="obstruction-height-input" /></div>
                            <div className="space-y-1"><Label className="text-xs">Distance from Panel Area (ft)</Label><Input type="number" step="0.1" min="0" value={formData.site_measurements.shadow.distance} onChange={(e) => updateMeasurement('shadow', 'distance', e.target.value)} placeholder="e.g., 20" className="h-10" data-testid="shadow-distance-input" /></div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Obstructions */}
                <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="section-obstructions">
                  <button type="button" onClick={() => toggleSection('obstructions')} className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><Shield className="h-4 w-4 text-red-500" />Obstructions</span>
                    {openSections.obstructions ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {openSections.obstructions && (
                    <div className="p-4 space-y-3">
                      {formData.site_measurements.obstructions.map((obs, idx) => (
                        <div key={`obs-${idx}`} className="flex gap-2 items-start">
                          <Input value={obs.name} onChange={(e) => updateObstruction(idx, 'name', e.target.value)} placeholder="e.g., Water Tank" className="flex-1 h-10" data-testid={`obstruction-name-${idx}`} />
                          <Input value={obs.notes} onChange={(e) => updateObstruction(idx, 'notes', e.target.value)} placeholder="Position / Notes" className="flex-1 h-10" data-testid={`obstruction-notes-${idx}`} />
                          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 text-red-500 shrink-0" onClick={() => removeObstruction(idx)}><X className="h-4 w-4" /></Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={addObstruction} className="h-9 gap-1.5 text-xs" data-testid="add-obstruction-btn"><Plus className="h-3.5 w-3.5" />Add Obstruction</Button>
                    </div>
                  )}
                </div>

                {/* Electrical Wiring & Metering */}
                <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="section-electrical-m">
                  <button type="button" onClick={() => toggleSection('electrical_m')} className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><PlugZap className="h-4 w-4 text-yellow-500" />Wiring & Metering</span>
                    {openSections.electrical_m ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {openSections.electrical_m && (
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">EB Meter Location</Label><Input value={formData.site_measurements.electrical.meter_location} onChange={(e) => updateMeasurement('electrical', 'meter_location', e.target.value)} placeholder="e.g., Ground floor, left wall" className="h-10" data-testid="meter-location-input" /></div>
                        <div className="space-y-1"><Label className="text-xs">Main DB Location</Label><Input value={formData.site_measurements.electrical.main_db_location || ''} onChange={(e) => updateMeasurement('electrical', 'main_db_location', e.target.value)} placeholder="e.g., First floor hallway" className="h-10" data-testid="main-db-location-input" /></div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Distance Roof to DB (ft)</Label><Input type="number" step="0.1" min="0" value={formData.site_measurements.electrical.db_distance} onChange={(e) => updateMeasurement('electrical', 'db_distance', e.target.value)} placeholder="e.g., 25" className="h-10" data-testid="db-distance-input" /></div>
                        <div className="space-y-1"><Label className="text-xs">Estimated Cable Length (ft)</Label><Input type="number" step="0.1" min="0" value={formData.site_measurements.electrical.cable_length} onChange={(e) => updateMeasurement('electrical', 'cable_length', e.target.value)} placeholder="e.g., 50" className="h-10" data-testid="meas-cable-length-input" /></div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Load & Electrical Details (Iter 41 Change 1 — orphan-field fix) */}
                <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="section-load-electrical">
                  <button type="button" onClick={() => toggleSection('load_m')} className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><Bolt className="h-4 w-4 text-emerald-600" />Load & Electrical Details<Badge variant="outline" className="ml-1 text-[9px]">prints on PDF</Badge></span>
                    {openSections.load_m ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {openSections.load_m && (
                    <div className="p-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Service Type *</Label>
                          <Select value={formData.electrical.service_type || ''} onValueChange={(v) => setFormData(p => ({ ...p, electrical: { ...p.electrical, service_type: v } }))}>
                            <SelectTrigger className="h-10" data-testid="electrical-service-type-select"><SelectValue placeholder="LT Domestic / Commercial / Industrial..." /></SelectTrigger>
                            <SelectContent>{SERVICE_CATEGORY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Connection Phase</Label>
                          <Select value={formData.electrical.connection_phase || ''} onValueChange={(v) => setFormData(p => ({ ...p, electrical: { ...p.electrical, connection_phase: v } }))}>
                            <SelectTrigger className="h-10" data-testid="electrical-connection-phase-select"><SelectValue placeholder="Single Phase / Three Phase" /></SelectTrigger>
                            <SelectContent>{CONNECTION_PHASE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Sanctioned Load (kW)</Label>
                          <Input type="number" inputMode="decimal" step="0.1" min="0"
                            value={formData.electrical.sanction_load_kw}
                            onChange={(e) => setFormData(p => ({ ...p, electrical: { ...p.electrical, sanction_load_kw: e.target.value } }))}
                            placeholder="e.g., 3" className="h-10" data-testid="electrical-sanction-load-input" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Connected Load (kW)</Label>
                          <Input type="number" inputMode="decimal" step="0.1" min="0"
                            value={formData.electrical.connected_load_kw}
                            onChange={(e) => setFormData(p => ({ ...p, electrical: { ...p.electrical, connected_load_kw: e.target.value } }))}
                            placeholder="e.g., 4.5" className="h-10" data-testid="electrical-connected-load-input" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Monthly Consumption (units)</Label>
                          <Input type="number" inputMode="numeric" step="1" min="0"
                            value={formData.electrical.monthly_consumption_units}
                            onChange={(e) => setFormData(p => ({ ...p, electrical: { ...p.electrical, monthly_consumption_units: e.target.value } }))}
                            placeholder="e.g., 400" className="h-10" data-testid="electrical-monthly-consumption-input" />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs flex items-center gap-1.5">
                          EB Tariff (₹ / unit)
                          {formData.electrical._prefilled?.eb_tariff && <Badge variant="outline" className="text-[9px] border-blue-300 text-blue-700">prefilled — editable</Badge>}
                        </Label>
                        <Input type="number" inputMode="decimal" step="0.1" min="0"
                          value={formData.electrical.eb_tariff}
                          onChange={(e) => setFormData(p => ({ ...p, electrical: { ...p.electrical, eb_tariff: e.target.value, _prefilled: { ...(p.electrical._prefilled || {}), eb_tariff: false } } }))}
                          placeholder="e.g., 7.5 — auto-prefills from DISCOM" className={`h-10 ${formData.electrical._prefilled?.eb_tariff ? 'bg-blue-50/50' : ''}`} data-testid="electrical-eb-tariff-input" />
                      </div>

                      <div className="pt-3 border-t border-slate-100 space-y-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Wiring runs — stored in metres, prints on PDF as metres</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Cable Length (roof → DB)</Label>
                            <div className="flex gap-2">
                              <Input type="number" inputMode="decimal" step="0.1" min="0"
                                value={formData.additional.cable_length_meters}
                                onChange={(e) => setFormData(p => ({ ...p, additional: { ...p.additional, cable_length_meters: e.target.value } }))}
                                placeholder="e.g., 15" className="h-10 flex-1" data-testid="additional-cable-length-input" />
                              <Select value={formData.additional.cable_length_unit || 'm'} onValueChange={(v) => setFormData(p => ({ ...p, additional: { ...p.additional, cable_length_unit: v } }))}>
                                <SelectTrigger className="h-10 w-20" data-testid="additional-cable-length-unit-select"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="m">m</SelectItem><SelectItem value="ft">ft</SelectItem></SelectContent>
                              </Select>
                            </div>
                            {formData.additional.cable_length_unit === 'ft' && (
                              <p className="text-[10px] text-slate-400">= {toMetres(formData.additional.cable_length_meters, 'ft')} m (stored)</p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Inverter → Panel Distance</Label>
                            <div className="flex gap-2">
                              <Input type="number" inputMode="decimal" step="0.1" min="0"
                                value={formData.additional.inverter_to_panel_distance}
                                onChange={(e) => setFormData(p => ({ ...p, additional: { ...p.additional, inverter_to_panel_distance: e.target.value } }))}
                                placeholder="e.g., 3" className="h-10 flex-1" data-testid="additional-inverter-panel-distance-input" />
                              <Select value={formData.additional.inverter_to_panel_unit || 'm'} onValueChange={(v) => setFormData(p => ({ ...p, additional: { ...p.additional, inverter_to_panel_unit: v } }))}>
                                <SelectTrigger className="h-10 w-20" data-testid="additional-inverter-panel-unit-select"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="m">m</SelectItem><SelectItem value="ft">ft</SelectItem></SelectContent>
                              </Select>
                            </div>
                            {formData.additional.inverter_to_panel_unit === 'ft' && (
                              <p className="text-[10px] text-slate-400">= {toMetres(formData.additional.inverter_to_panel_distance, 'ft')} m (stored)</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Inverter & Earthing */}
                <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="section-inverter">
                  <button type="button" onClick={() => toggleSection('inverter')} className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><Settings2 className="h-4 w-4 text-purple-500" />Inverter & Earthing</span>
                    {openSections.inverter ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {openSections.inverter && (
                    <div className="p-4 space-y-3">
                      <div className="space-y-1"><Label className="text-xs">Inverter Installation Location</Label><Input value={formData.site_measurements.inverter.location} onChange={(e) => updateMeasurement('inverter', 'location', e.target.value)} placeholder="e.g., Near main DB, ground floor" className="h-10" data-testid="inverter-location-input" /></div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Wall Space Available?</Label>
                          <Select value={formData.site_measurements.inverter.wall_space} onValueChange={(v) => updateMeasurement('inverter', 'wall_space', v)}>
                            <SelectTrigger className="h-10" data-testid="wall-space-select"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1"><Label className="text-xs">Existing Earthing?</Label>
                          <Select value={formData.site_measurements.inverter.earthing_available} onValueChange={(v) => updateMeasurement('inverter', 'earthing_available', v)}>
                            <SelectTrigger className="h-10" data-testid="earthing-available-select"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1"><Label className="text-xs">Distance to Earthing (ft)</Label><Input type="number" step="0.1" min="0" value={formData.site_measurements.inverter.earthing_distance} onChange={(e) => updateMeasurement('inverter', 'earthing_distance', e.target.value)} placeholder="e.g., 15" className="h-10" data-testid="earthing-distance-input" /></div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Access & Safety */}
                <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="section-access">
                  <button type="button" onClick={() => toggleSection('access')} className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><HardHat className="h-4 w-4 text-teal-500" />Access & Safety</span>
                    {openSections.access ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </button>
                  {openSections.access && (
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Roof Access Type</Label>
                          <Select value={formData.site_measurements.access.type} onValueChange={(v) => updateMeasurement('access', 'type', v)}>
                            <SelectTrigger className="h-10" data-testid="access-type-select"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent><SelectItem value="Stairs">Stairs</SelectItem><SelectItem value="Ladder">Ladder</SelectItem><SelectItem value="Direct">Direct Access</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1"><Label className="text-xs">Working Space Available?</Label>
                          <Select value={formData.site_measurements.access.working_space} onValueChange={(v) => updateMeasurement('access', 'working_space', v)}>
                            <SelectTrigger className="h-10" data-testid="working-space-select"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem></SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1"><Label className="text-xs">Safety Notes</Label><Textarea rows={2} value={formData.site_measurements.access.notes} onChange={(e) => updateMeasurement('access', 'notes', e.target.value)} placeholder="Any safety observations..." className="min-h-[60px]" data-testid="safety-notes-input" /></div>
                    </div>
                  )}
                </div>

                {renderExtraFields('site_electrical')}

              </div>
            )}

            {/* Step: Materials */}
            {/* Step: Materials → Proposed Solution & Materials */}
            {STEPS[currentStep - 1]?.slug === 'materials' && (
              <div className="space-y-5">
                {/* Combined Proposed Solution + Solar Calculator (manual inputs + live metrics) */}
                <ProposedSolutionSection
                  value={formData.custom_fields?.proposed_solution}
                  onChange={(ps) => setFormData(prev => ({
                    ...prev,
                    custom_fields: { ...(prev.custom_fields || {}), proposed_solution: ps },
                    // Keep legacy solar_system fields in sync for any downstream code that still reads them
                    solar_system: {
                      ...prev.solar_system,
                      system_type: ps?.system_type || prev.solar_system?.system_type,
                      battery_required: (ps?.system_type === 'hybrid' || ps?.system_type === 'off-grid')
                    },
                    // Mirror PIN/DISCOM back into LocationDetails so the DB stores it
                    location: {
                      ...(prev.location || {}),
                      pincode: ps?.pincode || prev.location?.pincode,
                      district: ps?.district || prev.location?.district,
                      state: ps?.state || prev.location?.state,
                      discom_id: ps?.discom_id || prev.location?.discom_id,
                    },
                    // Persist the server-computed snapshot so this quote can be reproduced later
                    calculation_snapshot: ps?._server_snapshot || prev.calculation_snapshot,
                  }))}
                />

                {/* ═════ Material Kit Suggestion ═════ */}
                {suggestedKit && !kitDismissed && appliedKitId !== suggestedKit.id && (
                  <div className="rounded-lg border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-white p-4" data-testid="kit-suggestion">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                          <Layers className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs uppercase tracking-wider text-emerald-700 font-semibold">Matched Solution Kit</p>
                          <p className="font-semibold text-slate-900 text-sm truncate">{suggestedKit.name}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{suggestedKit.lines.length} material lines · fits your {suggestedKit.system_type} @ {suggestedKit.capacity_kw} kW</p>
                          {suggestedKit.description && <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{suggestedKit.description}</p>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <Button type="button" size="sm" onClick={() => applyKit(suggestedKit)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 h-9" data-testid="apply-kit-btn">
                          <Wand2 className="h-3.5 w-3.5" /> Apply Kit
                        </Button>
                        <button type="button" onClick={() => setKitDismissed(true)} className="text-[10px] text-slate-500 hover:text-slate-700" data-testid="dismiss-kit-btn">
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {appliedKitId && suggestedKit?.id === appliedKitId && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 flex items-center gap-2" data-testid="kit-applied-banner">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs text-emerald-800 flex-1">Applied kit: <strong>{suggestedKit.name}</strong>. Adjust quantities or add more items below.</span>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAppliedKitId(null); setFormData(prev => ({ ...prev, selected_items: [] })); }} data-testid="clear-kit-btn">
                      <RefreshCw className="h-3 w-3 mr-1" /> Clear
                    </Button>
                  </div>
                )}
                {/* Kit browser (compact) */}
                <details className="rounded-lg border border-slate-200 bg-white" data-testid="kit-browser">
                  <summary className="px-3 py-2 cursor-pointer flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Layers className="h-3.5 w-3.5 text-emerald-600" /> Browse all kits ({availableKits.length})
                  </summary>
                  <div className="p-2 max-h-56 overflow-y-auto space-y-1.5 border-t border-slate-200">
                    {availableKits.length === 0 && <p className="text-[11px] text-slate-400 px-2">No kits yet. Ask an admin to add kits from Inventory → Solution Kits.</p>}
                    {availableKits.map(k => (
                      <div key={k.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-slate-50">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-800 truncate">{k.name}</p>
                          <p className="text-[10px] text-slate-500">{k.system_type} · {k.capacity_kw} kW · {k.lines.length} lines</p>
                        </div>
                        <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={() => { applyKit(k); setKitDismissed(false); }} data-testid={`browse-apply-${k.id}`}>Apply</Button>
                      </div>
                    ))}
                  </div>
                </details>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Package className="h-4 w-4" />Add-ons & Extras</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">Optional extras on top of the core kit — safety, monitoring, civil work, service. Grouped on the customer PDF.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowAddCategory(true)} className="h-9 text-xs gap-1" data-testid="add-category-btn"><FolderPlus className="h-3.5 w-3.5" />Add Category</Button>
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

                  {/* Universal searchable combobox — replaces per-category dropdowns */}
                  <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2" data-testid="addons-searchbox">
                    <Label className="text-xs uppercase tracking-wider text-slate-500">Search all inventory</Label>
                    <Select onValueChange={(v) => addSelectedItem(v)}>
                      <SelectTrigger className="h-11" data-testid="addons-select-any"><SelectValue placeholder="Search by name / SKU / category..." /></SelectTrigger>
                      <SelectContent>
                        {inventoryItems.filter(i => i.quantity > 0 || true).map(item => {
                          const cat = categories.find(c => c.slug === item.category);
                          return (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} <span className="text-slate-400">· {cat?.name || item.category} · ₹{item.unit_price.toLocaleString('en-IN')} · Stock {item.quantity}</span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {/* Quick-add strip: 6 most recent items */}
                    {inventoryItems.length > 0 && (
                      <div className="pt-1">
                        <p className="text-[10px] uppercase text-slate-400 mb-1">Quick add</p>
                        <div className="flex flex-wrap gap-1.5">
                          {inventoryItems.slice(0, 6).map(item => (
                            <button
                              type="button"
                              key={item.id}
                              onClick={() => addSelectedItem(item.id)}
                              className="text-[11px] px-2 py-1 rounded-full border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 text-slate-600 flex items-center gap-1"
                              data-testid={`quick-add-${item.id}`}
                            >
                              <Plus className="h-3 w-3" />{item.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {formData.selected_items.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-2">Selected Items</h3>
                    <div className="space-y-2">
                      {formData.selected_items.map((item, idx) => (
                        <div key={item.inventory_item_id || `item-${idx}`} className="p-3 bg-slate-50 rounded-lg border border-slate-200" data-testid={`selected-item-${idx}`}>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm text-slate-900 truncate">{item.name}</p>
                              <p className="text-xs text-slate-500">{getCategoryLabel(item.category)} - ₹{item.unit_price.toLocaleString('en-IN')} x</p>
                            </div>
                            <Input type="number" min="1" value={item.quantity} onChange={(e) => updateSelectedItem(idx, 'quantity', parseInt(e.target.value) || 1)} className="w-16 h-9 text-center text-sm" data-testid={`item-qty-${idx}`} />
                            <span className="text-sm font-medium text-slate-900 w-24 text-right">₹{(item.unit_price * item.quantity).toLocaleString('en-IN')}</span>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={() => removeSelectedItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                          {canSetMargin && (
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
                              <Percent className="h-3.5 w-3.5 text-amber-600" />
                              <span className="text-xs text-amber-700 font-medium">Margin</span>
                              <Input type="number" min="0" max="100" step="0.5" value={item.margin_percentage} onChange={(e) => updateSelectedItem(idx, 'margin_percentage', parseFloat(e.target.value) || 0)} className="w-20 h-7 text-xs text-center" data-testid={`item-margin-${idx}`} />
                              <span className="text-xs text-slate-500">%</span>
                              {item.margin_percentage > 0 && <span className="text-xs text-amber-600 ml-auto">+₹{(item.unit_price * item.quantity * item.margin_percentage / 100).toLocaleString('en-IN')}</span>}
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
                    <div key={`manual-${idx}`} className="flex gap-2 mb-2" data-testid={`manual-cost-${idx}`}>
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
                      <div className="flex justify-between"><span className="text-slate-600">Items</span><span className="font-medium">₹{totals.itemsTotal.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between"><span className="text-slate-600">Manual</span><span className="font-medium">₹{totals.manualTotal.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between"><span className="text-slate-600">GST</span><span className="font-medium">₹{totals.gstTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
                      {canSetMargin && totals.marginTotal > 0 && <div className="flex justify-between text-amber-700"><span>Margin</span><span className="font-medium">₹{totals.marginTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>}
                      <div className="flex justify-between pt-2 border-t border-emerald-300"><span className="font-bold">Estimated Total</span><span className="font-bold text-emerald-700">₹{totals.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span></div>
                    </div>
                  </CardContent>
                </Card>
                {renderExtraFields('materials')}
              </div>
            )}

            {/* Dynamic Custom Tabs */}
            {STEPS[currentStep - 1] && !SYSTEM_SLUGS.includes(STEPS[currentStep - 1].slug) && (() => {
              const stepInfo = STEPS[currentStep - 1];
              if (!stepInfo?.slug) return null;
              const tabSlug = stepInfo.slug;
              const tabFields = stepInfo.fields || [];
              const tabData = formData.custom_fields?.[tabSlug] || {};
              const updateCustomField = (fieldName, value) => {
                setFormData(prev => ({
                  ...prev,
                  custom_fields: { ...prev.custom_fields, [tabSlug]: { ...(prev.custom_fields?.[tabSlug] || {}), [fieldName]: value } }
                }));
              };
              return (
                <div className="space-y-4" data-testid={`dynamic-tab-${tabSlug}`}>
                  {tabFields.map((field, fIdx) => (
                    <div key={field.name || fIdx} className="space-y-1.5">
                      <Label className="text-sm">{field.label}{field.required && ' *'}</Label>
                      {field.type === 'text' && (
                        <Input value={tabData[field.name] || ''} onChange={(e) => updateCustomField(field.name, e.target.value)} placeholder={field.placeholder} className="h-11" data-testid={`custom-field-${field.name}`} />
                      )}
                      {field.type === 'number' && (
                        <Input type="number" value={tabData[field.name] || ''} onChange={(e) => updateCustomField(field.name, e.target.value)} placeholder={field.placeholder} className="h-11" data-testid={`custom-field-${field.name}`} />
                      )}
                      {field.type === 'textarea' && (
                        <Textarea rows={3} value={tabData[field.name] || ''} onChange={(e) => updateCustomField(field.name, e.target.value)} placeholder={field.placeholder} className="min-h-[80px]" data-testid={`custom-field-${field.name}`} />
                      )}
                      {field.type === 'select' && (
                        <Select value={tabData[field.name] || ''} onValueChange={(v) => updateCustomField(field.name, v)}>
                          <SelectTrigger className="h-11" data-testid={`custom-field-${field.name}`}><SelectValue placeholder={field.placeholder || 'Select...'} /></SelectTrigger>
                          <SelectContent>{(field.options || []).map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      {field.type === 'checkbox' && (
                        <div className="flex items-center gap-2 pt-1">
                          <Checkbox id={`cf-${field.name}`} checked={!!tabData[field.name]} onCheckedChange={(c) => updateCustomField(field.name, !!c)} data-testid={`custom-field-${field.name}`} />
                          <Label htmlFor={`cf-${field.name}`} className="text-sm">{field.placeholder || field.label}</Label>
                        </div>
                      )}
                      {field.type === 'date' && (
                        <Input type="date" value={tabData[field.name] || ''} onChange={(e) => updateCustomField(field.name, e.target.value)} className="h-11" data-testid={`custom-field-${field.name}`} />
                      )}
                    </div>
                  ))}
                  {tabFields.length === 0 && <p className="text-sm text-slate-400 text-center py-8">This tab has no fields configured yet.</p>}
                </div>
              );
            })()}

            {/* Site Documentation */}
            {STEPS[currentStep - 1]?.slug === 'site_docs' && (
              <div className="space-y-5">
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-medium text-blue-800">Link your Google Drive folder containing site images and documentation for this project.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Folder Name *</Label>
                    {formData.customer.name && !formData.drive_folder_name && (
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, drive_folder_name: autoSuggestFolderName() }))}
                        className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                        data-testid="auto-suggest-folder-name"
                      >
                        <Sparkles className="h-3 w-3" /> Auto-suggest
                      </button>
                    )}
                  </div>
                  <Input
                    value={formData.drive_folder_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, drive_folder_name: e.target.value }))}
                    placeholder="Site_Visit_ClientName_April"
                    data-testid="drive-folder-name-input"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Google Drive Folder Link *</Label>
                  <div className="flex gap-2">
                    <Input
                      value={formData.drive_folder_link}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData(prev => ({ ...prev, drive_folder_link: val }));
                        if (val) validateDriveLink(val);
                        else setDriveLinkValid(null);
                      }}
                      placeholder="https://drive.google.com/drive/folders/xxxxx"
                      className={`flex-1 ${driveLinkValid === true ? 'border-emerald-400 ring-1 ring-emerald-200' : driveLinkValid === false ? 'border-red-400 ring-1 ring-red-200' : ''}`}
                      data-testid="drive-folder-link-input"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => validateDriveLink(formData.drive_folder_link)}
                      className={`shrink-0 gap-1.5 ${driveLinkValid === true ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                      data-testid="validate-drive-link-btn"
                    >
                      {driveLinkValid === true ? <><CheckCircle className="h-4 w-4" /> Valid</> : <><Link2 className="h-4 w-4" /> Validate</>}
                    </Button>
                  </div>
                  {driveLinkValid === false && (
                    <p className="text-xs text-amber-600">Warning: link doesn&apos;t match drive.google.com/drive/folders/ — you can still submit.</p>
                  )}
                  {driveLinkValid === true && (
                    <p className="text-xs text-emerald-600">Folder ID: {extractFolderId(formData.drive_folder_link)}</p>
                  )}
                </div>

                {formData.drive_folder_link && driveLinkValid && (
                  <div className="flex gap-2">
                    <a href={formData.drive_folder_link} target="_blank" rel="noopener noreferrer" className="flex-1">
                      <Button type="button" variant="outline" className="w-full gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50" data-testid="open-drive-folder-btn">
                        <ExternalLink className="h-4 w-4" /> Open Folder in Google Drive
                      </Button>
                    </a>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><FileText className="h-4 w-4 text-emerald-600" />Terms & Conditions Template</Label>
                  <Select 
                    value={formData.terms_id || 'none'} 
                    onValueChange={(v) => setFormData(prev => ({ ...prev, terms_id: v === 'none' ? '' : v }))}
                  >
                    <SelectTrigger className="h-11" data-testid="terms-select">
                      <SelectValue placeholder="Select T&C template (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Use default Standard Terms —</SelectItem>
                      {termsList.map(t => (
                        <SelectItem key={t.id} value={t.id} data-testid={`terms-option-${t.id}`}>
                          {t.title} (v{t.version}, {t.language === 'en' ? 'EN' : 'TA'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-slate-500">
                    {termsList.length === 0 
                      ? 'No templates yet — create one from the Terms & Conditions page.'
                      : 'This template will be embedded in the project quotation PDF.'}
                  </p>
                </div>

                <div className="space-y-2" data-testid="ref-site-section">
                  <Label className="flex items-center gap-2"><FolderOpen className="h-4 w-4 text-emerald-600" />Reference Site (optional)</Label>
                  {formData.reference_project_id ? (
                    (() => {
                      const ref = refCandidates.find(r => r.id === formData.reference_project_id);
                      if (!ref) return (
                        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                          <span className="text-sm text-slate-600">Reference project loaded</span>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setFormData(prev => ({ ...prev, reference_project_id: '' }))} data-testid="ref-site-clear-fallback">Change</Button>
                        </div>
                      );
                      return (
                        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/60 flex items-start gap-3" data-testid="ref-site-selected">
                          {ref.image_url
                            ? <img src={ref.image_url} alt="" className="w-16 h-16 rounded object-cover border border-emerald-200" />
                            : <div className="w-16 h-16 rounded bg-emerald-100 flex items-center justify-center text-emerald-600"><FolderOpen className="h-6 w-6" /></div>}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-emerald-900 truncate">{ref.customer_name || ref.name} <span className="text-[10px] text-emerald-600">({ref.reference_number})</span></p>
                            <p className="text-[11px] text-emerald-700 truncate">{ref.location || '—'}</p>
                            <p className="text-[11px] text-emerald-700">Size: <strong>{ref.system_size_kw ? `${ref.system_size_kw} kW` : '—'}</strong> · Payback: <strong>{ref.metrics?.payback_years ? `${Number(ref.metrics.payback_years).toFixed(1)} yrs` : '—'}</strong> · ROI: <strong>{ref.metrics?.roi_pct ? `${Math.round(ref.metrics.roi_pct)}%` : '—'}</strong></p>
                            {ref.till_date && (ref.till_date.savings_inr > 0 || ref.till_date.units_generated > 0) && (
                              <p className="text-[11px] text-emerald-800 mt-1" data-testid="ref-site-till-date">
                                <strong>Live snapshot:</strong> ₹{Math.round(ref.till_date.savings_inr).toLocaleString('en-IN')} saved · {Math.round(ref.till_date.units_generated).toLocaleString('en-IN')} units · {ref.till_date.years_elapsed.toFixed(1)} yrs running
                              </p>
                            )}
                          </div>
                          <Button type="button" size="sm" variant="outline" onClick={() => setFormData(prev => ({ ...prev, reference_project_id: '' }))} data-testid="ref-site-clear">Change</Button>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="space-y-2">
                      <Input
                        type="text"
                        value={refSearch}
                        onChange={(e) => setRefSearch(e.target.value)}
                        placeholder="Search completed projects by customer, location or reference no…"
                        className="h-10"
                        data-testid="ref-site-search"
                      />
                      <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100" data-testid="ref-site-list">
                        {refCandidates
                          .filter(r => {
                            if (!refSearch.trim()) return true;
                            const q = refSearch.toLowerCase();
                            return [r.customer_name, r.name, r.location, r.reference_number]
                              .filter(Boolean).some(s => String(s).toLowerCase().includes(q));
                          })
                          .slice(0, 20)
                          .map(r => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => setFormData(prev => ({ ...prev, reference_project_id: r.id }))}
                              className="w-full px-3 py-2 hover:bg-emerald-50 transition-colors flex items-center gap-3 text-left"
                              data-testid={`ref-site-item-${r.id}`}
                            >
                              {r.image_url
                                ? <img src={r.image_url} alt="" className="w-10 h-10 rounded object-cover border border-slate-200 shrink-0" />
                                : <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center text-slate-400 shrink-0"><FolderOpen className="h-4 w-4" /></div>}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{r.customer_name || r.name} <span className="text-[10px] text-slate-500">({r.reference_number})</span></p>
                                <p className="text-[11px] text-slate-500 truncate">{r.location || '—'} · {r.system_size_kw ? `${r.system_size_kw} kW` : 'size n/a'}</p>
                              </div>
                            </button>
                          ))}
                        {refCandidates.length === 0 && <p className="px-3 py-3 text-xs text-slate-400">No completed projects yet.</p>}
                      </div>
                      <p className="text-[11px] text-slate-500">Attach a similar finished project. Its actual savings + ROI will be added to the customer&apos;s quotation PDF as social proof.</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="install-dates-section">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-xs">Installation Date <span className="text-slate-400 font-normal">(optional)</span></Label>
                    <Input
                      type="date"
                      value={formData.installation_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, installation_date: e.target.value }))}
                      className="h-10"
                      data-testid="install-date-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-xs">Commissioning Date <span className="text-slate-400 font-normal">(optional)</span></Label>
                    <Input
                      type="date"
                      value={formData.commissioning_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, commissioning_date: e.target.value }))}
                      className="h-10"
                      data-testid="commission-date-input"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 col-span-full">Once filled, the system uses these dates to auto-calculate &ldquo;savings till date&rdquo;, units generated, CO₂ offset and fuel saved — useful when this project is later picked as a Reference Site for a future quote.</p>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-600" />Notes</Label>
                  <Textarea
                    rows={3}
                    value={formData.notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Any general notes about this project — shadow observations, customer remarks, follow-ups, special instructions..."
                    className="min-h-[80px]"
                    data-testid="project-notes-input"
                  />
                  <p className="text-[11px] text-slate-500">You can keep editing these notes (and append timestamped updates) from the project details page even after the project is completed.</p>
                </div>
                {renderExtraFields('site_docs')}
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-6 pt-4 border-t border-slate-200 sticky bottom-0 bg-white pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6 sm:static sm:bg-transparent sm:pb-0">
              <Button type="button" variant="outline" onClick={prevStep} disabled={currentStep === 1} className="gap-2 h-12" data-testid="prev-step-btn"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Previous</span><span className="sm:hidden">Back</span></Button>
              {currentStep < totalSteps ? (
                <Button type="button" onClick={nextStep} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-12" data-testid="next-step-btn">Next <ArrowRight className="h-4 w-4" /></Button>
              ) : (
                <Button type="button" onClick={() => { if (validateStep()) setShowReview(true); }} disabled={loading} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-12" data-testid="submit-project-btn">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin" />{isEditMode ? 'Saving...' : 'Creating...'}</> : <><CheckCircle2 className="h-4 w-4" />Review &amp; {isEditMode ? 'Save' : 'Create'}</>}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ═════ Review & Submit Dialog ═════ */}
        <Dialog open={showReview} onOpenChange={setShowReview}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="review-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Review Project Summary</DialogTitle>
              <DialogDescription>Confirm the key details below. You can go back to edit any step, or submit to create the project.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm" data-testid="review-summary">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Customer</p>
                <p className="font-medium text-slate-900">{formData.customer.name || '—'}</p>
                <p className="text-xs text-slate-500">{formData.customer.phone} · {formData.customer.email || 'no email'}</p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{formData.customer.address}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Location</p>
                <p className="text-xs text-slate-800 truncate">{formData.location.address || formData.location.site_location_words || '—'}</p>
                {(formData.location.latitude && formData.location.longitude) && <p className="text-[11px] text-slate-500">{Number(formData.location.latitude).toFixed(4)}, {Number(formData.location.longitude).toFixed(4)}</p>}
                {formData.location.pincode && formData.location.district ? (
                  <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1" data-testid="review-location-verified">
                    <CheckCircle className="h-3 w-3" /> Location Verified · {formData.location.pincode} · {formData.location.district}, {formData.location.state}
                  </p>
                ) : formData.location.pincode ? (
                  <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> PIN {formData.location.pincode} — district not resolved</p>
                ) : null}
              </div>
              {(() => {
                const ps = formData.custom_fields?.proposed_solution || {};
                if (!ps.system_type) return null;
                return (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">Proposed Solution</p>
                    <p className="text-xs text-slate-800"><strong>{ps.system_type}</strong> · {ps.system_size_kw ? `${ps.system_size_kw} kW` : '—'} · {ps.panel_count || '—'} panels</p>
                    {ps._derived?.annual_savings > 0 && (
                      <p className="text-[11px] text-emerald-700 mt-0.5">
                        Annual Savings: ₹{Math.round(ps._derived.annual_savings).toLocaleString('en-IN')} · Payback: {ps._derived.payback_years?.toFixed(1)} yrs · ROI: {Math.round(ps._derived.roi_pct || 0)}%
                      </p>
                    )}
                    {ps.system_type === 'solar-pump' && (
                      <p className="text-[11px] text-slate-600 mt-0.5">{ps.pump_hp || '—'} HP · {ps.pump_type} · Head {ps.pump_head_m || '—'}m · {ps.pump_discharge_lph || '—'} LPH</p>
                    )}
                  </div>
                );
              })()}
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Materials</p>
                <p className="text-xs text-slate-800">{formData.selected_items.length} items selected {appliedKitId && suggestedKit ? `(from kit: ${suggestedKit.name})` : ''}</p>
                <p className="text-[11px] text-slate-500">Total: ₹{totals.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Documentation</p>
                <p className="text-xs text-slate-800">Drive: {formData.drive_folder_link ? '✓ linked' : '— not set'} · T&amp;C: {formData.terms_id ? '✓ selected' : '— default'} · Reference: {formData.reference_project_id ? '✓ attached' : '— none'}</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReview(false)} disabled={loading} data-testid="review-back-btn">Back to Edit</Button>
              <Button onClick={async () => { await handleSubmit(); if (!error) { try { localStorage.removeItem('site_visit_draft'); } catch { /* ignore */ } } setShowReview(false); }} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="review-submit-btn">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Submitting...</> : <><CheckCircle2 className="h-4 w-4 mr-1" />{isEditMode ? 'Save Changes' : 'Create Project'}</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
