import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsAPI, termsAPI, companyAPI, marginAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { 
  ArrowLeft, Loader2, User, MapPin, Zap, Sun, Clock, CheckCircle2, XCircle, 
  AlertCircle, Download, Share2, Trash2, Send, AlertTriangle, Package, Percent, Camera
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-amber-100 text-amber-800', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-800', icon: AlertCircle },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800', icon: XCircle },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  deletion_requested: { label: 'Deletion Requested', color: 'bg-orange-100 text-orange-800', icon: Trash2 }
};

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value || '-'}</span>
    </div>
  );
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function parseTermsHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const items = tmp.querySelectorAll('li');
  if (items.length > 0) return Array.from(items).map(li => stripHtml(li.innerHTML));
  return stripHtml(html).split('\n').filter(line => line.trim());
}

const CATEGORY_LABELS = {
  solar_panels: 'Solar Panels', inverters: 'Inverters', batteries: 'Batteries',
  mounting_structures: 'Mounting Structures', cables_accessories: 'Cables & Accessories'
};

export default function ProjectDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin, isManager, isStaff } = useAuth();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');
  const [terms, setTerms] = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [marginPct, setMarginPct] = useState('');
  const [marginLoading, setMarginLoading] = useState(false);

  useEffect(() => {
    fetchProject();
    fetchTerms();
    fetchCompanyProfile();
  }, [id]);

  const fetchProject = async () => {
    try {
      const res = await projectsAPI.getOne(id);
      setProject(res.data);
    } catch (error) {
      console.error('Failed to fetch project:', error);
      navigate('/dashboard/projects');
    } finally {
      setLoading(false);
    }
  };

  const fetchTerms = async () => {
    try { const res = await termsAPI.getActive(); setTerms(res.data); } catch (e) { console.error(e); }
  };

  const fetchCompanyProfile = async () => {
    try { const res = await companyAPI.getActive(); setCompanyProfile(res.data); } catch (e) { console.error(e); }
  };

  const handleSubmit = async () => {
    setActionLoading(true);
    try { await projectsAPI.submit(id); fetchProject(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); }
  };

  const handleApprove = async () => {
    setActionLoading(true);
    try { await projectsAPI.approve(id); fetchProject(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); }
  };

  const handleReject = async () => {
    setActionLoading(true);
    try { await projectsAPI.reject(id, rejectReason); setShowRejectDialog(false); setRejectReason(''); fetchProject(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); }
  };

  const handleComplete = async () => {
    setActionLoading(true);
    try { await projectsAPI.complete(id); fetchProject(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); }
  };

  const handleRequestDeletion = async () => {
    setActionLoading(true);
    try { await projectsAPI.requestDeletion(id, deletionReason); setShowDeleteDialog(false); setDeletionReason(''); fetchProject(); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); }
  };

  const handleForceDelete = async () => {
    if (!window.confirm('Permanently delete this project?')) return;
    setActionLoading(true);
    try { await projectsAPI.forceDelete(id); navigate('/dashboard/projects'); } catch (e) { alert(e.response?.data?.detail || 'Failed'); } finally { setActionLoading(false); }
  };

  const handleMarginUpdate = async () => {
    const val = parseFloat(marginPct);
    if (isNaN(val) || val < 0) return;
    setMarginLoading(true);
    try {
      const res = await marginAPI.update(id, val);
      setProject(prev => ({ ...prev, cost_estimation: res.data.cost_estimation }));
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to update margin');
    } finally { setMarginLoading(false); }
  };

  // ════════════════════════════════════════════════
  // PDF GENERATION — Light theme, no margin display
  // ════════════════════════════════════════════════
  const generatePDF = async () => {
    const cp = companyProfile || {};
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const m = 15;
    const contentW = pageWidth - m * 2;

    const primaryHex = cp.primary_color || '#4ADE40';
    const secondaryHex = cp.secondary_color || '#2D9BF0';
    const hexToRgb = (hex) => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
    const pRgb = hexToRgb(primaryHex);
    const sRgb = hexToRgb(secondaryHex);

    // Use "Rs" as a reliable currency prefix (Helvetica doesn't support ₹ well)
    const currency = (val) => `Rs ${(val || 0).toLocaleString('en-IN')}`;

    const drawHeader = (d) => {
      d.setFillColor(255, 255, 255);
      d.rect(0, 0, pageWidth, 36, 'F');
      d.setDrawColor(...pRgb);
      d.setLineWidth(0.8);
      d.line(0, 36, pageWidth, 36);

      d.setFontSize(16);
      d.setFont('helvetica', 'bold');
      d.setTextColor(...pRgb);
      d.text(cp.company_name || 'Sensoper Controls & Renewables', m, 14);

      if (cp.tagline) {
        d.setFontSize(8);
        d.setFont('helvetica', 'normal');
        d.setTextColor(120, 120, 120);
        d.text(cp.tagline, m, 21);
      }

      d.setFontSize(7);
      d.setTextColor(100, 100, 100);
      d.setFont('helvetica', 'normal');
      const contact = [cp.phone, cp.email, cp.website].filter(Boolean);
      contact.forEach((line, i) => { d.text(line, pageWidth - m, 12 + i * 3.5, { align: 'right' }); });
      if (cp.gst_number) {
        d.setFontSize(7);
        d.text(`GSTIN: ${cp.gst_number}`, pageWidth - m, 12 + contact.length * 3.5, { align: 'right' });
      }
    };

    const drawFooter = (d, pg, total) => {
      d.setDrawColor(200, 200, 200);
      d.setLineWidth(0.3);
      d.line(m, pageHeight - 12, pageWidth - m, pageHeight - 12);
      d.setFontSize(7);
      d.setTextColor(150, 150, 150);
      d.text(cp.company_name || 'Sensoper Controls & Renewables', m, pageHeight - 6);
      d.text(`Page ${pg} of ${total}`, pageWidth - m, pageHeight - 6, { align: 'right' });
    };

    // ── PAGE 1: Header ──
    drawHeader(doc);
    let y = 44;

    // Quote ref box
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(m, y, contentW, 16, 2, 2, 'F');
    doc.setDrawColor(220, 220, 230);
    doc.roundedRect(m, y, contentW, 16, 2, 2, 'S');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 40);
    doc.text('SOLAR PROJECT QUOTATION', m + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(`Ref: SCR-${id.slice(0,8).toUpperCase()}`, m + 4, y + 12);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`, pageWidth - m - 4, y + 6, { align: 'right' });
    doc.text(`Status: ${(project.status || 'draft').toUpperCase()}`, pageWidth - m - 4, y + 12, { align: 'right' });
    y += 24;

    // ── Customer ──
    const sectionHead = (title, yPos) => {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...sRgb);
      doc.text(title, m, yPos);
      doc.setDrawColor(...sRgb);
      doc.setLineWidth(0.4);
      doc.line(m, yPos + 1.5, m + doc.getTextWidth(title), yPos + 1.5);
      return yPos + 7;
    };

    y = sectionHead('Customer Details', y);
    autoTable(doc, {
      startY: y, margin: { left: m, right: m }, theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2, textColor: [50, 50, 50] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40, textColor: [100, 100, 100] } },
      body: [
        ['Name', project.customer?.name || '-'],
        ['Phone', project.customer?.phone || '-'],
        ['Email', project.customer?.email || '-'],
        ['Address', project.customer?.address || '-'],
      ],
    });
    y = doc.lastAutoTable.finalY + 8;

    // ── Site Location ──
    y = sectionHead('Site Location', y);
    const locationRows = [];
    if (project.location?.site_location_words) locationRows.push(['What3Words', project.location.site_location_words]);
    if (project.location?.address) locationRows.push(['Address', project.location.address]);
    locationRows.push(['Roof Type', (project.mounting?.roof_type || '-').toUpperCase()]);
    locationRows.push(['Structure', project.mounting?.structure_type || '-']);
    locationRows.push(['Tilt Angle', `${project.mounting?.tilt_angle || 0}\u00B0`]);

    autoTable(doc, {
      startY: y, margin: { left: m, right: m }, theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2, textColor: [50, 50, 50] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40, textColor: [100, 100, 100] } },
      body: locationRows,
    });
    y = doc.lastAutoTable.finalY + 8;

    // ── Electrical ──
    y = sectionHead('Electrical Details', y);
    autoTable(doc, {
      startY: y, margin: { left: m, right: m }, theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2, textColor: [50, 50, 50] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, textColor: [100, 100, 100] } },
      body: [
        ['Sanction Load', `${project.electrical?.sanction_load_kw || 0} kW`],
        ['Connected Load', `${project.electrical?.connected_load_kw || 0} kW`],
        ['Monthly Consumption', `${project.electrical?.monthly_consumption_units || 0} units`],
        ['EB Tariff', `Rs ${project.electrical?.eb_tariff || 0}/unit`],
        ['System Type', (project.solar_system?.system_type || '-').toUpperCase()],
        ['Cable Length', `${project.additional?.cable_length_meters || 0} m`],
      ],
    });
    y = doc.lastAutoTable.finalY + 12;

    // ── COST BREAKDOWN TABLE ──
    if (y > pageHeight - 80) { doc.addPage(); drawHeader(doc); y = 44; }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...pRgb);
    doc.text('Cost Breakdown', m, y);
    doc.setDrawColor(...pRgb);
    doc.setLineWidth(0.5);
    doc.line(m, y + 1.5, m + doc.getTextWidth('Cost Breakdown'), y + 1.5);
    y += 8;

    // Items from inventory
    const items = project.cost_estimation?.items_breakdown || project.selected_items || [];
    const manualCosts = project.cost_estimation?.manual_costs || project.manual_costs || [];

    const costRows = items.map(item => [
      item.name,
      CATEGORY_LABELS[item.category] || item.category,
      String(item.quantity),
      currency(item.unit_price),
      `${item.gst_percentage || 18}%`,
      currency(item.amount || (item.unit_price * item.quantity))
    ]);

    autoTable(doc, {
      startY: y, margin: { left: m, right: m },
      head: [['Item', 'Category', 'Qty', 'Unit Price', 'GST', 'Amount']],
      body: costRows,
      theme: 'grid',
      headStyles: { fillColor: pRgb, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8.5, cellPadding: 3, textColor: [40, 40, 40], lineColor: [220, 220, 230], lineWidth: 0.3 },
      columnStyles: {
        0: { cellWidth: contentW * 0.28 },
        1: { cellWidth: contentW * 0.18 },
        2: { halign: 'center', cellWidth: contentW * 0.08 },
        3: { halign: 'right', cellWidth: contentW * 0.16 },
        4: { halign: 'center', cellWidth: contentW * 0.1 },
        5: { halign: 'right', cellWidth: contentW * 0.2, fontStyle: 'bold' }
      },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      didDrawPage: (data) => { if (data.pageNumber > 1) drawHeader(data.doc); },
    });
    y = doc.lastAutoTable.finalY + 2;

    // Manual costs
    if (manualCosts.length > 0) {
      const manualRows = manualCosts.map(c => [c.description, '', '', '', '', currency(c.amount)]);
      autoTable(doc, {
        startY: y, margin: { left: m, right: m }, theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 3, textColor: [40, 40, 40], lineColor: [220, 220, 230], lineWidth: 0.3 },
        columnStyles: {
          0: { cellWidth: contentW * 0.28, fontStyle: 'italic' },
          5: { halign: 'right', cellWidth: contentW * 0.2, fontStyle: 'bold' }
        },
        body: manualRows,
      });
      y = doc.lastAutoTable.finalY + 2;
    }

    // Totals — NO MARGIN shown
    const ce = project.cost_estimation || {};
    autoTable(doc, {
      startY: y, margin: { left: m, right: m }, theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: contentW * 0.7, fontStyle: 'bold', textColor: [80, 80, 80] },
        1: { halign: 'right', cellWidth: contentW * 0.3 }
      },
      body: [
        ['Subtotal', currency(ce.subtotal)],
        ['Total GST', currency(ce.total_gst)],
      ],
    });
    y = doc.lastAutoTable.finalY;

    // Grand Total
    autoTable(doc, {
      startY: y, margin: { left: m, right: m }, theme: 'plain',
      styles: { fontSize: 13, cellPadding: 5, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: contentW * 0.7, textColor: [30, 30, 30] },
        1: { halign: 'right', cellWidth: contentW * 0.3, textColor: pRgb }
      },
      body: [['TOTAL AMOUNT', currency(ce.total_cost)]],
      didDrawCell: (data) => {
        if (data.row.index === 0 && data.column.index === 0) {
          doc.setDrawColor(...pRgb);
          doc.setLineWidth(0.8);
          doc.line(data.cell.x, data.cell.y, data.cell.x + contentW, data.cell.y);
        }
      },
    });
    y = doc.lastAutoTable.finalY + 12;

    // ── Bank Details ──
    const bank = cp.bank_details;
    if (bank && bank.account_name) {
      if (y > pageHeight - 55) { doc.addPage(); drawHeader(doc); y = 44; }
      y = sectionHead('Bank Details for Payment', y);
      autoTable(doc, {
        startY: y, margin: { left: m, right: m }, theme: 'plain',
        styles: { fontSize: 9, cellPadding: 2, textColor: [50, 50, 50] },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, textColor: [100, 100, 100] } },
        body: [
          ['Account Name', bank.account_name],
          ['Account No.', bank.account_number],
          ['IFSC Code', bank.ifsc_code],
          ['Bank Name', bank.bank_name],
          ['Branch', bank.branch],
        ],
      });
      y = doc.lastAutoTable.finalY + 12;
    }

    // ── Site Images ──
    const siteImages = project.site_images || [];
    if (siteImages.length > 0) {
      if (y > pageHeight - 60) { doc.addPage(); drawHeader(doc); y = 44; }
      y = sectionHead('Site Images', y);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(`${siteImages.length} photo(s) uploaded to Google Drive. View links below:`, m, y);
      y += 6;
      siteImages.forEach((url, i) => {
        if (y > pageHeight - 20) { doc.addPage(); drawHeader(doc); y = 44; }
        doc.setFontSize(7);
        doc.setTextColor(...sRgb);
        const displayUrl = typeof url === 'string' ? url : url;
        doc.textWithLink(`Photo ${i + 1}: View Image`, m, y, { url: displayUrl });
        y += 5;
      });
      y += 8;
    }

    // ── Terms & Conditions ──
    if (y > pageHeight - 45) { doc.addPage(); drawHeader(doc); y = 44; }
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text('Terms & Conditions', m, y);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.3);
    doc.line(m, y + 1.5, m + 48, y + 1.5);
    y += 7;

    const termsList = terms?.content
      ? parseTermsHtml(terms.content)
      : ['This quotation is valid for 30 days.', '50% advance payment required.', 'Balance on installation completion.',
         'Installation: 7-14 working days after delivery.', '5-year workmanship warranty.', 'Panel warranty per manufacturer.'];
    const termsBody = termsList.map((t, i) => [`${i + 1}. ${t}`]);
    autoTable(doc, {
      startY: y, margin: { left: m, right: m }, theme: 'plain',
      styles: { fontSize: 7.5, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, textColor: [80, 80, 80] },
      body: termsBody,
      didDrawPage: (data) => { drawHeader(data.doc); },
    });
    y = doc.lastAutoTable.finalY + 12;

    // Apply headers/footers to all pages
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      if (i > 1) drawHeader(doc);
      drawFooter(doc, i, totalPages);
    }

    doc.save(`Quotation-${project.customer?.name || 'Customer'}-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const shareViaWhatsApp = () => {
    const message = encodeURIComponent(
      `*Solar Project Quotation*\n\nCustomer: ${project.customer?.name}\nSystem: ${project.solar_system?.system_type}\nTotal: Rs ${(project.cost_estimation?.total_cost || 0).toLocaleString('en-IN')}\n\nFrom: ${companyProfile?.company_name || 'Sensoper Controls & Renewables'}`
    );
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

  const selectedItems = project.cost_estimation?.items_breakdown || project.selected_items || [];
  const manualCosts = project.cost_estimation?.manual_costs || project.manual_costs || [];
  const ce = project.cost_estimation || {};

  // Initialize margin input
  if (marginPct === '' && ce.margin_percentage !== undefined) {
    setMarginPct(String(ce.margin_percentage));
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard/projects"><Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">{project.customer?.name}</h1>
                <Badge className={`${config.color} gap-1`}><StatusIcon className="h-3 w-3" />{config.label}</Badge>
              </div>
              <p className="text-slate-500">Created by {project.created_by_name} &bull; {new Date(project.created_at).toLocaleDateString('en-IN')}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {(project.status === 'approved' || project.status === 'completed') && (
              <>
                <Button variant="outline" onClick={shareViaWhatsApp} className="gap-2" data-testid="share-whatsapp-btn"><Share2 className="h-4 w-4" />WhatsApp</Button>
                <Button onClick={generatePDF} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="download-pdf-btn"><Download className="h-4 w-4" />Download PDF</Button>
              </>
            )}
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
                <InfoRow label="Name" value={project.customer?.name} />
                <InfoRow label="Phone" value={project.customer?.phone} />
                <InfoRow label="Email" value={project.customer?.email} />
                <InfoRow label="Address" value={project.customer?.address} />
              </CardContent>
            </Card>

            {/* Location */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><MapPin className="h-5 w-5 text-emerald-600" />Site Location</CardTitle></CardHeader>
              <CardContent>
                {project.location?.site_location_words && (
                  <div className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500">What3Words</span>
                    <span className="font-mono font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">{project.location.site_location_words}</span>
                  </div>
                )}
                <InfoRow label="Address" value={project.location?.address} />
                <InfoRow label="Roof Type" value={project.mounting?.roof_type?.toUpperCase()} />
                <InfoRow label="Tilt Angle" value={`${project.mounting?.tilt_angle}\u00B0`} />
                <InfoRow label="Structure Type" value={project.mounting?.structure_type} />
              </CardContent>
            </Card>

            {/* Electrical */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><Zap className="h-5 w-5 text-emerald-600" />Electrical Details</CardTitle></CardHeader>
              <CardContent>
                <InfoRow label="Sanction Load" value={`${project.electrical?.sanction_load_kw} kW`} />
                <InfoRow label="Connected Load" value={`${project.electrical?.connected_load_kw} kW`} />
                <InfoRow label="Monthly Consumption" value={`${project.electrical?.monthly_consumption_units} units`} />
                <InfoRow label="EB Tariff" value={`Rs ${project.electrical?.eb_tariff}/unit`} />
                <InfoRow label="Cable Length" value={`${project.additional?.cable_length_meters} m`} />
                <InfoRow label="Complexity" value={project.additional?.installation_complexity?.toUpperCase()} />
              </CardContent>
            </Card>

            {/* System */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><Sun className="h-5 w-5 text-emerald-600" />System Configuration</CardTitle></CardHeader>
              <CardContent>
                <InfoRow label="System Type" value={project.solar_system?.system_type?.toUpperCase()} />
                {project.solar_system?.battery_required && <InfoRow label="Battery Required" value="Yes" />}
                {project.additional?.shadow_analysis_notes && (
                  <div className="mt-4 p-3 bg-slate-50 rounded-lg"><p className="text-sm font-medium text-slate-700">Shadow Analysis Notes:</p><p className="text-sm text-slate-600">{project.additional.shadow_analysis_notes}</p></div>
                )}
              </CardContent>
            </Card>

            {/* Site Images */}
            {project.site_images && project.site_images.length > 0 && (
              <Card className="border-slate-200">
                <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><Camera className="h-5 w-5 text-emerald-600" />Site Images ({project.site_images.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {project.site_images.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100 hover:ring-2 hover:ring-emerald-400 transition-all" data-testid={`view-image-${i}`}>
                        <img src={url} alt={`Site photo ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Selected Items */}
            {selectedItems.length > 0 && (
              <Card className="border-slate-200">
                <CardHeader className="pb-3"><CardTitle className="text-lg font-['Outfit'] flex items-center gap-2"><Package className="h-5 w-5 text-emerald-600" />Selected Materials</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-slate-50">
                        <th className="text-left py-2 px-4 font-semibold text-slate-600">Item</th>
                        <th className="text-left py-2 px-4 font-semibold text-slate-600">Category</th>
                        <th className="text-center py-2 px-4 font-semibold text-slate-600">Qty</th>
                        <th className="text-right py-2 px-4 font-semibold text-slate-600">Unit Price</th>
                        <th className="text-right py-2 px-4 font-semibold text-slate-600">GST</th>
                        <th className="text-right py-2 px-4 font-semibold text-slate-600">Amount</th>
                      </tr></thead>
                      <tbody>
                        {selectedItems.map((item, i) => (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="py-2 px-4 font-medium">{item.name}</td>
                            <td className="py-2 px-4 text-slate-500">{CATEGORY_LABELS[item.category] || item.category}</td>
                            <td className="py-2 px-4 text-center">{item.quantity}</td>
                            <td className="py-2 px-4 text-right">Rs {(item.unit_price || 0).toLocaleString('en-IN')}</td>
                            <td className="py-2 px-4 text-right text-slate-500">{item.gst_percentage}%</td>
                            <td className="py-2 px-4 text-right font-medium">Rs {(item.amount || item.unit_price * item.quantity).toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar — Cost Summary */}
          <div className="space-y-6">
            <Card className="border-slate-200 sticky top-6">
              <CardHeader className="pb-3 border-b border-slate-200"><CardTitle className="text-lg font-['Outfit']">Cost Summary</CardTitle></CardHeader>
              <CardContent className="pt-4">
                {selectedItems.map((item, i) => (
                  <div key={i} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                    <span className="text-sm text-slate-500 truncate mr-2">{item.name} x{item.quantity}</span>
                    <span className="text-sm font-medium text-slate-900">Rs {(item.amount || item.unit_price * item.quantity).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {manualCosts.map((c, i) => (
                  <div key={`m${i}`} className="flex justify-between py-1.5 border-b border-slate-100">
                    <span className="text-sm text-slate-500 italic">{c.description}</span>
                    <span className="text-sm font-medium text-slate-900">Rs {(c.amount || 0).toLocaleString('en-IN')}</span>
                  </div>
                ))}

                <div className="mt-4 pt-3 border-t border-slate-200 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><span className="font-medium">Rs {(ce.subtotal || 0).toLocaleString('en-IN')}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-500">GST</span><span className="font-medium">Rs {(ce.total_gst || 0).toLocaleString('en-IN')}</span></div>
                  
                  {/* Margin Control — Manager/Admin Only */}
                  {(isAdmin || isManager) && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mt-2">
                      <div className="flex items-center gap-2 mb-2">
                        <Percent className="h-4 w-4 text-amber-600" />
                        <span className="text-sm font-medium text-amber-800">Internal Margin</span>
                      </div>
                      <div className="flex gap-2 items-center">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={marginPct}
                          onChange={(e) => setMarginPct(e.target.value)}
                          className="h-9 w-24 text-sm"
                          data-testid="margin-input"
                        />
                        <span className="text-sm text-slate-500">%</span>
                        <Button 
                          size="sm" 
                          onClick={handleMarginUpdate}
                          disabled={marginLoading}
                          className="bg-amber-600 hover:bg-amber-700 text-white h-9"
                          data-testid="update-margin-btn"
                        >
                          {marginLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
                        </Button>
                      </div>
                      <div className="flex justify-between text-xs mt-2">
                        <span className="text-amber-600">Margin Amount</span>
                        <span className="font-medium text-amber-800">Rs {(ce.margin || 0).toLocaleString('en-IN')}</span>
                      </div>
                      {project.margin_added_by && (
                        <p className="text-xs text-amber-500 mt-1">Last updated by {project.margin_added_by}</p>
                      )}
                    </div>
                  )}
                  
                  <div className="flex justify-between pt-3 border-t-2 border-slate-300 mt-2">
                    <span className="font-bold text-slate-900 text-base">TOTAL</span>
                    <span className="font-bold text-emerald-600 text-lg">Rs {(ce.total_cost || 0).toLocaleString('en-IN')}</span>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {canSubmit && (
                    <Button onClick={handleSubmit} disabled={actionLoading} className="w-full gap-2 bg-blue-600 hover:bg-blue-700" data-testid="submit-btn">
                      {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit for Review
                    </Button>
                  )}
                  {canReview && (
                    <>
                      <Button onClick={handleApprove} disabled={actionLoading} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700" data-testid="approve-btn">
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve
                      </Button>
                      <Button onClick={() => setShowRejectDialog(true)} disabled={actionLoading} variant="destructive" className="w-full gap-2" data-testid="reject-btn"><XCircle className="h-4 w-4" />Reject</Button>
                    </>
                  )}
                  {canComplete && (
                    <Button onClick={handleComplete} disabled={actionLoading} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700" data-testid="complete-btn">
                      {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Mark as Completed
                    </Button>
                  )}
                  {canRequestDeletion && !isDeletionPending && (
                    <Button onClick={() => setShowDeleteDialog(true)} disabled={actionLoading} variant="outline" className="w-full gap-2 text-red-600 hover:text-red-700 hover:bg-red-50" data-testid="request-deletion-btn"><Trash2 className="h-4 w-4" />Request Deletion</Button>
                  )}
                  {canForceDelete && (
                    <Button onClick={handleForceDelete} disabled={actionLoading} variant="destructive" className="w-full gap-2" data-testid="force-delete-btn"><Trash2 className="h-4 w-4" />Force Delete (Admin)</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Project</DialogTitle></DialogHeader>
          <div className="py-4">
            <Label className="text-sm font-medium text-slate-700 mb-2 block">Reason for rejection</Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Enter the reason..." rows={4} data-testid="reject-reason-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={actionLoading || !rejectReason.trim()} data-testid="confirm-reject-btn">
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Project Deletion</DialogTitle></DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-600 mb-4">Your request will be sent to a manager for approval.</p>
            <Label className="text-sm font-medium text-slate-700 mb-2 block">Reason</Label>
            <Textarea value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} placeholder="Enter the reason..." rows={4} data-testid="deletion-reason-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRequestDeletion} disabled={actionLoading || !deletionReason.trim()} data-testid="confirm-deletion-request-btn">
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
