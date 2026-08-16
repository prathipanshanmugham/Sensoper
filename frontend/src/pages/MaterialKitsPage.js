import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { materialKitsAPI, inventoryAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import {
  ArrowLeft, Plus, Edit, Trash2, Loader2, Package, Zap, X, Wand2, Layers
} from 'lucide-react';

const SYSTEM_TYPES = [
  { value: 'on-grid', label: 'On-Grid', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { value: 'off-grid', label: 'Off-Grid', color: 'bg-orange-100 text-orange-700 border-orange-300' },
  { value: 'hybrid', label: 'Hybrid', color: 'bg-violet-100 text-violet-700 border-violet-300' },
  { value: 'solar-pump', label: 'Solar Pump', color: 'bg-cyan-100 text-cyan-700 border-cyan-300' }
];

const blankKit = {
  name: '', system_type: 'on-grid',
  capacity_kw: 3, capacity_min_kw: 2, capacity_max_kw: 4,
  description: '', lines: [], active: true
};

export default function MaterialKitsPage() {
  const [kits, setKits] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterSystem, setFilterSystem] = useState('all');
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankKit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(false);

  const fetchKits = useCallback(async () => {
    try {
      const [kitsRes, invRes] = await Promise.all([
        materialKitsAPI.getAll(),
        inventoryAPI.getItems()
      ]);
      setKits(kitsRes.data || []);
      setInventoryItems(invRes.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchKits(); }, [fetchKits]);

  const openDialog = (kit = null) => {
    setError('');
    if (kit) {
      setEditing(kit);
      setForm({
        name: kit.name || '',
        system_type: kit.system_type || 'on-grid',
        capacity_kw: kit.capacity_kw ?? 0,
        capacity_min_kw: kit.capacity_min_kw ?? '',
        capacity_max_kw: kit.capacity_max_kw ?? '',
        description: kit.description || '',
        lines: kit.lines || [],
        active: kit.active !== false
      });
    } else {
      setEditing(null);
      setForm({ ...blankKit });
    }
    setShowDialog(true);
  };

  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, { name: '', category: '', quantity: 1, qty_formula: '', inventory_item_id: null }] }));
  const updateLine = (i, field, val) => setForm(f => {
    const lines = [...f.lines];
    lines[i] = { ...lines[i], [field]: val };
    return { ...f, lines };
  });
  const removeLine = (i) => setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));
  const pickInvItem = (i, itemId) => {
    const inv = inventoryItems.find(x => x.id === itemId);
    if (!inv) return;
    updateLine(i, 'inventory_item_id', inv.id);
    updateLine(i, 'name', inv.name);
    updateLine(i, 'category', inv.category);
  };

  const save = async () => {
    if (!form.name.trim()) { setError('Kit name is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        capacity_kw: parseFloat(form.capacity_kw) || 0,
        capacity_min_kw: form.capacity_min_kw === '' ? null : parseFloat(form.capacity_min_kw),
        capacity_max_kw: form.capacity_max_kw === '' ? null : parseFloat(form.capacity_max_kw),
        lines: form.lines.map(l => ({
          inventory_item_id: l.inventory_item_id || null,
          name: l.name, category: l.category || null,
          quantity: parseFloat(l.quantity) || 1,
          qty_formula: l.qty_formula || null,
          notes: l.notes || null
        }))
      };
      if (editing) await materialKitsAPI.update(editing.id, payload);
      else await materialKitsAPI.create(payload);
      setShowDialog(false);
      fetchKits();
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || 'Save failed');
    } finally { setSaving(false); }
  };

  const remove = async (kit) => {
    if (!window.confirm(`Delete kit "${kit.name}"?`)) return;
    try { await materialKitsAPI.remove(kit.id); fetchKits(); }
    catch (e) { alert(formatApiErrorDetail(e.response?.data?.detail) || 'Delete failed'); }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await materialKitsAPI.seedStarter();
      alert(`Seeded ${r.data.created} new kit(s). Total in library: ${r.data.total}`);
      fetchKits();
    } catch (e) { alert('Seed failed'); }
    finally { setSeeding(false); }
  };

  const shown = kits.filter(k => filterSystem === 'all' || k.system_type === filterSystem);
  const meta = (t) => SYSTEM_TYPES.find(s => s.value === t) || { label: t, color: 'bg-slate-100 text-slate-600' };

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Link to="/dashboard/inventory"><Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold font-['Outfit'] text-slate-900">Solution Kits</h1>
              <p className="text-sm text-slate-500">{kits.length} pre-configured Material Kits · Auto-match by system + capacity</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={seed} disabled={seeding} className="h-11" data-testid="seed-kits-btn">
              {seeding ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />} Seed Starter Kits
            </Button>
            <Button onClick={() => openDialog()} className="bg-emerald-600 hover:bg-emerald-700 text-white h-11" data-testid="add-kit-btn">
              <Plus className="h-4 w-4 mr-1" /> New Kit
            </Button>
          </div>
        </div>

        <Card className="border-slate-200 mb-4">
          <CardContent className="p-3 sm:p-4 flex flex-wrap gap-2">
            {['all', ...SYSTEM_TYPES.map(s => s.value)].map(v => (
              <button
                key={v}
                onClick={() => setFilterSystem(v)}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${filterSystem === v ? 'bg-emerald-600 border-emerald-700 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                data-testid={`filter-${v}`}
              >
                {v === 'all' ? 'All Systems' : meta(v).label}
              </button>
            ))}
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
        ) : shown.length === 0 ? (
          <Card className="border-slate-200"><CardContent className="py-12 text-center">
            <Layers className="h-12 w-12 mx-auto mb-4 text-slate-300" />
            <p className="text-slate-500 mb-3">No kits yet.</p>
            <Button onClick={seed} variant="outline" disabled={seeding}><Wand2 className="h-4 w-4 mr-1" /> Seed 8 starter kits</Button>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="kits-grid">
            {shown.map(k => (
              <Card key={k.id} className="border-slate-200 hover:shadow-md transition-shadow" data-testid={`kit-card-${k.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">{k.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge className={`text-[10px] border ${meta(k.system_type).color}`}>{meta(k.system_type).label}</Badge>
                        <span className="text-[11px] text-slate-500">
                          {k.capacity_kw} kW
                          {(k.capacity_min_kw !== null && k.capacity_max_kw !== null) && ` (${k.capacity_min_kw}-${k.capacity_max_kw} kW)`}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openDialog(k)} data-testid={`edit-kit-${k.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => remove(k)} data-testid={`delete-kit-${k.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  {k.description && <p className="text-[11px] text-slate-500 mb-2 line-clamp-2">{k.description}</p>}
                  <div className="border-t border-slate-100 pt-2 mt-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{k.lines.length} lines</p>
                    <ul className="text-[11px] text-slate-600 space-y-0.5 max-h-32 overflow-y-auto">
                      {k.lines.map((l, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <Package className="h-3 w-3 mt-0.5 text-slate-400 shrink-0" />
                          <span className="flex-1 min-w-0"><span className="truncate">{l.name}</span> <span className="text-slate-400">× {l.quantity}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Editor Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="kit-editor-dialog">
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Kit' : 'New Material Kit'}</DialogTitle>
              <DialogDescription>Configure pre-set material lines that auto-populate for a matching system type &amp; capacity.</DialogDescription>
            </DialogHeader>

            {error && <div className="p-2.5 text-sm text-red-600 bg-red-50 border border-red-200 rounded" data-testid="kit-error">{error}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Kit Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., On-Grid Starter · 3 kW" data-testid="kit-name-input" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">System Type *</Label>
                <Select value={form.system_type} onValueChange={v => setForm(f => ({ ...f, system_type: v }))}>
                  <SelectTrigger data-testid="kit-system-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SYSTEM_TYPES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nominal Capacity (kW) *</Label>
                <Input type="number" step="0.1" value={form.capacity_kw} onChange={e => setForm(f => ({ ...f, capacity_kw: e.target.value }))} data-testid="kit-capacity-input" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Range Min (kW)</Label>
                <Input type="number" step="0.1" value={form.capacity_min_kw} onChange={e => setForm(f => ({ ...f, capacity_min_kw: e.target.value }))} placeholder="e.g., 2" data-testid="kit-cap-min" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Range Max (kW)</Label>
                <Input type="number" step="0.1" value={form.capacity_max_kw} onChange={e => setForm(f => ({ ...f, capacity_max_kw: e.target.value }))} placeholder="e.g., 4" data-testid="kit-cap-max" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Description</Label>
                <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short summary of when this kit applies" data-testid="kit-description" />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Package className="h-4 w-4" /> Material Lines</p>
                <Button size="sm" variant="outline" onClick={addLine} className="h-9" data-testid="add-line-btn"><Plus className="h-3.5 w-3.5 mr-1" />Add Line</Button>
              </div>
              {form.lines.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">No lines yet. Add materials to include in this kit.</p>}
              <div className="space-y-2">
                {form.lines.map((l, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-2.5 space-y-2" data-testid={`kit-line-${i}`}>
                    <div className="flex gap-2 items-start">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px] text-slate-500">Pick from Inventory (optional)</Label>
                          <Select value={l.inventory_item_id || 'none'} onValueChange={v => v !== 'none' && pickInvItem(i, v)}>
                            <SelectTrigger className="h-9 text-xs" data-testid={`kit-line-inv-${i}`}><SelectValue placeholder="Choose item..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— None (free text) —</SelectItem>
                              {inventoryItems.map(it => <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px] text-slate-500">Name *</Label>
                          <Input value={l.name} onChange={e => updateLine(i, 'name', e.target.value)} placeholder="e.g., 540W Mono PERC panels" className="h-9 text-xs" data-testid={`kit-line-name-${i}`} />
                        </div>
                        <div>
                          <Label className="text-[10px] text-slate-500">Category</Label>
                          <Input value={l.category || ''} onChange={e => updateLine(i, 'category', e.target.value)} placeholder="panels / inverter / battery ..." className="h-9 text-xs" data-testid={`kit-line-cat-${i}`} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px] text-slate-500">Quantity</Label>
                            <Input type="number" step="0.1" value={l.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} className="h-9 text-xs" data-testid={`kit-line-qty-${i}`} />
                          </div>
                          <div>
                            <Label className="text-[10px] text-slate-500">Formula (info)</Label>
                            <Input value={l.qty_formula || ''} onChange={e => updateLine(i, 'qty_formula', e.target.value)} placeholder="e.g., 1 per kW" className="h-9 text-xs" data-testid={`kit-line-formula-${i}`} />
                          </div>
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-red-500 shrink-0" onClick={() => removeLine(i)} data-testid={`kit-line-remove-${i}`}><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="save-kit-btn">
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}{editing ? 'Save Changes' : 'Create Kit'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
