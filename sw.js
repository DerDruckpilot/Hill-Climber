/* Hill-Climber Service Worker (stable, self-updating content cache)
   Goal: You update files on GitHub (game.js/assets/etc) WITHOUT bumping sw.js each time.
   Strategy:
   - Network-first (with cache:'no-cache') for HTML/JS/CSS/Assets
   - Update runtime cache in background
   - Offline fallback to cached responses
*/
'use strict';

const CACHE = 'hillclimber-runtime-v1';
const CORE_URLS = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.json'
];

// Helper: treat as "same-origin static" we want to keep fresh
const isSameOrigin = (url) => url.origin === self.location.origin;

const isNavigation = (req) => req.mode === 'navigate' ||
  (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html'));

const isAsset = (pathname) => (
  pathname.endsWith('.js') ||
  pathname.endsWith('.css') ||
  pathname.endsWith('.png') ||
  pathname.endsWith('.jpg') ||
  pathname.endsWith('.jpeg') ||
  pathname.endsWith('.webp') ||
  pathname.endsWith('.svg') ||
  pathname.endsWith('.json') ||
  pathname.endsWith('.mp3') ||
  pathname.endsWith('.wav')
);

// Network-first with "no-cache" to revalidate against GitHub Pages/CDN
async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  // Force revalidation; does NOT bypass SW, but bypasses HTTP cache.
  const noCacheReq = new Request(request, { cache: 'no-cache' });

  try {
    const fresh = await fetch(noCacheReq);

    // Cache only OK same-origin GET
    if (request.method === 'GET' && fresh && fresh.ok) {
      try { await cache.put(request, fresh.clone()); } catch (_) {}
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

// Stale-while-revalidate (for non-critical)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });

  const fetchPromise = fetch(new Request(request, { cache: 'no-cache' }))
    .then((fresh) => {
      if (request.method === 'GET' && fresh && fresh.ok) {
        cache.put(request, fresh.clone()).catch(()=>{});
      }
      return fresh;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || Response.error();
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Prime core (best effort). Missing files won't break install.
    await Promise.all(CORE_URLS.map(async (u) => {
      try { await cache.add(u); } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Cleanup older caches
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

// Allow page to force immediate activation
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't mess with cross-origin (e.g. jsdelivr/matter-js)
  if (!isSameOrigin(url)) return;

  // Navigation: always network-first to pick up latest index.html
  if (isNavigation(req)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Static assets: network-first for fastest update propagation, offline fallback
  if (isAsset(url.pathname)) {
    // For game.js in particular, prefer strict network-first.
    if (url.pathname.endsWith('/game.js') || url.pathname.endsWith('game.js')) {
      event.respondWith(networkFirst(req));
    } else {
      // Other assets: stale-while-revalidate feels snappier
      event.respondWith(staleWhileRevalidate(req));
    }
    return;
  }

  // Default: try SWR
  event.respondWith(staleWhileRevalidate(req));
});
