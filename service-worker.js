const CACHE_NAME = 'pocketfit-v1';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  // Cache all local scripts so the app works offline
  'archiveOldWorkouts.js',
  'progressiveOverload.js',
  'community.js',
  'config.js',
  'progressUtils.js',
  'progressMilestones.js',
  'progressAnalytics.js',
  'progressGoals.js',
  'progressAI.js',
  'gamification.js',
  'offline.js',
  'autoProgression.js',
  'periodization.js',
  'macrosFeatures.js',
  'lifestyle.js',
  'ProgramTab.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});

