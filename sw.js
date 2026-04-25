/* =============================================================
   SERVICE WORKER — Pocket Coach
   Cache-first for the app shell; network-first for API calls.
   Version bump to force cache refresh on each deploy.
   ============================================================= */

const CACHE_VERSION = 'pocket-coach-v1';
const CACHE_STATIC  = `${CACHE_VERSION}-static`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/features.css',
  '/css/ui-declutter.css',
  '/ProgramTab.css',
  '/src/js/ui-declutter.js',
  '/src/js/pr-tracker.js',
  '/src/js/workout-intelligence.js',
  '/src/js/body-measurements.js',
  '/src/js/readiness-checkin.js',
  '/src/js/data-export.js',
  '/src/js/food-database.js',
  '/src/js/weekly-summary.js',
  '/src/js/challenges.js',
  '/src/js/client-checkins.js',
  '/src/js/progress-report.js',
  '/src/js/ProgramTabV2.js',
  '/src/js/programBuilderV2Core.js',
];

/* ── Install: pre-cache app shell ─────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      // addAll fails if any request fails — use individual adds for resilience
      return Promise.allSettled(
        APP_SHELL.map((url) => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: clean old caches ───────────────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('pocket-coach-') && k !== CACHE_STATIC)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first for app shell, network-first for API */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Always hit the network for external API calls (USDA, Airtable, etc.)
  if (url.origin !== location.origin) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for same-origin static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // Only cache successful GET responses for same-origin assets
        if (
          response.ok &&
          request.method === 'GET' &&
          (url.pathname.endsWith('.js') ||
           url.pathname.endsWith('.css') ||
           url.pathname.endsWith('.html') ||
           url.pathname.endsWith('.ico') ||
           url.pathname === '/')
        ) {
          const clone = response.clone();
          caches.open(CACHE_STATIC).then((c) => c.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: serve index.html for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

/* ── Background sync: queue failed Airtable writes ──────── */

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-workout-data') {
    event.waitUntil(_flushOfflineQueue());
  }
});

async function _flushOfflineQueue() {
  // Offline queue is managed by the main thread via localStorage.
  // When back online, the main app will detect connectivity and retry.
  // This event just signals the app to do so.
  const clients = await self.clients.matchAll();
  clients.forEach((c) => c.postMessage({ type: 'SYNC_READY' }));
}
