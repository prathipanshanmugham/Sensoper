/* "?" — every keyboard shortcut on one sheet. */
import { Keyboard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { SHORTCUTS } from '../lib/hotkeys';

export default function ShortcutsHelp({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto" data-testid="shortcuts-help">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Keyboard className="h-5 w-5 text-emerald-700" />Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single keys work when you aren’t typing in a box. Press Esc to leave a box first.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h3 className="mb-2 text-xs font-semibold text-slate-500">{g.group}</h3>
              <ul className="space-y-1.5">
                {g.items.map(([keys, label]) => (
                  <li key={label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-700">{label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {keys.map((k, i) => (
                        <span key={`${k}-${i}`} className="flex items-center gap-1">
                          {i > 0 && g.group.startsWith('Go to') && <span className="text-[10px] text-slate-400">then</span>}
                          <kbd className="min-w-[1.5rem] rounded-md border border-slate-200 border-b-2 bg-white px-1.5 py-0.5 text-center text-xs font-medium text-slate-700">{k}</kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
