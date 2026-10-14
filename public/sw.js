/*
 * SavvyMoni offline support.
 * On install, caches the app shell (index.html and the scripts/styles it
 * references). Requests are network-first so updates arrive when online;
 * when the network fails, the cached copy is served. All calculations and
 * data live in the browser, so the app works fully offline once cached.
 * The AI assistant's /api/ requests are left alone: they need the network.
 */
const CACHE = 'savvymoni-v3';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch('./', { cache: 'no-store' });
      const html = await res.clone().text();
      await cache.put('./', res);
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));
      await Promise.all(assets.map((u) => cache.add(u).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only the app itself is cached. The assistant API is never cached or answered offline.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req.mode === 'navigate' ? './' : req, res.clone());
        return res;
      } catch {
        const hit = (await cache.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true })) ?? (await cache.match('./'));
        return hit ?? new Response('Offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })(),
  );
});
