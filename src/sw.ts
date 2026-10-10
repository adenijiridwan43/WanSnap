// src/sw.ts
//
// Service worker for WanSnap.
//
// Caching strategy is deliberately split by cost:
//
//   - App shell (HTML/JS/CSS): cache-first. The build is content-hashed, so a
//     changed file simply lands under a new URL and the old entry is replaced.
//   - FFmpeg core: deliberately NOT precached. It is ~30 MB, and most visits
//     never process a video. Fetching it on demand keeps the install light.
//   - Everything else: network-first with a cache fallback.
//
// Bump CACHE_VERSION to invalidate everything on the next activation.

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `wansnap-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `wansnap-runtime-${CACHE_VERSION}`;

const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'];

// Never intercept these: they must always reflect the current build.
const BYPASS = ['/@vite', '/@react-refresh', '/@id', '/src/', '/__vite'];

function isBypass(url: string): boolean {
  return BYPASS.some((prefix) => url.startsWith(prefix));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((error) => {
        // A failed precache must not block installation; runtime caching still works.
        console.warn('[sw] shell precache incomplete:', error);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('wansnap-') && !key.endsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle our own origin; COOP/COEP would block cross-origin responses
  // anyway, and the app makes no third-party requests by design.
  if (url.origin !== self.location.origin) return;
  if (isBypass(url.pathname)) return;

  // The 30MB core is large and rarely needed: never put it in a cache that is
  // consulted on every load.
  const isFfmpegCore = url.pathname.includes('/ffmpeg/');

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          return cached ?? Response.error();
        })
    );
    return;
  }

  if (isFfmpegCore) {
    event.respondWith(fetch(request));
    return;
  }

  // Content-hashed build output: cache-first, then network, then store.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request)
          .then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => caches.match('/index.html').then((fallback) => fallback ?? Response.error()))
    )
  );
});

export {};