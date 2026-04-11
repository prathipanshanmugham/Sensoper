import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formTabsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import {
  ArrowLeft, Plus, Trash2, GripVertical, Pencil, ChevronUp, ChevronDown,
  Save, X, Loader2, ToggleLeft, ToggleRight, Eye, EyeOff, Layers
} from 'lucide-react';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' }
];

const ROLES = ['admin', 'manager', 'staff'];

function FieldEditor({ field, index, onChange, onRemove }) {
  const updateField = (key, value) => onChange(index, { ...field, [key]: value });

  return (
    <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-3" data-testid={`field-editor-${index}`}>
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 text-slate-300 mt-2.5 shrink-0" />
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Field Label *</Label>
            <Input value={field.label} onChange={(e) => updateField('label', e.target.value)} placeholder="e.g., Subsidy Amount" className="h-9" data-testid={`field-label-${index}`} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Field Name (slug) *</Label>
            <Input value={field.name} onChange={(e) => updateField('name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} placeholder="e.g., subsidy_amount" className="h-9 font-mono text-xs" data-testid={`field-name-${index}`} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={field.type} onValueChange={(v) => updateField('type', v)}>
              <SelectTrigger className="h-9" data-testid={`field-type-${index}`}><SelectValue /></SelectTrigger>
              <SelectContent>{FIELD_TYPES.map(ft => <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9 text-red-500 shrink-0" onClick={() => onRemove(index)} data-testid={`remove-field-${index}`}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Placeholder</Label>
          <Input value={field.placeholder || ''} onChange={(e) => updateField('placeholder', e.target.value)} placeholder="Placeholder text" className="h-9" data-testid={`field-placeholder-${index}`} />
        </div>
        <div className="flex items-end gap-4 pb-1">
          <div className="flex items-center gap-2">
            <Checkbox id={`req-${index}`} checked={field.required} onCheckedChange={(c) => updateField('required', !!c)} data-testid={`field-required-${index}`} />
            <Label htmlFor={`req-${index}`} className="text-xs">Required</Label>
          </div>
        </div>
      </div>
      {field.type === 'select' && (
        <div className="ml-6 space-y-1">
          <Label className="text-xs">Options (comma-separated)</Label>
          <Input value={(field.options || []).join(', ')} onChange={(e) => updateField('options', e.target.value.split(',').map(o => o.trim()).filter(Boolean))} placeholder="Option 1, Option 2, Option 3" className="h-9" data-testid={`field-options-${index}`} />
        </div>
      )}
    </div>
  );
}

export default function FormTabsManager() {
  const navigate = useNavigate();
  const [tabs, setTabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingTab, setEditingTab] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');

  const emptyTab = { name: '', fields: [{ name: '', label: '', type: 'text', required: false, placeholder: '', options: [] }], roles_visible: ['admin', 'manager', 'staff'] };

  const [formState, setFormState] = useState(emptyTab);

  const fetchTabs = useCallback(async () => {
    try {
      const res = await formTabsAPI.getAll();
      setTabs(res.data);
    } catch (err) {
      console.error('Failed to load form tabs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTabs(); }, [fetchTabs]);

  const addField = () => {
    setFormState(prev => ({ ...prev, fields: [...prev.fields, { name: '', label: '', type: 'text', required: false, placeholder: '', options: [] }] }));
  };

  const updateFieldAt = (idx, field) => {
    setFormState(prev => {
      const fields = [...prev.fields];
      fields[idx] = field;
      return { ...prev, fields };
    });
  };

  const removeFieldAt = (idx) => {
    setFormState(prev => ({ ...prev, fields: prev.fields.filter((_, i) => i !== idx) }));
  };

  const toggleRole = (role) => {
    setFormState(prev => {
      const roles = prev.roles_visible.includes(role) ? prev.roles_visible.filter(r => r !== role) : [...prev.roles_visible, role];
      return { ...prev, roles_visible: roles };
    });
  };

  const validateForm = () => {
    if (!formState.name.trim()) { setError('Tab name is required'); return false; }
    if (formState.fields.length === 0) { setError('Add at least one field'); return false; }
    for (const f of formState.fields) {
      if (!f.label.trim() || !f.name.trim()) { setError('All fields must have a label and name'); return false; }
      if (f.type === 'select' && (!f.options || f.options.length === 0)) { setError(`Field "${f.label}" needs dropdown options`); return false; }
    }
    setError('');
    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      if (editingTab) {
        await formTabsAPI.update(editingTab.id, formState);
      } else {
        await formTabsAPI.create(formState);
      }
      setShowCreate(false);
      setEditingTab(null);
      setFormState(emptyTab);
      await fetchTabs();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save tab');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (tab) => {
    setEditingTab(tab);
    setFormState({ name: tab.name, fields: tab.fields || [], roles_visible: tab.roles_visible || ['admin', 'manager', 'staff'] });
    setShowCreate(true);
    setError('');
  };

  const handleDelete = async (tab) => {
    if (!window.confirm(`Delete tab "${tab.name}"? This won't remove data from existing projects.`)) return;
    try {
      await formTabsAPI.delete(tab.id);
      await fetchTabs();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete tab');
    }
  };

  const handleToggleActive = async (tab) => {
    try {
      await formTabsAPI.update(tab.id, { active: !tab.active });
      await fetchTabs();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to toggle tab');
    }
  };

  const handleMoveTab = async (idx, direction) => {
    const newTabs = [...tabs];
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= newTabs.length) return;
    [newTabs[idx], newTabs[swapIdx]] = [newTabs[swapIdx], newTabs[idx]];
    setTabs(newTabs);
    try {
      await formTabsAPI.reorder(newTabs.map(t => t.id));
    } catch (err) {
      console.error('Reorder failed:', err);
      await fetchTabs();
    }
  };

  const handleCancel = () => {
    setShowCreate(false);
    setEditingTab(null);
    setFormState(emptyTab);
    setError('');
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} data-testid="back-btn"><ArrowLeft className="h-5 w-5" /></Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="page-title">Form Tab Builder</h1>
            <p className="text-sm text-slate-500">Add custom tabs to the project creation form</p>
          </div>
          {!showCreate && (
            <Button onClick={() => { setShowCreate(true); setEditingTab(null); setFormState(emptyTab); setError(''); }} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="create-tab-btn">
              <Plus className="h-4 w-4" />New Tab
            </Button>
          )}
        </div>

        {error && <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg" data-testid="form-tabs-error">{error}</div>}

        {showCreate && (
          <Card className="border-emerald-200 shadow-lg mb-6" data-testid="tab-editor-card">
            <CardHeader className="border-b border-slate-200 py-4">
              <CardTitle className="font-['Outfit'] text-lg">{editingTab ? 'Edit Tab' : 'Create New Tab'}</CardTitle>
              <CardDescription className="text-sm">Configure the tab name, fields, field types, mandatory rules, and role visibility</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tab Name *</Label>
                  <Input value={formState.name} onChange={(e) => setFormState(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g., Subsidy Details" className="h-11" data-testid="tab-name-input" />
                </div>
                <div className="space-y-2">
                  <Label>Visible to Roles</Label>
                  <div className="flex gap-3 pt-1">
                    {ROLES.map(role => (
                      <div key={role} className="flex items-center gap-1.5">
                        <Checkbox id={`role-${role}`} checked={formState.roles_visible.includes(role)} onCheckedChange={() => toggleRole(role)} data-testid={`role-${role}-checkbox`} />
                        <Label htmlFor={`role-${role}`} className="text-sm capitalize">{role}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-base font-semibold">Fields</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addField} className="h-8 text-xs gap-1" data-testid="add-field-btn"><Plus className="h-3.5 w-3.5" />Add Field</Button>
                </div>
                <div className="space-y-2">
                  {formState.fields.map((field, idx) => (
                    <FieldEditor key={`field-${idx}`} field={field} index={idx} onChange={updateFieldAt} onRemove={removeFieldAt} />
                  ))}
                  {formState.fields.length === 0 && (
                    <p className="text-center text-sm text-slate-400 py-8">No fields yet. Click "Add Field" to start.</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <Button variant="outline" onClick={handleCancel} className="gap-2" data-testid="cancel-tab-btn"><X className="h-4 w-4" />Cancel</Button>
                <Button onClick={handleSave} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="save-tab-btn">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{editingTab ? 'Update Tab' : 'Create Tab'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {tabs.length === 0 && !showCreate ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-3" data-testid="tabs-list">
            {tabs.map((tab, idx) => (
              <Card key={tab.id || tab.slug} className={`border-slate-200 ${!tab.active ? 'opacity-60' : ''} ${tab.system ? 'border-l-4 border-l-emerald-400' : ''}`} data-testid={`tab-card-${tab.slug}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => handleMoveTab(idx, -1)} disabled={idx === 0} className="text-slate-400 hover:text-slate-600 disabled:opacity-30" data-testid={`move-up-${tab.slug}`}><ChevronUp className="h-4 w-4" /></button>
                      <button onClick={() => handleMoveTab(idx, 1)} disabled={idx === tabs.length - 1} className="text-slate-400 hover:text-slate-600 disabled:opacity-30" data-testid={`move-down-${tab.slug}`}><ChevronDown className="h-4 w-4" /></button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900">{tab.name}</h3>
                        {tab.system ? (
                          <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200">System</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">{tab.fields?.length || 0} fields</Badge>
                        )}
                        {!tab.active && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {(tab.roles_visible || []).map(role => (
                          <span key={role} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded capitalize">{role}</span>
                        ))}
                        <span className="text-[10px] text-slate-400 font-mono">slug: {tab.slug}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!tab.system && (
                        <>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggleActive(tab)} title={tab.active ? 'Deactivate' : 'Activate'} data-testid={`toggle-${tab.slug}`}>
                            {tab.active ? <ToggleRight className="h-4 w-4 text-emerald-600" /> : <ToggleLeft className="h-4 w-4 text-slate-400" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(tab)} data-testid={`edit-${tab.slug}`}><Pencil className="h-3.5 w-3.5 text-blue-600" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(tab)} data-testid={`delete-${tab.slug}`}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
