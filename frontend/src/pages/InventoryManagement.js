import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { inventoryAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
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

export default function InventoryManagement() {
  const [items, setItems] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [showCatDialog, setShowCatDialog] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [imagePreviewOk, setImagePreviewOk] = useState(true);
  const [newCat, setNewCat] = useState({ name: '', slug: '', description: '' });
  
  const [itemForm, setItemForm] = useState({
    name: '', sku_code: '', category: '',
    zone: '', aisle: '', shelf: '', rack: '', bin_location: '',
    quantity: 0, unit_price: 0, supplier: '', gst_percentage: 18, hsn_code: '', reorder_level: 10,
    image_url: '', active: true, qc_checklist: [], procurement_date: ''
  });
  const [newQcItem, setNewQcItem] = useState('');
  
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  // Import / Export state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [exportLoading, setExportLoading] = useState(null);

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  };

  const handleDownloadTemplate = async () => {
    try { const res = await inventoryAPI.downloadTemplate(); downloadBlob(res.data, 'inventory_import_template.xlsx'); }
    catch (e) { setError('Failed to download template'); }
  };

  const handleImport = async () => {
    if (!importFile) { setError('Select a file first'); return; }
    setImporting(true); setError(''); setImportResult(null);
    try {
      const res = await inventoryAPI.importItems(importFile);
      setImportResult(res.data);
      fetchData();
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
      const [itemsRes, alertsRes, catsRes] = await Promise.all([
        inventoryAPI.getItems(), inventoryAPI.getAlerts(), inventoryAPI.getCategories()
      ]);
      setItems(itemsRes.data);
      setAlerts(alertsRes.data);
      setCategories(catsRes.data);
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
        procurement_date: item.procurement_date || ''
      });
    } else {
      setEditingItem(null);
      setItemForm({
        name: '', sku_code: '', category: categories[0]?.slug || '',
        zone: '', aisle: '', shelf: '', rack: '', bin_location: '',
        quantity: 0, unit_price: 0, supplier: '', gst_percentage: 18, hsn_code: '', reorder_level: 10,
        image_url: '', active: true, qc_checklist: [], procurement_date: ''
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
      if (editingItem) {
        await inventoryAPI.updateItem(editingItem.id, itemForm);
      } else {
        await inventoryAPI.createItem(itemForm);
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
    return true;
  });

  const getCategoryLabel = (slug) => categories.find(c => c.slug === slug)?.name || slug;
  const getWarehouseLocation = (item) => {
    const parts = [item.zone, item.aisle, item.shelf, item.rack, item.bin_location].filter(Boolean);
    return parts.length > 0 ? parts.join(' > ') : '-';
  };

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
              {alerts.map(a => <Badge key={a.id} variant="outline" className="bg-white text-amber-800 border-amber-300 text-xs">{a.name} ({a.quantity})</Badge>)}
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
        ) : filteredItems.length === 0 ? (
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
                    <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">Location</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">Qty</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">Price</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">GST</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">HSN</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(item => (
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
              {filteredItems.map(item => (
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
      <Dialog open={showImportDialog} onOpenChange={(open) => { setShowImportDialog(open); if (!open) { setImportFile(null); setImportResult(null); setError(''); } }}>
        <DialogContent className="sm:max-w-lg" data-testid="import-inventory-dialog">
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
              <Input type="file" accept=".xlsx,.csv" onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportResult(null); }} data-testid="import-file-input" />
              {importFile && <p className="text-xs text-slate-500">{importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)</p>}
            </div>
            <p className="text-[11px] text-slate-500">Required columns: <code className="bg-slate-100 px-1 rounded">name, sku_code, category, quantity, unit_price</code>. Optional: reorder_level, supplier, gst_percentage, hsn_code, margin_pct, zone, aisle, shelf, rack, bin_location, procurement_date, active.</p>
            {error && <div className="p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}
            {importResult && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm" data-testid="import-result">
                <p className="font-semibold text-emerald-800">{importResult.message}</p>
                <p className="text-emerald-700 text-xs mt-1">Total rows processed: {importResult.total_rows}</p>
                {importResult.errors?.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto">
                    <p className="text-xs font-medium text-amber-700 mb-1">{importResult.errors.length} row(s) skipped:</p>
                    <ul className="text-[11px] text-amber-700 space-y-0.5">
                      {importResult.errors.slice(0, 8).map((er, i) => <li key={i}>Row {er.row}: {er.error}</li>)}
                      {importResult.errors.length > 8 && <li>… and {importResult.errors.length - 8} more</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>Close</Button>
            <Button onClick={handleImport} disabled={!importFile || importing} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" data-testid="confirm-import-btn">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{importing ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}