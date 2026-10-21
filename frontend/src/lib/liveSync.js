/* Live refresh. One small poll for the whole app: GET /api/sync/version every 15 s while the app is on screen,
 * and straight away when it comes back to the front. When an area someone changed ("projects", "inventory",
 * "amc", …) has a new number, every screen showing that area reloads itself — no refresh button needed.
 *
 *   useLiveRefresh(['projects', 'approvals'], load)        // reload when those areas change
 *   useLiveRefresh(['projects'], () => setStale(true))     // or just tell the person, e.g. while they edit */
import { useEffect, useRef } from 'react';
import { syncAPI } from '../utils/api';

const POLL_MS = 15000;
const listeners = new Set();
let versions = null;          // last seen {topic: v}
let timer = null;
let inFlight = false;
let lastLocalSave = 0;
if (typeof window !== 'undefined') window.addEventListener('sensoper:saved', () => { lastLocalSave = Date.now(); });

/** True when this tab saved something in the last few seconds (so a change is probably ours). */
export const savedHereRecently = (ms = 5000) => Date.now() - lastLocalSave < ms;

async function poll() {
  if (inFlight || document.visibilityState === 'hidden') return;
  inFlight = true;
  try {
    const { topics } = (await syncAPI.version()).data || {};
    const next = Object.fromEntries(Object.entries(topics || {}).map(([k, t]) => [k, t.v]));
    if (versions) {
      const changed = Object.keys(next).filter((k) => next[k] !== versions[k]);
      if (changed.length) listeners.forEach((l) => { if (l.topics.some((t) => changed.includes(t))) l.fire(changed); });
    }
    versions = next;
  } catch { /* offline or signed out — try again next time */ } finally { inFlight = false; }
}

function start() {
  if (timer) return;
  poll();
  timer = setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('focus', onShow);
  window.addEventListener('online', onShow);
  window.addEventListener('sensoper:saved', onSaved);
}
function stop() {
  clearInterval(timer); timer = null; versions = null;
  document.removeEventListener('visibilitychange', onShow);
  window.removeEventListener('focus', onShow);
  window.removeEventListener('online', onShow);
  window.removeEventListener('sensoper:saved', onSaved);
}
function onShow() { if (document.visibilityState !== 'hidden') poll(); }
function onSaved() { setTimeout(poll, 600); }

/** Call `onChange(changedTopics)` (at most once a second) whenever one of `topics` changes on the server. */
export function useLiveRefresh(topics, onChange, { enabled = true } = {}) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = (topics || []).join(',');
  useEffect(() => {
    if (!enabled || !key) return undefined;
    let last = 0;
    let pending = null;
    const l = {
      topics: key.split(','),
      fire: (changed) => {
        const wait = Math.max(0, 1000 - (Date.now() - last));
        clearTimeout(pending);
        pending = setTimeout(() => { last = Date.now(); cb.current?.(changed); }, wait);
      },
    };
    listeners.add(l);
    start();
    return () => { clearTimeout(pending); listeners.delete(l); if (!listeners.size) stop(); };
  }, [key, enabled]);
}
