const CACHE = 'pervootkryvateli-v0.17-static';
const ASSETS = [
  '/', '/styles.css', '/app.js', '/manifest.webmanifest',
  '/assets/map.png', '/assets/icon-192.png', '/assets/icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/socket.io/')) return;
  event.respondWith(fetch(req).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
    return response;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('/'))));
});
