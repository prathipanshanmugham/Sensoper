/* Org chart diagram: who reports to whom, from HR → People (reports-to). Where nobody has set it, the line is
 * a guess (managers → the first admin, staff → a manager of their branch) and is drawn dashed. Tap a person to
 * change their reporting line (people with HR editing). Large teams stack under their manager to stay readable. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Loader2, Minus, Plus } from 'lucide-react';
import { hrAPI } from '../utils/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const DOT = { checked_in: 'bg-emerald-500', checked_out: 'bg-sky-500', absent: 'bg-slate-300' };
const ROLE_TONE = { admin: 'bg-amber-300 text-slate-900', manager: 'bg-sky-100 text-sky-800', staff: 'bg-emerald-100 text-emerald-800' };
const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const STACK_AT = 5;   // more direct reports than this → list them in a column

const CSS = `
.oc-tree ul{position:relative;display:flex;justify-content:center;padding-top:22px;margin:0}
.oc-tree li{position:relative;list-style:none;padding:22px 6px 0;display:flex;flex-direction:column;align-items:center}
.oc-tree li::before,.oc-tree li::after{content:'';position:absolute;top:0;right:50%;width:50%;height:22px;border-top:2px solid #cbd5e1}
.oc-tree li::after{right:auto;left:50%;border-left:2px solid #cbd5e1}
.oc-tree li:only-child::before,.oc-tree li:only-child::after{display:none}
.oc-tree li:only-child{padding-top:0}
.oc-tree li:first-child::before,.oc-tree li:last-child::after{border:0 none}
.oc-tree li:last-child::before{border-right:2px solid #cbd5e1;border-radius:0 8px 0 0}
.oc-tree li:first-child::after{border-radius:8px 0 0 0}
.oc-tree ul ul::before{content:'';position:absolute;top:0;left:50%;height:22px;border-left:2px solid #cbd5e1}
.oc-tree li.oc-guess::after,.oc-tree li.oc-guess::before{border-style:dashed}
.oc-tree>ul{padding-top:0}
.oc-tree>ul>li::before,.oc-tree>ul>li::after{display:none}
.oc-tree>ul>li{padding-top:0}
.oc-tree ul.oc-stack{flex-direction:column;align-items:center;gap:8px}
.oc-tree ul.oc-stack>li{padding:0}
.oc-tree ul.oc-stack>li::before,.oc-tree ul.oc-stack>li::after{display:none}
`;

function Node({ p, guessed, count, open, onToggle, onPick }) {
  return (
    <div className={`relative w-44 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm ${p.on_notice ? 'border-amber-300' : 'border-slate-200'}`} data-testid={`oc-node-${p.id}`}>
      <button type="button" onClick={() => onPick(p)} className="flex w-full items-center gap-2 text-left" aria-label={`${p.name}${p.designation ? `, ${p.designation}` : ''}`}>
        <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ROLE_TONE[p.role] || ROLE_TONE.staff}`}>
          {initials(p.name)}<span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${DOT[p.today] || DOT.absent}`} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
          <span className="block truncate text-[11px] text-slate-500">{p.designation || p.role}{p.department ? ` · ${p.department}` : ''}</span>
          {p.on_notice && <span className="block text-[10px] font-medium text-amber-800">serving notice</span>}
        </span>
      </button>
      {guessed && <span className="absolute -top-2 left-2 rounded bg-white px-1 text-[9px] text-slate-400">guess</span>}
      {count > 0 && (
        <button type="button" onClick={onToggle} className="mt-1 flex w-full items-center justify-center gap-1 rounded-md bg-slate-50 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100" aria-expanded={open} data-testid={`oc-toggle-${p.id}`}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{count} report{count === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function Branch({ id, byId, kids, links, collapsed, toggle, onPick }) {
  const p = byId[id];
  const children = kids[id] || [];
  const open = !collapsed.has(id);
  return (
    <li className={links[id]?.guessed ? 'oc-guess' : ''}>
      <Node p={p} guessed={links[id]?.guessed} count={children.length} open={open} onToggle={() => toggle(id)} onPick={onPick} />
      {open && children.length > 0 && (
        <ul className={children.length > STACK_AT ? 'oc-stack' : ''}>
          {children.map((c) => <Branch key={c} id={c} byId={byId} kids={kids} links={links} collapsed={collapsed} toggle={toggle} onPick={onPick} />)}
        </ul>
      )}
    </li>
  );
}

export default function OrgChart({ data, canEdit, onChanged }) {
  const [collapsed, setCollapsed] = useState(new Set());
  const [zoom, setZoom] = useState(1);
  const [pick, setPick] = useState(null);
  const [form, setForm] = useState({ reports_to: '', designation: '' });
  const [saving, setSaving] = useState(false);
  const people = useMemo(() => {
    const all = [...data.leadership, ...data.locations.flatMap((b) => [...b.managers, ...b.staff]), ...data.unassigned];
    const seen = new Map();
    all.forEach((p) => { if (!seen.has(p.id)) seen.set(p.id, p); });
    return [...seen.values()];
  }, [data]);
  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const links = useMemo(() => Object.fromEntries((data.chart || []).map((l) => [l.id, l])), [data.chart]);
  const { roots, kids } = useMemo(() => {
    const k = {};
    const r = [];
    people.forEach((p) => {
      const boss = links[p.id]?.reports_to;
      if (boss && byId[boss]) (k[boss] = k[boss] || []).push(p.id); else r.push(p.id);
    });
    const order = (a, b) => ({ admin: 0, manager: 1 }[byId[a].role] ?? 2) - ({ admin: 0, manager: 1 }[byId[b].role] ?? 2) || byId[a].name.localeCompare(byId[b].name);
    Object.values(k).forEach((v) => v.sort(order));
    return { roots: r.sort(order), kids: k };
  }, [people, links, byId]);
  const toggle = (id) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const guesses = Object.values(links).filter((l) => l.guessed).length;
  const openPick = (p) => { if (!canEdit) return; setPick(p); setForm({ reports_to: p.reports_to || links[p.id]?.reports_to || '', designation: p.designation || '' }); };
  const save = async () => {
    setSaving(true);
    try {
      await hrAPI.updatePerson(pick.id, { designation: form.designation, department: pick.department, reports_to: form.reports_to || null });
      toast.success('Reporting line saved'); setPick(null); onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not save'); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-2" data-testid="org-chart">
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>{people.length} people{guesses ? ` · ${guesses} line${guesses === 1 ? ' is a guess' : 's are guesses'} (dashed) — ` : ''}{guesses > 0 && (canEdit ? 'tap a person to set who they report to' : <Link to="/dashboard/hr?tab=people" className="text-emerald-700 underline">set them in HR</Link>)}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))} aria-label="Zoom out"><Minus className="h-4 w-4" /></Button>
          <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(1)))} aria-label="Zoom in"><Plus className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(Object.keys(kids)))}>{collapsed.size ? 'Open all' : 'Close all'}</Button>
        </div>
      </div>
      <div className="overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="oc-tree mx-auto w-max" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
          <ul>{roots.map((id) => <Branch key={id} id={id} byId={byId} kids={kids} links={links} collapsed={collapsed} toggle={toggle} onPick={openPick} />)}</ul>
        </div>
      </div>
      <Dialog open={!!pick} onOpenChange={(o) => !o && setPick(null)}>
        <DialogContent className="max-w-sm" data-testid="oc-edit-dialog">
          <DialogHeader><DialogTitle>{pick?.name}</DialogTitle><DialogDescription>Who do they report to?</DialogDescription></DialogHeader>
          <div className="space-y-2">
            <label className="block space-y-1"><span className="text-xs font-medium text-slate-700">Designation</span><Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="h-11" /></label>
            <label className="block space-y-1"><span className="text-xs font-medium text-slate-700">Reports to</span>
              <Select value={form.reports_to || '__top'} onValueChange={(v) => setForm({ ...form, reports_to: v === '__top' ? '' : v })}>
                <SelectTrigger className="h-11" data-testid="oc-boss"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72"><SelectItem value="__top">Nobody (top of the chart)</SelectItem>{people.filter((p) => p.id !== pick?.id).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.designation ? ` · ${p.designation}` : ''}</SelectItem>)}</SelectContent>
              </Select></label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPick(null)}>Cancel</Button><Button onClick={save} disabled={saving} className="bg-emerald-600 text-white" data-testid="oc-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
