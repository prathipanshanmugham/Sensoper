import { useState, useEffect, useCallback } from 'react';
import { locationsAPI, usersAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Loader2, Plus, MapPin, Trash2, Pencil, Users as UsersIcon } from 'lucide-react';

const TYPES = ['branch', 'warehouse', 'business_unit', 'head_office'];

export default function LocationsPage() {
  const [locations, setLocations] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [assigningUser, setAssigningUser] = useState(null);
  const [form, setForm] = useState({ name: '', code: '', type: 'branch', address: '', district: '', state: '' });
  const [assignForm, setAssignForm] = useState({ location_ids: [], default_location_id: '' });

  const fetchAll = useCallback(async () => {
    try {
      const [l, u] = await Promise.all([locationsAPI.list(), usersAPI.getAll()]);
      setLocations(l.data); setUsers(u.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try { await locationsAPI.create(form); setShowCreate(false); setForm({ name: '', code: '', type: 'branch', address: '', district: '', state: '' }); await fetchAll(); }
    catch (e) { alert('Failed to create location'); }
  };

  const openEdit = (l) => { setEditing(l); };
  const saveEdit = async () => {
    try { await locationsAPI.update(editing.id, { name: editing.name, code: editing.code, type: editing.type, address: editing.address, district: editing.district, state: editing.state }); setEditing(null); await fetchAll(); }
    catch (e) { alert('Failed to save'); }
  };

  const removeLocation = async (id) => {
    if (!window.confirm('Remove this location?')) return;
    try { await locationsAPI.remove(id); await fetchAll(); } catch (e) { alert(e.response?.data?.detail || 'Failed to remove'); }
  };

  const openAssign = (u) => { setAssigningUser(u); setAssignForm({ location_ids: u.location_ids || [], default_location_id: u.default_location_id || '' }); };
  const toggleLocation = (id) => setAssignForm(p => ({ ...p, location_ids: p.location_ids.includes(id) ? p.location_ids.filter(x => x !== id) : [...p.location_ids, id] }));
  const saveAssign = async () => {
    try { await locationsAPI.assignUser(assigningUser.id, assignForm); setAssigningUser(null); await fetchAll(); }
    catch (e) { alert('Failed to assign'); }
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="py-6 px-4">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900" data-testid="locations-title"><MapPin className="inline h-6 w-6 mr-2 text-emerald-600" />Locations</h1>
            <p className="text-sm text-slate-500">Branches, warehouses and business units — assign users to scope their data</p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="add-location-btn"><Plus className="h-4 w-4" />Add Location</Button>
        </div>

        <Card className="border-slate-200">
          <CardHeader className="py-3"><CardTitle className="text-sm font-['Outfit']">Registered Locations</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {locations.map(l => (
              <div key={l.id} className="flex items-center justify-between rounded border border-slate-200 p-2.5" data-testid={`location-row-${l.id}`}>
                <div>
                  <p className="text-sm font-medium">{l.name} {l.code && <span className="text-slate-400">({l.code})</span>}</p>
                  <p className="text-[11px] text-slate-500">{l.type.replace(/_/g, ' ')} · {l.district || l.address || '—'}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-500" onClick={() => openEdit(l)} data-testid={`edit-location-${l.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => removeLocation(l.id)} data-testid={`delete-location-${l.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
            {locations.length === 0 && <p className="text-sm text-slate-400 text-center py-6">No locations yet — add your head office to get started.</p>}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="py-3"><CardTitle className="text-sm font-['Outfit'] flex items-center gap-1.5"><UsersIcon className="h-4 w-4" />User Location Assignment</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between rounded border border-slate-200 p-2.5" data-testid={`user-location-row-${u.id}`}>
                <div>
                  <p className="text-sm font-medium">{u.name} <span className="text-[11px] text-slate-400">({u.role})</span></p>
                  <p className="text-[11px] text-slate-500">{(u.location_ids || []).length ? `${u.location_ids.length} location(s) assigned` : 'No locations assigned — sees all'}</p>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openAssign(u)} data-testid={`assign-locations-${u.id}`}>Assign</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="create-location-dialog">
          <DialogHeader><DialogTitle>Add Location</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="h-9 col-span-2" data-testid="location-name-input" />
            <Input placeholder="Code" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className="h-9" />
            <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="District" value={form.district} onChange={e => setForm(p => ({ ...p, district: e.target.value }))} className="h-9" />
            <Input placeholder="State" value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} className="h-9" />
            <Input placeholder="Address" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} className="h-9 col-span-2" />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={handleCreate} className="bg-emerald-600 text-white" data-testid="save-location-btn">Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
        <DialogContent data-testid="edit-location-dialog">
          <DialogHeader><DialogTitle>Edit Location</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Name" value={editing.name} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} className="h-9 col-span-2" data-testid="edit-location-name-input" />
              <Input placeholder="Code" value={editing.code || ''} onChange={e => setEditing(p => ({ ...p, code: e.target.value }))} className="h-9" />
              <Select value={editing.type} onValueChange={v => setEditing(p => ({ ...p, type: v }))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent></Select>
              <Input placeholder="District" value={editing.district || ''} onChange={e => setEditing(p => ({ ...p, district: e.target.value }))} className="h-9" />
              <Input placeholder="State" value={editing.state || ''} onChange={e => setEditing(p => ({ ...p, state: e.target.value }))} className="h-9" />
              <Input placeholder="Address" value={editing.address || ''} onChange={e => setEditing(p => ({ ...p, address: e.target.value }))} className="h-9 col-span-2" />
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveEdit} className="bg-blue-600 text-white" data-testid="save-location-edit-btn">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assigningUser} onOpenChange={v => !v && setAssigningUser(null)}>
        <DialogContent data-testid="assign-location-dialog">
          <DialogHeader><DialogTitle>Assign Locations — {assigningUser?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {locations.map(l => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={assignForm.location_ids.includes(l.id)} onChange={() => toggleLocation(l.id)} data-testid={`assign-checkbox-${l.id}`} />
                {l.name}
              </label>
            ))}
          </div>
          <Select value={assignForm.default_location_id} onValueChange={v => setAssignForm(p => ({ ...p, default_location_id: v }))}>
            <SelectTrigger className="h-9" data-testid="default-location-select"><SelectValue placeholder="Default location for new projects" /></SelectTrigger>
            <SelectContent>{locations.filter(l => assignForm.location_ids.includes(l.id)).map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter><Button variant="outline" onClick={() => setAssigningUser(null)}>Cancel</Button><Button onClick={saveAssign} className="bg-emerald-600 text-white" data-testid="save-assign-btn">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
