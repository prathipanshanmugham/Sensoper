/* Ctrl+K / ⌘K — one box to jump anywhere: actions (new lead, new quotation…), pages, and records
 * (leads, quotations, projects, stock with its price) from GET /api/search. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { Search, Loader2, CornerDownLeft, Contact, FileSpreadsheet, FolderKanban, Package } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { searchAPI } from '../utils/api';

const GROUP_ICON = { leads: Contact, quotes: FileSpreadsheet, projects: FolderKanban, items: Package };
const match = (text, q) => {
  const hay = text.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

function Kbd({ children }) {
  return <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{children}</kbd>;
}

function Item({ value, onSelect, icon: Icon, title, sub, keys }) {
  return (
    <Command.Item value={value} onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 aria-selected:bg-emerald-50 aria-selected:text-slate-900 data-[selected=true]:bg-emerald-50 data-[selected=true]:text-slate-900">
      {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {sub && <span className="block truncate text-xs text-slate-500">{sub}</span>}
      </span>
      {keys && <span className="flex shrink-0 gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>}
    </Command.Item>
  );
}

export default function CommandPalette({ open, onOpenChange, pages, actions }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const req = useRef(0);

  useEffect(() => { if (!open) { setQ(''); setGroups([]); } }, [open]);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setGroups([]); setLoading(false); return undefined; }
    const my = ++req.current;
    setLoading(true);
    const t = setTimeout(() => searchAPI.search(text).then((r) => { if (my === req.current) setGroups(r.data.groups || []); })
      .catch(() => { if (my === req.current) setGroups([]); }).finally(() => { if (my === req.current) setLoading(false); }), 180);
    return () => clearTimeout(t);
  }, [q]);

  const ql = q.trim().toLowerCase();
  const acts = useMemo(() => actions.filter((a) => !ql || match(`${a.label} ${a.keywords || ''}`, ql)), [actions, ql]);
  const pgs = useMemo(() => pages.filter((p) => !ql || match(`${p.label} ${p.keywords || ''} ${p.section || ''}`, ql)).slice(0, ql ? 8 : 40), [pages, ql]);
  const go = (href) => { onOpenChange(false); navigate(href); };
  const nothing = !loading && acts.length === 0 && pgs.length === 0 && groups.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[10%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:top-[14%]" data-testid="command-palette">
        <DialogTitle className="sr-only">Search Sensoper</DialogTitle>
        <DialogDescription className="sr-only">Type to find a page, a lead, a quotation, a project or a stock item.</DialogDescription>
        <Command shouldFilter={false} loop label="Search Sensoper">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Search leads, quotations, projects, stock or pages…"
              className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-slate-400" data-testid="command-input" />
            {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />}
          </div>
          <Command.List className="max-h-[min(60vh,460px)] overflow-y-auto p-2">
            {nothing && <p className="px-3 py-8 text-center text-sm text-slate-500">{ql.length < 2 ? 'Type a name, number or item.' : `Nothing matches “${q}”.`}</p>}
            {acts.length > 0 && (
              <Command.Group heading="Do" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-slate-500">
                {acts.map((a) => <Item key={a.id} value={`act-${a.id}`} icon={a.icon} title={a.label} sub={a.sub} keys={a.keys} onSelect={() => { onOpenChange(false); a.run(); }} />)}
              </Command.Group>
            )}
            {groups.map((g) => (
              <Command.Group key={g.key} heading={g.label} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-slate-500">
                {g.items.map((it) => <Item key={`${g.key}-${it.id}`} value={`${g.key}-${it.id}`} icon={GROUP_ICON[g.key]} title={it.title} sub={it.sub} onSelect={() => go(it.href)} />)}
              </Command.Group>
            ))}
            {pgs.length > 0 && (
              <Command.Group heading="Pages" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-slate-500">
                {pgs.map((p) => <Item key={p.href} value={`page-${p.href}`} icon={p.icon} title={p.label} sub={p.section} keys={p.keys} onSelect={() => go(p.href)} />)}
              </Command.Group>
            )}
          </Command.List>
          <div className="hidden items-center gap-4 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500 sm:flex">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
            <span className="flex items-center gap-1"><Kbd><CornerDownLeft className="inline h-3 w-3" /></Kbd> open</span>
            <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
            <span className="ml-auto flex items-center gap-1"><Kbd>?</Kbd> all shortcuts</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
