/* =============================================================
   SERVICE WORKER — Pocket Coach
   Cache-first for the app shell; network-first for API calls.
   Queues failed POST/PUT requests for background sync.
   Version bump to force cache refresh on each deploy.
   ============================================================= */

const CACHE_VERSION = 'pocket-coach-v106';
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
  '/css/login.css',
  '/public/icons/login-logo.jpg',
  '/public/icons/plate.jpg', // logbook cover on the opening screen
  '/css/onboarding.css',
  '/css/tutorial.css',
  '/css/next-step-chips.css',
  '/css/overload-win.css',
  '/css/guide.css',
  '/css/history-import.css',
  '/css/habit.css',
  '/css/coach-guide.css',
  '/css/onboarding-cover.css',
  '/css/sleep.css',
  '/css/tabs.css',
  '/css/home.css',
  '/css/log.css',
  '/css/logbook-cover.css',
  '/css/training-mode.css',
  '/css/ui-declutter.css',
  '/css/features.css',
  '/css/weekly-recap.css',
  '/css/calendar-sync.css',
  '/css/community-share.css',
  '/css/social-ui.css',
  '/css/archetype-features.css',
  '/css/cardio.css',
  '/css/coaching.css',
  '/css/coach-videos.css',
  '/css/powerlifting.css',
  '/css/progress.css',
  '/css/ai-coach.css',
  '/css/checkin.css',
  '/css/performance-mode.css',
  // JS modules
  '/src/js/ui-declutter.js',
  '/src/js/pr-tracker.js',
  '/src/js/workout-intelligence.js',
  '/src/js/warmup-sets.js',
  '/src/js/live-activity.js',
  '/src/js/home-widget.js',
  '/src/js/body-measurements.js',
  '/src/js/readiness-checkin.js',
  '/src/js/data-export.js',
  '/src/js/food-core.js',
  '/src/js/meal-timing-core.js',
  '/src/js/meal-photos.js',
  '/src/js/speech-input.js',
  '/src/js/food-database.js',
  '/src/js/food-barcode.js',
  '/src/js/food-log-tools.js',
  '/src/js/meal-timing.js',
  '/src/js/food-describe.js',
  '/src/js/nutrition-insights.js',
  '/src/js/nutrition-review.js',
  '/src/js/weekly-summary.js',
  '/src/js/weekly-recap.js',
  '/src/js/challenges.js',
  '/src/js/progress-report.js',
  '/src/js/plan-preview.js',
  '/src/js/plan-today.js',
  '/src/js/coach-announce.js',
  '/src/js/coach-meals.js',
  '/src/js/my-plan.js',
  '/src/js/ProgramTabV2.js',
  '/src/js/programBuilderV2Core.js',
  '/src/js/premium-library.js',
  '/src/js/plan-limits.js',
  '/src/js/program-import-core.js',
  '/src/js/program-import.js',
  '/css/library.css',
  '/src/js/community-feed.js',
  '/src/js/social-ui.js',
  '/src/js/program-schedule.js',
  '/src/js/usual-session.js',
  '/src/js/today-session.js',
  '/src/js/exercise-videos.js',
  '/src/js/today-program.js',
  '/src/js/calendar-sync.js',
  '/src/js/time-budget-core.js',
  '/src/js/session-efficiency.js',
  '/src/js/performance-mode.js',
  '/src/js/session-context.js',
  '/src/js/app-tour.js',
  '/src/js/programs.js',
  '/src/js/workout-archiver.js',
  '/src/js/workout-sync.js',
  '/src/js/cloud-sync.js',
  '/src/js/archetype-features.js',
  '/src/js/functional-core.js',
  '/src/js/functional.js',
  '/src/js/native-ui.js',
  '/src/js/ai-consent.js',
  '/src/js/plan-source.js',
  '/src/js/ai-usage.js',
  '/src/js/client-pro.js',
  '/src/js/coaching-enhanced.js',
  '/src/js/coach-videos.js',
  '/src/js/client-coaching.js',
  '/src/js/checkin-detail.js',
  '/src/js/checkin-detail-form.js',
  '/src/js/coach-photos.js',
  '/src/js/settings.js',
  '/src/js/local-account-data.js',
  '/src/js/mobility.js',
  '/src/js/coach-data.js',
  '/src/js/ai-coach.js',
  '/src/js/coach-brief.js',
  '/src/js/coach-review.js',
  '/src/js/next-step-chips.js',
  '/src/js/overload-win.js',
  '/src/js/guide-core.js',
  '/src/js/guide-tours.js',
  '/src/js/coach-guide-core.js',
  '/src/js/coach-guide.js',
  '/src/js/guide-ui.js',
  '/src/js/onboarding-cover.js',
  '/src/js/history-import-core.js',
  '/src/js/history-import.js',
  '/src/js/habit-core.js',
  '/src/js/train-together.js',
  '/src/js/habit.js',
  '/src/js/first-session-card.js',
  '/src/js/archetype-config.js',
  '/src/js/shares.js',
  '/src/js/meal-share.js',
  '/src/js/notifications.js',
  '/src/js/coach-nudges-core.js',
  '/src/js/reminders.js',
  '/src/js/push-notifications.js',
  '/src/js/apple-health.js',
  '/src/js/apple-sign-in.js',
  '/src/js/app-links.js',
  '/src/js/friends.js',
  '/src/js/rehab.js',
  '/css/friends.css',
  '/css/rehab.css',
  '/src/js/profiles.js',
  '/src/js/app-time.js',
  '/src/js/logbook-cover.js',
  '/src/js/settings-hero.js',
  '/src/js/coach-code.js',
  '/src/js/a11y-keyboard.js',
  '/css/profiles.css',
  '/css/exercise-card.css',
  '/css/session-sheets.css',
  // Self-hosted third-party libraries and fonts (vendor/README.md)
  '/vendor/fonts/fonts.css',
  // The app's main typefaces (css/tokens.css), so an offline start isn't
  // drawn in the system font. Other weights and scripts are cached on use.
  '/vendor/fonts/anton-latin-a6f395c1.woff2',
  '/vendor/fonts/archivo-latin-79dc5e10.woff2',
  '/vendor/fonts/barlow-condensed-latin-b576192e.woff2',
  '/vendor/fonts/barlow-condensed-latin-f60870fc.woff2',
  '/vendor/fonts/barlow-condensed-latin-7f84396d.woff2',
  '/vendor/chart-4.5.1.umd.min.js',
  '/vendor/confetti-1.9.3.browser.js',
  '/vendor/firebase-app-compat-10.14.1.js',
  '/vendor/firebase-auth-compat-10.14.1.js',
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

