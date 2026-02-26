/* Mini Hill Climb SW – self-updating without version bumps
   Strategy: network-first with cache fallback, and always revalidate for same-origin assets.
*/
const CACHE = "mhc-cache-v1";
const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./game.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./assets/Karosserie.PNG",
  "./assets/Rad.PNG",
  "./assets/Koerper.PNG",
  "./assets/Kopf.PNG",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

async function networkThenCache(request) {
  const cache = await caches.open(CACHE);
  try {
    const netReq = new Request(request, { cache: "no-store" });
    const res = await fetch(netReq);
    if (res && res.ok) cache.put(request, res.clone()).catch(()=>{});
    return res;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkThenCache(req));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone()).catch(()=>{});
      return res;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
