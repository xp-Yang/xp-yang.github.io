// This worker controls only this game. The build script fills the exact file list.
const CACHE_PREFIX = 'chain-game-assets-';
const CACHE_NAME = CACHE_PREFIX + '__CHAIN_CACHE_VERSION__';
const BASE = '/games/chain-game/';
const FILES = __CHAIN_CACHE_FILES__;
const IS_LOCAL_PREVIEW = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
  self.location.hostname,
);

self.addEventListener('install', (event) => {
  // Local previews must be able to replace the old cache-first worker without
  // closing every open game tab. Taking over never reloads the running page.
  event.waitUntil(
    IS_LOCAL_PREVIEW
      ? self.skipWaiting()
      : caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES)),
  );
  // Production updates still wait until all tabs using the old game have closed.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (
          name.startsWith(CACHE_PREFIX) &&
          (IS_LOCAL_PREVIEW || name !== CACHE_NAME)
        )
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(BASE)
  )
    return;
  if (IS_LOCAL_PREVIEW) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  if (event.request.mode !== 'navigate' && !FILES.includes(url.pathname))
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const key =
        event.request.mode === 'navigate' ? BASE + 'index.html' : url.pathname;
      return (await cache.match(key)) || fetch(event.request);
    })(),
  );
});
