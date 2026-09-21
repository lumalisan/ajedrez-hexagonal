/* global self, caches, fetch, Response, URL */

// Vite replaces these markers with the completed build's version and asset list.
const CACHE_PREFIX = 'protocolo-hexagonal-';
const CACHE = `${CACHE_PREFIX}__BUILD_VERSION__`;
const BUILD_ASSETS = ['__BUILD_ASSETS__'];
const RULE_IMAGES = Array.from({ length: 25 }, (_, index) => `/rules/image${index + 5}.png`);
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/atlas-mark.svg',
  ...RULE_IMAGES,
];
const PRECACHE_URLS = new Set(
  [...SHELL, ...BUILD_ASSETS].map((path) => new URL(path, self.location.origin).href),
);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...PRECACHE_URLS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
        return response;
      } catch {
        // Precached static files have one representation, including when hosts vary by Origin.
        const cached = await cache.match(event.request, {
          ignoreVary: PRECACHE_URLS.has(event.request.url),
        });
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const shell = await cache.match('/');
          if (shell) return shell;
        }
        return Response.error();
      }
    })(),
  );
});
