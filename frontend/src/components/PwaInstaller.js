import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Download, X } from 'lucide-react';

/**
 * Registers the service worker and renders an unobtrusive install prompt
 * when the browser fires `beforeinstallprompt`. Field-staff friendly.
 */
export default function PwaInstaller() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const onLoad = () => {
        navigator.serviceWorker.register('/service-worker.js').then((reg) => {
          // If a waiting SW exists (new deploy ready), tell it to skip waiting
          // so the new cache strategy / fresh code activates without needing
          // a manual hard-refresh from the user.
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        }).catch(() => { /* silent */ });
        // When the controller swaps to a new SW, reload once to pick up the new
        // bundle (only if user has already been controlled before — so first-time
        // visitors don't get a reload loop).
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });
      };
      window.addEventListener('load', onLoad);
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferred(e);
      // only show if not previously dismissed in this session
      if (!sessionStorage.getItem('pwa-install-dismissed')) setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (_) { /* ignore */ }
    setDeferred(null);
    setShow(false);
  };

  const dismiss = () => {
    setShow(false);
    sessionStorage.setItem('pwa-install-dismissed', '1');
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-[360px] z-[60] bg-white border border-emerald-200 rounded-xl shadow-xl p-4" data-testid="pwa-install-prompt">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
          <Download className="h-5 w-5 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">Install Sensoper</p>
          <p className="text-xs text-slate-500 mt-0.5">Add to your home screen for instant access and offline support in the field.</p>
          <div className="flex gap-2 mt-3">
            <Button onClick={install} className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1" data-testid="pwa-install-btn">
              <Download className="h-3.5 w-3.5" />Install
            </Button>
            <Button variant="ghost" onClick={dismiss} className="h-8 text-xs">Not now</Button>
          </div>
        </div>
        <button onClick={dismiss} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Close" data-testid="pwa-install-close">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
