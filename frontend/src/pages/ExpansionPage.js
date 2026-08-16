/**
 * Expansion Module — where should Sensoper open next?
 * Sortable district table, sub-score radar drawer, break-even simulator, branches registry.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { expansionAPI } from '../utils/api';
import {
  Loader2, ArrowLeft, MapPin, TrendingUp, AlertTriangle, Plus, Trash2, Calculator,
  Layers, Info, Building2
} from 'lucide-react';
import { Link } from 'react-router-dom';

const BAND_STYLES = {
  strong:   { color: 'text-emerald-700', bg: 'bg-emerald-100 border-emerald-200', label: 'Strong Case' },
  watch:    { color: 'text-amber-700',   bg: 'bg-amber-100 border-amber-200',      label: 'Watch' },
  serve:    { color: 'text-sky-700',     bg: 'bg-sky-100 border-sky-200',          label: 'Serve from Existing' },
  no_case:  { color: 'text-rose-700',    bg: 'bg-rose-100 border-rose-200',        label: 'No Case' },
};


function Radar({ components }) {
  // 8-axis radar chart, 200x200 SVG
  const size = 200; const cx = size / 2; const cy = size / 2; const R = 80;
  const n = components.length || 8;
  const points = components.map((c, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const r = (Math.max(0, Math.min(100, c.score)) / 100) * R;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), c, angle, R };
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[280px]" data-testid="expansion-radar">
      {/* Grid */}
      {[0.25, 0.5, 0.75, 1].map((f, i) => (
        <circle key={i} cx={cx} cy={cy} r={R * f} fill="none" stroke="#e2e8f0" strokeWidth="0.5" />
      ))}
      {/* Axes */}
      {points.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(p.angle)} y2={cy + R * Math.sin(p.angle)} stroke="#e2e8f0" strokeWidth="0.5" />
      ))}
      {/* Filled polygon */}
      <polygon points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="#10b981" fillOpacity="0.25" stroke="#059669" strokeWidth="1.5" />
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#059669" />)}
      {/* Labels */}
      {points.map((p, i) => {
        const lx = cx + (R + 18) * Math.cos(p.angle);
        const ly = cy + (R + 18) * Math.sin(p.angle);
        return (
          <text key={i} x={lx} y={ly} textAnchor="middle" fontSize="7" fill="#475569" dominantBaseline="middle">
            {p.c.name}
          </text>
        );
      })}
    </svg>
  );
}


