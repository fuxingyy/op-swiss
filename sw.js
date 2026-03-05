// sw.js — Network-first for HTML/JS so updates show immediately
const CACHE = "op-swiss-cache-v3"; // <-- cambia v3 a v4/v5 cuando quieras forzar update manual

const CORE = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./logo.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting(); // ✅ activa el nuevo SW de una
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // ✅ borra caches viejos
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));
    await self.clients.claim(); // ✅ controla tabs abiertas ya
  })());
});

// Network-first for navigations + js/css/json
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo nuestro site
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname.endsWith("/op-swiss/");
  const isAppAsset =
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".ico");

  // ✅ Para HTML y assets importantes: NETWORK FIRST
  if (isHTML || isAppAsset) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  // default
  event.respondWith(caches.match(req).then((res) => res || fetch(req)));
});
