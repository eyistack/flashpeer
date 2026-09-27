// FlashPeer Service Worker - Offline Shell, Share Target & Instant Loading
const CACHE_NAME = 'flashpeer-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/TermsOfService/',
  '/PrivacyPolicy/',
  '/FAQ/',
  '/manifest.webmanifest',
  '/manifest.json',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600&family=Roboto+Mono:wght@500;600&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Some cache assets failed during install:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// In-memory hold for shared files waiting for client claim
let pendingSharedFiles = null;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_SHARED_FILES') {
    if (pendingSharedFiles && pendingSharedFiles.length > 0) {
      event.source.postMessage({ type: 'SHARED_FILES', files: pendingSharedFiles });
      pendingSharedFiles = null;
    }
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Web Share Target POST
  if (event.request.method === 'POST' && url.searchParams.has('share-target')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const files = formData.getAll('files');
          pendingSharedFiles = files;
          
          // Redirect to home with query parameter
          const response = Response.redirect('/?shared=true', 303);
          
          // Also broadcast directly to any existing active clients
          setTimeout(async () => {
            const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const client of clients) {
              client.postMessage({ type: 'SHARED_FILES', files: files });
            }
          }, 400);

          return response;
        } catch (err) {
          return Response.redirect('/', 303);
        }
      })()
    );
    return;
  }

  // Only handle GET requests from here
  if (event.request.method !== 'GET') return;

  // Network-first for navigation, fallback to cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then((res) => res || caches.match('/index.html'));
      })
    );
    return;
  }

  // Stale-while-revalidate for assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
