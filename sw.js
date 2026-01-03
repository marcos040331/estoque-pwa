const CACHE_NAME = "estoque-pro-cache-v2";
const ASSETS = ["./","./index.html","./style.css","./app.js","./manifest.json","./icon-192.png","./icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k!==CACHE_NAME ? caches.delete(k) : Promise.resolve()))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    if (e.request.method==="GET" && res && res.status===200){
      const clone = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
    }
    return res;
  }).catch(() => caches.match("./index.html"))));
});
