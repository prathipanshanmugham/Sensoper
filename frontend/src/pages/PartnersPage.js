import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { partnersAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Loader2, Plus, HardHat, Star, Search, Trash2, Tag, Pencil } from 'lucide-react';

const STATUS_COLORS = { active: 'bg-emerald-100 text-emerald-800', inactive: 'bg-slate-100 text-slate-600', blacklisted: 'bg-red-100 text-red-800' };

function StarRating({ value = 0, size = 'sm' }) {
  const v = Number(value) || 0;
  const full = Math.floor(v);
  const half = v - full >= 0.25 && v - full < 0.75;
  const filledCount = half ? full : Math.round(v);
  const cls = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5';
  return (
    <div className="flex items-center gap-0.5" title={v.toFixed(2)} data-testid="star-rating">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`${cls} ${i <= filledCount ? 'text-amber-400 fill-amber-400' : (i === filledCount + 1 && half ? 'text-amber-400' : 'text-slate-300')}`} />
      ))}
      <span className="ml-1 text-[10px] text-slate-500">{v.toFixed(1)}</span>
    </div>
  );
}

const emptyForm = () => ({
  partner_type: 'external_subcontractor', name: '', company_name: '', contact_person: '', phone: '', email: '',
  address: '', gstin: '', pan: '', specialities: [], service_districts: '', team_size: 0, status: 'active',
  retention_pct: 10, payment_terms: '', non_solicit_acknowledged: false,
  rate_card: [{ activity: '', unit: '', rate: '', effective_from: new Date().toISOString().slice(0, 10) }]
});

