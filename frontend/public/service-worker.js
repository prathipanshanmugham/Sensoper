/* Sensoper PWA Service Worker — v1
 * Strategy:
 *  - Cache static assets (CSS/JS/fonts/images) cache-first.
 *  - Network-first for navigation (HTML), with offline.html fallback.
 *  - DO NOT cache /api/* responses to keep auth/session fresh & private.
 *  - Background-sync queue for failed POST/PUT to /api/readings & /api/accounts so field staff can work offline.
 */

const VERSION = 'v1.0.0';
const STATIC_CACHE = `sensoper-static-${VERSION}`;
const RUNTIME_CACHE = `sensoper-runtime-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const QUEUE_DB = 'sensoper-offline-queue';
const QUEUE_STORE = 'requests';

const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![STATIC_CACHE, RUNTIME_CACHE].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Allow page to instruct SW to clear cache (called on logout)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// IndexedDB helpers for offline queue
function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueRequest(request) {
  try {
    const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.clone().text();
    const db = await openQueueDB();
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).add({
      url: request.url,
      method: request.method,
      headers: [...request.headers.entries()],
      body,
      queuedAt: Date.now(),
    });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    if (self.registration.sync) {
      try { await self.registration.sync.register('sensoper-sync'); } catch (_) { /* ignore */ }
    }
  } catch (e) { /* swallow — best-effort queue */ }
}

async function flushQueue() {
  try {
    const db = await openQueueDB();
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const all = await new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const item of all) {
      try {
        const resp = await fetch(item.url, { method: item.method, headers: new Headers(item.headers), body: item.body, credentials: 'include' });
        if (resp.ok || (resp.status >= 400 && resp.status < 500)) {
          // Drop on success or permanent client error
          store.delete(item.id);
        }
      } catch (_) { /* keep for next retry */ }
    }
  } catch (_) { /* ignore */ }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sensoper-sync') {
    event.waitUntil(flushQueue());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Skip cross-origin and non-GET except for queueable mutations
  const isApi = url.pathname.startsWith('/api/');
  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);

  // 1) API mutations to readings/accounts → try network, queue on failure
  if (isApi && isMutation && (url.pathname.startsWith('/api/readings') || url.pathname.startsWith('/api/accounts'))) {
    event.respondWith(
      fetch(req.clone()).catch(async () => {
        await enqueueRequest(req);
        return new Response(JSON.stringify({ queued: true, message: 'Saved offline. Will sync when online.' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 2) All other API calls → network-only (no cache to keep auth fresh)
  if (isApi) {
    return; // browser default
  }

  // 3) Navigation (HTML) → network first, fallback to offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // 4) Static assets → cache first, then network
  if (req.method === 'GET' && (req.destination === 'script' || req.destination === 'style' || req.destination === 'font' || req.destination === 'image')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(OFFLINE_URL)))
    );
  }
});
