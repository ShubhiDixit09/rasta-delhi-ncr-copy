/* Ghar Tak service worker: app shell offline, fast repeat loads, never stale data. */
const VERSION = "ghartak-v1";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const TILES = `${VERSION}-tiles`;
const MAX_TILES = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(["/", "/offline.html", "/icons/logo.svg", "/icons/icon-192.png"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages: network first so content is current; the cached home page or the offline page if not.
  if (req.mode === "navigate") {
    if (url.pathname.startsWith("/admin")) return; // never cache the admin page
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (url.pathname === "/") caches.open(SHELL).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(async () => (await caches.match("/")) || caches.match("/offline.html")),
    );
    return;
  }

  // Hashed build assets never change: cache first.
  if (url.origin === location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/"))) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(STATIC).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
    return;
  }

  // Map tiles, styles and fonts: show cached instantly, refresh in the background.
  if (url.hostname === "tiles.openfreemap.org") {
    event.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req);
        const fresh = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone()).then(() => trim(TILES, MAX_TILES));
          return res;
        }).catch(() => hit);
        return hit || fresh;
      }),
    );
  }
  // Everything else (routes, scores, search, feedback, admin) always goes to the network.
});
