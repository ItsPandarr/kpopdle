// Tiny stale-while-revalidate service worker. Lets the game work offline
// after first load and survive reloads with no network.
//
// Strategy:
//   - On install: claim immediately so reload boots the new SW without a
//     two-reload limbo.
//   - On fetch (GET only): respond from the cache if present, kick off a
//     background fetch to update the cache. Falls back to network when there
//     is no cached copy yet.
//
// Bumping VERSION purges old caches on activate.

// Bump this whenever a shipped JS/CSS module changes — old caches get pruned
// in `activate`, so users see fresh code on the next reload after the SW
// updates. Without a bump, stale-while-revalidate keeps the old version.
const VERSION = "kpopdle-v11";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Don't cache cross-origin (Wikipedia etc.) — let the browser handle them.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached); // offline, fall back to whatever's cached
      return cached || networkPromise;
    })(),
  );
});
