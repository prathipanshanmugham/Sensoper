/* Keyboard shortcuts.
 *
 *   useHotkeys([
 *     { keys: 'n', run: () => openNewLead() },             // a single key — never while typing in a box
 *     { keys: 'g l', run: () => navigate('/dashboard/leads') },   // G, then L (within a second)
 *     { keys: 'mod+k', run: openPalette, inInput: true },  // Ctrl+K on Windows, ⌘K on a Mac — also while typing
 *     { keys: 'mod+s', run: save, inInput: true, inDialog: true },
 *   ], [deps])
 *
 * Single keys are ignored while the cursor is in a text box, and (unless inDialog) while a dialog is open, so
 * typing a note never triggers anything. The list of every shortcut lives in SHORTCUTS for the "?" help sheet. */
import { useEffect, useRef } from 'react';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
export const MOD = isMac ? '⌘' : 'Ctrl';

const typing = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes((el.type || '').toLowerCase());
};
const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');

let pendingG = 0;   // time "g" was pressed, for G-then-letter
let watching = false;

function comboOf(e) {
  let key = (e.key || '').toLowerCase();
  if (key === '/' && e.shiftKey) key = '?';   // some keyboards / tools report Shift+/ as "/" with Shift held
  if (['control', 'meta', 'shift', 'alt'].includes(key)) return null;
  const mod = e.ctrlKey || e.metaKey;
  const named = key.length > 1;   // enter, escape, arrowdown…
  return `${mod ? 'mod+' : ''}${e.altKey ? 'alt+' : ''}${e.shiftKey && named ? 'shift+' : ''}${key === ' ' ? 'space' : key}`;
}

/** One capture-phase listener for the whole app: notes "g", and marks the next key as "g <key>" for every binding. */
function watchG() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('keydown', (e) => {
    const combo = comboOf(e);
    if (!combo) return;
    // Esc leaves a text box (so single-key shortcuts work again) — unless the box has its own open list to close
    if (combo === 'escape' && typing(e.target) && !dialogOpen() && e.target.getAttribute?.('aria-expanded') !== 'true') {
      setTimeout(() => e.target.blur?.(), 0);
      return;
    }
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !dialogOpen();
    if (plain && combo === 'g') { pendingG = Date.now(); return; }
    if (plain && pendingG && Date.now() - pendingG < 1200) e.sensoperSeq = `g ${combo}`;
    pendingG = 0;
  }, true);
}

export function useHotkeys(bindings, deps = []) {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    watchG();
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      const combo = comboOf(e);
      if (!combo) return;
      const inBox = typing(e.target);
      const inDlg = dialogOpen();
      const seq = e.sensoperSeq || null;
      // "G Q" goes to Quotations; Q alone makes one. After G, a letter with no go-to does nothing.
      const want = seq || combo;
      for (const b of ref.current || []) {
        if (!b || b.disabled) continue;
        const keys = Array.isArray(b.keys) ? b.keys : [b.keys];
        if (!keys.includes(want)) continue;
        if (inBox && !b.inInput) continue;
        if (inDlg && !b.inDialog) continue;
        if (b.when && !b.when()) continue;
        e.preventDefault();
        b.run(e);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Every shortcut, for the help sheet. `page` = only on that page. */
export const GO_TO = [
  ['h', '/dashboard', 'Home'],
  ['l', '/dashboard/leads', 'Leads'],
  ['q', '/dashboard/quotations', 'Material quotations'],
  ['p', '/dashboard/projects', 'Projects'],
  ['s', '/dashboard/sales', 'Direct sales'],
  ['i', '/dashboard/inventory', 'Inventory'],
  ['r', '/dashboard/daily-report', 'Daily report'],
  ['a', '/dashboard/attendance', 'Attendance'],
  ['c', '/dashboard/calendar', 'Event calendar'],
  ['t', '/dashboard/support', 'Customer support'],
];

export const SHORTCUTS = [
  { group: 'Anywhere', items: [
    [[MOD, 'K'], 'Search everything — pages, leads, quotations, projects, stock'],
    [['N'], 'New lead'],
    [['Q'], 'New material quotation'],
    [['/'], 'Jump to the search box on this page'],
    [['?'], 'Show these shortcuts'],
    [['Esc'], 'Close a dialog or panel'],
  ] },
  { group: 'Go to (press G, then the letter)', items: GO_TO.map(([k, , label]) => [['G', k.toUpperCase()], label]) },
  { group: 'Leads page', items: [
    [['J'], 'Next lead'], [['K'], 'Previous lead'], [['Enter'], 'Open the lead'],
    [['B'], 'Switch between list and board'],
    [['C'], 'Log a call (lead open)'], [['W'], 'WhatsApp them (lead open)'], [['F'], 'Set the next follow-up (lead open)'],
    [[MOD, 'Enter'], 'Save the call or note you typed'],
  ] },
  { group: 'Quotation', items: [
    [['A'], 'Add an item'], [[MOD, 'S'], 'Save'], [[MOD, 'P'], 'Download the PDF'],
    [['↑', '↓', 'Enter'], 'Pick an item from the search list'],
  ] },
];
