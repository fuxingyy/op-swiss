// sw.js — GitHub Pages friendly, update-safe
// v6: Network-first for navigation so users don't get stuck on old index.html

const CACHE = "op-swiss-cache-v6";
const ASSETS = [
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.webmanifest",
];

// Install: cache only static assets (NOT index.html, NOT app.js)
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

// Activate: delete old caches + take control immediately
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  const isNavigation = req.mode === "navigate";
  const isAsset =
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith(".json");

  // ✅ Navigation: NETWORK FIRST (always try to get fresh index.html)
  if (isNavigation) {
    event.respondWith((async () => {
      try {
        // important: no-store so browser doesn't serve a cached HTML
        return await fetch(req, { cache: "no-store" });
      } catch {
        // offline fallback: try cached root or any cached html
        const cached = await caches.match("./");
        return cached || Response.error();
      }
    })());
    return;
  }

  // ✅ Assets: stale-while-revalidate (fast + updates in background)
  if (isAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req).then((fresh) => {
        cache.put(req, fresh.clone());
        return fresh;
      }).catch(() => null);

      // return cache immediately if exists, else wait for network
      return cached || (await fetchPromise) || Response.error();
    })());
    return;
  }

  // Default: just pass through
  event.respondWith(fetch(req));
});