// A cache miss still has to answer with a Response: resolving respondWith()
// with undefined throws "Failed to convert value to 'Response'" for every
// file on the page.
const orNetworkError = (cached) => cached || Response.error();

// The app shell (index.html at the root of this worker's scope) is the
// offline page for the app itself only. Other pages (the coach console at
// /coach/, the intake form, pricing, …) load their files relative to their
// own folder, so the app shell served at their address is a page of broken
// links. They get their own cached copy, or a plain "can't connect" page.
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const isAppShellPath = (pathname) => pathname === SCOPE_PATH || pathname === SCOPE_PATH + 'index.html';

function offlinePage() {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Pocket Coach</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
    + 'background:#0b110e;color:#e8efe9;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}'
    + 'button{margin-top:16px;padding:10px 22px;border:0;border-radius:999px;background:#2f8a63;color:#fff;font:inherit;cursor:pointer}</style></head>'
    + '<body><main><h1>Can\'t connect</h1><p>This page could not be loaded. Check your connection and try again.</p>'
    + '<button onclick="location.reload()">Try again</button></main></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST/PUT handled by offline queue in main thread)
  if (request.method !== 'GET') return;

  // Paid ebooks/programs are never put in the shared cache: it is keyed by URL
  // only, so a cached copy could be served to another (or a downgraded) account.
  // The app keeps its own per-account offline copy and wipes it on logout.
  if (url.pathname.includes('/api/premium/')) return;
  // Same for coaching: client check-ins, bodyweight and notes are personal
  // data and must never be replayed from a URL-keyed cache to another account.
  if (/\/api\/(coach|client)\//.test(url.pathname) || url.pathname.includes('/exercise-videos')) return;
  // Profiles depend on who is asking (visibility settings, your own profile
  // at /me), so they are never served from the shared cache either.
  if (url.pathname.includes('/api/profiles/')) return;
  // Synced data and workouts are per account too, and the URL doesn't say
  // whose they are (the account is in the Authorization header).
  if (url.pathname.includes('/api/sync/') || /\/workouts\/?$/.test(url.pathname)) return;

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
        .catch(() => caches.match(request).then(orNetworkError))
    );
    return;
  }

  // Navigation requests (HTML pages): network-first so users always get latest.
  // Use cache: 'reload' to bypass the browser/CDN HTTP cache (GitHub Pages
  // sends Cache-Control: max-age=600 on index.html) - otherwise a plain
  // fetch(request) can still return a stale response for up to 10 minutes
  // after a deploy, even though this handler is "network-first".
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request.url, { cache: 'reload' }).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_STATIC).then((c) => c.put(request, clone));
        }
        return response;
      }).catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        if (request.mode !== 'navigate') return Response.error();
        return isAppShellPath(url.pathname) ? caches.match('/index.html').then((shell) => shell || offlinePage()) : offlinePage();
      }))
    );
    return;
  }

  // Code (JS, CSS, JSON): network-first, cache as offline fallback. It used
  // to be cache-first, so after a deploy the fresh index.html and any brand
  // new script loaded alongside last version's CSS: new components (e.g.
  // Home's "Today's brief") rendered unstyled until a second launch.
  const isCode = /\.(js|css|json)$/.test(url.pathname);
  if (isCode) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' }).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_STATIC).then((c) => c.put(request, clone));
        }
        return response;
      }).catch(() => caches.match(request).then(orNetworkError))
    );
    return;
  }

  // Other static assets (images, icons, fonts): cache-first, and kept once
  // fetched. Only .ico files used to be kept, so an offline start (or one
  // after the HTTP cache expired) drew the cover with a broken logo and
  // the system font while the page, CSS and scripts came from the cache.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && /\.(ico|png|jpe?g|webp|svg|gif|woff2?|ttf|otf)$/i.test(url.pathname)) {
        const clone = response.clone();
        caches.open(CACHE_STATIC).then((c) => c.put(request, clone));
      }
      return response;
    }).catch(() => Response.error()))
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
