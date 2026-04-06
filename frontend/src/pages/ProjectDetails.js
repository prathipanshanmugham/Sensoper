import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsAPI, termsAPI, companyAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { 
  ArrowLeft, 
  Loader2, 
  User, 
  MapPin, 
  Zap, 
  Sun,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  Share2,
  Trash2,
  Send,
  AlertTriangle
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_solar-estimator-14/artifacts/2dpfr2zb_slg.png";

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

function CostRow({ label, value, isTotal = false }) {
  return (
    <div className={`flex justify-between py-2 ${isTotal ? 'border-t-2 border-slate-300 pt-3 mt-2' : 'border-b border-slate-100'}`}>
      <span className={isTotal ? 'font-bold text-slate-900' : 'text-slate-500'}>{label}</span>
      <span className={isTotal ? 'font-bold text-[#4ADE40] text-lg' : 'font-medium text-slate-900'}>
        ₹{(value || 0).toLocaleString('en-IN')}
      </span>
    </div>
  );
}

// Helper to strip HTML tags for plain text
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

// Helper to convert HTML to structured terms list
function parseTermsHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const items = tmp.querySelectorAll('li');
  if (items.length > 0) {
    return Array.from(items).map(li => stripHtml(li.innerHTML));
  }
  // Fallback: split by newlines
  return stripHtml(html).split('\n').filter(line => line.trim());
}

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
    try {
      const res = await termsAPI.getActive();
      setTerms(res.data);
    } catch (error) {
      console.error('Failed to fetch terms:', error);
    }
  };

  const fetchCompanyProfile = async () => {
    try {
      const res = await companyAPI.getActive();
      setCompanyProfile(res.data);
    } catch (error) {
      console.error('Failed to fetch company profile:', error);
    }
  };

  const handleSubmit = async () => {
    setActionLoading(true);
    try {
      await projectsAPI.submit(id);
      fetchProject();
    } catch (error) {
      console.error('Failed to submit:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await projectsAPI.approve(id);
      fetchProject();
    } catch (error) {
      console.error('Failed to approve:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    setActionLoading(true);
    try {
      await projectsAPI.reject(id, rejectReason);
      setShowRejectDialog(false);
      fetchProject();
    } catch (error) {
      console.error('Failed to reject:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = async () => {
    setActionLoading(true);
    try {
      await projectsAPI.complete(id);
      fetchProject();
    } catch (error) {
      console.error('Failed to complete:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestDeletion = async () => {
    if (!deletionReason.trim()) return;
    
    setActionLoading(true);
    try {
      await projectsAPI.requestDeletion(id, deletionReason);
      setShowDeleteDialog(false);
      fetchProject();
    } catch (error) {
      console.error('Failed to request deletion:', error);
      alert(error.response?.data?.detail || 'Failed to request deletion');
    } finally {
      setActionLoading(false);
    }
  };

  const handleForceDelete = async () => {
    if (!window.confirm('This will PERMANENTLY delete the project. Are you sure?')) return;
    
    setActionLoading(true);
    try {
      await projectsAPI.forceDelete(id);
      navigate('/dashboard/projects');
    } catch (error) {
      console.error('Failed to force delete:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const generatePDF = async () => {
    const cp = companyProfile || {};
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;

    // Colors from company profile or defaults
    const primaryHex = cp.primary_color || '#4ADE40';
    const secondaryHex = cp.secondary_color || '#2D9BF0';
    const hexToRgb = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return [r, g, b];
    };
    const primaryRgb = hexToRgb(primaryHex);
    const secondaryRgb = hexToRgb(secondaryHex);

    // ─── HELPER: Draw header on every page ───
    const drawHeader = (pageDoc) => {
      pageDoc.setFillColor(15, 15, 15);
      pageDoc.rect(0, 0, pageWidth, 38, 'F');
      
      // Company name
      pageDoc.setFontSize(18);
      pageDoc.setFont('helvetica', 'bold');
      pageDoc.setTextColor(...primaryRgb);
      const companyName = cp.company_name || 'Sensoper Controls & Renewables';
      pageDoc.text(companyName, margin, 16);
      
      // Tagline
      if (cp.tagline) {
        pageDoc.setFontSize(9);
        pageDoc.setFont('helvetica', 'normal');
        pageDoc.setTextColor(180, 180, 180);
        pageDoc.text(cp.tagline, margin, 24);
      }
      
      // Contact on right
      pageDoc.setFontSize(8);
      pageDoc.setTextColor(200, 200, 200);
      const contactLines = [];
      if (cp.phone) contactLines.push(cp.phone);
      if (cp.email) contactLines.push(cp.email);
      if (cp.website) contactLines.push(cp.website);
      contactLines.forEach((line, i) => {
        pageDoc.text(line, pageWidth - margin, 14 + i * 4, { align: 'right' });
      });

      // Accent line
      pageDoc.setFillColor(...primaryRgb);
      pageDoc.rect(0, 38, pageWidth, 1.5, 'F');
    };

    // ─── HELPER: Draw footer on every page ───
    const drawFooter = (pageDoc, pageNum, totalPages) => {
      pageDoc.setFillColor(15, 15, 15);
      pageDoc.rect(0, pageHeight - 14, pageWidth, 14, 'F');
      pageDoc.setFontSize(7);
      pageDoc.setTextColor(150, 150, 150);
      const companyName = cp.company_name || 'Sensoper Controls & Renewables';
      pageDoc.text(companyName, margin, pageHeight - 5);
      pageDoc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin, pageHeight - 5, { align: 'right' });
      if (cp.gst_number) {
        pageDoc.text(`GSTIN: ${cp.gst_number}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
      }
    };

    // ═══════════════ PAGE 1: Cover + Customer + System ═══════════════
    drawHeader(doc);
    let y = 48;

    // Quote reference box
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(margin, y, contentWidth, 18, 2, 2, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text('SOLAR PROJECT QUOTATION', margin + 4, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Ref: SCR-${id.slice(0, 8).toUpperCase()}`, margin + 4, y + 14);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`, pageWidth - margin - 4, y + 7, { align: 'right' });
    doc.text(`Status: ${(project.status || 'draft').toUpperCase()}`, pageWidth - margin - 4, y + 14, { align: 'right' });
    y += 26;

    // ─── Customer Details ───
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...secondaryRgb);
    doc.text('Customer Details', margin, y);
    doc.setDrawColor(...secondaryRgb);
    doc.setLineWidth(0.5);
    doc.line(margin, y + 2, margin + 42, y + 2);
    y += 8;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40, textColor: [100, 100, 100] } },
      body: [
        ['Name', project.customer?.name || '-'],
        ['Phone', project.customer?.phone || '-'],
        ['Email', project.customer?.email || '-'],
        ['Address', project.customer?.address || '-'],
      ],
    });
    y = doc.lastAutoTable.finalY + 10;

    // ─── Site & System Info ───
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...secondaryRgb);
    doc.text('System Configuration', margin, y);
    doc.line(margin, y + 2, margin + 52, y + 2);
    y += 8;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, textColor: [100, 100, 100] } },
      body: [
        ['System Type', (project.solar_system?.system_type || '-').toUpperCase()],
        ['Total Capacity', `${project.cost_estimation?.total_capacity_kw || 0} kW`],
        ['Panels Required', `${project.cost_estimation?.panels_required || 0} x ${project.solar_system?.panel_wattage || 540}W`],
        ['Inverter Model', project.solar_system?.inverter_model || '-'],
        ['Roof Type', (project.mounting?.roof_type || '-').toUpperCase()],
        ['Mounting Structure', project.mounting?.structure_type || '-'],
        ['Tilt Angle', `${project.mounting?.tilt_angle || 0}°`],
        ...(project.solar_system?.battery_required ? [['Battery Capacity', `${project.solar_system?.battery_capacity_ah || 0} Ah`]] : []),
      ],
    });
    y = doc.lastAutoTable.finalY + 10;

    // ─── Electrical Details ───
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...secondaryRgb);
    doc.text('Electrical Details', margin, y);
    doc.line(margin, y + 2, margin + 44, y + 2);
    y += 8;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, textColor: [100, 100, 100] } },
      body: [
        ['Sanction Load', `${project.electrical?.sanction_load_kw || 0} kW`],
        ['Connected Load', `${project.electrical?.connected_load_kw || 0} kW`],
        ['Monthly Consumption', `${project.electrical?.monthly_consumption_units || 0} units`],
        ['EB Tariff', `₹${project.electrical?.eb_tariff || 0}/unit`],
        ['Cable Length', `${project.additional?.cable_length_meters || 0} m`],
        ['Complexity', (project.additional?.installation_complexity || '-').toUpperCase()],
      ],
    });
    y = doc.lastAutoTable.finalY + 14;

    // ═══════════════ COST BREAKDOWN TABLE ═══════════════
    // Check if enough space, otherwise add a page
    if (y > pageHeight - 100) {
      doc.addPage();
      drawHeader(doc);
      y = 48;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primaryRgb);
    doc.text('Cost Breakdown', margin, y);
    doc.setDrawColor(...primaryRgb);
    doc.line(margin, y + 2, margin + 40, y + 2);
    y += 8;

    const costRows = [
      ['Solar Panels', `₹${(project.cost_estimation?.panel_cost || 0).toLocaleString('en-IN')}`],
      ['Inverter', `₹${(project.cost_estimation?.inverter_cost || 0).toLocaleString('en-IN')}`],
      ['Mounting Structure', `₹${(project.cost_estimation?.structure_cost || 0).toLocaleString('en-IN')}`],
      ['Wiring & Accessories', `₹${(project.cost_estimation?.wiring_cost || 0).toLocaleString('en-IN')}`],
      ['Installation Labor', `₹${(project.cost_estimation?.labor_cost || 0).toLocaleString('en-IN')}`],
      ['Transportation', `₹${(project.cost_estimation?.transportation_cost || 0).toLocaleString('en-IN')}`],
    ];

    if (project.cost_estimation?.battery_cost > 0) {
      costRows.push(['Battery Backup', `₹${(project.cost_estimation?.battery_cost || 0).toLocaleString('en-IN')}`]);
    }

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Component', 'Amount']],
      body: costRows,
      theme: 'striped',
      headStyles: {
        fillColor: primaryRgb,
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        fontSize: 10,
      },
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.6 },
        1: { halign: 'right', cellWidth: contentWidth * 0.4 },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    y = doc.lastAutoTable.finalY + 4;

    // Summary rows
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.6, fontStyle: 'bold' },
        1: { halign: 'right', cellWidth: contentWidth * 0.4 },
      },
      body: [
        ['Subtotal', `₹${(project.cost_estimation?.subtotal || 0).toLocaleString('en-IN')}`],
        [`Margin (${project.cost_estimation?.margin_percentage || 15}%)`, `₹${(project.cost_estimation?.margin || 0).toLocaleString('en-IN')}`],
        [`GST (${project.cost_estimation?.gst_percentage || 13.8}%)`, `₹${(project.cost_estimation?.gst || 0).toLocaleString('en-IN')}`],
      ],
    });
    y = doc.lastAutoTable.finalY + 2;

    // Grand Total row
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: { fontSize: 13, cellPadding: 4, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.6, textColor: [30, 30, 30] },
        1: { halign: 'right', cellWidth: contentWidth * 0.4, textColor: primaryRgb },
      },
      body: [
        ['TOTAL AMOUNT', `₹${(project.cost_estimation?.total_cost || 0).toLocaleString('en-IN')}`],
      ],
      didDrawCell: (data) => {
        if (data.row.index === 0 && data.column.index === 0) {
          doc.setDrawColor(...primaryRgb);
          doc.setLineWidth(0.8);
          doc.line(data.cell.x, data.cell.y, data.cell.x + contentWidth, data.cell.y);
        }
      },
    });
    y = doc.lastAutoTable.finalY + 14;

    // ═══════════════ BANK DETAILS ═══════════════
    const bank = cp.bank_details;
    if (bank && bank.account_name) {
      if (y > pageHeight - 60) {
        doc.addPage();
        drawHeader(doc);
        y = 48;
      }

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...secondaryRgb);
      doc.text('Bank Details for Payment', margin, y);
      doc.setDrawColor(...secondaryRgb);
      doc.line(margin, y + 2, margin + 56, y + 2);
      y += 8;

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, textColor: [100, 100, 100] } },
        body: [
          ['Account Name', bank.account_name],
          ['Account Number', bank.account_number],
          ['IFSC Code', bank.ifsc_code],
          ['Bank Name', bank.bank_name],
          ['Branch', bank.branch],
        ],
      });
      y = doc.lastAutoTable.finalY + 14;
    }

    // ═══════════════ TERMS & CONDITIONS ═══════════════
    if (y > pageHeight - 50) {
      doc.addPage();
      drawHeader(doc);
      y = 48;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text('Terms & Conditions', margin, y);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.3);
    doc.line(margin, y + 2, margin + 48, y + 2);
    y += 8;

    const termsList = terms?.content
      ? parseTermsHtml(terms.content)
      : [
          'This quotation is valid for 30 days from the date of issue.',
          '50% advance payment required to confirm the order.',
          'Balance payment due upon installation completion.',
          'Installation timeline: 7-14 working days after material delivery.',
          '5-year warranty on installation workmanship.',
          'Panel warranty as per manufacturer terms (typically 25 years).',
        ];

    const termsBody = termsList.map((term, i) => [`${i + 1}. ${term}`]);

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, textColor: [80, 80, 80] },
      body: termsBody,
      didDrawPage: (data) => {
        // Draw header/footer on overflow pages
        drawHeader(data.doc);
      },
    });
    y = doc.lastAutoTable.finalY + 20;

    // ═══════════════ AUTHORIZED SIGNATORY ═══════════════
    if (y > pageHeight - 45) {
      doc.addPage();
      drawHeader(doc);
      y = 48;
    }

    // Left side: company stamp placeholder
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text('Company Seal / Stamp', margin, y + 20);
    doc.setDrawColor(200, 200, 200);
    doc.setLineDashPattern([2, 2], 0);
    doc.rect(margin, y, 50, 25);
    doc.setLineDashPattern([], 0);

    // Right side: authorized signatory
    const sigX = pageWidth - margin - 60;
    doc.setDrawColor(100, 100, 100);
    doc.line(sigX, y + 15, sigX + 55, y + 15);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text(cp.authorized_signatory || 'Authorized Signatory', sigX, y + 21);
    if (cp.designation) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(cp.designation, sigX, y + 26);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text('For ' + (cp.company_name || 'Sensoper Controls & Renewables'), sigX, y + 31);

    // ─── Add headers/footers to ALL pages ───
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      if (i > 1) drawHeader(doc); // page 1 already has header
      drawFooter(doc, i, totalPages);
    }

    doc.save(`Quotation-${project.customer?.name || 'Customer'}-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const shareViaWhatsApp = () => {
    const message = encodeURIComponent(
      `*Solar Project Quotation*\n\n` +
      `Customer: ${project.customer?.name}\n` +
      `System: ${project.cost_estimation?.total_capacity_kw} kW ${project.solar_system?.system_type}\n` +
      `Total Cost: ₹${(project.cost_estimation?.total_cost || 0).toLocaleString('en-IN')}\n\n` +
      `From: Sensoper Controls & Renewables`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#4ADE40]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p>Project not found</p>
      </div>
    );
  }

  const config = statusConfig[project.status] || statusConfig.draft;
  const StatusIcon = config.icon;
  const canSubmit = project.status === 'draft' && (project.created_by === user?.id || isAdmin || isManager);
  const canReview = (isAdmin || isManager) && project.status === 'submitted';
  const canComplete = (isAdmin || isManager) && project.status === 'approved';
  const canRequestDeletion = isStaff && project.status === 'draft' && project.created_by === user?.id;
  const canForceDelete = isAdmin;
  const isDeletionPending = project.status === 'deletion_requested';

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard/projects">
              <Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">
                  {project.customer?.name}
                </h1>
                <Badge className={`${config.color} gap-1`}>
                  <StatusIcon className="h-3 w-3" />
                  {config.label}
                </Badge>
              </div>
              <p className="text-slate-500">
                Created by {project.created_by_name} • {new Date(project.created_at).toLocaleDateString('en-IN')}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {(project.status === 'approved' || project.status === 'completed') && (
              <>
                <Button 
                  variant="outline" 
                  onClick={shareViaWhatsApp}
                  className="gap-2"
                  data-testid="share-whatsapp-btn"
                >
                  <Share2 className="h-4 w-4" />
                  WhatsApp
                </Button>
                <Button 
                  onClick={generatePDF}
                  className="gap-2 bg-[#4ADE40] hover:bg-[#3dba35] text-black"
                  data-testid="download-pdf-btn"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Deletion request pending banner */}
        {isDeletionPending && project.deletion_request && (
          <Card className="border-orange-200 bg-orange-50 mb-6">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
                <div>
                  <p className="font-medium text-orange-800">Deletion Request Pending</p>
                  <p className="text-sm text-orange-700">
                    Requested by {project.deletion_request.requested_by} • Reason: {project.deletion_request.reason}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Rejection reason banner */}
        {project.status === 'rejected' && project.rejection_reason && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-medium text-red-800">Rejection Reason:</p>
            <p className="text-red-700">{project.rejection_reason}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Details */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2">
                  <User className="h-5 w-5 text-[#4ADE40]" />
                  Customer Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow label="Name" value={project.customer?.name} />
                <InfoRow label="Phone" value={project.customer?.phone} />
                <InfoRow label="Email" value={project.customer?.email} />
                <InfoRow label="Address" value={project.customer?.address} />
              </CardContent>
            </Card>

            {/* Location */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-[#4ADE40]" />
                  Site Location
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow label="Coordinates" value={`${project.location?.latitude?.toFixed(6)}, ${project.location?.longitude?.toFixed(6)}`} />
                <InfoRow label="Address" value={project.location?.address} />
                <InfoRow label="Roof Type" value={project.mounting?.roof_type?.toUpperCase()} />
                <InfoRow label="Tilt Angle" value={`${project.mounting?.tilt_angle}°`} />
                <InfoRow label="Structure Type" value={project.mounting?.structure_type} />
              </CardContent>
            </Card>

            {/* Electrical Details */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2">
                  <Zap className="h-5 w-5 text-[#4ADE40]" />
                  Electrical Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow label="Sanction Load" value={`${project.electrical?.sanction_load_kw} kW`} />
                <InfoRow label="Connected Load" value={`${project.electrical?.connected_load_kw} kW`} />
                <InfoRow label="Monthly Consumption" value={`${project.electrical?.monthly_consumption_units} units`} />
                <InfoRow label="EB Tariff" value={`₹${project.electrical?.eb_tariff}/unit`} />
                <InfoRow label="Cable Length" value={`${project.additional?.cable_length_meters} m`} />
                <InfoRow label="Installation Complexity" value={project.additional?.installation_complexity?.toUpperCase()} />
              </CardContent>
            </Card>

            {/* Solar System */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-['Outfit'] flex items-center gap-2">
                  <Sun className="h-5 w-5 text-[#4ADE40]" />
                  Solar System Configuration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoRow label="System Type" value={project.solar_system?.system_type?.toUpperCase()} />
                <InfoRow label="Inverter Model" value={project.solar_system?.inverter_model} />
                <InfoRow label="Panel Wattage" value={`${project.solar_system?.panel_wattage}W`} />
                <InfoRow label="Panels Required" value={project.cost_estimation?.panels_required} />
                <InfoRow label="Total Capacity" value={`${project.cost_estimation?.total_capacity_kw} kW`} />
                {project.solar_system?.battery_required && (
                  <InfoRow label="Battery Capacity" value={`${project.solar_system?.battery_capacity_ah} Ah`} />
                )}
                {project.additional?.shadow_analysis_notes && (
                  <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                    <p className="text-sm font-medium text-slate-700">Shadow Analysis Notes:</p>
                    <p className="text-sm text-slate-600">{project.additional.shadow_analysis_notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Cost Estimation */}
          <div className="space-y-6">
            <Card className="border-slate-200 sticky top-6">
              <CardHeader className="pb-3 border-b border-slate-200">
                <CardTitle className="text-lg font-['Outfit']">Cost Estimation</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <CostRow label="Solar Panels" value={project.cost_estimation?.panel_cost} />
                <CostRow label="Inverter" value={project.cost_estimation?.inverter_cost} />
                <CostRow label="Mounting Structure" value={project.cost_estimation?.structure_cost} />
                <CostRow label="Wiring & Accessories" value={project.cost_estimation?.wiring_cost} />
                <CostRow label="Installation Labor" value={project.cost_estimation?.labor_cost} />
                <CostRow label="Transportation" value={project.cost_estimation?.transportation_cost} />
                {project.cost_estimation?.battery_cost > 0 && (
                  <CostRow label="Battery Backup" value={project.cost_estimation?.battery_cost} />
                )}
                
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <CostRow label="Subtotal" value={project.cost_estimation?.subtotal} />
                  <CostRow label={`Margin (${project.cost_estimation?.margin_percentage}%)`} value={project.cost_estimation?.margin} />
                  <CostRow label={`GST (${project.cost_estimation?.gst_percentage}%)`} value={project.cost_estimation?.gst} />
                  <CostRow label="TOTAL" value={project.cost_estimation?.total_cost} isTotal />
                </div>

                {/* Action Buttons */}
                <div className="mt-6 space-y-3">
                  {canSubmit && (
                    <Button 
                      onClick={handleSubmit}
                      disabled={actionLoading}
                      className="w-full gap-2 bg-blue-600 hover:bg-blue-700"
                      data-testid="submit-btn"
                    >
                      {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Submit for Review
                    </Button>
                  )}
                  
                  {canReview && (
                    <>
                      <Button 
                        onClick={handleApprove}
                        disabled={actionLoading}
                        className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                        data-testid="approve-btn"
                      >
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Approve
                      </Button>
                      <Button 
                        onClick={() => setShowRejectDialog(true)}
                        disabled={actionLoading}
                        variant="destructive"
                        className="w-full gap-2"
                        data-testid="reject-btn"
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </>
                  )}
                  
                  {canComplete && (
                    <Button 
                      onClick={handleComplete}
                      disabled={actionLoading}
                      className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                      data-testid="complete-btn"
                    >
                      {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Mark as Completed
                    </Button>
                  )}

                  {canRequestDeletion && !isDeletionPending && (
                    <Button 
                      onClick={() => setShowDeleteDialog(true)}
                      disabled={actionLoading}
                      variant="outline"
                      className="w-full gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                      data-testid="request-deletion-btn"
                    >
                      <Trash2 className="h-4 w-4" />
                      Request Deletion
                    </Button>
                  )}

                  {canForceDelete && (
                    <Button 
                      onClick={handleForceDelete}
                      disabled={actionLoading}
                      variant="destructive"
                      className="w-full gap-2"
                      data-testid="force-delete-btn"
                    >
                      <Trash2 className="h-4 w-4" />
                      Force Delete (Admin)
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Project</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-sm font-medium text-slate-700 mb-2 block">
              Reason for rejection
            </Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter the reason for rejecting this project..."
              rows={4}
              data-testid="reject-reason-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleReject}
              disabled={actionLoading || !rejectReason.trim()}
              data-testid="confirm-reject-btn"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reject Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Deletion Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Project Deletion</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-600 mb-4">
              Your request will be sent to a manager for approval. Please provide a reason.
            </p>
            <Label className="text-sm font-medium text-slate-700 mb-2 block">
              Reason for deletion
            </Label>
            <Textarea
              value={deletionReason}
              onChange={(e) => setDeletionReason(e.target.value)}
              placeholder="Enter the reason for deleting this project..."
              rows={4}
              data-testid="deletion-reason-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleRequestDeletion}
              disabled={actionLoading || !deletionReason.trim()}
              data-testid="confirm-deletion-request-btn"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
