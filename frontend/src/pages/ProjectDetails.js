import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsAPI, termsAPI, companyAPI, marginAPI, uploadAPI } from '../utils/api';
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
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { loadUnicodeFont } from '../utils/pdfFont';

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
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900 text-right max-w-[60%]">{value || '-'}</span>
    </div>
  );
}

import DOMPurify from 'dompurify';

function stripHtml(html) { return DOMPurify.sanitize(html, { ALLOWED_TAGS: [] }); }
function parseTermsHtml(html) {
  const clean = DOMPurify.sanitize(html);
  const liRegex = /<li[^>]*>(.*?)<\/li>/gi;
  const matches = [...clean.matchAll(liRegex)];
  if (matches.length > 0) return matches.map(m => stripHtml(m[1]));
  return stripHtml(html).split('\n').filter(line => line.trim());
}

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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');
  const [terms, setTerms] = useState(null);
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
      try {
        if (res.data.terms_id) {
          const tRes = await termsAPI.getById(res.data.terms_id);
          setTerms(tRes.data);
        } else {
          const tRes = await termsAPI.getActive();
          setTerms(tRes.data);
        }
      } catch (e) {
        // Fall back to active if the specific terms_id lookup fails (e.g., template deleted)
        try { const fb = await termsAPI.getActive(); setTerms(fb.data); } catch (e2) { console.error('Failed to fetch terms:', e2); }
      }
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
    const cp = companyProfile || {};
    const doc = new jsPDF();
    const FONT = await loadUnicodeFont(doc);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const m = 15;
    const contentW = pageWidth - m * 2;

    const primaryHex = cp.primary_color || '#4ADE40';
    const secondaryHex = cp.secondary_color || '#2D9BF0';
    const hexToRgb = (hex) => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
    const pRgb = hexToRgb(primaryHex);
    const sRgb = hexToRgb(secondaryHex);
    const currency = (val) => `₹${(val || 0).toLocaleString('en-IN')}`;

    // Fetch logo as base64 from backend (bypasses CORS)
    let logoBase64 = null;
    try {
      const logoRes = await fetch(`${API_URL}/api/company/logo-base64`);
      const logoData = await logoRes.json();
      logoBase64 = logoData.logo_base64;
    } catch (e) { console.error('Failed to fetch logo base64:', e); }

    // Generate QR codes
    let driveQR = null;
    const driveLink = project.drive_folder_link;
    if (driveLink) {
      try { driveQR = await QRCode.toDataURL(driveLink, { width: 150, margin: 1 }); } catch (e) { console.error('Drive QR generation failed:', e); }
    }

    let upiQR = null;
    const upiId = cp.bank_details?.upi_id;
    if (upiId) {
      const totalAmt = project.cost_estimation?.total_cost || 0;
      const upiString = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(cp.company_name || 'Sensoper')}&am=${totalAmt}&cu=INR&tn=${encodeURIComponent(`Payment for ${project.reference_number || ''}`)}`;
      try { upiQR = await QRCode.toDataURL(upiString, { width: 150, margin: 1 }); } catch (e) { console.error('Failed to generate UPI QR:', e); }
    }

    const drawHeader = (d) => {
      d.setFillColor(255, 255, 255);
      d.rect(0, 0, pageWidth, 42, 'F');
      d.setDrawColor(...pRgb);
      d.setLineWidth(1);
      d.line(0, 42, pageWidth, 42);

      // Large prominent logo
      if (logoBase64) {
        try {
          d.addImage(logoBase64, 'PNG', m, 4, 55, 34);
        } catch (e) { console.error('Logo embed failed:', e); }
      } else {
        // Fallback: text company name if logo fails
        d.setFontSize(16); d.setFont(FONT, 'bold'); d.setTextColor(...pRgb);
        d.text(cp.company_name || 'Sensoper Controls & Renewables', m, 20);
      }

      // Contact info on right side
      d.setFontSize(7.5); d.setTextColor(100, 100, 100); d.setFont(FONT, 'normal');
      const contact = [cp.phone, cp.email, cp.website].filter(Boolean);
      contact.forEach((line, i) => { d.text(line, pageWidth - m, 14 + i * 4, { align: 'right' }); });
      if (cp.gst_number) {
        d.setFontSize(7);
        d.text(`GSTIN: ${cp.gst_number}`, pageWidth - m, 14 + contact.length * 4, { align: 'right' });
      }
    };

    const drawFooter = (d, pg, total) => {
      d.setDrawColor(200, 200, 200); d.setLineWidth(0.3); d.line(m, pageHeight - 12, pageWidth - m, pageHeight - 12);
      d.setFontSize(7); d.setTextColor(150, 150, 150);
      d.text(cp.company_name || 'Sensoper Controls & Renewables', m, pageHeight - 6);
      d.text(`Page ${pg} of ${total}`, pageWidth - m, pageHeight - 6, { align: 'right' });
    };

    drawHeader(doc);
    let y = 48;

    // Quote ref box
    const refNum = project.reference_number || `SCR-${id.slice(0,8).toUpperCase()}`;
    doc.setFillColor(245, 247, 250); doc.roundedRect(m, y, contentW, 16, 2, 2, 'F');
    doc.setDrawColor(220, 220, 230); doc.roundedRect(m, y, contentW, 16, 2, 2, 'S');
    doc.setFontSize(10); doc.setFont(FONT, 'bold'); doc.setTextColor(40, 40, 40);
    doc.text('SOLAR PROJECT QUOTATION', m + 4, y + 6);
    doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
    doc.text(`Ref: ${refNum}`, m + 4, y + 12);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`, pageWidth - m - 4, y + 6, { align: 'right' });
    doc.text(`Status: ${(project.status || 'draft').toUpperCase()}`, pageWidth - m - 4, y + 12, { align: 'right' });
    y += 24;

    const sectionHead = (title, yPos) => {
      doc.setFontSize(11); doc.setFont(FONT, 'bold'); doc.setTextColor(...sRgb);
      doc.text(title, m, yPos); doc.setDrawColor(...sRgb); doc.setLineWidth(0.4);
      doc.line(m, yPos + 1.5, m + doc.getTextWidth(title), yPos + 1.5);
      return yPos + 7;
    };

    // Customer
    y = sectionHead('Customer Details', y);
    autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9, cellPadding: 2, textColor: [50, 50, 50] }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40, textColor: [100, 100, 100] } },
      body: [['Name', project.customer?.name || '-'], ['Phone', project.customer?.phone || '-'], ['Email', project.customer?.email || '-'], ['Address', project.customer?.address || '-']],
    }); y = doc.lastAutoTable.finalY + 8;

    // Location
    y = sectionHead('Site Location', y);
    const locationRows = [];
    if (project.location?.site_location_words) locationRows.push(['What3Words', project.location.site_location_words]);
    if (project.location?.address) locationRows.push(['Address', project.location.address]);
    locationRows.push(['Roof Type', (project.mounting?.roof_type || '-').toUpperCase()]);
    locationRows.push(['Structure', project.mounting?.structure_type || '-']);
    locationRows.push(['Tilt Angle', `${project.mounting?.tilt_angle || 0}\u00B0`]);
    autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9, cellPadding: 2, textColor: [50, 50, 50] }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40, textColor: [100, 100, 100] } }, body: locationRows });
    y = doc.lastAutoTable.finalY + 8;

    // Electrical
    y = sectionHead('Electrical Details', y);
    autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9, cellPadding: 2, textColor: [50, 50, 50] }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, textColor: [100, 100, 100] } },
      body: [
        ['Service Type', project.electrical?.service_type || '-'],
        ['Sanction Load', `${project.electrical?.sanction_load_kw || 0} kW`],
        ['Connected Load', `${project.electrical?.connected_load_kw || 0} kW`],
        ['Monthly Consumption', `${project.electrical?.monthly_consumption_units || 0} units`],
        ['EB Tariff', `₹${project.electrical?.eb_tariff || 0}/unit`],
        ['System Type', (project.solar_system?.system_type || '-').toUpperCase()],
        ['Cable Length', `${project.additional?.cable_length_meters || 0} m`],
      ],
    }); y = doc.lastAutoTable.finalY + 12;

    // Cost Breakdown
    if (y > pageHeight - 80) { doc.addPage(); drawHeader(doc); y = 48; }
    doc.setFontSize(12); doc.setFont(FONT, 'bold'); doc.setTextColor(...pRgb);
    doc.text('Cost Breakdown', m, y); doc.setDrawColor(...pRgb); doc.setLineWidth(0.5);
    doc.line(m, y + 1.5, m + doc.getTextWidth('Cost Breakdown'), y + 1.5); y += 8;

    const items = project.cost_estimation?.items_breakdown || project.selected_items || [];
    const manualCosts = project.cost_estimation?.manual_costs || project.manual_costs || [];
    const costRows = items.map(item => [item.name, CATEGORY_LABELS[item.category] || item.category, String(item.quantity), currency(item.unit_price), `${item.gst_percentage || 18}%`, currency(item.amount || (item.unit_price * item.quantity))]);

    autoTable(doc, { startY: y, margin: { left: m, right: m },
      head: [['Item', 'Category', 'Qty', 'Unit Price', 'GST', 'Amount']], body: costRows, theme: 'grid',
      headStyles: { font: FONT, fillColor: pRgb, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
      styles: { font: FONT, fontSize: 8.5, cellPadding: 3, textColor: [40, 40, 40], lineColor: [220, 220, 230], lineWidth: 0.3 },
      columnStyles: { 0: { cellWidth: contentW * 0.28 }, 1: { cellWidth: contentW * 0.18 }, 2: { halign: 'center', cellWidth: contentW * 0.08 }, 3: { halign: 'right', cellWidth: contentW * 0.16 }, 4: { halign: 'center', cellWidth: contentW * 0.1 }, 5: { halign: 'right', cellWidth: contentW * 0.2, fontStyle: 'bold' } },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      didDrawPage: (data) => { if (data.pageNumber > 1) drawHeader(data.doc); },
    }); y = doc.lastAutoTable.finalY + 2;

    if (manualCosts.length > 0) {
      autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'grid',
        styles: { font: FONT, fontSize: 8.5, cellPadding: 3, textColor: [40, 40, 40], lineColor: [220, 220, 230], lineWidth: 0.3 },
        columnStyles: { 0: { cellWidth: contentW * 0.28, fontStyle: 'italic' }, 5: { halign: 'right', cellWidth: contentW * 0.2, fontStyle: 'bold' } },
        body: manualCosts.map(c => [c.description, '', '', '', '', currency(c.amount)]),
      }); y = doc.lastAutoTable.finalY + 2;
    }

    const ce = project.cost_estimation || {};
    autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 9, cellPadding: 3 },
      columnStyles: { 0: { cellWidth: contentW * 0.7, fontStyle: 'bold', textColor: [80, 80, 80] }, 1: { halign: 'right', cellWidth: contentW * 0.3 } },
      body: [['Subtotal', currency(ce.subtotal)], ['Total GST', currency(ce.total_gst)]],
    }); y = doc.lastAutoTable.finalY;

    autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'plain', styles: { font: FONT, fontSize: 13, cellPadding: 5, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: contentW * 0.7, textColor: [30, 30, 30] }, 1: { halign: 'right', cellWidth: contentW * 0.3, textColor: pRgb } },
      body: [['TOTAL AMOUNT', currency(ce.total_cost)]],
      didDrawCell: (data) => { if (data.row.index === 0 && data.column.index === 0) { doc.setDrawColor(...pRgb); doc.setLineWidth(0.8); doc.line(data.cell.x, data.cell.y, data.cell.x + contentW, data.cell.y); } },
    }); y = doc.lastAutoTable.finalY + 12;

    // Bank Details with UPI QR
    const bank = cp.bank_details;
    if (bank && bank.account_name) {
      if (y > pageHeight - 70) { doc.addPage(); drawHeader(doc); y = 48; }
      y = sectionHead('Bank Details for Payment', y);
      const bankTableWidth = upiQR ? contentW * 0.6 : contentW;
      autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'plain',
        styles: { font: FONT, fontSize: 9, cellPadding: 2, textColor: [50, 50, 50] },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45, textColor: [100, 100, 100] } },
        tableWidth: bankTableWidth,
        body: [['Account Name', bank.account_name], ['Account No.', bank.account_number], ['IFSC Code', bank.ifsc_code], ['Bank Name', bank.bank_name], ['Branch', bank.branch], ...(bank.upi_id ? [['UPI ID', bank.upi_id]] : [])],
      });
      if (upiQR) {
        try {
          const qrX = m + bankTableWidth + 10;
          const qrY = y - 2;
          doc.addImage(upiQR, 'PNG', qrX, qrY, 35, 35);
          doc.setFontSize(7); doc.setTextColor(100, 100, 100); doc.setFont(FONT, 'normal');
          doc.text('Scan to Pay (UPI)', qrX + 17.5, qrY + 39, { align: 'center' });
        } catch (e) { console.error('UPI QR PDF render failed:', e); }
      }
      y = doc.lastAutoTable.finalY + 12;
    }

    // Site Documentation QR
    if (driveLink && driveQR) {
      if (y > pageHeight - 70) { doc.addPage(); drawHeader(doc); y = 48; }
      y = sectionHead('Site Documentation', y);
      doc.setFontSize(9); doc.setFont(FONT, 'normal'); doc.setTextColor(80, 80, 80);
      if (project.drive_folder_name) {
        doc.text(`Folder: ${project.drive_folder_name}`, m, y); y += 5;
      }
      doc.text('Scan QR to access all site images and documents:', m, y); y += 5;
      try { doc.addImage(driveQR, 'PNG', m, y, 32, 32); } catch (e) { console.error('Drive QR PDF render failed:', e); }
      doc.setFontSize(7); doc.setTextColor(100, 100, 100);
      doc.text(driveLink, m + 36, y + 16, { maxWidth: contentW - 40 });
      y += 38;
    }

    // Terms
    if (y > pageHeight - 45) { doc.addPage(); drawHeader(doc); y = 48; }
    doc.setFontSize(10); doc.setFont(FONT, 'bold'); doc.setTextColor(80, 80, 80);
    doc.text('Terms & Conditions', m, y); doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.3); doc.line(m, y + 1.5, m + 48, y + 1.5); y += 7;
    const termsList = terms?.content ? parseTermsHtml(terms.content)
      : ['This quotation is valid for 30 days.', '50% advance payment required.', 'Balance on installation completion.', 'Installation: 7-14 working days after delivery.', '5-year workmanship warranty.', 'Panel warranty per manufacturer.'];
    autoTable(doc, { startY: y, margin: { left: m, right: m }, theme: 'plain',
      styles: { font: FONT, fontSize: 7.5, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, textColor: [80, 80, 80] },
      body: termsList.map((t, i) => [`${i + 1}. ${t}`]),
      didDrawPage: (data) => { drawHeader(data.doc); },
    });

    // ========= SOLAR PROJECT REPORT (TNEB Auto-Fetch + Sizing) =========
    const sr = project.solar_report;
    if (sr && sr.sizing && sr.financials) {
      try {
      // ---------- Chart helpers (jsPDF primitives, no external libs) ----------
      const COLORS = {
        emerald: [16, 185, 129], blue: [59, 130, 246], amber: [245, 158, 11],
        violet: [139, 92, 246], rose: [244, 63, 94], slate: [100, 116, 139],
        sky: [14, 165, 233], emeraldL: [167, 243, 208], blueL: [191, 219, 254],
      };

      const drawPie = (cx, cy, radius, slices, totalLabel = '') => {
        const total = slices.reduce((s, x) => s + (x.value || 0), 0);
        if (total <= 0) {
          doc.setFillColor(230, 230, 230); doc.circle(cx, cy, radius, 'F'); return;
        }
        let angle = -Math.PI / 2;
        slices.forEach(slice => {
          const fr = (slice.value || 0) / total;
          if (fr <= 0) return;
          const sliceAngle = fr * Math.PI * 2;
          const steps = Math.max(12, Math.ceil(sliceAngle * 24));
          doc.setFillColor(...slice.color);
          for (let i = 0; i < steps; i++) {
            const a1 = angle + (sliceAngle * i / steps);
            const a2 = angle + (sliceAngle * (i + 1) / steps);
            doc.triangle(
              cx, cy,
              cx + radius * Math.cos(a1), cy + radius * Math.sin(a1),
              cx + radius * Math.cos(a2), cy + radius * Math.sin(a2),
              'F'
            );
          }
          angle += sliceAngle;
        });
        // Donut hole + center label
        doc.setFillColor(255, 255, 255);
        doc.circle(cx, cy, radius * 0.55, 'F');
        if (totalLabel) {
          doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(40, 40, 40);
          doc.text(totalLabel, cx, cy + 1, { align: 'center' });
        }
      };

      const drawPieLegend = (x, yy, slices, total) => {
        doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(60, 60, 60);
        slices.forEach((s, i) => {
          const ly = yy + i * 5;
          doc.setFillColor(...s.color); doc.rect(x, ly - 2.2, 3, 3, 'F');
          const pct = total > 0 ? ((s.value / total) * 100).toFixed(1) : '0';
          doc.text(`${s.label}`, x + 4.5, ly);
          doc.setFont(FONT, 'bold');
          doc.text(`${s.fmt ? s.fmt(s.value) : s.value}  (${pct}%)`, x + 4.5, ly + 3);
          doc.setFont(FONT, 'normal');
        });
      };

      const drawBarChartV = (x, yy, w, h, data, opts = {}) => {
        const padTop = 6, padBot = 13, padL = 3;
        const safeData = (data || []).map(d => ({
          ...d,
          value: Number(d.value) || 0,
          color: Array.isArray(d.color) ? d.color : COLORS.blue,
          label: String(d.label || ''),
        }));
        if (safeData.length === 0) return;
        const maxVal = Math.max(...safeData.map(d => d.value), 1);
        const chartH = Math.max(h - padTop - padBot, 1);
        const chartW = Math.max(w - padL, 1);
        const barW = (chartW / safeData.length) * 0.65;
        const gap = (chartW / safeData.length) * 0.35;
        // X-axis
        doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
        doc.line(x + padL, yy + padTop + chartH, x + w, yy + padTop + chartH);
        safeData.forEach((d, i) => {
          const bx = x + padL + gap / 2 + i * (barW + gap);
          const ratio = maxVal > 0 ? d.value / maxVal : 0;
          const bh = Math.max(0, Math.min(ratio * chartH, chartH));
          const by = yy + padTop + chartH - bh;
          if (!isFinite(bh) || !isFinite(bx) || !isFinite(by) || bh <= 0 || barW <= 0) {
            // Still draw the label for empty bars
          } else {
            doc.setFillColor(...d.color);
            doc.rect(bx, by, barW, bh, 'F');
          }
          doc.setFont(FONT, 'bold'); doc.setFontSize(6.5); doc.setTextColor(40, 40, 40);
          doc.text(opts.valueFormat ? opts.valueFormat(d.value) : String(Math.round(d.value)), bx + barW / 2, by - 0.8, { align: 'center' });
          doc.setFont(FONT, 'normal'); doc.setFontSize(6.5); doc.setTextColor(80, 80, 80);
          doc.text(d.label, bx + barW / 2, yy + padTop + chartH + 4, { align: 'center', maxWidth: barW + gap });
        });
      };

      const drawLineChart = (x, yy, w, h, series, opts = {}) => {
        const padTop = 7, padBot = 10, padL = 16, padR = 4;
        const chartW = w - padL - padR;
        const chartH = h - padTop - padBot;
        const allYs = series.flatMap(s => s.data.map(p => p.y));
        const maxY = Math.max(...allYs, 1);
        const xCount = series[0].data.length;
        // Axes
        doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2);
        doc.line(x + padL, yy + padTop, x + padL, yy + padTop + chartH);
        doc.line(x + padL, yy + padTop + chartH, x + padL + chartW, yy + padTop + chartH);
        // Gridlines + Y labels
        for (let g = 1; g <= 4; g++) {
          const gy = yy + padTop + chartH - (chartH * g / 4);
          doc.setDrawColor(240, 240, 240); doc.line(x + padL, gy, x + padL + chartW, gy);
          doc.setFont(FONT, 'normal'); doc.setFontSize(5.5); doc.setTextColor(130, 130, 130);
          doc.text((opts.yAxisFormat ? opts.yAxisFormat(maxY * g / 4) : String(Math.round(maxY * g / 4))), x + padL - 1, gy + 1, { align: 'right' });
        }
        // Series lines + filled area
        series.forEach(s => {
          if (s.fill) {
            const pts = s.data.map((p, i) => [
              x + padL + chartW * (i / (xCount - 1)),
              yy + padTop + chartH - chartH * (p.y / maxY)
            ]);
            doc.setFillColor(...(s.fillColor || s.color));
            // Build polygon
            for (let i = 0; i < pts.length - 1; i++) {
              doc.triangle(
                pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
                pts[i + 1][0], yy + padTop + chartH, 'F'
              );
              doc.triangle(
                pts[i][0], pts[i][1], pts[i + 1][0], yy + padTop + chartH,
                pts[i][0], yy + padTop + chartH, 'F'
              );
            }
          }
          doc.setDrawColor(...(s.color || COLORS.blue));
          doc.setLineWidth(s.lineWidth || 0.6);
          for (let i = 1; i < s.data.length; i++) {
            const x1 = x + padL + chartW * ((i - 1) / (xCount - 1));
            const y1 = yy + padTop + chartH - chartH * (s.data[i - 1].y / maxY);
            const x2 = x + padL + chartW * (i / (xCount - 1));
            const y2 = yy + padTop + chartH - chartH * (s.data[i].y / maxY);
            doc.line(x1, y1, x2, y2);
          }
        });
        // X labels
        const xLabels = opts.xLabels || [];
        doc.setFont(FONT, 'normal'); doc.setFontSize(5.5); doc.setTextColor(130, 130, 130);
        xLabels.forEach((lbl, i) => {
          const lx = x + padL + chartW * (i / (xCount - 1));
          doc.text(String(lbl), lx, yy + padTop + chartH + 4, { align: 'center' });
        });
        // Legend (top-right)
        let lx = x + w - padR;
        [...series].reverse().forEach(s => {
          const tw = doc.getTextWidth(s.name);
          lx -= (tw + 6);
          doc.setFillColor(...s.color); doc.rect(lx, yy + 2, 3, 3, 'F');
          doc.setFontSize(6); doc.setTextColor(80, 80, 80); doc.text(s.name, lx + 4, yy + 4.5);
          lx -= 4;
        });
      };

      const drawHGauge = (x, yy, w, label, value, max, color, valFmt) => {
        const h = 4;
        doc.setFillColor(238, 238, 238); doc.rect(x, yy, w, h, 'F');
        const fillW = Math.min((value / max) * w, w);
        doc.setFillColor(...color); doc.rect(x, yy, fillW, h, 'F');
        doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(80, 80, 80);
        doc.text(label, x, yy - 1.2);
        doc.setFont(FONT, 'bold'); doc.setTextColor(40, 40, 40);
        doc.text(valFmt ? valFmt(value) : String(value), x + w, yy - 1.2, { align: 'right' });
      };

      const drawKpiBox = (x, yy, w, h, label, value, color) => {
        doc.setFillColor(...color); doc.setDrawColor(...color); doc.roundedRect(x, yy, w, h, 1.2, 1.2, 'FD');
        doc.setFont(FONT, 'normal'); doc.setFontSize(6.5); doc.setTextColor(255, 255, 255);
        doc.text(label.toUpperCase(), x + w / 2, yy + 4, { align: 'center' });
        doc.setFont(FONT, 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
        doc.text(String(value), x + w / 2, yy + h - 2.5, { align: 'center' });
      };
      // ---------- /Chart helpers ----------

      const f = sr.financials;
      const t = sr.technical;
      const sz = sr.sizing;

      // ===== PAGE 1: Header + Plain-English Summary + KPI strip + Consumer + Cost Pie =====
      doc.addPage(); drawHeader(doc); let sy = 48;

      // Banner
      doc.setFillColor(...pRgb); doc.rect(m, sy - 4, contentW, 9, 'F');
      doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
      doc.text('Solar Project Report (TNEB / Sizing / 25-Year Projection)', m + 3, sy + 2);
      doc.setTextColor(50, 50, 50); sy += 12;

      // ===== Plain-English Hero Summary (Apple-style, layman-friendly) =====
      const monthlyBill = parseFloat(sr.avg_monthly_bill || 0);
      const monthlyAfter = Math.max(monthlyBill - f.monthly_savings, 0);
      const heroH = 36;
      doc.setFillColor(248, 250, 252); doc.roundedRect(m, sy, contentW, heroH, 2, 2, 'F');
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2);
      doc.roundedRect(m, sy, contentW, heroH, 2, 2, 'S');
      doc.setFont(FONT, 'bold'); doc.setFontSize(11); doc.setTextColor(30, 41, 59);
      doc.text('At a Glance — What this means for you', m + 4, sy + 6);

      const heroBoxW = (contentW - 8) / 4;
      const heroRows = [
        { label: 'You invest', value: currency(f.net_cost), sub: `after ${currency(f.subsidy)} subsidy`, color: COLORS.blue },
        { label: 'You save monthly', value: currency(f.monthly_savings), sub: `from ₹${Math.round(monthlyBill)}/mo bill`, color: COLORS.emerald },
        { label: 'Cost recovered in', value: f.payback_years ? `${f.payback_years} years` : '-', sub: 'breaks even after this', color: COLORS.amber },
        { label: 'Total saved (25 yrs)', value: currency(f.total_25yr_savings), sub: `ROI ${f.roi_pct || 0}%`, color: COLORS.rose },
      ];
      heroRows.forEach((row, i) => {
        const hx = m + 4 + i * heroBoxW;
        // small color dot
        doc.setFillColor(...row.color); doc.circle(hx + 2, sy + 13, 1.2, 'F');
        doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
        doc.text(row.label.toUpperCase(), hx + 5, sy + 13.5);
        doc.setFont(FONT, 'bold'); doc.setFontSize(13.5); doc.setTextColor(15, 23, 42);
        doc.text(String(row.value), hx + 5, sy + 22);
        doc.setFont(FONT, 'normal'); doc.setFontSize(6.5); doc.setTextColor(100, 116, 139);
        doc.text(row.sub, hx + 5, sy + 28, { maxWidth: heroBoxW - 6 });
      });
      // Narrative line at bottom
      doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(71, 85, 105);
      doc.text(`In plain English: A solar system of ${sz.kwp_recommended} kWp (${sz.num_panels} panels) installed on your roof will cut your electricity bill from about ${currency(monthlyBill)} to ${currency(monthlyAfter)} every month. After ${f.payback_years || '-'} years, every rupee you save is pure profit — for the next ~20+ years.`, m + 4, sy + 33, { maxWidth: contentW - 8 });
      sy += heroH + 6;
      // ===== /Plain-English Hero =====

      // KPI strip — 5 colored boxes
      const kpiH = 14; const kpiGap = 2.2; const kpiW = (contentW - kpiGap * 4) / 5;
      drawKpiBox(m + 0 * (kpiW + kpiGap), sy, kpiW, kpiH, 'Capacity', `${sz.kwp_recommended} kWp`, COLORS.emerald);
      drawKpiBox(m + 1 * (kpiW + kpiGap), sy, kpiW, kpiH, 'Panels', `${sz.num_panels} × ${sz.panel_wattage_w}W`, COLORS.blue);
      drawKpiBox(m + 2 * (kpiW + kpiGap), sy, kpiW, kpiH, 'Inverter', `${sz.inverter_capacity_kw} kW`, COLORS.amber);
      drawKpiBox(m + 3 * (kpiW + kpiGap), sy, kpiW, kpiH, 'Payback', f.payback_years ? `${f.payback_years} yrs` : '-', COLORS.violet);
      drawKpiBox(m + 4 * (kpiW + kpiGap), sy, kpiW, kpiH, '25-Yr Savings', `${currency(f.total_25yr_savings)}`, COLORS.rose);
      sy += kpiH + 8;

      // Consumer mini-table (compact, left half) + Pie (right half)
      const halfW = (contentW - 4) / 2;
      // LEFT: Consumer
      doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(80, 80, 80);
      doc.text('Consumer Details (TNEB)', m, sy);
      doc.setDrawColor(180, 180, 180); doc.line(m, sy + 1.5, m + 50, sy + 1.5);
      autoTable(doc, { startY: sy + 3, margin: { left: m },
        tableWidth: halfW, theme: 'plain',
        styles: { font: FONT, fontSize: 8, cellPadding: 1.2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38, textColor: [110, 110, 110] }, 1: { textColor: [40, 40, 40] } },
        body: [
          ['Consumer', sr.consumer_name || '-'],
          ['Service No.', sr.service_number || '-'],
          ['Phone', sr.phone || '-'],
          ['Address', (sr.address || project.customer?.address || '-').slice(0, 60)],
          ['Tariff', `${sr.tariff_category || '-'}  ·  ${sr.connection_type || '-'}`],
          ['Avg Bill', sr.avg_monthly_bill ? currency(parseFloat(sr.avg_monthly_bill)) + '/mo' : '-'],
          ['Avg Units', `${sr.avg_monthly_consumption_units || sr.avg_monthly_consumption || 0} units/mo`],
          ['Sanctioned', sr.sanctioned_load_kw ? `${sr.sanctioned_load_kw} kW` : '-'],
          ['Irradiation', `${sr.irradiation_kwh_m2_day || 5.0} kWh/m²/day`],
        ]
      });
      // RIGHT: Cost Breakdown Donut
      const pieX = m + halfW + 4;
      doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(80, 80, 80);
      doc.text('Cost Breakdown', pieX, sy);
      doc.line(pieX, sy + 1.5, pieX + 30, sy + 1.5);
      const pieCx = pieX + 22; const pieCy = sy + 28; const pieR = 18;
      const costSlices = [
        { label: 'Govt Subsidy', value: f.subsidy, color: COLORS.emerald, fmt: currency },
        { label: 'Net Cost (You Pay)', value: f.net_cost, color: COLORS.blue, fmt: currency },
      ];
      drawPie(pieCx, pieCy, pieR, costSlices, currency(f.total_cost));
      drawPieLegend(pieX + 46, sy + 14, costSlices, f.total_cost);
      // Plain-English caption under cost pie
      doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
      doc.text(`Out of every ${currency(100)} of project cost, the government pays ${currency(Math.round((f.subsidy / Math.max(f.total_cost, 1)) * 100))} as subsidy. You pay only ${currency(Math.round((f.net_cost / Math.max(f.total_cost, 1)) * 100))}.`, pieX, sy + 53, { maxWidth: halfW });
      sy = Math.max(sy + 60, doc.lastAutoTable?.finalY || sy) + 6;

      // ===== Monthly economics bar + Sizing donut =====
      if (sy > pageHeight - 70) { doc.addPage(); drawHeader(doc); sy = 48; }
      // LEFT: Monthly economics bar
      doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(80, 80, 80);
      doc.text('Monthly Economics', m, sy);
      doc.line(m, sy + 1.5, m + 38, sy + 1.5);
      const barData = [
        { label: 'Avg Bill', value: parseFloat(sr.avg_monthly_bill || 0), color: COLORS.rose },
        { label: 'Solar Savings', value: f.monthly_savings, color: COLORS.emerald },
        { label: 'Generation', value: f.monthly_generation_units * f.tariff_per_unit, color: COLORS.blue },
        { label: 'Net Bill', value: Math.max(parseFloat(sr.avg_monthly_bill || 0) - f.monthly_savings, 0), color: COLORS.amber },
      ];
      drawBarChartV(m, sy + 4, halfW, 50, barData, { valueFormat: (v) => '₹' + Math.round(v).toLocaleString('en-IN') });
      // Caption under monthly bar
      doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
      doc.text(`Your monthly bill drops from ${currency(monthlyBill)} to about ${currency(monthlyAfter)}. That is ${currency(f.monthly_savings)} back in your pocket every single month.`, m, sy + 58, { maxWidth: halfW });
      // RIGHT: Energy mix donut (Solar vs Grid)
      doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(80, 80, 80);
      doc.text('Energy Source Mix (After Solar)', pieX, sy);
      doc.line(pieX, sy + 1.5, pieX + 55, sy + 1.5);
      const solarUnits = Math.min(f.monthly_generation_units, (sr.avg_monthly_consumption_units || sr.avg_monthly_consumption || f.monthly_generation_units));
      const gridUnits = Math.max(((sr.avg_monthly_consumption_units || sr.avg_monthly_consumption) || 0) - solarUnits, 0);
      const energySlices = [
        { label: 'Solar (Free)', value: solarUnits, color: COLORS.emerald, fmt: v => Math.round(v) + ' units' },
        { label: 'Grid (Paid)', value: gridUnits, color: COLORS.slate, fmt: v => Math.round(v) + ' units' },
      ];
      const pieCy2 = sy + 28;
      drawPie(pieCx, pieCy2, pieR, energySlices, Math.round(solarUnits + gridUnits) + ' units');
      drawPieLegend(pieX + 46, sy + 14, energySlices, solarUnits + gridUnits);
      // Caption under energy mix pie
      doc.setFont(FONT, 'normal'); doc.setFontSize(6.5); doc.setTextColor(100, 116, 139);
      doc.text(`Sun powers ${Math.round(solarUnits)} units of your ${Math.round(solarUnits + gridUnits)} units / month. The grid only fills the gap.`, pieX, sy + 58, { maxWidth: halfW });
      sy += 65;

      // ===== Technical KPI gauges =====
      if (sy > pageHeight - 50) { doc.addPage(); drawHeader(doc); sy = 48; }
      doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(80, 80, 80);
      doc.text('Technical Performance', m, sy);
      doc.line(m, sy + 1.5, m + 45, sy + 1.5); sy += 8;
      const gaugeW = (contentW - 6) / 2;
      drawHGauge(m, sy, gaugeW, 'Performance Ratio (PR)', t.performance_ratio, 1, COLORS.violet, v => v.toFixed(2));
      drawHGauge(m + gaugeW + 6, sy, gaugeW, 'CUF', t.cuf_pct, 25, COLORS.sky, v => v + '%'); sy += 9;
      drawHGauge(m, sy, gaugeW, 'Panel Efficiency (1 - Degradation)', 100 - t.degradation_pct_per_year, 100, COLORS.emerald, v => v.toFixed(1) + '%');
      drawHGauge(m + gaugeW + 6, sy, gaugeW, 'Annual Generation', t.annual_generation_units, t.annual_generation_units * 1.2, COLORS.blue, v => Math.round(v).toLocaleString('en-IN') + ' units'); sy += 9;
      drawHGauge(m, sy, gaugeW, 'CO₂ Offset / Year', t.co2_offset_kg_per_year, t.co2_offset_kg_per_year * 1.2, COLORS.emerald, v => v.toLocaleString('en-IN') + ' kg');
      drawHGauge(m + gaugeW + 6, sy, gaugeW, 'ROI (25-Year)', f.roi_pct || 0, Math.max(f.roi_pct || 0, 500), COLORS.amber, v => v + '%'); sy += 12;

      // ===== 25-Year Cumulative Savings Line + Yearly Bar =====
      if (f.yearly_breakdown && f.yearly_breakdown.length) {
        // Always start on a new page for chart clarity
        if (sy > pageHeight - 110) { doc.addPage(); drawHeader(doc); sy = 48; }
        doc.setFont(FONT, 'bold'); doc.setFontSize(11); doc.setTextColor(40, 40, 40);
        doc.text('25-Year Savings Projection', m, sy);
        doc.line(m, sy + 1.5, m + 60, sy + 1.5); sy += 5;

        const yb = f.yearly_breakdown;
        const lineSeries = [{
          name: 'Cumulative Savings (₹)',
          data: yb.map(r => ({ x: r.year, y: r.cumulative })),
          color: COLORS.amber, fill: true, fillColor: [254, 243, 199], lineWidth: 0.8,
        }, {
          name: 'Yearly Savings (₹)',
          data: yb.map(r => ({ x: r.year, y: r.savings })),
          color: COLORS.blue, lineWidth: 0.6,
        }];
        const xLabels = yb.map((r, i) => (i === 0 || (i + 1) % 5 === 0) ? `Year ${r.year}` : '');
        drawLineChart(m, sy + 2, contentW, 65, lineSeries, {
          xLabels,
          yAxisFormat: (v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : Math.round(v),
        });
        sy += 70;
        // Caption under 25-yr line
        doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(71, 85, 105);
        doc.text(`Year-on-year, your savings grow because electricity tariffs typically increase ~2.5% a year. Over 25 years you save a total of ${currency(f.total_25yr_savings)} — that is roughly ${Math.round(f.total_25yr_savings / Math.max(f.net_cost, 1))}× what you invested.`, m, sy, { maxWidth: contentW });
        sy += 6;

        // Yearly snapshot bars (Y1, Y5, Y10, Y15, Y20, Y25)
        const snapshots = yb.filter(r => r.year === 1 || r.year % 5 === 0);
        if (sy > pageHeight - 60) { doc.addPage(); drawHeader(doc); sy = 48; }
        doc.setFont(FONT, 'bold'); doc.setFontSize(9.5); doc.setTextColor(80, 80, 80);
        doc.text('5-Year Savings Snapshots', m, sy);
        doc.line(m, sy + 1.5, m + 45, sy + 1.5); sy += 4;
        drawBarChartV(m, sy, contentW, 45,
          snapshots.map(r => ({
            label: `Year ${r.year}`,
            value: r.savings,
            color: r.year === 1 ? COLORS.blue : r.year <= 10 ? COLORS.emerald : r.year <= 20 ? COLORS.amber : COLORS.rose,
          })),
          { valueFormat: (v) => '₹' + (v >= 100000 ? (v / 100000).toFixed(1) + ' Lakh' : (v / 1000).toFixed(0) + 'K') }
        );
        sy += 50;
      }

      // Closing note
      if (sy > pageHeight - 20) { doc.addPage(); drawHeader(doc); sy = 48; }
      doc.setFillColor(245, 245, 245); doc.roundedRect(m, sy, contentW, 11, 1.5, 1.5, 'F');
      doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(80, 80, 80);
      doc.text('All financial projections assume 2.5% annual tariff escalation and 0.7% annual panel degradation. PM Surya Ghar subsidy applies only to residential domestic on-grid systems (capped at ₹78,000 for 3 kWp and above). Actual savings may vary with shading, weather, and site conditions.', m + 3, sy + 4, { maxWidth: contentW - 6 });
      } catch (solarPdfErr) {
        console.error('Solar report PDF section failed; skipping. Error:', solarPdfErr);
      }
    }
    // ========= /SOLAR PROJECT REPORT =========

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) { doc.setPage(i); if (i > 1) drawHeader(doc); drawFooter(doc, i, totalPages); }
    doc.save(`Quotation-${project.customer?.name || 'Customer'}-${new Date().toISOString().split('T')[0]}.pdf`);
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
      ['Sanction Load (kW)', project.electrical?.sanction_load_kw || 0],
      ['Connected Load (kW)', project.electrical?.connected_load_kw || 0],
      ['Monthly Consumption (units)', project.electrical?.monthly_consumption_units || 0],
      ['EB Tariff (₹/unit)', project.electrical?.eb_tariff || 0],
      ['System Type', project.solar_system?.system_type || '-'],
      ['Cable Length (m)', project.additional?.cable_length_meters || 0],
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
            <Button variant="outline" onClick={generatePDF} className="gap-2" data-testid="download-pdf-btn"><Download className="h-4 w-4" />PDF</Button>
            {(project.status === 'approved' || project.status === 'completed') && (
              <Button variant="outline" onClick={shareViaWhatsApp} className="gap-2" data-testid="share-whatsapp-btn"><Share2 className="h-4 w-4" />WhatsApp</Button>
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
                <InfoRow label="Sanction Load" value={`${project.electrical?.sanction_load_kw} kW`} />
                <InfoRow label="Connected Load" value={`${project.electrical?.connected_load_kw} kW`} />
                <InfoRow label="Monthly Consumption" value={`${project.electrical?.monthly_consumption_units} units`} />
                <InfoRow label="EB Tariff" value={`₹${project.electrical?.eb_tariff}/unit`} />
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
                {project.additional?.shadow_analysis_notes && <div className="mt-4 p-3 bg-slate-50 rounded-lg"><p className="text-sm font-medium text-slate-700">Shadow Analysis Notes:</p><p className="text-sm text-slate-600">{project.additional.shadow_analysis_notes}</p></div>}
              </CardContent>
            </Card>

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
    </div>
  );
}
