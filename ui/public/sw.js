/* 23 Studios service worker — self-unregistering tombstone.
 *
 * The PWA SW caused more bugs than it solved (stale HTML through tunnel,
 * blob: image caching, no-op fetch handler overhead warnings). Strategy:
 *   1. install: skipWaiting
 *   2. activate: claim clients, delete every cache, then unregister self.
 *      Existing tabs reload to drop into a no-SW state.
 *
 * No fetch handler at all — Chrome stops flagging "no-op fetch handler".
 *
 * main.jsx no longer registers a SW. This file stays so already-installed
 * clients pick it up on next update check and self-destruct.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    try {
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) c.navigate(c.url);
    } catch (_e) { /* ignore */ }
  })());
});
