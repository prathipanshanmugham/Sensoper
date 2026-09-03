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
import { Loader2, Plus, HardHat, Star, Search, Trash2 } from 'lucide-react';

const SPECIALITIES = ['on-grid', 'off-grid', 'hybrid', 'pump', 'electrical', 'civil'];
const STATUS_COLORS = { active: 'bg-emerald-100 text-emerald-800', inactive: 'bg-slate-100 text-slate-600', blacklisted: 'bg-red-100 text-red-800' };

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
  const [filters, setFilters] = useState({ partner_type: 'all', speciality: 'all', status: 'all', search: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.partner_type !== 'all') params.partner_type = filters.partner_type;
      if (filters.speciality !== 'all') params.speciality = filters.speciality;
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.search) params.search = filters.search;
      const r = await partnersAPI.list(params);
      setPartners(r.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { fetchPartners(); }, [fetchPartners]);

  const toggleSpeciality = (s) => setForm(p => ({ ...p, specialities: p.specialities.includes(s) ? p.specialities.filter(x => x !== s) : [...p.specialities, s] }));
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

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="partners-page">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900 flex items-center gap-2"><HardHat className="h-6 w-6 text-emerald-600" />Labour &amp; Subcontractors</h1>
          <p className="text-sm text-slate-500">Rate cards, project assignments, retention and payments</p>
        </div>
        {canManage && <Button onClick={() => setShowCreate(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" data-testid="add-partner-btn"><Plus className="h-4 w-4" />Onboard Partner</Button>}
      </div>

      {/* Filters */}
      <Card className="border-slate-200 mb-5"><CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="relative"><Search className="h-4 w-4 absolute left-2.5 top-2.5 text-slate-400" /><Input placeholder="Search name..." value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} className="pl-8 h-9" data-testid="partner-search-input" /></div>
        <Select value={filters.partner_type} onValueChange={v => setFilters(p => ({ ...p, partner_type: v }))}>
          <SelectTrigger className="h-9" data-testid="partner-type-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Types</SelectItem><SelectItem value="external_subcontractor">External Subcontractor</SelectItem><SelectItem value="internal_team">Internal Team</SelectItem></SelectContent>
        </Select>
        <Select value={filters.speciality} onValueChange={v => setFilters(p => ({ ...p, speciality: v }))}>
          <SelectTrigger className="h-9" data-testid="partner-speciality-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Specialities</SelectItem>{SPECIALITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={v => setFilters(p => ({ ...p, status: v }))}>
          <SelectTrigger className="h-9" data-testid="partner-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="blacklisted">Blacklisted</SelectItem></SelectContent>
        </Select>
      </CardContent></Card>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
      ) : partners.length === 0 ? (
        <Card className="border-slate-200"><CardContent className="py-16 text-center text-slate-500">No partners onboarded yet.</CardContent></Card>
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
                <div className="flex gap-1.5 flex-wrap">{(p.specialities || []).slice(0, 3).map(s => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}</div>
                <div className="flex items-center justify-between text-sm pt-1 border-t">
                  <span className="flex items-center gap-1 text-amber-600"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{p.rating || '—'}</span>
                  <span className="text-slate-500">{p.active_job_count} active job{p.active_job_count === 1 ? '' : 's'}</span>
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
            <div className="space-y-1"><Label>Specialities</Label>
              <div className="flex gap-2 flex-wrap">{SPECIALITIES.map(s => (
                <button key={s} type="button" onClick={() => toggleSpeciality(s)} className={`px-2.5 py-1 text-xs rounded-full border ${form.specialities.includes(s) ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-white border-slate-200 text-slate-600'}`}>{s}</button>
              ))}</div>
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
    </div>
  );
}
