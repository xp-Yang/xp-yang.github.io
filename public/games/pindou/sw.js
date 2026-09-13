// Generated together with this exact release. Keep old clients on their existing version until closed.
const FILES=["index.html","manifest.webmanifest","src/app.js","src/assets.js","src/auto-colors.js","src/auto-plan-worker.js","src/auto-playback.js","src/chart-levels.js","src/engine.js","src/level3.js","src/level4.js","src/level8.js","src/level9.js","src/levels.js","src/mobile.js","src/portrait-colors.js","src/quality.js","src/refill-auto.js","src/render.js","src/runtime.js","src/sound.js","src/staged-auto.js","src/style.css","src/test-mode.js","src/viewport.js","assets/settings.png","assets/energy.png","assets/coin.png","assets/close.png","assets/start-button.png","assets/free.png","assets/pattern-1.png","assets/pattern-2.png","assets/pattern-3.png","assets/pattern-4.png","assets/pattern-5.png","assets/pattern-6.png","assets/pattern-7.png","assets/pattern-8.png","assets/pattern-9.png","assets/background.png","assets/trophy.png","assets/clock.png","assets/hand.png","assets/win-title.png","assets/rewards.png","assets/double-button.png","assets/pig.png","assets/entry-dialog.png","assets/load.png","assets/pick.wav","assets/place.wav","assets/win.wav","assets/apple-touch-icon.png","assets/app-icon-192.png","assets/app-icon-512.png"],BASE=new URL('./',self.location.href),PREFIX='pindou-ios-'+encodeURIComponent(BASE.pathname)+'-',VERSION=PREFIX+"d592033d2835501d";
const urls=FILES.map(path=>new URL(path,BASE).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(urls))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==VERSION).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==BASE.origin)return;
  const key=request.mode==='navigate'&&url.pathname.startsWith(BASE.pathname)?new URL('index.html',BASE).href:url.href;
  if(!urls.includes(key))return;
  event.respondWith(caches.open(VERSION).then(cache=>cache.match(key)).then(cached=>cached||fetch(request)));
});
