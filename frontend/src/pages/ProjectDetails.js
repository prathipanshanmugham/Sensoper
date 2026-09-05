import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsAPI, termsAPI, companyAPI, marginAPI, uploadAPI, inventoryAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { 
  ArrowLeft, Loader2, User, MapPin, Zap, Sun, Clock, CheckCircle2, XCircle, 
  AlertCircle, Download, Share2, Trash2, Send, AlertTriangle, Package, Percent, 
  Video, Upload, Film, Pencil, Save, X, MessageSquare, QrCode, FolderOpen, Camera, Ruler,
  ExternalLink, Copy, FileSpreadsheet, Lock, Eye, EyeOff
} from 'lucide-react';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const API_URL = process.env.REACT_APP_BACKEND_URL;

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-amber-100 text-amber-800', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-800', icon: AlertCircle },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800', icon: XCircle },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  deletion_requested: { label: 'Deletion Requested', color: 'bg-orange-100 text-orange-800', icon: Trash2 }
};

const ALL_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'completed'];

function InfoRow({ label, value }) {
  // Iter 41 Change 1 — omit rows with no real value instead of printing "-" or "0"
  if (value === null || value === undefined || value === '' || value === '- ' || value === '-') return null;
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900 text-right max-w-[60%]">{value}</span>
    </div>
  );
}

import SubsidyTrackingCard from '../components/SubsidyTrackingCard';
import KitPriceExplainerModal from '../components/KitPriceExplainerModal';
import MaterialReconciliationCard from '../components/MaterialReconciliationCard';
import { generateKitQuotationPDF } from '../utils/kitQuotationPDF';
import { generateDetailedQuotationPDF } from '../utils/detailedQuotationPDF';
import { catalogueAPI } from '../utils/api';
import ProjectInvoiceCard from '../components/ProjectInvoiceCard';
import ProjectProfitCard from '../components/ProjectProfitCard';
import ProjectPartnerCard from '../components/ProjectPartnerCard';

const CATEGORY_LABELS = { solar_panels: 'Solar Panels', inverters: 'Inverters', batteries: 'Batteries', mounting_structures: 'Mounting Structures', cables_accessories: 'Cables & Accessories' };

