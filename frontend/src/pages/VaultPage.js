import { useState, useEffect, useCallback } from 'react';
import { vaultAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { toast } from 'sonner';
import { KeyRound, Plus, Eye, EyeOff, Copy, Edit, Trash2, History, ShieldAlert, Clock, Loader2, Search, Save } from 'lucide-react';

const CATEGORIES = ['email', 'hosting', 'domain', 'financial', 'software', 'other'];
const METHODS = [['authenticator_app', 'Authenticator app'], ['sms', 'SMS'], ['backup_codes', 'Backup codes'], ['none', 'None']];
const blank = { service_name: '', account_identifier: '', password: '', associated_phone: '', two_fa_enabled: false, two_fa_method: 'none', notes: '', category: 'other', owner: '', url: '' };

function RevealCell({ item, onRevealed }) {
  const [plain, setPlain] = useState(null);
  const [busy, setBusy] = useState(false);
  const reveal = async () => {
    setBusy(true);
    try { const r = await vaultAPI.reveal(item.id); setPlain(r.data.password); onRevealed?.(); setTimeout(() => setPlain(null), 30000); }
    catch (e) { toast.error(e.response?.data?.detail || 'Reveal failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-1.5 font-mono text-sm" data-testid={`vault-password-${item.id}`}>
      <span className={plain ? 'text-slate-900' : 'text-slate-400 tracking-widest'}>{plain ?? '••••••••••'}</span>
      {plain ? (
        <>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { navigator.clipboard?.writeText(plain); toast.success('Copied'); }} data-testid={`vault-copy-${item.id}`}><Copy className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPlain(null)} data-testid={`vault-hide-${item.id}`}><EyeOff className="h-3.5 w-3.5" /></Button>
        </>
      ) : (
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy} onClick={reveal} title="Reveal (logged)" data-testid={`vault-reveal-${item.id}`}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}</Button>
      )}
    </div>
  );
}

