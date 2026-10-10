/* Settings → Permissions. One row per page, grouped like the menu. What you switch here is what happens:
 * the page shows or hides in that role's menu, the address stops opening, and the server refuses the
 * action (backend/access_policy.py holds the same list). Admins always have everything. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Briefcase, Check, Crown, HardHat, Loader2, Lock, RotateCcw, Save, Search, Shield, Undo2 } from 'lucide-react';
import { permissionsAPI } from '../utils/api';
import { useAuth, formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';

const ROLES = [
  { key: 'manager', label: 'Manager', icon: Briefcase, note: 'Branch and team leaders' },
  { key: 'staff', label: 'Staff', icon: HardHat, note: 'Field, sales and installation team' },
  { key: 'admin', label: 'Admin', icon: Crown, note: 'Always everything' },
];
const ACTION_LABEL = { create: 'Add', edit: 'Edit', delete: 'Delete', export: 'Download' };
const ACTION_HINT = { create: 'Add new records', edit: 'Change existing records', delete: 'Remove records', export: 'Download PDF / Excel' };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function PageRow({ page, row, opts, onRow, onOpt, disabled }) {
  const open = !!row?.view;
  const locked = page.locked;
  const actions = page.actions.filter((a) => a !== 'view');
  return (
    <li className={`px-4 py-3 ${open ? '' : 'bg-slate-50/60'}`} data-testid={`perm-page-${page.key}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={`flex flex-wrap items-center gap-2 text-sm font-medium ${open ? 'text-slate-900' : 'text-slate-500'}`}>
            {page.label}
            {locked && <span className="flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700"><Lock className="h-3 w-3" />Admins only</span>}
            {page.always && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Always on</span>}
          </p>
          <p className="text-xs text-slate-500">{page.what}</p>
        </div>
        <Switch checked={open} disabled={disabled || locked || page.always} onCheckedChange={(v) => onRow(page.key, { ...row, view: v })}
          aria-label={`${page.label}: can open`} data-testid={`perm-open-${page.key}`} />
      </div>
      {open && !locked && actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`${page.label} actions`}>
          {actions.map((a) => {
            const on = !!row?.[a];
            return (
              <button key={a} type="button" disabled={disabled} title={ACTION_HINT[a]} onClick={() => onRow(page.key, { ...row, [a]: !on })}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-400 line-through decoration-slate-300'} disabled:opacity-60`}
                aria-pressed={on} data-testid={`perm-${page.key}-${a}`}>
                {on && <Check className="h-3 w-3" />}{ACTION_LABEL[a]}
              </button>
            );
          })}
        </div>
      )}
      {open && !locked && page.options.length > 0 && (
        <ul className="mt-2 space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/70 p-2">
          {page.options.map((o) => (
            <li key={o.key} className="flex items-start gap-3">
              <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-slate-800">{o.label}</span><span className="block text-[11px] text-slate-500">{o.what}</span></span>
              <Switch checked={!!opts[o.key]} disabled={disabled} onCheckedChange={(v) => onOpt(o.key, v)} aria-label={o.label} data-testid={`perm-opt-${o.key}`} />
            </li>
          ))}
        </ul>
      )}
      {page.key === 'module_daily_updates' && open && (
        <p className="mt-2 text-[11px] text-slate-500">Who must send one is chosen per person in <Link to="/dashboard/users" className="font-medium text-emerald-700 hover:underline">Users</Link> or Daily report → Team.</p>
      )}
    </li>
  );
}

export default function PermissionsPage() {
  const { reloadPerms } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [saved, setSaved] = useState({});
  const [draft, setDraft] = useState({});
  const [role, setRole] = useState('manager');
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [c, all] = await Promise.all([permissionsAPI.catalog(), permissionsAPI.getAll()]);
    setCatalog(c.data);
    setSaved(all.data);
    setDraft(JSON.parse(JSON.stringify(all.data)));
  }, []);
  useEffect(() => { load().catch(() => toast.error('Could not load permissions')); }, [load]);

  const perms = draft[role] || {};
  const dirty = !same(draft[role], saved[role]);
  const isAdminRole = role === 'admin';

  const setRow = (key, row) => setDraft((d) => ({ ...d, [role]: { ...d[role], [key]: row } }));
  const setOpt = (key, v) => setDraft((d) => ({ ...d, [role]: { ...d[role], [key]: v } }));

  const sections = useMemo(() => {
    if (!catalog) return [];
    const s = q.trim().toLowerCase();
    return catalog.sections.map((sec) => ({ ...sec, pages: sec.pages.filter((p) => !s || `${p.label} ${p.what} ${p.options.map((o) => o.label).join(' ')}`.toLowerCase().includes(s)) }))
      .filter((sec) => sec.pages.length > 0);
  }, [catalog, q]);

  const openCount = catalog ? catalog.sections.flatMap((s) => s.pages).filter((p) => perms[p.key]?.view).length : 0;
  const pageCount = catalog ? catalog.sections.flatMap((s) => s.pages).length : 0;

  const save = async () => {
    setSaving(true);
    try {
      const r = await permissionsAPI.updateRole(role, draft[role]);
      setSaved((x) => ({ ...x, [role]: r.data.permissions }));
      setDraft((x) => ({ ...x, [role]: r.data.permissions }));
      toast.success(`${ROLES.find((x) => x.key === role).label} permissions saved — they apply straight away`);
      reloadPerms?.();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not save'); } finally { setSaving(false); }
  };
  const recommended = () => {
    if (!catalog?.recommended?.[role]) return;
    setDraft((d) => ({ ...d, [role]: { ...d[role], ...JSON.parse(JSON.stringify(catalog.recommended[role])) } }));
    toast('Recommended settings loaded — press Save to keep them');
  };

  if (!catalog) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 pb-28 sm:p-6 sm:pb-28" data-testid="permissions-page">
      <div>
        <h1 className="flex items-center gap-2 font-['Outfit'] text-2xl font-bold text-slate-900" data-testid="permissions-title"><Shield className="h-6 w-6 text-emerald-600" />Permissions</h1>
        <p className="mt-1 text-sm text-slate-500">Choose what each role can open and do. Switch a page off and it leaves that role’s menu, its address stops opening and the app refuses the action — no matter how someone tries.</p>
      </div>

      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Role">
        {ROLES.map((r) => {
          const I = r.icon;
          const on = role === r.key;
          const changed = r.key !== 'admin' && !same(draft[r.key], saved[r.key]);
          return (
            <button key={r.key} type="button" role="tab" aria-selected={on} onClick={() => setRole(r.key)}
              className={`relative rounded-xl border p-3 text-left transition-colors ${on ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`} data-testid={`role-tab-${r.key}`}>
              <I className={`h-5 w-5 ${on ? 'text-emerald-700' : 'text-slate-400'}`} />
              <p className="mt-1 text-sm font-semibold text-slate-900">{r.label}</p>
              <p className="hidden text-[11px] text-slate-500 sm:block">{r.note}</p>
              {changed && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" />}
            </button>
          );
        })}
      </div>

      {isAdminRole ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900" data-testid="admin-locked-note">
          <p className="font-semibold">Admins can always open and do everything.</p>
          <p className="mt-1 text-violet-800">That keeps at least one person able to fix permissions. Give the Admin role only to people who need it, in Users.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a page or option" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-400" data-testid="perm-search" />
            </div>
            <p className="text-xs text-slate-500 sm:px-2"><b className="text-slate-800">{openCount}</b> of {pageCount} pages open</p>
            <Button variant="outline" onClick={recommended} className="h-10 gap-1.5" data-testid="perm-recommended"><RotateCcw className="h-4 w-4" />Use recommended</Button>
          </div>

          {sections.map((sec) => (
            <section key={sec.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid={`perm-section-${sec.id}`}>
              <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{sec.label}</h2>
              <ul className="divide-y divide-slate-100">
                {sec.pages.map((p) => <PageRow key={p.key} page={p} row={perms[p.key]} opts={perms} onRow={setRow} onOpt={setOpt} disabled={saving} />)}
              </ul>
            </section>
          ))}
          {sections.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Nothing matches “{q}”.</p>}
        </>
      )}

      {dirty && !isAdminRole && (
        <div className="fixed inset-x-0 bottom-16 z-30 px-4 lg:bottom-4 lg:left-64" data-testid="perm-savebar">
          <div className="mx-auto flex max-w-4xl items-center gap-3 rounded-xl border border-amber-200 bg-white p-3 shadow-lg">
            <p className="min-w-0 flex-1 text-sm text-slate-700">Unsaved changes for <b>{ROLES.find((r) => r.key === role).label}</b></p>
            <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, [role]: JSON.parse(JSON.stringify(saved[role])) }))} className="h-9 gap-1"><Undo2 className="h-4 w-4" />Undo</Button>
            <Button onClick={save} disabled={saving} className="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="perm-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}
