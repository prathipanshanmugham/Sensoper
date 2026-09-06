import { useState, useMemo } from 'react';
import { ecommerceAPI } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Plus, Search, Store, Trash2, PackageOpen } from 'lucide-react';
import { ListingCell } from './ListingCell';
import { PlatformsDialog } from './PlatformsDialog';
import { AddProductDialog } from './AddProductDialog';

const STATUS_FILTERS = ['all', 'live', 'draft', 'paused', 'out_of_stock', 'delisted'];

export function ProductsTab({ products, platforms, items, canManage, isAdmin, refresh }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [showPlatforms, setShowPlatforms] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const rows = useMemo(() => products.filter(r => {
    if (search && !`${r.item_name} ${r.sku_code || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (platformFilter !== 'all' && !r.listings[platformFilter]) return false;
    if (statusFilter !== 'all' && !Object.values(r.listings).some(l => l.status === statusFilter)) return false;
    return true;
  }), [products, search, statusFilter, platformFilter]);

  const existingItemIds = useMemo(() => new Set(products.map(p => p.inventory_item_id)), [products]);
  const liveCount = products.reduce((n, r) => n + Object.values(r.listings).filter(l => l.status === 'live').length, 0);

  const saveCell = async (itemId, platformId, payload) => { await ecommerceAPI.products.upsertListing(itemId, platformId, payload); refresh(); };
  const delist = async (r) => {
    if (!window.confirm(`Delist "${r.item_name}" from every platform? Listings are kept in history as delisted.`)) return;
    await ecommerceAPI.products.delist(r.inventory_item_id); refresh();
  };

  return (
    <div data-testid="products-tab">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm"><Search className="h-4 w-4 absolute left-2.5 top-2.5 text-slate-400" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product or SKU…" className="pl-8 h-9" data-testid="products-search-input" /></div>
        <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} className="h-9 text-sm rounded-md border border-slate-200 px-2 bg-white" data-testid="products-platform-filter">
          <option value="all">All platforms</option>{platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex gap-1 flex-wrap" data-testid="products-status-filter">
          {STATUS_FILTERS.map(s => <button key={s} onClick={() => setStatusFilter(s)} className={`px-2.5 py-1 text-xs rounded-full border capitalize ${statusFilter === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`} data-testid={`products-status-${s}`}>{s.replace('_', ' ')}</button>)}
        </div>
        <div className="ml-auto flex gap-2">
          {canManage && <Button variant="outline" onClick={() => setShowPlatforms(true)} className="gap-1.5 h-9" data-testid="manage-platforms-btn"><Store className="h-4 w-4" />Platforms ({platforms.length})</Button>}
          {canManage && <Button onClick={() => setShowAdd(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-9" data-testid="add-product-btn"><Plus className="h-4 w-4" />Add Product</Button>}
        </div>
      </div>

      <div className="flex gap-3 text-xs text-slate-500 mb-3" data-testid="products-summary">
        <span><b className="text-slate-900" data-testid="products-count">{products.length}</b> products</span>
        <span><b className="text-emerald-700" data-testid="products-live-count">{liveCount}</b> live listings</span>
        <span><b className="text-slate-900">{platforms.length}</b> platforms</span>
      </div>

      <Card className="border-slate-200"><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm" data-testid="products-table">
          <thead>
            <tr className="text-left text-slate-500 border-b bg-slate-50">
              <th className="p-3 font-medium">Product</th>
              <th className="p-3 font-medium">Stock</th>
              {platforms.map(p => <th key={p.id} className="p-3 font-medium" data-testid={`products-col-${p.id}`}>{p.name}</th>)}
              {canManage && <th className="p-3"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.inventory_item_id} className="border-b last:border-0 align-top hover:bg-slate-50/60" data-testid={`product-row-${r.inventory_item_id}`}>
                <td className="p-3">
                  <p className="font-medium text-slate-900">{r.item_name}</p>
                  <p className="text-[11px] text-slate-500">{r.sku_code || 'no SKU'}{r.category ? ` · ${r.category}` : ''}</p>
                </td>
                <td className="p-3">
                  <Badge variant="outline" className={r.stock_available <= 0 ? 'border-red-300 text-red-700' : ''} data-testid={`product-stock-${r.inventory_item_id}`}>{r.stock_available}</Badge>
                </td>
                {platforms.map(p => (
                  <td key={p.id} className="p-3">
                    <ListingCell itemId={r.inventory_item_id} platformId={p.id} listing={r.listings[p.id]} canManage={canManage} onSave={saveCell} />
                  </td>
                ))}
                {canManage && <td className="p-3 text-right"><Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => delist(r)} title="Delist from all platforms" data-testid={`delist-product-${r.inventory_item_id}`}><Trash2 className="h-3.5 w-3.5" /></Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-10 text-center text-slate-500" data-testid="products-empty">
            <PackageOpen className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm">{products.length === 0 ? 'No products listed yet. Add a platform, then add a product.' : 'No products match these filters.'}</p>
          </div>
        )}
      </CardContent></Card>

      <PlatformsDialog open={showPlatforms} onOpenChange={setShowPlatforms} platforms={platforms} onChanged={refresh} isAdmin={isAdmin} />
      <AddProductDialog open={showAdd} onOpenChange={setShowAdd} items={items} platforms={platforms} existingItemIds={existingItemIds} onCreated={refresh} />
    </div>
  );
}
