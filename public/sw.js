const CACHE = 'pervootkryvateli-v0.33.1-home-refresh';
const ASSETS = [
  '/', '/styles.css', '/home-shell.css', '/app.js', '/manifest.webmanifest',
  '/assets/home-background.webp', '/assets/home-logo.png',
  '/assets/map-base-4096.webp', '/assets/map.png', '/assets/icon-192.png', '/assets/icon-512.png',
  '/assets/avatars/avatar-01.png', '/assets/avatars/avatar-02.png', '/assets/avatars/avatar-03.png', '/assets/avatars/avatar-04.png', '/assets/avatars/avatar-05.png',
  '/assets/avatars/avatar-06.jpg', '/assets/avatars/avatar-07.png', '/assets/avatars/avatar-08.png', '/assets/avatars/avatar-09.png', '/assets/avatars/avatar-10.png'
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
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  event.respondWith(fetch(req).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
    return response;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('/'))));
});
