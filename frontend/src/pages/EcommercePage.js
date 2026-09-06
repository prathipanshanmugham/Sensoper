import { useState, useEffect, useCallback } from 'react';
import { ecommerceAPI, inventoryAPI } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, ShoppingBag, Package, Receipt } from 'lucide-react';
import { ProductsTab } from '../components/ecommerce/ProductsTab';
import { OrdersTab } from '../components/ecommerce/OrdersTab';

const TABS = [
  { id: 'products', label: 'Products', icon: Package },
  { id: 'orders', label: 'Orders', icon: Receipt },
];

export default function EcommercePage() {
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  const [tab, setTab] = useState('products');
  const [platforms, setPlatforms] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [recon, setRecon] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [p, o, r, i] = await Promise.all([ecommerceAPI.products.list(), ecommerceAPI.orders.list(), ecommerceAPI.reconciliation(), inventoryAPI.getItems()]);
      setPlatforms(p.data.platforms || []); setProducts(p.data.rows || []);
      setOrders(o.data); setRecon(r.data); setItems(i.data.items || i.data || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="ecommerce-page">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900 flex items-center gap-2"><ShoppingBag className="h-6 w-6 text-emerald-600" />Ecommerce</h1>
          <p className="text-sm text-slate-500">Products listed per platform, and the orders they generate — separate from counter/direct sales</p>
        </div>
        <div className="flex gap-1 p-1 rounded-lg bg-slate-100" data-testid="ecommerce-tabs">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition-colors ${tab === t.id ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:text-slate-900'}`} data-testid={`ecommerce-tab-${t.id}`}>
              <t.icon className="h-4 w-4" />{t.label}
              <span className="text-[11px] text-slate-400">{t.id === 'products' ? products.length : orders.length}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div> : (
        tab === 'products'
          ? <ProductsTab products={products} platforms={platforms} items={items} canManage={canManage} isAdmin={isAdmin} refresh={fetchAll} />
          : <OrdersTab orders={orders} recon={recon} platforms={platforms} products={products} items={items} canManage={canManage} isAdmin={isAdmin} refresh={fetchAll} />
      )}
    </div>
  );
}
