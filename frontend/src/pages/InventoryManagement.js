import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { inventoryAPI, locationsAPI } from '../utils/api';
import { useAuth, formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { 
  ArrowLeft, Plus, Edit, Trash2, Loader2, Package, AlertTriangle,
  Search, Warehouse, Tag, X, CheckCircle2, Circle, Link2, CalendarDays,
  Upload, FileSpreadsheet, FileText, Download, Layers
} from 'lucide-react';

const REQUIRED_IMPORT_FIELDS = ['name', 'sku_code', 'category', 'quantity', 'unit_price'];
const IMPORT_STATUS_STYLES = {
  will_create: 'bg-emerald-100 text-emerald-700',
  will_update: 'bg-blue-100 text-blue-700',
  will_skip: 'bg-rose-100 text-rose-700',
};

export default function InventoryManagement() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [showCatDialog, setShowCatDialog] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterLocation, setFilterLocation] = useState('all');
  const [branchSort, setBranchSort] = useState(null); // 'asc' | 'desc' | null
  const [imagePreviewOk, setImagePreviewOk] = useState(true);
  const [newCat, setNewCat] = useState({ name: '', slug: '', description: '' });
  
  const [itemForm, setItemForm] = useState({
    name: '', sku_code: '', category: '',
    zone: '', aisle: '', shelf: '', rack: '', bin_location: '',
    quantity: 0, unit_price: 0, supplier: '', gst_percentage: 18, hsn_code: '', reorder_level: 10,
    image_url: '', active: true, qc_checklist: [], procurement_date: '', location_id: ''
  });
  const [newQcItem, setNewQcItem] = useState('');
  
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  // Import / Export state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // preview response
  const [columnMapOverrides, setColumnMapOverrides] = useState({});
  const [dryRun, setDryRun] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [exportLoading, setExportLoading] = useState(null);

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  };

  const downloadErrorsCsv = (errors) => {
    const header = 'row,column,error,value\n';
    const rows = errors.map(e => [e.row, e.column || '', (e.error || '').replace(/,/g, ';'), e.value != null ? String(e.value).replace(/,/g, ';') : ''].join(',')).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    downloadBlob(blob, 'inventory_import_errors.csv');
  };

  const handleDownloadTemplate = async () => {
    try { const res = await inventoryAPI.downloadTemplate(); downloadBlob(res.data, 'inventory_import_template.xlsx'); }
    catch (e) { setError('Failed to download template'); }
  };

  const handlePreview = async () => {
    if (!importFile) { setError('Select a file first'); return; }
    setPreviewing(true); setError(''); setImportResult(null);
    try {
      const res = await inventoryAPI.previewImport(importFile);
      setImportPreview(res.data);
      if (res.data.status === 'needs_mapping') {
        const seed = {};
        REQUIRED_IMPORT_FIELDS.forEach(f => { seed[f] = res.data.column_mapping?.[f] || ''; });
        setColumnMapOverrides(seed);
      }
    } catch (e) { setError(formatApiErrorDetail(e.response?.data?.detail) || 'Could not read this file. Save it as .xlsx or .csv and try again.'); }
    finally { setPreviewing(false); }
  };

  const handleConfirmMapping = async () => {
    setPreviewing(true); setError('');
    try {
      const res = await inventoryAPI.previewImport(importFile); // re-parse then re-map client-selected columns for a fresh preview
      const merged = { ...(res.data.column_mapping || {}), ...columnMapOverrides };
      setImportPreview({ ...res.data, column_mapping: merged, status: Object.values(merged).every(Boolean) ? 'pending_confirm' : 'needs_mapping' });
    } catch (e) { setError('Could not re-validate the file'); }
    finally { setPreviewing(false); }
  };

  const handleImport = async () => {
    if (!importFile) { setError('Select a file first'); return; }
    setImporting(true); setError(''); setImportResult(null);
    try {
      const res = await inventoryAPI.importItems(importFile, { dryRun, columnMap: columnMapOverrides });
      if (res.data.status === 'needs_mapping') { setImportPreview(res.data); return; }
      setImportResult(res.data);
      if (!dryRun) fetchData();
    } catch (e) { setError(formatApiErrorDetail(e.response?.data?.detail) || 'Import failed'); }
    finally { setImporting(false); }
  };

  const handleExport = async (format) => {
    setExportLoading(format);
    try {
      const res = await inventoryAPI.exportItems(format);
      const today = new Date().toISOString().slice(0, 10);
      downloadBlob(res.data, `inventory_${today}.${format}`);
    } catch (e) { setError('Export failed'); }
    finally { setExportLoading(null); }
  };

  const fetchData = useCallback(async () => {
    try {
      const [itemsRes, alertsRes, catsRes, locsRes] = await Promise.all([
        inventoryAPI.getItems(), inventoryAPI.getAlerts(), inventoryAPI.getCategories(), locationsAPI.list()
      ]);
      setItems(itemsRes.data);
      setAlerts(alertsRes.data);
      setCategories(catsRes.data);
      setLocations(locsRes.data || []);
    } catch (err) { console.error('Failed to fetch inventory:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openItemDialog = (item = null) => {
    if (item) {
      setEditingItem(item);
      setItemForm({
        name: item.name, sku_code: item.sku_code, category: item.category,
        zone: item.zone || '', aisle: item.aisle || '', shelf: item.shelf || '',
        rack: item.rack || '', bin_location: item.bin_location || '',
        quantity: item.quantity, unit_price: item.unit_price,
        supplier: item.supplier || '', gst_percentage: item.gst_percentage || 18,
        hsn_code: item.hsn_code || '',
        reorder_level: item.reorder_level || 10, image_url: item.image_url || '',
        active: item.active !== undefined ? item.active : true,
        qc_checklist: Array.isArray(item.qc_checklist) ? item.qc_checklist : [],
        procurement_date: item.procurement_date || '',
        location_id: item.location_id || ''
      });
    } else {
      setEditingItem(null);
      setItemForm({
        name: '', sku_code: '', category: categories[0]?.slug || '',
        zone: '', aisle: '', shelf: '', rack: '', bin_location: '',
        quantity: 0, unit_price: 0, supplier: '', gst_percentage: 18, hsn_code: '', reorder_level: 10,
        image_url: '', active: true, qc_checklist: [], procurement_date: '', location_id: user?.default_location_id || ''
      });
    }
    setNewQcItem('');
    setImagePreviewOk(true);
    setError('');
    setShowItemDialog(true);
  };

  const isValidImageUrl = (url) => {
    if (!url) return true; // empty allowed
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
  };

  const handleSaveItem = async () => {
    if (!itemForm.name || !itemForm.sku_code || !itemForm.category) {
      setError('Name, SKU Code, and Category are required');
      return;
    }
    if (itemForm.image_url && !isValidImageUrl(itemForm.image_url)) {
      setError('Image URL must be a valid http(s) URL');
      return;
    }
    setActionLoading(true);
    setError('');
    try {
      const payload = { ...itemForm, location_id: itemForm.location_id || '' };
      if (editingItem) {
        await inventoryAPI.updateItem(editingItem.id, payload);
      } else {
        await inventoryAPI.createItem(payload);
      }
      setShowItemDialog(false);
      fetchData();
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || 'Operation failed');
    } finally { setActionLoading(false); }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try { await inventoryAPI.deleteItem(item.id); fetchData(); }
    catch (err) { alert(err.response?.data?.detail || 'Failed to delete'); }
  };

  const handleCreateCategory = async () => {
    if (!newCat.name || !newCat.slug) return;
    try {
      await inventoryAPI.createCategory(newCat);
      setNewCat({ name: '', slug: '', description: '' });
      setShowCatDialog(false);
      fetchData();
    } catch (err) { setError(formatApiErrorDetail(err.response?.data?.detail) || 'Failed'); }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm('Delete this category?')) return;
    try { await inventoryAPI.deleteCategory(id); fetchData(); }
    catch (err) { alert(err.response?.data?.detail || 'Cannot delete'); }
  };

  const filteredItems = items.filter(item => {
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !item.sku_code.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterCategory !== 'all' && item.category !== filterCategory) return false;
    if (filterLocation === 'global' && item.location_id) return false;
    if (filterLocation !== 'all' && filterLocation !== 'global' && item.location_id !== filterLocation) return false;
    return true;
  });

  const getCategoryLabel = (slug) => categories.find(c => c.slug === slug)?.name || slug;
  const getBranchLabel = (item) => locations.find(l => l.id === item.location_id)?.name || 'Global';
  const getWarehouseLocation = (item) => {
    const parts = [item.zone, item.aisle, item.shelf, item.rack, item.bin_location].filter(Boolean);
    return parts.length > 0 ? parts.join(' > ') : '-';
  };

  const sortedFilteredItems = [...filteredItems].sort((a, b) => {
    if (!branchSort) return 0;
    const cmp = getBranchLabel(a).localeCompare(getBranchLabel(b));
    return branchSort === 'asc' ? cmp : -cmp;
  });
  const toggleBranchSort = () => setBranchSort(p => p === 'asc' ? 'desc' : p === 'desc' ? null : 'asc');

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Link to="/dashboard"><Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold font-['Outfit'] text-slate-900">Inventory</h1>
              <p className="text-sm text-slate-500">{items.length} items in warehouse</p>
            </div>
          </div>
        </div>

        {alerts.length > 0 && (
          <Card className="border-amber-200 bg-amber-50 mb-4">
            <CardContent className="py-3 px-4 flex flex-wrap gap-2 items-center">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="text-sm font-medium text-amber-800">Low Stock:</span>
              {alerts.map(a => <Badge key={a.id} variant="outline" className="bg-white text-amber-800 border-amber-300 text-xs" data-testid={`alert-${a.id}`}>{a.name} ({a.quantity}){a.location_id ? ` · ${locations.find(l => l.id === a.location_id)?.name || 'Branch'}` : ''}</Badge>)}
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card className="border-slate-200 mb-4">
          <CardContent className="p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 h-11" data-testid="search-items" />
              </div>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-full sm:w-[180px] h-11" data-testid="filter-category"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(c => <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {locations.length > 0 && (
                <Select value={filterLocation} onValueChange={setFilterLocation}>
                  <SelectTrigger className="w-full sm:w-[180px] h-11" data-testid="filter-location"><SelectValue placeholder="Branch" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    <SelectItem value="global">Global (unassigned)</SelectItem>
                    {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <div className="flex flex-wrap gap-2">
                <Link to="/dashboard/inventory/kits" className="flex-1 sm:flex-none">
                  <Button variant="outline" className="w-full h-11 border-emerald-300 text-emerald-700 hover:bg-emerald-50" data-testid="material-kits-btn"><Layers className="h-4 w-4 mr-1" />Solution Kits</Button>
                </Link>
                <Button variant="outline" onClick={() => setShowImportDialog(true)} className="flex-1 sm:flex-none h-11" data-testid="import-inventory-btn"><Upload className="h-4 w-4 mr-1" />Import</Button>
                <Button variant="outline" onClick={() => handleExport('xlsx')} disabled={exportLoading==='xlsx'} className="flex-1 sm:flex-none h-11" data-testid="export-xlsx-btn">{exportLoading==='xlsx' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}Excel</Button>
                <Button variant="outline" onClick={() => handleExport('pdf')} disabled={exportLoading==='pdf'} className="flex-1 sm:flex-none h-11" data-testid="export-pdf-btn">{exportLoading==='pdf' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}PDF</Button>
                <Button variant="outline" onClick={() => setShowCatDialog(true)} className="flex-1 sm:flex-none h-11" data-testid="manage-categories-btn"><Tag className="h-4 w-4 mr-1" />Categories</Button>
                <Button onClick={() => openItemDialog()} className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white h-11" data-testid="add-item-btn"><Plus className="h-4 w-4 mr-1" />Add Item</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
        ) : sortedFilteredItems.length === 0 ? (
          <Card className="border-slate-200"><CardContent className="py-12 text-center"><Package className="h-12 w-12 mx-auto mb-4 text-slate-300" /><p className="text-slate-500">No items found</p></CardContent></Card>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full bg-white rounded-lg border border-slate-200">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">Item</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">Category</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500 cursor-pointer select-none" onClick={toggleBranchSort} data-testid="sort-branch-header">Branch{branchSort === 'asc' ? ' ▲' : branchSort === 'desc' ? ' ▼' : ''}</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">Bin Location</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">Qty</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">Price</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">GST</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">HSN</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFilteredItems.map(item => (
                    <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`item-row-${item.id}`}>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${item.active === false ? 'bg-slate-300' : 'bg-emerald-500'}`}
                            title={item.active === false ? 'Inactive' : 'Active'}
                            data-testid={`status-dot-${item.id}`}
                          />
                          {item.image_url ? (
                            <img src={item.image_url} alt="" className="h-10 w-10 rounded-lg object-cover border border-slate-200" />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center"><Package className="h-5 w-5 text-slate-400" /></div>
                          )}
                          <div>
                            <div className="font-medium text-slate-900 flex items-center gap-2">
                              {item.name}
                              {Array.isArray(item.qc_checklist) && item.qc_checklist.length > 0 && (
                                <Badge variant="outline" className="text-[9px] border-blue-200 bg-blue-50 text-blue-700" data-testid={`qc-badge-${item.id}`}>QC: {item.qc_checklist.length}</Badge>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 font-mono">{item.sku_code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4"><Badge variant="outline" className="text-xs">{getCategoryLabel(item.category)}</Badge></td>
                      <td className="py-3 px-4"><Badge variant="outline" className={`text-xs ${item.location_id ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`} data-testid={`branch-badge-${item.id}`}>{getBranchLabel(item)}</Badge></td>
                      <td className="py-3 px-4 text-sm text-slate-600"><div className="flex items-center gap-1"><Warehouse className="h-3 w-3 text-slate-400" />{getWarehouseLocation(item)}</div></td>
                      <td className="py-3 px-4 text-right"><span className={item.quantity <= item.reorder_level ? 'text-red-600 font-semibold' : 'text-slate-900'}>{item.quantity}</span>{item.quantity <= item.reorder_level && <AlertTriangle className="h-3 w-3 inline ml-1 text-red-500" />}</td>
                      <td className="py-3 px-4 text-right font-medium text-slate-900">₹{item.unit_price.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4 text-right text-slate-600">{item.gst_percentage}%</td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-600" data-testid={`hsn-${item.id}`}>{item.hsn_code || '—'}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openItemDialog(item)} data-testid={`edit-item-${item.id}`}><Edit className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleDeleteItem(item)} data-testid={`delete-item-${item.id}`}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {sortedFilteredItems.map(item => (
                <Card key={item.id} className="border-slate-200" data-testid={`item-card-${item.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-1 inline-block h-2.5 w-2.5 rounded-full shrink-0 ${item.active === false ? 'bg-slate-300' : 'bg-emerald-500'}`}
                        title={item.active === false ? 'Inactive' : 'Active'}
                        data-testid={`status-dot-mobile-${item.id}`}
                      />
                      {item.image_url ? (
                        <img src={item.image_url} alt="" className="h-14 w-14 rounded-lg object-cover border" />
                      ) : (
                        <div className="h-14 w-14 rounded-lg bg-slate-100 flex items-center justify-center shrink-0"><Package className="h-6 w-6 text-slate-400" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium text-slate-900 truncate flex items-center gap-1.5">
                              <span className="truncate">{item.name}</span>
                              {Array.isArray(item.qc_checklist) && item.qc_checklist.length > 0 && (
                                <Badge variant="outline" className="text-[9px] border-blue-200 bg-blue-50 text-blue-700">QC: {item.qc_checklist.length}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 font-mono">{item.sku_code}</p>
                          </div>
                          <div className="flex gap-1 shrink-0 ml-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openItemDialog(item)}><Edit className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleDeleteItem(item)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-xs">{getCategoryLabel(item.category)}</Badge>
                          <Badge variant="outline" className={`text-xs ${item.location_id ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`} data-testid={`branch-badge-mobile-${item.id}`}>{getBranchLabel(item)}</Badge>
                          <span className={`text-sm font-medium ${item.quantity <= item.reorder_level ? 'text-red-600' : 'text-slate-900'}`}>Qty: {item.quantity}</span>
                          <span className="text-sm font-semibold text-slate-900">₹{item.unit_price.toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Item Dialog */}
      <Dialog open={showItemDialog} onOpenChange={setShowItemDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
            <DialogDescription>Fill in item details and warehouse location</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>}

            {/* Image URL + Preview */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Product Image URL</Label>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <Input
                    type="url"
                    value={itemForm.image_url}
                    onChange={(e) => { setItemForm(p => ({ ...p, image_url: e.target.value })); setImagePreviewOk(true); }}
                    placeholder="https://example.com/product.jpg"
                    className="h-10"
                    data-testid="item-image-url-input"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Paste a public https:// link to an image (product photo, datasheet thumbnail, etc.)</p>
                  {itemForm.image_url && !isValidImageUrl(itemForm.image_url) && (
                    <p className="text-[11px] text-red-500 mt-1">Invalid URL — must start with http:// or https://</p>
                  )}
                </div>
                {itemForm.image_url && isValidImageUrl(itemForm.image_url) ? (
                  imagePreviewOk ? (
                    <img
                      src={itemForm.image_url}
                      alt="preview"
                      className="h-20 w-20 rounded-lg object-cover border border-slate-200 shrink-0"
                      onError={() => setImagePreviewOk(false)}
                      data-testid="item-image-preview"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded-lg border border-dashed border-red-300 bg-red-50 flex flex-col items-center justify-center shrink-0 text-[10px] text-red-600 px-1 text-center" data-testid="item-image-preview-error">
                      Preview<br />failed
                    </div>
                  )
                ) : (
                  <div className="h-20 w-20 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center shrink-0">
                    <Package className="h-6 w-6 text-slate-300" />
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input value={itemForm.name} onChange={(e) => setItemForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Trina 540W Panel" className="h-11" data-testid="item-name-input" />
              </div>
              <div className="space-y-2">
                <Label>SKU Code *</Label>
                <Input value={itemForm.sku_code} onChange={(e) => setItemForm(p => ({ ...p, sku_code: e.target.value }))} placeholder="e.g., TRN-540" disabled={!!editingItem} className="h-11" data-testid="item-sku-input" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={itemForm.category} onValueChange={(v) => setItemForm(p => ({ ...p, category: v }))}>
                <SelectTrigger className="h-11" data-testid="item-category-select"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={itemForm.location_id || 'global'} onValueChange={(v) => setItemForm(p => ({ ...p, location_id: v === 'global' ? '' : v }))}>
                <SelectTrigger className="h-11" data-testid="item-location-select"><SelectValue placeholder="Global (all branches)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global (all branches)</SelectItem>
                  {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-400">Restricts who can see this item — staff outside this branch won't see it in their inventory list.</p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <Label className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Warehouse className="h-4 w-4" /> Warehouse Location</Label>
              <div className="grid grid-cols-5 gap-2 mt-2">
                {[['zone','Zone','A'], ['aisle','Aisle','A1'], ['shelf','Shelf','S2'], ['rack','Rack','R3'], ['bin_location','Bin','B5']].map(([key, label, ph]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input value={itemForm[key]} onChange={(e) => setItemForm(p => ({ ...p, [key]: e.target.value.toUpperCase() }))} placeholder={ph} className="text-center h-10" data-testid={`item-${key}-input`} />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Quantity</Label><Input type="number" min="0" value={itemForm.quantity} onChange={(e) => setItemForm(p => ({ ...p, quantity: parseInt(e.target.value) || 0 }))} className="h-11" data-testid="item-quantity-input" /></div>
              <div className="space-y-2"><Label>Unit Price (₹)</Label><Input type="number" min="0" value={itemForm.unit_price} onChange={(e) => setItemForm(p => ({ ...p, unit_price: parseFloat(e.target.value) || 0 }))} className="h-11" data-testid="item-price-input" /></div>
              <div className="space-y-2"><Label>GST %</Label><Input type="number" min="0" max="100" value={itemForm.gst_percentage} onChange={(e) => setItemForm(p => ({ ...p, gst_percentage: parseFloat(e.target.value) || 0 }))} className="h-11" data-testid="item-gst-input" /></div>
              <div className="space-y-2"><Label>HSN Code</Label><Input type="text" maxLength={10} value={itemForm.hsn_code} onChange={(e) => setItemForm(p => ({ ...p, hsn_code: e.target.value.trim() }))} placeholder="e.g., 85414011" className="h-11" data-testid="item-hsn-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Supplier</Label><Input value={itemForm.supplier} onChange={(e) => setItemForm(p => ({ ...p, supplier: e.target.value }))} placeholder="Supplier name" className="h-11" data-testid="item-supplier-input" /></div>
              <div className="space-y-2"><Label>Reorder Level</Label><Input type="number" min="0" value={itemForm.reorder_level} onChange={(e) => setItemForm(p => ({ ...p, reorder_level: parseInt(e.target.value) || 0 }))} className="h-11" data-testid="item-reorder-input" /></div>
            </div>

            {/* Procurement Date */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Procurement Date</Label>
              <Input
                type="date"
                value={itemForm.procurement_date}
                onChange={(e) => setItemForm(p => ({ ...p, procurement_date: e.target.value }))}
                className="h-11"
                data-testid="item-procurement-date-input"
              />
              <p className="text-[11px] text-slate-400">Date this batch / product was procured. Used for movement analysis in the Inventory Report.</p>
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${itemForm.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <Label className="text-sm">Item Status</Label>
                <span className="text-xs text-slate-500">({itemForm.active ? 'Active — visible everywhere' : 'Inactive — hidden from selections'})</span>
              </div>
              <button
                type="button"
                onClick={() => setItemForm(p => ({ ...p, active: !p.active }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${itemForm.active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                data-testid="item-active-toggle"
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${itemForm.active ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {/* QC Checklist */}
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 space-y-2">
              <Label className="text-sm font-semibold text-blue-800 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> QC Checklist</Label>
              <p className="text-xs text-blue-700/80">Quality-check items to verify at inbound / before dispatch.</p>
              <div className="flex gap-2">
                <Input
                  value={newQcItem}
                  onChange={(e) => setNewQcItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newQcItem.trim()) {
                      e.preventDefault();
                      setItemForm(p => ({ ...p, qc_checklist: [...(p.qc_checklist || []), newQcItem.trim()] }));
                      setNewQcItem('');
                    }
                  }}
                  placeholder="e.g., Serial number matches box label"
                  className="h-9 bg-white"
                  data-testid="qc-item-input"
                />
                <Button
                  type="button"
                  onClick={() => {
                    if (!newQcItem.trim()) return;
                    setItemForm(p => ({ ...p, qc_checklist: [...(p.qc_checklist || []), newQcItem.trim()] }));
                    setNewQcItem('');
                  }}
                  className="h-9 bg-blue-600 hover:bg-blue-700 text-white"
                  data-testid="qc-add-btn"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {itemForm.qc_checklist && itemForm.qc_checklist.length > 0 ? (
                <ul className="space-y-1.5 mt-2" data-testid="qc-checklist-list">
                  {itemForm.qc_checklist.map((qc, idx) => (
                    <li key={`qc-${idx}`} className="flex items-center gap-2 p-2 bg-white rounded border border-blue-100 text-sm" data-testid={`qc-item-${idx}`}>
                      <Circle className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <span className="flex-1 text-slate-700">{qc}</span>
                      <button
                        type="button"
                        onClick={() => setItemForm(p => ({ ...p, qc_checklist: p.qc_checklist.filter((_, i) => i !== idx) }))}
                        className="text-red-400 hover:text-red-600"
                        data-testid={`qc-remove-${idx}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400 italic mt-1">No QC items yet.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowItemDialog(false)} className="h-11">Cancel</Button>
            <Button onClick={handleSaveItem} disabled={actionLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white h-11" data-testid="save-item-btn">
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}{editingItem ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Categories Dialog */}
      <Dialog open={showCatDialog} onOpenChange={setShowCatDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Categories</DialogTitle>
            <DialogDescription>Add or remove inventory categories</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              {categories.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div><p className="font-medium text-sm">{c.name}</p><p className="text-xs text-slate-500">{c.slug}</p></div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => handleDeleteCategory(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-200 pt-4">
              <Label className="text-sm font-medium mb-2 block">Add New Category</Label>
              <div className="space-y-2">
                <Input value={newCat.name} onChange={(e) => setNewCat(p => ({ ...p, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') }))} placeholder="Category name" className="h-11" data-testid="new-cat-name" />
                <Input value={newCat.slug} onChange={(e) => setNewCat(p => ({ ...p, slug: e.target.value }))} placeholder="Slug (auto-generated)" className="h-11 font-mono text-sm" data-testid="new-cat-slug" />
                <Button onClick={handleCreateCategory} disabled={!newCat.name || !newCat.slug} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-11" data-testid="create-cat-btn"><Plus className="h-4 w-4 mr-1" />Add Category</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={(open) => { setShowImportDialog(open); if (!open) { setImportFile(null); setImportResult(null); setImportPreview(null); setColumnMapOverrides({}); setDryRun(false); setError(''); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="import-inventory-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-emerald-600" />Import Inventory</DialogTitle>
            <DialogDescription>Upload an .xlsx or .csv file. Existing SKUs are updated, new SKUs are added.</DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-4">
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-between gap-3">
              <p className="text-sm text-blue-800">First time? Download the template with sample data.</p>
              <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={handleDownloadTemplate} data-testid="download-template-btn"><Download className="h-3.5 w-3.5" />Template</Button>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">File (.xlsx / .csv)</Label>
              <Input type="file" accept=".xlsx,.csv" onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportResult(null); setImportPreview(null); setColumnMapOverrides({}); }} data-testid="import-file-input" />
              {importFile && <p className="text-xs text-slate-500">{importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)</p>}
            </div>
            <p className="text-[11px] text-slate-500">Accepted headers are flexible — e.g. "SKU", "Item Name", "Price", "Rate" all work. Required: name, sku_code, category, quantity, unit_price.</p>
            {error && <div className="p-2 bg-red-50 text-red-700 text-xs rounded" data-testid="import-error">{error}</div>}

            {!importResult && importFile && !importPreview && (
              <Button onClick={handlePreview} disabled={previewing} variant="outline" className="w-full gap-1" data-testid="preview-import-btn">
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}{previewing ? 'Reading file…' : 'Preview File'}
              </Button>
            )}

            {importPreview?.status === 'needs_mapping' && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-3" data-testid="column-mapping-panel">
                <p className="text-xs font-semibold text-amber-800">We couldn't auto-match every required column. Map them below:</p>
                {REQUIRED_IMPORT_FIELDS.filter(f => importPreview.unmapped_required?.includes(f)).map(field => (
                  <div key={field} className="flex items-center gap-2">
                    <Label className="text-xs w-28 shrink-0 capitalize">{field.replace(/_/g, ' ')}</Label>
                    <Select value={columnMapOverrides[field] || ''} onValueChange={(v) => setColumnMapOverrides(p => ({ ...p, [field]: v }))}>
                      <SelectTrigger className="h-9 bg-white" data-testid={`map-select-${field}`}><SelectValue placeholder="Select a column…" /></SelectTrigger>
                      <SelectContent>
                        {importPreview.detected_columns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <Button size="sm" onClick={handleConfirmMapping} disabled={previewing || REQUIRED_IMPORT_FIELDS.filter(f => importPreview.unmapped_required?.includes(f)).some(f => !columnMapOverrides[f])} className="bg-amber-600 hover:bg-amber-700 text-white" data-testid="confirm-mapping-btn">
                  Apply Mapping &amp; Re-check
                </Button>
              </div>
            )}

            {importPreview && importPreview.status !== 'needs_mapping' && !importResult && (
              <div className="space-y-2" data-testid="import-preview-panel">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded bg-emerald-50 border border-emerald-200 p-2"><p className="font-bold text-emerald-700">{importPreview.summary?.will_create ?? 0}</p><p className="text-emerald-600">Will Create</p></div>
                  <div className="rounded bg-blue-50 border border-blue-200 p-2"><p className="font-bold text-blue-700">{importPreview.summary?.will_update ?? 0}</p><p className="text-blue-600">Will Update</p></div>
                  <div className="rounded bg-rose-50 border border-rose-200 p-2"><p className="font-bold text-rose-700">{importPreview.summary?.will_skip ?? 0}</p><p className="text-rose-600">Will Skip</p></div>
                </div>
                <div className="max-h-48 overflow-y-auto border rounded-lg">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 sticky top-0"><tr><th className="text-left p-1.5">Row</th><th className="text-left p-1.5">Name / Issue</th><th className="text-left p-1.5">SKU</th><th className="text-right p-1.5">Status</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {importPreview.preview_rows?.map((r, i) => (
                        <tr key={i}>
                          <td className="p-1.5">{r.row}</td>
                          <td className="p-1.5 truncate max-w-[160px]">{r.name || r.reason}</td>
                          <td className="p-1.5">{r.sku_code || '—'}</td>
                          <td className="p-1.5 text-right"><span className={`px-1.5 py-0.5 rounded ${IMPORT_STATUS_STYLES[r.status] || ''}`}>{(r.status || '').replace('will_', '')}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {importPreview.errors?.length > 0 && (
                  <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => downloadErrorsCsv(importPreview.errors)} data-testid="download-preview-errors-btn">
                    <Download className="h-3 w-3" />Download full error report ({importPreview.errors.length})
                  </Button>
                )}
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} data-testid="dry-run-toggle" />
                  Validate only (dry run) — don't write to inventory yet
                </label>
              </div>
            )}

            {importResult && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm" data-testid="import-result">
                <p className="font-semibold text-emerald-800">{importResult.message}</p>
                <p className="text-emerald-700 text-xs mt-1">Total rows processed: {importResult.total_rows}</p>
                {importResult.errors?.length > 0 && (
                  <div className="mt-2">
                    <div className="max-h-32 overflow-y-auto">
                      <p className="text-xs font-medium text-amber-700 mb-1">{importResult.errors.length} row(s) skipped:</p>
                      <ul className="text-[11px] text-amber-700 space-y-0.5">
                        {importResult.errors.slice(0, 8).map((er, i) => <li key={i}>Row {er.row}: {er.error}</li>)}
                        {importResult.errors.length > 8 && <li>… and {importResult.errors.length - 8} more</li>}
                      </ul>
                    </div>
                    <Button variant="outline" size="sm" className="gap-1 text-xs mt-2" onClick={() => downloadErrorsCsv(importResult.errors)} data-testid="download-result-errors-btn">
                      <Download className="h-3 w-3" />Download full error report
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>Close</Button>
            <Button onClick={handleImport} disabled={!importFile || importing || !importPreview || importPreview.status === 'needs_mapping'} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid="confirm-import-btn">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{importing ? 'Importing...' : dryRun ? 'Run Validation' : 'Confirm Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}