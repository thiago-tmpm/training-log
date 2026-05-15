const CACHE_NAME = 'training-log-v4';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './exercises.js',
  './db.js',
  './app.js',
  './workout.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install: cache assets individually so one failure doesn't abort everything
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      const promises = ASSETS.map(url =>
        cache.add(url).catch(err => {
          console.error('SW: failed to cache', url, err);
        })
      );
      return Promise.all(promises);
    })
    .then(() => {
      console.log('SW: install complete');
      return self.skipWaiting();
    })
    .catch(err => console.error('SW: install failed', err))
  );
});

// Activate: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => {
      console.log('SW: activated');
      return self.clients.claim();
    })
  );
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});
