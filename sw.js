const STATIC_CACHE = "static-cache";
const RUNTIME_CACHE = "runtime-cache";

// Kern-Dateien, die offline laufen müssen:
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./game.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Diese Datei nehmen wir als "Update-Indikator":
const PROBE_URL = "./index.html"; // alternativ "./game.js"

// Hier speichern wir den zuletzt gesehenen ETag/Last-Modified im Cache
const META_KEY = "__meta__";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(CORE_ASSETS);
  })());
  // nicht sofort skipWaiting — wir aktivieren nach Update-Check gezielt
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Client -> SW Messages
self.addEventListener("message", (event) => {
  const t = event.data?.type;
  if (t === "CHECK_UPDATE") event.waitUntil(checkAndUpdate());
  if (t === "SKIP_WAITING") self.skipWaiting();
});

// Fetch rules:
// - HTML navigate: network-first (kurzer Timeout), sonst cache
// - JS/CSS: stale-while-revalidate
// - Rest: cache-first
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(networkFirst(req, 1500));
    return;
  }

  if (req.destination === "script" || req.destination === "style") {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function checkAndUpdate() {
  // 1) Online Probe holen (nur Header reichen, aber fetch liefert Response)
  const probe = await safeFetch(PROBE_URL, 1500, { method: "GET", cache: "no-store" });
  if (!probe?.ok) return; // offline oder server unreachable

  const etag = probe.headers.get("etag");
  const lastMod = probe.headers.get("last-modified");
  const sig = etag || lastMod || null;
  if (!sig) {
    // Falls GH Pages mal keine Header liefert: wir können trotzdem refreshen,
    // aber dann würden wir ggf. zu oft reloaden. -> abbrechen.
    return;
  }

  // 2) Alte Signatur aus Cache lesen
  const metaCache = await caches.open(RUNTIME_CACHE);
  const metaResp = await metaCache.match(META_KEY);
  const oldSig = metaResp ? await metaResp.text() : null;

  // 3) Wenn neu -> Core Assets frisch ziehen & Cache aktualisieren
  if (oldSig !== sig) {
    const staticCache = await caches.open(STATIC_CACHE);

    // Core Assets frisch holen (no-store, damit wirklich aktuell)
    for (const asset of CORE_ASSETS) {
      const fresh = await safeFetch(asset, 5000, { cache: "no-store" });
      if (fresh?.ok) await staticCache.put(asset, fresh.clone());
    }

    // neue Signatur speichern
    await metaCache.put(META_KEY, new Response(sig));

    // Clients informieren: Update bereit
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) c.postMessage({ type: "UPDATE_READY" });
  }
}

async function safeFetch(url, timeoutMs, init = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(t);
    return resp;
  } catch {
    return null;
  }
}

async function networkFirst(req, timeoutMs) {
  const cache = await caches.open(RUNTIME_CACHE);
  const fresh = await safeFetch(req.url, timeoutMs, { cache: "no-store" });
  if (fresh?.ok) {
    cache.put(req, fresh.clone());
    return fresh;
  }
  const cached = await cache.match(req) || await caches.match(req);
  return cached || new Response("Offline", { status: 503 });
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req) || await caches.match(req);

  const fetchPromise = safeFetch(req.url, 5000, { cache: "no-store" }).then((fresh) => {
    if (fresh?.ok) cache.put(req, fresh.clone());
    return fresh;
  });

  return cached || (await fetchPromise) || new Response("Offline", { status: 503 });
}

async function cacheFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req) || await caches.match(req);
  if (cached) return cached;

  const fresh = await safeFetch(req.url, 5000);
  if (fresh?.ok) {
    cache.put(req, fresh.clone());
    return fresh;
  }
  return new Response("Offline", { status: 503 });
}