export default function PartnersPage() {
  const navigate = useNavigate();
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [availableTags, setAvailableTags] = useState([]);
  const [filters, setFilters] = useState({ partner_type: 'all', selected_tags: [], status: 'all', search: '', min_rating: 'all', sort: 'name' });
  const [showCreate, setShowCreate] = useState(false);
  const [showTagAdmin, setShowTagAdmin] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchTags = useCallback(async () => {
    try { const r = await partnersAPI.tags.list(); setAvailableTags(r.data || []); } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { fetchTags(); }, [fetchTags]);

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.partner_type !== 'all') params.partner_type = filters.partner_type;
      if (filters.selected_tags.length) params.specialities = filters.selected_tags.join(',');
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.search) params.search = filters.search;
      if (filters.min_rating !== 'all') params.min_rating = filters.min_rating;
      if (filters.sort !== 'name') params.sort = filters.sort;
      const r = await partnersAPI.list(params);
      setPartners(r.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  const toggleFilterTag = (tag) => setFilters(p => ({ ...p, selected_tags: p.selected_tags.includes(tag) ? p.selected_tags.filter(t => t !== tag) : [...p.selected_tags, tag] }));
  const toggleFormTag = (s) => setForm(p => ({ ...p, specialities: p.specialities.includes(s) ? p.specialities.filter(x => x !== s) : [...p.specialities, s] }));
  const updateRateRow = (i, field, val) => setForm(p => ({ ...p, rate_card: p.rate_card.map((r, idx) => idx === i ? { ...r, [field]: val } : r) }));
  const addRateRow = () => setForm(p => ({ ...p, rate_card: [...p.rate_card, { activity: '', unit: '', rate: '', effective_from: new Date().toISOString().slice(0, 10) }] }));
  const removeRateRow = (i) => setForm(p => ({ ...p, rate_card: p.rate_card.filter((_, idx) => idx !== i) }));

  const handleCreate = async () => {
    if (!form.name) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        service_districts: form.service_districts ? form.service_districts.split(',').map(s => s.trim()).filter(Boolean) : [],
        rate_card: form.rate_card.filter(r => r.activity && r.rate).map(r => ({ ...r, rate: parseFloat(r.rate) })),
        team_size: parseInt(form.team_size) || 0, retention_pct: parseFloat(form.retention_pct) || 0,
      };
      await partnersAPI.create(payload);
      setShowCreate(false); setForm(emptyForm()); fetchPartners();
    } catch (err) { setError(err.response?.data?.detail || 'Failed to create partner'); } finally { setSaving(false); }
  };

  const addTag = async () => {
    if (!newTag.trim()) return;
    try { await partnersAPI.tags.create(newTag.trim()); setNewTag(''); fetchTags(); }
    catch (e) { alert(e.response?.data?.detail || 'Could not add tag'); }
  };
  const renameTag = async (id, cur) => {
    const nx = window.prompt('Rename tag', cur); if (!nx || nx === cur) return;
    try { await partnersAPI.tags.rename(id, nx); fetchTags(); fetchPartners(); }
    catch (e) { alert(e.response?.data?.detail || 'Could not rename'); }
  };
  const retireTag = async (id) => { if (!window.confirm('Retire this tag from the picker?')) return; try { await partnersAPI.tags.remove(id); fetchTags(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } };

  const tagValues = availableTags.map(t => t.tag);

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="partners-page">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900 flex items-center gap-2"><HardHat className="h-6 w-6 text-emerald-600" />Labour &amp; Subcontractors</h1>
          <p className="text-sm text-slate-500">Rate cards, project assignments, retention and payments</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <Button variant="outline" onClick={() => setShowTagAdmin(true)} className="gap-1.5" data-testid="manage-tags-btn"><Tag className="h-4 w-4" />Manage Tags</Button>}
          {canManage && <Button onClick={() => setShowCreate(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="add-partner-btn"><Plus className="h-4 w-4" />Onboard Partner</Button>}
        </div>
      </div>

      {/* Filters */}
      <Card className="border-slate-200 mb-5"><CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="relative"><Search className="h-4 w-4 absolute left-2.5 top-2.5 text-slate-400" /><Input placeholder="Search name..." value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} className="pl-8 h-9" data-testid="partner-search-input" /></div>
          <Select value={filters.partner_type} onValueChange={v => setFilters(p => ({ ...p, partner_type: v }))}>
            <SelectTrigger className="h-9" data-testid="partner-type-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Types</SelectItem><SelectItem value="external_subcontractor">External Subcontractor</SelectItem><SelectItem value="internal_team">Internal Team</SelectItem></SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={v => setFilters(p => ({ ...p, status: v }))}>
            <SelectTrigger className="h-9" data-testid="partner-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="blacklisted">Blacklisted</SelectItem></SelectContent>
          </Select>
          <Select value={filters.min_rating} onValueChange={v => setFilters(p => ({ ...p, min_rating: v }))}>
            <SelectTrigger className="h-9" data-testid="partner-rating-filter"><SelectValue placeholder="Rating" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Any Rating</SelectItem><SelectItem value="4">4 stars &amp; above</SelectItem><SelectItem value="3">3 stars &amp; above</SelectItem><SelectItem value="2">2 stars &amp; above</SelectItem></SelectContent>
          </Select>
          <Select value={filters.sort} onValueChange={v => setFilters(p => ({ ...p, sort: v }))}>
            <SelectTrigger className="h-9" data-testid="partner-sort"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="name">Sort: Name</SelectItem><SelectItem value="rating_desc">Sort: Rating (high → low)</SelectItem><SelectItem value="business_desc">Sort: Business value</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 mr-1">Tags (AND):</span>
          {tagValues.length === 0 && <span className="text-xs text-slate-400 italic">No tags yet. Ask admin to add via "Manage Tags".</span>}
          {tagValues.map(t => (
            <button key={t} type="button" onClick={() => toggleFilterTag(t)}
              className={`px-2.5 py-1 text-xs rounded-full border ${filters.selected_tags.includes(t) ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'}`}
              data-testid={`tag-filter-${t.toLowerCase().replace(/\s+/g,'-')}`}>{t}</button>
          ))}
          {filters.selected_tags.length > 0 && <button onClick={() => setFilters(p => ({ ...p, selected_tags: [] }))} className="text-xs text-slate-500 underline ml-2">Clear</button>}
        </div>
      </CardContent></Card>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
      ) : partners.length === 0 ? (
        <Card className="border-slate-200"><CardContent className="py-16 text-center text-slate-500">No partners match your filters.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {partners.map(p => (
            <Card key={p.id} className="border-slate-200 hover:border-emerald-300 cursor-pointer transition-colors" onClick={() => navigate(`/dashboard/partners/${p.id}`)} data-testid={`partner-card-${p.id}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{p.name}</h3>
                    <p className="text-xs text-slate-500">{p.partner_type === 'internal_team' ? 'Internal Team' : (p.company_name || 'External Subcontractor')}</p>
                  </div>
                  <Badge className={STATUS_COLORS[p.status] || 'bg-slate-100'}>{p.status}</Badge>
                </div>
                <div className="flex gap-1.5 flex-wrap">{(p.specialities || []).slice(0, 4).map(s => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}</div>
                <div className="flex items-center justify-between pt-1 border-t">
                  <StarRating value={p.rating || 0} />
                  <span className="text-xs text-slate-500">{p.active_job_count} active{p.active_job_count === 1 ? '' : 's'}</span>
                </div>
                <p className="text-sm font-medium text-emerald-700">₹{(p.lifetime_business || 0).toLocaleString('en-IN')} lifetime</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Onboard Partner</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {error && <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Type</Label>
                <Select value={form.partner_type} onValueChange={v => setForm(p => ({ ...p, partner_type: v }))}>
                  <SelectTrigger data-testid="partner-form-type"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="external_subcontractor">External Subcontractor</SelectItem><SelectItem value="internal_team">Internal Team</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Name *</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} data-testid="partner-form-name" /></div>
              {form.partner_type === 'external_subcontractor' && (
                <>
                  <div className="space-y-1"><Label>Company Name</Label><Input value={form.company_name} onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))} data-testid="partner-form-company" /></div>
                  <div className="space-y-1"><Label>GSTIN</Label><Input value={form.gstin} onChange={e => setForm(p => ({ ...p, gstin: e.target.value }))} data-testid="partner-form-gstin" /></div>
                  <div className="space-y-1"><Label>PAN</Label><Input value={form.pan} onChange={e => setForm(p => ({ ...p, pan: e.target.value }))} /></div>
                </>
              )}
              <div className="space-y-1"><Label>Contact Person</Label><Input value={form.contact_person} onChange={e => setForm(p => ({ ...p, contact_person: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Team Size</Label><Input type="number" value={form.team_size} onChange={e => setForm(p => ({ ...p, team_size: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Retention % (held per assignment)</Label><Input type="number" value={form.retention_pct} onChange={e => setForm(p => ({ ...p, retention_pct: e.target.value }))} data-testid="partner-form-retention" /></div>
              <div className="col-span-2 space-y-1"><Label>Service Districts (comma separated)</Label><Input value={form.service_districts} onChange={e => setForm(p => ({ ...p, service_districts: e.target.value }))} placeholder="Chennai, Coimbatore" /></div>
              <div className="col-span-2 space-y-1"><Label>Payment Terms</Label><Textarea rows={2} value={form.payment_terms} onChange={e => setForm(p => ({ ...p, payment_terms: e.target.value }))} /></div>
            </div>
            <div className="space-y-2"><Label>Specialities (pick tags — add via "Manage Tags")</Label>
              <div className="flex gap-2 flex-wrap">
                {tagValues.length === 0 && <span className="text-xs text-slate-400 italic">No tags yet. Admin can add via "Manage Tags".</span>}
                {tagValues.map(s => (
                  <button key={s} type="button" onClick={() => toggleFormTag(s)} className={`px-2.5 py-1 text-xs rounded-full border ${form.specialities.includes(s) ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-white border-slate-200 text-slate-600'}`}>{s}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rate Card</Label>
              {form.rate_card.map((r, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end" data-testid={`rate-card-row-${i}`}>
                  <Input placeholder="Activity (e.g. On-grid installation per kW)" value={r.activity} onChange={e => updateRateRow(i, 'activity', e.target.value)} />
                  <Input placeholder="Unit" value={r.unit} onChange={e => updateRateRow(i, 'unit', e.target.value)} />
                  <Input placeholder="Rate ₹" type="number" value={r.rate} onChange={e => updateRateRow(i, 'rate', e.target.value)} />
                  <Input type="date" value={r.effective_from} onChange={e => updateRateRow(i, 'effective_from', e.target.value)} />
                  <Button variant="ghost" size="icon" onClick={() => removeRateRow(i)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addRateRow} className="gap-1"><Plus className="h-3.5 w-3.5" />Add Rate</Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="partner-form-submit">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Onboard'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag admin dialog */}
      <Dialog open={showTagAdmin} onOpenChange={setShowTagAdmin}>
        <DialogContent data-testid="tag-admin-dialog">
          <DialogHeader><DialogTitle>Manage Speciality Tags</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="New tag (e.g. Pump Installation)" data-testid="new-tag-input" />
            <Button onClick={addTag} className="bg-emerald-600 text-white gap-1" data-testid="add-tag-btn"><Plus className="h-4 w-4" />Add</Button>
          </div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {availableTags.map(t => (
              <div key={t.id} className="flex items-center justify-between p-2 border rounded" data-testid={`tag-row-${t.tag.toLowerCase().replace(/\s+/g,'-')}`}>
                <span className="text-sm">{t.tag}</span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => renameTag(t.id, t.tag)}><Pencil className="h-3.5 w-3.5 text-slate-500" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => retireTag(t.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                </div>
              </div>
            ))}
            {availableTags.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No tags yet</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowTagAdmin(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
