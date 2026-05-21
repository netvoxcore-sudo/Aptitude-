/* ═══════════════════════════════════════════════════════════
   APTITUDE v3.0 — Service Worker
   Strategy: Cache-first (static) + Network-first (API/AI)
   Auth-aware: never caches login state or auth tokens
   ═══════════════════════════════════════════════════════════ */

const CACHE_VERSION   = 'aptitude-v3.0.0';
const STATIC_CACHE    = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE   = `${CACHE_VERSION}-dynamic`;
const ALL_CACHES      = [STATIC_CACHE, DYNAMIC_CACHE];

/* Assets pre-cached on install */
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=DM+Sans:ital,opsz,wght@0,9..40,300..900;1,9..40,300..900&family=Space+Grotesk:wght@400;500;700&display=swap',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

/* URLs that must NEVER be cached */
const NEVER_CACHE = [
  'generativelanguage.googleapis.com',  // Gemini AI — always fresh
  'accounts.google.com',                // Google OAuth
  'oauth2.googleapis.com',              // OAuth tokens
  '/logout',
  '/login',
  '/auth'
];

/* ── INSTALL ─────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(
        STATIC_ASSETS.filter(url => !url.startsWith('https://fonts') && !url.startsWith('https://cdn'))
      ))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Install cache partial fail:', err))
  );
});

/* ── ACTIVATE ────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(name => !ALL_CACHES.includes(name))
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── FETCH ───────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* 1. Skip non-GET requests entirely */
  if (request.method !== 'GET') return;

  /* 2. Skip never-cache URLs — always network */
  if (NEVER_CACHE.some(pattern => request.url.includes(pattern))) {
    event.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ error: 'Offline — AI Coach requires internet.' }),
        { headers: { 'Content-Type': 'application/json' }, status: 503 }
      ))
    );
    return;
  }

  /* 3. Skip cross-origin requests we don't control */
  if (url.origin !== self.location.origin &&
      !request.url.includes('fonts.googleapis.com') &&
      !request.url.includes('fonts.gstatic.com') &&
      !request.url.includes('cdn.jsdelivr.net') &&
      !request.url.includes('cdn.tailwindcss.com')) {
    return;
  }

  /* 4. Font & CDN requests — cache-first, long TTL */
  if (request.url.includes('fonts.googleapis.com') ||
      request.url.includes('fonts.gstatic.com') ||
      request.url.includes('cdn.jsdelivr.net') ||
      request.url.includes('cdn.tailwindcss.com')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  /* 5. HTML navigation — network-first with offline fallback */
  if (request.mode === 'navigate' ||
      request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  /* 6. Everything else — cache-first */
  event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
});

/* ── STRATEGIES ──────────────────────────────────────────── */

/**
 * Cache-first: serve from cache, fetch + update if missing.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

/**
 * Network-first: try network, fall back to cache, then offline page.
 */
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match('/offline.html');
    return offline || new Response(
      '<h1>Aptitude is offline</h1><p>Open the app again when connected.</p>',
      { headers: { 'Content-Type': 'text/html' }, status: 503 }
    );
  }
}

/**
 * Offline fallback based on request type.
 */
async function offlineFallback(request) {
  if (request.destination === 'document') {
    return caches.match('/offline.html') || new Response(
      '<h1>Aptitude is offline</h1>',
      { headers: { 'Content-Type': 'text/html' }, status: 503 }
    );
  }
  if (request.destination === 'image') {
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      { headers: { 'Content-Type': 'image/svg+xml' }, status: 200 }
    );
  }
  return new Response('', { status: 503 });
}

/* ── BACKGROUND SYNC (future-ready) ─────────────────────── */
self.addEventListener('sync', event => {
  if (event.tag === 'aptitude-sync') {
    event.waitUntil(syncPendingData());
  }
});

async function syncPendingData() {
  /* Aptitude stores all data in localStorage — no pending sync needed.
     This handler is reserved for future cloud sync feature. */
  console.log('[SW] Background sync triggered — local-only mode, nothing to push.');
}

/* ── PUSH NOTIFICATIONS (future-ready) ──────────────────── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json().catch(() => ({
    title: 'Aptitude',
    body: 'Time to check in on your goals.',
    icon: '/icons/icon-192.png'
  }));
  event.waitUntil(
    self.registration.showNotification(data.title || 'Aptitude', {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      tag: 'aptitude-notification',
      renotify: false,
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        const existing = windowClients.find(c => c.url === target && 'focus' in c);
        if (existing) return existing.focus();
        return clients.openWindow(target);
      })
  );
});

/* ── MESSAGE HANDLER ─────────────────────────────────────── */
self.addEventListener('message', event => {
  /* Force cache clear — called when user resets app data */
  if (event.data?.action === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => event.ports[0]?.postMessage({ success: true }))
    );
  }
  /* Skip waiting immediately — called after new SW detected */
  if (event.data?.action === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
