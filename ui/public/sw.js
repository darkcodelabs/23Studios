/* 23 Studios service worker.
 * Cache strategy:
 *   - HTML (index.html, SPA fallback): network-first, fallback to cache.
 *   - Hashed assets (/assets/*): cache-first, immutable (Vite hashes filename).
 *   - Icons + manifest: stale-while-revalidate.
 *   - /api/* and /ws/*: ALWAYS network, never cached (auth + CSRF + live data).
 * Bump CACHE_VERSION on every breaking change.
 */
const CACHE_VERSION = 'v9-2026-05-18-theme-surfaces';
const SHELL_CACHE = `studio-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `studio-assets-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
  // Don't precache much; index.html will be fetched on first nav.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isApi(u) {
  return u.pathname.startsWith('/api/') || u.pathname.startsWith('/ws/');
}
function isAsset(u) {
  return u.pathname.includes('/assets/');
}
function isShellNav(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only GET goes through cache logic.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Same-origin only; let cross-origin pass through untouched.
  if (url.origin !== self.location.origin) return;

  // Never cache the API or sockets.
  if (isApi(url)) return;

  if (isAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  if (isShellNav(req)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('shell', res.clone()).catch(() => {});
        return res;
      } catch (_e) {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match('shell');
        if (hit) return hit;
        return new Response('offline + no cached shell', { status: 503 });
      }
    })());
    return;
  }

  // Icons + manifest: stale-while-revalidate.
  if (/\/(icons\/|manifest\.webmanifest|favicon)/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      const fetcher = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => hit);
      return hit || fetcher;
    })());
  }
});
