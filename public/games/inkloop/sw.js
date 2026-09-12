/* The build replaces these constants with the exact production shell. Never
 * cache API/challenge replies, analytics, logs, or arbitrary external URLs. */
const CACHE = "inkloop-shell-44d671fe-ba1914eff598439b";
const FILES = ["/games/inkloop/","/games/inkloop/manifest.webmanifest","/games/inkloop/icons/apple-touch-icon.png","/games/inkloop/icons/icon-192.png","/games/inkloop/icons/icon-512.png","/games/inkloop/assets/index-C7tfLJKM.js","/games/inkloop/assets/index-CKhXQySa.css"];
const BASE = "/games/inkloop/";
const PREFIX = "inkloop-shell-44d671fe-";
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  // A newer build waits until old tabs close; no mid-match reload or asset swap.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key =>
    key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const shell = request.mode === 'navigate' && (url.pathname === BASE || url.pathname === BASE + 'index.html');
  const path = shell ? BASE : url.pathname;
  if (!FILES.includes(path)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(path);
    return cached || fetch(request);
  }));
});
