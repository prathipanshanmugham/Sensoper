import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { inventoryAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { 
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  Loader2,
  Package,
  AlertTriangle,
  Search,
  Warehouse
} from 'lucide-react';

const CATEGORIES = [
  { value: 'solar_panels', label: 'Solar Panels' },
  { value: 'inverters', label: 'Inverters' },
  { value: 'batteries', label: 'Batteries' },
  { value: 'mounting_structures', label: 'Mounting Structures' },
  { value: 'cables_accessories', label: 'Cables & Accessories' }
];

export default function InventoryManagement() {
  const [items, setItems] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  
  const [itemForm, setItemForm] = useState({
    name: '', sku_code: '', category: 'solar_panels',
    zone: '', aisle: '', shelf: '', rack: '', bin_location: '',
    quantity: 0, unit_price: 0, supplier: '', gst_percentage: 18, reorder_level: 10
  });
  
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [itemsRes, alertsRes] = await Promise.all([
        inventoryAPI.getItems(),
        inventoryAPI.getAlerts()
      ]);
      setItems(itemsRes.data);
      setAlerts(alertsRes.data);
    } catch (error) {
      console.error('Failed to fetch inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const openItemDialog = (item = null) => {
    if (item) {
      setEditingItem(item);
      setItemForm({
        name: item.name, sku_code: item.sku_code, category: item.category,
        zone: item.zone || '', aisle: item.aisle || '', shelf: item.shelf || '',
        rack: item.rack || '', bin_location: item.bin_location || '',
        quantity: item.quantity, unit_price: item.unit_price,
        supplier: item.supplier || '', gst_percentage: item.gst_percentage || 18,
        reorder_level: item.reorder_level || 10
      });
    } else {
      setEditingItem(null);
      setItemForm({
        name: '', sku_code: '', category: 'solar_panels',
        zone: '', aisle: '', shelf: '', rack: '', bin_location: '',
        quantity: 0, unit_price: 0, supplier: '', gst_percentage: 18, reorder_level: 10
      });
    }
    setError('');
    setShowItemDialog(true);
  };

  const handleSaveItem = async () => {
    if (!itemForm.name || !itemForm.sku_code) {
      setError('Name and SKU Code are required');
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
      setError(err.response?.data?.detail || 'Operation failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try {
      await inventoryAPI.deleteItem(item.id);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete');
    }
  };

  const filteredItems = items.filter(item => {
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase()) && 
        !item.sku_code.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterCategory !== 'all' && item.category !== filterCategory) return false;
    return true;
  });

  const getCategoryLabel = (value) => CATEGORIES.find(c => c.value === value)?.label || value;

  const getWarehouseLocation = (item) => {
    const parts = [item.zone, item.aisle, item.shelf, item.rack, item.bin_location].filter(Boolean);
    return parts.length > 0 ? parts.join(' > ') : '-';
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">Inventory Management</h1>
              <p className="text-slate-500">{items.length} items in warehouse</p>
            </div>
          </div>
        </div>

        {alerts.length > 0 && (
          <Card className="border-amber-200 bg-amber-50 mb-6">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-medium text-amber-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />Low Stock Alerts ({alerts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <div className="flex flex-wrap gap-2">
                {alerts.map(item => (
                  <Badge key={item.id} variant="outline" className="bg-white text-amber-800 border-amber-300">
                    {item.name} - Only {item.quantity} left
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card className="border-slate-200 mb-4">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input placeholder="Search by name or SKU..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" data-testid="search-items" />
              </div>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-[180px]" data-testid="filter-category"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {CATEGORIES.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={() => openItemDialog()} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="add-item-btn">
                <Plus className="h-4 w-4 mr-2" />Add Item
              </Button>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
        ) : filteredItems.length === 0 ? (
          <Card className="border-slate-200"><CardContent className="py-12 text-center"><Package className="h-12 w-12 mx-auto mb-4 text-slate-300" /><p className="text-slate-500">No items found</p></CardContent></Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full bg-white rounded-lg border border-slate-200">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">Item</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">SKU</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">Category</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold uppercase text-slate-500">Warehouse Location</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">Qty</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">Price</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">GST</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold uppercase text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => (
                  <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`item-row-${item.id}`}>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{item.name}</div>
                      {item.supplier && <div className="text-xs text-slate-500">{item.supplier}</div>}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600 font-mono">{item.sku_code}</td>
                    <td className="py-3 px-4"><Badge variant="outline">{getCategoryLabel(item.category)}</Badge></td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      <div className="flex items-center gap-1">
                        <Warehouse className="h-3 w-3 text-slate-400" />
                        {getWarehouseLocation(item)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={item.quantity <= item.reorder_level ? 'text-red-600 font-semibold' : 'text-slate-900'}>
                        {item.quantity}
                      </span>
                      {item.quantity <= item.reorder_level && <AlertTriangle className="h-3 w-3 inline ml-1 text-red-500" />}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-slate-900">Rs {item.unit_price.toLocaleString('en-IN')}</td>
                    <td className="py-3 px-4 text-right text-slate-600">{item.gst_percentage}%</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => openItemDialog(item)} data-testid={`edit-item-${item.id}`}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-red-600 hover:text-red-700" onClick={() => handleDeleteItem(item)} data-testid={`delete-item-${item.id}`}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Item Dialog */}
      <Dialog open={showItemDialog} onOpenChange={setShowItemDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
            <DialogDescription>Fill in item details and warehouse location</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto">
            {error && <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input value={itemForm.name} onChange={(e) => setItemForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Trina 540W Panel" data-testid="item-name-input" />
              </div>
              <div className="space-y-2">
                <Label>SKU Code *</Label>
                <Input value={itemForm.sku_code} onChange={(e) => setItemForm(p => ({ ...p, sku_code: e.target.value }))} placeholder="e.g., TRN-540-MONO" disabled={!!editingItem} data-testid="item-sku-input" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={itemForm.category} onValueChange={(v) => setItemForm(p => ({ ...p, category: v }))}>
                <SelectTrigger data-testid="item-category-select"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Warehouse Location */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <Label className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Warehouse className="h-4 w-4" /> Warehouse Location</Label>
              <div className="grid grid-cols-5 gap-2 mt-2">
                <div className="space-y-1">
                  <Label className="text-xs">Zone</Label>
                  <Input value={itemForm.zone} onChange={(e) => setItemForm(p => ({ ...p, zone: e.target.value.toUpperCase() }))} placeholder="A" className="text-center" data-testid="item-zone-input" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Aisle</Label>
                  <Input value={itemForm.aisle} onChange={(e) => setItemForm(p => ({ ...p, aisle: e.target.value.toUpperCase() }))} placeholder="A1" className="text-center" data-testid="item-aisle-input" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Shelf</Label>
                  <Input value={itemForm.shelf} onChange={(e) => setItemForm(p => ({ ...p, shelf: e.target.value.toUpperCase() }))} placeholder="S2" className="text-center" data-testid="item-shelf-input" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Rack</Label>
                  <Input value={itemForm.rack} onChange={(e) => setItemForm(p => ({ ...p, rack: e.target.value.toUpperCase() }))} placeholder="R3" className="text-center" data-testid="item-rack-input" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bin</Label>
                  <Input value={itemForm.bin_location} onChange={(e) => setItemForm(p => ({ ...p, bin_location: e.target.value.toUpperCase() }))} placeholder="B5" className="text-center" data-testid="item-bin-input" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input type="number" min="0" value={itemForm.quantity} onChange={(e) => setItemForm(p => ({ ...p, quantity: parseInt(e.target.value) || 0 }))} data-testid="item-quantity-input" />
              </div>
              <div className="space-y-2">
                <Label>Unit Price (Rs)</Label>
                <Input type="number" min="0" value={itemForm.unit_price} onChange={(e) => setItemForm(p => ({ ...p, unit_price: parseFloat(e.target.value) || 0 }))} data-testid="item-price-input" />
              </div>
              <div className="space-y-2">
                <Label>GST %</Label>
                <Input type="number" min="0" max="100" value={itemForm.gst_percentage} onChange={(e) => setItemForm(p => ({ ...p, gst_percentage: parseFloat(e.target.value) || 0 }))} data-testid="item-gst-input" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Supplier</Label>
                <Input value={itemForm.supplier} onChange={(e) => setItemForm(p => ({ ...p, supplier: e.target.value }))} placeholder="Supplier name" data-testid="item-supplier-input" />
              </div>
              <div className="space-y-2">
                <Label>Reorder Level</Label>
                <Input type="number" min="0" value={itemForm.reorder_level} onChange={(e) => setItemForm(p => ({ ...p, reorder_level: parseInt(e.target.value) || 0 }))} data-testid="item-reorder-input" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowItemDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveItem} disabled={actionLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="save-item-btn">
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingItem ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
