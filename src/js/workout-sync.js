/* =============================================================
   RECENT WORKOUT SYNC
   Sends workouts from the last 4 weeks to the backend (POST /workouts)
   shortly after they're logged or edited, so the Leaderboard and the
   Exercise Leaderboard reflect what people lift this week.

   Before this, workouts only reached the server when the archiver
   (workout-archiver.js) hard-saved them after 4 weeks. Both use the
   workout's own `id`, which the backend uses as the doc id, so a
   re-post overwrites instead of duplicating (and totals adjust by the
   difference).

   Only changed workouts are sent: a fingerprint of each one is kept in
   workoutSyncFp_{user}.
   ============================================================= */

(function () {
  'use strict';

  const WINDOW_DAYS = 28;
  const INTERVAL_MS = 60 * 1000;
  const FP_PREFIX = 'workoutSyncFp_';
  let _running = false;

  function _user() {
    if (typeof window !== 'undefined' && window.currentUser) return window.currentUser;
    return localStorage.getItem('fitnessAppUser');
  }

  function _read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  // Small, stable string hash (FNV-1a) of the workout's JSON.
  function fingerprint(workout) {
    const str = JSON.stringify(workout);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + ':' + str.length;
  }

  function _hasSets(w) {
    if (Array.isArray(w?.log)) return w.log.some(e => Array.isArray(e?.repsArray) && e.repsArray.length);
    return Array.isArray(w?.sets) && w.sets.length > 0;
  }

  // Workouts from the last WINDOW_DAYS that have an id and at least one set.
  function collectRecentWorkouts(username, now = Date.now()) {
    const cutoff = new Date(now - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    const seen = new Set();
    const out = [];
    [...(_read(`workouts_${username}`) || []), ...(_read(`workoutHistory_${username}`) || [])].forEach(w => {
      if (!w || !w.id || seen.has(String(w.id))) return;
      if (String(w.date || '').slice(0, 10) < cutoff || !_hasSets(w)) return;
      seen.add(String(w.id));
      out.push(w);
    });
    return out;
  }

  async function syncRecentWorkouts() {
    if (_running) return 0;
    const username = _user();
    const token = localStorage.getItem('token');
    if (!username || !token || !window.SERVER_URL) return 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;

    _running = true;
    let sent = 0;
    try {
      const fpKey = FP_PREFIX + username;
      const synced = _read(fpKey) || {};
      const recent = collectRecentWorkouts(username);
      // Keep fingerprints only for workouts still in the window.
      const next = {};
      recent.forEach(w => { if (synced[w.id]) next[w.id] = synced[w.id]; });
      for (const w of recent) {
        const fp = fingerprint(w);
        if (synced[w.id] === fp) continue;
        const rawDate = w.date || w.createdAt;
        const res = await fetch(`${window.SERVER_URL}/workouts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            date: rawDate ? new Date(rawDate).toISOString() : new Date().toISOString(),
            title: w.title || w.name || 'Workout',
            workout: w,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) break; // try again next round
        next[w.id] = fp;
        sent++;
      }
      localStorage.setItem(fpKey, JSON.stringify(next));
    } catch (err) {
      console.warn('[WorkoutSync] failed:', err.message);
    } finally {
      _running = false;
    }
    return sent;
  }

  function _tick() {
    if (document.visibilityState === 'hidden') return;
    syncRecentWorkouts();
  }

  if (typeof window !== 'undefined') {
    window.syncRecentWorkouts = syncRecentWorkouts;
    if (!window.__WORKOUT_SYNC_NO_TIMER) {
      setInterval(_tick, INTERVAL_MS);
      setTimeout(_tick, 8000);
      // Catch the workout just logged when the app goes to the background.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') syncRecentWorkouts();
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { syncRecentWorkouts, collectRecentWorkouts, fingerprint };
  }
})();
