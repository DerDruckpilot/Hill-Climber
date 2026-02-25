
/* sw.js – BUILD B009
   Strategy:
   - Same-origin requests: NETWORK FIRST, then cache; offline: cache fallback.
   - This makes code/assets update automatically when online without manual version bumps.
*/

const CACHE = "hillclimb-cache"; // stable name; we rely on network-first for freshness
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./game.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Best-effort pre-cache (ignore failures)
    await Promise.allSettled(CORE.map(u => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isSameOrigin(req){
  try { return new URL(req.url).origin === self.location.origin; } catch { return false; }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  // For cross-origin (CDN matter.js), just pass through
  if (!isSameOrigin(req)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Network first
    try {
      const fresh = await fetch(req, { cache: "no-store" });
      // Cache successful responses
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      // Offline fallback
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;

      // If navigation, fallback to cached index
      if (req.mode === "navigate") {
        const idx = await cache.match("./index.html");
        if (idx) return idx;
      }
      throw e;
    }
  })());
});
