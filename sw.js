/* ═══════════════════════════════════════════════════════
   Aptitude v3.2 — Service Worker
   Strategy: Cache-first for assets, network-first for HTML
   Cache name versioned so old caches are purged on update
═══════════════════════════════════════════════════════ */

const CACHE_NAME   = 'aptitude-v3.2';
const RUNTIME      = 'aptitude-runtime-v3.2';
const OFFLINE_URL  = '/';

/* Assets to pre-cache on install */
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=DM+Sans:ital,opsz,wght@0,9..40,300..900;1,9..40,300..900&family=Space+Grotesk:wght@400;500;700&display=swap'
];

/* ── INSTALL: pre-cache core assets ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache partial fail (expected for CDN):', err))
  );
});

/* ── ACTIVATE: purge stale caches ── */
self.addEventListener('activate', event => {
  const allowedCaches = [CACHE_NAME, RUNTIME];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !allowedCaches.includes(key))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── FETCH: smart caching strategy ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Skip non-GET and chrome-extension requests */
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  /* HTML pages: Network-first, fallback to cache */
  if (request.mode === 'navigate' || request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  /* Google Fonts & CDN: Cache-first, network fallback */
  if (
    url.origin.includes('fonts.googleapis.com') ||
    url.origin.includes('fonts.gstatic.com') ||
    url.origin.includes('cdn.tailwindcss.com') ||
    url.origin.includes('cdn.jsdelivr.net') ||
    url.origin.includes('i.ibb.co')
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  /* Everything else: Stale-while-revalidate */
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(RUNTIME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

/* ── BACKGROUND SYNC: queue failed writes (future use) ── */
self.addEventListener('sync', event => {
  if (event.tag === 'aptitude-sync') {
    console.log('[SW] Background sync triggered');
  }
});

/* ── PUSH NOTIFICATIONS (stub — activate when backend ready) ── */
self.addEventListener('push', event => {
  const data = event.data?.json() || { title: 'Aptitude', body: 'Time to check in!' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://i.ibb.co/pjNb2Mvh/IMG-20260524-094005.png',
      badge: 'https://i.ibb.co/pjNb2Mvh/IMG-20260524-094005.png',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(wins => {
      const target = event.notification.data?.url || '/';
      const existing = wins.find(w => w.url === target);
      if (existing) return existing.focus();
      return clients.openWindow(target);
    })
  );
});
