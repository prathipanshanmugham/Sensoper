import { useState } from 'react';
import { kitCategoriesAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Plus, Pencil, Check, X, Archive, ArchiveRestore, Loader2, Lock } from 'lucide-react';

export const CATEGORY_COLORS = {
  blue: 'bg-blue-100 text-blue-700 border-blue-300', orange: 'bg-orange-100 text-orange-700 border-orange-300',
  violet: 'bg-violet-100 text-violet-700 border-violet-300', cyan: 'bg-cyan-100 text-cyan-700 border-cyan-300',
  rose: 'bg-rose-100 text-rose-700 border-rose-300', amber: 'bg-amber-100 text-amber-700 border-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 border-emerald-300', slate: 'bg-slate-100 text-slate-600 border-slate-300',
};
const err = (e, fb) => formatApiErrorDetail(e.response?.data?.detail) || fb;

/** Iter 58 — admin add / rename / retire Solution-Kit categories (Solar Camera, …). Built-ins map to the calculator's system types. */
export function KitCategoriesDialog({ open, onOpenChange, categories, onChanged }) {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('rose');
  const [editing, setEditing] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [busy, setBusy] = useState('');

  const add = async () => {
    if (!label.trim()) return;
    setBusy('add');
    try { await kitCategoriesAPI.create({ label: label.trim(), color }); setLabel(''); toast.success('Category added'); onChanged(); }
    catch (e) { toast.error(err(e, 'Could not add category')); } finally { setBusy(''); }
  };
  const rename = async (c) => {
    if (!editLabel.trim() || editLabel.trim() === c.label) { setEditing(null); return; }
    setBusy(c.id);
    try { await kitCategoriesAPI.update(c.id, { label: editLabel.trim() }); setEditing(null); toast.success('Renamed'); onChanged(); }
    catch (e) { toast.error(err(e, 'Rename failed')); } finally { setBusy(''); }
  };
  const toggle = async (c) => {
    setBusy(c.id);
    try { await kitCategoriesAPI.update(c.id, { active: !c.active }); toast.success(c.active ? 'Category retired' : 'Category reactivated'); onChanged(); }
    catch (e) { toast.error(err(e, 'Update failed')); } finally { setBusy(''); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="kit-categories-dialog">
        <DialogHeader>
          <DialogTitle>Kit categories</DialogTitle>
          <DialogDescription>Any product line can be a kit category — e.g. Solar Camera, Street Light. Built-in ones drive the calculator's auto-match and can't be retired.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="New category, e.g. Solar Street Light" className="h-9" data-testid="kit-cat-new-label" />
          <select value={color} onChange={e => setColor(e.target.value)} className="h-9 rounded-md border border-slate-300 px-2 text-xs" data-testid="kit-cat-new-color">
            {Object.keys(CATEGORY_COLORS).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <Button onClick={add} disabled={!label.trim() || busy === 'add'} className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="kit-cat-add">{busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 max-h-80 overflow-y-auto" data-testid="kit-cat-list">
          {categories.map(c => (
            <li key={c.id} className={`flex items-center gap-2 px-3 py-2 ${c.active ? '' : 'opacity-60'}`} data-testid={`kit-cat-row-${c.slug}`}>
              <Badge className={`text-[10px] border ${CATEGORY_COLORS[c.color] || CATEGORY_COLORS.slate}`}>{c.slug}</Badge>
              {editing === c.id ? (
                <span className="flex-1 flex gap-1">
                  <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && rename(c)} className="h-8 text-sm" autoFocus data-testid={`kit-cat-edit-input-${c.slug}`} />
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => rename(c)} data-testid={`kit-cat-edit-save-${c.slug}`}><Check className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
                </span>
              ) : (
                <span className="flex-1 text-sm text-slate-800">{c.label} <span className="text-[11px] text-slate-400">· {c.kit_count} kit{c.kit_count === 1 ? '' : 's'}{c.system_type ? ` · calculator: ${c.system_type}` : ''}</span></span>
              )}
              {editing !== c.id && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditing(c.id); setEditLabel(c.label); }} data-testid={`kit-cat-rename-${c.slug}`}><Pencil className="h-3.5 w-3.5" /></Button>}
              {c.builtin ? <Lock className="h-3.5 w-3.5 text-slate-300" title="Built-in" /> : (
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy === c.id} onClick={() => toggle(c)} title={c.active ? 'Retire' : 'Reactivate'} data-testid={`kit-cat-toggle-${c.slug}`}>{c.active ? <Archive className="h-3.5 w-3.5 text-amber-600" /> : <ArchiveRestore className="h-3.5 w-3.5 text-emerald-600" />}</Button>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
