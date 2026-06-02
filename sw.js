/* ══════════════════════════════════════════════════
   APTITUDE — Service Worker v3.7
   Strategy:
   · HTML  → Network-first (always gets latest deploy)
   · Assets → Cache-first  (fast repeat loads)
   · Offline → Falls back to cached index.html
══════════════════════════════════════════════════ */

const CACHE = 'aptitude-v3-7';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

/* ── INSTALL: pre-cache core shell ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  // Activate new SW immediately — don't wait for old tabs to close
  self.skipWaiting();
});

/* ── ACTIVATE: delete every old cache version ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

/* ── FETCH ── */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only intercept GET requests to our own origin
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // ── HTML: Network-first so deploys land immediately ──
  if (
    req.destination === 'document' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html')
  ) {
    event.respondWith(networkFirst(req));
    return;
  }

  // ── Everything else: Cache-first (fast) ──
  event.respondWith(cacheFirst(req));
});

/* ── Network-first: try network, fall back to cache ── */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    // Update cache with fresh response
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    // Offline fallback: serve index.html for any doc request
    return cached || await cache.match('/index.html');
  }
}

/* ── Cache-first: serve from cache, revalidate in background ── */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) {
    // Revalidate silently in background (stale-while-revalidate)
    fetch(req).then(fresh => {
      if (fresh && fresh.status === 200) cache.put(req, fresh);
    }).catch(() => {});
    return cached;
  }
  // Not cached — fetch and store
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

/* ── MESSAGE: allow app to force SW update ── */
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
