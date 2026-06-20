/* =============================================================
   SERVICE WORKER — Pocket Coach
   Cache-first for the app shell; network-first for API calls.
   Queues failed POST/PUT requests for background sync.
   Version bump to force cache refresh on each deploy.
   ============================================================= */

const CACHE_VERSION = 'pocket-coach-v3';
const CACHE_STATIC  = `${CACHE_VERSION}-static`;
const CACHE_API     = `${CACHE_VERSION}-api`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/ProgramTab.css',
  '/offline.js',
  // CSS modules
  '/css/tokens.css',
  '/css/base.css',
  '/css/nav.css',
  '/css/onboarding.css',
  '/css/tutorial.css',
  '/css/sleep.css',
  '/css/tabs.css',
  '/css/home.css',
  '/css/log.css',
  '/css/training-mode.css',
  '/css/ui-declutter.css',
  '/css/features.css',
  '/css/community-share.css',
  '/css/archetype-features.css',
  '/css/cardio.css',
  '/css/coaching.css',
  '/css/powerlifting.css',
  '/css/progress.css',
  '/css/ai-coach.css',
  '/css/checkin.css',
  // JS modules
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
  '/src/js/crossfit.js',
  '/src/js/community-feed.js',
  '/src/js/today-program.js',
  '/src/js/session-context.js',
  '/src/js/programs.js',
  '/src/js/workout-archiver.js',
  '/src/js/archetype-features.js',
  '/src/js/native-ui.js',
  '/src/js/coaching-enhanced.js',
  '/src/js/settings.js',
  '/src/js/mobility.js',
  '/src/js/ai-coach.js',
  '/src/js/archetype-config.js',
  '/src/js/friends.js',
  '/css/friends.css',
];

/* ── Install: pre-cache app shell ─────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
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
          .filter((k) => k.startsWith('pocket-coach-') && k !== CACHE_STATIC && k !== CACHE_API)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch strategy ───────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST/PUT handled by offline queue in main thread)
  if (request.method !== 'GET') return;

  // API GET requests: network-first, fall back to cached response
  if (url.pathname.startsWith('/api/') || url.origin !== location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.origin !== location.origin) {
            const clone = response.clone();
            caches.open(CACHE_API).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      // Return cached immediately, but also update in background (stale-while-revalidate)
      const fetchPromise = fetch(request).then((response) => {
        if (
          response.ok &&
          (url.pathname.endsWith('.js') ||
           url.pathname.endsWith('.css') ||
           url.pathname.endsWith('.html') ||
           url.pathname.endsWith('.ico') ||
           url.pathname.endsWith('.json') ||
           url.pathname === '/')
        ) {
          const clone = response.clone();
          caches.open(CACHE_STATIC).then((c) => c.put(request, clone));
        }
        return response;
      }).catch(() => null);

      if (cached) {
        // Stale-while-revalidate: serve cached, update in background
        fetchPromise; // fire-and-forget
        return cached;
      }

      // No cache — wait for network
      return fetchPromise.then((resp) => {
        if (resp) return resp;
        // Last resort: serve index.html for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

/* ── Background sync ──────────────────────────────────────── */

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-queue') {
    event.waitUntil(_notifyClients());
  }
});

async function _notifyClients() {
  const clients = await self.clients.matchAll();
  clients.forEach((c) => c.postMessage({ type: 'SYNC_READY' }));
}

/* ── Push notification placeholder ────────────────────────── */

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