export default function VaultPage() {
  const [items, setItems] = useState([]);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logFor, setLogFor] = useState(null);
  const [log, setLog] = useState([]);
  const [rotationDays, setRotationDays] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, d] = await Promise.all([vaultAPI.list({ search: search || undefined, category }), vaultAPI.dashboard()]);
      setItems(l.data); setDash(d.data); setRotationDays(String(d.data.rotation_days));
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not load vault'); }
    finally { setLoading(false); }
  }, [search, category]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const openCreate = () => { setEditingId(null); setForm(blank); setOpen(true); };
  const openEdit = (it) => { setEditingId(it.id); setForm({ ...blank, ...it, password: '' }); setOpen(true); };
  const save = async () => {
    if (!form.service_name || !form.account_identifier || (!editingId && !form.password)) { toast.error('Service, account and password are required'); return; }
    setSaving(true);
    try {
      const payload = { ...form }; if (editingId && !payload.password) delete payload.password;
      delete payload.id; delete payload.last_updated; delete payload.last_rotated; delete payload.rotation_stale; delete payload.view_count; delete payload.last_viewed;
      if (editingId) await vaultAPI.update(editingId, payload); else await vaultAPI.create(payload);
      toast.success(editingId ? 'Credential updated' : 'Credential stored (encrypted)'); setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };
  const remove = async (it) => { if (!window.confirm(`Delete ${it.service_name}? This is logged.`)) return; try { await vaultAPI.remove(it.id); toast.success('Deleted'); load(); } catch (e) { toast.error(e.response?.data?.detail || 'Delete failed'); } };
  const showLog = async (it) => { setLogFor(it); try { const r = await vaultAPI.accessLog(it.id); setLog(r.data); } catch { setLog([]); } };
  const saveRotation = async () => { try { await vaultAPI.setConfig(parseInt(rotationDays, 10)); toast.success('Rotation period saved'); load(); } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); } };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4" data-testid="vault-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-['Outfit'] flex items-center gap-2"><KeyRound className="h-5 w-5 text-amber-600" />Credential Vault</h1>
          <p className="text-sm text-slate-500">Company logins to external services (Google Workspace, hosting, domains…). Admin only — every reveal is logged.</p>
        </div>
        <Button onClick={openCreate} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="vault-new-btn"><Plus className="h-4 w-4" />Add credential</Button>
      </div>

      {dash && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="vault-dashboard">
          <Card className="border-red-200 bg-red-50/40"><CardContent className="p-3">
            <p className="text-xs uppercase tracking-wider text-red-600 flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" />2FA disabled</p>
            <p className="text-2xl font-bold text-red-700" data-testid="vault-2fa-disabled-count">{dash.two_fa_disabled.length}</p>
            <p className="text-[11px] text-slate-500 truncate">{dash.two_fa_disabled.map(i => i.service_name).join(', ') || 'All services protected'}</p>
          </CardContent></Card>
          <Card className="border-amber-200 bg-amber-50/40"><CardContent className="p-3">
            <p className="text-xs uppercase tracking-wider text-amber-700 flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Not rotated in {dash.rotation_days}d</p>
            <p className="text-2xl font-bold text-amber-700" data-testid="vault-rotation-overdue-count">{dash.rotation_overdue.length}</p>
            <div className="flex items-center gap-1 mt-1">
              <Input value={rotationDays} onChange={e => setRotationDays(e.target.value)} type="number" className="h-7 w-20 text-xs" data-testid="vault-rotation-days" />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveRotation} data-testid="vault-rotation-save"><Save className="h-3 w-3 mr-1" />days</Button>
            </div>
          </CardContent></Card>
          <Card className="border-slate-200"><CardContent className="p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">Encryption at rest</p>
            <p className="text-sm font-semibold text-slate-800">{dash.encryption.scheme}</p>
            <p className="text-[11px] text-slate-500">Key: {dash.encryption.key_source} · {dash.encryption.configured ? 'configured' : 'MISSING'} · {dash.total} records</p>
            <p className="text-[10px] text-amber-700 mt-1" data-testid="vault-encryption-limits">{dash.encryption.limitations}</p>
          </CardContent></Card>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search service or account…" className="pl-9 h-10" data-testid="vault-search" /></div>
        <Select value={category} onValueChange={setCategory}><SelectTrigger className="h-10 w-44" data-testid="vault-category-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
      </div>

      <Card className="border-slate-200"><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm" data-testid="vault-table">
          <thead><tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-600">
            <th className="px-3 py-2">Service</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Password</th><th className="px-3 py-2">2FA</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Rotated</th><th className="px-3 py-2">Views</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline text-emerald-600" /></td></tr>
              : items.length === 0 ? <tr><td colSpan={8} className="py-8 text-center text-slate-400" data-testid="vault-empty">No credentials stored yet.</td></tr>
              : items.map(it => (
                <tr key={it.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`vault-row-${it.id}`}>
                  <td className="px-3 py-2"><p className="font-medium text-slate-900">{it.service_name}</p><Badge variant="secondary" className="text-[10px]">{it.category}</Badge>{it.url && <a href={it.url} target="_blank" rel="noreferrer" className="block text-[11px] text-sky-600 truncate max-w-[180px]">{it.url}</a>}</td>
                  <td className="px-3 py-2 text-slate-700">{it.account_identifier}{it.associated_phone && <p className="text-[11px] text-slate-400">{it.associated_phone}</p>}</td>
                  <td className="px-3 py-2"><RevealCell item={it} onRevealed={load} /></td>
                  <td className="px-3 py-2">{it.two_fa_enabled ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">{METHODS.find(m => m[0] === it.two_fa_method)?.[1] || 'On'}</Badge> : <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-[10px]" data-testid={`vault-2fa-off-${it.id}`}>Off — risk</Badge>}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{it.owner || '—'}</td>
                  <td className="px-3 py-2 text-xs"><span className={it.rotation_stale ? 'text-amber-700 font-medium' : 'text-slate-500'}>{it.last_rotated?.slice(0, 10) || '—'}</span></td>
                  <td className="px-3 py-2 text-xs text-slate-500">{it.view_count}{it.last_viewed && <span className="block text-[10px]">{it.last_viewed.slice(0, 16).replace('T', ' ')}</span>}</td>
                  <td className="px-3 py-2"><div className="flex gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => showLog(it)} data-testid={`vault-log-${it.id}`}><History className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(it)} data-testid={`vault-edit-${it.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => remove(it)} data-testid={`vault-delete-${it.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div></td>
                </tr>
              ))}
          </tbody>
        </table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="vault-dialog">
          <DialogHeader><DialogTitle>{editingId ? 'Edit credential' : 'Add credential'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Service *</Label><Input value={form.service_name} onChange={e => setForm(p => ({ ...p, service_name: e.target.value }))} placeholder="Google Workspace" className="h-9" data-testid="vault-service-input" /></div>
              <div className="space-y-1"><Label className="text-xs">Category</Label><Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}><SelectTrigger className="h-9" data-testid="vault-category-select"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Account (email / username) *</Label><Input value={form.account_identifier} onChange={e => setForm(p => ({ ...p, account_identifier: e.target.value }))} className="h-9" data-testid="vault-account-input" /></div>
              <div className="space-y-1"><Label className="text-xs">{editingId ? 'New password (blank = keep)' : 'Password *'}</Label><Input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} className="h-9" autoComplete="new-password" data-testid="vault-password-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Recovery / 2FA phone</Label><Input value={form.associated_phone} onChange={e => setForm(p => ({ ...p, associated_phone: e.target.value }))} className="h-9" data-testid="vault-phone-input" /></div>
              <div className="space-y-1"><Label className="text-xs">Owner (staff / role)</Label><Input value={form.owner} onChange={e => setForm(p => ({ ...p, owner: e.target.value }))} className="h-9" data-testid="vault-owner-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="flex items-center gap-2 h-9"><Switch checked={form.two_fa_enabled} onCheckedChange={v => setForm(p => ({ ...p, two_fa_enabled: v, two_fa_method: v ? (p.two_fa_method === 'none' ? 'authenticator_app' : p.two_fa_method) : 'none' }))} data-testid="vault-2fa-switch" /><Label className="text-xs">2FA enabled</Label></div>
              <div className="space-y-1"><Label className="text-xs">2FA method</Label><Select value={form.two_fa_method} onValueChange={v => setForm(p => ({ ...p, two_fa_method: v }))} disabled={!form.two_fa_enabled}><SelectTrigger className="h-9" data-testid="vault-2fa-method"><SelectValue /></SelectTrigger><SelectContent>{METHODS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Login URL</Label><Input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))} className="h-9" placeholder="https://" /></div>
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="h-9" data-testid="vault-notes-input" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="vault-save-btn">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Save changes' : 'Store encrypted'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!logFor} onOpenChange={v => !v && setLogFor(null)}>
        <DialogContent className="max-w-lg" data-testid="vault-log-dialog">
          <DialogHeader><DialogTitle>Access log — {logFor?.service_name}</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 text-xs">
            {log.length === 0 ? <p className="py-6 text-center text-slate-400">No access yet.</p> : log.map((a, i) => (
              <div key={i} className="py-1.5 flex items-center justify-between gap-2">
                <span><Badge variant={a.action === 'reveal' ? 'default' : 'outline'} className="text-[10px] mr-2">{a.action}</Badge>{a.user_name}</span>
                <span className="text-slate-400">{a.timestamp?.slice(0, 19).replace('T', ' ')}{a.ip ? ` · ${a.ip}` : ''}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
