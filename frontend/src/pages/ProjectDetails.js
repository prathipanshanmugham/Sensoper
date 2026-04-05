import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsAPI, termsAPI } from '../utils/api';
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
      <span className={isTotal ? 'font-bold text-emerald-600 text-lg' : 'font-medium text-slate-900'}>
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

  useEffect(() => {
    fetchProject();
    fetchTerms();
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

  const generatePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Header
    doc.setFillColor(4, 120, 87); // Emerald-700
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('SENSOPER CONTROLS', 20, 20);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('& RENEWABLES', 20, 28);
    doc.setFontSize(10);
    doc.text('Solar Project Quotation', 20, 36);
    
    // Date
    doc.setFontSize(10);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, pageWidth - 60, 20);
    doc.text(`Quotation #: SCR-${id.slice(0, 8).toUpperCase()}`, pageWidth - 60, 28);
    
    // Customer Details
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Customer Details', 20, 55);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Name: ${project.customer?.name || '-'}`, 20, 65);
    doc.text(`Phone: ${project.customer?.phone || '-'}`, 20, 72);
    doc.text(`Address: ${project.customer?.address || '-'}`, 20, 79);
    
    // System Configuration
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('System Configuration', 20, 95);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    let y = 105;
    doc.text(`System Type: ${project.solar_system?.system_type?.toUpperCase() || '-'}`, 20, y);
    doc.text(`Total Capacity: ${project.cost_estimation?.total_capacity_kw || 0} kW`, 20, y + 7);
    doc.text(`Panels Required: ${project.cost_estimation?.panels_required || 0} x ${project.solar_system?.panel_wattage || 540}W`, 20, y + 14);
    doc.text(`Inverter: ${project.solar_system?.inverter_model || '-'}`, 20, y + 21);
    doc.text(`Mounting: ${project.mounting?.roof_type?.toUpperCase() || '-'} - ${project.mounting?.structure_type || '-'}`, 20, y + 28);
    
    // Cost Breakdown
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Cost Breakdown', 20, y + 48);
    
    y = y + 58;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const costs = [
      ['Solar Panels', project.cost_estimation?.panel_cost],
      ['Inverter', project.cost_estimation?.inverter_cost],
      ['Mounting Structure', project.cost_estimation?.structure_cost],
      ['Wiring & Accessories', project.cost_estimation?.wiring_cost],
      ['Installation Labor', project.cost_estimation?.labor_cost],
      ['Transportation', project.cost_estimation?.transportation_cost],
    ];
    
    if (project.cost_estimation?.battery_cost > 0) {
      costs.push(['Battery Backup', project.cost_estimation?.battery_cost]);
    }
    
    costs.forEach(([label, value]) => {
      doc.text(label, 20, y);
      doc.text(`₹${(value || 0).toLocaleString('en-IN')}`, pageWidth - 60, y);
      y += 7;
    });
    
    // Subtotal
    doc.setDrawColor(200, 200, 200);
    doc.line(20, y, pageWidth - 20, y);
    y += 7;
    doc.text('Subtotal', 20, y);
    doc.text(`₹${(project.cost_estimation?.subtotal || 0).toLocaleString('en-IN')}`, pageWidth - 60, y);
    
    y += 7;
    doc.text(`Margin (${project.cost_estimation?.margin_percentage || 15}%)`, 20, y);
    doc.text(`₹${(project.cost_estimation?.margin || 0).toLocaleString('en-IN')}`, pageWidth - 60, y);
    
    y += 7;
    doc.text(`GST (${project.cost_estimation?.gst_percentage || 13.8}%)`, 20, y);
    doc.text(`₹${(project.cost_estimation?.gst || 0).toLocaleString('en-IN')}`, pageWidth - 60, y);
    
    // Total
    y += 5;
    doc.setDrawColor(4, 120, 87);
    doc.setLineWidth(0.5);
    doc.line(20, y, pageWidth - 20, y);
    y += 10;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(4, 120, 87);
    doc.text('TOTAL AMOUNT', 20, y);
    doc.text(`₹${(project.cost_estimation?.total_cost || 0).toLocaleString('en-IN')}`, pageWidth - 60, y);
    
    // Terms & Conditions (Dynamic from backend)
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    y += 20;
    doc.text('Terms & Conditions:', 20, y);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    
    // Parse and display terms
    const termsList = terms?.content 
      ? parseTermsHtml(terms.content)
      : [
          'This quotation is valid for 30 days from the date of issue.',
          '50% advance payment required to confirm the order.',
          'Balance payment due upon installation completion.',
          'Installation timeline: 7-14 working days after material delivery.',
          '5-year warranty on installation workmanship.',
          'Panel warranty as per manufacturer terms (typically 25 years).'
        ];
    
    termsList.forEach((term, i) => {
      const termText = term.startsWith(`${i + 1}.`) ? term : `${i + 1}. ${term}`;
      const splitText = doc.splitTextToSize(termText, pageWidth - 40);
      
      // Check if we need a new page
      if (y + (splitText.length * 4) > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }
      
      splitText.forEach((line, lineIndex) => {
        doc.text(line, 20, y + 7 + (i * 5) + (lineIndex * 4));
      });
    });
    
    // Footer
    doc.setFillColor(4, 120, 87);
    doc.rect(0, pageHeight - 17, pageWidth, 17, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text('Sensoper Controls & Renewables | Solar Solutions Provider', pageWidth / 2, pageHeight - 8, { align: 'center' });
    
    // Save
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
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
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
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
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
                  <User className="h-5 w-5 text-emerald-600" />
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
                  <MapPin className="h-5 w-5 text-emerald-600" />
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
                  <Zap className="h-5 w-5 text-emerald-600" />
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
                  <Sun className="h-5 w-5 text-emerald-600" />
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
