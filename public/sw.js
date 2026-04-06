const CACHE_NAME = 'tapmycar-v1';
const ASSETS = [
  '/',
  '/dashboard.html',
  '/signin.html',
  '/register.html',
  '/app.css',
  '/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(response => {
      return response || fetch(e.request);
    })
  );
});