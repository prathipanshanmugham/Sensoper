import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { salesAPI, inventoryAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ArrowLeft, Plus, X, Loader2, Receipt, ShoppingCart, IndianRupee, Users, Package } from 'lucide-react';

const LEAD_SOURCES = ['google_ads', 'meta_ads', 'referral', 'organic', 'exhibitions', 'field_marketing', 'telecalling', 'website_seo', 'whatsapp', 'other'];

export default function DirectSalesPage() {
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pivotByItem, setPivotByItem] = useState(false);

  // Quick sale form state
  const [customer, setCustomer] = useState({ name: '', phone: '', state: 'Tamil Nadu' });
  const [saleType, setSaleType] = useState('counter');
  const [leadSource, setLeadSource] = useState('other');
  const [lines, setLines] = useState([]);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [amountPaid, setAmountPaid] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, list, sum] = await Promise.all([
        inventoryAPI.getItems(),
        salesAPI.list({ limit: 50 }),
        salesAPI.summary()
      ]);
      setItems(inv.data || []);
      setSales(list.data || []);
      setSummary(sum.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const addLine = (item) => {
    setLines(prev => [...prev, {
      inventory_item_id: item.id, name: item.name, sku_code: item.sku_code,
      category: item.category, quantity: 1, unit_price: item.unit_price || 0,
      cost_price: item.unit_price || 0, gst_percentage: item.gst_percentage || 18,
      discount_pct: 0
    }]);
  };
  const updLine = (i, k, v) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const rmLine = (i) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const totals = useMemo(() => {
    let taxable = 0, gst = 0;
    for (const l of lines) {
      const q = parseFloat(l.quantity) || 0;
      const p = parseFloat(l.unit_price) || 0;
      const d = parseFloat(l.discount_pct) || 0;
      const gpc = parseFloat(l.gst_percentage) || 0;
      const t = q * p * (1 - d / 100);
      taxable += t;
      gst += t * gpc / 100;
    }
    return { taxable: Math.round(taxable), gst: Math.round(gst), grand: Math.round(taxable + gst) };
  }, [lines]);

  const confirmSale = async () => {
    if (!customer.name.trim() || !customer.phone.trim()) { alert('Customer name & phone required'); return; }
    if (lines.length === 0) { alert('Add at least one item'); return; }
    setSaving(true);
    try {
      const payload = {
        sale_type: saleType,
        customer,
        lead_source: leadSource,
        lines: lines.map(l => ({
          inventory_item_id: l.inventory_item_id, name: l.name, sku_code: l.sku_code,
          category: l.category, quantity: parseFloat(l.quantity) || 1,
          unit_price: parseFloat(l.unit_price) || 0, gst_percentage: parseFloat(l.gst_percentage) || 18,
          discount_pct: parseFloat(l.discount_pct) || 0,
        })),
        payments: amountPaid ? [{ mode: paymentMode, amount: parseFloat(amountPaid) }] : []
      };
      const r = await salesAPI.create(payload);
      alert(`Invoice ${r.data.invoice_number} created for ₹${r.data.grand_total.toLocaleString('en-IN')}`);
      setLines([]); setCustomer({ name: '', phone: '', state: 'Tamil Nadu' }); setAmountPaid('');
      fetchAll();
    } catch (e) { alert(e.response?.data?.detail || 'Sale failed'); }
    finally { setSaving(false); }
  };

  const itemPivot = useMemo(() => {
    const m = {};
    for (const s of sales) {
      for (const l of (s.lines || [])) {
        const k = l.name;
        if (!m[k]) m[k] = { name: k, units: 0, revenue: 0, margin: 0 };
        m[k].units += l.quantity || 0;
        m[k].revenue += l.line_total || 0;
        m[k].margin += l.margin_amount || 0;
      }
    }
    return Object.values(m).sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link to="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold font-['Outfit'] text-slate-900">Direct Sales</h1>
              <p className="text-sm text-slate-500">Counter, B2B, online — atomic stock decrement, GST invoicing</p>
            </div>
          </div>
        </div>

        {/* Today's summary */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4" data-testid="sales-summary-strip">
            <Card><CardContent className="p-3"><p className="text-[10px] uppercase text-slate-500">Revenue (30d)</p><p className="text-lg font-bold">₹{summary.total_revenue.toLocaleString('en-IN')}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] uppercase text-slate-500">Margin</p><p className="text-lg font-bold text-emerald-700">₹{summary.total_margin.toLocaleString('en-IN')}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] uppercase text-slate-500">Sales</p><p className="text-lg font-bold">{summary.sale_count}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] uppercase text-slate-500">Avg Ticket</p><p className="text-lg font-bold">₹{summary.avg_ticket.toLocaleString('en-IN')}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] uppercase text-slate-500">Units</p><p className="text-lg font-bold">{summary.total_units}</p></CardContent></Card>
          </div>
        )}

        {/* Quick Sale */}
        <Card className="border-emerald-200 mb-4" data-testid="quick-sale-panel">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-emerald-600" />Quick Sale</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div><Label className="text-xs">Customer Name *</Label><Input value={customer.name} onChange={e => setCustomer({...customer, name: e.target.value})} className="h-9" data-testid="qs-customer-name" /></div>
              <div><Label className="text-xs">Phone *</Label><Input value={customer.phone} onChange={e => setCustomer({...customer, phone: e.target.value})} className="h-9" data-testid="qs-customer-phone" /></div>
              <div><Label className="text-xs">Sale Type</Label>
                <Select value={saleType} onValueChange={setSaleType}>
                  <SelectTrigger className="h-9" data-testid="qs-sale-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{['counter','b2b','online','service','amc'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Lead Source</Label>
                <Select value={leadSource} onValueChange={setLeadSource}>
                  <SelectTrigger className="h-9" data-testid="qs-lead-source"><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAD_SOURCES.map(v => <SelectItem key={v} value={v}>{v.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Add Item</Label>
              <Select onValueChange={(v) => { const it = items.find(i => i.id === v); if (it) addLine(it); }}>
                <SelectTrigger className="h-9" data-testid="qs-item-picker"><SelectValue placeholder="Search inventory..." /></SelectTrigger>
                <SelectContent>
                  {items.map(it => <SelectItem key={it.id} value={it.id}>{it.name} · Stock: {it.quantity} · ₹{it.unit_price}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {lines.length > 0 && (
              <div className="space-y-1.5" data-testid="qs-lines">
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1.5 items-center text-xs">
                    <span className="col-span-4 truncate font-medium">{l.name}</span>
                    <Input type="number" value={l.quantity} onChange={e => updLine(i, 'quantity', e.target.value)} className="col-span-2 h-8" data-testid={`qs-line-qty-${i}`} />
                    <Input type="number" value={l.unit_price} onChange={e => updLine(i, 'unit_price', e.target.value)} className="col-span-2 h-8" data-testid={`qs-line-price-${i}`} />
                    <Input type="number" value={l.discount_pct} onChange={e => updLine(i, 'discount_pct', e.target.value)} placeholder="disc%" className="col-span-1 h-8" />
                    <Input type="number" value={l.gst_percentage} onChange={e => updLine(i, 'gst_percentage', e.target.value)} className="col-span-2 h-8" />
                    <Button size="icon" variant="ghost" onClick={() => rmLine(i)} className="col-span-1 h-8 w-8 text-red-500"><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t pt-2 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                Taxable ₹{totals.taxable.toLocaleString('en-IN')} · GST ₹{totals.gst.toLocaleString('en-IN')} · <strong className="text-emerald-700">Total ₹{totals.grand.toLocaleString('en-IN')}</strong>
              </div>
              <div className="flex items-center gap-1.5">
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{['cash','upi','card','bank','cheque'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="Amount paid" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} className="h-9 w-32" data-testid="qs-amount-paid" />
                <Button onClick={confirmSale} disabled={saving} className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="qs-confirm-btn">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Receipt className="h-4 w-4 mr-1" />}Confirm Sale
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sales list / item pivot */}
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base font-['Outfit']">{pivotByItem ? 'Items Sold' : 'Recent Sales'}</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setPivotByItem(!pivotByItem)} className="h-8" data-testid="pivot-toggle-btn">
              {pivotByItem ? <Users className="h-3.5 w-3.5 mr-1" /> : <Package className="h-3.5 w-3.5 mr-1" />}
              {pivotByItem ? 'Show Sales' : 'Show Items'}
            </Button>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? <div className="py-8 text-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400 mx-auto" /></div> :
             pivotByItem ? (
              <table className="w-full text-sm" data-testid="item-pivot-table">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">Units</th><th className="text-right px-3 py-2">Revenue</th><th className="text-right px-3 py-2">Margin</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {itemPivot.map(it => (
                    <tr key={it.name}><td className="px-3 py-2 font-medium truncate">{it.name}</td>
                      <td className="px-3 py-2 text-right">{it.units}</td>
                      <td className="px-3 py-2 text-right">₹{it.revenue.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">₹{it.margin.toLocaleString('en-IN')}</td></tr>
                  ))}
                  {itemPivot.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-slate-400">No sales yet.</td></tr>}
                </tbody>
              </table>
             ) : (
              <table className="w-full text-sm" data-testid="sales-list-table">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="text-left px-3 py-2">Invoice</th><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Customer</th><th className="text-left px-3 py-2">Items</th><th className="text-right px-3 py-2">Total</th><th className="text-left px-3 py-2">Payment</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {sales.map(s => (
                    <tr key={s.id} data-testid={`sale-row-${s.id}`}><td className="px-3 py-2 font-mono text-xs">{s.invoice_number}</td>
                      <td className="px-3 py-2 text-slate-600">{s.sale_date}</td>
                      <td className="px-3 py-2 truncate max-w-[150px]">{s.customer?.name}</td>
                      <td className="px-3 py-2 text-slate-500 truncate max-w-[200px]">{(s.lines || []).map(l => l.name).join(', ')}</td>
                      <td className="px-3 py-2 text-right font-bold">₹{(s.grand_total || 0).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2"><Badge className={s.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-700' : s.status === 'returned' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}>{s.status === 'returned' ? 'Returned' : s.payment_status}</Badge></td></tr>
                  ))}
                  {sales.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-slate-400">No sales yet.</td></tr>}
                </tbody>
              </table>
             )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
