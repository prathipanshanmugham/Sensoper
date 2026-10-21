/* AMC & service. One page shared with our joint-venture partner:
 *  - the company dropdown shows Sensoper, the partner, or both (partner work never counts in our numbers)
 *  - "Time to offer AMC" lists customers whose plant is old enough, "Quotes" sells Basic / Standard / Premium
 *  - partner logins see only this page: every contract (ours without money), their own projects and numbers. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Building2, CalendarClock, EyeOff, FileSignature, IndianRupee, Loader2, MoreHorizontal, Plus, RefreshCw, Settings2, Sparkles, Ticket, TrendingUp, Users, Zap } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { amcAPI, projectsAPI } from '../utils/api';
import { AmcOpsPanel } from '../components/AmcOps';
import { useAuth } from '../contexts/AuthContext';
import { useLocationScope, LocationScopeSelect } from '../components/LocationScope';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import SupportTicketsTab from './SupportTicketsTab';
import Can from '../components/Can';
import { ALL, OURS, CoBrand, OrgChip, OrgSelect, inr, useJv } from '../components/amc/jv';
import QuoteBuilder from '../components/amc/QuoteBuilder';
import { JvProjectsTab, OffersTab, QuotesTab } from '../components/amc/AmcTabs';
import AmcReportTab from '../components/amc/AmcReportTab';
import { AmcSettingsSheet, JvPartnerSheet } from '../components/amc/AmcSettings';
import { useLiveRefresh } from '../lib/liveSync';

const STATUS_STYLES = { active: 'bg-emerald-100 text-emerald-700', expiring: 'bg-amber-100 text-amber-700', expired: 'bg-rose-100 text-rose-700', renewed: 'bg-blue-100 text-blue-700', cancelled: 'bg-slate-200 text-slate-600', 'on-hold': 'bg-violet-100 text-violet-700' };
const ORG_KEY = 'amc_org_view';
const readOrg = () => { try { return localStorage.getItem(ORG_KEY) || OURS; } catch { return OURS; } };

function Kpi({ label, value, icon: Icon, testid, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid={testid}>
      <div className="mb-1 flex items-center gap-1.5 text-slate-400"><Icon className="h-4 w-4" /><span className="text-[11px] uppercase tracking-wide">{label}</span></div>
      <p className="font-['Outfit'] text-xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

const blankContract = { org_id: '', customer_name: '', contact: '', site_address: '', district: '', system_type: 'on-grid', system_capacity_kw: '', contract_type: 'comprehensive', start_date: '', duration_months: 12, annual_value: '', billing_frequency: 'annual', visits_per_year: 2 };

export default function AMCDashboard() {
  const { user, isAdmin, isManager, can } = useAuth();
  const isPartner = user?.role === 'partner';
  const ourManager = isAdmin || isManager;
  const canEdit = ourManager || isPartner || can('module_amc', 'edit');
  const locScope = useLocationScope('amc_location_scope');
  const { jv, reload: reloadJv } = useJv();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const [org, setOrgState] = useState(readOrg);
  const setOrg = (v) => { setOrgState(v); try { localStorage.setItem(ORG_KEY, v); } catch { /* per-device convenience only */ } };
  const [dashboard, setDashboard] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [offerCount, setOfferCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [reloadKey, setReloadKey] = useState(0);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(blankContract);
  const [showFromProject, setShowFromProject] = useState(false);
  const [completedProjects, setCompletedProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [visitDlg, setVisitDlg] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jvOpen, setJvOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasPartners = isPartner || (jv?.partners?.length || 0) > 0;
  const viewOrg = isPartner ? OURS : (hasPartners ? org : OURS);   // the server keeps a partner to its own company anyway
  const shownPartner = isPartner ? jv?.partners?.[0] : (jv?.partners?.find((p) => p.id === viewOrg) || (jv?.partners?.length === 1 ? jv.partners[0] : null));

  const fetchAll = useCallback(async () => {
    try {
      const locParams = locScope.locationId && !isPartner ? { location_id: locScope.locationId } : {};
      const [d, c, oc] = await Promise.all([
        amcAPI.dashboard({ ...locParams, org: viewOrg }),
        amcAPI.list({ ...(statusFilter !== 'all' ? { status: statusFilter } : {}), ...locParams, ...(viewOrg !== ALL && !isPartner ? { org: viewOrg } : {}) }),
        amcAPI.offers({ org: isPartner ? ALL : viewOrg, include_upcoming: true }).catch(() => ({ data: { due: 0, soon: 0 } })),
      ]);
      setDashboard(d.data); setContracts(c.data); setOfferCount((oc.data.due || 0) + (oc.data.soon || 0));
    } catch (e) { console.error(e); setDashboard((x) => x || {}); }
  }, [statusFilter, locScope.locationId, viewOrg, isPartner]);
  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);
  const changed = () => setReloadKey((k) => k + 1);
  useLiveRefresh(['amc', 'projects'], changed);   // someone else's contract, visit, quote or finished project shows up by itself

  const openQuote = (pre = null) => { setPrefill(pre); setQuoteOpen(true); };
  const openFromProject = async () => {
    setShowFromProject(true);
    try { const r = await projectsAPI.getAll('completed'); setCompletedProjects(r.data || []); } catch (e) { console.error(e); }
  };
  const handleCreateFromProject = async () => {
    setSaving(true);
    try { await amcAPI.createFromProject(selectedProjectId); setShowFromProject(false); setSelectedProjectId(''); toast.success('AMC contract created'); changed(); }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not create contract'); } finally { setSaving(false); }
  };
  const handleCreate = async () => {
    setSaving(true);
    try {
      await amcAPI.create({ ...form, org_id: isPartner ? null : (form.org_id || null), system_capacity_kw: parseFloat(form.system_capacity_kw) || 0, annual_value: parseFloat(form.annual_value) || 0, duration_months: parseInt(form.duration_months, 10) || 12, visits_per_year: parseInt(form.visits_per_year, 10) || 2 });
      setShowCreate(false); toast.success('Contract created'); changed();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not create contract'); } finally { setSaving(false); }
  };
  const mine = (c) => (isPartner ? c.org_id && c.org_id === user?.partner_id : ourManager);
  const handleRenew = async (c) => { try { await amcAPI.renew(c.id); toast.success('Renewed for another term'); changed(); } catch (e) { toast.error(e.response?.data?.detail || 'Could not renew'); } };
  const handleCancel = async (c) => {
    const reason = window.prompt('Reason for cancelling (optional)');
    if (reason === null) return;
    try { await amcAPI.cancel(c.id, reason); changed(); } catch (e) { toast.error(e.response?.data?.detail || 'Could not cancel'); }
  };
  const scheduleVisit = async () => {
    setSaving(true);
    try {
      const r = await amcAPI.scheduleWithNotifications(visitDlg.contract.id, { scheduled_date: visitDlg.date, technician_name: visitDlg.tech || null, lead_days: [3, 1], notes: visitDlg.notes || '' });
      toast.success(`Visit planned · ${r.data.notifications_created} reminders queued`); setVisitDlg(null); changed();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not plan the visit'); } finally { setSaving(false); }
  };

  // "All companies": side-by-side numbers per company from the shared contract list
  const byCompany = useMemo(() => {
    if (viewOrg !== ALL) return [];
    const m = new Map();
    contracts.filter((c) => c.status === 'active').forEach((c) => {
      const k = c.org_id || OURS;
      const r = m.get(k) || { org_id: c.org_id || null, active: 0, kw: 0, value: 0 };
      r.active += 1; r.kw += Number(c.system_capacity_kw) || 0; r.value += Number(c.annual_value) || 0; m.set(k, r);
    });
    return [...m.values()].sort((a, b) => (a.org_id ? 1 : 0) - (b.org_id ? 1 : 0));
  }, [contracts, viewOrg]);

  const capacityChartData = dashboard?.capacity_by_type ? Object.entries(dashboard.capacity_by_type).map(([name, value]) => ({ name: name.replace(/-/g, ' '), value: Math.round(value * 10) / 10 })) : [];
  const tabs = [
    ['overview', 'Overview'],
    ['offers', 'Time to offer AMC', offerCount],
    ['quotes', 'Quotes'],
    ['contracts', 'Contracts'],
    hasPartners && ['partner', isPartner ? 'Our projects' : 'Partner projects'],
    ['report', 'Report'],
    !isPartner && ['support', 'Customer support'],
  ].filter(Boolean);

  if (!dashboard || !jv) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="px-4 py-5 sm:py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        {shownPartner && <CoBrand jv={jv} partner={shownPartner} canEditLogo={isAdmin || isPartner} onLogoChanged={reloadJv} />}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-['Outfit'] text-2xl font-bold text-slate-900" data-testid="amc-title"><RefreshCw className="h-6 w-6 text-emerald-600" />AMC &amp; service</h1>
            <p className="text-sm text-slate-500">{isPartner ? `${shownPartner?.name || 'Your company'} · shared AMC with Sensoper` : 'Maintenance contracts — kept apart from project revenue'}</p>
          </div>
          <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
            {!isPartner && hasPartners && <div className="w-full sm:w-56"><Label className="mb-1 block text-[11px] text-slate-500">Show</Label><OrgSelect jv={jv} value={viewOrg} onChange={setOrg} /></div>}
            {ourManager && <div className="w-full sm:w-44"><LocationScopeSelect scope={locScope} testIdPrefix="amc-location" /></div>}
            {canEdit && <Button onClick={() => openQuote()} className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="amc-new-quote"><FileSignature className="h-4 w-4" />New quote</Button>}
            {canEdit && <Can module="module_amc" action="create"><Button variant="outline" onClick={() => { setForm({ ...blankContract, org_id: !isPartner && viewOrg !== ALL && viewOrg !== OURS ? viewOrg : '' }); setShowCreate(true); }} className="h-10 gap-1.5" data-testid="add-amc-btn"><Plus className="h-4 w-4" />Contract</Button></Can>}
            {(ourManager && can('module_amc', 'create')) || isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" className="h-10 gap-1.5" data-testid="amc-more-btn" aria-label="More"><MoreHorizontal className="h-4 w-4" /><span className="hidden sm:inline">More</span></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {ourManager && can('module_amc', 'create') && <DropdownMenuItem onSelect={openFromProject} data-testid="create-amc-from-project-btn"><Sparkles className="mr-2 h-4 w-4" />Contract from a finished project</DropdownMenuItem>}
                  {isAdmin && <DropdownMenuItem onSelect={() => setJvOpen(true)} data-testid="amc-jv-btn"><Building2 className="mr-2 h-4 w-4 text-violet-700" />Joint venture partner</DropdownMenuItem>}
                  {isAdmin && <DropdownMenuItem onSelect={() => setSettingsOpen(true)} data-testid="amc-settings-btn"><Settings2 className="mr-2 h-4 w-4" />AMC settings</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        <div className="-mx-4 overflow-x-auto px-4" role="tablist" aria-label="AMC sections">
          <div className="flex w-max gap-1.5">
            {tabs.map(([k, l, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm ${tab === k ? 'border-emerald-300 bg-emerald-100 font-medium text-emerald-800' : 'border-slate-200 bg-white text-slate-600'}`} data-testid={`amc-tab-${k}`}>
                {k === 'support' && <Ticket className="h-3.5 w-3.5" />}{l}{n > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white" data-testid="amc-offers-count">{n}</span>}
              </button>
            ))}
          </div>
        </div>

        {tab === 'overview' && (
          <div className="space-y-4" data-testid="amc-overview">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Yearly value" value={inr(dashboard.arr)} icon={IndianRupee} testid="amc-kpi-arr" sub={`${inr(dashboard.mrr)} a month`} />
              <Kpi label="Active contracts" value={dashboard.active_contracts} icon={Users} testid="amc-kpi-active" sub={`${dashboard.capacity_kw ?? 0} kW looked after`} />
              <Kpi label="Renewal rate" value={`${dashboard.renewal_rate_pct}%`} icon={TrendingUp} testid="amc-kpi-renewal" sub={`${dashboard.expiring_30} end in 30 days`} />
              <Kpi label="Plants under AMC" value={`${dashboard.penetration_pct}%`} icon={Zap} testid="amc-kpi-penetration" sub={`of ${dashboard.commissioned_projects} finished`} />
            </div>
            {viewOrg === ALL && byCompany.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="amc-by-company">
                {byCompany.map((r) => (
                  <div key={r.org_id || OURS} className={`rounded-xl border p-3 ${r.org_id ? 'border-violet-200 bg-violet-50/40' : 'border-emerald-200 bg-emerald-50/40'}`}>
                    <OrgChip jv={jv} orgId={r.org_id} />
                    <div className="mt-2 grid grid-cols-3 gap-2 text-sm"><div><p className="font-['Outfit'] text-lg font-bold tabular-nums">{r.active}</p><p className="text-[11px] text-slate-500">active</p></div>
                      <div><p className="font-['Outfit'] text-lg font-bold tabular-nums">{r.kw.toFixed(1)}</p><p className="text-[11px] text-slate-500">kW</p></div>
                      <div><p className="font-['Outfit'] text-lg font-bold tabular-nums">{inr(r.value)}</p><p className="text-[11px] text-slate-500">a year</p></div></div>
                  </div>
                ))}
              </div>
            )}
            {offerCount > 0 && (
              <button type="button" onClick={() => setTab('offers')} className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left" data-testid="amc-offers-banner">
                <CalendarClock className="h-5 w-5 text-amber-700" /><span className="flex-1 text-sm text-amber-900"><b>{offerCount}</b> customer{offerCount === 1 ? ' is' : 's are'} ready for an AMC offer</span><span className="text-sm font-medium text-amber-800">See them →</span>
              </button>
            )}
            {!isPartner && (viewOrg === OURS || viewOrg === ALL) ? <AmcOpsPanel canManage={ourManager} canComplete={canEdit} /> : <AmcOpsPanel canManage={false} canComplete={canEdit} partnerMode />}
            {capacityChartData.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="mb-2 text-sm font-semibold text-slate-900">kW under AMC by system type</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={capacityChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                    <Bar dataKey="value" name="kW" fill="#2a78d6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {tab === 'offers' && <OffersTab jv={jv} org={viewOrg} canEdit={canEdit} onQuote={openQuote} reloadKey={reloadKey} />}
        {tab === 'quotes' && <QuotesTab jv={jv} org={viewOrg} canEdit={canEdit} reloadKey={reloadKey} onChanged={changed} />}
        {tab === 'partner' && <JvProjectsTab jv={jv} org={viewOrg} canEdit={canEdit} reloadKey={reloadKey} onChanged={changed} />}
        {tab === 'report' && <AmcReportTab jv={jv} org={viewOrg} />}
        {tab === 'support' && !isPartner && <SupportTicketsTab />}

        {tab === 'contracts' && (
          <div className="space-y-2" data-testid="amc-contracts-tab">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-600">{contracts.length} contract{contracts.length === 1 ? '' : 's'}{isPartner && ' · Sensoper contracts show without prices'}</p>
              <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="h-9 w-40" data-testid="amc-status-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.keys(STATUS_STYLES).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            </div>
            {contracts.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-500">No AMC contracts here yet</p>}
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {contracts.map((c) => (
                <div key={c.id} className={`rounded-xl border bg-white p-3 ${c.org_id ? 'border-violet-200' : 'border-slate-200'}`} data-testid={`amc-row-${c.id}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">{c.customer_name}<OrgChip jv={jv} orgId={c.org_id} /><Badge className={STATUS_STYLES[c.status] || ''}>{c.status}</Badge></p>
                      <p className="text-xs text-slate-500">{c.contract_number} · {c.system_type} {c.system_capacity_kw ? `${c.system_capacity_kw} kW` : ''}{c.plan_name ? ` · ${c.plan_name}` : ''} · ends {c.end_date}{c.district ? ` · ${c.district}` : ''}</p>
                      <p className="mt-0.5 text-xs text-slate-600">{c.money_hidden ? <span className="inline-flex items-center gap-1 text-slate-400" data-testid={`amc-money-hidden-${c.id}`}><EyeOff className="h-3 w-3" />Price private to Sensoper</span> : <>{inr(c.annual_value)} a year</>} · visits {c.visits_completed || 0}/{c.visits_per_year}</p>
                    </div>
                    {c.status === 'active' && (
                      <div className="flex flex-wrap gap-1.5">
                        {canEdit && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setVisitDlg({ contract: c, date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), tech: '', notes: '' })} data-testid={`amc-plan-visit-${c.id}`}>Plan visit</Button>}
                        {mine(c) && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleRenew(c)} data-testid={`renew-amc-${c.id}`}>Renew</Button>}
                        {mine(c) && <Button size="sm" variant="ghost" className="h-8 text-xs text-rose-600" onClick={() => handleCancel(c)} data-testid={`cancel-amc-${c.id}`}>Cancel</Button>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <QuoteBuilder open={quoteOpen} onOpenChange={setQuoteOpen} jv={jv} prefill={prefill} onSaved={() => { changed(); setTab('quotes'); }} />
      {isAdmin && <AmcSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={changed} />}
      {isAdmin && <JvPartnerSheet open={jvOpen} onOpenChange={setJvOpen} jv={jv} onChanged={() => { reloadJv(); changed(); }} />}

      <Dialog open={!!visitDlg} onOpenChange={(v) => !v && setVisitDlg(null)}>
        <DialogContent className="max-w-md" data-testid="amc-visit-dialog">
          <DialogHeader><DialogTitle>Plan a visit — {visitDlg?.contract.customer_name}</DialogTitle><DialogDescription>The customer gets a reminder 3 days and 1 day before.</DialogDescription></DialogHeader>
          {visitDlg && <div className="space-y-2">
            <div className="space-y-1"><Label className="text-xs">Date</Label><Input type="date" value={visitDlg.date} onChange={(e) => setVisitDlg((d) => ({ ...d, date: e.target.value }))} className="h-11" data-testid="amc-visit-date" /></div>
            <div className="space-y-1"><Label className="text-xs">Technician</Label><Input value={visitDlg.tech} onChange={(e) => setVisitDlg((d) => ({ ...d, tech: e.target.value }))} placeholder="Name" className="h-11" data-testid="amc-visit-tech" /></div>
            <div className="space-y-1"><Label className="text-xs">Note</Label><Input value={visitDlg.notes} onChange={(e) => setVisitDlg((d) => ({ ...d, notes: e.target.value }))} className="h-11" /></div>
          </div>}
          <DialogFooter><Button variant="ghost" onClick={() => setVisitDlg(null)}>Cancel</Button><Button onClick={scheduleVisit} disabled={saving || !visitDlg?.date} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="amc-visit-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Plan visit'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFromProject} onOpenChange={setShowFromProject}>
        <DialogContent data-testid="amc-from-project-dialog">
          <DialogHeader><DialogTitle>AMC for a finished project</DialogTitle><DialogDescription>Starts a 1-year contract at the default rate. To offer plans first, use New quote.</DialogDescription></DialogHeader>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="h-11" data-testid="amc-project-select"><SelectValue placeholder="Choose a finished project" /></SelectTrigger>
            <SelectContent>{completedProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.customer?.name} — {p.reference_number}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter><Button variant="outline" onClick={() => setShowFromProject(false)}>Cancel</Button><Button onClick={handleCreateFromProject} disabled={saving || !selectedProjectId} className="bg-emerald-600 text-white" data-testid="confirm-amc-from-project-btn">Create contract</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg" data-testid="create-amc-dialog">
          <DialogHeader><DialogTitle>New AMC contract</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {!isPartner && jv?.partners?.length > 0 && (
              <div className="col-span-2 space-y-1"><Label className="text-xs">Company</Label>
                <Select value={form.org_id || OURS} onValueChange={(v) => setForm((p) => ({ ...p, org_id: v === OURS ? '' : v }))}><SelectTrigger className="h-10" data-testid="amc-contract-org"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={OURS}>Sensoper (ours)</SelectItem>{jv.partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} (partner)</SelectItem>)}</SelectContent></Select></div>
            )}
            <Input placeholder="Customer name" value={form.customer_name} onChange={(e) => setForm((p) => ({ ...p, customer_name: e.target.value }))} className="col-span-2 h-10" data-testid="amc-customer-input" />
            <Input placeholder="Phone" value={form.contact} onChange={(e) => setForm((p) => ({ ...p, contact: e.target.value }))} className="h-10" />
            <Input placeholder="District" value={form.district} onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))} className="h-10" />
            <Select value={form.system_type} onValueChange={(v) => setForm((p) => ({ ...p, system_type: v }))}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="on-grid">On-grid</SelectItem><SelectItem value="off-grid">Off-grid</SelectItem><SelectItem value="hybrid">Hybrid</SelectItem><SelectItem value="solar-pump">Solar pump</SelectItem></SelectContent></Select>
            <Input type="number" placeholder="Size (kW)" value={form.system_capacity_kw} onChange={(e) => setForm((p) => ({ ...p, system_capacity_kw: e.target.value }))} className="h-10" />
            <Select value={form.contract_type} onValueChange={(v) => setForm((p) => ({ ...p, contract_type: v }))}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="comprehensive">Comprehensive</SelectItem><SelectItem value="non-comprehensive">Non-comprehensive</SelectItem><SelectItem value="labour-only">Labour only</SelectItem></SelectContent></Select>
            <div className="space-y-1"><Label className="text-[11px] text-slate-500">Starts on</Label><Input type="date" value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} className="h-10" data-testid="amc-start-date-input" /></div>
            <Input type="number" placeholder="Months" value={form.duration_months} onChange={(e) => setForm((p) => ({ ...p, duration_months: e.target.value }))} className="h-10 self-end" />
            <Input type="number" placeholder="Yearly value (₹)" value={form.annual_value} onChange={(e) => setForm((p) => ({ ...p, annual_value: e.target.value }))} className="h-10" data-testid="amc-value-input" />
            <Select value={form.billing_frequency} onValueChange={(v) => setForm((p) => ({ ...p, billing_frequency: v }))}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="half-yearly">Half-yearly</SelectItem><SelectItem value="annual">Yearly</SelectItem></SelectContent></Select>
            <Input type="number" placeholder="Visits a year" value={form.visits_per_year} onChange={(e) => setForm((p) => ({ ...p, visits_per_year: e.target.value }))} className="h-10" />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={handleCreate} disabled={saving || !form.customer_name || !form.start_date} className="bg-emerald-600 text-white" data-testid="save-amc-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
