/* In-app confirmation box, used instead of the browser's window.confirm (which looks like a system error,
 * blocks the page and can't be styled).
 *
 *   if (!(await confirmAction('Delete this expense entry?'))) return;
 *   await confirmAction({ title: 'Relieve Ravi now?', message: 'Their login is switched off.', confirmLabel: 'Relieve', tone: 'danger' })
 *
 * A plain message is split into a title (its first question or sentence) and the rest as detail; the button
 * is named after the message's first word when that word is an action ("Delete", "Archive", "Approve" …). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';

const DANGER = new Set(['delete', 'remove', 'purge', 'disconnect', 'delist', 'archive', 'retire', 'relieve', 'reject', 'cancel', 'turn', 'permanently', 'revoke', 'discard', 'clear', 'reset']);
const ACTIONS = new Set([...DANGER, 'approve', 'seed', 'make', 'send', 'mark', 'close', 'restore', 'publish', 'replace', 'continue']);

let host = null;
const waiting = [];

export function confirmAction(opts) {
  const o = typeof opts === 'string' ? { message: opts } : { ...(opts || {}) };
  return new Promise((resolve) => {
    const req = { ...o, resolve };
    if (host) host(req); else waiting.push(req);
  });
}

function describe(req) {
  let { title, message = '', confirmLabel, tone } = req;
  if (!title) {
    // split at the question only — a full stop can sit inside a name ("S. Ravi", "ABC Solar Pvt. Ltd.")
    const m = String(message).match(/^([\s\S]+?\?)(\s+|$)([\s\S]*)$/);
    if (m) { title = m[1]; message = m[3]; } else if (String(message).length <= 90) { title = message; message = ''; } else { title = 'Please confirm'; }
  }
  const first = String(title).trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!confirmLabel) {
    if (first === 'turn') confirmLabel = /\boff\b/i.test(title) ? 'Turn off' : 'Turn on';
    else if (first === 'permanently') confirmLabel = 'Delete for good';
    else if (first === 'are') confirmLabel = 'Yes, continue';
    else confirmLabel = ACTIONS.has(first) ? first[0].toUpperCase() + first.slice(1) : 'Continue';
  }
  if (!tone) tone = DANGER.has(first) || /delete|remove|cannot be undone|can't be undone/i.test(title) ? 'danger' : 'default';
  const cancelLabel = req.cancelLabel || (first === 'cancel' ? 'Keep it' : 'Go back');
  return { title, message, confirmLabel, tone, cancelLabel };
}

export function ConfirmHost() {
  const [queue, setQueue] = useState([]);
  const okRef = useRef(null);
  const backRef = useRef(null);
  useEffect(() => {
    host = (req) => setQueue((q) => [...q, req]);
    if (waiting.length) setQueue((q) => [...q, ...waiting.splice(0)]);
    return () => { host = null; };
  }, []);
  const cur = queue[0];
  const done = useCallback((answer) => {
    setQueue((q) => { if (q[0]) q[0].resolve(answer); return q.slice(1); });
  }, []);
  if (!cur) return null;
  const d = describe(cur);
  const danger = d.tone === 'danger';
  const Icon = danger ? AlertTriangle : HelpCircle;
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) done(false); }}>
      <AlertDialogContent className="max-w-md" data-testid="confirm-dialog"
        onOpenAutoFocus={(e) => { e.preventDefault(); (danger ? backRef : okRef).current?.focus(); }}>
        <AlertDialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}><Icon className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0 space-y-1.5">
            <AlertDialogTitle className="font-['Outfit'] text-lg leading-snug">{d.title}</AlertDialogTitle>
            {d.message
              ? <AlertDialogDescription className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{d.message}</AlertDialogDescription>
              : <AlertDialogDescription className="sr-only">Confirm or go back</AlertDialogDescription>}
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <Button type="button" ref={backRef} variant="outline" onClick={() => done(false)} data-testid="confirm-cancel">{d.cancelLabel}</Button>
          <Button type="button" ref={okRef} variant={danger ? 'destructive' : 'default'} onClick={() => done(true)} data-testid="confirm-ok">{d.confirmLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
