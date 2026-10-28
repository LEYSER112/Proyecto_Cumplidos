const CACHE = 'cumplidos-v2';
const PRECACHE = ['./', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Si algún archivo falla, la instalación del service worker no debe romperse.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))));
});
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./'))));
});
