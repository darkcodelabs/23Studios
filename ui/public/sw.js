/* 23 Studios service worker — SELF-UNREGISTER mode.
 *
 * Prior SW versions cached the SPA shell HTML with /assets/... absolute paths
 * from before the proxy-prefix rewriter shipped. Clients still running v17
 * serve stale HTML on every load, asset fetches hit CF Access redirect, 404.
 *
 * This version uninstalls itself + nukes every cache on activate, then has
 * no fetch handler. Browser native cache + server Cache-Control take over.
 * After every client passes through here once, no more stale-HTML loops.
 */
const VERSION = 'unregister-2026-05-19';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { c.navigate(c.url); } catch (_e) { /* ignore */ }
    }
  })());
});

// No fetch handler — browser handles every request natively.