export default function ProjectDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin, isManager, isStaff } = useAuth();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showKitExplainer, setShowKitExplainer] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');
  const [terms, setTerms] = useState(null);
  const [invoiceTerms, setInvoiceTerms] = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [itemMargins, setItemMargins] = useState({});
  const [marginLoading, setMarginLoading] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completionDriveLink, setCompletionDriveLink] = useState('');
  const [inverterLogin, setInverterLogin] = useState({ url: '', username: '', password: '', notes: '' });
  const [showInverterPwd, setShowInverterPwd] = useState(false);
  const [customerFeedback, setCustomerFeedback] = useState('');
  // Editable ref and status
  const [editingRef, setEditingRef] = useState(false);
  const [refValue, setRefValue] = useState('');
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusValue, setStatusValue] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [showDriveQR, setShowDriveQR] = useState(false);
  // Project Notes (universal — editable at any status, history of appends)
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [appendingNote, setAppendingNote] = useState(false);

  const fetchProject = useCallback(async () => {
    try {
      const res = await projectsAPI.getOne(id);
      setProject(res.data);
      setRefValue(res.data.reference_number || '');
      setStatusValue(res.data.status || 'draft');
      const margins = {};
      (res.data.selected_items || []).forEach((item, idx) => { margins[idx] = item.margin_percentage || 0; });
      setItemMargins(margins);
      // Load terms — prefer project's selected template, fall back to active
      let quoteLang = 'en';
      try {
        if (res.data.terms_id) {
          const tRes = await termsAPI.getById(res.data.terms_id);
          setTerms(tRes.data);
          quoteLang = tRes.data.language || 'en';
        } else {
          const tRes = await termsAPI.getActive('en', 'quotation');
          setTerms(tRes.data);
        }
      } catch (e) {
        // Fall back to active if the specific terms_id lookup fails (e.g., template deleted)
        try { const fb = await termsAPI.getActive('en', 'quotation'); setTerms(fb.data); } catch (e2) { console.error('Failed to fetch terms:', e2); }
      }
      // Invoice terms use the same category system but are chosen at the template
      // level (no per-project invoice_terms_id) — matched to the quotation's language.
      try { const iRes = await termsAPI.getActive(quoteLang, 'invoice'); setInvoiceTerms(iRes.data); } catch (e) { console.error('Failed to fetch invoice terms:', e); }
    } catch (error) { navigate('/dashboard/projects'); }
    finally { setLoading(false); }
  }, [id, navigate]);

  useEffect(() => { fetchProject(); fetchCompanyProfile(); }, [fetchProject]);

  const fetchCompanyProfile = async () => { try { const res = await companyAPI.getActive(); setCompanyProfile(res.data); } catch (e) { console.error('Failed to fetch company profile:', e); } };

  const handleSubmit = async () => { setActionLoading(true); try { await projectsAPI.submit(id); fetchProject(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); } };
  const handleApprove = async () => { setActionLoading(true); try { await projectsAPI.approve(id); fetchProject(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); } };
  const handleReject = async () => { setActionLoading(true); try { await projectsAPI.reject(id, rejectReason); setShowRejectDialog(false); setRejectReason(''); fetchProject(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); } };

  const handleSaveRef = async () => {
    try { await projectsAPI.updateReference(id, refValue); setEditingRef(false); fetchProject(); }
    catch (e) { alert(e.response?.data?.detail || 'Failed'); }
  };

  const handleSaveStatus = async () => {
    try { await projectsAPI.updateStatus(id, statusValue); setEditingStatus(false); fetchProject(); }
    catch (e) { alert(e.response?.data?.detail || 'Failed'); }
  };

  // ---------- Universal project notes ----------
  const startEditNotes = () => {
    setNotesDraft(project?.notes || '');
    setEditingNotes(true);
  };
  const cancelEditNotes = () => { setEditingNotes(false); setNotesDraft(''); };
  const handleSaveNotes = async () => {
    setNotesSaving(true);
    try {
      await projectsAPI.updateNotes(id, notesDraft);
      setEditingNotes(false);
      fetchProject();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to save notes');
    } finally { setNotesSaving(false); }
  };
  const handleAppendNote = async () => {
    const text = newNoteText.trim();
    if (!text) return;
    setAppendingNote(true);
    try {
      await projectsAPI.appendNote(id, text);
      setNewNoteText('');
      fetchProject();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to append note');
    } finally { setAppendingNote(false); }
  };

  const handleComplete = async () => {
    const link = completionDriveLink.trim();
    if (!link) { alert('Please enter the Completion Google Drive link.'); return; }
    if (!(link.startsWith('http://') || link.startsWith('https://'))) { alert('Drive link must start with http:// or https://'); return; }
    setActionLoading(true);
    try {
      await projectsAPI.complete(id, {
        completion_drive_link: link,
        inverter_login: inverterLogin,
        customer_feedback: customerFeedback
      });
      setShowCompleteDialog(false);
      setCompletionDriveLink('');
      setInverterLogin({ url: '', username: '', password: '', notes: '' });
      setCustomerFeedback('');
      fetchProject();
    } catch (e) { alert(e.response?.data?.detail || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const handleRequestDeletion = async () => { setActionLoading(true); try { await projectsAPI.requestDeletion(id, deletionReason); setShowDeleteDialog(false); setDeletionReason(''); fetchProject(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); } };
  const handleForceDelete = async () => { if (!window.confirm('Permanently delete this project?')) return; setActionLoading(true); try { await projectsAPI.forceDelete(id); navigate('/dashboard/projects'); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); } };

  const handleMarginUpdate = async () => {
    const updates = Object.entries(itemMargins).map(([idx, pct]) => ({ index: parseInt(idx), margin_percentage: parseFloat(pct) || 0 }));
    if (updates.length === 0) return;
    setMarginLoading(true);
    try {
      const res = await marginAPI.update(id, updates);
      setProject(prev => ({ ...prev, cost_estimation: res.data.cost_estimation, selected_items: res.data.selected_items }));
    } catch (e) { alert(e.response?.data?.detail || 'Failed'); }
    finally { setMarginLoading(false); }
  };

  const loadImageAsBase64 = (url) => new Promise((resolve) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); resolve(c.toDataURL('image/png')); };
    img.onerror = () => resolve(null); img.src = url;
  });

  const generatePDF = async () => {
    let refSummary = null, stats = null, inventoryNames = {};
    if (project.reference_project_id) { try { refSummary = (await projectsAPI.getReferenceSummary(project.reference_project_id)).data; } catch (e) { console.warn('Reference summary unavailable', e); } }
    try { stats = (await companyAPI.salesStats()).data; } catch (e) { console.warn('Sales stats unavailable', e); }
    try { (await inventoryAPI.getItems({})).data.forEach(i => { inventoryNames[i.id] = i.name; }); } catch (e) { console.warn('Inventory names unavailable', e); }
    await generateDetailedQuotationPDF({ project: { ...project, id }, companyProfile, terms, refSummary, stats, categoryLabels: CATEGORY_LABELS, apiUrl: API_URL, inventoryNames });
  };

  const generateExcel = () => {
    const cp = companyProfile || {};
    const wb = XLSX.utils.book_new();

    const overview = [
      ['Company', cp.company_name || 'Sensoper Controls & Renewables'],
      ['Project Ref', project.reference_number || `SCR-${id.slice(0,8).toUpperCase()}`],
      ['Status', (project.status || 'draft').toUpperCase()],
      ['Created By', project.created_by_name || '-'],
      ['Created At', new Date(project.created_at).toLocaleDateString('en-IN')],
      [],
      ['— Customer —'],
      ['Name', project.customer?.name || '-'],
      ['Phone', project.customer?.phone || '-'],
      ['Email', project.customer?.email || '-'],
      ['Address', project.customer?.address || '-'],
      [],
      ['— Location & Mounting —'],
      ['Address', project.location?.address || '-'],
      ['What3Words', project.location?.site_location_words || '-'],
      ['Roof Type', project.mounting?.roof_type || '-'],
      ['Structure', project.mounting?.structure_type || '-'],
      ['Tilt', `${project.mounting?.tilt_angle || 0}°`],
      [],
      ['— Electrical —'],
      ['Service Type', project.electrical?.service_type || '-'],
      ['Connection Phase', project.electrical?.connection_phase || '-'],
      ['Sanction Load (kW)', project.electrical?.sanction_load_kw || 0],
      ['Connected Load (kW)', project.electrical?.connected_load_kw ?? project.site_measurements?.load?.connected_load ?? 0],
      ['Monthly Consumption (units)', project.electrical?.monthly_consumption_units ?? project.site_measurements?.load?.monthly_units ?? 0],
      ['EB Tariff (₹/unit)', project.electrical?.eb_tariff || 0],
      ['System Type', project.solar_system?.system_type || '-'],
      ['Cable Length (m)', project.additional?.cable_length_meters || 0],
      ['Inverter to Panel (m)', project.additional?.inverter_to_panel_distance || 0],
      [],
      ['— Cost Summary —'],
      ['Subtotal (₹)', (project.cost_estimation || {}).subtotal || 0],
      ['GST (₹)', (project.cost_estimation || {}).total_gst || 0],
      ['Margin (₹)', (project.cost_estimation || {}).total_margin || 0],
      ['TOTAL (₹)', (project.cost_estimation || {}).total_cost || 0],
    ];
    const overviewWs = XLSX.utils.aoa_to_sheet(overview);
    overviewWs['!cols'] = [{ wch: 30 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, overviewWs, 'Overview');

    const items = project.cost_estimation?.items_breakdown || project.selected_items || [];
    if (items.length > 0) {
      const matsRows = items.map(item => ({
        Item: item.name,
        Category: CATEGORY_LABELS[item.category] || item.category,
        SKU: item.sku_code || '-',
        Quantity: item.quantity,
        'Unit Price (₹)': item.unit_price || 0,
        'GST %': item.gst_percentage || 18,
        'Margin %': item.margin_percentage || 0,
        'Amount (₹)': item.amount || (item.unit_price * item.quantity)
      }));
      const matsWs = XLSX.utils.json_to_sheet(matsRows);
      matsWs['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, matsWs, 'Materials');
    }

    const manualCosts = project.cost_estimation?.manual_costs || project.manual_costs || [];
    if (manualCosts.length > 0) {
      const mcRows = manualCosts.map(c => ({ Description: c.description, 'Amount (₹)': c.amount || 0 }));
      const mcWs = XLSX.utils.json_to_sheet(mcRows);
      mcWs['!cols'] = [{ wch: 40 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, mcWs, 'Manual Costs');
    }

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const refNum = project.reference_number || `SCR-${id.slice(0,8).toUpperCase()}`;
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Project-${refNum}-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const shareViaWhatsApp = () => {
    const message = encodeURIComponent(`*Solar Project Quotation*\n\nCustomer: ${project.customer?.name}\nRef: ${project.reference_number || ''}\nSystem: ${project.solar_system?.system_type}\nTotal: ₹${(project.cost_estimation?.total_cost || 0).toLocaleString('en-IN')}\n\nFrom: ${companyProfile?.company_name || 'Sensoper Controls & Renewables'}`);
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  if (!project) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><p>Project not found</p></div>;

  const config = statusConfig[project.status] || statusConfig.draft;
  const StatusIcon = config.icon;
  const canSubmit = project.status === 'draft' && (project.created_by === user?.id || isAdmin || isManager);
  const canReview = (isAdmin || isManager) && project.status === 'submitted';
  const canComplete = (isAdmin || isManager) && project.status === 'approved';
  const canRequestDeletion = isStaff && project.status === 'draft' && project.created_by === user?.id;
  const canForceDelete = isAdmin;
  const isDeletionPending = project.status === 'deletion_requested';
  const canEdit = (project.status === 'draft' && (project.created_by === user?.id || isAdmin || isManager)) || ((isAdmin || isManager) && project.status === 'approved');
  const canEditRefStatus = isAdmin || isManager;

  const selectedItems = project.cost_estimation?.items_breakdown || project.selected_items || [];
  const manualCosts = project.cost_estimation?.manual_costs || project.manual_costs || [];
  const ce = project.cost_estimation || {};

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard/projects"><Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">{project.customer?.name}</h1>
                {/* Editable Status */}
                {canEditRefStatus && !editingStatus ? (
                  <Badge className={`${config.color} gap-1 cursor-pointer hover:ring-2 hover:ring-slate-300`} onClick={() => setEditingStatus(true)} data-testid="status-badge"><StatusIcon className="h-3 w-3" />{config.label}<Pencil className="h-2.5 w-2.5 ml-1" /></Badge>
                ) : editingStatus ? (
                  <div className="flex items-center gap-1">
                    <Select value={statusValue} onValueChange={setStatusValue}>
                      <SelectTrigger className="h-8 w-36 text-xs" data-testid="status-select"><SelectValue /></SelectTrigger>
                      <SelectContent>{ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={handleSaveStatus} data-testid="save-status-btn"><Save className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400" onClick={() => { setEditingStatus(false); setStatusValue(project.status); }}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <Badge className={`${config.color} gap-1`}><StatusIcon className="h-3 w-3" />{config.label}</Badge>
                )}
              </div>
              {/* Editable Reference */}
              <div className="flex items-center gap-2 mt-0.5">
                {editingRef ? (
                  <div className="flex items-center gap-1">
                    <Input value={refValue} onChange={(e) => setRefValue(e.target.value)} className="h-7 w-40 text-xs" data-testid="ref-input" />
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={handleSaveRef} data-testid="save-ref-btn"><Save className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400" onClick={() => { setEditingRef(false); setRefValue(project.reference_number || ''); }}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <p className="text-slate-500">
                    <span className="font-mono text-xs">{project.reference_number || `SCR-${id.slice(0,6).toUpperCase()}`}</span>
                    {canEditRefStatus && <button onClick={() => setEditingRef(true)} className="ml-1.5 text-slate-400 hover:text-slate-600" data-testid="edit-ref-btn"><Pencil className="h-3 w-3 inline" /></button>}
                    <span className="mx-2">&bull;</span>Created by {project.created_by_name} &bull; {new Date(project.created_at).toLocaleDateString('en-IN')}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {canEdit && (
              <Link to={`/dashboard/projects/${id}/edit`}><Button variant="outline" className="gap-2" data-testid="edit-project-btn"><Pencil className="h-4 w-4" />Edit</Button></Link>
            )}
            <Button variant="outline" onClick={generateExcel} className="gap-2" data-testid="download-excel-btn"><FileSpreadsheet className="h-4 w-4" />Excel</Button>
            <Button variant="outline" onClick={generatePDF} className="gap-2" data-testid="download-pdf-btn"><Download className="h-4 w-4" />Detailed PDF</Button>
            <Button variant="outline" onClick={async () => {
              try {
                const [cfg, groups, stats] = await Promise.all([
                  catalogueAPI.getConfig(),
                  catalogueAPI.addonGroups(),
                  companyAPI.salesStats().catch(() => ({ data: null })),
                ]);
                await generateKitQuotationPDF({ ...project, id }, companyProfile, cfg.data, groups.data, terms, { stats: stats.data, apiUrl: API_URL });
              } catch (e) { alert('Kit PDF failed: ' + (e.message || 'unknown')); }
            }} className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50" data-testid="download-kit-pdf-btn"><Download className="h-4 w-4" />Kit Quotation</Button>
            <Button variant="ghost" onClick={() => setShowKitExplainer(true)} className="gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100" data-testid="explain-kit-price-btn" title="Sales-side breakdown vs customer-side lump sum"><FileSpreadsheet className="h-4 w-4" />Explain</Button>
            {(project.status === 'approved' || project.status === 'completed') && (
              <Button variant="outline" onClick={shareViaWhatsApp} className="gap-2" data-testid="share-whatsapp-btn"><Share2 className="h-4 w-4" />WhatsApp</Button>
            )}
            {(isAdmin || isManager) && <ProjectInvoiceCard projectId={id} companyProfile={companyProfile} terms={invoiceTerms} />}
          </div>
        </div>

        {isDeletionPending && project.deletion_request && (
          <Card className="border-orange-200 bg-orange-50 mb-6"><CardContent className="p-4 flex items-start gap-3"><AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" /><div><p className="font-medium text-orange-800">Deletion Request Pending</p><p className="text-sm text-orange-700">Requested by {project.deletion_request.requested_by} &bull; Reason: {project.deletion_request.reason}</p></div></CardContent></Card>
        )}
        {project.status === 'rejected' && project.rejection_reason && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg"><p className="text-sm font-medium text-red-800">Rejection Reason:</p><p className="text-red-700">{project.rejection_reason}</p></div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Customer */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><User className="h-5 w-5 text-emerald-600" />Customer Details</CardTitle></CardHeader>
              <CardContent>
                <InfoRow label="Name" value={project.customer?.name} /><InfoRow label="Phone" value={project.customer?.phone} />
                <InfoRow label="Email" value={project.customer?.email} /><InfoRow label="Address" value={project.customer?.address} />
              </CardContent>
            </Card>

            {/* Location */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><MapPin className="h-5 w-5 text-emerald-600" />Site Location</CardTitle></CardHeader>
              <CardContent>
                {project.location?.site_location_words && <div className="flex justify-between py-2 border-b border-slate-100"><span className="text-slate-500">What3Words</span><span className="font-mono font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">{project.location.site_location_words}</span></div>}
                <InfoRow label="Address" value={project.location?.address} /><InfoRow label="Roof Type" value={project.mounting?.roof_type?.toUpperCase()} />
                <InfoRow label="Tilt Angle" value={`${project.mounting?.tilt_angle}\u00B0`} /><InfoRow label="Structure Type" value={project.mounting?.structure_type} />
              </CardContent>
            </Card>

            {/* Electrical */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><Zap className="h-5 w-5 text-emerald-600" />Electrical Details</CardTitle></CardHeader>
              <CardContent>
                <InfoRow label="Type of Service" value={project.electrical?.service_type} />
                <InfoRow label="Connection Phase" value={project.electrical?.connection_phase} />
                <InfoRow label="Sanction Load" value={project.electrical?.sanction_load_kw ? `${project.electrical.sanction_load_kw} kW` : null} />
                <InfoRow label="Connected Load" value={(project.electrical?.connected_load_kw ?? project.site_measurements?.load?.connected_load) ? `${project.electrical?.connected_load_kw ?? project.site_measurements?.load?.connected_load} kW` : null} />
                <InfoRow label="Monthly Consumption" value={(project.electrical?.monthly_consumption_units ?? project.site_measurements?.load?.monthly_units) ? `${project.electrical?.monthly_consumption_units ?? project.site_measurements?.load?.monthly_units} units` : null} />
                <InfoRow label="EB Tariff" value={project.electrical?.eb_tariff ? `₹${project.electrical.eb_tariff}/unit` : null} />
                <InfoRow label="Cable Length (roof → DB)" value={project.additional?.cable_length_meters ? `${project.additional.cable_length_meters} m` : null} />
                <InfoRow label="Inverter → Panel" value={project.additional?.inverter_to_panel_distance ? `${project.additional.inverter_to_panel_distance} m` : null} />
                <InfoRow label="Complexity" value={project.additional?.installation_complexity?.toUpperCase()} />
              </CardContent>
            </Card>

            {/* System */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><Sun className="h-5 w-5 text-emerald-600" />System Configuration</CardTitle></CardHeader>
              <CardContent>
                <InfoRow label="System Type" value={project.solar_system?.system_type?.toUpperCase()} />
                {project.solar_system?.battery_required && <InfoRow label="Battery Required" value="Yes" />}
                {(() => {
                  const ps = project.custom_fields?.proposed_solution || {};
                  const st = ps.system_type || project.solar_system?.system_type;
                  if (st === 'solar-pump') {
                    return (
                      <div className="mt-3 pt-3 border-t border-slate-200" data-testid="pump-details-block">
                        <p className="text-[10px] uppercase tracking-wider text-cyan-700 font-semibold mb-2">Solar Pump Details</p>
                        <InfoRow label="Pump Rating" value={ps.pump_hp ? `${ps.pump_hp} HP` : '-'} />
                        <InfoRow label="Pump Type" value={ps.pump_type || '-'} />
                        <InfoRow label="Total Head" value={ps.pump_head_m ? `${ps.pump_head_m} m` : '-'} />
                        <InfoRow label="Discharge" value={ps.pump_discharge_lph ? `${ps.pump_discharge_lph} LPH` : '-'} />
                        <InfoRow label="Controller" value={ps.pump_controller_type || '-'} />
                        <InfoRow label="Water Source" value={ps.pump_water_source || '-'} />
                      </div>
                    );
                  }
                  if (st === 'on-grid') {
                    return (
                      <div className="mt-3 pt-3 border-t border-slate-200" data-testid="ongrid-details-block">
                        <p className="text-[10px] uppercase tracking-wider text-blue-700 font-semibold mb-2">On-Grid Details</p>
                        <InfoRow label="Net Metering" value={ps.net_metering === false ? 'Gross' : 'Bi-directional'} />
                        {ps.export_limit_kw && <InfoRow label="Export Limit" value={`${ps.export_limit_kw} kW`} />}
                      </div>
                    );
                  }
                  if (st === 'off-grid') {
                    return (
                      <div className="mt-3 pt-3 border-t border-slate-200" data-testid="offgrid-details-block">
                        <p className="text-[10px] uppercase tracking-wider text-orange-700 font-semibold mb-2">Off-Grid Details</p>
                        <InfoRow label="Charge Controller" value={ps.charge_controller_type || '-'} />
                        <InfoRow label="Depth of Discharge" value={ps.battery_dod_pct ? `${ps.battery_dod_pct}%` : '-'} />
                        <InfoRow label="Autonomy" value={ps.autonomy_days ? `${ps.autonomy_days} day(s)` : '-'} />
                      </div>
                    );
                  }
                  if (st === 'hybrid') {
                    return (
                      <div className="mt-3 pt-3 border-t border-slate-200" data-testid="hybrid-details-block">
                        <p className="text-[10px] uppercase tracking-wider text-violet-700 font-semibold mb-2">Hybrid Details</p>
                        <InfoRow label="Battery Chemistry" value={ps.battery_chemistry || '-'} />
                        <InfoRow label="Grid Charging" value={ps.grid_charge_enabled === false ? 'Solar-only' : 'Allowed'} />
                        <InfoRow label="Depth of Discharge" value={ps.battery_dod_pct ? `${ps.battery_dod_pct}%` : '-'} />
                      </div>
                    );
                  }
                  return null;
                })()}
              </CardContent>
            </Card>

            {/* Universal Project Notes — editable at any status, with timestamped history */}
            <Card className="border-slate-200" data-testid="project-notes-card">
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-indigo-600" />Notes
                </CardTitle>
                {!editingNotes && (
                  <Button variant="outline" size="sm" onClick={startEditNotes} className="h-8 gap-1.5" data-testid="edit-notes-btn">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Main notes block */}
                {editingNotes ? (
                  <div className="space-y-2">
                    <Textarea
                      rows={4}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="General notes about this project — observations, customer remarks, follow-ups, instructions…"
                      className="min-h-[100px]"
                      data-testid="notes-edit-textarea"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={cancelEditNotes} disabled={notesSaving} data-testid="notes-cancel-btn">Cancel</Button>
                      <Button size="sm" onClick={handleSaveNotes} disabled={notesSaving} className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="notes-save-btn">
                        {notesSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 rounded-lg min-h-[60px]" data-testid="notes-display">
                    {project.notes
                      ? <p className="text-sm text-slate-700 whitespace-pre-wrap">{project.notes}</p>
                      : <p className="text-sm text-slate-400 italic">No notes yet — click Edit to add some.</p>}
                  </div>
                )}

                {/* Append a timestamped update */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <Label className="text-xs uppercase tracking-wider text-slate-500">Append timestamped update</Label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Textarea
                      rows={2}
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      placeholder="e.g., 21-May 2026 — Visited site, customer happy with installation."
                      className="min-h-[44px] flex-1"
                      data-testid="notes-append-textarea"
                    />
                    <Button
                      size="sm"
                      onClick={handleAppendNote}
                      disabled={appendingNote || !newNoteText.trim()}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white sm:self-end"
                      data-testid="notes-append-btn"
                    >
                      {appendingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Append
                    </Button>
                  </div>
                  <p className="text-[10px] text-slate-400">Timestamped entries are kept forever — useful for service visits, follow-ups, customer feedback (even after the project is completed).</p>
                </div>

                {/* History */}
                {(project.notes_history && project.notes_history.length > 0) && (
                  <div className="pt-2 border-t border-slate-100">
                    <Label className="text-xs uppercase tracking-wider text-slate-500 mb-2 block">History ({project.notes_history.length})</Label>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1" data-testid="notes-history-list">
                      {[...project.notes_history].reverse().map((h) => (
                        <div key={h.id || h.timestamp} className="p-2.5 bg-indigo-50/50 border border-indigo-100 rounded-md" data-testid={`notes-history-entry-${h.id || h.timestamp}`}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[10px] font-semibold text-indigo-700">{h.author_name || 'User'}</span>
                            <span className="text-[10px] text-slate-500">{new Date(h.timestamp).toLocaleString('en-IN')}</span>
                          </div>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{h.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Legacy display: original shadow_analysis_notes if no migrated notes yet */}
                {!project.notes && project.additional?.shadow_analysis_notes && (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-800 mb-1">Legacy shadow notes (auto-migrated)</p>
                    <p className="text-sm text-slate-700">{project.additional.shadow_analysis_notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Subsidy Tracking widget — lifecycle timeline + amounts + dates */}
            <SubsidyTrackingCard projectId={id} />

            {/* Excess Material Reconciliation — required once a project is completed (Iter 42 Change 4) */}
            {project.status === 'completed' && <MaterialReconciliationCard projectId={id} />}

            {/* Profit Calculator — admin only, reads the same cost_estimation as everything else (Iter 44 Batch A) */}
            <ProjectProfitCard projectId={id} isAdmin={isAdmin} />

            {/* Labour & Subcontractor assignment — inline from Project Details (Iter 46 Change 1 / Task 3) */}
            {(isAdmin || isManager) && <ProjectPartnerCard projectId={id} canManage={isAdmin || isManager} />}

            {/* Site Documentation */}
            {project.drive_folder_link && (
              <Card className="border-slate-200">
                <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><FolderOpen className="h-5 w-5 text-blue-600" />Site Documentation</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {project.drive_folder_name && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500">Folder:</span>
                      <span className="font-medium text-slate-800" data-testid="drive-folder-name">{project.drive_folder_name}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <a href={project.drive_folder_link} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" className="gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50" data-testid="open-drive-folder-btn">
                        <ExternalLink className="h-4 w-4" /> Open Folder
                      </Button>
                    </a>
                    <Button
                      variant="outline"
                      className={`gap-2 ${linkCopied ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                      onClick={() => {
                        navigator.clipboard.writeText(project.drive_folder_link);
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2000);
                      }}
                      data-testid="copy-drive-link-btn"
                    >
                      <Copy className="h-4 w-4" /> {linkCopied ? 'Copied!' : 'Copy Link'}
                    </Button>
                    <Button
                      variant="outline"
                      className={`gap-2 ${showDriveQR ? 'text-emerald-600 border-emerald-300 bg-emerald-50' : ''}`}
                      onClick={() => setShowDriveQR(!showDriveQR)}
                      data-testid="toggle-qr-preview-btn"
                    >
                      <QrCode className="h-4 w-4" /> {showDriveQR ? 'Hide QR' : 'QR Preview'}
                    </Button>
                  </div>
                  {showDriveQR && (
                    <div className="flex flex-col items-center p-4 bg-white border border-slate-200 rounded-lg w-fit">
                      <img
                        id="drive-qr-preview"
                        alt="Drive folder QR code"
                        className="w-40 h-40"
                        data-testid="drive-qr-preview"
                        ref={(el) => {
                          if (el && project.drive_folder_link) {
                            QRCode.toDataURL(project.drive_folder_link, { width: 300, margin: 1 })
                              .then(url => { el.src = url; })
                              .catch(() => {});
                          }
                        }}
                      />
                      <p className="text-xs text-slate-500 mt-2 text-center max-w-[200px] break-all">{project.drive_folder_link}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Site Measurements */}
            {project.site_measurements && Object.keys(project.site_measurements).length > 0 && (
              <Card className="border-slate-200" data-testid="site-measurements-card">
                <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><Ruler className="h-5 w-5 text-orange-500" />Site Measurements</CardTitle></CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {project.site_measurements.roof && (project.site_measurements.roof.length || project.site_measurements.roof.type) && (
                    <div><p className="font-semibold text-slate-700 mb-1.5">Roof Details</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-slate-600">
                        {project.site_measurements.roof.length && <p>Length: <span className="font-medium text-slate-800">{project.site_measurements.roof.length} ft</span></p>}
                        {project.site_measurements.roof.width && <p>Width: <span className="font-medium text-slate-800">{project.site_measurements.roof.width} ft</span></p>}
                        {project.site_measurements.roof.area && <p>Area: <span className="font-medium text-slate-800">{project.site_measurements.roof.area} sq ft</span></p>}
                        {project.site_measurements.roof.type && <p>Type: <span className="font-medium text-slate-800">{project.site_measurements.roof.type}</span></p>}
                        {project.site_measurements.roof.height && <p>Height: <span className="font-medium text-slate-800">{project.site_measurements.roof.height} ft</span></p>}
                      </div>
                    </div>
                  )}
                  {project.site_measurements.orientation && (project.site_measurements.orientation.direction || project.site_measurements.orientation.tilt_angle) && (
                    <div><p className="font-semibold text-slate-700 mb-1.5">Orientation & Tilt</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
                        {project.site_measurements.orientation.direction && <p>Direction: <span className="font-medium text-slate-800">{project.site_measurements.orientation.direction}</span></p>}
                        {project.site_measurements.orientation.tilt_angle && <p>Tilt: <span className="font-medium text-slate-800">{project.site_measurements.orientation.tilt_angle} deg</span></p>}
                      </div>
                    </div>
                  )}
                  {project.site_measurements.shadow && project.site_measurements.shadow.present && (
                    <div><p className="font-semibold text-slate-700 mb-1.5">Shadow Analysis</p>
                      <div className="text-slate-600 space-y-0.5">
                        {project.site_measurements.shadow.sources?.length > 0 && <p>Sources: <span className="font-medium text-slate-800">{project.site_measurements.shadow.sources.join(', ')}</span></p>}
                        <div className="flex gap-4">
                          {project.site_measurements.shadow.obstruction_height && <p>Height: <span className="font-medium text-slate-800">{project.site_measurements.shadow.obstruction_height} ft</span></p>}
                          {project.site_measurements.shadow.distance && <p>Distance: <span className="font-medium text-slate-800">{project.site_measurements.shadow.distance} ft</span></p>}
                        </div>
                      </div>
                    </div>
                  )}
                  {project.site_measurements.obstructions?.length > 0 && (
                    <div><p className="font-semibold text-slate-700 mb-1.5">Obstructions</p>
                      <div className="flex flex-wrap gap-2">
                        {project.site_measurements.obstructions.map((o, i) => (
                          <span key={o.name || `obs-${i}`} className="px-2.5 py-1 bg-red-50 text-red-700 rounded-md text-xs border border-red-200">{o.name}{o.notes ? ` (${o.notes})` : ''}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {project.site_measurements.electrical && (project.site_measurements.electrical.meter_location || project.site_measurements.electrical.db_distance) && (
                    <div><p className="font-semibold text-slate-700 mb-1.5">Electrical</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-slate-600">
                        {project.site_measurements.electrical.meter_location && <p>Meter: <span className="font-medium text-slate-800">{project.site_measurements.electrical.meter_location}</span></p>}
                        {project.site_measurements.electrical.db_distance && <p>DB Dist: <span className="font-medium text-slate-800">{project.site_measurements.electrical.db_distance} ft</span></p>}
                        {project.site_measurements.electrical.cable_length && <p>Cable: <span className="font-medium text-slate-800">{project.site_measurements.electrical.cable_length} ft</span></p>}
                      </div>
                    </div>
                  )}
                  {project.site_measurements.load && (project.site_measurements.load.monthly_units || project.site_measurements.load.connection_type) && (
                    <div><p className="font-semibold text-slate-700 mb-1.5">Load</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-slate-600">
                        {project.site_measurements.load.monthly_units && <p>Monthly: <span className="font-medium text-slate-800">{project.site_measurements.load.monthly_units} units</span></p>}
                        {project.site_measurements.load.connected_load && <p>Load: <span className="font-medium text-slate-800">{project.site_measurements.load.connected_load} kW</span></p>}
                        {project.site_measurements.load.connection_type && <p>Type: <span className="font-medium text-slate-800">{project.site_measurements.load.connection_type}</span></p>}
                      </div>
                    </div>
                  )}
                  {project.site_measurements.inverter && (project.site_measurements.inverter.location || project.site_measurements.inverter.wall_space) && (
                    <div><p className="font-semibold text-slate-700 mb-1.5">Inverter & Earthing</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-slate-600">
                        {project.site_measurements.inverter.location && <p>Location: <span className="font-medium text-slate-800">{project.site_measurements.inverter.location}</span></p>}
                        {project.site_measurements.inverter.wall_space && <p>Wall Space: <span className="font-medium text-slate-800">{project.site_measurements.inverter.wall_space}</span></p>}
                        {project.site_measurements.inverter.earthing_available && <p>Earthing: <span className="font-medium text-slate-800">{project.site_measurements.inverter.earthing_available}</span></p>}
                        {project.site_measurements.inverter.earthing_distance && <p>Earthing Dist: <span className="font-medium text-slate-800">{project.site_measurements.inverter.earthing_distance} ft</span></p>}
                      </div>
                    </div>
                  )}
                  {project.site_measurements.access && (project.site_measurements.access.type || project.site_measurements.access.working_space) && (
                    <div><p className="font-semibold text-slate-700 mb-1.5">Access & Safety</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-slate-600">
                        {project.site_measurements.access.type && <p>Access: <span className="font-medium text-slate-800">{project.site_measurements.access.type}</span></p>}
                        {project.site_measurements.access.working_space && <p>Work Space: <span className="font-medium text-slate-800">{project.site_measurements.access.working_space}</span></p>}
                        {project.site_measurements.access.notes && <p className="col-span-2">Notes: <span className="font-medium text-slate-800">{project.site_measurements.access.notes}</span></p>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Completion & Handover (Drive link + Inverter login) */}
            {(project.completion_drive_link || (project.inverter_login && (project.inverter_login.url || project.inverter_login.username || project.inverter_login.notes))) && (
              <Card className="border-slate-200" data-testid="completion-handover-card">
                <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Completion & Handover</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {project.completion_drive_link && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Completion Photos / Videos (Drive)</p>
                      <a href={project.completion_drive_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-900 hover:underline break-all" data-testid="completion-drive-link">
                        <FolderOpen className="h-4 w-4 shrink-0" />{project.completion_drive_link}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                  )}
                  {project.inverter_login && (project.inverter_login.url || project.inverter_login.username || project.inverter_login.notes) && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5" data-testid="inverter-login-display">
                      <p className="text-xs uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1"><Lock className="h-3.5 w-3.5" />Inverter Login Details</p>
                      {project.inverter_login.url && (
                        <p className="text-sm text-slate-700"><span className="font-medium text-slate-500 inline-block w-24">URL:</span> <a href={project.inverter_login.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" data-testid="inverter-login-url">{project.inverter_login.url}</a></p>
                      )}
                      {project.inverter_login.username && (
                        <p className="text-sm text-slate-700"><span className="font-medium text-slate-500 inline-block w-24">Username:</span> <span className="font-mono" data-testid="inverter-login-username">{project.inverter_login.username}</span></p>
                      )}
                      {project.inverter_login.password && (
                        <p className="text-sm text-slate-700 flex items-center gap-2"><span className="font-medium text-slate-500 inline-block w-24">Password:</span>
                          <span className="font-mono" data-testid="inverter-login-password">{showInverterPwd ? project.inverter_login.password : '••••••••'}</span>
                          <button type="button" onClick={() => setShowInverterPwd(s => !s)} className="text-slate-400 hover:text-slate-700" aria-label={showInverterPwd ? 'Hide password' : 'Show password'} data-testid="reveal-inverter-pwd">{showInverterPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                          <button type="button" onClick={() => { navigator.clipboard.writeText(project.inverter_login.password); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); }} className="text-slate-400 hover:text-slate-700" aria-label="Copy password" data-testid="copy-inverter-pwd"><Copy className="h-3.5 w-3.5" /></button>
                          {linkCopied && <span className="text-[10px] text-emerald-600">Copied!</span>}
                        </p>
                      )}
                      {project.inverter_login.notes && (
                        <p className="text-sm text-slate-600 whitespace-pre-wrap"><span className="font-medium text-slate-500 inline-block w-24 align-top">Notes:</span> {project.inverter_login.notes}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Completion Media (legacy — kept for backward compat) */}
            {project.completion_media && project.completion_media.length > 0 && (
              <Card className="border-slate-200">
                <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><Film className="h-5 w-5 text-emerald-600" />Completion Media ({project.completion_media.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {project.completion_media.map((media, i) => (
                      <div key={media.storage_path || `media-${i}`} className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100" data-testid={`completion-media-${i}`}>
                        {media.content_type?.startsWith('video/') ? (
                          <div className="aspect-square flex flex-col items-center justify-center bg-slate-200"><Video className="h-8 w-8 text-slate-500 mb-1" /><p className="text-xs text-slate-500 px-2 text-center truncate w-full">{media.filename}</p><a href={`${API_URL}/api/files/${media.storage_path}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 mt-1">View</a></div>
                        ) : (
                          <a href={`${API_URL}/api/files/${media.storage_path}`} target="_blank" rel="noopener noreferrer" className="block aspect-square"><img src={`${API_URL}/api/files/${media.storage_path}`} alt={media.filename} className="w-full h-full object-cover" loading="lazy" /></a>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Customer Feedback */}
            {project.customer_feedback && (
              <Card className="border-slate-200">
                <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><MessageSquare className="h-5 w-5 text-emerald-600" />Customer Feedback</CardTitle></CardHeader>
                <CardContent><p className="text-slate-700 whitespace-pre-wrap">{project.customer_feedback}</p></CardContent>
              </Card>
            )}

            {/* Selected Materials Table */}
            {selectedItems.length > 0 && (
              <Card className="border-slate-200">
                <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><Package className="h-5 w-5 text-emerald-600" />Selected Materials</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-slate-50">
                        <th className="text-left py-2 px-4 font-semibold text-slate-600">Item</th><th className="text-left py-2 px-4 font-semibold text-slate-600">Category</th>
                        <th className="text-center py-2 px-4 font-semibold text-slate-600">Qty</th><th className="text-right py-2 px-4 font-semibold text-slate-600">Unit Price</th>
                        <th className="text-right py-2 px-4 font-semibold text-slate-600">GST</th><th className="text-right py-2 px-4 font-semibold text-slate-600">Amount</th>
                      </tr></thead>
                      <tbody>{selectedItems.map((item, i) => (
                        <tr key={item.inventory_item_id || `row-${i}`} className="border-b border-slate-100">
                          <td className="py-2 px-4 font-medium">{item.name}</td><td className="py-2 px-4 text-slate-500">{CATEGORY_LABELS[item.category] || item.category}</td>
                          <td className="py-2 px-4 text-center">{item.quantity}</td><td className="py-2 px-4 text-right">₹{(item.unit_price || 0).toLocaleString('en-IN')}</td>
                          <td className="py-2 px-4 text-right text-slate-500">{item.gst_percentage}%</td><td className="py-2 px-4 text-right font-medium">₹{(item.amount || item.unit_price * item.quantity).toLocaleString('en-IN')}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="border-slate-200 sticky top-6">
              <CardHeader className="pb-3 border-b border-slate-200"><CardTitle className="text-lg font-['Outfit']">Cost Summary</CardTitle></CardHeader>
              <CardContent className="pt-4">
                {selectedItems.map((item, i) => (
                  <div key={item.inventory_item_id || `cost-${i}`} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                    <span className="text-sm text-slate-500 truncate mr-2">{item.name} x{item.quantity}</span>
                    <span className="text-sm font-medium text-slate-900">₹{(item.amount || item.unit_price * item.quantity).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {manualCosts.map((c, i) => (
                  <div key={`m${i}`} className="flex justify-between py-1.5 border-b border-slate-100">
                    <span className="text-sm text-slate-500 italic">{c.description}</span><span className="text-sm font-medium text-slate-900">₹{(c.amount || 0).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                <div className="mt-4 pt-3 border-t border-slate-200 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><span className="font-medium">₹{(ce.subtotal || 0).toLocaleString('en-IN')}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-500">GST</span><span className="font-medium">₹{(ce.total_gst || 0).toLocaleString('en-IN')}</span></div>
                  
                  {(isAdmin || isManager) && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mt-2">
                      <div className="flex items-center gap-2 mb-2"><Percent className="h-4 w-4 text-amber-600" /><span className="text-sm font-medium text-amber-800">Per-Item Margin</span></div>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {selectedItems.map((item, idx) => (
                          <div key={item.inventory_item_id || `margin-${idx}`} className="flex items-center gap-2">
                            <span className="text-xs text-slate-600 truncate flex-1" title={item.name}>{item.name}</span>
                            <Input type="number" min="0" max="100" step="0.5" value={itemMargins[idx] ?? item.margin_percentage ?? 0} onChange={(e) => setItemMargins(prev => ({ ...prev, [idx]: parseFloat(e.target.value) || 0 }))} className="h-7 w-16 text-xs text-center" data-testid={`margin-item-${idx}`} />
                            <span className="text-xs text-slate-500">%</span>
                          </div>
                        ))}
                      </div>
                      <Button size="sm" onClick={handleMarginUpdate} disabled={marginLoading} className="w-full mt-2 bg-amber-600 hover:bg-amber-700 text-white h-8 text-xs" data-testid="update-margins-btn">
                        {marginLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply Margins'}
                      </Button>
                      <div className="flex justify-between text-xs mt-2"><span className="text-amber-600">Total Margin</span><span className="font-medium text-amber-800">₹{(ce.total_margin || 0).toLocaleString('en-IN')}</span></div>
                      {project.margin_added_by && <p className="text-xs text-amber-500 mt-1">Last by {project.margin_added_by}</p>}
                    </div>
                  )}
                  
                  <div className="flex justify-between pt-3 border-t-2 border-slate-300 mt-2">
                    <span className="font-bold text-slate-900 text-base">TOTAL</span>
                    <span className="font-bold text-emerald-600 text-lg">₹{(ce.total_cost || 0).toLocaleString('en-IN')}</span>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {canSubmit && <Button onClick={handleSubmit} disabled={actionLoading} className="w-full gap-2 bg-blue-600 hover:bg-blue-700" data-testid="submit-btn">{actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit for Review</Button>}
                  {canReview && (
                    <>
                      <Button onClick={handleApprove} disabled={actionLoading} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700" data-testid="approve-btn">{actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve</Button>
                      <Button onClick={() => setShowRejectDialog(true)} disabled={actionLoading} variant="destructive" className="w-full gap-2" data-testid="reject-btn"><XCircle className="h-4 w-4" />Reject</Button>
                    </>
                  )}
                  {canComplete && <Button onClick={() => setShowCompleteDialog(true)} disabled={actionLoading} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700" data-testid="complete-btn"><CheckCircle2 className="h-4 w-4" />Mark as Completed</Button>}
                  {canRequestDeletion && !isDeletionPending && <Button onClick={() => setShowDeleteDialog(true)} disabled={actionLoading} variant="outline" className="w-full gap-2 text-red-600 hover:text-red-700 hover:bg-red-50" data-testid="request-deletion-btn"><Trash2 className="h-4 w-4" />Request Deletion</Button>}
                  {canForceDelete && <Button onClick={handleForceDelete} disabled={actionLoading} variant="destructive" className="w-full gap-2" data-testid="force-delete-btn"><Trash2 className="h-4 w-4" />Force Delete (Admin)</Button>}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent><DialogHeader><DialogTitle>Reject Project</DialogTitle></DialogHeader>
          <div className="py-4"><Label className="text-sm font-medium text-slate-700 mb-2 block">Reason for rejection</Label><Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Enter the reason..." rows={4} data-testid="reject-reason-input" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button><Button variant="destructive" onClick={handleReject} disabled={actionLoading || !rejectReason.trim()} data-testid="confirm-reject-btn">{actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Reject</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent><DialogHeader><DialogTitle>Request Project Deletion</DialogTitle></DialogHeader>
          <div className="py-4"><p className="text-sm text-slate-600 mb-4">Your request will be sent to a manager for approval.</p><Label className="text-sm font-medium text-slate-700 mb-2 block">Reason</Label><Textarea value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} placeholder="Enter the reason..." rows={4} data-testid="deletion-reason-input" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button><Button variant="destructive" onClick={handleRequestDeletion} disabled={actionLoading || !deletionReason.trim()} data-testid="confirm-deletion-request-btn">{actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Submit Request</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Dialog — Drive link + Inverter login (manual) */}
      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Complete Project</DialogTitle></DialogHeader>
          <div className="py-4 space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg"><p className="text-sm font-medium text-amber-800">Provide the completion proof Drive link and inverter login details for handover.</p></div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">Completion Photos / Videos — Google Drive Link <span className="text-red-500">*</span></Label>
              <Input value={completionDriveLink} onChange={(e) => setCompletionDriveLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." className="h-10" data-testid="completion-drive-link-input" />
              <p className="text-[11px] text-slate-500">Paste the shared Drive folder link containing all completion photos / videos.</p>
            </div>

            <div className="rounded-lg border border-slate-200 p-3 space-y-3" data-testid="inverter-login-block">
              <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Lock className="h-4 w-4 text-blue-600" />Inverter Login Details (for handover)</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Portal URL / IP</Label><Input value={inverterLogin.url} onChange={(e) => setInverterLogin(p => ({ ...p, url: e.target.value }))} placeholder="https://app.inverter.com or 192.168.1.10" className="h-9" data-testid="inverter-url-input" /></div>
                <div className="space-y-1"><Label className="text-xs">Username / Email</Label><Input value={inverterLogin.username} onChange={(e) => setInverterLogin(p => ({ ...p, username: e.target.value }))} placeholder="admin@example.com" className="h-9" data-testid="inverter-username-input" /></div>
                <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Password</Label>
                  <div className="relative">
                    <Input type={showInverterPwd ? 'text' : 'password'} value={inverterLogin.password} onChange={(e) => setInverterLogin(p => ({ ...p, password: e.target.value }))} className="h-9 pr-10" data-testid="inverter-password-input" />
                    <button type="button" onClick={() => setShowInverterPwd(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label={showInverterPwd ? 'Hide password' : 'Show password'} data-testid="inverter-password-toggle">{showInverterPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </div>
                </div>
                <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Notes (Wi-Fi SSID, serial number, etc.)</Label><Textarea rows={2} value={inverterLogin.notes} onChange={(e) => setInverterLogin(p => ({ ...p, notes: e.target.value }))} placeholder="Optional — anything the customer should know" className="min-h-[44px]" data-testid="inverter-notes-input" /></div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Customer Feedback</Label>
              <Textarea value={customerFeedback} onChange={(e) => setCustomerFeedback(e.target.value)} placeholder="Enter customer's feedback about the installation..." rows={3} data-testid="customer-feedback-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCompleteDialog(false); setCompletionDriveLink(''); setInverterLogin({ url: '', username: '', password: '', notes: '' }); setCustomerFeedback(''); }}>Cancel</Button>
            <Button onClick={handleComplete} disabled={actionLoading || !completionDriveLink.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2" data-testid="confirm-complete-btn">
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Complete Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Kit Price Explainer — sales-vs-customer breakdown (Iter 44 Change 4) */}
      <KitPriceExplainerModal project={project} open={showKitExplainer} onClose={() => setShowKitExplainer(false)} />
    </div>
  );
}
