/* ═══════════════════════════════════════════════════════
   Aptitude — Service Worker v3.6
   Strategy: Network-first with offline fallback cache
   Author: NetVox Core / Arthur Vance
═══════════════════════════════════════════════════════ */

const CACHE_NAME   = 'aptitude-v3-6';
const OFFLINE_URL  = 'aptitude_v3_6.html';

/* Assets to pre-cache on install */
const PRECACHE_ASSETS = [
  'aptitude_v3_6.html',
  'manifest.json',
  'sw.js'
];

/* ── Install: pre-cache shell ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache failed:', err))
  );
});

/* ── Activate: purge old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: Network-first, fall back to cache ── */
self.addEventListener('fetch', event => {
  /* Only handle GET requests */
  if (event.request.method !== 'GET') return;

  /* Skip cross-origin requests (CDN fonts, analytics, etc.) */
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        /* Cache a fresh copy for offline use */
        if (networkResponse && networkResponse.status === 200) {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return networkResponse;
      })
      .catch(() => {
        /* Network failed — serve from cache */
        return caches.match(event.request)
          .then(cached => {
            if (cached) return cached;
            /* Last resort: serve the app shell for navigation requests */
            if (event.request.mode === 'navigate') {
              return caches.match(OFFLINE_URL);
            }
            return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
          });
      })
  );
});

/* ── Message: force update from client ── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
