/* Hill-Climber Service Worker – B017 */
const CACHE = "hillclimber-B017";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll([
      "./",
      "./index.html",
      "./style.css",
      "./manifest.json",
      "./assets/Karosserie.PNG",
      "./assets/Rad.PNG",
      "./assets/Koerper.PNG",
      "./assets/Kopf.PNG",
    ])).catch(()=>{})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE) ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isNetworkFirst(url) {
  return url.pathname.endsWith("/index.html") ||
         url.pathname.endsWith("/game.js") ||
         url.pathname.endsWith("/style.css") ||
         url.pathname.endsWith("/manifest.json") ||
         url.pathname === new URL(self.registration.scope).pathname ||
         url.pathname.endsWith("/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isNetworkFirst(url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: false });
        return cached || caches.match("./index.html") || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: false });
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
