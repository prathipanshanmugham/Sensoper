import { useState, useEffect, useCallback, useMemo } from 'react';
import { creditsAPI } from '../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Loader2, Search, Users, AlertCircle, IndianRupee } from 'lucide-react';

export default function CustomerSection() {
  const [credits, setCredits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await creditsAPI.list({});
      setCredits(res.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Aggregate per customer
  const customers = useMemo(() => {
    const map = new Map();
    credits.forEach(c => {
      const key = (c.customer_name || 'Unknown').trim();
      if (!map.has(key)) {
        map.set(key, {
          customer_name: key,
          customer_phone: c.customer_phone || '',
          invoices: 0, total: 0, paid: 0, balance: 0,
          overdue_count: 0, active_count: 0, closed_count: 0,
          last_invoice: '',
        });
      }
      const row = map.get(key);
      row.invoices += 1;
      row.total += c.total_amount || 0;
      row.paid += c.amount_paid || 0;
      row.balance += c.balance || 0;
      if (c.status === 'overdue') row.overdue_count += 1;
      else if (c.status === 'closed') row.closed_count += 1;
      else row.active_count += 1;
      const created = c.created_at || '';
      if (created > row.last_invoice) row.last_invoice = created;
      if (!row.customer_phone && c.customer_phone) row.customer_phone = c.customer_phone;
    });
    let list = Array.from(map.values());
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(r => r.customer_name.toLowerCase().includes(q) || (r.customer_phone || '').includes(q));
    }
    list.sort((a, b) => b.balance - a.balance);
    return list;
  }, [credits, query]);

  const totalCustomers = customers.length;
  const totalOutstanding = customers.reduce((s, c) => s + c.balance, 0);
  const totalOverdueCustomers = customers.filter(c => c.overdue_count > 0).length;
  const totalRevenue = customers.reduce((s, c) => s + c.total, 0);

  return (
    <div data-testid="customer-section">
      {/* Snapshot */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5" data-testid="customer-kpis">
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Users className="h-4 w-4 text-emerald-600" /><p className="text-xs uppercase tracking-wider text-slate-500">Total Customers</p></div>
            <p className="text-2xl font-bold text-slate-900" data-testid="customer-count">{totalCustomers}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><IndianRupee className="h-4 w-4 text-slate-600" /><p className="text-xs uppercase tracking-wider text-slate-500">Lifetime Revenue</p></div>
            <p className="text-2xl font-bold text-slate-900" data-testid="customer-revenue">₹{totalRevenue.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><IndianRupee className="h-4 w-4 text-blue-600" /><p className="text-xs uppercase tracking-wider text-slate-500">Total Outstanding</p></div>
            <p className="text-2xl font-bold text-slate-900" data-testid="customer-outstanding">₹{totalOutstanding.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><AlertCircle className="h-4 w-4 text-red-600" /><p className="text-xs uppercase tracking-wider text-slate-500">Overdue Customers</p></div>
            <p className="text-2xl font-bold text-red-700" data-testid="customer-overdue">{totalOverdueCustomers}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-end gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer name or phone..." className="h-9 pl-9" data-testid="customer-search" />
        </div>
        <p className="text-xs text-slate-500 ml-auto">Sorted by outstanding balance</p>
      </div>

      {/* Table */}
      <Card className="border-slate-200" data-testid="customer-list">
        <CardHeader className="py-3 border-b border-slate-200"><CardTitle className="text-base font-['Outfit']">Customers ({customers.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div> :
            customers.length === 0 ? <p className="text-sm text-slate-400 text-center py-8">No customers yet. Create credit entries to populate this view.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Customer</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Phone</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Invoices</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Total (₹)</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Paid (₹)</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Balance (₹)</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Status</th>
                  </tr></thead>
                  <tbody>
                    {customers.map((c, i) => (
                      <tr key={`${c.customer_name}-${c.customer_phone || ''}-${i}`} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`customer-row-${c.customer_name}`}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{c.customer_name}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{c.customer_phone || '-'}</td>
                        <td className="px-4 py-2.5 text-right">{c.invoices}</td>
                        <td className="px-4 py-2.5 text-right">₹{c.total.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-600">₹{c.paid.toLocaleString('en-IN')}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${c.balance > 0 ? 'text-slate-900' : 'text-emerald-700'}`}>₹{c.balance.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2.5 space-x-1">
                          {c.overdue_count > 0 && <Badge className="bg-red-100 text-red-700 text-[10px]">{c.overdue_count} overdue</Badge>}
                          {c.active_count > 0 && <Badge className="bg-blue-100 text-blue-700 text-[10px]">{c.active_count} active</Badge>}
                          {c.closed_count > 0 && c.overdue_count === 0 && c.active_count === 0 && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">All settled</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