export default function ExpansionPage() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState('all');
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [showBranches, setShowBranches] = useState(false);
  const [branches, setBranches] = useState([]);
  const [newBranch, setNewBranch] = useState({ name: '', state: '', district: '', latitude: '', longitude: '', monthly_cost: 250000 });
  const [showSim, setShowSim] = useState(false);
  const [sim, setSim] = useState(null);
  const [simInputs, setSimInputs] = useState({
    monthly_branch_cost: 250000, setup_capex: 1500000,
    target_margin_pct: 20, current_monthly_projects: 5,
    current_avg_ticket: 300000, monthly_run_rate: 800000
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = stateFilter === 'all' ? {} : { state: stateFilter };
      const [ov, br] = await Promise.all([expansionAPI.overview(params), expansionAPI.listBranches()]);
      setOverview(ov.data); setBranches(br.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [stateFilter]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const availableStates = useMemo(() => {
    if (!overview?.districts) return [];
    return Array.from(new Set(overview.districts.map(d => d.state).filter(Boolean)));
  }, [overview]);

  const runSim = async () => {
    if (selectedDistrict) {
      const m = selectedDistrict.metrics;
      setSimInputs(s => ({
        ...s,
        current_monthly_projects: (m.projects / 12).toFixed(1),
        current_avg_ticket: m.avg_ticket || s.current_avg_ticket,
        monthly_run_rate: (m.revenue / 12).toFixed(0),
      }));
    }
    setShowSim(true);
    const payload = {
      district: selectedDistrict?.district,
      ...simInputs,
      current_monthly_projects: selectedDistrict ? +(selectedDistrict.metrics.projects / 12).toFixed(1) : simInputs.current_monthly_projects,
      current_avg_ticket: selectedDistrict?.metrics.avg_ticket || simInputs.current_avg_ticket,
      monthly_run_rate: selectedDistrict ? +(selectedDistrict.metrics.revenue / 12).toFixed(0) : simInputs.monthly_run_rate,
    };
    try { const r = await expansionAPI.simulate(payload); setSim(r.data); } catch (e) { console.error(e); }
  };
  const rerunSim = async () => {
    try { const r = await expansionAPI.simulate({ ...simInputs, district: selectedDistrict?.district }); setSim(r.data); } catch (e) { console.error(e); }
  };

  const addBranch = async () => {
    if (!newBranch.name.trim()) return;
    try {
      const payload = {
        ...newBranch,
        latitude: parseFloat(newBranch.latitude) || null,
        longitude: parseFloat(newBranch.longitude) || null,
        monthly_cost: parseFloat(newBranch.monthly_cost) || 0
      };
      await expansionAPI.createBranch(payload);
      setNewBranch({ name: '', state: '', district: '', latitude: '', longitude: '', monthly_cost: 250000 });
      const r = await expansionAPI.listBranches(); setBranches(r.data);
    } catch (e) { alert('Failed to add branch'); }
  };
  const removeBranch = async (id) => {
    if (!window.confirm('Remove this branch?')) return;
    try { await expansionAPI.deleteBranch(id); const r = await expansionAPI.listBranches(); setBranches(r.data); }
    catch { alert('Failed'); }
  };

  const meta = (b) => BAND_STYLES[b] || BAND_STYLES.no_case;

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Link to="/dashboard"><Button variant="ghost" size="icon" data-testid="back-btn"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold font-['Outfit'] text-slate-900">Expansion Analysis</h1>
              <p className="text-sm text-slate-500">Where should Sensoper open its next branch?</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="h-10 w-40 bg-white" data-testid="state-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                {availableStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setShowBranches(true)} className="h-10" data-testid="manage-branches-btn"><Building2 className="h-4 w-4 mr-1" />Branches</Button>
            <Button variant="outline" onClick={() => { setSelectedDistrict(null); runSim(); }} className="h-10" data-testid="simulator-btn"><Calculator className="h-4 w-4 mr-1" />Simulator</Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
        ) : (
          <>
            {/* Company summary */}
            <Card className="border-slate-200 mb-4" data-testid="expansion-summary">
              <CardContent className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  <div><p className="text-[10px] uppercase text-slate-500">Districts Analysed</p><p className="text-xl font-bold">{overview?.districts?.length || 0}</p></div>
                  <div><p className="text-[10px] uppercase text-slate-500">Total Projects</p><p className="text-xl font-bold">{overview?.totals?.projects_all_districts || 0}</p></div>
                  <div><p className="text-[10px] uppercase text-slate-500">Total Revenue</p><p className="text-xl font-bold">₹{(overview?.totals?.revenue_all_districts || 0).toLocaleString('en-IN')}</p></div>
                  <div><p className="text-[10px] uppercase text-slate-500">Company Avg Margin</p><p className="text-xl font-bold">{overview?.company_avg_margin_pct?.toFixed(1) || 0}%</p></div>
                </div>
                <p className="text-[10px] text-slate-500 mt-3 flex items-center gap-1"><Info className="h-3 w-3" /> Districts with fewer than {overview?.min_projects_for_score || 10} projects are flagged as low-confidence.</p>
              </CardContent>
            </Card>

            {/* Opportunity table */}
            <Card className="border-slate-200" data-testid="expansion-table">
              <CardHeader className="pb-3"><CardTitle className="text-base font-['Outfit']">Ranked Opportunities</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-50">
                    <tr><th className="text-left px-3 py-2">District</th><th className="text-left px-3 py-2">State</th><th className="text-right px-3 py-2">Score</th><th className="text-right px-3 py-2">Projects</th><th className="text-right px-3 py-2">Revenue</th><th className="text-right px-3 py-2">Margin</th><th className="text-right px-3 py-2">Nearest Branch</th><th></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overview?.districts?.map((d) => {
                      const m = meta(d.band);
                      return (
                        <tr key={d.district+d.state} className={`hover:bg-slate-50 ${d.confidence_low ? 'opacity-60' : ''}`} data-testid={`district-row-${d.district}`}>
                          <td className="px-3 py-2 font-medium text-slate-900 flex items-center gap-2"><MapPin className="h-3 w-3 text-slate-400" />{d.district}</td>
                          <td className="px-3 py-2 text-slate-600">{d.state || '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <span className={`font-bold ${m.color}`}>{d.score.toFixed(1)}</span>
                              <Badge className={`text-[9px] border ${m.bg} ${m.color}`}>{m.label}</Badge>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">{d.metrics.projects} {d.confidence_low && <AlertTriangle className="inline h-3 w-3 text-amber-600 ml-1" />}</td>
                          <td className="px-3 py-2 text-right">₹{d.metrics.revenue.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2 text-right">{d.metrics.margin_pct}%</td>
                          <td className="px-3 py-2 text-right text-slate-500">{d.metrics.nearest_branch_km != null ? `${d.metrics.nearest_branch_km} km` : '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedDistrict(d)} data-testid={`district-view-${d.district}`}>View</Button>
                          </td>
                        </tr>
                      );
                    })}
                    {overview?.districts?.length === 0 && (
                      <tr><td colSpan={8} className="text-center text-slate-400 py-8">No projects with district data yet. Enter a PIN on the New Project form to start seeing districts here.</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* District detail drawer */}
      <Dialog open={!!selectedDistrict} onOpenChange={(v) => !v && setSelectedDistrict(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="district-drawer">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-emerald-600" />{selectedDistrict?.district}, {selectedDistrict?.state}</DialogTitle>
            <DialogDescription>Score breakdown &amp; break-even case for this district.</DialogDescription>
          </DialogHeader>
          {selectedDistrict && (
            <div className="space-y-4">
              <div className={`p-3 rounded-lg border ${meta(selectedDistrict.band).bg}`}>
                <p className="text-xs font-medium text-slate-700">Verdict:</p>
                <p className={`text-sm font-semibold ${meta(selectedDistrict.band).color}`}>{selectedDistrict.verdict}</p>
                {selectedDistrict.confidence_low && (
                  <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-1"><AlertTriangle className="h-3 w-3" /> Only {selectedDistrict.sample_size} projects — score is low confidence.</p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div><Radar components={selectedDistrict.components} /></div>
                <div className="space-y-1.5 text-xs">
                  {selectedDistrict.components.map((c, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-slate-100 pb-1">
                      <span className="text-slate-600">{c.name} <span className="text-slate-400">({c.weight}%)</span></span>
                      <span className="font-bold text-slate-800">{c.score.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {Object.entries(selectedDistrict.metrics).map(([k, v]) => (
                  <div key={k} className="rounded p-2 bg-slate-50">
                    <p className="text-[9px] uppercase text-slate-500">{k.replace(/_/g, ' ')}</p>
                    <p className="font-bold text-slate-800 mt-0.5">{typeof v === 'number' && k.includes('revenue') ? `₹${v.toLocaleString('en-IN')}` : v?.toString() || '—'}</p>
                  </div>
                ))}
              </div>
              <Button onClick={runSim} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="run-be-sim">
                <Calculator className="h-4 w-4 mr-1" /> Run break-even simulator for this district
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Break-even simulator dialog */}
      <Dialog open={showSim} onOpenChange={setShowSim}>
        <DialogContent className="max-w-xl" data-testid="be-sim-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Calculator className="h-5 w-5 text-emerald-600" />Break-Even Simulator</DialogTitle>
            <DialogDescription>Given branch economics + current run-rate, how long to break even?</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><Label className="text-[10px]">Monthly Branch Cost (₹)</Label><Input type="number" value={simInputs.monthly_branch_cost} onChange={e => setSimInputs(s => ({ ...s, monthly_branch_cost: +e.target.value }))} className="h-9" data-testid="sim-branch-cost" /></div>
            <div><Label className="text-[10px]">Setup CAPEX (₹)</Label><Input type="number" value={simInputs.setup_capex} onChange={e => setSimInputs(s => ({ ...s, setup_capex: +e.target.value }))} className="h-9" data-testid="sim-capex" /></div>
            <div><Label className="text-[10px]">Target Margin (%)</Label><Input type="number" value={simInputs.target_margin_pct} onChange={e => setSimInputs(s => ({ ...s, target_margin_pct: +e.target.value }))} className="h-9" data-testid="sim-margin" /></div>
            <div><Label className="text-[10px]">Avg Ticket (₹)</Label><Input type="number" value={simInputs.current_avg_ticket} onChange={e => setSimInputs(s => ({ ...s, current_avg_ticket: +e.target.value }))} className="h-9" data-testid="sim-ticket" /></div>
            <div><Label className="text-[10px]">Current Monthly Projects</Label><Input type="number" step="0.1" value={simInputs.current_monthly_projects} onChange={e => setSimInputs(s => ({ ...s, current_monthly_projects: +e.target.value }))} className="h-9" data-testid="sim-projects" /></div>
            <div><Label className="text-[10px]">Current Monthly Revenue (₹)</Label><Input type="number" value={simInputs.monthly_run_rate} onChange={e => setSimInputs(s => ({ ...s, monthly_run_rate: +e.target.value }))} className="h-9" data-testid="sim-runrate" /></div>
          </div>
          <Button onClick={rerunSim} size="sm" variant="outline" className="w-full" data-testid="sim-run-btn">Recalculate</Button>
          {sim && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-1 text-xs" data-testid="sim-result">
              <div className="flex justify-between"><span>Revenue needed / month</span><strong>₹{sim.revenue_per_month_needed.toLocaleString('en-IN')}</strong></div>
              <div className="flex justify-between"><span>Projects needed / month</span><strong>{sim.projects_per_month_needed}</strong></div>
              <div className="flex justify-between"><span>Gap vs current</span>
                <strong className={sim.gap_projects_per_month <= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                  {sim.gap_projects_per_month <= 0 ? '✓ ' : ''}{sim.gap_projects_per_month} projects
                </strong>
              </div>
              <div className="flex justify-between border-t border-emerald-200 pt-1 mt-1">
                <span>Months to break-even</span>
                <strong>{sim.months_to_breakeven === null ? 'Not viable at current rate' : `${sim.months_to_breakeven} months`}</strong>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Branches management dialog */}
      <Dialog open={showBranches} onOpenChange={setShowBranches}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="branches-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-emerald-600" />Branch Registry</DialogTitle>
            <DialogDescription>Existing Sensoper branches — used for distance-drag scoring in expansion analysis.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {branches.map(b => (
              <div key={b.id} className="flex items-center justify-between rounded border border-slate-200 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{b.name}</p>
                  <p className="text-[11px] text-slate-500">{b.district}, {b.state} · ₹{(b.monthly_cost || 0).toLocaleString('en-IN')}/mo</p>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => removeBranch(b.id)} data-testid={`del-branch-${b.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            {branches.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No branches configured yet.</p>}
          </div>
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />Add Branch</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Name" value={newBranch.name} onChange={e => setNewBranch(b => ({ ...b, name: e.target.value }))} className="h-9 text-xs" data-testid="new-branch-name" />
              <Input placeholder="District" value={newBranch.district} onChange={e => setNewBranch(b => ({ ...b, district: e.target.value }))} className="h-9 text-xs" data-testid="new-branch-district" />
              <Input placeholder="State" value={newBranch.state} onChange={e => setNewBranch(b => ({ ...b, state: e.target.value }))} className="h-9 text-xs" data-testid="new-branch-state" />
              <Input placeholder="Monthly cost (₹)" type="number" value={newBranch.monthly_cost} onChange={e => setNewBranch(b => ({ ...b, monthly_cost: e.target.value }))} className="h-9 text-xs" data-testid="new-branch-cost" />
              <Input placeholder="Latitude" type="number" step="0.001" value={newBranch.latitude} onChange={e => setNewBranch(b => ({ ...b, latitude: e.target.value }))} className="h-9 text-xs" data-testid="new-branch-lat" />
              <Input placeholder="Longitude" type="number" step="0.001" value={newBranch.longitude} onChange={e => setNewBranch(b => ({ ...b, longitude: e.target.value }))} className="h-9 text-xs" data-testid="new-branch-lon" />
            </div>
            <Button onClick={addBranch} size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="add-branch-btn"><Plus className="h-3.5 w-3.5 mr-1" />Add Branch</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
