/* 23 Studios service worker — pass-through NO-OP with cache nuke.
 *
 * Prior SW versions cached the SPA shell HTML with /assets/... absolute paths
 * from before the proxy-prefix rewriter shipped. Clients still running v17-v21
 * serve stale HTML on every load, asset fetches hit CF Access redirect, 404.
 *
 * Strategy:
 *   1. install: skipWaiting — new SW activates immediately, doesn't wait
 *      for existing tabs to close
 *   2. activate: clients.claim() so this SW controls all existing clients
 *      RIGHT NOW (not just future loads); then delete every cache
 *   3. fetch: ALWAYS network. No cache lookup, no respondWith branches that
 *      could fall back to stale content. Browser native cache + server
 *      Cache-Control take over.
 *
 * Effect: next page load, this SW intercepts every fetch and passes it
 * straight through to network. No more stale HTML, no more cached /assets
 * paths from the broken absolute-base era.
 */
const VERSION = 'passthrough-2026-05-19';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  })());
});

self.addEventListener('fetch', (event) => {
  // Don't intercept. Browser does default fetch. Server Cache-Control wins.
});
